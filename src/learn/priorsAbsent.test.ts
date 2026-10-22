// Lane E2: a tenant whose publication set carries no imported-priors document
// learns, snapshots and publishes exactly as a tenant whose set carries an empty
// one. Before, `LearnStats.priorsFor` read the prior member unguarded, so every
// snapshot and every publication alarm of a demo tenant (whose bootstrap creates
// reflex, catalog, slots and learn, and no prior) threw "Configuration
// publication authority unavailable": `/snapshot` answered 503 and the alarm
// threw and was retried. An authority that cannot be READ still refuses: the
// object never publishes a prior-free replacement because a read failed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types/env';
import { LearnStats } from '@/durable-objects/LearnStats';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { CONTENT_KIND, EMPTY_CATALOG, SLOTS_KIND, DEFAULT_SLOTS, LEARN_KIND, DEFAULT_LEARN } from '@/content/kinds';
import { REFLEX_KIND } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import type { DocumentKind } from '@/config/versionedStore';
import { PRIORS_KIND } from './priors';
import { DEFAULT_STATS, type LiftSnapshot } from './stats';
import { liftKey } from './fan';
import type { Cell } from '@/content/types';

class ObjectStorage { map = new Map<string, unknown>(); alarm: number | null = null;
  async get(k: string) { return structuredClone(this.map.get(k)); } async put(k: string, v: unknown) { this.map.set(k, structuredClone(v)); }
  async delete(k: string) { return this.map.delete(k); }
  async list(options: { prefix?: string } = {}) { return new Map([...this.map].filter(([key]) => key.startsWith(options.prefix ?? ''))); }
  async transaction<T>(work: (storage: ObjectStorage) => Promise<T>): Promise<T> {
    const before = structuredClone(this.map); try { return await work(this); } catch (error) { this.map = before; throw error; }
  }
  async deleteAll() { this.map.clear(); } async getAlarm() { return this.alarm; } async setAlarm(at: number) { this.alarm = at; } }
class KV { store = new Map<string, string>(); async get(k: string, type?: string) { const r = this.store.get(k); return r === undefined ? null : type === 'json' ? JSON.parse(r) : r; } async put(k: string, v: string) { this.store.set(k, v); } }

const TENANT = 'oh', config = { reward: 'click' as const, stats: DEFAULT_STATS };
const cell: Cell = { channel: 'direct', visit_bucket: '1', region: 'US-NC', affinity: 'category:washers' };
const learn = { ...DEFAULT_LEARN, stats: DEFAULT_STATS, slots: { hero: { reward: 'click' as const } } };
const row = (kind: DocumentKind<unknown>, value: unknown): PublicationBaseline => ({ kind, scope: TENANT, revision: { revision: 1, value, actor: 'fixture', note: '', at: 1 } });
const priorKey = 'config-publication/v1/' + TENANT + '/prior/rev/1.json';
/**
 * R10 (S18, amendment 9 P70; the lead's ruling R-P195), test-only. src/durable-objects/LearnStats.ts
 * `const PUBLISH_DELAY_MS = 30_000` (not exported): a publication is due 30 seconds after the write it publishes and
 * never earlier (P70's keep-warm heartbeat shares the object's single alarm), so the alarm that publishes runs then.
 */
const PUBLISH_DELAY_MS = 30_000;
/** Runs `work` (an alarm) at the publication's due time: the clock held PUBLISH_DELAY_MS after now, then restored. */
async function atPublicationDue<T>(work: () => Promise<T>): Promise<T> {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + PUBLISH_DELAY_MS);
  try { return await work(); } finally { clock.mockRestore(); }
}

/** One statistics object over an R2 authority holding the demo bootstrap's four members, and a prior document when given. */
async function rig(priors?: unknown) {
  const configuration = new Map<string, string>(), archives = new Map<string, string>();
  let outage = false;
  const STORAGE = {
    get: async (key: string) => {
      if (outage) throw new Error('Synthetic authority outage');
      const text = configuration.get(key) ?? archives.get(key);
      return text === undefined ? null : { key, etag: 'etag-' + key.length, size: new TextEncoder().encode(text).length, body: new Response(text).body, json: async () => JSON.parse(text) };
    },
    put: async (key: string, text: string, options?: R2PutOptions) => {
      const store = key.startsWith('config-publication/') ? configuration : archives;
      if (options?.onlyIf instanceof Headers && store.has(key)) return null;
      store.set(key, text); return { key, etag: 'etag-' + key.length, size: new TextEncoder().encode(text).length };
    },
  };
  const cache = new KV(), env = { STORAGE, CACHE: cache } as unknown as Env;
  const rows = [row(REFLEX_KIND as DocumentKind<unknown>, DEFAULT_REFLEX_CONFIG), row(CONTENT_KIND as DocumentKind<unknown>, EMPTY_CATALOG),
    row(SLOTS_KIND as DocumentKind<unknown>, DEFAULT_SLOTS), row(LEARN_KIND as DocumentKind<unknown>, learn)];
  if (priors !== undefined) rows.push(row(PRIORS_KIND as DocumentKind<unknown>, priors));
  await initializePublicationSet(env, rows, '0:' + crypto.randomUUID());
  const storage = new ObjectStorage(), object = new LearnStats({ storage } as unknown as DurableObjectState, env);
  const call = (path: string, body?: unknown) => object.fetch(new Request('https://learn' + path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) }));
  const now = Date.now();
  const evidence = async () => {
    const exposures = Array.from({ length: 12 }, (_, i) => ({ item: i % 3 ? 'WM6500HWA' : 'DLEX6500W', cell, ts: now - 1000 + i }));
    expect((await call('/exposures', { tenant: TENANT, brand: TENANT, slot: 'hero', config, exposures })).status).toBe(200);
    const credits = [{ item: 'WM6500HWA', cell, reward: 'click', ts: now, weight: 1 }];
    expect((await call('/credits', { tenant: TENANT, brand: TENANT, slot: 'hero', config, credits })).status).toBe(200);
  };
  return { env, cache, storage, object, call, evidence, configuration, outage: (on: boolean) => { outage = on; } };
}
/** What a snapshot learned, without the instants and the identities that differ run to run. */
const learned = (s: LiftSnapshot) => ({ events: s.events, items: s.items, slotRates: s.slotRates, reward: s.reward, objective: s.objective, measurementBasis: s.measurementBasis });
beforeEach(() => invalidatePublicationCache());
afterEach(() => { vi.restoreAllMocks(); });

describe('E2 a tenant with no imported priors', () => {
  it('snapshots and publishes on a set without a prior member, as no priors (version 0), where it used to answer 503 and throw from the alarm', async () => {
    const f = await rig();
    await f.evidence();
    const answer = await f.call('/snapshot');
    expect(answer.status).toBe(200);
    const { snapshot } = await answer.json() as { snapshot: LiftSnapshot };
    expect(snapshot).toMatchObject({ tenant: TENANT, slot: 'hero', events: 12, priorVersion: 0 });
    expect(Object.keys(snapshot.items).sort()).toEqual(['DLEX6500W', 'WM6500HWA']);
    expect(f.storage.alarm).not.toBeNull();
    await expect(atPublicationDue(() => f.object.alarm())).resolves.toBeUndefined();
    const published = JSON.parse(f.cache.store.get(liftKey(TENANT, TENANT, 'hero'))!) as LiftSnapshot;
    expect(published).toMatchObject({ events: 12, priorVersion: 0 });
    const forced = await (await f.call('/publish', {})).json() as { published: boolean; snapshot: LiftSnapshot };
    expect(forced).toMatchObject({ published: true, snapshot: { priorVersion: 0 } });
  });

  it('learns exactly what the same evidence learns under a published empty prior document', async () => {
    // One instant for both objects: the counters decay in real time, and the comparison is of what was learned.
    const at = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(at);
    const absent = await rig(), empty = await rig({ rows: [] });
    await absent.evidence(); await empty.evidence();
    const a = (await (await absent.call('/snapshot')).json() as { snapshot: LiftSnapshot }).snapshot;
    const b = (await (await empty.call('/snapshot')).json() as { snapshot: LiftSnapshot }).snapshot;
    expect(learned(a)).toEqual(learned(b));
    // The one difference is the prior document's own revision: none, against revision 1 of an empty one.
    expect([a.priorVersion, b.priorVersion]).toEqual([0, 1]);
  });

  it('still refuses, and publishes nothing, when the authority cannot be read: a listed prior member gone from storage, or an outage', async () => {
    const gone = await rig({ rows: [] });
    await gone.evidence();
    gone.configuration.delete(priorKey);
    // Past the serving cache's thirty seconds, as a later alarm would be.
    invalidatePublicationCache();
    const refused = await gone.call('/snapshot');
    expect(refused.status).toBe(503);
    await expect(atPublicationDue(() => gone.object.alarm())).rejects.toThrow();
    expect(gone.cache.store.has(liftKey(TENANT, TENANT, 'hero'))).toBe(false);

    const outage = await rig();
    await outage.evidence();
    outage.outage(true);
    invalidatePublicationCache();
    expect((await outage.call('/snapshot')).status).toBe(503);
    await expect(atPublicationDue(() => outage.object.alarm())).rejects.toThrow();
    expect(outage.cache.store.has(liftKey(TENANT, TENANT, 'hero'))).toBe(false);
  });
});
