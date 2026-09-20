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

function bump(entry: ReflexEntry | undefined, ts: number, w: number, tau: number): ReflexEntry {
  if (!entry) return { s: w, t: ts };
  // Keep acknowledged mass at a monotonic reference time; late input ages only itself.
  const t = Math.max(entry.t, ts);
  return { s: effectiveScore(entry, t, tau) + w * Math.exp(-(t - ts) / tau), t };
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

export function recordExposure(st: StatsState, item: string, cell: Cell, ts: number, cfg: StatsConfig): void {
  const admitted = itemAdmitted(st, item);
  for (const k of levelKeys(cell).slice(0, (st.bounded?.depth ?? 5) + 1)) {
    const ic = admitted ? ((st.items[item] ??= {})[k] ??= counter()) : st.bounded!.omitted;
    ic.n = bump(ic.n, ts, 1, cfg.tauLearnMs);
    const sc = (st.slot[k] ??= counter());
    sc.n = bump(sc.n, ts, 1, cfg.tauLearnMs);
  }
  if (!admitted) st.bounded!.omittedEvents++;
  st.events += 1; st.updatedAt = Math.max(st.updatedAt, ts);
}

export function recordSuccess(st: StatsState, item: string, cell: Cell, reward: RewardType, ts: number, weight: number, cfg: StatsConfig): void {
  const admitted = itemAdmitted(st, item);
  for (const k of levelKeys(cell).slice(0, (st.bounded?.depth ?? 5) + 1)) {
    const ic = admitted ? ((st.items[item] ??= {})[k] ??= counter()) : st.bounded!.omitted;
    ic.s[reward] = bump(ic.s[reward], ts, weight, cfg.tauLearnMs);
    const sc = (st.slot[k] ??= counter());
    sc.s[reward] = bump(sc.s[reward], ts, weight, cfg.tauLearnMs);
  }
  st.updatedAt = Math.max(st.updatedAt, ts);
}

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
export function buildSnapshot(st: StatsState, ids: { tenant: string; brand: string; slot: string }, reward: RewardType, now: number, cfg: StatsConfig, priors?: { version: number; index: PriorIndex } | null, objective: 'unit' | 'revenue' | 'margin' = 'unit', measurementBasis: import('@/content/types').MeasurementBasis = 'served-v1', attributionContract?: AttributionContract): LiftSnapshot {
  const tau = cfg.tauLearnMs;
  // The slot's rate per level key, shrunk toward the parent key's rate; the root shrinks toward itself.
  const slotRates: LiftSnapshot['slotRates'] = {};
  const slotRate = (key: string): number => {
    if (slotRates[key]) return slotRates[key]!.rate;
    const c = st.slot[key];
    const n = c ? ev(c.n, now, tau) : 0, s = c ? ev(c.s[reward], now, tau) : 0;
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
  return { tenant: ids.tenant, brand: ids.brand, slot: ids.slot, reward, objective, measurementBasis, tauLearnMs: cfg.tauLearnMs, version: now, publishedAt: now, events: st.events, n0: cfg.n0, nMin: cfg.nMin, liftMin: cfg.liftMin, liftMax: cfg.liftMax, priorVersion: priors?.version ?? 0, items, slotRates,
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
