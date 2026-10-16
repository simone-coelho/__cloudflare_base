// src/units/P16/LEDGER.unit.test.ts
// P16 under the Closure Ledger: the tests for the LOCAL criteria of the P16 work
// order (`tapestry-parity-build`, ticket P16 "An objective per piece of
// content"). DC1 (decision D1) is ruled here and exercised inside OB1-OB5; LV1
// and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P16.<criterion> …')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P16 in section B): "a
//     piece declares its success event, and pieces with different objectives
//     rank in one slot through the configured conversion value"; parity §7 (the
//     slot sets the currency; a piece may declare which event counts as its
//     success; both are converted to the slot's currency with a value the
//     customer sets);
//   · freeze sheet item 14 (D1: "a per-piece success event and a per-slot
//     conversion table, absent by default") and item 43 ("A declared success
//     event the slot's table does not value credits nothing"). Both UNANSWERED
//     at the freeze: every unit names them (R-P15);
//   · the existing contract: src/content/kinds.ts (the reward list click, dwell,
//     video_complete, wishlist, add_to_bag, purchase, custom; the learn
//     validator), src/learn/policy.ts (creditWeight: a success weighs 1 under the
//     unit objective), src/learn/fan.ts and src/durable-objects/LearnStats.ts
//     (the slot learns against one reward; the offline recomputation POST
//     /v1/:tenant/learn/generation { slot, brand, rebuildFrom }).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   A piece declares `successEvent` (one reward from the list) in the
//   catalogue; a slot publishes `conversions: { <reward>: <finite positive
//   value> }` on its learn dials. An outcome of a piece's declared success event
//   credits that piece's decision with `conversions[event]` in the statistics
//   objects' success counter (`s`), online and offline; a piece without a
//   declaration is credited for the slot's reward as today (one click, weight 1
//   under the unit objective). Every record and receipt of a slot with a table
//   carries `successEvent: { event, value }` (on the record under `explain`): the
//   piece's declared event, else the slot's reward, and the table's value for it,
//   `value: null` when the table does not value it.
//   The fixture is a content slot alone on the home page (governance 3), so its
//   page-wide order is its position in the slot and no layout precondition applies.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `successEvent` on a catalogue piece, `conversions` on a slot's learn dials,
// `explain.successEvent` on the record and `successEvent` on the receipt. No new
// export is imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts).

import { describe, expect, it } from 'vitest';

import { validateContentCatalog, validateLearnConfig } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';

import {
  asOperator, BRAND, expectPublished, HOSTS, learned, learnDocument, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf, readTree, receiptsOf,
  replayOf, rounded, servePage, shopperOn, storedDecisions, TABBY_VIEWS, TENANT, toLedger, type Mounted, type Shopper, type Snapshot,
} from '../_parity';

const STORY = 'home-stories';
const story = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, customerContentId: `TAP-${id.toUpperCase().replace(/\./g, '-')}`,
  type: 'editorial', title, tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' }, ...over });
/** Three Tabby stories of equal base for a Tabby shopper: one whose success is an add to bag, one undeclared (the slot's click), one whose success is a purchase. */
const BAG_STORY = 'story.bag', FILM_STORY = 'story.film', CHARM_STORY = 'story.charm';
const DECLARED = [story(BAG_STORY, 'Carry the Tabby', { successEvent: 'add_to_bag' }), story(FILM_STORY, 'The Tabby in motion'), story(CHARM_STORY, 'Charm it', { successEvent: 'purchase' })];
const PLAIN = DECLARED.map(piece => { const { successEvent: _s, ...rest } = piece as typeof piece & { successEvent?: string }; void _s; return rest; });
const SLOTS = { version: 'parity-p16-slots', governanceVersion: 3, pages: { home: [{ slot: STORY, take: 3, weights: { line: 1 } }] } };
/** The slot's currency: an add to bag is worth 5 clicks; a purchase is not valued. */
const TABLE = { add_to_bag: 5, click: 1 };
const learnWith = (dials: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  learnDocument({ [STORY]: { measurementBasis: 'rendered-v1', reward: 'click', ...dials } }, extra);
const BAG_PRODUCT = 'COA-CW620';

async function shopperWithPage(m: Mounted, label: string, tabby = false): Promise<{ s: Shopper; page: Snapshot }> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: her page view is accepted`).toBe(200);
  if (tabby) for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: her view is accepted`).toBe(200);
  const page = await s.snapshot('home', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `${m.host}: her page is answered: ${JSON.stringify(page.body).slice(0, 300)}`).toBe(200);
  for (const d of page.decisions.filter(x => x.slot === STORY)) expect((await s.ack(page, d)).status, `${m.host}: ${d.contentId} acknowledged`).toBe(200);
  return { s, page };
}
const decisionOf = (page: Snapshot, id: string) => page.decisions.find(d => d.contentId === id);
const outcome = (s: Shopper, page: Snapshot, id: string, type: 'add_to_cart' | 'purchase' | 'content_click') => {
  const d = decisionOf(page, id);
  expect(d?.decisionId, `${s.subject}: PRECONDITION — ${id} is served with a receipt`).toBeTruthy();
  if (type === 'content_click') return s.click(page, d!);
  return s.action({ type, data: { contentId: id, decisionId: d!.decisionId, slot: STORY, productId: BAG_PRODUCT, price: 575, value: 575, currency: 'USD', brand: BRAND,
    ...(type === 'purchase' ? { orderId: `order-${crypto.randomUUID()}` } : {}) } });
};
const storyCredits = async (m: Mounted) => Object.fromEntries(Object.entries(rounded(await learned(m), 's')).filter(([item]) => item.startsWith('story.')));
async function rebuilt(m: Mounted): Promise<Record<string, number>> {
  const answer = await asOperator(m, 'POST', `/v1/${TENANT}/learn/generation`, { slot: STORY, brand: BRAND, rebuildFrom: new Date().toISOString().slice(0, 10) });
  expect(answer.status, `${m.host}: PRECONDITION — the offline recomputation rebuilds ${STORY} from the retained day: ${JSON.stringify(answer.body).slice(0, 300)}`).toBe(200);
  return storyCredits(m);
}

// ===========================================================================
// unit:P16.OB1 — the validators
// ===========================================================================

describe('unit:P16.OB1 (freeze item 14)', () => {
  it('logic: the catalogue validator accepts and keeps a success event from the reward list and refuses any other naming successEvent; the learn validator accepts and keeps a conversion table of rewards to finite positive values and refuses any other naming conversions', () => {
    const catalogue = (successEvent: unknown) => ({ version: 'p16', pieces: [story(BAG_STORY, 'Carry the Tabby', { successEvent })] });
    const kept = validateContentCatalog(catalogue('add_to_bag'));
    expect.soft(kept.ok ? (kept.value.pieces[0] as unknown as Record<string, unknown>).successEvent : (kept as { errors: string[] }).errors.join('; '),
      'P16.OB1 — a success event from the reward list is accepted and kept').toBe('add_to_bag');
    const catalogueRefusals = ['page_view', 'Add_To_Bag', '', 3].map(v => { const r = validateContentCatalog(catalogue(v)); return [v, !r.ok && r.errors.some(e => /successEvent/.test(e))]; });
    expect.soft(catalogueRefusals, 'P16.OB1 — any other success event is refused naming successEvent').toEqual(['page_view', 'Add_To_Bag', '', 3].map(v => [v, true]));

    const table = validateLearnConfig(learnWith({ conversions: TABLE }));
    expect.soft(table.ok ? table.value.slots?.[STORY] && (table.value.slots[STORY] as Record<string, unknown>).conversions : (table as { errors: string[] }).errors.join('; '),
      'P16.OB1 — a conversion table of rewards to finite positive values is accepted and kept').toEqual(TABLE);
    const bad = [{ page_view: 1 }, { click: 0 }, { click: -2 }, { click: '5' }, { add_to_bag: null }, ['click']];
    expect(bad.map(conversions => { const r = validateLearnConfig(learnWith({ conversions })); return [JSON.stringify(conversions), !r.ok && r.errors.some(e => /conversions/.test(e))]; }),
      'P16.OB1 — every other table is refused naming conversions').toEqual(bad.map(c => [JSON.stringify(c), true]));
  });
});

// ===========================================================================
// unit:P16.OB2 — a declared success event credits its piece at the table's value; an undeclared piece as today
// ===========================================================================

describe('unit:P16.OB2 (freeze item 14)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an add to bag on the story declaring add_to_bag credits its decision 5 in the slot's currency and a click on the undeclared story credits 1, online and in the offline recomputation alike`, async () => {
      const m = await mount(host, { pieces: DECLARED, slots: SLOTS, learn: learnWith({ conversions: TABLE }) });
      expectPublished(m, 'P16.OB2 — the stories with their success events and the slot with its conversion table publish');
      const { s, page } = await shopperWithPage(m, 'p16-ob2', true);
      expect((await outcome(s, page, BAG_STORY, 'add_to_cart')).status, `${host}: the add to bag is accepted`).toBe(200);
      expect((await outcome(s, page, FILM_STORY, 'content_click')).status, `${host}: the click is accepted`).toBe(200);
      await m.drainLedger();
      const online = await storyCredits(m);
      expect(online, `${host}: P16.OB2 — online: the add-to-bag story is credited 5, the undeclared story 1 for the slot's click`).toEqual({ [BAG_STORY]: 5, [FILM_STORY]: 1 });
      expect(await rebuilt(m), `${host}: P16.OB2 — the offline recomputation credits exactly the same`).toEqual(online);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P16.OB3 — pieces with different success events rank on lifts in the slot's currency; the record and receipt name them
// ===========================================================================

describe('unit:P16.OB3 (freeze item 14)', () => {
  /** nMin 4 so eight page views carry a level; the lift clamps are the shipped 0.5 and 2. */
  const STATS = { n0: 30, tauLearnMs: 1_814_400_000, liftMin: 0.5, liftMax: 2, nMin: 4 };
  for (const host of HOSTS) {
    it(`host (${host}): with 2 add-to-bag successes (worth 10) against 4 clicks (worth 4) in eight page views, the add-to-bag story outranks the click story at γ 1, and every record and receipt names each story's success event and the value applied`, async () => {
      const learn = learnWith({ conversions: TABLE, gamma: 1 }, { stats: STATS });
      const m = await mount(host, { pieces: DECLARED.slice(0, 2), slots: SLOTS, learn });
      expectPublished(m, 'P16.OB3 — the stories and the table publish');
      for (let i = 0; i < 8; i++) {
        const { s, page } = await shopperWithPage(m, `p16-ob3-${i}`);
        if (i < 2) await outcome(s, page, BAG_STORY, 'add_to_cart');
        if (i < 4) await outcome(s, page, FILM_STORY, 'content_click');
      }
      await m.drainLedger();
      for (const name of [...m.stats.keys()]) await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/publish', { method: 'POST' });
      expect(await storyCredits(m), `${host}: P16.OB3 — the evidence it ranks on is credited in the slot's currency (P16.OB2's credit)`).toEqual({ [BAG_STORY]: 10, [FILM_STORY]: 4 });
      // The earlier pages read the slot's lift before any was published; the serving path caches per placement in process.
      invalidateLiftCache();
      const { s, page } = await shopperWithPage(m, 'p16-ob3-measured', true);
      const served = page.decisions.filter(d => d.slot === STORY).sort((a, b) => a.order - b.order).map(d => d.contentId);
      expect(served, `${host}: P16.OB3 — the add-to-bag story leads on its lift in the slot's currency (in raw successes the click story would)`).toEqual([BAG_STORY, FILM_STORY]);
      await m.drainLedger();
      const records = storedDecisions(m, s.subject).filter(r => r.slot === STORY);
      expect(records.map(r => [r.item_id, (r.explain as Record<string, unknown>).successEvent ?? 'no explain.successEvent']),
        `${host}: P16.OB3 — each record names its success event and the conversion value applied`)
        .toEqual(expect.arrayContaining([[BAG_STORY, { event: 'add_to_bag', value: 5 }], [FILM_STORY, { event: 'click', value: 1 }]]));
      const receipts = (await receiptsOf(m, s.subject)).filter(r => r.slot === STORY);
      expect(receipts.map(r => [r.item, r.successEvent ?? 'no successEvent on the receipt']), `${host}: P16.OB3 — and so does each receipt`)
        .toEqual(expect.arrayContaining([[BAG_STORY, { event: 'add_to_bag', value: 5 }], [FILM_STORY, { event: 'click', value: 1 }]]));
    }, 120_000);
  }
});

// ===========================================================================
// unit:P16.OB4 — an unvalued success event credits nothing and is named; without declarations and tables, as before
// ===========================================================================

describe('unit:P16.OB4 (freeze items 14 and 43)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a purchase of the story declaring purchase, which the table does not value, credits nothing and its record names the unvalued event`, async () => {
      const m = await mount(host, { pieces: DECLARED, slots: SLOTS, learn: learnWith({ conversions: TABLE }) });
      expectPublished(m, 'P16.OB4 — the stories and the table publish');
      const { s, page } = await shopperWithPage(m, 'p16-ob4', true);
      expect((await outcome(s, page, CHARM_STORY, 'purchase')).status, `${host}: the purchase is accepted`).toBe(200);
      expect((await outcome(s, page, FILM_STORY, 'content_click')).status, `${host}: CONTROL — the click is accepted`).toBe(200);
      await m.drainLedger();
      expect(await storyCredits(m), `${host}: P16.OB4 — the unvalued purchase credits nothing; the click is credited as before`).toEqual({ [FILM_STORY]: 1 });
      const charm = storedDecisions(m, s.subject).find(r => r.item_id === CHARM_STORY);
      expect((charm?.explain as Record<string, unknown> | undefined)?.successEvent ?? 'no explain.successEvent', `${host}: P16.OB4 — the record names the declared event the table does not value`)
        .toEqual({ event: 'purchase', value: null });
    }, 90_000);

    it(`host (${host}): LOCK — without declarations and tables an add to bag credits nothing on a click slot, a click credits 1, the records carry no success event, and every decision replays equal`, async () => {
      // Served-v1 and without the durable recovery path: the replay reads what the real producer and consumer wrote (R-P14).
      const m = await mount(host, { pieces: PLAIN, slots: SLOTS, learn: learnDocument({ [STORY]: { reward: 'click' } }) }, { recovery: false });
      expectPublished(m, 'P16.OB4 — the plain stories publish');
      const s = await shopperOn(m);
      expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${host}: her page view is accepted`).toBe(200);
      const set = await servePage(m, s, 'home', { offer: false });
      await toLedger(m, set.records);
      const stored = storedDecisions(m, s.subject).filter(r => r.slot === STORY);
      expect(stored.length, `${host}: PRECONDITION — the ledger holds the three decisions`).toBe(3);
      expect(stored.map(r => (r.explain as Record<string, unknown>).successEvent ?? null), `${host}: P16.OB4 — no success event is recorded without a declaration or a table`).toEqual([null, null, null]);
      const replays: unknown[][] = [];
      for (const r of stored) {
        const replay = await replayOf(m, r.decision_id);
        replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
      }
      expect(replays, `${host}: P16.OB4 — each replays equal`).toEqual(replays.map(([id]) => [id, 200, 'equal']));
      const credited = await mount(host, { pieces: PLAIN, slots: SLOTS, learn: learnWith() });
      expectPublished(credited, 'P16.OB4 — the plain stories publish on rendered-v1');
      const { s: shopper, page } = await shopperWithPage(credited, 'p16-ob4-lock', true);
      await outcome(shopper, page, BAG_STORY, 'add_to_cart');
      await outcome(shopper, page, FILM_STORY, 'content_click');
      await credited.drainLedger();
      expect(await storyCredits(credited), `${host}: P16.OB4 — the slot learns its one reward: the click is credited 1, the add to bag nothing`).toEqual({ [FILM_STORY]: 1 });
    }, 90_000);
  }
});

// ===========================================================================
// unit:P16.OB5 — the kit
// ===========================================================================

describe('unit:P16.OB5 (freeze items 14 and 43)', () => {
  it('logic: the API reference and the payload schemas each document the success event and the conversion table', () => {
    const sentences = (file: string) => readTree(file).replace(/`/g, '').split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(s => s.replace(/\s+/g, ' ').trim());
    const statements: Array<[string, (s: string) => boolean]> = [
      ['successEvent: a piece declares one reward as its success, absent by default', s => /successEvent/.test(s) && /(absent|default|optional)/i.test(s)],
      ['conversions: the slot table converts each reward into the slot currency', s => /conversions/.test(s) && /currency/i.test(s)],
      ['an unvalued success event credits nothing', s => /(successEvent|success event)/i.test(s) && /(not valued|does not value|unvalued)/i.test(s) && /nothing/i.test(s)],
    ];
    const missing = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']
      .flatMap(file => statements.filter(([, test]) => !sentences(file).some(test)).map(([name]) => `${file}: ${name}`));
    expect(missing, 'P16.OB5 — the kit documents the success event and the conversion table').toEqual([]);
  });
});
