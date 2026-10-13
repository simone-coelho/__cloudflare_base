// src/connectors/AudienceStore.ts
// The small persistence seam shared by SegmentProvider (reads) and
// AudienceAuthoring (writes). Because both mock adapters point at the same store,
// an audience created by Opal is immediately qualifiable by ODP — no redeploy.
// See docs/architecture/05-demo-build-spec.md §1.5.

import type { Env } from '@/types/env';
import type { AudienceDef } from './types';
import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';
import { ownerBindingIdentity } from '@/identity/sessionAuthority';

/**
 * Lane E4: a tenant's published audiences, remembered by this isolate for AUDIENCE_LIST_MS.
 *
 * Qualification (`MockSegmentProvider`, on every action and every buffered action) listed the
 * tenant's audience keys and read each one, every time: a KV list is never served from the edge
 * cache, so on a hosted worker it cost a round trip to central storage on every click, most often
 * to learn that the list had not changed. The list is now remembered per backing KV binding
 * (`ownerBindingIdentity`, stable across owner fences) and tenant. A write through any store of
 * this isolate forgets it at once, so an audience published, archived, renamed or pinned here is
 * qualifiable on the next event as before; one written by another isolate is seen within
 * AUDIENCE_LIST_MS, well inside the minute KV itself allows a write to reach every reader.
 * Callers receive copies, never the remembered definitions.
 */
export const AUDIENCE_LIST_MS = 10_000;
interface Listed { at: number; defs: AudienceDef[] }
let listed = new WeakMap<object, { lists: Map<string, Listed>; writes: Map<string, number> }>();
/** Tests: forget every remembered list. */
export function forgetListedAudiences(): void { listed = new WeakMap(); }

export interface AudienceStore {
  listPublished(): Promise<AudienceDef[]>;
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
}

const PREFIX = 'audience:';

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
  /** Lane E4: this isolate's remembered lists for the backing binding, or null where none can be kept. */
  private readonly memory: { lists: Map<string, Listed>; writes: Map<string, number> } | null;

  constructor(private env: Env, readonly tenant: TenantId = DEFAULT_TENANT) {
    this.kv = new TenantKV(env.CACHE as unknown as KVLike, tenant);
    const binding = ownerBindingIdentity(env.CACHE as unknown as object | undefined);
    let memory = binding ? listed.get(binding) : undefined;
    if (binding && !memory) { memory = { lists: new Map(), writes: new Map() }; listed.set(binding, memory); }
    this.memory = memory ?? null;
  }

  async listPublished(): Promise<AudienceDef[]> {
    const held = this.memory?.lists.get(this.tenant), started = Date.now();
    if (held && Number.isFinite(started) && started >= held.at && started - held.at < AUDIENCE_LIST_MS) return structuredClone(held.defs);
    const writes = this.memory?.writes.get(this.tenant) ?? 0;
    const list = await this.kv.list({ prefix: PREFIX });
    const defs: AudienceDef[] = [];
    for (const k of list.keys) {
      const def = (await this.kv.get(k.name, 'json')) as AudienceDef | null;
      if (def && def.status === 'published') defs.push(def);
    }
    // Remembered only when no write through this isolate landed while it was being read.
    if (this.memory && (this.memory.writes.get(this.tenant) ?? 0) === writes) this.memory.lists.set(this.tenant, { at: started, defs: structuredClone(defs) });
    return defs;
  }

  /** Lane E4: a write through this isolate makes its remembered list unusable at once. */
  private written(): void {
    if (!this.memory) return;
    this.memory.writes.set(this.tenant, (this.memory.writes.get(this.tenant) ?? 0) + 1);
    this.memory.lists.delete(this.tenant);
  }

  async publish(def: AudienceDef): Promise<void> {
    const published: AudienceDef = { ...def, status: 'published' };
    try { await this.kv.put(PREFIX + def.key, JSON.stringify(published)); } finally { this.written(); }
  }

  async get(key: string): Promise<AudienceDef | null> {
    return (await this.kv.get(PREFIX + key, 'json')) as AudienceDef | null;
  }

  async seed(defs: AudienceDef[]): Promise<void> {
    for (const def of defs) {
      const existing = await this.kv.get(PREFIX + def.key);
      if (!existing) {
        try { await this.kv.put(PREFIX + def.key, JSON.stringify({ ...def, status: 'published' })); } finally { this.written(); }
      }
    }
  }

  async archive(key: string): Promise<void> {
    const def = await this.get(key);
    if (!def || def.status === 'archived') return;
    try { await this.kv.put(PREFIX + key, JSON.stringify({ ...def, status: 'archived' })); } finally { this.written(); }
  }

  /**
   * Rename. The KEY never moves, because it is load-bearing in cookies, stored
   * decisions and ODP qualification: renaming is a label change, not an identity
   * change, and treating it as one would orphan everything already tagged.
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
    try { await this.kv.put(PREFIX + key, JSON.stringify(next)); } finally { this.written(); }
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
    try { await this.kv.put(PREFIX + key, JSON.stringify(next)); } finally { this.written(); }
    return next;
  }
}
