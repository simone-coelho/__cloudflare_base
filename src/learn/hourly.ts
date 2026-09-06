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
import type { OutcomeRecord, RewardType } from '@/ledger/records';
import type { R2Like } from '@/ledger/writer';
import { effectiveScore, type ReflexEntry } from '@/reflex/core';
import { compareArms } from '@/measure/holdout';
import { attribute, creditWeight, type AttributionPolicy, type RingEntry } from './policy';
import { ringEntryOf } from './fan';
import { countDayObjects, presetPolicies, reportKey, runReport, type ArmRow, type DayReport, type ReportPolicy } from './report';
import { policyOf, slotConfigsOf } from './route';
import { buildSnapshot, DEFAULT_STATS, emptyStats, recordExposure, recordSuccess, type Counter, type StatsConfig, type StatsState } from './stats';

export const HOUR_MS = 3600_000;
/** Visitors are spread over this many ring shards; chosen once, because changing it re-partitions every visitor. */
export const SHARDS = 64;
/** The online ring's capacity per visitor (DecisionRing's RING_MAX); the batch ring keeps no more. */
export const RING_CAP = 200;
/** How far back a batch ring reaches: two days holds every window but the seven-day purchase one, within a shard a Worker can parse. */
export const DEFAULT_HORIZON_MS = 48 * HOUR_MS;
/** An hour is folded this long after it ends, so the queue has drained into the ledger. */
export const CLOSE_GRACE_MS = 5 * 60_000;

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
export interface CompactDecision { entry: BatchRingEntry; visitor_id: string; ts: number; position: number; explored: boolean }
export const compactOf = (d: DecisionRecord): CompactDecision =>
  ({ entry: { ...ringEntryOf(d), brand: d.brand }, visitor_id: d.visitor_id, ts: d.ts, position: d.position, explored: d.explored });

export interface ShardState {
  version: 1;
  shard: number;
  /** The start of the last hour folded into these rings; an earlier hour is never folded twice. */
  through: number;
  /** visitor → their decisions inside the horizon, oldest first, at most RING_CAP. */
  rings: Record<string, BatchRingEntry[]>;
  /** The date `seen` counts, and per brand the visitors with a decision on it: the day's distinct-visitor count, exactly. */
  seenDate: string;
  seen: Record<string, string[]>;
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
  decisions: number;
  outcomes: number;
  /** Distinct visitors with a decision on the date, through this hour (a maximum across hours, not a sum). */
  visitorsDay: number;
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
  tenant: string;
  date: string;
  hour: number;
  from: number;
  to: number;
  builtAt: number;
  /** Ledger objects the fold read. */
  objects: number;
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
/** Two hours of one brand as one; the later policy definition wins when an operator changed it between them. */
export function mergeBrand(a: HourBrand, b: HourBrand, tau: number): HourBrand {
  const out = emptyBrand();
  out.decisions = a.decisions + b.decisions;
  out.outcomes = a.outcomes + b.outcomes;
  out.visitorsDay = Math.max(a.visitorsDay, b.visitorsDay);
  out.rows_hidden = a.rows_hidden + b.rows_hidden;
  for (const src of [a, b]) {
    for (const [slot, arms] of Object.entries(src.arms)) addCounts((out.arms[slot] ??= {}), arms);
    for (const [slot, e] of Object.entries(src.exploration)) { const x = (out.exploration[slot] ??= { decisions: 0, explored: 0 }); x.decisions += e.decisions; x.explored += e.explored; }
    for (const [name, p] of Object.entries(src.policies)) {
      const cur = out.policies[name];
      if (!cur) { out.policies[name] = { policy: p.policy, role: p.role, credits: p.credits, armCredits: { ...p.armCredits }, stats: Object.fromEntries(Object.entries(p.stats).map(([s, st]) => [s, mergeStats(st, emptyStats(), tau)])) }; continue; }
      cur.policy = p.policy;
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
    if (d.position === 0 && e.arm !== 'default') { const x = (hb.exploration[e.slot] ??= { decisions: 0, explored: 0 }); x.decisions += 1; if (d.explored) x.explored += 1; }
    // Exposures: the personalized arm only, as the fan-in records them (doc 22 §10: holdout traffic never feeds the statistics).
    if (e.arm === 'personalized') for (const p of policies) recordExposure((policyHour(hb, p).stats[e.slot] ??= emptyStats()), e.item, e.cell, d.ts, statsCfg);
  }
  for (const hb of Object.values(into)) for (const p of policies) policyHour(hb, p);
  return into;
}

export interface FoldContext {
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
}

/**
 * Phase two, one shard: the hour's decisions join the rings (unless the shard is already past this
 * hour), erased visitors leave, the rings are pruned to the horizon and the cap, and the hour's
 * outcomes are attributed under every policy against their visitor's ring of the same brand.
 */
export function foldShard(state: ShardState, decs: readonly CompactDecision[], outs: readonly OutcomeRecord[], ctx: FoldContext): { state: ShardState; folded: boolean; changed: boolean } {
  let changed = false;
  const folded = ctx.from > state.through;
  if (state.seenDate !== ctx.date) { if (Object.keys(state.seen).length) changed = true; state.seenDate = ctx.date; state.seen = {}; }
  for (const v of ctx.tombs.keys()) {
    const ring = state.rings[v];
    if (!ring) continue;
    const kept = withoutErased(ring.map((e) => ({ visitor_id: v, ts: e.ts, e })), ctx.tombs).map((x) => x.e);
    if (kept.length) state.rings[v] = kept; else delete state.rings[v];
    changed = true;
  }
  const touched = new Set<string>();
  const seenSets = new Map<string, Set<string>>(Object.entries(state.seen).map(([b, ids]) => [b, new Set(ids)]));
  if (folded) {
    for (const d of decs) {
      (state.rings[d.visitor_id] ??= []).push(d.entry);
      touched.add(d.visitor_id);
      let s = seenSets.get(d.entry.brand);
      if (!s) { s = new Set(); seenSets.set(d.entry.brand, s); }
      s.add(d.visitor_id);
    }
    if (decs.length) changed = true;
  }
  // Measured from the hour's start, so every outcome in the hour reaches back the whole horizon.
  const cutoff = ctx.from - ctx.horizonMs;
  for (const [v, ring] of Object.entries(state.rings)) {
    const sorted = touched.has(v) ? [...ring].sort((a, b) => a.ts - b.ts) : ring;
    const kept = sorted.filter((e) => e.ts >= cutoff).slice(-ctx.ringCap);
    if (kept.length !== ring.length || touched.has(v)) changed = true;
    if (kept.length) state.rings[v] = kept; else delete state.rings[v];
  }
  for (const o of outs) {
    const ring = (state.rings[o.visitor_id] ?? []).filter((e) => e.brand === o.brand);
    if (!ring.length) continue;
    const hb = (ctx.brands[o.brand] ??= emptyBrand());
    for (const p of ctx.policies) {
      const ph = policyHour(hb, p);
      for (const c of attribute(o, ring, p)) {
        const reward = ctx.slotCfg[c.slot]?.reward ?? 'click';
        if (c.reward !== reward) continue;                       // the slot learns against one reward
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
  return { state, folded, changed };
}

// ── the day from its hours ────────────────────────────────────────────────────

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The day report, in the shape `buildReport` makes, from whichever hours are built. */
export function reportFromHours(aggs: readonly HourAggregate[], ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, now: number, opts: { pending: number; missing: number[] }): DayReport {
  const statsCfg: StatsConfig = learn.stats ?? DEFAULT_STATS, slotCfg = slotConfigsOf(learn), tau = statsCfg.tauLearnMs;
  const sorted = [...aggs].sort((a, b) => a.hour - b.hour);
  let hb = emptyBrand();
  for (const a of sorted) { const b = a.brands[ids.brand]; if (b) hb = mergeBrand(hb, b, tau); }
  const names = Object.keys(hb.policies).sort((a, b) => Number(hb.policies[b]!.role === 'learning') - Number(hb.policies[a]!.role === 'learning'));
  const slots = [...new Set([...Object.keys(hb.arms), ...Object.keys(hb.exploration), ...Object.values(hb.policies).flatMap((p) => Object.keys(p.stats))])].sort();
  const policies: DayReport['policies'] = [];
  const grids: DayReport['grids'] = {};
  const holdout: DayReport['holdout'] = {};
  const holdoutComparison: DayReport['holdoutComparison'] = {};
  for (const name of names) {
    const p = hb.policies[name]!;
    policies.push({ name, policy: p.policy, role: p.role, credits: p.credits });
    for (const slot of slots) (grids[slot] ??= {})[name] = buildSnapshot(p.stats[slot] ?? emptyStats(), { tenant: ids.tenant, brand: ids.brand, slot }, slotCfg[slot]?.reward ?? 'click', now, statsCfg, null, slotCfg[slot]?.objective ?? 'unit');
    if (p.role !== 'learning') continue;
    for (const slot of slots) {
      const byArm = hb.arms[slot] ?? {};
      const rows: ArmRow[] = Object.keys(byArm).sort().map((arm) => {
        const decisions = byArm[arm] ?? 0, credited = p.armCredits[`${slot}|${arm}`] ?? 0;
        return { arm, decisions, credited, rate: decisions ? r3(credited / decisions) : 0 };
      });
      holdout[slot] = rows;
      const treated = rows.find((r) => r.arm === 'personalized');
      holdoutComparison[slot] = treated ? rows.filter((r) => r.arm !== 'personalized').map((r) => compareArms({ arm: r.arm, n: r.decisions, s: r.credited }, { arm: 'personalized', n: treated.decisions, s: treated.credited })) : [];
    }
  }
  const exploration = slots.map((slot) => {
    const x = hb.exploration[slot] ?? { decisions: 0, explored: 0 };
    const cfg = learn.slots?.[slot]?.exploration ?? null;
    return { slot, decisions: x.decisions, explored: x.explored, realized: x.decisions ? r3(x.explored / x.decisions) : 0, configured: cfg && cfg.mode !== 'off' ? cfg.share : null, mode: cfg?.mode ?? null };
  });
  const last = sorted[sorted.length - 1];
  return {
    tenant: ids.tenant, brand: ids.brand, date: ids.date, builtAt: now,
    counts: { decisions: hb.decisions, outcomes: hb.outcomes, visitors: hb.visitorsDay, truncated: false },
    policies, grids, exploration, holdout, holdoutComparison,
    erasures: { pending: opts.pending, rows_hidden: hb.rows_hidden },
    hours: { source: 'aggregates', built: sorted.map((a) => a.hour), missing: [...opts.missing], ...(last ? { horizonMs: last.horizonMs } : {}) },
  };
}

// ── against R2 ────────────────────────────────────────────────────────────────

export interface R2Agg extends R2Like { put(key: string, body: string, opts?: unknown): Promise<unknown> }

async function listKeys(r2: R2Like, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) keys.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

/** The hour's ledger objects, one at a time, each decision reduced to what the fold keeps before the next object is opened. */
export async function loadHourRecords(r2: R2Like, tenant: string, date: string, hour: number): Promise<{ decisions: CompactDecision[]; outcomes: OutcomeRecord[]; objects: number }> {
  const keys = (await listKeys(r2, `${tenant}/${date}/${pad2(hour)}/`)).sort();
  const decisions: CompactDecision[] = [], outcomes: OutcomeRecord[] = [];
  for (const key of keys) {
    const stream = key.includes('/decision/') ? 'decision' : key.includes('/outcome/') ? 'outcome' : null;
    if (!stream) continue;
    const obj = await r2.get(key);
    if (!obj) continue;
    for (const line of (await obj.text()).split('\n')) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line) as DecisionRecord | OutcomeRecord;
        if (stream === 'decision') decisions.push(compactOf(rec as DecisionRecord)); else outcomes.push(rec as OutcomeRecord);
      } catch { /* a bad line never hides the good ones */ }
    }
  }
  return { decisions, outcomes, objects: keys.length };
}

export interface BuildOptions { horizonMs?: number; ringCap?: number; shards?: number }

/** One hour, folded: its ledger objects read once, every shard visited, the aggregate written. Re-running an hour never doubles it. */
export async function buildHour(r2: R2Agg, tenant: string, at: { date: string; hour: number }, learn: LearnConfig, now = Date.now(), opts: BuildOptions = {}): Promise<HourAggregate> {
  const from = hourStart(at.date, at.hour), to = from + HOUR_MS;
  const shards = opts.shards ?? SHARDS, horizonMs = opts.horizonMs ?? DEFAULT_HORIZON_MS, ringCap = opts.ringCap ?? RING_CAP;
  const statsCfg: StatsConfig = learn.stats ?? DEFAULT_STATS, slotCfg = slotConfigsOf(learn), policies = policiesOf(learn);
  const [loaded, tombs] = await Promise.all([loadHourRecords(r2, tenant, at.date, at.hour), loadTombstones(r2, tenant)]);
  const decisions = withoutErased(loaded.decisions, tombs), outcomes = withoutErased(loaded.outcomes, tombs);
  const brands = foldDecisions(decisions, policies, statsCfg);
  for (const o of outcomes) (brands[o.brand] ??= emptyBrand()).outcomes += 1;
  if (tombs.size) {
    for (const d of loaded.decisions) if (hidden(tombs, d)) (brands[d.entry.brand] ??= emptyBrand()).rows_hidden += 1;
    for (const o of loaded.outcomes) if (hidden(tombs, o)) (brands[o.brand] ??= emptyBrand()).rows_hidden += 1;
  }
  for (const hb of Object.values(brands)) for (const p of policies) policyHour(hb, p);
  const byShardD = new Map<number, CompactDecision[]>(), byShardO = new Map<number, OutcomeRecord[]>();
  for (const d of decisions) { const s = shardOf(d.visitor_id, shards); const list = byShardD.get(s) ?? []; list.push(d); byShardD.set(s, list); }
  for (const o of outcomes) { const s = shardOf(o.visitor_id, shards); const list = byShardO.get(s) ?? []; list.push(o); byShardO.set(s, list); }
  const ctx: FoldContext = { date: at.date, from, to, policies, slotCfg, statsCfg, horizonMs, ringCap, tombs, brands };
  let ringsFolded = true;
  for (let s = 0; s < shards; s++) {
    const raw = await r2.get(shardKey(tenant, s));
    let state = emptyShard(s);
    if (raw) { try { state = JSON.parse(await raw.text()) as ShardState; } catch { state = emptyShard(s); } }
    const r = foldShard(state, byShardD.get(s) ?? [], byShardO.get(s) ?? [], ctx);
    if (!r.folded) ringsFolded = false;
    for (const [brand, ids] of Object.entries(r.state.seen)) (brands[brand] ??= emptyBrand()).visitorsDay += ids.length;
    if (r.changed) await r2.put(shardKey(tenant, s), JSON.stringify(r.state), { httpMetadata: { contentType: 'application/json' } });
  }
  const agg: HourAggregate = { version: 1, tenant, date: at.date, hour: at.hour, from, to, builtAt: now, objects: loaded.objects, horizonMs, shards, ringsFolded, brands };
  await r2.put(hourKey(tenant, at.date, at.hour), JSON.stringify(agg), { httpMetadata: { contentType: 'application/json' } });
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

export interface CatchUpResult { built: Array<{ date: string; hour: number; decisions: number; outcomes: number; objects: number }>; pending: number }

/**
 * What the five-minute job calls: fold the closed hours that have no aggregate yet, oldest first, a
 * few per run so one run stays inside a Worker's budget, then refresh the day report of each date
 * touched so `GET learn/report` answers for today through the last closed hour.
 */
export async function catchUp(r2: R2Agg, tenant: string, learn: LearnConfig, now = Date.now(), opts: BuildOptions & { maxHours?: number; lookbackHours?: number } = {}): Promise<CatchUpResult> {
  const candidates = closedHours(now, opts.lookbackHours ?? 26);
  const existing = new Set<string>();
  for (const date of new Set(candidates.map((c) => c.date))) for (const k of await listKeys(r2, `aggregates/${tenant}/${date}/`)) existing.add(k);
  const missing = candidates.filter((c) => !existing.has(hourKey(tenant, c.date, c.hour)));
  const built: CatchUpResult['built'] = [];
  for (const c of missing.slice(0, opts.maxHours ?? 2)) {
    const agg = await buildHour(r2, tenant, c, learn, now, opts);
    const sum = (k: 'decisions' | 'outcomes') => Object.values(agg.brands).reduce((n, b) => n + b[k], 0);
    built.push({ date: c.date, hour: c.hour, decisions: sum('decisions'), outcomes: sum('outcomes'), objects: agg.objects });
  }
  for (const date of new Set(built.map((b) => b.date))) {
    try { await runDayReport(r2, { tenant, brand: tenant, date }, learn, null, now); } catch { /* the hours are built; the report is retried at the next fold */ }
  }
  return { built, pending: missing.length - built.length };
}

/** The aggregates a date has, and the closed hours it lacks. */
export async function loadHours(r2: R2Like, tenant: string, date: string, now: number): Promise<{ aggs: HourAggregate[]; missing: number[] }> {
  const aggs: HourAggregate[] = [];
  for (const k of (await listKeys(r2, `aggregates/${tenant}/${date}/`)).sort()) {
    const obj = await r2.get(k);
    if (!obj) continue;
    try { aggs.push(JSON.parse(await obj.text()) as HourAggregate); } catch { /* an unreadable hour is a missing one */ }
  }
  const have = new Set(aggs.map((a) => a.hour));
  const missing: number[] = [];
  for (let h = 0; h < 24; h++) if (hourStart(date, h) + HOUR_MS + CLOSE_GRACE_MS <= now && !have.has(h)) missing.push(h);
  return { aggs, missing };
}

export class ReportTooLarge extends Error {
  constructor(public objects: number, public max: number) {
    super(`that day holds ${objects} ledger objects, more than one request may read; the platform folds each hour into an aggregate five minutes after it closes and the day is read from those, so ask again without custom policies, or read the built report with GET`);
  }
}

/**
 * The day report: from the hour aggregates when the day has any and the built-in overlays will do;
 * from the ledger itself otherwise (a day from before the fold existed, or custom reporting policies,
 * which are computed over the records and so need a day one request can read).
 */
export async function runDayReport(r2: R2Agg, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, reporting: ReportPolicy[] | null, now = Date.now(), opts: { maxObjects?: number } = {}): Promise<DayReport> {
  if (reporting === null) {
    const { aggs, missing } = await loadHours(r2, ids.tenant, ids.date, now);
    if (aggs.length) {
      const tombs = await loadTombstones(r2, ids.tenant);
      const report = reportFromHours(aggs, ids, learn, now, { pending: tombs.size, missing });
      try { await r2.put(reportKey(ids.tenant, ids.brand, ids.date), JSON.stringify(report), { httpMetadata: { contentType: 'application/json' } }); } catch { /* the response still carries it */ }
      return report;
    }
  }
  if (opts.maxObjects !== undefined) {
    const n = await countDayObjects(r2, ids.tenant, ids.date);
    if (n > opts.maxObjects) throw new ReportTooLarge(n, opts.maxObjects);
  }
  return runReport(r2, ids, learn, reporting, now);
}
