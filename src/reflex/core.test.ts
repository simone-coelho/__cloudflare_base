// @vitest-environment node
// src/reflex/core.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// ReflexCore test suite (doc 16 §12): golden event-stream timeline + property
// invariants. The core is pure — these tests ARE the engine's spec.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REFLEX_CONFIG,
  affinityAttrKey,
  affinityOf,
  apply,
  attributesFrom,
  audienceKey,
  effectiveScore,
  emptyState,
  extractTouches,
  nextCrossing,
  slugValue,
  snapshot,
  tick,
  type ReflexConfig,
  type ReflexState,
} from './core';

const CFG: ReflexConfig = DEFAULT_REFLEX_CONFIG; // τ=60s · K=1.8 · θ 0.6/0.45

// Product fixtures (ProductLike — the core is catalog-agnostic).
const TABBY = {
  id: 'A', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['evening', 'everyday'], price_usd: 475,
};
const BROOKLYN_TOTE = {
  id: 'B', line: 'Brooklyn', category: 'Handbags', subcategory: 'Totes & Carryalls',
  silhouette: 'tote', occasion: ['work', 'everyday'], price_usd: 350,
};

const view = (p: Record<string, unknown>) => ({ action: 'product_view', touches: extractTouches(p, CFG) });
const t0 = 1_000_000;

/** Independent recomputation of the decayed accumulator for golden checks. */
function seriesScore(gapsMs: number[], tau = CFG.tauMs): number {
  // views at t0, t0+g1, t0+g1+g2… each contributing weight 1, valued at the last view time
  let elapsed = 0;
  const times: number[] = [0];
  for (const g of gapsMs) times.push((elapsed += g));
  const end = times[times.length - 1];
  return times.reduce((sum, t) => sum + Math.exp(-(end - t) / tau), 0);
}

describe('naming (single source of truth for P1)', () => {
  it('slugs values deterministically', () => {
    expect(slugValue('Totes & Carryalls')).toBe('totes_carryalls');
    expect(slugValue('Date-Night')).toBe('date_night');
    expect(slugValue('  Tabby  ')).toBe('tabby');
  });
  it('namespaces audience keys by dimension', () => {
    expect(audienceKey('line', 'Tabby')).toBe('line_tabby_affinity');
    expect(audienceKey('occasion', 'work')).toBe('occasion_work_affinity');
    expect(audienceKey('priceBand', 'entry')).toBe('priceband_entry_affinity');
  });
  it('flattens attribute keys for evaluateCondition', () => {
    expect(affinityAttrKey('line', 'Tabby')).toBe('line_affinity.tabby');
  });
});

describe('extractTouches (catalog-agnostic)', () => {
  it('extracts scalar, multi, and derived-band dimensions', () => {
    const touches = extractTouches(TABBY, CFG);
    expect(touches).toEqual([
      { dim: 'line', value: 'Tabby' },
      { dim: 'category', value: 'Handbags' },
      { dim: 'subcategory', value: 'Shoulder Bags' },
      { dim: 'silhouette', value: 'shoulder' },
      { dim: 'occasion', value: 'evening' },
      { dim: 'occasion', value: 'everyday' },
      { dim: 'priceBand', value: 'elevated' },
    ]);
  });
  it('band edges: <150 entry · [150,400) core · ≥400 elevated', () => {
    const band = (price_usd: number) =>
      extractTouches({ price_usd }, CFG).find((t) => t.dim === 'priceBand')?.value;
    expect(band(149.99)).toBe('entry');
    expect(band(150)).toBe('core');
    expect(band(399.99)).toBe('core');
    expect(band(400)).toBe('elevated');
  });
  it('ignores missing/empty fields', () => {
    expect(extractTouches({}, CFG)).toEqual([]);
    expect(extractTouches({ line: '', occasion: [] }, CFG)).toEqual([]);
  });
});

describe('golden timeline — enter, shift, hysteresis hold, decay-out', () => {
  it('replays the scripted stream to the exact membership timeline', () => {
    // ── Beat 1: three brisk Tabby views (5s apart) → enter on the 3rd ──
    let r = apply(undefined, view(TABBY), t0, CFG);
    expect(r.state.audiences).toEqual([]); // a = 1/2.8 ≈ 0.357

    r = apply(r.state, view(TABBY), t0 + 5_000, CFG);
    expect(r.state.audiences).toEqual([]); // a ≈ 0.516 < 0.6

    r = apply(r.state, view(TABBY), t0 + 10_000, CFG);
    const R3 = seriesScore([5_000, 5_000]); // e^(-10/60)+e^(-5/60)+1 ≈ 2.766526
    const a3 = affinityOf(R3, CFG.K);
    expect(a3).toBeGreaterThanOrEqual(CFG.thetaIn); // ≈ 0.6058 — the 3-view entry
    const tabbySet = [
      'category_handbags_affinity',
      'line_tabby_affinity',
      'occasion_evening_affinity',
      'occasion_everyday_affinity',
      'priceband_elevated_affinity',
      'silhouette_shoulder_affinity',
      'subcategory_shoulder_bags_affinity',
    ];
    expect(r.changes.entered).toEqual(tabbySet);
    expect(r.state.audiences).toEqual(tabbySet);
    // Explain: every entry records score ≥ θ_in and the triggering action.
    for (const e of r.changes.explain) {
      expect(e.direction).toBe('enter');
      expect(e.score).toBeGreaterThanOrEqual(CFG.thetaIn);
      expect(e.trigger).toBe('product_view');
      expect(e.configVersion).toBe(CFG.version);
    }

    // ── nextCrossing: closed-form exit time for the freshly-entered set ──
    // All entries share s=R3 at t0+10s → t* = t + τ·ln(R·(1−θout)/(K·θout))
    const floor = (CFG.K * CFG.thetaOut) / (1 - CFG.thetaOut);
    const expectedTStar = t0 + 10_000 + CFG.tauMs * Math.log(R3 / floor);
    const cross = nextCrossing(r.state, t0 + 10_000, CFG);
    expect(cross).not.toBeNull();
    expect(Math.abs((cross as number) - expectedTStar)).toBeLessThan(1); // exact math

    // ── Beat 2: shift to Brooklyn totes (3 views, 5s apart) ──
    r = apply(r.state, view(BROOKLYN_TOTE), t0 + 15_000, CFG);
    r = apply(r.state, view(BROOKLYN_TOTE), t0 + 20_000, CFG);
    r = apply(r.state, view(BROOKLYN_TOTE), t0 + 25_000, CFG);
    // Brooklyn set enters; Tabby holds via hysteresis (a ≈ 0.545 ∈ [θout, θin)).
    expect(r.changes.entered).toEqual([
      'line_brooklyn_affinity',
      'occasion_work_affinity',
      'priceband_core_affinity',
      'silhouette_tote_affinity',
      'subcategory_totes_carryalls_affinity',
    ]);
    expect(r.changes.exited).toEqual([]);
    const tabbyEffAt25 = R3 * Math.exp(-15_000 / CFG.tauMs);
    const tabbyA25 = affinityOf(tabbyEffAt25, CFG.K);
    expect(tabbyA25).toBeLessThan(CFG.thetaIn); // below enter…
    expect(tabbyA25).toBeGreaterThanOrEqual(CFG.thetaOut); // …but above exit → held

    // ── Beat 3: idle to t0+55s → Tabby-only dims decay OUT; Brooklyn holds.
    // priceBand rides a slower per-dimension τ (150s) — price posture outlasts
    // product interest, so elevated is NOT in this exit wave.
    const r55 = tick(r.state, t0 + 55_000, CFG);
    expect(r55.changes.exited).toEqual([
      'line_tabby_affinity',
      'occasion_evening_affinity',
      'silhouette_shoulder_affinity',
      'subcategory_shoulder_bags_affinity',
    ]);
    expect(r55.state.audiences).toContain('priceband_elevated_affinity'); // slower τ → still holding
    // Shared dims survive — Brooklyn re-touched them at t0+25s.
    expect(r55.state.audiences).toContain('category_handbags_affinity');
    expect(r55.state.audiences).toContain('occasion_everyday_affinity');
    expect(r55.state.audiences).toContain('line_brooklyn_affinity');
    for (const e of r55.changes.explain.filter((x) => x.direction === 'exit')) {
      expect(e.score).toBeLessThan(CFG.thetaOut);
      expect(e.trigger).toBe('tick');
    }

    // ── Beat 4: idle long enough → everything decays out; state prunes empty
    // (12× the SLOWEST dimension τ — priceBand's 150s — so ε-prune clears all) ──
    const rEnd = tick(r55.state, t0 + 55_000 + 12 * 150_000, CFG);
    expect(rEnd.state.audiences).toEqual([]);
    expect(rEnd.state.dims).toEqual({}); // ε-pruned — state stays tiny
  });

  it('nextCrossing brackets the actual exit (tick just before holds, just after exits)', () => {
    let r = apply(undefined, view(TABBY), t0, CFG);
    r = apply(r.state, view(TABBY), t0, CFG);
    r = apply(r.state, view(TABBY), t0, CFG); // R=3 exactly at t0 → member
    expect(r.state.audiences).toContain('line_tabby_affinity');
    const tStar = nextCrossing(r.state, t0, CFG) as number;

    const before = tick(r.state, Math.floor(tStar) - 200, CFG);
    expect(before.state.audiences).toContain('line_tabby_affinity');

    const after = tick(r.state, Math.ceil(tStar) + 200, CFG);
    expect(after.state.audiences).not.toContain('line_tabby_affinity');
  });
});

describe('hysteresis', () => {
  it('a score inside [θout, θin) holds members but does not admit non-members', () => {
    // Two same-instant views → R=2 → a = 2/3.8 ≈ 0.526 ∈ [0.45, 0.6)
    let r = apply(undefined, view(TABBY), t0, CFG);
    r = apply(r.state, view(TABBY), t0, CFG);
    expect(affinityOf(2, CFG.K)).toBeGreaterThanOrEqual(CFG.thetaOut);
    expect(affinityOf(2, CFG.K)).toBeLessThan(CFG.thetaIn);
    expect(r.state.audiences).toEqual([]); // never entered below θ_in
  });
});

describe('action weights', () => {
  it('cart (w=3) enters in one action; unknown actions accumulate nothing', () => {
    const cart = apply(undefined, { action: 'add_to_cart', touches: extractTouches(TABBY, CFG) }, t0, CFG);
    // R=3 → a = 3/4.8 = 0.625 ≥ θ_in — a single add-to-cart is an entry
    expect(cart.state.audiences).toContain('line_tabby_affinity');

    const unknown = apply(undefined, { action: 'mystery_event', touches: extractTouches(TABBY, CFG) }, t0, CFG);
    expect(unknown.state.dims).toEqual({});
    expect(unknown.state.audiences).toEqual([]);
  });
});

describe('lazy decay (store raw, read lazily)', () => {
  it('stored raw score never changes without a touch; reads decay monotonically', () => {
    const r = apply(undefined, view(TABBY), t0, CFG);
    const entry = r.state.dims.line.Tabby;
    expect(entry.s).toBe(1);
    expect(entry.t).toBe(t0);

    const e10 = effectiveScore(entry, t0 + 10_000, CFG.tauMs);
    const e30 = effectiveScore(entry, t0 + 30_000, CFG.tauMs);
    const e60 = effectiveScore(entry, t0 + 60_000, CFG.tauMs);
    expect(e10).toBeGreaterThan(e30);
    expect(e30).toBeGreaterThan(e60);
    expect(e60).toBeCloseTo(Math.exp(-1), 10); // exactly one τ later

    // tick() re-evaluates but never rewrites raw scores (prune aside)
    const ticked = tick(r.state, t0 + 30_000, CFG);
    expect(ticked.state.dims.line.Tabby).toEqual({ s: 1, t: t0 });
  });
});

describe('read surfaces', () => {
  it('attributesFrom emits fresh flattened scores + per-dimension top', () => {
    let r = apply(undefined, view(TABBY), t0, CFG);
    r = apply(r.state, view(TABBY), t0, CFG);
    r = apply(r.state, view(BROOKLYN_TOTE), t0, CFG);
    const attrs = attributesFrom(r.state, t0, CFG);
    expect(attrs['line_affinity.tabby']).toBeCloseTo(affinityOf(2, CFG.K), 4);
    expect(attrs['line_affinity.brooklyn']).toBeCloseTo(affinityOf(1, CFG.K), 4);
    expect(attrs['line_affinity_top']).toBe('Tabby');
    expect(attrs['occasion_affinity.everyday']).toBeCloseTo(affinityOf(3, CFG.K), 4); // touched by all 3 views
  });

  it('snapshot keeps original value names for the instrument', () => {
    const r = apply(undefined, view(BROOKLYN_TOTE), t0, CFG);
    const snap = snapshot(r.state, t0, CFG);
    expect(Object.keys(snap.dims.subcategory)).toEqual(['Totes & Carryalls']);
    expect(snap.dims.line.Brooklyn).toBeCloseTo(affinityOf(1, CFG.K), 4);
  });
});

describe('property invariants (seeded fuzz — deterministic)', () => {
  it('replay determinism + threshold invariants over 400 random events', () => {
    const PRODUCTS = [
      TABBY,
      BROOKLYN_TOTE,
      { id: 'C', line: 'Rogue', category: 'Handbags', subcategory: 'Satchels', silhouette: 'satchel', occasion: ['work'], price_usd: 795 },
      { id: 'D', line: 'Essential', category: 'Small Leather Goods', subcategory: 'Wallets', silhouette: 'card case', occasion: ['everyday', 'gift'], price_usd: 95 },
      { id: 'E', line: 'Kira', category: 'Handbags', subcategory: 'Crossbody Bags', silhouette: 'crossbody', occasion: ['date-night', 'evening'], price_usd: 275 },
    ];
    const ACTIONS = ['product_view', 'wishlist_add', 'add_to_cart', 'tick', 'mystery'];

    // Deterministic LCG — the fuzz is replayable by construction.
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32);

    const stream: Array<{ action: string; touches: ReturnType<typeof extractTouches>; at: number }> = [];
    let at = t0;
    for (let i = 0; i < 400; i++) {
      at += Math.floor(rand() * 8_000);
      const p = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
      const action = ACTIONS[Math.floor(rand() * ACTIONS.length)];
      stream.push({ action, touches: extractTouches(p, CFG), at });
    }

    const run = (): { final: ReflexState; explains: number } => {
      let state: ReflexState = emptyState(CFG);
      let explains = 0;
      for (const ev of stream) {
        const r = apply(state, { action: ev.action, touches: ev.touches }, ev.at, CFG);
        // Invariant: entries only at/above θ_in; exits only below θ_out (0 = pruned).
        for (const e of r.changes.explain) {
          if (e.direction === 'enter') expect(e.score).toBeGreaterThanOrEqual(CFG.thetaIn - 1e-9);
          else expect(e.score).toBeLessThan(CFG.thetaOut + 1e-9);
        }
        // Invariant: audiences sorted + unique; entered/exited consistent with diff.
        expect(r.state.audiences).toEqual([...new Set(r.state.audiences)].sort());
        for (const k of r.changes.entered) expect(state.audiences).not.toContain(k);
        for (const k of r.changes.exited) expect(state.audiences).toContain(k);
        explains += r.changes.explain.length;
        state = r.state;
      }
      return { final: state, explains };
    };

    const a = run();
    const b = run();
    expect(JSON.stringify(a.final)).toBe(JSON.stringify(b.final)); // pure → identical replay
    expect(a.explains).toBe(b.explains);
  });

  it('prev state is never mutated by apply()', () => {
    const r1 = apply(undefined, view(TABBY), t0, CFG);
    const frozen = JSON.stringify(r1.state);
    apply(r1.state, view(BROOKLYN_TOTE), t0 + 1_000, CFG);
    tick(r1.state, t0 + 500_000, CFG);
    expect(JSON.stringify(r1.state)).toBe(frozen);
  });

  it('per-dimension value cap evicts the weakest deterministically', () => {
    const tiny: ReflexConfig = { ...CFG, maxValuesPerDim: 2 };
    let state: ReflexState = emptyState(tiny);
    for (const [i, line] of ['A', 'B', 'C', 'D'].entries()) {
      const r = apply(state, { action: 'product_view', touches: [{ dim: 'line', value: line }] }, t0 + i * 1_000, tiny);
      state = r.state;
    }
    expect(Object.keys(state.dims.line).length).toBeLessThanOrEqual(2);
    expect(state.dims.line).toHaveProperty('D'); // the freshest always survives
  });
});

// ── CW24: a customer's product events, scored against the registry ───────────
import { sanitizeEventAttributes, touchesForEvent } from './core';

describe('touchesForEvent', () => {
  const cfg = { ...DEFAULT_REFLEX_CONFIG };
  const data = { productId: 'their-sku-1', line: ' Drover ', category: 'Outerwear', occasion: ['everyday', 'weekend'], price_usd: 420, colour: 'tan', evil: '<script>' };

  it('a held product always wins over the event', () => {
    const t = touchesForEvent(data, { line: 'Tabby', category: 'Handbags', price_usd: 350 }, { ...cfg, eventAttributes: 'event-when-unknown' });
    expect(t.map((x) => `${x.dim}:${x.value}`)).toEqual(['line:Tabby', 'category:Handbags', 'priceBand:core']);
  });

  it('catalog-only, the default, scores nothing from an unknown product', () => {
    expect(touchesForEvent(data, undefined, cfg)).toEqual([]);
    expect(touchesForEvent(data, undefined, { ...cfg, eventAttributes: 'catalog-only' })).toEqual([]);
  });

  it('event-when-unknown scores only registry dimensions, trimmed, capped, band-derived', () => {
    const t = touchesForEvent(data, undefined, { ...cfg, eventAttributes: 'event-when-unknown' });
    expect(t.map((x) => `${x.dim}:${x.value}`)).toEqual(['line:Drover', 'category:Outerwear', 'occasion:everyday', 'occasion:weekend', 'priceBand:elevated']);
    const s = sanitizeEventAttributes({ line: 'x'.repeat(200), occasion: Array.from({ length: 20 }, (_, i) => `o${i}`), price_usd: 'not a number', silhouette: '<b>' }, cfg);
    expect((s.line as string).length).toBe(64);
    expect((s.occasion as string[]).length).toBe(8);
    expect(s.price_usd).toBeUndefined();
    expect(s.silhouette).toBeUndefined();
  });
});
