// src/units/P35/LEDGER.unit.test.ts
// P35 under the Closure Ledger: the tests for the LOCAL criteria of the P35 work
// order (`tapestry-parity-build`, ticket P35 "Affinity audiences reach
// Experimentation: identity alignment"). DC1 and DC2 (decisions D1, D2) are
// ruled here and exercised inside Z1-Z5; LV1 and LV2 are deferred live rows and
// get no test.
//
// One `describe('unit:P35.<criterion> …')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P35 in section E): "ODP
//     profiles written by the engine carry an identifier Experimentation
//     resolves, so a segment built on our fields targets an experiment; the
//     page-side path is documented in the kit; nothing creates ODP fields or
//     segments on their behalf";
//   · freeze sheet item 13 (D1: a tenant-configured second ODP identifier,
//     written only when P12's identifier is present, creating nothing in ODP;
//     D2: the page-side path in the kit) and item 50 ("The customer's hashed
//     identifier is read from wherever P12 and P13 hold it; both hosts are
//     writable"). Both UNANSWERED at the freeze: every unit names them (R-P15);
//   · P12's representation on rem/spec-parity-c (acb06fc2, read per R-P16): the
//     customer's hashed identifier is the account identifier `accountId` of the
//     backend-signed link POST /v1/:tenant/identity/link;
//   · the investigation, section G-A ("Affinity-based audiences": we write
//     profiles under a digest of tenant, namespace and our shopper identifier;
//     options: their hashed identifier as a second ODP identifier; the page
//     passing our segments and interest values to their Experimentation user
//     context; "nothing creates ODP fields or segments");
//   · the existing contract: src/connectors/config.ts (the tenant connector
//     registry, `odp` strict; connectorIdentity), src/services/odpLoop.ts (events
//     to /v3/events with `identifiers: { vuid }` under tracking consent, profile
//     upserts to /v3/profiles with `attributes: { vuid, … }` under
//     personalization consent, audience reads on /v3/graphql).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   The tenant's ODP connector configuration (`TENANT_CONNECTORS`, `odp`) may
//   name `secondIdentifier: '<ODP identifier field>'`. Where it does and the
//   shopper carries the customer's hashed identifier — the account identifier
//   of the shopper's verified P12 link, which the link record keeps only while
//   the setting is configured and the erasure clears (R-P36), read on either
//   host — every event write carries `identifiers: { vuid, <field>: <hashed> }`
//   and every profile write `attributes: { vuid, <field>: <hashed>, … }`.
//   Otherwise every write is exactly today's: an event `{ ...mapped,
//   identifiers: { vuid } }` (src/services/odpLoop.ts:372, the mapping of
//   :192), a profile `[{ attributes: { vuid, …the configured profile fields } }]`
//   (:423-435). The identifier a page carries before recognition (P13's
//   `customerId` on the action envelope) is carried, never proof, and is never
//   the ODP identity: the fixture carries it where a leg allows and no write may
//   show it. The fixture runs the
//   tenant on the customer profile (DEPLOYMENT_PROFILE 'customer'), so the
//   tenant connector registry, not the demo's stamp-global settings, governs
//   ODP; ODP is a recording fetch at a synthetic host.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `secondIdentifier` in the tenant's ODP connector configuration, and the field
// it names on ODP writes. No new export is imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts) and
// src/units/_parity3.ts (the identity routes, the tenant's identity material).
//
// R10 (P109.GD2, E33, R-P707; by name): P35.Z2 compares the ODP writes action by action, order-free within one action
// (src/units/P109/_counted.ts `perAction`). The event forward and the profile upsert of one action are two concurrent
// fire-and-forget chains (src/routes/realtime.ts, the action route's forwardEventToOdp and upsertOdpProfile on waitUntil;
// src/durable-objects/ShopperReflex.ts, the same two on retainOwnerWork), so their order inside one action is the
// scheduler's; the order across actions, every byte and the count of writes stay pinned, and a leaked second identifier
// still turns it RED (proved by unit:P109.GD2). Every expectation unchanged.

import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configuredDestinations } from '@/connectors/config';
import { identityRoutes } from '@/routes/identity';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

import {
  HOSTS, learnDocument, MODULES, mount, PAGE_VIEW, readTree, recentSlot, shopperOn, TENANT, VIEW_TABBY_26, VIEW_TABBY_WALLET,
  type Mounted, type Shopper,
} from '../_parity';
import { hmacOf, identityDoor, identitySecretOf, sha256Hex, type IdentityDoor } from '../_parity3';
import { perAction } from '../P109/_counted';

const ODP_HOST = 'https://odp-coach.invalid';
const OTHER_HOST = 'https://odp-harbor.invalid';
const FIELD = 'customer_hash_id';
const ODP = {
  apiHost: ODP_HOST, publicKeyRef: 'CONNECTOR_SECRET_ODP_COACH', identityNamespace: 'coach-customer',
  actions: { product_view: { type: 'product', action: 'detail', fields: { product_id: 'productId', product_line: 'line' } } },
  audiences: {}, profile: { line_affinity_tabby: { dimension: 'line', value: 'Tabby' }, dominant_line: { dimension: 'line' } },
};
const SLOTS = { version: 'parity-p35-slots', governanceVersion: 3, pages: { pdp: [recentSlot()] } };
const documents = { pieces: MODULES, slots: SLOTS, learn: learnDocument() };
const OPERATOR_SECRET = 'parity-synthetic-operator-signing-material';
/** Synthetic identity material of production grade (src/identity/material.mjs: 32+ bytes, 8+ distinct characters). */
const IDENTITY_MATERIAL = 'Pq7vRz2xKd9mWb4nTs6yLf3hGc8jNa5u';
const IDENTITY_SALT = 'Hx3kMw8pQz5rVt2nYb7cFd4gJs9aLe6u';
const IDENTITY_MATERIAL_OTHER = 'Zt4wNq8kRb2xHm6vLc9pJf3sDg7yKa5e';

interface OdpCall { method: string; path: string; origin: string; body: unknown }
afterEach(() => { vi.unstubAllGlobals(); });

/**
 * The mounted tenant with ODP as a recording fetch, on the customer profile (where the tenant connector registry, not
 * the demo's stamp-global settings, governs ODP) with its ODP configuration (and, when named, the second identifier),
 * and the production-grade identity material the customer profile verifies a signed link against.
 */
async function withOdp(host: 'session' | 'do', initialSetting: string | null, other: { tenant: string; secondIdentifier: string } | null = null) {
  const calls: OdpCall[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    let body: unknown = null;
    try { body = JSON.parse(String(init?.body ?? 'null')); } catch { body = String(init?.body ?? ''); }
    calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname, origin: url.origin, body });
    return url.pathname === '/v3/graphql' ? Response.json({ data: { customer: null } }) : Response.json({}, { status: 202 });
  });
  const m = await mount(host, documents);
  expect(m.refused, `PRECONDITION (${host}): the tenant's documents publish`).toBeNull();
  /** The tenant's connector configuration as the stamp holds it; called again when a leg switches the setting (a redeploy of the stamp). */
  const connect = async (secondIdentifier: string | null) => {
  const env = m.env as unknown as Record<string, unknown>;
  env.DEPLOYMENT_PROFILE = 'customer';
  env.IDENTITY_SECRETS = other ? `${TENANT}:${IDENTITY_MATERIAL},${other.tenant}:${IDENTITY_MATERIAL_OTHER}` : `${TENANT}:${IDENTITY_MATERIAL}`;
  env.IDENTITY_SALT = IDENTITY_SALT;
  const tenants: Record<string, unknown> = { [TENANT]: { odp: { ...ODP, ...(secondIdentifier ? { secondIdentifier } : {}) } } };
  if (other) {
    env.TENANTS = JSON.stringify({ provisioned: [TENANT, other.tenant], operatorGrants: { ops: [TENANT, other.tenant] } });
    tenants[other.tenant] = { odp: { ...ODP, apiHost: OTHER_HOST, publicKeyRef: 'CONNECTOR_SECRET_ODP_OTHER', secondIdentifier: other.secondIdentifier } };
    env.CONNECTOR_SECRET_ODP_OTHER = 'other-odp-key.synthetic';
  }
  env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants });
  env.CONNECTOR_SECRET_ODP_COACH = 'coach-odp-key.synthetic';
  // The configured destination's own retention policy, as a provisioned stamp holds one (src/units/W41/FIX1.unit.test.ts's idiom).
  const retention = JSON.parse(String(env.RETENTION)) as { tenants: Record<string, Record<string, unknown>> };
  const policy = Object.values(retention.tenants[TENANT]!)[0];
  try { for (const d of await configuredDestinations(m.env, TENANT)) retention.tenants[TENANT]![d.category] = policy; } catch { /* a refused registry reaches the production refusal */ }
  env.RETENTION = JSON.stringify(retention);
  };
  await connect(initialSetting);
  /** R10 (P109.GD2): the count of calls after each drained action of `recognisedBrowsing` (its action boundaries). */
  const marks: number[] = [];
  return { m, calls, door: identityDoor(m), connect, marks };
}

/** The shopper's backend-signed link (P12's), the account identifier being the customer's hashed identifier. */
async function linked(m: Mounted, door: IdentityDoor, s: Shopper, accountId: string): Promise<{ capability: string; shopperId: string }> {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const assertion = await hmacOf(identitySecretOf(m), `${TENANT}\n${s.subject}\n${accountId}\n${exp}`);
  const answer = await door.call(`/v1/${TENANT}/identity/link`, s.grant.capability, { visitorId: s.subject, accountId, source: 'login', exp, assertion });
  expect(answer.status, `PRECONDITION (${m.host}): the shopper's signed link is accepted: ${JSON.stringify(answer.body).slice(0, 200)}`).toBe(200);
  return { capability: ((answer.body.session ?? {}) as { capability?: string }).capability ?? '', shopperId: String(answer.body.shopperId ?? '') };
}
/**
 * An action under a session capability, anonymous or recognised. `carried` is the identifier a page passes before recognition,
 * on the action envelope as P13 carries it (`customerId`, src/units/P13/LEDGER.unit.test.ts): carried, never proof.
 */
async function actAs(door: IdentityDoor, capability: string, event: { type: string; data: Record<string, unknown> }, carried?: string) {
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(capability.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)))) as { subject: string; sessionId: string };
  return door.call('/realtime/action', capability, { ...event, source: 'sdk', userId: claims.subject, sessionId: claims.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(),
    ...(carried ? { customerId: carried } : {}) });
}
/** The views every leg's shopper makes, in order. */
const VIEWS = [VIEW_TABBY_26, VIEW_TABBY_26, VIEW_TABBY_WALLET, VIEW_TABBY_26];
/** Browse anonymously, sign in, the tenant's connector switched on, then browse as the recognised person: the ODP writes that follow are that person's. */
async function recognisedBrowsing(f: { m: Mounted; door: IdentityDoor; calls?: OdpCall[]; marks?: number[] }, accountId: string | null, consent = { tracking: true, personalization: true }, carried?: string) {
  const { m, door } = f;
  /** R10 (P109.GD2): each action is drained before the next (`identityDoor.call`), so a mark closes one action's writes. */
  const mark = () => { if (f.marks && f.calls) f.marks.push(f.calls.length); };
  const s = await shopperOn(m, consent);
  const pageView = carried ? await actAs(door, s.grant.capability, PAGE_VIEW, carried) : await s.action(PAGE_VIEW);
  expect(pageView.status, `${m.host}: P35 — the shopper's page view is answered under the tenant's ODP connector configuration: ${JSON.stringify(pageView.body).slice(0, 200)}`).toBe(200);
  const person = accountId ? await linked(m, door, s, accountId) : { capability: s.grant.capability, shopperId: s.subject };
  mark();
  for (const view of VIEWS) {
    const acted = await actAs(door, person.capability, view, carried);
    expect(acted.status, `${m.host}: P35 — the shopper's view is answered under the tenant's ODP connector configuration: ${JSON.stringify(acted.body).slice(0, 160)}`).toBe(200);
    mark();
  }
  await m.drain(); await door.drain();
  return person;
}
const writes = (calls: OdpCall[]) => calls.filter(c => c.method === 'POST' && (c.path === '/v3/events' || c.path === '/v3/profiles'));
const identifiersOf = (c: OdpCall): Record<string, unknown> => c.path === '/v3/events'
  ? ((c.body as { identifiers?: Record<string, unknown> }).identifiers ?? {})
  : (((c.body as Array<{ attributes?: Record<string, unknown> }>)[0]?.attributes) ?? {});
/** A write with its vuid named as the placeholder, so two shoppers' writes compare byte for byte. */
const normalised = (c: OdpCall) => {
  const vuid = String(identifiersOf(c).vuid ?? '');
  return `${c.method} ${c.path} ${JSON.stringify(c.body).split(vuid).join('<vuid>')}`;
};
/**
 * TODAY'S SHAPES, from the connector as it writes today (R-P36): an event write is `{ ...mapped, identifiers: { vuid } }`
 * (src/services/odpLoop.ts:372) with the configured action's mapping (`type`, `action`, then `data` in the configured field
 * order, :192); a profile write is `[{ attributes: { vuid, …the configured profile fields in their order } }]` (:423-435), its
 * values the shopper's live scores. A write is compared as the normalised wire string, the vuid named as a placeholder.
 */
const todayEvent = (view: { data: Record<string, unknown> }) =>
  `POST /v3/events ${JSON.stringify({ type: 'product', action: 'detail', data: { product_id: view.data.productId, product_line: view.data.line }, identifiers: { vuid: '<vuid>' } })}`;
const TODAY_PROFILE = /^POST \/v3\/profiles \[\{"attributes":\{"vuid":"<vuid>","line_affinity_tabby":-?\d+(\.\d+)?(e-?\d+)?,"dominant_line":"[A-Za-z]*"\}\}\]$/;
/** The writes of one run as [the event writes, normalised; each profile write's shape]: `today's profile` or the write itself. */
const shapesOf = (calls: OdpCall[]) => [writes(calls).filter(c => c.path === '/v3/events').map(normalised),
  writes(calls).filter(c => c.path === '/v3/profiles').map(c => (TODAY_PROFILE.test(normalised(c)) ? "today's profile" : normalised(c)))] as const;

// ===========================================================================
// unit:P35.Z1 — the second identifier beside the vuid on every write
// ===========================================================================

describe('unit:P35.Z1 (freeze items 13 and 50)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with the tenant's second ODP identifier configured and the shopper's hashed identifier present through the shopper's P12 link, every ODP event and profile write carries it beside the vuid, and never the other identifier the page carried`, async () => {
      const hashed = await sha256Hex('jordan.lee@example.com');
      // The page also passes an identifier before recognition (P13), a value other than the linked account's: never the ODP identity.
      const carried = await sha256Hex('parity-p35-page-carried-0001');
      const f = await withOdp(host, FIELD);
      const { calls } = f;
      await recognisedBrowsing(f, hashed, undefined, carried);
      const own = writes(calls);
      expect([own.some(c => c.path === '/v3/events'), own.some(c => c.path === '/v3/profiles')],
        `${host}: P35.Z1 — ODP receives the shopper's event and profile writes under the configured connector (paths: ${JSON.stringify(calls.map(c => c.path))})`).toEqual([true, true]);
      expect(own.map(c => [c.path, typeof identifiersOf(c).vuid, identifiersOf(c)[FIELD] ?? null]),
        `${host}: P35.Z1 — each write carries ${FIELD} = the hashed identifier of the shopper's P12 link beside the vuid`).toEqual(own.map(c => [c.path, 'string', hashed]));
      expect(own.filter(c => JSON.stringify(c.body).includes(carried)).map(c => c.path),
        `${host}: P35.Z1 — LOCK: no write carries the identifier the page carried before recognition (P13's customerId is never the ODP identity, R-P36)`).toEqual([]);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P35.Z2 — without the setting, or without the identifier, byte for byte today
// ===========================================================================

describe('unit:P35.Z2 (freeze item 13)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with the setting absent every ODP write has today's shape, linked or not; with the setting present and no hashed identifier from a link (only the very value the page carried, which is never proof), every write is byte for byte the reference run made without the link`, async () => {
      const hashed = await sha256Hex('jordan.lee@example.com');
      const expectedEvents = VIEWS.map(todayEvent);
      // The setting absent: the shopper linked, and the reference run without the link. Each pinned to today's shapes, not to another run of the same build.
      const linkedRun = await withOdp(host, null);
      await recognisedBrowsing(linkedRun, hashed);
      const reference = await withOdp(host, null);
      await recognisedBrowsing(reference, null);
      for (const [name, run] of [['the shopper linked', linkedRun], ['the reference run without the link', reference]] as const) {
        const [events, profiles] = shapesOf(run.calls);
        expect([events, profiles.length > 0 && profiles.every(p => p === "today's profile")],
          `${host}: P35.Z2 — LOCK: the setting absent (${name}), every event write is today's odpLoop.ts:372 write and every profile write today's :423-435 shape (profiles: ${JSON.stringify(profiles).slice(0, 300)})`)
          .toEqual([expectedEvents, true]);
      }
      // The setting present, no link: the page carries the very hashed value before recognition (P13), which is never the ODP identity.
      const present = await withOdp(host, FIELD);
      await recognisedBrowsing(present, null, undefined, hashed);
      // R10 (P109.GD2): compared action by action, order-free within one action (the two writes of one request are concurrent).
      const actions = (run: { calls: OdpCall[]; marks: number[] }) => perAction(run.calls, run.marks, c => (writes([c]).length ? normalised(c) : null));
      expect([present.marks.length, reference.marks.length], `${host}: PRECONDITION — each run's action boundaries are recorded (the page view, then each view)`)
        .toEqual([VIEWS.length + 1, VIEWS.length + 1]);
      expect(actions(present),
        `${host}: P35.Z2 — the setting present and no hashed identifier from a link: every write byte for byte the reference run made without the link, action by action`).toEqual(actions(reference));
    }, 180_000);
  }
});

// ===========================================================================
// unit:P35.Z3 — only today's ODP calls; nothing created
// ===========================================================================

describe('unit:P35.Z3 (freeze item 13)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with the second identifier configured the engine calls exactly the ODP endpoints it calls today and creates no field, segment or audience`, async () => {
      const hashed = await sha256Hex('jordan.lee@example.com');
      const today = await withOdp(host, null);
      await recognisedBrowsing(today, hashed);
      const configured = await withOdp(host, FIELD);
      await recognisedBrowsing(configured, hashed);
      const endpoints = (calls: OdpCall[]) => [...new Set(calls.map(c => `${c.method} ${c.path}`))].sort();
      expect(endpoints(today.calls).length, `${host}: CONTROL — today's connector calls ODP`).toBeGreaterThan(0);
      expect(endpoints(configured.calls), `${host}: P35.Z3 — the same endpoints as today, and only those`).toEqual(endpoints(today.calls));
      expect(configured.calls.filter(c => !['/v3/events', '/v3/profiles', '/v3/graphql'].includes(c.path)).map(c => `${c.method} ${c.path}`),
        `${host}: P35.Z3 — no call creates a field, segment or audience`).toEqual([]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P35.Z4 — under today's consent, never after erasure, only for the tenant that configured it
// ===========================================================================

describe('unit:P35.Z4 (freeze items 13 and 50)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with personalization refused the shopper's events carry the identifier and no profile is written, as today's consent governs; after the shopper's erasure no write carries it, though the person's later activity reaches ODP`, async () => {
      const hashed = await sha256Hex('jordan.lee@example.com');
      const f = await withOdp(host, FIELD);
      const { m, calls, door } = f;
      const person = await recognisedBrowsing(f, hashed, { tracking: true, personalization: false });
      const own = writes(calls);
      expect([own.filter(c => c.path === '/v3/profiles').length, own.filter(c => c.path === '/v3/events').map(c => identifiersOf(c)[FIELD] ?? null)],
        `${host}: P35.Z4 — under tracking consent alone the shopper's events carry the identifier and no profile write is made`).toEqual([0, own.filter(c => c.path === '/v3/events').map(() => hashed)]);
      expect(own.filter(c => c.path === '/v3/events').length, `${host}: PRECONDITION — the shopper's events reach ODP`).toBeGreaterThan(0);
      const operator = await new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('1h').sign(new TextEncoder().encode(OPERATOR_SECRET));
      const app = new Hono<{ Bindings: Env }>(); app.use('*', tenantMiddleware()); app.route('/v1', identityRoutes);
      // The operator's erasure through the stamp's own operator credential (the fixture's signing material is demo-grade).
      const env = m.env as unknown as Record<string, unknown>;
      env.DEPLOYMENT_PROFILE = 'demo';
      const erased = await app.fetch(new Request(`https://ops.invalid/v1/${TENANT}/identity/erase`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${operator}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ shopperId: person.shopperId }) }),
      m.env, { waitUntil: () => undefined, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
      env.DEPLOYMENT_PROFILE = 'customer';
      expect(erased.status, `${host}: PRECONDITION — the operator erases the shopper: ${(await erased.clone().text()).slice(0, 200)}`).toBe(200);
      await m.drain();
      // The erased session is refused, so the person comes back: a new browser signs in as the same person while the tenant's
      // setting is off (a link made then keeps nothing, R-P36), then the stamp turns the setting back on and the person browses.
      // Only an identifier kept from before the erasure could reach these writes.
      await f.connect(null);
      const again = await shopperOn(m, { tracking: true, personalization: false });
      const relinked = await linked(m, door, again, hashed);
      expect(relinked.shopperId, `${host}: PRECONDITION — the later sign-in is the same person`).toBe(person.shopperId);
      await f.connect(FIELD);
      const after = calls.length;
      for (const view of [VIEW_TABBY_26, VIEW_TABBY_WALLET]) {
        expect((await actAs(door, relinked.capability, view)).status, `${host}: PRECONDITION — the person's view after the erasure is answered`).toBe(200);
      }
      await m.drain(); await door.drain();
      const later = writes(calls.slice(after));
      expect(later.filter(c => c.path === '/v3/events').length, `${host}: PRECONDITION — the person's activity after the erasure reaches ODP`).toBeGreaterThan(0);
      expect(later.map(c => [c.path, identifiersOf(c)[FIELD] ?? null, JSON.stringify(c.body).includes(hashed)]),
        `${host}: P35.Z4 — after the erasure no ODP write carries the identifier: the erasure cleared what the earlier link kept, and the sign-in made without the setting kept nothing`)
        .toEqual(later.map(c => [c.path, null, false]));
    }, 180_000);

    it(`host (${host}): another tenant configuring the second identifier does not make this tenant write it`, async () => {
      const hashed = await sha256Hex('jordan.lee@example.com');
      const f = await withOdp(host, null, { tenant: 'harbor', secondIdentifier: FIELD });
      const { m, calls, door } = f;
      await recognisedBrowsing(f, hashed);
      const own = writes(calls).filter(c => c.origin === ODP_HOST);
      expect(own.length, `${host}: CONTROL — this tenant's connector writes the shopper's events and profile`).toBeGreaterThan(0);
      expect(own.map(c => identifiersOf(c)[FIELD] ?? null), `${host}: P35.Z4 — none carries the identifier the other tenant configured`).toEqual(own.map(() => null));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P35.Z5 — the kit
// ===========================================================================

describe('unit:P35.Z5 (freeze item 13)', () => {
  it('logic: the integration guide, the API reference and the payload schemas each document the second identifier and the page-side path into the experimentation user context', () => {
    const sentences = (file: string) => readTree(file).replace(/`/g, '').split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(s => s.replace(/\s+/g, ' ').trim());
    const statements: Array<[string, (s: string) => boolean]> = [
      ['secondIdentifier: the tenant-configured second ODP identifier, written only when the hashed identifier is present', s => /secondIdentifier/.test(s) && /(hashed identifier|account identifier)/i.test(s) && /(only when|present)/i.test(s)],
      ['nothing is created in ODP: no field, segment or audience', s => /ODP/.test(s) && /(creates? nothing|never creates?|does not create|no (ODP )?field)/i.test(s) && /segment/i.test(s)],
      ['the page passes the engine’s segments and interest values to the experimentation user context as attributes', s => /(user context|userContext)/i.test(s) && /attribute/i.test(s) && /(segment|interest)/i.test(s)],
    ];
    const missing = ['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']
      .flatMap(file => statements.filter(([, test]) => !sentences(file).some(test)).map(([name]) => `${file}: ${name}`));
    expect(missing, 'P35.Z5 — the kit documents the second identifier and the page-side path').toEqual([]);
  });
});
