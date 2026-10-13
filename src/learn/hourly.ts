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
import { hidden, loadTombstones, pendingPrefix, withoutErased, type Tombstone } from '@/ledger/erasure';
import { isLearningKey, parseId, ts36, type LedgerStream, type OutcomeRecord, type RewardType } from '@/ledger/records';
import { readConflictFiled } from '@/ledger/quarantine';
import type { Env } from '@/types/env';
import type { R2Like } from '@/ledger/writer';
import { readRetention, requireRetention, mergeRetention, RetentionUnavailable, type RetentionEnv, type RetentionStamp } from '@/retention';
import { effectiveScore, type ReflexEntry } from '@/reflex/core';
import { attribute, creditWeight, namedSlotOf, type AttributionPolicy, type RingEntry } from './policy';
import { positionHistoryKey, positionRowOf, ringEntryOf } from './fan';
import { attributionArm, canonicalPolicySet, canonicalReportJson, countDayObjects, dayProvenance, presetPolicies, publishedAllocation, readCanonicalSummary, readStoredDay, rebuildLedgerDay, reportKey, reportCoverage, REPORT_MEASUREMENT, REPORT_LIMITS, ReportBudgetExceeded, ReportUnavailableError, ReportTooLarge, rawReportJson, storedReportText, validateReportIds, validateReportPolicies, validProvenance, runReport, noteCanonicalDay, writeCanonicalDay, type ArmRow, type CanonicalNote, type DayReport, type OpenHourEntry, type OpenHourRefusal, type ReportPolicy, type ReportPriors,
  addNamedOutcomes, creditNamedOutcome, emptyNamedOutcomes, namedOutcomeRow, validNamedOutcomes, type NamedOutcomes } from './report';
import { attributionContractOf, policyOf, slotConfigsOf } from './route';
import { effectiveExploration } from './explore';
import { computationBasis, conflictKey, effectiveReportPolicy, recordedComputation, ReportInputError, explorationOpportunity, ReportRowConflict, ReportRowIdentity, rawText, validDuplicateCounts, loadDay,
  type ArmVisitors, type ComputationBasis, type DuplicateCounts, type DuplicateWitness, type ResolvedConflicts, type VisitorOutcomes } from './report';
import { buildSnapshot, DEFAULT_STATS, emptyStats, parentKey, positionHistoryOf, positionWeightAt, recordExposure, recordSuccess, type Counter, type PositionPolicy, type StatsConfig, type StatsState } from './stats';

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
 * W30 M1.01 (F17 §6 item 1; doc 35 §5 W30 "handle … maturity explicitly"): the
 * published RE-FOLD HORIZON, measured from an hour's own end. Inside it a
 * folded hour whose ledger prefix has grown is folded again (W22 R1.02).
 * Past it the hour is FINAL BY DECLARATION: a row that arrives afterwards is
 * counted and named on the report (`HourAggregate.lateObjects`,
 * `coverage.lateAfterMaturity`) and applied nowhere. It is never dropped — the
 * rows stay in the ledger — so this is a declaration about what the numbers
 * include, not the blanket age cutoff the owner declined to approve
 * (HANDOFF-2026-09-16 :234).
 *
 * The window governs the AUTOMATIC re-fold only. An explicit repair — a fold
 * asked for at a cap that can open more of the hour than the stored one did
 * (W30 R1.01) — is not bounded by it, and is named `repaired` on the coverage
 * when it changes an hour that was already final.
 *
 * Two bounds are mechanical and neither picks the value: it must outlast
 * `CLOSE_GRACE_MS`, or an hour would be final before the fold had looked at it
 * once, and it must fit inside the catch-up's own lookback, or an hour's late
 * rows could never be seen in order to be named. The VALUE between them is the
 * owner's decision (unit W30.P1.01, still open); three hours is F17 §6's own
 * "the last 2–3 hours" and is carried on every report that is built under it,
 * so a change of the value is visible in `coverage.refoldHorizonMs` rather than
 * silently rewriting what an old report meant.
 */
export const REFOLD_MATURITY_MS = 3 * HOUR_MS;
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
 * Lane E6: the five-minute run's storage, with every call made through it
 * counted in `meter`, so the open hour's folds spend only what the catch-up left
 * of `RUN_BUDGET`. It is the engine's one counting wrapper: the catch-up's calls
 * are counted through it in `index.ts`, and `foldOpenHours` counts its own
 * through it too. Each call reaches storage with its own arguments: the
 * catch-up's saved-summary read asks for its 64 KiB range (`readCanonicalSummary`)
 * through it exactly as it does without it, and so does any read that asks for
 * more than its key.
 */
export function countedStorage<T extends R2Agg & { delete?(key: string): Promise<unknown> }>(storage: T, meter = { calls: 0 }):
  { storage: R2Agg & { delete?(key: string): Promise<unknown> }; calls: () => number } {
  const ranged = storage as T & { get(key: string, options?: unknown): ReturnType<R2Agg['get']> };
  return {
    storage: {
      get: (key: string, options?: unknown) => { meter.calls++; return ranged.get(key, options); },
      list: options => { meter.calls++; return storage.list(options); },
      put: (key, body, options) => { meter.calls++; return storage.put(key, body, options); },
      ...(typeof storage.delete === 'function' ? { delete: (key: string) => { meter.calls++; return storage.delete!(key); } } : {}),
    },
    calls: () => meter.calls,
  };
}
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
  /**
   * P05 (R-P62 (2)): the position, counted from 1 within its slot, that a credit
   * of this decision names on the online path (`positionRowOf`, src/learn/fan.ts:
   * a module of a declared layout slot, whose record carries the layout reason),
   * so the fold weighs by position exactly the credits the statistics object
   * weighs. Absent on every other decision, whose entry is exactly as before.
   */
  creditPosition?: number;
}
/** What the fold keeps of a decision: the ring entry plus the two facts the exploration count needs. */
export interface CompactDecision { entry: BatchRingEntry; visitor_id: string; ts: number; position: number; explored: boolean; explorationOpportunity?: boolean }
export const compactOf = (d: DecisionRecord): CompactDecision => {
  const creditPosition = positionRowOf(d).position;
  return { entry: { ...ringEntryOf(d), brand: d.brand, ...(d.experiment?.arm === undefined ? {} : { assignment: d.experiment.arm }),
    ...(creditPosition === undefined ? {} : { creditPosition }) },
    visitor_id: d.visitor_id, ts: d.ts, position: d.position, explored: d.explored, explorationOpportunity: explorationOpportunity(d) };
};
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
  /**
   * v2 (W22 R4, LANE-LOG R143): the hourly retention stamp of an id in
   * `seenDays`, date → brand → visitor, exactly as `seenRetention` carries it
   * for `seenDate` — it moves here with the membership when the shard rolls
   * forward, and a repaired older hour stamps the ids it adds. An id whose
   * stamp has expired leaves that date's membership at the next cleanup; an id
   * with no stamp is legacy and is never disposed of on that ground. Its keys
   * are always a subset of `seenDays`'s: nothing here outlives its id.
   */
  seenDaysRetention?: Record<string, Record<string, Record<string, RetentionStamp>>>;
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
  /**
   * W30 P1 (amendment A47): the later-hour carry-in memory, date → brand →
   * visitor. An outcome whose visitor had NO decision of the date at or before
   * it — none the fold had admitted, none later in its hour — is counted by the
   * raw day under her FIRST decision of the day, which may be in an hour not
   * folded yet; so is one that precedes a first decision this fold already
   * knows, because an earlier one may still be folded. Once a fold has carried
   * her into the date, the outcome counts
   * under the assignment of her earliest decision (`firstArm`) for as long as
   * it precedes that decision — DERIVED from this memory on every fold
   * (`deriveOutcomes`), never written once and kept, so an earlier decision of
   * hers folded later moves it or, when that decision precedes the outcome,
   * leaves it for its own hour's fold to place against the ring and names that
   * hour meanwhile (`strandedHours`). One whose visitor never has a decision
   * that day is counted nowhere, as the raw day counts it. The fold of the
   * outcome's own hour REPLACES that hour's entries here, so a re-fold never
   * adds a second copy. Only outcome types and the earliest and latest time of
   * each are kept, per hour, with the outcomes' hourly retention stamp: an
   * erasure removes what it covers, an expired stamp removes the visitor, and a
   * date leaves with the horizon exactly as `seenDays` does. Nothing here is a
   * fold record: an hour that only remembers an outcome is not an hour its
   * rings have taken in.
   */
  deferred?: Record<string, Record<string, Record<string, DeferredOutcomes>>>;
  /** Technical write generation, retained after completion to prevent coordinator ETag reuse. */
  generation?: string;
  /** Only shard zero coordinates an interrupted fold; no extra visitor history is retained. */
  pending?: PendingHour;
  cleanup?: CleanupHour;
}
/** W21 C1.08: what one visitor's date is remembered as — no record id, no ring, and one timestamp (W30). */
export interface VisitorEnrollment {
  /** The assignments she was drawn into that date, first seen first. */
  arms: string[];
  /**
   * assignment → the outcome types she produced while holding it. Since W30 it
   * is DERIVED (`deriveOutcomes`) from `placed` and the carry-in memory, and is
   * kept under its name so every reader of it is unchanged.
   */
  outcomes?: Record<string, string[]>;
  /**
   * W30 P1 (delivery review defect 1): where each hour's fold placed her
   * outcomes of that hour — hour (`'00'`–`'23'`) → assignment → types. Each
   * fold of an hour REPLACES that hour's entry, so an outcome a re-fold places
   * on another row (an earlier decision of hers reached the ledger late) moves
   * instead of being counted on two. `legacy` holds, unrevisable, the outcomes a
   * record written before this release carried.
   */
  placed?: Record<string, Record<string, string[]>>;
  /**
   * W30 P1/E1 (amendments A47, A48): the time of her EARLIEST decision of the
   * date any fold has admitted, and the assignment it carried — the decision
   * the raw day counts an outcome under when no decision of hers precedes it
   * (`assignmentAt`, "else her first of the day"). With it an outcome the
   * attribution ring cannot hold is told apart exactly: before `firstAt` it
   * belongs to `firstArm`; at or after it, a decision of hers the ring has lost
   * (the cap or the horizon) held it, and the fold names the hour instead of
   * guessing the row. Both are absent on a record this build did not begin —
   * one written before this release, or one whose earliest decision an erasure
   * covered — and such a record cannot say, so the fold names the hour.
   */
  firstAt?: number;
  firstArm?: string;
}
/** W30 P1: one visitor's outcomes waiting for her first decision of the date. */
export interface DeferredOutcomes {
  /** Hour (`'00'`–`'23'`) → outcome type → `[earliest, latest]` time of that type deferred in that hour. */
  hours: Record<string, Record<string, [number, number]>>;
  /** The hourly retention stamp of those outcomes, merged as `seenRetention` merges a visitor's. */
  retention?: RetentionStamp;
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
  /**
   * assignment → outcome type → distinct visitors on the DATE, through this
   * hour. Since W30 "through this hour" is event time: an outcome counts here
   * only once the hour that DECIDES its row is this hour or an earlier one —
   * the outcome's own hour, or for a remembered one the hour of her earliest
   * decision (`outcomesOf`). A row a later hour decides can still move without
   * this hour ever being folded again, so an hour that counted it would keep
   * the old row beside the new one when the day takes the largest count.
   */
  outcomes: Record<string, Record<string, number>>;
  /**
   * W21 R1 (LANE-LOG R156): this hour's outcomes whose visitor held no
   * assignment this fold could see — no decision of the date at or before the
   * outcome, and none later in this hour either. The raw-day rule places such
   * an outcome under her FIRST decision of the day, which may be in a later hour
   * that has not been folded yet (or may never come), so this hour cannot say
   * which arm the outcome belongs to and counts it here instead of under any.
   * It adds across the hours of a day. Any hour with a non-zero count cannot
   * support the day's `visitorOutcomes`: the day names it in
   * `coverage.unassignedHours` and answers that member `null`. Decisions,
   * credits and visitors are unaffected, so the arm rows and `armVisitors`
   * stand. ABSENT on an aggregate folded before this release, which dropped
   * such an outcome without saying so and is therefore read as unable to say.
   */
  unassignedOutcomes?: number;
  /**
   * W30 P1 (amendment A47): of `unassignedOutcomes`, the ones this fold
   * REMEMBERED for the visitor's first decision of the date (`ShardState
   * .deferred`), because no decision of hers that day was known at or before
   * them. The fold of the hour that holds that decision places each on its
   * assignment, and one whose visitor has no decision that day is counted
   * nowhere — both exactly as the raw day counts them — so such an outcome no
   * longer costs the day its `visitorOutcomes`. What remains,
   * `unassignedOutcomes - deferredOutcomes`, is an outcome whose visitor DID
   * have an earlier decision that day the fold's attribution ring no longer
   * holds (W30 E1): the assignment she held cannot be known, so the day names
   * the hour and answers `visitorOutcomes: null`. It adds across the hours of a
   * day. ABSENT on an aggregate folded before this release, which remembered
   * nothing, so every unassigned outcome there still names its hour.
   */
  deferredOutcomes?: number;
  /**
   * W30 P1 (delivery review defect 2): the hours of this date holding an
   * outcome REMEMBERED for a visitor who, as of this fold, has a decision that
   * day at or before it (an earlier hour folded out of order) or whose earliest
   * decision cannot be dated. Memory can no longer place it; only that hour's
   * own fold can, against the ring, and the catch-up folds it again. Until an
   * aggregate of that hour is written after this one, the day names it and
   * answers `visitorOutcomes: null` rather than a count without the outcome.
   * Omitted when there is none.
   */
  strandedHours?: number[];
}
export const emptyAssignments = (): HourAssignments => ({ version: 1, decisions: {}, credits: {}, visitors: {}, outcomes: {}, unassignedOutcomes: 0, deferredOutcomes: 0 });
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
  /**
   * W30 V1.01 (F17 P2/P6; the W21-B3 build review's finding 1): the outcomes of
   * this hour whose carry-in history the fold could not reach.
   *
   *  · `evicted` — no credit was earned under the LEARNING policy while the
   *    visitor's attribution ring held exactly `ringCap` entries at the moment
   *    the outcome was attributed, so a decision the cap or the horizon removed
   *    may be the one that would have been credited. The honest name for that
   *    uncertainty, never a claim that a credit was owed. It is a function of
   *    the ring AS ATTRIBUTED and never of what this particular fold dropped, so
   *    the same hour folded twice produces the same brand.
   *  · `unplaced` — no assignment of the visitor's DATE could be found for the
   *    outcome at all, because at this hour's fold no decision of hers exists
   *    yet anywhere. The raw-day branch resolves such an outcome from her first
   *    decision of the date; the fold cannot, so it says so instead of being
   *    quietly short.
   *
   * Absent means this hour cannot say (R149): an aggregate folded before this
   * release carries none. Every hour this build folds carries it, zero included.
   */
  carryIn?: { evicted: number; unplaced: number };
  /**
   * W30 F1.01 (W22 R124's residual): rows of this hour excluded because two
   * genuinely different rows share one logical id and the conflict is already
   * FILED on the operator surface. In the vocabulary `duplicates` already uses,
   * and omitted when there is none.
   */
  conflicts?: DuplicateCounts;
  /**
   * The hour's named outcomes (`NamedOutcomes`, src/learn/report.ts), in the
   * shape the day carries, so the hours of a day add into exactly what the raw
   * day counts. Its ABSENCE is the statement that this hour cannot say: an
   * aggregate folded before this member existed carries none, and a day summed
   * with any such hour answers `namedOutcomes: null`. Every hour this build
   * folds carries it, empty included.
   */
  named?: NamedOutcomes;
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
  /**
   * W30 M1.01: ledger objects that reached this hour's prefix after the hour was
   * final. Counted and named, applied nowhere; the rows stay in the ledger. It
   * is carried on the hour so the statement survives a restart of the job that
   * made it. Absent where the hour has none, or where it was folded before this
   * release.
   */
  lateObjects?: number;
  /**
   * W30 F1.01 (W22 R143): the earliest hour a repair could still put into the
   * batch rings when this hour was folded — the shard floor plus one hour, `0`
   * where no shard imposes one. A version-1 shard remembers only a high-water
   * mark, so recovery begins at the first version-2 fold and no further back.
   * Only the fold can see the shard, so only the hour can carry it.
   */
  recoveryFrom?: number;
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
    // W21 R1: the unplaced outcomes add, and only where every hour can say
    // them — one hour that cannot makes the total unknown, not zero.
    if (out.unassignedOutcomes === undefined || src.unassignedOutcomes === undefined) delete out.unassignedOutcomes;
    else out.unassignedOutcomes += src.unassignedOutcomes;
    // W30 P1: the same rule for the remembered share of them. `strandedHours`
    // is read per aggregate by `reportFromHours` and is never merged.
    if (out.deferredOutcomes === undefined || src.deferredOutcomes === undefined) delete out.deferredOutcomes;
    else out.deferredOutcomes += src.deferredOutcomes;
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
  // W30 F1.01/V1.01: the filed exclusions and the unreachable carry-in add
  // across the hours of a day exactly as the duplicates beside them do, and an
  // hour that cannot say leaves the member absent rather than contributing a
  // zero it has not measured.
  if (a.conflicts || b.conflicts) out.conflicts = { decisions: (a.conflicts?.decisions ?? 0) + (b.conflicts?.decisions ?? 0),
    outcomes: (a.conflicts?.outcomes ?? 0) + (b.conflicts?.outcomes ?? 0) };
  if (out.conflicts && !validDuplicateCounts(out.conflicts)) unavailable();
  // `carryIn` is deliberately NOT summed onto the day: an hour that cannot say
  // would make a total silently short, and the day's statement is the per-hour
  // `coverage.carryInHours`, where an hour that cannot say is simply not named.
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

/**
 * Lane E6: one more hour into the day's running total, in place. The same
 * arithmetic as `mergeBrand`, value for value and key for key — every number is
 * merged by the same function in the same order — without copying the total
 * the day has already accumulated. `mergeBrand(total, hour)` rebuilds the whole
 * total for every hour summed, so a day of H hours copied its first hour H
 * times; here each hour's members are visited once, when that hour is summed.
 */
function mergeStatsInto(into: StatsState, from: StatsState, tau: number): void {
  for (const [item, levels] of Object.entries(from.items)) {
    const out = (into.items[item] ??= {});
    for (const [k, c] of Object.entries(levels)) out[k] = mergeCounter(out[k], c, tau);
  }
  for (const [k, c] of Object.entries(from.slot)) into.slot[k] = mergeCounter(into.slot[k], c, tau);
  into.events += from.events; into.updatedAt = Math.max(into.updatedAt, from.updatedAt);
}
function mergeAssignmentsInto(into: HourAssignments, from: HourAssignments): void {
  for (const [slot, arms] of Object.entries(from.decisions)) addCounts((into.decisions[slot] ??= {}), arms);
  for (const [name, credits] of Object.entries(from.credits)) addCounts((into.credits[name] ??= {}), credits);
  maxCounts(into.visitors, from.visitors);
  for (const [arm, byType] of Object.entries(from.outcomes)) maxCounts((into.outcomes[arm] ??= {}), byType);
  // W21 R1 and W30 P1, as in `mergeAssignments`: the unplaced outcomes and their
  // remembered share add only where every hour can say them; `strandedHours` is
  // read per aggregate and never merged.
  if (into.unassignedOutcomes === undefined || from.unassignedOutcomes === undefined) delete into.unassignedOutcomes;
  else into.unassignedOutcomes += from.unassignedOutcomes;
  if (into.deferredOutcomes === undefined || from.deferredOutcomes === undefined) delete into.deferredOutcomes;
  else into.deferredOutcomes += from.deferredOutcomes;
}
/** `total = mergeBrand(total, hour)`, without rebuilding `total`. Counts merge only after reportFromHours has admitted the recorded computation basis. */
export function mergeBrandInto(into: HourBrand, b: HourBrand, tau: number): void {
  into.decisions = into.decisions + b.decisions;
  into.outcomes = into.outcomes + b.outcomes;
  into.visitorsDay = Math.max(into.visitorsDay, b.visitorsDay);
  if (b.visitorsIncomplete) into.visitorsIncomplete = true;
  into.rows_hidden = into.rows_hidden + b.rows_hidden;
  if (into.duplicates || b.duplicates) into.duplicates = { decisions: (into.duplicates?.decisions ?? 0) + (b.duplicates?.decisions ?? 0),
    outcomes: (into.duplicates?.outcomes ?? 0) + (b.duplicates?.outcomes ?? 0) };
  if (into.duplicates && !validDuplicateCounts(into.duplicates)) unavailable();
  // W30 F1.01, as in `mergeBrand`: the filed exclusions add across the hours of a
  // day exactly as the duplicates do; `carryIn` is never summed onto the day.
  if (into.conflicts || b.conflicts) into.conflicts = { decisions: (into.conflicts?.decisions ?? 0) + (b.conflicts?.decisions ?? 0),
    outcomes: (into.conflicts?.outcomes ?? 0) + (b.conflicts?.outcomes ?? 0) };
  if (into.conflicts && !validDuplicateCounts(into.conflicts)) unavailable();
  if (b.assignments) mergeAssignmentsInto((into.assignments ??= emptyAssignments()), b.assignments);
  for (const [slot, arms] of Object.entries(b.arms)) addCounts((into.arms[slot] ??= {}), arms);
  for (const [slot, e] of Object.entries(b.exploration)) { const x = (into.exploration[slot] ??= { decisions: 0, explored: 0 }); x.decisions += e.decisions; x.explored += e.explored; }
  for (const [name, p] of Object.entries(b.policies)) {
    const cur = into.policies[name];
    if (!cur) { into.policies[name] = { policy: p.policy, role: p.role, credits: p.credits,
      ...(p.legacyCredits !== undefined ? { legacyCredits: p.legacyCredits } : {}),
      armCredits: { ...p.armCredits }, stats: Object.fromEntries(Object.entries(p.stats).map(([s, st]) => [s, mergeStats(st, emptyStats(), tau)])) }; continue; }
    if (cur.role !== p.role || JSON.stringify(effectiveReportPolicy(cur.policy)) !== JSON.stringify(effectiveReportPolicy(p.policy))) unavailable();
    cur.credits += p.credits;
    // W26 R1.01 (R149): as in `mergeBrand` — the legacy share sums only where
    // both can say it, and once one hour cannot, the day cannot.
    if (cur.legacyCredits === undefined || p.legacyCredits === undefined) delete cur.legacyCredits;
    else cur.legacyCredits += p.legacyCredits;
    addCounts(cur.armCredits, p.armCredits);
    for (const [slot, st] of Object.entries(p.stats)) {
      const held = cur.stats[slot];
      if (held) mergeStatsInto(held, st, tau); else cur.stats[slot] = mergeStats(emptyStats(), st, tau);
    }
  }
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
  /**
   * P05 (decision D2, R-P20, R-P62): what a credit to the decision served at
   * `position` (from 1) of the brand's slot on the page is weighed by at `ts`,
   * read from the position-policy history the slot's statistics object
   * published (`positionHistories`). Asked only for a credited decision that
   * names its position (`creditPosition`). Absent: every credit as before.
   */
  positionWeight?: (brand: string, slot: string, page: string, position: number, ts: number) => number;
}

/**
 * P05 (decision D2, R-P20, R-P62): the position weights a fold credits by — the
 * same weight the online credit applies, from the same source and by the same
 * rule: the position-policy history each placement's statistics object
 * publishes, and in it the policy in force at the credit's time
 * (`positionWeightAt`), never the learn dials in force when the fold runs. A
 * history is read, once per fold, for the placement of every decision that names
 * its position (`creditPosition`) among the rows `load` is given — the
 * page-qualified history where that placement publishes one, else the slot's
 * own — so a fold whose decisions name no position reads nothing and weighs
 * nothing. A history that cannot be read, or is malformed, refuses the fold —
 * the catch-up builds the hour again — rather than weighing a credit by a policy
 * the fold could not establish. Changes a credit's amount only, never whether it
 * is counted (R-P29).
 */
function positionHistories(r2: R2Like, tenant: string): {
  load: (entries: Iterable<{ brand?: string; slot: string; page: string; creditPosition?: number }>) => Promise<void>;
  weight: NonNullable<FoldContext['positionWeight']>;
} {
  const histories = new Map<string, PositionPolicy[] | null>();
  const keyOf = (brand: string, slot: string, page?: string): string | null => { try { return positionHistoryKey(tenant, brand, slot, page); } catch { return null; } };
  const read = async (brand: string, slot: string, page?: string): Promise<void> => {
    const key = keyOf(brand, slot, page);
    if (key === null || histories.has(key)) return;
    const stored = await r2.get(key);
    if (stored === null) { histories.set(key, null); return; }
    let policies: PositionPolicy[] | null = null;
    try { policies = positionHistoryOf(JSON.parse(await stored.text()), { tenant, brand, slot, ...(page ? { page } : {}) }); } catch { policies = null; }
    if (policies === null) unavailable();
    histories.set(key, policies);
  };
  return {
    load: async (entries) => {
      for (const entry of entries) {
        if (entry.creditPosition === undefined || typeof entry.brand !== 'string') continue;
        if (entry.page) await read(entry.brand, entry.slot, entry.page);
        await read(entry.brand, entry.slot);
      }
    },
    weight: (brand, slot, page, position, ts) => {
      const scoped = page ? keyOf(brand, slot, page) : null, plain = keyOf(brand, slot);
      return positionWeightAt((scoped === null ? null : histories.get(scoped)) ?? (plain === null ? null : histories.get(plain)) ?? null, position, ts);
    },
  };
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
  // W22 R4: an archived id's stamp is read exactly as a current one is
  // (`checkSeen`), and refused whole when any of it is malformed.
  if (state.seenDaysRetention !== undefined) {
    const archived = state.seenDaysRetention;
    if (!objectMap(archived) || Object.keys(archived).length > SEEN_DAYS_MAX) throw new Error('Hourly seen state unavailable');
    for (const [date, brands] of Object.entries(archived)) {
      if (!dateShape(date) || date === state.seenDate || !objectMap(brands)) throw new Error('Hourly seen state unavailable');
      for (const values of Object.values(brands)) {
        if (!objectMap(values)) throw new Error('Hourly seen state unavailable');
        for (const stamp of Object.values(values)) readRetention(stamp, (stamp as RetentionStamp)?.tenant, 'hourly');
      }
    }
  }
}

/**
 * W22 R4: the archived stamps keep exactly the archived membership's ids — an
 * id that leaves `seenDays` for erasure, retention or the horizon takes its
 * stamp with it, and a date the shard no longer archives is dropped whole.
 */
function pruneSeenDaysRetention(state: ShardState): void {
  const archived = state.seenDaysRetention;
  if (!archived) return;
  for (const [date, brands] of Object.entries(archived)) {
    const membership = date === state.seenDate ? undefined : state.seenDays?.[date];
    if (!membership) { delete archived[date]; continue; }
    for (const [brand, values] of Object.entries(brands)) {
      const ids = new Set(membership[brand] ?? []);
      for (const visitor of Object.keys(values)) if (!ids.has(visitor)) delete values[visitor];
      if (!Object.keys(values).length) delete brands[brand];
    }
    if (!Object.keys(brands).length) delete archived[date];
  }
  if (!Object.keys(archived).length) delete state.seenDaysRetention;
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
        // W30 P1/E1: both or neither, the time on the date and the assignment among her arms.
        if ((value.firstAt === undefined) !== (value.firstArm === undefined)) fail();
        if (value.firstAt !== undefined && (!onDate(value.firstAt, date) || !label(value.firstArm)
          || !(value.arms as unknown[]).includes(value.firstArm))) fail();
        // W30 P1: the per-hour placements, each an assignment → types map within the same bounds.
        const placed: unknown = value.placed;
        if (placed !== undefined) {
          if (!objectMap(placed) || Object.keys(placed).length > 25) fail();
          for (const [hour, byArm] of Object.entries(placed)) {
            aggregateBound('work', ++work);
            if (!(hour === 'legacy' || /^(?:[01][0-9]|2[0-3])$/.test(hour)) || !objectMap(byArm) || Object.keys(byArm).length > ENROLLMENT_ARMS_MAX) fail();
            for (const [arm, types] of Object.entries(byArm)) if (!label(arm) || !list(types, label)) fail();
          }
        }
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

/** W30 P1: the two-digit key of the hour a time falls in. */
const hourKeyOf = (ts: number): string => pad2(new Date(Math.floor(ts / HOUR_MS) * HOUR_MS).getUTCHours());

/** W30 P1: the carry-in memory, refused whole when any of it is malformed. */
function checkDeferred(state: ShardState): void {
  const memory: unknown = state.deferred;
  if (memory === undefined) return;
  function fail(): never { throw new Error('Hourly carry-in state unavailable'); }
  const label = (value: unknown): boolean => typeof value === 'string' && !!value && value.length <= 256;
  if (!objectMap(memory) || Object.keys(memory).length > SEEN_DAYS_MAX + 1) fail();
  let work = 0;
  for (const [date, brands] of Object.entries(memory)) {
    if (!dateShape(date) || !objectMap(brands)) fail();
    for (const [brand, record] of Object.entries(brands)) {
      if (!label(brand) || !objectMap(record)) fail();
      for (const [visitor, value] of Object.entries(record)) {
        aggregateBound('work', ++work);
        if (!visitor || visitor.length > 256 || !objectMap(value) || !objectMap(value.hours)
          || Object.keys(value).some(key => key !== 'hours' && key !== 'retention')) fail();
        const hours = Object.entries(value.hours);
        if (!hours.length || hours.length > 24) fail();
        for (const [hour, byType] of hours) {
          aggregateBound('work', ++work);
          if (!/^(?:[01][0-9]|2[0-3])$/.test(hour) || !objectMap(byType)) fail();
          const types = Object.entries(byType);
          if (!types.length || types.length > ENROLLMENT_ARMS_MAX) fail();
          for (const [type, span] of types) {
            if (!label(type) || !Array.isArray(span) || span.length !== 2 || !onDate(span[0], date) || !onDate(span[1], date)
              || span[0] > span[1] || hourKeyOf(span[0]) !== hour || hourKeyOf(span[1]) !== hour) fail();
          }
        }
        if (value.retention !== undefined) readRetention(value.retention, (value.retention as RetentionStamp)?.tenant, 'hourly');
      }
    }
  }
}

/** W30 P1: drop empty levels of the carry-in memory, and keep each visitor's hours in hour order so a re-fold that decides the same writes the same bytes. */
function tidyDeferred(state: ShardState): void {
  const memory = state.deferred;
  if (!memory) return;
  for (const [date, brands] of Object.entries(memory)) {
    for (const [brand, record] of Object.entries(brands)) {
      for (const [visitor, carry] of Object.entries(record)) {
        carry.hours = Object.fromEntries(Object.entries(carry.hours).filter(([, byType]) => Object.keys(byType).length).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
        if (!Object.keys(carry.hours).length) delete record[visitor];
      }
      if (!Object.keys(record).length) delete brands[brand];
    }
    if (!Object.keys(brands).length) delete memory[date];
  }
  if (!Object.keys(memory).length) delete state.deferred;
}

/**
 * W30 P1: an erasure reaches the carry-in memory and the enrollment's earliest
 * decision exactly as it reaches the rows. A deferred outcome at or before the
 * tombstone's cutoff is gone — where only some of a type's outcomes are, the
 * earliest surviving time is not known and the latest stands for both; so is an
 * earliest decision the cutoff covers, which leaves the record unable to say
 * (its timestamp is not kept for a row the tenant asked to be forgotten). With
 * `expiry`, an expired hourly stamp removes the visitor's deferred outcomes.
 */
function eraseDeferred(state: ShardState, tombs: ReadonlyMap<string, Pick<Tombstone, 'erased_at'>>, expiry?: { tenant: string; now: number }): void {
  for (const brands of Object.values(state.deferred ?? {})) {
    for (const record of Object.values(brands)) {
      for (const [visitor, carry] of Object.entries(record)) {
        if (expiry && carry.retention !== undefined && readRetention(carry.retention, expiry.tenant, 'hourly').expiresAt <= expiry.now) { delete record[visitor]; continue; }
        const cutoff = tombs.get(visitor)?.erased_at;
        if (cutoff === undefined) continue;
        for (const byType of Object.values(carry.hours)) for (const [type, span] of Object.entries(byType)) {
          if (span[1] <= cutoff) delete byType[type];
          else if (span[0] <= cutoff) byType[type] = [span[1], span[1]];
        }
      }
    }
  }
  tidyDeferred(state);
  if (!tombs.size) return;
  for (const brands of Object.values(state.enrollment ?? {})) for (const record of Object.values(brands)) {
    for (const [visitor, enrolled] of Object.entries(record)) {
      const cutoff = tombs.get(visitor)?.erased_at;
      if (cutoff !== undefined && enrolled.firstAt !== undefined && enrolled.firstAt <= cutoff) { delete enrolled.firstAt; delete enrolled.firstArm; }
    }
  }
}

/** W30 P1: the carry-in memory keeps the dates an hour of which can still be folded, like `seenDays`. */
function pruneDeferred(state: ShardState, ctx: FoldContext): void {
  const memory = state.deferred;
  if (!memory) return;
  const oldest = new Date(Math.max(0, hourStart(ctx.date, 0) - Math.max(ctx.horizonMs, 0))).toISOString().slice(0, 10);
  for (const date of Object.keys(memory)) if (date < oldest) delete memory[date];
  const dates = Object.keys(memory).sort();
  for (const date of dates.slice(0, Math.max(0, dates.length - (SEEN_DAYS_MAX + 1)))) delete memory[date];
  if (!Object.keys(memory).length) delete state.deferred;
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
  checkDeferred(state);
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
export function foldShard(state: ShardState, decs: readonly CompactDecision[], outs: readonly OutcomeRecord[], ctx: FoldContext): { state: ShardState; folded: boolean; changed: boolean; floor: number; deferredChanged: boolean } {
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
  const beforeDays = JSON.stringify([state.seenDays ?? null, state.seenDaysRetention ?? null]);
  const beforeEnrollment = JSON.stringify(state.enrollment ?? null);
  const beforeDeferred = JSON.stringify(state.deferred ?? null);
  // W30 P1: an erasure leaves the carry-in memory and the earliest decision
  // before anything below reads them.
  eraseDeferred(state, ctx.tombs);
  if (!older && state.seenDate !== ctx.date) {
    changed = Object.keys(state.seen).length > 0 || state.seenAt !== undefined || state.seenIncomplete !== undefined;
    if (state.seenDate !== '' && Object.keys(state.seen).length) {
      (state.seenDays ??= {})[state.seenDate] = state.seen;
      // W22 R4: the date's ids leave for the archive WITH their retention
      // stamps, so an archived id still leaves when its retention ends.
      if (state.seenRetention && Object.keys(state.seenRetention).length) (state.seenDaysRetention ??= {})[state.seenDate] = state.seenRetention;
    }
    const restored = state.seenDaysRetention?.[ctx.date];
    state.seenDate = ctx.date; state.seen = state.seenDays?.[ctx.date] ?? {};
    if (state.seenDays) { delete state.seenDays[ctx.date]; if (!Object.keys(state.seenDays).length) delete state.seenDays; }
    delete state.seenAt; delete state.seenIncomplete; delete state.seenRetention;
    if (restored) {
      state.seenRetention = restored;
      delete state.seenDaysRetention![ctx.date];
    }
    pruneSeenDaysRetention(state);
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
        // W30 P1/E1: a record this fold begins, or one begun by this build, can
        // say when her earliest decision of the date was and what it carried;
        // one written before (arms, no time) cannot, and never pretends to.
        const begun = !state.enrollment?.[ctx.date]?.[d.entry.brand]?.[d.visitor_id];
        const enrolled = enrollmentOf(state, ctx.date, d.entry.brand, d.visitor_id);
        const label = shardLabel(assignmentLabel(d.entry));
        if (!enrolled.arms.includes(label)) {
          if (enrolled.arms.length >= ENROLLMENT_ARMS_MAX) throw new ReportInputError();
          enrolled.arms.push(label);
        }
        if ((begun || enrolled.firstAt !== undefined) && (enrolled.firstAt === undefined || d.ts < enrolled.firstAt)) {
          enrolled.firstAt = d.ts; enrolled.firstArm = label;
        }
      }
      if (older) {
        // An older date keeps ids and no timing witness it cannot carry — but
        // (W22 R4) each id it adds carries its hourly retention stamp, merged
        // exactly as the current date's `seenRetention` merges it.
        if (d.entry.retention?.hourly) {
          const stamps = (((state.seenDaysRetention ??= {})[ctx.date] ??= {})[d.entry.brand] ??= {}), prior = stamps[d.visitor_id];
          stamps[d.visitor_id] = prior ? mergeRetention(prior, d.entry.retention.hourly, d.entry.tenant!, 'hourly') : d.entry.retention.hourly;
        }
        continue;
      }
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
  // W30 P1 (delivery review defect 1): this fold decides every outcome of its
  // hour afresh — where it is placed and what is remembered — and REPLACES what
  // any earlier fold of the hour decided, instead of adding to it.
  const hourKey = hourKeyOf(ctx.from);
  for (const record of Object.values(state.deferred?.[ctx.date] ?? {})) for (const carry of Object.values(record)) delete carry.hours[hourKey];
  /** brand → visitor → assignment → the outcome types this fold placed there. */
  const placedNow = new Map<string, Map<string, Map<string, Set<string>>>>();
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
    const ringHeld = subjectRing.filter(e => e.brand === o.brand && onDate(e.ts, ctx.date) && e.ts <= o.ts).at(-1);
    // W30 P1/E1: when the ring holds no decision of hers of the date at or
    // before the outcome, the date's membership says which case it is. Not a
    // member: no decision of hers that day is known at all — not before it, and
    // not later in this hour, which this fold has just admitted — so it waits
    // for her first one (P1). A member whose earliest decision is AFTER it: that
    // decision is her first of the day, and holds it. A member whose earliest
    // decision is at or before it — or whose record cannot say when that was —
    // held it with a decision the ring has lost to the cap or the horizon (E1):
    // the assignment she held then cannot be known, so the outcome is placed
    // nowhere and the hour names it rather than guessing the row. `firstAt` is
    // a fact about her decisions, not about fold order, so a re-fold of the hour
    // reads it exactly as the first fold did.
    const member = !!seenSets.get(o.brand)?.has(o.visitor_id);
    const record = member ? state.enrollment?.[ctx.date]?.[o.brand]?.[o.visitor_id] : undefined;
    const first = record?.firstAt !== undefined && record.firstAt > o.ts ? record.firstArm : undefined;
    const label = ringHeld ? shardLabel(assignmentLabel(ringHeld)) : first;
    if (label === undefined) {
      // W21 R1 (LANE-LOG R156): no decision of the date at or before it that
      // this fold can see, and none later in this hour. The outcome is placed
      // under no assignment here and the hour counts it — remembered for her
      // first decision of the day when she has none yet (W30 P1), and otherwise
      // named, rather than a day answering a count that omits it or puts it on
      // a row she may not have held.
      const ha = ((ctx.brands[o.brand] ??= emptyBrand()).assignments ??= emptyAssignments());
      ha.unassignedOutcomes = (ha.unassignedOutcomes ?? 0) + 1;
      if (!member) {
        deferOutcome(state, ctx.date, hourKey, o);
        ha.deferredOutcomes = (ha.deferredOutcomes ?? 0) + 1;
      }
    } else if (!ringHeld && record!.firstAt! >= ctx.to) {
      // W30 P1: held by her earliest decision of the day, and that decision is
      // in a LATER hour — one an hour between them, folded afterwards, can still
      // replace, without this hour ever being folded again. Remembered, and
      // placed by derivation (`outcomesOf`), so it follows her earliest decision
      // instead of staying on the row it was first counted on. An earliest
      // decision inside this hour can only be replaced by a row of this hour or
      // an earlier one, whose fold folds this hour again.
      deferOutcome(state, ctx.date, hourKey, o);
    } else {
      const visitors = placedNow.get(o.brand) ?? new Map<string, Map<string, Set<string>>>(); placedNow.set(o.brand, visitors);
      const arms = visitors.get(o.visitor_id) ?? new Map<string, Set<string>>(); visitors.set(o.visitor_id, arms);
      const types = arms.get(label) ?? new Set<string>(); arms.set(label, types);
      types.add(shardLabel(o.type));
    }
    // W30 V1.01: what this hour could not reach. Recorded on a brand the fold
    // already knows — `buildHour` counts every outcome onto its brand before the
    // shards run — so a caller that folds a shard directly is unchanged.
    const carryIn = ctx.brands[o.brand]?.carryIn;
    if (carryIn && label === undefined) carryIn.unplaced += 1;
    // An explicit reference must expose ambiguity across the complete retained
    // subject ring; the shared selector checks the unique target's brand.
    const ring = Object.hasOwn(o, 'decision_id') ? subjectRing : subjectRing.filter((e) => e.brand === o.brand);
    if (!ring.length) {
      // No entry of this brand survived in the ring. The outcome earned nothing,
      // and where the ring was FULL the reason may be a decision the cap removed.
      if (carryIn && subjectRing.length >= ctx.ringCap) carryIn.evicted += 1;
      continue;
    }
    const hb = (ctx.brands[o.brand] ??= emptyBrand());
    let learningCredits = 0;
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
        if (p.role === 'learning') learningCredits += 1;
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
          // P05 (decision D2, R-P62): a credit to a decision that names its position, exactly as the online credit
          // names it, is weighed by the position policy in force when it happened; the count above is unchanged.
          const weighed = credited?.creditPosition;
          const w = creditWeight(ctx.slotCfg[c.slot]?.objective, o)
            * (ctx.positionWeight && credited && weighed !== undefined ? ctx.positionWeight(credited.brand, c.slot, credited.page, weighed, c.ts) : 1);
          if (w > 0) recordSuccess((ph.stats[c.slot] ??= emptyStats()), c.item, c.cell, c.reward as RewardType, c.ts, w, ctx.statsCfg);
        }
      }
    }
    // A named outcome is credited, under its own name, to every decision the
    // LEARNING policy pays — the raw-day branch's own rule (`src/learn/report.ts`),
    // without the slot's reward filter. Its record count is taken in `buildHour`.
    const learning = ctx.policies.find((p) => p.role === 'learning');
    const named = learning ? namedOutcomeRow((hb.named ??= emptyNamedOutcomes()), o) : null;
    if (named && learning) for (const c of attribute(o, ring, learning)) creditNamedOutcome(named, c.slot, c.item);
    // W30 V1.01: the ring was full and nothing in it was credited, so a decision
    // the cap or the horizon removed may be the one that would have been.
    if (carryIn && !learningCredits && subjectRing.length >= ctx.ringCap) carryIn.evicted += 1;
  }
  // W30 P1: this hour's placements replace the ones any earlier fold of it made.
  for (const brands of Object.values(state.enrollment?.[ctx.date] ?? {})) for (const record of Object.values(brands)) {
    record.placed ??= legacyPlacement(record);
    delete record.placed[hourKey];
  }
  for (const [brand, visitors] of placedNow) for (const [visitor, arms] of visitors) {
    const record = enrollmentOf(state, ctx.date, brand, visitor);
    record.placed ??= legacyPlacement(record);
    if (arms.size > ENROLLMENT_ARMS_MAX) throw new ReportInputError();
    record.placed[hourKey] = Object.fromEntries([...arms].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([arm, types]) => { if (types.size > ENROLLMENT_ARMS_MAX) throw new ReportInputError(); return [arm, [...types].sort()]; }));
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
  pruneSeenDaysRetention(state);
  // W21 C1.08: the per-assignment memory keeps exactly the membership's ids, so
  // it is pruned last, after the membership and the archived dates are final.
  pruneEnrollment(state);
  tidyDeferred(state);
  pruneDeferred(state, ctx);
  // W30 P1: every record's outcomes, derived from what the hours placed and what
  // is still remembered, so a memory placement follows her earliest decision.
  deriveOutcomes(state);
  if (JSON.stringify(state.enrollment ?? null) !== beforeEnrollment) changed = true;
  // W30 P1: reported apart from `changed`, because remembering an outcome is
  // not taking an hour into the rings — a fold that changes nothing else keeps
  // every other byte of the state it read (`buildHour`).
  const deferredChanged = JSON.stringify(state.deferred ?? null) !== beforeDeferred;
  if (JSON.stringify([state.seenDays ?? null, state.seenDaysRetention ?? null]) !== beforeDays) changed = true;
  if (JSON.stringify([state.seen, state.seenAt, state.seenIncomplete, state.seenRetention]) !== beforeSeen) changed = true;
  // W30 F1.01 (W22 R143): the floor this state carried on entry, below which
  // every hour is taken to be folded and so can never reach these rings again.
  return { state, folded, changed, floor: floorAtEntry, deferredChanged };
}

/** W30 P1: remember an outcome for the visitor's first decision of its date, under its own hour. */
function deferOutcome(state: ShardState, date: string, hour: string, o: OutcomeRecord): void {
  const type = shardLabel(o.type);
  const carry = ((((state.deferred ??= {})[date] ??= {})[o.brand] ??= {})[o.visitor_id] ??= { hours: {} });
  const byType = (carry.hours[hour] ??= {});
  if (!Object.hasOwn(byType, type) && Object.keys(byType).length >= ENROLLMENT_ARMS_MAX) throw new ReportInputError();
  const span = byType[type];
  byType[type] = span ? [Math.min(span[0], o.ts), Math.max(span[1], o.ts)] : [o.ts, o.ts];
  const stamp = o.retention?.hourly;
  if (stamp) carry.retention = carry.retention ? mergeRetention(carry.retention, stamp, o.tenant, 'hourly') : stamp;
}

/**
 * W30 P1: the outcome types one visitor holds under each assignment of her
 * date — every hour's placement, and each remembered outcome that precedes her
 * earliest decision, under that decision's assignment. A remembered outcome a
 * decision of hers precedes is NOT placed here: its own hour's fold places it.
 *
 * With `through` (a two-digit hour of the same date), only the rows DECIDED by
 * that hour or an earlier one: an hour's placement is decided by that hour's
 * fold, a remembered outcome's row by the hour of her earliest decision, and a
 * legacy placement was decided before this release. That is what an hour
 * aggregate may count (W30 P1, delivery re-review): every hour after one that
 * is folded again is folded again too, so a row decided at or before an hour
 * cannot change without that hour's count being taken again, while a row a
 * LATER hour decides can — and an hour that had counted it would keep the old
 * row beside the new one.
 */
function outcomesOf(record: VisitorEnrollment, carry: DeferredOutcomes | undefined, through?: string): Record<string, string[]> | undefined {
  const union = new Map<string, Set<string>>();
  const add = (arm: string, type: string) => { const types = union.get(arm) ?? new Set<string>(); union.set(arm, types); types.add(type); };
  for (const [hour, byArm] of Object.entries(record.placed ?? legacyPlacement(record))) {
    if (through !== undefined && hour !== 'legacy' && hour > through) continue;
    for (const [arm, types] of Object.entries(byArm)) for (const type of types) add(arm, type);
  }
  if (carry && record.firstAt !== undefined && record.firstArm !== undefined && (through === undefined || hourKeyOf(record.firstAt) <= through)) {
    for (const byType of Object.values(carry.hours)) for (const [type, span] of Object.entries(byType)) if (span[0] < record.firstAt) add(record.firstArm, type);
  }
  if (!union.size) return undefined;
  if (union.size > ENROLLMENT_ARMS_MAX) throw new ReportInputError();
  return Object.fromEntries([...union].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([arm, types]) => {
    if (types.size > ENROLLMENT_ARMS_MAX) throw new ReportInputError();
    return [arm, [...types].sort()];
  }));
}

/**
 * W30 P1: the placement a record this build did not write starts from — its
 * outcomes, kept whole and unrevisable under `legacy`. A record this build
 * writes always carries `placed`, empty or not, so it is never mistaken for one.
 */
const legacyPlacement = (record: VisitorEnrollment): Record<string, Record<string, string[]>> =>
  record.outcomes ? { legacy: structuredClone(record.outcomes) } : {};

/** W30 P1: rewrite every record's `outcomes` from its placements and the carry-in memory. */
function deriveOutcomes(state: ShardState): void {
  for (const [date, brands] of Object.entries(state.enrollment ?? {})) for (const [brand, record] of Object.entries(brands)) {
    for (const [visitor, enrolled] of Object.entries(record)) {
      // Hour order, whatever order the folds replaced them in, so the same placements are the same bytes.
      enrolled.placed = Object.fromEntries(Object.entries(enrolled.placed ?? legacyPlacement(enrolled)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
      const outcomes = outcomesOf(enrolled, state.deferred?.[date]?.[brand]?.[visitor]);
      if (outcomes) enrolled.outcomes = outcomes; else delete enrolled.outcomes;
    }
  }
}

/**
 * W30 P1 (delivery review defect 2): the hours of `date` holding a remembered
 * outcome that memory can no longer place — its visitor has a decision that day
 * at or before it, or an earliest decision that cannot be dated.
 */
function strandedOf(state: ShardState, date: string, brand: string): number[] {
  const hours = new Set<number>();
  for (const [visitor, carry] of Object.entries(state.deferred?.[date]?.[brand] ?? {})) {
    const enrolled = state.enrollment?.[date]?.[brand]?.[visitor];
    if (!enrolled?.arms.length) continue;                 // no decision of hers that day yet: waiting, not stranded
    for (const [hour, byType] of Object.entries(carry.hours)) {
      if (enrolled.firstAt === undefined || Object.values(byType).some(span => span[1] >= enrolled.firstAt!)) hours.add(Number(hour));
    }
  }
  return [...hours];
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
  // W30: present or absent, never malformed — an aggregate folded before this
  // release carries neither and stays readable.
  for (const key of ['lateObjects', 'recoveryFrom']) {
    if (a[key] !== undefined && (!Number.isSafeInteger(a[key]) || Number(a[key]) < 0)) unavailable();
  }
  aggregateMap(a.brands);
}

/** Admission precedes sorting, the day's merge and snapshot parent expansion. */
function admitHours(aggs: readonly HourAggregate[], ids: { tenant: string; brand: string; date: string }): void {
  if (!Array.isArray(aggs)) unavailable();
  aggregateBound('aggregateObjects', aggs.length);
  aggregateName(ids.tenant); aggregateName(ids.brand);
  let work = 0, bytes = 0;
  // Lane E6: each visited member is merged once, into the day's running total
  // (`mergeBrandInto`), and expanded once into its snapshot. The day used to be
  // rebuilt for every hour summed (`mergeBrand` copied the accumulated total), and
  // admission charged that copy for every hour of the day: a member cost four
  // times the day's hour count, so the same traffic was refused later in the day
  // that it was admitted earlier. A member now costs what one hour's member always
  // cost, four, because it is merged once.
  const visit = () => aggregateBound('work', work += 4);
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
      // W30: the members this batch adds are admitted exactly as strictly as the
      // ones beside them — present or absent, never malformed.
      if (Object.hasOwn(b, 'conflicts') && !validDuplicateCounts(b.conflicts)) unavailable();
      if (Object.hasOwn(b, 'carryIn')) {
        const carry = aggregateMap(b.carryIn); visit();
        if (Object.keys(carry).length !== 2) unavailable();
        aggregateNumber(carry.evicted); aggregateNumber(carry.unplaced);
      }
      for (const [slot, value] of Object.entries(aggregateMap(b.arms))) {
        aggregateName(slot); visit(); if (brand === ids.brand) slots.add(slot);
        for (const [arm, n] of Object.entries(aggregateMap(value))) { aggregateName(arm); aggregateNumber(n); visit(); }
      }
      for (const [slot, value] of Object.entries(aggregateMap(b.exploration))) {
        aggregateName(slot); visit(); if (brand === ids.brand) slots.add(slot);
        const e = aggregateMap(value); aggregateNumber(e.decisions); aggregateNumber(e.explored);
      }
      // The named outcomes are admitted as strictly: present and malformed refuses the day.
      if (Object.hasOwn(b, 'named')) { visit(); if (validNamedOutcomes(b.named) === null) unavailable(); }
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
        // W21 R1: present or absent, never malformed — an aggregate folded
        // before the release carries none and stays readable.
        if (Object.hasOwn(ha, 'unassignedOutcomes')) aggregateNumber(ha.unassignedOutcomes);
        // W30 P1: the same, for the remembered share of them.
        if (Object.hasOwn(ha, 'deferredOutcomes')) aggregateNumber(ha.deferredOutcomes);
        if (Object.hasOwn(ha, 'strandedHours')) {
          const listed: unknown = ha.strandedHours;
          if (!Array.isArray(listed) || !listed.length || listed.length > 24 || new Set(listed).size !== listed.length
            || listed.some(h => !Number.isInteger(h) || h < 0 || h > 23)) unavailable();
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

/** Lane E6: a refusal as an open hour's state and a day report carry it. */
function openRefusal(value: unknown): value is OpenHourRefusal {
  if (!objectMap(value) || !Number.isSafeInteger(value.at) || Number(value.at) < 0 || typeof value.error !== 'string' || value.error.length > 200
    || typeof value.code !== 'string' || !/^[a-z_]{1,64}$/.test(value.code)) return false;
  for (const key of Object.keys(value)) if (!['at', 'error', 'code', 'budget', 'limit', 'observed', 'conflict'].includes(key)) return false;
  if (value.budget !== undefined && !(typeof value.budget === 'string' && Object.hasOwn(REPORT_LIMITS, value.budget))) return false;
  for (const n of [value.limit, value.observed]) if (n !== undefined && !(typeof n === 'number' && Number.isFinite(n) && n >= 0)) return false;
  return value.conflict === undefined || (objectMap(value.conflict) && Object.keys(value.conflict).length === 1
    && (value.conflict.stream === 'decision' || value.conflict.stream === 'outcome'));
}
/** Lane E6: one open hour as a day report names it; `summed` says whether its working aggregate is among the hours summed. */
function openEntry(value: unknown, summed: boolean): value is OpenHourEntry {
  if (!objectMap(value) || !Number.isInteger(value.hour) || Number(value.hour) < 0 || Number(value.hour) > 23
    || (value.through !== null && !(Number.isSafeInteger(value.through) && Number(value.through) >= 0))) return false;
  for (const key of Object.keys(value)) if (!['hour', 'status', 'through', 'refusal'].includes(key)) return false;
  // A current hour is summed from the fold that read the ledger at `through`;
  // a refused one names why, and is summed only from an earlier fold that stands.
  if (value.status === 'current') return summed && value.through !== null && value.refusal === undefined;
  return value.status === 'refused' && openRefusal(value.refusal) && summed === (value.through !== null);
}

/** The day report, in the shape `buildReport` makes, from whichever hours are built. */
export function reportFromHours(aggs: readonly HourAggregate[], ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, now: number, opts: { pending: number; missing: number[]; open?: OpenHourEntry[] }): DayReport {
  validateReportIds(ids);
  if (!Array.isArray(opts.missing) || opts.missing.length > 24 || new Set(opts.missing).size !== opts.missing.length
    || !Array.from(opts.missing).every(h => Number.isInteger(h) && h >= 0 && h < 24)) unavailable();
  // Lane E6: the open hours, each named once; one that is current, or refused
  // with an earlier fold standing, is one of the hours given, and no other is.
  const open = opts.open ?? [];
  if (!Array.isArray(open) || open.length > 24 || new Set(open.map(e => e?.hour)).size !== open.length
    || !open.every(e => openEntry(e, Array.isArray(aggs) && aggs.some(a => a?.hour === e?.hour)))) unavailable();
  aggregateNumber(opts.pending);
  admitHours(aggs, ids);
  const statsCfg: StatsConfig = learn.stats ?? DEFAULT_STATS, slotCfg = slotConfigsOf(learn), tau = statsCfg.tauLearnMs;
  if (!Number.isFinite(now) || !Number.isFinite(tau) || tau <= 0 || !Number.isFinite(statsCfg.n0) || statsCfg.n0 <= 0) unavailable();
  const sorted = [...aggs].sort((a, b) => a.hour - b.hour);
  const computation = compatibleHours(sorted, ids.brand, learn);
  const hb = emptyBrand();
  for (const a of sorted) { const b = a.brands[ids.brand]; if (b) mergeBrandInto(hb, b, tau); }
  finiteMerged(hb);
  // W21 C1.08 (R108, F25 §7): which of the summed hours can say what the
  // ASSIGNMENT was. An hour that carries this brand but not the member was
  // folded before this release, or onto a shard state that predates it. The day
  // then groups by the arm SERVED, exactly as it always did, answers its per-arm
  // denominators unknown rather than dividing a total it does not hold, and
  // NAMES those hours. One day uses one rule for all of its hours: mixing the
  // two groupings would put one visitor under two different rows.
  //
  // W21 R1 (LANE-LOG R156): an hour can also carry the assignment of every
  // decision and still be unable to PLACE one of its outcomes — one whose
  // visitor's first decision of the day comes in a later hour, which the raw
  // day counts under that decision. Such an hour is named too, and the day
  // withdraws the one member it cannot support, `visitorOutcomes`, rather than
  // answering a count that silently omits the outcome. Its arm rows and
  // `armVisitors` do not depend on where an outcome is placed, and stand.
  const ungrouped = sorted.filter(a => a.brands[ids.brand] !== undefined && !assignmentsAgree(a.brands[ids.brand]!)).map(a => a.hour);
  //
  // W30 P1/E1 (amendments A47, A48): an outcome the hour REMEMBERED for the
  // visitor's first decision of the day is placed there by the fold of that
  // decision's hour, or counted nowhere when she has none, exactly as the raw
  // day counts it, so it no longer costs the day the member. The hour is named
  // for what is left: an outcome whose visitor held an earlier decision that
  // day the fold's ring has lost, or one an hour folded before this release
  // did not remember (it carries no `deferredOutcomes`).
  const unplaced = sorted.filter(a => {
    const ha = a.brands[ids.brand]?.assignments;
    return a.brands[ids.brand] !== undefined && (ha?.unassignedOutcomes === undefined || ha.unassignedOutcomes !== (ha.deferredOutcomes ?? 0));
  }).map(a => a.hour);
  // W30 P1 (delivery review defect 2): an hour a later fold found holding a
  // remembered outcome memory can no longer place is named until an aggregate
  // of that hour is written after that fold — its own fold is what places it.
  const builtAtOf = new Map(sorted.map(a => [a.hour, a.builtAt]));
  const stranded: number[] = [];
  for (const a of sorted) for (const hour of a.brands[ids.brand]?.assignments?.strandedHours ?? []) {
    const origin = builtAtOf.get(hour);
    if (origin !== undefined && origin < a.builtAt) stranded.push(hour);
  }
  // W30 P1 (delivery re-review): an hour counts the rows decided through its
  // own hour, and a fold of an earlier hour can decide one of them again. An
  // hour whose aggregate was written before an earlier hour of its date was
  // last folded may hold a row that fold has since moved, or lack one it has
  // since decided, so it is named until it is folded again — the test the
  // catch-up already uses to fold it again (`staleHour`), so a caught-up day
  // names none of them.
  const unrefreshed: number[] = [];
  let newestEarlier = -Infinity;
  for (const a of sorted) {
    if (a.brands[ids.brand] !== undefined && Number.isSafeInteger(a.builtAt) && a.builtAt < newestEarlier) unrefreshed.push(a.hour);
    if (Number.isSafeInteger(a.builtAt)) newestEarlier = Math.max(newestEarlier, a.builtAt);
  }
  const unassignedHours = [...new Set([...ungrouped, ...unplaced, ...stranded, ...unrefreshed])].sort((x, y) => x - y);
  const assignments = ungrouped.length === 0 ? hb.assignments : undefined;
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
  const visitorOutcomes: VisitorOutcomes | null = assignments && unassignedHours.length === 0
    ? { version: 1, basis: 'enrolled_visitors', arms: armNames.map(arm => ({ arm, visitors: assignments.visitors[arm] ?? 0,
      byType: Object.fromEntries(Object.entries(assignments.outcomes[arm] ?? {}).sort(([x], [y]) => x.localeCompare(y))) })) } : null;
  // The named outcomes, summed from the hours that carry this brand, and only
  // where every one of them can say: one hour folded before the member existed
  // makes the day's count unknowable, not smaller.
  const brandHours = sorted.flatMap((a) => (a.brands[ids.brand] ? [a.brands[ids.brand]!] : []));
  const namedOutcomes = brandHours.every((b) => validNamedOutcomes(b.named) !== null)
    ? brandHours.reduce((day, b) => addNamedOutcomes(day, validNamedOutcomes(b.named)!), emptyNamedOutcomes()) : null;
  const last = sorted[sorted.length - 1];
  const counts = { decisions: hb.decisions, outcomes: hb.outcomes, visitors: hb.visitorsDay, truncated: sorted.some((a) => a.truncated) || !!hb.visitorsIncomplete,
    ...(hb.duplicates ? { duplicates: hb.duplicates } : {}),
    // W30 F1.01 (W22 R124's residual, "`counts.conflicts` absent on the
    // aggregate path"): the same member the direct-record day already uses, and
    // omitted where there is no collision, exactly as `duplicates` is.
    ...(hb.conflicts ? { conflicts: hb.conflicts } : {}) };
  // W30 M1.01/R1.01: what each built hour IS, measured from its own end against
  // the published horizon. `repaired` is the hour whose aggregate was written
  // after it became final — a rebuild a caller asked for, or a first fold that
  // reached the hour late — so a repair can never quietly replace numbers an
  // analyst has already read as final.
  const maturityOf = (a: HourAggregate): 'open' | 'final' | 'repaired' => {
    const boundary = a.to + REFOLD_MATURITY_MS;
    if (Number.isSafeInteger(a.builtAt) && a.builtAt > boundary) return 'repaired';
    return now > boundary ? 'final' : 'open';
  };
  const carryInOf = (a: HourAggregate): { evicted: number; unplaced: number } | undefined => {
    const carry = a.brands[ids.brand]?.carryIn;
    return carry && Number.isSafeInteger(carry.evicted) && Number.isSafeInteger(carry.unplaced) ? carry : undefined;
  };
  const recoveryBounds = sorted.map(a => a.recoveryFrom).filter((v): v is number => Number.isSafeInteger(v) && Number(v) >= 0);
  const hours = { source: 'aggregates' as const, built: sorted.map((a) => a.hour), missing: [...opts.missing],
    ...(open.length ? { open: [...open].sort((a, b) => a.hour - b.hour).map(e => ({ ...e, ...(e.refusal ? { refusal: { ...e.refusal } } : {}) })) } : {}),
    ...(last ? { horizonMs: last.horizonMs } : {}) };
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
    namedOutcomes,
    erasures: { pending: opts.pending, rows_hidden: hb.rows_hidden },
    hours,
    coverage: reportCoverage({ counts, hours }, {
      version: 1, source: 'aggregates', truncated: counts.truncated, visitorsIncomplete: !!hb.visitorsIncomplete,
      unassignedHours,
      missingHours: hours.missing, truncatedHours: sorted.filter(a => a.truncated === true).map(a => a.hour),
      unadvancedHours: sorted.filter(a => a.ringsFolded === false).map(a => a.hour),
      unknownHours: sorted.filter(a => typeof a.ringsFolded !== 'boolean' || typeof a.truncated !== 'boolean').map(a => a.hour),
      horizons: sorted.map(a => ({ hour: a.hour, horizonMs: Number.isFinite(a.horizonMs) && a.horizonMs >= 0 ? a.horizonMs : null })),
      // W30: the honesty signals this batch adds, every one of them per BUILT
      // hour, in hour order, so the day, the pooled window and both screens
      // carry the same statement instead of it dying in the fold (F17 §3.4).
      refoldHorizonMs: REFOLD_MATURITY_MS,
      maturities: sorted.map(a => ({ hour: a.hour, maturity: maturityOf(a) })),
      lateAfterMaturity: sorted.filter(a => Number.isSafeInteger(a.lateObjects) && Number(a.lateObjects) > 0)
        .map(a => ({ hour: a.hour, objects: a.lateObjects! })),
      // An hour whose brand cannot say is simply not named here, exactly as an
      // hour that cannot name its assignment is not counted into a denominator.
      carryInHours: sorted.filter(a => carryInOf(a) !== undefined).map(a => ({ hour: a.hour, ...carryInOf(a)! })),
      objectScan: sorted.map(a => ({ hour: a.hour, objects: a.objects, read: a.objectsRead })),
      recoveryFromMs: recoveryBounds.length ? Math.max(...recoveryBounds) : undefined,
    }),
  };
  // W33 O3: a day summed from the folded hours is the canonical day, computed
  // under the policies the hours were folded with; it says which.
  report.provenance = dayProvenance(report, 'canonical');
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

/**
 * Lane E6: one ledger object as an open hour's working fold read it — its name,
 * the identity storage gave it, and its text exactly as the ledger holds it.
 */
export interface LedgerCopy { key: string; etag: string | null; size: number; text: string }
/**
 * An object as the working fold used it: whether it came from the copy, and the
 * visitors its rows name — each row's `visitor_id`, which is what an erasure
 * tombstone matches — so an erasure can be applied to the copy by name, with no
 * scan of its text.
 */
export interface ReadCopy extends LedgerCopy { held: boolean; visitors: string[] }
/** The listing's own word on an object, where storage gives one: a copy taken of another version is not used. */
interface Listed { etag?: string; size?: number }
const sameObject = (copy: LedgerCopy, listed: Listed | undefined): boolean =>
  listed !== undefined && (listed.etag !== undefined ? copy.etag === listed.etag : listed.size !== undefined ? copy.size === listed.size : true);
async function listObjects(r2: R2Like, prefix: string): Promise<Map<string, Listed>> {
  const out = new Map<string, Listed>(), cursors = new Set<string>();
  let cursor: string | undefined, visited = 0;
  do {
    aggregateBound('work', ++visited);
    const page = await r2.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) {
      aggregateBound('work', ++visited);
      const meta = o as { key: string; etag?: unknown; size?: unknown };
      out.set(o.key, { ...(etagShape(meta.etag) ? { etag: meta.etag } : {}), ...(Number.isSafeInteger(meta.size) && Number(meta.size) >= 0 ? { size: Number(meta.size) } : {}) });
    }
    if (page.truncated && (!page.cursor || cursors.has(page.cursor))) throw new ReportInputError();
    cursor = page.truncated ? page.cursor : undefined;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return out;
}

/**
 * The hour's ledger objects, one at a time and in time order, each decision reduced to what the fold keeps before the next object is opened; at most `cap` of them.
 *
 * Lane E6: `copies`, given only by an open hour's working fold, holds the
 * objects that fold has already read. An object the listing still names with the
 * same identity is taken from there instead of from storage, and charged to the
 * same raw budgets exactly as if it had been read, so the rows, the order, the
 * refusals and the aggregate are the ones a read of the ledger gives. Every
 * object used is handed back in `copies.read`, with the visitors its rows name;
 * `copies.listed`, where given, is the hour's listing the caller already made.
 * Without `copies` — the closed hour's fold — nothing here changes.
 *
 * W30 F1.01 (W22 R124's residual): `resolved` holds the collisions an operator
 * surface has already FILED; their rows are excluded and counted (`conflicts`)
 * instead of the hour refusing. Both folds pass it (`withFiledConflicts`).
 */
export async function loadHourRecords(r2: R2Like, tenant: string, date: string, hour: number, cap = MAX_HOUR_OBJECTS, resolved?: ResolvedConflicts,
  copies?: { held: ReadonlyMap<string, LedgerCopy>; read: ReadCopy[]; listed?: ReadonlyMap<string, Listed> }): Promise<{ decisions: CompactDecision[]; outcomes: OutcomeRecord[]; objects: number; read: number; truncated: boolean; source: string; duplicates?: DuplicateWitness[]; conflicts?: DuplicateWitness[] }> {
  const listed = copies ? copies.listed ?? await listObjects(r2, `${tenant}/${date}/${pad2(hour)}/`) : undefined;
  const all = (listed ? [...listed.keys()] : await listKeys(r2, `${tenant}/${date}/${pad2(hour)}/`)).filter(isLearningKey).sort((a, b) => (startOf(a) < startOf(b) ? -1 : startOf(a) > startOf(b) ? 1 : a < b ? -1 : 1));
  const keys = all.slice(0, cap);
  const decisions: CompactDecision[] = [], outcomes: OutcomeRecord[] = [];
  // W30 F1.01 (W22 R124's residual): the conflicts an operator surface has
  // already FILED are excluded and counted here, exactly as the day read does,
  // instead of the fold failing closed on them for ever. A conflict that is not
  // filed still refuses the hour, and the fold files nothing itself.
  const identity = new ReportRowIdentity(tenant, resolved), budget = { objects: 0, bytes: 0 };
  const contents: string[] = [];
  let lines = 0;
  for (const key of keys) {
    const stream = key.includes('/decision/') ? 'decision' : key.includes('/outcome/') ? 'outcome' : null;
    const copy = copies?.held.get(key), held = copy !== undefined && sameObject(copy, listed?.get(key)) ? copy : undefined;
    const obj = held ? { size: held.size, text: async () => held.text } : await r2.get(key);
    if (!obj) throw new ReportUnavailableError();
    const text = await rawText(obj, budget);
    const visitors = copies ? new Set<string>() : undefined;
    contents.push(await fingerprint(text));
    if (stream) {
      let offset = 0;
      while (offset < text.length) {
        aggregateBound('work', ++lines);
        const end = text.indexOf('\n', offset), line = text.slice(offset, end < 0 ? text.length : end); offset = end < 0 ? text.length : end + 1;
        if (!line) continue;
        let rec: unknown;
        try { rec = JSON.parse(line); } catch { throw new ReportInputError(); }
        if (visitors && objectMap(rec) && typeof rec.visitor_id === 'string') visitors.add(rec.visitor_id);
        if (!identity.admit(rec, stream)) continue;
        if (stream === 'decision') decisions.push(compactOf(rec as DecisionRecord)); else outcomes.push(rec as OutcomeRecord);
      }
    }
    if (copies) copies.read.push({ ...(held ?? { key, etag: etagShape(obj.etag) ? obj.etag : null, size: aggregateBytes(text), text }), held: held !== undefined, visitors: [...visitors!] });
  }
  const duplicates = identity.duplicates(), conflicts = identity.conflictRows();
  return { decisions, outcomes, objects: all.length, read: keys.length, truncated: all.length > keys.length,
    source: await fingerprint(JSON.stringify([all, cap, contents])), ...(duplicates.length ? { duplicates } : {}),
    ...(conflicts.length ? { conflicts } : {}) };
}

export interface BuildOptions { horizonMs?: number; ringCap?: number; shards?: number; maxObjects?: number }

/** W30 F1.01: at most this many filed collisions one fold of one hour reads past; beyond it the hour refuses. */
export const HOUR_CONFLICTS = 8;
/**
 * W30 F1.01 (W22 R124's residual, "the hourly fold still fails closed unnamed
 * on a collision"): run `load` until it reads the hour with every collision an
 * operator surface has already FILED excluded and counted. Nothing is filed
 * here — no fold is an operator surface — and a conflict that is not filed, or
 * a filing store this caller was given no bindings for, still refuses the hour.
 * The final fold and the open hour's working fold read one hour's collisions
 * through this one rule (ruling L-R5), so a working aggregate excludes and
 * counts a filed row exactly where the hour's final aggregate will.
 */
async function withFiledConflicts<T>(retentionEnv: RetentionEnv | undefined, load: (resolved: ResolvedConflicts) => Promise<T>): Promise<T> {
  const resolved = new Set<string>();
  for (let attempt = 0; ; attempt++) {
    try { return await load(resolved); }
    catch (error) {
      if (!(error instanceof ReportRowConflict) || attempt >= HOUR_CONFLICTS) throw error;
      const key = conflictKey(error.stream, error.id);
      if (resolved.has(key) || !await filedConflict(retentionEnv, error.stream, error.id)) throw error;
      resolved.add(key);
    }
  }
}
/**
 * W30 F1.01: has this exact collision already been FILED on the operator
 * surface? The fold never files one itself, and answers no — so the hour keeps
 * the closed refusal it has always had — when the caller was given no filing
 * store to read, when the store is unconfigured, or when the read fails.
 */
async function filedConflict(env: RetentionEnv | undefined, stream: LedgerStream, id: string): Promise<boolean> {
  const bindings = env as Partial<Env> | undefined;
  if (!bindings?.LEDGER_RECOVERY_CONFIG || !bindings.STORAGE) return false;
  try { return await readConflictFiled(bindings as Env, stream, id); } catch { return false; }
}

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
  for (const brands of Object.values(state.seenDaysRetention ?? {})) for (const values of Object.values(brands))
    for (const stamp of Object.values(values)) readRetention(stamp, tenant, 'hourly');
  for (const brands of Object.values(state.deferred ?? {})) for (const record of Object.values(brands))
    for (const carry of Object.values(record)) if (carry.retention !== undefined) readRetention(carry.retention, tenant, 'hourly');
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
  // W22 R4 (R143): and an archived id whose hourly retention has ended leaves
  // it too, exactly as a current one leaves `seen` above. An id with no stamp
  // is legacy and is never disposed of on that ground.
  for (const [date, brands] of Object.entries(next.seenDays ?? {})) {
    for (const [brand, ids] of Object.entries(brands)) {
      const stamps = next.seenDaysRetention?.[date]?.[brand];
      brands[brand] = ids.filter(visitor => !tombs.has(visitor)
        && (stamps?.[visitor] === undefined || readRetention(stamps[visitor], tenant, 'hourly').expiresAt > now));
    }
    if (!Object.keys(brands).length) delete next.seenDays![date];
  }
  if (next.seenDays && !Object.keys(next.seenDays).length) delete next.seenDays;
  pruneSeenDaysRetention(next);
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
  // W30 P1: the carry-in memory holds ids the membership does not yet, so it is
  // erased and expired on its own terms, and an erased earliest decision leaves.
  eraseDeferred(next, tombs, { tenant, now });
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

/**
 * The rows of a loaded hour the fold counts: an erased visitor's rows hidden, a
 * decision recorded under another measurement basis than its slot's set aside.
 * Shared by the closed hour's fold and the open hour's working fold, so the two
 * read one hour the same way.
 */
function foldableRows(loaded: { decisions: CompactDecision[]; outcomes: OutcomeRecord[] }, tombs: ReadonlyMap<string, Tombstone>,
  slotCfg: Record<string, SlotLearnConfig>): { decisions: CompactDecision[]; outcomes: OutcomeRecord[] } {
  const decisions = withoutErased(loaded.decisions, tombs).filter(d => (d.entry.measurementBasis ?? 'served-v1') === (slotCfg[d.entry.slot]?.measurementBasis ?? 'served-v1')), outcomes = withoutErased(loaded.outcomes, tombs);
  return { decisions, outcomes };
}

/**
 * Phase one over the hour's rows, before any shard is visited: the decisions'
 * counts and exposures, the duplicates, the filed collisions excluded (W30
 * F1.01), the outcomes and named outcomes, the rows an erasure hid, and each
 * brand's carry-in at zero (W30 V1.01). Shared by the final fold and the open
 * hour's working fold, so both say the same of one hour.
 */
function hourBrands(loaded: { decisions: CompactDecision[]; outcomes: OutcomeRecord[]; duplicates?: DuplicateWitness[]; conflicts?: DuplicateWitness[] }, decisions: readonly CompactDecision[],
  outcomes: readonly OutcomeRecord[], tombs: ReadonlyMap<string, Tombstone>, policies: readonly RolePolicy[], statsCfg: StatsConfig): Record<string, HourBrand> {
  const brands = foldDecisions(decisions, policies, statsCfg);
  for (const duplicate of loaded.duplicates ?? []) if (!hidden(tombs, duplicate)) {
    const counts = (brands[duplicate.brand] ??= emptyBrand()).duplicates ??= { decisions: 0, outcomes: 0 };
    counts[duplicate.stream === 'decision' ? 'decisions' : 'outcomes'] += duplicate.count;
  }
  // W30 F1.01: the filed collisions this hour excluded, named by the brand they
  // belong to, in the vocabulary `duplicates` above already uses.
  for (const conflict of loaded.conflicts ?? []) if (!hidden(tombs, conflict)) {
    const counts = (brands[conflict.brand] ??= emptyBrand()).conflicts ??= { decisions: 0, outcomes: 0 };
    counts[conflict.stream === 'decision' ? 'decisions' : 'outcomes'] += conflict.count;
  }
  for (const o of outcomes) {
    const hb = (brands[o.brand] ??= emptyBrand());
    hb.outcomes += 1;
    const named = namedOutcomeRow((hb.named ??= emptyNamedOutcomes()), o);
    if (named) named.outcomes += 1;
  }
  if (tombs.size) {
    for (const d of loaded.decisions) if (hidden(tombs, d)) (brands[d.entry.brand] ??= emptyBrand()).rows_hidden += 1;
    for (const o of loaded.outcomes) if (hidden(tombs, o)) (brands[o.brand] ??= emptyBrand()).rows_hidden += 1;
  }
  // W30 V1.01: every brand of every hour this build folds says what its
  // carry-in was, zero included, before the shards are folded onto it; absence
  // stays the statement that an hour folded before this release cannot say.
  for (const hb of Object.values(brands)) { for (const p of policies) policyHour(hb, p); hb.carryIn ??= { evicted: 0, unplaced: 0 }; }
  return brands;
}

/**
 * After one shard has folded the hour: the date's distinct visitors it holds, by
 * brand and by assignment, the outcomes decided through this hour (W30 P1), and
 * the hours of the date holding a remembered outcome memory can no longer place.
 */
function countMembership(brands: Record<string, HourBrand>, unaccounted: Set<string>, stranded: Map<string, Set<number>>, state: ShardState, date: string, hour: number): void {
  // W22 R1.02: the day this hour belongs to, which for a repaired older hour
  // is its own date's membership and not the newer one the shard has moved on
  // to. The per-brand uncertainty flag belongs to the current date, which is
  // the only date that carries the witnesses it is derived from.
  for (const [brand, ids] of Object.entries(seenOn(state, date))) {
    const hb = (brands[brand] ??= emptyBrand());
    hb.visitorsDay += ids.length;
    // W21 C1.08: the same membership, split by ASSIGNMENT. A shard that cannot
    // account for every id it just counted — a state written before this
    // release holds the ids and not the assignments — makes the whole brand's
    // hour unable to say, because a denominator drawn from part of a
    // membership is a wrong number, not a smaller one.
    const record = state.enrollment?.[date]?.[brand] ?? {};
    if (ids.some(visitor => !record[visitor]?.arms.length)) { unaccounted.add(brand); continue; }
    const ha = (hb.assignments ??= emptyAssignments());
    const carried = state.deferred?.[date]?.[brand];
    for (const visitor of ids) {
      const enrolled = record[visitor]!;
      for (const arm of enrolled.arms) ha.visitors[arm] = (ha.visitors[arm] ?? 0) + 1;
      // W30 P1 (delivery re-review): the rows decided through THIS hour only
      // (`outcomesOf`), so an earlier hour folded again between a later
      // hour's placement and the fold that moves it never keeps the old row.
      for (const [arm, types] of Object.entries(outcomesOf(enrolled, carried?.[visitor], pad2(hour)) ?? {})) {
        const byType = (ha.outcomes[arm] ??= {});
        for (const type of types) byType[type] = (byType[type] ?? 0) + 1;
      }
    }
  }
  if (state.seenDate === date) for (const brand of Object.keys(state.seenIncomplete ?? {})) (brands[brand] ??= emptyBrand()).visitorsIncomplete = true;
  // W30 P1 (delivery review defect 2): what memory can no longer place, as of this fold.
  for (const brand of Object.keys(state.deferred?.[date] ?? {})) {
    const hours = strandedOf(state, date, brand);
    if (hours.length) { const known = stranded.get(brand) ?? new Set<number>(); stranded.set(brand, known); for (const h of hours) known.add(h); }
  }
}

/** Every shard visited: each brand's policies, assignments, named outcomes and recorded computation, as the aggregate carries them. */
function closeBrands(brands: Record<string, HourBrand>, policies: readonly RolePolicy[], learn: LearnConfig, unaccounted: ReadonlySet<string>,
  stranded: ReadonlyMap<string, ReadonlySet<number>>, creditedSlots: ReadonlyMap<string, Set<string>>, horizonMs: number, ringCap: number): void {
  for (const [brand, b] of Object.entries(brands)) {
    for (const p of policies) policyHour(b, p);
    // W21 C1.08: the hour says what the assignment was, or it says nothing at
    // all. An hour with no decisions still says so — its empty answer is the
    // truth — and one whose membership this fold could not account for withdraws
    // the member entirely, which is what `coverage.unassignedHours` then names.
    if (unaccounted.has(brand)) delete b.assignments; else b.assignments ??= emptyAssignments();
    const strandedHours = [...(stranded.get(brand) ?? [])].sort((x, y) => x - y);
    if (b.assignments && strandedHours.length) b.assignments.strandedHours = strandedHours;
    b.named ??= emptyNamedOutcomes();
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
  // W30 F1.01 (W22 R124's residual, "the hourly fold still fails closed unnamed
  // on a collision"): a collision an operator surface has already filed is read
  // again with the row excluded and COUNTED. Nothing is filed here — the fold is
  // not an operator surface — and a conflict that is not filed, or a filing
  // store this caller was given no bindings for, still refuses the hour.
  const [loaded, tombs] = await withFiledConflicts(retentionEnv, resolved =>
    Promise.all([loadHourRecords(r2, tenant, at.date, at.hour, options.maxObjects, resolved), loadTombstones(r2, tenant)]));
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
  const { decisions, outcomes } = foldableRows(loaded, tombs, slotCfg);
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
      for (const brands of Object.values(state.deferred ?? {})) for (const record of Object.values(brands))
        for (const carry of Object.values(record)) admittedRetention.push(requireRetention(retentionEnv, carry.retention, tenant, 'hourly'));
    }
  }
  const brands = hourBrands(loaded, decisions, outcomes, tombs, policies, statsCfg);
  const byShardD = new Map<number, CompactDecision[]>(), byShardO = new Map<number, OutcomeRecord[]>();
  for (const d of decisions) { const s = shardOf(d.visitor_id, shards); const list = byShardD.get(s) ?? []; list.push(d); byShardD.set(s, list); }
  for (const o of outcomes) { const s = shardOf(o.visitor_id, shards); const list = byShardO.get(s) ?? []; list.push(o); byShardO.set(s, list); }
  const creditedSlots = new Map<string, Set<string>>();
  // W22 R1.02 (F17 P1): this hour has an aggregate and the hour's prefix now
  // holds MORE objects than that fold read, so it is being rebuilt against rows
  // it has not seen and those rows may still join the rings. A rebuild of an
  // unchanged hour admits nothing, exactly as a replay always did.
  //
  // W30 R1.01 (F17 P6): or this fold OPENED more of the hour than the stored
  // one did, because the cap the caller asked for is higher. F17 measured the
  // half that was missing: "the rebuild recovers the counts and clears the
  // `truncated` flag, but `folded` is false" — the recovered decisions never
  // reached the rings, so the cross-hour credit stayed lost while the report
  // looked more complete. The same admission rule covers both: what the rings
  // do not already hold is what a re-fold may add, so a rebuild that finds
  // nothing new still leaves `ringsFolded` false.
  let refold = false;
  if (!pending && aggregate.body !== null) {
    try {
      const previous: unknown = JSON.parse(aggregate.body);
      refold = objectMap(previous) && Number.isSafeInteger(previous.objects) && Number.isSafeInteger(previous.objectsRead)
        && (loaded.objects > (previous.objects as number) || loaded.read > (previous.objectsRead as number));
    } catch { refold = false; }
  }
  // W22 R4 (R143): the fold is dated by nothing it reads — the aggregate carries
  // `builtAt` and the cleanup that follows expires by its own clock — so the
  // context no longer carries a `now` no fold ever read.
  const ctx: FoldContext = { tenant, date: at.date, from, to, refold, policies, slotCfg, statsCfg, horizonMs, ringCap, tombs, brands, creditedSlots,
    retainedIds: new Set(), retainedBudget: { work: 0, bytes: 0 }, incomingIds: new Set(decisions.map(d => d.entry.id)) };
  // P05 (R-P20, R-P62): the position weights, read shard by shard below for the placements of the decisions that name a position.
  const positions = positionHistories(r2, tenant);
  ctx.positionWeight = positions.weight;
  let ringsFolded = true;
  /** W30 F1.01 (W22 R143): the earliest hour any of these shards could still admit. */
  let recoveryFrom = 0;
  /** W21 C1.08: brands whose date membership this fold could not account for assignment by assignment. */
  const unaccounted = new Set<string>();
  /** W30 P1: brand → the hours of this date holding a remembered outcome memory can no longer place. */
  const stranded = new Map<string, Set<number>>();
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
    // P05 (R-P62): the histories of the placements this shard's decisions and rings name a position on.
    await positions.load([...(byShardD.get(s) ?? []).map(d => d.entry), ...Object.values(state.rings).flat()]);
    const r = foldShard(state, byShardD.get(s) ?? [], byShardO.get(s) ?? [], ctx);
    if (!r.folded) ringsFolded = false;
    // W30 F1.01 (W22 R143): a shard's floor is the hour below which it will
    // never admit a decision again — a version-1 state's `through` exactly — so
    // the earliest hour a repair can still put into these rings is the hour
    // above the LATEST floor of the shards this fold visited.
    if (r.floor >= 0) recoveryFrom = Math.max(recoveryFrom, r.floor + HOUR_MS);
    countMembership(brands, unaccounted, stranded, r.state, at.date, at.hour);
    // Preserve the established no-change through/seen body. Changed bodies get a
    // nonce too: a later replay must never recreate an old conditional-write ETag.
    let body = original;
    if (r.changed || s === 0 || r.deferredChanged) {
      const next = r.changed ? r.state : shardState(original, s);
      // W30 P1: an otherwise unchanged fold writes only what it remembered.
      if (!r.changed && r.deferredChanged) { if (r.state.deferred) next.deferred = r.state.deferred; else delete next.deferred; }
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
  closeBrands(brands, policies, learn, unaccounted, stranded, creditedSlots, horizonMs, ringCap);
  const agg: HourAggregate = { version: 1, generation, tenant, date: at.date, hour: at.hour, from, to, builtAt: now, objects: loaded.objects, objectsRead: loaded.read, truncated: loaded.truncated, horizonMs, shards, ringsFolded, recoveryFrom, brands };
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
  /**
   * W33 O2: a date whose conditional write was refused — another write reached
   * the day after this run noted it — is not `published` by this run; it is
   * `failed` with the error `day report superseded by a concurrent publication`,
   * nothing is written, and the next run checks the date again.
   */
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
/**
 * W30 R1.01 and M1.01 extend the verdict with the two cases this batch rules:
 *
 *  · the stored fold was cut short by a cap and THIS run may open more of the
 *    hour than it read. A cap raise is an explicit repair the caller asked for,
 *    so it is not bounded by the maturity window below, and it converges: the
 *    rebuild reads `min(objects, cap)` and then `cap > objectsRead` is false.
 *  · the prefix has grown but the hour is past its published re-fold horizon.
 *    The hour is final by DECLARATION: the grown objects are counted onto the
 *    aggregate as `lateObjects` and applied nowhere, so they are neither
 *    silently applied to numbers an analyst has read nor silently dropped.
 */
interface HourVerdict {
  refold: boolean;
  late?: { body: string; etag: string | null };
  /**
   * W30 L1 (adoption defect D1): the late objects the stored aggregate carries
   * once this probe's own write (if any) lands — `0` where it names none. The
   * catch-up compares it with the published day, because the day a late row
   * reaches is otherwise never published again: no hour of it is built.
   * Absent where the probe could not read the aggregate.
   */
  lateObjects?: number;
}
async function staleHour(r2: R2Agg, tenant: string, which: { date: string; hour: number },
  builtAt: Map<number, number>, earlierBuiltInRun: boolean, cap: number, now: number): Promise<HourVerdict> {
  const at = { ...which, from: hourStart(which.date, which.hour) };
  let objects: number, mine: number;
  try {
    objects = (await listKeys(r2, `${tenant}/${at.date}/${pad2(at.hour)}/`)).filter(isLearningKey).length;
    const stored = await readHourBody(r2, hourKey(tenant, at.date, at.hour));
    if (stored.body === null) return { refold: false };
    const agg: unknown = JSON.parse(stored.body);
    if (!objectMap(agg) || !Number.isSafeInteger(agg.objects) || !Number.isSafeInteger(agg.builtAt)) return { refold: false };
    mine = agg.builtAt as number;
    builtAt.set(at.from, mine);
    if (agg.truncated === true && Number.isSafeInteger(agg.objectsRead) && cap > (agg.objectsRead as number)) return { refold: true };
    if (objects > (agg.objects as number)) {
      if (now <= at.from + HOUR_MS + REFOLD_MATURITY_MS) return { refold: true };
      const late = objects - (agg.objects as number);
      if (agg.lateObjects === late) return { refold: false, lateObjects: late };
      return { refold: false, late: { body: JSON.stringify({ ...agg, lateObjects: late }), etag: stored.etag }, lateObjects: late };
    }
    const named = Number.isSafeInteger(agg.lateObjects) && (agg.lateObjects as number) > 0 ? agg.lateObjects as number : 0;
    return { refold: earlierBuiltInRun || [...builtAt].some(([from, when]) => from < at.from && when > mine), lateObjects: named };
  } catch { return { refold: false }; }
}

/**
 * W30 L1 (adoption defect D1): does the saved day name, for every hour this run
 * probed, exactly the late objects that hour's aggregate now carries? A late row
 * that reaches a FINAL hour is counted onto the hour and applied nowhere, so no
 * hour of its date is built again and matching hour membership alone would keep
 * the day as first published for ever. A day that says less — or more, or
 * nothing because it was written before the member existed — is republished.
 */
function namesLateObjects(report: DayReport | null, late: ReadonlyMap<number, number> | undefined): boolean {
  if (!late?.size) return true;
  const rows = report?.coverage?.lateAfterMaturity;
  const saved = new Map<number, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (objectMap(row) && Number.isInteger(row.hour) && Number.isSafeInteger(row.objects)) saved.set(row.hour as number, row.objects as number);
  }
  for (const [hour, objects] of late) if ((saved.get(hour) ?? 0) !== objects) return false;
  return true;
}

/**
 * A saved summary proves only exact known hour membership, not content or policy freshness.
 * Lane E6: an hour the summary names as `open` stands for its working aggregate, which the
 * open-hour fold republishes as it changes, so only the final hours are compared here — and
 * only while that hour is still open (`openNow`): once it is not, the summary says something
 * no longer true of it (an hour refused at its final fold would stay summed from its working
 * aggregate), and the date is published again.
 */
function hasReportedHours(report: DayReport | null, expected: ReadonlySet<number>, openNow: ReadonlySet<number>): boolean {
  const hours = report?.hours;
  if (hours?.source !== 'aggregates' || !Array.isArray(hours.built) || hours.built.length > 24) return false;
  const open: unknown = hours.open ?? [];
  if (!Array.isArray(open) || open.length > 24) return false;
  const named = new Set<number>();
  for (const entry of open as unknown[]) {
    if (!objectMap(entry) || typeof entry.hour !== 'number' || named.has(entry.hour) || !openNow.has(entry.hour)) return false;
    named.add(entry.hour);
  }
  const seen = new Set<number>();
  let final = 0;
  for (let i = 0; i < hours.built.length; i++) {
    const h = hours.built[i];
    if (!Object.hasOwn(hours.built, i) || typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23 || seen.has(h)) return false;
    seen.add(h);
    if (named.has(h)) continue;
    if (!expected.has(h)) return false;
    final++;
  }
  return final === expected.size;
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
  // for a re-fold, not for a first one. They cost a listing and a point read
  // each and only while the run has budget for them, and a re-fold appears in
  // `built` like any other hour: the result keeps exactly the members it had.
  //
  // W30 P1 (delivery review defect 1): every candidate is taken in TIME order,
  // a missing hour and a re-fold alike. A re-fold taken after a later missing
  // hour of the same run left that later hour folded against the state before
  // the re-fold, with the same `builtAt`, so nothing ever folded it again — an
  // outcome the re-fold moved to another row stayed counted on the old one too.
  const settled = candidates.filter((c) => existing.has(hourKey(tenant, c.date, c.hour)));
  const builtAt = new Map<number, number>();
  const work = [...(interrupted ? [interrupted] : []),
    ...candidates.filter(c => !interrupted || c.date !== interrupted.date || c.hour !== interrupted.hour)];
  // An interrupted hour is never a re-fold candidate: its transaction has to
  // finish, whatever its aggregate says.
  const rebuild = new Set(settled.filter(c => !interrupted || c.date !== interrupted.date || c.hour !== interrupted.hour)
    .map(c => hourKey(tenant, c.date, c.hour)));
  const built: CatchUpResult['built'] = [], failed: CatchUpResult['failed'] = [];
  /** W30 L1: date → hour → the late objects a probed hour's aggregate carries after this run. */
  const lateByDate = new Map<string, Map<number, number>>();
  let budget = opts.budget ?? RUN_BUDGET;
  let otherFailures = 0;
  for (const c of work) {
    if (built.length >= (opts.maxHours ?? 2) || budget <= 0) break;
    // This hour's calls, counted through the engine's one counting wrapper, which
    // hands storage each call whole (lane E6).
    const spent = { calls: 0 };
    const metered: R2Agg = countedStorage(r2, spent).storage;
    try {
      // An hour that already has an aggregate is rebuilt only when that
      // aggregate no longer describes it; the probe is charged to this run's
      // budget like any other work, and a quiet catch-up writes nothing.
      if (rebuild.has(hourKey(tenant, c.date, c.hour))) {
        const verdict = await staleHour(metered, tenant, c, builtAt, built.some(b => hourStart(b.date, b.hour) < hourStart(c.date, c.hour)),
          opts.maxObjects ?? MAX_HOUR_OBJECTS, now);
        // W30 M1.01: the only write a quiet catch-up can make, and only when a
        // FINAL hour's prefix has really grown since the fold read it. It is
        // conditional on the aggregate this run saw, and idempotent: the count
        // it writes is the count it has just observed.
        let lateObjects = verdict.lateObjects;
        if (verdict.late) {
          try { await conditionalBody(metered, hourKey(tenant, c.date, c.hour), verdict.late.body, verdict.late.etag); }
          catch { lateObjects = undefined; /* a lost race leaves the rows in the ledger and is named on the next run */ }
        }
        // W30 L1: what the hour now names, so the day publication below can see
        // that a date no hour of which was built still has to be published again.
        if (!verdict.refold && lateObjects !== undefined) {
          const hours = lateByDate.get(c.date) ?? new Map<number, number>();
          hours.set(c.hour, lateObjects); lateByDate.set(c.date, hours);
        }
        if (!verdict.refold) continue;
      }
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
      budget -= spent.calls + 1;
    }
  }
  // The default 26-hour lookback spans at most three dates. Longer custom windows explicitly defer
  // older dates; this bounds summary reads and aggregate publications without claiming backfill.
  const dates = [...dateHours.keys()].filter(date => dateHours.get(date)!.size).sort();
  const reports: CatchUpResult['reports'] = { published: [], failed: [], deferred: dates.slice(0, -3) };
  if (interrupted && !dateHours.has(interrupted.date)) reports.deferred.push(interrupted.date);
  const builtDates = new Set(built.map(b => b.date)), summaryBudget = { bytes: 0, cells: 0 };
  for (const date of dates.slice(-3)) {
    // The tenant's own day is the date's publication record: it is written last,
    // after the day of every other brand the date's hour aggregates carry
    // (`publishAggregateDate`), so a saved day that names every built hour means
    // every brand of that date was published by the same run.
    const ids = { tenant, brand: tenant, date };
    try {
      // W33 O2: the day object this run notes before it reads the date's
      // aggregates. Where it read the saved summary, the note is the etag of
      // that very object; for a date it folded, publication notes the object
      // itself, after the folds and before it lists the aggregates.
      let note: CanonicalNote | undefined;
      if (!builtDates.has(date)) {
        // W30 L1 (adoption defect D1): a saved day is left alone only while it
        // has every built hour AND names the late objects every hour probed this
        // run carries; a late row past the re-fold horizon republishes its date.
        // Lane E6: an hour it names open is compared only while it is still open.
        const openNow = new Set(openHours(now).filter(at => at.date === date).map(at => at.hour));
        const saved = await readCanonicalSummary(r2, ids, summaryBudget);
        if (hasReportedHours(saved.report, dateHours.get(date)!, openNow) && namesLateObjects(saved.report, lateByDate.get(date))) continue;
        note = { etag: saved.etag };
      }
      // W37 T2 with lane E6: every brand the date's final hours or its open hours carry, the open hours named and counted on each day.
      const published = await publishAggregateDate(r2, tenant, date, learn, now, { note });
      if (published.written) reports.published.push(date);
      else reports.failed.push({ date, error: 'day report superseded by a concurrent publication' });
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

// ── the open hour (lane E6) ───────────────────────────────────────────────────
//
// A closed hour is folded once, five minutes after it ends, and until then its
// records are only on the ledger: a day report either left that hour out or —
// on a day with no folded hour yet — read the whole day's raw, which one busy
// day is more than a report may read. So the five-minute job also folds the hour
// that is still open into a WORKING aggregate, beside the final ones: the same
// fold, over the objects the queue has written so far, against the shards as
// they stand, written to its own key and never into the shards. The hour's final
// fold is untouched: it reads the ledger itself, as it always has, and once the
// hour's final fold is due the working objects are removed.
//
// What the job keeps for an open hour, under `aggregates/<tenant>/open/<date>/`:
//
//  · `<hh>.json`, the working aggregate: an `HourAggregate`, the shape a final
//    hour has;
//  · `<hh>.ledger.<id>`, the hour's ledger copy, in segments: the objects a fold
//    read from the ledger, as the ledger holds them, so the next fold reads from
//    the ledger only what the queue wrote since;
//  · `<hh>.state.json`, the hour's state: how its latest fold ended (current, or
//    refused and why), the BASIS that fold read — a digest of the hour's ledger
//    listing, the erasures, the shards and the configuration, every input of the
//    fold, as storage identifies them — and the copy's index: each segment's
//    objects, and the visitors their rows name.
//
// The job is their only writer. On every run it first applies the erasures to
// the copy, by name, whatever the fold then does; it then folds only an hour
// whose basis has changed, so a tenant with nothing new reads no shard and no
// ledger object, and an hour refused for a reason the same inputs give again is
// not folded again only to be refused again. A report build reads them and
// writes none: it folds an hour again, in memory, only where the basis has
// changed since the job's run, reading from the ledger only what the copy does
// not hold, and names every open hour as it stands — current, or refused.

/** An open hour's working aggregate: an `HourAggregate`, the shape a final hour has. */
export const openKey = (tenant: string, date: string, hour: number) => `aggregates/${tenant}/open/${date}/${pad2(hour)}.json`;
/** An open hour's ledger copy, in segments: `openLedgerKey` names the hour's segments; each is `<that>.<id>`. */
export const openLedgerKey = (tenant: string, date: string, hour: number) => `aggregates/${tenant}/open/${date}/${pad2(hour)}.ledger`;
/** An open hour's state: how its latest working fold ended, on what basis, and the index of its ledger copy. */
export const openStateKey = (tenant: string, date: string, hour: number) => `aggregates/${tenant}/open/${date}/${pad2(hour)}.state.json`;
const openPrefix = (tenant: string) => `aggregates/${tenant}/open/`;
const ringsPrefix = (tenant: string) => `aggregates/${tenant}/rings/`;

/**
 * The hours a working aggregate stands for at `now`, oldest first: the hour that
 * is open, and the hour before it until its own fold is due — `CLOSE_GRACE_MS`
 * after it ends, the moment `closedHours` and `loadHours` first name it. Pure.
 */
export function openHours(now: number): Array<{ date: string; hour: number; from: number }> {
  const current = hourOf(now), out: Array<{ date: string; hour: number; from: number }> = [];
  if (now < current.from + CLOSE_GRACE_MS) { const previous = hourOf(current.from - HOUR_MS); out.push({ date: previous.date, hour: previous.hour, from: previous.from }); }
  out.push({ date: current.date, hour: current.hour, from: current.from });
  return out;
}

/** One segment of an hour's ledger copy as the hour's state indexes it: its objects, and every visitor their rows name. */
interface CopySegment { key: string; objects: Array<{ key: string; etag: string | null; size: number; length: number }>; visitors: string[] }
/** An open hour's state (`openStateKey`). */
interface OpenHourState {
  version: 1; tenant: string; date: string; hour: number;
  /**
   * The digest of everything the latest fold read. Null where storage did not
   * identify all of it, or the fold failed for a reason that may pass: the next
   * run folds again.
   */
  basis: string | null;
  status: 'current' | 'refused';
  /** When the standing working aggregate's fold read the ledger; null where none stands. */
  through: number | null;
  /** The standing working aggregate's write identity, and a digest of what it says. */
  generation: string | null;
  content: string | null;
  refusal?: OpenHourRefusal;
  segments: CopySegment[];
}
/** An open hour as a day report sums and names it. */
export interface OpenHourView { date: string; hour: number; status: 'current' | 'refused'; through: number | null; refusal?: OpenHourRefusal; agg?: HourAggregate }

function openState(body: string, tenant: string, at: { date: string; hour: number }): OpenHourState | null {
  let v: unknown;
  try { v = JSON.parse(body); } catch { return null; }
  if (!objectMap(v) || v.version !== 1 || v.tenant !== tenant || v.date !== at.date || v.hour !== at.hour
    || (v.basis !== null && !hashShape(v.basis)) || (v.status !== 'current' && v.status !== 'refused')
    || (v.through !== null && !(Number.isSafeInteger(v.through) && Number(v.through) >= 0))
    || (v.generation !== null && !generationShape(v.generation)) || (v.content !== null && !hashShape(v.content))
    || (v.status === 'refused') !== (v.refusal !== undefined) || (v.refusal !== undefined && !openRefusal(v.refusal))
    || (v.status === 'current' && (v.generation === null || v.through === null))
    || !Array.isArray(v.segments) || v.segments.length > MAX_HOUR_OBJECTS) return null;
  const prefix = `${tenant}/${at.date}/${pad2(at.hour)}/`, base = openLedgerKey(tenant, at.date, at.hour) + '.';
  for (const segment of v.segments as unknown[]) {
    if (!objectMap(segment) || typeof segment.key !== 'string' || !segment.key.startsWith(base) || !/^[0-9a-z]{1,16}$/.test(segment.key.slice(base.length))
      || !Array.isArray(segment.objects) || segment.objects.length > MAX_HOUR_OBJECTS
      || !Array.isArray(segment.visitors) || !segment.visitors.every(id => typeof id === 'string')) return null;
    for (const o of segment.objects as unknown[]) if (!objectMap(o) || typeof o.key !== 'string' || !o.key.startsWith(prefix) || !isLearningKey(o.key)
      || (o.etag !== null && !etagShape(o.etag)) || !Number.isSafeInteger(o.size) || Number(o.size) < 0
      || !Number.isSafeInteger(o.length) || Number(o.length) < 0) return null;
  }
  return v as unknown as OpenHourState;
}
/** An hour's state, or null where it has none that can be read. */
async function readOpenState(r2: R2Like, tenant: string, at: { date: string; hour: number }): Promise<OpenHourState | null> {
  try {
    const obj = await r2.get(openStateKey(tenant, at.date, at.hour));
    return obj === null ? null : openState(await storedReportText(obj, { bytes: 0, cells: 0 }, 'aggregateBytes', 'aggregateBytes'), tenant, at);
  } catch { return null; }
}
const putOpenState = (r2: R2Agg, state: OpenHourState) =>
  r2.put(openStateKey(state.tenant, state.date, state.hour), JSON.stringify(state), { httpMetadata: { contentType: 'application/json' } });

/** The working aggregate the hour's state says stands, or nothing where it cannot be read as that one. */
async function standingAggregate(r2: R2Like, tenant: string, at: { date: string; hour: number }, state: OpenHourState | null): Promise<HourAggregate | undefined> {
  if (!state?.generation) return undefined;
  try {
    const obj = await r2.get(openKey(tenant, at.date, at.hour));
    if (obj === null) return undefined;
    const a: unknown = JSON.parse(await storedReportText(obj, { bytes: 0, cells: 0 }, 'aggregateBytes', 'aggregateBytes'));
    aggregateIdentity(a, { tenant, date: at.date }, at.hour);
    return a.generation === state.generation ? a : undefined;
  } catch { return undefined; }
}
/**
 * An hour as its state names it. A current hour is summed from its standing
 * working aggregate, and is not named where that cannot be read; a refused one is
 * named with its refusal, and summed — stale, and saying so — only where an
 * earlier fold stands.
 */
function viewOf(at: { date: string; hour: number }, state: OpenHourState, agg: HourAggregate | undefined): OpenHourView | null {
  if (state.status === 'current') return agg ? { date: at.date, hour: at.hour, status: 'current', through: state.through, agg } : null;
  return { date: at.date, hour: at.hour, status: 'refused', refusal: state.refusal!, through: agg ? state.through : null, ...(agg ? { agg } : {}) };
}

/** Why a working fold failed, as the hour's state and the day report name it; nothing that names a visitor. */
function refusalOf(error: unknown, at: number): OpenHourRefusal {
  if (error instanceof ReportBudgetExceeded) return { at, error: error.message, code: error.code, budget: error.budget, limit: error.limit, observed: error.observed };
  if (error instanceof ReportRowConflict) return { at, error: error.message, code: error.code, conflict: { stream: error.stream } };
  if (error instanceof OpenHourDeferred) return { at, error: error.message, code: 'hourly_fold_in_progress' };
  if (error instanceof RetentionUnavailable) return { at, error: error.message, code: 'retention_unavailable' };
  if (error instanceof ReportInputError) return { at, error: error.message, code: 'report_input_invalid' };
  return { at, error: 'working fold unavailable', code: 'report_unavailable' };
}
/** A refusal the same inputs give again, so it is kept with the fold's basis: an unchanged hour is not folded again only to be refused again. */
const settledRefusal = (error: unknown) => error instanceof ReportBudgetExceeded || error instanceof ReportInputError;

/** A segment's body: one header line naming each object, then the objects' text back to back, unescaped, so it is the size of what it copies. */
function ledgerSegmentBody(tenant: string, at: { date: string; hour: number }, copies: readonly LedgerCopy[]): string {
  const header = { version: 1, tenant, date: at.date, hour: at.hour, objects: copies.map(c => ({ key: c.key, etag: c.etag, size: c.size, length: c.text.length })) };
  return JSON.stringify(header) + '\n' + copies.map(c => c.text).join('');
}
/**
 * What the segments the hour's state indexes hold: each object once, and which
 * segments were read whole. A segment that cannot be read exactly as indexed is
 * not read at all, and its objects are read from the ledger instead; together
 * they are read under one `aggregateBytes` budget, past which the rest are read
 * from the ledger too.
 */
async function readLedgerCopy(r2: R2Like, tenant: string, at: { date: string; hour: number }, segments: readonly CopySegment[]):
  Promise<{ held: Map<string, LedgerCopy>; holds: Set<string> }> {
  const held = new Map<string, LedgerCopy>(), holds = new Set<string>(), budget = { bytes: 0, cells: 0 };
  for (const segment of segments) {
    try {
      const obj = await r2.get(segment.key);
      if (obj === null) continue;
      const body = await storedReportText(obj, budget, 'aggregateBytes', 'aggregateBytes');
      const end = body.indexOf('\n');
      if (end < 0) continue;
      const header: unknown = JSON.parse(body.slice(0, end));
      if (!objectMap(header) || header.version !== 1 || header.tenant !== tenant || header.date !== at.date || header.hour !== at.hour
        || JSON.stringify(header.objects) !== JSON.stringify(segment.objects)) continue;
      const copies: LedgerCopy[] = [];
      let offset = end + 1, exact = true;
      for (const entry of segment.objects) {
        const text = body.slice(offset, offset + entry.length);
        offset += entry.length;
        if (text.length !== entry.length || aggregateBytes(text) !== entry.size) { exact = false; break; }
        copies.push({ key: entry.key, etag: entry.etag, size: entry.size, text });
      }
      if (!exact || offset !== body.length) continue;
      for (const copy of copies) held.set(copy.key, copy);
      holds.add(segment.key);
    } catch (error) { if (error instanceof ReportBudgetExceeded) break; }
  }
  return { held, holds };
}

/** A fold of the open hour is waiting for the closed hour's own transaction, which always comes first. */
class OpenHourDeferred extends Error { constructor() { super('Hourly fold in progress'); } }

/**
 * The shards as the next final fold will find them: read and checked as it
 * reads them, and cleaned in memory exactly as `cleanupHourlyState` would clean
 * them. Never written. A final fold left half way is finished by the catch-up,
 * and an open hour is not folded against it until then.
 */
async function committedShards(r2: R2Like, tenant: string, shards: number, tombs: ReadonlyMap<string, Tombstone>, now: number): Promise<ShardState[]> {
  const budget = { bytes: 0, cells: 0 }, states: ShardState[] = [];
  for (let s = 0; s < shards; s++) {
    const state = shardState((await readHourBody(r2, shardKey(tenant, s), budget)).body, s);
    if (state.pending !== undefined || state.cleanup !== undefined) throw new OpenHourDeferred();
    states.push(cleanupShard(state, tenant, tombs, now));
  }
  return states;
}

/**
 * The working aggregate of one open hour: `buildHour`'s fold, step for step, over
 * the records loaded so far and against `states`, which it advances exactly as
 * the final fold advances the shards it writes — so the next open hour, folded
 * after it, sees this one in its rings. Nothing is written here.
 */
function foldWorkingHour(tenant: string, at: { date: string; hour: number }, learn: LearnConfig, now: number, options: Required<BuildOptions>,
  loaded: Awaited<ReturnType<typeof loadHourRecords>>, tombs: ReadonlyMap<string, Tombstone>, states: ShardState[], retentionEnv?: RetentionEnv,
  /** P05 (R-P20): the position weights, read by the caller as the final fold reads them. */
  positionWeight?: FoldContext['positionWeight']): HourAggregate {
  const from = hourStart(at.date, at.hour), to = from + HOUR_MS;
  const { shards, horizonMs, ringCap } = options;
  const statsCfg: StatsConfig = learn.stats ?? DEFAULT_STATS, slotCfg = slotConfigsOf(learn), policies = policiesOf(learn);
  computationBasis(learn, policies.map(p => ({ name: p.name, role: p.role, policy: p })), [], { source: 'hourly-ring', horizonMs, ringCap });
  if (!Number.isFinite(statsCfg.tauLearnMs) || statsCfg.tauLearnMs <= 0) unavailable();
  for (const cfg of Object.values(slotCfg)) if (!['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom'].includes(cfg.reward)
    || !['unit', 'revenue', 'margin'].includes(cfg.objective ?? 'unit')) unavailable();
  const { decisions, outcomes } = foldableRows(loaded, tombs, slotCfg);
  if (retentionEnv) {
    for (const record of [...decisions.map(row => row.entry), ...outcomes]) {
      requireRetention(retentionEnv, record.retention?.ledger, tenant, 'ledger');
      requireRetention(retentionEnv, record.retention?.hourly, tenant, 'hourly');
    }
    // Untagged cumulative history cannot be mixed into a newly expirable shard.
    for (const state of states) {
      for (const ring of Object.values(state.rings)) for (const row of ring) requireRetention(retentionEnv, row.retention?.hourly, tenant, 'hourly');
      for (const [brand, ids] of Object.entries(state.seen)) for (const visitor of ids)
        requireRetention(retentionEnv, state.seenRetention?.[brand]?.[visitor], tenant, 'hourly');
      for (const brands of Object.values(state.deferred ?? {})) for (const record of Object.values(brands))
        for (const carry of Object.values(record)) requireRetention(retentionEnv, carry.retention, tenant, 'hourly');
    }
  }
  const brands = hourBrands(loaded, decisions, outcomes, tombs, policies, statsCfg);
  const byShardD = new Map<number, CompactDecision[]>(), byShardO = new Map<number, OutcomeRecord[]>();
  for (const d of decisions) { const s = shardOf(d.visitor_id, shards); const list = byShardD.get(s) ?? []; list.push(d); byShardD.set(s, list); }
  for (const o of outcomes) { const s = shardOf(o.visitor_id, shards); const list = byShardO.get(s) ?? []; list.push(o); byShardO.set(s, list); }
  const creditedSlots = new Map<string, Set<string>>();
  // An open hour has no aggregate of its own, so this is a first fold, never a re-fold.
  const ctx: FoldContext = { tenant, date: at.date, from, to, refold: false, policies, slotCfg, statsCfg, horizonMs, ringCap, tombs, brands, creditedSlots,
    retainedIds: new Set(), retainedBudget: { work: 0, bytes: 0 }, incomingIds: new Set(decisions.map(d => d.entry.id)), ...(positionWeight ? { positionWeight } : {}) };
  let ringsFolded = true;
  /** W30 F1.01 (W22 R143): the earliest hour any of these shards could still admit, as the final fold records it. */
  let recoveryFrom = 0;
  const unaccounted = new Set<string>();
  /** W30 P1: brand → the hours of this date holding a remembered outcome memory can no longer place. */
  const stranded = new Map<string, Set<number>>();
  for (let s = 0; s < shards; s++) {
    const r = foldShard(states[s]!, byShardD.get(s) ?? [], byShardO.get(s) ?? [], ctx);
    if (!r.folded) ringsFolded = false;
    if (r.floor >= 0) recoveryFrom = Math.max(recoveryFrom, r.floor + HOUR_MS);
    countMembership(brands, unaccounted, stranded, r.state, at.date, at.hour);
  }
  closeBrands(brands, policies, learn, unaccounted, stranded, creditedSlots, horizonMs, ringCap);
  const agg: HourAggregate = { version: 1, generation: crypto.randomUUID(), tenant, date: at.date, hour: at.hour, from, to, builtAt: now,
    objects: loaded.objects, objectsRead: loaded.read, truncated: loaded.truncated, horizonMs, shards, ringsFolded, recoveryFrom, brands };
  preparedAggregate(JSON.stringify(agg), tenant, at, options, learn);
  return agg;
}

/** The visitors the tenant's pending erasures name, from the names of their tombstones: no tombstone is read. */
function erasedVisitors(listing: ReadonlyMap<string, Listed>, tenant: string): Set<string> {
  const prefix = pendingPrefix(tenant), out = new Set<string>();
  for (const key of listing.keys()) {
    if (!key.startsWith(prefix) || !key.endsWith('.json')) continue;
    try { out.add(decodeURIComponent(key.slice(prefix.length, -'.json'.length))); } catch { /* not a visitor's name */ }
  }
  return out;
}
/** An object the listing still names with the identity the copy took it under. */
const listedAs = (o: { etag: string | null; size: number }, listed: Listed | undefined): boolean =>
  listed !== undefined && (listed.etag !== undefined ? o.etag === listed.etag : listed.size !== undefined ? o.size === listed.size : true);

/**
 * The basis of one open hour's fold: a digest of everything it reads — the
 * hour's ledger objects, the tenant's erasures and its shards, each as storage
 * lists it, with the configuration, the options and the retention policy it runs
 * under, and the basis of the open hour folded before it, on whose rings it is
 * folded. Null where storage did not identify every object, or the hour before
 * has no basis: such an hour is always folded.
 *
 * What it does not see is time: a ring entry whose retention ends while nothing
 * else changes stays in the working aggregate until the next catch-up's cleanup
 * removes it from the shards, which changes the basis — within one run.
 */
async function basisOf(tenant: string, at: { date: string; hour: number }, listed: ReadonlyMap<string, Listed>,
  shared: { erasures: ReadonlyMap<string, Listed>; rings: ReadonlyMap<string, Listed> }, learn: LearnConfig, options: Required<BuildOptions>,
  retentionEnv: RetentionEnv | undefined, previous: { basis: string | null } | undefined): Promise<string | null> {
  if (previous && previous.basis === null) return null;
  const identified = (m: ReadonlyMap<string, Listed>): Array<[string, string, number | null]> | null => {
    const out: Array<[string, string, number | null]> = [];
    for (const [key, l] of m) { if (l.etag === undefined) return null; out.push([key, l.etag, l.size ?? null]); }
    return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  };
  const ledger = identified(listed), erasures = identified(shared.erasures), rings = identified(shared.rings);
  if (!ledger || !erasures || !rings) return null;
  const setting = (v: unknown) => v === undefined || v === null ? null : typeof v === 'string' ? v : stableJson(v);
  const retention = retentionEnv ? [setting(retentionEnv.TENANTS), setting(retentionEnv.DEPLOYMENT_PROFILE), setting(retentionEnv.RETENTION)] : null;
  return fingerprint(stableJson({ version: 1, tenant, date: at.date, hour: at.hour, ledger, erasures, rings, learn, options, retention, previous: previous?.basis ?? null }));
}

/** One open hour a run works on. */
interface OpenTarget {
  at: { date: string; hour: number; from: number };
  /** The hour's learning objects, as storage lists them. */
  listed: Map<string, Listed>;
  started: boolean;
  state: OpenHourState | null;
  basis: string | null;
  fold: boolean;
  deferred?: boolean;
  /** How the run ended for it: folded, or refused with the state it had. */
  outcome?: { folded: HourAggregate; through: number } | { refused: OpenHourRefusal; state: OpenHourState | null };
  standing?: HourAggregate;
}

/**
 * The erasures, applied to the hour's copy before anything else the job does,
 * and whatever the fold then does: a segment whose rows name a visitor with a
 * pending erasure is dropped from the state and deleted, and so is a segment the
 * state does not index (one left by a run that stopped between its writes).
 * It reads no segment and no tombstone: the state names each segment's
 * visitors, and the tombstones' names are the visitors they erase, so it costs
 * one look-up per visitor named, however many erasures are pending.
 */
async function pruneCopy(r2: R2Agg & { delete?(key: string): Promise<unknown> }, tenant: string, t: OpenTarget, erased: ReadonlySet<string>, stored: ReadonlySet<string>): Promise<number> {
  const base = openLedgerKey(tenant, t.at.date, t.at.hour) + '.', segments = t.state?.segments ?? [];
  const indexed = new Set(segments.map(s => s.key));
  const naming = segments.filter(s => s.visitors.some(visitor => erased.has(visitor))).map(s => s.key);
  const orphans = [...stored].filter(key => key.startsWith(base) && !indexed.has(key));
  if (!naming.length && !orphans.length) return 0;
  if (naming.length && t.state) {
    const drop = new Set(naming);
    t.state = { ...t.state, segments: segments.filter(s => !drop.has(s.key)) };
    await putOpenState(r2, t.state);
  }
  let removed = 0;
  if (typeof r2.delete === 'function') for (const key of [...naming, ...orphans]) { await r2.delete(key); removed++; }
  return removed;
}

/**
 * The job's part of the copy, after a fold: the segments it can still use — read
 * whole, every object of them used — are kept, and one new segment holds what
 * the fold read and they do not: the objects it read from the ledger, and the
 * good objects of a segment it can no longer use. An object whose rows name a
 * visitor with a pending erasure is never copied: it is read from the ledger at
 * each fold, as the final fold reads it. Returns the copy's new index, and the
 * segments to delete once the state naming that index is written.
 */
async function keepLedgerCopy(r2: R2Agg, tenant: string, at: { date: string; hour: number }, now: number, read: readonly ReadCopy[],
  holds: ReadonlySet<string>, index: readonly CopySegment[], erased: ReadonlySet<string>): Promise<{ segments: CopySegment[]; drop: string[] }> {
  const used = new Set(read.filter(c => c.held).map(c => c.key));
  const segments: CopySegment[] = [], drop: string[] = [];
  for (const segment of index) {
    if (holds.has(segment.key) && segment.objects.every(o => used.has(o.key))) segments.push(segment); else drop.push(segment.key);
  }
  const kept = new Set(segments.flatMap(s => s.objects.map(o => o.key)));
  const fresh = read.filter(c => !kept.has(c.key) && !c.visitors.some(visitor => erased.has(visitor)));
  if (fresh.length) {
    const body = ledgerSegmentBody(tenant, at, fresh);
    // A segment too large to read back is not written: its objects are read from the ledger at the next fold.
    if (aggregateBytes(body) <= REPORT_LIMITS.aggregateBytes) {
      const key = `${openLedgerKey(tenant, at.date, at.hour)}.${ts36(now)}`;
      await r2.put(key, body, { httpMetadata: { contentType: 'text/plain' } });
      segments.push({ key, objects: fresh.map(c => ({ key: c.key, etag: c.etag, size: c.size, length: c.text.length })),
        visitors: [...new Set(fresh.flatMap(c => c.visitors))] });
    }
  }
  return { segments, drop };
}

/** The working aggregate without its write identity and build time: what it says, to tell a changed one from a rewrite. */
const workingContent = (agg: unknown): string => {
  if (!objectMap(agg)) return '';
  const { generation: _generation, builtAt: _builtAt, ...rest } = agg;
  void _generation; void _builtAt;
  return JSON.stringify(rest);
};


/**
 * The storage calls the job's folds would make, at most: the erasures and the
 * shards read once, each hour's indexed segments read, the objects the copy does
 * not hold read from the ledger, a segment, the working aggregate and the state
 * written, the segments it can no longer use deleted; then the day published
 * again — a listing, at most 24 final hours, the report.
 */
function foldEstimate(folds: readonly OpenTarget[], erasures: number, shards: number): number {
  let calls = erasures + shards + 2 + 24;
  for (const t of folds) {
    const index = new Map((t.state?.segments ?? []).flatMap(s => s.objects.map(o => [o.key, o] as const)));
    const tail = [...t.listed].filter(([key, l]) => { const o = index.get(key); return !o || !listedAs(o, l); }).length;
    calls += 2 * (t.state?.segments.length ?? 0) + tail + 3;
  }
  return calls;
}

/** Two listings name the same objects with the same identities. */
function sameListing(a: ReadonlyMap<string, Listed>, b: ReadonlyMap<string, Listed>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, l] of a) { const o = b.get(key); if (!o || o.etag !== l.etag || o.size !== l.size) return false; }
  return true;
}
/**
 * W33 O2 for another brand's day of an open hour (condition L1-C4): whether
 * everything the run's working folds read — each open hour's ledger, the
 * erasures and the shards — is still as storage listed it when the run began.
 * Asked only after another brand's day has been noted, as the second listing
 * `publishAggregateDate` takes for the final hours: where it is not, a writer
 * may have stored that brand's day from a newer view meanwhile, and the date is
 * left for the next run to publish.
 */
async function unchangedSince(r2: R2Like, tenant: string, targets: readonly OpenTarget[],
  shared: { erasures: ReadonlyMap<string, Listed>; rings: ReadonlyMap<string, Listed> }): Promise<boolean> {
  for (const t of targets) {
    const listed = new Map([...await listObjects(r2, `${tenant}/${t.at.date}/${pad2(t.at.hour)}/`)].filter(([key]) => isLearningKey(key)));
    if (!sameListing(listed, t.listed)) return false;
  }
  return sameListing(await listObjects(r2, pendingPrefix(tenant)), shared.erasures) && sameListing(await listObjects(r2, ringsPrefix(tenant)), shared.rings);
}

export interface OpenHourResult {
  /** The open hours folded this run; `copied` of their `read` objects came from the ledger copy, the rest from the ledger. */
  folded: Array<{ date: string; hour: number; objects: number; read: number; copied: number; truncated: boolean; decisions: number; outcomes: number; changed: boolean }>;
  /** Open hours whose basis had not changed since their state's: nothing was read or folded for them. */
  unchanged: Array<{ date: string; hour: number; status: 'current' | 'refused' }>;
  /** Folds refused this run, and day publications that failed or were superseded (`hour: -1`). */
  failed: Array<{ date: string; hour: number; error: string; refusal?: OpenHourRefusal }>;
  /** Folds the run's storage budget did not cover (the job only), with the calls they were estimated at; their state stands. */
  deferred: Array<{ date: string; hour: number; estimate: number }>;
  /** Dates whose day report was published again because an open hour changed, or its status did (the job only). */
  published: string[];
  /** Working objects removed because their hour is no longer open (the job only). */
  removed: number;
  /** Copy segments removed because their rows name an erased visitor, or no state indexes them (the job only). */
  pruned: number;
  /** Every storage call the run made: listings, reads, writes and deletes. */
  calls: number;
  /** The open hours as a day report names them: every hour a report build worked on, and the hours of each date the job published. */
  views: OpenHourView[];
  /** The pending erasures, where a fold loaded them: a report build's publication counts them without reading them again. */
  tombs?: ReadonlyMap<string, Tombstone>;
}

/**
 * Fold the open hours into their working aggregates. The five-minute job calls
 * it with `start` and `publish`: it applies the erasures to each open hour's
 * copy, starts the working aggregate of an open hour the queue has written to,
 * folds again the ones whose basis has changed — where its `budget` of storage
 * calls covers them — publishes the day again where an hour changed, and
 * removes the working objects of an hour that is no longer open. A report build
 * calls it for its own date without either: it refreshes in memory only what the
 * job has started, writes nothing, and returns the hours in `views`.
 */
export async function foldOpenHours(r2: R2Agg & { delete?(key: string): Promise<unknown> }, tenant: string, learn: LearnConfig, now = Date.now(),
  opts: BuildOptions & { date?: string; start?: boolean; publish?: boolean; budget?: number } = {}, retentionEnv?: RetentionEnv): Promise<OpenHourResult> {
  validateReportIds({ tenant, brand: tenant, date: opts.date ?? hourOf(now).date });
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) throw new ReportInputError();
  if (opts.budget !== undefined && (!Number.isSafeInteger(opts.budget) || opts.budget < 0)) throw new ReportInputError();
  const options = buildOptions(opts), job = opts.start === true;
  const result: OpenHourResult = { folded: [], unchanged: [], failed: [], deferred: [], published: [], removed: 0, pruned: 0, calls: 0, views: [] };
  // Every storage call of the run is counted in `result.calls`, each passed through whole (`countedStorage`).
  const io = countedStorage(r2, result).storage;
  // W33 O2 (fix 1, ruling L-R2(a)): a publishing run notes the tenant's own day of
  // every date it may publish BEFORE it reads any source — its own open-hour
  // objects included — so its write never replaces a day another writer stored
  // after this run began reading. Another brand's day is noted where its brand
  // is first known (`publishAggregateDate`), which costs nothing for a tenant
  // whose open hours carry only its own brand.
  const notes = new Map<string, CanonicalNote>();
  if (opts.publish) for (const date of [...new Set(openHours(now).map(at => at.date))])
    notes.set(date, await noteCanonicalDay(io as unknown as Parameters<typeof noteCanonicalDay>[0], { tenant, brand: tenant, date }));
  const stored = new Set(await listKeys(io, openPrefix(tenant)));
  const live = new Set(openHours(now).map(at => `${at.date}/${pad2(at.hour)}`));
  let targets: OpenTarget[] = [];
  for (const at of openHours(now)) {
    const started = stored.has(openStateKey(tenant, at.date, at.hour));
    if (!job && !started) continue;                                                  // a report refreshes what the job started
    const listed = new Map([...await listObjects(io, `${tenant}/${at.date}/${pad2(at.hour)}/`)].filter(([key]) => isLearningKey(key)));
    if (!started && !listed.size) continue;                                          // nothing written to it, nothing started: no work at all
    if (at.from + HOUR_MS <= now) {                                                  // a closed hour may have its final already
      const final = hourKey(tenant, at.date, at.hour);
      if ((await io.list({ prefix: final, limit: 1 })).objects.some(o => o.key === final)) { live.delete(`${at.date}/${pad2(at.hour)}`); continue; }
    }
    targets.push({ at, listed, started, state: null, basis: null, fold: true });
  }
  // A report of one date folds only when an open hour is on it — and then the
  // open hours up to its last, in order, because a later one is folded on the
  // earlier's rings.
  if (opts.date !== undefined) targets = targets.slice(0, targets.map(t => t.at.date).lastIndexOf(opts.date) + 1);
  const run: { tombs?: Map<string, Tombstone>; states?: ShardState[] } = {};
  const changedDates = new Set<string>();
  /** What every hour's fold reads beside its own ledger, as storage lists it: the erasures and the shards. */
  let shared: { erasures: Map<string, Listed>; rings: Map<string, Listed> } | undefined;
  if (targets.length) {
    shared = { erasures: await listObjects(io, pendingPrefix(tenant)), rings: await listObjects(io, ringsPrefix(tenant)) };
    const erased = erasedVisitors(shared.erasures, tenant);
    for (const t of targets) if (t.started) t.state = await readOpenState(io, tenant, t.at);
    // The job applies the erasures to the copy first, whatever the fold then does.
    if (job) for (const t of targets) result.pruned += await pruneCopy(io, tenant, t, erased, stored);
    let previous: { basis: string | null } | undefined;
    for (const t of targets) {
      t.basis = await basisOf(tenant, t.at, t.listed, shared, learn, options, retentionEnv, previous);
      previous = { basis: t.basis };
      t.fold = t.basis === null || t.state?.basis !== t.basis;
      // A report sums a current hour's standing aggregate, and folds the hour again where that cannot be read.
      if (!job && !t.fold && t.state?.status === 'current') { t.standing = await standingAggregate(io, tenant, t.at, t.state); t.fold = !t.standing; }
    }
    // An hour is folded on the rings of the open hours before it: a current one is folded again with it, in memory.
    for (let i = targets.length - 1; i > 0; i--) if (targets[i]!.fold) for (let j = 0; j < i; j++) if (targets[j]!.state?.status === 'current') targets[j]!.fold = true;
    const folds = targets.filter(t => t.fold);
    if (job && opts.budget !== undefined && folds.length) {
      const estimate = foldEstimate(folds, shared.erasures.size, options.shards);
      if (result.calls + estimate > opts.budget) for (const t of folds) { t.deferred = true; result.deferred.push({ date: t.at.date, hour: t.at.hour, estimate }); }
    }
    for (const t of targets) {
      const { at } = t, before = t.state;
      if (t.deferred) continue;
      if (!t.fold) {
        result.unchanged.push({ date: at.date, hour: at.hour, status: before!.status });
        // The hours after a refused one are folded on the shards without it, as its final fold will leave them while it stays unfolded.
        if (before!.status === 'refused') run.states = undefined;
        continue;
      }
      try {
        // The shards as the final folds will find them. After an hour that could
        // not be folded they are read again, without it.
        run.tombs ??= await loadTombstones(io, tenant);
        run.states ??= await committedShards(io, tenant, options.shards, run.tombs, now);
        const { held, holds } = await readLedgerCopy(io, tenant, at, before?.segments ?? []);
        // W30 F1.01 (ruling L-R5): the collisions an operator surface has filed are
        // read as the hour's final fold reads them — excluded and counted, an
        // unfiled one refusing the hour — and each attempt lists afresh the
        // objects it used.
        let read: ReadCopy[] = [];
        const loaded = await withFiledConflicts(retentionEnv, resolved => {
          read = [];
          return loadHourRecords(io, tenant, at.date, at.hour, options.maxObjects, resolved, { held, read, listed: t.listed });
        });
        // P05 (R-P20, R-P62): the open hour's credits weighed by the same rule its final fold weighs them by.
        const positions = positionHistories(io, tenant);
        await positions.load([...loaded.decisions.map(d => d.entry), ...run.states.flatMap(state => Object.values(state.rings).flat())]);
        const agg = foldWorkingHour(tenant, at, learn, now, options, loaded, run.tombs, run.states, retentionEnv, positions.weight);
        let changed = true;
        if (job) {
          const content = await fingerprint(workingContent(agg));
          changed = !(before?.content === content && before.generation !== null && stored.has(openKey(tenant, at.date, at.hour)));
          const copy = await keepLedgerCopy(io, tenant, at, now, read, holds, before?.segments ?? [], erased);
          if (changed) await io.put(openKey(tenant, at.date, at.hour), JSON.stringify(agg), { httpMetadata: { contentType: 'application/json' } });
          await putOpenState(io, { version: 1, tenant, date: at.date, hour: at.hour, basis: t.basis, status: 'current', through: now,
            generation: changed ? agg.generation! : before!.generation, content, segments: copy.segments });
          if (typeof io.delete === 'function') for (const key of copy.drop) await io.delete(key);
          if (changed || before?.status !== 'current') changedDates.add(at.date);
        }
        const sum = (k: 'decisions' | 'outcomes') => Object.values(agg.brands).reduce((n, b) => n + b[k], 0);
        result.folded.push({ date: at.date, hour: at.hour, objects: agg.objects, read: agg.objectsRead, copied: read.filter(c => c.held).length,
          truncated: agg.truncated, decisions: sum('decisions'), outcomes: sum('outcomes'), changed });
        t.outcome = { folded: agg, through: now };
      } catch (error) {
        // The shards in memory may be half folded: the next hour reads them again.
        run.states = undefined;
        const refusal = refusalOf(error, now);
        result.failed.push({ date: at.date, hour: at.hour, error: error instanceof Error ? error.message : String(error), refusal });
        t.outcome = { refused: refusal, state: before };
        if (job) {
          try {
            await putOpenState(io, { version: 1, tenant, date: at.date, hour: at.hour, basis: settledRefusal(error) ? t.basis : null, status: 'refused', refusal,
              through: before?.through ?? null, generation: before?.generation ?? null, content: before?.content ?? null, segments: before?.segments ?? [] });
            if (before?.status !== 'refused') changedDates.add(at.date);
          } catch { /* the next run folds it again */ }
        }
      }
    }
  }
  /** An hour as a day report names it, after this run. */
  const viewFor = async (t: OpenTarget): Promise<OpenHourView | null> => {
    const at = t.at;
    if (t.outcome && 'folded' in t.outcome) return { date: at.date, hour: at.hour, status: 'current', through: t.outcome.through, agg: t.outcome.folded };
    if (t.outcome) {
      const agg = await standingAggregate(io, tenant, at, t.outcome.state);
      return { date: at.date, hour: at.hour, status: 'refused', refusal: t.outcome.refused, through: agg ? t.outcome.state!.through : null, ...(agg ? { agg } : {}) };
    }
    if (!t.state) return null;
    const view = viewOf(at, t.state, t.standing ?? await standingAggregate(io, tenant, at, t.state));
    // A fold the budget deferred stands as it was, and is named stale until it runs.
    return view && t.deferred ? { ...view, status: 'refused', refusal: view.refusal ?? { at: now, error: 'working fold deferred', code: 'open_fold_deferred' } } : view;
  };
  if (!job) for (const t of targets) { const view = await viewFor(t); if (view) result.views.push(view); }
  if (!job && run.tombs) result.tombs = run.tombs;
  if (opts.publish) for (const date of [...changedDates].sort()) {
    try {
      const views: OpenHourView[] = [];
      for (const t of targets.filter(t => t.at.date === date)) { const view = await viewFor(t); if (view) views.push(view); }
      result.views.push(...views);
      // W37 T2 and fix 2: the day of every brand the date's final hours or its open
      // hours carry, the tenant's own day last and only once every other brand's
      // day is stored as built; each written on its note (W33 O2). A write refused
      // or failed is never swallowed: the own day is withheld and the date is
      // named here, failed.
      const published = await publishAggregateDate(io, tenant, date, learn, now,
        { note: notes.get(date), open: { views, tombs: run.tombs, current: () => unchangedSince(io, tenant, targets, shared!) } });
      if (published.written) result.published.push(date);
      else result.failed.push({ date, hour: -1, error: 'day report superseded by a concurrent publication' });
    } catch (error) { result.failed.push({ date, hour: -1, error: error instanceof Error ? error.message : String(error) }); }
  }
  // The job keeps the working objects of the open hours only: an hour whose
  // final fold is due, or done, keeps none, so neither the copy nor the
  // working aggregate outlives the hour by more than one run.
  if (job && typeof io.delete === 'function') {
    const prefix = openPrefix(tenant);
    for (const key of stored) {
      const m = /^(\d{4}-\d{2}-\d{2})\/(\d{2})\.(?:json|state\.json|ledger(?:\.[0-9a-z]+)?)$/.exec(key.slice(prefix.length));
      if (m && live.has(`${m[1]}/${m[2]}`)) continue;
      await io.delete(key); result.removed++;
    }
  }
  return result;
}

/**
 * The open hours of a date as their states name them, for a day published
 * without a fold of its own (the catch-up's): a current hour summed from its
 * standing working aggregate, a refused one named with its refusal. An hour
 * without a state that can be read is left out, exactly as an open hour always
 * was; it never refuses the day.
 */
async function readOpenViews(r2: R2Like, tenant: string, date: string, now: number): Promise<OpenHourView[]> {
  const out: OpenHourView[] = [];
  const hours = openHours(now).filter(at => at.date === date);
  if (!hours.length) return out;
  // One listing says which states and working aggregates exist; only those are read.
  let present: Set<string>;
  try { present = new Set(await listKeys(r2, `${openPrefix(tenant)}${date}/`)); } catch { return out; }
  for (const at of hours) {
    if (!present.has(openStateKey(tenant, date, at.hour))) continue;
    const state = await readOpenState(r2, tenant, at);
    if (!state) continue;
    const view = viewOf(at, state, present.has(openKey(tenant, date, at.hour)) ? await standingAggregate(r2, tenant, at, state) : undefined);
    if (view) out.push(view);
  }
  return out;
}

export { ReportTooLarge } from './report';

/**
 * The canonical day summed from the date's hour aggregates and, since lane E6,
 * its open hours' working aggregates, or null where the date has neither.
 * Writes nothing.
 *
 * Lane E6: the open hours are summed beside the final ones and named with where
 * they stand — `views` where the caller has just worked on them, their states
 * otherwise. `rawOnRefusal` is a report build's: on a day with no final hour, an
 * open hour refused leaves the day to the raw read, which answers it as it did
 * before the open hour was folded — a conflict raised, filed and answered 409, a
 * budget named — rather than a day summed from a stale working aggregate alone.
 */
async function aggregateDay(r2: R2Agg, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, now: number,
  opts: { views?: readonly OpenHourView[]; tombs?: ReadonlyMap<string, Tombstone>; rawOnRefusal?: boolean } = {}): Promise<DayReport | null> {
  const { aggs, missing } = await loadHours(r2, ids.tenant, ids.date, now);
  const finals = new Set(aggs.map(a => a.hour));
  const views = (opts.views ?? await readOpenViews(r2, ids.tenant, ids.date, now)).filter(v => v.date === ids.date && !finals.has(v.hour));
  if (opts.rawOnRefusal && !aggs.length && views.some(v => v.status === 'refused')) return null;
  const working = views.flatMap(v => (v.agg ? [v.agg] : []));
  if (!aggs.length && !working.length) return null;
  const pending = (opts.tombs ?? await loadTombstones(r2, ids.tenant)).size;
  const open = openEntries(views);
  return reportFromHours([...aggs, ...working], ids, learn, now, { pending, missing, ...(open.length ? { open } : {}) });
}

/** Lane E6: the open hours as a day report names them. */
const openEntries = (views: readonly OpenHourView[]): OpenHourEntry[] =>
  views.map(v => ({ hour: v.hour, status: v.status, through: v.agg ? v.through : null, ...(v.refusal ? { refusal: v.refusal } : {}) }));

/**
 * Scheduler writes must acknowledge persistence and must never fall back to raw records.
 * W33 O2: the write is `writeCanonicalDay`'s, conditional on the day object noted
 * before the date's sources are read — the caller's `note`, or one taken
 * here. `written` is false where another write reached the day after the note.
 * Lane E6: `views`, `tombs` and `rawOnRefusal` as `aggregateDay` takes them.
 */
async function publishAggregateDay(r2: R2Agg, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, now: number, strict: boolean,
  opts: { note?: CanonicalNote; views?: readonly OpenHourView[]; tombs?: ReadonlyMap<string, Tombstone>; rawOnRefusal?: boolean } = {}): Promise<{ report: DayReport; written: boolean } | null> {
  const noted = opts.note ?? await noteCanonicalDay(r2 as unknown as Parameters<typeof noteCanonicalDay>[0], ids);
  const report = await aggregateDay(r2, ids, learn, now, opts);
  if (!report) { if (strict) unavailable(); return null; }
  const body = canonicalReportJson(report);
  let written = false;
  try { written = await writeCanonicalDay(r2, ids, body, noted); }
  catch (error) { if (strict) throw error; /* The public response still carries the computation. */ }
  return { report, written };
}

/**
 * W37 T2: the brands a date's hour aggregates carry. A tenant may serve more than
 * one brand, and the brand rides on its decisions and outcomes
 * (docs/kit/03-payload-schemas.md); there is no brand registry, so a tenant's
 * brands on a date are exactly the brands its own folded records carry.
 */
function aggregateBrands(aggs: readonly HourAggregate[]): string[] {
  return [...new Set(aggs.flatMap(a => Object.keys(a.brands)))].sort();
}

/**
 * W37 T2: the five-minute job's publication of one folded date, for EVERY brand
 * the date's hour aggregates carry — and, with lane E6, every brand its open
 * hours' working aggregates carry — each day built from its own brand's rows
 * only (`reportFromHours`), the open hours named on each day. The tenant's own
 * day is written last, and only once every other brand's day was written: it is
 * the day the catch-up reads back to decide whether a date is already published
 * (`hasReportedHours`), so a date whose other brand's day failed or was
 * superseded is published again, whole, by the next run. W33 O2 holds for each
 * brand: every day is written on the condition of the day object noted before
 * the aggregates it is built from were read — the tenant's before the first
 * listing, each other brand's before the listing its day is built from, which
 * is a second listing only for a tenant that serves more than its own brand. A
 * brand first folded between the two listings leaves the date unpublished for
 * the next run to finish.
 *
 * Lane E6: the open hours are read from their states on each listing
 * (`readOpenViews`), or are `open.views`, the five-minute job's own folds of
 * them; those were folded from listings the job took before any other brand's
 * note, so where another brand is noted they stand only if `open.current()`
 * answers that nothing they read has changed since; otherwise the date is left
 * for the next run, as a brand first folded between the two listings leaves it.
 */
async function publishAggregateDate(r2: R2Agg, tenant: string, date: string, learn: LearnConfig, now: number,
  opts: { note?: CanonicalNote; open?: { views: readonly OpenHourView[]; tombs?: ReadonlyMap<string, Tombstone>; current: () => Promise<boolean> } } = {}): Promise<{ written: boolean }> {
  const ids = { tenant, brand: tenant, date };
  const noted = opts.note ?? await noteCanonicalDay(r2 as unknown as Parameters<typeof noteCanonicalDay>[0], ids);
  /** The date's final hours and its open hours, as one listing finds them: every hour summed, and the open ones as each day names them. */
  const sources = async () => {
    const hours = await loadHours(r2, tenant, date, now);
    const finals = new Set(hours.aggs.map(a => a.hour));
    const views = (opts.open?.views ?? await readOpenViews(r2, tenant, date, now)).filter(v => v.date === date && !finals.has(v.hour));
    const aggs = [...hours.aggs, ...views.flatMap(v => (v.agg ? [v.agg] : []))];
    if (!aggs.length) unavailable();
    return { aggs, missing: hours.missing, open: openEntries(views) };
  };
  let source = await sources();
  const notes = new Map<string, CanonicalNote>();
  const others = aggregateBrands(source.aggs).filter(brand => brand !== tenant);
  if (others.length) {
    for (const brand of others) notes.set(brand, await noteCanonicalDay(r2 as unknown as Parameters<typeof noteCanonicalDay>[0], { tenant, brand, date }));
    source = await sources();
    if (opts.open && !await opts.open.current()) return { written: false };
  }
  const tombs = opts.open?.tombs ?? await loadTombstones(r2, tenant);
  const day = (brand: string) => reportFromHours(source.aggs, { tenant, brand, date }, learn, now,
    { pending: tombs.size, missing: source.missing, ...(source.open.length ? { open: source.open } : {}) });
  let complete = aggregateBrands(source.aggs).every(brand => brand === tenant || notes.has(brand));
  for (const [brand, brandNote] of notes) {
    if (!await writeCanonicalDay(r2, { tenant, brand, date }, canonicalReportJson(day(brand)), brandNote)) complete = false;
  }
  if (!complete) return { written: false };
  return { written: await writeCanonicalDay(r2, ids, canonicalReportJson(day(tenant)), noted) };
}

/**
 * W37 T2: the brands a tenant's own records carry on a date — those of its hour
 * aggregates where the date has any, else those of the date's decision and
 * outcome rows in the ledger (a day the fold never reached). Bounded by the same
 * caps as the day it is read for; a read that fails names no brand.
 */
async function dayBrands(r2: R2Agg, tenant: string, date: string, now: number): Promise<string[]> {
  try {
    const { aggs } = await loadHours(r2, tenant, date, now);
    if (aggs.length) return aggregateBrands(aggs);
    const brands = new Set<string>();
    for (const stream of ['decision', 'outcome'] as const) {
      const day = await loadDay<{ brand?: unknown }>(r2 as unknown as R2Like, tenant, date, stream, REPORT_LIMITS.records);
      for (const row of day.records) if (typeof row.brand === 'string') brands.add(row.brand);
    }
    return [...brands].filter(brand => { try { validateReportIds({ tenant, brand, date }); return true; } catch { return false; } }).sort();
  } catch { return []; }
}

/**
 * W37 T2: whether the day this job built for a brand is the day stored for it.
 * `runDayReport` answers the day it computed even where its write was refused
 * or failed (W33 O2), so the job reads the stored day back and compares it with
 * the bytes its own write carries (`canonicalReportJson`). A read that fails
 * answers "not stored".
 */
async function storedAsBuilt(r2: R2Agg, ids: { tenant: string; brand: string; date: string }, report: DayReport): Promise<boolean> {
  try {
    const saved = await r2.get(reportKey(ids.tenant, ids.brand, ids.date));
    return !!saved && await saved.text() === canonicalReportJson(report);
  } catch { return false; }
}

/**
 * W37 T2: the nightly day reports of one tenant's date — one per brand its own
 * records carry (`dayBrands`), each built from that brand's rows only, and the
 * tenant's own day beside them as it has always been built — never
 * `{ brand: tenant }` alone. Each other brand is built and published on its own
 * (`runDayReport`), so one brand's failure never withholds another brand's day.
 * The tenant's own day is the date's publication record, as the five-minute job
 * writes it (`publishAggregateDate`): it comes last, and only once every other
 * brand's day of the date is stored as this job built it. Where one is not, the
 * own day is withheld (`report: null`) and nothing more is written, so the next
 * five-minute run finds the date without its saved own day and publishes it
 * again, whole.
 */
export async function runBrandDayReports(r2: R2Agg, tenant: string, date: string, learn: LearnConfig, now = Date.now(),
  retentionEnv?: RetentionEnv): Promise<Array<{ brand: string; report: DayReport | null }>> {
  const brands = [...(await dayBrands(r2, tenant, date, now)).filter(brand => brand !== tenant), tenant];
  const results: Array<{ brand: string; report: DayReport | null }> = [];
  let stored = true;
  for (const brand of brands) {
    if (brand === tenant && !stored) { results.push({ brand, report: null }); continue; }
    try {
      const report = await runDayReport(r2, { tenant, brand, date }, learn, null, now, {}, retentionEnv);
      if (brand !== tenant && !await storedAsBuilt(r2, { tenant, brand, date }, report)) stored = false;
      results.push({ brand, report });
    } catch { stored = false; results.push({ brand, report: null }); }
  }
  return results;
}

/**
 * The day report: from the hour aggregates when the day has any and the built-in overlays will do;
 * from the ledger itself otherwise (a day from before the fold existed, or custom reporting policies,
 * which are computed over the records and so need a day one request can read).
 */
export async function runDayReport(r2: R2Agg, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, reporting: ReportPolicy[] | null, now = Date.now(),
  opts: {
    maxObjects?: number;
    /**
     * W25 R4 (LANE-LOG R183): the tenant's published prior document
     * (`reportPriors`). A day built from the ledger records builds its grids
     * with it and declares `gridPriors: { applied: true, priorVersion }` where
     * it applied. The day summed from the folded hours does not use it — an
     * hour aggregate carries no prior revision — and keeps declaring
     * `applied: false`.
     */
    priors?: ReportPriors | null;
  } = {}, retentionEnv?: RetentionEnv, resolved?: ResolvedConflicts): Promise<DayReport> {
  // W33 O2: a canonical build notes the day object ONCE, before it reads any
  // source, and the same note conditions its write whichever path computes it —
  // the hour aggregates, or the ledger where the date has none.
  let note: CanonicalNote | undefined;
  if (reporting === null) {
    note = await noteCanonicalDay(r2 as unknown as Parameters<typeof noteCanonicalDay>[0], ids);
    // Lane E6: an open hour the five-minute job has started is brought up to
    // the second first, in memory — the minutes of raw the queue has written
    // since that run, and nothing before them; nothing at all where nothing its
    // fold reads has changed. An hour whose fold is refused is named refused;
    // where the refresh cannot run at all, every hour the job started is named
    // refused, standing as the job left it. The note above precedes every read
    // the refresh makes, so the write below never replaces a day stored meanwhile.
    let views: OpenHourView[], tombs: ReadonlyMap<string, Tombstone> | undefined;
    try { ({ views, tombs } = await foldOpenHours(r2, ids.tenant, learn, now, { date: ids.date }, retentionEnv)); }
    catch {
      views = (await readOpenViews(r2, ids.tenant, ids.date, now)).map(v => v.status === 'refused' ? v
        : { ...v, status: 'refused' as const, refusal: { at: now, error: 'working fold unavailable', code: 'report_unavailable' } });
    }
    const published = await publishAggregateDay(r2, ids, learn, now, false, { note, views, tombs, rawOnRefusal: true });
    if (published) return published.report;
  }
  if (opts.maxObjects !== undefined) {
    const n = await countDayObjects(r2, ids.tenant, ids.date, opts.maxObjects);
    if (n > opts.maxObjects) throw new ReportTooLarge(n, opts.maxObjects);
  }
  return runReport(r2, ids, learn, reporting, now, retentionEnv, resolved, opts.priors ?? null, note);
}

/**
 * W33 O4 (document 35 §5 row W33: "define safe repair/provenance for any
 * historical canonical results affected"; N09; decision D1: repair is
 * conditional on contaminated data, not assumed). The local repair-or-declare
 * path for ONE stored day, run by an operator or a job; nothing calls it on the
 * serving path and it never runs on its own.
 *
 * AFFECTED means the stored day's recorded policy set is not the canonical one
 * of its own learning policy (`canonicalPolicySet`): the pre-fix overlay write
 * left a custom overlay's result under the canonical key. Every other day —
 * recorded canonical, repaired, or historical in any stored format — is
 * `unaffected` and is read, never written.
 *
 * An affected day is REPAIRED where its sources are retained: it is replaced by
 * exactly the day the canonical writer computes from them now — the sum of the
 * date's hour aggregates where the date has any, the day's ledger rows
 * otherwise — recorded `provenance.status: 'repaired'`. It is DECLARED where
 * they are not — that same rebuild finds no row of the brand (none in the
 * date's hour aggregates, or in its ledger where the date has no aggregate,
 * erased rows counting as found) for a day that counted some — kept readable
 * with the numbers it held, its
 * provenance naming the overlay policies that produced them, and withheld from
 * every window. A declared day is still affected, so a later pass repairs it if
 * its sources come back and otherwise leaves it byte-identical.
 *
 * Every write is conditional on the object the verdict was made on, so a
 * canonical day published meanwhile is never replaced; the verdict is taken
 * again once on such a race. A rebuild the canonical writer itself refuses (a
 * budget, a row conflict, an unreadable aggregate) rejects with nothing
 * written. D2: this proves the path on local data; no production day is
 * rewritten by it without the authorized operation (LIVE2).
 */
export interface CanonicalRepair { status: 'unaffected' | 'repaired' | 'declared'; policies?: string[] }
export async function repairCanonicalDay(r2: R2Agg, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, now = Date.now(),
  retentionEnv?: RetentionEnv): Promise<CanonicalRepair> {
  validateReportIds(ids);
  const reader = r2 as unknown as Parameters<typeof readStoredDay>[0];
  for (let attempt = 0; attempt < 2; attempt++) {
    const stored = await readStoredDay(reader, ids);
    if (!stored) return { status: 'unaffected' };
    const canonical = canonicalPolicySet(stored.report.policies);
    if (canonical === null) throw new ReportUnavailableError();
    if (canonical) return { status: 'unaffected' };
    const counted = stored.report.counts;
    if (!objectMap(counted)) throw new ReportUnavailableError();
    const rebuilt = await aggregateDay(r2, ids, learn, now) ?? await rebuildLedgerDay(r2, ids, learn, now, retentionEnv);
    // Sources are GONE only where the rebuild found no row of the brand at all —
    // not where every row it found was erased, which is a canonical (empty) day.
    const lost = rebuilt.counts.decisions === 0 && rebuilt.counts.outcomes === 0 && !(rebuilt.erasures?.rows_hidden)
      && (counted.decisions > 0 || counted.outcomes > 0);
    let next: DayReport, status: 'repaired' | 'declared';
    if (!lost) {
      // The replacement is itself the canonical day, or nothing is written: a
      // rebuild under any other policy set would only be found affected again.
      if (canonicalPolicySet(rebuilt.policies) !== true) throw new ReportUnavailableError();
      next = rebuilt; next.provenance = dayProvenance(rebuilt, 'repaired'); status = 'repaired';
    }
    else {
      const declared = dayProvenance(stored.report, 'declared');
      if (!declared) throw new ReportUnavailableError();
      const recorded = validProvenance(stored.report.provenance);
      if (recorded?.status === 'declared' && JSON.stringify(recorded.policies) === JSON.stringify(declared.policies)) return { status: 'declared', policies: declared.policies };
      next = { ...stored.report, provenance: declared }; status = 'declared';
    }
    const body = canonicalReportJson(next);
    // The canonical writers' own conditional write, on the day this verdict read.
    if (await writeCanonicalDay(r2, ids, body, { etag: stored.etag })) return { status, policies: next.provenance?.policies ?? [] };
  }
  // The day changed under the repair twice: nothing is written, and the caller runs it again.
  throw new ReportUnavailableError();
}
