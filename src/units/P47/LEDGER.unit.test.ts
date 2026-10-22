// src/units/P47/LEDGER.unit.test.ts
// P47 under the Closure Ledger: the tests for the LOCAL criteria of the P47 work
// order (the fourth parity programme (amendment 3),
// ticket P47 "An unreturned module's pin is not called a refusal").
// DC1 (D1, RESOLVED by the owner's rule R-P78: the product tells the operator) is
// exercised inside UP1-UP3; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P47.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-3/BTI-Parity-Amendment-2026-10-17.md,
//     section 2, P47): "the governance record and the monitor count a
//     `module_not_returned` entry apart from refusals (a separate count in the
//     existing record shape; the refused count no longer rises for it); the Slots
//     screen labels it in its own words (reserved, unserved: the module was not
//     returned) with its module and layout slot; a page with refusals only counts and
//     renders as today; the answer's `pinDiagnostics`, `refusedCount` and
//     `omittedCount` keep P43's receipted shape unless the specifier rules that the
//     answer's counts must also separate …; kit 02 and 03 state it";
//   · P43's receipted entry (src/units/P43/LEDGER.unit.test.ts:37-48, :163):
//     `{ pinIndex: 0, pinnedPieceId: 'piece.tabby.footer', reason: 'module_not_returned',
//     slot: 'pdp-ugc-items', within: { module: 'module.PDP.ugc.1', slot: 'pdp-modules' } }`
//     on the snapshot answer, with `refusedCount: 1, omittedCount: 0`; P43's fixture
//     is copied below;
//   · the record today: src/content/service.ts:1049-1054 hands every entry of the set's
//     `pinDiagnostics` to the slot governance counters as a refused pin
//     (src/learn/slotGovernance.ts:250-262 adds one to `refusedPinCount` and names it in
//     `refusedPins` with its reason); the operator slots page joins the per-slot block
//     (`GET /v1/:tenant/learn/slots?evidence=1`, src/routes/decisions.ts:524-541, kit
//     02:763) and the monitor sums it (`governance: { since, scope, refusedPinCount,
//     shortTakeCount }`, src/ops/monitor.ts:703, :349-352, kit 02:2179-2180); the Slots
//     screen's "Refused or short" cell (public/console/views.js:340-353) shows
//     "<n> pin refusal(s)" and "<piece>: <n> time(s), <reason in words>".
//
// THE SEPARATE COUNT AND THE LABEL, RULED (D1 leaves the count's name and the label's
// words to the specifier, in the existing shapes):
//   · THE SLOTS PAGE. Each slot's `governance` block (`status: 'available'`) carries two
//     more members, after today's: `unreturnedPinCount`, the occurrences since `since`
//     of a pin of this slot left reserved and unserved because the layout did not
//     return its module (a `module_not_returned` entry), counted per page load as
//     `refusedPinCount` counts refusals; and `unreturnedPins`, the distinct such pins,
//     bounded as `refusedPins` is, each `{ count, pinnedPieceId, within: { module, slot } }`
//     with keys sorted (R-P3), `within` naming the module that was not returned and the
//     layout slot, as P43's entry names them. `refusedPinCount` and `refusedPins` count
//     and name refusals only: such an entry is in neither. A slot with none reads
//     `unreturnedPinCount: 0, unreturnedPins: []` (zero reported as zero). The
//     `unavailable` block carries both as `null`, as it carries every count.
//   · THE MONITOR. `governance` (the run's `result.governance` and a kept result's)
//     carries `unreturnedPinCount`, the tenant's total, after today's members;
//     `refusedPinCount` counts refusals only. A kept result written before the member
//     existed answers its former shape (unit:W20.R5's control,
//     src/units/W20/LEDGER.unit.test.ts:674-675, holds); a kept value that is not a whole
//     non-negative number drops the whole member, as every count does (R111(i)).
//   · THE SNAPSHOT ANSWER keeps P43's receipted shape: `pinDiagnostics`, `refusedCount`
//     and `omittedCount` as P43 ruled (not separated here), so P43's units and kit
//     sentences stand.
//   · THE SLOTS SCREEN. In a slot's "Refused or short" cell, for a block whose
//     `unreturnedPinCount` is above zero, one more line in its own words — "<n> pin(s)
//     reserved, unserved: the module was not returned" — and one line per entry of
//     `unreturnedPins` naming its piece, how often, and the module and the layout slot,
//     for example "piece.tabby.footer: 1 time, reserved, unserved: module.PDP.ugc.1 was
//     not returned by pdp-modules". The refusal line counts refusals only ("no pin
//     refused" when there is none). A block whose `unreturnedPinCount` is zero (or that
//     lacks it) renders exactly as the console at BASE renders it.
//   · BOUNDARY (R-P82 (5)): src/learn/slotGovernance.ts is in P47's allowed paths; the
//     separate count lives in the existing governance record (the one counter document per
//     tenant, `slot-governance:v1:<tenant>`), never in a second document. The S7
//     satisfiability sketch (logs/fix1-sketch-*.log) shows one such build.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P47.log):
//   · W20's governance assertions project named members (src/units/W20/B2.unit.test.ts:
//     500-506, :863-867; B3.unit.test.ts:523-527; LEDGER.unit.test.ts:575, :650) and stay
//     green with two more members; unit:W20.R5's exact projection of a kept record
//     (LEDGER.unit.test.ts:674-675) stays green because a kept record without the member
//     answers its former shape (ruled above);
//   · kit 02:763 (the slots page block's member list) and kit 02:2179-2180 (the monitor
//     rows) are extended by the build; W20.R3/R6's kit sentences
//     (LEDGER.unit.test.ts:444-455) are untouched by the ruling.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `unreturnedPinCount` and `unreturnedPins` on the slots page block, `unreturnedPinCount`
// on the monitor's `governance`, and the Slots screen's line. No new export is imported.
//
// FIXTURE. P43's (src/units/P43/LEDGER.unit.test.ts:105-163, copied): P26's nested
// product page whose layout does not return the user-generated module, that module's
// inner slot pinning the footer piece: one page view gives one `module_not_returned`
// entry and no refusal. UP2's refusals-only page is P26's own nested page (no pin in the
// unreturned module's inner slot) with the hero slot pinning a piece the catalogue does
// not carry: one refusal (`missing_or_ineligible`, W20.G2.01's reason word) and no
// `module_not_returned` entry.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (the kit), src/units/_parity6.ts
// (the console with views.js at head or at BASE). Imports from src/units/: ../_parity,
// ../_parity3, ../_parity6.

import { describe, expect, it } from 'vitest';

import {
  asOperator, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount, PAID_SOCIAL_ENTRY, PAGE_VIEW, pageInstanceOf,
  recentSlot, servedIn, shopperOn, TABBY_VIEWS, TENANT, type Host, type Mounted, type Snapshot,
} from '../_parity';
import { missingStatements } from '../_parity3';
import { consoleAt, keyOrders } from '../_parity6';

// ---------------------------------------------------------------------------
// P43's fixture (src/units/P43/LEDGER.unit.test.ts:105-163), copied.
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
/** P43's: the footer piece may also fill the user-generated module's inner slot. */
const PIECES = [...MODULES, ...content([FOOTER, UGC])];
const INNER = { [M.reco2]: CTL, [M.editorial]: STORY, [M.ugc]: UGC };
const contentSlot = (slot: string, take: number, over: Record<string, unknown> = {}) => ({ slot, take, weights: { line: 1 }, ...over });
const pdp = (layoutOver: Record<string, unknown>, ugcOver: Record<string, unknown> = {}, heroOver: Record<string, unknown> = {}) => [contentSlot(HERO, 1, heroOver),
  layoutSlot(layoutOver), contentSlot(FOOTER, 1), recentSlot(), contentSlot(STORY, 1), contentSlot(CTL, 2), contentSlot(UGC, 1, ugcOver)];
const slotsOf = (pages: unknown[], version: string) => ({ version, governanceVersion: 4, pages: { pdp: pages } });
/** P43's nested page: the unreturned module's inner slot pins the footer piece. */
const PINNED_NESTED = slotsOf(pdp({ inner: INNER }, { pinnedPieceIds: [P_FOOTER] }), 'parity-p47-nested');
/** UP2: P26's nested page (no pin in the unreturned module's inner slot), the hero slot pinning a piece the catalogue does not carry. */
const GONE = 'piece.tabby.gone';
const REFUSING = slotsOf(pdp({ inner: INNER }, {}, { pinnedPieceIds: [GONE] }), 'parity-p47-refusing');
const learn = learnDocument(Object.fromEntries([HERO, LAYOUT, FOOTER, CTL, STORY, UGC].map(s => [s, { measurementBasis: 'rendered-v1', reward: 'click' }])), {});
const LAYOUT_ORDER = [M.reco2, M.editorial, M.grid, M.reco1];
/** P43's ruled entry. */
const ENTRY = { pinIndex: 0, pinnedPieceId: P_FOOTER, reason: 'module_not_returned', slot: UGC, within: { module: M.ugc, slot: LAYOUT } };
/** The refusal the hero's dead pin gives (W20.G2.01's shape and reason word). */
const REFUSAL = { pinIndex: 0, pinnedPieceId: GONE, reason: 'missing_or_ineligible', slot: HERO };

async function world(host: Host, slots: unknown, pieces: unknown[] = PIECES): Promise<Mounted> {
  const m = await mount(host, { pieces, slots, learn });
  expectPublished(m, 'P47 — the product page with its declared layout slot and the modules\' inner slots publishes');
  return m;
}
/** One page view of a warmed shopper (P43's `warmShopper`): three Tabby views, then the product page. */
async function pageView(m: Mounted, label: string): Promise<Snapshot> {
  const s = await shopperOn(m);
  await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `${m.host}: PRECONDITION — the product page is answered (${JSON.stringify(page.body).slice(0, 200)})`).toBe(200);
  await m.drain();
  return page;
}

/** The operator slots page's governance block of one slot, or a sentence naming its absence. */
async function governanceOf(m: Mounted, slot: string): Promise<Record<string, unknown> | string> {
  const page = await asOperator(m, 'GET', `/v1/${TENANT}/learn/slots?evidence=1`);
  expect(page.status, `${m.host}: PRECONDITION — the operator slots page answers (${JSON.stringify(page.body).slice(0, 200)})`).toBe(200);
  const rows = ((page.body.pages ?? []) as Array<{ slots: Array<Record<string, unknown>> }>).flatMap(p => p.slots);
  const row = rows.find(r => r.slot === slot);
  return (row?.governance as Record<string, unknown> | undefined) ?? `absent: no governance block for ${slot} (${JSON.stringify(row ?? null).slice(0, 200)})`;
}
/** The named members of a block, each named where absent. */
const membersOf = (block: Record<string, unknown> | string, names: string[]) => typeof block === 'string' ? block
  : Object.fromEntries(names.map(n => [n, Object.hasOwn(block, n) ? block[n] : `no ${n} member`]));
/** `POST /v1/:tenant/monitor` as the operator: the run's tenant-level governance counts. */
async function monitorGovernance(m: Mounted): Promise<Record<string, unknown> | string> {
  const run = await asOperator(m, 'POST', `/v1/${TENANT}/monitor`);
  expect(run.status, `${m.host}: PRECONDITION — the monitor run answers (${JSON.stringify(run.body).slice(0, 300)})`).toBe(200);
  return ((run.body.result as Record<string, unknown> | undefined)?.governance as Record<string, unknown> | undefined)
    ?? `absent: the monitor result carries no governance member (${JSON.stringify(run.body).slice(0, 200)})`;
}

const SEPARATE = ['refusedPinCount', 'refusedPins', 'unreturnedPinCount', 'unreturnedPins'];
const UNRETURNED = [{ count: 1, pinnedPieceId: P_FOOTER, within: { module: M.ugc, slot: LAYOUT } }];

// ===========================================================================
// unit:P47.UP1 — the governance record and the monitor count the entry apart from refusals
// ===========================================================================

describe('unit:P47.UP1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): one page view whose only pin diagnostic is P43's module_not_returned entry: the operator slots page's governance block of the inner slot counts it as unreturnedPinCount 1 with its piece, module and layout slot, and refusedPinCount stays 0; the monitor's tenant-level governance counts unreturnedPinCount 1 and refusedPinCount 0`, async () => {
      const m = await world(host, PINNED_NESTED);
      const page = await pageView(m, 'p47-up1');
      expect(servedIn(page, LAYOUT), `${host}: PRECONDITION — the layout returns its four modules, the user-generated module not among them`).toEqual(LAYOUT_ORDER);
      expect([page.body.pinDiagnostics, page.body.refusedCount, page.body.omittedCount],
        `${host}: PRECONDITION (P43.RP1, receipted) — the answer names the entry, P43's shape kept`).toEqual([[ENTRY], 1, 0]);
      const block = await governanceOf(m, UGC);
      expect.soft(membersOf(block, SEPARATE), `${host}: P47.UP1 — the inner slot's governance block counts the entry apart: no refusal, one unreturned pin naming its piece, module and layout slot`)
        .toEqual({ refusedPinCount: 0, refusedPins: [], unreturnedPinCount: 1, unreturnedPins: UNRETURNED });
      const unreturned = typeof block === 'string' ? undefined : block.unreturnedPins;
      expect.soft(keyOrders(unreturned).filter(([written, sorted]) => written.join() !== sorted.join()), `${host}: P47.UP1 — R-P3: each unreturned pin is written with sorted keys`).toEqual([]);
      const monitor = await monitorGovernance(m);
      expect.soft(membersOf(monitor, ['refusedPinCount', 'unreturnedPinCount']), `${host}: P47.UP1 — the monitor's tenant-level counts carry the entry apart, and the refused count does not rise for it`)
        .toEqual({ refusedPinCount: 0, unreturnedPinCount: 1 });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P47.UP2 — the Slots screen's own words; a page with refusals only as today
// ===========================================================================

describe('unit:P47.UP2 (R-P78, D1; R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the shipped Slots screen, after that page view, the inner slot's row says the pin is reserved, unserved because the module was not returned, naming the piece, the module and the layout slot, and reads no pin refused`, async () => {
      const m = await world(host, PINNED_NESTED);
      const page = await pageView(m, 'p47-up2');
      expect(page.body.pinDiagnostics, `${host}: PRECONDITION (P43.RP1) — the answer names the entry`).toEqual([ENTRY]);
      const c = await consoleAt(m, `#/slots?scope=${TENANT}`);
      try {
        const row = c.row(UGC);
        expect(row, `${host}: PRECONDITION — the Slots screen lists the inner slot`).not.toMatch(/^absent:/);
        expect.soft({ reservedUnserved: /reserved, unserved/i.test(row), notReturned: /not returned/i.test(row), piece: row.includes(P_FOOTER),
          module: row.includes(M.ugc), layoutSlot: row.includes(LAYOUT), noRefusal: /no pin refused/.test(row) },
        `${host}: P47.UP2 — the row labels the entry in its own words with its piece, module and layout slot, and counts no refusal: "${row}"`)
          .toEqual({ reservedUnserved: true, notReturned: true, piece: true, module: true, layoutSlot: true, noRefusal: true });
      } finally { c.close(); }
    }, 120_000);

    it(`host (${host}): LOCK — a page with refusals only (the hero's dead pin, no unreturned module's pin): the governance block and the monitor count the refusal as today, and the Slots screen renders byte for byte as the console at BASE renders it, from the same requests`, async () => {
      const m = await world(host, REFUSING, P26_PIECES);
      const page = await pageView(m, 'p47-up2-refusing');
      expect(page.body.pinDiagnostics, `${host}: PRECONDITION — the answer names the hero's refusal alone`).toEqual([REFUSAL]);
      const block = await governanceOf(m, HERO);
      expect(membersOf(block, ['refusedPinCount', 'refusedPins']), `${host}: P47.UP2 — LOCKED (W20.G2.01): the hero's block counts and names the refusal as today`)
        .toEqual({ refusedPinCount: 1, refusedPins: [{ pinnedPieceId: GONE, reason: 'missing_or_ineligible', count: 1 }] });
      expect(membersOf(await monitorGovernance(m), ['refusedPinCount']), `${host}: P47.UP2 — LOCKED (W20.G2.04): the monitor counts the refusal as today`).toEqual({ refusedPinCount: 1 });
      const head = await consoleAt(m, `#/slots?scope=${TENANT}`), base = await consoleAt(m, `#/slots?scope=${TENANT}`, 'base');
      try {
        expect(head.row(HERO), `${host}: PRECONDITION — the hero's row shows its refusal`).toMatch(/1 pin refusal/);
        expect(head.view(), `${host}: P47.UP2 — the Slots screen's HTML is the console at BASE's`).toBe(base.view());
        expect(head.calls(), `${host}: P47.UP2 — the Slots screen makes exactly the requests it makes at BASE`).toEqual(base.calls());
      } finally { head.close(); base.close(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P47.UP3 — the kit
// ===========================================================================

describe('unit:P47.UP3', () => {
  it('logic: the API reference and the payload schemas state the separate count and the Slots screen\'s label, and the API reference names the count on the monitor', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'a module_not_returned entry is counted apart from refusals, as unreturnedPinCount, and not in refusedPinCount',
        test: t => /module_not_returned/.test(t) && /unreturnedPinCount/.test(t) },
      { name: 'the Slots screen labels it reserved, unserved: the module was not returned, with its module and layout slot',
        test: t => /reserved, unserved/i.test(t) && /(Slots screen|console)/i.test(t) && /\bmodule\b/.test(t) && /layout slot/.test(t) },
    ]).concat(missingStatements(['docs/kit/02-api-reference.md'], [
      { name: 'the monitor\'s governance carries unreturnedPinCount',
        test: t => /monitor/.test(t) && /unreturnedPinCount/.test(t) && /refusedPinCount/.test(t) },
    ]));
    expect(missing, 'P47.UP3 — kit 02 and 03 state the separate count and the label').toEqual([]);
  });
});
