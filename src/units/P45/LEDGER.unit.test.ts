// src/units/P45/LEDGER.unit.test.ts
// P45 under the Closure Ledger: the tests for the LOCAL criteria of the P45 work
// order (the fourth parity programme (amendment 3),
// ticket P45 "The console's lift grid shows a stale slot"). DC1 (D1,
// RESOLVED by the owner's rule R-P78: the product tells the operator) is exercised
// inside LG1-LG3; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P45.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the console
// renders today:
//   · the authority copy (docs/parity/authority/amendment-3/BTI-Parity-Amendment-2026-10-17.md,
//     section 2, P45): "on the console's lift grid, a slot whose lift/rows answer
//     carries `stale` is marked stale beside its numbers, naming the faulty page and
//     slot and the last successful publish from the marker's members, and loses the
//     mark when the answer no longer carries it; a slot without the marker renders
//     byte for byte as today; the grid makes no new request; kit 02 states it
//     (replacing its sentence that the grid does not show the marker, kit 02 and 03
//     at P42's close)";
//   · P42's receipted marker (src/units/P42/LEDGER.unit.test.ts:43-49, :211):
//     `stale: { lastPublished: { publishedAt, version }, modules, placement: { page, slot } }`
//     on `GET /v1/:tenant/lift/rows` from a publication refused for the pooled cause
//     until the next successful one; P42's world and its R7 injection are copied in
//     src/units/_parity6.ts;
//   · the grid today: public/console/views.js:131-170 (`loadLift` reads lift/rows
//     and keeps the answer as `lift.meta`) and :202-302 (the Lift screen: one card
//     holding the toolbar, the line of the snapshot's facts — reward, basis, prior
//     strength, evidence threshold, `published <when(publishedAt)>` — the table and
//     the pager); nothing in the file reads `stale` (P42/reviewer/REPORT.md §11);
//   · kit 02:1919-1920 ("The console's lift grid does not show the marker yet: read
//     it from `GET /v1/{tenant}/lift`") and kit 03:1503 ("The console's lift grid
//     does not show the marker"), the two sentences the work order replaces.
//
// THE MARK, RULED (D1 leaves the words and the placement to the specifier, in the
// console's existing idiom):
//   · WHERE. On the Lift screen (`#/lift`), for the pooled rows and for an item's
//     cells alike, whenever the lift/rows answer the screen holds carries `stale`:
//     ONE element carrying the attribute `data-lift-stale`, inside the card that
//     holds the grid (the `section.card` with the table), above the table: beside
//     the numbers it qualifies. Its class is the builder's (`msg note`, the
//     console's advisory idiom, fits); no style is required.
//   · WORDS. One sentence, in the console's words, from the marker's members only:
//     that the numbers are stale, the faulty placement's page and slot
//     (`placement.page`, `placement.slot`), and the last successful publish
//     (`lastPublished.version` as "version <n>" and `lastPublished.publishedAt` as the
//     console writes every time, `Console.when(publishedAt)`, the form the snapshot
//     line's "published …" already uses). For example: "Stale: this slot's last
//     publication was refused because the statistics of page home, slot
//     home-modules could not be read; these numbers are version 1760000000000,
//     published <when>, its last successful publication." Naming the pooled
//     modules is allowed, not required.
//   · READING FOR THE BUILD (fix round 1; no unit): P42 admits a marker with
//     `lastPublished: null` (a placement never published successfully, P42/implementer/
//     REPORT.md §6 (a)); lift/rows then answers `published: false` with `stale`, and the Lift
//     screen shows its "Nothing published for this slot yet" message instead of a grid. The
//     mark is drawn there too, beside that message: the same `data-lift-stale` element, naming
//     the faulty page and slot and saying the slot has no successful publication yet (no
//     version, no time).
//   · GONE. A later answer without `stale` (the next successful publication) renders
//     the screen exactly as the console at BASE renders that answer: the mark leaves
//     no trace.
//   · NO NEW REQUEST, NO OTHER CHANGE. The mark is drawn from the answer the grid
//     already reads; for an answer without `stale` the screen's HTML (`#view`) and the
//     console's request list are those of the console at BASE (c7543471), the views.js
//     at BASE evaluated beside this tree's other console files (src/units/_parity6.ts);
//     for an answer with `stale` the request list is the base console's too (LG1, R-P83).
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P45.log):
//   · no test reads the Lift screen's rendering or request list; the console units
//     (W20, W28, P01, P04, P05, P14) drive other screens;
//   · kit 02:1919-1920 and kit 03:1503 state the opposite of the ruling and are
//     replaced by the build (LG3 fails on them); P42.PW4's kit statements
//     (src/units/P42/LEDGER.unit.test.ts:380-393) stay satisfiable.
//
// RULED MEMBERS THAT DO NOT EXIST YET: the `data-lift-stale` element and its words.
// No new export is imported.
//
// FIXTURE. P42's PW1/PW2 world (P08's catalogue and pages, with a cart page and a
// second pooled module on the product and cart pages), the home page's `/pooled`
// door failing while the product page publishes: the product slot's lift/rows
// answer then carries the marker naming the home page's placement (P42.PW2, a
// PRECONDITION here). LG2 is P08's fixture exactly, every publication succeeding.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (publication through every
// object's door; the kit), src/units/_parity6.ts (the console with views.js at head
// or at BASE; P42's world). Imports from src/units/: ../_parity, ../_parity3, ../_parity6.

import { describe, expect, it } from 'vitest';

import { expectPublished, HOSTS, mount, TENANT, type Host, type Mounted } from '../_parity';
import { kitSentences, missingStatements, publishStats } from '../_parity3';
import {
  consoleAt, failPooledDoor, HOME_MODULES, identityOf, liftOf, objectPublish, P08_LEARN, P08_PIECES, P08_SLOTS, P42_LEARN, P42_PIECES, P42_SLOTS,
  PDP_MODULES, POOLED, rowsOf, visit, type OpenConsole, type Published,
} from '../_parity6';

const LIFT = (slot: string, extra = '') => `#/lift?scope=${TENANT}&slot=${slot}${extra}`;

async function world(host: Host, documents: { pieces: unknown[]; slots: unknown; learn: unknown } = { pieces: P42_PIECES, slots: P42_SLOTS, learn: P42_LEARN }): Promise<Mounted> {
  const m = await mount(host, documents);
  expectPublished(m, 'P45 — the catalogue declaring the pooled modules, the pages and the learn document publish');
  return m;
}

/** P42.PW2's sequence: every page visited and published, the product page visited again, its publication refused under the home page's fault. */
async function staleWorld(host: Host): Promise<{ m: Mounted; last: Published }> {
  const m = await world(host);
  await visit(m, 'pdp'); await visit(m, 'home'); await visit(m, 'cart');
  await publishStats(m);
  const last = identityOf(await liftOf(m, PDP_MODULES));
  await visit(m, 'pdp');
  const restore = failPooledDoor(m, HOME_MODULES);
  const refused = await (async () => { try { return await objectPublish(m, PDP_MODULES); } finally { restore(); } })();
  expect(refused.status, `${host}: PRECONDITION (P42.PW1) — the product page's publication fails closed (${JSON.stringify(refused.body).slice(0, 200)})`).toBe(503);
  const rows = await rowsOf(m, PDP_MODULES);
  expect((rows.body.stale as { placement?: unknown } | undefined)?.placement,
    `${host}: PRECONDITION (P42.PW2, receipted) — GET lift/rows for the product slot carries the marker naming the home placement (${JSON.stringify(rows.body).slice(0, 200)})`)
    .toEqual({ page: 'home', slot: HOME_MODULES });
  return { m, last };
}

/** The marks on the Lift screen: each `data-lift-stale` element's text, and whether it sits in the card that holds the table. */
function marksOf(c: OpenConsole): Array<{ text: string; besideTheGrid: boolean }> {
  return c.all('#view [data-lift-stale]').map(el => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    besideTheGrid: !!el.closest('section.card')?.querySelector('table') }));
}
/** What the mark's words name, against the ruling: stale, the faulty page and slot, and the last successful publish (version and time). */
function namedIn(text: string, c: OpenConsole, last: Published) {
  return { stale: /\bstale\b/i.test(text), page: /\bhome\b(?!-)/.test(text), slot: text.includes(HOME_MODULES),
    version: text.includes(`version ${last.version}`), publishedAt: text.includes(c.w.Console.when(last.publishedAt)) };
}
const NAMED = { stale: true, page: true, slot: true, version: true, publishedAt: true };

// ===========================================================================
// unit:P45.LG1 — the grid marks the stale slot, and the mark goes with the marker
// ===========================================================================

describe('unit:P45.LG1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with the product slot's lift/rows answer carrying P42's stale marker, the console's lift grid shows one mark beside its numbers naming the home page, its slot and the last successful publish, from exactly the requests the console at BASE makes; after the next successful publication the same console, asked again, renders the grid exactly as the console at BASE renders it`, async () => {
      const { m, last } = await staleWorld(host);
      const c = await consoleAt(m, LIFT(PDP_MODULES));
      try {
        expect(c.requests.some(r => r.path.startsWith(`/v1/${TENANT}/lift/rows?`) && r.path.includes(`slot=${PDP_MODULES}`)),
          `${host}: PRECONDITION — the Lift screen read the product slot's lift/rows (${c.calls().join(' | ')})`).toBe(true);
        expect(c.all('#view table').length, `${host}: PRECONDITION — the grid is drawn (${c.text().slice(0, 300)})`).toBeGreaterThan(0);
        const marks = marksOf(c);
        expect.soft(marks.length, `${host}: P45.LG1 — the Lift screen shows one stale mark for the product slot (view: ${c.text().slice(0, 400)})`).toBe(1);
        expect.soft(marks.map(x => x.besideTheGrid), `${host}: P45.LG1 — the mark sits in the card that holds the grid, beside its numbers`).toEqual([true]);
        expect.soft(marks.map(x => namedIn(x.text, c, last)), `${host}: P45.LG1 — the mark names the stale numbers, the home page, its slot and the last successful publish (${JSON.stringify(marks.map(x => x.text))})`)
          .toEqual([NAMED]);
        const markedCalls = c.calls(), baseMarked = await consoleAt(m, LIFT(PDP_MODULES), 'base');
        try {
          expect.soft(markedCalls, `${host}: P45.LG1 — on the marked screen the console makes exactly the requests the console at BASE makes for it: no new request`).toEqual(baseMarked.calls());
        } finally { baseMarked.close(); }

        const again = await objectPublish(m, PDP_MODULES);
        expect([again.status, again.body.published], `${host}: PRECONDITION — with the door restored the next publication succeeds (${JSON.stringify(again.body).slice(0, 200)})`).toEqual([200, true]);
        await c.go(LIFT(PDP_MODULES, '&asked=again'));
        const base = await consoleAt(m, LIFT(PDP_MODULES, '&asked=again'), 'base');
        try {
          expect.soft(c.view(), `${host}: P45.LG1 — once the answer carries no marker the mark is gone: the screen is exactly the console at BASE's`).toBe(base.view());
        } finally { base.close(); }
      } finally { c.close(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P45.LG2 — LOCK: a slot without the marker renders as today, with today's requests
// ===========================================================================

describe('unit:P45.LG2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — on P08's fixture, every publication succeeding, the product slot's pooled rows and the pooled module's cells render byte for byte as the console at BASE renders them, from the same requests`, async () => {
      const m = await world(host, { pieces: P08_PIECES, slots: P08_SLOTS, learn: P08_LEARN });
      await visit(m, 'pdp'); await visit(m, 'pdp'); await visit(m, 'home');
      await publishStats(m);
      for (const hash of [LIFT(PDP_MODULES), LIFT(PDP_MODULES, `&item=${encodeURIComponent(POOLED)}`), LIFT(HOME_MODULES)]) {
        const head = await consoleAt(m, hash), base = await consoleAt(m, hash, 'base');
        try {
          expect(head.all('#view table').length, `${host}: PRECONDITION — ${hash}: the grid is drawn (${head.text().slice(0, 300)})`).toBeGreaterThan(0);
          expect(head.view(), `${host}: P45.LG2 — ${hash}: the screen's HTML is the console at BASE's`).toBe(base.view());
          expect(head.calls(), `${host}: P45.LG2 — ${hash}: the console makes exactly the requests it makes at BASE`).toEqual(base.calls());
        } finally { head.close(); base.close(); }
      }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P45.LG3 — the kit
// ===========================================================================

describe('unit:P45.LG3', () => {
  it('logic: the API reference states that the console\'s lift grid marks a stale slot from the marker, and neither kit document still says the grid does not show it', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md'], [
      { name: 'the console\'s lift grid marks a slot whose lift/rows answer carries stale, naming the faulty page and slot and the last successful publish',
        test: t => /console/i.test(t) && /lift grid|grid/i.test(t) && /\bstale\b/.test(t) && /\b(page|placement)\b/.test(t) && /(last successful|lastPublished)/.test(t) },
      { name: 'and the grid\'s mark goes when the answer no longer carries the marker',
        test: t => /lift grid/i.test(t) && /\bstale\b/i.test(t) && /\bmark(s|ed)?\b/i.test(t) && /(no longer|gone|until|after)/i.test(t) },
    ]);
    const denying = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'].flatMap(file => kitSentences(file)
      .filter(t => /lift grid/i.test(t) && /(does not|doesn't|do not) show/i.test(t)).map(t => `${file}: ${t.slice(0, 160)}`));
    expect.soft(missing, 'P45.LG3 — kit 02 states the grid\'s stale mark').toEqual([]);
    expect.soft(denying, 'P45.LG3 — the sentences saying the lift grid does not show the marker are replaced (kit 02:1919-1920, kit 03:1503)').toEqual([]);
  });
});
