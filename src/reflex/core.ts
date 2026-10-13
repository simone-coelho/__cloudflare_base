// src/reflex/core.ts
// ─────────────────────────────────────────────────────────────────────────────
// ReflexCore — the pure heart of the Edge Affinity Reflex (doc 16 §4, §12).
//
// A deterministic, recency/frequency-weighted, time-DECAYED affinity engine:
// per catalog dimension (line, silhouette, occasion, …) it keeps a raw score
// per value and derives a normalized affinity a ∈ [0,1]. Shoppers ENTER an
// affinity audience when a crosses θ_in and EXIT when it decays below θ_out —
// the Dynamic-Yield-style "move in and out by behavior", made glass.
//
// Invariants (doc 16 §4 — what makes this an engine, not a demo trick):
//   • Store raw, read lazily. State is only (R, tLast) — NEVER pre-decayed.
//     Every read computes R_eff = R · exp(−Δt/τ) as a pure function of time.
//     Nothing mutates on a timer; replays are deterministic.
//   • The engine clock is authoritative — the HOST stamps `now` (client ts is
//     advisory); apply() never reads Date.now() itself.
//   • apply(state, input, now, config) → (state′, changes) is a PURE function:
//     no I/O, no ambient state. It is the testing seam and the portability
//     seam (request path today → ShopperReflex DO in P2, unchanged).
//
// NO ML. Where real ML belongs (propensity/churn) it lives in ODP predictive
// insights; discovery/suggestion belongs to Opal. This module is math.
// ─────────────────────────────────────────────────────────────────────────────

/** One catalog axis affinity is computed on. Catalog-agnostic by construction (D-6). */
export interface DimensionSpec {
  /** Dimension key, e.g. 'line' | 'silhouette' | 'occasion' | 'priceBand'. */
  key: string;
  /** Product field the value(s) come from, e.g. 'line' or 'price_usd'. */
  source: string;
  /** The field is an array (e.g. occasion[]) — each entry is touched. */
  multi?: boolean;
  /** Derived dimension: bucket a numeric source into labeled bands. */
  derive?: 'band';
  /** Band cut points (ascending), e.g. [150, 400]. */
  cuts?: number[];
  /** Band labels, length = cuts.length + 1, e.g. ['entry','core','elevated']. */
  labels?: string[];
  /** Per-dimension overrides of the global tuning (τ/K/θ). */
  tauMs?: number;
  K?: number;
  thetaIn?: number;
  thetaOut?: number;
}

/** Versioned engine tuning. Lives in config/KV — tuning is never a redeploy. */
export interface ReflexConfig {
  version: string;
  dimensions: DimensionSpec[];
  /** Action → accumulation weight. Unknown actions weigh 0 (still re-evaluate). */
  weights: Record<string, number>;
  /** Global decay half-life-ish time constant τ (ms): R_eff = R·exp(−Δt/τ). */
  tauMs: number;
  /** Saturation midpoint: a = R/(R+K) → a=0.5 at R=K. */
  K: number;
  /** Enter threshold (a ≥ θ_in enters). */
  thetaIn: number;
  /** Exit threshold (a < θ_out exits). θ_out < θ_in = hysteresis, no flapping. */
  thetaOut: number;
  /** Prune floor: entries whose R_eff falls below this are dropped. */
  epsilon: number;
  /** Safety cap on distinct values tracked per dimension (evict weakest). */
  maxValuesPerDim: number;
  /**
   * Where a product event's touches come from when the product is not in a
   * catalog this engine holds. `catalog-only` (the default, and the demo
   * surfaces' posture) drops it. `event-when-unknown` scores the attributes the
   * event itself carries, bounded to the registry's dimensions, which is what a
   * customer's site needs: their events, their catalog, not a copy of it here.
   */
  eventAttributes?: 'catalog-only' | 'event-when-unknown';
  /**
   * W16 C4 (R32(1)): the tenant's published journey threshold set. It rides
   * this document because the document is already tenant-scoped, versioned,
   * read by both hosts and pinned into one coherent publication set, so a
   * receipt can name the revision that derived a stage without a fourth kind.
   * Absent means no thresholds are in force and the engine reports the first
   * stage of the journey with a diagnostic — never an invented threshold.
   */
  journey?: import('@/services/JourneyStage').JourneyThresholds;
  /**
   * W16 C6 (R32(1), R48): the tenant's published anonymous return-continuity
   * block. It rides this document for the same reason the journey thresholds
   * do — the document is already tenant-scoped, versioned, read by both hosts
   * and pinned into one coherent publication set, so a recognition descriptor
   * can name the revision it was issued under without a fourth document kind.
   *
   * ABSENT IS THE SHIPPED STATE. There is no compiled default mode, window or
   * covered purpose anywhere in this engine: the production values and the
   * per-purpose retention approval are an owner decision, and an engine that
   * has published nothing recognizes nobody. A block that is present but not
   * COMPLETE — a transport outside the vocabulary, a window that is not a
   * finite positive number, no covered purpose, or a retention approval that
   * is not exactly true — also recognizes nobody. Both are fail-closed.
   */
  continuity?: ContinuitySettings;
  /**
   * P39 (decisions D1, D2): the tenant's suppression settings — negative
   * preference as a per-shopper suppression with an expiry, never a negative
   * weight. Validated with the rest of the document (`validateReflexConfig`).
   * ABSENT IS THE SHIPPED STATE: nothing is ever suppressed, and every action
   * and every decision is exactly what it was before the member existed.
   */
  suppression?: SuppressionSettings;
  /**
   * P12 (decision D2): the forms the tenant's account identifier takes, each the
   * source of a regular expression anchored at both ends. Validated with the rest
   * of the document (`validateReflexConfig`). ABSENT IS THE SHIPPED STATE: a link
   * accepts any account identifier exactly as it did before the member existed.
   * Present, a link whose own account identifier matches none of the declared
   * forms is refused, naming the format, and merges nothing.
   */
  accountIdFormat?: AccountIdFormat;
}

/**
 * P12. The declared forms of a tenant's account identifier; at least one. Each
 * value is the source of a regular expression that begins with `^` and ends with
 * `$`, and the identifier must match one form whole.
 */
export interface AccountIdFormat {
  /** The identifier the site assigns at a shopper's first landing, before an e-mail address is known. */
  firstLanding?: string;
  /** The identifier the site derives from the shopper's e-mail address (a hash of it). */
  hashedEmail?: string;
}

/**
 * P39. The suppression settings a tenant publishes on its registry document.
 *
 * `actions` names the actions that suppress: each suppresses, for the shopper,
 * every registry value it carries, for its window in `days`. `purchase`, when
 * present, makes the purchase rule active: a purchase strengthens every value it
 * carries at the purchase weight as before, and suppresses the value it carries
 * on the dimension keyed `productType` for its window. A window is a positive
 * whole number of days; absent, the default of 30 (decision D2).
 */
export interface SuppressionSettings {
  actions?: Record<string, SuppressionWindow>;
  purchase?: SuppressionWindow;
}

/** P39: one window of the suppression settings, in whole days; absent is the default. */
export interface SuppressionWindow {
  days?: number;
}

/**
 * P39. One suppression of one value for one shopper, as the shopper's reflex
 * state holds it and as a decision record and a receipt carry it: keys sorted.
 * While it is in force the value contributes no interest term to any score of
 * the content decision; the stored interest is not changed, and at `expiresAt`
 * (epoch milliseconds) it lapses.
 */
export interface Suppression {
  /** The action that recorded it (`remove_from_cart`, or the purchase's own action). */
  action: string;
  /** The registry dimension the value is on. */
  dimension: string;
  /** When it lapses, in epoch milliseconds. */
  expiresAt: number;
  /** The suppressed value, as the registry placed it (a governed value is its mapped id). */
  value: string;
}

/**
 * W16 C6. A published return-continuity configuration.
 *
 * `mode` is the transport the long recognition proof takes: `direct` hands it
 * to the caller, `broker` keeps it in the first-party cookie and never puts it
 * in a response body. `windowMs` is the descriptor's WHOLE life, fixed at issue
 * and never extended by browsing, renewal or rotation. `purpose` is the covered
 * purpose the credential is bound to, and `retentionApproved` records that that
 * purpose carries a retention approval of its own — a session consent record
 * approves none (HANDOFF-2026-09-18 §12).
 */
export interface ContinuitySettings {
  mode: 'direct' | 'broker';
  windowMs: number;
  purpose: string;
  retentionApproved: boolean;
}

/** Raw per-value accumulator — s is NEVER pre-decayed; t is the last touch. */
export interface ReflexEntry {
  s: number;
  t: number;
}

/** JSON-safe per-shopper state. Rides the session in P0; ctx.storage in P2. */
export interface ReflexState {
  v: 1;
  /** dims[dimensionKey][originalValue] → (raw score, last-touch ms). */
  dims: Record<string, Record<string, ReflexEntry>>;
  /** Current audience memberships (audience keys), sorted for determinism. */
  audiences: string[];
  /** ReflexConfig.version this state was last evaluated under. */
  configVersion: string;
  /**
   * P10 (decision D1): the shopper's count of SIGNALS — every action applied to
   * this state whose own behaviour weight (`ReflexConfig.weights`) is above
   * zero. An impression, a tick, a page view and any other action weighted 0
   * count for nothing. Written only once a signal has been recorded, so the
   * state of a shopper with no signals carries exactly the members it carried
   * before; absent reads as 0 (`signalsOf`). Never decayed: a returning
   * shopper's earlier visits count.
   */
  signals?: number;
  /**
   * P40 (R-P48): the orders this shopper's purchases have named, oldest first,
   * each as `[order key, event id]`: the key is the digest the ledger derives
   * from the order id (`orderKeyOf`, src/ledger/records.ts), never the order id
   * itself, and the event id is the one the recording purchase carried ('' when
   * it carried none). At most MAX_ORDERS are kept, the oldest forgotten first.
   * Written only once a purchase names an order, so the state of a shopper who
   * has never named one carries exactly the members it carried before; carried
   * unchanged through every apply.
   */
  orders?: Array<[string, string]>;
  /**
   * P39 (decision D1): the suppressions in force on this shopper, each with its
   * expiry, sorted by dimension then value, one per dimension and value. Written
   * only once an action the tenant's settings name has recorded one, and dropped
   * again once every one has lapsed, so the state of a shopper with none carries
   * exactly the members it carried before; carried through every apply, a lapsed
   * one pruned there.
   */
  suppressions?: Suppression[];
}

/** P40: the most orders one shopper's state remembers. */
export const MAX_ORDERS = 64;

// ── P39: suppression with an expiry (decisions D1, D2) ──────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** P39 (decision D2): the window of a setting that names no `days`. */
export const DEFAULT_SUPPRESSION_DAYS = 30;
/** P39: the longest window a setting may publish, so every expiry stays a safe whole number of milliseconds. */
export const MAX_SUPPRESSION_DAYS = 36_500;
/** P39: the most suppressions one shopper's state holds; past it the earliest to lapse is dropped first. */
export const MAX_SUPPRESSIONS = 64;
/** P39: the registry dimension whose value the purchase rule suppresses (the bought product type). */
export const PURCHASE_SUPPRESSED_DIMENSION = 'productType';
/**
 * P39: the actions that are a purchase — the actions whose reward is a purchase
 * (`src/ledger/records.ts`, the rows P40's order uniqueness reads), so the
 * purchase rule runs for exactly the events P40 deduplicates, after them.
 */
export const PURCHASE_ACTIONS: ReadonlySet<string> = new Set(['purchase', 'checkout', 'order_complete']);

/**
 * P39: the window a setting publishes, in whole days: its `days`, or the
 * default when it names none. Null for a setting that is not a window, or a
 * `days` that is not a positive whole number up to MAX_SUPPRESSION_DAYS — the
 * same rule the validator refuses by name, so a window the engine cannot read
 * suppresses nothing.
 */
export function suppressionDays(window: unknown): number | null {
  if (window === null || typeof window !== 'object' || Array.isArray(window)) return null;
  const days = (window as SuppressionWindow).days;
  if (days === undefined) return DEFAULT_SUPPRESSION_DAYS;
  return typeof days === 'number' && Number.isSafeInteger(days) && days >= 1 && days <= MAX_SUPPRESSION_DAYS ? days : null;
}

function isSuppression(value: unknown): value is Suppression {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  return typeof s.action === 'string' && s.action !== '' && typeof s.dimension === 'string' && s.dimension !== ''
    && typeof s.value === 'string' && s.value !== '' && typeof s.expiresAt === 'number' && Number.isFinite(s.expiresAt) && s.expiresAt >= 0;
}

const byDimensionThenValue = (a: Suppression, b: Suppression): number =>
  a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0;

/**
 * P39: two lists of suppressions as one. Per dimension and value the later
 * `expiresAt` stands, with the action that recorded it, whichever list holds
 * it; on an equal expiry the entry of `own` is kept. So a second action never
 * shortens a suppression, and a link never shortens one or lengthens one beyond
 * what an action recorded. Each entry is copied with its keys sorted; the
 * result is sorted by dimension then value, and holds at most MAX_SUPPRESSIONS,
 * the earliest to lapse dropped first.
 */
export function mergeSuppressions(own: readonly Suppression[], carried: readonly Suppression[]): Suppression[] {
  const held = new Map<string, Suppression>();
  for (const entry of [...own, ...carried]) {
    if (!isSuppression(entry)) continue;
    const key = JSON.stringify([entry.dimension, entry.value]);
    const kept = held.get(key);
    if (!kept || entry.expiresAt > kept.expiresAt) {
      held.set(key, { action: entry.action, dimension: entry.dimension, expiresAt: entry.expiresAt, value: entry.value });
    }
  }
  let merged = [...held.values()];
  if (merged.length > MAX_SUPPRESSIONS) {
    merged = merged.sort((a, b) => b.expiresAt - a.expiresAt || byDimensionThenValue(a, b)).slice(0, MAX_SUPPRESSIONS);
  }
  return merged.sort(byDimensionThenValue);
}

/**
 * P39: the suppressions a value says it holds that are in force at `now` — well
 * formed, lapsing after `now` — merged by the rule above. Anything that is not
 * a list of suppressions is none: a member the engine cannot read suppresses
 * nothing and never fails a read.
 */
export function suppressionsInForce(raw: unknown, now: number): Suppression[] {
  if (!Array.isArray(raw)) return [];
  return mergeSuppressions([], (raw as unknown[]).filter((entry): entry is Suppression => isSuppression(entry) && entry.expiresAt > now));
}

/**
 * P39: the suppressions one action records under the tenant's settings at
 * `now`, each expiring its window after the action. An action the settings
 * name suppresses every registry value it carries; a purchase, under an active
 * purchase rule, suppresses the value it carries on the dimension keyed
 * `productType`. The touches are the ones the host placed — a governed value is
 * already its mapped id (P38) — and only registry dimensions are read. No
 * settings, or an action they do not name: none.
 */
export function suppressionsRecorded(config: Pick<ReflexConfig, 'suppression' | 'dimensions'>, input: ReflexInput, now: number): Suppression[] {
  const settings = config.suppression;
  if (!settings || typeof settings !== 'object') return [];
  const recorded: Suppression[] = [];
  const record = (touch: Touch, days: number) => {
    if (!touch.value || !config.dimensions.some((spec) => spec.key === touch.dim)) return;
    recorded.push({ action: input.action, dimension: touch.dim, expiresAt: now + days * DAY_MS, value: touch.value });
  };
  const actions = settings.actions;
  if (actions && typeof actions === 'object' && Object.hasOwn(actions, input.action)) {
    const days = suppressionDays(actions[input.action]);
    if (days !== null) for (const touch of input.touches) record(touch, days);
  }
  if (settings.purchase !== undefined && PURCHASE_ACTIONS.has(input.action)) {
    const days = suppressionDays(settings.purchase);
    if (days !== null) for (const touch of input.touches) if (touch.dim === PURCHASE_SUPPRESSED_DIMENSION) record(touch, days);
  }
  return mergeSuppressions([], recorded);
}

/**
 * P39 (R-P60): whether the tenant's settings name this action as one that
 * suppresses (an entry under `suppression.actions` with a readable window), so a
 * door that drops a weight-0 action lets this one through to record its
 * suppressions, and drops every other weight-0 action as before.
 */
export function isSuppressingAction(config: Pick<ReflexConfig, 'suppression'>, action: string): boolean {
  const actions = config.suppression?.actions;
  return !!actions && typeof actions === 'object' && Object.hasOwn(actions, action) && suppressionDays(actions[action]) !== null;
}

/**
 * P39: an interest view with the interest of every suppressed value left out,
 * so a suppressed value contributes no interest term to a score; the stored
 * interest is not changed (the view is a copy). The view itself, untouched,
 * when nothing it holds is suppressed.
 */
export function withoutSuppressed<T extends { dims: Record<string, Record<string, number>> }>(view: T, suppressions: readonly Suppression[]): T;
export function withoutSuppressed<T extends { dims: Record<string, Record<string, number>> }>(view: T | null | undefined, suppressions: readonly Suppression[]): T | null | undefined;
export function withoutSuppressed<T extends { dims: Record<string, Record<string, number>> }>(view: T | null | undefined, suppressions: readonly Suppression[]): T | null | undefined {
  if (!view || !suppressions.length) return view;
  let dims: Record<string, Record<string, number>> | null = null;
  for (const s of suppressions) {
    const values = (dims ?? view.dims)[s.dimension];
    if (!values || !Object.hasOwn(values, s.value)) continue;
    dims ??= { ...view.dims };
    const rest = { ...values };
    delete rest[s.value];
    if (Object.keys(rest).length) dims[s.dimension] = rest;
    else delete dims[s.dimension];
  }
  return dims ? { ...view, dims } : view;
}

/**
 * P40 (R-P48): whether a purchase naming this order key is a SECOND purchase of
 * an order the state has recorded: recorded under another event, or under none.
 * The recording event delivered again is not one (it re-answers with its own
 * record), and a purchase that names no order (`order` null) never is.
 */
export function isDuplicateOrder(state: Pick<ReflexState, 'orders'> | null | undefined, order: string | null, eventId: string | undefined): boolean {
  const held = state?.orders;
  return order !== null && Array.isArray(held)
    && held.some(entry => Array.isArray(entry) && entry[0] === order && (entry[1] === '' || entry[1] !== eventId));
}

/**
 * P40 (R-P48): the state with this purchase's order recorded once, beside the
 * event that recorded it; the oldest is forgotten past MAX_ORDERS. No order:
 * the state exactly as given (absent stays absent). An order with no state to
 * hold it starts from the empty state of `config`, as the first event of a
 * shopper does; a held state needs no configuration (R-P58: the buffered door
 * remembers an order in the state it already holds).
 */
export function withOrder(state: ReflexState, order: string | null, eventId: string | undefined, config?: ReflexConfig): ReflexState;
export function withOrder(state: ReflexState | null | undefined, order: string | null, eventId: string | undefined, config?: ReflexConfig): ReflexState | undefined;
export function withOrder(state: ReflexState | null | undefined, order: string | null, eventId: string | undefined, config?: ReflexConfig): ReflexState | undefined {
  if (order === null) return state ?? undefined;
  const base = state && state.v === 1 ? state : config ? emptyState(config) : undefined;
  if (!base) return state ?? undefined;
  const held = Array.isArray(base.orders) ? base.orders : [];
  if (held.some(entry => Array.isArray(entry) && entry[0] === order)) return base;
  return { ...base, orders: [...held, [order, eventId ?? '']].slice(-MAX_ORDERS) as Array<[string, string]> };
}

/**
 * P10: the count of signals a state holds, as a whole number. Absent, or a value
 * that is not a nonnegative safe integer, is 0: a count the engine cannot trust
 * is no evidence of signals.
 */
export function signalsOf(state: Pick<ReflexState, 'signals'> | null | undefined): number {
  const n = state?.signals;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** P10: the state with its count member, written only when there is a signal to count. */
export function withSignals<T extends ReflexState>(state: T, signals: number): T {
  const { signals: _held, ...rest } = state; void _held;
  return (signals > 0 ? { ...rest, signals: Math.min(signals, Number.MAX_SAFE_INTEGER) } : rest) as T;
}

/** A single (dimension, value) hit extracted from a product interaction. */
export interface Touch {
  dim: string;
  value: string;
}

/** What the host feeds apply(): a normalized action + its catalog touches. */
export interface ReflexInput {
  action: string;
  touches: Touch[];
}

/** Why a membership changed — the glass-box record (doc 16 §12). */
export interface ExplainRecord {
  ts: number;
  audience: string;
  dim: string;
  value: string;
  direction: 'enter' | 'exit';
  /** Affinity a at the moment of the transition (0 if pruned to nothing). */
  score: number;
  thetaIn: number;
  thetaOut: number;
  /** The action that triggered evaluation ('tick' = time-only re-eval). */
  trigger: string;
  configVersion: string;
}

export interface ReflexChanges {
  entered: string[];
  exited: string[];
  explain: ExplainRecord[];
}

export interface ReflexResult {
  state: ReflexState;
  changes: ReflexChanges;
}

/** Live affinity snapshot for the client instrument (original value names). */
export interface AffinitySnapshot {
  dims: Record<string, Record<string, number>>;
  audiences: string[];
}

// ── Naming (single source of truth — the P1 generator imports these) ─────────

/** Lowercase slug: non-alphanumerics collapse to '_'. 'Date-Night' → 'date_night'. */
export function slugValue(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Dimension-namespaced audience key: 'line' + 'Tabby' → 'line_tabby_affinity'. */
export function audienceKey(dim: string, value: string): string {
  return `${slugValue(dim)}_${slugValue(value)}_affinity`;
}

/** Flattened attribute key for evaluateCondition: 'line_affinity.tabby'. */
export function affinityAttrKey(dim: string, value: string): string {
  return `${slugValue(dim)}_affinity.${slugValue(value)}`;
}

// ── Default config (demo tuning per doc 16 §4 — production retunes via KV) ───

export const DEFAULT_REFLEX_CONFIG: ReflexConfig = {
  version: 'reflex-demo-v1',
  dimensions: [
    { key: 'line', source: 'line' },
    { key: 'category', source: 'category' },
    { key: 'subcategory', source: 'subcategory' },
    { key: 'silhouette', source: 'silhouette' },
    { key: 'occasion', source: 'occasion', multi: true },
    // Price bands match the existing cuts (CatalogService.priceBandOf): <150 / <400 / rest.
    // Price POSTURE is a slower-moving trait than product interest, and that RELATION is
    // the tuning, not the absolute number: this dimension's horizon is 2.5× the global one
    // (R50(a)), so it still accumulates across human-paced browsing and still outlasts
    // interest in any one product, whatever the global horizon is retuned to.
    { key: 'priceBand', source: 'price_usd', derive: 'band', cuts: [150, 400], labels: ['entry', 'core', 'elevated'], tauMs: 35 * 24 * 60 * 60 * 1000 },
    // CW3. The content type a shopper engages with (video, editorial, on-model,
    // silo), read off content events. Mandeep named it by name: "content-type
    // affinity learnable, e.g. video affinity". Sourced from the SDK's
    // contentType attribute; the sanitizer admits it because this entry exists.
    { key: 'contentType', source: 'contentType' },
  ],
  weights: {
    // Views build affinity 1:1; intent actions weigh heavier (doc 16 §4 table).
    product_view: 1,
    pdp_view: 1,
    view_product: 1,
    wishlist: 2,
    wishlist_add: 2,
    add_to_wishlist: 2,
    save_for_later: 2,
    add_to_cart: 3,
    cart_add: 3,
    purchase: 5,
    checkout: 5,
    order_complete: 5,
    // CW3: content interactions, on the same scale. Impression is ZERO by
    // default: dense and involuntary, it must not read as interest. See
    // contentTelemetry.ts for the reasoning behind each number.
    content_impression: 0,
    content_dwell: 0.5,
    content_click: 1,
    video_complete: 2,
    // P40: the viewable impression weighs 0 (decision D1, enforced by weightOf
    // below whatever a registry says); the video view at three seconds is a
    // content action of weight 1, under the tenant's own weight once published.
    content_viewable: 0,
    video_view: 1,
    // Time-only re-evaluation (alarms / no-product events): no accumulation.
    tick: 0,
  },
  // THE SHIPPED MEMORY HORIZON (W16 C8, ruling R42). Document 35 §5 W16 asks the
  // product to remember across DAYS AND WEEKS — tapestry_requirements.txt line 152,
  // Return Visit Recognition: "Picks up where you left off, remembers what you were
  // considering". This constant is what an untuned tenant gets, so it IS the product's
  // memory, and the engine's own definition of forgetting is the ε-prune in apply():
  // an interest three views deep decays to nothing in minutes under a 60-second τ, so
  // a shopper returning the next day was met as a stranger. Fourteen days is a
  // documented ENGINEERING default, not a customer calibration — the production number
  // is an open owner input (HANDOFF-2026-09-18 §8) and is set as published, versioned
  // configuration on the reflex document, never here. Audience membership follows this
  // same horizon: hysteresis has no τ of its own (R50(b)), so a shopper now leaves an
  // affinity audience on the same days/weeks clock her interest fades on, instead of
  // forty seconds after she stops clicking. The demo's own brisk cadence lives in the
  // fixtures that script it (src/reflex/core.test.ts), not in the shipped default.
  tauMs: 14 * 24 * 60 * 60 * 1000,
  K: 1.8,
  thetaIn: 0.6,
  thetaOut: 0.45,
  epsilon: 1e-4,
  maxValuesPerDim: 24,
};

// ── Pure math ─────────────────────────────────────────────────────────────────

interface DimParams {
  tauMs: number;
  K: number;
  thetaIn: number;
  thetaOut: number;
}

function dimParams(config: ReflexConfig, spec: DimensionSpec | undefined): DimParams {
  return {
    tauMs: spec?.tauMs ?? config.tauMs,
    K: spec?.K ?? config.K,
    thetaIn: spec?.thetaIn ?? config.thetaIn,
    thetaOut: spec?.thetaOut ?? config.thetaOut,
  };
}

function specOf(config: ReflexConfig, dim: string): DimensionSpec | undefined {
  return config.dimensions.find((d) => d.key === dim);
}

/** Lazily-decayed effective score at `now`. Pure; never stored. */
export function effectiveScore(entry: ReflexEntry, now: number, tauMs: number): number {
  const dt = Math.max(0, now - entry.t);
  return entry.s * Math.exp(-dt / tauMs);
}

/** Saturating normalization: a = R/(R+K) ∈ [0,1). */
export function affinityOf(effScore: number, K: number): number {
  return effScore <= 0 ? 0 : effScore / (effScore + K);
}

export function emptyState(config: ReflexConfig): ReflexState {
  return { v: 1, dims: {}, audiences: [], configVersion: config.version };
}

/**
 * Extract the (dimension, value) touches a product interaction produces,
 * per the configured dimensions. Catalog-agnostic: reads spec.source fields
 * off any product-shaped object; unknown/empty fields simply produce nothing.
 */
export function extractTouches(product: Record<string, unknown>, config: ReflexConfig): Touch[] {
  const touches: Touch[] = [];
  for (const spec of config.dimensions) {
    const raw = product[spec.source];
    if (raw === undefined || raw === null) continue;

    if (spec.derive === 'band') {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n) || !spec.cuts || !spec.labels) continue;
      let idx = spec.cuts.findIndex((cut) => n < cut);
      if (idx === -1) idx = spec.cuts.length;
      const label = spec.labels[idx];
      if (label) touches.push({ dim: spec.key, value: label });
      continue;
    }

    if (spec.multi && Array.isArray(raw)) {
      for (const v of raw) {
        if (typeof v === 'string' && v.trim()) touches.push({ dim: spec.key, value: v });
      }
      continue;
    }

    if (typeof raw === 'string' && raw.trim()) {
      touches.push({ dim: spec.key, value: raw });
    }
  }
  return touches;
}

/** The most values a single multi-valued attribute may contribute from one event. */
const MAX_EVENT_VALUES = 8;
const MAX_EVENT_VALUE_LENGTH = 64;

/**
 * Only what the registry names, only in the shape it names. A string is
 * trimmed and capped; an array is capped; a band source must already be
 * numeric or numeric-looking. Nothing else on the event is looked at.
 */
export function sanitizeEventAttributes(data: Record<string, unknown>, config: ReflexConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const clean = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim().slice(0, MAX_EVENT_VALUE_LENGTH);
    // eslint-disable-next-line no-control-regex -- Reject control characters in event attributes.
    return t && !/[\u0000-\u001f<>]/.test(t) ? t : null;
  };
  for (const spec of config.dimensions) {
    const raw = data[spec.source];
    if (raw === undefined || raw === null) continue;
    if (spec.derive === 'band') {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(n)) out[spec.source] = n;
      continue;
    }
    if (spec.multi && Array.isArray(raw)) {
      const vals = raw.map(clean).filter((x): x is string => x !== null).slice(0, MAX_EVENT_VALUES);
      if (vals.length) out[spec.source] = vals;
      continue;
    }
    const one = clean(Array.isArray(raw) ? raw[0] : raw);
    if (one !== null) out[spec.source] = one;
  }
  return out;
}

/**
 * The vocabulary a tenant's own published catalogue data names (W16 C8, R47).
 *
 * It is never a list written here. It is derived, per tenant, from the catalogue
 * this engine actually decides from: the values the tenant's published content
 * catalogue tags carry, dimension by dimension, plus the ids and registry-sourced
 * attribute values of the product catalogue that tenant holds when it holds one.
 * A tenant that publishes a different taxonomy gets a different vocabulary with
 * no code change, which is the whole point.
 */
export interface CatalogVocabulary {
  /** Product ids the tenant's published catalogue data names. */
  ids: ReadonlySet<string>;
  /** Registry dimension key → the values that catalogue data names on it. */
  values: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * What the engine could and could not place in ONE event (W16 C8.03, R64).
 *
 * `recognized` is true when at least one value on the event built taste, so a
 * partly placeable event is reported for what it is rather than refused whole.
 * `unrecognized` names EVERY product this event referred to that the engine
 * could not place — the primary reference and each `items[]` id of an order —
 * whatever else on the event was placed, so an operator can tell WHICH input
 * went unrecognized instead of reading a bare counter.
 */
export interface RecognitionSignals {
  recognized: boolean;
  unrecognized: string[];
}

/** Recognized, with nothing to report. */
export const RECOGNIZED: RecognitionSignals = { recognized: true, unrecognized: [] };

/** A tenant that has published no catalogue data names no vocabulary. */
export const EMPTY_VOCABULARY: CatalogVocabulary = { ids: new Set<string>(), values: new Map() };

const REFERENCE_KEYS = ['productId', 'product_id', 'sku'] as const;

function referenceOf(raw: unknown): string | null {
  if (typeof raw === 'string') { const trimmed = raw.trim(); return trimmed === '' ? null : trimmed; }
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

/** The product an event refers to first, under the three spellings both hosts accept. */
export function productReferenceOf(data: Record<string, unknown>): string | null {
  for (const key of REFERENCE_KEYS) {
    const found = referenceOf(data[key]);
    if (found !== null) return found;
  }
  return null;
}

/**
 * EVERY product this event refers to, in the order it names them: the primary
 * reference and, for an order, each line item's own. R64/F4: an order whose only
 * reference lives in `items[]` must still be able to say which product the
 * engine could not place.
 */
export function productReferencesOf(data: Record<string, unknown>): string[] {
  const found: string[] = [];
  const add = (value: string | null) => { if (value !== null && !found.includes(value)) found.push(value); };
  add(productReferenceOf(data));
  const items = data.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const row = item as Record<string, unknown>;
      for (const key of REFERENCE_KEYS) add(referenceOf(row[key]));
    }
  }
  return found;
}

/**
 * R64, per value: a dimension the tenant's catalogue NAMES values on is
 * authority over that dimension, so a value outside it builds no taste whatever
 * else the same event carries. A dimension the catalogue names nothing on is
 * authority over nothing there, so every value on it stands — a tenant whose
 * published data tags only a line cannot thereby refuse every category its
 * shoppers browse.
 *
 * Exported (W16 C8.09/C8.10, R64/R67) because it is THE rule, and every ingest
 * path applies it: the live and buffered product paths reach it through
 * `placeEvent` below, and the two paths that reach the registry directly —
 * content telemetry (`src/reflex/contentTelemetry.ts`) and historical import
 * (`src/identity/history.ts`) — call it on the touches they built. One rule,
 * one implementation, so no ingest door can drift into a second vocabulary.
 */
export function admittedTouches(touches: Touch[], vocabulary: CatalogVocabulary): Touch[] {
  return touches.filter((touch) => {
    const named = vocabulary.values.get(touch.dim);
    return named === undefined || named.size === 0 || named.has(touch.value);
  });
}

/** What one event builds and what it could not place, decided together. */
export interface PlacedEvent {
  /** The touches it may build: its own values, minus the ones this tenant refuses. */
  touches: Touch[];
  /** The diagnostic the answer carries. */
  signals: RecognitionSignals;
}

/**
 * Place ONE event against the tenant's own catalogue (W16 C8.03/C8.08, R47, R64).
 *
 * A product this engine holds always wins, because its attributes are ours to
 * trust. Without one, the event's own attributes count only where the scope has
 * said so (`event-when-unknown`), and only through the registry — and then each
 * value answers for itself against the vocabulary above. The taste and the
 * diagnostic are derived from the same pass, so the answer and the affinity can
 * never tell two different stories about the same input.
 */
export function placeEvent(
  data: Record<string, unknown>,
  product: Record<string, unknown> | undefined,
  config: ReflexConfig,
  vocabulary: CatalogVocabulary,
): PlacedEvent {
  const touches = product
    ? extractTouches(product, config)
    : config.eventAttributes === 'event-when-unknown'
      ? admittedTouches(extractTouches(sanitizeEventAttributes(data, config), config), vocabulary)
      : [];
  const primary = productReferenceOf(data);
  const unrecognized = productReferencesOf(data).filter((id) =>
    !vocabulary.ids.has(id) && !(product !== undefined && id === primary));
  return { touches, signals: { recognized: touches.length > 0, unrecognized } };
}

/**
 * Whether placing this event needs the tenant's vocabulary READ at all. When it
 * does not, the caller passes EMPTY_VOCABULARY and `placeEvent` answers exactly
 * the same thing without a document read: a held product whose only reference is
 * its own is placed by the catalogue that holds it, and an event that names no
 * product and carries no registry value has nothing to place either way. Pure,
 * so an ingest host can ask before it awaits.
 */
export function needsCatalogVocabulary(
  data: Record<string, unknown>,
  product: Record<string, unknown> | undefined,
  config: ReflexConfig,
): boolean {
  const references = productReferencesOf(data);
  if (references.length > (product === undefined ? 0 : 1)) return true;
  if (references.length === 1 && product === undefined) return true;
  if (product !== undefined) return false;
  return config.eventAttributes === 'event-when-unknown'
    && extractTouches(sanitizeEventAttributes(data, config), config).length > 0;
}

/** The diagnostic `POST /realtime/action` answers, on both hosts (W16 C8.03, R21). */
export function recognizeEvent(
  data: Record<string, unknown>,
  product: Record<string, unknown> | undefined,
  config: ReflexConfig,
  vocabulary: CatalogVocabulary,
): RecognitionSignals {
  return placeEvent(data, product, config, vocabulary).signals;
}

/**
 * The touches a product event contributes, for the callers that want only those.
 * Without a vocabulary it is the pre-R47 behavior, unchanged; with one, R64's
 * per-value rule applies.
 */
export function touchesForEvent(
  data: Record<string, unknown>,
  product: Record<string, unknown> | undefined,
  config: ReflexConfig,
  vocabulary?: CatalogVocabulary,
): Touch[] {
  return placeEvent(data, product, config, vocabulary ?? EMPTY_VOCABULARY).touches;
}

/**
 * THE core transition — pure and deterministic:
 *   (state, input, now, config) → (state′, changes)
 *
 * 1. Decay-then-accumulate every touched (dim, value): R ← R·exp(−Δt/τ) + w.
 * 2. Prune entries whose effective score fell below ε (state stays tiny).
 * 3. Re-evaluate ALL memberships with hysteresis (enter ≥ θ_in; exit < θ_out).
 *    Exits happen on ANY apply — including weight-0 'tick' — so time alone
 *    moves shoppers out (the request path evaluates lazily; the DO adds
 *    exact-time alarms in P2 using nextCrossing()).
 * 4. Emit an ExplainRecord per transition (the glass box).
 * 5. P10 (decision D1): count the action as a SIGNAL when its own behaviour
 *    weight is above zero (`isSignal`), whatever touches it carried; a
 *    weight-0 action (an impression, a tick, a page view) keeps the count
 *    where it is. Both shopper hosts apply every action through this one step,
 *    so the count is the same on either.
 * 6. P39 (decisions D1, D2): record, under the tenant's suppression settings,
 *    a suppression with its expiry for each value the action carries, and
 *    carry the ones in force (`suppressionsRecorded`, `mergeSuppressions`).
 *    The same one step on both hosts, so a shopper's suppressions are the same
 *    on either; the accumulation above is untouched by them.
 *
 * The previous state object is never mutated.
 */
export function apply(
  prev: ReflexState | undefined | null,
  input: ReflexInput,
  now: number,
  config: ReflexConfig
): ReflexResult {
  const base = prev && prev.v === 1 ? prev : emptyState(config);
  const weight = weightOf(config, input.action);

  // Copy-on-write: fresh dim maps; entries are replaced, never mutated.
  const dims: ReflexState['dims'] = {};
  for (const d of Object.keys(base.dims)) dims[d] = { ...base.dims[d] };

  // 1. Decay-then-accumulate the touches.
  if (weight > 0) {
    for (const touch of input.touches) {
      if (!touch.value) continue;
      const spec = specOf(config, touch.dim);
      if (!spec) continue; // unconfigured dimension — ignore
      const p = dimParams(config, spec);
      const dimMap = (dims[touch.dim] = dims[touch.dim] ?? {});
      const prevEntry = dimMap[touch.value];
      const carried = prevEntry ? effectiveScore(prevEntry, now, p.tauMs) : 0;
      dimMap[touch.value] = { s: carried + weight, t: now };
    }
  }

  // 2. Prune dead entries + enforce the per-dimension cap (deterministic).
  for (const d of Object.keys(dims)) {
    const p = dimParams(config, specOf(config, d));
    const dimMap = dims[d];
    for (const v of Object.keys(dimMap)) {
      if (effectiveScore(dimMap[v], now, p.tauMs) < config.epsilon) delete dimMap[v];
    }
    const values = Object.keys(dimMap);
    if (values.length > config.maxValuesPerDim) {
      values
        .map((v) => ({ v, eff: effectiveScore(dimMap[v], now, p.tauMs) }))
        .sort((a, b) => a.eff - b.eff || (a.v < b.v ? -1 : 1)) // weakest first; key tie-break
        .slice(0, values.length - config.maxValuesPerDim)
        .forEach(({ v }) => delete dimMap[v]);
    }
    if (Object.keys(dimMap).length === 0) delete dims[d];
  }

  // 3. Membership evaluation with hysteresis, over every surviving value.
  const prevAudiences = new Set(base.audiences);
  const next = new Set<string>();
  const explain: ExplainRecord[] = [];
  const meta = new Map<string, { dim: string; value: string; a: number; p: DimParams }>();

  for (const d of Object.keys(dims).sort()) {
    const p = dimParams(config, specOf(config, d));
    const dimMap = dims[d];
    for (const v of Object.keys(dimMap).sort()) {
      const a = affinityOf(effectiveScore(dimMap[v], now, p.tauMs), p.K);
      const key = audienceKey(d, v);
      meta.set(key, { dim: d, value: v, a, p });
      const wasMember = prevAudiences.has(key);
      if (wasMember ? a >= p.thetaOut : a >= p.thetaIn) next.add(key);
    }
  }

  // 4. Diff + explain. (A membership whose entry was pruned exits at score 0.)
  const entered = [...next].filter((k) => !prevAudiences.has(k)).sort();
  const exited = [...prevAudiences].filter((k) => !next.has(k)).sort();

  for (const key of entered) {
    const m = meta.get(key)!;
    explain.push({
      ts: now, audience: key, dim: m.dim, value: m.value, direction: 'enter',
      score: round4(m.a), thetaIn: m.p.thetaIn, thetaOut: m.p.thetaOut,
      trigger: input.action, configVersion: config.version,
    });
  }
  for (const key of exited) {
    const m = meta.get(key);
    explain.push({
      ts: now, audience: key,
      dim: m?.dim ?? '', value: m?.value ?? '', direction: 'exit',
      score: round4(m?.a ?? 0),
      thetaIn: m?.p.thetaIn ?? config.thetaIn, thetaOut: m?.p.thetaOut ?? config.thetaOut,
      trigger: input.action, configVersion: config.version,
    });
  }

  // 6. P39 (decision D1): the suppressions in force ride the state, a lapsed one
  // pruned at `now`; an action the tenant's settings name records one per value
  // it carries, whatever its weight (remove_from_cart weighs 0 and stays no
  // signal). The later expiry of one value stands. None held and none recorded:
  // no member, so the state is exactly what it was before P39.
  const suppressions = mergeSuppressions(suppressionsInForce(base.suppressions, now), suppressionsRecorded(config, input, now));

  return {
    // 5. The count rides the state: carried through every apply, one more for a signal.
    // P40: the orders the state has recorded ride it unchanged.
    state: withSignals<ReflexState>({ v: 1, dims, audiences: [...next].sort(), configVersion: config.version,
      ...(base.orders !== undefined ? { orders: base.orders } : {}),
      ...(suppressions.length ? { suppressions } : {}) },
      signalsOf(base) + (isSignal(config, input.action) ? 1 : 0)),
    changes: { entered, exited, explain },
  };
}

/**
 * P40 (decision D1): the actions that weigh 0 whatever a registry says. The
 * viewable impression is recorded beside the render acknowledgement and never
 * builds interest, never counts as a signal and never reaches a population count.
 */
const NEVER_WEIGHED: ReadonlySet<string> = new Set(['content_viewable']);

/**
 * The behaviour weight an action applies under this registry: its own weight,
 * 0 when the registry names none, and 0 always for an action that never builds
 * interest (P40). What `apply` accumulates and what both hosts fan into the
 * populations (CW6, P07).
 */
export function weightOf(config: Pick<ReflexConfig, 'weights'>, action: string): number {
  return NEVER_WEIGHED.has(action) ? 0 : config.weights[action] ?? 0;
}

/** P40: whether an action never builds interest, whatever a registry says (the viewable impression). */
export function neverWeighed(action: string): boolean {
  return NEVER_WEIGHED.has(action);
}

/**
 * P10 (decision D1, R-P33): whether one action is a SIGNAL — its OWN behaviour
 * weight in the registry in force is above zero. Only the action's own weight
 * is read, never a weight applied elsewhere to what it touched, so nothing can
 * make a weight-0 action a signal or a weighted one none. P40: an action that
 * never builds interest is never a signal.
 */
export function isSignal(config: Pick<ReflexConfig, 'weights'>, action: string): boolean {
  const weight = Object.hasOwn(config.weights, action) && !NEVER_WEIGHED.has(action) ? config.weights[action] : undefined;
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0;
}

/** Time-only re-evaluation (no accumulation) — what a DO alarm runs in P2. */
export function tick(state: ReflexState | undefined | null, now: number, config: ReflexConfig): ReflexResult {
  return apply(state, { action: 'tick', touches: [] }, now, config);
}

/** Live snapshot for the Affinity Instrument — original value names, a ∈ [0,1]. */
export function snapshot(state: ReflexState, now: number, config: ReflexConfig): AffinitySnapshot {
  const dims: AffinitySnapshot['dims'] = {};
  for (const d of Object.keys(state.dims).sort()) {
    const p = dimParams(config, specOf(config, d));
    const out: Record<string, number> = {};
    for (const v of Object.keys(state.dims[d]).sort()) {
      out[v] = round4(affinityOf(effectiveScore(state.dims[d][v], now, p.tauMs), p.K));
    }
    dims[d] = out;
  }
  return { dims, audiences: [...state.audiences] };
}

/**
 * Flattened, freshly-computed attributes for the existing condition evaluator
 * (evaluateCondition does a direct attributes[key] lookup with numeric gte/lt):
 *   'line_affinity.tabby' → 0.72   +   'line_affinity_top' → 'Tabby'
 * NEVER persist these (they go stale by construction) — compute at read time.
 */
export function attributesFrom(state: ReflexState, now: number, config: ReflexConfig): Record<string, number | string> {
  const attrs: Record<string, number | string> = {};
  for (const d of Object.keys(state.dims)) {
    const p = dimParams(config, specOf(config, d));
    let topV = '';
    let topA = -1;
    for (const v of Object.keys(state.dims[d])) {
      const a = affinityOf(effectiveScore(state.dims[d][v], now, p.tauMs), p.K);
      attrs[affinityAttrKey(d, v)] = round4(a);
      if (a > topA || (a === topA && v < topV)) {
        topA = a;
        topV = v;
      }
    }
    if (topV) attrs[`${slugValue(d)}_affinity_top`] = topV;
  }
  return attrs;
}

/**
 * Closed-form next θ_out crossing across CURRENT memberships (doc 16 §6):
 *   t* = tLast + τ · ln( R · (1 − θ_out) / (K · θ_out) )
 * Returns the earliest exit instant, or null if no membership can decay out.
 * This is what makes P2's alarms exact instead of polled.
 */
export function nextCrossing(state: ReflexState, now: number, config: ReflexConfig): number | null {
  const members = new Set(state.audiences);
  if (members.size === 0) return null;
  let earliest: number | null = null;

  for (const d of Object.keys(state.dims)) {
    const spec = specOf(config, d);
    const p = dimParams(config, spec);
    const floor = (p.K * p.thetaOut) / (1 - p.thetaOut); // R_eff at a = θ_out
    for (const v of Object.keys(state.dims[d])) {
      if (!members.has(audienceKey(d, v))) continue;
      const entry = state.dims[d][v];
      if (entry.s <= floor) {
        // Already at/below the floor — crosses immediately.
        earliest = earliest === null ? now : Math.min(earliest, now);
        continue;
      }
      const tStar = entry.t + p.tauMs * Math.log(entry.s / floor);
      earliest = earliest === null ? tStar : Math.min(earliest, tStar);
    }
  }
  return earliest;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
