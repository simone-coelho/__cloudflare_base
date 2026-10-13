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
//
// P07: the same aggregate keyed by the arrival's context instead of the place —
// per tenant, entry channel and visit bucket — through the same namespace and
// the same objects' code (`contextScope`). It rolls up from the channel and
// visit bucket to the channel alone, never to everyone, so the regional prior's
// population is not counted twice. Its own K weighs it beside the region's.
// ─────────────────────────────────────────────────────────────────────────────

import type { Env } from '@/types/env';
import { ownerBindingIdentity } from '@/identity/sessionAuthority';
import { isEventTimestamp } from '@/events/actionTypes';
import { entryChannelOf } from '@/services/visit';
import { isValidTenantId } from '@/tenancy/tenant';
import { effectiveScore, type ReflexEntry, type Touch } from './core';
import { mergeEntries } from './identityMerge';

export const REGION_TAU_MS = 24 * 60 * 60 * 1000;
export const REGION_MAX_VALUES_PER_DIM = 32;
export const REGION_EPSILON = 1e-3;
export const TREND_CACHE_TTL_MS = 60_000;
export const GLOBAL_REGION = '*';
// Historical populations mixed tenant and demo scope. They remain untouched;
// only new, tenant-bound frames populate this generation.
export const REGION_GENERATION = 2;
export const REGION_STATE_KEY = 'trend:v2';

export interface GeoLike { country?: string | null; regionCode?: string | null }

/** `US-NY`, `US`, or null. The country alone is a valid, coarser region. */
export function regionKeyOf(geo: GeoLike | null | undefined): string | null {
  const c = (geo?.country ?? '').trim().toUpperCase();
  if (!c) return null;
  const r = (geo?.regionCode ?? '').trim().toUpperCase();
  return r ? `${c}-${r}` : c;
}
export const countryOf = (region: string): string => region.split('-')[0] ?? region;
export const trendKey = (tenant: string, region: string) => `trend:v2:${tenant}:${region}`;
export const objectName = (tenant: string, region: string) => `trend:v2:${tenant}:${region}`;

// ── The context scopes (P07) ────────────────────────────────────────────────
//
// A context population is one more scope of the same objects and the same
// published keys: `ctx:<channel>:<visit bucket>` for a pair, `ctx:<channel>`
// for the channel alone (`trend:v2:<tenant>:ctx:paid_social:1` is both the
// object's name and its published key). The prefix is lower case with a colon,
// so it can never be a region key, which `regionKeyOf` writes in upper case.
// Only the six entry channels and the three known visit buckets make a scope:
// an unknown channel or bucket has none, and nothing is counted for it.

export const CONTEXT_SCOPE_PREFIX = 'ctx:';
export const CONTEXT_VISIT_BUCKETS: readonly string[] = ['1', '2-3', '4+'];
export type ContextLevel = 'channel_visit' | 'channel';

/** The scope of an entry channel alone; null for anything but one of the six channels. */
export function channelScope(channel: unknown): string | null {
  const known = entryChannelOf(channel);
  return known !== null && known === channel ? `${CONTEXT_SCOPE_PREFIX}${known}` : null;
}
/** The scope of an entry channel and a visit bucket; null when either is unknown. */
export function contextScope(channel: unknown, visitBucket: unknown): string | null {
  const alone = channelScope(channel);
  return alone !== null && typeof visitBucket === 'string' && CONTEXT_VISIT_BUCKETS.includes(visitBucket) ? `${alone}:${visitBucket}` : null;
}
export const isContextScope = (scope: unknown): boolean => typeof scope === 'string' && scope.startsWith(CONTEXT_SCOPE_PREFIX);
/** The channel and visit bucket of a pair scope; null for a channel scope or anything else. */
export function contextPairOf(scope: unknown): { channel: string; visitBucket: string } | null {
  if (typeof scope !== 'string' || !isContextScope(scope)) return null;
  const [channel, visitBucket, ...rest] = scope.slice(CONTEXT_SCOPE_PREFIX.length).split(':');
  return rest.length === 0 && channel !== undefined && visitBucket !== undefined && contextScope(channel, visitBucket) === scope ? { channel, visitBucket } : null;
}
/** The level a scope's published snapshot names: a context pair or channel, else a region. */
export function scopeLevel(scope: unknown): TrendSnapshot['level'] {
  if (!isContextScope(scope)) return 'region';
  return contextPairOf(scope) ? 'channel_visit' : 'channel';
}

export function matchesTrendScope(value: unknown, tenant: string, region: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const scope = value as { generation?: unknown; tenant?: unknown; region?: unknown };
  return scope.generation === REGION_GENERATION && isValidTenantId(tenant)
    && !!region && scope.tenant === tenant && scope.region === region;
}

/** What the object stores: raw accumulators per dimension value. */
export interface RegionState {
  generation: typeof REGION_GENERATION;
  tenant: string;
  region: string;
  dims: Record<string, Record<string, ReflexEntry>>;
  events: number;
  updatedAt: number;
}

/** The regional ladder's levels. */
export type RegionLevel = 'region' | 'country' | 'global';

/** What is published: raw decayed R (for rollups) and within-dimension shares (for blending). */
export interface TrendSnapshot {
  generation: typeof REGION_GENERATION;
  tenant: string;
  /** The scope: a region key, or a context scope (P07). */
  region: string;
  level: RegionLevel | ContextLevel;
  events: number;
  updatedAt: number;
  version: number;
  r: Record<string, Record<string, number>>;
  share: Record<string, Record<string, number>>;
}

export interface TrendFrame { touches: Touch[]; w: number; ts: number }
/** The hosts carry a scope which must match the actual current-generation object. */
export interface IngestFrame extends TrendFrame { generation: typeof REGION_GENERATION; tenant: string; region: string }

/** Accumulate at each value's latest touch; late frames age only their own mass. */
export function applyTrend(state: RegionState, frame: TrendFrame, tauMs = REGION_TAU_MS): RegionState {
  if (!isEventTimestamp(frame.ts)) return state;
  const w = Number.isFinite(frame.w) ? frame.w : 0;
  if (w <= 0 || !frame.touches.length) return state;
  const dims = state.dims;
  const updatedAt = Math.max(state.updatedAt, frame.ts);
  for (const t of frame.touches) {
    if (!t.dim || !t.value) continue;
    const bucket = (dims[t.dim] ??= {});
    const prev = bucket[t.value];
    const incoming = { s: w, t: frame.ts };
    bucket[t.value] = prev ? mergeEntries(prev, incoming, tauMs) : incoming;
    // Compare every cap candidate at the latest common frame time.
    const keys = Object.keys(bucket);
    if (keys.length > REGION_MAX_VALUES_PER_DIM) {
      let weakest = keys[0]!, low = Infinity;
      for (const k of keys) { const e = effectiveScore(bucket[k]!, updatedAt, tauMs); if (e < low) { low = e; weakest = k; } }
      delete bucket[weakest];
    }
  }
  return { ...state, dims, events: state.events + 1, updatedAt };
}

/** Decayed R per value, pruned at ε, and the within-dimension share (leader = 1). A context scope publishes its own level (P07). */
export function snapshotOf(state: RegionState, now: number, version: number, tauMs = REGION_TAU_MS, level: TrendSnapshot['level'] = scopeLevel(state.region)): TrendSnapshot {
  const r: TrendSnapshot['r'] = {};
  for (const [dim, bucket] of Object.entries(state.dims)) {
    const out: Record<string, number> = {};
    for (const [value, entry] of Object.entries(bucket)) {
      const e = effectiveScore(entry, now, tauMs);
      if (e >= REGION_EPSILON) out[value] = Math.round(e * 1000) / 1000;
    }
    if (Object.keys(out).length) r[dim] = out;
  }
  return { generation: state.generation, tenant: state.tenant, region: state.region, level, events: state.events, updatedAt: state.updatedAt, version, r, share: sharesOf(r) };
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
    if (!matchesTrendScope(p, tenant, p.region)) continue;
    events += p.events; updatedAt = Math.max(updatedAt, p.updatedAt);
    for (const [dim, values] of Object.entries(p.r)) {
      const out = (r[dim] ??= {});
      for (const [v, x] of Object.entries(values)) out[v] = Math.round(((out[v] ?? 0) + x) * 1000) / 1000;
    }
  }
  return { generation: REGION_GENERATION, tenant, region, level, events, updatedAt, version: now, r, share: sharesOf(r) };
}

// ── Fan-in (the hosts call this; it never throws and never waits) ───────────

export interface FanInInput {
  tenant: string; geo: GeoLike | null | undefined; touches: Touch[]; w: number; now: number;
  /**
   * P07: the arrival context of the visit the event belongs to, as the host
   * derives the visit it stores: the entry channel and the visit bucket. The
   * same touches are then also counted for that channel and visit bucket. An
   * unknown channel or bucket — including an event with no context at all —
   * counts nothing there (R-P9), so such an event fans in exactly as before.
   */
  context?: { channel: string | null | undefined; visitBucket: string | null | undefined } | null;
}

/** One frame to one scope's object; never throws and never waits. */
function sendFrame(env: Pick<Env, 'REGION_TREND'>, input: FanInInput, scope: string): Promise<void> {
  const frame: IngestFrame = { generation: REGION_GENERATION, tenant: input.tenant, region: scope, touches: input.touches, w: input.w, ts: input.now };
  try {
    const stub = env.REGION_TREND!.get(env.REGION_TREND!.idFromName(objectName(input.tenant, scope)));
    return stub.fetch('https://region-trend/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(frame),
    }).then(() => undefined, () => undefined);
  } catch {
    return Promise.resolve();
  }
}

/**
 * Fire a scored event's touches at the region object and, when the event's
 * arrival context is known, at its channel-and-visit-bucket object (P07). A
 * missing binding or weight is a no-op; a missing region skips the region, an
 * unknown context skips the context. Neither frame can fail the other.
 */
export function fanInRegionTrend(env: Pick<Env, 'REGION_TREND'>, input: FanInInput): Promise<void> {
  if (!env.REGION_TREND || !isValidTenantId(input.tenant) || input.w <= 0 || input.touches.length === 0) return Promise.resolve();
  const region = regionKeyOf(input.geo);
  const context = input.context ? contextScope(input.context.channel, input.context.visitBucket) : null;
  const sent: Promise<void>[] = [];
  if (region) sent.push(sendFrame(env, input, region));
  if (context) sent.push(sendFrame(env, input, context));
  return sent.length === 0 ? Promise.resolve() : sent.length === 1 ? sent[0]! : Promise.all(sent).then(() => undefined);
}

// ── Read side (the decision path) ───────────────────────────────────────────

export interface TrendRead { snapshot: TrendSnapshot; level: RegionLevel; region: string }

interface CacheEntry { binding: Env['CACHE']; key: string; at: number; value: TrendSnapshot | null }
const cache = new Set<CacheEntry>();
export function invalidateTrendCache(): void { cache.clear(); }

async function readSnapshot(env: Pick<Env, 'CACHE'>, tenant: string, region: string, now: number): Promise<TrendSnapshot | null> {
  const key = trendKey(tenant, region);
  const binding = ownerBindingIdentity(env.CACHE);
  const hit = [...cache].find(e => e.binding === binding && e.key === key);
  if (hit && now >= hit.at && now - hit.at < TREND_CACHE_TTL_MS) return hit.value;
  let value: TrendSnapshot | null = null;
  try { value = (await env.CACHE.get(key, 'json')) as TrendSnapshot | null; } catch { value = null; }
  if (!matchesTrendScope(value, tenant, region)) value = null;
  if (hit) cache.delete(hit);
  if (cache.size >= 256) cache.delete(cache.values().next().value!);
  cache.add({ binding, key, at: now, value });
  return value;
}

/**
 * The finest level with enough evidence: the region, else its country, else
 * everyone. `minEvents` is the same gate the geo cold start uses. Null when
 * nothing has been published for the tenant at all.
 */
export async function readTrend(env: Pick<Env, 'CACHE'>, tenant: string, region: string | null, minEvents: number, now = Date.now()): Promise<TrendRead | null> {
  const ladder: Array<{ region: string; level: RegionLevel }> = [];
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

export interface ContextRead { snapshot: TrendSnapshot; level: ContextLevel; channel: string }

/**
 * P07 (freeze item 37): the context prior's shares for an entry channel and a
 * visit bucket — the pair's when it has at least `minEvents` events, else the
 * channel's alone over every visit bucket (the hourly rollup's sum), never
 * everyone's: everyone is the regional prior's population, which would then
 * be counted twice. Null for an unknown channel, and when neither the pair
 * nor the channel qualifies; an unknown visit bucket reads the channel alone.
 * Read through the same isolate cache as the regional snapshots; a snapshot
 * that cannot be read is no snapshot.
 */
export async function readContextTrend(env: Pick<Env, 'CACHE'>, tenant: string, channel: string, visitBucket: string, minEvents: number, now = Date.now()): Promise<ContextRead | null> {
  const alone = channelScope(channel);
  if (alone === null) return null;
  const pairScope = contextScope(channel, visitBucket);
  if (pairScope !== null) {
    const pair = await readSnapshot(env, tenant, pairScope, now);
    if (pair && pair.events >= minEvents) return { snapshot: pair, level: 'channel_visit', channel };
  }
  const snapshot = await readSnapshot(env, tenant, alone, now);
  return snapshot ? { snapshot, level: 'channel', channel } : null;
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

/**
 * The shares of only the dimensions the tenant lets its prior blend
 * (`learn.regional.dimensions`). Absent keeps every dimension, the shipped
 * behaviour. A dimension left out takes no share from the region, exactly like
 * a dimension the region has never seen: the blend gives it (1 − λ)·a_personal.
 */
export function sharesWithin(share: TrendSnapshot['share'], dimensions?: readonly string[] | null): TrendSnapshot['share'] {
  if (!dimensions) return share;
  const allowed = new Set(dimensions);
  return Object.fromEntries(Object.entries(share).filter(([dim]) => allowed.has(dim)));
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

export interface PriorTerm { share: TrendSnapshot['share']; lambda: number }

/**
 * P07: several population priors beside each other, each in the regional
 * form. The personal vector keeps the weight every prior leaves it, and each
 * prior adds its own λ·share:
 *
 *     ã[d][v] = Π(1 − λᵢ)·a_personal[d][v] + Σ λᵢ·shareᵢ[d][v]
 *
 * With one prior this is exactly `blendAffinity`. With the regional and the
 * context prior both on, neither erases the other: a stranger (λ 1 for both)
 * is scored on the region's shares plus the context's, and each prior's term
 * on the score is exactly the contribution its own block itemises. The
 * personal input is not modified; values are kept at three decimals above 0.
 */
export function blendPriors(personal: Dims | null | undefined, priors: readonly PriorTerm[]): Record<string, Record<string, number>> {
  let keep = 1;
  for (const prior of priors) keep *= 1 - prior.lambda;
  const dims: Record<string, Record<string, number>> = {};
  const keys = new Set<string>([...Object.keys(personal ?? {}), ...priors.flatMap(prior => Object.keys(prior.share ?? {}))]);
  for (const dim of keys) {
    const p = personal?.[dim] ?? {};
    const values = new Set<string>([...Object.keys(p), ...priors.flatMap(prior => Object.keys(prior.share?.[dim] ?? {}))]);
    const out: Record<string, number> = {};
    for (const v of values) {
      let a = keep * (p[v] ?? 0);
      for (const prior of priors) a += prior.lambda * (prior.share?.[dim]?.[v] ?? 0);
      if (a > 0) out[v] = Math.round(a * 1000) / 1000;
    }
    if (Object.keys(out).length) dims[dim] = out;
  }
  return dims;
}

// ── Rollups (cron and the operator route) ───────────────────────────────────

export interface KvLister { list(opts: { prefix: string; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }> }

/**
 * Sum every published region of a tenant into its countries and into everyone,
 * and publish those. P07: every published channel-and-visit-bucket context is
 * summed into its channel alone, and never into a country or everyone.
 */
export async function rollupTenant(env: Pick<Env, 'CACHE'>, tenant: string, now = Date.now()): Promise<{ countries: string[]; regions: number }> {
  const prefix = trendKey(tenant, '');
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await (env.CACHE as unknown as KvLister).list({ prefix, cursor });
    for (const k of page.keys) names.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const regions: TrendSnapshot[] = [];
  const byChannel = new Map<string, TrendSnapshot[]>();
  for (const name of names) {
    const region = name.slice(prefix.length);
    if (isContextScope(region)) {
      // A context scope is never a region, whatever characters its bucket has.
      // Only a pair feeds its channel; a channel's own rollup feeds nothing.
      const pair = contextPairOf(region);
      if (!pair) continue;
      const snap = (await env.CACHE.get(name, 'json')) as TrendSnapshot | null;
      if (snap && matchesTrendScope(snap, tenant, region)) byChannel.set(pair.channel, [...(byChannel.get(pair.channel) ?? []), snap]);
      continue;
    }
    if (region === GLOBAL_REGION || !region.includes('-')) continue;   // only leaf regions feed a rollup
    const snap = (await env.CACHE.get(name, 'json')) as TrendSnapshot | null;
    if (snap && matchesTrendScope(snap, tenant, region)) regions.push(snap);
  }
  const byCountry = new Map<string, TrendSnapshot[]>();
  for (const s of regions) { const c = countryOf(s.region); byCountry.set(c, [...(byCountry.get(c) ?? []), s]); }
  for (const [country, parts] of byCountry) {
    await env.CACHE.put(trendKey(tenant, country), JSON.stringify(rollupSnapshots(parts, tenant, country, 'country', now)));
  }
  await env.CACHE.put(trendKey(tenant, GLOBAL_REGION), JSON.stringify(rollupSnapshots(regions, tenant, GLOBAL_REGION, 'global', now)));
  for (const [channel, parts] of byChannel) {
    const scope = channelScope(channel)!;
    await env.CACHE.put(trendKey(tenant, scope), JSON.stringify(rollupSnapshots(parts, tenant, scope, 'channel', now)));
  }
  invalidateTrendCache();
  return { countries: [...byCountry.keys()], regions: regions.length };
}
