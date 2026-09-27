// src/units/W21/LEDGER.unit.test.ts
// W21 under the Closure Ledger (program.json ticket W21, frozen 2026-09-24).
// The criteria C1 and E1 are proven by the existing `unit:W21.C1.*` and
// `unit:W21.E1.*` blocks of B1/B2/B3 in this directory and are not restated.
// This file specifies the three remaining-work criteria R1–R3, one
// `describe('unit:W21.<criterion id>')` each.
//
// WITNESSES
//   · document 35 §5 row W21 (:423), quoted by the work order: "Contain invalid
//     incrementality/confidence/target claims. Separately deliver persistent
//     enrollment/salt/identity policy, consent eligibility, … all eligible
//     visitor business outcomes and experiment provenance. … Renaming or
//     clamping an attribution ratio is not causal acceptance."
//   · LANE-LOG R156 (W21-B3 merged at a6db8d0): "an outcome whose visitor's only
//     decision of the day is in a LATER hour is counted by the raw branch and
//     dropped by the fold's `visitorOutcomes.byType` while `unassignedHours`
//     stays `[]` (a wrong number, not a null …); erasure reaching
//     `ShardState.enrollment` by code path only, unmeasured."
//   · `_evidence/W21-B3/reviewer-build/REPORT.md` finding 1: "`hourly.ts:710-711`
//     takes the assignment in force from the ring at-or-before the outcome, else
//     `firstOnDate` — which only holds decisions in the *current hour's* window.
//     The raw branch (`report.ts:981-982`) falls back to her *first decision of
//     the day* whatever the hour. So an outcome at 09:15 whose visitor's only
//     decision of the day is at 14:00 (carry-in attribution) is counted by the
//     raw branch and dropped by the fold, while the day still reports
//     `unassignedHours: []`." Finding 2: "Erasure/retention reach `enrollment` by
//     code path only … No unit asserts that an erased id leaves `enrollment`."
//   · LANE-LOG R158 and `_evidence/W21/reviewer-whole/REPORT.md` (finding): "F07
//     §7(a)'s three source-level mechanics are undone … `:334` still emits the
//     exact sentence F07 §7(a) orders deleted … `ArmSummary.s` is
//     `Math.max(0, finite(control.s))` — not clamped to `n` … `neededPerArm({n:100,
//     s:200},{n:1000,s:50})` → `NaN` … §7(a) asks for the guard and 'one test that
//     drives `compareArms` with `s > n`'".
//   · docs/architecture/35-verification-reports/F07.md §2.1 (the audit's own
//     probe: one `default` decision credited three times against one
//     `personalized` decision credited once gives `neededPerArm: NaN` and "needs
//     about NaN decisions on each arm to call") and §7(a): "remove the clause
//     'and the holdout is the reason we can say so' from `compareArms`'s `words`,
//     clamp `s` to `n` in `ArmSummary` and guard `neededPerArm` against rates
//     above 1 so no NaN can reach a reader … Add one test that drives
//     `compareArms` with `s > n` and asserts no NaN and no causal wording."
//
// ONE REPRESENTATION, the one W21-B1/B3 delivered and B3's C1.08 locks, so
// nothing here asks the fixture for a second world:
//   · `visitorOutcomes` is `{ version: 1, basis: 'enrolled_visitors', arms:
//     [{ arm, visitors, byType }] } | null`; `byType[t]` counts DISTINCT visitors
//     of the arm with an outcome of type `t`, under the assignment in force when
//     it happened — "her last decision at or before it, else her first of the
//     day" (`src/learn/report.ts` `assignmentAt`, the raw-day rule the fold
//     states it follows at `src/learn/hourly.ts` foldShard).
//   · `coverage.unassignedHours` names the summed hours that cannot say the
//     assignment, and a day naming any such hour answers `visitorOutcomes: null`
//     rather than a number the source cannot support (B3 representation (iii),
//     `docs/kit/03-payload-schemas.md` "coverage.unassignedHours").
//   · `ShardState.enrollment` is `Record<date, Record<brand, Record<visitor,
//     VisitorEnrollment>>>` (`src/learn/hourly.ts` ShardState).
//
// THE CLOCK. Every fold below runs with `Date` pinned to the fixture's own
// timeline: `finishHour` runs its post-fold cleanup at `Date.now()`
// (`src/learn/hourly.ts` finishHour), so an unpinned wall clock would put the
// fold weeks after the fixture's day and measure the retention rule instead of
// the rule under test.

import { describe, it, expect, vi, afterEach } from 'vitest';

import type { DecisionRecord, LearnConfig } from '@/content/types';
import { buildHour, catchUp, runDayReport, shardKey, SHARDS, type ShardState } from '@/learn/hourly';
import { runReport, type DayReport } from '@/learn/report';
import { writeTombstone } from '@/ledger/erasure';
import { ts36, type OutcomeRecord } from '@/ledger/records';
import { writeBatches } from '@/ledger/writer';
import { compareArms, neededPerArm } from '@/measure/holdout';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

// ===========================================================================
// The tenant's fixture: Coach's own vocabulary (tapestry_requirements A.3.6),
// held here and never in product code.
// ===========================================================================

const TENANT = 'coach';
const SALT = 'w21-ledger-experiment';
const HOUR = 3_600_000;
const at = (date: string, hour: number, minute = 0) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);

/** The tenant's published learn document, as B3 publishes it: one slot, a 50 % holdout, the platform's default policy. */
const LEARN = {
  holdout: { share: 0.5, salt: SALT, arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { hero: { reward: 'click' } },
} as unknown as LearnConfig;

const retentionPolicy: RetentionPolicy = { id: 'w21-ledger-fixture-policy', revision: 1, durationMs: 3650 * 24 * HOUR, basis: 'admitted', renewal: 'new-record-only' };

/** The object store, with the conditional-write contract the fold relies on (`src/units/W21/B3.unit.test.ts` UnitR2). */
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
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number; startAfter?: string } = {}) {
    const all = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '') && (options.startAfter === undefined || k > options.startAfter)).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: all.slice(start, end).map(key => ({ key, size: new TextEncoder().encode(this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < all.length, ...(end < all.length ? { cursor: String(end) } : {}) };
  }
}

/** The bindings the ledger consumer and the fold read: the store, the tenant registry and its retention policies. */
function fixtureEnv(r2: UnitR2): Env {
  return {
    DEPLOYMENT_PROFILE: 'demo', STORAGE: r2,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, retentionPolicy])) as Record<RetentionCategory, RetentionPolicy> } }),
  } as unknown as Env;
}

/** The provenance block a decision carries since W21-B1 (`src/content/types.ts` experiment). */
const enrollment = (arm: string) => ({ id: `${TENANT}:${TENANT}:${SALT}`, saltVersion: 1, arm, anchorGeneration: 1 });

function decisionRecord(input: { visitor: string; arm: 'default' | 'personalized'; ts: number; item: string }): DecisionRecord {
  return {
    decision_id: `${TENANT}:${ts36(input.ts)}:${input.visitor}:home:hero:0`,
    tenant: TENANT, brand: TENANT, visitor_id: input.visitor, session_id: `s-${input.visitor}`, identity_anchor: 'visitor',
    ts: input.ts, page: 'home', slot: 'hero', position: 0, item_id: input.item, customer_item_id: `CMS-${input.item}`,
    candidates: [], cell: { channel: 'direct', visit_bucket: '1', region: 'US-NY', affinity: 'occasion:evening' },
    arm: input.arm, explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w21-ledger',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    experiment: enrollment(input.arm),
  } as unknown as DecisionRecord;
}

function outcomeRecord(input: { visitor: string; ts: number; type: 'click' | 'purchase'; item: string | null; index: number }): OutcomeRecord {
  return {
    outcome_id: `${TENANT}:${ts36(input.ts)}:${input.visitor}:${input.type}:${input.index}`,
    tenant: TENANT, brand: TENANT, visitor_id: input.visitor, session_id: `s-${input.visitor}`, ts: input.ts,
    type: input.type, event: input.type === 'purchase' ? 'purchase' : 'content_click',
    item_id: input.item, slot: input.item ? 'hero' : null, value: input.type === 'purchase' ? 210 : null,
    currency: input.type === 'purchase' ? 'USD' : null, margin: null, products: null, arm: null,
  } as unknown as OutcomeRecord;
}

/**
 * The records into the ledger by the product's own object writer — the
 * function the queue consumer calls under the owner to lay a batch out as
 * `{tenant}/{date}/{hour}/{stream}/{min}-{max}-{batch}.ndjson` — each row
 * stamped the way the producer stamps it. (The consumer itself dispatches
 * under the ShopperReflex owner, which a fold-only fixture does not mount.)
 */
async function writeLedger(r2: UnitR2, env: Env, decisions: DecisionRecord[], outcomes: OutcomeRecord[], batch: string): Promise<void> {
  const stamp = <T extends { ts: number }>(row: T) => ({ ...row, retention: captureRetention(env, TENANT, row.ts, row.ts) });
  const written = await writeBatches(r2 as unknown as Parameters<typeof writeBatches>[0], [
    ...decisions.map(record => ({ kind: 'ledger' as const, type: 'decision' as const, record: stamp(record) })),
    ...outcomes.map(record => ({ kind: 'ledger' as const, type: 'outcome' as const, record: stamp(record) })),
  ] as unknown as Parameters<typeof writeBatches>[1], batch);
  expect(written.reduce((n, object) => n + object.count, 0), 'every fixture row is written into the ledger').toBe(decisions.length + outcomes.length);
}

/** Pin `Date` to the fixture's timeline; restored after every test. */
const pinClock = (to: number) => { vi.useFakeTimers({ toFake: ['Date'], now: to }); vi.setSystemTime(to); };
afterEach(() => { vi.useRealTimers(); });

/** One of the five-minute job's folds, run at the instant the job would run it. */
async function foldAt(r2: UnitR2, env: Env, date: string, hour: number, now: number) {
  vi.setSystemTime(now);
  return buildHour(r2 as unknown as Parameters<typeof buildHour>[0], TENANT, { date, hour }, LEARN, now, {}, env);
}

/** Every visitor id each date's enrollment memory holds, across all shards. */
function enrolledIds(r2: UnitR2): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let shard = 0; shard < SHARDS; shard++) {
    const raw = r2.objects.get(shardKey(TENANT, shard));
    if (raw === undefined) continue;
    const state = JSON.parse(raw) as ShardState;
    for (const [date, brands] of Object.entries(state.enrollment ?? {})) {
      for (const visitors of Object.values(brands)) (out[date] ??= []).push(...Object.keys(visitors));
    }
  }
  for (const ids of Object.values(out)) ids.sort();
  return out;
}

/** The enrollment record one visitor has on one date, wherever her shard is. */
function enrollmentOf(r2: UnitR2, date: string, visitor: string): unknown {
  for (let shard = 0; shard < SHARDS; shard++) {
    const raw = r2.objects.get(shardKey(TENANT, shard));
    if (raw === undefined) continue;
    const found = (JSON.parse(raw) as ShardState).enrollment?.[date]?.[TENANT]?.[visitor];
    if (found) return found;
  }
  return undefined;
}

type RuledDay = DayReport & { coverage?: { unassignedHours?: number[] | null } };

// ===========================================================================
// unit:W21.R1 — an outcome whose visitor's only decision of the day is in a
// later hour is counted identically by the raw and the folded branches, or
// named in `unassignedHours`.
//
// THE DAY, BY HAND. 2026-09-03, one brand, slot `hero`.
//   09:05  control-1  decision, served and assigned `default`
//   09:15  carry-in   PURCHASE — she has no decision yet today
//   09:30  control-1  purchase
//   10:00  no-decision  purchase — this visitor is served nothing all day
//   14:00  carry-in   decision, served and assigned `personalized` — her ONLY
//                     decision of the day
// The raw-day rule (`assignmentAt`): control-1's purchase is held by her 09:05
// decision → `default`; carry-in's 09:15 purchase precedes every decision of
// her day → her first of the day → `personalized`; no-decision has no
// decision at all → counted nowhere. Therefore, on BOTH branches:
//   armVisitors      default 1 · personalized 1
//   visitorOutcomes  default {visitors 1, byType {purchase 1}}
//                    personalized {visitors 1, byType {purchase 1}}
// The alternative the criterion admits: the folded day names the carry-in
// outcome's hour (9) in `coverage.unassignedHours` and then, by the
// representation above, answers `visitorOutcomes: null`. A fold cannot tell at
// hour 10 whether no-decision will be served later that day, so a day that
// names hour 9 may also name hour 10; hour 9 is the one it may not omit.
// ===========================================================================

describe('unit:W21.R1', () => {
  it('logic: the folded day and the raw day count a carry-in outcome whose only decision of the day comes in a later hour identically, or the folded day names that outcome\'s hour instead of answering a wrong number', async () => {
    const DATE = '2026-09-03';
    const CONTROL = 'vis-w21-led-r1-control-1', CARRY = 'vis-w21-led-r1-carry-in', NONE = 'vis-w21-led-r1-no-decision';
    const decisions = [
      decisionRecord({ visitor: CONTROL, arm: 'default', ts: at(DATE, 9, 5), item: 'cnt-tabby-evening-edit' }),
      decisionRecord({ visitor: CARRY, arm: 'personalized', ts: at(DATE, 14, 0), item: 'cnt-rogue-work-edit' }),
    ];
    const outcomes = [
      outcomeRecord({ visitor: CARRY, ts: at(DATE, 9, 15), type: 'purchase', item: null, index: 0 }),
      outcomeRecord({ visitor: CONTROL, ts: at(DATE, 9, 30), type: 'purchase', item: null, index: 0 }),
      outcomeRecord({ visitor: NONE, ts: at(DATE, 10, 0), type: 'purchase', item: null, index: 0 }),
    ];
    const r2 = new UnitR2(), env = fixtureEnv(r2);
    pinClock(at(DATE, 15, 0));
    await writeLedger(r2, env, decisions, outcomes, 'w21-led-r1');

    // The five-minute job, oldest hour first, each run after its hour closed.
    for (const hour of [9, 10, 14]) await foldAt(r2, env, DATE, hour, at(DATE, hour + 1, 6));
    const NOW = at('2026-09-04', 1, 0);
    vi.setSystemTime(NOW);
    const ids = { tenant: TENANT, brand: TENANT, date: DATE };
    // The production entry for a day report — the route's and the nightly
    // cron's own call — which prefers the hour aggregates whenever they exist.
    const folded = await runDayReport(r2 as unknown as Parameters<typeof runDayReport>[0], ids, LEARN, null, NOW, {}, env) as RuledDay;
    // The raw-day branch over the same ledger.
    const raw = await runReport(r2 as unknown as Parameters<typeof runReport>[0], ids, LEARN, null, NOW, env) as RuledDay;

    const RULED_ARM_VISITORS = [{ arm: 'default', visitors: 1 }, { arm: 'personalized', visitors: 1 }];
    const RULED_VISITOR_OUTCOMES = { version: 1, basis: 'enrolled_visitors', arms: [
      { arm: 'default', visitors: 1, byType: { purchase: 1 } },
      { arm: 'personalized', visitors: 1, byType: { purchase: 1 } },
    ] };
    expect(raw.armVisitors?.arms, 'the raw-day branch: one visitor assigned to each arm').toEqual(RULED_ARM_VISITORS);
    expect(raw.visitorOutcomes, 'the raw-day branch: the carry-in purchase counts under her first decision of the day, and the visitor served nothing is counted nowhere (report.ts assignmentAt)')
      .toEqual(RULED_VISITOR_OUTCOMES);

    // The answer under assertion is the one summed from the hour aggregates.
    expect(folded.hours?.source, 'the folded day is the hour-aggregate branch').toBe('aggregates');
    expect(folded.hours?.built, 'summed from the three folded hours').toEqual([9, 10, 14]);

    const named = folded.coverage?.unassignedHours;
    if (Array.isArray(named) && named.includes(9)) {
      // The alternative the criterion admits: the hour is NAMED, and the member
      // the source cannot support is withdrawn rather than answered short.
      expect(folded.visitorOutcomes, 'W21.R1 — a day that names hour 9 in unassignedHours answers visitorOutcomes null, never a count missing the carry-in purchase (B3 representation (iii))')
        .toBeNull();
    } else {
      expect(folded.visitorOutcomes,
        `W21.R1 (R156; W21-B3 review finding 1) — the folded day counts the 09:15 purchase of a visitor whose only decision of the day is at 14:00 exactly as the raw day does, or names hour 9 in coverage.unassignedHours (answered with unassignedHours ${JSON.stringify(named)})`)
        .toEqual(RULED_VISITOR_OUTCOMES);
      expect(named, 'and a day that counts every outcome names no hour').toEqual([]);
    }
  });
});

// ===========================================================================
// unit:W21.R2 — erasure removes the visitor from ShardState.enrollment.
//
// Two visitors, two days, so the erased visitor is in BOTH halves of the
// enrollment memory: the archived date (2026-09-02, beside `seenDays`) and the
// current one (2026-09-03, beside `seen`). Her erasure is written by the
// product's own tombstone writer — the function both erasure doors call
// (`src/ledger/erasure.ts` eraseVisitorLedger → writeTombstone) — after all of
// her activity, and the next run of the five-minute job (`catchUp`, the cron's
// own call) is what must take her out. The kept visitor proves the memory is
// there and is not simply emptied.
// ===========================================================================

describe('unit:W21.R2', () => {
  it('logic: after an erasure, the next run of the hourly job leaves the erased visitor in no date\'s enrollment memory, archived or current, and keeps every other visitor\'s', async () => {
    const DAY1 = '2026-09-02', DAY2 = '2026-09-03';
    const ERASED = 'vis-w21-led-r2-erased', KEPT = 'vis-w21-led-r2-kept';
    const r2 = new UnitR2(), env = fixtureEnv(r2);
    pinClock(at(DAY2, 11, 0));
    await writeLedger(r2, env, [
      decisionRecord({ visitor: ERASED, arm: 'personalized', ts: at(DAY1, 10, 5), item: 'cnt-rogue-work-edit' }),
      decisionRecord({ visitor: KEPT, arm: 'default', ts: at(DAY1, 10, 10), item: 'cnt-tabby-evening-edit' }),
      decisionRecord({ visitor: ERASED, arm: 'personalized', ts: at(DAY2, 10, 5), item: 'cnt-rogue-work-edit' }),
      decisionRecord({ visitor: KEPT, arm: 'default', ts: at(DAY2, 10, 10), item: 'cnt-tabby-evening-edit' }),
    ], [
      outcomeRecord({ visitor: ERASED, ts: at(DAY1, 10, 20), type: 'purchase', item: null, index: 0 }),
      outcomeRecord({ visitor: KEPT, ts: at(DAY1, 10, 25), type: 'purchase', item: null, index: 0 }),
      outcomeRecord({ visitor: ERASED, ts: at(DAY2, 10, 20), type: 'click', item: 'cnt-rogue-work-edit', index: 0 }),
    ], 'w21-led-r2');
    await foldAt(r2, env, DAY1, 10, at(DAY1, 11, 6));
    await foldAt(r2, env, DAY2, 10, at(DAY2, 11, 6));

    // The fixture reaches both halves of the memory before the erasure.
    expect(enrolledIds(r2), 'before the erasure both visitors are enrolled on the archived date and on the current one')
      .toEqual({ [DAY1]: [KEPT, ERASED].sort(), [DAY2]: [KEPT, ERASED].sort() });

    await writeTombstone(r2 as unknown as Parameters<typeof writeTombstone>[0], TENANT, ERASED, 'w21-ledger-erasure', at(DAY2, 11, 30));
    const next = at(DAY2, 12, 6);
    vi.setSystemTime(next);
    await catchUp(r2 as unknown as Parameters<typeof catchUp>[0], TENANT, LEARN, next, { lookbackHours: 2 }, env);

    expect(enrolledIds(r2),
      'W21.R2 (R156; W21-B3 review finding 2) — after the erasure and the next hourly run, the erased visitor is in no date\'s ShardState.enrollment, archived or current, and the other visitor is still enrolled on both')
      .toEqual({ [DAY1]: [KEPT], [DAY2]: [KEPT] });
    expect(enrollmentOf(r2, DAY1, KEPT), 'the kept visitor\'s archived record still holds her assignment and the outcome type she produced')
      .toMatchObject({ arms: ['default'], outcomes: { default: ['purchase'] } });
  });
});

// ===========================================================================
// unit:W21.R3 — the three holdout mechanics of F07 §7(a) (LANE-LOG R158).
//
// The criterion admits "or the unreachable code is deleted". Measured before
// ruling: that branch is closed on one green product, because the acceptance
// command's own `unit:W21.C1.01` and `unit:W21.C1.04` (B1.unit.test.ts:751,
// :951) call `compareArms`, and `src/measure/holdout.test.ts:7` imports
// `compareArms` and `neededPerArm` (the integration gate). So the correction is
// specified on the module as it stands.
//
// BY HAND, from F07 §7(a):
//   · `ArmSummary.s` is clamped to `n`: control {n 100, s 200} is summarized
//     with s 100; control {n 1, s 3} (F07 §2.1's probe) with s 1.
//   · `neededPerArm` never answers NaN for a rate above 1. The witness fixes
//     "no NaN", not the value, so a guard answering `null` ("no rate to size it
//     against", the function's own documented null) and one answering a finite
//     count of decisions are both accepted — a positive integer or null.
//   · the sentence at `:334` makes no causal claim: "and the holdout is the
//     reason we can say so" is gone, and no word of the claim vocabulary
//     `unit:W21.C1.01` scans for (B1.unit.test.ts:585 FORBIDDEN_CLAIMS) is used.
// ===========================================================================

/** The claim vocabulary of `unit:W21.C1.01` (B1.unit.test.ts:585), repeated because a test file is never imported. */
const FORBIDDEN_CLAIMS = ['incrementality', 'the holdout is the reason we can say so', 'reached_stretch', 'reached_target', 'reached_minimum',
  'the target is reached', 'the stretch target is reached', 'the minimum is reached', 'causal'] as const;
const claimsIn = (text: string) => FORBIDDEN_CLAIMS.filter(claim => text.toLowerCase().includes(claim));
const countOrNull = (value: number | null) => value === null || (Number.isInteger(value) && value > 0);

describe('unit:W21.R3', () => {
  it('logic: compareArms driven with s > n publishes s clamped to n, never a NaN, and a sentence without the causal claim; neededPerArm answers a count or null for a rate above 1', () => {
    // The W21 whole review's reproduction: a control rate of 2, a decided difference.
    const decided = compareArms({ arm: 'default', n: 100, s: 200 }, { arm: 'personalized', n: 1000, s: 50 });
    expect.soft(decided.control.s, 'W21.R3 (R158; F07 §7(a)) — ArmSummary.s is clamped to n: 200 credits over 100 decisions is summarized as 100').toBe(100);
    expect.soft(decided.treatment.s, 'an arm inside its range is unchanged').toBe(50);
    expect.soft(countOrNull(decided.neededPerArm), `W21.R3 — neededPerArm is a count of decisions or null, never NaN: ${decided.neededPerArm}`).toBe(true);
    expect.soft(decided.words.includes('NaN'), `W21.R3 — no NaN reaches the words: "${decided.words}"`).toBe(false);
    expect.soft(claimsIn(decided.words), 'W21.R3 (F07 §7(a)) — the decided-verdict sentence at holdout.ts:334 carries no causal claim: "and the holdout is the reason we can say so" is removed').toEqual([]);

    // F07 §2.1's own probe: one default decision credited three times, one personalized decision credited once.
    const probe = compareArms({ arm: 'default', n: 1, s: 3 }, { arm: 'personalized', n: 1, s: 1 });
    expect.soft(probe.control.s, 'W21.R3 (F07 §2.1) — the audit\'s probe publishes s 1 beside n 1, not s 3').toBe(1);
    expect.soft(countOrNull(probe.neededPerArm), `W21.R3 (F07 §2.1) — the audit's probe answers no NaN: ${probe.neededPerArm}`).toBe(true);
    expect.soft(probe.words.includes('NaN'), `W21.R3 (F07 §2.1) — "needs about NaN decisions on each arm" can no longer be printed: "${probe.words}"`).toBe(false);

    // A decided verdict inside the ordinary range (the shipped fixture of
    // src/measure/holdout.test.ts:101) reaches the same sentence at :334.
    const ordinary = compareArms({ arm: 'default', n: 2000, s: 60 }, { arm: 'personalized', n: 38000, s: 1900 });
    expect.soft(claimsIn(ordinary.words), 'W21.R3 (F07 §7(a)) — no decided comparison claims the holdout is the reason').toEqual([]);

    // The exported function itself, on either side of the comparison.
    for (const [control, treatment] of [[{ n: 100, s: 200 }, { n: 1000, s: 50 }], [{ n: 1000, s: 50 }, { n: 100, s: 200 }], [{ n: 1, s: 3 }, { n: 10, s: 1 }]] as const) {
      const needed = neededPerArm(control, treatment);
      expect.soft(countOrNull(needed), `W21.R3 (R158) — neededPerArm(${JSON.stringify(control)}, ${JSON.stringify(treatment)}) answers a count of decisions or null, never NaN: ${needed}`).toBe(true);
    }
  });
});
