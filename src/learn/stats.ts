// src/learn/stats.ts
// Doc 22 §5, pure. Every learned number is a count. Exposures and successes are
// decayed accumulators on the personal vector's invariant with the long
// horizon; the item's estimate is shrunk toward its own coarser level, and lift
// compares that estimate to the slot's rate in the same cell, clamped. The
// finest level with enough exposures answers.

import { effectiveScore, type ReflexEntry } from '@/reflex/core';
import type { Cell } from '@/content/types';
import type { RewardType } from '@/ledger/records';
import type { PriorIndex } from './priors';

export interface StatsConfig {
  n0: number;
  tauLearnMs: number;
  liftMin: number;
  liftMax: number;
  nMin: number;
}
export const DEFAULT_STATS: StatsConfig = { n0: 30, tauLearnMs: 21 * 24 * 60 * 60 * 1000, liftMin: 0.5, liftMax: 2, nMin: 30 };

/**
 * W22 A1.02: how far back the visitor's ring reaches, as ONE constant.
 *
 * The object that enforces it (`@/durable-objects/DecisionRing`) re-exports it
 * under this name, and the online fan-out (`@/learn/fan`) binds its
 * `ONLINE_RING_REACH_MS` to it, so the horizon the online path DECLARES as
 * applied is the horizon the ring actually holds and the two cannot drift.
 * It is declared in this pure module because the ring imports the fan-out and
 * the fan-out must read the constant at module scope: a definition in either of
 * them would be read across an import cycle, before initialization, whenever
 * the other loaded first.
 */
export const RING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type Level = 0 | 1 | 2 | 3 | 4 | 5;
export const LEVEL_WORDS: Record<Level, string> = {
  0: 'everyone', 1: 'channel', 2: 'channel and visit bucket', 3: 'channel, visit bucket and journey stage',
  4: 'channel, visit bucket, stage and region', 5: 'channel, visit bucket, stage, region and affinity cell',
};

/**
 * The six keys a cell materializes, coarsest first. CW29 put the journey stage
 * after the visit bucket: explorers and buyers respond to different content,
 * and a stage is known for more shoppers than a region or an affinity cell is.
 */
export function levelKeys(cell: Cell): string[] {
  const c = cell.channel || 'unknown', v = cell.visit_bucket || 'unknown', st = cell.stage ?? 'unknown', r = cell.region ?? 'none', a = cell.affinity ?? 'none';
  return ['*', `c=${c}`, `c=${c}|v=${v}`, `c=${c}|v=${v}|s=${st}`, `c=${c}|v=${v}|s=${st}|r=${r}`, `c=${c}|v=${v}|s=${st}|r=${r}|a=${a}`];
}

/** Decayed accumulators for one key. */
export interface Counter { n: ReflexEntry; s: Partial<Record<RewardType, ReflexEntry>> }

export interface StatsState {
  /** item → level key → counter */
  items: Record<string, Record<string, Counter>>;
  /** level key → counter, the slot as a whole */
  slot: Record<string, Counter>;
  events: number;
  updatedAt: number;
  /** Monotone projection: removed fine levels never become partial estimates. */
  bounded?: { depth: Level; omitted: Counter; omittedEvents: number; closed?: boolean; selection: 'first-seen' | 'lexical-repair' };
}
export const emptyStats = (): StatsState => ({ items: {}, slot: {}, events: 0, updatedAt: 0 });

/**
 * W23 T1.01 / T1.02 (doc 16 §4 :104 "The engine clock is authoritative … a
 * forged or skewed clock cannot inflate affinity"; F18 §6.3 "a future-dated
 * event suspends decay", §8 "the client timestamp clamped").
 *
 * `now` is the engine's own present. Three things follow, and nothing else
 * changes:
 *   · a contribution stamped AFTER the present is folded in AT the present. It
 *     is counted in full — never dropped, never refused here — but it cannot
 *     buy itself a reference time the engine cannot account for.
 *   · no counter's reference time is left after the present, so a counter that
 *     a future-dated event already anchored ahead stops being frozen: its next
 *     event pulls the anchor back to now and it decays from now on. Because
 *     `effectiveScore` clamps `dt` at zero, the mass acknowledged at that future
 *     anchor is carried across unchanged — pulled back, never inflated.
 *   · a legitimately OLD `ts` is untouched: `min(ts, now) === ts`, the anchor is
 *     still `max(entry.t, ts)`, and the contribution ages by exactly its own
 *     age. An old event is admitted as old (HANDOFF-2026-09-18 §7 :353/:354).
 *
 * The default `Infinity` is the merge primitive's NO-CLAMP behaviour, identical
 * to this function before W23. `coarsenStats` folds mass that is already stored
 * and must never silently repair a stored anchor, so it keeps that default.
 */
function bump(entry: ReflexEntry | undefined, ts: number, w: number, tau: number, now = Infinity): ReflexEntry {
  const at = Math.min(ts, now);
  if (!entry) return { s: w, t: at };
  // Keep acknowledged mass at a monotonic reference time, never after the
  // engine's present; late input ages only itself.
  const t = Math.min(Math.max(entry.t, at), now);
  return { s: effectiveScore(entry, t, tau) + w * Math.exp(-(t - at) / tau), t };
}

/**
 * W23 H1.01: does this state hold a reference time the engine's present cannot
 * account for? Pure, and read-only by construction — naming damage is not
 * repairing it (F18 §8: "fixing `bump` does not repair counters whose `t` is
 * already skewed"). Once every write clamps, only state damaged before the
 * clamp, or damaged out of band, can answer true.
 */
export function anchoredAfter(st: StatsState, now: number): boolean {
  if (st.updatedAt > now) return true;
  const maps: Array<Record<string, Counter>> = [st.slot, ...Object.values(st.items)];
  if (st.bounded) maps.push({ '*': st.bounded.omitted });
  for (const map of maps) for (const c of Object.values(map)) {
    if (c.n.t > now) return true;
    for (const entry of Object.values(c.s)) if (entry && entry.t > now) return true;
  }
  return false;
}
const counter = (): Counter => ({ n: { s: 0, t: 0 }, s: {} });

export const STAT_ITEM_BUDGET = 256;
export function boundStats(st: StatsState, level: Level): void {
  st.bounded ??= { depth: 5, omitted: counter(), omittedEvents: 0, selection: 'first-seen' };
  st.bounded.depth = Math.min(st.bounded.depth, level) as Level;
  for (const map of [st.slot, ...Object.values(st.items)]) for (const key of Object.keys(map)) {
    if (depth(key) > st.bounded.depth) delete map[key];
  }
}

/** Only disjoint ITEM roots are merged; never add overlapping ladder levels. */
export function coarsenStats(st: StatsState, cfg: StatsConfig): void {
  boundStats(st, 0);
  st.bounded!.selection = 'lexical-repair';
  for (const item of Object.keys(st.items).sort().slice(STAT_ITEM_BUDGET)) {
    st.bounded!.closed = true;
    const root = st.items[item]?.['*'];
    if (!root) throw new Error('Missing item mass proof');
    const out = st.bounded!.omitted;
    out.n = bump(out.n, root.n.t, root.n.s, cfg.tauLearnMs);
    for (const [reward, entry] of Object.entries(root.s)) if (entry) {
      out.s[reward as RewardType] = bump(out.s[reward as RewardType], entry.t, entry.s, cfg.tauLearnMs);
    }
    delete st.items[item];
  }
}

function itemAdmitted(st: StatsState, item: string): boolean {
  if (!st.bounded || Object.hasOwn(st.items, item) || !st.bounded.closed && Object.keys(st.items).length < STAT_ITEM_BUDGET) return true;
  // With omitted items, only the complete population's root is retained.
  boundStats(st, 0);
  st.bounded!.closed = true;
  return false;
}

/**
 * W23 T1.01 / T1.02: the trailing `now` is the engine's present, and it is
 * OPTIONAL. Every existing caller — including the batch fold over retained
 * history (`src/learn/hourly.ts`, `src/learn/report.ts`) — keeps its current
 * signature and gets the engine's own clock, and for a fold of historical rows
 * `min(ts, now) === ts`, so nothing about a historical rebuild changes
 * (F18 §3: the batch fold is not the defect). A caller that already knows the
 * present it is recording against passes it, so the arithmetic cannot depend on
 * how long the surrounding work took.
 */
export function recordExposure(st: StatsState, item: string, cell: Cell, ts: number, cfg: StatsConfig, now: number = Date.now()): void {
  const admitted = itemAdmitted(st, item);
  for (const k of levelKeys(cell).slice(0, (st.bounded?.depth ?? 5) + 1)) {
    const ic = admitted ? ((st.items[item] ??= {})[k] ??= counter()) : st.bounded!.omitted;
    ic.n = bump(ic.n, ts, 1, cfg.tauLearnMs, now);
    const sc = (st.slot[k] ??= counter());
    sc.n = bump(sc.n, ts, 1, cfg.tauLearnMs, now);
  }
  if (!admitted) st.bounded!.omittedEvents++;
  st.events += 1; st.updatedAt = stampedAt(st.updatedAt, ts, now);
}

export function recordSuccess(st: StatsState, item: string, cell: Cell, reward: RewardType, ts: number, weight: number, cfg: StatsConfig, now: number = Date.now()): void {
  const admitted = itemAdmitted(st, item);
  for (const k of levelKeys(cell).slice(0, (st.bounded?.depth ?? 5) + 1)) {
    const ic = admitted ? ((st.items[item] ??= {})[k] ??= counter()) : st.bounded!.omitted;
    ic.s[reward] = bump(ic.s[reward], ts, weight, cfg.tauLearnMs, now);
    const sc = (st.slot[k] ??= counter());
    sc.s[reward] = bump(sc.s[reward], ts, weight, cfg.tauLearnMs, now);
  }
  st.updatedAt = stampedAt(st.updatedAt, ts, now);
}

/**
 * The state's own last-updated stamp, under the same rule as every counter's
 * reference time: forward with the evidence, never after the engine's present.
 * A stamp a future-dated event already pushed ahead is pulled back by the next
 * event that is recorded, and only by it.
 */
const stampedAt = (updatedAt: number, ts: number, now: number): number => Math.min(Math.max(updatedAt, ts), now);

const ev = (e: ReflexEntry | undefined, now: number, tau: number) => (e ? effectiveScore(e, now, tau) : 0);

export interface LevelStat {
  level: Level; key: string; n: number; s: number; p0: number; p_hat: number; lift: number;
  /** The strength the estimate was shrunk with: the imported prior's n_equiv when one applied, else the slot's n₀. */
  n0?: number;
  /** Doc 22 §8: the imported prior in force for this key, when there is one. */
  prior?: { p: number; n: number };
}
export interface ItemStats { levels: LevelStat[] }

/**
 * W22 A1.01 (document 35 §5 row W22: "Define one attribution contract with
 * versioned histories/horizons, not blindly identical caps"; N23; F17 P4).
 *
 * ONE contract, named and versioned, carried by every path that reports
 * attribution — the day report built from records, the day report built from
 * hours, the window report and the published lift snapshot — so a reader can
 * see that two numbers were produced under the same history, and can see WHERE
 * they differ when they were not.
 *
 * The two window maps are deliberately separate and are never the same number
 * by construction:
 *   · `windowsMs` is what the TENANT'S PUBLISHED POLICY asks for, per reward.
 *   · `appliedWindowsMs` is the horizon that path could actually read — the
 *     fold's own `horizonMs`, the raw day's one day, the online ring's own age
 *     limit — and is never larger than what was asked for.
 * F17 P4 is exactly the gap between them: a seven-day purchase window against a
 * forty-eight-hour batch horizon, where "the engine learns from a credit the
 * report cannot show". Stating both makes that difference visible instead of
 * letting one label stand for two different computations.
 */
export interface AttributionContract {
  name: 'attribution';
  /** Bumped only when the meaning of a number under this contract changes. */
  version: number;
  history: { scope: 'session' | 'visitor'; match: 'direct' | 'any'; credit: 'first' | 'last' };
  /** Per reward, what the tenant's published policy asks for. */
  windowsMs: Record<string, number>;
  /** Per reward, the horizon this path really applied. Never above `windowsMs`. */
  appliedWindowsMs: Record<string, number>;
}
export interface LiftSnapshot {
  measurementBasis?: import('@/content/types').MeasurementBasis;
  /** Exact committed state/fence identity checked against the authoritative DO. */
  witness?: string;
  completeness?: { depth: Level; omittedItems: boolean; selection: 'first-seen' | 'lexical-repair'; reason: 'complete' | 'coarse' | 'item-capacity' };
  /** Missing on legacy archives; live serving requires an explicit matching horizon. */
  tauLearnMs?: number;
  tenant: string; brand: string; slot: string; reward: RewardType;
  /** CW27: what a success was worth when these counts were built. Absent on snapshots from before. */
  objective?: 'unit' | 'revenue' | 'margin';
  /**
   * W24 G1.01 (F19 §7 "Stamp a generation on the counters and start a fresh one
   * when the generation changes … Do not silently keep the counters").
   *
   * The ACCUMULATION generation these counters belong to: the objective, the
   * reward they were filtered to, the decay horizon and the accumulation schema
   * they were built under, together with the moment that generation started
   * counting (`accumulationGeneration`). It is deliberately NOT keyed on the
   * estimator or the presentation dials (`n0`, `nMin`, `liftMin`, `liftMax`):
   * changing those reinterprets nothing, so the counters and this name carry on.
   *
   * A STRING, and distinct from the numeric recovery `generation` of the
   * statistics object's fence, which counts repairs rather than naming what the
   * counters mean. Absent on an archive published before this existed.
   */
  generation?: string;
  /** W24 G1.01: when this generation started counting. */
  restartedAt?: number;
  /** W24 G1.01: exposures counted since it started, so a receipt can say how much evidence the current generation holds. */
  exposuresSinceRestart?: number;
  version: number; publishedAt: number; events: number;
  n0: number; nMin: number; liftMin: number; liftMax: number;
  /** Doc 22 §8: the prior document's revision this snapshot was built with; 0 or absent when none. */
  priorVersion?: number;
  /** item → level key → stat */
  items: Record<string, Record<string, LevelStat>>;
  /** level key → the slot's own decayed n, s and smoothed rate in that cell */
  slotRates: Record<string, { n: number; s: number; rate: number }>;
  /** W22 A1.01: the attribution contract these counts were produced under. Absent on an archive from before it existed. */
  attributionContract?: AttributionContract;
  /**
   * W23 H1.01 (document 35 §5 row W23 :425 "Rebuild or explicitly reset damaged
   * item and slot state … A local merge patch alone cannot repair historical
   * evidence"): the basis these counters were rebuilt on, when they were. A
   * reader of this snapshot can then see that it holds the evidence admitted
   * SINCE that repair and not the tenant's whole history.
   *
   * ABSENT on an object that was never repaired — repair is conditional on
   * actual affected history (HANDOFF-2026-09-16 §6 :227) — so no existing
   * snapshot, and no snapshot of an unaffected slot, gains a member.
   */
  rebuiltFrom?: RebuildBasis;
}

/** How a repaired object's counters were started again, and under whose operation. */
export interface RebuildBasis {
  /**
   * `explicit-reset`: the operator discarded the damaged counters outright (W23 H1.01).
   * `ledger-rebuild`: W24 T1.02 — the operator started the counters again from the
   * events the platform retained for one day, so the reader knows the object holds
   * that day's evidence and not the tenant's whole history.
   */
  basis: 'explicit-reset' | 'ledger-rebuild';
  /** The audited recovery operation that did it. */
  operationId: string;
  at: number;
  /** The generation the object moved to, so nothing prepared against the old one can be mistaken for post-repair evidence. */
  generation: number;
  /** W24 T1.02: the retained day a `ledger-rebuild` was folded from. */
  date?: string;
}

/**
 * W24 G1.01: the accumulation schema these counters were built under — what a
 * counter MEANS, not how it is presented. Bumped only when a change would make
 * an existing counter mean something else, which is precisely when learning must
 * start again rather than carry on.
 */
export const ACCUMULATION_SCHEMA = 1;

/**
 * W24 G1.01: the name of an accumulation generation. It covers the accumulation
 * half only — schema, objective, reward, decay horizon — so two snapshots can be
 * compared for "same counters, same meaning" without reading the counters, and a
 * presentation change (n0, nMin, the lift clamps) keeps the name because it
 * reinterprets nothing.
 *
 * `restartedAt` is appended only for counters that were actually RESTARTED, and
 * it is what separates two runs of one meaning: a slot moved to revenue and back
 * to unit is not the unit generation it was before, and its name says so. A
 * generation that has never been restarted has nothing more to be named by, and
 * in particular is not named by its own evidence — every new event moves a
 * decayed counter's reference time forward, so a name taken from the counters
 * would change whenever the slot was served, which is exactly what a generation
 * must not do.
 */
export function accumulationGeneration(a: { objective: 'unit' | 'revenue' | 'margin'; reward: RewardType; tauLearnMs: number }, restartedAt?: number): string {
  const name = `a${ACCUMULATION_SCHEMA}:${a.objective}:${a.reward}:${a.tauLearnMs}`;
  return typeof restartedAt === 'number' && Number.isFinite(restartedAt) ? `${name}:${restartedAt}` : name;
}

/**
 * W24 G1.01: when the counters standing in this state began, for a state whose
 * own generation was never stamped — the earliest reference time any counter
 * carries. An object that has never been restarted has counted since its first
 * evidence, which is exactly that moment; a state with no evidence at all has
 * counted since now.
 */
function earliestAnchor(st: StatsState, now: number): number {
  let earliest = Infinity;
  const consider = (c: Counter | undefined) => {
    if (!c) return;
    if (c.n.t > 0) earliest = Math.min(earliest, c.n.t);
    for (const entry of Object.values(c.s)) if (entry && entry.t > 0) earliest = Math.min(earliest, entry.t);
  };
  for (const map of [st.slot, ...Object.values(st.items)]) for (const c of Object.values(map)) consider(c);
  consider(st.bounded?.omitted);
  return Number.isFinite(earliest) ? earliest : now;
}

/**
 * The snapshot for one reward: decayed counts at `now`, the slot's smoothed
 * rate per cell (shrunk toward its parent cell where sparse), and each item's
 * estimate per level shrunk toward the slot's rate in that cell, with the lift
 * as their ratio. Pooling upward is done by level SELECTION (the finest level
 * with enough exposures answers), never by chaining an item's own estimates:
 * an item's events at a fine level are the same events at every coarser one,
 * and shrinking toward yourself is not shrinkage. §5.3's example is exact.
 */
export function buildSnapshot(st: StatsState, ids: { tenant: string; brand: string; slot: string }, reward: RewardType, now: number, cfg: StatsConfig, priors?: { version: number; index: PriorIndex } | null, objective: 'unit' | 'revenue' | 'margin' = 'unit', measurementBasis: import('@/content/types').MeasurementBasis = 'served-v1', attributionContract?: AttributionContract, restartedAt?: number): LiftSnapshot {
  const tau = cfg.tauLearnMs;
  /**
   * W24 T1.02 (F19 §7.3, §4.4, over the retained "item reset retains the slot
   * denominator", HANDOFF-2026-09-16 :228): the slot's own mass is the mass of
   * the evidence the platform still HOLDS — the retained items, plus the bucket
   * of items capacity omitted, which is where their mass went — and not a
   * separate running total that keeps counting exposures no item can be credited
   * for. For every state that was only ever written to, the two are the same
   * number by construction (`recordExposure` bumps the item and the slot
   * together, and an omitted item's mass goes to `bounded.omitted`); they part
   * company exactly when an item's evidence is discarded, and then the
   * denominator must follow the evidence or every later lift is computed against
   * exposures that can no longer be credited.
   *
   * Summed over SORTED item names so the total is order-invariant: two states
   * holding the same counters produce the same bits whatever order they were
   * built in (W23's order-invariance, kept).
   */
  const retained = Object.keys(st.items).sort().map(item => st.items[item]!);
  const slotMass = (key: string): { n: number; s: number } => {
    let n = 0, s = 0;
    for (const map of retained) {
      const c = map[key];
      if (c) { n += ev(c.n, now, tau); s += ev(c.s[reward], now, tau); }
    }
    // The omitted bucket is the complete population's root and lives only there.
    if (key === '*' && st.bounded) { n += ev(st.bounded.omitted.n, now, tau); s += ev(st.bounded.omitted.s[reward], now, tau); }
    return { n, s };
  };
  // The slot's rate per level key, shrunk toward the parent key's rate; the root shrinks toward itself.
  const slotRates: LiftSnapshot['slotRates'] = {};
  const slotRate = (key: string): number => {
    if (slotRates[key]) return slotRates[key]!.rate;
    const { n, s } = slotMass(key);
    const parent = parentKey(key);
    const p0 = parent === null ? (n > 0 ? s / n : 0) : slotRate(parent);
    const rate = (s + cfg.n0 * p0) / (n + cfg.n0);
    // Snapshots are arithmetic inputs (including nMin), not presentation strings.
    slotRates[key] = { n, s, rate: Number.isFinite(rate) ? rate : 0 };
    return slotRates[key]!.rate;
  };
  // Doc 22 §8: an imported prior is the shrinkage target and strength for its
  // key, in place of the slot's rate and n₀, until live evidence outweighs it.
  // The lift's reference stays the slot's rate in the cell, so p̂ / p₀ on the
  // receipt remains the definition of lift. An item that has a prior but no
  // live events yet still gets an estimate: that is what a prior is for. A
  // prior given at a coarser key applies to every finer key of the item until
  // a finer prior overrides it, so a handful of live events in one cell never
  // outweighs a belief worth hundreds; only their weight of evidence does.
  const priorFor = (item: string, key: string): { p: number; n: number } | null => {
    for (let k: string | null = key; k !== null; k = parentKey(k)) {
      const p = priors?.index.get(item)?.get(k);
      if (p) return p;
    }
    return null;
  };
  const items: LiftSnapshot['items'] = {};
  for (const item of new Set([...Object.keys(st.items), ...(priors?.index.keys() ?? [])])) {
    if (st.bounded?.closed && !Object.hasOwn(st.items, item)) continue;
    const byKey = st.items[item] ?? {};
    const keys = new Set([...Object.keys(byKey), ...(priors?.index.get(item)?.keys() ?? [])]);
    const out: Record<string, LevelStat> = {};
    for (const key of [...keys].sort((a, b) => depth(a) - depth(b))) {
      if (st.bounded && depth(key) > st.bounded.depth) continue;
      const c = byKey[key];
      const n = c ? ev(c.n, now, tau) : 0, s = c ? ev(c.s[reward], now, tau) : 0;
      const p0slot = slotRate(key);
      const prior = priorFor(item, key);
      const target = prior ? prior.p : p0slot, n0 = prior ? prior.n : cfg.n0;
      const p_hat = (s + n0 * target) / (n + n0);
      const lift = p0slot > 0 ? Math.min(cfg.liftMax, Math.max(cfg.liftMin, p_hat / p0slot)) : 1;
      out[key] = { level: depth(key) as Level, key, n, s, p0: p0slot, n0, p_hat, lift, ...(prior ? { prior: { p: prior.p, n: prior.n } } : {}) };
    }
    items[item] = out;
  }
  // W24 G1.01: the generation these counters belong to, and what it has seen.
  // `restartedAt` is supplied by an object that was actually restarted; a state
  // that was only ever counted into has run since its own earliest evidence.
  const startedAt = typeof restartedAt === 'number' && Number.isFinite(restartedAt) ? restartedAt : earliestAnchor(st, now);
  return { tenant: ids.tenant, brand: ids.brand, slot: ids.slot, reward, objective, measurementBasis, tauLearnMs: cfg.tauLearnMs, version: now, publishedAt: now, events: st.events, n0: cfg.n0, nMin: cfg.nMin, liftMin: cfg.liftMin, liftMax: cfg.liftMax, priorVersion: priors?.version ?? 0, items, slotRates,
    generation: accumulationGeneration({ objective, reward, tauLearnMs: cfg.tauLearnMs }, restartedAt), restartedAt: startedAt, exposuresSinceRestart: st.events,
    ...(attributionContract ? { attributionContract } : {}),
    ...(st.bounded ? { completeness: { depth: st.bounded.depth, omittedItems: st.bounded.closed === true,
      selection: st.bounded.selection, reason: st.bounded.closed ? 'item-capacity' as const : st.bounded.depth < 5 ? 'coarse' as const : 'complete' as const } } : {}) };
}

export function depth(key: string): number { return key === '*' ? 0 : key.split('|').length; }
export function parentKey(key: string): string | null {
  if (key === '*') return null;
  const parts = key.split('|');
  return parts.length === 1 ? '*' : parts.slice(0, -1).join('|');
}

export interface LiftLookup { measurementBasis: import('@/content/types').MeasurementBasis; level: Level; level_words: string; n: number; s: number; p0: number; p_hat: number; lift: number; version: number; reward: RewardType; objective: 'unit' | 'revenue' | 'margin'; n0: number; prior?: { p: number; n: number } }

/** The finest level with enough exposures for this item in this cell, or null when nothing has been learned yet. */
export function liftFor(snap: LiftSnapshot | null | undefined, item: string, cell: Cell): LiftLookup | null {
  if (!snap) return null;
  const byKey = snap.items[item];
  if (!byKey) return null;
  const keys = levelKeys(cell);
  for (let i = keys.length - 1; i >= 0; i--) {
    const st = byKey[keys[i]!];
    // A level with an imported prior counts the prior's strength toward the threshold (doc 22 §8).
    if (st && st.n + (st.prior?.n ?? 0) >= snap.nMin) {
      return { measurementBasis: snap.measurementBasis ?? 'served-v1', level: st.level, level_words: LEVEL_WORDS[st.level], n: st.n, s: st.s, p0: st.p0, p_hat: st.p_hat, lift: st.lift, version: snap.version, reward: snap.reward, objective: snap.objective ?? 'unit', n0: st.n0 ?? snap.n0, ...(st.prior ? { prior: st.prior } : {}) };
    }
  }
  return null;
}
