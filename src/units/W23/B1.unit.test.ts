// src/units/W23/B1.unit.test.ts
// W23 batch B1 — arithmetic and event time: order-invariant online counters,
// what a late event may cost, exact internal rates down the six-level ladder, a
// legible receipt at rare rates, bounded and validated event time that respects
// the owner's settled late-buffered decision, decay a future-dated event cannot
// freeze, the `||` traps, and damaged historical state rebuilt or explicitly
// reset.
//
// One `describe('unit:W23.<id>')` per unit, one `it` per ruled leg. Every
// expected value is hand-computed from a documented formula and the derivation
// stands beside the assertion. Nothing here was read off the engine's output.
//
// WITNESSES
//   · document 35 §5 row W23 (:425) — "Order-invariant counters, exact internal
//     rates and bounded validated event time. Rebuild or explicitly reset
//     damaged item and slot state … Test chronological/permuted/replayed
//     sequences, rare concentrated cells, zero rates and timestamp abuse. A
//     local merge patch alone cannot repair historical evidence."
//   · `docs/architecture/35-verification-reports/F18.md` — §2 B (what a single
//     late event costs), §2 C (the skew table), §2 D (the rounding half and the
//     0.0016 / 20 % row), §2 E (the receipt contradicting itself), §2 F (client
//     timestamps: 81.8 % of an item's purchase evidence destroyed by ten
//     crafted events), §3 (where the consequence does NOT reach: the day report,
//     the batch fold, receipt replay and steady-state jitter are NOT defects and
//     nothing here rules against them), §6.3 (a future-dated event suspends
//     decay), §6.4 (significant-digit display), §6.5 (quantization compounding
//     down the ladder), §6.7 (the one-`T0` test that cannot see order), §6.8
//     (`Number(c.weight) || 1`), §8 (the smallest safe fix: the later-anchor
//     `bump` — which is `mergeEntry`'s invariant and is therefore never ruled
//     against —, exact rates memoised, the persisted counters REBUILT ONCE, the
//     client timestamp clamped).
//   · `docs/architecture/22-outcome-learning-design.md` §5.2 — the two formulas
//     this file computes every expectation from:
//         p̂_k  = (s_k + n₀·p₀) / (n_k + n₀)
//         lift = clamp(p̂_k / p₀, L_min, L_max)      L_min 0.5, L_max 2.0
//         c(t) = c(t_last) · e^(−(t − t_last)/τ)     τ_learn default 21 days
//     §4.1 — the reward windows ("click 30 minutes … purchase 7 days"); §5.3 —
//     the worked example; §12.1 — the explain record a person reads and "a
//     script can recompute".
//   · `docs/architecture/16-edge-affinity-reflex.md` :104 — "The engine clock is
//     authoritative. Events are stamped on arrival; client timestamps are
//     advisory only — a forged or skewed clock cannot inflate affinity."
//   · `docs/handover/HANDOFF-2026-09-18.md` §6 :319 (later-anchor decay, order
//     handling, unrounded rates and timestamp validation EXIST; finish the
//     accepted skew/late policy, historical repair or explicit reset and real
//     permutation/replay/rare-cell proof) and §7 the two settled decisions this
//     batch obeys: **Buffered events** (:353) "Explicitly buffered browser/app
//     actions may contribute age-decayed interest plus eligible historical
//     measurement. They must not create fresh visits/recent ODP activity/
//     regional activity on arrival"; **Late history** (:354) "No universal age
//     cutoff inferred from delivery delay … Experiment lifecycle/retained
//     evidence determines eligibility."
//   · `docs/handover/HANDOFF-2026-09-16.md` §6 :227 — "valid calendar/integer
//     timestamps"; "The user's late-buffered decision is not permission to
//     reject all old events or treat their receipt as fresh activity."
//   · GREEN witnesses cited, never edited: `src/routes/realtime.sdkContract.test.ts`
//     :2572-2574 (the buffered path already refuses a non-integer, negative,
//     infinite, out-of-calendar or FUTURE original timestamp), :2591-2594 (a
//     buffered outcome dated 0 or 1 is still transported and still carries its
//     own old `ts`), :367 (the statistics anchor is the event's own timestamp);
//     `src/learn/learn.test.ts` :897 (an outcome 31 minutes after a click
//     decision credits nothing — the window bites in `attribute`).
//
// THE READINGS THIS BATCH IS WRITTEN AGAINST (R116)
//   (a) MEASURED FIRST, unit by unit, before anything was ruled. The probe logs
//       are `_evidence/W23-B1/specifier/logs/probe-A.log` (the four logic
//       measurements), `probe-B.log` (the statistics object) and
//       `probe-C.log`/`probe-C2.log` (both hosts, the operator routes, the
//       receipt). Where a behaviour already holds this file says so in the `it`
//       name, asserts it as a LOCK, and the row names the product line that
//       reverses it.
//   (b) Order invariance is a property of the ONLINE counters and of the
//       published snapshot. "Replayed" here means the ledger's own event-time
//       sequence rebuilt into a FRESH statistics object — never a redelivery of
//       the same logical events into an object that already holds them, which
//       is W22-B1's idempotence and must count ONCE. Every event of the fixture
//       carries a distinct (item, cell, ts) identity, asserted below, so no two
//       events of the multiset can be mistaken for one redelivered event.
//   (c) What a late event may cost is what its age says: e^(−age/τ), never a
//       discount of the evidence already acknowledged.
//   (d) Exact internal rates: children shrink toward the EXACT parent. The
//       "published record" that may be rounded is the PRESENTED record (W23.X1.02);
//       the snapshot is an arithmetic input — `src/learn/stats.ts:168` says so
//       and `liftFor` serves from it — so nothing here demands the snapshot be
//       quantized, and the row records that reading.
//   (e) The receipt is measured before a representation is ruled: today it
//       prints the lift alone and names no baseline (probe C2).
//   (f) Event time. A client time AFTER the engine's own stamp is never admitted
//       as given (doc 16 :104; the buffered path already refuses `now + 1`,
//       `bufferedAction.ts:30`) and the event is still counted. A malformed one
//       is refused. A legitimately OLD one is accepted AS OLD: its own time is
//       kept, no counter clock moves backward, and it is credited only inside
//       the reward's own attribution window; one beyond that window is not
//       learned from and is NAMED on the outcome receipt. No allowance NUMBER is
//       invented anywhere: the future clauses use a year-ahead timestamp, which
//       every finite allowance refuses, and the VALUE goes to `W23.P1.01`.
//   (g) A counter whose stored reference time is ahead of the present decays
//       from the present and is corrected by its next event.
//   (h) Damaged historical state: what exists today is the object's own
//       `/reset` (unreachable from any operator route) and the `coarsen` repair.
//       This batch rules the LOCAL operator-authorised explicit reset and the
//       basis on the published snapshot. Running any repair against production
//       state is not authorized here (`W23.P1.01`).
//   (i) SEAMS, respected and named on every row: W22-B1 owns online idempotence,
//       the late-arrival re-fold, the attribution contract and the ingest loss
//       counters; W24 owns generations and the authorised generation transition;
//       W27 owns replay; W30 owns watermarks. No member name here touches
//       theirs.
//
// RULED MISSING MEMBERS (R21), by the exact name this specification rules:
//   1. `recordExposure(state, item, cell, ts, cfg, now?)` and
//      `recordSuccess(state, item, cell, reward, ts, weight, cfg, now?)`
//      (`src/learn/stats.ts`): a final OPTIONAL `now`, the engine's present,
//      defaulting to the engine's own clock. No counter's reference time may
//      exceed it. Optional because twenty existing call sites — including the
//      batch fold at `src/learn/hourly.ts:226` and `:417` — pass five and seven
//      arguments and must keep compiling; for a fold of historical rows
//      `min(ts, now) === ts`, so F18 §3's "the batch fold is not the defect"
//      stays true.
//   2. `Receipt['lift_terms']` (`src/learn/receipts.ts:9`): the baseline, the
//      estimate and the lift the receipt compares, with the strings it shows
//      them as. A new MEMBER and never a new `why` sentence, because
//      `src/learn/receipts.test.ts:41-51` asserts the exact `why` array.
//   3. `OutcomeReceipt['outsideWindow']` (`src/learn/fan.ts:68`): how many ring
//      decisions this outcome matched but could not be credited to because it
//      fell outside the reward's own attribution window.
//   4. `LiftSnapshot['rebuiltFrom']` (`src/learn/stats.ts:128`): the basis a
//      repaired object's snapshot was built on. Absent on an object that was
//      never repaired, so no existing snapshot assertion moves.
//   5. `intent: 'reset'` on `POST /v1/:tenant/learn/recovery` — the existing
//      audited, human-operator recovery route (`src/routes/decisions.ts:713`),
//      whose only repair intent today is `coarsen`.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { PRIORS_KIND } from '@/learn/priors';
import { invalidateLiftCache } from '@/content/service';
import { storedConsent } from '@/content/consent';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { DEFAULT_REFLEX_CONFIG, effectiveScore, type ReflexEntry } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { memoryStore } from '@/auth/store';
import { memoryAuthority } from '@/auth/authority';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import {
  DEFAULT_STATS, buildSnapshot, emptyStats, recordExposure, recordSuccess,
  type LiftSnapshot, type StatsState,
} from '@/learn/stats';
import { DEFAULT_POLICY } from '@/learn/policy';
import { ringName, statsName, type OutcomeReceipt } from '@/learn/fan';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { parseId, type OutcomeRecord } from '@/ledger/records';
import type { Receipt } from '@/learn/receipts';
import type { Env } from '@/types/env';
import type { Cell, DecisionRecord } from '@/content/types';

// ===========================================================================
// Constants and the two documented formulas (doc 22 §5.2)
// ===========================================================================

const TENANT = 'coach';
const SECOND = 1000, MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
/** τ_learn, doc 22 §5.1 "Configuration, default 21 days"; `DEFAULT_STATS.tauLearnMs`. */
const TAU = DEFAULT_STATS.tauLearnMs;
/** n₀, doc 22 §5.1 "Configuration, default 30". */
const N0 = DEFAULT_STATS.n0;

/** doc 22 §5.2: c(t) = c(t_last) · e^(−(t − t_last)/τ). The age discount of one event. */
const decayed = (ageMs: number): number => Math.exp(-ageMs / TAU);
/** doc 22 §5.2: p̂ = (s + n₀·p₀) / (n + n₀). */
const smoothed = (s: number, n: number, p0: number): number => (s + N0 * p0) / (n + N0);
/** doc 22 §5.2: lift = clamp(p̂/p₀, 0.5, 2.0). */
const clampedLift = (pHat: number, p0: number): number =>
  Math.min(DEFAULT_STATS.liftMax, Math.max(DEFAULT_STATS.liftMin, pHat / p0));

/**
 * The equality this batch means by "to full internal precision".
 *
 * Two deliveries of the same multiset add the same terms in a different order,
 * and IEEE-754 double addition is not associative, so bit equality is not a
 * property any implementation can have. The bound is 1e-12 RELATIVE. Measured
 * (probe A, `logs/probe-A.log`): the worst relative difference over 50 seeded
 * permutations of this file's 328-event multiset is 3.886e-15, about 250× under
 * the bound; the defect the unit rejects is an 11–34× under-count with a 68 %
 * spread (F18 §2 C), about twelve orders of magnitude over it.
 */
const PRECISION = 1e-12;
const relative = (actual: number, expected: number): number =>
  Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
function exactly(actual: number, expected: number, what: string): void {
  expect(relative(actual, expected),
    `${what}: the engine answered ${actual}; the documented formula gives ${expected} (relative difference ${relative(actual, expected)}, bound ${PRECISION})`)
    .toBeLessThan(PRECISION);
}

// ===========================================================================
// The customer's own taxonomy (docs/architecture/tapestry_requirements.txt A.3.6,
// docs/architecture/18-content-affinity-engine.md): Coach lines, Coach cells,
// two affinity cells that differ only at the sixth level of the ladder, plus an
// UNKNOWN-channel cell and a cross-category one so the fixture is not a single
// tidy cell.
// ===========================================================================

const cellTabby = { channel: 'paid_social', visit_bucket: '1', stage: 'mid', region: 'US-NY', affinity: 'line:Tabby' } as unknown as Cell;
const cellRogue = { channel: 'paid_social', visit_bucket: '1', stage: 'mid', region: 'US-NY', affinity: 'line:Rogue' } as unknown as Cell;
const cellUnknown = { channel: 'unknown', visit_bucket: '4+', stage: 'late', region: null, affinity: null } as unknown as Cell;
const KEYS_TABBY = ['*', 'c=paid_social', 'c=paid_social|v=1', 'c=paid_social|v=1|s=mid',
  'c=paid_social|v=1|s=mid|r=US-NY', 'c=paid_social|v=1|s=mid|r=US-NY|a=line:Tabby'] as const;
const KEY_ROGUE = 'c=paid_social|v=1|s=mid|r=US-NY|a=line:Rogue';
/** A real Coach product id from the shipped catalogue (`src/data/coach-catalog.json`). */
const PRODUCT = 'COA-CH857';
const ITEM_A = 'cnt-tabby-after-dark', ITEM_B = 'cnt-rogue-at-work', ITEM_C = 'cnt-legacy-carryall';

const SLOT = 'hero';
const CONFIG = { reward: 'purchase' as const, stats: DEFAULT_STATS, objective: 'unit' as const, measurementBasis: 'served-v1' as const };

// ===========================================================================
// The multiset (R116(b)). 330 events over fourteen days — never one `T0`
// (F18 §6.7) — with EVERY event carrying a distinct (item, cell, ts) identity,
// so a permutation is a reordering of distinct events and the "replay" below is
// a rebuild, not a redelivery (W22-B1 owns redelivery).
// ===========================================================================

interface Ev { kind: 'exposure' | 'credit'; item: string; cell: Cell; ts: number; weight?: number }

function multiset(anchorNow: number, n = 300): Ev[] {
  const events: Ev[] = [];
  for (let i = 0; i < n; i++) {
    const ts = anchorNow - 14 * DAY + Math.floor((i * 14 * DAY) / n) + (i % 7) * 137 * SECOND;
    const item = i % 3 === 0 ? ITEM_A : i % 3 === 1 ? ITEM_B : ITEM_C;
    const cell = i % 5 === 0 ? cellRogue : i % 11 === 0 ? cellUnknown : cellTabby;
    events.push({ kind: 'exposure', item, cell, ts });
    if (i % 11 === 0) events.push({ kind: 'credit', item, cell, ts: ts + 3 * HOUR, weight: 1 });
  }
  return events;
}
const chronological = (events: Ev[]): Ev[] => events.slice().sort((a, b) => a.ts - b.ts || a.item.localeCompare(b.item));
/** A seeded, reproducible permutation (linear congruential; no wall clock, no Math.random). */
function permuted(events: Ev[], seed: number): Ev[] {
  const out = events.slice(); let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
function applyLogic(events: Ev[]): StatsState {
  const state = emptyStats();
  for (const e of events) {
    if (e.kind === 'exposure') recordExposure(state, e.item, e.cell, e.ts, DEFAULT_STATS);
    else recordSuccess(state, e.item, e.cell, 'purchase', e.ts, e.weight ?? 1, DEFAULT_STATS);
  }
  return state;
}
/** Every numeric leaf of two counter maps, compared to full internal precision; every key and anchor exactly. */
function sameCounters(actual: StatsState, expected: StatsState, what: string): void {
  expect(Object.keys(actual.items).sort(), `${what}: the same items must be present`).toEqual(Object.keys(expected.items).sort());
  expect(Object.keys(actual.slot).sort(), `${what}: the same slot keys must be present`).toEqual(Object.keys(expected.slot).sort());
  expect(actual.events, `${what}: the same number of events`).toBe(expected.events);
  expect(actual.updatedAt, `${what}: the same last-updated time`).toBe(expected.updatedAt);
  const maps: Array<[string, Record<string, { n: ReflexEntry; s: Partial<Record<string, ReflexEntry>> }>]> =
    [['slot', actual.slot], ...Object.entries(actual.items)];
  for (const [name, map] of maps) {
    const other = name === 'slot' ? expected.slot : expected.items[name]!;
    expect(Object.keys(map).sort(), `${what}: ${name} carries the same cells`).toEqual(Object.keys(other).sort());
    for (const key of Object.keys(map)) {
      expect(map[key]!.n.t, `${what}: ${name}/${key} reference time`).toBe(other[key]!.n.t);
      exactly(map[key]!.n.s, other[key]!.n.s, `${what}: ${name}/${key} exposures`);
      const purchase = map[key]!.s.purchase, expectedPurchase = other[key]!.s.purchase;
      expect(purchase === undefined, `${what}: ${name}/${key} credit presence`).toBe(expectedPurchase === undefined);
      if (purchase && expectedPurchase) {
        expect(purchase.t, `${what}: ${name}/${key} credit reference time`).toBe(expectedPurchase.t);
        exactly(purchase.s, expectedPurchase.s, `${what}: ${name}/${key} credits`);
      }
    }
  }
}
/** Every numeric leaf of two published snapshots, ignoring the members that legitimately name the object. */
function sameSnapshot(actual: Record<string, unknown>, expected: Record<string, unknown>, what: string, ignore: string[]): void {
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (typeof b === 'number') { exactly(a as number, b, `${what}: ${path}`); return; }
    if (b !== null && typeof b === 'object') {
      const keysA = Object.keys(a as object).filter(k => !ignore.includes(k)).sort();
      const keysB = Object.keys(b as object).filter(k => !ignore.includes(k)).sort();
      expect(keysA, `${what}: ${path} carries the same members`).toEqual(keysB);
      for (const key of keysB) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      return;
    }
    expect(a, `${what}: ${path}`).toEqual(b);
  };
  walk(actual, expected, 'snapshot');
}

// ===========================================================================
// The mounted application, in process, on either shopper host, with the real
// Durable Object classes over a storage stub. The idioms are the ones
// `src/units/W20/B3.unit.test.ts` and `src/routes/realtime.sdkContract.test.ts`
// use; neither file is imported or edited.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}
class UnitR2 {
  objects = new Map<string, string>(); versions = new Map<string, number>(); metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length, customMetadata: this.metadata.get(key),
      body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}
const fixtureRetentionPolicy: RetentionPolicy = { id: 'w23-b1-fixture-policy', revision: 1, durationMs: 365 * DAY, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(t => [t,
  Object.fromEntries(RETENTION_CATEGORIES.map(c => [c, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

const OPERATOR_SECRET = 'w23-b1-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';

interface MountOptions {
  /** `customer` admits the durable behavior record the ordinary demo profile declines (`src/ledger/behavior.ts:21`). */
  profile?: 'demo' | 'customer';
  /** The audited recovery route needs a live human operator account, session and tenant admin membership. */
  human?: boolean;
}

async function mount(host: 'session' | 'do' = 'session', options: MountOptions = {}) {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const cache = new UnitKV(), sessions = new UnitKV(), storage = new UnitR2();
  const pending: Promise<unknown>[] = [];
  const shopperObjects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>();
  const learnObjects = new Map<string, { shopper: LearnStats; data: Map<string, unknown> }>();
  const ringObjects = new Map<string, { shopper: DecisionRing; data: Map<string, unknown> }>();
  const at = Date.now();
  const accounts = memoryStore(), authority = memoryAuthority(accounts);
  await accounts.put({ id: 'ops', email: 'ops@example.invalid', name: 'Operator', roles: ['operator', 'admin'], permissions: ['*'], updatedAt: at });
  await accounts.putSession({ jti: 'w23-session', accountId: 'ops', tokenHash: 'synthetic', createdAt: at, expiresAt: at + 3_600_000 });
  authority.memberships.set(JSON.stringify(['ops', TENANT]),
    { tenant: TENANT, accountId: 'ops', role: 'admin' as const, revision: 'r1', updatedAt: at, disabled: false, removed: false });
  const env = {
    DEPLOYMENT_PROFILE: options.profile ?? (options.human ? 'customer' : 'demo'),
    ...(options.human ? { AUTH_MODE: 'enforced', ACCOUNTS: accounts, AUTHORITY: authority } : {}),
    CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: storage, JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    IDENTITY_SECRETS: `${TENANT}:w23-b1-identity-proof-material`,
    IDENTITY_SALT: 'w23-b1-identity-salt-material-long-enough',
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    LEDGER_RECOVERY_ENABLED: (options.profile ?? '') === 'customer' ? 'true' : 'false',
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => undefined },
    RETENTION: JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) }),
  } as unknown as Env;
  const namespaceFor = <T extends { fetch: (r: Request) => Promise<Response> }>(
    make: (s: DurableObjectState, e: Env) => T, registry: Map<string, { shopper: T; data: Map<string, unknown> }>,
  ) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = registry.get(name);
      if (!item) {
        const data = new Map<string, unknown>(); const alarms: number[] = [], sockets: WebSocket[] = [];
        const st = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => { if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value)); },
          list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) => structuredClone(new Map([...data]
            .filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
            .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data); let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const l = typeof keys === 'string' ? [keys] : keys; for (const key of l) candidate.delete(key); return l.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => { if (typeof values === 'string') candidate.set(values, structuredClone(value)); else for (const [key, v2] of Object.entries(values)) candidate.set(key, structuredClone(v2)); },
              deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (a: number) => { nextAlarm = a; } } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [k2, v2] of candidate) data.set(k2, v2);
            if (deleteAlarm) alarms.length = 0; if (nextAlarm !== undefined) alarms.push(nextAlarm);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
          setAlarm: async (a: number) => { alarms.push(a); }, getAlarm: async () => alarms.at(-1) ?? null,
        };
        const state = { id: name, storage: st, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, shopper: make(state, env) }; registry.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespaceFor((s, e) => new ShopperReflex(s, e), shopperObjects) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((s, e) => new DecisionRing(s, e), ringObjects) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((s, e) => new LearnStats(s, e), learnObjects) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const serviceToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h').sign(new TextEncoder().encode(OPERATOR_SECRET));
  const accessToken = await new jose.SignJWT({ sub: 'ops', type: 'access', sid: 'w23-session', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h').sign(new TextEncoder().encode(OPERATOR_SECRET));
  const fetchOne = (request: Request) => app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 20)); };
  return { env, cache, storage, shopperObjects, learnObjects, ringObjects, drain, fetch: fetchOne, serviceToken, accessToken };
}
type Mounted = Awaited<ReturnType<typeof mount>>;

/** The five documents a provisioned tenant holds, published through the real publication set. */
async function publishFixture(m: Mounted): Promise<void> {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w23-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(m.env, [
    baseline(CONTENT_KIND, { version: 'w23-b1-coach-catalogue', pieces: [] }),
    baseline(SLOTS_KIND, { version: 'w23-b1-coach-slots', pages: {} }),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w23-b1', arms: ['default'] },
      regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: { [SLOT]: { reward: 'purchase', objective: 'unit' } } }),
    baseline(PRIORS_KIND, { rows: [] }),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
}

/** The statistics object's own door — the one `src/learn/fan.ts` drives. */
const statsCall = (m: Mounted, brand: string, path: string, body: unknown) =>
  m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(statsName(TENANT, brand, SLOT)))
    .fetch('https://learn' + path, { method: 'POST', body: JSON.stringify(body) });
const storedStats = (m: Mounted, brand: string): StatsState =>
  (m.learnObjects.get(statsName(TENANT, brand, SLOT))!.data.get('learn') as { stats: StatsState }).stats;

/** One delivery of a multiset through the real object, preserving the delivery order exactly. */
async function deliver(m: Mounted, brand: string, events: Ev[]): Promise<void> {
  let i = 0;
  while (i < events.length) {
    const kind = events[i]!.kind; const run: Ev[] = [];
    while (i < events.length && events[i]!.kind === kind) run.push(events[i++]!);
    const body = kind === 'exposure'
      ? { tenant: TENANT, brand, slot: SLOT, config: CONFIG, exposures: run.map(e => ({ item: e.item, cell: e.cell, ts: e.ts })) }
      : { tenant: TENANT, brand, slot: SLOT, config: CONFIG, credits: run.map(e => ({ item: e.item, cell: e.cell, ts: e.ts, reward: 'purchase', weight: e.weight ?? 1 })) };
    const response = await statsCall(m, brand, kind === 'exposure' ? '/exposures' : '/credits', body);
    expect(response.status, `${brand}: the statistics object must accept the ${kind} batch`).toBe(200);
  }
}

const operatorGet = async (m: Mounted, path: string, token?: string) => {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path,
    { headers: { Authorization: `Bearer ${token ?? m.serviceToken}`, 'X-Tenant': TENANT } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
};
const operatorPost = async (m: Mounted, path: string, body: unknown, token?: string) => {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { method: 'POST',
    headers: { Authorization: `Bearer ${token ?? m.serviceToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json' },
    body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
};

/** A consented shopper with a real session capability, as `realtime.sdkContract.test.ts` composes one. */
async function shopperOn(m: Mounted) {
  const grant = await newAnonymousSession(m.env, TENANT);
  const call = (path: string, body?: unknown) => m.fetch(new Request(`https://synthetic.invalid${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const current = m.shopperObjects.get(shopperObjectName(TENANT, grant.subject))?.data.get('consent');
  const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const preferences = await call(`/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true, choice });
  expect(preferences.status, 'the fixture shopper must be able to consent').toBe(200);
  await m.drain();
  return { grant, call };
}

// ===========================================================================
// unit:W23.O1.01 — order-invariant online counters
// ===========================================================================

describe('unit:W23.O1.01', () => {
  /**
   * doc 35 §5 W23 (:425) "Order-invariant counters … Test chronological/
   * permuted/replayed sequences". F18 §2 C measured HEAD at n ∈ [3.20, 10.11]
   * against a true 109.72 over 200 permutations of a 525-event set.
   *
   * The invariant is algebraic, not a tolerance: with the counter's clock at
   * t = max(anchor, ts) and every contribution discounted to it, the counter at
   * read time T is Σ w_i · e^(−(T − ts_i)/τ) whatever order the events arrive
   * in. Measured today (probe A): GREEN, worst relative spread 3.886e-15.
   */
  it('logic: one multiset delivered chronologically, under seeded permutations and as an event-time rebuild leaves identical counters, and no counter clock ever moves backward', () => {
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    const events = multiset(now);
    // The fixture is a multiset of DISTINCT events (R116(b)); a permutation of it
    // is a reordering, never a redelivery of one event (W22-B1 owns redelivery).
    const identities = new Set(events.map(e => `${e.kind}|${e.item}|${JSON.stringify(e.cell)}|${e.ts}`));
    expect(identities.size, 'the fixture must hold 328 distinct events').toBe(events.length);
    expect(events.length).toBe(328);
    // Fourteen days of event time, never one T0 (F18 §6.7).
    expect(Math.max(...events.map(e => e.ts)) - Math.min(...events.map(e => e.ts))).toBeGreaterThan(13 * DAY);

    const base = applyLogic(chronological(events));
    for (const seed of [1, 7, 13, 42, 1009, 65_537, 99_991, 2_147_483_647, 12_345, 777, 31_337, 8_191]) {
      sameCounters(applyLogic(permuted(events, seed)), base, `permutation seed ${seed}`);
    }
    // "Replayed" (R116(b)): the same event-time sequence rebuilt into a FRESH
    // object, which is what a ledger replay does; not a redelivery into an
    // object that already holds those events.
    sameCounters(applyLogic(chronological(events)), base, 'event-time rebuild');

    // A counter's reference time never decreases, event by event, in the worst
    // delivery order: the reversed one.
    const state = emptyStats(); let worst = 0;
    for (const e of permuted(events, 5).slice().reverse()) {
      const before = state.slot['*']?.n.t ?? 0;
      if (e.kind === 'exposure') recordExposure(state, e.item, e.cell, e.ts, DEFAULT_STATS);
      else recordSuccess(state, e.item, e.cell, 'purchase', e.ts, e.weight ?? 1, DEFAULT_STATS);
      const after = state.slot['*']?.n.t ?? 0;
      expect(after, `the slot's reference time must never move backward (was ${before}, became ${after})`).toBeGreaterThanOrEqual(before);
      worst = Math.max(worst, before - after);
    }
    expect(worst).toBe(0);
    // And the published estimates agree: p̂ and lift at one evaluation instant.
    const ids = { tenant: TENANT, brand: TENANT, slot: SLOT };
    const chronoSnap = buildSnapshot(base, ids, 'purchase', now, DEFAULT_STATS);
    const permutedSnap = buildSnapshot(applyLogic(permuted(events, 42)), ids, 'purchase', now, DEFAULT_STATS);
    sameSnapshot(permutedSnap as unknown as Record<string, unknown>, chronoSnap as unknown as Record<string, unknown>,
      'the published estimates under permutation', []);
  });

  it('host-internal: the real statistics object holds identical counters for the chronological, the permuted and the rebuilt delivery', async () => {
    const m = await mount();
    const now = Date.now();
    const events = multiset(now, 60);
    await deliver(m, 'coach-chronological', chronological(events));
    await deliver(m, 'coach-permuted', permuted(events, 20_260_919));
    await deliver(m, 'coach-rebuilt', chronological(events));
    const base = storedStats(m, 'coach-chronological');
    sameCounters(storedStats(m, 'coach-permuted'), base, 'the statistics object under a seeded permutation');
    sameCounters(storedStats(m, 'coach-rebuilt'), base, 'the statistics object under an event-time rebuild');
    // The object's own clock never moved backward: every anchor is an event time
    // of the multiset, and the root anchor is the newest exposure.
    const newestExposure = Math.max(...events.filter(e => e.kind === 'exposure').map(e => e.ts));
    expect(base.slot['*']!.n.t, 'the slot root is anchored at the newest exposure of the multiset').toBe(newestExposure);
  });

  it('host: the snapshot published through POST /learn/publish and served by GET /lift is the same for all three deliveries', async () => {
    // The clock is pinned so the three publications are evaluated at ONE instant:
    // a snapshot is decayed to `Date.now()` (`LearnStats.ts:468`), so comparing
    // two publications taken at two wall-clock instants would compare two
    // different questions. Only `Date` is faked; timers stay real.
    const pinned = Date.parse('2026-09-19T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'], now: pinned });
    try {
      const m = await mount();
      await publishFixture(m);
      const events = multiset(pinned, 60);
      const deliveries: Array<[string, Ev[]]> = [
        ['coach-chronological', chronological(events)],
        ['coach-permuted', permuted(events, 20_260_919)],
        ['coach-rebuilt', chronological(events)],
      ];
      const served: Record<string, Record<string, unknown>> = {};
      for (const [brand, ordered] of deliveries) {
        await deliver(m, brand, ordered);
        const published = await operatorPost(m, `/v1/${TENANT}/learn/publish`, { slot: SLOT, brand });
        expect(published.status, `${brand}: the operator must be able to publish`).toBe(200);
        expect(published.body.published, `${brand}: a slot with evidence publishes a snapshot`).toBe(true);
        const read = await operatorGet(m, `/v1/${TENANT}/lift?slot=${SLOT}&brand=${brand}`);
        expect(read.status, `${brand}: the published snapshot must be served`).toBe(200);
        expect(read.body.snapshot, `${brand}: the served snapshot must not be empty`).toBeTruthy();
        served[brand] = read.body.snapshot as Record<string, unknown>;
      }
      // `brand` and `witness` name the object, not the arithmetic: the witness is
      // a digest over tenant/brand/slot/config/fence (`LearnStats.ts:587`).
      for (const brand of ['coach-permuted', 'coach-rebuilt']) {
        sameSnapshot(served[brand]!, served['coach-chronological']!,
          `the snapshot served for ${brand} against the chronological delivery`, ['brand', 'witness']);
      }
    } finally { vi.useRealTimers(); }
  });
});

// ===========================================================================
// unit:W23.O1.02 — a late event costs what its age says
// ===========================================================================

describe('unit:W23.O1.02', () => {
  /**
   * F18 §2 B measured at HEAD: 1 000 exposures, then ONE arrival back-dated by
   * Δ, read at the same instant — 1000.966 / 999.015 / 954.450 / 717.247 for
   * Δ = 1 min / 1 h / 24 h / 7 d, i.e. up to 283.8 units of acknowledged
   * evidence destroyed by one late event.
   *
   * The honest value is neither 1001 nor 717.247. By doc 22 §5.2 the evidence
   * already acknowledged at the counter's clock is untouched and the late event
   * contributes its own age discount:
   *     n_after = 1000 + e^(−Δ/τ),  τ = 1 814 400 000 ms
   *     Δ = 1 min → 1000.9999669317637   (e^(−Δ/τ) = 0.9999669317636974)
   *     Δ = 1 h   → 1000.9980178400946   (0.9980178400946245)
   *     Δ = 24 h  → 1000.9534969548335   (0.9534969548334767)
   *     Δ = 7 d   → 1000.7165313105738   (0.7165313105737893)
   */
  it('logic: one late arrival adds its own age discount and destroys none of the evidence already acknowledged', () => {
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    for (const delta of [MIN, HOUR, 24 * HOUR, 7 * DAY]) {
      const state = emptyStats();
      for (let i = 0; i < 1000; i++) recordExposure(state, ITEM_A, cellTabby, now, DEFAULT_STATS);
      const counter = state.items[ITEM_A]!['*']!;
      exactly(effectiveScore(counter.n, now, TAU), 1000, `${delta} ms: the 1 000 acknowledged exposures before the late arrival`);
      recordExposure(state, ITEM_A, cellTabby, now - delta, DEFAULT_STATS);
      exactly(effectiveScore(counter.n, now, TAU), 1000 + decayed(delta),
        `${delta} ms late: the counter must hold 1000 + e^(−${delta}/τ) = ${1000 + decayed(delta)}`);
      expect(counter.n.t, `${delta} ms late: the counter's clock stays at the newest acknowledged event`).toBe(now);
    }
  });

  /**
   * F18 §2 F, the crafted-purchase table: an attacker drives their own visitor
   * id and posts purchases dated `now − 7 d + 1 s` naming the served item. At
   * HEAD one crafted event took the item from 296.4 to 240.1 and ten took it to
   * 104.9 — 81.8 % of the item's purchase evidence destroyed.
   *
   * With the age discount (doc 22 §5.2) the honest values for a counter holding
   * 40 acknowledged purchases are, with e^(−(7 d − 1 s)/τ) = 0.7165317054875393:
   *      1 crafted event → 40.71653170548754
   *      3 crafted events → 42.14959511646262
   *     10 crafted events → 47.165317054875395
   * and the slot's own counter moves by exactly the same amount, because a
   * credit for an item in a slot IS the slot's credit — while every OTHER item
   * is untouched to the bit.
   */
  it('logic: one, three and ten crafted purchases dated now − 7 d + 1 s move the item by their own honest contribution and no other item at all', () => {
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    const age = 7 * DAY - SECOND;
    for (const crafted of [1, 3, 10]) {
      const state = emptyStats();
      for (let i = 0; i < 1000; i++) recordExposure(state, ITEM_A, cellTabby, now, DEFAULT_STATS);
      for (let i = 0; i < 40; i++) recordSuccess(state, ITEM_A, cellTabby, 'purchase', now, 1, DEFAULT_STATS);
      for (let i = 0; i < 200; i++) recordExposure(state, ITEM_B, cellRogue, now, DEFAULT_STATS);
      for (let i = 0; i < 6; i++) recordSuccess(state, ITEM_B, cellRogue, 'purchase', now, 1, DEFAULT_STATS);
      const other = structuredClone(state.items[ITEM_B]!);
      const honest = 40 + crafted * decayed(age);
      for (let i = 0; i < crafted; i++) recordSuccess(state, ITEM_A, cellTabby, 'purchase', now - age, 1, DEFAULT_STATS);
      exactly(effectiveScore(state.items[ITEM_A]!['*']!.s.purchase!, now, TAU), honest,
        `${crafted} crafted purchase(s): the item must hold 40 + ${crafted}·e^(−(7 d − 1 s)/τ) = ${honest}`);
      exactly(effectiveScore(state.items[ITEM_A]![KEYS_TABBY[5]]!.s.purchase!, now, TAU), honest,
        `${crafted} crafted purchase(s): the affinity cell must hold the same ${honest}`);
      // The slot as a whole holds its own 6 honest purchases from the other item
      // plus the same crafted contribution, and nothing is taken from either.
      exactly(effectiveScore(state.slot['*']!.s.purchase!, now, TAU), honest + 6,
        `${crafted} crafted purchase(s): the slot must hold ${honest + 6}`);
      exactly(effectiveScore(state.items[ITEM_B]!['*']!.s.purchase!, now, TAU), 6,
        `${crafted} crafted purchase(s): the other item's 6 purchases are untouched`);
      expect(state.items[ITEM_B], `${crafted} crafted purchase(s): the other item's counters are unchanged`).toEqual(other);
    }
  });

  it('host-internal: ten crafted credits dated now − 7 d + 1 s leave the real statistics object at the honest value', async () => {
    const m = await mount();
    const now = Date.now();
    const age = 7 * DAY - SECOND;
    await statsCall(m, TENANT, '/exposures', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      exposures: Array.from({ length: 100 }, () => ({ item: ITEM_A, cell: cellTabby, ts: now })) });
    await statsCall(m, TENANT, '/credits', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      credits: Array.from({ length: 40 }, () => ({ item: ITEM_A, cell: cellTabby, ts: now, reward: 'purchase', weight: 1 })) });
    const before = structuredClone(storedStats(m, TENANT).items[ITEM_A]!['*']!.s.purchase!);
    exactly(before.s, 40, 'the object holds the 40 acknowledged purchases');
    const crafted = await statsCall(m, TENANT, '/credits', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      credits: Array.from({ length: 10 }, () => ({ item: ITEM_A, cell: cellTabby, ts: now - age, reward: 'purchase', weight: 1 })) });
    expect(crafted.status, 'the crafted credits are admitted as evidence, at their own age').toBe(200);
    const after = storedStats(m, TENANT).items[ITEM_A]!['*']!.s.purchase!;
    expect(after.t, "the object's clock stays at the newest acknowledged credit").toBe(before.t);
    exactly(effectiveScore(after, now, TAU), 40 + 10 * decayed(age),
      `ten crafted credits: the object must hold 40 + 10·e^(−(7 d − 1 s)/τ) = ${40 + 10 * decayed(age)}`);
  });
});

// ===========================================================================
// unit:W23.X1.01 — exact internal rates
// ===========================================================================

describe('unit:W23.X1.01', () => {
  /**
   * FIXTURE R — the 0.0016 row of F18 §2 D ("20 % lift error at a 0.0016 true
   * rate", §6.5), down the whole six-level ladder, with all the successes
   * concentrated in ONE affinity cell and a second cell at a true zero rate.
   *
   *   slot, Tabby cell: 2 000 exposures, 4 purchases
   *   slot, Rogue cell:   500 exposures, 0 purchases
   *   item A (Tabby):     500 exposures, 2 purchases
   *   item B (Rogue):     500 exposures, 0 purchases
   *
   * Hand-computed from doc 22 §5.2 (the root shrinks toward itself, so its rate
   * is s/n exactly; each child shrinks toward the EXACT parent):
   *   p₀(*) = 4/2500                                   = 0.0016
   *   p₀(levels 1-4) = (4 + 30·0.0016)/(2500 + 30)     = 0.0016
   *   p₀(Tabby cell) = (4 + 30·0.0016)/(2000 + 30)     = 0.0019940886699507387
   *   p₀(Rogue cell) = (0 + 30·0.0016)/(500 + 30)      = 0.00009056603773584906
   *   p̂ (A, Tabby)  = (2 + 30·0.0019940886…)/(500+30) = 0.0038864578492424947
   *   lift(A, Tabby) = 0.0038864578…/0.0019940886…     = 1.9489894846744726
   *   p̂ (B, Rogue)  = (0 + 30·0.00009056603…)/(530)   = 0.000005126379494482023
   *   lift(B, Rogue) = clamp(0.0566…, 0.5, 2)          = 0.5
   * Under the audited three-decimal memoisation (`stats.ts:122` at HEAD) the
   * same fixture answers p₀ = 0.002 and lift 1.9433962264150944 — a different
   * number in the third digit, which this unit's exact equality rejects.
   */
  it('logic: at a 0.0016 true rate the whole ladder, the rare concentrated cell and the zero-rate cell carry the exact hand-computed values, and nothing non-finite reaches the wire', () => {
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    const state = emptyStats();
    for (let i = 0; i < 2000; i++) recordExposure(state, i < 500 ? ITEM_A : ITEM_C, cellTabby, now, DEFAULT_STATS);
    for (let i = 0; i < 4; i++) recordSuccess(state, i < 2 ? ITEM_A : ITEM_C, cellTabby, 'purchase', now, 1, DEFAULT_STATS);
    for (let i = 0; i < 500; i++) recordExposure(state, ITEM_B, cellRogue, now, DEFAULT_STATS);
    const snap = buildSnapshot(state, { tenant: TENANT, brand: TENANT, slot: SLOT }, 'purchase', now, DEFAULT_STATS);

    const p0Root = 4 / 2500;
    const p0Tabby = smoothed(4, 2000, p0Root);
    const p0Rogue = smoothed(0, 500, p0Root);
    for (const key of KEYS_TABBY.slice(0, 5)) {
      exactly(snap.slotRates[key]!.rate, p0Root, `the slot's rate at ${key} must be the exact 4/2500 = ${p0Root}`);
    }
    exactly(snap.slotRates[KEYS_TABBY[5]]!.rate, p0Tabby,
      `the slot's rate in the concentrated cell must be (4 + 30·${p0Root})/2030 = ${p0Tabby}`);
    exactly(snap.slotRates[KEY_ROGUE]!.rate, p0Rogue,
      `the slot's rate in the zero-rate cell must be (0 + 30·${p0Root})/530 = ${p0Rogue}`);

    const a = snap.items[ITEM_A]![KEYS_TABBY[5]]!;
    exactly(a.p0, p0Tabby, "the item's baseline is the slot's exact rate in its own cell");
    exactly(a.p_hat, smoothed(2, 500, p0Tabby), `p̂ must be (2 + 30·${p0Tabby})/530 = ${smoothed(2, 500, p0Tabby)}`);
    exactly(a.lift, clampedLift(smoothed(2, 500, p0Tabby), p0Tabby),
      `the lift must be ${clampedLift(smoothed(2, 500, p0Tabby), p0Tabby)}, not the 1.9433962264150944 a three-decimal baseline gives`);

    const b = snap.items[ITEM_B]![KEY_ROGUE]!;
    exactly(b.p0, p0Rogue, "the zero-rate cell's baseline");
    exactly(b.p_hat, smoothed(0, 500, p0Rogue), `p̂ at a zero rate must be (0 + 30·${p0Rogue})/530 = ${smoothed(0, 500, p0Rogue)}`);
    exactly(b.lift, clampedLift(smoothed(0, 500, p0Rogue), p0Rogue), 'the lift at a zero rate is the clamped exact ratio');

    // On the wire: every number finite, no null where a number belongs.
    const wire = JSON.parse(JSON.stringify(snap)) as unknown;
    const finite = (value: unknown, path: string): void => {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${path} must be a finite number on the wire, not ${value}`).toBe(true);
      } else if (value !== null && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) finite(inner, `${path}.${key}`);
      } else if (value === null) {
        expect(path, `${path} must not be null on the wire: a non-finite number serializes to null`).toBe('');
      }
    };
    finite(wire, 'snapshot');
  });

  /**
   * FIXTURE Z — the collapse of F18 §2 D: a true rate of 0.0004, below the
   * 0.0005 the audited three-decimal rounding takes to zero, where "every item
   * at every level gets lift exactly 1" and learning is a silent no-op.
   *
   *   slot: 10 000 exposures, 4 purchases, all in one cell → p₀ = 0.0004
   *   item: 4 000 of those exposures, 2 of those purchases
   *   p̂    = (2 + 30·0.0004)/(4000 + 30) = 0.0004992555831265508
   *   lift = 0.0004992555831265508/0.0004 = 1.248138957816377
   * A published baseline of 0 forces `lift = 1` (`stats.ts:201`); the honest
   * answer is 1.248138957816377.
   */
  it('logic: at a 0.0004 true rate the baseline is not taken to zero and the lift is not forced to 1', () => {
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    const state = emptyStats();
    for (let i = 0; i < 10_000; i++) recordExposure(state, i < 4000 ? ITEM_A : ITEM_C, cellTabby, now, DEFAULT_STATS);
    for (let i = 0; i < 4; i++) recordSuccess(state, i < 2 ? ITEM_A : ITEM_C, cellTabby, 'purchase', now, 1, DEFAULT_STATS);
    const snap = buildSnapshot(state, { tenant: TENANT, brand: TENANT, slot: SLOT }, 'purchase', now, DEFAULT_STATS);
    const p0 = 4 / 10_000, ladder = smoothed(4, 10_000, p0);
    exactly(snap.slotRates['*']!.rate, p0, `the root rate must be the exact 4/10000 = ${p0}`);
    exactly(snap.slotRates[KEYS_TABBY[5]]!.rate, ladder, `the sixth level must be (4 + 30·${p0})/10030 = ${ladder}`);
    const a = snap.items[ITEM_A]![KEYS_TABBY[5]]!;
    exactly(a.p_hat, smoothed(2, 4000, ladder), `p̂ must be (2 + 30·${ladder})/4030 = ${smoothed(2, 4000, ladder)}`);
    exactly(a.lift, clampedLift(smoothed(2, 4000, ladder), ladder),
      `the lift must be ${clampedLift(smoothed(2, 4000, ladder), ladder)}, never the 1 a baseline rounded to zero gives`);
  });
});

// ===========================================================================
// unit:W23.X1.02 — the receipt agrees with itself at rare rates
// ===========================================================================

describe('unit:W23.X1.02', () => {
  /**
   * F18 §2 E: "receipt shows p0=0, p_hat=0.001, lift=1; p_hat/p0 = division by
   * zero … A receipt carrying `p0: 0` beside `p_hat: 0.001` and `lift: 1` is not
   * an explanation." §6.4: it STAYS imprecise after the precision fix, because
   * display rounding is fixed three-decimal and must become significant-digit
   * based. Doc 22 §12.1 promises an explain record that "a person can read" and
   * "a script can recompute", carrying n, s, p0, n0, p̂, lift and γ.
   *
   * MEASURED FIRST (probe C2): the receipt served by
   * `GET /v1/:tenant/visitors/:id/receipts` prints
   *   "Learned lift 1.949 from channel, visit bucket, stage, region and affinity
   *    cell (500 served exposures, 2 weighted credit in unit units), shown on
   *    the receipt, not applied (trust 0)."
   * — the lift alone, at three decimals, with no baseline anywhere on the
   * receipt. There is nothing on it to agree or disagree with, so nothing on it
   * can be recomputed.
   *
   * RULED (R21): `Receipt['lift_terms']` — the exact terms the sentence compares
   * and the strings the receipt shows them as. A MEMBER, never a new or altered
   * `why` sentence, because `src/learn/receipts.test.ts:41-51` asserts the exact
   * `why` array of a receipt and this batch may not move it.
   *
   * Two records at two different rates, so no stamped constant can satisfy both:
   * the rare cell of fixture R and doc 22 §12.1's own worked example.
   */
  it('host: a receipt at a rare rate names the baseline it compared against, legibly below 0.001, and its printed terms agree with each other', async () => {
    const m = await mount();
    await publishFixture(m);
    const now = Date.now();
    const visitor = 'w23-b1-shopper';
    const decision = (ordinal: number, item: string, lift: Record<string, unknown>): DecisionRecord => ({
      decision_id: `${TENANT}:${(now - ordinal).toString(36)}:${visitor}:home:${SLOT}:${ordinal}`,
      tenant: TENANT, brand: TENANT, visitor_id: visitor, session_id: 'w23-b1-browsing', identity_anchor: 'visitor',
      ts: now - ordinal, page: 'home', slot: SLOT, position: ordinal, item_id: item, customer_item_id: `CMS-${item}`,
      candidates: [], cell: { channel: 'paid_social', visit_bucket: '1', region: 'US-NY', affinity: 'line:Tabby', stage: 'mid' },
      arm: 'personalized', explored: false, authority: 'engine',
      versions: { config: 1, lift: 2, prior: 0, policy: 1 }, config_label: 'w23-b1',
      explain: { drivers: [], score_base: 0.4, lift: lift as never, score_final: 0.4 },
      retention: captureRetention(m.env, TENANT, now - ordinal),
    } as unknown as DecisionRecord);

    // The rare cell of fixture R, exactly as W23.X1.01 computes it — one
    // representation shared by the two units.
    const p0Rare = smoothed(4, 2000, 4 / 2500);                 // 0.0019940886699507387
    const pHatRare = smoothed(2, 500, p0Rare);                  // 0.0038864578492424947
    const liftRare = clampedLift(pHatRare, p0Rare);             // 1.9489894846744726
    // Doc 22 §12.1's own example: n 120, s 9, p0 0.05, n0 30, p̂ 0.070, lift 1.40.
    const p0Worked = 0.05, pHatWorked = smoothed(9, 120, p0Worked), liftWorked = clampedLift(pHatWorked, p0Worked);
    exactly(pHatWorked, 0.07, "doc 22 §5.3's worked p̂");
    exactly(liftWorked, 1.4, "doc 22 §5.3's worked lift");

    const records = [
      decision(0, ITEM_A, { reward: 'purchase', objective: 'unit', level: 5,
        level_words: 'channel, visit bucket, stage, region and affinity cell',
        n: 500, s: 2, p0: p0Rare, n0: N0, p_hat: pHatRare, lift: liftRare, gamma: 0 }),
      decision(1, ITEM_B, { reward: 'add_to_bag', objective: 'unit', level: 4,
        level_words: 'channel, visit bucket, stage and region',
        n: 120, s: 9, p0: p0Worked, n0: N0, p_hat: pHatWorked, lift: liftWorked, gamma: 1 }),
    ];
    const ring = m.env.DECISION_RING!.get(m.env.DECISION_RING!.idFromName(ringName(TENANT, visitor)));
    const appended = await ring.fetch('https://learn/append', { method: 'POST',
      body: JSON.stringify({ tenant: TENANT, visitorId: visitor, records }) });
    expect(appended.status, 'the fixture decisions must be retained in the visitor ring').toBe(200);

    const read = await operatorGet(m, `/v1/${TENANT}/visitors/${visitor}/receipts`);
    expect(read.status, 'the operator must be able to read the shopper receipts').toBe(200);
    const receipts = read.body.receipts as Receipt[];
    expect(receipts, 'both decisions must have a receipt').toHaveLength(2);

    for (const [item, p0, pHat, lift] of [[ITEM_A, p0Rare, pHatRare, liftRare], [ITEM_B, p0Worked, pHatWorked, liftWorked]] as const) {
      const receipt = receipts.find(r => r.item === item)!;
      const terms = receipt.lift_terms;
      expect(terms, `the receipt for ${item} must name the terms of the lift it reports (doc 22 §12.1)`).toBeTruthy();
      exactly(terms!.p0, p0, `${item}: the receipt's baseline is the one the decision was made with`);
      exactly(terms!.p_hat, pHat, `${item}: the receipt's estimate is the one the decision was made with`);
      exactly(terms!.lift, lift, `${item}: the receipt's lift is the one the decision was made with`);
      // Legibility (F18 §6.4): each printed term parses back to its own value to
      // at least three significant digits — 0.0019940886… may print as
      // "0.00199" or "1.99e-3", never as "0.002" and never as "0.000".
      const shown = terms!.shown;
      for (const [name, exact] of [['p0', p0], ['p_hat', pHat], ['lift', lift]] as const) {
        const printed = Number.parseFloat(shown[name]);
        expect(Number.isFinite(printed), `${item}: the receipt prints ${name} as a readable number, got ${JSON.stringify(shown[name])}`).toBe(true);
        expect(Math.abs(printed - exact) <= 5e-3 * Math.abs(exact),
          `${item}: the printed ${name} ${shown[name]} must carry at least three significant digits of ${exact}`).toBe(true);
      }
      // And it agrees with itself: what it prints for p̂ over what it prints for
      // p₀ is what it prints for the lift (doc 22 §5.2's definition), inside the
      // clamp. Fixed three-decimal printing gives 0.004/0.002 = 2 against a
      // printed lift of 1.949, which is the contradiction F18 §2 E names.
      const ratio = Number.parseFloat(shown.p_hat) / Number.parseFloat(shown.p0);
      const printedLift = Number.parseFloat(shown.lift);
      expect(Math.abs(Math.min(DEFAULT_STATS.liftMax, Math.max(DEFAULT_STATS.liftMin, ratio)) - printedLift) <= 0.01 * printedLift,
        `${item}: the receipt must agree with itself — it prints p̂ ${shown.p_hat} over p₀ ${shown.p0} = ${ratio} beside a lift of ${shown.lift}`).toBe(true);
    }
  });
});

// ===========================================================================
// unit:W23.T1.01 — bounded, validated event time that respects the settled
// late-buffered decision
// ===========================================================================

describe('unit:W23.T1.01', () => {
  /**
   * doc 16 §4 :104 "The engine clock is authoritative. Events are stamped on
   * arrival; client timestamps are advisory only — a forged or skewed clock
   * cannot inflate affinity." The buffered door already holds the engine to it:
   * `validBufferedAction` refuses `timestamp > now` (`bufferedAction.ts:30`) and
   * `realtime.sdkContract.test.ts:2574` locks that refusal. The ordinary door
   * does not: `isEventTimestamp` (`actionTypes.ts:37`) bounds the value only by
   * the calendar, so a year-ahead client stamp becomes the admitted event time
   * of the durable behavior record, of the outcome record and of the retention
   * the record is kept under.
   *
   * RULED: a client time after the engine's own stamp is never admitted AS
   * GIVEN, and the event is still counted. The unit uses a YEAR-ahead stamp, so
   * it holds for every finite allowance the owner may later choose; the
   * allowance VALUE, and whether beyond it the event should be refused rather
   * than clamped, is `W23.P1.01`. Old times are NOT clamped: an old event keeps
   * its own time (the settled buffered decision, and
   * `realtime.sdkContract.test.ts:2594`, which locks a buffered outcome dated 0
   * carrying `ts: 0`).
   */
  it('host: on both hosts a year-ahead client timestamp is never the admitted event time and the event is still counted, a malformed one is refused, and an old one keeps its own time', async () => {
    for (const host of ['session', 'do'] as const) {
      const m = await mount(host, { profile: 'customer' });
      await publishFixture(m);
      const { grant, call } = await shopperOn(m);
      const event = { type: 'purchase', userId: grant.subject, source: 'sdk',
        data: { productId: PRODUCT, value: 475, items: [{ productId: PRODUCT, value: 475 }] } };

      // 1. A year ahead. The admitted time rides the durable record's own id
      //    (`{tenant}:{ts36}:{visitor}:behavior:{eventId}`, `behavior.ts:38`).
      const before = Date.now();
      const future = await call('/realtime/action', { ...event, timestamp: before + 365 * DAY });
      const futureBody = await future.json() as { behavior?: { status?: string; recordId?: string } };
      const after = Date.now();
      expect(future.status, `${host}: a future-dated event is still admitted`).toBe(200);
      expect(futureBody.behavior?.status, `${host}: the event is counted and visible, never silently dropped`).toBe('durable');
      const admitted = parseId(String(futureBody.behavior?.recordId))!.ts;
      expect(admitted <= after + SECOND,
        `${host}: the admitted event time ${admitted} must not exceed the engine's own stamp ${after} (client asked for ${before + 365 * DAY}, a year ahead)`).toBe(true);
      expect(admitted >= before - SECOND,
        `${host}: the admitted event time ${admitted} must still be this event's own arrival, not an older one`).toBe(true);

      // 2. Malformed: non-integer, out of calendar, negative, not a number.
      for (const malformed of [1.5, 8_640_000_000_000_001, -1, '2026-01-01']) {
        const refused = await call('/realtime/action', { ...event, timestamp: malformed });
        expect(refused.status, `${host}: a malformed event time ${JSON.stringify(malformed)} is refused`).toBe(400);
      }

      // 3. An old buffered delivery keeps its own time: accepted AS OLD, never
      //    restamped as fresh activity (settled decision, HANDOFF §7 :353).
      const oldTs = Date.now() - 3 * DAY;
      const old = await call('/realtime/action', { ...event, timestamp: oldTs,
        processing: 'buffered', eventId: 'w23-b1-buffered-original', browsingSessionId: 'w23-b1-original-browsing' });
      const oldBody = await old.json() as { behavior?: { status?: string; recordId?: string }; processing?: string };
      expect(old.status, `${host}: an old buffered delivery is accepted`).toBe(200);
      expect(oldBody.processing, `${host}: it is handled as the buffered delivery it declares`).toBe('buffered');
      expect(oldBody.behavior?.status, `${host}: the old delivery is counted`).toBe('durable');
      expect(parseId(String(oldBody.behavior?.recordId))!.ts,
        `${host}: the old delivery is admitted AS OLD, at its own time ${oldTs}`).toBe(oldTs);
      await m.drain();
    }
  });

  /**
   * The statistics object is the other door a client time reaches (F18 §2 F:
   * the counters are slot-wide and item-wide, so one visitor id poisons what
   * every shopper of that tenant is served from).
   *
   * MEASURED (probe B): `/exposures` admits a row dated a year ahead and leaves
   * the counter — and `stats.updatedAt` — anchored a year in the future; it
   * admits a non-integer row time, which HANDOFF-2026-09-16 §6 :227 says is
   * already validated; it correctly keeps an old row's own time and refuses a
   * non-numeric one.
   */
  it('host-internal: the statistics object never anchors a counter after its own clock, refuses a non-integer row time, and credits an old row at its own age', async () => {
    const m = await mount();
    const now = Date.now();
    await statsCall(m, TENANT, '/exposures', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      exposures: [{ item: ITEM_A, cell: cellTabby, ts: now }] });

    // 1. A year-ahead row is not anchored in the future.
    const future = await statsCall(m, TENANT, '/exposures', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      exposures: [{ item: ITEM_A, cell: cellTabby, ts: now + 365 * DAY }] });
    expect(future.status, 'the row is admitted as evidence').toBe(200);
    const stats = storedStats(m, TENANT);
    const anchor = stats.items[ITEM_A]!['*']!.n.t;
    expect(anchor <= Date.now() + SECOND,
      `the counter's reference time ${anchor} must not be set to the year-ahead client time ${now + 365 * DAY}`).toBe(true);
    expect(stats.updatedAt <= Date.now() + SECOND,
      `the object's last-updated time ${stats.updatedAt} must not be set a year ahead`).toBe(true);

    // 2. A malformed row time is refused: a non-integer and a non-number
    //    (HANDOFF-2026-09-16 §6 :227 "valid calendar/integer timestamps";
    //    `isEventTimestamp`, `actionTypes.ts:37`, requires a safe integer at the
    //    event door and the statistics object must not be laxer than its door).
    for (const malformed of [now - 1.5, true]) {
      const refused = await statsCall(m, TENANT, '/credits', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
        credits: [{ item: ITEM_C, cell: cellTabby, ts: malformed, reward: 'purchase', weight: 1 }] });
      expect(refused.status,
        `a row time of ${JSON.stringify(malformed)} is malformed and must be refused: the object may not admit what the event door (isEventTimestamp, a safe integer) refuses`).toBe(400);
    }
    expect(Object.hasOwn(storedStats(m, TENANT).items, ITEM_C), 'and no malformed row left a counter behind').toBe(false);

    // 3. An old row is accepted AS OLD: its own age discounts its own weight and
    //    it moves no clock backward. doc 22 §5.2 with e^(−3 d/τ) = 0.8668778997501816.
    //    On its own object, so the year-ahead row above cannot colour it.
    const late = 'coach-late';
    await statsCall(m, late, '/credits', { tenant: TENANT, brand: late, slot: SLOT, config: CONFIG,
      credits: [{ item: ITEM_A, cell: cellTabby, ts: now, reward: 'purchase', weight: 1 }] });
    const old = await statsCall(m, late, '/credits', { tenant: TENANT, brand: late, slot: SLOT, config: CONFIG,
      credits: [{ item: ITEM_A, cell: cellTabby, ts: now - 3 * DAY, reward: 'purchase', weight: 1 }] });
    expect(old.status, 'an old credit inside the reward window is admitted').toBe(200);
    const credited = storedStats(m, late).items[ITEM_A]!['*']!.s.purchase!;
    expect(credited.t, "an old credit never moves the counter's clock backward").toBe(now);
    exactly(effectiveScore(credited, now, TAU), 1 + decayed(3 * DAY),
      `the acknowledged credit plus a three-day-old one is 1 + e^(−3 d/τ) = ${1 + decayed(3 * DAY)}, never 2 and never 1`);
  });

  /**
   * The reward's own attribution window is the eligibility rule the settled
   * "Late history" decision points at (HANDOFF §7 :354 "Experiment lifecycle/
   * retained evidence determines eligibility", not an age cutoff inferred from
   * delivery delay). doc 22 §4.1: purchase 7 days. `attribute` already enforces
   * it (`policy.ts:103`; `learn.test.ts:897` is its GREEN witness) — what is
   * missing is that the refusal is NAMED, so an operator can tell "nothing
   * matched" from "it matched, but it was too late to count".
   *
   * RULED (R21): `OutcomeReceipt['outsideWindow']`.
   */
  it('host-internal: an old outcome inside the reward window is credited at its own time, and one beyond the window is not learned from and is named', async () => {
    const m = await mount();
    const now = Date.now();
    const served = (visitor: string, ts: number): DecisionRecord => ({
      decision_id: `${TENANT}:${ts.toString(36)}:${visitor}:home:${SLOT}:0`,
      tenant: TENANT, brand: TENANT, visitor_id: visitor, session_id: 'w23-b1-browsing', identity_anchor: 'visitor',
      ts, page: 'home', slot: SLOT, position: 0, item_id: ITEM_A, customer_item_id: `CMS-${ITEM_A}`, candidates: [],
      cell: { channel: 'paid_social', visit_bucket: '1', region: 'US-NY', affinity: 'line:Tabby', stage: 'mid' },
      arm: 'personalized', explored: false, authority: 'engine',
      versions: { config: 1, lift: 0, prior: 0, policy: 0 }, config_label: 'w23-b1',
      explain: { drivers: [], score_base: 0.5, lift: null, score_final: 0.5 },
      retention: captureRetention(m.env, TENANT, ts),
    } as unknown as DecisionRecord);
    const purchase = (visitor: string, ts: number): OutcomeRecord => ({
      outcome_id: `${TENANT}:${ts.toString(36)}:${visitor}:purchase`, tenant: TENANT, brand: TENANT, visitor_id: visitor,
      session_id: 'w23-b1-browsing', ts, type: 'purchase', event: 'purchase', item_id: ITEM_A, slot: null,
      value: 475, currency: 'USD', margin: null, products: null, arm: 'personalized',
      retention: captureRetention(m.env, TENANT, Math.min(ts, Date.now())),
    } as unknown as OutcomeRecord);

    const outcomeOn = async (visitor: string, decisionTs: number, outcomeTs: number) => {
      const ring = m.env.DECISION_RING!.get(m.env.DECISION_RING!.idFromName(ringName(TENANT, visitor)));
      const appended = await ring.fetch('https://learn/append', { method: 'POST',
        body: JSON.stringify({ tenant: TENANT, visitorId: visitor, records: [served(visitor, decisionTs)] }) });
      expect(appended.status, `${visitor}: the served decision is retained`).toBe(200);
      const response = await ring.fetch('https://learn/outcome', { method: 'POST',
        body: JSON.stringify({ tenant: TENANT, brand: TENANT, outcome: purchase(visitor, outcomeTs),
          policy: DEFAULT_POLICY, defaultSlotConfig: CONFIG }) });
      expect(response.status, `${visitor}: the outcome is receipted`).toBe(200);
      return (await response.json() as { receipt: OutcomeReceipt }).receipt;
    };

    // Inside the window: a purchase delivered three days late, one hour after
    // the decision it names — 7-day purchase window, doc 22 §4.1.
    const inside = await outcomeOn('w23-b1-inside', now - 3 * DAY - HOUR, now - 3 * DAY);
    expect(inside.attributed, 'a late delivery inside the reward window is credited').toBe(1);
    expect(inside.eligible, 'and the decision it names is the eligible one').toBe(1);
    expect(inside.outsideWindow, 'nothing fell outside the window here').toBe(0);
    const credited = storedStats(m, TENANT).items[ITEM_A]!['*']!.s.purchase!;
    expect(credited.t, 'the credit is recorded at the outcome\'s own old time, not at the present').toBe(now - 3 * DAY);

    // Beyond it: the same purchase against a decision thirty days old — 27 days
    // between the two, four times the reward's window.
    const beyond = await outcomeOn('w23-b1-beyond', now - 30 * DAY, now - 3 * DAY);
    expect(beyond.attributed, 'an outcome beyond the reward window is not learned from').toBe(0);
    expect(beyond.outsideWindow,
      'and the receipt names it: one decision matched this outcome but lay outside the reward window').toBe(1);
  });
});

// ===========================================================================
// unit:W23.T1.02 — a future-dated reference time cannot freeze decay
// ===========================================================================

describe('unit:W23.T1.02', () => {
  /**
   * F18 §2 F, last paragraph and §6.3: "because core.ts:234 clamps, a counter
   * whose `t` is ahead of `now` does not decay at all until its next event. A
   * single future-dated event freezes that counter's decay." F18 §8 says the
   * persisted counters must be rebuilt once, because "fixing `bump` does not
   * repair counters whose `t` is already skewed".
   *
   * MEASURED (probe A, A4): a counter {s: 100, t: now + 24 h} reads 100 at
   * now and still 100 at now + 12 h; after a legitimate event at `now` it holds
   * s = 100.23965103644177 with its clock still 24 h ahead — the new event was
   * itself discounted as though it were late.
   *
   * The honest arithmetic, from doc 22 §5.2, once the reference time may not
   * exceed the engine's present: the acknowledged mass is 100 at `now`, the new
   * event is not late so it contributes its full weight, and the counter is
   *     { s: 101, t: now }        and at now + 12 h it reads
   *     101 · e^(−12 h/τ) = 98.62364035187657      (e^(−12 h/τ) = 0.9764716866522433)
   *
   * RULED (R21): the optional final `now` on `recordExposure`/`recordSuccess`.
   */
  it('logic: a counter anchored ahead of the present is corrected by its next event and decays from the present', () => {
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    const state = emptyStats();
    state.items[ITEM_A] = { '*': { n: { s: 100, t: now + 24 * HOUR }, s: { purchase: { s: 10, t: now + 24 * HOUR } } } };
    state.slot['*'] = { n: { s: 100, t: now + 24 * HOUR }, s: { purchase: { s: 10, t: now + 24 * HOUR } } };
    state.updatedAt = now + 24 * HOUR;

    recordExposure(state, ITEM_A, cellUnknown, now, DEFAULT_STATS, now);
    recordSuccess(state, ITEM_A, cellUnknown, 'purchase', now, 1, DEFAULT_STATS, now);

    const counter = state.items[ITEM_A]!['*']!.n;
    expect(counter.t <= now, `the counter's reference time ${counter.t} must be corrected to no later than the present ${now}`).toBe(true);
    exactly(counter.s, 101, 'the acknowledged 100 plus this event, which is not late and keeps its full weight');
    exactly(effectiveScore(counter, now + 12 * HOUR, TAU), 101 * decayed(12 * HOUR),
      `twelve hours later the counter must read 101·e^(−12 h/τ) = ${101 * decayed(12 * HOUR)}, not the frozen 101`);
    const credit = state.items[ITEM_A]!['*']!.s.purchase!;
    expect(credit.t <= now, `the credit counter's reference time ${credit.t} must be corrected to no later than the present ${now}`).toBe(true);
    exactly(credit.s, 11, 'the acknowledged 10 credits plus this one, which is not late');
    expect(state.updatedAt <= now, `the state's last-updated time ${state.updatedAt} must not stay ahead of the present`).toBe(true);
  });

  it('host-internal: the real statistics object corrects a stored future anchor on the next event and its snapshot decays from the present', async () => {
    const m = await mount();
    const now = Date.now();
    // Seed the object through its own door, then damage the persisted anchors the
    // way a crafted future-dated event leaves them (F18 §8: "those objects must
    // be reset and refolded, or rebuilt from the ledger").
    await statsCall(m, TENANT, '/exposures', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      exposures: [{ item: ITEM_A, cell: cellTabby, ts: now - HOUR }] });
    const holder = m.learnObjects.get(statsName(TENANT, TENANT, SLOT))!;
    const stored = holder.data.get('learn') as { stats: StatsState };
    for (const map of [stored.stats.items[ITEM_A]!, stored.stats.slot]) {
      for (const key of Object.keys(map)) { map[key]!.n = { s: 100, t: now + 24 * HOUR }; }
    }
    stored.stats.updatedAt = now + 24 * HOUR;
    holder.data.set('learn', stored);
    (holder.shopper as unknown as { data: unknown }).data = null;

    const applied = await statsCall(m, TENANT, '/exposures', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      exposures: [{ item: ITEM_A, cell: cellTabby, ts: Date.now() }] });
    expect(applied.status, 'the next legitimate event is admitted').toBe(200);
    const after = storedStats(m, TENANT).items[ITEM_A]!['*']!.n;
    expect(after.t <= Date.now() + SECOND,
      `the stored reference time ${after.t} must be corrected to the object's own clock, not left 24 h ahead`).toBe(true);
    exactly(after.s, 101, 'the acknowledged 100 plus one event that is not late');
  });
});

// ===========================================================================
// unit:W23.T1.03 — the `||` traps are closed
// ===========================================================================

describe('unit:W23.T1.03', () => {
  /**
   * F18 §6.8: "`Number(c.weight) || 1` (LearnStats.ts:50) converts a weight of 0
   * to 1 … the same `||` idiom as `Number(e.ts) || Date.now()` two lines up."
   *
   * MEASURED (probe B): both are closed today — `rowsOf` (`LearnStats.ts:145-147`)
   * tests for `undefined`/`null` explicitly and validates the result. This unit
   * is the LOCK on that, at the object's own door.
   */
  it('host-internal: a credit weight of 0 stays 0, a row time of 0 stays 0, and a non-numeric time or weight is refused rather than replaced by the present', async () => {
    const m = await mount();
    const now = Date.now();
    const accepted = await statsCall(m, TENANT, '/credits', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      credits: [
        { item: ITEM_A, cell: cellTabby, ts: now, reward: 'purchase', weight: 0 },
        { item: ITEM_B, cell: cellRogue, ts: 0, reward: 'purchase', weight: 1 },
      ] });
    expect(accepted.status, 'both rows are admitted').toBe(200);
    const stats = storedStats(m, TENANT);

    const zeroWeight = stats.items[ITEM_A]!['*']!.s.purchase!;
    expect(zeroWeight.s, 'a credit weighing 0 contributes 0, never the 1 a `|| 1` would substitute').toBe(0);
    expect(zeroWeight.t, 'and it is still recorded at its own time').toBe(now);

    const zeroTime = stats.items[ITEM_B]!['*']!.s.purchase!;
    expect(zeroTime.t, 'a row time of 0 is the epoch it says, never the present a `|| Date.now()` would substitute').toBe(0);
    expect(zeroTime.s, 'and its weight is unchanged').toBe(1);
    expect(effectiveScore(zeroTime, now, TAU) < 1e-6,
      `a credit dated 1970 is worth almost nothing today, not a full 1: read ${effectiveScore(zeroTime, now, TAU)}`).toBe(true);

    for (const bad of [{ ts: 'yesterday' }, { weight: 'one' }, { weight: -1 }]) {
      const refused = await statsCall(m, TENANT, '/credits', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
        credits: [{ item: ITEM_C, cell: cellTabby, ts: now, reward: 'purchase', weight: 1, ...bad }] });
      expect(refused.status, `a row carrying ${JSON.stringify(bad)} is refused, never silently defaulted`).toBe(400);
    }
    expect(Object.hasOwn(storedStats(m, TENANT).items, ITEM_C), 'and no refused row left a counter behind').toBe(false);
  });
});

// ===========================================================================
// unit:W23.H1.01 — damaged historical state rebuilt or explicitly reset
// ===========================================================================

describe('unit:W23.H1.01', () => {
  /**
   * doc 35 §5 W23 (:425): "Rebuild or explicitly reset damaged item and slot
   * state … A local merge patch alone cannot repair historical evidence."
   * F18 §5 and §8: "`Stored.stats` is persisted in the LearnStats DO. Fixing
   * `bump` does not repair counters whose `t` is already skewed; those objects
   * must be reset and refolded, or rebuilt from the ledger."
   *
   * MEASURED (probe B): the object's `/health` answers `state: 'healthy'` for a
   * state whose counters are anchored thirty days in the future, so the damage
   * is silently kept; the object's own `/reset` works but no operator route
   * reaches it — `POST /v1/:tenant/learn/recovery` accepts exactly one repair
   * intent, `coarsen` (`decisions.ts:727`), and refuses anything else with 400
   * (measured). The audited human-operator route itself answers 200 for
   * `operation: 'status'` under this harness (probe C2), so the refusal below is
   * the route refusing the ruled operation, not an authority failure.
   *
   * RULED: `intent: 'reset'` on that route, and `LiftSnapshot['rebuiltFrom']`.
   * W24 owns the generation semantics of the transition; this unit requires only
   * that the reset is explicit, operator-authorised, named on the snapshot, and
   * that no snapshot mixes counters from both sides of it.
   */
  it('host-internal: a state anchored in the future is not reported healthy', async () => {
    const m = await mount();
    const now = Date.now();
    await statsCall(m, TENANT, '/exposures', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      exposures: [{ item: ITEM_A, cell: cellTabby, ts: now - HOUR }] });
    const holder = m.learnObjects.get(statsName(TENANT, TENANT, SLOT))!;
    const stored = holder.data.get('learn') as { stats: StatsState };
    for (const map of [stored.stats.items[ITEM_A]!, stored.stats.slot]) {
      for (const key of Object.keys(map)) { map[key]!.n = { s: 100, t: now + 30 * DAY }; }
    }
    stored.stats.updatedAt = now + 30 * DAY;
    holder.data.set('learn', stored);
    (holder.shopper as unknown as { data: unknown }).data = null;

    const health = await statsCall(m, TENANT, '/health', { tenant: TENANT, brand: TENANT, slot: SLOT });
    expect(health.status).toBe(200);
    const body = await health.json() as { state?: string };
    expect(body.state,
      'a statistics object whose counters are anchored thirty days in the future is damaged historical state, and must say so instead of reporting itself healthy')
      .toBe('recovery-required');
  });

  it('host: the operator-authorised explicit reset is admitted, the next published snapshot names the basis it was built on and holds no pre-reset evidence, and an unaffected slot is untouched', async () => {
    const m = await mount('session', { human: true });
    await publishFixture(m);
    const now = Date.now();
    // The damaged slot and a second, unaffected brand of the same tenant.
    await statsCall(m, TENANT, '/exposures', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      exposures: Array.from({ length: 40 }, () => ({ item: ITEM_A, cell: cellTabby, ts: now - HOUR })) });
    await statsCall(m, 'coach-untouched', '/exposures', { tenant: TENANT, brand: 'coach-untouched', slot: SLOT, config: CONFIG,
      exposures: Array.from({ length: 7 }, () => ({ item: ITEM_B, cell: cellRogue, ts: now - HOUR })) });
    const holder = m.learnObjects.get(statsName(TENANT, TENANT, SLOT))!;
    const damaged = holder.data.get('learn') as { stats: StatsState };
    for (const map of [damaged.stats.items[ITEM_A]!, damaged.stats.slot]) {
      for (const key of Object.keys(map)) { map[key]!.n = { s: 4000, t: now + 30 * DAY }; }
    }
    holder.data.set('learn', damaged);
    (holder.shopper as unknown as { data: unknown }).data = null;
    const untouchedBefore = JSON.stringify(storedStats(m, 'coach-untouched'));

    const status = await operatorPost(m, `/v1/${TENANT}/learn/recovery`,
      { operation: 'status', kind: 'stats', brand: TENANT, slot: SLOT }, m.accessToken);
    expect(status.status, 'the audited recovery route answers this operator').toBe(200);

    const operationId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const reset = await operatorPost(m, `/v1/${TENANT}/learn/recovery`, {
      operation: 'repair', kind: 'stats', brand: TENANT, slot: SLOT, intent: 'reset',
      digest: String(status.body.digest), generation: Number(status.body.generation), operationId,
    }, m.accessToken);
    expect(reset.status,
      'an operator with recovery authority must be able to reset damaged statistics explicitly, not only coarsen them')
      .toBe(200);
    expect(reset.body.ok, 'and the reset is acknowledged').toBe(true);

    // Post-reset evidence only, then publish: the snapshot must say what it was
    // built on and must not mix the two sides of the repair.
    await statsCall(m, TENANT, '/exposures', { tenant: TENANT, brand: TENANT, slot: SLOT, config: CONFIG,
      exposures: Array.from({ length: 5 }, () => ({ item: ITEM_B, cell: cellRogue, ts: Date.now() })) });
    const published = await operatorPost(m, `/v1/${TENANT}/learn/publish`, { slot: SLOT }, m.accessToken);
    expect(published.status, 'the repaired slot publishes again').toBe(200);
    const snapshot = published.body.snapshot as LiftSnapshot;
    expect(snapshot.rebuiltFrom,
      'the published snapshot must name the basis it was built on, so no reader mistakes post-repair counters for the tenant\'s whole history')
      .toEqual(expect.objectContaining({ basis: 'explicit-reset', operationId }));
    expect(Object.keys(snapshot.items).sort(),
      'and it holds only the evidence admitted after the reset, never a mixture of pre-repair and post-repair counters')
      .toEqual([ITEM_B]);
    exactly(snapshot.slotRates['*']!.n, 5, 'the slot carries exactly the five post-reset exposures');

    expect(JSON.stringify(storedStats(m, 'coach-untouched')),
      'a slot with no affected history is left exactly as it was: repair is conditional on actual affected history')
      .toBe(untouchedBefore);
  });
});
