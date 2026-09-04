// src/content/decide.ts
// The decision, pure. Given the catalog, the page's slots, the shopper's
// affinity, the cell, the arm and the versions in force, produce the delivery
// contract and the ledger records in one pass. No I/O, no clock, no randomness:
// the same input yields the same output, which is what makes replay (doc 22
// §12.3) a proof rather than a hope.

import { composeContentDetailed, type ContentSlotSpec, type AffinityViewLike, type ScoreAdjust } from '@/reflex/contentCompose';
import type {
  Arm, Authority, Cell, ContentDecisionSet, ContentPiece, DecisionRecord, DecisionVersions, IdentityAnchor, LiftApplied, RegionalBlend, SlotStrategy,
} from './types';
import { isEligibleAt } from './lifecycle';
import { liftFor, type LiftSnapshot } from '@/learn/stats';
import { explorationPick, type ExploreConfig, type ExplorePick } from '@/learn/explore';
import { merchandisingAdjustDetailed, merchandisingSentence, type MerchandisingResult } from '@/reflex/merchandising';
import type { DecisionInputs, ExternalTerm, ItemControl, StageRule, StageWord } from './types';
import { STAGE_WORDS } from '@/services/JourneyStage';

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
  /**
   * The learning layer (doc 22 §6): per slot, the lift snapshot in force and the
   * trust dial. At γ = 0 the lift is computed, shown on the receipt, and ignored.
   */
  learning?: {
    snapshots: Record<string, LiftSnapshot | null>;
    gammaOf: (slot: string) => number;
    /** Doc 22 §7, per slot; absent means off. */
    exploreOf?: (slot: string) => ExploreConfig | null;
    /** Doc 22 §12.2, per slot: a merchandiser's control over an item's learned lift. */
    controlOf?: (slot: string, item: string) => ItemControl | null;
  } | null;
  /** Doc 22 §9: their model's answer for this page, or why there is none. Null when no model is configured. */
  external?: ExternalTerm | null;
  /** CW30: slot → item → times served to this visitor inside the slot's fatigue window, from the ring. Null when not read. */
  served?: Record<string, Record<string, number>> | null;
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
    // CW33: the slot's diversity rule, applied by the composer at the take.
    ...(s.diversity ? { diversity: s.diversity } : {}),
  }));
  // Eligibility before scoring: outside its publish window, or out of stock (CW33), a piece does not
  // exist for this decision, however well it would have scored.
  const eligible = i.pieces.filter((p) => isEligibleAt(p, i.nowMs));
  const byId = new Map(i.pieces.map((p) => [p.id, p]));

  // The learning layer: lift^γ on the base score, looked up at the finest level
  // with enough evidence for this item in this cell. The base and the lift are
  // both kept so the receipt shows the arithmetic, not only its result.
  const baseOf = new Map<string, number>();
  const liftOf = new Map<string, LiftApplied>();
  // Doc 22 §10: `default` sees no personalization at all; `no_learning` is personalized with γ = 0 and
  // no exploration, the arm that separates what stage one contributes from what stage two adds.
  const learning = i.arm === 'default' ? null : i.arm === 'no_learning' && i.learning ? { ...i.learning, gammaOf: () => 0, exploreOf: undefined } : i.learning ?? null;
  // Phase 3 (doc 22 §9): their model's term, w_ext × score, added to the base
  // score before the lift and itemized like every other driver.
  const ext = i.arm === 'default' ? null : i.external ?? null;
  const extOf = new Map<string, { score: number; weight: number; contribution: number }>();
  // Scope §1.5 (ledger 20 row 6): season, promotion and margin as clamped multipliers on the
  // merchandised base, after affinity and their model, before the lift. Item properties only, so
  // they apply on every arm; each term is itemised as the delta it caused. The weights live on the
  // slot strategy, the signals on the piece, so a replay reproduces them from the documents.
  const merchWeights = new Map(i.slots.map((s) => [s.slot, s.merchandising ?? null]));
  const hasMerch = [...merchWeights.values()].some((w) => w && (['season', 'promotion', 'margin'] as const).some((t) => (w[t] ?? 0) !== 0));
  const merchDetailed = merchandisingAdjustDetailed<ContentPiece>({ weightsForSlot: (slot) => merchWeights.get(slot) ?? null, signalsOf: (p) => p.merchandising ?? null });
  const merchOf = new Map<string, MerchandisingResult>();
  // CW29 (BTIE A.3.4): the slot's journey-stage rule. The visitor's stage is on the cell, the piece's
  // fit on the piece, the dials on the slot; a piece outside the stage is multiplied down, a piece
  // inside it gets the bonus. Personalization, so never on the default arm, and off when the stage is
  // unknown: an unknown stage is recorded as such, never guessed, and a guess would demote by accident.
  const visitorStage: StageWord | null = i.arm !== 'default' && i.cell.stage && i.cell.stage !== 'unknown' ? STAGE_WORDS[i.cell.stage] : null;
  const stageRules = new Map<string, StageRule>(i.slots.flatMap((s) => (s.stage && ((s.stage.outOfStage ?? 1) < 1 || (s.stage.inStage ?? 0) > 0) ? [[s.slot, s.stage] as const] : [])));
  const hasStage = visitorStage !== null && stageRules.size > 0;
  const stageOf = new Map<string, { visitor: StageWord; fit: StageWord[]; applied: number; inside: boolean }>();
  // CW30 (BTIE D2): freshness and fatigue. Recent content gets a bonus that halves every `halfLifeDays`
  // from the piece's freshness date; content this visitor was already served gets a penalty that grows
  // with the count in the ring up to `cap`. The engine's judgment, so not on the default arm; both
  // itemised as the delta they caused. The served counts travel on the record's inputs for the replay.
  const freshRules = new Map(i.slots.flatMap((s) => (s.freshness && s.freshness.weight > 0 ? [[s.slot, s.freshness] as const] : [])));
  const fatigueRules = new Map(i.slots.flatMap((s) => (s.fatigue && s.fatigue.weight > 0 ? [[s.slot, s.fatigue] as const] : [])));
  const hasFresh = i.arm !== 'default' && freshRules.size > 0;
  const hasFatigue = i.arm !== 'default' && fatigueRules.size > 0 && Boolean(i.served);
  const freshOf = new Map<string, { ageDays: number; decay: number; applied: number }>();
  const fatigueOf = new Map<string, { served: number; windowHours: number; applied: number }>();
  const dateOf = (p: ContentPiece): number | null => {
    const v = p.freshnessDate ?? p.window?.from;
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };
  const adjust: ScoreAdjust | undefined = learning || ext || hasMerch || hasStage || hasFresh || hasFatigue ? (p, slot, base0) => {
    const key = `${slot}:${p.id}`;
    let base = base0;
    if (ext && ext.status === 'ok') {
      const w = ext.weightOf(slot), s = ext.scores[p.id];
      if (w > 0 && typeof s === 'number') { base += w * s; extOf.set(key, { score: s, weight: w, contribution: Math.round(w * s * 1000) / 1000 }); }
    }
    if (hasStage) {
      const rule = stageRules.get(slot), fit = (byId.get(p.id) ?? (p as ContentPiece)).journeyStageFit;
      if (rule && fit && fit.length) {
        const inside = fit.includes(visitorStage!);
        const before = base;
        if (inside) base += rule.inStage ?? 0; else base *= rule.outOfStage ?? 1;
        const applied = Math.round((base - before) * 1000) / 1000;
        if (applied !== 0 || (!inside && (rule.outOfStage ?? 1) < 1)) stageOf.set(key, { visitor: visitorStage!, fit, applied, inside });
      }
    }
    if (hasFresh) {
      const rule = freshRules.get(slot), at = dateOf(byId.get(p.id) ?? (p as ContentPiece));
      if (rule && at !== null && i.nowMs >= at) {
        const ageDays = (i.nowMs - at) / 86_400_000;
        const decay = Math.pow(2, -ageDays / rule.halfLifeDays);
        const applied = Math.round(rule.weight * decay * 1000) / 1000;
        if (applied > 0) { base += applied; freshOf.set(key, { ageDays: Math.round(ageDays * 10) / 10, decay: Math.round(decay * 1000) / 1000, applied }); }
      }
    }
    if (hasFatigue) {
      const rule = fatigueRules.get(slot), served = i.served?.[slot]?.[p.id] ?? 0;
      if (rule && served > 0) {
        const penalty = rule.weight * Math.min(served, rule.cap) / rule.cap;
        const after = Math.max(0, base - penalty);
        const applied = Math.round((after - base) * 1000) / 1000;
        base = after;
        fatigueOf.set(key, { served, windowHours: rule.windowHours, applied });
      }
    }
    baseOf.set(key, base);
    if (hasMerch) {
      // A multiplier on nothing is nothing: a zero base (the default arm, or no signal) gets no block.
      const m = base > 0 ? merchDetailed(byId.get(p.id) ?? (p as ContentPiece), slot, base) : null;
      if (m && m.drivers.length) { merchOf.set(key, m); base = m.scoreFinal; }
    }
    if (!learning) return base;
    const control = learning.controlOf?.(slot, p.id) ?? null;
    if (control) controlOf.set(key, control.mode);
    if (control?.mode === 'reject') return base;                       // learned lift ignored for this item
    const look = liftFor(learning.snapshots[slot], p.id, i.cell);
    const gamma = learning.gammaOf(slot);
    if (control?.mode === 'freeze') {                                   // held at the value a person chose
      liftOf.set(key, { reward: learning.snapshots[slot]?.reward ?? 'click', level: look?.level ?? 0, level_words: 'frozen by a merchandiser', n: look?.n ?? 0, s: look?.s ?? 0, p0: look?.p0 ?? 0, n0: look?.n0 ?? 0, p_hat: look?.p_hat ?? 0, lift: control.lift ?? 1, gamma });
      return base * Math.pow(control.lift ?? 1, gamma);
    }
    if (!look) return base;
    liftOf.set(key, { reward: look.reward, objective: look.objective, level: look.level, level_words: look.level_words, n: look.n, s: look.s, p0: look.p0, n0: look.n0, p_hat: look.p_hat, lift: look.lift, gamma, ...(look.prior ? { prior: look.prior } : {}) });
    return base * Math.pow(look.lift, gamma);
  } : undefined;
  const controlOf = new Map<string, 'reject' | 'freeze'>();
  // Exploration (doc 22 §7): decided per slot from the ranked candidates, deterministic in its inputs.
  const explored = new Map<string, ExplorePick>();
  const explore = learning?.exploreOf ? (slot: string, ranked: ReadonlyArray<{ id: string; score: number }>) => {
    const cfg = learning.exploreOf!(slot);
    if (!cfg) return null;
    const pick = explorationPick({ visitorId: i.visitorId, slot, nowMs: i.nowMs, ranked, snapshot: learning.snapshots[slot], cfg });
    if (!pick) return null;
    explored.set(slot, pick);
    return pick.ranking ? { ranking: pick.ranking } : { first: pick.pieceId };
  } : undefined;
  const { decisions, candidates } = composeContentDetailed(eligible, affinity, specs, i.candidateLimit ?? 10, adjust, explore);
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
    if (ext?.status === 'ok') {
      const e = extOf.get(`${d.slot}:${d.contentId}`);
      if (e) d.explain.drivers.push({ dim: 'external', value: ext.version, a: e.score, weight: e.weight });
    }
    const m = merchOf.get(`${d.slot}:${d.contentId}`);
    if (m) for (const md of m.drivers) d.explain.drivers.push({ dim: 'merchandising', value: md.term, a: md.value, weight: md.weight });
    const st = stageOf.get(`${d.slot}:${d.contentId}`);
    if (st) d.explain.drivers.push({ dim: 'stage', value: st.inside ? `fits ${st.visitor}` : `made for ${st.fit.join(' and ')}, shopper ${st.visitor}`, a: 1, weight: st.applied });
    const fr = freshOf.get(`${d.slot}:${d.contentId}`);
    if (fr) d.explain.drivers.push({ dim: 'freshness', value: `${fr.ageDays} days old`, a: fr.decay, weight: freshRules.get(d.slot)!.weight });
    const fa = fatigueOf.get(`${d.slot}:${d.contentId}`);
    if (fa) d.explain.drivers.push({ dim: 'fatigue', value: `served ${fa.served} time${fa.served === 1 ? '' : 's'} in ${fa.windowHours} h`, a: Math.round(Math.min(fa.served, fatigueRules.get(d.slot)!.cap) / fatigueRules.get(d.slot)!.cap * 1000) / 1000, weight: -fatigueRules.get(d.slot)!.weight });
  }
  const freshSentence = (f: { ageDays: number; decay: number; applied: number }) => `${f.ageDays} days old, freshness at ${f.decay} of new: +${f.applied}`;
  const fatigueSentence = (f: { served: number; windowHours: number; applied: number }) => `this shopper was served it ${f.served} time${f.served === 1 ? '' : 's'} in the last ${f.windowHours} hours: ${f.applied}`;
  const stageSentence = (st: { visitor: StageWord; fit: StageWord[]; applied: number; inside: boolean }) =>
    st.inside ? `made for a shopper who is ${st.visitor}: +${st.applied}` : `made for ${st.fit.join(' and ')}, and this shopper is ${st.visitor}: ${st.applied}`;
  const externalOf = (slot: string, key: string): { external?: DecisionRecord['explain']['external'] } => {
    if (!ext) return {};
    if (ext.status === 'ok') {
      const e = extOf.get(key);
      return e ? { external: { kind: ext.kind, ref: ext.ref, version: ext.version, weight: e.weight, score: e.score, contribution: e.contribution } } : {};
    }
    return ext.weightOf(slot) > 0 ? { external: { kind: ext.kind, ref: ext.ref, status: 'unavailable', reason: ext.reason } } : {};
  };
  // Doc 22 §12.3: what this set was computed from, so a replay is exact.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const inputs: DecisionInputs = {
    affinity: plain(affinity.dims) as DecisionInputs['affinity'],
    ...(i.regional && i.arm !== 'default' ? { regional_share: plain(i.regional.share) as NonNullable<DecisionInputs['regional_share']> } : {}),
    ...(ext?.status === 'ok' ? { external: { version: ext.version, scores: plain(ext.scores) } } : {}),
    ...(hasFatigue && i.served ? { served: plain(i.served) } : {}),
  };

  const positionIn = new Map<string, number>();
  const records: DecisionRecord[] = decisions.map((d) => {
    const position = positionIn.get(d.slot) ?? 0;
    positionIn.set(d.slot, position + 1);
    const regional = regionalOf(d);
    const key = `${d.slot}:${d.contentId}`;
    const lift = liftOf.get(key) ?? null;
    const scoreBase = baseOf.get(key) ?? d.score;
    const pick = explored.get(d.slot);
    const wasExplored = Boolean(pick && position === 0 && (pick.ranking ? pick.ranking[0] === d.contentId : pick.pieceId === d.contentId));
    const control = controlOf.get(key);
    return {
      // Tenant first, then time: the R2 partition (brand and hour) is derivable from the id alone,
      // so a support paste resolves without anyone having to remember which brand it came from.
      decision_id: `${i.tenant}:${i.nowMs.toString(36)}:${i.visitorId}:${i.page}:${d.slot}:${position}`,
      tenant: i.tenant, brand: i.brand, visitor_id: i.visitorId, session_id: i.sessionId, identity_anchor: i.identityAnchor, ts: i.nowMs,
      page: i.page, slot: d.slot, position, item_id: d.contentId, customer_item_id: d.customerContentId,
      candidates: candidates[d.slot] ?? [],
      cell: i.cell, arm: i.arm, explored: wasExplored, authority: authorityOf(d.strategy),
      versions: { ...i.versions, lift: learning?.snapshots[d.slot]?.version ?? 0, prior: learning?.snapshots[d.slot]?.priorVersion ?? 0 }, config_label: i.configLabel,
      explain: {
        drivers: d.explain.drivers, ...(d.explain.note ? { note: d.explain.note } : {}), score_base: Math.round(scoreBase * 1000) / 1000, ...(regional ? { regional } : {}), lift, score_final: d.score,
        ...(wasExplored && pick ? { exploration: { mode: pick.mode, reason: pick.reason, bucket: pick.bucket, ...(pick.samples ? { sample: pick.samples[d.contentId] } : {}) } } : {}),
        ...(control ? { control } : {}),
        ...externalOf(d.slot, key),
        ...(merchOf.has(key) ? { merchandising: (({ boost, clamped, drivers }) => ({ boost, clamped, drivers, sentence: merchandisingSentence(merchOf.get(key)!) }))(merchOf.get(key)!) } : {}),
        ...(stageOf.has(key) ? { stage: (({ visitor, fit, applied }) => ({ visitor, fit, applied, sentence: stageSentence(stageOf.get(key)!) }))(stageOf.get(key)!) } : {}),
        ...(freshOf.has(key) ? { freshness: { ...freshOf.get(key)!, sentence: freshSentence(freshOf.get(key)!) } } : {}),
        ...(fatigueOf.has(key) ? { fatigue: { ...fatigueOf.get(key)!, sentence: fatigueSentence(fatigueOf.get(key)!) } } : {}),
        ...(d.explain.diversity ? { diversity: d.explain.diversity } : {}),
      },
      inputs,
    };
  });

  return {
    tenant: i.tenant, brand: i.brand, page: i.page, visitor_id: i.visitorId, session_id: i.sessionId, identity_anchor: i.identityAnchor, ts: i.nowMs,
    arm: i.arm, cell: i.cell, versions: { ...i.versions }, config_label: i.configLabel,
    regional: i.regional && i.arm !== 'default' ? (({ share: _s, ...rest }) => rest)(i.regional) : null,
    decisions, records,
  };
}
