// src/units/W30/FIX1.unit.test.ts
// W30 fix 1 — the two defects the W30 delivery review found at 278c588 that
// the reviewed tests (6426de3) do not catch, one `describe('unit:W30.<criterion
// id>.<n>')` per production path, under the frozen criteria they break (P1 and
// F1 of docs/remediation/delivery-control/program.json, ticket W30). No
// criterion, command or path changes. The reviewed files beside this one are
// neither imported nor edited: importing a `.test.ts` would register its whole
// suite a second time, so the harness below is `P1E1.unit.test.ts`'s (itself
// `src/units/W21/LEDGER.unit.test.ts`'s), with the catch-up's `built` kept too.
//
// WITNESSES (every expected value below comes from one of these):
//   · The W30 delivery review at 278c588
//     (/home/simonecoelho/rem/_evidence/W30-delivery/reviewer/REPORT.md),
//     defect 1: "A later-hour placement … is never taken back. When a re-fold
//     finds an earlier decision of hers, the purchase is enrolled again under
//     that decision's arm", on two production paths — "her earlier decision
//     reaches the purchase hour late, inside the 3 h horizon" and "an earlier
//     hour fails once and is folded later inside the lookback" — giving
//     "ineligible:{purchase:1} and personalized:{purchase:1}, unassignedHours:
//     []"; defect 2: "If the purchase hour's re-fold is refused, the day
//     answers `visitorOutcomes` without the purchase and names no hour"; both
//     proven by revert with probes (P-e) and (e4) of
//     probe/w30-review.probe.test.ts.
//   · docs/kit/03-payload-schemas.md: `visitorOutcomes` counts visitors "by the
//     assignment the visitor held when the outcome happened … and one purchase
//     is counted on exactly one row"; `coverage.unassignedHours` names the hour
//     that cannot place an outcome, and "that day keeps its rows and
//     `armVisitors` and answers `visitorOutcomes: null`".
//   · docs/kit/02-api-reference.md, the coverage paragraph: the day "never
//     answers a count that omits an outcome".
//   · W21.R1 (LANE-LOG R156), the honesty both branches below keep: an outcome
//     is "counted identically by the raw and the folded report branches, or
//     named in unassignedHours".
//   · The raw-day rule every expected row is derived from, `assignmentAt` in
//     `src/learn/report.ts`: "her last decision at or before it, else her first
//     of the day", over the day's own decisions of the brand.
//
// ONE REPRESENTATION with W21.R1 (`src/units/W21/LEDGER.unit.test.ts`) and
// W30.E1 (`P1E1.unit.test.ts` expectCorrectedOrFlagged):
//   · COUNTED — the folded day's `visitorOutcomes` is the raw day's, member for
//     member (so the purchase is on exactly the one row the raw day puts it
//     on), and it names no hour in `coverage.unassignedHours`;
//   · NAMED — the folded day names the purchase's hour, 9, in
//     `coverage.unassignedHours` and answers `visitorOutcomes: null`, keeping
//     its `armVisitors`.
// W30.P1.02 and W30.P1.03 require COUNTED only: P1 is "a folded day answers
// visitorOutcomes whenever the raw day does", the raw day answers on both
// paths, and once the fold has caught up it holds every row of the day, so no
// information is lost that could justify naming an hour (the W30 fix-1
// specification review, ruling (a)). W30.F1.02 admits COUNTED or NAMED: there
// the re-fold of the purchase hour is refused, which is where F1 and W21.R1
// name an hour. Anything else fails: above all a purchase counted on two rows,
// or a count short of it, with no hour named. Nothing here reads `ShardState`
// or `coverage.carryInHours`/`status`: V1.01's hour-level statement stands.
//
// THE PATH. Records reach the ledger through the product's own object writer
// (`writeBatches`, the queue consumer's call), each burst as it happens. The
// five-minute job is `catchUp(env.STORAGE, tenant, learn, now, {}, env)` exactly
// as `src/index.ts` calls it — all defaults — run until quiet at moments through
// the day. The folded day is `runDayReport` (the route's and the nightly job's
// call, which prefers the hour aggregates) and the raw day is `runReport` over
// the same ledger. A refused fold is the object store refusing every read of one
// hour's ledger prefix for a while — a store outage of that prefix; the catch-up
// reports the hour in `failed` and retries it on later runs, as in production.
//
// MEASURED on scratch copies of each tree (logs under
// /home/simonecoelho/rem/_evidence/W30-fix1/specifier/logs/), per unit below.

import { describe, it, expect, vi, afterEach } from 'vitest';

import { experimentIdFor, ineligibleEnrollment } from '@/content/holdout';
import type { DecisionRecord, EnrollmentProvenance, HoldoutConfig, LearnConfig } from '@/content/types';
import { catchUp, runDayReport } from '@/learn/hourly';
import { runReport, type DayReport } from '@/learn/report';
import { ts36, type OutcomeRecord } from '@/ledger/records';
import { writeBatches } from '@/ledger/writer';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture: one Tapestry-wide tenant with its launch brand and a
// second brand (tapestry_requirements "Multi-brand rollout (Coach, Kate
// Spade)"), Coach's own vocabulary, a piece the taxonomy does not know served
// to a shopper in the unknown cell, and a basket that crosses Handbags and
// Small Leather Goods.
// ===========================================================================

const TENANT = 'tapestry';
const BRAND = 'coach';
const OTHER_BRAND = 'kate-spade';
const SALT = 'w30-fix1-experiment';
const DAY_MS = 86_400_000;
const DATE = '2026-09-03';
const NEXT = '2026-09-04';
const PURCHASE_HOUR = 9;
const at = (date: string, hour: number, minute = 0, second = 0): number =>
  Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`);
const ALL_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourOfDate = (hour: number): string => `${DATE} ${hour}`;

const HOLDOUT: HoldoutConfig = { share: 0.5, salt: SALT, arms: ['default'] };
/** The tenant's published learn document: a 50 % holdout, one clicked slot, the platform's default policy. */
const LEARN = {
  holdout: HOLDOUT,
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { hero: { reward: 'click' } },
} as unknown as LearnConfig;

const COACH_CELL = { channel: 'web', visit_bucket: 'returning', stage: 'consider', region: 'US-NY', affinity: 'evening' };
const UNKNOWN_CELL = { channel: 'web', visit_bucket: 'new', stage: 'unknown', region: 'none', affinity: 'none' };
/** A basket across categories: a Tabby shoulder bag (Handbags) and a Willow card case (Small Leather Goods). */
const CROSS_CATEGORY_BASKET = ['CH-TABBY-SHOULDER-26', 'CH-WILLOW-CARD-CASE'];

const retentionPolicy: RetentionPolicy = { id: 'w30-fix1-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };

/** The object store, with the conditional-write contract the fold relies on (`src/units/W21/LEDGER.unit.test.ts` UnitR2). */
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

/**
 * The same store during an outage of one hour's ledger prefix: while
 * `refusing` names a prefix, every read of an object under it is refused. The
 * listing still answers and nothing is lost; the fold of that hour fails and
 * the catch-up retries it on its next runs.
 */
class RefusingR2 extends UnitR2 {
  refusing: string | null = null;
  async get(key: string, options?: R2GetOptions) {
    if (this.refusing !== null && key.startsWith(this.refusing)) throw new Error(`the object store refused the read of ${key}`);
    return super.get(key, options);
  }
}
/** The ledger prefix of one hour of the fixture's date, as the object writer lays it out. */
const ledgerHour = (hour: number): string => `${TENANT}/${DATE}/${String(hour).padStart(2, '0')}/`;

/** The bindings the ledger writer and the fold read: the store, the tenant registry and its retention policies. */
function fixtureEnv(r2: UnitR2): Env {
  return {
    DEPLOYMENT_PROFILE: 'demo', STORAGE: r2,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, retentionPolicy])) as Record<RetentionCategory, RetentionPolicy> } }),
  } as unknown as Env;
}

// ── the records, minted the way the engine mints them ──────────────────────

/**
 * What a shopper's records say about her place in the experiment of one brand.
 * A randomised assignment carries the arm her persistent anchor drew; a shopper
 * without personalization consent on that brand's site is never drawn, and the
 * engine's own `ineligibleEnrollment` names why (`src/content/holdout.ts`).
 */
type Assignment = 'personalized' | 'default' | 'ineligible';
const provenance = (brand: string, assignment: Assignment): EnrollmentProvenance => assignment === 'ineligible'
  ? ineligibleEnrollment({ tenant: TENANT, brand, holdout: HOLDOUT, saltVersion: 1, reason: 'personalization_consent' })
  : { id: experimentIdFor(TENANT, brand, SALT), saltVersion: 1, arm: assignment, anchorGeneration: 1 };

/** One decision. Without consent she is served the site's own defaults and the provenance says `ineligible`. */
function decision(input: { visitor: string; brand?: string; assignment: Assignment; ts: number; item: string; page?: string; cell?: Record<string, string> }): DecisionRecord {
  const brand = input.brand ?? BRAND, page = input.page ?? 'home';
  return {
    decision_id: `${TENANT}:${ts36(input.ts)}:${input.visitor}:${page}:hero:0`,
    tenant: TENANT, brand, visitor_id: input.visitor, session_id: `s-${input.visitor}`, identity_anchor: 'visitor', ts: input.ts,
    page, slot: 'hero', position: 0, item_id: input.item, customer_item_id: `CMS-${input.item.toUpperCase()}`, candidates: [],
    cell: input.cell ?? COACH_CELL, arm: input.assignment === 'personalized' ? 'personalized' : 'default', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w30-fix1',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    experiment: provenance(brand, input.assignment),
  } as unknown as DecisionRecord;
}

/**
 * A purchase, stamped as the producer stamps it: her enrollment and consent at
 * the moment it is recorded (kit 03 `experiment`). No slot and no decision
 * reference: a purchase names the products bought.
 */
function purchase(input: { visitor: string; ts: number; assignment: Assignment; products: string[]; value: number }): OutcomeRecord {
  return {
    outcome_id: `${TENANT}:${ts36(input.ts)}:${input.visitor}:purchase:0`,
    tenant: TENANT, brand: BRAND, visitor_id: input.visitor, session_id: `s-${input.visitor}`, ts: input.ts,
    type: 'purchase', event: 'purchase', item_id: null, slot: null, value: input.value, currency: 'USD', margin: null,
    products: input.products, arm: null, experiment: provenance(BRAND, input.assignment),
  } as unknown as OutcomeRecord;
}

/** A click on the piece a decision served, naming that decision. */
function click(d: DecisionRecord, ts: number, assignment: Assignment): OutcomeRecord {
  return {
    outcome_id: `${TENANT}:${ts36(ts)}:${d.visitor_id}:click:0`, decision_id: d.decision_id,
    tenant: TENANT, brand: d.brand, visitor_id: d.visitor_id, session_id: d.session_id, ts,
    type: 'click', event: 'content_click', item_id: d.item_id, slot: d.slot, value: null, currency: null, margin: null,
    products: null, arm: null, experiment: provenance(d.brand, assignment),
  } as unknown as OutcomeRecord;
}

/**
 * ONE delivery into the ledger by the product's own object writer — the call
 * the queue consumer makes to lay a batch out as
 * `{tenant}/{date}/{hour}/{stream}/{min}-{max}-{batch}.ndjson`, by each row's
 * own time, so a row delivered late lands in its own hour's prefix.
 */
async function deliver(r2: UnitR2, env: Env, decisions: DecisionRecord[], outcomes: OutcomeRecord[], batch: string): Promise<void> {
  const stamp = <T extends { ts: number }>(row: T) => ({ ...row, retention: captureRetention(env, TENANT, row.ts, row.ts) });
  const written = await writeBatches(r2 as unknown as Parameters<typeof writeBatches>[0], [
    ...decisions.map(record => ({ kind: 'ledger' as const, type: 'decision' as const, record: stamp(record) })),
    ...outcomes.map(record => ({ kind: 'ledger' as const, type: 'outcome' as const, record: stamp(record) })),
  ] as unknown as Parameters<typeof writeBatches>[1], batch);
  expect(written.reduce((n, object) => n + object.count, 0), `delivery ${batch}: every fixture row is written into the ledger`).toBe(decisions.length + outcomes.length);
}

// ── the five-minute job, and the two branches of the day ───────────────────

afterEach(() => { vi.useRealTimers(); });

/** What the five-minute job did at one moment: the hours it folded or re-folded, and the hours it could not, as `date hour`. */
interface CronRun { built: string[]; failed: string[] }

/**
 * The five-minute job at one moment, run until a run folds nothing:
 * `catchUp(env.STORAGE, tenant, learn, now, {}, env)` exactly as `src/index.ts`
 * calls it. `Date` is pinned to the fixture's clock for every fold.
 */
async function cronAt(r2: UnitR2, env: Env, now: number): Promise<CronRun> {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'], now });
  vi.setSystemTime(now);
  const built: string[] = [], failed: string[] = [];
  for (let run = 0; run < 60; run++) {
    const result = await catchUp(r2 as unknown as Parameters<typeof catchUp>[0], TENANT, LEARN, now, {}, env);
    built.push(...result.built.map(hour => `${hour.date} ${hour.hour}`));
    failed.push(...result.failed.map(hour => `${hour.date} ${hour.hour}`));
    if (!result.built.length) break;
  }
  return { built: [...new Set(built)], failed: [...new Set(failed)] };
}
const failedHours = (...runs: CronRun[]): string[] => [...new Set(runs.flatMap(run => run.failed))].sort();

type RuledDay = DayReport & { coverage?: { unassignedHours?: number[] | null; missingHours?: number[] } };

/** The day as an operator reads it from the hour aggregates, and the raw-day branch over the same ledger. */
async function bothDays(r2: UnitR2, env: Env, now: number): Promise<{ folded: RuledDay; raw: RuledDay }> {
  vi.setSystemTime(now);
  const ids = { tenant: TENANT, brand: BRAND, date: DATE };
  const folded = await runDayReport(r2 as unknown as Parameters<typeof runDayReport>[0], ids, LEARN, null, now, {}, env) as RuledDay;
  const raw = await runReport(r2 as unknown as Parameters<typeof runReport>[0], ids, LEARN, null, now, env) as RuledDay;
  return { folded, raw };
}

interface Ruled { armVisitors: Array<{ arm: string; visitors: number }>; visitorOutcomes: unknown }

/** The fixture's own premises: the raw day's rows by hand, and a folded day built from every hour of the date. */
function expectDayPremises(day: { folded: RuledDay; raw: RuledDay }, ruled: Ruled, criterion: string): void {
  expect({ armVisitors: day.raw.armVisitors?.arms, visitorOutcomes: day.raw.visitorOutcomes },
    `${criterion} — the raw-day branch, by hand (\`src/learn/report.ts\` assignmentAt: her last decision at or before the outcome, else her first of the day)`)
    .toEqual(ruled);
  expect({ source: day.folded.hours?.source, built: day.folded.hours?.built, missingHours: day.folded.coverage?.missingHours },
    `${criterion} — the fixture: by the time the day is read the five-minute job has folded every hour of the date and nothing is missing`)
    .toEqual({ source: 'aggregates', built: ALL_HOURS, missingHours: [] });
}

/**
 * P1: the premises, then COUNTED and nothing else — the folded day answers the
 * raw day's `visitorOutcomes`, member for member, and names no hour.
 */
function expectCountedOnce(day: { folded: RuledDay; raw: RuledDay }, ruled: Ruled, criterion: string, counted: string): void {
  expectDayPremises(day, ruled, criterion);
  expect({ visitorOutcomes: day.folded.visitorOutcomes, unassignedHours: day.folded.coverage?.unassignedHours }, `${criterion} — ${counted}`)
    .toEqual({ visitorOutcomes: ruled.visitorOutcomes, unassignedHours: [] });
}

/**
 * F1: the premises, then COUNTED (the raw day's rows exactly, no hour named)
 * or NAMED (hour 9 named, `visitorOutcomes: null`, `armVisitors` kept).
 */
function expectCountedOnceOrNamed(day: { folded: RuledDay; raw: RuledDay }, ruled: Ruled, criterion: string, counted: string): void {
  expectDayPremises(day, ruled, criterion);
  const named = day.folded.coverage?.unassignedHours;
  if (Array.isArray(named) && named.includes(PURCHASE_HOUR)) {
    // NAMED: the hour holding the purchase is named, and the one member the
    // day cannot support is withdrawn; the arm denominators stand.
    expect({ armVisitors: day.folded.armVisitors?.arms, visitorOutcomes: day.folded.visitorOutcomes },
      `${criterion} — a day that NAMES hour ${PURCHASE_HOUR} in coverage.unassignedHours answers visitorOutcomes null, never a count, and keeps its armVisitors (kit 03, coverage.unassignedHours)`)
      .toEqual({ armVisitors: ruled.armVisitors, visitorOutcomes: null });
  } else {
    expect({ visitorOutcomes: day.folded.visitorOutcomes, unassignedHours: named }, `${criterion} — ${counted}`)
      .toEqual({ visitorOutcomes: ruled.visitorOutcomes, unassignedHours: [] });
  }
}

// ===========================================================================
// unit:W30.P1.02 — defect 1, first path: her earlier decision reaches the
// purchase hour LATE, inside the re-fold horizon, after a later hour has
// already placed the purchase as a carry-in.
//
// THE DAY, BY HAND. Tenant `tapestry`, brand `coach`, 2026-09-03:
//   09:05  v-switch   coach decision, `ineligible` (no consent on coach.com yet:
//                     served the site's defaults) — DELIVERED LATE, at 11:30
//   09:10  v-switch   kate-spade decision, `default` (she consented on
//                     katespade.com; another brand's experiment)
//   09:15  v-switch   coach PURCHASE, stamped `ineligible`, the cross-category
//                     basket
//   09:20  u-unknown  coach decision in the unknown cell, on the piece the
//                     taxonomy does not know, `default`
//   09:25  u-unknown  click on it
//   10:30  v-switch   coach decision, `personalized` (she has consented)
// The job runs at 10:06 (hour 9: no coach decision of hers is known, the
// purchase is remembered), 11:06 (hour 10: her 10:30 decision carries her
// into the day), 11:36 (her 09:05 decision has reached hour 9's prefix, the
// hour ended at 10:00 and is inside the 3 h horizon: hour 9 is re-folded) and
// 01:06 the next day.
// The raw-day rule over the coach decisions: the 09:15 purchase is held by her
// 09:05 decision, the last at or before it → `ineligible`; her 10:30 decision
// puts her on `personalized` with no outcome there; the kate-spade decision is
// another brand's; u-unknown's click is held by her 09:20 decision → `default`.
//   armVisitors      default 1 · ineligible 1 · personalized 1
//   visitorOutcomes  default {1, {click 1}} · ineligible {1, {purchase 1}} ·
//                    personalized {1, {}}
// ONE purchase, on exactly ONE row: `ineligible`. RULED (P1): the folded day
// answers exactly these rows and names no hour. Measured: at 278c588 the
// folded day also counts it on `personalized` and names no hour (the review's
// probe P-e); at 7c2523e and at 6426de3, which place no later-hour carry-in, it
// answers the raw day's rows.
// ===========================================================================

describe('unit:W30.P1.02', () => {
  const RULED: Ruled = {
    armVisitors: [{ arm: 'default', visitors: 1 }, { arm: 'ineligible', visitors: 1 }, { arm: 'personalized', visitors: 1 }],
    visitorOutcomes: { version: 1, basis: 'enrolled_visitors', arms: [
      { arm: 'default', visitors: 1, byType: { click: 1 } },
      { arm: 'ineligible', visitors: 1, byType: { purchase: 1 } },
      { arm: 'personalized', visitors: 1, byType: {} },
    ] },
  };

  it('logic: when her earlier decision reaches the purchase hour late, inside the re-fold horizon, after a later hour placed the purchase as a carry-in, the re-fold leaves the purchase on exactly one row — the one the raw day gives — and the folded day answers visitorOutcomes exactly as the raw day does, naming no hour', async () => {
    const r2 = new UnitR2(), env = fixtureEnv(r2);
    const preConsent = decision({ visitor: 'v-switch', assignment: 'ineligible', ts: at(DATE, 9, 5), item: 'cnt-tabby-evening' });
    const kateSpade = decision({ visitor: 'v-switch', brand: OTHER_BRAND, assignment: 'default', ts: at(DATE, 9, 10), item: 'ks-knott-satchel', page: 'plp' });
    const unknown = decision({ visitor: 'u-unknown', assignment: 'default', ts: at(DATE, 9, 20), item: 'cnt-unknown-taxonomy', cell: UNKNOWN_CELL });
    const consented = decision({ visitor: 'v-switch', assignment: 'personalized', ts: at(DATE, 10, 30), item: 'cnt-rogue-work' });

    await deliver(r2, env, [kateSpade, unknown], [
      purchase({ visitor: 'v-switch', ts: at(DATE, 9, 15), assignment: 'ineligible', products: CROSS_CATEGORY_BASKET, value: 575 }),
      click(unknown, at(DATE, 9, 25), 'default'),
    ], 'p102-morning');
    const first = await cronAt(r2, env, at(DATE, 10, 6));
    await deliver(r2, env, [consented], [], 'p102-consented');
    const carried = await cronAt(r2, env, at(DATE, 11, 6));
    // Her 09:05 decision, held up in delivery, reaches hour 9's prefix at 11:30.
    await deliver(r2, env, [preConsent], [], 'p102-late-pre-consent');
    const refold = await cronAt(r2, env, at(DATE, 11, 36));
    const close = await cronAt(r2, env, at(NEXT, 1, 6));

    expect({ failed: failedHours(first, carried, refold, close), refolded: refold.built.includes(hourOfDate(PURCHASE_HOUR)) },
      'W30.P1.02 — the fixture: no fold failed, and at 11:36 the five-minute job re-folded hour 9 because her late decision reached it inside the re-fold horizon')
      .toEqual({ failed: [], refolded: true });

    expectCountedOnce(await bothDays(r2, env, at(NEXT, 1, 30)), RULED,
      'W30.P1.02 (amendment A47; W30 delivery review defect 1, first path)',
      'a later-hour placement is taken back when a re-fold finds an earlier decision of hers: kit 03 "one purchase is counted on exactly one row", so v-switch\'s 09:15 purchase is counted on the `ineligible` row her 09:05 decision gives it — exactly as the raw day counts it — and NOT also on the `personalized` row her 10:30 decision carried it onto; the raw day answers and the caught-up fold holds every row, so the folded day answers visitorOutcomes too and names no hour (P1: "a folded day answers visitorOutcomes whenever the raw day does")');
  }, 240_000);
});

// ===========================================================================
// unit:W30.P1.03 — defect 1, second path: an EARLIER hour fails, the purchase
// is placed as a carry-in by a later hour meanwhile, and the earlier hour is
// folded later, inside the lookback.
//
// THE DAY, BY HAND. Tenant `tapestry`, brand `coach`, 2026-09-03:
//   08:30  v-oo       coach decision, `ineligible` (no consent yet)
//   09:05  u-unknown  coach decision in the unknown cell, on the piece the
//                     taxonomy does not know, `default`
//   09:15  v-oo       coach PURCHASE, stamped `ineligible`, the cross-category
//                     basket
//   09:20  u-unknown  coach purchase of a Rogue bag
//   14:00  v-oo       coach decision, `personalized` (she has consented)
// Every row is delivered on time. From the 10:06 run to the 15:06 run the store
// refuses every read of hour 8's ledger prefix, so hour 8's fold fails on each
// of them while hours 9 to 14 are folded — hour 9 remembers her purchase, hour
// 14 carries her into the day. The store recovers; at 16:06 the job folds
// hour 8 (inside the 26-hour lookback) and re-folds the hours after it.
// The raw-day rule: the 09:15 purchase is held by her 08:30 decision →
// `ineligible`; her 14:00 decision puts her on `personalized` with no outcome
// there; u-unknown's purchase is held by her 09:05 decision → `default`.
//   armVisitors      default 1 · ineligible 1 · personalized 1
//   visitorOutcomes  default {1, {purchase 1}} · ineligible {1, {purchase 1}} ·
//                    personalized {1, {}}
// ONE purchase, on exactly ONE row: `ineligible`. RULED (P1): the folded day
// answers exactly these rows and names no hour. Measured: at 278c588 the
// folded day also counts it on `personalized` and names no hour (the review's
// probe e4 "placed-first"); at 7c2523e and at 6426de3 it answers the raw day's
// rows.
// ===========================================================================

describe('unit:W30.P1.03', () => {
  const RULED: Ruled = {
    armVisitors: [{ arm: 'default', visitors: 1 }, { arm: 'ineligible', visitors: 1 }, { arm: 'personalized', visitors: 1 }],
    visitorOutcomes: { version: 1, basis: 'enrolled_visitors', arms: [
      { arm: 'default', visitors: 1, byType: { purchase: 1 } },
      { arm: 'ineligible', visitors: 1, byType: { purchase: 1 } },
      { arm: 'personalized', visitors: 1, byType: {} },
    ] },
  };

  it('logic: when an earlier hour fails and is folded later inside the lookback, after a later hour placed the purchase as a carry-in, the re-fold leaves the purchase on exactly one row — the one the raw day gives — and the folded day answers visitorOutcomes exactly as the raw day does, naming no hour', async () => {
    const r2 = new RefusingR2(), env = fixtureEnv(r2);
    const unknown = decision({ visitor: 'u-unknown', assignment: 'default', ts: at(DATE, 9, 5), item: 'cnt-unknown-taxonomy', cell: UNKNOWN_CELL });
    await deliver(r2, env, [decision({ visitor: 'v-oo', assignment: 'ineligible', ts: at(DATE, 8, 30), item: 'cnt-tabby-evening' })], [], 'p103-early');
    await deliver(r2, env, [unknown], [
      purchase({ visitor: 'v-oo', ts: at(DATE, 9, 15), assignment: 'ineligible', products: CROSS_CATEGORY_BASKET, value: 575 }),
      purchase({ visitor: 'u-unknown', ts: at(DATE, 9, 20), assignment: 'default', products: ['CH-ROGUE-25'], value: 695 }),
    ], 'p103-morning');

    r2.refusing = ledgerHour(8);
    const outage = await cronAt(r2, env, at(DATE, 10, 6));
    await deliver(r2, env, [decision({ visitor: 'v-oo', assignment: 'personalized', ts: at(DATE, 14, 0), item: 'cnt-charms-slg' })], [], 'p103-consented');
    const carried = await cronAt(r2, env, at(DATE, 15, 6));
    r2.refusing = null;
    const recovered = await cronAt(r2, env, at(DATE, 16, 6));
    const close = await cronAt(r2, env, at(NEXT, 1, 6));

    expect({ failed: failedHours(outage, carried, recovered, close), carriedIn: carried.built.includes(hourOfDate(14)),
      recovered: [8, PURCHASE_HOUR].map(hour => recovered.built.includes(hourOfDate(hour))) },
      'W30.P1.03 — the fixture: only hour 8 failed, during the outage; hour 14 (her consented decision) was folded while hour 8 was still unfolded; at 16:06 the job folded hour 8 and re-folded hour 9')
      .toEqual({ failed: [hourOfDate(8)], carriedIn: true, recovered: [true, true] });

    expectCountedOnce(await bothDays(r2, env, at(NEXT, 1, 30)), RULED,
      'W30.P1.03 (amendment A47; W30 delivery review defect 1, second path)',
      'a later-hour placement is taken back when an earlier hour folded later finds an earlier decision of hers: kit 03 "one purchase is counted on exactly one row", so v-oo\'s 09:15 purchase is counted on the `ineligible` row her 08:30 decision gives it — exactly as the raw day counts it — and NOT also on the `personalized` row her 14:00 decision carried it onto; the raw day answers and the caught-up fold holds every row, so the folded day answers visitorOutcomes too and names no hour (P1: "a folded day answers visitorOutcomes whenever the raw day does")');
  }, 240_000);
});

// ===========================================================================
// unit:W30.F1.02 — defect 2: a remembered carry-in outcome whose placement
// waits on its own hour's re-fold, and that re-fold is REFUSED.
//
// THE DAY, BY HAND. The same shoppers and rows as W30.P1.03:
//   08:30  v-oo       coach decision, `ineligible`
//   09:05  u-unknown  coach decision, unknown cell, unknown piece, `default`
//   09:15  v-oo       coach PURCHASE, stamped `ineligible`, cross-category
//   09:20  u-unknown  coach purchase
//   14:00  v-oo       coach decision, `personalized`
// At 10:06 the store refuses hour 8's prefix: hour 9 is folded without her
// 08:30 decision and remembers her purchase. From 11:06 on, hour 8's prefix
// reads again but the store refuses every read of hour 9's prefix — the
// purchase hour: hour 8 is folded, and every re-fold of hour 9 the job attempts
// afterwards (11:06, 15:06, 01:06 the next day) fails. The day is then read.
// The raw-day rule: as W30.P1.03 —
//   armVisitors      default 1 · ineligible 1 · personalized 1
//   visitorOutcomes  default {1, {purchase 1}} · ineligible {1, {purchase 1}} ·
//                    personalized {1, {}}
// RULED (F1 "every coverage flag propagates"; W21.R1's honesty; kit 02 "never
// answers a count that omits an outcome"): a remembered carry-in outcome that
// has not been placed NAMES its hour — hour 9, `visitorOutcomes: null` — and a
// day that names no hour counts it exactly as the raw day does. Measured: at
// 278c588 the folded day answers `ineligible` with no purchase — short of hers
// — and names no hour (the review's probe e4 "refold-fails"); at 7c2523e it
// names hour 9 and answers null; at 6426de3, before W21.R1, it is short as at
// 278c588.
// ===========================================================================

describe('unit:W30.F1.02', () => {
  const RULED: Ruled = {
    armVisitors: [{ arm: 'default', visitors: 1 }, { arm: 'ineligible', visitors: 1 }, { arm: 'personalized', visitors: 1 }],
    visitorOutcomes: { version: 1, basis: 'enrolled_visitors', arms: [
      { arm: 'default', visitors: 1, byType: { purchase: 1 } },
      { arm: 'ineligible', visitors: 1, byType: { purchase: 1 } },
      { arm: 'personalized', visitors: 1, byType: {} },
    ] },
  };

  it('logic: when the re-fold of the purchase hour is refused, a remembered carry-in outcome that has not been placed names its hour and the day answers visitorOutcomes null — never a count short of it with no hour named', async () => {
    const r2 = new RefusingR2(), env = fixtureEnv(r2);
    const unknown = decision({ visitor: 'u-unknown', assignment: 'default', ts: at(DATE, 9, 5), item: 'cnt-unknown-taxonomy', cell: UNKNOWN_CELL });
    await deliver(r2, env, [decision({ visitor: 'v-oo', assignment: 'ineligible', ts: at(DATE, 8, 30), item: 'cnt-tabby-evening' })], [], 'f102-early');
    await deliver(r2, env, [unknown], [
      purchase({ visitor: 'v-oo', ts: at(DATE, 9, 15), assignment: 'ineligible', products: CROSS_CATEGORY_BASKET, value: 575 }),
      purchase({ visitor: 'u-unknown', ts: at(DATE, 9, 20), assignment: 'default', products: ['CH-ROGUE-25'], value: 695 }),
    ], 'f102-morning');

    r2.refusing = ledgerHour(8);
    const outage = await cronAt(r2, env, at(DATE, 10, 6));
    r2.refusing = ledgerHour(PURCHASE_HOUR);
    const refused = await cronAt(r2, env, at(DATE, 11, 6));
    await deliver(r2, env, [decision({ visitor: 'v-oo', assignment: 'personalized', ts: at(DATE, 14, 0), item: 'cnt-charms-slg' })], [], 'f102-consented');
    const later = await cronAt(r2, env, at(DATE, 15, 6));
    const close = await cronAt(r2, env, at(NEXT, 1, 6));
    // The store answers again; the day is read before the job's next run.
    r2.refusing = null;

    expect({ failed: failedHours(outage, refused, later, close), hour8: refused.built.includes(hourOfDate(8)),
      refoldRefused: [refused, later, close].map(run => run.failed.includes(hourOfDate(PURCHASE_HOUR))) },
      'W30.F1.02 — the fixture: hour 8 failed during its outage and was folded at 11:06; every re-fold of hour 9 the job attempted after that (11:06, 15:06, 01:06) was refused')
      .toEqual({ failed: [hourOfDate(8), hourOfDate(PURCHASE_HOUR)], hour8: true, refoldRefused: [true, true, true] });

    expectCountedOnceOrNamed(await bothDays(r2, env, at(NEXT, 1, 30)), RULED,
      'W30.F1.02 (W30 delivery review defect 2; F1 "every coverage flag propagates"; W21.R1, LANE-LOG R156)',
      'a remembered carry-in outcome that has not been placed is NAMED: v-oo\'s 09:15 purchase waits on the re-fold of hour 9, which the store refused, so the day names hour 9 in coverage.unassignedHours and answers visitorOutcomes null (kit 02: it "never answers a count that omits an outcome") — a day that names no hour must count the purchase on the `ineligible` row exactly as the raw day does, never answer a count short of it');
  }, 240_000);
});
