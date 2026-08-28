// src/demos/meridian/lead.ts
// ─────────────────────────────────────────────────────────────────────────────
// RECENCY LEADS, ACCUMULATION GATES.
//
// An addition to the Tapestry spec, decided 2026-08-28 (D2) — the reasoning is
// in reflexConfig.ts beside LEAD_BY. In one sentence: the documented algorithm
// is decay-only, so three Drover clicks followed by one Linden click leaves the
// page pushing Drover for about the narrow τ (thirty seconds) after the visitor
// has plainly moved on, and in the room that reads as the engine ignoring her.
//
// For a dimension flagged recency-led the LEAD is the most recently touched
// value — the entry with the greatest last-touch time t — not the highest
// affinity. In scoring the lead contributes its full a; every other value in
// that dimension contributes a × trailing. Membership is NOT touched: entering
// and leaving an audience stays core's threshold arithmetic, so the Drover
// audience persists until it decays out on its own.
//
// PURE. Reads the RAW state, because that is where t lives — the decayed
// snapshot cannot tell "touched once, just now" from "touched three times, a
// while ago", which is precisely the distinction this rule exists to make.
// ─────────────────────────────────────────────────────────────────────────────

import type { DimensionSpec, ReflexState } from '@/reflex/core';
import { LEAD_BY, trailingFor } from './reflexConfig';

/** The marker a driver carries so a receipt can say why a value scored as it did. */
export type LeadMark =
  | { lead: 'recency' }
  | { lead: 'trailing'; trailing: number; ledBy: string };

export interface LeadWeights {
  dim: string;
  by: 'recency';
  /** The value that leads: the most recently touched one. */
  lead: string;
  trailing: number;
  /** Multiplier on a for `value`: 1 for the lead, `trailing` for everything else. */
  weight(value: string): number;
  /** The explain marker a driver for `value` carries. */
  mark(value: string): LeadMark;
}

type StateLike = Pick<ReflexState, 'dims'> | null | undefined;

/**
 * The most recently touched value in a dimension, or null when nothing has been
 * touched. Ties on t — two values touched by the same event — break on the
 * larger raw score, then alphabetically. Deterministic either way.
 */
export function leadValue(state: StateLike, dimKey: string): string | null {
  const entries = state?.dims?.[dimKey];
  if (!entries) return null;
  let lead: string | null = null;
  let best: { s: number; t: number } | null = null;
  for (const [value, e] of Object.entries(entries)) {
    if (lead === null || best === null) { lead = value; best = e; continue; }
    const newer = e.t > best.t || (e.t === best.t && (e.s > best.s || (e.s === best.s && value < lead)));
    if (newer) { lead = value; best = e; }
  }
  return lead;
}

/**
 * Per-value scoring weights for a recency-led dimension. Null for a dimension
 * that is score-led (the documented default) or that nothing has touched, so a
 * caller treats "no rule" and "nothing to lead" the same way: score as written.
 */
export function leadWeights(
  state: StateLike,
  spec: Pick<DimensionSpec, 'key'>,
  trailing: number = trailingFor(spec.key),
): LeadWeights | null {
  if (LEAD_BY[spec.key] !== 'recency') return null;
  const lead = leadValue(state, spec.key);
  if (lead === null) return null;
  return {
    dim: spec.key,
    by: 'recency',
    lead,
    trailing,
    weight: (value) => (value === lead ? 1 : trailing),
    mark: (value) => (value === lead ? { lead: 'recency' } : { lead: 'trailing', trailing, ledBy: lead }),
  };
}

/**
 * The receipt line. From a decision's drivers, one clause per recency-led
 * dimension — "line · Linden led by recency; Drover trailing ×0.25" — or an
 * empty string when no driver carries a lead marker.
 */
export function leadSentence(
  drivers: ReadonlyArray<{ dim: string; value: string; lead?: string; trailing?: number; ledBy?: string }>,
): string {
  const byDim = new Map<string, { lead?: string; trailing: string[]; factor?: number }>();
  for (const d of drivers) {
    if (!d.lead) continue;
    const row = byDim.get(d.dim) ?? { trailing: [] };
    if (d.lead === 'recency') row.lead = d.value;
    else { row.lead ??= d.ledBy; row.trailing.push(d.value); row.factor = d.trailing; }
    byDim.set(d.dim, row);
  }
  return [...byDim]
    .map(([dim, r]) =>
      `${dim} · ${r.lead} led by recency` + (r.trailing.length ? `; ${r.trailing.join(', ')} trailing ×${r.factor}` : ''))
    .join(' · ');
}
