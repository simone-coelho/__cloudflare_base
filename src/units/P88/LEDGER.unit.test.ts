// src/units/P88/LEDGER.unit.test.ts
// P88 under the Closure Ledger (programme `tapestry-parity-activation`, amendment 11, item E13): the tests for the LOCAL
// criteria AL1–AL3 of the P88 work order (docs/parity/activation/program.json). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md:105–109, E13):
//   "#### E13 · Approved layouts enforced as a publication rule (N2)
//    - **Authority:** the rendering brief's rules; the rendering record's N2.
//    - **Done when:** a context order for a page is refused at publication unless it is one of the page's approved layouts;
//      the approved set is a published, versioned document.
//    - **Needed by:** the first activation. Hours."
// R-P70 kept N2 and its console display out of force; R-P245 puts the publication rule in force through E13; the console's
// display of the set stays outside this ticket.
//
// THE READINGS (the lead's, provisional, SPEC-BRIEF-P88.md, R-P446; each shown by the leg named):
//   1  AL1, the document: a new OPTIONAL member kind `layouts` at /content/layouts (P38's and P91's form: absent until published,
//      its first PUT over revision 0 with If-Match "0/{set revision}/{set digest}", then history, revisions, validate and rollback
//      as the other documents; a member of publicationChanges; never required by W08's initialize; admitted by the customer
//      boundary's :kind pattern; named in UNKNOWN_KIND's sentence). Shape `{ version?: 1, pages: { page: { any|mobile|desktop:
//      [ { modules: [id…] } ] } } }`, each layout 1 to 50 distinct ids; refused 422 naming the page, the device and the index (a
//      device outside the three words, an empty or repeating list, two identical layouts under one device, a member outside the
//      schema); the catalogue NOT checked there; the read answers revision (0 absent), publication, source (stored|absent),
//      document (null absent).                                                   → AL1's lifecycle, refusal and customer legs
//   2  AL2, the rule: at the slots publication (PUT, its validate, its rollback, a slots member of publicationChanges), the layouts
//      of the set the publication is made over: each order's modules equal, as a sequence, one approved layout of its page for
//      its context — a device-named context its device's list plus `any`, a device-less context `any` alone — else 422 naming
//      the page, the context and the modules, nothing written; an approved order publishes exactly as today; a page the document
//      does not name and a tenant without the document keep today's behaviour (the strict form is the owner's call, told); a
//      layouts publication dropping a used layout is accepted (the slots' next publication and validate report it); shot orders
//      and the carousel are outside the rule.                                     → AL2's five legs
//   3  AL2, the diagnostics: the slots validate answers the same 422 without writing; a slots read is unchanged. → AL2
//   4  AL3, the kit: kit 02's document list names `layouts`; a /content/layouts paragraph in section 4 (the shape, the refusals,
//      the absent read, the first PUT's If-Match); the configured-order paragraph states the rule and its refusal; kit 03 the
//      layouts schema beside the slot document and one sentence in the per-context orders naming the rule. → AL3's kit leg
//   5  Locks: P01 O1–O5, P04, P37, P84, P38, P91 (publication.optionalMember), W08, P77, W19, the publication tests, routes/content,
//      P68; the console untouched; W40 P3/P4 (both typecheck forms, the 1536 MB one included).
//      The ticket's AL3 observable opens with "Locks: P01 O1–O5 and P04's pin rules unchanged for approved orders": AL3 carries
//      that lock leg beside the kit; AL2 re-runs P01.O1's decisions under an approving document.
//
// WHAT THE CODE OR THE BRIEF CONTRADICTS (told):
//   · Line references moved: ConfiguredOrder/OrderContext are src/content/types.ts:490–504 (the ticket says 440–452);
//     validateOrders src/content/kinds.ts:585, applied in validateSlotCatalog at :1229 (the ticket says :508, :1042).
//   · Kit 02 has no UNKNOWN_KIND sentence (it is the route's: src/routes/content.ts UNKNOWN_KIND); AL1 reads it in the 404 an
//     unknown kind answers. Kit 02's document list ("Four documents per brand …") names the vocabulary but not import-sources.
//   · Today a slots rollback re-checks nothing (versionedStore.rollback writes the old body forward); the rule adds the layouts
//     check to it (reading 2) and nothing else — the catalogue order check stays absent on a rollback.
//   · The slots PUT and validate check orders against the catalogue IN FORCE (orderRefusals → readPublication); the layouts rule
//     reads the set the publication is made over (reading 2). Shown: with a stale If-Match the request is refused 409 as today,
//     never 422 by a newer layouts revision.
//   · src/routes/content.test.ts W20.02 (":363", the slots validate's exact storage-call count, and the slots validate under a
//     storage fault in "W20.02 preserves slot activation and rollback …") constrains the build: the slots validate reads the
//     layouts document only for a candidate carrying orders (the sketch's first form, which read it always, turned both RED).
//   · A request whose publicationChanges carry both a layouts member and a slots member: which layouts its slots are checked
//     against is unruled; the sketch uses the request's own layouts member (R-P24's analogy); no leg.
//   · On a customer stamp the boundary refuses a `:kind` segment outside its lower-case list (404, every kind), as today.
//
// THE R10 SWEEP: no test pins the kind list, the boundary pattern, the optional-member set, the unknown-kind sentence or the
//   slots publication's path (grep of every *.test.ts / *.test.mjs: `kind must be catalog` appears only in the demo kit's own
//   sentence, scripts/demo-kit/lib/config.mjs:191; P77 lists `Vocabulary`, `vocabularies` and `p77-unknown` as refused kinds, not
//   `layouts`); no lock line moves. The W20.02 constraint above is met by the implementation, not by an R10.
//
// DEFERRED: LV1 (both deployed shopper hosts, the released artifact; the batched live acceptance).
// RESIDUALS (owed, told): the console's display of the approved set (N2's console part, outside E13); the strict form (refusing
//   every order on a tenant or page without a layouts document) is the owner's call; applying the rule to orders already
//   published happens only at their slots document's next publication (a dropped layout leaves the served order in force until
//   then); the `version` member admits 1 or absent (no leg on another value).
//
// MEASURED (_evidence/parity-step3/S35/specifier/logs/, serial, --no-cache, one worker, the scratch tree its working directory
// and root; trees built by mk.sh from 124d0916 with this file):
//   today (logs/a/today.log): 18 RED for the missing behaviour — the layouts kind unknown (GET/PUT /content/layouts 404
//     "kind must be catalog, slots, learn, priors, vocabulary or import-sources"; 404 at the customer boundary), and the kit
//     silent. Behind the first RED (logs/a2/w-norule.log: the kind built, the rule absent): AL2's refusal, device and set-pin
//     legs RED for the missing rule on both hosts; the approved-order leg and the no-document/shot-order leg green (they assert
//     today's behaviour under a document).
//   the sketch (sketches/p88.py on 124d0916): 18/18 twice in its final form (logs/a/fix-1.log, fix-2.log, final-fix.log) and once in
//     its first form (fix-probe.log); tsc exit 0 on it.
//   the wrong fixes (logs/a2/w-*.log), each RED on its own legs only: initrequired and noboundary the customer leg; dupsaccepted
//     and devicesunchecked the refusal leg; latestlayouts the set-pin leg; setcompare the refusal leg; anyreversed the device
//     leg; shotorders and nodocrefused the no-document/shot leg; kitleft the kit leg (each ×2 hosts where hosted).
//   the locks of reading 5 (logs/b/): 17 files 244/244 today; under the sketch 244/244 (fix-locks-r2.log; P37.DV3 failed once
//     under the machine's load in the first run and passed alone, logs/b/fix-p37-alone.log); W40.P3/P4 4/4 on the sketch.
//
// HARNESS: ../_parity (the mounted app, both shopper hosts, P01's product page), ../_parity5 (putKind, readKind) and
// ../W08/_customer (the in-process customer stamp). No new export is imported.

import { describe, expect, it, vi } from 'vitest';

// The customer stamp loads the real Worker (src/index.ts); the module doubles its harness names (src/units/W08/_customer.ts).
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { invalidatePublicationCache } from '@/config/publication';

import { asOperator, declaredSlots, errorsOf, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, loadSlots, M, MODULES, mount, PAGE_VIEW,
  PAID_SOCIAL_ENTRY, DIRECT_ENTRY, pageInstanceOf, putSlots, readTree, recentSlot, servedIn, shopperOn, TENANT, type Answer, type Mounted, type Shopper } from '../_parity';
import { putKind, readKind } from '../_parity5';
import { customerStamp, type Stamp } from '../W08/_customer';

// ── The fixture: P01's product page (src/units/P01/LEDGER.unit.test.ts) ─────────────────────────────────────────────
const PAGE = 'pdp';
const PAID_SOCIAL_FIRST = { channel: 'paid_social', visitBuckets: ['1'] };
const ANY_FIRST = { channel: 'any', visitBuckets: ['1'] };
const PAID_SOCIAL_MOBILE = { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' };
const EMAIL_DESKTOP = { channel: 'email', visitBuckets: 'any', device: 'desktop' };
/** P01's orders: each differs from catalogue order and from every ranking. */
const ORDER_A = [M.editorial, M.grid, M.ugc, M.reco1];
const ORDER_B = [M.reco2, M.reco1, M.grid, M.editorial];
const ORDER_C = [M.ugc, M.editorial, M.reco2, M.grid];
const BASE = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
const withOrders = (orders: unknown[], over: Record<string, unknown> = {}) => declaredSlots([layoutSlot({ orders, ...over }), recentSlot()]);
/** A layouts document (reading 1): approved module sequences per page and device word. */
const layouts = (pages: Record<string, Partial<Record<'any' | 'mobile' | 'desktop', string[][]>>>) =>
  ({ version: 1, pages: Object.fromEntries(Object.entries(pages).map(([page, devices]) =>
    [page, Object.fromEntries(Object.entries(devices).map(([device, lists]) => [device, lists!.map(modules => ({ modules }))]))])) });

const show = (a: { status: number; body: unknown }) => `${a.status} ${JSON.stringify(a.body).slice(0, 400)}`;
/** The authored preconditions of a member as `GET /content/:kind` answers it (revision 0 for an optional member not yet published). */
function authored(read: Answer): Record<string, string> {
  const publication = read.body.publication as { revision?: number; digest?: string } | undefined;
  const revision = typeof read.body.revision === 'number' ? read.body.revision : 0;
  return { ...(publication?.digest ? { 'If-Match': `"${revision}/${publication.revision}/${publication.digest}"` } : {}), 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` };
}
const scoped = (path: string) => `${path}${path.includes('?') ? '&' : '?'}scope=${TENANT}`;
const call = async (m: Mounted, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, headers?: Record<string, string>) => {
  const answer = await asOperator(m, method, scoped(path), body, headers); invalidatePublicationCache(); return answer;
};
/** `POST /content/:kind/rollback/:n` over the member's current head. */
const rollbackKind = async (m: Mounted, kind: string, n: number) => call(m, 'POST', `/content/${kind}/rollback/${n}`, {}, authored(await readKind(m, kind)));
/** The slots document's revision and the layout slot's stored orders. */
async function slotsState(m: Mounted) {
  const s = await loadSlots(m);
  const pages = (s.document as { pages: Record<string, Array<Record<string, unknown>>> }).pages;
  return { revision: s.revision, orders: pages[PAGE]?.find(slot => slot.slot === LAYOUT)?.orders ?? null };
}
/** Whether an error names the page, the order's context as it states it (channel, buckets, device) and every module of the order. */
const namesOrder = (errors: string[], context: Record<string, unknown>, modules: string[]) => errors.some(e => e.includes(PAGE)
  && e.includes(String(context.channel)) && (context.device === undefined || e.includes(String(context.device)))
  && (context.visitBuckets === 'any' || (context.visitBuckets as string[]).every(b => e.includes(b))) && modules.every(id => e.includes(id)));
const refusedNaming = (a: Answer, context: Record<string, unknown>, modules: string[]) =>
  [a.status, namesOrder(errorsOf(a), context, modules) ? 'names page, context and modules' : `does not (${JSON.stringify(errorsOf(a)).slice(0, 400)})`];
const REFUSED = (/* the refusal as reading 2 rules it */) => [422, 'names page, context and modules'];

/** A shopper on her first visit, arrived from a paid-social click (P01's harness). */
async function paidSocialFirstVisit(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m); expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: her page view is accepted`).toBe(200); return s;
}
async function directFirstVisit(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m); expect((await s.action(PAGE_VIEW, DIRECT_ENTRY)).status, `${m.host}: her page view is accepted`).toBe(200); return s;
}
const layoutOf = async (s: Shopper) => servedIn(await s.snapshot(PAGE, { pageInstance: pageInstanceOf('p88') }), LAYOUT);

/** The layouts document is published first (P38/P91's optional member, revision 0 then 1), or the leg cannot measure the rule. */
async function publishLayouts(m: Mounted, document: unknown, note = 'p88 layouts'): Promise<void> {
  const put = await putKind(m, 'layouts', document, note);
  expect(put.status, `${m.host}: P88.AL1 PRECONDITION — PUT /content/layouts publishes the approved layouts (today the kind does not exist: ${show(put)})`).toBe(200);
}

// ===========================================================================
// unit:P88.AL1 — the approved layouts are a published, versioned, optional document
// ===========================================================================

describe('unit:P88.AL1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): /content/layouts is an optional member — read absent (revision 0, source absent, document null) until its first PUT over revision 0; then stored as authored, with history, revisions, validate and rollback as every document; the catalogue is not checked at its publication; it rides publicationChanges; UNKNOWN_KIND's sentence names it`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P88.AL1 — the product page publishes');
      const before = await readKind(m, 'layouts');
      expect({ status: before.status, revision: before.body.revision ?? null, source: before.body.source ?? null, document: 'document' in before.body ? before.body.document : 'no document member',
        publication: typeof (before.body.publication as { digest?: unknown } | undefined)?.digest === 'string' ? 'the set identity' : 'none' },
      `${host}: P88.AL1 — GET /content/layouts reads an absent optional member (today: ${show(before)})`)
        .toEqual({ status: 200, revision: 0, source: 'absent', document: null, publication: 'the set identity' });
      const emptyHistory = await call(m, 'GET', '/content/layouts/history');
      // The catalogue is not checked here: a module id the catalogue does not register publishes.
      const L1 = layouts({ [PAGE]: { any: [ORDER_A, ORDER_C], mobile: [ORDER_B] }, home: { any: [['module.HOME.hero.1', 'module.HOME.not-in-the-catalogue.9']] } });
      const first = await call(m, 'PUT', '/content/layouts', { document: L1, note: 'p88 first' }, authored(before));
      const stored = await readKind(m, 'layouts');
      expect.soft({ first: first.status, revision: first.body.revision ?? null, read: [stored.body.revision, stored.body.source, stored.body.note], document: stored.body.document, emptyHistory: [emptyHistory.status, emptyHistory.body.revisions ?? null] },
        `${host}: P88.AL1 — the first PUT, over revision 0 (If-Match "0/{set}/{digest}"), writes revision 1 as authored; history was empty before (${show(first)})`)
        .toEqual({ first: 200, revision: 1, read: [1, 'stored', 'p88 first'], document: L1, emptyHistory: [200, []] });
      const L2 = layouts({ [PAGE]: { any: [ORDER_C] } });
      const second = await call(m, 'PUT', '/content/layouts', { document: L2, note: 'p88 second' }, authored(stored));
      const history = await call(m, 'GET', '/content/layouts/history'), r1 = await call(m, 'GET', '/content/layouts/revisions/1');
      const valid = await call(m, 'POST', '/content/layouts/validate', { document: L1 });
      const back = await rollbackKind(m, 'layouts', 1), afterRollback = await readKind(m, 'layouts');
      expect.soft({ second: second.status, history: ((history.body.revisions ?? []) as Array<{ revision?: unknown }>).map(r => r.revision), r1: [r1.status, r1.body.value ?? r1.body.document ?? null],
        valid: [valid.status, valid.body.valid ?? null], back: back.status, afterRollback: [afterRollback.body.revision, afterRollback.body.document] },
      `${host}: P88.AL1 — history (latest first), a revision, validate and rollback as the other documents (${show(back)})`)
        .toEqual({ second: 200, history: [2, 1], r1: [200, L1], valid: [200, true], back: 200, afterRollback: [3, L1] });
      // A member of publicationChanges: published with the learn document in one set.
      const learn = await readKind(m, 'learn'), L3 = layouts({ [PAGE]: { desktop: [ORDER_A] } });
      const together = await call(m, 'PUT', '/content/learn', { document: learn.body.document, note: 'p88 together', publicationChanges: [{ kind: 'layouts', document: L3 }] }, authored(learn));
      const afterTogether = await readKind(m, 'layouts');
      const unknown = await call(m, 'GET', '/content/widgets');
      expect.soft({ together: together.status, layouts: [afterTogether.body.revision, afterTogether.body.document], unknown: [unknown.status, /\blayouts\b/.test(String(unknown.body.error)) ? 'names layouts' : String(unknown.body.error)] },
        `${host}: P88.AL1 — a layouts member of publicationChanges is published with the request's set; an unknown kind's 404 names layouts among the kinds (${show(together)})`)
        .toEqual({ together: 200, layouts: [4, L3], unknown: [404, 'names layouts'] });
    });

    it(`host (${host}): a layouts document is refused 422 naming the page, the device and the index — a device outside any, mobile and desktop, an empty list, a list repeating a module, two identical layouts under one device, more than 50 modules, a module that is not an id, a member outside the schema — and nothing is written; validate answers the same errors`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P88.AL1 — the product page publishes');
      await publishLayouts(m, layouts({ [PAGE]: { any: [ORDER_A] } }));
      const fifty = Array.from({ length: 51 }, (_, i) => `module.PDP.many.${i}`);
      const cases: Array<[string, unknown, string[]]> = [
        ['a device outside the three words', { pages: { [PAGE]: { tablet: [{ modules: ORDER_A }] } } }, [PAGE, 'tablet']],
        ['an empty list', { pages: { [PAGE]: { any: [{ modules: ORDER_A }, { modules: [] }] } } }, [PAGE, 'any', '[1]']],
        ['a list repeating a module', { pages: { [PAGE]: { mobile: [{ modules: [M.grid, M.ugc, M.grid] }] } } }, [PAGE, 'mobile', '[0]']],
        ['two identical layouts under one device', { pages: { [PAGE]: { desktop: [{ modules: ORDER_B }, { modules: ORDER_C }, { modules: ORDER_B }] } } }, [PAGE, 'desktop', '[2]']],
        ['more than 50 modules', { pages: { [PAGE]: { any: [{ modules: fifty }] } } }, [PAGE, 'any', '[0]']],
        ['a module that is not an id', { pages: { [PAGE]: { any: [{ modules: [M.grid, 7] }] } } }, [PAGE, 'any', '[0]']],
        ['a member outside the schema, in a layout', { pages: { [PAGE]: { any: [{ modules: ORDER_A, weight: 2 }] } } }, [PAGE, 'any', '[0]']],
        // At the top there is no page, device or index to name: refused 422 with its errors.
        ['a member outside the schema, at the top', { pages: { [PAGE]: { any: [{ modules: ORDER_A }] } }, approvedBy: 'p88' }, []],
      ];
      const head = await readKind(m, 'layouts');
      const rows: Array<Record<string, unknown>> = [];
      for (const [name, document, named] of cases) {
        const put = await call(m, 'PUT', '/content/layouts', { document, note: name }, authored(head));
        const check = await call(m, 'POST', '/content/layouts/validate', { document });
        const naming = (a: Answer) => errorsOf(a).some(e => named.every(word => e.includes(word))) ? 'named' : `not named (${JSON.stringify(errorsOf(a)).slice(0, 300)})`;
        rows.push({ case: name, put: [put.status, naming(put)], validate: [check.status, check.body.valid ?? null, naming(check)] });
      }
      const after = await readKind(m, 'layouts');
      expect.soft(rows, `${host}: P88.AL1 — each refused 422 naming ${'the page, the device and the index (or the member)'}, by PUT and by validate`)
        .toEqual(cases.map(([name]) => ({ case: name, put: [422, 'named'], validate: [422, false, 'named'] })));
      expect.soft(after.body.revision, `${host}: P88.AL1 — no refused document wrote a revision`).toBe(head.body.revision);
    });

    it(`host (${host}): on a customer stamp the boundary admits /content/layouts (GET, PUT, history, validate, rollback as every :kind), POST /content/publication/initialize does not create it (absent, revision 0, after the six-member set), and an unknown kind is still refused at the boundary`, async () => {
      const s: Stamp = await customerStamp(host);
      const init = await s.call('POST', '/content/publication/initialize', { body: {} });
      expect(init.status, `${host}: PRECONDITION — the stamp owner initializes the tenant's first publication set (W08): ${show(init)}`).toBe(200);
      const read = await s.call('GET', '/content/layouts', { token: s.tokens.operator });
      expect({ status: read.status, revision: read.body.revision ?? null, source: read.body.source ?? null, document: 'document' in read.body ? read.body.document : 'no document member' },
        `${host}: P88.AL1 — after initialize the layouts member is absent, and the customer boundary admits the read (today: ${show(read)})`)
        .toEqual({ status: 200, revision: 0, source: 'absent', document: null });
      const document = layouts({ [PAGE]: { any: [ORDER_A] } });
      const put = await s.call('PUT', '/content/layouts', { token: s.tokens.operator, body: { document, note: 'p88 customer' }, headers: authored(read) });
      const history = await s.call('GET', '/content/layouts/history', { token: s.tokens.operator });
      const check = await s.call('POST', '/content/layouts/validate', { token: s.tokens.operator, body: { document } });
      const unknown = await s.call('GET', '/content/widgets', { token: s.tokens.operator });
      expect.soft({ put: put.status, history: history.status, validate: check.status, unknown: unknown.status },
        `${host}: P88.AL1 — the customer boundary admits the layouts routes; an unknown kind 404 at the boundary as today (${show(put)})`)
        .toEqual({ put: 200, history: 200, validate: 200, unknown: 404 });
    });
  }
});

// ===========================================================================
// unit:P88.AL2 — a slots publication refuses an order outside the page's approved layouts
// ===========================================================================

describe('unit:P88.AL2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an order equal to one of its page's approved layouts publishes and serves exactly as today (P01.O1's decisions); a page the layouts document does not name keeps today's behaviour; the slots read carries no new member`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P88.AL2 — the product page publishes');
      const readBefore = await call(m, 'GET', '/content/slots');
      await publishLayouts(m, layouts({ [PAGE]: { any: [ORDER_A, ORDER_C] } }));
      const sarah = await paidSocialFirstVisit(m), dana = await directFirstVisit(m);
      const approved = await putSlots(m, withOrders([{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }, { context: ANY_FIRST, modules: ORDER_C }]), 'p88 approved');
      expect(approved.status, `${host}: P88.AL2 — approved orders publish (${show(approved)})`).toBe(200);
      expect.soft([await layoutOf(sarah), await layoutOf(dana)], `${host}: P88.AL2 — and serve as P01.O1 serves them`).toEqual([ORDER_A, ORDER_C]);
      const readAfter = await call(m, 'GET', '/content/slots');
      expect.soft(Object.keys(readAfter.body).sort(), `${host}: P88.AL2 — the slots read carries exactly the members it carried before`).toEqual(Object.keys(readBefore.body).sort());
      // A page the document does not name: the rule is not in force for it.
      await publishLayouts(m, layouts({ home: { any: [['module.HOME.hero.1']] } }), 'p88 another page');
      const unnamed = await putSlots(m, withOrders([{ context: PAID_SOCIAL_FIRST, modules: ORDER_B }]), 'p88 unnamed page');
      expect.soft(unnamed.status, `${host}: P88.AL2 — an order on a page the layouts document does not name publishes as today (${show(unnamed)})`).toBe(200);
    });

    it(`host (${host}): an order that is not one of its page's approved layouts — other modules, the approved modules in another order, a prefix of an approved layout — is refused 422 naming the page, the context and the modules, writing nothing, by PUT /content/slots, by its validate, and as a slots member of publicationChanges; an approved one validates`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P88.AL2 — the product page publishes');
      await publishLayouts(m, layouts({ [PAGE]: { any: [ORDER_A] } }));
      const before = await slotsState(m);
      const outside: Array<[string, string[]]> = [['other modules', ORDER_B], ['the approved modules in another order', [...ORDER_A].reverse()], ['a prefix of the approved layout', ORDER_A.slice(0, 2)]];
      const rows: Array<Record<string, unknown>> = [];
      for (const [name, modules] of outside) {
        const document = withOrders([{ context: PAID_SOCIAL_FIRST, modules }]);
        const put = await putSlots(m, document, name);
        const check = await call(m, 'POST', '/content/slots/validate', { document });
        const learn = await readKind(m, 'learn');
        const together = await call(m, 'PUT', '/content/learn', { document: learn.body.document, note: name, publicationChanges: [{ kind: 'slots', document }] }, authored(learn));
        rows.push({ case: name, put: refusedNaming(put, PAID_SOCIAL_FIRST, modules), validate: refusedNaming(check, PAID_SOCIAL_FIRST, modules), member: refusedNaming(together, PAID_SOCIAL_FIRST, modules) });
      }
      const after = await slotsState(m), learnAfter = await readKind(m, 'learn');
      expect.soft(rows, `${host}: P88.AL2 — each refused 422 naming page, context and modules (PUT, validate, publicationChanges)`)
        .toEqual(outside.map(([name]) => ({ case: name, put: REFUSED(), validate: REFUSED(), member: REFUSED() })));
      expect.soft({ slots: after, learn: learnAfter.body.revision }, `${host}: P88.AL2 — nothing written`).toEqual({ slots: before, learn: 1 });
      const approved = await call(m, 'POST', '/content/slots/validate', { document: withOrders([{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }]) });
      expect.soft([approved.status, approved.body.valid ?? null], `${host}: P88.AL2 — the approved order validates (${show(approved)})`).toEqual([200, true]);
    });

    it(`host (${host}): the device — an order whose context names mobile matches the page's mobile and any layouts, one naming desktop the desktop and any layouts, one naming no device the any layouts alone`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P88.AL2 — the product page publishes');
      await publishLayouts(m, layouts({ [PAGE]: { any: [ORDER_A], mobile: [ORDER_B], desktop: [ORDER_C] } }));
      const cases: Array<[string, Record<string, unknown>, string[], 'approved' | 'refused']> = [
        ['mobile, its own layout', PAID_SOCIAL_MOBILE, ORDER_B, 'approved'],
        ['mobile, the any layout', PAID_SOCIAL_MOBILE, ORDER_A, 'approved'],
        ['mobile, the desktop layout', PAID_SOCIAL_MOBILE, ORDER_C, 'refused'],
        ['desktop, its own layout', EMAIL_DESKTOP, ORDER_C, 'approved'],
        ['desktop, the any layout', EMAIL_DESKTOP, ORDER_A, 'approved'],
        ['desktop, the mobile layout', EMAIL_DESKTOP, ORDER_B, 'refused'],
        ['no device, the any layout', PAID_SOCIAL_FIRST, ORDER_A, 'approved'],
        ['no device, the mobile layout', PAID_SOCIAL_FIRST, ORDER_B, 'refused'],
        ['no device, the desktop layout', PAID_SOCIAL_FIRST, ORDER_C, 'refused'],
      ];
      const rows: Array<Record<string, unknown>> = [];
      for (const [name, context, modules] of cases) {
        const check = await call(m, 'POST', '/content/slots/validate', { document: withOrders([{ context, modules }]) });
        rows.push({ case: name, outcome: check.status === 200 && check.body.valid === true ? 'approved' : check.status === 422 && namesOrder(errorsOf(check), context, modules) ? 'refused' : show(check) });
      }
      const published = await putSlots(m, withOrders([{ context: PAID_SOCIAL_MOBILE, modules: ORDER_B }, { context: EMAIL_DESKTOP, modules: ORDER_C }, { context: PAID_SOCIAL_FIRST, modules: ORDER_A }]), 'p88 devices');
      expect.soft(rows, `${host}: P88.AL2 — a device-named context matches its device's layouts and the any layouts; a context naming no device the any layouts alone`)
        .toEqual(cases.map(([name, , , outcome]) => ({ case: name, outcome })));
      expect.soft(published.status, `${host}: P88.AL2 — the three approved orders publish together (${show(published)})`).toBe(200);
    });

    it(`host (${host}): the rule reads the layouts of the set the publication is made over — with a stale If-Match the request is refused 409 as today, not by a newer layouts revision; a layouts publication dropping a layout a published order uses is accepted, the slots validate then reports that order, and a rollback to a slots revision carrying it is refused 422 naming it, writing nothing`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P88.AL2 — the product page publishes');
      await publishLayouts(m, layouts({ [PAGE]: { any: [ORDER_A] } }));
      const stale = authored(await readKind(m, 'slots'));
      await publishLayouts(m, layouts({ [PAGE]: { any: [ORDER_C] } }), 'p88 newer');
      const late = await call(m, 'PUT', '/content/slots', { document: withOrders([{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }]), note: 'p88 stale' }, stale);
      expect.soft([late.status, late.body.code ?? null], `${host}: P88.AL2 — over the set its If-Match names the order is approved; that set is no longer current, so 409 as today (${show(late)})`)
        .toEqual([409, 'publication_conflict']);
      // A published order, then the layouts document drops it.
      const used = await putSlots(m, withOrders([{ context: PAID_SOCIAL_FIRST, modules: ORDER_C }]), 'p88 used');
      expect(used.status, `${host}: PRECONDITION — the approved order publishes (${show(used)})`).toBe(200);
      const withOrder = (await slotsState(m)).revision;
      const drop = await putKind(m, 'layouts', layouts({ [PAGE]: { any: [ORDER_B] } }), 'p88 drop');
      const current = await loadSlots(m);
      const report = await call(m, 'POST', '/content/slots/validate', { document: current.document });
      const cleared = await putSlots(m, withOrders([]), 'p88 cleared');
      const cleared2 = cleared.status === 200 ? cleared : await putSlots(m, declaredSlots([layoutSlot(), recentSlot()]), 'p88 cleared');
      const before = await slotsState(m);
      const back = await rollbackKind(m, 'slots', withOrder);
      const after = await slotsState(m);
      expect.soft({ drop: drop.status, report: refusedNaming(report, PAID_SOCIAL_FIRST, ORDER_C), cleared: cleared2.status, rollback: refusedNaming(back, PAID_SOCIAL_FIRST, ORDER_C), unchanged: after.revision === before.revision },
        `${host}: P88.AL2 — the drop is accepted; validate reports the order; the rollback to it is refused 422 naming it and writes nothing (${show(back)})`)
        .toEqual({ drop: 200, report: REFUSED(), cleared: 200, rollback: REFUSED(), unchanged: true });
    });

    it(`host (${host}): a tenant that never published a layouts document publishes every order as today (LOCK); with a layouts document the carousel's shot orders (P84) are outside the rule`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P88.AL2 — the product page publishes');
      const free = await putSlots(m, withOrders([{ context: PAID_SOCIAL_FIRST, modules: ORDER_B }, { context: ANY_FIRST, modules: ORDER_C }]), 'p88 no layouts');
      expect.soft(free.status, `${host}: P88.AL2 — LOCK: without a layouts document an order publishes as today (${show(free)})`).toBe(200);
      await publishLayouts(m, layouts({ [PAGE]: { any: [ORDER_A] } }));
      const carousel = { slot: 'pdp-carousel', take: 4, weights: { category: 1 },
        shotOrders: [{ context: PAID_SOCIAL_FIRST, order: ['on_model', 'detail'] }, { context: { channel: 'email', visitBuckets: 'any' }, order: ['studio'] }] };
      const shots = await putSlots(m, declaredSlots([layoutSlot({ orders: [{ context: PAID_SOCIAL_FIRST, modules: ORDER_A }] }), recentSlot(), carousel]), 'p88 shots');
      expect.soft(shots.status, `${host}: P88.AL2 — the carousel's shot orders publish beside an approved layout order (${show(shots)})`).toBe(200);
    });
  }
});

// ===========================================================================
// unit:P88.AL3 — the locks for approved orders, and the kit
// ===========================================================================

describe('unit:P88.AL3', () => {
  it('host: LOCK — under a layouts document approving every order below, P01.O5\'s refusals and P04\'s pin rules are unchanged: an unregistered or repeated module, an excluded module and an order moving the pinned module are refused 422 naming the orders and the value, and the pinned control publishes', async () => {
    const m = await mount('session', BASE);
    expectPublished(m, 'P88.AL3 — the product page publishes');
    const pinnedOrders = [[M.grid, M.reco2, M.reco1], [M.grid, 'module.PDP.unregistered.9'], [M.grid, M.reco1, M.grid], [M.grid, M.reviews], [M.reco1, M.grid]];
    // A repeated module cannot be an approved layout (reading 1); every other order is approved, so only today's rules can refuse it.
    await publishLayouts(m, layouts({ [PAGE]: { any: pinnedOrders.filter(list => new Set(list).size === list.length) } }));
    const pinned = (orders: unknown[]) => declaredSlots([layoutSlot({ pinnedPieceIds: [M.grid], orders }), recentSlot()]);
    const control = await putSlots(m, pinned([{ context: PAID_SOCIAL_FIRST, modules: [M.grid, M.reco2, M.reco1] }]), 'p88 control');
    expect(control.status, `P88.AL3 — CONTROL: an approved order that keeps the pin publishes (${show(control)})`).toBe(200);
    const revision = (await loadSlots(m)).revision;
    const refusals: Array<[string, unknown, string]> = [
      ['an unregistered module', withOrders([{ context: PAID_SOCIAL_FIRST, modules: [M.grid, 'module.PDP.unregistered.9'] }]), 'module.PDP.unregistered.9'],
      ['an excluded module', withOrders([{ context: PAID_SOCIAL_FIRST, modules: [M.grid, M.reviews] }]), M.reviews],
      ['an order that moves the pinned module', pinned([{ context: PAID_SOCIAL_FIRST, modules: [M.reco1, M.grid] }]), M.grid],
      ['a repeated module', withOrders([{ context: PAID_SOCIAL_FIRST, modules: [M.grid, M.reco1, M.grid] }]), M.grid],
    ];
    const outcomes: Array<Record<string, unknown>> = [];
    for (const [name, document, offending] of refusals) {
      const answer = await putSlots(m, document, name);
      outcomes.push({ case: name, status: answer.status, named: errorsOf(answer).some(e => e.includes(offending) && /orders/.test(e)) });
    }
    expect.soft(outcomes, 'P88.AL3 — LOCK: each refused 422 by today\'s rules, naming the orders and the value').toEqual(refusals.map(([name]) => ({ case: name, status: 422, named: true })));
    expect.soft((await loadSlots(m)).revision, 'P88.AL3 — nothing written').toBe(revision);
  });

  it('kit: kit 02 names the layouts document among the content documents, documents GET/PUT /content/layouts (the pages, the any, mobile and desktop lists of modules, the 422 refusals, the absent read, the first PUT\'s If-Match "0/…"), and states the rule in its configured-order paragraph; kit 03 gives the layouts document\'s schema beside the slot document and names the rule in its per-context orders', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const section = (text: string, heading: RegExp) => { const lines = text.split('\n'), at = lines.findIndex(l => heading.test(l));
      if (at < 0) return ''; const level = /^#+/.exec(lines[at]!)![0].length;
      const end = lines.findIndex((l, i) => i > at && /^#+ /.test(l) && /^#+/.exec(l)![0].length <= level); return lines.slice(at, end < 0 ? undefined : end).join('\n'); };
    const paragraphs = (text: string) => text.split(/\n\s*\n/);
    const documents02 = section(kit02, /^## 4\. Content and configuration documents/);
    const list02 = paragraphs(documents02).find(p => /documents per brand/.test(p)) ?? '';
    const layoutsParagraph = paragraphs(documents02).find(p => p.includes('/content/layouts')) ?? '';
    const orders02 = paragraphs(kit02).find(p => p.includes('**A configured order per context.**')) ?? '';
    const schema03 = (() => { const lines = kit03.split('\n'), at = lines.findIndex(l => /^#{2,4} .*\blayouts\b/i.test(l)); return at < 0 ? '' : section(kit03, new RegExp('^' + lines[at]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')); })();
    const orders03 = section(kit03, /^#### Per-context orders/);
    const has = (text: string, ...words: string[]) => words.filter(w => !text.includes(w));
    expect.soft({
      documentList: /`layouts`/.test(list02),
      layoutsParagraphMissing: layoutsParagraph ? has(layoutsParagraph, '`any`', '`mobile`', '`desktop`', '`modules`', '422', 'absent', '"0/') : 'no paragraph naming /content/layouts in section 4',
      ordersRule: orders02.split(/(?<=\.)\s+/).some(s => /approved layouts?/i.test(s) && /refus|\b422\b/i.test(s)),
      schema03Missing: schema03 ? has(schema03, '"pages"', '"modules"', '`any`', '`mobile`', '`desktop`') : 'no layouts heading in kit 03',
      orders03Rule: orders03.split(/(?<=\.)\s+/).some(s => /approved layouts?/i.test(s) && /refus|\b422\b/i.test(s)),
    }, 'P88.AL3 — the kit states the layouts document and the rule (today it names neither)')
      .toEqual({ documentList: true, layoutsParagraphMissing: [], ordersRule: true, schema03Missing: [], orders03Rule: true });
  });
});
