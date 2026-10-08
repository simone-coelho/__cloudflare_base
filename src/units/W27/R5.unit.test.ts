// src/units/W27/R5.unit.test.ts
// W27 R5 — a regression unit under W27 (lead ruling 2026-10-08,
// _evidence/step3/AMENDMENTS.md, "W27 regression unit"): replay compares
// records by value, not by key order.
//
// One `describe('unit:W27.R5.<nn>')` per test of the criterion, one `it` per leg.
//
// THE CRITERION (as the lead records it): "R5 — Replay compares records by
// value, not by key order: a served record whose nested explain members were
// stored with keys in another order than the replayed record classifies equal
// when every value is equal; a genuine value difference still classifies
// explanation and the diff names the field."
//
// WITNESSES
//   · docs/architecture/22-outcome-learning-design.md §12.3 — "Equality is the
//     proof that the system is deterministic and that the explain record is the
//     truth rather than a narrative about it … The replay decides again … and
//     compares item, exploration flag, base and final score, the lift block, the
//     model's term, the drivers and the candidate list; the answer is
//     `equal: true` or the list of fields that differ."
//   · document 35 §5 row W27 (:429) "Prove replay parity …", and :177 "exact
//     output parity".
//   · docs/kit/02-api-reference.md:832 — `GET replay/{decision_id}` answers
//     `{ equal, classification, diff[], used }`; "`classification` is `equal`,
//     `item`, `candidates-only`, `explanation` or `not-replayable`, derived from
//     `diff` alone".
//   · the S1 specification review of the parity programme
//     (_evidence/parity-step3/S1/reviewer-spec/REPORT.md, "Replay defect"):
//     replay.ts:58 compares JSON.stringify output while recovery.ts:29-33 sorts
//     keys, "so acknowledged decisions with drivers replay as explanation".
//
// THE PATH, measured before this file was written (logs/probe.log, both hosts):
// a `rendered-v1` decision is captured only by its acknowledgement
// (src/content/service.ts:610-617: the snapshot route passes an offer, so serve
// time captures nothing). The render offer seals the record through
// `recoveryJSON` (src/content/renderOffer.ts:66), the acknowledgement parses it
// back (:84), adds `rendered` (:97) and admits it through `recoverDecisions`
// (:98) → `runOwnerRecovery`, which re-serializes the input through
// `recoveryJSON` (src/ledger/recovery.ts:136) and the payload again
// (`savePayload`, :101; read back by `payloadOf`, :95) before the managed send
// (:237). The queued record and the ledger row carry every object's keys sorted
// (drivers `a,dim,value,weight`, exploration `bucket,mode,reason`). The replay
// endpoint (src/routes/decisions.ts:1151) decides again through `decideContent`
// (src/learn/replay.ts:292), whose records carry insertion order (drivers
// `dim,value,a,weight`, src/reflex/contentCompose.ts:312-313; exploration
// `mode,reason,bucket`), and `compareRecords` (replay.ts:58) compares the
// `JSON.stringify` text. Measured: hero `explanation` on `explain.drivers`,
// rail `explanation` on `explain.exploration` and `explain.drivers`, every
// listed difference equal by value.
//
// ONE REPRESENTATION, shared by the three tests: the same home page — a
// `hero` scored on occasion and line and a `rail` that explores by rotation —
// over the same catalogue (product lines, occasions and categories, with a
// cross-category piece and a piece of unknown taxonomy). Every test demands the
// same thing of a record pair: equal values are equal whatever the key order,
// and a value that differs is a diff entry naming its field. No test needs a
// state another one forbids.
//
// RULED MEMBERS: none new. `compareRecords` and `classifyReplay` are the
// existing exports of src/learn/replay.ts, inside W27's allowed paths.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { configuredDestinations } from '@/connectors/config';
import { decideContent } from '@/content/decide';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog, SlotStrategy } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { consumeLedger } from '@/ledger/consume';
import { recoveryJSON } from '@/ledger/recovery';
import { bucketOf, hourKeyOf } from '@/learn/explore';
import { classifyReplay, compareRecords, type ReplayDiff } from '@/learn/replay';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ===========================================================================
// The fixture, customer-neutral, in the taxonomy shape the witnesses use
// (docs/architecture/tapestry_requirements.txt A.3.6;
// docs/architecture/18-content-affinity-engine.md): editorial content tagged
// by line, occasion and category, a cross-category piece and a piece whose
// taxonomy the engine does not know.
// ===========================================================================

const TENANT = 'acme';
const BRAND = 'acme';
const DAY_MS = 86_400_000;
const SLOT_TYPES = ['hero', 'rail'];

const piece = (id: string, tags: Record<string, string[]>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial', title: id, tags, slotTypes: SLOT_TYPES, lifecycle: { status: 'live' },
});
const PIECES: ContentPiece[] = [
  piece('cnt-harbor-evening-edit', { line: ['Harbor'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] }),
  // Cross-category: the same piece sits in Small Leather Goods and Handbags.
  piece('cnt-charms-slg', { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'], contentType: ['lookbook'] }),
  piece('cnt-summit-work', { line: ['Summit'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] }),
  // Unknown taxonomy: an occasion and a category no published weight names.
  piece('cnt-unknown-signal', { occasion: ['wombat-unrecognized'], category: ['Unknown'] }),
];
const PAGE: SlotStrategy[] = [
  { slot: 'hero', take: 1, weights: { occasion: 0.5, line: 0.25 } },
  { slot: 'rail', take: 1, weights: { occasion: 0.35, line: 0.25 } },
];
const SLOTS: SlotCatalog = { version: 'w27-r5-slots', pages: { home: PAGE } } as SlotCatalog;
const ROTATION = { mode: 'rotation' as const, share: 1, floor: 50 };

const bucketAt = (visitorId: string, slot: string, hourKey: string) => Math.round(bucketOf(visitorId, slot, hourKey) * 1000) / 1000;
/** Fixture shoppers; the first whose rotation bucket on `rail` is inside the share at the given hour is used. */
const SHOPPERS = Array.from({ length: 200 }, (_, i) => `vis-00000027-0c05-4000-8000-${String(i).padStart(12, '0')}`);
const shopperInsideTheShare = (nowMs: number): string => {
  const hour = hourKeyOf(nowMs);
  const found = SHOPPERS.find(v => bucketAt(v, 'rail', hour) < 1);
  expect(found, 'PRECONDITION: a fixture shopper inside the rail rotation share this hour').toBeDefined();
  return found!;
};

/** Every object of a value with its keys in the reverse of their present order, arrays kept in order. */
const reordered = <T>(value: T): T => {
  const visit = (v: unknown): unknown => Array.isArray(v) ? v.map(visit)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([key, item]) => [key, visit(item)])) : v;
  return visit(value) as T;
};
/** The record as the recovery path stores it: the production serializer, recovery.ts:29, and back. */
const asRecoveryStores = <T>(value: T): T => JSON.parse(recoveryJSON(value)) as T;
const fields = (diff: ReplayDiff[]) => diff.map(entry => entry.field);

// ===========================================================================
// The logic legs' page: decided by the real `decideContent` with every nested
// explain member §12.3 compares — the drivers (the shopper's interest), the
// lift block (a learned snapshot on `hero`), the model's term (an external
// score on `hero`), the exploration (rotation on `rail`) and the candidates.
// ===========================================================================

/** W27-B1's literal decision time (2026-09-18 12:00:00Z), so every bucket is a constant. */
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const CELL = { channel: 'direct', visit_bucket: '1' as const, stage: 'mid' as const, region: 'US-NY', affinity: 'occasion:evening' };
const AFFINITY = { occasion: { evening: 0.8, work: 0.1 }, line: { Harbor: 0.7, Summit: 0.2 } };

const snapshotOf = (slot: string, version: number, observed: Record<string, { n: number; s: number }>): LiftSnapshot => ({
  tenant: TENANT, brand: BRAND, slot, reward: 'click', version, publishedAt: NOW, events: 2000,
  n0: DEFAULT_STATS.n0, nMin: DEFAULT_STATS.nMin, liftMin: DEFAULT_STATS.liftMin, liftMax: DEFAULT_STATS.liftMax, tauLearnMs: DEFAULT_STATS.tauLearnMs,
  items: Object.fromEntries(Object.entries(observed).map(([id, o]) => [id,
    { '*': { level: 0 as const, key: '*', n: o.n, s: o.s, p0: 0.1, p_hat: o.s / o.n, lift: (o.s / o.n) / 0.1 } }])),
  slotRates: { '*': { n: 2000, s: 200, rate: 0.1 } },
} as unknown as LiftSnapshot);
const HERO_SNAPSHOT = snapshotOf('hero', 11, { 'cnt-harbor-evening-edit': { n: 500, s: 60 }, 'cnt-charms-slg': { n: 500, s: 45 },
  'cnt-summit-work': { n: 500, s: 50 }, 'cnt-unknown-signal': { n: 500, s: 50 } });
const RAIL_SNAPSHOT = snapshotOf('rail', 12, { 'cnt-harbor-evening-edit': { n: 4, s: 1 }, 'cnt-charms-slg': { n: 6, s: 1 },
  'cnt-summit-work': { n: 8, s: 1 }, 'cnt-unknown-signal': { n: 2, s: 0 } });

function decidedPage(): { hero: DecisionRecord; rail: DecisionRecord } {
  const visitorId = shopperInsideTheShare(NOW);
  const set = decideContent({
    tenant: TENANT, brand: BRAND, page: 'home', visitorId, sessionId: `s-${visitorId.slice(4)}`, identityAnchor: 'visitor', nowMs: NOW,
    pieces: PIECES, slots: PAGE, affinity: { dims: AFFINITY }, cell: CELL, arm: 'personalized',
    versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'w27-r5', candidateLimit: 10,
    learning: {
      snapshots: { hero: HERO_SNAPSHOT, rail: RAIL_SNAPSHOT },
      gammaOf: (slot: string) => (slot === 'hero' ? 1 : 0),
      exploreOf: (slot: string) => (slot === 'rail' ? ROTATION : null),
      metadataOf: () => ({ reward: 'click', objective: 'unit', measurementBasis: 'served-v1' }),
    },
    external: { kind: 'table', ref: 'w27-r5-model', weightOf: (slot: string) => (slot === 'hero' ? 0.5 : 0), status: 'ok', version: 'm1',
      scores: { 'cnt-harbor-evening-edit': 0.6, 'cnt-charms-slg': 0.2, 'cnt-summit-work': 0.1 } },
  } as unknown as Parameters<typeof decideContent>[0]);
  const hero = set.records.find(record => record.slot === 'hero');
  const rail = set.records.find(record => record.slot === 'rail');
  expect(hero, 'PRECONDITION: the page decides the hero').toBeDefined();
  expect(rail, 'PRECONDITION: the page decides the rail').toBeDefined();
  // The fixture carries every nested member §12.3 compares, so no clause below is vacuous.
  expect(hero!.explain.drivers.length, 'PRECONDITION: the hero carries the shopper\'s interest drivers').toBeGreaterThan(1);
  expect(hero!.explain.lift, 'PRECONDITION: the hero carries a learned lift block').toMatchObject({ reward: 'click', gamma: 1 });
  expect(hero!.explain.external, 'PRECONDITION: the hero carries the model\'s term').toMatchObject({ kind: 'table', ref: 'w27-r5-model', version: 'm1', weight: 0.5 });
  expect(rail!, 'PRECONDITION: the rail explored by rotation').toMatchObject({ explored: true, explain: { exploration: { mode: 'rotation' } } });
  expect(hero!.candidates.length, 'PRECONDITION: the hero ranked several candidates').toBeGreaterThan(1);
  return { hero: hero!, rail: rail! };
}

// ===========================================================================
// unit:W27.R5.01 — the pure function: equal values in another key order are equal.
// ===========================================================================

describe('unit:W27.R5.01', () => {
  it('logic: compareRecords finds no difference between two records equal in value whose nested explain members and candidates carry their keys in another order, and still names the one field whose value differs', () => {
    const page = decidedPage();
    for (const [slot, record] of Object.entries(page)) {
      const variants: Array<[string, DecisionRecord]> = [
        ['stored the way the recovery path stores it (recoveryJSON, recovery.ts:29)', asRecoveryStores(record)],
        ['stored with every key in the reverse order', reordered(record)],
      ];
      for (const [how, served] of variants) {
        // The variant is the same record by value: only key order can differ.
        expect(recoveryJSON(served), `PRECONDITION (${slot}, ${how}): the served record equals the replayed one by value`).toBe(recoveryJSON(record));
        const diff = compareRecords(served, record);
        expect(fields(diff),
          `W27.R5 — the ${slot} record ${how} is equal in every value to the replayed record and must compare equal; compareRecords reported ${JSON.stringify(fields(diff))}, a difference of key order alone (replay.ts:58 compares JSON.stringify text)`)
          .toEqual([]);
        expect(classifyReplay(true, diff), `W27.R5 — the ${slot} record ${how} classifies equal`).toBe('equal');
        // Order-blind in both directions: the replayed side may be the one in another order.
        expect(fields(compareRecords(record, served)), `W27.R5 — the ${slot} record compared the other way round, ${how}`).toEqual([]);
      }
      // The reversed variant really does order every compared object it carries differently.
      const reversed = reordered(record);
      const members: Array<[string, object | null | undefined, object | null | undefined]> = [
        ['candidates[0]', reversed.candidates[0], record.candidates[0]],
        ['explain.drivers[0]', reversed.explain.drivers[0], record.explain.drivers[0]],
        ['explain.lift', reversed.explain.lift, record.explain.lift],
        ['explain.external', reversed.explain.external, record.explain.external],
        ['explain.exploration', reversed.explain.exploration, record.explain.exploration],
      ];
      for (const [member, flipped, kept] of members) {
        if (!kept) continue;
        expect(Object.keys(flipped!), `PRECONDITION (${slot}): the reversed ${member} carries its keys in the reverse order`).toEqual(Object.keys(kept).reverse());
      }
    }

    // Order-blind is not value-blind: with every key in another order, the one
    // value that genuinely differs is still the one field the diff names.
    const hero = asRecoveryStores(page.hero);
    hero.explain.drivers[0]!.weight = hero.explain.drivers[0]!.weight + 0.1;
    const heroDiff = compareRecords(hero, page.hero);
    expect(fields(heroDiff), 'W27.R5 — a hero stored with sorted keys whose first driver weight differs names exactly `explain.drivers`').toEqual(['explain.drivers']);
    expect(classifyReplay(true, heroDiff)).toBe('explanation');
    const rail = reordered(page.rail);
    rail.explain.exploration!.bucket = 0.987;
    const railDiff = compareRecords(rail, page.rail);
    expect(fields(railDiff), 'W27.R5 — a rail stored in reverse key order whose exploration bucket differs names exactly `explain.exploration`').toEqual(['explain.exploration']);
    expect(classifyReplay(true, railDiff)).toBe('explanation');
  });
});

// ===========================================================================
// The mounted application for the host legs: the real routes over the real
// Durable Object classes (ShopperReflex, DecisionRing, LearnStats) on both
// shopper-state hosts, with the durable rendered admission switched on, the way
// src/units/W28/LEDGER.unit.test.ts (W28.R6) and W21/B2 (W21.E1.08) mount it.
// Only the platform (storage, alarms, queue transport) is synthetic.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.data.get(key);
    return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v;
  }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort();
    const start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string, options?: R2GetOptions) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { key, etag: 'v' + this.versions.get(key), size: bytes.length, customMetadata: this.metadata.get(key),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: (this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixturePolicy: RetentionPolicy = { id: 'w27-r5-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const allCategories = () => ({ [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(c => [c, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy> });

function objectState(name: string, pending: Promise<unknown>[]): DurableObjectState {
  const data = new Map<string, unknown>(); const alarms: number[] = [];
  const operations = (target: Map<string, unknown>) => ({
    get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, target.get(v)])) : target.get(k)),
    put: async (k: string | Record<string, unknown>, v?: unknown) => {
      if (typeof k === 'string') target.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) target.set(key, structuredClone(value));
    },
    delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; let n = 0; for (const key of list) if (target.delete(key)) n++; return typeof keys === 'string' ? n > 0 : n; },
    list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
      structuredClone(new Map([...target].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
        .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
    setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null, deleteAlarm: async () => { alarms.length = 0; },
  });
  return { id: name, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p), storage: {
    ...operations(data), deleteAll: async () => data.clear(),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const candidate = structuredClone(data), result = await run(operations(candidate));
      data.clear(); for (const [key, value] of candidate) data.set(key, value); return result;
    },
  } } as unknown as DurableObjectState;
}

/** The tenant's published learn document: both slots measured on the durable rendered basis; the rail explores by rotation. */
const LEARN: LearnConfig = { version: 'w27-r5-learn', holdout: { share: 0, salt: '', arms: ['default'] }, slots: {
  hero: { gamma: 0, reward: 'click', objective: 'unit', measurementBasis: 'rendered-v1' },
  rail: { gamma: 0, reward: 'click', objective: 'unit', measurementBasis: 'rendered-v1', exploration: ROTATION },
} } as unknown as LearnConfig;

const OPERATOR_SECRET = 'w27-r5-synthetic-operator-signing-material';
const SITE = 'https://synthetic.invalid';

interface Mounted {
  env: Env;
  storage: UnitR2;
  fetch: (request: Request) => Promise<Response>;
  drain: () => Promise<void>;
  /** Drain the owner work, then hand every queued body to the real ledger consumer; answers what was queued. */
  drainLedger: () => Promise<Array<Record<string, unknown>>>;
  operatorToken: string;
}

async function mount(host: 'session' | 'do'): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const queued: unknown[] = [];
  const storage = new UnitR2();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: new UnitKV(), SESSIONS: new UnitKV(), STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w27-r5-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    RETENTION: JSON.stringify({ version: 1, tenants: allCategories() }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); }, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const m of messages) queued.push(m.body); } },
    // The durable rendered admission (kit 02:315): a rendered-v1 decision reaches the ledger only through it.
    LEDGER_RECOVERY_ENABLED: 'true',
  } as unknown as Env;
  const policies = allCategories();
  for (const destination of await configuredDestinations(env, TENANT, () => { /* no destination diagnostics */ })) policies[TENANT]![destination.category] = fixturePolicy;
  env.RETENTION = JSON.stringify({ version: 1, tenants: policies });
  const namespaceFor = <T extends { fetch: (request: Request) => Response | Promise<Response> }>(make: (state: DurableObjectState, env: Env) => T) => {
    const registry = new Map<string, T>();
    return { idFromName: (n: string) => n, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let held = registry.get(name);
      // The object's id is its name, as `idFromName` answers it.
      if (!held) { held = make(objectState(name, pending), env); registry.set(name, held); }
      return await held.fetch(new Request(input, init));
    } }) };
  };
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e)) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e)) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e)) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));
  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 20)); };
  const drainLedger = async () => {
    await drain();
    const bodies = structuredClone(queued.splice(0)) as Array<Record<string, unknown>>;
    if (!bodies.length) return bodies;
    const result = await consumeLedger(env, structuredClone(bodies));
    expect(result.error, 'PRECONDITION: the real consumer writes the queued ledger batch').toBeUndefined();
    return bodies;
  };

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w27-r5-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { version: 'w27-r5-catalogue', pieces: PIECES }), baseline(SLOTS_KIND, SLOTS), baseline(LEARN_KIND, LEARN),
    // The brand scores the registry attributes its product events carry (kit 03, `product_view`; CW24).
    baseline(REFLEX_KIND, { ...DEFAULT_REFLEX_CONFIG, version: 'w27-r5-registry', eventAttributes: 'event-when-unknown' as const }, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
  return { env, storage, fetch: fetchOne, drain, drainLedger, operatorToken };
}

/** The shopper's product views (kit 03 `product_view`): a Harbor shoulder bag, and an unfiled product whose line and category the catalogue does not name. */
const HARBOR_VIEW = { productId: 'W27-HARBOR-26', line: 'Harbor', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['evening', 'work'], price_usd: 395 };
const UNFILED_VIEW = { productId: 'W27-UNFILED', line: 'Unfiled', category: 'Unknown Category', occasion: ['evening', 'travel'], price_usd: 12 };

interface ReplayAnswer { status: number; body: { ok?: boolean; equal?: boolean; classification?: string; reason?: string; diff?: ReplayDiff[] } }
const replayOf = async (m: Mounted, id: string): Promise<ReplayAnswer> => {
  const response = await m.fetch(new Request(`${SITE}/v1/${TENANT}/replay/${encodeURIComponent(id)}`,
    { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}` } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as ReplayAnswer['body'] };
};
const verdict = (a: ReplayAnswer) => ({ status: a.status, ok: a.body.ok, equal: a.body.equal, classification: a.body.classification,
  diff: (a.body.diff ?? []).map(entry => entry.field), ...(a.body.reason ? { reason: a.body.reason } : {}) });

/** Rewrite one stored decision row in place, keeping every other row and every key order as stored. */
function rewriteStored(m: Mounted, id: string, change: (record: DecisionRecord) => void): () => void {
  const key = [...m.storage.objects.keys()].find(k => k.includes('/decision/') && k.endsWith('.ndjson') && m.storage.objects.get(k)!.includes(JSON.stringify(id)));
  expect(key, `PRECONDITION: the ledger object holding ${id}`).toBeDefined();
  const original = m.storage.objects.get(key!)!;
  const lines = original.split('\n').filter(Boolean).map(line => JSON.parse(line) as DecisionRecord);
  const target = lines.find(record => record.decision_id === id)!;
  change(target);
  m.storage.objects.set(key!, lines.map(record => JSON.stringify(record)).join('\n') + '\n');
  return () => { m.storage.objects.set(key!, original); };
}

// ===========================================================================
// unit:W27.R5.02 — the real path on both hosts: a shopper with interest
// drivers, a rendered decision served and acknowledged so that its record goes
// through the durable recovery admission, then the operator's replay endpoint.
// ===========================================================================

describe('unit:W27.R5.02', () => {
  for (const host of ['session', 'do'] as const) {
    it(`host (${host}): a decision acknowledged through the recovery path replays equal through GET /v1/:tenant/replay/:id, and a genuine value difference in the stored record classifies explanation naming the field`, async () => {
      const m = await mount(host);
      const subject = shopperInsideTheShare(Date.now());
      const sessionId = `s-${subject.slice(4)}`;
      const grant = await issueSessionCapability(m.env, { tenant: TENANT, subject, sessionId, kind: 'anonymous' });
      const call = (path: string, body?: unknown) => m.fetch(new Request(`${SITE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      const act = async (type: string, data: Record<string, unknown>) => {
        const response = await call('/realtime/action', { type, source: 'sdk', userId: subject, sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(), data });
        expect(response.status, `PRECONDITION (${host}): ${type} is accepted: ${await response.clone().text()}`.slice(0, 400)).toBe(200);
        await m.drain();
        return await response.json() as Record<string, unknown>;
      };

      // The shopper's explicit choice: tracking and personalization on.
      const chose = await call(`/realtime/session/${sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } });
      expect(chose.status, `PRECONDITION (${host}): the shopper's choice is accepted: ${await chose.clone().text()}`.slice(0, 400)).toBe(200);
      await m.drain();
      // Interest, through the real event door: a Harbor view, and an unfiled product (cross-category and unknown values ride along).
      await act('product_view', HARBOR_VIEW);
      await act('product_view', UNFILED_VIEW);

      // The page load, and the render acknowledgement the SDK sends for every piece it rendered.
      const pageInstance = `w27-r5-${host}`;
      invalidatePublicationCache();
      const snapshot = await call(`/v1/${TENANT}/decisions/snapshot?page=home&pageInstance=${pageInstance}`);
      const served = await snapshot.json() as { decisions?: Array<{ slot: string; contentId: string; decisionId?: string; renderOffer?: string }> };
      await m.drain();
      expect(snapshot.status, `PRECONDITION (${host}): the page is served: ${JSON.stringify(served).slice(0, 300)}`).toBe(200);
      const decisions = served.decisions ?? [];
      expect(decisions.map(d => d.slot), `PRECONDITION (${host}): both slots are decided`).toEqual(['hero', 'rail']);
      for (const d of decisions) {
        expect(d.renderOffer, `PRECONDITION (${host}): ${d.slot} on the rendered basis offers an acknowledgement`).toBeTruthy();
        const ack = await act('content_impression', { contentId: d.contentId, decisionId: d.decisionId, renderOffer: d.renderOffer, page: 'home', pageInstance, slot: d.slot, position: 0 });
        expect(ack.render, `PRECONDITION (${host}): the ${d.slot} render is durably acknowledged`).toMatchObject({ version: 1, decisionId: d.decisionId, status: 'durable' });
      }
      const bodies = await m.drainLedger();

      // The records went through the recovery path: the managed send carries the admission's recovery id (recovery.ts:167-168).
      const decisionBodies = bodies.filter(body => body.type === 'decisions' || JSON.stringify(body).includes('"decision_id"'));
      expect(decisionBodies.length, `PRECONDITION (${host}): the acknowledged decisions were queued`).toBeGreaterThan(0);
      for (const body of decisionBodies) expect(body.recovery_id, `PRECONDITION (${host}): every queued decision batch was sent by the recovery admission`).toMatch(/^[a-f0-9]{64}$/);
      const stored = [...m.storage.objects.entries()].filter(([key]) => key.includes('/decision/') && key.endsWith('.ndjson'))
        .flatMap(([, raw]) => raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as DecisionRecord))
        .filter(record => record.visitor_id === subject);
      const at = (slot: string) => {
        const record = stored.find(r => r.slot === slot);
        expect(record, `PRECONDITION (${host}): the ledger stored the ${slot} decision`).toBeDefined();
        return record!;
      };
      const hero = at('hero'), rail = at('rail');
      for (const record of [hero, rail]) {
        expect(record, `PRECONDITION (${host}): the stored ${record.slot} record is the rendered acknowledgement`).toMatchObject({ measurementBasis: 'rendered-v1', rendered: { version: 1, pageInstance } });
        expect(record.explain.drivers.length, `PRECONDITION (${host}): the ${record.slot} decision carries the shopper's interest drivers`).toBeGreaterThan(0);
      }
      expect(rail, `PRECONDITION (${host}): the rail explored by rotation`).toMatchObject({ explored: true, explain: { exploration: { mode: 'rotation' } } });

      // RULED: every value is equal, so the replay is equal.
      for (const record of [hero, rail]) {
        const answer = await replayOf(m, record.decision_id);
        expect(verdict(answer),
          `W27.R5 (${host}) — the ${record.slot} decision, acknowledged through the recovery path, must replay equal: its stored explain members differ from the replayed record in key order only (stored sorted by recoveryJSON, recovery.ts:29; replayed in insertion order, replay.ts:292), and compareRecords (replay.ts:58) compares JSON text`)
          .toEqual({ status: 200, ok: true, equal: true, classification: 'equal', diff: [] });
      }

      // RULED: a genuine value difference in the stored (sorted-key) record still classifies explanation and names the field.
      const restoreHero = rewriteStored(m, hero.decision_id, record => { record.explain.drivers[0]!.weight = record.explain.drivers[0]!.weight + 0.1; });
      const heroChanged = await replayOf(m, hero.decision_id);
      expect(verdict(heroChanged), `W27.R5 (${host}) — a stored hero whose first driver weight differs classifies explanation on exactly explain.drivers`)
        .toEqual({ status: 200, ok: true, equal: false, classification: 'explanation', diff: ['explain.drivers'] });
      expect(heroChanged.body.diff![0]!.served, `W27.R5 (${host}) — the diff carries the stored drivers as served`)
        .toEqual(hero.explain.drivers.map((driver, i) => (i === 0 ? { ...driver, weight: driver.weight + 0.1 } : driver)));
      expect(heroChanged.body.diff![0]!.replayed, `W27.R5 (${host}) — the diff carries the replayed drivers`).toEqual(hero.explain.drivers);
      restoreHero();
      const restoreRail = rewriteStored(m, rail.decision_id, record => { record.explain.exploration!.bucket = 0.987; });
      expect(verdict(await replayOf(m, rail.decision_id)), `W27.R5 (${host}) — a stored rail whose exploration bucket differs classifies explanation on exactly explain.exploration`)
        .toEqual({ status: 200, ok: true, equal: false, classification: 'explanation', diff: ['explain.exploration'] });
      restoreRail();
    }, 60_000);
  }
});

// ===========================================================================
// unit:W27.R5.03 — the lock: a genuine value difference classifies by kind and
// the diff names the field (kit 02:832; §12.3 "the list of fields that
// differ"). Green before the change; the change must keep it green.
// ===========================================================================

describe('unit:W27.R5.03', () => {
  it('logic: a replay whose explain value truly differs classifies explanation and the diff names the field; a different ranking order is a value, not a key order', () => {
    const page = decidedPage();
    const cases: Array<{ name: string; base: DecisionRecord; change: (record: DecisionRecord) => void; field: string; classification: string }> = [
      { name: 'the first driver weight', base: page.hero, field: 'explain.drivers', classification: 'explanation',
        change: record => { record.explain.drivers[0]!.weight = record.explain.drivers[0]!.weight + 0.1; } },
      { name: 'the drivers in another order (an ordered list is a value)', base: page.hero, field: 'explain.drivers', classification: 'explanation',
        change: record => { record.explain.drivers.reverse(); } },
      { name: 'the lift block evidence', base: page.hero, field: 'explain.lift', classification: 'explanation',
        change: record => { record.explain.lift!.n = record.explain.lift!.n + 1; } },
      { name: 'the model\'s term', base: page.hero, field: 'explain.external', classification: 'explanation',
        change: record => { (record.explain.external as { score: number }).score = 0.95; } },
      { name: 'the exploration bucket', base: page.rail, field: 'explain.exploration', classification: 'explanation',
        change: record => { record.explain.exploration!.bucket = 0.987; } },
      { name: 'the candidates in another ranking order', base: page.hero, field: 'candidates', classification: 'candidates-only',
        change: record => { record.candidates.reverse(); } },
    ];
    for (const c of cases) {
      const served = structuredClone(c.base);
      c.change(served);
      const diff = compareRecords(served, c.base);
      expect(fields(diff), `W27.R5 lock — ${c.name}: the diff names exactly ${c.field}`).toEqual([c.field]);
      expect(classifyReplay(true, diff), `W27.R5 lock — ${c.name}: classified ${c.classification}`).toBe(c.classification);
      const at = (record: DecisionRecord) => c.field === 'candidates' ? record.candidates
        : record.explain[c.field.slice('explain.'.length) as 'drivers' | 'lift' | 'external' | 'exploration'];
      expect(diff[0], `W27.R5 lock — ${c.name}: the entry carries the served and the replayed value`).toEqual({ field: c.field, served: at(served), replayed: at(c.base) });
    }
  });
});
