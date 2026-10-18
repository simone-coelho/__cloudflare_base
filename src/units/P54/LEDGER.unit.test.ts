// src/units/P54/LEDGER.unit.test.ts
// P54 under the Closure Ledger: the tests for the LOCAL criteria of the P54 work
// order (the fifth parity programme (amendment 4), ticket P54 "A customer-profile
// tenant with a four-member set is given its path"). DC1 (D1, RESOLVED by the owner's
// rule R-P78: the telling names a path that exists where the operator is; D01 holds:
// creation only, no overwrite) is exercised inside CP1-CP3; LV1 is a deferred live row
// and gets no test.
//
// One `describe('unit:P54.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-4/BTI-Parity-Amendment-2026-10-17b.md,
//     section 2, P54): "on the customer profile, a stamp owner (the W08-C1 door's
//     authority) can add the two compiled empties to a committed four-member set once,
//     through the W08-C1 door or a sibling under the same authority, idempotent, writing
//     nothing on any refusal; the words a four-member tenant's reads carry name the path
//     that exists on that profile; a six-member tenant and the W08-C1 door's existing
//     answers byte for byte as today; P48's and W08's units unchanged; kit 02 states it";
//   · the P48 delivery review section 11, measured on the real Worker on both hosts
//     (P48/reviewer/scripts/p48rv.test.ts.txt:185-210, logs/probes/phead-C.json): on the
//     customer profile, a four-member set written as a W38 retained adoption would leave
//     it (`initializePublicationSet` with reflex, catalog, slots and learn at revision 1):
//     the W08-C1 door answers 200 `{ ok: true, publication: 1, state: 'already
//     initialized' }`; `GET /content/priors` answers 503 `{ ok: false, error:
//     'Configuration publication authority unavailable: priors is not in this tenant's
//     publication set; add it with POST /ops/demo-bootstrap/complete, …', code:
//     'publication_unavailable' }`; the named path answers 404 `{ error: 'Not Found' }`;
//   · the W08-C1 door (src/routes/content.ts:1037-1083; src/units/W08/C1.unit.test.ts:18-88):
//     the tenant middleware, `operatorJwt` (no credential 401; on the customer profile a
//     credential whose memberships do not name the tenant 403), `catalogScope`, then a
//     stamp owner's own human session (403 `{ ok: false, error: 'Stamp owner required' }`),
//     no document (400 `{ ok: false, error: 'no document is accepted; publish through
//     /content and /config' }`), answers `{ ok, publication, state }` keys sorted;
//     src/customerBoundary.ts:69 admits it on the customer profile;
//   · P48's capability and words (src/config/publication.ts:22-50 `absent()`, :876-915
//     `completePublicationSet`): the two compiled empties (EMPTY_PRIORS, EMPTY_PROPOSALS)
//     added to a committed head that lacks them, once, `added` naming them, a set that has
//     both answering `added: []` and writing nothing, a scope with no set refused 503
//     `publication_uninitialized`.
//
// THE PATH AND THE WORDS, RULED (D1 leaves the door itself or a sibling to the specifier):
//   · A SIBLING, NOT THE DOOR. `POST /content/publication/complete`, beside the W08-C1
//     door, under exactly its authority and in exactly its order (the tenant middleware,
//     `operatorJwt`, `catalogScope`, a stamp owner's own human session; no document), with
//     its own entry in src/customerBoundary.ts CUSTOMER_ROUTES, mounted on every profile at
//     exactly that path (src/index.api-boundary.test.ts:2356-2359 requires it). Why a
//     sibling: the door's answers stay byte for byte today's — including `already
//     initialized` on a committed four-member set, which is true — and a scope with no
//     set stays the door's to initialize, so the completion is a separate, named act an
//     operator takes once, as P48's demo path is.
//   · WHAT IT DOES. On a committed set that lacks `priors` and/or `proposals`, it adds
//     each one lacking as its compiled empty at revision 1, in one set publication that
//     touches no other member (P48's capability), and answers 200 `{ added, ok: true,
//     publication, state: 'completed' }`, keys sorted (R-P3): `added` the members added,
//     as an operator reads them (`priors`, `proposals`), `publication` the new set's
//     revision. On a set that has both (six members already: the ruled answer) it answers
//     200 `{ added: [], ok: true, publication: <the committed set's revision>, state:
//     'already complete' }` and writes nothing: idempotent, creation only (D01).
//   · ITS REFUSALS, each writing nothing (no R2 put or delete): no credential 401 (the
//     credential middleware's answer); a member who is not a stamp owner 403 `{ ok: false,
//     error: 'Stamp owner required' }`; a stamp owner without a membership on the tenant
//     403; any document 400 with the door's words; a scope with no publication set 503
//     with code `publication_uninitialized`, after which the W08-C1 door still
//     initializes it (six members), and the path then answers `already complete`.
//   · THE WORDS. On the customer profile, the refusal a read of an absent `priors` or
//     `proposals` raises keeps today's beginning ("Configuration publication authority
//     unavailable: <member> is not in this tenant's publication set; add it with"), its
//     status and code, and names `POST /content/publication/complete` instead of the demo
//     path, which does not exist there. On the demo profile it is P48's, byte for byte.
//     (src/config/publication.ts `absent()` has the environment at every call site.)
//   · AUDIT (R-P84). The sibling writes ONE operator audit row per completion, as the
//     door writes one per set it writes (W08 C1's rule 6, src/units/W08/C1.unit.test.ts:73-81,
//     asserted :254-256, none on a repeat :314): `storeFor(env).audit({ at, action:
//     'publication_initialized', actorId: <the caller's subject>, actorEmail, targetId:
//     <the tenant>, detail })`, the existing action (no new action word, so
//     src/auth/store.ts stays outside the boundary), its `detail` the door's JSON idiom
//     with `state: 'completed'` (its other members the builder's); none for `already
//     complete`, a refusal or a failure.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P54.log):
//   · src/units/W08/C1.unit.test.ts:424-440 (the kit leg) takes the FIRST paragraph of kit
//     02 naming `POST /content/publication/initialize` and requires it at most 1000
//     characters: the build states the sibling in its own paragraph (a constraint, not a
//     collision);
//   · src/index.api-boundary.test.ts:2356-2359 (W01.08) requires every CUSTOMER_ROUTES entry
//     to be a mounted path and method: the sibling is mounted at exactly its entry's path
//     (a constraint); no test pins the exact CUSTOMER_ROUTES list (W37's logic leg reads
//     one route's admission);
//   · src/config/publication.optionalMember.test.ts:46-51 (corrected under R-P82 (2)) admits
//     today's text alone or followed by the words naming priors and P48's path: it runs on
//     a binding with no deployment profile, so the demo words, which it admits, stay;
//   · P48.BP2 (src/units/P48/LEDGER.unit.test.ts:289-306) reads the demo profile's words:
//     unchanged under the ruling; W08 C1.01-03's door answers: unchanged.
//
// RULED MEMBERS AND PATHS THAT DO NOT EXIST YET: `POST /content/publication/complete`, its
// answers and its customer-boundary entry, and the customer profile's words. No new
// export is imported.
//
// FIXTURE. The W08-C1 customer stamp (src/units/W08/_customer.ts: the REAL Worker default
// export on DEPLOYMENT_PROFILE customer with AUTH_MODE enforced, a stamp owner and a
// member who is not one, both with a membership on the tenant, a second tenant on which
// nobody holds one), on both shopper hosts; the four-member set written as P48's review
// probe writes it (the shape a W38 retained adoption leaves: reflex, catalog, slots and
// learn at revision 1, here the compiled defaults, as W08's own `demoDoorBaselines`
// writes them). CP2's demo leg: the parity mount (src/units/_parity.ts) on the demo
// profile with the same four-member set, as P48.BP2 writes it.
//
// HARNESS: src/units/W08/_customer.ts (the customer stamp), src/units/_parity.ts (the
// demo mount, both shopper hosts), src/units/_parity3.ts (the kit), src/units/_parity6.ts
// (P08's documents for the demo mount). Imports from src/units: ../W08/_customer,
// ../_parity, ../_parity3, ../_parity6.

import { vi, describe, expect, it } from 'vitest';

// The module doubles src/demos/kit/root.worker.test.ts:24-26 registers to load the real
// Worker in process (as src/units/W08/C1.unit.test.ts does); none is on these paths.
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import type { Env } from '@/types/env';

import { asOperator, mount, TENANT as DEMO_TENANT } from '../_parity';
import { missingStatements } from '../_parity3';
import { P08_LEARN, P08_PIECES, P08_SLOTS } from '../_parity6';
import { customerStamp, HOSTS, OPERATOR, OTHER_TENANT, OWNER, TENANT, type Answer, type Stamp } from '../W08/_customer';

const PATH = '/content/publication/complete';
const DOOR = '/content/publication/initialize';
const DEMO_PATH = '/ops/demo-bootstrap/complete';
const NO_DOCUMENT = 'no document is accepted; publish through /content and /config';
const TODAY = 'Configuration publication authority unavailable';

/** The four members a W38 retained adoption leaves, as P48's review probe writes them (here the compiled defaults, W08 C1's `demoDoorBaselines`). */
const FOUR: Array<[string, DocumentKind<unknown>, (tenant: string) => string, unknown, string]> = [
  ['reflex', REFLEX_KIND as DocumentKind<unknown>, t => reflexScopeForTenant(t), DEFAULT_REFLEX_CONFIG, '/config/reflex'],
  ['catalog', CONTENT_KIND as DocumentKind<unknown>, t => t, EMPTY_CATALOG, '/content/catalog'],
  ['slots', SLOTS_KIND as DocumentKind<unknown>, t => t, DEFAULT_SLOTS, '/content/slots'],
  ['learn', LEARN_KIND as DocumentKind<unknown>, t => t, DEFAULT_LEARN, '/content/learn'],
];
async function fourMemberSet(env: Env, tenant: string, values: Record<string, unknown> = {}): Promise<void> {
  const at = Date.now();
  await initializePublicationSet(env, FOUR.map(([name, kind, scope, value]) => ({ kind, scope: scope(tenant),
    revision: { revision: 1, value: values[name] ?? value, actor: 'ops', note: `four ${name}`, at } })) as PublicationBaseline[], `0:${crypto.randomUUID()}`);
  invalidatePublicationCache(); invalidateCache();
}
const complete = (s: Stamp, opts: Parameters<Stamp['call']>[2] = {}) => s.call('POST', PATH, opts);
const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
/** A compiled empty as its kind's write validator admits it: the value a set stores (W08 C1's `admitted`). */
const admitted = (kind: DocumentKind<unknown>, value: unknown) => { const checked = kind.validate(value); return checked.ok ? checked.value : 'does not validate'; };
/** The two reads of a six-member tenant: the priors document at revision 1, the empty proposals list. */
async function sixMemberReads(s: Stamp) {
  const priors = await s.call('GET', '/content/priors'), proposals = await s.call('GET', `/v1/${TENANT}/learn/proposals`);
  return { priors: [priors.status, priors.body.revision, priors.body.source, priors.body.document], proposals: [proposals.status, proposals.body.proposals] };
}
const SIX_MEMBER_READS = { priors: [200, 1, 'stored', admitted(PRIORS_KIND as DocumentKind<unknown>, EMPTY_PRIORS)], proposals: [200, EMPTY_PROPOSALS.proposals] };
/** The four members as the set holds them: revision, actor and note, read through their own doors. */
async function fourMembers(s: Stamp) {
  const out: Record<string, unknown> = {};
  for (const [name, , , , read] of FOUR) { const a = await s.call('GET', read); out[name] = [a.status, a.body.revision, a.body.actor, a.body.note]; }
  return out;
}
const FOUR_AS_WRITTEN = Object.fromEntries(FOUR.map(([name]) => [name, [200, 1, 'ops', `four ${name}`]]));
/** A refusal's words, wherever the error path puts them (`error` on /content, `message` under the application's error handler). */
const wordsOf = (answer: Answer) => [answer.body.error, answer.body.message].filter((v): v is string => typeof v === 'string').join(' ');
const tells = (answer: Answer, member: string) => {
  const words = wordsOf(answer);
  return { refused: answer.status >= 400, today: words.includes(`${TODAY}: ${member} is not in this tenant's publication set; add it with`),
    path: words.includes(`POST ${PATH}`), demoPath: words.includes(DEMO_PATH) };
};
const TOLD = { refused: true, today: true, path: true, demoPath: false };
/** The owner-action audit rows of the door's action (W08 C1's `auditRows`, src/units/W08/C1.unit.test.ts:197): caller, tenant and the detail's state. */
const auditRows = (s: Stamp) => s.accounts.log.filter(row => String(row.action) === 'publication_initialized')
  .map(row => { let state: unknown = 'no detail state'; try { state = (JSON.parse(String(row.detail)) as { state?: unknown }).state; } catch { /* named below */ }
    return { actorId: row.actorId, targetId: row.targetId, state }; });

// ===========================================================================
// unit:P54.CP1 — the customer profile's path completes a four-member set once; its refusals write nothing
// ===========================================================================

describe('unit:P54.CP1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the customer profile a stamp owner with a membership calls POST ${PATH} on a committed four-member set: the two compiled empties are added once, the reads answer as a six-member tenant's, the four members stay as written, and a second call answers already complete and writes nothing`, async () => {
      const s = await customerStamp(host);
      await fourMemberSet(s.env, TENANT);
      const taken = await complete(s);
      expect.soft([taken.status, taken.body], `${host}: P54.CP1 — the path adds priors and proposals as their compiled empties, in set revision 2 (${show(taken)})`)
        .toEqual([200, { added: ['priors', 'proposals'], ok: true, publication: 2, state: 'completed' }]);
      expect.soft(Object.keys(taken.body), `${host}: P54.CP1 — keys sorted (R-P3)`).toEqual(['added', 'ok', 'publication', 'state']);
      expect.soft(await sixMemberReads(s), `${host}: P54.CP1 — after the path, priors and proposals read as on a six-member tenant`).toEqual(SIX_MEMBER_READS);
      expect.soft(await fourMembers(s), `${host}: P54.CP1 — the four members are untouched (creation only, D01)`).toEqual(FOUR_AS_WRITTEN);
      expect.soft(auditRows(s), `${host}: P54.CP1 — R-P84: the completion writes one operator audit row naming the caller and the tenant, state completed`)
        .toEqual([{ actorId: OWNER, targetId: TENANT, state: 'completed' }]);
      const writes = s.storage.writes().length, bytes = s.storage.bytes();
      const again = await complete(s);
      expect.soft([again.status, again.body], `${host}: P54.CP1 — once taken, the path answers already complete (${show(again)})`)
        .toEqual([200, { added: [], ok: true, publication: 2, state: 'already complete' }]);
      expect.soft([s.storage.writes().slice(writes), s.storage.bytes()], `${host}: P54.CP1 — and writes nothing`).toEqual([[], bytes]);
      expect.soft(auditRows(s).length, `${host}: P54.CP1 — R-P84: and writes no audit row`).toBe(1);
    }, 120_000);

    it(`host (${host}): on the customer profile the path's refusals write nothing: no credential 401, a member who is not a stamp owner 403, a stamp owner without a membership 403, a document 400; on a tenant with no set 503 publication_uninitialized, after which the W08-C1 door initializes it and the path answers already complete`, async () => {
      const s = await customerStamp(host);
      await fourMemberSet(s.env, TENANT); await fourMemberSet(s.env, OTHER_TENANT);
      const writes = s.storage.writes().length, bytes = s.storage.bytes();
      const anonymous = await complete(s, { token: null });
      expect.soft(anonymous.status, `${host}: P54.CP1 — no credential is refused by the credential middleware (${show(anonymous)})`).toBe(401);
      const member = await complete(s, { token: s.tokens.operator });
      expect.soft([member.status, member.body], `${host}: P54.CP1 — ${OPERATOR} holds a membership but is not a stamp owner`).toEqual([403, { ok: false, error: 'Stamp owner required' }]);
      const stranger = await complete(s, { tenant: OTHER_TENANT });
      expect.soft(stranger.status, `${host}: P54.CP1 — a stamp owner without a membership on ${OTHER_TENANT} (${show(stranger)})`).toBe(403);
      const supplied = await complete(s, { body: { priors: EMPTY_PRIORS } });
      expect.soft([supplied.status, supplied.body], `${host}: P54.CP1 — a document is refused with the door's words`).toEqual([400, { ok: false, error: NO_DOCUMENT }]);
      expect.soft([s.storage.writes().slice(writes), s.storage.bytes()], `${host}: P54.CP1 — no refusal wrote anything`).toEqual([[], bytes]);
      expect.soft(auditRows(s), `${host}: P54.CP1 — R-P84: and no refusal wrote an audit row`).toEqual([]);

      const empty = await customerStamp(host);
      const noSet = await complete(empty);
      expect.soft([noSet.status, noSet.body.code], `${host}: P54.CP1 — a tenant with no set is refused (${show(noSet)})`).toEqual([503, 'publication_uninitialized']);
      expect.soft(empty.storage.writes(), `${host}: P54.CP1 — and nothing is written`).toEqual([]);
      const door = await empty.call('POST', DOOR);
      expect.soft([door.status, door.body], `${host}: P54.CP1 — after which the W08-C1 door initializes the tenant as today`).toEqual([200, { ok: true, publication: 1, state: 'initialized' }]);
      const six = empty.storage.writes().length, sixBytes = empty.storage.bytes();
      const already = await complete(empty);
      expect.soft([already.status, already.body], `${host}: P54.CP1 — six members already: the path answers already complete`).toEqual([200, { added: [], ok: true, publication: 1, state: 'already complete' }]);
      expect.soft([empty.storage.writes().slice(six), empty.storage.bytes()], `${host}: P54.CP1 — and writes nothing`).toEqual([[], sixBytes]);
      expect.soft(auditRows(empty), `${host}: P54.CP1 — R-P84: the only audit row is the door's own (W08 C1); the refused and the already complete paths wrote none`)
        .toEqual([{ actorId: OWNER, targetId: TENANT, state: 'initialized' }]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P54.CP2 — the words name the path that exists; the door and the demo profile as today
// ===========================================================================

describe('unit:P54.CP2 (R-P78, D1; R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the customer profile a four-member tenant's priors and proposals reads are refused naming the member and POST ${PATH}, not the demo path, beginning with today's words and keeping the priors read's status and code; the W08-C1 door answers that tenant already initialized and writes nothing, as today`, async () => {
      const s = await customerStamp(host);
      await fourMemberSet(s.env, TENANT);
      const priors = await s.call('GET', '/content/priors'), proposals = await s.call('GET', `/v1/${TENANT}/learn/proposals`);
      expect.soft(tells(priors, 'priors'), `${host}: P54.CP2 — the priors read names the member and the customer profile's path (${show(priors)})`).toEqual(TOLD);
      expect.soft([priors.status, priors.body.code], `${host}: P54.CP2 — LOCKED (P48's ruling): the priors read keeps its status and code`).toEqual([503, 'publication_unavailable']);
      expect.soft(tells(proposals, 'proposals'), `${host}: P54.CP2 — the proposals read names the member and the customer profile's path (${show(proposals)})`).toEqual(TOLD);
      const writes = s.storage.writes().length, bytes = s.storage.bytes();
      const door = await s.call('POST', DOOR);
      expect([door.status, door.body], `${host}: P54.CP2 — LOCKED (W08 C1.02): the door answers a committed four-member set as today`).toEqual([200, { ok: true, publication: 1, state: 'already initialized' }]);
      expect([s.storage.writes().slice(writes), s.storage.bytes()], `${host}: P54.CP2 — LOCKED: and writes nothing`).toEqual([[], bytes]);
    }, 120_000);

    it(`host (${host}): LOCK — on the demo profile a four-member tenant's priors read is P48's refusal, byte for byte, naming the demo path`, async () => {
      const m = await mount(host, { pieces: P08_PIECES, slots: P08_SLOTS, learn: P08_LEARN });
      m.storage.objects.clear(); m.storage.versions.clear(); m.storage.metadata.clear();
      invalidatePublicationCache(); invalidateCache();
      await fourMemberSet(m.env, DEMO_TENANT);
      const priors = await asOperator(m, 'GET', `/content/priors?scope=${DEMO_TENANT}`);
      expect([priors.status, priors.body], `${host}: P54.CP2 — LOCKED (P48.BP2): the demo profile's words are P48's`).toEqual([503, { ok: false,
        error: `${TODAY}: priors is not in this tenant's publication set; add it with POST ${DEMO_PATH}, which adds its compiled empty once and changes no other member`,
        code: 'publication_unavailable' }]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P54.CP3 — the kit
// ===========================================================================

describe('unit:P54.CP3', () => {
  it('logic: the API reference states the customer profile\'s path for a four-member set', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md'], [
      { name: 'on the customer profile, POST /content/publication/complete (a stamp owner with a membership) adds priors and proposals, the compiled empties, to a four-member set once',
        test: t => t.includes(PATH) && /(customer profile|customer stamp|stamp owner)/i.test(t) && /\bpriors\b/.test(t) && /\bproposals\b/.test(t) },
      { name: 'and the reads of a four-member tenant on the customer profile name that path',
        test: t => t.includes(PATH) && /(read|refus|names?)/i.test(t) && /(four|lacks|missing|absent)/i.test(t) },
    ]);
    expect(missing, 'P54.CP3 — kit 02 states the customer profile\'s path').toEqual([]);
  });
});
