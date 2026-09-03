// src/content/decide.ts
// The decision, pure. Given the catalog, the page's slots, the shopper's
// affinity, the cell, the arm and the versions in force, produce the delivery
// contract and the ledger records in one pass. No I/O, no clock, no randomness:
// the same input yields the same output, which is what makes replay (doc 22
// §12.3) a proof rather than a hope.

import { composeContentDetailed, type ContentSlotSpec, type AffinityViewLike } from '@/reflex/contentCompose';
import type {
  Arm, Authority, Cell, ContentDecisionSet, ContentPiece, DecisionRecord, DecisionVersions, IdentityAnchor, RegionalBlend, SlotStrategy,
} from './types';
import { isLiveAt } from './lifecycle';

export interface DecideInput {
  tenant: string;
  brand: string;
  page: string;
  visitorId: string;
  sessionId: string | null;
  identityAnchor: IdentityAnchor;
  nowMs: number;
  pieces: readonly ContentPiece[];
  slots: readonly SlotStrategy[];
  affinity: AffinityViewLike | null;
  /**
   * The population prior already blended into `affinity` by the service, with
   * the regional shares it used, so each decision can itemize what the region
   * contributed. Null when no prior applied.
   */
  regional?: (RegionalBlend & { share: Readonly<Record<string, Readonly<Record<string, number>>>> }) | null;
  cell: Cell;
  arm: Arm;
  versions: DecisionVersions;
  configLabel: string;
  /** Top-N candidates recorded per slot (doc 22 §3.1). */
  candidateLimit?: number;
}

const NO_SIGNAL: AffinityViewLike = { dims: {} };

const authorityOf = (strategy: string): Authority =>
  strategy === 'tenant-pinned' ? 'pin' : strategy === 'default' ? 'default' : 'engine';

export function decideContent(i: DecideInput): ContentDecisionSet {
  // The `default` arm is the site's own defaults: no personalization, so the
  // composer sees no signal. Pins still apply — they are merchandising
  // authority, not personalization, and the holdout must not remove them.
  const affinity = i.arm === 'default' ? NO_SIGNAL : (i.affinity ?? NO_SIGNAL);
  const specs: ContentSlotSpec[] = i.slots.map((s) => ({
    slot: s.slot, take: s.take, weights: s.weights,
    ...(s.pinnedPieceId ? { pinnedPieceId: s.pinnedPieceId } : {}),
  }));
  // Eligibility before scoring: outside its publish window a piece does not exist
  // for this decision, however well it would have scored.
  const eligible = i.pieces.filter((p) => isLiveAt(p, i.nowMs));
  const { decisions, candidates } = composeContentDetailed(eligible, affinity, specs, i.candidateLimit ?? 10);

  const byId = new Map(i.pieces.map((p) => [p.id, p]));
  const specOf = new Map(specs.map((s) => [s.slot, s]));
  // What the region contributed to this decision: Σ over the piece's tags of λ·share·w.
  const regionalOf = (d: { contentId: string; slot: string }): (RegionalBlend & { contribution: number }) | null => {
    const reg = i.regional; if (!reg || i.arm === 'default') return null;
    const piece = byId.get(d.contentId), spec = specOf.get(d.slot);
    if (!piece || !spec) return null;
    let contribution = 0;
    for (const [dim, values] of Object.entries(piece.tags)) {
      const w = spec.weights[dim] ?? 0; if (!w) continue;
      for (const v of values) contribution += reg.lambda * (reg.share[dim]?.[v] ?? 0) * w;
    }
    if (contribution <= 0) return null;
    const { share: _share, ...summary } = reg;
    return { ...summary, contribution: Math.round(contribution * 1000) / 1000 };
  };
  for (const d of decisions) {
    const r = regionalOf(d);
    if (r) d.explain.drivers.push({ dim: 'regional', value: r.region, a: r.lambda, weight: Math.round((r.contribution / (r.lambda || 1)) * 1000) / 1000 });
  }

  const positionIn = new Map<string, number>();
  const records: DecisionRecord[] = decisions.map((d) => {
    const position = positionIn.get(d.slot) ?? 0;
    positionIn.set(d.slot, position + 1);
    const regional = regionalOf(d);
    return {
      // Tenant first, then time: the R2 partition (brand and hour) is derivable from the id alone,
      // so a support paste resolves without anyone having to remember which brand it came from.
      decision_id: `${i.tenant}:${i.nowMs.toString(36)}:${i.visitorId}:${i.page}:${d.slot}:${position}`,
      tenant: i.tenant, brand: i.brand, visitor_id: i.visitorId, session_id: i.sessionId, identity_anchor: i.identityAnchor, ts: i.nowMs,
      page: i.page, slot: d.slot, position, item_id: d.contentId, customer_item_id: d.customerContentId,
      candidates: candidates[d.slot] ?? [],
      cell: i.cell, arm: i.arm, explored: false, authority: authorityOf(d.strategy),
      versions: { ...i.versions }, config_label: i.configLabel,
      explain: { drivers: d.explain.drivers, ...(d.explain.note ? { note: d.explain.note } : {}), score_base: d.score, ...(regional ? { regional } : {}), lift: null },
    };
  });

  return {
    tenant: i.tenant, brand: i.brand, page: i.page, visitor_id: i.visitorId, session_id: i.sessionId, identity_anchor: i.identityAnchor, ts: i.nowMs,
    arm: i.arm, cell: i.cell, versions: { ...i.versions }, config_label: i.configLabel,
    regional: i.regional && i.arm !== 'default' ? (({ share: _s, ...rest }) => rest)(i.regional) : null,
    decisions, records,
  };
}
