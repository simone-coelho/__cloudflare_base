// src/connectors/DecisionProvider.ts
// (c) DecisionProvider — mirrors Optimizely Feature Experimentation decisions.
// Wraps flag/variation decisions. Replaces the hardcoded getExperimentDecisions /
// getFeatureFlagDecisions / getFeatureVariables loops formerly inside
// RealtimeSegmentEngine. See docs/architecture/05-demo-build-spec.md §1.3.
//
// REAL SEAMS, MOCKED CALLS: the interface is named after the real product seam
// (Optimizely `decide`). The Mock adapter returns synthetic Coach personalization
// decisions keyed off the qualified ODP segments; the Live adapter wraps the
// existing OptimizelyService (the SDK we already integrate) and stays inert until
// credentials are supplied.
//
// Data source: src/data/insights.json — each insight carries `key` (the segment) and
// `recommended_module` (the personalization module that segment should see). We build
// a segment -> module map from those at load time, so mock decisions are grounded in
// the same pre-aggregated audience data the rest of the demo uses.

import type { Decision, SegmentKey } from './types';
import type { OptimizelyService } from '@/services/OptimizelyService';
import { OptimizelyDecideOption } from '@optimizely/optimizely-sdk';
import insightsData from '@/data/insights.json';

export interface DecisionProvider {
  /** Optimizely: decide a single flag for a user given their qualified segments + attrs. */
  decide(
    flagKey: string,
    userId: string,
    segments: SegmentKey[],
    attributes: Record<string, any>
  ): Promise<Decision>;

  /** Batch convenience for the storefront's full module set. */
  decideAll(
    flagKeys: string[],
    userId: string,
    segments: SegmentKey[],
    attributes: Record<string, any>
  ): Promise<Record<string, Decision>>;
}

/**
 * The storefront module slots the engine decides. Each is an Optimizely flag whose
 * chosen variation tells the storefront which personalization module renders in that
 * slot. The DecisionProvider returns one Decision per key from decideAll.
 *   - hero_module        — the top-of-page hero (curated grid, premium hero, line spotlight, …)
 *   - plp_sort           — product-list sort strategy (trending, tabby_first, premium_first, …)
 *   - complete_the_look  — the cross-sell / "complete the look" rail (on/off + anchor line)
 *   - promo_banner       — site-wide promotional banner (gift edit, win-back, VIP early access, …)
 *   - journey_message    — the journey-stage reassurance / nudge message (discovery → social proof → checkout)
 */
export const CATALOG_FLAG_KEYS: string[] = [
  'hero_module',
  'plp_sort',
  'complete_the_look',
  'promo_banner',
  'journey_message',
];

// ---------------------------------------------------------------------------
// Insight-derived segment -> module map.
// ---------------------------------------------------------------------------

interface InsightView {
  key: string;
  recommended_module?: string;
  anchor_line?: string | null;
  complete_the_look?: Array<{ product_id: string; name?: string; price_usd?: number }>;
}

interface SegmentModule {
  /** recommended_module from the insight (e.g. 'complete_the_look', 'curated_grid'). */
  module: string;
  /** anchor product line, when the segment is line-specific (Tabby, Brooklyn, …). */
  anchorLine?: string;
  /** pre-curated complete-the-look product ids carried on the insight, when present. */
  completeTheLookIds?: string[];
}

/** segment key -> the module + params that segment's insight recommends. */
const SEGMENT_MODULE: Record<string, SegmentModule> = (() => {
  const map: Record<string, SegmentModule> = {};
  const insights = (insightsData as { insights?: InsightView[] }).insights ?? [];
  for (const ins of insights) {
    if (!ins.recommended_module) continue;
    map[ins.key] = {
      module: ins.recommended_module,
      anchorLine: ins.anchor_line ?? undefined,
      completeTheLookIds: ins.complete_the_look?.map((p) => p.product_id),
    };
  }
  return map;
})();

/**
 * Priority order over segments — highest intent / most specific first, broad
 * fallback segments last. When a user qualifies for several segments, the
 * highest-priority one that has a module for the requested flag wins. This makes
 * decisions deterministic and demo-stable (no Math.random, no clock).
 */
const SEGMENT_PRIORITY: SegmentKey[] = [
  'vip_loyalist', // most valuable: VIP treatment trumps everything
  'late_journey_ready_to_buy', // closest to conversion
  'cart_abandoner', // active recovery opportunity
  'high_intent_tabby_browser', // hero "complete the look" target
  'brooklyn_browser', // line-specific spotlight
  'high_aov_gifter', // gift-edit merchandising
  'luxe_affinity', // premium hero / sort
  'mid_journey_considering', // social proof while comparing
  'lapsed_reengagement', // win-back
  'early_journey_cold_start', // broadest cold-start fallback — keep last
];

/**
 * Which storefront flag each personalization module belongs in. A qualified
 * segment's `recommended_module` only influences the flag it maps to here, so the
 * same segment can drive the hero while a different segment drives the promo banner.
 */
const MODULE_TO_FLAG: Record<string, string> = {
  // hero_module variations
  curated_grid: 'hero_module',
  premium_hero: 'hero_module',
  line_spotlight: 'hero_module',
  // complete_the_look slot
  complete_the_look: 'complete_the_look',
  // promo_banner variations
  gift_edit: 'promo_banner',
  vip_early_access: 'promo_banner',
  winback_offer: 'promo_banner',
  cart_recovery: 'promo_banner',
  // journey_message variations
  social_proof: 'journey_message',
  checkout_nudge: 'journey_message',
};

/**
 * plp_sort is not a 1:1 module from the insights; it is derived from the winning
 * segment. Map the highest-priority qualified segment to a sort strategy.
 */
const SEGMENT_TO_SORT: Record<SegmentKey, { sort: string; anchorLine?: string }> = {
  high_intent_tabby_browser: { sort: 'tabby_first', anchorLine: 'Tabby' },
  brooklyn_browser: { sort: 'line_first', anchorLine: 'Brooklyn' },
  luxe_affinity: { sort: 'premium_first' },
  vip_loyalist: { sort: 'premium_first' },
  high_aov_gifter: { sort: 'gift_first' },
  late_journey_ready_to_buy: { sort: 'in_cart_first' },
  cart_abandoner: { sort: 'recently_viewed_first' },
  mid_journey_considering: { sort: 'most_viewed_first' },
  lapsed_reengagement: { sort: 'trending' },
  early_journey_cold_start: { sort: 'trending' },
};

/** Per-flag fallback (reason:'fallback') when no qualified segment drives the slot. */
const FLAG_DEFAULTS: Record<
  string,
  { enabled: boolean; variationKey: string | null; variables: Record<string, any> }
> = {
  hero_module: { enabled: true, variationKey: 'curated_grid', variables: { module: 'curated_grid' } },
  plp_sort: { enabled: true, variationKey: 'trending', variables: { module: 'plp_sort', sort: 'trending' } },
  complete_the_look: { enabled: false, variationKey: 'off', variables: { module: 'complete_the_look' } },
  promo_banner: { enabled: false, variationKey: 'off', variables: { module: 'promo_banner' } },
  journey_message: {
    enabled: true,
    variationKey: 'discovery',
    variables: { module: 'journey_message', stage: 'early', message: 'discovery' },
  },
};

/** Qualified segments ordered by descending priority (used to pick the winner). */
function rankSegments(segments: SegmentKey[]): SegmentKey[] {
  const set = new Set(segments);
  const ranked = SEGMENT_PRIORITY.filter((s) => set.has(s));
  // include any qualified segments not in the priority list, after the known ones
  for (const s of segments) if (!SEGMENT_PRIORITY.includes(s)) ranked.push(s);
  return ranked;
}

/** Build a Decision from the fallback table for a flag. */
function fallbackDecision(flagKey: string): Decision {
  const def = FLAG_DEFAULTS[flagKey] ?? {
    enabled: false,
    variationKey: 'off',
    variables: { module: flagKey },
  };
  return {
    flagKey,
    enabled: def.enabled,
    variationKey: def.variationKey,
    variables: { ...def.variables },
    ruleKey: null,
    reason: 'fallback',
  };
}

/**
 * Core mock decision logic, pure and deterministic. Picks a variation/module from
 * the highest-priority matching qualified segment for the requested flag; falls back
 * to a sensible per-flag default otherwise.
 */
function decideFromSegments(
  flagKey: string,
  segments: SegmentKey[],
  _attributes: Record<string, any>
): Decision {
  const ranked = rankSegments(segments);

  // plp_sort is segment-derived (not an insight module) — handle first.
  if (flagKey === 'plp_sort') {
    const winner = ranked.find((s) => SEGMENT_TO_SORT[s]);
    if (winner) {
      const { sort, anchorLine } = SEGMENT_TO_SORT[winner];
      return {
        flagKey,
        enabled: true,
        variationKey: sort,
        variables: { module: 'plp_sort', sort, ...(anchorLine ? { anchorLine } : {}) },
        ruleKey: winner,
        reason: 'experiment', // segment-driven → "A/B test measuring this"
      };
    }
    return fallbackDecision(flagKey);
  }

  // For module-backed flags: find the highest-priority qualified segment whose
  // recommended_module maps to this flag.
  for (const seg of ranked) {
    const sm = SEGMENT_MODULE[seg];
    if (!sm) continue;
    if (MODULE_TO_FLAG[sm.module] !== flagKey) continue;

    const variables: Record<string, any> = { module: sm.module };
    if (sm.anchorLine) variables.anchorLine = sm.anchorLine;
    if (flagKey === 'complete_the_look') {
      variables.slots = 3;
      if (sm.completeTheLookIds?.length) variables.productIds = sm.completeTheLookIds;
    }
    if (flagKey === 'journey_message') {
      // carry the stage so the storefront can label the journey beat
      variables.stage =
        sm.module === 'checkout_nudge' ? 'late' : sm.module === 'social_proof' ? 'mid' : 'early';
      variables.message = sm.module;
    }

    return {
      flagKey,
      enabled: true,
      variationKey: sm.module,
      variables,
      ruleKey: seg,
      reason: 'experiment', // segment-driven decision → UI can say "A/B test measuring this"
    };
  }

  return fallbackDecision(flagKey);
}

/**
 * Mock adapter — deterministic decisions keyed off the qualified ODP segments,
 * returning Coach personalization-module variables (which module renders + its params).
 * No network, no clock, no randomness: the same (flag, segments) always decide the same
 * way, so the demo is reproducible on stage.
 */
export class MockDecisionProvider implements DecisionProvider {
  async decide(
    flagKey: string,
    _userId: string,
    segments: SegmentKey[],
    attributes: Record<string, any>
  ): Promise<Decision> {
    return decideFromSegments(flagKey, segments, attributes);
  }

  async decideAll(
    flagKeys: string[],
    userId: string,
    segments: SegmentKey[],
    attributes: Record<string, any>
  ): Promise<Record<string, Decision>> {
    const out: Record<string, Decision> = {};
    for (const k of flagKeys) out[k] = await this.decide(k, userId, segments, attributes);
    return out;
  }
}

/** Keep only SDK-legal attribute primitives, and surface qualified ODP segments. */
function toUserAttributes(
  attributes: Record<string, any>,
  segments: SegmentKey[]
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(attributes ?? {})) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  // Audience conditions on FX can target the qualified segments once flags exist.
  out.qualified_segments = segments.join(',');
  return out;
}

/**
 * Live adapter (Mode B) — wraps the existing OptimizelyService and decides flags
 * against the REAL Feature Experimentation datafile.
 *
 * Flow (doc 09 §6 option 1): fetch the per-environment datafile on demand with
 * `cache:'no-store'` (freshness within seconds), build an OptimizelyUserContext,
 * call `decide()`, and map the OptimizelyDecision onto our `Decision`.
 *
 * GRACEFUL DEGRADATION — the FX project is currently near-empty (0 flags). For any
 * flag the datafile can't decide (absent flag, no client, or SDK error) this falls
 * back to the deterministic MockDecisionProvider, so the storefront stays fully
 * personalized. As real flags are created in Optimizely they progressively OVERRIDE
 * the mock, slot by slot — no redeploy. Flip on with DECISION_SOURCE=optimizely.
 */
export class LiveDecisionProvider implements DecisionProvider {
  /** Mock decisions back every flag the live datafile can't (yet) decide. */
  private readonly fallback = new MockDecisionProvider();
  /**
   * Memoized per provider instance (getConnectors builds one per request), so the
   * five flags in decideAll share a SINGLE no-store datafile fetch + client build.
   */
  private ctx: Promise<{ client: any; datafile: any; revision: string | null } | null> | null = null;

  constructor(private opti: OptimizelyService) {}

  private getCtx(): Promise<{ client: any; datafile: any; revision: string | null } | null> {
    if (!this.ctx) {
      this.ctx = this.opti
        .createFreshClient()
        .then((c) => {
          const flags = (c.datafile && c.datafile.featureFlags) || [];
          console.log(
            `LiveDecisionProvider: datafile revision=${c.revision}, featureFlags=${flags.length}`
          );
          return c;
        })
        .catch((err) => {
          console.error(
            'LiveDecisionProvider: datafile/client init failed — using mock fallback:',
            err
          );
          return null;
        });
    }
    return this.ctx;
  }

  async decide(
    flagKey: string,
    userId: string,
    segments: SegmentKey[],
    attributes: Record<string, any>
  ): Promise<Decision> {
    const ctx = await this.getCtx();

    // No live datafile/client (fetch failed) → mock keeps the slot personalized.
    if (!ctx || !ctx.client) {
      return this.fallback.decide(flagKey, userId, segments, attributes);
    }

    // Degrade gracefully when the (near-empty) project has no such flag yet.
    const flags = (ctx.datafile && ctx.datafile.featureFlags) || [];
    const known = Array.isArray(flags) && flags.some((f: any) => f && f.key === flagKey);
    if (!known) {
      return this.fallback.decide(flagKey, userId, segments, attributes);
    }

    try {
      const user = ctx.client.createUserContext(userId, toUserAttributes(attributes, segments));
      if (!user) return this.fallback.decide(flagKey, userId, segments, attributes);

      // DISABLE_DECISION_EVENT: this is a decision READ at the edge, not measurement.
      const d = user.decide(flagKey, [OptimizelyDecideOption.DISABLE_DECISION_EVENT]);
      if (!d) return this.fallback.decide(flagKey, userId, segments, attributes);

      return {
        flagKey: d.flagKey ?? flagKey,
        enabled: !!d.enabled,
        variationKey: d.variationKey ?? null,
        variables: (d.variables as Record<string, any>) ?? {},
        ruleKey: d.ruleKey ?? null,
        // ruleKey present ⇒ an experiment/delivery rule served it; otherwise a rollout default.
        reason: d.ruleKey ? 'experiment' : 'rollout',
      };
    } catch (err) {
      console.error(`LiveDecisionProvider.decide(${flagKey}) failed — using mock fallback:`, err);
      return this.fallback.decide(flagKey, userId, segments, attributes);
    }
  }

  async decideAll(
    flagKeys: string[],
    userId: string,
    segments: SegmentKey[],
    attributes: Record<string, any>
  ): Promise<Record<string, Decision>> {
    const out: Record<string, Decision> = {};
    for (const k of flagKeys) out[k] = await this.decide(k, userId, segments, attributes);
    return out;
  }
}
