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
// outrank the engine, and weighted ranking operates only on what is left.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReflexConfig } from '@/reflex/core';
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
export const SLOT_STRATEGIES: Record<MeridianSlot, Record<string, number>> = {
  // Each slot's HIGHEST-weighted shape is its lead, and the lead is what decides
  // whether the slot may still claim the visitor as its reason. Leads are chosen
  // so that the three surfaces sit on three different decay constants — narrow
  // (60s), broad (90s), need (120s) — which is what turns one stretch of
  // inactivity into three separate, nameable retreats instead of one collapse.
  //
  // The hero commits. It leans on the slow axes so it does not flap.
  hero:    { broad: 0.35, durable: 0.30, need: 0.20, band: 0.15, narrow: 0.00, content: 0.00 , stage: 0.00 },
  // The rail is fast-twitch: it answers the last thing you did.
  rail:    { narrow: 0.40, broad: 0.30, need: 0.20, band: 0.10, durable: 0.00, content: 0.00 , stage: 0.00 },
  // The row ranks merchandise. Led by NEED rather than narrow so it outlives the
  // rail — a row about "things for a project" stays true longer than a row about
  // "cordless sanders specifically".
  row:     { need: 0.30, narrow: 0.25, broad: 0.25, band: 0.15, durable: 0.05, content: 0.00 , stage: 0.00 },
  // Blocks are content: what KIND of asset earns attention matters most.
  block_a: { content: 0.35, broad: 0.25, need: 0.20, durable: 0.20, narrow: 0.00, band: 0.00 , stage: 0.00 },
  block_b: { content: 0.35, broad: 0.25, need: 0.20, durable: 0.20, narrow: 0.00, band: 0.00 , stage: 0.00 },
};

export interface ComposeInput {
  affinity: AffinityView;
  items: readonly MeridianItem[];
  blocks: readonly MeridianBlock[];
  config: ReflexConfig;
  /** dimension shape lookup, from reflexConfig.SHAPE_OF_KEY */
  shapeOfKey: Readonly<Record<string, string>>;
  /** Merchandiser authority. Outranks the engine and survives regeneration. */
  pins?: Partial<Record<MeridianSlot, string>>;
  rowSize?: number;
  /** The piece the visitor committed to. Only meaningful once stage says deciding. */
  anchorId?: string;
  /** The stage value that means "has chosen": `deciding`, or `applying`. */
  decidingValue?: string;
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

function scoreOne(
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

    for (const [value, a] of Object.entries(perValue)) {
      if (a <= 0) continue;
      const m =
        spec.derive === 'band' && spec.cuts && spec.labels
          ? bandLabel(Number(record[spec.source] ?? 0), spec.cuts, spec.labels) === value ? 1 : 0
          : match(record, spec.source, value);
      if (m === 0) continue;
      const contribution = omega * a * m;
      score += contribution;
      drivers.push({ dim: spec.key, value, a: round(a), weight: round(contribution) });
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
    drivers: drivers.slice(0, 4),
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
    const top = scored[0];
    if (top) usedItems.add(top.r.id);
    decisions.push({
      slot, order: order++, itemId: top?.r.id,
      strategy: strategyFor(top),
      explain: {
        ...explainOf(top?.drivers ?? [], scored.length, gated, 0, top?.confidence, top?.thetaOut),
        refused: refused.slice(0, 3),
      },
    });
  }

  // ── row: the ranked list, or the completion set ──────────────────────────
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

    if (completing && anchor) {
      const { scored, gated } = rank(
        // Complementary, not substitutable: a different category to the anchor's.
        items.filter((i) => i.category !== anchor.category),
        'row', usedItems,
      );
      // Coherence with the chosen piece is the whole point, so it is scored
      // explicitly and shows up in the receipt as its own driver rather than
      // hiding inside the affinity term.
      const cohered = scored.map((s) => {
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
      }).sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));

      cohered.slice(0, rowSize).forEach((s, i) => {
        usedItems.add(s.r.id);
        decisions.push({
          slot: 'row', order: order++, itemId: s.r.id, strategy: 'completion',
          anchorId: anchor.id,
          explain: explainOf(s.drivers, cohered.length, i === 0 ? gated : [], i, s.confidence, s.thetaOut),
        });
      });
    } else {
      const { scored, gated } = rank(items, 'row', usedItems);
      scored.slice(0, rowSize).forEach((s, i) => {
        usedItems.add(s.r.id);
        decisions.push({
          slot: 'row', order: order++, itemId: s.r.id,
          strategy: strategyFor(s),
          explain: explainOf(s.drivers, scored.length, i === 0 ? gated : [], i, s.confidence, s.thetaOut),
        });
      });
    }
  }

  // ── blocks: which content leads ──────────────────────────────────────────
  for (const slot of ['block_a', 'block_b'] as const) {
    const pool = blocks.filter((b) => b.slots.includes(slot));
    const { scored, gated } = rank(pool, slot, usedBlocks);
    const top = scored[0];
    if (top) usedBlocks.add(top.r.id);
    decisions.push({
      slot, order: order++, blockId: top?.r.id,
      strategy: strategyFor(top),
      explain: explainOf(top?.drivers ?? [], scored.length, gated, 0, top?.confidence, top?.thetaOut),
    });
  }

  return decisions;
}
