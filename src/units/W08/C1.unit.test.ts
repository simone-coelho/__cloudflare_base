// src/units/W08/C1.unit.test.ts
// Batch W08-C1 — a stamp owner initializes a provisioned tenant's first
// configuration publication set on the customer profile.
//
// AUTHORITY
//   · Document 35 §5 row W08 (docs/architecture/35-audit-verification-and-source-of-truth.md:398):
//     "… seed idempotently and fail visibly … provision required alert/config/identity
//     material. Test rerun, partial failure …" — applied to the customer profile.
//   · Decision D01 (docs/remediation/decisions/D01-customer-profile-approved-2026-09-16.json):
//     the strict customer profile in the existing entry point with EXPLICIT permitted
//     APIs; no resource mutation or deployment inside the engine. The door below
//     creates one R2 publication set from compiled defaults and nothing else.
//   · The pilot runbook's missing step (/home/simonecoelho/rem/_evidence/pilot/RUNBOOK-staging.md
//     §2.3 step 4): on DEPLOYMENT_PROFILE=customer with AUTH_MODE=enforced nothing
//     creates a provisioned tenant's first set; every versioned write needs one
//     (src/config/publication.ts:349, :603, :611), the demo door answers 404 there
//     (src/routes/demoBootstrap.ts:69) and init-local is local-only
//     (scripts/init-local.mjs:10-11).
//
// THE RULED REPRESENTATION (build from this, not from today's engine)
//   1. THE DOOR. `POST /content/publication/initialize`: one new entry in
//      src/customerBoundary.ts CUSTOMER_ROUTES, `{ path: '/content/publication/initialize',
//      methods: post }`, mounted on every profile at exactly that Hono path (the
//      W01.08 case at src/index.api-boundary.test.ts:2356-2359 requires every
//      CUSTOMER_ROUTES entry to be an actually mounted path and method). It runs
//      under the ordinary tenant middleware (X-Tenant naming a provisioned tenant,
//      src/tenancy/middleware.ts:116-126: an unprovisioned one is refused 403
//      `{ ok: false, error: 'Tenant unavailable' }` as today) and the operator
//      credential middleware `operatorJwt` (src/middleware/operatorAuth.ts:31-48:
//      no credential 401; on the customer profile a credential whose grants —
//      D1 memberships, operatorAuth.ts:17-18 — do not name the tenant 403).
//   2. THE OWNER. Additionally the caller's subject must be a stamp owner,
//      `stampOwner(env, subject)` (src/auth/authority.ts:28-35); a member who is
//      not an owner is refused 403. Owner status alone is not a grant: an owner
//      without a membership on the tenant is refused 403 (as above).
//   3. NO DOCUMENT. An empty body (or `{}`) is the only request; a JSON body with
//      any member is refused 400 `{ ok: false, error: 'no document is accepted;
//      publish through /content and /config' }` and nothing is created. Nothing
//      is discovered, defaulted from the caller, or migrated (D01).
//   4. THE SET. On a tenant with no head the door calls `initializePublicationSet`
//      (src/config/publication.ts:755) with EXACTLY init-local's six members, in
//      init-local's order (scripts/init-local.mjs:131-138): content EMPTY_CATALOG,
//      slots DEFAULT_SLOTS, learn DEFAULT_LEARN, reflex DEFAULT_REFLEX_CONFIG under
//      `reflexScopeForTenant(tenant)`, priors EMPTY_PRIORS, proposals EMPTY_PROPOSALS,
//      each `{ revision: 1, value: <the compiled default>, actor: <the caller's
//      subject>, note: <a note naming POST /content/publication/initialize>, at:
//      <now> }`, operationId `0:` + crypto.randomUUID(). It answers 200
//      `{ ok: true, publication: <set revision>, state: 'initialized' }`, keys
//      sorted (R-P3). The compiled defaults are imported here from the same
//      modules init-local imports them from (scripts/init-local.mjs:111-115),
//      never retyped; a read answers each as its kind's write validator admits it
//      (`kind.validate(default).value`, the value initializePublicationSet stores,
//      publication.ts:782-787).
//   5. IDEMPOTENT, FAILING VISIBLY.
//      · A head with a committed set: 200 `{ ok: true, publication: <the committed
//        set revision>, state: 'already initialized' }` and NO write (no R2 put or
//        delete, no audit row).
//      · A head with no committed set whose pending operation is an initialization
//        (`operation.initialize === true`) — the door's own interrupted call, or one
//        written as init-local writes it: the door re-issues the six compiled
//        defaults with the PENDING operation's own operationId, actor, note and at
//        (head.pending.set.operation), which `initializePublicationSet` finishes
//        when the digests agree (publication.ts:807), preserving the original
//        attribution as /content/catalog/publication/recover does; it answers 200
//        `{ ok: true, publication: 1, state: 'initialization finished' }`.
//      · Any other pending head (a pending initialization of another document set,
//        e.g. the demo door's four-member one): 409 `{ ok: false, … }` and the
//        stored objects are left byte-identical (initializePublicationSet refuses
//        `publication_conflict` before any write, publication.ts:807).
//      · A storage failure during the door's own write answers its PublicationError
//        status (503 `publication_unavailable`), as contentRoutes.onError does
//        (src/routes/content.ts:51-58); the same call again finishes it.
//   6. AUDIT. The owner routes (the `admin` gate, src/routes/auth.ts:68-77) audit
//      every change they make with `storeFor(env).audit(...)` — an operator_audit
//      row (auth.ts:253, :274, :286) — not with src/auth/subjectAudit.ts, which
//      records reads and operations on a SHOPPER subject (SUBJECT_AUDIT_ROUTES,
//      src/auth/store.ts:50-54). So the door writes exactly one
//      `storeFor(env).audit({ at, action: 'publication_initialized', actorId:
//      <subject>, actorEmail, targetId: <tenant>, detail })` row per set it writes
//      ('initialized' or 'initialization finished') and none for 'already
//      initialized', a refusal or a failure.
//   7. THE KIT. docs/kit/02-api-reference.md states the door in ONE short paragraph
//      (at most 1000 characters) naming the route, the stamp-owner-and-membership
//      authority, the six compiled defaults (catalog, slots, learn, Reflex, priors,
//      proposals), idempotence ("already initialized") and "no document is
//      accepted"; and it no longer says "no HTTP endpoint initializes
//      configuration" (docs/kit/02-api-reference.md:1579) or "Initialization
//      recovery remains library-only" (:1583), both false once the door exists.
//
// THE HARNESS (decided from the code)
//   · host: the REAL Worker default export of src/index.ts (its customer boundary,
//     tenant middleware and mounted routes) in process, through ./_customer.ts,
//     on DEPLOYMENT_PROFILE=customer + AUTH_MODE=enforced, on both shopper hosts
//     (REFLEX_HOST session and do) where a shopper call is made. The authority
//     store is `memoryAuthority` (src/auth/authority.ts:151-152, the synthetic
//     equivalent of the D1 store `authorityFor` falls back to at :144) with the
//     accounts in `memoryStore`, as src/routes/content.test.ts:127 and
//     src/units/W23/B1.unit.test.ts:408 mount the customer profile.
//   · native: src/units/_native.ts `customerAssetRuntime` (:147-168, DEPLOYMENT_PROFILE
//     customer, AUTH_MODE enforced, the real Worker bundled for workerd) binds no
//     D1 database and no R2 bucket, and `openNativeRuntime` (:88-108) binds no D1,
//     so no native leg can sign an owner in or write a set; _native.ts is outside
//     this batch's write set. The native leg therefore measures in workerd exactly
//     what needs neither: the customer boundary admits the door (no credential
//     401, an unprovisioned tenant 403) and the demo door stays 404. A native
//     owner-to-200 leg needs a D1 + R2 runtime in _native.ts: a named residual.
//
// THE WRITE BOUNDARY GRANTED TO THE IMPLEMENTER
//   src/routes/content.ts (a `contentRoutes.post('/publication/initialize', …)`)
//   or a new src/routes/publicationInit.ts mounted from src/index.ts at that path;
//   src/customerBoundary.ts (the one CUSTOMER_ROUTES entry); src/index.ts (the
//   mount, if a new module); src/auth/store.ts (ONLY the AuditAction union gains
//   'publication_initialized'); docs/kit/02-api-reference.md. Never
//   src/routes/demoBootstrap.ts; never src/config/publication.ts (no defect forces
//   it: `initializePublicationSet` already creates, finishes and refuses exactly
//   as ruled — measured on a scratch probe at bd5040a7, see the units.json rows).
//
// R10 (what already locks or contradicts the ruled behaviour, grepped at bd5040a7)
//   · src/index.api-boundary.test.ts:2356-2359 (W01.08) requires every CUSTOMER_ROUTES
//     entry to be a mounted Hono path and method: mount the door at exactly
//     '/content/publication/initialize' (a constraint, not a collision).
//   · docs/kit/02-api-reference.md:1579 and :1583 carry the two sentences the kit leg
//     requires gone; no test locks them.
//   · src/routes/demoBootstrap.ts:8-10 and scripts/init-local.mjs:22-24 say no HTTP
//     route initializes a publication: comments in files outside the grant, left
//     stale (named, not changed).
//   · No test asserts a closed AuditAction list, a 404 for this path, or the callers
//     of initializePublicationSet.
//
// No customer name, no customer taxonomy: the tenants are synthetic.

import { vi, describe, it, expect } from 'vitest';

// The module doubles src/demos/kit/root.worker.test.ts:24-26 registers to load
// the real Worker in process; none of them is on a path these units call.
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import type { DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';

import { CHECKOUT_ROOT, customerAssetRuntime } from '../_native';
import { customerStamp, HOSTS, OPERATOR, OTHER_TENANT, OWNER, SDK_KEY, TENANT, UNPROVISIONED, type Answer, type Stamp } from './_customer';

const DOOR = '/content/publication/initialize';
const NO_DOCUMENT = 'no document is accepted; publish through /content and /config';
const UNINITIALIZED = 'Coherent configuration publication is uninitialized';
const OPERATION_ID = /^0:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const headKey = (tenant: string) => `config-publication/v2/${tenant}/head.json`;
const setKey = (tenant: string, n: number) => `config-publication/v2/${tenant}/set/${n}.json`;

interface Member { name: string; kind: DocumentKind<unknown>; value: unknown; scope: (tenant: string) => string; read: string }
/** init-local's six members, in init-local's order, from the modules init-local imports (scripts/init-local.mjs:111-115, :131-138). */
const COMPILED: Member[] = [
  { name: 'catalog', kind: CONTENT_KIND as DocumentKind<unknown>, value: EMPTY_CATALOG, scope: t => t, read: '/content/catalog' },
  { name: 'slots', kind: SLOTS_KIND as DocumentKind<unknown>, value: DEFAULT_SLOTS, scope: t => t, read: '/content/slots' },
  { name: 'learn', kind: LEARN_KIND as DocumentKind<unknown>, value: DEFAULT_LEARN, scope: t => t, read: '/content/learn' },
  { name: 'reflex', kind: REFLEX_KIND as DocumentKind<unknown>, value: DEFAULT_REFLEX_CONFIG, scope: t => reflexScopeForTenant(t), read: '/config/reflex' },
  { name: 'priors', kind: PRIORS_KIND as DocumentKind<unknown>, value: EMPTY_PRIORS, scope: t => t, read: '/content/priors' },
  { name: 'proposals', kind: PROPOSALS_KIND as DocumentKind<unknown>, value: EMPTY_PROPOSALS, scope: t => t, read: `/v1/${TENANT}/learn/proposals` },
];
/** A compiled default as its kind's write validator admits it: the value initializePublicationSet stores (publication.ts:782-787). */
function admitted(member: Member): unknown {
  const checked = member.kind.validate(member.value);
  if (!checked.ok) throw new Error(`the compiled default for ${member.name} does not validate: ${JSON.stringify(checked.errors)}`);
  return checked.value;
}
/** `<kind name>:<member scope>`, the set's own member key (publication.ts:95). */
const memberKey = (member: Member, tenant = TENANT) => `${member.kind.name}:${member.scope(tenant)}`;

/** The six members exactly as init-local writes them (scripts/init-local.mjs:130-138). */
const initLocalBaselines = (tenant: string, at: number): PublicationBaseline[] => COMPILED.map(member => ({
  kind: member.kind, scope: member.scope(tenant),
  revision: { revision: 1, value: member.value, actor: 'init-local', note: 'local initialization from the compiled defaults (scripts/init-local.mjs)', at },
}));
/** The four members as the demo door writes them (src/routes/demoBootstrap.ts:46, :87-110), with a catalogue of its caller's own. */
const demoDoorBaselines = (tenant: string, at: number): PublicationBaseline[] => {
  const supplied: Record<string, unknown> = { reflex: DEFAULT_REFLEX_CONFIG, catalog: { version: 'w08-foreign-catalogue', pieces: [] }, slots: DEFAULT_SLOTS, learn: DEFAULT_LEARN };
  const kinds: Record<string, [DocumentKind<unknown>, string]> = { reflex: [REFLEX_KIND as DocumentKind<unknown>, reflexScopeForTenant(tenant)],
    catalog: [CONTENT_KIND as DocumentKind<unknown>, tenant], slots: [SLOTS_KIND as DocumentKind<unknown>, tenant], learn: [LEARN_KIND as DocumentKind<unknown>, tenant] };
  return ['reflex', 'catalog', 'slots', 'learn'].map(m => ({ kind: kinds[m]![0], scope: kinds[m]![1],
    revision: { revision: 1, value: supplied[m], actor: 'w08-demo-caller', note: `demo scope bootstrap: ${m}`, at } }));
};

/** The door, as a stamp owner (unless another token is given), with no body. */
const door = (s: Stamp, opts: Parameters<Stamp['call']>[2] = {}) => s.call('POST', DOOR, opts);
const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
const auditRows = (s: Stamp) => s.accounts.log.filter(row => String(row.action) === 'publication_initialized');
const storedSet = (s: Stamp, n: number) => JSON.parse(s.storage.objects.get(setKey(TENANT, n)) ?? 'null') as
  { revision: number; refs: Record<string, { revision: number }>; operation: { operationId: string; actor: string; note: string; at: number; initialize: boolean } } | null;

/** A shopper session through the route the SDK uses (works before any set exists). */
async function shopperSession(s: Stamp): Promise<string> {
  const session = await s.call('POST', `/v1/${TENANT}/identity/session`, { token: null, body: {}, headers: { 'X-SDK-Key': SDK_KEY } });
  const capability = (session.body.session as { capability?: string } | undefined)?.capability;
  expect(session.status, `PRECONDITION (${s.host}): a shopper session is issued: ${show(session)}`).toBe(200);
  return String(capability);
}
const snapshot = (s: Stamp, capability: string, page: string) => s.call('POST', `/v1/${TENANT}/decisions/snapshot`,
  { token: null, body: { page, pageInstance: `w08-${page}-${crypto.randomUUID()}` }, headers: { 'X-SDK-Key': SDK_KEY, 'X-Shopper-Session': capability } });

// ─────────────────────────────────────────────────────────────────────────────
describe('unit:W08.C1.01', () => {
  it('host: a stamp owner with a membership initializes a provisioned tenant that has no set; the six compiled defaults read back at revision 1, a versioned PUT succeeds and a shopper snapshot is served, on both shopper hosts', async () => {
    for (const host of HOSTS) {
      const s = await customerStamp(host);
      const capability = await shopperSession(s);
      const before = Date.now();
      const answer = await door(s);
      const after = Date.now();
      expect(answer.status, `${host}: a stamp owner with a membership calls POST ${DOOR} on the customer profile and the tenant's first set is created `
        + `(today the customer boundary does not admit the door: src/customerBoundary.ts CUSTOMER_ROUTES has no entry for it): ${show(answer)}`).toBe(200);
      expect(answer.body, `${host}: the answer names the state and the set revision`).toEqual({ ok: true, publication: 1, state: 'initialized' });
      expect(Object.keys(answer.body), `${host}: keys sorted (R-P3)`).toEqual(['ok', 'publication', 'state']);

      // The set: exactly init-local's six members, revision 1, attributed to the caller, named by the door.
      const set = storedSet(s, 1);
      expect(Object.keys(set?.refs ?? {}).sort(), `${host}: the set holds exactly the six members`).toEqual(COMPILED.map(m => memberKey(m)).sort());
      for (const member of COMPILED) expect(set?.refs[memberKey(member)]?.revision, `${host}: ${member.name} is at revision 1`).toBe(1);
      expect(set?.operation.initialize, `${host}: an initialization`).toBe(true);
      expect(set?.operation.actor, `${host}: attributed to the caller's subject`).toBe(OWNER);
      expect(set?.operation.note ?? '', `${host}: the note names the door`).toContain(DOOR);
      expect(set?.operation.operationId ?? '', `${host}: operationId is 0: plus a UUID`).toMatch(OPERATION_ID);
      expect(set!.operation.at, `${host}: stamped at the call`).toBeGreaterThanOrEqual(before);
      expect(set!.operation.at, `${host}: stamped at the call`).toBeLessThanOrEqual(after);

      // Every read answers its compiled default at revision 1.
      for (const member of COMPILED.filter(m => m.name !== 'reflex' && m.name !== 'proposals')) {
        const read = await s.call('GET', member.read);
        expect(read.status, `${host}: GET ${member.read} after the door: ${show(read)}`).toBe(200);
        expect(read.body, `${host}: GET ${member.read} answers the stored compiled default at revision 1, by the caller`)
          .toMatchObject({ source: 'stored', revision: 1, actor: OWNER });
        expect(read.body.document, `${host}: GET ${member.read} is the compiled default`).toEqual(admitted(member));
      }
      const reflexMember = COMPILED.find(m => m.name === 'reflex')!;
      const reflex = await s.call('GET', reflexMember.read);
      expect(reflex.status, `${host}: GET /config/reflex after the door: ${show(reflex)}`).toBe(200);
      expect(reflex.body, `${host}: the Reflex document is stored at revision 1, by the caller`).toMatchObject({ source: 'stored', revision: 1, actor: OWNER });
      expect(reflex.body.authored, `${host}: the Reflex document is the compiled default`).toEqual(admitted(reflexMember));
      const proposalsMember = COMPILED.find(m => m.name === 'proposals')!;
      const proposals = await s.call('GET', proposalsMember.read);
      expect(proposals.status, `${host}: GET ${proposalsMember.read} after the door: ${show(proposals)}`).toBe(200);
      expect(proposals.body.proposals, `${host}: the proposals are the compiled default's`).toEqual((admitted(proposalsMember) as { proposals: unknown[] }).proposals);

      // The audit: one owner-action row.
      const rows = auditRows(s);
      expect(rows.length, `${host}: one operator_audit row 'publication_initialized'`).toBe(1);
      expect(rows[0], `${host}: the row names the caller and the tenant`).toMatchObject({ actorId: OWNER, targetId: TENANT });

      // A versioned write now has a set to publish over (publication.ts:132-135).
      const slots = await s.call('GET', '/content/slots');
      const pin = slots.body.publication as { revision: number; digest: string };
      const document = { pages: { home: [{ slot: 'hero', take: 1, weights: {} }] } };
      const put = await s.call('PUT', '/content/slots', { body: { document, note: 'w08 first publication' },
        headers: { 'If-Match': `"${slots.body.revision}/${pin?.revision}/${pin?.digest}"`, 'Idempotency-Key': `${slots.body.revision}:${crypto.randomUUID()}` } });
      expect(put.status, `${host}: PUT /content/slots with If-Match and Idempotency-Key succeeds over the initialized set: ${show(put)}`).toBe(200);
      expect(put.body, `${host}: the slots document is at revision 2 in set 2`).toMatchObject({ ok: true, revision: 2, publication: { revision: 2 } });

      // The shopper is served from the initialized set: the empty compiled catalogue decides nothing, the set's revisions are named.
      const served = await snapshot(s, capability, 'home');
      expect(served.status, `${host}: POST /v1/${TENANT}/decisions/snapshot after the door: ${show(served)}`).toBe(200);
      expect(served.body.versions, `${host}: the snapshot pins the initialized set (catalog 1, learn 1, Reflex 1, slots 2)`).toMatchObject({ catalog: 1, learn: 1, config: 1, slots: 2 });
      expect(served.body.decisions, `${host}: EMPTY_CATALOG holds no piece, so the page decides none`).toEqual([]);
    }
  }, 60_000);

  it('control: before the door every one of those reads and the shopper snapshot refuse because the tenant has no set, on both shopper hosts', async () => {
    for (const host of HOSTS) {
      const s = await customerStamp(host);
      for (const member of COMPILED) {
        const read = await s.call('GET', member.read);
        if (member.name === 'proposals') {
          // Measured at bd5040a7: this route answers the same uninitialized publication as 500 (src/routes/decisions.ts:798-807 has no PublicationError mapping).
          expect(read.status, `${host}: GET ${member.read} before the door: ${show(read)}`).toBeGreaterThanOrEqual(500);
          expect(JSON.stringify(read.body), `${host}: GET ${member.read} names the uninitialized publication`).toContain(UNINITIALIZED);
        } else {
          expect(read.status, `${host}: GET ${member.read} before the door: ${show(read)}`).toBe(503);
          expect(read.body.code, `${host}: GET ${member.read} names the uninitialized publication`).toBe('publication_uninitialized');
        }
      }
      const capability = await shopperSession(s);
      const served = await snapshot(s, capability, 'home');
      expect(served.status, `${host}: the snapshot before the door: ${show(served)}`).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(served.body), `${host}: the snapshot names the uninitialized publication`).toContain(UNINITIALIZED);
      expect(s.storage.objects.has(headKey(TENANT)), `${host}: no head exists`).toBe(false);
    }
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('unit:W08.C1.02', () => {
  it('host: the door is idempotent and fails visibly — a repeat writes nothing, an interrupted initialization (its own, or one written as init-local writes it) is finished, any other pending head is refused 409 and left byte-identical', async () => {
    // (a) The same call twice: 'already initialized', the same revision, no second write.
    const s = await customerStamp('session');
    const first = await door(s);
    expect(first.status, `the first call initializes (today the customer boundary does not admit ${DOOR}): ${show(first)}`).toBe(200);
    expect(first.body).toEqual({ ok: true, publication: 1, state: 'initialized' });
    const writes = s.storage.writes().length, bytes = s.storage.bytes();
    const again = await door(s);
    expect(again.status, `the repeat: ${show(again)}`).toBe(200);
    expect(again.body, 'the repeat names the committed set').toEqual({ ok: true, publication: 1, state: 'already initialized' });
    expect(Object.keys(again.body), 'keys sorted (R-P3)').toEqual(['ok', 'publication', 'state']);
    expect(s.storage.writes().slice(writes), 'the repeat puts and deletes nothing').toEqual([]);
    expect(s.storage.bytes(), 'the repeat leaves every stored object as it was').toEqual(bytes);
    expect(auditRows(s).length, 'the repeat writes no audit row').toBe(1);

    // (b) After a publication the committed set is revision 2, and the door says so and still writes nothing.
    const slots = await s.call('GET', '/content/slots');
    const pin = slots.body.publication as { revision: number; digest: string };
    const put = await s.call('PUT', '/content/slots', { body: { document: { pages: { home: [{ slot: 'hero', take: 1, weights: {} }] } }, note: 'w08' },
      headers: { 'If-Match': `"${slots.body.revision}/${pin?.revision}/${pin?.digest}"`, 'Idempotency-Key': `${slots.body.revision}:${crypto.randomUUID()}` } });
    expect(put.status, `PRECONDITION: a publication over the initialized set: ${show(put)}`).toBe(200);
    const published = s.storage.writes().length;
    const later = await door(s);
    expect(later.body, `the door after a publication names the committed set revision: ${show(later)}`).toEqual({ ok: true, publication: 2, state: 'already initialized' });
    expect(s.storage.writes().slice(published), 'and writes nothing').toEqual([]);

    // (c) The door's own call interrupted by a storage outage at the set write: visible, then finished by the same call.
    const own = await customerStamp('session');
    own.storage.failPut = key => key.startsWith(`config-publication/v2/${TENANT}/set/`);
    const interrupted = await door(own);
    own.storage.failPut = null;
    expect(interrupted.status, `a storage outage during the door's write answers its publication failure: ${show(interrupted)}`).toBe(503);
    expect(auditRows(own).length, 'a failed call writes no audit row').toBe(0);
    const ownPending = JSON.parse(own.storage.objects.get(headKey(TENANT)) ?? 'null') as { committed: unknown; pending: { set: { operation: { operationId: string; actor: string } } } | null } | null;
    expect(ownPending?.committed ?? null, 'PRECONDITION: the outage left a pending initialization').toBeNull();
    expect(ownPending?.pending?.set.operation.actor, 'PRECONDITION: the pending initialization is the door\'s, by the caller').toBe(OWNER);
    const finished = await door(own);
    expect(finished.status, `the same call again: ${show(finished)}`).toBe(200);
    expect(finished.body, 'the interrupted initialization is finished').toEqual({ ok: true, publication: 1, state: 'initialization finished' });
    expect(storedSet(own, 1)?.operation.operationId, 'with the pending operation\'s own operationId').toBe(ownPending?.pending?.set.operation.operationId);
    expect(auditRows(own).length, 'one audit row for the set written').toBe(1);

    // (d) An initialization written as init-local writes it, interrupted at the set write: finished, its attribution kept.
    const local = await customerStamp('do');
    const operationId = `0:${crypto.randomUUID()}`, at = Date.now() - 60_000;
    local.storage.failPut = key => key.startsWith(`config-publication/v2/${TENANT}/set/`);
    await expect(initializePublicationSet(local.env, initLocalBaselines(TENANT, at), operationId), 'PRECONDITION: the init-local initialization is interrupted').rejects.toThrow();
    local.storage.failPut = null;
    const pending = JSON.parse(local.storage.objects.get(headKey(TENANT)) ?? 'null') as { committed: unknown; pending: { set: { operation: { initialize: boolean } } } | null } | null;
    expect(pending?.committed ?? null, 'PRECONDITION: no committed set').toBeNull();
    expect(pending?.pending?.set.operation.initialize, 'PRECONDITION: the pending operation is an initialization').toBe(true);
    const done = await door(local);
    expect(done.status, `the door finishes the interrupted initialization: ${show(done)}`).toBe(200);
    expect(done.body).toEqual({ ok: true, publication: 1, state: 'initialization finished' });
    expect(storedSet(local, 1)?.operation, 'the finished set is the pending operation, its operationId and attribution kept')
      .toMatchObject({ operationId, actor: 'init-local', at, initialize: true });
    const catalog = await local.call('GET', '/content/catalog');
    expect(catalog.status, `the catalog reads after the finish: ${show(catalog)}`).toBe(200);
    expect(catalog.body).toMatchObject({ source: 'stored', revision: 1, actor: 'init-local' });
    expect(catalog.body.document).toEqual(admitted(COMPILED[0]!));

    // (e) A foreign pending head (the demo door's four-member initialization, interrupted): 409 and byte-identical.
    const foreign = await customerStamp('session');
    foreign.storage.failPut = key => key.startsWith(`config-publication/v2/${TENANT}/set/`);
    await expect(initializePublicationSet(foreign.env, demoDoorBaselines(TENANT, Date.now()), `0:${crypto.randomUUID()}`), 'PRECONDITION: the foreign initialization is interrupted').rejects.toThrow();
    foreign.storage.failPut = null;
    expect(foreign.storage.objects.has(headKey(TENANT)), 'PRECONDITION: a pending head exists').toBe(true);
    const held = foreign.storage.bytes(), heldWrites = foreign.storage.writes().length;
    const refused = await door(foreign);
    expect(refused.status, `a pending head the door did not write from the compiled defaults is refused: ${show(refused)}`).toBe(409);
    expect(refused.body.ok, 'refused').toBe(false);
    expect(foreign.storage.writes().slice(heldWrites), 'the refusal puts and deletes nothing').toEqual([]);
    expect(foreign.storage.bytes(), 'every stored object is byte-identical').toEqual(held);
    expect(auditRows(foreign).length, 'a refusal writes no audit row').toBe(0);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('unit:W08.C1.03', () => {
  it('host: the door refuses no credential (401), a member who is not a stamp owner (403), an owner without a membership on the tenant (403), an unprovisioned tenant (403 Tenant unavailable) and any document (400), creating nothing', async () => {
    const s = await customerStamp('session');
    const anonymous = await door(s, { token: null });
    expect(anonymous.status, `no credential is refused by the operator credential middleware (today the customer boundary does not admit ${DOOR}): ${show(anonymous)}`).toBe(401);
    const member = await door(s, { token: s.tokens.operator });
    expect(member.status, `${OPERATOR} holds a membership on ${TENANT} but is not a stamp owner: ${show(member)}`).toBe(403);
    const stranger = await door(s, { tenant: OTHER_TENANT });
    expect(stranger.status, `${OWNER} is a stamp owner without a membership on ${OTHER_TENANT}: ${show(stranger)}`).toBe(403);
    const unprovisioned = await door(s, { tenant: UNPROVISIONED });
    expect(unprovisioned.status, `X-Tenant names a tenant the registry does not provision: ${show(unprovisioned)}`).toBe(403);
    expect(unprovisioned.body, 'refused by the tenant middleware as today').toEqual({ ok: false, error: 'Tenant unavailable' });
    const supplied = await door(s, { body: { catalog: EMPTY_CATALOG } });
    expect(supplied.status, `a body with a member: ${show(supplied)}`).toBe(400);
    expect(supplied.body, 'no document is accepted').toMatchObject({ ok: false, error: NO_DOCUMENT });
    expect(s.storage.writes(), 'no refusal wrote anything').toEqual([]);
    expect(s.storage.objects.has(headKey(TENANT)) || s.storage.objects.has(headKey(OTHER_TENANT)), 'no set was created').toBe(false);
    expect(auditRows(s).length, 'no refusal wrote an audit row').toBe(0);
  }, 60_000);

  it('native: in workerd the customer boundary admits the door — no credential 401, an unprovisioned tenant 403 — while the demo door stays 404', async () => {
    const host = await customerAssetRuntime('staging');
    try {
      const send = async (path: string, headers: Record<string, string> = {}) => {
        const response = await host.runtime.dispatchFetch(`https://acme.example${path}`, { method: 'POST', headers });
        return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
      };
      const demo = await send('/ops/demo-bootstrap');
      expect(demo.status, `the demo door is not a customer route: ${show(demo)}`).toBe(404);
      const anonymous = await send(DOOR);
      expect(anonymous.status, `workerd: POST ${DOOR} with no credential reaches the operator credential middleware (today the boundary answers 404): ${show(anonymous)}`).toBe(401);
      const unprovisioned = await send(DOOR, { 'X-Tenant': UNPROVISIONED });
      expect(unprovisioned.status, `workerd: an unprovisioned tenant: ${show(unprovisioned)}`).toBe(403);
      expect(unprovisioned.body).toEqual({ ok: false, error: 'Tenant unavailable' });
      expect(host.outbound(), 'no network').toBe(0);
    } finally { await host.dispose(); }
  }, 120_000);

  it('control: the demo door still answers 404 on the customer profile in process', async () => {
    const s = await customerStamp('session');
    const demo = await s.call('POST', '/ops/demo-bootstrap', { body: { reflex: DEFAULT_REFLEX_CONFIG, catalog: EMPTY_CATALOG, slots: DEFAULT_SLOTS, learn: DEFAULT_LEARN } });
    expect(demo.status, `POST /ops/demo-bootstrap on the customer profile: ${show(demo)}`).toBe(404);
    expect(s.storage.writes(), 'and writes nothing').toEqual([]);
  }, 60_000);

  it('kit: docs/kit/02-api-reference.md states the door in one short paragraph and no longer says no HTTP endpoint initializes configuration', () => {
    const kit = readFileSync(resolve(CHECKOUT_ROOT, 'docs/kit/02-api-reference.md'), 'utf8');
    expect(kit.includes(`POST ${DOOR}`), `the kit states POST ${DOOR}`).toBe(true);
    const paragraph = kit.split(/\n\s*\n/).find(block => block.includes(`POST ${DOOR}`)) ?? '';
    expect(paragraph.length, 'one short paragraph (at most 1000 characters)').toBeLessThanOrEqual(1000);
    const flat = paragraph.replace(/`/g, '').replace(/\s+/g, ' ');
    for (const [name, pattern] of [
      ['the stamp-owner authority', /stamp owner/i], ['the membership on the tenant', /membership/i],
      ['the compiled defaults', /compiled default/i], ['catalog', /\bcatalog(?:ue)?\b/i], ['slots', /\bslots\b/i], ['learn', /\blearn(?:ing)?\b/i],
      ['Reflex', /\breflex\b/i], ['priors', /\bpriors\b/i], ['proposals', /\bproposals\b/i],
      ['idempotence', /already initialized/i], ['no document', /no document is accepted/i],
    ] as const) expect(flat, `the paragraph names ${name}`).toMatch(pattern);
    const flatKit = kit.replace(/\s+/g, ' ');
    expect(flatKit.includes('no HTTP endpoint initializes configuration'), 'the kit still says "no HTTP endpoint initializes configuration" (docs/kit/02-api-reference.md:1579), false once the door exists').toBe(false);
    expect(flatKit.includes('Initialization recovery remains library-only'), 'the kit still says "Initialization recovery remains library-only" (docs/kit/02-api-reference.md:1583), false once the door exists').toBe(false);
  });
});
