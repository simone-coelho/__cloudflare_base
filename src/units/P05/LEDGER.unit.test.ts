// src/units/P05/LEDGER.unit.test.ts
// P05 under the Closure Ledger: the tests for the LOCAL criteria of the P05 work
// order (`tapestry-parity-build`, ticket P05 "Position-bias correction"). DC1 and
// DC2 (decisions D1, D2) are ruled and exercised inside W3 and W4; LV1-LV3 are
// deferred live rows and get no test.
//
// One `describe('unit:P05.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P05 in section A): "on a
//     configured share of page views, two adjacent modules swap places. The
//     engine estimates each position's own effect and normalizes engagement by
//     position. The share is a dial whose default is set with Tapestry";
//   · freeze sheet item 20 (D1: "position effects estimated from adjacent-swap
//     pairs as a click ratio"; D2: "credit normalised by that weight behind a
//     switch their data science confirms first") and item 48;
//   · the investigation, section G-B ("adjacent swaps with a position discount
//     are P05");
//   · the parity document, sections 3.7 and 7 (cited by number only);
//   · the existing contract: src/learn/explore.ts:84-87 (the decision's bucket,
//     a hash of visitor, slot and hour), :122-163 (inside the share when the
//     bucket is below it), src/learn/receipts.ts:167, src/learn/hourly.ts:121-124,
//     src/routes/decisions.ts:690-718 (`GET /v1/:tenant/lift?slot=`, the slot's
//     learning read), public/console/views.js:455-480 (the dials screen).
//
// THE READINGS THIS FILE RULES (one representation for every criterion, on the
// page's DECLARED layout slot):
//   The mode is the slot's exploration dial `{ mode: 'adjacent-swap', share,
//   floor }` in the learn document; the switch is `positionNormalization: true`
//   on the slot's dials, absent (off) by default. Positions are counted from 1
//   within the slot (P04's count) and keyed on `slotPosition` (P03). A swap
//   exchanges the modules of two ADJACENT positions, neither of them a P04
//   position pin or an off-limits module. The record of each swapped module
//   carries `explain.exploration: { mode: 'adjacent-swap', positions: [i, i + 1],
//   bucket }`. The estimate, D1 as R-P21 reads freeze item 20's method: position
//   1's effect is 1; position k + 1's effect is position k's times (clicks at
//   k + 1 / clicks at k), the clicks counted over the decisions on which
//   (k, k + 1) was swapped; it is read on `GET /v1/:tenant/lift?slot=` as
//   `positionEffects: [{ position, effect, pairs }]` (on the answer or on its
//   snapshot), `pairs` the swapped decisions behind it. D2: with the switch on,
//   a click at a position credits 1 / that position's effect, online and in the
//   offline recomputation alike (R-P20).
//   W1  At share 0 the shopper's ranked order is served exactly; at share 1 the same
//       shopper is served it with exactly one adjacent pair swapped, the same
//       pair on a repeat; with ugc pinned at 3 the only legal pair is (1, 2); with
//       reco.1 off-limits at 2 it is (3, 4). At a share strictly between 0 and 1
//       (R-P19), of two shoppers with no signal, the one whose bucket lies
//       outside the share is served the ranked (catalogue) order exactly and the
//       one whose bucket lies inside it is served it with exactly one adjacent
//       pair swapped, the same pair on a repeat. The bucket is the decision's own
//       coordinates — visitor, slot and hour (src/learn/explore.ts:84-87; C12) —
//       and the test clock is fixed one minute into an hour, so every decision of
//       a check falls inside one hour bucket.
//   W2  The two records of a swap name it, its positions and its bucket; the
//       receipt says so. Both are read through the route on rendered-v1, every
//       drawn module acknowledged (R-P18: a declared served-v1 layout is never
//       captured at serve time, P02.A3 D1); the records are the ones the real
//       consumer wrote to the ledger. The decision replays equal with the swap
//       reproduced, on a served-v1 mount without the durable recovery path
//       (R-P14, until the R-P3 defect is fixed).
//   W3  Four swapped decisions of a take-2 layout, every shopper clicking the
//       module at position 1 and two of them the module at position 2: position
//       1's effect 1, position 2's 1 × 2/4 = 0.5 (R-P21), four pairs behind each,
//       on the slot's learning read.
//   W4  After that estimate, a click at position 2 credits 1 / 0.5 = 2 with the
//       switch on and 1 with it off, online (the statistics object) and in the
//       offline recomputation (R-P20): the hourly fold (buildHour → foldShard,
//       src/learn/hourly.ts) over the ledger the real consumer wrote, driven by
//       `catchUp` exactly as the five-minute job runs it (src/index.ts:270-272)
//       once the hour has closed, the published day read back through the
//       operator route. The measured click is a Tabby shopper's on reco.2, a
//       module no other click of the day credits, so its credit, online and
//       folded, is that click's alone; the fixed clock keeps the day in one hour.
//   W5  Publishing the mode on a slot that is not the page's declared layout
//       slot, or a share outside 0..1, is refused with a named error; the mode on
//       the layout slot publishes; a learn document without the mode decides and
//       replays as before.
//   W6  The shipped dials screen edits the mode, the share and the switch; the
//       kit documents the mode, the estimate and the switch.
//
// FIX ROUND 1 (R-P62, the lead's ruling on the delivery review at 1d598625):
//   W4  (1) The hourly fold weighs a click credit by the position policy in force
//       at the credit's time, read from the placement's published history, never
//       by the learn dials in force when the fold runs: W4's measured click,
//       credited 2 online (switch on, estimate 0.5), folds 2 after the learn
//       document is republished without the mode and the switch (what the dials
//       screen writes for "off": both members deleted) before the hour folds, and
//       the day's count of credited outcomes is unchanged (R-P29): seven, one per
//       click of the day. The controls, green at 1d598625 (the review's probe 3,
//       case P3, and this leg's own run): republished with the switch false, the
//       mode kept or dropped, the click folds 2.
//       (2) The fold weighs a credit exactly when the online path does, on a
//       credited decision that carries a position (a declared-layout record with
//       its layout reason): after a slots PUT alone undeclares the layout, a later
//       click at position 2 credits 1 online and 1 folded, while the click at
//       position 2 made before it on the declared layout credits 2 on both
//       (probe 3, case P5).
//   W1  (3) Reading 1, ruled as option C: a decision served under a configured
//       order is served exactly and never swapped (freeze items 17 and 35, P01's
//       receipted O2, R-P34). The review's probe D1 order for the paid-social first
//       visit, at share 1: served exactly, no record carries explain.exploration
//       or explored true, the reason on every record and receipt is the order's
//       as P29 receipted it (kit 02 and 03: a configured order served exactly on a
//       slot that does not opt in is `unchanged` with the cause
//       `blend_or_trust_zero`), and the decision replays equal. The controls: the
//       same shopper, before the order is published, and a shopper with the same
//       views whose context no order names (a direct arrival, P01.O2), after it,
//       are each served the ranked order with one adjacent pair swapped.
//   (4) Every share-1 leg draws its shoppers through `swappable`, which keeps a
//       shopper only when the decision's bucket lies below 1.000 in this hour and
//       the next (a bucket rounding to 1.000, about 1 in 2000, lies outside even
//       a share of 1); the asserted contract is unchanged.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// the exploration mode `adjacent-swap`, `positionNormalization` on the slot's
// dials, `positions` on `explain.exploration`, `positionEffects` on the slot's
// learning read, the dials screen's controls for them. No new export is
// imported: `bucketOf` and `hourKeyOf` (src/learn/explore.ts), `catchUp` and
// `HOUR_MS` (src/learn/hourly.ts), `read` (src/config/versionedStore.ts) and
// `DEFAULT_LEARN`, `LEARN_KIND` (src/content/kinds.ts) exist today.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts, the
// shipped console under jsdom).

import { describe, expect, it, vi } from 'vitest';

import { read } from '@/config/versionedStore';
import { DEFAULT_LEARN, LEARN_KIND } from '@/content/kinds';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import { bucketOf, hourKeyOf } from '@/learn/explore';
import { catchUp, HOUR_MS } from '@/learn/hourly';

import {
  asOperator, BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, loadDocument, M, MODULES, mount, openConsole,
  PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf, putDocument, receiptsOf, recentSlot, RECENT_SLOT, replayOf, servedIn, servePage, shopperOn,
  storedDecisions, TABBY_VIEWS, TENANT, toLedger, type Mounted, type Shopper,
} from '../_parity';
import { missingStatements } from '../_parity2';
// R-P62 (3): the arrival whose context no configured order names.
import { DIRECT_ENTRY } from '../_parity';

const slots = (over: Record<string, unknown> = {}) => declaredSlots([layoutSlot(over), recentSlot()]);
const swap = (share: number) => ({ mode: 'adjacent-swap', share, floor: 50 });
const swapLearn = (share: number, dials: Record<string, unknown> = {}, basis: 'rendered-v1' | 'served-v1' = 'rendered-v1') =>
  learnDocument({ [LAYOUT]: { ...(basis === 'rendered-v1' ? { measurementBasis: 'rendered-v1' } : {}), reward: 'click', exploration: swap(share), ...dials } });
/** The shopper's ranking after three Tabby views (P02.A2): reco.2, editorial.1, grid.1, reco.1. */
const RANKED = [M.reco2, M.editorial, M.grid, M.reco1];

/**
 * R-P62 (4): a shopper whose decisions a share of 1 swaps. Inside the share means the decision's bucket — the hash of
 * visitor, slot and hour, rounded to 3 decimals (src/learn/explore.ts:84-87, :202) — lies below the share, so a visitor
 * whose bucket rounds to 1.000 (about 1 in 2000) lies outside even a share of 1. Shoppers are drawn until one's bucket
 * lies below 1.000 in this hour and in the next (no leg lasts an hour), so every share-1 leg's shopper is inside the
 * share by construction. Nothing else about the shopper changes.
 */
async function swappable(m: Mounted): Promise<Shopper> {
  const inside = (s: Shopper, at: number) => Math.round(bucketOf(s.subject, LAYOUT, hourKeyOf(at)) * 1000) / 1000 < 1;
  for (let draw = 0; draw < 20; draw++) {
    const s = await shopperOn(m), now = Date.now();
    if (inside(s, now) && inside(s, now + HOUR_MS)) return s;
  }
  return expect.unreachable(`${m.host}: PRECONDITION — none of twenty shoppers drawn has a bucket below 1.000`);
}

async function tabby(m: Mounted): Promise<Shopper> {
  const s = await swappable(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: the shopper's page view is accepted`).toBe(200);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: the shopper's view is accepted`).toBe(200);
  return s;
}
const layoutOf = async (s: Shopper, label: string) => servedIn(await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) }), LAYOUT);
/** The positions (from 1) at which two orders differ. */
const differing = (a: string[], b: string[]) => a.map((id, i) => id === b[i] ? null : i + 1).filter((i): i is number => i !== null);
const explorationOf = (r: DecisionRecord | undefined) => r?.explain.exploration as Record<string, unknown> | undefined;
/** A shopper with no signal: the first four eligible modules in catalogue order (P02.A2). */
const COLD = [M.grid, M.reco1, M.reco2, M.editorial];
/** [exactly two positions differ and they are adjacent, the two ranked modules are exchanged]. */
const oneAdjacentSwap = (served: string[], ranked: string[]): [boolean, boolean] => {
  const at = differing(served, ranked);
  return [at.length === 2 && at[1] === at[0]! + 1, at.length === 2 && served[at[0]! - 1] === ranked[at[1]! - 1] && served[at[1]! - 1] === ranked[at[0]! - 1]];
};
/**
 * R-P19 (C12): the test clock fixed one minute into the next whole hour and running from there, so every decision of
 * a check, a repeat included, falls inside one hour bucket of the decision's coordinates.
 */
function fixedHour(): { hourStart: number; restore: () => void } {
  const real = Date.now.bind(Date), start = real();
  const hourStart = (Math.floor(start / HOUR_MS) + 1) * HOUR_MS, shift = hourStart + 60_000 - start;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => real() + shift);
  return { hourStart, restore: () => clock.mockRestore() };
}
/** The decision's own exploration bucket from its coordinates — visitor, slot, hour (src/learn/explore.ts:84-87; R-P19). */
const bucketNow = (s: Shopper) => bucketOf(s.subject, LAYOUT, hourKeyOf(Date.now()));

// ===========================================================================
// unit:P05.W1 — one adjacent swap on the share, never a pin or an off-limits module
// ===========================================================================

describe('unit:P05.W1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): inside the share the ranked order is served with exactly one adjacent pair swapped, chosen deterministically from the decision's own coordinates (visitor, slot, hour bucket) and never moving a pinned or off-limits module; outside the share, and at share 0, the ranked order is served exactly`, async () => {
      const clock = fixedHour();
      try {
        const m = await mount(host, { pieces: MODULES, slots: slots(), learn: swapLearn(0) });
        expectPublished(m, 'P05.W1 — the adjacent-swap mode at share 0 on the declared layout slot publishes');
        const s = await tabby(m);
        expect(await layoutOf(s, 'p05-w1-zero'), `${host}: P05.W1 — at share 0 the ranked order is served exactly`).toEqual(RANKED);
        expect((await putDocument(m, 'learn', swapLearn(1))).status, `${host}: P05.W1 — the share of 1 publishes`).toBe(200);
        const once = await layoutOf(s, 'p05-w1-once'), again = await layoutOf(s, 'p05-w1-again');
        expect.soft(oneAdjacentSwap(once, RANKED),
          `${host}: P05.W1 — inside the share exactly one adjacent pair is swapped (served ${JSON.stringify(once)} against ${JSON.stringify(RANKED)})`).toEqual([true, true]);
        expect.soft(again, `${host}: P05.W1 — chosen from the decision's own coordinates: the same decision swaps the same pair`).toEqual(once);

        // R-P19: a share strictly between 0 and 1. Of shoppers with no signal, one whose bucket (visitor, slot, hour)
        // lies outside the share and one whose bucket lies inside it, each well clear of the boundary.
        const SHARE = 0.5;
        const half = await mount(host, { pieces: MODULES, slots: slots(), learn: swapLearn(SHARE) });
        expectPublished(half, `P05.W1 — the adjacent-swap mode at share ${SHARE} on the declared layout slot publishes`);
        let outside: Shopper | undefined, inside: Shopper | undefined;
        for (let i = 0; i < 60 && !(outside && inside); i++) {
          const candidate = await shopperOn(half), bucket = bucketNow(candidate);
          if (!outside && bucket >= SHARE + 0.05) outside = candidate;
          else if (!inside && bucket < SHARE - 0.05) inside = candidate;
        }
        expect([outside !== undefined, inside !== undefined], `${host}: PRECONDITION — one shopper whose bucket lies outside the share ${SHARE} and one inside it`).toEqual([true, true]);
        for (const shopper of [outside!, inside!]) expect((await shopper.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${host}: the page view is accepted`).toBe(200);
        expect.soft(await layoutOf(outside!, 'p05-w1-outside'),
          `${host}: P05.W1 — bucket ${bucketNow(outside!)} lies outside the share ${SHARE}: the ranked order is served exactly`).toEqual(COLD);
        const inOnce = await layoutOf(inside!, 'p05-w1-inside'), inAgain = await layoutOf(inside!, 'p05-w1-inside-again');
        expect.soft(oneAdjacentSwap(inOnce, COLD),
          `${host}: P05.W1 — bucket ${bucketNow(inside!)} lies inside the share ${SHARE}: exactly one adjacent pair is swapped (served ${JSON.stringify(inOnce)} against ${JSON.stringify(COLD)})`).toEqual([true, true]);
        expect.soft(inAgain, `${host}: P05.W1 — the same shopper in the same hour bucket swaps the same pair`).toEqual(inOnce);

        const pinned = await mount(host, { pieces: MODULES, slots: slots({ positionPins: [{ pieceId: M.ugc, position: 3 }] }), learn: swapLearn(1) });
        expectPublished(pinned, 'P05.W1 — the swap at share 1 beside a position pin publishes');
        expect.soft(await layoutOf(await tabby(pinned), 'p05-w1-pin'), `${host}: P05.W1 — with ${M.ugc} pinned at 3 the only adjacent pair free to swap is (1, 2)`)
          .toEqual([M.editorial, M.reco2, M.ugc, M.grid]);
        const held = await mount(host, { pieces: MODULES, slots: slots({ offLimitsPieceIds: [M.reco1] }), learn: swapLearn(1) });
        expectPublished(held, 'P05.W1 — the swap at share 1 beside an off-limits module publishes');
        expect(await layoutOf(await tabby(held), 'p05-w1-off'), `${host}: P05.W1 — with ${M.reco1} off-limits at 2 the only adjacent pair free to swap is (3, 4)`)
          .toEqual([M.reco2, M.reco1, M.grid, M.editorial]);
      } finally { clock.restore(); }
    }, 90_000);

    it(`host (${host}): R-P62 (3), reading 1 ruled as option C — under the adjacent-swap mode at share 1 a configured order published for the shopper's context is served exactly and never swapped: no record carries explain.exploration or explored true, the reason on every record and receipt is the order's as P29 receipted it, and the decision replays equal; CONTROL: the same shopper before the order is published, and a shopper whose context no order names after it, are served the ranked order with one adjacent pair swapped`, async () => {
      /** The review's probe D1 order (P01's representation) for the paid-social first visit: it differs from the ranking and from catalogue order, and lists the module tagged on an unmapped dimension. */
      const ORDER = [M.editorial, M.ugc, M.grid, M.reco1];
      const ORDERS = [{ context: { channel: 'paid_social', visitBuckets: ['1'] }, modules: ORDER }];
      /** P29 as receipted (kit 02 and 03): a configured order served exactly on a slot that does not opt in to the blend. */
      const REASON = { cause: 'blend_or_trust_zero', slot: LAYOUT, status: 'unchanged' };
      const clock = fixedHour();
      try {
        const m = await mount(host, { pieces: MODULES, slots: slots(), learn: swapLearn(1) });
        expectPublished(m, 'P05.W1 (R-P62 3) — the adjacent-swap mode at share 1 on the declared layout slot publishes');
        const s = await tabby(m);
        const without = await layoutOf(s, 'p05-w1-order-without');
        expect(oneAdjacentSwap(without, RANKED),
          `${host}: CONTROL — without an order the shopper is served the ranked order with one adjacent pair swapped (served ${JSON.stringify(without)} against ${JSON.stringify(RANKED)})`).toEqual([true, true]);
        const written = await putDocument(m, 'slots', slots({ orders: ORDERS }), 'p05 configured order');
        expect(written.status, `${host}: PRECONDITION — the order for the shopper's context publishes through PUT /content/slots: ${JSON.stringify(written.body).slice(0, 300)}`).toBe(200);
        // CONTROL: the swap still applies to the ranked order. A shopper with the same views whose context no order names (a
        // direct arrival) receives the slot's own decision (P01.O2): the ranked order with one adjacent pair swapped (W1).
        const direct = await swappable(m);
        expect((await direct.action(PAGE_VIEW, DIRECT_ENTRY)).status, `${host}: the direct arrival's page view is accepted`).toBe(200);
        for (const view of TABBY_VIEWS.slice(0, 3)) expect((await direct.action(view)).status, `${host}: the shopper's view is accepted`).toBe(200);
        const directLayout = await layoutOf(direct, 'p05-w1-order-direct');
        expect(oneAdjacentSwap(directLayout, RANKED),
          `${host}: CONTROL — with the order published, a shopper whose context no order names is served the ranked order with one adjacent pair swapped (served ${JSON.stringify(directLayout)} against ${JSON.stringify(RANKED)})`).toEqual([true, true]);

        // The decision under the order, through the route on rendered-v1, every drawn module acknowledged (R-P18).
        const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p05-w1-order') });
        const drawn = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
        expect.soft(drawn.map(d => d.contentId), `${host}: P05.W1 (R-P62 3) — under the adjacent-swap mode at share 1 the configured order is served exactly, never swapped`).toEqual(ORDER);
        for (const d of drawn) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
        await m.drainLedger();
        const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT && drawn.some(d => d.decisionId === r.decision_id)).sort((a, b) => a.position - b.position);
        expect(records.length, `${host}: PRECONDITION — the ledger holds the four acknowledged layout decisions under the order`).toBe(4);
        expect.soft(records.map(r => [r.item_id, r.explored, explorationOf(r) ?? null, (r.explain as Record<string, unknown>).layoutReason ?? null]),
          `${host}: P05.W1 (R-P62 3) — no record carries an exploration member or explored true, and each carries the order's reason`).toEqual(ORDER.map(id => [id, false, null, REASON]));
        const receipts = (await receiptsOf(m, s.subject)).filter(r => r.slot === LAYOUT && drawn.some(d => d.decisionId === r.decision_id));
        expect(receipts.length, `${host}: PRECONDITION — a receipt for every acknowledged layout position under the order`).toBe(4);
        expect.soft(Object.fromEntries(receipts.map(r => [String(r.item), r.layoutReason ?? null])), `${host}: P05.W1 (R-P62 3) — every receipt carries the order's reason`)
          .toEqual(Object.fromEntries(ORDER.map(id => [id, REASON])));

        // The replay (R-P14): served-v1 without the durable recovery path, the order published for the same context.
        const served = await mount(host, { pieces: MODULES, slots: slots({ orders: ORDERS }), learn: swapLearn(1, {}, 'served-v1') }, { recovery: false });
        expectPublished(served, 'P05.W1 (R-P62 3) — the order beside the adjacent-swap mode at share 1 on a served-v1 mount without the recovery path publishes');
        const other = await tabby(served);
        const set = await servePage(served, other, 'pdp', { offer: false });
        await toLedger(served, set.records);
        const stored = storedDecisions(served, other.subject).filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
        expect(stored.length, `${host}: PRECONDITION — the ledger holds the four layout decisions to replay`).toBe(4);
        const replays: unknown[][] = [];
        for (const r of stored) {
          const replay = await replayOf(served, r.decision_id);
          replays.push([r.item_id, r.explored, explorationOf(r) ?? null, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
        }
        expect(replays, `${host}: P05.W1 (R-P62 3) — the decision under the order is served exactly, unswapped, and replays equal`)
          .toEqual(ORDER.map(id => [id, false, null, 200, 'equal']));
      } finally { clock.restore(); }
    }, 90_000);
  }
});

// ===========================================================================
// unit:P05.W2 — the record and the receipt name the swap; replay
// ===========================================================================

describe('unit:P05.W2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the record and the receipt of a swapped decision name the swap, its two positions and the bucket, read through the route on rendered-v1 with render acknowledgements, and the decision replays equal with the swap reproduced`, async () => {
      const PINNED = slots({ positionPins: [{ pieceId: M.ugc, position: 3 }] });
      /** With ugc pinned at 3 the only adjacent pair free to swap is (1, 2). */
      const SWAPPED = [M.editorial, M.reco2, M.ugc, M.grid];
      const PAIR = [M.editorial, M.reco2];

      // The records and the receipt (R-P18): the shopper's page through the route on rendered-v1, every drawn module acknowledged.
      const m = await mount(host, { pieces: MODULES, slots: PINNED, learn: swapLearn(1) });
      expectPublished(m, 'P05.W2 — the swap at share 1 beside a position pin publishes on rendered-v1');
      const s = await tabby(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p05-w2') });
      const drawn = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
      expect(drawn.map(d => d.contentId), `${host}: PRECONDITION — the pair (1, 2) is swapped`).toEqual(SWAPPED);
      for (const d of drawn) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT && drawn.some(d => d.decisionId === r.decision_id));
      expect(records.map(r => r.item_id).sort(), `${host}: PRECONDITION — the ledger holds the shopper's four acknowledged layout decisions`).toEqual([...SWAPPED].sort());
      for (const item of PAIR) {
        const block = explorationOf(records.find(r => r.item_id === item));
        expect.soft([block?.mode, block?.positions, typeof block?.bucket === 'number' && (block.bucket as number) >= 0 && (block.bucket as number) < 1],
          `${host}: P05.W2 — the record of ${item} names the swap, its positions and the bucket (${JSON.stringify(block)})`).toEqual(['adjacent-swap', [1, 2], true]);
      }
      const receipts = (await receiptsOf(m, s.subject)).filter(r => r.slot === LAYOUT);
      expect(receipts.length, `${host}: PRECONDITION — a receipt for every acknowledged layout position`).toBe(4);
      const receipt = receipts.find(r => r.item === M.editorial);
      expect.soft(((receipt?.why ?? []) as string[]).some(w => /swap/i.test(w) && /\b1\b/.test(w) && /\b2\b/.test(w)),
        `${host}: P05.W2 — the receipt says it was swapped, and between which positions (why: ${JSON.stringify(receipt?.why)})`).toBe(true);

      // The replay (R-P14): served-v1 without the durable recovery path, so the replay reads what the real producer and consumer wrote.
      const served = await mount(host, { pieces: MODULES, slots: PINNED, learn: swapLearn(1, {}, 'served-v1') }, { recovery: false });
      expectPublished(served, 'P05.W2 — the same swap on a served-v1 mount without the recovery path publishes');
      const other = await tabby(served);
      const set = await servePage(served, other, 'pdp', { offer: false });
      expect(set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position).map(r => r.item_id),
        `${host}: PRECONDITION — the decision to replay swaps the pair (1, 2)`).toEqual(SWAPPED);
      await toLedger(served, set.records);
      const stored = storedDecisions(served, other.subject).filter(r => r.slot === LAYOUT);
      expect(stored.length, `${host}: PRECONDITION — the ledger holds the four layout decisions to replay`).toBe(4);
      const replays: unknown[][] = [];
      for (const r of stored) {
        const replay = await replayOf(served, r.decision_id);
        const block = explorationOf(replay.body.replayed as DecisionRecord | undefined) ?? null;
        replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null, JSON.stringify(block) === JSON.stringify(explorationOf(r) ?? null),
          PAIR.includes(r.item_id as never) ? [block?.mode ?? null, block?.positions ?? null] : 'the swap is named on the swapped pair']);
      }
      expect(replays, `${host}: P05.W2 — a swapped decision replays equal, the swap reproduced`)
        .toEqual(stored.map(r => [r.item_id, 200, 'equal', true, PAIR.includes(r.item_id as never) ? ['adjacent-swap', [1, 2]] : 'the swap is named on the swapped pair']));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P05.W3 / W4 — the estimate from the swap pairs, and normalised credit
// ===========================================================================

/** A take-2 layout (one adjacent pair) at share 1: four paid-social shoppers with no signal, all clicking position 1, two of them position 2. */
async function swappedClicks(m: Mounted): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const s = await swappable(m);
    expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status).toBe(200);
    const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(`p05-w3-${i}`) });
    const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
    expect(layout.map(d => d.contentId), `${m.host}: PRECONDITION — the take-2 layout is served swapped`).toEqual([M.reco1, M.grid]);
    for (const d of layout) expect((await s.ack(page, d)).status, `${m.host}: ${d.contentId} acknowledged`).toBe(200);
    expect((await s.click(page, layout[0]!)).status, `${m.host}: the click at position 1 is accepted`).toBe(200);
    if (i < 2) expect((await s.click(page, layout[1]!)).status, `${m.host}: the click at position 2 is accepted`).toBe(200);
  }
  await m.drainLedger();
}
async function positionEffects(m: Mounted): Promise<unknown> {
  const published = await asOperator(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot: LAYOUT });
  expect(published.status, `${m.host}: PRECONDITION — the slot's statistics publish: ${JSON.stringify(published.body).slice(0, 200)}`).toBe(200);
  const read = await asOperator(m, 'GET', `/v1/${TENANT}/lift?slot=${LAYOUT}`);
  expect(read.status, `${m.host}: PRECONDITION — the slot's learning read answers`).toBe(200);
  return read.body.positionEffects ?? (read.body.snapshot as Record<string, unknown> | null)?.positionEffects ?? `no positionEffects on the slot's learning read (answer: ${Object.keys(read.body).join(', ')})`;
}
const rounded2 = (effects: unknown) => Array.isArray(effects) ? effects.map(e => ({ position: e.position, effect: Math.round(Number(e.effect) * 100) / 100, pairs: e.pairs })) : effects;

// R-P21 (the lead's reading of freeze item 20's method, confirmed at the freeze): position effect(1) = 1;
// effect(k + 1) = effect(k) × clicks(k + 1) / clicks(k), the clicks counted over the decisions that swapped positions
// (k, k + 1). Here four decisions swapped (1, 2), with four clicks at position 1 and two at position 2: effect(1) = 1,
// effect(2) = 1 × 2/4 = 0.5, four pairs behind each position. W4's credit at position 2 is then 1 / 0.5 = 2.
describe('unit:P05.W3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D1 — the learning layer estimates each position's effect from the adjacent-swap pairs as a click ratio, readable with the number of pairs on the operator's learning read for the slot`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: slots({ take: 2 }), learn: swapLearn(1) });
      expectPublished(m, 'P05.W3 — a take-2 layout with the swap at share 1 publishes');
      await swappedClicks(m);
      expect(rounded2(await positionEffects(m)), `${host}: P05.W3 — position 1's effect 1, position 2's 0.5 (two clicks at 2 for four at 1), over four swapped pairs`)
        .toEqual([{ position: 1, effect: 1, pairs: 4 }, { position: 2, effect: 0.5, pairs: 4 }]);
    }, 60_000);
  }
});

/**
 * R-P20, the offline recomputation: the five-minute job exactly as src/index.ts:270-272 runs it — the published learn
 * document read the way the cron reads it, then `catchUp(env.STORAGE, tenant, learn, now, {}, env)` with the cron's own
 * options, run until a run folds nothing (as unit:W30.L1 drives it) — at a moment the measured hour has closed, so the
 * hourly fold (buildHour → foldShard, src/learn/hourly.ts) folds the ledger the real consumer wrote and publishes the
 * day. The day is read back through the operator route; the answer is the module's folded credit in the slot's
 * learning grid, to the cent (decay over the hour moves the third decimal only).
 */
async function foldedCredit(m: Mounted, hourStart: number, item: string): Promise<unknown> {
  const now = hourStart + HOUR_MS + 6 * 60_000, date = new Date(hourStart).toISOString().slice(0, 10);
  const learn = await read<LearnConfig>(m.env, LEARN_KIND, TENANT, DEFAULT_LEARN);
  const failed: unknown[] = [], published: string[] = [];
  for (let run = 0; run < 40; run++) {
    const result = await catchUp(m.env.STORAGE as unknown as Parameters<typeof catchUp>[0], TENANT, learn, now, {}, m.env as never);
    failed.push(...result.failed, ...result.reports.failed);
    published.push(...result.reports.published);
    if (!result.built.length) break;
  }
  expect([failed, published.includes(date)], `${m.host}: PRECONDITION — the five-minute job folded the closed hour and published ${date}`).toEqual([[], true]);
  const day = await asOperator(m, 'GET', `/v1/${TENANT}/learn/report?date=${date}&brand=${BRAND}&slot=${LAYOUT}`);
  expect(day.status, `${m.host}: PRECONDITION — the published day reads back through the operator route: ${JSON.stringify(day.body).slice(0, 200)}`).toBe(200);
  type Grid = { items?: Record<string, Record<string, { s?: number }>> };
  const grid = (day.body.report as { grids?: Record<string, Record<string, Grid>> } | undefined)?.grids?.[LAYOUT]?.learning;
  const credit = grid?.items?.[item]?.['*']?.s;
  return typeof credit === 'number' ? Math.round(credit * 100) / 100 : `no folded credit for ${item} in the day's learning grid (it holds ${Object.keys(grid?.items ?? {}).join(', ') || 'nothing'})`;
}

/**
 * R-P62: the day `foldedCredit` folded and published, read back through the same operator route without folding again:
 * any module's folded credit in the slot's learning grid, to the cent, and the day's number of credited outcomes under
 * the learning policy (`policies[].credits`, the count R-P29 keeps unchanged by the position weight).
 */
async function publishedDay(m: Mounted, hourStart: number): Promise<{ credit: (item: string) => unknown; credits: unknown }> {
  const date = new Date(hourStart).toISOString().slice(0, 10);
  const day = await asOperator(m, 'GET', `/v1/${TENANT}/learn/report?date=${date}&brand=${BRAND}&slot=${LAYOUT}`);
  expect(day.status, `${m.host}: PRECONDITION — the published day reads back through the operator route: ${JSON.stringify(day.body).slice(0, 200)}`).toBe(200);
  type Report = { grids?: Record<string, Record<string, { items?: Record<string, Record<string, { s?: number }>> }>>; policies?: Array<{ name?: string; role?: string; credits?: number }> };
  const report = day.body.report as Report | undefined;
  const items = report?.grids?.[LAYOUT]?.learning?.items ?? {};
  const learningPolicy = report?.policies?.find(p => p.role === 'learning');
  return {
    credit: (item: string) => {
      const s = items[item]?.['*']?.s;
      return typeof s === 'number' ? Math.round(s * 100) / 100 : `no folded credit for ${item} in the day's learning grid (it holds ${Object.keys(items).join(', ') || 'nothing'})`;
    },
    credits: learningPolicy?.credits ?? `no learning policy on the day's report (policies: ${JSON.stringify(report?.policies ?? null).slice(0, 200)})`,
  };
}

describe('unit:P05.W4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D2 — with the slot's normalisation switch on, a click at a position is credited divided by that position's estimated effect, online and in the offline recomputation (the hourly fold over the ledger the real consumer wrote) alike; with the switch off, its default, credit is exactly as today`, async () => {
      const clock = fixedHour();
      try {
        const online: Record<string, unknown> = {}, offline: Record<string, unknown> = {};
        for (const [name, dials] of [['on', { positionNormalization: true }], ['off', {}]] as const) {
          const m = await mount(host, { pieces: MODULES, slots: slots({ take: 2 }), learn: swapLearn(1, dials) });
          expectPublished(m, `P05.W4 — a take-2 layout with the swap at share 1 and the switch ${name} publishes`);
          await swappedClicks(m);
          await positionEffects(m);
          // The measured click: a Tabby shopper's take-2 layout (reco.2, editorial.1) served swapped at share 1, and the click
          // on reco.2 at position 2 (effect 0.5) — a module no other click of the day credits, so its credit is this click's.
          const s = await tabby(m);
          const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(`p05-w4-${name}`) });
          const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
          expect(layout.map(d => d.contentId), `${host}: PRECONDITION — the shopper's take-2 layout is served swapped, reco.2 at position 2`).toEqual([M.editorial, M.reco2]);
          const measured = M.reco2;
          for (const d of layout) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
          await m.drainLedger();
          const before = (await learned(m))[measured]?.s ?? 0;
          expect((await s.click(page, layout[1]!)).status, `${host}: the click at position 2 is accepted`).toBe(200);
          await m.drainLedger();
          online[name] = Math.round((((await learned(m))[measured]?.s ?? 0) - before) * 100) / 100;
          offline[name] = await foldedCredit(m, clock.hourStart, measured);
        }
        expect.soft(online, `${host}: P05.W4 — online, a click at position 2 (effect 0.5) credits 1 / 0.5 = 2 with the switch on and 1 with it off`).toEqual({ on: 2, off: 1 });
        expect(offline, `${host}: P05.W4 — and the offline recomputation, the hourly fold of the same day, credits the same click by the same weight`).toEqual({ on: 2, off: 1 });
      } finally { clock.restore(); }
    }, 180_000);

    it(`host (${host}): R-P62 (1) — the hourly fold weighs a click credit by the position policy in force at the credit's time, never by the learn dials in force when the fold runs: a click at position 2 credited 2 online (switch on, estimate 0.5) folds 2 after the learn document is republished without the mode and the switch before the hour folds, the day's count of credited outcomes unchanged; CONTROL: republished with the switch false, the mode kept or dropped, it folds 2 as at 1d598625`, async () => {
      const clock = fixedHour();
      try {
        // The controls first, so that the first failure of this leg is the world under test.
        const worlds: Array<[string, Record<string, unknown>]> = [
          ['CONTROL, republished with the mode kept and the switch false', { exploration: swap(1), positionNormalization: false }],
          ['CONTROL, republished with the mode dropped and the switch false (probe 3, case P3)', { positionNormalization: false }],
          ['republished without the mode and without the switch, both members deleted as the dials screen writes "off"', {}],
        ];
        for (const [name, republished] of worlds) {
          const m = await mount(host, { pieces: MODULES, slots: slots({ take: 2 }), learn: swapLearn(1, { positionNormalization: true }) });
          expectPublished(m, 'P05.W4 (R-P62 1) — a take-2 layout with the swap at share 1 and the switch on publishes');
          await swappedClicks(m);
          await positionEffects(m);
          // W4's measured click: the Tabby shopper's take-2 layout (reco.2, editorial.1) served swapped, and the click on reco.2 at position 2.
          const s = await tabby(m);
          const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p05-w4-r62-1') });
          const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
          expect(layout.map(d => d.contentId), `${host}: PRECONDITION — the shopper's take-2 layout is served swapped, reco.2 at position 2`).toEqual([M.editorial, M.reco2]);
          for (const d of layout) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
          await m.drainLedger();
          const before = (await learned(m))[M.reco2]?.s ?? 0;
          expect((await s.click(page, layout[1]!)).status, `${host}: the click at position 2 is accepted`).toBe(200);
          await m.drainLedger();
          expect(Math.round((((await learned(m))[M.reco2]?.s ?? 0) - before) * 100) / 100,
            `${host}: PRECONDITION (${name}) — online, the click at position 2 credits 1 / 0.5 = 2 under the policy in force`).toBe(2);
          // The learn document republished before the hour folds; the fold then reads the document in force, as the five-minute job does.
          const put = await putDocument(m, 'learn', learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', ...republished } }), 'p05 r-p62 1');
          expect(put.status, `${host}: PRECONDITION (${name}) — the learn document is republished: ${JSON.stringify(put.body).slice(0, 300)}`).toBe(200);
          const folded = await foldedCredit(m, clock.hourStart, M.reco2);
          const day = await publishedDay(m, clock.hourStart);
          expect([folded, day.credits],
            `${host}: P05.W4 (R-P62 1) — ${name}: the fold credits the click 2, the policy in force at the credit's time, and counts seven credited outcomes, one per click of the day (R-P29)`).toEqual([2, 7]);
        }
      } finally { clock.restore(); }
    }, 240_000);

    it(`host (${host}): R-P62 (2) — the fold weighs a credit exactly when the online path does: with the switch on and the estimate 0.5, after a slots PUT alone undeclares the layout, a later click at position 2 credits 1 online and 1 folded (unweighted on both paths alike), while the click at position 2 made before it on the declared layout credits 2 on both`, async () => {
      const clock = fixedHour();
      try {
        const m = await mount(host, { pieces: MODULES, slots: slots({ take: 2 }), learn: swapLearn(1, { positionNormalization: true }) });
        expectPublished(m, 'P05.W4 (R-P62 2) — a take-2 layout with the swap at share 1 and the switch on publishes');
        await swappedClicks(m);
        await positionEffects(m);
        const online: Record<string, unknown> = {};
        /** A Tabby shopper's take-2 layout served as `expected`, every drawn module acknowledged, and the click at position 2: its online credit. */
        const clickAt2 = async (label: string, expected: string[], what: string) => {
          const s = await tabby(m);
          const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
          const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
          expect(layout.map(d => d.contentId), `${host}: PRECONDITION — ${what}`).toEqual(expected);
          for (const d of layout) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
          await m.drainLedger();
          const item = layout[1]!.contentId, before = (await learned(m))[item]?.s ?? 0;
          expect((await s.click(page, layout[1]!)).status, `${host}: the click at position 2 is accepted`).toBe(200);
          await m.drainLedger();
          online[item] = Math.round((((await learned(m))[item]?.s ?? 0) - before) * 100) / 100;
        };
        await clickAt2('p05-w4-r62-2-declared', [M.editorial, M.reco2], 'on the declared layout the take-2 layout is served swapped, reco.2 at position 2');
        // A slots PUT alone that undeclares the layout slot (admitted: the slot keeps its take, weights and exclusion, without `layout: true`).
        const undeclared = Object.fromEntries(Object.entries(layoutSlot({ take: 2 })).filter(([key]) => key !== 'layout'));
        const put = await putDocument(m, 'slots', declaredSlots([undeclared, recentSlot()]), 'p05 r-p62 2');
        expect(put.status, `${host}: PRECONDITION — a slots PUT alone that undeclares the layout slot is admitted: ${JSON.stringify(put.body).slice(0, 300)}`).toBe(200);
        await clickAt2('p05-w4-r62-2-undeclared', [M.reco2, M.editorial], 'once the layout is undeclared the slot is served its ranking unswapped, editorial.1 at position 2');
        expect.soft(online, `${host}: P05.W4 (R-P62 2) — online, the click on the declared layout credits 2 and the later click, on a decision with no layout reason, 1`)
          .toEqual({ [M.reco2]: 2, [M.editorial]: 1 });
        const folded = { [M.editorial]: await foldedCredit(m, clock.hourStart, M.editorial), [M.reco2]: (await publishedDay(m, clock.hourStart)).credit(M.reco2) };
        expect(folded, `${host}: P05.W4 (R-P62 2) — the fold weighs exactly the credits the online path weighs: 2 for the click on the declared layout, 1 for the later click`)
          .toEqual({ [M.reco2]: 2, [M.editorial]: 1 });
      } finally { clock.restore(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P05.W5 — publication refusals; a learn document without the mode as before
// ===========================================================================

describe('unit:P05.W5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): publication refuses with a named error the adjacent-swap mode on a slot that is not the page's declared layout slot and a share outside 0 to 1, admits it on the layout slot, and a learn document without the mode decides and replays as before`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: slots(), learn: learnDocument({ [LAYOUT]: { reward: 'click' } }) }, { recovery: false });
      expectPublished(m, 'P05.W5 — the declared layout slot publishes');
      const s = await tabby(m);
      const set = await servePage(m, s, 'pdp', { offer: false });
      expect(set.records.filter(r => r.slot === LAYOUT).map(r => r.item_id), `${host}: P05.W5 — without the mode the slot decides as before`).toEqual(RANKED);
      await toLedger(m, set.records);
      for (const r of storedDecisions(m, s.subject).filter(x => x.slot === LAYOUT)) {
        const replay = await replayOf(m, r.decision_id);
        expect([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P05.W5 — ${r.item_id} replays equal as before`).toEqual([200, 'equal']);
      }
      const admitted = await putDocument(m, 'learn', learnDocument({ [LAYOUT]: { reward: 'click', exploration: swap(0.05) } }));
      expect.soft(admitted.status, `${host}: P05.W5 — the mode at a share of 0.05 on the declared layout slot publishes (${JSON.stringify(admitted.body).slice(0, 300)})`).toBe(200);
      const refusals: Array<[string, unknown, RegExp]> = [
        ['the mode on a slot that is not the declared layout slot', learnDocument({ [RECENT_SLOT]: { reward: 'click', exploration: swap(0.05) } }), new RegExp(`${RECENT_SLOT}.*(adjacent-swap|layout)|(adjacent-swap|layout).*${RECENT_SLOT}`)],
        ['a share above 1', learnDocument({ [LAYOUT]: { reward: 'click', exploration: swap(1.5) } }), /share/],
        ['a share below 0', learnDocument({ [LAYOUT]: { reward: 'click', exploration: swap(-0.1) } }), /share/],
      ];
      const outcomes: unknown[][] = [];
      for (const [name, document, named] of refusals) {
        const answer = await putDocument(m, 'learn', document, name);
        const errors = ((answer.body.errors ?? (answer.body.error ? [answer.body.error] : [])) as unknown[]).map(String);
        outcomes.push([name, answer.status, errors.some(e => /adjacent-swap/.test(e) && named.test(e))]);
      }
      expect(outcomes, `${host}: P05.W5 — each is refused with an error naming the adjacent-swap mode and what is wrong`).toEqual(refusals.map(([name]) => [name, 422, true]));
    }, 60_000);
  }
});

// ===========================================================================
// unit:P05.W6 — the dials screen edits the mode, the share and the switch; the kit
// ===========================================================================

describe('unit:P05.W6', () => {
  it('sdk: on the shipped dials screen of the declared layout slot an operator chooses the adjacent-swap mode, sets its share and turns the normalisation switch on, and the screen saves them through the mounted learn route', async () => {
    const m = await mount('session', { pieces: MODULES, slots: slots(), learn: learnDocument() });
    expectPublished(m, 'P05.W6 — the declared layout slot (P02) publishes');
    const c = await openConsole(m, `#/dials?scope=${TENANT}&slot=${LAYOUT}`);
    try {
      const base = `slots.${LAYOUT}`;
      const choose = async (focusKey: string, value: string) => {
        const el = c.control(focusKey);
        if (!el) return false;
        el.value = value; el.dispatchEvent(new c.w.Event('change', { bubbles: true })); el.dispatchEvent(new c.w.Event('input', { bubbles: true }));
        await c.settle();
        return el.value === value;
      };
      expect.soft(await choose(`${base}.exploration.mode`, 'adjacent-swap'), 'P05.W6 — the mode select offers adjacent-swap').toBe(true);
      expect.soft(await c.type(`${base}.exploration.share`, '0.05'), 'P05.W6 — the share is editable for it').toBe(true);
      expect.soft(await choose(`${base}.positionNormalization`, 'true'), 'P05.W6 — the normalisation switch is editable').toBe(true);
      await c.save();
      const learnPuts = c.requests.filter(r => r.method === 'PUT' && r.path.startsWith('/content/learn'));
      expect(learnPuts.length, 'P05.W6 — the screen saved through PUT /content/learn').toBe(1);
      const stored = (await loadDocument(m, 'learn')).document as { slots?: Record<string, Record<string, unknown>> };
      expect([stored.slots?.[LAYOUT]?.exploration, stored.slots?.[LAYOUT]?.positionNormalization], 'P05.W6 — the platform stored the mode, the share and the switch')
        .toEqual([expect.objectContaining({ mode: 'adjacent-swap', share: 0.05 }), true]);
    } finally { c.close(); }
  }, 90_000);

  it('logic: the API reference and the payload schemas each document the adjacent-swap mode, the position estimate and the normalisation switch', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'the mode adjacent-swap and its share', test: s => /adjacent-swap/.test(s) && /share/i.test(s) },
      { name: 'the estimate: each position’s effect from the swap pairs as a click ratio, positionEffects', test: s => /positionEffects/.test(s) && /click/i.test(s) && /ratio/i.test(s) },
      { name: 'the switch positionNormalization, off by default', test: s => /positionNormalization/.test(s) && /\boff\b|default/i.test(s) },
    ]);
    expect(missing, 'P05.W6 — the kit documents the mode, the estimate and the switch').toEqual([]);
  });
});
