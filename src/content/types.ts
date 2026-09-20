// src/content/types.ts
// The product content decision service — the shapes. Doc 22 §3.1 (the decision
// record) and §7 of the content affinity engine design (the delivery contract),
// as TypeScript. The seam with Phase 0 is DecisionRecord: CW4 emits it, CW19
// persists it, and neither side changes it without a row in plan 21 first.

import type { ContentPieceLike, ContentDecision, SlotCandidate, PinDiagnostic } from '@/reflex/contentCompose';
import type { SlotConstraintReason } from './slotConstraints';
import type { ExternalKind, ExternalModelConfig } from '@/learn/external';
import type { MerchandisingDriver, MerchandisingSignals, MerchandisingWeights } from '@/reflex/merchandising';

/** A registered piece of the customer's content: their id, our id, its tags. */
export interface ContentPiece extends ContentPieceLike {
  lifecycle: { status: 'live' | 'draft' | 'expired' };
  /** Scope §1.5: the item's own season, promotion and margin signals, each in [0, 1], however the feed derives them. */
  merchandising?: MerchandisingSignals;
  /**
   * CW29 (BTIE A.3.4): the journey stages this piece is made for, in Tapestry's words. Absent means it fits
   * every stage. A slot with a `stage` rule demotes a piece outside the visitor's stage and can favour one inside it.
   */
  journeyStageFit?: StageWord[];
  /** CW30 (BTIE A.3.6 `freshness_date`): when the piece became current, ISO 8601. The freshness term ages from it; absent, from `window.from`; neither, no term. */
  freshnessDate?: string;
  /** CW32 (BTIE A.3.6 `featured_product_ids`): the products the piece features, in the customer's product ids, so a shoppable module can be painted and a product decision joined. Carried, validated, never rewritten. */
  featuredProductIds?: string[];
  /** CW33 (BTIE D11): the catalog's own stock flag. `false` removes the piece from every decision; absent or `true` means in stock. */
  inStock?: boolean;
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
  /** Ordered required first positions; ranking fills the remainder of take. */
  pinnedPieceIds?: string[];
  /** Hard handoff to the site's own default on every arm; pin/settings stay dormant. */
  offLimits?: boolean;
  /** Exact internal catalog IDs forbidden only in this slot, before pins or ranking. */
  excludedPieceIds?: string[];
  /** Any exact dimension/value pair excludes the piece; no normalization or vocabulary. */
  excludedTags?: Array<{ dimension: string; value: string }>;
  /** Exact rendering kinds, not format-affinity tags. Absent means unrestricted. */
  allowedTypes?: string[];
  /** Scope §1.5: the tunable multipliers for this placement. Absent or all zero means off. */
  merchandising?: MerchandisingWeights;
  /**
   * CW29: the slot's journey-stage rule. `outOfStage` multiplies the score of a piece whose `journeyStageFit`
   * excludes the visitor's stage (0 sorts it last, 1 is off); `inStage` is added to the score of a piece that
   * names the visitor's stage. Off when the visitor's stage is unknown, and on the holdout's default arm.
   */
  stage?: StageRule;
  /** CW30: a bonus for recent content, `weight × 2^(−age / halfLifeDays)`, ages from the piece's freshness date. */
  freshness?: FreshnessRule;
  /** CW30: a penalty for content this visitor was already served, `weight × min(served, cap) / cap` over the window, read from the visitor's ring. */
  fatigue?: FatigueRule;
  /** CW33 (BTIE D11): at most `max` pieces sharing one value of `dimension` in this slot; a piece over the limit yields to the next, and is served after all when nothing else is eligible. */
  diversity?: DiversityRule;
  /**
   * W16 C3: this slot's contextual seed rule set. Published and versioned with
   * the slot itself, because a rule's weight and the slot's dimension weight are
   * arithmetically coupled and must move as one revision. Absent or empty means
   * the slot has no contextual seeding at all.
   */
  seeds?: SeedRule[];
}

export interface DiversityRule { dimension: string; max: number }

/** The arrival signals a seed rule may read. Each is context, never learned evidence. */
export type SeedSignal = 'entry_channel' | 'campaign_term' | 'referrer_network';

/**
 * W16 C3 (document 35 §2 F13): the interest an ARRIVAL is evidence for, before
 * the shopper has shown any of her own. One rule maps one context signal value
 * to canonical catalog tags with a weight in the engine's own 0..1 rule range;
 * a piece carrying such a tag gains `weight × the slot's weight for that tag's
 * dimension` in its base, before merchandising. The taxonomy lives in the
 * published document, never in this code.
 */
export interface SeedRule {
  signal: SeedSignal;
  /**
   * The value of that signal this rule fires on: one of the six channel words
   * for `entry_channel`, the campaign term verbatim for `campaign_term`, a known
   * network's registrable domain for `referrer_network`.
   */
  value: string;
  /** The canonical tags this arrival is evidence for; each dimension must be one the slot weights. */
  tags: Array<{ dimension: string; value: string }>;
  /** 0..1, the codebase's rule-weight range. */
  weight: number;
}

/** What one fired rule contributed to one candidate, itemised as a delta like every other term. */
export interface SeedDriver {
  signal: SeedSignal;
  value: string;
  dimension: string;
  tag: string;
  weight: number;
  /** The delta this rule caused in the final pre-lift base, after merchandising. */
  contribution: number;
}

/** Refused seed configuration, never a fabricated influence, in the pattern of `pinDiagnostics`. */
export interface SeedDiagnostic { slot: string; reason: 'invalid_rule_set' }

export interface FreshnessRule { weight: number; halfLifeDays: number }
export interface FatigueRule { weight: number; windowHours: number; cap: number }

/** BTIE's See / Think / Do: what a piece is tagged with and what the receipt says. */
export type StageWord = 'exploring' | 'considering' | 'deciding';
export interface StageRule { outOfStage?: number; inStage?: number }

/** The `slots` document kind: per page, the slots in page order. */
export interface SlotCatalog {
  version?: string;
  /** Absent retained documents use legacy parsing, ignoring formerly unknown controls. */
  governanceVersion?: 1 | 2 | 3;
  pages: Record<string, SlotStrategy[]>;
}

/** The EXPERIENCE served. Unchanged by W21: a shopper who withheld a consent switch is served the site's own defaults. */
export type Arm = 'personalized' | 'default' | 'no_learning';

/**
 * W21 E1.02 (F07 §1.4, ruling R108): the experimental ASSIGNMENT, which is not
 * the served experience. A shopper who has not consented to personalization was
 * never drawn into the experiment at all; she is served exactly what the
 * `default` arm is served, and only her assignment says `ineligible`, so the
 * control arm of any comparison holds randomised controls only. The two live in
 * different places on purpose: `arm` on the answer and on the record is what she
 * saw, `experiment.arm` is what she was assigned.
 */
export type Assignment = Arm | 'ineligible';

/**
 * W21 E1 (F07 §7(b)): the shopper's enrollment in the agreed experiment, written
 * once against a persistent anchor and read back on every later decision, so the
 * arm is never redrawn from whatever id the browser is carrying at that moment.
 */
export interface EnrollmentProvenance {
  /** `${tenant}:${brand}:${effective salt}` — a salt change starts a new experiment. */
  id: string;
  /** The revision of the published learn document the enrollment was written under. */
  saltVersion: number;
  /**
   * The assignment: an `Assignment` by value — a randomised arm, or `ineligible`
   * for a shopper who was never drawn.
   *
   * Typed `string` rather than `Assignment` for two reasons: this block is part
   * of a STORED record, so a row written by an older or a later writer may carry
   * a value this build's union does not list and the reader must not assume a
   * closed set; and the batch's own harness types the member `string`
   * (`src/units/W21/B1.unit.test.ts:1181,1183` assign it into a seeded record),
   * which an implementer may not edit. R118(9)'s narrowing is owed and named.
   */
  arm: string;
  /**
   * Why the assignment is `ineligible`, so an analyst need not guess which
   * population a row belongs to: the shopper withheld personalization consent,
   * or her persistent enrollment anchor could not be read at that moment and no
   * arm may be drawn from the id her browser happens to carry (R118(2), (3)).
   * Absent on a randomised assignment.
   */
  reason?: 'personalization_consent' | 'anchor_unavailable';
  /** 1 for the first anchor; only a replacement of the anchor itself advances it. Recognition does not. */
  anchorGeneration: number;
}

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
/** Doc 22 §13, CW27: what a success is worth. `unit` counts it; `revenue` weighs it by the outcome's value; `margin` by its margin, or its value when the feed gives no margin. */
export type Objective = 'unit' | 'revenue' | 'margin';
/** Absent retained metadata means served-v1, never rendered evidence. */
export type MeasurementBasis = 'served-v1' | 'rendered-v1';

export interface SlotDials {
  measurementBasis?: MeasurementBasis;
  gamma?: number;
  reward?: 'click' | 'dwell' | 'video_complete' | 'wishlist' | 'add_to_bag' | 'purchase' | 'custom';
  /** CW27: the objective the slot learns against. Absent means `unit`. */
  objective?: Objective;
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
  measurementBasis?: MeasurementBasis;
  reward: string;
  /** CW27: what a success was worth when the counts were built. */
  objective?: Objective;
  level: number;
  level_words: string;
  n: number;
  s: number;
  p0: number;
  n0: number;
  p_hat: number;
  lift: number;
  gamma: number;
  /**
   * The score delta the learned lift actually caused, itemised the way every
   * other term in this engine is. A multiplicative term on an exactly zero base
   * causes nothing, and the receipt says so rather than claiming influence the
   * ranking never had (document 35 §3 N20). Absent on records written before
   * this term was itemised.
   */
  applied?: number;
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
  /** CW29: the journey stage the engine derived (early / mid / late), or `unknown`. Optional so older records and literals still type. */
  stage?: 'early' | 'mid' | 'late' | 'unknown';
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
 * applied. Page dependencies repeat per record; transport budgets count their
 * actual serialized bytes. The documents themselves are named by revision.
 */
export interface DecisionInputs {
  affinity: Record<string, Record<string, number>>;
  /** Effective page-wide choice inputs; absent only on older records. */
  replay?: {
    version: 1;
    /** Absence identifies retained pre-withdrawal exploration semantics. */
    exploration?: 'supported-only';
    /** Absence identifies retained sequential pins, independently of exploration. */
    pins?: 'reserved-eligible-v1' | 'prefix-reserved-v2';
    /** Absence retains tags-only scoring, independently of pins/exploration. */
    contentTypes?: 'catalog-tags-v1';
    /** Absence retains pre-governance selection independently of the other policies. */
    governance?: 'slot-gates-v1' | 'slot-gates-v2';
    learning: boolean;
    candidateLimit: number;
    slots: Array<{ slot: string; lift: number; prior: number }>;
  };
  regional_share?: Record<string, Record<string, number>>;
  external?: { version: string; scores: Record<string, number> };
  /** CW30: slot → item → times served to this visitor inside the slot's fatigue window, as read from the ring at decision time. */
  served?: Record<string, Record<string, number>>;
}

/** Doc 22 §3.1, one per served slot position. Emitted by CW4, persisted by CW19. */
export interface DecisionRecord {
  measurementBasis?: MeasurementBasis;
  /** Original decision time/identity remain unchanged. This is a client report, not verified visibility. */
  rendered?: { version: 1; eventId: string; at: number; pageInstance: string };
  retention?: import('@/retention').CaptureRetention;
  decision_id: string;
  request_id?: string;
  tenant: string;
  brand: string;
  visitor_id: string;
  session_id: string | null;
  identity_anchor: IdentityAnchor;
  ts: number;
  page: string;
  slot: string;
  position: number;
  /** Current pin policy only: ordinal within the ranked remainder; absent for pins. */
  ranking_position?: number;
  item_id: string;
  customer_item_id: string;
  candidates: SlotCandidate[];
  cell: Cell;
  /**
   * W16 C4 (R29, R32(1)): the journey stage this decision was made in, in the
   * shared vocabulary, and the identity of the published threshold revision
   * that derived it (null when none was in force). `cell.stage` keeps the
   * persisted token the learning statistics are keyed on; this is what a reader
   * — and the shopper's own receipt — is told. Absent when the engine did not
   * personalize, because then there is no derived stage to claim.
   */
  journey?: { stage: import('@/services/JourneyStage').JourneyWord; version: string | null };
  arm: Arm;
  /**
   * W21 E1.03: the experiment this record's arm belongs to, as the decision
   * path answered it. Written by the producer and stored and exported
   * unchanged; never reconstructed later from the then-current learn document,
   * which would stamp a record decided under an older salt with today's
   * experiment (F07 §5.7). Absent on records written before enrollment was
   * persistent, and absent where the shopper was not enrolled.
   */
  experiment?: EnrollmentProvenance;
  explored: boolean;
  authority: Authority;
  versions: DecisionVersions;
  /** The human-readable label of the configuration revision (doc 22 §12.1). */
  config_label: string;
  /** CW32: the products the served piece features, so an outcome naming one of them credits this decision, and a warehouse joins it to the product decision. */
  featured_product_ids?: string[];
  explain: {
    drivers: ContentDecision['explain']['drivers'];
    note?: string;
    score_base: number;
    /** The population prior's share of the base score, when one applied. */
    regional?: RegionalBlend & { contribution: number };
    /**
     * W16 C3/C7: what the arrival's context contributed to this candidate, when
     * the slot has a seed rule set. `applied` is measured where it lands — in the
     * final pre-lift base, after merchandising — so a candidate merchandised to
     * exactly zero records exactly zero. Present with `applied: 0` and no drivers
     * for a candidate the rules never named, absent when no rule set is
     * published. The rule-set version is the `slots` revision on `versions`.
     */
    contextual?: { applied: number; drivers: SeedDriver[] };
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
    /** CW29: the slot's stage rule on this piece, when it applied: the visitor's stage, the piece's fit, the delta it caused. */
    stage?: { visitor: StageWord; fit: StageWord[]; applied: number; sentence: string };
    /** CW30: the freshness bonus, when the slot has the dial and the piece a date. */
    freshness?: { ageDays: number; decay: number; applied: number; sentence: string };
    /** CW30: the fatigue penalty, when the slot has the dial and the ring showed the piece served before. */
    fatigue?: { served: number; windowHours: number; applied: number; sentence: string };
    /** CW33: the slot's diversity rule touched this position: the pieces that yielded to it, or that it was served despite (`relaxed`). */
    diversity?: { dimension: string; max: number; skipped: string[]; relaxed: boolean; sentence: string };
    /**
     * W20 G2 (R86(c)): this position's slot is pinned, served what it could and
     * still fell short of its `take`, leaving `empty` positions to the site's
     * own default. Present on every record the slot did write, so the receipt
     * can say it; a slot whose pin was REFUSED writes no record at all, and the
     * operator's slot-governance counter is that occurrence's only home.
     */
    shortTake?: { take: number; served: number; empty: number; sentence: string };
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
  /** W21 E1.03: the experiment this page's arm belongs to. Absent where the shopper is not enrolled. */
  experiment?: EnrollmentProvenance;
  cell: Cell;
  versions: DecisionVersions;
  config_label: string;
  /** Null when no trend was published for the tenant, the shopper is in the holdout, or the blend is off. */
  regional: RegionalBlend | null;
  decisions: Array<ContentDecision & { /** Exact receipt; an offer is not a durable render acknowledgment. */ decisionId?: string; renderOffer?: string }>;
  records: DecisionRecord[];
  /** Refused pins have no delivery decision or ledger row. */
  pinDiagnostics?: PinDiagnostic[];
  /**
   * W20 G2: the pinned slots that served and still could not fill their `take`
   * on this page load, with the positions left empty. Present only when there
   * is something to name; the decision path counts them for the operator, and
   * every record the slot wrote carries the same block on its `explain`.
   */
  shortTakes?: Array<{ slot: string; take: number; served: number; empty: number }>;
  /** A slot whose retained seed rule set the current contract refuses: ignored whole, never partially applied. */
  seedDiagnostics?: SeedDiagnostic[];
  /**
   * Advisory: the pieces a slot's published hard controls refused although the
   * slot could otherwise have served them, and the published pair that refused
   * each. Bounded and present only when there is something to name; never
   * serving authority and never carried on a stored record.
   */
  constraintDiagnostics?: ConstraintDiagnostics;
}

/**
 * One piece a slot's published hard controls refused, in the pattern of
 * `pinDiagnostics` and `seedDiagnostics`: refused configuration named, never a
 * fabricated delivery decision or ledger row. Only a piece that was OTHERWISE
 * ELIGIBLE for that slot is named — live, inside its window, in stock, and
 * naming the slot identifier in its own `slotTypes` — because a piece the slot
 * could never have served was not refused by the constraint, and naming it
 * would report the catalogue instead of the rule.
 */
export interface ConstraintDiagnostic {
  slot: string;
  contentId: string;
  reason: SlotConstraintReason;
  /** The published pair itself, for a refusal by an excluded tag. */
  dimension?: string;
  value?: string;
}

/**
 * The bounded channel those refusals travel on, in the cap idiom both existing
 * advisory channels already use (`catalogDiagnostics`, `slotDiagnostics`):
 * every refused eligible piece is counted, at most the first
 * `CONSTRAINT_WARNING_SAMPLE` are named — slot order, then catalogue order —
 * and the remainder is reported as omitted, because a market rule over a real
 * catalogue refuses thousands of pieces and an entry each would be an
 * unbounded payload on every decision.
 */
export interface ConstraintDiagnostics {
  warningCount: number;
  omittedWarningCount: number;
  warnings: ConstraintDiagnostic[];
}
