// src/units/P105/LEDGER.unit.test.ts
// P105 under the Closure Ledger: the tests for the LOCAL criteria of the P105 work
// order (programme tapestry-parity-request-path, docs/parity/request-path/program.json:
// "The published-audience list: one document in the tenant's configuration
// publication, read through the action's own pin, never re-read on a timer"). One
// `describe('unit:P105.<criterion>')` per LOCAL criterion (AL1-AL6); every host leg is
// walked on both shopper hosts. LV1 is a deferred live row and gets no test.
//
// THE AUTHORITY, verbatim (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md,
// section 2, E30, "Done when"):
//   - The document. The tenant's published audiences are one document, an optional
//     member of its configuration publication, written by every publish, archive,
//     rename, pin and seed as one set publication.
//   - The read. Every qualification on both hosts reads it through the pin the action
//     already holds: none while the publication is unchanged, one storage read after a
//     change or on a new machine, at any number of audiences.
//   - Writes. A write is seen on the next action everywhere, with no timer and no KV
//     propagation window, and no write is lost to a concurrent one.
//   - Limits and failures. The audiences member is bound like every publication member,
//     2 MiB (about 3,300 audiences of today's size), refused by name past it (R-P621). An
//     unreadable publication fails qualification and never falls back.
//   - The move. Existing tenants are moved from their KV records by their first audience
//     write and by the five-minute scheduled run, every page read. The demo's
//     regeneration is one publication.
//   - The flaky test. P61.LO3 passes with the copy's old ten-second line crossed between
//     its rounds (today 53 and 51 calls where 5 and 3 are expected).
// The design pinned: _evidence/parity-step3/S52/analyst-audience/DESIGN.md (design D, §5;
// the move, §7; the tests it names, §9), adopted by R-P621; the cause R-P603, R-P607.
//
// THE ONE REPRESENTATION THESE UNITS READ (design D, §5; the publication's own names):
// the member is the set ref `audiences:<tenant>` (publication.ts `member`), its revision
// object `config-publication/v1/<tenant>/audiences/rev/<n>.json` (`revisionKey`), its
// value `{ version: 1, audiences: AudienceDef[] }`, every entry `status: 'published'`.
// The units read it from the stored objects (`audiencesMember` below), never through an
// export, so no export name is ruled here; the store's KV records stay
// `audience:<key>` under the tenant's KV prefix (src/tenancy/tenant.ts TenantKV).
//
// READINGS (the specifier's; for the lead to confirm or rule):
//   R1. "A tenant whose set has no audiences member" (AL4) is the moved/unmoved line. A
//       tenant with NO publication at all — no STORAGE binding, or a head storage answers
//       absent (`publication_uninitialized`, publication.ts requiredHead / currentSet) — is
//       read as unmoved: its KV records are read (every page, the gets together) and its
//       writes stay KV writes until it has a publication; it is never "unreadable". Only a
//       publication that exists and cannot be read (`publication_unavailable`) fails
//       qualification (AL3). This keeps W01.08's and W03.02's fixtures (tenants with no
//       publication) answering as today, their call lists gaining the head read only (R10s).
//   R2. "No audience read while the publication is unchanged and the isolate holds it"
//       (AL1) is measured with the clock moved 25 s before each measured action (under the
//       publication's own 30 s idle expiry, PUBLICATION_CACHE_MS, which P102 lifts), six
//       measured actions, so every old ten-second line is crossed and any audience timer
//       up to 150 s is crossed too; a timer on any other clock, or longer, is caught by
//       AL2 (another isolate's write seen on the next action with no clock moved) and AL6
//       (10.5 s of real time). An "audience read" is any KV or R2 read whose key names the
//       audiences OR that qualification issued (MockSegmentProvider.fetchQualifiedSegments on
//       the call's stack, awaiting frames included): a pin of its own, a head and a set read
//       for the audiences, is an audience read whatever its key (the `no-pin` wrong fix made
//       exactly that, and the empty-member baseline paid it too). "Within half a call of the
//       same action with no audiences": the baseline is the same action on the tenant moved
//       with an empty member; the one unrelated timed read an action makes on its own
//       schedule, the shopper's feature-variable override list (lane E4's other ten-second
//       copy, FeatureVariableManager OVERRIDES_LIST_MS; DESIGN.md "out of scope, noticed" 1),
//       is counted at one call's latency where the two differ, and nothing else is.
//   R3. "An isolate holding nothing" is simulated as a new isolate: the request path's
//       bindings replaced by new binding objects over the same data (every isolate cache
//       is keyed by its binding, publication.ts storageIdentity, sessionAuthority.ts
//       ownerBindingIdentity) and the publication's serving cache emptied
//       (`invalidatePublicationCache`). "Another isolate" (AL2, AL3) is the operator
//       routes served over another pair of binding objects over the same data.
//   R4. "Refused 413 document_too_large naming it": the store's refusal carries status
//       413, code `document_too_large` and the member's name (`audiences`); the operator
//       door answers it as src/routes/operator.ts answers every non-validation failure
//       today (500 `Failed to publish audience` with the refusal's message in `details`),
//       because operator.ts is not in P105's allowed paths. The door leg therefore pins
//       "not published, nothing changed, the refusal named in the answer", not the 413.
//   R5. "Every get issued at once" (AL4) is read literally: all of the unmoved read's gets
//       are in flight together (one wave after the list's pages), not one wave per page.
//   R6. "The kit left as today" (the brief's wrong-fix list): the work order changes no kit
//       file (allowedPaths) and kit 02 states nothing about the audience list (no
//       `/operator/audiences`, no ten-second or KV-minute sentence: grep of docs/kit). What
//       a kit reader can see is kit 02's kind list (§4, "kind must be catalog, slots,
//       learn, priors, vocabulary, import-sources or layouts"), which design D keeps true
//       (the member is not a `/content/{kind}`): AL5 locks it. No kit sentence is
//       demanded here; if the lead wants one (the member's bound, the operator door), the
//       work order needs docs/kit/02-api-reference.md in its paths and a ruled sentence.
//   R7. AL2's "seen on the next action" is the shopper's action (an owner operation, which
//       reads the head by a handle of its own every time). The operator's own list read
//       (GET /operator/audiences, operator.ts:159) is not an owner operation: its pin holds
//       the worker's binding, the identical handle of its previous read, which
//       publication.ts answers from its entry for up to PUBLICATION_CACHE_MS (30 s) with no
//       storage read. Measured on the sketch: a rename by another isolate is absent from
//       this isolate's operator list read made within 30 s. Not demanded (AL2 rules the
//       action); named as a residual. A write through this isolate invalidates its entries
//       and is read at once (AL2's first leg reads the operator list after each write).
//   GREEN-AT-SPEC: AL5's five lock legs pass today and on the sketch (measured).
//
// DEFERRED: LV1 (lane L21 on the pair's next release, the stamps read-only) — no test.
//
// RESIDUALS (named, not tested here):
//   - The deploy window (DESIGN.md §7): an isolate of the previous release writing only a
//     KV record after the tenant moved is not in the member and so is not published; the
//     five-minute run moves only a tenant with no member. Locally untestable (two
//     releases); LV1 should publish across a deploy.
//   - "No clone of the whole list per call" (work order, remaining work 2): not observable
//     within half a call at 1,000 audiences; the reviewer reads it.
//   - The operator door answers a 413 refusal 500 (R4): operator.ts outside the grant.
//   - The unmoved tenant's path may keep lane E4's ten-second copy (work order: "left only
//     on the unmoved tenant's path or removed"): an unmoved tenant pays one KV list per ten
//     seconds per isolate until the five-minute run moves it (one run after the deploy).
//   - The operator's list read on a non-owner request is answered from its held entry for
//     up to 30 s after another isolate's write (R7).
//   - The shopper's feature-variable override list keeps lane E4's ten-second re-read on
//     the request path (DESIGN.md "out of scope, noticed" 1; measured here as one extra
//     call on a session-host view): the same defect class as E30, not in P105's scope.
//
// CROSS-BATCH FACTS WITH P102 (E27; spec rem/spec-p102 02170b7d, build rem/p102-build c3b6031b):
//   - P102's serving copy (`config-publication/v2/<scope>/serving.json`, written at every
//     commit) holds EVERY member's envelope and is written only at or under 1 MiB
//     (SERVING_COPY_MAX_BYTES). The audiences member is part of it: at about 619 B an
//     audience, 1,000 audiences are about 605 KiB of the copy's 1 MiB, and from roughly
//     1,500 audiences (less with a large catalogue) no copy is written, so a brand-new
//     machine's first decision takes P102's two trips (CR2) instead of one (CR3). Neither
//     work order rules which members the copy carries; the lead's ruling.
//   - A cold action names no members in P102 as built (only the decision's documents
//     stage does), so it reads the head alone and the audiences member by its own read:
//     AL1's "exactly one audience read (the member's document)" holds over P102. If a
//     builder names the audiences member in the action's pin on a machine holding nothing,
//     P102 reads it from the serving copy (`serving.json`) and AL1's cold count must be
//     re-pointed to "the member's document or the serving copy, exactly one": R10 by name
//     then, not before.
//   - P102 holds a set and its documents by identity beyond 30 s (fix A) and still reads
//     the head on every operation by a new handle: AL1's held state and AL2's "seen on
//     the next action" are unchanged by it; the five-minute run's move is placed inside the
//     tenant's existing job, as P102's backfill is (W07.04 counts the jobs).
//   - MEASURED on P102's build c3b6031b with the P105 sketch (logs p102-sketch.log): P105 34/34,
//     P61 44/44, P102 27/31. The four are P102.CR2's two five-minute-run legs on both hosts
//     ("an existing tenant (a head without the metadata, no serving copy) … rewrites its head
//     with the same bytes" and "a publication committed between the five-minute run's read
//     and its write wins … (R6) …"), green on P102's build alone (p102-alone-cr2.log, 12/12).
//     Cause: the five-minute run now also MOVES each tenant (AL4: every provisioned tenant,
//     one with no audience included), which is a set publication: the head's bytes change,
//     and an operator publication that meets the move is refused 409 publication_conflict
//     (the publication's own CAS; at most once per tenant, retried by the operator with a
//     fresh If-Match). R10 by name, for the lead, P102's file: in both legs, one
//     `fiveMinuteRun` (the move) before each `asCommittedToday(...)` (worlds `m` and `n`), so
//     the run under test is the backfill alone; and the literal `committed: 2` in the R6
//     leg becomes 3 (set 2 is the move's). Proven on P102's build with the sketch:
//     r10-proof-p102-cr2b.log, CR2 12/12. The alternative — the move skipping a tenant with
//     no KV record — leaves that tenant's request path listing KV, contrary to AL4.
//
// R10 (expectations that pin today's storage location, listed for the lead; none edited here;
// every "after" below was run on the sketch in a scratch copy of its file and passed:
// _evidence/parity-step3/S53/specifier/logs/r10-proof-sketch.log, r10-proof-w29-sketch.log):
//   - W01.08 (src/index.api-boundary.test.ts:2557, :2560, :2573-2574). Before: the exact call
//     lists `[['CACHE.list','audience:']]`, `[['CACHE.list','audience:'], ['CACHE.get','audience:authored']]`
//     and the shopper's segment read ending `['SESSIONS.get', …], ['CACHE.list','audience:'],
//     ['CACHE.get','audience:authored']`. The probe's coach tenant has no publication (unmoved,
//     R1), so each read now first reads `config-publication/v2/coach/head.json` (measured:
//     `[['STORAGE.get','config-publication/v2/coach/head.json'], ['CACHE.list','audience:']]`).
//     After: the same KV and object calls in the same order, the only other calls reads of
//     `STORAGE.get config-publication/v2/coach/head.json`; statuses, bodies and before/after
//     state unchanged. It pins a storage location (no publication read), not a behaviour.
//   - W03.02 (:3198). Before: exactly `[['CACHE.put', t:<tenant>:audience:w0302], ['CACHE.list',
//     t:<tenant>:audience:], ['CACHE.get', t:<tenant>:audience:w0302]]`. The probe's tenant has no
//     publication (unmoved, R1); measured: a head read before the put and one before the list.
//     After: the same three KV calls in the same order, the only other calls reads of
//     `STORAGE.get config-publication/v2/<tenant>/head.json`.
//   - W22.07 (src/routes/realtime.sdkContract.test.ts:2803-2812, failure 'qualification').
//     Before: the qualification fault injected at the KV get of `t:meridian:audience:`, which a
//     moved tenant never makes (the fixture publishes its two audiences through
//     KvAudienceStore.publish over a meridian publication, so they become the member; on the
//     sketch the action then answers 200, the fault never reached). After: the same fault at
//     the member's read, `STORAGE.get` of a key starting `config-publication/v1/meridian/audiences/rev/`,
//     after `invalidatePublicationCache()` (a new isolate, so the member is read), with the same
//     expectation (status >= 400 or dropped, nothing applied, queued, learned or captured).
//   - src/connectors/AudienceStore.memory.test.ts (lane E4). Before: its env has no STORAGE (an
//     unmoved tenant under R1, so it passes on the sketch unchanged), it imports
//     AUDIENCE_LIST_MS and forgetListedAudiences, and its list counts (:48, :51, :68, :91,
//     :95) pin the ten-second copy. After: the same four behaviours on a moved tenant (an env
//     with a STORAGE publication carrying the audiences member): published audiences qualify
//     exactly as a fresh read does; a write through any store of the isolate (publish,
//     archive, rename, pin, the authoring adapter) is read on the next read; a write
//     through another binding is read on the next read with no clock moved; no read lists
//     KV; a caller cannot change what the next caller reads. The ten-second counts stay
//     only on an unmoved env's path, or go with the copy, as the builder keeps or removes it.
//   - W29.R2 (src/units/W29/LEDGER.unit.test.ts:236-239, native). Before: each of the three
//     crons leaves every `config-publication/` byte unchanged; the five-minute run's move is
//     one publication (measured: set/2.json and audiences/rev/1.json added, the head moved).
//     After: one five-minute run first, asserting it adds exactly `set/2.json` and
//     `audiences/rev/1.json`, the new set's refs other than `audiences:coach` equal set 1's,
//     and no other object but the head changed; then today's detector, unchanged, from that
//     state for all three crons (the five-minute run's second pass included: the move is
//     once). Autonomy's configuration (slots, learn, proposals) is still byte-identical.
//   - No collision, a condition on the build: W07.04 (src/index.api-boundary.test.ts:3492,
//     `scheduledJobs['*/5 * * * *'] = jobs(1, 2)`) holds only if the move runs inside the
//     tenant's existing five-minute job; a `ctx.waitUntil` of its own makes it `jobs(1, 3)`.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object classes,
// both shopper hosts), src/units/_parity8.ts (the AA2 latency lever, the wire without a
// drain, `within`), src/units/_parity9.ts (P61's lift world, for AL6). Imports from
// src/units/: ../_parity, ../_parity8, ../_parity9.

import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { memoryAuthority } from '@/auth/authority';
import { memoryStore } from '@/auth/store';

import { documentBytes, initializePublicationSet, invalidatePublicationCache, PUBLICATION_MAX_BYTES, type PublicationBaseline } from '@/config/publication';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import { KvAudienceStore } from '@/connectors/AudienceStore';
import { MockSegmentProvider } from '@/connectors/SegmentProvider';
import type { AudienceDef } from '@/connectors/types';
import catalog from '@/data/coach-catalog.json';
import { SEED_AUDIENCES } from '@/data/seed-audiences';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { operatorWrites } from '@/middleware/edgeAccess';
import { errorHandler } from '@/middleware/error';
import { generateAffinityAudiences, regenerateCatalogAudiences } from '@/reflex/audienceGenerator';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import type { ReflexConfig } from '@/reflex/core';
import { configRoutes } from '@/routes/config';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import { operatorRoutes } from '@/routes/operator';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';

import {
  BRAND, expectPublished, HOSTS, MODULES, PAID_SOCIAL_ENTRY, REFLEX_DOCUMENT, TENANT, VIEW_TABBY_26, declaredSlots, layoutSlot, learnDocument, mount,
  pageInstanceOf, recentSlot, shopperOn, type Decision, type Host, type Mounted, type Shopper, type Snapshot,
} from '../_parity';
import { ackWire, actionWire, remoteLatency, settle, UNANSWERED, within, type Latency, type Wire, type WorkerApp } from '../_parity8';
import { fanExports, liftWorld, POOLED } from '../_parity9';

// AL4 loads the Worker's own entry (src/index.ts) for its scheduled handler. The three module
// doubles src/demos/kit/root.worker.test.ts:24-26 (and src/units/W08/C1.unit.test.ts:136-138)
// register, so the entry loads under Node; none is on the scheduled run's path.
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

// ===========================================================================
// The world, the levers and the readers.
// ===========================================================================

/** The parity documents every world publishes (src/units/_parity.ts). */
const DOCS = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
/** The AA2 lever's latency per remote call (src/units/_parity8.ts remoteLatency; P56's AA2). */
const PER_CALL_MS = 500;
/** AL1's bound: half a call. */
const MARGIN_MS = PER_CALL_MS / 2;
/** R2: the clock moved before each measured action, under the publication's own 30 s idle expiry. */
const STEP_MS = 25_000;
const ROUNDS = 2;
const SIZES = [10, 50, 200, 1000] as const;
/** The second provisioned tenant of the tenant-boundary and five-minute-run legs. */
const OTHER = 'acme';
/** A third provisioned tenant, with no audience record at all (the five-minute run's leg). */
const EMPTY = 'globex';
const COLD_BOUND_MS = 20 * PER_CALL_MS;

// ---------------------------------------------------------------------------
// The clock (R2): `Date.now` moved forward only, never back, for the rest of this file.
// ---------------------------------------------------------------------------
const flooredNow = Date.now.bind(Date);
let clockOffset = 0, clockInstalled = false;
function advanceClock(ms: number): void {
  if (!clockInstalled) { vi.spyOn(Date, 'now').mockImplementation(() => flooredNow() + clockOffset); clockInstalled = true; }
  clockOffset += ms;
}

// ---------------------------------------------------------------------------
// Coach's launch audiences (src/data/seed-audiences.ts, the ten ODP insight views),
// at any number: the same definitions under indexed keys.
// ---------------------------------------------------------------------------
const seedOf = (key: string): AudienceDef => {
  const found = SEED_AUDIENCES.find(a => a.key === key);
  if (!found) throw new Error(`fixture: no Coach launch audience ${key}`);
  return structuredClone(found);
};
/** The i-th of n: Coach's ten launch audiences in turn, keyed `p<i>_<launch key>`. */
const atScale = (i: number): AudienceDef => {
  const seed = SEED_AUDIENCES[i % SEED_AUDIENCES.length]!;
  return { ...structuredClone(seed), key: `p${String(i).padStart(5, '0')}_${seed.key}`, status: 'published' };
};
/** A Coach launch audience under another key, as an operator publishes it (the door's own fields). */
const authored = (launchKey: string, key: string, name = `${seedOf(launchKey).name} (${key})`): AudienceDef =>
  ({ ...seedOf(launchKey), key, name, source: 'manual', status: 'published', createdAt: 1 });
/** She meets this one from her first Tabby view (price_band_viewed: elevated). */
const LUXE = 'luxe_affinity';
/** She never meets this one (no loyalty tier). */
const VIP = 'vip_loyalist';

// ---------------------------------------------------------------------------
// The app the stamp mounts for these routes (src/index.ts: the tenant middleware, the
// operator gate on `/operator/*`, the worker's error handler, the routes), over an
// environment: the mounted one, or another isolate's bindings (R3).
// ---------------------------------------------------------------------------
function appOf(env: Env): WorkerApp {
  const pending: Promise<unknown>[] = [];
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.use('/operator/*', operatorWrites());
  app.onError(errorHandler);
  app.route('/operator', operatorRoutes);
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const fetch = async (request: Request) => app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };
  return { fetch, drain };
}

/** Another isolate (R3): its own binding objects over the same storage, so nothing this isolate holds is its own. */
function elsewhere(w: World): WorkerApp {
  return appOf({ ...w.m.env, CACHE: Object.create(w.m.env.CACHE as object), STORAGE: Object.create(w.m.env.STORAGE as object) } as Env);
}

/** A new isolate on the request path (R3): new binding objects over the same storage, and the serving cache empty. */
function newIsolate(w: World): void {
  const env = w.m.env as unknown as Record<string, unknown>;
  env.CACHE = Object.create(env.CACHE as object);
  env.STORAGE = Object.create(env.STORAGE as object);
  invalidatePublicationCache();
}

// ---------------------------------------------------------------------------
// Every KV and R2 call the mounted bindings receive, with its key, when it was issued and
// whether qualification issued it: the one reader every caller goes through (work order AL1:
// MockSegmentProvider.fetchQualifiedSegments, src/connectors/SegmentProvider.ts:35-36) on the
// call's stack, its awaiting frames included (V8's async stack traces). A read qualification
// issues is an audience read whatever its key: a pin of its own (a head or a set read) as
// much as a KV record or the member's document.
// ---------------------------------------------------------------------------
interface Traced { binding: 'CACHE' | 'STORAGE'; method: string; key: string; at: number; qualifying: boolean }
const QUALIFICATION_FRAME = /connectors[\\/]SegmentProvider\.[jt]s/;
function issuedByQualification(): boolean {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  try { return QUALIFICATION_FRAME.test(new Error('P105 trace').stack ?? ''); } finally { Error.stackTraceLimit = limit; }
}
function traceBindings(m: Mounted): Traced[] {
  const seen: Traced[] = [];
  const wrap = (binding: Traced['binding'], target: object, methods: string[]) => {
    for (const method of methods) {
      const current = (target as Record<string, (...args: unknown[]) => Promise<unknown>>)[method];
      if (typeof current !== 'function') continue;
      Object.defineProperty(target, method, { configurable: true, writable: true, value: (...args: unknown[]) => {
        const first = args[0];
        seen.push({ binding, method, key: typeof first === 'string' ? first : JSON.stringify(first ?? null), at: performance.now(), qualifying: issuedByQualification() });
        return current.apply(target, args);
      } });
    }
  };
  wrap('CACHE', m.cache, ['get', 'list', 'put', 'delete']);
  wrap('STORAGE', m.storage, ['get', 'head', 'put', 'list', 'delete']);
  return seen;
}
const READS = new Set(['get', 'list', 'head']);
/** An audience read: a KV list or get of the store's records, an R2 read of the member's revision object, or any read qualification issued. */
const isAudienceRead = (c: Traced) => READS.has(c.method) && (c.qualifying || (c.binding === 'CACHE' ? c.key.includes('audience:') : c.key.includes('/audiences/')));
const isKvAudience = (c: Traced) => c.binding === 'CACHE' && c.key.includes('audience:');
const named = (c: Traced) => `${c.binding}.${c.method} ${c.key}`;

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------
interface World { m: Mounted; host: Host; app: WorkerApp; latency: Latency; trace: Traced[]; token: string }

/**
 * The customer profile's operator authority, as src/units/W08/_customer.ts builds it: a
 * synthetic human account with a session in an AccountStore (`memoryStore`) and an admin
 * membership on each tenant in an AuthorityStore (`memoryAuthority`), and an `access`
 * token for that session, signed with the mount's own synthetic signing material
 * (src/units/_parity.ts `mount`: JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE). On the customer
 * profile a service token needs a registered credential (src/middleware/auth.ts); this
 * session works on either profile.
 */
async function operatorCredential(m: Mounted, tenants: string[]): Promise<string> {
  const env = m.env as unknown as Record<string, unknown>, at = Date.now(), id = 'p105-synthetic-operator', sid = 'p105-synthetic-operator-session';
  const accounts = memoryStore(), authority = memoryAuthority(accounts);
  await accounts.put({ id, email: `${id}@example.invalid`, name: 'Synthetic P105 operator', roles: ['operator'], permissions: ['read'], updatedAt: at });
  await accounts.putSession({ jti: sid, accountId: id, tokenHash: 'p105-synthetic-unused', createdAt: at, expiresAt: at + 6 * 3_600_000 });
  for (const tenant of tenants) {
    authority.memberships.set(JSON.stringify([id, tenant]), { tenant, accountId: id, role: 'admin', revision: `p105-${tenant}`, updatedAt: at, disabled: false, removed: false });
  }
  env.ACCOUNTS = accounts; env.AUTHORITY = authority;
  return new SignJWT({ sub: id, type: 'access', sid }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setIssuer(String(env.JWT_ISSUER)).setAudience(String(env.JWT_AUDIENCE)).setExpirationTime('6h').sign(new TextEncoder().encode(String(env.JWT_SECRET)));
}

const baselineOf = (kind: PublicationBaseline['kind'], value: unknown, scope: string): PublicationBaseline =>
  ({ kind, scope, revision: { revision: 1, at: 1, actor: 'p105-fixture', note: 'fixture', value } });

/**
 * One shopper host over the parity documents, on the customer profile unless `demo`
 * (the profile staging and production run, src/connectors/index.ts:29-37: every
 * tenant qualifies through KvAudienceStore). `tenants` provisions more tenants beside
 * coach, each with its own publication of the same documents.
 */
async function world(host: Host, opts: { demo?: boolean; tenants?: string[] } = {}): Promise<World> {
  const m = await mount(host, DOCS);
  expectPublished(m, 'P105 — the parity documents publish');
  const env = m.env as unknown as Record<string, unknown>;
  if (opts.tenants?.length) {
    const all = [TENANT, ...opts.tenants];
    env.TENANTS = JSON.stringify({ provisioned: all, operatorGrants: { ops: all } });
    const retention = JSON.parse(m.env.RETENTION as string) as { tenants: Record<string, unknown> };
    for (const tenant of opts.tenants) {
      retention.tenants[tenant] = retention.tenants[TENANT];
      await initializePublicationSet(m.env, [
        baselineOf(CONTENT_KIND, { version: 'p105-catalogue', pieces: DOCS.pieces }, tenant), baselineOf(SLOTS_KIND, DOCS.slots, tenant),
        baselineOf(LEARN_KIND, DOCS.learn, tenant), baselineOf(PRIORS_KIND, EMPTY_PRIORS, tenant),
        baselineOf(REFLEX_KIND, REFLEX_DOCUMENT, reflexScopeForTenant(tenant)),
      ], '0:' + crypto.randomUUID());
    }
    env.RETENTION = JSON.stringify(retention);
    invalidatePublicationCache();
  }
  if (!opts.demo) env.DEPLOYMENT_PROFILE = 'customer';
  const token = await operatorCredential(m, [TENANT, ...(opts.tenants ?? [])]);
  const latency = remoteLatency(m);
  const trace = traceBindings(m);
  return { m, host, app: appOf(m.env), latency, trace, token };
}

// ---------------------------------------------------------------------------
// The operator, through the door operators use (src/routes/operator.ts).
// ---------------------------------------------------------------------------
interface Answer { status: number; body: Record<string, unknown>; sentAt: number; answeredAt: number }
async function operator(w: World, method: 'GET' | 'POST', path: string, body?: unknown, opts: { app?: WorkerApp; tenant?: string } = {}): Promise<Answer> {
  const app = opts.app ?? w.app, sentAt = performance.now();
  const response = await app.fetch(new Request('http://console.test' + path, { method,
    headers: { 'X-Tenant': opts.tenant ?? TENANT, Authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const answeredAt = performance.now();
  const parsed = await response.json().catch(() => ({})) as Record<string, unknown>;
  await settle(w.m, app);
  return { status: response.status, body: parsed, sentAt, answeredAt };
}
const publishThrough = (w: World, def: AudienceDef, opts: { app?: WorkerApp; tenant?: string } = {}) =>
  operator(w, 'POST', '/operator/audiences/publish', { audience: { key: def.key, name: def.name, description: def.description, conditions: def.conditions,
    evaluation: def.evaluation, source: 'manual', status: 'published' } }, opts);
const verb = (w: World, key: string, action: 'rename' | 'pin' | 'prune', body: unknown = {}, opts: { app?: WorkerApp; tenant?: string } = {}) =>
  operator(w, 'POST', `/operator/audiences/${encodeURIComponent(key)}/${action}`, body, opts);
async function listedThrough(w: World, opts: { app?: WorkerApp; tenant?: string } = {}): Promise<AudienceDef[]> {
  const read = await operator(w, 'GET', '/operator/audiences', undefined, opts);
  expect(read.status, `PRECONDITION (${w.host}): the operator reads the published audiences (${JSON.stringify(read.body).slice(0, 200)})`).toBe(200);
  return (read.body.audiences ?? []) as AudienceDef[];
}

// ---------------------------------------------------------------------------
// The stored publication, read from the objects (never through a binding call).
// ---------------------------------------------------------------------------
const stored = (m: Mounted, key: string): Record<string, unknown> | null => {
  const raw = m.storage.objects.get(key);
  return raw === undefined ? null : JSON.parse(raw) as Record<string, unknown>;
};
/** The tenant's committed set revision (0 where it has none). */
function setRevision(m: Mounted, tenant: string = TENANT): number {
  const head = stored(m, `config-publication/v2/${tenant}/head.json`) as { committed?: { revision?: number } | null } | null;
  return head?.committed?.revision ?? 0;
}
/** The audiences member of the tenant's committed set: its revision and its audiences, or null where the set has none. */
function audiencesMember(m: Mounted, tenant: string = TENANT): { revision: number; audiences: AudienceDef[] } | null {
  const revision = setRevision(m, tenant);
  if (!revision) return null;
  const set = stored(m, `config-publication/v2/${tenant}/set/${revision}.json`) as { refs?: Record<string, { revision: number }> } | null;
  const ref = set?.refs?.[`audiences:${tenant}`];
  if (!ref) return null;
  const document = stored(m, `config-publication/v1/${tenant}/audiences/rev/${ref.revision}.json`) as { value?: { audiences?: AudienceDef[] } } | null;
  return { revision: ref.revision, audiences: document?.value?.audiences ?? [] };
}
const keysOf = (defs: readonly AudienceDef[] | null | undefined) => (defs ?? []).map(d => d.key).sort();
/** A KV record as an earlier release wrote it (src/connectors/AudienceStore.ts at 2a90ecf0: `audience:<key>` under the tenant's prefix). */
function legacyRecord(m: Mounted, tenant: string, def: AudienceDef): void {
  m.cache.data.set(`${tenant === TENANT ? '' : `t:${tenant}:`}audience:${def.key}`, JSON.stringify(def));
}

// ---------------------------------------------------------------------------
// A measured action: the shopper's wire under the lever, bounded, then everything it
// caused settled; its answer, time, own remote calls and every audience read it made.
// ---------------------------------------------------------------------------
interface Measured { status: number; body: Record<string, unknown>; ms: number | null; own: number; reads: string[]; kv: string[]; overrideLists: number }
/**
 * The one unrelated timed read an action can make on its own schedule: the shopper's
 * feature-variable override list, lane E4's other ten-second copy (FeatureVariableManager
 * OVERRIDES_LIST_MS; DESIGN.md "out of scope, noticed" 1). AL1's time bound counts each such
 * list, made by the measured action and not by its baseline, at one call's latency.
 */
const isOverrideList = (c: Traced) => c.binding === 'CACHE' && c.method === 'list' && c.key.includes('"prefix":"override:');
async function measured(w: World, send: () => Promise<Wire>, bound: number, lever = PER_CALL_MS): Promise<Measured> {
  const fromCalls = w.latency.calls.length, fromTrace = w.trace.length;
  w.latency.set(lever);
  const work = send();
  const raced = await within(work, bound);
  w.latency.set(0);
  const wire = raced === UNANSWERED ? await work : raced;
  await settle(w.m, w.app);
  const caused = w.trace.slice(fromTrace);
  return { status: wire.status, body: wire.body, ms: raced === UNANSWERED ? null : Math.round(wire.answeredAt - wire.sentAt),
    own: w.latency.calls.slice(fromCalls).filter(c => c.at <= wire.answeredAt).length,
    reads: caused.filter(isAudienceRead).map(named), kv: caused.filter(isKvAudience).map(named),
    overrideLists: caused.filter(c => c.at <= wire.answeredAt && isOverrideList(c)).length };
}
/** Whether the answer names her segments, and whether `key` is among them. */
const stillQualifies = (m: Measured, key: string) => { const segments = segmentsOf(m.body); return { segmentsNamed: segments !== null, qualifies: segments?.includes(key) ?? null }; };
/** The shopper's segments the action's answer names (`update.data.segments`, present when her membership changed), or null. */
const segmentsOf = (body: Record<string, unknown>): string[] | null => {
  const update = body.update as { data?: { segments?: unknown } } | undefined;
  return Array.isArray(update?.data?.segments) ? update!.data!.segments as string[] : null;
};

type Kind = 'view' | 'buffered' | 'ack';
const KINDS: readonly Kind[] = ['view', 'buffered', 'ack'];
const LABEL: Record<Kind, string> = { view: 'Tabby view', buffered: 'buffered action', ack: 'render acknowledgement' };
/** The wire of one action kind, its unmeasured part done first (the acknowledgement's own page). */
async function sender(w: World, s: Shopper, kind: Kind): Promise<() => Promise<Wire>> {
  if (kind === 'view') return () => actionWire(w.app, s, VIEW_TABBY_26);
  if (kind === 'buffered') {
    const original = Date.now() - 60_000;
    return () => actionWire(w.app, s, { ...VIEW_TABBY_26, processing: 'buffered', browsingSessionId: s.grant.sessionId } as unknown as typeof VIEW_TABBY_26,
      { eventId: crypto.randomUUID(), timestamp: original });
  }
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p105-ack') });
  const offered = page.decisions.find(d => d.renderOffer);
  expect(offered ? page.status : `no offered decision (${page.status})`, `PRECONDITION (${w.host}): the product page offers a decision to acknowledge`).toBe(200);
  return () => ackWire(w.app, s, page, offered!);
}

/** The tenant moved with no audience in it: one published and pruned through the operator door. */
async function movedEmpty(w: World): Promise<void> {
  const placeholder = authored(VIP, 'p105_placeholder');
  expect((await publishThrough(w, placeholder)).status, `PRECONDITION (${w.host}): the operator publishes an audience`).toBe(200);
  expect((await verb(w, placeholder.key, 'prune')).status, `PRECONDITION (${w.host}): and prunes it`).toBe(200);
}

// ===========================================================================
// unit:P105.AL1 — no audience read on a held publication; one after a change or cold.
// ===========================================================================

describe('unit:P105.AL1', () => {
  for (const host of HOSTS) for (const n of SIZES) {
    it(`host (${host}): at ${n} published audiences, under the AA2 lever (${PER_CALL_MS} ms on every remote call, customer profile), a Tabby view, a buffered action and a render acknowledgement on an isolate that holds the unchanged publication make no audience read and answer within ${MARGIN_MS} ms of the same action with no audiences, with the clock moved ${STEP_MS / 1000} s before each (the old ten-second line crossed every time); the action right after the publication changed, and a view on a new isolate, each make exactly one audience read, the member's document, and no KV list or audience get`, async () => {
      const w = await world(host);
      await movedEmpty(w);
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her first view is accepted`).toBe(200);
      await settle(w.m, w.app);

      // The same actions with no audiences: the baseline each held action is compared with.
      const baseline = {} as Record<Kind, Measured>;
      for (const kind of KINDS) {
        advanceClock(STEP_MS);
        baseline[kind] = await measured(w, await sender(w, s, kind), COLD_BOUND_MS);
        expect([baseline[kind].status, baseline[kind].ms === null ? 'unanswered' : 'answered'],
          `PRECONDITION (${host}): the ${LABEL[kind]} with no audiences answers under the lever`).toEqual([200, 'answered']);
      }

      // n of Coach's launch audiences published, through the store's own batch write.
      await new KvAudienceStore(w.m.env, TENANT as TenantId).seed(Array.from({ length: n }, (_, i) => atScale(i)));
      const changed = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);

      const held: Array<{ label: string; base: Measured; got: Measured }> = [];
      for (let round = 1; round <= ROUNDS; round++) for (const kind of KINDS) {
        advanceClock(STEP_MS);
        held.push({ label: `${LABEL[kind]} (round ${round})`, base: baseline[kind], got: await measured(w, await sender(w, s, kind), baseline[kind].ms! + 3 * PER_CALL_MS) });
      }
      newIsolate(w);
      const cold = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS);

      for (const { label, base, got } of held) {
        const allowed = base.ms! + MARGIN_MS + PER_CALL_MS * (got.overrideLists - base.overrideLists);
        expect({ status: got.status, audienceReads: got.reads, withinHalfACall: got.ms !== null && got.ms <= allowed },
          `${host}: P105.AL1 — at ${n} audiences the ${label}, ${STEP_MS / 1000} s after the last action on an isolate holding the unchanged publication, makes no audience read and answers within ${MARGIN_MS} ms of the same action with no audiences (${got.ms === null ? `no answer within ${base.ms! + 3 * PER_CALL_MS} ms` : `${got.ms} ms`} against ${base.ms} ms, override lists ${got.overrideLists} against ${base.overrideLists}; ${got.reads.length} audience reads: ${got.reads.slice(0, 3).join(', ')}${got.reads.length > 3 ? ', …' : ''})`)
          .toEqual({ status: 200, audienceReads: [], withinHalfACall: true });
      }
      const member = audiencesMember(w.m);
      const memberRead = `STORAGE.get config-publication/v1/${TENANT}/audiences/rev/${member?.revision}.json`;
      expect({ status: changed.status, audienceReads: changed.reads },
        `${host}: P105.AL1 — at ${n} audiences the view right after the publication changed reads the audiences once, the member's document (${changed.reads.length} audience reads: ${changed.reads.slice(0, 3).join(', ')}${changed.reads.length > 3 ? ', …' : ''})`)
        .toEqual({ status: 200, audienceReads: [memberRead] });
      expect(segmentsOf(changed.body) ?? [], `${host}: P105.AL1 — and qualifies her against them: she meets ${atScale(6).key} (${LUXE}, her elevated price band)`).toContain(atScale(6).key);
      expect({ status: cold.status, audienceReads: cold.reads, kv: cold.kv },
        `${host}: P105.AL1 — at ${n} audiences a view on a new isolate reads the audiences once, the member's document, and no KV list or audience get (${cold.reads.length} audience reads)`)
        .toEqual({ status: 200, audienceReads: [memberRead], kv: [] });
    }, 600_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}): the segment read (GET /realtime/segments/:userId, a caller of the same qualification) on an isolate that holds the unchanged publication makes no audience read, the clock ${STEP_MS / 1000} s on`, async () => {
      const w = await world(host);
      await new KvAudienceStore(w.m.env, TENANT as TenantId).seed(Array.from({ length: 50 }, (_, i) => atScale(i)));
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her view is accepted`).toBe(200);
      await settle(w.m, w.app);
      advanceClock(STEP_MS);
      const read = await measured(w, async () => {
        const sentAt = performance.now();
        const response = await w.app.fetch(new Request(`https://shop.invalid/realtime/segments/${s.subject}`, { headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability } }));
        const answeredAt = performance.now();
        return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown>, answeredAt, sentAt };
      }, COLD_BOUND_MS, 0);
      expect({ status: read.status, audienceReads: read.reads },
        `${host}: P105.AL1 — the segment read on a held publication makes no audience read (${read.reads.length}: ${read.reads.slice(0, 3).join(', ')})`)
        .toEqual({ status: 200, audienceReads: [] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P105.AL2 — a write is seen on the next action everywhere, with no clock moved.
// ===========================================================================

describe('unit:P105.AL2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): through this isolate's operator door, with no clock moved, an audience published qualifies her on the next action, a rename and a pin read renamed and pinned on the next read, and a prune stops it qualifying on the next action; once the tenant is moved no action reads an audience from KV`, async () => {
      const w = await world(host);
      expect((await publishThrough(w, authored(VIP, 'al2_vip'))).status, `PRECONDITION (${host}): the tenant's first audience is published`).toBe(200);
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her view is accepted`).toBe(200);
      await settle(w.m, w.app);

      const luxe = authored(LUXE, 'al2_luxe');
      expect((await publishThrough(w, luxe)).status, `PRECONDITION (${host}): the operator publishes ${luxe.key}`).toBe(200);
      const afterPublish = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(segmentsOf(afterPublish.body) ?? [], `${host}: P105.AL2 — the next action qualifies her for ${luxe.key}, published through this isolate`).toContain(luxe.key);

      expect((await verb(w, luxe.key, 'rename', { name: 'Luxe browsers (renamed)' })).status, `PRECONDITION (${host}): the operator renames it`).toBe(200);
      expect((await listedThrough(w)).find(d => d.key === luxe.key)?.name, `${host}: P105.AL2 — the next read names it renamed`).toBe('Luxe browsers (renamed)');
      expect((await verb(w, luxe.key, 'pin', { pinned: true })).status, `PRECONDITION (${host}): the operator pins it`).toBe(200);
      expect((await listedThrough(w)).find(d => d.key === luxe.key)?.pinned, `${host}: P105.AL2 — the next read names it pinned`).toBe(true);
      const afterPin = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);

      expect((await verb(w, luxe.key, 'prune')).status, `PRECONDITION (${host}): the operator prunes it`).toBe(200);
      const afterPrune = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(stillQualifies(afterPrune, luxe.key), `${host}: P105.AL2 — the next action stops qualifying her for ${luxe.key}, pruned through this isolate: her answer names her segments, without it (${JSON.stringify(segmentsOf(afterPrune.body))})`)
        .toEqual({ segmentsNamed: true, qualifies: false });

      expect({ afterPublish: afterPublish.kv, afterPin: afterPin.kv, afterPrune: afterPrune.kv },
        `${host}: P105.AL2 — once the tenant is moved, no action reads an audience from KV`).toEqual({ afterPublish: [], afterPin: [], afterPrune: [] });
    }, 120_000);

    it(`host (${host}): through ANOTHER isolate's operator door (other binding objects over the same storage), with no clock moved, an audience published qualifies her on this isolate's next action, a rename and a pin are read renamed and pinned by this isolate's next action, and a prune stops it qualifying on the next action, with no audience read from KV`, async () => {
      const w = await world(host);
      expect((await publishThrough(w, authored(VIP, 'al2_vip'))).status, `PRECONDITION (${host}): the tenant's first audience is published`).toBe(200);
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her view is accepted`).toBe(200);
      await settle(w.m, w.app);
      expect((await listedThrough(w)).map(d => d.key), `PRECONDITION (${host}): this isolate has read the published list`).toEqual(['al2_vip']);

      const other = elsewhere(w), luxe = authored(LUXE, 'al2_luxe');
      expect((await publishThrough(w, luxe, { app: other })).status, `PRECONDITION (${host}): another isolate publishes ${luxe.key}`).toBe(200);
      const afterPublish = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(segmentsOf(afterPublish.body) ?? [], `${host}: P105.AL2 — this isolate's next action qualifies her for ${luxe.key}, published by another isolate, with no clock moved`).toContain(luxe.key);

      for (const [action, body, field, value] of [['rename', { name: 'Luxe browsers (renamed elsewhere)' }, 'name', 'Luxe browsers (renamed elsewhere)'], ['pin', { pinned: true }, 'pinned', true]] as const) {
        expect((await verb(w, luxe.key, action, body, { app: other })).status, `PRECONDITION (${host}): another isolate's operator ${action}s it`).toBe(200);
        const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0), member = audiencesMember(w.m);
        const carried = member?.audiences.find(a => a.key === luxe.key) as Record<string, unknown> | undefined;
        expect({ readsTheChangedMember: next.reads.includes(`STORAGE.get config-publication/v1/${TENANT}/audiences/rev/${member?.revision}.json`), [field]: carried?.[field], kv: next.kv },
          `${host}: P105.AL2 — this isolate's next action reads the audiences as ${action === 'rename' ? 'renamed' : 'pinned'} elsewhere: it reads the member's revision that carries the change, from no KV (${next.reads.join(', ')})`)
          .toEqual({ readsTheChangedMember: true, [field]: value, kv: [] });
      }

      expect((await verb(w, luxe.key, 'prune', {}, { app: other })).status, `PRECONDITION (${host}): another isolate prunes it`).toBe(200);
      const afterPrune = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(stillQualifies(afterPrune, luxe.key), `${host}: P105.AL2 — this isolate's next action stops qualifying her for ${luxe.key}, pruned by another isolate: her answer names her segments, without it (${JSON.stringify(segmentsOf(afterPrune.body))})`)
        .toEqual({ segmentsNamed: true, qualifies: false });
      expect({ afterPublish: afterPublish.kv, afterPrune: afterPrune.kv }, `${host}: P105.AL2 — and no action read an audience from KV`).toEqual({ afterPublish: [], afterPrune: [] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P105.AL3 — the writes, the bound, the unreadable publication.
// ===========================================================================

describe('unit:P105.AL3', () => {
  it('host (worker): each of publish, rename, pin, prune and seed is ONE set publication of the audiences member (the set revision moves by exactly one, the member says the change), the KV record written after the commit, a pruned key still resolvable', async () => {
    const w = await world('session');
    const one = authored(LUXE, 'al3_one'), two = authored(VIP, 'al3_two');
    const step = async (label: string, run: () => Promise<unknown>) => {
      const before = setRevision(w.m), from = w.trace.length;
      await run();
      const calls = w.trace.slice(from);
      return { label, moved: setRevision(w.m) - before, member: audiencesMember(w.m), calls };
    };
    const published = await step('publish', () => publishThrough(w, one));
    const renamed = await step('rename', () => verb(w, one.key, 'rename', { name: 'Renamed luxe' }));
    const pinned = await step('pin', () => verb(w, one.key, 'pin', { pinned: true }));
    const second = await step('publish', () => publishThrough(w, two));
    const pruned = await step('prune', () => verb(w, one.key, 'prune'));
    const seeded = await step('seed', () => new KvAudienceStore(w.m.env, TENANT as TenantId).seed([atScale(1), atScale(6)]));
    expect([published, renamed, pinned, second, pruned, seeded].map(s => [s.label, s.moved]),
      'P105.AL3 — each write moves the tenant\'s set by exactly one publication').toEqual([['publish', 1], ['rename', 1], ['pin', 1], ['publish', 1], ['prune', 1], ['seed', 1]]);
    expect(keysOf(published.member?.audiences), 'P105.AL3 — the publish: the member holds it').toEqual([one.key]);
    expect(renamed.member?.audiences.find(a => a.key === one.key)?.name, 'P105.AL3 — the rename: the member names it renamed').toBe('Renamed luxe');
    expect(pinned.member?.audiences.find(a => a.key === one.key)?.pinned, 'P105.AL3 — the pin: the member holds it pinned').toBe(true);
    expect(keysOf(pruned.member?.audiences), 'P105.AL3 — the prune: the member no longer holds it').toEqual([two.key]);
    expect(keysOf(seeded.member?.audiences), 'P105.AL3 — the seed: the member holds both seeded in the same publication').toEqual(keysOf([two, atScale(1), atScale(6)]));
    expect((seeded.member?.audiences ?? []).every(a => a.status === 'published'), 'P105.AL3 — every member entry is published').toBe(true);
    const commitAt = second.calls.reduce((last, c, i) => c.binding === 'STORAGE' && c.method === 'put' && c.key.endsWith('/head.json') ? i : last, -1);
    const recordAt = second.calls.findIndex(c => c.binding === 'CACHE' && c.method === 'put' && c.key === `audience:${two.key}`);
    expect({ committed: commitAt >= 0, recordAfterCommit: recordAt > commitAt }, 'P105.AL3 — the per-audience KV record is written after the head commit').toEqual({ committed: true, recordAfterCommit: true });
    const again = await verb(w, one.key, 'prune');
    expect([again.status, (again.body.audience as AudienceDef | undefined)?.status], 'P105.AL3 — a pruned key stays resolvable (operator.ts:484-488): pruning it again answers it archived').toEqual([200, 'archived']);
  }, 120_000);

  it('host (worker): two operator writes started together through two isolates (each its own store over its own bindings) both survive: the member holds both and both qualify her on the next action', async () => {
    const w = await world('session');
    await movedEmpty(w);
    const s = await shopperOn(w.m);
    expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, 'PRECONDITION: her view is accepted').toBe(200);
    await settle(w.m, w.app);
    const a = authored(LUXE, 'al3_together_a'), b = authored(LUXE, 'al3_together_b'), other = elsewhere(w);
    w.latency.set(20);
    const [first, second] = await Promise.all([publishThrough(w, a), publishThrough(w, b, { app: other })]);
    w.latency.set(0);
    expect({ statuses: [first.status, second.status], overlapped: first.sentAt < second.answeredAt && second.sentAt < first.answeredAt },
      'PRECONDITION: both writes were in flight together and both were answered').toEqual({ statuses: [200, 200], overlapped: true });
    expect(keysOf(audiencesMember(w.m)?.audiences), 'P105.AL3 — neither write is lost: the member holds both').toEqual([a.key, b.key]);
    const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
    expect(segmentsOf(next.body) ?? [], 'P105.AL3 — and both qualify her on the next action').toEqual(expect.arrayContaining([a.key, b.key]));
  }, 120_000);

  for (const host of HOSTS) {
    it(`host (${host}): the demo's first action on the default tenant (demo profile) seeds Coach's launch audiences and regenerates the catalogue audiences as one set publication per pass — the set moves by at most two, the member holds every launch audience and the regenerated catalogue audiences, and the action answers`, async () => {
      const w = await world(host, { demo: true });
      const before = setRevision(w.m);
      const s = await shopperOn(w.m);
      const first = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(first.status, `PRECONDITION (${host}): the demo's first action answers`).toBe(200);
      const member = audiencesMember(w.m), moved = setRevision(w.m) - before;
      expect({ seededAndRegenerated: moved >= 1, onePerPass: moved <= 2 },
        `${host}: P105.AL3 — the demo's seeding and regeneration are one publication per pass (the set moved by ${moved})`).toEqual({ seededAndRegenerated: true, onePerPass: true });
      expect(keysOf(member?.audiences), `${host}: P105.AL3 — the member holds every Coach launch audience`).toEqual(expect.arrayContaining(keysOf(SEED_AUDIENCES)));
      expect((member?.audiences ?? []).filter(a => a.source === 'catalog').length, `${host}: P105.AL3 — and the regenerated catalogue audiences`).toBeGreaterThan(0);
    }, 120_000);
  }

  it('logic: regenerateCatalogAudiences (src/reflex/audienceGenerator.ts) over Coach\'s catalogue is ONE publication per pass — the first pass publishing every generated audience, a pass whose catalogue lost a dimension archiving those audiences, an unchanged pass at most one', async () => {
    const w = await world('session');
    await movedEmpty(w);
    const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
    const products = (catalog as unknown as { products: Array<Record<string, unknown>> }).products;
    const generated = generateAffinityAudiences(products, REFLEX_DOCUMENT as unknown as ReflexConfig);
    expect(generated.length, 'PRECONDITION: Coach\'s catalogue generates its affinity audiences').toBeGreaterThan(5);
    const pass = async (defs: AudienceDef[]) => { const before = setRevision(w.m); await regenerateCatalogAudiences(store, defs); return setRevision(w.m) - before; };
    const firstPass = await pass(generated);
    const kept = generated.filter(d => !/^line_/.test(d.key)), dropped = generated.filter(d => /^line_/.test(d.key));
    expect(dropped.length, 'PRECONDITION: the catalogue\'s line dimension generates audiences').toBeGreaterThan(0);
    const narrowed = await pass(kept);
    const unchanged = await pass(kept);
    expect({ firstPass, narrowed, unchangedAtMostOne: unchanged <= 1 }, 'P105.AL3 — each regeneration pass is one publication').toEqual({ firstPass: 1, narrowed: 1, unchangedAtMostOne: true });
    expect(keysOf(audiencesMember(w.m)?.audiences), 'P105.AL3 — the member holds exactly the audiences the last pass keeps').toEqual(keysOf(kept));
  }, 120_000);

  it('logic: an audiences member past 2 MiB (PUBLICATION_MAX_BYTES) is refused by the store 413 document_too_large naming the audiences member, and nothing changes (the set, the member, the KV record)', async () => {
    const w = await world('session');
    const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
    const sample = Array.from({ length: 100 }, (_, i) => atScale(i)), perAudience = documentBytes({ version: 1, audiences: sample }) / sample.length;
    const fit = Math.floor((PUBLICATION_MAX_BYTES - 96 * 1024) / perAudience), defs = Array.from({ length: fit }, (_, i) => atScale(i));
    await store.seed(defs);
    const before = { revision: setRevision(w.m), members: audiencesMember(w.m)?.audiences.length };
    const over = { ...authored(LUXE, 'al3_over'), description: 'x'.repeat(160 * 1024) };
    const refused = await store.publish(over).then(() => null, (error: unknown) => error as { status?: number; code?: string; message?: string });
    expect({ status: refused?.status, code: refused?.code, namesTheMember: /audiences/.test(refused?.message ?? '') },
      `P105.AL3 — with ${fit} Coach-launch-shaped audiences published (${documentBytes({ version: 1, audiences: defs })} B), the store refuses the write that takes the member past 2 MiB, 413 document_too_large naming the audiences member (${refused?.message ?? 'it was accepted'})`)
      .toEqual({ status: 413, code: 'document_too_large', namesTheMember: true });
    expect({ fitWasTheMember: before.members === fit, revision: setRevision(w.m), members: audiencesMember(w.m)?.audiences.length, record: w.m.cache.data.has(`audience:${over.key}`) },
      `P105.AL3 — nothing changed: the set, the member (${before.members} before) and the KV record`).toEqual({ fitWasTheMember: true, revision: before.revision, members: fit, record: false });
  }, 300_000);

  it('host (worker): the same write through the operator door is not published and nothing changes, the answer naming the refusal (R4: the door answers every non-validation failure 500 today)', async () => {
    const w = await world('session');
    const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
    const sample = Array.from({ length: 100 }, (_, i) => atScale(i)), perAudience = documentBytes({ version: 1, audiences: sample }) / sample.length;
    const fit = Math.floor((PUBLICATION_MAX_BYTES - 96 * 1024) / perAudience);
    await store.seed(Array.from({ length: fit }, (_, i) => atScale(i)));
    const revision = setRevision(w.m);
    const over = { ...authored(LUXE, 'al3_over'), description: 'x'.repeat(160 * 1024) };
    const answer = await publishThrough(w, over);
    expect({ published: answer.status === 200, namesTheRefusal: /audiences/.test(JSON.stringify(answer.body)) && /2 MiB/.test(JSON.stringify(answer.body)) },
      `P105.AL3 — the door does not publish it and its answer names the audiences member and the 2 MiB bound (${answer.status} ${JSON.stringify(answer.body).slice(0, 300)})`).toEqual({ published: false, namesTheRefusal: true });
    expect({ revision: setRevision(w.m), listed: (await listedThrough(w)).some(d => d.key === over.key), record: w.m.cache.data.has(`audience:${over.key}`) },
      'P105.AL3 — and nothing changed').toEqual({ revision, listed: false, record: false });
  }, 300_000);

  for (const host of HOSTS) {
    it(`host (${host}): a publication whose audiences member cannot be read fails qualification as an unreadable reflex document does (${host === 'session' ? 'the session host\'s action fails exactly as the action whose reflex document cannot be read' : 'the object host degrades to reflex-only: answered, no audience segment'}) and never falls back — not to KV, not to the list it held`, async () => {
      const w = await world(host);
      expect((await publishThrough(w, authored(LUXE, 'al3_luxe'))).status, `PRECONDITION (${host}): the operator publishes an audience she meets`).toBe(200);
      expect(audiencesMember(w.m)?.audiences.map(a => a.key), `PRECONDITION (${host}): the publish made the tenant's audiences member (P105.AL3's write)`).toEqual(['al3_luxe']);
      const s = await shopperOn(w.m);
      const first = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(segmentsOf(first.body) ?? [], `PRECONDITION (${host}): she qualifies for al3_luxe`).toContain('al3_luxe');

      // CONTROL: the action whose reflex document cannot be read (a new isolate, the reflex revision read failing).
      newIsolate(w);
      let restore = failReads(w, '/reflex/rev/');
      const reflexUnreadable = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      restore();
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): with the reflex document readable again her action answers`).toBe(200);
      await settle(w.m, w.app);

      // Another isolate publishes; this isolate cannot read the member's new revision.
      expect((await publishThrough(w, authored(LUXE, 'al3_luxe_two'), { app: elsewhere(w) })).status, `PRECONDITION (${host}): another isolate publishes a second audience she meets`).toBe(200);
      restore = failReads(w, '/audiences/rev/');
      const unreadable = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      restore();
      if (host === 'session') {
        expect({ status: unreadable.status, error: unreadable.body.error },
          `session: P105.AL3 — the action fails as the action whose reflex document cannot be read fails (${reflexUnreadable.status} ${String(reflexUnreadable.body.error)}); got ${unreadable.status} ${JSON.stringify(unreadable.body).slice(0, 200)}`)
          .toEqual({ status: reflexUnreadable.status, error: reflexUnreadable.body.error });
        expect(reflexUnreadable.status, 'session: CONTROL — the action whose reflex document cannot be read is refused').toBeGreaterThanOrEqual(500);
      } else {
        expect({ status: unreadable.status, audienceSegments: (segmentsOf(unreadable.body) ?? ['no segments named']).filter(k => k.startsWith('al3_')) },
          `do: P105.AL3 — the object host degrades to reflex-only: the action answers and qualifies her for no audience (ShopperReflex.ts:1612-1616); got ${unreadable.status} ${JSON.stringify(segmentsOf(unreadable.body))}`)
          .toEqual({ status: 200, audienceSegments: [] });
      }
      expect(unreadable.kv, `${host}: P105.AL3 — and never falls back to KV`).toEqual([]);
    }, 120_000);
  }
});

/** Every R2 read whose key contains `pattern` fails (an unreadable object) until the returned function restores the binding. */
function failReads(w: World, pattern: string): () => void {
  const target = w.m.storage as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, current = target.get!;
  Object.defineProperty(target, 'get', { configurable: true, writable: true, value: (key: unknown, ...rest: unknown[]) =>
    typeof key === 'string' && key.includes(pattern) ? Promise.reject(new Error('P105 lever: this publication object cannot be read')) : current.call(target, key, ...rest) });
  return () => { Object.defineProperty(target, 'get', { configurable: true, writable: true, value: current }); };
}

// ===========================================================================
// unit:P105.AL4 — the move.
// ===========================================================================

/** The legacy state of an unmoved tenant with 1,005 records: 995 published she never meets, 5 archived, and 5 published she meets, sorting after the first page. */
function legacyThousand(m: Mounted, tenant: string = TENANT): { published: AudienceDef[]; met: string[] } {
  const published: AudienceDef[] = [];
  for (let i = 0; i < 995; i++) published.push({ ...authored(VIP, `a${String(i).padStart(5, '0')}_${VIP}`) });
  const archived = Array.from({ length: 5 }, (_, i) => ({ ...authored(LUXE, `m${i}_archived_${LUXE}`), status: 'archived' as const }));
  const met = Array.from({ length: 5 }, (_, i) => authored(LUXE, `z${i}_${LUXE}`));
  for (const def of [...published, ...archived, ...met]) legacyRecord(m, tenant, def);
  return { published: [...published, ...met], met: met.map(d => d.key) };
}

/** KV audience calls, each held 2 ms, counted in waves (a wave starts when none is in flight) with the most in flight at once. */
function kvWaves(m: Mounted) {
  const log: Array<{ method: string }> = [];
  let inFlight = 0, waves = 0, maxGets = 0, getsInFlight = 0;
  for (const method of ['get', 'list'] as const) {
    const current = (m.cache as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]!;
    Object.defineProperty(m.cache, method, { configurable: true, writable: true, value: async (...args: unknown[]) => {
      const first = args[0], key = typeof first === 'string' ? first : JSON.stringify(first ?? null);
      if (!key.includes('audience:')) return current.apply(m.cache, args);
      if (inFlight === 0) waves++;
      inFlight++; if (method === 'get') { getsInFlight++; maxGets = Math.max(maxGets, getsInFlight); }
      log.push({ method });
      try { await new Promise(resolve => setTimeout(resolve, 2)); return await current.apply(m.cache, args); }
      finally { inFlight--; if (method === 'get') getsInFlight--; }
    } });
  }
  return { reset: () => { log.length = 0; waves = 0; maxGets = 0; },
    read: () => ({ lists: log.filter(c => c.method === 'list').length, gets: log.filter(c => c.method === 'get').length, waves, maxGetsInFlight: maxGets }) };
}

describe('unit:P105.AL4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an unmoved tenant (its set has no audiences member) with 1,005 KV records is read with every page of the list followed and every get issued at once (the list's two pages, then one wave of gets), 1,005 keys answering all 1,000 published; its first audience write creates the member from those records in the same publication, after which no action reads an audience from KV`, async () => {
      const w = await world(host);
      const legacy = legacyThousand(w.m);
      expect(audiencesMember(w.m), `PRECONDITION (${host}): the tenant's set has no audiences member`).toBeNull();
      const waves = kvWaves(w.m);
      const s = await shopperOn(w.m);
      waves.reset();
      const first = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), 60_000, 0);
      const shape = waves.read();
      expect({ lists: shape.lists, waves: shape.waves, everyGetAtOnce: shape.gets > 0 && shape.maxGetsInFlight === shape.gets },
        `${host}: P105.AL4 — the unmoved read follows every page and issues every get at once (${JSON.stringify(shape)})`).toEqual({ lists: 2, waves: 3, everyGetAtOnce: true });
      expect(segmentsOf(first.body) ?? [], `${host}: P105.AL4 — the published audiences on the list's second page qualify her`).toEqual(expect.arrayContaining(legacy.met));
      expect((await listedThrough(w)).length, `${host}: P105.AL4 — 1,005 keys answer all 1,000 published`).toBe(1000);

      const before = setRevision(w.m), added = authored(LUXE, 'zz_first_write');
      expect((await publishThrough(w, added)).status, `PRECONDITION (${host}): the operator publishes the tenant's first audience since the records`).toBe(200);
      expect({ publications: setRevision(w.m) - before, member: keysOf(audiencesMember(w.m)?.audiences) },
        `${host}: P105.AL4 — the first write creates the member from the records and itself, in one publication`).toEqual({ publications: 1, member: keysOf([...legacy.published, added]) });
      const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(segmentsOf(next.body) ?? [], `${host}: P105.AL4 — the next action qualifies her for the new audience`).toContain(added.key);
      expect(next.kv, `${host}: P105.AL4 — and reads no audience from KV`).toEqual([]);
    }, 300_000);
  }

  it('host (session): the five-minute scheduled run (src/index.ts scheduled, cron */5, customer profile) creates the member for EVERY provisioned tenant from its KV records — every page, a tenant with none included — with no operator, one publication each, each tenant\'s own; after it no action reads an audience from KV', async () => {
    const w = await world('session', { tenants: [OTHER, EMPTY] });
    const coach = legacyThousand(w.m);
    const acme = [authored(LUXE, 'acme_luxe'), authored(VIP, 'acme_vip')];
    for (const def of acme) legacyRecord(w.m, OTHER, def);
    legacyRecord(w.m, OTHER, { ...authored(LUXE, 'acme_archived'), status: 'archived' });
    const before = { coach: setRevision(w.m), acme: setRevision(w.m, OTHER), globex: setRevision(w.m, EMPTY) };
    await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
    expect({ coach: setRevision(w.m) - before.coach, acme: setRevision(w.m, OTHER) - before.acme, globex: setRevision(w.m, EMPTY) - before.globex },
      'P105.AL4 — the run publishes once for each provisioned tenant').toEqual({ coach: 1, acme: 1, globex: 1 });
    expect({ coach: keysOf(audiencesMember(w.m)?.audiences), acme: keysOf(audiencesMember(w.m, OTHER)?.audiences), globex: audiencesMember(w.m, EMPTY)?.audiences ?? 'no member' },
      'P105.AL4 — each member is exactly that tenant\'s published records, every page of the list read; a tenant with none holds an empty member, so its request path lists no KV either')
      .toEqual({ coach: keysOf(coach.published), acme: keysOf(acme), globex: [] });
    const s = await shopperOn(w.m);
    const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
    expect(segmentsOf(next.body) ?? [], 'P105.AL4 — a moved tenant\'s audiences qualify her').toEqual(expect.arrayContaining(coach.met));
    expect(next.kv, 'P105.AL4 — and the action reads no audience from KV').toEqual([]);
  }, 300_000);

  it('host (do): the five-minute scheduled run on the demo profile moves the default tenant too; after it the request path lists no audience in KV', async () => {
    const w = await world('do', { demo: true });
    const coach = legacyThousand(w.m);
    const before = setRevision(w.m);
    await fiveMinuteRun(w, {});
    expect({ publications: setRevision(w.m) - before, member: keysOf(audiencesMember(w.m)?.audiences) },
      'P105.AL4 — the run on the demo profile creates the default tenant\'s member from its records, every page').toEqual({ publications: 1, member: keysOf(coach.published) });
    const s = await shopperOn(w.m);
    const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
    expect(next.status, 'PRECONDITION: the demo action answers').toBe(200);
    expect(next.kv.filter(call => call.startsWith('CACHE.list')), 'P105.AL4 — the request path lists no audience in KV').toEqual([]);
  }, 300_000);
});

/** The worker's own scheduled handler (src/index.ts), cron every five minutes, in process, over the mounted bindings; every job awaited. */
async function fiveMinuteRun(w: World, extra: Record<string, unknown>): Promise<void> {
  const worker = (await import('@/index')).default as unknown as { scheduled: (event: unknown, env: Env, ctx: ExecutionContext) => Promise<void> };
  const jobs: Promise<unknown>[] = [];
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now(), noRetry() { /* never */ } }, { ...w.m.env, ...extra } as Env,
    { waitUntil: (p: Promise<unknown>) => { jobs.push(Promise.resolve(p)); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  await Promise.allSettled(jobs);
  await settle(w.m, w.app);
  invalidatePublicationCache();
}

// ===========================================================================
// unit:P105.AL5 — LOCK: the tenant boundary, the demo surfaces, the same segments, kit 02.
// ===========================================================================

describe('unit:P105.AL5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a tenant qualifies only its own audiences: coach's shopper qualifies coach's audience and never ${OTHER}'s identical one, and each tenant's operator read lists only its own`, async () => {
      const w = await world(host, { tenants: [OTHER] });
      expect((await publishThrough(w, authored(LUXE, 'coach_luxe'))).status, `PRECONDITION (${host}): coach's operator publishes`).toBe(200);
      expect((await publishThrough(w, authored(LUXE, 'acme_luxe'), { tenant: OTHER })).status, `PRECONDITION (${host}): ${OTHER}'s operator publishes`).toBe(200);
      const s = await shopperOn(w.m);
      const first = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect({ coach: stillQualifies(first, 'coach_luxe'), acme: stillQualifies(first, 'acme_luxe').qualifies },
        `${host}: P105.AL5 — coach's shopper qualifies coach's audience and never ${OTHER}'s (${JSON.stringify(segmentsOf(first.body))})`).toEqual({ coach: { segmentsNamed: true, qualifies: true }, acme: false });
      expect({ coach: keysOf(await listedThrough(w)), acme: keysOf(await listedThrough(w, { tenant: OTHER })) },
        `${host}: P105.AL5 — each tenant's operator read lists its own`).toEqual({ coach: ['coach_luxe'], acme: ['acme_luxe'] });
    }, 120_000);
  }

  it('logic: LOCK — the default tenant\'s demo surfaces evaluate only their own audiences (SegmentProvider.ts:43-48): a brighthour context qualifies only the brighthour audience, a coach context only the untagged one, a context naming no surface both', async () => {
    const w = await world('session', { demo: true });
    const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
    const coach = authored(LUXE, 'surface_luxe'), brighthour = { ...authored(LUXE, 'bh_surface_luxe'), surface: 'brighthour' };
    await store.publish(coach); await store.publish(brighthour);
    const provider = new MockSegmentProvider(store);
    const ctx = (surface?: string) => ({ userId: 'p105-visitor', attributes: { price_band_viewed: 'elevated' }, segments: [], ...(surface ? { surface } : {}) });
    expect({ brighthour: (await provider.fetchQualifiedSegments('p105-visitor', ctx('brighthour'))).sort(), coach: (await provider.fetchQualifiedSegments('p105-visitor', ctx('coach'))).sort(),
      none: (await provider.fetchQualifiedSegments('p105-visitor', ctx())).sort() }, 'P105.AL5 — each surface evaluates its own audiences')
      .toEqual({ brighthour: ['bh_surface_luxe'], coach: ['surface_luxe'], none: ['bh_surface_luxe', 'surface_luxe'] });
  }, 120_000);

  it('logic: LOCK — qualification answers the same segments as today on the same audiences and contexts: Coach\'s ten launch audiences, published, against a Tabby browser, a Brooklyn cart abandoner, a gifting loyal customer (cross-category), unknown attributes only, and every threshold missed by one', async () => {
    const w = await world('session');
    for (const def of SEED_AUDIENCES) expect((await publishThrough(w, authored(def.key, def.key, def.name))).status, `PRECONDITION: ${def.key} published`).toBe(200);
    const provider = new MockSegmentProvider(new KvAudienceStore(w.m.env, TENANT as TenantId));
    const qualify = async (attributes: Record<string, unknown>) => (await provider.fetchQualifiedSegments('p105-visitor', { userId: 'p105-visitor', attributes, segments: [] })).sort();
    expect({
      tabby: await qualify({ viewed_product_line: 'Tabby', product_views: 3, cart_adds: 0, purchases: 0, journey_stage: 'early', price_band_viewed: 'elevated' }),
      brooklynAbandoner: await qualify({ viewed_product_line: 'Brooklyn', product_views: 5, cart_adds: 1, purchases: 0, cart_abandoned: true, journey_stage: 'mid' }),
      giftingLoyal: await qualify({ gifter: true, average_order_value_usd: 650, loyalty_tier: 'gold', engagement_rank: 'vip', churn_risk_score: 0.7, product_views: 1, purchases: 2, journey_stage: 'late' }),
      unknownOnly: await qualify({ styleWorld: 'downtown', season: 'resort' }),
      missedByOne: await qualify({ loyalty_tier: 'silver', engagement_rank: 'vip', gifter: true, average_order_value_usd: 299, churn_risk_score: 0.59, product_views: 10, viewed_product_line: 'Brooklyn', cart_adds: 0, journey_stage: 'late' }),
    }, 'P105.AL5 — the segments each context qualifies for, derived from the ten conditions (src/data/insights.json)').toEqual({
      tabby: ['early_journey_cold_start', 'high_intent_tabby_browser', 'luxe_affinity'],
      brooklynAbandoner: ['brooklyn_browser', 'cart_abandoner', 'late_journey_ready_to_buy', 'mid_journey_considering'],
      giftingLoyal: ['high_aov_gifter', 'lapsed_reengagement', 'luxe_affinity', 'vip_loyalist'],
      unknownOnly: [],
      missedByOne: ['brooklyn_browser'],
    });
  }, 120_000);

  it('host (worker): LOCK — kit 02\'s kind list stays true (docs/kit/02-api-reference.md §4): the audiences member is not a /content/{kind}; GET /content/audiences is refused 404 in the kit\'s words', async () => {
    const w = await world('session');
    expect((await publishThrough(w, authored(LUXE, 'kit_luxe'))).status, 'PRECONDITION: an audience is published').toBe(200);
    const read = await operator(w, 'GET', `/content/audiences?scope=${TENANT}`);
    expect([read.status, read.body.error], 'P105.AL5 — kit 02: "Any other kind is refused 404"').toEqual([404, 'kind must be catalog, slots, learn, priors, vocabulary, import-sources or layouts']);
  }, 60_000);
});

// ===========================================================================
// unit:P105.AL6 — P61.LO3's R-P115 leg with the old ten-second line crossed between its rounds.
// ===========================================================================

/** The delivery reviewer's deciding control (S41/reviewer-p97/REPORT-p61-lo3.md; DESIGN.md §6): 10.5 s of real time. */
const CROSSING_MS = 10_500;

/**
 * P61.LO3's R-P115 leg (src/units/P61/LEDGER.unit.test.ts, `countLatency` and its leg at
 * :454-464), copied as the control copied it (S52 scratch/tools/p61ctl.cjs): the
 * customer profile, every remote call 500 ms late, the count's own store calls
 * (`learningReadsKey(tenant)`) optionally free; each round a new shopper's Tabby view,
 * the lift cache dropped, the product-page snapshot and the pooled module's render
 * acknowledgement right after its answer. The one change: `crossingMs` of real time
 * between the counted round's view and its snapshot.
 */
async function countLatency(m: Mounted, crossingMs: number) {
  const { SHOPPER_HEADER: header } = await import('@/identity/sessionCapability');
  const keyOf = (await fanExports()).learningReadsKey as ((tenant: string) => string) | undefined;
  const countKey = typeof keyOf === 'function' ? keyOf(TENANT) : null;
  (m.env as unknown as Record<string, unknown>).DEPLOYMENT_PROFILE = 'customer';
  const latency = remoteLatency(m), app = appOf(m.env), counted = new Set<number>();
  let free = false, countCallsMade = 0;
  for (const method of ['get', 'put'] as const) {
    const store = m.cache as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const levered = store[method]!, unlevered = Object.getPrototypeOf(m.cache)[method] as (...args: unknown[]) => Promise<unknown>;
    Object.defineProperty(m.cache, method, { configurable: true, writable: true, value: (...args: unknown[]) => {
      if (countKey === null || args[0] !== countKey) return levered.apply(m.cache, args);
      countCallsMade++;
      if (free) return unlevered.apply(m.cache, args);
      counted.add(latency.calls.length);
      return levered.apply(m.cache, args);
    } });
  }
  const own = (from: number, until: number) => latency.calls.filter((call, index) => index >= from && call.at <= until && !counted.has(index)).length;
  return async (countFree: boolean) => {
    free = countFree;
    const callsBefore = countCallsMade;
    const shopper = await shopperOn(m);
    expect((await shopper.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
    if (!countFree) await new Promise(resolve => setTimeout(resolve, crossingMs));
    invalidateLiftCache();
    const pageInstance = pageInstanceOf('p105-al6-latency'), first = latency.calls.length;
    latency.set(PER_CALL_MS);
    const sentAt = performance.now();
    const response = await app.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
      headers: { 'X-Tenant': TENANT, [header]: shopper.grant.capability, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance }) }));
    const answeredAt = performance.now();
    const body = await response.json() as Record<string, unknown>;
    const page: Snapshot = { status: response.status, body, page: 'pdp', pageInstance, decisions: (body.decisions ?? []) as Decision[] };
    const pooled = page.decisions.find(d => d.contentId === POOLED && d.renderOffer);
    const ackFirst = latency.calls.length;
    const ack = pooled ? await ackWire(app, shopper, page, pooled) : null;
    latency.set(0);
    await settle(m, app);
    expect([response.status, ack?.status], `${m.host}: PRECONDITION — the snapshot and the pooled module's acknowledgement answer 200`).toEqual([200, 200]);
    return { snapshot: { ms: Math.round(answeredAt - sentAt), own: own(first, answeredAt) },
      ack: { ms: Math.round(ack!.answeredAt - ack!.sentAt), own: own(ackFirst, ack!.answeredAt) }, countCalls: countCallsMade - callsBefore };
  };
}

describe('unit:P105.AL6', () => {
  for (const host of HOSTS) {
    it(`host (${host}): P61.LO3's R-P115 leg passes with ${CROSSING_MS / 1000} s of real time between the counted round's view and its snapshot (the old ten-second line crossed): the counted snapshot and the render acknowledgement right after it make the same own remote calls as the free round's, each within ${MARGIN_MS} ms of its time`, async () => {
      const { m } = await liftWorld(host);
      const run = await countLatency(m, CROSSING_MS);
      const free = await run(true), counted = await run(false);
      expect({ free: free.countCalls > 0, counted: counted.countCalls > 0 }, `${host}: PRECONDITION — the count ran after both snapshots (its store calls: ${free.countCalls} free, ${counted.countCalls} at ${PER_CALL_MS} ms)`).toEqual({ free: true, counted: true });
      expect({ snapshot: counted.snapshot.own, ack: counted.ack.own }, `${host}: P105.AL6 — with the old ten-second line crossed, each answer makes the same own remote calls as the free round's (P61.LO3, R-P115)`)
        .toEqual({ snapshot: free.snapshot.own, ack: free.ack.own });
      expect({ snapshot: counted.snapshot.ms <= free.snapshot.ms + MARGIN_MS, ack: counted.ack.ms <= free.ack.ms + MARGIN_MS },
        `${host}: P105.AL6 — the snapshot answers in ${counted.snapshot.ms} ms (${free.snapshot.ms} ms free) and the acknowledgement right after it in ${counted.ack.ms} ms (${free.ack.ms} ms), each within ${MARGIN_MS} ms`)
        .toEqual({ snapshot: true, ack: true });
    }, 240_000);
  }
});
