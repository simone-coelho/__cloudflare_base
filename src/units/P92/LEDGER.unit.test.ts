// src/units/P92/LEDGER.unit.test.ts
// P92 under the Closure Ledger (programme `tapestry-parity-activation`, amendment 11, item E17): the tests for the LOCAL
// criteria RG1–RG3 of the P92 work order (docs/parity/activation/program.json). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md, E17):
//   "#### E17 · Small registrations the content pack relies on
//    - **Done when:** the interim `journeyStage:post_purchase` tag and the `locale` tag are registered for the Coach tenant
//      so a load does not warn on them; the module register's `purpose_later` field is accepted and ignored until the
//      semantic term exists; a record with no format falls back to its type as the tagging guide says (check, and correct
//      whichever is wrong).
//    - **Needed by:** the first dataset. Hours."
// The content pack (the Windows checkout, read as documents only; docs/tapestry-packs/2-content-and-cms/):
// 01-value-list-notes.md:82 and :91–94 ("Post-purchase is carried as the tag `journeyStage:post_purchase`"; "`locale` is
// market and language. It decides where a record may be shown and is never learned as taste. `en-US` and `en-CA` are
// listed as synonyms, so either spelling loads"; the table's row: "A gate, never a taste"), 02-content-and-image-record-
// schema.md:30 (`tags.locale`, "Market and language", example `en_us`) and :40 (`tags.journeyStage`, `post_purchase`,
// "Content made for after an order"), 03-module-register-template.md:26–27 ("Optional, for later: `purpose_later`, one
// sentence of what the module is for, written for the engine and never shown on the page"), 06-tagging-guide.md:19–20
// ("Without it the engine falls back to the record's rendering kind, such as `image`, as its format").
//
// THE READINGS (the lead's provisional readings of the brief, S27, as the specifier proposed them; ruled R-P316, all seven):
//   1  A REGISTERED TAG THAT IS NOT AN INTEREST. The reflex registry document (`PUT /config/reflex`, src/reflex/core.ts
//      ReflexConfig; validated by src/reflex/configStore.ts validateReflexConfig) gains the optional member
//      `gateDimensions`: a list of tag dimension keys registered as gates. Proposed and read loosely here (no new export):
//      1 to 64 keys, each 1..64 characters, trimmed, none of `:` `;` `|`, no reserved key, no duplicate, and none of them a
//      key of `dimensions` (a dimension is learned or a gate, never both); anything else is refused by name
//      (`gateDimensions…`). (a) The catalogue diagnostics (src/content/catalogDiagnostics.ts) raise no `unknown_dimension`
//      for a gate key, read from the registry in force exactly as `dimensions` is (the registration is the document's, so a
//      registry without the member warns for the same tags as today). (b) Nothing learns it: a gate is not a `dimensions`
//      entry, so no event, content engagement or module engagement builds interest on it (the shopper's profile carries
//      none). (c) A gate value does not count as a nonblank registered tag for `no_nonempty_registered_tags` (it is never
//      matched against an interest): a record tagged only with `locale` is still named so. (d) It gates as any tag does
//      and no more: a slot's `excludedTags` pair on it, and an approved vocabulary (P38) listing it, apply unchanged; the
//      engine has no shopper locale to match a record's locale against (TOLD below). `journeyStage` is not registered in
//      the demo's starting document today (its `dimensions` are line, category, subcategory, silhouette, occasion,
//      priceBand, contentType), so `journeyStage:post_purchase` is registered the same way: the starting document (the
//      compiled default of the `coach` scope, src/reflex/configStore.ts compiledDefaultFor, src/reflex/core.ts
//      DEFAULT_REFLEX_CONFIG) carries `gateDimensions` naming `journeyStage` and `locale`, its `dimensions` unchanged.
//   2  `purpose_later` is accepted and ignored on a JSON import, a CSV import and a pull: nothing stored, no
//      `ignored_field`; any other field the contract does not list is still named `ignored_field` with its `recordIndex`.
//      A direct PUT or a validation keeps the validator's own closed field set and still names it `ignored_field`
//      (R-P316 (5): a lock, and the kit's `purpose_later` row says so).
//   3  A record with no `contentType` tag takes its `type` as its format where the registry's `contentType` dimension is
//      not derived and the catalogue has not retired the fallback (src/content/typeAffinity.ts contentTypeValues;
//      src/reflex/contentTelemetry.ts resolvedContentTouches): a lock, as the tagging guide says, and both conditions shown.
//   4  Nothing else in the diagnostics, the import or the registry changes (the W19, P82, P38, P02, P08 and content tests
//      are locks; see MEASURED).
//
// TOLD, not a leg: the pack says a record's locale "decides where a record may be shown"; the engine has no shopper
// locale or market in a decision's context to gate on (eligibleWhen names regions and the engine's own signals), so a
// `locale` tag gates only as any tag does (an `excludedTags` pair, a vocabulary); a market gate per shopper exists today
// as `eligibleWhen.regions` (country keys). The tagging guide states the type fallback without its two conditions (a
// non-derived `contentType` dimension, no `typeFallback: "retired"` marker): the guide's wording is the documents lane's.
// The registry diagnostics count the fallback for `no_nonempty_registered_tags` whatever the retirement marker says
// (catalogDiagnostics.ts, the `implicitType` line), unlike decisions and learning: observed, not changed (reading 4).
// DEFERRED, with the reason: LV1 (the deployed hosts); publishing the registration on a provisioned tenant is an operator
// step outside amendment 11 (§4.5), the tenant being parked (§3 decision 3). The id `coach` appears here only as an id.
// COLLISIONS (the whole suite under the sketch, logs/b/compare.txt), each with the ruling it needs:
//   · src/units/W19/B2.unit.test.ts TENANT_REGISTRY and REGISTRY_WITHOUT_LOCALE (the two fixtures spreading
//     DEFAULT_REFLEX_CONFIG) inherit `gateDimensions: ['journeyStage', 'locale']` while TENANT_REGISTRY learns `locale`:
//     R-P316 (1) refuses the baseline ("Invalid baseline configuration"), so W19.L1.01–L1.03, S1.01 and S1.02 fail; and
//     REGISTRY_WITHOUT_LOCALE would carry the `locale` gate, silencing the `unknown_dimension` W19.L1.01 expects. R10
//     GRANTED (R-P322) and written: both fixtures copy DEFAULT_REFLEX_CONFIG without its `gateDimensions`.
//   · src/units/W20/LEDGER.unit.test.ts TENANT_REGISTRY (DEFAULT_REFLEX_CONFIG spread, `locale` learned): the same refusal,
//     W20.R1–R5 fail. The same R10, granted (R-P322) and written.
//   · src/units/P10/LEDGER.unit.test.ts, unit:P10.F2 host (session): its CONTROL "at floor 0 the slot explores" answered false
//     under the sketch in one suite run; re-run three times on each tree, 14/14 every time: the control reads a fresh
//     shopper's rotation pick, hashed on the visitor's bucket, not the default document's content. TOLD (R-P322 (2)).
// R10 (R-P322, test-only, R-P195's form, fixtures only, every assertion unchanged): src/units/W19/B2.unit.test.ts
// TENANT_REGISTRY (REGISTRY_WITHOUT_LOCALE copies it) and src/units/W20/LEDGER.unit.test.ts TENANT_REGISTRY copy
// DEFAULT_REFLEX_CONFIG without its `gateDimensions`: a stored registry does not inherit the default's gates, and one that
// learns `locale` registers no gate for it (the validator keeps its rule). NO NEW EXPORT IS IMPORTED.
//
// MEASURED (_evidence/parity-step3/S27/specifier/logs/, serial, --no-cache, working directory the tree). At e16d0420 (logs/d/):
// today 11 RED for the missing behaviour — RG1's starting document (no `gateDimensions`), the import legs (journeyStage
// and locale warn: five `unknown_dimension` where one is expected), the registry-document legs (styleWorld still warns as
// a gate), the refusal legs (every malformed registration validates) and its kit leg; RG2's three legs (`purpose_later`
// named `ignored_field`; the kit silent) — and 6 LOCKS GREEN (RG1's never-learned and gating legs, RG3's fallback legs);
// the fix 17/17 three times; `gatecounts` (a gate value counted as a nonblank registered tag) RG1's import legs (2);
// W19 B2 and W20 under the R10s 14/14 on today and under the fix; P10 14/14 three times on each tree (P10.F2's control
// reads a fresh shopper's rotation pick, hashed on the visitor's bucket: the one RED of the whole-suite run below did not
// recur, TOLD per R-P322 (2)); tsc exit 0 on today and under the fix. At 511aa9cd (logs/b/): the wrong fixes
// (sketches/p92.py) — `learned` (journeyStage and locale learned dimensions) RG1's logic, import, registry-document,
// refusal and never-learned legs (9); `silenceall` the import and registry-document legs (4); `storepurpose` and
// `ignoreall` RG2's host legs (2 each); `diagonly` (the registration hard-coded in the diagnostics) RG1's logic,
// registry-document and refusal legs (5); `docsonly` (the starting document alone) the import and registry-document legs
// (4); `kitleft` both kit legs (2); and the whole suite (compare.txt): 3926 tests on both trees, failing under the fix
// alone 11 (W19 B2 5 and W20 5, the R10s above; P10.F2 session 1, not recurring), failing today alone the 11 P92 tests.
// At a9b487ce (logs/a/): the locks (W19, P82, P38, P02, P08, P32, the content route, import, complements, kinds and
// seedPlatform tests, configStore.test.ts) 199/199 today and 194/199 under the fix (W19 B2's five, before the R10).
//
// HARNESS: src/units/_parity.ts and src/units/_parity5.ts (the mounted app, both shopper hosts, the operator routes).
// Imports from src/units/: ../_parity, ../_parity5.

import { describe, expect, it, vi } from 'vitest';

import { compiledDefaultFor, reflexScopeForTenant, validateReflexConfig } from '@/reflex/configStore';

import { asOperator, expectPublished, HOSTS, loadDocument, mount, putDocument, readTree, REFLEX_DOCUMENT, shopperOn, TENANT,
  type Answer, type Mounted, type Shopper } from '../_parity';
import { HERO, HOME, HOME_PIECES, homeLearn, homeSlots, putKind, readKind } from '../_parity5';

/** The member this file proposes (reading 1), read loosely. */
const GATES = 'gateDimensions';
const piece = (id: string, tags: Record<string, string[]>, extra: Record<string, unknown> = {}) =>
  ({ id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'editorial', title: `Story ${id}`, tags, slotTypes: [HERO], ...extra });
/** A record tagged as the pack says: post-purchase content (02 :40), its format explicit (06 :19). */
const AFTER_ORDER = piece('story.after-order', { category: ['Bags'], journeyStage: ['post_purchase'], contentType: ['editorial'] });
/** Two market records (02 :30): the US one and the Canadian one. */
const MARKET_US = piece('story.market-us', { category: ['Bags'], locale: ['en_us'] });
const MARKET_CA = piece('story.market-ca', { category: ['Bags'], locale: ['en_ca'] });
/** Unknown input: a dimension no registry names, which still warns. */
const DOWNTOWN = piece('story.downtown', { category: ['Bags'], styleWorld: ['downtown'] });
/** A record tagged only with a gate: nothing on it can match an interest (reading 1 (c)), read under a registry with no content
 * format (no `contentType` dimension), where its type is no fallback format either (the diagnostics count the fallback). */
const ONLY_MARKET = piece('story.only-market', { locale: ['en_us'] });
const DOCS = { pieces: [...HOME_PIECES], slots: homeSlots(), learn: homeLearn() };
/** The registry in force without the member (a tenant that registers no gate) and with `styleWorld` added as a gate. */
const { [GATES]: _registered, ...WITHOUT_GATES } = REFLEX_DOCUMENT as unknown as Record<string, unknown>; void _registered;
const WITH_STYLE_GATE = { ...WITHOUT_GATES, version: 'p92-style-gate', [GATES]: ['journeyStage', 'locale', 'styleWorld'] };
/** The registry in force without its content-format dimension (its gates, if any, kept). */
const NO_FORMAT = { ...REFLEX_DOCUMENT, version: 'p92-no-format', dimensions: REFLEX_DOCUMENT.dimensions.filter(d => d.key !== 'contentType') };

const preconditions = async (m: Mounted) => {
  const base = await loadDocument(m, 'catalog');
  return { 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` };
};
/** `POST /content/catalog/import`, JSON, merge (P82's harness). */
const importJson = async (m: Mounted, records: unknown[]) =>
  asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}&mode=merge`, records, await preconditions(m));
/** The same as CSV over `columns` (tags `dimension:value|value;…`; P82's harness, the columns named). */
async function importCsv(m: Mounted, rows: Array<Record<string, unknown>>, columns: string[]): Promise<Answer> {
  const cell = (v: unknown) => { const s = v === undefined ? '' : Array.isArray(v) ? v.join('|') : typeof v === 'object' && v !== null
    ? Object.entries(v).map(([d, values]) => `${d}:${(values as string[]).join('|')}`).join(';') : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const body = [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\n') + '\n';
  const response = await m.fetch(new Request(`https://ops.invalid/content/catalog/import?scope=${TENANT}&format=csv&mode=merge`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'Content-Type': 'text/csv', ...await preconditions(m) }, body }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}
const FEED_URL = 'https://cms.example.invalid/p92-feed.json';
/** `POST /content/catalog/pull` of a feed `{ content: records }` answered by a stubbed fetch of its URL (P82's harness). */
async function pull(m: Mounted, records: unknown[]): Promise<Answer> {
  const original = globalThis.fetch;
  const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input) === FEED_URL ? new Response(JSON.stringify({ content: records }), { headers: { 'Content-Type': 'application/json' } }) : original(input, init));
  try { return await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, { url: FEED_URL, path: 'content', mode: 'merge', note: 'p92 pull' }, await preconditions(m)); }
  finally { stub.mockRestore(); }
}
type Warned = { code: string; recordIndex?: number; recordId?: string; dimension?: string; field?: string };
const warningsOf = (a: Answer) => (((a.body.diagnostics as { warnings?: Warned[] | null } | undefined)?.warnings) ?? []);
const countsOf = (a: Answer) => (((a.body.diagnostics as { counts?: Record<string, number> | null } | undefined)?.counts) ?? {});
/** Each `unknown_dimension` warning as [record id, dimension]. */
const unknownDimensions = (a: Answer) => warningsOf(a).filter(w => w.code === 'unknown_dimension').map(w => [w.recordId ?? 'no recordId', w.dimension]);
const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
const storedPiece = async (m: Mounted, id: string) => ((await loadDocument(m, 'catalog')).document.pieces as Array<Record<string, unknown>>).find(p => p.id === id);
/** The values the shopper's interest holds per dimension, from the SDK-visible hydrate (P38's reader). */
async function interestKeys(m: Mounted, s: Shopper): Promise<Record<string, string[]>> {
  const read = await s.hydrate();
  expect(read.status, `${m.host}: PRECONDITION — the hydrate answers`).toBe(200);
  const dims = ((read.body.affinity as { dims?: Record<string, Record<string, number>> } | null)?.dims ?? {});
  return Object.fromEntries(Object.entries(dims).map(([dim, values]) => [dim, Object.keys(values).sort()]).filter(([, values]) => values.length));
}

/** The kit's paragraphs and table rows (P83's reader). */
const KIT02 = () => readTree('docs/kit/02-api-reference.md'), KIT03 = () => readTree('docs/kit/03-payload-schemas.md');
const paragraphs = (text: string) => text.split(/\n\s*\n/).map(p => p.split('\n').join(' '));
const has = (text: string, ...words: Array<string | RegExp>) => paragraphs(text).some(p => words.every(w => typeof w === 'string' ? p.includes(w) : w.test(p)));
const row = (text: string, field: string, ...words: RegExp[]) => text.split('\n').some(l => l.startsWith(`| \`${field}\``) && words.every(w => w.test(l)));

// ===========================================================================
// unit:P92.RG1 — journeyStage and locale registered as gates: no warning, never learned
// ===========================================================================

describe('unit:P92.RG1', () => {
  it('logic: the demo\'s starting document (the compiled default of the coach scope) registers journeyStage and locale as gate dimensions and is valid; its learned dimensions are today\'s (LOCK)', async () => {
    const start = await compiledDefaultFor(reflexScopeForTenant(TENANT)) as unknown as Record<string, unknown> & { dimensions: Array<{ key: string }> };
    const gates = start[GATES];
    expect.soft(Array.isArray(gates) ? [...gates as string[]].sort() : `no ${GATES} on the starting document (${Object.keys(start).join(', ')})`,
      'P92.RG1 — the starting document registers journeyStage and locale as gates (today it registers neither)').toEqual(['journeyStage', 'locale']);
    expect.soft(validateReflexConfig(start).ok, 'P92.RG1 — the starting document is valid under the validator').toBe(true);
    expect.soft(start.dimensions.map(d => d.key), 'P92.RG1 — LOCK: the learned dimensions are today\'s, neither gate among them')
      .toEqual(['line', 'category', 'subcategory', 'silhouette', 'occasion', 'priceBand', 'contentType']);
  });

  for (const host of HOSTS) {
    it(`host (${host}): a JSON and a CSV import of records tagged journeyStage:post_purchase and locale raise no unknown_dimension for them; a dimension no registry names still warns, and a record tagged only with a gate is still named no_nonempty_registered_tags (LOCK, R-P316 (3))`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P92.RG1 — the tenant documents publish');
      const json = await importJson(m, [AFTER_ORDER, MARKET_US, MARKET_CA, DOWNTOWN, ONLY_MARKET]);
      expect(json.status, `${host}: PRECONDITION — the JSON import is accepted (${show(json)})`).toBe(200);
      const n = await mount(host, DOCS);
      expectPublished(n, 'P92.RG1 — the tenant documents publish');
      const csv = await importCsv(n, [AFTER_ORDER, MARKET_US, MARKET_CA, DOWNTOWN, ONLY_MARKET], ['id', 'customerContentId', 'type', 'title', 'tags', 'slotTypes']);
      expect(csv.status, `${host}: PRECONDITION — the CSV import is accepted (${show(csv)})`).toBe(200);
      for (const [name, answer] of [['JSON', json], ['CSV', csv]] as Array<[string, Answer]>) {
        expect.soft([unknownDimensions(answer), countsOf(answer).unknown_dimension],
          `${host}: P92.RG1 — ${name}: the one unknown_dimension is the dimension no registry names (today journeyStage and locale warn too)`).toEqual([[['story.downtown', 'styleWorld']], 1]);
      }
      // R-P316 (3): a gate value is not a nonblank registered tag (read where the type supplies no fallback format).
      const bare = await mount(host, { ...DOCS, reflex: NO_FORMAT });
      expectPublished(bare, 'P92.RG1 — a registry with no content-format dimension publishes');
      const onlyGate = await importJson(bare, [ONLY_MARKET, MARKET_US]);
      expect(onlyGate.status, `${host}: PRECONDITION — the import is accepted (${show(onlyGate)})`).toBe(200);
      expect.soft(warningsOf(onlyGate).filter(w => w.code === 'no_nonempty_registered_tags').map(w => w.recordId),
        `${host}: P92.RG1 — LOCK: a record tagged only with a gate has nothing an interest can match; the US record's category does`).toEqual(['story.only-market']);
    }, 120_000);

    it(`host (${host}): the registration is the registry document's: a registry that registers no gate warns for journeyStage and locale as today (LOCK), and one that registers styleWorld as a gate raises nothing for it`, async () => {
      const without = await mount(host, { ...DOCS, reflex: WITHOUT_GATES });
      const style = await mount(host, { ...DOCS, reflex: WITH_STYLE_GATE });
      expectPublished(without, 'P92.RG1 — a registry without gates publishes'); expectPublished(style, 'P92.RG1 — a registry with three gates publishes');
      const a = await importJson(without, [AFTER_ORDER, MARKET_US, DOWNTOWN]), b = await importJson(style, [AFTER_ORDER, MARKET_US, DOWNTOWN]);
      expect([a.status, b.status], `${host}: PRECONDITION — both imports are accepted (${show(a)} / ${show(b)})`).toEqual([200, 200]);
      expect.soft({ without: unknownDimensions(a), style: unknownDimensions(b) }, `${host}: P92.RG1 — the diagnostics read the gates from the registry in force (today styleWorld still warns)`).toEqual({
        without: [['story.after-order', 'journeyStage'], ['story.market-us', 'locale'], ['story.downtown', 'styleWorld']], style: [] });
    }, 120_000);

    it(`host (${host}): publication refuses a malformed gate registration by name — a gate that is also a learned dimension, a duplicate, an empty key, a list that is not one, an empty list, a key carrying a tag separator, an untrimmed key, a key over 64 characters, a reserved key, more than 64 keys (R-P326) — and admits a well-formed one`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P92.RG1 — the tenant documents publish');
      const check = async (gates: unknown) => {
        const answer = await asOperator(m, 'POST', '/config/reflex/validate', { config: { ...WITHOUT_GATES, [GATES]: gates } });
        const errors = ((answer.body.errors ?? []) as unknown[]).map(String);
        return [answer.status, errors.some(e => e.includes(GATES)) ? 'named' : `not named (${JSON.stringify(answer.body).slice(0, 200)})`];
      };
      expect.soft({ learned: await check(['locale', 'category']), duplicate: await check(['locale', 'locale']), empty: await check(['']), notAList: await check('locale') },
        `${host}: P92.RG1 — each refused by name (today the member is not read: every one validates)`).toEqual({
        learned: [422, 'named'], duplicate: [422, 'named'], empty: [422, 'named'], notAList: [422, 'named'] });
      // R-P326: the rest of R-P316 (1)'s rule — the list's bounds, the key's length and trimming, the tag separators, the reserved keys.
      expect.soft({ emptyList: await check([]), colon: await check(['loc:ale']), semicolon: await check(['loc;ale']), pipe: await check(['loc|ale']),
        untrimmed: await check([' locale ']), longKey: await check(['g'.repeat(65)]), reserved: await check(['constructor']),
        tooMany: await check(Array.from({ length: 65 }, (_, i) => `gate${i + 1}`)) },
      `${host}: P92.RG1 — each refused by name (R-P326; today the member is not read: every one validates)`).toEqual({
        emptyList: [422, 'named'], colon: [422, 'named'], semicolon: [422, 'named'], pipe: [422, 'named'],
        untrimmed: [422, 'named'], longKey: [422, 'named'], reserved: [422, 'named'], tooMany: [422, 'named'] });
      const ok = await asOperator(m, 'POST', '/config/reflex/validate', { config: { ...WITHOUT_GATES, [GATES]: ['journeyStage', 'locale'] } });
      expect(ok.status, `${host}: P92.RG1 — a well-formed registration validates (${show(ok)})`).toBe(200);
    }, 120_000);

    it(`host (${host}): a gate is never learned: a product view and a content click carrying locale and journeyStage build interest on category and on the clicked record's format, and on neither gate`, async () => {
      const m = await mount(host, { pieces: [AFTER_ORDER, MARKET_US, MARKET_CA], slots: homeSlots(), learn: homeLearn() });
      expectPublished(m, 'P92.RG1 — the tenant documents publish');
      const s = await shopperOn(m);
      const view = await s.action({ type: 'product_view', data: { productId: 'p92-unlisted-bag', category: 'Bags', locale: 'en_us', journeyStage: 'post_purchase' } });
      expect([view.status, view.body.success], `${host}: PRECONDITION — the product view is accepted and processed (${show(view)})`).toEqual([200, true]);
      const page = await s.snapshot(HOME);
      const us = page.decisions.find(d => d.contentId === MARKET_US.id);
      expect(us, `${host}: PRECONDITION — the US record is served (${show(page)})`).toBeDefined();
      const click = await s.click(page, us!, { locale: 'en_us', journeyStage: 'post_purchase' });
      expect(click.status, `${host}: PRECONDITION — the click is accepted (${show(click)})`).toBe(200);
      expect.soft(await interestKeys(m, s), `${host}: P92.RG1 — the profile holds category (from the view) and the clicked record's format (its type, no contentType tag), and no gate`)
        .toEqual({ category: ['Bags'], contentType: ['editorial'] });
    }, 120_000);

    it(`host (${host}): LOCK — a gate gates as any tag does: a slot excluding the pair locale:en_ca serves the US record and not the Canadian one; under an approved vocabulary listing locale with its synonyms, en-US is stored as en_us and fr_fr is refused by name`, async () => {
      const m = await mount(host, { pieces: [MARKET_US, MARKET_CA], slots: { version: 'p92-slots', governanceVersion: 3, pages: { [HOME]: [{ slot: HERO, take: 2, weights: { category: 1 }, excludedTags: [{ dimension: 'locale', value: 'en_ca' }] }] } }, learn: homeLearn() });
      expectPublished(m, 'P92.RG1 — the slot excluding locale:en_ca publishes');
      const served = (await (await shopperOn(m)).snapshot(HOME)).decisions.filter(d => d.slot === HERO).map(d => d.contentId);
      const v = await mount(host, DOCS);
      expectPublished(v, 'P92.RG1 — the tenant documents publish');
      expect((await putKind(v, 'vocabulary', { version: 'p92-vocabulary', attributes: { locale: { values: [{ id: 'en_us', name: 'United States, English', synonyms: ['en-US'] },
        { id: 'en_ca', name: 'Canada, English', synonyms: ['en-CA'] }] } } }, 'p92 vocabulary')).status, 'PRECONDITION: the vocabulary publishes').toBe(200);
      const base = await readKind(v, 'vocabulary');
      const publication = base.body.publication as { revision: number; digest: string };
      expect((await asOperator(v, 'POST', `/content/vocabulary/approve/1?scope=${TENANT}`, {}, { 'If-Match': `"${base.body.revision as number}/${publication.revision}/${publication.digest}"`,
        'Idempotency-Key': `1:${crypto.randomUUID()}` })).status, 'PRECONDITION: the vocabulary is approved').toBe(200);
      const synonym = await importJson(v, [{ ...MARKET_US, tags: { category: ['Bags'], locale: ['en-US'] } }]);
      const storedUs = await storedPiece(v, MARKET_US.id);
      const outside = await importJson(v, [{ ...MARKET_CA, tags: { category: ['Bags'], locale: ['fr_fr'] } }]);
      const errors = ((outside.body.errors ?? []) as unknown[]).map(String);
      expect.soft({ served, synonym: [synonym.status, (storedUs?.tags as Record<string, string[]> | undefined)?.locale ?? 'not stored'],
        outside: [outside.status, errors.some(e => e.includes('tags.locale') && e.includes('fr_fr')) ? 'named' : `not named (${JSON.stringify(errors).slice(0, 200)})`] },
      `${host}: P92.RG1 — LOCK: the exclusion and the vocabulary apply to locale as to any tag`).toEqual({ served: [MARKET_US.id], synonym: [200, ['en_us']], outside: [422, 'named'] });
    }, 120_000);
  }

  it('logic: kit 02\'s diagnostics paragraph names the gate registration beside unknown_dimension, and kit 03 states the registry member (journeyStage and locale registered, never learned); today\'s tags row stands (LOCK)', () => {
    const kit02 = KIT02(), kit03 = KIT03();
    expect.soft({
      kit02Diagnostics: has(kit02, '`unknown_dimension` means', `\`${GATES}\``),
      kit03Gates: has(kit03, `\`${GATES}\``, '`locale`', '`journeyStage`', /never learned|not learned|never an interest|no interest/i),
    }, 'P92.RG1 — the kit states the gate registration (today it does not)').toEqual({ kit02Diagnostics: true, kit03Gates: true });
    expect(kit03.includes('| `tags` | yes | `{ dimension: [values] }` on the brand\'s registry'), 'P92.RG1 — LOCK: the tags row stands').toBe(true);
  });
});

// ===========================================================================
// unit:P92.RG2 — purpose_later accepted and ignored on every import path
// ===========================================================================

describe('unit:P92.RG2', () => {
  const WITH_PURPOSE = { ...AFTER_ORDER, purpose_later: 'Reassures a shopper who has just ordered, with care for the bag.' };
  const WITH_NOTES = { ...MARKET_US, notes: 'internal: legal checked' };
  for (const host of HOSTS) {
    it(`host (${host}): a JSON import, a CSV import and a pull carrying purpose_later store the record without it and name no ignored_field for it; another field the contract does not list is still named ignored_field with its recordIndex, and a direct PUT still names purpose_later ignored_field (LOCKS, R-P316 (5))`, async () => {
      const answers: Array<[string, Answer, Record<string, unknown> | undefined]> = [];
      const json = await mount(host, DOCS); expectPublished(json, 'P92.RG2 — the tenant documents publish');
      const a = await importJson(json, [WITH_PURPOSE, WITH_NOTES]);
      answers.push(['JSON', a, await storedPiece(json, AFTER_ORDER.id)]);
      const csv = await mount(host, DOCS); expectPublished(csv, 'P92.RG2 — the tenant documents publish');
      const b = await importCsv(csv, [WITH_PURPOSE, WITH_NOTES], ['id', 'customerContentId', 'type', 'title', 'tags', 'slotTypes', 'purpose_later', 'notes']);
      answers.push(['CSV', b, await storedPiece(csv, AFTER_ORDER.id)]);
      const pulled = await mount(host, DOCS); expectPublished(pulled, 'P92.RG2 — the tenant documents publish');
      const c = await pull(pulled, [WITH_PURPOSE, WITH_NOTES]);
      answers.push(['pull', c, await storedPiece(pulled, AFTER_ORDER.id)]);
      for (const [name, answer, stored] of answers) {
        expect(answer.status, `${host}: PRECONDITION — ${name}: the write is accepted (${show(answer)})`).toBe(200);
        expect.soft({ ignored: warningsOf(answer).filter(w => w.code === 'ignored_field').map(w => [w.recordIndex, w.field]),
          stored: stored ? { id: stored.id, purpose_later: Object.hasOwn(stored, 'purpose_later') ? 'stored' : 'not stored' } : 'the record is not stored' },
        `${host}: P92.RG2 — ${name}: purpose_later accepted and ignored (today named ignored_field); notes still named at its record (LOCK: a CSV column is carried by every row)`).toEqual({
          ignored: name === 'CSV' ? [[0, 'notes'], [1, 'notes']] : [[1, 'notes']], stored: { id: AFTER_ORDER.id, purpose_later: 'not stored' } });
      }
      // R-P316 (5): a direct PUT keeps the validator's closed field set: the record at position 4 of the request is named.
      const put = await putDocument(json, 'catalog', { version: 'p92-put', pieces: [...HOME_PIECES, WITH_PURPOSE] }, 'p92 put');
      expect.soft([put.status, warningsOf(put).filter(w => w.code === 'ignored_field').map(w => [w.recordIndex, w.field])],
        `${host}: P92.RG2 — LOCK: a direct PUT still names purpose_later as ignored_field`).toEqual([200, [[4, 'purpose_later']]]);
    }, 120_000);
  }

  it('logic: kit 03\'s field table and its ignored_field paragraph state purpose_later accepted and ignored on import and pull, and still named ignored_field on a direct PUT; kit 02\'s ignored_field sentence stands (LOCK)', () => {
    const kit02 = KIT02(), kit03 = KIT03();
    expect.soft({ fieldRow: row(kit03, 'purpose_later', /accepted and ignored/i, /not stored/i, /PUT/, /`ignored_field`/), ignoredParagraph: has(kit03, 'Nothing above is silently dropped', '`purpose_later`') },
      'P92.RG2 — the kit states purpose_later (today it does not)').toEqual({ fieldRow: true, ignoredParagraph: true });
    expect(kit02.includes('`ignored_field` means the request carried a field (JSON) or column (CSV) the published contract does not list'),
      'P92.RG2 — LOCK: the ignored_field sentence stands').toBe(true);
  });
});

// ===========================================================================
// unit:P92.RG3 — a record with no format takes its type, on the two conditions
// ===========================================================================

describe('unit:P92.RG3', () => {
  /** HOME_PIECES' third piece: type `video`, no `contentType` tag. */
  const FILM = 'story.summit';
  const DERIVED_FORMAT = { ...REFLEX_DOCUMENT, version: 'p92-derived-format', dimensions: [...REFLEX_DOCUMENT.dimensions.filter(d => d.key !== 'contentType'),
    { key: 'contentType', source: 'contentType', derive: 'band', cuts: [1], labels: ['short', 'long'] }] };
  async function formatTaught(m: Mounted): Promise<string[]> {
    const s = await shopperOn(m);
    const page = await s.snapshot(HOME);
    const film = page.decisions.find(d => d.contentId === FILM);
    expect(film, `${m.host}: PRECONDITION — the film is served (${show(page)})`).toBeDefined();
    expect((await s.click(page, film!)).status, `${m.host}: PRECONDITION — the click on the film is accepted`).toBe(200);
    return (await interestKeys(m, s)).contentType ?? [];
  }
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a click on a record with no contentType tag teaches its type as its format where the registry's contentType is not derived and the catalogue keeps the fallback; under the catalogue's typeFallback retired, or a registry whose contentType is derived, it teaches no format`, async () => {
      const plain = await mount(host, DOCS);
      expectPublished(plain, 'P92.RG3 — the tenant documents publish');
      const retired = await mount(host, DOCS);
      expectPublished(retired, 'P92.RG3 — the tenant documents publish');
      const marked = await putDocument(retired, 'catalog', { version: 'p92-retired', typeFallback: 'retired', pieces: [...HOME_PIECES] }, 'p92 retired');
      expect(marked.status, `${host}: PRECONDITION — the catalogue with the marker publishes (${show(marked)})`).toBe(200);
      const derived = await mount(host, { ...DOCS, reflex: DERIVED_FORMAT });
      expectPublished(derived, 'P92.RG3 — a registry with a derived contentType publishes');
      expect.soft({ fallback: await formatTaught(plain), retired: await formatTaught(retired), derived: await formatTaught(derived) },
        `${host}: P92.RG3 — LOCK: the type is the format only on the two conditions (src/content/typeAffinity.ts contentTypeValues)`).toEqual({ fallback: ['video'], retired: [], derived: [] });
    }, 180_000);
  }
});
