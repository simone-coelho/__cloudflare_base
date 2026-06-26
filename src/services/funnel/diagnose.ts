/**
 * Revenue Radar — funnel DIAGNOSIS (shared, single source of truth).
 *
 * Pure logic: read the live funnel (computeFunnel) for a (brand, cohort), rank the most
 * ANOMALOUS drop-offs, and propose a launchable fix per leak. Used by BOTH the diagnoseFunnel
 * Opal tool AND `GET /funnel/diagnose`, so the chat and the Revenue Radar panel produce
 * identical recommendations.
 *
 * Each recommendation's `audience.conditions` is an Optimizely condition-tree JSON STRING in the
 * shape createOptimizelyAudience consumes, so a later "Launch" can pass it straight through.
 */
import type { Env } from '@/types/env';
import { computeFunnel } from '@/services/funnel/compute';
import {
  BRANDS,
  COHORTS,
  type Brand,
  type RealCohort,
  type RemedyKind,
  type FunnelLeak,
  type FunnelRecommendation,
  type FunnelStageResult,
} from '@/services/funnel/contract';

/** Anomaly score for ranking: excess-over-baseline if populated, else raw lost sessions. */
const leakScore = (l: FunnelLeak): number => l.excessLostSessions ?? l.lostSessions;

const COHORT_LABEL: Record<RealCohort, string> = {
  gen_z: 'Gen-Z',
  millennial: 'Millennial',
  gen_x: 'Gen-X',
  boomer: 'Boomer',
};

interface ConditionLeaf {
  name: string;
  type: 'custom_attribute';
  match_type: 'exact' | 'gt' | 'lt';
  value: string | number | boolean;
}

/** ["and",["or",<leaf>], …] JSON string — exactly what createOptimizelyAudience consumes. */
function buildConditions(leaves: ConditionLeaf[]): string {
  return JSON.stringify(['and', ...leaves.map((leaf) => ['or', leaf])]);
}

const lcFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

interface RemedyPlan {
  kind: RemedyKind;
  title: string;
  description: string;
  audienceNoun: string;
  behavior: ConditionLeaf[];
}

/** Pick the remedy for a leak from its stage pair. */
function remedyForLeak(leak: FunnelLeak, cohort: RealCohort): RemedyPlan {
  const cohortLeaf: ConditionLeaf = { name: 'cohort', type: 'custom_attribute', match_type: 'exact', value: cohort };
  const abandoned: ConditionLeaf = { name: 'cart_abandoned', type: 'custom_attribute', match_type: 'exact', value: 1 };
  const lateStage: ConditionLeaf = { name: 'journey_stage', type: 'custom_attribute', match_type: 'exact', value: 'late' };
  const midStage: ConditionLeaf = { name: 'journey_stage', type: 'custom_attribute', match_type: 'exact', value: 'mid' };

  switch (`${leak.fromStage}->${leak.toStage}`) {
    case 'add_payment_info->purchase':
      return {
        kind: 'bnpl',
        title: 'Installments (BNPL) + social proof',
        description: 'Offer installments (BNPL) + social proof to high-intent hesitators',
        audienceNoun: 'BNPL Hesitators',
        behavior: [cohortLeaf, lateStage, abandoned],
      };
    case 'view_cart->begin_checkout':
      return {
        kind: 'cart_recovery',
        title: 'Cart-recovery nudge',
        description: 'Recover stalled carts with a reminder and incentive before checkout begins',
        audienceNoun: 'Cart Abandoners',
        behavior: [cohortLeaf, midStage, abandoned],
      };
    case 'begin_checkout->add_shipping_info':
      return {
        kind: 'shipping_estimator',
        title: 'Upfront shipping estimator',
        description: 'Show delivery cost and ETA up front to blunt shipping-shock drop-off',
        audienceNoun: 'Checkout Stallers',
        behavior: [cohortLeaf, lateStage, abandoned],
      };
    default:
      return {
        kind: 'reassurance',
        title: 'Checkout reassurance',
        description: 'Add trust signals — free returns, secure checkout, reviews — to ease hesitation',
        audienceNoun: 'Checkout Hesitators',
        behavior: [cohortLeaf, abandoned],
      };
  }
}

/** Turn one ranked leak into a launchable FunnelRecommendation. */
function toRecommendation(leak: FunnelLeak, brand: Brand, cohort: RealCohort): FunnelRecommendation {
  const plan = remedyForLeak(leak, cohort);
  const cohortLabel = COHORT_LABEL[cohort];
  const estimatedSize = leak.excessLostSessions ?? leak.lostSessions;
  const recoverableUsd = leak.lostRevenueUsd;
  const skewClause = leak.cohortSkew ? ` (${leak.cohortSkew})` : '';

  return {
    leak,
    audience: { name: `${cohortLabel} ${plan.audienceNoun}`, conditions: buildConditions(plan.behavior), estimatedSize },
    remedy: { kind: plan.kind, title: plan.title, description: plan.description },
    experiment: { variations: ['control', plan.kind], metric: 'purchase' },
    projectedRecoveryUsd: recoverableUsd,
    rationale:
      `${brand} ${cohortLabel} shoppers drop ${leak.dropPct}% from ${leak.fromLabel} to ${leak.toLabel}` +
      `${skewClause}, leaving ~$${recoverableUsd.toLocaleString('en-US')} recoverable — ` +
      `we recommend ${lcFirst(plan.title)}.`,
  };
}

export interface FunnelDiagnosis {
  brand: Brand;
  cohort: RealCohort;
  funnelSummary: { stages: FunnelStageResult[]; overallConvPct: number; recoverableRevenueUsd: number };
  topRecommendation: FunnelRecommendation | null;
  recommendations: FunnelRecommendation[];
  message?: string;
}

/** The whole diagnosis for a (brand, cohort). Validates inputs to contract allow-lists; never throws. */
export async function buildFunnelDiagnosis(env: Env, opts: { brand?: string; cohort?: string }): Promise<FunnelDiagnosis> {
  const brand: Brand = (BRANDS as readonly string[]).includes(opts.brand ?? '') ? (opts.brand as Brand) : 'Coach';
  const cohort: RealCohort = (COHORTS as readonly string[]).includes(opts.cohort ?? '') ? (opts.cohort as RealCohort) : 'gen_z';

  try {
    const result = await computeFunnel(env, { brand, cohort });
    const funnelSummary = {
      stages: result.stages,
      overallConvPct: result.overallConvPct,
      recoverableRevenueUsd: result.recoverableRevenueUsd,
    };
    const ranked = [...result.leaks].filter((l) => leakScore(l) > 0).sort((a, b) => leakScore(b) - leakScore(a));
    const entrySessions = result.stages[0]?.sessions ?? 0;

    if (entrySessions === 0 || ranked.length === 0) {
      return { brand, cohort, funnelSummary, topRecommendation: null, recommendations: [], message: 'No significant leaks detected.' };
    }
    const recommendations = ranked.slice(0, 3).map((leak) => toRecommendation(leak, brand, cohort));
    return { brand, cohort, funnelSummary, topRecommendation: recommendations[0], recommendations };
  } catch {
    return {
      brand,
      cohort,
      funnelSummary: { stages: [], overallConvPct: 0, recoverableRevenueUsd: 0 },
      topRecommendation: null,
      recommendations: [],
      message: 'No significant leaks detected.',
    };
  }
}
