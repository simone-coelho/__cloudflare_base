// src/units/P53/LEDGER.unit.test.ts
// P53 under the Closure Ledger: the tests for the LOCAL criteria of the P53 work
// order (the fifth parity programme (amendment 4), ticket P53 "The Slots screen says
// how many unreturned pins it does not name"). DC1 (D1, RESOLVED by the owner's rule
// R-P78: the screen says what it does not name) is exercised inside SM1-SM3; LV1 is a
// deferred live row and gets no test.
//
// One `describe('unit:P53.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the console
// renders today:
//   · the authority copy (docs/parity/authority/amendment-4/BTI-Parity-Amendment-2026-10-17b.md,
//     section 2, P53): "the Slots screen draws the same 'n more … not named' line for
//     unreturned pins as for refusals when the block's unreturnedPinCount exceeds its
//     named entries; a block within the cap renders byte for byte as today; P47's units
//     unchanged; kit 02 states it";
//   · P47's receipted block (src/units/P47/LEDGER.unit.test.ts:37-49): each slot's
//     `governance` block carries `unreturnedPinCount` (occurrences) and `unreturnedPins`
//     (the distinct pins, bounded as `refusedPins` is: ten per slot,
//     src/learn/slotGovernance.ts:136, :340-350, each `{ count, pinnedPieceId, within }`);
//   · the P47 review's probe R5 (P47/reviewer/scripts/p47rv.test.ts.txt:24-36, :127-133;
//     logs/probe-facts-R5.log): thirteen pins of the unreturned module's inner slot, one
//     page view: the block reads `unreturnedPinCount: 13` and names ten pins, each
//     `count: 1`, and the Slots cell draws "13 pins reserved, unserved: the module was
//     not returned" and ten named lines, and no line for the three it does not name;
//   · the cell today: public/console/views.js:368-382 (`governanceCell`: the refusals'
//     lines, then `refused > named ? <n> more refusal(s) not named` in a `div.itemid`,
//     `named` the sum of the named entries' counts, :374, :378) and :391-401
//     (`unreturnedLines`: the count line and one `div.itemid` per named pin, no more-line).
//
// THE LINE, RULED (D1 leaves the words to the specifier, in the refusals' idiom):
//   · WHEN. In a slot's "Refused or short" cell, for a block whose `unreturnedPinCount`
//     exceeds the sum of the counts of its named `unreturnedPins` (the refusals'
//     computation, views.js:374, :378), ONE more line.
//   · WHERE AND HOW. Right after the last named unreturned pin's line (as the refusals'
//     line follows the named refusals), the same element and class as the refusals' line
//     (`div.itemid`), worded "<n> more pin(s) reserved, unserved, not named", `n` the
//     difference, with the console's `plural` (for example "3 more pins reserved,
//     unserved, not named"). It calls them neither refusals nor anything else: P47's words.
//   · NOTHING ELSE CHANGES. A block whose named counts reach `unreturnedPinCount` (any
//     block within the cap, P47's included) renders exactly as the console at BASE7
//     (f48c50b9) renders it, and the Slots screen makes exactly the requests the base
//     console makes, marked or not.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P53.log):
//   · P47.UP2 (src/units/P47/LEDGER.unit.test.ts:209-246) reads the Slots row of a block
//     with one unreturned pin and compares a refusals-only page with views.js at
//     c7543471: within the cap, so both hold; W20's console units (W20 B1, LEDGER R2) read
//     refusal blocks only. No test reads a block past the unreturned cap.
//
// RULED MEMBERS THAT DO NOT EXIST YET: the line. No new export is imported.
//
// FIXTURE. P47's (src/units/P47/LEDGER.unit.test.ts:110-141, copied; the content ids'
// prefix is neutral here and no outcome reads it): P26's nested product page whose
// layout does not return the user-generated module, that module's inner slot pinning
// the footer piece; extended as the P47 review's probe R5 extends it, with twelve more
// pieces the inner slot pins (take 13): one page view gives thirteen `module_not_returned`
// entries in one slot, ten named. SM2's within-cap blocks: P47's own (one pin) and ten
// pins (the cap exactly, every occurrence named).
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (the kit), src/units/_parity7.ts
// (the console with views.js at head or at BASE7). Imports from src/units/: ../_parity,
// ../_parity3, ../_parity7.

import { describe, expect, it } from 'vitest';

import {
  asOperator, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount, PAID_SOCIAL_ENTRY, PAGE_VIEW, pageInstanceOf,
  recentSlot, shopperOn, TABBY_VIEWS, TENANT, type Host, type Mounted, type Snapshot,
} from '../_parity';
import { missingStatements } from '../_parity3';
import { consoleAt7, type OpenConsole7 } from '../_parity7';

// ---------------------------------------------------------------------------
// P47's fixture (src/units/P47/LEDGER.unit.test.ts:110-141), copied, and the review's R5 extension.
// ---------------------------------------------------------------------------

const HERO = 'pdp-hero', FOOTER = 'pdp-footer', CTL = 'pdp-ctl-items', STORY = 'pdp-story-items', UGC = 'pdp-ugc-items';
const piece = (id: string, slotTypes: string[], type = 'editorial', tags: Record<string, string[]> = { line: ['Tabby'] }) => ({ id,
  customerContentId: `REF-${id.replace(/\./g, '-').toUpperCase()}`, type, title: id, tags, slotTypes, lifecycle: { status: 'live' } });
const P_HERO = 'piece.tabby.hero', P_WALLET = 'piece.tabby.wallet', P_CHARM = 'piece.tabby.charm', P_VIDEO = 'piece.tabby.video', P_STREET = 'piece.ugc.street', P_FOOTER = 'piece.tabby.footer';
const content = (footerSlots: string[]) => [
  piece(P_HERO, [HERO, CTL], 'on-model'),
  piece(P_WALLET, [CTL, STORY, FOOTER], 'silo'),
  piece(P_CHARM, [CTL], 'flat-lay'),
  piece(P_VIDEO, [STORY], 'video'),
  piece(P_STREET, [UGC], 'user-generated'),
  piece(P_FOOTER, footerSlots),
];
/** P43's catalogue: the footer piece may also fill the user-generated module's inner slot. */
const PIECES = [...MODULES, ...content([FOOTER, UGC])];
/** The review's R5: twelve more pieces that may fill the unreturned module's inner slot. */
const EXTRA = Array.from({ length: 12 }, (_, k) => `piece.p53.ugc${String(k + 1).padStart(2, '0')}`);
const MANY_PIECES = [...PIECES, ...EXTRA.map(id => piece(id, [UGC], 'user-generated'))];
const INNER = { [M.reco2]: CTL, [M.editorial]: STORY, [M.ugc]: UGC };
const contentSlot = (slot: string, take: number, over: Record<string, unknown> = {}) => ({ slot, take, weights: { line: 1 }, ...over });
const pdp = (layoutOver: Record<string, unknown>, ugcOver: Record<string, unknown> = {}) => [contentSlot(HERO, 1),
  layoutSlot(layoutOver), contentSlot(FOOTER, 1), recentSlot(), contentSlot(STORY, 1), contentSlot(CTL, 2), contentSlot(UGC, 1, ugcOver)];
const slotsOf = (pages: unknown[], version: string) => ({ version, governanceVersion: 4, pages: { pdp: pages } });
/** The inner slot pinning `pins` (take as many). */
const pinning = (pins: string[], version: string) => slotsOf(pdp({ inner: INNER }, { pinnedPieceIds: pins, take: Math.max(1, pins.length) }), version);
/** P47's page: one pin. The review's R5: thirteen. The cap exactly: ten. */
const ONE = pinning([P_FOOTER], 'parity-p53-one');
const THIRTEEN = pinning([P_FOOTER, ...EXTRA], 'parity-p53-thirteen');
const TEN = pinning([P_FOOTER, ...EXTRA.slice(0, 9)], 'parity-p53-ten');
const learn = learnDocument(Object.fromEntries([HERO, LAYOUT, FOOTER, CTL, STORY, UGC].map(s => [s, { measurementBasis: 'rendered-v1', reward: 'click' }])), {});
const SLOTS = `#/slots?scope=${TENANT}`;

async function world(host: Host, slots: unknown, pieces: unknown[]): Promise<Mounted> {
  const m = await mount(host, { pieces, slots, learn });
  expectPublished(m, 'P53 — the product page with its declared layout slot and the modules\' inner slots publishes');
  return m;
}
/** One page view of a warmed shopper (P47's `pageView`). */
async function pageView(m: Mounted, label: string): Promise<Snapshot> {
  const s = await shopperOn(m);
  await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `${m.host}: PRECONDITION — the product page is answered (${JSON.stringify(page.body).slice(0, 200)})`).toBe(200);
  await m.drain();
  return page;
}
/** The operator slots page's governance block of one slot (P47's `governanceOf`), or a sentence naming its absence. */
async function governanceOf(m: Mounted, slot: string): Promise<Record<string, unknown> | string> {
  const page = await asOperator(m, 'GET', `/v1/${TENANT}/learn/slots?evidence=1`);
  expect(page.status, `${m.host}: PRECONDITION — the operator slots page answers (${JSON.stringify(page.body).slice(0, 200)})`).toBe(200);
  const rows = ((page.body.pages ?? []) as Array<{ slots: Array<Record<string, unknown>> }>).flatMap(p => p.slots);
  return (rows.find(r => r.slot === slot)?.governance as Record<string, unknown> | undefined) ?? `absent: no governance block for ${slot}`;
}
/** The block's unreturned count and named entries, as P47 rules them. */
const unreturnedOf = (block: Record<string, unknown> | string) => (typeof block === 'string' ? block
  : [block.unreturnedPinCount, Array.isArray(block.unreturnedPins) ? block.unreturnedPins.length : 'no unreturnedPins']);
/** The Slots row's innermost lines (elements with no element inside), in order: text and class. */
function linesOf(c: OpenConsole7, slot: string): Array<{ text: string; cls: string }> {
  const row = c.rowEl(slot);
  if (!row) return [];
  return Array.from(row.querySelectorAll('div')).filter(el => el.querySelectorAll('*').length === 0)
    .map(el => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim(), cls: el.getAttribute('class') ?? '' }));
}

// ===========================================================================
// unit:P53.SM1 — past the cap, the cell says how many unreturned pins it does not name
// ===========================================================================

describe('unit:P53.SM1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): one page view with thirteen unreturned pins in the inner slot: the Slots row names ten and, right after them, says in the refusals' idiom that 3 more are not named, from exactly the requests the console at BASE7 makes`, async () => {
      const m = await world(host, THIRTEEN, MANY_PIECES);
      const page = await pageView(m, 'p53-sm1');
      expect((page.body.pinDiagnostics as unknown[] | undefined)?.length, `${host}: PRECONDITION (P43) — the answer names thirteen unreturned pins`).toBe(13);
      expect(unreturnedOf(await governanceOf(m, UGC)), `${host}: PRECONDITION (P47.UP1; the review's R5) — the block counts thirteen and names ten`).toEqual([13, 10]);
      const c = await consoleAt7(m, SLOTS);
      try {
        const lines = linesOf(c, UGC);
        const lastNamed = lines.findIndex(l => l.text.startsWith(`${EXTRA[8]}:`));
        expect(lastNamed, `${host}: PRECONDITION (P47.UP2) — the row names the tenth pin (${JSON.stringify(lines.map(l => l.text))})`).toBeGreaterThan(0);
        const next = lines[lastNamed + 1] ?? { text: 'no line after the tenth named pin', cls: '' };
        expect.soft({ more: /^3 more\b/.test(next.text), unserved: /reserved, unserved/.test(next.text), notNamed: /not named$/.test(next.text), refusal: /refus/i.test(next.text), cls: next.cls },
          `${host}: P53.SM1 — right after the ten named pins, one line says 3 more pins reserved, unserved, not named, as the refusals' line says it ("${next.text}")`)
          .toEqual({ more: true, unserved: true, notNamed: true, refusal: false, cls: 'itemid' });
        const marked = c.calls(), base = await consoleAt7(m, SLOTS, 'base');
        try {
          expect.soft(marked, `${host}: P53.SM1 — on the marked screen the console makes exactly the requests the console at BASE7 makes`).toEqual(base.calls());
        } finally { base.close(); }
      } finally { c.close(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P53.SM2 — LOCK: a block within the cap renders as today
// ===========================================================================

describe('unit:P53.SM2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — P47's block (one unreturned pin) and a block at the cap (ten pins, every occurrence named) render the Slots screen byte for byte as the console at BASE7 renders it, from the same requests`, async () => {
      for (const [label, slots, pieces, count] of [['one pin', ONE, PIECES, 1], ['ten pins', TEN, MANY_PIECES, 10]] as const) {
        const m = await world(host, slots, pieces);
        await pageView(m, `p53-sm2-${count}`);
        expect(unreturnedOf(await governanceOf(m, UGC)), `${host}: PRECONDITION (P47.UP1) — ${label}: the block counts and names every pin`).toEqual([count, count]);
        const head = await consoleAt7(m, SLOTS), base = await consoleAt7(m, SLOTS, 'base');
        try {
          expect(head.rowEl(UGC), `${host}: PRECONDITION — the Slots screen lists the inner slot`).toBeTruthy();
          expect(head.view(), `${host}: P53.SM2 — ${label}: the Slots screen's HTML is the console at BASE7's`).toBe(base.view());
          expect(head.calls(), `${host}: P53.SM2 — ${label}: the Slots screen makes exactly the requests it makes at BASE7`).toEqual(base.calls());
        } finally { head.close(); base.close(); }
      }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P53.SM3 — the kit
// ===========================================================================

describe('unit:P53.SM3', () => {
  it('logic: the API reference states the Slots screen\'s line for the unreturned pins it does not name', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md'], [
      { name: 'past the names it lists, the Slots screen says how many more unreturned pins (reserved, unserved) it does not name',
        test: t => /(Slots screen|console)/i.test(t) && /(unreturned|reserved, unserved)/i.test(t) && /\bmore\b/i.test(t) && /not named/i.test(t) },
    ]);
    expect(missing, 'P53.SM3 — kit 02 states the line').toEqual([]);
  });
});
