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
// THE READINGS, RULED (R-P330, on the builder's code map; the brief's readings 1–5 with the names and the order fixed):
//   1  IM1. `POST /content/catalog/import` and `POST /content/catalog/pull` with no `mode`, or a mode outside `merge`,
//      `replace` and `full`, answer 400 naming the three words and write nothing (no revision, no publication record, no
//      diagnostics); a pull refused so fetches nothing. THE ORDER, on both routes: the operator authority (401/403) → the
//      allow-list (403, reading 4) → the mode, the dry-run switch and the guard's presence (400/428) → the authored
//      preconditions (428/409) → parsing and assembly → the guard's count (409) → the write; the pull reads its JSON body
//      first (its mode, its guard and its URL are body members).
//   2  IM2. A load (import or pull, any mode) whose candidate, stamped at the stored revision (`CONTENT_KIND.stamp`
//      rewrites `version`), has the stored document's digest writes nothing and answers 200 with `skipped: true`,
//      `reason: 'unchanged'`, `revision` the one in force, `changed: 0`, `removed: 0` and the same diagnostics members as a
//      written load; the preconditions are checked first, a retry recomputes the same skip; a load that differs in any
//      member of any piece writes as today. PUT and the other kinds do not opt in.
//   3  IM3. `dryRun=1` on the import's query (any other value: 400 naming `dryRun`): the import's own path (JSON and CSV,
//      the aliases, merge or replace against the revision `If-Match` names, the vocabulary in effect, P82's
//      `records[k] '<id>'` address), its 428/409 precondition answers kept, `Idempotency-Key` not required; the same 422
//      body on refusal; on acceptance the import's members plus `dryRun: true`, nothing written. `POST
//      /content/catalog/validate` is unchanged (LOCK).
//   4  IM4. The mode `full`: the file's records replace the catalogue in file order, then every stored piece the file
//      leaves out follows in stored order with `lifecycle.status: 'expired'` (not eligible), its record kept. Its guard,
//      `expire=<n>` (the import's query, the pull's body), must equal the number the server expires: absent → 428 naming
//      `expire`; different → 409 naming the server's count; nothing written either way. The allow-list: a new optional
//      content kind `import-sources`, document `{ addresses: [...] }` (exact IPv4 or IPv6 addresses or CIDR ranges),
//      published through the content routes under operator authority (history, validate and rollback as the other
//      optional members; the customer boundary's `:kind` entries admit it); with a list set, the import, the pull and the
//      dry run read the caller's address from `CF-Connecting-IP` only (never `X-Forwarded-For`), refuse a caller outside
//      the list, or with no readable address, 403 naming `import-sources`, writing nothing; with no list every caller is
//      allowed as today.
//   5  Locks: W19's import tests, P82, P38, P02, P08, the content, import and complements tests, the publication tests;
//      PUT and validate unchanged; the kit's import and pull sentences (kit 02 :1726–1727, kit 03 :246–251) state the four
//      behaviours (today's optional `mode?` locked RED).
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
// R-P337 (the spec review at aa5b04c0): three legs added, none changed — IM1's order leg (on the import and the pull, a
// load with neither mode nor preconditions is refused 400 naming the modes, not 428; a caller outside the list with no
// preconditions 403, not 428; a caller outside the list with no mode 403, the list before the mode; nothing written); IM2's
// reorder LOCK (a replace whose file holds the same pieces in reverse order writes a new revision and the stored order
// follows the file: green today, the skip compares order); the kit leg binds kit 02's import row and kit 03's sentence to
// "mode is required, a load without one is refused 400" (today's `mode=replace\|merge` row locked RED). MEASURED at
// 7dbabd5f (logs/g/): today 15 RED and 4 green (the validate locks and the reorder locks); the fix 19/19 three times (its kit
// 03 sentence now states the refusal); the reviewer's controls (S28/reviewer-spec/sketches/ctl-p91.py after the fix) each
// RED on its own leg alone — `orderswap2` the order leg ×2 (428 where 400 and 403 are expected), `skipunordered` the
// reorder lock ×2, `kitoptional` the kit leg; the nine wrong fixes RED on the legs they turned RED before, the new legs
// adding `nomodereplace` and `allowimportonly` to the order leg and `skipcount` to the reorder lock; tsc exit 0 on both.
//
// THE R10s (granted by name in R-P332; test-only, R-P195's form; the lines named at the base 92a7132e):
//   A. The mode named (every other assertion unchanged): src/routes/content.test.ts :546 (`?mode=replace`), :551 and :564
//     (pull body `mode: 'replace'`), :840, :845, :849 (`&mode=replace`), :855 and :858 (pull body), :950 and :951 (the
//     pull body `{"url":"https://cms.example/feed","mode":"replace"}`, so each still measures its 428 and its 400 under the
//     ruled order), :961, :964, :969 (pull body), :1008 (the two import lanes `?mode=replace`, `&mode=replace`), :1019
//     (the third entry's suffix `?scope=other` → `&scope=other`, which R-P332 named as :1021's; corrected per R-P337) and
//     :1021 (the oversized import's path `?mode=replace`), :1040
//     (`?mode=replace`), :1047 and :1051 (pull body), :1056 and :1058 (`?mode=replace` on the import and its exact retry);
//     src/units/W19/B2.unit.test.ts :670–672 (W19.L1.01's two imports `mode=replace`, its pull body), :701, :973–974
//     (W19.S1.01's import and pull), :977 (its path built with `&` after a `?`), :1062, :1112, :1129 (`mode=replace`).
//   B. E16's skip superseding W19's "each accepted import allocates the next revision, byte-identical or not":
//     src/units/W19/B1.unit.test.ts W19.F1.03 :610 and :618 (the identical re-import and the CSV round trip also expect
//     `skipped: true` with the revision in force), :630–640 (the comment reworded naming R-P332; both identical imports
//     skipped, the second answering the revision in force and its label, no new revision); src/units/W19/B2.unit.test.ts
//     W19.L1.01 :680 (the CSV import and the pull of the stored feed expect the skip and the revision in force; the JSON
//     import and the PUT one new revision each; `revision` follows the revision in force, so each step's If-Match names it)
//     and W19.S1.01 :982 (the same for its pull). Every other assertion of the three tests is unchanged.
//   R-P334 (the collision the whole suite found): src/routes/content.test.ts W19.01 :607–609 (the JSON import
//     `?mode=replace`, the CSV import `?format=csv&mode=replace`, the pull body `mode: 'replace'`) and :612 (the JSON
//     import of `feed`, identical to the PUT's catalogue, expects `skipped: true`, `reason: 'unchanged'` and the revision in
//     force; the CSV import and the pull keep `revision: ++revision`, the counter following the revision in force).
//   The builder's (R-P332's widened grant): scripts/import-content.mjs :92–93, the demo importer's pull names
//   `mode: 'replace'`.
//
// MEASURED at f38eeca1 (_evidence/parity-step3/S28/specifier/logs/a/, serial, --no-cache, working directory the tree):
// today 13 RED for the missing behaviour — IM1 (each load read as replace and written, the pull fetching its feed; the kit
// silent), IM2 (each identical load writing a new revision), IM3 (the switch unknown: the dry run is an import refused 428
// for its missing Idempotency-Key, or written), IM4 (`full` read as replace; the kind `import-sources` unknown, every caller
// importing, on the parity mount and on the customer stamp) — and 2 LOCKS GREEN (the validate route); the fix
// (sketches/p91.py: src/content/import.ts the full mode, the kind and its address check; src/config/publication.ts the
// optional member and its kind; src/customerBoundary.ts the kind admitted; src/routes/content.ts the ruled order, the
// guard, the skip, the dry run and the list read; the kit) 15/15 three times; tsc exit 0 on today and under the fix. The
// wrong fixes, each RED on its own legs and nothing else: `nomodereplace` IM1 ×2; `skipnewrev` and `skipcount` IM2 ×2 each;
// `drywrites` and `dryvalidate` IM3's dry-run legs ×2 each; `fullnoguard` and `guardnotcompared` IM4's full-export legs ×2
// each; `allowimportonly` IM4's list legs ×2; `kitleft` the kit leg. The locks read from the whole suite (W19 B1–B3, P82,
// P38, P02, P08, the content route, import and complements tests, the publication and versioned-store tests, the API
// boundary): 232/235 today (W19.F1.03, W19.L1.01, W19.S1.01, which now expect the skip: R-P332 (B)) and 234/235 under the
// fix (the collision below). The whole suite (logs/a/compare.txt): 3945 tests on both trees; failing under the fix alone 1;
// failing today alone the 13 P91 tests and the three W19 tests above. R-P332 (C), measured: a first re-import over a
// catalogue an initialization wrote (its version unstamped, `parity-coach-catalogue`) writes once (revision 2,
// `changed: 0`), and the next identical load is skipped.
// COLLISION FOUND BY THE COMPARISON (ruled R-P334, the R10 above): src/routes/content.test.ts "W19.01 publishes equivalent JSON CSV pull and
// direct catalogs with safe merge retries" :607–609 — a JSON import (`/import`), a CSV import (`/import?format=csv`) and a
// pull, none naming a mode (missed by the provisional sweep: the paths are relative suffixes), each expecting
// `revision: ++revision`; under the fix the first is refused 400. With the mode named (replace), the JSON import of `feed`
// over the PUT's `catalog` is identical (its `explore` maps to `exploring`) and is skipped, so its `++revision` needs the
// R-P332 (B) form (the skip and the revision in force); the CSV import and the pull change the catalogue and still write.
//
// HARNESS: src/units/_parity.ts (the mounted app, both shopper hosts, the operator routes), src/units/_parity5.ts (the home
// page's pieces and documents) and src/units/W08/_customer.ts (the in-process customer stamp, for the allow-list on a customer
// deployment). Imports from src/units/: ../_parity, ../_parity5, ../W08/_customer.

import { describe, expect, it, vi } from 'vitest';

// The customer stamp loads the real Worker (src/index.ts); the module doubles its harness names (src/units/W08/_customer.ts).
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import type { Env } from '@/types/env';

import { asOperator, errorsOf, expectPublished, HOSTS, loadDocument, mount, readTree, REFLEX_DOCUMENT, shopperOn, TENANT,
  type Answer, type Mounted } from '../_parity';
import { HERO, HOME, HOME_PIECES, homeLearn, homeSlots, putKind, readKind } from '../_parity5';
import { customerStamp, TENANT as CUSTOMER_TENANT, type Stamp } from '../W08/_customer';

const piece = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'editorial', title: `Story ${id}`, tags: { line: ['Tabby'] }, slotTypes: [HERO], ...extra });
const DOCS = { pieces: [...HOME_PIECES], slots: homeSlots(), learn: homeLearn() };
const preconditions = async (m: Mounted) => {
  const base = await loadDocument(m, 'catalog');
  return { 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` };
};
const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
const q = (members: Record<string, string>) => new URLSearchParams({ scope: TENANT, ...members }).toString();
/** `POST /content/catalog/import?…` with a JSON array, the authored preconditions unless `headers` names its own. */
const importJson = async (m: Mounted, records: unknown[], members: Record<string, string>, headers?: Record<string, string>) =>
  asOperator(m, 'POST', `/content/catalog/import?${q(members)}`, records, headers ?? await preconditions(m));
/** The same as CSV over `columns` (P82's harness; tags `dimension:value|value;…`). */
async function importCsv(m: Mounted, rows: Array<Record<string, unknown>>, columns: string[], members: Record<string, string>, headers?: Record<string, string>): Promise<Answer> {
  const cell = (v: unknown) => { const t = v === undefined ? '' : Array.isArray(v) ? v.join('|') : typeof v === 'object' && v !== null
    ? Object.entries(v).map(([d, values]) => `${d}:${(values as string[]).join('|')}`).join(';') : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const body = [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\n') + '\n';
  const response = await m.fetch(new Request(`https://ops.invalid/content/catalog/import?${q({ format: 'csv', ...members })}`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'Content-Type': 'text/csv', ...(headers ?? await preconditions(m)) }, body }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}
const FEED_URL = 'https://cms.example.invalid/p91-feed.json';
/** `POST /content/catalog/pull` of a feed `{ content: records }` answered by a stub of its URL (no network); `members` joins the body. */
async function pull(m: Mounted, records: unknown[], members: Record<string, unknown>, headers?: Record<string, string>): Promise<Answer> {
  const original = globalThis.fetch;
  const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input) === FEED_URL ? new Response(JSON.stringify({ content: records }), { headers: { 'Content-Type': 'application/json' } }) : original(input, init));
  try { return await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, { url: FEED_URL, path: 'content', ...members }, headers ?? await preconditions(m)); }
  finally { stub.mockRestore(); }
}
/** The stored pieces, as the catalogue in force holds them. */
const storedPieces = async (m: Mounted) => (await loadDocument(m, 'catalog')).document.pieces as Array<Record<string, unknown>>;
/** The members an accepted load answers besides its identity (revision, publication, version) and its diagnostics' revision. */
const loadMembers = (a: Answer) => ({ ok: a.body.ok, scope: a.body.scope, mode: a.body.mode, received: a.body.received, imported: a.body.imported,
  pieces: a.body.pieces, changed: a.body.changed, removed: a.body.removed, changedBasis: a.body.changedBasis,
  warnings: (a.body.diagnostics as { warnings?: unknown } | undefined)?.warnings ?? 'no diagnostics',
  counts: (a.body.diagnostics as { counts?: unknown } | undefined)?.counts ?? 'no diagnostics' });
/** The If-Match of the catalogue in force alone (a dry run carries no Idempotency-Key). */
const ifMatchOnly = async (m: Mounted) => { const { 'If-Match': ifMatch } = await preconditions(m); return { 'If-Match': ifMatch! }; };

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
      const feedCalls = feed.mock.calls.length;
      feed.mockRestore();
      expect.soft(answers.map(([name, a]) => [name, a.status, namesModes(a), Object.hasOwn(a.body, 'diagnostics') ? 'diagnostics' : 'no diagnostics']),
        `${host}: P91.IM1 — each refused 400 naming the modes (today read as replace: ${answers.map(([n, a]) => `${n} ${show(a)}`).join(' | ').slice(0, 400)})`).toEqual(
        answers.map(([name]) => [name, 400, 'names merge, replace and full', 'no diagnostics']));
      expect.soft(await inForce(m), `${host}: P91.IM1 — nothing written: the catalogue, its revision and its publication as before`).toEqual(before);
      expect.soft(feedCalls, `${host}: P91.IM1 — a pull refused so fetches nothing (today it fetches the feed)`).toBe(0);
    }, 120_000);

    it(`host (${host}): the order (R-P330 Q5) — on the import and the pull, a load naming no mode and carrying no preconditions is refused 400 naming the modes, not 428; with an import-sources list published, a caller outside it carrying no preconditions is refused 403 naming import-sources, not 428, and one naming no mode 403 (the list before the mode); nothing written`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P91.IM1 — the tenant documents publish');
      const catalogue = async () => { const d = await inForce(m); return { revision: d.revision, pieces: d.pieces }; };
      const before = await catalogue();
      const pullBody = (extra: Record<string, unknown>) => ({ url: 'https://cms.example.invalid/p91-feed.json', path: 'content', ...extra });
      const bare = [
        ['import, no mode, no preconditions', await asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}`, [piece('story.order')], {})],
        ['pull, no mode, no preconditions', await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, pullBody({}), {})],
      ] as Array<[string, Answer]>;
      const listed = await putKind(m, 'import-sources', { addresses: ['203.0.113.7'] }, 'p91 order list');
      const outside = { 'CF-Connecting-IP': '192.0.2.1' };
      const named = (a: Answer) => errorsOf(a).some(e => e.includes('import-sources')) ? 'names import-sources' : `does not (${show(a)})`;
      const fenced = [
        ['import, outside, no preconditions', await asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}&mode=merge`, [piece('story.order')], outside)],
        ['pull, outside, no preconditions', await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, pullBody({ mode: 'merge' }), outside)],
        ['import, outside, no mode', await asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}`, [piece('story.order')], { ...await preconditions(m), ...outside })],
        ['pull, outside, no mode', await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, pullBody({}), { ...await preconditions(m), ...outside })],
      ] as Array<[string, Answer]>;
      expect.soft({ bare: bare.map(([name, a]) => [name, a.status, namesModes(a)]), listed: listed.status, fenced: fenced.map(([name, a]) => [name, a.status, named(a)]) },
        `${host}: P91.IM1 — the allow-list, then the mode, then the preconditions (today the preconditions come first: 428)`).toEqual({
        bare: bare.map(([name]) => [name, 400, 'names merge, replace and full']), listed: 200,
        fenced: fenced.map(([name]) => [name, 403, 'names import-sources']) });
      expect.soft(await catalogue(), `${host}: P91.IM1 — nothing written: the catalogue and its revision as before`).toEqual(before);
    }, 120_000);
  }

  // The kit (kit 02's import and pull rows, kit 03's import paragraph and the allow-list), for the four behaviours.
  it('logic: kit 02\'s import and pull rows and kit 03\'s import paragraph state the required mode (merge, replace or full), the skip, the dry run, the full export\'s guard and the import-sources list; today\'s optional pull mode is gone', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const rowOf = (route: string) => kit02.split('\n').find(line => line.startsWith(`| \`POST /content/catalog/${route}`)) ?? '';
    const paragraphs = kit03.split(/\n\s*\n/).map(p => p.split('\n').join(' '));
    const has = (...words: Array<string | RegExp>) => paragraphs.some(p => words.every(w => typeof w === 'string' ? p.includes(w) : w.test(p)));
    const importRow = rowOf('import'), pullRow = rowOf('pull');
    expect.soft({
      importRow: [/full/.test(importRow), importRow.includes('dryRun=1'), importRow.includes('expire'), importRow.includes('skipped')],
      pullRow: [pullRow.includes('mode?'), /\bexpire\b/.test(pullRow)],
      kit03Loads: has('`full`', '`expire`', 'expired', '`skipped`', '`dryRun=1`'),
      kit03Sources: has('`import-sources`', '`CF-Connecting-IP`', '403'),
    }, 'P91 — the kit states the four behaviours (today it states none, and the pull\'s mode is optional)').toEqual({
      importRow: [true, true, true, true], pullRow: [false, true], kit03Loads: true, kit03Sources: true });
    // R-P337: the mode is required, in kit 02's import row and in kit 03's sentence, and a load without one is refused 400;
    // today's row naming the mode as one of two words (`mode=replace\|merge`) is locked RED.
    expect.soft({
      importRowRequired: /`mode` is required/.test(importRow) && /without one[^|]*refused 400/.test(importRow),
      importRowToday: importRow.includes('mode=replace\\|merge&path='),
      kit03Required: has('Every load names its mode', /without one[^.]*refused 400/),
    }, 'P91 — the kit says the mode is required and a load without one is refused 400 (today: optional, read as replace)').toEqual({
      importRowRequired: true, importRowToday: false, kit03Required: true });
  });
});

// ===========================================================================
// unit:P91.IM2 — a load that changes nothing is skipped and says so
// ===========================================================================

describe('unit:P91.IM2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an unchanged merge, an unchanged replace and an unchanged pull write nothing and answer 200 skipped (reason unchanged, the revision in force, changed 0, removed 0, the diagnostics); a load changing one field of one piece writes as today`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P91.IM2 — the tenant documents publish');
      // A first load through the import, so the catalogue in force is one an import wrote, stamped at its revision.
      const first = await importJson(m, [piece('story.new-one')], { mode: 'merge' });
      expect(first.status, `${host}: PRECONDITION — the first load writes (${show(first)})`).toBe(200);
      const before = await inForce(m), stored = await storedPieces(m);
      const loads: Array<[string, Answer]> = [
        ['merge', await importJson(m, stored, { mode: 'merge' })],
        ['replace', await importJson(m, stored, { mode: 'replace' })],
        ['pull', await pull(m, stored, { mode: 'replace' })],
      ];
      const skip = (a: Answer) => [a.status, a.body.skipped ?? 'no skipped member', a.body.reason ?? 'no reason', a.body.revision, a.body.changed, a.body.removed,
        (a.body.diagnostics as { schema?: unknown; catalogRevision?: unknown } | undefined)?.schema ?? 'no diagnostics',
        (a.body.diagnostics as { catalogRevision?: unknown } | undefined)?.catalogRevision ?? 'no diagnostics'];
      expect.soft(loads.map(([name, a]) => [name, ...skip(a)]), `${host}: P91.IM2 — each skipped with the revision in force (today each writes a new revision)`).toEqual(
        loads.map(([name]) => [name, 200, true, 'unchanged', before.revision, 0, 0, 'catalog-registry-diagnostics/v1', before.revision]));
      expect.soft(await inForce(m), `${host}: P91.IM2 — nothing written: the revision and the publication in force as before`).toEqual(before);
      // One field of one piece: written as today (the same count of pieces, a different document).
      const edited = await importJson(m, [{ ...stored[0], title: `${String(stored[0]!.title)}, revised` }], { mode: 'merge' });
      expect.soft([edited.status, edited.body.revision, edited.body.changed, edited.body.skipped ?? 'no skipped member'],
        `${host}: P91.IM2 — a one-field change writes the next revision`).toEqual([200, before.revision + 1, 1, 'no skipped member']);
    }, 120_000);

    it(`host (${host}): LOCK (R-P337) — a replace whose file holds the stored pieces in reverse order is not unchanged: it writes the next revision and the stored order follows the file`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P91.IM2 — the tenant documents publish');
      const first = await importJson(m, [piece('story.new-one')], { mode: 'merge' });
      expect(first.status, `${host}: PRECONDITION — the first load writes (${show(first)})`).toBe(200);
      const before = await inForce(m), stored = await storedPieces(m);
      const reversed = [...stored].reverse();
      const answer = await importJson(m, reversed, { mode: 'replace' });
      expect.soft([answer.status, answer.body.revision, answer.body.skipped ?? 'no skipped member', (await storedPieces(m)).map(p => p.id)],
        `${host}: P91.IM2 — LOCK: the order is part of the catalogue`).toEqual([200, before.revision + 1, 'no skipped member', reversed.map(p => p.id)]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P91.IM3 — a dry run under the import's own rules, writing nothing
// ===========================================================================

describe('unit:P91.IM3', () => {
  const COLUMNS = ['id', 'customerContentId', 'type', 'title', 'tags', 'slotTypes'];
  for (const host of HOSTS) {
    it(`host (${host}): a dry run answers what the import would — a CSV with a bad record the same 422 body, a JSON merge with the feed's aliases the same members plus dryRun true, a vocabulary refusal the same 422 — writing nothing; it keeps If-Match without Idempotency-Key; dryRun=yes is refused naming it`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P91.IM3 — the tenant documents publish');
      const before = await inForce(m);
      // 1. A CSV with a refused record (no title): the dry run's 422 body is the import's.
      const rows = [piece('story.csv-good'), { ...piece('story.csv-bad'), title: '' }];
      const dryCsv = await importCsv(m, rows, COLUMNS, { mode: 'merge', dryRun: '1' }, await ifMatchOnly(m));
      const afterDryCsv = await inForce(m);
      const realCsv = await importCsv(m, rows, COLUMNS, { mode: 'merge' });
      expect.soft([dryCsv.status, dryCsv.body], `${host}: P91.IM3 — the dry run of the CSV refuses as the import does (today the switch is ignored: ${show(dryCsv)})`).toEqual([realCsv.status, realCsv.body]);
      expect.soft(realCsv.status, `${host}: PRECONDITION — the import refuses the record with no title`).toBe(422);
      // 2. A JSON merge carrying the feed's aliases and a partial update (the import's rules, not the validator's).
      const records = [{ systemId: 'story.alias', cmsId: 'CMS-ALIAS', kind: 'editorial', title: 'The alias story', tags: { line: ['Tabby'] }, slots: [HERO] },
        { id: 'story.harbor', title: 'The harbor edit, revised' }];
      const dry = await importJson(m, records, { mode: 'merge', dryRun: '1' }, await ifMatchOnly(m));
      const afterDry = await inForce(m);
      const real = await importJson(m, records, { mode: 'merge' });
      expect(real.status, `${host}: PRECONDITION — the import accepts the merge (${show(real)})`).toBe(200);
      expect.soft({ members: loadMembers(dry), dryRun: dry.body.dryRun ?? 'no dryRun member', revision: dry.body.revision },
        `${host}: P91.IM3 — the dry run answers the import's members, says it was a dry run and names the revision in force (today: ${show(dry)})`).toEqual({
        members: loadMembers(real), dryRun: true, revision: before.revision });
      expect.soft([afterDryCsv, afterDry], `${host}: P91.IM3 — neither dry run wrote anything`).toEqual([before, before]);
      // 3. The vocabulary in effect: a value outside it refuses the dry run as it refuses the import (P82's address).
      expect((await putKind(m, 'vocabulary', { version: 'p91-vocabulary', attributes: { color: { values: [{ id: 'black', name: 'Black' }] } } }, 'p91 vocabulary')).status,
        'PRECONDITION: the vocabulary publishes').toBe(200);
      const base = await readKind(m, 'vocabulary');
      const publication = base.body.publication as { revision: number; digest: string };
      expect((await asOperator(m, 'POST', `/content/vocabulary/approve/1?scope=${TENANT}`, {}, { 'If-Match': `"${base.body.revision as number}/${publication.revision}/${publication.digest}"`,
        'Idempotency-Key': `1:${crypto.randomUUID()}` })).status, 'PRECONDITION: the vocabulary is approved').toBe(200);
      const outside = [piece('story.outside', { tags: { line: ['Tabby'], color: ['chartreuse'] } })];
      const dryOutside = await importJson(m, outside, { mode: 'merge', dryRun: '1' }, await ifMatchOnly(m));
      const realOutside = await importJson(m, outside, { mode: 'merge' });
      expect.soft([dryOutside.status, dryOutside.body], `${host}: P91.IM3 — the vocabulary refuses the dry run as it refuses the import`).toEqual([realOutside.status, realOutside.body]);
      expect.soft(errorsOf(realOutside).some(e => e.startsWith("records[0] 'story.outside'") && e.includes('tags.color') && e.includes('chartreuse')),
        `${host}: PRECONDITION — the import's refusal names the record (P82), the field and the value`).toBe(true);
      // 4. The switch and the preconditions.
      const noIfMatch = await importJson(m, records, { mode: 'merge', dryRun: '1' }, {});
      const yes = await importJson(m, records, { mode: 'merge', dryRun: 'yes' }, await ifMatchOnly(m));
      expect.soft({ noIfMatch: noIfMatch.status, yes: [yes.status, errorsOf(yes).some(e => e.includes('dryRun')) ? 'named' : `not named (${show(yes)})`] },
        `${host}: P91.IM3 — a dry run without If-Match is refused 428 as the import is; dryRun=yes is refused 400 naming the switch`).toEqual({ noIfMatch: 428, yes: [400, 'named'] });
    }, 180_000);

    it(`host (${host}): LOCK — POST /content/catalog/validate is unchanged: a JSON document whose piece uses a feed alias is refused 422 naming pieces[0].id, and a CSV body 400`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P91.IM3 — the tenant documents publish');
      const aliased = await asOperator(m, 'POST', `/content/catalog/validate?scope=${TENANT}`, { pieces: [{ systemId: 'story.alias', customerContentId: 'CMS-ALIAS', type: 'editorial', title: 'Alias', tags: {}, slotTypes: [HERO] }] });
      const csv = await m.fetch(new Request(`https://ops.invalid/content/catalog/validate?scope=${TENANT}`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'Content-Type': 'text/csv' }, body: 'id,type,title,tags,slotTypes\nx,editorial,X,,home-hero\n' }));
      expect.soft({ aliased: [aliased.status, errorsOf(aliased).some(e => e.startsWith('pieces[0].id')) ? 'pieces[0].id named' : `not named (${show(aliased)})`], csv: csv.status },
        `${host}: P91.IM3 — LOCK: the validate route reads the catalogue document alone, as today`).toEqual({ aliased: [422, 'pieces[0].id named'], csv: 400 });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P91.IM4 — a full export expires what it leaves out, behind its guard; the allow-list
// ===========================================================================

describe('unit:P91.IM4', () => {
  /** The file of a full export: two of the four stored pieces and a new one; the other two are left out. */
  const FILE = () => [{ ...HOME_PIECES[0] }, { ...HOME_PIECES[1] }, piece('story.new-one')];
  const LEFT_OUT = [HOME_PIECES[2].id, HOME_PIECES[3].id];
  for (const host of HOSTS) {
    it(`host (${host}): mode=full replaces the catalogue and expires the two pieces the file leaves out (file order, then the expired in stored order; their records kept, no longer eligible) behind expire=2; refused 428 without expire and 409 naming 2 with expire=3, writing nothing; the pull likewise`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P91.IM4 — the tenant documents publish');
      const before = await inForce(m);
      const unguarded = await importJson(m, FILE(), { mode: 'full' });
      const wrong = await importJson(m, FILE(), { mode: 'full', expire: '3' });
      const afterRefusals = await inForce(m);
      expect.soft({ unguarded: [unguarded.status, errorsOf(unguarded).some(e => e.includes('expire')) ? 'names expire' : `does not (${show(unguarded)})`],
        wrong: [wrong.status, errorsOf(wrong).some(e => /\b2\b/.test(e)) ? 'names 2' : `does not name 2 (${show(wrong)})`], written: afterRefusals },
      `${host}: P91.IM4 — refused without its guard and with a wrong count, writing nothing (today the mode is read as replace)`).toEqual({
        unguarded: [428, 'names expire'], wrong: [409, 'names 2'], written: before });
      const guarded = await importJson(m, FILE(), { mode: 'full', expire: '2' });
      expect(guarded.status, `${host}: PRECONDITION — the guarded full export is accepted (${show(guarded)})`).toBe(200);
      const stored = await storedPieces(m);
      expect.soft(stored.map(p => [p.id, (p.lifecycle as { status?: string } | undefined)?.status]), `${host}: P91.IM4 — the file in file order, then the left-out pieces expired in stored order`).toEqual([
        [HOME_PIECES[0].id, 'live'], [HOME_PIECES[1].id, 'live'], ['story.new-one', 'live'], [LEFT_OUT[0], 'expired'], [LEFT_OUT[1], 'expired']]);
      const served = (await (await shopperOn(m)).snapshot(HOME)).decisions.filter(d => d.slot === HERO).map(d => d.contentId).sort();
      expect.soft(served, `${host}: P91.IM4 — an expired piece is eligible for no decision`).toEqual([HOME_PIECES[0].id, HOME_PIECES[1].id, 'story.new-one'].sort());
      const p = await mount(host, DOCS);
      expectPublished(p, 'P91.IM4 — the tenant documents publish');
      const pullUnguarded = await pull(p, FILE(), { mode: 'full' });
      const pullGuarded = await pull(p, FILE(), { mode: 'full', expire: 2 });
      expect.soft([pullUnguarded.status, pullGuarded.status, (await storedPieces(p)).map(x => (x.lifecycle as { status?: string } | undefined)?.status)],
        `${host}: P91.IM4 — the pull carries the mode and its guard in its body`).toEqual([428, 200, ['live', 'live', 'live', 'expired', 'expired']]);
    }, 180_000);

    it(`host (${host}): with an import-sources list published, the import, the pull and the dry run admit a caller whose CF-Connecting-IP is on it (an address or inside a range) and refuse 403 naming import-sources one outside it or with no readable address (X-Forwarded-For is never read), writing nothing; a malformed list is refused by name; with no list every caller is allowed`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P91.IM4 — the tenant documents publish');
      const listed = await putKind(m, 'import-sources', { addresses: ['203.0.113.7', '198.51.100.0/24', '2001:db8::/32'] }, 'p91 import sources');
      const malformed = await putKind(m, 'import-sources', { addresses: ['not-an-address'] }, 'p91 malformed');
      const from = (address: string | null, extra: Record<string, string> = {}) => ({ ...(address ? { 'CF-Connecting-IP': address } : {}), ...extra });
      const named = (a: Answer) => [a.status, a.status === 403 ? (errorsOf(a).some(e => e.includes('import-sources')) ? 'names import-sources' : `does not (${show(a)})`) : 'admitted'];
      const answers: Array<[string, Answer]> = [];
      for (const [label, address, extra] of [['listed address', '203.0.113.7', {}], ['inside the range', '198.51.100.42', {}], ['inside the IPv6 range', '2001:db8::5', {}],
        ['outside', '192.0.2.1', {}], ['no CF-Connecting-IP, a listed X-Forwarded-For', null, { 'X-Forwarded-For': '203.0.113.7' }]] as Array<[string, string | null, Record<string, string>]>) {
        answers.push([`import, ${label}`, await importJson(m, [piece(`story.from-${answers.length}`)], { mode: 'merge' }, { ...await preconditions(m), ...from(address, extra) })]);
      }
      const before = await inForce(m);
      answers.push(['pull, outside', await pull(m, [piece('story.pulled')], { mode: 'merge' }, { ...await preconditions(m), ...from('192.0.2.1') })]);
      answers.push(['dry run, outside', await importJson(m, [piece('story.dry')], { mode: 'merge', dryRun: '1' }, { ...await ifMatchOnly(m), ...from('192.0.2.1') })]);
      expect.soft({ listed: listed.status, malformed: [malformed.status, errorsOf(malformed).some(e => e.includes('addresses')) ? 'names addresses' : `does not (${show(malformed)})`] },
        `${host}: P91.IM4 — the list publishes through the content routes and a malformed one is refused by name (today the kind does not exist)`).toEqual({ listed: 200, malformed: [422, 'names addresses'] });
      expect.soft(answers.map(([label, a]) => [label, ...named(a)]), `${host}: P91.IM4 — the caller's CF-Connecting-IP against the list`).toEqual([
        ['import, listed address', 200, 'admitted'], ['import, inside the range', 200, 'admitted'], ['import, inside the IPv6 range', 200, 'admitted'],
        ['import, outside', 403, 'names import-sources'], ['import, no CF-Connecting-IP, a listed X-Forwarded-For', 403, 'names import-sources'],
        ['pull, outside', 403, 'names import-sources'], ['dry run, outside', 403, 'names import-sources']]);
      expect.soft(await inForce(m), `${host}: P91.IM4 — the refused pull and dry run wrote nothing`).toEqual(before);
      const open = await mount(host, DOCS);
      expectPublished(open, 'P91.IM4 — the tenant documents publish');
      const anyone = await importJson(open, [piece('story.anyone')], { mode: 'merge' }, { ...await preconditions(open), 'CF-Connecting-IP': '192.0.2.1' });
      expect.soft(anyone.status, `${host}: P91.IM4 — LOCK: with no list every caller is allowed, as today`).toBe(200);
    }, 180_000);

    it(`host (${host}): on a customer deployment (the in-process customer stamp), the import-sources list published by the tenant's operator refuses an import from outside it 403 and admits one from inside, and the boundary admits the dry run and the full mode`, async () => {
      const s = await stampWithSet(host);
      const head = await operator(s, 'GET', '/content/import-sources');
      const listed = await operator(s, 'PUT', '/content/import-sources', { body: { document: { addresses: ['203.0.113.7'] }, note: 'p91 customer list' }, headers: authored(head) });
      const catalog = async () => authored(await operator(s, 'GET', '/content/catalog'));
      const outside = await operator(s, 'POST', '/content/catalog/import?mode=merge', { body: [piece('story.c-outside')], headers: { ...await catalog(), 'CF-Connecting-IP': '192.0.2.1' } });
      const inside = await operator(s, 'POST', '/content/catalog/import?mode=merge', { body: [piece('story.c-inside')], headers: { ...await catalog(), 'CF-Connecting-IP': '203.0.113.7' } });
      const { 'If-Match': ifMatch } = await catalog();
      const dry = await operator(s, 'POST', '/content/catalog/import?mode=merge&dryRun=1', { body: [piece('story.c-dry')], headers: { 'If-Match': ifMatch!, 'CF-Connecting-IP': '203.0.113.7' } });
      const stored = ((await operator(s, 'GET', '/content/catalog')).body.document as { pieces: Array<{ id: string; lifecycle?: { status?: string } }> }).pieces.map(p => p.id);
      const full = await operator(s, 'POST', `/content/catalog/import?mode=full&expire=${stored.length - 1}`, { body: [piece('story.c-inside')], headers: { ...await catalog(), 'CF-Connecting-IP': '203.0.113.7' } });
      expect.soft({ listed: listed.status, outside: outside.status, inside: inside.status, dry: [dry.status, dry.body.dryRun ?? 'no dryRun member'], full: full.status },
        `${host}: P91.IM4 — on the customer profile (today the kind does not exist and every caller imports)`).toEqual({ listed: 200, outside: 403, inside: 200, dry: [200, true], full: 200 });
    }, 180_000);
  }
});

/** The customer stamp's tenant with its six-member set, as an adoption leaves it (P77's pattern); the home page's pieces. */
async function stampWithSet(host: (typeof HOSTS)[number]): Promise<Stamp> {
  const s = await customerStamp(host);
  const at = Date.now();
  const members: Array<[DocumentKind<unknown>, string, unknown]> = [
    [REFLEX_KIND as DocumentKind<unknown>, reflexScopeForTenant(CUSTOMER_TENANT), REFLEX_DOCUMENT],
    [CONTENT_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, { version: 'p91-catalogue', pieces: [...HOME_PIECES] }],
    [SLOTS_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, homeSlots()],
    [LEARN_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, homeLearn()],
    [PRIORS_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, EMPTY_PRIORS],
    [PROPOSALS_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, EMPTY_PROPOSALS],
  ];
  await initializePublicationSet(s.env as Env, members.map(([kind, scope, value]) => ({ kind, scope,
    revision: { revision: 1, value, actor: 'ops', note: `p91 ${kind.name}`, at } })) as PublicationBaseline[], `0:${crypto.randomUUID()}`);
  invalidatePublicationCache(); invalidateCache();
  return s;
}
/** The tenant's operator on the customer stamp (a membership, not the stamp owner). */
const operator = (s: Stamp, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) =>
  s.call(method, path, { token: s.tokens.operator, ...opts });
/** The authored preconditions over a read's head (kit 02), revision 0 for an optional member not yet published. */
const authored = (read: Answer): Record<string, string> => {
  const publication = read.body.publication as { revision?: number; digest?: string } | undefined;
  const revision = typeof read.body.revision === 'number' ? read.body.revision : 0;
  return { ...(publication?.digest ? { 'If-Match': `"${revision}/${publication.revision}/${publication.digest}"` } : {}), 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` };
};
