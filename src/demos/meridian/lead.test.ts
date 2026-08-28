// src/demos/meridian/lead.test.ts
//
// RECENCY LEADS, ACCUMULATION GATES (decision D2, an addition to the spec).
// The scenario the room will see: three clicks on Drover pieces, then one on a
// Linden bag. Linden leads the line dimension at once, Drover must still rank,
// and the Drover audience must persist until it decays out on its own, because
// membership is core's threshold arithmetic and this rule never touches it.
//
// D8 MOVED WHERE THE FLIP IS VISIBLE. Under the families catalogue the three
// Drover clicks are three colourways of ONE family, stacking the same category
// and occasions three deep; with the D4 weights (every browsing verb 1.0) a
// single Linden click can no longer outscore that stack on the UNFILTERED row
// or rail while Drover is still a member — need ω and broad ω outweigh the
// narrow ω the rule discounts. What the rule guarantees on the open page is the
// demotion and the receipt; the outright flip the room watches happens on the
// department shelf she wandered to, which the director filters before the
// Linden click lands. The assertions below pin exactly that.

import { describe, it, expect } from 'vitest';
import {
  apply, tick, snapshot, emptyState, extractTouches, audienceKey, type ReflexState,
} from '@/reflex/core';
import { configFor, SHAPE_OF_KEY, TRAILING, LEAD_BY } from './reflexConfig';
import { itemsFor, blocksFor } from './catalog';
import { compose, scoreOne, SLOT_STRATEGIES, type ComposeInput } from './composer';
import { leadValue, leadWeights, leadSentence } from './lead';
import type { MeridianItem } from './types';

type Lined = MeridianItem & { line: string };
const cfg = configFor('retail');
const items = itemsFor('retail') as readonly Lined[];
const blocks = blocksFor('retail');
const byName = (name: string): Lined => {
  const it = items.find((i) => i.name === name);
  if (!it) throw new Error(`no such item: ${name}`);
  return it;
};
const lineOf = (id?: string) => items.find((i) => i.id === id)?.line;
const lineSpec = cfg.dimensions.find((d) => d.key === 'line')!;

const T0 = 1_700_000_000_000;
const SECOND = 1_000;

function click(state: ReflexState, item: MeridianItem, at: number) {
  const touches = extractTouches(item as unknown as Record<string, unknown>, cfg);
  return apply(state, { action: 'row_click', touches }, at, cfg);
}

/** Three Drover clicks five seconds apart, then one Linden click at +15s. */
function session() {
  const drover = items.filter((i) => i.line === 'Drover');
  expect(drover.length).toBeGreaterThanOrEqual(3);
  let state = emptyState(cfg);
  drover.slice(0, 3).forEach((it, i) => { state = click(state, it, T0 + i * 5 * SECOND).state; });
  const at = T0 + 15 * SECOND;
  state = click(state, byName('Linden Structured Tote · Tan'), at).state;
  return { state, at };
}

const composeAt = (state: ReflexState, at: number, extra: Partial<ComposeInput> = {}) =>
  compose({
    affinity: snapshot(state, at, cfg), items, blocks, config: cfg,
    shapeOfKey: SHAPE_OF_KEY, rowSize: 10, state, ...extra,
  });

/** Hero and rail pinned on other lines, so the row is where Drover and Linden meet. */
const pins = () => ({ hero: byName('Solstice Smoked Vetiver').id, rail: byName('Harlow Aviator · Tortoise').id });

describe('recency leads, accumulation gates (D2)', () => {
  it('flags retail line — and only line — as recency-led, trailing at ×0.25', () => {
    expect(LEAD_BY.line).toBe('recency');
    expect(Object.keys(LEAD_BY)).toEqual(['line']);
    expect(TRAILING.line).toBe(0.25);
  });

  it('leadValue names the most recently touched line, not the most accumulated one', () => {
    const { state, at } = session();
    expect(leadValue(state, 'line')).toBe('Linden');
    const a = snapshot(state, at, cfg).dims.line!;
    expect(a.Drover!).toBeGreaterThan(a.Linden!);          // accumulation still says Drover
    expect(leadValue(emptyState(cfg), 'line')).toBeNull();
  });

  it('leaves membership alone: Drover is still a member, Linden is not', () => {
    const { state, at } = session();
    expect(state.audiences).toContain(audienceKey('line', 'Drover'));
    expect(state.audiences).not.toContain(audienceKey('line', 'Linden'));
    expect(snapshot(state, at, cfg).dims.line!.Drover!).toBeGreaterThanOrEqual(lineSpec.thetaOut!);
  });

  it('weights the lead at full a and every other value at ×trailing; score-led dims get no rule', () => {
    const { state } = session();
    const lw = leadWeights(state, lineSpec)!;
    expect(lw).toMatchObject({ dim: 'line', by: 'recency', lead: 'Linden', trailing: 0.25 });
    expect(lw.weight('Linden')).toBe(1);
    expect(lw.weight('Drover')).toBe(0.25);
    expect(lw.mark('Linden')).toEqual({ lead: 'recency' });
    expect(lw.mark('Drover')).toEqual({ lead: 'trailing', trailing: 0.25, ledBy: 'Linden' });
    expect(leadWeights(state, lineSpec, 0.5)!.weight('Drover')).toBe(0.5);
    expect(leadWeights(state, cfg.dimensions.find((d) => d.key === 'category')!)).toBeNull();
    expect(leadWeights(emptyState(cfg), lineSpec)).toBeNull();
  });

  it('demotes the trailing family on the row, and the shelf she wandered to leads Linden', () => {
    const { state, at } = session();
    const input: ComposeInput = {
      affinity: snapshot(state, at, cfg), items, blocks, config: cfg,
      shapeOfKey: SHAPE_OF_KEY, rowSize: 10, state,
    };
    const jacket = items.find((i) => i.line === 'Drover')!;
    const tote = byName('Linden Structured Tote · Tan');
    const rec = (i: MeridianItem) => i as unknown as Record<string, unknown>;

    // The rule demotes the trailing family's pieces and leaves the lead's alone,
    // so the gap between them narrows against the documented decay-only control.
    const jWith = scoreOne(rec(jacket), input, SLOT_STRATEGIES.row).score;
    const jWithout = scoreOne(rec(jacket), { ...input, state: undefined }, SLOT_STRATEGIES.row).score;
    const tWith = scoreOne(rec(tote), input, SLOT_STRATEGIES.row).score;
    const tWithout = scoreOne(rec(tote), { ...input, state: undefined }, SLOT_STRATEGIES.row).score;
    expect(jWith).toBeLessThan(jWithout);
    expect(tWith).toBeCloseTo(tWithout, 6);
    expect(jWith - tWith).toBeLessThan(jWithout - tWithout);

    // Both families rank on the open row: Drover on its stacked accumulation
    // (three colourways of one family — that is D8 working as intended), Linden
    // lifted by the rule.
    const linesInRow = composeAt(state, at, { pins: pins() })
      .filter((d) => d.slot === 'row').map((d) => lineOf(d.itemId));
    expect(linesInRow).toContain('Drover');
    expect(linesInRow).toContain('Linden');

    // The shelf the room is actually looking at — the director pressed the Bags
    // department before this click — leads Linden at once.
    const shelf = composeAt(state, at, { items: items.filter((i) => i.category === 'Bags'), pins: pins() })
      .filter((d) => d.slot === 'row').map((d) => lineOf(d.itemId));
    expect(shelf[0]).toBe('Linden');
  });

  it('carries the recency lead in the rail receipt while the hero keeps to the slow axes', () => {
    const { state, at } = session();
    const ds = composeAt(state, at);
    // Whichever piece the rail ranks, its line driver is governed by the lead:
    // Linden marked as leading by recency, or the ranked line marked trailing it.
    const railLine = ds.find((d) => d.slot === 'rail')!.explain.drivers.find((x) => x.dim === 'line')!;
    if (railLine.value === 'Linden') expect(railLine.lead).toBe('recency');
    else expect(railLine).toMatchObject({ lead: 'trailing', ledBy: 'Linden' });
    expect(lineOf(ds.find((d) => d.slot === 'hero')?.itemId)).toBe('Drover');
  });

  it('records in the receipt which value led and why', () => {
    const { state, at } = session();
    const row = composeAt(state, at, { pins: pins() }).filter((d) => d.slot === 'row');
    const linden = row.find((d) => lineOf(d.itemId) === 'Linden')!;
    const drover = row.find((d) => lineOf(d.itemId) === 'Drover')!;

    expect(linden.explain.drivers).toContainEqual(
      expect.objectContaining({ dim: 'line', value: 'Linden', lead: 'recency' }));
    expect(drover.explain.drivers).toContainEqual(
      expect.objectContaining({ dim: 'line', value: 'Drover', lead: 'trailing', trailing: 0.25, ledBy: 'Linden' }));

    // The driver's a is the honest affinity; the weight is what it actually contributed.
    const d = drover.explain.drivers.find((x) => x.dim === 'line')!;
    expect(d.a).toBeGreaterThan(lineSpec.thetaOut!);
    expect(d.weight).toBeCloseTo(0.25 * d.a * 0.25, 3);     // ω_row(narrow) · a · trailing

    expect(leadSentence(drover.explain.drivers)).toBe('line · Linden led by recency; Drover trailing ×0.25');
    expect(leadSentence(linden.explain.drivers)).toBe('line · Linden led by recency');
    expect(leadSentence([])).toBe('');
  });

  it('lets Drover exit on its own once its affinity decays under θ_out', () => {
    const { state, at } = session();
    // Horizons come from the dimension's own τ so the test survives retuning —
    // the demo clocks were slowed 4× so a profile survives a conversation.
    const tau = cfg.dimensions.find((d) => d.key === 'line')!.tauMs ?? cfg.tauMs;
    const still = tick(state, at + tau / 8, cfg);
    expect(still.state.audiences).toContain(audienceKey('line', 'Drover'));
    expect(leadValue(still.state, 'line')).toBe('Linden');

    const later = tick(state, at + 4 * tau, cfg);
    expect(later.state.audiences).not.toContain(audienceKey('line', 'Drover'));
    expect(later.changes.exited).toContain(audienceKey('line', 'Drover'));
    expect(later.changes.explain).toContainEqual(
      expect.objectContaining({ audience: 'line_drover_affinity', direction: 'exit' }));
  });
});
