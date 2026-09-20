// src/units/W31/B1.unit.test.ts
// W31 batch B1 — the local scope of the long-window reporting item: full
// monthly/quarterly/biannual coverage named day by day, oversized windows
// refused, the versions of what was pooled stated, zero/sparse/unequal-arm
// evidence contained, and the lightweight day summary kept separate from the
// full payload.
//
// One `describe('unit:W31.<id>')` per unit of batch W31-B1, one `it` per ruled
// leg. Every expected value comes from a witness or from this file's own
// fixture arithmetic — never from what the engine returns today.
//
// WITNESSES
//   · document 35 §5 row W31 (:433): "Refuse or explicitly mark incomplete/
//     oversized windows and incompatible policies; no favorable standing on
//     incomplete evidence. Full monthly/quarterly/biannual coverage, per-tenant
//     metric/target versions and correct zero/sparse/unequal-arm/cluster/revenue
//     analysis under W21. Separate lightweight report summaries from full
//     payloads."
//   · docs/architecture/35-verification-reports/F25.md
//       §5.2 "The pre-set targets are hardcoded to one customer … no
//         configuration document, route or console field reaches it."
//       §5.3 the day report carries `counts.visitors` but not per arm, so the
//         design effect cannot be computed from what is stored.
//       §5.6 "`window.test.ts` never exercises the failure … no `windowReport`
//         test uses a window longer than 3 days … the defect is that a
//         deliberate cap was never given a way to announce itself."
//       §5.7 "Heterogeneous days pool without a check. `windowReport` sums
//         `holdout` rows across days that may have been built under different
//         attribution policies, slot rewards, objectives OR HOLDOUT SHARES."
//       §7.1 the requested period is never relabelled; §7.2 the completeness is
//         carried through and no standing is produced from it.
//       §1.3 the allocation is what makes sufficiency computable on the
//         customer's side, "instead of a fixed 95 % and an assumption of equal
//         arms".
//   · docs/architecture/35-verification-reports/F07.md
//       §5.2 "`MAX_WINDOW_DAYS` … CANNOT EXPRESS the customer's '6+ months
//         minimum' (requirement line 365) IN A SINGLE READING."
//       §5.10 CVR, revenue per visitor and the return rate are computed nowhere
//         in `src/`; they are the customer's own unit definitions.
//       §7 the F07 mechanics of the unimported `src/measure/holdout.ts` are a
//         later W21 unit and are not re-ruled here.
//   · docs/architecture/35-verification-reports/F34.md
//       §4.3 "`windowReport` parses whole day reports for `report.holdout`, up
//         to 92 of them, on the view's default load."
//       §4.4 "The report grids carry six pooling levels per item and the UI
//         reads one … roughly five sixths of the largest payload in the product
//         is downloaded and discarded."
//       §6 "the smallest useful server change is a `?slot=` projection on
//         `GET /v1/:tenant/learn/report` that returns the report with `grids`
//         narrowed to the requested slot (and `items` paged)."
//   · docs/architecture/tapestry_requirements.txt §6.4.1 (:365): the holdout is
//     constant for "6+ months minimum" — the period the platform cannot answer
//     in one reading, which is why the composition rule below is published.
//   · docs/handover/HANDOFF-2026-09-16.md :235: bounded ≤184-day windows,
//     missing/mixed-policy withholding and lightweight summaries EXIST; complete
//     monthly/quarterly/biannual coverage and metric versions are OPEN, and
//     "diagnostic long-window reporting is implemented, not validated
//     experimental inference".
//   · docs/handover/HANDOFF-2026-09-18.md §8 D04/D09: the target VALUES, the
//     metric definitions (CVR, RPV, returns), the cluster-aware and revenue
//     analysis and valid experimental inference are the owner's and Data
//     Science's. They are W31.P1.01, a `no-witness` row with no test here.
//   · docs/kit/02-api-reference.md:576 (the window route) and
//     docs/kit/03-payload-schemas.md "The day report" (the published shapes).
//   · rulings R19, R21 (a ruled-but-absent member is named and no widening cast
//     hides it), R108 (no target vocabulary reaches a report answer at all),
//     R112(d), R149 (every new member is OPTIONAL in stored evidence, because a
//     report written before this release cannot carry it), R178 (this batch's
//     reading).
//
// ONE REPRESENTATION, shared by every unit below, so no two units demand
// opposite things of the same fixture:
//
//  (i)   THE WINDOW ANSWERS ITS PERIOD DAY BY DAY, and the period is never
//        relabelled. Every requested date appears exactly once across `days`
//        (a report was read) and `missing` (none exists); `incomplete[]` names
//        each READ day whose source is truncated or whose hours were not all
//        folded, with `missingHours` ascending. A period longer than
//        `MAX_WINDOW_DAYS` = 184 — "the longest six consecutive full calendar
//        months" — is REFUSED with its maximum named, before any storage read,
//        and the customer kit states how to read a longer period as consecutive
//        windows (F07 §5.2: "6+ months minimum" is not expressible in one
//        reading). This file does NOT rule `requestedDays`/`readDays`/
//        `truncated` on the window answer: F25 §7.1 offers those members only
//        for the branch where a window is SHORTENED, and this repository
//        refuses instead — `src/measure/window.ts:64`, locked by
//        `src/measure/window.test.ts:31` and `src/units/W21/B1.unit.test.ts:818`.
//        The requested length is `days.length + missing.length` and the read
//        length is `days.length`, and both are asserted below as such.
//  (ii)  NO FAVORABLE STANDING ON INCOMPLETE EVIDENCE, anywhere. The day and
//        window answers keep `measurement.kind = 'attribution_diagnostic'` and
//        `inference = 'unavailable'`; no member and no sentence names
//        incrementality, causal lift, a reached target, a confidence or an
//        interval, on either shipped screen or in either body (R108, locked by
//        `src/learn/report.test.ts:848`).
//  (iii) THE WINDOW STATES WHAT IT POOLED UNDER. Beside the per-slot
//        `compatibility { status, reasons, days }` W21 delivered, the window
//        answer carries
//            allocation: { version: 1; source: 'published'; share: number; arms: string[] } | null
//        — the published allocation EVERY pooled day agrees on; `null` when any
//        pooled day carries none (an unknown, never a guess) or when two
//        disagree — and, per slot,
//            computation: { version; profile: { source; horizonMs; ringCap };
//                           learning: AttributionPolicy; reward; objective;
//                           tauLearnMs; measurementBasis } | null
//        — the one recorded computation identity the slot pooled under; `null`
//        where the slot is not compatible. Two pooled days with DIFFERENT
//        published allocations are a mixed basis exactly as two computations
//        are: the slot answers `status: 'mixed'` with the new reason
//        `'mixed_allocation'`, its days, and no pooled arms. ABSENCE is not
//        disagreement (R149): a day written before the field existed leaves the
//        window's `allocation` null and adds no reason.
//  (iv)  ZERO, SPARSE AND UNEQUAL-ARM EVIDENCE IS CONTAINED, NOT REPAIRED. An
//        arm with no decisions answers `creditedPerDecision: null` — never 0,
//        never 1, never NaN; an arm below `nMin` is reported as the count it is
//        with no sufficiency claim beside it; an unequal allocation is STATED
//        (iii) rather than assumed equal (F25 §1.3). No rate, CVR, RPV or
//        return-rate metric is defined anywhere here: those are the customer's
//        units (D04, W31.P1.01).
//  (v)   THE LIGHTWEIGHT SUMMARY IS SEPARATE FROM THE FULL PAYLOAD. The window
//        pools from each day's leading `_summary` frame through ONE ranged read
//        per day, bounded by `REPORT_LIMITS.summaryBytes`, and never parses the
//        day's grids; the day GET's `?slot=` projection narrows `grids` to the
//        requested slot and each item to its pooled `'*'` level, paged; the full
//        payload stays reachable and bounded by `REPORT_LIMITS`. Because (iii)
//        is read by the window, the allocation must RIDE THE SUMMARY: the reads
//        below stay exactly one ranged get per day after it lands.
//
// RULED MEMBERS AND SENTENCES, absent today (R21), each named at its assertion:
//   1. `WindowReport.allocation: ReportAllocation | null` (`src/measure/window.ts`),
//      pooled from each day's summary, which therefore carries the day's
//      `allocation` (`ReportSummary`/`canonicalReportJson`/`summaryShape` in
//      `src/learn/report.ts`) — optional in stored evidence (R149).
//   2. The compatibility reason `'mixed_allocation'` in
//      `WindowReport['slots'][string]['compatibility']['reasons']`.
//   3. Per-slot `WindowReport['slots'][string]['computation']`.
//   4. Two published sentences: the composition rule for a period longer than
//      184 days (`docs/kit/02-api-reference.md`) and the window's allocation
//      members (`docs/kit/03-payload-schemas.md`), asserted verbatim.
//   5. One rendered line on BOTH shipped screens: the published allocation the
//      day report already carries, which neither screen prints today.
//
// NOT THIS BATCH, named as seams: the cluster-aware, revenue and unequal-arm
// ANALYSIS and the target values (D04/D09 — W31.P1.01); the F07 mechanics of
// the unimported `src/measure/holdout.ts` and the production-control experiment
// (W21's later units); `buildReport`'s quadratic lookup and the payload bounds
// themselves (W32 — `REPORT_LIMITS` is reused by name below, never re-ruled);
// egress accounting (W36/W37).

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import { JSDOM } from 'jsdom';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { ContentPiece, LearnConfig, SlotCatalog } from '@/content/types';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { configRoutes } from '@/routes/config';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { DEFAULT_POLICY } from '@/learn/policy';
import { DEFAULT_STATS } from '@/learn/stats';
import {
  attributionArm, canonicalReportJson, computationBasis, publishedAllocation, readReportView,
  reportCoverage, reportKey, REPORT_LIMITS, REPORT_MEASUREMENT,
  type ArmRow, type DayReport, type ReportAllocation, type SavedReportReader,
} from '@/learn/report';
import { datesBetween, MAX_WINDOW_DAYS, windowReport, WindowRangeError, type WindowReport } from '@/measure/window';
import * as measureHoldout from '@/measure/holdout';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture. Coach's own vocabulary (tapestry_requirements A.3.6:
// Tabby, Rogue, evening, work, Handbags), held here and never in product code
// (METHOD §6).
// ===========================================================================

const TENANT = 'coach';
const OPERATOR_SECRET = 'w31-b1-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const SLOT = 'hero';

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: [SLOT], lifecycle: { status: 'live' }, ...over,
});
const W31_CATALOGUE = { version: 'w31-b1-coach-catalogue', pieces: [
  piece('cnt-tabby-evening-edit', { title: 'Evening, restated', tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'] } }),
  piece('cnt-rogue-work-edit', { title: 'The Rogue, at work', tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'] } }),
] };
const W31_SLOTS: SlotCatalog = { version: 'w31-b1-coach-slots',
  pages: { home: [{ slot: SLOT, take: 1, weights: { occasion: 0.35, line: 0.25 } }] } };
const learnDocument = (share = 0.05) => ({
  holdout: { share, salt: 'w31-b1-experiment', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: {},
});

/**
 * The claim vocabulary the platform may not use about its own counts
 * (document 35 :433; F07 §3, §7; R108). Copied by value from
 * `src/units/W21/B1.unit.test.ts:585` so both batches judge one vocabulary.
 */
const FORBIDDEN_CLAIMS = [
  'incrementality',
  'the holdout is the reason we can say so',
  'reached_stretch', 'reached_target', 'reached_minimum',
  'the target is reached', 'the stretch target is reached', 'the minimum is reached',
  'causal',
] as const;
const claimsIn = (payload: unknown): string[] => {
  const text = (typeof payload === 'string' ? payload : JSON.stringify(payload)).toLowerCase();
  return FORBIDDEN_CLAIMS.filter(claim => text.includes(claim));
};
/** The inference vocabulary a report answer may not carry at all — `src/learn/report.test.ts:848`. */
const INFERENCE_VOCABULARY = /UNSUPPORTED|confidence|verdict|targets|neededPerArm|relative|"lo"|"hi"/;
/** A fabricated number a contained answer never prints (F07 §5.3). */
const FABRICATED = /NaN|Infinity/;

// ===========================================================================
// The stored day report, written by the product's own canonical writer, so the
// window reads exactly the bytes production stores (`canonicalReportJson`:
// a leading `_summary` frame, then the full report in the same object).
// ===========================================================================

type Rows = Record<string, Array<{ arm: string; decisions: number; credited: number }>>;
interface DayFixture {
  date: string;
  holdout: Rows;
  /** The source was cut at the record cap. */
  truncated?: boolean;
  /** Which of the 24 hours were folded into the day; the rest are missing. */
  built?: number[];
  /** The published allocation the day was served under; omitted = written before the field existed. */
  allocation?: ReportAllocation;
  reward?: 'click' | 'purchase';
  objective?: 'unit' | 'revenue';
  /** How many content pieces carry a grid, for the payload-size measurements. */
  items?: number;
}

const HORIZON_MS = 3_600_000;
const learnFor = (f: DayFixture): LearnConfig => ({
  holdout: { share: 0.05, salt: 'w31-b1-experiment', arms: ['default'] },
  slots: { [SLOT]: { reward: f.reward ?? 'click', objective: f.objective ?? 'unit' } },
} as unknown as LearnConfig);

function dayDocument(f: DayFixture): DayReport {
  const built = f.built ?? [...Array(24).keys()];
  const missingHours = [...Array(24).keys()].filter(hour => !built.includes(hour));
  const counts = { decisions: 0, outcomes: 0, visitors: 0, truncated: f.truncated === true };
  for (const rows of Object.values(f.holdout)) for (const row of rows) { counts.decisions += row.decisions; counts.outcomes += row.credited; counts.visitors += row.decisions; }
  const hours = { source: 'aggregates' as const, built, missing: missingHours, horizonMs: HORIZON_MS };
  const coverage = reportCoverage({ counts, hours }, { version: 1, source: 'aggregates', truncated: counts.truncated,
    visitorsIncomplete: false, missingHours, truncatedHours: [], unadvancedHours: [], unknownHours: [],
    horizons: built.map(hour => ({ hour, horizonMs: HORIZON_MS })) });
  const computation = { ...computationBasis(learnFor(f), [{ name: 'learning', role: 'learning', policy: DEFAULT_POLICY }],
    Object.keys(f.holdout), { source: 'hourly-ring', horizonMs: HORIZON_MS, ringCap: 200 }) };
  const grids: DayReport['grids'] = {};
  if (f.items) grids[SLOT] = { learning: { tenant: TENANT, brand: TENANT, slot: SLOT, reward: 'click', objective: 'unit',
    measurementBasis: 'served-v1', publishedAt: Date.parse(f.date + 'T23:00:00Z'), n0: DEFAULT_STATS.n0, nMin: DEFAULT_STATS.nMin,
    items: Object.fromEntries(Array.from({ length: f.items }, (_, i) => [`cnt-w31-piece-${String(i).padStart(4, '0')}`,
      Object.fromEntries(['*', 'channel:direct', 'channel:direct|bucket:1', 'channel:direct|bucket:1|region:US-NY',
        'channel:direct|bucket:1|region:US-NY|affinity:occasion:evening', 'channel:direct|bucket:1|stage:browse']
        .map(level => [level, { n: 40, s: 3, p0: 0.05, p_hat: 0.075, lift: 1.2 }]))])),
    slotRates: { '*': { n: 400, s: 30, rate: 0.075 } } } as unknown as DayReport['grids'][string][string] };
  const holdout: DayReport['holdout'] = Object.fromEntries(Object.entries(f.holdout).map(([slot, rows]) =>
    [slot, rows.map(row => attributionArm(row.arm, row.decisions, row.credited))]));
  return {
    tenant: TENANT, brand: TENANT, date: f.date, builtAt: Date.parse(f.date + 'T23:30:00Z'), counts,
    policies: [{ name: 'learning', policy: DEFAULT_POLICY, role: 'learning', credits: counts.outcomes }],
    grids, exploration: [], measurement: REPORT_MEASUREMENT, holdout,
    holdoutComparison: Object.fromEntries(Object.keys(f.holdout).map(slot => [slot, []])),
    armVisitors: { version: 1, basis: 'distinct_visitors',
      arms: [...new Set(Object.values(f.holdout).flat().map(row => row.arm))].sort()
        .map(arm => ({ arm, visitors: Object.values(f.holdout).flat().filter(row => row.arm === arm).reduce((n, row) => n + row.decisions, 0) })) },
    ...(f.allocation ? { allocation: f.allocation } : {}),
    hours, coverage, computation,
  };
}

/** The bytes production stores for that day: the summary frame and the full report, one object. */
const dayBody = (f: DayFixture): string => canonicalReportJson(dayDocument(f));

/** A reader that answers R2 ranges the way the bucket does, and counts what was asked for. */
class FakeR2 implements SavedReportReader {
  objects = new Map<string, string>();
  reads: Array<{ key: string; range: R2GetOptions['range'] }> = [];
  put(f: DayFixture): void { this.objects.set(reportKey(TENANT, TENANT, f.date), dayBody(f)); }
  async get(key: string, options?: R2GetOptions) {
    this.reads.push({ key, range: options?.range });
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { size: bytes.length, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }) };
  }
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = 86_400_000;
const rangeOf = (from: string, to: string): string[] => {
  const start = Date.parse(from + 'T00:00:00Z'), end = Date.parse(to + 'T00:00:00Z');
  return Array.from({ length: (end - start) / dayMs + 1 }, (_, i) => iso(start + i * dayMs));
};

// ===========================================================================
// The seeded series. One deterministic rule, three nested windows over it:
// a calendar month (31 days), a quarter (92 days) and the biannual maximum
// (184 days = 2026-03-01 … 2026-08-31, the longest six consecutive full
// calendar months, which is exactly `MAX_WINDOW_DAYS`).
// ===========================================================================

const BIANNUAL = { from: '2026-03-01', to: '2026-08-31' };
const QUARTERLY = { from: '2026-06-01', to: '2026-08-31' };
const MONTHLY = { from: '2026-08-01', to: '2026-08-31' };
const SERIES = rangeOf(BIANNUAL.from, BIANNUAL.to);

/** Every seventh day has no report at all; every fifth is truncated; every eleventh folded only 3 hours. */
const state = (date: string): 'absent' | 'truncated' | 'partial-hours' | 'complete' => {
  const index = SERIES.indexOf(date);
  if (index % 7 === 6) return 'absent';
  if (index % 5 === 0) return 'truncated';
  if (index % 11 === 3) return 'partial-hours';
  return 'complete';
};
const SERIES_ROWS: Rows = { [SLOT]: [{ arm: 'default', decisions: 40, credited: 2 }, { arm: 'personalized', decisions: 760, credited: 61 }] };
const seriesFixture = (date: string): DayFixture => ({
  date, holdout: SERIES_ROWS,
  truncated: state(date) === 'truncated',
  ...(state(date) === 'partial-hours' ? { built: [0, 1, 2] } : {}),
  allocation: publishedAllocation(learnDocument(0.05) as unknown as LearnConfig),
});
const expectedDays = (from: string, to: string) => rangeOf(from, to).filter(date => state(date) !== 'absent');
const expectedMissing = (from: string, to: string) => rangeOf(from, to).filter(date => state(date) === 'absent');
const expectedIncomplete = (from: string, to: string) => rangeOf(from, to)
  .filter(date => state(date) === 'truncated' || state(date) === 'partial-hours')
  .map(date => ({ date, truncated: state(date) === 'truncated',
    missingHours: state(date) === 'partial-hours' ? [...Array(24).keys()].slice(3) : [] }));

// ===========================================================================
// The mounted application, in process, the way `src/index.ts` mounts it.
// Harness pattern reused from `src/units/W21/B1.unit.test.ts` and
// `src/units/W21/B2.unit.test.ts`; neither suite is imported or edited.
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
  reads: Array<{ key: string; range: R2GetOptions['range'] }> = [];
  async get(key: string, options?: R2GetOptions) {
    this.reads.push({ key, range: options?.range });
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { key, etag: 'v1', size: bytes.length,
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string) { this.objects.set(key, raw); return { key, etag: 'v1', size: new TextEncoder().encode(raw).length }; }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: (this.objects.get(key) ?? '').length, uploaded: new Date(0) })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

interface Mounted {
  env: Env;
  storage: UnitR2;
  fetch: (input: Request) => Promise<Response>;
  operatorToken: string;
  /** Every request the mounted application answered, in order. */
  requests: string[];
  store: (f: DayFixture) => void;
}

async function mount(share = 0.05): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const storage = new UnitR2();
  const stub = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) };
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: new UnitKV(), SESSIONS: new UnitKV(), CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    REFLEX_HOST: 'session', STORAGE: storage,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: stub, DECISION_RING: stub, LEARN_STATS: stub, SHOPPER_REFLEX: stub,
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => { /* no ledger writes in this batch */ } },
  } as unknown as Env;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/v1', decisionRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w31-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, W31_CATALOGUE),
    baseline(SLOTS_KIND, W31_SLOTS),
    baseline(LEARN_KIND, learnDocument(share)),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const requests: string[] = [];
  const fetchOne = async (request: Request): Promise<Response> => {
    requests.push(new URL(request.url).pathname + new URL(request.url).search);
    return app.fetch(request, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  };
  return { env, storage, fetch: fetchOne, operatorToken, requests,
    store: (f: DayFixture) => { storage.objects.set(reportKey(TENANT, TENANT, f.date), dayBody(f)); } };
}

async function operatorGet(m: Mounted, path: string): Promise<{ status: number; body: Record<string, unknown>; bytes: number }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}` } }));
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text || '{}') as Record<string, unknown>, bytes: new TextEncoder().encode(text).length };
}

/** The ruled shape of the two answers, as this specification rules them (R21). */
interface RuledWindowReport {
  tenant: string; brand: string; from: string; to: string;
  days: string[]; missing: string[];
  incomplete: Array<{ date: string; truncated: boolean; missingHours: number[] }>;
  measurement: { kind: string; inference: string };
  coverage: { status: string };
  armVisitors?: { version: number; basis: string; arms: Array<{ arm: string; visitors: number }> } | null;
  /** RULED, ABSENT TODAY (R21): representation (iii). */
  allocation?: ReportAllocation | null;
  slots: Record<string, {
    arms: Array<{ arm: string; decisions: number; credited: number; creditedPerDecision: number | null }>;
    comparisons: unknown[];
    compatibility: { status: string; reasons: string[]; days: string[] };
    /** RULED, ABSENT TODAY (R21): representation (iii). */
    computation?: { version: number; reward: string; objective: string; tauLearnMs: number; measurementBasis: string;
      profile: { source: string; horizonMs: number | null; ringCap: number | null } } | null;
  }>;
}
interface RuledDayReport {
  tenant: string; brand: string; date: string;
  measurement: { kind: string; inference: string };
  counts: { decisions: number; outcomes: number; visitors: number; truncated: boolean };
  holdout: Record<string, ArmRow[]>;
  grids: Record<string, Record<string, { items: Record<string, Record<string, unknown>>; slotRates: Record<string, unknown> }>>;
  policies: Array<{ name: string }>;
  allocation?: ReportAllocation;
  coverage?: { status: string; missingHours: number[] };
}
const windowOf = (body: Record<string, unknown>) => body.report as unknown as RuledWindowReport;
const dayOf = (body: Record<string, unknown>) => body.report as unknown as RuledDayReport;
/** The same reading, from the exported function, for the logic legs. */
const pooled = (report: WindowReport) => report as unknown as RuledWindowReport;

// ===========================================================================
// The published customer kit and the shipped screens, resolved from this
// file's own location (never `process.cwd()`), so the test measures the tree
// it lives in.
// ===========================================================================

const kitFile = (file: string) => readFileSync(new URL(`../../../docs/kit/${file}`, import.meta.url), 'utf8');
const publicFile = (file: string) => readFileSync(new URL(`../../../public/${file}`, import.meta.url), 'utf8');

/**
 * RULED SENTENCE 1 (R21, F07 §5.2 with tapestry_requirements :365). The kit
 * states the maximum AND how a customer reads the period the requirement asks
 * for, which one reading cannot express.
 */
const KIT_WINDOW_COMPOSITION =
  'A period longer than 184 days is read as consecutive windows — two 92-day readings cover half a year — and pooled on your side; the platform refuses a longer range with its maximum named and never shortens the period you asked for.';
/**
 * RULED SENTENCE 2 (R21, F25 §5.7 with §1.3). The window's own allocation
 * members, published beside the day report's.
 */
const KIT_WINDOW_ALLOCATION =
  'The window report carries `allocation`, the published allocation every pooled day agrees on, `null` when a pooled day carries none or two disagree; two pooled days with different allocations are a mixed basis, reported as the reason `mixed_allocation` with its days and no pooled arms.';
/** RULED LINE 3 (R21, F25 §1.3): what both shipped screens print beside the arms. */
const SCREEN_ALLOCATION = 'Published allocation: 5% to default.';
/** RULED LINE 4 (R21, F07 §5.2): the composition rule where the operator asks for the period. */
const SCREEN_COMPOSITION = 'Read a longer period as consecutive windows and pool them yourself.';

/**
 * A shipped operator screen under jsdom, bound to the mounted application.
 * Pattern reused from `src/units/W21/B2.unit.test.ts:721`.
 */
async function openScreen(m: Mounted, screen: 'console' | 'learning') {
  const page = screen === 'console' ? 'console/index.html' : 'legacy/learning.html';
  const hash = screen === 'console' ? `#/measure?scope=${TENANT}&brand=${TENANT}&slot=${SLOT}` : '';
  const dom = new JSDOM(publicFile(page), { url: `${OPERATOR_ORIGIN}/${screen === 'console' ? 'console/' : 'legacy/learning.html'}${hash}`,
    pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as {
    document: { body: { textContent: string | null }; querySelector(selector: string): { value: string } | null };
    localStorage: { setItem(key: string, value: string): void };
    eval(code: string): unknown; close(): void;
  };
  (w as unknown as { fetch: unknown }).fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const target = new URL(url, `${OPERATOR_ORIGIN}/`);
    return m.fetch(new Request(OPERATOR_ORIGIN + target.pathname + target.search, {
      method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }),
    }));
  };
  (w as unknown as { TextEncoder: unknown }).TextEncoder = TextEncoder;
  (w as unknown as { setInterval: (cb: () => void) => number }).setInterval = () => 0;
  w.localStorage.setItem('operator-session', JSON.stringify({
    accessToken: m.operatorToken, refreshToken: 'w31-b1-refresh', exp: Date.now() + 3_600_000,
    user: { id: 'ops', name: 'Test Operator', email: 'ops@brand.test', roles: ['admin'], tenants: [TENANT] }, mustChangePassword: false,
  }));
  for (const file of screen === 'console'
    ? ['operator-session.js', 'console/shell.js', 'console/views.js', 'console/views-config.js', 'console/views-measure.js', 'console/views-accounts.js', 'console/views-explore.js']
    : ['operator-session.js', 'learning.js']) w.eval(publicFile(file));
  const settle = async () => { for (let n = 0; n < 16; n++) await new Promise(resolve => setTimeout(resolve, 12)); };
  await settle();
  return { w, settle, text: () => (w.document.body.textContent || '').replace(/\s+/g, ' '), close: () => w.close() };
}

/**
 * The days both screens read: the console's default window is the last 28 days
 * and both screens open on today, so the fixture is seeded relative to the run
 * and a run that crosses midnight still reads a seeded day either side.
 */
const SCREEN_DAYS = Array.from({ length: 31 }, (_, i) => iso(Date.now() - (29 - i) * dayMs));
const SCREEN_TODAY = iso(Date.now());
/** The day both screens open on, either side of a midnight the run may cross. */
const SCREEN_OPEN_DAYS = [SCREEN_TODAY, iso(Date.now() + dayMs)];
const SCREEN_INCOMPLETE = iso(Date.now() - 5 * dayMs);
/** 407 control decisions: a figure no other number on either screen can produce. */
const SCREEN_ROWS: Rows = { [SLOT]: [
  { arm: 'default', decisions: 407, credited: 29 },
  { arm: 'personalized', decisions: 612, credited: 55 },
] };
/**
 * Both screens render the slot's arm table only where the day carries a grid
 * for that slot — the legacy screen returns at `public/learning.js:406` ("No
 * decisions for hero on that day.") without one — so the screen fixture carries
 * two pieces, which is what a real day of that slot holds.
 */
const SCREEN_ITEMS = 2;

// ===========================================================================
// unit:W31.C1.01 — full monthly/quarterly/biannual coverage, day by day; a
// longer period refused with its maximum named and its composition published;
// no favorable standing on incomplete evidence, in either body or either screen.
// ===========================================================================

describe('unit:W31.C1.01', () => {
  it('logic: a 31-, 92- and 184-day window each answer every requested day exactly once as read, missing or incomplete, a 185-day period is refused before any storage read, and the kit says how to read a longer period', async () => {
    const r2 = new FakeR2();
    for (const date of SERIES) if (state(date) !== 'absent') r2.put(seriesFixture(date));

    for (const [label, ids, length] of [
      ['monthly', MONTHLY, 31], ['quarterly', QUARTERLY, 92], ['biannual', BIANNUAL, 184],
    ] as const) {
      const report = pooled(await windowReport(r2, { tenant: TENANT, brand: TENANT, ...ids }));
      const requested = rangeOf(ids.from, ids.to);
      expect(requested, `${label}: the fixture's own arithmetic`).toHaveLength(length);

      // (a) Every requested day is answered exactly once, as read or as missing.
      expect([...report.days, ...report.missing].sort(), `document 35 :433 — the ${label} window answers every requested day exactly once`)
        .toEqual([...requested].sort());
      expect(report.days, `F25 §1.1 — the ${label} window names the days it read, in order`).toEqual(expectedDays(ids.from, ids.to));
      expect(report.missing, `F25 §1.1 — and every requested day it found no report for`).toEqual(expectedMissing(ids.from, ids.to));
      expect(report.days.length + report.missing.length, `F25 §7.1 — the requested length is answered in full, never shortened`).toBe(length);
      expect([report.from, report.to], 'F25 §7.1 — the requested period is echoed, never relabelled').toEqual([ids.from, ids.to]);

      // (b) Every read day that is incomplete is named, with what is missing.
      expect(report.incomplete, `F25 §1.2/§7.2 — the ${label} window names each incomplete day it pooled`)
        .toEqual(expectedIncomplete(ids.from, ids.to));
      for (const day of report.incomplete) {
        expect([...day.missingHours].sort((a, b) => a - b), 'R149 — the hour list is ascending and echoed as stored').toEqual(day.missingHours);
      }

      // (c) No favorable standing comes out of it.
      expect(report.coverage.status, 'F25 §7.2 — a window with missing or incomplete days says so').toBe('incomplete');
      expect(report.measurement.inference, 'R108 — and answers no standing, because inference is withheld').toBe('unavailable');
      expect(report.measurement.kind, 'document 35 :433 — the label is an attribution diagnostic').toBe('attribution_diagnostic');
      expect(claimsIn(report), 'document 35 :433 — no incrementality, causal or reached-target claim').toEqual([]);
      expect(INFERENCE_VOCABULARY.test(JSON.stringify(report)), 'R108 — and no target, confidence or interval vocabulary').toBe(false);
    }

    // (d) The biannual window IS the maximum, and a longer period is refused
    // before any storage read, with the maximum named (F25 §5.6, §7.1).
    expect(rangeOf(BIANNUAL.from, BIANNUAL.to), 'F07 §5.2 — the longest six consecutive full calendar months').toHaveLength(MAX_WINDOW_DAYS);
    expect(MAX_WINDOW_DAYS, 'src/measure/window.ts:10 — the published maximum').toBe(184);
    const before = r2.reads.length;
    await expect(windowReport(r2, { tenant: TENANT, brand: TENANT, from: BIANNUAL.from, to: '2026-09-01' }),
      'F25 §7.1 — a 185-day period is refused, never answered short').rejects.toBeInstanceOf(WindowRangeError);
    await expect(windowReport(r2, { tenant: TENANT, brand: TENANT, from: BIANNUAL.from, to: '2026-09-01' }))
      .rejects.toThrow(String(MAX_WINDOW_DAYS));
    expect(r2.reads.length, 'F25 §7.1 — and refused before any storage read').toBe(before);
    expect(() => datesBetween(BIANNUAL.from, '2026-09-01')).toThrow(WindowRangeError);

    // (e) RULED SENTENCE 1 (R21): the customer's own requirement is "6+ months
    // minimum" (tapestry_requirements :365) and F07 §5.2 says one reading cannot
    // express it. The kit that publishes the 184-day maximum must publish how to
    // read a longer period, where the customer reads the route.
    const api = kitFile('02-api-reference.md');
    expect(api.includes('184 inclusive UTC days'), 'the published maximum this sentence belongs beside').toBe(true);
    expect(api.includes(KIT_WINDOW_COMPOSITION),
      `F07 §5.2 — docs/kit/02-api-reference.md must publish, verbatim: "${KIT_WINDOW_COMPOSITION}"`).toBe(true);
  });

  it('host: the mounted window route answers a month, a quarter and the biannual maximum day by day over stored canonical reports, and refuses a longer period with its maximum named', async () => {
    const m = await mount();
    for (const date of SERIES) if (state(date) !== 'absent') m.store(seriesFixture(date));

    for (const [label, ids, length] of [
      ['monthly', MONTHLY, 31], ['quarterly', QUARTERLY, 92], ['biannual', BIANNUAL, 184],
    ] as const) {
      const answer = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${ids.from}&to=${ids.to}`);
      expect(answer.status, `${label}: ${JSON.stringify(answer.body).slice(0, 400)}`).toBe(200);
      const report = windowOf(answer.body);
      expect([...report.days, ...report.missing].sort(), `document 35 :433 — the ${label} window answers every requested day exactly once`)
        .toEqual([...rangeOf(ids.from, ids.to)].sort());
      expect(report.days.length + report.missing.length, 'F25 §7.1 — the requested length, in full').toBe(length);
      expect(report.incomplete.map(day => day.date), `F25 §1.2 — the ${label} window names each incomplete day`)
        .toEqual(expectedIncomplete(ids.from, ids.to).map(day => day.date));
      expect(report.measurement.inference, 'R108 — with no standing on it').toBe('unavailable');
      expect(claimsIn(answer.body), 'document 35 :433 — and no claim in the body').toEqual([]);
      // The pooled counts are the fixture's own sums over the days that were read.
      const read = expectedDays(ids.from, ids.to).length;
      expect(report.slots[SLOT]!.arms.find(arm => arm.arm === 'default'), 'the pooled control counts of the days read')
        .toMatchObject({ decisions: 40 * read, credited: 2 * read });
    }

    const tooLong = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${BIANNUAL.from}&to=2026-09-01`);
    expect(tooLong.status, 'F25 §7.1 — a 185-day period is refused at the route').toBe(400);
    expect(String(tooLong.body.error ?? ''), 'F25 §7.1 — the refusal names the maximum the platform will read').toContain('184');
  });

  it('sdk: the shipped measurement screen names every incomplete day of the window it read, states no standing, and tells the operator how to read a longer period', async () => {
    const m = await mount();
    // The truncated days are one inside the console's 28-day window and the day
    // both screens OPEN on, so the day card is reading incomplete evidence too.
    for (const date of SCREEN_DAYS) m.store({ date, holdout: SCREEN_ROWS, items: SCREEN_ITEMS,
      truncated: date === SCREEN_INCOMPLETE || SCREEN_OPEN_DAYS.includes(date),
      allocation: publishedAllocation(learnDocument(0.05) as unknown as LearnConfig) });

    // Both screens are read BEFORE anything is asserted, so the locks below are
    // measured on both and the ruled line is not hidden behind a first failure.
    const consoleScreen = await openScreen(m, 'console');
    const consoleText = consoleScreen.text(); consoleScreen.close();
    const legacyScreen = await openScreen(m, 'learning');
    const legacyText = legacyScreen.text(); legacyScreen.close();

    // Delivered containment, measured here and kept (F25 §1.2, R108). The
    // legacy screen still served at /legacy/learning.html reads the same day
    // report and may not produce a standing from an incomplete one either.
    expect(consoleText, 'F25 §1.2 — the screen names the incomplete day of the window it read').toContain(`Incomplete coverage for ${SCREEN_INCOMPLETE}`);
    expect(consoleText, 'the screen states the maximum it will read').toContain('184 days inclusive');
    expect(consoleText, 'R108 — the screen states that inference is unavailable').toContain('Experimental inference is unavailable');
    for (const [which, text] of [['console', consoleText], ['legacy', legacyText]] as const) {
      expect(claimsIn(text), `${which}: document 35 :433 — no favorable standing reaches the screen`).toEqual([]);
      expect(FABRICATED.test(text), `${which}: F07 §5.3 — and no fabricated number reaches it`).toBe(false);
    }
    expect(legacyText, 'the legacy screen reads the same incomplete day and says so')
      .toContain('Source or visitor coverage is incomplete.');

    // RULED LINE 4 (R21): the operator who is told the maximum is told what to
    // do about the period the requirement asks for (F07 §5.2).
    expect(consoleText, `F07 §5.2 — the measurement screen must state, verbatim: "${SCREEN_COMPOSITION}"`).toContain(SCREEN_COMPOSITION);
  });
});

// ===========================================================================
// unit:W31.M1.01 — the versions of what was pooled, stated; incompatible
// policies and allocations never pooled silently.
// ===========================================================================

describe('unit:W31.M1.01', () => {
  const EQUAL = publishedAllocation(learnDocument(0.5) as unknown as LearnConfig);
  const UNEQUAL = publishedAllocation(learnDocument(0.05) as unknown as LearnConfig);
  const ROWS: Rows = { [SLOT]: [{ arm: 'default', decisions: 40, credited: 2 }, { arm: 'personalized', decisions: 760, credited: 61 }] };
  const three = ['2026-05-01', '2026-05-02', '2026-05-03'];
  const ids = { tenant: TENANT, brand: TENANT, from: three[0]!, to: three[2]! };

  it('logic: the window states the recorded computation and the published allocation every pooled day agrees on, answers an allocation change mid-window mixed with its days, and never invents one from a day that carries none', async () => {
    // (a) Three days on one published allocation and one recorded computation.
    const agreed = new FakeR2();
    for (const date of three) agreed.put({ date, holdout: ROWS, allocation: UNEQUAL });
    const report = pooled(await windowReport(agreed, ids));
    expect(report.days, 'the three days were read').toEqual(three);
    expect(report.slots[SLOT]!.compatibility, 'W21 — one recorded basis across the three days')
      .toMatchObject({ status: 'compatible', reasons: [], days: three });
    expect(report.slots[SLOT]!.arms.find(arm => arm.arm === 'default'), 'the pooled control counts')
      .toMatchObject({ decisions: 120, credited: 6 });

    // RULED MEMBER 1 (R21): the allocation the window pooled under. F25 §1.3:
    // this is what makes sufficiency computable on the customer's side instead
    // of read from a fixed confidence and an assumption of equal arms.
    expect(report.allocation, 'F25 §1.3/§5.7 — src/measure/window.ts must state the published allocation every pooled day agrees on')
      .toEqual({ version: 1, source: 'published', share: 0.05, arms: ['default'] });
    // RULED MEMBER 3 (R21): the recorded computation the slot pooled under.
    expect(report.slots[SLOT]!.computation, 'document 35 :433 — the window states the metric versions it pooled, per slot')
      .toMatchObject({ version: 4, reward: 'click', objective: 'unit', tauLearnMs: DEFAULT_STATS.tauLearnMs,
        measurementBasis: 'served-v1', profile: { source: 'hourly-ring', horizonMs: HORIZON_MS, ringCap: 200 } });
    // The versions W21 already carries stay on the answer, named the same way.
    expect(report.armVisitors, 'W21 C1.03 — the per-arm denominators, pooled as visitor-days')
      .toEqual({ version: 1, basis: 'visitor_days', arms: [{ arm: 'default', visitors: 120 }, { arm: 'personalized', visitors: 2280 }] });

    // (b) The allocation changes mid-window: a mixed basis, exactly as two
    // computations are (F25 §5.7 names holdout shares in the same sentence as
    // policies, rewards and objectives).
    const changed = new FakeR2();
    changed.put({ date: three[0]!, holdout: ROWS, allocation: UNEQUAL });
    changed.put({ date: three[1]!, holdout: ROWS, allocation: UNEQUAL });
    changed.put({ date: three[2]!, holdout: ROWS, allocation: EQUAL });
    const mixed = pooled(await windowReport(changed, ids));
    expect(mixed.slots[SLOT]!.compatibility.status, 'F25 §5.7 — days served under different allocations are not pooled silently').toBe('mixed');
    expect(mixed.slots[SLOT]!.compatibility.reasons, 'F25 §5.7 — and the reason names the allocation').toContain('mixed_allocation');
    expect(mixed.slots[SLOT]!.compatibility.days, 'W21 — with the days that contributed').toEqual(three);
    expect(mixed.slots[SLOT]!.arms, 'W21 — the pooled arms are withheld, not zero').toEqual([]);
    expect(mixed.allocation, 'F25 §5.7 — and the window states no single allocation, because there was none').toBeNull();
    expect(mixed.slots[SLOT]!.computation, 'and no single computation identity is claimed for an incompatible slot').toBeNull();

    // (c) A day written before the field existed is UNKNOWN, not disagreement
    // (R149): the window states no allocation and adds no reason, and the days
    // still pool, exactly as they do today.
    const legacy = new FakeR2();
    legacy.put({ date: three[0]!, holdout: ROWS, allocation: UNEQUAL });
    legacy.put({ date: three[1]!, holdout: ROWS });
    legacy.put({ date: three[2]!, holdout: ROWS, allocation: UNEQUAL });
    const partial = pooled(await windowReport(legacy, ids));
    expect(partial.allocation, 'R149 — a day written before the field existed leaves the window allocation unknown').toBeNull();
    expect(partial.slots[SLOT]!.compatibility, 'R149 — absence is not disagreement: no reason is added and the days still pool')
      .toMatchObject({ status: 'compatible', reasons: [], days: three });
    expect(partial.slots[SLOT]!.arms.find(arm => arm.arm === 'default'), 'and the counts are the same three days')
      .toMatchObject({ decisions: 120, credited: 6 });

    // (d) W21's representation, reused by name and not re-specified: a slot
    // whose reward changes mid-window is a mixed basis with its days.
    const reward = new FakeR2();
    reward.put({ date: three[0]!, holdout: ROWS, allocation: UNEQUAL });
    reward.put({ date: three[1]!, holdout: ROWS, allocation: UNEQUAL });
    reward.put({ date: three[2]!, holdout: ROWS, allocation: UNEQUAL, reward: 'purchase', objective: 'revenue' });
    const rewardChanged = pooled(await windowReport(reward, ids));
    expect(rewardChanged.slots[SLOT]!.compatibility, 'W21 — a reward or objective change mid-window is a mixed basis')
      .toMatchObject({ status: 'mixed', reasons: ['mixed_basis'], days: three });
    expect(rewardChanged.slots[SLOT]!.arms, 'W21 — with the pooled arms withheld').toEqual([]);
    expect(rewardChanged.allocation, 'and the allocation, which did not change, is still stated')
      .toEqual({ version: 1, source: 'published', share: 0.05, arms: ['default'] });

    // (e) The window still reads ONE bounded summary prefix per day: the
    // allocation rides the summary, it is not bought with a second read or a
    // full parse (representation (v), F34 §4.3). This is the constraint
    // W31.S1.01 locks in general.
    expect(agreed.reads.map(read => read.range),
      'F34 §4.3 — one bounded ranged read per day, before and after the allocation is stated')
      .toEqual(three.map(() => ({ offset: 0, length: REPORT_LIMITS.summaryBytes })));

    // (f) LOCKS, measured here and kept: no compiled customer default survives
    // anywhere in the product (F25 §5.2, R108), and no target vocabulary reaches
    // the answer at all.
    expect(Object.hasOwn(measureHoldout, 'TAPESTRY_TARGETS'),
      'F25 §5.2 — one customer\'s numbers are not the platform\'s compiled default').toBe(false);
    expect(INFERENCE_VOCABULARY.test(JSON.stringify(report)), 'R108 — no target or confidence vocabulary on the window answer').toBe(false);
    expect(claimsIn(report), 'document 35 :433 — and no claim').toEqual([]);
  });

  it('host: the mounted window route states the allocation and the computation it pooled, answers an allocation change mixed, and the kit publishes both', async () => {
    const m = await mount();
    for (const date of three) m.store({ date, holdout: ROWS, allocation: UNEQUAL });
    const agreed = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${ids.from}&to=${ids.to}`);
    expect(agreed.status, JSON.stringify(agreed.body).slice(0, 400)).toBe(200);
    expect(windowOf(agreed.body).allocation, 'F25 §1.3 — the route answers the allocation the window pooled under')
      .toEqual({ version: 1, source: 'published', share: 0.05, arms: ['default'] });
    expect(windowOf(agreed.body).slots[SLOT]!.computation, 'document 35 :433 — and the metric versions it pooled')
      .toMatchObject({ version: 4, reward: 'click', objective: 'unit', measurementBasis: 'served-v1' });
    expect(INFERENCE_VOCABULARY.test(JSON.stringify(agreed.body)), 'R108 — with no target or confidence vocabulary').toBe(false);

    const changed = await mount();
    changed.store({ date: three[0]!, holdout: ROWS, allocation: UNEQUAL });
    changed.store({ date: three[1]!, holdout: ROWS, allocation: EQUAL });
    changed.store({ date: three[2]!, holdout: ROWS, allocation: EQUAL });
    const mixed = await operatorGet(changed, `/v1/${TENANT}/learn/report/window?from=${ids.from}&to=${ids.to}`);
    expect(mixed.status, JSON.stringify(mixed.body).slice(0, 400)).toBe(200);
    expect(windowOf(mixed.body).slots[SLOT]!.compatibility.reasons, 'F25 §5.7 — the route reports the allocation change as a mixed basis')
      .toContain('mixed_allocation');
    expect(windowOf(mixed.body).slots[SLOT]!.arms, 'F25 §5.7 — with the pooled arms withheld').toEqual([]);
    expect(windowOf(mixed.body).allocation, 'F25 §5.7 — and no single allocation claimed').toBeNull();

    // RULED SENTENCE 2 (R21): what the answer carries is what the customer kit
    // says it carries (the day report's `allocation` is already published at
    // docs/kit/03-payload-schemas.md:465).
    const schemas = kitFile('03-payload-schemas.md');
    expect(schemas.includes('`allocation` is'), 'the day report\'s allocation is already published').toBe(true);
    expect(schemas.includes(KIT_WINDOW_ALLOCATION),
      `F25 §5.7 — docs/kit/03-payload-schemas.md must publish, verbatim: "${KIT_WINDOW_ALLOCATION}"`).toBe(true);
  });
});

// ===========================================================================
// unit:W31.Z1.01 — zero, sparse and unequal-arm evidence contained.
// ===========================================================================

describe('unit:W31.Z1.01', () => {
  /**
   * One day, three arms, the three shapes the finding names together (F25 §1.3,
   * §5.4; F07 §5.3): a randomised control with an UNEQUAL 5 % allocation, a
   * treated arm, an `ineligible` arm that was never randomised at all and has
   * no decisions, and a second slot whose only arm is below `nMin` (3
   * decisions against the shipped floor) and whose control produced credits
   * with no decisions at all.
   */
  const DATE = '2026-07-09';
  const ROWS: Rows = {
    [SLOT]: [
      { arm: 'default', decisions: 40, credited: 2 },
      { arm: 'personalized', decisions: 760, credited: 61 },
      { arm: 'ineligible', decisions: 0, credited: 0 },
    ],
    story: [
      { arm: 'default', decisions: 0, credited: 2 },
      { arm: 'personalized', decisions: 3, credited: 1 },
    ],
  };
  const UNEQUAL = publishedAllocation(learnDocument(0.05) as unknown as LearnConfig);

  it('logic: a zero-decision arm, an arm below the observation floor and an unequal allocation are reported as the counts and the allocation they are, with no rate, no interval and no fabricated number', async () => {
    const r2 = new FakeR2();
    r2.put({ date: DATE, holdout: ROWS, allocation: UNEQUAL });
    const report = pooled(await windowReport(r2, { tenant: TENANT, brand: TENANT, from: DATE, to: DATE }));

    // (a) The zero-denominator arm: no rate at all, and never a fabricated one.
    const zero = report.slots.story!.arms.find(arm => arm.arm === 'default')!;
    expect([zero.decisions, zero.credited], 'the credits a control produced with no decisions are still reported').toEqual([0, 2]);
    expect(zero.creditedPerDecision, 'F25 §5.4 — a ratio with no denominator is unreadable, never 0 and never 1').toBeNull();
    const idle = report.slots[SLOT]!.arms.find(arm => arm.arm === 'ineligible')!;
    expect([idle.decisions, idle.credited, idle.creditedPerDecision],
      'W21 E1.02 — an arm that was never randomised stands on its own row and is never pooled into the control').toEqual([0, 0, null]);

    // (b) The sparse arm: the count it is, against the shipped floor, with no
    // sufficiency claim beside it (F25 §1.3 — that number is the customer's).
    const sparse = report.slots.story!.arms.find(arm => arm.arm === 'personalized')!;
    expect(sparse.decisions, 'the sparse arm is reported as the count it is').toBe(3);
    expect(sparse.decisions < DEFAULT_STATS.nMin, 'and it is below the shipped observation floor').toBe(true);
    expect(sparse.creditedPerDecision, 'the intensity is the raw ratio, not an estimate').toBeCloseTo(1 / 3, 12);
    expect(report.measurement.inference, 'R108 — sparsity produces no inference, and neither does anything else here').toBe('unavailable');

    // (c) The unequal allocation is STATED, not assumed equal (F25 §1.3).
    // RULED MEMBER 1 (R21) — the same member W31.M1.01 rules, on the same shape.
    expect(report.allocation, 'F25 §1.3 — the 5 %/95 % allocation the day was served under is stated on the window answer')
      .toEqual({ version: 1, source: 'published', share: 0.05, arms: ['default'] });

    // (d) Nothing fabricated, anywhere in the answer.
    const body = JSON.stringify(report);
    expect(FABRICATED.test(body), 'F07 §5.3 — no NaN or Infinity reaches a reader').toBe(false);
    expect(INFERENCE_VOCABULARY.test(body), 'R108 — no interval, confidence or target member is invented').toBe(false);
    expect(claimsIn(report), 'document 35 :433 — and no causal or reached-target claim').toEqual([]);
    for (const rows of Object.values(report.slots)) for (const arm of rows.arms) {
      expect(Object.hasOwn(arm, 'lift'), 'F07 §5.3 — an arm row carries counts, never a lift').toBe(false);
    }
  });

  it('sdk: both shipped screens print the counts, the em dash where there is no denominator and the published allocation, and never a fabricated number or a standing', async () => {
    const m = await mount();
    for (const date of SCREEN_DAYS) m.store({ date, items: SCREEN_ITEMS, holdout: {
      [SLOT]: [
        { arm: 'default', decisions: 407, credited: 29 },
        { arm: 'personalized', decisions: 612, credited: 55 },
        { arm: 'ineligible', decisions: 0, credited: 0 },
      ],
    }, allocation: UNEQUAL });

    // Both screens are read BEFORE anything is asserted, so every lock is
    // measured on both and the ruled line is not hidden behind a first failure.
    const rendered: Array<readonly [string, string]> = [];
    for (const which of ['console', 'learning'] as const) {
      const screen = await openScreen(m, which);
      rendered.push([which, screen.text()] as const); screen.close();
    }
    for (const [which, text] of rendered) {
      expect(text, `${which}: the arm table the operator reads`).toContain('407');
      expect(text, `${which}: F25 §5.4 — a zero denominator prints the shipped em dash, never a number`).toContain('—');
      expect(FABRICATED.test(text), `${which}: F07 §5.3 — no NaN or Infinity is printed`).toBe(false);
      expect(claimsIn(text), `${which}: document 35 :433 — no standing, no causal claim`).toEqual([]);
    }
    // A day written before the allocation existed prints no allocation line and
    // leaves nothing behind (R149, and the `\b(null|undefined|NaN)\b` guard
    // `src/console/learning.render.test.ts:147` and
    // `src/console/console.render.test.ts:551` already hold both screens to).
    const legacyMount = await mount();
    for (const date of SCREEN_DAYS) legacyMount.store({ date, items: SCREEN_ITEMS, holdout: SCREEN_ROWS });
    for (const which of ['console', 'learning'] as const) {
      const screen = await openScreen(legacyMount, which);
      const text = screen.text(); screen.close();
      expect(text, `${which}: the same arm table is read from a day that predates the field`).toContain('407');
      expect(/\b(null|undefined|NaN)\b/.test(text), `${which}: R149 — and it leaves nothing behind`).toBe(false);
      expect(text.includes('Published allocation'), `${which}: R149 — a day that carries no allocation states none`).toBe(false);
    }

    // RULED LINE 3 (R21): the allocation the day report already carries (W21
    // C1.03) is what makes the counts readable as an experiment on the
    // customer's side (F25 §1.3). Today both screens download it and print
    // nothing. It is a message line beside the arm table, not a row in it:
    // `src/console/learning.render.test.ts:306` fixes that table's rows exactly.
    for (const [which, text] of rendered) {
      expect(text, `${which}: F25 §1.3 — the screen must print, verbatim: "${SCREEN_ALLOCATION}"`).toContain(SCREEN_ALLOCATION);
    }
  });
});

// ===========================================================================
// unit:W31.S1.01 — the lightweight summary, separate from the full payload.
// ===========================================================================

describe('unit:W31.S1.01', () => {
  const START = '2026-04-01';
  const QUARTER = rangeOf(START, iso(Date.parse(START + 'T00:00:00Z') + 91 * dayMs));
  const ROWS: Rows = { [SLOT]: [{ arm: 'default', decisions: 40, credited: 2 }, { arm: 'personalized', decisions: 760, credited: 61 }] };
  /** 400 pieces, six pooling levels each: the payload shape F34 §4.4 measured. */
  const ITEMS = 400;
  const FAT = { holdout: ROWS, items: ITEMS, allocation: publishedAllocation(learnDocument(0.05) as unknown as LearnConfig) };

  it('logic: a quarter is pooled from one bounded summary prefix per day without parsing a single grid, and the day projection narrows the grids to one slot and one pooled level while the full payload stays reachable', async () => {
    const r2 = new FakeR2();
    let fullBytes = 0, chargedBytes = 0;
    for (const date of QUARTER) {
      r2.put({ date, ...FAT });
      const size = new TextEncoder().encode(r2.objects.get(reportKey(TENANT, TENANT, date))!).length;
      fullBytes += size; chargedBytes += Math.min(size, REPORT_LIMITS.summaryBytes);
    }

    const report = pooled(await windowReport(r2, { tenant: TENANT, brand: TENANT, from: QUARTER[0]!, to: QUARTER.at(-1)! }));
    // (a) One bounded ranged read per day — the whole day object is never read
    // (F34 §4.3: "windowReport parses whole day reports … up to 92 of them, on
    // the view's default load"). REVERSING LINE: a reader that drops the range,
    // or that falls back to the full object, fails this assertion.
    expect(r2.reads, 'F34 §4.3 — one read per day, each a bounded summary prefix')
      .toEqual(QUARTER.map(date => ({ key: reportKey(TENANT, TENANT, date), range: { offset: 0, length: REPORT_LIMITS.summaryBytes } })));
    expect(QUARTER, 'the quarter F34 §4.3 measures').toHaveLength(92);
    expect(chargedBytes, 'F34 §4.3 — the window is charged the bounded prefix, never the day')
      .toBe(QUARTER.length * REPORT_LIMITS.summaryBytes);
    expect(fullBytes, 'F34 §4.3 — while the day objects it never parsed are several times that').toBeGreaterThan(chargedBytes * 2);

    // (b) And the pooled counts are exactly the days' own sums.
    expect(report.slots[SLOT]!.arms.find(arm => arm.arm === 'personalized'), 'the pooled treated counts of 92 days')
      .toMatchObject({ decisions: 760 * 92, credited: 61 * 92 });

    // (c) The day projection: grids narrowed to the requested slot, each item to
    // its pooled level, items paged (F34 §6). REVERSING LINE: a projection that
    // returns the other five levels, or every slot, fails here.
    const view = await readReportView(r2, { tenant: TENANT, brand: TENANT, date: QUARTER[0]! }, { slot: SLOT, limit: '50' });
    expect(Object.keys(view!.report.grids), 'F34 §6 — only the requested slot').toEqual([SLOT]);
    const items = view!.report.grids[SLOT]!.learning!.items;
    expect(Object.keys(items), 'F34 §6 — one page of items').toHaveLength(50);
    for (const levels of Object.values(items)) expect(Object.keys(levels), 'F34 §4.4 — one pooled level per item, not six').toEqual(['*']);
    expect(view!.page, 'F34 §6 — with the page the caller pages by').toMatchObject({ slot: SLOT, total: ITEMS, offset: 0, limit: 50 });
    expect(typeof view!.page!.next, 'and a cursor to the next page of items').toBe('string');
    const projectedBytes = new TextEncoder().encode(JSON.stringify(view!.report)).length;
    const dayBytes = new TextEncoder().encode(r2.objects.get(reportKey(TENANT, TENANT, QUARTER[0]!))!).length;
    expect(projectedBytes * 5, 'F34 §4.4 — five sixths of the payload is no longer downloaded to read one level').toBeLessThan(dayBytes);

    // (d) The full payload stays reachable, under the bounds W32 owns and this
    // unit reuses by name, never re-rules.
    const full = await readReportView(r2, { tenant: TENANT, brand: TENANT, date: QUARTER[0]! }, {});
    expect(Object.keys(full!.report.grids[SLOT]!.learning!.items), 'the full payload stays available').toHaveLength(ITEMS);
    expect(Object.keys(Object.values(full!.report.grids[SLOT]!.learning!.items)[0]!),
      'with every pooling level it was built with').toHaveLength(6);
    expect(dayBytes, 'bounded by REPORT_LIMITS.savedBytes, W32\'s bound, reused by name').toBeLessThan(REPORT_LIMITS.savedBytes);
    expect(REPORT_LIMITS.summaryBytes, 'and the summary by REPORT_LIMITS.summaryBytes').toBe(64 * 1024);
  });

  it('host: the shipped measurement screen asks the mounted route for the projection and the window, never for the unprojected day, and the route answers each within its bound', async () => {
    const m = await mount();
    for (const date of SCREEN_DAYS) m.store({ date, ...FAT });

    const projected = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${SCREEN_TODAY}&slot=${SLOT}&limit=50`);
    expect(projected.status, JSON.stringify(projected.body).slice(0, 300)).toBe(200);
    expect(Object.keys(dayOf(projected.body).grids), 'F34 §6 — the route projects to the requested slot').toEqual([SLOT]);
    for (const levels of Object.values(dayOf(projected.body).grids[SLOT]!.learning!.items)) {
      expect(Object.keys(levels), 'F34 §4.4 — and to the one pooled level the screen reads').toEqual(['*']);
    }
    const whole = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${SCREEN_TODAY}`);
    expect(whole.status, JSON.stringify(whole.body).slice(0, 300)).toBe(200);
    expect(whole.bytes, 'F34 §4.4 — the unprojected day is the payload the projection exists to avoid').toBeGreaterThan(projected.bytes * 5);

    // The screen itself: what it asked the mounted application for.
    m.requests.length = 0;
    const screen = await openScreen(m, 'console');
    try {
      const reads = m.requests.filter(path => path.includes('/learn/report'));
      expect(reads.some(path => path.includes('/learn/report/window')), 'F34 §4.3 — the screen reads the pooled window from the server').toBe(true);
      const days = reads.filter(path => !path.includes('/window'));
      expect(days.length, 'the screen reads one day').toBeGreaterThan(0);
      for (const path of days) {
        expect(path, `F34 §4.4 — the screen asks for the projection, not the whole day: ${path}`).toContain(`slot=${SLOT}`);
        expect(path, 'and for one page of it').toContain('limit=50');
      }
    } finally { screen.close(); }
  });
});

