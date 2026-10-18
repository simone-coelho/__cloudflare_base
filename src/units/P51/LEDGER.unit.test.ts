// src/units/P51/LEDGER.unit.test.ts
// P51 under the Closure Ledger: the tests for the LOCAL criteria of the P51 work
// order (the fifth parity programme (amendment 4), ticket P51 "The console's lift
// grid shows the republish cause"). DC1 (D1, RESOLVED by the owner's rule R-P78: the
// grid renders the member P49 serves) is exercised inside RG1-RG3; LV1 is a deferred
// live row and gets no test.
//
// One `describe('unit:P51.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the console
// renders today:
//   · the authority copy (docs/parity/authority/amendment-4/BTI-Parity-Amendment-2026-10-17b.md,
//     section 2, P51): "on the console's lift grid, a slot whose lift/rows answer
//     carries `republished` is marked, in P45's idiom, naming the slot, each changed
//     member with its old and new values and what ends it, beside or within P45's mark
//     when both apply, and loses the mark when the answer no longer carries it; a slot
//     without the member renders byte for byte as today; the grid makes no new request;
//     kit 02 states it (its sentence that the grid does not show it is gone)";
//   · P49's receipted member (src/units/P49/LEDGER.unit.test.ts:42-70; kit 02:1939-1962):
//     `republished: { changed: [{ member, new, old }], endedBy: 'generation_transition',
//     slot }` (keys sorted, `changed` sorted by member) as the last member of
//     `GET /v1/:tenant/lift/rows` from a publication refused after a learn republish
//     until the slot's next successful publication, after P42's `stale` when both apply
//     (the P49 review's S7 probe: the reads end `stale`, `republished`);
//   · the grid today: public/console/views.js:121-166 (`loadLift` reads lift/rows and
//     keeps the answer as `lift.meta`), :242-247 (P45's mark drawn from `meta.stale`,
//     beside the "Nothing published" message too) and :306-313 (the card: the toolbar,
//     the snapshot's line, P45's mark, the table, the pager), :326-340 (`staleMark`,
//     P45's idiom: one `div.msg.note` with `data-lift-stale`, worded from the marker's
//     members alone); nothing reads `republished` (P49/reviewer/REPORT.md §11);
//   · kit 02:1962 ("The console's lift grid does not render `republished`; it is read
//     from the answers"), the sentence the work order removes.
//
// THE MARK, RULED (D1 leaves the words and the placement to the specifier, in P45's idiom):
//   · WHERE. On the Lift screen (`#/lift`), whenever the lift/rows answer the screen
//     holds carries `republished` for the slot on screen: ONE element carrying the
//     attribute `data-lift-republished`, beside P45's mark: wherever P45 draws
//     `data-lift-stale` (in the card that holds the grid, above its table; beside the
//     "Nothing published for this slot yet" message), right after it when both apply,
//     in its place when only `republished` does. A separate element, not inside P45's.
//     Class: the builder's (`msg note`, P45's, fits).
//   · WORDS. One sentence from the member's members alone: that the slot's last
//     publication was refused because the learn document was republished, the slot
//     (`slot`, and `page` where given), each entry of `changed` as its member with its
//     old and new values (for example "measurementBasis from rendered-v1 to served-v1 and
//     reward from click to add_to_bag"; a reward may be written in the console's words,
//     "add to bag"), and what ends it (`endedBy: 'generation_transition'`: the numbers
//     stay those of the last successful publication until an operator starts the new
//     generation with POST /v1/{tenant}/learn/generation, or the learn document is
//     republished with the old values).
//   · GONE. A later answer without `republished` (the next successful publication)
//     renders the screen exactly as the console at BASE7 (f48c50b9) renders that answer.
//   · NO NEW REQUEST, NO OTHER CHANGE. The mark is drawn from the answer `loadLift`
//     already keeps; on the marked screen the console's request list is the base
//     console's (S7's lesson), and for an answer without `republished` — P45's mark
//     included — the screen's HTML (`#view`) and the request list are the base console's.
//   · NOT RULED BY A UNIT (a reading for the build): the mark beside the "Nothing
//     published" message for a slot that never published (P49's `lastPublished: null`
//     case, the P49 review's S6).
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P51.log):
//   · P45.LG1/LG2 (src/units/P45/LEDGER.unit.test.ts:138-171, :173-193) compare the Lift
//     screen with views.js at c7543471 for answers without `republished`: they stay green
//     (no mark is drawn without the member); no test reads the Lift screen with a
//     `republished` answer;
//   · kit 02:1962 states the opposite of the ruling and is replaced by the build (RG3);
//     P49.LR3's kit statements (src/units/P49/LEDGER.unit.test.ts:259-272) stay satisfiable;
//   · the grid makes no new request, so the api-boundary call-list pins of R-P81
//     (src/index.api-boundary.test.ts:2865, :2873) are not touched.
//
// RULED MEMBERS THAT DO NOT EXIST YET: the `data-lift-republished` element and its words.
// No new export is imported.
//
// FIXTURE. P49's world (src/units/_parity7.ts): the product slot republished with its
// reward (click to add_to_bag) and its measurement basis (rendered-v1 to served-v1)
// changed, so the mark must name two members; the operator's publish refused (P49.LR1,
// a PRECONDITION); the end is the learn document republished with the old values, whose
// publication succeeds (kit 02:1955-1958), a path P50's ruling leaves open. With P42's
// stale marker as well: the home page's `/pooled` door failing for one publication
// before the reward republish (the P49 review's S7 (ii)).
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (the kit), src/units/_parity6.ts
// (P08's world, the publish doors, the lift reads, the pooled fault),
// src/units/_parity7.ts (the console with views.js at head or at BASE7; P49's world).
// Imports from src/units/: ../_parity, ../_parity3, ../_parity6, ../_parity7.

import { describe, expect, it } from 'vitest';

import { HOSTS, TENANT } from '../_parity';
import { kitSentences, missingStatements } from '../_parity3';
import { dials, failPooledDoor, HOME_MODULES, memberOf, objectPublish, operatorPublish, PDP_MODULES, POOLED, rowsOf, visit } from '../_parity6';
import { consoleAt7, p49World, republishProduct, type OpenConsole7 } from '../_parity7';

const LIFT = (slot: string, extra = '') => `#/lift?scope=${TENANT}&slot=${slot}${extra}`;
/** P49's member for the two-member republish (P49's ruling: `changed` sorted by member). */
const TWO_REPUBLISHED = { changed: [{ member: 'measurementBasis', new: 'served-v1', old: 'rendered-v1' }, { member: 'reward', new: 'add_to_bag', old: 'click' }],
  endedBy: 'generation_transition', slot: PDP_MODULES };
const REPUBLISHED = { changed: [{ member: 'reward', new: 'add_to_bag', old: 'click' }], endedBy: 'generation_transition', slot: PDP_MODULES };

/** The republish marks on the Lift screen: each one's text, and whether it sits in the card that holds the grid. */
function marksOf(c: OpenConsole7): Array<{ text: string; besideTheGrid: boolean }> {
  return c.all('#view [data-lift-republished]').map(el => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    besideTheGrid: !!el.closest('section.card')?.querySelector('table') }));
}
/** What a mark's words name, against the ruling, for the two-member republish. */
function twoNamedIn(text: string) {
  return { republished: /republish/i.test(text), slot: text.includes(PDP_MODULES),
    basis: /measurementBasis|measurement basis/i.test(text), basisOld: text.includes('rendered-v1'), basisNew: text.includes('served-v1'),
    reward: /\breward\b/i.test(text), rewardOld: /\bclick\b/.test(text), rewardNew: /add[_ ]to[_ ]bag/.test(text), end: /generation/i.test(text) };
}
const TWO_NAMED = { republished: true, slot: true, basis: true, basisOld: true, basisNew: true, reward: true, rewardOld: true, rewardNew: true, end: true };
/** What a mark's words name for the reward republish. */
function namedIn(text: string) {
  return { republished: /republish/i.test(text), slot: text.includes(PDP_MODULES), reward: /\breward\b/i.test(text), old: /\bclick\b/.test(text),
    new: /add[_ ]to[_ ]bag/.test(text), end: /generation/i.test(text) };
}
const NAMED = { republished: true, slot: true, reward: true, old: true, new: true, end: true };

// ===========================================================================
// unit:P51.RG1 — the grid marks the republished slot, beside P45's mark, and the mark goes with the member
// ===========================================================================

describe('unit:P51.RG1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with the product slot's lift/rows answer carrying P49's republished for a reward and a basis change, the lift grid shows one mark beside its numbers naming the slot, both members with their old and new values and what ends it, from exactly the requests the console at BASE7 makes; after the learn document is republished with the old values and publishes, the same console, asked again, renders the grid exactly as the console at BASE7`, async () => {
      const m = await p49World(host);
      await republishProduct(m, dials('add_to_bag', { measurementBasis: 'served-v1' }));
      const refused = await operatorPublish(m, PDP_MODULES);
      expect([refused.status, memberOf(refused, 'republished')], `${host}: PRECONDITION (P49.LR1, receipted) — the publication is refused naming both members`).toEqual([503, TWO_REPUBLISHED]);
      expect(memberOf(await rowsOf(m, PDP_MODULES), 'republished'), `${host}: PRECONDITION (P49.LR1) — GET lift/rows carries the member`).toEqual(TWO_REPUBLISHED);
      const c = await consoleAt7(m, LIFT(PDP_MODULES));
      try {
        expect(c.requests.some(r => r.path.startsWith(`/v1/${TENANT}/lift/rows?`) && r.path.includes(`slot=${PDP_MODULES}`)),
          `${host}: PRECONDITION — the Lift screen read the product slot's lift/rows (${c.calls().join(' | ')})`).toBe(true);
        expect(c.all('#view table').length, `${host}: PRECONDITION — the grid is drawn (${c.text().slice(0, 300)})`).toBeGreaterThan(0);
        const marks = marksOf(c);
        expect.soft(marks.length, `${host}: P51.RG1 — the Lift screen shows one republish mark for the product slot (view: ${c.text().slice(0, 400)})`).toBe(1);
        expect.soft(marks.map(x => x.besideTheGrid), `${host}: P51.RG1 — the mark sits in the card that holds the grid, beside its numbers`).toEqual([true]);
        expect.soft(marks.map(x => twoNamedIn(x.text)), `${host}: P51.RG1 — the mark names the republish, the slot, each changed member with its old and new values and what ends it (${JSON.stringify(marks.map(x => x.text))})`)
          .toEqual([TWO_NAMED]);
        const markedCalls = c.calls(), base = await consoleAt7(m, LIFT(PDP_MODULES), 'base');
        try {
          expect.soft(markedCalls, `${host}: P51.RG1 — on the marked screen the console makes exactly the requests the console at BASE7 makes for it: no new request`).toEqual(base.calls());
        } finally { base.close(); }

        await republishProduct(m, dials());
        const again = await operatorPublish(m, PDP_MODULES);
        expect([again.status, again.body.published], `${host}: PRECONDITION (P49) — the learn document republished with the old values publishes (${JSON.stringify(again.body).slice(0, 200)})`).toEqual([200, true]);
        await c.go(LIFT(PDP_MODULES, '&asked=again'));
        const after = await consoleAt7(m, LIFT(PDP_MODULES, '&asked=again'), 'base');
        try {
          expect.soft(c.view(), `${host}: P51.RG1 — once the answer carries no member the mark is gone: the screen is exactly the console at BASE7's`).toBe(after.view());
        } finally { after.close(); }
      } finally { c.close(); }
    }, 180_000);

    it(`host (${host}): with the product slot's lift/rows answer carrying P42's stale and then P49's republished, the lift grid shows P45's mark and, right after it, the republish mark naming the slot, reward with its old and new values and what ends it`, async () => {
      const m = await p49World(host);
      await visit(m, 'pdp');
      const restore = failPooledDoor(m, HOME_MODULES);
      const stale = await (async () => { try { return await objectPublish(m, PDP_MODULES); } finally { restore(); } })();
      expect(stale.status, `${host}: PRECONDITION (P42.PW1) — under the home page's fault the product page's publication fails closed`).toBe(503);
      await republishProduct(m);
      expect((await operatorPublish(m, PDP_MODULES)).status, `${host}: PRECONDITION (P49) — the republish is refused`).toBe(503);
      const rows = await rowsOf(m, PDP_MODULES);
      expect([Object.keys(rows.body).slice(-2), memberOf(rows, 'republished'), (rows.body.stale as { modules?: unknown } | undefined)?.modules],
        `${host}: PRECONDITION (P42.PW2, P49.LR1; the P49 review's S7) — lift/rows ends with stale, then republished`).toEqual([['stale', 'republished'], REPUBLISHED, [POOLED]]);
      const c = await consoleAt7(m, LIFT(PDP_MODULES));
      try {
        expect(c.all('#view table').length, `${host}: PRECONDITION — the grid is drawn`).toBeGreaterThan(0);
        const order = c.all('#view [data-lift-stale], #view [data-lift-republished]').map(el => (el.getAttribute('data-lift-republished') !== null ? 'republished' : 'stale'));
        expect.soft(order, `${host}: P51.RG1 — both marks are shown, P45's first and the republish mark right after it (view: ${c.text().slice(0, 400)})`).toEqual(['stale', 'republished']);
        const marks = marksOf(c);
        expect.soft(marks.map(x => x.besideTheGrid), `${host}: P51.RG1 — the republish mark sits in the card that holds the grid`).toEqual([true]);
        expect.soft(marks.map(x => namedIn(x.text)), `${host}: P51.RG1 — and names the republish, the slot, reward with its old and new values and what ends it (${JSON.stringify(marks.map(x => x.text))})`)
          .toEqual([NAMED]);
        const markedCalls = c.calls(), base = await consoleAt7(m, LIFT(PDP_MODULES), 'base');
        try {
          expect.soft(markedCalls, `${host}: P51.RG1 — on the doubly marked screen the console makes exactly the requests the console at BASE7 makes`).toEqual(base.calls());
        } finally { base.close(); }
      } finally { c.close(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P51.RG2 — LOCK: a slot without the member renders as today, P45's mark included, with today's requests
// ===========================================================================

describe('unit:P51.RG2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — on P49's world, every publication succeeding, the product slot's pooled rows, the pooled module's cells and the home slot render byte for byte as the console at BASE7 renders them, from the same requests; and a slot carrying P42's stale alone (P45's mark) renders byte for byte as the console at BASE7, from the same requests`, async () => {
      const m = await p49World(host);
      for (const hash of [LIFT(PDP_MODULES), LIFT(PDP_MODULES, `&item=${encodeURIComponent(POOLED)}`), LIFT(HOME_MODULES)]) {
        const head = await consoleAt7(m, hash), base = await consoleAt7(m, hash, 'base');
        try {
          expect(head.all('#view table').length, `${host}: PRECONDITION — ${hash}: the grid is drawn (${head.text().slice(0, 300)})`).toBeGreaterThan(0);
          expect(head.view(), `${host}: P51.RG2 — ${hash}: the screen's HTML is the console at BASE7's`).toBe(base.view());
          expect(head.calls(), `${host}: P51.RG2 — ${hash}: the console makes exactly the requests it makes at BASE7`).toEqual(base.calls());
        } finally { head.close(); base.close(); }
      }
      await visit(m, 'pdp');
      const restore = failPooledDoor(m, HOME_MODULES);
      const stale = await (async () => { try { return await objectPublish(m, PDP_MODULES); } finally { restore(); } })();
      expect(stale.status, `${host}: PRECONDITION (P42.PW1) — the product page's publication fails closed under the home page's fault`).toBe(503);
      expect(Object.keys((await rowsOf(m, PDP_MODULES)).body).slice(-1), `${host}: PRECONDITION (P42.PW2) — lift/rows carries stale and no republished`).toEqual(['stale']);
      const head = await consoleAt7(m, LIFT(PDP_MODULES)), base = await consoleAt7(m, LIFT(PDP_MODULES), 'base');
      try {
        expect(head.all('#view [data-lift-stale]').length, `${host}: PRECONDITION (P45.LG1) — P45's mark is drawn`).toBe(1);
        expect(head.view(), `${host}: P51.RG2 — P45's mark alone: the screen's HTML is the console at BASE7's`).toBe(base.view());
        expect(head.calls(), `${host}: P51.RG2 — P45's mark alone: the console makes exactly the requests it makes at BASE7`).toEqual(base.calls());
      } finally { head.close(); base.close(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P51.RG3 — the kit
// ===========================================================================

describe('unit:P51.RG3', () => {
  it('logic: the API reference states that the console\'s lift grid marks a republished slot from the member, and neither kit document still says the grid does not render it', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md'], [
      { name: 'the console\'s lift grid marks a slot whose lift/rows answer carries republished, naming the slot, each changed member\'s old and new values and what ends it',
        test: t => /lift grid/i.test(t) && /\brepublished\b/.test(t) && /\bold\b/.test(t) && /\bnew\b/.test(t) && /(generation|ends)/i.test(t) },
      { name: 'and the grid\'s republish mark goes when the answer no longer carries the member',
        test: t => /lift grid/i.test(t) && /\brepublished\b/.test(t) && /\bmark(s|ed)?\b/i.test(t) && /(no longer|gone|until)/i.test(t) },
    ]);
    const denying = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'].flatMap(file => kitSentences(file)
      .filter(t => /lift grid/i.test(t) && /(does not|doesn't|do not) (render|show)/i.test(t) && /republished/.test(t)).map(t => `${file}: ${t.slice(0, 160)}`));
    expect.soft(missing, 'P51.RG3 — kit 02 states the grid\'s republish mark').toEqual([]);
    expect.soft(denying, 'P51.RG3 — the sentence saying the lift grid does not render republished is gone (kit 02:1962)').toEqual([]);
  });
});
