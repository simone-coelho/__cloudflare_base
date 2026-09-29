// src/units/W30/P1E1.unit.test.ts
// W30 — the two criteria amendments A47 and A48 add to the frozen work order
// (docs/remediation/delivery-control/program.json, ticket W30, criteria P1 and
// E1, approved by the owner on 2026-09-26), one `describe('unit:W30.<criterion
// id>')` each. The reviewed files beside this one (`B1.unit.test.ts`,
// `LEDGER.unit.test.ts`) are neither imported nor edited: importing a
// `.test.ts` would register its whole suite a second time, so the harness below
// is `src/units/W21/LEDGER.unit.test.ts`'s, the file whose W21.R1 these two
// criteria continue.
//
// WITNESSES (every expected value below comes from one of these):
//   · The W21 delivery review at bb69bda
//     (/home/simonecoelho/rem/_evidence/W21-delivery/reviewer/REPORT.md):
//     residual 1, "R1 null is effectively permanent", and its probe of a
//     realistic day (probe/r1-realistic-day.probe.test.ts): "a purchase on 09-03
//     by a visitor served only on 09-02 … the folded day names hour 9 and
//     answers `visitorOutcomes: null`. The raw day counts that visitor nowhere
//     and answers a number"; and the same for a shopper served only later that
//     day (W21.R1's own carry-in). "No frozen ticket places later-hour carry-in."
//   · The same review, residual 2 ("Residual 3 is confirmed"): "a purchase made
//     before consent lands under `personalized` in the folded day and under
//     `ineligible` in the raw day, with `unassignedHours: []` … the lookup at
//     `hourly.ts:750-751` is unchanged. In production (the cron calls with `{}`
//     at `src/index.ts:272`), it can only happen when one visitor has more than
//     200 decisions in 48 hours … On that path the kit sentence at
//     `03-payload-schemas.md:512-514` is untrue." Its probe
//     (probe/residual3.probe.test.ts, R3x) set the fold horizon to 30 minutes.
//   · The raw-day rule both criteria are measured against, `assignmentAt` in
//     `src/learn/report.ts`: "her last decision at or before it, else her first
//     of the day", over the day's own decisions of the brand.
//   · docs/kit/03-payload-schemas.md: `visitorOutcomes` counts "distinct visitors
//     on each assignment … counted by the assignment the visitor held when the
//     outcome happened … and one purchase is counted on exactly one row"; an
//     `ineligible` row "stands on its own"; `coverage.unassignedHours` "names the
//     source limitation behind those two `null`s"; a day with such an hour "keeps
//     its rows and `armVisitors` and answers `visitorOutcomes: null`".
//   · src/content/holdout.ts and src/content/service.ts: a shopper without
//     personalization consent is served the site's defaults (`armUnder`) and her
//     records carry `experiment.arm: 'ineligible'`, reason
//     `personalization_consent` (`ineligibleEnrollment`).
//
// ONE REPRESENTATION with W21.R1 (`src/units/W21/LEDGER.unit.test.ts:241`) and
// W30.V1.01 (`src/units/W30/B1.unit.test.ts:811`):
//   · the folded day's `visitorOutcomes` is the raw day's, member for member,
//     and a day that answers it names no hour in `coverage.unassignedHours`
//     (W21.R1's first branch);
//   · a day that cannot place an outcome keeps the kit's representation for
//     that — it NAMES the outcome's hour in `coverage.unassignedHours` and
//     answers `visitorOutcomes: null`, keeping `armVisitors` (W21.R1's second
//     branch). E1 admits it; P1 does not, because the raw day answers;
//   · nothing here reads or rules `HourBrand.carryIn` or `coverage.carryInHours`:
//     the hour-level statement W30.V1.01 rules (an outcome the fold of ITS hour
//     could not place is `unplaced` on that hour) stands beside a placement made
//     by a later hour, and so does the `status` V1.01 reads off it.
//
// THE PATH. The records reach the ledger through the product's own object
// writer (`writeBatches`, the call the queue consumer makes), one delivery per
// burst of activity, in the order a shopper makes them. The five-minute job is
// `catchUp(env.STORAGE, tenant, learn, now, {}, env)` exactly as
// `src/index.ts:272` calls it — two hours per run, the 26-hour lookback, the
// ring cap and the 48-hour horizon all defaults — run until quiet at moments
// through the day, so an hour is folded before the decisions of a later hour
// exist, as in production. The folded day is `runDayReport` (the route's and the
// nightly job's own call, which prefers the hour aggregates) and the raw day is
// `runReport` over the same ledger. The one departure is E1's first day, the
// witness's own probe, which passes the fold's `horizonMs` option as R3x did.
//
// THE CLOCK. `Date` is pinned to the fixture's timeline for every fold
// (`finishHour` runs its cleanup at `Date.now()`), as W21.R1 pins it.

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi, afterEach } from 'vitest';

import { experimentIdFor, ineligibleEnrollment } from '@/content/holdout';
import type { DecisionRecord, EnrollmentProvenance, HoldoutConfig, LearnConfig } from '@/content/types';
import { catchUp, runDayReport, HOUR_MS, RING_CAP } from '@/learn/hourly';
import { runReport, type DayReport } from '@/learn/report';
import { ts36, type OutcomeRecord } from '@/ledger/records';
import { writeBatches } from '@/ledger/writer';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture: one Tapestry-wide tenant with its launch brand and a
// second brand (F21 §6(c); tapestry_requirements "Multi-brand rollout (Coach,
// Kate Spade)"), Coach's own vocabulary (A.3.6), a piece the taxonomy does not
// know, a shopper in the unknown cell and a basket that crosses categories.
// ===========================================================================

const TENANT = 'tapestry';
const BRAND = 'coach';
const OTHER_BRAND = 'kate-spade';
const SALT = 'w30-p1e1-experiment';
const MIN = 60_000;
const H = HOUR_MS;
const DAY_MS = 86_400_000;
const DATE = '2026-09-03';
const PREVIOUS = '2026-09-02';
const at = (date: string, hour: number, minute = 0, second = 0): number =>
  Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`);
const ALL_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const HOLDOUT: HoldoutConfig = { share: 0.5, salt: SALT, arms: ['default'] };
/** The tenant's published learn document: a 50 % holdout, one clicked slot, the platform's default policy (W21.R1's). */
const LEARN = {
  holdout: HOLDOUT,
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { hero: { reward: 'click' } },
} as unknown as LearnConfig;

const COACH_CELL = { channel: 'web', visit_bucket: 'returning', stage: 'consider', region: 'US-NY', affinity: 'evening' };
const UNKNOWN_CELL = { channel: 'web', visit_bucket: 'new', stage: 'unknown', region: 'none', affinity: 'none' };

const retentionPolicy: RetentionPolicy = { id: 'w30-p1e1-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };

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
 * What a shopper's records say about her place in the experiment. A randomised
 * assignment carries the arm her persistent anchor drew; a shopper without
 * personalization consent is never drawn, and the engine's own
 * `ineligibleEnrollment` names why (`src/content/holdout.ts`).
 */
type Assignment = 'personalized' | 'default' | 'ineligible';
const provenance = (brand: string, assignment: Assignment): EnrollmentProvenance => assignment === 'ineligible'
  ? ineligibleEnrollment({ tenant: TENANT, brand, holdout: HOLDOUT, saltVersion: 1, reason: 'personalization_consent' })
  : { id: experimentIdFor(TENANT, brand, SALT), saltVersion: 1, arm: assignment, anchorGeneration: 1 };

/**
 * One decision. Without consent she is served the site's own defaults
 * (`armUnder`, `src/content/consent.ts`) and the provenance says `ineligible`;
 * with it, the experience served is the arm drawn.
 */
function decision(input: { visitor: string; brand?: string; assignment: Assignment; ts: number; item: string; page?: string; position?: number; cell?: Record<string, string> }): DecisionRecord {
  const brand = input.brand ?? BRAND, page = input.page ?? 'home', position = input.position ?? 0;
  return {
    decision_id: `${TENANT}:${ts36(input.ts)}:${input.visitor}:${page}:hero:${position}`,
    tenant: TENANT, brand, visitor_id: input.visitor, session_id: `s-${input.visitor}`, identity_anchor: 'visitor', ts: input.ts,
    page, slot: 'hero', position, item_id: input.item, customer_item_id: `CMS-${input.item.toUpperCase()}`, candidates: [],
    cell: input.cell ?? COACH_CELL, arm: input.assignment === 'personalized' ? 'personalized' : 'default', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w30-p1e1',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    experiment: provenance(brand, input.assignment),
  } as unknown as DecisionRecord;
}

/**
 * A purchase, stamped as the producer stamps it: the visitor's enrollment and
 * her consent at the moment it is recorded (kit 03 `experiment`), so a purchase
 * made before consent says `ineligible`. No slot and no decision reference: a
 * purchase names the products bought (`products`), here across categories.
 */
function purchase(input: { visitor: string; ts: number; assignment: Assignment; products: string[]; value: number; index?: number }): OutcomeRecord {
  return {
    outcome_id: `${TENANT}:${ts36(input.ts)}:${input.visitor}:purchase:${input.index ?? 0}`,
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
 * `{tenant}/{date}/{hour}/{stream}/{min}-{max}-{batch}.ndjson` — each row
 * stamped the way the producer stamps it.
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

type FoldOptions = Parameters<typeof catchUp>[4];

/**
 * The five-minute job at one moment, run until a run folds nothing:
 * `catchUp(env.STORAGE, tenant, learn, now, opts, env)` exactly as
 * `src/index.ts:272` calls it, with the cron's own `{}` unless a day says
 * otherwise. Returns the hours any run could not fold.
 */
async function cronAt(r2: UnitR2, env: Env, now: number, opts: FoldOptions = {}): Promise<string[]> {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'], now });
  vi.setSystemTime(now);
  const failed: string[] = [];
  for (let run = 0; run < 60; run++) {
    const result = await catchUp(r2 as unknown as Parameters<typeof catchUp>[0], TENANT, LEARN, now, opts, env);
    failed.push(...result.failed.map(hour => `${hour.date} ${hour.hour}: ${hour.error}`));
    if (!result.built.length) break;
  }
  return failed;
}

type RuledDay = DayReport & { coverage?: { unassignedHours?: number[] | null; missingHours?: number[] } };

/** The day as an operator reads it from the hour aggregates, and the raw-day branch over the same ledger. */
async function bothDays(r2: UnitR2, env: Env, now: number): Promise<{ folded: RuledDay; raw: RuledDay }> {
  vi.setSystemTime(now);
  const ids = { tenant: TENANT, brand: BRAND, date: DATE };
  const folded = await runDayReport(r2 as unknown as Parameters<typeof runDayReport>[0], ids, LEARN, null, now, {}, env) as RuledDay;
  const raw = await runReport(r2 as unknown as Parameters<typeof runReport>[0], ids, LEARN, null, now, env) as RuledDay;
  return { folded, raw };
}

/** The repository itself, resolved from this module and never from the working directory. */
const REPO = new URL('../../../', import.meta.url);
const repoFile = (path: string): string => readFileSync(new URL(path, REPO), 'utf8');
/** Does one sentence of published prose carry all of these? A full stop ends a sentence only before whitespace. */
const saysInProse = (text: string, ...patterns: RegExp[]): boolean =>
  text.split(/(?<=[.!?])\s+/).some(sentence => patterns.every(pattern => pattern.test(sentence)));

// ===========================================================================
// unit:W30.P1 — a later-hour carry-in outcome is placed on the arm of the
// decision that carried it in.
//
// THE DAY, BY HAND. Tenant `tapestry`, brand `coach`, 2026-09-03, the residual-1
// realistic day with both of its shoppers and W21.R1's carry-in:
//   09-02 20:05  v-prior      decision, assignment `default` (served the day BEFORE)
//   09:05        v-control    decision, assignment `default`
//   09:15        v-later      PURCHASE — no decision of hers yet today
//   09:20        v-prior      PURCHASE — no decision of hers on 09-03 at all
//   09:30        v-control    purchase
//   10:40        u-unknown    PURCHASE, a basket across Handbags and Small
//                             Leather Goods — no decision of hers yet today
//   11:00        u-unknown    decision in the unknown cell, on the piece the
//                             taxonomy does not know, assignment `default`
//   11:05        u-unknown    click on it
//   14:00        v-later      decision, assignment `personalized` — her ONLY one
//                             of the day
// The raw-day rule (`assignmentAt`): v-control's purchase is held by her 09:05
// decision → `default`; v-later's 09:15 purchase precedes every decision of her
// day → her first of the day, 14:00 → `personalized`; u-unknown's 10:40
// purchase → her first of the day, 11:00 → `default`, and her click is held by
// it; v-prior has no decision on 09-03 → counted nowhere, and she is no
// visitor of the day. Therefore:
//   armVisitors      default 2 (v-control, u-unknown) · personalized 1 (v-later)
//   visitorOutcomes  default {visitors 2, byType {click 1, purchase 2}}
//                    personalized {visitors 1, byType {purchase 1}}
// Measured on the integration head (9df3365) before this file: the folded day
// names hours 9 and 10 and answers `visitorOutcomes: null`; on the W30-B1 build
// (1c4d153) it answers a number short of both carry-in purchases.
// ===========================================================================

describe('unit:W30.P1', () => {
  const RULED_ARM_VISITORS = [{ arm: 'default', visitors: 2 }, { arm: 'personalized', visitors: 1 }];
  const RULED_VISITOR_OUTCOMES = { version: 1, basis: 'enrolled_visitors', arms: [
    { arm: 'default', visitors: 2, byType: { click: 1, purchase: 2 } },
    { arm: 'personalized', visitors: 1, byType: { purchase: 1 } },
  ] };

  it('logic: on a realistic day folded by the five-minute job as it happens, each later-hour carry-in purchase is placed on the arm of the decision that carried it in, and the folded day answers visitorOutcomes exactly as the raw day does', async () => {
    const r2 = new UnitR2(), env = fixtureEnv(r2);
    const prior = decision({ visitor: 'v-prior', assignment: 'default', ts: at(PREVIOUS, 20, 5), item: 'cnt-rogue-work' });
    const control = decision({ visitor: 'v-control', assignment: 'default', ts: at(DATE, 9, 5), item: 'cnt-tabby-evening' });
    const unknown = decision({ visitor: 'u-unknown', assignment: 'default', ts: at(DATE, 11, 0), item: 'cnt-unknown-taxonomy', cell: UNKNOWN_CELL });
    const later = decision({ visitor: 'v-later', assignment: 'personalized', ts: at(DATE, 14, 0), item: 'cnt-charms-slg' });

    // The day as it happens: each burst delivered as it is made, the job run
    // after the hours it can see have closed.
    await deliver(r2, env, [prior], [], 'p1-prior-served');
    const failed = await cronAt(r2, env, at(PREVIOUS, 21, 6));
    await deliver(r2, env, [control], [
      purchase({ visitor: 'v-later', ts: at(DATE, 9, 15), assignment: 'personalized', products: ['CH-TABBY-SHOULDER-26'], value: 450 }),
      purchase({ visitor: 'v-prior', ts: at(DATE, 9, 20), assignment: 'default', products: ['CH-ROGUE-25'], value: 695 }),
      purchase({ visitor: 'v-control', ts: at(DATE, 9, 30), assignment: 'default', products: ['CH-TABBY-SHOULDER-26'], value: 450 }),
    ], 'p1-morning');
    failed.push(...await cronAt(r2, env, at(DATE, 10, 6)));
    await deliver(r2, env, [], [purchase({ visitor: 'u-unknown', ts: at(DATE, 10, 40), assignment: 'default',
      products: ['CH-TABBY-SHOULDER-26', 'CH-WILLOW-CARD-CASE'], value: 575 })], 'p1-unknown-basket');
    await deliver(r2, env, [unknown], [click(unknown, at(DATE, 11, 5), 'default')], 'p1-unknown-served');
    failed.push(...await cronAt(r2, env, at(DATE, 12, 6)));
    await deliver(r2, env, [later], [], 'p1-later-served');
    failed.push(...await cronAt(r2, env, at(DATE, 15, 6)));
    failed.push(...await cronAt(r2, env, at('2026-09-04', 1, 6)));

    const { folded, raw } = await bothDays(r2, env, at('2026-09-04', 1, 30));
    expect({ armVisitors: raw.armVisitors?.arms, visitorOutcomes: raw.visitorOutcomes },
      'the raw-day branch, by hand: each carry-in purchase under the first decision of its shopper\'s day, the purchase of the shopper served only the day before counted nowhere (`src/learn/report.ts` assignmentAt)')
      .toEqual({ armVisitors: RULED_ARM_VISITORS, visitorOutcomes: RULED_VISITOR_OUTCOMES });
    expect({ failed, source: folded.hours?.source, built: folded.hours?.built, missingHours: folded.coverage?.missingHours },
      'the fixture: the five-minute job folded every hour of the date and nothing is missing, so the folded day has every hour a later decision could be in')
      .toEqual({ failed: [], source: 'aggregates', built: ALL_HOURS, missingHours: [] });

    expect({ visitorOutcomes: folded.visitorOutcomes, unassignedHours: folded.coverage?.unassignedHours },
      `W30.P1 (amendment A47; W21 delivery review residual 1) — a later-hour carry-in outcome is PLACED on the arm of the decision that carried it in: v-later's 09:15 purchase under the \`personalized\` decision she was served at 14:00 and u-unknown's 10:40 basket under the \`default\` decision of 11:00, while the purchase of the shopper served only the day before is counted nowhere, exactly as the raw day counts them — so the folded day answers \`visitorOutcomes\` whenever the raw day does, member for member, and names no hour it could not place. Folded day answered unassignedHours ${JSON.stringify(folded.coverage?.unassignedHours)}`)
      .toEqual({ visitorOutcomes: RULED_VISITOR_OUTCOMES, unassignedHours: [] });
  }, 120_000);
});

// ===========================================================================
// unit:W30.E1 — when the attribution ring has evicted a visitor's earlier
// decision, a purchase made before consent is never folded under an arm she did
// not hold: the fold corrects it or flags it.
//
// THE SHOPPER, BY HAND. v-switch browses coach.com before she has consented to
// personalization: at 07:05 she is served the site's defaults and her decision
// says `ineligible` (reason `personalization_consent`). At 09:10 she buys a
// Tabby bag and a card case — still without consent, so the raw-day rule holds
// the purchase under her last decision at or before it, 07:05, `ineligible`.
// Later she consents and is served a `personalized` decision. Beside her,
// v-tabby, a consenting shopper, is served at 09:20 and clicks at 09:25.
// Therefore, on every day below, the raw day says:
//   armVisitors      ineligible 1 (v-switch) · personalized 2 (v-switch, v-tabby)
//   visitorOutcomes  ineligible {visitors 1, byType {purchase 1}}
//                    personalized {visitors 2, byType {click 1}}
// and the kit sentence is: "counted by the assignment the visitor held when the
// outcome happened … one purchase is counted on exactly one row".
//
// Three days, one per way the fold's ring can lose the 07:05 decision:
//   (a) the witness's own day (R3x): the fold's horizon is 30 minutes, so the
//       07:05 decision is outside the ring at 09:10; consent and the
//       `personalized` decision come at 09:40, the same hour.
//   (b) the production path, the cron's own `{}`: between 07:05 and 09:10 she
//       makes RING_CAP (read off the module; 200 as built, the value LIVE2
//       approves) decisions on katespade.com — more than 200 decisions in 48
//       hours with the 07:05 one, the witness's condition — and
//       the per-visitor ring is capped ACROSS brands, so the 07:05 coach
//       decision is the one evicted; `personalized` at 09:40, the same hour.
//   (c) as (b), but consent and the `personalized` decision come at 14:00, in a
//       LATER hour: the carry-in shape P1 places. This is P1's boundary — a
//       purchase whose earlier decision was evicted is NOT a later-hour
//       carry-in, and placing it on the 14:00 decision is the same wrong row.
// RULED, the criterion's own disjunction, each branch in the kit's own terms:
//   CORRECTED — the folded day answers `visitorOutcomes` exactly as the raw day
//     does (the purchase on the `ineligible` row) and names no hour; or
//   FLAGGED — the folded day names the purchase's hour, 9, in
//     `coverage.unassignedHours` and answers `visitorOutcomes: null`, keeping
//     its `armVisitors` (kit 03, `coverage.unassignedHours`).
// Anything else — above all the purchase counted under `personalized` with no
// hour named — fails. Measured on the integration head before this file: days
// (a) and (b) fold the purchase under `personalized` and name no hour; day (c)
// names hour 9 (W21 R1's naming); on the W30-B1 build (1c4d153) (a) and (b) are
// the same, and (c) answers a number without the purchase and names no hour.
// ===========================================================================

describe('unit:W30.E1', () => {
  const RULED_ARM_VISITORS = [{ arm: 'ineligible', visitors: 1 }, { arm: 'personalized', visitors: 2 }];
  const RULED_VISITOR_OUTCOMES = { version: 1, basis: 'enrolled_visitors', arms: [
    { arm: 'ineligible', visitors: 1, byType: { purchase: 1 } },
    { arm: 'personalized', visitors: 2, byType: { click: 1 } },
  ] };
  const PURCHASE_HOUR = 9;

  /** One of the three days, delivered as it happens and folded by the five-minute job. */
  async function preConsentDay(shape: { consentAt: number; kateSpadeDecisions: number; opts: FoldOptions }): Promise<{ folded: RuledDay; raw: RuledDay; failed: string[] }> {
    const r2 = new UnitR2(), env = fixtureEnv(r2);
    const failed: string[] = [];
    await deliver(r2, env, [decision({ visitor: 'v-switch', assignment: 'ineligible', ts: at(DATE, 7, 5), item: 'cnt-tabby-evening' })], [], 'e1-pre-consent');
    // Kate Spade, before consent too: spread evenly from 07:06 to before 09:09,
    // whatever RING_CAP the module compiles, and delivered hour by hour, so the
    // ring the fold keeps for her fills across both brands before she buys.
    const from = at(DATE, 7, 6), span = at(DATE, 9, 9) - from;
    const kateSpade = Array.from({ length: shape.kateSpadeDecisions }, (_, n) => decision({ visitor: 'v-switch', brand: OTHER_BRAND,
      assignment: 'ineligible', ts: from + Math.floor(n * span / shape.kateSpadeDecisions), item: `ks-knott-${n % 7}`, page: 'plp', position: n % 4 }));
    for (const hour of [7, 8, 9]) {
      const rows = kateSpade.filter(d => new Date(d.ts).getUTCHours() === hour);
      if (rows.length) await deliver(r2, env, rows, [], `e1-kate-spade-${hour}`);
    }
    failed.push(...await cronAt(r2, env, at(DATE, 8, 6), shape.opts));
    failed.push(...await cronAt(r2, env, at(DATE, 9, 6), shape.opts));
    const tabby = decision({ visitor: 'v-tabby', assignment: 'personalized', ts: at(DATE, 9, 20), item: 'cnt-tabby-evening' });
    await deliver(r2, env, [tabby], [
      purchase({ visitor: 'v-switch', ts: at(DATE, 9, 10), assignment: 'ineligible', products: ['CH-TABBY-SHOULDER-26', 'CH-WILLOW-CARD-CASE'], value: 575 }),
      click(tabby, at(DATE, 9, 25), 'personalized'),
    ], 'e1-morning');
    const consented = decision({ visitor: 'v-switch', assignment: 'personalized', ts: shape.consentAt, item: 'cnt-rogue-work' });
    if (new Date(shape.consentAt).getUTCHours() === PURCHASE_HOUR) await deliver(r2, env, [consented], [], 'e1-consented');
    failed.push(...await cronAt(r2, env, at(DATE, 10, 6), shape.opts));
    if (new Date(shape.consentAt).getUTCHours() !== PURCHASE_HOUR) {
      await deliver(r2, env, [consented], [], 'e1-consented');
      failed.push(...await cronAt(r2, env, shape.consentAt + H + 6 * MIN, shape.opts));
    }
    failed.push(...await cronAt(r2, env, at('2026-09-04', 1, 6), shape.opts));
    const { folded, raw } = await bothDays(r2, env, at('2026-09-04', 1, 30));
    return { folded, raw, failed };
  }

  /** The criterion's disjunction, each branch in the kit's own representation. */
  function expectCorrectedOrFlagged(day: { folded: RuledDay; raw: RuledDay; failed: string[] }, which: string): void {
    expect({ armVisitors: day.raw.armVisitors?.arms, visitorOutcomes: day.raw.visitorOutcomes },
      `${which} — the raw-day branch, by hand: the purchase made before consent is held by her 07:05 \`ineligible\` decision, the last at or before it, and stands on its own row`)
      .toEqual({ armVisitors: RULED_ARM_VISITORS, visitorOutcomes: RULED_VISITOR_OUTCOMES });
    expect({ failed: day.failed, source: day.folded.hours?.source, built: day.folded.hours?.built, missingHours: day.folded.coverage?.missingHours },
      `${which} — the fixture: the five-minute job folded every hour of the date`)
      .toEqual({ failed: [], source: 'aggregates', built: ALL_HOURS, missingHours: [] });
    const named = day.folded.coverage?.unassignedHours;
    if (Array.isArray(named) && named.includes(PURCHASE_HOUR)) {
      // FLAGGED: the hour that holds the purchase is named, and the one member
      // the day cannot support is withdrawn; the arm denominators stand.
      expect({ armVisitors: day.folded.armVisitors?.arms, visitorOutcomes: day.folded.visitorOutcomes },
        `W30.E1 (amendment A48) ${which} — a day that NAMES hour 9 in coverage.unassignedHours flags the purchase it cannot place: it answers visitorOutcomes null, never a count that puts the purchase on a row she did not hold, and keeps its armVisitors (kit 03, coverage.unassignedHours)`)
        .toEqual({ armVisitors: RULED_ARM_VISITORS, visitorOutcomes: null });
    } else {
      expect({ visitorOutcomes: day.folded.visitorOutcomes, unassignedHours: named },
        `W30.E1 (amendment A48; W21 delivery review residual 2) ${which} — when the attribution ring has evicted her 07:05 decision, the purchase she made before consent is never folded under \`personalized\`, an arm she did not hold when she bought: a day that names no hour must CORRECT it — the purchase on the \`ineligible\` row, exactly as the raw day counts it — or else name hour 9 and answer null (FLAG it). Measured before the build: the fold falls back to a decision made AFTER the purchase (hourly.ts foldShard, the \`held\` lookup: the ring at or before, else the first decision of the hour), so the kit sentence "counted by the assignment the visitor held when the outcome happened" is untrue on this path`)
        .toEqual({ visitorOutcomes: RULED_VISITOR_OUTCOMES, unassignedHours: [] });
    }
  }

  it('logic: a purchase made before consent, whose earlier decision the fold\'s ring has lost — to the horizon, or to the ring cap under the cron\'s own options with the next decision in the same hour or a later one — is corrected onto her ineligible row or flagged, never folded under personalized, and the kit sentence on it stands', async () => {
    // The published promise the fold must make true, not retract.
    expect(saysInProse(repoFile('docs/kit/03-payload-schemas.md'), /`visitorOutcomes`/, /assignment the visitor held/i, /when the outcome happened/i),
      'W30.E1 — docs/kit/03-payload-schemas.md keeps stating, in one sentence, that `visitorOutcomes` counts a visitor by the assignment she held when the outcome happened; the fold is what must make it true on the ring-eviction path')
      .toBe(true);

    // (a) the witness's own day: the fold's horizon loses the 07:05 decision.
    expectCorrectedOrFlagged(await preConsentDay({ consentAt: at(DATE, 9, 40), kateSpadeDecisions: 0, opts: { horizonMs: 30 * MIN } }),
      'day (a), the witness\'s R3x — the fold\'s 30-minute horizon, consent at 09:40');

    // (b) production: the cron's own options; RING_CAP decisions on the second brand evict the 07:05 one.
    expect(RING_CAP, 'the ring cap the cron runs under, read off the module (`src/learn/hourly.ts` RING_CAP): a positive count').toBeGreaterThan(0);
    expectCorrectedOrFlagged(await preConsentDay({ consentAt: at(DATE, 9, 40), kateSpadeDecisions: RING_CAP, opts: {} }),
      `day (b), the production path — the cron's own options, ${RING_CAP} kate-spade decisions between the 07:05 decision and the purchase, consent at 09:40`);

    // (c) P1's boundary: the next decision is in a LATER hour.
    expectCorrectedOrFlagged(await preConsentDay({ consentAt: at(DATE, 14, 0), kateSpadeDecisions: RING_CAP, opts: {} }),
      `day (c), P1's boundary — as (b), consent at 14:00: an evicted earlier decision is not a later-hour carry-in`);
  }, 240_000);
});
