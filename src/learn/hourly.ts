// src/learn/hourly.ts
// Doc 31 §3: the report at the design's volume. A day of a million decisions
// is thousands of ledger objects, more than one request may open, so the day
// report is no longer a day a request reads. Five minutes after an hour closes
// the platform folds that hour's ledger objects into ONE aggregate object, and
// a day is the sum of its hours. Every number in the day report is a count or
// a decayed accumulator, and both add: two accumulators bumped at different
// times combine exactly by decaying each to the later time (`mergeStats`).
//
// Attribution needs each visitor's earlier decisions, so those are carried
// hour to hour as a ring state in shards by visitor, pruned to a horizon and
// to the online ring's capacity. A click at 13:01 on a hero served at 12:59
// credits it; a purchase inside the horizon credits the story that featured
// the bag. Past the horizon the batch report no longer credits, and says so.
// An erased visitor leaves the rings at the next fold; the aggregates hold no
// visitor id, only counts.

import type { DecisionRecord, LearnConfig } from '@/content/types';
import type { SlotLearnConfig } from './fan';
import { hidden, loadTombstones, withoutErased, type Tombstone } from '@/ledger/erasure';
import { isLearningKey, parseId, type OutcomeRecord, type RewardType } from '@/ledger/records';
import type { R2Like } from '@/ledger/writer';
import { readRetention, requireRetention, mergeRetention, type RetentionEnv, type RetentionStamp } from '@/retention';
import { effectiveScore, type ReflexEntry } from '@/reflex/core';
import { attribute, creditWeight, namedSlotOf, type AttributionPolicy, type RingEntry } from './policy';
import { ringEntryOf } from './fan';
import { attributionArm, canonicalReportJson, countDayObjects, presetPolicies, publishedAllocation, readWindowSummary, reportCoverage, reportKey, REPORT_MEASUREMENT, REPORT_LIMITS, ReportBudgetExceeded, ReportUnavailableError, ReportTooLarge, rawReportJson, storedReportText, validateReportIds, validateReportPolicies, runReport, type ArmRow, type DayReport, type ReportPolicy } from './report';
import { attributionContractOf, policyOf, slotConfigsOf } from './route';
import { effectiveExploration } from './explore';
import { computationBasis, effectiveReportPolicy, recordedComputation, ReportInputError, explorationOpportunity, ReportRowIdentity, rawText, validDuplicateCounts,
  type ArmVisitors, type ComputationBasis, type DuplicateCounts, type DuplicateWitness, type ResolvedConflicts, type VisitorOutcomes } from './report';
import { buildSnapshot, DEFAULT_STATS, emptyStats, parentKey, recordExposure, recordSuccess, type Counter, type StatsConfig, type StatsState } from './stats';

export const HOUR_MS = 3600_000;
/** Visitors are spread over this many ring shards; chosen once, because changing it re-partitions every visitor. */
export const SHARDS = 64;
/** The online ring's capacity per visitor (DecisionRing's RING_MAX); the batch ring keeps no more. */
export const RING_CAP = 200;
/** How far back a batch ring reaches: two days holds every window but the seven-day purchase one, within a shard a Worker can parse. */
export const DEFAULT_HORIZON_MS = 48 * HOUR_MS;
/** An hour is folded this long after it ends, so the queue has drained into the ledger. */
export const CLOSE_GRACE_MS = 5 * 60_000;
/**
 * The ledger objects one fold opens at most. A Worker invocation may open only so many objects, and a
 * fold must leave room for the shards and the day report. Since doc 31 an object holds hundreds of
 * records, so an hour past this cap is hundreds of thousands of decisions; the hour is read up to the
 * cap, in time order, and marked truncated with the count it could not read.
 */
export const MAX_HOUR_OBJECTS = 600;
/** The subrequests one catch-up run may spend on folding, under a Worker invocation's limit with room for the day reports. */
export const RUN_BUDGET = 700;
/**
 * W22 R1.02: what the version-2 shard state is allowed to remember. Each is a
 * hard cap under the horizon prune, so a custom horizon, a long outage or a
 * corrupt document can never grow the shard without bound: at the default
 * horizon the set holds 48 hours and the archive three dates.
 */
export const FOLDED_HOURS_MAX = 768;
export const SEEN_DAYS_MAX = 8;

const pad2 = (n: number) => String(n).padStart(2, '0');
export const hourKey = (tenant: string, date: string, hour: number) => `aggregates/${tenant}/${date}/${pad2(hour)}.json`;
export const shardKey = (tenant: string, shard: number) => `aggregates/${tenant}/rings/${pad2(shard)}.json`;
export const hourStart = (date: string, hour: number) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour);
export function hourOf(ms: number): { date: string; hour: number; from: number; to: number } {
  const from = Math.floor(ms / HOUR_MS) * HOUR_MS;
  const d = new Date(from);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), from, to: from + HOUR_MS };
}

/** FNV-1a over the visitor id: the same visitor always lands in the same shard. */
export function shardOf(visitor: string, shards = SHARDS): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < visitor.length; i++) { h ^= visitor.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % shards;
}

// ── shapes ────────────────────────────────────────────────────────────────────

/** A ring entry with the brand it was served for, so a brand's report credits only its own decisions. */
export interface BatchRingEntry extends RingEntry {
  brand: string;
  /**
   * W21 C1.08 (R108, F07 §1.4): the experimental ASSIGNMENT this decision
   * carried, kept BESIDE the arm it was served under and never instead of it. A
   * record written before the provenance block existed carries none and is read
   * by its served arm exactly as before, so an old ring entry is unchanged and a
   * fold of records without provenance writes exactly the bytes it always did.
   */
  assignment?: string;
}
/** What the fold keeps of a decision: the ring entry plus the two facts the exploration count needs. */
export interface CompactDecision { entry: BatchRingEntry; visitor_id: string; ts: number; position: number; explored: boolean; explorationOpportunity?: boolean }
export const compactOf = (d: DecisionRecord): CompactDecision =>
  ({ entry: { ...ringEntryOf(d), brand: d.brand, ...(d.experiment?.arm === undefined ? {} : { assignment: d.experiment.arm }) },
    visitor_id: d.visitor_id, ts: d.ts, position: d.position, explored: d.explored, explorationOpportunity: explorationOpportunity(d) });
/**
 * The row an arm of a REPORT is: the assignment where the record carries one,
 * the arm served where it does not (`src/learn/report.ts:877`, the raw-day
 * branch's own rule). Only the LABEL of a decision, of a credit and of a
 * visitor denominator; what was exposed and what explored stay on the
 * experience served (doc 22 §10).
 */
export const assignmentLabel = (entry: { arm: string; assignment?: string }): string => entry.assignment ?? entry.arm;
/** Labels reach the aggregate, where `aggregateName` admits at most 256 bytes; refuse one the shard could not carry. */
const shardLabel = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value.length > 256 || aggregateBytes(value) > 256
    || Object.hasOwn(Object.prototype, value)) throw new ReportInputError();
  return value;
};

/**
 * W22 R1.02 (F17 §6; ruling R133). Version 2 of the shard state. Every member
 * of version 1 keeps its name and its meaning, and a stored version-1 shard is
 * read without loss — `through` is still the high-water mark of the hours
 * folded, and `seen`/`seenAt`/`seenRetention`/`seenIncomplete` are still the
 * membership of `seenDate`. What version 2 adds is the memory a REPAIR needs:
 *
 *  · `foldedHours` — which hours are in these rings, as a set instead of only a
 *    mark, so an hour that failed and is retried after a later hour has been
 *    folded still puts its decisions into the rings (F17 P3b). It is pruned to
 *    the horizon, and a pruned hour raises `foldedThrough`, the floor below
 *    which every hour is taken to be folded — which is exactly what a version-1
 *    state's `through` means, so the migration is `foldedThrough = through`.
 *  · `seenDays` — the membership of the OTHER dates this shard has folded, so
 *    rolling forward to a new date no longer FORGETS the old one and an hour of
 *    it can still be folded onto its own day's count (F17 P7).
 *
 * Nothing records the repairs themselves: an hour aggregate already carries
 * `builtAt`, so the catch-up sees an earlier hour folded after a later one
 * without this state having to remember it.
 */
export interface ShardState {
  version: 1 | 2;
  shard: number;
  /** The start of the last hour folded into these rings; an earlier hour is never folded twice. */
  through: number;
  /** v2: hours whose decisions are in these rings, above `foldedThrough`. */
  foldedHours?: number[];
  /** v2: the floor a version-1 `through` becomes, and where a pruned hour goes. */
  foldedThrough?: number;
  /** visitor → their decisions inside the horizon, oldest first, at most RING_CAP. */
  rings: Record<string, BatchRingEntry[]>;
  /** The date `seen` counts, and per brand the visitors with a decision on it. */
  seenDate: string;
  seen: Record<string, string[]>;
  /** v2: the same membership for the other dates this shard has folded, pruned to the horizon. */
  seenDays?: Record<string, Record<string, string[]>>;
  /** Latest witnessed decision time per brand/visitor on seenDate, retained independently of ring eviction. */
  seenAt?: Record<string, Record<string, number>>;
  seenRetention?: Record<string, Record<string, RetentionStamp>>;
  /** Date-scoped, nonidentifying warning: legacy timing left incomplete visitor coverage. */
  seenIncomplete?: Record<string, true>;
  /**
   * W21 C1.08: the per-ASSIGNMENT memory of the dates this shard tracks, keyed
   * by date so it stands beside `seen` (the current date) and `seenDays` (the
   * archived ones) without either changing its name or its meaning. Its keys are
   * exactly the membership's — an id that leaves `seen` for erasure or for
   * retention leaves this too, and nothing here holds an id the membership does
   * not already hold under the same retention stamp. Only counts ever leave the
   * shard: the hour aggregate carries the sizes, never an id.
   *
   * A version-1 or version-2 state written before this release simply has none,
   * which is why an hour folded onto such a state says it cannot report the
   * assignment rather than reporting a count of the visitors it happens to know.
   */
  enrollment?: Record<string, Record<string, Record<string, VisitorEnrollment>>>;
  /** Technical write generation, retained after completion to prevent coordinator ETag reuse. */
  generation?: string;
  /** Only shard zero coordinates an interrupted fold; no extra visitor history is retained. */
  pending?: PendingHour;
  cleanup?: CleanupHour;
}
/** W21 C1.08: what one visitor's date is remembered as — no timestamp, no record id, no ring. */
export interface VisitorEnrollment {
  /** The assignments she was drawn into that date, first seen first. */
  arms: string[];
  /** assignment → the outcome types she produced while holding it. */
  outcomes?: Record<string, string[]>;
}
/** At most this many distinct assignments, and outcome types under one, are remembered for one visitor on one date. */
export const ENROLLMENT_ARMS_MAX = 16;
export const emptyShard = (shard: number): ShardState => ({ version: 1, shard, through: -1, rings: {}, seenDate: '', seen: {} });

export interface PolicyHour {
  policy: AttributionPolicy;
  role: 'learning' | 'reporting';
  credits: number;
  /**
   * W26 R1.01: how many of this hour's `credits` came from an outcome that named
   * NEITHER a placement nor a decision — the legacy shape that is spread over
   * every placement of the item instead of crediting the one the shopper acted
   * on. It adds across the hours of a day exactly as `credits` does.
   *
   * The member's ABSENCE is the statement that this hour cannot say (R149), the
   * same rule `HourAssignments` states above: an aggregate folded before this
   * release carries none, and a day summed with any such hour carries none
   * either rather than reporting a total that silently omits those hours. Every
   * hour this build folds carries it, zero included.
   */
  legacyCredits?: number;
  /** `slot|arm` → credits, for the holdout rows. */
  armCredits: Record<string, number>;
  /** slot → the decayed accumulators this hour contributed under this policy. */
  stats: Record<string, StatsState>;
}
/**
 * W21 C1.08 (F25 §5.3, §7; F07 §7): the hour's answer BY EXPERIMENTAL
 * ASSIGNMENT, carried in a member of its own so that every member the aggregate
 * already had keeps its name, its meaning and its bytes — `arms` and
 * `armCredits` are still the arm SERVED, which is what the exposure statistics
 * and the exploration denominator are counted on.
 *
 * `decisions` and `credits` add across the hours of a day. `visitors` and
 * `outcomes` do not: like `visitorsDay`, each is the DAY's distinct count
 * through this hour, taken from the shard membership rather than from the
 * hour's own rows, because distinct visitors cannot be summed. They are
 * therefore merged by maximum, exactly as `visitorsDay` is.
 *
 * The member's ABSENCE is the statement that this hour cannot say: an aggregate
 * folded before this release carries none, and neither does an hour whose shard
 * membership this fold could not account for visitor by visitor. A day with any
 * such hour is grouped by the arm served and answers its denominators `null`,
 * naming those hours in `coverage.unassignedHours`.
 */
export interface HourAssignments {
  version: 1;
  /** slot → assignment → decisions. */
  decisions: Record<string, Record<string, number>>;
  /** policy name → `slot|assignment` → credits. */
  credits: Record<string, Record<string, number>>;
  /** assignment → distinct visitors with a decision on the DATE, through this hour. */
  visitors: Record<string, number>;
  /** assignment → outcome type → distinct visitors on the DATE, through this hour. */
  outcomes: Record<string, Record<string, number>>;
}
export const emptyAssignments = (): HourAssignments => ({ version: 1, decisions: {}, credits: {}, visitors: {}, outcomes: {} });
export interface HourBrand {
  computation?: ComputationBasis | null;
  duplicates?: DuplicateCounts;
  decisions: number;
  outcomes: number;
  /** Distinct visitors with a decision on the date, through this hour (a maximum across hours, not a sum). */
  visitorsDay: number;
  /** Legacy erasure timing left incomplete visitor coverage; exposed through report counts.truncated. */
  visitorsIncomplete?: boolean;
  policies: Record<string, PolicyHour>;
  /** slot → arm → decisions. */
  arms: Record<string, Record<string, number>>;
  /** slot → first-position decisions outside the default arm, and how many of them explored. */
  exploration: Record<string, { decisions: number; explored: number }>;
  /** Rows an erasure tombstone hid before the fold. */
  rows_hidden: number;
  /** W21 C1.08: the same hour by experimental assignment. Absent where this hour cannot say. */
  assignments?: HourAssignments;
}
export interface HourAggregate {
  version: 1;
  /** Write identity only, not a learning-policy generation. Legacy aggregates lack it. */
  generation?: string;
  tenant: string;
  date: string;
  hour: number;
  from: number;
  to: number;
  builtAt: number;
  /** Ledger objects the hour holds, and how many the fold opened; `truncated` when the cap stopped it short. */
  objects: number;
  objectsRead: number;
  truncated: boolean;
  horizonMs: number;
  shards: number;
  /** False when the hour was built after a later one and its decisions could not join the rings (they still count everywhere else). */
  ringsFolded: boolean;
  brands: Record<string, HourBrand>;
}

export type RolePolicy = ReportPolicy & { role: 'learning' | 'reporting' };
/** The learning policy first, then the reporting overlays a data scientist reaches for (doc 22 §4.2). */
export function policiesOf(learn: LearnConfig): RolePolicy[] {
  const learning: ReportPolicy = { name: 'learning', ...policyOf(learn) };
  return [{ ...learning, role: 'learning' }, ...presetPolicies(learning).map((p) => ({ ...p, role: 'reporting' as const }))];
}

export const emptyBrand = (): HourBrand => ({ decisions: 0, outcomes: 0, visitorsDay: 0, policies: {}, arms: {}, exploration: {}, rows_hidden: 0 });
const policyHour = (hb: HourBrand, p: RolePolicy): PolicyHour =>
  (hb.policies[p.name] ??= { policy: { scope: p.scope, match: p.match, credit: p.credit, windowsMs: p.windowsMs }, role: p.role, credits: 0, legacyCredits: 0, armCredits: {}, stats: {} });

// ── merging: exact, because every number is a count or a decayed accumulator ──

function mergeEntry(a: ReflexEntry | undefined, b: ReflexEntry | undefined, tau: number): ReflexEntry {
  if (!a) return b ? { s: b.s, t: b.t } : { s: 0, t: 0 };
  if (!b) return { s: a.s, t: a.t };
  const t = Math.max(a.t, b.t);
  return { s: effectiveScore(a, t, tau) + effectiveScore(b, t, tau), t };
}
function mergeCounter(a: Counter | undefined, b: Counter | undefined, tau: number): Counter {
  const out: Counter = { n: mergeEntry(a?.n, b?.n, tau), s: {} };
  for (const k of new Set([...Object.keys(a?.s ?? {}), ...Object.keys(b?.s ?? {})]) as Set<RewardType>) out.s[k] = mergeEntry(a?.s[k], b?.s[k], tau);
  return out;
}
/** Two statistics states as one: what a single state would hold had it seen both sets of events. */
export function mergeStats(a: StatsState, b: StatsState, tau: number): StatsState {
  const items: StatsState['items'] = {};
  for (const item of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
    const ai = a.items[item] ?? {}, bi = b.items[item] ?? {};
    const out: Record<string, Counter> = {};
    for (const k of new Set([...Object.keys(ai), ...Object.keys(bi)])) out[k] = mergeCounter(ai[k], bi[k], tau);
    items[item] = out;
  }
  const slot: StatsState['slot'] = {};
  for (const k of new Set([...Object.keys(a.slot), ...Object.keys(b.slot)])) slot[k] = mergeCounter(a.slot[k], b.slot[k], tau);
  return { items, slot, events: a.events + b.events, updatedAt: Math.max(a.updatedAt, b.updatedAt) };
}
function addCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}
/** A day's distinct count is cumulative through its hour, so two hours combine by the larger — `visitorsDay`'s own rule. */
function maxCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = Math.max(into[k] ?? 0, v);
}
/**
 * W21 C1.08: the per-assignment view of two hours. Decisions and credits add,
 * the day's distinct visitor counts take the maximum. Whether the DAY may use
 * the result is decided in `reportFromHours` from the hours themselves, because
 * only there is it known which hour could not say.
 */
function mergeAssignments(a: HourAssignments | undefined, b: HourAssignments | undefined): HourAssignments | undefined {
  if (!a && !b) return undefined;
  const out = emptyAssignments();
  for (const src of [a, b]) {
    if (!src) continue;
    for (const [slot, arms] of Object.entries(src.decisions)) addCounts((out.decisions[slot] ??= {}), arms);
    for (const [name, credits] of Object.entries(src.credits)) addCounts((out.credits[name] ??= {}), credits);
    maxCounts(out.visitors, src.visitors);
    for (const [arm, byType] of Object.entries(src.outcomes)) maxCounts((out.outcomes[arm] ??= {}), byType);
  }
  return out;
}
/** Counts merge only after reportFromHours has admitted the recorded computation basis. */
export function mergeBrand(a: HourBrand, b: HourBrand, tau: number): HourBrand {
  const out = emptyBrand();
  out.decisions = a.decisions + b.decisions;
  out.outcomes = a.outcomes + b.outcomes;
  out.visitorsDay = Math.max(a.visitorsDay, b.visitorsDay);
  if (a.visitorsIncomplete || b.visitorsIncomplete) out.visitorsIncomplete = true;
  out.rows_hidden = a.rows_hidden + b.rows_hidden;
  if (a.duplicates || b.duplicates) out.duplicates = { decisions: (a.duplicates?.decisions ?? 0) + (b.duplicates?.decisions ?? 0),
    outcomes: (a.duplicates?.outcomes ?? 0) + (b.duplicates?.outcomes ?? 0) };
  if (out.duplicates && !validDuplicateCounts(out.duplicates)) unavailable();
  const assignments = mergeAssignments(a.assignments, b.assignments);
  if (assignments) out.assignments = assignments;
  for (const src of [a, b]) {
    for (const [slot, arms] of Object.entries(src.arms)) addCounts((out.arms[slot] ??= {}), arms);
    for (const [slot, e] of Object.entries(src.exploration)) { const x = (out.exploration[slot] ??= { decisions: 0, explored: 0 }); x.decisions += e.decisions; x.explored += e.explored; }
    for (const [name, p] of Object.entries(src.policies)) {
      const cur = out.policies[name];
      if (!cur) { out.policies[name] = { policy: p.policy, role: p.role, credits: p.credits,
        ...(p.legacyCredits !== undefined ? { legacyCredits: p.legacyCredits } : {}),
        armCredits: { ...p.armCredits }, stats: Object.fromEntries(Object.entries(p.stats).map(([s, st]) => [s, mergeStats(st, emptyStats(), tau)])) }; continue; }
      if (cur.role !== p.role || JSON.stringify(effectiveReportPolicy(cur.policy)) !== JSON.stringify(effectiveReportPolicy(p.policy))) unavailable();
      cur.credits += p.credits;
      // W26 R1.01 (R149): the legacy share sums only where BOTH hours can say
      // it. One hour folded before the release makes the day's total unknowable
      // — not zero — so the member leaves, and the day reports none.
      if (cur.legacyCredits === undefined || p.legacyCredits === undefined) delete cur.legacyCredits;
      else cur.legacyCredits += p.legacyCredits;
      addCounts(cur.armCredits, p.armCredits);
      for (const [slot, st] of Object.entries(p.stats)) cur.stats[slot] = mergeStats(cur.stats[slot] ?? emptyStats(), st, tau);
    }
  }
  return out;
}

// ── the fold, pure ────────────────────────────────────────────────────────────

/** Phase one, over the hour's decisions: exposures per policy, the arms, what explored. No ring needed. */
export function foldDecisions(decs: readonly CompactDecision[], policies: readonly RolePolicy[], statsCfg: StatsConfig, into: Record<string, HourBrand> = {}): Record<string, HourBrand> {
  for (const d of decs) {
    const e = d.entry;
    const hb = (into[e.brand] ??= emptyBrand());
    hb.decisions += 1;
    const arms = (hb.arms[e.slot] ??= {});
    arms[e.arm] = (arms[e.arm] ?? 0) + 1;
    // W21 C1.08: the same decision counted again under its ASSIGNMENT, beside
    // the served count and never instead of it, so the report can group either
    // way and the exposure and exploration counts below are untouched.
    const label = shardLabel(assignmentLabel(e));
    const byAssignment = ((hb.assignments ??= emptyAssignments()).decisions[e.slot] ??= {});
    byAssignment[label] = (byAssignment[label] ?? 0) + 1;
    if ((d.explorationOpportunity ?? d.position === 0) && e.arm !== 'default') { const x = (hb.exploration[e.slot] ??= { decisions: 0, explored: 0 }); x.decisions += 1; if (d.explored) x.explored += 1; }
    // Exposures: the personalized arm only, as the fan-in records them (doc 22 §10: holdout traffic never feeds the statistics).
    if (e.arm === 'personalized') for (const p of policies) recordExposure((policyHour(hb, p).stats[e.slot] ??= emptyStats()), e.item, e.cell, e.renderedAt ?? d.ts, statsCfg);
  }
  for (const hb of Object.values(into)) for (const p of policies) policyHour(hb, p);
  return into;
}

export interface FoldContext {
  tenant?: string;
  /** Per-build identity witnesses, shared across shards; never persisted. */
  retainedIds?: Set<string>;
  retainedBudget?: { work: number; bytes: number };
  incomingIds?: ReadonlySet<string>;
  date: string;
  from: number;
  to: number;
  /** When this fold ran, as the aggregate's own `builtAt`; a repair is dated by it. */
  now?: number;
  /**
   * W22 R1.02: this hour is being folded again because its ledger has GROWN
   * since the aggregate was written, so rows the rings do not already hold are
   * admitted. Without it a re-fold of an unchanged hour admits nothing, which
   * is what replay has always done and what `ringsFolded: false` reports —
   * rows the cap or the horizon evicted are not resurrected by a rebuild.
   */
  refold?: boolean;
  policies: readonly RolePolicy[];
  slotCfg: Record<string, SlotLearnConfig>;
  statsCfg: StatsConfig;
  horizonMs: number;
  ringCap: number;
  tombs: ReadonlyMap<string, Pick<Tombstone, 'erased_at'>>;
  /** Mutated: credits and successes land on the brand of the outcome. */
  brands: Record<string, HourBrand>;
  /** Ephemeral capture includes credited slots with no current-hour exposure/stat row. */
  creditedSlots?: Map<string, Set<string>>;
}

const objectMap = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const onDate = (ts: unknown, date: string): ts is number => typeof ts === 'number' && Number.isSafeInteger(ts) && ts >= 0
  && Number.isFinite(new Date(ts).getTime()) && new Date(ts).toISOString().slice(0, 10) === date;

const dateShape = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && onDate(Date.parse(value), value);
/** W22 R1.02: the version-2 members, refused whole when any of them is malformed. */
function checkFold(state: ShardState): void {
  if (state.foldedHours !== undefined && (!Array.isArray(state.foldedHours) || state.foldedHours.length > FOLDED_HOURS_MAX
    || state.foldedHours.some(from => !Number.isSafeInteger(from) || from < 0 || from % HOUR_MS !== 0)
    || new Set(state.foldedHours).size !== state.foldedHours.length)) throw new Error('Hourly fold state unavailable');
  if (state.foldedThrough !== undefined && (!Number.isSafeInteger(state.foldedThrough) || state.foldedThrough < -1)) throw new Error('Hourly fold state unavailable');
  if (state.seenDays !== undefined) {
    if (!objectMap(state.seenDays) || Object.keys(state.seenDays).length > SEEN_DAYS_MAX) throw new Error('Hourly seen state unavailable');
    for (const [date, brands] of Object.entries(state.seenDays)) {
      if (!dateShape(date) || date === state.seenDate || !objectMap(brands)) throw new Error('Hourly seen state unavailable');
      for (const ids of Object.values(brands)) {
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw new Error('Hourly seen state unavailable');
      }
    }
  }
}

/**
 * W21 C1.08: the per-assignment memory, refused whole when any of it is
 * malformed — a shard that cannot be read exactly is never read approximately.
 */
function checkEnrollment(state: ShardState): void {
  const memory: unknown = state.enrollment;
  if (memory === undefined) return;
  function fail(): never { throw new Error('Hourly enrollment state unavailable'); }
  const label = (value: unknown): boolean => typeof value === 'string' && !!value && value.length <= 256;
  const list = (value: unknown, each: (item: unknown) => boolean): boolean => Array.isArray(value)
    && value.length <= ENROLLMENT_ARMS_MAX && new Set(value).size === value.length && value.every(each);
  if (!objectMap(memory) || Object.keys(memory).length > SEEN_DAYS_MAX + 1) fail();
  let work = 0;
  for (const [date, brands] of Object.entries(memory)) {
    if (!dateShape(date) || !objectMap(brands)) fail();
    for (const [brand, record] of Object.entries(brands)) {
      if (!label(brand) || !objectMap(record)) fail();
      for (const [visitor, value] of Object.entries(record)) {
        aggregateBound('work', ++work);
        if (!visitor || visitor.length > 256 || !objectMap(value) || !list(value.arms, label)) fail();
        const outcomes: unknown = value.outcomes;
        if (outcomes === undefined) continue;
        if (!objectMap(outcomes) || Object.keys(outcomes).length > ENROLLMENT_ARMS_MAX) fail();
        for (const [arm, types] of Object.entries(outcomes)) {
          aggregateBound('work', ++work);
          if (!label(arm) || !list(types, label)) fail();
        }
      }
    }
  }
}

/**
 * W21 C1.08: the per-assignment memory a date keeps is exactly that date's
 * membership. An id erasure or retention removed from `seen` leaves here in the
 * same pass, and a date the shard no longer tracks is dropped whole.
 */
function pruneEnrollment(state: ShardState): void {
  const memory = state.enrollment;
  if (!memory) return;
  for (const [date, brands] of Object.entries(memory)) {
    const membership = date === state.seenDate ? state.seen : state.seenDays?.[date];
    if (!membership) { delete memory[date]; continue; }
    for (const [brand, record] of Object.entries(brands)) {
      const ids = new Set(membership[brand] ?? []);
      for (const visitor of Object.keys(record)) if (!ids.has(visitor)) delete record[visitor];
      if (!Object.keys(record).length) delete brands[brand];
    }
    if (!Object.keys(brands).length) delete memory[date];
  }
  if (!Object.keys(memory).length) delete state.enrollment;
}

/** The record one visitor's date is remembered by, created on demand; pruned to the membership before the state is written. */
function enrollmentOf(state: ShardState, date: string, brand: string, visitor: string): VisitorEnrollment {
  const brands = ((state.enrollment ??= {})[date] ??= {});
  return ((brands[brand] ??= {})[visitor] ??= { arms: [] });
}

/** Present but unreadable metadata is not proof of activity after erasure. Validate before changing the shard. */
function checkSeen(state: ShardState): void {
  if (!objectMap(state) || typeof state.seenDate !== 'string'
    || (state.seenDate !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(state.seenDate) || !onDate(Date.parse(state.seenDate), state.seenDate)))
    || !objectMap(state.seen) || Object.values(state.seen).some(ids => !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id))) {
    throw new Error('Hourly seen state unavailable');
  }
  if (state.seenAt !== undefined && (!objectMap(state.seenAt) || Object.values(state.seenAt).some(times =>
    !objectMap(times) || Object.values(times).some(ts => !onDate(ts, state.seenDate))))) throw new Error('Hourly seen state unavailable');
  if (state.seenRetention !== undefined) {
    if (!objectMap(state.seenRetention)) throw new Error('Hourly seen state unavailable');
    for (const values of Object.values(state.seenRetention)) {
      if (!objectMap(values)) throw new Error('Hourly seen state unavailable');
      for (const stamp of Object.values(values)) readRetention(stamp, (stamp as RetentionStamp)?.tenant, 'hourly');
    }
  }
  if (state.seenIncomplete !== undefined && (!objectMap(state.seenIncomplete)
    || Object.values(state.seenIncomplete).some(flag => flag !== true))) throw new Error('Hourly seen state unavailable');
  checkFold(state);
  checkEnrollment(state);
}

/**
 * A known date boundary once meant an older hour could never be folded. It is
 * no longer raised: W22 R1.02 keeps the membership of the other dates
 * (`seenDays`), so an older hour folds onto its own day instead of being
 * refused for ever. Retained as an exported name a caller may still catch.
 */
export class SeenDateAhead extends Error {
  constructor(public readonly seenDate: string) { super(`Hourly seen state is newer than requested date: ${seenDate}`); }
}

/** W22 R1.02: the hours this shard has already folded into its rings. */
const foldedSet = (state: ShardState): Set<number> => new Set(state.foldedHours ?? []);
/** Below this, every hour is taken to be folded — a version-1 `through` exactly. */
const foldedFloor = (state: ShardState): number => state.foldedThrough ?? state.through;
const alreadyFolded = (state: ShardState, from: number): boolean => from <= foldedFloor(state) || foldedSet(state).has(from);
/** The membership of one date: the current one is `seen`, an older one is kept per date. */
const seenOn = (state: ShardState, date: string): Record<string, string[]> =>
  state.seenDate === date ? state.seen : (state.seenDays?.[date] ?? {});

/**
 * Phase two, one shard: the hour's decisions join the rings (those the rings do not already hold),
 * erased visitors leave, the rings are pruned to the horizon and the cap, and the hour's
 * outcomes are attributed under every policy against their visitor's ring of the same brand.
 */
export function foldShard(state: ShardState, decs: readonly CompactDecision[], outs: readonly OutcomeRecord[], ctx: FoldContext): { state: ShardState; folded: boolean; changed: boolean } {
  checkSeen(state);
  let changed = false;
  // W22 R1.02 (F17 P3b): whether this hour is already in these rings is a set
  // membership, not `from > through`, so an hour that failed and is retried
  // after a later hour has been folded is still folded in. What it may add is
  // then only what the rings do not already hold, which is what `folded`
  // reports: a rebuild that adds nothing leaves `ringsFolded` false, exactly as
  // a refused out-of-order fold did.
  const already = alreadyFolded(state, ctx.from);
  // Read before anything below advances `through`: the floor is what this state
  // said on entry, which is what `already` was decided against.
  const floorAtEntry = foldedFloor(state);
  const cutoff = ctx.from - ctx.horizonMs;
  if (!objectMap(state.rings)) throw new ReportInputError();
  const retainedIds = ctx.retainedIds ?? new Set<string>();
  const retainedBudget = ctx.retainedBudget ?? { work: 0, bytes: 0 };
  const incomingIds = ctx.incomingIds ?? new Set(decs.filter(d => !hidden(ctx.tombs, d)).map(d => d.entry.id));
  // Compact history cannot establish complete logical equality. Check before
  // erasure/seen mutations or cap projection. buildHour validates every shard before writing.
  for (const [visitor, ring] of Object.entries(state.rings)) {
    if (!Array.isArray(ring)) throw new ReportInputError();
    for (const entry of ring) {
      aggregateBound('work', ++retainedBudget.work);
      if (!objectMap(entry) || typeof entry.id !== 'string' || !entry.id || typeof entry.ts !== 'number' || !Number.isFinite(entry.ts)
        || (Object.hasOwn(entry, 'tenant') && ctx.tenant !== undefined && entry.tenant !== ctx.tenant)
        || (Object.hasOwn(entry, 'visitor_id') && entry.visitor_id !== visitor)) throw new ReportInputError();
      const carrier = parseId(entry.id);
      if (carrier && ((ctx.tenant !== undefined && carrier.tenant !== ctx.tenant) || entry.id.split(':')[2] !== visitor)) throw new ReportInputError();
      if (hidden(ctx.tombs, { visitor_id: visitor, ts: entry.ts }) || entry.ts < cutoff || entry.ts >= ctx.to) continue;
      const size = aggregateBytes(entry.id);
      if (size > 2048) throw new ReportInputError();
      // On a FIRST fold an incoming id already in the rings is corrupt state and
      // still refuses. On a re-fold it is the ordinary case — it is how this
      // fold knows which rows the rings already hold — and is skipped below.
      if (retainedIds.has(entry.id) || (!already && incomingIds.has(entry.id))) throw new ReportInputError();
      aggregateBound('rawBytes', retainedBudget.bytes += size);
      retainedIds.add(entry.id);
    }
  }
  // W22 R1.02 (F17 P7): the membership of a date is no longer wiped when the
  // shard folds an hour of another one. Rolling FORWARD keeps the date it
  // leaves in `seenDays`, so an hour of it is still countable; folding an hour
  // of an OLDER date works on that date's own membership and leaves the current
  // date — `seen`, `seenAt`, `seenRetention`, `seenIncomplete` and `seenDate`,
  // all of which keep their version-1 meaning — untouched.
  const older = state.seenDate !== '' && ctx.date < state.seenDate;
  const beforeDays = JSON.stringify(state.seenDays ?? null);
  const beforeEnrollment = JSON.stringify(state.enrollment ?? null);
  if (!older && state.seenDate !== ctx.date) {
    changed = Object.keys(state.seen).length > 0 || state.seenAt !== undefined || state.seenIncomplete !== undefined;
    if (state.seenDate !== '' && Object.keys(state.seen).length) (state.seenDays ??= {})[state.seenDate] = state.seen;
    state.seenDate = ctx.date; state.seen = state.seenDays?.[ctx.date] ?? {};
    if (state.seenDays) { delete state.seenDays[ctx.date]; if (!Object.keys(state.seenDays).length) delete state.seenDays; }
    delete state.seenAt; delete state.seenIncomplete; delete state.seenRetention;
  }
  const beforeSeen = JSON.stringify([state.seen, state.seenAt, state.seenIncomplete, state.seenRetention]);
  // The membership this hour counts: the current date's, or — when an older
  // date is being repaired — that date's own, which carries ids and nothing
  // else. Every id a tombstone covers leaves it, because without the witnesses
  // the current date keeps there is nothing that can show a later decision.
  const seenSets = new Map(Object.entries(older ? (state.seenDays?.[ctx.date] ?? {}) : state.seen).map(([brand, ids]) => [brand, new Set(ids)]));
  // A timestamp can support existing membership; orphan metadata must never recreate an ID.
  const seenAt = new Map([...seenSets].map(([brand, ids]) => [brand, new Map(Object.entries((older ? undefined : state.seenAt)?.[brand] ?? {}).filter(([id]) => ids.has(id)))]));
  const incomplete = new Set(older ? [] : Object.keys(state.seenIncomplete ?? {}));
  for (const [brand, ids] of seenSets) for (const v of ids) {
    const tomb = ctx.tombs.get(v);
    if (!tomb) continue;
    if (older) { ids.delete(v); continue; }
    const times = seenAt.get(brand)!;
    let latest = times.get(v);
    // Ring presence is positive evidence only. Legacy ring absence (or an old row) cannot prove
    // that a later same-brand decision was never evicted. Preserve that uncertainty for this date.
    for (const e of state.rings[v] ?? []) if (e.brand === brand && onDate(e.ts, state.seenDate) && e.ts > tomb.erased_at) {
      if (latest === undefined) incomplete.add(brand);
      latest = Math.max(latest ?? e.ts, e.ts);
    }
    if (latest === undefined || latest <= tomb.erased_at) {
      if (latest === undefined) incomplete.add(brand);
      ids.delete(v); times.delete(v);
      if (state.seenRetention?.[brand]) delete state.seenRetention[brand]![v];
    } else times.set(v, latest);
  }
  for (const v of ctx.tombs.keys()) {
    const ring = state.rings[v];
    if (!ring) continue;
    const kept = withoutErased(ring.map((e) => ({ visitor_id: v, ts: e.ts, e })), ctx.tombs).map((x) => x.e);
    if (kept.length) state.rings[v] = kept; else delete state.rings[v];
    if (kept.length !== ring.length) changed = true;
  }
  // Attribution needs the ring at the outcome's time, not the end of the hour.
  // Reconstruct current-hour rows on replay too; the append guard below still
  // prevents a row entering the rings twice. Evicted carry-in cannot be
  // recovered here; the hours built after a repaired one ARE rebuilt, by the
  // catch-up, against the rings this fold leaves (W22 R1.02).
  const orderedOutcomes = outs.filter(o => o.ts >= ctx.from && o.ts < ctx.to && !hidden(ctx.tombs, o)).sort((a, b) => a.ts - b.ts);
  const attributionRings = new Map<string, BatchRingEntry[]>();
  for (const o of orderedOutcomes) if (!attributionRings.has(o.visitor_id)) {
    attributionRings.set(o.visitor_id, (state.rings[o.visitor_id] ?? [])
      .filter(e => e.ts >= cutoff && e.ts < ctx.from && (e.measurementBasis ?? 'served-v1') === (ctx.slotCfg[e.slot]?.measurementBasis ?? 'served-v1')).sort((a, b) => a.ts - b.ts).slice(-ctx.ringCap));
  }
  const current = decs.filter(d => d.ts >= ctx.from && d.ts < ctx.to && d.ts >= cutoff
    && attributionRings.has(d.visitor_id) && !hidden(ctx.tombs, d)).sort((a, b) => a.ts - b.ts);
  // W21 C1.08 (F07 §7): her earliest decision of THIS DATE that this fold can
  // see, per brand. It is the fallback the raw-day branch uses for an outcome
  // that precedes every decision of the day (`src/learn/report.ts:966`).
  const firstOnDate = new Map<string, BatchRingEntry>();
  for (const d of current) if (onDate(d.ts, ctx.date)) {
    const key = `${d.entry.brand}\u0000${d.visitor_id}`;
    if (!firstOnDate.has(key)) firstOnDate.set(key, d.entry);
  }
  const touched = new Set<string>();
  // What this fold may put into the rings: on a first fold every surviving row,
  // on a re-fold only the rows the rings do not already hold. `folded` — and so
  // the aggregate's `ringsFolded` — is true exactly when this hour's decisions
  // are in the rings because of this run or a first fold, and false when a
  // rebuild found nothing to add, which is what it has always meant.
  const admitted = decs.filter(d => !hidden(ctx.tombs, d) && !(already && (!ctx.refold || retainedIds.has(d.entry.id))));
  const folded = !already || admitted.length > 0;
  {
    for (const d of admitted) {
      (state.rings[d.visitor_id] ??= []).push(d.entry);
      touched.add(d.visitor_id);
      if (!onDate(d.ts, ctx.date)) continue;
      let s = seenSets.get(d.entry.brand);
      if (!s) { s = new Set(); seenSets.set(d.entry.brand, s); }
      s.add(d.visitor_id);
      // W21 C1.08: her ASSIGNMENT on this date, which is a membership fact like
      // the id itself — same date, same brand, same visitor, pruned to the same
      // membership before this state is written, so it is erased with it.
      {
        const enrolled = enrollmentOf(state, ctx.date, d.entry.brand, d.visitor_id);
        const label = shardLabel(assignmentLabel(d.entry));
        if (!enrolled.arms.includes(label)) {
          if (enrolled.arms.length >= ENROLLMENT_ARMS_MAX) throw new ReportInputError();
          enrolled.arms.push(label);
        }
      }
      if (older) continue;                 // an older date keeps ids, and no witness it cannot carry
      let times = seenAt.get(d.entry.brand);
      if (!times) { times = new Map(); seenAt.set(d.entry.brand, times); }
      times.set(d.visitor_id, Math.max(times.get(d.visitor_id) ?? d.ts, d.ts));
      if (d.entry.retention?.hourly) {
        const stamps = ((state.seenRetention ??= {})[d.entry.brand] ??= {}), prior = stamps[d.visitor_id];
        stamps[d.visitor_id] = prior ? mergeRetention(prior, d.entry.retention.hourly, d.entry.tenant!, 'hourly') : d.entry.retention.hourly;
      }
    }
    if (admitted.length) changed = true;
  }
  // Keep the existing hour-start horizon and final persisted retention behavior.
  for (const [v, ring] of Object.entries(state.rings)) {
    const sorted = touched.has(v) ? [...ring].sort((a, b) => a.ts - b.ts) : ring;
    const kept = sorted.filter((e) => e.ts >= cutoff).slice(-ctx.ringCap);
    if (kept.length !== ring.length || touched.has(v)) changed = true;
    if (kept.length) state.rings[v] = kept; else delete state.rings[v];
  }
  let nextDecision = 0;
  for (const o of orderedOutcomes) {
    // Stable sort retains same-time decision order; <= places every equal-time
    // decision before the outcome. Cap across brands before policy filtering.
    while (nextDecision < current.length && current[nextDecision]!.ts <= o.ts) {
      const d = current[nextDecision++]!, entries = attributionRings.get(d.visitor_id)!;
      entries.push(d.entry);
      if (entries.length > ctx.ringCap) attributionRings.set(d.visitor_id, entries.slice(-ctx.ringCap));
    }
    const subjectRing = attributionRings.get(o.visitor_id) ?? [];
    // W21 C1.08 (F07 §7): the outcome as a VISITOR-level fact, under the
    // assignment in force when it happened — her latest decision of this date at
    // or before it, else her earliest of the date, which is the raw-day branch's
    // own rule. Counted here, before attribution, because an outcome counts for
    // the arm the visitor holds whether or not a served piece matched it, and
    // recorded as a set of types, because two purchases by one visitor are one
    // purchasing visitor.
    const held = subjectRing.filter(e => e.brand === o.brand && onDate(e.ts, ctx.date) && e.ts <= o.ts).at(-1)
      ?? firstOnDate.get(`${o.brand}\u0000${o.visitor_id}`);
    if (held) {
      const enrolled = enrollmentOf(state, ctx.date, o.brand, o.visitor_id);
      const label = shardLabel(assignmentLabel(held)), type = shardLabel(o.type);
      const outcomes = (enrolled.outcomes ??= {});
      if (!outcomes[label] && Object.keys(outcomes).length >= ENROLLMENT_ARMS_MAX) throw new ReportInputError();
      const types = (outcomes[label] ??= []);
      if (!types.includes(type)) {
        if (types.length >= ENROLLMENT_ARMS_MAX) throw new ReportInputError();
        types.push(type);
      }
    }
    // An explicit reference must expose ambiguity across the complete retained
    // subject ring; the shared selector checks the unique target's brand.
    const ring = Object.hasOwn(o, 'decision_id') ? subjectRing : subjectRing.filter((e) => e.brand === o.brand);
    if (!ring.length) continue;
    const hb = (ctx.brands[o.brand] ??= emptyBrand());
    // W26 R1.01: an outcome that names neither a placement nor a decision buys
    // its credits by the legacy spread rule. The same predicate the raw-day
    // branch uses (`src/learn/report.ts`), so the two branches count one day
    // one way.
    const legacy = !Object.hasOwn(o, 'decision_id') && namedSlotOf(o.slot) === null;
    for (const p of ctx.policies) {
      const ph = policyHour(hb, p);
      for (const c of attribute(o, ring, p)) {
        const reward = ctx.slotCfg[c.slot]?.reward ?? 'click';
        if (c.reward !== reward) continue;                       // the slot learns against one reward
        if (ctx.creditedSlots) {
          const slots = ctx.creditedSlots.get(o.brand) ?? new Set<string>();
          slots.add(c.slot); ctx.creditedSlots.set(o.brand, slots);
        }
        ph.credits += 1;
        if (legacy) ph.legacyCredits = (ph.legacyCredits ?? 0) + 1;
        const credited = ring.find((e) => e.id === c.decision_id);
        const arm = credited?.arm ?? 'personalized';
        ph.armCredits[`${c.slot}|${arm}`] = (ph.armCredits[`${c.slot}|${arm}`] ?? 0) + 1;
        // W21 C1.08: the same credit again, under the ASSIGNMENT of the decision
        // it credits. The served label above, and the statistics below, are
        // unchanged.
        const label = credited ? shardLabel(assignmentLabel(credited)) : arm;
        const byAssignment = ((hb.assignments ??= emptyAssignments()).credits[p.name] ??= {});
        byAssignment[`${c.slot}|${label}`] = (byAssignment[`${c.slot}|${label}`] ?? 0) + 1;
        if (arm === 'personalized') {
          const w = creditWeight(ctx.slotCfg[c.slot]?.objective, o);
          if (w > 0) recordSuccess((ph.stats[c.slot] ??= emptyStats()), c.item, c.cell, c.reward as RewardType, c.ts, w, ctx.statsCfg);
        }
      }
    }
  }
  if (folded && ctx.from > state.through) state.through = ctx.from;   // the version-1 mark, still the newest hour folded
  if (older) {
    const days = (state.seenDays ??= {});
    days[ctx.date] = Object.fromEntries([...seenSets].map(([b, s]) => [b, [...s]]));
  } else {
    state.seen = Object.fromEntries([...seenSets].map(([b, s]) => [b, [...s]]));
    const witnesses = [...seenAt].filter(([, times]) => times.size);
    if (witnesses.length || state.seenAt !== undefined) state.seenAt = Object.fromEntries(witnesses.map(([brand, times]) => [brand, Object.fromEntries(times)]));
    if (incomplete.size) state.seenIncomplete = Object.fromEntries([...incomplete].map(brand => [brand, true as const]));
  }
  // W22 R1.02: this hour is now in these rings, the set is pruned to the
  // horizon — a pruned hour raising the floor, so it is never folded twice —
  // and an older hour folded after newer ones is recorded, so the catch-up can
  // rebuild the hours whose attribution ran against the rings as they were.
  rememberFold(state, ctx, floorAtEntry);
  pruneSeenDays(state, ctx);
  // W21 C1.08: the per-assignment memory keeps exactly the membership's ids, so
  // it is pruned last, after the membership and the archived dates are final.
  pruneEnrollment(state);
  if (JSON.stringify(state.enrollment ?? null) !== beforeEnrollment) changed = true;
  if (JSON.stringify(state.seenDays ?? null) !== beforeDays) changed = true;
  if (JSON.stringify([state.seen, state.seenAt, state.seenIncomplete, state.seenRetention]) !== beforeSeen) changed = true;
  return { state, folded, changed };
}

/**
 * The fold record, after the hour is folded: this hour joins the set, and the
 * set is pruned to the horizon with every dropped hour raising the floor below
 * which an hour is taken to be folded — so a pruned hour is never folded twice,
 * and the state a shard keeps is bounded by the horizon and by a hard cap.
 */
function rememberFold(state: ShardState, ctx: FoldContext, floorAtEntry: number): void {
  const hours = foldedSet(state);
  hours.add(ctx.from);
  let floor = floorAtEntry;
  const newest = Math.max(ctx.from, state.through, ...hours);
  const keepFrom = newest - Math.max(ctx.horizonMs, 0);
  for (const from of [...hours].sort((a, b) => a - b)) {
    if (from >= keepFrom && hours.size <= FOLDED_HOURS_MAX) break;
    hours.delete(from); floor = Math.max(floor, from);
  }
  state.version = 2;
  state.foldedThrough = floor;
  state.foldedHours = [...hours].filter(from => from > floor).sort((a, b) => a - b);
}

/** The archived dates, kept only while an hour of them can still reach the rings. */
function pruneSeenDays(state: ShardState, ctx: FoldContext): void {
  const days = state.seenDays;
  if (!days) return;
  const oldest = new Date(Math.max(0, hourStart(ctx.date, 0) - Math.max(ctx.horizonMs, 0))).toISOString().slice(0, 10);
  for (const date of Object.keys(days)) if (date < oldest || date === state.seenDate) delete days[date];
  const dates = Object.keys(days).sort();
  for (const date of dates.slice(0, Math.max(0, dates.length - SEEN_DAYS_MAX))) delete days[date];
  if (!Object.keys(days).length) delete state.seenDays;
}

// ── the day from its hours ────────────────────────────────────────────────────

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const aggregateUtf8 = new TextEncoder();
const aggregateBytes = (v: string) => /[\u0080-\uFFFF]/.test(v) ? aggregateUtf8.encode(v).length : v.length;
const aggregateBound = (key: keyof typeof REPORT_LIMITS, n: number) => {
  if (n > REPORT_LIMITS[key]) throw new ReportBudgetExceeded(key, REPORT_LIMITS[key], n);
};
function unavailable(): never { throw new ReportUnavailableError(); }
const aggregateMap = (v: unknown): Record<string, unknown> => objectMap(v) ? v : unavailable();
const aggregateName = (v: string, max = 256) => {
  if (typeof v !== 'string' || !v || v.length > max || aggregateBytes(v) > max || Object.hasOwn(Object.prototype, v)) unavailable();
};
const aggregateNumber = (v: unknown) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) unavailable(); };

function aggregateIdentity(v: unknown, ids: { tenant: string; date: string }, expectedHour?: number): asserts v is HourAggregate {
  const a = aggregateMap(v);
  if (a.version !== 1 || a.tenant !== ids.tenant || a.date !== ids.date || !Number.isInteger(a.hour)
    || Number(a.hour) < 0 || Number(a.hour) > 23 || (expectedHour !== undefined && a.hour !== expectedHour)) unavailable();
  const from = Date.parse(ids.date + 'T00:00:00Z') + Number(a.hour) * HOUR_MS;
  if (!Number.isFinite(from) || a.from !== from || a.to !== from + HOUR_MS) unavailable();
  aggregateMap(a.brands);
}

/** Admission precedes sorting, repeated merge copies and snapshot parent expansion. */
function admitHours(aggs: readonly HourAggregate[], ids: { tenant: string; brand: string; date: string }): void {
  if (!Array.isArray(aggs)) unavailable();
  aggregateBound('aggregateObjects', aggs.length);
  aggregateName(ids.tenant); aggregateName(ids.brand);
  let work = 0, bytes = 0;
  // mergeBrand copies accumulated containers and remerges overlaps on every hour.
  const visit = () => aggregateBound('work', work += 4 * Math.max(1, aggs.length));
  const policies = new Set<string>(), slots = new Set<string>(), hours = new Set<number>();
  const cells = new Set<string>();
  const cell = (policy: string, slot: string, item: string | null, key: string) => {
    const id = JSON.stringify([policy, slot, item, key]);
    if (cells.has(id)) return false;
    aggregateName(key, 2048); cells.add(id); aggregateBound('cells', cells.size); visit(); return true;
  };
  const counter = (v: unknown) => {
    visit(); const c = aggregateMap(v), n = aggregateMap(c.n); aggregateNumber(n.s); aggregateNumber(n.t);
    for (const [reward, entry] of Object.entries(aggregateMap(c.s))) {
      visit(); if (!['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom'].includes(reward)) unavailable();
      const e = aggregateMap(entry); aggregateNumber(e.s); aggregateNumber(e.t);
    }
  };
  for (const a of aggs) {
    aggregateIdentity(a, ids); if (hours.has(a.hour)) unavailable(); hours.add(a.hour);
    for (const [brand, value] of Object.entries(a.brands)) {
      aggregateName(brand); visit(); const b = aggregateMap(value);
      for (const k of ['decisions', 'outcomes', 'visitorsDay', 'rows_hidden']) aggregateNumber(b[k]);
      if (Object.hasOwn(b, 'duplicates') && !validDuplicateCounts(b.duplicates)) unavailable();
      for (const [slot, value] of Object.entries(aggregateMap(b.arms))) {
        aggregateName(slot); visit(); if (brand === ids.brand) slots.add(slot);
        for (const [arm, n] of Object.entries(aggregateMap(value))) { aggregateName(arm); aggregateNumber(n); visit(); }
      }
      for (const [slot, value] of Object.entries(aggregateMap(b.exploration))) {
        aggregateName(slot); visit(); if (brand === ids.brand) slots.add(slot);
        const e = aggregateMap(value); aggregateNumber(e.decisions); aggregateNumber(e.explored);
      }
      // W21 C1.08: the per-assignment member is admitted exactly as strictly as
      // the served one; a malformed one refuses the day rather than being
      // ignored, which would answer a denominator from a source read loosely.
      if (Object.hasOwn(b, 'assignments')) {
        const ha = aggregateMap(b.assignments);
        if (ha.version !== 1) unavailable();
        for (const [slot, value] of Object.entries(aggregateMap(ha.decisions))) {
          aggregateName(slot); visit(); if (brand === ids.brand) slots.add(slot);
          for (const [arm, n] of Object.entries(aggregateMap(value))) { aggregateName(arm); aggregateNumber(n); visit(); }
        }
        for (const [name, value] of Object.entries(aggregateMap(ha.credits))) {
          aggregateName(name); visit();
          for (const [key, n] of Object.entries(aggregateMap(value))) { aggregateName(key, 2048); aggregateNumber(n); visit(); }
        }
        for (const [arm, n] of Object.entries(aggregateMap(ha.visitors))) { aggregateName(arm); aggregateNumber(n); visit(); }
        for (const [arm, value] of Object.entries(aggregateMap(ha.outcomes))) {
          aggregateName(arm); visit();
          for (const [type, n] of Object.entries(aggregateMap(value))) { aggregateName(type); aggregateNumber(n); visit(); }
        }
      }
      for (const [name, value] of Object.entries(aggregateMap(b.policies))) {
        aggregateName(name); visit(); const p = aggregateMap(value);
        if (p.role !== 'learning' && p.role !== 'reporting') unavailable(); aggregateNumber(p.credits);
        // W26 R1.01: present or absent, never malformed — an aggregate folded
        // before the release carries none and stays readable.
        if (p.legacyCredits !== undefined) aggregateNumber(p.legacyCredits);
        try { validateReportPolicies([{ ...aggregateMap(p.policy), name } as ReportPolicy]); } catch { unavailable(); }
        if (brand === ids.brand) { policies.add(name); aggregateBound('policies', policies.size); }
        for (const [key, n] of Object.entries(aggregateMap(p.armCredits))) { aggregateName(key, 2048); aggregateNumber(n); visit(); }
        for (const [slot, value] of Object.entries(aggregateMap(p.stats))) {
          aggregateName(slot); visit(); if (brand === ids.brand) slots.add(slot);
          const st = aggregateMap(value); aggregateNumber(st.events); aggregateNumber(st.updatedAt);
          for (const [item, levels] of Object.entries(aggregateMap(st.items))) {
            aggregateName(item); visit();
            for (const [key, c] of Object.entries(aggregateMap(levels))) {
              aggregateName(key, 2048); counter(c);
              if (brand === ids.brand) {
                cell(name, slot, item, key);
                for (let parent: string | null = key; parent !== null; parent = parentKey(parent)) if (!cell(name, slot, null, parent)) break;
              }
            }
          }
          for (const [key, c] of Object.entries(aggregateMap(st.slot))) { aggregateName(key, 2048); counter(c); }
        }
      }
    }
    bytes += aggregateBytes(JSON.stringify(a)); aggregateBound('aggregateBytes', bytes);
  }
  aggregateBound('work', work + policies.size * slots.size * 4);
  aggregateBound('cells', cells.size + policies.size * slots.size);
}

function finiteMerged(value: unknown, depth = 0): void {
  if (depth > 16) unavailable();
  if (typeof value === 'number' && !Number.isFinite(value)) unavailable();
  if (value && typeof value === 'object') for (const child of Object.values(value)) finiteMerged(child, depth + 1);
}

/** No old accumulator is relabeled with today's reward/objective/tau or later policy. */
function compatibleHours(aggs: readonly HourAggregate[], brand: string, learn: LearnConfig): ComputationBasis | null {
  let first: ComputationBasis | null = null;
  const slots = new Map<string, ComputationBasis['slots'][number]>();
  for (const a of aggs) {
    const b = a.brands[brand]; if (!b) continue;
    const basis = recordedComputation(b.computation);
    if (!basis || basis.profile.source !== 'hourly-ring' || basis.profile.horizonMs !== a.horizonMs) unavailable();
    const definitions = Object.entries(b.policies).map(([name, p]) => ({ name, role: p.role, policy: p.policy }));
    let expected: ComputationBasis;
    try { expected = { ...computationBasis(learn, definitions, basis.slots.map(s => s.slot), basis.profile), version: basis.version }; }
    catch (error) { if (error instanceof ReportBudgetExceeded) throw error; unavailable(); }
    if (basis.version < 4) {
      // Retained v1–3 accumulated served decisions. Compare the original shape
      // only when today's requested basis is still served; never relabel it.
      if (expected.slots.some(s => s.measurementBasis !== 'served-v1')) unavailable();
      expected.slots = expected.slots.map(({ measurementBasis: _basis, ...slot }) => { void _basis; return slot; });
    }
    const header = (v: ComputationBasis) => JSON.stringify([v.version, v.unit, v.profile, v.policies]);
    if (header(basis) !== header(expected) || (first && header(first) !== header(basis))) unavailable();
    const bySlot = new Map(basis.slots.map(s => [s.slot, s]));
    for (const s of expected.slots) if (JSON.stringify(s) !== JSON.stringify(bySlot.get(s.slot))) unavailable();
    for (const slot of new Set([...Object.keys(b.arms), ...Object.keys(b.exploration), ...Object.keys(b.assignments?.decisions ?? {}),
      ...Object.values(b.policies).flatMap(p => Object.keys(p.stats))])) if (!bySlot.has(slot)) unavailable();
    // The producer's arm suffix has no delimiter; retain slots containing delimiters intact.
    for (const credits of [...Object.values(b.policies).map(p => p.armCredits), ...Object.values(b.assignments?.credits ?? {})]) for (const key of Object.keys(credits)) {
      if (!bySlot.has(key.slice(0, key.lastIndexOf('|')))) unavailable();
    }
    for (const s of basis.slots) {
      if (slots.has(s.slot) && JSON.stringify(slots.get(s.slot)) !== JSON.stringify(s)) unavailable();
      slots.set(s.slot, s);
    }
    first ??= basis;
  }
  return first ? { ...first, slots: [...slots.values()].sort((a, b) => a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0) } : null;
}

/**
 * W21 C1.08: whether an hour's per-assignment view really is the same hour as
 * the served one it stands beside. Both are written for every decision of the
 * same fold, so in anything this platform wrote their per-slot decision totals
 * and their per-policy credit totals agree, no arm has more visitors than the
 * day has and no outcome row has more visitors than its arm. A STORED aggregate
 * where any of that fails — a partial write, a corrupt object, a producer this
 * reader does not know — is a source that cannot say what the assignment was,
 * and is read exactly like one folded before the member existed: the day groups
 * by the arm SERVED, answers its denominators null, and names the hour.
 */
function assignmentsAgree(b: HourBrand): boolean {
  const ha = b.assignments;
  if (!ha) return false;
  const total = (counts: Record<string, number> | undefined) => Object.values(counts ?? {}).reduce((n, v) => n + v, 0);
  for (const slot of new Set([...Object.keys(b.arms), ...Object.keys(ha.decisions)])) {
    if (total(b.arms[slot]) !== total(ha.decisions[slot])) return false;
  }
  for (const name of new Set([...Object.keys(b.policies), ...Object.keys(ha.credits)])) {
    if (total(b.policies[name]?.armCredits) !== total(ha.credits[name])) return false;
  }
  const visitors = Object.values(ha.visitors);
  if (visitors.some(n => n > b.visitorsDay) || total(ha.visitors) < b.visitorsDay) return false;
  for (const [arm, byType] of Object.entries(ha.outcomes)) {
    if (Object.values(byType).some(n => n > (ha.visitors[arm] ?? 0))) return false;
  }
  return true;
}

/** The day report, in the shape `buildReport` makes, from whichever hours are built. */
export function reportFromHours(aggs: readonly HourAggregate[], ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, now: number, opts: { pending: number; missing: number[] }): DayReport {
  validateReportIds(ids);
  if (!Array.isArray(opts.missing) || opts.missing.length > 24 || new Set(opts.missing).size !== opts.missing.length
    || !Array.from(opts.missing).every(h => Number.isInteger(h) && h >= 0 && h < 24)) unavailable();
  aggregateNumber(opts.pending);
  admitHours(aggs, ids);
  const statsCfg: StatsConfig = learn.stats ?? DEFAULT_STATS, slotCfg = slotConfigsOf(learn), tau = statsCfg.tauLearnMs;
  if (!Number.isFinite(now) || !Number.isFinite(tau) || tau <= 0 || !Number.isFinite(statsCfg.n0) || statsCfg.n0 <= 0) unavailable();
  const sorted = [...aggs].sort((a, b) => a.hour - b.hour);
  const computation = compatibleHours(sorted, ids.brand, learn);
  let hb = emptyBrand();
  for (const a of sorted) { const b = a.brands[ids.brand]; if (b) hb = mergeBrand(hb, b, tau); }
  finiteMerged(hb);
  // W21 C1.08 (R108, F25 §7): which of the summed hours can say what the
  // ASSIGNMENT was. An hour that carries this brand but not the member was
  // folded before this release, or onto a shard state that predates it. The day
  // then groups by the arm SERVED, exactly as it always did, answers its per-arm
  // denominators unknown rather than dividing a total it does not hold, and
  // NAMES those hours. One day uses one rule for all of its hours: mixing the
  // two groupings would put one visitor under two different rows.
  const unassignedHours = sorted.filter(a => a.brands[ids.brand] !== undefined && !assignmentsAgree(a.brands[ids.brand]!)).map(a => a.hour);
  const assignments = unassignedHours.length === 0 ? hb.assignments : undefined;
  const names = Object.keys(hb.policies).sort((a, b) => Number(hb.policies[b]!.role === 'learning') - Number(hb.policies[a]!.role === 'learning'));
  const slots = [...new Set([...Object.keys(hb.arms), ...Object.keys(hb.exploration), ...Object.values(hb.policies).flatMap((p) => Object.keys(p.stats))])].sort();
  const policies: DayReport['policies'] = [];
  const grids: DayReport['grids'] = {};
  const holdout: DayReport['holdout'] = {};
  const holdoutComparison: DayReport['holdoutComparison'] = {};
  for (const name of names) {
    const p = hb.policies[name]!;
    // W26 R1.01 (R149): the legacy share is carried onto the day only where
    // every summed hour could say it; otherwise the member is absent, exactly
    // as the per-arm denominators are when an hour cannot name the assignment.
    policies.push({ name, policy: p.policy, role: p.role, credits: p.credits,
      ...(p.legacyCredits !== undefined ? { legacyCredits: p.legacyCredits } : {}) });
    for (const slot of slots) (grids[slot] ??= {})[name] = buildSnapshot(p.stats[slot] ?? emptyStats(), { tenant: ids.tenant, brand: ids.brand, slot }, slotCfg[slot]?.reward ?? 'click', now, statsCfg, null, slotCfg[slot]?.objective ?? 'unit', slotCfg[slot]?.measurementBasis ?? 'served-v1');
    if (p.role !== 'learning') continue;
    for (const slot of slots) {
      const byArm = assignments ? assignments.decisions[slot] ?? {} : hb.arms[slot] ?? {};
      const armCredits = assignments ? assignments.credits[name] ?? {} : p.armCredits;
      const rows: ArmRow[] = Object.keys(byArm).sort().map((arm) => {
        const decisions = byArm[arm] ?? 0, credited = armCredits[`${slot}|${arm}`] ?? 0;
        return attributionArm(arm, decisions, credited);
      });
      holdout[slot] = rows;
      holdoutComparison[slot] = [];
    }
  }
  // W28.W1.01: the folded day says exactly what the raw day says (`src/learn/report.ts`),
  // including the retained setting where the engine will not run the configured mode.
  const exploration = slots.map((slot) => {
    const x = hb.exploration[slot] ?? { decisions: 0, explored: 0 };
    const cfg = learn.slots?.[slot]?.exploration ?? null;
    return { slot, decisions: x.decisions, explored: x.explored, realized: x.decisions ? r3(x.explored / x.decisions) : 0, ...effectiveExploration(cfg) };
  });
  // W21 C1.03/E1.04 (F25 §5.3, F07 §7): the day's per-arm DENOMINATORS, in
  // distinct visitors, summed from the membership each hour carried — never
  // divided out of the decision counts, which differ from them by exactly the
  // quantity the design effect needs.
  const armNames = assignments
    ? [...new Set([...Object.keys(assignments.visitors), ...Object.keys(assignments.outcomes)])].sort((a, b) => a.localeCompare(b)) : [];
  const armVisitors: ArmVisitors | null = assignments
    ? { version: 1, basis: 'distinct_visitors', arms: armNames.map(arm => ({ arm, visitors: assignments.visitors[arm] ?? 0 })) } : null;
  const visitorOutcomes: VisitorOutcomes | null = assignments
    ? { version: 1, basis: 'enrolled_visitors', arms: armNames.map(arm => ({ arm, visitors: assignments.visitors[arm] ?? 0,
      byType: Object.fromEntries(Object.entries(assignments.outcomes[arm] ?? {}).sort(([x], [y]) => x.localeCompare(y))) })) } : null;
  const last = sorted[sorted.length - 1];
  const counts = { decisions: hb.decisions, outcomes: hb.outcomes, visitors: hb.visitorsDay, truncated: sorted.some((a) => a.truncated) || !!hb.visitorsIncomplete,
    ...(hb.duplicates ? { duplicates: hb.duplicates } : {}) };
  const hours = { source: 'aggregates' as const, built: sorted.map((a) => a.hour), missing: [...opts.missing], ...(last ? { horizonMs: last.horizonMs } : {}) };
  const report: DayReport = {
    tenant: ids.tenant, brand: ids.brand, date: ids.date, builtAt: now,
    // Truncated also signals incomplete visitor coverage after conservative legacy erasure.
    // Existing anonymous historical max counts are not reconstructed by this fold.
    counts,
    policies, grids, exploration, measurement: REPORT_MEASUREMENT, holdout, holdoutComparison, computation,
    // W25 O1.01: an hour aggregate carries decayed counters and no prior
    // revision, so a day summed from hours is built prior-free and says so
    // rather than leaving the difference from the live table unexplained. Making
    // the fold prior-aware means carrying the prior revision the hour was
    // computed under into the aggregate itself; that is owed work, named on the
    // W25.O1.01 row, not something this declaration may pretend away.
    gridPriors: { applied: false, priorVersion: 0 },
    // W21 C1.03: the allocation the day was served under is published
    // configuration and is recorded here as it is on a raw-day build.
    allocation: publishedAllocation(learn),
    // W22 A1.01 (F17 P4): the same named contract as every other path, with the
    // horizon THIS fold really ran under — the least of the hours it summed, so
    // the day never claims a reach one of its hours did not have. The window
    // the tenant published stands beside it, so the difference between "seven
    // days" and "forty-eight hours" is on the answer instead of in the code.
    attributionContract: attributionContractOf(learn, sorted.length
      ? Math.min(...sorted.map(a => Number.isFinite(a.horizonMs) && a.horizonMs >= 0 ? a.horizonMs : 0)) : 0),
    armVisitors,
    visitorOutcomes,
    erasures: { pending: opts.pending, rows_hidden: hb.rows_hidden },
    hours,
    coverage: reportCoverage({ counts, hours }, {
      version: 1, source: 'aggregates', truncated: counts.truncated, visitorsIncomplete: !!hb.visitorsIncomplete,
      unassignedHours,
      missingHours: hours.missing, truncatedHours: sorted.filter(a => a.truncated === true).map(a => a.hour),
      unadvancedHours: sorted.filter(a => a.ringsFolded === false).map(a => a.hour),
      unknownHours: sorted.filter(a => typeof a.ringsFolded !== 'boolean' || typeof a.truncated !== 'boolean').map(a => a.hour),
      horizons: sorted.map(a => ({ hour: a.hour, horizonMs: Number.isFinite(a.horizonMs) && a.horizonMs >= 0 ? a.horizonMs : null })),
    }),
  };
  finiteMerged({ counts: report.counts, policies, grids, exploration, holdout, erasures: report.erasures });
  rawReportJson(report); return report;
}

// ── against R2 ────────────────────────────────────────────────────────────────

export interface R2Agg extends R2Like { put(key: string, body: string, opts?: unknown): Promise<unknown> }

async function listKeys(r2: R2Like, prefix: string): Promise<string[]> {
  const keys: string[] = [], cursors = new Set<string>();
  let cursor: string | undefined, visited = 0;
  do {
    aggregateBound('work', ++visited);
    const page = await r2.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) { aggregateBound('work', ++visited); keys.push(o.key); }
    if (page.truncated && (!page.cursor || cursors.has(page.cursor))) throw new ReportInputError();
    cursor = page.truncated ? page.cursor : undefined;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return keys;
}

/** Where an object's name says it starts, so both streams read in time order under a cap; a name without one sorts last. */
const startOf = (key: string): string => /\/(?:decision|outcome)\/([0-9a-z]{9})-/.exec(key)?.[1] ?? '~';

/** The hour's ledger objects, one at a time and in time order, each decision reduced to what the fold keeps before the next object is opened; at most `cap` of them. */
export async function loadHourRecords(r2: R2Like, tenant: string, date: string, hour: number, cap = MAX_HOUR_OBJECTS): Promise<{ decisions: CompactDecision[]; outcomes: OutcomeRecord[]; objects: number; read: number; truncated: boolean; source: string; duplicates?: DuplicateWitness[] }> {
  const all = (await listKeys(r2, `${tenant}/${date}/${pad2(hour)}/`)).filter(isLearningKey).sort((a, b) => (startOf(a) < startOf(b) ? -1 : startOf(a) > startOf(b) ? 1 : a < b ? -1 : 1));
  const keys = all.slice(0, cap);
  const decisions: CompactDecision[] = [], outcomes: OutcomeRecord[] = [];
  const identity = new ReportRowIdentity(tenant), budget = { objects: 0, bytes: 0 };
  const contents: string[] = [];
  let lines = 0;
  for (const key of keys) {
    const stream = key.includes('/decision/') ? 'decision' : key.includes('/outcome/') ? 'outcome' : null;
    const obj = await r2.get(key);
    if (!obj) throw new ReportUnavailableError();
    const text = await rawText(obj, budget);
    contents.push(await fingerprint(text));
    if (!stream) continue;
    let offset = 0;
    while (offset < text.length) {
      aggregateBound('work', ++lines);
      const end = text.indexOf('\n', offset), line = text.slice(offset, end < 0 ? text.length : end); offset = end < 0 ? text.length : end + 1;
      if (!line) continue;
      let rec: unknown;
      try { rec = JSON.parse(line); } catch { throw new ReportInputError(); }
      if (!identity.admit(rec, stream)) continue;
      if (stream === 'decision') decisions.push(compactOf(rec as DecisionRecord)); else outcomes.push(rec as OutcomeRecord);
    }
  }
  const duplicates = identity.duplicates();
  return { decisions, outcomes, objects: all.length, read: keys.length, truncated: all.length > keys.length,
    source: await fingerprint(JSON.stringify([all, cap, contents])), ...(duplicates.length ? { duplicates } : {}) };
}

export interface BuildOptions { horizonMs?: number; ringCap?: number; shards?: number; maxObjects?: number }

interface PendingHour {
  version: 1 | 2;
  generation: string;
  tenant: string;
  date: string;
  hour: number;
  options: Required<BuildOptions>;
  basis: string;
  aggregate: string;
  aggregateEtag: string | null;
  states: Array<{ before: string | null; after: string | null }>;
  /** v2 is self-contained recovery, never rebuilt against changed raw rows. */
  targets?: Array<string | null>;
  configuration?: string;
}
interface StoredHourBody { body: string | null; etag: string | null }
interface CleanupHour {
  version: 1; tenant: string; generation: string; shards: number;
  states: Array<{ before: string | null; after: string | null }>;
  targets: Array<string | null>;
}
export class HourRecoveryConflict extends Error {
  constructor() { super('Hourly recovery conflict'); }
}
function recoveryConflict(): never { throw new HourRecoveryConflict(); }
const fingerprint = async (body: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', aggregateUtf8.encode(body))), b => b.toString(16).padStart(2, '0')).join('');
const bodyFingerprint = (body: string | null) => body === null ? null : fingerprint(body);
const hashShape = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const generationShape = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const etagShape = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
function buildOptions(opts: BuildOptions): Required<BuildOptions> {
  const values = { horizonMs: opts.horizonMs ?? DEFAULT_HORIZON_MS, ringCap: opts.ringCap ?? RING_CAP,
    shards: opts.shards ?? SHARDS, maxObjects: opts.maxObjects ?? MAX_HOUR_OBJECTS };
  if (!Number.isSafeInteger(values.horizonMs) || values.horizonMs < 0 || values.horizonMs > Number.MAX_SAFE_INTEGER - HOUR_MS
    || !Number.isSafeInteger(values.ringCap) || values.ringCap < 1 || values.ringCap > REPORT_LIMITS.work
    || !Number.isSafeInteger(values.shards) || values.shards < 1 || values.shards > SHARDS
    || !Number.isSafeInteger(values.maxObjects) || values.maxObjects < 0 || values.maxObjects > REPORT_LIMITS.work) throw new ReportInputError();
  return values;
}
/** Stable effective configuration identity; raw source identity separately includes every physical byte. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => objectMap(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
}
async function readHourBody(r2: R2Like, key: string, budget = { bytes: 0, cells: 0 }): Promise<StoredHourBody> {
  const raw = await r2.get(key);
  if (raw === null) return { body: null, etag: null };
  if (!raw || typeof raw.text !== 'function') throw new Error('Hourly shard unavailable');
  if (!etagShape(raw.etag)) recoveryConflict();
  return { body: await storedReportText(raw, budget, 'aggregateBytes', 'aggregateBytes'), etag: raw.etag };
}
function shardState(body: string | null, shard: number): ShardState {
  const state: ShardState = body === null ? emptyShard(shard) : JSON.parse(body) as ShardState;
  if (!objectMap(state) || (state.version !== 1 && state.version !== 2) || state.shard !== shard || !Number.isSafeInteger(state.through) || state.through < -1
    || !objectMap(state.rings) || (state.generation !== undefined && !generationShape(state.generation))
    || (shard !== 0 && (state.pending !== undefined || state.cleanup !== undefined))
    || (state.pending !== undefined && state.cleanup !== undefined)) throw new ReportInputError();
  checkSeen(state);
  return state;
}
function pendingHour(state: ShardState, tenant: string): PendingHour | undefined {
  if (!Object.hasOwn(state, 'pending')) return undefined;
  const p = state.pending;
  if (!objectMap(p) || ![1, 2].includes(p.version) || p.tenant !== tenant || !generationShape(p.generation) || state.generation !== p.generation
    || !objectMap(p.options) || Object.keys(p.options).length !== 4 || !hashShape(p.basis) || typeof p.aggregate !== 'string'
    || (p.aggregateEtag !== null && !etagShape(p.aggregateEtag)) || !Array.isArray(p.states)) recoveryConflict();
  try {
    validateReportIds({ tenant, brand: tenant, date: p.date });
    if (!Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23 || stableJson(buildOptions(p.options)) !== stableJson(p.options)
      || p.states.length !== p.options.shards) recoveryConflict();
    for (let s = 0; s < p.states.length; s++) {
      const pair = p.states[s];
      if (!Object.hasOwn(p.states, s) || !objectMap(pair) || Object.keys(pair).length !== 2
        || (pair.before !== null && !hashShape(pair.before)) || (pair.after !== null && !hashShape(pair.after))) recoveryConflict();
    }
    if (!hashShape(p.states[0]!.after)) recoveryConflict();
    if (p.version === 1 && (p.targets !== undefined || p.configuration !== undefined)) recoveryConflict();
    if (p.version === 2 && (!hashShape(p.configuration) || !Array.isArray(p.targets) || p.targets.length !== p.states.length
      || p.targets.some(value => value !== null && typeof value !== 'string'))) recoveryConflict();
    aggregateBound('aggregateBytes', aggregateBytes(p.aggregate));
  } catch (error) { if (error instanceof ReportBudgetExceeded) throw error; recoveryConflict(); }
  return p;
}
/** Numeric validation also applies when computation:null deliberately withholds day publication. */
function preparedAggregate(body: string, tenant: string, at: { date: string; hour: number }, options: Required<BuildOptions>, learn: LearnConfig): HourAggregate {
  aggregateBound('aggregateBytes', aggregateBytes(body));
  const a: HourAggregate = JSON.parse(body) as HourAggregate;
  aggregateIdentity(a, { tenant, date: at.date }, at.hour);
  if (!Number.isSafeInteger(a.builtAt) || a.builtAt < 0 || !Number.isFinite(new Date(a.builtAt).getTime())
    || !Number.isSafeInteger(a.objects) || a.objects < 0 || a.objects > REPORT_LIMITS.work
    || !Number.isSafeInteger(a.objectsRead) || a.objectsRead < 0 || a.objectsRead > a.objects || a.objectsRead > options.maxObjects
    || a.truncated !== (a.objects > a.objectsRead) || typeof a.ringsFolded !== 'boolean'
    || a.shards !== options.shards || a.horizonMs !== options.horizonMs) unavailable();
  admitHours([a], { tenant, brand: tenant, date: at.date });
  for (const [brand, b] of Object.entries(a.brands)) {
    if (b.visitorsIncomplete !== undefined && b.visitorsIncomplete !== true) unavailable();
    if (b.computation === null) continue;
    const recorded = recordedComputation(b.computation);
    if (!recorded || recorded.version !== 4 || recorded.profile.ringCap !== options.ringCap) unavailable();
    compatibleHours([a], brand, learn);
  }
  return a;
}
/** An uncertain conditional put can acknowledge only exact intended bytes, never an unconditional retry. */
async function conditionalBody(r2: R2Agg, key: string, body: string, etag: string | null): Promise<string> {
  let failure: unknown;
  try {
    const written = await r2.put(key, body, { onlyIf: etag === null ? { etagDoesNotMatch: '*' } : { etagMatches: etag },
      httpMetadata: { contentType: 'application/json' } });
    if (objectMap(written) && etagShape(written.etag)) return written.etag;
  } catch (error) { failure = error; }
  const observed = await readHourBody(r2, key);
  if (observed.body === body && observed.etag !== null) return observed.etag;
  if (failure) throw failure;
  return recoveryConflict();
}

async function finishHour(r2: R2Agg, tenant: string, coordinator: StoredHourBody, completed: string, p: PendingHour,
  states: StoredHourBody[], staged: Array<string | null>, aggregate: StoredHourBody): Promise<void> {
  // Another helper may already have completed this generation. Its unchanged nonce proves only that generation.
  const active = await readHourBody(r2, shardKey(tenant, 0));
  if (active.body === completed) return;
  if (active.body !== coordinator.body || active.etag !== coordinator.etag) recoveryConflict();
  for (let s = 1; s < states.length; s++) {
    const body = staged[s]!;
    if (body !== states[s]!.body && body !== null) await conditionalBody(r2, shardKey(tenant, s), body, states[s]!.etag);
  }
  // Guard even zero-write and explicit historical recomputations against a newer coordinator.
  const beforePublish = await readHourBody(r2, shardKey(tenant, 0));
  if (beforePublish.body === completed) return;
  if (beforePublish.body !== coordinator.body || beforePublish.etag !== coordinator.etag) recoveryConflict();
  if (aggregate.body !== p.aggregate) await conditionalBody(r2, hourKey(tenant, p.date, p.hour), p.aggregate, p.aggregateEtag);
  if (p.version === 2) await cleanupHourlyState(r2, tenant, states.length, Date.now(), { coordinator, completed });
  else await conditionalBody(r2, shardKey(tenant, 0), completed, coordinator.etag);
}

/** Validate the selected physical owner before deletion can hide a conflicting row. */
function cleanupOwnership(state: ShardState, tenant: string): void {
  checkSeen(state);
  if (!objectMap(state.rings)) throw new ReportInputError();
  let work = 0;
  for (const [visitor, ring] of Object.entries(state.rings)) {
    if (!Array.isArray(ring)) throw new ReportInputError();
    for (const entry of ring) {
      aggregateBound('work', ++work);
      if (!objectMap(entry) || typeof entry.id !== 'string' || !entry.id || typeof entry.ts !== 'number' || !Number.isFinite(entry.ts)
        || (Object.hasOwn(entry, 'tenant') && entry.tenant !== tenant)
        || (Object.hasOwn(entry, 'visitor_id') && entry.visitor_id !== visitor)) throw new ReportInputError();
      const carrier = parseId(entry.id);
      if (carrier && (carrier.tenant !== tenant || entry.id.split(':')[2] !== visitor)) throw new ReportInputError();
      if (entry.retention?.hourly !== undefined) readRetention(entry.retention.hourly, tenant, 'hourly');
    }
  }
  for (const values of Object.values(state.seenRetention ?? {})) for (const stamp of Object.values(values)) readRetention(stamp, tenant, 'hourly');
}

/** Physical erasure/expiry only: no fold, date rewind, attribution or counters. */
function cleanupShard(state: ShardState, tenant: string, tombs: ReadonlyMap<string, Tombstone>, now: number): ShardState {
  cleanupOwnership(state, tenant);
  const next = JSON.parse(JSON.stringify(state)) as ShardState;
  delete next.pending; delete next.cleanup;
  for (const [visitor, ring] of Object.entries(next.rings)) {
    const cutoff = tombs.get(visitor)?.erased_at;
    const kept = ring.filter(entry => (cutoff === undefined || entry.ts > cutoff)
      && (entry.retention?.hourly === undefined || readRetention(entry.retention.hourly, tenant, 'hourly').expiresAt > now));
    if (kept.length) next.rings[visitor] = kept; else delete next.rings[visitor];
  }
  for (const [brand, ids] of Object.entries(next.seen)) {
    const kept: string[] = [];
    for (const visitor of ids) {
      const cutoff = tombs.get(visitor)?.erased_at;
      const stamp = next.seenRetention?.[brand]?.[visitor];
      if (stamp && readRetention(stamp, tenant, 'hourly').expiresAt <= now) {
        if (next.seenAt?.[brand]) delete next.seenAt[brand]![visitor];
        delete next.seenRetention![brand]![visitor];
        continue;
      }
      if (cutoff === undefined) { kept.push(visitor); continue; }
      let latest = next.seenAt?.[brand]?.[visitor];
      for (const entry of next.rings[visitor] ?? []) if (entry.brand === brand && onDate(entry.ts, next.seenDate) && entry.ts > cutoff) {
        if (latest === undefined) (next.seenIncomplete ??= {})[brand] = true;
        latest = Math.max(latest ?? entry.ts, entry.ts);
      }
      if (latest !== undefined && latest > cutoff) {
        kept.push(visitor); ((next.seenAt ??= {})[brand] ??= {})[visitor] = latest;
      } else {
        if (latest === undefined) (next.seenIncomplete ??= {})[brand] = true;
        if (next.seenAt?.[brand]) delete next.seenAt[brand]![visitor];
        if (next.seenRetention?.[brand]) delete next.seenRetention[brand]![visitor];
      }
    }
    next.seen[brand] = kept;
    if (!kept.length && next.seenAt) delete next.seenAt[brand];
  }
  // W22 R1.02: the other dates' membership is ids and nothing else, so an
  // erased visitor simply leaves it — there is no witness there that could show
  // a decision after the erasure, and keeping her would be keeping an id the
  // tenant asked to be forgotten.
  for (const [date, brands] of Object.entries(next.seenDays ?? {})) {
    for (const [brand, ids] of Object.entries(brands)) brands[brand] = ids.filter(visitor => !tombs.has(visitor));
    if (!Object.keys(brands).length) delete next.seenDays![date];
  }
  if (next.seenDays && !Object.keys(next.seenDays).length) delete next.seenDays;
  // Orphan metadata is never used to recreate membership. Remove only its own
  // expired instruction or a cutoff-covered witness, preserving later evidence.
  for (const [brand, values] of Object.entries(next.seenRetention ?? {})) {
    for (const [visitor, stamp] of Object.entries(values)) {
      if (next.seen[brand]?.includes(visitor)) continue;
      const cutoff = tombs.get(visitor)?.erased_at;
      const later = (next.seenAt?.[brand]?.[visitor] ?? -Infinity) > (cutoff ?? Infinity)
        || (next.rings[visitor] ?? []).some(entry => entry.brand === brand && onDate(entry.ts, next.seenDate) && entry.ts > (cutoff ?? Infinity));
      if (stamp.expiresAt <= now || (cutoff !== undefined && stamp.bornAt <= cutoff && !later)) delete values[visitor];
    }
    if (!Object.keys(values).length) delete next.seenRetention![brand];
  }
  if (next.seenRetention && !Object.keys(next.seenRetention).length) delete next.seenRetention;
  // W21 C1.08: the per-assignment memory holds no id the membership does not,
  // so erasure and expiry reach it through the same pass that just ran.
  pruneEnrollment(next);
  checkSeen(next); return next;
}

/** Shard-zero CAS owns the whole cleanup generation, including quiet hours.
 * Prepared numerical credits finish first; no recovery debt is deleted here. */
export async function cleanupHourlyState(r2: R2Agg, tenant: string, shards = SHARDS, now = Date.now(), finish?: { coordinator: StoredHourBody; completed: string }): Promise<void> {
  const budget = { bytes: 0, cells: 0 }, original = finish?.coordinator ?? await readHourBody(r2, shardKey(tenant, 0), budget);
  const first = shardState(original.body, 0);
  if (!finish && first.pending) return;
  let plan = first.cleanup, coordinator = original;
  const states: StoredHourBody[] = [original];
  if (plan) {
    if (plan.version !== 1 || plan.tenant !== tenant || !generationShape(plan.generation) || first.generation !== plan.generation
      || !Number.isSafeInteger(plan.shards) || plan.shards < 1 || plan.shards > SHARDS || !Array.isArray(plan.states)
      || !Array.isArray(plan.targets) || plan.states.length !== plan.shards || plan.targets.length !== plan.shards) recoveryConflict();
    shards = plan.shards;
  }
  for (let s = 1; s < shards; s++) states.push(await readHourBody(r2, shardKey(tenant, s), budget));
  for (let s = 0; s < shards; s++) cleanupOwnership(shardState(states[s]!.body, s), tenant);
  if (!plan) {
    const tombs = await loadTombstones(r2, tenant), generation = crypto.randomUUID();
    const targets: Array<string | null> = [], pairs: CleanupHour['states'] = [];
    let changed = false;
    for (let s = 0; s < shards; s++) {
      const before = s === 0 && finish ? finish.completed : states[s]!.body;
      const base = shardState(before, s), cleaned = cleanupShard(base, tenant, tombs, now);
      const differs = JSON.stringify(cleaned) !== JSON.stringify(base);
      changed ||= differs;
      if (differs || s === 0) cleaned.generation = generation;
      const target = differs || s === 0 ? JSON.stringify(cleaned) : before;
      targets.push(target); pairs.push({ before: await bodyFingerprint(before), after: await bodyFingerprint(target) });
    }
    if (!changed) { if (finish) await conditionalBody(r2, shardKey(tenant, 0), finish.completed, original.etag); return; }
    plan = { version: 1, tenant, generation, shards, states: pairs, targets };
    const prepared = JSON.stringify({ ...shardState(targets[0]!, 0), cleanup: plan });
    aggregateBound('aggregateBytes', aggregateBytes(prepared) + states.slice(1).reduce((sum, current, i) => sum
      + Math.max(current.body === null ? 0 : aggregateBytes(current.body), targets[i + 1] === null ? 0 : aggregateBytes(targets[i + 1]!)), 0));
    coordinator = { body: prepared, etag: await conditionalBody(r2, shardKey(tenant, 0), prepared, original.etag) };
    states[0] = coordinator;
  }
  let mixture = aggregateBytes(coordinator.body!);
  for (let s = 0; s < shards; s++) {
    const pair = plan.states[s]!, target = plan.targets[s]!;
    if (!pair || (pair.before !== null && !hashShape(pair.before)) || (pair.after !== null && !hashShape(pair.after))
      || (target !== null && typeof target !== 'string') || await bodyFingerprint(target) !== pair.after) recoveryConflict();
    if (target !== null) { const state = shardState(target, s); cleanupOwnership(state, tenant); if (state.pending || state.cleanup) recoveryConflict(); }
    let before = states[s]!.body;
    cleanupOwnership(shardState(before, s), tenant);
    if (s === 0) { const state = shardState(before, 0); delete state.cleanup; before = JSON.stringify(state); }
    const hash = await bodyFingerprint(before);
    if (hash !== pair.before && hash !== pair.after) recoveryConflict();
    if (s) mixture += Math.max(states[s]!.body === null ? 0 : aggregateBytes(states[s]!.body!), target === null ? 0 : aggregateBytes(target));
  }
  aggregateBound('aggregateBytes', mixture);
  for (let s = 1; s < shards; s++) if (plan.targets[s] !== states[s]!.body && plan.targets[s] !== null)
    await conditionalBody(r2, shardKey(tenant, s), plan.targets[s]!, states[s]!.etag);
  const current = await readHourBody(r2, shardKey(tenant, 0));
  if (current.body === plan.targets[0]) return;
  if (current.body !== coordinator.body || current.etag !== coordinator.etag || plan.targets[0] === null) recoveryConflict();
  await conditionalBody(r2, shardKey(tenant, 0), plan.targets[0]!, coordinator.etag);
}

/** One hour, folded: its ledger objects read once, every shard visited, the aggregate written. Re-running an hour never doubles it. */
export async function buildHour(r2: R2Agg, tenant: string, at: { date: string; hour: number }, learn: LearnConfig, now = Date.now(), opts: BuildOptions = {}, retentionEnv?: RetentionEnv): Promise<HourAggregate> {
  validateReportIds({ tenant, brand: tenant, date: at.date });
  if (!Number.isInteger(at.hour) || at.hour < 0 || at.hour > 23 || !Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) throw new ReportInputError();
  const from = hourStart(at.date, at.hour), to = from + HOUR_MS;
  const options = buildOptions(opts), { shards, horizonMs, ringCap } = options;
  await cleanupHourlyState(r2, tenant, shards, now);
  const statsCfg: StatsConfig = learn.stats ?? DEFAULT_STATS, slotCfg = slotConfigsOf(learn), policies = policiesOf(learn);
  // Reject invalid new provenance prerequisites before any shard write.
  computationBasis(learn, policies.map(p => ({ name: p.name, role: p.role, policy: p })), [], { source: 'hourly-ring', horizonMs, ringCap });
  if (!Number.isFinite(statsCfg.tauLearnMs) || statsCfg.tauLearnMs <= 0) unavailable();
  for (const cfg of Object.values(slotCfg)) if (!['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom'].includes(cfg.reward)
    || !['unit', 'revenue', 'margin'].includes(cfg.objective ?? 'unit')) unavailable();
  const loadedBudget = { bytes: 0, cells: 0 };
  const coordinator = await readHourBody(r2, shardKey(tenant, 0), loadedBudget), first = shardState(coordinator.body, 0);
  const pending = pendingHour(first, tenant);
  if (pending && (pending.date !== at.date || pending.hour !== at.hour || stableJson(pending.options) !== stableJson(options))) recoveryConflict();
  const configuration = await fingerprint(stableJson([tenant, at.date, at.hour, options, policies, statsCfg, slotCfg]));
  if (pending?.version === 2) {
    if (pending.configuration !== configuration) recoveryConflict();
    const states = [coordinator];
    for (let s = 1; s < shards; s++) states.push(await readHourBody(r2, shardKey(tenant, s), loadedBudget));
    const targets = pending.targets!, completed = targets[0];
    if (completed === null) recoveryConflict();
    let mixture = aggregateBytes(coordinator.body!);
    for (let s = 0; s < shards; s++) {
      const target = targets[s]!, expected = pending.states[s]!;
      if (target !== null) {
        const parsed = shardState(target, s);
        cleanupOwnership(parsed, tenant);
        if (parsed.pending !== undefined) recoveryConflict();
      }
      if (await bodyFingerprint(target) !== expected.after) recoveryConflict();
      let current = states[s]!.body;
      cleanupOwnership(shardState(current, s), tenant);
      if (s === 0) { const value = shardState(current, 0); delete value.pending; current = JSON.stringify(value); }
      const currentHash = await bodyFingerprint(current);
      if (currentHash !== expected.before && currentHash !== expected.after) recoveryConflict();
      if (s > 0) mixture += Math.max(states[s]!.body === null ? 0 : aggregateBytes(states[s]!.body!), target === null ? 0 : aggregateBytes(target));
    }
    aggregateBound('aggregateBytes', mixture);
    const aggregate = await readHourBody(r2, hourKey(tenant, at.date, at.hour));
    if (aggregate.body !== pending.aggregate && aggregate.etag !== pending.aggregateEtag) recoveryConflict();
    const cached = preparedAggregate(pending.aggregate, tenant, at, options, learn);
    if (cached.generation !== pending.generation) recoveryConflict();
    await finishHour(r2, tenant, coordinator, completed, pending, states, targets, aggregate);
    return cached;
  }
  const [loaded, tombs] = await Promise.all([loadHourRecords(r2, tenant, at.date, at.hour, options.maxObjects), loadTombstones(r2, tenant)]);
  const suppression = [...tombs].map(([visitor, tomb]) => [visitor, tomb.erased_at] as const).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  finiteMerged([statsCfg, slotCfg, suppression]);
  const basis = await fingerprint(stableJson([tenant, at.date, at.hour, options, policies, statsCfg, slotCfg, loaded.source, suppression]));
  if (pending && pending.basis !== basis) recoveryConflict();
  const states: StoredHourBody[] = [coordinator];
  for (let s = 1; s < shards; s++) states.push(await readHourBody(r2, shardKey(tenant, s), loadedBudget));
  const aggregate = await readHourBody(r2, hourKey(tenant, at.date, at.hour));
  let cached: HourAggregate | undefined;
  if (pending) {
    cached = preparedAggregate(pending.aggregate, tenant, at, options, learn);
    if (cached.generation !== pending.generation || cached.objects !== loaded.objects || cached.objectsRead !== loaded.read
      || (aggregate.body !== pending.aggregate && aggregate.etag !== pending.aggregateEtag)) recoveryConflict();
  }
  const decisions = withoutErased(loaded.decisions, tombs).filter(d => (d.entry.measurementBasis ?? 'served-v1') === (slotCfg[d.entry.slot]?.measurementBasis ?? 'served-v1')), outcomes = withoutErased(loaded.outcomes, tombs);
  const admittedRetention: RetentionStamp[] = [];
  if (retentionEnv && !pending) {
    for (const record of [...decisions.map(row => row.entry), ...outcomes]) {
      admittedRetention.push(requireRetention(retentionEnv, record.retention?.ledger, tenant, 'ledger'));
      admittedRetention.push(requireRetention(retentionEnv, record.retention?.hourly, tenant, 'hourly'));
    }
    // Untagged cumulative history cannot be mixed into a newly expirable shard.
    for (let shard = 0; shard < states.length; shard++) {
      const state = shardState(states[shard]!.body, shard);
      for (const ring of Object.values(state.rings)) for (const row of ring) admittedRetention.push(requireRetention(retentionEnv, row.retention?.hourly, tenant, 'hourly'));
      for (const [brand, ids] of Object.entries(state.seen)) for (const visitor of ids)
        admittedRetention.push(requireRetention(retentionEnv, state.seenRetention?.[brand]?.[visitor], tenant, 'hourly'));
    }
  }
  const brands = foldDecisions(decisions, policies, statsCfg);
  for (const duplicate of loaded.duplicates ?? []) if (!hidden(tombs, duplicate)) {
    const counts = (brands[duplicate.brand] ??= emptyBrand()).duplicates ??= { decisions: 0, outcomes: 0 };
    counts[duplicate.stream === 'decision' ? 'decisions' : 'outcomes'] += duplicate.count;
  }
  for (const o of outcomes) (brands[o.brand] ??= emptyBrand()).outcomes += 1;
  if (tombs.size) {
    for (const d of loaded.decisions) if (hidden(tombs, d)) (brands[d.entry.brand] ??= emptyBrand()).rows_hidden += 1;
    for (const o of loaded.outcomes) if (hidden(tombs, o)) (brands[o.brand] ??= emptyBrand()).rows_hidden += 1;
  }
  for (const hb of Object.values(brands)) for (const p of policies) policyHour(hb, p);
  const byShardD = new Map<number, CompactDecision[]>(), byShardO = new Map<number, OutcomeRecord[]>();
  for (const d of decisions) { const s = shardOf(d.visitor_id, shards); const list = byShardD.get(s) ?? []; list.push(d); byShardD.set(s, list); }
  for (const o of outcomes) { const s = shardOf(o.visitor_id, shards); const list = byShardO.get(s) ?? []; list.push(o); byShardO.set(s, list); }
  const creditedSlots = new Map<string, Set<string>>();
  // W22 R1.02 (F17 P1): this hour has an aggregate and the hour's prefix now
  // holds MORE objects than that fold read, so it is being rebuilt against rows
  // it has not seen and those rows may still join the rings. A rebuild of an
  // unchanged hour admits nothing, exactly as a replay always did.
  let refold = false;
  if (!pending && aggregate.body !== null) {
    try {
      const previous: unknown = JSON.parse(aggregate.body);
      refold = objectMap(previous) && Number.isSafeInteger(previous.objects) && loaded.objects > (previous.objects as number);
    } catch { refold = false; }
  }
  const ctx: FoldContext = { tenant, date: at.date, from, to, now, refold, policies, slotCfg, statsCfg, horizonMs, ringCap, tombs, brands, creditedSlots,
    retainedIds: new Set(), retainedBudget: { work: 0, bytes: 0 }, incomingIds: new Set(decisions.map(d => d.entry.id)) };
  let ringsFolded = true;
  /** W21 C1.08: brands whose date membership this fold could not account for assignment by assignment. */
  const unaccounted = new Set<string>();
  const generation = pending?.generation ?? crypto.randomUUID();
  const staged: Array<string | null> = [], fingerprints: PendingHour['states'] = [];
  let stagedBytes = 0;
  for (let s = 0; s < shards; s++) {
    const original = states[s]!.body;
    const state = shardState(original, s);
    let current = original;
    if (pending && s === 0) { delete state.pending; current = JSON.stringify(state); }
    const beforeHash = await bodyFingerprint(current);
    if (pending) {
      const pair = pending.states[s]!;
      if (beforeHash === pair.after) {
        staged.push(current); aggregateBound('aggregateBytes', stagedBytes += current === null ? 0 : aggregateBytes(current));
        continue;
      }
      if (s === 0 || beforeHash !== pair.before) recoveryConflict();
    }
    const r = foldShard(state, byShardD.get(s) ?? [], byShardO.get(s) ?? [], ctx);
    if (!r.folded) ringsFolded = false;
    // W22 R1.02: the day this hour belongs to, which for a repaired older hour
    // is its own date's membership and not the newer one the shard has moved on
    // to. The per-brand uncertainty flag belongs to the current date, which is
    // the only date that carries the witnesses it is derived from.
    for (const [brand, ids] of Object.entries(seenOn(r.state, at.date))) {
      const hb = (brands[brand] ??= emptyBrand());
      hb.visitorsDay += ids.length;
      // W21 C1.08: the same membership, split by ASSIGNMENT. A shard that cannot
      // account for every id it just counted — a state written before this
      // release holds the ids and not the assignments — makes the whole brand's
      // hour unable to say, because a denominator drawn from part of a
      // membership is a wrong number, not a smaller one.
      const record = r.state.enrollment?.[at.date]?.[brand] ?? {};
      if (ids.some(visitor => !record[visitor]?.arms.length)) { unaccounted.add(brand); continue; }
      const ha = (hb.assignments ??= emptyAssignments());
      for (const visitor of ids) {
        const enrolled = record[visitor]!;
        for (const arm of enrolled.arms) ha.visitors[arm] = (ha.visitors[arm] ?? 0) + 1;
        for (const [arm, types] of Object.entries(enrolled.outcomes ?? {})) {
          const byType = (ha.outcomes[arm] ??= {});
          for (const type of types) byType[type] = (byType[type] ?? 0) + 1;
        }
      }
    }
    if (r.state.seenDate === at.date) for (const brand of Object.keys(r.state.seenIncomplete ?? {})) (brands[brand] ??= emptyBrand()).visitorsIncomplete = true;
    // Preserve the established no-change through/seen body. Changed bodies get a
    // nonce too: a later replay must never recreate an old conditional-write ETag.
    let body = original;
    if (r.changed || s === 0) {
      const next = r.changed ? r.state : shardState(original, s);
      next.generation = generation; delete next.pending; body = JSON.stringify(next);
    }
    aggregateBound('aggregateBytes', stagedBytes += body === null ? 0 : aggregateBytes(body));
    const afterHash = await bodyFingerprint(body);
    if (pending && afterHash !== pending.states[s]!.after) recoveryConflict();
    staged.push(body); fingerprints.push({ before: beforeHash, after: afterHash });
  }
  if (pending) {
    await finishHour(r2, tenant, coordinator, staged[0]!, pending, states, staged, aggregate);
    return cached!;
  }
  for (const [brand, b] of Object.entries(brands)) {
    for (const p of policies) policyHour(b, p);
    // W21 C1.08: the hour says what the assignment was, or it says nothing at
    // all. An hour with no decisions still says so — its empty answer is the
    // truth — and one whose membership this fold could not account for withdraws
    // the member entirely, which is what `coverage.unassignedHours` then names.
    if (unaccounted.has(brand)) delete b.assignments; else b.assignments ??= emptyAssignments();
    try {
      b.computation = computationBasis(learn,
        Object.entries(b.policies).map(([name, p]) => ({ name, role: p.role, policy: p.policy })),
        [...Object.keys(b.arms), ...Object.keys(b.exploration), ...Object.values(b.policies).flatMap(p => Object.keys(p.stats)), ...(creditedSlots.get(brand) ?? [])],
        { source: 'hourly-ring', horizonMs, ringCap });
    } catch (error) {
      // Preserve numeric data with explicitly unknown metadata; day construction refuses it.
      if (!(error instanceof ReportInputError) && !(error instanceof ReportBudgetExceeded && error.budget === 'summaryBytes')) throw error;
      b.computation = null;
    }
  }
  const agg: HourAggregate = { version: 1, generation, tenant, date: at.date, hour: at.hour, from, to, builtAt: now, objects: loaded.objects, objectsRead: loaded.read, truncated: loaded.truncated, horizonMs, shards, ringsFolded, brands };
  const body = JSON.stringify(agg);
  preparedAggregate(body, tenant, at, options, learn);
  const plan: PendingHour = { version: 2, generation, tenant, date: at.date, hour: at.hour, options, basis, configuration,
    aggregate: body, aggregateEtag: aggregate.etag, states: fingerprints, targets: staged };
  const completed = staged[0]!;
  const prepared = JSON.stringify({ ...shardState(completed, 0), pending: plan });
  aggregateBound('aggregateBytes', aggregateBytes(prepared));
  // Every possible partially written mixture must remain loadable on restart.
  aggregateBound('aggregateBytes', aggregateBytes(prepared) + states.slice(1).reduce((n, state, i) => n
    + Math.max(state.body === null ? 0 : aggregateBytes(state.body), staged[i + 1] === null ? 0 : aggregateBytes(staged[i + 1]!)), 0));
  if (retentionEnv) for (const stamp of admittedRetention) requireRetention(retentionEnv, stamp, tenant, stamp.category);
  const etag = await conditionalBody(r2, shardKey(tenant, 0), prepared, coordinator.etag);
  await finishHour(r2, tenant, { body: prepared, etag }, completed, plan, states, staged, aggregate);
  return agg;
}

/** The hours that have ended, plus the grace, inside the lookback: oldest first. Pure. */
export function closedHours(now: number, lookbackHours = 26, graceMs = CLOSE_GRACE_MS): Array<{ date: string; hour: number; from: number }> {
  const out: Array<{ date: string; hour: number; from: number }> = [];
  const current = Math.floor(now / HOUR_MS) * HOUR_MS;
  for (let k = lookbackHours; k >= 1; k--) {
    const from = current - k * HOUR_MS;
    if (from + HOUR_MS + graceMs > now) continue;
    const h = hourOf(from);
    out.push({ date: h.date, hour: h.hour, from });
  }
  return out;
}

export interface CatchUpResult {
  built: Array<{ date: string; hour: number; decisions: number; outcomes: number; objects: number; truncated: boolean }>;
  /** Hours refused this run, including known older dates skipped without I/O; they remain pending. */
  failed: Array<{ date: string; hour: number; error: string }>;
  /** Missing hours plus an interrupted transaction counted once; publication failures are separate. */
  pending: number;
  reports: { published: string[]; failed: Array<{ date: string; error: string }>; deferred: string[] };
}

/**
 * W22 R1.02 (F17 P1, §6 item 1): an hour that HAS an aggregate but whose
 * aggregate no longer describes it. Two ways that happens, and the cost is one
 * listing of the hour's own prefix and one point read of its aggregate:
 *
 *  · the hour's ledger prefix has grown since the fold — a record delivered
 *    late, into an hour already folded, which today "is durably in R2, is never
 *    read again, and is counted nowhere". `HourAggregate` already stores the
 *    object count the fold read, so the comparison needs nothing new, and it
 *    converges: the rebuild writes the count it has just seen.
 *  · an EARLIER hour was folded after this one was built, so this hour's
 *    attribution ran against rings that have since changed (F17 P3b). No new
 *    state records that: an aggregate already carries `builtAt`, and the hours
 *    of the lookback are read oldest first, so an earlier hour with a later
 *    `builtAt` — or one this very run has just folded — is the whole test. It
 *    converges, because a rebuild stamps this hour with the newest time of all.
 *
 * A read that fails answers "not stale": the hour already has an aggregate, and
 * postponing a rebuild to the next run is the harmless direction.
 */
async function staleHour(r2: R2Agg, tenant: string, which: { date: string; hour: number },
  builtAt: Map<number, number>, earlierBuiltInRun: boolean): Promise<boolean> {
  const at = { ...which, from: hourStart(which.date, which.hour) };
  let objects: number, mine: number;
  try {
    objects = (await listKeys(r2, `${tenant}/${at.date}/${pad2(at.hour)}/`)).filter(isLearningKey).length;
    const stored = await readHourBody(r2, hourKey(tenant, at.date, at.hour));
    if (stored.body === null) return false;
    const agg: unknown = JSON.parse(stored.body);
    if (!objectMap(agg) || !Number.isSafeInteger(agg.objects) || !Number.isSafeInteger(agg.builtAt)) return false;
    mine = agg.builtAt as number;
    builtAt.set(at.from, mine);
    if (objects > (agg.objects as number)) return true;
  } catch { return false; }
  return earlierBuiltInRun || [...builtAt].some(([from, when]) => from < at.from && when > mine);
}

/** A saved summary proves only exact known hour membership, not content or policy freshness. */
function hasReportedHours(report: DayReport | null, expected: ReadonlySet<number>): boolean {
  const hours = report?.hours;
  if (hours?.source !== 'aggregates' || !Array.isArray(hours.built) || hours.built.length > 24 || hours.built.length !== expected.size) return false;
  const seen = new Set<number>();
  for (let i = 0; i < hours.built.length; i++) {
    const h = hours.built[i];
    if (!Object.hasOwn(hours.built, i) || typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23 || seen.has(h) || !expected.has(h)) return false;
    seen.add(h);
  }
  return true;
}

/**
 * What the five-minute job calls: fold the closed hours that have no aggregate yet, oldest first, as
 * many as the run's budget allows, then recover publication for up to three aggregate-backed dates
 * in the lookback. Pending shard-zero work runs first, even outside that lookback or after an
 * aggregate acknowledgement was lost. An unresolved transaction stops newer folds. Failures before
 * a transaction preserve the existing bounded skip behavior; day publication retries separately.
 */
export async function catchUp(r2: R2Agg, tenant: string, learn: LearnConfig, now = Date.now(), opts: BuildOptions & { maxHours?: number; lookbackHours?: number; budget?: number } = {}, retentionEnv?: RetentionEnv): Promise<CatchUpResult> {
  validateReportIds({ tenant, brand: tenant, date: hourOf(now).date });
  buildOptions(opts);
  await cleanupHourlyState(r2, tenant, opts.shards ?? SHARDS, now);
  for (const n of [opts.maxHours ?? 2, opts.lookbackHours ?? 26, opts.budget ?? RUN_BUDGET]) {
    if (!Number.isSafeInteger(n) || n < 0 || n > REPORT_LIMITS.work) throw new ReportInputError();
  }
  const coordinator = await readHourBody(r2, shardKey(tenant, 0));
  const interrupted = pendingHour(shardState(coordinator.body, 0), tenant);
  const candidates = closedHours(now, opts.lookbackHours ?? 26);
  const existing = new Set<string>();
  const dateHours = new Map<string, Set<number>>();
  for (const date of new Set(candidates.map((c) => c.date))) {
    const prefix = `aggregates/${tenant}/${date}/`, hours = new Set<number>();
    for (const k of await listKeys(r2, prefix)) {
      existing.add(k);
      const suffix = k.slice(prefix.length);
      if (k.startsWith(prefix) && /^(?:[01][0-9]|2[0-3])\.json$/.test(suffix)) hours.add(Number(suffix.slice(0, 2)));
    }
    dateHours.set(date, hours);
  }
  const missing = candidates.filter((c) => !existing.has(hourKey(tenant, c.date, c.hour)));
  const debt = new Set(missing.map(c => hourKey(tenant, c.date, c.hour)));
  if (interrupted) debt.add(hourKey(tenant, interrupted.date, interrupted.hour));
  // W22 R1.02: the hours that already have an aggregate are candidates too —
  // for a re-fold, not for a first one. They are taken after every missing
  // hour, they cost a listing and a point read each and only while the run has
  // budget for them, and a re-fold appears in `built` like any other hour: the
  // result keeps exactly the members it had.
  const settled = candidates.filter((c) => existing.has(hourKey(tenant, c.date, c.hour)));
  const builtAt = new Map<number, number>();
  const work = [...(interrupted ? [interrupted] : []), ...missing.filter(c => !interrupted || c.date !== interrupted.date || c.hour !== interrupted.hour),
    ...settled.filter(c => !interrupted || c.date !== interrupted.date || c.hour !== interrupted.hour)];
  // An interrupted hour is never a re-fold candidate: its transaction has to
  // finish, whatever its aggregate says.
  const rebuild = new Set(settled.filter(c => !interrupted || c.date !== interrupted.date || c.hour !== interrupted.hour)
    .map(c => hourKey(tenant, c.date, c.hour)));
  const built: CatchUpResult['built'] = [], failed: CatchUpResult['failed'] = [];
  let budget = opts.budget ?? RUN_BUDGET;
  let otherFailures = 0;
  for (const c of work) {
    if (built.length >= (opts.maxHours ?? 2) || budget <= 0) break;
    let spent = 0;
    const metered: R2Agg = {
      get: key => { spent++; return r2.get(key); },
      list: options => { spent++; return r2.list(options); },
      put: (key, body, options) => { spent++; return r2.put(key, body, options); },
    };
    try {
      // An hour that already has an aggregate is rebuilt only when that
      // aggregate no longer describes it; the probe is charged to this run's
      // budget like any other work, and a quiet catch-up writes nothing.
      if (rebuild.has(hourKey(tenant, c.date, c.hour))
        && !await staleHour(metered, tenant, c, builtAt, built.some(b => hourStart(b.date, b.hour) < hourStart(c.date, c.hour)))) continue;
      const agg = await buildHour(metered, tenant, c, learn, now, opts, retentionEnv);
      const sum = (k: 'decisions' | 'outcomes') => Object.values(agg.brands).reduce((n, b) => n + b[k], 0);
      built.push({ date: c.date, hour: c.hour, decisions: sum('decisions'), outcomes: sum('outcomes'), objects: agg.objects, truncated: agg.truncated });
      debt.delete(hourKey(tenant, c.date, c.hour));
      dateHours.get(c.date)?.add(c.hour);
    } catch (e) {
      // Charge every attempted failure; candidates ruled out by a known date above incur no I/O.
      // Keep the existing stop after two other failures, while a date refusal can reach current work.
      failed.push({ date: c.date, hour: c.hour, error: e instanceof Error ? e.message : String(e) });
      // A failed attempt may already have prepared durable work. Never advance newer
      // hours until its exact transaction completes; read failure also stops progress.
      let stillPending = false;
      try { stillPending = !!pendingHour(shardState((await readHourBody(metered, shardKey(tenant, 0))).body, 0), tenant); }
      catch { stillPending = true; }
      if (stillPending) break;
      if (++otherFailures >= 2) break;
    } finally {
      // Actual method calls include all shard/conditional/readback I/O; charge a
      // coordinator discovery per attempted hour conservatively. The existing
      // budget remains an admission boundary, not a bound on one started fold.
      budget -= spent + 1;
    }
  }
  // The default 26-hour lookback spans at most three dates. Longer custom windows explicitly defer
  // older dates; this bounds summary reads and aggregate publications without claiming backfill.
  const dates = [...dateHours.keys()].filter(date => dateHours.get(date)!.size).sort();
  const reports: CatchUpResult['reports'] = { published: [], failed: [], deferred: dates.slice(0, -3) };
  if (interrupted && !dateHours.has(interrupted.date)) reports.deferred.push(interrupted.date);
  const builtDates = new Set(built.map(b => b.date)), summaryBudget = { bytes: 0, cells: 0 };
  for (const date of dates.slice(-3)) {
    const ids = { tenant, brand: tenant, date };
    try {
      if (!builtDates.has(date) && hasReportedHours(await readWindowSummary(r2, ids, summaryBudget), dateHours.get(date)!)) continue;
      await publishAggregateDay(r2, ids, learn, now, true);
      reports.published.push(date);
    } catch { reports.failed.push({ date, error: 'day report publication failed' }); }
  }
  return { built, failed, pending: debt.size, reports };
}

/** The aggregates a date has, and the closed hours it lacks. */
export async function loadHours(r2: R2Like, tenant: string, date: string, now: number): Promise<{ aggs: HourAggregate[]; missing: number[] }> {
  validateReportIds({ tenant, brand: tenant, date });
  const aggs: HourAggregate[] = [];
  const prefix = `aggregates/${tenant}/${date}/`, keys: string[] = [];
  const cursors = new Set<string>(); let cursor: string | undefined, pages = 0;
  const budget = { bytes: 0, cells: 0 };
  try {
    do {
      aggregateBound('aggregateObjects', ++pages);
      const page = await r2.list({ prefix, cursor, limit: 25 });
      for (const { key } of page.objects) {
        aggregateBound('aggregateObjects', keys.length + 1);
        const suffix = key.slice(prefix.length);
        if (!key.startsWith(prefix) || !/^(?:[01][0-9]|2[0-3])\.json$/.test(suffix) || keys.includes(key)) unavailable();
        keys.push(key);
      }
      if (page.truncated && (!page.cursor || cursors.has(page.cursor))) unavailable();
      cursor = page.truncated ? page.cursor : undefined; if (cursor) cursors.add(cursor);
    } while (cursor);
    for (const key of keys.sort()) {
      const a: unknown = JSON.parse(await storedReportText(await r2.get(key), budget, 'aggregateBytes', 'aggregateBytes'));
      aggregateIdentity(a, { tenant, date }, Number(key.slice(prefix.length, -5))); aggs.push(a);
    }
  } catch (error) { throw error instanceof ReportBudgetExceeded ? error : new ReportUnavailableError(); }
  const have = new Set(aggs.map((a) => a.hour));
  const missing: number[] = [];
  for (let h = 0; h < 24; h++) if (hourStart(date, h) + HOUR_MS + CLOSE_GRACE_MS <= now && !have.has(h)) missing.push(h);
  return { aggs, missing };
}

export { ReportTooLarge } from './report';

/** Scheduler writes must acknowledge persistence and must never fall back to raw records. */
async function publishAggregateDay(r2: R2Agg, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, now: number, strict: boolean): Promise<DayReport | null> {
  const { aggs, missing } = await loadHours(r2, ids.tenant, ids.date, now);
  if (!aggs.length) { if (strict) unavailable(); return null; }
  const tombs = await loadTombstones(r2, ids.tenant);
  const report = reportFromHours(aggs, ids, learn, now, { pending: tombs.size, missing });
  const body = canonicalReportJson(report);
  try { await r2.put(reportKey(ids.tenant, ids.brand, ids.date), body, { httpMetadata: { contentType: 'application/json' } }); }
  catch (error) { if (strict) throw error; /* The public response still carries the computation. */ }
  return report;
}

/**
 * The day report: from the hour aggregates when the day has any and the built-in overlays will do;
 * from the ledger itself otherwise (a day from before the fold existed, or custom reporting policies,
 * which are computed over the records and so need a day one request can read).
 */
export async function runDayReport(r2: R2Agg, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, reporting: ReportPolicy[] | null, now = Date.now(), opts: { maxObjects?: number } = {}, retentionEnv?: RetentionEnv, resolved?: ResolvedConflicts): Promise<DayReport> {
  if (reporting === null) {
    const report = await publishAggregateDay(r2, ids, learn, now, false);
    if (report) return report;
  }
  if (opts.maxObjects !== undefined) {
    const n = await countDayObjects(r2, ids.tenant, ids.date, opts.maxObjects);
    if (n > opts.maxObjects) throw new ReportTooLarge(n, opts.maxObjects);
  }
  return runReport(r2, ids, learn, reporting, now, retentionEnv, resolved);
}
