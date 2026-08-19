// @vitest-environment node
// src/demos/brighthour/composer.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// What this suite pins is the recon's §C2 precedence — not as a comment, but as
// behaviour that is OBSERVABLE in the explain records a presenter clicks into:
//
//   1. gates      a high-affinity Final Sale item is REFUSED during a VIP offer,
//                 and says so: `vip_offer_exclusion (final_sale)` (Beat 14);
//                 an ineligible PIN loses its slot too — gates outrank pins.
//   2. pins       the Q50-style pick holds deals_rail position 1 while a
//                 higher-ranked item sits below it (Beat 5).
//   3. ranking    Σ affinity_d × weight_d orders the survivors.
//   4. quotas     ≥2 discovery picks are held against the ranking — and turning
//                 the quota OFF collapses the page into the monotone wall
//                 (the failure mode Beat 5 shows before showing the guardrail).
//   5. tie-break  hash(visitorId, slotId) — same inputs, same page, every time.
//
// Plus the two lifecycle successions the centrepiece rests on: the takeover slot
// across a window boundary (T−1ms / T+1ms, no gap), and the nested reveal inside
// the 120-hour tentpole turning over WITHOUT the parent event changing.
//
// The catalog is the REAL one, materialized against a pinned epoch — the same
// file the demo ships. Fixtures are only used where a case cannot exist in the
// data by construction (the financing conflict, which the catalog's invariants
// forbid outright).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { loadBrighthourEvents, loadBrighthourProducts } from './catalog';
import { MS_PER_HOUR, etMidnightForDate } from './demoClock';
import { evaluateGates } from './offerLifecycle';
import { BRIGHTHOUR_REFLEX_CONFIG } from './reflexConfig';
import {
  BH_DECISION_COLUMNS,
  BROWSE_SLOT_IDS,
  DEFAULT_COMPOSER_CONFIG,
  MISSION_SLOT_IDS,
  composePage,
  decisionRows,
  resolveMission,
  stampEngineLatency,
  tieBreakHash,
  type ComposeInput,
  type ComposedPage,
  type ComposerItem,
  type DimensionScores,
  type SlotDecision,
  type SlotId,
} from './composer';

// ── Fixture: the real catalog against a pinned epoch ─────────────────────────

/** Midnight ET, a fixed demo day zero. Every offset in the file hangs off this. */
const EPOCH = etMidnightForDate(2026, 9, 15);
const at = (hours: number): number => EPOCH + hours * MS_PER_HOUR;

/** 2pm ET on demo day zero: TBO #1 live, the tentpole open on reveal 0. */
const NOW = at(14);

const ITEMS = loadBrighthourProducts(EPOCH) as unknown as ComposerItem[];
const EVENTS = loadBrighthourEvents(EPOCH);

const VISITOR = 'bh-visitor-001';

function clone(items: readonly ComposerItem[]): ComposerItem[] {
  return JSON.parse(JSON.stringify(items)) as ComposerItem[];
}

function compose(overrides: Partial<ComposeInput> = {}): ComposedPage {
  return composePage({
    visitorId: VISITOR,
    nowMs: NOW,
    items: ITEMS,
    events: EVENTS,
    sessionId: 'sess-001',
    demoRunId: 'run-001',
    epochMs: EPOCH,
    ...overrides,
  });
}

function slot(page: ComposedPage, id: SlotId): SlotDecision {
  const found = page.decisions.find((d) => d.slot_id === id);
  if (!found) throw new Error(`slot ${id} not composed`);
  return found;
}

/** Every item id the page put on screen, across every slot. */
function renderedIds(page: ComposedPage): string[] {
  const ids: string[] = [];
  for (const d of page.decisions) {
    if (d.item) ids.push(d.item.itemNumber);
    for (const i of d.items ?? []) ids.push(i.itemNumber);
  }
  return ids;
}

// Scores are the reflexSnapshot(...).dims shape: dims → original value → a∈[0,1].
const KITCHEN_SHOPPER: DimensionScores = { category: { 'Kitchen & Table': 0.9 } };
// θin for `category` is 0.60 — 0.42 is deliberately BELOW it (Beat 1's "before").
const WARMING_UP: DimensionScores = { category: { 'Kitchen & Table': 0.42 } };
// The Beat-14 setup: 'Hair Care' is unique to B433294, a Final Sale item.
const BEAUTY_SHOPPER: DimensionScores = {
  category: { 'Beauty & Wellness': 0.9 },
  subcategory: { 'Hair Care': 0.85 },
};

// ── 1. Eligibility gates: the layer everything else stands on ────────────────

describe('precedence 1 — eligibility gates', () => {
  it('never renders an item that fails its gates, in any slot', () => {
    const page = compose({ scores: KITCHEN_SHOPPER });
    const byId = new Map(ITEMS.map((i) => [String(i.itemNumber), i]));

    expect(renderedIds(page).length).toBeGreaterThan(10);
    for (const id of renderedIds(page)) {
      const item = byId.get(id);
      expect(item, `rendered unknown item ${id}`).toBeTruthy();
      const gates = evaluateGates(item!, NOW, {
        vipOfferActive: DEFAULT_COMPOSER_CONFIG.vipOfferActive,
        channel: DEFAULT_COMPOSER_CONFIG.channel,
        cfg: DEFAULT_COMPOSER_CONFIG.lifecycle,
      });
      expect(gates.eligible, `${id} was rendered but is ineligible`).toBe(true);
    }
  });

  it('★ Beat 14: refuses the highest-affinity item BY RULE and names the rule', () => {
    const page = compose({ scores: BEAUTY_SHOPPER });

    // B433294 — Beauty & Wellness / Hair Care / Final Sale Price. The visitor
    // would almost certainly have clicked it; the VIP-offer roster says no.
    expect(renderedIds(page)).not.toContain('B433294');

    const deals = slot(page, 'deals_rail');
    expect(deals.explain.gates_failed).toContain('vip_offer_exclusion (final_sale)');

    const refused = deals.explain.excluded.find((e) => e.itemId === 'B433294');
    expect(refused).toBeTruthy();
    expect(refused!.gates_failed).toContain('vip_offer_exclusion (final_sale)');
    expect(refused!.dimension_scores.category).toBe(0.9);
    expect(refused!.dimension_scores.subcategory).toBe(0.85);

    // ...and it would have WON on score. That is the whole point of the beat:
    // merchandising rules outrank the model, visibly.
    const best = Math.max(...(deals.items ?? []).map((i) => i.rankScore));
    expect(refused!.rank_score).toBeGreaterThan(best);
  });

  it('serves the same item once the VIP offer is not running', () => {
    const page = compose({ scores: BEAUTY_SHOPPER, config: { vipOfferActive: false } });
    expect(renderedIds(page)).toContain('B433294');
    // Same visitor, same instant, same catalog — only the published rule changed.
    expect(slot(page, 'deals_rail').explain.gates_failed).not.toContain(
      'vip_offer_exclusion (final_sale)'
    );
  });

  it('gates outrank PINS: an ineligible pinned pick loses its slot', () => {
    const sold = clone(ITEMS);
    const pin = sold.find((i) => i.offer?.pinned === true)!;
    expect(pin.itemNumber).toBe('B445396');
    pin.availability = { ats: 'N' }; // sold out mid-session (Beat 8)

    const page = compose({ items: sold, scores: KITCHEN_SHOPPER });
    const deals = slot(page, 'deals_rail');
    expect(renderedIds(page)).not.toContain('B445396');
    expect(deals.explain.pinned).toBe(false);
    expect(deals.explain.gates_failed).toContain('availability (sold_out)');
  });

  it('passes a display gate through as suppression, WITHOUT excluding the item', () => {
    // The catalog forbids this pairing by invariant, so it is staged here: the
    // §C3 rule removes an installment LINE, never the product.
    const conflicted: ComposerItem[] = [
      {
        id: 'B999001',
        itemNumber: 'B999001',
        name: 'Staged Financing Conflict',
        category: 'Kitchen & Table',
        subcategory: 'Cookware',
        price_usd: 199.98,
        offer: { code: 'EBV', label: 'Everyday Bright Value', type: 'evergreen', windowStart: null, windowEnd: null },
        availability: { ats: 'Y' },
        pricing: {
          comparableRetail: 299,
          ourPrice: 249,
          currentSellingPrice: 199.98,
          brightPay: { code: 'BP', installments: 4, amount: 49.99, phrasing: '4 Bright Pays' },
          specialFinancing: { code: 'SF', months: 12, phrasing: '12 months' },
        },
      },
    ];

    const page = compose({ items: conflicted, events: [] });
    const deals = slot(page, 'deals_rail');
    expect(deals.item?.itemNumber).toBe('B999001');
    expect(deals.item?.displaySuppressed).toEqual(['brightPay']);
    expect(deals.item?.brightPay).toBeNull();
    expect(deals.item?.specialFinancing).not.toBeNull();
    expect(deals.explain.gates_failed).toContain('financing_conflict (special_financing)');
  });
});

// ── 2. Pins ──────────────────────────────────────────────────────────────────

describe('precedence 2 — merchandiser pins', () => {
  it('pin wins over rank: the Q50-style pick holds deals_rail position 1', () => {
    const page = compose({ scores: KITCHEN_SHOPPER });
    const deals = slot(page, 'deals_rail');

    expect(deals.items![0].itemNumber).toBe('B445396'); // The Bright Fifty Pick℠
    expect(deals.items![0].pinned).toBe(true);
    expect(deals.explain.pinned).toBe(true);
    expect(deals.strategy).toBe('pin');

    // The pin scores ZERO for this visitor, and something below it scores 0.9 —
    // "pinned: true, ranking skipped", made arithmetic.
    expect(deals.items![0].rankScore).toBe(0);
    expect(deals.items![1].rankScore).toBeGreaterThan(0);
  });

  it('the billboard is identical for every visitor (anti-over-personalization)', () => {
    const a = compose({ visitorId: 'visitor-a', scores: KITCHEN_SHOPPER });
    const b = compose({ visitorId: 'visitor-b', scores: BEAUTY_SHOPPER });
    const c = compose({ visitorId: 'visitor-c', scores: {} });

    const hero = (p: ComposedPage) => slot(p, 'hero_billboard');
    expect(hero(a).item?.itemNumber).toBe('B412915'); // lowest eligible EVT item
    expect(hero(b).item?.itemNumber).toBe(hero(a).item?.itemNumber);
    expect(hero(c).item?.itemNumber).toBe(hero(a).item?.itemNumber);

    // Ranking skipped — the explain says so rather than implying it.
    expect(hero(a).explain.pinned).toBe(true);
    expect(hero(a).explain.rank_score).toBeNull();
  });
});

// ── 3. Ranking + 4. Quotas ───────────────────────────────────────────────────

describe('precedence 3/4 — weighted ranking and the exposure quota', () => {
  it('ranks survivors by Σ affinity × weight', () => {
    const page = compose({ scores: KITCHEN_SHOPPER });
    const rail = slot(page, 'deals_rail').items!.slice(1); // drop the pin
    for (let i = 1; i < rail.length; i++) {
      expect(rail[i - 1].rankScore).toBeGreaterThanOrEqual(rail[i].rankScore);
    }
    expect(rail[0].category).toBe('Kitchen & Table');
  });

  it('quota reserves ≥2 discovery slots against the ranking', () => {
    const page = compose({ scores: KITCHEN_SHOPPER });
    const discovery = slot(page, 'discovery_rail');

    expect(discovery.explain.quota_reserved).toBe(true);
    expect(discovery.strategy).toBe('quota');

    const reserved = discovery.items!.filter((i) => i.quotaReserved);
    expect(reserved.length).toBe(DEFAULT_COMPOSER_CONFIG.discoveryQuota);
    for (const pick of reserved) {
      expect(pick.category).not.toBe('Kitchen & Table');
      expect(pick.rankScore).toBeLessThan(DEFAULT_COMPOSER_CONFIG.discoveryAffinityMax);
    }
    // Held for the exposure floor: they sit ABOVE better-scoring items.
    expect(discovery.items![0].quotaReserved).toBe(true);
  });

  it('quota OFF yields the monotone page — and the difference is observable', () => {
    const withQuota = compose({ scores: KITCHEN_SHOPPER });
    const without = compose({ scores: KITCHEN_SHOPPER, config: { quotaEnabled: false } });

    const on = slot(withQuota, 'discovery_rail');
    const off = slot(without, 'discovery_rail');

    expect(off.explain.quota_reserved).toBe(false);
    expect(off.items!.every((i) => !i.quotaReserved)).toBe(true);
    expect(off.strategy).toBe('rank');

    // The rail collapses into the same kitchen wall the deals rail already shows.
    // (It is not the IDENTICAL order: the tie-break hash is per slot, so two
    // slots ranking the same tied set still shuffle it differently — which is
    // the tie-break layer doing its job, not a discrepancy.)
    const kitchenOff = off.items!.filter((i) => i.category === 'Kitchen & Table').length;
    const kitchenOn = on.items!.filter((i) => i.category === 'Kitchen & Table').length;
    expect(off.items!.slice(0, 2).every((i) => i.category === 'Kitchen & Table')).toBe(true);
    expect(kitchenOff).toBeGreaterThan(kitchenOn);
    expect(off.items![0].rankScore).toBe(Math.max(...off.items!.map((i) => i.rankScore)));

    // ...and it is genuinely a different page, not a different label.
    expect(off.items![0].itemNumber).not.toBe(on.items![0].itemNumber);
    expect(off.items![0].rankScore).toBeGreaterThan(on.items![0].rankScore);
  });
});

// ── 5. Tie-break / determinism ───────────────────────────────────────────────

describe('precedence 5 — deterministic tie-break and replay', () => {
  it('replays byte-identically for the same inputs and config_version', () => {
    const a = compose({ scores: KITCHEN_SHOPPER });
    const b = compose({ scores: KITCHEN_SHOPPER });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.configVersion).toBe(BRIGHTHOUR_REFLEX_CONFIG.version);
  });

  it('tie-breaks on hash(visitorId, slotId) — stable, and visitor-specific', () => {
    const a = compose({ visitorId: 'visitor-a' });
    const b = compose({ visitorId: 'visitor-b' });

    for (const d of a.decisions) {
      expect(d.explain.tie_break_hash).toBe(tieBreakHash('visitor-a', d.slot_id));
    }
    expect(slot(a, 'discovery_rail').explain.tie_break_hash).not.toBe(
      slot(b, 'discovery_rail').explain.tie_break_hash
    );

    // Zero history everywhere ⇒ every rank score ties ⇒ the hash is the ONLY
    // thing ordering the rail, and it orders it differently per visitor.
    const idsA = slot(a, 'discovery_rail').items!.map((i) => i.itemNumber);
    const idsB = slot(b, 'discovery_rail').items!.map((i) => i.itemNumber);
    expect(idsA).not.toEqual(idsB);
    expect(idsA).toEqual(slot(compose({ visitorId: 'visitor-a' }), 'discovery_rail').items!.map((i) => i.itemNumber));
  });

  it('changing the config version is visible on every record', () => {
    const page = compose({
      reflexConfig: { ...BRIGHTHOUR_REFLEX_CONFIG, version: 'brighthour-retuned-v2' },
    });
    expect(page.decisions.every((d) => d.explain.config_version === 'brighthour-retuned-v2')).toBe(true);
  });
});

// ── The evergreen floor (Beat 1's "before") ──────────────────────────────────

describe('spotlight_for_you — affinity, with the evergreen floor', () => {
  it('falls to the evergreen entry when nothing is above θin', () => {
    const cold = slot(compose({ scores: {} }), 'spotlight_for_you');
    expect(cold.strategy).toBe('evergreen_fallback');
    expect(cold.offer?.type).toBe('evergreen');
    expect(cold.offer?.windowStart).toBeNull(); // always-on: no clock at all

    // Below θin (0.60) it is STILL the fallback — the threshold is the gate.
    const warming = slot(compose({ scores: WARMING_UP }), 'spotlight_for_you');
    expect(warming.strategy).toBe('evergreen_fallback');
    expect(warming.offer?.type).toBe('evergreen');
    // ...and it is the warming category's evergreen entry, not a random one.
    expect(warming.item?.category).toBe('Kitchen & Table');
  });

  it('repaints to the top dimension’s TIMELY offer once θin is crossed', () => {
    const hot = slot(compose({ scores: KITCHEN_SHOPPER }), 'spotlight_for_you');
    expect(hot.strategy).toBe('affinity');
    expect(hot.item?.category).toBe('Kitchen & Table');
    expect(hot.offer?.windowStart).not.toBeNull(); // timely: it has a clock of its own
    expect(hot.offer?.lifecycleState === 'live' || hot.offer?.lifecycleState === 'ending_today').toBe(true);
    expect(hot.explain.dimension_scores.category).toBe(0.9);
  });
});

// ── Succession: the centrepiece ──────────────────────────────────────────────

describe('lifecycle succession (Beat 2f)', () => {
  it('the takeover slot changes occupant across the boundary, with no gap', () => {
    const boundary = at(16); // TBO #1 ends and TBO #2 begins on the same instant

    const before = slot(compose({ nowMs: boundary - 1 }), 'daily_deal');
    const after = slot(compose({ nowMs: boundary + 1 }), 'daily_deal');

    expect(before.item?.itemNumber).toBe('B412907');
    expect(after.item?.itemNumber).toBe('B421104');
    expect(after.item?.itemNumber).not.toBe(before.item?.itemNumber);

    // No gap: the slot is occupied on both sides, and the successor was already
    // visible as `queued` before it was servable (the Offer Desk's preview tray).
    expect(before.item).not.toBeNull();
    expect(after.item).not.toBeNull();
    expect(before.queued?.itemId).toBe('B421104');
    expect(before.offer?.lifecycleState).toBe('ending_today');
    expect(after.offer?.lifecycleState).toBe('live');

    // Window state as LANGUAGE, never a clock (§A6/§D2).
    expect(['One-Day Price', 'Ends Today', 'Last Hours', null]).toContain(
      before.offer?.windowLanguage ?? null
    );
  });

  it('`ending_today` is OPEN — an intraday window reads it its whole life', () => {
    // Lunch Hour Steals runs 12:00–14:00 ET: two hours, entirely inside the
    // 4-hour ending-soon tail. If ending_today were treated as closed, an
    // intraday construct could never be served at all — so this is composed
    // against the LHS items alone, where nothing else can fill the slot.
    const lunchOnly = ITEMS.filter((i) => i.offer?.code === 'LHS');
    expect(lunchOnly.length).toBeGreaterThan(0);

    const page = compose({
      nowMs: at(12) + 60_000, // one minute into the hour
      items: lunchOnly,
      events: [],
      config: { vipOfferActive: false }, // §C3 excludes Lunchtime Specials from VIP offers
    });

    const deals = slot(page, 'deals_rail');
    expect(deals.item).not.toBeNull();
    expect(deals.offer?.code).toBe('LHS');
    expect(deals.offer?.lifecycleState).toBe('ending_today');
    expect(deals.explain.gates_passed).toContain('window_open');

    // And the VIP roster still refuses it when the savings event IS running.
    const vip = compose({ nowMs: at(12) + 60_000, items: lunchOnly, events: [] });
    expect(slot(vip, 'deals_rail').item).toBeNull();
    expect(slot(vip, 'deals_rail').explain.gates_failed).toContain('vip_offer_exclusion (lunch)');
  });

  it('the nested reveal turns over WITHOUT the parent event changing', () => {
    // The 120-hour tentpole opens at +12h with a 3-hour ladder.
    const first = slot(compose({ nowMs: at(14) }), 'event_module');
    const second = slot(compose({ nowMs: at(15) + 1 }), 'event_module');

    expect(first.event?.id).toBe('EVT120_FALL');
    expect(second.event?.id).toBe(first.event?.id);
    expect(second.event?.windowStart).toBe(first.event?.windowStart);
    expect(second.event?.windowEnd).toBe(first.event?.windowEnd);

    expect(first.event?.revealIndex).toBe(0);
    expect(second.event?.revealIndex).toBe(1);
    expect(first.item?.itemNumber).toBe('B412974');
    expect(second.item?.itemNumber).toBe('B421118');
    expect(first.offer?.revealIndex).toBe(0);
    expect(second.offer?.revealIndex).toBe(1);

    // The loader resolved these windows; the composer only READ them.
    expect(first.offer?.revealResolved).toBe(true);
    expect(first.event?.revealCount).toBe(12);
    expect(first.event?.revealCapacity).toBe(40);
  });

  it('reports the closed-form next boundary rather than a poll interval', () => {
    const page = compose();
    expect(page.nextTransitionAt).not.toBeNull();
    expect(page.nextTransitionAt!).toBeGreaterThan(NOW);
    // Reveal 0 ends at +15h; nothing in the catalog transitions before that.
    expect(page.nextTransitionAt!).toBeLessThanOrEqual(at(15));
  });
});

// ── Layout as a decision (Beat 9) ────────────────────────────────────────────

describe('mission vs browse — layout is a decision subject', () => {
  it('collapses 8 modules to 4 on mission', () => {
    const browse = compose({ sessionMission: 'browse' });
    const mission = compose({ sessionMission: 'mission' });

    expect(browse.moduleCount).toBe(8);
    expect(browse.decisions.map((d) => d.slot_id)).toEqual([...BROWSE_SLOT_IDS]);

    expect(mission.moduleCount).toBe(4);
    expect(mission.decisions.map((d) => d.slot_id)).toEqual([...MISSION_SLOT_IDS]);
    expect(mission.sessionMission).toBe('mission');
    // Offer-forward: the takeover and the spotlight survive the collapse.
    expect(mission.decisions.map((d) => d.slot_id)).toContain('daily_deal');
    expect(mission.decisions.map((d) => d.slot_id)).toContain('spotlight_for_you');
  });

  it('derives the layout from the dimension’s own θin when not overridden', () => {
    const cfg = BRIGHTHOUR_REFLEX_CONFIG;
    expect(resolveMission({ sessionMission: { mission: 0.75 } }, cfg)).toBe('mission');
    expect(resolveMission({ sessionMission: { mission: 0.5 } }, cfg)).toBe('browse');
    expect(resolveMission({}, cfg)).toBe('browse');
    // An explicit override always wins (the presenter's switch).
    expect(resolveMission({ sessionMission: { mission: 0.9 } }, cfg, 'browse')).toBe('browse');

    expect(compose({ scores: { sessionMission: { mission: 0.75 } } }).moduleCount).toBe(4);
    expect(compose({ scores: { sessionMission: { mission: 0.5 } } }).moduleCount).toBe(8);
  });
});

// ── The rails ────────────────────────────────────────────────────────────────

describe('rails', () => {
  it('orders the on-air rail by broadcast recency, never by the model', () => {
    const rail = slot(compose({ scores: KITCHEN_SHOPPER }), 'on_air_rail');
    expect(rail.strategy).toBe('recency');
    expect(rail.items!.length).toBe(DEFAULT_COMPOSER_CONFIG.railMax);

    const stamps = rail.items!.map((i) => Date.parse(i.lastOnAirDate!));
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i - 1]).toBeGreaterThanOrEqual(stamps[i]);
      expect(stamps[i]).toBeLessThanOrEqual(NOW); // never an unaired item
    }
  });

  it('caps every rail at railMax', () => {
    const page = compose({ scores: KITCHEN_SHOPPER });
    for (const d of page.decisions) {
      if (d.items) expect(d.items.length).toBeLessThanOrEqual(DEFAULT_COMPOSER_CONFIG.railMax);
    }
  });

  it('follows the top category affinity, and is deterministic when there is none', () => {
    const hot = slot(compose({ scores: KITCHEN_SHOPPER }), 'category_rail');
    expect(hot.items!.every((i) => i.category === 'Kitchen & Table')).toBe(true);

    const cold = slot(compose({ scores: {} }), 'category_rail');
    const coldAgain = slot(compose({ scores: {} }), 'category_rail');
    expect(cold.item?.category).toBeTruthy();
    expect(coldAgain.item?.itemNumber).toBe(cold.item?.itemNumber);
  });
});

// ── Beat 7: the export row ───────────────────────────────────────────────────

describe('decision capture (Beat 7)', () => {
  const MIGRATION = new URL('../../../migrations/0006_brighthour_decisions.sql', import.meta.url);

  /** Column names, in declaration order, straight out of the migration. */
  function migrationColumns(): string[] {
    const sql = readFileSync(MIGRATION, 'utf8');
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS bh_decisions (');
    expect(start).toBeGreaterThan(-1);
    const body = sql.slice(sql.indexOf('(', start) + 1, sql.indexOf('\n);', start));
    return body
      .split('\n')
      .map((line) => line.replace(/--.*$/, '').trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(/\s+/)[0].replace(/,$/, ''))
      .filter((name) => /^[a-z_]+$/.test(name));
  }

  it('writes one row per slot decision, matching the migration columns 1:1', () => {
    const page = compose({ scores: KITCHEN_SHOPPER });
    const rows = decisionRows(page);

    expect(rows.length).toBe(page.decisions.length);
    expect(rows.length).toBe(8);

    const columns = migrationColumns();
    expect(columns).toEqual([...BH_DECISION_COLUMNS]);
    for (const row of rows) expect(Object.keys(row)).toEqual(columns);
  });

  it('carries the whole precedence trace into the row', () => {
    const page = compose({ scores: BEAUTY_SHOPPER });
    const rows = decisionRows(page);
    const deals = rows.find((r) => r.slot_id === 'deals_rail')!;

    expect(deals.decision_id).toMatch(/^bhd_[0-9a-f]{16}$/);
    expect(deals.ts).toBe(NOW);
    expect(deals.visitor_id).toBe(VISITOR);
    expect(deals.session_id).toBe('sess-001');
    expect(deals.demo_run_id).toBe('run-001');
    expect(deals.page_type).toBe('home');

    expect(JSON.parse(deals.gates_failed)).toContain('vip_offer_exclusion (final_sale)');
    expect(JSON.parse(deals.gates_passed)).toContain('window_open');
    expect(JSON.parse(deals.candidate_set).length).toBe(ITEMS.length);
    expect(JSON.parse(deals.dimension_scores)).toBeTypeOf('object');
    expect(deals.pinned).toBe(1);
    expect(deals.quota_reserved).toBe(0);
    expect(deals.tie_break_hash).toBe(tieBreakHash(VISITOR, 'deals_rail'));
    expect(deals.config_version).toBe(BRIGHTHOUR_REFLEX_CONFIG.version);

    // Beat 13 lands these; the columns exist now so the shape never changes.
    expect(deals.experiment_id).toBeNull();
    expect(deals.variation_id).toBeNull();
    expect(deals.campaign_id).toBeNull();

    // The tentpole row carries its parent + ladder position — the join key a
    // warehouse needs to reconstruct a nested reveal after the fact.
    const event = rows.find((r) => r.slot_id === 'event_module')!;
    expect(event.parent_event).toBe('EVT120_FALL');
    expect(event.reveal_index).toBe(0);
    // A 3-hour reveal sits entirely inside the 4-hour ending-soon tail, so it
    // reads `ending_today` for its whole life — and `ending_today` is OPEN.
    expect(event.offer_lifecycle_state).toBe('ending_today');
    expect(event.offer_window_start).toBe(new Date(at(12)).toISOString());
  });

  it('stamps a measured latency on the page and every explain', () => {
    const page = stampEngineLatency(compose(), 7);
    expect(page.engineLatencyMs).toBe(7);
    expect(page.decisions.every((d) => d.explain.engine_latency_ms === 7)).toBe(true);
    expect(decisionRows(page).every((r) => r.engine_latency_ms === 7)).toBe(true);
  });
});

// ── The payload contract ─────────────────────────────────────────────────────

describe('composed payload', () => {
  it('carries the clock, the snapshot and one decision per module', () => {
    const page = compose({
      scores: KITCHEN_SHOPPER,
      memberships: ['bh_category_kitchen_table_affinity'],
      clockMultiplier: 1,
    });

    expect(page.page).toBe('home');
    expect(page.surface).toBe('brighthour');
    expect(page.epochMs).toBe(EPOCH);
    expect(page.demoClock.multiplier).toBe(1);
    expect(page.affinitySnapshot.dims).toEqual(KITCHEN_SHOPPER);
    expect(page.affinitySnapshot.memberships).toEqual(['bh_category_kitchen_table_affinity']);

    for (const [i, d] of page.decisions.entries()) {
      expect(d.order).toBe(i + 1);
      expect(d.decision_id).toMatch(/^bhd_/);
      expect(d.explain.candidates_considered).toBe(d.explain.candidate_set.length);
      expect(d.explain.config_version).toBe(BRIGHTHOUR_REFLEX_CONFIG.version);
      if (d.item) {
        expect(d.offer).not.toBeNull();
        expect(Array.isArray(d.item.displaySuppressed)).toBe(true);
      }
    }
    // Decision ids are unique per slot within a page.
    expect(new Set(page.decisions.map((d) => d.decision_id)).size).toBe(page.decisions.length);
  });

  it('never leaks a field the recon forbids rendering', () => {
    const page = compose({ scores: KITCHEN_SHOPPER });
    const json = JSON.stringify(page);
    expect(json).not.toContain('soldLast30Days');
    expect(json).not.toContain('unitsRemaining');
    expect(json).not.toContain('lowStockThreshold');
  });

  /**
   * The catalog declares pricing and reviews as nested objects; the loader
   * flattens them to `pricing_ourPrice` / `reviews_averageRating` on the way in.
   * The projection used to read only the nested form, so every price and rating
   * left the server as null and the page derived its own — inventing a "was"
   * price and a star rating the catalog was carrying all along.
   */
  it('carries the catalog’s real prices and review aggregate, not nulls', () => {
    const page = compose({ scores: KITCHEN_SHOPPER });
    const items = page.decisions
      .flatMap((d) => [d.item, ...((d.items ?? []) as Array<typeof d.item>)])
      .filter((it): it is NonNullable<typeof it> => !!it);

    expect(items.length).toBeGreaterThan(0);
    // Every rendered item quotes real money and real social proof.
    expect(items.every((it) => typeof it.ourPrice === 'number' && it.ourPrice > 0)).toBe(true);
    expect(
      items.every((it) => typeof it.comparableRetail === 'number' && it.comparableRetail > 0)
    ).toBe(true);
    expect(
      items.every(
        (it) => it.reviews !== null && it.reviews.count > 0 && it.reviews.averageRating > 0
      )
    ).toBe(true);
    // comparableRetail is the shopped-value anchor: always above our price.
    expect(items.every((it) => (it.comparableRetail as number) > (it.ourPrice as number))).toBe(
      true
    );

    // At least one item reassembles a Bright Pay plan with its real phrasing.
    const withPlan = items.filter(
      (it) => it.brightPay && typeof (it.brightPay as { phrasing?: string }).phrasing === 'string'
    );
    expect(withPlan.length).toBeGreaterThan(0);
    expect((withPlan[0].brightPay as { phrasing: string }).phrasing).toMatch(/Bright Pay/i);
  });

  it('keeps a suppressed plan null even though the value now resolves', () => {
    // The display gate still wins over the newly-threaded value: a plan the
    // financing_conflict gate turned off must not reappear just because the
    // projection got better at finding it.
    const page = compose({ scores: KITCHEN_SHOPPER });
    for (const d of page.decisions) {
      if (d.item?.displaySuppressed.includes('brightPay')) expect(d.item.brightPay).toBeNull();
      if (d.item?.displaySuppressed.includes('cardGatedPay')) expect(d.item.cardGatedPay).toBeNull();
    }
  });
});

// ── The route (/live/api) ────────────────────────────────────────────────────
// Composed against the LIVE epoch (midnight ET at or before now), because that
// is the property the offsets convention buys: the same committed file stages a
// live hour on any day a presenter opens the demo. So these assert the CONTRACT
// — module count, row shape, capture, export — never a particular item.

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(opts?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    const prefix = opts?.prefix ?? '';
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
  }
}

/** Enough D1 to prove the INSERT columns and the export read — not a SQL engine. */
class FakeD1 {
  rows: Record<string, unknown>[] = [];
  prepare(sql: string) {
    return new FakeStmt(this, sql, []);
  }
  async batch(stmts: FakeStmt[]) {
    for (const s of stmts) await s.run();
    return [];
  }
}

class FakeStmt {
  constructor(private db: FakeD1, private sql: string, private binds: unknown[]) {}
  bind(...args: unknown[]) {
    return new FakeStmt(this.db, this.sql, args);
  }
  async run() {
    const m = this.sql.match(/INSERT OR REPLACE INTO bh_decisions \(([^)]+)\)/);
    if (m) {
      const cols = m[1].split(',').map((s) => s.trim());
      const row: Record<string, unknown> = {};
      cols.forEach((col, i) => {
        row[col] = this.binds[i] ?? null;
      });
      this.db.rows.push(row);
    }
    return { success: true };
  }
  async all() {
    const limit = Number(this.binds[this.binds.length - 1]) || 200;
    return { results: this.db.rows.slice(0, limit) };
  }
}

function routeEnv(overrides: Record<string, unknown> = {}) {
  return {
    CACHE: new FakeKV(),
    SESSIONS: new FakeKV(),
    DB: new FakeD1(),
    ENVIRONMENT: 'test',
    CONNECTOR_MODE: 'mock',
    PERSONALIZATION_WEBSOCKET: {
      idFromName: (n: string) => n,
      get: () => ({ fetch: async () => new Response('{}') }),
    },
    ...overrides,
  } as unknown as Record<string, unknown>;
}

describe('POST /live/api/page + GET /live/api/decisions/export', () => {
  async function post(path: string, body: unknown, env: Record<string, unknown>) {
    const { liveRoutes } = await import('@/routes/live');
    const res = await liveRoutes.request(
      path,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      env
    );
    return { status: res.status, body: (await res.json()) as any };
  }

  it('composes the page, captures one row per decision, and exports them', async () => {
    const env = routeEnv();
    const { status, body } = await post('/page', { visitorId: 'route-visitor-1' }, env);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.surface).toBe('brighthour');
    expect(body.page).toBe('home');
    expect(body.moduleCount).toBe(8);
    expect(body.decisions.map((d: SlotDecision) => d.slot_id)).toEqual([...BROWSE_SLOT_IDS]);
    expect(body.demoClock.multiplier).toBe(1);
    expect(body.nowMs).toBeGreaterThanOrEqual(body.epochMs); // inside demo day zero
    expect(body.configVersion).toBe(BRIGHTHOUR_REFLEX_CONFIG.version);
    expect(body.affinitySnapshot).toBeTruthy();
    // A cold visitor still gets a page: the evergreen floor, never a blank.
    expect(body.decisions.find((d: SlotDecision) => d.slot_id === 'spotlight_for_you').item).not.toBeNull();

    // Beat 7 capture ran off the response path, with the migration's columns.
    const db = env.DB as unknown as FakeD1;
    expect(db.rows.length).toBe(8);
    expect(Object.keys(db.rows[0])).toEqual([...BH_DECISION_COLUMNS]);
    expect(db.rows.every((r) => r.visitor_id === 'route-visitor-1')).toBe(true);

    const { liveRoutes } = await import('@/routes/live');
    const exported = await liveRoutes.request('/decisions/export?since=0', {}, env);
    const payload = (await exported.json()) as any;
    expect(exported.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.columns).toEqual([...BH_DECISION_COLUMNS]);
    expect(payload.count).toBe(8);
    // The export is the ROWS — JSON columns stay TEXT unless asked to inflate.
    expect(typeof payload.rows[0].gates_passed).toBe('string');
  });

  it('collapses to four modules on the mission override', async () => {
    const { body } = await post(
      '/page',
      { visitorId: 'route-visitor-2', missionOverride: 'mission' },
      routeEnv()
    );
    expect(body.moduleCount).toBe(4);
    expect(body.sessionMission).toBe('mission');
    expect(body.decisions.map((d: SlotDecision) => d.slot_id)).toEqual([...MISSION_SLOT_IDS]);
  });

  it('rejects a request with no visitor', async () => {
    const { status, body } = await post('/page', { page: 'home' }, routeEnv());
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('proxies an event into the shared pipeline with the surface stamped server-side', async () => {
    const env = routeEnv();
    const { liveRoutes } = await import('@/routes/live');

    // Three brisk views of the same Kitchen item — Beat 1's arithmetic.
    for (let i = 0; i < 3; i++) {
      const { status, body } = await post(
        '/event',
        { visitorId: 'route-visitor-4', action: 'product_view', itemId: 'B412907' },
        env
      );
      // 202: the signal is ACCEPTED here and scored on the visitor's queue.
      expect(status).toBe(202);
      expect(body.surface).toBe('brighthour');
      expect(body.success).toBe(true);
    }

    // …and the snapshot comes back through the now surface-aware /realtime/reflex,
    // reading the Bright Hour τ/θ rather than the coach defaults.
    const res = await liveRoutes.request('/reflex?visitorId=route-visitor-4', {}, env);
    const snap = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(snap.ok).toBe(true);
    expect(snap.surface).toBe('brighthour');
    expect(snap.config.tauMs).toBe(BRIGHTHOUR_REFLEX_CONFIG.tauMs);
    expect(snap.config.dims.sessionMission.thetaIn).toBe(0.7); // a Bright Hour axis
    expect(snap.affinity.dims.category['Kitchen & Table']).toBeGreaterThan(0);

    // The composed page then reflects it — one pipeline, one visitor, one surface.
    const { body: page } = await post('/page', { visitorId: 'route-visitor-4' }, env);
    expect(page.affinitySnapshot.dims.category['Kitchen & Table']).toBeGreaterThan(0);
  });

  /**
   * The scroll-storm regression. A presenter scrolling the page surfaces ~32
   * cards at once, and every one is an impression. Posted concurrently, each of
   * those events used to read the same "before" session, each concluded its
   * segments had changed, and each ran the expensive decision leg — N× the work
   * on a single-threaded isolate, which is what wedged the worker. Worse, N
   * unsynchronized read-modify-writes over one KV session meant last-write-wins,
   * so all but one event's scoring was silently thrown away.
   *
   * These pin the mechanism that fixed it: ingestion is serialized PER VISITOR,
   * so a burst becomes a queue rather than a stampede.
   */
  describe('burst ingestion', () => {
    /**
     * Instrument SESSIONS.put to observe how many pipeline passes overlap.
     * `lastAt` lets the test wait for the drain WITHOUT issuing another request —
     * a competing read would write sessions of its own and be miscounted as a
     * second ingestion.
     */
    function watchOverlap(env: Record<string, unknown>) {
      const kv = env.SESSIONS as { put: (k: string, v: string) => Promise<void> };
      const inner = kv.put.bind(kv);
      const seen = { depth: 0, max: 0, lastAt: Date.now() };
      kv.put = async (key: string, value: string) => {
        seen.depth += 1;
        seen.max = Math.max(seen.max, seen.depth);
        seen.lastAt = Date.now();
        await new Promise((r) => setTimeout(r, 1)); // widen the window a racer could enter
        try {
          return await inner(key, value);
        } finally {
          seen.depth -= 1;
          seen.lastAt = Date.now();
        }
      };
      return seen;
    }

    /** Idle until the queue has been quiet for `quietMs` (or we run out of patience). */
    async function drainQuietly(seen: { lastAt: number }, quietMs = 250, capMs = 15000) {
      const started = Date.now();
      while (Date.now() - seen.lastAt < quietMs && Date.now() - started < capMs) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    it('serializes a same-visitor burst — never two ingestions in flight at once', async () => {
      const env = routeEnv();
      const seen = watchOverlap(env);

      const burst = await Promise.all(
        Array.from({ length: 12 }, () =>
          post('/event', { visitorId: 'burst-1', action: 'product_view', itemId: 'B412907' }, env)
        )
      );
      expect(burst.every((r) => r.status === 202)).toBe(true);

      // Let the queue drain on its own, issuing nothing that could be miscounted.
      await drainQuietly(seen);

      // The whole point: twelve events, never two pipeline passes at once.
      expect(seen.max).toBe(1);
    });

    it('applies EVERY event in a parallel burst — the lost-update bug is gone', async () => {
      const env = routeEnv();
      const item = 'B412907';
      const N = 8;

      // Same N events, one visitor in parallel and one strictly sequential.
      await Promise.all(
        Array.from({ length: N }, () =>
          post('/event', { visitorId: 'burst-parallel', action: 'product_view', itemId: item }, env)
        )
      );
      for (let i = 0; i < N; i++) {
        await post('/event', { visitorId: 'burst-serial', action: 'product_view', itemId: item }, env);
      }

      const { body: parallel } = await post('/page', { visitorId: 'burst-parallel' }, env);
      const { body: serial } = await post('/page', { visitorId: 'burst-serial' }, env);

      const scoreOf = (p: any) => p.affinitySnapshot.dims.category['Kitchen & Table'] ?? 0;
      expect(scoreOf(serial)).toBeGreaterThan(0);
      // Before the fix the parallel visitor kept ONE of the eight views.
      expect(scoreOf(parallel)).toBeGreaterThan(scoreOf(serial) * 0.9);
    });

    it('does not serialize DIFFERENT visitors against each other', async () => {
      const env = routeEnv();
      // Prime the shared one-time work (audience seeding, catalog) so the
      // measurement below is about queueing, not cold start.
      await post('/event', { visitorId: 'warm', action: 'product_view', itemId: 'B412907' }, env);
      await post('/page', { visitorId: 'warm' }, env);

      // Two visitors, one event each, issued together: each lands on its OWN
      // queue, so neither waits behind the other's pipeline work.
      const [a, b] = await Promise.all([
        post('/event', { visitorId: 'solo-a', action: 'product_view', itemId: 'B412907' }, env),
        post('/event', { visitorId: 'solo-b', action: 'product_view', itemId: 'B412907' }, env),
      ]);
      expect(a.status).toBe(202);
      expect(b.status).toBe(202);

      const { body: pa } = await post('/page', { visitorId: 'solo-a' }, env);
      const { body: pb } = await post('/page', { visitorId: 'solo-b' }, env);
      expect(pa.affinitySnapshot.dims.category['Kitchen & Table']).toBeGreaterThan(0);
      expect(pb.affinitySnapshot.dims.category['Kitchen & Table']).toBeGreaterThan(0);
    });
  });

  describe('POST /live/api/events (batch)', () => {
    it('accepts an array and scores every member, in order', async () => {
      const env = routeEnv();
      const { status, body } = await post(
        '/events',
        {
          visitorId: 'batch-1',
          events: [
            { action: 'product_view', itemId: 'B412907' },
            { action: 'product_view', itemId: 'B412907' },
            { action: 'add_to_cart', itemId: 'B412907' },
          ],
        },
        env
      );

      expect(status).toBe(202);
      expect(body.ok).toBe(true);
      expect(body.accepted).toBe(3);
      expect(body.surface).toBe('brighthour');

      const { body: page } = await post('/page', { visitorId: 'batch-1' }, env);
      expect(page.affinitySnapshot.dims.category['Kitchen & Table']).toBeGreaterThan(0);
    });

    it('takes a bare array, with each member carrying its own visitorId', async () => {
      const env = routeEnv();
      const { status, body } = await post(
        '/events',
        [
          { visitorId: 'batch-2', action: 'product_view', itemId: 'B412907' },
          { visitorId: 'batch-2', action: 'clip_play', itemId: 'B412907' },
        ],
        env
      );
      expect(status).toBe(202);
      expect(body.accepted).toBe(2);
    });

    it('rejects a member with no visitorId anywhere to inherit one from', async () => {
      const { status, body } = await post(
        '/events',
        [{ action: 'product_view', itemId: 'B412907' }],
        routeEnv()
      );
      expect(status).toBe(400);
      expect(body.ok).toBe(false);
    });

    it('rejects an empty batch', async () => {
      const { status } = await post('/events', { visitorId: 'batch-3', events: [] }, routeEnv());
      expect(status).toBe(400);
    });
  });

  it('degrades cleanly when D1 is not bound', async () => {
    const env = routeEnv({ DB: undefined });
    const { status, body } = await post('/page', { visitorId: 'route-visitor-3' }, env);
    expect(status).toBe(200);
    expect(body.decisions.length).toBe(8);

    const { liveRoutes } = await import('@/routes/live');
    const exported = await liveRoutes.request('/decisions/export', {}, env);
    expect(exported.status).toBe(503);
  });
});

// ── Beat 8: sold out for most, waitlist for the visitor who wanted it ────────

describe('Beat 8 — the waitlist flip', () => {
  /**
   * Two items on one shelf: the featured one has sold through, the other is
   * sellable. The catalog's own sold-out items either sit outside their window
   * or fail a second gate, so this case is built rather than borrowed — the
   * suite's standing rule for a state the data cannot express at NOW.
   */
  function shelf(): ComposerItem[] {
    const base = {
      brand: 'Copperline',
      brandPersonality: 'value-workhorse',
      category: 'Kitchen & Table',
      subcategory: 'Cookware & Dutch Ovens',
      offer: {
        code: 'DDP',
        label: 'Deal Drop℠',
        type: 'limited_time_event',
        badgeBucket: 'sale',
        windowStart: new Date(at(10)).toISOString(),
        windowEnd: new Date(at(22)).toISOString(),
        window: { startMs: at(10), endMs: at(22) },
        pinned: false,
      },
      urgencyState: 'in_stock',
      pricing: { comparableRetail: 149, ourPrice: 109.98, currentSellingPrice: 79.98 },
      price_usd: 79.98,
    };
    return [
      {
        ...base,
        id: 'BSOLD01',
        itemNumber: 'BSOLD01',
        name: 'The one that sold through',
        availability: { ats: 'N' },
        urgencyState: 'sold_out',
      },
      {
        ...base,
        id: 'BNEXT01',
        itemNumber: 'BNEXT01',
        name: 'The next eligible offer',
        availability: { ats: 'Y' },
      },
    ] as unknown as ComposerItem[];
  }

  function pageFor(scores: DimensionScores, config: Partial<ComposeInput['config']> = {}) {
    return composePage({
      visitorId: 'waitlist-visitor',
      nowMs: NOW,
      items: shelf(),
      scores,
      epochMs: EPOCH,
      config: config as ComposeInput['config'],
    });
  }

  it('keeps the item — as WAITLIST, at the same price — for the visitor above θin', () => {
    const page = pageFor(KITCHEN_SHOPPER);
    const rail = slot(page, 'deals_rail');

    const kept = rail.items!.find((i) => i.itemNumber === 'BSOLD01');
    expect(kept).toBeTruthy();
    // Their exact strings, on their own Y|N|W model.
    expect(kept!.urgencyState).toBe('waitlist');
    expect(kept!.ats).toBe('W');
    // The waitlist PRESERVES the price — nothing about the money moved.
    expect(kept!.priceUsd).toBe(79.98);
    expect(kept!.ourPrice).toBe(109.98);

    // The gate still failed, and the record still says so — beside the retention.
    expect(rail.explain.gates_failed).toContain('availability (waitlist)');
    expect(rail.notes).toContain('retained: high_affinity_waitlist');
  });

  it('replaces it entirely for the visitor who never showed interest', () => {
    const page = pageFor({});
    const rail = slot(page, 'deals_rail');
    expect(rail.items!.map((i) => i.itemNumber)).toEqual(['BNEXT01']);
    expect(rail.notes ?? []).not.toContain('retained: high_affinity_waitlist');
  });

  it('is below θin, not merely non-zero — 0.42 does not hold a sold-out item', () => {
    const page = pageFor(WARMING_UP);
    expect(renderedIds(page)).not.toContain('BSOLD01');
  });

  it('can be switched off, and then sold out is sold out for everybody', () => {
    const page = pageFor(KITCHEN_SHOPPER, { waitlistRetention: false });
    expect(renderedIds(page)).not.toContain('BSOLD01');
    expect(slot(page, 'deals_rail').explain.gates_failed).toContain('availability (sold_out)');
  });
});

// ── Beat 12: the host is a dimension nobody else models ──────────────────────

describe('Beat 12 — host affinity reorders the on-air rail', () => {
  const DANA = 'host_dana_reyes';
  const DANA_SHOPPER: DimensionScores = { hostAffinity: { [DANA]: 0.9 } };

  it('leads with her host’s items, and says so', () => {
    const rail = slot(compose({ scores: DANA_SHOPPER }), 'on_air_rail');
    expect(rail.notes).toContain(`reordered: host_affinity ${DANA}`);

    const hosts = rail.items!.map((i) => i.presentedBy);
    const lastDana = hosts.lastIndexOf(DANA);
    const firstOther = hosts.findIndex((h) => h !== DANA);
    expect(lastDana).toBeGreaterThanOrEqual(0);
    if (firstOther >= 0) expect(lastDana).toBeLessThan(firstOther);
  });

  it('keeps broadcast recency INSIDE each host group — a reorder, not a re-rank', () => {
    const rail = slot(compose({ scores: DANA_SHOPPER }), 'on_air_rail');
    const stamps = rail
      .items!.filter((i) => i.presentedBy === DANA)
      .map((i) => Date.parse(i.lastOnAirDate!));
    for (let i = 1; i < stamps.length; i++) expect(stamps[i - 1]).toBeGreaterThanOrEqual(stamps[i]);
  });

  it('does not reorder below θin, and not at all when the switch is off', () => {
    const belowTheta = slot(compose({ scores: { hostAffinity: { [DANA]: 0.3 } } }), 'on_air_rail');
    expect(belowTheta.notes ?? []).not.toContain(`reordered: host_affinity ${DANA}`);

    const off = slot(
      compose({ scores: DANA_SHOPPER, config: { hostAffinityReorder: false } }),
      'on_air_rail'
    );
    expect(off.notes ?? []).not.toContain(`reordered: host_affinity ${DANA}`);
    expect(off.items!.map((i) => i.itemNumber)).toEqual(
      slot(compose({ scores: KITCHEN_SHOPPER }), 'on_air_rail').items!.map((i) => i.itemNumber)
    );
  });
});

// ── Beat 13: the experiment stamp ────────────────────────────────────────────

describe('Beat 13 — the framing experiment rides on the daily_deal slot', () => {
  it('assigns an arm from the visitor id alone, and frames the offer with it', () => {
    const deal = slot(compose({ scores: KITCHEN_SHOPPER }), 'daily_deal');
    expect(deal.experiment).toBeTruthy();
    expect(['time_language', 'value_language']).toContain(deal.experiment!.variation_key);
    expect(deal.offer!.framing).toBe(deal.experiment!.variation_key);
    expect(typeof deal.offer!.framedLabel).toBe('string');
    expect(deal.offer!.framedLabel!.length).toBeGreaterThan(0);
    // The value arm re-describes the window; it never counts one down.
    if (deal.experiment!.variation_key === 'value_language') {
      expect(deal.offer!.windowLanguage).toBeNull();
    }
    // Same visitor, same arm — the hash is the memory.
    expect(slot(compose({ scores: KITCHEN_SHOPPER }), 'daily_deal').experiment!.variation_key).toBe(
      deal.experiment!.variation_key
    );
  });

  it('leaves the export ids null until something is actually launched', () => {
    const page = compose();
    const rows = decisionRows(page);
    expect(page.decisions.find((d) => d.slot_id === 'daily_deal')!.experiment!.launched).toBe(false);
    expect(rows.every((r) => r.experiment_id === null && r.variation_id === null)).toBe(true);
  });

  it('stamps the platform’s own ids onto the tested slot, and only that slot', () => {
    const ids = {
      flagKey: 'bh_offer_framing',
      flagId: 1,
      ruleKey: 'bh_offer_framing_ab',
      environment: 'production',
      projectId: '123',
      eventKey: 'bh_offer_click',
      eventId: 9,
      flagVariationIds: {},
      datafile: {
        experimentId: '990001',
        campaignId: '880001',
        variationIds: { time_language: '770001', value_language: '770002' },
        trafficAllocation: [
          { entityId: '770001', endOfRange: 5000 },
          { entityId: '770002', endOfRange: 10000 },
        ],
        eventEntityId: null,
        accountId: '55',
        revision: '7',
        readAt: NOW,
      },
      createdAt: NOW,
      ruleCreated: true,
      enabled: true,
      presenterUrl: 'https://app.optimizely.com/',
      resultsUrl: 'https://app.optimizely.com/results',
    };

    const page = compose({ experimentIds: ids as ComposeInput['experimentIds'] });
    const deal = slot(page, 'daily_deal');
    expect(deal.experiment!.launched).toBe(true);
    expect(deal.experiment!.experiment_id).toBe('990001');

    const rows = decisionRows(page);
    const dealRow = rows.find((r) => r.slot_id === 'daily_deal')!;
    expect(dealRow.experiment_id).toBe('990001');
    expect(dealRow.variation_id).toBe(ids.datafile.variationIds[deal.experiment!.variation_key]);
    expect(dealRow.campaign_id).toBe('880001');
    // Every other slot keeps null columns: no experiment governs them.
    expect(rows.filter((r) => r.slot_id !== 'daily_deal').every((r) => r.experiment_id === null)).toBe(
      true
    );
  });
});

// ── Beat 14: the refusal has to be VISIBLE, from any slot ────────────────────

describe('Beat 14 — a vip_offer_exclusion always survives the excluded slice', () => {
  it('hoists one refusal into every slot’s excluded list, whatever the visitor likes', () => {
    for (const scores of [KITCHEN_SHOPPER, BEAUTY_SHOPPER, {}]) {
      const page = compose({ scores });
      for (const d of page.decisions) {
        const refusedInPool = d.explain.excluded.length > 0 || d.explain.gates_failed.length > 0;
        if (!refusedInPool) continue;
        const vipInPool = d.explain.gates_failed.some((g) => g.startsWith('vip_offer_exclusion'));
        if (!vipInPool) continue;
        expect(
          d.explain.excluded.some((e) =>
            e.gates_failed.some((g) => g.startsWith('vip_offer_exclusion'))
          )
        ).toBe(true);
      }
    }
  });

  it('names the rule with the designed wording on a Final Sale item', () => {
    const page = compose({ scores: KITCHEN_SHOPPER });
    const refusals = page.decisions
      .flatMap((d) => d.explain.excluded)
      .flatMap((e) => e.gates_failed);
    expect(refusals).toContain('vip_offer_exclusion (final_sale)');
  });
});

// ── Category focus: making "Shop by Category" mean something ─────────────────

describe('focusCategory — navigation that changes the page', () => {
  const FOCUS = 'Electronics & Tech';
  /** A kitchen person who has clicked into Electronics: the whole story. */
  const focused = (overrides: Partial<ComposeInput> = {}) =>
    compose({ scores: KITCHEN_SHOPPER, focusCategory: FOCUS, ...overrides });

  it('echoes the resolved focus at the top level and on the rail', () => {
    const page = focused();
    expect(page.focus).toEqual({ category: FOCUS });
    const rail = slot(page, 'category_rail');
    expect(rail.railCategory).toBe(FOCUS);
    expect(rail.explain.focused).toBe(true);
    expect(rail.notes).toContain(`focused: category ${FOCUS}`);
  });

  it('fills the category rail with that shelf’s eligible items, and nothing else', () => {
    const rail = slot(focused(), 'category_rail');
    expect(rail.items!.length).toBeGreaterThan(0);
    expect(rail.items!.every((i) => i.category === FOCUS)).toBe(true);

    // Eligible only, and ranked — the shelf is the visitor's choice, the order
    // inside it is still the engine's.
    const byId = new Map(ITEMS.map((i) => [String(i.itemNumber), i]));
    for (const i of rail.items!) {
      expect(evaluateGates(byId.get(i.itemNumber) as never, NOW, { vipOfferActive: true }).eligible)
        .toBe(true);
    }
    const scores = rail.items!.map((i) => i.rankScore);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
  });

  it('partitions the deals rail — focused first, the rest still there, order stable', () => {
    const unfocusedItems = slot(compose({ scores: KITCHEN_SHOPPER }), 'deals_rail').items!;
    const items = slot(focused(), 'deals_rail').items!;

    // Nothing is hidden: the rail is the same length and the same membership as
    // the unfocused rail would allow — it is a partition, not a filter.
    // Focused half leads — BELOW the pin, which outranks everything including a
    // navigation choice (§C2 layer 2 is still layer 2).
    const body = items[0].pinned ? items.slice(1) : items;
    const inFocus = body.filter((i) => i.category === FOCUS);
    const others = body.filter((i) => i.category !== FOCUS);
    expect(inFocus.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);

    const firstOther = body.findIndex((i) => i.category !== FOCUS);
    const lastFocused = body.map((i) => i.category).lastIndexOf(FOCUS);
    expect(lastFocused).toBeLessThan(firstOther);
    for (const half of [inFocus, others]) {
      for (let i = 1; i < half.length; i++) {
        expect(half[i - 1].rankScore).toBeGreaterThanOrEqual(half[i].rankScore);
      }
    }
    // A pin still outranks the focus — precedence is unchanged.
    if (unfocusedItems[0].pinned) expect(items[0].itemNumber).toBe(unfocusedItems[0].itemNumber);
    expect(slot(focused(), 'deals_rail').explain.focused).toBe(true);
  });

  it('does NOT leak into the spotlight, the discovery rail or the billboard', () => {
    const plain = compose({ scores: KITCHEN_SHOPPER });
    const page = focused();
    for (const slotId of ['hero_billboard', 'daily_deal', 'spotlight_for_you', 'discovery_rail'] as SlotId[]) {
      expect(JSON.stringify(slot(page, slotId))).toBe(JSON.stringify(slot(plain, slotId)));
      expect(slot(page, slotId).explain.focused).toBeUndefined();
    }
    // The story: she clicked into Electronics, and her spotlight still knows
    // she cooks.
    expect(slot(page, 'spotlight_for_you').item!.category).toBe('Kitchen & Table');
  });

  it('absent focus is byte-identical to before it existed', () => {
    const plain = compose({ scores: KITCHEN_SHOPPER });
    expect(plain.focus).toBeNull();
    expect(JSON.stringify(plain)).toBe(
      JSON.stringify(compose({ scores: KITCHEN_SHOPPER, focusCategory: null }))
    );
    // No slot carries the flag when nothing was focused.
    expect(JSON.stringify(plain)).not.toContain('"focused"');
    expect(plain.decisions.every((d) => d.explain.focused === undefined)).toBe(true);
  });

  it('ignores a category no item carries — a stale link is not an empty rail', () => {
    const plain = compose({ scores: KITCHEN_SHOPPER });
    const stale = compose({ scores: KITCHEN_SHOPPER, focusCategory: 'Sporting Goods' });
    expect(stale.focus).toBeNull();
    expect(JSON.stringify(stale)).toBe(JSON.stringify(plain));
  });

  it('overrules affinity for the rail, for a visitor whose affinity says otherwise', () => {
    const byAffinity = slot(compose({ scores: KITCHEN_SHOPPER }), 'category_rail');
    const byClick = slot(focused(), 'category_rail');
    expect(byAffinity.railCategory).toBe('Kitchen & Table');
    expect(byClick.railCategory).toBe(FOCUS);
  });
});
