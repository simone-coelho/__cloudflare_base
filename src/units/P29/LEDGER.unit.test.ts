// src/units/P29/LEDGER.unit.test.ts
// P29 under the Closure Ledger: the tests for the LOCAL criteria of the P29 work
// order (`tapestry-parity-build`, ticket P29 "A layout reason: why the order did
// or did not change"). DC1 and DC2 (decisions D1, D2) are ruled and exercised
// inside R2 and R4; LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P29.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P29 in section E): "every
//     layout decision set, record and receipt carries one closed reason for
//     'unchanged' against the baseline (pinned; off-limits; holdout or consent;
//     below the signal floor; blend or trust at zero; no level reached nMin, with
//     the n it has and the nMin it needs; zero base; ties broken by catalogue
//     order; nothing else eligible), or 'changed' with the term that moved each
//     module; the sentence 'no interest signal yet for this shopper' is printed
//     only when the shopper has no interest at all, and otherwise reads 'no
//     interest on the dimensions this layout weights'; an off-limits slot writes
//     a record. The reason rides the warehouse export";
//   · freeze sheet item 9 (D1: the vocabulary frozen as written, extensible by
//     P04, P05, P11, P30 and P31, never asserted complete; D2: the off-limits
//     slot's record kept outside the decision ring so W20.G2.03 holds) and item
//     44 ("the off-limits slot's record goes to the ledger and the export but
//     never into the shopper's decision ring");
//   · the investigation, sections C4 and G-B (C4: "a layout-level answer that
//     compares the served order with the baseline and gives one reason for the
//     whole layout");
//   · the existing contract: src/learn/receipts.ts:126 (the sentence printed
//     today), src/content/decide.ts:533-573 (the record), src/ledger/erasure.ts:3
//     (the R2 decision partition is the warehouse's export).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   The BASELINE is P04's: the configured order for the shopper's context, else
//   the slot's eligible modules in catalogue order. The reason is one object,
//   `layoutReason`, on the decision set (with `slot`), on every record of the
//   layout slot (`explain.layoutReason`) and on every receipt (`layoutReason`):
//   `{ slot, status: 'unchanged', cause, ... }` or `{ slot, status: 'changed',
//   moves: [{ module, from, to, term }] }`, positions counted from 1 (P04's
//   count), `term` naming the engine term that moved it (`affinity` for their
//   interests). The cause words: `pinned`, `off_limits`, `holdout_or_consent`,
//   `below_signal_floor`, `blend_or_trust_zero`, `no_level_reached_nmin` (with
//   `n` and `nMin`), `zero_base`, `catalogue_order_ties`,
//   `nothing_else_eligible`. "Exactly one cause": where several hold, the first
//   in the ticket's own order is the cause; each scenario below is built so its
//   cause is the first that holds, and the header of R2 names what each
//   scenario rules out.
//   R1  A changed layout (the shopper's Tabby interests) and an unchanged one (every
//       position pinned) carry the same reason on the set, every record and
//       every receipt; the changed one names reco.2 (3 → 1) and editorial.1
//       (4 → 2), moved by `affinity`. The layout is measured on rendered-v1 and
//       the receipts are read through the route after a render acknowledgement
//       of every drawn module, as R5 reads the export (R-P18: a declared
//       served-v1 layout is never captured at serve time, P02.A3 D1).
//       R-P56 (fix round 1): a moved module names the term that changed its
//       place relative to the modules it passed (moved up) or that passed it
//       (moved down), the learned lift included. Four modules of identical
//       interest (EQUAL) at γ 1 on rendered-v1, so the one term by which they
//       differ is the lift a merchandiser froze: (a) story.3 frozen at 2 (the
//       delivery review's probe C4c) passes story.1 and story.2, and all three
//       moves name `lift`; (b) story.1 frozen at 0.5 (probe C4f) is passed by
//       story.2, story.3 and story.4, and all four moves name `lift`; the whole
//       `moves` list is asserted, keys sorted (so a module moved down is never
//       left out), on the set, every record and every receipt. The control:
//       every module frozen at the same lift is unchanged, its one cause
//       `catalogue_order_ties` (D1's order; R2's tie scenario).
//   R2  Each cause from its own scenario, on both hosts.
//   R3  A shopper with no interest at all reads "No interest signal yet for this
//       shopper"; a shopper whose only interest is on a dimension the layout
//       does not weight reads "no interest on the dimensions this layout
//       weights" and not the first sentence. The receipts are read as R1 reads
//       them, and four receipts per shopper are a precondition (R-P18), so
//       neither clause can pass on none.
//   R4  An off-limits layout slot writes a record with the off-limits cause into
//       the ledger, never into the shopper's ring: no receipt, no exposure; a slot whose
//       pin is refused still has no receipt (unit:W20.G2.03).
//   R5  The record in the R2 decision partition carries the reason exactly as
//       the decision set states it; docs/kit/02 and 03 document the reason, its
//       two statuses and each cause word.
//       R-P56: both kit documents state that a move names the term that changed
//       the module's place relative to the modules it passed or that passed it
//       (02:414-416, 03:656-658), and the API reference names an unreadable
//       record among `holdout_or_consent` (02:399, reading 8); stable words, so
//       the sentences are the implementer's to phrase.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `layoutReason` on the decision set, the record's explain and the receipt. No
// new export is imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts) and
// src/units/_parity2.ts (a learned ladder through the real fan-in and the real
// statistics objects).

import { describe, expect, it } from 'vitest';

import type { DecisionRecord } from '@/content/types';

import {
  declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf,
  productView, receiptsOf, recentSlot, RECENT_SLOT, rounded, servedIn, servePage, shopperOn, storedDecisions, TABBY_VIEWS, type Mounted, type Shopper,
} from '../_parity';
import { learnedLadder, missingStatements } from '../_parity2';

const slots = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => declaredSlots([layoutSlot(over), recentSlot()], extra);
const COLD = [M.grid, M.reco1, M.reco2, M.editorial];
/** Four modules that carry the same tag, so the shopper's Tabby interest gives each the same base. */
const EQUAL = [1, 2, 3, 4].map(i => ({ id: `module.PDP.story.${i}`, customerContentId: `TAP-PDP-STORY-${i}`, type: 'editorial', title: `Story ${i}`,
  tags: { line: ['Tabby'] }, slotTypes: [LAYOUT], journeyStageFit: ['considering'], lifecycle: { status: 'live' } }));
const EQUAL_IDS = EQUAL.map(p => p.id);
const LADDER_CELL = { channel: 'paid_social', visit_bucket: '1' as const, region: null, affinity: null, stage: 'mid' as const };
/** The layout on served-v1 with γ 1 (unless named), so the published ladder is the lift the decision reads. */
const servedLearn = (dials: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => learnDocument({ [LAYOUT]: { reward: 'click', gamma: 1, ...dials } }, extra);

async function shopper(m: Mounted, views = TABBY_VIEWS.slice(0, 3), consent?: { tracking: boolean; personalization: boolean }): Promise<Shopper> {
  const s = await shopperOn(m, consent ?? { tracking: true, personalization: true });
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: the shopper's page view is accepted`).toBe(200);
  for (const view of views) expect((await s.action(view)).status, `${m.host}: the shopper's view is accepted`).toBe(200);
  return s;
}
type Reason = Record<string, unknown>;
const reasonOfSet = (set: unknown): Reason | string => ((set as { layoutReason?: Reason }).layoutReason) ?? `the decision set carries no layoutReason (it carries ${Object.keys(set as object).join(', ')})`;
const reasonOf = (r: DecisionRecord | undefined): Reason | undefined => (r?.explain as Record<string, unknown> | undefined)?.layoutReason as Reason | undefined;
/** The shopper's interest is only a silhouette, a dimension the layout slot does not weight (line, category, occasion): a product the bundled Coach catalogue does not hold, so the event teaches only what it carries. */
const SILHOUETTE_ONLY = productView({ productId: 'COA-ZZ901', silhouette: 'shoulder' });
/**
 * R-P18: the shopper's page through the route on rendered-v1 (P02 decision D1), every drawn layout module acknowledged as the SDK
 * acknowledges what it painted, the ledger drained through the real consumer; then the shopper's receipts of the layout slot,
 * read through the operator route. A declared served-v1 layout is never captured at serve time, so this is how the
 * shopper's receipts of a layout come to exist. Used by R1 and R3; R2, R4 and R5 are unchanged.
 */
async function acknowledgedReceipts(m: Mounted, s: Shopper, label: string): Promise<Array<Record<string, unknown>>> {
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `${m.host}: ${d.contentId} acknowledged`).toBe(200);
  await m.drainLedger();
  return (await receiptsOf(m, s.subject)).filter(r => r.slot === LAYOUT);
}
/** R-P56: the layout on rendered-v1 (so its receipts exist once acknowledged, R-P18) with γ 1 and the named dials. */
const renderedLearn = (dials: Record<string, unknown> = {}) => learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', gamma: 1, ...dials } });
/** A value as its keys are written, in order, so an assertion holds the keys sorted as the kit states (02:394-396, 03:641-642). */
const keyed = (v: unknown): unknown => (Array.isArray(v) ? v.map(keyed)
  : v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, keyed(x)]) : v);
/** A reason as keyed, its moves taken by served position (the witness does not order the list; it lists every move). */
const byPlace = (reason: Reason | string): unknown => (typeof reason === 'string' || !Array.isArray(reason.moves) ? keyed(reason)
  : keyed({ ...reason, moves: [...(reason.moves as Array<{ to: number }>)].sort((a, b) => a.to - b.to) }));

// ===========================================================================
// unit:P29.R1 — one reason on the set, every record and every receipt
// ===========================================================================

describe('unit:P29.R1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): every layout decision set, each of its records and each receipt carry one layout reason — changed, with the term that moved each module, or unchanged with one cause — the receipts read through the route on rendered-v1 with render acknowledgements`, async () => {
      const worlds: Array<[string, Record<string, unknown>]> = [['changed', {}], ['unchanged (every position pinned)', { pinnedPieceIds: COLD }]];
      for (const [name, over] of worlds) {
        // Rendered-v1 (P02 decision D1): the shopper's receipts exist once the page acknowledges what it drew (R-P18).
        const m = await mount(host, { pieces: MODULES, slots: slots(over), learn: learnDocument() });
        expectPublished(m, `P29.R1 (${name}) — the declared layout slot publishes`);
        const s = await shopper(m);
        const set = await servePage(m, s, 'pdp');
        const reason = reasonOfSet(set);
        if (name === 'changed') {
          expect.soft(reason, `${host}: P29.R1 — the shopper's Tabby interests changed the order: reco.2 from 3 to 1 and editorial.1 from 4 to 2, moved by the shopper's affinity`).toMatchObject({
            slot: LAYOUT, status: 'changed', moves: expect.arrayContaining([
              expect.objectContaining({ module: M.reco2, from: 3, to: 1, term: 'affinity' }), expect.objectContaining({ module: M.editorial, from: 4, to: 2, term: 'affinity' })]) });
        } else {
          expect.soft(typeof (reason as Reason).cause === 'string' ? [(reason as Reason).status, 'one cause'] : reason,
            `${host}: P29.R1 — an unchanged layout states exactly one cause`).toEqual(['unchanged', 'one cause']);
        }
        const records = set.records.filter(r => r.slot === LAYOUT);
        expect.soft(records.map(r => [r.item_id, reasonOf(r) ?? null]), `${host}: P29.R1 (${name}) — every record of the layout carries the set's reason`)
          .toEqual(records.map(r => [r.item_id, typeof reason === 'string' ? 'the set’s reason' : reason]));
        const receipts = await acknowledgedReceipts(m, s, name === 'changed' ? 'p29-r1-changed' : 'p29-r1-pinned');
        expect(receipts.length, `${host}: PRECONDITION — a receipt for every acknowledged layout position`).toBe(4);
        expect.soft(receipts.map(r => [r.item, r.layoutReason ?? null]), `${host}: P29.R1 (${name}) — and every receipt`)
          .toEqual(receipts.map(r => [r.item, typeof reason === 'string' ? 'the set’s reason' : reason]));
      }
    }, 60_000);

    // R-P56: the learned lift is a term that moves a module. EQUAL gives every module the same interest, so the lift is the
    // only term by which one differs from another; ties between equal scores are broken by catalogue order (D1).
    it(`host (${host}): R-P56 — a module moved by its lift names the term lift, as does every module it passed or that passed it: the whole moves list, keys sorted, on the decision set, every record and every receipt (rendered-v1, read through the route with render acknowledgements)`, async () => {
      const [s1, s2, s3, s4] = EQUAL_IDS as [string, string, string, string];
      const worlds: Array<{ name: string; label: string; items: Record<string, unknown>; served: string[]; moves: Array<[string, number, number]>; says: string }> = [
        { name: 'story.3 frozen at a lift of 2', label: 'p29-r1-lift-up', items: { [s3]: { mode: 'freeze', lift: 2 } }, served: [s3, s1, s2, s4],
          moves: [[s3, 3, 1], [s1, 1, 2], [s2, 2, 3]],
          says: 'story.3 moved from 3 to 1 by its lift of 2, past story.1 (1 → 2) and story.2 (2 → 3), each move named lift; story.4 keeps position 4 and is not listed' },
        { name: 'story.1 frozen at a lift of 0.5', label: 'p29-r1-lift-down', items: { [s1]: { mode: 'freeze', lift: 0.5 } }, served: [s2, s3, s4, s1],
          moves: [[s2, 2, 1], [s3, 3, 2], [s4, 4, 3], [s1, 1, 4]],
          says: 'story.2 (2 → 1), story.3 (3 → 2) and story.4 (4 → 3) each passed story.1, whose lift of 0.5 moved it from 1 to 4; every move named lift, nothing else listed' },
      ];
      for (const world of worlds) {
        const m = await mount(host, { pieces: EQUAL, slots: slots(), learn: renderedLearn({ items: world.items }) });
        expectPublished(m, `P29.R1 (R-P56, ${world.name}) — the declared layout slot and the frozen lift publish`);
        const s = await shopper(m);
        const set = await servePage(m, s, 'pdp');
        const records = set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
        expect(records.map(r => r.item_id), `${host}: PRECONDITION (${world.name}) — the frozen lift at γ 1 orders the four equal modules, ties in catalogue order`).toEqual(world.served);
        const reason = reasonOfSet(set);
        const expected = { moves: world.moves.map(([module, from, to]) => ({ from, module, term: 'lift', to })), slot: LAYOUT, status: 'changed' };
        expect.soft(byPlace(reason), `${host}: P29.R1 (R-P56, ${world.name}) — ${world.says}`).toEqual(keyed(expected));
        expect.soft(records.map(r => [r.item_id, keyed(reasonOf(r) ?? null)]), `${host}: P29.R1 (R-P56, ${world.name}) — every record of the layout carries the set's reason, keys sorted`)
          .toEqual(records.map(r => [r.item_id, typeof reason === 'string' ? 'the set’s reason' : keyed(reason)]));
        const receipts = await acknowledgedReceipts(m, s, world.label);
        expect(receipts.length, `${host}: PRECONDITION (${world.name}) — a receipt for every acknowledged layout position`).toBe(4);
        expect.soft(receipts.map(r => [r.item, keyed(r.layoutReason ?? null)]), `${host}: P29.R1 (R-P56, ${world.name}) — and every receipt, read through the route`)
          .toEqual(receipts.map(r => [r.item, typeof reason === 'string' ? 'the set’s reason' : keyed(reason)]));
      }
    }, 60_000);

    it(`host (${host}): R-P56 control — the same four modules with every lift answered equal (each frozen at 2) are unchanged against the baseline with one cause, catalogue_order_ties, on the decision set, every record and every receipt`, async () => {
      const m = await mount(host, { pieces: EQUAL, slots: slots(), learn: renderedLearn({ items: Object.fromEntries(EQUAL_IDS.map(id => [id, { mode: 'freeze', lift: 2 }])) }) });
      expectPublished(m, 'P29.R1 (R-P56 control) — the declared layout slot and the equal frozen lifts publish');
      const s = await shopper(m);
      const set = await servePage(m, s, 'pdp');
      const records = set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      expect(records.map(r => r.item_id), `${host}: PRECONDITION (control) — equal lifts leave the four equal modules in catalogue order`).toEqual(EQUAL_IDS);
      const reason = reasonOfSet(set);
      expect.soft(keyed(reason), `${host}: P29.R1 (R-P56 control) — every lift answered equal: unchanged, its one cause the tie broken by catalogue order`)
        .toEqual(keyed({ cause: 'catalogue_order_ties', slot: LAYOUT, status: 'unchanged' }));
      expect.soft(records.map(r => [r.item_id, keyed(reasonOf(r) ?? null)]), `${host}: P29.R1 (R-P56 control) — every record of the layout carries the set's reason`)
        .toEqual(records.map(r => [r.item_id, typeof reason === 'string' ? 'the set’s reason' : keyed(reason)]));
      const receipts = await acknowledgedReceipts(m, s, 'p29-r1-lift-equal');
      expect(receipts.length, `${host}: PRECONDITION (control) — a receipt for every acknowledged layout position`).toBe(4);
      expect.soft(receipts.map(r => [r.item, keyed(r.layoutReason ?? null)]), `${host}: P29.R1 (R-P56 control) — and every receipt, read through the route`)
        .toEqual(receipts.map(r => [r.item, typeof reason === 'string' ? 'the set’s reason' : keyed(reason)]));
    }, 60_000);
  }
});

// ===========================================================================
// unit:P29.R2 — each cause from its own scenario
// ===========================================================================
//
// What each scenario rules out (the ticket's order decides when several hold):
//   pinned            — every position pinned: nothing is ranked.
//   off_limits        — the slot is off-limits: nothing is ranked.
//   holdout_or_consent — the holdout's default arm; personalization refused.
//   below_signal_floor — a tenant floor of 10 (P10) above the shopper's three signals.
//   blend_or_trust_zero — four equally-tagged modules, the third frozen at a lift
//                       of 2 that would lead at any γ above 0; γ is 0.
//   no_level_reached_nmin — the same modules at γ 1, 10 exposures each (nMin 30).
//   zero_base         — the shopper's only interest is unweighted; γ 1; 40 exposures each
//                       reach nMin; reco.1 frozen at 2, which a zero base cannot use.
//   catalogue_order_ties — the four equal modules at γ 1, 40 exposures each, so
//                       every score ties.
//   nothing_else_eligible — one eligible module (the other three expired) at γ 1
//                       with 40 exposures.

describe('unit:P29.R2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): each cause of decision D1 is produced by its own scenario — the cause per scenario, never the list as complete`, async () => {
      const outcomes: Array<[string, unknown, Reason]> = [];
      const scenario = async (cause: string, docs: { pieces?: unknown[]; slots: unknown; learn: unknown }, expected: Reason,
        prepare: (m: Mounted) => Promise<void> = async () => undefined, who: (m: Mounted) => Promise<Shopper> = m => shopper(m)) => {
        const m = await mount(host, { pieces: docs.pieces ?? MODULES, slots: docs.slots, learn: docs.learn });
        expectPublished(m, `P29.R2 (${cause}) — the scenario's documents publish`);
        await prepare(m);
        const set = await servePage(m, await who(m), 'pdp');
        outcomes.push([cause, reasonOfSet(set), expected]);
      };
      const ladder = (items: string[], exposures: number) => (m: Mounted) => learnedLadder(m, LAYOUT, items.map(item => ({ item, exposures })), LADDER_CELL);
      await scenario('pinned', { slots: slots({ pinnedPieceIds: COLD }), learn: learnDocument() }, { status: 'unchanged', cause: 'pinned' });
      await scenario('off_limits', { slots: slots({ offLimits: true }), learn: learnDocument() }, { status: 'unchanged', cause: 'off_limits' });
      await scenario('holdout_or_consent (holdout)', { slots: slots(), learn: learnDocument({}, { holdout: { share: 1, salt: 'p29', arms: ['default'] } }) },
        { status: 'unchanged', cause: 'holdout_or_consent' });
      await scenario('holdout_or_consent (consent)', { slots: slots(), learn: learnDocument() }, { status: 'unchanged', cause: 'holdout_or_consent' },
        undefined, m => shopper(m, TABBY_VIEWS.slice(0, 3), { tracking: true, personalization: false }));
      await scenario('below_signal_floor', { slots: slots({}, { signalFloor: 10 }), learn: learnDocument() }, { status: 'unchanged', cause: 'below_signal_floor' });
      await scenario('blend_or_trust_zero', { pieces: EQUAL, slots: slots(), learn: servedLearn({ gamma: 0, items: { [EQUAL_IDS[2]!]: { mode: 'freeze', lift: 2 } } }) },
        { status: 'unchanged', cause: 'blend_or_trust_zero' });
      await scenario('no_level_reached_nmin', { pieces: EQUAL, slots: slots(), learn: servedLearn() }, { status: 'unchanged', cause: 'no_level_reached_nmin', n: 10, nMin: 30 },
        ladder(EQUAL_IDS, 10));
      await scenario('zero_base', { slots: slots(), learn: servedLearn({ items: { [M.reco1]: { mode: 'freeze', lift: 2 } } }) }, { status: 'unchanged', cause: 'zero_base' },
        ladder([M.grid, M.reco1, M.reco2, M.editorial, M.ugc], 40), m => shopper(m, [SILHOUETTE_ONLY]));
      await scenario('catalogue_order_ties', { pieces: EQUAL, slots: slots(), learn: servedLearn() }, { status: 'unchanged', cause: 'catalogue_order_ties' }, ladder(EQUAL_IDS, 40));
      await scenario('nothing_else_eligible', { pieces: EQUAL.map((p, i) => i ? { ...p, lifecycle: { status: 'expired' } } : p), slots: slots(), learn: servedLearn() },
        { status: 'unchanged', cause: 'nothing_else_eligible' }, ladder([EQUAL_IDS[0]!], 40));
      const shown = outcomes.map(([cause, reason]) => [cause, typeof reason === 'string' ? reason
        : { status: (reason as Reason).status, cause: (reason as Reason).cause, ...('nMin' in (reason as Reason) ? { n: Math.round(Number((reason as Reason).n)), nMin: (reason as Reason).nMin } : {}) }]);
      expect(shown, `${host}: P29.R2 — each scenario names its own cause`).toEqual(outcomes.map(([cause, , expected]) => [cause, expected]));
    }, 120_000);
  }
});

// ===========================================================================
// unit:P29.R3 — the no-interest sentence is true
// ===========================================================================

describe('unit:P29.R3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): "no interest signal yet for this shopper" is printed only for a shopper with no interest at all, and a shopper whose interests lie on no dimension the layout weights reads "no interest on the dimensions this layout weights" — four receipts per shopper, read through the route on rendered-v1 with render acknowledgements`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: slots(), learn: learnDocument() });
      expectPublished(m, 'P29.R3 — the declared layout slot publishes');
      const none = await shopper(m, []), elsewhere = await shopper(m, [SILHOUETTE_ONLY]);
      const taste = (await elsewhere.hydrate()).body as { affinity?: { dims?: Record<string, Record<string, number>> } };
      expect(Object.keys(taste.affinity?.dims ?? {}), `${host}: PRECONDITION — the shopper's only interest is the silhouette`).toEqual(['silhouette']);
      const why = async (s: Shopper, who: string) => {
        const receipts = await acknowledgedReceipts(m, s, `p29-r3-${who}`);
        // R-P18: four receipts per shopper, so neither clause below can pass on none.
        expect(receipts.length, `${host}: PRECONDITION — four receipts for the ${who} shopper's four acknowledged layout positions`).toBe(4);
        return receipts.map(r => ({ item: r.item, why: (r.why as string[]).join(' ') }));
      };
      const cold = await why(none, 'cold'), unweighted = await why(elsewhere, 'unweighted');
      expect.soft(cold.map(r => [r.item, /No interest signal yet for this shopper/.test(r.why)]), `${host}: P29.R3 — the shopper with no interest at all reads that the shopper has none`)
        .toEqual(cold.map(r => [r.item, true]));
      expect(unweighted.map(r => [r.item, /no interest on the dimensions this layout weights/i.test(r.why), /No interest signal yet for this shopper/.test(r.why)]),
        `${host}: P29.R3 — the shopper whose interest lies off the layout's dimensions reads that, not that the shopper has no interest (${JSON.stringify(unweighted[0]?.why)})`)
        .toEqual(unweighted.map(r => [r.item, true, false]));
    }, 60_000);
  }
});

// ===========================================================================
// unit:P29.R4 — an off-limits slot writes a record, outside the ring (D2)
// ===========================================================================

describe('unit:P29.R4', () => {
  const STORY = 'pdp-story';
  const STORY_PIECE = { id: 'story.tabby', customerContentId: 'TAP-STORY-TABBY', type: 'editorial', title: 'Tabby story', tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' } };
  for (const host of HOSTS) {
    it(`host (${host}): decision D2 — an off-limits layout slot writes a record naming the off-limits cause into the ledger and never into the shopper's decision ring, so it carries no exposure and no receipt, and a refused slot still has no receipt`, async () => {
      const page = declaredSlots([layoutSlot({ offLimits: true }), recentSlot({ pinnedPieceIds: [M.lookbook] }), { slot: STORY, take: 1, weights: { line: 1 } }]);
      const m = await mount(host, { pieces: [...MODULES, STORY_PIECE], slots: page, learn: learnDocument({ [STORY]: { measurementBasis: 'rendered-v1', reward: 'click' } }) });
      expectPublished(m, 'P29.R4 — an off-limits declared layout slot, a refused pin and a story slot publish');
      const s = await shopper(m);
      const snap = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p29-r4') });
      expect([servedIn(snap, LAYOUT), servedIn(snap, RECENT_SLOT), servedIn(snap, STORY)], `${host}: PRECONDITION — nothing from the off-limits or the refused slot; the story is served`)
        .toEqual([[], [], ['story.tabby']]);
      for (const d of snap.decisions) expect((await s.ack(snap, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const ledger = storedDecisions(m, s.subject);
      expect.soft(ledger.filter(r => r.slot === LAYOUT).map(r => reasonOf(r) ?? null), `${host}: P29.R4 — the ledger holds the off-limits slot's record, naming the off-limits cause`)
        .toEqual([expect.objectContaining({ status: 'unchanged', cause: 'off_limits' })]);
      const receipts = await receiptsOf(m, s.subject);
      expect(receipts.filter(r => r.slot === STORY).length, `${host}: CONTROL — the served story has its receipt`).toBe(1);
      expect.soft(receipts.filter(r => r.slot === LAYOUT || r.slot === RECENT_SLOT).map(r => `${String(r.slot)}:${String(r.item)}`),
        `${host}: P29.R4 — no receipt reads the off-limits record, and the refused slot has none (unit:W20.G2.03)`).toEqual([]);
      const exposures = rounded(await learned(m), 'n');
      expect(MODULES.map(p => p.id).filter(id => exposures[id] !== undefined), `${host}: P29.R4 — and the off-limits record carries no exposure`).toEqual([]);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P29.R5 — the reason rides the export unchanged; the kit documents it
// ===========================================================================

describe('unit:P29.R5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the layout reason rides the decision record into the warehouse export (the R2 decision partition) exactly as the decision set states it`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: slots(), learn: learnDocument() });
      expectPublished(m, 'P29.R5 — the declared layout slot publishes');
      const s = await shopper(m);
      const reason = reasonOfSet(await servePage(m, s, 'pdp'));
      const snap = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p29-r5') });
      for (const d of snap.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(snap, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const exported = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT && snap.decisions.some(d => d.decisionId === r.decision_id));
      expect(exported.length, `${host}: PRECONDITION — the export holds the shopper's four layout decisions`).toBe(4);
      expect(exported.map(r => [r.item_id, reasonOf(r) ?? null]), `${host}: P29.R5 — each exported record carries the reason the decision set stated, unchanged`)
        .toEqual(exported.map(r => [r.item_id, typeof reason === 'string' ? 'the set’s reason' : reason]));
    }, 60_000);
  }

  it('logic: the API reference and the payload schemas each document the layout reason, its two statuses and every cause word', () => {
    const causes = ['pinned', 'off_limits', 'holdout_or_consent', 'below_signal_floor', 'blend_or_trust_zero', 'no_level_reached_nmin', 'zero_base', 'catalogue_order_ties', 'nothing_else_eligible'];
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'layoutReason, unchanged or changed', test: x => /layoutReason/.test(x) && /\bunchanged\b/.test(x) && /\bchanged\b/.test(x.replace(/unchanged/g, '')) },
      { name: 'the moved module, its positions and the term that moved it', test: x => /moves?/i.test(x) && /\bterm\b/.test(x) },
      ...causes.map(cause => ({ name: `the cause ${cause}`, test: (x: string) => x.includes(cause) })),
    ]);
    expect(missing, 'P29.R5 — the kit documents the reason and its causes').toEqual([]);
  });

  it('logic: R-P56 — the API reference and the payload schemas state that a move names the term that changed the module’s place relative to the modules it passed or that passed it, and the API reference names an unreadable record among holdout_or_consent', () => {
    const missing = [
      ...missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
        { name: 'a move names the term that changed the module’s place relative to the modules it passed or that passed it (R-P56)',
          test: x => /\bterm\b/.test(x) && /\bit passed\b/i.test(x) && /\bpassed (it|by)\b/i.test(x) },
      ]),
      ...missingStatements(['docs/kit/02-api-reference.md'], [
        { name: 'an unreadable record is among holdout_or_consent (R-P56, reading 8)',
          test: x => x.includes('holdout_or_consent') && /\bunreadable\b/i.test(x)
            && (!x.includes('below_signal_floor') || /holdout_or_consent[^]*?\bunreadable\b[^]*?below_signal_floor/i.test(x)) },
      ]),
    ];
    expect(missing, 'P29.R5 (R-P56) — the kit states the move-term rule and names the unreadable record').toEqual([]);
  });
});
