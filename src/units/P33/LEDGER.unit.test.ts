// src/units/P33/LEDGER.unit.test.ts
// P33 under the Closure Ledger: the tests for the LOCAL criteria of the P33 work
// order (`tapestry-parity-build`, ticket P33 "Where a page conversion lands").
// DC1 (decision D1) is ruled here and exercised inside K1-K5; LV1 and LV2 are
// deferred live rows and get no test.
//
// One `describe('unit:P33.<criterion> …')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P33 in section E): "under
//     the chosen policy, an add to bag or purchase that originates inside a
//     module credits that module's layout decision; a buy-box conversion credits
//     the layout according to the policy (module-tied only; …), itemised on the
//     outcome record; the attribution policy can differ per slot";
//   · freeze sheet item 11 (D1: "A per-slot attribution policy with module-tied
//     credit only, absent by default; shared or last-engaged credit only if
//     their data science asks later"), UNANSWERED at the freeze: every unit
//     names it (R-P15);
//   · the investigation, section G-B ("The objective", option A: "module-tied
//     credit only, where conversions made inside a module carry its decision id
//     and buy-box conversions do not train the layout") and G-A (the events);
//   · the existing contract: src/learn/policy.ts (one brand-wide policy: `direct`
//     credits a decision the event names, its item or a product it features;
//     `any` credits one decision per slot), src/ledger/records.ts (the outcome
//     record), the offline recomputation POST /v1/:tenant/learn/generation
//     { slot, brand, rebuildFrom } (W24 T1.02, src/durable-objects/LearnStats.ts
//     rebuildFromLedger, which folds the retained day under the published learn
//     document).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   The per-slot policy is `attribution: 'module-tied'` on a slot's learn dials;
//   absent, the slot is credited under the brand-wide `policy` exactly as today;
//   any other value is refused naming `attribution`. An add to bag ORIGINATES
//   INSIDE A MODULE when it carries the module's `decisionId`, or the module's
//   identifier as `contentId` with the page view's `pageInstance`; a buy-box add
//   to bag names only the product. The layout slot learns against add_to_bag.
//   The itemisation lives on the DERIVED ATTRIBUTION RECORD the visitor's ring
//   produces when it credits the outcome (R-P35): the credit receipt of the
//   credit plan the ring keeps (DecisionRing `creditPlan:<digest>`, `plan.receipt`)
//   carries `attribution: [{ slot, policy, credited }]` with an entry for every
//   slot whose learn dials name module-tied: `policy` is 'module-tied' and
//   `credited` the decision identifiers it credited ([] when none), the same
//   decisions its credit effects (`plan.batches`) carry. The stored outcome
//   record is the admitted source and never changes after capture
//   (src/ledger/recovery.ts:166, :336, :348); it is not read for the
//   itemisation. No public route answers the credit receipt: K3 reads the
//   ring's own stored plan, which the real DecisionRing class wrote (a named
//   residual). Credits are read from the statistics objects' counters (`s`),
//   online and after the offline recomputation rebuilds the slot from the ledger.
//   The brand-wide policy of K2 and K4 is `any`, so that today's behaviour
//   (one decision per slot, whichever module) is distinguishable from
//   module-tied credit; K1 and K3 use the shipped `direct`.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `attribution` in the learn document's slot dials and on the ring's credit
// receipt. No new export is imported.
//
// PRECONDITIONS (R-P6): every host leg needs P02 (a declared layout slot,
// governance 4) and fails first with a message labelled PRECONDITION P02.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts).

import { describe, expect, it } from 'vitest';

import {
  asOperator, BRAND, declaredSlots, errorsOf, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, loadDocument, M, MODULES, mount,
  PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf, putDocument, readTree, recentSlot, rounded, storedOutcomes, TENANT, type Mounted, type Shopper, type Snapshot,
  shopperOn,
} from '../_parity';

const STORY = 'pdp-story';
/** COA-CW620, the quilted Tabby: featured by complete-the-look (reco.2), so the shipped `direct` policy credits reco.2 for buying it. */
const BAG = 'COA-CW620';
const PIECES = [
  ...MODULES.map(m => (m.id === M.reco2 ? { ...m, featuredProductIds: [BAG] } : m)),
  { id: 'story.tabby', customerContentId: 'TAP-STORY-TABBY', type: 'editorial', title: 'The Tabby story', tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' } },
];
const SLOTS = declaredSlots([layoutSlot(), recentSlot(), { slot: STORY, take: 1, weights: { line: 1 } }]);
const WINDOWS = { click: 1_800_000, dwell: 1_800_000, video_complete: 1_800_000, wishlist: 21_600_000, add_to_bag: 21_600_000, purchase: 604_800_000, custom: 1_800_000 };
const ANY = { policy: { scope: 'session', match: 'any', credit: 'last', windowsMs: WINDOWS } };
const learnWith = (layout: Record<string, unknown>, extra: Record<string, unknown> = {}) => learnDocument({
  [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'add_to_bag', ...layout },
  [STORY]: { measurementBasis: 'rendered-v1', reward: 'add_to_bag' },
}, extra);
const MODULE_TIED = { attribution: 'module-tied' };
const precondition = (m: Mounted, ticket: string) => expectPublished(m, `${ticket} — PRECONDITION P02: the page's declared layout slot (governance 4) publishes`);
const LAYOUT_ITEMS = new Set<string>(Object.values(M));
const layoutCredits = (credits: Record<string, number>) => Object.fromEntries(Object.entries(credits).filter(([item]) => LAYOUT_ITEMS.has(item)));
const storyCredits = (credits: Record<string, number>) => Object.fromEntries(Object.entries(credits).filter(([item]) => item.startsWith('story.')));

/**
 * A cold shopper's page through the route (grid.1, reco.1, reco.2, editorial.1 on the layout), the decisions of the named slots
 * acknowledged as rendered. The layout is first on the page, so its page-wide order is its position in the slot; a content slot
 * below it is admitted only once render admission accepts the page-wide position (P03, R-P2), so its acknowledgement is P03's precondition.
 */
async function renderedPage(m: Mounted, label: string, slots: string[] = [LAYOUT]): Promise<{ s: Shopper; page: Snapshot }> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: the shopper's page view is accepted`).toBe(200);
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `${m.host}: the shopper's page is answered: ${JSON.stringify(page.body).slice(0, 300)}`).toBe(200);
  for (const d of page.decisions.filter(x => slots.includes(x.slot))) {
    expect((await s.ack(page, d)).status, d.slot === LAYOUT ? `${m.host}: ${d.contentId} acknowledged` : `${m.host}: PRECONDITION P03 — ${d.contentId} on ${d.slot} is acknowledged at its page-wide position`).toBe(200);
  }
  return { s, page };
}
const addToBag = (s: Shopper, data: Record<string, unknown>) =>
  s.action({ type: 'add_to_cart', data: { productId: BAG, price: 575, currency: 'USD', quantity: 1, brand: BRAND, ...data } });
const decisionOf = (page: Snapshot, id: string) => page.decisions.find(d => d.contentId === id);

/**
 * The derived attribution records of one visitor (R-P35): every credit plan the visitor's ring keeps in its own storage, as the
 * real DecisionRing class wrote it when it credited an outcome, in outcome order: the credit receipt, and per slot the decisions
 * its credit effects carry.
 */
function creditRecordsOf(m: Mounted, visitorId: string): Array<{ ts: number; receipt: Record<string, unknown>; effects: Record<string, string[]> }> {
  const out: Array<{ ts: number; receipt: Record<string, unknown>; effects: Record<string, string[]> }> = [];
  for (const ring of m.rings.values()) for (const [key, value] of ring.data) {
    if (!key.startsWith('creditPlan:')) continue;
    const saved = value as { subject?: string; ts?: number; plan?: { receipt?: Record<string, unknown>;
      batches?: Array<{ body?: { slot?: string; credits?: Array<{ decision_id?: string }> } | null }> } };
    if (saved.subject !== visitorId) continue;
    const effects: Record<string, string[]> = {};
    for (const batch of saved.plan?.batches ?? []) {
      const slot = batch.body?.slot;
      if (slot) effects[slot] = [...(effects[slot] ?? []), ...(batch.body?.credits ?? []).map(c => String(c.decision_id))];
    }
    out.push({ ts: Number(saved.ts), receipt: saved.plan?.receipt ?? {}, effects });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** The offline recomputation: the slot rebuilt from today's retained ledger, then its counters read. */
async function rebuilt(m: Mounted, slot: string): Promise<Record<string, number>> {
  const date = new Date().toISOString().slice(0, 10);
  const answer = await asOperator(m, 'POST', `/v1/${TENANT}/learn/generation`, { slot, brand: BRAND, rebuildFrom: date });
  expect(answer.status, `${m.host}: PRECONDITION — the offline recomputation rebuilds ${slot} from the retained day: ${JSON.stringify(answer.body).slice(0, 300)}`).toBe(200);
  return rounded(await learned(m), 's');
}

// ===========================================================================
// unit:P33.K1 — no per-slot policy: the brand-wide policy, exactly as today (LOCK)
// ===========================================================================

describe('unit:P33.K1 (freeze item 11)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a layout slot with no policy of its own is credited under the brand-wide policy exactly as the same slot undeclared, online and in the offline recomputation`, async () => {
      const credits: Record<string, unknown> = {};
      const undeclared = { version: 'parity-p33-undeclared', governanceVersion: 3,
        pages: { pdp: [{ ...layoutSlot(), layout: undefined }, recentSlot(), { slot: STORY, take: 1, weights: { line: 1 } }].map(x => JSON.parse(JSON.stringify(x))) } };
      for (const [name, slots, retainedSlots] of [['undeclared', undeclared, true], ['declared', SLOTS, false]] as const) {
        const m = await mount(host, { pieces: PIECES, slots, retainedSlots, learn: learnWith({}) });
        if (name === 'declared') precondition(m, 'P33.K1'); else expectPublished(m, 'P33.K1 — the undeclared retained slots document reads');
        const { s, page } = await renderedPage(m, `p33-k1-${name}`);
        expect((await addToBag(s, { decisionId: decisionOf(page, M.reco1)?.decisionId, slot: LAYOUT })).status, `${host}: the add to bag inside reco.1 is accepted`).toBe(200);
        expect((await addToBag(s, {})).status, `${host}: the buy-box add to bag is accepted`).toBe(200);
        await m.drainLedger();
        const online = rounded(await learned(m), 's');
        credits[name] = { online, offline: await rebuilt(m, LAYOUT) };
      }
      expect((credits.declared as { online: unknown }).online, `${host}: CONTROL — under the shipped direct policy the buy-box add to bag credits reco.2, which features the bag`)
        .toMatchObject({ [M.reco2]: 1 });
      expect(credits.declared, `${host}: P33.K1 — term for term the credits of the same events on the slot as it is today, online and offline`).toEqual(credits.undeclared);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P33.K2 — module-tied: a conversion inside a module credits that module's decision once
// ===========================================================================

describe('unit:P33.K2 (freeze item 11)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): under the module-tied policy an add to bag carrying reco.2's decision identifier, and one carrying reco.2's module identifier from that page view, each credit reco.2's layout decision once and no other module`, async () => {
      for (const [name, data] of [
        ['the decision identifier', (page: Snapshot) => ({ decisionId: decisionOf(page, M.reco2)?.decisionId, slot: LAYOUT })],
        ['the module identifier and the page view', (page: Snapshot) => ({ contentId: M.reco2, slot: LAYOUT, pageInstance: page.pageInstance })],
      ] as const) {
        const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: learnWith(MODULE_TIED, ANY) });
        precondition(m, 'P33.K2');
        const { s, page } = await renderedPage(m, 'p33-k2');
        expect(decisionOf(page, M.reco2)?.decisionId, `${host}: PRECONDITION — reco.2 is served with a receipt`).toBeTruthy();
        expect((await addToBag(s, data(page))).status, `${host}: the add to bag carrying ${name} is accepted`).toBe(200);
        await m.drainLedger();
        expect(layoutCredits(rounded(await learned(m), 's')), `${host}: P33.K2 — carrying ${name}: reco.2's layout decision is credited once, no other module`).toEqual({ [M.reco2]: 1 });
      }
    }, 90_000);
  }
});

// ===========================================================================
// unit:P33.K3 — module-tied: a conversion naming no module credits none, and its attribution record says so (R-P35)
// ===========================================================================

describe('unit:P33.K3 (freeze item 11)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): under the module-tied policy a buy-box add to bag credits no layout decision, even of the module featuring the bag, and the attribution record the ring derives for each outcome itemises the policy and the decisions it credited or that it credited none`, async () => {
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: learnWith(MODULE_TIED) });
      precondition(m, 'P33.K3');
      const { s, page } = await renderedPage(m, 'p33-k3');
      const reco1 = decisionOf(page, M.reco1)?.decisionId;
      expect((await addToBag(s, {})).status, `${host}: the buy-box add to bag is accepted`).toBe(200);
      await m.drainLedger();
      expect(layoutCredits(rounded(await learned(m), 's')), `${host}: P33.K3 — the buy-box add to bag credits no layout decision (the shipped direct policy would credit reco.2, which features the bag)`).toEqual({});
      expect((await addToBag(s, { decisionId: reco1, slot: LAYOUT })).status, `${host}: the add to bag inside reco.1 is accepted`).toBe(200);
      await m.drainLedger();
      expect(storedOutcomes(m, s.subject).length, `${host}: PRECONDITION — both outcome records are stored`).toBe(2);
      const records = creditRecordsOf(m, s.subject);
      expect(records.length, `${host}: PRECONDITION — the ring derived one attribution record (credit plan) for each of the two outcomes`).toBe(2);
      const layoutEntry = (r: { receipt: Record<string, unknown> }) => ((r.receipt.attribution ?? []) as Array<Record<string, unknown>>).find(e => e.slot === LAYOUT)
        ?? `no attribution entry for ${LAYOUT} on the credit receipt (attribution: ${JSON.stringify(r.receipt.attribution ?? null)})`;
      expect(records.map(layoutEntry), `${host}: P33.K3 — the buy-box outcome's credit receipt names module-tied and credited none; the module outcome's names module-tied and reco.1's decision`)
        .toEqual([{ slot: LAYOUT, policy: 'module-tied', credited: [] }, { slot: LAYOUT, policy: 'module-tied', credited: [reco1] }]);
      expect(records.map(r => r.effects[LAYOUT] ?? []), `${host}: P33.K3 — the ring's credit effects on the layout agree with the itemisation: none for the buy-box, reco.1's decision for the module`)
        .toEqual([[], [reco1]]);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P33.K4 — one outcome, two slots, two policies
// ===========================================================================

describe('unit:P33.K4 (freeze item 11)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): one buy-box add to bag on a page with a module-tied layout and a content slot under the brand-wide any policy credits the content slot's decision and no layout decision`, async () => {
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: learnWith(MODULE_TIED, ANY) });
      precondition(m, 'P33.K4');
      const { s, page } = await renderedPage(m, 'p33-k4', [LAYOUT, STORY]);
      expect(decisionOf(page, 'story.tabby')?.decisionId, `${host}: PRECONDITION — the content slot is served with a receipt`).toBeTruthy();
      expect((await addToBag(s, {})).status, `${host}: the buy-box add to bag is accepted`).toBe(200);
      await m.drainLedger();
      const credits = rounded(await learned(m), 's');
      expect([storyCredits(credits), layoutCredits(credits)], `${host}: P33.K4 — the content slot is credited under any; the module-tied layout is not`).toEqual([{ 'story.tabby': 1 }, {}]);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P33.K5 — refusals; online and offline agree; the kit
// ===========================================================================

describe('unit:P33.K5 (freeze item 11)', () => {
  it('host: publication refuses, with an error naming the attribution, a per-slot policy other than module-tied, writing no revision, and admits and keeps module-tied', async () => {
    const m = await mount('session', { pieces: PIECES, slots: SLOTS, learn: learnWith({}) });
    precondition(m, 'P33.K5');
    const admitted = await putDocument(m, 'learn', learnWith(MODULE_TIED), 'p33 module-tied');
    expect(admitted.status, `P33.K5 — CONTROL: module-tied on the layout slot publishes: ${JSON.stringify(errorsOf(admitted))}`).toBe(200);
    const kept = (await loadDocument(m, 'learn')).document as { slots?: Record<string, Record<string, unknown>> };
    expect(kept.slots?.[LAYOUT]?.attribution, 'P33.K5 — the published learn document keeps the per-slot policy').toBe('module-tied');
    const revision = (await loadDocument(m, 'learn')).revision;
    const outcomes: unknown[][] = [];
    for (const policy of ['shared', 'shared-by-position', 'last-engaged', 'any', 'direct']) {
      const answer = await putDocument(m, 'learn', learnWith({ attribution: policy }), `p33 ${policy}`);
      outcomes.push([policy, answer.status, errorsOf(answer).some(e => /attribution/.test(e))]);
    }
    expect(outcomes, 'P33.K5 — every per-slot policy other than module-tied is refused (422) naming attribution').toEqual(['shared', 'shared-by-position', 'last-engaged', 'any', 'direct'].map(p => [p, 422, true]));
    expect((await loadDocument(m, 'learn')).revision, 'P33.K5 — and no refused document wrote a revision').toBe(revision);
  }, 60_000);

  for (const host of HOSTS) {
    it(`host (${host}): online credit and the offline recomputation agree on the module-tied cases: the decision identifier, the module identifier, the buy-box and the mixed page`, async () => {
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: learnWith(MODULE_TIED, ANY) });
      precondition(m, 'P33.K5');
      const first = await renderedPage(m, 'p33-k5-a', [LAYOUT, STORY]);
      await addToBag(first.s, { decisionId: decisionOf(first.page, M.reco1)?.decisionId, slot: LAYOUT });
      const second = await renderedPage(m, 'p33-k5-b', [LAYOUT, STORY]);
      await addToBag(second.s, { contentId: M.editorial, slot: LAYOUT, pageInstance: second.page.pageInstance });
      const third = await renderedPage(m, 'p33-k5-c', [LAYOUT, STORY]);
      await addToBag(third.s, {});
      await m.drainLedger();
      const online = rounded(await learned(m), 's');
      expect(layoutCredits(online), `${host}: P33.K5 — online: reco.1 and editorial.1 once each, nothing for the buy-box`).toEqual({ [M.reco1]: 1, [M.editorial]: 1 });
      expect(Object.keys(storyCredits(online)), `${host}: PRECONDITION — online, the content slot under any is credited`).toEqual(['story.tabby']);
      const offlineLayout = layoutCredits(await rebuilt(m, LAYOUT));
      const offlineStory = storyCredits(await rebuilt(m, STORY));
      expect([offlineLayout, offlineStory], `${host}: P33.K5 — the offline recomputation credits the layout and the content slot exactly as online did`).toEqual([layoutCredits(online), storyCredits(online)]);
    }, 120_000);
  }

  it('logic: the API reference and the payload schemas each document the per-slot policy and the itemisation on the attribution record derived when the outcome is credited', () => {
    const sentences = (file: string) => readTree(file).replace(/`/g, '').split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(s => s.replace(/\s+/g, ' ').trim());
    const statements: Array<[string, (s: string) => boolean]> = [
      ['attribution: module-tied, a per-slot policy, absent by default', s => /attribution/.test(s) && /module-tied/.test(s) && /(absent|default)/i.test(s)],
      ['a buy-box conversion credits no layout decision under module-tied', s => /module-tied/.test(s) && /(buy-box|names no module|no module)/i.test(s)],
      ['the attribution record derived when an outcome is credited (its credit receipt) itemises the policy and the decisions credited', s => /attribution/.test(s) && /(receipt|attribution record)/i.test(s) && /credited/i.test(s)],
    ];
    const missing = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']
      .flatMap(file => statements.filter(([, test]) => !sentences(file).some(test)).map(([name]) => `${file}: ${name}`));
    expect(missing, 'P33.K5 — the kit documents the per-slot policy and the itemisation').toEqual([]);
  });
});
