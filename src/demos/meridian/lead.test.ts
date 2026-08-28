// src/demos/meridian/lead.test.ts
//
// RECENCY LEADS, ACCUMULATION GATES (decision D2, an addition to the spec).
// The scenario the room will see: three clicks on Drover pieces, then one on a
// Linden bag. Linden must lead the page at once, Drover must still rank —
// weakly — and the Drover audience must persist until it decays out on its own,
// because membership is core's threshold arithmetic and this rule never touches it.

import { describe, it, expect } from 'vitest';
import {
  apply, tick, snapshot, emptyState, extractTouches, audienceKey, type ReflexState,
} from '@/reflex/core';
import { configFor, SHAPE_OF_KEY, TRAILING, LEAD_BY } from './reflexConfig';
import { itemsFor, blocksFor } from './catalog';
import { compose, type ComposeInput } from './composer';
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
  state = click(state, byName('Linden Structured Tote'), at).state;
  return { state, at };
}

const composeAt = (state: ReflexState, at: number, extra: Partial<ComposeInput> = {}) =>
  compose({
    affinity: snapshot(state, at, cfg), items, blocks, config: cfg,
    shapeOfKey: SHAPE_OF_KEY, rowSize: 10, state, ...extra,
  });

/** Hero and rail pinned on other lines, so the row is where Drover and Linden meet. */
const pins = () => ({ hero: byName('Solstice Smoked Vetiver').id, rail: byName('Harlow Acetate Aviator').id });

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

  it('ranks a Linden item above the Drover items for the row — and would not without the rule', () => {
    const { state, at } = session();
    const row = composeAt(state, at, { pins: pins() }).filter((d) => d.slot === 'row');
    const linesInRow = row.map((d) => lineOf(d.itemId));
    expect(linesInRow[0]).toBe('Linden');
    const firstDrover = linesInRow.indexOf('Drover');
    expect(firstDrover).toBeGreaterThan(0);                  // still ranks — weakly
    expect(linesInRow.indexOf('Linden')).toBeLessThan(firstDrover);

    // The control: same state, no lead information — the documented, decay-only algorithm.
    const control = composeAt(state, at, { pins: pins(), state: undefined })
      .filter((d) => d.slot === 'row').map((d) => lineOf(d.itemId));
    expect(control[0]).toBe('Drover');
  });

  it('answers the last thing she did on the rail while the hero keeps to the slow axes', () => {
    const { state, at } = session();
    const ds = composeAt(state, at);
    expect(lineOf(ds.find((d) => d.slot === 'rail')?.itemId)).toBe('Linden');
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
