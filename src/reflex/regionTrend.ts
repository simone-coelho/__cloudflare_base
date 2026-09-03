// src/reflex/regionTrend.ts
// ─────────────────────────────────────────────────────────────────────────────
// REGIONAL TRENDING — dimension 1 of the registry, the one Mandeep named as
// non-negotiable: "content and products trending or liked in that region",
// affinity-driven, not if-then-else. Ledger 19's committed design, executable.
//
// Population aggregates only. Every scored event fans a `{dim, value}` touch
// into the shopper's REGION object, which keeps (R, t) per value on the same
// lazy-decay invariant the personal vector uses, with a longer horizon. The
// object publishes a normalized snapshot to KV; the decision path reads that
// snapshot through a per-isolate cache and blends it as a PRIOR:
//
//     λ = K_blend / (K_blend + Σ a_personal)       new shopper λ≈1, engaged λ→0
//     ã[d][v] = (1 − λ)·a_personal[d][v] + λ·share_region[d][v]
//
// The personal vector is never written to. Sparse regions roll up: region →
// country → everyone, gated on a minimum event count, so a first paint in a
// region we have barely seen still opens with a real prior rather than a blank.
// ─────────────────────────────────────────────────────────────────────────────

import type { Env } from '@/types/env';
import { effectiveScore, type ReflexEntry, type Touch } from './core';

export const REGION_TAU_MS = 24 * 60 * 60 * 1000;
export const REGION_MAX_VALUES_PER_DIM = 32;
export const REGION_EPSILON = 1e-3;
export const TREND_CACHE_TTL_MS = 60_000;
export const GLOBAL_REGION = '*';

export interface GeoLike { country?: string | null; regionCode?: string | null }

/** `US-NY`, `US`, or null. The country alone is a valid, coarser region. */
export function regionKeyOf(geo: GeoLike | null | undefined): string | null {
  const c = (geo?.country ?? '').trim().toUpperCase();
  if (!c) return null;
  const r = (geo?.regionCode ?? '').trim().toUpperCase();
  return r ? `${c}-${r}` : c;
}
export const countryOf = (region: string): string => region.split('-')[0] ?? region;
export const trendKey = (tenant: string, region: string) => `trend:${tenant}:${region}`;
export const objectName = (tenant: string, region: string) => `${tenant}:${region}`;

/** What the object stores: raw accumulators per dimension value. */
export interface RegionState {
  tenant: string;
  region: string;
  dims: Record<string, Record<string, ReflexEntry>>;
  events: number;
  updatedAt: number;
}

/** What is published: raw decayed R (for rollups) and within-dimension shares (for blending). */
export interface TrendSnapshot {
  tenant: string;
  region: string;
  level: 'region' | 'country' | 'global';
  events: number;
  updatedAt: number;
  version: number;
  r: Record<string, Record<string, number>>;
  share: Record<string, Record<string, number>>;
}

export interface TrendFrame { touches: Touch[]; w: number; ts: number }
/** What the hosts send: the frame plus the object's own name, which it learns from the first one. */
export interface IngestFrame extends TrendFrame { tenant: string; region: string }

/** Decay-then-accumulate, the personal vector's invariant, on the population. */
export function applyTrend(state: RegionState, frame: TrendFrame, tauMs = REGION_TAU_MS): RegionState {
  const w = Number.isFinite(frame.w) ? frame.w : 0;
  if (w <= 0 || !frame.touches.length) return state;
  const dims = state.dims;
  for (const t of frame.touches) {
    if (!t.dim || !t.value) continue;
    const bucket = (dims[t.dim] ??= {});
    const prev = bucket[t.value];
    const s = (prev ? effectiveScore(prev, frame.ts, tauMs) : 0) + w;
    bucket[t.value] = { s, t: frame.ts };
    // Cap distinct values per dimension: evict the weakest, decayed to now.
    const keys = Object.keys(bucket);
    if (keys.length > REGION_MAX_VALUES_PER_DIM) {
      let weakest = keys[0]!, low = Infinity;
      for (const k of keys) { const e = effectiveScore(bucket[k]!, frame.ts, tauMs); if (e < low) { low = e; weakest = k; } }
      delete bucket[weakest];
    }
  }
  return { ...state, dims, events: state.events + 1, updatedAt: Math.max(state.updatedAt, frame.ts) };
}

/** Decayed R per value, pruned at ε, and the within-dimension share (leader = 1). */
export function snapshotOf(state: RegionState, now: number, version: number, tauMs = REGION_TAU_MS, level: TrendSnapshot['level'] = 'region'): TrendSnapshot {
  const r: TrendSnapshot['r'] = {};
  for (const [dim, bucket] of Object.entries(state.dims)) {
    const out: Record<string, number> = {};
    for (const [value, entry] of Object.entries(bucket)) {
      const e = effectiveScore(entry, now, tauMs);
      if (e >= REGION_EPSILON) out[value] = Math.round(e * 1000) / 1000;
    }
    if (Object.keys(out).length) r[dim] = out;
  }
  return { tenant: state.tenant, region: state.region, level, events: state.events, updatedAt: state.updatedAt, version, r, share: sharesOf(r) };
}

export function sharesOf(r: TrendSnapshot['r']): TrendSnapshot['share'] {
  const share: TrendSnapshot['share'] = {};
  for (const [dim, values] of Object.entries(r)) {
    const max = Math.max(0, ...Object.values(values));
    if (max <= 0) continue;
    share[dim] = Object.fromEntries(Object.entries(values).map(([v, x]) => [v, Math.round((x / max) * 1000) / 1000]));
  }
  return share;
}

/** Sum raw R across snapshots, then re-normalize: a country from its regions, everyone from all. */
export function rollupSnapshots(parts: TrendSnapshot[], tenant: string, region: string, level: TrendSnapshot['level'], now: number): TrendSnapshot {
  const r: TrendSnapshot['r'] = {};
  let events = 0, updatedAt = 0;
  for (const p of parts) {
    events += p.events; updatedAt = Math.max(updatedAt, p.updatedAt);
    for (const [dim, values] of Object.entries(p.r)) {
      const out = (r[dim] ??= {});
      for (const [v, x] of Object.entries(values)) out[v] = Math.round(((out[v] ?? 0) + x) * 1000) / 1000;
    }
  }
  return { tenant, region, level, events, updatedAt, version: now, r, share: sharesOf(r) };
}

// ── Fan-in (the hosts call this; it never throws and never waits) ───────────

export interface FanInInput { tenant: string; geo: GeoLike | null | undefined; touches: Touch[]; w: number; now: number }

/** Fire a scored event's touches at the region object. A missing binding, region or weight is a no-op. */
export function fanInRegionTrend(env: Pick<Env, 'REGION_TREND'>, input: FanInInput): Promise<void> {
  const region = regionKeyOf(input.geo);
  if (!env.REGION_TREND || !region || input.w <= 0 || input.touches.length === 0) return Promise.resolve();
  const frame: IngestFrame = { tenant: input.tenant, region, touches: input.touches, w: input.w, ts: input.now };
  try {
    const stub = env.REGION_TREND.get(env.REGION_TREND.idFromName(objectName(input.tenant, region)));
    return stub.fetch('https://region-trend/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(frame),
    }).then(() => undefined, () => undefined);
  } catch {
    return Promise.resolve();
  }
}

// ── Read side (the decision path) ───────────────────────────────────────────

export interface TrendRead { snapshot: TrendSnapshot; level: TrendSnapshot['level']; region: string }

interface CacheEntry { at: number; value: TrendSnapshot | null }
const cache = new Map<string, CacheEntry>();
export function invalidateTrendCache(): void { cache.clear(); }

async function readSnapshot(env: Pick<Env, 'CACHE'>, tenant: string, region: string, now: number): Promise<TrendSnapshot | null> {
  const key = trendKey(tenant, region);
  const hit = cache.get(key);
  if (hit && now - hit.at < TREND_CACHE_TTL_MS) return hit.value;
  let value: TrendSnapshot | null = null;
  try { value = (await env.CACHE.get(key, 'json')) as TrendSnapshot | null; } catch { value = null; }
  cache.set(key, { at: now, value });
  return value;
}

/**
 * The finest level with enough evidence: the region, else its country, else
 * everyone. `minEvents` is the same gate the geo cold start uses. Null when
 * nothing has been published for the tenant at all.
 */
export async function readTrend(env: Pick<Env, 'CACHE'>, tenant: string, region: string | null, minEvents: number, now = Date.now()): Promise<TrendRead | null> {
  const ladder: Array<{ region: string; level: TrendSnapshot['level'] }> = [];
  if (region) {
    ladder.push({ region, level: 'region' });
    const country = countryOf(region);
    if (country !== region) ladder.push({ region: country, level: 'country' });
  }
  ladder.push({ region: GLOBAL_REGION, level: 'global' });
  let last: TrendRead | null = null;
  for (const step of ladder) {
    const snap = await readSnapshot(env, tenant, step.region, now);
    if (!snap) continue;
    last = { snapshot: snap, level: step.level, region: step.region };
    if (snap.events >= minEvents) return last;
  }
  return last;
}

// ── The blend ───────────────────────────────────────────────────────────────

export type Dims = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** How much the population should speak: 1 for a stranger, toward 0 as personal evidence accumulates. */
export function lambdaFor(personal: Dims | null | undefined, kBlend: number): number {
  let evidence = 0;
  for (const values of Object.values(personal ?? {})) for (const a of Object.values(values)) evidence += a;
  const k = kBlend > 0 ? kBlend : 1;
  return Math.round((k / (k + evidence)) * 1000) / 1000;
}

export interface Blended { dims: Record<string, Record<string, number>>; lambda: number }

/** ã = (1 − λ)·a_personal + λ·share_region, per dimension value. The personal input is not modified. */
export function blendAffinity(personal: Dims | null | undefined, regional: TrendSnapshot['share'] | null | undefined, lambda: number): Blended {
  const dims: Blended['dims'] = {};
  const keys = new Set<string>([...Object.keys(personal ?? {}), ...Object.keys(regional ?? {})]);
  for (const dim of keys) {
    const p = personal?.[dim] ?? {}, r = regional?.[dim] ?? {};
    const out: Record<string, number> = {};
    for (const v of new Set([...Object.keys(p), ...Object.keys(r)])) {
      const a = (1 - lambda) * (p[v] ?? 0) + lambda * (r[v] ?? 0);
      if (a > 0) out[v] = Math.round(a * 1000) / 1000;
    }
    if (Object.keys(out).length) dims[dim] = out;
  }
  return { dims, lambda };
}

// ── Rollups (cron and the operator route) ───────────────────────────────────

export interface KvLister { list(opts: { prefix: string; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }> }

/** Sum every published region of a tenant into its countries and into everyone, and publish those. */
export async function rollupTenant(env: Pick<Env, 'CACHE'>, tenant: string, now = Date.now()): Promise<{ countries: string[]; regions: number }> {
  const prefix = `trend:${tenant}:`;
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await (env.CACHE as unknown as KvLister).list({ prefix, cursor });
    for (const k of page.keys) names.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const regions: TrendSnapshot[] = [];
  for (const name of names) {
    const region = name.slice(prefix.length);
    if (region === GLOBAL_REGION || !region.includes('-')) continue;   // only leaf regions feed a rollup
    const snap = (await env.CACHE.get(name, 'json')) as TrendSnapshot | null;
    if (snap) regions.push(snap);
  }
  const byCountry = new Map<string, TrendSnapshot[]>();
  for (const s of regions) { const c = countryOf(s.region); byCountry.set(c, [...(byCountry.get(c) ?? []), s]); }
  for (const [country, parts] of byCountry) {
    await env.CACHE.put(trendKey(tenant, country), JSON.stringify(rollupSnapshots(parts, tenant, country, 'country', now)));
  }
  await env.CACHE.put(trendKey(tenant, GLOBAL_REGION), JSON.stringify(rollupSnapshots(regions, tenant, GLOBAL_REGION, 'global', now)));
  invalidateTrendCache();
  return { countries: [...byCountry.keys()], regions: regions.length };
}
