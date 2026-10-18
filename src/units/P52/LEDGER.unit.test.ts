// src/units/P52/LEDGER.unit.test.ts
// P52 under the Closure Ledger: the tests for the LOCAL criteria of the P52 work
// order (the fifth parity programme (amendment 4), ticket P52 "A stored conversion
// table that omits the slot's reward is told on the Dials screen before the first
// edit"). DC1 (D1, RESOLVED by the owner's rule R-P78: the read tells the operator
// what the stored document would be told at publication) is exercised inside RA1-RA3;
// LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P52.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-4/BTI-Parity-Amendment-2026-10-17b.md,
//     section 2, P52): "on both hosts, the learn document's read (`GET /content/learn`)
//     carries P41's envelope as an advisory member when the stored document has at
//     least one warning and nothing otherwise, byte for byte today's answer in that
//     case; the Dials screen renders it on open in P46's element idiom (valued for the
//     read), and clears or replaces it as P46 rules for the check and the save; the
//     publication, credits, records and replay unchanged; P41's, P46's and P16's units
//     unchanged; kit 02 and 03 state it";
//   · P41's receipted envelope (src/units/P41/LEDGER.unit.test.ts:39-52, :133-136;
//     src/content/kinds.ts:1857 `learnConversionDiagnostics`; kit 02:1050-1063): the
//     member `diagnostics: { advisory: true, omittedWarningCount, schema:
//     'learn-conversion-diagnostics/v1', status: 'available', warningCount, warnings:
//     [{ code: 'conversions_omit_slot_reward', consequence: 'undeclared_pieces_earn_nothing',
//     reward, slot }] }`, keys sorted, warnings in slot-name order, on the success
//     answers of `PUT /content/learn` and `POST /content/learn/validate`, only when a
//     table omits its slot's reward; kit 02:1061-1063 "no read carries it (`GET
//     /content/learn`, its history and revisions, …), so a document stored with such a
//     table … is told only when it is next published or validated" — the gap the
//     P46 review named (P46/reviewer/REPORT.md §11);
//   · the read today: src/routes/content.ts:638-660 (`GET /content/:kind`: scope, kind,
//     source, revision, publication, actor, note, at, document, envelope; the catalogue's
//     read adds its own `diagnostics` last, the slots read its `pinDiagnostics` and
//     `constraintDiagnostics`); the history (:662-668: scope, kind, revisions) and a
//     revision (:670-678: scope, kind and the revision's revision, value, actor, note, at,
//     publication);
//   · P46's receipted element (src/units/P46/LEDGER.unit.test.ts:38-58;
//     public/console/views.js:488-575): one `data-learn-advisory` element (`check` |
//     `save`) in `#view` where a refused draft's errors render, one `li` per warning
//     naming its slot, its reward and the consequence; it stands while the draft it
//     advised is on screen, every edit drops it and the check's answer replaces it, and
//     entering the screen clears it (`loadDials`, which reads `GET /content/learn` on
//     entering: views.js:505-522).
//
// THE ADVISORY ON THE READ AND ON THE SCREEN, RULED (D1 leaves the read-side member's
// placement to the specifier, in P41's envelope and P46's element idiom):
//   · THE READ. `GET /content/learn` (the tenant's learn document in force, stored or
//     compiled default) carries, when that document has at least one warning, the member
//     `diagnostics` — P41's envelope exactly as the learn PUT would answer it for that
//     document, keys sorted (R-P3), warnings in slot-name order — as its LAST member,
//     after today's members (the catalogue read's own idiom). A document without a
//     warning (no table, or every table naming its slot's reward) is answered exactly
//     as today: today's members, in today's order, no `diagnostics`. The learn history
//     and revision reads, and every other read, answer exactly as today.
//   · THE SCREEN. On entering the Dials screen (`#/dials`), the read's advisory is drawn
//     in P46's element, valued for the read: ONE element `data-learn-advisory="read"`,
//     where P46 draws its own, one `li` per warning naming its slot, its reward (the code
//     word or the console's words) and that undeclared pieces on that slot earn nothing.
//     It is P46's kept advisory for the draft read on entering, so P46's rules apply to
//     it: an edit drops it and the check's answer replaces it (`check`, or nothing when
//     the check's answer carries none), the save's answer replaces that (`save`), and
//     entering the screen again draws the read's anew. At most one `data-learn-advisory`
//     element at a time. Words: the builder's (for example "The stored learn document has
//     a conversion warning: on the slots below a piece that declares no success event of
//     its own is credited nothing.").
//   · NO NEW REQUEST, NO OTHER CHANGE. The screen draws it from the read it already
//     makes on entering: its request list is the base console's (BASE7, f48c50b9) on
//     opening, after the check and after the save; a document without a warning opens
//     the screen exactly as the base console does. The publication, its answers, the
//     credits online and offline, the records, receipts and replay are P41's and P16's.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P52.log):
//   · src/units/P41/LEDGER.unit.test.ts:227-232 (P41.CW2, first leg) reads `GET
//     /content/learn` back to rebuild today's PUT answer, for documents WITHOUT a warning
//     (no table; tables naming their reward): under the ruling that read is today's, so
//     the lock holds; no receipted assertion requires "no read carries the advisory" (it
//     is kit 02:1061-1063's sentence, which the build rewords; P41.CW3's statements,
//     P41:290-305, stay satisfiable);
//   · src/units/P46/LEDGER.unit.test.ts:141-185 (P46.DA1) opens the Dials screen on the
//     omitting tables and counts `data-learn-advisory="check"` and `"save"` elements and
//     compares the request lists with views.js at c7543471: under the ruling the read's
//     advisory is replaced by the check's and the save's and no request is added, so it
//     holds; P46.DA2 (:187-212) opens on tables naming their rewards: no advisory, today's
//     screen;
//   · console and route tests reading `GET /content/learn` for documents without an
//     omitting table (W18 B1:596, P05:599-622, P09) are answered as today.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the read's
// `diagnostics` member and the screen's `data-learn-advisory="read"` element. No new
// export is imported.
//
// FIXTURE. P41's and P46's (src/units/P41/LEDGER.unit.test.ts:96-136, copied as P46
// copied it): the three home slots, the story slot rewarded on click with `{ add_to_bag:
// 5 }` (omits click), the offers slot rewarded on add to bag with `{ purchase: 3, click:
// 1 }` (omits add_to_bag), the picks slot naming its reward; the document stored before
// the screen opens. NAMING: every table names its slot's reward. PLAIN: no table.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (the kit), src/units/_parity6.ts
// (`keyOrders`), src/units/_parity7.ts (the console with views.js at head or at BASE7).
// Imports from src/units/: ../_parity, ../_parity3, ../_parity6, ../_parity7.

import { describe, expect, it } from 'vitest';

import { asOperator, expectPublished, HOSTS, learnDocument, mount, TENANT, type Answer, type Host, type Mounted } from '../_parity';
import { kitSentences, missingStatements } from '../_parity3';
import { keyOrders } from '../_parity6';
import { consoleAt7, type OpenConsole7 } from '../_parity7';

// ---------------------------------------------------------------------------
// P41's fixture (src/units/P41/LEDGER.unit.test.ts:96-136), copied as P46 copies it.
// ---------------------------------------------------------------------------

const STORY = 'home-stories', OFFERS = 'home-offers', PICKS = 'home-picks';
const story = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, customerContentId: `REF-${id.toUpperCase().replace(/\./g, '-')}`,
  type: 'editorial', title, tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' }, ...over });
const DECLARED = [story('story.bag', 'Carry the bag', { successEvent: 'add_to_bag' }), story('story.film', 'The bag in motion'), story('story.charm', 'Charm it', { successEvent: 'purchase' })];
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
/** The same slots without any table. */
const PLAIN = learnDocument({ [STORY]: { measurementBasis: 'rendered-v1', reward: 'click', gamma: 1 }, [OFFERS]: { reward: 'add_to_bag' }, [PICKS]: { reward: 'click' } });

/** P41's ruled envelope for OMITTING (src/units/P41/LEDGER.unit.test.ts:133-136), warnings in slot-name order (kit 02:1066). */
const warning = (slot: string, reward: string) => ({ code: 'conversions_omit_slot_reward', consequence: 'undeclared_pieces_earn_nothing', reward, slot });
const EXPECTED_ADVISORY = { advisory: true, omittedWarningCount: 0, schema: 'learn-conversion-diagnostics/v1', status: 'available', warningCount: 2,
  warnings: [warning(OFFERS, 'add_to_bag'), warning(STORY, 'click')] };
/** P46's words for each warning (src/units/P46/LEDGER.unit.test.ts:113-135). */
const WARNINGS = [{ reward: 'add_to_bag', slot: OFFERS }, { reward: 'click', slot: STORY }];

/** Today's read members, in order (src/routes/content.ts:651-654 for a kind other than the catalogue and the slots). */
const READ_MEMBERS = ['scope', 'kind', 'source', 'revision', 'publication', 'actor', 'note', 'at', 'document', 'envelope'];
/** Today's history and revision reads (src/routes/content.ts:662-678; the revision's own members, src/config/publication.ts:506). */
const HISTORY_MEMBERS = ['scope', 'kind', 'revisions'];
const REVISION_MEMBERS = ['scope', 'kind', 'revision', 'value', 'actor', 'note', 'at', 'publication'];

const DIALS = `#/dials?scope=${TENANT}&slot=${STORY}`;
const TRUST = `slots.${STORY}.gamma`;
const readLearn = (m: Mounted) => asOperator(m, 'GET', `/content/learn?scope=${TENANT}`);

async function world(host: Host, learn: unknown): Promise<Mounted> {
  const m = await mount(host, { pieces: DECLARED, slots: SLOTS_CW1, learn });
  expectPublished(m, 'P52 — the stories, the three home slots and the learn document publish');
  return m;
}
const memberOf = (answer: Answer, member: string) => (Object.hasOwn(answer.body, member) ? answer.body[member] : `no ${member} member (members: ${Object.keys(answer.body).join(', ')})`);
/** Every advisory element on the screen: its label, and its warning lines. */
const advisoriesOn = (c: OpenConsole7) => c.all('#view [data-learn-advisory]')
  .map(el => ({ label: el.getAttribute('data-learn-advisory'), lines: Array.from(el.querySelectorAll('li')).map(li => (li.textContent || '').replace(/\s+/g, ' ').trim()) }));
/** Each warning, against the lines: the line naming its slot, and whether that line names its reward and the consequence (P46's measure). */
function warningsOn(lines: string[] | undefined) {
  return WARNINGS.map(w => {
    const line = (lines ?? []).find(l => l.includes(w.slot));
    return { slot: w.slot, line: !!line, reward: !!line && new RegExp(w.reward.replace(/_/g, '[_ ]')).test(line),
      consequence: !!line && /undeclared pieces/i.test(line) && /earn nothing/i.test(line) };
  });
}
const SHOWN = WARNINGS.map(w => ({ slot: w.slot, line: true, reward: true, consequence: true }));

// ===========================================================================
// unit:P52.RA1 — the read carries P41's envelope; the Dials screen shows it on open
// ===========================================================================

describe('unit:P52.RA1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): GET /content/learn on a stored document whose tables omit their slots' rewards carries P41's envelope as its last member, keys sorted; a stored document whose tables name their rewards, and one without a table, are answered with today's members only`, async () => {
      const m = await world(host, OMITTING);
      const read = await readLearn(m);
      expect(read.status, `${host}: PRECONDITION — the learn document reads (${JSON.stringify(read.body).slice(0, 200)})`).toBe(200);
      expect.soft(memberOf(read, 'diagnostics'), `${host}: P52.RA1 — the read carries P41's envelope, one warning per slot whose table omits its reward`).toEqual(EXPECTED_ADVISORY);
      expect.soft(Object.keys(read.body), `${host}: P52.RA1 — as the read's last member, after today's members`).toEqual([...READ_MEMBERS, 'diagnostics']);
      expect.soft(keyOrders(read.body.diagnostics).filter(([written, sorted]) => written.join() !== sorted.join()), `${host}: P52.RA1 — R-P3: written with sorted keys`).toEqual([]);
      for (const [name, document] of [['whose tables name their rewards', NAMING], ['without a table', PLAIN]] as const) {
        const n = await world(host, document);
        const plain = await readLearn(n);
        expect.soft([plain.status, Object.keys(plain.body)], `${host}: P52.RA1 — a stored document ${name} is answered with today's members, in today's order`).toEqual([200, READ_MEMBERS]);
      }
    }, 120_000);

    it(`host (${host}): on the shipped Dials screen of the story slot, with the omitting tables stored, the screen shows the read's advisory on open — one element valued read, each warning's slot, reward and consequence — from exactly the requests the console at BASE7 makes; the operator's edit and the check replace it with the check's, the save with the save's`, async () => {
      const m = await world(host, OMITTING);
      const c = await consoleAt7(m, DIALS);
      let openCalls: string[] = [], checkCalls: string[] = [], saveCalls: string[] = [];
      try {
        expect(c.requests.some(r => r.method === 'GET' && r.path.startsWith('/content/learn')), `${host}: PRECONDITION — the screen read the learn document on entering (${c.calls().join(' | ')})`).toBe(true);
        openCalls = c.calls();
        const opened = advisoriesOn(c);
        expect.soft(opened.map(a => a.label), `${host}: P52.RA1 — on open the screen shows the read's advisory, once (view: ${c.text().slice(0, 400)})`).toEqual(['read']);
        expect.soft(warningsOn(opened[0]?.lines), `${host}: P52.RA1 — each warning of the read is shown with its slot, its reward and the consequence (${JSON.stringify(opened)})`).toEqual(SHOWN);

        expect(await c.type(TRUST, '0.5'), `${host}: PRECONDITION — the Dials screen offers the story slot's trust dial`).toBe(true);
        checkCalls = c.calls();
        const checked = advisoriesOn(c);
        expect.soft(checked.map(a => a.label), `${host}: P52.RA1 — after the edit the check's advisory replaces the read's (P46's rule)`).toEqual(['check']);
        expect.soft(warningsOn(checked[0]?.lines), `${host}: P52.RA1 — with each warning of the check's answer`).toEqual(SHOWN);

        await c.save();
        saveCalls = c.calls();
        const stored = await readLearn(m);
        expect(stored.body.revision, `${host}: PRECONDITION — the save published revision 2`).toBe(2);
        const saved = advisoriesOn(c);
        expect.soft(saved.map(a => a.label), `${host}: P52.RA1 — after the save the save's advisory replaces the check's`).toEqual(['save']);
      } finally { c.close(); }
      const b = await consoleAt7(await world(host, OMITTING), DIALS, 'base');
      try {
        const baseOpen = b.calls();
        expect(await b.type(TRUST, '0.5'), `${host}: PRECONDITION — the console at BASE7 offers the trust dial`).toBe(true);
        const baseCheck = b.calls();
        await b.save();
        expect.soft([openCalls, checkCalls, saveCalls], `${host}: P52.RA1 — on the advised screen the console makes exactly the requests the console at BASE7 makes, on open, after the check and after the save: no new request`)
          .toEqual([baseOpen, baseCheck, b.calls()]);
      } finally { b.close(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P52.RA2 — LOCK: the other reads and an unadvised screen as today
// ===========================================================================

describe('unit:P52.RA2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — with the omitting tables stored, the learn history and revision reads answer today's members; with tables naming their rewards, the Dials screen opens byte for byte as the console at BASE7 opens it, from the same requests`, async () => {
      const m = await world(host, OMITTING);
      const history = await asOperator(m, 'GET', `/content/learn/history?scope=${TENANT}`), revision = await asOperator(m, 'GET', `/content/learn/revisions/1?scope=${TENANT}`);
      expect([history.status, Object.keys(history.body)], `${host}: P52.RA2 — the history read is today's`).toEqual([200, HISTORY_MEMBERS]);
      expect([revision.status, Object.keys(revision.body)], `${host}: P52.RA2 — a revision read is today's`).toEqual([200, REVISION_MEMBERS]);
      const n = await world(host, NAMING);
      const head = await consoleAt7(n, DIALS), base = await consoleAt7(n, DIALS, 'base');
      try {
        expect(head.control(TRUST), `${host}: PRECONDITION — the Dials screen is drawn with the trust dial`).toBeTruthy();
        expect(head.view(), `${host}: P52.RA2 — a document without a warning: the screen's HTML on open is the console at BASE7's`).toBe(base.view());
        expect(head.calls(), `${host}: P52.RA2 — and its requests are the console at BASE7's`).toEqual(base.calls());
      } finally { head.close(); base.close(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P52.RA3 — the kit
// ===========================================================================

describe('unit:P52.RA3', () => {
  it('logic: the API reference and the payload schemas state that GET /content/learn carries the advisory when the stored document has a warning and that the Dials screen shows it on open; neither still says no read carries it', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'GET /content/learn carries the diagnostics advisory (learn-conversion-diagnostics/v1) when the stored document has a warning',
        test: t => /GET \/content\/learn/.test(t) && /(diagnostics|advisory|learn-conversion-diagnostics)/.test(t) && /(stored|in force)/i.test(t) && /(carries|answers|read)/i.test(t) && !/no read carries/i.test(t) },
      { name: 'the Dials screen shows the read\'s advisory on open (entering the screen), before any edit',
        test: t => /Dials screen/i.test(t) && /(advisory|diagnostics|warning)/i.test(t) && /(on open|opens|entering|enters|before (the|any) (first )?edit)/i.test(t) },
    ]);
    const denying = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'].flatMap(file => kitSentences(file)
      .filter(t => /no read carries/i.test(t) || /told only when it is next published or validated/i.test(t)).map(t => `${file}: ${t.slice(0, 160)}`));
    expect.soft(missing, 'P52.RA3 — kit 02 and 03 state the read\'s advisory and the screen\'s rendering on open').toEqual([]);
    expect.soft(denying, 'P52.RA3 — the sentences saying no read carries the advisory are reworded (kit 02:1061-1063)').toEqual([]);
  });
});
