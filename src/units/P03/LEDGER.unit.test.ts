// src/units/P03/LEDGER.unit.test.ts
// P03 under the Closure Ledger: the tests for the LOCAL criteria of the frozen
// P03 work order (`tapestry-parity-build`, ticket P03 "Module-level impression
// and engagement events"). DC1-DC3 (decisions D1-D3) are ruled and exercised
// inside E1-E4; LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P03.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P03 in section A): "a
//     module container marked with its ID records an impression when on screen,
//     and an engagement when used as Tapestry defines it (Phase 1 ask T8). Both
//     carry the module ID, its position and the decision receipt, and both reach
//     learning";
//   · freeze sheet item 18: D1 "The impression is the existing render
//     acknowledgement" (sent once per module per page instance; no second
//     impression event); D2 "engagement is a click inside the container plus
//     declared interactions, credited as the slot's click reward"; D3 "events
//     carry the per-slot position" (the decision record's, added to the payload
//     beside the page-wide order);
//   · the investigation, sections G-A ("What counts as using it: a tile click,
//     a swipe, opening the reviews"; "Module impression and engagement, 'as they
//     define it': P03") and G-C (C6: "containers marked per module");
//   · the parity document, sections 3.3 and 3.10 (cited by number only);
//   · the existing contract the work order cites: `src/sdk/emit.ts:197-234`,
//     `src/sdk/listen.ts:241-307`, `src/content/service.ts:652-653`,
//     `src/ledger/records.ts:230-234`, `src/reflex/contentTelemetry.ts:62-67`.
//
// THE READINGS THIS FILE RULES, ONE PER CRITERION (one representation for all):
//   The module container is marked as the kit's declarative capture marks a
//   piece today: `data-op-content="<module id>"` and `data-op-slot="<layout
//   slot>"`. The page declares its interactions on the container as
//   `data-op-engage="<DOM event types, space separated>"`. The decision payload,
//   the impression and the engagement carry `slotPosition` (the record's
//   per-slot `position`) beside `position` (the page-wide `order`, unchanged).
//   An engagement is an event the learning loop counts as the click reward
//   (`learningInputOf` answers `{ counted: true, reward: 'click' }`).
//   E1  One `content_impression` per module per page instance, on first
//       visibility, carrying the module id, the slot, `slotPosition` and its
//       decision id; none again on re-subscribe, on a repeated visibility, on a
//       redelivered set, or when the page's own `rendered()` call and the
//       declarative scan both watch the container.
//   E2  A click on any element inside the container, and each declared
//       interaction dispatched inside it, send one engagement carrying the module
//       id, the slot, `slotPosition` and the decision id of its render
//       acknowledgement; an undeclared interaction, a shopper without tracking
//       consent and listen-only mode send nothing.
//   E3  On a page whose gallery slot precedes the layout slot (so a module's
//       page-wide order differs from its position in the slot), the decision
//       payload carries `slotPosition`; the impression in the payload above is
//       admitted; it adds one exposure and the engagement one click credit to
//       that module's decision; an engagement on a module returned but never
//       acknowledged credits nothing.
//   E4  The engagement's outcome record carries `item_id` (the module id),
//       `slot`, `position` (within the slot) and `decision_id`.
//   E5  docs/kit/01, 02 and 03 each name `data-op-engage` and `slotPosition`
//       and the module container marking; 03 documents `content_impression`
//       and `content_click` with `slotPosition`.
//
// THE SERVER-SIDE BOUNDARY THIS FILE MEETS: the render admission compares the
// acknowledgement's `position` with the record's per-slot position
// (`src/content/renderOffer.ts:90`), while the SDK sends the page-wide order
// there (`src/sdk/listen.ts:251`). `src/content/renderOffer.ts` is not in P03's
// allowed paths; `src/routes/realtime.ts` (which calls it) is.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `slotPosition` on the decision payload and the event payloads,
// `data-op-engage`, `position` on the outcome record. No new export is imported.
//
// HARNESS: src/units/_parity.ts for the host legs; the sdk legs drive the real
// SDK entry composition (`createCore` + `createListen` + `createEmit`, as
// `src/sdk/index.ts` composes them and src/units/W17/L1.unit.test.ts drives them)
// over the repository's test host, on a real jsdom page whose visibility port
// is the `DomLike` contract (`src/sdk/types.ts:81-85`).

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { learningInputOf } from '@/ledger/records';
import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createListen } from '@/sdk/listen';
import { offeredSet, testHost } from '@/sdk/testHost';
import type { DomLike, ElementLike, RequestInitLike, ResponseLike } from '@/sdk/types';

import {
  declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, readTree, rounded, shopperOn, storedOutcomes, type Decision,
} from '../_parity';

const GALLERY = 'pdp-gallery';
const GALLERY_PIECE = { id: 'gallery.tabby.onmodel', customerContentId: 'TAP-GALLERY-TABBY-ONMODEL', type: 'on-model', title: 'The Tabby, worn',
  tags: { line: ['Tabby'] }, slotTypes: [GALLERY], lifecycle: { status: 'live' } };
/** The product page as it is built: the gallery first, the modules below it (parity §3.3). */
const P03_DOCUMENTS = {
  pieces: [GALLERY_PIECE, ...MODULES],
  slots: declaredSlots([{ slot: GALLERY, take: 1, weights: { line: 1 } }, layoutSlot({ take: 3 })]),
  learn: learnDocument({ [GALLERY]: { measurementBasis: 'rendered-v1', reward: 'click' } }),
};
/**
 * The layout's three modules for a shopper with no signal (P02.A2: the first K
 * eligible in catalogue order — reviews excluded, lookbook expired; this page
 * has no recently-viewed slot to reserve module.PDP.recent.1).
 */
const COLD_LAYOUT = [M.grid, M.reco1, M.recent];

// ===========================================================================
// The SDK page.
// ===========================================================================

interface PageEl extends ElementLike { click(): void; dispatchEvent(event: unknown): boolean }
interface Posted { type: string; data: Record<string, unknown> }

/** The decisions the engine served for the page: the gallery at order 0, the modules at orders 1-3, each with its receipt. */
const pageSet = () => offeredSet({ page: 'pdp', decisions: [
  { contentId: GALLERY_PIECE.id, customerContentId: GALLERY_PIECE.customerContentId, slot: GALLERY, order: 0, slotPosition: 0, type: 'on-model', strategy: 'default' as const, score: 0, explain: { drivers: [] } },
  ...[M.grid, M.reco2, M.reviews].map((id, i) => ({ contentId: id, customerContentId: `TAP-${id}`, slot: LAYOUT, order: i + 1, slotPosition: i,
    type: 'module', strategy: 'default' as const, score: 0, explain: { drivers: [] } })),
] }, 'p03-page');
/** `offeredSet` mints `${revision}-${slot}-${order}-${contentId}` (src/sdk/testHost.ts:22-25). */
const receiptOf = (slot: string, order: number, id: string) => `original-${slot}-${order}-${id}`;

function sdkPage(opts: { tracking?: boolean; listenOnly?: boolean } = {}) {
  const dom = new JSDOM(`<main>
    <section id="gallery" data-op-slot="${GALLERY}" data-op-content="${GALLERY_PIECE.id}"><img alt="The Tabby, worn"></section>
    <section id="m0" data-op-slot="${LAYOUT}" data-op-content="${M.grid}"><a id="m0-tile" href="#handbags">Handbags</a></section>
    <section id="m1" data-op-slot="${LAYOUT}" data-op-content="${M.reco2}"><button id="m1-tile">Shop the look</button></section>
    <section id="m2" data-op-slot="${LAYOUT}" data-op-content="${M.reviews}" data-op-engage="swipe reviews-open"><div id="m2-carousel">Reviews and fit</div></section>
  </main>`, { url: 'https://www.coach.com/products/tabby-shoulder-bag-26' });
  // The app tsconfig's lib has no DOM (src/units/W17/L1.unit.test.ts declares its typings locally for the same reason).
  const win = dom.window as unknown as {
    document: { getElementById(id: string): unknown; querySelectorAll(sel: string): ArrayLike<unknown> };
    CustomEvent: new (type: string, init: { bubbles: boolean }) => unknown;
    close(): void;
  };
  const doc = win.document;
  const watchers = new Map<unknown, Set<(visible: boolean) => void>>();
  /** The DomLike port (src/sdk/types.ts:81-85): the page's own elements, and visibility the test delivers. */
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
  if (opts.tracking === false) {
    // The shopper's own refusal, as the platform answers it on her session.
    const base = f.host.fetch;
    f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
      const answer = await base(url, init);
      if (!url.endsWith('/identity/session')) return answer;
      const body = await answer.json() as { session: { consent: { tracking: boolean; personalization: boolean; instruction: Record<string, unknown> } } };
      const refused = { value: false, chosenAt: f.host.now(), expiresAt: f.host.now() + 30 * 86_400_000 };
      body.session.consent = { ...body.session.consent, tracking: false, personalization: false,
        instruction: { ...body.session.consent.instruction, tracking: refused, personalization: refused } };
      return { ok: true, status: 200, json: async () => body };
    };
  }
  const core = createCore({ tenant: 'coach', source: 'coach-pdp', ...(opts.listenOnly ? { listenOnly: true } : {}) }, f.host);
  const listen = createListen(core);
  const emit = createEmit(core, listen);
  const sent = (): Posted[] => f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!) as Posted);
  const impressions = (id: string) => sent().filter(e => e.type === 'content_impression' && e.data.contentId === id);
  const engagements = () => sent().filter(e => { const input = learningInputOf({ type: e.type, data: e.data }); return input.counted && input.reward === 'click'; });
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5)); };
  const event = (type: string) => new win.CustomEvent(type, { bubbles: true });
  return { doc, el, show, core, listen, emit, sent, impressions, engagements, settle, event, close: () => win.close() };
}

// ===========================================================================
// unit:P03.E1 — one impression per marked module container
// ===========================================================================

describe('unit:P03.E1', () => {
  it('sdk: a marked module container sends one impression on its first visibility, carrying the module, its slot, its position within the slot and its receipt, and none again on re-subscribe, a repeated visibility, a redelivered set, or the page’s own rendered() call over the same container', async () => {
    const p = sdkPage();
    try {
      expect(await p.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
      const set = pageSet();
      p.listen.apply(set);
      p.emit.declarative();
      p.listen.subscribe(LAYOUT, () => undefined);
      p.show('m0');
      await p.settle();
      // The page's own acknowledgement over the same container, a re-subscribe, a repeated visibility and a redelivered set.
      await p.emit.rendered(LAYOUT, M.grid, p.el('m0'));
      p.listen.subscribe(LAYOUT, () => undefined);
      p.show('m0', false); p.show('m0');
      p.listen.apply(set);
      p.show('m0');
      await p.settle();
      // LOCKED (src/sdk/emit.ts:219-220, src/sdk/listen.ts:248-266): one acknowledgement per placement.
      expect(p.impressions(M.grid).length, 'P03.E1 — exactly one impression for the module container').toBe(1);
      expect(p.impressions(M.grid)[0]!.data, 'P03.E1 — carrying the module, its slot, its page-wide order, its position within the slot (D3) and its receipt')
        .toMatchObject({ contentId: M.grid, slot: LAYOUT, position: 1, slotPosition: 0, decisionId: receiptOf(LAYOUT, 1, M.grid) });
      expect(p.impressions(M.reco2), 'a module that was never visible sent no impression').toEqual([]);
    } finally { p.close(); }
  });
});

// ===========================================================================
// unit:P03.E2 — one engagement per click or declared interaction
// ===========================================================================

describe('unit:P03.E2', () => {
  it('sdk: a click inside the container and each interaction the page declares send one engagement carrying the module, its slot, its position within the slot and the decision of its render acknowledgement; an undeclared interaction sends nothing', async () => {
    const p = sdkPage();
    try {
      expect(await p.core.ready()).toBe(true);
      p.listen.apply(pageSet());
      p.emit.declarative();
      p.show('m1'); p.show('m2');
      await p.settle();
      expect(p.impressions(M.reco2).length + p.impressions(M.reviews).length, 'PRECONDITION: both containers were acknowledged').toBe(2);

      p.el('m1-tile').click();
      await p.settle();
      const clicked = p.engagements();
      expect(clicked.length, 'P03.E2 — a click on the tile inside the container is one engagement').toBe(1);
      expect.soft(clicked[0]?.data, 'P03.E2 — carrying the module, its slot, its position within the slot (D3) and the receipt of its render acknowledgement')
        .toMatchObject({ contentId: M.reco2, slot: LAYOUT, slotPosition: 1, decisionId: receiptOf(LAYOUT, 2, M.reco2) });

      p.el('m2-carousel').dispatchEvent(p.event('swipe'));
      p.el('m2-carousel').dispatchEvent(p.event('reviews-open'));
      await p.settle();
      const declared = p.engagements().slice(1);
      expect.soft(declared.map(e => [e.data.contentId, e.data.slot, e.data.slotPosition, e.data.decisionId]),
        'P03.E2 — each interaction the page declares on the container (`data-op-engage`) is one engagement of that module')
        .toEqual([[M.reviews, LAYOUT, 2, receiptOf(LAYOUT, 3, M.reviews)], [M.reviews, LAYOUT, 2, receiptOf(LAYOUT, 3, M.reviews)]]);

      const before = p.sent().length;
      p.el('m2-carousel').dispatchEvent(p.event('mouseover'));
      p.el('m1-tile').dispatchEvent(p.event('swipe'));
      await p.settle();
      expect(p.sent().slice(before), 'P03.E2 — an interaction the page did not declare on that container sends nothing').toEqual([]);
    } finally { p.close(); }
  });

  it('sdk: a shopper without tracking consent and a client in listen-only mode send no impression and no engagement', async () => {
    for (const opts of [{ tracking: false }, { listenOnly: true }]) {
      const p = sdkPage(opts);
      try {
        await p.core.ready();
        p.listen.apply(pageSet());
        p.emit.declarative();
        p.show('m1'); p.show('m2');
        await p.settle();
        p.el('m1-tile').click();
        p.el('m2-carousel').dispatchEvent(p.event('swipe'));
        await p.settle();
        // LOCKED (src/sdk/listen.ts:242, src/sdk/emit.ts:162, :260): nothing is captured.
        expect(p.sent().map(e => e.type), `P03.E2 — ${JSON.stringify(opts)}: nothing is sent`).toEqual([]);
      } finally { p.close(); }
    }
  });
});

// ===========================================================================
// unit:P03.E3 — both events reach the layout slot's learning
// ===========================================================================

describe('unit:P03.E3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on a rendered-v1 layout slot below a gallery, the decision payload carries each module's position within the slot, the impression adds one exposure and the engagement one click credit to that module's decision, and an engagement without an admitted render is not credited`, async () => {
      const m = await mount(host, P03_DOCUMENTS);
      expectPublished(m, 'P03.E3 — the page with its declared layout slot (P02) publishes');
      const s = await shopperOn(m);
      await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p03-e3') });
      const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
      expect(layout.map(d => [d.contentId, d.order]), `${host}: PRECONDITION — the gallery takes order 0 and the modules orders 1 to 3`)
        .toEqual(COLD_LAYOUT.map((id, i) => [id, i + 1]));
      expect.soft(layout.map(d => d.slotPosition), `${host}: P03.E3 (D3) — the decision payload carries each module's position within the layout slot`).toEqual([0, 1, 2]);

      const gallery = page.decisions.find(d => d.slot === 'pdp-gallery') as Decision;
      expect((await s.ack(page, gallery)).status, `${host}: the gallery is acknowledged`).toBe(200);
      const admitted: string[] = [];
      for (const d of layout.slice(0, 2)) {
        const ack = await s.ack(page, d);
        expect.soft(ack.status, `${host}: P03.E3 — the impression of ${d.contentId} (page-wide order ${d.order}, position ${layout.indexOf(d)} within the slot) is admitted: ${JSON.stringify(ack.body).slice(0, 160)}`).toBe(200);
        if (ack.status === 200) admitted.push(d.contentId);
      }
      // The engagement on the first module, and one on the third, which was returned but never drawn.
      expect((await s.click(page, layout[0]!)).status, `${host}: the engagement is accepted`).toBe(200);
      expect((await s.click(page, layout[2]!)).status, `${host}: the engagement on the undrawn module is accepted`).toBe(200);
      await m.drainLedger();
      const state = await learned(m);
      expect.soft(rounded(state, 'n'), `${host}: P03.E3 — one exposure per admitted impression: the gallery and the two drawn modules`)
        .toEqual({ [GALLERY_PIECE.id]: 1, [layout[0]!.contentId]: 1, [layout[1]!.contentId]: 1 });
      expect.soft(rounded(state, 's'), `${host}: P03.E3 — one click credit, to the engaged module's decision, and none to the module returned but never acknowledged`)
        .toEqual({ [layout[0]!.contentId]: 1 });
    });
  }
});

// ===========================================================================
// unit:P03.E4 — the engagement's outcome record names the module and its position
// ===========================================================================

describe('unit:P03.E4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the outcome record of an engagement carries the module identifier, the slot, the position within the slot and the decision identifier`, async () => {
      const m = await mount(host, P03_DOCUMENTS, { recovery: false });
      expectPublished(m, 'P03.E4 — the page with its declared layout slot (P02) publishes');
      const s = await shopperOn(m);
      await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p03-e4') });
      const second = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order)[1]!;
      expect(second.contentId, `${host}: PRECONDITION — the second module of the layout`).toBe(COLD_LAYOUT[1]);
      await s.ack(page, second);
      expect((await s.click(page, second)).status, `${host}: the engagement is accepted`).toBe(200);
      await m.drainLedger();
      const outcome = storedOutcomes(m, s.subject).find(o => o.item_id === second.contentId);
      expect(outcome ?? `no outcome record was stored for ${second.contentId}`, `${host}: P03.E4 — the outcome record carries the module, the slot, the position within the slot and the decision`)
        .toMatchObject({ item_id: second.contentId, slot: LAYOUT, position: 1, decision_id: second.decisionId });
    });
  }
});

// ===========================================================================
// unit:P03.E5 — the kit documents the marking, the declaration and both events
// ===========================================================================

describe('unit:P03.E5', () => {
  it('logic: the integration guide, the API reference and the payload schemas document the module container marking, the interaction declaration and both events with their fields', () => {
    const missing: string[] = [];
    for (const file of ['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']) {
      const text = readTree(file);
      const lines = text.split('\n');
      if (!text.includes('data-op-engage')) missing.push(`${file}: the interaction declaration (data-op-engage)`);
      if (!text.includes('slotPosition')) missing.push(`${file}: the position within the slot (slotPosition)`);
      if (!lines.some(line => /module/i.test(line) && line.includes('data-op-content'))) missing.push(`${file}: the module container marking (data-op-content on a module container)`);
    }
    const schemas = readTree('docs/kit/03-payload-schemas.md').split('\n');
    for (const event of ['content_impression', 'content_click']) {
      if (!schemas.some(line => line.includes(event) && line.includes('slotPosition'))) missing.push(`docs/kit/03-payload-schemas.md: ${event} with slotPosition`);
    }
    expect(missing, 'P03.E5 — the kit documents the marking, the declaration and both events with their fields').toEqual([]);
  });
});
