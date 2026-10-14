// src/units/P37/LEDGER.unit.test.ts
// P37 under the Closure Ledger, the second parity programme:
// the tests for the LOCAL criteria DV1 to DV6 of the P37 work order ("Device and
// recency as first-paint context"). DC1 to DC3 (decisions D1 to D3, RESOLVED
// 2026-10-09, amendment items 55, 58, 59, 60) are ruled and exercised inside DV1 to
// DV5; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P37.<criterion>')` per criterion. Every expected value comes
// from the work order, its decisions or a witness it cites, never from what the
// engine answers today:
//   · the work order's Done-when (amended ticket file, section E, P37): "the engine
//     reads a device class at the edge from the request's client hints, else its
//     user agent (mobile, desktop), and a recency bucket from the stored last visit
//     (same day, within 7 days, 8 to 30 days, 30 and more; a first visit has
//     none); both are seed-signal keys a seed rule can name; device is a P01
//     context term (an order may be published for a context that names a device
//     beside, or instead of, a channel and a visit bucket; the most specific match
//     wins; a context naming no device matches every device, so every receipted
//     P01 order keeps its meaning) … the receipt itemises device and recency when
//     they decided anything; P07's aggregation is unchanged; a tenant publishing no
//     device context and no recency rule behaves exactly as today; the kit
//     documents both";
//   · D1: the device values are mobile and desktop; a tablet counts as desktop.
//     D2: recency is days since the shopper's last stored visit, bucketed same day,
//     within 7 days, 8 to 30 days, 30 and more; a first visit has none. D3: first-
//     paint context, not learning-cell levels, no W25 grammar bump;
//   · the request's own client hint for mobile (`Sec-CH-UA-Mobile`, `?1` mobile,
//     `?0` not) and the user agent's conventions: an iPhone names `iPhone`; an
//     Android phone's user agent carries the `Mobile` token and an Android
//     tablet's does not; an iPad names `iPad` (a tablet, so desktop by D1);
//     src/services/platform.ts:44 reads the platform hint, else the user agent,
//     for the OS family and derives no device class;
//   · P01 as receipted (src/units/P01/LEDGER.unit.test.ts header; freeze item 17
//     D1: "the most specific match wins; a tie is refused at publication"; the
//     `configuredOrder` member on the record and the receipt) and the code at
//     af671ce7: `lastVisitAt` on the visit (src/services/visit.ts:160-176), the
//     seed arithmetic rule weight × slot weight (unit:W16.C3.01), the receipt's
//     "Arrival context" sentence (src/learn/receipts.ts:139-141), the cell's five
//     keys and the ladder keys (src/content/cell.ts:61-70, src/learn/stats.ts:43-46),
//     the cell grammar ladder-cell version 2 (src/learn/priors.ts:70-77).
//
// THE REPRESENTATION THIS FILE RULES (one for all six criteria):
//   · The device class is 'mobile' or 'desktop', read from the request: the client
//     hint `Sec-CH-UA-Mobile` when present (`?1` mobile, `?0` desktop), else the
//     user agent (a phone mobile; a tablet and every other user agent desktop);
//     a request carrying neither the hint nor a user agent has no device.
//   · The recency bucket is 'same_day', 'within_7_days', '8_to_30_days' or
//     '30_and_more' (in words "same day", "within 7 days", "8 to 30 days", "30 and
//     more"), derived when a visit opens from the stored last visit and kept for
//     that visit; a first visit has none.
//   · Both are recorded on the visit and answered on the SDK-visible hydrate
//     projection (`GET /realtime/reflex`) as a new member `arrival: { device?,
//     recency? }` beside `visit` (null where `visit` is null; a member is omitted
//     when there is none). `visit` itself keeps the `projectVisit` shape exactly,
//     because src/units/W16/C2, C2b, C4, C5, C8 and B9 pin it term for term.
//   · Seed-signal keys `device` (value mobile | desktop) and `recency` (value a
//     bucket id), read for the snapshot from the request's own device and the
//     visit's bucket, and itemised on `explain.contextual` and on the receipt's
//     "Arrival context" sentence with the device word and the bucket in words.
//   · A P01 context may carry `device: 'mobile' | 'desktop'` beside `channel` and
//     `visitBuckets` (which stay required, `any` expressing "instead of"); a
//     context without `device` matches every device; specificity counts a named
//     device as one more part; a tie is refused at publication as P01 refuses one.
//     The record's and the receipt's `configuredOrder.context` carry the device as
//     published, and the receipt's sentence names it.
//   · Nothing else changes: the decision cell keeps its five keys, the ladder its
//     six level keys, the cell grammar its version (no W25 bump, D3).
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the
// hydrate member `arrival` with `device` and `recency`; the seed signals `device`
// and `recency`; `device` in a P01 context. No new export is imported.
//
// THE REACHABLE RETURN (named): a return after more than 24 hours is the same
// shopper only on the anonymous return path of unit:W16.C6 (a published
// continuity configuration and its recognition proof; src/units/_parity5.ts
// `continuityReflex`, `visitorOn(…, { continuity: true })`), because a capability
// lives 24 hours (SHOPPER_MAX_AGE) and the shopper object admits only the grants it
// stored. The session host also expires a session record 30 days after its last
// write (SESSION_TTL_SECONDS, src/services/SessionManager.ts:96), so no shopper can
// return to it after more than 30 days: the 30-and-more bucket is measured on the
// object host, and its session-host leg is named in the report as unreachable.
//
// HARNESS: src/units/_parity.ts (mount, the P01 page, both hosts) and
// src/units/_parity5.ts (the shopper with headers and the reachable return, the
// home page, putKind).

import { describe, expect, it, vi } from 'vitest';

import {
  declaredSlots, errorsOf, HOSTS, layoutSlot, LAYOUT, learnDocument, loadSlots, M, MODULES, mount, pageInstanceOf, putSlots, readTree, receiptsOf,
  recentSlot, REFLEX_DOCUMENT, replayOf, servedIn, storedDecisions, TENANT, type Host, type Mounted,
} from '../_parity';
import {
  continuityReflex, DAY_MS, heroOf, HOME, HOME_ORDER, HOME_PIECES, homeLearn, homeSlots, HOUR_MS, lineSeed, putKind, visitorOn, whyOf, type Visitor,
} from '../_parity5';

const SITE = 'www.shop.test';
const DIRECT = { referrer: '', siteHost: SITE };
const PAID_SOCIAL = { utmMedium: 'paid_social', utmSource: 'instagram', referrer: 'l.instagram.com', siteHost: SITE };
const PAGE_VIEW = { type: 'page_view', data: { path: '/' } };

// The browsers (real user-agent strings).
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  // A tablet: it names iPad, and carries "Mobile/" in its build token, so a bare /Mobile/ test would misread it.
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
} as const;
const MOBILE = { 'Sec-CH-UA-Mobile': '?1', 'Sec-CH-UA-Platform': '"Android"', 'User-Agent': UA.androidPhone };
const DESKTOP = { 'Sec-CH-UA-Mobile': '?0', 'Sec-CH-UA-Platform': '"Windows"', 'User-Agent': UA.windows };

/** Each request and the device class D1 and the read order (hint, else user agent) give it; null is "no device". */
const DEVICES: Array<{ name: string; headers: Record<string, string>; device: 'mobile' | 'desktop' | null }> = [
  { name: 'an Android phone sending the mobile client hint', headers: MOBILE, device: 'mobile' },
  { name: 'an iPhone, no client hints', headers: { 'User-Agent': UA.iphone }, device: 'mobile' },
  { name: 'an iPad, no client hints (a tablet)', headers: { 'User-Agent': UA.ipad }, device: 'desktop' },
  { name: 'an Android tablet sending ?0', headers: { 'Sec-CH-UA-Mobile': '?0', 'User-Agent': UA.androidTablet }, device: 'desktop' },
  { name: 'an Android tablet, no client hints', headers: { 'User-Agent': UA.androidTablet }, device: 'desktop' },
  { name: 'a desktop browser sending ?0', headers: DESKTOP, device: 'desktop' },
  // The hint is read first: ?1 beside a desktop user agent is mobile.
  { name: 'the mobile client hint beside a desktop user agent', headers: { 'Sec-CH-UA-Mobile': '?1', 'User-Agent': UA.windows }, device: 'mobile' },
  { name: 'a request carrying neither the hint nor a user agent', headers: {}, device: null },
];

/** The SDK-visible hydrate, read without the browser's headers so the answer is what the visit recorded: `arrival` (ruled above) and `visit`. */
async function hydrated(v: Visitor): Promise<{ arrival: Record<string, unknown> | null | undefined; visit: { visitNumber?: unknown } | null | undefined }> {
  const saved = v.headers;
  v.headers = {};
  try {
    const read = await v.hydrate();
    expect(read.status, `the hydrate projection answers: ${JSON.stringify(read.body).slice(0, 200)}`).toBe(200);
    return { arrival: read.body.arrival as Record<string, unknown> | null | undefined, visit: read.body.visit as { visitNumber?: unknown } | null | undefined };
  } finally { v.headers = saved; }
}
const arrivalOf = async (v: Visitor) => (await hydrated(v)).arrival;

const HOME_DOCS = (seeds?: unknown[]) => ({ pieces: [...HOME_PIECES], slots: homeSlots(seeds), learn: homeLearn(), reflex: continuityReflex(REFLEX_DOCUMENT) });

// ===========================================================================
// unit:P37.DV1 — the device class, from the client hints else the user agent
// ===========================================================================

describe('unit:P37.DV1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the engine reads the device class from the client hint, else the user agent — mobile or desktop, a tablet desktop — records it on the shopper's visit, and records no device for a request carrying neither`, async () => {
      const m = await mount(host, HOME_DOCS());
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const seen: Array<[string, unknown]> = [];
      for (const { name, headers } of DEVICES) {
        const v = await visitorOn(m, { headers });
        expect((await v.action(PAGE_VIEW, { entry: DIRECT })).status, `${host}: PRECONDITION — ${name}: the shopper's page view is accepted`).toBe(200);
        const arrival = await arrivalOf(v);
        seen.push([name, arrival && typeof arrival === 'object' && 'device' in arrival ? arrival.device : arrival === undefined ? 'no arrival member' : null]);
      }
      expect(seen, `${host}: P37.DV1 — the device the shopper's visit records (the hydrate read itself carries no headers)`).toEqual(DEVICES.map(d => [d.name, d.device]));
    }, 180_000);
  }
});

// ===========================================================================
// unit:P37.DV2 — the recency bucket, from the stored last visit
// ===========================================================================

describe('unit:P37.DV2', () => {
  /** Days since the last visit and the bucket D2 gives them; the boundary day 30 itself, which D2 names in two buckets, is not used. */
  const GAPS: Array<[string, number, string, Host[]]> = [
    ['2 hours later', 2 * HOUR_MS, 'same_day', ['session', 'do']],
    ['3 days later', 3 * DAY_MS, 'within_7_days', ['session', 'do']],
    ['15 days later', 15 * DAY_MS, '8_to_30_days', ['session', 'do']],
    ['40 days later', 40 * DAY_MS, '30_and_more', ['do']],
  ];
  for (const host of HOSTS) {
    it(`host (${host}): a first visit records no recency; a return records the bucket of the days since the shopper's stored last visit, kept for that visit`, async () => {
      // Every clock below is in the past, so the operator token minted at mount stays current.
      const T0 = Date.now() - 50 * DAY_MS;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const m = await mount(host, HOME_DOCS());
        expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
        const seen: Array<[string, unknown, unknown]> = [];
        for (const [name, gap, , hosts] of GAPS) {
          if (!hosts.includes(host)) continue;
          clock.mockReturnValue(T0);
          const v = await visitorOn(m, { continuity: true });
          expect((await v.action(PAGE_VIEW, { entry: DIRECT })).status, `${host}: PRECONDITION — ${name}: the shopper's first visit opens`).toBe(200);
          const first = await arrivalOf(v);
          const firstRecency = first && typeof first === 'object' ? ('recency' in first ? first.recency : 'none') : first === undefined ? 'no arrival member' : first;
          if (gap > 25 * DAY_MS) {
            // The shopper's 30-day explicit choice (src/content/consent.ts:17) is renewed on a return that opens no visit: the stored last visit stays day 0.
            clock.mockReturnValue(T0 + 25 * DAY_MS);
            await v.returnNow();
            await v.chooseAgain();
          }
          clock.mockReturnValue(T0 + gap);
          if (gap > 20 * HOUR_MS) await v.returnNow();
          expect((await v.action(PAGE_VIEW, { entry: DIRECT })).status, `${host}: PRECONDITION — ${name}: the visit the shopper returns on opens`).toBe(200);
          // Five minutes into the visit the shopper returned on: the bucket is the visit's, not a recount from that visit's own start.
          clock.mockReturnValue(T0 + gap + 5 * 60_000);
          const { arrival: later, visit } = await hydrated(v);
          expect(visit?.visitNumber, `${host}: PRECONDITION — ${name}: the return kept the shopper's stored visits (this is the shopper's second visit)`).toBe(2);
          seen.push([name, firstRecency, later && typeof later === 'object' ? later.recency ?? 'none' : later === undefined ? 'no arrival member' : later]);
        }
        expect(seen, `${host}: P37.DV2 — no recency on a first visit; the stored last visit's bucket on the return`)
          .toEqual(GAPS.filter(([, , , hosts]) => hosts.includes(host)).map(([name, , bucket]) => [name, 'none', bucket]));
      } finally { clock.mockRestore(); }
    }, 240_000);
  }
});

// ===========================================================================
// unit:P37.DV3 — device and recency as seed-signal keys, on the receipt in words
// ===========================================================================

describe('unit:P37.DV3', () => {
  const SEEDS = [
    lineSeed('device', 'mobile', 'Meadow', 0.6),
    lineSeed('recency', 'within_7_days', 'Summit', 0.4),
  ];
  const lifted = (snap: Parameters<typeof heroOf>[0]) => heroOf(snap).filter(([, score]) => (score ?? 0) > 0);
  for (const host of HOSTS) {
    it(`host (${host}): a seed rule naming a device or a recency bucket lifts a matching arrival at the rule's weight and the receipt itemises it with the device or the recency in words; a non-matching arrival is not lifted`, async () => {
      // Mounted first, so the operator token minted at mount stays current under every clock below (all in the past).
      const m = await mount(host, HOME_DOCS());
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const T0 = Date.now() - 10 * DAY_MS;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const written = await putSlots(m, homeSlots(SEEDS), 'seeds on the device and the recency');
        expect(written.status, `${host}: P37.DV3 — seed rules naming device and recency publish: ${JSON.stringify(errorsOf(written))}`).toBe(200);

        // First paint: the device is read from the snapshot request itself.
        const phone = await visitorOn(m, { headers: MOBILE }), laptop = await visitorOn(m, { headers: DESKTOP }), bare = await visitorOn(m);
        const seen: Array<[string, unknown]> = [];
        for (const [name, v] of [['a mobile request', phone], ['a desktop request', laptop], ['a request with no device', bare]] as const) {
          const snap = await v.snapshot(HOME, { entry: DIRECT });
          expect(snap.status, `${host}: PRECONDITION — ${name}: served`).toBe(200);
          seen.push([name, lifted(snap)]);
        }
        // Recency: the first visit has none; the return three days later is within 7 days (D2).
        const back = await visitorOn(m, { headers: DESKTOP, continuity: true });
        expect((await back.action(PAGE_VIEW, { entry: DIRECT })).status, `${host}: PRECONDITION — the shopper's first visit opens`).toBe(200);
        seen.push(['a first visit', lifted(await back.snapshot(HOME, { entry: DIRECT }))]);
        clock.mockReturnValue(T0 + 3 * DAY_MS);
        await back.returnNow();
        expect((await back.action(PAGE_VIEW, { entry: DIRECT })).status, `${host}: PRECONDITION — the shopper's return opens a visit`).toBe(200);
        seen.push(['a return three days later', lifted(await back.snapshot(HOME, { entry: DIRECT }))]);
        expect(seen, `${host}: P37.DV3 — each rule lifts its matching arrival at exactly its weight (× the slot weight 1) and nothing else`).toEqual([
          ['a mobile request', [['story.meadow', 0.6]]], ['a desktop request', []], ['a request with no device', []],
          ['a first visit', []], ['a return three days later', [['story.summit', 0.4]]],
        ]);

        const phoneWhy = whyOf(await receiptsOf(m, phone.subject), 'story.meadow');
        expect.soft(phoneWhy.some(s => /device/i.test(s) && s.includes('mobile')),
          `${host}: P37.DV3 — the receipt itemises the device rule with the device in words (why: ${JSON.stringify(phoneWhy)})`).toBe(true);
        const backWhy = whyOf(await receiptsOf(m, back.subject), 'story.summit');
        expect.soft(backWhy.some(s => /recency/i.test(s) && s.includes('within 7 days')),
          `${host}: P37.DV3 — the receipt itemises the recency rule with the bucket in words (why: ${JSON.stringify(backWhy)})`).toBe(true);
      } finally { clock.mockRestore(); }
    }, 240_000);
  }
});

// ===========================================================================
// unit:P37.DV4 — device as a P01 context term
// ===========================================================================

describe('unit:P37.DV4', () => {
  const BASE = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
  /** Orders that differ from catalogue order and from each other. */
  const ORDER_DEVICE = [M.ugc, M.editorial, M.reco2, M.grid];
  const ORDER_CHANNEL = [M.editorial, M.grid, M.ugc, M.reco1];
  const ORDER_BOTH = [M.reco2, M.reco1, M.grid, M.editorial];
  /** The slot's own decision for a shopper with no signal (P02.A2, as src/units/P01/LEDGER.unit.test.ts:94 derives it). */
  const OWN_COLD = [M.grid, M.reco1, M.reco2, M.editorial];
  const withOrders = (orders: unknown[]) => declaredSlots([layoutSlot({ orders }), recentSlot()]);

  async function arrived(m: Mounted, entry: Record<string, string>, headers: Record<string, string>): Promise<Visitor> {
    const v = await visitorOn(m, { headers });
    expect((await v.action(PAGE_VIEW, { entry })).status, `${m.host}: PRECONDITION — the shopper's page view is accepted`).toBe(200);
    return v;
  }
  const layoutOf = async (v: Visitor) => servedIn(await v.snapshot('pdp', { pageInstance: pageInstanceOf('p37-dv4') }), LAYOUT);

  for (const host of HOSTS) {
    it(`host (${host}): an order published for a context naming a device, beside or instead of a channel and a visit bucket, is served to a shopper in that context, the most specific match wins, and the record and the receipt name the device as published`, async () => {
      const m = await mount(host, BASE);
      expect(m.refused, 'PRECONDITION: the declared layout slot (P02) publishes').toBeNull();
      const mobileSocial = await arrived(m, PAID_SOCIAL, MOBILE), desktopSocial = await arrived(m, PAID_SOCIAL, DESKTOP);
      const mobileDirect = await arrived(m, DIRECT, MOBILE), desktopDirect = await arrived(m, DIRECT, DESKTOP);
      const orders = [
        { context: { channel: 'any', visitBuckets: 'any', device: 'mobile' }, modules: ORDER_DEVICE },
        { context: { channel: 'paid_social', visitBuckets: ['1'] }, modules: ORDER_CHANNEL },
        { context: { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' }, modules: ORDER_BOTH },
      ];
      const written = await putSlots(m, withOrders(orders), 'orders with a device term');
      expect(written.status, `${host}: P37.DV4 — orders naming a device publish: ${JSON.stringify(errorsOf(written))}`).toBe(200);
      const stored = (await loadSlots(m)).document as { pages: Record<string, Array<Record<string, unknown>>> };
      expect.soft(stored.pages.pdp?.find(s => s.slot === LAYOUT)?.orders, `${host}: P37.DV4 — the revision carries the orders as authored`).toEqual(orders);
      expect([await layoutOf(mobileSocial), await layoutOf(desktopSocial), await layoutOf(mobileDirect), await layoutOf(desktopDirect)],
        `${host}: P37.DV4 — mobile paid social: the three-part order; desktop paid social: the channel order (no device named matches every device); mobile direct: the device-only order; desktop direct: the slot's own decision`)
        .toEqual([ORDER_BOTH, ORDER_CHANNEL, ORDER_DEVICE, OWN_COLD]);

      const page = await mobileDirect.snapshot('pdp', { pageInstance: pageInstanceOf('p37-dv4-receipt') });
      for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await mobileDirect.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const expected = { context: { channel: 'any', device: 'mobile', visitBuckets: 'any' }, modules: ORDER_DEVICE };
      const records = storedDecisions(m, mobileDirect.subject).filter(r => r.slot === LAYOUT);
      expect(records.length, `${host}: PRECONDITION — the ledger holds the shopper's layout decisions`).toBe(4);
      for (const r of records) expect.soft((r.explain as Record<string, unknown>).configuredOrder, `${host}: P37.DV4 — the record names the device context as published`).toEqual(expected);
      const receipts = (await receiptsOf(m, mobileDirect.subject)).filter(r => r.slot === LAYOUT);
      expect(receipts.length, `${host}: PRECONDITION — a receipt for every position`).toBeGreaterThanOrEqual(4);
      for (const r of receipts) {
        expect.soft(r.configuredOrder, `${host}: P37.DV4 — the receipt names the device context as published`).toEqual(expected);
        expect.soft((r.why as string[]).some(s => /configured order/i.test(s) && s.includes('mobile')), `${host}: P37.DV4 — and its sentence names the device (why: ${JSON.stringify(r.why)})`).toBe(true);
      }
    }, 180_000);

    it(`host (${host}): LOCK — an order whose context names no device matches every device, so a receipted P01 order keeps its meaning for a mobile, a desktop and a device-less shopper`, async () => {
      const m = await mount(host, BASE);
      expect(m.refused, 'PRECONDITION: the declared layout slot (P02) publishes').toBeNull();
      const shoppers = [await arrived(m, PAID_SOCIAL, MOBILE), await arrived(m, PAID_SOCIAL, DESKTOP), await arrived(m, PAID_SOCIAL, {})];
      const written = await putSlots(m, withOrders([{ context: { channel: 'paid_social', visitBuckets: ['1'] }, modules: ORDER_CHANNEL }]), 'a receipted P01 order');
      expect(written.status, `${host}: PRECONDITION — the P01 order publishes`).toBe(200);
      const served = [];
      for (const v of shoppers) served.push(await layoutOf(v));
      // LOCKED (src/content/decide.ts:296-311, the P01 match): the order for the context, whatever the device.
      expect(served, `${host}: P37.DV4 — the order is served to the context on every device`).toEqual([ORDER_CHANNEL, ORDER_CHANNEL, ORDER_CHANNEL]);
    }, 120_000);
  }

  it('host: two contexts of equal specificity that one shopper matches — a device beside any visit, and a visit bucket with no device — are refused at publication with an error naming the orders, writing no revision', async () => {
    const m = await mount('session', BASE);
    expect(m.refused, 'PRECONDITION: the declared layout slot (P02) publishes').toBeNull();
    const control = await putSlots(m, withOrders([{ context: { channel: 'paid_social', visitBuckets: ['1'] }, modules: ORDER_CHANNEL }]), 'control');
    expect(control.status, 'CONTROL — a P01 order publishes').toBe(200);
    const revision = (await loadSlots(m)).revision;
    const tie = await putSlots(m, withOrders([
      { context: { channel: 'paid_social', visitBuckets: 'any', device: 'mobile' }, modules: ORDER_DEVICE },
      { context: { channel: 'paid_social', visitBuckets: ['1'] }, modules: ORDER_CHANNEL },
    ]), 'a tie');
    const errors = errorsOf(tie);
    expect([tie.status, errors.some(e => /orders/.test(e) && /device|specific/i.test(e))],
      `P37.DV4 — the tie is refused (422) naming the orders (a mobile paid-social first visit matches both at specificity 2): ${JSON.stringify(errors)}`).toEqual([422, true]);
    expect((await loadSlots(m)).revision, 'P37.DV4 — and wrote no revision').toBe(revision);
  }, 120_000);
});

// ===========================================================================
// unit:P37.DV5 — the cell, its grammar, the ladder keys and today's decisions unchanged
// ===========================================================================

describe('unit:P37.DV5', () => {
  const PRIORS_TODAY = { version: 'parity5-priors', cellGrammar: { name: 'ladder-cell', version: 2, order: ['c', 'v', 's', 'r', 'a'] },
    rows: [{ slot: 'home-hero', item: 'story.harbor', cell: 'c=paid_social|v=1', p_prior: 0.05, n_equiv: 20 }] };
  /** The six ladder keys of a paid-social first visit, as src/learn/stats.ts:43-46 builds them from the five-key cell. */
  const LADDER = ['*', 'c=paid_social', 'c=paid_social|v=1', 'c=paid_social|v=1|s=early', 'c=paid_social|v=1|s=early|r=none', 'c=paid_social|v=1|s=early|r=none|a=none'];

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a tenant publishing no device context and no device or recency rule decides term for term as today for a mobile, a desktop and a device-less shopper: the same served answer, the five-key cell, the six ladder keys, replay equal, and a priors file exported today imports`, async () => {
      const m = await mount(host, HOME_DOCS(), { recovery: false });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const answers: unknown[] = [], cells: unknown[] = [], replays: unknown[] = [];
      for (const headers of [MOBILE, DESKTOP, {}]) {
        const v = await visitorOn(m, { headers });
        expect((await v.action(PAGE_VIEW, { entry: PAID_SOCIAL })).status, `${host}: PRECONDITION — the shopper's page view is accepted`).toBe(200);
        const snap = await v.snapshot(HOME, { entry: PAID_SOCIAL });
        expect(snap.status, `${host}: PRECONDITION — served`).toBe(200);
        answers.push(snap.decisions.map(d => [d.contentId, d.slot, d.order, d.score, d.strategy]));
        await m.drainLedger();
        const stored = storedDecisions(m, v.subject);
        cells.push(stored.map(r => r.cell));
        for (const r of stored) {
          const replay = await replayOf(m, r.decision_id);
          replays.push([replay.status, replay.body.classification ?? replay.body.reason ?? null]);
        }
      }
      // LOCKED (unit:W16.C3.03: no rule set, no contextual influence; src/content/cell.ts:61-70; src/learn/replay.ts).
      const today = HOME_ORDER.map((id, order) => [id, 'home-hero', order, 0, 'default']);
      expect(answers, `${host}: P37.DV5 — every device is served today's answer, term for term`).toEqual([today, today, today]);
      const cell = { channel: 'paid_social', visit_bucket: '1', region: null, affinity: null, stage: 'early' };
      expect(cells, `${host}: P37.DV5 — the decision cell keeps its five keys, no device and no recency`).toEqual([0, 1, 2].map(() => HOME_ORDER.map(() => cell)));
      expect(replays, `${host}: P37.DV5 — every decision replays equal`).toEqual(replays.map(() => [200, 'equal']));
      const imported = await putKind(m, 'priors', PRIORS_TODAY, 'today’s grammar');
      expect(imported.status, `${host}: P37.DV5 — a priors file exported under today's grammar still imports (no W25 bump): ${JSON.stringify(errorsOf(imported))}`).toBe(200);
    }, 180_000);

    it(`host (${host}): LOCK — the statistics a mobile shopper's served decisions fan into are keyed on the six ladder keys of today's cell and on nothing of the device`, async () => {
      const m = await mount(host, HOME_DOCS(), { recovery: false });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const v = await visitorOn(m, { headers: MOBILE });
      expect((await v.action(PAGE_VIEW, { entry: PAID_SOCIAL })).status, `${host}: PRECONDITION — the shopper's page view is accepted`).toBe(200);
      expect((await v.snapshot(HOME, { entry: PAID_SOCIAL })).status, `${host}: PRECONDITION — served`).toBe(200);
      await m.drainLedger();
      const keys = new Set<string>();
      for (const name of [...m.stats.keys()]) {
        const response = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/snapshot', { method: 'POST' });
        const body = await response.json().catch(() => ({})) as { snapshot?: { items?: Record<string, Record<string, unknown>> } | null };
        for (const cells of Object.values(body.snapshot?.items ?? {})) for (const key of Object.keys(cells)) keys.add(key);
      }
      expect(keys.size, `${host}: PRECONDITION — the served decisions reached the statistics`).toBeGreaterThan(0);
      // LOCKED (src/learn/stats.ts:43-46; the W16.C5 fan-in): today's ladder keys exactly.
      expect([...keys].sort(), `${host}: P37.DV5 — the fan-in keys are today's ladder keys`).toEqual([...LADDER].sort());
    }, 120_000);
  }
});

// ===========================================================================
// unit:P37.DV6 — the kit documents both
// ===========================================================================

describe('unit:P37.DV6', () => {
  it('logic: docs/kit/02-api-reference.md and docs/kit/03-payload-schemas.md document the device class, the recency bucket, their seed-signal keys and the device term of a P01 context', () => {
    const missing: string[] = [];
    for (const file of ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']) {
      const lines = readTree(file).split('\n');
      const has = (...words: string[]) => lines.some(line => words.every(w => line.includes(w)));
      if (!has('Sec-CH-UA-Mobile')) missing.push(`${file}: the device class read from the client hint (Sec-CH-UA-Mobile), else the user agent`);
      if (!has('tablet', 'desktop')) missing.push(`${file}: a tablet counts as desktop`);
      if (!has('same_day', 'within_7_days', '8_to_30_days', '30_and_more')) missing.push(`${file}: the four recency buckets`);
      if (!has('recency', 'first visit')) missing.push(`${file}: a first visit has no recency`);
      if (!has('`device`', '`recency`', 'signal')) missing.push(`${file}: device and recency as seed-signal keys`);
      if (!has('visitBuckets', 'device')) missing.push(`${file}: the device term of a P01 context`);
      if (!has('arrival', 'device', 'recency')) missing.push(`${file}: the hydrate's arrival member`);
    }
    expect(missing, 'P37.DV6 — the kit documents device and recency').toEqual([]);
  });
});
