// @vitest-environment node
// src/demos/brighthour/offerLifecycle.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// The offer-lifecycle spec. Same posture as src/reflex/core.test.ts: the module
// is pure, so these tests ARE the engine's contract — a golden timeline walked
// at exact boundary milliseconds, plus property invariants that hold for any
// catalog.
//
// The three claims under test are the three the room will hear:
//   • the window is the campaign  (lifecycle states at exact boundaries)
//   • nobody rebuilds the page    (succession at T: no gap, no overlap)
//   • the engine refuses          (gate_failed: vip_offer_exclusion (final_sale))
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest';
import {
  MS_PER_HOUR,
  etMidnightForDate,
  materializeWindow,
  toIso,
  toMs,
} from './demoClock';
import {
  DEFAULT_LIFECYCLE_CONFIG,
  GATE_ORDER,
  WINDOW_LANGUAGE_VALUES,
  activeOffersAt,
  constructCodeOf,
  currentRevealIndex,
  evaluateGates,
  isPreviewVisibleAt,
  isWindowOpenAt,
  lifecycleSignatureAt,
  lifecycleStateAt,
  nextOccupantFor,
  nextTransitionAt,
  nextTransitionForItem,
  resolveRevealWindow,
  revealCount,
  vipExclusionReason,
  windowLanguage,
  type LifecycleConfig,
  type LifecycleState,
  type OfferItemLike,
  type OfferLike,
} from './offerLifecycle';

const H = MS_PER_HOUR;
const CFG = DEFAULT_LIFECYCLE_CONFIG; // preview 24h · prelaunch 6h · presale 2h · ending 4h · postsale 2h

/** Demo day zero — midnight ET, 19 Aug 2026 (their TSV "kicks off at midnight ET"). */
const EPOCH = etMidnightForDate(2026, 8, 19);

const TBO_WINDOW = materializeWindow({ startOffsetHours: 0, durationHours: 24 }, EPOCH);
const S = toMs(TBO_WINDOW.windowStart) as number; // 2026-08-19T04:00:00.000Z
const E = toMs(TBO_WINDOW.windowEnd) as number; // 2026-08-20T04:00:00.000Z

/** Today's Bright One — the centerpiece takeover slot (§B4). */
const TBO_TODAY: OfferItemLike = {
  itemNumber: 'B412907',
  offer: {
    code: 'TBO',
    label: "Today's Bright One",
    type: 'daily_deal',
    presaleEligible: true,
    ...TBO_WINDOW,
  },
  availability: { ats: 'Y' },
  pricing: { brightPay: { code: 'C4', installments: 4 }, specialFinancing: null },
  returnPolicy: 'standard',
};

/** Tomorrow's Bright One — sitting in preview, waiting to take the slot (Beat 2f). */
const TBO_TOMORROW: OfferItemLike = {
  itemNumber: 'B558310',
  offer: {
    code: 'TBO',
    label: "Today's Bright One",
    type: 'daily_deal',
    presaleEligible: true,
    ...materializeWindow({ startOffsetHours: 24, durationHours: 24 }, EPOCH),
  },
  availability: { ats: 'Y' },
};

const EVERGREEN_CLEARANCE: OfferItemLike = {
  itemNumber: 'B100001',
  offer: { code: 'LC', label: 'Last Chance', type: 'last_chance', windowStart: null, windowEnd: null },
  availability: { ats: 'Y' },
};

const offerOf = (item: OfferItemLike): OfferLike => item.offer as OfferLike;

// ─────────────────────────────────────────────────────────────────────────────

describe('golden lifecycle timeline — one full TBO life at exact boundaries', () => {
  it('walks preview → prelaunch → presale → live → ending_today → postsale → expired', () => {
    const timeline: Array<[number, LifecycleState, string]> = [
      [S - 72 * H, 'preview', 'authored, far out'],
      [S - 24 * H - 1, 'preview', 'one ms before preview visibility'],
      [S - 24 * H, 'preview', 'preview surfaces pick it up'],
      [S - 6 * H - 1, 'preview', ''],
      [S - 6 * H, 'prelaunch', 'their tsvprelaunch'],
      [S - 2 * H - 1, 'prelaunch', ''],
      [S - 2 * H, 'presale', 'their tsvpresale — flagged offers only'],
      [S - 1, 'presale', ''],
      [S, 'live', 'windowStart passes. No campaign created.'],
      [S + 12 * H, 'live', ''],
      [E - 4 * H - 1, 'live', ''],
      [E - 4 * H, 'ending_today', ''],
      [E - 1, 'ending_today', ''],
      [E, 'postsale', 'their tsvpostsale'],
      [E + 2 * H - 1, 'postsale', ''],
      [E + 2 * H, 'expired', 'drops out of every eligible set'],
      [E + 30 * 24 * H, 'expired', ''],
    ];
    for (const [at, expected] of timeline) {
      expect([toIso(at), lifecycleStateAt(offerOf(TBO_TODAY), at, CFG)]).toEqual([toIso(at), expected]);
    }
  });

  it('previewLeadMs governs preview VISIBILITY, not the state name', () => {
    expect(isPreviewVisibleAt(offerOf(TBO_TODAY), S - 24 * H - 1, CFG)).toBe(false);
    expect(isPreviewVisibleAt(offerOf(TBO_TODAY), S - 24 * H, CFG)).toBe(true);
    expect(lifecycleStateAt(offerOf(TBO_TODAY), S - 24 * H - 1, CFG)).toBe('preview');
  });

  it('presale is skipped entirely for offers not flagged presaleEligible', () => {
    const notPresale: OfferLike = { ...offerOf(TBO_TODAY), presaleEligible: false };
    expect(lifecycleStateAt(notPresale, S - 2 * H, CFG)).toBe('prelaunch');
    expect(lifecycleStateAt(notPresale, S - 1, CFG)).toBe('prelaunch');
    expect(lifecycleStateAt(notPresale, S, CFG)).toBe('live');
  });

  it('the slot is occupiable exactly across [windowStart, windowEnd)', () => {
    expect(isWindowOpenAt(offerOf(TBO_TODAY), S - 1, CFG)).toBe(false);
    expect(isWindowOpenAt(offerOf(TBO_TODAY), S, CFG)).toBe(true);
    expect(isWindowOpenAt(offerOf(TBO_TODAY), E - 1, CFG)).toBe(true);
    expect(isWindowOpenAt(offerOf(TBO_TODAY), E, CFG)).toBe(false);
  });

  it('an intraday window shorter than the ending lead is ending_today throughout', () => {
    // Lunch Hour Steals — 12:00–14:00 ET (§B4). endingSoonMs (4h) exceeds the window.
    const lunch: OfferLike = {
      code: 'LHS',
      type: 'lunch',
      ...materializeWindow({ startOffsetHours: 12, durationHours: 2 }, EPOCH),
    };
    const start = toMs(lunch.windowStart) as number;
    expect(lifecycleStateAt(lunch, start, CFG)).toBe('ending_today');
    expect(lifecycleStateAt(lunch, start + 1 * H, CFG)).toBe('ending_today');
    expect(lifecycleStateAt(lunch, start + 2 * H, CFG)).toBe('postsale');
  });

  it('evergreen and one-time-only offers are live while availability permits', () => {
    for (const at of [S - 10 * 24 * H, S, E + 10 * 24 * H]) {
      expect(lifecycleStateAt(offerOf(EVERGREEN_CLEARANCE), at, CFG)).toBe('live');
    }
    const oto: OfferLike = { code: 'OTO', type: 'one_time_only', windowStart: null, windowEnd: null };
    expect(lifecycleStateAt(oto, S, CFG)).toBe('live');
    // "Until gone" is the availability gate's job, never the clock's.
    const gone = evaluateGates({ offer: oto, availability: { ats: 'N' } }, S);
    expect(gone.lifecycleState).toBe('live');
    expect(gone.eligible).toBe(false);
    expect(gone.gatesFailed).toEqual(['availability (sold_out)']);
  });

  it('an open-ended window (start, no end) goes live and never expires', () => {
    const openEnded: OfferLike = { code: 'DDP', windowStart: TBO_WINDOW.windowStart, windowEnd: null };
    expect(lifecycleStateAt(openEnded, S - 72 * H, CFG)).toBe('preview');
    expect(lifecycleStateAt(openEnded, S - 1, CFG)).toBe('prelaunch');
    expect(lifecycleStateAt(openEnded, S, CFG)).toBe('live');
    expect(lifecycleStateAt(openEnded, S + 365 * 24 * H, CFG)).toBe('live');
  });
});

describe('succession — the old offer expires at T, the queued offer takes the slot at T', () => {
  const CATALOG = [TBO_TODAY, TBO_TOMORROW, EVERGREEN_CLEARANCE];

  it('hands the slot over on the exact millisecond, with no gap and no overlap', () => {
    expect(nextOccupantFor('TBO', CATALOG, E - 1, CFG)?.itemNumber).toBe('B412907');
    expect(nextOccupantFor('TBO', CATALOG, E, CFG)?.itemNumber).toBe('B558310');

    // Exactly one occupant at every sampled instant across both windows.
    for (let at = S; at < E + 24 * H; at += 17 * 60_000) {
      const occupant = nextOccupantFor('TBO', CATALOG, at, CFG);
      expect(occupant).not.toBeNull();
      expect(occupant?.itemNumber).toBe(at < E ? 'B412907' : 'B558310');
    }
    // …and none before the first window or after the last.
    expect(nextOccupantFor('TBO', CATALOG, S - 1, CFG)).toBeNull();
    expect(nextOccupantFor('TBO', CATALOG, E + 24 * H, CFG)).toBeNull();
  });

  it('scheduling lands on the handover exactly — no polling', () => {
    expect(nextTransitionAt(CATALOG, E - 1, CFG)).toBe(E);
    expect(nextTransitionAt([TBO_TODAY], E - 1, CFG)).toBe(E);
  });

  it('never returns a windowless item — the evergreen fallback is the composer\'s call', () => {
    const evergreenTbo: OfferItemLike = {
      itemNumber: 'B999999',
      offer: { code: 'TBO', type: 'evergreen', windowStart: null, windowEnd: null },
      availability: { ats: 'Y' },
    };
    expect(nextOccupantFor('TBO', [evergreenTbo], S, CFG)).toBeNull();
    expect(activeOffersAt([evergreenTbo], S, CFG).TBO).toHaveLength(1); // still eligible, just not an occupant
  });

  it('resolves overlapping windows deterministically (freshest start, then itemNumber)', () => {
    const overlapping: OfferItemLike[] = [
      { itemNumber: 'B2', offer: { code: 'BH2', windowStart: toIso(S), windowEnd: toIso(E) }, availability: { ats: 'Y' } },
      { itemNumber: 'B3', offer: { code: 'BH2', windowStart: toIso(S + H), windowEnd: toIso(E) }, availability: { ats: 'Y' } },
      { itemNumber: 'B1', offer: { code: 'BH2', windowStart: toIso(S + H), windowEnd: toIso(E) }, availability: { ats: 'Y' } },
    ];
    expect(nextOccupantFor('BH2', overlapping, S + 2 * H, CFG)?.itemNumber).toBe('B1');
    expect(nextOccupantFor('bh2', overlapping, S + 2 * H, CFG)?.itemNumber).toBe('B1'); // code is normalized
  });

  it('groups the eligible set by slot construct', () => {
    const groups = activeOffersAt(CATALOG, S + H, CFG);
    expect(Object.keys(groups).sort()).toEqual(['LC', 'TBO']);
    expect(groups.TBO.map((i) => i.itemNumber)).toEqual(['B412907']); // tomorrow's is still in preview
    expect(activeOffersAt(CATALOG, E + 3 * H, CFG).TBO.map((i) => i.itemNumber)).toEqual(['B558310']);
    expect(constructCodeOf({ offer: null })).toBe('NONE');
    expect(activeOffersAt([{ itemNumber: 'X', offer: null }], S, CFG).NONE).toHaveLength(1);
  });
});

describe('nested staggered reveals — "120 Hours of Deals" (§A13)', () => {
  const PARENT = materializeWindow({ startOffsetHours: 0, durationHours: 120 }, EPOCH);
  const P = toMs(PARENT.windowStart) as number;
  const Q = toMs(PARENT.windowEnd) as number;
  const CADENCE = 3 * H;

  it('indexes child windows off the parent start at the reveal cadence', () => {
    expect(resolveRevealWindow(PARENT, 0, CADENCE)).toMatchObject({
      revealIndex: 0,
      windowStart: '2026-08-19T04:00:00.000Z',
      windowEnd: '2026-08-19T07:00:00.000Z',
      clamped: false,
    });
    expect(resolveRevealWindow(PARENT, 7, CADENCE)).toMatchObject({
      startMs: P + 21 * H,
      endMs: P + 24 * H,
      windowStart: '2026-08-20T01:00:00.000Z',
      clamped: false,
    });
    expect(revealCount(PARENT, CADENCE)).toBe(40); // "reveal 7 of 40"
  });

  it('an explicit reveal duration shortens the child without moving it', () => {
    const short = resolveRevealWindow(PARENT, 7, CADENCE, 1 * H);
    expect(short.startMs).toBe(P + 21 * H);
    expect(short.endMs).toBe(P + 22 * H);
  });

  it('clamps to the parent window at both ends — a reveal never outlives its event', () => {
    const last = resolveRevealWindow(PARENT, 39, CADENCE);
    expect(last.endMs).toBe(Q);
    expect(last.clamped).toBe(false);

    const overrun = resolveRevealWindow(PARENT, 40, CADENCE);
    expect(overrun).toMatchObject({ startMs: Q, endMs: Q, clamped: true }); // zero-length → never live
    expect(resolveRevealWindow(PARENT, 41, CADENCE).startMs).toBe(Q);
    expect(resolveRevealWindow(PARENT, -1, CADENCE)).toMatchObject({ startMs: P, endMs: P, clamped: true });

    // A trailing partial reveal is truncated, not allowed to spill past the event.
    const ragged = materializeWindow({ startOffsetHours: 0, durationHours: 5 }, EPOCH);
    expect(revealCount(ragged, 2 * H)).toBe(3);
    expect(resolveRevealWindow(ragged, 2, 2 * H)).toMatchObject({
      startMs: P + 4 * H,
      endMs: P + 5 * H,
      clamped: true,
    });
  });

  it('currentRevealIndex rolls over on the cadence and is null outside the parent', () => {
    expect(currentRevealIndex(PARENT, CADENCE, P - 1)).toBeNull();
    expect(currentRevealIndex(PARENT, CADENCE, P)).toBe(0);
    expect(currentRevealIndex(PARENT, CADENCE, P + CADENCE - 1)).toBe(0);
    expect(currentRevealIndex(PARENT, CADENCE, P + CADENCE)).toBe(1);
    expect(currentRevealIndex(PARENT, CADENCE, P + 21 * H)).toBe(7);
    expect(currentRevealIndex(PARENT, CADENCE, Q - 1)).toBe(39);
    expect(currentRevealIndex(PARENT, CADENCE, Q)).toBeNull(); // parent ends, reveals end
  });

  it('the reveal ladder tiles the parent window without gap or overlap', () => {
    const count = revealCount(PARENT, CADENCE) as number;
    let previousEnd = P;
    for (let k = 0; k < count; k++) {
      const child = resolveRevealWindow(PARENT, k, CADENCE);
      expect(child.startMs).toBe(previousEnd); // no gap, no overlap
      expect(currentRevealIndex(PARENT, CADENCE, child.startMs)).toBe(k);
      expect(currentRevealIndex(PARENT, CADENCE, child.endMs - 1)).toBe(k);
      previousEnd = child.endMs;
    }
    expect(previousEnd).toBe(Q);
  });

  it('a reveal rollover is a transition the scheduler must fire on — the parent never changes', () => {
    const parentEvent: OfferItemLike = {
      itemNumber: 'EVT120',
      offer: { code: 'EVT120', type: 'limited_time_event', revealCadenceMs: CADENCE, ...PARENT },
    };
    expect(nextTransitionForItem(parentEvent, P + 1 * H, CFG)).toBe(P + CADENCE);
    expect(nextTransitionForItem(parentEvent, P + CADENCE, CFG)).toBe(P + 2 * CADENCE);
    // The parent's own lifecycle state is unmoved across the rollover (Beat 2f).
    expect(lifecycleStateAt(parentEvent.offer, P + CADENCE - 1, CFG)).toBe('live');
    expect(lifecycleStateAt(parentEvent.offer, P + CADENCE, CFG)).toBe('live');
    expect(lifecycleSignatureAt(parentEvent, P + CADENCE - 1, CFG)).not.toBe(
      lifecycleSignatureAt(parentEvent, P + CADENCE, CFG)
    );
  });

  it('refuses malformed reveal geometry rather than inventing a window', () => {
    expect(() => resolveRevealWindow({ windowStart: null }, 0, CADENCE)).toThrow(TypeError);
    expect(() => resolveRevealWindow(PARENT, 0, 0)).toThrow(TypeError);
    expect(() => resolveRevealWindow(PARENT, 0, CADENCE, -1)).toThrow(TypeError);
    expect(currentRevealIndex(PARENT, 0, P)).toBeNull();
    expect(revealCount({ windowStart: PARENT.windowStart, windowEnd: null }, CADENCE)).toBeNull();
  });
});

describe('eligibility gates — precedence step 1 (§C2) with the published rules (§C3)', () => {
  it('★ Beat 14: a Final Sale item is refused by RULE during a VIP offer', () => {
    // High hypothetical affinity is irrelevant here — that is ranking, and ranking
    // never runs on an item the gates rejected. This is the demo's engineered moment.
    const finalSale: OfferItemLike = {
      itemNumber: 'B770412',
      offer: { code: 'FIN_S', label: 'Final Sale Price', type: 'final_sale', windowStart: null, windowEnd: null },
      availability: { ats: 'Y' },
      returnPolicy: 'final_sale',
    };
    const result = evaluateGates(finalSale, S, { vipOfferActive: true });
    expect(result.eligible).toBe(false);
    expect(result.gatesFailed).toEqual(['vip_offer_exclusion (final_sale)']); // the exact export-row string
    expect(result.gatesPassed).toEqual(['window_open', 'availability', 'financing_conflict', 'channel']);

    // With no VIP offer running, the same item is perfectly eligible.
    expect(evaluateGates(finalSale, S, { vipOfferActive: false }).eligible).toBe(true);
    expect(evaluateGates(finalSale, S).eligible).toBe(true);
  });

  it('covers the whole §C3 exclusion roster, by offer type and by construct code', () => {
    const byType: Array<[string, string]> = [
      ['as_is', 'as_is'],
      ['clearance', 'clearance'],
      ['clearance_sale', 'clearance_sale'],
      ['final_sale', 'final_sale'],
      ['last_chance', 'last_chance'],
      ['lunchtime_specials', 'lunch'],
    ];
    for (const [type, reason] of byType) {
      expect(vipExclusionReason({ offer: { type } })).toBe(reason);
    }
    const byCode: Array<[string, string]> = [
      ['ASIS', 'as_is'],
      ['CLR', 'clearance'],
      ['FIN_S', 'final_sale'],
      ['LC', 'last_chance'],
      ['LHS', 'lunch'],
    ];
    for (const [code, reason] of byCode) {
      expect(vipExclusionReason({ offer: { code } })).toBe(reason);
    }
    // Non-returnable is itself an eligibility constraint, whatever the offer says.
    expect(vipExclusionReason({ offer: { code: 'TBO', type: 'daily_deal' }, returnPolicy: 'final_sale' })).toBe('final_sale');
    expect(vipExclusionReason(TBO_TODAY)).toBeNull();
  });

  it('financing_conflict is a DISPLAY gate — it suppresses Bright Pay, not the item', () => {
    const financed: OfferItemLike = {
      itemNumber: 'B221100',
      offer: { code: 'TBO', ...TBO_WINDOW },
      availability: { ats: 'Y' },
      pricing: { brightPay: { code: 'C4' }, specialFinancing: { code: 'LF', months: 12 } },
    };
    const result = evaluateGates(financed, S);
    expect(result.eligible).toBe(true); // ← the item still competes for the slot
    expect(result.gatesFailed).toEqual(['financing_conflict (special_financing)']);
    expect(result.displaySuppressed).toEqual(['brightPay']);

    // Financing with nothing to suppress is not a conflict.
    expect(evaluateGates({ ...financed, pricing: { specialFinancing: { code: 'LF' } } }, S).gatesFailed).toEqual([]);
    expect(evaluateGates(TBO_TODAY, S).displaySuppressed).toEqual([]);
  });

  it('window_open reports the lifecycle state as its reason', () => {
    expect(evaluateGates(TBO_TODAY, S - 3 * H).gatesFailed).toEqual(['window_open (prelaunch)']);
    expect(evaluateGates(TBO_TODAY, S - H).gatesFailed).toEqual(['window_open (presale)']);
    expect(evaluateGates(TBO_TODAY, S - 72 * H).gatesFailed).toEqual(['window_open (preview)']);
    expect(evaluateGates(TBO_TODAY, E + H).gatesFailed).toEqual(['window_open (postsale)']);
    expect(evaluateGates(TBO_TODAY, E + 3 * H).gatesFailed).toEqual(['window_open (expired)']);
    expect(evaluateGates(TBO_TODAY, E - H).eligible).toBe(true); // ending_today still occupies
  });

  it('availability uses their real Y|N|W model — waitlist stays eligible (§A6, §C3)', () => {
    const withAts = (ats: string): OfferItemLike => ({ ...TBO_TODAY, availability: { ats } });
    expect(evaluateGates(withAts('Y'), S).eligible).toBe(true);
    expect(evaluateGates(withAts('W'), S).eligible).toBe(true); // waitlist preserves the price
    expect(evaluateGates(withAts('N'), S).gatesFailed).toEqual(['availability (sold_out)']);
    expect(evaluateGates({ ...TBO_TODAY, availability: null }, S).eligible).toBe(true); // absent → sellable
  });

  it('channel passes a web exclusive on web and fails it elsewhere', () => {
    const webOnly: OfferItemLike = { itemNumber: 'B300100', offer: { code: 'WEB', type: 'web_exclusive' } };
    expect(evaluateGates(webOnly, S).eligible).toBe(true); // defaults to web
    expect(evaluateGates(webOnly, S, { channel: 'web' }).eligible).toBe(true);
    expect(evaluateGates(webOnly, S, { channel: 'app' }).gatesFailed).toEqual(['channel (web_exclusive)']);
    expect(evaluateGates(TBO_TODAY, S, { channel: 'app' }).eligible).toBe(true);
  });

  it('evaluates every gate — a glass box that stops at the first failure is not one', () => {
    const doomed: OfferItemLike = {
      itemNumber: 'B000001',
      offer: { code: 'FIN_S', type: 'final_sale', ...TBO_WINDOW },
      availability: { ats: 'N' },
      pricing: { brightPay: {}, specialFinancing: {} },
    };
    const result = evaluateGates(doomed, E + 3 * H, { vipOfferActive: true });
    expect(result.gatesFailed).toEqual([
      'window_open (expired)',
      'availability (sold_out)',
      'vip_offer_exclusion (final_sale)',
      'financing_conflict (special_financing)',
    ]);
    expect(result.eligible).toBe(false);
    // Every gate is reported, once, in the declared order (the export row's shape).
    expect(result.results.map((r) => r.gate)).toEqual(GATE_ORDER);
    expect([...result.gatesPassed, ...result.gatesFailed]).toHaveLength(GATE_ORDER.length);
  });
});

describe('window language — §A6 doctrine: language, never a clock', () => {
  const TBO = offerOf(TBO_TODAY);

  it('climbs the ladder null → One-Day Price → Ends Today → Last Hours (§D2)', () => {
    expect(windowLanguage(TBO, S - H, CFG)).toBeNull(); // presale: no time framing
    expect(windowLanguage(TBO, S, CFG)).toBe('One-Day Price');
    expect(windowLanguage(TBO, S + 12 * H, CFG)).toBe('One-Day Price');
    expect(windowLanguage(TBO, E - 4 * H - 1, CFG)).toBe('One-Day Price');
    expect(windowLanguage(TBO, E - 4 * H, CFG)).toBe('Ends Today'); // ending_today begins
    expect(windowLanguage(TBO, E - 2 * H, CFG)).toBe('Ends Today'); // exactly endingSoonMs / 2
    expect(windowLanguage(TBO, E - 2 * H + 1, CFG)).toBe('Last Hours');
    expect(windowLanguage(TBO, E - 1, CFG)).toBe('Last Hours');
    expect(windowLanguage(TBO, E, CFG)).toBeNull(); // postsale
    expect(windowLanguage(TBO, E + 3 * H, CFG)).toBeNull(); // expired
  });

  it('says Ends Today only when the window really ends before the next midnight ET', () => {
    // A 24h window on a 3am ET clock spills past midnight — it is still the
    // one-day price, but it is not "today".
    const offset: OfferLike = { code: 'TBO', ...materializeWindow({ startOffsetHours: 3, durationHours: 24 }, EPOCH) };
    const end = toMs(offset.windowEnd) as number;
    expect(lifecycleStateAt(offset, end - 4 * H, CFG)).toBe('ending_today');
    expect(windowLanguage(offset, end - 4 * H, CFG)).toBe('One-Day Price');

    // The 4.5-day Harvest Kitchen Event ends at noon ET — no "One-Day Price",
    // but its last afternoon genuinely does end today.
    const event: OfferLike = { code: 'EVT', ...materializeWindow({ startOffsetHours: 0, durationHours: 108 }, EPOCH) };
    const eventEnd = toMs(event.windowEnd) as number;
    expect(windowLanguage(event, eventEnd - 48 * H, CFG)).toBeNull(); // mid-event: no time framing at all
    expect(windowLanguage(event, eventEnd - 4 * H, CFG)).toBe('Ends Today');
    expect(windowLanguage(event, eventEnd - 30 * 60_000, CFG)).toBe('Last Hours');
  });

  it('never frames an evergreen or open-ended offer in time', () => {
    expect(windowLanguage(offerOf(EVERGREEN_CLEARANCE), S, CFG)).toBeNull();
    expect(windowLanguage({ code: 'DDP', windowStart: TBO_WINDOW.windowStart, windowEnd: null }, S + H, CFG)).toBeNull();
    expect(windowLanguage(null, S, CFG)).toBeNull();
  });

  it('tolerates the 23h and 25h ET days a One-Day Price can span', () => {
    const springForward: OfferLike = {
      code: 'TBO',
      ...materializeWindow({ startOffsetHours: 0, durationHours: 23 }, etMidnightForDate(2026, 3, 8)),
    };
    const fallBack: OfferLike = {
      code: 'TBO',
      ...materializeWindow({ startOffsetHours: 0, durationHours: 25 }, etMidnightForDate(2026, 11, 1)),
    };
    expect(windowLanguage(springForward, (toMs(springForward.windowStart) as number) + H, CFG)).toBe('One-Day Price');
    expect(windowLanguage(fallBack, (toMs(fallBack.windowStart) as number) + H, CFG)).toBe('One-Day Price');
    // A 49-hour event is not a one-day price.
    const long: OfferLike = { code: 'EVT48', ...materializeWindow({ startOffsetHours: 0, durationHours: 49 }, EPOCH) };
    expect(windowLanguage(long, S + H, CFG)).toBeNull();
  });

  it('cannot emit a countdown or scarcity string — the vocabulary is closed (seeded fuzz)', () => {
    let seed = 8_2026;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32);
    const allowed = new Set<string | null>([null, ...WINDOW_LANGUAGE_VALUES]);
    for (let i = 0; i < 2_000; i++) {
      const start = S + Math.floor((rand() - 0.5) * 10 * 24 * H);
      const duration = Math.floor(rand() * 130 * H);
      const offer: OfferLike = { code: 'X', windowStart: toIso(start), windowEnd: toIso(start + duration) };
      const at = S + Math.floor((rand() - 0.5) * 12 * 24 * H);
      const language = windowLanguage(offer, at, CFG);
      expect(allowed.has(language)).toBe(true);
      if (language !== null) expect(language).not.toMatch(/\d/); // no clocks, ever
    }
  });
});

describe('nextTransitionAt — closed form, exact, never polled', () => {
  it('names each boundary of the TBO life in turn', () => {
    const item = TBO_TODAY;
    expect(nextTransitionForItem(item, S - 72 * H, CFG)).toBe(S - 24 * H); // preview visibility
    expect(nextTransitionForItem(item, S - 24 * H, CFG)).toBe(S - 6 * H); // prelaunch
    expect(nextTransitionForItem(item, S - 6 * H, CFG)).toBe(S - 2 * H); // presale
    expect(nextTransitionForItem(item, S - 2 * H, CFG)).toBe(S); // live
    expect(nextTransitionForItem(item, S, CFG)).toBe(E - 4 * H); // ending_today
    expect(nextTransitionForItem(item, E - 4 * H, CFG)).toBe(E); // postsale
    expect(nextTransitionForItem(item, E, CFG)).toBe(E + 2 * H); // expired
    expect(nextTransitionForItem(item, E + 2 * H, CFG)).toBeNull(); // nothing left to happen
  });

  it('skips the presale boundary for offers that do not have one', () => {
    const notPresale: OfferItemLike = { ...TBO_TODAY, offer: { ...offerOf(TBO_TODAY), presaleEligible: false } };
    expect(nextTransitionForItem(notPresale, S - 6 * H, CFG)).toBe(S);
  });

  it('returns null for a catalog that can never change, and the soonest across many', () => {
    expect(nextTransitionAt([EVERGREEN_CLEARANCE], S, CFG)).toBeNull();
    expect(nextTransitionAt([], S, CFG)).toBeNull();
    // Tomorrow's TBO reaches prelaunch (S+18h) before today's reaches ending_today (S+20h).
    expect(nextTransitionAt([TBO_TODAY, TBO_TOMORROW, EVERGREEN_CLEARANCE], S, CFG)).toBe(S + 18 * H);
    expect(nextTransitionAt([TBO_TODAY], S, CFG)).toBe(E - 4 * H);
  });

  it('property: nothing changes strictly before it, something changes at it (exhaustive scan)', () => {
    // A compressed catalog scanned millisecond by millisecond — the only honest
    // way to prove a closed-form answer is exact rather than merely early.
    const TINY: LifecycleConfig = {
      previewLeadMs: 800,
      prelaunchLeadMs: 400,
      presaleLeadMs: 150,
      endingSoonMs: 300,
      postsaleTailMs: 200,
    };
    let seed = 19_2026;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32);
    const t0 = 1_700_000_000_000;

    for (let trial = 0; trial < 12; trial++) {
      const items: OfferItemLike[] = [];
      for (let i = 0; i < 6; i++) {
        const shape = rand();
        const start = t0 + Math.floor(rand() * 1_500);
        const duration = 1 + Math.floor(rand() * 1_200);
        const cadence = rand() < 0.4 ? [137, 250, 400][Math.floor(rand() * 3)] : null;
        items.push({
          itemNumber: `T${trial}-${i}`,
          offer:
            shape < 0.12
              ? { code: 'EVG', windowStart: null, windowEnd: null } // evergreen
              : shape < 0.22
                ? { code: 'OPEN', windowStart: toIso(start), windowEnd: null } // open-ended
                : {
                    code: 'W',
                    windowStart: toIso(start),
                    windowEnd: toIso(start + duration),
                    presaleEligible: rand() < 0.5,
                    revealCadenceMs: cadence,
                  },
        });
      }

      const now = t0 - 1_000;
      const signature = (at: number) => items.map((it) => lifecycleSignatureAt(it, at, TINY)).join('~');
      const base = signature(now);

      let scanned: number | null = null;
      for (let at = now + 1; at <= now + 5_000; at++) {
        if (signature(at) !== base) {
          scanned = at;
          break;
        }
      }
      expect(nextTransitionAt(items, now, TINY)).toBe(scanned);

      // …and the same must hold when the scheduler re-arms from where it fired
      // (this is the pass that exercises nested-reveal rollovers mid-window).
      if (scanned !== null) {
        const nextBase = signature(scanned);
        let rescanned: number | null = null;
        for (let at = scanned + 1; at <= scanned + 5_000; at++) {
          if (signature(at) !== nextBase) {
            rescanned = at;
            break;
          }
        }
        expect(nextTransitionAt(items, scanned, TINY)).toBe(rescanned);
      }
    }
  });

  it('property: a full-scale catalog never changes state between now and the answer', () => {
    let seed = 424_242;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32);
    const durations = [2, 24, 48, 49, 72, 108, 120];

    for (let trial = 0; trial < 40; trial++) {
      const items: OfferItemLike[] = [];
      for (let i = 0; i < 12; i++) {
        const start = EPOCH + Math.floor((rand() - 0.4) * 6 * 24 * H);
        const hours = durations[Math.floor(rand() * durations.length)];
        items.push({
          itemNumber: `F${trial}-${i}`,
          offer: {
            code: 'TBO',
            windowStart: toIso(start),
            windowEnd: toIso(start + hours * H),
            presaleEligible: rand() < 0.5,
            revealCadenceMs: rand() < 0.25 ? 3 * H : null,
          },
        });
      }
      const now = EPOCH + Math.floor((rand() - 0.5) * 8 * 24 * H);
      const signature = (at: number) => items.map((it) => lifecycleSignatureAt(it, at, CFG)).join('~');
      const answer = nextTransitionAt(items, now, CFG);
      const base = signature(now);

      if (answer === null) {
        for (let k = 1; k <= 50; k++) expect(signature(now + k * 6 * H)).toBe(base);
        continue;
      }
      expect(answer).toBeGreaterThan(now);
      expect(signature(answer - 1)).toBe(base);
      expect(signature(answer)).not.toBe(base);
      const step = Math.max(1, Math.floor((answer - now) / 40));
      for (let probe = now + 1; probe < answer; probe += step) expect(signature(probe)).toBe(base);
    }
  });
});

describe('purity', () => {
  it('never mutates its inputs and replays identically', () => {
    const catalog = [TBO_TODAY, TBO_TOMORROW, EVERGREEN_CLEARANCE];
    const frozen = JSON.stringify(catalog);
    const first = {
      states: catalog.map((i) => lifecycleStateAt(i.offer, S + H, CFG)),
      groups: Object.keys(activeOffersAt(catalog, S + H, CFG)),
      gates: catalog.map((i) => evaluateGates(i, S + H, { vipOfferActive: true }).gatesFailed),
      next: nextTransitionAt(catalog, S + H, CFG),
      language: catalog.map((i) => windowLanguage(i.offer, S + H, CFG)),
    };
    const second = {
      states: catalog.map((i) => lifecycleStateAt(i.offer, S + H, CFG)),
      groups: Object.keys(activeOffersAt(catalog, S + H, CFG)),
      gates: catalog.map((i) => evaluateGates(i, S + H, { vipOfferActive: true }).gatesFailed),
      next: nextTransitionAt(catalog, S + H, CFG),
      language: catalog.map((i) => windowLanguage(i.offer, S + H, CFG)),
    };
    expect(JSON.stringify(catalog)).toBe(frozen);
    expect(second).toEqual(first);
  });
});
