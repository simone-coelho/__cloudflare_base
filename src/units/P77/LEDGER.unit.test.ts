// src/units/P77/LEDGER.unit.test.ts
// P77 under the Closure Ledger: the tests for the LOCAL criteria VR1-VR3 of the P77 work order (the activation
// programme of amendment 11, ticket P77 "The vocabulary routes allowed on customer deployments", E4). LV1 is a deferred
// live row (with its customer-profile stamp clause) and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md,
// section 2, E4, "Done when"):
//   "`PUT /content/vocabulary` and its reads are admitted under the customer profile with operator authority; an import
//   on a customer deployment reports values outside the vocabulary as the kit says; nothing else in the customer
//   boundary changes."
// The work order (docs/parity/activation/program.json, P77): VR1 "Under the customer profile with operator authority,
// PUT and GET /content/vocabulary, its history, revisions, validate and rollback, POST /content/vocabulary/approve/{n}
// and GET /content/vocabulary/rejections reach their handlers (src/routes/content.ts:642–862, :1150, :1176); today: they
// are refused at the boundary, because the :kind pattern is (?:catalog|slots|learn|priors) (src/customerBoundary.ts:130)
// and approve and rejections have no entry (customerBoundary.ts:60–64)"; VR2 "On a customer-profile deployment with a
// vocabulary approved, an import or pull carrying a tag value outside it is refused 422 naming the record, the
// attribute and the value (src/content/kinds.ts:2094) and the rejection report counts it, as kit 02 :2236–2242 and kit
// 03 :1432–1451 say"; VR3 "Locks: nothing else in the customer boundary changes: every other route's admission and
// refusal under the customer profile as before, every entry still a mounted path (src/index.api-boundary.test.ts:2428);
// the vocabulary routes still require operator authority".
//
// THE READINGS THIS FILE RULES:
//   · VR1: on the REAL Worker (src/index.ts's default export) under DEPLOYMENT_PROFILE customer with AUTH_MODE enforced,
//     an operator of the tenant (a membership, not a stamp owner) reads, writes, validates, approves and rolls back the
//     vocabulary through exactly the routes P38 receipted, and each answers as its handler answers (kit 02, "The
//     attribute vocabulary"). Today each is the boundary's own refusal, 404 `{"error":"Not Found"}` (src/index.ts, the
//     `customerRequest` refusal).
//   · VR2: "the rejection report counts it" read with the kit the criterion cites: an import carrying a value outside
//     the vocabulary in effect is refused 422 and writes nothing, each error naming the piece's id, the field
//     `tags.<attribute>` and the value (kit 02, "The catalogue, in effect"); the rejection report counts what the INGEST
//     refused (kit 02, "The rejection report": "each value the ingest refused under the revision in effect"), so the
//     count is measured on an event carrying the same outside value. The pull is the import's own door (kit 02: the
//     import, the pull and the CSV pass one door) and needs a connector; it is not exercised here.
//   · VR3: the vocabulary routes take operator authority exactly as the other content routes do (the content routes'
//     `operatorJwt`: no credential 401; a credential whose memberships do not name the tenant 403 on the customer profile,
//     W08 C1's witness); the boundary's list is today's but for entries whose path begins `/content/vocabulary/`; every
//     other kind (`/content/proposals`, `/content/reflex`, an unknown kind) and every other refused route stays refused;
//     the two new operations are admitted for their own method only. A wrong method on them (GET …/approve/1, POST
//     …/rejections, DELETE /content/vocabulary) answers a 404 that cannot be told from the router's from outside, so the
//     own-method logic test carries that case and the Worker-level lock's rows for them are a weaker check (R-P292).
//     Every entry a mounted path is
//     src/index.api-boundary.test.ts W01.08's own check (run with this batch, not repeated here).
//   · THE KIT: kit 02's vocabulary section and kit 01's vocabulary paragraph state the routes with no deployment-profile
//     limit, so no kit sentence changes; the kit leg is a control (green today and after).
//
// R10: none. Searched: no test pins CUSTOMER_ROUTES or the `:kind` pattern (src/units/P54/LEDGER.unit.test.ts:85-88
// says so; W37's logic leg reads the identity export's admission, W08 C1 the initialization door's); no test asserts a
// vocabulary route refused under the customer profile; src/index.api-boundary.test.ts W01.08 instantiates `:kind` as
// `catalog` and requires every entry mounted (the two new entries are mounted at their exact paths, a constraint).
//
// NO NEW EXPORT IS IMPORTED.
//
// FIXTURE. The W08-C1 customer stamp (src/units/W08/_customer.ts: the real Worker on the customer profile, an operator
// with a membership on the tenant, a second tenant on which nobody holds one), on both shopper hosts; the tenant's
// six-member set written as a stamp's adoption leaves it (P54's pattern): the registry scoring category, product type,
// colour and occasion from the event's own values (src/units/_parity.ts REFLEX_DOCUMENT), a catalogue whose governed
// values are already ids, the neutral home page's slots and learn document (src/units/_parity5.ts), the compiled empty
// priors and proposals. The vocabulary and its customer-neutral values in the shape P38 receipted.
//
// HARNESS: src/units/W08/_customer.ts, src/units/_parity.ts (REFLEX_DOCUMENT), src/units/_parity5.ts (HOME, homeLearn).
// Imports from src/units/: ../W08/_customer, ../_parity, ../_parity5.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// The module doubles src/demos/kit/root.worker.test.ts:24-26 registers to load the real Worker in process (as
// src/units/W08/C1.unit.test.ts and src/units/P54/LEDGER.unit.test.ts do); none is on these paths.
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { CUSTOMER_ROUTES, customerRequest } from '@/customerBoundary';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import type { Env } from '@/types/env';

import { REFLEX_DOCUMENT } from '../_parity';
import { HOME, homeLearn } from '../_parity5';
import { customerStamp, HOSTS, OTHER_TENANT, SDK_KEY, TENANT, type Answer, type Stamp } from '../W08/_customer';

/** The checkout this file lives in (never the working directory). */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const readTree = (relative: string) => readFileSync(ROOT + relative, 'utf8');

/** The customer boundary's own refusal (src/index.ts: `customerRequest` null). */
const BOUNDARY_404 = [404, { error: 'Not Found' }];

/** The tenant's vocabulary (customer-neutral values in the shape P38 receipted). */
const VOCABULARY = {
  version: 'p77-vocabulary',
  attributes: {
    category: { values: [
      { id: 'bags', name: 'Bags', synonyms: ['handbags'] }, { id: 'shoes', name: 'Shoes' },
      { id: 'small_leather_goods', name: 'Small leather goods', synonyms: ['slg'] },
    ] },
    productType: { values: [
      { id: 'crossbody', name: 'Crossbody', parent: 'bags' }, { id: 'tote', name: 'Tote', parent: 'bags' },
      { id: 'wallet', name: 'Wallet', parent: 'small_leather_goods' }, { id: 'sneaker', name: 'Sneaker', parent: 'shoes' },
    ] },
    color: { values: [{ id: 'black', name: 'Black' }, { id: 'brown_tan', name: 'Brown / tan', synonyms: ['cognac', 'tan'] }, { id: 'neutral', name: 'Neutral' }] },
    occasion: { values: [{ id: 'everyday', name: 'Everyday' }, { id: 'evening', name: 'Evening', synonyms: ['night out'] }] },
  },
};
/** A second valid revision (one occasion added), for the rollback. */
const VOCABULARY_2 = { ...VOCABULARY, version: 'p77-vocabulary-2',
  attributes: { ...VOCABULARY.attributes, occasion: { values: [...VOCABULARY.attributes.occasion.values, { id: 'travel', name: 'Travel' }] } } };

const HERO = 'home-hero';
const piece = (id: string, tags: Record<string, string[]>) => ({ id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'editorial', title: `Story ${id}`, tags, slotTypes: [HERO], lifecycle: { status: 'live' } });
/** The published catalogue: every governed value already an id. */
const CATALOGUE = [
  piece('look.evening-crossbody', { category: ['bags'], productType: ['crossbody'], color: ['black'], occasion: ['evening'] }),
  piece('look.weekend-tote', { category: ['bags'], productType: ['tote'], color: ['brown_tan'], occasion: ['everyday'] }),
  piece('look.city-sneaker', { category: ['shoes'], productType: ['sneaker'], color: ['neutral'] }),
];
/** An imported piece carrying a value outside the vocabulary on a governed attribute (colour). */
const OUTSIDE = piece('look.bright-scarf', { category: ['bags'], color: ['chartreuse'] });
/** A shopper's view of a product the tenant does not hold, carrying the same outside colour. */
const VIEW_OUTSIDE = { type: 'product_view', data: { productId: 'SKU-SCARF-1', category: 'bags', color: 'chartreuse' } };

/** The registry scoring the four attributes from the event's own values (`event-when-unknown`). */
const REGISTRY = { ...REFLEX_DOCUMENT, version: 'p77-attribute-registry',
  dimensions: [{ key: 'category', source: 'category' }, { key: 'productType', source: 'productType' }, { key: 'color', source: 'color' }, { key: 'occasion', source: 'occasion', multi: true }] };
const SLOTS = { version: 'p77-slots', pages: { [HOME]: [{ slot: HERO, take: 3, weights: { category: 1, color: 0.5, occasion: 0.5 } }] } };

/** The tenant's six-member set as a stamp's adoption leaves it (P54's `fourMemberSet` pattern), every member at revision 1. */
async function sixMemberSet(env: Env, tenant: string): Promise<void> {
  const at = Date.now();
  const members: Array<[DocumentKind<unknown>, string, unknown]> = [
    [REFLEX_KIND as DocumentKind<unknown>, reflexScopeForTenant(tenant), REGISTRY],
    [CONTENT_KIND as DocumentKind<unknown>, tenant, { version: 'p77-catalogue', pieces: CATALOGUE }],
    [SLOTS_KIND as DocumentKind<unknown>, tenant, SLOTS],
    [LEARN_KIND as DocumentKind<unknown>, tenant, homeLearn()],
    [PRIORS_KIND as DocumentKind<unknown>, tenant, EMPTY_PRIORS],
    [PROPOSALS_KIND as DocumentKind<unknown>, tenant, EMPTY_PROPOSALS],
  ];
  await initializePublicationSet(env, members.map(([kind, scope, value]) => ({ kind, scope,
    revision: { revision: 1, value, actor: 'ops', note: `p77 ${kind.name}`, at } })) as PublicationBaseline[], `0:${crypto.randomUUID()}`);
  invalidatePublicationCache(); invalidateCache();
}
/** A stamp on `host` whose tenant holds the six-member set; its ledger recovery enabled, as a deployed stamp's is, so a shopper's action is admitted. */
async function stamp(host: (typeof HOSTS)[number]): Promise<Stamp> {
  const s = await customerStamp(host);
  Object.assign(s.env as unknown as Record<string, unknown>, { LEDGER_RECOVERY_ENABLED: 'true' });
  await sixMemberSet(s.env, TENANT);
  return s;
}
const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 240)}`;
/** The authored preconditions of a write over `read`'s head (kit 02: `If-Match: "{revision}/{set revision}/{set digest}"` and an `Idempotency-Key`). */
const preconditions = (read: Answer): Record<string, string> => {
  const publication = read.body.publication as { revision?: number; digest?: string } | undefined;
  const revision = typeof read.body.revision === 'number' ? read.body.revision : 0;
  return { ...(publication?.digest ? { 'If-Match': `"${revision}/${publication.revision}/${publication.digest}"` } : {}), 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` };
};
/** The content routes' errors, wherever the answer puts them. */
const errorsOf = (a: Answer): string[] => [...((a.body.errors as unknown[] | undefined) ?? []), a.body.error].filter((e): e is string => typeof e === 'string');

/** The operator (a membership on the tenant, not a stamp owner): the vocabulary's own calls. */
const asOperator = (s: Stamp, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) =>
  s.call(method, path, { token: s.tokens.operator, ...opts });
/** Publish `document` as the next vocabulary revision through PUT /content/vocabulary (over the head the GET reports). */
async function putVocabulary(s: Stamp, document: unknown, note: string): Promise<Answer> {
  const head = await asOperator(s, 'GET', '/content/vocabulary');
  return asOperator(s, 'PUT', '/content/vocabulary', { body: { document, note }, headers: preconditions(head) });
}
/** Put revision n in effect through POST /content/vocabulary/approve/{n}. */
async function approve(s: Stamp, n: number): Promise<Answer> {
  const head = await asOperator(s, 'GET', '/content/vocabulary');
  return asOperator(s, 'POST', `/content/vocabulary/approve/${n}`, { body: {}, headers: preconditions(head) });
}
/** The vocabulary published and approved through the routes; each step's answer asserted, naming today's refusal. */
async function inEffect(s: Stamp): Promise<void> {
  const written = await putVocabulary(s, VOCABULARY, 'p77 vocabulary revision 1');
  expect(written.status, `${s.host}: PRECONDITION — the operator publishes the vocabulary on the customer profile (PUT /content/vocabulary; today the customer boundary refuses it, 404 {"error":"Not Found"}): ${show(written)}`).toBe(200);
  const approved = await approve(s, 1);
  expect(approved.status, `${s.host}: PRECONDITION — the operator approves revision 1 on the customer profile (POST /content/vocabulary/approve/1; today the customer boundary refuses it): ${show(approved)}`).toBe(200);
}
/** A shopper of the tenant with an explicit choice allowing tracking and personalization, through the routes the SDK uses. */
async function shopper(s: Stamp) {
  const issued = await s.call('POST', `/v1/${TENANT}/identity/session`, { token: null, body: {}, headers: { 'X-SDK-Key': SDK_KEY } });
  const session = issued.body.session as { capability: string; subject: string; sessionId: string; grantId: string; iat: number; exp: number; consent?: { instruction?: { revision?: unknown } } } | undefined;
  expect([issued.status, typeof session?.capability], `${s.host}: PRECONDITION — a shopper session is issued: ${show(issued)}`).toEqual([200, 'string']);
  const headers = { 'X-SDK-Key': SDK_KEY, 'X-Shopper-Session': session!.capability };
  const chosen = await s.call('POST', `/realtime/session/${session!.sessionId}/preferences`, { token: null, headers, body: { trackingConsent: true, personalizationEnabled: true,
    choice: { id: crypto.randomUUID(), expectedRevision: session!.consent?.instruction?.revision ?? null, grantId: session!.grantId, iat: session!.iat, exp: session!.exp } } });
  expect(chosen.status, `${s.host}: PRECONDITION — the shopper's explicit choice is admitted: ${show(chosen)}`).toBe(200);
  const act = (event: { type: string; data: Record<string, unknown> }) => s.call('POST', '/realtime/action', { token: null, headers,
    body: { ...event, source: 'sdk', userId: session!.subject, sessionId: session!.sessionId, eventId: crypto.randomUUID(), timestamp: Date.now() } });
  return { act };
}

// ===========================================================================
// unit:P77.VR1 — the vocabulary's routes reach their handlers under the customer profile
// ===========================================================================

describe('unit:P77.VR1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): under the customer profile with operator authority, PUT and GET /content/vocabulary, its history, revisions, validate and rollback, POST /content/vocabulary/approve/{n} and GET /content/vocabulary/rejections reach their handlers and answer as kit 02 says`, async () => {
      const s = await stamp(host);
      const absent = await asOperator(s, 'GET', '/content/vocabulary');
      const written = await asOperator(s, 'PUT', '/content/vocabulary', { body: { document: VOCABULARY, note: 'p77 revision 1' }, headers: preconditions(absent) });
      const read = await asOperator(s, 'GET', '/content/vocabulary');
      const history = await asOperator(s, 'GET', '/content/vocabulary/history');
      const revision = await asOperator(s, 'GET', '/content/vocabulary/revisions/1');
      const validated = await asOperator(s, 'POST', '/content/vocabulary/validate', { body: { document: VOCABULARY } });
      const approved = await asOperator(s, 'POST', '/content/vocabulary/approve/1', { body: {}, headers: preconditions(read) });
      const report = await asOperator(s, 'GET', '/content/vocabulary/rejections');
      const second = await putVocabulary(s, VOCABULARY_2, 'p77 revision 2');
      const head = await asOperator(s, 'GET', '/content/vocabulary');
      const rolled = await asOperator(s, 'POST', '/content/vocabulary/rollback/1', { body: { note: 'p77 rollback to 1' }, headers: preconditions(head) });
      const after = await asOperator(s, 'GET', '/content/vocabulary');
      expect.soft({
        get: [absent.status, absent.body.source, absent.body.revision, absent.body.effectiveRevision],
        put: [written.status, written.body.ok],
        read: [read.status, read.body.source, read.body.revision, read.body.effectiveRevision, read.body.document],
        history: [history.status, ((history.body.revisions as unknown[] | undefined) ?? []).length],
        revision: [revision.status, revision.body.revision, revision.body.value],
        validate: [validated.status, validated.body.valid],
        approve: [approved.status, approved.body.effectiveRevision],
        rejections: [report.status, report.body.effectiveRevision, report.body.rejections],
        rollback: [second.status, rolled.status, rolled.body.revision],
        afterRollback: [after.status, after.body.revision, after.body.effectiveRevision, after.body.document],
      }, `${host}: P77.VR1 — each vocabulary route reaches its handler on the customer profile (today each is the boundary's 404 {"error":"Not Found"})`).toEqual({
        get: [200, 'absent', 0, 0],
        put: [200, true],
        read: [200, 'stored', 1, 0, VOCABULARY],
        history: [200, 1],
        revision: [200, 1, VOCABULARY],
        validate: [200, true],
        approve: [200, 1],
        rejections: [200, 1, {}],
        rollback: [200, 200, 3],
        afterRollback: [200, 3, 1, VOCABULARY],
      });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P77.VR2 — an import on a customer deployment is held to the vocabulary in effect
// ===========================================================================

describe('unit:P77.VR2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the customer profile with a vocabulary approved, a catalogue import carrying a tag value outside it is refused 422 naming the record, the field and the value and writes nothing, and the rejection report counts the value an event carried`, async () => {
      const s = await stamp(host);
      await inEffect(s);
      const before = await asOperator(s, 'GET', '/content/catalog');
      const refused = await asOperator(s, 'POST', '/content/catalog/import?mode=replace', { body: { content: [...CATALOGUE, OUTSIDE] }, headers: preconditions(before) });
      const after = await asOperator(s, 'GET', '/content/catalog');
      const errors = errorsOf(refused);
      const visitor = await shopper(s);
      const acted = await visitor.act(VIEW_OUTSIDE);
      expect(acted.status, `${host}: PRECONDITION — the shopper's view is answered: ${show(acted)}`).toBe(200);
      const report = await asOperator(s, 'GET', '/content/vocabulary/rejections');
      expect.soft({
        import: [refused.status, errors.some(e => e.includes(OUTSIDE.id) && e.includes('tags.color') && e.includes('chartreuse'))],
        written: [after.body.revision, after.body.document],
        report: [report.status, report.body.effectiveRevision, report.body.rejections],
      }, `${host}: P77.VR2 — the import is refused naming the piece, the field and the value; nothing is written; the report counts the event's outside value (errors: ${JSON.stringify(errors).slice(0, 300)})`).toEqual({
        import: [422, true],
        written: [before.body.revision, before.body.document],
        report: [200, 1, { color: { chartreuse: 1 } }],
      });
    }, 120_000);
  }

  it('logic: CONTROL — kit 02\'s vocabulary section and kit 01\'s vocabulary paragraph state the routes (PUT /content/vocabulary, POST /content/vocabulary/approve/{n}, GET /content/vocabulary/rejections) with no deployment-profile limit, so no kit sentence changes', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), start = kit02.indexOf('### The attribute vocabulary (`/content/vocabulary`)');
    // The section runs to the next heading of its level or above.
    const ends = ['\n## ', '\n### '].map(h => kit02.indexOf(h, start + 1)).filter(i => i > start);
    const section = start < 0 ? '' : kit02.slice(start, ends.length ? Math.min(...ends) : undefined);
    const kit01 = readTree('docs/kit/01-integration-guide.md'), at = kit01.indexOf('Tag values are free text until your brand approves an attribute vocabulary');
    const paragraph = at < 0 ? '' : kit01.slice(at, kit01.indexOf('\n\n', at) < 0 ? undefined : kit01.indexOf('\n\n', at));
    const profileLimit = /DEPLOYMENT_PROFILE|\b(?:customer|demo) (?:profile|deployment|stamp)s?\b|\bon the (?:customer|demo)\b/i;
    const routes = (text: string) => ['PUT /content/vocabulary', 'POST /content/vocabulary/approve/{n}', 'GET /content/vocabulary/rejections'].filter(r => text.includes(r));
    expect([section === '' ? 'kit 02 section not found' : 'found', paragraph === '' ? 'kit 01 paragraph not found' : 'found'], 'PRECONDITION: the two passages').toEqual(['found', 'found']);
    expect({ kit02: { routes: routes(section), profileLimit: profileLimit.exec(section)?.[0] ?? null }, kit01: { routes: routes(paragraph).length > 0, profileLimit: profileLimit.exec(paragraph)?.[0] ?? null } },
      'P77.VR2 — CONTROL: the kit states the vocabulary routes with no deployment-profile limit').toEqual({
      kit02: { routes: ['PUT /content/vocabulary', 'POST /content/vocabulary/approve/{n}', 'GET /content/vocabulary/rejections'], profileLimit: null },
      kit01: { routes: true, profileLimit: null },
    });
  });
});

// ===========================================================================
// unit:P77.VR3 — nothing else in the customer boundary changes; the vocabulary keeps operator authority
// ===========================================================================

/** Today's customer boundary (src/customerBoundary.ts CUSTOMER_ROUTES at the integration head 1ad38ac1), path and methods; P98 R10 (R-P569 (c)): the catalogue's stage and publish doors added. */
const TODAY = [
  '/health/live GET,HEAD', '/health/ready GET,HEAD', '/api-info GET,HEAD', '/geo GET,HEAD', '/auth/login POST', '/auth/oidc/start POST',
  '/auth/oidc/callback/:tenant GET', '/auth/oidc/complete POST', '/auth/users/:id/federation GET,PUT,DELETE', '/auth/refresh POST', '/auth/logout POST',
  '/auth/password POST', '/auth/me GET,HEAD', '/auth/users GET,HEAD,POST', '/auth/users/:id PATCH,DELETE', '/auth/users/:id/reset POST', '/auth/audit GET,HEAD',
  '/auth/authority GET,HEAD', '/auth/memberships GET,HEAD,POST', '/auth/memberships/:id PATCH,DELETE', '/auth/service-credentials GET,HEAD,POST',
  '/auth/service-credentials/:id DELETE', '/operator/audiences GET', '/operator/ledger-recovery GET,HEAD', '/operator/ledger-recovery/:id GET,HEAD',
  '/operator/ledger-recovery/:id/redrive POST', '/operator/ledger-recovery/:id/resolve POST', '/operator/audiences/publish POST',
  '/operator/audiences/:key/rename POST', '/operator/audiences/:key/pin POST', '/operator/audiences/:key/prune POST', '/config/reflex GET,HEAD,PUT,PATCH',
  '/config/reflex/history GET,HEAD', '/config/reflex/revisions/:n GET,HEAD', '/config/reflex/validate POST', '/config/reflex/rollback/:n POST',
  '/content/:kind GET,HEAD,PUT', '/content/:kind/history GET,HEAD', '/content/:kind/revisions/:n GET,HEAD', '/content/:kind/validate POST',
  '/content/:kind/rollback/:n POST', '/content/catalog/import POST', '/content/catalog/pull POST', '/content/catalog/publication GET,HEAD',
  '/content/catalog/publication/recover POST', '/content/catalog/stage POST', '/content/catalog/publish POST', '/content/publication/initialize POST', '/content/publication/complete POST',
  '/content/catalog/enrichment/proposals POST', '/content/catalog/enrichment/proposals/generate POST', '/content/catalog/enrichment/proposals/:id GET,HEAD',
  '/content/catalog/enrichment/proposals/:id/export GET,HEAD', '/content/catalog/enrichment/proposals/:id/review POST',
  '/content/catalog/enrichment/proposals/:id/publish POST', '/sort POST', '/sort/intent POST', '/search POST', '/realtime/ws GET', '/realtime/action POST',
  '/realtime/personalization/:userId GET', '/realtime/reflex GET', '/realtime/session/reset POST', '/realtime/session/:sessionId/preferences POST',
  '/realtime/session/preferences POST', '/realtime/session/:sessionId/analytics GET,HEAD', '/realtime/segments/:userId GET,HEAD,POST',
  '/realtime/connections/:userId GET,HEAD', '/v1/:tenant/trend GET,HEAD', '/v1/:tenant/decisions/snapshot GET,POST', '/v1/:tenant/context-table/:page GET,HEAD', '/v1/:tenant/context-table/:page/:version GET,HEAD', '/v1/:tenant/identity/session POST',
  '/v1/:tenant/identity/link POST', '/v1/:tenant/identity/detach POST', '/v1/:tenant/identity/resolve POST', '/v1/:tenant/identity/visitor/:visitorId GET,HEAD',
  '/v1/:tenant/identity/shopper/:shopperId GET,HEAD', '/v1/:tenant/identity/events POST', '/v1/:tenant/identity/erase POST', '/v1/:tenant/identity/export POST',
  '/v1/:tenant/audit GET,HEAD', '/v1/:tenant/brands GET,HEAD', '/v1/:tenant/monitor GET,HEAD,POST', '/v1/:tenant/lift GET,HEAD', '/v1/:tenant/lift/rows GET,HEAD',
  '/v1/:tenant/lift/history GET,HEAD', '/v1/:tenant/learn/slots GET,HEAD', '/v1/:tenant/learn/exploring GET,HEAD', '/v1/:tenant/learn/queue GET,HEAD',
  '/v1/:tenant/learn/cycle POST', '/v1/:tenant/learn/proposals GET,HEAD', '/v1/:tenant/learn/proposals/:id/:decision POST', '/v1/:tenant/learn/items/reset POST',
  '/v1/:tenant/learn/recovery POST', '/v1/:tenant/learn/publish POST', '/v1/:tenant/learn/report GET,HEAD,POST', '/v1/:tenant/learn/report/window GET,HEAD',
  '/v1/:tenant/trend/rollup POST', '/v1/:tenant/visitors/:visitorId/receipts GET,HEAD', '/v1/:tenant/visitors/:visitorId/recent GET,HEAD',
  '/v1/:tenant/ledger/batches GET,HEAD', '/v1/:tenant/ledger/erasures GET,HEAD,POST', '/v1/:tenant/ledger/erasures/rewrite POST', '/v1/:tenant/ledger/:id GET,HEAD',
  '/v1/:tenant/replay/:id GET,HEAD',
];
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const admits = (method: string, path: string) => customerRequest(new Request(`https://stamp.invalid${path}`, { method }), path)?.kind ?? 'refused';
/** The vocabulary's routes as an operator calls them, and the same shapes on the slots document. */
const VOCABULARY_CALLS: Array<[string, string]> = [['GET', '/content/vocabulary'], ['PUT', '/content/vocabulary'], ['GET', '/content/vocabulary/history'],
  ['GET', '/content/vocabulary/revisions/1'], ['POST', '/content/vocabulary/validate'], ['POST', '/content/vocabulary/rollback/1'],
  ['POST', '/content/vocabulary/approve/1'], ['GET', '/content/vocabulary/rejections']];

describe('unit:P77.VR3', () => {
  it('logic: LOCK — the customer boundary\'s list is today\'s but for entries whose path begins /content/vocabulary/, and the content kinds it admits are today\'s four and the vocabulary only: every other kind and every unlisted method stays refused', () => {
    const now = CUSTOMER_ROUTES.filter(r => !r.path.startsWith('/content/vocabulary/')).map(r => `${r.path} ${r.methods.join(',')}`);
    expect.soft(now, 'P77.VR3 — every other entry, its path and its methods, as today').toEqual(TODAY);
    const kinds = ['catalog', 'slots', 'learn', 'priors', 'proposals', 'reflex', 'vocabularies', 'Vocabulary', 'content', 'p77-unknown'];
    const table = Object.fromEntries(kinds.map(kind => [kind, METHODS.filter(m => admits(m, `/content/${kind}`) === 'api')]));
    expect.soft(table, 'P77.VR3 — /content/{kind}: the four kinds as today (GET, HEAD, PUT), every other kind refused').toEqual({
      catalog: ['GET', 'HEAD', 'PUT'], slots: ['GET', 'HEAD', 'PUT'], learn: ['GET', 'HEAD', 'PUT'], priors: ['GET', 'HEAD', 'PUT'],
      proposals: [], reflex: [], vocabularies: [], Vocabulary: [], content: [], 'p77-unknown': [],
    });
    const nested = Object.fromEntries(['proposals', 'reflex', 'p77-unknown'].flatMap(kind => [`/content/${kind}/history`, `/content/${kind}/revisions/1`,
      `/content/${kind}/validate`, `/content/${kind}/rollback/1`, `/content/${kind}/approve/1`, `/content/${kind}/rejections`]).map(path => [path, METHODS.filter(m => admits(m, path) === 'api')]));
    expect.soft(Object.entries(nested).filter(([, methods]) => methods.length), 'P77.VR3 — no other kind\'s history, revisions, validate, rollback, approve or rejections is admitted').toEqual([]);
  });

  it('logic: the two vocabulary operations without a `:kind` entry are admitted for their own method only: POST /content/vocabulary/approve/{n} and GET or HEAD /content/vocabulary/rejections', () => {
    expect.soft({ approve: METHODS.filter(m => admits(m, '/content/vocabulary/approve/1') === 'api'), rejections: METHODS.filter(m => admits(m, '/content/vocabulary/rejections') === 'api'),
      approveAlias: METHODS.filter(m => admits(m, '/content/vocabulary/approve/1/') === 'api'), rejectionsAlias: METHODS.filter(m => admits(m, '/content/vocabulary/rejections/x') === 'api') },
    'P77.VR3 — each for its own method, no alias (today neither is admitted)').toEqual({ approve: ['POST'], rejections: ['GET', 'HEAD'], approveAlias: [], rejectionsAlias: [] });
  });

  for (const host of HOSTS) {
    it(`host (${host}): the vocabulary routes require operator authority as the other content routes do: no credential is refused 401 and a credential with no membership on the tenant 403, each as the slots document's same route answers`, async () => {
      const s = await stamp(host);
      const refusals = async (method: string, path: string) => {
        const body = method === 'GET' ? undefined : {};
        const none = await s.call(method, path, { token: null, ...(body ? { body } : {}) });
        const stranger = await s.call(method, path, { token: s.tokens.operator, tenant: OTHER_TENANT, ...(body ? { body } : {}) });
        return [none.status, stranger.status];
      };
      const slots = await refusals('GET', '/content/slots');
      expect(slots, `${host}: PRECONDITION — the slots document's refusals (W08 C1: no credential 401, no membership 403)`).toEqual([401, 403]);
      const table: Record<string, number[]> = {};
      for (const [method, path] of VOCABULARY_CALLS) table[`${method} ${path}`] = await refusals(method, path);
      expect.soft(table, `${host}: P77.VR3 — every vocabulary route refused without operator authority as the other content routes are (today the boundary's 404 for everyone)`)
        .toEqual(Object.fromEntries(VOCABULARY_CALLS.map(([method, path]) => [`${method} ${path}`, [401, 403]])));
    }, 120_000);

    it(`host (${host}): LOCK — the customer boundary's other refusals stay: another content kind, the demo bootstrap, the Meridian surface, and a vocabulary operation under a method not admitted answer 404 (the boundary's or the router's; the logic test tells them apart), even to an operator`, async () => {
      const s = await stamp(host);
      const calls: Array<[string, string]> = [['GET', '/content/proposals'], ['PUT', '/content/reflex'], ['POST', '/ops/demo-bootstrap/complete'], ['GET', '/meridian/api/state'],
        ['GET', '/content/vocabulary/approve/1'], ['POST', '/content/vocabulary/rejections'], ['DELETE', '/content/vocabulary']];
      const answers: Record<string, unknown> = {};
      for (const [method, path] of calls) { const a = await s.call(method, path, { token: s.tokens.operator, ...(method === 'GET' ? {} : { body: {} }) }); answers[`${method} ${path}`] = [a.status, a.body]; }
      expect.soft(answers, `${host}: P77.VR3 — each the boundary's own refusal`).toEqual(Object.fromEntries(calls.map(([method, path]) => [`${method} ${path}`, BOUNDARY_404])));
    }, 120_000);
  }
});
