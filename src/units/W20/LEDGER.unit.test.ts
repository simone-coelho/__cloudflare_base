// src/units/W20/LEDGER.unit.test.ts
// W20 under the Closure Ledger (step 3, 2026-09-24): the acceptance tests for
// the LOCAL criteria R1–R7 of the frozen W20 work order
// (`docs/remediation/delivery-control/program.json`, ticket W20). G1 and G2 are
// proven by `src/units/W20/B1–B3.unit.test.ts` and are not repeated here; LG1 is
// proven by the legacy command of the acceptance command.
//
// One `describe('unit:W20.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · document 35 §5 row W20 (:415) and F28 (§5.7, §7.4);
//   · LANE-LOG R77(a)(b), R82(c), R86(a)(b), R94(c), R103(a)(b)(c), R110(1)–(4),
//     R111(i)–(iv), and the whole-W20 review and delta
//     (`/home/simonecoelho/rem/_evidence/W20/reviewer-whole/{REPORT.md,REPORT-DELTA.md}`);
//   · the shipped contract: `docs/kit/02-api-reference.md` (the
//     `constraintDiagnostics` paragraph, the `governance` paragraph and the
//     monitor rows), `docs/api/01-rest-endpoints.md`, and the owner decisions D1
//     and D2 of the work order.
//
// THE READINGS THIS FILE RULES, ONE REPRESENTATION FOR ALL SEVEN:
//   R1  The public home of `constraintDiagnostics` is the operator's read of the
//       slot document, `GET /content/slots` — the route R77(b) names "the public
//       home of constraint refusals" and R82(c) routes the member to "with
//       R77(b)". It is carried beside `pinDiagnostics` as its own member,
//       `constraintDiagnostics`, in the shape kit 02 already publishes for it
//       (`{warningCount, omittedWarningCount, warnings: [{slot, contentId,
//       reason, dimension?, value?}]}`), NOT inside `slot-pin-diagnostics/v1`,
//       whose published privacy rule echoes no piece ids or slot names (kit 02,
//       the pin-feedback paragraph) while every constraint entry names both. The
//       rules are R77(a) and R82(b): only a piece otherwise eligible for the slot
//       (live, naming the slot) is named; only a slot the composer ranks
//       contributes; at most 50 are named, slot order then catalogue order, and
//       the rest counted as omitted. Entries may carry more members (a page, say)
//       than the kit lists; the listed ones are asserted exactly.
//   R2  The console's home for the block is the Slots screen (`#/slots`), the one
//       screen that renders `GET /v1/:tenant/learn/slots?evidence=1`, each slot
//       one row beside its `evidence` ("Learned so far"). The row must show the
//       refused pin's id, how often it was refused and why (the runtime reason
//       word, underscores or spaces), and a pinned slot's short takes with the
//       positions left empty. How the words read is the builder's.
//   R3  The criterion is an either/or and the test keeps both arms: every one of
//       a 205-slot page's rows carries its governance block (with its own counts
//       past the budget), OR the three promising sentences are corrected — none
//       of the unconditional "never omitted" wordings remains and the kit's
//       `learn/slots` row names the 200-slot budget. A corrected sentence is
//       then read by the reviewer (the criterion's own proof clause).
//   R4  The one word is `status`, after the precedent R111(ii) names — the
//       advisory pin channel (`status: 'available' | 'unavailable'`, with its
//       counts `null` when unavailable). Every block of a readable store says
//       `status: 'available'`; on a store outage every block says
//       `status: 'unavailable'` and states no count.
//   R5  R111(i)'s remedy: the kept monitor result's `governance` is dropped unless
//       `since`, `refusedPinCount` and `shortTakeCount` are all finite and
//       non-negative, on the projection and on the operator's read of a kept
//       record corrupted in the store.
//   R6  The kit's `GET /v1/{tenant}/monitor` row names `scope`; the floor sentence
//       W20.G2.09 requires in the kit is present in `docs/api/01-rest-endpoints.md`.
//   R7  No sentence of the two PS documents promises cross-page duplicate
//       prevention or a per-slot/declarable fallback without negating it.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `constraintDiagnostics` on the `GET /content/slots` answer (R1) and `status` on
// every `governance` block of the operator slots page (R4). No new export.
//
// HARNESS: the mounted application in process with the real route modules and
// the real DO classes over storage stubs, in the idiom of
// `src/units/W20/B2.unit.test.ts` and `src/units/W20/B3.unit.test.ts`; the shipped
// console under jsdom in the idiom of `src/units/W20/B1.unit.test.ts` (W20.G1.09).
// None of those files is imported or edited. Documents are read from the tree
// this file lives in (`import.meta.url`), never from the working directory.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import * as jose from 'jose';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND, validateSlotCatalog } from '@/content/kinds';
import type { ContentPiece, SlotCatalog } from '@/content/types';
import { invalidateLiftCache } from '@/content/service';
import { recordSlotGovernance, type SlotGovernanceOccurrences } from '@/learn/slotGovernance';
import { monitorKey, projectMonitor, type MonitorResult } from '@/ops/monitor';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { configRoutes } from '@/routes/config';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { configuredDestinations, configuredOperationalDestinations } from '@/connectors/config';
import type { Env } from '@/types/env';
import { RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';

// ===========================================================================
// The customer's fixture: Coach's own dimensions and values
// (docs/architecture/tapestry_requirements.txt A.3.6), locale as an ordinary
// tag dimension (W19 L1), and the tenant's own published registry.
// ===========================================================================

const TENANT = 'coach';
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

/** The tenant's PUBLISHED registry: the bundled default plus the customer's own `locale` and `styleWorld`. */
const TENANT_REGISTRY = {
  ...DEFAULT_REFLEX_CONFIG,
  version: 'w20-ledger-coach-registry',
  dimensions: [
    ...DEFAULT_REFLEX_CONFIG.dimensions.filter(dimension => dimension.key !== 'silhouette'),
    { key: 'styleWorld', source: 'styleWorld' },
    { key: 'locale', source: 'locale' },
  ],
};

const FEATURE_WEIGHTS = { line: 1, occasion: 0.5, category: 0.2 };

/** A document a merchandiser could author: through the real publication validator. */
function authorable(pages: Record<string, unknown[]>): SlotCatalog {
  const candidate = { version: 'w20-ledger-coach-slots', governanceVersion: 3, pages };
  const checked = validateSlotCatalog(candidate);
  expect(checked.ok ? '' : (checked as { ok: false; errors: string[] }).errors.join('; '),
    `the fixture slot document must be one a merchandiser could author: ${JSON.stringify(pages).slice(0, 400)}`).toBe('');
  return (checked as { ok: true; value: SlotCatalog }).value;
}

/**
 * R1's catalogue. Catalogue ORDER is part of the expected answer (R77(a)).
 * Beside the three pieces the `feature` slot's published controls refuse, it
 * carries every input that must NOT be named: a case-variant market value the
 * literal tag match does not refuse (W19 L1), an expired piece, a piece that does
 * not name the slot, and pieces that only an off-limits or a wholly pinned slot
 * would refuse.
 */
const CONSTRAINT_PIECES: ContentPiece[] = [
  piece('cnt-hero-tabby', { title: 'The Tabby, after dark', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'], locale: ['en-GB'] },
    slotTypes: ['feature', 'story'] }),
  piece('cnt-hero-rogue', { title: 'The Rogue, at work', type: 'editorial',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'], locale: ['en-GB'] },
    slotTypes: ['feature', 'story'] }),
  piece('cnt-promo-film', { title: 'Ninety seconds with the Tabby', type: 'film',
    tags: { line: ['Tabby'], contentType: ['video'], locale: ['en-GB'] }, slotTypes: ['feature', 'promo'] }),
  piece('cnt-market-fr', { title: 'Le Tabby', type: 'editorial',
    tags: { line: ['Tabby'], contentType: ['editorial'], locale: ['fr-FR'] }, slotTypes: ['feature'] }),
  piece('cnt-market-fr-variant', { title: 'Le Rogue', type: 'editorial',
    tags: { line: ['Rogue'], contentType: ['editorial'], locale: ['fr-fr'] }, slotTypes: ['feature'] }),
  piece('cnt-market-fr-expired', { title: 'Le Tabby, l’an dernier', type: 'editorial',
    tags: { line: ['Tabby'], contentType: ['editorial'], locale: ['fr-FR'] }, slotTypes: ['feature'], lifecycle: { status: 'expired' } }),
  piece('cnt-lookbook-fr', { title: 'Lookbook, Paris', type: 'editorial',
    tags: { line: ['Tabby'], contentType: ['editorial'], locale: ['fr-FR'] }, slotTypes: ['lookbook'] }),
  piece('cnt-promo-edit', { title: 'The Rogue, restated', type: 'editorial',
    tags: { line: ['Rogue'], contentType: ['editorial'], locale: ['en-GB'] }, slotTypes: ['promo'] }),
];

/**
 * `feature` is RANKED and publishes an id exclusion, an allowed rendering type
 * and a market exclusion; `story` is off-limits (never ranked) and `promo`'s
 * whole take is one pin (never ranked), so their exclusions refuse nobody
 * (R82(b)).
 */
const CONSTRAINED_PAGE = authorable({
  home: [
    { slot: 'feature', take: 2, weights: FEATURE_WEIGHTS, excludedPieceIds: ['cnt-hero-rogue'], allowedTypes: ['editorial'],
      excludedTags: [{ dimension: 'locale', value: 'fr-FR' }] },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS, offLimits: true, excludedPieceIds: ['cnt-hero-tabby'] },
    { slot: 'promo', take: 1, weights: { line: 1 }, pinnedPieceIds: ['cnt-promo-film'], excludedTags: [{ dimension: 'contentType', value: 'editorial' }] },
  ],
});

/** What kit 02 publishes the member to say for that page, slot order then catalogue order. */
const CONSTRAINED_EXPECTED = {
  warningCount: 3,
  omittedWarningCount: 0,
  warnings: [
    { slot: 'feature', contentId: 'cnt-hero-rogue', reason: 'excluded' },
    { slot: 'feature', contentId: 'cnt-promo-film', reason: 'type_not_allowed' },
    { slot: 'feature', contentId: 'cnt-market-fr', reason: 'excluded_tag', dimension: 'locale', value: 'fr-FR' },
  ],
};

/** R77(a)'s bound: a market rule over a real catalogue refuses many pieces; 60 here, of which 50 are named. */
const WIDE_REFUSED = 60;
const WIDE_PIECES: ContentPiece[] = [
  piece('cnt-market-en', { type: 'editorial', tags: { line: ['Tabby'], contentType: ['editorial'], locale: ['en-GB'] }, slotTypes: ['feature'] }),
  ...Array.from({ length: WIDE_REFUSED }, (_, index) => piece(`cnt-fr-${String(index).padStart(3, '0')}`, {
    type: 'editorial', tags: { line: [index % 2 ? 'Rogue' : 'Tabby'], contentType: ['editorial'], locale: ['fr-FR'] }, slotTypes: ['feature'] })),
];
const WIDE_PAGE = authorable({
  home: [{ slot: 'feature', take: 3, weights: FEATURE_WEIGHTS, excludedTags: [{ dimension: 'locale', value: 'fr-FR' }] }],
});

/** The governance fixture (R2–R5): W20-B2's dead-pin band, a short pinned promo and a clean story. */
const GOVERNANCE_PIECES: ContentPiece[] = [
  piece('cnt-hero-tabby', { title: 'The Tabby, after dark', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['feature', 'story'] }),
  piece('cnt-hero-rogue', { title: 'The Rogue, at work', type: 'editorial',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['feature', 'story'] }),
  piece('cnt-promo-film', { title: 'Ninety seconds with the Tabby', type: 'film',
    tags: { line: ['Tabby'], contentType: ['video'] }, slotTypes: ['promo'] }),
  piece('cnt-promo-edit', { title: 'The Rogue, restated', type: 'editorial',
    tags: { line: ['Rogue'], contentType: ['editorial'] }, slotTypes: ['promo'] }),
  piece('cnt-sold-out', { title: 'The Tabby 26, sold out', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story', 'promo'], inStock: false }),
];
const GOVERNANCE_PAGE = authorable({
  home: [
    { slot: 'feature', take: 2, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-hero-tabby', 'cnt-sold-out'] },
    { slot: 'promo', take: 3, weights: { line: 1 }, pinnedPieceIds: ['cnt-promo-film'] },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS },
  ],
});
/** The dead pin as the decision path hands it to the counter (W20-B2/B3's occurrence). */
const DEAD_PIN: SlotGovernanceOccurrences = {
  refusedPins: [{ slot: 'feature', pinnedPieceId: 'cnt-sold-out', reason: 'missing_or_ineligible' }], shortTakes: [],
};
const shortTake = (empty: number): SlotGovernanceOccurrences => ({ refusedPins: [], shortTakes: [{ slot: 'promo', empty }] });

// ===========================================================================
// The mounted application, in process.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  /** A store outage for the keys this predicate names (R4). */
  failGet: ((key: string) => boolean) | null = null;
  async get(key: string, type?: string) {
    if (this.failGet?.(key)) throw new Error('synthetic store outage');
    const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
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

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w20-ledger-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

const OPERATOR_SECRET = 'w20-ledger-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';

/**
 * The tenant's own telemetry registry, so a monitor run is KEPT and can be read
 * back (`runMonitor`/`readMonitor` admit through the operational `monitor`
 * destination) — the shape W20.G2.10 uses (`src/units/W20/B3.unit.test.ts`).
 */
const TELEMETRY_ENVIRONMENT = 'test';
const telemetryRegistry = () => JSON.stringify({
  version: 1,
  tenants: { [TENANT]: { telemetry: { environment: TELEMETRY_ENVIRONMENT, schema: 'ops-v1',
    monitor: { binding: 'CACHE', namespace: 'monitor', accessPolicy: 'w20-ledger-ops' } } } },
});

interface Mounted {
  env: Env;
  cache: UnitKV;
  fetch: (input: Request) => Promise<Response>;
  drain: () => Promise<void>;
  operatorToken: string;
}

async function mount(options: { keepMonitorResult?: boolean } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session',
    STORAGE: new UnitR2(),
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w20-ledger-proof`,
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
      for (const tenant of tenants) for (const destination of await configuredOperationalDestinations(env, tenant)) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  /** One durable-object namespace per class, each instance the REAL class over a storage stub. */
  const namespaceFor = <T extends { fetch: (request: Request) => Promise<Response> }>(make: (state: DurableObjectState, env: Env) => T) => {
    const registry = new Map<string, T>();
    return {
      idFromName: (n: string) => n,
      get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        let instance = registry.get(name);
        if (!instance) {
          const data = new Map<string, unknown>();
          const alarms: number[] = [], sockets: WebSocket[] = [];
          const storage = {
            get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
            put: async (k: string | Record<string, unknown>, v?: unknown) => {
              if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
            },
            list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
              structuredClone(new Map([...data].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
                .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
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
          instance = make(state, env);
          registry.set(name, instance);
        }
        return instance.fetch(new Request(input, init));
      } }),
    };
  };
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e)) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e)) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e)) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));
  const fetchOne = async (request: Request): Promise<Response> => {
    await configureRetention();
    return app.fetch(request, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, cache, fetch: fetchOne, drain, operatorToken };
}

/** The four documents a provisioned tenant holds. */
async function publishFixture(m: Mounted, slots: SlotCatalog, pieces: ContentPiece[]): Promise<void> {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w20-ledger-fixture', note: 'fixture', value } });
  await initializePublicationSet(m.env, [
    baseline(CONTENT_KIND, { version: 'w20-ledger-coach-catalogue', pieces }),
    baseline(SLOTS_KIND, slots),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w20-ledger', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} }),
    baseline(REFLEX_KIND, TENANT_REGISTRY, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
}

async function operatorGet(m: Mounted, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function operatorPost(m: Mounted, path: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method: 'POST', headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/** Occurrences, written by the decision path's own counter writer (`recordSlotGovernance`). */
async function occur(m: Mounted, occurrences: SlotGovernanceOccurrences, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await recordSlotGovernance(m.env, TENANT, occurrences, Date.now());
}

/** `GET /v1/:tenant/learn/slots?evidence=1`, the operator slots page, one entry per slot in page order. */
async function slotsPage(m: Mounted): Promise<{ status: number; rows: Array<Record<string, unknown>> }> {
  const read = await operatorGet(m, `/v1/${TENANT}/learn/slots?evidence=1`);
  const rows = ((read.body.pages as Array<{ slots: Array<Record<string, unknown>> }> | undefined) ?? []).flatMap(page => page.slots);
  return { status: read.status, rows };
}
const governanceOf = (row: Record<string, unknown> | undefined): Record<string, unknown> | null =>
  row && row.governance && typeof row.governance === 'object' ? row.governance as Record<string, unknown> : null;

// ===========================================================================
// The documents, read from the tree this file lives in.
// ===========================================================================

const KIT = 'docs/kit/02-api-reference.md';
const REST = 'docs/api/01-rest-endpoints.md';
const GUIDE = 'docs/PS-Implementation-Delivery-Guide.md';
const RUNBOOK = 'docs/PS-Implementation-Runbook.md';
const raw = (file: string): string => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
const flat = (text: string): string => text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ');

/** W20.G2.09's ruled sentence (`src/units/W20/B3.unit.test.ts`), required in the kit there and in api 01 here (R6). */
const FLOOR_SENTENCE = 'concurrent page loads may collapse to one increment; the counts are a floor, never an overcount';
/** R3: the unconditional wordings R111(iii) measured false past the 200-slot budget. */
const KIT_NEVER_OMITTED = 'reports zeros, never an omitted block';
const REST_NEVER_OMITTED = 'with zero reported as zero rather than omitted';

// ===========================================================================
// The shipped console, under jsdom, bound to the mounted app (W20.G1.09's idiom).
// ===========================================================================

interface El {
  textContent: string | null;
  querySelector: (sel: string) => El | null;
}
interface ConsoleBrowser extends Record<string, unknown> {
  document: { body: El; querySelectorAll: (sel: string) => ArrayLike<El> };
  eval: (s: string) => unknown; close: () => void; location: { hash: string };
  localStorage: { setItem: (key: string, value: string) => void };
}

async function openConsole(m: Mounted, hash: string) {
  const dom = new JSDOM(raw('public/console/index.html'), { url: `${OPERATOR_ORIGIN}/console/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as ConsoleBrowser;
  const intervals: Array<() => void> = [];
  w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const target = new URL(url, `${OPERATOR_ORIGIN}/console/`);
    return m.fetch(new Request(OPERATOR_ORIGIN + target.pathname + target.search, {
      method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }),
    }));
  };
  w.TextEncoder = TextEncoder;
  w.setInterval = (callback: () => void) => { intervals.push(callback); return intervals.length; };
  w.confirm = () => true;
  w.localStorage.setItem('operator-session', JSON.stringify({
    accessToken: m.operatorToken, refreshToken: 'w20-ledger-refresh', exp: Date.now() + 3_600_000,
    user: { id: 'ops', name: 'Test Operator', email: 'ops@brand.test', roles: ['admin'] }, mustChangePassword: false,
  }));
  w.eval(raw('public/operator-session.js'));
  for (const file of ['shell.js', 'views.js', 'views-config.js', 'views-measure.js', 'views-accounts.js', 'views-explore.js']) w.eval(raw(`public/console/${file}`));
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 12)); };
  await settle(); await settle();
  /** The text of the Slots screen's row for one slot: the table row whose slot link names it. */
  const row = (slot: string): string => {
    const found = Array.from(w.document.querySelectorAll('#view tr')).find(tr => (tr.querySelector('button.link')?.textContent ?? '').trim() === slot);
    return found ? flat(found.textContent ?? '') : `absent: the Slots screen has no row for ${slot}`;
  };
  const text = () => flat(w.document.body.textContent ?? '');
  return { row, text, close: () => w.close() };
}

/** A whole number standing on its own in rendered text (not a digit of another number). */
const standalone = (n: number) => new RegExp(`(^|[^0-9.])${n}([^0-9]|$)`);

// ===========================================================================
// unit:W20.R1 — constraintDiagnostics has a public observable on an operator route
// ===========================================================================

describe('unit:W20.R1', () => {
  it('host: the operator’s read of the slot document names every piece a ranked slot’s published controls refused although the slot could otherwise have served it, with the refusing pair, in slot then catalogue order, bounded at 50 with the rest counted', async () => {
    const m = await mount();
    await publishFixture(m, CONSTRAINED_PAGE, CONSTRAINT_PIECES);
    const read = await operatorGet(m, `/content/slots?scope=${TENANT}`);
    expect(read.status, `the operator read of the slot document answers: ${JSON.stringify(read.body).slice(0, 300)}`).toBe(200);
    const carried = read.body.constraintDiagnostics;
    expect(carried && typeof carried === 'object' ? carried
      : { absent: `GET /content/slots carries no \`constraintDiagnostics\` member (it carries ${Object.keys(read.body).join(', ')})` },
      'W20.R1 — the operator route must carry `constraintDiagnostics` (R82(c), R77(b)): the id-excluded piece, the piece of a type the slot does not allow and the piece of the excluded market, each with its reason and the market pair that refused it — and nothing for the case-variant market value, the expired piece, the piece that does not name the slot, or the off-limits and wholly pinned slots')
      .toMatchObject(CONSTRAINED_EXPECTED);

    const wide = await mount();
    await publishFixture(wide, WIDE_PAGE, WIDE_PIECES);
    const wideRead = await operatorGet(wide, `/content/slots?scope=${TENANT}`);
    expect(wideRead.status).toBe(200);
    const member = wideRead.body.constraintDiagnostics as { warningCount?: unknown; omittedWarningCount?: unknown; warnings?: unknown[] } | undefined;
    expect(member
      ? { warningCount: member.warningCount, omittedWarningCount: member.omittedWarningCount, named: member.warnings?.length }
      : 'absent: GET /content/slots carries no `constraintDiagnostics` member',
      `W20.R1 — every one of the ${WIDE_REFUSED} refused eligible pieces is counted, the first 50 are named and the rest are counted as omitted (R77(a))`)
      .toEqual({ warningCount: WIDE_REFUSED, omittedWarningCount: WIDE_REFUSED - 50, named: 50 });
    expect(member?.warnings ?? 'absent',
      'W20.R1 — and the 50 named are the first in catalogue order, each naming the pair that refused it')
      .toMatchObject(Array.from({ length: 50 }, (_, index) => ({ slot: 'feature', contentId: `cnt-fr-${String(index).padStart(3, '0')}`,
        reason: 'excluded_tag', dimension: 'locale', value: 'fr-FR' })));
  }, 60_000);
});

// ===========================================================================
// unit:W20.R2 — the operator console renders the governance block
// ===========================================================================

/**
 * The counts run over a horizon, not over one revision (kit 02: `since` is the
 * horizon, 30 days): 30 of the 37 refusals are of the band's current dead pin,
 * 7 of `cnt-winter-edit`, the pin an earlier revision carried before the
 * merchandiser replaced it. Its id is on no other part of the row, so the row
 * naming it can only be the governance block's `refusedPins` detail.
 */
const REFUSALS = 37;
const EARLIER_PIN = 'cnt-winter-edit';
const EARLIER_REFUSALS = 7;
const SHORT_TAKES = 43;
/** 18 short takes that left two positions empty and 25 that left one. */
const SHORT_POSITIONS = 18 * 2 + 25 * 1;

describe('unit:W20.R2', () => {
  it('sdk: on the shipped console’s Slots screen each slot’s row shows its governance block — the refused pin, how often and why, and a pinned slot’s short takes with the positions left empty — read from the mounted operator slots page', async () => {
    const m = await mount();
    await publishFixture(m, GOVERNANCE_PAGE, GOVERNANCE_PIECES);

    // PRECONDITION: before any occurrence the rows exist and show none of the numbers below.
    const quiet = await openConsole(m, `#/slots?scope=${TENANT}`);
    try {
      for (const slot of ['feature', 'promo', 'story']) expect(quiet.row(slot), `the Slots screen lists ${slot}`).not.toMatch(/^absent:/);
      expect([REFUSALS, SHORT_TAKES, SHORT_POSITIONS].filter(n => standalone(n).test(quiet.row('feature') + ' ' + quiet.row('promo'))),
        'PRECONDITION — the numbers this unit looks for are not already on the rows for another reason').toEqual([]);
      expect([EARLIER_PIN, 'missing'].filter(word => quiet.row('feature').includes(word)),
        'PRECONDITION — nor are the earlier pin’s id and the reason word').toEqual([]);
    } finally { quiet.close(); }

    await occur(m, DEAD_PIN, REFUSALS - EARLIER_REFUSALS);
    await occur(m, { refusedPins: [{ slot: 'feature', pinnedPieceId: EARLIER_PIN, reason: 'missing_or_ineligible' }], shortTakes: [] }, EARLIER_REFUSALS);
    for (let i = 0; i < SHORT_TAKES; i++) await occur(m, shortTake(i < 18 ? 2 : 1), 1);
    // PRECONDITION: the operator route the console reads carries the counts.
    const page = await slotsPage(m);
    expect([governanceOf(page.rows.find(r => r.slot === 'feature'))?.refusedPinCount, governanceOf(page.rows.find(r => r.slot === 'promo'))?.shortTakePositions],
      'PRECONDITION — the operator slots page carries the counts the console is to render').toEqual([REFUSALS, SHORT_POSITIONS]);

    const c = await openConsole(m, `#/slots?scope=${TENANT}`);
    try {
      const feature = c.row('feature'), promo = c.row('promo');
      expect(feature, `W20.R2 — the feature row names the pins refused over the horizon, ${EARLIER_PIN} among them: "${feature}"`).toContain(EARLIER_PIN);
      expect(feature, `W20.R2 — and how often it was refused, ${REFUSALS}: "${feature}"`).toMatch(standalone(REFUSALS));
      expect(feature, `W20.R2 — and why, in the runtime reason word missing_or_ineligible: "${feature}"`).toMatch(/missing[_ ]or[_ ]ineligible/);
      expect(promo, `W20.R2 — the promo row shows how many times the pinned slot fell short of its take, ${SHORT_TAKES}: "${promo}"`).toMatch(standalone(SHORT_TAKES));
      expect(promo, `W20.R2 — and the positions those short takes left empty, ${SHORT_POSITIONS}: "${promo}"`).toMatch(standalone(SHORT_POSITIONS));
    } finally { c.close(); }
  }, 90_000);
});

// ===========================================================================
// unit:W20.R3 — every slot row carries its governance block past the 200-slot budget,
// or the three promising sentences are corrected
// ===========================================================================

const BUDGET = 200;
const WIDE_SLOTS = 205;
const bandName = (index: number) => `band-${String(index).padStart(3, '0')}`;
const BUDGET_PAGE = authorable({
  home: Array.from({ length: WIDE_SLOTS }, (_, index) => ({ slot: bandName(index), take: 1, weights: { line: 1 } })),
});

describe('unit:W20.R3', () => {
  it('host: on a 205-slot page every row of the operator slots page carries its governance block, the rows past the shared 200-slot budget included and with their own counts — or the three sentences promising it are corrected', async () => {
    const m = await mount();
    await publishFixture(m, BUDGET_PAGE, GOVERNANCE_PIECES);
    const lastBand = bandName(WIDE_SLOTS - 1);
    await occur(m, { refusedPins: [{ slot: lastBand, pinnedPieceId: 'cnt-sold-out', reason: 'missing_or_ineligible' }], shortTakes: [] }, 3);
    const page = await slotsPage(m);
    expect([page.status, page.rows.length], 'PRECONDITION — the operator slots page lists all 205 slots').toEqual([200, WIDE_SLOTS]);
    const withoutBlock = page.rows.filter(row => typeof governanceOf(row)?.refusedPinCount !== 'number' && governanceOf(row)?.status !== 'unavailable').map(row => row.slot);
    const everyRow = withoutBlock.length === 0;

    const kit = raw(KIT), rest = flat(raw(REST));
    const kitRow = kit.split('\n').find(line => line.startsWith('| `GET learn/slots')) ?? '';
    const corrected = !flat(kit).includes(KIT_NEVER_OMITTED) && !rest.includes(REST_NEVER_OMITTED) && /\b200\b/.test(kitRow);

    expect(everyRow || corrected,
      `W20.R3 — rows ${JSON.stringify(withoutBlock)} carry no governance block past the ${BUDGET}-slot budget (src/routes/decisions.ts assigns it after the budget check), while ${KIT} still says "${KIT_NEVER_OMITTED}", ${REST} still says "${REST_NEVER_OMITTED}" and the kit's learn/slots row does not name the budget`)
      .toBe(true);
    if (everyRow) {
      expect(governanceOf(page.rows.find(row => row.slot === lastBand))?.refusedPinCount,
        `W20.R3 — and the block past the budget carries that slot's own counts, not a placeholder: ${lastBand} was refused 3 times`).toBe(3);
    }
  }, 60_000);
});

// ===========================================================================
// unit:W20.R4 — the slots page names a store outage instead of an unobserved zero
// ===========================================================================

describe('unit:W20.R4', () => {
  it('host: every governance block of the operator slots page says `status: "available"` when the counter store was read, and `status: "unavailable"` with no count when it could not be, never a zero nobody observed', async () => {
    const m = await mount();
    await publishFixture(m, GOVERNANCE_PAGE, GOVERNANCE_PIECES);
    await occur(m, DEAD_PIN, 2);

    const healthy = await slotsPage(m);
    expect(healthy.status).toBe(200);
    expect(healthy.rows.map(row => [row.slot, governanceOf(row)?.status ?? 'no status', governanceOf(row)?.refusedPinCount]),
      'W20.R4 — a readable store: every block says so in one word (`status`, the advisory channel’s precedent, R111(ii)) beside the counts it read')
      .toEqual([['feature', 'available', 2], ['promo', 'available', 0], ['story', 'available', 0]]);

    // The counter store cannot be read (the outage probe D2 of the whole-W20 delta).
    m.cache.failGet = key => key.startsWith('slot-governance:');
    const outage = await slotsPage(m);
    expect(outage.status, 'the slots page itself still answers during the counter outage').toBe(200);
    for (const row of outage.rows) {
      expect(governanceOf(row) ?? { absent: `${String(row.slot)} carries no governance block` },
        `W20.R4 — ${String(row.slot)}: during the outage the block names it and states no count (feature read 2 a moment ago; a 0 here would be a zero nobody observed)`)
        .toMatchObject({ status: 'unavailable', refusedPinCount: null, refusedPins: null, shortTakeCount: null, shortTakePositions: null });
    }
  }, 60_000);
});

// ===========================================================================
// unit:W20.R5 — safeGovernance drops coerced non-finite values instead of stating them
// ===========================================================================

/** A kept monitor record, as the safe projection receives it. */
const keptRecord = (governance: Record<string, unknown>) => ({ at: 1, ok: true, checks: {}, problems: [], alert: { kind: null, status: 'not-needed' }, governance });
/** What the projection answers for that record with no counters at all. */
const WITHOUT_GOVERNANCE = { at: 1, tenant: TENANT, environment: 'test', ok: true, checks: {}, problems: [], alert: { kind: null, status: 'not-needed' } };
/** R111(i): all three finite and non-negative, or the member is dropped. */
const UNUSABLE: Array<[string, Record<string, unknown>]> = [
  ['refusedPinCount NaN', { since: 5, refusedPinCount: NaN, shortTakeCount: 0 }],
  ['refusedPinCount Infinity', { since: 5, refusedPinCount: Infinity, shortTakeCount: 0 }],
  ['shortTakeCount -Infinity', { since: 5, refusedPinCount: 1, shortTakeCount: -Infinity }],
  ['since Infinity', { since: Infinity, refusedPinCount: 1, shortTakeCount: 1 }],
  ['refusedPinCount -1', { since: 5, refusedPinCount: -1, shortTakeCount: 0 }],
];

describe('unit:W20.R5', () => {
  it('logic: the monitor projection drops a kept governance member whose counts or horizon are not finite non-negative numbers, and keeps a usable one exactly', () => {
    expect(projectMonitor(keptRecord({ since: 5, refusedPinCount: 2, shortTakeCount: 1 }), TENANT, 'test'),
      'control — a usable member is kept, with the scope stated').toEqual({ ...WITHOUT_GOVERNANCE, governance: { since: 5, scope: 'tenant', refusedPinCount: 2, shortTakeCount: 1 } });
    for (const [label, governance] of UNUSABLE) {
      expect(projectMonitor(keptRecord(governance), TENANT, 'test'),
        `W20.R5 — ${label}: the projection answers the record without \`governance\`, instead of stating a clamped number beside \`scope: 'tenant'\``)
        .toEqual(WITHOUT_GOVERNANCE);
    }
  });

  it('host: the operator’s read of a kept monitor result whose stored counters were corrupted answers it without `governance`, while the same record intact answers its counters', async () => {
    const m = await mount({ keepMonitorResult: true });
    await publishFixture(m, GOVERNANCE_PAGE, GOVERNANCE_PIECES);
    await occur(m, DEAD_PIN, 2);
    const run = await operatorPost(m, `/v1/${TENANT}/monitor`);
    expect(run.status, `the monitor run answers: ${JSON.stringify(run.body).slice(0, 300)}`).toBe(200);
    await m.drain();
    const intact = m.cache.data.get(monitorKey(TENANT));
    expect(typeof intact, 'PRECONDITION — the run was kept').toBe('string');
    const readLast = async () => ((await operatorGet(m, `/v1/${TENANT}/monitor`)).body.last ?? null) as MonitorResult | null;
    expect((await readLast())?.governance?.refusedPinCount ?? 'absent',
      'PRECONDITION — the intact kept result is read back with its counters').toBe(2);

    // JSON cannot carry NaN; `1e999` is how a stored byte becomes Infinity (R111(i)).
    for (const [member, stored] of [['refusedPinCount', '1e999'], ['shortTakeCount', '-1e999'], ['since', '1e999'], ['refusedPinCount', '-1']] as const) {
      const record = JSON.parse(intact!) as { governance: Record<string, unknown> };
      record.governance[member] = '__CORRUPT__';
      m.cache.data.set(monitorKey(TENANT), JSON.stringify(record).replace('"__CORRUPT__"', stored));
      const last = await readLast();
      expect(last?.tenant ?? 'absent: the corrupted record was not read back at all', `PRECONDITION — the record with ${member} ${stored} is still read`).toBe(TENANT);
      expect(last !== null && Object.prototype.hasOwnProperty.call(last, 'governance') ? `stated: ${JSON.stringify(last.governance)}` : 'dropped',
        `W20.R5 — a kept result whose ${member} reads ${stored} answers without \`governance\`, never a clamped count beside \`scope: 'tenant'\``).toBe('dropped');
    }
  }, 120_000);
});

// ===========================================================================
// unit:W20.R6 — the kit monitor row names scope; the floor sentence is in api 01
// ===========================================================================

describe('unit:W20.R6', () => {
  it('logic: the kit’s `GET /v1/{tenant}/monitor` row names `scope`, and docs/api/01-rest-endpoints.md states the counters’ floor in the sentence the kit states it in', () => {
    const row = raw(KIT).split('\n').find(line => line.startsWith('| `GET /v1/{tenant}/monitor`')) ?? 'absent: no GET monitor row in the kit';
    expect(row, `W20.R6 — ${KIT}'s GET monitor row must name the \`scope\` its governance counters are kept at (R110(4), R111(iv))`).toMatch(/\bscope\b/);
    expect(flat(raw(REST)).includes(flat(FLOOR_SENTENCE)),
      `W20.R6 — ${REST} must state the floor as the kit does: "${FLOOR_SENTENCE}" (R111(iv))`).toBe(true);
  });
});

// ===========================================================================
// unit:W20.R7 — no PS sentence promises cross-page dedupe or a declarable per-slot fallback
// ===========================================================================

/** A sentence that names either capability the owner decided is not offered (D1, D2). */
const NAMES_UNOFFERED = /cross-page (dedup|duplicate)|per-slot fallback|declarable (per-slot )?fallback/i;
/** …and says it is not offered. */
const NEGATED = /\b(not|no|never|cannot|without)\b/i;

describe('unit:W20.R7', () => {
  it('logic: no sentence of the PS delivery guide or the PS runbook offers cross-page duplicate prevention or a declarable per-slot fallback (decisions D1 and D2)', () => {
    for (const file of [GUIDE, RUNBOOK]) {
      const sentences = flat(raw(file)).split(/(?<=[.!?])\s+/);
      const promising = sentences.filter(sentence => NAMES_UNOFFERED.test(sentence) && !NEGATED.test(sentence));
      expect(promising.map(sentence => sentence.slice(0, 400)),
        `W20.R7 — ${file} must not promise what D1 (duplicate prevention is per page decision) and D2 (no declarable per-slot fallback) rule out`).toEqual([]);
    }
  });
});
