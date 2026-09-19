// src/units/W21/B1.unit.test.ts
// W21 batch B1 — the local scope of the incrementality item: containment of
// lift claims, honest coverage, per-arm denominators, the persistent enrollment
// anchor, consent eligibility, experiment provenance, visitor-level business
// outcomes, report authentication and per-tenant targets.
//
// One `describe('unit:W21.<id>')` per unit of batch W21-B1, one `it` per ruled
// leg. Every expected value comes from a witness or from a documented formula
// computed by hand below — never from what the engine returns today.
//
// WITNESSES
//   · document 35 §5 row W21 (:423): "Contain invalid incrementality/confidence/
//     target claims. Separately deliver persistent enrollment/salt/identity
//     policy, consent eligibility, actual production control, all eligible
//     visitor business outcomes and experiment provenance. … Renaming or
//     clamping an attribution ratio is not causal acceptance."
//   · docs/architecture/35-verification-reports/F07.md
//       §1.2 "the arm … is not on the session, not on the shopper object, not on
//         the identity link. It is recomputed on every request from whatever id
//         the browser is carrying at that moment."
//       §1.4 "A shopper who leaves tracking on but turns personalization off is
//         written into the ledger with `arm: 'default'`, indistinguishable in the
//         report from a hash-assigned control."
//       §2.2 "94.1 % of the anonymous control leaves the control the moment the
//         shopper signs in" — against requirement line 367, which forbids exactly
//         that contamination.
//       §2.5 the denominator is itself an outcome: clicks per DECISION moves in
//         the wrong direction where clicks per VISITOR is flat or up.
//       §7 the remedy: "Write the arm and a salt version once, on first decision,
//         to the shopper record; read it back instead of recomputing; and carry it
//         through `linkVisitor` and detach … so the arm survives login and logout";
//         "visitor-level business outcomes collected independently of content
//         matching"; "excluding or stratifying consent-ineligible traffic"; and
//         "keeping the attribution report but labelling it attribution".
//   · docs/architecture/35-verification-reports/F25.md
//       §1.2 the completeness flags exist and are thrown away.
//       §1.3 "decisions still needed" is fixed at 95 % and assumes equal arms;
//         the allocation-aware number needs per-arm counts that are not stored.
//       §1.4 the relative interval is the absolute interval divided by a rounded
//         control point rate; the correct method is Katz's log interval.
//       §5.1 "The window report is not authenticated" — both report GETs carry no
//         operator gate; "The console's own error handler expects 401/403 here".
//       §5.2 "The pre-set targets are hardcoded to one customer … no configuration
//         document, route or console field reaches it."
//       §5.3 "The day report carries `counts.visitors` for the day but NOT per
//         arm, so the design effect cannot be computed from what is stored."
//       §7.1–§7.2 the truncation answer and the suppression rule: force the target
//         standing to `undecided` whenever the window was truncated or any pooled
//         day is incomplete.
//       §7.3 "replace `difference.lo / controlRate` with the Katz log relative
//         interval (exp(ln(p_t/p_c) ∓ z·√((1−p_t)/s_t + (1−p_c)/s_c)) − 1),
//         computed from RAW rates, not `r4`-rounded ones."
//       §7 under-scoped: per-arm visitor counts are "a schema change across
//         hourly.ts → report.ts → window.ts with a version field".
//   · docs/handover/HANDOFF-2026-09-18.md §6 row W21 (:317) and §8 D04: the
//     production-control experiment, the enrollment units, metrics, allocation,
//     windows, maturity, stopping rules and cluster-aware analysis belong to the
//     customer's DS/business and learning owners. They are W21.P1.01, a
//     `no-witness` row with no test here.
//   · docs/Tapestry-BTIE-Working-Notes.md §1.2 position 8 (ruling R87(b)): "We
//     deliver arm-tagged decision and outcome records. The comparison is computed
//     on their side, on their numbers. Our reports are attribution diagnostics."
//   · docs/architecture/tapestry_requirements.txt §6.4.1 (:363-:367): the holdout
//     is permanent, assigned on a persistent identifier, constant for 6+ months,
//     and "a user who was in BTIE for 3 months and then moves to holdout … is no
//     longer a valid counterfactual". §6.4.2 (:372-:374): the pre-set targets are
//     CVR lift, RPV lift and return-rate delta — metrics this platform does not
//     define (D04), which is why no metric is invented below.
//   · rulings R19 (a host leg drives the mounted route production serves), R21
//     (a ruled-but-absent member is named, and a widening cast is never used to
//     hide one), R87(b), R95(a)-(e).
//
// ONE REPRESENTATION, shared by every unit below, so no two units demand
// opposite things of the same fixture:
//
//  (i)   NO REPORT OF OURS STATES A CAUSAL RESULT (R87(b), R95(c)). The day and
//        window answers keep `measurement.kind = 'attribution_diagnostic'` and
//        `inference = 'unavailable'`; no member and no sentence names
//        incrementality, causal lift, or a business target as reached. The Katz
//        interval is therefore specified as an exported CALCULATION the customer
//        (or a later, enrollment-based analysis) can use — not as a number our
//        reports publish today.
//  (ii)  TARGETS ARE A TENANT CONFIGURATION, AND THEIR STANDING IS ALWAYS
//        WITHHELD WHILE INFERENCE IS UNAVAILABLE. Both report answers carry
//            targets: { version: 1;
//                       source: 'published' | 'absent';
//                       values: { minimum: number; target: number; stretch: number } | null;
//                       standing: 'undecided';
//                       reasons: Array<'inference_unavailable' | 'no_published_target' | 'source_incomplete'> }
//        with `reasons` sorted ascending. `values` is the tenant's own published
//        configuration (`LearnConfig.targets`), never a compiled constant;
//        `'source_incomplete'` is present exactly when the window was truncated
//        or any pooled day is incomplete (F25 §7.2), and on a day report when the
//        day's own counts are truncated or hours are missing;
//        `'no_published_target'` exactly when the tenant published none;
//        `'inference_unavailable'` always, because our reports withhold inference
//        (position 8). `standing` has one admissible value for that reason: the
//        discrimination between fixtures lives in `reasons` and in `values`.
//  (iii) PER-ARM DENOMINATORS ARE VISITORS, AND THEY ARE VERSIONED (F25 §5.3, §7).
//        The day answer carries
//            armVisitors: { version: 1; basis: 'distinct_visitors';
//                           arms: Array<{ arm: string; visitors: number }> } | null
//        where `visitors` is the number of DISTINCT visitors with at least one
//        decision on that arm in the day, and the window answer carries the same
//        shape with `basis: 'visitor_days'` (the per-day distinct counts summed;
//        a visitor active on two days is two visitor-days, which is why the basis
//        is named rather than called "visitors"). `null` means the source was
//        written before the field existed and is never re-derived. The day answer
//        also carries the tenant's published allocation,
//            allocation: { version: 1; source: 'published'; share: number; arms: string[] },
//        so the customer can compute sample sufficiency on their side under their
//        own protocol (D04) instead of reading a 95 %/equal-arms number from us.
//  (iv)  ENROLLMENT IS PERSISTENT, AND ELIGIBILITY IS NOT AN ARM DRAW. The arm is
//        written once, on first decision, against the shopper's persistent
//        enrollment anchor and the published salt, and read back afterwards; it
//        survives an anonymous→recognised link. A shopper without personalization
//        consent is not randomised at all: she is served the site's own defaults
//        and recorded with `arm: 'ineligible'`, so the control arm contains only
//        randomised controls (F07 §1.4, §7).
//  (v)   EVERY ARM-TAGGED RECORD NAMES ITS EXPERIMENT. Decision and outcome
//        records, and the snapshot answer, carry
//            experiment: { id: string; saltVersion: number; arm: string; anchorGeneration: number }
//        where `id` is `${tenant}:${brand}:${effective salt}` (the effective salt
//        is `learn.holdout.salt || brand`, `src/content/service.ts:376`), so a
//        salt change starts a new experiment id; `saltVersion` is the revision of
//        the published learn document the enrollment was written under;
//        `anchorGeneration` starts at 1 and only changes when the anchor itself is
//        replaced — recognition does not replace it.
//  (vi)  VISITOR-LEVEL OUTCOMES ARE COUNTED BY ENROLLMENT, NOT BY CONTENT MATCH
//        (F07 §2.5, §7). The day answer carries
//            visitorOutcomes: { version: 1; basis: 'enrolled_visitors';
//                               arms: Array<{ arm: string; visitors: number;
//                                             byType: Record<string, number> }> }
//        where `byType[t]` is the number of DISTINCT visitors on that arm with at
//        least one outcome of reward type `t` in the day, whether or not any
//        served piece matched it, and `visitors` is the same denominator as
//        (iii). No rate, no CVR, no RPV and no return-rate metric is defined
//        here: those are the customer's units (D04, W21.P1.01).
//
// RULED MISSING EXPORT (R21), imported by name and RED until it exists. No
// widening cast is used to hide it, so the app typecheck fails on this one
// member until the build lands:
//   1. `src/measure/holdout.ts` must export
//        katzRelativeInterval(control: { n: number; s: number },
//                             treatment: { n: number; s: number },
//                             z?: number): { relative: number | null; low: number | null; high: number | null }
//      computing F25 §7.3's formula from RAW rates. The existing `readTargets`
//      (`holdout.ts:188-200`) keeps its divided-interval behaviour under this
//      specification because `src/measure/holdout.test.ts:186` locks it
//      (`reached_target` for 3.0 % → 4.5 %, which the Katz method answers
//      `reached_minimum`, F25 §5.5); re-baselining that shipped assertion needs a
//      lead ruling, and the row for W21.C1.01 names it as owed work. Nothing in
//      `src/` calls `readTargets`, so no report publishes the narrow interval.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
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
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { signAssertion } from '@/identity/assertion';
import { consumeLedger } from '@/ledger/consume';
import { captureRetention } from '@/retention';
import { reportKey, REPORT_MEASUREMENT } from '@/learn/report';
import * as measureHoldout from '@/measure/holdout';
import { configuredDestinations } from '@/connectors/config';
import type { Env } from '@/types/env';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

// ===========================================================================
// The customer's fixture. Coach's own vocabulary (tapestry_requirements A.3.6:
// Tabby, Rogue, evening, work, Handbags, Small Leather Goods), held here and
// never in product code (METHOD §6).
// ===========================================================================

const TENANT = 'coach';
const SALT_A = 'w21-b1-experiment-a';
const SALT_B = 'w21-b1-experiment-b';
const OPERATOR_SECRET = 'w21-b1-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const IDENTITY_SECRET = 'w21-b1-identity-assertion-material';

/**
 * The tenant's OWN published business targets (F25 §5.2). Deliberately none of
 * Tapestry's {0.10, 0.40, 0.60}, so a compiled constant cannot satisfy the
 * assertions below.
 */
const PUBLISHED_TARGETS = { minimum: 0.05, target: 0.15, stretch: 0.25 } as const;

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
const W21_CATALOGUE = { version: 'w21-b1-coach-catalogue', pieces: W21_PIECES };

/** One page, one slot, take 1: one decision per served page, so every count below is exact. */
const W21_SLOTS: SlotCatalog = { version: 'w21-b1-coach-slots',
  pages: { home: [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }] } };

interface LearnFixture {
  salt?: string;
  share?: number;
  /** RULED, ABSENT TODAY (R21): the tenant's own business targets (F25 §5.2). */
  targets?: { minimum: number; target: number; stretch: number };
}
const learnDocument = (f: LearnFixture = {}) => ({
  holdout: { share: f.share ?? 0.5, salt: f.salt ?? SALT_A, arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: {},
  ...(f.targets ? { targets: f.targets } : {}),
});

// ===========================================================================
// The mounted application, in process, the way `src/index.ts` mounts it, on
// either shopper host. Harness pattern reused from `src/units/W20/B1.unit.test.ts`
// and `src/routes/realtime.sdkContract.test.ts`; neither suite is imported or
// edited.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v; }
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
  async get(key: string, options?: R2GetOptions) {
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
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: (this.objects.get(key) ?? '').length, uploaded: new Date(0) })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixturePolicy: RetentionPolicy = { id: 'w21-b1-fixture-policy', revision: 1, durationMs: 365 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface Mounted {
  env: Env;
  storage: UnitR2;
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
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>();
  const stub = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) };
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: new UnitKV(), SESSIONS: new UnitKV(), CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
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
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w21-b1-fixture', note: 'fixture', value } });
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
  return { env, storage, fetch: fetchOne, drain, drainLedger, operatorToken };
}

const HOSTS = ['session', 'do'] as const;

/** The published assignment, as `src/content/service.ts:376` composes it. */
const HOLDOUT: HoldoutConfig = { share: 0.5, salt: SALT_A, arms: ['default'] };

// ── The shopper on the mounted application ──────────────────────────────────

interface SnapshotAnswer {
  status: number;
  arm: string;
  served: string[];
  /** RULED, ABSENT TODAY (R21): representation (v) above. */
  experiment?: { id: string; saltVersion: number; arm: string; anchorGeneration: number };
}

interface Shopper {
  subject: string;
  sessionId: string;
  capability: string;
  snapshot: () => Promise<SnapshotAnswer>;
  act: (event: { type: string; data: Record<string, unknown> }) => Promise<number>;
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
  const snapshot = async (): Promise<SnapshotAnswer> => {
    invalidatePublicationCache();
    const response = await call(`/v1/${TENANT}/decisions/snapshot?page=home`);
    const body = await response.clone().json().catch(() => ({})) as {
      arm?: string; decisions?: Array<{ slot?: string; contentId?: string }>;
      experiment?: SnapshotAnswer['experiment'];
    };
    await m.drain();
    return { status: response.status, arm: body.arm ?? '?', experiment: body.experiment,
      served: (body.decisions ?? []).map(d => `${d.slot ?? '?'}:${d.contentId ?? '?'}`) };
  };
  const act = async (event: { type: string; data: Record<string, unknown> }) => {
    const response = await call('/realtime/action', { ...event, source: 'sdk', userId: subject, sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() });
    await m.drain();
    return response.status;
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
  return { subject, sessionId, capability, snapshot, act, choose };
}

async function operatorGet(m: Mounted, path: string, authenticated = true): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    headers: { 'X-Tenant': TENANT, ...(authenticated ? { Authorization: `Bearer ${m.operatorToken}` } : {}) },
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function operatorPost(m: Mounted, path: string, body: unknown, authenticated = true): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${m.operatorToken}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/** The ruled shape of a report answer, as this specification rules it (R21). */
interface TargetsBlock {
  version: number;
  source: string;
  values: { minimum: number; target: number; stretch: number } | null;
  standing: string;
  reasons: string[];
}
interface ArmVisitorsBlock { version: number; basis: string; arms: Array<{ arm: string; visitors: number }> }
interface VisitorOutcomesBlock { version: number; basis: string; arms: Array<{ arm: string; visitors: number; byType: Record<string, number> }> }
interface RuledDayReport {
  tenant: string; brand: string; date: string;
  measurement: { kind: string; unit: string; inference: string };
  counts: { decisions: number; outcomes: number; visitors: number; truncated: boolean };
  holdout: Record<string, Array<{ arm: string; decisions: number; credited: number; creditedPerDecision: number | null }>>;
  targets?: TargetsBlock;
  armVisitors?: ArmVisitorsBlock | null;
  allocation?: { version: number; source: string; share: number; arms: string[] };
  visitorOutcomes?: VisitorOutcomesBlock | null;
}
interface RuledWindowReport {
  tenant: string; brand: string; from: string; to: string;
  days: string[]; missing: string[];
  incomplete: Array<{ date: string; truncated: boolean; missingHours: number[] }>;
  measurement: { kind: string; inference: string };
  slots: Record<string, { arms: Array<{ arm: string; decisions: number; credited: number }> }>;
  targets?: TargetsBlock;
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

function outcomeRecord(input: { visitor: string; ts: number; type: string; item: string | null; index: number }) {
  return {
    outcome_id: `${TENANT}:${input.ts.toString(36)}:${input.visitor}:${input.type}:${input.index}`,
    tenant: TENANT, brand: TENANT, visitor_id: input.visitor, session_id: `s-${input.visitor}`, ts: input.ts,
    type: input.type, event: input.type === 'purchase' ? 'order_completed' : 'content_click',
    item_id: input.item, slot: input.item ? 'hero' : null, value: input.type === 'purchase' ? 210 : null,
    currency: input.type === 'purchase' ? 'USD' : null, margin: null, products: null, arm: null,
  };
}

/** Put a day of arm-tagged records into the ledger through the real queue consumer. */
async function seedLedgerDay(m: Mounted, date: string, decisions: DecisionRecord[], outcomes: Array<ReturnType<typeof outcomeRecord>>): Promise<void> {
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

describe('unit:W21.C1.01', () => {
  /**
   * F25 §7.3's formula, computed by hand for the two fixtures below at
   * z = 1.959963984540054 (the module's own Z95, `src/measure/holdout.ts:105`):
   *
   *   FIXTURE A — F25 §1.4's own reproduction: control 30,000 @ 2.0 %
   *   (s_c = 600), treatment 570,000 @ 2.4 % (s_t = 13,680).
   *     p_c = 600/30000       = 0.02
   *     p_t = 13680/570000    = 0.024
   *     ln(p_t/p_c)           = ln(1.2)            = 0.1823215567939546
   *     SE                    = sqrt(0.976/13680 + 0.98/600)
   *                           = sqrt(0.0000713450 + 0.0016333333)
   *                           = sqrt(0.0017046784) = 0.041287750757011445
   *     z·SE                  = 0.080922163…
   *     low  = exp(0.1823215568 − 0.0809221632) − 1 = 0.10671819210508504
   *     high = exp(0.1823215568 + 0.0809221632) − 1 = 0.30114423913189725
   *   F25 §1.4 prints exactly this interval ("Katz relative interval +10.7 % to
   *   +30.1 %") against the shipped +12.0 % to +28.0 %, so the witness fixes
   *   both ends independently of this file's arithmetic.
   *
   *   FIXTURE B — F25 §5.4's rounding case: control 3/40,000 (0.0075 %) versus
   *   treatment 95/760,000 (0.0125 %), "a genuine +67 % relative lift" the
   *   shipped code reports as `relative: 0` because `wilson()` rounds the
   *   divisor to four decimals.
   *     p_c = 0.000075, p_t = 0.000125, ratio 5/3
   *     relative = 0.6666666666666667
   *     ln(5/3)  = 0.5108256237659907
   *     SE       = sqrt(0.999875/95 + 0.999925/3) = 0.5863730325768174
   *     low  = exp(0.5108256238 − 1.1492510…) − 1 = −0.47188668237572373
   *     high = exp(0.5108256238 + 1.1492510…) − 1 = +4.25981391697078
   */
  it('logic: the relative interval is Katz\'s log interval from the raw rates, and the report vocabulary stays a diagnostic one', () => {
    // RULED MISSING EXPORT (R21): `katzRelativeInterval` does not exist yet.
    const katz = measureHoldout.katzRelativeInterval;
    expect(typeof katz, 'W21.C1.01 — src/measure/holdout.ts must export katzRelativeInterval(control, treatment, z?) computing F25 §7.3\'s formula')
      .toBe('function');

    const a = katz({ n: 30_000, s: 600 }, { n: 570_000, s: 13_680 });
    expect(a.relative, 'F25 §1.4 — the point ratio of the RAW rates, 0.024/0.02 − 1').toBeCloseTo(0.2, 12);
    expect(a.low, 'F25 §1.4 — the Katz low end, +10.7 %, not the divided interval\'s +12.0 %').toBeCloseTo(0.10671819210508504, 12);
    expect(a.high, 'F25 §1.4 — the Katz high end, +30.1 %, not the divided interval\'s +28.0 %').toBeCloseTo(0.30114423913189725, 12);

    const b = katz({ n: 40_000, s: 3 }, { n: 760_000, s: 95 });
    expect(b.relative, 'F25 §5.4 — a +66.7 % lift computed from raw rates, which four-decimal rounding of the divisor reports as 0').toBeCloseTo(0.6666666666666667, 12);
    expect(b.low, 'F25 §5.4 — the Katz low end at this sparsity').toBeCloseTo(-0.47188668237572373, 10);
    expect(b.high, 'F25 §5.4 — the Katz high end at this sparsity').toBeCloseTo(4.25981391697078, 10);

    // A control arm with no credited outcome has no log ratio to take: the
    // interval is unreadable and says so, rather than reporting a number.
    const zero = katz({ n: 10_000, s: 0 }, { n: 190_000, s: 240 });
    expect(zero.relative, 'F25 §5.4 — against a control rate of zero the ratio is unreadable').toBeNull();
    expect(zero.low, 'F25 §5.4 — and so is its interval').toBeNull();
    expect(zero.high, 'F25 §5.4 — and so is its interval').toBeNull();

    // The documented label the reports publish (F07 §7(a), position 8).
    expect(REPORT_MEASUREMENT.kind, 'document 35 :423 — the published label is an attribution diagnostic').toBe('attribution_diagnostic');
    expect(REPORT_MEASUREMENT.unit, 'F07 §1.5 — the unit is credits per content-item decision, not a Bernoulli rate').toBe('credited_outcomes_per_content_item_decision');
    expect(REPORT_MEASUREMENT.inference, 'position 8 — the comparison is computed on the customer\'s side').toBe('unavailable');
  });

  it('host: the day and the window answers of the mounted report routes carry the diagnostic label and no causal or target claim', async () => {
    const m = await mount('session', { targets: PUBLISHED_TARGETS });
    const date = '2026-09-03';
    await seedLedgerDay(m, date, [
      decisionRecord({ visitor: 'vis-w21-b1-control-1', arm: 'default', ts: atUtc(date, 9), item: 'cnt-tabby-evening-edit', index: 0 }),
      decisionRecord({ visitor: 'vis-w21-b1-treated-1', arm: 'personalized', ts: atUtc(date, 10), item: 'cnt-rogue-work-edit', index: 0 }),
    ], [
      outcomeRecord({ visitor: 'vis-w21-b1-treated-1', ts: atUtc(date, 10, 5), type: 'click', item: 'cnt-rogue-work-edit', index: 0 }),
    ]);

    const built = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date, brand: TENANT });
    expect(built.status, JSON.stringify(built.body)).toBe(200);
    const day = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${date}`);
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    expect(dayReportOf(day.body).measurement.kind, 'document 35 :423 — the day answer is labelled an attribution diagnostic').toBe('attribution_diagnostic');
    expect(dayReportOf(day.body).measurement.inference, 'F07 §7(a) — the day answer withholds inference').toBe('unavailable');
    expect(claimsIn(day.body), 'document 35 :423 — the day answer names no incrementality, causal or reached-target claim').toEqual([]);

    const window = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${date}&to=${date}`);
    expect(window.status, JSON.stringify(window.body)).toBe(200);
    expect(windowReportOf(window.body).measurement.kind, 'document 35 :423 — the window answer carries the same label').toBe('attribution_diagnostic');
    expect(windowReportOf(window.body).measurement.inference, 'position 8 — the window answer withholds inference').toBe('unavailable');
    expect(claimsIn(window.body), 'document 35 :423 — the window answer names no incrementality, causal or reached-target claim').toEqual([]);

    // The one place a target could be claimed is the ruled targets block, and it
    // states only that the standing is withheld (representation (ii)).
    const targets = windowReportOf(window.body).targets;
    expect(targets?.standing, 'F25 §7.2 with position 8 — a report of ours never states a reached business target')
      .toBe('undecided');
  });
});

// ===========================================================================
// unit:W21.C1.02 — honest coverage.
// ===========================================================================

describe('unit:W21.C1.02', () => {
  it('host: a window beyond the readable series is refused with its maximum named, every incomplete pooled day is listed, and the target standing is withheld whenever the window is incomplete', async () => {
    const m = await mount('session', { targets: PUBLISHED_TARGETS });

    // (a) The requested period is never relabelled. F25 §7.1 allows either a
    // refusal that names the maximum or a truncated answer that names what it
    // read; this repository refuses (`src/measure/window.ts:46`, surfaced as 400
    // by `src/routes/decisions.ts:898`), and `src/measure/window.test.ts:31`
    // locks that choice, so the refusal is what this unit requires.
    const tooLong = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=2026-01-01&to=2026-12-31`);
    expect(tooLong.status, 'F25 §1.1/§7.1 — a period longer than the readable series is refused, never answered short').toBe(400);
    expect(String(tooLong.body.error ?? ''), 'F25 §7.1 — the refusal names the maximum the platform will read').toContain('184');

    // (b) A six-month window is readable, and every day that is incomplete is
    // named. Three days: one complete, one truncated at the record cap, one
    // built from 3 of 24 hours (F25 §1.2's "normal operating condition").
    storeLegacyDayReport(m, '2026-03-01', { hero: [{ arm: 'default', decisions: 40, credited: 2 }, { arm: 'personalized', decisions: 760, credited: 61 }] },
      { decisions: 800, outcomes: 63, visitors: 300, truncated: false }, { source: 'aggregates', built: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], missing: [] });
    storeLegacyDayReport(m, '2026-03-02', { hero: [{ arm: 'default', decisions: 30, credited: 1 }, { arm: 'personalized', decisions: 570, credited: 40 }] },
      { decisions: 600, outcomes: 41, visitors: 240, truncated: true }, { source: 'aggregates', built: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], missing: [] });
    storeLegacyDayReport(m, '2026-03-03', { hero: [{ arm: 'default', decisions: 10, credited: 0 }, { arm: 'personalized', decisions: 190, credited: 12 }] },
      { decisions: 200, outcomes: 12, visitors: 80, truncated: false }, { source: 'aggregates', built: [0, 1, 2], missing: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] });

    const half = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=2026-03-01&to=2026-08-31`);
    expect(half.status, 'tapestry_requirements :365 — six months is inside the readable series').toBe(200);
    const window = windowReportOf(half.body);
    expect(window.days, 'F25 §1.1 — the answer names exactly the days it read').toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(window.missing.length, 'F25 §1.1 — and every requested day it found no report for').toBe(181);
    expect(window.incomplete.map(d => d.date), 'F25 §1.2/§7.2 — every day with truncated counts or missing hours is listed')
      .toEqual(['2026-03-02', '2026-03-03']);
    expect(window.incomplete.find(d => d.date === '2026-03-02')?.truncated, 'F25 §1.2 — the truncated day says so').toBe(true);
    expect(window.incomplete.find(d => d.date === '2026-03-03')?.missingHours.length, 'F25 §1.2 — 21 of 24 hours were never folded into that day').toBe(21);

    // (c) The suppression rule (F25 §7.2), which is the member this unit is RED on.
    const incompleteTargets = window.targets;
    expect(incompleteTargets?.standing, 'F25 §7.2 — an incomplete window can never award a target standing').toBe('undecided');
    expect(incompleteTargets?.reasons, 'F25 §7.2 — and it says the source was incomplete, beside the standing withheld by position 8')
      .toEqual(['inference_unavailable', 'source_incomplete']);
    expect(incompleteTargets?.values, 'F25 §5.2 — the targets it would be read against are the tenant\'s own published numbers')
      .toEqual(PUBLISHED_TARGETS);

    // (d) The same window over the complete day alone drops the incompleteness
    // reason: the suppression is a rule about the source, not a constant.
    const complete = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=2026-03-01&to=2026-03-01`);
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
    expect(windowReportOf(complete.body).incomplete, 'F25 §1.2 — a day built from all 24 hours with untruncated counts is not incomplete').toEqual([]);
    expect(windowReportOf(complete.body).targets?.reasons, 'F25 §7.2 — with a complete source the only reason left is the withheld inference')
      .toEqual(['inference_unavailable']);
  });
});

// ===========================================================================
// unit:W21.C1.03 — per-arm denominators.
// ===========================================================================

describe('unit:W21.C1.03', () => {
  it('host: the day answer stores per-arm visitor counts with a version field and the tenant\'s published allocation, the window pools them as visitor-days, and a report written before the field is read as such', async () => {
    const m = await mount('session', { share: 0.05, targets: PUBLISHED_TARGETS });
    const first = '2026-04-01', second = '2026-04-02';

    // Three control visitors with two decisions each, five treated visitors with
    // three: 6 and 15 decisions, 3 and 5 VISITORS. The decision counts and the
    // visitor counts differ on purpose (F25 §5.3: the design effect cannot be
    // computed from decisions alone).
    const day = (date: string): DecisionRecord[] => {
      const rows: DecisionRecord[] = [];
      for (let v = 1; v <= 3; v++) for (let i = 0; i < 2; i++)
        rows.push(decisionRecord({ visitor: `vis-w21-b1-control-${v}`, arm: 'default', ts: atUtc(date, 9, v * 2 + i), item: 'cnt-tabby-evening-edit', index: i }));
      for (let v = 1; v <= 5; v++) for (let i = 0; i < 3; i++)
        rows.push(decisionRecord({ visitor: `vis-w21-b1-treated-${v}`, arm: 'personalized', ts: atUtc(date, 11, v * 3 + i), item: 'cnt-rogue-work-edit', index: i }));
      return rows;
    };
    await seedLedgerDay(m, first, day(first), []);
    await seedLedgerDay(m, second, day(second), []);
    for (const date of [first, second]) {
      const built = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date, brand: TENANT });
      expect(built.status, JSON.stringify(built.body)).toBe(200);
    }

    const read = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${first}`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const report = dayReportOf(read.body);
    expect(report.holdout.hero?.map(r => [r.arm, r.decisions]), 'the decision denominators the report already stores')
      .toEqual([['default', 6], ['personalized', 15]]);
    expect(report.armVisitors?.version, 'F25 §7 — per-arm visitor counts carry a version field').toBe(1);
    expect(report.armVisitors?.basis, 'F25 §5.3 — within a day the per-arm figure is distinct visitors').toBe('distinct_visitors');
    expect(report.armVisitors?.arms, 'F25 §5.3 — three control visitors and five treated ones, not their 6 and 15 decisions')
      .toEqual([{ arm: 'default', visitors: 3 }, { arm: 'personalized', visitors: 5 }]);
    expect(report.counts.visitors, 'the day total the report already stores stays what it was').toBe(8);
    expect(report.allocation, 'F25 §1.3 — the published allocation is recorded, so sufficiency is computable on the customer\'s side (D04)')
      .toEqual({ version: 1, source: 'published', share: 0.05, arms: ['default'] });

    const window = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${first}&to=${second}`);
    expect(window.status, JSON.stringify(window.body)).toBe(200);
    expect(windowReportOf(window.body).armVisitors?.basis, 'F25 §5.3 — pooled across days the figure is visitor-days, and says so').toBe('visitor_days');
    expect(windowReportOf(window.body).armVisitors?.arms, 'F25 §7 — the per-arm denominators are carried through report.ts into window.ts')
      .toEqual([{ arm: 'default', visitors: 6 }, { arm: 'personalized', visitors: 10 }]);

    // A day stored before the field existed is read as unknown, never
    // re-interpreted from the decision counts it does hold.
    const legacy = await mount('session', { share: 0.05, targets: PUBLISHED_TARGETS });
    storeLegacyDayReport(legacy, '2026-04-05', { hero: [{ arm: 'default', decisions: 6, credited: 1 }, { arm: 'personalized', decisions: 15, credited: 4 }] },
      { decisions: 21, outcomes: 5, visitors: 8, truncated: false });
    const old = await operatorGet(legacy, `/v1/${TENANT}/learn/report?date=2026-04-05`);
    expect(old.status, JSON.stringify(old.body)).toBe(200);
    expect(dayReportOf(old.body).armVisitors, 'F25 §7 — a report written before the version field is unknown, not zero and not re-derived').toBeNull();
    const oldWindow = await operatorGet(legacy, `/v1/${TENANT}/learn/report/window?from=2026-04-05&to=2026-04-05`);
    expect(oldWindow.status, JSON.stringify(oldWindow.body)).toBe(200);
    expect(windowReportOf(oldWindow.body).armVisitors, 'F25 §7 — and a window that pooled it cannot invent one either').toBeNull();
  });
});

// ===========================================================================
// unit:W21.C1.04 — report authentication and per-tenant targets.
// ===========================================================================

describe('unit:W21.C1.04', () => {
  it('host: both report routes require an operator credential, and the targets a report is read against are the tenant\'s published configuration', async () => {
    const m = await mount('session', { targets: PUBLISHED_TARGETS });
    const date = '2026-05-04';
    storeLegacyDayReport(m, date, { hero: [{ arm: 'default', decisions: 40, credited: 2 }, { arm: 'personalized', decisions: 760, credited: 61 }] },
      { decisions: 800, outcomes: 63, visitors: 300, truncated: false },
      { source: 'aggregates', built: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], missing: [] });

    // F25 §5.1: the two GETs carry no operator gate, and the console's own error
    // handler expects 401/403 from them.
    const anonymousDay = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${date}`, false);
    expect(anonymousDay.status, 'F25 §5.1 — the day report GET requires an operator credential').toBe(401);
    const anonymousWindow = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${date}&to=${date}`, false);
    expect(anonymousWindow.status, 'F25 §5.1 — the window report GET requires an operator credential').toBe(401);
    const anonymousBuild = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date, brand: TENANT }, false);
    expect(anonymousBuild.status, 'F25 §5.1 — and so does building a day').toBe(401);

    // The same reads, with the operator's credential.
    const day = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${date}`);
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    expect(dayReportOf(day.body).targets?.source, 'F25 §5.2 — the targets come from the tenant\'s published configuration').toBe('published');
    expect(dayReportOf(day.body).targets?.values, 'F25 §5.2 — this tenant\'s own numbers, not the compiled {0.10, 0.40, 0.60}').toEqual(PUBLISHED_TARGETS);
    expect(dayReportOf(day.body).targets?.reasons, 'position 8 — a complete day still states no standing, because inference is withheld').toEqual(['inference_unavailable']);

    const window = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${date}&to=${date}`);
    expect(window.status, JSON.stringify(window.body)).toBe(200);
    expect(windowReportOf(window.body).targets?.values, 'F25 §5.2 — the window is read against the same published numbers').toEqual(PUBLISHED_TARGETS);

    // A tenant that has published no target says so, rather than borrowing another customer's.
    const unpublished = await mount('session', {});
    storeLegacyDayReport(unpublished, date, { hero: [{ arm: 'default', decisions: 40, credited: 2 }, { arm: 'personalized', decisions: 760, credited: 61 }] },
      { decisions: 800, outcomes: 63, visitors: 300, truncated: false },
      { source: 'aggregates', built: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], missing: [] });
    const none = await operatorGet(unpublished, `/v1/${TENANT}/learn/report?date=${date}`);
    expect(none.status, JSON.stringify(none.body)).toBe(200);
    expect(dayReportOf(none.body).targets?.source, 'F25 §5.2 — with no published target the report says the configuration is absent').toBe('absent');
    expect(dayReportOf(none.body).targets?.values, 'F25 §5.2 — and reads against no numbers at all').toBeNull();
    expect(dayReportOf(none.body).targets?.standing, 'F25 §5.2 — the standing is undecided').toBe('undecided');
    expect(dayReportOf(none.body).targets?.reasons, 'F25 §5.2 — with the reason named').toEqual(['inference_unavailable', 'no_published_target']);
  });
});

// ===========================================================================
// unit:W21.E1.01 — the persistent enrollment anchor.
// ===========================================================================

/**
 * The enrollment fixture, computed from the engine's own documented assignment
 * (`src/content/holdout.ts:33-46`: bucket = mix32(fnv1a(`${salt}:${id}`))/2^32,
 * and with share 0.5 and arms ['default'] a bucket under 0.5 is the control) and
 * from `shopperIdFor` (`src/identity/shopperId.ts:43-55`: sha256 of
 * `${salt}\n${tenant}\n${accountId}`, first 16 bytes, prefixed `sh_`; this
 * deployment has no IDENTITY_SALT, so the documented unsalted material applies):
 *
 *   anonymous id  vis-00000021-0b01-4000-8000-000000000000  bucket 0.158671 → default
 *   account       coach-account-0002
 *   shopper id    sh_771129f4292b93372e7a7816341ef66b        bucket 0.574288 → personalized
 *
 * So recognition is exactly F07 §2.2's redraw: the hash of the new id would move
 * this shopper OUT of the control population. Requirement line 367 forbids that
 * migration, and F07 §7(b) rules the remedy — the arm is written once and read
 * back afterwards.
 */
const ENROLLED_ANON = 'vis-00000021-0b01-4000-8000-000000000000';
const ENROLLED_ACCOUNT = 'coach-account-0002';
/** Same derivation, buckets 0.053950 and 0.266179: both would draw the control arm. */
const DECLINING_SHOPPER = 'vis-00000021-0b01-4000-8000-000000000004';
const CONSENTING_SHOPPER = 'vis-00000021-0b01-4000-8000-00000000000c';
/** Bucket 0.477877 under either published salt's control side. */
const PROVENANCE_SHOPPER = 'vis-00000021-0b01-4000-8000-000000000002';
/** Buckets 0.032036 (control) and 0.906276 (treated). */
const OUTCOME_CONTROL = 'vis-00000021-0b01-4000-8000-00000000000b';
const OUTCOME_TREATED = 'vis-00000021-0b01-4000-8000-000000000001';
const ENROLLED_SHOPPER_ID = 'sh_771129f4292b93372e7a7816341ef66b';

describe('unit:W21.E1.01', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the arm is drawn once against the persistent anchor, read back on the next decision, and survives the anonymous-to-recognised link`, async () => {
      const m = await mount(host);

      // The fixture's two hashes, from the engine's own assignment function, so
      // the redraw this unit forbids is observable at all.
      expect(armFor(ENROLLED_ANON, HOLDOUT), 'the fixture\'s anonymous id draws the control arm').toBe('default');
      expect(armFor(ENROLLED_SHOPPER_ID, HOLDOUT), 'and her recognised id would draw the treated arm, which is F07 §2.2\'s redraw').toBe('personalized');

      const shopper = await shopperOn(m, ENROLLED_ANON, { tracking: true, personalization: true });
      const first = await shopper.snapshot();
      expect(first.status, 'the mounted decision route serves her').toBe(200);
      expect(first.arm, 'tapestry_requirements :364 — she is enrolled against her persistent anchor').toBe('default');

      const second = await shopper.snapshot();
      expect(second.arm, 'F07 §7(b) — the second decision reads the enrollment back, it does not redraw it').toBe('default');

      const exp = Math.floor(Date.now() / 1000) + 300;
      const link = await m.fetch(new Request(`https://synthetic.invalid/v1/${TENANT}/identity/link`, {
        method: 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: shopper.capability, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: ENROLLED_ANON, accountId: ENROLLED_ACCOUNT, exp,
          assertion: await signAssertion(IDENTITY_SECRET, TENANT, ENROLLED_ANON, ENROLLED_ACCOUNT, exp) }),
      }));
      const linked = await link.clone().json().catch(() => ({})) as {
        shopperId?: string; carry?: string;
        session?: { capability: string; subject: string; sessionId: string; grantId?: string; iat: number; exp: number };
      };
      expect(link.status, await link.clone().text()).toBe(200);
      expect(linked.shopperId, 'the link resolves the fixture\'s documented shopper id').toBe(ENROLLED_SHOPPER_ID);
      await m.drain();

      // The browser now carries the person's id and the capability the link
      // itself handed back — which is what F07 §1.2 says the arm is recomputed
      // from today.
      const handed = linked.session!;
      expect(handed.subject, 'the link hands the browser the person\'s own session').toBe(ENROLLED_SHOPPER_ID);
      const recognised = await withCapability(m, ENROLLED_SHOPPER_ID, handed.sessionId, handed.capability,
        { grantId: handed.grantId!, iat: handed.iat, exp: handed.exp });
      const afterLink = await recognised.snapshot();
      expect(afterLink.status, 'the recognised shopper is served').toBe(200);
      expect(afterLink.arm, 'tapestry_requirements :367 with F07 §2.2 — the arm enrolled before recognition persists after linking')
        .toBe('default');
    });
  }
});

// ===========================================================================
// unit:W21.E1.02 — consent eligibility, separated from enrollment.
// ===========================================================================

describe('unit:W21.E1.02', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a shopper who declined personalization is served the site's defaults and recorded ineligible, never as a control, and a later grant enrolls her from that moment`, async () => {
      const m = await mount(host);

      // Her hash says control; her consent says she is not in the experiment at
      // all. F07 §1.4: today both are written `arm: 'default'`.
      expect(armFor(DECLINING_SHOPPER, HOLDOUT), 'the declining shopper\'s hash would have drawn the control arm').toBe('default');
      expect(armFor(CONSENTING_SHOPPER, HOLDOUT), 'and the consenting shopper beside her draws the control arm too').toBe('default');

      const declined = await shopperOn(m, DECLINING_SHOPPER, { tracking: true, personalization: false });
      const consenting = await shopperOn(m, CONSENTING_SHOPPER, { tracking: true, personalization: true });

      const withoutConsent = await declined.snapshot();
      expect(withoutConsent.status, 'she is served').toBe(200);
      expect(withoutConsent.served.length, 'F07 §1.4 — she is served the site\'s own defaults, one piece in the page\'s only slot').toBe(1);
      expect(withoutConsent.arm, 'F07 §1.4/§7 — consent-ineligible traffic is recorded ineligible, never as a randomised control')
        .toBe('ineligible');

      const control = await consenting.snapshot();
      expect(control.arm, 'the randomised control arm still contains the shopper the hash put there').toBe('default');

      // The day report, over the ledger, keeps the two populations apart. The
      // fixture carries forward the arm each shopper was just SERVED under, so
      // this assertion can only pass once the served vocabulary distinguishes
      // them. (A public snapshot is an offer and captures no ledger row of its
      // own, `src/content/service.ts:456-458`; the batch's residual names the
      // rendered-acknowledgement capture path as unexercised here.)
      const date = '2026-06-02';
      await seedLedgerDay(m, date, [
        decisionRecord({ visitor: CONSENTING_SHOPPER, arm: control.arm, ts: atUtc(date, 9), item: 'cnt-tabby-evening-edit', index: 0 }),
        decisionRecord({ visitor: DECLINING_SHOPPER, arm: withoutConsent.arm, ts: atUtc(date, 10), item: 'cnt-tabby-evening-edit', index: 0 }),
      ], []);
      const built = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date, brand: TENANT });
      expect(built.status, JSON.stringify(built.body)).toBe(200);
      const report = dayReportOf(built.body);
      expect(report.holdout.hero?.map(r => r.arm), 'F07 §1.4 — the day report separates the ineligible population from the control arm')
        .toEqual(['default', 'ineligible']);
      expect(report.holdout.hero?.find(r => r.arm === 'default')?.decisions, 'the control arm holds the consenting shopper\'s decision alone').toBe(1);
      expect(report.holdout.hero?.find(r => r.arm === 'ineligible')?.decisions, 'and the ineligible row holds hers').toBe(1);

      // She turns personalization on. From that moment she is enrolled, and the
      // enrollment carries its provenance.
      expect(await declined.choose({ tracking: true, personalization: true }), 'she turns personalization on').toBe(200);
      const enrolled = await declined.snapshot();
      expect(enrolled.arm, 'F07 §7 — with consent granted she is enrolled from that moment, against her persistent anchor').toBe('default');
      expect(enrolled.experiment?.arm, 'F07 §7 — and the enrollment names the experiment it belongs to').toBe('default');
      expect(enrolled.experiment?.id, 'representation (v) — the experiment id names the tenant, brand and published salt')
        .toBe(`${TENANT}:${TENANT}:${SALT_A}`);
    });
  }
});

// ===========================================================================
// unit:W21.E1.03 — experiment provenance, and the operator export.
// ===========================================================================

describe('unit:W21.E1.03', () => {
  it('host: every arm-tagged record names its experiment, salt version, arm and anchor generation, a salt change starts a new experiment, and the authenticated export delivers the window\'s records', async () => {
    const m = await mount('session');
    const shopper = await shopperOn(m, PROVENANCE_SHOPPER, { tracking: true, personalization: true });
    const served = await shopper.snapshot();
    expect(served.status, 'the mounted decision route serves her').toBe(200);
    expect(served.experiment?.id, 'position 8 — the served answer names the experiment its arm belongs to')
      .toBe(`${TENANT}:${TENANT}:${SALT_A}`);
    expect(served.experiment?.saltVersion, 'representation (v) — the revision of the published learn document the enrollment was written under').toBe(1);
    expect(served.experiment?.arm, 'position 8 — and the arm it was enrolled in').toBe(served.arm);
    expect(served.experiment?.anchorGeneration, 'F07 §7(b) — the first enrollment is the anchor\'s first generation').toBe(1);

    // The delivered records, on the ledger the export reads. A public snapshot
    // is an offer and captures no row of its own (`src/content/service.ts:456-458`),
    // so the day is seeded with the arm the live path just answered.
    const date = '2026-06-03';
    await seedLedgerDay(m, date, [
      decisionRecord({ visitor: PROVENANCE_SHOPPER, arm: served.arm, ts: atUtc(date, 9), item: 'cnt-tabby-evening-edit', index: 0 }),
    ], [
      outcomeRecord({ visitor: PROVENANCE_SHOPPER, ts: atUtc(date, 9, 5), type: 'click', item: 'cnt-tabby-evening-edit', index: 0 }),
    ]);
    const keys = [...m.storage.objects.keys()].filter(key => key.startsWith(`${TENANT}/${date}/`));
    expect(keys.some(key => key.includes('/decision/')), 'the seeded decision is on the ledger the export reads').toBe(true);

    // The operator export, per tenant and window (position 8: the comparison is
    // computed on the customer's side, from records we deliver).
    const listed = await operatorGet(m, `/v1/${TENANT}/ledger/batches?from=${date}&to=${date}`);
    expect(listed.status, 'position 8 — the authenticated export accepts a window, not one date at a time').toBe(200);
    const objects = (listed.body.objects ?? []) as Array<{ key: string; date?: string }>;
    expect(objects.length > 0, 'the export names the window\'s ledger objects').toBe(true);
    expect(objects.every(o => o.date === date), 'and each entry names the day it belongs to').toBe(true);
    expect(claimsIn(listed.body), 'position 8 — the export states no lift').toEqual([]);

    // One delivered record, read through the authenticated per-record route,
    // carries the same provenance as the served answer.
    const decisionKey = keys.find(key => key.includes('/decision/'))!;
    const line = (m.storage.objects.get(decisionKey) ?? '').split('\n').filter(Boolean)[0]!;
    const record = JSON.parse(line) as { decision_id: string; arm: string; experiment?: SnapshotAnswer['experiment'] };
    const fetched = await operatorGet(m, `/v1/${TENANT}/ledger/${encodeURIComponent(record.decision_id)}`);
    expect(fetched.status, JSON.stringify(fetched.body)).toBe(200);
    const delivered = (fetched.body.record ?? {}) as { arm?: string; experiment?: SnapshotAnswer['experiment'] };
    expect(delivered.experiment?.id, 'position 8 — the delivered decision record names its experiment').toBe(`${TENANT}:${TENANT}:${SALT_A}`);
    expect(delivered.experiment?.saltVersion, 'position 8 — and the salt version it was enrolled under').toBe(1);
    expect(delivered.experiment?.arm, 'position 8 — and the arm, beside the record\'s own arm field').toBe(delivered.arm);
    expect(delivered.experiment?.anchorGeneration, 'F07 §7(b) — and the generation of the anchor it was enrolled against').toBe(1);

    // A published salt change is a NEW experiment, never a silent re-randomisation
    // of the old one (F07 §5.7: editing the salt re-randomises ~9.7 % of visitors
    // "with no versioning and no freeze").
    const renamed = await mount('session', { salt: SALT_B });
    const again = await shopperOn(renamed, PROVENANCE_SHOPPER, { tracking: true, personalization: true });
    const underNewSalt = await again.snapshot();
    expect(underNewSalt.experiment?.id, 'F07 §5.7 — a salt change starts a new experiment id')
      .toBe(`${TENANT}:${TENANT}:${SALT_B}`);
  });
});

// ===========================================================================
// unit:W21.E1.04 — visitor-level business outcomes, independent of matching.
// ===========================================================================

describe('unit:W21.E1.04', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a purchase by an enrolled visitor counts for her arm whether or not a served piece matched it, and the per-arm denominators are visitors`, async () => {
      const m = await mount(host);

      // Two enrolled shoppers: one the hash puts in the control arm, one it puts
      // in the treated arm. Both are served, both buy, and the control shopper's
      // purchase names a product no served piece ever mentioned.
      expect(armFor(OUTCOME_CONTROL, HOLDOUT), 'the fixture\'s control shopper').toBe('default');
      expect(armFor(OUTCOME_TREATED, HOLDOUT), 'the fixture\'s treated shopper').toBe('personalized');

      const control = await shopperOn(m, OUTCOME_CONTROL, { tracking: true, personalization: true });
      const treated = await shopperOn(m, OUTCOME_TREATED, { tracking: true, personalization: true });
      const controlArm = (await control.snapshot()).arm, treatedArm = (await treated.snapshot()).arm;
      expect(controlArm, 'she is enrolled in the control arm').toBe('default');
      expect(treatedArm, 'he is enrolled in the treated arm').toBe('personalized');

      // Her purchase names a product no served piece ever mentioned; his two
      // purchases are one purchasing visitor. Both are counted by the arm the
      // visitor is enrolled in, not by any content match (F07 §2.5, §7). The
      // arms are the ones the live path just answered; the records are seeded
      // because a public snapshot is an offer and captures no ledger row
      // (`src/content/service.ts:456-458`).
      const date = '2026-06-04';
      await seedLedgerDay(m, date, [
        decisionRecord({ visitor: OUTCOME_CONTROL, arm: controlArm, ts: atUtc(date, 9), item: 'cnt-tabby-evening-edit', index: 0 }),
        decisionRecord({ visitor: OUTCOME_TREATED, arm: treatedArm, ts: atUtc(date, 10), item: 'cnt-rogue-work-edit', index: 0 }),
      ], [
        outcomeRecord({ visitor: OUTCOME_CONTROL, ts: atUtc(date, 9, 30), type: 'purchase', item: null, index: 0 }),
        outcomeRecord({ visitor: OUTCOME_TREATED, ts: atUtc(date, 10, 20), type: 'purchase', item: 'cnt-rogue-work-edit', index: 0 }),
        outcomeRecord({ visitor: OUTCOME_TREATED, ts: atUtc(date, 10, 40), type: 'purchase', item: null, index: 1 }),
      ]);

      const built = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date, brand: TENANT });
      expect(built.status, JSON.stringify(built.body)).toBe(200);
      const report = dayReportOf(built.body);

      expect(report.visitorOutcomes?.version, 'F07 §7 — visitor-level outcomes are versioned like the rest of the schema').toBe(1);
      expect(report.visitorOutcomes?.basis, 'F07 §2.5 — the denominators are enrolled visitors, not exposures').toBe('enrolled_visitors');
      const arms = Object.fromEntries((report.visitorOutcomes?.arms ?? []).map(a => [a.arm, a]));
      expect(arms.default?.visitors, 'F07 §2.5 — one enrolled control visitor').toBe(1);
      expect(arms.default?.byType?.purchase, 'F07 §7 — her purchase counts for the control arm although no served piece matched it').toBe(1);
      expect(arms.personalized?.visitors, 'F07 §2.5 — one enrolled treated visitor').toBe(1);
      expect(arms.personalized?.byType?.purchase, 'F07 §2.5 — his two purchases are one purchasing visitor, not two exposures').toBe(1);
      expect(claimsIn(built.body), 'document 35 :423 — counting business outcomes is not a licence to state a lift').toEqual([]);
    });
  }
});
