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
//
// R-P699: the mark is also the record's KV metadata, which a list returns and an earlier
// release's put clears. The run gets only the records its list shows unmarked, marks each
// one it finds nothing to reconcile in (the move's records, once), and counts every call
// in the five-minute run's budget (`moveAudiences`), resuming next run where it stopped.
//
// R-P713 (AL4): the run's move is made within the same budget and resumes across runs. The
// member is published whole or not at all: the records the run has read so far, and the
// key it stopped after, are the move's progress, one KV record of the store's own
// (`MOVE_KEY`, under the tenant), and every reader and every write keeps base's KV path
// until the member exists. A tenant whose set cannot fit the member's bound is not moved:
// its refusal is stored by name with the size measured (in that record, or in the member
// where one exists), its reads and writes stay base's KV path (the operator's publish
// answers 200, never 413), and the run tries the move again only when the list shows its
// records changed (their count, names or metadata), never at full cost every run.
//
// R-P722 (AL4): no write answered 200 is lost to a run in flight. A write made on the KV
// path carries no mark (its metadata is its own digest, `written`), so a run on the moved
// tenant reads it until the member reflects it; and the move publishes the member, or
// writes its progress, only after a second list shows nothing changed behind its cursor,
// the progress carrying the digest of what lay behind the cursor so a later run restarts
// the move where a write landed there. A member a KV-path write has taken past the bound
// is published as the refusal, and every reader returns to base's KV path.

import type { Env } from '@/types/env';
import type { AudienceDef } from './types';
import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';
import { ownerBindingIdentity } from '@/identity/sessionAuthority';
import type { DocumentKind } from '@/config/versionedStore';
import { documentBytes, nameServingStorage, PUBLICATION_MAX_BYTES, PublicationError, pinPublication, publishSet, readOptionalPinnedPublication, type PublicationPin } from '@/config/publication';

/**
 * R-P713: the refusal of the move, by name: the tenant's set cannot fit the member's bound.
 * `bytes` is the size measured against `limit`; `records` the tenant's KV records as the
 * list showed them (how many, and the digest of their names and metadata), so the run
 * tries the move again only when they change.
 */
export interface MoveRefusal { phase: 'refused'; reason: 'document_too_large'; member: 'audiences'; bytes: number; limit: number; records: RecordsListed }
/** The tenant's KV records as the list shows them: their count, and the digest of their names and metadata. */
export interface RecordsListed { keys: number; digest: string }

/**
 * The member's value: every published audience of the tenant, by key, each once; and the
 * reconciliation's ledger by audience key (a `Note`), present only when not empty.
 * R-P722: a member carrying `move` is the refusal of a tenant whose set outgrew the bound
 * after it was moved; it is nobody's set, and every reader keeps base's KV path.
 */
export interface AudiencesDocument { version: 1; audiences: AudienceDef[]; ledger?: Record<string, string>; move?: MoveRefusal }

function validRefusal(candidate: unknown): candidate is MoveRefusal {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const v = candidate as Record<string, unknown>, records = v.records as Record<string, unknown> | null | undefined;
  return v.phase === 'refused' && v.reason === 'document_too_large' && v.member === 'audiences' && Object.keys(v).length === 6
    && Number.isSafeInteger(v.bytes) && (v.bytes as number) >= 0 && Number.isSafeInteger(v.limit) && (v.limit as number) > 0
    && !!records && typeof records === 'object' && !Array.isArray(records) && Object.keys(records).length === 2
    && Number.isSafeInteger(records.keys) && (records.keys as number) >= 0 && typeof records.digest === 'string';
}
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
  const move = doc.move as unknown;
  if (move !== undefined && (!validRefusal(move) || doc.audiences.length)) errors.push('move');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: documentOf([...doc.audiences].sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0), (ledger ?? {}) as Record<string, string>, move as MoveRefusal | undefined) };
}
/** The member's document, its ledger's keys in order and the ledger left out when empty; a refusal carried only where there is one. */
function documentOf(audiences: AudienceDef[], ledger: Readonly<Record<string, string>>, move?: MoveRefusal): AudiencesDocument {
  const keys = Object.keys(ledger).sort();
  const doc: AudiencesDocument = keys.length ? { version: 1, audiences, ledger: Object.fromEntries(keys.map(key => [key, ledger[key]])) } : { version: 1, audiences };
  if (move) doc.move = move;
  return doc;
}
/** The publication kind of the tenant's published audiences (publication.ts KINDS, OPTIONAL_MEMBERS, kindFor). */
export const AUDIENCES_KIND: DocumentKind<AudiencesDocument> = { name: 'audiences', publication: 'r2', validate: validateAudiences, versionOf: () => '' };
/** The member as the tenant's set, or null where there is none or it carries the refusal (R-P722): the tenant is then not moved. */
const movedMember = (doc: AudiencesDocument | null | undefined): AudiencesDocument | null => doc && !doc.move ? doc : null;

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
/** The audience key a listed KV name carries. */
const keyOf = (name: string) => name.slice(PREFIX.length);
/**
 * R-P713: the move's progress, one KV record of the store's own under the tenant (never
 * listed with the audience records: it does not carry their prefix): the records the run
 * has read so far and the key it stopped after, or the refusal of a set that cannot fit
 * the member. Spent once the member exists.
 */
const MOVE_KEY = 'audiences-move';
/** Set publications attempted before a write gives up on a head that keeps moving. */
const ATTEMPTS = 8;
/** No publication at all: no STORAGE binding. */
const hasStorage = (env: Env) => {
  try { const s = env.STORAGE as unknown as { get?: unknown } | undefined; return !!s && typeof s.get === 'function'; } catch { return false; }
};
/** A head storage says does not exist, or an initialization still pending: the tenant has no publication yet. */
const uninitialized = (error: unknown) => error instanceof PublicationError && error.code === 'publication_uninitialized';
/** The publication refused the member past its 2 MiB bound. */
const tooLarge = (error: unknown) => error instanceof PublicationError && error.status === 413;

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
 * R-P696: this release's mark on every KV record it writes for a member that carries it,
 * the digest of the record without the mark. Such a record is written only after the
 * commit that carries it, so a record whose mark is its own digest is never newer than the
 * member. An earlier release's write keeps no mark (a publish, a seed) or keeps the one it
 * read with changed content (a rename, a pin, a prune spread the record), so its mark is
 * broken. R-P722: a write on the KV path (the tenant not moved) carries no mark either: its
 * metadata is its own digest (`written`), which the list shows, so the move's retry and the
 * moved tenant's reconciliation both see it.
 */
const MARK = '_seal', WRITTEN = 'written';
type StoredRecord = AudienceDef & { [MARK]?: unknown };
/** A key as the list returns it: its name under the tenant, and the metadata its last put carried. */
interface ListedKey { name: string; metadata?: unknown }
/** A record without this release's mark: what readers and the member see. */
function unmarked(record: StoredRecord): AudienceDef {
  if (!Object.hasOwn(record, MARK)) return record;
  const plain: StoredRecord = { ...record };
  delete plain[MARK];
  return plain;
}
/** The KV text this release writes for a definition the member carries (the definition and its mark), and the same mark as the record's KV metadata. */
function marked(def: AudienceDef): { text: string; options: { metadata: Record<string, string> } } {
  const plain = unmarked(def), mark = digestOf(plain);
  return { text: JSON.stringify({ ...plain, [MARK]: mark }), options: { metadata: { [MARK]: mark } } };
}
/** The KV text this release writes on the KV path (as an earlier release wrote it), its own digest as metadata, never a mark. */
function plainWrite(def: AudienceDef): { text: string; options: { metadata: Record<string, string> } } {
  const plain = unmarked(def);
  return { text: JSON.stringify(plain), options: { metadata: { [WRITTEN]: digestOf(plain) } } };
}
/** A listed key whose metadata carries this release's mark: its last put was this release's for a member that carries it, so the run need not read it. */
const markedInList = (key: ListedKey): boolean => {
  const metadata = key.metadata as Record<string, unknown> | null | undefined;
  return !!metadata && typeof metadata === 'object' && typeof metadata[MARK] === 'string';
};
/** A record carrying its own mark: this release wrote it, after the commit that carried it. */
const isOwn = (record: StoredRecord): boolean => typeof record[MARK] === 'string' && record[MARK] === digestOf(unmarked(record));
/** The tenant's records as the list shows them (every key, or those at or before `upTo`): what a run compares to see them changed. */
const recordsOf = (keys: readonly ListedKey[], upTo?: string): RecordsListed => {
  const named = upTo === undefined ? keys : keys.filter(key => keyOf(key.name) <= upTo);
  return { keys: named.length, digest: digestOf(named.map(key => [key.name, key.metadata ?? null])) };
};
const sameRecords = (a: RecordsListed, b: RecordsListed): boolean => a.keys === b.keys && a.digest === b.digest;
/** The refusal of the move, by name, with the size measured and the records it was measured on. */
const refusalOf = (bytes: number, keys: readonly ListedKey[]): MoveRefusal =>
  ({ phase: 'refused', reason: 'document_too_large', member: 'audiences', bytes, limit: PUBLICATION_MAX_BYTES, records: recordsOf(keys) });

/**
 * R-P713: the move's progress (`MOVE_KEY`). `moving`: the published records the run has
 * read so far, in key order, the audience key it stopped `after`, and (R-P722) the records
 * at or before it as the list showed them (`behind`), so a later run restarts the move
 * where a write landed behind the cursor. `refused`: the refusal, where no member exists.
 */
type MoveProgress =
  | { version: 1; phase: 'moving'; after: string; behind: RecordsListed; audiences: AudienceDef[] }
  | ({ version: 1 } & MoveRefusal);
/** The progress record as stored, or null where there is none or it cannot be read (the move then starts over). */
function progressOf(raw: unknown): MoveProgress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (v.version !== 1) return null;
  if (v.phase === 'moving') {
    const behind = v.behind as Record<string, unknown> | null | undefined;
    if (typeof v.after !== 'string' || !Array.isArray(v.audiences) || !behind || typeof behind !== 'object' || !Number.isSafeInteger(behind.keys) || typeof behind.digest !== 'string') return null;
    return { version: 1, phase: 'moving', after: v.after, behind: { keys: behind.keys as number, digest: behind.digest },
      audiences: (v.audiences as unknown[]).filter((a): a is AudienceDef => !!a && typeof a === 'object' && typeof (a as AudienceDef).key === 'string') };
  }
  const rest: Record<string, unknown> = { ...v }; delete rest.version;
  return validRefusal(rest) ? { version: 1, ...rest } : null;
}

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

/** The run's plan: the member's next document (null: nothing to publish), the records to mark now, and those to mark once `next` is committed. */
interface Reconciled { next: AudiencesDocument | null; consistent: AudienceDef[]; adopted: AudienceDef[] }
/**
 * A write's set publication, as `mutate` answers it: `carried`, the member carries the write
 * (its KV records are marked); else the write stays on base's KV path, and where this write
 * measured the set over the bound, `refused` holds the size and the list it measured, for the
 * caller to store once its records are written (R-P722).
 */
interface Mutated { carried: boolean; refused?: { bytes: number; listed: ListedKey[] } }

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
 * R-P699: `stored` holds only the records the run's list showed unmarked; a record saying
 * what the member says is marked now (`consistent`), an adopted one once committed (`adopted`).
 */
function reconcile(doc: AudiencesDocument, stored: readonly StoredRecord[]): Reconciled {
  const byKey = new Map(doc.audiences.map(a => [a.key, a] as const));
  const ledger: Record<string, string> = { ...doc.ledger };
  const consistent: AudienceDef[] = [], adopted: AudienceDef[] = [];
  let changed = false;
  for (const record of stored) {
    const key = record.key, held = byKey.get(key), plain = unmarked(record), archived = plain.status === 'archived';
    // R-P699: a record saying what the member says is marked, so no run reads it again.
    if (archived ? !held : held !== undefined && canonical(held) === canonical(plain)) { consistent.push(plain); continue; }
    if (isOwn(record)) continue;
    const note = noteOf(ledger[key]), print = digestOf(record), mark = record[MARK];
    if (note.superseded === print) continue;
    const derived = typeof mark === 'string' && held !== undefined && mark === digestOf(held);
    if (!derived && (held !== undefined || ledger[key] !== undefined)) {
      const pending = print + '@' + (held ? digestOf(held) : '');
      if (note.pending !== pending) { setNote(ledger, key, { ...note, pending }); changed = true; continue; }
    }
    if (archived) byKey.delete(key); else byKey.set(key, plain);
    setNote(ledger, key, { superseded: note.superseded });
    adopted.push(plain);
    changed = true;
  }
  return { next: changed ? documentOf([...byKey.values()], ledger) : null, consistent, adopted };
}

/**
 * R-P713: one step of the move, before the member exists: every record read joins the
 * records being moved (published) or stays out of them (archived), as the unmoved read
 * answers it; no member is anybody's authority yet, so nothing is dated here. Each record is
 * marked once the progress or the member carrying it is written (`adopted`), an archived
 * one or one already carried as it is now (`consistent`).
 */
function moveInto(doc: AudiencesDocument, stored: readonly StoredRecord[]): Reconciled {
  const byKey = new Map(doc.audiences.map(a => [a.key, a] as const));
  const consistent: AudienceDef[] = [], adopted: AudienceDef[] = [];
  let changed = false;
  for (const record of stored) {
    const plain = unmarked(record), held = byKey.get(plain.key);
    if (plain.status === 'archived') { if (held) { byKey.delete(plain.key); adopted.push(plain); changed = true; } else consistent.push(plain); continue; }
    if (held !== undefined && canonical(held) === canonical(plain)) { consistent.push(plain); continue; }
    byKey.set(plain.key, plain); adopted.push(plain); changed = true;
  }
  return { next: changed ? documentOf([...byKey.values()].sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0), doc.ledger ?? {}) : null, consistent, adopted };
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
   * cache), or null where the tenant is not moved: no publication, a set with no
   * audiences member, or a member carrying the refusal (R-P722). The entries are the
   * publication's frozen revision, never a copy.
   */
  private async fromPublication(administrative = false): Promise<readonly AudienceDef[] | null> {
    if (!hasStorage(this.env)) return null;
    let pin: PublicationPin;
    try { pin = await pinPublication(this.env, this.tenant, !administrative); } catch (error) { if (uninitialized(error)) return null; throw error; }
    const revision = await readOptionalPinnedPublication(this.env, AUDIENCES_KIND, this.tenant, pin);
    return movedMember(revision?.value)?.audiences ?? null;
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

  /** Every key of the tenant's KV records, in key order, with the metadata the list returns: every page of the list followed. */
  private async listedKeys(): Promise<ListedKey[]> {
    const keys: ListedKey[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: PREFIX, ...(cursor ? { cursor } : {}) }) as { keys: ListedKey[]; list_complete?: boolean; cursor?: string };
      keys.push(...page.keys);
      cursor = page.list_complete === false && page.cursor ? page.cursor : undefined;
    } while (cursor);
    return keys.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }

  /** The records under these names as stored (the mark kept), every get issued at once. */
  private async read(names: readonly string[]): Promise<StoredRecord[]> {
    const read = await Promise.all(names.map(name => this.kv.get(name, 'json') as Promise<StoredRecord | null>));
    return read.filter((def): def is StoredRecord => !!def && typeof def === 'object' && typeof def.key === 'string');
  }

  /** Every KV record of the tenant, published and archived, as stored (its mark kept), with the list that named them: every page followed, then every get issued at once. */
  private async storedRecords(): Promise<{ listed: ListedKey[]; records: StoredRecord[] }> {
    const keys = await this.listedKeys();
    return { listed: keys, records: await this.read(keys.map(k => k.name)) };
  }

  /** This release's KV write of a record the member carries: its content and its mark, the mark also its metadata. */
  private putMarked(key: string, def: AudienceDef): Promise<void> {
    const { text, options } = marked(def);
    return this.kv.put(PREFIX + key, text, options);
  }
  /** R-P722: this release's KV write on the KV path (the tenant not moved): the record as an earlier release wrote it, its digest as metadata, no mark. */
  private putPlain(key: string, def: AudienceDef): Promise<void> {
    const { text, options } = plainWrite(def);
    return this.kv.put(PREFIX + key, text, options);
  }
  /** The KV write a finished write makes for each of its records: marked where the member carries it, plain where the write stayed on the KV path. */
  private putRecord(carried: boolean, key: string, def: AudienceDef): Promise<void> {
    return carried ? this.putMarked(key, def) : this.putPlain(key, def);
  }
  /**
   * R-P713, R-P722: a write that measured the tenant's set over the bound stores the refusal by name with the size,
   * after its own KV records are written and naming them as a run's list will show them (`plainWrite`'s metadata),
   * so the run tries the move again only when the records change after this write. Best effort: the write stays a
   * KV write either way, and the five-minute run measures and stores the refusal itself.
   */
  private async refuseAfterWrite(refused: { bytes: number; listed: ListedKey[] }, written: ReadonlyArray<[string, AudienceDef]>): Promise<void> {
    const byName = new Map(refused.listed.map(key => [key.name, key] as const));
    for (const [key, def] of written) byName.set(PREFIX + key, { name: PREFIX + key, metadata: plainWrite(def).options.metadata });
    const keys = [...byName.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    await this.writeProgress({ version: 1, ...refusalOf(refused.bytes, keys) }).catch(() => undefined);
  }

  /** Every KV record of the tenant, without this release's mark. */
  private async records(): Promise<AudienceDef[]> {
    return (await this.storedRecords()).records.map(unmarked);
  }

  /** R-P713: the move's progress record, or null where there is none. */
  private async readProgress(): Promise<MoveProgress | null> {
    return progressOf(await this.kv.get(MOVE_KEY, 'json'));
  }
  private writeProgress(progress: MoveProgress): Promise<void> {
    return this.kv.put(MOVE_KEY, JSON.stringify(progress));
  }
  private clearProgress(): Promise<void> {
    return this.kv.delete(MOVE_KEY);
  }

  /** Lane E4: a write through this isolate makes its remembered list unusable at once. */
  private written(): void {
    if (!this.memory) return;
    this.memory.writes.set(this.tenant, (this.memory.writes.get(this.tenant) ?? 0) + 1);
    this.memory.lists.delete(this.tenant);
  }

  /**
   * One set publication of the member over the current head: `change` receives the member
   * as committed (null where the set has none; a refusal member as it is) and answers the
   * next document, or null for no change. A conflict on the head is retried from a fresh
   * head, at most ATTEMPTS times. Answers the document published, null where `change` asked
   * for none, or 'no-publication' where the tenant has no publication at all. A member past
   * the publication's 2 MiB bound throws its 413; nothing changes.
   */
  private async commit(note: string, change: (current: AudiencesDocument | null) => Promise<AudiencesDocument | null>): Promise<AudiencesDocument | null | 'no-publication'> {
    for (let attempt = 1; ; attempt++) {
      let pin: PublicationPin;
      try { pin = await pinPublication(this.env, this.tenant); } catch (error) { if (uninitialized(error)) return 'no-publication'; throw error; }
      const current = await readOptionalPinnedPublication(this.env, AUDIENCES_KIND, this.tenant, pin);
      const next = await change(current?.value ?? null);
      if (next === null) return null;
      const expected = pin.refs[memberKey(this.tenant)]?.revision ?? 0;
      try {
        const result = await publishSet(this.env, [{ kind: AUDIENCES_KIND as DocumentKind<unknown>, scope: this.tenant, request: { note }, candidate: () => next }],
          { actor: 'audience-store', note, operationId: `${expected}:${crypto.randomUUID()}`, expectedRevision: expected,
            expectedPublication: { revision: pin.revision, digest: pin.digest } });
        if (!result.ok) throw new PublicationError('Invalid audiences: ' + result.errors.join(', '), 422, 'invalid_document');
        return next;
      } catch (error) {
        if (error instanceof PublicationError && error.status === 409 && attempt < ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /**
   * A write's set publication of the member: `change` receives the current document (the
   * member, or the KV records where the tenant is not moved yet, which creates the whole
   * member) and answers the next one, or null for no change. A moved tenant's member past
   * the publication's 2 MiB bound is refused 413 `document_too_large` by name and nothing
   * changes. Answers false where the write stays a KV write (R-P713): the tenant has no
   * publication, or its set cannot fit the member, stored before (in the member or the
   * progress record) or measured by this write, so no answer differs from base's.
   *
   * R-P696: `prior` receives the KV record of each of `keys` (the audiences this write
   * writes) as it stood before the commit, read once where the tenant has a publication
   * (the unmoved tenant's records are already read), so the write notes in the member
   * the earlier release's record it supersedes (`supersede`).
   */
  private async mutate(note: string, keys: readonly string[], prior: Map<string, StoredRecord | null>,
    change: (current: AudiencesDocument) => AudiencesDocument | null): Promise<Mutated> {
    if (!hasStorage(this.env)) return { carried: false };
    // What the last attempt found on an unmoved tenant: the list that named its records, the progress record, the
    // whole member it measured, and whether the write keeps base's KV path (refused before, or found over the bound here).
    const found: { listed: ListedKey[] | null; progress: MoveProgress | null; candidate: AudiencesDocument | null; kvOnly: boolean } = { listed: null, progress: null, candidate: null, kvOnly: false };
    try {
      const outcome = await this.commit(note, async raw => {
        found.listed = null; found.candidate = null; found.kvOnly = false;
        const current = movedMember(raw);
        if (current) {
          const unread = keys.filter(key => !prior.has(key));
          const read = await Promise.all(unread.map(key => this.kv.get(PREFIX + key, 'json') as Promise<StoredRecord | null>));
          unread.forEach((key, i) => prior.set(key, read[i] ?? null));
          return change(current);
        }
        // Not moved. R-P713: a set that cannot fit the member keeps base's KV path; else its records, every page, every get at once, make the whole member.
        if (raw?.move) { found.kvOnly = true; return null; }
        found.progress = await this.readProgress();
        if (found.progress?.phase === 'refused') { found.kvOnly = true; return null; }
        const { listed: names, records } = await this.storedRecords(), byKey = new Map(records.map(record => [record.key, record] as const));
        found.listed = names;
        for (const key of keys) prior.set(key, byKey.get(key) ?? null);
        const base: AudiencesDocument = { version: 1, audiences: records.map(unmarked).filter(def => def.status === 'published') };
        const candidate = change(base) ?? documentOf([...base.audiences], {});
        found.candidate = candidate;
        if (documentBytes(candidate) > PUBLICATION_MAX_BYTES) { found.kvOnly = true; return null; }
        return candidate;
      });
      if (outcome === 'no-publication') return { carried: false };
      if (!found.kvOnly) {
        // The member exists now: the move's progress, if any, is spent.
        if (found.listed && found.progress) await this.clearProgress().catch(() => undefined);
        return { carried: true };
      }
    } catch (error) {
      if (!tooLarge(error)) throw error;
      if (!found.listed) throw new PublicationError("The tenant's published audiences (the audiences member) would exceed 2 MiB; nothing was changed", 413, 'document_too_large');
    }
    // R-P713: the tenant keeps base's KV path. Where this write measured its set over the bound, the caller stores the refusal
    // by name with the size once its KV records are written, so the records it names are the ones a run lists (R-P722).
    return { carried: false, ...(found.listed && found.candidate ? { refused: { bytes: documentBytes(found.candidate), listed: found.listed } } : {}) };
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
   * Several publishes and archives as one set publication, then each KV record (marked
   * where the member carries it, plain where the write stayed on the KV path). `onlyNew`: a
   * publish of a key the member already holds is skipped (the seed). Each audience written
   * notes the earlier release's record it supersedes (`supersede`).
   */
  async apply(changes: AudienceChange[], onlyNew = false): Promise<void> {
    if (!changes.length) return;
    const prior = new Map<string, StoredRecord | null>();
    const outcome = await this.mutate(`audiences: ${changes.length} change(s)`, changes.map(c => c.op === 'publish' ? c.def.key : c.key), prior, current => {
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
    try { await Promise.all(records.map(([key, def]) => this.putRecord(outcome.carried, key, def))); } finally { this.written(); }
    if (outcome.refused) await this.refuseAfterWrite(outcome.refused, records);
  }

  async archive(key: string): Promise<void> {
    const def = await this.get(key);
    if (!def || def.status === 'archived') return;
    const prior = new Map<string, StoredRecord | null>();
    const outcome = await this.mutate('archive ' + key, [key], prior, doc => {
      const ledger: Record<string, string> = { ...doc.ledger }, before = ledger[key];
      supersede(ledger, key, prior.get(key), true);
      const held = doc.audiences.some(a => a.key === key);
      return held || ledger[key] !== before ? documentOf(doc.audiences.filter(a => a.key !== key), ledger) : null;
    });
    const archived: AudienceDef = { ...def, status: 'archived' };
    try { await this.putRecord(outcome.carried, key, archived); } finally { this.written(); }
    if (outcome.refused) await this.refuseAfterWrite(outcome.refused, [[key, archived]]);
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

  /** A published audience's entry replaced in the member (an archived one lives in KV only), then its KV record, marked where the member carries it. */
  private async replacePublished(next: AudienceDef, note: string): Promise<void> {
    let outcome: Mutated = { carried: false };
    if (next.status === 'published') {
      const prior = new Map<string, StoredRecord | null>();
      outcome = await this.mutate(note, [next.key], prior, doc => {
        if (!doc.audiences.some(a => a.key === next.key)) return null;
        const ledger: Record<string, string> = { ...doc.ledger };
        supersede(ledger, next.key, prior.get(next.key), false);
        return documentOf(doc.audiences.map(a => a.key === next.key ? next : a), ledger);
      });
    } else {
      // An archived audience lives in KV only; its record is marked where the tenant is moved, plain where it is not.
      outcome = { carried: (await this.fromPublication(true)) !== null };
    }
    try { await this.putRecord(outcome.carried, next.key, next); } finally { this.written(); }
    if (outcome.refused) await this.refuseAfterWrite(outcome.refused, [[next.key, next]]);
  }

  /**
   * The five-minute run's pass for this tenant: a set with no audiences member gets
   * one from the KV records (every page; `move`); a moved tenant's records written after
   * the member's version of their audience (an earlier release's writes during a rolling
   * release, a write made on the KV path) are reconciled into it (`reconcileMoved`), one
   * publication, none when no record is newer. A committed write is never reverted: a run
   * between its commit and its KV put, or reading a stale value, meets a record carrying
   * this release's mark or one the write noted superseded. With `budget`, no call is made
   * past the run's limit, the move's included (R-P713): what a run could not do waits for
   * the next.
   */
  async moveAndReconcile(budget?: { run: RunBudget; capped: { on: boolean } }): Promise<void> {
    if (!hasStorage(this.env)) return;
    if (budget) budget.capped.on = true;
    let pin: PublicationPin;
    try { pin = await pinPublication(this.env, this.tenant); } catch (error) { if (uninitialized(error)) return; throw error; }
    const current = (await readOptionalPinnedPublication(this.env, AUDIENCES_KIND, this.tenant, pin))?.value ?? null;
    const member = movedMember(current);
    if (member) await this.reconcileMoved(member, budget?.run);
    else await this.move(current?.move ?? null, budget?.run);
  }

  /**
   * R-P699: the run reads only the records its list shows without this release's mark, as
   * many as `run` affords (a get and a mark each, PUBLISH_RESERVE kept for one publication),
   * in key order; the rest stay unmarked, so the next run's list resumes there. In steady
   * state it makes the list calls alone. R-P722: a record written on the KV path is among
   * them (it carries no mark); where adopting it would take the member past the bound, the
   * tenant's set no longer fits the member, and the member is published as the refusal, by
   * name with the size measured, so every reader returns to base's KV path.
   */
  private async reconcileMoved(current: AudiencesDocument, run?: RunBudget): Promise<void> {
    const keys = await this.listedKeys(), unmarkedNames = keys.filter(key => !markedInList(key)).map(key => key.name);
    const affordable = run ? Math.max(0, Math.floor((run.limit - run.meter.calls - PUBLISH_RESERVE) / 2)) : unmarkedNames.length;
    const stored = await this.read(unmarkedNames.slice(0, affordable));
    let plan = reconcile(current, stored);
    if (plan.next) {
      const measured = { bytes: documentBytes(plan.next) };
      try {
        if (measured.bytes > PUBLICATION_MAX_BYTES) throw new PublicationError('Publication exceeds 2 MiB', 413, 'document_too_large');
        await this.commit('reconcile', async latest => {
          const member = movedMember(latest);
          if (!member) return null;
          plan = reconcile(member, stored);
          if (plan.next) measured.bytes = documentBytes(plan.next);
          return plan.next;
        });
      } catch (error) {
        if (!tooLarge(error)) throw error;
        await this.commit('reconcile: refused', async latest => movedMember(latest) ? documentOf([], {}, refusalOf(measured.bytes, keys)) : null);
        return;
      }
    }
    await Promise.all([...plan.consistent, ...plan.adopted].map(def => this.putMarked(def.key, def)));
  }

  /**
   * R-P713: the move, within the run's budget, resumed across runs. The run reads the
   * tenant's records in key order, as many as the budget affords (a get each, and a mark
   * for each the list does not show marked; PUBLISH_RESERVE kept for one publication or
   * the progress record), after the key the previous run stopped at; the records read so
   * far are the move's progress (`MOVE_KEY`), and the member is published only once every
   * record is in it, so nothing reads a member that is not the tenant's whole set. Each
   * record is marked once the progress or the member carrying it is written. A set the
   * member cannot carry (past the publication's 2 MiB bound) is refused by name, the size
   * measured and the records it was measured on kept (in the progress record, or in the
   * member where one carries the refusal), so a later run tries again only when the list
   * shows them changed; until then the run costs the list and the progress read.
   *
   * R-P722: before it publishes, or writes its progress, the run lists the records again
   * and writes nothing if those at or before its cursor changed meanwhile (a write landed
   * during the step); the progress carries the records behind its cursor as the list showed
   * them, and a run that finds them changed (or a stale progress) restarts the move.
   */
  private async move(refused: MoveRefusal | null, run?: RunBudget): Promise<void> {
    const keys = await this.listedKeys(), progress = await this.readProgress();
    const refusal = refused ?? (progress?.phase === 'refused' ? progress : null);
    if (refusal && sameRecords(refusal.records, recordsOf(keys))) return;
    // The progress stands only while the records behind its cursor are as it saw them; otherwise the move restarts.
    const standing = progress?.phase === 'moving' && sameRecords(progress.behind, recordsOf(keys, progress.after)) ? progress : null;
    const partial = standing ? standing.audiences : [], after = standing ? standing.after : null;
    const held = new Set(partial.map(a => a.key));
    const candidates = keys.filter(key => (after === null || keyOf(key.name) > after) && !held.has(keyOf(key.name)));
    let room = run ? run.limit - run.meter.calls - PUBLISH_RESERVE : Infinity;
    const batch: ListedKey[] = [];
    for (const key of candidates) { const cost = markedInList(key) ? 1 : 2; if (cost > room) break; room -= cost; batch.push(key); }
    const complete = batch.length === candidates.length;
    if (!complete && !batch.length) return;
    const stored = await this.read(batch.map(key => key.name));
    // A record the list shows marked and this release's own: its mark stands, so no put repeats it.
    const markedBefore = new Set(batch.filter(markedInList).map(key => keyOf(key.name))), own = new Set(stored.filter(isOwn).map(record => record.key));
    let plan = moveInto({ version: 1, audiences: partial }, stored);
    const doc: AudiencesDocument = plan.next ?? { version: 1, audiences: partial };
    const bytes = documentBytes(doc), last = batch.length ? keyOf(batch[batch.length - 1]!.name) : after;
    // R-P722: nothing is written over records that changed during this step; the next run sees them.
    const again = await this.listedKeys();
    if (!sameRecords(recordsOf(again, complete || bytes > PUBLICATION_MAX_BYTES ? undefined : last!), recordsOf(keys, complete || bytes > PUBLICATION_MAX_BYTES ? undefined : last!))) return;
    if (bytes > PUBLICATION_MAX_BYTES) { await this.storeRefusal(refused !== null, refusalOf(bytes, again)); return; }
    let carried = true;
    if (complete) {
      try { carried = await this.commit('move', async latest => movedMember(latest) ? (plan = reconcile(movedMember(latest)!, stored)).next : doc) !== null; }
      catch (error) {
        if (!tooLarge(error)) throw error;
        await this.storeRefusal(refused !== null, refusalOf(bytes, again)); return;
      }
      if (progress) await this.clearProgress();
    } else {
      await this.writeProgress({ version: 1, phase: 'moving', after: last!, behind: recordsOf(keys, last!), audiences: doc.audiences });
    }
    await Promise.all([...plan.consistent, ...(carried ? plan.adopted : [])]
      .filter(def => !(markedBefore.has(def.key) && own.has(def.key)))
      .map(def => this.putMarked(def.key, def)));
  }

  /** The refusal stored where the tenant's refusal lives: in the member where one carries it (R-P722), else in the progress record. */
  private async storeRefusal(inMember: boolean, refusal: MoveRefusal): Promise<void> {
    if (inMember) await this.commit('move: refused', async latest => latest?.move ? documentOf([], {}, refusal) : null);
    else await this.writeProgress({ version: 1, ...refusal });
  }
}

/**
 * R-P699: the five-minute run's budget for one tenant's job: `meter` counts every storage
 * call the job makes (src/index.ts shares it with the folds' `countedStorage`), `limit` is
 * the run's (src/learn/hourly.ts RUN_BUDGET).
 */
export interface RunBudget { meter: { calls: number }; limit: number }
/** Calls kept for one publication of the member (its head, set and member reads and writes, with room for one retry) and the second list. */
const PUBLISH_RESERVE = 40;
/** The run's limit reached: no call is made past it; the run stops and the next resumes. */
class RunBudgetSpent extends Error {}

/**
 * The environment the run's store works through: every KV and object-storage call counted
 * in `run.meter`, and refused past `run.limit` while `capped.on`. The object-storage wrapper
 * is named to its binding (`nameServingStorage`), so the publication treats it as the binding.
 */
function metered(env: Env, run: RunBudget, capped: { on: boolean }): Env {
  const call = <T>(make: () => Promise<T>): Promise<T> => {
    if (capped.on && run.meter.calls >= run.limit) return Promise.reject(new RunBudgetSpent('audience reconciliation: run budget spent'));
    run.meter.calls++;
    return make();
  };
  const kv = env.CACHE as unknown as KVLike;
  const cache: KVLike = {
    get: (key, type) => call(() => kv.get(key, type)),
    put: (key, value, options) => call(() => kv.put(key, value, options)),
    delete: key => call(() => kv.delete(key)),
    list: options => call(() => kv.list(options)),
  };
  const r2 = env.STORAGE as unknown as Record<'get' | 'put' | 'head' | 'list' | 'delete', (...args: unknown[]) => Promise<unknown>>;
  const storage = {
    get: (...args: unknown[]) => call(() => r2.get(...args)),
    put: (...args: unknown[]) => call(() => r2.put(...args)),
    head: (...args: unknown[]) => call(() => r2.head(...args)),
    list: (...args: unknown[]) => call(() => r2.list(...args)),
    delete: (...args: unknown[]) => call(() => r2.delete(...args)),
  };
  nameServingStorage(storage, r2);
  return { ...env, CACHE: cache as unknown as Env['CACHE'], STORAGE: storage as unknown as Env['STORAGE'] };
}

/**
 * The five-minute run (src/index.ts): the tenant's audiences moved into its publication, or
 * reconciled there. With `run`, every call is counted in its meter and none made past its
 * limit, the move's included (R-P713); a run stopped by the limit leaves the rest to the next run.
 */
export async function moveAudiences(env: Env, tenant: TenantId, run?: RunBudget): Promise<void> {
  if (!run || !hasStorage(env)) { await new KvAudienceStore(env, tenant).moveAndReconcile(); return; }
  const capped = { on: false };
  try { await new KvAudienceStore(metered(env, run, capped), tenant).moveAndReconcile({ run, capped }); }
  catch (error) { if (!(error instanceof RunBudgetSpent)) throw error; }
}
