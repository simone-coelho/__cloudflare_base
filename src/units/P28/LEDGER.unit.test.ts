// src/units/P28/LEDGER.unit.test.ts
// P28 under the Closure Ledger: the tests for the LOCAL criteria of the P28 work
// order (`tapestry-parity-build`, ticket P28 "Layout base and the
// behaviour-and-performance blend"). DC1 (decision D1) is ruled here and
// exercised inside B1-B3; LV1 and LV2 are deferred live rows and get no test.
// The work order's fourth remaining-work item (the kit sentences) belongs to no
// LOCAL criterion and is closed by the reviewer reading the sentences.
//
// One `describe('unit:P28.<criterion> …')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P28 in section E): "on a
//     layout slot, a module with no behaviour score is moved by learned
//     performance once p > 0; at p = 0 the served order equals the configured or
//     catalogue order term for term, and every shopper term on the receipt is
//     zero; the receipt itemises behaviour, performance and the blend; content
//     slots are unchanged (W16.C7 'an exactly zero base stays zero' still holds
//     there)";
//   · freeze sheet item 8 (D1: "Opt-in per layout slot: score = R + (1 − p) × B
//     + p × Q, where R = (M − i) / M is the rank base from the configured order,
//     B the pre-lift behaviour score, Q the clamped lift minus one; p defaults to
//     0; content slots unchanged. The 'p = 0 serves your order exactly' promise
//     holds when the layout weights no shopper dimension") and item 34 ("The rank
//     base counts positions from 0, so the first module's R is 1"). Both items
//     are UNANSWERED at the freeze: every unit names them in its title (R-P15);
//     the P28 LIVE2 row names the path for a different arithmetic;
//   · lead ruling R-P13: the opt-in member is `blend.p` on the slot's learn dials,
//     with the item-8 arithmetic over M eligible baseline modules, exactly as
//     src/units/P06/LEDGER.unit.test.ts (S2 branch, unit:P06.S2) assumed;
//   · the investigation, section G-B (C1, C4, design question 2);
//   · the existing contract: src/content/decide.ts (base × lift^γ, the frozen
//     lift applied through γ), src/learn/stats.ts (the lift clamped to
//     liftMin 0.5 and liftMax 2 by default; the finest level reaching nMin
//     answers), unit:W16.C7.01 (an exactly zero base stays zero).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   The opt-in is `blend: { p }` on the declared layout slot's learn dials
//   (R-P13; P06's `shadowP` sits beside it). M is the number of eligible
//   baseline modules: the configured order for the shopper's context (P01),
//   else the slot's eligible modules in catalogue order (P04's baseline). Here
//   that is grid.1, reco.1, reco.2, editorial.1, ugc.1 (reviews.1 excluded,
//   lookbook.1 expired, recent.1 reserved by the recently-viewed slot's pin,
//   charms.1 outside its window), so M = 5 and R = 1, 0.8, 0.6, 0.4, 0.2.
//   Under a configured order (R-P40, R-P41) M is the number of listed modules
//   still eligible after the C7 removals and i their position among them. The
//   order this file publishes for the shopper's context (paid social, first
//   visit) lists editorial.1, ugc.1, grid.1, reco.2: the slot's take, since P01
//   refuses an order longer than the take (src/content/kinds.ts validateOrders;
//   docs/kit/03-payload-schemas.md). So M = 4 and R = 1, 0.75, 0.5, 0.25, and
//   reco.1 is unlisted. B1's third leg lists the expired lookbook.1 among the
//   four: P01 passes it over and never replaces it, three positions are
//   served, and M = 3 (R = 1, 2/3, 1/3). At p 0 with no dimension weighted the
//   order is served exactly (B1); at p above 0 the listed modules are re-ranked by
//   R + (1 − p) × B + p × Q and an unlisted module stays hidden (B2; P01 O3,
//   freeze item 17); a slot that does not opt in serves the order exactly as
//   P01 built it (B4; R-P7, R-P34).
//   B is the pre-lift behaviour score; Q is the clamped lift minus one, 0 where
//   no level answers. Every record of an opted-in slot carries
//   `explain.blend: { R, B, Q, p }`, and every receipt `blend: { R, B, Q, p }`.
//   Learned lifts are built through the real fan-in and the real crediting
//   ring (src/units/_parity4.ts `learnedLift`); B3 and B4's first leg use a
//   merchandiser's frozen lift where only the itemisation or the content slot
//   is under test.
//   R-P43 (fix round 2): B5 holds the replay of a blended decision, under the
//   configured order and under catalogue order, and the holdout's default arm
//   carrying no blend; B2 holds the lower clamp on a merchandiser's frozen lift.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `blend: { p }` in the learn document's slot dials, `explain.blend` on the
// record, `blend` on the receipt. No new export is imported.
//
// PRECONDITIONS (R-P6): every host leg needs P02 (a declared layout slot,
// governance 4); the configured-order legs of B1, B2 and B4 also need P01
// (`orders`). Each fails first with a message labelled PRECONDITION naming the
// ticket.
//
// HARNESS: src/units/_parity.ts and src/units/_parity4.ts.

import { describe, expect, it } from 'vitest';

import type { DecisionRecord } from '@/content/types';

import {
  declaredSlots, errorsOf, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, loadDocument, loadSlots, M, MODULES, mount,
  PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf, putDocument, receiptsOf, recentSlot, replayOf, rounded, servedIn, servePage, shopperOn,
  storedDecisions, TABBY_VIEWS, toLedger, type Mounted, type Shopper,
} from '../_parity';
import { learnedLift, publishGlobalTrend } from '../_parity4';

/** The eligible baseline in catalogue order, M = 5, and its rank base R = (M − i) / M with i from 0 (items 8 and 34). */
const ELIGIBLE = [M.grid, M.reco1, M.reco2, M.editorial, M.ugc];
const R_OF = (order: string[]) => Object.fromEntries(order.map((id, i) => [id, (order.length - i) / order.length]));
const CATALOGUE_R = R_OF(ELIGIBLE);
/** A module that was served on this page once and is retired from the catalogue: its evidence still counts in the slot's own rate. */
const RETIRED = 'module.PDP.retired.1';
const LADDER_CELL = { channel: 'paid_social', visit_bucket: '1' as const, region: null, affinity: null, stage: 'mid' as const };
/** R-P40: the configured order for the shopper's context (paid social, first visit) lists four modules, the layout's take, and leaves reco.1 unlisted; R = (4 − i)/4 from it (R-P41). B1, B2 and B4 publish this one order. */
const CONFIGURED = [M.editorial, M.ugc, M.grid, M.reco2];
const ORDERS = [{ context: { channel: 'paid_social', visitBuckets: ['1'] }, modules: CONFIGURED }];
/**
 * ugc.1's ladder as B2's first leg builds it (20 clicks in 40 exposures), and the same ladder for the unlisted reco.1, so a blend that
 * admitted an unlisted module would serve it: against a slot rate of 40 in 280 each lift is beyond liftMax 2, so Q = 1.
 */
const BEYOND_THE_CLAMP = [{ item: M.ugc, exposures: 40, successes: 20 }, { item: M.reco1, exposures: 40, successes: 20 }, { item: RETIRED, exposures: 200, successes: 0 }];

const SLOTS = declaredSlots([layoutSlot(), recentSlot()]);
const blendOf = (r: { explain?: unknown } | undefined) => ((r?.explain ?? {}) as Record<string, unknown>).blend as Record<string, number> | undefined;
const precondition = (m: Mounted, ticket: string) => expectPublished(m, `${ticket} — PRECONDITION P02: the page's declared layout slot (governance 4) publishes`);

async function tabby(m: Mounted, entry: Record<string, string> = PAID_SOCIAL_ENTRY): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, entry)).status, `${m.host}: the shopper's page view is accepted`).toBe(200);
  for (const view of TABBY_VIEWS) expect((await s.action(view)).status, `${m.host}: the shopper's view is accepted`).toBe(200);
  return s;
}
/** A shopper with no interest at all: every module's behaviour score is 0. */
async function cold(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: the shopper's page view is accepted`).toBe(200);
  return s;
}
/** The shopper's page through the route, every layout module acknowledged, and the records the real consumer stored for that page. */
async function pageRecords(m: Mounted, s: Shopper, label: string) {
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label), entry: PAID_SOCIAL_ENTRY });
  expect(page.status, `${m.host}: the shopper's page is answered: ${JSON.stringify(page.body).slice(0, 300)}`).toBe(200);
  for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `${m.host}: ${d.contentId} acknowledged`).toBe(200);
  await m.drainLedger();
  const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT && page.decisions.some(d => d.decisionId === r.decision_id))
    .sort((a, b) => a.position - b.position);
  return { served: servedIn(page, LAYOUT), records, page };
}
/**
 * R-P41's fixture: the configured order published on the layout slot, ugc.1's
 * learned lift beyond the upper clamp (as B2's first leg builds it), then a cold
 * shopper's page in the order's context, one layer in. The layout records in
 * position order.
 */
async function underTheOrder(m: Mounted, ticket: string) {
  precondition(m, ticket);
  const stored = (await loadSlots(m)).document as { pages: Record<string, Array<Record<string, unknown>>> };
  expect(stored.pages.pdp?.find(slot => slot.slot === LAYOUT)?.orders, `${m.host}: PRECONDITION P01 — the published layout slot keeps its per-context order`).toEqual(ORDERS);
  await learnedLift(m, LAYOUT, BEYOND_THE_CLAMP, LADDER_CELL);
  expect([rounded(await learned(m), 'n')[M.ugc], rounded(await learned(m), 's')[M.ugc]], `${m.host}: PRECONDITION — ugc.1's exposures and clicks are learned`).toEqual([40, 20]);
  const set = await servePage(m, await cold(m), 'pdp', { entry: PAID_SOCIAL_ENTRY });
  const layout = set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
  const ugc = layout.find(r => r.item_id === M.ugc);
  expect([layout[0]?.cell.channel, layout[0]?.cell.visit_bucket, ugc?.explain.lift?.lift],
    `${m.host}: PRECONDITION — the shopper is in the order's context (paid social, first visit) and ugc.1's learned lift at the answering level is the upper clamp, 2`)
    .toEqual(['paid_social', '1', 2]);
  return { set, layout };
}

// ===========================================================================
// unit:P28.B1 — at p 0, on a layout that weights no shopper dimension, the configured order else catalogue order, term for term
// ===========================================================================

describe('unit:P28.B1 (freeze items 8 and 34)', () => {
  /** The layout weights no dimension (each weight 0) and sets no stage, freshness, fatigue or merchandising term; its seed rule names a dimension weighted at 0. */
  const ZERO_WEIGHTS = { line: 0, category: 0, occasion: 0 };
  const SEED = [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'line', value: 'Tabby' }], weight: 1 }];
  const learn = learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', blend: { p: 0 } } }, { regional: { enabled: true, kBlend: 1, minEvents: 1 } });
  /** A shopper with Tabby interests, a firing seed rule (paid social), the regional prior on and populated, a known journey stage (four interactions) and a served history. */
  async function everyShopperTerm(m: Mounted): Promise<Shopper> {
    await publishGlobalTrend(m, { line: { Tabby: 0.6, Willow: 0.4 }, category: { Handbags: 1 } });
    const s = await tabby(m);
    await pageRecords(m, s, 'p28-b1-history');
    return s;
  }
  const shopperPreconditions = (host: string, r: DecisionRecord | undefined) => {
    expect([r?.cell.channel, Boolean(r?.cell.stage && r.cell.stage !== 'unknown'), Object.keys(r?.inputs?.affinity ?? {}).length > 0, Boolean(r?.inputs?.regional_share)],
      `${host}: PRECONDITION — the shopper's decision is in the paid-social context with a known stage, their interests and the regional prior's shares`).toEqual(['paid_social', true, true, true]);
  };

  for (const host of HOSTS) {
    it(`host (${host}): on an opted-in layout at p 0 whose rules weight no dimension, the served order is catalogue order term for term and every record's behaviour and performance terms read 0`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: declaredSlots([layoutSlot({ weights: ZERO_WEIGHTS, seeds: SEED }), recentSlot()]), learn });
      precondition(m, 'P28.B1');
      const s = await everyShopperTerm(m);
      const { served, records } = await pageRecords(m, s, 'p28-b1');
      shopperPreconditions(host, records[0]);
      expect(served, `${host}: P28.B1 — at p 0 the served order is the catalogue order of the eligible modules`).toEqual(ELIGIBLE.slice(0, 4));
      expect(records.map(r => [r.item_id, blendOf(r) ?? 'no explain.blend on the record']),
        `${host}: P28.B1 — each record itemises R = (M − i)/M, the behaviour term B 0, the performance term Q 0 and p 0`)
        .toEqual(ELIGIBLE.slice(0, 4).map(id => [id, { R: CATALOGUE_R[id], B: 0, Q: 0, p: 0 }]));
    }, 90_000);

    it(`host (${host}): on an opted-in layout at p 0 with a configured order for the shopper's context, the served order is the configured order term for term and R is ranked from it`, async () => {
      // R-P40: the order lists four modules, the take (CONFIGURED), so M = 4 and R = 1, 0.75, 0.5, 0.25.
      const m = await mount(host, { pieces: MODULES, slots: declaredSlots([layoutSlot({ weights: ZERO_WEIGHTS, seeds: SEED, orders: ORDERS }), recentSlot()]), learn });
      precondition(m, 'P28.B1');
      const stored = (await loadSlots(m)).document as { pages: Record<string, Array<Record<string, unknown>>> };
      expect(stored.pages.pdp?.find(slot => slot.slot === LAYOUT)?.orders, `${host}: PRECONDITION P01 — the published layout slot keeps its per-context order`).toEqual(ORDERS);
      const s = await everyShopperTerm(m);
      const { served, records } = await pageRecords(m, s, 'p28-b1-configured');
      shopperPreconditions(host, records[0]);
      expect(served, `${host}: P28.B1 — at p 0 the served order is the configured order`).toEqual(CONFIGURED);
      const R = R_OF(CONFIGURED);
      expect(records.map(r => [r.item_id, blendOf(r) ?? 'no explain.blend on the record']),
        `${host}: P28.B1 — each record's R is ranked from the configured order, B and Q read 0, p 0`)
        .toEqual(CONFIGURED.map(id => [id, { R: R[id], B: 0, Q: 0, p: 0 }]));
    }, 90_000);

    it(`host (${host}): on an opted-in layout at p 0 with a configured order that lists an ineligible module, the listed modules still eligible are served in order, the ineligible one passed over and never replaced, and R is ranked over them with M = 3 (R-P41)`, async () => {
      // R-P41 (ii): lookbook.1 is expired, so P01 passes it over and never replaces it (unlisted modules stay hidden): three positions.
      // M counts the listed modules still eligible, editorial.1, grid.1, reco.2, so R = 1, 2/3, 1/3, compared at three decimals, the
      // precision the engine writes its explain scores at.
      const listed = [M.editorial, M.lookbook, M.grid, M.reco2], stillEligible = [M.editorial, M.grid, M.reco2];
      const orders = [{ context: ORDERS[0]!.context, modules: listed }];
      const m = await mount(host, { pieces: MODULES, slots: declaredSlots([layoutSlot({ weights: ZERO_WEIGHTS, seeds: SEED, orders }), recentSlot()]), learn });
      precondition(m, 'P28.B1');
      const stored = (await loadSlots(m)).document as { pages: Record<string, Array<Record<string, unknown>>> };
      expect(stored.pages.pdp?.find(slot => slot.slot === LAYOUT)?.orders, `${host}: PRECONDITION P01 — the published layout slot keeps its per-context order`).toEqual(orders);
      const s = await everyShopperTerm(m);
      const { served, records } = await pageRecords(m, s, 'p28-b1-ineligible');
      shopperPreconditions(host, records[0]);
      expect(served, `${host}: P28.B1 — at p 0 the listed modules still eligible are served in the configured order, lookbook.1 passed over and not replaced`).toEqual(stillEligible);
      const R = R_OF(stillEligible);
      const at3 = (x: unknown) => typeof x === 'number' ? Math.round(x * 1000) / 1000 : x;
      expect(records.map(r => { const b = blendOf(r); return [r.item_id, b ? { ...b, R: at3(b.R) } : 'no explain.blend on the record']; }),
        `${host}: P28.B1 — each record's R is ranked over the three listed modules still eligible (M = 3), B and Q read 0, p 0`)
        .toEqual(stillEligible.map(id => [id, { R: at3(R[id]), B: 0, Q: 0, p: 0 }]));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P28.B2 — at p > 0 a module with no behaviour score moves by learned performance, within the clamps
// ===========================================================================

describe('unit:P28.B2 (freeze items 8 and 34)', () => {
  const learn = learnDocument({ [LAYOUT]: { reward: 'click', blend: { p: 0.5 } } });
  for (const host of HOSTS) {
    it(`host (${host}): at p 0.5 a module whose behaviour score is 0 and whose learned lift at the answering level is beyond the clamps moves up exactly as R + p × Q with the clamped lift, no further`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn });
      precondition(m, 'P28.B2');
      // ugc.1: 20 clicks in 40 exposures against a slot rate of 20 in 240: p̂ / p₀ ≈ 3.9, clamped to liftMax 2, so Q = 1.
      await learnedLift(m, LAYOUT, [{ item: M.ugc, exposures: 40, successes: 20 }, { item: RETIRED, exposures: 200, successes: 0 }], LADDER_CELL);
      expect([rounded(await learned(m), 'n')[M.ugc], rounded(await learned(m), 's')[M.ugc]], `${host}: PRECONDITION — ugc.1's exposures and clicks are learned`).toEqual([40, 20]);
      const set = await servePage(m, await cold(m), 'pdp', { entry: PAID_SOCIAL_ENTRY });
      const layout = set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      // R + 0.5 Q: grid 1, reco.1 0.8, ugc.1 0.2 + 0.5 × 1 = 0.7, reco.2 0.6, editorial 0.4. Unclamped (≈ 3.9) it would lead.
      expect(layout.map(r => r.item_id), `${host}: P28.B2 — ugc.1 moves up to third, exactly where R + p × Q with the clamped lift puts it`)
        .toEqual([M.grid, M.reco1, M.ugc, M.reco2]);
      const ugc = layout.find(r => r.item_id === M.ugc);
      expect([ugc?.explain.score_final, blendOf(ugc) ?? 'no explain.blend'], `${host}: P28.B2 — its score is 0.2 + 0.5 × (2 − 1)`)
        .toEqual([0.7, { R: 0.2, B: 0, Q: 1, p: 0.5 }]);
    }, 120_000);

    it(`host (${host}): at p 0.5 a module whose behaviour score is 0 and whose learned lift is between 1 and the upper clamp moves up exactly as R + p × Q computes`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn });
      precondition(m, 'P28.B2');
      // ugc.1: 6 clicks in 40 exposures against a slot rate of 20 in 240: a lift near 1.46, inside the clamps.
      await learnedLift(m, LAYOUT, [{ item: M.ugc, exposures: 40, successes: 6 }, { item: RETIRED, exposures: 200, successes: 14 }], LADDER_CELL);
      const set = await servePage(m, await cold(m), 'pdp', { entry: PAID_SOCIAL_ENTRY });
      const layout = set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      const ugc = layout.find(r => r.item_id === M.ugc);
      expect(layout.map(r => r.item_id), `${host}: P28.B2 — ugc.1 (R 0.2 + 0.5 × Q ≈ 0.43) moves up past editorial.1 (R 0.4) into the take`)
        .toEqual([M.grid, M.reco1, M.reco2, M.ugc]);
      const lift = ugc?.explain.lift?.lift ?? NaN;
      expect(lift > 1 && lift < 2, `${host}: PRECONDITION — ugc.1's learned lift at the answering level is inside the clamps (${lift})`).toBe(true);
      expect(ugc?.explain.score_final ?? NaN, `${host}: P28.B2 — its served score is R + p × Q = 0.2 + 0.5 × (lift − 1)`).toBeCloseTo(0.2 + 0.5 * (lift - 1), 2);
      expect(blendOf(ugc) ?? 'no explain.blend', `${host}: P28.B2 — and the record says so`).toMatchObject({ R: 0.2, B: 0, p: 0.5 });
    }, 120_000);

    it(`host (${host}): at p 0.5 on an opted-in layout with a configured order for the shopper's context, the listed modules are re-ranked by R + p × Q with R from the order, ugc.1 (lift beyond the clamp) moving exactly that far, and the unlisted reco.1 stays hidden (freeze item 17; R-P41)`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: declaredSlots([layoutSlot({ orders: ORDERS }), recentSlot()]), learn });
      const { set, layout } = await underTheOrder(m, 'P28.B2');
      // R from the order (M = 4) plus 0.5 Q: ugc.1 0.75 + 0.5 × 1 = 1.25, editorial.1 1, grid.1 0.5, reco.2 0.25. Served exactly, the order would keep editorial.1 first.
      // The unlisted reco.1 carries the same learned lift: a blend that admitted it (at R 0, 0 + 0.5 × 1 = 0.5) would serve it in reco.2's place.
      expect(layout.map(r => r.item_id), `${host}: P28.B2 — ugc.1 moves above editorial.1, exactly where R + p × Q with R from the configured order puts it`)
        .toEqual([M.ugc, M.editorial, M.grid, M.reco2]);
      expect([set.decisions.some(d => d.contentId === M.reco1), set.records.some(r => r.item_id === M.reco1)],
        `${host}: P28.B2 — the unlisted reco.1 stays hidden: no decision on the page (so no render offer) and no record`).toEqual([false, false]);
      const R = R_OF(CONFIGURED);
      expect(layout.map(r => [r.item_id, r.explain.score_final, blendOf(r) ?? 'no explain.blend on the record']),
        `${host}: P28.B2 — each record's served score is R + p × Q with R from the configured order, B 0, Q 1 for ugc.1 and 0 for the rest, p 0.5`)
        .toEqual([[M.ugc, 1.25, { R: R[M.ugc], B: 0, Q: 1, p: 0.5 }], [M.editorial, 1, { R: R[M.editorial], B: 0, Q: 0, p: 0.5 }],
          [M.grid, 0.5, { R: R[M.grid], B: 0, Q: 0, p: 0.5 }], [M.reco2, 0.25, { R: R[M.reco2], B: 0, Q: 0, p: 0.5 }]]);
    }, 120_000);

    it(`host (${host}): LOCK — at p 0.5 a merchandiser's frozen lift of 0.2, below the lower clamp, counts as the clamped 0.5: Q −0.5 and the score R − 0.25, no lower (R-P43)`, async () => {
      // GREEN at the build. CONTROL (the reviewer's, on a scratch copy): the clamp removed from the blend's lift (decide.ts, the
      // Math.min/Math.max on the frozen or learned lift) gives grid.1 Q −0.8 and the score 0.6, turning this clause RED.
      const frozenLow = learnDocument({ [LAYOUT]: { reward: 'click', blend: { p: 0.5 }, items: { [M.grid]: { mode: 'freeze', lift: 0.2 } } } });
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: frozenLow });
      precondition(m, 'P28.B2');
      const set = await servePage(m, await cold(m), 'pdp', { entry: PAID_SOCIAL_ENTRY });
      const layout = set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      // R + 0.5 Q over catalogue order: reco.1 0.8, grid.1 1 + 0.5 × (0.5 − 1) = 0.75, reco.2 0.6, editorial.1 0.4. Unclamped, grid.1 would score 0.6.
      expect(layout.map(r => [r.item_id, r.explain.score_final, blendOf(r) ?? 'no explain.blend on the record']),
        `${host}: P28.B2 — grid.1's frozen 0.2 is clamped to liftMin 0.5: Q −0.5, its score R − 0.25 = 0.75, below reco.1`)
        .toEqual([[M.reco1, 0.8, { R: CATALOGUE_R[M.reco1], B: 0, Q: 0, p: 0.5 }], [M.grid, 0.75, { R: CATALOGUE_R[M.grid], B: 0, Q: -0.5, p: 0.5 }],
          [M.reco2, 0.6, { R: CATALOGUE_R[M.reco2], B: 0, Q: 0, p: 0.5 }], [M.editorial, 0.4, { R: CATALOGUE_R[M.editorial], B: 0, Q: 0, p: 0.5 }]]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P28.B3 — every record and receipt itemises R, B, Q and p, and they add up to the served score
// ===========================================================================

describe('unit:P28.B3 (freeze items 8 and 34)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): every record and every receipt of an opted-in slot itemises R, B, Q and p, and R + (1 − p) × B + p × Q equals the served score`, async () => {
      const learn = learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', blend: { p: 0.5 }, items: { [M.ugc]: { mode: 'freeze', lift: 2 } } } });
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn });
      precondition(m, 'P28.B3');
      const s = await tabby(m);
      const { records } = await pageRecords(m, s, 'p28-b3');
      expect(records.length, `${host}: PRECONDITION — the four layout positions are recorded`).toBe(4);
      const check = (label: string, item: string, blend: Record<string, number> | undefined, served: number) => {
        if (!blend) return [label, item, 'no blend itemised'];
        const { R, B, Q, p } = blend;
        const sum = (R ?? NaN) + (1 - (p ?? NaN)) * (B ?? NaN) + (p ?? NaN) * (Q ?? NaN);
        return [label, item, R === CATALOGUE_R[item], p === 0.5, Q === (item === M.ugc ? 1 : 0), Number.isFinite(B) && B >= 0, Math.abs(sum - served) <= 0.002];
      };
      const ok = (label: string, item: string) => [label, item, true, true, true, true, true];
      expect(records.map(r => check('record', r.item_id, blendOf(r), r.explain.score_final)),
        `${host}: P28.B3 — each record itemises R (the catalogue rank base), B, Q (ugc.1's frozen 2 gives 1, else 0) and p 0.5, and they sum to score_final`)
        .toEqual(records.map(r => ok('record', r.item_id)));
      const receipts = (await receiptsOf(m, s.subject)).filter(r => r.slot === LAYOUT && records.some(x => x.decision_id === r.decision_id));
      expect(receipts.length, `${host}: PRECONDITION — a receipt for each recorded position`).toBe(4);
      expect(receipts.map(r => check('receipt', String(r.item), r.blend as Record<string, number> | undefined, Number(r.score_final))),
        `${host}: P28.B3 — each receipt itemises R, B, Q and p, and they sum to its score_final`)
        .toEqual(receipts.map(r => ok('receipt', String(r.item))));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P28.B4 — content slots and layouts that do not opt in keep base × lift^γ (LOCK)
// ===========================================================================

describe('unit:P28.B4 (freeze item 8)', () => {
  const STORY = 'pdp-story';
  const STORY_PIECES = [
    { id: 'story.tabby', customerContentId: 'TAP-STORY-TABBY', type: 'editorial', title: 'The Tabby story', tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' } },
    { id: 'story.willow', customerContentId: 'TAP-STORY-WILLOW', type: 'editorial', title: 'The Willow story', tags: { line: ['Willow'] }, slotTypes: [STORY], lifecycle: { status: 'live' } },
  ];
  const slots = declaredSlots([layoutSlot(), recentSlot(), { slot: STORY, take: 2, weights: { line: 1 } }]);
  const frozen = (ids: string[]) => Object.fromEntries(ids.map(id => [id, { mode: 'freeze', lift: 2 }]));
  const learnWith = (layoutBlend: Record<string, unknown>) => learnDocument({
    [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', gamma: 1, items: frozen([M.ugc, M.reco2]), ...layoutBlend },
    [STORY]: { reward: 'click', gamma: 1, items: frozen(['story.tabby', 'story.willow']) },
  });
  const multiplicative = (r: DecisionRecord) => {
    const lift = r.explain.lift?.lift ?? 1, gamma = r.explain.lift?.gamma ?? 1;
    return [r.slot, r.item_id, Math.abs(r.explain.score_final - r.explain.score_base * Math.pow(lift, gamma)) <= 0.002];
  };
  const terms = (records: DecisionRecord[], slot: string) => records.filter(r => r.slot === slot)
    .map(r => [r.item_id, r.position, r.explain.score_base, r.explain.score_final, r.explain.lift?.lift ?? null]);

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a content slot, and a layout slot that does not opt in, keep base × lift^γ term for term, an exactly zero base stays zero, and opting the layout in changes nothing on the content slot`, async () => {
      const plain = await mount(host, { pieces: [...MODULES, ...STORY_PIECES], slots, learn: learnWith({}) });
      precondition(plain, 'P28.B4');
      const records = (await servePage(plain, await tabby(plain), 'pdp')).records;
      const measured = records.filter(r => r.slot === LAYOUT || r.slot === STORY);
      expect(measured.length, `${host}: PRECONDITION — the layout and the content slot are decided`).toBe(6);
      expect(measured.map(multiplicative), `${host}: P28.B4 — every content and non-opted layout record is score_base × lift^γ`)
        .toEqual(measured.map(r => [r.slot, r.item_id, true]));
      const willow = records.find(r => r.item_id === 'story.willow');
      expect([willow?.explain.score_base, willow?.explain.score_final], `${host}: P28.B4 — the Willow story (no Willow interest) has an exactly zero base and its frozen lift of 2 leaves it zero (unit:W16.C7)`).toEqual([0, 0]);
      expect(records.filter(r => r.slot === LAYOUT).map(r => blendOf(r) ?? null), `${host}: P28.B4 — a layout that does not opt in itemises no blend`).toEqual([null, null, null, null]);

      const opted = await mount(host, { pieces: [...MODULES, ...STORY_PIECES], slots, learn: learnWith({ blend: { p: 0.5 } }) });
      precondition(opted, 'P28.B4');
      const optedRecords = (await servePage(opted, await tabby(opted), 'pdp')).records;
      expect(terms(optedRecords, STORY), `${host}: P28.B4 — the content slot's decisions are unchanged, term for term, when the layout opts in`).toEqual(terms(records, STORY));
    }, 90_000);

    it(`host (${host}): LOCK — the configured order on a layout slot that does not opt in is served exactly, with ugc.1's learned lift beyond the clamp, and no record itemises a blend (R-P41, R-P7)`, async () => {
      // GREEN before the build: P01 serves the order exactly. CONTROL (the reviewer's, after the build): a blend applied on a slot
      // without the opt-in turns this leg RED, at any p above 0 by moving ugc.1 above editorial.1 (first clause), at p 0 by
      // putting explain.blend on the records (second clause).
      const m = await mount(host, { pieces: MODULES, slots: declaredSlots([layoutSlot({ orders: ORDERS }), recentSlot()]), learn: learnDocument({ [LAYOUT]: { reward: 'click' } }) });
      const { layout } = await underTheOrder(m, 'P28.B4');
      expect(layout.map(r => r.item_id), `${host}: P28.B4 — without the opt-in the configured order is served exactly, as P01 built it`).toEqual(CONFIGURED);
      expect(layout.map(r => blendOf(r) ?? null), `${host}: P28.B4 — a layout that does not opt in itemises no blend`).toEqual([null, null, null, null]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P28.B5 — publication refusals; a learn document without the blend decides and replays as before
// ===========================================================================

describe('unit:P28.B5 (freeze item 8)', () => {
  it('host: publication refuses, with an error naming the blend, a p outside 0 to 1 and an opt-in on a slot that is not the page’s declared layout slot, writing no revision, and admits and keeps a p inside 0 to 1 on the layout slot', async () => {
    const m = await mount('session', { pieces: MODULES, slots: SLOTS, learn: learnDocument() });
    precondition(m, 'P28.B5');
    const admitted = await putDocument(m, 'learn', learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', blend: { p: 0.25 } } }), 'p28 blend');
    expect(admitted.status, `P28.B5 — CONTROL: p 0.25 on the declared layout slot publishes: ${JSON.stringify(errorsOf(admitted))}`).toBe(200);
    const kept = (await loadDocument(m, 'learn')).document as { slots?: Record<string, Record<string, unknown>> };
    expect(kept.slots?.[LAYOUT]?.blend, 'P28.B5 — the published learn document keeps the opt-in as authored').toEqual({ p: 0.25 });
    const revision = (await loadDocument(m, 'learn')).revision;
    const cases: Array<[string, unknown]> = [
      ['p above 1', learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', blend: { p: 1.5 } } })],
      ['p below 0', learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', blend: { p: -0.1 } } })],
      ['an opt-in on the recently-viewed slot, not the declared layout slot', learnDocument({ 'pdp-recent': { reward: 'click', blend: { p: 0.5 } } })],
    ];
    const outcomes: unknown[][] = [];
    for (const [name, document] of cases) {
      const answer = await putDocument(m, 'learn', document, name);
      outcomes.push([name, answer.status, errorsOf(answer).some(e => /blend/.test(e))]);
    }
    expect(outcomes, 'P28.B5 — each is refused (422) with an error naming the blend').toEqual(cases.map(([name]) => [name, 422, true]));
    expect((await loadDocument(m, 'learn')).revision, 'P28.B5 — and no refused document wrote a revision').toBe(revision);
  }, 60_000);

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a learn document without the blend decides the declared layout exactly as the same slot undeclared, and every decision replays equal`, async () => {
      const learn = learnDocument({ [LAYOUT]: { reward: 'click', gamma: 1, items: { [M.editorial]: { mode: 'freeze', lift: 2 } } } });
      const undeclared = { version: 'parity-p28-undeclared', governanceVersion: 3, pages: { pdp: [{ ...layoutSlot(), layout: undefined }, recentSlot()].map(x => JSON.parse(JSON.stringify(x))) } };
      const before = await mount(host, { pieces: MODULES, slots: undeclared, retainedSlots: true, learn }, { recovery: false });
      expectPublished(before, 'P28.B5 — the undeclared retained slots document reads');
      const reference = (await servePage(before, await tabby(before), 'pdp', { offer: false })).records.filter(r => r.slot === LAYOUT)
        .map(r => [r.item_id, r.position, r.explain.score_base, r.explain.score_final]);

      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn }, { recovery: false });
      precondition(m, 'P28.B5');
      const s = await tabby(m);
      const set = await servePage(m, s, 'pdp', { offer: false });
      expect(set.records.filter(r => r.slot === LAYOUT).map(r => [r.item_id, r.position, r.explain.score_base, r.explain.score_final]),
        `${host}: P28.B5 — without the blend the declared layout decides term for term as before`).toEqual(reference);
      await toLedger(m, set.records);
      const replays: unknown[][] = [];
      for (const r of storedDecisions(m, s.subject).filter(x => x.slot === LAYOUT)) {
        const replay = await replayOf(m, r.decision_id);
        replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
      }
      expect(replays.length, `${host}: PRECONDITION — the ledger holds the layout decisions`).toBe(4);
      expect(replays, `${host}: P28.B5 — each replays equal`).toEqual(replays.map(([id]) => [id, 200, 'equal']));
    }, 90_000);
  }

  // R-P43: a blended decision replays exactly. The learn document is B2's (p 0.5 on the layout slot); the ledger is written by the
  // real producer and consumer (`toLedger`) and each stored layout decision is replayed through the real route (`replayOf`). The
  // replay re-decides the page from the record and compares it with the record, explain.blend included: `equal` is the proof.
  const BLENDED = learnDocument({ [LAYOUT]: { reward: 'click', blend: { p: 0.5 } } });
  const markersOf = (r: DecisionRecord) => [r.inputs?.replay?.blend ?? null, r.inputs?.replay?.orders ?? null];
  async function replayEach(m: Mounted, records: DecisionRecord[]): Promise<unknown[][]> {
    await toLedger(m, records);
    const replays: unknown[][] = [];
    for (const r of storedDecisions(m, records[0]!.visitor_id).filter(x => x.slot === LAYOUT).sort((a, b) => a.position - b.position)) {
      const replay = await replayOf(m, r.decision_id);
      replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
    }
    return replays;
  }

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a blended decision under the configured order replays equal through the replay route, every layout record carrying the blend and orders markers and its explain.blend (R-P43)`, async () => {
      // GREEN at the build. CONTROL (the reviewer's, on a scratch copy): the orders marker dropped on a blended order decision
      // (decide.ts, `orders: ORDER_RULES` in the page manifest) turns the marker clause RED, and with that clause set aside the
      // replay answers 'item' (the replay clause RED).
      const m = await mount(host, { pieces: MODULES, slots: declaredSlots([layoutSlot({ orders: ORDERS }), recentSlot()]), learn: BLENDED }, { recovery: false });
      const { set, layout } = await underTheOrder(m, 'P28.B5');
      const R = R_OF(CONFIGURED);
      expect(layout.map(r => [r.item_id, ...markersOf(r), blendOf(r) ?? 'no explain.blend on the record']),
        `${host}: P28.B5 — each blended record under the order carries the blend and orders markers and its explain.blend`)
        .toEqual([[M.ugc, 'layout-blend-v1', 'configured-order-v1', { R: R[M.ugc], B: 0, Q: 1, p: 0.5 }],
          [M.editorial, 'layout-blend-v1', 'configured-order-v1', { R: R[M.editorial], B: 0, Q: 0, p: 0.5 }],
          [M.grid, 'layout-blend-v1', 'configured-order-v1', { R: R[M.grid], B: 0, Q: 0, p: 0.5 }],
          [M.reco2, 'layout-blend-v1', 'configured-order-v1', { R: R[M.reco2], B: 0, Q: 0, p: 0.5 }]]);
      const replays = await replayEach(m, set.records);
      expect(replays.length, `${host}: PRECONDITION — the ledger holds the four layout decisions`).toBe(4);
      expect(replays, `${host}: P28.B5 — each blended decision under the order replays equal`).toEqual(layout.map(r => [r.item_id, 200, 'equal']));
    }, 120_000);

    it(`host (${host}): LOCK — a blended decision under catalogue order replays equal through the replay route, every layout record carrying the blend marker, no orders marker, and its explain.blend (R-P43)`, async () => {
      // GREEN at the build. CONTROL (the reviewer's, on a scratch copy): the blend marker dropped turns the marker clause RED; a
      // replay that does not re-apply the blend answers other than 'equal' (the replay clause RED).
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: BLENDED }, { recovery: false });
      precondition(m, 'P28.B5');
      // B2's first leg: ugc.1 20 clicks in 40 exposures against a slot rate of 20 in 240, a lift beyond liftMax 2, so Q = 1.
      await learnedLift(m, LAYOUT, [{ item: M.ugc, exposures: 40, successes: 20 }, { item: RETIRED, exposures: 200, successes: 0 }], LADDER_CELL);
      const set = await servePage(m, await cold(m), 'pdp', { entry: PAID_SOCIAL_ENTRY });
      const layout = set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      expect(layout.map(r => [r.item_id, ...markersOf(r), blendOf(r) ?? 'no explain.blend on the record']),
        `${host}: P28.B5 — each blended record under catalogue order carries the blend marker, no orders marker, and its explain.blend`)
        .toEqual([[M.grid, 'layout-blend-v1', null, { R: CATALOGUE_R[M.grid], B: 0, Q: 0, p: 0.5 }],
          [M.reco1, 'layout-blend-v1', null, { R: CATALOGUE_R[M.reco1], B: 0, Q: 0, p: 0.5 }],
          [M.ugc, 'layout-blend-v1', null, { R: CATALOGUE_R[M.ugc], B: 0, Q: 1, p: 0.5 }],
          [M.reco2, 'layout-blend-v1', null, { R: CATALOGUE_R[M.reco2], B: 0, Q: 0, p: 0.5 }]]);
      const replays = await replayEach(m, set.records);
      expect(replays.length, `${host}: PRECONDITION — the ledger holds the four layout decisions`).toBe(4);
      expect(replays, `${host}: P28.B5 — each blended decision under catalogue order replays equal`).toEqual(layout.map(r => [r.item_id, 200, 'equal']));
    }, 120_000);

    it(`host (${host}): LOCK — on the holdout's default arm the opted-in layout carries no blend: catalogue order, no blend marker, no explain.blend, and every decision replays equal (R-P43)`, async () => {
      // GREEN at the build. CONTROL (the reviewer's, on a scratch copy): the blend applied on the default arm (decide.ts, the
      // default-arm guard on the blend source) puts explain.blend and the blend marker on these records (and, with ugc.1 frozen at
      // 2, moves it into the take), turning the no-blend clause RED.
      const learn = learnDocument({ [LAYOUT]: { reward: 'click', blend: { p: 0.5 }, items: { [M.ugc]: { mode: 'freeze', lift: 2 } } } },
        { holdout: { share: 1, salt: 'p28-default-arm', arms: ['default'] } });
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn }, { recovery: false });
      precondition(m, 'P28.B5');
      const set = await servePage(m, await cold(m), 'pdp', { entry: PAID_SOCIAL_ENTRY });
      const layout = set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      expect(layout.map(r => r.arm), `${host}: PRECONDITION — the shopper is on the holdout's default arm`).toEqual(['default', 'default', 'default', 'default']);
      expect(layout.map(r => [r.item_id, ...markersOf(r), blendOf(r) ?? null]),
        `${host}: P28.B5 — the default arm serves the catalogue order with no blend marker and no explain.blend on any record`)
        .toEqual(ELIGIBLE.slice(0, 4).map(id => [id, null, null, null]));
      const replays = await replayEach(m, set.records);
      expect(replays.length, `${host}: PRECONDITION — the ledger holds the four layout decisions`).toBe(4);
      expect(replays, `${host}: P28.B5 — each default-arm decision replays equal`).toEqual(layout.map(r => [r.item_id, 200, 'equal']));
    }, 120_000);
  }
});
