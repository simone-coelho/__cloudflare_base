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
import { attribute, creditWeight, type AttributionPolicy, type RingEntry } from './policy';
import { ringEntryOf } from './fan';
import { attributionArm, canonicalReportJson, countDayObjects, presetPolicies, publishedAllocation, readWindowSummary, reportCoverage, reportKey, REPORT_MEASUREMENT, REPORT_LIMITS, ReportBudgetExceeded, ReportUnavailableError, ReportTooLarge, rawReportJson, storedReportText, validateReportIds, validateReportPolicies, runReport, type ArmRow, type DayReport, type ReportPolicy } from './report';
import { attributionContractOf, policyOf, slotConfigsOf } from './route';
import { computationBasis, effectiveReportPolicy, recordedComputation, ReportInputError, explorationOpportunity, ReportRowIdentity, rawText, validDuplicateCounts,
  type ComputationBasis, type DuplicateCounts, type DuplicateWitness } from './report';
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
export interface BatchRingEntry extends RingEntry { brand: string }
/** What the fold keeps of a decision: the ring entry plus the two facts the exploration count needs. */
export interface CompactDecision { entry: BatchRingEntry; visitor_id: string; ts: number; position: number; explored: boolean; explorationOpportunity?: boolean }
export const compactOf = (d: DecisionRecord): CompactDecision =>
  ({ entry: { ...ringEntryOf(d), brand: d.brand }, visitor_id: d.visitor_id, ts: d.ts, position: d.position, explored: d.explored, explorationOpportunity: explorationOpportunity(d) });

export interface ShardState {
  version: 1;
  shard: number;
  /** The start of the last hour folded into these rings; an earlier hour is never folded twice. */
  through: number;
  /** visitor → their decisions inside the horizon, oldest first, at most RING_CAP. */
  rings: Record<string, BatchRingEntry[]>;
  /** The date `seen` counts, and per brand the visitors with a decision on it. */
  seenDate: string;
  seen: Record<string, string[]>;
  /** Latest witnessed decision time per brand/visitor on seenDate, retained independently of ring eviction. */
  seenAt?: Record<string, Record<string, number>>;
  seenRetention?: Record<string, Record<string, RetentionStamp>>;
  /** Date-scoped, nonidentifying warning: legacy timing left incomplete visitor coverage. */
  seenIncomplete?: Record<string, true>;
  /** Technical write generation, retained after completion to prevent coordinator ETag reuse. */
  generation?: string;
  /** Only shard zero coordinates an interrupted fold; no extra visitor history is retained. */
  pending?: PendingHour;
  cleanup?: CleanupHour;
}
export const emptyShard = (shard: number): ShardState => ({ version: 1, shard, through: -1, rings: {}, seenDate: '', seen: {} });

export interface PolicyHour {
  policy: AttributionPolicy;
  role: 'learning' | 'reporting';
  credits: number;
  /** `slot|arm` → credits, for the holdout rows. */
  armCredits: Record<string, number>;
  /** slot → the decayed accumulators this hour contributed under this policy. */
  stats: Record<string, StatsState>;
}
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
  (hb.policies[p.name] ??= { policy: { scope: p.scope, match: p.match, credit: p.credit, windowsMs: p.windowsMs }, role: p.role, credits: 0, armCredits: {}, stats: {} });

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
  for (const src of [a, b]) {
    for (const [slot, arms] of Object.entries(src.arms)) addCounts((out.arms[slot] ??= {}), arms);
    for (const [slot, e] of Object.entries(src.exploration)) { const x = (out.exploration[slot] ??= { decisions: 0, explored: 0 }); x.decisions += e.decisions; x.explored += e.explored; }
    for (const [name, p] of Object.entries(src.policies)) {
      const cur = out.policies[name];
      if (!cur) { out.policies[name] = { policy: p.policy, role: p.role, credits: p.credits, armCredits: { ...p.armCredits }, stats: Object.fromEntries(Object.entries(p.stats).map(([s, st]) => [s, mergeStats(st, emptyStats(), tau)])) }; continue; }
      if (cur.role !== p.role || JSON.stringify(effectiveReportPolicy(cur.policy)) !== JSON.stringify(effectiveReportPolicy(p.policy))) unavailable();
      cur.credits += p.credits;
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
}

/** A known date boundary can skip older catch-up work without rereading or rewinding a shard. */
export class SeenDateAhead extends Error {
  constructor(public readonly seenDate: string) { super(`Hourly seen state is newer than requested date: ${seenDate}`); }
}

/**
 * Phase two, one shard: the hour's decisions join the rings (unless the shard is already past this
 * hour), erased visitors leave, the rings are pruned to the horizon and the cap, and the hour's
 * outcomes are attributed under every policy against their visitor's ring of the same brand.
 */
export function foldShard(state: ShardState, decs: readonly CompactDecision[], outs: readonly OutcomeRecord[], ctx: FoldContext): { state: ShardState; folded: boolean; changed: boolean } {
  checkSeen(state);
  if (state.seenDate > ctx.date) throw new SeenDateAhead(state.seenDate);
  let changed = false;
  const folded = ctx.from > state.through;
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
      if (retainedIds.has(entry.id) || (folded && incomingIds.has(entry.id))) throw new ReportInputError();
      aggregateBound('rawBytes', retainedBudget.bytes += size);
      retainedIds.add(entry.id);
    }
  }
  if (state.seenDate !== ctx.date) {
    changed = Object.keys(state.seen).length > 0 || state.seenAt !== undefined || state.seenIncomplete !== undefined;
    state.seenDate = ctx.date; state.seen = {}; delete state.seenAt; delete state.seenIncomplete; delete state.seenRetention;
  }
  const beforeSeen = JSON.stringify([state.seen, state.seenAt, state.seenIncomplete, state.seenRetention]);
  const seenSets = new Map(Object.entries(state.seen).map(([brand, ids]) => [brand, new Set(ids)]));
  // A timestamp can support existing membership; orphan metadata must never recreate an ID.
  const seenAt = new Map([...seenSets].map(([brand, ids]) => [brand, new Map(Object.entries(state.seenAt?.[brand] ?? {}).filter(([id]) => ids.has(id)))]));
  const incomplete = new Set(Object.keys(state.seenIncomplete ?? {}));
  for (const [brand, ids] of seenSets) for (const v of ids) {
    const tomb = ctx.tombs.get(v);
    if (!tomb) continue;
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
  // Reconstruct current-hour rows on replay too; the persisted fold guard below
  // still prevents duplicate appends or a through/seen rewind. Evicted carry-in
  // cannot be recovered here, and later dependent hours are not rebuilt.
  const orderedOutcomes = outs.filter(o => o.ts >= ctx.from && o.ts < ctx.to && !hidden(ctx.tombs, o)).sort((a, b) => a.ts - b.ts);
  const attributionRings = new Map<string, BatchRingEntry[]>();
  for (const o of orderedOutcomes) if (!attributionRings.has(o.visitor_id)) {
    attributionRings.set(o.visitor_id, (state.rings[o.visitor_id] ?? [])
      .filter(e => e.ts >= cutoff && e.ts < ctx.from && (e.measurementBasis ?? 'served-v1') === (ctx.slotCfg[e.slot]?.measurementBasis ?? 'served-v1')).sort((a, b) => a.ts - b.ts).slice(-ctx.ringCap));
  }
  const current = decs.filter(d => d.ts >= ctx.from && d.ts < ctx.to && d.ts >= cutoff
    && attributionRings.has(d.visitor_id) && !hidden(ctx.tombs, d)).sort((a, b) => a.ts - b.ts);
  const touched = new Set<string>();
  if (folded) {
    for (const d of decs) {
      if (hidden(ctx.tombs, d)) continue;
      (state.rings[d.visitor_id] ??= []).push(d.entry);
      touched.add(d.visitor_id);
      if (!onDate(d.ts, state.seenDate)) continue;
      let s = seenSets.get(d.entry.brand);
      if (!s) { s = new Set(); seenSets.set(d.entry.brand, s); }
      s.add(d.visitor_id);
      let times = seenAt.get(d.entry.brand);
      if (!times) { times = new Map(); seenAt.set(d.entry.brand, times); }
      times.set(d.visitor_id, Math.max(times.get(d.visitor_id) ?? d.ts, d.ts));
      if (d.entry.retention?.hourly) {
        const stamps = ((state.seenRetention ??= {})[d.entry.brand] ??= {}), prior = stamps[d.visitor_id];
        stamps[d.visitor_id] = prior ? mergeRetention(prior, d.entry.retention.hourly, d.entry.tenant!, 'hourly') : d.entry.retention.hourly;
      }
    }
    if (decs.length) changed = true;
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
    // An explicit reference must expose ambiguity across the complete retained
    // subject ring; the shared selector checks the unique target's brand.
    const ring = Object.hasOwn(o, 'decision_id') ? subjectRing : subjectRing.filter((e) => e.brand === o.brand);
    if (!ring.length) continue;
    const hb = (ctx.brands[o.brand] ??= emptyBrand());
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
        const arm = ring.find((e) => e.id === c.decision_id)?.arm ?? 'personalized';
        ph.armCredits[`${c.slot}|${arm}`] = (ph.armCredits[`${c.slot}|${arm}`] ?? 0) + 1;
        if (arm === 'personalized') {
          const w = creditWeight(ctx.slotCfg[c.slot]?.objective, o);
          if (w > 0) recordSuccess((ph.stats[c.slot] ??= emptyStats()), c.item, c.cell, c.reward as RewardType, c.ts, w, ctx.statsCfg);
        }
      }
    }
  }
  if (folded) { state.through = ctx.from; if (decs.length) changed = true; }
  state.seen = Object.fromEntries([...seenSets].map(([b, s]) => [b, [...s]]));
  const witnesses = [...seenAt].filter(([, times]) => times.size);
  if (witnesses.length || state.seenAt !== undefined) state.seenAt = Object.fromEntries(witnesses.map(([brand, times]) => [brand, Object.fromEntries(times)]));
  if (incomplete.size) state.seenIncomplete = Object.fromEntries([...incomplete].map(brand => [brand, true as const]));
  if (JSON.stringify([state.seen, state.seenAt, state.seenIncomplete, state.seenRetention]) !== beforeSeen) changed = true;
  return { state, folded, changed };
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
      for (const [name, value] of Object.entries(aggregateMap(b.policies))) {
        aggregateName(name); visit(); const p = aggregateMap(value);
        if (p.role !== 'learning' && p.role !== 'reporting') unavailable(); aggregateNumber(p.credits);
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
    for (const slot of new Set([...Object.keys(b.arms), ...Object.keys(b.exploration), ...Object.values(b.policies).flatMap(p => Object.keys(p.stats))])) if (!bySlot.has(slot)) unavailable();
    // The producer's arm suffix has no delimiter; retain slots containing delimiters intact.
    for (const p of Object.values(b.policies)) for (const key of Object.keys(p.armCredits)) {
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
  const names = Object.keys(hb.policies).sort((a, b) => Number(hb.policies[b]!.role === 'learning') - Number(hb.policies[a]!.role === 'learning'));
  const slots = [...new Set([...Object.keys(hb.arms), ...Object.keys(hb.exploration), ...Object.values(hb.policies).flatMap((p) => Object.keys(p.stats))])].sort();
  const policies: DayReport['policies'] = [];
  const grids: DayReport['grids'] = {};
  const holdout: DayReport['holdout'] = {};
  const holdoutComparison: DayReport['holdoutComparison'] = {};
  for (const name of names) {
    const p = hb.policies[name]!;
    policies.push({ name, policy: p.policy, role: p.role, credits: p.credits });
    for (const slot of slots) (grids[slot] ??= {})[name] = buildSnapshot(p.stats[slot] ?? emptyStats(), { tenant: ids.tenant, brand: ids.brand, slot }, slotCfg[slot]?.reward ?? 'click', now, statsCfg, null, slotCfg[slot]?.objective ?? 'unit', slotCfg[slot]?.measurementBasis ?? 'served-v1');
    if (p.role !== 'learning') continue;
    for (const slot of slots) {
      const byArm = hb.arms[slot] ?? {};
      const rows: ArmRow[] = Object.keys(byArm).sort().map((arm) => {
        const decisions = byArm[arm] ?? 0, credited = p.armCredits[`${slot}|${arm}`] ?? 0;
        return attributionArm(arm, decisions, credited);
      });
      holdout[slot] = rows;
      holdoutComparison[slot] = [];
    }
  }
  const exploration = slots.map((slot) => {
    const x = hb.exploration[slot] ?? { decisions: 0, explored: 0 };
    const cfg = learn.slots?.[slot]?.exploration ?? null;
    return { slot, decisions: x.decisions, explored: x.explored, realized: x.decisions ? r3(x.explored / x.decisions) : 0, configured: cfg && cfg.mode !== 'off' ? cfg.share : null, mode: cfg?.mode ?? null };
  });
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
    // W21 C1.03: the allocation the day was served under is published
    // configuration and is recorded here as it is on a raw-day build. The
    // per-arm VISITOR counts are not: an hour aggregate holds the day's
    // distinct visitors as one number per brand, not one per arm, so this
    // branch says unknown rather than dividing a total it does not hold.
    // Carrying them is a schema change in the hour aggregate and its shard
    // state (F25 §7), named as owed work.
    allocation: publishedAllocation(learn),
    // W22 A1.01 (F17 P4): the same named contract as every other path, with the
    // horizon THIS fold really ran under — the least of the hours it summed, so
    // the day never claims a reach one of its hours did not have. The window
    // the tenant published stands beside it, so the difference between "seven
    // days" and "forty-eight hours" is on the answer instead of in the code.
    attributionContract: attributionContractOf(learn, sorted.length
      ? Math.min(...sorted.map(a => Number.isFinite(a.horizonMs) && a.horizonMs >= 0 ? a.horizonMs : 0)) : 0),
    armVisitors: null,
    visitorOutcomes: null,
    erasures: { pending: opts.pending, rows_hidden: hb.rows_hidden },
    hours,
    coverage: reportCoverage({ counts, hours }, {
      version: 1, source: 'aggregates', truncated: counts.truncated, visitorsIncomplete: !!hb.visitorsIncomplete,
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
  if (!objectMap(state) || state.version !== 1 || state.shard !== shard || !Number.isSafeInteger(state.through) || state.through < -1
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
  const ctx: FoldContext = { tenant, date: at.date, from, to, policies, slotCfg, statsCfg, horizonMs, ringCap, tombs, brands, creditedSlots,
    retainedIds: new Set(), retainedBudget: { work: 0, bytes: 0 }, incomingIds: new Set(decisions.map(d => d.entry.id)) };
  let ringsFolded = true;
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
    for (const [brand, ids] of Object.entries(r.state.seen)) (brands[brand] ??= emptyBrand()).visitorsDay += ids.length;
    for (const brand of Object.keys(r.state.seenIncomplete ?? {})) (brands[brand] ??= emptyBrand()).visitorsIncomplete = true;
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
  const work = interrupted ? [interrupted, ...missing.filter(c => c.date !== interrupted.date || c.hour !== interrupted.hour)] : missing;
  const built: CatchUpResult['built'] = [], failed: CatchUpResult['failed'] = [];
  let budget = opts.budget ?? RUN_BUDGET;
  let newerSeen: SeenDateAhead | undefined, otherFailures = 0;
  for (const c of work) {
    if (newerSeen && c.date < newerSeen.seenDate) {
      failed.push({ date: c.date, hour: c.hour, error: newerSeen.message });
      continue;
    }
    if (built.length >= (opts.maxHours ?? 2) || budget <= 0) break;
    let spent = 0;
    const metered: R2Agg = {
      get: key => { spent++; return r2.get(key); },
      list: options => { spent++; return r2.list(options); },
      put: (key, body, options) => { spent++; return r2.put(key, body, options); },
    };
    try {
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
      if (e instanceof SeenDateAhead) {
        if (!newerSeen || e.seenDate > newerSeen.seenDate) newerSeen = e;
      } else if (++otherFailures >= 2) break;
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
export async function runDayReport(r2: R2Agg, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, reporting: ReportPolicy[] | null, now = Date.now(), opts: { maxObjects?: number } = {}, retentionEnv?: RetentionEnv): Promise<DayReport> {
  if (reporting === null) {
    const report = await publishAggregateDay(r2, ids, learn, now, false);
    if (report) return report;
  }
  if (opts.maxObjects !== undefined) {
    const n = await countDayObjects(r2, ids.tenant, ids.date, opts.maxObjects);
    if (n > opts.maxObjects) throw new ReportTooLarge(n, opts.maxObjects);
  }
  return runReport(r2, ids, learn, reporting, now, retentionEnv);
}
