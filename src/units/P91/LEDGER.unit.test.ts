// src/units/P91/LEDGER.unit.test.ts
// P91 under the Closure Ledger (programme `tapestry-parity-activation`, amendment 11, item E16): the tests for the LOCAL
// criteria IM1–IM4 of the P91 work order (docs/parity/activation/program.json). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md, E16):
//   "#### E16 · Import improvements the export specification states
//    - **Done when:** a load with no `mode` is refused rather than treated as replace; a load that changes nothing is
//      skipped and says so; a dry run validates an export under the import's own rules (CSV, aliases, merge) without
//      writing; a full-export mode expires the pieces missing from the file behind a guard; a source-address allow-list
//      on the import endpoint.
//    - **Starts from:** `src/content/import.ts`, `src/routes/content.ts` (`POST /content/catalog/import`, the validate route).
//    - **Needed by:** the first dataset for the no-mode refusal; the production export job for the rest. Hours to half a
//      day each."
// The pack's export specification (docs/tapestry-packs/2-content-and-cms/05-export-specification.md, the Windows checkout,
// read as a document) states the loads' behaviours (:70–118, :187–203).
//
// PROVISIONAL (S28): the readings below are the lead's provisional readings of the brief with the specifier's proposals
// for the members the brief leaves open, for ruling; only IM1's legs are written. Nothing is measured yet.
//
// READINGS
//   1  IM1. `POST /content/catalog/import` and `POST /content/catalog/pull` with no `mode`, or a mode outside `merge`,
//      `replace` and `full` (reading 4), answer 400 `{ ok: false, error: <a sentence naming merge, replace and full>,
//      code: 'mode_required' }` and write nothing: no revision, no publication record, no diagnostics member. PROPOSED
//      PLACEMENT: after the operator authority (401/403), the tenant scope and the authored preconditions (428, a
//      malformed If-Match 400), and before anything is read or fetched: the import checks its query `mode` before
//      reading the body; the pull reads its JSON body (the mode is a body member) and checks it before the URL and
//      before any fetch. So a no-mode request reads or fetches nothing (413 and 502 answers for an import or pull that
//      names no mode become this 400: see the R10 sweep).
//   2  IM2. A load (import or pull, any mode) whose assembled catalogue document equals the stored one (the same pieces in
//      the same order, every member equal, compared on the canonical form the store digests) writes nothing and answers
//      200 with the written load's members (`ok`, `scope`, `mode`, `received`, `imported`, `pieces`, `changed: 0`,
//      `removed: 0`, `changedBasis`, `diagnostics` computed as for a written load) plus `skipped: true` and
//      `reason: 'unchanged'`, its `revision`, `publication` and `version` those IN FORCE (no new revision, no publication
//      record, no receipt: a retry of a skipped request is decided again). The authored preconditions still hold (a stale
//      If-Match is 409 as today). A load that differs in any member of any piece writes as today.
//   3  IM3. PROPOSED SWITCH: the import's query member `dryRun=1` (any other value: 400 naming `dryRun`), on JSON and CSV
//      alike, through the same path as the import (aliases, CSV columns, merge or replace against the stored catalogue,
//      the vocabulary in effect, P82's `records[k] '<id>'` address): the same 422 body on refusal; on acceptance the same
//      200 members as the import (or the skip of reading 2) plus `dryRun: true`, with `revision`, `publication` and
//      `version` those in force and nothing written. The authored preconditions are not required (it writes nothing).
//      `POST /content/catalog/validate` is unchanged (LOCK). A dry run of a pull is not offered (TOLD).
//   4  IM4. PROPOSED MODE WORD `full`: the file's records replace the catalogue as `replace` does, and every stored piece
//      the file leaves out is kept after them, in its stored order, with `lifecycle: { status: 'expired' }` (an expired
//      piece is eligible for no decision). PROPOSED GUARD: the request names the number of pieces it expires, `expire=<n>`
//      on the import's query, `expire: n` in the pull's body; absent, 428 `{ code: 'expire_required', expire: <the count> }`
//      naming `expire` and the count; different, 409 `{ code: 'expire_mismatch', expire: <the count> }` naming both;
//      nothing written either way. The kit can state it in one sentence: "`mode=full` replaces the catalogue and expires
//      every stored piece the file leaves out; it requires `expire=<n>`, the number it expires, and is refused naming
//      that number otherwise." PROPOSED ALLOW-LIST HOME: the tenant's slots document gains `importSources` (beside
//      `signalFloor`, a tenant-wide content setting, published and rolled back like it; a catalogue import never touches
//      it): 1 to 64 entries, each an IPv4 or IPv6 address or CIDR range, refused by name otherwise. With the list set,
//      the import (dry run included) and the pull answer 403 `{ code: 'source_not_allowed' }` naming the address to a
//      caller whose `CF-Connecting-IP` is outside it (never `X-Forwarded-For`, which the caller writes; a request
//      without `CF-Connecting-IP` is outside any list), writing nothing; without it every caller is allowed as today.
//      The customer boundary (src/customerBoundary.ts) admits paths and methods, not query members, so `mode=full` and
//      `dryRun=1` pass it already (a lock); a customer-profile leg on the in-process customer stamp
//      (src/units/W08/_customer.ts customerStamp) is offered for the allow-list.
//   5  Locks: W19's import tests, P82, P38, P02, P08, the content, import and complements tests and the publication tests;
//      PUT and validate unchanged; the kit's import and pull sentences (kit 02 :1726–1727, kit 03 :246–251) state the four
//      behaviours.
//
// WHAT THE CODE OR THE PACK CONTRADICTS (told):
//   · The pack says "A load that does not say which mode it is in is read as replace" (05 :77) and "Merge named on every
//     load … A load without a mode is read as replace" (05 :197): IM1 makes it a refusal; the pack's sentences are the
//     documents lane's. The pack says "every load is a revision your team can see" and "Loading the same file twice
//     answers changed: 0" (05 :116–118): IM2 keeps `changed: 0` and writes no revision.
//   · W19.F1.03 (src/units/W19/B1.unit.test.ts :631–646) rules the opposite of IM2 in its own words: "each accepted import
//     allocates the next revision, byte-identical or not". A ruling is needed (R10 sweep, part B).
//   · Every import and pull drops the catalogue's P32 marker `typeFallback` (src/routes/content.ts importInto publishes
//     `{ version?, pieces }` only): a stored catalogue carrying the marker never equals an import's assembled document,
//     so it is never skipped, and an import un-retires the fallback. Observed, not P91's.
//
// THE R10 SWEEP (reading 1; each line the R10 proposed: the mode the test's expectations already assume)
//   A. Without a mode (the grant's own kind):
//     src/routes/content.test.ts :546 import (`bad.pieces`, the catalogue becomes them) → `?mode=replace`; :551 pull
//       (warningCount 2, the pulled piece alone) → body `mode: 'replace'`; :564 pull (503, the recovered document's first
//       piece is 'pulled') → `mode: 'replace'`; :840 import (its answer is matched `mode: 'replace'`) → `&mode=replace`;
//       :845 and :849 imports refused 422 → `&mode=replace`; :855 pull (`pieces: 1`) → `mode: 'replace'`; :858 pull refused
//       400 for its file: URL → `mode: 'replace'` (so it still measures the URL); :961, :964, :969 pulls (409, 503, 409; :964
//       publishes, the other two carry the pending operation's body) → `mode: 'replace'`; :1008 the oversized lanes
//       `/content/catalog/import` and `/content/catalog/import?format=csv` (413) → `?mode=replace` / `&mode=replace` (the pull
//       lane's body is read before its mode: unchanged); :1040 the over-many-records import (413) → `?mode=replace`; :1047
//       and :1051 pulls (413 twice, 502) → `mode: 'replace'`; :1056 and :1058 the 501-record import and its exact retry
//       (`pieces: 501`) → `?mode=replace` on both. Unchanged: :911–917 (401 before anything), :950–951 (428 and 400 before
//       the body), :1021 (401, 428, 403 before the mode).
//     src/units/W19/B2.unit.test.ts :670–672 (W19.L1.01's JSON import, CSV import and pull of the feed over an empty
//       catalogue) → `mode=replace` on the two imports' query and `mode: 'replace'` in the pull's body; :701 import over an
//       empty catalogue → `&mode=replace`; :973–974 (W19.S1.01's JSON import and pull) → as :670–672; :1062 import (empty
//       catalogue) → `&mode=replace`; :1112 and :1129 imports refused 422 → `&mode=replace`.
//     scripts/import-content.mjs :92–93 (product, outside the grant): the demo importer's pull names no mode → it would
//       be refused; the builder's grant adds `mode: 'replace'` (the demo catalogue replaces the stored one, as today).
//     The kit (kit 02 :1726–1727): the import row reads `mode=replace|merge` and the pull row `mode?` (optional): restated
//       by the builder (reading 5), locked here.
//     Every other import or pull in src/units/** and src/**/*.test.ts names its mode (W19 B1 and B3 default `replace`,
//       P82, P44, P38, P77, P31, W20 B1, content.test.ts :547, :843, :954–959).
//   B. IM2 collisions (the same catalogue loaded twice expecting a new revision; beyond the mode-only grant, each needs a
//     ruling): src/units/W19/B1.unit.test.ts W19.F1.03 :605–646 (a byte-identical re-import, the CSV round trip and the
//     second identical import each expect a new revision, :631–634 "byte-identical or not"); src/units/W19/B2.unit.test.ts
//     W19.L1.01 :666–691 (the same feed by JSON import, CSV import, pull and PUT, each `revision` + 1; the CSV import and
//     the pull would be skipped, and the next path's If-Match would then name a revision ahead of the one in force) and
//     W19.S1.01 :972–985 (the same, JSON import, pull and PUT). The full list is measured under the sketch once the gate
//     allows (the whole suite, today against the sketch).
//
// HARNESS: src/units/_parity.ts (the mounted app, both shopper hosts, the operator routes) and src/units/_parity5.ts (the home
// page's pieces and documents). Imports from src/units/: ../_parity, ../_parity5.

import { describe, expect, it, vi } from 'vitest';

import { asOperator, errorsOf, expectPublished, HOSTS, loadDocument, mount, TENANT, type Answer, type Mounted } from '../_parity';
import { HERO, HOME_PIECES, homeLearn, homeSlots } from '../_parity5';

const piece = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'editorial', title: `Story ${id}`, tags: { line: ['Tabby'] }, slotTypes: [HERO], ...extra });
const DOCS = { pieces: [...HOME_PIECES], slots: homeSlots(), learn: homeLearn() };
const preconditions = async (m: Mounted) => {
  const base = await loadDocument(m, 'catalog');
  return { 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` };
};
const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
/** The catalogue in force: its revision, its publication revision and its piece ids. */
const inForce = async (m: Mounted) => { const d = await loadDocument(m, 'catalog');
  return { revision: d.revision, publication: d.publication.revision, pieces: (d.document.pieces as Array<{ id: string }>).map(p => p.id) }; };
/** Whether a refusal names every mode word. */
const namesModes = (a: Answer) => { const words = errorsOf(a).join(' ');
  return ['merge', 'replace', 'full'].every(w => new RegExp(`\\b${w}\\b`).test(words)) ? 'names merge, replace and full' : `does not name them all (${words.slice(0, 200)})`; };

// ===========================================================================
// unit:P91.IM1 — a load names its mode or is refused
// ===========================================================================

describe('unit:P91.IM1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an import and a pull with no mode, or with a mode the contract does not list, are refused 400 naming merge, replace and full, and write nothing (no revision, no publication record, no diagnostics)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P91.IM1 — the tenant documents publish');
      const before = await inForce(m);
      const records = [piece('story.new-one')];
      // The feed a pull would fetch, answered by a stub (no network): today the pull fetches and publishes it as a replace.
      const feed = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: records }), { headers: { 'Content-Type': 'application/json' } }));
      const answers: Array<[string, Answer]> = [
        ['import, no mode', await asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}`, records, await preconditions(m))],
        ['import, mode=upsert', await asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}&mode=upsert`, records, await preconditions(m))],
        ['pull, no mode', await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, { url: 'https://cms.example.invalid/p91-feed.json', path: 'content' }, await preconditions(m))],
        ['pull, mode upsert', await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, { url: 'https://cms.example.invalid/p91-feed.json', path: 'content', mode: 'upsert' }, await preconditions(m))],
      ];
      feed.mockRestore();
      expect.soft(answers.map(([name, a]) => [name, a.status, namesModes(a), Object.hasOwn(a.body, 'diagnostics') ? 'diagnostics' : 'no diagnostics']),
        `${host}: P91.IM1 — each refused 400 naming the modes (today read as replace: ${answers.map(([n, a]) => `${n} ${show(a)}`).join(' | ').slice(0, 400)})`).toEqual(
        answers.map(([name]) => [name, 400, 'names merge, replace and full', 'no diagnostics']));
      expect.soft(await inForce(m), `${host}: P91.IM1 — nothing written: the catalogue, its revision and its publication as before`).toEqual(before);
    }, 120_000);
  }
});
