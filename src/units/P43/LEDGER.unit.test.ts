// src/units/P43/LEDGER.unit.test.ts
// P43 under the Closure Ledger: the tests for the LOCAL criteria of the P43 work
// order (the operator-warnings programme, amendment 2, ticket P43 "A pin inside an
// unshown module's inner slot is reported"). DC1 (D1, RESOLVED by the owner's
// rule R-P78) is exercised inside RP1-RP3; LV1 is a deferred live row and gets no
// test.
//
// One `describe('unit:P43.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-2/BTI-Parity-Amendment-2026-10-16.md,
//     section 2, P43): "when a layout does not return a module whose inner slot
//     carries a pin, the page's pin diagnostics (the existing pinDiagnostics shape)
//     carry an entry naming the inner slot, its module, the layout slot and the
//     piece, with a reason that says the pin stayed reserved and unserved because
//     the module was not returned; the served decisions, records, receipts, replay
//     and the reservation itself are unchanged (the piece stays reserved, as
//     ruled); a page without `inner` and a page whose every module is returned
//     carry no such entry; kit 02 and 03 state it";
//   · P26's receipted ruling and fixture (src/units/P26/LEDGER.unit.test.ts:25-47,
//     :87-126): the nested product page, the user-generated module fifth and not
//     returned by the layout's take of 4, its inner slot undecided; every inner
//     decision carries `within: { module, slot }` (keys sorted);
//   · P04's reservation (kit 03 "every valid pin is reserved page-wide before any
//     slot ranks"; src/reflex/contentCompose.ts:403-470) and the P26 closure,
//     further reading 3, with the P26 builder's "undecided-pin" probe
//     (P26/implementer/scripts/p26probe-host.test.ts.txt:134-135; report section 6
//     (c)): the footer piece made eligible for the user-generated module's inner
//     slot and pinned there is served nowhere on that page view — the footer
//     serves nothing — and the answer carries no pin diagnostic at all;
//   · the existing pin diagnostics: src/reflex/contentCompose.ts:272-280 (an entry
//     `{ slot, pinnedPieceId, reason, ownerSlot?, pinIndex?, position? }`, `pinIndex`
//     on every prefix pin's entry) and src/routes/decisions.ts:1071 and
//     :1092-1093 (the snapshot answer carries `pinDiagnostics` with
//     `refusedCount` and `omittedCount` only when there is an entry).
//
// THE ENTRY, RULED (D1 leaves the reason word to the specifier):
//   · On a page view where the layout does not return a module whose inner slot
//     carries a valid pin, the decision answer's `pinDiagnostics` carries, for each
//     pinned piece of that inner slot, the existing entry shape with the module and
//     the layout slot named as P26 names them on an inner decision:
//       { pinIndex: <its index in the prefix, as every prefix pin's entry carries>,
//         pinnedPieceId: <the piece>, reason: 'module_not_returned',
//         slot: <the inner slot>, within: { module: <the module>, slot: <the layout slot> } }
//     `within` keys sorted (R-P3). The answer's totals count it as they count every
//     entry (`refusedCount`, `omittedCount`, src/routes/decisions.ts:1092-1093,
//     outside P43's boundary).
//   · The reservation stays as P26 ruled it: the piece is served nowhere on that
//     page view, and the decisions, records, receipts and replays are P26's.
//   · A page without `inner`, and a nested page whose every module is returned,
//     carry no such entry and decide byte for byte as today; so does a nested page
//     whose unreturned module's inner slot carries no pin.
//   · CONSEQUENCE NAMED FOR THE LEAD: the entry joins the decision set's
//     `pinDiagnostics`, which the serving path also hands to the slot governance
//     counters (src/content/service.ts:1049-1051, outside P43's boundary), so the
//     operator's slots page counts it under the inner slot with its reason, as it
//     counts every entry (public/console/views.js:340-353 shows it as a pin refusal
//     reading "module not returned"). No unit asserts it either way.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the
// reason word `module_not_returned` and `within` on a pin diagnostic. No new export
// is imported.
//
// FIXTURE. P26's (copied; a test file is never imported), with the P26 builder's
// probe change: the footer piece also names the user-generated module's inner slot
// in its `slotTypes`, and that inner slot pins it. After three Tabby views the
// layout returns reco.2, editorial.1, grid.1 and reco.1 (P26.NC1); ugc.1, fifth, is
// not returned, so its inner slot is undecided while its pin holds the footer piece
// page-wide; complete-the-look's inner slot takes the wallet and the charm, the
// story slot the video, and the footer, decided after the layout's inner slots,
// has the wallet already served and the footer piece reserved: it serves nothing.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P43.log):
//   · kit sentences that state the opposite of the ruling and that the build must
//     reword (P43.RP3's kit leg fails on them): docs/kit/02-api-reference.md:352-353
//     ("no `pinDiagnostics` entry for it"), :1753-1755 ("names no refused pin, short
//     take or constraint"), docs/kit/03-payload-schemas.md:959-961 ("no refused-pin
//     or short-take entry are written for it"). P26.NC5's kit statement
//     (src/units/P26/LEDGER.unit.test.ts:279) needs "inner", "not returned" and
//     "undecided" in one sentence and stays satisfiable;
//   · no test asserts the absence of pin diagnostics for an undecided inner slot
//     (P26's units assert decisions, records, manifest and replay only).
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (the kit). Imports from
// src/units/: ../_parity, ../_parity3.

import { describe, expect, it } from 'vitest';

import type { DecisionRecord } from '@/content/types';

import {
  expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount, PAID_SOCIAL_ENTRY, PAGE_VIEW, pageInstanceOf, receiptsOf,
  recentSlot, RECENT_SLOT, replayOf, servedIn, servePage, shopperOn, storedDecisions, TABBY_VIEWS, toLedger, type Host, type Mounted, type Snapshot,
} from '../_parity';
import { kitSentences, missingStatements } from '../_parity3';

// ---------------------------------------------------------------------------
// P26's fixture (src/units/P26/LEDGER.unit.test.ts:87-126), copied.
// ---------------------------------------------------------------------------

const HERO = 'pdp-hero', FOOTER = 'pdp-footer', CTL = 'pdp-ctl-items', STORY = 'pdp-story-items', UGC = 'pdp-ugc-items';
const piece = (id: string, slotTypes: string[], type = 'editorial', tags: Record<string, string[]> = { line: ['Tabby'] }) => ({ id,
  customerContentId: `TAP-${id.replace(/\./g, '-').toUpperCase()}`, type, title: id, tags, slotTypes, lifecycle: { status: 'live' } });
const P_HERO = 'piece.tabby.hero', P_WALLET = 'piece.tabby.wallet', P_CHARM = 'piece.tabby.charm', P_VIDEO = 'piece.tabby.video', P_STREET = 'piece.ugc.street', P_FOOTER = 'piece.tabby.footer';
const content = (footerSlots: string[]) => [
  piece(P_HERO, [HERO, CTL], 'on-model'),
  piece(P_WALLET, [CTL, STORY, FOOTER], 'silo'),
  piece(P_CHARM, [CTL], 'flat-lay'),
  piece(P_VIDEO, [STORY], 'video'),
  piece(P_STREET, [UGC], 'user-generated'),
  piece(P_FOOTER, footerSlots),
];
/** P26's catalogue. */
const P26_PIECES = [...MODULES, ...content([FOOTER])];
/** The probe's change: the footer piece may also fill the user-generated module's inner slot. */
const PIECES = [...MODULES, ...content([FOOTER, UGC])];
const INNER = { [M.reco2]: CTL, [M.editorial]: STORY, [M.ugc]: UGC };
const contentSlot = (slot: string, take: number, over: Record<string, unknown> = {}) => ({ slot, take, weights: { line: 1 }, ...over });
/** The user-generated module's inner slot pins the footer piece (the probe's "undecided-pin"). */
const UGC_PIN = { pinnedPieceIds: [P_FOOTER] };
const pdp = (layoutOver: Record<string, unknown>, ugcOver: Record<string, unknown> = {}) => [contentSlot(HERO, 1), layoutSlot(layoutOver), contentSlot(FOOTER, 1), recentSlot(),
  contentSlot(STORY, 1), contentSlot(CTL, 2), contentSlot(UGC, 1, ugcOver)];
const slotsOf = (pages: unknown[], version: string) => ({ version, governanceVersion: 4, pages: { pdp: pages } });
/** RP1, RP2: P26's nested page, the unreturned module's inner slot pinned. */
const PINNED_NESTED = slotsOf(pdp({ inner: INNER }, UGC_PIN), 'parity-p43-nested');
/** RP3 (a): the same page without `inner` (the declared layout, governance 4), the slot pinned as above. */
const PINNED_PLAIN = slotsOf(pdp({}, UGC_PIN), 'parity-p43-plain');
/** RP3 (b): the nested page whose layout takes 5, so every eligible module is returned, ugc.1 fifth. */
const PINNED_ALL_RETURNED = slotsOf(pdp({ inner: INNER, take: 5 }, UGC_PIN), 'parity-p43-all-returned');
/** RP3 (c): P26's own nested page (no pin in the unreturned module's inner slot). */
const P26_NESTED = slotsOf(pdp({ inner: INNER }), 'parity-p26-slots');
const learnOf = (basis: 'served-v1' | 'rendered-v1') => learnDocument(Object.fromEntries([HERO, LAYOUT, FOOTER, CTL, STORY, UGC].map(s => [s, { measurementBasis: basis, reward: 'click' }])),
  {}) as Record<string, unknown>;

const LAYOUT_ORDER = [M.reco2, M.editorial, M.grid, M.reco1];
/** P26's EXPECTED (src/units/P26/LEDGER.unit.test.ts:126), the user-generated inner slot undecided. */
const P26_EXPECTED = { [HERO]: [P_HERO], [LAYOUT]: LAYOUT_ORDER, [CTL]: [P_WALLET, P_CHARM], [STORY]: [P_VIDEO], [FOOTER]: [P_FOOTER], [RECENT_SLOT]: [M.recent], [UGC]: [] };
/** RP1, RP2 (header): as P26's, but the footer piece is reserved by the undecided slot's pin and the wallet already served: the footer serves nothing. */
const PINNED_EXPECTED = { ...P26_EXPECTED, [FOOTER]: [] };
/** RP3 (a), in document order (P26.NC4's retained page with the pin): the footer takes the wallet, the story slot the video, complete-the-look's slot the charm, the pinned slot its pin. */
const PLAIN_EXPECTED = { [HERO]: [P_HERO], [LAYOUT]: LAYOUT_ORDER, [FOOTER]: [P_WALLET], [RECENT_SLOT]: [M.recent], [STORY]: [P_VIDEO], [CTL]: [P_CHARM], [UGC]: [P_FOOTER] };
/** RP3 (b): every module returned, ugc.1 fifth (it ties reco.1 at zero and follows it in the catalogue); its inner slot serves its pin; the footer is left nothing. */
const ALL_RETURNED_EXPECTED = { [HERO]: [P_HERO], [LAYOUT]: [...LAYOUT_ORDER, M.ugc], [CTL]: [P_WALLET, P_CHARM], [STORY]: [P_VIDEO], [UGC]: [P_FOOTER], [FOOTER]: [], [RECENT_SLOT]: [M.recent] };
const SLOTS = [HERO, LAYOUT, FOOTER, RECENT_SLOT, STORY, CTL, UGC];

/** The ruled entry (header). */
const ENTRY = { pinIndex: 0, pinnedPieceId: P_FOOTER, reason: 'module_not_returned', slot: UGC, within: { module: M.ugc, slot: LAYOUT } };

async function world(host: Host, slots: unknown, basis: 'served-v1' | 'rendered-v1', pieces: unknown[] = PIECES): Promise<Mounted> {
  const m = await mount(host, { pieces, slots, learn: learnOf(basis) }, basis === 'served-v1' ? { recovery: false } : {});
  expectPublished(m, 'P43 — the product page with its declared layout slot and the modules\' inner slots publishes');
  return m;
}
async function warmShopper(m: Mounted) {
  const s = await shopperOn(m);
  await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  return s;
}
const bySlot = (page: Snapshot) => Object.fromEntries(SLOTS.map(slot => [slot, servedIn(page, slot)]));
const recordsBySlot = (records: DecisionRecord[]) => Object.fromEntries(SLOTS.map(slot => [slot, records.filter(r => r.slot === slot).sort((a, b) => a.position - b.position).map(r => r.item_id)]));
/** The answer's pin diagnostic members, each named where absent. */
const pinMembersOf = (page: Snapshot) => Object.fromEntries(['pinDiagnostics', 'refusedCount', 'omittedCount']
  .map(k => [k, Object.hasOwn(page.body, k) ? page.body[k] : `no ${k} member`]));
async function replaysOf(m: Mounted, records: DecisionRecord[]) {
  await toLedger(m, records);
  const out: unknown[][] = [];
  for (const r of records) { const replay = await replayOf(m, r.decision_id); out.push([`${r.slot}/${r.item_id}`, replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
  return out;
}

// ===========================================================================
// unit:P43.RP1 — the page's pin diagnostics name the pin the unreturned module left unserved
// ===========================================================================

describe('unit:P43.RP1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the user-generated module is not returned and its inner slot pins the footer piece: the decision answer's pin diagnostics carry an entry naming the inner slot, the module, the layout slot and the piece, reason module_not_returned`, async () => {
      const m = await world(host, PINNED_NESTED, 'rendered-v1');
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p43-rp1') });
      expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
      expect(servedIn(page, LAYOUT), `${host}: PRECONDITION — the layout returns its four modules, the user-generated module not among them`).toEqual(LAYOUT_ORDER);
      expect.soft(pinMembersOf(page), `${host}: P43.RP1 — the answer's pin diagnostics carry the entry, counted as every entry is`)
        .toEqual({ pinDiagnostics: [ENTRY], refusedCount: 1, omittedCount: 0 });
      const within = (page.body.pinDiagnostics as Array<{ within?: object }> | undefined)?.find(d => d.within)?.within;
      expect.soft(within ? Object.keys(within) : 'no entry carries within', `${host}: P43.RP1 — R-P3: within is written with sorted keys`).toEqual(['module', 'slot']);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P43.RP2 — LOCK: the decisions, records, receipts and replays are P26's; the piece stays reserved
// ===========================================================================

describe('unit:P43.RP2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — with the pin of the undecided inner slot, the page decides as P26 ruled: the footer piece stays reserved and is served and recorded nowhere, every inner record names its module, one receipt set, every record replays equal`, async () => {
      const m = await world(host, PINNED_NESTED, 'served-v1');
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p43-rp2') });
      expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
      expect(bySlot(page), `${host}: P43.RP2 — LOCKED (P26, P04): the answer serves P26's page, the footer left nothing because its piece stays reserved`).toEqual(PINNED_EXPECTED);
      expect(page.decisions.map(d => d.contentId).includes(P_FOOTER), `${host}: P43.RP2 — LOCKED: the reserved piece is served nowhere on the page`).toBe(false);
      const set = await servePage(m, s, 'pdp', { offer: false }) as unknown as { records: DecisionRecord[] };
      expect(recordsBySlot(set.records), `${host}: P43.RP2 — LOCKED (P26.NC4): the decision set holds the same records`).toEqual(PINNED_EXPECTED);
      expect(new Set(set.records.map(r => r.ts)).size, `${host}: P43.RP2 — LOCKED (P26.NC4): one composition, one ts`).toBe(1);
      expect((set.records[0]?.inputs?.replay?.slots ?? []).map(x => x.slot).filter(x => [CTL, STORY, UGC].includes(x)).sort(),
        `${host}: P43.RP2 — LOCKED (P26.NC4): the manifest names the inner slots that were decided, not the undecided one`).toEqual([CTL, STORY].sort());
      expect(set.records.filter(r => r.slot === CTL).map(r => (r as unknown as { within?: unknown }).within),
        `${host}: P43.RP2 — LOCKED (P26.NC4): each inner record names its module`).toEqual([{ slot: LAYOUT, module: M.reco2 }, { slot: LAYOUT, module: M.reco2 }]);
      const replays = await replaysOf(m, set.records);
      expect(replays, `${host}: P43.RP2 — LOCKED (P26.NC4): every record replays equal`).toEqual(replays.map(([id]) => [id, 200, 'equal']));
      const receipts = await receiptsOf(m, s.subject);
      expect(receipts.filter(r => r.item === P_FOOTER || r.slot === UGC).map(r => `${String(r.slot)}/${String(r.item)}`),
        `${host}: P43.RP2 — LOCKED: no receipt names the reserved piece or the undecided slot`).toEqual([]);
      expect(receipts.filter(r => r.slot === CTL).map(r => r.within ?? 'no within on the receipt'),
        `${host}: P43.RP2 — LOCKED (P26; kit 03 "on its receipt"): each inner receipt names its module`).toEqual([{ module: M.reco2, slot: LAYOUT }, { module: M.reco2, slot: LAYOUT }]);
      expect(storedDecisions(m, s.subject).filter(r => r.item_id === P_FOOTER || r.slot === UGC).map(r => r.item_id), `${host}: P43.RP2 — LOCKED: no record for the reserved piece or the undecided slot`).toEqual([]);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P43.RP3 — LOCK: no entry without `inner` or with every module returned; the kit
// ===========================================================================

describe('unit:P43.RP3 (R-P7)', () => {
  for (const host of HOSTS) {
    for (const [name, slots, pieces, expected] of [
      ['a page without inner, the same slot pinned', PINNED_PLAIN, PIECES, PLAIN_EXPECTED],
      ['a nested page whose every module is returned, the user-generated module\'s inner slot pinned', PINNED_ALL_RETURNED, PIECES, ALL_RETURNED_EXPECTED],
      ['P26\'s nested page, the unreturned module\'s inner slot carrying no pin', P26_NESTED, P26_PIECES, P26_EXPECTED],
    ] as const) {
      it(`host (${host}): LOCK — ${name}: no pin diagnostic, and the page decides and replays as today`, async () => {
        const m = await world(host, slots, 'served-v1', [...pieces]);
        const s = await warmShopper(m);
        const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p43-rp3') });
        expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
        expect(bySlot(page), `${host}: P43.RP3 — LOCKED: ${name} serves today's page`).toEqual(expected);
        expect(Object.keys(page.body).filter(k => ['pinDiagnostics', 'refusedCount', 'omittedCount'].includes(k)), `${host}: P43.RP3 — LOCKED: ${name} carries no pin diagnostic`).toEqual([]);
        const set = await servePage(m, s, 'pdp', { offer: false }) as unknown as { records: DecisionRecord[]; pinDiagnostics?: unknown[] };
        expect(recordsBySlot(set.records), `${host}: P43.RP3 — LOCKED: the decision set holds the same records`).toEqual(expected);
        const replays = await replaysOf(m, set.records);
        expect(replays, `${host}: P43.RP3 — LOCKED: every record replays equal`).toEqual(replays.map(([id]) => [id, 200, 'equal']));
      }, 90_000);
    }
  }

  it('logic: the API reference and the payload schemas state the entry, and no sentence of theirs still says an unreturned module\'s inner slot names no pin', () => {
    const files = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'];
    const missing = missingStatements(files, [
      { name: 'a pin of an inner slot whose module is not returned is named in the page\'s pinDiagnostics with reason module_not_returned',
        test: t => /module_not_returned/.test(t) && /pinDiagnostics|pin diagnostic/i.test(t) },
      { name: 'the entry names the inner slot, the piece, and within { module, slot }: the module and the layout slot',
        test: t => /module_not_returned/.test(t) && /\bwithin\b/.test(t) && /\bmodule\b/.test(t) && /layout/i.test(t) },
      { name: 'the pin stays reserved, so the piece is served nowhere on that page view',
        test: t => /(module_not_returned|not returned)/.test(t) && /reserved/i.test(t) && /(served nowhere|unserved|not served)/i.test(t) },
    ]);
    const denying = files.flatMap(file => kitSentences(file).filter(t => /(not returned|undecided)/i.test(t) && /inner/i.test(t)
      && /(no pinDiagnostics entry|names no refused pin|no refused-pin|pin is not reported)/i.test(t)).map(t => `${file}: ${t.slice(0, 160)}`));
    expect.soft(missing, 'P43.RP3 — the kit states the entry').toEqual([]);
    expect.soft(denying, 'P43.RP3 — and no kit sentence still says an unreturned module\'s inner slot names no pin').toEqual([]);
  });
});
