// src/units/P82/LEDGER.unit.test.ts
// P82 under the Closure Ledger: the tests for the LOCAL criteria ID1-ID3 of the P82 work order (the activation programme
// of amendment 11, ticket P82 "Import diagnostics name the record, not the merged position", E5). LV1 is a deferred live
// row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md,
// section 2, E5, "Done when"):
//   "every error and warning from an import names the record by its identifier and by its position in the file sent, on
//   merge as on replace; the kit's error example matches."
// The work order (docs/parity/activation/program.json, P82): ID1 "A merge import whose refused record is the k-th record
// of the file names it by its id and by k in every error; today: errors are addressed pieces[i] in the assembled catalogue
// with no id (src/content/kinds.ts:163) and merge assembles the stored pieces first, then new ids
// (src/content/import.ts:287–303), so a new record is named at its merged position and an updated one at its stored
// position"; ID2 "On replace the same holds, and a record dropped before validation (a non-object entry, import.ts:281–284
// and :128–129) does not shift the positions named for the records after it"; ID3 "Every warning naming a piece on an
// import or pull (unknown_dimension, case_variant_value, no_nonempty_registered_tags, unknown_slot_type:
// src/content/catalogDiagnostics.ts:17–28, pieceIndex) carries the record's id and its file position; ignored_field keeps
// recordIndex (catalogDiagnostics.ts:20, :238); the kit matches (kit 03 :321–324, kit 02 :1702 and :1721)". The export
// specification (docs/tapestry-packs/2-content-and-cms/05-export-specification.md, "What is refused", read as a document):
// a refused load "lists every problem at once", and its answer "names the record, the field and the value".
//
// THE READINGS THIS FILE RULES (R-P294 (4): the address form is the specifier's to define):
//   · THE ERROR ADDRESS. On an import (JSON or CSV, merge or replace) and on a pull, every error that names a piece today
//     (`pieces[i]…`: the validator, kinds.ts validatePiece; the eligibility check over the candidates, kinds.ts
//     catalogRuleErrors; the vocabulary refusal, kinds.ts governedCatalogue) begins instead with the record's address,
//     `records[k] '<id>'`: k is the record's position among the entries of the file sent, counted from 0 over every entry
//     (a non-object entry the import drops included; a CSV's data rows in order: the number `ignored_field`'s
//     `recordIndex` already is), and the id is the record's own `id`, cut to sixty-four code units and followed by `…`
//     when cut (R-P294 (2), the dimension names' bound). The rest of each error is today's wording, unchanged (the field,
//     the reason, the value). A record with no id is addressed `records[k]` alone. An error that names no record (`no
//     records found in the import`) is unchanged, and so is the 422 body (`{ errors, ok, received }`).
//   · THE PIECE WARNINGS. On an import's and a pull's answer, each of the four piece codes whose piece a record of the file
//     wrote keeps its `pieceIndex` (the stored position, kit 02's own definition) and gains `recordIndex` (that record's k),
//     `recordId` (its id, cut to sixty-four code units) and `recordIdTruncated`. `ignored_field` keeps exactly its members
//     (`{ code, recordIndex, field, fieldTruncated }`). A warning about a stored piece the file did not carry (a merge) names
//     no record of the file: this file asserts nothing about it.
//   · PUT AND VALIDATE (R-P294 (1)): unchanged. Their errors keep `pieces[i]` (the document's own positions; P02, P08 and
//     complements.test.ts pin them) and their warnings carry no record id (owner-visible item (a), W19.F3.07 and
//     src/routes/content.test.ts:487, narrowed by R-P294 to these paths).
//   · THE KIT: kit 02's import row (:1702) states the error address; kit 02's diagnostics paragraph (:1723) names the three
//     warning members on an import or pull and qualifies "IDs are not echoed" to the paths that do not echo them; kit 03's
//     `recordIndex` paragraph (:321–326) states both. No import error example naming `pieces[i]` exists in docs/kit (the
//     work order's search at 11782ac0), so "the kit's error example" is these sentences; the pack's examples are the
//     documents lane's.
//
// R10 (granted, R-P294 (3); test-only, R-P195's form, edited in this commit and named in the report):
//   · src/units/W19/B3.unit.test.ts :641 (W19.F3.06): the merge import's unknown_dimension warning gains the record's
//     position and id (`recordIndex: 0, recordId: 'second', recordIdTruncated: false`);
//   · src/units/W19/B2.unit.test.ts :1113 and :1124 (W19.S1.02): the exact import 422 strings take the address
//     (`records[1] 'has-none'…`, `records[0] 'csv-has-none'…`);
//   · src/units/W19/B1.unit.test.ts :697 (W19.F2.01): the JSON import, CSV import and pull legs take the address; the PUT
//     leg keeps `pieces[0].journeyStageFit`;
//   · src/units/W19/B2.unit.test.ts :1014–1016 (W19.S1.01; granted R-P297): the JSON import's and the pull's
//     `unknown_slot_type` warnings gain the record's position and id; the direct PUT's and the read's stay exactly as before.
//
// DEFERRED, with the reason: the pack's own examples (docs/tapestry-packs, the documents lane). TOLD, not a leg: a warning
// about a stored piece the merge did not carry names no record; an error the validator raises about a stored piece the
// merge did not carry keeps `pieces[i]` (the reading above: the requirement names the records of the file).
//
// NO NEW EXPORT IS IMPORTED: `recordIndex`, `recordId` and `recordIdTruncated` are read loosely.
//
// FIXTURE. The parity mount (src/units/_parity.ts) on the demo profile, both shopper hosts: the registry scoring
// category, product type, colour and occasion (REFLEX_DOCUMENT with P38's dimensions), the neutral home page's hero slot
// and learn document (src/units/_parity5.ts), three stored editorial pieces whose governed values are ids; the vocabulary
// in P38's shape for the vocabulary refusal; customer-neutral ids. A pull is driven with the feed answered by a stubbed
// fetch of the feed's URL, as W19.S1.01 drives it.
//
// MEASURED at the spec head (rem/integration 000130da merged; _evidence/parity-step3/S24/specifier/logs/d/, serial,
// --no-cache, working directory the tree): 7 RED for the missing behaviour — ID1 and ID2 on both hosts (`pieces[1].title:
// required string`, `pieces[4].title…`, `pieces[0].eligibleWhen.context.entry_channel: 'carrier-pigeon'…`, `pieces[3]
// 'look.new-three' tags.color…`: the assembled or candidate position, the id only on the vocabulary refusal), ID3 on both
// hosts (no `recordIndex`, `recordId` or `recordIdTruncated` on a piece warning) and the kit leg (no address, no member,
// `IDs are not echoed` unqualified); the 6 locks GREEN. NEGATIVE CONTROLS (sketches/p82.py, never committed): the fix
// (src/routes/content.ts importInto, line-neutral: the candidates' file positions, the assembled pieces' sources, the three
// refusal points re-addressed, the import's and the pull's piece warnings given the record; the kit's three passages) 13/13
// three times; `idonly`, `mergedpos` and `warningsonly` turn ID1 and ID2 RED on both hosts; `keptpos` (k counted after the
// dropped entries) ID2 on both hosts; `errorsonly` ID3's warning leg on both hosts; `kitleft` the kit leg; `echoall` (a
// record id on every path's warnings) the PUT and validate LOCK on both hosts. W19 at the spec head: the four R10 legs RED
// today (they read the new form), 29/29 under the fix.
// The whole suite (R-P248; vitest run src at the spec head, logs/d/today-suite.json, and under the fix, logs/d/fix-suite.json):
// beyond the scratch tree's own artifacts (no git repository, no wrangler variants: root.worker, P45-P47, P51-P53, W39, W40,
// failing on both), the two differ only on P82's seven legs and the four R10 legs (W19.F2.01, W19.S1.01, W19.S1.02,
// W19.F3.06), each RED today and GREEN under the fix.
//
// HARNESS: src/units/_parity.ts, src/units/_parity5.ts. Imports from src/units/: ../_parity, ../_parity5.

import { describe, expect, it, vi } from 'vitest';

import { asOperator, errorsOf, HOSTS, loadDocument, mount, putDocument, readTree, REFLEX_DOCUMENT, TENANT, type Answer, type Mounted } from '../_parity';
import { HOME, homeLearn, putKind, readKind } from '../_parity5';

const HERO = 'home-hero';
const piece = (id: string, tags: Record<string, string[]>, extra: Record<string, unknown> = {}) =>
  ({ id, customerContentId: `CMS-${id.toUpperCase().slice(0, 40)}`, type: 'editorial', title: `Story ${id.slice(0, 40)}`, tags, slotTypes: [HERO], ...extra });
const ALPHA = piece('look.alpha', { category: ['bags'], productType: ['crossbody'], color: ['black'], occasion: ['evening'] });
const BETA = piece('look.beta', { category: ['bags'], productType: ['tote'], color: ['brown_tan'], occasion: ['everyday'] });
const GAMMA = piece('look.gamma', { category: ['shoes'], productType: ['sneaker'], color: ['neutral'] });
const STORED = [ALPHA, BETA, GAMMA];
const N1 = piece('look.new-one', { category: ['bags'], color: ['black'] });
/** A new record with no title: the validator refuses it (`title: required string`). */
const { title: _t2, ...N2 } = piece('look.new-two', { category: ['bags'] }); void _t2;
/** A new record carrying a colour outside the vocabulary. */
const N3 = piece('look.new-three', { category: ['bags'], color: ['chartreuse'] });
/** A new record whose eligibility rule names an entry channel no tenant has (the import's own check over the candidates, kinds.ts catalogRuleErrors). */
const N4 = piece('look.new-four', { category: ['bags'] }, { eligibleWhen: { context: { entry_channel: ['carrier-pigeon'] } } });
/** An id over the sixty-four-code-unit bound, on a record with no title. */
const LONG_ID = `look.${'long-identifier-'.repeat(5)}end`;
const { title: _tl, ...LONG } = piece(LONG_ID, { category: ['bags'] }); void _tl;

const REGISTRY = { ...REFLEX_DOCUMENT, version: 'p82-attribute-registry',
  dimensions: [{ key: 'category', source: 'category' }, { key: 'productType', source: 'productType' }, { key: 'color', source: 'color' }, { key: 'occasion', source: 'occasion', multi: true }] };
const DOCS = { pieces: STORED, slots: { version: 'p82-slots', pages: { [HOME]: [{ slot: HERO, take: 3, weights: { category: 1, color: 0.5 } }] } }, learn: homeLearn(), reflex: REGISTRY };
/** The vocabulary in P38's shape. */
const VOCABULARY = { version: 'p82-vocabulary', attributes: {
  category: { values: [{ id: 'bags', name: 'Bags' }, { id: 'shoes', name: 'Shoes' }] },
  color: { values: [{ id: 'black', name: 'Black' }, { id: 'brown_tan', name: 'Brown / tan' }, { id: 'neutral', name: 'Neutral' }] },
} };

const preconditions = async (m: Mounted) => {
  const base = await loadDocument(m, 'catalog');
  return { 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` };
};
/** `POST /content/catalog/import` with the file as sent (a JSON array, entries of any kind) and the authored preconditions. */
const importJson = async (m: Mounted, records: unknown[], mode: 'merge' | 'replace') =>
  asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}&mode=${mode}`, records, await preconditions(m));
/** The same, as CSV (the documented columns; tags `dimension:value|value;…`). */
async function importCsv(m: Mounted, rows: Array<Record<string, unknown>>, mode: 'merge' | 'replace'): Promise<Answer> {
  const columns = ['id', 'customerContentId', 'type', 'title', 'tags', 'slotTypes'];
  const cell = (v: unknown) => { const s = v === undefined ? '' : Array.isArray(v) ? v.join('|') : typeof v === 'object' && v !== null
    ? Object.entries(v).map(([d, values]) => `${d}:${(values as string[]).join('|')}`).join(';') : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const body = [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\n') + '\n';
  const response = await m.fetch(new Request(`https://ops.invalid/content/catalog/import?scope=${TENANT}&format=csv&mode=${mode}`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'Content-Type': 'text/csv', ...await preconditions(m) }, body }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}
const FEED_URL = 'https://cms.example.invalid/p82-feed.json';
/** `POST /content/catalog/pull` of a feed `{ content: records }` answered by a stubbed fetch of its URL. */
async function pull(m: Mounted, records: unknown[], mode: 'merge' | 'replace'): Promise<Answer> {
  const original = globalThis.fetch;
  const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input) === FEED_URL ? new Response(JSON.stringify({ content: records }), { headers: { 'Content-Type': 'application/json' } }) : original(input, init));
  try { return await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, { url: FEED_URL, path: 'content', mode, note: 'p82 pull' }, await preconditions(m)); }
  finally { stub.mockRestore(); }
}
/** Publish and approve the vocabulary (P38's routes). */
async function inEffect(m: Mounted): Promise<void> {
  expect((await putKind(m, 'vocabulary', VOCABULARY, 'p82 vocabulary')).status, 'PRECONDITION: the vocabulary publishes').toBe(200);
  const base = await readKind(m, 'vocabulary');
  const publication = base.body.publication as { revision: number; digest: string };
  const approved = await asOperator(m, 'POST', `/content/vocabulary/approve/1?scope=${TENANT}`, {},
    { 'If-Match': `"${base.body.revision as number}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `1:${crypto.randomUUID()}` });
  expect(approved.status, 'PRECONDITION: the vocabulary is approved').toBe(200);
}
/** The ruled address of the record at k with `id`: `records[k] '<id, cut to 64 code units>'` and `…` when cut. */
const address = (k: number, id: string) => `records[${k}] '${id.slice(0, 64)}'${id.length > 64 ? '…' : ''}`;
/** Whether an error begins with the record's address and carries today's words for the defect (`words`, in order). */
const names = (errors: string[], k: number, id: string, ...words: string[]) =>
  errors.some(e => e.startsWith(address(k, id)) && words.every(w => e.includes(w))) ? 'named' : `not named as ${address(k, id)} (errors: ${JSON.stringify(errors).slice(0, 400)})`;
const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
const stored = async (m: Mounted) => ((await loadDocument(m, 'catalog')).document.pieces as Array<{ id: string }>).map(p => p.id);

// ===========================================================================
// unit:P82.ID1 — merge: every error names the record by its id and its position in the file sent
// ===========================================================================

describe('unit:P82.ID1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a merge import whose refused records are the k-th entries of the file names each by its id and by k in every error — the validator's (a new record, an updated stored one, an id past the bound), the eligibility check's and the vocabulary refusal's — all listed at once, the rest of each error as today`, async () => {
      const m = await mount(host, DOCS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      // Merged as [alpha, beta (updated), gamma, new-one, new-two, LONG]: new-two at 4, beta at 1, LONG at 5; in the file at 1, 2, 3.
      const schema = await importJson(m, [N1, N2, { id: 'look.beta', journeyStageFit: ['awareness'] }, LONG], 'merge');
      // The eligibility check runs over the candidates: new-four is the file's entry 1.
      const rule = await importJson(m, [N1, N4], 'merge');
      await inEffect(m);
      // Merged as [alpha (updated), beta, gamma, new-one, new-three]: alpha at 0, new-three at 4; in the file at 1 and 2.
      const vocabulary = await importJson(m, [N1, { id: 'look.alpha', tags: { category: ['bags'], color: ['chartreuse'] } }, N3], 'merge');
      const [e1, e2, e3] = [errorsOf(schema), errorsOf(rule), errorsOf(vocabulary)];
      expect([schema.status, rule.status, vocabulary.status], `${host}: PRECONDITION — each file is refused (${show(schema)} | ${show(rule)} | ${show(vocabulary)})`).toEqual([422, 422, 422]);
      expect.soft({
        newRecord: names(e1, 1, 'look.new-two', 'title: required string'),
        updatedRecord: names(e1, 2, 'look.beta', 'journeyStageFit', 'awareness'),
        pastTheBound: names(e1, 3, LONG_ID, 'title: required string'),
        eligibility: names(e2, 1, 'look.new-four', 'eligibleWhen', 'carrier-pigeon'),
        vocabularyUpdated: names(e3, 1, 'look.alpha', 'tags.color', 'chartreuse'),
        vocabularyNew: names(e3, 2, 'look.new-three', 'tags.color', 'chartreuse'),
      }, `${host}: P82.ID1 — every error names the record as records[k] '<id>' (today pieces[i] at the merged position, with no id: ${JSON.stringify([...e1, ...e2, ...e3]).slice(0, 500)})`).toEqual({
        newRecord: 'named', updatedRecord: 'named', pastTheBound: 'named', eligibility: 'named', vocabularyUpdated: 'named', vocabularyNew: 'named',
      });
      expect.soft([Object.keys(schema.body).sort(), schema.body.received, Object.keys(vocabulary.body).sort(), vocabulary.body.received],
        `${host}: P82.ID1 — LOCK: the 422 body's shape beyond the address as today`).toEqual([['errors', 'ok', 'received'], 4, ['errors', 'ok', 'received'], 3]);
    }, 120_000);

    it(`host (${host}): LOCK — a clean merge import stores the catalogue as today (the stored pieces in their places, an update in place, the new records after them in file order) and answers today's members`, async () => {
      const m = await mount(host, DOCS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const answer = await importJson(m, [N1, { id: 'look.beta', title: 'Story beta, retitled' }, piece('look.new-five', { category: ['shoes'] })], 'merge');
      expect(answer.status, `${host}: PRECONDITION — the clean merge is accepted (${show(answer)})`).toBe(200);
      expect.soft({ order: await stored(m), keys: Object.keys(answer.body).sort() }, `${host}: P82.ID1 — LOCK: order and answer as today`).toEqual({
        order: ['look.alpha', 'look.beta', 'look.gamma', 'look.new-one', 'look.new-five'],
        keys: ['changed', 'changedBasis', 'diagnostics', 'imported', 'mode', 'ok', 'pieces', 'publication', 'received', 'removed', 'revision', 'scope', 'version'],
      });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P82.ID2 — replace: the same, and a dropped entry does not shift the positions after it
// ===========================================================================

describe('unit:P82.ID2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on replace every error names the record by its id and by its position in the file sent, a non-object entry the import drops counted — JSON (the validator's, the eligibility check's, the vocabulary refusal's), CSV and a pull`, async () => {
      const m = await mount(host, DOCS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const schema = await importJson(m, [ALPHA, 42, null, N2, BETA], 'replace');
      const rule = await importJson(m, [null, N4, ALPHA], 'replace');
      const csv = await importCsv(m, [ALPHA, N2], 'replace');
      const pulled = await pull(m, [null, ALPHA, N2], 'replace');
      await inEffect(m);
      const vocabulary = await importJson(m, ['an entry that is not a record', ALPHA, BETA, GAMMA, N3], 'replace');
      const all = [schema, rule, csv, pulled, vocabulary];
      expect(all.map(a => a.status), `${host}: PRECONDITION — each file is refused (${all.map(show).join(' | ').slice(0, 600)})`).toEqual([422, 422, 422, 422, 422]);
      expect.soft({
        validator: names(errorsOf(schema), 3, 'look.new-two', 'title: required string'),
        eligibility: names(errorsOf(rule), 1, 'look.new-four', 'eligibleWhen', 'carrier-pigeon'),
        csvRow: names(errorsOf(csv), 1, 'look.new-two', 'title: required string'),
        pull: names(errorsOf(pulled), 2, 'look.new-two', 'title: required string'),
        vocabulary: names(errorsOf(vocabulary), 4, 'look.new-three', 'tags.color', 'chartreuse'),
      }, `${host}: P82.ID2 — the k of the file as sent (today pieces[i] counted after the dropped entries, with no id)`).toEqual({
        validator: 'named', eligibility: 'named', csvRow: 'named', pull: 'named', vocabulary: 'named',
      });
    }, 120_000);

    it(`host (${host}): LOCK — a clean replace stores the file's records in file order, an empty file is refused with today's words, and a PUT's refusal keeps addressing the document's own pieces[i]`, async () => {
      const m = await mount(host, DOCS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const clean = await importJson(m, [N1, null, GAMMA, ALPHA], 'replace');
      expect(clean.status, `${host}: PRECONDITION — the clean replace is accepted (${show(clean)})`).toBe(200);
      const order = await stored(m);
      const empty = await importJson(m, [null, 7], 'replace');
      const put = await putDocument(m, 'catalog', { pieces: [ALPHA, N2] }, 'p82 put');
      expect.soft({ order, empty: [empty.status, empty.body.errors], put: [put.status, errorsOf(put).includes('pieces[1].title: required string')] },
        `${host}: P82.ID2 — LOCK: today's order, words and PUT address`).toEqual({
        order: ['look.new-one', 'look.gamma', 'look.alpha'], empty: [422, ['no records found in the import']], put: [422, true],
      });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P82.ID3 — the piece warnings of an import or pull carry the record's id and position; the kit
// ===========================================================================

/** A merge file whose records raise each piece warning, after a dropped entry: merged as [alpha, beta (updated), gamma, five, six, seven, long]. */
const LONG_WARNED = `look.${'warned-identifier-'.repeat(4)}end`;
const WARNED = [
  null,
  piece('look.new-five', { category: ['bags'], colour: ['red'] }),
  { id: 'look.beta', tags: { category: ['Bags', 'bags'], color: ['black'] } },
  piece('look.new-six', { line: ['harbor'] }),
  { ...piece('look.new-seven', { category: ['shoes'] }), slotTypes: ['p82-nowhere'], vertical: 'menswear' },
  piece(LONG_WARNED, { category: ['shoes'], colour: ['blue'] }),
];
/** The ruled members of each piece warning, in the channel's order (the stored catalogue scanned piece by piece). */
const WARNED_EXPECTED = [
  { code: 'case_variant_value', pieceIndex: 1, recordIndex: 2, recordId: 'look.beta', recordIdTruncated: false },
  { code: 'unknown_dimension', pieceIndex: 3, recordIndex: 1, recordId: 'look.new-five', recordIdTruncated: false },
  { code: 'unknown_dimension', pieceIndex: 4, recordIndex: 3, recordId: 'look.new-six', recordIdTruncated: false },
  { code: 'no_nonempty_registered_tags', pieceIndex: 4, recordIndex: 3, recordId: 'look.new-six', recordIdTruncated: false },
  { code: 'unknown_slot_type', pieceIndex: 5, recordIndex: 4, recordId: 'look.new-seven', recordIdTruncated: false },
  { code: 'unknown_dimension', pieceIndex: 6, recordIndex: 5, recordId: LONG_WARNED.slice(0, 64), recordIdTruncated: true },
];
type Warned = Record<string, unknown> & { code: string };
const warningsOf = (a: Answer) => (((a.body.diagnostics as { warnings?: Warned[] | null } | undefined)?.warnings) ?? []);
const PIECE_CODES = ['unknown_dimension', 'case_variant_value', 'no_nonempty_registered_tags', 'unknown_slot_type'];
const ruled = (w: Warned) => ({ code: w.code, pieceIndex: w.pieceIndex, recordIndex: w.recordIndex ?? 'no recordIndex', recordId: w.recordId ?? 'no recordId', recordIdTruncated: w.recordIdTruncated ?? 'no recordIdTruncated' });
/** Today's members of each piece code on a PUT and a validation (catalogDiagnostics.ts `Warning`). */
const PUT_MEMBERS: Record<string, string[]> = {
  unknown_dimension: ['code', 'dimension', 'dimensionIndex', 'dimensionTruncated', 'pieceIndex'],
  case_variant_value: ['code', 'dimension', 'dimensionIndex', 'dimensionTruncated', 'pieceIndex', 'values', 'valuesTruncated'],
  no_nonempty_registered_tags: ['code', 'pieceIndex'],
  unknown_slot_type: ['code', 'pieceIndex', 'slotType'],
};

describe('unit:P82.ID3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on a merge import and a pull every piece warning keeps its stored pieceIndex and carries the record's file position (recordIndex) and id (recordId, cut to sixty-four code units, recordIdTruncated); ignored_field keeps exactly its members`, async () => {
      const m = await mount(host, DOCS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const imported = await importJson(m, WARNED, 'merge');
      expect(imported.status, `${host}: PRECONDITION — the import is accepted (${show(imported)})`).toBe(200);
      const pulled = await pull(m, WARNED, 'merge');
      expect(pulled.status, `${host}: PRECONDITION — the pull of the same feed is accepted (${show(pulled)})`).toBe(200);
      const read = (a: Answer) => ({ pieces: warningsOf(a).filter(w => PIECE_CODES.includes(w.code)).map(ruled), ignored: warningsOf(a).filter(w => w.code === 'ignored_field') });
      const IGNORED = [{ code: 'ignored_field', recordIndex: 4, field: 'vertical', fieldTruncated: false }];
      expect.soft({ import: read(imported), pull: read(pulled) }, `${host}: P82.ID3 — the record named on every piece warning (today pieceIndex alone)`).toEqual({
        import: { pieces: WARNED_EXPECTED, ignored: IGNORED }, pull: { pieces: WARNED_EXPECTED, ignored: IGNORED },
      });
    }, 120_000);

    it(`host (${host}): LOCK (R-P294 (1)) — a PUT and a validation of the same catalogue carry no record member on their piece warnings: each code's members as today`, async () => {
      const m = await mount(host, DOCS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const imported = await importJson(m, WARNED, 'merge');
      expect(imported.status, `${host}: PRECONDITION — the import is accepted (${show(imported)})`).toBe(200);
      const document = (await loadDocument(m, 'catalog')).document;
      const put = await putDocument(m, 'catalog', document, 'p82 put of the same catalogue');
      const validated = await asOperator(m, 'POST', `/content/catalog/validate?scope=${TENANT}`, { document });
      expect([put.status, validated.status], `${host}: PRECONDITION — the PUT and the validation are answered (${show(put)} | ${show(validated)})`).toEqual([200, 200]);
      const members = (a: Answer) => [...new Set(warningsOf(a).filter(w => PIECE_CODES.includes(w.code)).map(w => `${w.code}: ${Object.keys(w).sort().join(',')}`))].sort();
      const today = Object.entries(PUT_MEMBERS).map(([code, keys]) => `${code}: ${keys.join(',')}`).sort();
      expect.soft({ put: members(put), validate: members(validated) }, `${host}: P82.ID3 — LOCK: no record id echoed on a PUT or a validation`).toEqual({ put: today, validate: today });
    }, 120_000);
  }

  it('logic: the kit states the address and the members — kit 02\'s import row names records[k] with the position in the file sent and the id; kit 02\'s diagnostics paragraph names recordIndex, recordId and recordIdTruncated on an import or pull and qualifies "IDs are not echoed"; kit 03\'s recordIndex paragraph states both', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const row = kit02.split('\n').find(line => line.startsWith('| `POST /content/catalog/import')) ?? '';
    const diagnostics = kit02.split('\n').find(line => line.includes('`case_variant_value` means')) ?? '';
    const paragraph = kit03.split(/\n\s*\n/).find(p => p.includes('`ignored_field` warning') && p.includes('`recordIndex`'))?.split('\n').join(' ') ?? '';
    const sentences = (text: string) => text.split(/(?<=[.;])\s+(?=[A-Z`*(])/);
    expect([row === '' ? 'no import row' : 'found', diagnostics === '' ? 'no diagnostics paragraph' : 'found', paragraph === '' ? 'no recordIndex paragraph' : 'found'], 'PRECONDITION: the three passages').toEqual(['found', 'found', 'found']);
    expect.soft({
      importRow: [row.includes('records['), /position/i.test(row), /\bid\b|identifier/i.test(row)],
      diagnostics: ['`recordIndex`', '`recordId`', '`recordIdTruncated`'].map(member => diagnostics.includes(member)).concat(/import|pull/.test(diagnostics)),
      notEchoed: sentences(diagnostics).filter(s => /IDs are not echoed/.test(s)).map(s => /PUT|validat|read|import|pull/.test(s.replace(/^.*IDs are not echoed/, '')) ? 'qualified' : 'unqualified'),
      kit03: [paragraph.includes('records['), paragraph.includes('`recordId`'), /import|pull/.test(paragraph)],
    }, 'P82.ID3 — the kit states the record address and the warning members (today: pieceIndex and recordIndex only)').toEqual({
      importRow: [true, true, true], diagnostics: [true, true, true, true], notEchoed: ['qualified'], kit03: [true, true, true],
    });
  });
});
