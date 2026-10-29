// src/units/P87/LEDGER.unit.test.ts
// P87 under the Closure Ledger (programme `tapestry-parity-activation`, amendment 11, item E11): the tests for the LOCAL
// criteria SC1–SC3 of the P87 work order (docs/parity/activation/program.json). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md:93–98, E11):
//   "#### E11 · A catalogue-only service credential
//    - **Authority:** the IT pack (`docs/tapestry-packs/3-it-and-integration/01-export-mechanisms.md`, `05-security-pack.md`).
//    - **Done when:** a service credential can be limited to the catalogue import, so that the credential Tapestry's IT holds
//      cannot publish slots, learning or priors.
//    - **Starts from:** `src/auth/authority.ts` (roles `operator` and `admin` on the whole tenant).
//    - **Needed by:** the production export job, January. Half a day."
//
// THE READINGS (the lead's, provisional, SPEC-BRIEF-P87.md; each shown by the leg named):
//   1  SC1, the role. A third service-credential role `catalog-import`, registered only through POST /auth/service-credentials,
//      listed, replaced and revoked as the other two; a replacement may change the role (an operator credential narrowed by a
//      `catalog-import` one naming it in `replaces`, the old revoked atomically). Never a membership role: POST and PATCH
//      /auth/memberships with it 400 as today; operator_memberships' CHECK, GET /auth/authority's tenantRole and the human
//      roles (src/auth/accounts.ts ROLES, src/auth/store.ts Role) unchanged.                          → SC1 first leg, SC3 schema leg
//   2  SC1, what it admits: exactly GET /content/catalog, /history, /revisions/:n, GET /content/catalog/publication (kind
//      catalog), POST /content/catalog/validate, /import, /pull, /publication/recover (kind catalog), on its own tenant, as an
//      operator credential (same answers; the revision's actor its subject; catalogMeta.authorize admitting it; P91's
//      import-sources and P90's pull rules unchanged; revoked or expired 401).                         → SC1 second leg
//   3  SC2: every other request through the operator gate answers 403 `{ error: <one fixed sentence>, code: 'catalog_credential' }`
//      before the handler (PUT /content/catalog and the rollback included; every other kind; the publication read and recover of
//      another kind; enrichment; POST /content/publication/initialize; /config/*; learning, ledger, identity operator routes;
//      the audience writes; the edge-access operator paths; the demo doors where mounted). "Before the handler" two ways: a
//      request a handler answers 400/404/428 for an operator credential answers 403 for this one, and no store is read or
//      written past the credential lookup.                                                              → SC2 legs
//   4  The gate's one place is operatorJwt (the nested re-checks included): a `catalog-import` grant is admitted only where the
//      route opted in (a mark on the context the eight content routes set), in every AUTH_MODE and profile — on the demo
//      profile from the token's `roles`. hasOperatorGrant unchanged; operator and admin credentials unchanged.
//                                                                                                       → SC2 demo legs, SC3 lock legs
//   5  The schema: migrations/0014_<name>.sql and migrations/product/0014_<name>.sql byte-identical, forward-only and additive
//      in 0013's form, extending operator_service_credentials.role's CHECK to the three roles and nothing else; every row kept;
//      foreign_key_check empty; operator_memberships untouched; credentialRow reads the role; kit 02's migration sentence names
//      0014 beside 0012 and 0013.                                                                       → SC3 schema and kit legs
//   6  The migration list's consumers: the customer package carries 0014 last with its hash pinned under a third schema
//      contract, a package built before 0014 (four migrations under operator-oidc-v2) still validating and migrating as today;
//      src/ops/monitor.ts PRODUCT_SCHEMA after 0014 and 0014 required; the demo kit's list unchanged.  → SC3 package and monitor legs
//   7  SC3, the kit: kit 02's machine-credential paragraph names the role, the eight routes, the 403 refusal by name and the
//      narrowing replacement; the migration sentence gains 0014.                                        → SC3 kit leg
//   8  Locks (W16, W19 B1–B3, W21 B2, W25, W28–W31, W36, W37 (+FIX2), P35, P82, P90, P91, P84/P85/P86, the auth, claims,
//      API-boundary, monitor, stamp-workflow, operator-seed, signing-config and configStore suites, W40 P3/P4; the console).
//
// THE NAMES THIS SPECIFICATION RULES (ratified, R-P425): the migration `0014_operator_catalog_import.sql` (0010–0013 are
//   `operator_*`); the package's third schema contract `operator-catalog-import-v3`. The refusal's `code` is the brief's
//   (`catalog_credential`); its sentence is the builder's (one fixed string naming the catalogue credential: /catalog/i, /credential/i).
// R-P425, the kind's case: the publication route reads `kind` lower-cased (src/routes/content.ts publicationTarget → kindOf), so
//   `?kind=CATALOG` (any case) is the catalogue: GET /content/catalog/publication and its recover admit the catalogue credential
//   exactly as they admit an operator's; a kind naming another member, in any case, stays refused.     → SC1's kind leg
//   HEAD stays as today (no leg).
// R-P431 (the spec review at e4b8b5a8): F1, the kit leg names each of the eight routes with its method and its end, the
//   publication read and recover with the kind catalog beside them; F2, the schema leg refuses values outside the three
//   ('owner', 'reader', 'Operator', 'ADMIN', 'Catalog-Import', 'catalog_import', 'catalog-import ', '') and reads the role
//   column's CHECK as listing exactly the three. (a) A path segment in another case (GET /content/CATALOG, /content/Catalog/history)
//   is read as kindOf reads it, lower-cased: the credential's mark admits it exactly as an operator's route does; another kind
//   in any case stays refused. The customer boundary answers 404 to such a segment for every credential (CUSTOMER_ROUTES'
//   lower-case `:kind`), so the leg runs where the route is served, the demo profile.                → SC1's segment leg
//   (b) On the demo profile a token carrying catalog-import among other roles (['operator','catalog-import']) is held to the
//   eight routes: the catalogue role restricts.                                                      → SC2's mixed-roles leg
// R-P435 (the spec review at 11bc6017): G1, the mixed-roles leg runs two tokens, ['operator','catalog-import'] and
//   ['catalog-import','admin']; G2, the kit leg requires the eight routes inside one sentence that names catalog-import and admits
//   them. Ruled residual, no leg: a wrong-case segment on the literal paths (import, pull, publication, recover) matches no route;
//   the credential is refused 403 at the gate before the router's 404 (an operator's 404).
// R-P437 (the spec review at 284e1b15): H1, the kit leg's admitting sentence must not be a denial (no `not`, `never` or `no` in
//   it). The last textual round by ruling: beyond H1 the prose's meaning belongs to the delivery review.
//
// WHAT THE CODE OR THE BRIEF CONTRADICTS (told):
//   · Kit lines: the ticket cites kit 02 :2359/:2361 (stale); at 91e3a6e8 the machine-credential paragraph is :2469 (the brief's
//     line) and the migration sentence :2471 (the brief says :2472). Reading 5 has the sentence name 0014 "beside 0012 and 0013":
//     today it names 0012 alone ("Apply additive migration0012 … after0010/0011"), and 0013 is named nowhere in kit 02. The kit
//     leg requires one sentence naming 0012, 0013 and 0014.
//   · Reading 6, "the demo kit's own list (scripts/demo-kit/lib/host.mjs) is unchanged": host.mjs keeps no list; its database step
//     reads the committed `migrations/` directory (`git ls-tree HEAD migrations/`; wrangler.oh.toml and wrangler.vantage.toml
//     `migrations_dir = "migrations"`) and stops a demo deploy while any committed migration is unapplied on the shared demo
//     database (host.mjs database(): "the remote is missing what the worker needs"). The top-level copy of 0014 that reading 5
//     requires (and scripts/stamp-workflow.test.mjs :455 requires for every name of MIGRATIONS) therefore stops the next OH and
//     Vantage hosted deploys at that step until the owner applies 0014 to the demo database (a cloud change). Told, not tested.
//   · Reading 3's `models/reference` (and `learn/generation`) are not customer routes (src/customerBoundary.ts CUSTOMER_ROUTES):
//     on the customer profile they answer 404 at the boundary, before any gate, for every credential; the demo legs carry them.
//   · Reading 3, "every other request through the operator gate": with AUTH_MODE open (the demo profile only) the edge-access
//     reads (/v1/:tenant/lift…, /realtime/*) and /operator/audiences, /operator/audiences/publish (also suggest, insights,
//     events/*) pass no operator gate for any credential (src/middleware/edgeAccess.ts sdkKey and operatorWrites are
//     pass-through when open); the open-mode demo legs leave them out, the enforced ones carry them.
//   · Reading 6's grant names scripts/stamp-workflow.test.mjs :577–579; :664 (unit "W14 asset-contract retains genuinely verified
//     older W13 bytes", `assert.equal(current.schemaContract,'operator-oidc-v2')`) pins the contract too: R10 below.
//   · The ticket's allowedPaths do not name scripts/stamp-workflow.mjs or src/ops/monitor.ts (reading 6 adds them).
//   · P86's legs (reading 8) are not in this tree: src/units/P86 is absent at 91e3a6e8 (its join pending).
//
// THE R10 SWEEP (lock lines the change moves; reading 6 grants the first three by name; each the smallest change):
//   C1  scripts/stamp-workflow.test.mjs :578–579 (W15 current security schema …): `'operator-oidc-v2'` → `'operator-catalog-import-v3'`,
//       `migrations.length,4` → `5`, the last name `'0013_operator_oidc.sql'` → `'0014_operator_catalog_import.sql'`. RED today (the
//       package carries four), green under the sketch.
//   C2  src/ops/monitor.test.ts :170 (the D1 double's migration history): `'0014_operator_catalog_import.sql'` appended. Green
//       today and under the sketch (without it the sketch answers `Migrations unavailable`).
//   C3  src/index.api-boundary.test.ts :1363 (W12.02, the native schema check): `'0014_operator_catalog_import.sql'` appended to the
//       migrations applied before `{ w12: 'schema' }` expects `{ ok: true }`. Under the sketch without it: `{ ok: false }`; with it
//       green; RED today (the file does not exist yet). :1295, src/routes/auth.test.ts :73, src/middleware/auth.claims-boundary.test.ts
//       :756–800 and scripts/operator-seed.test.mjs :223–245 stay green under the sketch: untouched.
//   C4  (R10 granted by name, R-P425) scripts/stamp-workflow.test.mjs :664 (W14 asset-contract retains genuinely verified older W13
//       bytes …): `assert.equal(current.schemaContract,'operator-oidc-v2');` → `'operator-catalog-import-v3'`. RED today (the
//       package is today's), the suite 23/23 under the sketch. Nothing else in the sweep pins the role
//       enum, the CHECK, the migration list, the operator gate's answer or the contract (grep of every *.test.ts/*.test.mjs for the
//       credential route, `role IN`, `0013_operator_oidc`, `operator-oidc-v2`, `MIGRATIONS`, operatorAuth/operatorJwt).
//
// DEFERRED: LV1 (both shopper hosts and a customer-profile stamp, the released artifact; the batched live acceptance).
// RESIDUALS (owed, told): applying 0014 to any database is separate operational authority (kit 02's migration sentence); the
//   OH and Vantage demo deploys stop at the demo kit's database step until 0014 is applied there (above); the console's
//   membership role select and any console form for a catalogue credential are untouched (an open owner decision); HEAD on the
//   eight GET routes stays as today with no leg (R-P425); the IT pack's security-pack sentence ("the export
//   job's credential holds the operator role") is the documents lane's (Windows checkout); the open-mode demo paths with no
//   operator gate admit any caller, as today.
//
// MEASURED (_evidence/parity-step3/S33/specifier/logs/, serial, --no-cache, one worker, the scratch tree its working directory and
// root; trees built by mk.sh: src, scripts, migrations, docs/kit archived, public and node_modules hard-linked):
//   today (91e3a6e8 + this file, logs/a/today.log): 16 RED for the missing behaviour, 2 GREEN (the SC3 LOCK legs). SC1 and SC2's
//     customer legs: the role refused at registration, 400 "Explicit credential ID, subject, role and future expiry are required";
//     SC2's demo legs: the minted catalog-import token admitted to every operator route (its LOCK clause green); SC3: no 0014 file,
//     the package carrying 0010–0013 under operator-oidc-v2, the monitor without 0014, kit 02 silent. Behind the first RED
//     (logs/a/today-probe.log, every hard expect made soft in a scratch copy): only the membership LOCK clause and the probes' reads
//     LOCK are green; every other clause RED for the missing credential.
//   the sketch (sketches/p87.py on 91e3a6e8): 18/18 four times (logs/a/fix-1..3.log, fix-probe2.log); tsc exit 0 on the sketch tree.
//   round 5 (R-P437, logs/r5/): the sketch 21/21 twice (fix-1..2.log); today 19 RED and the 2 LOCK legs green (today.log); the
//     reviewer's control kitnotadmitted RED on the kit leg alone (c-kitnotadmitted.log).
//   round 4 (R-P435, logs/r4/): the sketch 21/21 twice (fix-1..2.log); today 19 RED and the 2 LOCK legs green (today.log); the
//     reviewer's controls each RED on its own leg alone — lastrole, adminoverride and firstrole the mixed-roles leg, kitrefused
//     the kit leg (c-*.log).
//   round 3 (R-P431, logs/r3/): the sketch 21/21 twice (fix-1..2.log), the mark reading the :kind segment lower-cased; today 19 RED
//     and the 2 LOCK legs green (today.log; the segment leg's admission clause and the mixed-roles leg's LOCK clause green today,
//     their refusals RED); the reviewer's controls each RED on its own leg alone — kitnopubread the kit leg (the publication read
//     not stated), checkwide2 the schema leg ('reader' accepted); the new wrong fixes `segmentexact` the segment leg alone,
//     `rolesexact` the mixed-roles leg alone; the earlier wrong fixes RED on their legs as before (w-*.log); the stamp-workflow
//     suite 23/23 under the sketch (fix-stamp-workflow.log).
//   round 2 (R-P425, logs/r2/): the kind leg added and the sketch reading the kind lower-cased — the sketch 19/19 three times
//     (fix-1..3.log); today 17 RED (the kind leg at registration) and the 2 LOCK legs green (today.log); `kindexact` (the kind
//     compared exactly) RED on the kind leg alone, `kindignored` on the kind leg's refusal, the matrix and the demo legs; the
//     stamp-workflow suite 23/23 under the sketch with C4 (fix-stamp-workflow.log).
//   the wrong fixes (sketches/p87.py:<variant>, logs/a/w-*.log), each RED on its own legs only (the package leg run where the
//   wrong fix is the package's): see the report's table.
//   the locks (logs/b/): the 34 files of reading 8 548/548 today; 547/548 under the sketch before C3, 72/72 (api-boundary) with it;
//     the sweep's 10 extra files equal on both trees (W39 needs git: W39.H2 2/2 under the sketch in a git-initialised copy);
//     operator-seed green on both; stamp-workflow 22/23 today (C1 RED by design) and 22/23 under the sketch before C4, 23/23 with
//     it; W40.P3/P4 4/4 on both (the deploy leg packages and creates with 0014 under the sketch).
//
// HARNESS: ./_stamp.ts (the real Worker on the customer and the demo profile over node:sqlite D1, both shopper hosts, every store
// call logged). Imports from src/units/: ./_stamp, ../_parity (UnitKV, UnitR2). No new export is imported.

import { describe, expect, it, vi } from 'vitest';

// The stamps load the real Worker (src/index.ts); the module doubles of src/units/P91/LEDGER.unit.test.ts, except that the Agents
// router answers nothing (undefined) as it does for any path outside /agents/*: with AUTH_MODE open the Worker asks it first
// (src/index.ts fetch), and none of these units calls an agent path.
vi.mock('agents', () => ({ routeAgentRequest: async () => undefined }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));
// The package step's three check commands (scripts/stamp-workflow.mjs LOCAL_CHECK_COMMANDS: the release lint, both
// typechecks, a console test) are the gate's own steps and W40.P4's leg. Here every `bash -c` the package step spawns
// answers exit 0 at once; everything else it does — the Worker bundle, the SDK and Meridian checks, the migration blobs
// read from migrations/product, the offline Miniflare probe and validateArtifact — is the real packageArtifact.
vi.mock('node:child_process', async importOriginal => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const spawnSync = ((command: string, args?: readonly string[], options?: object) => command === 'bash'
    ? { pid: 0, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, signal: null }
    : real.spawnSync(command, [...(args ?? [])], options as Parameters<typeof real.spawnSync>[2])) as typeof real.spawnSync;
  return { ...real, default: { ...real, spawnSync }, spawnSync };
});
// scripts/stamp-workflow.mjs expectedSchema reads `await import('node:sqlite')`, a specifier the test runner's module loader
// cannot resolve (it strips the `node:` prefix that this built-in requires); the double is Node's own module, required.
vi.mock('node:sqlite', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('node:sqlite') as object;
});

import { existsSync, readdirSync } from 'node:fs';

import { ROLES } from '@/auth/accounts';
import { d1Authority } from '@/auth/authority';
import { checkProductSchema } from '@/ops/monitor';
import type { Env } from '@/types/env';

import { canonical, migrateProduct, packageArtifact, payloadDigest, sha256, validateArtifact } from '../../../scripts/stamp-workflow.mjs';
import { afterLookup, d1, database, DEMO_DOOR_TENANTS, HOSTS, MEMBER, mintService, OTHER_TENANT, productMigrations, readBytes, readTree, ROOT,
  stamp, SUBJECTS, TENANT, type Answer, type CallOptions, type Sqlite, type Stamp } from './_stamp';

// ── The names this specification rules (reading 5, reading 6; ratified at the spec's receipt) ─────────────────────────
/** The migration P87 adds, in migrations/ and migrations/product/, byte-identical. */
const MIGRATION_0014 = '0014_operator_catalog_import.sql';
/** The schema contract of a customer package that carries 0014 (a package under `operator-oidc-v2` carries 0010–0013). */
const SCHEMA_CONTRACT_0014 = 'operator-catalog-import-v3';
/** The role (reading 1) and the refusal's code (reading 3). */
const ROLE = 'catalog-import' as string;
const REFUSAL_CODE = 'catalog_credential';
/**
 * The eight routes the role admits (reading 2), as kit 02 must name them: each with its method and ending where its path
 * ends (R-P431 F1: a route is never satisfied by a longer one), the publication read and recover with the kind catalog beside them.
 */
const KIT_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET /content/catalog', /GET \/content\/catalog(?![/\w-])/],
  ['GET /content/catalog/history', /GET \/content\/catalog\/history(?![/\w-])/],
  ['GET /content/catalog/revisions/{n}', /GET \/content\/catalog\/revisions\/[{:<]?\w+/],
  ['GET /content/catalog/publication (kind catalog)', /GET \/content\/catalog\/publication(?![/\w-])[^.;]{0,60}?\bkind\W{0,3}catalog\b/i],
  ['POST /content/catalog/validate', /POST \/content\/catalog\/validate(?![/\w-])/],
  ['POST /content/catalog/import', /POST \/content\/catalog\/import(?![/\w-])/],
  ['POST /content/catalog/pull', /POST \/content\/catalog\/pull(?![/\w-])/],
  ['POST /content/catalog/publication/recover (kind catalog)', /POST \/content\/catalog\/publication\/recover(?![/\w-])[^.;]{0,60}?\bkind\W{0,3}catalog\b/i],
];

// ── Requests ────────────────────────────────────────────────────────────────────────────────────────────────────────

const show = (a: { status: number; body: unknown }) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
/** A catalogue record the content kinds admit; synthetic and customer-neutral. */
const piece = (id: string) => ({ id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'editorial', title: `Story ${id}`, tags: { category: ['Bags'] }, slotTypes: ['home-hero'] });
const inADay = () => Math.floor(Date.now() / 1000) + 86_400;

interface Registered { id: string; answer: Answer; token: string }
/** `POST /auth/service-credentials` by the stamp owner's human session (the real route; customer profile). */
async function register(s: Stamp, role: string, subject: string, extra: Record<string, unknown> = {}): Promise<Registered> {
  const id = crypto.randomUUID();
  const answer = await s.call('POST', '/auth/service-credentials', { body: { id, subject, role, expiresAt: inADay(), ...extra } });
  return { id, answer, token: typeof answer.body.token === 'string' ? answer.body.token : '' };
}
/** The owner's listing of the tenant's machine credentials, by id. */
async function listed(s: Stamp): Promise<Map<string, Record<string, unknown>>> {
  const a = await s.call('GET', '/auth/service-credentials');
  return new Map(((a.body.credentials ?? []) as Array<Record<string, unknown>>).map(c => [String(c.id), c]));
}
/** The authored preconditions of a member as `GET /content/:kind` answers it (`"<rev>/<set>/<digest>"`, 0 for an absent optional member). */
async function pre(s: Stamp, kind: string, token?: string) {
  const d = await s.call('GET', `/content/${kind}`, { token });
  const revision = Number(d.body.revision ?? 0), publication = (d.body.publication ?? {}) as { revision?: number; digest?: string };
  return { revision, document: d.body.document, headers: { 'If-Match': `"${revision}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` } };
}
const pieceIds = (a: Answer) => (((a.body.document as { pieces?: Array<{ id: string }> } | undefined)?.pieces) ?? []).map(p => p.id);

interface Req { request: string; opts: CallOptions }
const req = (method: string, path: string, opts: CallOptions = {}): Req & { method: string; path: string } => ({ method, path, request: `${method} ${path}`, opts });
type Ask = ReturnType<typeof req>;

/**
 * Every operator request a stamp mounts besides the eight (reading 3), each one a request an operator credential is
 * admitted to: the reads and writes of every other kind (with the authored preconditions of the tenant's documents, so
 * an admitted write would publish), the catalogue's own PUT and rollback, the publication read and recover naming
 * another kind, the enrichment routes, the two publication doors, /config/*, the learning, ledger and identity operator
 * routes, the audience writes, the edge-access operator paths (a bearer and no site key) and, on the demo profile, the
 * demo doors and models/reference. `edge` (the edge-access paths and the unconditioned /operator/* reads and writes)
 * is false where AUTH_MODE is open: those paths pass no operator gate there, for any credential.
 */
async function otherOperatorRequests(s: Stamp, reader: string, opts: { edge: boolean; demo: boolean }): Promise<Ask[]> {
  const v1 = `/v1/${TENANT}`, unknownProposal = '00000000-0000-4000-8000-000000000087';
  const catalog = await pre(s, 'catalog', reader), slots = await pre(s, 'slots', reader), learn = await pre(s, 'learn', reader);
  const priors = await pre(s, 'priors', reader), vocabulary = await pre(s, 'vocabulary', reader), sources = await pre(s, 'import-sources', reader);
  return [
    req('PUT', '/content/catalog', { body: { document: { pieces: [piece('p87.direct')] }, note: 'p87 direct' }, headers: catalog.headers }),
    req('POST', '/content/catalog/rollback/1', { body: {}, headers: catalog.headers }),
    ...['/content/slots', '/content/learn', '/content/priors', '/content/vocabulary', '/content/import-sources', '/content/slots/history',
      '/content/learn/revisions/1', '/content/vocabulary/rejections', '/content/catalog/publication?kind=slots'].map(path => req('GET', path)),
    req('PUT', '/content/slots', { body: { document: slots.document }, headers: slots.headers }),
    req('PUT', '/content/learn', { body: { document: learn.document }, headers: learn.headers }),
    req('PUT', '/content/priors', { body: { document: priors.document }, headers: priors.headers }),
    req('PUT', '/content/vocabulary', { body: { document: { attributes: {} } }, headers: vocabulary.headers }),
    req('PUT', '/content/import-sources', { body: { document: { addresses: ['203.0.113.0/24'] } }, headers: sources.headers }),
    req('POST', '/content/slots/validate', { body: { document: slots.document } }),
    req('POST', '/content/learn/validate', { body: { document: learn.document } }),
    req('POST', '/content/slots/rollback/1', { body: {}, headers: slots.headers }),
    req('POST', '/content/vocabulary/approve/1', { body: {}, headers: vocabulary.headers }),
    req('POST', '/content/catalog/publication/recover?kind=learn', { headers: learn.headers }),
    req('POST', '/content/catalog/enrichment/proposals', { body: {} }),
    req('POST', '/content/catalog/enrichment/proposals/generate', { body: {} }),
    req('GET', `/content/catalog/enrichment/proposals/${unknownProposal}`),
    req('GET', `/content/catalog/enrichment/proposals/${unknownProposal}/export`),
    req('POST', `/content/catalog/enrichment/proposals/${unknownProposal}/review`, { body: {} }),
    req('POST', `/content/catalog/enrichment/proposals/${unknownProposal}/publish`, { body: {} }),
    req('POST', '/content/publication/initialize', { body: {} }),
    req('POST', '/content/publication/complete', { body: {} }),
    ...['/config/reflex', '/config/reflex/history', '/config/reflex/revisions/1'].map(path => req('GET', path)),
    req('POST', '/config/reflex/validate', { body: {} }),
    req('PUT', '/config/reflex', { body: {} }),
    req('PATCH', '/config/reflex', { body: {} }),
    req('POST', '/config/reflex/rollback/1', { body: {} }),
    // The learning routes.
    ...['learn/cycle', 'learn/proposals/p87-proposal/apply', 'learn/items/reset', 'learn/recovery', 'learn/publish', 'learn/report', 'monitor', 'trend/rollup']
      .map(path => req('POST', `${v1}/${path}`, { body: {} })),
    ...['learn/proposals', 'learn/report', 'learn/report/window', 'learn/queue', 'monitor'].map(path => req('GET', `${v1}/${path}`)),
    ...(opts.demo ? ['models/reference', 'learn/generation'].map(path => req('POST', `${v1}/${path}`, { body: {} })) : []),
    // The ledger routes.
    ...['ledger/batches', 'ledger/erasures', 'ledger/p87-record', 'replay/p87-record', 'visitors/p87-visitor/receipts', 'visitors/p87-visitor/recent', 'audit']
      .map(path => req('GET', `${v1}/${path}`)),
    ...['ledger/erasures', 'ledger/erasures/rewrite'].map(path => req('POST', `${v1}/${path}`, { body: {} })),
    // The identity operator routes.
    ...['identity/resolve', 'identity/events', 'identity/erase', 'identity/export'].map(path => req('POST', `${v1}/${path}`, { body: {} })),
    ...['identity/visitor/p87-visitor', 'identity/shopper/p87-shopper'].map(path => req('GET', `${v1}/${path}`)),
    // The audience writes of src/routes/operator.ts.
    ...['rename', 'pin', 'prune'].map(action => req('POST', `/operator/audiences/p87-audience/${action}`, { body: {} })),
    // The edge-access operator paths: a bearer and no site key (src/middleware/edgeAccess.ts sdkKey, operatorWrites).
    ...(opts.edge ? [
      ...['lift', 'lift/rows', 'lift/history', 'learn/slots', 'learn/exploring', 'trend', 'brands', 'context-table/home'].map(path => req('GET', `${v1}/${path}`)),
      req('GET', '/realtime/reflex'), req('GET', '/operator/audiences'), req('POST', '/operator/audiences/publish', { body: {} }),
    ] : []),
    // The demo doors where mounted.
    ...(opts.demo ? [req('POST', '/ops/demo-bootstrap', { body: {} }),
      ...DEMO_DOOR_TENANTS.map(tenant => ({ ...req('POST', '/' + tenant + '/api/coldstart/prior', { body: {}, tenant }), request: `POST /${tenant}/api/coldstart/prior (X-Tenant ${tenant})` }))] : []),
  ];
}

/** The refusal reading 3 rules, as one row: its status, its code and what the request did after its credential lookup. */
const refusalRow = (r: Ask, a: Answer, demo: boolean) => ({ request: r.request, status: a.status, code: a.body.code ?? null,
  ...(demo ? { stores: a.calls } : { afterLookup: afterLookup(a.calls) ?? 'no credential lookup' }) });
const refused = (r: Ask, demo: boolean) => ({ request: r.request, status: 403, code: REFUSAL_CODE, ...(demo ? { stores: [] } : { afterLookup: [] }) });
/** Whether every refusal carries one and the same sentence, and it names the catalogue credential. */
function oneSentence(answers: Answer[]) {
  const sentences = [...new Set(answers.map(a => a.body.error))];
  const named = sentences.length === 1 && typeof sentences[0] === 'string' && /catalog/i.test(sentences[0]) && /credential/i.test(sentences[0]);
  return named ? 'one fixed sentence naming the catalogue credential' : `sentences: ${JSON.stringify(sentences).slice(0, 300)}`;
}

/** The feed of a pull (P90's loopback form): a stub of exactly its URL; any other fetch is refused, so no test reaches a network. */
const FEED_URL = 'http://127.0.0.1:9/p87-feed.json';
async function withFeed<T>(records: unknown[], run: () => Promise<T>): Promise<T> {
  const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === FEED_URL) return new Response(JSON.stringify({ content: records }), { headers: { 'Content-Type': 'application/json' } });
    throw new Error(`P87: no network in these units (${url})`);
  });
  try { return await run(); } finally { stub.mockRestore(); }
}

/** One fetch at a later time: the clock of every reader (jose's and the Worker's) moved by `ms`. */
async function later<T>(ms: number, run: () => Promise<T>): Promise<T> {
  const at = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at + ms);
  try { return await run(); } finally { vi.useRealTimers(); }
}

const ready = (s: Stamp) => expect(s.refused ?? 'ready', `PRECONDITION (${s.profile}, ${s.host}): the stamp's tenant has its first publication set (${s.refused})`).toBe('ready');
const registeredRow = (r: Registered) => ({ status: r.answer.status, role: (r.answer.body.credential as { role?: unknown } | undefined)?.role ?? null,
  token: r.token.split('.').length === 3 ? 'a signed token' : 'no token' });

// ===========================================================================
// unit:P87.SC1 — a stamp owner registers a catalogue-only service credential; it is admitted to the catalogue import
// ===========================================================================

describe('unit:P87.SC1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a stamp owner registers a service credential with role catalog-import through POST /auth/service-credentials (201, its role and its token); the listing shows its role; a replacement narrows an operator credential to catalog-import and revokes the old atomically; catalog-import is never a membership role`, async () => {
      const s = await stamp(host); ready(s);
      const catalogue = await register(s, ROLE, SUBJECTS.catalog);
      expect(registeredRow(catalogue), `${host}: P87.SC1 — POST /auth/service-credentials {role: 'catalog-import'} registers the catalogue credential (today: ${show(catalogue.answer)})`)
        .toEqual({ status: 201, role: ROLE, token: 'a signed token' });

      const row = (await listed(s)).get(catalogue.id);
      expect.soft(row ? { subject: row.subject, tenant: row.tenant, role: row.role, revokedAt: row.revokedAt, tokenHash: 'tokenHash' in row ? 'listed' : 'not listed' } : 'not listed',
        `${host}: P87.SC1 — GET /auth/service-credentials lists the credential with its role, without its hash`)
        .toEqual({ subject: SUBJECTS.catalog, tenant: TENANT, role: ROLE, revokedAt: null, tokenHash: 'not listed' });

      // The narrowing: an operator credential replaced by a catalogue one, the old revoked in the same transaction.
      const operator = await register(s, 'operator', SUBJECTS.operator);
      expect(operator.answer.status, `${host}: PRECONDITION — an operator credential registers (${show(operator.answer)})`).toBe(201);
      s.rec.failSql = sql => sql.startsWith('UPDATE operator_service_credentials SET revoked_at');
      const torn = await register(s, ROLE, SUBJECTS.operator, { replaces: operator.id });
      s.rec.failSql = null;
      const afterTorn = await listed(s);
      expect.soft({ status: torn.answer.status, old: afterTorn.has(operator.id) ? afterTorn.get(operator.id)!.revokedAt : 'missing', replacement: afterTorn.has(torn.id) ? 'written' : 'not written' },
        `${host}: P87.SC1 — a narrowing replacement whose revocation of the old fails inside its transaction writes nothing: the old stays active, the new is absent (${show(torn.answer)})`)
        .toEqual({ status: 503, old: null, replacement: 'not written' });
      const narrowed = await register(s, ROLE, SUBJECTS.operator, { replaces: operator.id });
      const after = await listed(s);
      const oldUse = await s.call('GET', '/content/catalog', { token: operator.token }), newUse = await s.call('GET', '/content/catalog', { token: narrowed.token });
      const newSlots = await s.call('GET', '/content/slots', { token: narrowed.token });
      expect.soft({ status: narrowed.answer.status, role: after.get(narrowed.id)?.role ?? null, revokedAt: after.has(narrowed.id) ? after.get(narrowed.id)!.revokedAt : 'missing',
        oldRevoked: typeof after.get(operator.id)?.revokedAt, oldToken: oldUse.status, newToken: newUse.status, newOnSlots: [newSlots.status, newSlots.body.code ?? null] },
      `${host}: P87.SC1 — POST /auth/service-credentials {role: 'catalog-import', replaces: <operator credential>} narrows it: the new is active with the role, the old revoked and refused 401, the new admitted to the catalogue and refused the slots (${show(narrowed.answer)})`)
        .toEqual({ status: 201, role: ROLE, revokedAt: null, oldRevoked: 'number', oldToken: 401, newToken: 200, newOnSlots: [403, REFUSAL_CODE] });

      // LOCK: never a membership role; the human roles and the tenant role read unchanged.
      const memberPost = await s.call('POST', '/auth/memberships', { body: { accountId: MEMBER, role: ROLE } });
      const memberPatch = await s.call('PATCH', `/auth/memberships/${MEMBER}`, { body: { role: ROLE }, headers: { 'If-Match': JSON.stringify(`p87-membership-${MEMBER}`) } });
      const authority = await s.call('GET', '/auth/authority');
      expect.soft({ post: memberPost.status, patch: memberPatch.status,
        membership: s.sqlite.prepare('SELECT role FROM operator_memberships WHERE account_id=? AND tenant=?').get(MEMBER, TENANT)?.role ?? null,
        tenantRole: authority.body.tenantRole ?? null, humanRoles: [...ROLES] },
      `${host}: P87.SC1 — LOCK: POST and PATCH /auth/memberships with role catalog-import answer 400 and change nothing; GET /auth/authority's tenantRole and the human account roles are unchanged`)
        .toEqual({ post: 400, patch: 400, membership: 'operator', tenantRole: 'operator', humanRoles: ['operator', 'admin'] });
    });

    it(`host (${host}): with the catalogue credential the eight catalogue routes answer on its own tenant as they answer an operator credential — the document, its history, a revision, the catalogue publication read, validate, an import (the revision attributed to its subject: the before-write re-check admits it), a pull of a loopback feed (P90) and the recover of a pending publication; P91's import-sources list still applies to it; revoked or expired it is 401, on another tenant 403`, async () => {
      const s = await stamp(host); ready(s);
      const catalogue = await register(s, ROLE, SUBJECTS.catalog);
      expect(registeredRow(catalogue), `${host}: P87.SC1 — the catalogue credential registers (today: ${show(catalogue.answer)})`).toEqual({ status: 201, role: ROLE, token: 'a signed token' });
      const operator = await register(s, 'operator', SUBJECTS.operator);
      expect(operator.answer.status, `${host}: PRECONDITION — an operator credential registers (${show(operator.answer)})`).toBe(201);

      // The reads and the dry run: the answer an operator credential gets, byte for byte.
      const reads: Ask[] = [req('GET', '/content/catalog'), req('GET', '/content/catalog/history'), req('GET', '/content/catalog/revisions/1'),
        req('GET', '/content/catalog/publication'), req('GET', '/content/catalog/publication?kind=catalog'),
        req('POST', '/content/catalog/validate', { body: { document: { pieces: [piece('p87.validate')] } } })];
      const readRows: Array<{ request: string; status: number; asOperator: string }> = [];
      for (const r of reads) {
        const c = await s.call(r.method, r.path, { ...r.opts, token: catalogue.token }), o = await s.call(r.method, r.path, { ...r.opts, token: operator.token });
        readRows.push({ request: r.request, status: c.status, asOperator: c.status === o.status && canonical(c.body) === canonical(o.body) ? 'the operator credential\'s answer' : `operator ${show(o)}; catalogue ${show(c)}` });
      }
      expect.soft(readRows, `${host}: P87.SC1 — the catalogue credential reads the document, its history, a revision and the catalogue publication, and validates, exactly as an operator credential does`)
        .toEqual(reads.map(r => ({ request: r.request, status: 200, asOperator: 'the operator credential\'s answer' })));

      // An import: written, attributed to the credential's subject (catalogMeta.authorize re-runs the gate before the write).
      const p1 = await pre(s, 'catalog', operator.token);
      const imported = await s.call('POST', '/content/catalog/import?mode=merge&format=json&note=p87%20export%20job', { token: catalogue.token, body: [piece('p87.a'), piece('p87.b')], headers: p1.headers });
      const d1doc = await s.call('GET', '/content/catalog', { token: operator.token });
      expect.soft({ status: imported.status, revision: imported.body.revision ?? null, stored: d1doc.body.revision, actor: d1doc.body.actor, note: d1doc.body.note, pieces: pieceIds(d1doc) },
        `${host}: P87.SC1 — POST /content/catalog/import?mode=merge with the catalogue credential writes the next revision, its actor the credential's subject (${show(imported)})`)
        .toEqual({ status: 200, revision: p1.revision + 1, stored: p1.revision + 1, actor: SUBJECTS.catalog, note: 'p87 export job', pieces: ['p87.a', 'p87.b'] });

      // A pull, P90's loopback form.
      const p2 = await pre(s, 'catalog', operator.token);
      const pulled = await withFeed([piece('p87.pulled')], () => s.call('POST', '/content/catalog/pull', { token: catalogue.token, body: { url: FEED_URL, path: 'content', mode: 'merge', note: 'p87 pull' }, headers: p2.headers }));
      const d2doc = await s.call('GET', '/content/catalog', { token: operator.token });
      expect.soft({ status: pulled.status, revision: pulled.body.revision ?? null, actor: d2doc.body.actor, pulled: pieceIds(d2doc).includes('p87.pulled') },
        `${host}: P87.SC1 — POST /content/catalog/pull of a loopback feed with the catalogue credential writes the next revision, attributed to its subject (${show(pulled)})`)
        .toEqual({ status: 200, revision: p2.revision + 1, actor: SUBJECTS.catalog, pulled: true });

      // A publication left pending by a storage failure, read and recovered with the catalogue credential.
      const p3 = await pre(s, 'catalog', operator.token);
      { let failed = 0; s.rec.failPut = key => { if (/\/content\/rev\/\d+\.json$/.test(key)) { if (++failed === 2) s.rec.failPut = null; return true; } return false; }; } // P98 R10 (R-P569 (a)): the failure and its immediate repeat
      const lost = await s.call('POST', '/content/catalog/import?mode=merge&format=json', { token: catalogue.token, body: [piece('p87.recovered')], headers: p3.headers });
      s.rec.failPut = null;
      const state = await s.call('GET', '/content/catalog/publication?kind=catalog', { token: catalogue.token, headers: p3.headers });
      const recovered = await s.call('POST', '/content/catalog/publication/recover?kind=catalog', { token: catalogue.token, headers: p3.headers });
      const d3doc = await s.call('GET', '/content/catalog', { token: operator.token });
      expect.soft({ lost: lost.status, state: state.body.state ?? show(state), recovered: recovered.status, revision: recovered.body.revision ?? null, stored: d3doc.body.revision,
        actor: d3doc.body.actor, piece: pieceIds(d3doc).includes('p87.recovered') },
      `${host}: P87.SC1 — an import left pending by a storage failure reads 'pending' and is recovered (POST /content/catalog/publication/recover?kind=catalog) with the catalogue credential (${show(recovered)})`)
        .toEqual({ lost: 503, state: 'pending', recovered: 200, revision: p3.revision + 1, stored: p3.revision + 1, actor: SUBJECTS.catalog, piece: true });

      // P91 unchanged: with an import-sources list published (by the owner), a caller outside it is refused by that list.
      const sources = await pre(s, 'import-sources');
      const list = await s.call('PUT', '/content/import-sources', { body: { document: { addresses: ['203.0.113.0/24'] } }, headers: sources.headers });
      const p4 = await pre(s, 'catalog', operator.token);
      const outside = await s.call('POST', '/content/catalog/import?mode=merge&format=json', { token: catalogue.token, body: [piece('p87.outside')], headers: { ...p4.headers, 'CF-Connecting-IP': '198.51.100.7' } });
      const inside = await s.call('POST', '/content/catalog/import?mode=merge&format=json', { token: catalogue.token, body: [piece('p87.inside')], headers: { ...p4.headers, 'CF-Connecting-IP': '203.0.113.9' } });
      const p5 = await pre(s, 'catalog', operator.token);
      const offLoopback = await withFeed([piece('p87.off')], () => s.call('POST', '/content/catalog/pull', { token: catalogue.token,
        body: { url: 'http://cms.example.invalid/p87-feed.json', path: 'content', mode: 'merge' }, headers: { ...p5.headers, 'CF-Connecting-IP': '203.0.113.9' } }));
      expect.soft({ list: list.status, outside: [outside.status, outside.body.code ?? null], inside: inside.status, offLoopback: [offLoopback.status, offLoopback.body.code ?? null] },
        `${host}: P87.SC1 — P91's import-sources list and P90's pull rules apply to the catalogue credential as to any caller (${show(list)}; ${show(outside)}; ${show(inside)}; ${show(offLoopback)})`)
        .toEqual({ list: 200, outside: [403, 'source_not_allowed'], inside: 200, offLoopback: [400, 'invalid_url'] });

      // Its own tenant only; revoked or expired, 401 as today.
      const elsewhere = await s.call('GET', '/content/catalog', { token: catalogue.token, tenant: OTHER_TENANT });
      const revoke = await s.call('DELETE', `/auth/service-credentials/${catalogue.id}`);
      const revoked = await s.call('GET', '/content/catalog', { token: catalogue.token });
      const brief = await register(s, ROLE, SUBJECTS.catalog, { expiresAt: Math.floor(Date.now() / 1000) + 60 });
      const fresh = await s.call('GET', '/content/catalog', { token: brief.token });
      const expired = await later(120_000, () => s.call('GET', '/content/catalog', { token: brief.token }));
      expect.soft({ elsewhere: elsewhere.status, revoke: revoke.status, revoked: revoked.status, brief: brief.answer.status, fresh: fresh.status, expired: expired.status },
        `${host}: P87.SC1 — the catalogue credential on another tenant 403; revoked (DELETE /auth/service-credentials/:id) 401; registered to expire in a minute, 200 now and 401 once expired`)
        .toEqual({ elsewhere: 403, revoke: 200, revoked: 401, brief: 201, fresh: 200, expired: 401 });
    });
  }

  // R-P425: the publication route reads its `kind` lower-cased (src/routes/content.ts publicationTarget → kindOf), so a
  // catalogue named in another case is the catalogue, for this credential as for an operator's; another member stays refused.
  it('hosts (session and do): the catalogue publication read and recover admit the catalogue credential with the kind in any case (?kind=CATALOG, ?kind=Catalog), answering as they answer an operator credential, a pending publication recovered; a kind naming another member (?kind=SLOTS, ?kind=Learn) is still refused 403 catalog_credential before any store call', async () => {
    for (const host of HOSTS) {
      const s = await stamp(host); ready(s);
      const catalogue = await register(s, ROLE, SUBJECTS.catalog), operator = await register(s, 'operator', SUBJECTS.operator);
      expect(registeredRow(catalogue), `${host}: P87.SC1 — the catalogue credential registers (today: ${show(catalogue.answer)})`).toEqual({ status: 201, role: ROLE, token: 'a signed token' });
      expect(operator.answer.status, `${host}: PRECONDITION — an operator credential registers (${show(operator.answer)})`).toBe(201);
      const reads: Array<{ request: string; status: number; asOperator: string }> = [];
      for (const kind of ['CATALOG', 'Catalog']) {
        const path = `/content/catalog/publication?kind=${kind}`;
        const c = await s.call('GET', path, { token: catalogue.token }), o = await s.call('GET', path, { token: operator.token });
        reads.push({ request: `GET ${path}`, status: c.status, asOperator: c.status === o.status && canonical(c.body) === canonical(o.body) ? 'the operator credential\'s answer' : `operator ${show(o)}; catalogue ${show(c)}` });
      }
      const p1 = await pre(s, 'catalog', operator.token);
      { let failed = 0; s.rec.failPut = key => { if (/\/content\/rev\/\d+\.json$/.test(key)) { if (++failed === 2) s.rec.failPut = null; return true; } return false; }; } // P98 R10 (R-P569 (a)): the failure and its immediate repeat
      const lost = await s.call('POST', '/content/catalog/import?mode=merge&format=json', { token: catalogue.token, body: [piece('p87.case')], headers: p1.headers });
      s.rec.failPut = null;
      const state = await s.call('GET', '/content/catalog/publication?kind=CATALOG', { token: catalogue.token, headers: p1.headers });
      const recovered = await s.call('POST', '/content/catalog/publication/recover?kind=Catalog', { token: catalogue.token, headers: p1.headers });
      const doc = await s.call('GET', '/content/catalog', { token: operator.token });
      expect.soft({ reads, lost: lost.status, state: state.body.state ?? show(state), recovered: recovered.status, revision: recovered.body.revision ?? null, actor: doc.body.actor, piece: pieceIds(doc).includes('p87.case') },
        `${host}: P87.SC1 (R-P425) — ?kind=CATALOG and ?kind=Catalog read and recover the catalogue publication with the catalogue credential, as with an operator credential (${show(recovered)})`)
        .toEqual({ reads: ['CATALOG', 'Catalog'].map(kind => ({ request: `GET /content/catalog/publication?kind=${kind}`, status: 200, asOperator: 'the operator credential\'s answer' })),
          lost: 503, state: 'pending', recovered: 200, revision: p1.revision + 1, actor: SUBJECTS.catalog, piece: true });
      const others: Ask[] = [req('GET', '/content/catalog/publication?kind=SLOTS'), req('POST', '/content/catalog/publication/recover?kind=Learn', { headers: (await pre(s, 'learn', operator.token)).headers })];
      const answers: Answer[] = [];
      for (const r of others) answers.push(await s.call(r.method, r.path, { ...r.opts, token: catalogue.token }));
      expect.soft(others.map((r, i) => refusalRow(r, answers[i]!, false)), `${host}: P87.SC2 (R-P425) — a kind naming another member, in any case, is refused 403 catalog_credential before any store call`)
        .toEqual(others.map(r => refused(r, false)));
    }
  });

  // R-P431 (a): the document routes read their `:kind` segment as kindOf reads it, lower-cased (src/routes/content.ts kindOf),
  // so the catalogue named in another case is the catalogue for this credential as for an operator's. On the customer profile
  // the boundary answers 404 to a segment outside its lower-case list (src/customerBoundary.ts, CUSTOMER_ROUTES' `:kind`), for
  // every credential and before any gate; the profile that serves the route is the demo profile.
  it("demo profile, AUTH_MODE enforced (session and do): the document routes read the kind segment lower-cased — GET /content/CATALOG, GET /content/Catalog/history, GET /content/CATALOG/revisions/1 and POST /content/Catalog/validate admit the catalogue token exactly as they admit an operator's; another kind in any case (GET /content/SLOTS, GET /content/Learn/history, POST /content/Priors/validate) is refused 403 catalog_credential before any store call", async () => {
    for (const host of HOSTS) {
      const s = await stamp(host, 'demo', 'enforced'); ready(s);
      const catalogue = await mintService(SUBJECTS.catalog, [ROLE]), operator = await mintService(SUBJECTS.operator, ['operator', 'admin']);
      const admitted: Ask[] = [req('GET', '/content/CATALOG'), req('GET', '/content/Catalog/history'), req('GET', '/content/CATALOG/revisions/1'),
        req('POST', '/content/Catalog/validate', { body: { document: { pieces: [piece('p87.case-validate')] } } })];
      const rows: Array<{ request: string; status: number; asOperator: string }> = [];
      for (const r of admitted) {
        const c = await s.call(r.method, r.path, { ...r.opts, token: catalogue }), o = await s.call(r.method, r.path, { ...r.opts, token: operator });
        rows.push({ request: r.request, status: c.status, asOperator: c.status === o.status && canonical(c.body) === canonical(o.body) ? 'the operator token\'s answer' : `operator ${show(o)}; catalogue ${show(c)}` });
      }
      expect.soft(rows, `${host}: P87.SC1 (R-P431 (a)) — the catalogue named in another case in the path is the catalogue: admitted as the operator token is`)
        .toEqual(admitted.map(r => ({ request: r.request, status: 200, asOperator: 'the operator token\'s answer' })));
      const others: Ask[] = [req('GET', '/content/SLOTS'), req('GET', '/content/Learn/history'), req('POST', '/content/Priors/validate', { body: { document: { rows: [] } } })];
      const answers: Answer[] = [];
      for (const r of others) answers.push(await s.call(r.method, r.path, { ...r.opts, token: catalogue }));
      expect.soft(others.map((r, i) => refusalRow(r, answers[i]!, true)), `${host}: P87.SC2 (R-P431 (a)) — another kind named in any case is refused 403 catalog_credential before any store call`)
        .toEqual(others.map(r => refused(r, true)));
    }
  });
});

// ===========================================================================
// unit:P87.SC2 — every other operator route refuses the catalogue credential 403 before its handler
// ===========================================================================

/** Requests a handler answers 400, 404 or 428 for an operator credential (src/routes/content.ts, config.ts, identity.ts). */
const PROBES: Array<Ask & { handler: number }> = [
  { ...req('PUT', '/content/catalog', { body: { pieces: [] } }), handler: 428 },  // publicationMeta: no If-Match, no Idempotency-Key
  { ...req('POST', '/content/catalog/rollback/1', { body: {} }), handler: 428 },  // the same
  { ...req('POST', '/content/slots/validate', { rawBody: '' }), handler: 400 },  // body must be JSON
  { ...req('GET', '/content/slots/revisions/99'), handler: 404 },  // revision 99 not found
  { ...req('GET', '/content/catalog/enrichment/proposals/00000000-0000-4000-8000-000000000087'), handler: 404 },  // Proposal not found
  { ...req('PUT', '/config/reflex', { body: {} }), handler: 428 },  // configMeta: no preconditions
  { ...req('POST', `/v1/${TENANT}/identity/resolve`, { rawBody: '' }), handler: 400 },  // invalid JSON body
];

describe('unit:P87.SC2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): every other operator request the customer stamp mounts — the catalogue's own PUT and rollback, every other kind's reads and writes, the publication read and recover of another kind, the enrichment routes, the publication doors, /config/*, the learning, ledger and identity operator routes, the audience writes and the edge-access operator paths — answers the catalogue credential 403 {code: catalog_credential} with one fixed sentence, and makes no store call after its credential lookup`, async () => {
      const s = await stamp(host); ready(s);
      const catalogue = await register(s, ROLE, SUBJECTS.catalog);
      expect(registeredRow(catalogue), `${host}: P87.SC2 — the catalogue credential registers (today: ${show(catalogue.answer)})`).toEqual({ status: 201, role: ROLE, token: 'a signed token' });
      const requests = await otherOperatorRequests(s, s.ownerToken, { edge: true, demo: false });
      const answers: Answer[] = [];
      for (const r of requests) answers.push(await s.call(r.method, r.path, { ...r.opts, token: catalogue.token }));
      expect.soft(requests.map((r, i) => refusalRow(r, answers[i]!, false)),
        `${host}: P87.SC2 — each request answers the catalogue credential 403 catalog_credential before its handler: no store call after the credential lookup`)
        .toEqual(requests.map(r => refused(r, false)));
      expect.soft(oneSentence(answers), `${host}: P87.SC2 — the refusals carry one fixed sentence naming the catalogue credential`).toBe('one fixed sentence naming the catalogue credential');
    });

    it(`host (${host}): before the handler — requests a handler answers 400, 404 or 428 for an operator or an admin credential (an empty body, an unknown id, missing preconditions) answer the catalogue credential 403 catalog_credential with no store call after its lookup; the operator and admin credentials' answers are unchanged`, async () => {
      const s = await stamp(host); ready(s);
      const catalogue = await register(s, ROLE, SUBJECTS.catalog);
      expect(registeredRow(catalogue), `${host}: P87.SC2 — the catalogue credential registers (today: ${show(catalogue.answer)})`).toEqual({ status: 201, role: ROLE, token: 'a signed token' });
      const operator = await register(s, 'operator', SUBJECTS.operator), admin = await register(s, 'admin', SUBJECTS.admin);
      expect([operator.answer.status, admin.answer.status], `${host}: PRECONDITION — an operator and an admin credential register`).toEqual([201, 201]);
      const rows: Array<Record<string, unknown>> = [];
      for (const p of PROBES) {
        const o = await s.call(p.method, p.path, { ...p.opts, token: operator.token }), a = await s.call(p.method, p.path, { ...p.opts, token: admin.token });
        const c = await s.call(p.method, p.path, { ...p.opts, token: catalogue.token });
        rows.push({ request: p.request, operator: o.status, admin: a.status, catalogue: [c.status, c.body.code ?? null], afterLookup: afterLookup(c.calls) ?? 'no credential lookup' });
      }
      const reads: number[] = [];
      for (const token of [operator.token, admin.token]) reads.push((await s.call('GET', '/content/slots', { token })).status, (await s.call('GET', '/config/reflex', { token })).status);
      expect.soft(rows, `${host}: P87.SC2 — the handler's 400/404/428 for an operator and an admin credential (LOCK), 403 catalog_credential for the catalogue credential, which reaches no store after its lookup`)
        .toEqual(PROBES.map(p => ({ request: p.request, operator: p.handler, admin: p.handler, catalogue: [403, REFUSAL_CODE], afterLookup: [] })));
      expect.soft(reads, `${host}: P87.SC2 — LOCK: the operator and the admin credential read the slots and the reflex configuration`).toEqual([200, 200, 200, 200]);
    });
  }

  for (const mode of ['open', 'enforced'] as const) {
    for (const host of HOSTS) {
      it(`demo profile, AUTH_MODE ${mode} (${host}): a service token minted with roles ['catalog-import'] is held to the same eight routes — the document read as an operator token reads it, an import attributed to its subject — and every other operator request the profile mounts, the demo doors and models/reference included, answers it 403 catalog_credential before any store call`, async () => {
        const s = await stamp(host, 'demo', mode); ready(s);
        const catalogue = await mintService(SUBJECTS.catalog, [ROLE]), operator = await mintService(SUBJECTS.operator, ['operator', 'admin']);
        const asCatalogue = await s.call('GET', '/content/catalog', { token: catalogue }), asOperator = await s.call('GET', '/content/catalog', { token: operator });
        const p1 = await pre(s, 'catalog', operator);
        const imported = await s.call('POST', '/content/catalog/import?mode=merge&format=json', { token: catalogue, body: [piece('p87.demo')], headers: p1.headers });
        const doc = await s.call('GET', '/content/catalog', { token: operator });
        expect.soft({ read: asCatalogue.status, sameAsOperator: canonical(asCatalogue.body) === canonical(asOperator.body), imported: imported.status, actor: doc.body.actor, revision: doc.body.revision },
          `${host}/${mode}: P87.SC2 — LOCK: the minted catalogue token reads the catalogue as the operator token does and imports, attributed to its subject (${show(imported)})`)
          .toEqual({ read: 200, sameAsOperator: true, imported: 200, actor: SUBJECTS.catalog, revision: p1.revision + 1 });
        const requests = await otherOperatorRequests(s, operator, { edge: mode === 'enforced', demo: true });
        const answers: Answer[] = [];
        for (const r of requests) answers.push(await s.call(r.method, r.path, { ...r.opts, token: catalogue }));
        expect.soft(requests.map((r, i) => refusalRow(r, answers[i]!, true)),
          `${host}/${mode}: P87.SC2 — on the demo profile the token's roles hold it to the eight routes: each other operator request answers 403 catalog_credential with no store call`)
          .toEqual(requests.map(r => refused(r, true)));
        expect.soft(oneSentence(answers), `${host}/${mode}: P87.SC2 — one fixed sentence naming the catalogue credential`).toBe('one fixed sentence naming the catalogue credential');
      });
    }
  }

  // R-P431 (b): the catalogue role restricts — a token carrying it among other roles is held as one carrying it alone.
  // R-P435 G1: in either place among the roles, beside operator or beside admin (so neither the first nor the last role
  // alone decides, and admin does not override it).
  it("demo profile, AUTH_MODE enforced (session and do): service tokens minted with roles ['operator', 'catalog-import'] and ['catalog-import', 'admin'] are each held to the eight routes as one carrying catalog-import alone — the catalogue read as an operator token reads it and an import attributed to its subject admitted, every other operator request refused 403 catalog_credential before any store call", async () => {
    for (const [host, roles] of HOSTS.flatMap(h => [['operator', ROLE], [ROLE, 'admin']].map(r => [h, r] as const))) {
      const s = await stamp(host, 'demo', 'enforced'); ready(s);
      const mixed = await mintService(SUBJECTS.catalog, [...roles]), operator = await mintService(SUBJECTS.operator, ['operator', 'admin']);
      const asMixed = await s.call('GET', '/content/catalog', { token: mixed }), asOperator = await s.call('GET', '/content/catalog', { token: operator });
      const p1 = await pre(s, 'catalog', operator);
      const imported = await s.call('POST', '/content/catalog/import?mode=merge&format=json', { token: mixed, body: [piece('p87.mixed')], headers: p1.headers });
      const doc = await s.call('GET', '/content/catalog', { token: operator });
      expect.soft({ read: asMixed.status, sameAsOperator: canonical(asMixed.body) === canonical(asOperator.body), imported: imported.status, actor: doc.body.actor, revision: doc.body.revision },
        `${host}, roles ${JSON.stringify(roles)}: P87.SC2 (R-P431 (b)) — LOCK: the mixed-roles token reads the catalogue as the operator token does and imports, attributed to its subject (${show(imported)})`)
        .toEqual({ read: 200, sameAsOperator: true, imported: 200, actor: SUBJECTS.catalog, revision: p1.revision + 1 });
      const requests = await otherOperatorRequests(s, operator, { edge: true, demo: true });
      const answers: Answer[] = [];
      for (const r of requests) answers.push(await s.call(r.method, r.path, { ...r.opts, token: mixed }));
      expect.soft(requests.map((r, i) => refusalRow(r, answers[i]!, true)),
        `${host}, roles ${JSON.stringify(roles)}: P87.SC2 (R-P431 (b), R-P435 G1) — the token carrying catalog-import among other roles is held to the eight routes: each other operator request answers 403 catalog_credential with no store call`)
        .toEqual(requests.map(r => refused(r, true)));
    }
  });
});

// ===========================================================================
// unit:P87.SC3 — the schema, the package, the monitor and the kit; operator and admin credentials unchanged
// ===========================================================================

interface Blob { name: string; type: string; bytes: number; sha256: string; base64: string }
interface Pin { path: string; bytes: number; sha256: string }
interface Package {
  digest?: string; schemaContract?: string; migrations: Blob[]; sourcePins: Pin[]; basisInventory: Blob;
  verification: { basis: Pin[]; basisDigest: string; payloadDigest: string; native: { payloadDigest: string }; checks: Array<{ before: Pin[]; after: Pin[] }> };
}
const blob = (name: string, bytes: Buffer, type: string): Blob => ({ name, type, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') });
/**
 * A package as the package step would have written it after `change`: its basis inventory and digest, its payload
 * digests and its own digest recomputed from the changed members exactly as packageArtifact computes them.
 */
function reform(original: Package, change: (p: Package) => void): Package {
  const p = structuredClone(original); change(p);
  const v = p.verification;
  v.basisDigest = sha256(canonical(v.basis));
  p.basisInventory = blob(p.basisInventory.name, Buffer.from(canonical(v.basis.map(pin => pin.path))), p.basisInventory.type);
  delete p.digest;
  v.payloadDigest = payloadDigest(p); v.native.payloadDigest = v.payloadDigest;
  p.digest = sha256(canonical(p));
  return p;
}
/** Every pin list of a package: its source pins, its basis and each check's before and after. */
const pinLists = (p: Package) => [p.sourcePins, p.verification.basis, ...p.verification.checks.flatMap(c => [c.before, c.after])];
/** The stamp workflow's D1 query surface (scripts/stamp-workflow.mjs d1Queries: read, write), over node:sqlite. */
const workflowDb = (db: Sqlite) => ({
  async read(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params); },
  async write(_key: string, sql: string) { db.exec('BEGIN'); try { db.exec(sql); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } return []; },
});
/** Role values outside the three, each a case, a spelling or a word away from one of them. */
const OUTSIDE_ROLES = ['owner', 'reader', 'Operator', 'ADMIN', 'Catalog-Import', 'catalog_import', 'catalog-import ', ''];
/** The values the role column's `CHECK (role IN (…))` lists, sorted; a sentence when the column has no such CHECK. */
function roleCheck(tableSql: string): string[] | string {
  const list = /\brole\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)\s*\)/i.exec(tableSql)?.[1];
  return list === undefined ? `no CHECK (role IN (…)) on the role column: ${tableSql.slice(0, 200)}` : [...list.matchAll(/'([^']*)'/g)].map(m => m[1]!).sort();
}
const attempt = async (run: () => unknown) => { try { await run(); return 'accepted'; } catch (error) { return `refused: ${(error as Error).message}`; } };

describe('unit:P87.SC3', () => {
  it(`logic: migrations/${MIGRATION_0014} and migrations/product/${MIGRATION_0014} are byte-identical; applied forward to a database at 0013 holding credential rows it keeps every row (operator, admin, one revoked) and the index, extends operator_service_credentials.role's CHECK to operator, admin and catalog-import and nothing else, leaves operator_memberships untouched (its CHECK refusing catalog-import), and leaves PRAGMA foreign_key_check empty; the row guard reads a catalog-import row`, async () => {
    const top = readdirSync(new URL('migrations/', ROOT)).filter(name => name.startsWith('0014_')).sort(), product = productMigrations().filter(name => name.startsWith('0014_'));
    expect({ top, product, identical: top.length === 1 && product.length === 1 && readBytes('migrations/' + top[0]).equals(readBytes('migrations/product/' + product[0])) },
      `P87.SC3 — migrations/${MIGRATION_0014} and migrations/product/${MIGRATION_0014} exist and are byte-identical (today: none)`).toEqual({ top: [MIGRATION_0014], product: [MIGRATION_0014], identical: true });

    const db = database(productMigrations().filter(name => name < '0014_'));
    const at = Date.now(), hash = (n: number) => String(n).repeat(43).slice(0, 43);
    db.prepare(`INSERT INTO operator_accounts(id,email,name,password_hash,created_at,updated_at) VALUES ('p87-owner','p87-owner@stamp.invalid','Owner','x',?,?)`).run(at, at);
    db.prepare('INSERT INTO operator_memberships VALUES (?,?,?,?,?,?,?)').run('p87-owner', TENANT, 'admin', 0, 0, 'p87-membership', at);
    const credential = db.prepare('INSERT INTO operator_service_credentials (id,subject,tenant,role,token_hash,expires_at,created_at,created_by,revoked_at) VALUES (?,?,?,?,?,?,?,?,?)');
    credential.run('00000000-0000-4000-8000-000000000001', 'p87-operator-job', TENANT, 'operator', hash(1), 4102444800, at, 'p87-owner', null);
    credential.run('00000000-0000-4000-8000-000000000002', 'p87-admin-job', TENANT, 'admin', hash(2), 4102444800, at + 1, 'p87-owner', null);
    credential.run('00000000-0000-4000-8000-000000000003', 'p87-retired-job', OTHER_TENANT, 'operator', hash(3), 4102444800, at + 2, 'p87-owner', at + 3);
    const snapshot = () => ({
      credentials: db.prepare('SELECT * FROM operator_service_credentials ORDER BY id').all(),
      columns: db.prepare('PRAGMA table_info(operator_service_credentials)').all(),
      memberships: db.prepare('SELECT * FROM operator_memberships').all(),
      membershipsSql: db.prepare("SELECT sql FROM sqlite_master WHERE name='operator_memberships'").get()?.sql ?? null,
      tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name),
      index: db.prepare("PRAGMA index_info('idx_operator_services_tenant')").all().map(r => r.name),
      indexOn: db.prepare("SELECT tbl_name FROM sqlite_master WHERE name='idx_operator_services_tenant'").get()?.tbl_name ?? null,
    });
    const before = snapshot();
    db.exec('BEGIN'); db.exec(readTree('migrations/product/' + MIGRATION_0014)); db.exec('COMMIT');
    expect.soft(snapshot(), 'P87.SC3 — 0014 keeps every credential row, every column, every table and the index on (tenant, created_at); operator_memberships is untouched').toEqual(before);
    const insert = (role: string, id: string) => attempt(() => db.prepare('INSERT INTO operator_service_credentials (id,subject,tenant,role,token_hash,expires_at,created_at,created_by,revoked_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, 'p87-new-job', TENANT, role, hash(4), 4102444800, at + 4, 'p87-owner', null));
    // R-P431 F2: "the three roles and nothing else" — values outside them, a case or a spelling away included, are refused.
    const outsideAccepted = async () => {
      const accepted: string[] = [];
      for (const [i, role] of OUTSIDE_ROLES.entries()) if (await insert(role, `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`) === 'accepted') accepted.push(role);
      return accepted;
    };
    expect.soft({ catalogImport: await insert(ROLE, '00000000-0000-4000-8000-000000000004'), operator: await insert('operator', '00000000-0000-4000-8000-000000000005'),
      admin: await insert('admin', '00000000-0000-4000-8000-000000000006'), outsideAccepted: await outsideAccepted(),
      roleCheck: roleCheck(String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='operator_service_credentials'").get()?.sql ?? '')),
      membership: (await attempt(() => db.prepare('INSERT INTO operator_memberships VALUES (?,?,?,?,?,?,?)').run('p87-owner', OTHER_TENANT, ROLE, 0, 0, 'p87-m2', at))).startsWith('refused') ? 'refused' : 'accepted',
      foreignKeys: db.prepare('PRAGMA foreign_key_check').all() },
    'P87.SC3 — the CHECK admits operator, admin and catalog-import and nothing else (no outside value accepted; the role column\'s CHECK lists exactly the three); operator_memberships refuses catalog-import; foreign_key_check is empty')
      .toEqual({ catalogImport: 'accepted', operator: 'accepted', admin: 'accepted', outsideAccepted: [], roleCheck: ['admin', 'catalog-import', 'operator'], membership: 'refused', foreignKeys: [] });
    const read = await attempt(async () => {
      const row = await d1Authority(d1(db, { calls: [], failSql: null, failPut: null }) as unknown as D1Database).credential('00000000-0000-4000-8000-000000000004');
      if (row?.role !== ROLE) throw new Error(`role read as ${String(row?.role)}`);
    });
    expect.soft(read, 'P87.SC3 — the row guard (src/auth/authority.ts credentialRow) reads a catalog-import credential').toBe('accepted');
    db.close();
  });

  it(`logic: the customer stamp's package (scripts/stamp-workflow.mjs packageArtifact) carries ${MIGRATION_0014} last, under the schema contract ${SCHEMA_CONTRACT_0014}, its bytes pinned by hash; a package built before 0014 (four migrations under operator-oidc-v2) still validates and migrates a database as today, and the new package migrates that database forward to 0014`, async () => {
    const artifact = await packageArtifact() as unknown as Package;
    const file = new URL(`migrations/product/${MIGRATION_0014}`, ROOT), bytes = existsSync(file) ? readBytes(`migrations/product/${MIGRATION_0014}`) : null;
    expect({ contract: artifact.schemaContract ?? null, migrations: artifact.migrations.map(m => m.name), last: artifact.migrations.at(-1)?.sha256 ?? null },
      `P87.SC3 — the package step carries the 0014 migration last with its hash (today: ${artifact.migrations.map(m => m.name).join(', ')} under ${artifact.schemaContract})`)
      .toEqual({ contract: SCHEMA_CONTRACT_0014, migrations: ['0010_operator_accounts.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql', MIGRATION_0014],
        last: bytes ? sha256(bytes) : `the sha256 of migrations/product/${MIGRATION_0014}` });

    // The hash is pinned: a 0014 whose bytes differ, its source pin and basis agreeing with them, is refused.
    const path = `migrations/product/${MIGRATION_0014}`;
    const tampered = reform(artifact, p => {
      const last = p.migrations.at(-1)!; Object.assign(last, blob(last.name, Buffer.concat([bytes!, Buffer.from('\n-- p87: bytes the pinned hash does not name\n')]), last.type));
      for (const pins of pinLists(p)) for (const pin of pins) if (pin.path === path) Object.assign(pin, { bytes: last.bytes, sha256: last.sha256 });
    });
    expect.soft(await attempt(() => validateArtifact(tampered)), 'P87.SC3 — a package whose 0014 bytes are not the pinned ones is refused').toBe('refused: Stamp workflow unavailable');

    // The package built before 0014: the same package without the 0014 migration and its pins, under operator-oidc-v2.
    const earlier = reform(artifact, p => {
      p.schemaContract = 'operator-oidc-v2'; p.migrations = p.migrations.filter(m => m.name !== MIGRATION_0014);
      const keep = (pins: Pin[]) => pins.filter(pin => !pin.path.endsWith('/' + MIGRATION_0014));
      p.sourcePins = keep(p.sourcePins); p.verification.basis = keep(p.verification.basis);
      for (const check of p.verification.checks) { check.before = keep(check.before); check.after = keep(check.after); }
    });
    const db = database([]);
    const history = () => db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(r => r.name);
    const valid = await attempt(() => validateArtifact(earlier));
    const migrated = await attempt(() => migrateProduct(workflowDb(db), earlier));
    const at13 = valid === 'accepted' && migrated === 'accepted' ? history() : [];
    if (migrated === 'accepted') db.prepare('INSERT INTO operator_service_credentials (id,subject,tenant,role,token_hash,expires_at,created_at,created_by,revoked_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('00000000-0000-4000-8000-000000000011', 'p87-operator-job', TENANT, 'operator', 'a'.repeat(43), 4102444800, 1, 'p87-owner', null);
    const forward = await attempt(() => migrateProduct(workflowDb(db), artifact));
    const kept = forward === 'accepted' ? db.prepare('SELECT subject, role FROM operator_service_credentials').all() : [];
    expect.soft({ valid, migrated, at13, forward, at14: forward === 'accepted' ? history() : [], kept },
      'P87.SC3 — a package built before 0014 validates and migrates a fresh database to 0013 as today; the new package migrates it forward to 0014, the credential row kept')
      .toEqual({ valid: 'accepted', migrated: 'accepted', at13: ['0010_operator_accounts.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql'],
        forward: 'accepted', at14: ['0010_operator_accounts.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql', MIGRATION_0014],
        kept: [{ subject: 'p87-operator-job', role: 'operator' }] });
    db.close();
  }, 300_000);

  it('logic: the platform monitor (src/ops/monitor.ts checkProductSchema) passes a database at 0014, reports Schema unavailable for one at 0013 and Migrations unavailable for one at 0014 whose migration history does not name 0014', async () => {
    const all = productMigrations();
    expect(all, `P87.SC3 — PRECONDITION: migrations/product/${MIGRATION_0014} exists (today: ${all.join(', ')})`).toContain(MIGRATION_0014);
    const at13 = all.filter(name => name < '0014_'), at14 = all.filter(name => name <= MIGRATION_0014);
    const check = async (applied: string[], recorded: string[]) => {
      const db = database(applied);
      db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
      for (const name of recorded) db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(name);
      try { await checkProductSchema({ DB: d1(db, { calls: [], failSql: null, failPut: null }) } as unknown as Env); return 'passes'; }
      catch (error) { return (error as Error).message; } finally { db.close(); }
    };
    expect.soft({ at14: await check(at14, at14), at13: await check(at13, at13), unrecorded: await check(at14, at13) },
      'P87.SC3 — checkProductSchema knows 0014: its product schema is the one after 0014 and its required migration list names 0014')
      .toEqual({ at14: 'passes', at13: 'Schema unavailable', unrecorded: 'Migrations unavailable' });
  });

  it('kit: kit 02\'s machine-credential paragraph names the role catalog-import, the eight routes it admits, the refusal of every other operator route (403, catalog_credential) and the replacement that narrows an operator credential to it; its migration sentence names 0013 and 0014 beside 0012', () => {
    const kit = readTree('docs/kit/02-api-reference.md').split('\n');
    const paragraph = kit.find(line => line.startsWith('Customer machine credentials are independently registered')) ?? '';
    const migration = kit.find(line => line.startsWith('Apply additive migration')) ?? '';
    const sentences = (text: string) => text.split(/(?<=[.;])\s+(?=[A-Z`(])/);
    /** The routes the best of the admitting sentences leaves unstated; all eight when no sentence admits. */
    const admittedIn = (admitting: string[]) => admitting.map(text => KIT_ROUTES.filter(([, stated]) => !stated.test(text)).map(([route]) => route))
      .sort((a, b) => a.length - b.length)[0] ?? KIT_ROUTES.map(([route]) => route);
    expect.soft({
      paragraph: paragraph ? 'found' : 'missing',
      role: paragraph.includes('`catalog-import`'),
      // R-P435 G2: the eight routes stated as ADMITTED — inside one sentence naming catalog-import and saying it admits them.
      // R-P437 H1: an admitting sentence, not a denial (no `not`, `never` or `no` in it).
      routesNotStatedAsAdmitted: admittedIn(sentences(paragraph).filter(s => s.includes('catalog-import') && /admit/i.test(s) && !/\b(?:not|never|no)\b/i.test(s))),
      refusal: /\b403\b/.test(paragraph) && paragraph.includes('catalog_credential'),
      narrowing: sentences(paragraph).some(s => /replac/i.test(s) && s.includes('catalog-import') && /\boperator\b/.test(s)),
      migration: sentences(migration).some(s => s.includes('0012') && s.includes('0013') && s.includes('0014')),
    }, 'P87.SC3 — kit 02 states the catalogue credential, the eight routes it admits (in one sentence naming catalog-import that admits them; each with its method; the publication read and recover with kind catalog), the 403 catalog_credential refusal, the narrowing replacement, and names migration 0014 (today it names operator and admin roles only, and migration 0012 alone)')
      .toEqual({ paragraph: 'found', role: true, routesNotStatedAsAdmitted: [], refusal: true, narrowing: true, migration: true });
  });

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — operator and admin credentials are unchanged: registered, they read and publish (an operator credential publishes the slots), an admin replacement revokes an operator credential atomically, a revoked one and an expired one are 401`, async () => {
      const s = await stamp(host); ready(s);
      const operator = await register(s, 'operator', SUBJECTS.operator), admin = await register(s, 'admin', SUBJECTS.admin);
      const slots = await pre(s, 'slots', operator.token);
      const published = await s.call('PUT', '/content/slots', { token: operator.token, body: { document: slots.document, note: 'p87 lock' }, headers: slots.headers });
      const learn = await pre(s, 'learn', admin.token);
      const adminPublished = await s.call('PUT', '/content/learn', { token: admin.token, body: { document: learn.document, note: 'p87 lock' }, headers: learn.headers });
      const replacement = await register(s, 'admin', SUBJECTS.operator, { replaces: operator.id });
      const oldUse = await s.call('GET', '/content/slots', { token: operator.token }), newUse = await s.call('GET', '/config/reflex', { token: replacement.token });
      const revoke = await s.call('DELETE', `/auth/service-credentials/${admin.id}`), revoked = await s.call('GET', '/content/slots', { token: admin.token });
      const brief = await register(s, 'operator', SUBJECTS.operator, { expiresAt: Math.floor(Date.now() / 1000) + 60 });
      const expired = await later(120_000, () => s.call('GET', '/content/slots', { token: brief.token }));
      const rows = await listed(s);
      expect({ registered: [registeredRow(operator), registeredRow(admin)], published: published.status, adminPublished: adminPublished.status,
        replacement: replacement.answer.status, oldRevoked: typeof rows.get(operator.id)?.revokedAt, oldUse: oldUse.status, newUse: newUse.status,
        revoke: revoke.status, revoked: revoked.status, brief: brief.answer.status, expired: expired.status },
      `${host}: P87.SC3 — LOCK: operator and admin credentials as kit 02 states them`)
        .toEqual({ registered: [{ status: 201, role: 'operator', token: 'a signed token' }, { status: 201, role: 'admin', token: 'a signed token' }], published: 200, adminPublished: 200,
          replacement: 201, oldRevoked: 'number', oldUse: 401, newUse: 200, revoke: 200, revoked: 401, brief: 201, expired: 401 });
    });
  }
});
