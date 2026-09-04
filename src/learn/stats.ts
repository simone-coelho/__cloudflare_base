// src/learn/stats.ts
// Doc 22 §5, pure. Every learned number is a count. Exposures and successes are
// decayed accumulators on the personal vector's invariant with the long
// horizon; the item's estimate is shrunk toward its own coarser level, and lift
// compares that estimate to the slot's rate in the same cell, clamped. The
// finest level with enough exposures answers.

import { effectiveScore, type ReflexEntry } from '@/reflex/core';
import type { Cell } from '@/content/types';
import type { RewardType } from '@/ledger/records';
import { priorKey, type PriorIndex } from './priors';

export interface StatsConfig {
  n0: number;
  tauLearnMs: number;
  liftMin: number;
  liftMax: number;
  nMin: number;
}
export const DEFAULT_STATS: StatsConfig = { n0: 30, tauLearnMs: 21 * 24 * 60 * 60 * 1000, liftMin: 0.5, liftMax: 2, nMin: 30 };

export type Level = 0 | 1 | 2 | 3 | 4;
export const LEVEL_WORDS: Record<Level, string> = {
  0: 'everyone', 1: 'channel', 2: 'channel and visit bucket', 3: 'channel, visit bucket and region', 4: 'channel, visit bucket, region and affinity cell',
};

/** The five keys a cell materializes, coarsest first. */
export function levelKeys(cell: Cell): string[] {
  const c = cell.channel || 'unknown', v = cell.visit_bucket || 'unknown', r = cell.region ?? 'none', a = cell.affinity ?? 'none';
  return ['*', `c=${c}`, `c=${c}|v=${v}`, `c=${c}|v=${v}|r=${r}`, `c=${c}|v=${v}|r=${r}|a=${a}`];
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
}
export const emptyStats = (): StatsState => ({ items: {}, slot: {}, events: 0, updatedAt: 0 });

function bump(entry: ReflexEntry | undefined, ts: number, w: number, tau: number): ReflexEntry {
  const s = (entry ? effectiveScore(entry, ts, tau) : 0) + w;
  return { s, t: ts };
}
const counter = (): Counter => ({ n: { s: 0, t: 0 }, s: {} });

export function recordExposure(st: StatsState, item: string, cell: Cell, ts: number, cfg: StatsConfig): void {
  for (const k of levelKeys(cell)) {
    const ic = ((st.items[item] ??= {})[k] ??= counter());
    ic.n = bump(ic.n, ts, 1, cfg.tauLearnMs);
    const sc = (st.slot[k] ??= counter());
    sc.n = bump(sc.n, ts, 1, cfg.tauLearnMs);
  }
  st.events += 1; st.updatedAt = Math.max(st.updatedAt, ts);
}

export function recordSuccess(st: StatsState, item: string, cell: Cell, reward: RewardType, ts: number, weight: number, cfg: StatsConfig): void {
  for (const k of levelKeys(cell)) {
    const ic = ((st.items[item] ??= {})[k] ??= counter());
    ic.s[reward] = bump(ic.s[reward], ts, weight, cfg.tauLearnMs);
    const sc = (st.slot[k] ??= counter());
    sc.s[reward] = bump(sc.s[reward], ts, weight, cfg.tauLearnMs);
  }
  st.updatedAt = Math.max(st.updatedAt, ts);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const ev = (e: ReflexEntry | undefined, now: number, tau: number) => (e ? effectiveScore(e, now, tau) : 0);

export interface LevelStat {
  level: Level; key: string; n: number; s: number; p0: number; p_hat: number; lift: number;
  /** The strength the estimate was shrunk with: the imported prior's n_equiv when one applied, else the slot's n₀. */
  n0?: number;
  /** Doc 22 §8: the imported prior in force for this key, when there is one. */
  prior?: { p: number; n: number };
}
export interface ItemStats { levels: LevelStat[] }
export interface LiftSnapshot {
  tenant: string; brand: string; slot: string; reward: RewardType; version: number; publishedAt: number; events: number;
  n0: number; nMin: number; liftMin: number; liftMax: number;
  /** Doc 22 §8: the prior document's revision this snapshot was built with; 0 or absent when none. */
  priorVersion?: number;
  /** item → level key → stat */
  items: Record<string, Record<string, LevelStat>>;
  /** level key → the slot's own decayed n, s and smoothed rate in that cell */
  slotRates: Record<string, { n: number; s: number; rate: number }>;
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
export function buildSnapshot(st: StatsState, ids: { tenant: string; brand: string; slot: string }, reward: RewardType, now: number, cfg: StatsConfig, priors?: { version: number; index: PriorIndex } | null): LiftSnapshot {
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
    slotRates[key] = { n: r3(n), s: r3(s), rate: r3(Number.isFinite(rate) ? rate : 0) };
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
      const p = priors?.index.get(priorKey(item, k));
      if (p) return p;
    }
    return null;
  };
  const priorItems = new Map<string, string[]>();
  for (const k of priors?.index.keys() ?? []) {
    const at = k.lastIndexOf('|');
    const list = priorItems.get(k.slice(0, at)) ?? [];
    list.push(k.slice(at + 1));
    priorItems.set(k.slice(0, at), list);
  }
  const items: LiftSnapshot['items'] = {};
  for (const item of new Set([...Object.keys(st.items), ...priorItems.keys()])) {
    const byKey = st.items[item] ?? {};
    const keys = new Set([...Object.keys(byKey), ...(priorItems.get(item) ?? [])]);
    const out: Record<string, LevelStat> = {};
    for (const key of [...keys].sort((a, b) => depth(a) - depth(b))) {
      const c = byKey[key];
      const n = c ? ev(c.n, now, tau) : 0, s = c ? ev(c.s[reward], now, tau) : 0;
      const p0slot = slotRate(key);
      const prior = priorFor(item, key);
      const target = prior ? prior.p : p0slot, n0 = prior ? prior.n : cfg.n0;
      const p_hat = (s + n0 * target) / (n + n0);
      const lift = p0slot > 0 ? Math.min(cfg.liftMax, Math.max(cfg.liftMin, p_hat / p0slot)) : 1;
      out[key] = { level: depth(key) as Level, key, n: r3(n), s: r3(s), p0: r3(p0slot), n0: r3(n0), p_hat: r3(p_hat), lift: r3(lift), ...(prior ? { prior: { p: prior.p, n: prior.n } } : {}) };
    }
    items[item] = out;
  }
  return { ...ids, reward, version: now, publishedAt: now, events: st.events, n0: cfg.n0, nMin: cfg.nMin, liftMin: cfg.liftMin, liftMax: cfg.liftMax, priorVersion: priors?.version ?? 0, items, slotRates };
}

export function depth(key: string): number { return key === '*' ? 0 : key.split('|').length; }
export function parentKey(key: string): string | null {
  if (key === '*') return null;
  const parts = key.split('|');
  return parts.length === 1 ? '*' : parts.slice(0, -1).join('|');
}

export interface LiftLookup { level: Level; level_words: string; n: number; s: number; p0: number; p_hat: number; lift: number; version: number; reward: RewardType; n0: number; prior?: { p: number; n: number } }

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
      return { level: st.level, level_words: LEVEL_WORDS[st.level], n: st.n, s: st.s, p0: st.p0, p_hat: st.p_hat, lift: st.lift, version: snap.version, reward: snap.reward, n0: st.n0 ?? snap.n0, ...(st.prior ? { prior: st.prior } : {}) };
    }
  }
  return null;
}
