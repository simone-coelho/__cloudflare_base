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
    // Price POSTURE is a slower-moving trait than product interest: a longer τ lets it
    // accumulate across human-paced browsing (~15s/view) and fade more slowly — the
    // per-dimension tuning §4 was designed for.
    { key: 'priceBand', source: 'price_usd', derive: 'band', cuts: [150, 400], labels: ['entry', 'core', 'elevated'], tauMs: 150_000 },
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
    // Time-only re-evaluation (alarms / no-product events): no accumulation.
    tick: 0,
  },
  // Demo cadence: 3 brisk views (~5s apart) cross θ_in (a ≈ 0.606); ~40s idle exits.
  tauMs: 60_000,
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
 * The touches a product event contributes. A product this engine holds always
 * wins, because its attributes are ours to trust. Without one, the event's own
 * attributes count only where the scope has said so, and only through the
 * registry. Both hosts call this; neither decides it alone.
 */
export function touchesForEvent(
  data: Record<string, unknown>,
  product: Record<string, unknown> | undefined,
  config: ReflexConfig,
): Touch[] {
  if (product) return extractTouches(product, config);
  if (config.eventAttributes !== 'event-when-unknown') return [];
  return extractTouches(sanitizeEventAttributes(data, config), config);
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
  const weight = config.weights[input.action] ?? 0;

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

  return {
    state: { v: 1, dims, audiences: [...next].sort(), configVersion: config.version },
    changes: { entered, exited, explain },
  };
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
