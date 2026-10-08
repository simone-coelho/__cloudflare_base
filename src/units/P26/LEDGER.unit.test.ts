// src/units/P26/LEDGER.unit.test.ts
// P26 under the Closure Ledger: the tests for the LOCAL criteria of the P26 work
// order (`tapestry-parity-build`, ticket P26 "Content chosen inside each module").
// DC1 (D1: the nesting representation is the specifier's to rule) is ruled below;
// LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P26.<criterion>')` per LOCAL criterion. Expected values
// come from the witnesses, never from what the engine answers today:
//   · the work order's authority (docs/BTI-Parity-Build-Tickets.md, P26 in
//     section D): "a module's inner content slot is decided per shopper within
//     the same page decision as the module order, with page-wide
//     de-duplication and one receipt set";
//   · the parity document, section 3.9 (cited by number only): the module
//     becomes the slot, and its pieces become the items;
//   · the investigation, section G-B, the table of levels ("Inside a module: its
//     own content slot carries the full slot set; nesting the two decisions is
//     P26 | the slots document");
//   · freeze sheet item 30 (the representation is the specifier's, judged by
//     rem-reviewer);
//   · the existing contract the work order cites: src/content/types.ts:154-159
//     (the slots document is keyed by page), src/reflex/contentCompose.ts:136-339
//     (one composition decides every slot of a page in page order with
//     page-wide de-duplication; ties to catalogue order).
//
// THE NESTING REPRESENTATION, RULED (D1):
//   · An inner content slot is an ordinary slot of the same page in the slots
//     document, carrying the full slot set (take, weights, pins, exclusions, …).
//   · The page's declared layout slot (`layout: true`, governanceVersion 4: the
//     S1 representation) carries `inner: { [moduleId]: innerSlotName }`: which
//     module's content each inner slot is.
//   · Publication (validateSlotCatalog, and so every slots write) refuses, with an
//     error naming `pages.<page>[i].inner`: `inner` on a slot that is not a
//     declared layout slot; a value naming no slot of the same page; a value
//     naming a layout slot (itself included); one inner slot named for two
//     modules; and a key naming a module the published catalogue does not define
//     as a candidate of that layout slot (a piece naming it in `slotTypes`).
//   · Composition, within the one page decision: the page's slots in document
//     order, except that an inner slot is decided only directly after its layout
//     slot, in the order the layout returned its modules, and only when its module
//     was returned; an inner slot whose module was not returned is not decided at
//     all and writes no record. Page-wide de-duplication spans the layout, every
//     inner slot and every other slot of the page.
//   · Every inner decision carries `within: { slot: <layout slot>, module }`, on
//     the snapshot answer and on its record (sorted keys, R-P3). The page's
//     decisions, layout and inner alike, are one receipt set: one composition,
//     one `ts`, one page manifest naming every slot decided, each record replaying
//     equal.
//
// NO NEW EXPORT IS IMPORTED; `inner` and `within` are read loosely.
//
// PRECONDITION (S1's R-P6): every host leg publishes a declared layout document
// (governanceVersion 4), refused until P02 lands; each clause behind it is
// measured with governance version 4 made readable on a scratch copy (the S3
// review's G4 patch; S3-fix/specifier/logs/probe-P26-g4*.log).
//
// BOUNDARY (R-P24): src/routes/content.ts is in P26's allowed paths. The refusal
// of an `inner` key naming a module the published catalogue does not define is
// a cross-document check made at publication where P01.O5's unregistered-module
// refusal is made (the slots PUT, src/routes/content.ts); the refusal of an
// inner slot the page does not define is the slots validator's
// (src/content/kinds.ts, validateSlotCatalog).
//
// DOCUMENT ORDER (NC2, R-P38). The fixture defines the editorial module's inner
// slot BEFORE complete-the-look's, while the layout returns complete-the-look
// first: only "in the order the layout returned its modules" gives
// complete-the-look's inner slot the wallet; deciding the inner slots in
// document order — directly after the layout or where they stand — gives the
// story slot the wallet and complete-the-look the charm alone.
//
// R10 (tests that lock present behaviour, listed for the lead):
//   · src/content/consent.test.ts:629 and src/learn/phase3.test.ts:438 pin the
//     manifest of a page without nesting; NC4's retained leg keeps it.
//   · src/reflex/contentCompose.test.ts asserts document-order composition for
//     pages without `inner`; unchanged by the ruling (only inner slots move).

import { describe, expect, it } from 'vitest';

import { validateSlotCatalog } from '@/content/kinds';
import type { DecisionRecord } from '@/content/types';

import {
  expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount, PAID_SOCIAL_ENTRY, PAGE_VIEW, pageInstanceOf, putDocument,
  recentSlot, RECENT_SLOT, replayOf, servedIn, servePage, shopperOn, storedDecisions, TABBY_VIEWS, toLedger, type Host, type Mounted,
} from '../_parity';
import { missingStatements } from '../_parity3';

const HERO = 'pdp-hero', FOOTER = 'pdp-footer', CTL = 'pdp-ctl-items', STORY = 'pdp-story-items', UGC = 'pdp-ugc-items';
const piece = (id: string, slotTypes: string[], type = 'editorial', tags: Record<string, string[]> = { line: ['Tabby'] }) => ({ id,
  customerContentId: `TAP-${id.replace(/\./g, '-').toUpperCase()}`, type, title: id, tags, slotTypes, lifecycle: { status: 'live' } });
/** The content pieces, in catalogue order, after the modules. */
const P_HERO = 'piece.tabby.hero', P_WALLET = 'piece.tabby.wallet', P_CHARM = 'piece.tabby.charm', P_VIDEO = 'piece.tabby.video', P_STREET = 'piece.ugc.street', P_FOOTER = 'piece.tabby.footer';
const CONTENT = [
  piece(P_HERO, [HERO, CTL], 'on-model'),
  piece(P_WALLET, [CTL, STORY, FOOTER], 'silo'),
  piece(P_CHARM, [CTL], 'flat-lay'),
  piece(P_VIDEO, [STORY], 'video'),
  piece(P_STREET, [UGC], 'user-generated'),
  piece(P_FOOTER, [FOOTER]),
];
const PIECES = [...MODULES, ...CONTENT];
const INNER = { [M.reco2]: CTL, [M.editorial]: STORY, [M.ugc]: UGC };
const contentSlot = (slot: string, take: number) => ({ slot, take, weights: { line: 1 } });
/**
 * The product page: a hero, the declared layout with its modules' inner slots, a footer, the recently-viewed slot, and the inner
 * slots defined last — the editorial module's (story) BEFORE complete-the-look's, the reverse of the order the layout returns them.
 */
const pdp = (layoutOver: Record<string, unknown> = { inner: INNER }) => [contentSlot(HERO, 1), layoutSlot(layoutOver), contentSlot(FOOTER, 1), recentSlot(),
  contentSlot(STORY, 1), contentSlot(CTL, 2), contentSlot(UGC, 1)];
const NESTED = { version: 'parity-p26-slots', governanceVersion: 4, pages: { pdp: pdp() } };
const learnOf = (basis: 'served-v1' | 'rendered-v1') => learnDocument(Object.fromEntries([HERO, LAYOUT, FOOTER, CTL, STORY, UGC].map(s => [s, { measurementBasis: basis, reward: 'click' }])),
  {}) as Record<string, unknown>;

/**
 * After three Tabby views (a = 0.625 on line Tabby, category Handbags, occasion evening):
 *   hero:   piece.tabby.hero (first Tabby piece in catalogue order)
 *   layout: reco.2, editorial.1, grid.1, reco.1 (P02's ranked layout; ugc.1, fifth, is not returned)
 *   then, directly after the layout and in ITS order (not the document's), the inner slots of the returned modules:
 *     reco.2 → pdp-ctl-items (take 2): hero piece already served → wallet, charm
 *     editorial.1 → pdp-story-items (take 1): wallet already served → video
 *   footer: wallet already served → piece.tabby.footer
 *   ugc.1 was not returned → pdp-ugc-items is not decided: piece.ugc.street is never served or recorded.
 * In document order the story slot would come first and take the wallet (it ties with the video at 0.625 and
 * precedes it in the catalogue), leaving complete-the-look the charm alone.
 */
const LAYOUT_ORDER = [M.reco2, M.editorial, M.grid, M.reco1];
const EXPECTED = { [HERO]: [P_HERO], [LAYOUT]: LAYOUT_ORDER, [CTL]: [P_WALLET, P_CHARM], [STORY]: [P_VIDEO], [FOOTER]: [P_FOOTER], [RECENT_SLOT]: [M.recent] };

async function world(host: Host, slots: unknown = NESTED, basis: 'served-v1' | 'rendered-v1' = 'rendered-v1', retainedSlots = false): Promise<Mounted> {
  const m = await mount(host, { pieces: PIECES, slots, learn: learnOf(basis), retainedSlots }, basis === 'served-v1' ? { recovery: false } : {});
  expectPublished(m, 'P26 — the product page with its declared layout slot (`layout: true`, governanceVersion 4) and the modules\' inner slots publishes');
  return m;
}
async function warmShopper(m: Mounted) {
  const s = await shopperOn(m);
  await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  return s;
}
type Within = { slot?: string; module?: string } | undefined;
const withinOf = (d: unknown): Within => (d as { within?: Within }).within;

// ===========================================================================
// unit:P26.NC1 — one decision request decides the layout and every returned module's inner slot
// ===========================================================================

describe('unit:P26.NC1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): one snapshot request decides the layout slot and, in the same page decision, the inner content slot of every module it returned, each inner decision naming its module`, async () => {
      const m = await world(host);
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p26-nc1') });
      expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
      expect(servedIn(page, LAYOUT), `${host}: PRECONDITION — the layout returns its four modules`).toEqual(LAYOUT_ORDER);
      expect.soft(servedIn(page, CTL), `${host}: P26.NC1 — complete-the-look's inner slot is decided in the same answer`).toEqual(EXPECTED[CTL]);
      expect.soft(servedIn(page, STORY), `${host}: P26.NC1 — the editorial module's inner slot is decided in the same answer`).toEqual(EXPECTED[STORY]);
      for (const [slot, module] of [[CTL, M.reco2], [STORY, M.editorial]] as const) {
        expect.soft(page.decisions.filter(d => d.slot === slot).map(withinOf), `${host}: P26.NC1 — every ${slot} decision names the module it sits in`)
          .toEqual(page.decisions.filter(d => d.slot === slot).map(() => ({ slot: LAYOUT, module })));
      }
    });
  }
});

// ===========================================================================
// unit:P26.NC2 — page-wide de-duplication across inner and other slots
// ===========================================================================

describe('unit:P26.NC2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): no piece is served twice across the modules' inner content slots and the page's other slots, the inner slots taking their place directly after the layout, in the order the layout returned its modules rather than the order the document defines them`, async () => {
      const m = await world(host);
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p26-nc2') });
      const all = page.decisions.map(d => d.contentId);
      expect(all.length, `${host}: P26.NC2 — no piece twice on the page (${JSON.stringify(all)})`).toBe(new Set(all).size);
      expect.soft(Object.fromEntries(Object.keys(EXPECTED).map(slot => [slot, servedIn(page, slot)])), `${host}: P26.NC2 — the hero's piece is not repeated inside complete-the-look, complete-the-look's inner slot, decided before the story's because the layout returned complete-the-look first, takes the wallet, and the footer, after the layout's inner slots, yields the wallet to them`).toEqual(EXPECTED);
    });
  }
});

// ===========================================================================
// unit:P26.NC3 — a module not returned leaves its inner slot undecided, with no record
// ===========================================================================

describe('unit:P26.NC3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the user-generated module is not returned, so its inner slot is not decided and no record is written for it`, async () => {
      const m = await world(host);
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p26-nc3') });
      expect(servedIn(page, LAYOUT).includes(M.ugc), `${host}: PRECONDITION — the user-generated module is not returned`).toBe(false);
      expect.soft(servedIn(page, UGC), `${host}: P26.NC3 — its inner slot is undecided`).toEqual([]);
      for (const d of page.decisions) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      expect.soft(storedDecisions(m, s.subject).filter(r => r.slot === UGC || r.item_id === P_STREET).map(r => r.item_id), `${host}: P26.NC3 — no record for the undecided inner slot`).toEqual([]);
      const set = await servePage(m, s, 'pdp') as unknown as { records: DecisionRecord[] };
      expect.soft(set.records.filter(r => r.slot === UGC).map(r => r.item_id), `${host}: P26.NC3 — the decision set the route composes holds none either`).toEqual([]);
    });
  }
});

// ===========================================================================
// unit:P26.NC4 — one receipt set that replays exactly; a retained document without nesting as before
// ===========================================================================

describe('unit:P26.NC4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): every record of the page decision, layout and inner slots alike, belongs to one receipt set that replays exactly`, async () => {
      const m = await world(host, NESTED, 'served-v1');
      const s = await warmShopper(m);
      const set = await servePage(m, s, 'pdp', { offer: false }) as unknown as { records: DecisionRecord[] };
      const bySlot = (slot: string) => set.records.filter(r => r.slot === slot).sort((a, b) => a.position - b.position).map(r => r.item_id);
      expect.soft(Object.fromEntries(Object.keys(EXPECTED).map(slot => [slot, bySlot(slot)])), `${host}: P26.NC4 — the set holds the layout's and the inner slots' records`).toEqual(EXPECTED);
      expect.soft(new Set(set.records.map(r => r.ts)).size, `${host}: P26.NC4 — one composition: one ts for every record`).toBe(1);
      // C20: the page manifest (`inputs.replay`) is what one receipt set shares; other `inputs` members may be written per record only where used.
      expect.soft(new Set(set.records.map(r => JSON.stringify(r.inputs?.replay ?? null))).size, `${host}: P26.NC4 — one receipt set: one page manifest (inputs.replay) for every record`).toBe(1);
      expect.soft((set.records[0]?.inputs?.replay?.slots ?? []).map(x => x.slot).filter(x => x === CTL || x === STORY).sort(), `${host}: P26.NC4 — the manifest names the inner slots that were decided`).toEqual([CTL, STORY].sort());
      expect.soft(set.records.filter(r => r.slot === CTL).map(r => (r as unknown as { within?: Within }).within), `${host}: P26.NC4 — each inner record names its module`).toEqual([{ slot: LAYOUT, module: M.reco2 }, { slot: LAYOUT, module: M.reco2 }]);
      await toLedger(m, set.records);
      for (const record of set.records) {
        const replay = await replayOf(m, record.decision_id);
        expect.soft([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P26.NC4 — ${record.slot}/${record.item_id} replays equal (${JSON.stringify(replay.body.diff ?? replay.body.reason ?? '').slice(0, 160)})`).toEqual([200, 'equal']);
      }
    }, 60_000);

    it(`host (${host}): LOCKED — a retained governance-3 slots document without nesting decides in document order and every decision replays equal`, async () => {
      const retained = { version: 'parity-p26-retained', governanceVersion: 3, pages: { pdp: JSON.parse(JSON.stringify(pdp({ layout: undefined }))) } };
      const m = await world(host, retained, 'served-v1', true);
      const s = await warmShopper(m);
      const set = await servePage(m, s, 'pdp', { offer: false }) as unknown as { records: DecisionRecord[] };
      const bySlot = (slot: string) => set.records.filter(r => r.slot === slot).sort((a, b) => a.position - b.position).map(r => r.item_id);
      // Document order: hero, modules, footer (takes the wallet), recently viewed, then story, complete-the-look and user-generated as plain slots.
      expect(Object.fromEntries([HERO, LAYOUT, FOOTER, CTL, STORY, UGC].map(slot => [slot, bySlot(slot)])), `${host}: P26.NC4 — the retained document decides exactly as before`)
        .toEqual({ [HERO]: [P_HERO], [LAYOUT]: LAYOUT_ORDER, [FOOTER]: [P_WALLET], [CTL]: [P_CHARM], [STORY]: [P_VIDEO], [UGC]: [P_STREET] });
      await toLedger(m, set.records);
      for (const record of set.records) {
        const replay = await replayOf(m, record.decision_id);
        expect([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P26.NC4 — ${record.slot}/${record.item_id} replays equal`).toEqual([200, 'equal']);
      }
    }, 60_000);
  }
});

// ===========================================================================
// unit:P26.NC5 — publication refuses a nesting naming what the documents do not define; the kit
// ===========================================================================

const BAD_INNER: Array<{ name: string; pages: unknown[] }> = [
  { name: 'an inner slot the page does not define', pages: pdp({ inner: { [M.reco2]: 'pdp-missing-items' } }) },
  { name: 'an inner slot that is the layout slot itself', pages: pdp({ inner: { [M.reco2]: LAYOUT } }) },
  { name: 'one inner slot named for two modules', pages: pdp({ inner: { [M.reco2]: CTL, [M.editorial]: CTL } }) },
  { name: 'inner on a slot that is not a declared layout', pages: [contentSlot(HERO, 1), layoutSlot({ inner: INNER }), { ...contentSlot(FOOTER, 1), inner: { [M.grid]: STORY } }, recentSlot(), contentSlot(STORY, 1), contentSlot(CTL, 2), contentSlot(UGC, 1)] },
];

describe('unit:P26.NC5', () => {
  it('logic: decision D1 — publication admits the nesting and keeps it, and refuses one naming a slot the document does not define, the layout slot itself, one inner slot twice, or inner on a slot that is not a declared layout, naming the slot\'s inner', () => {
    const admitted = validateSlotCatalog(NESTED);
    expect(admitted.ok ? 'admitted' : (admitted as { errors: string[] }).errors.join('; '), 'P26.NC5 — the nesting is admitted').toBe('admitted');
    expect((admitted as { value?: { pages: Record<string, Array<Record<string, unknown>>> } }).value?.pages.pdp?.[1]?.inner, 'P26.NC5 — and kept on the layout slot').toEqual(INNER);
    for (const bad of BAD_INNER) {
      const refused = validateSlotCatalog({ ...NESTED, pages: { pdp: bad.pages } });
      expect.soft(refused.ok ? 'admitted' : (refused as { errors: string[] }).errors.some(e => /^pages\.pdp\[\d\]\.inner/.test(e)) ? 'refused by name' : (refused as { errors: string[] }).errors.join('; '),
        `P26.NC5 — ${bad.name} is refused naming the slot's inner`).toBe('refused by name');
    }
  });

  for (const host of HOSTS) {
    it(`host (${host}): the slots route refuses a nesting whose module the published catalogue does not define, naming it`, async () => {
      const m = await world(host);
      const refused = await putDocument(m, 'slots', { ...NESTED, pages: { pdp: pdp({ inner: { ...INNER, 'module.PDP.unknown.1': UGC, [M.ugc]: undefined } }) } }, 'p26');
      expect([refused.status, ((refused.body.errors ?? []) as unknown[]).some(e => /inner/.test(String(e)) && String(e).includes('module.PDP.unknown.1'))],
        `${host}: P26.NC5 — refused (422) naming the undefined module: ${JSON.stringify(refused.body).slice(0, 200)}`).toEqual([422, true]);
    });
  }

  it('logic: the integration guide, the API reference and the payload schemas document the nesting and its payload', () => {
    const missing = missingStatements(['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'the layout slot names each module\'s inner content slot (inner)', test: t => /\binner\b/.test(t) && /layout/i.test(t) && /module/i.test(t) },
      { name: 'a returned module\'s inner slot is decided in the same page decision; a module not returned has its inner slot undecided', test: t => /inner/i.test(t) && /not returned/i.test(t) && /undecided|not decided|no decision/i.test(t) },
      { name: 'each inner decision carries within { slot, module }', test: t => /\bwithin\b/.test(t) && /module/i.test(t) && /slot/i.test(t) },
      { name: 'de-duplication spans the inner slots and the page\'s other slots', test: t => /inner/i.test(t) && /de-?duplicat|never twice|no piece twice/i.test(t) },
    ]);
    expect(missing, 'P26.NC5 — the kit documents the nesting').toEqual([]);
  });
});
