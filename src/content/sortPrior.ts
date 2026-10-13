// src/content/sortPrior.ts
// ---------------------------------------------------------------------------
// The regional prior on POST /sort, applied the way the homepage slots apply
// it (src/content/service.ts): the tenant's published `learn.regional` block,
// the same trend ladder, the same λ, the same blend, the same demo-profile
// asserted region, and the same label on the answer. A product grid then leans
// with the request's region exactly as the deals module does.
//
// Narrower than the slots in ONE deliberate way: the grid takes the prior only
// where the tenant has PUBLISHED the allowlist (`learn.regional.dimensions`).
// The slots read an absent list as "every dimension the region carries", the
// shipped behaviour; a grid that suddenly leaned on every dimension for every
// tenant that never asked would be a change nobody authored. So a tenant
// without the list sorts exactly as before, and a tenant with it has said
// which dimensions a population may move.
//
// Like the slots, it is personalization: only a shopper who consented to both
// tracking and personalization is ranked on it, and her own vector is never
// written. The answer says which region, at which level, with what weight.
// ---------------------------------------------------------------------------

import type { Env } from '@/types/env';
import { PublicationError, readPublication } from '@/config/publication';
import { blendAffinity, lambdaFor, readTrend, regionKeyOf, sharesWithin, type GeoLike, type TrendSnapshot } from '@/reflex/regionTrend';
import { LEARN_KIND } from './kinds';
import { personalizes, type Consent } from './consent';
import { demoAssertedRegion } from './service';
import type { RegionalBlend } from './types';

/** What the answer says about the prior: the same block a decision set carries, with the dimensions it blended. */
export interface SortRegionalLabel extends RegionalBlend {
  /** The tenant's published allowlist, the only dimensions the region could move. */
  dimensions: string[];
  /** Present when the region was asserted by the caller on the demo profile rather than read from the request. */
  asserted?: true;
}

export interface SortPrior {
  /** The shopper's vector with the region's shares blended in: what the grid is ranked on. */
  dims: Record<string, Record<string, number>>;
  /** The shares the blend used, for the per-item itemisation of what the region contributed. */
  share: TrendSnapshot['share'];
  label: SortRegionalLabel;
}

export interface SortPriorInput {
  /** Her own vector, as the profile read returned it; never modified. */
  personal: Record<string, Record<string, number>>;
  consent: Consent;
  /** The request's edge location. */
  cf?: GeoLike | null;
  /** A region the caller asserts; it selects the prior on the demo profile only. */
  asserted?: string;
  now?: number;
}

/**
 * The prior for one sort, or null when none applies: no consent to
 * personalization, no published allowlist, the prior switched off, nothing
 * published for the tenant's regions, or the learn document unreadable. Null is
 * the sort exactly as it was before this existed.
 */
export async function regionalPriorForSort(env: Env, tenant: string, input: SortPriorInput): Promise<SortPrior | null> {
  if (!personalizes(input.consent)) return null;
  let regional;
  try { regional = (await readPublication(env, LEARN_KIND, tenant, true))?.value?.regional; }
  catch (error) {
    // The publication authority's own typed failure is the shipped sort, not a
    // refused one: the prior is an addition, and its absence must not cost the
    // shopper her grid. Anything else is that request's own answer.
    if (error instanceof PublicationError) return null;
    throw error;
  }
  const dimensions = regional?.enabled && Array.isArray(regional.dimensions) && regional.dimensions.length ? regional.dimensions : null;
  if (!regional || !dimensions) return null;
  const now = input.now ?? Date.now();
  // DEMO PROFILE ONLY, as on the homepage: an asserted region selects the
  // prior so one laptop can rehearse two regions, and the label says asserted.
  const asserted = demoAssertedRegion(env, input.asserted);
  const trend = await readTrend(env, tenant, asserted ?? regionKeyOf(input.cf), regional.minEvents, now);
  if (!trend) return null;
  const lambda = lambdaFor(input.personal, regional.kBlend);
  const share = sharesWithin(trend.snapshot.share, dimensions);
  return {
    dims: blendAffinity(input.personal, share, lambda).dims,
    share,
    label: { region: trend.region, level: trend.level, lambda, version: trend.snapshot.version, events: trend.snapshot.events,
      dimensions: [...dimensions], ...(asserted ? { asserted: true as const } : {}) },
  };
}
