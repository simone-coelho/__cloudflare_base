// src/connectors/AudienceStore.ts
// The small persistence seam shared by SegmentProvider (reads) and
// AudienceAuthoring (writes). Because both mock adapters point at the same store,
// an audience created by Opal is immediately qualifiable by ODP — no redeploy.
// See docs/architecture/05-demo-build-spec.md §1.5.
//
// P105 (E30): a tenant's published audiences are one document, the optional
// `audiences` member of its configuration publication (src/config/publication.ts).
// Every qualification reads it through the pin the operation already holds, so an
// action reads no audience while the publication is unchanged and the isolate holds
// it, and one storage read after a change or on a new isolate, at any number of
// audiences. Every publish, archive, rename, pin and seed is one set publication of
// the member (compare-and-swap on the head, a conflict retried, bounded), and the
// per-audience KV record is written after the commit, so `get(key)` still resolves an
// archived audience. A tenant whose set has no member yet (the sealed set's own
// statement) is read from its KV records until its first audience write, or the
// five-minute run (`moveAudiences`), creates the member from them. A tenant with no
// publication at all (no STORAGE binding, or a head storage says does not exist)
// keeps its KV records. A publication that exists and cannot be read fails the read:
// it never falls back to KV.
//
// R-P696 (AL4): the run's reconciliation adopts a KV record only when it was written
// after the member's version of that audience, never because it differs. Every record
// this release writes carries a mark (`_seal`, the digest of the record it wrote after
// the commit that carried it), so the run tells this release's records, and an earlier
// release's change of one of them, from an earlier release's own; each write notes in the
// member the earlier release's record it superseded, and the run notes a record it cannot
// date yet (`reconcile`).

import type { Env } from '@/types/env';
import type { AudienceDef } from './types';
import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';
import { ownerBindingIdentity } from '@/identity/sessionAuthority';
import type { DocumentKind } from '@/config/versionedStore';
import { PublicationError, pinPublication, publishSet, readOptionalPinnedPublication, type PublicationPin } from '@/config/publication';

/**
 * The member's value: every published audience of the tenant, by key, each once; and the
 * reconciliation's ledger by audience key (a `Note`), present only when not empty.
 */
export interface AudiencesDocument { version: 1; audiences: AudienceDef[]; ledger?: Record<string, string> }

function validateAudiences(candidate: unknown): { ok: true; value: AudiencesDocument } | { ok: false; errors: string[] } {
  const doc = candidate as Partial<AudiencesDocument> | null;
  if (!doc || typeof doc !== 'object' || doc.version !== 1 || !Array.isArray(doc.audiences)) return { ok: false, errors: ['audiences: { version: 1, audiences: [] } required'] };
  const errors: string[] = [], seen = new Set<string>();
  for (const [i, a] of doc.audiences.entries()) {
    if (!a || typeof a !== 'object' || typeof a.key !== 'string' || !a.key || seen.has(a.key)) errors.push(`audiences[${i}].key`);
    else seen.add(a.key);
    if (a?.status !== 'published') errors.push(`audiences[${i}].status`);
    if (!a?.conditions || typeof a.conditions !== 'object') errors.push(`audiences[${i}].conditions`);
  }
  const ledger = doc.ledger as unknown;
  if (ledger !== undefined && (!ledger || typeof ledger !== 'object' || Array.isArray(ledger) || Object.values(ledger).some(note => typeof note !== 'string'))) errors.push('ledger');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: documentOf([...doc.audiences].sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0), (ledger ?? {}) as Record<string, string>) };
}
/** The member's document, its ledger's keys in order and the ledger left out when empty. */
function documentOf(audiences: AudienceDef[], ledger: Readonly<Record<string, string>>): AudiencesDocument {
  const keys = Object.keys(ledger).sort();
  return keys.length ? { version: 1, audiences, ledger: Object.fromEntries(keys.map(key => [key, ledger[key]])) } : { version: 1, audiences };
}
/** The publication kind of the tenant's published audiences (publication.ts KINDS, OPTIONAL_MEMBERS, kindFor). */
export const AUDIENCES_KIND: DocumentKind<AudiencesDocument> = { name: 'audiences', publication: 'r2', validate: validateAudiences, versionOf: () => '' };

/**
 * Lane E4, kept only on the path of a tenant not yet moved into its publication:
 * its published audiences, remembered by this isolate for AUDIENCE_LIST_MS per
 * backing KV binding (`ownerBindingIdentity`) and tenant. A write through any store
 * of this isolate forgets it at once. A moved tenant never reads it.
 */
export const AUDIENCE_LIST_MS = 10_000;
interface Listed { at: number; defs: AudienceDef[] }
let listed = new WeakMap<object, { lists: Map<string, Listed>; writes: Map<string, number> }>();
/** Tests: forget every remembered list. */
export function forgetListedAudiences(): void { listed = new WeakMap(); }

/** One change of a batched write (`apply`). */
export type AudienceChange = { op: 'publish'; def: AudienceDef } | { op: 'archive'; key: string };

export interface AudienceStore {
  /** `administrative`: the operator's own list, read through a pin of its own (the head read every time). */
  listPublished(options?: { administrative?: boolean }): Promise<AudienceDef[]>;
  publish(def: AudienceDef): Promise<void>;
  get(key: string): Promise<AudienceDef | null>;
  /** Load Coach launch audiences at boot (idempotent — won't clobber runtime-created ones). */
  seed(defs: AudienceDef[]): Promise<void>;
  /** Retire an audience (e.g. its catalog value disappeared) — drops out of qualification. */
  archive(key: string): Promise<void>;
  /**
   * The three human verbs the scope appendix §1.2 promises: "Your team renames,
   * pins, or prunes anything the engine proposes." The generator has always
   * honoured the RESULT of these (audienceGenerator.ts:193 skips pinned,
   * :197 skips human-edited); nothing could perform them.
   */
  rename(key: string, name: string, description?: string): Promise<AudienceDef | null>;
  setPinned(key: string, pinned: boolean): Promise<AudienceDef | null>;
  /** P105: several publishes and archives as one write (the demo's regeneration: one publication per pass). */
  apply?(changes: AudienceChange[]): Promise<void>;
}

const PREFIX = 'audience:';
const memberKey = (tenant: string) => 'audiences:' + tenant;
/** Set publications attempted before a write gives up on a head that keeps moving. */
const ATTEMPTS = 8;
/** No publication at all: no STORAGE binding. */
const hasStorage = (env: Env) => {
  try { const s = env.STORAGE as unknown as { get?: unknown } | undefined; return !!s && typeof s.get === 'function'; } catch { return false; }
};
/** A head storage says does not exist, or an initialization still pending: the tenant has no publication yet. */
const uninitialized = (error: unknown) => error instanceof PublicationError && error.code === 'publication_uninitialized';

/** Canonical text of a JSON value (keys in order, undefined left out as JSON leaves it out). */
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return '[' + v.map(item => item === undefined ? 'null' : canonical(item)).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
};
/** A 53-bit digest (cyrb53) of a value's canonical text, in base 36. */
function digestOf(v: unknown): string {
  const text = canonical(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * R-P696: this release's mark on every KV record it writes, the digest of the record
 * without the mark. This release writes a record only after the commit that carries it,
 * so a record whose mark is its own digest is never newer than the member. An earlier
 * release's write keeps no mark (a publish, a seed) or keeps the one it read with
 * changed content (a rename, a pin, a prune spread the record), so its mark is broken.
 */
const MARK = '_seal';
type StoredRecord = AudienceDef & { [MARK]?: unknown };
/** A record without this release's mark: what readers and the member see. */
function unmarked(record: StoredRecord): AudienceDef {
  if (!Object.hasOwn(record, MARK)) return record;
  const plain: StoredRecord = { ...record };
  delete plain[MARK];
  return plain;
}
/** The KV text this release writes for a definition: the definition and its mark. */
const markedText = (def: AudienceDef): string => { const plain = unmarked(def); return JSON.stringify({ ...plain, [MARK]: digestOf(plain) }); };
/** A record carrying its own mark: this release wrote it, after the commit that carried it. */
const isOwn = (record: StoredRecord): boolean => typeof record[MARK] === 'string' && record[MARK] === digestOf(unmarked(record));

/**
 * The ledger's note on one audience, as text `=<digest>` and/or `?<record digest>@<entry digest>`:
 * `superseded`, the digest of the earlier release's KV record a write of this release read
 * before its commit and superseded ('' for an archive that superseded none: the audience is
 * this release's own); `pending`, a record the run found and could not date yet, against the
 * member's entry it found it beside.
 */
interface Note { superseded?: string; pending?: string }
const SUPERSEDED = '=', PENDING = '?';
function noteOf(text: string | undefined): Note {
  if (text === undefined) return {};
  const at = text.indexOf(PENDING), head = at < 0 ? text : text.slice(0, at);
  return { ...(head.startsWith(SUPERSEDED) ? { superseded: head.slice(1) } : {}), ...(at < 0 ? {} : { pending: text.slice(at + 1) }) };
}
function setNote(ledger: Record<string, string>, key: string, note: Note): void {
  const text = (note.superseded === undefined ? '' : SUPERSEDED + note.superseded) + (note.pending === undefined ? '' : PENDING + note.pending);
  if (text) ledger[key] = text; else delete ledger[key];
}
/**
 * This release writes `key` over `prior`, its KV record read before the commit: an earlier
 * release's record is noted superseded (never adopted afterwards: the race and the stale
 * read meet it); this release's own record keeps the note as it is; a pending note goes.
 */
function supersede(ledger: Record<string, string>, key: string, prior: StoredRecord | null | undefined, archive: boolean): void {
  const kept = noteOf(ledger[key]).superseded;
  setNote(ledger, key, { superseded: prior && !isOwn(prior) ? digestOf(prior) : kept ?? (archive ? '' : undefined) });
}

/**
 * The five-minute run's reconciliation of a moved tenant (AL4, R-P696): the next document,
 * or null when no KV record was written after the member's version of its audience.
 * Never adopted: a record carrying its own mark (this release's, written after its commit),
 * a record a write of this release superseded, a record saying what the member says.
 * Adopted (the audience published or replaced, or removed when the record is archived):
 * - a record whose broken mark is the digest of the member's entry: an earlier release
 *   changed the very record this release wrote for that version, after its KV put;
 * - a published record of an audience the member never held (no entry, no note);
 * - a record the previous run found beside this very entry (its pending note): it outlived
 *   the KV put of the write of that version, so it came after it. Any other record is
 *   noted pending and left as it is.
 */
function reconcile(doc: AudiencesDocument, stored: readonly StoredRecord[]): AudiencesDocument | null {
  const byKey = new Map(doc.audiences.map(a => [a.key, a] as const));
  const ledger: Record<string, string> = { ...doc.ledger };
  let changed = false;
  for (const record of stored) {
    if (isOwn(record)) continue;
    const key = record.key, held = byKey.get(key), plain = unmarked(record), archived = plain.status === 'archived';
    if (archived ? !held : held !== undefined && canonical(held) === canonical(plain)) continue;
    const note = noteOf(ledger[key]), print = digestOf(record), mark = record[MARK];
    if (note.superseded === print) continue;
    const derived = typeof mark === 'string' && held !== undefined && mark === digestOf(held);
    if (!derived && (held !== undefined || ledger[key] !== undefined)) {
      const pending = print + '@' + (held ? digestOf(held) : '');
      if (note.pending !== pending) { setNote(ledger, key, { ...note, pending }); changed = true; continue; }
    }
    if (archived) byKey.delete(key); else byKey.set(key, plain);
    setNote(ledger, key, { superseded: note.superseded });
    changed = true;
  }
  return changed ? documentOf([...byKey.values()], ledger) : null;
}

export class KvAudienceStore implements AudienceStore {
  /**
   * KV scoped to one brand (CW1). The default tenant's keys are unprefixed, so
   * an existing `new KvAudienceStore(env)` reads and writes exactly the keys it
   * always did; a second brand cannot see them and they cannot see it.
   *
   * NOT the same axis as the demo-surface prefix in @/demos/registry. That
   * namespaces the audience KEY ('' for coach, 'bh_' for brighthour) to keep two
   * demos apart inside one store; this namespaces the KV key to keep two
   * customers apart. Surfaces are pseudo-tenants and should eventually become
   * real ones, but converging them now would break both demos for no gain.
   */
  private readonly kv: KVLike;
  /** Lane E4: this isolate's remembered lists for the backing binding (unmoved tenants only), or null where none can be kept. */
  private readonly memory: { lists: Map<string, Listed>; writes: Map<string, number> } | null;

  constructor(private env: Env, readonly tenant: TenantId = DEFAULT_TENANT) {
    this.kv = new TenantKV(env.CACHE as unknown as KVLike, tenant);
    const binding = ownerBindingIdentity(env.CACHE as unknown as object | undefined);
    let memory = binding ? listed.get(binding) : undefined;
    if (binding && !memory) { memory = { lists: new Map(), writes: new Map() }; listed.set(binding, memory); }
    this.memory = memory ?? null;
  }

  /**
   * The member, read through the operation's own pin (the publication's serving
   * cache), or null where the tenant is not moved: no publication, or a set with no
   * audiences member. The entries are the publication's frozen revision, never a copy.
   */
  private async fromPublication(administrative = false): Promise<readonly AudienceDef[] | null> {
    if (!hasStorage(this.env)) return null;
    let pin: PublicationPin;
    try { pin = await pinPublication(this.env, this.tenant, !administrative); } catch (error) { if (uninitialized(error)) return null; throw error; }
    const revision = await readOptionalPinnedPublication(this.env, AUDIENCES_KIND, this.tenant, pin);
    return revision ? revision.value.audiences : null;
  }

  async listPublished(options: { administrative?: boolean } = {}): Promise<AudienceDef[]> {
    const carried = await this.fromPublication(options.administrative === true);
    if (carried) return carried as AudienceDef[];
    return this.unmovedList();
  }

  /** An unmoved tenant: every page of its records, the gets together; remembered as lane E4 remembered it. */
  private async unmovedList(): Promise<AudienceDef[]> {
    const held = this.memory?.lists.get(this.tenant), started = Date.now();
    if (held && Number.isFinite(started) && started >= held.at && started - held.at < AUDIENCE_LIST_MS) return structuredClone(held.defs);
    const writes = this.memory?.writes.get(this.tenant) ?? 0;
    const defs = (await this.records()).filter(def => def.status === 'published');
    // Remembered only when no write through this isolate landed while it was being read.
    if (this.memory && (this.memory.writes.get(this.tenant) ?? 0) === writes) this.memory.lists.set(this.tenant, { at: started, defs: structuredClone(defs) });
    return defs;
  }

  /** Every KV record of the tenant, published and archived, as stored (its mark kept): every page of the list followed, then every get issued at once. */
  private async storedRecords(): Promise<StoredRecord[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: PREFIX, ...(cursor ? { cursor } : {}) }) as { keys: Array<{ name: string }>; list_complete?: boolean; cursor?: string };
      for (const k of page.keys) names.push(k.name);
      cursor = page.list_complete === false && page.cursor ? page.cursor : undefined;
    } while (cursor);
    const read = await Promise.all(names.map(name => this.kv.get(name, 'json') as Promise<StoredRecord | null>));
    return read.filter((def): def is StoredRecord => !!def && typeof def === 'object' && typeof def.key === 'string');
  }

  /** Every KV record of the tenant, without this release's mark. */
  private async records(): Promise<AudienceDef[]> {
    return (await this.storedRecords()).map(unmarked);
  }

  /** Lane E4: a write through this isolate makes its remembered list unusable at once. */
  private written(): void {
    if (!this.memory) return;
    this.memory.writes.set(this.tenant, (this.memory.writes.get(this.tenant) ?? 0) + 1);
    this.memory.lists.delete(this.tenant);
  }

  /**
   * One set publication of the member over the current head: `change` receives the
   * current document (the member, or the KV records where the tenant is not moved yet,
   * which creates the member) and answers the next one, or null for no change. A
   * conflict on the head is retried from a fresh head, at most ATTEMPTS times. A member
   * past the publication's 2 MiB bound is refused 413 `document_too_large` by name and
   * nothing changes. Answers false where the tenant has no publication (its write stays
   * a KV write).
   *
   * R-P696: `prior` receives the KV record of each of `keys` (the audiences this write
   * writes) as it stood before the commit, read once where the tenant has a publication
   * (the unmoved tenant's records are already read), so the write notes in the member
   * the earlier release's record it supersedes (`supersede`).
   */
  private async mutate(note: string, keys: readonly string[], prior: Map<string, StoredRecord | null>,
    change: (current: AudiencesDocument) => AudiencesDocument | null): Promise<boolean> {
    if (!hasStorage(this.env)) return false;
    for (let attempt = 1; ; attempt++) {
      let pin: PublicationPin;
      try { pin = await pinPublication(this.env, this.tenant); } catch (error) { if (uninitialized(error)) return false; throw error; }
      const current = await readOptionalPinnedPublication(this.env, AUDIENCES_KIND, this.tenant, pin);
      let base: AudiencesDocument;
      if (current) {
        base = current.value;
        const unread = keys.filter(key => !prior.has(key));
        const read = await Promise.all(unread.map(key => this.kv.get(PREFIX + key, 'json') as Promise<StoredRecord | null>));
        unread.forEach((key, i) => prior.set(key, read[i] ?? null));
      } else {
        const stored = await this.storedRecords(), byKey = new Map(stored.map(record => [record.key, record] as const));
        for (const key of keys) prior.set(key, byKey.get(key) ?? null);
        base = { version: 1, audiences: stored.map(unmarked).filter(def => def.status === 'published') };
      }
      const next = change(base);
      if (next === null && current) return true;
      const expected = pin.refs[memberKey(this.tenant)]?.revision ?? 0;
      try {
        const result = await publishSet(this.env, [{ kind: AUDIENCES_KIND as DocumentKind<unknown>, scope: this.tenant, request: { note },
          candidate: () => next ?? documentOf([...base.audiences], base.ledger ?? {}) }],
        { actor: 'audience-store', note, operationId: `${expected}:${crypto.randomUUID()}`, expectedRevision: expected,
          expectedPublication: { revision: pin.revision, digest: pin.digest } });
        if (!result.ok) throw new PublicationError('Invalid audiences: ' + result.errors.join(', '), 422, 'invalid_document');
        return true;
      } catch (error) {
        if (error instanceof PublicationError && error.status === 409 && attempt < ATTEMPTS) continue;
        if (error instanceof PublicationError && error.status === 413) {
          throw new PublicationError("The tenant's published audiences (the audiences member) would exceed 2 MiB; nothing was changed", 413, 'document_too_large');
        }
        throw error;
      }
    }
  }

  async publish(def: AudienceDef): Promise<void> {
    await this.apply([{ op: 'publish', def }]);
  }

  async get(key: string): Promise<AudienceDef | null> {
    const found = (await this.fromPublication())?.find(a => a.key === key);
    if (found) return structuredClone(found);
    const record = (await this.kv.get(PREFIX + key, 'json')) as StoredRecord | null;
    return record ? unmarked(record) : null;
  }

  async seed(defs: AudienceDef[]): Promise<void> {
    const have = new Set((await this.fromPublication() ?? []).map(a => a.key));
    const records = await Promise.all(defs.map(def => have.has(def.key) ? 'held' : this.kv.get(PREFIX + def.key)));
    const missing = defs.filter((_, i) => !records[i]);
    if (missing.length) await this.apply(missing.map(def => ({ op: 'publish' as const, def })), true);
  }

  /**
   * Several publishes and archives as one set publication, then each KV record, marked.
   * `onlyNew`: a publish of a key the member already holds is skipped (the seed). Each
   * audience written notes the earlier release's record it supersedes (`supersede`).
   */
  async apply(changes: AudienceChange[], onlyNew = false): Promise<void> {
    if (!changes.length) return;
    const prior = new Map<string, StoredRecord | null>();
    await this.mutate(`audiences: ${changes.length} change(s)`, changes.map(c => c.op === 'publish' ? c.def.key : c.key), prior, current => {
      const byKey = new Map(current.audiences.map(a => [a.key, a] as const));
      const ledger: Record<string, string> = { ...current.ledger };
      let changed = false;
      for (const c of changes) {
        if (c.op === 'publish') {
          if (onlyNew && byKey.has(c.def.key)) continue;
          byKey.set(c.def.key, { ...unmarked(c.def), status: 'published' }); supersede(ledger, c.def.key, prior.get(c.def.key), false); changed = true;
        } else if (byKey.delete(c.key)) { supersede(ledger, c.key, prior.get(c.key), true); changed = true; }
      }
      return changed ? documentOf([...byKey.values()], ledger) : null;
    });
    const records: Array<[string, AudienceDef]> = [];
    for (const c of changes) {
      if (c.op === 'publish') records.push([c.def.key, { ...unmarked(c.def), status: 'published' }]);
      else {
        const def = prior.has(c.key) ? prior.get(c.key) : (await this.kv.get(PREFIX + c.key, 'json')) as StoredRecord | null;
        if (def && def.status !== 'archived') records.push([c.key, { ...unmarked(def), status: 'archived' }]);
      }
    }
    try { await Promise.all(records.map(([key, def]) => this.kv.put(PREFIX + key, markedText(def)))); } finally { this.written(); }
  }

  async archive(key: string): Promise<void> {
    const def = await this.get(key);
    if (!def || def.status === 'archived') return;
    const prior = new Map<string, StoredRecord | null>();
    await this.mutate('archive ' + key, [key], prior, doc => {
      const ledger: Record<string, string> = { ...doc.ledger }, before = ledger[key];
      supersede(ledger, key, prior.get(key), true);
      const held = doc.audiences.some(a => a.key === key);
      return held || ledger[key] !== before ? documentOf(doc.audiences.filter(a => a.key !== key), ledger) : null;
    });
    try { await this.kv.put(PREFIX + key, markedText({ ...def, status: 'archived' })); } finally { this.written(); }
  }

  /**
   * Rename. The KEY never moves, because it is load-bearing in cookies,
   * stored decisions and ODP qualification: renaming is a label change, not an
   * identity change, and treating it as one would orphan everything already tagged.
   *
   * Nothing here touches generatorHash. It does not need to: hashDef() covers
   * name, description and conditions, so a rename makes the stored def stop
   * hashing to its recorded value, and regeneration reads that as a human edit
   * and leaves the audience alone. The protection is a consequence of the edit
   * rather than a flag someone has to remember to set.
   */
  async rename(key: string, name: string, description?: string): Promise<AudienceDef | null> {
    const def = await this.get(key);
    if (!def) return null;
    const next: AudienceDef = {
      ...def,
      name,
      ...(description === undefined ? {} : { description }),
    };
    await this.replacePublished(next, 'rename ' + key);
    return next;
  }

  /**
   * Pin or unpin. Checked BEFORE the ownership hash during regeneration, so a
   * pinned audience survives even when its content still hashes to the
   * generator's own output — which is the case that matters, because that is
   * exactly an audience a merchandiser wanted kept without changing a word of it.
   */
  async setPinned(key: string, pinned: boolean): Promise<AudienceDef | null> {
    const def = await this.get(key);
    if (!def) return null;
    const next: AudienceDef = { ...def, pinned };
    await this.replacePublished(next, 'pin ' + key);
    return next;
  }

  /** A published audience's entry replaced in the member (an archived one lives in KV only), then its KV record, marked. */
  private async replacePublished(next: AudienceDef, note: string): Promise<void> {
    if (next.status === 'published') {
      const prior = new Map<string, StoredRecord | null>();
      await this.mutate(note, [next.key], prior, doc => {
        if (!doc.audiences.some(a => a.key === next.key)) return null;
        const ledger: Record<string, string> = { ...doc.ledger };
        supersede(ledger, next.key, prior.get(next.key), false);
        return documentOf(doc.audiences.map(a => a.key === next.key ? next : a), ledger);
      });
    }
    try { await this.kv.put(PREFIX + next.key, markedText(next)); } finally { this.written(); }
  }

  /**
   * The five-minute run's pass for this tenant: a set with no audiences member gets
   * one from the KV records (every page); a moved tenant's records written after the
   * member's version of their audience (an earlier release's writes during a rolling
   * release) are reconciled into it (`reconcile`), one publication, none when no record
   * is newer. A committed write is never reverted: a run between its commit and its KV
   * put, or reading a stale value, meets a record carrying this release's mark or one the
   * write noted superseded.
   */
  async moveAndReconcile(): Promise<void> {
    if (!hasStorage(this.env)) return;
    let pin: PublicationPin;
    try { pin = await pinPublication(this.env, this.tenant); } catch (error) { if (uninitialized(error)) return; throw error; }
    if (!Object.hasOwn(pin.refs, memberKey(this.tenant))) { await this.mutate('move', [], new Map(), () => null); return; }
    const stored = await this.storedRecords();
    await this.mutate('reconcile', [], new Map(), current => reconcile(current, stored));
  }
}

/** The five-minute run (src/index.ts): the tenant's audiences moved into its publication, or reconciled there. */
export async function moveAudiences(env: Env, tenant: TenantId): Promise<void> {
  await new KvAudienceStore(env, tenant).moveAndReconcile();
}
