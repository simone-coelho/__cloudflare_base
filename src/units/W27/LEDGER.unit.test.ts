// src/units/W27/LEDGER.unit.test.ts
// W27 — the Closure Ledger acceptance tests for the criteria of the frozen work
// order that the W27-B1 units do not already prove: R3 and R4 (LANE-LOG R200,
// the later W27 unit; R2 was dropped by the owner, decision D3). M1, R1, O1, F1
// and E1 are proven by `src/units/W27/B1.unit.test.ts` and are not restated here.
//
// One `describe('unit:W27.<criterion>')` per criterion, one `it` per leg.
//
// WITNESSES
//   · document 35 §5 row W27 (:429): "… Missing dependencies fail explicitly
//     rather than silently guessing."
//   · docs/kit/02-api-reference.md:327 — "Every replay answer also carries
//     `classification`, derived from `diff` alone: `equal` …, `item` (`item_id`
//     differs), … and `not-replayable` (`ok:false`, with the `reason`)"; a
//     manifest version above the implemented one is "a rollout event", while a
//     malformed manifest keeps `invalid page replay manifest`.
//   · docs/kit/02-api-reference.md:312 — "Publication failure schedules another
//     attempt in 30 seconds and still fails".
//   · the W27-B1 build review (`_evidence/W27-B1/reviewer-build/REPORT.md`,
//     finding 2) and LANE-LOG R161 / R200, which route two residuals here: a
//     corrupt manifest at version ≥ 2 reported only as a rollout event;
//     `LearnStats.ts:587`'s raw `setAlarm`, which "can push an earlier
//     effect-expiry alarm later" (R161).
//
// ONE REPRESENTATION with W27-B1: the same Coach home page — `merch` (a genuine
// catalogue pin) → `chero` (the learning slot) → `story` (the coupled later
// slot) — the same catalogue with its cross-category and unknown-taxonomy
// pieces, the same cell, visitor and fixed `NOW`, every archive published by
// the real `LearnStats` object and read through the real `replayDeps(env)`.
// Nothing here demands a state a B1 unit forbids.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import { memoryStore } from '@/auth/store';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { decideContent } from '@/content/decide';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, SlotCatalog, SlotStrategy } from '@/content/types';
import * as learnStatsModule from '@/durable-objects/LearnStats';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { consumeLedger } from '@/ledger/consume';
import { learningEffectId } from '@/ledger/recovery';
import { liftArchiveKey, statsName } from '@/learn/fan';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { replayDecision, replayDeps } from '@/learn/replay';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, retentionBirth, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture — W27-B1's, unchanged (docs/architecture/
// tapestry_requirements.txt A.3.6; docs/architecture/18-content-affinity-engine.md).
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const SLOT_TYPES = ['merch', 'chero', 'story'];

const piece = (id: string, tags: Record<string, string[]>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags, slotTypes: SLOT_TYPES, lifecycle: { status: 'live' },
});

const PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening', { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] }),
  // Cross-category: the same piece sits in Small Leather Goods and Handbags.
  piece('cnt-charms-slg', { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'], contentType: ['lookbook'] }),
  piece('cnt-rogue-work', { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] }),
  // Unknown taxonomy: a dimension value and a category no published weight names.
  piece('cnt-unknown-signal', { occasion: ['wombat-unrecognized'], category: ['Unknown'] }),
  piece('cnt-merch-pin', { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'] }),
];
const CATALOGUE = { version: 'w27-ledger-coach-catalogue', pieces: PIECES };

const PAGE: SlotStrategy[] = [
  { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'cnt-merch-pin' },
  { slot: 'chero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  { slot: 'story', take: 1, weights: { occasion: 0.35, line: 0.25 } },
];
const SLOTS: SlotCatalog = { version: 'w27-ledger-coach-slots', pages: { home: PAGE } };

const AFFINITY = { occasion: { evening: 0.8, work: 0.1 }, line: { Tabby: 0.7, Rogue: 0.2 } };
const CELL = { channel: 'direct', visit_bucket: '1' as const, stage: 'mid' as const, region: 'US-NY', affinity: 'occasion:evening' };
const VISITOR = 'vis-w27-b1';
/** W27-B1's literal decision time (2026-09-18 12:00:00Z), so every bucket is a constant. */
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

const learnDocument = () => ({
  holdout: { share: 0, salt: 'w27-b1', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  stats: DEFAULT_STATS,
  slots: {
    chero: { reward: 'click', objective: 'unit', gamma: 1 },
    story: { reward: 'click', objective: 'unit', gamma: 0 },
  },
});
const SLOT_CONFIG = { reward: 'click' as const, objective: 'unit' as const, stats: DEFAULT_STATS };

// ===========================================================================
// The stores and the real statistics object (W27-B1's harness, plus the
// transactional storage the managed learning path writes through).
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

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  reads: string[] = [];
  /** Make one write fail the way a transport failure does. */
  failPut: ((key: string) => boolean) | null = null;
  async get(key: string) {
    this.reads.push(key);
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
  /** The alarm the platform holds for each statistics object. */
  alarms: Map<string, number | null>;
  learn: (slot: string, path: string, body?: unknown) => Promise<Response>;
  publish: (slot: string) => Promise<LiftSnapshot>;
}

async function world(): Promise<World> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const storage = new UnitR2(), cache = new UnitKV();
  const objects = new Map<string, LearnStats>();
  const alarms = new Map<string, number | null>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    STORAGE: storage, CACHE: cache,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    RETENTION: retentionFor(fixturePolicy),
  } as unknown as Env;

  env.LEARN_STATS = {
    idFromName: (name: string) => name,
    get: (name: string) => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      let object = objects.get(name);
      if (!object) {
        const data = new Map<string, unknown>();
        const operations = (target: Map<string, unknown>) => ({
          get: async (key: string) => structuredClone(target.get(key)),
          put: async (key: string, value: unknown) => { target.set(key, structuredClone(value)); },
          delete: async (key: string) => target.delete(key),
          list: async () => structuredClone(target),
        });
        const state = { id: name, storage: {
          ...operations(data),
          deleteAll: async () => data.clear(),
          // The managed learning path commits its markers in one transaction.
          transaction: async (work: (tx: unknown) => Promise<unknown>) => {
            const candidate = structuredClone(data), result = await work(operations(candidate));
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            return result;
          },
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
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w27-ledger-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, CATALOGUE),
    baseline(SLOTS_KIND, SLOTS),
    baseline(LEARN_KIND, learnDocument()),
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
    return (await response.json() as { snapshot: LiftSnapshot }).snapshot;
  };
  return { env, storage, alarms, learn: call, publish };
}

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

/** W27-B1's evidence for the coupled page: the lift moves `chero` and `story` inherits the piece it left. */
async function coupledSnapshots(w: World): Promise<{ chero: LiftSnapshot; story: LiftSnapshot }> {
  await observe(w, 'chero', [{ item: 'cnt-charms-slg', exposures: 100, clicks: 90 }, { item: 'cnt-tabby-evening', exposures: 100, clicks: 1 },
    { item: 'cnt-rogue-work', exposures: 100, clicks: 1 }, { item: 'cnt-unknown-signal', exposures: 100, clicks: 1 }]);
  await observe(w, 'story', [{ item: 'cnt-tabby-evening', exposures: 100, clicks: 5 }]);
  const chero = await w.publish('chero'), story = await w.publish('story');
  invalidateLiftCache();
  return { chero, story };
}

type Historical = [unknown?, unknown?, unknown?, unknown?];
function decidePage(w: World, snapshots: Record<string, LiftSnapshot | null>, historical: Historical = []): DecisionRecord[] {
  const [exploration, pins, contentTypes, governance] = historical;
  const set = decideContent({
    tenant: TENANT, brand: BRAND, page: 'home', visitorId: VISITOR, sessionId: 's-w27', identityAnchor: 'visitor',
    nowMs: NOW, pieces: PIECES, slots: PAGE, affinity: { dims: AFFINITY }, cell: CELL,
    arm: 'personalized', versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 },
    configLabel: 'w27-b1', candidateLimit: 10,
    learning: {
      snapshots,
      gammaOf: (slot: string) => (slot === 'chero' ? 1 : 0),
      exploreOf: () => null,
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

// ===========================================================================
// The mounted application on both shopper hosts (W27-B1's harness), with the
// operator gate and the subject audit enforced.
// ===========================================================================

const OPERATOR_SECRET = 'w27-ledger-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const HOSTS = ['session', 'do'] as const;

interface Mounted extends World {
  fetch: (request: Request) => Promise<Response>;
  operatorToken: string;
}

async function mounted(host: 'session' | 'do'): Promise<Mounted> {
  const w = await world();
  const pending: Promise<unknown>[] = [];
  const shoppers = new Map<string, ShopperReflex>();
  const ring = { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ ok: true, ring: 0, records: [], index: [],
    receipt: { version: 1, kind: 'append', received: 0, accepted: 0, duplicates: 0, cutoffSkipped: 0, retained: 0, indexed: 0 } }) }) };
  Object.assign(w.env as unknown as Record<string, unknown>, {
    REFLEX_HOST: host, SESSIONS: new UnitKV(), AUTH_MODE: 'enforced', ACCOUNTS: memoryStore(),
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    IDENTITY_SALT: 'w27-ledger-synthetic-identity-audit-material',
    IDENTITY_SECRETS: `${TENANT}:w27-ledger-identity-assertion-material`,
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DECISION_RING: ring,
    EVENT_QUEUE: { send: async () => undefined, sendBatch: async () => undefined },
    SHOPPER_REFLEX: { idFromName: (n: string) => n, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let object = shoppers.get(name);
      if (!object) {
        const data = new Map<string, unknown>(); const alarms: number[] = [];
        const state = { id: name, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p), storage: {
          get: async (k: string) => structuredClone(data.get(k)), put: async (k: string, v?: unknown) => { data.set(k, structuredClone(v)); },
          list: async () => structuredClone(data), delete: async (k: string) => data.delete(k), deleteAll: async () => data.clear(),
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
        } } as unknown as DurableObjectState;
        object = new ShopperReflex(state, w.env); shoppers.set(name, object);
      }
      return object.fetch(new Request(input, init));
    } }) },
  });
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, w.env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const operatorToken = await new jose.SignJWT({ type: 'service', roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' })
    .setSubject('ops').setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('5m')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));
  return { ...w, fetch: fetchOne, operatorToken };
}

interface ReplayAnswer { status: number; noStore: boolean; body: Record<string, unknown> }
async function replayRequest(m: Mounted, id: string): Promise<ReplayAnswer> {
  const response = await m.fetch(new Request(`${OPERATOR_ORIGIN}/v1/${TENANT}/replay/${encodeURIComponent(id)}`, {
    headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}` },
  }));
  return { status: response.status, noStore: response.headers.get('cache-control') === 'no-store',
    body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/** The coupled page in the ledger the endpoint reads, written by the real consumer (W27-B1's `ledgeredPage`). */
async function ledgeredPage(m: Mounted): Promise<{ records: DecisionRecord[]; objectKey: string }> {
  const snapshots = await coupledSnapshots(m);
  const records = decidePage(m, snapshots);
  expect(records.map(record => record.slot)).toEqual(['merch', 'chero', 'story']);
  const consumed = await consumeLedger(m.env, [{ kind: 'ledger', type: 'decisions', version: 1, records }]);
  expect(consumed, `the real consumer must write the page: ${JSON.stringify(consumed)}`).toMatchObject({ ok: true });
  const objectKey = [...m.storage.objects.keys()].find(key => key.includes('/decision/') && key.endsWith('.ndjson'));
  expect(objectKey, 'the decision batch object the point lookup reads').toBeDefined();
  return { records, objectKey: objectKey! };
}

/** Rewrite one stored decision row, the way a drifted or damaged receipt reads. */
function tamper(m: Mounted, objectKey: string, id: string, change: (record: DecisionRecord) => void): void {
  const lines = m.storage.objects.get(objectKey)!.split('\n').filter(Boolean).map(line => JSON.parse(line) as DecisionRecord);
  const target = lines.find(record => record.decision_id === id);
  expect(target, 'the row to rewrite is in the batch object').toBeDefined();
  change(target!);
  m.storage.objects.set(objectKey, lines.map(record => JSON.stringify(record)).join('\n') + '\n');
}

// ===========================================================================
// unit:W27.R3 — a manifest at version 2 or above whose dependency identity is
// not a nonnegative safe integer is refused, not only reported as a rollout
// event (the frozen criterion, amendment A22; LANE-LOG R200).
//
// At the specification base `manifestVersionRefusal` (replay.ts:127) wins over
// every other malformation (W27-B1 build review, finding 2), so a damaged
// record that happens to carry `version: 2` is diagnosed only as "this build is
// behind that record" — the diagnosis O1.01 exists to keep APART from "this
// record is damaged".
//
// WHAT IS RULED — the frozen R3 text, which governs (lead's ruling on the W27
// delivery review, 2026-09-27). A slot row's `lift` and `prior` are the
// manifest's dependency identities. When one is PRESENT and is not a
// nonnegative safe integer, the manifest is damaged whatever version it claims
// and whatever the value's type: a negative, a fraction, a non-finite number,
// one past 2^53 — and equally a string ("5", "-1", "0"), an object ({},
// {version:-1}, {version:5}), null, a boolean or an array. A22's reason: the
// kit applies the rule to every recorded identity (02:325, "nonnegative
// safe-integer … `lift` and `prior` identities before dependency reads";
// "Integer zero remains the … absent-dependency convention" — integer zero,
// never the string "0"). The refusal is `invalid page replay manifest`, on
// every slot row of the page, before any archive is read.
//
// WHAT KEEPS THE ROLLOUT SENTENCE (O1.01's lock, restated as this unit's
// control): a later-version manifest whose identities are ALL nonnegative safe
// integers — the v1-shaped manifest bumped to a later version, and one that
// also carries members this build does not know or reshapes a member that is
// not an identity. That keeps O1.01's rollout sentence reachable for a later
// grammar. NOT RULED here: a row whose `lift` or `prior` is absent, a row that
// is not an object, a `slots` that is not an array.
//
// CORRECTION: the revision of this header at afef56b narrowed the rule to
// identities recorded as numbers and exempted "a member a later grammar could
// add or reshape". The frozen text has no such exemption: a reshaped `lift` or
// `prior` is still a dependency identity that is not a nonnegative safe
// integer.
// ===========================================================================

/** Every value a present `lift` or `prior` can hold that is not a nonnegative safe integer (the frozen R3 text; the W27 delivery review's cases). */
const NOT_AN_IDENTITY: unknown[] = [
  // Numbers the kit's rule refuses.
  Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e300,
  // Values that are not numbers at all: the rule is about the identity, not its type.
  '5', '-1', '0', {}, { version: -1 }, { version: 5 }, null, true, [1],
];
const shown = (value: unknown): string => (typeof value === 'number' ? String(value) : JSON.stringify(value));
type ManifestRows = Record<string, unknown> & { slots: Array<Record<string, unknown>> };

describe('unit:W27.R3', () => {
  it('logic: a later-version manifest with a corrupt dependency identity — of any type, on any slot row — is refused as an invalid manifest before any archive is read, while one whose identities are all nonnegative safe integers keeps the rollout sentence', async () => {
    const w = await world();
    const snapshots = await coupledSnapshots(w);
    const later = recordFor(decidePage(w, snapshots), 'story');
    const manifest = later.inputs!.replay as unknown as Record<string, unknown> & { slots: Array<Record<string, unknown>> };
    expect(manifest.slots.map(row => row.slot)).toEqual(['merch', 'chero', 'story']);

    for (const version of [2, 3, 17]) {
      // Control (W27.O1.01): a sound manifest a later build wrote is a rollout event, named by version.
      const ahead = structuredClone(later);
      (ahead.inputs!.replay as unknown as Record<string, unknown>).version = version;
      expect(await replayDecision(w.env, ahead, replayDeps(w.env)), `version ${version}: sound`)
        .toMatchObject({ ok: false, equal: false, replayed: null, reason: `page replay manifest version ${version} is not supported` });

      for (const [member, value] of [['lift', -1], ['prior', 1.5], ['lift', Number.MAX_SAFE_INTEGER + 1]] as const) {
        const corrupt = structuredClone(later);
        const replay = corrupt.inputs!.replay as unknown as Record<string, unknown> & { slots: Array<Record<string, unknown>> };
        replay.version = version;
        replay.slots[1]![member] = value;
        w.storage.reads.length = 0;
        const answer = await replayDecision(w.env, corrupt, replayDeps(w.env));
        expect(answer.reason ?? '',
          `W27.R3 (version ${version}, chero.${member} = ${value}) — a manifest whose dependency identity breaks the kit's nonnegative-safe-integer rule is DAMAGED, whatever version it claims; the refusal must say so, not only that the build is behind it`)
          .toContain('invalid page replay manifest');
        expect(answer).toMatchObject({ ok: false, equal: false, classification: 'not-replayable', replayed: null, diff: [] });
        expect(w.storage.reads.filter(key => key.startsWith('lift/')), 'refused before any archive is read').toEqual([]);
      }
    }

    // Control for the read ledger: the untouched version-1 record replays, and
    // replaying it DOES read the archives it names, so "no `lift/` read" below
    // measures a refusal and not a path that never reads.
    w.storage.reads.length = 0;
    const sound = await replayDecision(w.env, structuredClone(later), replayDeps(w.env));
    expect(sound, sound.reason).toMatchObject({ ok: true, equal: true, diff: [] });
    expect(w.storage.reads, 'a sound replay of the coupled page reads the learning slot archive').toContain(liftArchiveKey(TENANT, BRAND, 'chero', snapshots.chero.version));

    for (const version of [2, 3, 17]) {
      // Control, the refusal's boundary (the lead's ruling): identities that are
      // all nonnegative safe integers keep the rollout sentence, even beside
      // members this build does not know and a reshaped member that is not an
      // identity. Refusing every departure from the version-1 grammar would
      // leave O1.01's rollout sentence unreachable for a genuinely later one.
      const grammar = structuredClone(later);
      const reshaped = grammar.inputs!.replay as unknown as ManifestRows;
      reshaped.version = version;
      reshaped.ranking = 'a-later-grammar';
      reshaped.learning = 'per-slot';
      reshaped.slots = reshaped.slots.map(row => ({ ...row, page: 'home' }));
      expect(await replayDecision(w.env, grammar, replayDeps(w.env)), `version ${version}: identities sound, members this build does not know`)
        .toMatchObject({ ok: false, equal: false, classification: 'not-replayable', replayed: null, reason: `page replay manifest version ${version} is not supported` });

      // W27.R3, the frozen reading: a PRESENT identity that is not a
      // nonnegative safe integer, whatever its type, on every row of the page.
      for (const [row, slot] of ['merch', 'chero', 'story'].entries()) {
        for (const member of ['lift', 'prior'] as const) {
          for (const value of NOT_AN_IDENTITY) {
            const corrupt = structuredClone(later);
            const replay = corrupt.inputs!.replay as unknown as ManifestRows;
            expect(replay.slots[row]!.slot).toBe(slot);
            replay.version = version;
            replay.slots[row]![member] = value;
            w.storage.reads.length = 0;
            const answer = await replayDecision(w.env, corrupt, replayDeps(w.env));
            expect(answer,
              `W27.R3 (version ${version}, ${slot}.${member} = ${shown(value)}) — a present dependency identity that is not a nonnegative safe integer is DAMAGE whatever its type and whatever version the manifest claims; the refusal must be the invalid-manifest sentence, not "${String(answer.reason)}"`)
              .toMatchObject({ ok: false, equal: false, classification: 'not-replayable', replayed: null, diff: [], reason: 'invalid page replay manifest' });
            expect(w.storage.reads.filter(key => key.startsWith('lift/')), `${slot}.${member} = ${shown(value)}: refused before any archive is read`).toEqual([]);
          }
        }
      }
    }
  });

  for (const host of HOSTS) {
    it(`host (${host}): the operator endpoint diagnoses a stored later-version manifest with a corrupt identity of any type as an invalid manifest, and a sound later-version manifest as a rollout event`, async () => {
      const m = await mounted(host);
      const page = await ledgeredPage(m);
      const later = page.records.find(record => record.slot === 'story')!;
      // The manifest exactly as the real consumer stored it: every rewrite
      // after the first case below starts again from this row.
      let stored: unknown;
      tamper(m, page.objectKey, later.decision_id, record => { stored = structuredClone(record.inputs!.replay); });
      expect((stored as ManifestRows).slots.map(row => row.slot)).toEqual(['merch', 'chero', 'story']);
      const rewrite = (change: (replay: ManifestRows) => void): void => tamper(m, page.objectKey, later.decision_id, record => {
        const replay = structuredClone(stored) as ManifestRows;
        change(replay);
        (record.inputs as unknown as Record<string, unknown>).replay = replay;
      });
      tamper(m, page.objectKey, later.decision_id, record => {
        const replay = record.inputs!.replay as unknown as Record<string, unknown> & { slots: Array<Record<string, unknown>> };
        replay.version = 2; replay.slots[1]!.lift = -1;
      });
      const answer = await replayRequest(m, later.decision_id);
      expect(answer.status).toBe(200); expect(answer.noStore).toBe(true);
      expect(String(answer.body.reason ?? ''),
        'W27.R3 — the operator reads that the stored manifest is damaged, not only that this build is behind it').toContain('invalid page replay manifest');
      expect(answer.body).toMatchObject({ ok: false, equal: false, classification: 'not-replayable', replayed: null });

      // Control (W27.O1.01 through the endpoint): the stored manifest with sound
      // identities, at a later version, is a rollout event named by version.
      rewrite(replay => { replay.version = 2; });
      const ahead = await replayRequest(m, later.decision_id);
      expect(ahead.status).toBe(200); expect(ahead.noStore).toBe(true);
      expect(ahead.body).toMatchObject({ ok: false, equal: false, classification: 'not-replayable', replayed: null,
        reason: 'page replay manifest version 2 is not supported' });

      // W27.R3, the frozen reading, on the stored record: an identity that is
      // not a nonnegative safe integer whatever its type. (Only values a JSON
      // ledger row can carry: NaN and the infinities do not survive it.)
      for (const member of ['lift', 'prior'] as const) {
        for (const value of NOT_AN_IDENTITY.filter(candidate => typeof candidate !== 'number' || Number.isFinite(candidate))) {
          rewrite(replay => { replay.version = 2; replay.slots[1]![member] = value; });
          m.storage.reads.length = 0;
          const damaged = await replayRequest(m, later.decision_id);
          expect(damaged.status).toBe(200); expect(damaged.noStore).toBe(true);
          expect(damaged.body,
            `W27.R3 (${host}, stored version 2, chero.${member} = ${shown(value)}) — the operator must read that the stored manifest is damaged, not "${String(damaged.body.reason)}"`)
            .toMatchObject({ ok: false, equal: false, classification: 'not-replayable', replayed: null, reason: 'invalid page replay manifest' });
          expect(m.storage.reads.filter(key => key.startsWith('lift/')), `${host}: chero.${member} = ${shown(value)} is refused before any archive is read`).toEqual([]);
        }
      }
    });
  }
});

// ===========================================================================
// unit:W27.R4 — the publication-failure re-arm goes through the guarded alarm
// path: it never pushes an earlier effect-expiry alarm later.
//
// `LearnStats.publish()`'s failure branch (`src/durable-objects/LearnStats.ts`
// :835 at this base, :587 when R161 named it) calls the raw
// `setAlarm(Date.now() + PUBLISH_DELAY_MS)`. Every other writer of this
// object's alarm goes through `arm()` (:598-602), which keeps the EARLIEST of
// the publication retry and the live learning-effect expiries. R161: the raw
// call "can push an earlier effect-expiry alarm later" — an expired consent
// marker then outlives its expiry until the later alarm fires. Kit 02:312
// ("Publication failure schedules another attempt in 30 seconds") is kept: the
// retry is still due no later than 30 seconds out.
//
// Host-internal (R19): no public route exposes an object's alarm. The object
// is the real class; only the platform's storage and alarm are synthetic.
//
// COLLISION, for the owner's ruling before any build: W27.M1.01's host leg
// (`src/units/W27/B1.unit.test.ts:628`) requires the failure alarm to be AT
// LEAST `startedAt + 30 s` in a world whose earlier `/exposures` already armed
// an earlier publication alarm. Routing the failure branch through `arm()`
// verbatim keeps that earlier alarm and reds :628. This unit demands only the
// effect-expiry ordering, which an implementation can meet together with :628
// as it stands.
//
// R10 (S18, amendment 9 P70; the lead's ruling R-P195), test-only: P70's keep-warm heartbeat shares the object's
// single alarm, so the guarded path keeps the EARLIEST of the publication retry, the live learning-effect expiries and,
// while the object is inside its tail after a write, the heartbeat (`WARM_HEARTBEAT_MS` after the write, read loosely
// from src/durable-objects/LearnStats.ts: no heartbeat until the engine exports it, and then exactly `consentUntil` as
// before). The write's moment is bounded by the clock read before and after it.
// ===========================================================================

/** P70's `WARM_HEARTBEAT_MS` as the engine exports it, or no heartbeat (an infinite delay) while it does not. */
const warmHeartbeatMs = (): number => {
  const value = (learnStatsModule as unknown as Record<string, unknown>).WARM_HEARTBEAT_MS;
  return typeof value === 'number' ? value : Number.POSITIVE_INFINITY;
};

describe('unit:W27.R4', () => {
  it('host-internal: a failed publication leaves a pending effect-expiry alarm where it is, and the retry is still due within 30 seconds', async () => {
    const w = await world();
    const name = statsName(TENANT, BRAND, 'chero');
    // A consented learning effect whose consent ends in ten seconds: its marker
    // must be removed by the alarm at that instant (the managed path, as the
    // recovery fan-out writes it: `version: 2`, one effect per row).
    const consentUntil = Date.now() + 10_000;
    const decision = `${TENANT}:${NOW.toString(36)}:${VISITOR}:home:chero:0`;
    const effect = {
      version: 1, id: await learningEffectId('exposures', `${TENANT}:${BRAND}:chero`, decision), decision,
      tenant: TENANT, subject: VISITOR, generation: { whole: 0, item: 0 },
      retention: retentionBirth(w.env, TENANT, 'online', NOW), consentUntil,
    };
    const writtenFrom = Date.now();
    const written = await w.learn('chero', '/exposures', { version: 2, tenant: TENANT, brand: BRAND, slot: 'chero', config: SLOT_CONFIG,
      exposures: [{ item: 'cnt-charms-slg', cell: CELL, ts: NOW, effect }] });
    const writtenTo = Date.now();
    expect(written.status, await written.clone().text()).toBe(200);
    // R10 (S18, R-P195): the earlier of the effect expiry and the heartbeat after the write (exactly the expiry without a heartbeat).
    const heartbeat = warmHeartbeatMs();
    const guarded = (armed: number | null | undefined) => typeof armed === 'number' && armed >= Math.min(consentUntil, writtenFrom + heartbeat)
      && armed <= Math.min(consentUntil, writtenTo + heartbeat) ? 'the earlier of the effect expiry and the heartbeat' : `alarm ${String(armed)}`;
    // Control (the guarded path, `arm()`): the effect's expiry is the alarm.
    expect(guarded(w.alarms.get(name)), `the guarded path armed the effect expiry, which is earlier than the publication delay (or the heartbeat, earlier still: expiry ${consentUntil})`)
      .toBe('the earlier of the effect expiry and the heartbeat');

    // A publication whose archive write fails (W27.M1.01's failure).
    w.storage.failPut = key => key.startsWith('lift/');
    const failed = await w.learn('chero', '/publish');
    const finishedAt = Date.now();
    w.storage.failPut = null;
    expect(failed.status, 'an unarchivable snapshot is not a publication').toBe(503);

    const after = w.alarms.get(name);
    expect(guarded(after),
      `W27.R4 / R161 — the failure re-arm must go through the guarded path: the effect-expiry alarm at ${consentUntil} was moved to ${String(after)} (${typeof after === 'number' ? after - consentUntil : '?'} ms later)`)
      .toBe('the earlier of the effect expiry and the heartbeat');
    expect(after!, 'kit 02:312 — the publication retry is still due no later than 30 seconds out').toBeLessThanOrEqual(finishedAt + 30_000);
  });
});
