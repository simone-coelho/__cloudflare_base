// src/units/W27/B1.unit.test.ts
// W27 batch B1 — replay as the proof that a receipt is the truth: the immutable
// page-wide manifest and archive-before-visible LOCKED, replay parity PROVEN
// under coupled slots, exploration and gamma zero with a REAL archive, explicit
// named failure for a missing, malformed, legacy or removed dependency, rollout
// and retention as mechanism, and the endpoint exercised end to end.
//
// One `describe('unit:W27.<id>')` per unit of batch W27-B1, one `it` per ruled
// leg. Every expected value comes from a witness or from a value the fixture
// itself publishes — never from what the engine happens to return today.
//
// WITNESSES
//   · document 35 §5 row W27 (:429): "Archive dependencies before visibility;
//     immutable page-wide snapshot manifest, choice metadata and
//     dependency-aware pins. Prove replay parity under coupled slots,
//     exploration, gamma zero, archive/write failure, rollout and retention.
//     Missing dependencies fail explicitly rather than silently guessing."
//   · docs/architecture/35-verification-reports/F22.md
//       §2.1 the coupled-slot failure (the first ranked slot on a page always
//         replays; every slot after it is exposed);
//       §2.2 the same failure at γ = 0 through exploration on an earlier slot;
//       §2.3 the permanent archive gap (KV published before the best-effort R2
//         archive, so a served version could never be archived);
//       §4.4 pins stamped with a lift version they never used;
//       §4.5 "Nothing exercises the endpoint";
//       §4.6 the `candidates`-only `equal:false` on a correct served item —
//         "noisy, and hard for a support engineer to triage";
//       §7 the remedy: per-slot versions on every record; the archive for every
//         slot on the page at its recorded version with a missing sibling named
//         by slot and version; R2 before KV with the KV publish skipped on an
//         archive failure and the alarm re-armed; no stamp where the snapshot
//         could not apply; "the multi-slot and γ = 0 cases as the gate".
//   · docs/kit/02-api-reference.md:306-312 — the publisher freezes, archives
//     without overwriting a retained key, validates the acknowledgement, then
//     publishes; `replay: {version:1, exploration:'supported-only', learning,
//     candidateLimit, slots:[{slot,lift,prior}]}`; "Pins/default-arm slots name
//     zero dependencies"; "A present unknown/malformed marker refuses, never
//     selects legacy behavior"; "only a trusted historical replay of an absent
//     policy marker preserves the old seeded sampler"; "Ambiguous archive
//     writes may leave orphan versions" (so no read-back of the archive body is
//     ruled inside `publish()` — the acknowledgement is what is validated).
//   · HANDOFF-2026-09-16 :231 — already delivered: archive before KV, ordered
//     page manifests, dependencies and pins, explicit missing-dependency
//     failure, historical compatibility markers. Open, and therefore NOT ruled
//     here: the actual rollout/retention qualification and the historical
//     missing dependencies (unit W27.P1.01, `no-witness`).
//   · rulings R10, R14, R19 (a `host-internal` leg only where no public route
//     exposes the observable), R21 (a ruled-but-absent member is named),
//     R101, R112(d), R116, R120, R129, R142, R159 (the readings for this batch).
//
// ONE REPRESENTATION, shared by every unit below, so no two units demand
// opposite things of the same fixture:
//
//  (i)   ONE PAGE, ONE WORLD. Every unit in this batch decides the same Coach
//        home page — `merch` (a genuine catalogue pin) → `chero` (the learning
//        slot) → `story` (the coupled later slot) — from the same published
//        catalogue, slots and learn documents at revision 1, with the same
//        cell, the same visitor and the same fixed `NOW`. No unit needs a state
//        another unit forbids.
//  (ii)  THE ARCHIVE IS REAL. Every lift snapshot these units replay from was
//        published by the real `LearnStats` Durable Object through
//        `/exposures` → `/credits` → `/publish` into the fixture's own R2, and
//        is read back through the real `replayDeps(env)`. No unit injects a
//        snapshot object into `ReplayDeps.archive`; F22 §4.3 is explicit that
//        the one-slot test with `archive: async () => null` proves nothing.
//  (iii) THE MANIFEST IS THE RECORD'S OWN. `inputs.replay` names every slot of
//        the page in page order with the identity that slot's snapshot had when
//        the page was decided; a pin or a slot with no ranked capacity names
//        `lift: 0, prior: 0`, and `versions.lift/prior` on such a record are 0
//        (F22 §4.4). Units W27.M1.01, W27.R1.01, W27.F1.01, W27.O1.01 and
//        W27.E1.01 all read that same shape.
//  (iv)  A REFUSAL NAMES ITS CAUSE. `ok:false` always carries a `reason` that
//        names the dependency (slot and version) or the manifest clause that
//        refused. The two absent members this batch rules by name are listed in
//        the units that demand them; everything else here is a lock.

import { describe, it, expect } from 'vitest';

import { initializePublicationSet, invalidatePublicationCache, pinPublication, publishSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { decideContent } from '@/content/decide';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog, SlotStrategy } from '@/content/types';
import { HISTORICAL_CONTENT_TYPES } from '@/content/typeAffinity';
import { LearnStats } from '@/durable-objects/LearnStats';
import { HISTORICAL_EXPLORATION } from '@/learn/explore';
import { liftArchiveKey, liftKey, statsName } from '@/learn/fan';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { replayDecision, replayDeps, type ReplayDeps, type ReplayResult } from '@/learn/replay';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import { HISTORICAL_GOVERNANCE, HISTORICAL_GOVERNANCE_V1, HISTORICAL_PINS, HISTORICAL_PINS_V1 } from '@/reflex/contentCompose';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RetentionUnavailable, type RetentionCategory, type RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture (docs/architecture/tapestry_requirements.txt A.3.6 and
// docs/architecture/18-content-affinity-engine.md): Coach editorial content
// tagged by line/occasion/category, including a CROSS-CATEGORY piece and a
// piece whose taxonomy the engine does not know. Both are part of the page,
// not an afterthought: F22 §4.2 measured the defect on the launch brand's own
// catalogue, where 21 of 26 pieces are eligible for more than one slot.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
/** Every slot of the page is eligible for every piece: that is what couples them. */
const SLOT_TYPES = ['merch', 'chero', 'story'];

const piece = (id: string, tags: Record<string, string[]>, over: Partial<ContentPiece> = {}): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags, slotTypes: SLOT_TYPES, lifecycle: { status: 'live' }, ...over,
});

const PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening', { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] }),
  // Cross-category: the same piece sits in Small Leather Goods and Handbags.
  piece('cnt-charms-slg', { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'], contentType: ['lookbook'] }),
  piece('cnt-rogue-work', { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] }),
  // Unknown taxonomy: a dimension and a value no published weight names.
  piece('cnt-unknown-signal', { occasion: ['wombat-unrecognized'], category: ['Unknown'] }),
  piece('cnt-merch-pin', { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'] }),
];

const CATALOGUE = { version: 'w27-b1-coach-catalogue', pieces: PIECES };

/**
 * The page F22 §2.1 and §2.4 describe, at its smallest honest size: a genuine
 * catalogue pin first (which must name ZERO dependencies), the learning slot
 * next, and one slot AFTER it — the position the finding proves is exposed,
 * because `contentCompose`'s `used` set is page-wide.
 */
const PAGE: SlotStrategy[] = [
  { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'cnt-merch-pin' },
  { slot: 'chero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  { slot: 'story', take: 1, weights: { occasion: 0.35, line: 0.25 } },
];
const SLOTS: SlotCatalog = { version: 'w27-b1-coach-slots', pages: { home: PAGE } };

/** The shopper's affinity, and the cell every fixture decision and every published count carries. */
const AFFINITY = { occasion: { evening: 0.8, work: 0.1 }, line: { Tabby: 0.7, Rogue: 0.2 } };
const CELL = { channel: 'direct', visit_bucket: '1' as const, stage: 'mid' as const, region: 'US-NY', affinity: 'occasion:evening' };
const VISITOR = 'vis-w27-b1';

/**
 * The published learn document. `chero` learns at γ = 1 (the ordinary success
 * case of the learning layer, F22 §2.4) or at γ = 0 with rotation (F22 §2.2);
 * `story` carries a snapshot it does not weight, which is exactly the dependency
 * a later slot must still be able to name.
 */
interface LearnFixture { gamma?: number; exploration?: { mode: 'rotation'; share: number; floor: number } }
const learnDocument = (f: LearnFixture = {}) => ({
  holdout: { share: 0, salt: 'w27-b1', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  stats: DEFAULT_STATS,
  slots: {
    chero: { reward: 'click', objective: 'unit', gamma: f.gamma ?? 1, ...(f.exploration ? { exploration: f.exploration } : {}) },
    story: { reward: 'click', objective: 'unit', gamma: 0 },
  },
});

/** The configuration the statistics owner is told about; it must match the published document exactly. */
const SLOT_CONFIG = { reward: 'click' as const, objective: 'unit' as const, stats: DEFAULT_STATS };

/**
 * A fixed decision time, five minutes in the past: `explorationPick` seeds its
 * bucket from `hourKeyOf(nowMs)` and the retention birth is the record's own
 * `ts`, so nothing here may depend on the wall clock at assertion time.
 */
const NOW = Date.now() - 5 * 60_000;

// ===========================================================================
// The stores, the real statistics object and the published documents. Harness
// pattern reused from `src/units/W21/B3.unit.test.ts` and
// `src/content/consent.test.ts`; neither suite is imported or edited here.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v;
  }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

/**
 * The object store, with the conditional put R2 gives (`If-None-Match: *`, the
 * one the publisher uses so a retained archive key is never overwritten), a
 * recorded write log so a unit can assert the ORDER of the archive and the live
 * publication, and two fault hooks: `failPut` makes one write fail the way a
 * transport failure does, `failGet` makes a read throw (which is NOT the same
 * event as an object being absent).
 */
class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  reads: string[] = [];
  failPut: ((key: string) => boolean) | null = null;
  failGet: ((key: string) => boolean) | null = null;
  async get(key: string) {
    this.reads.push(key);
    if (this.failGet?.(key)) throw new Error('synthetic object-store read failure');
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw);
    return { key, etag: 'v' + this.versions.get(key), size: bytes.length,
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    if (this.failPut?.(key)) throw new Error('synthetic object-store write failure');
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    if (absent && old !== null) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number; startAfter?: string } = {}) {
    const all = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '') && (options.startAfter === undefined || k > options.startAfter)).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: all.slice(start, end).map(key => ({ key, size: (this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < all.length, ...(end < all.length ? { cursor: String(end) } : {}) };
  }
}

const fixturePolicy: RetentionPolicy = { id: 'w27-b1-fixture-policy', revision: 1, durationMs: 365 * 86_400_000, basis: 'occurred', renewal: 'new-record-only' };
const retentionFor = (policy: RetentionPolicy) => JSON.stringify({ version: 1, tenants: { [TENANT]:
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, policy])) as Record<RetentionCategory, RetentionPolicy> } });

interface World {
  env: Env;
  storage: UnitR2;
  cache: UnitKV;
  /** Every durable write, in order: `archive <key>` for R2, `live <key>` for KV. */
  writes: string[];
  objects: Map<string, LearnStats>;
  alarms: Map<string, number | null>;
  /** Drive the real statistics object the way the fan-out and the operator do. */
  learn: (slot: string, path: string, body?: unknown) => Promise<Response>;
  /** Publish a slot's snapshot through the real object and return the published snapshot. */
  publish: (slot: string) => Promise<LiftSnapshot>;
}

/**
 * The published world: the tenant's four documents at revision 1, and one real
 * `LearnStats` object per learning slot bound to the same R2 and KV the replay
 * reads. Nothing here is a stand-in for the engine: only the Durable Object
 * *platform* (storage, alarms) is synthetic.
 */
async function world(learn: LearnFixture = {}): Promise<World> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const storage = new UnitR2(), cache = new UnitKV();
  const writes: string[] = [];
  const objects = new Map<string, LearnStats>();
  const alarms = new Map<string, number | null>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    STORAGE: storage, CACHE: cache,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    RETENTION: retentionFor(fixturePolicy),
  } as unknown as Env;

  // The write log wraps the two bindings the publisher uses, so a unit can
  // assert that the immutable archive is durable BEFORE the live key moves.
  const rawPut = storage.put.bind(storage);
  storage.put = async (key: string, raw: string, options?: R2PutOptions) => {
    const result = await rawPut(key, raw, options);
    if (key.startsWith('lift/') && result) writes.push(`archive ${key}`);
    return result;
  };
  const rawCachePut = cache.put.bind(cache);
  cache.put = async (key: string, value: string) => { writes.push(`live ${key}`); return rawCachePut(key, value); };

  env.LEARN_STATS = {
    idFromName: (name: string) => name,
    get: (name: string) => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      let object = objects.get(name);
      if (!object) {
        const data = new Map<string, unknown>();
        const state = { id: name, storage: {
          get: async (key: string) => structuredClone(data.get(key)),
          put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); },
          delete: async (key: string) => data.delete(key),
          deleteAll: async () => data.clear(),
          list: async () => structuredClone(data),
          getAlarm: async () => alarms.get(name) ?? null,
          setAlarm: async (at: number) => { alarms.set(name, at); },
          deleteAlarm: async () => { alarms.set(name, null); },
        } } as unknown as DurableObjectState;
        object = new LearnStats(state, env); objects.set(name, object);
      }
      return object.fetch(new Request(input, init));
    } }),
  } as unknown as DurableObjectNamespace;

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w27-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, CATALOGUE),
    baseline(SLOTS_KIND, SLOTS),
    baseline(LEARN_KIND, learnDocument(learn)),
    baseline(PRIORS_KIND, EMPTY_PRIORS),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const call = (slot: string, path: string, body: unknown = {}) =>
    (env.LEARN_STATS as unknown as { get: (name: string) => { fetch: (input: string, init: RequestInit) => Promise<Response> } })
      .get(statsName(TENANT, BRAND, slot))
      .fetch('https://learn' + path, { method: 'POST', body: JSON.stringify(body) });

  const publish = async (slot: string): Promise<LiftSnapshot> => {
    const response = await call(slot, '/publish');
    expect(response.status, `the ${slot} snapshot must publish: ${await response.clone().text()}`).toBe(200);
    const body = await response.json() as { ok: boolean; snapshot: LiftSnapshot };
    expect(body.ok).toBe(true);
    return body.snapshot;
  };

  return { env, storage, cache, writes, objects, alarms, learn: call, publish };
}

/** The evidence a slot has observed, through the real ingestion path. */
async function observe(w: World, slot: string, rows: Array<{ item: string; exposures: number; clicks: number }>): Promise<void> {
  const owner = { tenant: TENANT, brand: BRAND, slot, config: SLOT_CONFIG };
  for (const row of rows) {
    const exposures = await w.learn(slot, '/exposures', { ...owner, exposures: Array.from({ length: row.exposures }, () => ({ item: row.item, cell: CELL, ts: NOW })) });
    expect(exposures.status, `${slot}/${row.item} exposures: ${await exposures.clone().text()}`).toBe(200);
    if (!row.clicks) continue;
    const credits = await w.learn(slot, '/credits', { ...owner, credits: Array.from({ length: row.clicks }, () => ({ item: row.item, cell: CELL, ts: NOW, reward: 'click', weight: 1 })) });
    expect(credits.status, `${slot}/${row.item} credits: ${await credits.clone().text()}`).toBe(200);
  }
}

type Historical = [unknown?, unknown?, unknown?, unknown?];

/**
 * The page, decided the way the service decides it, from the snapshots the real
 * object published. The four trailing arguments are the compatibility markers
 * (rollout): `undefined` means the CURRENT policy, and each named constant
 * means the policy a retained record was decided under.
 */
function decidePage(w: World, snapshots: Record<string, LiftSnapshot | null>, over: {
  arm?: 'personalized' | 'default' | 'no_learning'; learning?: boolean; gamma?: number;
  exploration?: { mode: 'rotation'; share: number; floor: number } | null; historical?: Historical;
} = {}): DecisionRecord[] {
  const gamma = over.gamma ?? 1;
  const [exploration, pins, contentTypes, governance] = over.historical ?? [];
  const set = decideContent({
    tenant: TENANT, brand: BRAND, page: 'home', visitorId: VISITOR, sessionId: 's-w27', identityAnchor: 'visitor',
    nowMs: NOW, pieces: PIECES, slots: PAGE, affinity: { dims: AFFINITY }, cell: CELL,
    arm: over.arm ?? 'personalized', versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 },
    configLabel: 'w27-b1', candidateLimit: 10,
    learning: over.learning === false ? null : {
      snapshots,
      gammaOf: (slot: string) => (slot === 'chero' ? gamma : 0),
      exploreOf: (slot: string) => (slot === 'chero' ? over.exploration ?? null : null),
      metadataOf: () => ({ reward: 'click', objective: 'unit', measurementBasis: 'served-v1' }),
    },
  } as unknown as Parameters<typeof decideContent>[0],
  exploration as Parameters<typeof decideContent>[1], pins as Parameters<typeof decideContent>[2],
  contentTypes as Parameters<typeof decideContent>[3], governance as Parameters<typeof decideContent>[4]);
  for (const record of set.records) record.retention = captureRetention(w.env, TENANT, record.ts);
  return set.records;
}

const recordFor = (records: DecisionRecord[], slot: string): DecisionRecord => {
  const found = records.find(record => record.slot === slot);
  expect(found, `the page must have decided ${slot}`).toBeDefined();
  return structuredClone(found!);
};

/** The real dependency reader, with the archive keys it was asked for recorded. */
function trackedDeps(w: World): ReplayDeps & { archives: string[] } {
  const real = replayDeps(w.env), archives: string[] = [];
  return { doc: real.doc, archives, archive: async (tenant, brand, slot, version) => { archives.push(`${slot}/${version}`); return real.archive(tenant, brand, slot, version); } };
}

// ===========================================================================
// unit:W27.M1.01 — the immutable manifest and archive-before-visible, LOCKED.
//
// Reading R159(a): the forward mechanism EXISTS. This unit is the regression
// lock on it, measured through the exported decision function and through the
// real Durable Object class, with its reversing lines named on the row.
// ===========================================================================

describe('unit:W27.M1.01', () => {
  it('logic: every record of the page carries the ordered per-slot manifest, and the pin and the default arm name zero dependencies', async () => {
    const w = await world();
    await observe(w, 'chero', [{ item: 'cnt-charms-slg', exposures: 100, clicks: 90 }, { item: 'cnt-tabby-evening', exposures: 100, clicks: 1 },
      { item: 'cnt-rogue-work', exposures: 100, clicks: 1 }, { item: 'cnt-unknown-signal', exposures: 100, clicks: 1 }]);
    await observe(w, 'story', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 5 }]);
    const chero = await w.publish('chero'), story = await w.publish('story');
    const snapshots = { chero, story };
    const records = decidePage(w, snapshots);

    // (iii) The manifest is the page, in page order, at the identities the
    // snapshots had when it was decided (kit :310, F22 §7.1).
    const expected = { version: 1, exploration: 'supported-only', pins: 'prefix-reserved-v2', contentTypes: 'catalog-tags-v1',
      governance: 'slot-gates-v2', learning: true, candidateLimit: 10,
      slots: [{ slot: 'merch', lift: 0, prior: 0 }, { slot: 'chero', lift: chero.version, prior: chero.priorVersion ?? 0 },
        { slot: 'story', lift: story.version, prior: story.priorVersion ?? 0 }] };
    expect(records.map(record => record.slot)).toEqual(['merch', 'chero', 'story']);
    for (const record of records) expect(record.inputs!.replay, `${record.slot} carries the whole page`).toEqual(expected);

    // F22 §4.4: a decision learning could not have touched is not stamped with
    // a lift version it never used.
    const pin = recordFor(records, 'merch');
    expect(pin).toMatchObject({ authority: 'pin', item_id: 'cnt-merch-pin', versions: { lift: 0, prior: 0 } });
    // ...and the slots that did learn carry their own snapshot's identity.
    expect(recordFor(records, 'chero').versions).toMatchObject({ lift: chero.version, prior: chero.priorVersion ?? 0 });
    expect(recordFor(records, 'story').versions).toMatchObject({ lift: story.version, prior: story.priorVersion ?? 0 });

    // Kit :310 — "Pins/default-arm slots name zero dependencies".
    const held = decidePage(w, snapshots, { arm: 'default' });
    expect(held.map(record => record.inputs!.replay!.learning)).toEqual([false, false, false]);
    for (const record of held) expect(record.inputs!.replay!.slots).toEqual([{ slot: 'merch', lift: 0, prior: 0 },
      { slot: 'chero', lift: 0, prior: 0 }, { slot: 'story', lift: 0, prior: 0 }]);
    for (const record of held) expect(record.versions).toMatchObject({ lift: 0, prior: 0 });
  });

  it('host-internal: the real statistics object archives before it publishes, and an archive failure publishes nothing and re-arms the alarm', async () => {
    // R19: no public route exposes the ORDER of the two durable writes or the
    // alarm the failure path leaves behind; the residual on the row names it.
    const w = await world();
    const name = statsName(TENANT, BRAND, 'chero');
    await observe(w, 'chero', [{ item: 'cnt-charms-slg', exposures: 100, clicks: 90 }, { item: 'cnt-tabby-evening', exposures: 100, clicks: 1 }]);

    // F22 §7.3: R2 before KV, and the live key carries exactly the archived bytes.
    const first = await w.publish('chero');
    const firstKey = liftArchiveKey(TENANT, BRAND, 'chero', first.version);
    expect(w.writes.filter(entry => entry.startsWith('archive lift/') || entry.startsWith('live lift:')))
      .toEqual([`archive ${firstKey}`, `live ${liftKey(TENANT, BRAND, 'chero')}`]);
    expect(w.storage.objects.get(firstKey)).toBe(w.cache.data.get(liftKey(TENANT, BRAND, 'chero')));
    expect(JSON.parse(w.storage.objects.get(firstKey)!)).toMatchObject({ tenant: TENANT, brand: BRAND, slot: 'chero', version: first.version });

    // A served version is always replayable from its archive (F22 §2.3 is the
    // permanent loss this order removes).
    expect(await replayDeps(w.env).archive(TENANT, BRAND, 'chero', first.version)).toEqual(first);

    // More evidence, then a publication whose ARCHIVE write fails.
    await observe(w, 'chero', [{ item: 'cnt-charms-slg', exposures: 100, clicks: 95 }]);
    const liveBefore = w.cache.data.get(liftKey(TENANT, BRAND, 'chero'));
    w.writes.length = 0;
    w.storage.failPut = key => key.startsWith('lift/');
    const startedAt = Date.now();
    const failed = await w.learn('chero', '/publish');
    const finishedAt = Date.now();
    w.storage.failPut = null;
    expect(failed.status, 'an unarchivable snapshot is not a publication').toBe(503);
    // Nothing was made visible: the live key still holds the previous archived body.
    expect(w.writes.filter(entry => entry.startsWith('live '))).toEqual([]);
    expect(w.cache.data.get(liftKey(TENANT, BRAND, 'chero'))).toBe(liveBefore);
    // ...and the quiet slot does not stall: the failure path re-arms the alarm
    // 30 seconds out (`PUBLISH_DELAY_MS`, LearnStats.ts:21), so the next alarm
    // retries the publication without waiting for another event.
    const rearmed = w.alarms.get(name);
    expect(typeof rearmed, 'the failure path leaves an alarm behind').toBe('number');
    expect(rearmed!).toBeGreaterThanOrEqual(startedAt + 30_000);
    expect(rearmed!).toBeLessThanOrEqual(finishedAt + 30_000);

    // The retry publishes a NEW version, and the retained archive is untouched
    // (the publisher never overwrites a retained key, kit :309).
    const second = await w.publish('chero');
    expect(second.version).toBeGreaterThan(first.version);
    expect(await replayDeps(w.env).archive(TENANT, BRAND, 'chero', first.version)).toEqual(first);
    expect(await replayDeps(w.env).archive(TENANT, BRAND, 'chero', second.version)).toEqual(second);
    expect(w.cache.data.get(liftKey(TENANT, BRAND, 'chero'))).toBe(w.storage.objects.get(liftArchiveKey(TENANT, BRAND, 'chero', second.version)));
  });
});

// ===========================================================================
// unit:W27.R1.01 — replay parity PROVEN on the coupled page, with a real
// archive, at γ = 1 and at γ = 0 through exploration (F22 §2.1, §2.2, §7.5).
// ===========================================================================

describe('unit:W27.R1.01', () => {
  it('logic: the later slot of a coupled page replays equal from the real archive, at gamma one and at gamma zero through rotation', async () => {
    // ---- γ = 1: the earlier slot's lift flips the earlier pick (F22 §2.1) ----
    const lifted = await world();
    await observe(lifted, 'chero', [{ item: 'cnt-charms-slg', exposures: 100, clicks: 90 }, { item: 'cnt-tabby-evening', exposures: 100, clicks: 1 },
      { item: 'cnt-rogue-work', exposures: 100, clicks: 1 }, { item: 'cnt-unknown-signal', exposures: 100, clicks: 1 }]);
    await observe(lifted, 'story', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 5 }]);
    const snapshots = { chero: await lifted.publish('chero'), story: await lifted.publish('story') };

    // The coupling is real, not assumed: without the lift the base affinity
    // orders Tabby first, so `chero` takes it and `story` gets the runner-up;
    // with the lift `chero` takes the runner-up and `story` takes Tabby.
    const base = decidePage(lifted, {}, { learning: false });
    expect([recordFor(base, 'chero').item_id, recordFor(base, 'story').item_id]).toEqual(['cnt-tabby-evening', 'cnt-charms-slg']);
    const served = decidePage(lifted, snapshots);
    expect([recordFor(served, 'chero').item_id, recordFor(served, 'story').item_id]).toEqual(['cnt-charms-slg', 'cnt-tabby-evening']);
    expect(recordFor(served, 'chero').explain.lift!.lift).toBeGreaterThan(1);

    // F22 §7.5, the gate: the LATER slot replays equal, from the real archive.
    const later = recordFor(served, 'story');
    const deps = trackedDeps(lifted);
    const replay = await replayDecision(lifted.env, later, deps);
    expect(replay, replay.reason).toMatchObject({ ok: true, equal: true, diff: [] });
    expect(replay.replayed!.item_id).toBe('cnt-tabby-evening');
    // It replayed because it ASKED for the sibling: the earlier slot's archive
    // at the earlier slot's recorded version, then its own.
    expect(deps.archives).toEqual([`chero/${snapshots.chero.version}`, `story/${snapshots.story.version}`]);
    expect(replay.used).toMatchObject({ catalog: 1, slots: 1, learn: 1, lift: snapshots.story.version, prior: snapshots.story.priorVersion ?? 0 });
    // The pin ahead of them both replays too, and reads no archive at all.
    const pinDeps = trackedDeps(lifted);
    expect(await replayDecision(lifted.env, recordFor(served, 'merch'), pinDeps)).toMatchObject({ ok: true, equal: true, diff: [] });
    expect(pinDeps.archives).toEqual([]);

    // ---- γ = 0: the exploration channel on the earlier slot (F22 §2.2) ----
    const shadow = await world({ gamma: 0, exploration: { mode: 'rotation', share: 1, floor: 50 } });
    await observe(shadow, 'chero', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 1 }, { item: 'cnt-rogue-work', exposures: 100, clicks: 1 },
      { item: 'cnt-unknown-signal', exposures: 100, clicks: 1 }, { item: 'cnt-charms-slg', exposures: 1, clicks: 0 }]);
    await observe(shadow, 'story', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 5 }]);
    const shadowSnapshots = { chero: await shadow.publish('chero'), story: await shadow.publish('story') };
    const explored = decidePage(shadow, shadowSnapshots, { gamma: 0, exploration: { mode: 'rotation', share: 1, floor: 50 } });
    // Shadow mode is the pilot default and the lift channel is inert; the
    // earlier slot still moves, through rotation, and the later slot inherits it.
    expect(recordFor(explored, 'chero')).toMatchObject({ item_id: 'cnt-charms-slg', explored: true, explain: { exploration: { mode: 'rotation' } } });
    expect(recordFor(explored, 'story').item_id).toBe('cnt-tabby-evening');
    const shadowDeps = trackedDeps(shadow);
    const shadowReplay = await replayDecision(shadow.env, recordFor(explored, 'story'), shadowDeps);
    expect(shadowReplay, shadowReplay.reason).toMatchObject({ ok: true, equal: true, diff: [] });
    expect(shadowDeps.archives).toEqual([`chero/${shadowSnapshots.chero.version}`, `story/${shadowSnapshots.story.version}`]);
    // The exploration the replay reproduced is the one that happened, not an invented one.
    const shadowChero = await replayDecision(shadow.env, recordFor(explored, 'chero'), replayDeps(shadow.env));
    expect(shadowChero, shadowChero.reason).toMatchObject({ ok: true, equal: true, diff: [] });
    expect(shadowChero.replayed!.explored).toBe(true);
  });

  it('logic: an absent exploration marker replays the seeded historical sampler, and a present unknown marker refuses', async () => {
    const w = await world({ gamma: 0, exploration: { mode: 'rotation', share: 1, floor: 50 } });
    await observe(w, 'chero', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 1 }, { item: 'cnt-rogue-work', exposures: 100, clicks: 1 },
      { item: 'cnt-unknown-signal', exposures: 100, clicks: 1 }, { item: 'cnt-charms-slg', exposures: 1, clicks: 0 }]);
    await observe(w, 'story', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 5 }]);
    const snapshots = { chero: await w.publish('chero'), story: await w.publish('story') };

    // Kit :310 — "only a trusted historical replay of an ABSENT policy marker
    // preserves the old seeded sampler". A record decided before the marker
    // existed carries no `exploration` member and replays under that sampler.
    const retained = decidePage(w, snapshots, { gamma: 0, exploration: { mode: 'rotation', share: 1, floor: 50 },
      historical: [HISTORICAL_EXPLORATION, HISTORICAL_PINS, HISTORICAL_CONTENT_TYPES, HISTORICAL_GOVERNANCE] });
    const legacy = recordFor(retained, 'story');
    expect(Object.prototype.hasOwnProperty.call(legacy.inputs!.replay!, 'exploration')).toBe(false);
    const legacyReplay = await replayDecision(w.env, legacy, replayDeps(w.env));
    expect(legacyReplay, legacyReplay.reason).toMatchObject({ ok: true, equal: true, diff: [] });

    // "A present unknown/malformed marker refuses, never selects legacy behavior."
    for (const marker of ['thompson-seeded-v0', 'supported-only-v2', '', null]) {
      const forged = structuredClone(recordFor(decidePage(w, snapshots, { gamma: 0 }), 'story'));
      (forged.inputs!.replay as unknown as Record<string, unknown>).exploration = marker;
      const refused = await replayDecision(w.env, forged, replayDeps(w.env));
      expect(refused, JSON.stringify(marker)).toMatchObject({ ok: false, equal: false, replayed: null, reason: 'invalid page replay manifest' });
    }
  });
});

// ===========================================================================
// unit:W27.F1.01 — explicit failure, never a guess (document 35 §5 W27:
// "Missing dependencies fail explicitly rather than silently guessing").
//
// THE MEMBER THIS UNIT RULES BY NAME (R21): none. It rules one BEHAVIOUR that
// is absent — an object-store read that FAILS is not evidence that the archive
// is absent, and the two must not share one reason. The reason string for the
// failed read already exists in the engine (`src/learn/replay.ts:205`,
// `lift dependency <slot>/<version> could not be read`) and is unreachable
// today because `replayDeps(env).archive` swallows the error and returns null
// (`replay.ts:76`), so a transport failure is reported as a permanent absence.
// ===========================================================================

describe('unit:W27.F1.01', () => {
  it('logic: a missing sibling archive is named by slot and version, a malformed identity is refused before any read, and a legacy multi-slot record is refused by name', async () => {
    const w = await world();
    await observe(w, 'chero', [{ item: 'cnt-charms-slg', exposures: 100, clicks: 90 }, { item: 'cnt-tabby-evening', exposures: 100, clicks: 1 }]);
    await observe(w, 'story', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 5 }]);
    const snapshots = { chero: await w.publish('chero'), story: await w.publish('story') };
    const served = decidePage(w, snapshots);
    const later = recordFor(served, 'story');

    // F22 §7.2: the sibling the page depends on is named by SLOT and VERSION.
    const cheroKey = liftArchiveKey(TENANT, BRAND, 'chero', snapshots.chero.version);
    const retained = w.storage.objects.get(cheroKey)!;
    w.storage.objects.delete(cheroKey);
    const missing = await replayDecision(w.env, later, replayDeps(w.env));
    expect(missing).toMatchObject({ ok: false, equal: false, replayed: null, used: null,
      reason: `lift dependency chero/${snapshots.chero.version} is not in the archive` });
    // ...and nothing was reconstructed in its place.
    expect(missing.diff).toEqual([]);
    w.storage.objects.set(cheroKey, retained);

    // The same page, with a malformed recorded identity: refused before ANY
    // dependency read (kit :312, "before dependency reads").
    for (const lift of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      const forged = structuredClone(later);
      (forged.versions as unknown as Record<string, unknown>).lift = lift;
      w.storage.reads.length = 0;
      const refused = await replayDecision(w.env, forged, replayDeps(w.env));
      expect(refused, JSON.stringify(lift)).toMatchObject({ ok: false, equal: false, reason: 'invalid replay versions tuple' });
      expect(w.storage.reads.filter(key => key.startsWith('lift/')), JSON.stringify(lift)).toEqual([]);
    }

    // A personalized multi-slot record with no manifest cannot be reconstructed
    // and says so by name (kit :310, "Absent legacy personalized multi-slot
    // manifests refuse").
    const orphan = structuredClone(later);
    delete orphan.inputs!.replay;
    expect(await replayDecision(w.env, orphan, replayDeps(w.env))).toMatchObject({ ok: false, equal: false,
      reason: 'legacy personalized multi-slot record has no page replay manifest' });
  });

  it('logic: an archive whose read fails is reported as unreadable, never as absent, through the real dependency reader', async () => {
    const w = await world();
    await observe(w, 'chero', [{ item: 'cnt-charms-slg', exposures: 100, clicks: 90 }, { item: 'cnt-tabby-evening', exposures: 100, clicks: 1 }]);
    await observe(w, 'story', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 5 }]);
    const snapshots = { chero: await w.publish('chero'), story: await w.publish('story') };
    const later = recordFor(decidePage(w, snapshots), 'story');
    const cheroKey = liftArchiveKey(TENANT, BRAND, 'chero', snapshots.chero.version);

    // Control: with the store healthy the page replays.
    expect(await replayDecision(w.env, later, replayDeps(w.env))).toMatchObject({ ok: true, equal: true });

    // Control: an archive that is genuinely gone keeps the sentence that says
    // so — the two diagnoses below must stay distinct from this one.
    const retained = w.storage.objects.get(cheroKey)!;
    w.storage.objects.delete(cheroKey);
    expect(await replayDecision(w.env, later, replayDeps(w.env))).toMatchObject({ ok: false,
      reason: `lift dependency chero/${snapshots.chero.version} is not in the archive` });
    w.storage.objects.set(cheroKey, retained);

    // The object store FAILS on that key. The archive exists; the engine could
    // not read it. Reporting a permanent absence here is a guess, and it is the
    // sentence a support engineer acts on.
    w.storage.failGet = key => key === cheroKey;
    const unreadable = await replayDecision(w.env, later, replayDeps(w.env));
    w.storage.failGet = null;
    expect(unreadable).toMatchObject({ ok: false, equal: false, replayed: null,
      reason: `lift dependency chero/${snapshots.chero.version} could not be read` });
    expect(JSON.stringify(unreadable)).not.toContain('synthetic object-store read failure');

    // An archived body that cannot be parsed is the same event: unreadable, not absent.
    w.storage.objects.set(cheroKey, '{"tenant":"coach",');
    const malformed = await replayDecision(w.env, later, replayDeps(w.env));
    w.storage.objects.set(cheroKey, retained);
    expect(malformed).toMatchObject({ ok: false, equal: false, replayed: null,
      reason: `lift dependency chero/${snapshots.chero.version} could not be read` });
  });
});

// ===========================================================================
// unit:W27.O1.01 — rollout and retention as MECHANISM.
//
// THE MEMBER THIS UNIT RULES BY NAME (R21): the refusal sentence for a manifest
// version this build does not implement —
//   `page replay manifest version <n> is not supported`
// — distinct from the existing `invalid page replay manifest`, which stays the
// answer for every malformed manifest AT a supported version. Rollout is only a
// mechanism if a record written by a newer build is refused for a reason that
// names the version rather than pooled with a corrupt manifest.
//
// R10 COLLISION (for the lead, before any build): `src/learn/phase3.test.ts:455`
// puts `{ ...manifest, version: 2 }` in the `invalid` list whose loop asserts
// `reason: 'invalid page replay manifest'` (`:461-463`).
//
// NOT RULED (the witness's own remedy): no code path in this repository prunes
// a lift archive, so "the replay names the prune" has nothing to name. What is
// locked instead is the reconciliation that does exist: the archive outlives
// the record, and a record past its own retention horizon is refused before any
// dependency is read.
// ===========================================================================

describe('unit:W27.O1.01', () => {
  it('host-internal: a record replays under the compatibility markers it was written with, and an unsupported manifest version is refused by name', async () => {
    const w = await world();
    await observe(w, 'chero', [{ item: 'cnt-charms-slg', exposures: 100, clicks: 90 }, { item: 'cnt-tabby-evening', exposures: 100, clicks: 1 }]);
    await observe(w, 'story', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 5 }]);
    const snapshots = { chero: await w.publish('chero'), story: await w.publish('story') };

    // Rollout, backwards: each generation of the record — the current markers,
    // the first pin policy, the first governance policy, and the pre-marker
    // record that names none of them — replays under ITS OWN rules.
    const generations: Array<{ name: string; historical: Historical; markers: Record<string, string> }> = [
      { name: 'current', historical: [], markers: { exploration: 'supported-only', pins: 'prefix-reserved-v2', contentTypes: 'catalog-tags-v1', governance: 'slot-gates-v2' } },
      { name: 'reserved-eligible-v1 pins', historical: [undefined, HISTORICAL_PINS_V1, undefined, HISTORICAL_GOVERNANCE_V1],
        markers: { exploration: 'supported-only', pins: 'reserved-eligible-v1', contentTypes: 'catalog-tags-v1', governance: 'slot-gates-v1' } },
      { name: 'pre-marker', historical: [HISTORICAL_EXPLORATION, HISTORICAL_PINS, HISTORICAL_CONTENT_TYPES, HISTORICAL_GOVERNANCE], markers: {} },
    ];
    for (const generation of generations) {
      const records = decidePage(w, snapshots, { historical: generation.historical });
      const later = recordFor(records, 'story');
      const manifest = later.inputs!.replay as unknown as Record<string, unknown>;
      expect(manifest.version, generation.name).toBe(1);
      for (const [member, value] of Object.entries(generation.markers)) expect(manifest[member], `${generation.name}.${member}`).toBe(value);
      for (const member of ['exploration', 'pins', 'contentTypes', 'governance']) {
        if (generation.markers[member] === undefined) expect(Object.prototype.hasOwnProperty.call(manifest, member), `${generation.name}.${member}`).toBe(false);
      }
      const replay = await replayDecision(w.env, later, replayDeps(w.env));
      expect(replay, `${generation.name}: ${replay.reason}`).toMatchObject({ ok: true, equal: true, diff: [] });
    }

    // A malformed manifest AT a supported version keeps its own sentence.
    const current = recordFor(decidePage(w, snapshots), 'story');
    const corrupt = structuredClone(current);
    (corrupt.inputs!.replay as unknown as Record<string, unknown>).candidateLimit = Infinity;
    expect(await replayDecision(w.env, corrupt, replayDeps(w.env))).toMatchObject({ ok: false, reason: 'invalid page replay manifest' });

    // A manifest version this build does not implement is a ROLLOUT event, and
    // the refusal names the version it was handed.
    for (const version of [2, 3, 17]) {
      const ahead = structuredClone(current);
      (ahead.inputs!.replay as unknown as Record<string, unknown>).version = version;
      const refused = await replayDecision(w.env, ahead, replayDeps(w.env));
      expect(refused, `manifest version ${version}`).toMatchObject({ ok: false, equal: false, replayed: null,
        reason: `page replay manifest version ${version} is not supported` });
    }
  });

  it('host-internal: the archive outlives every record that names it, and a record past its own retention horizon is refused before any dependency is read', async () => {
    const w = await world();
    await observe(w, 'chero', [{ item: 'cnt-charms-slg', exposures: 100, clicks: 90 }, { item: 'cnt-tabby-evening', exposures: 100, clicks: 1 }]);
    await observe(w, 'story', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 5 }]);
    const first = { chero: await w.publish('chero'), story: await w.publish('story') };
    const served = decidePage(w, first);
    const later = recordFor(served, 'story');

    // Publishing again, twice, does not retire what a retained record names:
    // every version ever published is still readable, so no record inside its
    // horizon is stranded by the next publication (F22 §2.3's permanent loss).
    await observe(w, 'chero', [{ item: 'cnt-charms-slg', exposures: 50, clicks: 45 }]);
    const second = await w.publish('chero');
    await observe(w, 'chero', [{ item: 'cnt-tabby-evening', exposures: 50, clicks: 2 }]);
    const third = await w.publish('chero');
    for (const version of [first.chero.version, second.version, third.version]) {
      expect(await replayDeps(w.env).archive(TENANT, BRAND, 'chero', version), `chero/${version}`).not.toBeNull();
    }
    const stillEqual = await replayDecision(w.env, later, replayDeps(w.env));
    expect(stillEqual, stillEqual.reason).toMatchObject({ ok: true, equal: true, diff: [] });

    // The record's OWN horizon is the bound. Under a one-minute ledger policy a
    // record whose evidence was admitted ten minutes ago is outside it: the
    // replay refuses the read outright rather than answering from an archive it
    // may no longer retain the evidence behind. The stamp is written out here
    // because `retentionBirth` refuses to mint an already-expired one
    // (`src/retention.ts:91`) — this is the shape a record admitted ten minutes
    // ago under that policy carries.
    const expiring: RetentionPolicy = { id: 'w27-b1-expiring-policy', revision: 1, durationMs: 60_000, basis: 'occurred', renewal: 'new-record-only' };
    const shortEnv = { ...w.env, RETENTION: retentionFor(expiring) } as Env;
    const bornAt = NOW - 10 * 60_000;
    const expired = structuredClone(later);
    expired.retention = { ...expired.retention, ledger: { version: 1, tenant: TENANT, category: 'ledger', policyId: expiring.id,
      policyRevision: expiring.revision, basis: 'occurred', bornAt, expiresAt: bornAt + expiring.durationMs } };
    expect(expired.retention.ledger!.expiresAt).toBe(bornAt + 60_000);
    w.storage.reads.length = 0;
    await expect(replayDecision(shortEnv, expired, replayDeps(shortEnv))).rejects.toBeInstanceOf(RetentionUnavailable);
    expect(w.storage.reads.filter(key => key.startsWith('lift/'))).toEqual([]);

    // Inside the same short horizon a fresh record still replays, so the rule
    // is the horizon and not the policy's existence.
    const fresh = structuredClone(later);
    fresh.retention = captureRetention(shortEnv, TENANT, Date.now());
    const within = await replayDecision(shortEnv, fresh, replayDeps(shortEnv));
    expect(within, within.reason).toMatchObject({ ok: true, equal: true });
  });
});
