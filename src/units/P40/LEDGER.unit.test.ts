// src/units/P40/LEDGER.unit.test.ts
// P40 under the Closure Ledger, the second parity programme:
// the tests for the LOCAL criteria EV1 to EV5 of the P40 work order ("Module
// events as the customer defines them"). DC1 and DC2 (decisions D1, D2, RESOLVED
// 2026-10-09, amendment item 55 with DI-15 and gap 20) are ruled and exercised
// inside EV1; LV1 to LV3 are deferred live rows and get no test.
//
// One `describe('unit:P40.<criterion>')` per criterion. Every expected value comes
// from the work order, its decisions or a witness it cites, never from what the
// engine answers today:
//   · the work order's Done-when (amended ticket file, section E, P40): "the SDK
//     records a viewable impression (at least 50 percent of the container in view
//     for at least 1 second) beside the render acknowledgement, as a distinct event
//     that weighs 0 and never builds interest, changing no denominator;
//     `video_view` at 3 seconds is a content action that reads the piece's format
//     from the catalogue, as `video_complete` does; a dwell minimum per slot (30
//     seconds on editorial) in the SDK, and `product_dwell` (20 seconds on a
//     product page, once per view) accepted with `dwellMs`; purchase outcomes are
//     unique per order id on the engine side; `search` (the resolved values, never
//     the query text), `filter_applied` (the facet's dimension and value; the sale
//     filter and the sale page raising `priceStatus: sale`), `product_dwell` and
//     `remove_from_cart` (captured at weight 0 until P39) are documented in the kit
//     as event conventions …; size guide and reviews opened are documented as
//     declared interactions of the module that owns them (P03)";
//   · D1: recorded beside the render acknowledgement, weighs 0, never builds
//     interest, changes no learning denominator. D2: the one-second rule is
//     continuous;
//   · the customer's T8 rows 5, 6, 13, 14 (authority copy): purchase
//     "server-confirmed and deduplicated on order ID"; video view at 3 seconds;
//     dwell past 20 seconds on a product page, 30 on editorial; content impression
//     at least 50% in view for at least 1 second;
//   · P03 as receipted (src/units/P03/LEDGER.unit.test.ts: the marked container,
//     the render acknowledgement, the receipt `original-<slot>-<order>-<id>` of
//     src/sdk/testHost.ts:22-25), the visibility port's contract ("visible true
//     when at least half the element is on screen", src/sdk/types.ts:81-85), and
//     the code at af671ce7: the content actions and their default weights
//     (src/reflex/contentTelemetry.ts:44, :59-64: video_complete 2, read from the
//     catalogue's format, :111-126), the saturating affinity a = R / (R + K) with
//     K 1.8 (src/reflex/core.ts:259-262, :287-290), the dwell minimum of one second
//     (src/sdk/listen.ts:58, src/sdk/emit.ts:303), `dwellMs` feeding the visit's
//     dwell counter (src/services/JourneyStage.ts:337), the purchase weight 5
//     (src/reflex/core.ts:221-244).
//
// THE REPRESENTATION THIS FILE RULES (one for all five criteria):
//   · The viewable impression is the event type `content_viewable`, in the closed
//     list (src/events/actionTypes.ts) and the SDK's event types, carrying the
//     content-action fields: `contentId` (the module), `slot`, `slotPosition`,
//     `decisionId`, `page`, `pageInstance`, `position`. The SDK sends one per
//     module per page instance, after that module's render acknowledgement, once
//     the visibility port has reported it visible (at least half) for at least one
//     second without interruption; it sends none for a container visible less than
//     one second at a time or never visible. The hosts accept it at weight 0,
//     build no interest from it and count no exposure for it.
//   · `video_view` is an event type in the same lists and a content action whose
//     default weight is 1, reading the piece's format from the catalogue as
//     `video_complete` does; the tenant's registry weight for it applies when
//     published; the SDK's emit offers `videoView(contentId, slot, attrs?)` beside
//     `videoComplete`.
//   · The SDK's declarative capture takes `dwellMinMsBySlot: { <slot>: ms }` beside
//     `dwellMinMs`; a slot it names uses that minimum, every other slot the one-
//     second default.
//   · `product_dwell` is an event type in the closed list, carrying `productId` and
//     `dwellMs`; its `dwellMs` feeds the visit's dwell counter as any event's does.
//   · A purchase is unique per `orderId` for the shopper: a second purchase naming
//     the same order is answered 200 with `dropped: 'duplicate_order'` and writes no
//     outcome, no credit and no interest.
//
// THE LEAD'S RULINGS AFTER THE S5 SPECIFICATION REVIEW (2026-10-09), binding on the
// build:
//   · R-P48, purchase uniqueness. A re-delivery of the same event id is not a
//     second purchase: it re-answers with its identical record, as unit W09.05
//     expects (realtime.sdkContract.test.ts, `queued[0]` equal to `queued[2]`).
//     Deduplication by order id applies to DISTINCT events of one shopper, after
//     the event's admission and the rate limit, inside the shopper's owner (so
//     W22.07's 429 from the rate limiter holds). A purchase without an order id is
//     never deduplicated. The order ids seen live inside the shopper's existing
//     state and are written only when used (no new storage key: the exact key-set
//     locks at realtime.sdkContract.test.ts:285, :919, :1048 and
//     src/reflex/shopperReflex.test.ts:406-417 hold). Under R10, the three
//     stale locks that sent two distinct purchase events with one order id
//     (realtime.sdkContract.test.ts W26.02, W09.05 and the first W22.07 test,
//     "validates explicit buffered context …") now give each distinct purchase
//     event its own order id, every other assertion unchanged; this ticket's
//     branch carries that file.
//   · R-P49, representation. `content_viewable`, `video_view` and `product_dwell`
//     are closed-list event types (src/events/actionTypes.ts), not custom events.
//     The viewable impression is sent from a one-second timer started after the
//     module's render acknowledgement and cancelled on hide, detach, destroy,
//     consent loss and generation change; it is never computed when the container
//     leaves view (src/units/W17/L1.unit.test.ts:460-466 and
//     src/sdk/listen.test.ts:71-73 pin the exact events of a leave). EV3's
//     product_dwell event carries a value the published catalogue admits (the
//     fixture corrected, no expected value changed).
//
// THE LEAD'S RULING AFTER THE P40 DELIVERY REVIEW (2026-10-12), binding on the fix:
//   · R-P58 (P40 fix round 1; the review measured c1481f0a), the buffered
//     door. A non-duplicate buffered purchase that names an order is remembered in
//     the shopper's existing state whenever that delivery writes the shopper's
//     state at all, whether or not it applies interest. The kit's own purchase
//     payload (`orderId`, `value`, `currency`, `items[]`,
//     docs/kit/03-payload-schemas.md:20) places no registry value, so its buffered
//     delivery applies no interest, and yet the same order delivered afterwards,
//     live or buffered, answers `duplicate_order` with one outcome. The memory is
//     inside the shopper's reflex state: its key set gains `orders` at the first
//     purchase naming an order and nothing else. The buffered delivery of a
//     shopper who refused personalization is a named limit, not tested here
//     (realtime.sdkContract.test.ts:2721-2726, W22.07 "gates both hosts", pins
//     that it writes nothing).
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the
// event types `content_viewable`, `video_view`, `product_dwell`; `emit.videoView`;
// the declarative option `dwellMinMsBySlot`; the answer member
// `dropped: 'duplicate_order'`. No new export is imported.
//
// BOUNDARY NOTE (named, not ruled): `WIRE` in src/sdk/wire.ts is typed
// `Record<SdkEventType, WireMapping>`, so adding an SDK event type needs a row there,
// and src/sdk/wire.ts is not in P40's allowed paths.
//
// HARNESS: src/units/_parity.ts (mount, both hosts, learned, storedOutcomes) and
// src/units/_parity5.ts (the shopper, the home page); the sdk legs drive the real
// SDK entry composition (createCore + createListen + createEmit) over the
// repository's test host on a real jsdom page, as src/units/P03/LEDGER.unit.test.ts
// does (that file is not imported).

import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createListen } from '@/sdk/listen';
import { offeredSet, testHost } from '@/sdk/testHost';
import type { DomLike, ElementLike } from '@/sdk/types';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';

import {
  HOSTS, LAYOUT, learned, M, mount, pageInstanceOf, readTree, REFLEX_DOCUMENT, rounded, storedOutcomes, TENANT, type Answer, type Host, type Mounted,
} from '../_parity';
import { HERO, HOME, homeLearn, visitorOn, type Visitor } from '../_parity5';

// ===========================================================================
// The SDK page (P03's pattern: the marked containers, the decision set, the visibility port).
// ===========================================================================

const EDITORIAL = 'pdp-editorial';
interface PageEl extends ElementLike { click(): void }
interface Posted { type: string; data: Record<string, unknown> }
/** offeredSet mints `${revision}-${slot}-${order}-${contentId}` (src/sdk/testHost.ts:22-25). */
const receiptOf = (slot: string, order: number, id: string) => `original-${slot}-${order}-${id}`;
const LAYOUT_MODULES = [M.grid, M.reco1, M.reco2, M.editorial];
const EDITORIAL_PIECES = ['story.long-read', 'story.short-read'];

function sdkPage() {
  const dom = new JSDOM(`<main>
    ${LAYOUT_MODULES.map((id, i) => `<section id="m${i}" data-op-slot="${LAYOUT}" data-op-content="${id}"><a href="#m${i}">Module ${i}</a></section>`).join('\n')}
    ${EDITORIAL_PIECES.map((id, i) => `<article id="e${i}" data-op-slot="${EDITORIAL}" data-op-content="${id}"><p>Story ${i}</p></article>`).join('\n')}
  </main>`, { url: 'https://www.shop.test/products/a-product' });
  const win = dom.window as unknown as { document: { getElementById(id: string): unknown; querySelectorAll(sel: string): ArrayLike<unknown> }; close(): void };
  const doc = win.document;
  const watchers = new Map<unknown, Set<(visible: boolean) => void>>();
  /** The DomLike port (src/sdk/types.ts:81-85): `visible` true when at least half the element is on screen, delivered by the test. */
  const port: DomLike = {
    querySelectorAll: (sel: string) => Array.from(doc.querySelectorAll(sel)) as unknown as ArrayLike<ElementLike> & Iterable<ElementLike>,
    observe: (el: ElementLike, cb: (visible: boolean) => void) => {
      const set = watchers.get(el) ?? new Set<(visible: boolean) => void>(); set.add(cb); watchers.set(el, set);
      return () => { set.delete(cb); };
    },
  };
  const el = (id: string) => doc.getElementById(id) as unknown as PageEl;
  const show = (id: string, visible = true) => { for (const cb of [...(watchers.get(el(id)) ?? [])]) cb(visible); };
  const f = testHost({ renderAcks: true });
  f.host.dom = port;
  const core = createCore({ tenant: TENANT, source: 'parity5-pdp' }, f.host);
  const listen = createListen(core);
  const emit = createEmit(core, listen);
  const set = offeredSet({ page: 'pdp', decisions: [
    ...LAYOUT_MODULES.map((id, i) => ({ contentId: id, customerContentId: `CMS-${i}`, slot: LAYOUT, order: i, slotPosition: i, type: 'module', strategy: 'default' as const, score: 0, explain: { drivers: [] } })),
    ...EDITORIAL_PIECES.map((id, i) => ({ contentId: id, customerContentId: `CMS-E${i}`, slot: EDITORIAL, order: LAYOUT_MODULES.length + i, slotPosition: i, type: 'editorial', strategy: 'default' as const, score: 0, explain: { drivers: [] } })),
  ] }, 'p40-page');
  const sent = (): Posted[] => f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!) as Posted);
  const ofType = (type: string, id?: string) => sent().filter(e => e.type === type && (id === undefined || e.data.contentId === id));
  return { f, el, show, core, listen, emit, set, sent, ofType, close: () => win.close() };
}

// ===========================================================================
// The host pages.
// ===========================================================================

const VIDEO = 'film.summit', STORY = 'story.harbor';
/** The catalogue names each piece's format in `tags.contentType` (kit 03, content format affinity); the film's rendering type is not its format. */
const PIECES = [
  { id: VIDEO, customerContentId: 'CMS-FILM-SUMMIT', type: 'film', title: 'The summit film', tags: { contentType: ['video'], line: ['Summit'] }, slotTypes: [HERO], lifecycle: { status: 'live' } },
  { id: STORY, customerContentId: 'CMS-STORY-HARBOR', type: 'editorial', title: 'The harbor edit', tags: { contentType: ['editorial'], line: ['Harbor'] }, slotTypes: [HERO], lifecycle: { status: 'live' } },
];
const SLOTS = { version: 'parity5-slots', pages: { [HOME]: [{ slot: HERO, take: 2, weights: { contentType: 1, line: 1 } }] } };
/** The tenant's registry: the shipped default, the event's own values counted, and a journey stage on the visit's dwell counter. */
const REGISTRY = { ...REFLEX_DOCUMENT, version: 'parity5-events-registry',
  journey: { stages: [{ stage: 'thinking', anyOf: { category_dwell_ms: 20_000 } }, { stage: 'deciding', anyOf: { purchases: 1 } }] } };
const docs = (learnSlot: Record<string, unknown>, reflex: unknown = REGISTRY) =>
  ({ pieces: PIECES, slots: SLOTS, learn: homeLearn({ slots: { [HERO]: learnSlot } }), reflex });
const K = 1.8;

/** The shopper's interest per dimension and value, from the SDK-visible hydrate. */
async function interest(v: Visitor): Promise<Record<string, Record<string, number>>> {
  const read = await v.hydrate();
  expect(read.status, 'the hydrate answers').toBe(200);
  return ((read.body.affinity as { dims?: Record<string, Record<string, number>> } | null)?.dims ?? {});
}
/** A content action on a served decision, in the content-action fields the SDK sends. */
const contentAction = (v: Visitor, type: string, d: { contentId: string; slot: string; decisionId?: string; order: number }, extra: Record<string, unknown> = {}) =>
  v.action({ type, data: { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, page: HOME, position: d.order, slotPosition: d.order, ...extra } });

// ===========================================================================
// unit:P40.EV1 — the viewable impression
// ===========================================================================

describe('unit:P40.EV1', () => {
  it('sdk: one viewable impression per module per page instance, after its render acknowledgement, once at least half of the container has been in view for one second without interruption, carrying the module, the slot, the position within the slot and the decision; none for less than a second at a time or for a container never half in view', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const p = sdkPage();
    try {
      const settle = async () => { for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(5); };
      /** Time passing for the page: the test host's clock and the timers together. */
      const hold = async (ms: number) => { p.f.tick(ms); await vi.advanceTimersByTimeAsync(ms); };
      const ready = p.core.ready();
      await settle();
      expect(await ready, 'PRECONDITION: the client is ready').toBe(true);
      p.listen.apply(p.set);
      p.emit.declarative();
      await settle();
      // m0: in view for one second, then out; then in view again for longer.
      p.show('m0'); await hold(1_000); p.show('m0', false); await settle();
      p.show('m0'); await hold(1_500); p.show('m0', false); await settle();
      // m1: in view for 999 ms only.
      p.show('m1'); await hold(999); p.show('m1', false); await settle();
      // m2: 600 ms, out, 600 ms again: 1.2 s in total but never one second continuously (D2).
      p.show('m2'); await hold(600); p.show('m2', false); await settle();
      p.show('m2'); await hold(600); p.show('m2', false); await settle();
      // m3: never reported half in view.
      p.show('m3', false); await hold(2_000); await settle();
      expect(p.ofType('content_impression', M.grid).length + p.ofType('content_impression', M.reco1).length,
        'PRECONDITION: the containers shown were acknowledged (the render acknowledgement is the impression, P03)').toBe(2);
      const viewable = p.ofType('content_viewable');
      expect(viewable.map(e => e.data.contentId), 'P40.EV1 — exactly one viewable impression, for the module in view one second without interruption').toEqual([M.grid]);
      expect.soft(viewable[0]?.data, 'P40.EV1 — carrying the module, the slot, the position within the slot and the decision')
        .toMatchObject({ contentId: M.grid, slot: LAYOUT, slotPosition: 0, decisionId: receiptOf(LAYOUT, 0, M.grid) });
      const order = p.sent().map(e => `${e.type}:${String(e.data.contentId)}`);
      expect.soft(order.indexOf(`content_impression:${M.grid}`) < order.indexOf(`content_viewable:${M.grid}`),
        `P40.EV1 — after the module's render acknowledgement (${JSON.stringify(order)})`).toBe(true);
    } finally { p.close(); vi.useRealTimers(); }
  });

  for (const host of HOSTS) {
    it(`host (${host}): the viewable impression is accepted, weighs 0, builds no interest and changes no exposure count; the render acknowledgement still counts its one exposure`, async () => {
      const m = await mount(host, docs({ measurementBasis: 'rendered-v1', reward: 'click' }));
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const v = await visitorOn(m);
      const page = await v.snapshot(HOME, { pageInstance: pageInstanceOf('p40-ev1') });
      const film = page.decisions.find(d => d.contentId === VIDEO);
      expect(film?.decisionId ? 'served' : 'not served', `${host}: PRECONDITION — the film is served with a decision`).toBe('served');
      expect((await v.ack(page, film!)).status, `${host}: PRECONDITION — its render acknowledgement is admitted`).toBe(200);
      await m.drainLedger();
      // LOCKED (P03.E3, W26): one admitted render, one exposure.
      expect(rounded(await learned(m), 'n'), `${host}: P40.EV1 — the acknowledgement counts one exposure`).toEqual({ [VIDEO]: 1 });
      const before = await interest(v);
      const answer = await contentAction(v, 'content_viewable', film!, { pageInstance: page.pageInstance, contentType: 'film' });
      expect(answer.status, `${host}: P40.EV1 — the viewable impression is an event the host accepts: ${JSON.stringify(answer.body).slice(0, 200)}`).toBe(200);
      await m.drainLedger();
      expect.soft(await interest(v), `${host}: P40.EV1 — it weighs 0 and builds no interest`).toEqual(before);
      expect.soft(rounded(await learned(m), 'n'), `${host}: P40.EV1 — and changes no exposure count`).toEqual({ [VIDEO]: 1 });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P40.EV2 — video_view, a content action at the tenant's weight (default 1)
// ===========================================================================

describe('unit:P40.EV2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): video_view is a content action reading the piece's format from the catalogue as video_complete does, at the default weight 1, and at the tenant's own weight when the registry names one`, async () => {
      const measured: Array<[string, number | undefined]> = [];
      for (const [name, reflex, type] of [
        ['video_complete (the control, weight 2)', REGISTRY, 'video_complete'],
        ['video_view at the default weight', REGISTRY, 'video_view'],
        ['video_view at the tenant weight 3', { ...REGISTRY, weights: { ...REGISTRY.weights, video_view: 3 } }, 'video_view'],
      ] as const) {
        const m = await mount(host, docs({ measurementBasis: 'served-v1', reward: 'click' }, reflex));
        expect(m.refused, `PRECONDITION (${name}): the tenant documents publish`).toBeNull();
        const v = await visitorOn(m);
        const page = await v.snapshot(HOME);
        const film = page.decisions.find(d => d.contentId === VIDEO)!;
        const answer = await contentAction(v, type, film, { contentType: 'film' });
        expect.soft(answer.status, `${host}: ${name} — accepted (${JSON.stringify(answer.body).slice(0, 160)})`).toBe(200);
        // The format is the catalogue's (tags.contentType video), never the event's rendering type (film).
        measured.push([name, (await interest(v)).contentType?.video]);
      }
      const r = (x: number | undefined) => (x === undefined ? 'no interest' : Math.round(x * 1000) / 1000);
      // a = w / (w + K): weight 2 → 0.526; weight 1 → 0.357; weight 3 → 0.625.
      expect(measured.map(([name, a]) => [name, r(a)]), `${host}: P40.EV2 — the catalogue's format learned at the action's weight`).toEqual([
        ['video_complete (the control, weight 2)', r(2 / (2 + K))], ['video_view at the default weight', r(1 / (1 + K))], ['video_view at the tenant weight 3', r(3 / (3 + K))]]);
    }, 180_000);
  }

  it('sdk: the SDK offers videoView beside videoComplete, sending video_view for the painted piece with its slot and decision', async () => {
    const p = sdkPage();
    try {
      expect(await p.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
      p.listen.apply(p.set);
      p.emit.declarative();
      p.show('e0');
      for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
      expect(p.ofType('content_impression', EDITORIAL_PIECES[0]).length, 'PRECONDITION: the piece was acknowledged').toBe(1);
      const emit = p.emit as unknown as Record<string, unknown>;
      expect(typeof emit.videoView, 'P40.EV2 — emit.videoView exists beside emit.videoComplete').toBe('function');
      await (emit.videoView as (id: string, slot: string, attrs?: Record<string, unknown>) => Promise<unknown>)(EDITORIAL_PIECES[0]!, EDITORIAL);
      for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
      expect(p.ofType('video_view').map(e => e.data), 'P40.EV2 — one video_view for the painted piece, its slot and its decision')
        .toEqual([expect.objectContaining({ contentId: EDITORIAL_PIECES[0], slot: EDITORIAL, decisionId: receiptOf(EDITORIAL, LAYOUT_MODULES.length, EDITORIAL_PIECES[0]!) })]);
    } finally { p.close(); }
  });
});

// ===========================================================================
// unit:P40.EV3 — a dwell minimum per slot; product_dwell into the dwell counter
// ===========================================================================

describe('unit:P40.EV3', () => {
  it('sdk: a dwell minimum configured for a slot holds back a shorter dwell there, while a slot with none configured keeps the one-second default', async () => {
    const p = sdkPage();
    try {
      const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5)); };
      expect(await p.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
      p.listen.apply(p.set);
      (p.emit.declarative as (opts: Record<string, unknown>) => () => void)({ dwellMinMsBySlot: { [EDITORIAL]: 30_000 } });
      await settle();
      const dwell = async (id: string, ms: number) => { p.show(id); await settle(); p.f.tick(ms); p.show(id, false); await settle(); };
      await dwell('e0', 20_000);
      await dwell('e1', 31_000);
      await dwell('m0', 1_500);
      await dwell('m1', 500);
      const dwells = p.ofType('content_dwell').map(e => [e.data.contentId, e.data.ms]);
      expect(dwells, 'P40.EV3 — editorial (30 s minimum): the 31 s dwell only; the layout slot (default 1 s): the 1.5 s dwell only')
        .toEqual([[EDITORIAL_PIECES[1], 31_000], [M.grid, 1_500]]);
    } finally { p.close(); }
  });

  for (const host of HOSTS) {
    it(`host (${host}): product_dwell carrying dwellMs is accepted and feeds the visit's dwell counter`, async () => {
      const m = await mount(host, docs({ measurementBasis: 'served-v1', reward: 'click' }));
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const v = await visitorOn(m);
      expect((await v.hydrate()).body.journeyStage, `${host}: PRECONDITION — the shopper starts in the first stage`).toBe('exploring');
      // The event carries a value the published catalogue admits (line Harbor, a §3.3 value; W35 A1 drops an event
      // carrying none as unknown_product, src/services/RealtimeSegmentEngine.ts:513-524, before any counter).
      const answer = await v.action({ type: 'product_dwell', data: { productId: 'SKU-TOTE-1', line: 'Harbor', dwellMs: 21_000 } });
      expect(answer.status, `${host}: P40.EV3 — product_dwell is an event the host accepts: ${JSON.stringify(answer.body).slice(0, 200)}`).toBe(200);
      // The registry's published threshold reads the visit's dwell counter (category_dwell_ms ≥ 20 000).
      expect((await v.hydrate()).body.journeyStage, `${host}: P40.EV3 — its dwellMs fed the visit's dwell counter`).toBe('thinking');
    }, 120_000);
  }
});

// ===========================================================================
// unit:P40.EV4 — a purchase is unique per order id
// ===========================================================================

// R-P58, the buffered door. A buffered delivery is the SDK's own (`processing: 'buffered'`, the original event's
// `eventId` and time, the browsing session it belongs to: realtime.sdkContract.test.ts W22.07, :2629-2630), sent
// through the mounted app as the shopper. The buffered door never creates a profile, so the shopper's live product
// view comes first.

/** The kit's own purchase payload (docs/kit/03-payload-schemas.md:20): `orderId`, `value`, `currency`, `items[]`; no registry value. */
const kitPurchase = (orderId: string): Record<string, unknown> =>
  ({ orderId, value: 120, currency: 'USD', items: [{ productId: 'SKU-HARBOR-1', quantity: 1, price: 120 }] });

/** A buffered delivery of an original event through `POST /realtime/action`, as the shopper's SDK sends it. */
async function deliverBuffered(m: Mounted, v: Visitor, event: Record<string, unknown>): Promise<Answer> {
  const response = await m.fetch(new Request('https://shop.invalid/realtime/action', {
    method: 'POST',
    headers: { ...v.headers, 'X-Tenant': TENANT, [SHOPPER_HEADER]: v.grant.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'sdk', userId: v.grant.subject, sessionId: v.grant.sessionId, processing: 'buffered', ...event }),
  }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}

/**
 * The members of every reflex state the shopper holds, by where it is kept: the records of the shopper's own object
 * and of the session store (the session host keeps both). The key set, never the values.
 */
function reflexKeySets(m: Mounted, v: Visitor): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of m.shoppers.get(shopperObjectName(TENANT as TenantId, v.subject))?.data ?? []) {
    const reflex = (value as { reflex?: unknown } | null)?.reflex;
    if (reflex && typeof reflex === 'object') out[`object:${key}`] = Object.keys(reflex).sort();
  }
  for (const [key, raw] of (m.env.SESSIONS as unknown as { data: Map<string, string> }).data) {
    let reflex: unknown;
    try { reflex = (JSON.parse(raw) as { reflex?: unknown } | null)?.reflex; } catch { continue; }
    if (reflex && typeof reflex === 'object') out[`sessions:${key.split(v.grant.sessionId).join('<session>')}`] = Object.keys(reflex).sort();
  }
  return out;
}

/** Interest per dimension and value to three decimals: decay over the seconds of a test moves the fourth only. */
const roundedDims = (dims: Record<string, Record<string, number>>) => Object.fromEntries(Object.entries(dims)
  .map(([dim, values]) => [dim, Object.fromEntries(Object.entries(values).map(([value, a]) => [value, Math.round(a * 1000) / 1000]))]));

/** One shopper on one host: a live product view, then the purchase delivered buffered, then the same order arriving live as another event. */
async function bufferedThenLive(host: Host, purchase: Record<string, unknown>) {
  const m = await mount(host, docs({ measurementBasis: 'served-v1', reward: 'purchase' }));
  expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
  const v = await visitorOn(m);
  const view = await v.action({ type: 'product_view', data: { productId: 'SKU-HARBOR-1', line: 'Harbor' } });
  expect(view.status, `${host}: PRECONDITION — the shopper's live product view is accepted (the profile exists)`).toBe(200);
  await m.drainLedger();
  const held = async () => ({ keys: reflexKeySets(m, v), interest: roundedDims(await interest(v)) });
  const before = await held();
  expect(Object.keys(before.keys).length > 0 && Object.values(before.keys).every(keys => !keys.includes('orders')),
    `${host}: PRECONDITION — the shopper holds reflex state that remembers no order yet (${JSON.stringify(before.keys)})`).toBe(true);
  const eventId = crypto.randomUUID();
  const buffered = await deliverBuffered(m, v, { type: 'purchase', eventId, timestamp: Date.now() - 60_000, browsingSessionId: 'p40-earlier-tab', data: purchase });
  await m.drainLedger();
  const afterBuffered = await held();
  const live = await v.action({ type: 'purchase', data: purchase });
  await m.drainLedger();
  const afterLive = await held();
  const outcomes = storedOutcomes(m, v.subject).filter(o => o.event === 'purchase').map(o => o.event_id);
  return { host, before, eventId, buffered, afterBuffered, live, afterLive, outcomes };
}

/** EV4 under R-P58, one representation for the leg and its control. */
function expectOneOrder(r: Awaited<ReturnType<typeof bufferedThenLive>>, label: string) {
  expect.soft([r.live.status, r.live.body.dropped], `${r.host}: ${label} — the same order arriving live afterwards is reported as a duplicate (${JSON.stringify(r.live.body).slice(0, 160)})`)
    .toEqual([200, 'duplicate_order']);
  expect.soft(r.outcomes, `${r.host}: ${label} — exactly one purchase outcome is recorded for the shopper, the buffered delivery's`).toEqual([r.eventId]);
  expect.soft(r.afterLive.interest, `${r.host}: ${label} — interest is built once at most: the duplicate builds none`).toEqual(r.afterBuffered.interest);
  const gained = Object.fromEntries(Object.entries(r.before.keys).map(([where, keys]) => [where, [...keys, 'orders'].sort()]));
  expect.soft(r.afterBuffered.keys, `${r.host}: ${label} — the buffered purchase remembers its order inside the shopper's existing reflex state: the key set gains orders and nothing else`)
    .toEqual(gained);
}

describe('unit:P40.EV4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a second purchase naming the same order id is recorded once, crediting once and building interest once, and the duplicate is reported`, async () => {
      const m = await mount(host, docs({ measurementBasis: 'served-v1', reward: 'purchase' }));
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const v = await visitorOn(m);
      const page = await v.snapshot(HOME);
      const story = page.decisions.find(d => d.contentId === STORY)!;
      expect(story?.decisionId ? 'served' : 'not served', `${host}: PRECONDITION — the story is served with a decision`).toBe('served');
      const purchase = () => v.action({ type: 'purchase', data: { orderId: 'ORD-2026-0001', value: 120, currency: 'USD', line: 'Harbor',
        contentId: STORY, slot: HERO, decisionId: story.decisionId, items: [{ productId: 'SKU-HARBOR-1', quantity: 1, price: 120 }] } });
      const first = await purchase();
      expect(first.status, `${host}: PRECONDITION — the purchase is accepted`).toBe(200);
      await m.drainLedger();
      const once = { outcomes: storedOutcomes(m, v.subject).filter(o => o.event === 'purchase').length, credit: rounded(await learned(m), 's'), line: (await interest(v)).line?.Harbor };
      expect(once, `${host}: CONTROL — one purchase: one outcome, one credit, interest at the purchase weight (5 / (5 + K))`)
        .toEqual({ outcomes: 1, credit: { [STORY]: 1 }, line: expect.closeTo(5 / (5 + K), 2) });
      const second = await purchase();
      expect([second.status, second.body.dropped], `${host}: P40.EV4 — the same order again is reported as a duplicate`).toEqual([200, 'duplicate_order']);
      await m.drainLedger();
      expect.soft({ outcomes: storedOutcomes(m, v.subject).filter(o => o.event === 'purchase').length, credit: rounded(await learned(m), 's'), line: (await interest(v)).line?.Harbor },
        `${host}: P40.EV4 — and recorded once, credited once, building interest once`).toEqual(once);
    }, 120_000);
  }

  // R-P58: the buffered door. The leg (RED at c1481f0a) and its control (green before and after).
  for (const host of HOSTS) {
    it(`host (${host}): R-P58 — a buffered purchase in the kit's own payload (orderId, value, currency, items; no registry value) applies no interest yet remembers its order in the shopper's reflex state, so the same order arriving live as another event is reported as a duplicate, with one purchase outcome and interest built once at most`, async () => {
      const r = await bufferedThenLive(host, kitPurchase('ORD-2026-0002'));
      expect([r.buffered.status, r.buffered.body.dropped ?? 'not dropped', r.buffered.body.interestApplied],
        `${host}: PRECONDITION — the buffered purchase is accepted, is no duplicate, and applies no interest (its payload places no registry value): ${JSON.stringify(r.buffered.body).slice(0, 200)}`)
        .toEqual([200, 'not dropped', false]);
      expectOneOrder(r, 'P40.EV4 (R-P58)');
    }, 120_000);

    it(`host (${host}): CONTROL (R-P58) — the same sequence with a buffered purchase that applies interest (the same payload with a placed value, line Harbor) is deduplicated, with one purchase outcome, interest built once and the order in the shopper's reflex state`, async () => {
      const r = await bufferedThenLive(host, { ...kitPurchase('ORD-2026-0003'), line: 'Harbor' });
      expect([r.buffered.status, r.buffered.body.dropped ?? 'not dropped', r.buffered.body.interestApplied],
        `${host}: PRECONDITION — the buffered purchase is accepted, is no duplicate, and applies interest (line Harbor is placed): ${JSON.stringify(r.buffered.body).slice(0, 200)}`)
        .toEqual([200, 'not dropped', true]);
      expectOneOrder(r, 'P40.EV4 CONTROL');
    }, 120_000);
  }
});

// ===========================================================================
// unit:P40.EV5 — the kit documents the events and the conventions
// ===========================================================================

describe('unit:P40.EV5', () => {
  it('logic: the integration guide, the API reference and the payload schemas document the viewable impression, video_view, the dwell minimum, product_dwell, purchase uniqueness, the search, filter_applied and remove_from_cart conventions and the declared interactions sizeguide:open and reviews:open', () => {
    const missing: string[] = [];
    for (const file of ['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']) {
      const lines = readTree(file).split('\n');
      const has = (...words: string[]) => lines.some(line => words.every(w => line.includes(w)));
      if (!has('content_viewable')) missing.push(`${file}: the viewable impression (content_viewable)`);
      if (!has('video_view')) missing.push(`${file}: video_view`);
      if (!has('dwellMinMsBySlot')) missing.push(`${file}: the dwell minimum per slot (dwellMinMsBySlot)`);
      if (!has('product_dwell', 'dwellMs')) missing.push(`${file}: product_dwell with dwellMs`);
      if (!has('orderId', 'duplicate_order')) missing.push(`${file}: purchase uniqueness per orderId (duplicate_order)`);
      if (!has('search', 'query text')) missing.push(`${file}: the search convention (resolved values only, never the query text)`);
      if (!has('filter_applied', 'priceStatus')) missing.push(`${file}: the filter_applied convention (the sale filter raising priceStatus sale)`);
      if (!has('remove_from_cart')) missing.push(`${file}: the remove_from_cart convention (weight 0 until P39)`);
      if (!has('sizeguide:open') || !has('reviews:open')) missing.push(`${file}: the declared interactions sizeguide:open and reviews:open`);
    }
    expect(missing, 'P40.EV5 — the kit documents the events and their conventions').toEqual([]);
  });
});

