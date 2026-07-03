// @vitest-environment node
// src/reflex/choreography.test.ts
// The affinity → content choreography (doc 16 §10): a line-affinity MEMBERSHIP
// wins the hero + sort; no membership (or decayed out) → falls back → reverts.
import { describe, expect, it } from 'vitest';
import { MockDecisionProvider } from '@/connectors/DecisionProvider';

const provider = new MockDecisionProvider();

const MEMBER_SEGMENTS = [
  'line_tabby_affinity',
  'category_handbags_affinity',
  'silhouette_shoulder_affinity',
  'early_journey_cold_start',
];
const AFFINITY_ATTRS = {
  line_affinity_top: 'Tabby',
  'line_affinity.tabby': 0.6198,
};

describe('affinity choreography — decisions', () => {
  it('a line-affinity MEMBER wins the hero with the anchor + score', async () => {
    const d = await provider.decide('hero_module', 'u1', MEMBER_SEGMENTS, AFFINITY_ATTRS);
    expect(d.variationKey).toBe('affinity_hero');
    expect(d.variables.module).toBe('affinity_hero');
    expect(d.variables.anchorLine).toBe('Tabby');
    expect(d.variables.affinityScore).toBeCloseTo(0.6198, 4);
    expect(d.ruleKey).toBe('line_tabby_affinity');
    expect(d.reason).toBe('experiment');
  });

  it('the same membership drives the sort (line_first, anchored)', async () => {
    const d = await provider.decide('plp_sort', 'u1', MEMBER_SEGMENTS, AFFINITY_ATTRS);
    expect(d.variationKey).toBe('line_first');
    expect(d.variables.anchorLine).toBe('Tabby');
    expect(d.ruleKey).toBe('line_tabby_affinity');
  });

  it('a LEADING score without membership does NOT hijack the hero (hysteresis is server truth)', async () => {
    // attributes say Tabby leads, but the audience is not in segments (below θ_in, or decayed out)
    const d = await provider.decide('hero_module', 'u1', ['early_journey_cold_start'], AFFINITY_ATTRS);
    expect(d.variationKey).not.toBe('affinity_hero');
  });

  it('membership decayed out → decisions revert (the visible "walk away" beat)', async () => {
    const before = await provider.decide('hero_module', 'u1', MEMBER_SEGMENTS, AFFINITY_ATTRS);
    const after = await provider.decide('hero_module', 'u1', ['early_journey_cold_start'], {});
    expect(before.variationKey).toBe('affinity_hero');
    expect(after.variationKey).not.toBe('affinity_hero');
  });

  it('multi-word lines slug correctly (Pillow Tabby → line_pillow_tabby_affinity)', async () => {
    const d = await provider.decide(
      'hero_module',
      'u1',
      ['line_pillow_tabby_affinity'],
      { line_affinity_top: 'Pillow Tabby', 'line_affinity.pillow_tabby': 0.71 }
    );
    expect(d.variationKey).toBe('affinity_hero');
    expect(d.variables.anchorLine).toBe('Pillow Tabby');
  });

  it('non-hero flags are untouched by affinity (promo/journey stay seed-driven)', async () => {
    const d = await provider.decide('promo_banner', 'u1', MEMBER_SEGMENTS, AFFINITY_ATTRS);
    expect(d.variables.module).not.toBe('affinity_hero');
  });
});
