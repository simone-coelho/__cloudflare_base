// src/content/cell.ts
// Doc 22 §5.4: the context a decision was made in. Built only from what is
// actually known. Unknown visit/channel evidence stays unknown; a guessed cell
// would poison the statistics it feeds.

import type { AffinitySnapshot, ReflexConfig } from '@/reflex/core';
import { asStage } from '@/services/JourneyStage';
import { channelIn, ENTRY_CHANNELS, type ContextVocabulary } from '@/services/visit';
import type { Cell } from './types';

/** The subset of request.cf this module reads. */
export interface CfLike { country?: string | null; regionCode?: string | null }

/** `US-NY` when both are known, `US` when only the country is, else null. */
export function regionOf(cf: CfLike | null | undefined): string | null {
  const country = (cf?.country ?? '').trim();
  if (!country) return null;
  const region = (cf?.regionCode ?? '').trim();
  return region ? `${country}-${region}` : country;
}

/**
 * The leading interest: the dimension value with the highest affinity among
 * those above their dimension's entry threshold (per-dimension θ_in wins over
 * the global). Ties resolve in registry order, so it is deterministic.
 */
export function affinityCellOf(
  snap: Pick<AffinitySnapshot, 'dims'> | null | undefined,
  cfg: ReflexConfig,
): string | null {
  if (!snap) return null;
  let best: { key: string; a: number } | null = null;
  for (const d of cfg.dimensions) {
    const theta = d.thetaIn ?? cfg.thetaIn;
    const values = snap.dims[d.key];
    if (!values) continue;
    for (const [value, a] of Object.entries(values)) {
      if (a >= theta && (best === null || a > best.a)) best = { key: `${d.key}:${value}`, a };
    }
  }
  return best?.key ?? null;
}

/** Today's visit-bucket cut: lower bounds 1, 2 and 4, so the buckets 1, 2-3 and 4+ (doc 22 §5.4). */
export const TODAY_CUT: readonly number[] = Object.freeze([1, 2, 4]);
/** Today's ladder depth: every level below everyone (channel, visit bucket, stage, region, affinity). */
export const FULL_DEPTH = 5;

/**
 * P36: a bucket's name under a cut — its single number (`1`) or its range
 * (`2-3`), the last one open (`4+`). Today's cut names today's buckets.
 */
export function bucketNamesOf(cut: readonly number[]): string[] {
  return cut.map((bound, i) => {
    const next = cut[i + 1];
    if (next === undefined) return `${bound}+`;
    return next - 1 === bound ? String(bound) : `${bound}-${next - 1}`;
  });
}

/**
 * P36: the context terms a tenant's decisions, learning and authoring read:
 * the channel values a cell may carry, the visit-bucket cut and its names, the
 * ladder depth consulted, and the source platforms and landing-page types a
 * seed rule may name. A tenant without the settings reads today's terms: the
 * six words, the cut [1, 2, 4] and the full ladder, and no platform or type.
 */
export interface ContextTerms {
  /** True when these are a tenant's published settings. */
  published: boolean;
  channels: ReadonlySet<string>;
  cut: readonly number[];
  buckets: readonly string[];
  depth: number;
  sourcePlatforms: ReadonlySet<string>;
  landingPageTypes: ReadonlySet<string>;
}
export const TODAY_TERMS: ContextTerms = Object.freeze({
  published: false, channels: new Set<string>(ENTRY_CHANNELS), cut: TODAY_CUT, buckets: bucketNamesOf(TODAY_CUT), depth: FULL_DEPTH,
  sourcePlatforms: new Set<string>(), landingPageTypes: new Set<string>(),
});
const termsCache = new WeakMap<object, ContextTerms>();
/** The terms a published vocabulary gives (cached per document object); absent: today's terms. */
export function contextTermsOf(vocabulary: ContextVocabulary | null | undefined): ContextTerms {
  if (!vocabulary) return TODAY_TERMS;
  const held = termsCache.get(vocabulary);
  if (held) return held;
  const cut = Array.isArray(vocabulary.visitBuckets) && vocabulary.visitBuckets.length ? [...vocabulary.visitBuckets] : [...TODAY_CUT];
  const terms: ContextTerms = Object.freeze({ published: true, channels: new Set(vocabulary.channels.map(c => c.id)), cut, buckets: bucketNamesOf(cut),
    depth: vocabulary.ladder?.depth ?? FULL_DEPTH,
    sourcePlatforms: new Set(vocabulary.sourcePlatforms.map(p => p.id)), landingPageTypes: new Set(vocabulary.landingPageTypes.map(t => t.id)) });
  termsCache.set(vocabulary, terms);
  return terms;
}

/**
 * The visit bucket of a visit number. One argument: today's cut (1, 2-3, 4+).
 * P36: a tenant's published cut names its own buckets (R-P46).
 */
export function visitBucketOf(n: number | null | undefined, cut: readonly number[] = TODAY_CUT): Cell['visit_bucket'] {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 1) return 'unknown';
  const names = cut === TODAY_CUT ? TODAY_TERMS.buckets : bucketNamesOf(cut);
  let at = 0;
  for (let i = 0; i < cut.length; i++) if (n >= cut[i]!) at = i;
  return names[at] ?? 'unknown';
}

export function cellFor(input: {
  cf?: CfLike | null;
  snap?: Pick<AffinitySnapshot, 'dims'> | null;
  cfg: ReflexConfig;
  channel?: string | null;
  visitNumber?: number | null;
  /**
   * CW29: the shopper's journey stage as the engine already derives it
   * (early / mid / late; BTIE's exploring / considering / deciding). Anything
   * else records as `unknown`, never a guess.
   */
  stage?: string | null;
  /**
   * P36: the tenant's context terms. Absent: today's six words and today's cut.
   * A channel outside the terms records as `unknown`, never a guess.
   */
  terms?: ContextTerms;
}): Cell {
  const terms = input.terms ?? TODAY_TERMS;
  const channel = channelIn(input.channel, terms.published ? terms.channels : null) ?? 'unknown';
  return {
    channel,
    visit_bucket: visitBucketOf(input.visitNumber, terms.cut),
    region: regionOf(input.cf),
    affinity: affinityCellOf(input.snap, input.cfg),
    stage: asStage(input.stage) ?? 'unknown',
  };
}
