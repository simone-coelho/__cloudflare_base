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

import type { Env } from '@/types/env';
import type { AudienceDef } from './types';
import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';
import { ownerBindingIdentity } from '@/identity/sessionAuthority';
import type { DocumentKind } from '@/config/versionedStore';
import { PublicationError, pinPublication, publishSet, readOptionalPinnedPublication, type PublicationPin } from '@/config/publication';

/** The member's value: every published audience of the tenant, by key, each once. */
export interface AudiencesDocument { version: 1; audiences: AudienceDef[] }

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
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { version: 1, audiences: [...doc.audiences].sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0) } };
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
/** Canonical text of a definition, for telling a KV record apart from the member's entry. */
const stable = (v: unknown): string => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k])).join(',') + '}' : JSON.stringify(v);

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

  /** Every KV record of the tenant, published and archived: every page of the list followed, then every get issued at once. */
  private async records(): Promise<AudienceDef[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: PREFIX, ...(cursor ? { cursor } : {}) }) as { keys: Array<{ name: string }>; list_complete?: boolean; cursor?: string };
      for (const k of page.keys) names.push(k.name);
      cursor = page.list_complete === false && page.cursor ? page.cursor : undefined;
    } while (cursor);
    const read = await Promise.all(names.map(name => this.kv.get(name, 'json') as Promise<AudienceDef | null>));
    return read.filter((def): def is AudienceDef => !!def);
  }

  /** Lane E4: a write through this isolate makes its remembered list unusable at once. */
  private written(): void {
    if (!this.memory) return;
    this.memory.writes.set(this.tenant, (this.memory.writes.get(this.tenant) ?? 0) + 1);
    this.memory.lists.delete(this.tenant);
  }

  /**
   * One set publication of the member over the current head: `change` receives the
   * current published list (the member, or the KV records where the tenant is not
   * moved yet, which creates the member) and answers the next one, or null for no
   * change. A conflict on the head is retried from a fresh head, at most ATTEMPTS
   * times. A member past the publication's 2 MiB bound is refused 413
   * `document_too_large` by name and nothing changes. Answers false where the tenant
   * has no publication (its write stays a KV write).
   */
  private async mutate(note: string, change: (current: readonly AudienceDef[]) => AudienceDef[] | null): Promise<boolean> {
    if (!hasStorage(this.env)) return false;
    for (let attempt = 1; ; attempt++) {
      let pin: PublicationPin;
      try { pin = await pinPublication(this.env, this.tenant); } catch (error) { if (uninitialized(error)) return false; throw error; }
      const current = await readOptionalPinnedPublication(this.env, AUDIENCES_KIND, this.tenant, pin);
      const base = current ? current.value.audiences : (await this.records()).filter(def => def.status === 'published');
      const next = change(base);
      if (next === null && current) return true;
      const expected = pin.refs[memberKey(this.tenant)]?.revision ?? 0;
      try {
        const result = await publishSet(this.env, [{ kind: AUDIENCES_KIND as DocumentKind<unknown>, scope: this.tenant, request: { note },
          candidate: () => ({ version: 1, audiences: next ?? [...base] }) }],
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
    return (await this.kv.get(PREFIX + key, 'json')) as AudienceDef | null;
  }

  async seed(defs: AudienceDef[]): Promise<void> {
    const have = new Set((await this.fromPublication() ?? []).map(a => a.key));
    const records = await Promise.all(defs.map(def => have.has(def.key) ? 'held' : this.kv.get(PREFIX + def.key)));
    const missing = defs.filter((_, i) => !records[i]);
    if (missing.length) await this.apply(missing.map(def => ({ op: 'publish' as const, def })), true);
  }

  /**
   * Several publishes and archives as one set publication, then each KV record.
   * `onlyNew`: a publish of a key the member already holds is skipped (the seed).
   */
  async apply(changes: AudienceChange[], onlyNew = false): Promise<void> {
    if (!changes.length) return;
    await this.mutate(`audiences: ${changes.length} change(s)`, current => {
      const byKey = new Map(current.map(a => [a.key, a] as const));
      let changed = false;
      for (const c of changes) {
        if (c.op === 'publish') {
          if (onlyNew && byKey.has(c.def.key)) continue;
          byKey.set(c.def.key, { ...c.def, status: 'published' }); changed = true;
        } else if (byKey.delete(c.key)) changed = true;
      }
      return changed ? [...byKey.values()] : null;
    });
    const records: Array<[string, AudienceDef]> = [];
    for (const c of changes) {
      if (c.op === 'publish') records.push([c.def.key, { ...c.def, status: 'published' }]);
      else {
        const def = (await this.kv.get(PREFIX + c.key, 'json')) as AudienceDef | null;
        if (def && def.status !== 'archived') records.push([c.key, { ...def, status: 'archived' }]);
      }
    }
    try { await Promise.all(records.map(([key, def]) => this.kv.put(PREFIX + key, JSON.stringify(def)))); } finally { this.written(); }
  }

  async archive(key: string): Promise<void> {
    const def = await this.get(key);
    if (!def || def.status === 'archived') return;
    await this.mutate('archive ' + key, list => list.some(a => a.key === key) ? list.filter(a => a.key !== key) : null);
    try { await this.kv.put(PREFIX + key, JSON.stringify({ ...def, status: 'archived' })); } finally { this.written(); }
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

  /** A published audience's entry replaced in the member (an archived one lives in KV only), then its KV record. */
  private async replacePublished(next: AudienceDef, note: string): Promise<void> {
    if (next.status === 'published') await this.mutate(note, list => list.some(a => a.key === next.key) ? list.map(a => a.key === next.key ? next : a) : null);
    try { await this.kv.put(PREFIX + next.key, JSON.stringify(next)); } finally { this.written(); }
  }

  /**
   * The five-minute run's pass for this tenant: a set with no audiences member gets
   * one from the KV records (every page); a moved tenant's records that disagree
   * with the member (written by an earlier release after the move: a published
   * record absent or different, an archived record of a member audience) are
   * reconciled into it, one publication, none when nothing disagrees.
   */
  async moveAndReconcile(): Promise<void> {
    if (!hasStorage(this.env)) return;
    let pin: PublicationPin;
    try { pin = await pinPublication(this.env, this.tenant); } catch (error) { if (uninitialized(error)) return; throw error; }
    if (!Object.hasOwn(pin.refs, memberKey(this.tenant))) { await this.mutate('move', () => null); return; }
    const records = await this.records();
    await this.mutate('reconcile', current => {
      const byKey = new Map(current.map(a => [a.key, a] as const));
      let changed = false;
      for (const record of records) {
        const held = byKey.get(record.key);
        if (record.status === 'published' && (!held || stable(held) !== stable(record))) { byKey.set(record.key, record); changed = true; }
        else if (record.status === 'archived' && held) { byKey.delete(record.key); changed = true; }
      }
      return changed ? [...byKey.values()] : null;
    });
  }
}

/** The five-minute run (src/index.ts): the tenant's audiences moved into its publication, or reconciled there. */
export async function moveAudiences(env: Env, tenant: TenantId): Promise<void> {
  await new KvAudienceStore(env, tenant).moveAndReconcile();
}
