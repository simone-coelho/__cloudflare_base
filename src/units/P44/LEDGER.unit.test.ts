// src/units/P44/LEDGER.unit.test.ts
// P44 under the Closure Ledger: the tests for the LOCAL criteria of the P44 work
// order (the operator-warnings programme, amendment 2, ticket P44 "No false
// 'ignored field' for `pooled` and `successEvent`; the W19 field-list lock
// derives"). DC1 (D1, RESOLVED by the owner's rule R-P78) is exercised inside
// PF1-PF3; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P44.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-2/BTI-Parity-Amendment-2026-10-16.md,
//     section 2, P44): "a direct publication declaring `pooled` or `successEvent`
//     answers 200 with no `ignored_field` advisory for those members, an unknown
//     field still gets the advisory (W19's contract kept), and a feed import or
//     pull keeps both members on the piece; kit 03's piece table lists both; the
//     W19 lock is corrected under R10 … derived from the validator's field list";
//   · kit 03's piece table (docs/kit/03-payload-schemas.md "The content piece":
//     `pooled` and `successEvent` are documented fields of the piece, "JSON, or a
//     CSV row with the same names as columns"); P08's and P16's receipted rulings
//     (a catalogue piece may carry `pooled: true`, src/units/P08/LEDGER.unit.test.ts:26-27;
//     `successEvent`, one reward of the list, src/units/P16/LEDGER.unit.test.ts:28-29);
//   · W19's contract (src/units/W19/B3.unit.test.ts, unit:W19.F3.04, and
//     src/content/catalogDiagnostics.ts:20): a field the contract does not list is
//     named as `{ code: 'ignored_field', recordIndex, field, fieldTruncated }`, its
//     position in the request, and is not stored; a known field is kept;
//   · the measured defect: P16's delivery review section 11 items 1 and 2 and
//     P08's section 11 (a direct publication declaring either member answers 200
//     with an `ignored_field` advisory while the piece keeps it; `FEED_FIELDS`
//     derives from `PIECE_FIELDS`, src/content/import.ts:79, and `normalizePiece`,
//     :128-172, copies neither member, so an import or a pull drops both).
//
// NO NEW MEMBER IS RULED. The field list grows by the two documented members, so
// every path that reads a piece against it keeps them without a word, and the
// unknown field keeps W19's advisory. One reading is ruled for the CSV feed (kit
// 03: a CSV row carries the same names as columns): a `pooled` cell `true`
// declares the module pooled, `true` being the declaration's one value; a
// `successEvent` cell carries the reward word.
//
// THE W19 R10 CORRECTION (its own commit before this one, R-P75 form; the W19
// receipt stands, the correction is test-only). src/units/W19/B3.unit.test.ts:
//   · :95-96, the `readFileSync` import, to read kit 03 from the tree the file
//     lives in;
//   · :463, the comment on `KIT_03_FIELDS`: the literal is now what kit 03
//     :133-149 listed when W19 locked the set (unchanged, :464-465);
//   · :467-493, new: `kitPieceFields()` reads the field column of kit 03's piece
//     table as it stands; `DOCUMENTED_VALUES` is W19's `KIT_PIECE` plus a value for
//     each member documented since (`pooled: true`, `successEvent: 'add_to_bag'`);
//     `contractPiece()` is the whole-contract piece of the validator's own list;
//   · :500-508, the logic leg (was :471-473, `PIECE_FIELDS` equal to the frozen
//     literal): every field of `PIECE_FIELDS` is a field kit 03's table documents
//     (no hand-written undocumented member: finding 4's meaning), and every field
//     W19 published stays in it. Green before P44 (20 listed, 22 documented) and
//     after (22 and 22). That every documented field is listed is P44.PF3 below,
//     RED until P44 lands: the two together are the old exact equality;
//   · :515-536, the host leg: the piece sent is `contractPiece()` instead of the
//     literal `KIT_PIECE` (identical today, the 20 fields), the stored keys equal
//     the fields sent (was `PIECE_FIELDS`, :486, which made the leg RED as soon
//     as the list grew: the P16 review's M16), the stored piece equals the piece
//     sent, no warning at all; `vertical` is asserted outside `PIECE_FIELDS`
//     before it is sent as the unknown field (a precondition, :528), and the
//     unknown-field clause is otherwise unchanged. Every other W19 assertion is
//     unchanged. Measured: src/units/W19 29/29 at the head, and 29/29 on a
//     scratch copy whose `PIECE_FIELDS` lists the two members (logs/).
//
// RULED MEMBERS THAT DO NOT EXIST YET: none. No new export is imported
// (`PIECE_FIELDS` exists).
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P44.log):
//   · src/units/W19/B3.unit.test.ts:461-499 (the field-list lock): corrected above;
//   · kit sentences that state the opposite of the ruling and that the build must
//     reword (P44.PF3's kit leg fails on them): docs/kit/02-api-reference.md:1035-1037
//     and :1846-1849 (a feed import or pull carries no `successEvent` / `pooled`; a
//     direct publication lists it among the ignored fields),
//     docs/kit/03-payload-schemas.md:238-239 (the table rows end "A feed import or
//     pull does not carry it") and :1221-1222;
//   · src/content/import.test.ts:23 (`CSV_COLUMNS` contains merchandising) and
//     W19's CSV case-variant units (src/units/W19/B3.unit.test.ts, unit:W19.F3.03)
//     hold: a case variant of a new column (`Pooled`) is refused as every case
//     variant is.
//
// HARNESS: src/units/_parity.ts (the mounted routes, both shopper hosts),
// src/units/_parity3.ts (the kit). Imports from src/units/: ../_parity, ../_parity3.

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { invalidatePublicationCache } from '@/config/publication';
import { PIECE_FIELDS } from '@/content/kinds';

import { asOperator, expectPublished, HOSTS, learnDocument, loadDocument, mount, putDocument, TENANT, type Answer, type Host, type Mounted } from '../_parity';
import { kitSentences, missingStatements } from '../_parity3';

const PDP_MODULES = 'pdp-modules', HOME_MODULES = 'home-modules', STORY = 'home-stories';
/** P08's pooled module (src/units/P08/LEDGER.unit.test.ts:99-104). */
const POOLED = 'module.complete-the-look.1';
/** P16's stories (src/units/P16/LEDGER.unit.test.ts:59-63): one declaring add_to_bag, one undeclared. */
const BAG_STORY = 'story.bag', FILM_STORY = 'story.film';
const POOLED_PIECE = { id: POOLED, customerContentId: 'TAP-COMPLETE-THE-LOOK-1', type: 'complete-the-look', title: 'complete-the-look', tags: { line: ['Tabby'] },
  slotTypes: [PDP_MODULES, HOME_MODULES], journeyStageFit: ['considering'], lifecycle: { status: 'live' }, pooled: true };
const BAG_PIECE = { id: BAG_STORY, customerContentId: 'TAP-STORY-BAG', type: 'editorial', title: 'Carry the Tabby', tags: { line: ['Tabby'] }, slotTypes: [STORY],
  lifecycle: { status: 'live' }, successEvent: 'add_to_bag' };
const FILM_PIECE = { id: FILM_STORY, customerContentId: 'TAP-STORY-FILM', type: 'editorial', title: 'The Tabby in motion', tags: { line: ['Tabby'] }, slotTypes: [STORY],
  lifecycle: { status: 'live' } };
/** The unknown input W19 uses (src/units/W19/B3.unit.test.ts:530, :493 before the correction): a field the contract does not list. */
const UNKNOWN = { vertical: 'menswear' };
/** What a publication submits: the pooled module, the story declaring its success event, and a story carrying the unknown field (record 2). */
const SUBMITTED = [POOLED_PIECE, BAG_PIECE, { ...FILM_PIECE, ...UNKNOWN }];
const SLOTS = { version: 'parity-p44-slots', governanceVersion: 3, pages: {
  pdp: [{ slot: PDP_MODULES, take: 3, weights: { line: 1 } }], home: [{ slot: HOME_MODULES, take: 3, weights: { line: 1 } }, { slot: STORY, take: 3, weights: { line: 1 } }] } };

async function world(host: Host): Promise<Mounted> {
  const m = await mount(host, { pieces: [FILM_PIECE], slots: SLOTS, learn: learnDocument({ [STORY]: { reward: 'click' } }) });
  expectPublished(m, 'P44 — a catalogue, the pages and the learn document publish');
  return m;
}

type Warning = Record<string, unknown> & { code?: string; field?: string };
const ignoredOf = (answer: Answer): Warning[] => (((answer.body.diagnostics as { warnings?: Warning[] } | undefined)?.warnings) ?? []).filter(w => w.code === 'ignored_field');
/** W19's advisory for the unknown field of record 2, exactly (catalogDiagnostics.ts:20). */
const UNKNOWN_ADVISORY = [{ code: 'ignored_field', field: 'vertical', fieldTruncated: false, recordIndex: 2 }];
/** What the stored catalogue keeps of the three pieces: both members, and not the unknown field. */
async function keptOf(m: Mounted) {
  const pieces = (await loadDocument(m, 'catalog')).document.pieces as Array<Record<string, unknown>>;
  const byId = (id: string) => pieces.find(p => p.id === id) ?? {};
  return { pooled: byId(POOLED).pooled ?? 'no pooled on the stored piece', successEvent: byId(BAG_STORY).successEvent ?? 'no successEvent on the stored piece',
    unknown: Object.hasOwn(byId(FILM_STORY), 'vertical') ? 'the unknown field was stored' : 'dropped' };
}
const KEPT = { pooled: true, successEvent: 'add_to_bag', unknown: 'dropped' };

/** A feed write through the mounted routes with the authored preconditions (kit 02: If-Match plus Idempotency-Key). */
async function feedWrite(m: Mounted, path: string, body: string, contentType: string): Promise<Answer> {
  const base = await loadDocument(m, 'catalog');
  const response = await m.fetch(new Request(`http://console.test${path}`, { method: 'POST', body, headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`,
    'content-type': contentType, 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` } }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  invalidatePublicationCache();
  return answer;
}
const CSV_COLUMNS = ['id', 'customerContentId', 'type', 'title', 'tags', 'slotTypes', 'status', 'journeyStageFit', 'pooled', 'successEvent', 'vertical'];
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** The same three pieces as a CSV export (kit 03: tags `dimension:value`, lists `|`; a blank cell is omitted). */
const CSV = [CSV_COLUMNS.join(','),
  [POOLED, 'TAP-COMPLETE-THE-LOOK-1', 'complete-the-look', 'complete-the-look', 'line:Tabby', `${PDP_MODULES}|${HOME_MODULES}`, 'live', 'considering', 'true', '', ''],
  [BAG_STORY, 'TAP-STORY-BAG', 'editorial', 'Carry the Tabby', 'line:Tabby', STORY, 'live', '', '', 'add_to_bag', ''],
  [FILM_STORY, 'TAP-STORY-FILM', 'editorial', 'The Tabby in motion', 'line:Tabby', STORY, 'live', '', '', '', 'menswear'],
].map(row => (Array.isArray(row) ? row.map(csvCell).join(',') : row)).join('\n') + '\n';

/** Kit 03's piece table, its field column as it stands (the W19 correction's reading, repeated here: a test file is never imported). */
const ROOT = new URL('../../../', import.meta.url);
function kitPieceTable(): Array<{ field: string; meaning: string }> {
  const lines = readFileSync(new URL('docs/kit/03-payload-schemas.md', ROOT), 'utf8').split('\n');
  const at = lines.findIndex(line => /^## The content piece\s*$/.test(line));
  const header = lines.findIndex((line, i) => i > at && /^\| Field \|/.test(line));
  const rows: Array<{ field: string; meaning: string }> = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|');
    for (const match of (cells[1] ?? '').matchAll(/`([A-Za-z]+)(?:\.[A-Za-z]+)?`/g)) if (!rows.some(r => r.field === match[1])) rows.push({ field: match[1]!, meaning: (cells[3] ?? '').trim() });
  }
  return rows;
}

// ===========================================================================
// unit:P44.PF1 — a direct publication keeps both members with no false advisory
// ===========================================================================

describe('unit:P44.PF1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a direct catalogue publication declaring pooled: true on a module and a successEvent on a story answers 200 with no ignored_field advisory for either and keeps both, while the unknown field of another story is named by W19's advisory and not stored; the validate door answers the same`, async () => {
      const m = await world(host);
      const put = await putDocument(m, 'catalog', { pieces: SUBMITTED }, 'p44-pf1');
      expect(put.status, `${host}: P44.PF1 — the direct publication is accepted (${JSON.stringify(put.body).slice(0, 300)})`).toBe(200);
      expect.soft(ignoredOf(put), `${host}: P44.PF1 — the advisory names the unknown field alone, never pooled or successEvent`).toEqual(UNKNOWN_ADVISORY);
      expect.soft(await keptOf(m), `${host}: P44.PF1 — the stored pieces keep both members and drop the unknown field`).toEqual(KEPT);
      const validated = await asOperator(m, 'POST', `/content/catalog/validate?scope=${TENANT}`, { document: { pieces: SUBMITTED } });
      expect.soft(validated.status, `${host}: P44.PF1 — the validate door accepts it`).toBe(200);
      expect.soft(ignoredOf(validated), `${host}: P44.PF1 — and names the unknown field alone`).toEqual(UNKNOWN_ADVISORY);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P44.PF2 — a feed import and a pull keep both members
// ===========================================================================

describe('unit:P44.PF2 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a JSON import, a CSV import and a pull of the same three pieces keep pooled and successEvent on the imported pieces with no ignored_field advisory for either, and drop the unknown column as today, naming it`, async () => {
      const m = await world(host);
      const fields = (answer: Answer) => [...new Set(ignoredOf(answer).map(w => w.field))].sort();

      const json = await feedWrite(m, `/content/catalog/import?scope=${TENANT}&mode=replace`, JSON.stringify({ pieces: SUBMITTED }), 'application/json');
      expect(json.status, `${host}: P44.PF2 — the JSON import is accepted (${JSON.stringify(json.body).slice(0, 300)})`).toBe(200);
      expect.soft(await keptOf(m), `${host}: P44.PF2 — the JSON import keeps both members and drops the unknown field`).toEqual(KEPT);
      expect.soft(ignoredOf(json), `${host}: P44.PF2 — and names the unknown field alone`).toEqual(UNKNOWN_ADVISORY);

      const csv = await feedWrite(m, `/content/catalog/import?scope=${TENANT}&format=csv&mode=replace`, CSV, 'text/csv');
      expect(csv.status, `${host}: P44.PF2 — the CSV import is accepted (${JSON.stringify(csv.body).slice(0, 300)})`).toBe(200);
      expect.soft(await keptOf(m), `${host}: P44.PF2 — the CSV import keeps both members (a pooled cell true declares the module pooled) and drops the unknown column`).toEqual(KEPT);
      expect.soft(fields(csv), `${host}: P44.PF2 — and names the unknown column alone`).toEqual(['vertical']);

      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: SUBMITTED })));
      const base = await loadDocument(m, 'catalog');
      const pulled = await (async () => {
        try {
          return await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, { url: 'https://cms.example.invalid/export.json', path: 'content', mode: 'replace' },
            { 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` });
        } finally { spy.mockRestore(); }
      })();
      invalidatePublicationCache();
      expect(pulled.status, `${host}: P44.PF2 — the pull is accepted (${JSON.stringify(pulled.body).slice(0, 300)})`).toBe(200);
      expect.soft(await keptOf(m), `${host}: P44.PF2 — the pull keeps both members and drops the unknown field`).toEqual(KEPT);
      expect.soft(ignoredOf(pulled), `${host}: P44.PF2 — and names the unknown field alone`).toEqual(UNKNOWN_ADVISORY);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P44.PF3 — the validator's list is kit 03's piece table; the kit
// ===========================================================================

describe('unit:P44.PF3 (R-P78, D1)', () => {
  it('logic: the validator\'s field list is exactly the fields kit 03\'s piece table documents (with W19\'s corrected lock, the old exact equality), and the table gives both members their meaning', () => {
    const table = kitPieceTable();
    expect(table.length, 'PRECONDITION: kit 03\'s piece table is read').toBeGreaterThanOrEqual(20);
    expect.soft(table.filter(r => ['pooled', 'successEvent'].includes(r.field)).map(r => [r.field, r.field === 'pooled' ? /pool/i.test(r.meaning) : /success/i.test(r.meaning)]),
      'P44.PF3 — kit 03\'s piece table lists pooled and successEvent with their meaning').toEqual([['pooled', true], ['successEvent', true]]);
    expect.soft([...PIECE_FIELDS].sort(), 'P44.PF3 — every field the piece table documents is a field the validator reads a record against, and no other').toEqual(table.map(r => r.field).sort());
  });

  it('logic: the API reference states that a direct publication keeps both members with no ignored-field advisory, and no sentence of kit 02 or 03 still says a feed drops them or a direct publication names them as ignored', () => {
    // The no-advisory phrase must name the advisory itself, and the sentence must not be one that lists the member among the ignored fields
    // (today's "Limits" sentence names a direct publication, says the piece keeps it, and says "no pooled member": it is the opposite statement).
    const noAdvisory = /\b(no|without|never)\s+(an?\s+)?ignored[_ -]field\b|\bnot\s+(named|listed)\s+(as\s+)?(an?\s+)?ignored\b/i;
    const keeps = (member: string) => (t: string) => new RegExp(`\\b${member}\\b`).test(t) && /(direct publication|PUT \/content\/catalog)/.test(t) && /\b(keeps?|kept|stored)\b/.test(t)
      && noAdvisory.test(t) && !/among the ignored fields/i.test(t);
    const missing = missingStatements(['docs/kit/02-api-reference.md'], [
      { name: 'a direct publication declaring pooled keeps it with no ignored_field advisory', test: keeps('pooled') },
      { name: 'a direct publication declaring successEvent keeps it with no ignored_field advisory', test: keeps('successEvent') },
    ]);
    const denying = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'].flatMap(file => kitSentences(file)
      .filter(t => (/import or (a )?pull/i.test(t) && /(carries no (pooled|successEvent)|carry no (pooled|successEvent)|does not carry it)/i.test(t)) || /among the ignored fields/i.test(t))
      .map(t => `${file}: ${t.slice(0, 160)}`));
    expect.soft(missing, 'P44.PF3 — kit 02 states that a direct publication keeps both members').toEqual([]);
    expect.soft(denying, 'P44.PF3 — and no kit sentence still says a feed drops them or a direct publication names them as ignored').toEqual([]);
  });
});
