// src/units/W16/C6.unit.test.ts
// W16 criterion C6 — anonymous return continuity (batch W16-B6).
//
// WITNESSES. Every expected value below comes from the admitted C6 text in
// `docs/handover/HANDOFF-2026-09-18.md` §5 point 6, the settled "W16 continuity"
// decision in §7 (a separate bounded rotating purpose/mode-bound recognition
// proof — not expired-session extension and not fingerprinting; production
// window/purpose approval absent means disabled), §8 (activation stays absent),
// §12 (a `ss1` session capability and a long-lived recognition proof are
// different purposes; retention approval is per purpose; the 30-day consent
// record authorizes no continuity credential), document 35 §5 W16 / §2 F13-F14
// and `docs/architecture/tapestry_requirements.txt` line 152 "Return Visit
// Recognition — picks up where you left off" (Cross-Device Continuity, line 154,
// is explicitly out of scope here: one physical subject, one device).
// Never from what the engine returns today: today a return after seven days is
// refused, because a capability lives at most SHOPPER_MAX_AGE (24 h) and the
// object admits only stored grants (`ShopperReflex.ts:1769-1770`). That gap is
// what these twelve units close.
//
// ACTIVATION STAYS ABSENT (HANDOFF §8). Nothing here asks for a shipped default
// mode, window or purpose. The continuity configuration used below is a
// SYNTHETIC, CUSTOMER-NEUTRAL fixture document published by the test itself, and
// the first unit measures that an engine with no published configuration issues
// nothing and fails closed.
//
// THE RULED CONTRACT (the specification these units define; the wire and storage
// names are the ruled members of batch W16-B6):
//
//  A. Published configuration. The existing published, versioned reflex document
//     (`REFLEX_KIND`, scope `reflexScopeForTenant(tenant)`, one coherent
//     publication set — the same place the journey thresholds live, ruling R32(1),
//     no fourth kind) may carry a `continuity` block:
//        { mode: 'direct' | 'broker', windowMs: <finite, > 0>,
//          purpose: <non-empty string>, retentionApproved: true }
//     COMPLETE means all four, a finite positive window and retentionApproved
//     exactly true. Anything else — absent block, missing member, zero or
//     non-finite window, approval not true — leaves continuity DISABLED.
//
//  B. The session route reports the continuity decision. `POST
//     /v1/:tenant/identity/session` (the route the SDK already calls on every
//     page load) answers `{ ok: true, session, continuity }` where `continuity`
//     is exactly one of:
//        { enabled: false, reason: 'unpublished' }   no continuity block
//        { enabled: false, reason: 'incomplete'  }   published but not complete
//        { enabled: false, reason: 'consent'     }   enabled, but this shopper has
//                                                    no current explicit consent
//        { enabled: true, mode, purpose, generation, expiresAt, revision, proof? }
//     `proof` is present ONLY in direct mode. In broker mode the long proof is
//     delivered only as a `Set-Cookie` named `opt_shopper_continuity` carrying
//     `HttpOnly`, `Secure`, `SameSite` and `Path=/`, and the JSON body carries no
//     proof at all. `generation` is 1 for the first descriptor of a chain and one
//     more per consume. `expiresAt` is the descriptor's ORIGINAL FIXED EXPIRY —
//     the issue time plus `windowMs` — and never moves, not on rotation, not on
//     browsing, not on renewal. `revision` is the published reflex document
//     revision the descriptor is bound to (the number the decision snapshot
//     already reports as `sources.config.revision`).
//
//  C. Consume. `POST /v1/:tenant/identity/session` with NO `X-Shopper-Session`
//     header and the proof presented — direct mode in the body as
//     `{ continuity: { proof, operationId } }`, broker mode as the
//     `opt_shopper_continuity` cookie with `{ continuity: { operationId } }` —
//     atomically consumes the descriptor, rotates to the next generation and
//     answers a FRESH ORDINARY `ss1` for the same physical subject. A proof that
//     is absent, unknown, tampered, retired, expired, for another tenant, for
//     another transport mode or for another configuration revision yields a COLD
//     SHOPPER: a brand-new anonymous subject who has made no explicit choice yet
//     (`continuity = { enabled: false, reason: 'consent' }`) and is served the
//     catalogue's own order, with nobody's remembered taste.
//
//  D. Lost response. The EXACT retry — same proof and same `operationId` — is
//     answered once from one deterministic successor receipt, with the same
//     subject, the same generation and the same successor proof. A different
//     `operationId`, and a second exact retry, are cold.
//
//  E. Persistence. The object persists, under storage keys beginning with
//     `continuity`, `{ generation, digest, expiresAt, … }` where `digest` is the
//     lowercase hex SHA-256 of the exact current proof string (the digest form
//     this codebase already uses, `src/identity/erase.ts:279`). The raw proof and
//     its signature segment appear in NO durable object record, NO ordinary
//     envelope (`/realtime/reflex`, `/realtime/action`, the decisions snapshot,
//     the session analytics) and NO response header other than the ruled broker
//     cookie.
//
//  F. Retirement. Logout/detach (`POST /v1/:tenant/identity/detach`, the logout
//     this codebase ships, `src/routes/identity.ts:5`), reset (`POST
//     /realtime/session/reset`), link (`POST /v1/:tenant/identity/link`) and
//     erase (`POST /v1/:tenant/identity/erase`) each retire the descriptor.
//
//  G. Alarm. The object schedules its alarm at or before the descriptor's
//     original expiry, and running the alarm after that expiry removes the
//     record without extending any lifetime.
//
//  H. SDK transport. In direct mode the real `src/sdk` entry keeps the proof in
//     tenant-scoped storage under
//     `opt_shopper_continuity:<endpoint>:<tenant>` (the key convention the
//     capability already uses, `src/sdk/core.ts:141`) and presents it on the next
//     session request when it holds no current capability. In broker mode
//     (`sessionBroker` configured) the SDK stores no proof and sends none: it
//     receives only the short session capability.
//
// The host legs drive the real mounted app and the real ShopperReflex class in
// process on BOTH hosts, in the pattern of `src/units/W16/C2.unit.test.ts`; that
// suite is never imported and never edited. Legs named `host-internal` (R19)
// invoke the object in its real owner context because no public route exposes
// durable-object storage or the alarm; each such unit's row names the missing
// public observable as its residual.
//
// BUILD REQUIREMENTS the implementer and the reviewer must both see (ruling R48(b)):
//  1. The published reflex document's validator (`validateReflexConfig`,
//     `src/reflex/configStore.ts:234`, which W16-B4 extends for the `journey`
//     block) must ADMIT the `continuity` block described above. If it refuses or
//     strips it, every unit in this file fails at fixture publication rather than
//     on the behavior it measures.
//  2. `ShopperReflex` enforces an allow-list of its own storage keys
//     (`['affinity','pipeline','audienceOwner','consent']` at
//     `src/durable-objects/ShopperReflex.ts:1759`, `:2028`, `:2288`, `:2729`).
//     The continuity records must be admitted there BY EXACT KEY — the allow-list
//     is widened, never loosened into a prefix or a wildcard.
//
// LIMITS OF THIS FILE, named so the whole-W review can own them (ruling R48(c)):
//  - The C6 text says the raw proof appears in no DO state, log, evidence, HTML
//    or ordinary envelope. This file scans the object's whole stored state, four
//    ordinary envelopes and the issuance response headers. It does NOT scan the
//    worker's logs, the evidence directory or rendered HTML: those three surfaces
//    are a named residual on W16.C6.02 for the whole-W review.
//  - Durable-object atomicity, restart and alarm are measured here against the
//    fixture's hand-written storage/namespace doubles (no conflict detection, no
//    input gating), so units .02, .08 and .11 are STRICTER than workerd but are
//    not evidence of real Durable Object behavior. A Miniflare/native leg
//    (`src/index.api-boundary.test.ts` pattern, METHOD §3) is the named residual
//    on those three units.
//  - On the session host the shopper's retained taste lives in the KV session
//    record, which production expires after `SESSION_TTL_SECONDS` = 30 days
//    (`src/services/SessionManager.ts:89`). The fixture's KV does not simulate
//    expiry, so a return measured here inside fourteen days is covered by that
//    retention in production, while a published continuity window longer than the
//    record's own retention is an owner decision this batch does not specify.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { identityRoutes } from '@/routes/identity';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { SHOPPER_HEADER, SHOPPER_MAX_AGE } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent } from '@/content/consent';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant, invalidateConfigCache } from '@/reflex/configStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { initializePublicationSet, pinPublication, publishSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { configuredDestinations } from '@/connectors/config';
import { signAssertion } from '@/identity/assertion';
import { memoryStore } from '@/auth/store';
import type { RetentionCategory, RetentionPolicy } from '@/retention';
import { createCore } from '@/sdk/core';
import { memoryHost } from '@/sdk/memoryHost';
import { authorityLocks } from '@/sdk/testHost';

// ---------------------------------------------------------------------------
// The ruled names and values of this batch.
// ---------------------------------------------------------------------------

const TENANT = 'meridian';
/** A second provisioned tenant, so a proof can be presented where it does not belong. */
const OTHER_TENANT = 'coach';
const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = 1_725_000_000_000;
/** One interaction apart, well inside the visit. */
const STEP_MS = 60_000;

/**
 * The synthetic continuity configuration this fixture publishes. It is a test
 * document, not a shipped default and not a customer's approved window: the
 * production mode, window, purpose and covered-purpose retention approval are
 * the open owner decision in HANDOFF §8 and stay absent from the product.
 */
const WINDOW_MS = 30 * DAY_MS;
const PURPOSE = 'w16-b6-return-recognition';
const CONTINUITY_DIRECT = { mode: 'direct', windowMs: WINDOW_MS, purpose: PURPOSE, retentionApproved: true };
const CONTINUITY_BROKER = { mode: 'broker', windowMs: WINDOW_MS, purpose: PURPOSE, retentionApproved: true };
/**
 * Shorter published windows, so a unit that measures the END of a descriptor's
 * life does it while the shopper's 30-day explicit choice is still current and
 * her retained taste is untouched: the refusal can then only be the descriptor's
 * own fixed expiry.
 */
const CONTINUITY_SHORT = { mode: 'direct', windowMs: 10 * DAY_MS, purpose: PURPOSE, retentionApproved: true };
const CONTINUITY_ALARM = { mode: 'direct', windowMs: 6 * 60 * 60 * 1000, purpose: PURPOSE, retentionApproved: true };
/** Every way a published block can fail to be a complete, finite, approved configuration. */
const INCOMPLETE_CONTINUITY: Array<[string, Record<string, unknown>]> = [
  ['no transport mode', { windowMs: WINDOW_MS, purpose: PURPOSE, retentionApproved: true }],
  ['no window', { mode: 'direct', purpose: PURPOSE, retentionApproved: true }],
  ['a zero window', { mode: 'direct', windowMs: 0, purpose: PURPOSE, retentionApproved: true }],
  ['a window that is not a finite number', { mode: 'direct', windowMs: null, purpose: PURPOSE, retentionApproved: true }],
  ['no covered purpose', { mode: 'direct', windowMs: WINDOW_MS, retentionApproved: true }],
  ['an empty covered purpose', { mode: 'direct', windowMs: WINDOW_MS, purpose: '', retentionApproved: true }],
  ['no retention approval', { mode: 'direct', windowMs: WINDOW_MS, purpose: PURPOSE }],
  ['a withheld retention approval', { mode: 'direct', windowMs: WINDOW_MS, purpose: PURPOSE, retentionApproved: false }],
  ['a transport mode outside the vocabulary', { mode: 'fingerprint', windowMs: WINDOW_MS, purpose: PURPOSE, retentionApproved: true }],
];

/** Ruled member: the broker-mode cookie that carries the long proof. */
const CONTINUITY_COOKIE = 'opt_shopper_continuity';
/** Ruled member: the durable-object storage keys that hold the descriptor state. */
const CONTINUITY_KEY_PREFIX = 'continuity';
/** Ruled member: the SDK's tenant-scoped direct-mode store (`src/sdk/core.ts:141` convention). */
const sdkContinuityKey = (endpoint: string, tenant: string) =>
  `opt_shopper_continuity:${encodeURIComponent(endpoint)}:${encodeURIComponent(tenant)}`;

/** The digest form this codebase already uses for stored proofs (`src/identity/erase.ts:279`). */
async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Customer-shaped fixtures: Coach's own taxonomy (Handbags, Small Leather Goods,
// Accessories — HANDOFF §5 C8), with a cross-category view and a line nobody
// recognizes in the same visit, because unknown inputs are part of the fixture.
// The event shapes are the storefront's (docs/kit/03-payload-schemas.md) and are
// the same shapes unit W16.C8.01 uses, so two units never demand two
// representations of one fixture.
// ---------------------------------------------------------------------------

const pdpView = (line: string, category: string, productId: string, priceUsd: number) =>
  ({ type: 'product_view', data: { productId, line, category, price_usd: priceUsd } });

/** Three views of one line, so a returning shopper has one unambiguous leading interest… */
const THREE_TABBY_VIEWS = [
  pdpView('Tabby', 'Handbags', 'CH-TABBY-26', 395),
  pdpView('Tabby', 'Handbags', 'CH-TABBY-32', 450),
  pdpView('Tabby', 'Handbags', 'CH-TABBY-SHOULDER', 425),
];
/** …beside one cross-category interaction and one line the taxonomy does not know. */
const OTHER_VIEWS = [
  pdpView('Wyn', 'Small Leather Goods', 'CH-WYN-WALLET', 150),
  pdpView('not-a-coach-line', 'Accessories', 'CH-UNKNOWN-1', 95),
];
const HER_VISIT = [...THREE_TABBY_VIEWS, ...OTHER_VIEWS];

/** The catalogue's own order puts Rogue first; only her remembered taste moves Tabby in front. */
const ROGUE = 'rogue-editorial';
const TABBY = 'tabby-editorial';
/** What the fixture publishes for /home: one hero slot, take 1. */
const HOME_DECISIONS = 1;

// ---------------------------------------------------------------------------
// Host fixture — the real app, the real SessionManager path and the real
// ShopperReflex class, one construction per host. Pattern reused from
// `src/units/W16/C2.unit.test.ts`.
// ---------------------------------------------------------------------------

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b6-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  data = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.data.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.data.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

/**
 * Two live editorial pieces on one hero slot, take 1. Rogue is FIRST in the
 * catalogue, so catalogue order alone serves Rogue and only a shopper's own
 * remembered interest puts Tabby in front of it.
 */
const documentChanges = (tenant: string): PublicationBaseline[] => [
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b6-fixture', note: '', value: { pieces: [
    { id: ROGUE, customerContentId: 'cms-rogue', type: 'editorial', title: 'Rogue', tags: { line: ['Rogue'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
    { id: TABBY, customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby', tags: { line: ['Tabby'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  ] } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b6-fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } } } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b6-fixture', note: '', value: {
    holdout: { share: 0, salt: 'w16-b6', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];

/** A fourteen-day memory horizon, published as customer-neutral fixture data (R32(4)). */
const reflexDocument = (continuity: unknown | null, version = 'w16-b6-fixture') => ({
  ...DEFAULT_REFLEX_CONFIG, version, tauMs: 14 * DAY_MS, eventAttributes: 'event-when-unknown' as const,
  ...(continuity === null ? {} : { continuity }),
});

function boundary(host: 'session' | 'do') {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w16-b6-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    IDENTITY_SECRETS: `${TENANT}:backend-proof,${OTHER_TENANT}:backend-proof`,
    TENANTS: JSON.stringify({ provisioned: [OTHER_TENANT, TENANT], operatorGrants: { 'w16-b6-operator': [OTHER_TENANT, TENANT] } }),
    ACCOUNTS: memoryStore(),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
  } as unknown as Env;
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories([OTHER_TENANT, TENANT]) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* the fixture reports no destination diagnostics */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  const construct = (name: string) => {
    const data = new Map<string, unknown>();
    const alarms: number[] = [], sockets: WebSocket[] = [];
    const storage = {
      get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
      put: async (k: string | Record<string, unknown>, v?: unknown) => {
        if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
      },
      list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
        structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
          .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
      transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
        const candidate = structuredClone(data);
        let deleteAlarm = false, nextAlarm: number | undefined;
        const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
          delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
          put: async (values: string | Record<string, unknown>, value?: unknown) => {
            if (typeof values === 'string') candidate.set(values, structuredClone(value));
            else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
          },
          deleteAlarm: async () => { deleteAlarm = true; },
          setAlarm: async (at: number) => { nextAlarm = at; },
        } as unknown as DurableObjectTransaction;
        const result = await run(tx);
        data.clear(); for (const [key, value] of candidate) data.set(key, value);
        if (deleteAlarm) alarms.length = 0;
        if (nextAlarm !== undefined) alarms.push(nextAlarm);
        return result;
      },
      deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
      setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
    };
    const state = { id: name, storage, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
    return { data, state, alarms, sockets, shopper: new ShopperReflex(state, env) };
  };
  const ns = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = objects.get(name);
      if (!item) { item = construct(name); objects.set(name, item); }
      return item.shopper.fetch(new Request(input, init));
    } }),
  };
  env.SHOPPER_REFLEX = ns as unknown as DurableObjectNamespace;
  const app = new Hono<{ Bindings: Env }>();
  // R19: the routes production serves, mounted as `src/index.ts` mounts them.
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes); app.route('/v1', identityRoutes);
  const call = async (path: string, options: { capability?: string; body?: unknown; tenant?: string; headers?: Record<string, string>; method?: string } = {}) => {
    await configureRetention();
    const tenant = options.tenant ?? TENANT;
    const request = new Request(`https://synthetic.invalid${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { 'X-Tenant': tenant, ...(options.capability === undefined ? {} : { [SHOPPER_HEADER]: options.capability }),
        'Content-Type': 'application/json', ...options.headers },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* the fixture never passes through */ }, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  /** A cold start of the shopper's own object over the same durable storage. */
  const restart = (subject: string, tenant = TENANT) => {
    const name = shopperObjectName(tenant, subject), item = objects.get(name);
    if (!item) throw new Error(`no object for ${name}`);
    objects.set(name, { ...item, shopper: new ShopperReflex(item.state, env) });
  };
  return { env, app, cache, sessions, objects, call, drain, restart, configureRetention };
}

// ---------------------------------------------------------------------------
// What the ruled contract puts on the wire.
// ---------------------------------------------------------------------------

interface ContinuityReport {
  enabled?: unknown; reason?: unknown; mode?: unknown; purpose?: unknown;
  generation?: unknown; expiresAt?: unknown; revision?: unknown; proof?: unknown;
}
interface SessionAnswer {
  status: number;
  ok: unknown;
  subject: string;
  sessionId: string;
  kind: unknown;
  capability: string;
  iat: number;
  exp: number;
  continuity: ContinuityReport | undefined;
  cookies: string[];
  /** Every header the answer carried, as one text, for the raw-proof scan. */
  headerText: string;
  bodyText: string;
}
interface SnapshotAnswer { status: number; ok: unknown; state: unknown; decisions: unknown; first: unknown; revision: unknown }

const setCookies = (response: Response): string[] => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = response.headers.get('set-cookie');
  return single === null ? [] : [single];
};
const cookieValue = (cookies: string[], name: string): string | undefined => {
  for (const cookie of cookies) {
    const match = new RegExp(`^${name}=([^;]*)`).exec(cookie.trim());
    if (match) return match[1];
  }
  return undefined;
};
/** The claims a shopper capability carries, read without a verifier so an expired one can be read too. */
const claimsOf = (capability: string) => JSON.parse(
  new TextDecoder().decode(Uint8Array.from(atob(capability.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))),
) as { tenant: string; subject: string; sessionId: string; kind: string; grantId?: string; authorityEpoch?: string; iat: number; exp: number };

/**
 * Where a needle is visible. Every absence claim below is paired with a control
 * source that DOES contain the needle, so the scan is proven to have teeth
 * instead of being assumed.
 */
const sightings = (sources: Array<{ name: string; text: string }>, needle: string): string[] =>
  sources.filter(source => source.text.includes(needle)).map(source => source.name);

// ---------------------------------------------------------------------------

interface Shopper {
  subject: string;
  sessionId: string;
  capability: string;
  issued: SessionAnswer;
  continuity: ContinuityReport;
  /** The direct-mode proof, or the broker-mode cookie's value. */
  proof: string;
  /** When the descriptor was issued: its original fixed expiry is this plus the published window. */
  issuedAt: number;
  /** That original fixed expiry, which nothing may move. */
  expiresAt: number;
}

async function hostFixture(host: 'session' | 'do', continuity: unknown | null = CONTINUITY_DIRECT) {
  invalidateCache(); invalidateLiftCache(); invalidateConfigCache();
  const publishedWindowMs = typeof (continuity as { windowMs?: unknown } | null)?.windowMs === 'number'
    ? (continuity as { windowMs: number }).windowMs : WINDOW_MS;
  const f = boundary(host);
  const document = reflexDocument(continuity);
  for (const tenant of [TENANT, OTHER_TENANT]) {
    const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
      ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b6-fixture', note: '', value } });
    const changes = documentChanges(tenant);
    await initializePublicationSet(f.env, [baseline(REFLEX_KIND, document, reflexScopeForTenant(tenant)),
      ...[baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }),
        baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b6', arms: ['default'] } })]
        .map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base)],
      '0:' + crypto.randomUUID());
  }
  invalidateCache(); invalidateConfigCache();

  const operator = await new jose.SignJWT({ type: 'service', roles: ['admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('w16-b6-operator').setIssuedAt().setIssuer('i').setAudience('a')
    .setExpirationTime('30m').sign(new TextEncoder().encode('w16-b6-synthetic-signing-material-only'));

  /** `POST /v1/:tenant/identity/session` — establish, refresh, or consume a descriptor. */
  const identitySession = async (options: {
    capability?: string; proof?: string; operationId?: string; cookie?: string; tenant?: string; consent?: unknown;
  } = {}): Promise<SessionAnswer> => {
    const body: Record<string, unknown> = {};
    if (options.consent !== undefined) body.consent = options.consent;
    if (options.proof !== undefined || options.operationId !== undefined) {
      body.continuity = { ...(options.proof === undefined ? {} : { proof: options.proof }),
        ...(options.operationId === undefined ? {} : { operationId: options.operationId }) };
    }
    const response = await f.call(`/v1/${options.tenant ?? TENANT}/identity/session`, {
      body, tenant: options.tenant ?? TENANT,
      ...(options.capability === undefined ? {} : { capability: options.capability }),
      ...(options.cookie === undefined ? {} : { headers: { Cookie: options.cookie } }),
    });
    const bodyText = await response.clone().text();
    const parsed = (() => { try { return JSON.parse(bodyText) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })();
    const session = (parsed.session ?? {}) as Record<string, unknown>;
    await f.drain();
    return {
      status: response.status, ok: parsed.ok,
      subject: String(session.subject ?? ''), sessionId: String(session.sessionId ?? ''), kind: session.kind,
      capability: String(session.capability ?? ''), iat: Number(session.iat), exp: Number(session.exp),
      continuity: parsed.continuity as ContinuityReport | undefined,
      cookies: setCookies(response),
      headerText: [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n'),
      bodyText,
    };
  };

  const choose = async (session: { subject: string; sessionId: string; capability: string }, on = true) => {
    const current = f.objects.get(shopperObjectName(TENANT, session.subject))?.data.get('consent');
    const claims = claimsOf(session.capability);
    const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
      grantId: claims.grantId, iat: claims.iat, exp: claims.exp };
    const response = await f.call(`/realtime/session/${session.sessionId}/preferences`, {
      capability: session.capability, body: { trackingConsent: on, personalizationEnabled: on, choice },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    await f.drain();
  };

  const action = async (capability: string, event: { type: string; data: Record<string, unknown> }) => {
    const claims = claimsOf(capability);
    const response = await f.call('/realtime/action', { capability, body: {
      ...event, source: 'sdk', userId: claims.subject, sessionId: claims.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(),
    } });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text };
  };

  const browse = async (capability: string, events = HER_VISIT, clock?: { mockReturnValue: (at: number) => unknown }, from = Date.now()) => {
    for (const [index, event] of events.entries()) {
      clock?.mockReturnValue(from + index * STEP_MS);
      const answered = await action(capability, event);
      expect(answered.status, `the fixture's own browsing must be accepted: ${JSON.stringify(event)} → ${answered.text}`).toBe(200);
    }
    clock?.mockReturnValue(from + (events.length - 1) * STEP_MS);
  };

  const snapshot = async (capability: string): Promise<SnapshotAnswer> => {
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot?page=home`, { capability });
    const body = await response.clone().json().catch(() => ({})) as
      { ok?: unknown; decisions?: Array<{ contentId?: unknown }>; sources?: { state?: unknown; config?: { revision?: unknown } } };
    await f.drain();
    return { status: response.status, ok: body.ok, state: body.sources?.state, decisions: body.decisions?.length,
      first: body.decisions?.[0]?.contentId, revision: body.sources?.config?.revision };
  };

  const hydrate = async (capability: string) => {
    const response = await f.call('/realtime/reflex', { capability });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text, body: (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; } })() };
  };

  const analytics = async (capability: string) => {
    const response = await f.call(`/realtime/session/${claimsOf(capability).sessionId}/analytics`, { capability });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text };
  };

  /** The published reflex document revision the descriptor binds to. */
  const reflexRevision = async (): Promise<number> =>
    (await pinPublication(f.env, TENANT)).refs[REFLEX_KIND.name + ':' + reflexScopeForTenant(TENANT)]!.revision;

  /** Publish the next revision of the reflex document (the continuity block lives on it). */
  const publishReflex = async (block: unknown | null, version = 'w16-b6-fixture') => {
    const scope = reflexScopeForTenant(TENANT);
    const pin = await pinPublication(f.env, TENANT);
    const revision = pin.refs[REFLEX_KIND.name + ':' + scope]!.revision;
    const value = reflexDocument(block, version);
    const result = await publishSet(f.env, [{ kind: REFLEX_KIND, scope, request: value, candidate: () => value }],
      { actor: 'w16-b6-fixture', expectedRevision: revision, expectedPublication: { revision: pin.revision, digest: pin.digest },
        operationId: revision + ':' + crypto.randomUUID() }) as { ok: boolean; errors?: string[] };
    expect(result.ok, `the fixture's own republication must succeed: ${JSON.stringify(result.errors ?? [])}`).toBe(true);
    invalidateCache(); invalidateConfigCache(); invalidateLiftCache();
  };

  /** Establish a shopper, take her explicit choice, browse, and read her descriptor. */
  const newShopper = async (options: { browse?: boolean; clock?: { mockReturnValue: (at: number) => unknown }; events?: typeof HER_VISIT } = {}): Promise<Shopper> => {
    const established = await identitySession({});
    expect(established.status, `the fixture's own establish must succeed: ${established.bodyText}`).toBe(200);
    await choose(established);
    if (options.browse) await browse(established.capability, options.events ?? HER_VISIT, options.clock);
    const issuedAt = Date.now();
    const issued = await identitySession({ capability: established.capability });
    expect(issued.status, `the fixture's own refresh must succeed: ${issued.bodyText}`).toBe(200);
    const report = (issued.continuity ?? {}) as ContinuityReport;
    const proof = typeof report.proof === 'string' ? report.proof : cookieValue(issued.cookies, CONTINUITY_COOKIE) ?? '';
    return { subject: established.subject, sessionId: established.sessionId, capability: established.capability,
      issued, continuity: report, proof, issuedAt, expiresAt: issuedAt + publishedWindowMs };
  };

  const objectData = (subject: string) => f.objects.get(shopperObjectName(TENANT, subject))?.data ?? new Map<string, unknown>();
  const continuityRecords = (subject: string) => [...objectData(subject)].filter(([key]) => key.startsWith(CONTINUITY_KEY_PREFIX));
  /** The alarm the object holds NOW: the last one set, which is what getAlarm returns. */
  const currentAlarm = (subject: string) => f.objects.get(shopperObjectName(TENANT, subject))?.alarms.at(-1) ?? -1;
  const runAlarm = async (subject: string) => {
    await f.objects.get(shopperObjectName(TENANT, subject))!.shopper.alarm();
    await f.drain();
  };

  return { f, host, publishedWindowMs, identitySession, choose, action, browse, snapshot, hydrate, analytics,
    reflexRevision, publishReflex, newShopper, objectData, continuityRecords, currentAlarm, runAlarm, operator };
}

type HostFixture = Awaited<ReturnType<typeof hostFixture>>;

/**
 * A cold shopper: the engine recognized nobody. She is a brand-new anonymous
 * subject, and the page she is served is the catalogue's own order — nobody's
 * remembered taste. The gates are ordered: an incomplete or absent published
 * configuration is reported before anything about this shopper, and under a
 * complete configuration a brand-new shopper has simply made no explicit choice
 * yet, so the report is the consent reason.
 */
async function expectCold(h: HostFixture, answer: SessionAnswer, why: string,
  reason: 'unpublished' | 'incomplete' | 'consent' = 'consent'): Promise<void> {
  expect(answer.status, why).toBe(200);
  expect(answer.ok, why).toBe(true);
  expect(answer.kind, why).toBe('anonymous');
  expect(answer.subject, why).toMatch(/^vis-[0-9a-f-]{36}$/);
  expect(answer.continuity, why).toEqual({ enabled: false, reason });
  expect(await h.snapshot(answer.capability), `${why} — and she is served the catalogue's own order`)
    .toMatchObject({ status: 200, ok: true, decisions: HOME_DECISIONS, first: ROGUE });
}

/** The descriptor a complete published configuration issues, as the contract states it. */
const issuedReport = (mode: 'direct' | 'broker', generation: number, expiresAt: number, revision: number, proof: boolean) => ({
  enabled: true, mode, purpose: PURPOSE, generation, expiresAt, revision,
  ...(proof ? { proof: expect.any(String) as unknown as string } : {}),
});

// ---------------------------------------------------------------------------

describe('unit:W16.C6.01', () => {
  it('host: with no published continuity mode/window/purpose no recognition descriptor is issued and a return after capability expiry is a cold shopper, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        // The positive control first: a COMPLETE published configuration is what
        // switches continuity on, so the disabled cases below mean something.
        const on = await hostFixture(host, CONTINUITY_DIRECT);
        const enabled = await on.newShopper();
        expect(enabled.continuity, `${host}: a complete published continuity configuration issues the recognition descriptor`)
          .toEqual(issuedReport('direct', 1, enabled.expiresAt, await on.reflexRevision(), true));

        // The shipped document: no continuity block at all (HANDOFF §8 — the
        // production mode, window and purpose approval stay absent).
        clock.mockReturnValue(T0);
        const off = await hostFixture(host, null);
        const cold = await off.newShopper({ browse: true, clock });
        expect(cold.continuity, `${host}: an engine with no published continuity issues nothing`)
          .toEqual({ enabled: false, reason: 'unpublished' });

        // Her capability is long expired seven days later, and there is nothing
        // to present: the return is a cold shopper, not a recognized one.
        clock.mockReturnValue(T0 + 7 * DAY_MS);
        await expectCold(off, await off.identitySession({}), `${host}: a return after capability expiry with continuity unpublished`, 'unpublished');

        // Every incomplete published block stays closed the same way.
        for (const [why, block] of INCOMPLETE_CONTINUITY) {
          clock.mockReturnValue(T0);
          const partial = await hostFixture(host, block);
          const shopper = await partial.newShopper();
          expect(shopper.continuity, `${host}: a continuity configuration with ${why} is not a published configuration`)
            .toEqual({ enabled: false, reason: 'incomplete' });
          clock.mockReturnValue(T0 + 7 * DAY_MS);
          await expectCold(partial, await partial.identitySession({}), `${host}: a return under a configuration with ${why}`, 'incomplete');
        }
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.02', () => {
  it('host: the descriptor is a separate signed credential bound to purpose, transport mode, tenant, subject, generation, consent, configuration revision and one fixed original expiry, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, CONTINUITY_DIRECT);
        const revision = await h.reflexRevision();
        const her = await h.newShopper({ browse: true, clock });

        // Every binding the C6 text names, as the route reports it.
        expect(her.continuity, `${host}: the issued descriptor names its purpose, mode, generation, fixed expiry and configuration revision`)
          .toEqual(issuedReport('direct', 1, her.expiresAt, revision, true));
        expect(her.proof.length, `${host}: the proof is a long bearer, not an identifier`).toBeGreaterThanOrEqual(32);
        expect(her.proof, `${host}: the proof is one opaque token`).toMatch(/^[A-Za-z0-9_.-]{32,1024}$/);

        // It is a SEPARATE credential (HANDOFF §12): it is not a session
        // capability, and a session capability is not a recognition proof.
        expect((await h.hydrate(her.proof)).status, `${host}: a recognition proof is not accepted as a session capability`).toBe(401);
        clock.mockReturnValue(T0 + 7 * DAY_MS);
        await expectCold(h, await h.identitySession({ proof: her.capability, operationId: crypto.randomUUID() }),
          `${host}: a session capability presented as a recognition proof`);

        // Bound to this tenant: the other provisioned tenant publishes the same
        // complete configuration and still recognizes nobody from this token.
        const foreign = await h.identitySession({ proof: her.proof, operationId: crypto.randomUUID(), tenant: OTHER_TENANT });
        expect(foreign.status, `${host}: the other tenant answers → ${foreign.bodyText}`).toBe(200);
        expect(claimsOf(foreign.capability).tenant, `${host}: the other tenant answers only for itself`).toBe(OTHER_TENANT);
        expect(foreign.subject, `${host}: with a brand-new anonymous subject of its own`).toMatch(/^vis-[0-9a-f-]{36}$/);
        expect(foreign.continuity, `${host}: and no recognition of another tenant's descriptor`)
          .toEqual({ enabled: false, reason: 'consent' });

        // Bound to this exact signed token.
        const tampered = her.proof.slice(0, -1) + (her.proof.endsWith('A') ? 'B' : 'A');
        await expectCold(h, await h.identitySession({ proof: tampered, operationId: crypto.randomUUID() }),
          `${host}: a tampered descriptor`);

        // Bound to the physical subject: the genuine token still recognizes her.
        const returned = await h.identitySession({ proof: her.proof, operationId: crypto.randomUUID() });
        expect(returned.subject, `${host}: the descriptor names the physical subject it was issued to`).toBe(her.subject);
      }
    } finally { clock.mockRestore(); }
  });

  it('host-internal: only the descriptor digest, generation and fixed expiry are persisted — the raw proof is in no object record, no ordinary envelope and no header', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, CONTINUITY_DIRECT);
        const revision = await h.reflexRevision();
        const her = await h.newShopper({ browse: true, clock });
        clock.mockReturnValue(T0);

        // R19: durable-object storage is exposed by no public route, so this leg
        // runs in process against the real object the request path just used.
        // The record is found by the digest it must hold, not by its position.
        const digest = await sha256Hex(her.proof);
        const holding = h.continuityRecords(her.subject).filter(([, value]) => JSON.stringify(value ?? null).includes(digest));
        expect(holding.length, `${host}: exactly one persisted '${CONTINUITY_KEY_PREFIX}…' record holds this descriptor's digest`).toBe(1);
        expect(holding[0]![1], `${host}: it keeps the digest, the generation and the original fixed expiry`)
          .toMatchObject({ generation: 1, digest, expiresAt: her.expiresAt });

        // Ordinary envelopes and the object's whole state, as text.
        const hydrated = await h.hydrate(her.capability);
        const acted = await h.action(her.capability, pdpView('Tabby', 'Handbags', 'CH-TABBY-26', 395));
        const snapshotted = await h.snapshot(her.capability);
        const analytics = await h.analytics(her.capability);
        const sources = [
          ...[...h.objectData(her.subject)].map(([key, value]) => ({ name: `object record ${key}`, text: JSON.stringify(value ?? null) })),
          { name: 'hydrate envelope', text: hydrated.text },
          { name: 'action envelope', text: acted.text },
          { name: 'snapshot envelope', text: JSON.stringify(snapshotted) },
          { name: 'analytics envelope', text: analytics.text },
          { name: 'issuance response headers', text: her.issued.headerText },
        ];
        // The scan is proven to have teeth before it is used to claim absence.
        const signature = her.proof.split('.').at(-1)!;
        for (const needle of [her.proof, signature]) {
          expect(sightings([...sources, { name: 'control', text: needle }], needle),
            `${host}: the scan detects the raw proof when it is present`).toEqual(['control']);
        }
        expect(sightings(sources, her.proof),
          `${host}: the raw recognition proof is persisted in no object record and appears in no ordinary envelope or header`).toEqual([]);
        expect(sightings(sources, signature),
          `${host}: neither is the signature that makes it a bearer`).toEqual([]);
        // …while the digest the object is allowed to keep IS there: the same scan
        // machinery, so the absence above is a measurement and not an accident.
        expect(sightings(sources, digest).length,
          `${host}: the digest the object may keep is visible to the same scan`).toBeGreaterThan(0);
        expect(snapshotted.revision, `${host}: the revision the descriptor binds to is the published reflex revision`).toBe(revision);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.03', () => {
  it('host: presenting a valid descriptor after the ss1 expired consumes it, rotates the generation, issues a fresh ordinary ss1, and the predecessor replay is refused, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, CONTINUITY_DIRECT);
        const revision = await h.reflexRevision();
        const her = await h.newShopper({ browse: true, clock });

        // Seven days later the capability is long past SHOPPER_MAX_AGE.
        const day7 = T0 + 7 * DAY_MS;
        clock.mockReturnValue(day7);
        expect((await h.hydrate(her.capability)).status, `${host}: the expired capability is refused, as it must be`).toBe(401);

        const returned = await h.identitySession({ proof: her.proof, operationId: crypto.randomUUID() });
        expect(returned.status, `${host}: ${returned.bodyText}`).toBe(200);
        expect(returned.subject, `${host}: the consume recognizes the same physical subject`).toBe(her.subject);
        expect(returned.continuity, `${host}: the descriptor rotated to the next generation with its original expiry`)
          .toEqual(issuedReport('direct', 2, her.expiresAt, revision, true));

        // A fresh ORDINARY session capability, issued now, that the real routes accept.
        const claims = claimsOf(returned.capability);
        expect(claims.subject, `${host}: the fresh capability is hers`).toBe(her.subject);
        expect(claims.kind, `${host}: and it is an ordinary anonymous capability`).toBe('anonymous');
        expect(claims.iat, `${host}: minted at this return, not extended from the old one`).toBe(Math.floor(day7 / 1000));
        expect(claims.exp - claims.iat, `${host}: within the ordinary bounded bearer lifetime`).toBeLessThanOrEqual(SHOPPER_MAX_AGE);
        expect(claims.exp - claims.iat, `${host}: and a real one`).toBeGreaterThan(0);
        expect((await h.hydrate(returned.capability)).status, `${host}: the fresh capability works on the ordinary routes`).toBe(200);

        // The predecessor is retired: its replay recognizes nobody…
        await expectCold(h, await h.identitySession({ proof: her.proof, operationId: crypto.randomUUID() }),
          `${host}: the consumed predecessor replayed`);
        // …and the successor is the live descriptor of the same chain.
        const next = String((returned.continuity as ContinuityReport).proof);
        clock.mockReturnValue(T0 + 8 * DAY_MS);
        const again = await h.identitySession({ proof: next, operationId: crypto.randomUUID() });
        expect(again.subject, `${host}: the successor recognizes her`).toBe(her.subject);
        expect(again.continuity, `${host}: and rotates once more, on the same fixed expiry`)
          .toEqual(issuedReport('direct', 3, her.expiresAt, revision, true));
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.04', () => {
  it('host: an expired ss1 is never extended — continuity issues a new capability, and the descriptor keeps its original fixed expiry through browsing and renewal, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        // A ten-day published window, so the last step below measures the
        // descriptor's own expiry while her explicit choice is still current.
        const h = await hostFixture(host, CONTINUITY_SHORT);
        const revision = await h.reflexRevision();
        const her = await h.newShopper({ browse: true, clock });
        const originalExpiry = her.expiresAt;
        const firstClaims = claimsOf(her.capability);

        const day2 = T0 + 2 * DAY_MS;
        clock.mockReturnValue(day2);
        const returned = await h.identitySession({ proof: her.proof, operationId: crypto.randomUUID() });
        expect(returned.status, `${host}: ${returned.bodyText}`).toBe(200);

        // The expired bearer stays expired: the continuity answer is a NEW
        // capability, and the old one's own claims are untouched (HANDOFF §12:
        // expired-session extension and activity-renewed lifetime violate W16).
        expect(claimsOf(her.capability).exp, `${host}: the old capability's expiry is exactly what it was`).toBe(firstClaims.exp);
        expect((await h.hydrate(her.capability)).status, `${host}: and it is still refused`).toBe(401);
        const fresh = claimsOf(returned.capability);
        expect(fresh.iat, `${host}: the new capability is minted at this return`).toBe(Math.floor(day2 / 1000));
        expect(fresh.sessionId, `${host}: on a new browsing session of the same subject`).toMatch(/^s-[0-9a-f-]{36}$/);
        expect(fresh.subject, `${host}: continuity answers a new capability for the same physical subject instead of extending the expired one`).toBe(her.subject);

        // Browsing under the new capability does not move the descriptor's
        // original fixed expiry, and neither does asking for it again.
        await h.browse(returned.capability, THREE_TABBY_VIEWS, clock, day2);
        clock.mockReturnValue(day2 + 3 * STEP_MS);
        const renewed = await h.identitySession({ capability: returned.capability });
        expect(renewed.continuity, `${host}: renewal re-reports the same descriptor generation and the same original expiry`)
          .toEqual(issuedReport('direct', 2, originalExpiry, revision, true));

        // …and at the far end of the window the proof is still the same chain on
        // the same expiry, never pushed out by the activity in between.
        clock.mockReturnValue(T0 + 8 * DAY_MS);
        const late = await h.identitySession({ proof: String(renewed.continuity!.proof), operationId: crypto.randomUUID() });
        expect(late.subject, `${host}: she is still recognized inside the published window`).toBe(her.subject);
        expect(late.continuity, `${host}: on the original fixed expiry`)
          .toEqual(issuedReport('direct', 3, originalExpiry, revision, true));

        // Past that fixed expiry the descriptor is over, however much she browsed.
        clock.mockReturnValue(originalExpiry + 1);
        await expectCold(h, await h.identitySession({ proof: String(late.continuity!.proof), operationId: crypto.randomUUID() }),
          `${host}: a descriptor past its original fixed expiry`);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.05', () => {
  it('host: exactly one deterministic lost-response successor receipt — the exact retry is honoured once, a different or second retry is refused, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, CONTINUITY_DIRECT);
        const revision = await h.reflexRevision();
        const her = await h.newShopper({ browse: true, clock });
        const other = await h.newShopper({ browse: true, clock });
        clock.mockReturnValue(T0 + 7 * DAY_MS);

        // The answer the browser never received.
        const operation = crypto.randomUUID();
        const first = await h.identitySession({ proof: her.proof, operationId: operation });
        expect(first.subject, `${host}: the consume recognized her`).toBe(her.subject);
        expect(first.continuity, `${host}: at the next generation`).toEqual(issuedReport('direct', 2, her.expiresAt, revision, true));

        // The exact retry — same proof, same operation — is answered from the one
        // deterministic successor receipt: the same subject, the same generation
        // and the same successor proof, so the browser cannot end up with two.
        const retry = await h.identitySession({ proof: her.proof, operationId: operation });
        expect(retry.subject, `${host}: the exact retry answers the same subject`).toBe(her.subject);
        expect(retry.continuity, `${host}: and the identical successor descriptor`).toEqual(first.continuity);
        expect(claimsOf(retry.capability), `${host}: with the identical session grant, not a second one`).toEqual(claimsOf(first.capability));

        // One receipt, one retry: a second retry is refused.
        await expectCold(h, await h.identitySession({ proof: her.proof, operationId: operation }),
          `${host}: a second retry of the same consume`);

        // A different operation on a consumed proof is a replay, not a retry.
        const consumed = await h.identitySession({ proof: other.proof, operationId: crypto.randomUUID() });
        expect(consumed.subject, `${host}: the second shopper's own consume succeeded`).toBe(other.subject);
        await expectCold(h, await h.identitySession({ proof: other.proof, operationId: crypto.randomUUID() }),
          `${host}: the same proof under a different operation id`);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.06', () => {
  it('host: a descriptor is refused across transport modes and across a configuration revision change, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        // (a) direct mode, then the configuration is republished — same mode, new
        // revision. The descriptor is bound to the revision it was issued under.
        clock.mockReturnValue(T0);
        const direct = await hostFixture(host, CONTINUITY_DIRECT);
        const bound = await direct.newShopper({ browse: true, clock });
        const control = await direct.newShopper({ browse: true, clock });
        clock.mockReturnValue(T0 + 7 * DAY_MS);
        // The control consume under the UNCHANGED revision succeeds, so the
        // refusal below is the revision change and not a broken path.
        expect((await direct.identitySession({ proof: control.proof, operationId: crypto.randomUUID() })).subject,
          `${host}: the same revision still recognizes her`).toBe(control.subject);
        await direct.publishReflex(CONTINUITY_DIRECT, 'w16-b6-fixture-r2');
        expect(await direct.reflexRevision(), `${host}: the fixture published a new configuration revision`).toBeGreaterThan(1);
        await expectCold(direct, await direct.identitySession({ proof: bound.proof, operationId: crypto.randomUUID() }),
          `${host}: a descriptor issued under the previous configuration revision`);

        // (b) direct descriptor, broker mode published: cross-mode reuse refused.
        clock.mockReturnValue(T0);
        const flipped = await hostFixture(host, CONTINUITY_DIRECT);
        const directProof = (await flipped.newShopper({ browse: true, clock })).proof;
        await flipped.publishReflex(CONTINUITY_BROKER, 'w16-b6-fixture-broker');
        clock.mockReturnValue(T0 + 7 * DAY_MS);
        await expectCold(flipped, await flipped.identitySession({ proof: directProof, operationId: crypto.randomUUID() }),
          `${host}: a direct-mode descriptor presented in broker mode`);

        // (c) and the other way round: a broker cookie once direct mode is published.
        clock.mockReturnValue(T0);
        const broker = await hostFixture(host, CONTINUITY_BROKER);
        const brokered = await broker.newShopper({ browse: true, clock });
        expect(brokered.proof.length, `${host}: the broker fixture holds the long proof in its cookie`).toBeGreaterThanOrEqual(32);
        await broker.publishReflex(CONTINUITY_DIRECT, 'w16-b6-fixture-direct');
        clock.mockReturnValue(T0 + 7 * DAY_MS);
        await expectCold(broker, await broker.identitySession({ cookie: `${CONTINUITY_COOKIE}=${brokered.proof}`, operationId: crypto.randomUUID() }),
          `${host}: a broker-mode descriptor presented in direct mode`);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.07', () => {
  it('host: logout/detach, session reset, link and erase each retire the descriptor, and presenting it afterwards yields a cold shopper, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, CONTINUITY_DIRECT);
        const detached = await h.newShopper({ browse: true, clock });
        const reset = await h.newShopper({ browse: true, clock });
        const linked = await h.newShopper({ browse: true, clock });
        const erased = await h.newShopper({ browse: true, clock });
        const kept = await h.newShopper({ browse: true, clock });
        for (const [who, shopper] of [['detach', detached], ['reset', reset], ['link', linked], ['erase', erased], ['no transition', kept]] as const) {
          expect(shopper.continuity, `${host}: the shopper who will go through ${who} holds a recognition descriptor to retire`)
            .toEqual(issuedReport('direct', 1, shopper.expiresAt, await h.reflexRevision(), true));
        }
        clock.mockReturnValue(Date.now() + STEP_MS);

        // Logout is this codebase's detach (src/routes/identity.ts:5).
        const logout = await h.f.call(`/v1/${TENANT}/identity/detach`, { capability: detached.capability, body: { visitorId: detached.subject } });
        expect(logout.status, `${host}: detach → ${await logout.clone().text()}`).toBe(200);

        const cleared = await h.f.call('/realtime/session/reset', { capability: reset.capability, body: {} });
        expect(cleared.status, `${host}: reset → ${await cleared.clone().text()}`).toBe(200);

        const exp = Math.floor(Date.now() / 1000) + 300;
        const assertion = await signAssertion('backend-proof', TENANT, linked.subject, 'coach-account-1', exp);
        const link = await h.f.call(`/v1/${TENANT}/identity/link`, { capability: linked.capability,
          body: { visitorId: linked.subject, accountId: 'coach-account-1', source: 'login', exp, assertion } });
        expect(link.status, `${host}: link → ${await link.clone().text()}`).toBe(200);

        const erase = await h.f.call(`/v1/${TENANT}/identity/erase`, { body: { visitorId: erased.subject },
          headers: { Authorization: `Bearer ${h.operator}` } });
        expect([200, 202], `${host}: erase → ${erase.status} ${await erase.clone().text()}`).toContain(erase.status);
        await h.f.drain();

        clock.mockReturnValue(T0 + 7 * DAY_MS);
        for (const [what, shopper] of [['detach (logout)', detached], ['session reset', reset], ['link', linked], ['erase', erased]] as const) {
          await expectCold(h, await h.identitySession({ proof: shopper.proof, operationId: crypto.randomUUID() }),
            `${host}: the descriptor retired by ${what}`);
        }
        // The shopper who went through none of them still returns: the retirement
        // above is the transitions' doing, not a broken return path.
        const still = await h.identitySession({ proof: kept.proof, operationId: crypto.randomUUID() });
        expect(still.subject, `${host}: a shopper with no transition is still recognized`).toBe(kept.subject);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.08', () => {
  it('host: two concurrent consumes yield one recognition and one refusal, and after an object restart the current generation still consumes exactly once, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, CONTINUITY_DIRECT);
        const revision = await h.reflexRevision();
        const her = await h.newShopper({ browse: true, clock });
        clock.mockReturnValue(T0 + 7 * DAY_MS);

        // Two tabs wake at once with the same stored proof.
        const [a, b] = await Promise.all([
          h.identitySession({ proof: her.proof, operationId: crypto.randomUUID() }),
          h.identitySession({ proof: her.proof, operationId: crypto.randomUUID() }),
        ]);
        const recognized = [a, b].filter(answer => answer.subject === her.subject);
        const refused = [a, b].filter(answer => answer.subject !== her.subject);
        expect(recognized.length, `${host}: exactly one concurrent consume recognizes her`).toBe(1);
        expect(recognized[0]!.continuity, `${host}: at exactly one next generation`)
          .toEqual(issuedReport('direct', 2, her.expiresAt, revision, true));
        expect(refused.length, `${host}: and exactly one is refused`).toBe(1);
        await expectCold(h, refused[0]!, `${host}: the losing concurrent consume`);

        // The object cold-starts; the live generation is the one in storage.
        const live = String(recognized[0]!.continuity!.proof);
        h.f.restart(her.subject);
        clock.mockReturnValue(T0 + 8 * DAY_MS);
        const after = await h.identitySession({ proof: live, operationId: crypto.randomUUID() });
        expect(after.subject, `${host}: after a restart the current generation still recognizes her`).toBe(her.subject);
        expect(after.continuity, `${host}: and rotates exactly once`)
          .toEqual(issuedReport('direct', 3, her.expiresAt, revision, true));
        await expectCold(h, await h.identitySession({ proof: live, operationId: crypto.randomUUID() }),
          `${host}: the same generation presented twice across a restart`);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.09', () => {
  it('host: a descriptor issued under consent is refused after withdrawal, and continuity never restores tracking without a current explicit choice, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, CONTINUITY_DIRECT);
        const revision = await h.reflexRevision();
        const withdrawn = await h.newShopper({ browse: true, clock });
        const consenting = await h.newShopper({ browse: true, clock });
        // Both were issued a descriptor because both had made an explicit choice:
        // the descriptor is bound to the consent it was issued under.
        for (const [who, shopper] of [['the shopper who will withdraw', withdrawn], ['the shopper who will not', consenting]] as const) {
          expect(shopper.continuity, `${host}: a current explicit choice issues the descriptor to ${who}`)
            .toEqual(issuedReport('direct', 1, shopper.expiresAt, revision, true));
        }
        clock.mockReturnValue(Date.now() + STEP_MS);

        // She withdraws her explicit choice.
        await h.choose({ subject: withdrawn.subject, sessionId: withdrawn.sessionId, capability: withdrawn.capability }, false);
        // The engine says so on the spot: no descriptor is issued to a shopper
        // whose consent is not current (HANDOFF §12 — the consent record
        // authorizes no continuity credential of its own).
        const refreshed = await h.identitySession({ capability: withdrawn.capability });
        expect(refreshed.continuity, `${host}: a withdrawn choice issues no recognition descriptor`)
          .toEqual({ enabled: false, reason: 'consent' });

        clock.mockReturnValue(T0 + 7 * DAY_MS);
        await expectCold(h, await h.identitySession({ proof: withdrawn.proof, operationId: crypto.randomUUID() }),
          `${host}: a descriptor issued before the withdrawal`);

        // The consenting shopper is recognized at the same moment, so the refusal
        // above is the withdrawal and not a broken return.
        const returned = await h.identitySession({ proof: consenting.proof, operationId: crypto.randomUUID() });
        expect(returned.subject, `${host}: a current explicit choice still returns`).toBe(consenting.subject);
        expect(returned.continuity, `${host}: with the next generation of her own chain`)
          .toEqual(issuedReport('direct', 2, consenting.expiresAt, revision, true));
        expect((await h.snapshot(returned.capability)).first, `${host}: and her remembered taste ranks for her`).toBe(TABBY);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.10', () => {
  it('host: direct mode keeps the proof in the answer body, broker mode keeps it in a Secure/HttpOnly cookie and gives the body only the short session capability, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const direct = await hostFixture(host, CONTINUITY_DIRECT);
        const directRevision = await direct.reflexRevision();
        const her = await direct.newShopper({ browse: true, clock });
        expect(her.continuity, `${host}: direct mode hands the proof to the caller that will store it`)
          .toEqual(issuedReport('direct', 1, her.expiresAt, directRevision, true));
        const directCookies = her.issued.cookies.map((cookie, index) => ({ name: `Set-Cookie ${index}`, text: cookie }));
        expect(sightings([...directCookies, { name: 'control', text: her.proof }], her.proof),
          `${host}: direct mode sets no cookie carrying the long proof`).toEqual(['control']);

        clock.mockReturnValue(T0);
        const broker = await hostFixture(host, CONTINUITY_BROKER);
        const brokerRevision = await broker.reflexRevision();
        const brokered = await broker.newShopper({ browse: true, clock });
        // The body carries the decision and the short session capability — and,
        // exactly, no proof.
        expect(brokered.issued.continuity, `${host}: broker mode reports the descriptor without the long proof`)
          .toEqual(issuedReport('broker', 1, brokered.expiresAt, brokerRevision, false));
        const cookie = brokered.issued.cookies.find(value => value.startsWith(`${CONTINUITY_COOKIE}=`));
        expect(cookie, `${host}: broker mode delivers the long proof only as the ${CONTINUITY_COOKIE} cookie`).toBeDefined();
        expect(cookie!, `${host}: HttpOnly`).toMatch(/;\s*HttpOnly/i);
        expect(cookie!, `${host}: Secure`).toMatch(/;\s*Secure/i);
        expect(cookie!, `${host}: SameSite`).toMatch(/;\s*SameSite=(Lax|Strict)/i);
        expect(cookie!, `${host}: Path=/`).toMatch(/;\s*Path=\//i);
        expect(brokered.proof.length, `${host}: and the cookie really carries the long proof`).toBeGreaterThanOrEqual(32);
        expect(sightings([{ name: 'body', text: brokered.issued.bodyText }, { name: 'control', text: brokered.proof }], brokered.proof),
          `${host}: the long proof is in no part of the broker answer body`).toEqual(['control']);

        // The cookie alone brings her back; a proof in the body does not.
        clock.mockReturnValue(T0 + 7 * DAY_MS);
        await expectCold(broker, await broker.identitySession({ proof: brokered.proof, operationId: crypto.randomUUID() }),
          `${host}: a broker-mode proof presented in the body`);
        const returned = await broker.identitySession({ cookie: `${CONTINUITY_COOKIE}=${brokered.proof}`, operationId: crypto.randomUUID() });
        expect(returned.subject, `${host}: the broker cookie recognizes her`).toBe(brokered.subject);
        expect(returned.continuity, `${host}: and rotates without ever handing the caller the long proof`)
          .toEqual(issuedReport('broker', 2, brokered.expiresAt, brokerRevision, false));
      }
    } finally { clock.mockRestore(); }
  });

  it('sdk: the real SDK entry keeps a direct-mode proof in tenant-scoped storage and presents it on the next cold start, and in broker mode never holds one', async () => {
    const endpoint = 'https://engine.example';
    const tenant = 'coach';
    const proof = 'w16b6-direct-recognition-proof-0000000000000000.signature-0000000000000000';

    /** A browser whose storage this test can read, the way `memoryHost` is normally driven. */
    const browser = (options: { mode: 'direct' | 'broker'; proofInBody: boolean; lose?: number }) => {
      const store = new Map<string, string>();
      const calls: Array<{ url: string; init?: { body?: string; credentials?: string; headers?: Record<string, string> } }> = [];
      let clock = T0, uuids = 0, sessions = 0, lost = 0;
      const host = memoryHost({
        acquireAuthorityLock: authorityLocks(),
        now: () => clock,
        uuid: () => `0f0f0f0f-1111-4222-8333-${String(++uuids).padStart(12, '0')}`,
        storage: { get: key => store.get(key) ?? null, set: (key, value) => { store.set(key, value); } },
        location: { href: 'https://shop.example/home', host: 'shop.example', hostname: 'shop.example', protocol: 'https:', search: '' },
        referrer: '',
        fetch: async (url, init) => {
          calls.push({ url, init: init as { body?: string; credentials?: string; headers?: Record<string, string> } });
          if (url.endsWith('/identity/session') || url.endsWith('/shopper-broker')) {
            // A lost answer: the consume happened at the engine, the browser
            // never saw the session. The next attempt is a retry of the SAME
            // consume, which the ruled contract answers from one receipt.
            if (lost < (options.lose ?? 0)) { lost += 1; return { ok: false, status: 502, json: async () => ({ ok: false }) }; }
            const n = (++sessions).toString(16).padStart(12, '0');
            const claims = { tenant, subject: `vis-00000000-0000-4000-8000-${n}`, sessionId: `s-00000000-0000-4000-8000-${n}`,
              kind: 'anonymous', grantId: `00000000-0000-4000-8000-${n}`, authorityEpoch: `10000000-0000-4000-8000-${n}`,
              iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 3600 };
            const choice = { value: true, chosenAt: clock, expiresAt: clock + 30 * 86400 * 1000 };
            const session = { ...claims, consent: { tracking: true, personalization: true, instruction: { version: 1, tenant,
              subject: claims.subject, revision: 'w16-b6-explicit', tracking: { ...choice }, personalization: { ...choice } } },
              capability: `ss1.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.AA` };
            return { ok: true, status: 200, json: async () => ({ ok: true, session, continuity: {
              enabled: true, mode: options.mode, purpose: PURPOSE, generation: 1, expiresAt: clock + WINDOW_MS, revision: 1,
              ...(options.proofInBody ? { proof } : {}) } }) };
          }
          return { ok: true, status: 200, json: async () => ({ success: true }) };
        },
      });
      return { host, store, calls, tick: (ms: number) => { clock += ms; } };
    };

    // Direct mode: the tenant-scoped store holds the proof the engine issued…
    const direct = browser({ mode: 'direct', proofInBody: true });
    const core = createCore({ tenant, endpoint }, direct.host);
    expect(await core.ready()).toBe(true);
    expect(direct.store.get(sdkContinuityKey(endpoint, tenant)),
      'W16.C6.10: the direct-mode SDK keeps the recognition proof in its tenant-scoped store').toBe(proof);

    // …and the next cold start, with no capability of its own, presents it —
    // twice here, because the first answer is lost. Both attempts are the SAME
    // consume: the engine answers the second from its one successor receipt
    // (W16.C6.05), which is keyed by the operation id, so the SDK must keep the
    // id beside the proof rather than mint a new one per attempt.
    const returning = browser({ mode: 'direct', proofInBody: true, lose: 1 });
    returning.store.set(sdkContinuityKey(endpoint, tenant), proof);
    const lostAnswer = createCore({ tenant, endpoint }, returning.host);
    expect(await lostAnswer.ready(), 'the lost answer adopts no session').toBe(false);
    const retried = createCore({ tenant, endpoint }, returning.host);
    expect(await retried.ready(), 'the page reloads and the retry adopts the session').toBe(true);
    const presentations = returning.calls.filter(call => call.url.endsWith('/identity/session'))
      .map(call => JSON.parse(call.init?.body ?? '{}') as { continuity?: { proof?: unknown; operationId?: unknown } });
    expect(presentations.length, 'the returning SDK asked twice: the lost answer and its retry').toBe(2);
    for (const [index, presented] of presentations.entries()) {
      expect(presented.continuity?.proof, `W16.C6.10: attempt ${index + 1} presents the stored recognition proof`).toBe(proof);
    }
    expect(presentations[1]!.continuity?.operationId,
      'W16.C6.10: the retry is the same consume, under the operation id the first attempt used')
      .toBe(presentations[0]!.continuity?.operationId);
    expect(String(presentations[0]!.continuity?.operationId), 'which is a uuid the engine can key its one receipt by')
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Broker mode: the long proof stays with the first-party broker. The SDK
    // sends its credentials and holds nothing, even if a broker answers with one.
    const brokered = browser({ mode: 'broker', proofInBody: true });
    const client = createCore({ tenant, endpoint, sessionBroker: '/shopper-broker' }, brokered.host);
    expect(await client.ready()).toBe(true);
    const brokerCall = brokered.calls.find(call => call.url.endsWith('/shopper-broker'));
    expect(brokerCall?.init?.credentials, 'the broker call carries the first-party cookie').toBe('include');
    expect(sightings([...[...brokered.store].map(([key, value]) => ({ name: `storage ${key}`, text: value })),
      ...brokered.calls.map((call, index) => ({ name: `request ${index}`, text: call.init?.body ?? '' })),
      { name: 'control', text: proof }], proof),
    'W16.C6.10: in broker mode the SDK never holds or sends the long proof').toEqual(['control']);
  });
});

describe('unit:W16.C6.11', () => {
  it("host-internal: the object's alarm removes an expired descriptor without extending any lifetime", async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        // A six-hour published window. Every other alarm this object schedules —
        // its 30-day consent deadline, its own decay/retention wake — is far
        // later, so the alarm the object holds NOW, at or before this expiry, can
        // only be the descriptor's own. Six hours also keeps her ordinary
        // capability (SHOPPER_MAX_AGE, 24 h) alive across the cleanup, so her
        // retained taste is read back through the mounted route, which is the
        // same observable on both hosts.
        const h = await hostFixture(host, CONTINUITY_ALARM);
        const her = await h.newShopper({ browse: true, clock });
        const expiresAt = her.expiresAt;
        const digest = await sha256Hex(her.proof);
        /** The persisted record holding this descriptor's digest, found by the digest. */
        const stored = (why: string) => {
          const holding = h.continuityRecords(her.subject).filter(([, value]) => JSON.stringify(value ?? null).includes(digest));
          expect(holding.length, why).toBe(1);
          return holding[0]![1];
        };

        expect(stored(`${host}: the descriptor is in storage while it is live`),
          `${host}: on its original fixed expiry`).toMatchObject({ digest, expiresAt });
        // R19: no public route exposes the object's alarm schedule.
        const scheduled = h.currentAlarm(her.subject);
        expect(scheduled, `${host}: the object holds a real future alarm`).toBeGreaterThan(Date.now());
        expect(scheduled, `${host}: and the alarm it holds now is no later than the descriptor's expiry`).toBeLessThanOrEqual(expiresAt);

        // Before the expiry the alarm keeps it: cleanup is expiry, not deletion.
        clock.mockReturnValue(her.issuedAt + 60 * 60 * 1000);
        await h.runAlarm(her.subject);
        expect(stored(`${host}: a live descriptor survives the alarm`),
          `${host}: with its expiry untouched`).toMatchObject({ digest, expiresAt });

        // After it, the alarm removes the descriptor and nothing else of hers:
        // her ordinary capability is still live, so the mounted decision route
        // answers with her own remembered taste — the same observable on the
        // session host, where the vector lives in the KV session record, and on
        // the object host, where it lives on the object.
        clock.mockReturnValue(expiresAt + 1);
        await h.runAlarm(her.subject);
        expect(h.continuityRecords(her.subject), `${host}: storage holds no expired descriptor after the alarm runs`).toEqual([]);
        expect(await h.snapshot(her.capability), `${host}: her retained taste is untouched by the cleanup`)
          .toMatchObject({ status: 200, ok: true, decisions: HOME_DECISIONS, first: TABBY });
        expect(h.objectData(her.subject).has('consent'), `${host}: and so is her explicit choice, which has not expired`).toBe(true);
        await expectCold(h, await h.identitySession({ proof: her.proof, operationId: crypto.randomUUID() }),
          `${host}: the descriptor the alarm removed`);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.12', () => {
  it('host: with continuity configured and consent current, a return after 7 and after 14 days is the same physical subject with her taste still ranking, and the proof keeps its original expiry, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        // The published window is 30 days — longer than the fourteen days the
        // customer's Return Visit Recognition row asks for (tapestry line 152).
        const h = await hostFixture(host, CONTINUITY_DIRECT);
        const revision = await h.reflexRevision();
        expect(WINDOW_MS, `${host}: the published window covers a fortnight`).toBeGreaterThanOrEqual(14 * DAY_MS);
        const her = await h.newShopper({ browse: true, clock });

        // Before she leaves, her own taste already decides the slot.
        clock.mockReturnValue(T0 + 4 * STEP_MS);
        expect(await h.snapshot(her.capability), `${host}: her visit ends with her taste ranking`)
          .toMatchObject({ status: 200, ok: true, decisions: HOME_DECISIONS, first: TABBY });

        let proof = her.proof, generation = 1;
        for (const days of [7, 14]) {
          clock.mockReturnValue(T0 + days * DAY_MS);
          const returned = await h.identitySession({ proof, operationId: crypto.randomUUID() });
          expect(returned.status, `${host}: day ${days} → ${returned.bodyText}`).toBe(200);
          expect(returned.subject, `${host}: after ${days} days she is the same physical subject`).toBe(her.subject);
          expect(returned.continuity, `${host}: on the same original expiry, at the next generation`)
            .toEqual(issuedReport('direct', ++generation, her.expiresAt, revision, true));
          // tapestry line 152: she picks up where she left off. Rogue is first in
          // the catalogue, so only her own remembered interest can serve Tabby.
          expect(await h.snapshot(returned.capability), `${host}: after ${days} days her prior taste still ranks (W16.C8.01)`)
            .toMatchObject({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS, first: TABBY });
          proof = String(returned.continuity!.proof);
        }
      }
    } finally { clock.mockRestore(); }
  });
});

