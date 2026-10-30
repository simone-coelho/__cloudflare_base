// src/units/P04/LEDGER.unit.test.ts
// P04 under the Closure Ledger: the tests for the LOCAL criteria of the P04 work
// order (`tapestry-parity-build`, ticket P04 "Pins and off-limits for single
// modules"). DC1 (decision D1) is ruled and exercised inside N3; LV1 is a
// deferred live row and gets no test.
//
// One `describe('unit:P04.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P04 in section A): "a
//     pinned module stays at its configured position, any position rather than
//     only the first, and an off-limits module never moves while the others are
//     ranked around it";
//   · freeze sheet item 19 (D1: "an ineligible module pinned at a position
//     refuses the whole slot, as a refused prefix pin does today") and item 38
//     ("an off-limits module whose baseline position lies beyond the slot's take
//     is not served");
//   · the investigation, sections G-A (per module, item 5: "free to move, held at
//     a position, never moved, or may be hidden"), G-B (C3: "a pin at any
//     position and a single fixed module are P04") and G-C ("pins are a prefix
//     only, with mid-page pins and per-module off-limits in P04");
//   · the parity document, section 3.3 (cited by number only);
//   · the existing contract: src/reflex/contentCompose.ts:159-249 (pins reserved
//     page-wide before ranking; one invalid pin refuses the whole slot, with a
//     pin diagnostic naming the piece and the reason), src/content/kinds.ts:430-441
//     (publication refuses a pin that is explicitly excluded or duplicated),
//     public/console/views-config.js:487-520 (the slot-rules screen and its pin
//     sentence), src/units/W20/LEDGER.unit.test.ts:555 (unit:W20.R2's idiom).
//
// THE READINGS THIS FILE RULES (one representation for every criterion, on the
// page's DECLARED layout slot: P02's `layout: true` under governanceVersion 4):
//   A position pin is `positionPins: [{ pieceId, position }]` on the slot, with
//   `position` counted from 1 to the slot's `take`, as a merchandiser counts. A
//   per-module off-limits mark is `offLimitsPieceIds: [pieceId]` on the slot. The
//   BASELINE ORDER is the configured order for the shopper's context (P01's
//   `orders`), else the slot's eligible modules in catalogue order (excluded,
//   ineligible and already-served modules removed) — exactly what a shopper
//   with no signal is served (P02.A2) — and a module's baseline position is its
//   place in it, counted from 1.
//   N1  ugc pinned at k (1, 3, 4) is served at k for a shopper whose interests
//       rank it last; the three other positions are the shopper's ranking in order; on the
//       holdout's default arm the pin holds and the rest is catalogue order; a
//       slot whose exploration share is 1 still serves the pin at k, never
//       explored; a module pinned at 4 is reserved page-wide before an earlier
//       slot ranks; a prefix pin serves as before.
//   N2  An off-limits module holds its baseline position (2) on every arm while
//       the others are ranked around it; one whose baseline position lies beyond
//       the take (4 of take 3) is not served; under a configured order it holds
//       its position in that order. Under exploration (R-P17) only the
//       off-limits module is asserted, as N1 asserts the pinned one: it holds
//       position 2 on the served page and in its record and is not an
//       exploration pick; the other modules' order is the rotation rule's
//       (src/learn/explore.ts:216-221, the W28 contract) and is not asserted.
//   N3  A module pinned at a position that is expired, unregistered or refused by
//       an excluded tag refuses the whole layout slot: nothing served, no record,
//       and `pinDiagnostics` names `{ slot, pinnedPieceId, position, reason }`
//       with today's reason words; the rest of the page is served.
//   N4  `validateSlotCatalog` refuses, naming `positionPins` (or
//       `offLimitsPieceIds`) and the module: a position 0 or above take, two
//       modules at one position, one module pinned twice, a module both pinned
//       and off-limits, and a configured order that puts another module at a
//       pinned position; it admits and keeps a consistent set. A RETAINED
//       governance-3 document with a prefix pin decides as before and replays
//       equal under exactly today's page markers.
//   N5  The record of a pinned module carries `explain.moduleRule: { rule:
//       'pinned', position }`, an off-limits one `{ rule: 'off_limits', position }`
//       (P29's cause words), positions counted from 1; the receipt says so in
//       words with the position. Both are read through the route on
//       rendered-v1, every drawn module acknowledged, as unit:P29.R5 reads the
//       export (R-P18: a declared served-v1 layout is never captured at serve
//       time, P02.A3 D1); the record is the one the real consumer wrote to the
//       ledger. Every decision under the rules replays equal and the replay
//       reproduces each rule, measured on a served-v1 mount without the durable
//       recovery path (R-P14, until the R-P3 defect is fixed); the kit states
//       both rules.
//   N6  The shipped slot-rules screen of the declared layout slot edits
//       `[data-focus-key="governance.positionPins"]` and
//       `[data-focus-key="governance.offLimitsPieceIds"]` (the JSON idiom of the
//       screen's other hard controls), saves them through `PUT /content/slots`,
//       the saved revision serves them, and the screen's sentences about pins
//       state the rule as served.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `positionPins` and `offLimitsPieceIds` on a slot, `position` on a pin
// diagnostic, `explain.moduleRule` on the record, the two console controls. No
// new export is imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts, the
// shipped console under jsdom); src/units/P108/_pins.ts (R10 by name, R-P707,
// P108.XB3: N1's and N2's exploring world is built at the pinned hour and its
// CONTROL's shopper is drawn as the pinned visitor P04_CONTROL, so "the slot's
// exploration ran on this decision" measures the product, never a random draw
// whose bucket rounds to 1.000; every expectation unchanged).

import { describe, expect, it } from 'vitest';

import { validateSlotCatalog } from '@/content/kinds';
import type { DecisionRecord } from '@/content/types';

import {
  declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, loadSlots, M, MODULES, mount, openConsole, PAGE_VIEW,
  PAID_SOCIAL_ENTRY, pageInstanceOf, receiptsOf, recentSlot, replayOf, servedIn, servePage, shopperOn, storedDecisions, TABBY_VIEWS,
  TENANT, toLedger, type Mounted, type Shopper,
} from '../_parity';
import { missingStatements } from '../_parity2';
import { atPinnedHour, drawnAs, P04_CONTROL } from '../P108/_pins';

const PAID_SOCIAL_FIRST = { channel: 'paid_social', visitBuckets: ['1'] };
const slots = (over: Record<string, unknown> = {}) => declaredSlots([layoutSlot(over), recentSlot()]);
const BASE = { pieces: MODULES, slots: slots(), learn: learnDocument() };
/**
 * The shopper's ranking after three Tabby views (P02.A2's arithmetic): reco.2 = a + a/2,
 * editorial.1 = a, grid.1 = a/2, then reco.1 and ugc.1 at 0 in catalogue order.
 */
const RANKED = [M.reco2, M.editorial, M.grid, M.reco1, M.ugc];
/** The baseline: the eligible modules in catalogue order, what a shopper with no signal is served. */
const BASELINE = [M.grid, M.reco1, M.reco2, M.editorial, M.ugc];
const inserted = (rest: string[], id: string, k: number, take = 4) => { const out = rest.filter(x => x !== id).slice(0, take - 1); out.splice(k - 1, 0, id); return out; };

async function tabbyShopper(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: the shopper's page view is accepted`).toBe(200);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: the shopper's view is accepted`).toBe(200);
  return s;
}
const layoutOf = async (s: Shopper, label: string) => servedIn(await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) }), LAYOUT);
const ruleOf = (r: DecisionRecord | undefined) => (r?.explain as Record<string, unknown> | undefined)?.moduleRule;
const EXPLORE_ALL = learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', exploration: { mode: 'rotation', share: 1, floor: 50 } } });
const HOLDOUT_ALL = learnDocument({}, { holdout: { share: 1, salt: 'p04-holdout', arms: ['default'] } });

// ===========================================================================
// unit:P04.N1 — a pin at any position, reserved page-wide, never explored
// ===========================================================================

describe('unit:P04.N1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a module pinned at position k, for k from 1 to the take, is served at exactly k with the shopper's ranking around it, on the holdout's default arm and under exploration alike, reserved page-wide before ranking, while a prefix pin serves as before`, async () => {
      const outcomes: Array<{ case: string; served: string[]; expected: string[] }> = [];
      for (const k of [1, 3, 4]) {
        const m = await mount(host, { ...BASE, slots: slots({ positionPins: [{ pieceId: M.ugc, position: k }] }) });
        expectPublished(m, `P04.N1 — the declared layout slot with ${M.ugc} pinned at position ${k} publishes`);
        outcomes.push({ case: `pinned at ${k}`, served: await layoutOf(await tabbyShopper(m), `p04-n1-${k}`), expected: inserted(RANKED, M.ugc, k) });
      }
      const holdout = await mount(host, { ...BASE, slots: slots({ positionPins: [{ pieceId: M.ugc, position: 3 }] }), learn: HOLDOUT_ALL });
      expectPublished(holdout, 'P04.N1 — the position pin under a full holdout publishes');
      outcomes.push({ case: 'the holdout’s default arm', served: await layoutOf(await tabbyShopper(holdout), 'p04-n1-holdout'), expected: inserted(BASELINE, M.ugc, 3) });
      expect.soft(outcomes.map(o => [o.case, o.served]), `${host}: P04.N1 — the pinned module at exactly its position, the others ranked around it`).toEqual(outcomes.map(o => [o.case, o.expected]));

      // R10 (R-P707, P108.XB3): the exploring world at the pinned hour, its shopper drawn as the pinned visitor.
      await atPinnedHour(P04_CONTROL.at, async () => {
        const explore = await mount(host, { ...BASE, slots: slots({ positionPins: [{ pieceId: M.ugc, position: 3 }] }), learn: EXPLORE_ALL });
        expectPublished(explore, 'P04.N1 — the position pin on a slot that explores every decision publishes');
        const explored = (await servePage(explore, await drawnAs(P04_CONTROL, () => tabbyShopper(explore)), 'pdp')).records.filter(r => r.slot === LAYOUT);
        expect(explored.some(r => r.explored), `${host}: CONTROL — the slot's exploration ran on this decision`).toBe(true);
        expect.soft(explored.filter(r => r.item_id === M.ugc).map(r => [r.position, r.authority, r.explored]),
          `${host}: P04.N1 — under exploration the pinned module stays at position 3, as a pin, never explored`).toEqual([[2, 'pin', false]]);
      });

      // Reserved page-wide before ranking: a hero slot ABOVE the layout would otherwise serve the module pinned at position 4.
      const hero = { slot: 'pdp-hero', take: 1, weights: { line: 1, occasion: 0.5 } };
      const pieces = MODULES.map(p => [M.reco2, M.editorial].includes(p.id as never) ? { ...p, slotTypes: [LAYOUT, hero.slot] } : p);
      const page = await mount(host, { pieces, slots: declaredSlots([hero, layoutSlot({ positionPins: [{ pieceId: M.reco2, position: 4 }] }), recentSlot()]), learn: learnDocument() });
      expectPublished(page, 'P04.N1 — a hero slot above the declared layout slot with a position pin publishes');
      const shown = await (await tabbyShopper(page)).snapshot('pdp', { pageInstance: pageInstanceOf('p04-n1-hero') });
      expect.soft([servedIn(shown, hero.slot), servedIn(shown, LAYOUT)], `${host}: P04.N1 — the pin is reserved before the hero ranks, so the hero serves the next Tabby module and the layout holds ${M.reco2} at 4`)
        .toEqual([[M.editorial], [M.grid, M.reco1, M.ugc, M.reco2]]);

      const prefix = await mount(host, { ...BASE, slots: slots({ pinnedPieceIds: [M.grid] }) });
      expectPublished(prefix, 'P04.N1 — a prefix pin on the declared layout slot publishes');
      expect(await layoutOf(await tabbyShopper(prefix), 'p04-n1-prefix'), `${host}: P04.N1 — a prefix pin serves exactly as before: ${M.grid} first, the shopper's ranking after it`)
        .toEqual([M.grid, M.reco2, M.editorial, M.reco1]);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P04.N2 — an off-limits module never moves
// ===========================================================================

describe('unit:P04.N2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a module marked off-limits keeps its baseline position on every arm and under exploration while the others are ranked around it, is not served when that position lies beyond the take, and holds its place in a configured order`, async () => {
      const outcomes: Array<[string, string[], string[]]> = [];
      const run = async (name: string, over: Record<string, unknown>, expected: string[], learn = learnDocument()) => {
        const m = await mount(host, { ...BASE, slots: slots(over), learn });
        expectPublished(m, `P04.N2 — ${name} publishes`);
        outcomes.push([name, await layoutOf(await tabbyShopper(m), 'p04-n2'), expected]);
      };
      // reco.1's baseline position is 2; the shopper's ranking would put it last.
      await run('reco.1 off-limits', { offLimitsPieceIds: [M.reco1] }, [M.reco2, M.reco1, M.editorial, M.grid]);
      await run('reco.1 off-limits on the holdout’s default arm', { offLimitsPieceIds: [M.reco1] }, [M.grid, M.reco1, M.reco2, M.editorial], HOLDOUT_ALL);
      // editorial's baseline position is 4, beyond a take of 3; the shopper's ranking would put it second.
      await run('editorial off-limits beyond a take of 3', { take: 3, offLimitsPieceIds: [M.editorial] }, [M.reco2, M.grid, M.reco1]);
      // Under a configured order for the shopper's context, grid's baseline position is 2 in that order.
      await run('grid off-limits under a configured order', { offLimitsPieceIds: [M.grid], orders: [{ context: PAID_SOCIAL_FIRST, modules: [M.editorial, M.grid, M.ugc, M.reco1] }] },
        [M.editorial, M.grid, M.ugc, M.reco1]);

      // Under exploration (R-P17): only the off-limits module is asserted, as N1 asserts the pinned one — it holds its
      // baseline position and is not an exploration pick. The other modules' order is the rotation rule's
      // (src/learn/explore.ts:216-221, the W28 contract) and is not asserted.
      // R10 (R-P707, P108.XB3): the exploring world at the pinned hour, its shopper drawn as the pinned visitor.
      await atPinnedHour(P04_CONTROL.at, async () => {
        const explore = await mount(host, { ...BASE, slots: slots({ offLimitsPieceIds: [M.reco1] }), learn: EXPLORE_ALL });
        expectPublished(explore, 'P04.N2 — reco.1 off-limits on a slot that explores every decision publishes');
        const explorer = await drawnAs(P04_CONTROL, () => tabbyShopper(explore));
        const shown = await layoutOf(explorer, 'p04-n2-explore');
        const explored = (await servePage(explore, explorer, 'pdp')).records.filter(r => r.slot === LAYOUT);
        expect(explored.some(r => r.explored), `${host}: CONTROL — the slot's exploration ran on this decision`).toBe(true);
        expect.soft([shown[1] ?? null, explored.filter(r => r.item_id === M.reco1).map(r => [r.position, r.explored])],
          `${host}: P04.N2 — under exploration the off-limits module holds position 2 on the served page and in its record (0-based 1), never an exploration pick (served ${JSON.stringify(shown)})`)
          .toEqual([M.reco1, [[1, false]]]);
      });

      expect(outcomes.map(([name, served]) => [name, served]), `${host}: P04.N2 — the off-limits module holds its baseline position; the others are ranked around it`)
        .toEqual(outcomes.map(([name, , expected]) => [name, expected]));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P04.N3 — an ineligible pinned module refuses the whole slot (D1)
// ===========================================================================

describe('unit:P04.N3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D1 — a module pinned at a position that is missing, ineligible or excluded refuses the whole layout slot: nothing is served from it, no record is written, and the pin diagnostics name the module, its position and the reason`, async () => {
      const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
        ['an expired module', { positionPins: [{ pieceId: M.lookbook, position: 2 }] }, { pinnedPieceId: M.lookbook, position: 2, reason: 'missing_or_ineligible' }],
        ['an unregistered module', { positionPins: [{ pieceId: 'module.PDP.unregistered.9', position: 4 }] }, { pinnedPieceId: 'module.PDP.unregistered.9', position: 4, reason: 'missing_or_ineligible' }],
        ['a module an excluded tag refuses', { positionPins: [{ pieceId: M.grid, position: 1 }], excludedTags: [{ dimension: 'category', value: 'Small Leather Goods' }] },
          { pinnedPieceId: M.grid, position: 1, reason: 'excluded_tag' }],
      ];
      const outcomes: Array<Record<string, unknown>> = [];
      for (const [name, over, diagnostic] of cases) {
        const m = await mount(host, { ...BASE, slots: slots(over) });
        expectPublished(m, `P04.N3 — the declared layout slot with ${name} pinned at a position publishes`);
        const s = await tabbyShopper(m);
        const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p04-n3') });
        expect(servedIn(page, 'pdp-recent'), `${host}: CONTROL — the rest of the page is served`).toEqual([M.recent]);
        const set = await servePage(m, s, 'pdp');
        outcomes.push({ case: name, served: servedIn(page, LAYOUT), records: set.records.filter(r => r.slot === LAYOUT).map(r => r.item_id),
          diagnostic: (set.pinDiagnostics ?? []).find(d => d.slot === LAYOUT && (d as unknown as Record<string, unknown>).pinnedPieceId === diagnostic.pinnedPieceId) ?? null });
      }
      expect(outcomes.map(o => ({ ...o, diagnostic: o.diagnostic === null ? null : Object.fromEntries(Object.entries(o.diagnostic as object).filter(([k]) => ['slot', 'pinnedPieceId', 'position', 'reason'].includes(k))) })),
        `${host}: P04.N3 — each refuses the whole slot: nothing served, no record, and a diagnostic naming the module, its position and the reason`)
        .toEqual(cases.map(([name, , diagnostic]) => ({ case: name, served: [], records: [], diagnostic: { slot: LAYOUT, ...diagnostic } })));
    }, 60_000);
  }
});

// ===========================================================================
// unit:P04.N4 — publication refusals; a retained prefix-pin document as before
// ===========================================================================

describe('unit:P04.N4', () => {
  it('logic: publication refuses, with an error naming the rule and the module, a position outside 1 to take, two modules at one position, one module pinned twice, a module both pinned and off-limits, and a configured order that contradicts a position pin, and admits and keeps a consistent set', () => {
    const errors = (candidate: unknown): string[] => { const checked = validateSlotCatalog(candidate); return checked.ok ? [] : checked.errors; };
    const consistent = { positionPins: [{ pieceId: M.ugc, position: 2 }], offLimitsPieceIds: [M.reco1], orders: [{ context: PAID_SOCIAL_FIRST, modules: [M.grid, M.ugc, M.reco1] }] };
    const admitted = validateSlotCatalog(slots(consistent));
    expect.soft(admitted.ok ? 'admitted' : (admitted as { errors: string[] }).errors.join('; '), 'P04.N4 — a consistent set of position pins, off-limits marks and orders is admitted').toBe('admitted');
    const kept = (admitted as { value?: { pages: Record<string, Array<Record<string, unknown>>> } }).value?.pages.pdp?.[0];
    expect.soft([kept?.positionPins, kept?.offLimitsPieceIds], 'P04.N4 — and kept on the slot as published').toEqual([consistent.positionPins, consistent.offLimitsPieceIds]);
    const refusals: Array<[string, Record<string, unknown>, string]> = [
      ['a position below 1', { positionPins: [{ pieceId: M.ugc, position: 0 }] }, M.ugc],
      ['a position above the take', { positionPins: [{ pieceId: M.ugc, position: 5 }] }, M.ugc],
      ['two modules at one position', { positionPins: [{ pieceId: M.ugc, position: 2 }, { pieceId: M.grid, position: 2 }] }, M.grid],
      ['one module pinned twice', { positionPins: [{ pieceId: M.ugc, position: 2 }, { pieceId: M.ugc, position: 3 }] }, M.ugc],
      ['a module both pinned and off-limits', { positionPins: [{ pieceId: M.ugc, position: 2 }], offLimitsPieceIds: [M.ugc] }, M.ugc],
      ['a configured order that puts another module at a pinned position', { positionPins: [{ pieceId: M.ugc, position: 2 }], orders: [{ context: PAID_SOCIAL_FIRST, modules: [M.grid, M.reco1, M.ugc] }] }, M.ugc],
    ];
    expect(refusals.map(([name, over, offending]) => [name, errors(slots(over)).some(e => /positionPins|offLimitsPieceIds/.test(e) && e.includes(offending))]),
      `P04.N4 — each is refused with an error naming the rule and the module (${JSON.stringify(refusals.map(([name, over]) => [name, errors(slots(over))]))})`)
      .toEqual(refusals.map(([name]) => [name, true]));
  });

  for (const host of HOSTS) {
    it(`host (${host}): a retained governance-3 slots document with a prefix pin decides as before and every decision replays equal under exactly today's page markers`, async () => {
      const retained = { version: 'parity-p04-retained', governanceVersion: 3,
        pages: { pdp: [{ ...layoutSlot({ pinnedPieceIds: [M.grid] }), layout: undefined }, recentSlot()].map(s => JSON.parse(JSON.stringify(s))) } };
      // Served-v1 and without the durable recovery path: the replay reads what the real producer and consumer wrote.
      const m = await mount(host, { pieces: MODULES, slots: retained, retainedSlots: true, learn: learnDocument({ [LAYOUT]: { reward: 'click' } }) }, { recovery: false });
      expectPublished(m, 'P04.N4 — the retained governance-3 document reads');
      const s = await tabbyShopper(m);
      const set = await servePage(m, s, 'pdp', { offer: false });
      expect(set.records.filter(r => r.slot === LAYOUT).map(r => r.item_id), `${host}: P04.N4 — the retained prefix pin decides as before`).toEqual([M.grid, M.reco2, M.editorial, M.reco1]);
      await toLedger(m, set.records);
      for (const record of storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT)) {
        // LOCKED (src/content/decide.ts:514-519; the manifest src/content/consent.test.ts:629 pins): no marker beyond today's.
        expect(Object.keys(record.inputs?.replay ?? {}).sort(), `${host}: P04.N4 — the retained decision's page manifest carries exactly today's markers`)
          .toEqual(['candidateLimit', 'contentTypes', 'exploration', 'governance', 'learning', 'pins', 'slots', 'version']);
        const replay = await replayOf(m, record.decision_id);
        expect([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P04.N4 — ${record.item_id} replays equal`).toEqual([200, 'equal']);
      }
    }, 60_000);
  }
});

// ===========================================================================
// unit:P04.N5 — the record and the receipt name the rule and the position; replay; kit
// ===========================================================================

describe('unit:P04.N5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the record and the receipt of a pinned and of an off-limits module name the rule and the position, read through the route on rendered-v1 with render acknowledgements, and every decision under the rules replays equal, the replay reproducing the rule`, async () => {
      const rules = { positionPins: [{ pieceId: M.ugc, position: 3 }], offLimitsPieceIds: [M.reco1] };
      /** reco.1 held at its baseline position 2, ugc pinned at 3, the shopper's ranking at 1 and 4. */
      const RULED = [M.reco2, M.reco1, M.ugc, M.editorial];
      const RULE_OF: Record<string, unknown> = { [M.ugc]: { rule: 'pinned', position: 3 }, [M.reco1]: { rule: 'off_limits', position: 2 } };

      // The record and the receipt (R-P18): the shopper's page through the route on rendered-v1, every drawn module acknowledged.
      const m = await mount(host, { ...BASE, slots: slots(rules) });
      expectPublished(m, 'P04.N5 — the declared layout slot with a position pin and an off-limits module publishes on rendered-v1');
      const s = await tabbyShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p04-n5') });
      const drawn = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
      expect(drawn.map(d => d.contentId), `${host}: PRECONDITION — reco.1 held at 2, ugc pinned at 3, the shopper's ranking at 1 and 4`).toEqual(RULED);
      for (const d of drawn) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT && drawn.some(d => d.decisionId === r.decision_id));
      expect(records.map(r => r.item_id).sort(), `${host}: PRECONDITION — the ledger holds the shopper's four acknowledged layout decisions`).toEqual([...RULED].sort());
      expect.soft([M.ugc, M.reco1].map(item => [item, ruleOf(records.find(r => r.item_id === item)) ?? null]), `${host}: P04.N5 — each record names its rule and its position`)
        .toEqual([M.ugc, M.reco1].map(item => [item, RULE_OF[item]]));
      const receipts = (await receiptsOf(m, s.subject)).filter(r => r.slot === LAYOUT);
      expect(receipts.length, `${host}: PRECONDITION — a receipt for every acknowledged layout position`).toBe(4);
      const why = (item: string) => ((receipts.find(r => r.item === item)?.why ?? []) as string[]);
      expect.soft([why(M.ugc).some(w => /pinned/i.test(w) && /position 3\b/i.test(w)), why(M.reco1).some(w => /off-limits/i.test(w) && /position 2\b/i.test(w))],
        `${host}: P04.N5 — each receipt says the rule and the position in words (ugc: ${JSON.stringify(why(M.ugc))}; reco.1: ${JSON.stringify(why(M.reco1))})`).toEqual([true, true]);

      // The replay (R-P14): served-v1 without the durable recovery path, so the replay reads what the real producer and consumer wrote.
      const served = await mount(host, { ...BASE, slots: slots(rules), learn: learnDocument({ [LAYOUT]: { reward: 'click' } }) }, { recovery: false });
      expectPublished(served, 'P04.N5 — the same rules on a served-v1 mount without the recovery path publish');
      const other = await tabbyShopper(served);
      const set = await servePage(served, other, 'pdp', { offer: false });
      expect(set.records.filter(x => x.slot === LAYOUT).sort((a, b) => a.position - b.position).map(x => x.item_id),
        `${host}: PRECONDITION — the decision to replay is the same ruled layout`).toEqual(RULED);
      await toLedger(served, set.records);
      const stored = storedDecisions(served, other.subject).filter(x => x.slot === LAYOUT);
      expect(stored.length, `${host}: PRECONDITION — the ledger holds the four layout decisions to replay`).toBe(4);
      const replays: unknown[][] = [];
      for (const record of stored) {
        const replay = await replayOf(served, record.decision_id);
        replays.push([record.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null, ruleOf(replay.body.replayed as DecisionRecord | undefined) ?? null]);
      }
      expect(replays, `${host}: P04.N5 — a decision under position pins and off-limits marks replays equal, the replay reproducing each rule`)
        .toEqual(stored.map(record => [record.item_id, 200, 'equal', RULE_OF[record.item_id] ?? ruleOf(record) ?? null]));
    }, 90_000);
  }

  it('logic: the API reference and the payload schemas each state the position pin and the per-module off-limits rule', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'positionPins: a module pinned at any position from 1 to take is served at exactly that position',
        test: s => /positionPins/.test(s) && /position/i.test(s) && /\btake\b/.test(s) },
      { name: 'offLimitsPieceIds: an off-limits module keeps its baseline position and is not served beyond the take',
        test: s => /offLimitsPieceIds/.test(s) && /baseline|configured order|catalogue order/i.test(s) },
      { name: 'an ineligible module pinned at a position refuses the whole slot', test: s => /pinned/i.test(s) && /position/i.test(s) && /whole slot/i.test(s) },
    ]);
    expect(missing, 'P04.N5 — the kit states both rules').toEqual([]);
  });
});

// ===========================================================================
// unit:P04.N6 — the console edits position pins and off-limits marks
// ===========================================================================

describe('unit:P04.N6', () => {
  it('sdk: on the shipped slot-rules screen of the declared layout slot an operator pins a module at a position and marks a module off-limits, the screen saves both through the mounted route, the saved revision serves them, and its sentences about pins state the rule as served', async () => {
    const m = await mount('session', BASE);
    expectPublished(m, 'P04.N6 — the declared layout slot (P02) publishes');
    const c = await openConsole(m, `#/rules?scope=${TENANT}&slot=${LAYOUT}`);
    try {
      expect(c.text(), 'PRECONDITION: the rules screen is reading the declared layout slot').toContain(`${LAYOUT} on pdp`);
      const pins = [{ pieceId: M.ugc, position: 3 }], offLimits = [M.reco1];
      expect.soft(await c.type('governance.positionPins', JSON.stringify(pins)), 'P04.N6 — the screen renders a position-pin editor ([data-focus-key="governance.positionPins"])').toBe(true);
      expect.soft(await c.type('governance.offLimitsPieceIds', JSON.stringify(offLimits)), 'P04.N6 — and a per-module off-limits editor ([data-focus-key="governance.offLimitsPieceIds"])').toBe(true);
      const sentences = c.text().split(/(?<=[.!?])\s+/);
      expect.soft(sentences.some(x => /pin/i.test(x) && /(any|its|that|a) position/i.test(x) && !/first positions in exact order/i.test(x)),
        'P04.N6 — the screen says a pinned module is served at the position it is pinned at, not only in the first positions').toBe(true);
      expect.soft(sentences.some(x => /off-limits/i.test(x) && /baseline|configured order|catalogue order/i.test(x)),
        'P04.N6 — and that an off-limits module keeps its baseline position').toBe(true);
      await c.save();
      expect(c.puts().length, 'P04.N6 — the console saved through PUT /content/slots').toBe(1);
      const stored = (await loadSlots(m)).document as { pages: Record<string, Array<Record<string, unknown>>> };
      const slot = stored.pages.pdp?.find(x => x.slot === LAYOUT);
      expect([slot?.positionPins, slot?.offLimitsPieceIds], 'P04.N6 — the platform stored exactly what the operator authored').toEqual([pins, offLimits]);
      expect(await layoutOf(await tabbyShopper(m), 'p04-n6'), 'P04.N6 — and the saved revision serves it').toEqual([M.reco2, M.reco1, M.ugc, M.editorial]);
    } finally { c.close(); }
  }, 90_000);
});

