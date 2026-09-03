// src/learn/phase2.test.ts
// Exploration is deterministic in its inputs and honest on the receipt; the
// item controls hold or ignore a lift; the autonomy cycle proposes one bounded
// move with its evidence, applies it only in autonomous mode, and a person's
// decision on a proposal is a versioned revision either way.

import { describe, it, expect } from 'vitest';
import type { Env } from '@/types/env';
import { betaSample, bucketOf, explorationPick, hourKeyOf } from './explore';
import { applyProposal, DEFAULT_AUTONOMY, evidenceFor, proposeFor } from './autonomy';
import { decideProposal, PROPOSALS_KIND, runCycle } from './cycle';
import { decideContent } from '@/content/decide';
import { write, invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { liftKey } from './fan';
import type { LiftSnapshot } from './stats';
import type { ContentPiece, SlotStrategy } from '@/content/types';

const T0 = 1_725_000_000_000;
const snap = (items: Record<string, { n: number; s: number; lift: number }>, slotN = 1000): LiftSnapshot => ({
  tenant: 'coach', brand: 'coach', slot: 'hero', reward: 'click', version: 5, publishedAt: 5, events: slotN, n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2,
  items: Object.fromEntries(Object.entries(items).map(([id, x]) => [id, { '*': { level: 0 as const, key: '*', n: x.n, s: x.s, p0: 0.1, p_hat: 0.1 * x.lift, lift: x.lift } }])),
  slotRates: { '*': { n: slotN, s: slotN * 0.1, rate: 0.1 } },
});
const ranked = [{ id: 'a', score: 0.5 }, { id: 'b', score: 0.4 }, { id: 'c', score: 0.3 }];

describe('exploration', () => {
  it('rotation: a bucket under the share serves the least-observed under-observed item; over it, nothing', () => {
    const cfg = { mode: 'rotation' as const, share: 0.5, floor: 50 };
    const s = snap({ a: { n: 500, s: 60, lift: 1.2 }, b: { n: 3, s: 0, lift: 1 }, c: { n: 10, s: 1, lift: 1 } });
    // Find a visitor id in the bucket and one out of it, so the test does not depend on a particular hash.
    const ids = Array.from({ length: 200 }, (_, i) => `v${i}`);
    const inn = ids.find((v) => bucketOf(v, 'hero', hourKeyOf(T0)) < 0.5)!;
    const out = ids.find((v) => bucketOf(v, 'hero', hourKeyOf(T0)) >= 0.5)!;
    const pick = explorationPick({ visitorId: inn, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg })!;
    expect(pick.mode).toBe('rotation'); expect(pick.pieceId).toBe('b'); expect(pick.reason).toContain('n 3 < floor 50');
    expect(explorationPick({ visitorId: out, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg })).toBeNull();
    // Nothing under-observed: nothing to explore, whatever the bucket.
    expect(explorationPick({ visitorId: inn, slot: 'hero', nowMs: T0, ranked, snapshot: snap({ a: { n: 500, s: 60, lift: 1 }, b: { n: 500, s: 50, lift: 1 }, c: { n: 500, s: 50, lift: 1 } }), cfg })).toBeNull();
    expect(explorationPick({ visitorId: inn, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg: { ...cfg, mode: 'off' } })).toBeNull();
    // Deterministic: the same inputs pick the same thing; a new hour may not.
    expect(explorationPick({ visitorId: inn, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg })).toEqual(pick);
  });

  it('thompson: ranks on a seeded sample, flags only when the sample disagrees, and the sample is recomputable', () => {
    const s = snap({ a: { n: 1000, s: 100, lift: 1 }, b: { n: 4, s: 3, lift: 1.5 }, c: { n: 1000, s: 50, lift: 0.5 } });
    const cfg = { mode: 'thompson' as const, share: 1, floor: 0 };
    let flagged = 0;
    for (let i = 0; i < 200; i++) {
      const p = explorationPick({ visitorId: `t${i}`, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg });
      if (p) { flagged++; expect(p.samples).toBeDefined(); expect(p.ranking![0]).toBe(p.pieceId); expect(explorationPick({ visitorId: `t${i}`, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg })).toEqual(p); }
    }
    expect(flagged).toBeGreaterThan(20);      // b's wide posterior wins often
    expect(flagged).toBeLessThan(200);
    const rng = () => 0.5;
    expect(betaSample(rng, 1, 1)).toBeGreaterThan(0);
  });

  it('epsilon: uniform inside the share, never flags the leader as an exploration', () => {
    const cfg = { mode: 'epsilon' as const, share: 1, floor: 0 };
    const picks = new Set<string | null>();
    for (let i = 0; i < 100; i++) picks.add(explorationPick({ visitorId: `e${i}`, slot: 'hero', nowMs: T0, ranked, snapshot: null, cfg })?.pieceId ?? null);
    expect(picks.has('b') && picks.has('c')).toBe(true);
    expect(picks.has('a')).toBe(false);
  });
});

const piece = (id: string, tags: Record<string, string[]>, slots: string[]): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: slots, lifecycle: { status: 'live' } });
const pieces = [piece('a', { occasion: ['evening'], line: ['drover'] }, ['hero']), piece('d', { occasion: ['evening'] }, ['hero']), piece('n', { occasion: ['weekend'] }, ['hero'])];
const slots: SlotStrategy[] = [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }];
const base = {
  tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor' as const, nowMs: T0,
  pieces, slots, affinity: { dims: { occasion: { evening: 0.8 }, line: { drover: 0.7 } } },
  cell: { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: 'occasion:evening' },
  arm: 'personalized' as const, versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'v1',
};

describe('the decision with exploration and controls', () => {
  it('an exploration pick is served first, flagged, and explained; the holdout arm never explores', () => {
    const s = snap({ a: { n: 500, s: 60, lift: 1.2 }, d: { n: 500, s: 50, lift: 1 }, n: { n: 2, s: 0, lift: 1 } });
    const inn = Array.from({ length: 300 }, (_, i) => `x${i}`).find((v) => bucketOf(v, 'hero', hourKeyOf(T0)) < 0.5)!;
    const out = decideContent({ ...base, visitorId: inn, learning: { snapshots: { hero: s }, gammaOf: () => 0, exploreOf: () => ({ mode: 'rotation', share: 0.5, floor: 50 }) } });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.item_id).toBe('n'); expect(hero.explored).toBe(true);
    expect(hero.explain.exploration).toMatchObject({ mode: 'rotation', reason: expect.stringContaining('under-observed') });
    expect(hero.candidates[0]!.contentId).toBe('n');
    const held = decideContent({ ...base, visitorId: inn, arm: 'default', learning: { snapshots: { hero: s }, gammaOf: () => 0, exploreOf: () => ({ mode: 'rotation', share: 1, floor: 50 }) } });
    expect(held.records.find((r) => r.slot === 'hero')!.explored).toBe(false);
  });

  it('reject ignores an item\'s lift; freeze holds it at the chosen value', () => {
    const s = snap({ a: { n: 500, s: 10, lift: 0.5 }, d: { n: 500, s: 50, lift: 2 } });
    const learning = (items: Record<string, { mode: 'reject' | 'freeze'; lift?: number }>) => ({ snapshots: { hero: s }, gammaOf: () => 1, controlOf: (_slot: string, item: string) => items[item] ?? null });
    const plain = decideContent({ ...base, learning: learning({}) });
    expect(plain.records.find((r) => r.slot === 'hero')!.item_id).toBe('d');   // 0.28 × 2 beats 0.455 × 0.5
    // Doc 22 §12.2: reject ignores the learned lift for the item, which then competes on its base score
    // alone. d keeps the slot on base (0.28) because a's lift of 0.5 halves a to 0.2275; the receipt says so.
    const rejected = decideContent({ ...base, learning: learning({ d: { mode: 'reject' } }) });
    const hr = rejected.records.find((r) => r.slot === 'hero')!;
    expect(hr.item_id).toBe('d'); expect(hr.explain.control).toBe('reject'); expect(hr.explain.lift).toBeNull();
    expect(hr.explain.score_final).toBeCloseTo(0.28, 3);
    expect(hr.candidates.find((c) => c.contentId === 'a')!.score).toBeCloseTo(0.455 * 0.5, 2);   // candidate scores are rounded to 3 decimals
    const frozen = decideContent({ ...base, learning: learning({ a: { mode: 'freeze', lift: 3 } }) });
    const hf = frozen.records.find((r) => r.slot === 'hero')!;
    expect(hf.item_id).toBe('a'); expect(hf.explain.control).toBe('freeze'); expect(hf.explain.lift).toMatchObject({ lift: 3, level_words: 'frozen by a merchandiser' });
    expect(hf.explain.score_final).toBeCloseTo(0.455 * 3, 3);
  });
});

class FakeKV { store = new Map<string, string>(); async get(k: string) { const r = this.store.get(k); return r === undefined ? null : JSON.parse(r); } async put(k: string, v: string) { this.store.set(k, v); } }

describe('the autonomy cycle', () => {
  const tags = { a: { occasion: ['evening'], line: ['drover'] }, d: { occasion: ['evening'] }, n: { occasion: ['weekend'] } };
  const weights = { occasion: 0.35, line: 0.25 };

  it('evidence groups lift by tag value per weighted dimension; the proposal raises the most discriminating one by one step', () => {
    const s = snap({ a: { n: 400, s: 60, lift: 1.5 }, d: { n: 400, s: 40, lift: 1 }, n: { n: 400, s: 20, lift: 0.5 } }, 1200);
    const ev = evidenceFor(weights, tags, s);
    expect(ev[0]!.dimension).toBe('occasion');
    expect(ev[0]!.values.evening.meanLift).toBeCloseTo(1.25, 2);
    expect(ev[0]!.values.weekend.meanLift).toBe(0.5);
    expect(ev[0]!.spread).toBeCloseTo(0.75, 2);
    expect(ev[1]!.spread).toBe(0);                                                  // line has one value: nothing to separate
    const cfg = { ...DEFAULT_AUTONOMY, mode: 'assisted' as const, minN: 500 };
    const { proposal, reason } = proposeFor({ tenant: 'coach', brand: 'coach', slot: 'hero' }, weights, tags, s, cfg, T0);
    expect(proposal).toMatchObject({ dimension: 'occasion', from: 0.35, to: 0.4, status: 'proposed', exposures: 1200 });
    expect(reason).toContain('occasion');
    expect(proposeFor({ tenant: 'coach', brand: 'coach', slot: 'hero' }, weights, tags, s, { ...cfg, minN: 5000 }, T0).proposal).toBeNull();
    expect(proposeFor({ tenant: 'coach', brand: 'coach', slot: 'hero' }, weights, tags, s, { ...cfg, pinned: ['occasion'] }, T0).proposal).toBeNull();
    expect(proposeFor({ tenant: 'coach', brand: 'coach', slot: 'hero' }, weights, tags, s, { ...cfg, mode: 'configured' }, T0).proposal).toBeNull();
    expect(applyProposal(weights, { dimension: 'occasion', to: 1.7 }, cfg)).toEqual({ occasion: 1, line: 0.25 });
  });

  it('assisted writes a proposal; a person applies it as a new slots revision; autonomous applies within bounds itself', async () => {
    invalidateCache();
    const kv = new FakeKV(); const env = { CACHE: kv } as unknown as Env;
    await write(env, CONTENT_KIND, 'coach', { pieces }, { actor: 't' });
    await write(env, SLOTS_KIND, 'coach', { pages: { home: slots } }, { actor: 't' });
    await write(env, LEARN_KIND, 'coach', { holdout: { share: 0, arms: ['default'] }, slots: { hero: { autonomy: { mode: 'assisted', step: 0.05, min: 0, max: 1, pinned: [], minN: 100 } } } }, { actor: 't' });
    await kv.put(liftKey('coach', 'coach', 'hero'), JSON.stringify(snap({ a: { n: 400, s: 60, lift: 1.5 }, d: { n: 400, s: 40, lift: 1 }, n: { n: 400, s: 20, lift: 0.5 } }, 1200)));
    const r1 = await runCycle(env, 'coach', 'coach', T0, 'cron');
    expect(r1).toEqual([expect.objectContaining({ slot: 'hero', action: 'proposed' })]);
    const id = r1[0]!.proposal!.id;
    const applied = await decideProposal(env, 'coach', id, 'apply', 'ops', T0 + 1);
    expect(applied).toMatchObject({ ok: true, revision: 2 });
    const slotsNow = JSON.parse(kv.store.get('slots:config:coach:current')!);
    expect(slotsNow.value.pages.home[0].weights.occasion).toBe(0.4);
    expect(slotsNow.note).toContain('applied by ops');
    expect((await decideProposal(env, 'coach', id, 'apply', 'ops')).ok).toBe(false);   // already applied
    // Autonomous: the same evidence, applied by the cycle itself, evidence in the note.
    invalidateCache();
    await write(env, LEARN_KIND, 'coach', { holdout: { share: 0, arms: ['default'] }, slots: { hero: { autonomy: { mode: 'autonomous', step: 0.05, min: 0, max: 1, pinned: [], minN: 100 } } } }, { actor: 't' });
    const r2 = await runCycle(env, 'coach', 'coach', T0 + 2, 'cron');
    expect(r2[0]).toMatchObject({ action: 'applied', revision: 3 });
    const after = JSON.parse(kv.store.get('slots:config:coach:current')!);
    expect(after.value.pages.home[0].weights.occasion).toBeCloseTo(0.45, 3);
    expect(after.note).toContain('autonomous cycle');
    const proposals = JSON.parse(kv.store.get('proposals:config:coach:current')!);
    expect(proposals.value.proposals.map((p: { status: string }) => p.status)).toEqual(['applied', 'applied']);
    expect(PROPOSALS_KIND.name).toBe('proposals');
  });
});
