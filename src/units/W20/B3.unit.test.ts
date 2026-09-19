// src/units/W20/B3.unit.test.ts
// W20 batch B3 — the three findings of the W20-B2 BUILD review that bear on the
// operator-visible signal W20-B2 shipped: the monitor's probe exclusion
// exercised on a path that would otherwise count (F1), the documented
// concurrency floor (F2), and the tenant scope of the counts (F3).
//
// One `describe('unit:W20.<id>')` per unit of batch W20-B3, one `it` per ruled
// leg. Every expected value comes from a witness, never from what the engine
// returns today:
//   · the W20-B2 build review `_evidence/W20-B2/reviewer-build/REPORT.md`:
//     control A ("did NOT red — the probe is excluded because it composes
//     unsigned with `opt_tracking_consent=false` (`service.ts:491`), not because
//     of the flag"), control A3 ("the occurrence was NOT counted … the flag is
//     operative … and a suppression switch, which is why reachability matters:
//     it is set only at `src/ops/monitor.ts:346`, the one HTTP entry parses a
//     strict key allow-list (`src/routes/decisions.ts:440`)"), probe A2 ("2
//     loads → 1 counted; 5 loads → 1 counted. The loss is not bounded to one"),
//     probe B ("one key only, `slot-governance:v1:coach`; both brands' slots
//     pages report the merged `refusedPinCount: 2`. Counts merge across brands;
//     the counter is brand-blind while `evidence` beside it is per brand"),
//     findings F1, F2, F3.
//   · document 35 §5 row W20 ("… dead-pin diagnostics … Test both arms and
//     actual operator workflows").
//   · `docs/architecture/35-verification-reports/F28.md` §7 (the monitor
//     signal).
//   · the shipped documentation of the counters, which is itself part of the
//     product these units judge: `docs/kit/02-api-reference.md` :212 and
//     `docs/api/01-rest-endpoints.md` :38.
//   · rulings R19 (a host leg drives the path production runs), R21 (a
//     ruled-but-absent member is named and is typecheck-visible), R94 (one
//     vocabulary on both operator surfaces; the monitor's own probe is never
//     counted), R99 (this batch's readings, below).
//
// R99, THE READINGS THIS BATCH IS WRITTEN AGAINST:
//   (a) F1 — the ruled exclusion of the monitor's own probe is delivered today
//       by the probe composing UNSIGNED with tracking refused; the `selfCheck`
//       flag is operative but no unit exercises it on a path that would
//       otherwise count, and it is a SUPPRESSION switch, so its reachability
//       matters: only the monitor sets it (`src/ops/monitor.ts:346`), the HTTP
//       entry cannot (`src/routes/decisions.ts:440`).
//   (b) F2 — under a store with latency, N simultaneous loads collapse to one
//       increment; the counts are a FLOOR, never an overcount; the kit must say
//       so and must not say "one increment lost".
//   (c) F3 — the counters are one document per tenant while the `evidence`
//       beside them on the same row is per brand, so a multi-brand tenant sees
//       merged counts on every brand's page. The honest fix ruled is the WORD:
//       `scope: 'tenant'` on both governance objects and the row sentence
//       "counted across all of the tenant's brands". A per-brand counter is NOT
//       ruled here — the whole-W20 review decides whether the row requires one.
//   (d) both hosts; nothing customer-specific; customer acceptance stays OPEN
//       on every row.
//
// RULED MISSING MEMBER (R21), by the name this specification rules, RED until it
// exists. No new export is ruled; it is one member on two objects an operator
// route already answers with, in ONE vocabulary on both surfaces (R94(c)):
//   `scope: 'tenant'` on `SlotGovernance` (`src/learn/slotGovernance.ts:36`,
//   carried per slot on `GET /v1/:tenant/learn/slots?evidence=1`) and on
//   `MonitorResult['governance']` (`src/ops/monitor.ts:201`, answered by
//   `POST /v1/:tenant/monitor`). It states, on the answer itself, the scope the
//   counts are kept at: one document per tenant (`slotGovernanceKey`,
//   `slot-governance:v1:<tenant>`), summed across every brand of that tenant.
//   Read off the engine's own types below, so the app typecheck names it as
//   missing: the two errors this batch expects.
//
// RULED SENTENCES (R21, verbatim), in the documents that ship the counters —
// `docs/kit/02-api-reference.md` and `docs/api/01-rest-endpoints.md`, both of
// them wherever both carry the claim, because the two operator surfaces speak
// one vocabulary (R94(c), R105(1); the precedent is W20.G2.07):
//   · `SELF_CHECK_GUARANTORS` (W20.G2.08) — BOTH documents must name BOTH
//     guarantors of the probe exclusion, because today's sentences name neither
//     and control A showed the batch would not have noticed the flag being
//     removed.
//   · `FLOOR_SENTENCE` / `UNDERSTATED_SENTENCE` (W20.G2.09) — the shipped claim
//     "two page loads in the same instant may record one increment" understates
//     what probe A2 measured (5 → 1) and is replaced. Only the kit carries a
//     concurrency sentence today, so only the kit is ruled here.
//   · `TENANT_SCOPE_SENTENCE` and `EVIDENCE_BRAND_SENTENCE` (W20.G2.10) — the
//     row sentence in both documents, and beside it the scope of the member the
//     same row already carries (R105(2)).
//
// ONE REPRESENTATION, SHARED BY EVERY UNIT BELOW AND BY W20-B2:
//   (i)   the occurrence is the same one W20-B2's units drive — Coach's `feature`
//         band whose second required pin went out of stock, refused with
//         `missing_or_ineligible` and counted as
//         `{pinnedPieceId: 'cnt-sold-out', reason: 'missing_or_ineligible'}`.
//   (ii)  the counts stay the two names of R94(c), `refusedPinCount` and
//         `shortTakeCount`, with the `refusedPins[]` detail on the slots page
//         alone; this batch adds `scope` and changes no other member.
//   (iii) "the counts are a floor" is an INVARIANT, not a number: N concurrent
//         occurrences leave the count between 1 and N. It is satisfied by the
//         last-write-wins counter the engine has today AND by a sharded or
//         durable counter that never loses one; it is NOT satisfied by a counter
//         that drops the occurrence entirely or that reports more occurrences
//         than happened.
//   (iv)  the latent store is a fixture of this harness — a KV wrapper whose
//         `get`/`put` resolve after a few milliseconds — never product code.

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND, validateSlotCatalog } from '@/content/kinds';
import type { ContentPiece, SlotCatalog } from '@/content/types';
import { invalidateLiftCache, type ServeRequest } from '@/content/service';
import { storedConsent } from '@/content/consent';
import {
  readSlotGovernance, recordSlotGovernance, slotGovernanceKey,
  type SlotGovernance, type SlotGovernanceOccurrences,
} from '@/learn/slotGovernance';
import type { SlotIndexEntry } from '@/learn/rows';
import type { MonitorResult } from '@/ops/monitor';
import type { PinDiagnostic } from '@/reflex/contentCompose';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { configuredDestinations, configuredOperationalDestinations } from '@/connectors/config';
import type { Env } from '@/types/env';
import { RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';

/**
 * THE MONITOR'S OWN CONSTRUCTION, ON A PATH THAT WOULD OTHERWISE COUNT
 * (W20.G2.08, R99(a); the W20-B2 build review's finding F1 and its control A3).
 *
 * `selfCheck` is set in exactly one place in the engine — `src/ops/monitor.ts:346`,
 * where the monitor hands `serveContentDecisions` the tenant's own page — and the
 * monitor's probe composes UNSIGNED with tracking refused, so the counter is
 * already skipped for it on two other grounds and the flag itself is never
 * exercised. Reaching it on a load that WOULD count needs a signed, consented
 * shopper, and such a load cannot be composed from outside a request: a
 * principal is refused outside the host's owner invocation
 * (`src/identity/sessionAuthority.ts:422`, measured here at specification).
 *
 * So the harness sets the one field the monitor sets, at the one boundary the
 * monitor sets it at, while a REAL shopper request runs through the mounted
 * route: everything else — the capability, the stored consent, the host, the
 * composer, the counter gate at `src/content/service.ts:491` — is the product's
 * own. No product code is edited, and the injection is off for every other unit
 * in this file.
 */
const injected = vi.hoisted(() => ({ selfCheck: false }));
vi.mock('@/content/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/content/service')>();
  return {
    ...actual,
    serveContentDecisions: (env: Env, request: ServeRequest) =>
      actual.serveContentDecisions(env, injected.selfCheck ? { ...request, selfCheck: true } : request),
  };
});
/** Run one page load the way the monitor composes its own: with `selfCheck` declared. */
async function asTheMonitorComposes<T>(run: () => Promise<T>): Promise<T> {
  injected.selfCheck = true;
  try { return await run(); } finally { injected.selfCheck = false; }
}

// ===========================================================================
// The customer's fixture: Coach's own dimensions and values
// (docs/architecture/tapestry_requirements.txt A.3.6), a catalogue and a slot
// document unlike the compiled defaults. Same pieces, same ids and same
// refusal as W20-B2's units, so the two batches demand ONE representation of
// the same occurrence.
// ===========================================================================

const TENANT = 'coach';
const T0 = Date.parse('2026-09-19T12:00:00.000Z');
const DAY_MS = 86_400_000;

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id,
  customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`,
  type: 'editorial',
  title: id,
  tags: {},
  slotTypes: [],
  lifecycle: { status: 'live' },
  ...over,
});

const W20_PIECES: ContentPiece[] = [
  piece('cnt-hero-tabby', { title: 'The Tabby, after dark', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story'] }),
  piece('cnt-hero-rogue', { title: 'The Rogue, at work', type: 'editorial',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story'] }),
  // The stock flag F28 §5.4 names: "a stock feed flipping one flag can blank
  // the merchandiser's campaign band and nobody is told".
  piece('cnt-sold-out', { title: 'The Tabby 26, sold out', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story', 'promo'], inStock: false }),
  piece('cnt-promo-film', { title: 'Ninety seconds with the Tabby', type: 'film',
    tags: { line: ['Tabby'], contentType: ['video'] }, slotTypes: ['promo'] }),
  piece('cnt-legal-notice', { title: 'Terms of this promotion', type: 'editorial',
    tags: { category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['legal'] }),
];

const W20_CATALOGUE = { version: 'w20-b3-coach-catalogue', pieces: W20_PIECES };

/** The tenant's PUBLISHED registry, not the bundled default. */
const TENANT_REGISTRY = {
  ...DEFAULT_REFLEX_CONFIG,
  version: 'w20-b3-coach-registry',
  dimensions: [
    ...DEFAULT_REFLEX_CONFIG.dimensions.filter(dimension => dimension.key !== 'silhouette'),
    { key: 'styleWorld', source: 'styleWorld' },
  ],
};

const FEATURE_WEIGHTS = { line: 1, occasion: 0.5, category: 0.2 };

/** A document a merchandiser could author: through the real publication validator. */
function authorable(pages: Record<string, unknown[]>): SlotCatalog {
  const candidate = { version: 'w20-b3-coach-slots', governanceVersion: 3, pages };
  const checked = validateSlotCatalog(candidate);
  expect(checked.ok ? '' : (checked as { ok: false; errors: string[] }).errors.join('; '),
    `the fixture slot document must be one a merchandiser could author: ${JSON.stringify(pages).slice(0, 400)}`).toBe('');
  return (checked as { ok: true; value: SlotCatalog }).value;
}

/**
 * The band whose second required position went out of stock — F28 §5.4's own
 * case, and the same page W20-B2's units drive. The whole slot is refused, so it
 * writes no record and no ledger row: the operator counters are its only home.
 */
const DEAD_PIN_PAGE = authorable({
  home: [
    { slot: 'feature', take: 2, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-hero-tabby', 'cnt-sold-out'] },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS },
  ],
});

/** What that page serves, so every occurrence is anchored to a known served page. */
const DEAD_PIN_SERVED = ['story:cnt-hero-tabby'];
/** How the composer names the refusal on the shopper's answer. */
const DEAD_PIN_REFUSAL = { slot: 'feature', pinnedPieceId: 'cnt-sold-out', pinIndex: 1, reason: 'missing_or_ineligible' };
/** The same occurrence as the decision path hands it to the counter. */
const DEAD_PIN_OCCURRENCE: SlotGovernanceOccurrences = {
  refusedPins: [{ slot: 'feature', pinnedPieceId: 'cnt-sold-out', reason: 'missing_or_ineligible' }],
  shortTakes: [],
};

// ===========================================================================
// The mounted application, in process, on either shopper host. The harness
// idioms are W20-B2's (`src/units/W20/B2.unit.test.ts`); that file is neither
// imported nor edited. What is new here is the LATENT store (R99(b)).
// ===========================================================================

/**
 * The fixture store. `latencyMs` makes every read and write resolve after a few
 * milliseconds, which is what a real KV round trip does and what the in-memory
 * microtask store of W20-B2 never did: it opens the window in which two page
 * loads read the same counter document before either writes it. It is a FIXTURE
 * of this harness and no product code knows about it.
 */
class UnitKV {
  data = new Map<string, string>();
  constructor(readonly latencyMs = 0) {}
  private async latency() { if (this.latencyMs > 0) await new Promise(resolve => setTimeout(resolve, this.latencyMs)); }
  async get(key: string, type?: string) {
    await this.latency();
    const v = this.data.get(key);
    return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) { await this.latency(); this.data.set(key, value); }
  async delete(key: string) { await this.latency(); this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    await this.latency();
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w20-b3-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
/** EVERY retention category the platform names, as the merged SDK-contract fixture does. */
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

const OPERATOR_SECRET = 'w20-b3-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';

/**
 * The tenant's own telemetry configuration, so that a monitor run is KEPT and
 * can be read back later: `runMonitor` only writes its result when the tenant
 * has an admitted operational `monitor` destination (`src/ops/monitor.ts:389`
 * through `admit`/`eligible`), and `readMonitor` (:300) only answers with one
 * under the same admission. Fixture data in the shape the platform's own
 * registry schema requires (`telemetrySchema`, src/connectors/config.ts:27), not
 * product code; only the unit that reads a stored result asks for it.
 */
const TELEMETRY_ENVIRONMENT = 'test';
const telemetryRegistry = () => JSON.stringify({
  version: 1,
  tenants: { [TENANT]: { telemetry: { environment: TELEMETRY_ENVIRONMENT, schema: 'ops-v1',
    monitor: { binding: 'CACHE', namespace: 'monitor', accessPolicy: 'w20-b3-ops' } } } },
});

interface Mounted {
  env: Env;
  cache: UnitKV;
  objects: Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>;
  drain: () => Promise<void>;
  fetch: (input: Request) => Promise<Response>;
  operatorToken: string;
  configureRetention: () => Promise<void>;
}

async function mount(host: 'session' | 'do' = 'session', options: { cacheLatencyMs?: number; keepMonitorResult?: boolean } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const cache = new UnitKV(options.cacheLatencyMs ?? 0), sessions = new UnitKV(options.cacheLatencyMs ?? 0);
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w20-b3-proof`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => undefined },
    ...(options.keepMonitorResult ? { ENVIRONMENT: TELEMETRY_ENVIRONMENT, TENANT_CONNECTORS: telemetryRegistry() } : {}),
  } as unknown as Env;
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* no destination diagnostics in this fixture */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      // The operational destinations carry their own per-destination policy key
      // too, which is what lets a monitor run be admitted, kept and read back.
      for (const tenant of tenants) for (const destination of await configuredOperationalDestinations(env, tenant)) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  /** One durable-object namespace per class, each instance the REAL class over a storage stub. */
  const namespaceFor = <T extends { fetch: (request: Request) => Promise<Response> }>(
    make: (state: DurableObjectState, env: Env) => T,
    registry?: Map<string, { shopper: T; data: Map<string, unknown> }>,
  ) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = registry?.get(name) as { shopper: T; data: Map<string, unknown> } | undefined;
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [], sockets: WebSocket[] = [];
        const storage = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (options2?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(options2?.prefix ?? '') && (!options2?.startAfter || key > options2.startAfter))
              .sort(([a], [b]) => (options2?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options2?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, item2] of Object.entries(values)) candidate.set(key, structuredClone(item2));
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
        item = { data, shopper: make(state, env) };
        registry?.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e), objects) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), new Map()) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), new Map()) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const fetchOne = async (request: Request): Promise<Response> => {
    await configureRetention();
    return app.fetch(request, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 20)); };
  return { env, cache, objects, drain, fetch: fetchOne, operatorToken, configureRetention };
}

/** The four documents a provisioned tenant holds. */
async function publishFixture(m: Mounted, slots: SlotCatalog, options: { holdoutShare?: number } = {}): Promise<void> {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w20-b3-fixture', note: 'fixture', value } });
  await initializePublicationSet(m.env, [
    baseline(CONTENT_KIND, W20_CATALOGUE),
    baseline(SLOTS_KIND, slots),
    baseline(LEARN_KIND, { holdout: { share: options.holdoutShare ?? 0, salt: 'w20-b3', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} }),
    baseline(REFLEX_KIND, TENANT_REGISTRY, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
}

async function operatorGet(m: Mounted, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT },
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function operatorPost(m: Mounted, path: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/** The tenant's counter document as it sits in the store, or null when none was ever written. */
const governanceDocument = (m: Mounted): string | null => m.cache.data.get(slotGovernanceKey(TENANT)) ?? null;

// ---------------------------------------------------------------------------
// The operator slots page, the home W20-B2 ruled for the counts.
// ---------------------------------------------------------------------------

/**
 * RULED, ABSENT TODAY (R21, R99(c)), and TYPECHECK-VISIBLE: the scope the counts
 * are kept at, read off the engine's OWN `SlotGovernance`
 * (`src/learn/slotGovernance.ts:36`) rather than off a shape declared here, so
 * the compiler names it as missing until it exists. One of the two errors this
 * batch expects.
 */
const scopeMember = (governance: SlotGovernance): string | undefined => governance.scope;

/** What every governance block says apart from the horizon it counts from and its scope. */
interface GovernanceCounts {
  refusedPinCount: number;
  refusedPins: Array<{ pinnedPieceId: string; reason: string; count: number }>;
  shortTakeCount: number;
  shortTakePositions: number;
}

/** `GET /v1/:tenant/learn/slots?evidence=1`, the operator slots page, flattened by slot. */
async function slotsPage(m: Mounted, brand?: string): Promise<{ status: number; brand: string; bySlot: Record<string, SlotIndexEntry> }> {
  const read = await operatorGet(m, `/v1/${TENANT}/learn/slots?evidence=1${brand ? `&brand=${brand}` : ''}`);
  const bySlot: Record<string, SlotIndexEntry> = {};
  for (const page of (read.body.pages as Array<{ page: string; slots: SlotIndexEntry[] }> | undefined) ?? []) {
    for (const entry of page.slots) bySlot[entry.slot] = entry;
  }
  return { status: read.status, brand: String(read.body.brand ?? ''), bySlot };
}

/** The governance block of one slot, or a sentence saying it is absent, so a failure names what is missing. */
const governanceOf = (bySlot: Record<string, SlotIndexEntry>, slot: string): SlotGovernance | string => {
  const entry = bySlot[slot];
  return (entry && entry.governance)
    ?? `absent: the operator slots page carries no \`governance\` block for ${slot} (the entry is ${JSON.stringify(entry ?? null).slice(0, 200)})`;
};

/** Zero, reported as zero, for a slot that refused nothing and filled every position. */
const NO_OCCURRENCES: GovernanceCounts = { refusedPinCount: 0, refusedPins: [], shortTakeCount: 0, shortTakePositions: 0 };
/** `n` occurrences of this fixture's one dead pin. */
const refusals = (n: number): GovernanceCounts => ({
  refusedPinCount: n,
  refusedPins: [{ pinnedPieceId: 'cnt-sold-out', reason: 'missing_or_ineligible', count: n }],
  shortTakeCount: 0, shortTakePositions: 0,
});

/**
 * Every count assertion in this file goes through here, so that EVERY block —
 * including a zero report — is judged on its counts AND on the horizon it states
 * (R94(d)): `since` present and at or before the page load whose occurrences it
 * reports. It does not judge `scope`, which is unit W20.G2.10's own clause.
 */
function expectGovernance(actual: SlotGovernance | string, expected: GovernanceCounts, at: number, label: string): void {
  expect(typeof actual === 'string' ? actual
    : { refusedPinCount: actual.refusedPinCount, refusedPins: actual.refusedPins,
        shortTakeCount: actual.shortTakeCount, shortTakePositions: actual.shortTakePositions }, label).toEqual(expected);
  expect(typeof actual === 'string' ? actual : Number.isSafeInteger(actual.since) && actual.since > 0 && actual.since <= at,
    `${label} — and states the horizon it counts from, present and at or before this page load`).toBe(true);
}

// ---------------------------------------------------------------------------
// The ops monitor, the tenant-level surface.
// ---------------------------------------------------------------------------

/**
 * RULED, ABSENT TODAY (R21, R99(c)), and TYPECHECK-VISIBLE: the same word on the
 * monitor's own counters, read off the engine's `MonitorResult`
 * (`src/ops/monitor.ts:201`). The second of the two errors this batch expects.
 */
const monitorScopeMember = (governance: NonNullable<MonitorResult['governance']>): string | undefined => governance.scope;

/** The monitor's counters, or a sentence naming the member as absent. */
const monitorGovernance = (body: Record<string, unknown>): NonNullable<MonitorResult['governance']> | string =>
  (body.result as MonitorResult | undefined)?.governance
    ?? `absent: the monitor result carries no \`governance\` member (it carries ${Object.keys((body.result ?? {}) as object).join(', ')})`;

// ---------------------------------------------------------------------------
// A shopper on the mounted application.
// ---------------------------------------------------------------------------

interface Snapshot {
  status: number;
  arm: string;
  served: string[];
  error: string | null;
  /** `sources.consent.tracking` as the host reported it: the condition a counted load meets. */
  tracking: boolean;
  pinDiagnostics?: PinDiagnostic[];
}

interface Shopper {
  visitorId: string;
  /** `GET /v1/:tenant/decisions/snapshot?page=home`, with any extra query an ordinary caller may send. */
  snapshot: (options?: { query?: string }) => Promise<Snapshot>;
  /** `POST /v1/:tenant/decisions/snapshot` with a caller-authored body. */
  postSnapshot: (body: Record<string, unknown>) => Promise<Snapshot>;
  /** `n` page loads that are all in flight before any of them resolves. */
  concurrentSnapshots: (n: number) => Promise<Snapshot[]>;
}

async function shopperOn(m: Mounted): Promise<Shopper> {
  const grant = await newAnonymousSession(m.env, TENANT);
  const call = async (path: string, body?: unknown) => {
    await m.configureRetention();
    return m.fetch(new Request(`https://synthetic.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  };
  const current = m.objects.get(shopperObjectName(TENANT, grant.subject))?.data.get('consent');
  const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const preferences = await call(`/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true, choice });
  expect(preferences.status, await preferences.clone().text()).toBe(200);
  await m.drain();

  const parse = async (response: Response): Promise<Snapshot> => {
    const body = await response.clone().json().catch(() => ({})) as {
      arm?: string; error?: string; decisions?: Array<{ slot?: string; contentId?: string }>; pinDiagnostics?: PinDiagnostic[];
      sources?: { consent?: { tracking?: boolean } };
    };
    return {
      status: response.status, arm: body.arm ?? '?', error: body.error ?? null,
      served: (body.decisions ?? []).map(d => `${d.slot ?? '?'}:${d.contentId ?? '?'}`),
      tracking: body.sources?.consent?.tracking === true,
      pinDiagnostics: body.pinDiagnostics,
    };
  };
  const snapshot = async (options: { query?: string } = {}): Promise<Snapshot> => {
    invalidatePublicationCache();
    const out = await parse(await call(`/v1/${TENANT}/decisions/snapshot?page=home${options.query ?? ''}`));
    await m.drain();
    return out;
  };
  const postSnapshot = async (body: Record<string, unknown>): Promise<Snapshot> => {
    invalidatePublicationCache();
    const out = await parse(await call(`/v1/${TENANT}/decisions/snapshot`, body));
    await m.drain();
    return out;
  };
  const concurrentSnapshots = async (n: number): Promise<Snapshot[]> => {
    invalidatePublicationCache();
    await m.configureRetention();
    // The `n` requests are issued together, before any of them is awaited.
    // MEASURED (R105(3)): whether their counter read-modify-writes actually
    // collide depends on the host — on both hosts here all five were counted —
    // so this leg asserts the BOUND, and the collapse itself is measured in the
    // logic leg, which does race (five occurrences, one increment).
    const responses = await Promise.all(Array.from({ length: n }, () => call(`/v1/${TENANT}/decisions/snapshot?page=home`)));
    const out: Snapshot[] = [];
    for (const response of responses) out.push(await parse(response));
    await m.drain();
    return out;
  };
  return { visitorId: grant.subject, snapshot, postSnapshot, concurrentSnapshots };
}

const HOSTS = ['session', 'do'] as const;

/** A fixed platform clock, so `since` and the counts are measured against a known instant. */
function fixedClock(at = T0) {
  const value = { now: at };
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => value.now);
  return { value, set: (ms: number) => { value.now = ms; }, restore: () => spy.mockRestore() };
}

// ---------------------------------------------------------------------------
// The shipped documentation of the counters. Apostrophes are normalized so a
// typographic one is not a failure; nothing else about the sentence is relaxed.
// ---------------------------------------------------------------------------

const KIT = 'docs/kit/02-api-reference.md';
const REST = 'docs/api/01-rest-endpoints.md';
const doc = (file: string): string =>
  readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8').replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
const sentence = (text: string): string => text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ');

/**
 * W20.G2.08 (R99(a)): the kit names BOTH guarantors of the exclusion. Today it
 * names neither — it says only that the probe's compose "is excluded where the
 * counters are written", which control A showed would still read true if the
 * flag were removed or mis-wired.
 */
const SELF_CHECK_GUARANTORS = 'the probe composes unsigned with tracking refused and declares `selfCheck`';

/**
 * W20.G2.09 (R99(b)): the concurrency claim the counters can actually keep.
 * `UNDERSTATED_SENTENCE` is the shipped one, which probe A2 disproved (5
 * simultaneous loads recorded one increment, not four of five).
 */
const FLOOR_SENTENCE = 'concurrent page loads may collapse to one increment; the counts are a floor, never an overcount';
const UNDERSTATED_SENTENCE = 'two page loads in the same instant may record one increment';

/**
 * W20.G2.10 (R99(c), R105(2)): the row sentence, in both documents, for the
 * scope the counters are actually kept at — and, beside it, the scope of the
 * member the same row carries next to them. `evidence` is read per brand
 * (`liftKey(tenant, brand, slot)`, src/routes/decisions.ts:227) while
 * `governance` is per tenant, so a row that states one scope and not the other
 * invites an operator to read both as tenant-wide by symmetry. No new member on
 * `evidence` is ruled: the contrast is stated in the row sentence.
 */
const TENANT_SCOPE_SENTENCE = 'counted across all of the tenant\'s brands';
const EVIDENCE_BRAND_SENTENCE = '`evidence` beside it is kept per brand';

// ===========================================================================
// unit:W20.G2.08 — the probe exclusion is real on a counting path, and
// unreachable from outside
// ===========================================================================

describe('unit:W20.G2.08', () => {
  it('host: the monitor’s own construction counts nothing on a load that would otherwise count and writes no document, while no caller can set the flag at the HTTP entry and the kit names both guarantors, on both hosts', async () => {
    for (const host of HOSTS) {
      const clock = fixedClock();
      try {
        const m = await mount(host);
        await publishFixture(m, DEAD_PIN_PAGE);
        const shopper = await shopperOn(m);

        // (1) THE PROBE, ON A PATH THAT WOULD OTHERWISE COUNT. Every condition
        // the counter is gated on is satisfied — a signed capability, the
        // shopper's stored tracking consent, a real refusal — except the one
        // this clause is about: the load declares `selfCheck`, as the monitor's
        // own compose of the tenant's page does.
        clock.set(T0 + 60_000);
        const probe = await asTheMonitorComposes(() => shopper.snapshot());
        expect(probe.status, `${host}: the self-check composes the tenant's own page through the route production serves`).toBe(200);
        expect(probe.served, `${host}: and serves it exactly as an ordinary load does — the flag changes nothing about the decision`).toEqual(DEAD_PIN_SERVED);
        expect(probe.pinDiagnostics, `${host}: and that compose really refused the pinned piece, so this is a load that would otherwise be counted`).toEqual([DEAD_PIN_REFUSAL]);
        expect(probe.tracking, `${host}: with the shopper's stored tracking consent in force, which is the condition an ordinary counted load meets`).toBe(true);
        expect(governanceDocument(m),
          `${host}: W20.G2.08 — a load that declares \`selfCheck\` counts nothing and writes no counter document at all (\`${slotGovernanceKey(TENANT)}\`), so an operator's counts never carry the platform watching itself`).toBe(null);
        expectGovernance(governanceOf((await slotsPage(m)).bySlot, 'feature'), NO_OCCURRENCES, T0 + 60_000,
          `${host}: W20.G2.08 — and the operator slots page reports that slot as zero occurrences, not one`);

        // (2) THE SAME LOAD WITHOUT THE FLAG COUNTS. This is what makes (1) a
        // measurement of the flag rather than of a path that never counts.
        clock.set(T0 + 120_000);
        const counted = await shopper.snapshot();
        expect(counted.served, `${host}: the identical load serves the identical page`).toEqual(DEAD_PIN_SERVED);
        expect(counted.pinDiagnostics, `${host}: and refuses the identical pin`).toEqual([DEAD_PIN_REFUSAL]);
        expectGovernance(governanceOf((await slotsPage(m)).bySlot, 'feature'), refusals(1), T0 + 120_000,
          `${host}: W20.G2.08 — the same load WITHOUT \`selfCheck\` is counted once, so the zero above is the flag at work and not a path that never counts`);

        // (3) THE FLAG IS NOT SETTABLE FROM OUTSIDE — the query. The GET entry
        // builds its context from the query string and its `ServeRequest` field
        // by field (`src/routes/decisions.ts:493-499`), so a caller's
        // `selfCheck` is ignored and the shopper's load still counts.
        clock.set(T0 + 180_000);
        const viaQuery = await shopper.snapshot({ query: '&selfCheck=true' });
        expect(viaQuery.status, `${host}: the mounted snapshot answers a caller who sent an unknown query parameter`).toBe(200);
        expect(viaQuery.served, `${host}: and serves the same page`).toEqual(DEAD_PIN_SERVED);
        expectGovernance(governanceOf((await slotsPage(m)).bySlot, 'feature'), refusals(2), T0 + 180_000,
          `${host}: W20.G2.08 — a query parameter named \`selfCheck\` is ignored by the HTTP entry and the shopper's load still counts: no caller may suppress a tenant's own counters`);

        // (4) THE FLAG IS NOT SETTABLE FROM OUTSIDE — the body. The POST entry
        // parses a strict key allow-list (`src/routes/decisions.ts:440`), so a
        // body carrying `selfCheck` is refused outright rather than composed
        // with the flag; the allow-list is a guard and is not weakened to admit
        // the key. Nothing is served, so nothing is counted.
        clock.set(T0 + 240_000);
        const viaBody = await shopper.postSnapshot({ page: 'home', selfCheck: true });
        expect([viaBody.status, viaBody.error],
          `${host}: W20.G2.08 — the POST entry's strict key allow-list admits no \`selfCheck\` key, so a caller's body is refused rather than composed with the flag`)
          .toEqual([401, 'Shopper session unavailable']);
        expectGovernance(governanceOf((await slotsPage(m)).bySlot, 'feature'), refusals(2), T0 + 240_000,
          `${host}: W20.G2.08 — a refused request served nothing, so the tenant's counts are exactly the loads that were served`);

        // …and the same body WITHOUT the key is served and counted, so the
        // refusal above is the allow-list at work and not a dead route.
        const plainBody = await shopper.postSnapshot({ page: 'home' });
        expect(plainBody.status, `${host}: the same body without the key is served`).toBe(200);
        expect(plainBody.served, `${host}: and serves the same page`).toEqual(DEAD_PIN_SERVED);
        expectGovernance(governanceOf((await slotsPage(m)).bySlot, 'feature'), refusals(3), T0 + 240_000,
          `${host}: W20.G2.08 — and that load is counted, so a caller can neither set the flag nor lose an occurrence by naming it`);
      } finally { clock.restore(); }
    }

    // (5) BOTH shipped documents name both guarantors of the exclusion, so that
    // removing either one contradicts the shipped contract (R99(a), finding F1)
    // and the two operator surfaces keep one vocabulary (R94(c), R105(1); the
    // precedent is W20.G2.07, whose sentence is required in both files).
    for (const file of [KIT, REST]) {
      expect(doc(file).includes(sentence(SELF_CHECK_GUARANTORS)),
        `W20.G2.08 — ${file} must name BOTH guarantors of the monitor's exclusion, because today it names neither and the flag could be removed without contradicting a word of it: "${SELF_CHECK_GUARANTORS}"`).toBe(true);
    }
  }, 240_000);
});

// ===========================================================================
// unit:W20.G2.09 — the counts are a floor
// ===========================================================================

/** The latency a KV round trip takes, and the window two page loads race in. */
const STORE_LATENCY_MS = 5;
/** Probe A2's own load: five simultaneous occurrences of one refusal. */
const CONCURRENT_LOADS = 5;

describe('unit:W20.G2.09', () => {
  it('logic: under a store that resolves with latency, N concurrent occurrences of one refusal leave the count between 1 and N while N serialized occurrences count exactly N, and the kit states the floor it is', async () => {
    // Serialized: nothing races, so nothing is lost and nothing is invented.
    const steady = new UnitKV(STORE_LATENCY_MS);
    const steadyEnv = { CACHE: steady } as unknown as Pick<Env, 'CACHE'>;
    for (let i = 0; i < CONCURRENT_LOADS; i++) await recordSlotGovernance(steadyEnv, TENANT, DEAD_PIN_OCCURRENCE, T0 + i * 1_000);
    const serialized = await readSlotGovernance(steadyEnv, TENANT, T0 + CONCURRENT_LOADS * 1_000);
    expect(serialized.bySlot.get('feature')?.refusedPinCount ?? -1,
      `W20.G2.09 — ${CONCURRENT_LOADS} occurrences that do not overlap are counted exactly ${CONCURRENT_LOADS} times: the counter never overcounts and never drops an occurrence it had to itself`)
      .toBe(CONCURRENT_LOADS);

    // Concurrent: the read-modify-write of every load overlaps the others.
    const latent = new UnitKV(STORE_LATENCY_MS);
    const latentEnv = { CACHE: latent } as unknown as Pick<Env, 'CACHE'>;
    await Promise.all(Array.from({ length: CONCURRENT_LOADS }, () => recordSlotGovernance(latentEnv, TENANT, DEAD_PIN_OCCURRENCE, T0)));
    const raced = await readSlotGovernance(latentEnv, TENANT, T0);
    const counted = raced.bySlot.get('feature')?.refusedPinCount ?? -1;
    expect(counted,
      `W20.G2.09 — ${CONCURRENT_LOADS} simultaneous occurrences leave the count at a FLOOR of at least one: a slot that refused a pin is never invisible to an operator, whatever the store did`)
      .toBeGreaterThanOrEqual(1);
    expect(counted,
      `W20.G2.09 — and at most the ${CONCURRENT_LOADS} occurrences that actually happened: the counts are a floor, never an overcount`)
      .toBeLessThanOrEqual(CONCURRENT_LOADS);

    // …and the shipped claim says exactly that. The one it replaces was
    // measured false: five simultaneous loads recorded one increment, not four
    // of five (the W20-B2 build review, probe A2 and finding F2).
    const kit = doc(KIT);
    expect(kit.includes(sentence(FLOOR_SENTENCE)),
      `W20.G2.09 — ${KIT} must state the concurrency behaviour the counters actually have: "${FLOOR_SENTENCE}"`).toBe(true);
    expect(kit.includes(sentence(UNDERSTATED_SENTENCE)),
      `W20.G2.09 — and must no longer claim that only "${UNDERSTATED_SENTENCE}", which understates a loss measured at five loads to one increment`).toBe(false);
  }, 60_000);

  it('host: N page loads in flight at once on a refused pin leave the operator slots page reporting between 1 and N occurrences, and every one of those shoppers is served, on both hosts', async () => {
    for (const host of HOSTS) {
      const clock = fixedClock();
      try {
        const m = await mount(host, { cacheLatencyMs: STORE_LATENCY_MS });
        await publishFixture(m, DEAD_PIN_PAGE);
        const shopper = await shopperOn(m);
        clock.set(T0 + 60_000);

        const loads = await shopper.concurrentSnapshots(CONCURRENT_LOADS);
        expect(loads.map(load => load.status), `${host}: every one of the ${CONCURRENT_LOADS} simultaneous page loads is served`)
          .toEqual(Array.from({ length: CONCURRENT_LOADS }, () => 200));
        expect(loads.map(load => load.served), `${host}: and every one of them serves the same page, the refused band handed to the site default`)
          .toEqual(Array.from({ length: CONCURRENT_LOADS }, () => DEAD_PIN_SERVED));

        const block = governanceOf((await slotsPage(m)).bySlot, 'feature');
        const counted = typeof block === 'string' ? block : block.refusedPinCount;
        expect(counted,
          `${host}: W20.G2.09 — ${CONCURRENT_LOADS} page loads that refused the pin in the same instant leave the operator a FLOOR of at least one occurrence: a diagnostic counter under a store with latency may lose detail, never the fact`)
          .toBeGreaterThanOrEqual(1);
        expect(counted,
          `${host}: W20.G2.09 — and at most the ${CONCURRENT_LOADS} occurrences that happened: never more than the page loads that produced them`)
          .toBeLessThanOrEqual(CONCURRENT_LOADS);
        expect(typeof block === 'string' ? block : Number.isSafeInteger(block.since) && block.since > 0 && block.since <= T0 + 60_000,
          `${host}: W20.G2.09 — and the block states the horizon those counts start at, as every governance block does`).toBe(true);
      } finally { clock.restore(); }
    }
  }, 240_000);
});

// ===========================================================================
// unit:W20.G2.10 — the tenant scope is explicit
// ===========================================================================

describe('unit:W20.G2.10', () => {
  it('host: every governance block on the slots page, on the monitor and on the operator’s read of the kept monitor result states `scope: "tenant"`, a two-brand tenant’s pages both report the counts merged across its brands, and both shipped documents say so, on both hosts', async () => {
    for (const host of HOSTS) {
      const clock = fixedClock();
      try {
        // `keepMonitorResult`: the tenant's telemetry configuration, so the run
        // below is admitted, kept and readable again — the historical read this
        // unit ends on (R105(2)).
        const m = await mount(host, { keepMonitorResult: true });
        await publishFixture(m, DEAD_PIN_PAGE);
        const shopper = await shopperOn(m);

        // One page load under each of the tenant's brands. The counter is one
        // document per tenant (`slot-governance:v1:<tenant>`), so both loads
        // land in the same counts while the `evidence` beside them on the same
        // row is read per brand.
        clock.set(T0 + 60_000);
        const na = await shopper.snapshot({ query: '&brand=coach-na' });
        expect(na.status, `${host}: the first brand's page load is served`).toBe(200);
        expect(na.served, `${host}: and its refused band is handed to the site default`).toEqual(DEAD_PIN_SERVED);
        clock.set(T0 + 120_000);
        const eu = await shopper.snapshot({ query: '&brand=coach-eu' });
        expect(eu.status, `${host}: the second brand's page load is served`).toBe(200);
        expect(eu.served, `${host}: and its refused band is handed to the site default`).toEqual(DEAD_PIN_SERVED);

        for (const brand of ['coach-na', 'coach-eu']) {
          const page = await slotsPage(m, brand);
          expect(page.status, `${host}/${brand}: the operator slots page answers`).toBe(200);
          expect(page.brand, `${host}/${brand}: and it is that brand's page`).toBe(brand);
          expectGovernance(governanceOf(page.bySlot, 'feature'), refusals(2), T0 + 120_000,
            `${host}/${brand}: W20.G2.10 — both brands' pages report the same counts, because the counters are kept once per tenant and cover every brand of it`);
          for (const slot of ['feature', 'story']) {
            const block = governanceOf(page.bySlot, slot);
            expect(typeof block === 'string' ? block : scopeMember(block),
              `${host}/${brand}: W20.G2.10 — the \`governance\` block of ${slot} must state the scope its counts are kept at (ruled member: \`scope: 'tenant'\`), so an operator reading one brand's page is never shown another brand's refusals as this brand's`)
              .toBe('tenant');
          }
        }

        // The tenant-level surface says the same word for the same counts.
        const run = await operatorPost(m, `/v1/${TENANT}/monitor`);
        expect(run.status, `${host}: the monitor run answers: ${JSON.stringify(run.body).slice(0, 300)}`).toBe(200);
        const monitor = monitorGovernance(run.body);
        expect(typeof monitor === 'string' ? monitor : monitor.refusedPinCount,
          `${host}: W20.G2.10 — the monitor sums the same two brand-blind page loads for the tenant`).toBe(2);
        expect(typeof monitor === 'string' ? monitor : monitorScopeMember(monitor),
          `${host}: W20.G2.10 — and states the same scope in the same word as the slots page (ruled member: \`scope: 'tenant'\` on \`MonitorResult.governance\`)`).toBe('tenant');

        // THE HISTORICAL READ (R105(2)). `GET /v1/:tenant/monitor` answers the
        // kept result through `readMonitor` → `projectMonitor`, whose
        // `safeGovernance` (`src/ops/monitor.ts:222`) REBUILDS the counters
        // member by member: a `scope` it does not copy is lost on every read an
        // operator makes after the run itself.
        const historical = await operatorGet(m, `/v1/${TENANT}/monitor`);
        expect(historical.status, `${host}: the operator's read of the platform's last self-check answers`).toBe(200);
        const last = (historical.body.last ?? null) as MonitorResult | null;
        // PRECONDITION, NOT THE UNIT'S OUTCOME: the run above must have been
        // kept and read back with its counters at all. If this line is what
        // fails, the batch has a harness gap (the tenant's telemetry admission),
        // NOT the product gap this clause is about — see the unit's row.
        expect(last?.governance?.refusedPinCount
          ?? `absent: GET /v1/${TENANT}/monitor answered ${JSON.stringify(historical.body).slice(0, 200)}`,
          `${host}: PRECONDITION — the run just made is read back through \`readMonitor\` with the tenant's counters on it`).toBe(2);
        expect(last?.governance === undefined
          ? 'absent: the kept monitor result was read back with no `governance` member at all'
          : monitorScopeMember(last.governance),
          `${host}: W20.G2.10 — the operator's later read of that kept result states the scope too, because \`projectMonitor\` rebuilds the counters explicitly and drops anything it does not copy`).toBe('tenant');
      } finally { clock.restore(); }
    }

    // Both shipped documents carry the row sentence for the scope, and say what
    // the member beside it on the same row is scoped to.
    for (const file of [KIT, REST]) {
      expect(doc(file).includes(sentence(TENANT_SCOPE_SENTENCE)),
        `W20.G2.10 — ${file} must say on the counters' row that they are kept per tenant: "${TENANT_SCOPE_SENTENCE}"`).toBe(true);
      expect(doc(file).includes(sentence(EVIDENCE_BRAND_SENTENCE)),
        `W20.G2.10 — and ${file} must say what the member beside them on the same row is scoped to, so an operator does not read it as tenant-wide by symmetry: "${EVIDENCE_BRAND_SENTENCE}"`).toBe(true);
    }
  }, 240_000);
});
