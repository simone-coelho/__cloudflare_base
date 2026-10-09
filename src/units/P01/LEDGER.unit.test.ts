// src/units/P01/LEDGER.unit.test.ts
// P01 under the Closure Ledger: the tests for the LOCAL criteria of the frozen
// P01 work order (`tapestry-parity-build`, ticket P01 "Layout configuration
// addressable per context"). DC1 and DC2 (decisions D1, D2) are ruled and
// exercised inside O1, O2 and O5; LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P01.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P01 in section A, amended
//     2026-10-07): "a merchandiser saves a module order for a context (entry
//     channel × visit bucket) on a page's layout slot. The next decision for a
//     shopper in that context returns that order, other contexts keep theirs,
//     and the receipt names the configured order as the reason. It takes effect
//     without a deployment … an order may list fewer modules than the slot's
//     `take`; a module not listed is hidden in that context and not counted as
//     an exposure. The order is editable in the console";
//   · freeze sheet item 17 (D1: "A context is one entry channel or 'any' with
//     one or more visit buckets or 'any'; the most specific match wins; a tie is
//     refused at publication"; D2: "The order is served exactly until P28, never
//     on the default arm, without the context's consent, or under exploration")
//     and item 35 ("An unknown channel or visit bucket matches no context, not
//     even one that names 'any'; 'never under exploration' means a decision on
//     which the slot's exploration picks receives the slot's own decision");
//   · the investigation, section G-B (C1 option B; C2 "the cell dimensions
//     today are channel (six words), visit bucket (1, 2 to 3, 4 and later,
//     unknown)"; C3 the console's slot rules);
//   · the parity document, section 3.8 (cited by number only);
//   · the six channel words and the visit buckets as the engine derives them
//     (`src/services/visit.ts:33-35`, `src/content/cell.ts:44-49`).
//
// THE READINGS THIS FILE RULES, ONE PER CRITERION (one representation for all):
//   An order is published on the page's DECLARED layout slot (P02's
//   `layout: true`, governanceVersion 4) as `orders: [{ context: { channel,
//   visitBuckets }, modules }]`, where `channel` is one of the six channel words
//   or 'any' and `visitBuckets` is a non-empty list of '1' | '2-3' | '4+' or
//   'any'. Specificity is the number of parts that are not 'any' (0..2).
//   O1  After `PUT /content/slots` publishes an order (no deployment), the next
//       snapshot of a shopper in that context returns `modules` position for
//       position; with two matching orders the more specific one is served, and
//       a shopper in another context keeps the order of hers.
//   O2  Each of: a shopper in a context no order names; a shopper whose visit
//       bucket is unknown (an order naming 'any' bucket included); a shopper
//       whose channel is unknown (an order naming 'any' channel included); a
//       shopper without personalization consent; a shopper on the holdout's
//       default arm; a decision the slot's exploration picks — receives exactly
//       the decision she received before the order was published.
//   O3  An order listing 2 modules on a take of 4 returns those 2 in that order;
//       acknowledging both gives each one exposure and no other module any.
//   O4  Every record and every receipt of a position the order set carries
//       `configuredOrder: { context, modules }` — the context as published and
//       the whole order, the record's own `position` being the position it set —
//       and the receipt's `why` names the configured order.
//   O5  `PUT /content/slots` answers 422 with an error naming the offending
//       value, and writes no revision, for: an unregistered module (in no piece
//       of the published catalogue), a repeated module, a channel outside the six
//       words, a visit bucket outside '1' | '2-3' | '4+', two orders for one
//       context, two contexts matching one shopper with equal specificity
//       ({paid_social, any} beside {any, [1]}), an order on a slot that is not
//       the declared layout slot, an order listing an excluded module and an
//       order that does not keep the slot's pinned module at its position.
//   O6  The shipped slot-rules screen of a declared layout slot renders an
//       order editor `[data-focus-key="layout.orders"]` (the JSON idiom of the
//       screen's other hard controls), validates the draft, saves it through
//       `PUT /content/slots`, and the saved revision serves it; a draft that
//       repeats a module disables the save and sends nothing.
//   O7  Every decision served under an order replays `equal`, and a RETAINED
//       declared slots document without orders decides the slot's own decision
//       and replays `equal`.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `orders` on the layout slot, `configuredOrder` on `explain` and on the
// receipt, the console control `layout.orders`. No new export is imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts, the
// shipped console under jsdom).

import { describe, expect, it } from 'vitest';

import {
  declaredSlots, DIRECT_ENTRY, errorsOf, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, loadSlots, M, MODULES, mount,
  openConsole, PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf, putSlots, receiptsOf, recentSlot, replayOf, rounded, servedIn, shopperOn,
  storedDecisions, TENANT, type Host, type Mounted, type Shopper,
} from '../_parity';

const PAID_SOCIAL_FIRST = { channel: 'paid_social', visitBuckets: ['1'] };
const PAID_SOCIAL_ANY = { channel: 'paid_social', visitBuckets: 'any' };
const ANY_FIRST = { channel: 'any', visitBuckets: ['1'] };
/** Orders that differ from catalogue order and from every ranking, and include the module tagged on an unmapped dimension. */
const ORDER_A = [M.editorial, M.grid, M.ugc, M.reco1];
const ORDER_B = [M.reco2, M.reco1, M.grid, M.editorial];
const ORDER_C = [M.ugc, M.editorial, M.reco2, M.grid];
/** The slot's own decision for a shopper with no signal: the first four eligible modules in catalogue order (P02.A2). */
const OWN_COLD = [M.grid, M.reco1, M.reco2, M.editorial];

const BASE = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
const withOrders = (orders: unknown[], over: Record<string, unknown> = {}) => declaredSlots([layoutSlot({ orders, ...over }), recentSlot()]);

/** A shopper on her first visit, arrived from an Instagram paid-social click (her page view establishes the visit). */
async function paidSocialFirstVisit(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: her page view is accepted`).toBe(200);
  return s;
}
async function directFirstVisit(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, DIRECT_ENTRY)).status, `${m.host}: her page view is accepted`).toBe(200);
  return s;
}
const layoutOf = async (s: Shopper, entry?: Record<string, string>) =>
  servedIn(await s.snapshot('pdp', { pageInstance: pageInstanceOf('p01'), ...(entry ? { entry } : {}) }), LAYOUT);

/** Publishes the orders with the merchandiser's own save and confirms the platform kept them. */
async function publishOrders(m: Mounted, orders: unknown[], over: Record<string, unknown> = {}): Promise<void> {
  const written = await putSlots(m, withOrders(orders, over), 'per-context orders');
  expect(written.status, `${m.host}: P01 — the per-context orders publish through PUT /content/slots: ${JSON.stringify(written.body).slice(0, 400)}`).toBe(200);
  const stored = (await loadSlots(m)).document as { pages: Record<string, Array<Record<string, unknown>>> };
  expect(stored.pages.pdp?.find(slot => slot.slot === LAYOUT)?.orders, `${m.host}: P01 — the published revision carries the orders as authored`).toEqual(orders);
}

// ===========================================================================
// unit:P01.O1 — the next decision in that context returns the order
// ===========================================================================

describe('unit:P01.O1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): after a merchandiser publishes an order for a context, the next decision for a shopper in that context returns it position for position, the more specific of two matching orders wins, and a shopper in another context receives hers — with no deployment`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O1 — the declared layout slot (P02) publishes');
      const sarah = await paidSocialFirstVisit(m), dana = await directFirstVisit(m);
      expect(await layoutOf(sarah), `${host}: PRECONDITION — before any order the slot decides its own order`).toEqual(OWN_COLD);
      await publishOrders(m, [{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }, { context: ANY_FIRST, modules: ORDER_C }]);
      expect(await layoutOf(sarah), `${host}: P01.O1 — paid social, first visit: the more specific order, position for position`).toEqual(ORDER_A);
      expect(await layoutOf(dana), `${host}: P01.O1 — direct, first visit: the order published for any channel on a first visit`).toEqual(ORDER_C);
    });
  }
});

// ===========================================================================
// unit:P01.O2 — every other shopper receives the slot's own decision, unchanged
// ===========================================================================

describe('unit:P01.O2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a shopper in another context, one whose visit bucket or channel is unknown and one without personalization consent receive the slot's own decision unchanged, while the shopper in the context receives the order`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O2 — the declared layout slot (P02) publishes');
      const inContext = await paidSocialFirstVisit(m);
      const otherContext = await directFirstVisit(m);
      // No page view: her channel is observed on the snapshot, her visit bucket is unknown.
      const unknownBucket = await shopperOn(m);
      // A page view with no arrival observed: her visit is known, her channel is unknown.
      const unknownChannel = await shopperOn(m);
      expect((await unknownChannel.action(PAGE_VIEW)).status).toBe(200);
      const noPersonalization = await shopperOn(m, { tracking: true, personalization: false });
      expect((await noPersonalization.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status).toBe(200);
      const cases: Array<[string, Shopper, Record<string, string> | undefined]> = [
        ['another context (direct, first visit)', otherContext, undefined],
        ['an unknown visit bucket', unknownBucket, PAID_SOCIAL_ENTRY],
        ['an unknown channel', unknownChannel, undefined],
        ['no personalization consent', noPersonalization, PAID_SOCIAL_ENTRY],
      ];
      const before = new Map<string, string[]>();
      for (const [name, s, entry] of cases) before.set(name, await layoutOf(s, entry));

      await publishOrders(m, [{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }, { context: PAID_SOCIAL_ANY, modules: ORDER_B }]);
      expect(await layoutOf(inContext), `${host}: CONTROL — the shopper in the context receives the order`).toEqual(ORDER_A);
      for (const [name, s, entry] of cases) {
        expect.soft(await layoutOf(s, entry), `${host}: P01.O2 — ${name}: the slot's own decision, unchanged by the order`).toEqual(before.get(name));
      }
      // The order naming ANY visit bucket must not reach the unknown bucket, nor the order naming any channel the unknown channel.
      await publishOrders(m, [{ context: ANY_FIRST, modules: ORDER_C }]);
      expect(await layoutOf(otherContext), `${host}: CONTROL — any channel on a first visit reaches the direct shopper`).toEqual(ORDER_C);
      expect.soft(await layoutOf(unknownChannel), `${host}: P01.O2 — an unknown channel matches no context, not even one naming any channel`).toEqual(before.get('an unknown channel'));
    });

    it(`host (${host}): a shopper on the holdout's default arm and a decision the slot's exploration picks receive the slot's own decision, unchanged by the order published for their context`, async () => {
      for (const [name, learn] of [
        ['the holdout’s default arm', learnDocument({}, { holdout: { share: 1, salt: 'p01-holdout', arms: ['default'] } })],
        ['the slot’s exploration', learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', exploration: { mode: 'rotation', share: 1, floor: 50 } } })],
      ] as const) {
        const m = await mount(host, { ...BASE, learn });
        expectPublished(m, `P01.O2 (${name}) — the declared layout slot (P02) publishes`);
        const s = await paidSocialFirstVisit(m);
        const before = await layoutOf(s);
        await publishOrders(m, [{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }]);
        expect(await layoutOf(s), `${host}: P01.O2 — ${name}: the slot's own decision, unchanged by the order for her context`).toEqual(before);
      }
    });
  }
});

// ===========================================================================
// unit:P01.O3 — a shorter order hides the unlisted modules, without exposure
// ===========================================================================

describe('unit:P01.O3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an order of two modules on a take of four returns only those two, and an unlisted module is neither returned nor counted as an exposure`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O3 — the declared layout slot (P02) publishes');
      const s = await paidSocialFirstVisit(m);
      await publishOrders(m, [{ context: PAID_SOCIAL_FIRST, modules: [M.ugc, M.grid] }]);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p01-o3') });
      expect(servedIn(page, LAYOUT), `${host}: P01.O3 — only the two listed modules, in the order`).toEqual([M.ugc, M.grid]);
      for (const d of page.decisions.filter(x => x.slot === LAYOUT)) {
        const ack = await s.ack(page, d);
        expect(ack.status, `${host}: ${d.contentId} acknowledged: ${JSON.stringify(ack.body).slice(0, 200)}`).toBe(200);
      }
      await m.drainLedger();
      expect(rounded(await learned(m), 'n'), `${host}: P01.O3 — one exposure each for the two drawn modules, none for any unlisted module`).toEqual({ [M.ugc]: 1, [M.grid]: 1 });
    });
  }
});

// ===========================================================================
// unit:P01.O4 — the record and the receipt name the configured order
// ===========================================================================

describe('unit:P01.O4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): every record and receipt of a position the order set names the configured order as the reason, with the context it was published for and the position it set`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O4 — the declared layout slot (P02) publishes');
      const s = await paidSocialFirstVisit(m);
      await publishOrders(m, [{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }]);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p01-o4') });
      expect(servedIn(page, LAYOUT), `${host}: PRECONDITION — the order is served`).toEqual(ORDER_A);
      for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const expected = { context: PAID_SOCIAL_FIRST, modules: ORDER_A };
      const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      expect(records.map(r => [r.position, r.item_id]), `${host}: PRECONDITION — the ledger holds every position the order set`).toEqual(ORDER_A.map((id, i) => [i, id]));
      for (const r of records) {
        expect.soft((r.explain as Record<string, unknown>).configuredOrder, `${host}: P01.O4 — the record of position ${r.position} names the configured order and its context`).toEqual(expected);
      }
      const receipts = (await receiptsOf(m, s.subject)).filter(r => r.slot === LAYOUT).sort((a, b) => Number(a.position) - Number(b.position));
      expect(receipts.map(r => [r.position, r.item]), `${host}: PRECONDITION — a receipt for every position the order set`).toEqual(ORDER_A.map((id, i) => [i, id]));
      for (const r of receipts) {
        expect.soft(r.configuredOrder, `${host}: P01.O4 — the receipt of position ${String(r.position)} names the configured order and its context`).toEqual(expected);
        expect.soft((r.why as string[]).some(sentence => /configured order/i.test(sentence)),
          `${host}: P01.O4 — and says in words that the configured order placed it (why: ${JSON.stringify(r.why)})`).toBe(true);
      }
    });
  }
});

// ===========================================================================
// unit:P01.O5 — publication refuses every order it cannot serve exactly
// ===========================================================================

describe('unit:P01.O5', () => {
  it('host: the slots route refuses, with an error naming the offending value and without writing a revision, an unregistered or repeated module, a context outside the vocabulary, two orders for one context, two contexts of equal specificity, an order on a slot that is not the declared layout slot, and an order that contradicts the slot’s pins or exclusions', async () => {
    const m = await mount('session', BASE);
    expectPublished(m, 'P01.O5 — the declared layout slot (P02) publishes');
    const pinned = (orders: unknown[]) => declaredSlots([layoutSlot({ pinnedPieceIds: [M.grid], orders }), recentSlot()]);
    // The positive control: valid orders, including one under the slot's pin, publish.
    const valid = await putSlots(m, pinned([{ context: PAID_SOCIAL_FIRST, modules: [M.grid, M.reco2, M.reco1] }, { context: ANY_FIRST, modules: [M.grid, M.ugc] }]));
    expect(valid.status, `P01.O5 — CONTROL: orders that keep the pin and name registered modules publish: ${JSON.stringify(errorsOf(valid))}`).toBe(200);
    const revision = (await loadSlots(m)).revision;

    const refusals: Array<[string, unknown, string]> = [
      ['an unregistered module', withOrders([{ context: PAID_SOCIAL_FIRST, modules: [M.grid, 'module.PDP.unregistered.9'] }]), 'module.PDP.unregistered.9'],
      ['a repeated module', withOrders([{ context: PAID_SOCIAL_FIRST, modules: [M.grid, M.reco1, M.grid] }]), M.grid],
      ['a channel outside the six words', withOrders([{ context: { channel: 'tiktok', visitBuckets: ['1'] }, modules: [M.grid] }]), 'tiktok'],
      ['the unknown channel', withOrders([{ context: { channel: 'unknown', visitBuckets: ['1'] }, modules: [M.grid] }]), 'unknown'],
      ['a visit bucket outside the buckets', withOrders([{ context: { channel: 'email', visitBuckets: ['5'] }, modules: [M.grid] }]), '5'],
      ['two orders for one context', withOrders([{ context: PAID_SOCIAL_FIRST, modules: [M.grid] }, { context: PAID_SOCIAL_FIRST, modules: [M.reco1] }]), 'paid_social'],
      ['two contexts of equal specificity matching one shopper', withOrders([{ context: PAID_SOCIAL_ANY, modules: [M.grid] }, { context: ANY_FIRST, modules: [M.reco1] }]), 'any'],
      ['an order on a slot that is not the declared layout slot',
        declaredSlots([layoutSlot(), recentSlot({ orders: [{ context: PAID_SOCIAL_FIRST, modules: [M.recent] }] })]), 'pdp-recent'],
      ['an order listing an excluded module', withOrders([{ context: PAID_SOCIAL_FIRST, modules: [M.grid, M.reviews] }]), M.reviews],
      ['an order that moves the pinned module', pinned([{ context: PAID_SOCIAL_FIRST, modules: [M.reco1, M.grid] }]), M.grid],
    ];
    const outcomes: Array<{ case: string; status: number; named: boolean; errors: string[] }> = [];
    for (const [name, document, offending] of refusals) {
      const answer = await putSlots(m, document, name);
      const errors = errorsOf(answer);
      outcomes.push({ case: name, status: answer.status, named: errors.some(e => e.includes(offending) && /orders/.test(e)), errors });
    }
    expect(outcomes.map(o => ({ case: o.case, status: o.status, named: o.named })),
      `P01.O5 — each is refused (422) with an error that names the orders and the offending value: ${JSON.stringify(outcomes.map(o => [o.case, o.errors]))}`)
      .toEqual(refusals.map(([name]) => ({ case: name, status: 422, named: true })));
    expect((await loadSlots(m)).revision, 'P01.O5 — and no refused document wrote a revision').toBe(revision);
  });
});

// ===========================================================================
// unit:P01.O6 — the console edits, validates and saves an order
// ===========================================================================

describe('unit:P01.O6', () => {
  it('sdk: on the shipped slot-rules screen of the declared layout slot an operator authors a per-context order, the screen validates and saves it through the mounted route, the saved revision serves it, and a draft repeating a module disables the save and sends nothing', async () => {
    const m = await mount('session', BASE);
    expectPublished(m, 'P01.O6 — the declared layout slot (P02) publishes');
    const c = await openConsole(m, `#/rules?scope=${TENANT}&slot=${LAYOUT}`);
    try {
      expect(c.text(), 'PRECONDITION: the rules screen is reading the declared layout slot').toContain(`${LAYOUT} on pdp`);
      const orders = [{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }];
      expect(await c.type('layout.orders', JSON.stringify(orders)),
        'P01.O6 — the slot-rules screen of a declared layout slot renders a per-context order editor ([data-focus-key="layout.orders"])').toBe(true);
      expect(c.$('save')?.disabled, 'P01.O6 — a valid order leaves the save available').toBe(false);
      await c.save();
      expect(c.puts().length, 'P01.O6 — the console saved the order through PUT /content/slots').toBe(1);
      const stored = (await loadSlots(m)).document as { pages: Record<string, Array<Record<string, unknown>>> };
      expect(stored.pages.pdp?.find(slot => slot.slot === LAYOUT)?.orders, 'P01.O6 — the platform stored exactly the order the operator authored').toEqual(orders);
      const s = await paidSocialFirstVisit(m);
      expect(await layoutOf(s), 'P01.O6 — and the saved revision serves it to a shopper in that context').toEqual(ORDER_A);

      const putsBefore = c.puts().length;
      await c.type('layout.orders', JSON.stringify([{ context: PAID_SOCIAL_FIRST, modules: [M.grid, M.grid] }]));
      expect(c.$('save')?.disabled, 'P01.O6 — a draft that repeats a module disables the save').toBe(true);
      c.$('save')?.click();
      await c.settle();
      expect(c.puts().length, 'P01.O6 — and sends no PUT').toBe(putsBefore);
      expect(c.text(), 'P01.O6 — the refusal is on the screen').toContain('This change cannot be saved');
    } finally { c.close(); }
  }, 90_000);
});

// ===========================================================================
// unit:P01.O7 — replay under an order; a retained document as before
// ===========================================================================

describe('unit:P01.O7', () => {
  const replaysEqual = async (m: Mounted, host: Host, s: Shopper, expected: string[]) => {
    const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p01-o7') });
    expect(servedIn(page, LAYOUT), `${host}: PRECONDITION — the decision under test`).toEqual(expected);
    for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
    await m.drainLedger();
    const stored = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT);
    expect(stored.map(r => r.item_id).sort(), `${host}: PRECONDITION — the ledger holds the four decisions`).toEqual([...expected].sort());
    const replays = [];
    for (const r of stored) {
      const replay = await replayOf(m, r.decision_id);
      replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
    }
    return replays;
  };
  for (const host of HOSTS) {
    it(`host (${host}): every decision served under a configured order replays equal from its record`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O7 — the declared layout slot (P02) publishes');
      const s = await paidSocialFirstVisit(m);
      await publishOrders(m, [{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }]);
      const replays = await replaysEqual(m, host, s, ORDER_A);
      expect(replays, `${host}: P01.O7 — each position the order set replays equal`).toEqual(replays.map(([id]) => [id, 200, 'equal']));
    });

    it(`host (${host}): a retained declared slots document without orders decides the slot's own decision and replays equal`, async () => {
      const m = await mount(host, { ...BASE, retainedSlots: true });
      expectPublished(m, 'P01.O7 — the retained declared slots document (P02, governanceVersion 4) reads');
      const s = await paidSocialFirstVisit(m);
      const replays = await replaysEqual(m, host, s, OWN_COLD);
      expect(replays, `${host}: P01.O7 — the retained document decides and replays as before`).toEqual(replays.map(([id]) => [id, 200, 'equal']));
    });
  }
});
