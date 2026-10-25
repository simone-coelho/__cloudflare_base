// src/units/P85/LEDGER.unit.test.ts
// P85 under the Closure Ledger: the tests for the LOCAL criteria CX1-CX3 of the P85 work order (the activation programme
// of amendment 11, group B, ticket P85 "An exposure record for a carousel drawn before paint", E9; batch S31). LV1 is a
// deferred live row and gets no test. PROVISIONAL: the shapes marked PROPOSED and the readings marked RULING are for the
// lead before the legs are measured (HOLD VITEST at writing: nothing here has been run).
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md, section 2,
// E9):
//   "**Authority:** the carousel design note (credit and the holdout comparison)."
//   "**Done when:** a carousel order applied by the head script before paint is recorded as an exposure of that page view
//   with its context and arm, as the layout exposure is for modules, and credited the same way."
//   "**Starts from:** the layout exposure beacon (P30)." "**Relates to:** P30, P33."
// The carousel design note §9 (docs/tapestry-packs/1-front-end/10-carousel-design-note.md, the Windows checkout; a document
//   only): "Impression | An image is first on screen ... | Exposure: which image was seen, in which position and context";
//   "Click | A tap on an image | Engagement: credits that image and its shot type ..."; "The SDK captures both ... under the
//   shopper's tracking consent only; add to bag and purchase are credited to the carousel the shopper saw." (Its §11 is
//   "The honest trade-off" and names no holdout comparison; the brief's "§11 the holdout comparison" reads E9's authority.)
// The work order (docs/parity/activation/program.json, P85): CX1 the beacon (the context key or table row, the page, the
// carousel slot, the image ids in drawn order, the pageInstance) adds one exposure per drawn image to its context's
// learning, once per page view, under tracking consent, for a key or row the engine issued; CX2 an engagement or outcome
// of a beacon-drawn image credited to that exposure as a layout module's is (P30, P33), the holdout's arms never counted,
// P30's layout beacon unchanged; CX3 the kit (kit 01 :582-587; kit 02 :209-216 and :639; kit 03 :26 and :1095).
//
// P84'S SHAPES THIS FILE RELIES ON (P84 final at 72aa84ed, joined at 6af00c40): GET /v1/<tenant>/context-table/<page>
// (`version` the SHA-256 of the document's canonical bytes; `rows` [{ channel, visitBucket, layout, shotOrder: { mobile,
// desktop } }]; `default`; `carouselSlot`; `holdout`), src/content/decide.ts contextTableOf; the head script's outputs
// `data-op-context` (`<channel>|<visitBucket>|<device>` or `default`), `data-op-arm` (`default` | `personalized`),
// `data-op-table` (the version), the painted order in `--op-<carouselSlot>-<n>`.
//
// PROPOSED SHAPES (each asserted below):
//   S1 The beacon: `client.listen.carouselExposure({ tableVersion, context, page, slot, images, arm })` once per page view
//      and carousel slot, the SDK adding the page view's `pageInstance` as `layoutExposure` does (src/sdk/listen.ts
//      layoutExposure); sent as the action `carousel_exposure` with data `{ tableVersion, context, page, slot, images,
//      pageInstance, arm }` (images in painted order, 1..50 distinct ids), only under tracking consent; it asks for no
//      decisions. The route answers it itself before any host, as `layout_exposure` (src/routes/realtime.ts): `{ success:
//      true, exposure: 'admitted', images: n }` or `{ success: true, exposure: 'ignored', reason }`; malformed data 400
//      'Invalid carousel exposure'.
//   S2 Ignored reasons (P30's words where P30 has one): `tracking_refused` (no tracking consent); `stale_table` (a version
//      that is neither the one in force nor, within the stable address's max-age, the one it replaced); `unknown_context`
//      (a context that version has no row for: channel × bucket of its rows and a device mobile|desktop, or `default`);
//      `not_carousel` (a slot that is not that version's `carouselSlot` for the page); `unknown_image` (an image that is
//      not a catalogue piece naming the slot, or more images than the slot's take); `not_learning` (an arm `default` or
//      `no_learning`, P30's word for the holdout's key); `not_measured` (the carousel not on `rendered-v1`, P30's rule);
//      `unavailable`.
//   S3 The stale-version rule (RULING): a beacon's `tableVersion` is admitted when it is the version of the table in force
//      for the page, or the version the in-force set replaced when that publication is younger than the stable address's
//      `max-age` (60 seconds, P84); else `stale_table`. The engine keeps no issued-version list (P84 computes the table on
//      read): the previous version is the table of the previous pinned set, computed the same way.
//   S4 The learning: one exposure per drawn image in the carousel slot's statistics object, in the cell of the context's
//      channel and visit bucket (P30's form: stage unknown, no region, no interest; the device no learning level), each
//      row's identity the page view's own (the shopper, the page, the slot, the painted position, the pageInstance), so a
//      repeat for the same page view is counted once (P30's journal; the answer stays `admitted`, P30's form). A
//      `default` context counts in the cell of no context (channel and visit bucket unknown: the root only).
//   S5 The credit (CX2): a `content_click` naming a beacon-drawn image of that page view (data `{ contentId, slot, page,
//      pageInstance, position }`, position the painted one from 1) credits that image's exposure in the context's cell
//      under the slot's reward; an `add_to_cart` naming the image and the page view (`contentId`, `pageInstance`: P33's
//      module-tied origination) likewise; nothing for the holdout's arms (no exposure was counted); a page view whose
//      image also has a rendered decision (the engine's own, acknowledged) is credited once.
//
// READINGS THE CODE CONTRADICTS (for ruling):
//   R1 "credited the same way" as the layout exposure: P30's beacon only counts exposures; nothing of a cached paint
//      reaches the shopper's ring (src/learn/fan.ts fanLayoutExposure, :1262-1276: "nothing reaches the shopper's ring: no
//      decision of the shopper's stands behind a cached layout"), so no click or outcome is credited to a cached layout's
//      module today, and the ring credits only decisions it holds (P33's module-tied credit needs the decision). S5 needs
//      the beacon to leave a creditable record of the page view where the ring credits from: src/durable-objects/
//      DecisionRing.ts is not in P85's allowedPaths (fan.ts posts to the ring through its existing routes). RULING: the
//      grant, or credit through fan.ts's existing ring post only.
//   R2 "a repeated beacon ... answers ignored": P30 counts a repeat once in the statistics object's journal and still
//      answers `admitted` (the admission cannot see the journal); these tests keep P30's form (S4). RULING.
//   R3 "a beacon with arm default or no_learning is accepted ... while still recording the exposure for the holdout
//      comparison, as the layout beacon does": the layout beacon answers `ignored 'not_learning'` for the holdout's keys
//      and records nothing (src/content/service.ts admitLayoutExposure :1338); no store holds a cached paint's exposure for
//      the holdout comparison. These tests keep P30's form (S2). RULING: or a holdout exposure count (a new store).
//   R4 "learning for the image's shot type": the statistics object counts per item (the piece id) per cell; a shot-type
//      view is a roll-up over the catalogue's `tags.contentType` (no such key today). These tests count per image (S4); the
//      shot-type roll-up is named a residual.
//   R5 The previous version (S3) needs the previous pinned set: P84 keeps no issued versions.
//
// R10 SWEEP (none needed on these shapes): P30's layout beacon locks (src/units/P30/LEDGER.unit.test.ts :431-462, the
// host legs; :464-494, the SDK leg) hold: `layout_exposure` and its `not_context_only` are unchanged (asserted here as a
// lock); src/events/actionTypes.test.ts reads the list generically (:40-44); P79's beacon reads (src/units/P79/
// LEDGER.unit.test.ts :462, :471, :600) filter `layout_exposure` by type. To measure under the sketch: the realtime action
// tests, the fan tests, the SDK tests, P79, P81, P84.
//
// NO NEW EXPORT IS IMPORTED. Read loosely: `listen.carouselExposure`, the action `carousel_exposure`, the answer members.
// DEFERRED / RESIDUAL: LV1; the shot-type roll-up (R4); the day report's carousel rows.
//
// HARNESS: src/units/_parity.ts (the mounted app, real DO classes, both hosts; `learned`), src/sdk/testHost.ts (the SDK
// leg). Imports from src/units/: ../_parity.

import { describe, expect, it } from 'vitest';

import { createCore } from '@/sdk/core';
import { createListen } from '@/sdk/listen';
import { testHost } from '@/sdk/testHost';
import type { RequestInitLike, ResponseLike } from '@/sdk/types';

import {
  declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learnDocument, learned, MODULES, mount, pageInstanceOf, putDocument, readTree, shopperOn, TENANT,
  type Answer, type Decision, type Mounted, type Shopper,
} from '../_parity';

// ---------------------------------------------------------------------------
// The fixture: P84's product page — the declared layout slot and its carousel with per-context shot orders, the images of
// one product with their shot tags (an untagged one, an unnamed shot), the wallet's image (another product's, a cross
// input); the carousel measured on rendered-v1, learning against the click; no holdout.
// ---------------------------------------------------------------------------

const CAROUSEL = 'pdp-carousel';
const A = 'COA-CH857', B = 'COA-CB925';
const image = (n: number, contentType: string[] | null, product = A) => ({ id: `img-${product.slice(4).toLowerCase()}-${n}`, customerContentId: `TAP-IMG-${product}-${n}`,
  type: 'image', title: `${product} image ${n}`, tags: { category: [product === A ? 'Handbags' : 'Small Leather Goods'], ...(contentType ? { contentType } : {}) },
  slotTypes: product === A ? [CAROUSEL] : ['pdp-wallets'], lifecycle: { status: 'live' }, featuredProductIds: [product] });
const IMAGES = [image(1, ['studio']), image(2, ['flat_lay']), image(3, ['on_model']), image(4, ['detail']), image(5, ['on_model']), image(6, ['studio']),
  image(7, null), image(8, ['video'])];
const WALLET = image(1, ['on_model'], B);
const id = (n: number) => `img-ch857-${n}`;
const SHOT_ORDERS = [
  { context: { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' }, order: ['on_model', 'detail', 'studio', 'flat_lay'] },
  { context: { channel: 'email', visitBuckets: 'any' }, order: ['flat_lay', 'detail', 'studio', 'on_model'] },
];
const carousel = (over: Record<string, unknown> = {}) => ({ slot: CAROUSEL, take: 8, weights: { category: 1 }, shotOrders: SHOT_ORDERS, ...over });
const SLOTS = { ...declaredSlots([]), pages: { pdp: [layoutSlot(), carousel()] } };
const learnOf = (reward = 'click', holdout?: Record<string, unknown>) =>
  learnDocument({ [CAROUSEL]: { measurementBasis: 'rendered-v1', reward } }, holdout ? { holdout } : {});
const DOCS = { pieces: [...MODULES, ...IMAGES, WALLET], slots: SLOTS, learn: learnOf() };
/** The paint P84's head script makes for paid social on mobile: on_model, detail, studio, flat_lay, then the rest. */
const PAINTED = [id(3), id(5), id(4), id(1), id(6), id(2), id(7), id(8)];

/** The table in force, as the server render reads it (P84). */
async function tableOf(m: Mounted): Promise<{ status: number; version: string; rows: unknown[] }> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/context-table/pdp`, { headers: { 'X-Tenant': TENANT } }));
  const body = await response.json().catch(() => ({})) as { version?: unknown; rows?: unknown };
  return { status: response.status, version: typeof body.version === 'string' ? body.version : '', rows: Array.isArray(body.rows) ? body.rows : [] };
}
/** The beacon as the SDK sends it (S1), through POST /realtime/action. */
const carouselBeacon = (s: Shopper, data: Record<string, unknown>): Promise<Answer> =>
  s.action({ type: 'carousel_exposure', data: { page: 'pdp', slot: CAROUSEL, arm: 'personalized', ...data } });
/** What every statistics object holds for an item at one level key, summed (P30's read): `n` exposures, `s` credits. */
async function at(m: Mounted, key: string, field: 'n' | 's'): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of [...m.stats.keys()].sort()) {
    const response = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/snapshot', { method: 'POST' });
    const body = await response.json().catch(() => ({})) as { snapshot?: { items?: Record<string, Record<string, { n: number; s: number }>> } | null };
    for (const [item, cells] of Object.entries(body.snapshot?.items ?? {})) if (cells[key]) out[item] = Math.round((out[item] ?? 0) + cells[key]![field]);
  }
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n !== 0));
}
const CELL = 'c=paid_social|v=1';
const answerOf = (a: Answer) => [a.status, a.body.exposure ?? null, a.body.reason ?? a.body.images ?? null];

// ===========================================================================
// unit:P85.CX1 — the carousel beacon: admitted for the version in force and a named row, once per page view; ignored by name
// ===========================================================================

describe('unit:P85.CX1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a beacon under tracking consent naming the table version in force, a row's context (paid social, visit 1, mobile), the carousel slot and the eight images in painted order is admitted and adds one exposure per drawn image to that context's cell; a repeat for the same page view adds nothing (P30's journal, answered admitted); a default context is admitted and counts at the root only`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX1 — P84\'s product page publishes');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m);
      const pageInstance = pageInstanceOf('p85-cx1');
      const first = await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance });
      const repeat = await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance });
      await m.drainLedger();
      expect.soft([answerOf(first), answerOf(repeat)], `${host}: P85.CX1 — admitted, the repeat too (P30's form) (today the action is refused: ${JSON.stringify(first.body).slice(0, 160)})`)
        .toEqual([[200, 'admitted', 8], [200, 'admitted', 8]]);
      expect.soft(await at(m, CELL, 'n'), `${host}: P85.CX1 — one exposure per drawn image in the context's cell, the repeat counted once`)
        .toEqual(Object.fromEntries(PAINTED.map(item => [item, 1])));
      const before = await learned(m);
      const fallback = await carouselBeacon(s, { tableVersion: table.version, context: 'default', images: IMAGES.map(p => p.id), pageInstance: pageInstanceOf('p85-cx1-default') });
      await m.drainLedger();
      const root = (await learned(m))[id(1)]?.n ?? 0, rootBefore = before[id(1)]?.n ?? 0;
      expect.soft([answerOf(fallback), Math.round(root - rootBefore)], `${host}: P85.CX1 — the default row admitted, counted at the root (S4)`).toEqual([[200, 'admitted', 8], 1]);
    }, 120_000);

    it(`host (${host}): ignored by name and adding nothing — no tracking consent (tracking_refused), a version never issued (stale_table), a context the version has no row for (unknown_context), a slot that is not the carousel (not_carousel), another product's image (unknown_image), the holdout's arm (not_learning); malformed data 400; P30's layout beacon on the carousel slot still answers not_context_only (lock)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX1 — the documents publish');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m), untracked = await shopperOn(m, { tracking: false, personalization: false });
      const valid = { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED };
      const cases: Array<[string, Shopper, Record<string, unknown>, string]> = [
        ['no tracking consent', untracked, valid, 'tracking_refused'],
        ['a version never issued', s, { ...valid, tableVersion: '0'.repeat(64) }, 'stale_table'],
        ['a context with no row (a bucket outside the cut)', s, { ...valid, context: 'paid_social|7|mobile' }, 'unknown_context'],
        ['a context with no row (a channel outside the words)', s, { ...valid, context: 'tiktok|1|mobile' }, 'unknown_context'],
        ['a context with no row (a device outside the classes)', s, { ...valid, context: 'paid_social|1|watch' }, 'unknown_context'],
        ['the layout slot', s, { ...valid, slot: LAYOUT, images: [MODULES[0]!.id] }, 'not_carousel'],
        ['another product\'s image', s, { ...valid, images: [id(3), WALLET.id] }, 'unknown_image'],
        ['the holdout\'s arm (default)', s, { ...valid, arm: 'default' }, 'not_learning'],
        ['the holdout\'s arm (no_learning)', s, { ...valid, arm: 'no_learning' }, 'not_learning'],
      ];
      const answers: unknown[][] = [];
      for (const [name, who, data] of cases) answers.push([name, ...answerOf(await carouselBeacon(who, { ...data, pageInstance: pageInstanceOf('p85-cx1-ignored') }))]);
      await m.drainLedger();
      expect.soft(answers, `${host}: P85.CX1 — each ignored by name`).toEqual(cases.map(([name, , , reason]) => [name, 200, 'ignored', reason]));
      expect.soft(await at(m, CELL, 'n'), `${host}: P85.CX1 — and nothing counted`).toEqual({});
      const malformed: unknown[][] = [];
      for (const data of [{ ...valid, images: [] }, { ...valid, images: [id(3), id(3)] }, { ...valid, tableVersion: 7 }, { ...valid, context: '' }, { ...valid, arm: 'treated' }]) {
        const answer = await carouselBeacon(s, { ...data, pageInstance: pageInstanceOf('p85-cx1-malformed') });
        malformed.push([answer.status, answer.body.error ?? null]);
      }
      expect.soft(malformed, `${host}: P85.CX1 — malformed beacons refused 400 by name`).toEqual(malformed.map(() => [400, 'Invalid carousel exposure']));
      const layout = await s.action({ type: 'layout_exposure', data: { contextKey: 'pdp|c=paid_social|v=1|k=0', page: 'pdp', slot: CAROUSEL, modules: [id(3)], pageInstance: pageInstanceOf('p85-cx1-lock') } });
      expect.soft([layout.status, layout.body.exposure ?? null, layout.body.reason ?? null], `${host}: P85.CX1 — LOCK: P30's layout beacon is unchanged`).toEqual([200, 'ignored', 'key_not_issued']);
    }, 120_000);

    it(`host (${host}): the stale-version rule (S3) — after a slots publication moves the version, the replaced version is admitted within the stable address's max-age (60 seconds) and ignored stale_table after it; the new version is admitted`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX1 — the documents publish');
      const old = await tableOf(m);
      expect(old.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const moved = await putDocument(m, 'slots', { ...SLOTS, pages: { pdp: [layoutSlot(), carousel({ shotOrders: [SHOT_ORDERS[0]] })] } }, 'p85 one order');
      expect(moved.status, `${host}: PRECONDITION — the changed shot orders publish`).toBe(200);
      const current = await tableOf(m);
      expect(current.version !== old.version, `${host}: PRECONDITION P84 — the version moved`).toBe(true);
      const s = await shopperOn(m);
      const send = (version: string, label: string) => carouselBeacon(s, { tableVersion: version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance: pageInstanceOf(label) });
      const within = await send(old.version, 'p85-cx1-within');
      const fresh = await send(current.version, 'p85-cx1-current');
      const realNow = Date.now;
      let after: Answer;
      try { Date.now = () => realNow() + 61_000; after = await send(old.version, 'p85-cx1-after'); } finally { Date.now = realNow; }
      expect.soft([answerOf(within), answerOf(fresh), answerOf(after)], `${host}: P85.CX1 — the replaced version within a minute, the version in force, the replaced version after a minute`)
        .toEqual([[200, 'admitted', 8], [200, 'admitted', 8], [200, 'ignored', 'stale_table']]);
    }, 120_000);
  }

  it('sdk: the real SDK sends one carousel_exposure per page view and carousel slot under tracking consent, with the head script\'s values and the page view, asking for no decisions; none without tracking consent', async () => {
    const sentBy = async (tracking: boolean) => {
      const f = testHost({ responses: () => ({ success: true }) });
      if (!tracking) {
        const base = f.host.fetch;
        f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
          const answer = await base(url, init);
          if (!url.endsWith('/identity/session')) return answer;
          const body = await answer.json() as { session: { consent: { tracking: boolean; personalization: boolean; instruction: Record<string, unknown> } } };
          const refused = { value: false, chosenAt: f.host.now(), expiresAt: f.host.now() + 30 * 86_400_000 };
          body.session.consent = { ...body.session.consent, tracking: false, personalization: false, instruction: { ...body.session.consent.instruction, tracking: refused, personalization: refused } };
          return { ok: true, status: 200, json: async () => body };
        };
      }
      const core = createCore({ tenant: 'coach', source: 'coach-pdp' }, f.host);
      const listen = createListen(core) as unknown as Record<string, unknown>;
      expect(await core.ready(), 'PRECONDITION: the client is ready').toBe(true);
      const send = listen.carouselExposure as ((beacon: Record<string, unknown>) => Promise<unknown>) | undefined;
      expect(typeof send, 'P85.CX1 — the SDK offers listen.carouselExposure').toBe('function');
      const snapshotsBefore = f.calls.filter(c => c.url.includes('/decisions/snapshot')).length;
      const beacon = { tableVersion: 'a'.repeat(64), context: 'paid_social|1|mobile', page: 'pdp', slot: CAROUSEL, images: PAINTED, arm: 'personalized' };
      await send!(beacon);
      await send!(beacon);
      for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
      return { sent: f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!) as { type: string; data: Record<string, unknown> })
        .filter(e => e.type === 'carousel_exposure'), asked: f.calls.filter(c => c.url.includes('/decisions/snapshot')).length - snapshotsBefore };
    };
    const tracked = await sentBy(true);
    expect.soft({ beacons: tracked.sent.map(e => [e.data.tableVersion, e.data.context, e.data.page, e.data.slot, e.data.images, e.data.arm, typeof e.data.pageInstance]), asked: tracked.asked },
      'P85.CX1 — under tracking consent one carousel_exposure per page view and slot, carrying the head script\'s values and the page view; no decision asked')
      .toEqual({ beacons: [['a'.repeat(64), 'paid_social|1|mobile', 'pdp', CAROUSEL, PAINTED, 'personalized', 'string']], asked: 0 });
    expect.soft((await sentBy(false)).sent.length, 'P85.CX1 — without tracking consent the SDK sends no beacon').toBe(0);
  });
});

// ===========================================================================
// unit:P85.CX2 — the credit: a click and an add to bag on a beacon-drawn image; the holdout's arms; no double credit
// ===========================================================================

/** A click on an image of the page view, as the SDK's capture sends it for a painted image (S5): no decision behind it. */
const clickOn = (s: Shopper, image: string, position: number, pageInstance: string) => s.action({ type: 'content_click',
  data: { contentId: image, slot: CAROUSEL, page: 'pdp', pageInstance, position } });

describe('unit:P85.CX2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a click on a beacon-drawn image credits that image's exposure in the context's cell, once; a click on an image the page view did not draw credits nothing; the holdout's arm, whose beacon counted nothing, credits nothing`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX2 — the documents publish');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m);
      const pageInstance = pageInstanceOf('p85-cx2-click');
      const drawn = await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED.slice(0, 4), pageInstance });
      expect(drawn.status, `${host}: PRECONDITION — the beacon is answered (${JSON.stringify(drawn.body).slice(0, 120)})`).toBe(200);
      expect((await clickOn(s, id(5), 2, pageInstance)).status, `${host}: PRECONDITION — the click is accepted`).toBe(200);
      expect((await clickOn(s, id(8), 8, pageInstance)).status, `${host}: PRECONDITION — the click on an undrawn image is accepted`).toBe(200);
      const holdoutPage = pageInstanceOf('p85-cx2-holdout');
      await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED.slice(0, 4), pageInstance: holdoutPage, arm: 'default' });
      await clickOn(s, id(3), 1, holdoutPage);
      await m.drainLedger();
      expect.soft(await at(m, CELL, 's'), `${host}: P85.CX2 — the drawn image's click credited in the context's cell, nothing else (today a click on a painted image credits nothing)`)
        .toEqual({ [id(5)]: 1 });
    }, 120_000);

    it(`host (${host}): an add to bag originating at a beacon-drawn image (the image and the page view named, P33's module-tied form) credits that image's exposure in the context's cell, on a carousel learning against add to bag`, async () => {
      const m = await mount(host, { ...DOCS, learn: learnOf('add_to_bag') });
      expectPublished(m, 'P85.CX2 — the documents publish');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m);
      const pageInstance = pageInstanceOf('p85-cx2-bag');
      await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED.slice(0, 4), pageInstance });
      expect((await s.action({ type: 'add_to_cart', data: { productId: A, contentId: id(4), slot: CAROUSEL, page: 'pdp', pageInstance } })).status,
        `${host}: PRECONDITION — the add to bag is accepted`).toBe(200);
      await m.drainLedger();
      expect.soft(await at(m, CELL, 's'), `${host}: P85.CX2 — the add to bag credited to the image the shopper saw (design note §9)`).toEqual({ [id(4)]: 1 });
    }, 120_000);

    it(`host (${host}): no double credit — a page view whose image also has the engine's own decision, rendered and acknowledged on the same page view, credits the click once`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX2 — the documents publish');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m);
      const pageInstance = pageInstanceOf('p85-cx2-double');
      const snap = await s.snapshot('pdp', { pageInstance });
      const rendered = snap.decisions.filter((d: Decision) => d.slot === CAROUSEL).find((d: Decision) => d.contentId === id(3));
      expect(rendered, `${host}: PRECONDITION — the engine decided image 3 for the page view (${snap.status})`).toBeTruthy();
      expect((await s.ack(snap, rendered!)).status, `${host}: PRECONDITION — its render is acknowledged`).toBe(200);
      await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED.slice(0, 4), pageInstance });
      await clickOn(s, id(3), 1, pageInstance);
      await m.drainLedger();
      const credits = await learned(m);
      expect.soft(Math.round(credits[id(3)]?.s ?? 0), `${host}: P85.CX2 — one credit for one click, whichever record carries it`).toBe(1);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P85.CX3 — the kit states the carousel beacon
// ===========================================================================

describe('unit:P85.CX3', () => {
  it('logic: kit 01 states listen.carouselExposure beside the layout beacon (once per page view, under consent, the head script\'s values); kit 02 states the carousel_exposure action, its admission (the version in force or the replaced one within a minute) and its ignored reasons by name; kit 03 lists carousel_exposure and its payload', () => {
    const kit01 = readTree('docs/kit/01-integration-guide.md'), kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const has = (text: string, patterns: RegExp[]) => patterns.map(p => [p.source, p.test(text)]);
    const all = (patterns: RegExp[]) => patterns.map(p => [p.source, true]);
    const k01 = [/client\.listen\.carouselExposure\(\{ tableVersion, context, page, slot, images, arm \}\)/, /carousel_exposure[^.]*once per page view/, /carousel_exposure[^.]*tracking consent/];
    const k02 = [/`carousel_exposure`/, /`stale_table`/, /`unknown_context`/, /`not_carousel`/, /`unknown_image`/, /`not_learning`/, /max-age[^.]*replaced|replaced[^.]*max-age/,
      /`tableVersion`/, /`images`/];
    const k03 = [/\| `carousel_exposure` \|/, /carousel_exposure[^.]*`tableVersion`[^.]*`context`[^.]*`images`/];
    expect.soft({ kit01: has(kit01, k01), kit02: has(kit02, k02), kit03: has(kit03, k03) }, 'P85.CX3 — the kit states the carousel beacon (today it states the layout beacon only)')
      .toEqual({ kit01: all(k01), kit02: all(k02), kit03: all(k03) });
  });
});
