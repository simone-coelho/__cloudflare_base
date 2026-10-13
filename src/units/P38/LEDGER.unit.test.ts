// src/units/P38/LEDGER.unit.test.ts
// P38 under the Closure Ledger, the second parity programme:
// the tests for the LOCAL criteria VA1 to VA5 of the P38 work order ("The
// published vocabulary as the authority for product and content attributes").
// DC1 and DC2 (decisions D1, D2, RESOLVED 2026-10-09, amendment items 55, 61) are
// ruled and exercised inside VA1 to VA3; LV1 and LV2 are deferred live rows and get
// no test.
//
// One `describe('unit:P38.<criterion>')` per criterion. Every expected value comes
// from the work order, its decisions or a witness it cites, never from what the
// engine answers today:
//   · the work order's Done-when (amended ticket file, section E, P38): "a
//     vocabulary document lists every attribute … with its values, each an id
//     (lower case, words joined by underscores, at most 64 characters, none of the
//     CSV tag separators), a display name that keeps the customer's wording and
//     synonyms; the catalogue import and the event ingest map source values
//     through one mapping table, resolving synonyms there, so data arriving
//     already mapped passes through unchanged; a value outside the list is refused
//     at publication and reported with the piece and the field; revisions are
//     versioned and take effect only when approved; a tenant without a vocabulary
//     keeps today's free-text behaviour exactly";
//   · D1: a revision takes effect only when approved in the console by the
//     tenant's operator; later revisions block nothing. D2: synonyms are resolved
//     by the mapping table at ingest; data arriving already mapped passes through;
//   · the customer's T7 rules (authority copy, amendment-1): fixed values only, a
//     value outside the list rejected at load and the rejection reported; each value
//     an id, a display name and synonyms ("night out" maps to occasion: evening);
//     every sub-category belongs to exactly one category; one mapping table;
//   · the investigation §3.4 (the registry draft's keys and value ids: category,
//     productType with its parent, color, occasion …; ids with none of the colon,
//     semicolon or vertical bar the CSV tag syntax uses) and DI-9 (the list becomes
//     the authority, so sparse content no longer refuses product values);
//   · the code at af671ce7 for what "today" is: tags are free text
//     (src/content/kinds.ts:79-95, :173-186; src/content/import.ts:20-34), and an
//     event value on a dimension the published catalogue names values on builds no
//     taste unless the catalogue names it (src/reflex/core.ts:451-470, R64).
//
// THE REPRESENTATION THIS FILE RULES (one for all five criteria):
//   · A new publication kind `vocabulary`, routed as every content kind is
//     (`GET`/`PUT /content/vocabulary`, history, revisions), whose document is
//       { version?, attributes: { <attribute key>: { values: [{ id, name, synonyms?, parent? }] } } }
//     The attribute key is the registry dimension and tag key (category,
//     productType, color, occasion …). An id is lower case letters and digits,
//     words joined by single underscores, at most 64 characters, so none of `:`,
//     `;`, `|`. `name` is kept as authored. Every `productType` value names exactly
//     one `parent`, a string. A synonym belongs to one value of its attribute.
//     The values' ids and synonyms are the one mapping table: an id maps to
//     itself, a synonym to its value's id.
//   · Approval: `PUT` stores a revision and answers it; `GET /content/vocabulary`
//     answers `revision` (the latest stored) and `effectiveRevision` (the approved
//     revision in effect; 0 when none is); `POST /content/vocabulary/approve/:n`
//     (operator, with the publication preconditions) puts revision n in effect.
//     The console's view `#/vocabulary` carries the control
//     `[data-focus-key="vocabulary.approve"]`, which approves the latest stored
//     revision through that route, and shows the effective revision in words:
//     its text says "revision <n> in effect" (or "revision <n> is in effect", in
//     any case), on the screen after the approval and whenever the screen is
//     opened (remaining-work item 4, under R-P43; the screen's status line in the
//     console's convention, "Reading revision <n> of the learn document.",
//     public/console/views.js:563).
//   · In effect, an attribute the vocabulary lists is governed. The catalogue
//     import (`POST /content/catalog/import`) and `PUT /content/catalog` store a
//     governed tag's mapped ids; a value that maps to nothing refuses the write
//     (422) with an error naming the piece's id and the field `tags.<attribute>`.
//     At ingest, on both hosts, a governed event value builds interest under its
//     mapped id; a value that maps to nothing builds none and is counted in the
//     tenant's rejection report, `GET /content/vocabulary/rejections` answering
//     `rejections: { <attribute>: { <value>: count } }`; the event is otherwise
//     processed as before. The vocabulary, not the catalogue's own tags, is the
//     authority on a governed dimension (DI-9).
//   · A tenant with no vocabulary in effect: nothing of the above.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the
// kind `vocabulary` and its routes, `effectiveRevision`, the approve route, the
// rejection report route, the console view and control. No new export is imported.
//
// HARNESS: src/units/_parity.ts (mount, both hosts, the console, the P02 page) and
// src/units/_parity5.ts (putKind, readKind, the shopper).

import { describe, expect, it } from 'vitest';

import {
  asOperator, declaredSlots, errorsOf, HOSTS, layoutSlot, LAYOUT, learnDocument, loadDocument, M, MODULES, mount, openConsole, pageInstanceOf,
  putDocument, readTree, recentSlot, REFLEX_DOCUMENT, servedIn, shopperOn, TENANT, type Answer, type Mounted,
} from '../_parity';
import { HOME, homeLearn, putKind, readKind, visitorOn } from '../_parity5';

/** The tenant's vocabulary (customer-neutral values in the investigation §3.4 shape), with its synonyms and the product types' parents. */
const VOCABULARY = {
  version: 'parity5-vocabulary',
  attributes: {
    category: { values: [
      { id: 'bags', name: 'Bags', synonyms: ['handbags'] }, { id: 'shoes', name: 'Shoes' },
      { id: 'small_leather_goods', name: 'Small leather goods', synonyms: ['slg'] },
    ] },
    productType: { values: [
      { id: 'crossbody', name: 'Crossbody', synonyms: ['cross-body'], parent: 'bags' }, { id: 'tote', name: 'Tote', parent: 'bags' },
      { id: 'wallet', name: 'Wallet', parent: 'small_leather_goods' }, { id: 'sneaker', name: 'Sneaker', parent: 'shoes' },
    ] },
    color: { values: [
      { id: 'black', name: 'Black' }, { id: 'brown_tan', name: 'Brown / tan', synonyms: ['cognac', 'tan', 'brown'] },
      { id: 'neutral', name: 'Neutral (cream, chalk, grey)', synonyms: ['cream', 'chalk', 'grey'] },
    ] },
    occasion: { values: [{ id: 'everyday', name: 'Everyday' }, { id: 'evening', name: 'Evening', synonyms: ['night out'] }] },
  },
};

const HERO = 'home-hero';
const piece = (id: string, tags: Record<string, string[]>) => ({ id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'editorial', title: `Story ${id}`, tags, slotTypes: [HERO], lifecycle: { status: 'live' } });
/** The published catalogue: every governed value already an id; `line` is not governed. */
const CATALOGUE = [
  piece('look.evening-crossbody', { category: ['bags'], productType: ['crossbody'], color: ['black'], occasion: ['evening'] }),
  piece('look.weekend-tote', { category: ['bags'], productType: ['tote'], color: ['brown_tan'], occasion: ['everyday'] }),
  piece('look.city-sneaker', { category: ['shoes'], productType: ['sneaker'], color: ['neutral'], line: ['Harbor'] }),
];
/** An imported piece in the source systems' own words: a synonym on every governed attribute, and an ungoverned line. */
const SOURCE_WORDED = piece('look.night-wallet', { category: ['slg'], productType: ['wallet'], color: ['cognac'], occasion: ['night out'], line: ['Meadow'] });
const SOURCE_MAPPED = { category: ['small_leather_goods'], productType: ['wallet'], color: ['brown_tan'], occasion: ['evening'], line: ['Meadow'] };
/** An imported piece carrying a value outside the list on a governed attribute. */
const OUTSIDE = piece('look.bright-scarf', { category: ['bags'], color: ['chartreuse'] });

/** The registry scoring the four attributes, from the event's own values (`event-when-unknown`). */
const REGISTRY = { ...REFLEX_DOCUMENT, version: 'parity5-attribute-registry',
  dimensions: [{ key: 'category', source: 'category' }, { key: 'productType', source: 'productType' }, { key: 'color', source: 'color' }, { key: 'occasion', source: 'occasion', multi: true }] };
const DOCS = { pieces: CATALOGUE, slots: { version: 'parity5-slots', pages: { [HOME]: [{ slot: HERO, take: 3, weights: { category: 1, color: 0.5, occasion: 0.5 } }] } },
  learn: homeLearn(), reflex: REGISTRY };

/** The vocabulary screen's words for the effective revision n: "revision n in effect" or "revision n is in effect", in any case. */
const IN_EFFECT = (n: number) => new RegExp(`\\brevision ${n} (?:is )?in effect\\b`, 'i');
/** `POST /content/vocabulary/approve/:n` with the publication preconditions of the vocabulary's current head. */
async function approve(m: Mounted, n: number): Promise<Answer> {
  const base = await readKind(m, 'vocabulary');
  const publication = base.body.publication as { revision: number; digest: string } | undefined;
  return asOperator(m, 'POST', `/content/vocabulary/approve/${n}?scope=${TENANT}`, {}, {
    ...(publication ? { 'If-Match': `"${base.body.revision as number}/${publication.revision}/${publication.digest}"` } : {}),
    'Idempotency-Key': `${base.body.revision as number}:${crypto.randomUUID()}` });
}
/** `POST /content/catalog/import` (a JSON export, replace mode) with the authored preconditions, as a CMS sends it. */
async function importCatalog(m: Mounted, records: unknown[]): Promise<Answer> {
  const base = await loadDocument(m, 'catalog');
  return asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}&mode=replace`, { content: records }, {
    'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` });
}
const storedPiece = async (m: Mounted, id: string) =>
  ((await loadDocument(m, 'catalog')).document.pieces as Array<{ id: string; tags: Record<string, string[]> }>).find(p => p.id === id)?.tags;

/** Publish the vocabulary and approve it; every step's answer is asserted, naming the missing behaviour. */
async function inEffect(m: Mounted): Promise<void> {
  const written = await putKind(m, 'vocabulary', VOCABULARY, 'vocabulary revision 1');
  expect(written.status, `P38 — the vocabulary document publishes through PUT /content/vocabulary: ${JSON.stringify(written.body).slice(0, 200)}`).toBe(200);
  const approved = await approve(m, 1);
  expect(approved.status, `P38 — revision 1 is approved through POST /content/vocabulary/approve/1: ${JSON.stringify(approved.body).slice(0, 200)}`).toBe(200);
}

// ===========================================================================
// unit:P38.VA1 — the vocabulary document, its refusals, the approval step
// ===========================================================================

describe('unit:P38.VA1', () => {
  it('host: a tenant publishes the vocabulary document as a versioned revision kept as authored; an id outside the grammar, a duplicate id, a product type naming no parent or two, and a synonym on two values are refused with a named error, writing no revision', async () => {
    const m = await mount('session', DOCS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const written = await putKind(m, 'vocabulary', VOCABULARY, 'revision 1');
    expect(written.status, `P38.VA1 — the vocabulary publishes: ${JSON.stringify(written.body).slice(0, 300)}`).toBe(200);
    const read = await readKind(m, 'vocabulary');
    expect.soft([read.body.revision, read.body.document], 'P38.VA1 — the stored revision 1, kept as authored (display names in the customer’s wording)').toEqual([1, VOCABULARY]);

    const color = VOCABULARY.attributes.color.values, types = VOCABULARY.attributes.productType.values;
    const withColor = (values: unknown[]) => ({ ...VOCABULARY, attributes: { ...VOCABULARY.attributes, color: { values } } });
    const withTypes = (values: unknown[]) => ({ ...VOCABULARY, attributes: { ...VOCABULARY.attributes, productType: { values } } });
    const refusals: Array<[string, unknown, string]> = [
      ['an id outside the grammar (upper case and a space)', withColor([...color, { id: 'Bright Red', name: 'Bright red' }]), 'Bright Red'],
      ['an id carrying a CSV tag separator', withColor([...color, { id: 'print|pattern', name: 'Print / pattern' }]), 'print|pattern'],
      ['an id longer than 64 characters', withColor([...color, { id: 'c'.repeat(65), name: 'Long' }]), 'c'.repeat(65)],
      ['a duplicate id', withColor([...color, { id: 'black', name: 'Black again' }]), 'black'],
      ['a product type naming no parent', withTypes([...types, { id: 'backpack', name: 'Backpack' }]), 'backpack'],
      ['a product type naming two parents', withTypes([...types, { id: 'pouch', name: 'Pouch', parent: ['bags', 'small_leather_goods'] }]), 'pouch'],
      ['a synonym mapping to two values', withColor([{ id: 'black', name: 'Black', synonyms: ['tan'] }, ...color.slice(1)]), 'tan'],
    ];
    const outcomes: Array<{ case: string; status: number; named: boolean; errors: string[] }> = [];
    for (const [name, document, offending] of refusals) {
      const answer = await putKind(m, 'vocabulary', document, name);
      const errors = errorsOf(answer);
      outcomes.push({ case: name, status: answer.status, named: errors.some(e => e.includes(offending)), errors });
    }
    expect(outcomes.map(o => ({ case: o.case, status: o.status, named: o.named })),
      `P38.VA1 — each is refused (422) with an error naming the offending value: ${JSON.stringify(outcomes.map(o => [o.case, o.status, o.errors]))}`)
      .toEqual(refusals.map(([name]) => ({ case: name, status: 422, named: true })));
    expect((await readKind(m, 'vocabulary')).body.revision, 'P38.VA1 — and no refused document wrote a revision').toBe(1);
  }, 120_000);

  it('host: a stored revision is not in effect until the operator approves it — the effective revision is reported, a value outside the list is accepted as free text before the approval and refused after it', async () => {
    const m = await mount('session', DOCS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const written = await putKind(m, 'vocabulary', VOCABULARY, 'revision 1');
    expect(written.status, `P38.VA1 — the vocabulary publishes: ${JSON.stringify(written.body).slice(0, 200)}`).toBe(200);
    expect((await readKind(m, 'vocabulary')).body.effectiveRevision, 'P38.VA1 — stored, and not in effect: the effective revision is 0').toBe(0);
    const before = await importCatalog(m, [...CATALOGUE, OUTSIDE]);
    expect(before.status, `P38.VA1 — before the approval the vocabulary governs nothing: the outside value imports as free text (${JSON.stringify(errorsOf(before))})`).toBe(200);
    const approved = await approve(m, 1);
    expect(approved.status, `P38.VA1 — the operator approves revision 1: ${JSON.stringify(approved.body).slice(0, 200)}`).toBe(200);
    expect((await readKind(m, 'vocabulary')).body.effectiveRevision, 'P38.VA1 — the effective revision is reported: 1').toBe(1);
    const after = await importCatalog(m, [...CATALOGUE, OUTSIDE]);
    expect(after.status, 'P38.VA1 — once approved, the same import is refused').toBe(422);
  }, 120_000);

  it('sdk: on the shipped console the tenant’s operator approves the stored revision on the vocabulary screen, through the approve route, and the effective revision becomes it', async () => {
    const m = await mount('session', DOCS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const written = await putKind(m, 'vocabulary', VOCABULARY, 'revision 1');
    expect(written.status, `P38.VA1 — the vocabulary publishes: ${JSON.stringify(written.body).slice(0, 200)}`).toBe(200);
    const c = await openConsole(m, `#/vocabulary?scope=${TENANT}`);
    try {
      const button = c.control('vocabulary.approve');
      expect(button ? 'present' : 'no [data-focus-key="vocabulary.approve"] control on #/vocabulary', 'P38.VA1 — the vocabulary screen offers the approval').toBe('present');
      // Revision 1 is stored and none is in effect (the effective revision 0, as the leg above reads it): the screen
      // shows the effective revision, never the stored one.
      expect(IN_EFFECT(1).test(c.text()), `P38.VA1 — before the approval, with revision 1 stored and none in effect, the vocabulary screen does not show revision 1 in effect: ${c.text().slice(0, 300)}`).toBe(false);
      button!.click();
      await c.settle(); await c.settle();
      expect(c.requests.filter(r => r.method === 'POST' && r.path.startsWith('/content/vocabulary/approve/1')).length, 'P38.VA1 — the console approved revision 1 through the route').toBe(1);
      expect((await readKind(m, 'vocabulary')).body.effectiveRevision, 'P38.VA1 — and revision 1 is in effect').toBe(1);
      // R-P43, remaining-work item 4: the effective revision shown, on this screen and on the screen opened afresh (read from the route, not a notice).
      await c.settle();
      expect(IN_EFFECT(1).test(c.text()), `P38.VA1 — after the approval the vocabulary screen shows revision 1 in effect: ${c.text().slice(0, 300)}`).toBe(true);
      const again = await openConsole(m, `#/vocabulary?scope=${TENANT}`);
      try {
        expect(IN_EFFECT(1).test(again.text()), `P38.VA1 — and the vocabulary screen opened again shows revision 1 in effect: ${again.text().slice(0, 300)}`).toBe(true);
      } finally { again.close(); }
      // A second valid revision stored and not approved: the effective revision stays 1, and so does the screen.
      const revision2 = { ...VOCABULARY, version: 'parity5-vocabulary-2',
        attributes: { ...VOCABULARY.attributes, occasion: { values: [...VOCABULARY.attributes.occasion.values, { id: 'travel', name: 'Travel' }] } } };
      const stored = await putKind(m, 'vocabulary', revision2, 'revision 2');
      expect(stored.status, `P38.VA1 — a second revision publishes: ${JSON.stringify(stored.body).slice(0, 200)}`).toBe(200);
      const read = await readKind(m, 'vocabulary');
      expect([read.body.revision, read.body.effectiveRevision], 'P38.VA1 — revision 2 is stored and not in effect: revision 1 stays in effect').toEqual([2, 1]);
      const later = await openConsole(m, `#/vocabulary?scope=${TENANT}`);
      try {
        expect([IN_EFFECT(1).test(later.text()), IN_EFFECT(2).test(later.text())],
          `P38.VA1 — with revision 2 stored and not approved, the vocabulary screen opened again still shows revision 1 in effect, and not revision 2: ${later.text().slice(0, 300)}`).toEqual([true, false]);
      } finally { later.close(); }
    } finally { c.close(); }
  }, 120_000);
});

// ===========================================================================
// unit:P38.VA2 — the catalogue import maps through the table
// ===========================================================================

describe('unit:P38.VA2', () => {
  it('host: with the vocabulary in effect a catalogue import stores a governed attribute’s mapped ids (synonyms and source names to ids), passes values that are already ids unchanged, and refuses a piece carrying a value outside the list naming the piece and the field', async () => {
    const m = await mount('session', DOCS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    await inEffect(m);
    const refused = await importCatalog(m, [...CATALOGUE, SOURCE_WORDED, OUTSIDE]);
    const errors = errorsOf(refused);
    expect([refused.status, errors.some(e => e.includes(OUTSIDE.id) && e.includes('color') && e.includes('chartreuse'))],
      `P38.VA2 — the import carrying the outside value is refused, naming the piece, the field and the value: ${JSON.stringify(errors)}`).toEqual([422, true]);
    const imported = await importCatalog(m, [...CATALOGUE, SOURCE_WORDED]);
    expect(imported.status, `P38.VA2 — the import in the source systems’ own words is admitted: ${JSON.stringify(errorsOf(imported))}`).toBe(200);
    expect.soft(await storedPiece(m, SOURCE_WORDED.id), 'P38.VA2 — its governed values are stored as their ids; the ungoverned line is untouched').toEqual(SOURCE_MAPPED);
    for (const p of CATALOGUE) expect.soft(await storedPiece(m, p.id), `P38.VA2 — ${p.id}: values that are already ids pass unchanged`).toEqual(p.tags);
  }, 120_000);

  it('host: a catalogue publication (PUT /content/catalog) carrying a value outside the list on a governed attribute is refused naming the piece and the field', async () => {
    const m = await mount('session', DOCS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    await inEffect(m);
    const answer = await putDocument(m, 'catalog', { version: 'parity5-catalogue', pieces: [...CATALOGUE, OUTSIDE] }, 'outside value');
    const errors = errorsOf(answer);
    expect([answer.status, errors.some(e => e.includes(OUTSIDE.id) && e.includes('color'))],
      `P38.VA2 — refused, naming the piece and the field: ${JSON.stringify(errors)}`).toEqual([422, true]);
  }, 120_000);
});

// ===========================================================================
// unit:P38.VA3 — the event ingest maps through the same table
// ===========================================================================

/** The keys the shopper's interest holds per dimension, from the SDK-visible hydrate. */
async function interestKeys(m: Mounted, s: { hydrate: () => Promise<Answer> }): Promise<Record<string, string[]>> {
  const read = await s.hydrate();
  expect(read.status, `${m.host}: the hydrate answers`).toBe(200);
  const dims = ((read.body.affinity as { dims?: Record<string, Record<string, number>> } | null)?.dims ?? {});
  return Object.fromEntries(Object.entries(dims).map(([dim, values]) => [dim, Object.keys(values).sort()]).filter(([, values]) => values.length));
}
const VIEW_SOURCE_WORDED = { type: 'product_view', data: { productId: 'SKU-WALLET-1', category: 'slg', productType: 'wallet', color: 'cognac', occasion: ['night out'] } };
const VIEW_OUTSIDE = { type: 'product_view', data: { productId: 'SKU-SCARF-1', category: 'bags', color: 'chartreuse' } };

describe('unit:P38.VA3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with the vocabulary in effect an event's governed values build interest under their mapped ids, a value outside the list builds none and is counted in the tenant's rejection report, and the event is still recorded`, async () => {
      const m = await mount(host, DOCS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      await inEffect(m);
      const s = await visitorOn(m);
      const first = await s.action(VIEW_SOURCE_WORDED);
      const second = await s.action(VIEW_OUTSIDE);
      expect([first.status, second.status, second.body.success], `${host}: P38.VA3 — both events are accepted and processed`).toEqual([200, 200, true]);
      // The vocabulary, not the catalogue's own sparse tags, is the authority on a governed dimension (DI-9):
      // small_leather_goods and wallet build although no published piece carries them.
      expect(await interestKeys(m, s), `${host}: P38.VA3 — interest under the mapped ids only; nothing under a source spelling or the outside value`).toEqual({
        category: ['bags', 'small_leather_goods'], color: ['brown_tan'], occasion: ['evening'], productType: ['wallet'] });
      const report = await asOperator(m, 'GET', `/content/vocabulary/rejections?scope=${TENANT}`);
      expect([report.status, report.body.rejections], `${host}: P38.VA3 — the rejection report counts the outside value: ${JSON.stringify(report.body).slice(0, 200)}`)
        .toEqual([200, { color: { chartreuse: 1 } }]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P38.VA4 — a tenant without a vocabulary keeps today's free text
// ===========================================================================

describe('unit:P38.VA4', () => {
  it('host: LOCK — without a vocabulary the catalogue validator and the import keep today’s free text: the source words and the outside value are stored verbatim', async () => {
    const m = await mount('session', DOCS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const imported = await importCatalog(m, [...CATALOGUE, SOURCE_WORDED, OUTSIDE]);
    expect(imported.status, `P38.VA4 — the import is admitted as today: ${JSON.stringify(errorsOf(imported))}`).toBe(200);
    // LOCKED (src/content/kinds.ts:79-95; src/content/import.ts:20-34): tags are free text, kept as sent.
    expect([await storedPiece(m, SOURCE_WORDED.id), await storedPiece(m, OUTSIDE.id)], 'P38.VA4 — stored verbatim').toEqual([SOURCE_WORDED.tags, OUTSIDE.tags]);
  }, 120_000);

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — without a vocabulary the ingest decides as today: on a dimension the published catalogue names values on, only those values build interest (R64), so the source words build none and the catalogue's own value does`, async () => {
      const m = await mount(host, DOCS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const s = await visitorOn(m);
      expect((await s.action(VIEW_SOURCE_WORDED)).status, `${host}: PRECONDITION — accepted`).toBe(200);
      expect((await s.action(VIEW_OUTSIDE)).status, `${host}: PRECONDITION — accepted`).toBe(200);
      // LOCKED (src/reflex/core.ts:451-470): the catalogue names category {bags, shoes}, productType {crossbody, tote,
      // sneaker}, color {black, brown_tan, neutral}, occasion {evening, everyday}; slg, wallet, cognac, night out and
      // chartreuse are outside it, bags is inside.
      expect(await interestKeys(m, s), `${host}: P38.VA4 — today's ingest, term for term`).toEqual({ category: ['bags'] });
    }, 120_000);

    it(`host (${host}): LOCK — without a vocabulary the P02 page decides as P02 receipted it: the declared layout slot serves the first four eligible modules in catalogue order`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() });
      expect(m.refused, 'PRECONDITION: the declared layout slot (P02) publishes').toBeNull();
      const s = await shopperOn(m);
      // LOCKED (P02.A2, as src/units/P01/LEDGER.unit.test.ts:94 derives it): the slot's own cold decision.
      expect(servedIn(await s.snapshot('pdp', { pageInstance: pageInstanceOf('p38-va4') }), LAYOUT), `${host}: P38.VA4 — the P02 layout`)
        .toEqual([M.grid, M.reco1, M.reco2, M.editorial]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P38.VA5 — the kit documents the schema, the table, the approval, the report
// ===========================================================================

describe('unit:P38.VA5', () => {
  it('logic: docs/kit/02-api-reference.md and docs/kit/03-payload-schemas.md document the vocabulary schema, the mapping table, the approval step and the rejection report', () => {
    const missing: string[] = [];
    for (const file of ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']) {
      const lines = readTree(file).split('\n');
      const has = (...words: string[]) => lines.some(line => words.every(w => line.includes(w)));
      if (!has('/content/vocabulary')) missing.push(`${file}: the vocabulary document's route`);
      if (!has('synonyms', 'parent')) missing.push(`${file}: the schema (values with id, name, synonyms; a product type's parent)`);
      if (!has('synonym', 'mapping')) missing.push(`${file}: the mapping table (an id to itself, a synonym to its id)`);
      if (!has('effectiveRevision') || !has('/approve')) missing.push(`${file}: the approval step and the effective revision`);
      if (!has('/content/vocabulary/rejections')) missing.push(`${file}: the rejection report`);
    }
    expect(missing, 'P38.VA5 — the kit documents the vocabulary').toEqual([]);
  });
});
