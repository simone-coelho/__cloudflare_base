// src/units/P48/LEDGER.unit.test.ts
// P48 under the Closure Ledger: the tests for the LOCAL criteria of the P48 work
// order (the fourth parity programme (amendment 3),
// ticket P48 "A bootstrapped tenant's priors and proposals doors
// answer, not 503"). DC1 (D1, RESOLVED by the owner's rule R-P78: the product tells
// the operator) is exercised inside BP1-BP3; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P48.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-3/BTI-Parity-Amendment-2026-10-17.md,
//     section 2, P48): "a tenant bootstrapped through the demo door reads and
//     publishes priors and proposals as an init-local tenant does (the specifier rules
//     whether the door seeds the compiled empties for the two members when the caller
//     does not supply them, keeping existing four-member callers working, or whether a
//     repair publishes the missing members into an existing four-member set once,
//     under the same operator authority; both leave 'nothing discovered or inferred'
//     true for the four supplied members); an already-bootstrapped four-member tenant
//     has a named path to the same state; the priors and proposals reads of a tenant
//     that still lacks them answer a refusal naming the missing member and the path,
//     not a bare 503; kit 02 states it";
//   · the door today: src/routes/demoBootstrap.ts:46 (`MEMBERS = reflex, catalog, slots,
//     learn`), :68-118 (404 on the customer profile, 403 outside development, 422 for a
//     missing member or an invalid document, 409 `already_initialized` on a scope with a
//     head, then `initializePublicationSet` with the four supplied documents at
//     revision 1, note `demo scope bootstrap: <member>`, answering `{ ok: true, scope,
//     members, publication }`);
//   · the six-member pattern: scripts/init-local.mjs:131-138 and the W08-C1 door
//     (src/routes/content.ts:1037-1083): the four plus `EMPTY_PRIORS`
//     (src/learn/priors.ts:21) and `EMPTY_PROPOSALS` (src/learn/cycle.ts:31), each at
//     revision 1;
//   · the refusal today: a read of a non-optional member the set lacks fails
//     `readPinnedPublication`'s `required(ref)` (src/config/publication.ts:475) with
//     503 "Configuration publication authority unavailable"; a publish of one is refused
//     the same way (publication.ts:616-617); `GET /content/priors` answers it through
//     contentRoutes.onError (content.ts:60), `GET /v1/:tenant/learn/proposals`
//     (decisions.ts:812-820) through the application's error handler
//     (src/middleware/error.ts: 500 with the error's text as `message`); the live
//     rehearsal (live/lanes/L2/REPORT.md §2 item 3, L3/REPORT.md item 2) met it on every
//     bootstrapped tenant.
//
// THE RULING (D1 leaves seeding or repair to the specifier, inside the door's
// principle that nothing is discovered or inferred for the four supplied members):
//   · BOTH, because both are needed: SEEDING for every new bootstrap and a ONE-TIME
//     REPAIR for a tenant bootstrapped before the build. The door refuses any scope that
//     has a head (409, a lock below), so seeding alone leaves every existing four-member
//     tenant at 503 for ever; a repair alone would leave every new bootstrap broken until
//     someone ran it. Neither discovers or infers anything: the two members are the
//     compiled empties init-local and the W08-C1 door already write, which state "no
//     imported prior, no proposal" — exactly what a set without them means to the
//     learning path (LearnStats `priorsFor`, src/durable-objects/LearnStats.ts:1240-1246,
//     reads an absent prior member as no priors), so no decision changes; and the four
//     supplied members are written exactly as today.
//   · SEEDING. `POST /ops/demo-bootstrap` with the four documents (the body every
//     existing caller sends, scripts/demo-kit/lib/seed.mjs:534-538) creates the set with
//     SIX members: the four supplied, exactly as today (revision 1, the supplied value as
//     its kind's validator admits it, the note `demo scope bootstrap: <member>`), then
//     `priors` = EMPTY_PRIORS and `proposals` = EMPTY_PROPOSALS at revision 1, in one
//     `initializePublicationSet`. Its answer names the six:
//     `members: ['reflex', 'catalog', 'slots', 'learn', 'priors', 'proposals']`. A body
//     that supplies `priors` or `proposals` itself is not ruled here (no witness).
//   · THE PATH. `POST /ops/demo-bootstrap/complete` (same mount, same guard as the door:
//     not on the customer profile, development only, the operator credential and grant;
//     no document): on a scope whose committed set lacks `priors` and/or `proposals`, it
//     adds each one lacking as its compiled empty at revision 1, in one set publication,
//     touching no other member, and answers 200 `{ ok: true, scope, added, members,
//     publication }` with `added` the members it added, in that order; on a set that has
//     both it answers 200 with `added: []` and writes nothing (one time, idempotent).
//     ITS REFUSALS, ruled (fix round 2, R-P83), each writing nothing: outside development
//     403 `{ ok: false, error: 'Demo scope bootstrap is a development facility' }`; on the
//     customer profile 404 `{ ok: false, error: 'Not available' }`, answered before the
//     credential middleware, so with no credential too (W08 C1's demo-door idiom,
//     src/units/W08/C1.unit.test.ts:399-422); on a scope with no publication set 503 with
//     code `publication_uninitialized`, after which the door still creates the set. In
//     development, after those guards, the path takes the credential and the grant itself
//     (fix round 3, R-P83 addendum 2), each refusal writing nothing: no credential 401 (the
//     credential middleware's answer); under AUTH_MODE `enforced`, a credential whose grants
//     do not name the tenant 403 `{ error: 'Operator tenant authority unavailable' }`.
//   · THE TELLING. Until the path is taken, a read of `priors` (`GET /content/priors`) or
//     `proposals` (`GET /v1/:tenant/learn/proposals`) on such a set answers a refusal
//     whose words name the missing member (`priors`, `proposals`) and the path
//     (`POST /ops/demo-bootstrap/complete`), in the member each read's error path already
//     answers with (`error` on /content, `message` under the application's error handler).
//     The words are the refusal's, raised where the set is read (src/config/publication.ts,
//     the refusal's words only), beginning with today's text so a reader matching it still
//     matches: "Configuration publication authority unavailable: priors is not in this
//     tenant's publication set; add it with POST /ops/demo-bootstrap/complete …". Every
//     refusal of another cause keeps its words.
//   · ITS STATUS, ruled (fix round 1): today's, unchanged — the refusal stays a
//     `PublicationError` 503 `publication_unavailable`, so `GET /content/priors` answers 503
//     `{ ok: false, error, code }`; `GET /v1/:tenant/learn/proposals` answers through the
//     application's error handler as today (500, the words in `message`), decisions.ts and
//     src/middleware/error.ts being outside P48's boundary.
//   · THE HOSTED SEED (BP3): scripts/demo-kit/lib/host.mjs's seed step takes the path once for
//     its tenant right after the hosted seed and before the redeploy, through the run's command
//     runner as every external call of the hosting command goes (host.test.mjs:1-4), the operator
//     token in the child's environment (OPERATOR_TOKEN, never an argument), its command line
//     naming POST /ops/demo-bootstrap/complete (host.test.mjs names that call `bootstrap complete`).
//   · LOCKED: the door's existing refusals and their answers (customer profile 404 —
//     unit:W08 C1's control, src/units/W08/C1.unit.test.ts:417-422, and the native leg
//     :399-414, hold it on the real Worker —, 403 outside development, 422 for a missing
//     member and for an invalid document, 409 `already_initialized` on a scope with a
//     head), and the W08-C1 door untouched (src/units/W08 as locks).
//   · BOUNDARY (R-P82 (4)): adding members to a COMMITTED set needs a capability of
//     src/config/publication.ts — `publishSet` refuses an absent non-optional member
//     (:616-617), the head validation admits only optional members as additions, and
//     `initializePublicationSet` refuses a scope with a committed set — so the file is in
//     P48's boundary whole for an explicit, minimal capability that admits only the two
//     compiled empties as additions to a committed head that lacks them, every existing
//     refusal unchanged. The S7 satisfiability sketch (logs/sketch-*.log) shows one such build.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P48.log):
//   · src/config/publication.optionalMember.test.ts:46-50 asserts that the required read
//     of an absent priors member rejects with exactly `{ status: 503, message:
//     'Configuration publication authority unavailable' }`; under the ruling the message
//     names the member and the path, so :50 collides (the lead rules it);
//     CORRECTED under R-P82 (2), test-only: :50 admits today's text alone or followed by the ruled words naming priors and the path.
//   · src/units/W08/C1.unit.test.ts:417-422 (the demo door 404 on the customer profile)
//     holds; scripts/demo-kit/lib/seed.test.mjs:205-225 (the seed's bootstrap carries the
//     four documents; `already_initialized` falls through) holds: the seed module is not
//     changed and four-member callers keep working.
//   · CORRECTED under R-P82 (3), test-only: scripts/demo-kit/lib/host.test.mjs's pinned command lists (:299-306, :400) carry `bootstrap complete` after `seed`.
//
// RULED MEMBERS AND PATHS THAT DO NOT EXIST YET: the door's two seeded members and its
// six-member `members`, `POST /ops/demo-bootstrap/complete`, and the refusal's words. No
// new export is imported.
//
// FIXTURE. A demo tenant with no publication set (the harness's mount, its R2 double
// emptied), ENVIRONMENT development, the demo profile; the routes mounted as
// src/index.ts mounts them (the tenant middleware, `/content`, `/v1`,
// `/ops/demo-bootstrap`) with the application's error handler. The four supplied
// documents are P08's catalogue, pages and learn document and the harness's registry.
// BP2's four-member set is written as the door writes it today (demoBootstrap.ts:100-110).
//
// HARNESS: src/units/_parity.ts (the mounted bindings over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (the kit), src/units/_parity5.ts
// (a write of any content kind), src/units/_parity6.ts (P08's documents). Imports from
// src/units/: ../_parity, ../_parity3, ../_parity5, ../_parity6.

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { initializePublicationSet, invalidatePublicationCache, readPublication, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { EMPTY_PROPOSALS } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { errorHandler } from '@/middleware/error';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import { demoBootstrapRoutes } from '@/routes/demoBootstrap';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

import { asOperator, HOSTS, mount, readTree, REFLEX_DOCUMENT, TENANT, type Answer, type Host, type Mounted } from '../_parity';
import { missingStatements } from '../_parity3';
import { putKind } from '../_parity5';
import { P08_LEARN, P08_PIECES, P08_SLOTS } from '../_parity6';

/** The four documents the door's callers supply. */
const SUPPLIED: Record<string, unknown> = { reflex: REFLEX_DOCUMENT, catalog: { version: 'parity-p48-catalogue', pieces: P08_PIECES }, slots: P08_SLOTS, learn: P08_LEARN };
const KINDS: Record<string, [PublicationBaseline['kind'], string]> = {
  reflex: [REFLEX_KIND as PublicationBaseline['kind'], reflexScopeForTenant(TENANT)], catalog: [CONTENT_KIND as PublicationBaseline['kind'], TENANT],
  slots: [SLOTS_KIND as PublicationBaseline['kind'], TENANT], learn: [LEARN_KIND as PublicationBaseline['kind'], TENANT],
};
const FOUR = ['reflex', 'catalog', 'slots', 'learn'];
const SIX = [...FOUR, 'priors', 'proposals'];
const PATH = '/ops/demo-bootstrap/complete';
/** A priors document an operator publishes: one row for the product slot's reviews module. */
const PRIORS = { version: 'parity-p48-priors', rows: [{ slot: 'pdp-modules', item: 'module.reviews.1', cell: '*', p_prior: 0.05, n_equiv: 20, measurementBasis: 'rendered-v1' }] };

/**
 * A demo tenant with no publication set, on the demo profile in development, and the
 * routes as src/index.ts mounts them (with its error handler). Every call goes through it.
 */
async function demoStamp(host: Host): Promise<Mounted> {
  const m = await mount(host, { pieces: P08_PIECES, slots: P08_SLOTS, learn: P08_LEARN });
  m.storage.objects.clear(); m.storage.versions.clear(); m.storage.metadata.clear();
  invalidatePublicationCache(); invalidateCache();
  m.env.ENVIRONMENT = 'development';
  const app = new Hono<{ Bindings: Env }>();
  app.onError(errorHandler);
  app.use('*', tenantMiddleware());
  app.route('/content', contentRoutes);
  app.route('/v1', decisionRoutes);
  app.route('/ops/demo-bootstrap', demoBootstrapRoutes);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext;
  const fetch = async (request: Request) => {
    const response = await app.fetch(request, m.env, ctx);
    while (pending.length) await Promise.all(pending.splice(0)).catch(() => undefined);
    invalidatePublicationCache();
    return response;
  };
  return { ...m, fetch };
}
const bootstrap = (m: Mounted, body: unknown = SUPPLIED) => asOperator(m, 'POST', `/ops/demo-bootstrap?scope=${TENANT}`, body);
const complete = (m: Mounted) => asOperator(m, 'POST', `${PATH}?scope=${TENANT}`, {});
/** The path called with no credential at all (no Authorization header). */
async function completeAnonymously(m: Mounted): Promise<Answer> {
  const response = await m.fetch(new Request(`http://console.test${PATH}?scope=${TENANT}`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, 'content-type': 'application/json' }, body: '{}' }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}
const readPriors = (m: Mounted) => asOperator(m, 'GET', `/content/priors?scope=${TENANT}`);
const readProposals = (m: Mounted) => asOperator(m, 'GET', `/v1/${TENANT}/learn/proposals`);

/** The four-member set exactly as the door writes it today (src/routes/demoBootstrap.ts:100-110). */
async function fourMemberSet(m: Mounted): Promise<void> {
  const at = Date.now();
  await initializePublicationSet(m.env, FOUR.map(member => ({ kind: KINDS[member]![0], scope: KINDS[member]![1],
    revision: { revision: 1, value: SUPPLIED[member], actor: 'ops', note: `demo scope bootstrap: ${member}`, at } })), `0:${crypto.randomUUID()}`);
  invalidatePublicationCache();
}
/** The four supplied members as the set holds them: revision, note and value. */
async function suppliedMembers(m: Mounted) {
  invalidatePublicationCache();
  const out: Record<string, unknown> = {};
  for (const member of FOUR) {
    const [kind, scope] = KINDS[member]!;
    const read = await readPublication(m.env, kind, scope).catch((error: Error) => ({ error: error.message }));
    out[member] = 'error' in read ? read : { revision: read.revision, note: read.note, value: read.value };
  }
  return out;
}
/** What the door writes for them: revision 1, its note, the value its kind's validator admits. */
const AS_SUPPLIED = Object.fromEntries(FOUR.map(member => {
  const checked = KINDS[member]![0].validate(SUPPLIED[member]) as { ok: boolean; value?: unknown };
  return [member, { revision: 1, note: `demo scope bootstrap: ${member}`, value: checked.value }];
}));
const EMPTY_PRIORS_STORED = (PRIORS_KIND.validate(EMPTY_PRIORS) as { value: unknown }).value;
/** A six-member tenant's two reads: the priors document at revision 1, the empty proposals list. */
const sixMemberReads = (priors: Answer, proposals: Answer) => ({ priors: [priors.status, priors.body.revision, priors.body.source, priors.body.document],
  proposals: [proposals.status, proposals.body.ok, proposals.body.proposals] });
const SIX_MEMBER_READS = { priors: [200, 1, 'stored', EMPTY_PRIORS_STORED], proposals: [200, true, EMPTY_PROPOSALS.proposals] };
/** A refusal's words, wherever its error path puts them (`error` on /content, `message` under the application's error handler). */
const wordsOf = (answer: Answer) => [answer.body.error, answer.body.message].filter((v): v is string => typeof v === 'string').join(' ');
const tells = (answer: Answer, member: string) => ({ refused: answer.status >= 400, member: new RegExp(`\\b${member}\\b`).test(wordsOf(answer)),
  path: wordsOf(answer).includes(PATH) });
const TOLD = { refused: true, member: true, path: true };
const storedBytes = (m: Mounted) => JSON.stringify([...m.storage.objects.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

// ===========================================================================
// unit:P48.BP1 — a bootstrapped tenant reads and publishes priors and proposals
// ===========================================================================

describe('unit:P48.BP1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a tenant bootstrapped through the demo door with the four documents its callers send reads priors and proposals as a six-member tenant does and publishes priors; the four supplied members are exactly as the door writes them today, and the answer names the six members`, async () => {
      const m = await demoStamp(host);
      const boot = await bootstrap(m);
      expect([boot.status, boot.body.ok], `${host}: PRECONDITION — the demo door creates the set (${JSON.stringify(boot.body).slice(0, 300)})`).toEqual([200, true]);
      expect.soft(boot.body.members, `${host}: P48.BP1 — the door's answer names the six members the set holds`).toEqual(SIX);
      expect.soft(sixMemberReads(await readPriors(m), await readProposals(m)), `${host}: P48.BP1 — priors and proposals read as on a six-member tenant (the compiled empties at revision 1)`)
        .toEqual(SIX_MEMBER_READS);
      const published = await putKind(m, 'priors', PRIORS, 'p48-bp1');
      expect.soft([published.status, published.body.revision], `${host}: P48.BP1 — an operator publishes priors over it (${JSON.stringify(published.body).slice(0, 300)})`).toEqual([200, 2]);
      expect.soft(await suppliedMembers(m), `${host}: P48.BP1 — LOCKED: the four supplied members are exactly as the door writes them today`).toEqual(AS_SUPPLIED);
    }, 60_000);

    it(`host (${host}): LOCK — the door's existing refusals answer as today and write nothing: 403 outside development, 422 for a missing member and for an invalid document, 409 already_initialized on a scope with a set`, async () => {
      const m = await demoStamp(host);
      m.env.ENVIRONMENT = 'test';
      const outside = await bootstrap(m);
      expect([outside.status, outside.body], `${host}: P48.BP1 — LOCKED: outside development`).toEqual([403, { ok: false, error: 'Demo scope bootstrap is a development facility' }]);
      m.env.ENVIRONMENT = 'development';
      const missing = await bootstrap(m, { reflex: SUPPLIED.reflex, catalog: SUPPLIED.catalog, slots: SUPPLIED.slots });
      expect([missing.status, missing.body], `${host}: P48.BP1 — LOCKED: a missing member`).toEqual([422, { ok: false, error: 'Supply every member in one intent; missing: learn' }]);
      const invalid = await bootstrap(m, { ...SUPPLIED, slots: { pages: 'not a map' } });
      expect([invalid.status, invalid.body.error, Object.keys(invalid.body.errors as object ?? {})], `${host}: P48.BP1 — LOCKED: an invalid document`)
        .toEqual([422, 'Invalid baseline configuration', ['slots']]);
      expect(m.storage.objects.size, `${host}: P48.BP1 — LOCKED: no refusal wrote anything`).toBe(0);
      expect((await bootstrap(m)).status, `${host}: PRECONDITION — the door creates the set`).toBe(200);
      const before = storedBytes(m);
      const again = await bootstrap(m);
      expect([again.status, again.body.code], `${host}: P48.BP1 — LOCKED: a scope with a set is refused`).toEqual([409, 'already_initialized']);
      expect(storedBytes(m), `${host}: P48.BP1 — LOCKED: and nothing is written`).toBe(before);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P48.BP2 — an existing four-member tenant is told, and has a path
// ===========================================================================

describe('unit:P48.BP2 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a tenant bootstrapped before the build (the four-member set as the door writes it today) reads priors and proposals as refusals naming the missing member and POST ${PATH}; taking the path once gives the six-member reads, leaves the four supplied members as they were, and a second call writes nothing`, async () => {
      const m = await demoStamp(host);
      await fourMemberSet(m);
      expect.soft(tells(await readPriors(m), 'priors'), `${host}: P48.BP2 — the priors read names the missing member and the path`).toEqual(TOLD);
      expect.soft(tells(await readProposals(m), 'proposals'), `${host}: P48.BP2 — the proposals read names the missing member and the path`).toEqual(TOLD);

      const taken = await complete(m);
      expect.soft([taken.status, taken.body.ok, taken.body.added], `${host}: P48.BP2 — the path adds the two missing members (${JSON.stringify(taken.body).slice(0, 300)})`)
        .toEqual([200, true, ['priors', 'proposals']]);
      expect.soft(sixMemberReads(await readPriors(m), await readProposals(m)), `${host}: P48.BP2 — after the path, priors and proposals read as on a six-member tenant`)
        .toEqual(SIX_MEMBER_READS);
      expect.soft(await suppliedMembers(m), `${host}: P48.BP2 — the four supplied members are untouched`).toEqual(AS_SUPPLIED);
      const before = storedBytes(m);
      const again = await complete(m);
      expect.soft([again.status, again.body.added], `${host}: P48.BP2 — once taken, the path adds nothing`).toEqual([200, []]);
      expect.soft(storedBytes(m), `${host}: P48.BP2 — and writes nothing`).toBe(before);
    }, 60_000);

    it(`host (${host}): LOCK — the path's own refusals, each writing nothing: outside development 403 as the door answers; on the customer profile, with no credential, the door's 404 before the credential middleware; on a scope with no publication set 503 publication_uninitialized, after which the door still creates the set`, async () => {
      const m = await demoStamp(host);
      await fourMemberSet(m);
      const before = storedBytes(m), profile = m.env.DEPLOYMENT_PROFILE;
      m.env.ENVIRONMENT = 'test';
      const outside = await complete(m);
      expect.soft([outside.status, outside.body], `${host}: P48.BP2 — outside development the path is refused as the door is`)
        .toEqual([403, { ok: false, error: 'Demo scope bootstrap is a development facility' }]);
      expect.soft(storedBytes(m), `${host}: P48.BP2 — and writes nothing outside development`).toBe(before);
      m.env.ENVIRONMENT = 'development';
      (m.env as unknown as Record<string, unknown>).DEPLOYMENT_PROFILE = 'customer';
      const customer = await completeAnonymously(m);
      (m.env as unknown as Record<string, unknown>).DEPLOYMENT_PROFILE = profile;
      expect.soft([customer.status, customer.body], `${host}: P48.BP2 — on the customer profile, with no credential, the path answers the door's 404 before the credential middleware`)
        .toEqual([404, { ok: false, error: 'Not available' }]);
      expect.soft(storedBytes(m), `${host}: P48.BP2 — and writes nothing on the customer profile`).toBe(before);
      const empty = await demoStamp(host);
      const noSet = await complete(empty);
      expect.soft([noSet.status, noSet.body.code], `${host}: P48.BP2 — on a scope with no publication set the path is refused (${JSON.stringify(noSet.body).slice(0, 200)})`)
        .toEqual([503, 'publication_uninitialized']);
      expect.soft(empty.storage.objects.size, `${host}: P48.BP2 — and writes nothing there`).toBe(0);
      const created = await bootstrap(empty);
      expect.soft([created.status, created.body.ok], `${host}: P48.BP2 — after which the door still creates the set`).toEqual([200, true]);
    }, 60_000);

    it(`host (${host}): LOCK — in development the path takes the credential and the grant itself, each refusal writing nothing: no credential 401; under AUTH_MODE enforced, a credential granted another tenant only 403 Operator tenant authority unavailable`, async () => {
      const m = await demoStamp(host);
      await fourMemberSet(m);
      const before = storedBytes(m), env = m.env as unknown as Record<string, unknown>, tenants = env.TENANTS, mode = env.AUTH_MODE;
      const anonymous = await completeAnonymously(m);
      expect.soft(anonymous.status, `${host}: P48.BP2 — in development, with no credential, the path is refused 401 (${JSON.stringify(anonymous.body).slice(0, 200)})`).toBe(401);
      expect.soft(storedBytes(m), `${host}: P48.BP2 — and writes nothing without a credential`).toBe(before);
      env.AUTH_MODE = 'enforced';
      env.TENANTS = JSON.stringify({ provisioned: [TENANT, 'other'], operatorGrants: { ops: ['other'] } });
      const ungranted = await complete(m);
      env.TENANTS = tenants; env.AUTH_MODE = mode;
      expect.soft([ungranted.status, ungranted.body], `${host}: P48.BP2 — under AUTH_MODE enforced, a credential granted another tenant only is refused`)
        .toEqual([403, { error: 'Operator tenant authority unavailable' }]);
      expect.soft(storedBytes(m), `${host}: P48.BP2 — and writes nothing without the tenant's grant`).toBe(before);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P48.BP3 — the kit and the hosted seed
// ===========================================================================

/** The hosted seed's step, its code alone (comments stripped): from `async seed()` to the next step. */
function seedStepCode(): string {
  const source = readTree('scripts/demo-kit/lib/host.mjs');
  const start = source.indexOf('async seed()'), end = source.indexOf('async verify()', start);
  const step = start >= 0 && end > start ? source.slice(start, end) : '';
  return step.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(line => line.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
}

describe('unit:P48.BP3', () => {
  it('logic: the API reference states the six-member outcome of the demo bootstrap and the path for an existing four-member tenant, and the hosted seed takes the path', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md'], [
      { name: 'the demo bootstrap creates priors and proposals (the compiled empties) beside the four documents its caller supplies',
        test: t => /demo-bootstrap|demo bootstrap/i.test(t) && /\bpriors\b/.test(t) && /\bproposals\b/.test(t) && /(six|empty|EMPTY_PRIORS|compiled)/i.test(t) },
      { name: 'a tenant bootstrapped with four members takes POST /ops/demo-bootstrap/complete, and until then its priors and proposals reads name it',
        test: t => t.includes(PATH) && /(four|existing|earlier|before)/i.test(t) },
    ]);
    expect.soft(missing, 'P48.BP3 — kit 02 states the six members and the path').toEqual([]);
    const step = seedStepCode();
    expect.soft(step.length, 'PRECONDITION — scripts/demo-kit/lib/host.mjs has its seed step').toBeGreaterThan(0);
    expect.soft(step.includes(PATH), 'P48.BP3 — the hosted seed\'s step (scripts/demo-kit/lib/host.mjs `seed()`) calls POST /ops/demo-bootstrap/complete for its tenant').toBe(true);
  });
});
