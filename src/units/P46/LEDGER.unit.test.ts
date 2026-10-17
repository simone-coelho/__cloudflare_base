// src/units/P46/LEDGER.unit.test.ts
// P46 under the Closure Ledger: the tests for the LOCAL criteria of the P46 work
// order (the fourth parity programme (amendment 3),
// ticket P46 "The console's dials screen shows a learn publication's
// advisory"). DC1 (D1, RESOLVED by the owner's rule R-P78: the product tells the
// operator) is exercised inside DA1-DA3; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P46.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the console
// renders today:
//   · the authority copy (docs/parity/authority/amendment-3/BTI-Parity-Amendment-2026-10-17.md,
//     section 2, P46): "on the dials screen, a save or validate whose answer carries
//     `diagnostics` renders each warning's slot, reward and consequence next to the
//     result, and a rollback or check that carries none renders as today; the screen
//     makes no new request; an answer without the member renders byte for byte as
//     today; kit 02 states it";
//   · P41's receipted envelope (src/units/P41/LEDGER.unit.test.ts:39-52, :140-142;
//     src/content/kinds.ts:1857 `learnConversionDiagnostics`): the success answers of
//     `PUT /content/learn` and `POST /content/learn/validate` carry
//     `diagnostics: { advisory: true, omittedWarningCount, schema: 'learn-conversion-diagnostics/v1',
//     status: 'available', warningCount, warnings: [{ code: 'conversions_omit_slot_reward',
//     consequence: 'undeclared_pieces_earn_nothing', reward, slot }] }` only when a
//     slot's `conversions` table omits that slot's own reward; P41's fixture is copied;
//   · the dials screen today: public/console/views.js:440-480 — `scheduleCheck` (the
//     screen's check: `POST /content/learn/validate` 350 ms after an edit, reading
//     only `valid` and `errors`, :442-452) and `saveDials` (the save: `PUT
//     /content/learn`, reading only `revision` and `document`, then the flash "Saved as
//     learn revision N…", :470-480); the screen has no control for `conversions`, so a
//     stored omitting table rides every re-save of the document (P41's closure line;
//     P41/reviewer/REPORT.md §7);
//   · the console's existing advisory idiom: `C.pinFeedback`
//     (public/console/views-config.js:377-398), a `div.msg.note` carrying a
//     `data-pin-feedback` label, one `li` per warning, beside the Rules screen's check
//     and save results.
//
// THE ADVISORY ON THE SCREEN, RULED (D1 leaves the words and the placement to the
// specifier, in the console's existing idiom):
//   · WHERE. On the Dials screen (`#/dials`), inside the screen's own host (`#view`),
//     where the screen lists a refused draft's errors (above the "Reading revision …"
//     line): ONE element carrying the attribute `data-learn-advisory`, valued `check`
//     for the answer of the screen's check (the validate door) and `save` for the
//     answer of its save (the PUT), with one `li` per warning the answer lists. The
//     check's advisory stands while the draft it checked is on screen; the save's
//     stands after the save, beside its result, until the screen is entered again or
//     the draft changes. Class: the builder's (`msg note`, as `C.pinFeedback`).
//   · WORDS, per warning: its slot (verbatim), its reward (the code word or the
//     console's words for it, `add_to_bag` or "add to bag") and the consequence in
//     words: that undeclared pieces on that slot earn nothing. For example: "Slot
//     home-offers: its conversion table does not name the slot's reward, add to bag;
//     undeclared pieces on this slot earn nothing." A line for `omittedWarningCount`
//     ("N more not shown") when it is not zero is allowed, not required.
//   · NOTHING ELSE CHANGES. An answer without `diagnostics` — a check or a save of a
//     document whose tables name their slots' rewards, or that has none — renders the
//     screen exactly as the console at BASE (c7543471) renders it, and the screen makes
//     exactly the requests it makes at BASE (src/units/_parity6.ts compares the two); an
//     answer with it is drawn from exactly the requests the console at BASE makes (DA1, R-P83).
//   · NOT TESTED HERE, AND WHY: a rollback renders on the History screen
//     (public/console/views-measure.js:372-381), outside P46's write boundary, and its
//     answer carries no advisory (P41's named residual); the boundary leaves it as it is.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P46.log):
//   · W18/B1.unit.test.ts:155 reads views.js as text (`DIALS_SOURCE`) and :596 runs
//     the dials screen; P05.W6 (src/units/P05/LEDGER.unit.test.ts:599-622) saves
//     through it; P09's units edit its percentage: none of their documents carries an
//     omitting table, so none of their answers carries `diagnostics`, and the ruling
//     renders them as today. Listed in the log with each assertion.
//
// RULED MEMBERS THAT DO NOT EXIST YET: the `data-learn-advisory` element and its
// words. No new export is imported.
//
// FIXTURE. P41's (src/units/P41/LEDGER.unit.test.ts:96-142, copied): the three home
// slots, the story slot rewarded on click with `{ add_to_bag: 5 }` (omits click), the
// offers slot rewarded on add to bag with `{ purchase: 3, click: 1 }` (omits add_to_bag),
// the picks slot naming its reward; the document stored before the screen opens, as a
// document published by the API or retained from before P41 is. The operator opens the
// story slot's dials and changes its trust from 1 to 0.5: the screen's check, and then
// its save, send the whole draft, the two omitting tables with it.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (the kit), src/units/_parity6.ts
// (the console with views.js at head or at BASE). Imports from src/units/: ../_parity,
// ../_parity3, ../_parity6.

import { describe, expect, it } from 'vitest';

import { asOperator, expectPublished, HOSTS, learnDocument, mount, TENANT, type Host, type Mounted } from '../_parity';
import { missingStatements } from '../_parity3';
import { consoleAt, type OpenConsole } from '../_parity6';

// ---------------------------------------------------------------------------
// P41's fixture (src/units/P41/LEDGER.unit.test.ts:96-142), copied.
// ---------------------------------------------------------------------------

const STORY = 'home-stories', OFFERS = 'home-offers', PICKS = 'home-picks';
const story = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, customerContentId: `TAP-${id.toUpperCase().replace(/\./g, '-')}`,
  type: 'editorial', title, tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' }, ...over });
const DECLARED = [story('story.bag', 'Carry the Tabby', { successEvent: 'add_to_bag' }), story('story.film', 'The Tabby in motion'), story('story.charm', 'Charm it', { successEvent: 'purchase' })];
const SLOTS_CW1 = { version: 'parity-p41-slots', governanceVersion: 3, pages: { home: [{ slot: STORY, take: 3, weights: { line: 1 } },
  { slot: OFFERS, take: 2, weights: { line: 1 } }, { slot: PICKS, take: 2, weights: { line: 1 } }] } };
/** The story slot omits click, the offers slot omits add_to_bag, the picks slot names click. */
const OMITTING = learnDocument({
  [STORY]: { measurementBasis: 'rendered-v1', reward: 'click', gamma: 1, conversions: { add_to_bag: 5 } },
  [OFFERS]: { reward: 'add_to_bag', conversions: { purchase: 3, click: 1 } },
  [PICKS]: { reward: 'click', conversions: { click: 2, add_to_bag: 5 } },
});
/** The same slots, every table naming its slot's own reward. */
const NAMING = learnDocument({
  [STORY]: { measurementBasis: 'rendered-v1', reward: 'click', gamma: 1, conversions: { add_to_bag: 5, click: 1 } },
  [OFFERS]: { reward: 'add_to_bag', conversions: { add_to_bag: 2, purchase: 3 } },
  [PICKS]: { reward: 'click', conversions: { click: 2, add_to_bag: 5 } },
});
/** P41's ruled warnings for OMITTING, in slot-name order (kit 02:1066). */
const WARNINGS = [{ reward: 'add_to_bag', slot: OFFERS }, { reward: 'click', slot: STORY }];

const DIALS = `#/dials?scope=${TENANT}&slot=${STORY}`;
const TRUST = `slots.${STORY}.gamma`;

async function world(host: Host, learn: unknown): Promise<Mounted> {
  const m = await mount(host, { pieces: DECLARED, slots: SLOTS_CW1, learn });
  expectPublished(m, 'P46 — the stories, the three home slots and the learn document publish');
  return m;
}

/** The advisories on the screen with the given label: each one's warning lines. */
const advisoriesOf = (c: OpenConsole, label: 'check' | 'save') => c.all(`#view [data-learn-advisory="${label}"]`)
  .map(el => Array.from(el.querySelectorAll('li')).map(li => (li.textContent || '').replace(/\s+/g, ' ').trim()));
/** Each ruled warning, against the screen's lines: the line naming its slot, and whether that line names its reward and the consequence. */
function warningsOn(lines: string[] | undefined) {
  return WARNINGS.map(w => {
    const line = (lines ?? []).find(l => l.includes(w.slot));
    return { slot: w.slot, line: !!line, reward: !!line && new RegExp(w.reward.replace(/_/g, '[_ ]')).test(line),
      consequence: !!line && /undeclared pieces/i.test(line) && /earn nothing/i.test(line) };
  });
}
const SHOWN = WARNINGS.map(w => ({ slot: w.slot, line: true, reward: true, consequence: true }));

// ===========================================================================
// unit:P46.DA1 — the screen's check and save show each warning beside the result
// ===========================================================================

describe('unit:P46.DA1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the shipped Dials screen of the story slot, with the omitting tables stored, the operator changes the trust dial; the screen's check and then its save show each warning of the answer's advisory — the slot, its reward and that undeclared pieces there earn nothing — beside the result, from exactly the requests the console at BASE makes`, async () => {
      const m = await world(host, OMITTING);
      const c = await consoleAt(m, DIALS);
      let checkCalls: string[] = [], saveCalls: string[] = [];
      try {
        expect(await c.type(TRUST, '0.5'), `${host}: PRECONDITION — the Dials screen offers the story slot's trust dial (${c.text().slice(0, 300)})`).toBe(true);
        checkCalls = c.calls();
        const check = c.requests.filter(r => r.method === 'POST' && r.path.startsWith('/content/learn/validate')).at(-1);
        expect(check, `${host}: PRECONDITION — the screen checked the draft through the validate door (${c.calls().join(' | ')})`).toBeTruthy();
        const answered = await asOperator(m, 'POST', `/content/learn/validate?scope=${TENANT}`, JSON.parse(check!.body ?? '{}'));
        expect((answered.body.diagnostics as { warnings?: unknown[] } | undefined)?.warnings?.length,
          `${host}: PRECONDITION (P41.CW1, receipted) — the validate door's answer to the screen's draft carries the advisory's two warnings (${JSON.stringify(answered.body).slice(0, 200)})`).toBe(2);
        const checked = advisoriesOf(c, 'check');
        expect.soft(checked.length, `${host}: P46.DA1 — the screen shows the check's advisory once (view: ${c.text().slice(0, 400)})`).toBe(1);
        expect.soft(warningsOn(checked[0]), `${host}: P46.DA1 — each warning of the check's answer is shown with its slot, its reward and the consequence (${JSON.stringify(checked)})`).toEqual(SHOWN);

        await c.save();
        saveCalls = c.calls();
        const puts = c.requests.filter(r => r.method === 'PUT' && r.path.startsWith('/content/learn'));
        expect(puts.length, `${host}: PRECONDITION — the screen saved through PUT /content/learn (${c.calls().join(' | ')})`).toBe(1);
        const stored = await asOperator(m, 'GET', `/content/learn?scope=${TENANT}`);
        expect([stored.body.revision, (stored.body.document as { slots?: Record<string, { gamma?: number }> }).slots?.[STORY]?.gamma],
          `${host}: PRECONDITION — the save published revision 2 with the new trust`).toEqual([2, 0.5]);
        const saved = advisoriesOf(c, 'save');
        expect.soft(saved.length, `${host}: P46.DA1 — after the save the screen shows the save's advisory once, beside its result (view: ${c.text().slice(0, 400)})`).toBe(1);
        expect.soft(warningsOn(saved[0]), `${host}: P46.DA1 — each warning of the save's answer is shown with its slot, its reward and the consequence (${JSON.stringify(saved)})`).toEqual(SHOWN);
      } finally { c.close(); }
      // The same actions on the console at BASE, over the same stored document: the requests it makes for the advised screen.
      const b = await consoleAt(await world(host, OMITTING), DIALS, 'base');
      try {
        expect(await b.type(TRUST, '0.5'), `${host}: PRECONDITION — the console at BASE offers the trust dial`).toBe(true);
        const baseCheck = b.calls();
        await b.save();
        expect.soft([checkCalls, saveCalls], `${host}: P46.DA1 — on the advised screen the console makes exactly the requests the console at BASE makes, after the check and after the save: no new request`)
          .toEqual([baseCheck, b.calls()]);
      } finally { b.close(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P46.DA2 — LOCK: an answer without the member renders as today, with today's requests
// ===========================================================================

describe('unit:P46.DA2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — with tables that name their slots' rewards (answers without diagnostics), the screen's check and its save render byte for byte as the console at BASE renders them, from the same requests`, async () => {
      const run = async (views: 'head' | 'base') => {
        const m = await world(host, NAMING);
        const c = await consoleAt(m, DIALS, views);
        try {
          expect(await c.type(TRUST, '0.5'), `${host}/${views}: PRECONDITION — the trust dial is offered`).toBe(true);
          const checked = c.view();
          await c.save();
          const stored = await asOperator(m, 'GET', `/content/learn?scope=${TENANT}`);
          expect(stored.body.revision, `${host}/${views}: PRECONDITION — the save published revision 2`).toBe(2);
          return { checked, saved: c.view(), calls: c.calls() };
        } finally { c.close(); }
      };
      const head = await run('head'), base = await run('base');
      expect(head.checked, `${host}: P46.DA2 — after the check, the screen's HTML is the console at BASE's`).toBe(base.checked);
      expect(head.saved, `${host}: P46.DA2 — after the save, the screen's HTML is the console at BASE's`).toBe(base.saved);
      expect(head.calls, `${host}: P46.DA2 — the screen makes exactly the requests it makes at BASE`).toEqual(base.calls);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P46.DA3 — the kit
// ===========================================================================

describe('unit:P46.DA3', () => {
  it('logic: the API reference states that the console\'s Dials screen shows the learn publication\'s advisory, each warning\'s slot, reward and consequence, beside its check and save', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md'], [
      { name: 'the Dials screen shows the advisory of the learn validate and PUT answers beside the result: each warning\'s slot, reward and consequence',
        test: t => /Dials screen/i.test(t) && /(diagnostics|advisory|conversions_omit_slot_reward|warning)/i.test(t) && /\bslot\b/.test(t) && /\breward\b/.test(t)
          && /(earn nothing|undeclared|consequence)/i.test(t) },
    ]);
    expect(missing, 'P46.DA3 — kit 02 states the Dials screen\'s advisory').toEqual([]);
  });
});
