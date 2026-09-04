// src/content/types.ts
// The product content decision service — the shapes. Doc 22 §3.1 (the decision
// record) and §7 of the content affinity engine design (the delivery contract),
// as TypeScript. The seam with Phase 0 is DecisionRecord: CW4 emits it, CW19
// persists it, and neither side changes it without a row in plan 21 first.

import type { ContentPieceLike, ContentDecision, SlotCandidate } from '@/reflex/contentCompose';
import type { ExternalKind, ExternalModelConfig } from '@/learn/external';
import type { MerchandisingDriver, MerchandisingSignals, MerchandisingWeights } from '@/reflex/merchandising';

/** A registered piece of the customer's content: their id, our id, its tags. */
export interface ContentPiece extends ContentPieceLike {
  lifecycle: { status: 'live' | 'draft' | 'expired' };
  /** Scope §1.5: the item's own season, promotion and margin signals, each in [0, 1], however the feed derives them. */
  merchandising?: MerchandisingSignals;
  /** Where the customer's front end fetches the asset to paint. Theirs; echoed, never rewritten. */
  renderUrl?: string;
  /** Publish and expire, ISO 8601. Outside the window a live piece is not eligible. */
  window?: { from?: string; to?: string };
  excerpt?: string;
}

/** The `content` document kind: the catalog for a scope. */
export interface ContentCatalog {
  version?: string;
  pieces: ContentPiece[];
}

/**
 * One slot's strategy — Mandeep's word: a combination of dimensions and weights
 * applied to a slot. `take` is how many pieces it holds; `pinnedPieceId` makes it
 * non-personalizable (the merchandiser's piece, ranking never runs).
 */
export interface SlotStrategy {
  slot: string;
  take: number;
  weights: Record<string, number>;
  pinnedPieceId?: string;
  /** Scope §1.5: the tunable multipliers for this placement. Absent or all zero means off. */
  merchandising?: MerchandisingWeights;
}

/** The `slots` document kind: per page, the slots in page order. */
export interface SlotCatalog {
  version?: string;
  pages: Record<string, SlotStrategy[]>;
}

export type Arm = 'personalized' | 'default' | 'no_learning';

/** Doc 22 §10. Assignment is a hash, so it is sticky by construction. */
export interface HoldoutConfig {
  /** Fraction of visitors in the holdout, 0..1. */
  share: number;
  /** Rotated to reassign. Empty means "use the brand". */
  salt: string;
  /** The holdout arms; the share is split evenly across them. */
  arms: Array<'default' | 'no_learning'>;
}

/**
 * The `learn` document kind. Opened here with the holdout section only, because
 * assignment must exist before the first decision is recorded (doc 22 §10).
 * Phase 1 extends it in place with γ, exploration and autonomy per slot.
 */
/** Doc 22 §8 and ledger 19's regional-trending design: the population prior on the base score. */
export interface RegionalConfig {
  enabled: boolean;
  /** λ = kBlend / (kBlend + Σ personal affinity). Larger keeps the population speaking longer. */
  kBlend: number;
  /** The finest level with at least this many events is used; the same gate as the geo cold start. */
  minEvents: number;
}

/** Doc 22 §4: the learning policy's four axes and the per-reward windows. */
export interface LearnPolicyConfig {
  scope: 'session' | 'visitor';
  match: 'direct' | 'any';
  credit: 'last' | 'first';
  windowsMs: Partial<Record<'click' | 'dwell' | 'video_complete' | 'wishlist' | 'add_to_bag' | 'purchase' | 'custom', number>>;
}

/** Doc 22 §5.1: the estimator's constants. */
export interface LearnStatsConfig { n0: number; tauLearnMs: number; liftMin: number; liftMax: number; nMin: number }

/** Doc 22 §7: how a slot explores. */
export interface ExploreDials { mode: 'rotation' | 'thompson' | 'epsilon' | 'off'; share: number; floor: number }
/** Doc 22 §11: whether and how a slot adjusts its own weights. */
export interface AutonomyDials { mode: 'configured' | 'assisted' | 'autonomous'; step: number; min: number; max: number; pinned: string[]; minN: number }
/** Doc 22 §12.2: a merchandiser's control over one item's learned lift. */
export interface ItemControl { mode: 'reject' | 'freeze'; lift?: number }

/** Doc 22 §6.2 and §13: the per-slot dials. γ defaults to 0, shadow mode. */
export interface SlotDials {
  gamma?: number;
  reward?: 'click' | 'dwell' | 'video_complete' | 'wishlist' | 'add_to_bag' | 'purchase' | 'custom';
  exploration?: ExploreDials;
  autonomy?: AutonomyDials;
  items?: Record<string, ItemControl>;
  /** Doc 22 §9: how much this slot trusts their model, w_ext. Absent or 0 means the term is off for the slot. */
  external?: { weight: number };
}

export interface LearnConfig {
  version?: string;
  holdout: HoldoutConfig;
  regional?: RegionalConfig;
  policy?: LearnPolicyConfig;
  stats?: LearnStatsConfig;
  /** slot → dials. A slot absent here runs at γ = 0 on the click reward. */
  slots?: Record<string, SlotDials>;
  /** Doc 22 §9: their model, one per tenant; each slot dials its weight. */
  external?: ExternalModelConfig;
}

/** Doc 22 §12.1: what the learning layer contributed, on every receipt it touched. */
export interface LiftApplied {
  reward: string;
  level: number;
  level_words: string;
  n: number;
  s: number;
  p0: number;
  n0: number;
  p_hat: number;
  lift: number;
  gamma: number;
  /** Doc 22 §8: the imported prior this estimate was shrunk toward, when one was in force for the key. */
  prior?: { p: number; n: number };
}

/** What the population contributed to a decision set, so a reader can see the prior. */
export interface RegionalBlend {
  region: string;
  level: 'region' | 'country' | 'global';
  lambda: number;
  version: number;
  events: number;
}

export type Authority = 'engine' | 'pin' | 'default';

/**
 * What the shopper's state hung on when this decision was made. Evidence pooled
 * on a session-only anchor is weaker than the same evidence on a durable id, and
 * the ledger is the only place that distinction survives (doc 22 §3.1).
 */
export type IdentityAnchor = 'visitor' | 'session' | 'none';

/** Doc 22 §5.4. Components not yet available are recorded as unknown, not guessed. */
export interface Cell {
  channel: string;
  visit_bucket: '1' | '2-3' | '4+' | 'unknown';
  region: string | null;
  /** The leading interest above its entry threshold, as `dim:value`, or null. */
  affinity: string | null;
}

/**
 * Doc 22 §3.1 / §12.1: the integers that identify what produced a decision.
 * Phase 3 completes the tuple with the three documents a replay needs; 0 means
 * the compiled default. `policy` is the learn document's revision, kept under
 * its design name.
 */
export interface DecisionVersions {
  config: number;
  catalog?: number;
  slots?: number;
  learn?: number;
  lift: number;
  prior: number;
  policy: number;
}

/** Doc 22 §9, on the receipt: what their model contributed, or why it could not. */
export type ExternalApplied =
  | { kind: ExternalKind; ref: string; version: string; weight: number; score: number; contribution: number }
  | { kind: ExternalKind; ref: string; status: 'unavailable'; reason: string };

/** Doc 22 §9, into the decision: the model's answer for this page, or the reason there is none. */
export type ExternalTerm = { kind: ExternalKind; ref: string; weightOf: (slot: string) => number } & (
  | { status: 'ok'; version: string; scores: Record<string, number> }
  | { status: 'unavailable'; reason: string }
);

/**
 * Doc 22 §12.3: what the decision was computed from, carried on the record so
 * a replay is exact. The interest vector as scored (after any regional blend),
 * the regional shares when a blend applied, and the model's scores when a term
 * applied. About a kilobyte; the documents are named by revision instead.
 */
export interface DecisionInputs {
  affinity: Record<string, Record<string, number>>;
  regional_share?: Record<string, Record<string, number>>;
  external?: { version: string; scores: Record<string, number> };
}

/** Doc 22 §3.1, one per served slot position. Emitted by CW4, persisted by CW19. */
export interface DecisionRecord {
  decision_id: string;
  tenant: string;
  brand: string;
  visitor_id: string;
  session_id: string | null;
  identity_anchor: IdentityAnchor;
  ts: number;
  page: string;
  slot: string;
  position: number;
  item_id: string;
  customer_item_id: string;
  candidates: SlotCandidate[];
  cell: Cell;
  arm: Arm;
  explored: boolean;
  authority: Authority;
  versions: DecisionVersions;
  /** The human-readable label of the configuration revision (doc 22 §12.1). */
  config_label: string;
  explain: {
    drivers: ContentDecision['explain']['drivers'];
    note?: string;
    score_base: number;
    /** The population prior's share of the base score, when one applied. */
    regional?: RegionalBlend & { contribution: number };
    /** The learned lift and the dial it was applied through; null when nothing has been learned for this item in this cell. */
    lift: LiftApplied | null;
    /** score_base × lift^γ. Equal to score_base while γ is 0. */
    score_final: number;
    /** Why this placement was an exploration pick, when it was. */
    exploration?: { mode: string; reason: string; bucket: number; sample?: number };
    /** A merchandiser's control on this item's lift, when one applied. */
    control?: 'reject' | 'freeze';
    /** Their model's term on this decision, when the slot weights one. */
    external?: ExternalApplied;
    /**
     * Scope §1.5: season, promotion and margin, each itemised as the score delta it caused.
     * score_base + the sum of the contributions is the merchandised score; the lift then multiplies it.
     */
    merchandising?: { boost: number; clamped: boolean; drivers: MerchandisingDriver[]; sentence: string };
  };
  /** Doc 22 §12.3: the inputs a replay needs. Absent on records written before Phase 3. */
  inputs?: DecisionInputs;
}

/** What the route returns: the contract the front end paints, and the records the ledger keeps. */
export interface ContentDecisionSet {
  tenant: string;
  brand: string;
  page: string;
  visitor_id: string;
  session_id: string | null;
  identity_anchor: IdentityAnchor;
  ts: number;
  arm: Arm;
  cell: Cell;
  versions: DecisionVersions;
  config_label: string;
  /** Null when no trend was published for the tenant, the shopper is in the holdout, or the blend is off. */
  regional: RegionalBlend | null;
  decisions: ContentDecision[];
  records: DecisionRecord[];
}
