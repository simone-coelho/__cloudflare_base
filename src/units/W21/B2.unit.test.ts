// src/units/W21/B2.unit.test.ts
// W21 batch B2 — what W21-B1's two build reviews routed forward: report
// authentication on the build POST's own gate, the outcome stamp's containment,
// an honest `saltVersion` off the serving path, the kit corrections the B1 units
// did not reach, the rendered-acknowledgement capture, and the window listing's
// budget.
//
// One `describe('unit:W21.<id>')` per unit of batch W21-B2, one `it` per ruled
// leg. Every expected value comes from a witness or from a behaviour measured
// first and recorded in this batch's probe log
// (`_evidence/W21-B2/specifier/logs/probe-*.log`).
//
// WITNESSES
//   · document 35 §5 row W21 (:423).
//   · F25 §5.1: "The window report is not authenticated … anyone who can view
//     source on the storefront can read per-arm conversion rates, incrementality
//     intervals and target standing for the brand. The console's own error
//     handler expects 401/403 here (views-measure.js:37), so this looks
//     unintended." §7: authentication "should ride along".
//   · F07 §7: the enrollment/provenance remedy; R101(a) never re-derives a
//     stored block.
//   · `_evidence/W21-B1/reviewer-build/REPORT-DELTA.md`: **NR1** (with the
//     enrollment resolution made to throw, `/realtime/action` answered 500 and
//     the outcome was never enqueued), **NR3** (`saltVersionOf` is awaited on the
//     serving path and walks up to 24 prior revisions on a cold isolate),
//     **NR4** (past the window the count can DECREASE, and a partial walk caches
//     a number), **NR5** (the counter is a lower bound), **NR7** (the outcome
//     export can answer a `record.experiment` carried from the credited
//     decision's stored block), and **F8**'s two stale kit-03 sentences.
//   · `REPORT.md` beside it, **F12**: the window listing issues up to 184
//     sequential `list` calls and checks the object budget only between days.
//   · rulings R10, R19, R21, R68(a), R87(b), R100(c), R101(a), R108, R112(d),
//     R118, R121, R126.
//
// WHAT THIS BATCH DOES NOT CLAIM, named on every row that touches it:
//   · the hour-aggregate report path (`reportFromHours`) still groups by the
//     arm SERVED and answers `armVisitors: null` — W21-B3, after W22-B2's
//     shard-state change. Nothing here asserts otherwise.
//   · `W21.P1.01`, the owner's protocol row, is untouched.
//   · whether the enrollment anchor may outlive identity retention is an owner
//     item (R118(c)).
//   · NR2 (`/realtime/action` answers 500 on a total publication outage even
//     with the stamp disabled) is pre-existing and out of scope; W21.E1.06
//     faults the STAMP alone, never the publication the route itself needs.
//
// ONE REPRESENTATION, shared with W21-B1 (`src/units/W21/B1.unit.test.ts`) so
// the two batches describe one product:
//   (i)   the served `arm` is the EXPERIENCE; `experiment.arm` is the
//         experimental ASSIGNMENT, `ineligible` with a `reason` when she is not
//         in the experiment (R108(2), R118(2)).
//   (ii)  a stored provenance block is delivered unchanged and never re-derived
//         (R101(a)); this batch adds the rendered acknowledgement to the paths
//         that must obey it.
//   (iii) `experiment.id` is `${tenant}:${brand}:${effective salt}` and is the
//         join key; `saltVersion` counts published salts and, where the product
//         cannot see far enough back to count them, says so with `null` rather
//         than a smaller number.
//   (iv)  the fixture ids, buckets and salts are W21-B1's, so the documented
//         bucket table holds unchanged: with salt `w21-b1-experiment-a` and
//         share 0.5, `vis-00000021-0b01-4000-8000-000000000000` draws the
//         control arm (bucket 0.158671) and account `coach-account-0002`
//         resolves to `sh_771129f4292b93372e7a7816341ef66b` (bucket 0.574288,
//         the treated side).
//
// RULED MISSING MEMBERS (R21), each named on its row and RED until it exists:
//   1. `saltVersion: number | null` — `null` where the published history the
//      product can see does not reach the first salt, and on a partial or
//      failed walk (W21.E1.07).
//   2. the two report GETs answer 401 without an operator credential in every
//      auth mode (W21.C1.05) — a behaviour, not a member.
//   3. the five corrected kit sentences and the two stale ones removed
//      (W21.C1.06).

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import * as jose from 'jose';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { armFor } from '@/content/holdout';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, HoldoutConfig, SlotCatalog } from '@/content/types';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { decisionRoutes } from '@/routes/decisions';
import { identityRoutes } from '@/routes/identity';
import realtimeRoutes from '@/routes/realtime';
import { contentRoutes } from '@/routes/content';
import { configRoutes } from '@/routes/config';
import operatorRoutes from '@/routes/operator';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { signAssertion } from '@/identity/assertion';
import { consumeLedger } from '@/ledger/consume';
import { captureRetention } from '@/retention';
import { reportKey, REPORT_MEASUREMENT } from '@/learn/report';
import { ts36 } from '@/ledger/records';
import { configuredDestinations } from '@/connectors/config';
import type { Env } from '@/types/env';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

/**
 * W21.E1.06 (NR1): the reviewer's control, as a fixture fault rather than a
 * product edit. Every other unit in this file runs the real implementation —
 * the module is re-exported whole and only `outcomeEnrollment` is wrapped, and
 * only while `stampFault.throws` is set by the one unit that owns it.
 */
const stampFault = { throws: false };
vi.mock('@/content/holdout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/content/holdout')>();
  return {
    ...actual,
    outcomeEnrollment: async (...args: Parameters<typeof actual.outcomeEnrollment>) => {
      if (stampFault.throws) throw new Error('synthetic enrollment resolution failure');
      return actual.outcomeEnrollment(...args);
    },
  };
});

// never in product code (METHOD §6).
// ===========================================================================

const TENANT = 'coach';
const SALT_A = 'w21-b1-experiment-a';
const SALT_B = 'w21-b1-experiment-b';
const OPERATOR_SECRET = 'w21-b2-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const IDENTITY_SECRET = 'w21-b2-identity-assertion-material';

/**
 * A caller's OWN business targets (F25 §5.2). Deliberately none of Tapestry's
 * {0.10, 0.40, 0.60}, so a compiled constant cannot satisfy the logic leg of
 * W21.C1.04: the same interval is a different rung under these numbers.
 */
const CALLER_TARGETS = { minimum: 0.05, target: 0.15, stretch: 0.25 } as const;

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});

const W21_PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening-edit', { title: 'Evening, restated',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-rogue-work-edit', { title: 'The Rogue, at work',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-charms-lookbook', { title: 'Charms, a lookbook', type: 'lookbook',
    tags: { occasion: ['evening'], category: ['Small Leather Goods'] } }),
];
const W21_CATALOGUE = { version: 'w21-b2-coach-catalogue', pieces: W21_PIECES };

/** One page, one slot, take 1: one decision per served page, so every count below is exact. */
const W21_SLOTS: SlotCatalog = { version: 'w21-b2-coach-slots',
  pages: { home: [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }] } };

interface LearnFixture {
  salt?: string;
  share?: number;
  /** W21.E1.08: the durable rendered-acknowledgement path (`LEDGER_RECOVERY_ENABLED`). */
  recovery?: boolean;
  /** Per-slot dials; W21.E1.08 publishes `hero` on the rendered measurement basis. */
  slots?: Record<string, Record<string, unknown>>;
}
const learnDocument = (f: LearnFixture = {}) => ({
  holdout: { share: f.share ?? 0.5, salt: f.salt ?? SALT_A, arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: f.slots ?? {},
});

// ===========================================================================
// The mounted application, in process, the way `src/index.ts` mounts it, on
// either shopper host. Harness pattern reused from `src/units/W20/B1.unit.test.ts`
// and `src/routes/realtime.sdkContract.test.ts`; neither suite is imported or
// edited.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  /** A store that answers an error for these key prefixes (W21.E1.05, case (a)). */
  failPrefixes: string[] = [];
  /** A store whose value for these key prefixes has gone (expired or never written) (case (b)). */
  hidePrefixes: string[] = [];
  async get(key: string, type?: string) {
    if (this.failPrefixes.some(prefix => key.includes(prefix))) throw new Error('synthetic key-value read failure');
    if (this.hidePrefixes.some(prefix => key.includes(prefix))) return null;
    const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v; }
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
  /** Every storage call this mount has made, in order: `get <key>` / `list <prefix>`. */
  calls: string[] = [];
  /** A store that answers an error for these key prefixes. */
  failPrefixes: string[] = [];
  /** A store that answers an error for the keys this predicate names. */
  failWhen: ((key: string) => boolean) | null = null;
  async get(key: string, options?: R2GetOptions) {
    this.calls.push(`get ${key}`);
    if (this.failPrefixes.some(prefix => key.includes(prefix)) || this.failWhen?.(key)) throw new Error('synthetic object-store read failure');
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { key, etag: 'v' + this.versions.get(key), size: bytes.length, customMetadata: this.metadata.get(key),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    this.calls.push(`list ${options.prefix ?? ''}`);
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: (this.objects.get(key) ?? '').length, uploaded: new Date(0) })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixturePolicy: RetentionPolicy = { id: 'w21-b2-fixture-policy', revision: 1, durationMs: 365 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface Mounted {
  env: Env;
  storage: UnitR2;
  sessions: UnitKV;
  cache: UnitKV;
  fetch: (input: Request) => Promise<Response>;
  drain: () => Promise<void>;
  /** Everything the producer put on the queue, written to R2 by the real consumer. */
  drainLedger: () => Promise<void>;
  operatorToken: string;
}

async function mount(host: 'session' | 'do', learn: LearnFixture = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const queued: unknown[] = [];
  const storage = new UnitR2();
  const cache = new UnitKV(), sessions = new UnitKV();
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>();
  const stub = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) };
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    REFLEX_HOST: host, STORAGE: storage,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:${IDENTITY_SECRET}`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: stub, DECISION_RING: stub, LEARN_STATS: stub,
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); } },
  } as unknown as Env;
  env.RETENTION = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });
  try {
    const policies = fixtureCategories([TENANT]);
    for (const destination of await configuredDestinations(env, TENANT, () => { /* the fixture reports no destination diagnostics */ })) policies[TENANT]![destination.category] = fixturePolicy;
    env.RETENTION = JSON.stringify({ version: 1, tenants: policies });
  } catch { /* a malformed registry still reaches the production refusal */ }
  if (learn.recovery) {
    // The durable rendered-admission fixture, as `src/routes/realtime.sdkContract.test.ts`
    // (W15) configures it: the recovery categories, the switch, and the two real
    // objects the admission writes through.
    const policies = JSON.parse(env.RETENTION!) as { tenants: Record<string, Record<string, RetentionPolicy>> };
    for (const categories of Object.values(policies.tenants)) for (const key of ['recovery', 'quarantine']) categories[key] = fixturePolicy;
    env.RETENTION = JSON.stringify(policies);
    env.LEDGER_RECOVERY_ENABLED = 'true';
    for (const [binding, Class] of [['DECISION_RING', DecisionRing], ['LEARN_STATS', LearnStats]] as const) {
      const instances = new Map<string, DecisionRing | LearnStats>();
      (env as unknown as Record<string, unknown>)[binding] = { idFromName: (name: string) => name, get: (name: string) => ({
        fetch: (url: string, init?: RequestInit) => {
          let instance = instances.get(name);
          if (!instance) { instance = new Class(objectState(`${binding}:${name}`), env); instances.set(name, instance); }
          return instance.fetch(new Request(url, init));
        } }) };
    }
  }

  function objectState(name: string): DurableObjectState {
    const data = new Map<string, unknown>(); let alarm: number | null = null;
    const operations = (target: Map<string, unknown>) => ({
      get: async (key: string) => structuredClone(target.get(key)),
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'string') target.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) target.set(k, structuredClone(v));
      },
      delete: async (key: string) => target.delete(key),
      list: async (o?: { prefix?: string }) => structuredClone(new Map([...target].filter(([key]) => key.startsWith(o?.prefix ?? '')))),
      getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; }, deleteAlarm: async () => { alarm = null; },
    });
    return { id: name, storage: { ...operations(data), transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const candidate = structuredClone(data), result = await work(operations(candidate));
      data.clear(); for (const [k, v] of candidate) data.set(k, v); return result;
    } } } as unknown as DurableObjectState;
  }

  env.SHOPPER_REFLEX = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = objects.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [], sockets: WebSocket[] = [];
        const state = { id: name, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p), storage: {
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
        } } as unknown as DurableObjectState;
        item = { data, shopper: new ShopperReflex(state, env) };
        objects.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  } as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  app.route('/v1', identityRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w21-b2-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, W21_CATALOGUE),
    baseline(SLOTS_KIND, W21_SLOTS),
    baseline(LEARN_KIND, learnDocument(learn)),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  const drainLedger = async () => {
    await drain();
    if (!queued.length) return;
    const bodies = queued.splice(0);
    const result = await consumeLedger(env, bodies);
    expect(result.error, 'the fixture ledger batch must be written by the real consumer').toBeUndefined();
  };
  return { env, storage, sessions, cache, fetch: fetchOne, drain, drainLedger, operatorToken };
}

/**
 * The experimental ASSIGNMENT vocabulary (representation (iv)/(v)): the three
 * arms a randomised visitor can be enrolled in, and the one value that says she
 * is not in the experiment. Declared here so the harness's answer shape is as
 * narrow as the product member the build types `Assignment`
 * (`src/content/types.ts`, R118(h)); the product type is not imported because
 * this specification must typecheck before the build exports it.
 */
type Assignment = 'personalized' | 'default' | 'no_learning' | 'ineligible';

const HOSTS = ['session', 'do'] as const;

/** The published assignment, as `src/content/service.ts:376` composes it. */
const HOLDOUT: HoldoutConfig = { share: 0.5, salt: SALT_A, arms: ['default'] };

// ── The shopper on the mounted application ──────────────────────────────────

interface SnapshotAnswer {
  status: number;
  arm: string;
  served: string[];
  /** The delivery decisions as the route answers them, with any render offer. */
  decisions: Array<{ slot?: string; contentId?: string; decisionId?: string; renderOffer?: string }>;
  /** RULED, ABSENT TODAY (R21): representation (v) above. */
  experiment?: { id: string; saltVersion: number; arm: Assignment; anchorGeneration: number;
    /** Why an assignment is `ineligible`; absent on a randomised assignment (R118(2)). */
    reason?: 'personalization_consent' | 'anchor_unavailable' };
}

interface Shopper {
  subject: string;
  sessionId: string;
  capability: string;
  snapshot: (pageInstance?: string) => Promise<SnapshotAnswer>;
  act: (event: { type: string; data: Record<string, unknown> }) => Promise<number>;
  actFully: (event: { type: string; data: Record<string, unknown> }) => Promise<{ status: number; body: Record<string, unknown> }>;
  /** The shopper's own consent switches, through the route the SDK calls. */
  choose: (consent: { tracking: boolean; personalization: boolean }) => Promise<number>;
}

async function shopperOn(m: Mounted, subject: string, consent: { tracking: boolean; personalization: boolean }): Promise<Shopper> {
  const sessionId = `s-${subject.replace(/^vis-/, '')}`;
  const grant = await issueSessionCapability(m.env, { tenant: TENANT, subject, sessionId, kind: 'anonymous' });
  const shopper = await withCapability(m, subject, sessionId, grant.capability,
    { grantId: grant.grantId!, iat: grant.iat, exp: grant.exp });
  expect(await shopper.choose(consent), `the shopper's consent choice must be accepted for ${subject}`).toBe(200);
  return shopper;
}

async function withCapability(m: Mounted, subject: string, sessionId: string, capability: string,
  grant: { grantId: string; iat: number; exp: number }): Promise<Shopper> {
  const call = (path: string, body?: unknown) => m.fetch(new Request(`https://synthetic.invalid${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: capability, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const snapshot = async (pageInstance?: string): Promise<SnapshotAnswer> => {
    invalidatePublicationCache();
    const response = await call(`/v1/${TENANT}/decisions/snapshot?page=home${pageInstance ? `&pageInstance=${pageInstance}` : ''}`);
    const body = await response.clone().json().catch(() => ({})) as {
      arm?: string; decisions?: Array<{ slot?: string; contentId?: string; decisionId?: string; renderOffer?: string }>;
      experiment?: SnapshotAnswer['experiment'];
    };
    await m.drain();
    return { status: response.status, arm: body.arm ?? '?', experiment: body.experiment,
      decisions: body.decisions ?? [],
      served: (body.decisions ?? []).map(d => `${d.slot ?? '?'}:${d.contentId ?? '?'}`) };
  };
  const act = async (event: { type: string; data: Record<string, unknown> }) => {
    const response = await call('/realtime/action', { ...event, source: 'sdk', userId: subject, sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() });
    await m.drain();
    return response.status;
  };
  /** The same route, with the whole answer, for the clauses that read it. */
  const actFully = async (event: { type: string; data: Record<string, unknown> }) => {
    const response = await call('/realtime/action', { ...event, source: 'sdk', userId: subject, sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() });
    const body = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
    await m.drain();
    return { status: response.status, body };
  };
  let expectedRevision: string | null = null;
  const choose = async (consent: { tracking: boolean; personalization: boolean }) => {
    const response = await call(`/realtime/session/${sessionId}/preferences`, {
      trackingConsent: consent.tracking, personalizationEnabled: consent.personalization,
      choice: { id: crypto.randomUUID(), expectedRevision, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
    });
    await m.drain();
    const body = await response.clone().json().catch(() => ({})) as { consent?: { instruction?: { revision?: string } } };
    if (typeof body.consent?.instruction?.revision === 'string') expectedRevision = body.consent.instruction.revision;
    if (response.status !== 200) expect(response.status, `consent choice refused: ${await response.clone().text()}`).toBe(200);
    return response.status;
  };
  return { subject, sessionId, capability, snapshot, act, actFully, choose };
}

async function operatorGet(m: Mounted, path: string, authenticated = true): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    headers: { 'X-Tenant': TENANT, ...(authenticated ? { Authorization: `Bearer ${m.operatorToken}` } : {}) },
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/**
 * Publish a new revision of the tenant's learn document through the operator
 * route the console uses, so a salt rotation in a fixture is the same event a
 * customer's own rotation is (`PUT /content/learn`, If-Match on the revision and
 * the publication digest).
 */
async function republishLearn(m: Mounted, document: unknown): Promise<number> {
  const read = await operatorGet(m, `/content/learn?scope=${TENANT}`);
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  const publication = read.body.publication as { revision: number; digest: string };
  const response = await m.fetch(new Request(`${OPERATOR_ORIGIN}/content/learn?scope=${TENANT}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json',
      'If-Match': `"${read.body.revision as number}/${publication.revision}/${publication.digest}"`,
      'Idempotency-Key': `${read.body.revision as number}:${crypto.randomUUID()}` },
    body: JSON.stringify({ document, note: 'w21-b2 fixture rotation' }),
  }));
  const body = await response.clone().json().catch(() => ({})) as { revision?: number };
  expect(response.status, await response.clone().text()).toBe(200);
  invalidatePublicationCache(); invalidateCache(); invalidateLiftCache();
  return body.revision ?? 0;
}

async function operatorPost(m: Mounted, path: string, body: unknown, authenticated = true): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${m.operatorToken}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/** One published section of the customer kit, by its heading. */
function kitSection(file: string, heading: string): string {
  const text = readFileSync(new URL(`../../../docs/kit/${file}`, import.meta.url), 'utf8');
  const start = text.indexOf(`\n## ${heading}\n`);
  expect(start, `docs/kit/${file} must publish a "${heading}" section`).toBeGreaterThan(-1);
  const rest = text.slice(start + 1), end = rest.indexOf('\n## ', 1);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The ruled shape of a report answer, as this specification rules it (R21). */
interface ArmVisitorsBlock { version: number; basis: string; arms: Array<{ arm: string; visitors: number }> }
interface VisitorOutcomesBlock { version: number; basis: string; arms: Array<{ arm: string; visitors: number; byType: Record<string, number> }> }
interface RuledDayReport {
  tenant: string; brand: string; date: string;
  measurement: { kind: string; unit: string; inference: string };
  counts: { decisions: number; outcomes: number; visitors: number; truncated: boolean };
  holdout: Record<string, Array<{ arm: string; decisions: number; credited: number; creditedPerDecision: number | null }>>;
  holdoutComparison: Record<string, unknown[]>;
  coverage?: { status: string; truncated: boolean; missingHours: number[] };
  armVisitors?: ArmVisitorsBlock | null;
  allocation?: { version: number; source: string; share: number; arms: string[] };
  visitorOutcomes?: VisitorOutcomesBlock | null;
}
interface RuledWindowReport {
  tenant: string; brand: string; from: string; to: string;
  days: string[]; missing: string[];
  incomplete: Array<{ date: string; truncated: boolean; missingHours: number[] }>;
  measurement: { kind: string; inference: string };
  slots: Record<string, { arms: Array<{ arm: string; decisions: number; credited: number }>; comparisons: unknown[] }>;
  coverage: { status: string };
  armVisitors?: ArmVisitorsBlock | null;
}

const dayReportOf = (body: Record<string, unknown>) => body.report as unknown as RuledDayReport;
const windowReportOf = (body: Record<string, unknown>) => body.report as unknown as RuledWindowReport;

/**
 * The claim vocabulary the platform may not use about its own counts
 * (document 35 :423; F07 §3, §7; position 8). Each entry is a sentence or a
 * member value one of the witnesses quotes from the shipped code.
 */
const FORBIDDEN_CLAIMS = [
  'incrementality',
  'the holdout is the reason we can say so',
  'reached_stretch', 'reached_target', 'reached_minimum',
  'the target is reached', 'the stretch target is reached', 'the minimum is reached',
  'causal',
] as const;

function claimsIn(payload: unknown): string[] {
  const text = JSON.stringify(payload).toLowerCase();
  return FORBIDDEN_CLAIMS.filter(claim => text.includes(claim));
}

/**
 * The inference vocabulary a report answer may not carry at all — the delivered
 * containment `src/learn/report.test.ts:819` already locks, quoted from it.
 */
const INFERENCE_VOCABULARY = /UNSUPPORTED|confidence|verdict|targets|neededPerArm|relative|"lo"|"hi"/;

// ── The ledger fixture: real records, written by the real consumer ──────────

const cellOf = () => ({ channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: 'occasion:evening' });

function decisionRecord(input: { visitor: string; arm: string; ts: number; item: string; index: number }): DecisionRecord {
  return {
    decision_id: `${TENANT}:${input.ts.toString(36)}:${input.visitor}:home:hero:${input.index}`,
    tenant: TENANT, brand: TENANT, visitor_id: input.visitor, session_id: `s-${input.visitor}`, identity_anchor: 'visitor',
    ts: input.ts, page: 'home', slot: 'hero', position: 0, item_id: input.item, customer_item_id: `CMS-${input.item}`,
    candidates: [], cell: cellOf(), arm: input.arm as DecisionRecord['arm'], explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w21-b1',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
  } as unknown as DecisionRecord;
}

/**
 * An outcome row as the ledger holds it. With `eventId` the row carries the
 * STABLE logical identity `outcomeFromAction` produces for a nonce-bearing
 * event (`src/ledger/records.ts:262-266`): `event_id`, `event_id_source` and the
 * `:n1:` id form, which `logicalIdentity` (`src/ledger/delivery.ts:80-85`)
 * accepts as an exact retry. Without it the row is a LEGACY outcome, whose
 * timestamp-derived id can be two real events, and a second copy of it is
 * refused by `src/learn/report.ts:176` before equality is ever consulted.
 */
function outcomeRecord(input: { visitor: string; ts: number; type: string; item: string | null; index: number; eventId?: string }) {
  // The wire event names `rewardOf` maps (`src/ledger/records.ts:191-198`), so a
  // nonce-bearing row of either kind has a valid stable identity.
  const event = input.type === 'purchase' ? 'purchase' : 'content_click';
  return {
    outcome_id: input.eventId
      ? `${TENANT}:${ts36(input.ts)}:${input.visitor}:${event}:n1:${input.eventId}`
      : `${TENANT}:${input.ts.toString(36)}:${input.visitor}:${input.type}:${input.index}`,
    ...(input.eventId ? { event_id: input.eventId, event_id_source: 'provided' as const } : {}),
    tenant: TENANT, brand: TENANT, visitor_id: input.visitor, session_id: `s-${input.visitor}`, ts: input.ts,
    type: input.type, event,
    item_id: input.item, slot: input.item ? 'hero' : null, value: input.type === 'purchase' ? 210 : null,
    currency: input.type === 'purchase' ? 'USD' : null, margin: null, products: null, arm: null,
  };
}

/**
 * Put a day of arm-tagged records into the ledger through the real queue
 * consumer. A seeded decision may carry the RULED provenance block the serving
 * path answered (representation (v)); it is declared here, in the
 * specification's own type, because `DecisionRecord` does not carry it yet.
 */
type SeededDecision = DecisionRecord & { experiment?: SnapshotAnswer['experiment'] };
type SeededOutcome = ReturnType<typeof outcomeRecord> & { experiment?: SnapshotAnswer['experiment']; decision_id?: string };
async function seedLedgerDay(m: Mounted, date: string, decisions: SeededDecision[], outcomes: SeededOutcome[]): Promise<void> {
  const stamp = <T extends { ts: number }>(row: T) => ({ ...row, retention: captureRetention(m.env, TENANT, row.ts) });
  const bodies: unknown[] = [];
  if (decisions.length) bodies.push({ kind: 'ledger', type: 'decisions', version: 1, records: decisions.map(stamp) });
  for (const outcome of outcomes) bodies.push({ kind: 'ledger', type: 'outcome', version: 1, record: stamp(outcome) });
  const result = await consumeLedger(m.env, bodies);
  expect(result.error, `the ${date} ledger fixture must be written by the real consumer`).toBeUndefined();
  expect(result.skipped, `every ${date} fixture envelope must be admitted`).toBe(0);
}

const atUtc = (date: string, hour: number, minute = 0) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);

/** A day, stored the way the nightly job stores it, so the window can pool it. */
function storeLegacyDayReport(m: Mounted, date: string, holdout: Record<string, Array<{ arm: string; decisions: number; credited: number }>>,
  counts: { decisions: number; outcomes: number; visitors: number; truncated: boolean },
  hours?: { source: 'aggregates'; built: number[]; missing: number[] }): void {
  m.storage.objects.set(reportKey(TENANT, TENANT, date), JSON.stringify({
    tenant: TENANT, brand: TENANT, date, builtAt: atUtc(date, 23), counts,
    policies: [], grids: {}, exploration: [], measurement: REPORT_MEASUREMENT,
    holdout: Object.fromEntries(Object.entries(holdout).map(([slot, rows]) =>
      [slot, rows.map(r => ({ ...r, creditedPerDecision: r.decisions ? r.credited / r.decisions : null, rate: r.decisions ? r.credited / r.decisions : null }))])),
    holdoutComparison: Object.fromEntries(Object.keys(holdout).map(slot => [slot, []])),
    ...(hours ? { hours } : {}),
  }));
  m.storage.versions.set(reportKey(TENANT, TENANT, date), 1);
}

// ===========================================================================
// unit:W21.C1.01 — claims containment, and the relative interval the platform
// is allowed to compute.
// ===========================================================================


// ---------------------------------------------------------------------------
// The fixtures the B2 units add to W21-B1's harness.
// ---------------------------------------------------------------------------

/**
 * W21-B1's documented bucket table, unchanged (the salts are the same), so the
 * arm each id draws is the one that file derives and this file reuses:
 *   vis-…000000  bucket 0.158671 → the control arm while anonymous
 *   coach-account-0002 → sh_771129f4292b93372e7a7816341ef66b, bucket 0.574288
 *   vis-…000004  bucket 0.053950 → control side (the shopper who declines)
 *   vis-…000001  bucket 0.906276 → the treated side
 */
const ENROLLED_ANON = 'vis-00000021-0b01-4000-8000-000000000000';
const ENROLLED_ACCOUNT = 'coach-account-0002';
const ENROLLED_SHOPPER_ID = 'sh_771129f4292b93372e7a7816341ef66b';
const DECLINING_SHOPPER = 'vis-00000021-0b01-4000-8000-000000000004';
const OUTCOME_TREATED = 'vis-00000021-0b01-4000-8000-000000000001';
/**
 * A syntactically valid operator token this platform does not accept: signed
 * with different material, so `operatorJwt()` refuses it exactly as it refuses
 * an expired one. The screen holds a session; the platform says no.
 */
const REFUSED_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcHMiLCJ0eXBlIjoic2VydmljZSIsImlzcyI6ImkiLCJhdWQiOiJhIiwiZXhwIjo0MTAyNDQ0ODAwfQ.w21b2-not-this-platforms-signature';
/** A third published salt, for the history this batch walks. */
const SALT_C = 'w21-b2-experiment-c';

/** Every ledger row of one stream this mount holds, parsed from the NDJSON objects. */
function ledgerRows(m: Mounted, stream: 'decision' | 'outcome'): Array<Record<string, unknown>> {
  return [...m.storage.objects.entries()]
    .filter(([key]) => key.includes(`/${stream}/`) && key.endsWith('.ndjson'))
    .flatMap(([, raw]) => raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>));
}

/**
 * A published learn history: revision 1 carries the first salt and each later
 * revision the salt named for it, written through the operator publication
 * route so the walk reads exactly what a customer's own rotations leave behind.
 */
async function publishSaltHistory(m: Mounted, salts: readonly string[]): Promise<void> {
  for (const [index, salt] of salts.entries()) {
    await republishLearn(m, { holdout: { share: 0.5, salt, arms: ['default'] },
      regional: { enabled: false, kBlend: 1, minEvents: 30 + index }, slots: {} });
  }
}

/**
 * A shipped operator screen under jsdom, bound to the mounted application
 * (R68(a)). `console` is `public/console/index.html` with the scripts that page
 * loads; `learning` is the legacy learning screen still served at
 * `/legacy/learning.html`, whose `public/learning.js` reads the same report
 * GETs. `signedIn` decides only whether the browser holds an operator session —
 * the screens attach `Authorization` from it (`console/shell.js:93-94`,
 * `learning.js:60-61`) and attach nothing without it.
 */
async function openScreen(m: Mounted, screen: 'console' | 'learning', credential: 'operator' | 'refused' | 'none') {
  const pub = (file: string) => readFileSync(new URL(`../../../public/${file}`, import.meta.url), 'utf8');
  const page = screen === 'console' ? 'console/index.html' : 'legacy/learning.html';
  const hash = screen === 'console' ? '#/measure' : '';
  const dom = new JSDOM(pub(page), { url: `${OPERATOR_ORIGIN}/${screen === 'console' ? 'console/' : 'legacy/learning.html'}${hash}`,
    pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as {
    document: { body: { textContent: string | null } };
    localStorage: { setItem(key: string, value: string): void };
    eval(code: string): unknown; close(): void;
  };
  (w as unknown as { fetch: unknown }).fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const target = new URL(url, `${OPERATOR_ORIGIN}/`);
    return m.fetch(new Request(OPERATOR_ORIGIN + target.pathname + target.search, {
      method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }),
    }));
  };
  (w as unknown as { TextEncoder: unknown }).TextEncoder = TextEncoder;
  (w as unknown as { setInterval: (cb: () => void) => number }).setInterval = () => 0;
  if (credential !== 'none') w.localStorage.setItem('operator-session', JSON.stringify({
    accessToken: credential === 'operator' ? m.operatorToken : REFUSED_TOKEN, refreshToken: 'w21-b2-refresh', exp: Date.now() + 3_600_000,
    user: { id: 'ops', name: 'Test Operator', email: 'ops@brand.test', roles: ['admin'], tenants: [TENANT] }, mustChangePassword: false,
  }));
  for (const file of screen === 'console'
    ? ['operator-session.js', 'console/shell.js', 'console/views.js', 'console/views-config.js', 'console/views-measure.js', 'console/views-accounts.js', 'console/views-explore.js']
    : ['operator-session.js', 'learning.js']) w.eval(pub(file));
  const settle = async () => { for (let n = 0; n < 16; n++) await new Promise(resolve => setTimeout(resolve, 12)); };
  await settle();
  return { w, settle, text: () => (w.document.body.textContent || '').replace(/\s+/g, ' '), close: () => w.close() };
}

// ===========================================================================
// The ruled sentences this batch requires of the published kit (R126(d)), each
// asserted verbatim. The two stale ones are quoted from the measurement pass
// (`_evidence/W21-B2/specifier/logs/probe-all.log`, PROBE P4) so a reviewer can
// see exactly what is being removed.
// ===========================================================================

const KIT_STALE_SALT_VERSION = '`saltVersion` is the learn-document revision the enrollment was written under';
const KIT_STALE_CONSENT = 'Consent is not readable at record time';

const KIT_SALT_VERSION =
  '`saltVersion` counts the distinct salts this tenant has published up to the pinned revision, and is `null` where the published history the platform can read does not reach the first one.';
const KIT_OUTCOME_CONSENT =
  'The producer stamps the outcome with the visitor’s enrollment and her consent at the moment it is recorded, so an outcome recorded while personalization is off says `ineligible`; an outcome recorded on a path that does not stamp carries no block at all.';
const KIT_COUNTER_FLOOR =
  '`enrollment_anchor_unavailable` is a lower bound: concurrent anchor failures can collapse into one increment, so read it as a floor and never as an exact count.';
const KIT_EXPORT_BACKFILL =
  '`record.experiment` on this answer may be carried from the credited decision’s stored block, so it is not always byte-identical to the stored ledger line.';
const KIT_SALT_HORIZON =
  'The platform reads back at most 24 published learn revisions to count salts; past that horizon `saltVersion` is `null` rather than a smaller number.';

const kitFile = (file: string) => readFileSync(new URL(`../../../docs/kit/${file}`, import.meta.url), 'utf8');

// ===========================================================================
// unit:W21.C1.05 — report authentication on the build POST's own gate.
// ===========================================================================

/**
 * A day report with one unmistakable figure, so "prints no number" is
 * checkable. The screens read the day they open on — today — and a window
 * ending today, so the fixture is written for that day; `407` is the control
 * arm's decision count, which both screens print in their arm table
 * (`public/console/views-measure.js:178`, `:206`) below the thousands
 * separator, so the digits reach the DOM exactly as written.
 */
const AUDIT_DAY = new Date().toISOString().slice(0, 10);
const AUDIT_DECISIONS = 407;

function seedAuditDay(m: Mounted): void {
  storeLegacyDayReport(m, AUDIT_DAY, { hero: [{ arm: 'default', decisions: AUDIT_DECISIONS, credited: 29 }, { arm: 'personalized', decisions: 612, credited: 55 }] },
    { decisions: 1019, outcomes: 84, visitors: 700, truncated: false },
    { source: 'aggregates', built: [...Array(24).keys()], missing: [] });
}

describe('unit:W21.C1.05', () => {
  it('host: both report GETs answer 401 without a credential and 200 with the credential the build POST accepts, in the deployment default auth mode', async () => {
    const m = await mount('session');
    seedAuditDay(m);

    // F25 §5.1: measured at the spec head, both GETs answer 200 to a caller with
    // no credential at all in the default (open) mode — the mode a demo or dev
    // stamp runs — because `operatorWrites()` returns `next()` there
    // (`src/middleware/edgeAccess.ts:184-189`, `authMode` at :26-28). The build
    // POST beside them is gated in every mode by `operatorJwt()`
    // (`src/routes/decisions.ts:833`), and that is the gate this unit rules for
    // all three.
    const anonymousDay = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${AUDIT_DAY}`, false);
    expect(anonymousDay.status, 'F25 §5.1 — the day report GET requires an operator credential').toBe(401);
    const anonymousWindow = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${AUDIT_DAY}&to=${AUDIT_DAY}`, false);
    expect(anonymousWindow.status, 'F25 §5.1 — and so does the window report GET, which is the one the finding measured a storefront could read').toBe(401);

    // R112(d): the credential is the one `operatorJwt()` already accepts — the
    // service token this harness signs, exactly as the build POST takes it.
    // Nothing here requires an ACCOUNT session.
    const day = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${AUDIT_DAY}`);
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    expect(dayReportOf(day.body).holdout.hero?.find(row => row.arm === 'default')?.decisions,
      'and the operator reads the same report she always read').toBe(AUDIT_DECISIONS);
    const window = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${AUDIT_DAY}&to=${AUDIT_DAY}`);
    expect(window.status, JSON.stringify(window.body)).toBe(200);
    expect(windowReportOf(window.body).days, 'and the window answers the day it read').toEqual([AUDIT_DAY]);

    // The build POST is unchanged, and is the gate the two GETs now share.
    expect((await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: AUDIT_DAY, brand: TENANT }, false)).status,
      'the build POST keeps its own gate').toBe(401);
    expect((await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: AUDIT_DAY, brand: TENANT })).status,
      'and accepts the same credential the reads now require').toBe(200);
  });

  it('sdk: the shipped console screen renders the measurement for an operator the platform authenticates, and prints no number for one it refuses', async () => {
    const m = await mount('session');
    seedAuditDay(m);

    // (1) Signed in, with the credential the routes now require.
    const signedIn = await openScreen(m, 'console', 'operator');
    await signedIn.settle();
    expect(signedIn.text(), 'the shipped measurement screen reads the report for a signed-in operator')
      .toContain(String(AUDIT_DECISIONS));
    signedIn.close();

    // (2) Signed in with a credential the PLATFORM REFUSES — F25 §5.1's own
    // case: "The console's own error handler expects 401/403 here
    // (views-measure.js:37), so this looks unintended." Today the GETs answer
    // 200 to anyone, so the screen prints per-arm numbers to a caller whose
    // credential the platform never accepted.
    const refused = await openScreen(m, 'console', 'refused');
    await refused.settle();
    expect(refused.text(), 'F25 §5.1 — the screen says what it needs, in its own shipped words')
      .toContain('Sign in to read the measurement.');
    expect(refused.text().includes(String(AUDIT_DECISIONS)),
      'F25 §5.1 — and prints no per-arm number to a caller the platform refused').toBe(false);
    refused.close();

    // (3) Not signed in at all: the shell's own gate, and no measurement.
    const signedOut = await openScreen(m, 'console', 'none');
    await signedOut.settle();
    expect(signedOut.text(), 'a signed-out operator is asked to sign in').toContain('Sign in');
    expect(signedOut.text().includes(String(AUDIT_DECISIONS)),
      'and no measurement number is printed to her either').toBe(false);
    signedOut.close();
  });
});

// ===========================================================================
// unit:W21.E1.06 — the outcome stamp cannot fail the action.
// ===========================================================================

describe('unit:W21.E1.06', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a throwing enrollment resolution leaves the action answering as it does unstamped and the outcome recorded without a block, and the healthy path still stamps`, async () => {
      const m = await mount(host);
      const shopper = await shopperOn(m, ENROLLED_ANON, { tracking: true, personalization: true });
      const served = await shopper.snapshot();
      expect(served.arm, 'she is enrolled in the control arm').toBe('default');

      // NR1, measured in the delta review's scratch control and reproduced in
      // this batch's probe log: with `outcomeEnrollment` made to throw, the route
      // answered 500 and the outcome was never enqueued. The stamp is an
      // annotation computed beside the record (`src/content/holdout.ts:57-60`):
      // it may leave the block off, and it may not cost the record.
      stampFault.throws = true;
      let status = 0;
      try {
        status = await shopper.act({ type: 'purchase', data: { orderId: 'w21-b2-faulted', value: 240, currency: 'USD', productIds: ['SKU-TABBY-26'] } });
      } finally { stampFault.throws = false; }
      expect(status, 'NR1 — the action answers exactly as it answers with no stamp at all').toBe(200);
      await m.drainLedger();
      const faulted = ledgerRows(m, 'outcome').filter(row => row.type === 'purchase');
      expect(faulted.length, 'NR1 — and her outcome is on the ledger, never lost to the annotation').toBe(1);
      expect(Object.hasOwn(faulted[0]!, 'experiment'),
        'NR1 — unstamped, because a failed annotation leaves the block off rather than guessing one').toBe(false);

      // The healthy path is unchanged: this unit buys containment, not silence.
      expect(await shopper.act({ type: 'purchase', data: { orderId: 'w21-b2-healthy', value: 120, currency: 'USD', productIds: ['SKU-ROGUE-25'] } }),
        'her next purchase is accepted').toBe(200);
      await m.drainLedger();
      const stamped = ledgerRows(m, 'outcome').filter(row => row.type === 'purchase' && row.experiment !== undefined);
      expect(stamped.length, 'and the healthy path still stamps').toBe(1);
      expect((stamped[0]!.experiment as { arm?: string }).arm, 'with her enrolled assignment').toBe('default');
    });
  }
});

// ===========================================================================
// unit:W21.E1.07 — an honest `saltVersion`, off the serving path.
// ===========================================================================

describe('unit:W21.E1.07', () => {
  it('logic: past the history the platform can read, the salt version is an explicit unknown rather than a smaller number, and a partial walk is never cached as a number', async () => {
    // NR4: `saltVersionOf` walks at most `SALT_HISTORY_READS = 24` prior
    // revisions (`src/content/holdout.ts:103-124`), so a tenant with a longer
    // history is counted over the window it can see: rotations at revisions 2
    // and 30 read `2` at revision 31 and `1` at revision 60 — the number goes
    // DOWN, and two different salts both read `1`. A count that cannot see the
    // first salt is not a smaller count; it is unknown.
    const { saltVersionOf, invalidateSaltVersions } = await import('@/content/holdout');
    const m = await mount('session');
    // Revision 1 is the mount's own SALT_A; the salt rotates at revision 2 and
    // again at revision 30, so a 24-revision window opened at 30 sees only
    // SALT_B behind it and can never reach the first salt.
    await publishSaltHistory(m, [...Array.from({ length: 28 }, () => SALT_B), SALT_C]);
    const env = m.env;

    invalidateSaltVersions();
    expect(await saltVersionOf(env, TENANT, 3, TENANT, SALT_B),
      'inside the window the count is exact: one rotation behind revision 3').toBe(2);
    invalidateSaltVersions();
    expect(await saltVersionOf(env, TENANT, 30, TENANT, SALT_C),
      'NR4 — revision 30 cannot see revision 1 through a 24-revision window, so the number of salts before it is unknown').toBeNull();

    // A walk that breaks halfway is unknown too, and the unknown is not cached
    // as a number: the next healthy read answers the true count.
    invalidateSaltVersions();
    m.storage.failWhen = key => key.endsWith('/learn/rev/1.json');
    expect(await saltVersionOf(env, TENANT, 3, TENANT, SALT_B),
      'NR4 — a walk that cannot finish answers unknown rather than the count it happened to reach').toBeNull();
    m.storage.failWhen = null;
    invalidateSaltVersions();
    expect(await saltVersionOf(env, TENANT, 3, TENANT, SALT_B),
      'NR4 — and the unknown was never cached as a number: the next healthy read is exact').toBe(2);
  });

  it('host: the serving path answers without walking the salt history, states an unknown honestly, and keeps `experiment.id` as the join key', async () => {
    const m = await mount('session');
    const shopper = await shopperOn(m, ENROLLED_ANON, { tracking: true, personalization: true });
    await republishLearn(m, { holdout: { share: 0.5, salt: SALT_B, arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} });
    await republishLearn(m, { holdout: { share: 0.5, salt: SALT_B, arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 31 }, slots: {} });

    // NR3: measured at the spec head, a cold isolate's first decision after a
    // learn publication reads `learn/rev/3`, `rev/2` and `rev/1` BEFORE the
    // answer (`src/content/service.ts:392` awaits the walk). The version is
    // provenance, not a serving input: the shopper waits for none of it.
    const { invalidateSaltVersions } = await import('@/content/holdout');
    invalidateSaltVersions();
    m.storage.calls.length = 0;
    const served = await shopper.snapshot();
    const beforeAnswer = m.storage.calls.slice();
    expect(served.status, 'she is served').toBe(200);
    expect(beforeAnswer.filter(call => /\/learn\/rev\/\d+\.json$/.test(call) && !call.endsWith('/learn/rev/3.json')),
      'NR3 — no prior learn revision is read before the answer').toEqual([]);

    // The join key is unchanged, and the version is still the true count here.
    expect(served.experiment?.id, 'the join key names the salt in force').toBe(`${TENANT}:${TENANT}:${SALT_B}`);
    expect(served.experiment?.saltVersion, 'and this history is short enough to count exactly').toBe(2);

    // A history the platform cannot finish reading answers unknown, and still
    // serves and still names the experiment.
    const faulted = await mount('session');
    const other = await shopperOn(faulted, ENROLLED_ANON, { tracking: true, personalization: true });
    await republishLearn(faulted, { holdout: { share: 0.5, salt: SALT_B, arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} });
    invalidateSaltVersions();
    faulted.storage.failWhen = key => key.endsWith('/learn/rev/1.json');
    const unknown = await other.snapshot();
    expect(unknown.status, 'NR4 — an unreadable history is not a reason to refuse her a page').toBe(200);
    expect(unknown.experiment?.saltVersion, 'NR4 — the answer says unknown rather than the count it happened to reach').toBeNull();
    expect(unknown.experiment?.id, 'and `experiment.id` carries the salt itself, so the join key is unaffected')
      .toBe(`${TENANT}:${TENANT}:${SALT_B}`);

    // The bound is published, not folklore.
    expect(kitFile('02-api-reference.md').includes(KIT_SALT_HORIZON),
      `R126(c) — docs/kit/02-api-reference.md states the bound: "${KIT_SALT_HORIZON}"`).toBe(true);
  });
});

// ===========================================================================
// unit:W21.C1.06 — the kit says what the product does.
// ===========================================================================

describe('unit:W21.C1.06', () => {
  it('logic: the two stale provenance sentences are gone, the corrected ones are published verbatim, and both provenance rows name `reason`', () => {
    const kit03 = kitFile('03-payload-schemas.md'), kit02 = kitFile('02-api-reference.md');
    const decisionRow = kit03.split('\n').find(line => line.startsWith('| `experiment` |') && line.includes('this record'));
    const outcomeRow = kit03.split('\n').find(line => line.startsWith('| `experiment` |') && line.includes('VISITOR'));
    expect(decisionRow, 'the decision record still publishes its `experiment` row').toBeTruthy();
    expect(outcomeRow, 'and so does the outcome record').toBeTruthy();

    // F8, the two stale sentences the delta review measured (probe log P4).
    expect(kit03.includes(KIT_STALE_SALT_VERSION),
      'F8 — kit 03 no longer calls `saltVersion` the learn-document revision, which R118(6) replaced').toBe(false);
    expect(kit03.includes(KIT_STALE_CONSENT),
      'F8 — and no longer says consent is unreadable at record time, which R118(1)/(2) replaced').toBe(false);

    // What it says instead.
    expect(decisionRow!.includes(KIT_SALT_VERSION), `F8 — the decision row states: "${KIT_SALT_VERSION}"`).toBe(true);
    expect(outcomeRow!.includes(KIT_OUTCOME_CONSENT), `F8 — the outcome row states: "${KIT_OUTCOME_CONSENT}"`).toBe(true);
    for (const [name, row] of [['decision', decisionRow!], ['outcome', outcomeRow!]] as const) {
      expect(row.includes('`reason`'), `F8 — the ${name} row names \`reason\`, the member W21-B1 added`).toBe(true);
      for (const value of ['personalization_consent', 'anchor_unavailable']) {
        expect(row.includes(value), `F8 — and the ${name} row names the \`${value}\` reason`).toBe(true);
      }
    }

    // NR5 and NR7, the two sentences the reviewer asked for by name.
    expect(kit02.includes(KIT_COUNTER_FLOOR), `NR5 — the counter is published as a lower bound: "${KIT_COUNTER_FLOOR}"`).toBe(true);
    expect(kit02.includes(KIT_EXPORT_BACKFILL), `NR7 — the outcome export says so: "${KIT_EXPORT_BACKFILL}"`).toBe(true);
  });
});

// ===========================================================================
// unit:W21.E1.08 — the rendered acknowledgement carries the answered provenance.
// ===========================================================================

describe('unit:W21.E1.08', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the impression record of an enrolled, an ineligible and an anchor-unavailable shopper carries the experiment block the decision path answered, unchanged`, async () => {
      for (const shopperKind of ['enrolled', 'ineligible', 'anchor-unavailable'] as const) {
        const m = await mount(host, { slots: { hero: { measurementBasis: 'rendered-v1', gamma: 0 } }, recovery: true });
        const subject = shopperKind === 'enrolled' ? ENROLLED_ANON : shopperKind === 'ineligible' ? DECLINING_SHOPPER : OUTCOME_TREATED;
        const shopper = await shopperOn(m, subject, { tracking: true, personalization: shopperKind !== 'ineligible' });
        if (shopperKind === 'anchor-unavailable') { m.sessions.failPrefixes.push('identity:shopper:'); m.cache.failPrefixes.push('identity:shopper:'); }

        const pageInstance = `w21-b2-${shopperKind}`;
        const served = await shopper.snapshot(pageInstance);
        expect(served.status, `${shopperKind}: she is served`).toBe(200);
        const piece = served.decisions[0];
        expect(piece?.renderOffer, `${shopperKind}: the rendered basis offers her page an acknowledgement to send`).toBeTruthy();

        const ack = await shopper.actFully({ type: 'content_impression', data: { contentId: piece!.contentId, decisionId: piece!.decisionId,
          renderOffer: piece!.renderOffer, page: 'home', pageInstance, slot: 'hero', position: 0 } });
        expect(ack.status, `${shopperKind}: the acknowledgement is accepted`).toBe(200);
        await m.drainLedger();

        const captured = ledgerRows(m, 'decision').filter(row => row.visitor_id === subject);
        expect(captured.length, `${shopperKind}: the acknowledgement captured exactly one decision record`).toBe(1);
        expect(captured[0]!.measurementBasis, `${shopperKind}: on the rendered basis`).toBe('rendered-v1');
        // R101(a) with R100(c): the capture path stores the block the DECISION
        // path answered — never one re-derived at capture time, which is the
        // hazard the same rule already forbids on the export.
        expect(captured[0]!.experiment, `${shopperKind}: the captured record carries the answered provenance, unchanged`)
          .toEqual(served.experiment);
      }
    });
  }
});

// ===========================================================================
// unit:W21.C1.07 — the window listing keeps its budget honestly.
// ===========================================================================

describe('unit:W21.C1.07', () => {
  it('host: the object budget holds for the whole request, a truncated answer names exactly the days it read, and a long window of empty days is not paid for one listing at a time', async () => {
    const m = await mount('session');
    // F12: the budget is checked BETWEEN days (`src/routes/decisions.ts:598-608`),
    // so a day that starts inside the budget can carry the answer far past it.
    // Two days of 500 objects each: the second begins at 500 and ends at 1000.
    const big = ['2026-07-01', '2026-07-02'];
    for (const date of big) for (let n = 0; n < 500; n++) {
      m.storage.objects.set(`${TENANT}/${date}/09/decision/${String(n).padStart(4, '0')}-w21b2.ndjson`, '{}\n');
      m.storage.versions.set(`${TENANT}/${date}/09/decision/${String(n).padStart(4, '0')}-w21b2.ndjson`, 1);
    }
    const capped = await operatorGet(m, `/v1/${TENANT}/ledger/batches?from=2026-07-01&to=2026-07-03`);
    expect(capped.status, JSON.stringify(capped.body).slice(0, 200)).toBe(200);
    const cappedBody = capped.body as { objects?: unknown[]; days?: string[]; truncated?: boolean };
    expect((cappedBody.objects ?? []).length <= 800,
      `F12 — the object budget holds for the request as a whole, not between days (answered ${(cappedBody.objects ?? []).length})`).toBe(true);
    expect(cappedBody.truncated, 'F12 — and the answer says it stopped').toBe(true);
    // Exactly the days it read, whichever they are: the answer's own day list
    // must be the set its objects came from, never the whole requested range.
    expect(cappedBody.days, 'F12 — naming exactly the days it read')
      .toEqual([...new Set(((cappedBody.objects ?? []) as Array<{ date: string }>).map(object => object.date))]);

    // F12: 184 sequential listings for a six-month window whose content is two
    // days. The cost of an empty day is what the walk already pays to pass over
    // it, not a listing of its own.
    const wide = await mount('session');
    for (const date of ['2026-03-01', '2026-08-31']) {
      wide.storage.objects.set(`${TENANT}/${date}/09/decision/0001-w21b2.ndjson`, '{}\n');
      wide.storage.versions.set(`${TENANT}/${date}/09/decision/0001-w21b2.ndjson`, 1);
    }
    wide.storage.calls.length = 0;
    const listed = await operatorGet(wide, `/v1/${TENANT}/ledger/batches?from=2026-03-01&to=2026-08-31`);
    expect(listed.status, JSON.stringify(listed.body).slice(0, 200)).toBe(200);
    const lists = wide.storage.calls.filter(call => call.startsWith('list '));
    expect(lists.length <= 4, `F12 — a 184-day window with two days of content costs at most four listings (made ${lists.length})`).toBe(true);
    const wideBody = listed.body as { objects?: Array<{ date: string }>; days?: string[]; truncated?: boolean };
    expect((wideBody.objects ?? []).map(o => o.date), 'and it still delivers both days of objects').toEqual(['2026-03-01', '2026-08-31']);
    expect(wideBody.truncated, 'having read the whole window').toBe(false);
  });
});
