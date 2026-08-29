// src/demos/meridian/composer.ts
// ─────────────────────────────────────────────────────────────────────────────
// PURE. No fetch, no storage, no clock beyond what is handed in. That matters
// twice: it ships to the browser so a slot repaints the instant a frame lands
// (never awaiting the network — the First National Bank property), and it runs
// server-side unchanged when we export explain records. One implementation, so
// the receipt the room reads is the arithmetic that actually chose the item.
//
// The scoring is the two-level model:
//
//   s(item | visitor, slot) = Σ_d  ω_d(slot) · a_d(visitor) · m_d(item)
//
// ω is the slot's strategy weight, a is the visitor's live affinity for a value
// in dimension d, and m is how much this item carries that value. Level one is
// held in the actor and costs O(dimensions); level two runs here at decision
// time. No per-item state per visitor exists at either level, which is why the
// same code ranks 37 items or an entire catalog at the same cost.
//
// PRECEDENCE IS DECLARED, NOT IMPLICIT: eligibility gates run first, pins
// outrank the engine, and weighted ranking operates only on what is left. In
// the row, ranking is further gated by MEMBERSHIP — "memberships gate, scores
// rank" — so only items belonging to an audience the visitor has entered are
// promoted; the rest hold the catalogue's own order.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReflexConfig, ReflexState } from '@/reflex/core';
import { extractTouches, audienceKey, slugValue } from '@/reflex/core';
import { leadWeights } from './lead';
import type {
  MeridianItem, MeridianBlock, MeridianSlot, MeridianDecision, MeridianExplain,
} from './types';

/** What the actor sends: dimension → value → affinity a(t) in [0,1). */
export interface AffinityView {
  dims: Record<string, Record<string, number>>;
  audiences: string[];
}

/** A slot's strategy: which dimensions it leans on, and how hard. */
export type SlotStrategy = Record<string, number>;

/**
 * Per-slot strategy profiles, expressed against dimension SHAPES rather than
 * keys, so one table serves both verticals unchanged — the hero leans on broad
 * interest and durable taste whether that reads as styleWorld or lifeStage.
 */
/** The promoted block is one line of the shelf: the picks are the first five, never scattered. */
export const ROW_BLOCK = 5;

export const SLOT_STRATEGIES: Record<MeridianSlot, Record<string, number>> = {
  // Each slot's HIGHEST-weighted shape is its lead, and the lead is what decides
  // whether the slot may still claim the visitor as its reason. Leads are chosen
  // so that the three surfaces sit on three different decay constants — narrow
  // (120s), broad (180s), need (240s) — which is what turns one stretch of
  // inactivity into three separate, nameable retreats instead of one collapse.
  //
  // The hero commits. It leans on the slow axes so it does not flap.
  hero:    { broad: 0.35, durable: 0.30, need: 0.20, band: 0.15, narrow: 0.00, hue: 0.00, content: 0.00, stage: 0.00 },
  // The rail is fast-twitch: it answers the last thing you did.
  rail:    { narrow: 0.35, broad: 0.25, need: 0.20, hue: 0.10, band: 0.10, durable: 0.00, content: 0.00, stage: 0.00 },
  // The row ranks merchandise. Led by NEED rather than narrow so it outlives the
  // rail — a row about "things for a project" stays true longer than a row about
  // "cordless sanders specifically".
  row:     { need: 0.25, narrow: 0.25, broad: 0.25, band: 0.15, hue: 0.10, durable: 0.00, content: 0.00, stage: 0.00 },
  // Blocks are content: what KIND of asset earns attention matters most.
  block_a: { content: 0.35, broad: 0.25, need: 0.20, durable: 0.20, narrow: 0.00, hue: 0.00, band: 0.00, stage: 0.00 },
  block_b: { content: 0.35, broad: 0.25, need: 0.20, durable: 0.20, narrow: 0.00, hue: 0.00, band: 0.00, stage: 0.00 },
};

export interface ComposeInput {
  affinity: AffinityView;
  items: readonly MeridianItem[];
  /** The department shelf: when the visitor is IN a department the row is built from it alone; hero, rail and blocks stay global. */
  rowItems?: readonly MeridianItem[];
  /**
   * THE COLD START: what shoppers from her neighbourhood actually bought, in
   * order, as item ids. Used only while she has no audiences of her own — the
   * first line opens on the cohort, and her first engagement hands off to the
   * live profile. Curation only; never a price, never a gate.
   */
  coldPicks?: readonly string[];
  blocks: readonly MeridianBlock[];
  config: ReflexConfig;
  /** dimension shape lookup, from reflexConfig.SHAPE_OF_KEY */
  shapeOfKey: Readonly<Record<string, string>>;
  /** Merchandiser authority. Outranks the engine and survives regeneration. */
  pins?: Partial<Record<MeridianSlot, string>>;
  /**
   * Merchandiser authority of a second kind: ordered audience keys, highest
   * first. When the visitor is in two or more of these at once, the HERO is
   * chosen from the candidates matching the highest-priority entered audience
   * that any eligible candidate matches — score order among those. Absent, or
   * with fewer than two of its audiences entered, nothing changes.
   */
  audiencePriority?: string[];
  rowSize?: number;
  /** The piece the visitor committed to. Only meaningful once stage says deciding. */
  anchorId?: string;
  /** The stage value that means "has chosen": `deciding`, or `applying`. */
  decidingValue?: string;
  /** Raw state, with last-touch times, so a recency-led dimension can name its lead (lead.ts). */
  state?: ReflexState;
}

/** How much of dimension d this record carries. 1, 0, or a share for multi. */
function match(record: Record<string, unknown>, source: string, value: string): number {
  const raw = record[source];
  if (raw == null) return 0;
  if (Array.isArray(raw)) {
    const hit = raw.some((v) => String(v) === value);
    return hit ? 1 / Math.max(1, raw.length) : 0;
  }
  return String(raw) === value ? 1 : 0;
}

/**
 * Band dimensions read a number and compare against the derived label, so the
 * band a visitor likes is matched without storing the number on the visitor.
 */
function bandLabel(v: number, cuts: number[], labels: string[]): string {
  let i = 0;
  while (i < cuts.length && v >= cuts[i]) i += 1;
  return labels[i] ?? labels[labels.length - 1];
}

export function scoreOne(
  record: Record<string, unknown>,
  input: ComposeInput,
  strategy: Record<string, number>,
): { score: number; drivers: MeridianExplain['drivers']; confidence: number; thetaOut: number } {
  const drivers: MeridianExplain['drivers'] = [];
  let score = 0;

  for (const spec of input.config.dimensions) {
    const shape = input.shapeOfKey[spec.key];
    const omega = strategy[shape] ?? 0;
    if (omega === 0) continue;

    const perValue = input.affinity.dims[spec.key];
    if (!perValue) continue;
    // D2: a recency-led dimension (reflexConfig.LEAD_BY) leads on its last touch — lead.ts. Null unless raw state is supplied.
    const lead = input.state ? leadWeights(input.state, spec) : null;

    for (const [value, a] of Object.entries(perValue)) {
      if (a <= 0) continue;
      const m =
        spec.derive === 'band' && spec.cuts && spec.labels
          ? bandLabel(Number(record[spec.source] ?? 0), spec.cuts, spec.labels) === value ? 1 : 0
          : match(record, spec.source, value);
      if (m === 0) continue;
      const contribution = omega * a * (lead ? lead.weight(value) : 1) * m;
      score += contribution;
      drivers.push({ dim: spec.key, value, a: round(a), weight: round(contribution), ...(lead ? lead.mark(value) : {}) });
    }
  }

  drivers.sort((x, y) => y.weight - x.weight);

  // Confidence is measured on the slot's LEAD dimension — fixed — not on
  // whichever driver happens to be strongest right now.
  //
  // Judging on the strongest driver flaps: once the lead dimension decays past
  // the next one, the "top driver" changes to a fresher dimension, confidence
  // jumps back up, and the slot re-claims before withdrawing again. Observed
  // live: the rail withdrew at 30s, silently re-claimed, then withdrew again at
  // 65s. A fixed lead cannot do that, and it also makes each surface's retreat
  // attributable to one named dimension.
  const leadShape = Object.entries(strategy).sort((a, b) => b[1] - a[1])[0]?.[0];
  const leadSpec = input.config.dimensions.find((d) => input.shapeOfKey[d.key] === leadShape);
  const leadDriver = leadSpec ? drivers.find((d) => d.dim === leadSpec.key) : undefined;
  const fallbackDriver = drivers[0];
  const judged = leadDriver ?? fallbackDriver;
  const judgedSpec = judged ? input.config.dimensions.find((d) => d.key === judged.dim) : undefined;

  return {
    score,
    drivers: drivers.filter((d, i) => i < 4 || 'lead' in d),   // a trailing value is small by design; the receipt still names it
    confidence: judged?.a ?? 0,
    thetaOut: judgedSpec?.thetaOut ?? input.config.thetaOut,
  };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** Item property, never visitor property: a gated item drops out, affinity is untouched. */
function gateOf(item: MeridianItem): { ok: boolean; gate?: string } {
  if (item.available === false) return { ok: false, gate: 'unavailable' };
  if (item.embargoed) return { ok: false, gate: 'embargoed' };
  return { ok: true };
}

/**
 * Compose every slot on the page. Returns decisions in slot order, each with the
 * receipt that produced it. A slot with no signal falls back deterministically
 * rather than rendering nothing — the page never breaks and never waits.
 */
export function compose(input: ComposeInput): MeridianDecision[] {
  const { items, blocks, config } = input;
  const rowSize = input.rowSize ?? 6;
  const decisions: MeridianDecision[] = [];
  const coldStart = Object.keys(input.affinity.dims).length === 0;
  let order = 0;

  const usedItems = new Set<string>();
  const usedBlocks = new Set<string>();

  // ── membership: the gate promotion has to pass ───────────────────────────
  // "Memberships gate, scores rank" — the Tapestry rule, now enforced where it
  // was being skipped. An item MATCHES an entered audience when one of its own
  // touches maps, via audienceKey, to an audience the visitor has actually
  // entered (θ_in crossed, hysteresis holding). Stage audiences are excluded on
  // both sides: journey stage is page structure, not merchandise, and no shelf
  // position should ever be explained by "you are deciding".
  const stagePrefixes = Object.entries(input.shapeOfKey)
    .filter(([, shape]) => shape === 'stage')
    .map(([key]) => `${slugValue(key)}_`);
  const entered = new Set(
    input.affinity.audiences.filter((k) => !stagePrefixes.some((p) => k.startsWith(p))),
  );
  const matchedCache = new Map<string, string[]>();
  /** The entered (non-stage) audiences this record belongs to, in touch order. */
  const matchedOf = (r: { id: string }): string[] => {
    const hit = matchedCache.get(r.id);
    if (hit) return hit;
    const matched: string[] = [];
    if (entered.size > 0) {
      for (const t of extractTouches(r as unknown as Record<string, unknown>, config)) {
        if (input.shapeOfKey[t.dim] === 'stage') continue;
        const key = audienceKey(t.dim, t.value);
        if (entered.has(key) && !matched.includes(key)) matched.push(key);
      }
    }
    matchedCache.set(r.id, matched);
    return matched;
  };
  // Standard order = the catalogue's own order. Identical for every visitor,
  // never re-sorted by score — the shelf everyone else sees.
  const catIndex = new Map(items.map((it, i) => [it.id, i] as const));
  const standardOrder = (a: { id: string }, b: { id: string }) =>
    (catIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (catIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER);

  const rank = <T extends { id: string }>(
    pool: readonly T[],
    slot: MeridianSlot,
    used: Set<string>,
  ) => {
    const strategy = SLOT_STRATEGIES[slot];
    // Score FIRST, gate SECOND. The other order throws away the score of the item
    // a rule refused — and the most persuasive thing this engine does is decline
    // something it would have won with.
    const scored = pool
      .filter((r) => !used.has(r.id))
      .map((r) => ({ r, ...scoreOne(r as unknown as Record<string, unknown>, input, strategy) }))
      .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));

    const eligible: typeof scored = [];
    const refused: Array<{ id: string; score: number; gate: string }> = [];
    for (const s of scored) {
      const g = gateOf(s.r as unknown as MeridianItem);
      if (g.ok) eligible.push(s);
      else refused.push({ id: s.r.id, score: round(s.score), gate: g.gate! });
    }
    return { scored: eligible, refused, gated: refused.map((x) => `${x.gate}:${x.id}`) };
  };

  const explainOf = (
    drivers: MeridianExplain['drivers'], candidates: number, gatesFailed: string[], rankPos: number,
    confidence?: number, thetaOut?: number,
  ): MeridianExplain => ({
    drivers, candidates, gatesFailed: gatesFailed.slice(0, 4), rank: rankPos,
    confidence, thetaOut, configVersion: config.version,
  });

  /**
   * WHAT THE WINNER BEAT. A ranked list fills each position with the best
   * candidate still unplaced, so the runner-up for position `at` is the entry
   * one below it: the best eligible loser, never above the winner's score, so
   * "beat" is a claim the arithmetic actually supports. Only gate survivors are
   * ever passed in — a refused item is carried by `refused` with its score and
   * is never a runner-up.
   *
   * Absent, never fabricated, wherever no scored contest chose the slot: cold
   * start, a zero-scoring fallback, a merchandiser pin, an audiencePriority
   * override, the cohort's first line, and the standard shelf.
   */
  const runnerUpOf = (
    ranked: readonly { r: { id: string }; score: number }[], at: number,
  ): { runnerUp: MeridianExplain['runnerUp']; score?: number } | undefined => {
    const winner = ranked[at];
    const next = ranked[at + 1];
    if (coldStart || !winner || winner.score <= 0 || !next) return undefined;
    return { runnerUp: { id: next.r.id, score: round(next.score) }, score: round(winner.score) };
  };

  /** Ranking and claiming are different rights. This decides the second one. */
  const strategyFor = (s?: { score: number; confidence: number; thetaOut: number }) => {
    if (coldStart) return 'cold-start' as const;
    if (!s || s.score <= 0) return 'fallback' as const;
    return s.confidence >= s.thetaOut ? ('affinity' as const) : ('fading' as const);
  };

  // ── hero, rail: one item each ────────────────────────────────────────────
  for (const slot of ['hero', 'rail'] as const) {
    const pin = input.pins?.[slot];
    if (pin) {
      decisions.push({
        slot, order: order++, itemId: pin, strategy: 'pin',
        explain: explainOf([], items.length, ['pinned-by-merchandiser'], 0),
      });
      usedItems.add(pin);
      continue;
    }
    const { scored, gated, refused } = rank(items, slot, usedItems);
    let top = scored[0];
    let wonBy: MeridianExplain['wonBy'];
    // AUDIENCE PRIORITY IS A MERCHANDISER CONTROL. When the visitor is in two
    // or more of the listed audiences at once, the hero stops being a pure
    // arithmetic contest: it must come from the highest-priority entered
    // audience that any eligible candidate matches — score order among those.
    // The receipt names the audience that won and what it won over.
    if (slot === 'hero' && input.audiencePriority && input.audiencePriority.length > 0) {
      const inPriority = input.audiencePriority.filter((a) => input.affinity.audiences.includes(a));
      if (inPriority.length >= 2) {
        for (const audience of inPriority) {
          const winner = scored.find((s) => matchedOf(s.r).includes(audience));
          if (winner) {
            top = winner;
            wonBy = {
              audience,
              priority: input.audiencePriority.indexOf(audience),
              over: inPriority.filter((a) => a !== audience),
            };
            break;
          }
        }
      }
    }
    // Only a slot the page RENDERS may consume an item. The rail is decided for
    // the receipt but has no element, and letting it reserve an item starved the
    // row of a piece nobody could see — the Drover jacket vanished from the shelf
    // mid-story. The hero consumes; the rail does not.
    if (top && slot === 'hero') usedItems.add(top.r.id);
    // Only where the arithmetic chose. An audiencePriority hero comes from one
    // audience on the merchandiser's authority rather than from the field on
    // score, so it beat no field — wonBy is that slot's receipt, and the only one.
    const runnerUp = wonBy ? undefined : runnerUpOf(scored, 0);
    decisions.push({
      slot, order: order++, itemId: top?.r.id,
      strategy: strategyFor(top),
      explain: {
        ...explainOf(top?.drivers ?? [], scored.length, gated, 0, top?.confidence, top?.thetaOut),
        refused: refused.slice(0, 3),
        ...(runnerUp ? { runnerUp: runnerUp.runnerUp, score: runnerUp.score } : {}),
        ...(wonBy ? { wonBy } : {}),
      },
    });
  }

  // ── row: the promotion block, then the standard shelf ────────────────────
  {
    // Structure, not ranking. When the verb dimension says the visitor has
    // chosen, the row stops being a list of alternatives — offering more coats
    // to someone holding a coat is the moment personalization stops helping.
    const stageKey = Object.keys(input.shapeOfKey).find((k) => input.shapeOfKey[k] === 'stage');
    const stageSpec = config.dimensions.find((d) => d.key === stageKey);
    const stageVals = stageKey ? (input.affinity.dims[stageKey] ?? {}) : {};
    // STAGE IS ORDINAL, NOT A POPULARITY CONTEST. Asking whether `deciding` is
    // the highest-scoring stage value was wrong: an email arrival plus one
    // browse click out-accumulates a single add-to-bag, so the natural demo
    // sequence never restructured the row even though the visitor had plainly
    // decided. Someone who added to the bag IS deciding, however much they
    // browsed on the way. The test is membership — is `deciding` above its own
    // threshold — and hysteresis still ends it: when that decays under θ_out
    // the row returns to discovery unattended.
    const decidingA = input.decidingValue ? (stageVals[input.decidingValue] ?? 0) : 0;
    const anchor = input.anchorId ? items.find((i) => i.id === input.anchorId) : undefined;
    const completing = !!anchor
      && !!input.decidingValue
      && decidingA >= (stageSpec?.thetaOut ?? config.thetaOut);
    // The department shelf scopes the row — except when she has committed:
    // complements come from the whole store, never from the bag's own aisle
    // (a Bags shelf minus bags is an empty shelf, which is what shipped).
    const rowPool = completing ? items : (input.rowItems ?? items);

    // THE ROW READS AS A BLOCK. Re-scoring every item let promoted cards land
    // at positions 1–4 and 8–9 with untouched cards between them, and the tail
    // churned under every signal. Promotion now requires membership: the row is
    // [items matching ≥1 entered audience, score order, ties in standard order]
    // followed by [every other eligible item in standard order]. The promoted
    // block is contiguous by construction, and the shelf under it is the shelf
    // every visitor sees, in the catalogue's own order.
    if (completing && anchor) {
      const { scored, gated } = rank(
        // Complementary, not substitutable: a different category to the anchor's.
        rowPool.filter((i) => i.category !== anchor.category),
        'row', usedItems,
      );
      const withMatch = scored.map((s) => ({ ...s, matched: matchedOf(s.r) }));
      // Coherence with the chosen piece is the whole point, so it is scored
      // explicitly and shows up in the receipt as its own driver rather than
      // hiding inside the affinity term. Coherence RANKS the promoted block;
      // it does not promote — only membership does.
      //
      // The contest is kept whole and sliced after, so the member that missed
      // the last place is there to be named as the last card's runner-up.
      const ranked = withMatch
        .filter((s) => s.matched.length > 0)
        .map((s) => {
          const it = s.r as unknown as MeridianItem;
          const drivers = [...s.drivers];
          let bonus = 0;
          if (it.world && it.world === anchor.world) {
            bonus += 0.45; drivers.push({ dim: 'completes', value: `same world · ${anchor.world}`, a: 1, weight: 0.45 });
          }
          const band = (v?: number) => (v == null ? '' : v < 75 ? 'entry' : v < 250 ? 'core' : 'premium');
          if (band(it.value_usd) && band(it.value_usd) === band(anchor.value_usd)) {
            bonus += 0.25; drivers.push({ dim: 'completes', value: `same band · ${band(anchor.value_usd)}`, a: 1, weight: 0.25 });
          }
          const shared = (it.needs ?? []).filter((n) => (anchor.needs ?? []).includes(n));
          if (shared.length) {
            bonus += 0.30; drivers.push({ dim: 'completes', value: `same occasion · ${shared[0]}`, a: 1, weight: 0.30 });
          }
          return { ...s, drivers, score: s.score + bonus };
        })
        .sort((a, b) => b.score - a.score || standardOrder(a.r, b.r));
      const promoted = ranked.slice(0, ROW_BLOCK);  // the first line, same rule
      const inBlock = new Set(promoted.map((s) => s.r.id));
      const standard = withMatch
        .filter((s) => !inBlock.has(s.r.id))
        .sort((a, b) => standardOrder(a.r, b.r));

      [...promoted, ...standard].slice(0, rowSize).forEach((s, i) => {
        usedItems.add(s.r.id);
        const isPromoted = inBlock.has(s.r.id);
        // Only the block was ranked — the shelf under it holds the catalogue's
        // own order, so nothing down there beat anything. Row position i is the
        // block's own index i, which is what the runner-up is measured against.
        const runnerUp = isPromoted ? runnerUpOf(ranked, i) : undefined;
        decisions.push({
          slot: 'row', order: order++, itemId: s.r.id,
          strategy: isPromoted ? 'completion' : 'standard',
          ...(isPromoted ? { anchorId: anchor.id } : {}),
          explain: {
            ...explainOf(s.drivers, scored.length, i === 0 ? gated : [], i, s.confidence, s.thetaOut),
            ...(isPromoted ? { matched: s.matched } : {}),
            ...(runnerUp ? { runnerUp: runnerUp.runnerUp, score: runnerUp.score } : {}),
          },
        });
      });
    } else {
      const { scored, gated } = rank(rowPool, 'row', usedItems);
      const withMatch = scored.map((s) => ({ ...s, matched: matchedOf(s.r) }));
      // COLD START: no audiences of her own yet, but a neighbourhood cohort —
      // the first line is what shoppers like her, from here, actually buy.
      const cohortIds = (input.coldPicks ?? []).filter((id) => rowPool.some((i) => i.id === id));
      if (cohortIds.length && input.affinity.audiences.length === 0) {
        const byIdx = new Map(cohortIds.map((id, i) => [id, i]));
        const block = withMatch.filter((s) => byIdx.has(s.r.id)).sort((a, b) => byIdx.get(a.r.id)! - byIdx.get(b.r.id)!).slice(0, ROW_BLOCK);
        const inBlock = new Set(block.map((s) => s.r.id));
        const standard = withMatch.filter((s) => !inBlock.has(s.r.id)).sort((a, b) => standardOrder(a.r, b.r));
        [...block, ...standard].slice(0, rowSize).forEach((s, i) => {
          usedItems.add(s.r.id);
          const isPick = inBlock.has(s.r.id);
          decisions.push({
            slot: 'row', order: order++, itemId: s.r.id,
            strategy: isPick ? 'cohort' : 'standard',
            explain: explainOf(s.drivers, scored.length, i === 0 ? gated : [], i, s.confidence, s.thetaOut),
          });
        });
      } else {
      // THE PICKS ARE THE FIRST LINE, AND ONLY THE FIRST LINE. With several
      // broad audiences entered, everything on the shelf is a member, and "10
      // promoted" meant the block was the whole row — the picks were nowhere in
      // particular. The row now reads: [the top ROW_BLOCK members by score] then
      // [everything else in the catalogue's own order]. What is selected for
      // her is at the top, contiguous, and nowhere else.
      const ranked = withMatch
        .filter((s) => s.matched.length > 0)
        .sort((a, b) => b.score - a.score || standardOrder(a.r, b.r));
      const block = ranked.slice(0, ROW_BLOCK);
      const inBlock = new Set(block.map((s) => s.r.id));
      const standard = withMatch
        .filter((s) => !inBlock.has(s.r.id))
        .sort((a, b) => standardOrder(a.r, b.r));

      [...block, ...standard].slice(0, rowSize).forEach((s, i) => {
        usedItems.add(s.r.id);
        const isPromoted = inBlock.has(s.r.id);
        // Same rule as completion: the block ranked, the shelf did not.
        const runnerUp = isPromoted ? runnerUpOf(ranked, i) : undefined;
        decisions.push({
          slot: 'row', order: order++, itemId: s.r.id,
          strategy: isPromoted ? 'affinity' : 'standard',
          explain: {
            ...explainOf(s.drivers, scored.length, i === 0 ? gated : [], i, s.confidence, s.thetaOut),
            ...(isPromoted ? { matched: s.matched } : {}),
            ...(runnerUp ? { runnerUp: runnerUp.runnerUp, score: runnerUp.score } : {}),
          },
        });
      });
      }
    }
  }

  // ── blocks: which content leads ──────────────────────────────────────────
  for (const slot of ['block_a', 'block_b'] as const) {
    const pool = blocks.filter((b) => b.slots.includes(slot));
    const { scored, gated } = rank(pool, slot, usedBlocks);
    const top = scored[0];
    if (top) usedBlocks.add(top.r.id);
    const runnerUp = runnerUpOf(scored, 0);
    decisions.push({
      slot, order: order++, blockId: top?.r.id,
      strategy: strategyFor(top),
      explain: {
        ...explainOf(top?.drivers ?? [], scored.length, gated, 0, top?.confidence, top?.thetaOut),
        ...(runnerUp ? { runnerUp: runnerUp.runnerUp, score: runnerUp.score } : {}),
      },
    });
  }

  return decisions;
}
