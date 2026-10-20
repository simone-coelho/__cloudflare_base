// src/units/P66/LEDGER.unit.test.ts
// P66 under the Closure Ledger: the tests for the LOCAL criteria TC1-TC3 of the P66 work
// order (the outcome-telling programme of amendment 7, ticket P66 "The account-change and
// absorb merges' refusals cross the object boundary typed"). LV1 is a deferred live row and
// gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-7/BTI-Parity-Amendment-2026-10-20.md, section 2, P66):
//   "P66 — every merge refusal crosses typed. On both hosts and natively (workerd), a
//   validation refusal raised in the account object during the account-change merge or the
//   absorb merge reaches the shopper as the route's own `400 Validation error` with the same
//   issues, never an untyped 500, through the same typed shape P58 introduced
//   (`validationRefusal` / `validationRefusalOf`, `link.ts`'s typed read); no message string
//   is parsed; the oversized link merge's behaviour (P58) unchanged."
// Section 3: "Each ticket: RED units on both hosts in `src/units/P6x/LEDGER.unit.test.ts` (P66
// with native legs through `src/units/_native.ts` as P58's BA4), reviewed honest; …"
// The work order's remaining work (docs/parity/outcome-telling/program.json, P66): "Type the
// refusal at handleAccountChange / handleAbsorb as P58 did at the transfer door;
// applyAccountChange and the absorb caller in link.ts read the typed answer."
// The evidence it cites: the P58 delivery review, finding 2
// (_evidence/parity-step3/P58/reviewer/REPORT.md): "`handleAccountChange` calls
// `mergedIdentity` … without the typed catch, and `link.ts` … (`applyAccountChange`) has no
// typed read. The absorb merge … (`handleAbsorb`) is untyped too."
//
// One `describe('unit:P66.<criterion>')` per LOCAL criterion, both shopper hosts, in process
// (the parity harness) and natively (workerd through src/units/_native.ts, P58.BA4's lever).
// Expected values come from the work order, the amendment, P58's typed shape and the engine's
// own validation, never from what the engine answers today:
//   · the refusal: the merged profile's own validation (src/identity/profileEnrichment.ts
//     `profileEnrichmentSchema`: "at most8 sources"), raised by `mergedIdentity`
//     (src/durable-objects/ShopperReflex.ts) when the two profiles it folds carry more than
//     eight enrichment sources between them, as P58.BA4's oversized link merge raises it;
//   · the route's own answer to it: `400 { error: 'Validation error', details: issues }`
//     (src/middleware/error.ts, the shopper owner's app `onError`,
//     src/identity/sessionAuthority.ts `shopperRoutes`), as P58.BA4 reads it;
//   · the typed shape: `validationRefusal(issues)` (status 400, `{ ok: false, refusal:
//     'validation', issues }`) and its one reader `validationRefusalOf(status, body)`
//     (src/identity/sessionAuthority.ts), status 400 and the exact strict shape only;
//   · the account change: P12's decision D1 (src/identity/assertion.ts `signAccountChange`,
//     src/routes/identity.ts the link route's `accountChange`, src/identity/link.ts
//     `applyAccountChange`, ShopperReflex.ts `handleAccountChange`).
//
// THE READINGS THIS FILE RULES:
//   · TC1, the account-change merge: three browsers, each with an explicit choice; an earlier
//     account holding five enrichment sources (one browser with five operator profile rows and
//     a product view, linked to it), the person's account holding four (another such browser,
//     linked to it); a third browser signs in to the person's account carrying a statement the
//     site's backend signed over both identifiers. The link itself merges nothing oversized
//     (four sources); the account change then folds five into four, which the merged profile's
//     validation refuses inside the person's own object. The shopper's answer is the route's own
//     `400 Validation error` with that one issue ("at most8 sources"). MEASURED TODAY at
//     81713505 (_evidence/parity-step3/S15/specifier/logs/p66-draft2-run{1,2,3}.log): in process
//     that answer is already the route's own 400 on both hosts, because in one process the
//     validation error crosses the object call as the very exception it is; the in-process legs
//     are therefore LOCKS, green at specification. Natively (workerd) the error crosses the
//     Durable Object boundary as an untyped exception and the shopper is answered
//     `500 { error: 'Internal server error', message: 'ZodError: [ … at most8 sources … ]' }`
//     on both hosts: the native legs are RED.
//   · TC2, the absorb merge: NO ROUTE REACHES IT. At 81713505 the person's object's absorb door
//     (`/identity/absorb`, ShopperReflex.ts `handleAbsorb`) has no caller in the product
//     (src/, scripts/, public/ read: only tests call it); src/identity/link.ts merges on the
//     session host through `SessionManager.absorbIntoShopper`, in the worker's own process
//     over KV, where a validation error never crosses an object boundary. The work order's
//     "the absorb caller in link.ts" therefore names nothing, and "reaches the shopper" has no
//     route to travel. TC2 is pinned where the refusal crosses: the absorb door's own answer to
//     a caller holding the binding (in process, the mounted namespace; natively, a fixture door
//     of the wrapper, as P58's native wrapper adds its own). One browser holding four sources is
//     handed another browser's exported profile holding five (the operator's export door,
//     `/identity/operator-export`); the door answers the typed refusal: status 400 and the
//     exact shape `validationRefusalOf` reads, with the one issue "at most8 sources". RED today
//     in process (the door throws the validation error) and natively (it crosses untyped).
//     Proposed to the lead: restate TC2's observable at the door, or rule the route that should
//     reach it (the answer names it).
//   · TC3 LOCKS, green at specification:
//       `validationRefusalOf` reads a refusal only at status 400 in the exact strict shape
//       (any other status, a missing or extra member, a refusal of another kind: none);
//       the typed shape is produced only by the account object's doors: outside the tests,
//       `validationRefusal(` is called only in src/durable-objects/ShopperReflex.ts and
//       `validationRefusalOf(` only there and in src/identity/link.ts;
//       no message string is parsed: when the account-change door fails with an UNTYPED error
//       whose message is a validation error's own text ("ZodError: [ … at most8 sources … ]",
//       what crosses natively today), the shopper is answered as today for an untyped failure,
//       `500 { error: 'Internal server error' }`, never a 400 read out of that text;
//       no new remote call before the answer: with 20 ms added to every remote binding call
//       (src/units/_parity8.ts `remoteLatency`), an account-change link that merges within the
//       limit makes, per binding and method, no more remote calls before its answer than this
//       ticket's base (81713505, three runs per host, identical: the session host STORAGE.get 3,
//       SESSIONS.get 1, SESSIONS.put 9; the object host STORAGE.get 3, SESSIONS.put 3;
//       logs/p66-draft2-run{1,2,3}.log);
//       the oversized link merge (P58.BA4), P58's units and P65's reset answers (P65.RS2)
//       unchanged: their own acceptance commands, run beside this one (a unit file is never
//       imported into another).
//
// SKETCHES (scratch copies of 81713505, never committed; _evidence/parity-step3/S15/specifier/sketches/sketch-p66.py):
//   both (the conforming build: the account-change and absorb doors answer the merge's refusal typed,
//   P58's `MergeValidationRefusal` and `validationRefusal`; `applyAccountChange` reads it with
//   `validationRefusalOf` and raises the validation error it is): every P66 unit GREEN;
//   change-only (the absorb door left untyped): TC2 RED, in process and natively, both hosts;
//   any-status (`validationRefusalOf` without its status check): TC3's reader lock RED;
//   parse-message (doors untyped; `applyAccountChange` turns an error whose message reads
//   "ZodError: [ … ]" back into a validation error): TC3's no-message lock RED, both hosts.
//
// R10 (expectations a build of P66 changes): NONE MEASURED. The whole suite on a full scratch copy of
// 81713505 given a git index, unmodified and under the conforming sketch `both`: the same failing set
// apart from this file's own RED legs, W40.P4's deploy leg alone (the scratch's symlinked node_modules,
// lesson 2026-10-08), 3702 passed at the base and 3708 under the sketch (logs/suite-base.json,
// suite-both.json). The tests that call the absorb door directly (src/reflex/shopperReflex.identity.test.ts
// :266-329, src/routes/realtime.sdkContract.test.ts :1060, :2293, :2611-2614, :4234) merge within the
// limit or refuse other input, and stay green.
//
// No new export is imported; every member read exists at this head.
//
// FIXTURE. P58.BA4's documents (the registered modules, the declared layout slot and the
// recently-viewed slot, the learn document) and its operator profile rows
// (src/units/P58/LEDGER.unit.test.ts `oversizedMerge`: `POST /v1/:tenant/identity/events`
// `{ kind: 'profile', version: 1, source, visitorId, at, fields, audiences }`); the browsers'
// signed links through `POST /v1/:tenant/identity/link` (src/units/_parity3.ts `identityDoor`).
// Account identifiers are synthetic.
//
// HARNESS: src/units/_parity.ts, src/units/_parity3.ts, src/units/_parity8.ts (the latency
// lever) and src/units/_native.ts (workerd). Imports from src/units/: ../_parity, ../_parity3,
// ../_parity8, ../_native.

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { signAccountChange, signAssertion } from '@/identity/assertion';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { validationRefusal, validationRefusalOf } from '@/identity/sessionAuthority';
import { EMPTY_PRIORS } from '@/learn/priors';
import { RETENTION_CATEGORIES } from '@/retention';
import { identityRoutes } from '@/routes/identity';
import { tenantMiddleware } from '@/tenancy/middleware';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';

import {
  declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY, readTree, recentSlot, REFLEX_DOCUMENT,
  shopperOn, TENANT, VIEW_TABBY_26, type Host, type Mounted, type Shopper,
} from '../_parity';
import { identityDoor, identitySecretOf, type IdentityDoor } from '../_parity3';
import { remoteLatency } from '../_parity8';
import { bundleNativeWorker, nativeScratchDirectory, openNativeRuntime } from '../_native';

const DOCUMENTS = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);
/** Synthetic account identifiers: the earlier account and the person's. */
const EARLIER = 'p66-earlier-account', PERSON = 'p66-person-account';
/** The merged profile's own limit (src/identity/profileEnrichment.ts `profileEnrichmentSchema`): five and four sources fold into nine. */
const EARLIER_SOURCES = 5, PERSON_SOURCES = 4;
/** The route's own answer to the merged profile's refusal (P58.BA4's reading). */
const ROUTE_REFUSAL = [400, 'Validation error', ['at most8 sources']];
/** The typed refusal as its one reader reads it: status 400 and the issue's message. */
const TYPED_REFUSAL = [400, ['at most8 sources']];

type Answer = { status: number; body: Record<string, unknown> };
/** One operator profile row (P58.BA4's `row`, empty): it names a source the person's enrichment then holds. */
const row = (visitorId: string, source: string) => ({ kind: 'profile', version: 1, source, visitorId, at: Date.now() - 1000, fields: {}, audiences: {} });
/** The route's refusal as P58.BA4 reads it: status, error and the issues' messages. */
const routeAnswer = (answer: Answer) => [answer.status, answer.body.error, (answer.body.details as Array<{ message?: unknown }> | undefined)?.map(detail => detail.message)];
/** A door's answer as the typed refusal's one reader reads it, or what was answered instead. */
function typedAnswer(answer: Answer | { threw: string }): unknown {
  if ('threw' in answer) return `the door threw instead of answering: ${answer.threw.slice(0, 200)}`;
  const read = validationRefusalOf(answer.status, answer.body);
  return read ? [answer.status, read.issues.map(issue => issue.message)] : `answered ${answer.status} ${show(answer.body)}`;
}

// ===========================================================================
// In process: the mounted identity routes over the real Durable Object classes.
// ===========================================================================

interface IdentityWorld {
  m: Mounted; door: IdentityDoor;
  /** When the last link's answer arrived (`performance.now()`), before the pending work was drained. */
  answeredAt: () => number;
  /** A browser with an explicit choice and a page view; `viewed` adds a product view, so its object holds a profile. */
  browser: (viewed: boolean) => Promise<Shopper>;
  /** The operator's profile rows (`POST /v1/:tenant/identity/events`). */
  rows: (list: unknown[]) => Promise<void>;
  /** The browser's backend-signed link to an account, with any extra member (an account change). */
  link: (s: Shopper, accountId: string, extra?: Record<string, unknown>) => Promise<Answer>;
  /** The site's backend's signed account change `{ from, exp, statement }` from `from` to `to`. */
  change: (from: string, to: string) => Promise<Record<string, unknown>>;
}

async function identityWorld(host: Host): Promise<IdentityWorld> {
  const m = await mount(host, DOCUMENTS);
  expectPublished(m, 'P66 — the tenant\'s documents publish');
  const door = identityDoor(m), secret = identitySecretOf(m);
  const operator = new Hono<{ Bindings: Mounted['env'] }>();
  operator.use('*', tenantMiddleware());
  operator.route('/v1', identityRoutes);
  // The link through the identity routes as src/units/_parity3.ts \`identityDoor\` serves them, its answer timed before the drain.
  const pending: Promise<unknown>[] = [];
  let answeredAt = 0;
  const shopperCall = async (path: string, capability: string, body: unknown): Promise<Answer> => {
    let response: Response;
    try {
      response = await operator.fetch(new Request(`https://shop.invalid${path}`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: capability, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), m.env,
      { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
    } catch (error) {
      // No answer at all: the request escaped every error path (a leg reads it as no answer, never as a status).
      return { status: -1, body: { threw: `${(error as Error)?.name}: ${String((error as Error)?.message).slice(0, 200)}` } };
    }
    answeredAt = performance.now();
    const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
    // The answer is what the shopper received; work left pending after it is drained, and a rejection of it is read by no leg.
    while (pending.length) await Promise.allSettled(pending.splice(0));
    try { await door.drain(); } catch { /* a rejected pending task after the answer */ }
    return answer;
  };
  return {
    m, door, answeredAt: () => answeredAt,
    browser: async viewed => {
      const s = await shopperOn(m);
      expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${host}): the browser's page view is accepted`).toBe(200);
      if (viewed) expect((await s.action(VIEW_TABBY_26)).status, `PRECONDITION (${host}): the browser's product view is accepted`).toBe(200);
      return s;
    },
    rows: async list => {
      const response = await operator.fetch(new Request(`https://ops.invalid/v1/${TENANT}/identity/events`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: list }) }), m.env);
      expect(response.status, `PRECONDITION (${host}): the operator's profile rows are applied (${(await response.clone().text()).slice(0, 200)})`).toBe(200);
      await door.drain();
    },
    link: async (s, accountId, extra = {}) => {
      const exp = Math.floor(Date.now() / 1000) + 300;
      return shopperCall(`/v1/${TENANT}/identity/link`, s.grant.capability,
        { visitorId: s.subject, accountId, exp, assertion: await signAssertion(secret, TENANT as TenantId, s.subject, accountId, exp), ...extra });
    },
    change: async (from, to) => {
      const exp = Math.floor(Date.now() / 1000) + 300;
      return { from, exp, statement: await signAccountChange(secret, TENANT as TenantId, from, to, exp) };
    },
  };
}

/** The earlier account with `earlier` sources and the person's account with PERSON_SOURCES, each linked from its own browser. */
async function twoAccounts(host: Host, w: IdentityWorld, earlier = EARLIER_SOURCES): Promise<void> {
  const a = await w.browser(true);
  await w.rows(Array.from({ length: earlier }, (_, n) => row(a.subject, `earlier-${n}`)));
  const b = await w.browser(true);
  await w.rows(Array.from({ length: PERSON_SOURCES }, (_, n) => row(b.subject, `person-${n}`)));
  expect([(await w.link(a, EARLIER)).status, (await w.link(b, PERSON)).status], `PRECONDITION (${host}): the earlier account (${earlier} sources) and the person's (${PERSON_SOURCES}) are linked`).toEqual([200, 200]);
}

/** TC1's case in process: a third browser signs in to the person's account carrying the change from the earlier one. Its answer. */
async function accountChange(host: Host, earlier = EARLIER_SOURCES): Promise<{ w: IdentityWorld; answer: Answer }> {
  const w = await identityWorld(host);
  await twoAccounts(host, w, earlier);
  const x = await w.browser(false);
  return { w, answer: await w.link(x, PERSON, { accountChange: await w.change(EARLIER, PERSON) }) };
}

/** A call to one shopper object's door through the mounted namespace (the binding the route-side code holds): its answer, or what it threw. */
async function objectCall(m: Mounted, subject: string, path: string, init: RequestInit): Promise<Answer | { threw: string }> {
  const ns = m.env.SHOPPER_REFLEX;
  try {
    const response = await ns.get(ns.idFromName(shopperObjectName(TENANT as TenantId, subject))).fetch(`https://shopper-reflex${path}`, init);
    const text = await response.text();
    let body: Record<string, unknown>; try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { text }; }
    return { status: response.status, body };
  } catch (error) { return { threw: `${(error as Error).name}: ${(error as Error).message}` }; }
}

/** TC2's case in process: one browser (PERSON_SOURCES) is handed another's exported profile (EARLIER_SOURCES) at its absorb door. */
async function absorb(host: Host): Promise<Answer | { threw: string }> {
  const w = await identityWorld(host);
  const target = await w.browser(true);
  await w.rows(Array.from({ length: PERSON_SOURCES }, (_, n) => row(target.subject, `person-${n}`)));
  const other = await w.browser(true);
  await w.rows(Array.from({ length: EARLIER_SOURCES }, (_, n) => row(other.subject, `earlier-${n}`)));
  const exported = await objectCall(w.m, other.subject, '/identity/operator-export', { headers: { 'X-Reflex-Tenant': TENANT, 'X-Reflex-Subject': other.subject } });
  expect('threw' in exported ? exported.threw : [exported.status, typeof exported.body.pipeline],
    `PRECONDITION (${host}): the other browser's profile is exported through the operator's export door`).toEqual([200, 'object']);
  const profile = (exported as Answer).body;
  const answer = await objectCall(w.m, target.subject, '/identity/absorb', { method: 'POST',
    headers: { [SHOPPER_HEADER]: target.grant.capability, 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopperId: target.subject, affinity: profile.affinity, pipeline: profile.pipeline }) });
  await w.door.drain();
  return answer;
}

// ===========================================================================
// Natively: the real src/index.ts in workerd (src/units/_native.ts), as P58.BA4's native legs run it.
// ===========================================================================

const NATIVE_SECRET = 'p66-native-operator-signing-material';
const NATIVE_IDENTITY = 'p66-native-identity-material';
/**
 * P58's native wrapper (src/units/P58/LEDGER.unit.test.ts `NATIVE_WRAPPER`): the doors publish a tenant's documents and mint
 * an anonymous grant; P66 adds two that reach a shopper object's door through the Worker's own binding, as route-side code
 * does: the operator's export of a profile, and the absorb door, answered as `{ status, body }` or `{ threw }` when the call
 * itself rejects.
 */
const NATIVE_WRAPPER = `
import worker, { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { PRIORS_KIND } from './src/learn/priors.ts';
import { newAnonymousSession } from './src/identity/sessionCapability.ts';
import { shopperObjectName } from './src/tenancy/objects.ts';
export { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend };
const objectOf = (env, tenant, subject) => env.SHOPPER_REFLEX.get(env.SHOPPER_REFLEX.idFromName(shopperObjectName(tenant, subject)));
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== 'p66-fixture') return worker.fetch(request, env, ctx);
    const input = await request.json();
    if (url.pathname === '/publish') {
      const revision = value => ({ revision: 1, at: 1, actor: 'p66-native', note: '', value });
      await initializePublicationSet(env, [
        { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) }, { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
        { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) }, { kind: PRIORS_KIND, scope: input.tenant, revision: revision(input.priors) },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision(input.reflex) },
      ], '0:' + crypto.randomUUID());
      return Response.json({ published: input.tenant });
    }
    if (url.pathname === '/grant') return Response.json(await newAnonymousSession(env, input.tenant));
    if (url.pathname === '/export') {
      const response = await objectOf(env, input.tenant, input.subject).fetch('https://shopper-reflex/identity/operator-export', { headers: { 'X-Reflex-Tenant': input.tenant, 'X-Reflex-Subject': input.subject } });
      return Response.json({ status: response.status, body: await response.json() });
    }
    if (url.pathname === '/absorb') {
      try {
        const response = await objectOf(env, input.tenant, input.subject).fetch('https://shopper-reflex/identity/absorb', { method: 'POST',
          headers: { 'X-Shopper-Session': input.capability, 'X-Tenant': input.tenant, 'Content-Type': 'application/json' }, body: JSON.stringify(input.body) });
        const text = await response.text();
        let body; try { body = JSON.parse(text); } catch { body = { text }; }
        return Response.json({ status: response.status, body });
      } catch (error) { return Response.json({ threw: String(error && error.name) + ': ' + String(error && error.message) }); }
    }
    return new Response(null, { status: 404 });
  },
};`;
let nativeBundle: Promise<string> | undefined;

interface NativeBrowser { subject: string; capability: string; call: (path: string, body: unknown) => Promise<Answer> }
interface NativeWorld {
  browser: (viewed: boolean) => Promise<NativeBrowser>;
  rows: (list: unknown[]) => Promise<void>;
  link: (b: NativeBrowser, accountId: string, extra?: Record<string, unknown>) => Promise<Answer>;
  fixture: (path: string, body: unknown) => Promise<Record<string, unknown>>;
}

/** One host in workerd, every step awaited in turn (P58's `oversizedMergeNative`): the documents published, then `work`. */
async function nativeWorld<T>(host: Host, work: (w: NativeWorld) => Promise<T>): Promise<T> {
  const bundle = await (nativeBundle ??= bundleNativeWorker(NATIVE_WRAPPER, 'p66-ledger-native'));
  const directory = nativeScratchDirectory('p66-ledger-native-');
  const policy = { id: 'p66-native-policy', revision: 1, durationMs: 3650 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
  const runtime = await openNativeRuntime({ bundle, name: `p66-native-${host}`, persistDir: directory.path,
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket', DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
    kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
    bindings: { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host, JWT_SECRET: NATIVE_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      IDENTITY_SECRETS: `${TENANT}:${NATIVE_IDENTITY}`, LEDGER_RECOVERY_ENABLED: 'true', TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
      RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, policy])) } }) } });
  try {
    const fixture = async (path: string, body: unknown) => {
      const response = await runtime.fetch(`https://p66-fixture${path}`, { method: 'POST', body: JSON.stringify(body) });
      expect(response.status, `PRECONDITION (${host} native): fixture door ${path}`).toBe(200);
      return await response.json() as Record<string, unknown>;
    };
    await fixture('/publish', { tenant: TENANT, content: { version: 'p66-native', pieces: MODULES }, slots: DOCUMENTS.slots, learn: DOCUMENTS.learn, priors: EMPTY_PRIORS, reflex: REFLEX_DOCUMENT });
    const token = await new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a')
      .setExpirationTime('2h').sign(new TextEncoder().encode(NATIVE_SECRET));
    const browser = async (viewed: boolean): Promise<NativeBrowser> => {
      const g = await fixture('/grant', { tenant: TENANT }) as unknown as { capability: string; subject: string; sessionId: string; grantId: string; iat: number; exp: number };
      const call = async (path: string, body: unknown): Promise<Answer> => {
        const response = await runtime.fetch(`https://shop.example${path}`, { method: 'POST',
          headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: g.capability, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const text = await response.text();
        let parsed: Record<string, unknown>; try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = { text }; }
        return { status: response.status, body: parsed };
      };
      expect((await call(`/realtime/session/${g.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: g.grantId, iat: g.iat, exp: g.exp } })).status, `PRECONDITION (${host} native): the browser's explicit choice`).toBe(200);
      const event = (e: { type: string; data: Record<string, unknown> }) => ({ ...e, source: 'sdk', userId: g.subject, sessionId: g.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() });
      expect((await call('/realtime/action', event(PAGE_VIEW))).status, `PRECONDITION (${host} native): the browser's page view`).toBe(200);
      if (viewed) expect((await call('/realtime/action', event(VIEW_TABBY_26))).status, `PRECONDITION (${host} native): the browser's product view`).toBe(200);
      return { subject: g.subject, capability: g.capability, call };
    };
    const rows = async (list: unknown[]) => {
      const response = await runtime.fetch(`https://ops.example/v1/${TENANT}/identity/events`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: list }) });
      expect(response.status, `PRECONDITION (${host} native): the operator's profile rows are applied (${(await response.text()).slice(0, 200)})`).toBe(200);
    };
    const link = async (b: NativeBrowser, accountId: string, extra: Record<string, unknown> = {}) => {
      const exp = Math.floor(Date.now() / 1000) + 300;
      return b.call(`/v1/${TENANT}/identity/link`, { visitorId: b.subject, accountId, exp, assertion: await signAssertion(NATIVE_IDENTITY, TENANT as TenantId, b.subject, accountId, exp), ...extra });
    };
    return await work({ browser, rows, link, fixture });
  } finally { await runtime.dispose(); directory.remove(); }
}

const nativeChange = async (from: string, to: string) => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  return { from, exp, statement: await signAccountChange(NATIVE_IDENTITY, TENANT as TenantId, from, to, exp) };
};

// ===========================================================================
// unit:P66.TC1 — the account-change merge's refusal reaches the shopper as the route's own 400
// ===========================================================================

describe('unit:P66.TC1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK (in process) — a validation refusal raised in the person's own object during the account-change merge (five sources folded into four) reaches the shopper as the route's own 400 Validation error naming "at most8 sources"`, async () => {
      const { answer } = await accountChange(host);
      expect.soft(routeAnswer(answer), `${host}: P66.TC1 — the account change's refusal is the route's own 400 with the same issue: ${show(answer.body)}`).toEqual(ROUTE_REFUSAL);
    }, 120_000);
  }

  for (const host of HOSTS) {
    it(`native (${host}): in workerd too, the account-change merge's validation refusal, raised in the person's own object, crosses the Durable Object boundary typed and reaches the shopper as the route's own 400 Validation error naming "at most8 sources", not an untyped 500`, async () => {
      const answer = await nativeWorld(host, async w => {
        const a = await w.browser(true);
        await w.rows(Array.from({ length: EARLIER_SOURCES }, (_, n) => row(a.subject, `earlier-${n}`)));
        const b = await w.browser(true);
        await w.rows(Array.from({ length: PERSON_SOURCES }, (_, n) => row(b.subject, `person-${n}`)));
        expect([(await w.link(a, EARLIER)).status, (await w.link(b, PERSON)).status], `PRECONDITION (${host} native): the earlier account and the person's are linked`).toEqual([200, 200]);
        const x = await w.browser(false);
        return w.link(x, PERSON, { accountChange: await nativeChange(EARLIER, PERSON) });
      });
      expect.soft(routeAnswer(answer), `${host} native: P66.TC1 — the browser-side route answers its own 400 with the same issue, not a 500: ${show(answer.body)}`).toEqual(ROUTE_REFUSAL);
    }, 180_000);
  }

  it('CONTROL (in process, session host): within the limit (four sources and four), the same signed account change is accepted and merges, so the refusal above is the limit\'s', async () => {
    const { answer } = await accountChange('session', PERSON_SOURCES);
    expect([answer.status, answer.body.outcome], `CONTROL — an account change within the limit links and merges: ${show(answer.body)}`).toEqual([200, 'linked']);
  }, 120_000);
});

// ===========================================================================
// unit:P66.TC2 — the absorb merge's refusal crosses the object boundary typed
// ===========================================================================

describe('unit:P66.TC2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): in process, a validation refusal raised by the absorb merge (another profile's five sources folded into four) is answered by the absorb door as the typed refusal: status 400 and the exact shape validationRefusalOf reads, with the issue "at most8 sources"`, async () => {
      const answer = await absorb(host);
      expect.soft(typedAnswer(answer), `${host}: P66.TC2 — the absorb door answers the typed refusal`).toEqual(TYPED_REFUSAL);
    }, 120_000);
  }

  for (const host of HOSTS) {
    it(`native (${host}): in workerd too, the absorb door answers the merge's validation refusal as the typed refusal across the Durable Object boundary (status 400, the exact shape, "at most8 sources"), never an untyped failure`, async () => {
      const answer = await nativeWorld(host, async w => {
        const target = await w.browser(true);
        await w.rows(Array.from({ length: PERSON_SOURCES }, (_, n) => row(target.subject, `person-${n}`)));
        const other = await w.browser(true);
        await w.rows(Array.from({ length: EARLIER_SOURCES }, (_, n) => row(other.subject, `earlier-${n}`)));
        const exported = await w.fixture('/export', { tenant: TENANT, subject: other.subject }) as { status?: unknown; body?: Record<string, unknown> };
        expect([exported.status, typeof exported.body?.pipeline], `PRECONDITION (${host} native): the other browser's profile is exported`).toEqual([200, 'object']);
        return await w.fixture('/absorb', { tenant: TENANT, subject: target.subject, capability: target.capability,
          body: { shopperId: target.subject, affinity: exported.body!.affinity, pipeline: exported.body!.pipeline } }) as Answer | { threw: string };
      });
      expect.soft(typedAnswer(answer), `${host} native: P66.TC2 — the absorb door answers the typed refusal across the boundary`).toEqual(TYPED_REFUSAL);
    }, 180_000);
  }

  it('CONTROL: the reading has teeth — a thrown error and an untyped 500 are not the typed refusal; the typed answer is', () => {
    const typed = validationRefusal([{ code: 'custom', path: [], message: 'at most8 sources' }] as z.ZodError['issues']);
    expect(typedAnswer({ threw: 'ZodError: [ … at most8 sources … ]' }), 'CONTROL — a thrown error').toMatch(/threw/);
    expect(typedAnswer({ status: 500, body: { error: 'Internal server error', message: 'ZodError: at most8 sources' } }), 'CONTROL — an untyped 500').toMatch(/^answered 500/);
    expect([typed.status, typedAnswer({ status: typed.status, body: { ok: false, refusal: 'validation', issues: [{ code: 'custom', path: [], message: 'at most8 sources' }] } })], 'CONTROL — the typed refusal')
      .toEqual([400, TYPED_REFUSAL]);
  });
});

// ===========================================================================
// unit:P66.TC3 — locks: the typed shape's one reader and its producers, no message parsed, the answer path
// ===========================================================================

/** Every source file of the product under src/ (tests and the unit tree excluded), relative to the checkout. */
function productSources(): string[] {
  const root = fileURLToPath(new URL('../../../', import.meta.url)), out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== 'units' && name !== 'node_modules') walk(path); }
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(relative(root, path));
    }
  };
  walk(join(root, 'src'));
  return out.sort();
}
const callersOf = (name: string) => productSources().filter(file => new RegExp(`\\b${name}\\(`).test(readTree(file).replace(/export function [A-Za-z]+\(/g, ''))).sort();

/** The remote calls the base makes before the answer of an account-change link within the limit, per binding and method (81713505; the header). */
const BASE_CALLS_BEFORE_ANSWER: Record<Host, Record<string, number>> = {
  session: { 'STORAGE.get': 3, 'SESSIONS.get': 1, 'SESSIONS.put': 9 },
  do: { 'STORAGE.get': 3, 'SESSIONS.put': 3 },
};
const beyondBase = (host: Host, calls: string[]) => Object.entries(calls.reduce<Record<string, number>>((out, call) => ({ ...out, [call]: (out[call] ?? 0) + 1 }), {}))
  .filter(([call, count]) => count > (BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0)).map(([call, count]) => `${call} ×${count} (base ${BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0})`);

describe('unit:P66.TC3', () => {
  it('logic: LOCK — validationRefusalOf reads a refusal only at status 400 in the exact strict shape (src/identity/sessionAuthority.ts), with the issues as given', () => {
    const issues = [{ code: 'custom', path: ['profileEnrichment'], message: 'at most8 sources' }];
    const shape = { ok: false, refusal: 'validation', issues };
    const read = (status: number, body: unknown) => validationRefusalOf(status, body)?.issues.map(issue => issue.message) ?? 'none';
    expect.soft([read(400, shape), validationRefusalOf(400, shape) instanceof z.ZodError], 'P66.TC3 — status 400 and the exact shape: the validation error with the same issues').toEqual([['at most8 sources'], true]);
    expect.soft([200, 401, 409, 422, 500].map(status => read(status, shape)), 'P66.TC3 — the same shape at any other status: none').toEqual(['none', 'none', 'none', 'none', 'none']);
    expect.soft([read(400, { ...shape, extra: 1 }), read(400, { ok: false, issues }), read(400, { ...shape, refusal: 'other' }), read(400, { ...shape, ok: true }), read(400, { ...shape, issues: [] }),
      read(400, { error: 'Validation error', details: issues }), read(400, 'ZodError: at most8 sources')],
    'P66.TC3 — an extra member, a missing or other refusal, ok true, no issues, the route\'s own answer, or a message: none').toEqual(['none', 'none', 'none', 'none', 'none', 'none', 'none']);
    const typed = validationRefusal(issues as z.ZodError['issues']);
    expect.soft(typed.status, 'P66.TC3 — the typed refusal is answered at status 400').toBe(400);
  });

  it('logic: LOCK — the typed shape is produced only by the account object\'s doors and read only where their answers arrive: outside the tests, validationRefusal( is called only in src/durable-objects/ShopperReflex.ts, and validationRefusalOf( only there and in src/identity/link.ts', () => {
    expect.soft(callersOf('validationRefusal'), 'P66.TC3 — the producers of the typed shape').toEqual(['src/durable-objects/ShopperReflex.ts']);
    expect.soft(callersOf('validationRefusalOf'), 'P66.TC3 — its readers').toEqual(['src/durable-objects/ShopperReflex.ts', 'src/identity/link.ts']);
  });

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — no message string is parsed: when the account-change door fails with an untyped error whose message is a validation error's own text ("ZodError: [ … at most8 sources … ]", what crosses natively today), the shopper is answered as for any untyped failure, 500 Internal server error, never a 400 read out of that text`, async () => {
      const issues = [{ code: 'custom', path: [], message: 'at most8 sources' }] as z.ZodError['issues'];
      // The text a validation error carries across the Durable Object boundary natively today (TC1's native answer: "ZodError: [ … ]").
      const text = `ZodError: ${new z.ZodError(issues).message}`;
      const door = vi.spyOn(ShopperReflex.prototype as unknown as { handleAccountChange: (...args: unknown[]) => Promise<Response> }, 'handleAccountChange')
        .mockImplementationOnce(() => Promise.reject(new Error(text)));
      let answer: Answer, reached = 0;
      try { ({ answer } = await accountChange(host, PERSON_SOURCES)); } finally { reached = door.mock.calls.length; door.mockRestore(); }
      expect(reached, `${host}: PRECONDITION — the account-change door was reached and failed with the untyped error`).toBe(1);
      expect.soft([answer.status, answer.body.error], `${host}: P66.TC3 — an untyped failure carrying a validation error's text is answered as an untyped failure: ${show(answer.body)}`)
        .toEqual([500, 'Internal server error']);
    }, 120_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — no new remote call before the answer: with 20 ms added to every remote binding call, an account-change link within the limit makes, per binding and method, no more remote calls before its answer than the base`, async () => {
      const w = await identityWorld(host);
      await twoAccounts(host, w, PERSON_SOURCES);
      const x = await w.browser(false);
      const lever = remoteLatency(w.m), first = lever.calls.length;
      lever.set(20);
      const change = await w.change(EARLIER, PERSON);
      let answer: Answer;
      try { answer = await w.link(x, PERSON, { accountChange: change }); } finally { lever.set(0); }
      const answeredAt = w.answeredAt();
      expect([answer.status, answer.body.outcome], `${host}: PRECONDITION — the account change within the limit is accepted: ${show(answer.body)}`).toEqual([200, 'linked']);
      const before = lever.calls.slice(first).filter(call => call.at <= answeredAt).map(call => `${call.binding}.${call.method}`);
      expect.soft(beyondBase(host, before), `${host}: P66.TC3 — no remote call before the answer beyond the base's`).toEqual([]);
    }, 120_000);
  }

  it('CONTROL: a new remote call before the answer is caught; the static reading finds a call in a file', () => {
    expect(beyondBase('do', ['STORAGE.get', 'CACHE.get']), 'CONTROL — a call beyond the base is named').toEqual(['CACHE.get ×1 (base 0)']);
    expect(beyondBase('do', ['STORAGE.get', 'STORAGE.get', 'STORAGE.get', 'STORAGE.get']), 'CONTROL — one more of a counted call is named').toEqual(['STORAGE.get ×4 (base 3)']);
    expect(callersOf('linkVisitor').length, 'CONTROL — the static reading finds the link\'s callers').toBeGreaterThan(0);
  });
});
