// src/units/P104/LEDGER.unit.test.ts
// P104 under the Closure Ledger: the tests for the LOCAL criteria RF1–RF7 of the work order
// (docs/parity/learning-truth/program.json, programme tapestry-parity-learning-truth, ticket P104 "The learning report's
// fold, with a fixed memory bound per step"). LV1 is a deferred live row and gets no test.
//
// THE AUTHORITY — amendment 13, E29 (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md),
// verbatim:
//   "**Authority:** the same verification (§1 Engine 20, R-P557) and the fold's root-cause design
//   (`S49/analyst-report-fold/DESIGN.md`, R-P561): the hourly fold works in one request holding the hour's raw rows
//   twice, all 64 shards' 48-hour rings and a copy of every new shard body, under 16 MiB limits, so an hour is refused
//   above about 8,900 decisions, the next hour once the rings pass 3.69 MiB (the day then "incomplete"), and an hour at
//   40 visitors with a realistic spread of context (`cells`); lifting every limit would need about 6.9 GB in one
//   request at 10,000 visitors a day against a 128 MB isolate. Fixed at its cause under the owner's direction (R-P545);
//   the W24 rebuild's ring and the day's answer past 8 MiB ruled by the lead (R-P561).
//   **Done when:** the hourly fold and the day report work in fixed-size steps (a plan, partition pages, leaves of
//   visitors that split as they grow, a merge tree, a close), every step holding at most 64 MiB whatever the traffic,
//   measured in the harness at 10,000, 100,000 and 1,000,000 visitors a day; on the same records the result equals
//   today's fold; an hour is committed by two conditional writes, so no hour is lost or counted twice and a failed run
//   resumes; the day report is summed one hour at a time and stored by slot, a day whose grids pass 8 MiB answering 200
//   by slot, never 413; the W24 rebuild folds with the 200-entry ring and the previous day's carry-in, as the hourly
//   fold and live learning do; kit 02 states the envelope."
//
// THE READINGS (where the work order is silent; each one rules a single representation for every criterion):
//   1 The real path. Every leg drives the REAL Worker default export (src/index.ts): its five-minute run (`scheduled`,
//     cron '*/5 * * * *') and its queue consumer (`queue`, batch.queue 'events', the existing events queue the steps are
//     sent on, wrangler.toml [[queues.consumers]]), and the operator's routes, over src/units/_parity.ts's mounted
//     environment on BOTH shopper hosts (session and do), with STORAGE replaced by ./_fold.ts's R2 double (ranged
//     reads, conditional writes, listings with size, etag and upload time) holding the publication set _parity
//     published. The events queue is captured; every message the platform sends is delivered alone in its batch, in
//     order, again when its step neither acknowledges it nor finishes (at most three deliveries, max_retries = 2), and
//     the five-minute run repeats at the frozen time until a run and its queue change no stored object but the
//     warehouse slice's schedule. No internal of the staged fold is read: not its message bodies, its object names, its
//     state head or its packs (P98's pack code is the builder's to build on); only the public stores — the hour
//     aggregate at aggregates/<tenant>/<date>/<hh>.json (src/learn/hourly.ts:114 hourKey, its shape kept, the design
//     §6), the day through GET /v1/:tenant/learn/report — the statistics objects' counters, and what storage was asked.
//   2 A STEP is one invocation — one queue message, one five-minute run with every waitUntil it schedules, one
//     operator request with the Durable Object calls it makes. What a step HOLDS is the process's live heap during it,
//     sampled at every storage call it makes and when it ends, above the heap before it began (collected); a sample above
//     64 MiB is collected and taken again, so garbage never counts. Its FIXED INPUTS as storage shows them: the ledger
//     bytes and objects it reads (keys of the writer's layout, isLearningKey) at most a page, 16 MiB and 200 objects.
//   3 The volumes. A harness holds no 1,000,000-visitor tenant (its state alone is ~38 GB, DESIGN §3), so "at V visitors
//     a day" is what a step meets at V, as the analyst measured it (DESIGN §5, logs/proto.jsonl V1, V2): a leaf holding
//     the 48-hour state one leaf holds at V once leaves split above 8 MiB (64·2^k leaves, k the smallest depth keeping a
//     leaf's state at 879 B a decision and 22 decisions a visitor (DESIGN §2 T1) within 8 MiB: 10,000 → 64 leaves of
//     5.76 MiB, 100,000 → 512 of 7.2 MiB, 1,000,000 → 8,192 of 4.5 MiB), reached over hours 9–12, then its share of the
//     peak hour (V/12 visitors over the leaves) in hour 13, the peak hour of 10,000 visitors a day over every leaf (1/12 of
//     them, ~37 MiB, 600+ objects), the merge of the 64 depth-0 leaves' partials, the close and the day. The three leaves
//     live in one tenant at depth 0, in three residue classes of today's visitor hash (FNV-1a, frozen in _fold.ts).
//     "Leaves that split as they grow": one residue class carried to ~30 MiB of today's state over nine hours.
//   4 Parity is pinned against a COMMITTED reference (fixtures/reference.json): today's fold at d5d8581c — buildHour
//     through the five-minute catch-up — with only its refusal budgets lifted (REPORT_LIMITS, MAX_HOUR_OBJECTS; the
//     analyst's tree-lifted edit), run on the same records at the same times; never computed at test time, so a build
//     that changes buildHour cannot move the reference. Generation and builtAt are left out; an aggregate may carry
//     members today's does not (the design's optional leafDepth); every member today's carries is equal, integers
//     exactly, other numbers to a relative 1e-14 (the work order's "relative 1e-15" is the order of the summation-order
//     difference: the analyst measured 1.1e-15 and called it a match). The leaf states are compared through what they
//     decide — every later hour's aggregate and the day — since their storage is the builder's (ring state v3 is in
//     the work order's own remaining work).
//   5 The commit's crash model: a step whose acknowledgement is lost after it finished (delivered again), a step cut
//     off at a storage call (it never returns, nothing after it runs), and the close cut off right after it wrote the
//     hour aggregate (between the two writes). Two coordinators: every message delivered twice at once and the
//     five-minute run run twice at once. A newer hour waits: its aggregate is first written after the in-flight hour's.
//   6 Resume: no ledger object a finished step read is read again after a later step reading the hour is cut off at its
//     second object; a filed conflict re-runs only its leaf: after the operator files it, the hour's ledger is read only at
//     the two objects holding the conflicting id; abandoned outputs: forty minutes after a run whose first five-minute run
//     of 14:06 was cut off at its second write, nothing a cut-off step wrote is still stored unless a later step wrote it
//     again (adopted).
//   7 A conflict is filed as today: by the operator's custom-policy POST /v1/:tenant/learn/report (src/routes/
//     decisions.ts:2030–2043, the only surface that files one); the fold never files.
//   8 The day by slot: GET without `slot` on a day whose grids pass 8 MiB answers 200, its body within 8 MiB, naming every
//     slot outside `grids` (the slot index; its member name is the builder's); GET ?slot=<slot> answers 200 with that
//     slot's grid under every policy, and reads at most a quarter of the bytes the day's stored objects hold (ten slots).
//     A complete day is coverage with no missing and no truncated hour and status not 'incomplete' (report.ts:1247).
//   9 "A 1,000,000-visitor day from 24 hours": its hours are aggregates at the size content bounds them, not at a size
//     visitors set (DESIGN §9); one real hour of T5's wide context (ten slots of ten pieces, 240 finest cells) folded and
//     copied to the other 23 hours in the shape today stores (a legacy hour: no operator step, the design §6), 24 of them
//     past 32 MiB of aggregate (today refuses 16 MiB, aggregateBytes; T4 at 868 KB an hour, DESIGN §2).
//  10 The open hour on the same steps: an open hour of two pages answers `current` in the day's hours.open; a step past
//     its bound: an open hour holding one visitor with ~30 MB of decisions (a bot; a leaf cannot split one visitor)
//     answers `refused` with refusal.code 'fold_step_bound' and the refusal naming the step 'leaf' as one of its values
//     (its member name is the builder's) — the open hour's refusal is the one surface that names a fold refusal today
//     (src/learn/hourly.ts:3196 refusalOf).
//  11 The rebuild (POST /v1/:tenant/learn/generation { slot, brand, rebuildFrom }) answers 2xx; its counters are read
//     from the statistics objects (_parity's `learned`) once the queue is drained. "As live learning": the shopper's
//     real pages and clicks on both hosts; the carry-in: a click at 00:05 on a decision served at 23:55 the day before;
//     the ring: a click on a piece shown only in a decision 400 decisions old. The money case publishes P103's member
//     `money: { currency: 'EUR', nonpositive: 'refuse' }` (P103 MP1) and fails first with PRECONDITION P103 until it reads
//     back (R-P6); its purchases are sent as the data layer sends them (P103's own fixture: orderId, value, margin, currency,
//     items naming a Coach product a checkout piece features).
//
// ONE REPRESENTATION: the tenant (coach) of _fold.ts — ten slots on six pages, three rewards, ten pieces a slot, the
// checkout pieces each featuring one Coach product — and the frozen producer record; every scenario's traffic, its times and its operator actions
// are in _fold.ts (no expected value there). Fixtures: fixtures/reference.json (C, M, P), fixtures/v2-store.json (M's
// interrupted store), fixtures/old-day.json (a day today's writer stored, and today's two answers for it).
//
// DEFERRED: LV1 (lane L21 on the pair's next release). RESIDUALS (told): the harness's heap is Node's, not workerd's
// (UNVERIFIED, DESIGN §9); the volumes are per-step loads (reading 3), not a tenant at depth 7; a slot past the live
// table's 256 items or 4,096 counters is not exercised (the work order does not say whether it is refused or capped);
// the five-minute run is measured as one step with the monitor and the warehouse slice it shares; a step's figure is
// the heap sampled at its storage calls, collected only above 64 MiB, so a figure under 64 MiB includes garbage (an
// upper figure, as the analyst's); queue batches of more than one message, and several invocations in one isolate, are
// LV1's (each message here is delivered alone).
//
// MEASURED (_evidence/parity-step3/S51/specifier/logs/, serial, --no-cache, one worker, env -C the tree, --root the tree;
// scratch trees built by scratch/bin/mk.sh from d5d8581c; the sketch is scratch/sketch/{stagedFold.ts,apply.py}):
//   TODAY (f-today: the worktree, d5d8581c + this file): 37 of 39 RED for the missing behaviour, the two LOCK legs green.
//   RF1 hour 10 of the volumes refused (the rings past 3.69 MiB), the class refused at hour 8, T5's wide hour refused
//   (cells), the open hour refused rawBytes, the bot named report_budget_exceeded rawBytes not fold_step_bound; RF2 18
//   differences (hour 13 above a page refused); RF3 13 differences (hour 13 refused), hour 13 never written; RF4 38 and 50
//   re-reads, the migration's hour 13 refused; RF5 the head counts 0 of 5,060, hour 0 of T5 refused, C's day built [12];
//   RF6 the custom-policy day credits the 400-decision-old click and not the carried-in one, PRECONDITION P103, the big
//   rebuild 503; RF7 five of seven sentences absent.
//   THE SKETCH (f-sketch1, f-sketch2; earlier versions b3–b6): 37 of 39 green, the two money legs RED on PRECONDITION P103
//   alone; with P103's own sketch beside it (S50/specifier/scratch/sketch/apply.py) the six RF6 legs green (f-money).
//   Steps: 5,196 in one run, 74 cut off by the faults; every step ≤ 64 MiB, a page ≤ 16.0 MiB and 200 objects.
//   THE SKETCH, per leg (never committed; files and the code each leg needs):
//     src/learn/stagedFold.ts (new): RF1–RF4 — the five-minute run plans one hour at a time (a listing cut into pages of
//       ≤ 16 MiB and ≤ 200 objects, written create-only, the state head naming it in flight; quiet hours of a stateless
//       tenant closed in place), partition (one pack and its index per page, sections by leaf, rows checked as
//       ReportRowIdentity checks them and digested), leaf (its sections read by range, de-duplicated by digest in global
//       order, a conflict filed or raised; today's cleanupShard, foldableRows, hourBrands, foldShard and countMembership
//       unchanged; a state past 8 MiB split by visitor hash, rows past 8 MiB refused fold_step_bound), merge (≤ 64
//       partials; within an hour the date's distinct visitors add), close (closeBrands; the aggregate written create-only
//       or on the plan's etag, then the head CAS), resume (one listing finds the missing outputs), each fan-out sent once
//       (a create-only marker), unnamed outputs collected after 15 minutes; the open hour on the same steps never moving the
//       head, its refusal naming its step; RF6 the rebuild of a day past a page planned on the same steps, each leaf folding
//       its visitors with foldRetainedDay and the day before carried in, the counters applied at the statistics object.
//     src/learn/hourly.ts: RF1/RF5 the cells bound per slot and policy (256 items, 4,096 counters) in admitHours; RF5
//       loadHours summing one hour at a time into the running statistics, reportFromHours taking them and refusing no
//       outputBytes; the open refusal admitting `step`; the internals the steps reuse exported (stagedInternals).
//     src/learn/report.ts: RF5 a day past 8 MiB stored as today's summary frame, a part index, the head and one part per
//       slot in one object (a day within 8 MiB byte-for-byte as today), its head and slot parts read by range, the saved
//       grid rows bounded per slot; RF6 the custom-policy day's ring: the day before carried in, 200 kept (ringAtHour).
//     src/learn/fan.ts: RF6 foldRetainedDay with the day before carried in and the ring of the hourly fold at the
//       outcome's hour (the helper ringAtHour, which the sketch placed in policy.ts: the builder keeps it in fan.ts or
//       report.ts, P104's grant). src/durable-objects/LearnStats.ts: RF6 the rebuild reads the day before; past a page it
//       plans the staged rebuild and applies its counters on '/rebuild-apply'. src/routes/decisions.ts: RF5 the POST
//       answering a day past 8 MiB with its head and slot index. src/index.ts: RF1/RF4 the five-minute run calls the
//       staged run (it only enqueues); the queue consumer runs fold messages (ack, or retry on a throw).
//       docs/kit/02-api-reference.md: RF7 one paragraph before the aggregate-to-day budgets, which lose "16MiB combined
//       aggregate JSON". The sketch adds no input cap and no new queue.
//
// Imports from src/units/: ../_parity (through ./_fold), ./_fold, ./fixtures/*.json. NO NEW EXPORT IS IMPORTED.

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { BRAND, HOSTS, learned, PAGE_VIEW, readTree, rounded, shopperOn, TENANT } from '../_parity';
import {
  at, DATE, documents, drainQueue, featuredProduct, fiveMinuteRun, FULL, H, hourPrefixOf, ledgerObjects, MiB, MIN, operator, overBound, overPage, play,
  retentionRegistry, rng, rowsOf, scenarioC, scenarioM, scenarioP, settleAt, SLOTS, stamp, visit, visitorsOf, WIDE, writeLedger,
  type DeliveryPlan, type Fault, type Scenario, type Stamp, type StepRecord,
} from './_fold';

const BOUND = 64 * MiB;
const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;
type Json = Record<string, unknown>;
const REF = fixture<Record<'C' | 'M' | 'P', { aggregates: Record<string, Json | null>; day: Json }>>('reference.json');

const aggregateKey = (date: string, hour: number) => `aggregates/${TENANT}/${date}/${String(hour).padStart(2, '0')}.json`;
const withoutIdentity = (v: Json): Json => { const { generation: _g, builtAt: _b, ...rest } = v; void _g; void _b; return rest; };
function aggregateOf(s: Stamp, hour: number, date = DATE): Json | null {
  const body = s.r2.text(aggregateKey(date, hour));
  return body === null ? null : withoutIdentity(JSON.parse(body) as Json);
}
async function dayOf(s: Stamp, date = DATE, query = ''): Promise<{ status: number; body: Json; record: StepRecord }> {
  return operator(s, 'GET', `/v1/${TENANT}/learn/report?date=${date}${query}`);
}

/** Every difference between what the platform holds and what today's fold held: keys, strings, integers exact; other numbers to a relative 1e-14. */
function differences(actual: unknown, expected: unknown, path = '$', out: string[] = [], extraAllowed = false): string[] {
  if (out.length >= 12) return out;
  if (typeof expected === 'number' && typeof actual === 'number') {
    const exact = Number.isInteger(expected) && Number.isInteger(actual) && Math.abs(expected) < 2 ** 31;
    const rel = Math.abs(actual - expected) / Math.max(1, Math.abs(actual), Math.abs(expected));
    if (exact ? actual !== expected : rel > 1e-14) out.push(`${path}: ${actual} where today's fold has ${expected}`);
    return out;
  }
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    if (actual !== expected) out.push(`${path}: ${JSON.stringify(actual)?.slice(0, 120)} where today's fold has ${JSON.stringify(expected)?.slice(0, 120)}`);
    return out;
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) { out.push(`${path}: an ${Array.isArray(actual) ? 'array' : 'object'} where today's fold has the other`); return out; }
  const a = actual as Json, e = expected as Json;
  const missing = Object.keys(e).filter(k => !Object.hasOwn(a, k)), extra = Object.keys(a).filter(k => !Object.hasOwn(e, k));
  if (missing.length) out.push(`${path}: lacks ${missing.slice(0, 5).join(', ')}`);
  if (extra.length && !extraAllowed) out.push(`${path}: carries ${extra.slice(0, 5).join(', ')} today's fold does not`);
  for (const k of Object.keys(e)) if (Object.hasOwn(a, k)) differences(a[k], e[k], `${path}.${k}`, out);
  return out;
}

/** The scenario's aggregates and its day (built at its last moment) against today's fold (reading 4). */
async function parity(s: Stamp, name: 'C' | 'M' | 'P', sc: Scenario, day = true): Promise<string[]> {
  const found: string[] = [];
  for (const hour of sc.hours) {
    const expected = REF[name].aggregates[String(hour)]!, actual = aggregateOf(s, hour);
    if (actual === null) { found.push(`hour ${hour}: no aggregate (today's fold has one with ${(expected.brands as Json & { coach: Json }).coach.decisions} decisions)`); continue; }
    found.push(...differences(actual, expected, `hour ${hour}`, [], true));
  }
  if (!day) return found;
  // The day built from the hours at the scenario's last moment, as the reference's was: its grids decay to that one time.
  const read = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE }, sc.moments[sc.moments.length - 1]!.at);
  if (read.status !== 200) found.push(`the day: the canonical build answered ${read.status} ${JSON.stringify(read.body).slice(0, 200)}`);
  else found.push(...differences(withoutIdentity(read.body.report as Json), REF[name].day, 'the day', [], true));
  return found;
}

/** The steps of a run that broke the bound or read more than a page. */
const bounds = (s: Stamp) => [...overBound(s.steps.filter(r => r.outcome !== 'cut'), BOUND), ...overPage(s.steps)];

const frozen = { useFake: () => vi.useFakeTimers({ toFake: ['Date'] }) };
beforeEach(() => { frozen.useFake(); vi.setSystemTime(at(11)); });
afterEach(() => { vi.useRealTimers(); });

const T = 900_000;

// ===========================================================================
// unit:P104.RF1 — the bound: every step at most 64 MiB, fixed inputs, nothing refused or truncated by volume
// ===========================================================================

/** The hour's own rows: decisions (distinct ids) and the ledger objects the writer named for it. */
function hourFacts(objects: Map<string, string>, hour: number) {
  const prefix = hourPrefixOf(at(hour)) + '/';
  const keys = [...objects.keys()].filter(k => k.startsWith(prefix));
  const ids = new Set<string>();
  for (const k of keys) if (k.includes('/decision/')) for (const line of objects.get(k)!.split('\n')) if (line) ids.add((JSON.parse(line) as { decision_id: string }).decision_id);
  return { objects: keys.length, decisions: ids.size, bytes: keys.reduce((n, k) => n + Buffer.byteLength(objects.get(k)!), 0) };
}
function expectHourFolded(s: Stamp, hour: number, facts: ReturnType<typeof hourFacts>, label: string) {
  const agg = aggregateOf(s, hour) as (Json & { objects: number; objectsRead: number; truncated: boolean; brands: Record<string, { decisions: number }> }) | null;
  expect(agg === null ? 'no aggregate: refused or never finished' : 'folded', `${label}: hour ${hour} (${(facts.bytes / MiB).toFixed(1)} MiB of ledger in ${facts.objects} objects, ${facts.decisions} decisions) is folded`).toBe('folded');
  expect({ objects: agg!.objects, objectsRead: agg!.objectsRead, truncated: agg!.truncated, decisions: agg!.brands[TENANT]?.decisions },
    `${label}: every object of hour ${hour} is read, in pages, and every decision folded`).toEqual({ objects: facts.objects, objectsRead: facts.objects, truncated: false, decisions: facts.decisions });
}

/**
 * Reading 3: the three volumes' leaves and the peak hour of a 10,000-visitor day, in one tenant: each leaf's 48-hour state
 * reached over hours 9 to 12 (a quarter of its visitors an hour), then the peak hour 13 over every leaf.
 */
function volumeScenario(registry: ReturnType<typeof retentionRegistry>) {
  const r = rng(104_101);
  const decisionBytes = 879, perVisitor = 22, leafCap = 8 * MiB;
  const volumes = [10_000, 100_000, 1_000_000].map((visitorsPerDay, i) => {
    let depth = 0; while ((2 * visitorsPerDay * perVisitor * decisionBytes) / (64 * 2 ** depth) > leafCap) depth++;
    const leaves = 64 * 2 ** depth, state = (2 * visitorsPerDay * perVisitor * decisionBytes) / leaves;
    const ids = visitorsOf(`vol${i}`, Math.round(state / (perVisitor * decisionBytes)), 11 + 20 * i);
    return { visitorsPerDay, depth, leaves, state, ids, peak: Math.max(1, Math.round(visitorsPerDay / 12 / leaves)) };
  });
  const steady = volumes.flatMap(v => v.ids.map((id, n) => visit(registry, id, at(9 + (n % 4)) + Math.floor(r() * 35 * MIN), perVisitor, r, FULL)));
  const peakVisitors = [...visitorsOf('peak10k', Math.round(10_000 / 12)), ...volumes.flatMap(v => v.ids.slice(0, v.peak))];
  const peak = peakVisitors.map(id => visit(registry, id, at(13) + Math.floor(r() * 35 * MIN), perVisitor, r, FULL, 'peak-'));
  const objects = ledgerObjects(rowsOf(steady), 500, 'b');
  for (const [k, v] of ledgerObjects(rowsOf(peak), 30, 'p')) objects.set(k, v);
  return { volumes, objects };
}

describe('unit:P104.RF1 (E29: every step at most 64 MiB at 10,000, 100,000 and 1,000,000 visitors a day)', () => {
  for (const host of HOSTS) {
    it(`RF1 ${host}: the leaves of 10,000, 100,000 and 1,000,000 visitors a day and the peak hour of 10,000 fold in steps of at most 64 MiB, a page at most 16 MiB and 200 objects, every object read`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 volumes');
      const { volumes, objects } = volumeScenario(registry);
      const facts = new Map([9, 10, 11, 12, 13].map(h => [h, hourFacts(objects, h)]));
      expect(facts.get(13)!.objects, 'the fixture: the peak hour is written in more than 600 objects (today\'s MAX_HOUR_OBJECTS, hourly.ts:78)').toBeGreaterThan(600);
      expect(facts.get(13)!.bytes, 'the fixture: the peak hour holds more than two pages of ledger').toBeGreaterThan(32 * MiB);
      expect(volumes.map(v => [v.visitorsPerDay, v.leaves]), 'the fixture: the geometry of reading 3').toEqual([[10_000, 64], [100_000, 512], [1_000_000, 8192]]);
      const byHour = new Map([9, 10, 11, 12, 13].map(h => [h, new Map([...objects].filter(([k]) => k.startsWith(hourPrefixOf(at(h)))))]));
      objects.clear();
      for (const hour of [9, 10, 11, 12, 13]) { writeLedger(s, byHour.get(hour)!); byHour.get(hour)!.clear(); await settleAt(s, at(hour + 1, 6)); }
      for (const hour of [9, 10, 11, 12, 13]) expectHourFolded(s, hour, facts.get(hour)!, `RF1 ${host}`);
      expect(bounds(s), `RF1 ${host}: every step holds at most 64 MiB and reads at most a page (16 MiB, 200 objects) of ledger`).toEqual([]);
    }, T);

    it(`RF1 ${host}: a leaf that would pass 8 MiB splits by visitor hash — one residue class growing to ~30 MiB of state over nine hours folds in steps of at most 64 MiB`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 split');
      const r = rng(104_102);
      const ids = visitorsOf('grow', 9 * 182, 37);
      for (const [n, hour] of [6, 7, 8, 9, 10, 11, 12, 13, 14].entries()) {
        const objects = ledgerObjects(rowsOf(ids.slice(n * 182, (n + 1) * 182).map(id => visit(registry, id, at(hour) + Math.floor(r() * 35 * MIN), 22, r, FULL))), 500, 'b');
        const facts = hourFacts(objects, hour);
        writeLedger(s, objects);
        objects.clear();
        await settleAt(s, at(hour + 1, 6));
        expectHourFolded(s, hour, facts, `RF1 ${host} (the class at ~${((n + 1) * 4004 * 879 / MiB).toFixed(1)} MiB of today's state)`);
      }
      expect(bounds(s), `RF1 ${host}: no leaf holds more than 8 MiB of state: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF1 ${host}: T5's wide context (4 channels x 3 visit buckets x 10 regions, ten slots of ten pieces) folds, the cells bound kept per slot at the live table's capacity`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 wide');
      const r = rng(104_103);
      const objects = ledgerObjects(rowsOf(visitorsOf('wide', 80).map(id => visit(registry, id, at(12) + Math.floor(r() * 35 * MIN), 22, r, { ...FULL, context: WIDE }))), 500, 'b');
      writeLedger(s, objects);
      await settleAt(s, at(13, 6));
      expectHourFolded(s, 12, hourFacts(objects, 12), `RF1 ${host} (T5: today refused on cells 16,385 > 16,384)`);
      const day = await dayOf(s);
      expect(day.status, `RF1 ${host}: the wide day answers: ${JSON.stringify(day.body).slice(0, 200)}`).toBe(200);
      const grids = (day.body.report as { grids: Record<string, Record<string, { items: Record<string, Record<string, unknown>> }>> }).grids;
      const perSlot = Object.fromEntries(Object.entries(grids).map(([slot, policies]) => [slot, Math.max(...Object.values(policies).map(p =>
        Object.values(p.items).reduce((n, levels) => n + Object.keys(levels).length, 0)))]));
      expect(Object.keys(perSlot).sort(), `RF1 ${host}: every slot's grid is reported`).toEqual([...SLOTS].sort());
      expect(Object.entries(perSlot).filter(([, n]) => n > 4096), `RF1 ${host}: no slot past the live table's 4,096 counters a policy (LearnStats.ts:38–39)`).toEqual([]);
      expect(bounds(s), `RF1 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF1 ${host}: the open hour takes the same steps — an open hour of two pages answers current in the day, every step at most 64 MiB`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 open hour');
      const r = rng(104_104);
      await settleAt(s, at(12, 6));
      const objects = ledgerObjects(rowsOf(visitorsOf('open', 440).map(id => visit(registry, id, at(13) + Math.floor(r() * 25 * MIN), 22, r, FULL))), 500, 'b');
      const facts = hourFacts(objects, 13);
      expect(facts.bytes, 'the fixture: the open hour holds more than a page').toBeGreaterThan(16 * MiB);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 50));
      const day = await dayOf(s);
      expect(day.status, `RF1 ${host}: the day answers with its open hour: ${JSON.stringify(day.body).slice(0, 200)}`).toBe(200);
      const report = day.body.report as { hours?: { open?: Array<{ hour: number; status: string; refusal?: Json }> }; counts: { decisions: number } };
      const open = (report.hours?.open ?? []).find(h => h.hour === 13);
      expect(open ? { status: open.status, refusal: open.refusal ?? null } : 'not named',
        `RF1 ${host}: the open hour 13 (${(facts.bytes / MiB).toFixed(1)} MiB) is folded into its working aggregate on the same steps, not refused by a budget`).toEqual({ status: 'current', refusal: null });
      expect(report.counts.decisions, `RF1 ${host}: the day counts the open hour's decisions`).toBe(facts.decisions);
      expect(bounds(s), `RF1 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF1 ${host}: a step past its bound is refused naming its step (fold_step_bound) — one visitor's ~30 MB of decisions in an open hour`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 fold_step_bound');
      const r = rng(104_105);
      await settleAt(s, at(12, 6));
      const objects = ledgerObjects(rowsOf([visit(registry, visitorsOf('bot', 1)[0]!, at(13, 1), 16_000, r, FULL)]), 400, 'b');
      expect(hourFacts(objects, 13).bytes, 'the fixture: one visitor\'s rows past a leaf\'s 8 MiB').toBeGreaterThan(24 * MiB);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 50));
      const day = await dayOf(s);
      expect(day.status, `RF1 ${host}: the day answers: ${JSON.stringify(day.body).slice(0, 200)}`).toBe(200);
      const open = ((day.body.report as { hours?: { open?: Array<{ hour: number; status: string; refusal?: Json }> } }).hours?.open ?? []).find(h => h.hour === 13);
      const refusal = open?.refusal ?? {};
      expect({ status: open?.status ?? 'not named', code: refusal.code ?? null, namesLeaf: Object.values(refusal).includes('leaf') },
        `RF1 ${host}: the leaf holding one visitor's rows past 8 MiB cannot split; the open hour names the refusal fold_step_bound and its step (${JSON.stringify(refusal)})`)
        .toEqual({ status: 'refused', code: 'fold_step_bound', namesLeaf: true });
      expect(bounds(s), `RF1 ${host}: the refusing step holds at most 64 MiB too`).toEqual([]);
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF2 — parity with today's fold, value for value
// ===========================================================================

describe('unit:P104.RF2 (E29: on the same records the result equals today\'s fold)', () => {
  for (const host of HOSTS) {
    it(`RF2 ${host}: scenario P (crossing visitors, duplicates across pages, a filed conflict, erasures, an expired stamp, a re-fold of a grown hour, an earlier hour folded after a later one) equals today's fold hour for hour and for the day`, async () => {
      const registry = retentionRegistry(3 * H);
      const s = await stamp(host, documents(), registry, 'P104.RF2 parity');
      const sc = scenarioP(registry);
      await play(s, sc);
      expect(s.answers.filter(a => a.method === 'POST').map(a => a.status), 'PRECONDITION: the conflict is filed (409) and both erasures recorded, as today').toEqual([409, 200, 200]);
      expect(await parity(s, 'P', sc), `RF2 ${host}: the aggregates of hours 10–14 and the day equal today's fold (fixtures/reference.json P)`).toEqual([]);
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF3 — the commit: two conditional writes; no hour lost or counted twice
// ===========================================================================

const HOUR_AGGREGATE = /^aggregates\/[^/]+\/\d{4}-\d{2}-\d{2}\/\d{2}\.json$/;
/**
 * The commit's two crash points, once per hour: (i) the first queue message to reach an hour's aggregate write is cut
 * off there on every delivery it gets (whatever it wrote before it stays written; the platform gives the message up
 * and the five-minute run must find the hour again), and (ii) the first step whose aggregate write lands is cut off
 * right after it (between the two writes).
 */
function commitCrashes(): Fault {
  const armed = new Set<number>(), landed = new Set<string>(), held = new Map<string, string>();
  return ({ op, key, step }) => {
    if (armed.has(step.index)) { armed.delete(step.index); return 'cut'; }
    if (op !== 'put' || !HOUR_AGGREGATE.test(key)) return undefined;
    const message = /^message (m\d+) /.exec(step.label)?.[1];
    if (message && (!held.has(key) || held.get(key) === message)) { held.set(key, message); return 'cut'; }
    if (!landed.has(key)) { landed.add(key); armed.add(step.index); }
    return undefined;
  };
}

describe('unit:P104.RF3 (E29: an hour committed by two conditional writes; no hour lost or counted twice)', () => {
  for (const host of HOSTS) {
    it(`RF3 ${host}: a crash after every step, before the commit's first write and between its two writes leaves no hour lost and none counted twice (scenario C: hour 13's rings past today's 3.69 MiB)`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF3 crash');
      const sc = scenarioC(registry);
      const cut = commitCrashes();
      const plan: DeliveryPlan = { before: message => (message.attempts === 1 ? { dropAck: true, fault: cut } : { fault: cut }) };
      s.r2.fault = cut;
      await play(s, sc, plan);
      s.r2.fault = null;
      expect(await parity(s, 'C', sc), `RF3 ${host}: every step run twice, each hour's first commit given up at its aggregate write and the next cut right after it, the aggregates and the day equal today's fold (fixtures/reference.json C)`).toEqual([]);
      expect(bounds(s), `RF3 ${host}: the commit stages no copy of the state: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF3 ${host}: of two coordinators one wins and the other adopts or stops — every message delivered twice at once and the five-minute run run twice at once`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF3 coordinators');
      const sc = scenarioC(registry);
      const plan: DeliveryPlan = { before: () => ({ twice: true }) };
      for (const moment of sc.moments) {
        vi.setSystemTime(moment.at);
        if (moment.ledger) writeLedger(s, moment.ledger);
        for (const action of moment.actions ?? []) { await action(s); await drainQueue(s, moment.at, plan); }
        for (let i = 0; i < 30; i++) {
          const before = s.r2.journal.filter(j => !j.key.startsWith('warehouse/')).length;
          await Promise.all([fiveMinuteRun(s, moment.at), fiveMinuteRun(s, moment.at)]);
          await drainQueue(s, moment.at, plan);
          if (s.r2.journal.filter(j => !j.key.startsWith('warehouse/')).length === before) break;
        }
      }
      expect(await parity(s, 'C', sc), `RF3 ${host}: two coordinators at every step, the aggregates and the day equal today's fold`).toEqual([]);
    }, T);

    it(`RF3 ${host}: a newer hour waits while a plan is in flight — hour 12 held by its conflict until the operator files it at 14:20, hour 13 is folded after it`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF3 order');
      const sc = scenarioC(registry);
      const held: Scenario = { ...sc, moments: sc.moments.map(m => (m.at === at(13, 20) ? { at: at(14, 20), ...(m.actions ? { actions: m.actions } : {}) } : m))
        .sort((a, b) => a.at - b.at) };
      await play(s, held);
      await settleAt(s, at(14, 26));
      const firstWrite = (hour: number) => s.r2.journal.findIndex(j => j.op === 'put' && j.key === aggregateKey(DATE, hour));
      expect({ twelve: firstWrite(12) >= 0, thirteenAfterTwelve: firstWrite(13) > firstWrite(12) },
        `RF3 ${host}: hour 13's aggregate is first written after hour 12's commit (journal positions ${firstWrite(12)}, ${firstWrite(13)})`).toEqual({ twelve: true, thirteenAfterTwelve: true });
      expect(await parity(s, 'C', sc, false), `RF3 ${host}: and both hours equal today's fold of them in order (the day, built an hour later, decays to its own build time)`).toEqual([]);
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF4 — resume
// ===========================================================================

describe('unit:P104.RF4 (E29: a failed run resumes)', () => {
  for (const host of HOSTS) {
    it(`RF4 ${host}: a step cut off resumes from the outputs present — no ledger object a finished step read is read again; what cut-off steps left is collected after the 15-minute grace`, async () => {
      const registry = retentionRegistry();
      const sc = scenarioC(registry);
      const s = await stamp(host, documents(), registry, 'P104.RF4 resume');
      const h13 = hourPrefixOf(at(13)) + '/';
      let cutRead = -1, cutRun = -1, given: string | null = null;
      const fault: Fault = ({ op, key, step }) => {
        // The first five-minute run of 14:06 is cut off at its second write (whatever it was writing: a plan, a head).
        if (cutRun < 0 && step.kind === 'scheduled' && op === 'put' && Date.now() === at(14, 6) && step.writes.length === 1) { cutRun = step.index; return 'cut'; }
        if (op !== 'get' || !key.startsWith(h13)) return undefined;
        // A queue message reading hour 13's ledger after another step finished reading it is cut off at its second object on
        // every delivery it gets: the platform gives it up, and the five-minute run must find what is missing.
        const message = /^message (m\d+) /.exec(step.label)?.[1] ?? null;
        if (given !== null) return message === given && step.ledgerObjects >= 1 ? 'cut' : undefined;
        if (step.ledgerObjects >= 1 && s.steps.some(r => r.index < step.index && r.outcome === 'done' && r.ledgerKeys.some(k => k.startsWith(h13)))) {
          cutRead = step.index; given = message ?? `run ${step.index}`; return 'cut';
        }
        return undefined;
      };
      s.r2.fault = fault;
      await play(s, sc);
      s.r2.fault = null;
      const resumed = await parity(s, 'C', sc);
      await settleAt(s, at(14, 50)); await settleAt(s, at(14, 55));
      expect(cutRead >= 0 ? 'cut' : 'never cut', 'PRECONDITION: a step reading hour 13\'s ledger after another one finished was cut off mid-page, on every delivery').toBe('cut');
      const before = new Set(s.steps.filter(r => r.index < cutRead && r.outcome === 'done').flatMap(r => r.ledgerKeys.filter(k => k.startsWith(h13))));
      const again = s.steps.filter(r => r.index > cutRead && r.outcome === 'done').flatMap(r => r.ledgerKeys.filter(k => before.has(k)));
      expect(again.length, `RF4 ${host}: only the missing steps re-run: ${again.length} reads of hour 13's ledger objects a finished step had already read`).toBe(0);
      expect(resumed, `RF4 ${host}: the resumed hours and their day equal today's fold`).toEqual([]);
      const cut = new Set(s.steps.filter(r => r.outcome === 'cut').map(r => r.index));
      const left = [...new Set(s.r2.journal.filter(j => j.op === 'put' && cut.has(j.step)).map(j => j.key))]
        .filter(key => s.r2.objects.has(key) && !s.r2.journal.some(j => j.key === key && !cut.has(j.step) && j.step > Math.min(...cut) && j.op === 'put'));
      expect(left, `RF4 ${host}: forty minutes on, nothing a cut-off step wrote is left unless a later step wrote it again (adopted)`).toEqual([]);
      expect(bounds(s), `RF4 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF4 ${host}: a filed conflict re-runs only its own leaf — after the operator files it, hour 12's ledger is read only where the conflicting id is`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF4 conflict');
      const sc = scenarioC(registry);
      await play(s, sc, {}, at(13, 6));
      expect(aggregateOf(s, 12) === null ? 'waits' : 'folded', 'PRECONDITION: hour 12 waits on its conflict while it is not filed, as today (the fold files none)').toBe('waits');
      const filed = s.steps.length;
      await play(s, { ...sc, moments: sc.moments.filter(m => m.at > at(13, 6)) });
      expect(s.answers.find(a => a.method === 'POST')?.status, 'PRECONDITION: the operator\'s custom-policy POST files the conflict (409), as today').toBe(409);
      const h12 = hourPrefixOf(at(12)) + '/';
      const reread = [...new Set(s.steps.slice(filed).filter(r => r.kind !== 'request').flatMap(r => r.ledgerKeys.filter(k => k.startsWith(h12))))];
      const allowed = new Set(sc.conflictKeys);
      expect(reread.filter(k => !allowed.has(k)).length, `RF4 ${host}: after the filing the fold reads hour 12's ledger only at the two objects holding the conflicting id; it read ${reread.length} of its objects`).toBe(0);
      expect(await parity(s, 'C', sc), `RF4 ${host}: and hour 12 counts the filed conflict as today's fold does`).toEqual([]);
    }, T);

    it(`RF4 ${host}: a store today's code wrote (64 shards, hour 12's v2 plan interrupted) is finished by today's finishHour and continued by the staged fold with identical next-hour results`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF4 migration');
      const store = fixture<{ objects: Record<string, string> }>('v2-store.json').objects;
      for (const [key, body] of Object.entries(store)) s.r2.seed(key, body);
      const sc = scenarioM(registry);
      await play(s, sc);
      expect(await parity(s, 'M', sc), `RF4 ${host}: hour 12 finished from today's plan and hour 13 (two pages) folded on, both equal today's uninterrupted fold`).toEqual([]);
      expect(bounds(s), `RF4 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF5 — the day: summed one hour at a time, stored by slot, 200 past 8 MiB
// ===========================================================================

describe('unit:P104.RF5 (E29: the day summed one hour at a time and stored by slot, 200 past 8 MiB, never 413)', () => {
  for (const host of HOSTS) {
    it(`RF5 ${host}: a day whose grids pass 8 MiB answers 200 with the head and a slot index; GET ?slot= answers that slot's grid and reads only its part`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF5 by slot');
      const r = rng(104_201);
      const objects = ledgerObjects(rowsOf(visitorsOf('grid', 230).map(id => visit(registry, id, at(12) + Math.floor(r() * 35 * MIN), 22, r, { ...FULL, context: WIDE }))), 500, 'b');
      const facts = hourFacts(objects, 12);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 6));
      const built = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE });
      expect(built.status, `RF5 ${host}: the day is built, never 413: ${JSON.stringify(built.body).slice(0, 240)}`).toBe(200);
      await settleAt(s, at(13, 12));
      const whole = await dayOf(s);
      expect(whole.status, `RF5 ${host}: GET of the day answers 200: ${JSON.stringify(whole.body).slice(0, 240)}`).toBe(200);
      expect((whole.body.report as { counts: { decisions: number } }).counts.decisions, `RF5 ${host}: the head counts the day's ${facts.decisions} decisions (today: hour 12 refused on cells)`).toBe(facts.decisions);
      const text = JSON.stringify(whole.body), head = JSON.stringify({ ...whole.body, report: { ...(whole.body.report as Json), grids: undefined } });
      expect(Buffer.byteLength(text), `RF5 ${host}: the answer without a slot is within 8 MiB (outputBytes)`).toBeLessThanOrEqual(8 * MiB);
      expect(SLOTS.filter(slot => !head.includes(`"${slot}"`)), `RF5 ${host}: the answer names every slot outside the grids (its slot index)`).toEqual([]);
      const stored = [...s.r2.objects.entries()].filter(([k]) => k.startsWith(`reports/${TENANT}/${BRAND}/${DATE}`)).reduce((n, [, v]) => n + v.bytes.length, 0);
      for (const slot of SLOTS) {
        const part = await dayOf(s, DATE, `&slot=${slot}`);
        expect(part.status, `RF5 ${host}: GET ?slot=${slot} answers: ${JSON.stringify(part.body).slice(0, 200)}`).toBe(200);
        const grid = ((part.body.report as { grids: Record<string, Record<string, unknown>> }).grids ?? {})[slot] ?? {};
        expect(Object.keys(grid).length, `RF5 ${host}: ?slot=${slot} carries the slot's grid under all five policies`).toBe(5);
        expect(part.record.otherBytes, `RF5 ${host}: ?slot=${slot} reads its slot's part (at most a quarter of the ${(stored / MiB).toFixed(1)} MiB the day's objects hold), not the whole day`).toBeLessThanOrEqual(stored / 4);
      }
    }, T);

    it(`RF5 ${host}: a 1,000,000-visitor day is built complete from 24 hours, summed one hour at a time — hours at the size content bounds them (T5's wide hour), 24 of them past today's 16 MiB`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF5 24 hours');
      const r = rng(104_202);
      const objects = ledgerObjects(rowsOf(visitorsOf('hour0', 80).map(id => visit(registry, id, at(0) + Math.floor(r() * 35 * MIN), 22, r, { ...FULL, context: WIDE }))), 500, 'b');
      const facts = hourFacts(objects, 0);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(1, 6));
      const body = s.r2.text(aggregateKey(DATE, 0));
      expect(body === null ? 'not folded' : 'folded', 'PRECONDITION: hour 0 (T5\'s wide hour: 80 visitors, ten slots of ten pieces) is folded').toBe('folded');
      expect(Buffer.byteLength(body!) * 24, 'the fixture: 24 such hours hold more than 32 MiB of aggregate (today refuses 16 MiB: aggregateBytes)').toBeGreaterThan(32 * MiB);
      const hour0 = JSON.parse(body!) as Json & { from: number; to: number };
      const { leafDepth: _depth, ...legacy } = hour0; void _depth;
      for (let h = 1; h < 24; h++) s.r2.seed(aggregateKey(DATE, h), JSON.stringify({ ...legacy, hour: h, from: hour0.from + h * H, to: hour0.to + h * H }));
      s.steps.length = 0;
      const built = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE }, at(24, 10));
      expect(built.status, `RF5 ${host}: the day of 24 hours is built: ${JSON.stringify(built.body).slice(0, 240)}`).toBe(200);
      await settleAt(s, at(24, 12));
      const day = await dayOf(s);
      const report = day.body.report as { counts: { decisions: number }; hours: { built: number[] }; coverage: { missingHours: number[]; truncatedHours: number[] } };
      expect({ status: day.status, built: report?.hours?.built?.length, missing: report?.coverage?.missingHours, truncated: report?.coverage?.truncatedHours, decisions: report?.counts?.decisions },
        `RF5 ${host}: the day is complete: 24 hours built, none missing or truncated, every hour's decisions counted`)
        .toEqual({ status: 200, built: 24, missing: [], truncated: [], decisions: 24 * facts.decisions });
      expect(bounds(s), `RF5 ${host}: the day step holds one aggregate and the running total: at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF5 ${host}: no hour refused by volume leaves the day incomplete — scenario C's day (today: hour 13 missing) is complete and equals today's fold`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF5 complete');
      const sc = scenarioC(registry);
      await play(s, sc);
      const day = await dayOf(s);
      const report = day.body.report as { coverage?: { status: string; missingHours: number[]; truncatedHours: number[] }; hours?: { built: number[] } } | undefined;
      const coverage = report?.coverage;
      expect({ status: day.status, built: [12, 13].filter(h => report?.hours?.built.includes(h)), missing: coverage?.missingHours, truncated: coverage?.truncatedHours, incomplete: coverage?.status === 'incomplete' },
        `RF5 ${host}: the day of hours 12 and 13 is complete: both built, none missing or truncated`).toEqual({ status: 200, built: [12, 13], missing: [], truncated: [], incomplete: false });
      expect(await parity(s, 'C', sc), `RF5 ${host}: and equals today's fold`).toEqual([]);
    }, T);

    it(`RF5 ${host}: LOCK — an old single-JSON day still reads (report.ts:388–398), whole and by slot, as today`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF5 old day');
      const old = fixture<{ key: string; body: string; whole: Json; slot: Json }>('old-day.json');
      s.r2.seed(old.key, old.body);
      vi.setSystemTime(at(10, 6));
      const whole = await dayOf(s), slot = await dayOf(s, DATE, '&slot=home-hero&limit=5');
      expect({ whole: whole.status, slot: slot.status }, `RF5 ${host}: both reads answer`).toEqual({ whole: 200, slot: 200 });
      expect(whole.body, `RF5 ${host}: the old day reads as today's reader read it`).toEqual(old.whole);
      expect(slot.body, `RF5 ${host}: its slot page as today's`).toEqual(old.slot);
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF6 — the W24 rebuild: the 200-entry ring, the previous day's carry-in, the one credit rule
// ===========================================================================

const RAW = { name: 'p104-day', scope: 'session', match: 'direct', credit: 'last' };
/** A slot's credited outcomes (s) at the root level of a day report's grid under one policy, rounded; zeros left out. */
function gridCredits(report: Json | undefined, slot: string, policy: string): Record<string, number> {
  const items = ((report?.grids as Record<string, Record<string, { items: Record<string, Record<string, { s: number }>> }>> | undefined)?.[slot]?.[policy]?.items) ?? {};
  return Object.fromEntries(Object.entries(items).map(([item, levels]) => [item, Math.round(levels['*']?.s ?? 0)] as const).filter(([, v]) => v !== 0));
}

describe('unit:P104.RF6 (E29: the W24 rebuild with the 200-entry ring and the previous day\'s carry-in, as the hourly fold and live learning)', () => {
  for (const host of HOSTS) {
    it(`RF6 ${host}: the rebuild credits what live learning, the hourly fold and the custom-policy day credit — a click carried in from the day before, none on a decision 400 decisions old`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(-1, 50));
      const s = await stamp(host, documents(), registry, 'P104.RF6 ring and carry-in');
      vi.setSystemTime(at(-1, 55));
      const a = await shopperOn(s.m);
      const aPage = await a.snapshot('home');
      const aHero = aPage.decisions.find(d => d.slot === 'home-hero')!;
      await drainQueue(s, at(-1, 55));
      vi.setSystemTime(at(0, 5));
      expect((await a.click(aPage, aHero)).status, 'PRECONDITION: the carried-in click is accepted').toBe(200);
      await drainQueue(s, at(0, 5));
      vi.setSystemTime(at(1, 0));
      const b = await shopperOn(s.m);
      const bPage = await b.snapshot('home');
      const bHero = bPage.decisions.find(d => d.slot === 'home-hero' && d.contentId !== aHero.contentId)!;
      for (let i = 0; i < 50; i++) { vi.setSystemTime(at(1, 1, i)); await b.snapshot('pdp'); }
      await drainQueue(s, at(1, 2));
      vi.setSystemTime(at(1, 30));
      expect((await b.click(bPage, bHero)).status, 'PRECONDITION: the click on the piece of the old decision is accepted').toBe(200);
      await drainQueue(s, at(1, 30));
      expect(bHero, 'the fixture: the second shopper clicks a piece other than the first one\'s, so the grid tells the two clicks apart').toBeDefined();
      const live = rounded(await learned(s.m), 's');
      const expected = { [aHero.contentId]: 1 };
      expect(live, `PRECONDITION ${host}: live learning credited the carried-in click and not the click on the decision its 200-entry ring no longer holds`).toEqual(expected);
      await settleAt(s, at(2, 6));
      const day = await dayOf(s, DATE);
      expect(gridCredits(day.body.report as Json, 'home-hero', 'learning'), `${host}: the hourly fold credits the same (48-hour ring of 200)`).toEqual(expected);
      const custom = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE, policies: [RAW] }, at(2, 8));
      await drainQueue(s, at(2, 8));
      expect(gridCredits(custom.body.report as Json, 'home-hero', RAW.name), `RF6 ${host}: the custom-policy day credits the same outcomes (${custom.status})`).toEqual(expected);
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'home-hero', brand: BRAND, rebuildFrom: DATE }, at(2, 10));
      expect(rebuilt.status, `RF6 ${host}: the rebuild is accepted: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      await settleAt(s, at(2, 10));
      expect(rounded(await learned(s.m), 's'), `RF6 ${host}: the rebuild folds with the 200-entry ring and the previous day's carry-in: the carried-in click credited, the click on the 400-decision-old one not`).toEqual(expected);
    }, T);

    it(`RF6 ${host}: one credit rule with P103's money rule — live learning, the hourly fold, the custom-policy day and the rebuild credit a EUR purchase and refuse a GBP one alike`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(2, 50));
      // A horizon of a hundred years (P103's own fixture): decay moves nothing between the live sum and the offline ones taken an hour later.
      const docs = documents({ money: { currency: 'EUR', nonpositive: 'refuse' }, stats: { n0: 30, tauLearnMs: 3_153_600_000_000, liftMin: 0.5, liftMax: 2, nMin: 30 } },
        { 'checkout-upsell': { reward: 'purchase', objective: 'revenue' } });
      const s = await stamp(host, docs, registry, 'P104.RF6 money');
      const read = await operator(s, 'GET', '/content/learn');
      const published = JSON.stringify(read.body);
      expect(published.includes('"money"') && published.includes('"EUR"'), `RF6 ${host}: PRECONDITION P103 — the learn document's money member { currency, nonpositive } (P103.MP1) is published and read back: ${published.slice(0, 160)}`).toBe(true);
      vi.setSystemTime(at(3, 0));
      const c = await shopperOn(s.m);
      expect((await c.action(PAGE_VIEW)).status, 'PRECONDITION: the shopper\'s page view is accepted').toBe(200);
      const page = await c.snapshot('checkout');
      const pieces = page.decisions.filter(d => d.slot === 'checkout-upsell');
      vi.setSystemTime(at(3, 2));
      const productOf = (contentId: string) => featuredProduct('checkout-upsell', Number(contentId.split('.').pop()))!;
      // As the data layer sends a purchase (P103's own fixture, src/units/P103: orderId, value, margin, currency, items).
      const buy = (contentId: string, value: number, currency: string) => c.action({ type: 'purchase', data: { orderId: `p104-${contentId}`, value, margin: Math.round(value * 0.4), currency,
        items: [{ productId: productOf(contentId), quantity: 1, price: value }] } });
      expect([(await buy(pieces[0]!.contentId, 120, 'EUR')).status, (await buy(pieces[1]!.contentId, 80, 'GBP')).status], 'PRECONDITION: both purchases are accepted').toEqual([200, 200]);
      await drainQueue(s, at(3, 2));
      const expected = { [pieces[0]!.contentId]: 120 };
      const live = Object.fromEntries(Object.entries(rounded(await learned(s.m), 's')).filter(([item]) => item.startsWith('checkout-upsell.')));
      expect(live, `RF6 ${host}: live learning credits the EUR purchase by its value and refuses the GBP one`).toEqual(expected);
      await settleAt(s, at(4, 6));
      const day = await dayOf(s, DATE);
      expect(gridCredits(day.body.report as Json, 'checkout-upsell', 'learning'), `RF6 ${host}: the hourly fold credits the same`).toEqual(expected);
      const custom = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE, policies: [RAW] }, at(4, 8));
      await drainQueue(s, at(4, 8));
      expect(gridCredits(custom.body.report as Json, 'checkout-upsell', RAW.name), `RF6 ${host}: the custom-policy day credits the same`).toEqual(expected);
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'checkout-upsell', brand: BRAND, rebuildFrom: DATE }, at(4, 10));
      expect(rebuilt.status, `RF6 ${host}: the rebuild is accepted: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      await settleAt(s, at(4, 10));
      const after = Object.fromEntries(Object.entries(rounded(await learned(s.m), 's')).filter(([item]) => item.startsWith('checkout-upsell.')));
      expect(after, `RF6 ${host}: the rebuild credits the same`).toEqual(expected);
    }, T);

    it(`RF6 ${host}: a day past today's caps (rawBytes 16 MiB) is rebuilt on the same steps — every exposure and credit counted, every step at most 64 MiB`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF6 rebuild at volume');
      const r = rng(104_301);
      let visits = visitorsOf('day', 460).map(id => visit(registry, id, at(12) + Math.floor(r() * 35 * MIN), 22, r, FULL));
      const objects = ledgerObjects(rowsOf(visits), 500, 'b');
      const facts = hourFacts(objects, 12);
      expect(facts.bytes, 'the fixture: the day holds more than 16 MiB of ledger').toBeGreaterThan(16 * MiB);
      // Witness: every home-hero decision is an exposure; each visit's click on its first piece (home-hero, 30 s later) is credited to that decision.
      const n: Record<string, number> = {}, credits: Record<string, number> = {};
      for (const v of visits) {
        for (const d of v.decisions) if (d.slot === 'home-hero') n[d.item_id] = (n[d.item_id] ?? 0) + 1;
        credits[v.decisions[0]!.item_id] = (credits[v.decisions[0]!.item_id] ?? 0) + 1;
      }
      visits = [];
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 6));
      s.steps.length = 0;
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'home-hero', brand: BRAND, rebuildFrom: DATE }, at(13, 10));
      expect(rebuilt.status, `RF6 ${host}: the rebuild of a ${(facts.bytes / MiB).toFixed(1)} MiB day is accepted, not refused for capacity: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      await settleAt(s, at(13, 10));
      const counters = await learned(s.m);
      expect({ n: rounded(counters, 'n'), s: rounded(counters, 's') }, `RF6 ${host}: every exposure and credit of the day counted`).toEqual({ n, s: credits });
      expect(bounds(s), `RF6 ${host}: the rebuild's steps hold at most 64 MiB each`).toEqual([]);
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF7 — kit 02 states the report as built
// ===========================================================================

describe('unit:P104.RF7 (E29: kit 02 states the envelope)', () => {
  it('RF7: kit 02 states the per-step bound and no volume limit on the fold, the day read by slot (?slot=), the 200 by slot past 8 MiB in place of 413, coverage, and the open hour\'s deferral (open_fold_deferred)', () => {
    const kit = readTree('docs/kit/02-api-reference.md');
    const sentences = kit.split(/(?<=[.!?])\s+(?=[A-Z`(])/);
    const has = (...parts: RegExp[]) => sentences.some(x => parts.every(p => p.test(x)));
    expect({
      perStepBound: has(/64\s?MiB/, /\bstep/i),
      noVolumeLimit: has(/\bstep/i, /(no volume limit|whatever the traffic|any (traffic|volume))/i),
      bySlot: has(/[?&]slot=|`slot`/, /\bpart\b|\bparts\b|by slot/i),
      pastEightMiB: has(/8\s?MiB/, /\b200\b/, /slot/i, /413/),
      coverage: has(/coverage/, /(missing|incomplete)/i),
      openDeferral: /open_fold_deferred/.test(kit),
      todaysCombinedBudgetGone: !/16\s?MiB combined aggregate JSON/.test(kit),
    }, 'RF7: the report as built, in kit 02').toEqual({ perStepBound: true, noVolumeLimit: true, bySlot: true, pastEightMiB: true, coverage: true, openDeferral: true, todaysCombinedBudgetGone: true });
  });
});
