// src/connectors/types.ts
// Types shaped to ODP's schema so mock and live are interchangeable.
// Contract is normative — see docs/architecture/05-demo-build-spec.md §1.0.

/** A real-time segment/audience key as ODP would return it (snake_case, stable). */
export type SegmentKey = string; // e.g. "high_intent_tabby_browser", "early_journey_cold_start"

/** ODP-style audience/segment definition. This is what Opal drafts and what ODP qualifies against. */
export interface AudienceDef {
  /** Stable key used everywhere downstream (cookies, decisions, ODP qualification). */
  key: SegmentKey;
  /** Human-facing name shown in the operator console / Opal review card. */
  name: string;
  /** What the merchandiser asked for, in plain language (provenance for the demo). */
  description: string;
  /**
   * ODP-style condition tree. Same shape OptimizelyService already evaluates:
   * nested ['and'|'or'|'not', ...] with leaf predicates over real-time
   * session/profile attributes.
   */
  conditions: AudienceCondition;
  /** 'realtime' = evaluated per-event at the edge (ODP real-time audiences). */
  evaluation: 'realtime' | 'batch';
  /** 'catalog' = emitted by the Edge Affinity Reflex audience generator (doc 16 §5). */
  source: 'opal_nl' | 'manual' | 'seed' | 'catalog';
  /** Demo surface this audience belongs to. ABSENT means 'coach' — every audience
      written before the multi-surface split is the retail demo's by definition.
      Scopes regeneration's archive pass (one surface may never archive another's)
      and qualification (a surface only evaluates its own audiences). */
  surface?: string;
  createdAt: number;
  /** Human override: a pinned audience is NEVER touched by generator regeneration. */
  pinned?: boolean;
  /** Hash of the generator's own output at publish time. If the stored def no longer
      hashes to this value, a human edited it — regeneration must leave it alone. */
  generatorHash?: string;
  /** Set once createAudience() is called; absent on a draft suggestion. */
  audienceId?: string;
  status: 'suggested' | 'draft' | 'published' | 'archived';
  /** Optional demo metadata carried from the insight (module to render, evidence for the review card). */
  recommendedModule?: string;
  anchorLine?: string;
  stats?: Record<string, number>;
}

/** Leaf predicate over a real-time attribute the edge engine actually computes. */
export interface AudiencePredicate {
  attribute: string; // e.g. "viewed_product_line", "cart_adds", "journey_stage"
  operator: 'eq' | 'neq' | 'gte' | 'lte' | 'gt' | 'lt' | 'contains' | 'in' | 'not_in';
  value: string | number | boolean | Array<string | number>;
}

export type AudienceCondition =
  | AudiencePredicate
  | ['and', ...AudienceCondition[]]
  | ['or', ...AudienceCondition[]]
  | ['not', AudienceCondition];

/** The real-time signal snapshot the SegmentProvider qualifies a user against. */
export interface QualificationContext {
  userId: string;
  anonymousId?: string;
  attributes: Record<string, any>; // mirrors SessionData.attributes + catalog signals
  segments: SegmentKey[]; // segments already on the profile
  /** Demo surface this qualification belongs to. Absent = evaluate every published
      audience (the pre-split behavior); set = evaluate only that surface's. */
  surface?: string;
}

/** Mirrors an Optimizely OptimizelyDecision (the subset the storefront needs). */
export interface Decision {
  flagKey: string;
  enabled: boolean;
  variationKey: string | null;
  /** Optimizely "variables" map — drives which personalization module + params render. */
  variables: Record<string, any>;
  ruleKey: string | null;
  /** experiment | rollout | bandit (CMAB) | fallback. Lets the UI label "A/B test measuring this". */
  reason: 'experiment' | 'rollout' | 'bandit' | 'fallback';
}

export class NotWiredError extends Error {
  constructor(connector: string) {
    super(`${connector}: live adapter not wired. Set CONNECTOR_MODE=mock or supply credentials.`);
    this.name = 'NotWiredError';
  }
}
