// src/reflex/identityMerge.ts
// ---------------------------------------------------------------------------
// Two operations on a shopper's affinity state that the ordinary apply() cannot
// express, both pure, both on the decay invariant core.ts already keeps:
//
//   mergeReflexStates   two profiles become one. The anonymous visitor who just
//                       signed in, and the account she signed in to, which may
//                       already hold what her other device learned.
//
//   applyHistorical     an action that happened in the past. A warehouse row is
//                       an action arriving late (AE review, change 2), and late
//                       means it must be discounted by everything that has
//                       decayed since, not counted as if it happened now.
//
// THE INVARIANT. An entry is (s, t): a raw score and the instant of its last
// touch, and its value at any later moment is s·exp(-(now - t)/τ). Nothing here
// stores a pre-decayed score, and nothing here moves t backwards, which is what
// would let a later decay run twice over the same interval.
//
// WHY THE MERGE BRINGS THE OLDER ENTRY FORWARD. The obvious merge, "decay both
// to now and store t = now", would invent a touch at the moment of the merge.
// Bringing the older entry forward to the newer entry's t and summing there keeps
// t honest: it is still the instant this person last touched this value, on
// whichever device.
//
// WHY THE HISTORICAL APPLY IS ORDER-INDEPENDENT. A touch of weight w at time a
// contributes w·exp(-(T - a)/τ) to the value at every T ≥ a, whatever else
// happened around it. Adding that contribution to an entry whose t ≥ a, or
// advancing the entry to a when a is later, produces the same (s, t) whatever
// order the rows arrive in. A warehouse export is not sorted, and must not
// need to be.
// ---------------------------------------------------------------------------

import {
  effectiveScore, emptyState, isSignal, mergeSuppressions, signalsOf, suppressionsInForce, suppressionsRecorded, tick, withSignals,
  type ReflexConfig, type ReflexEntry, type ReflexInput, type ReflexResult, type ReflexState,
} from '@/reflex/core';

/** The per-dimension horizon, the same rule core.ts applies. */
function tauOf(config: ReflexConfig, dim: string): number {
  return config.dimensions.find((d) => d.key === dim)?.tauMs ?? config.tauMs;
}

function isState(s: ReflexState | null | undefined): s is ReflexState {
  return !!s && s.v === 1 && !!s.dims;
}

/** Two entries for the same value become one, at the later of the two touches. */
export function mergeEntries(a: ReflexEntry, b: ReflexEntry, tauMs: number): ReflexEntry {
  const t = Math.max(a.t, b.t);
  return { s: effectiveScore(a, t, tauMs) + effectiveScore(b, t, tauMs), t };
}

/**
 * Merge two profiles into one and re-evaluate memberships at `now`.
 *
 * Memberships are unioned before the evaluation, so hysteresis treats a value
 * either profile had already entered as a member: it stays unless the merged
 * score has fallen below θ_out. The returned `changes` are the enters and exits
 * the merge itself caused, which is what a link receipt should carry.
 *
 * Either side may be absent; merging with nothing is the identity, run through
 * tick() so the result is always evaluated at `now`.
 */
export function mergeReflexStates(
  a: ReflexState | null | undefined,
  b: ReflexState | null | undefined,
  now: number,
  config: ReflexConfig,
): ReflexResult {
  const A = isState(a) ? a : emptyState(config);
  const B = isState(b) ? b : emptyState(config);

  const dims: ReflexState['dims'] = {};
  for (const d of new Set([...Object.keys(A.dims), ...Object.keys(B.dims)])) {
    const tau = tauOf(config, d);
    const out: Record<string, ReflexEntry> = {};
    const da = A.dims[d] ?? {};
    const db = B.dims[d] ?? {};
    for (const v of new Set([...Object.keys(da), ...Object.keys(db)])) {
      const ea = da[v];
      const eb = db[v];
      out[v] = ea && eb ? mergeEntries(ea, eb, tau) : { ...(ea ?? eb) };
    }
    dims[d] = out;
  }

  const audiences = [...new Set([...A.audiences, ...B.audiences])].sort();
  // P39 (remaining-work item 2): every suppression in force on either profile
  // is in force on the person, with its value, its action and its expiry
  // unchanged. Where both hold one value, the later expiry stands with its
  // action, whichever side holds it, and on an equal expiry the person's own
  // (`a`, the side both hosts pass as the linked shopper's) is kept: a link
  // never shortens a suppression and never lengthens one beyond what an action
  // recorded. Written only when there is one, as every apply writes it.
  const suppressions = mergeSuppressions(suppressionsInForce(A.suppressions, now), suppressionsInForce(B.suppressions, now));
  // P10: the person's count of signals is the SUM of the two profiles' counts.
  // Each counted an action the other never saw (two devices' actions are one
  // person's actions, as their visits and counters add), and a browser already
  // folded into the person arrives here as nothing, so no action is counted twice.
  return tick(withSignals<ReflexState>({ v: 1, dims, audiences, configVersion: config.version,
    ...(suppressions.length ? { suppressions } : {}) }, signalsOf(A) + signalsOf(B)), now, config);
}

/**
 * Apply an action that happened at `at`, which may be earlier than anything the
 * state has seen. Accumulation only: no pruning, no cap, no membership change.
 * Run tick(state, now, config) after a batch to evaluate at the present.
 *
 * A row at a time later than the entry's last touch is an ordinary apply at
 * that time. A row earlier than the last touch adds what would be left of it
 * by then, and leaves t where it is.
 *
 * P10 (decision D1): an applied action whose own behaviour weight is above zero
 * is a signal whenever it happened, so it is counted here exactly as `apply`
 * counts a live one; the count is never decayed, so the order rows arrive in
 * does not matter to it either.
 *
 * P39 (R-P60): an action the tenant's suppression settings name records its
 * suppressions here too, each expiring its window after the action's own time
 * `at` — a buffered remove_from_cart (weight 0: no interest, no signal) and,
 * under the purchase rule, a buffered or imported purchase — merged into the
 * ones the state holds by the one rule (the later expiry stands). One that has
 * already lapsed by the present is pruned by the tick that follows, so an action
 * older than its window suppresses nothing.
 */
export function applyHistorical(
  prev: ReflexState | null | undefined,
  input: ReflexInput,
  at: number,
  config: ReflexConfig,
): ReflexState {
  const base = isState(prev) ? prev : emptyState(config);
  const weight = config.weights[input.action] ?? 0;
  const dims: ReflexState['dims'] = {};
  for (const d of Object.keys(base.dims)) dims[d] = { ...base.dims[d] };
  // P39 (R-P60): the suppressions this action records at its own time; none
  // without the settings, so a tenant without them gets exactly the state it got.
  const recorded = Number.isFinite(at) ? suppressionsRecorded(config, input, at) : [];
  const suppressed = <T extends ReflexState>(state: T): T => (recorded.length
    ? { ...state, suppressions: mergeSuppressions(Array.isArray(state.suppressions) ? state.suppressions : [], recorded) } : state);
  if (weight <= 0 || !Number.isFinite(at)) return suppressed({ ...base, dims });
  const counted = withSignals(base, signalsOf(base) + (isSignal(config, input.action) ? 1 : 0));

  for (const touch of input.touches) {
    if (!touch.value) continue;
    if (!config.dimensions.some((d) => d.key === touch.dim)) continue; // unconfigured dimension
    const tau = tauOf(config, touch.dim);
    const dimMap = (dims[touch.dim] = dims[touch.dim] ?? {});
    const e = dimMap[touch.value];
    if (!e) {
      dimMap[touch.value] = { s: weight, t: at };
    } else if (at >= e.t) {
      dimMap[touch.value] = { s: effectiveScore(e, at, tau) + weight, t: at };
    } else {
      dimMap[touch.value] = { s: e.s + weight * Math.exp(-(e.t - at) / tau), t: e.t };
    }
  }
  return suppressed({ ...counted, dims });
}
