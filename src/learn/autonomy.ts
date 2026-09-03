// src/learn/autonomy.ts
// Doc 22 §11, pure. A slot in `assisted` mode gets a PROPOSAL with its
// evidence for a person to approve; in `autonomous` mode the same change is
// applied within bounds. The evidence is the lift snapshot the slot has already
// published: for each dimension the slot weights, the tag values are grouped
// and their exposure-weighted mean lift compared. A dimension whose tag values
// separate outcomes is one the weights should lean on; the proposal raises it
// by one step, bounded, pinned dimensions excluded, and never acts before the
// slot has seen `minN` exposures. Every application is a versioned revision of
// the slots document with the evidence in its note, and rolls forward.

import type { LiftSnapshot } from './stats';

export type AutonomyMode = 'configured' | 'assisted' | 'autonomous';

export interface AutonomyConfig {
  mode: AutonomyMode;
  step: number;
  min: number;
  max: number;
  pinned: string[];
  minN: number;
}
export const DEFAULT_AUTONOMY: AutonomyConfig = { mode: 'configured', step: 0.05, min: 0, max: 1, pinned: [], minN: 500 };

export interface DimensionEvidence {
  dimension: string;
  /** tag value → exposure-weighted mean lift over the items carrying it, with the exposures behind it */
  values: Record<string, { meanLift: number; n: number; items: number }>;
  spread: number;
}

export interface Proposal {
  id: string;
  tenant: string;
  brand: string;
  slot: string;
  at: number;
  mode: AutonomyMode;
  /** The one move: raise this dimension's weight from → to. */
  dimension: string;
  from: number;
  to: number;
  evidence: DimensionEvidence[];
  exposures: number;
  snapshotVersion: number;
  status: 'proposed' | 'applied' | 'rejected';
  note?: string;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The evidence: per weighted dimension, how lift varies across the tag values items carry. */
export function evidenceFor(weights: Record<string, number>, tags: Record<string, Record<string, readonly string[]>>, snap: LiftSnapshot): DimensionEvidence[] {
  const out: DimensionEvidence[] = [];
  for (const dimension of Object.keys(weights)) {
    const acc: Record<string, { lift: number; n: number; items: number }> = {};
    for (const [item, byKey] of Object.entries(snap.items)) {
      const st = byKey['*']; if (!st || st.n <= 0) continue;
      for (const v of tags[item]?.[dimension] ?? []) {
        const a = (acc[v] ??= { lift: 0, n: 0, items: 0 });
        a.lift += st.lift * st.n; a.n += st.n; a.items += 1;
      }
    }
    const values: DimensionEvidence['values'] = {};
    for (const [v, a] of Object.entries(acc)) values[v] = { meanLift: r3(a.lift / a.n), n: r3(a.n), items: a.items };
    const lifts = Object.values(values).map((x) => x.meanLift);
    out.push({ dimension, values, spread: lifts.length >= 2 ? r3(Math.max(...lifts) - Math.min(...lifts)) : 0 });
  }
  return out.sort((a, b) => b.spread - a.spread);
}

/** The one move a cycle would make, or null with the reason it would not. */
export function proposeFor(
  ids: { tenant: string; brand: string; slot: string },
  weights: Record<string, number>,
  tags: Record<string, Record<string, readonly string[]>>,
  snap: LiftSnapshot | null,
  cfg: AutonomyConfig,
  now: number,
): { proposal: Proposal | null; reason: string } {
  if (cfg.mode === 'configured') return { proposal: null, reason: 'slot is configured: no cycle runs' };
  if (!snap) return { proposal: null, reason: 'no lift snapshot published for the slot yet' };
  const exposures = snap.slotRates['*']?.n ?? 0;
  if (exposures < cfg.minN) return { proposal: null, reason: `${Math.round(exposures)} exposures, below minN ${cfg.minN}` };
  const evidence = evidenceFor(weights, tags, snap).filter((e) => !cfg.pinned.includes(e.dimension));
  const best = evidence.find((e) => e.spread > 0);
  if (!best) return { proposal: null, reason: 'no unpinned dimension separates outcomes yet' };
  const from = weights[best.dimension] ?? 0;
  const to = r3(Math.min(cfg.max, from + cfg.step));
  if (to <= from) return { proposal: null, reason: `${best.dimension} is already at its maximum ${cfg.max}` };
  return {
    proposal: {
      id: `${ids.tenant}:${ids.slot}:${now.toString(36)}`, ...ids, at: now, mode: cfg.mode,
      dimension: best.dimension, from: r3(from), to, evidence, exposures: r3(exposures), snapshotVersion: snap.version, status: 'proposed',
    },
    reason: `${best.dimension} separates outcomes most (spread ${best.spread}); raise ${r3(from)} → ${to}`,
  };
}

/** The slot's weights with the proposal applied, bounded. */
export function applyProposal(weights: Record<string, number>, p: Pick<Proposal, 'dimension' | 'to'>, cfg: AutonomyConfig): Record<string, number> {
  return { ...weights, [p.dimension]: r3(Math.min(cfg.max, Math.max(cfg.min, p.to))) };
}
