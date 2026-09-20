// src/units/W21/B3.unit.test.ts
// W21 batch B3 — the residuals the W21-B1 and W21-B2 build reviews left named:
// the hour-aggregate report path (the branch a nightly report really takes at
// volume) carrying the experimental ASSIGNMENT and the per-arm denominators;
// the window sweep that starts at the window's first day; the kit sentence a
// tenant published before this release is owed; and the scope of the
// publish-time salt annotation on a multi-brand tenant.
//
// One `describe('unit:W21.<id>')` per unit of batch W21-B3, one `it` per ruled
// leg. Every expected value comes from a witness or from a formula computed by
// hand below — never from what the engine returns today.
//
// WITNESSES
//   · document 35 §5 row W21 (:423): "Contain invalid incrementality/confidence/
//     target claims. Separately deliver persistent enrollment/salt/identity
//     policy, consent eligibility, actual production control, all eligible
//     visitor business outcomes and experiment provenance."
//   · docs/architecture/35-verification-reports/F25.md §5.3, §7: "The day report
//     carries `counts.visitors` for the day but NOT per arm, so the design effect
//     cannot be computed from what is stored"; the remedy is "a schema change
//     across hourly.ts → report.ts → window.ts with a version field".
//   · docs/architecture/35-verification-reports/F07.md §1.4, §7: a shopper who
//     turned personalization off is "indistinguishable in the report from a
//     hash-assigned control"; the remedy is "excluding or stratifying
//     consent-ineligible traffic".
//   · `_evidence/W21-B1/reviewer-build/REPORT.md` F3 (the blocker this batch
//     clears): "`runDayReport` (`src/learn/hourly.ts:1296-1304`) prefers
//     `publishAggregateDay` → `reportFromHours` whenever any hour aggregate
//     exists — the production path. That branch groups on `e.arm`
//     (`foldDecisions`), so an `ineligible` assignment pools into `default` at
//     volume, and answers `armVisitors: null`, `visitorOutcomes: null`. The units
//     pass because their fixture has no aggregates and falls through to the
//     raw-day branch." And `REPORT-DELTA.md:165`: the deferral "said plainly on
//     the row and verbatim in the kit (`02-api-reference.md:310-311`), asserted at
//     `B1.unit.test.ts:1243`" — the sentence this batch retires.
//   · `_evidence/W21-B2/reviewer-build/REPORT.md` finding 1: "`src/routes/
//     decisions.ts:659-672`: out-of-range keys before `from` are skipped with
//     `continue` but consume the page budget (`WINDOW_LIST_PAGES = 8` × 1000). A
//     window such as `from=2026-09-01&to=2026-12-31` sweeps prefix `<tenant>/2026-`
//     from January; a tenant with ≥8000 objects earlier that year gets
//     `objects: []`, `days: []`, `truncated: true`. … Recommend a follow-up unit
//     using `startAfter: `${tenant}/${from}`` on the R2 list so the sweep begins
//     at the window's first day."
//     finding 2: "`docs/kit/02-api-reference.md` attributes `saltVersion: null` to
//     the 24-revision horizon and an unfinished walk only; it does not say a learn
//     document published **before this release** carries no annotation and reads
//     `null` until its tenant next publishes."
//     residual 2: "Empty `holdout.salt` on a multi-brand tenant: publish annotates
//     against the tenant slug, a second brand is answered `null` — honest unknown,
//     never a wrong number; `experiment.id` unaffected."
//   · rulings R10, R19 (a host leg drives the mounted route production serves),
//     R21 (a ruled-but-absent member is named, and a widening cast is never used
//     to hide one), R101, R108 (`ineligible` is never control), R118, R126, R130,
//     R141, R146 (the readings for this batch).
//
// ONE REPRESENTATION, shared by every unit below, so no two units demand
// opposite things of the same fixture:
//
//  (i)   THE ARM ROWS OF A REPORT ARE THE EXPERIMENTAL ASSIGNMENT, ON EVERY
//        PATH (R108, R146(a)). `experiment.arm` where the record carries one and
//        the served `arm` where it does not, so a record written before the
//        provenance block existed keeps exactly the row it always had, and an
//        `ineligible` shopper is her own row and never inside `default`. This is
//        what the raw-day branch already does (`src/learn/report.ts:877`); the
//        hour-aggregate branch — the branch `runDayReport` prefers whenever the
//        day has any aggregate — must answer the same day the same way.
//  (ii)  THE ASSIGNMENT DOES NOT MOVE ANY OTHER COUNT. The exposure statistics
//        and the exploration denominator stay on the EXPERIENCE SERVED (doc 22
//        §10: holdout traffic never feeds the statistics; `report.ts:884` and
//        `hourly.ts:259` both test the served `arm`), so an `ineligible` shopper
//        served the site's defaults is not an exploration opportunity and is not
//        an exposure. Only the arm LABEL of a decision, of a credit and of a
//        visitor denominator is the assignment.
//  (iii) PER-ARM DENOMINATORS ARE VISITORS, AND AN UNKNOWN IS NAMED (F25 §5.3,
//        §7; the shape W21-B1 delivered on the raw-day branch). The day answer
//        carries
//            armVisitors: { version: 1; basis: 'distinct_visitors';
//                           arms: Array<{ arm: string; visitors: number }> } | null
//            visitorOutcomes: { version: 1; basis: 'enrolled_visitors';
//                           arms: Array<{ arm, visitors, byType }> } | null
//            allocation: { version: 1; source: 'published'; share: number; arms: string[] }
//        and `null` means the SOURCE cannot say — never zero and never re-derived
//        from the decision counts it does hold. A day summed from an hour
//        aggregate folded BEFORE this release cannot say, so it answers `null`
//        and names those hours in the ruled member
//            coverage.unassignedHours: number[] | null
//        (`[]` where every built hour carries the assignment; `null` where the
//        source does not record the member at all). This is the member family
//        `ReportCoverage` already uses for source limitations — `missingHours`,
//        `truncatedHours`, `unadvancedHours`, `unknownHours` — and the
//        `boolean | null` unknown `visitorsIncomplete` already states.
//  (iv)  THE SALT IS TENANT-WIDE, AND A BRAND THE ANNOTATION DOES NOT COVER SAYS
//        SO. Measured before ruling: one `holdout.salt` per tenant learn document
//        (`src/content/types.ts:190`, read per tenant at
//        `src/content/holdout.ts:69`), whose only per-brand dimension is the
//        empty-salt fallback to the brand (`holdout.ts:72`,
//        `src/content/service.ts:391`). The publish-time annotation is computed
//        for ONE effective salt — the published one, or the tenant slug where it
//        is empty (`src/config/publication.ts:169`) — so on a multi-brand tenant
//        with an empty salt a second brand's effective salt is a salt the
//        annotation was not computed for. It answers the honest unknown `null`,
//        never the other brand's number, and `experiment.id` still carries the
//        brand's own effective salt.
//  (v)   THE WINDOW EXPORT'S BUDGET IS UNCHANGED (W21.C1.07). The object budget
//        is applied where an object is TAKEN, a window that exceeds it answers
//        what it read and says `truncated: true`, and the single-`date` path is
//        byte-for-byte the path it was. What changes is only WHERE the sweep
//        begins: at the window's first day instead of at the shared prefix's
//        first key.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import { CONTENT_KIND, DEFAULT_LEARN, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, read } from '@/config/versionedStore';
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
import { consumeLedger } from '@/ledger/consume';
import { captureRetention, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { hourPrefix, ts36 } from '@/ledger/records';
import type { OutcomeRecord } from '@/ledger/records';
import { buildHour, catchUp, reportFromHours, type HourAggregate } from '@/learn/hourly';
import { runReport } from '@/learn/report';
import { invalidateSaltVersions, outcomeEnrollment } from '@/content/holdout';
import { configuredDestinations } from '@/connectors/config';
import type { Env } from '@/types/env';

// ===========================================================================
// The tenant's published fixture.
// ===========================================================================

const TENANT = 'coach';
/** The second brand of the same tenant (representation (iv)); never a second tenant. */
const SECOND_BRAND = 'harbor';
const SALT_A = 'w21-b3-experiment-a';
const OPERATOR_SECRET = 'w21-b3-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const IDENTITY_SECRET = 'w21-b3-identity-assertion-material';

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});

const W21_PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening-edit', { title: 'Evening, restated',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-rogue-work-edit', { title: 'The Rogue, at work',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] } }),
];
const W21_CATALOGUE = { version: 'w21-b3-coach-catalogue', pieces: W21_PIECES };
/** One page, one slot, take 1: one decision per served page, so every count below is exact. */
const W21_SLOTS: SlotCatalog = { version: 'w21-b3-coach-slots',
  pages: { home: [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }] } };

interface LearnFixture { salt?: string; share?: number }
/**
 * The tenant's learn document. `salt: ''` is the customer default the decision
 * path falls back to the BRAND for (`src/content/service.ts:391`), which is the
 * state representation (iv) is about.
 */
const learnDocument = (f: LearnFixture = {}) => ({
  holdout: { share: f.share ?? 0.5, salt: f.salt ?? SALT_A, arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { hero: { reward: 'click' } },
});

/** The same document as a `LearnConfig`, for the two logic legs that fold with it. */
const LEARN_CONFIG: LearnConfig = learnDocument() as unknown as LearnConfig;

// ===========================================================================
// The stores and the mounted application, in process, the way `src/index.ts`
// mounts it. Harness pattern reused from `src/units/W21/B2.unit.test.ts` and
// `src/routes/realtime.sdkContract.test.ts`; neither suite is imported or edited.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v;
  }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

/**
 * The object store. `list` implements the three options the platform uses —
 * `prefix`, `cursor` and `startAfter` — as R2 defines them: `startAfter` resumes
 * at the first key strictly greater than the value given, which is what the
 * window sweep of W21.C1.09 is ruled to pass. Every listing is recorded with the
 * options it was made with, so a unit can assert both what was read and what was
 * NOT (the single-`date` path never passes `startAfter`).
 */
class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  calls: string[] = [];
  listings: Array<{ prefix: string; startAfter?: string; cursor?: string; limit?: number }> = [];
  async get(key: string, options?: R2GetOptions) {
    this.calls.push(`get ${key}`);
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
  async list(options: { prefix?: string; cursor?: string; limit?: number; startAfter?: string } = {}) {
    this.calls.push(`list ${options.prefix ?? ''}${options.startAfter ? ` after ${options.startAfter}` : ''}`);
    this.listings.push({ prefix: options.prefix ?? '', ...(options.startAfter ? { startAfter: options.startAfter } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}), ...(options.limit === undefined ? {} : { limit: options.limit }) });
    const all = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '') && (options.startAfter === undefined || k > options.startAfter)).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: all.slice(start, end).map(key => ({ key, size: (this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < all.length, ...(end < all.length ? { cursor: String(end) } : {}) };
  }
  json<T>(key: string): T { return JSON.parse(this.objects.get(key)!) as T; }
}

const fixturePolicy: RetentionPolicy = { id: 'w21-b3-fixture-policy', revision: 1, durationMs: 365 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface Mounted {
  env: Env;
  storage: UnitR2;
  sessions: UnitKV;
  cache: UnitKV;
  fetch: (input: Request) => Promise<Response>;
  drain: () => Promise<void>;
  operatorToken: string;
}

const HOSTS = ['session', 'do'] as const;

async function mount(host: 'session' | 'do', learn: LearnFixture = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache(); invalidateSaltVersions();
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
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w21-b3-fixture', note: 'fixture', value } });
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
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); void queued; };
  return { env, storage, sessions, cache, fetch: fetchOne, drain, operatorToken };
}

async function operatorGet(m: Mounted, path: string, authenticated = true): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    headers: { 'X-Tenant': TENANT, ...(authenticated ? { Authorization: `Bearer ${m.operatorToken}` } : {}) },
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function operatorPost(m: Mounted, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', Authorization: `Bearer ${m.operatorToken}` },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/**
 * Publish a new revision of the tenant's learn document through the operator
 * route the console uses, so a salt rotation in a fixture is the same event a
 * customer's own rotation is.
 */
async function republishLearn(m: Mounted, document: unknown): Promise<number> {
  const read0 = await operatorGet(m, `/content/learn?scope=${TENANT}`);
  expect(read0.status, JSON.stringify(read0.body)).toBe(200);
  const publication = read0.body.publication as { revision: number; digest: string };
  const response = await m.fetch(new Request(`${OPERATOR_ORIGIN}/content/learn?scope=${TENANT}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json',
      'If-Match': `"${read0.body.revision as number}/${publication.revision}/${publication.digest}"`,
      'Idempotency-Key': `${read0.body.revision as number}:${crypto.randomUUID()}` },
    body: JSON.stringify({ document, note: 'w21-b3 fixture rotation' }),
  }));
  const body = await response.clone().json().catch(() => ({})) as { revision?: number };
  expect(response.status, await response.clone().text()).toBe(200);
  invalidatePublicationCache(); invalidateCache(); invalidateLiftCache();
  return body.revision ?? 0;
}

/** One published file of the customer kit. */
const kitFile = (file: string): string => readFileSync(new URL(`../../../docs/kit/${file}`, import.meta.url), 'utf8');

// ===========================================================================
// The ruled shape of a report answer (R21). Declared here, in the
// specification's own types, because the build has not added these members yet;
// the product type is never widened to hide one.
// ===========================================================================

interface ArmVisitorsBlock { version: number; basis: string; arms: Array<{ arm: string; visitors: number }> }
interface VisitorOutcomesBlock { version: number; basis: string; arms: Array<{ arm: string; visitors: number; byType: Record<string, number> }> }
interface ArmRow { arm: string; decisions: number; credited: number; creditedPerDecision: number | null; rate: number | null }
interface RuledDayReport {
  tenant: string; brand: string; date: string;
  counts: { decisions: number; outcomes: number; visitors: number; truncated: boolean };
  policies: Array<{ name: string; role: string; credits: number }>;
  grids: Record<string, Record<string, unknown>>;
  exploration: Array<{ slot: string; decisions: number; explored: number; realized: number; configured: number | null; mode: string | null }>;
  holdout: Record<string, ArmRow[]>;
  hours?: { source: string; built: number[]; missing: number[] };
  /** RULED (representation (iii)): `[]` when every built hour carries the assignment, `null` when the source does not say. */
  coverage?: { status: string; truncated: boolean; missingHours: number[]; unassignedHours?: number[] | null };
  armVisitors?: ArmVisitorsBlock | null;
  allocation?: { version: number; source: string; share: number; arms: string[] };
  visitorOutcomes?: VisitorOutcomesBlock | null;
}
const dayReportOf = (body: Record<string, unknown>) => body.report as unknown as RuledDayReport;
const ruled = (report: unknown) => report as unknown as RuledDayReport;

/**
 * Two answers that must be the same answer, compared member by member, with
 * every NUMBER required to agree to twelve significant digits rather than to
 * the last bit. Measured before it was written: the two branches reach the same
 * decayed accumulator by different orders of operations — the raw day decays
 * each event once, the fold decays an hour and then merges it — so
 * `n = 2.9809152606760674` on one path is `2.980915260676068` on the other
 * (probe of 2026-09-20 on this fixture). Anything structural — a missing item,
 * a different cell, an extra key, a changed string — still fails.
 */
function expectSameAnswer(actual: unknown, expected: unknown, why: string, path = ''): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (expected === actual) return;
    const scale = Math.max(Math.abs(expected), Math.abs(actual), 1);
    expect(Math.abs(actual - expected) / scale < 1e-12, `${why} at ${path || '(root)'}: ${actual} vs ${expected}`).toBe(true);
    return;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const a = actual as Record<string, unknown>, e = expected as Record<string, unknown>;
    expect(Object.keys(a).sort(), `${why} — the same members at ${path || '(root)'}`).toEqual(Object.keys(e).sort());
    for (const key of Object.keys(e)) expectSameAnswer(a[key], e[key], why, `${path}.${key}`);
    return;
  }
  expect(actual, `${why} at ${path || '(root)'}`).toEqual(expected);
}

// ===========================================================================
// The ledger fixture: real records, in the shape the consumer writes.
// ===========================================================================

const cellOf = () => ({ channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: 'occasion:evening' });

/** The enrollment provenance a record carries, as W21-B1 delivered it (`src/content/types.ts:159`). */
interface Provenance { id: string; saltVersion: number | null; arm: string; reason?: string; anchorGeneration: number }
const enrollment = (arm: string, reason?: string): Provenance =>
  ({ id: `${TENANT}:${TENANT}:${SALT_A}`, saltVersion: 1, arm, ...(reason ? { reason } : {}), anchorGeneration: 1 });

type SeededDecision = DecisionRecord & { experiment?: Provenance };

function decisionRecord(input: { visitor: string; arm: string; ts: number; item: string; index: number; experiment?: Provenance }): SeededDecision {
  return {
    decision_id: `${TENANT}:${ts36(input.ts)}:${input.visitor}:home:hero:${input.index}`,
    tenant: TENANT, brand: TENANT, visitor_id: input.visitor, session_id: `s-${input.visitor}`, identity_anchor: 'visitor',
    ts: input.ts, page: 'home', slot: 'hero', position: 0, item_id: input.item, customer_item_id: `CMS-${input.item}`,
    candidates: [], cell: cellOf(), arm: input.arm as DecisionRecord['arm'], explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w21-b3',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    ...(input.experiment ? { experiment: input.experiment } : {}),
  } as unknown as SeededDecision;
}

function outcomeRecord(input: { visitor: string; ts: number; type: 'click' | 'purchase'; item: string | null; index: number; decisionId?: string }): OutcomeRecord {
  const event = input.type === 'purchase' ? 'purchase' : 'content_click';
  return {
    outcome_id: `${TENANT}:${ts36(input.ts)}:${input.visitor}:${input.type}:${input.index}`,
    tenant: TENANT, brand: TENANT, visitor_id: input.visitor, session_id: `s-${input.visitor}`, ts: input.ts,
    type: input.type, event,
    item_id: input.item, slot: input.item ? 'hero' : null, value: input.type === 'purchase' ? 210 : null,
    currency: input.type === 'purchase' ? 'USD' : null, margin: null, products: null, arm: null,
    ...(input.decisionId ? { decision_id: input.decisionId } : {}),
  } as unknown as OutcomeRecord;
}

/** The ledger as the consumer lays it out: one object per hour and stream. */
function writeLedger(r2: UnitR2, decisions: SeededDecision[], outcomes: OutcomeRecord[]): void {
  const groups = new Map<string, string[]>();
  for (const d of decisions) { const k = `${hourPrefix(TENANT, d.ts)}/decision/${ts36(d.ts)}-${ts36(d.ts)}-w21b3.ndjson`; groups.set(k, [...(groups.get(k) ?? []), JSON.stringify(d)]); }
  for (const o of outcomes) { const k = `${hourPrefix(TENANT, o.ts)}/outcome/${ts36(o.ts)}-${ts36(o.ts)}-w21b3.ndjson`; groups.set(k, [...(groups.get(k) ?? []), JSON.stringify(o)]); }
  for (const [k, lines] of groups) { r2.objects.set(k, lines.join('\n') + '\n'); r2.versions.set(k, 1); }
}

/** The same day through the real queue consumer, for the host leg. */
async function seedLedgerDay(m: Mounted, date: string, decisions: SeededDecision[], outcomes: OutcomeRecord[]): Promise<void> {
  const stamp = <T extends { ts: number }>(row: T) => ({ ...row, retention: captureRetention(m.env, TENANT, row.ts) });
  const bodies: unknown[] = [];
  if (decisions.length) bodies.push({ kind: 'ledger', type: 'decisions', version: 1, records: decisions.map(stamp) });
  for (const outcome of outcomes) bodies.push({ kind: 'ledger', type: 'outcome', version: 1, record: stamp(outcome) });
  const result = await consumeLedger(m.env, bodies);
  expect(result.error, `the ${date} ledger fixture must be written by the real consumer`).toBeUndefined();
  expect(result.skipped, `every ${date} fixture envelope must be admitted`).toBe(0);
}

// ===========================================================================
// unit:W21.C1.08 — the hour-aggregate report path carries the assignment.
//
// THE DAY, BY HAND. One brand, one slot (`hero`, reward `click`), two hours of
// 2026-09-03. Eight decisions by five visitors, three outcomes. The decision
// counts and the visitor counts differ on purpose (F25 §5.3), and one credit
// crosses the hour boundary so the ring — not the hour — has to carry the
// assignment.
//
//   hour 12   d1 treated-1   personalized  12:10   (experiment.arm personalized)
//             d3 control-1   default       12:20   (experiment.arm default)
//             d4 ineligible-1 default      12:30   (experiment.arm ineligible,
//                                                   reason personalization_consent)
//             d2 treated-1   personalized  12:50   ← credited from hour 13
//             o1 control-1   purchase      12:40   (no decision reference)
//   hour 13   d5 treated-2   personalized  13:05
//             d6 treated-2   personalized  13:06
//             d7 ineligible-1 default      13:10
//             d8 legacy-1    default       13:15   (NO experiment block at all)
//             o2 treated-1   click         13:05 → d2 (15 min: inside the 30-min
//                                                  click window of DEFAULT_POLICY)
//             o3 ineligible-1 click        13:20 → d7 (10 min)
//
// THEREFORE, member by member:
//   holdout.hero, by ASSIGNMENT, arms sorted:
//     default      decisions 2 (d3, d8)      credited 0  → creditedPerDecision 0
//     ineligible   decisions 2 (d4, d7)      credited 1  → 0.5
//     personalized decisions 4 (d1,d2,d5,d6) credited 1  → 0.25
//   armVisitors (distinct visitors per assignment):
//     default 2 (control-1, legacy-1) · ineligible 1 · personalized 2
//   visitorOutcomes (enrolled visitors, and the outcome types they produced):
//     default {2, {purchase: 1}} · ineligible {1, {click: 1}} · personalized {2, {click: 1}}
//   counts: decisions 8, outcomes 3, visitors 5, truncated false
//   exploration.hero: decisions 4, explored 0 — the four decisions SERVED
//     `personalized` (representation (ii)); the two `ineligible` ones were served
//     the site's defaults and are not exploration opportunities.
//   allocation: { version 1, source 'published', share 0.5, arms ['default'] }
// ===========================================================================

const C1_08_DATE = '2026-09-03';
const T12 = Date.UTC(2026, 8, 3, 12, 0, 0);
const MIN = 60_000, HOUR = 3_600_000;
const C1_08_NOW = T12 + 4 * HOUR;

const TREATED_1 = 'vis-w21-b3-treated-1', TREATED_2 = 'vis-w21-b3-treated-2';
const CONTROL_1 = 'vis-w21-b3-control-1', INELIGIBLE_1 = 'vis-w21-b3-ineligible-1', LEGACY_1 = 'vis-w21-b3-legacy-1';

const d1 = decisionRecord({ visitor: TREATED_1, arm: 'personalized', ts: T12 + 10 * MIN, item: 'cnt-rogue-work-edit', index: 0, experiment: enrollment('personalized') });
const d2 = decisionRecord({ visitor: TREATED_1, arm: 'personalized', ts: T12 + 50 * MIN, item: 'cnt-tabby-evening-edit', index: 1, experiment: enrollment('personalized') });
const d3 = decisionRecord({ visitor: CONTROL_1, arm: 'default', ts: T12 + 20 * MIN, item: 'cnt-tabby-evening-edit', index: 0, experiment: enrollment('default') });
const d4 = decisionRecord({ visitor: INELIGIBLE_1, arm: 'default', ts: T12 + 30 * MIN, item: 'cnt-tabby-evening-edit', index: 0, experiment: enrollment('ineligible', 'personalization_consent') });
const d5 = decisionRecord({ visitor: TREATED_2, arm: 'personalized', ts: T12 + 65 * MIN, item: 'cnt-rogue-work-edit', index: 0, experiment: enrollment('personalized') });
const d6 = decisionRecord({ visitor: TREATED_2, arm: 'personalized', ts: T12 + 66 * MIN, item: 'cnt-rogue-work-edit', index: 1, experiment: enrollment('personalized') });
const d7 = decisionRecord({ visitor: INELIGIBLE_1, arm: 'default', ts: T12 + 70 * MIN, item: 'cnt-tabby-evening-edit', index: 1, experiment: enrollment('ineligible', 'personalization_consent') });
/** Written before the provenance block existed: read by the arm SERVED, exactly as before. */
const d8 = decisionRecord({ visitor: LEGACY_1, arm: 'default', ts: T12 + 75 * MIN, item: 'cnt-tabby-evening-edit', index: 0 });
const o1 = outcomeRecord({ visitor: CONTROL_1, ts: T12 + 40 * MIN, type: 'purchase', item: null, index: 0 });
const o2 = outcomeRecord({ visitor: TREATED_1, ts: T12 + 65 * MIN, type: 'click', item: 'cnt-tabby-evening-edit', index: 0, decisionId: d2.decision_id });
const o3 = outcomeRecord({ visitor: INELIGIBLE_1, ts: T12 + 80 * MIN, type: 'click', item: 'cnt-tabby-evening-edit', index: 1, decisionId: d7.decision_id });

const C1_08_DECISIONS = [d1, d3, d4, d2, d5, d6, d7, d8];
const C1_08_OUTCOMES = [o1, o2, o3];

const RULED_HOLDOUT: ArmRow[] = [
  { arm: 'default', decisions: 2, credited: 0, creditedPerDecision: 0, rate: 0 },
  { arm: 'ineligible', decisions: 2, credited: 1, creditedPerDecision: 0.5, rate: 0.5 },
  { arm: 'personalized', decisions: 4, credited: 1, creditedPerDecision: 0.25, rate: 0.25 },
];
const RULED_ARM_VISITORS = [{ arm: 'default', visitors: 2 }, { arm: 'ineligible', visitors: 1 }, { arm: 'personalized', visitors: 2 }];
const RULED_VISITOR_OUTCOMES = [
  { arm: 'default', visitors: 2, byType: { purchase: 1 } },
  { arm: 'ineligible', visitors: 1, byType: { click: 1 } },
  { arm: 'personalized', visitors: 2, byType: { click: 1 } },
];
const RULED_ALLOCATION = { version: 1, source: 'published', share: 0.5, arms: ['default'] };

/**
 * The kit sentence this batch RETIRES (`docs/kit/02-api-reference.md:371`,
 * locked at `src/units/W21/B1.unit.test.ts:1243` and corrected there under R10 in
 * the same commit as this file).
 */
const RETIRED_NIGHTLY_SENTENCE =
  'Until the hour aggregates carry the experimental assignment, the canonical nightly report groups by the arm served, so an `ineligible` assignment is counted in `default` on that path.';
/** And the sentence that replaces it (R146(a)). */
const NIGHTLY_GROUPING_SENTENCE =
  'The canonical nightly report groups by the experimental assignment on every path: `ineligible` is its own row, never part of `default`, and a day summed from hours folded before this release answers `armVisitors: null` and names those hours in `coverage.unassignedHours`.';

/**
 * The members `HourAggregate` and `HourBrand` carried before this release
 * (`src/learn/hourly.ts:162-181` and `:145-161` at 88a3443). Pruning a freshly
 * folded hour to exactly these — and to `version: 1`, the value a pre-release
 * aggregate literally carries — is how this specification obtains a PRE-RELEASE
 * hour aggregate without naming whichever member the build adds to carry the
 * assignment. Its rows carry no `experiment` either, so its `arms` map is the
 * same map under both grouping rules: what it cannot say is the DENOMINATORS.
 */
const PRE_RELEASE_AGGREGATE_MEMBERS = ['version', 'generation', 'tenant', 'date', 'hour', 'from', 'to', 'builtAt',
  'objects', 'objectsRead', 'truncated', 'horizonMs', 'shards', 'ringsFolded', 'brands'] as const;
const PRE_RELEASE_BRAND_MEMBERS = ['computation', 'duplicates', 'decisions', 'outcomes', 'visitorsDay',
  'visitorsIncomplete', 'policies', 'arms', 'exploration', 'rows_hidden'] as const;
function asPreReleaseAggregate(aggregate: HourAggregate): HourAggregate {
  const source = JSON.parse(JSON.stringify(aggregate)) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PRE_RELEASE_AGGREGATE_MEMBERS) if (Object.hasOwn(source, key)) out[key] = source[key];
  out.version = 1;
  const brands: Record<string, unknown> = {};
  for (const [brand, value] of Object.entries(source.brands as Record<string, Record<string, unknown>>)) {
    const kept: Record<string, unknown> = {};
    for (const key of PRE_RELEASE_BRAND_MEMBERS) if (Object.hasOwn(value, key)) kept[key] = value[key];
    brands[brand] = kept;
  }
  out.brands = brands;
  return out as unknown as HourAggregate;
}

describe('unit:W21.C1.08', () => {
  it('logic: the fold groups the day by the experimental assignment and the hour aggregates answer the per-arm visitor denominators, member for member with the raw-day branch; a pre-release aggregate answers them unknown and names its hours', async () => {
    const r2 = new UnitR2();
    writeLedger(r2, C1_08_DECISIONS, C1_08_OUTCOMES);
    const ids = { tenant: TENANT, brand: TENANT, date: C1_08_DATE };
    const store = r2 as unknown as Parameters<typeof buildHour>[0];

    // The fold itself, hour by hour, exactly as the five-minute job runs it.
    const hours = [await buildHour(store, TENANT, { date: C1_08_DATE, hour: 12 }, LEARN_CONFIG, C1_08_NOW),
      await buildHour(store, TENANT, { date: C1_08_DATE, hour: 13 }, LEARN_CONFIG, C1_08_NOW)];
    const folded = ruled(reportFromHours(hours, ids, LEARN_CONFIG, C1_08_NOW, { pending: 0, missing: [] }));
    const raw = ruled(await runReport(store as unknown as Parameters<typeof runReport>[0], ids, LEARN_CONFIG, null, C1_08_NOW));

    // This test may never pass on the raw-day fallback: the answer under
    // assertion is the one summed from the two hour aggregates (F3).
    expect(folded.hours?.source, 'F3 — the answer under assertion is the hour-aggregate branch').toBe('aggregates');
    expect(folded.hours?.built, 'F3 — summed from both folded hours').toEqual([12, 13]);

    // (i) The arm rows are the ASSIGNMENT, and `ineligible` is its own row.
    expect(folded.holdout.hero, 'R108/F07 §1.4 — the folded day groups by the experimental assignment, with `ineligible` its own row and never inside `default`')
      .toEqual(RULED_HOLDOUT);
    expect(raw.holdout.hero, 'the raw-day branch already groups this way, on the same records').toEqual(RULED_HOLDOUT);

    // (iii) The denominators, from the aggregates.
    expect(folded.armVisitors?.version, 'F25 §7 — the folded day carries the versioned per-arm denominators').toBe(1);
    expect(folded.armVisitors?.basis, 'F25 §5.3 — within a day the per-arm figure is distinct visitors').toBe('distinct_visitors');
    expect(folded.armVisitors?.arms, 'F25 §5.3 — two control visitors, one ineligible and two treated, not their 2/2/4 decisions')
      .toEqual(RULED_ARM_VISITORS);
    expect(folded.visitorOutcomes?.version, 'F07 §7 — visitor-level outcomes are versioned like the rest of the schema').toBe(1);
    expect(folded.visitorOutcomes?.basis, 'F07 §2.5 — the denominators are enrolled visitors, not exposures').toBe('enrolled_visitors');
    expect(folded.visitorOutcomes?.arms, 'F07 §7 — the control purchase and the two clicks, counted by visitor under the arm each visitor is enrolled in')
      .toEqual(RULED_VISITOR_OUTCOMES);
    expect(folded.allocation, 'F25 §1.3 — the published allocation the day was served under').toEqual(RULED_ALLOCATION);
    expect(folded.coverage?.unassignedHours, 'representation (iii) — every built hour carries the assignment, so the report names no hour that cannot')
      .toEqual([]);

    // The two branches answer the SAME day the same way.
    expect(folded.armVisitors, 'R146(a) — the two branches answer one day one way').toEqual(raw.armVisitors);
    expect(folded.visitorOutcomes, 'R146(a) — and one set of visitor-level outcomes').toEqual(raw.visitorOutcomes);
    expect(folded.allocation, 'R146(a) — and one published allocation').toEqual(raw.allocation);
    expect(folded.holdout, 'R146(a) — and one set of arm rows').toEqual(raw.holdout);
    expect(folded.counts, 'the counts the day already carried are unchanged').toEqual(raw.counts);
    expect(raw.counts, 'eight decisions by five visitors, three outcomes').toEqual({ decisions: 8, outcomes: 3, visitors: 5, truncated: false });
    expect(folded.policies, 'the credits under every policy are unchanged').toEqual(raw.policies);
    expectSameAnswer(folded.grids, raw.grids, 'R146(a) — and the lift terms the exposures alone feed are the same terms');

    // (ii) The assignment moved no other count: the exploration denominator and
    // the exposures are still the EXPERIENCE SERVED.
    expect(folded.exploration, 'doc 22 §10 — the exploration denominator is the four decisions SERVED `personalized`, never the assignment')
      .toEqual([{ slot: 'hero', decisions: 4, explored: 0, realized: 0, configured: null, mode: null }]);
    expect(folded.exploration, 'and the raw-day branch agrees').toEqual(raw.exploration);

    // A PRE-RELEASE hour aggregate: it cannot say what the denominators are, so
    // it says so — and it still answers the day it can compute.
    const legacyR2 = new UnitR2();
    const legacyT = 'vis-w21-b3-pre-treated', legacyC = 'vis-w21-b3-pre-control';
    const ld1 = decisionRecord({ visitor: legacyT, arm: 'personalized', ts: T12 + 10 * MIN, item: 'cnt-rogue-work-edit', index: 0 });
    const ld2 = decisionRecord({ visitor: legacyC, arm: 'default', ts: T12 + 20 * MIN, item: 'cnt-tabby-evening-edit', index: 0 });
    const lo1 = outcomeRecord({ visitor: legacyT, ts: T12 + 25 * MIN, type: 'click', item: 'cnt-rogue-work-edit', index: 0, decisionId: ld1.decision_id });
    writeLedger(legacyR2, [ld1, ld2], [lo1]);
    const preRelease = asPreReleaseAggregate(await buildHour(legacyR2 as unknown as Parameters<typeof buildHour>[0],
      TENANT, { date: C1_08_DATE, hour: 12 }, LEARN_CONFIG, C1_08_NOW));
    const historical = ruled(reportFromHours([preRelease], ids, LEARN_CONFIG, C1_08_NOW, { pending: 0, missing: [] }));
    expect(historical.holdout.hero, 'a pre-release aggregate still answers the day it can compute')
      .toEqual([{ arm: 'default', decisions: 1, credited: 0, creditedPerDecision: 0, rate: 0 },
        { arm: 'personalized', decisions: 1, credited: 1, creditedPerDecision: 1, rate: 1 }]);
    expect(historical.armVisitors, 'F25 §7 — a source folded before the assignment existed is unknown, never zero and never re-derived').toBeNull();
    expect(historical.visitorOutcomes, 'F07 §7 — and its visitor-level outcomes are unknown for the same reason').toBeNull();
    expect(historical.coverage?.unassignedHours, 'representation (iii) — and the report NAMES the hour that cannot say, instead of leaving a silent null')
      .toEqual([12]);

    // R146(a): the deferral is retired, and what replaces it is published.
    const kit = kitFile('02-api-reference.md');
    expect(kit.includes(NIGHTLY_GROUPING_SENTENCE),
      `R146(a) — docs/kit/02-api-reference.md must publish the delivered grouping in these words: "${NIGHTLY_GROUPING_SENTENCE}"`).toBe(true);
    expect(kit.includes(RETIRED_NIGHTLY_SENTENCE),
      'R146(a) — and must no longer publish the deferral it replaces, which is no longer true of any path').toBe(false);
  });

  it('host: the nightly fold and the mounted report route answer the day by assignment, with the per-arm denominators, from the aggregates', async () => {
    const m = await mount('session');
    await seedLedgerDay(m, C1_08_DATE, C1_08_DECISIONS, C1_08_OUTCOMES);

    // The production fold: the five-minute job's own call, with the learn
    // document the route reads (`src/index.ts:270-273`).
    const learn = await read<LearnConfig>(m.env, LEARN_KIND, TENANT, DEFAULT_LEARN);
    const result = await catchUp(m.storage as unknown as Parameters<typeof catchUp>[0], TENANT, learn, C1_08_NOW,
      { lookbackHours: 4 }, m.env);
    expect(result.built.map(b => b.hour), 'the two closed hours of the fixture day are folded').toEqual([12, 13]);
    expect(result.reports.published, 'and the day report is published from them').toEqual([C1_08_DATE]);

    const answer = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${C1_08_DATE}`);
    expect(answer.status, JSON.stringify(answer.body).slice(0, 300)).toBe(200);
    const report = dayReportOf(answer.body);
    expect(report.hours?.source, 'F3 — the stored nightly report is the one summed from the hour aggregates').toBe('aggregates');
    expect(report.hours?.built, 'both folded hours').toEqual([12, 13]);
    expect(report.holdout.hero, 'R108 — the nightly answer groups by the experimental assignment, with `ineligible` its own row')
      .toEqual(RULED_HOLDOUT);
    expect(report.armVisitors?.arms, 'F25 §5.3 — with the per-arm visitor denominators on the answer a customer reads')
      .toEqual(RULED_ARM_VISITORS);
    expect(report.armVisitors?.basis, 'F25 §5.3 — named as distinct visitors within the day').toBe('distinct_visitors');
    expect(report.visitorOutcomes?.arms, 'F07 §7 — and the visitor-level business outcomes per arm').toEqual(RULED_VISITOR_OUTCOMES);
    expect(report.allocation, 'F25 §1.3 — and the published allocation').toEqual(RULED_ALLOCATION);
    expect(report.counts, 'the counts the day already carried').toEqual({ decisions: 8, outcomes: 3, visitors: 5, truncated: false });
    expect(report.coverage?.unassignedHours, 'representation (iii) — no built hour predates the assignment on this day').toEqual([]);

    // The on-demand rebuild takes the same branch and answers the same day.
    const rebuilt = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: C1_08_DATE, brand: TENANT });
    expect(rebuilt.status, JSON.stringify(rebuilt.body).slice(0, 300)).toBe(200);
    expect(dayReportOf(rebuilt.body).hours?.source, 'F3 — the operator rebuild prefers the aggregate branch too').toBe('aggregates');
    expect(dayReportOf(rebuilt.body).holdout.hero, 'and answers the same arm rows').toEqual(RULED_HOLDOUT);
    expect(dayReportOf(rebuilt.body).armVisitors?.arms, 'and the same denominators').toEqual(RULED_ARM_VISITORS);
  });
});

// ===========================================================================
// unit:W21.C1.09 — the window sweep starts at the window's first day.
//
// W21-B2 finding 1, by hand: the sweep runs under the prefix the window's days
// SHARE, so `from=2026-09-01&to=2026-10-31` sweeps `coach/2026-` from the first
// key of the year. Eight pages of a thousand keys is the whole listing budget
// (`WINDOW_LIST_PAGES = 8`), so a tenant with 8 000 objects earlier in the year
// is answered `objects: []`, `days: []`, `truncated: true` — while the same
// tenant's single-`date` request still answers. The remedy is `startAfter`:
// the sweep begins at the window's first day and the earlier objects are never
// paged through at all.
// ===========================================================================

describe('unit:W21.C1.09', () => {
  it('host: a window over a tenant with eight thousand earlier objects in the same year is answered its own days inside the same budget, while the truncation rule and the single-date path are unchanged', async () => {
    const m = await mount('session');
    const from = '2026-09-01', to = '2026-10-31';          // 61 days, one calendar year, two months: one shared prefix, `coach/2026-`
    const EARLIER = '2026-01-05';
    for (let n = 0; n < 8000; n++) {
      const key = `${TENANT}/${EARLIER}/09/decision/${String(n).padStart(5, '0')}-w21b3.ndjson`;
      m.storage.objects.set(key, '{}\n'); m.storage.versions.set(key, 1);
    }
    for (const date of ['2026-09-15', '2026-10-20']) {
      const key = `${TENANT}/${date}/09/decision/0001-w21b3.ndjson`;
      m.storage.objects.set(key, '{}\n'); m.storage.versions.set(key, 1);
    }

    m.storage.calls.length = 0; m.storage.listings.length = 0;
    const windowed = await operatorGet(m, `/v1/${TENANT}/ledger/batches?from=${from}&to=${to}`);
    expect(windowed.status, JSON.stringify(windowed.body).slice(0, 200)).toBe(200);
    const body = windowed.body as { objects?: Array<{ date: string }>; days?: string[]; truncated?: boolean };
    expect((body.objects ?? []).map(o => o.date), 'W21-B2 finding 1 — the window delivers its own two days, whatever the tenant wrote earlier that year')
      .toEqual(['2026-09-15', '2026-10-20']);
    expect(body.truncated, 'having read the whole window inside the budget').toBe(false);
    expect(body.days, 'and naming the window it read').toEqual([...Array(61).keys()].map(n => new Date(Date.parse(from) + n * 86_400_000).toISOString().slice(0, 10)));
    const lists = m.storage.listings.filter(l => l.prefix.startsWith(`${TENANT}/`));
    expect(lists.length <= 4, `W21.C1.07 — and still costing at most four listings for a 61-day window (made ${lists.length})`).toBe(true);

    // The truncation rule is unchanged: a window whose OWN content exceeds the
    // object budget answers what it read and says it stopped.
    const heavy = await mount('session');
    for (let n = 0; n < 1000; n++) {
      const key = `${TENANT}/2026-09-15/09/decision/${String(n).padStart(5, '0')}-w21b3.ndjson`;
      heavy.storage.objects.set(key, '{}\n'); heavy.storage.versions.set(key, 1);
    }
    const capped = await operatorGet(heavy, `/v1/${TENANT}/ledger/batches?from=${from}&to=${to}`);
    expect(capped.status, JSON.stringify(capped.body).slice(0, 200)).toBe(200);
    const cappedBody = capped.body as { objects?: unknown[]; days?: string[]; truncated?: boolean };
    expect((cappedBody.objects ?? []).length, 'W21.C1.07 — the object budget still holds for the request as a whole').toBe(800);
    expect(cappedBody.truncated, 'W21.C1.07 — and a window that stopped short says so').toBe(true);
    expect(cappedBody.days?.at(-1), 'W21.C1.07 — naming the last day the sweep reached').toBe('2026-09-15');

    // The single-`date` path is the path it was: one listing of that day's own
    // prefix, no window `startAfter`, and the same 1 000 objects with the cursor
    // it always answered (`src/index.api-boundary.test.ts:3090-3091`).
    m.storage.calls.length = 0; m.storage.listings.length = 0;
    const single = await operatorGet(m, `/v1/${TENANT}/ledger/batches?date=${EARLIER}`);
    expect(single.status, JSON.stringify(single.body).slice(0, 200)).toBe(200);
    const singleBody = single.body as { objects?: unknown[]; truncated?: boolean; cursor?: string; days?: string[] };
    expect((singleBody.objects ?? []).length, 'the single-date listing answers its page exactly as before').toBe(1000);
    expect(singleBody.truncated, 'and says the day has more').toBe(true);
    expect(typeof singleBody.cursor, 'and carries the cursor that continues that one day').toBe('string');
    expect(m.storage.listings.filter(l => l.prefix.startsWith(`${TENANT}/`)).map(l => [l.prefix, l.startAfter ?? null]),
      'the single-date path lists that one day\'s own prefix and passes no window start')
      .toEqual([[`${TENANT}/${EARLIER}/`, null]]);
  });
});

// ===========================================================================
// unit:W21.E1.09 — the kit states what a tenant who has not published since
// this release will read.
//
// W21-B2 finding 2: the kit attributes `saltVersion: null` to the 24-revision
// horizon and an unfinished walk only. The annotation is computed on the
// operator's PUBLISH (`src/config/publication.ts:163`), so a learn document
// published before this release carries none and its records read `null` until
// that tenant next publishes. Existing tenants see the change with no published
// explanation. `E1.07`'s behaviour is locked and is not re-specified here.
// ===========================================================================

const PRE_RELEASE_SALT_SENTENCE =
  'A learn document published before this release carries no salt-version annotation, so decisions and outcomes under it read `saltVersion: null` until that tenant next publishes its learn document.';

describe('unit:W21.E1.09', () => {
  it('logic: the published reference states that a learn document from before this release reads `saltVersion: null` until its tenant next publishes', () => {
    const kit = kitFile('02-api-reference.md');
    expect(kit.includes('saltVersion'), 'the reference already publishes the member this sentence is about').toBe(true);
    expect(kit.includes(PRE_RELEASE_SALT_SENTENCE),
      `W21-B2 finding 2 — docs/kit/02-api-reference.md must publish the pre-release case in these words: "${PRE_RELEASE_SALT_SENTENCE}"`).toBe(true);
  });
});

// ===========================================================================
// unit:W21.E1.10 — the salt annotation follows the salt's scope.
//
// MEASURED BEFORE RULING (representation (iv)): the salt is TENANT-WIDE. One
// `holdout.salt` on one learn document per tenant; the only per-brand dimension
// is the empty-salt fallback to the brand, which the publish-time annotation
// cannot see, because it is computed for the tenant slug. Therefore the ruled
// outcome is the honest unknown and nothing more:
//
//   · with an EMPTY published salt, the brand that is the tenant slug reads the
//     annotation's version (1 on a first revision), and a SECOND brand — whose
//     effective salt is its own name, a salt the annotation was not computed for
//     — reads `saltVersion: null`, never the first brand's number;
//   · `experiment.id` is unaffected either way: it carries the brand's own
//     effective salt, so the two brands are two experiments and say so;
//   · with an EXPLICIT salt the scope is the tenant, so BOTH brands read the
//     same version — which is also what proves the `null` above is not a
//     constant.
// ===========================================================================

/** An anonymous visitor id, in the shape the capability requires (`src/identity/sessionCapability.ts:42`). */
const SECOND_BRAND_VISITOR = 'vis-00000021-0b03-4000-8000-000000000001';

describe('unit:W21.E1.10', () => {
  it('logic: on a tenant whose published salt is empty, the recorded enrollment of a second brand names its own experiment and reads the salt version as unknown, never the first brand\'s', async () => {
    const m = await mount('session', { salt: '' });

    const first = await outcomeEnrollment(m.env, TENANT as never, TENANT, SECOND_BRAND_VISITOR, true);
    expect(first?.id, 'the tenant-slug brand is enrolled under its own effective salt').toBe(`${TENANT}:${TENANT}:${TENANT}`);
    expect(first?.saltVersion, 'R130 — and reads the annotation the publish computed for that salt').toBe(1);

    const second = await outcomeEnrollment(m.env, TENANT as never, SECOND_BRAND, SECOND_BRAND_VISITOR, true);
    expect(second?.id, 'representation (iv) — the second brand of the same tenant is its own experiment, under its own effective salt')
      .toBe(`${TENANT}:${SECOND_BRAND}:${SECOND_BRAND}`);
    expect(second?.saltVersion, 'W21-B2 residual 2 — and the version of a salt no annotation was computed for is the honest unknown, never the other brand\'s number')
      .toBeNull();

    // The unknown is a statement about the annotation's scope, not a constant:
    // an explicit salt IS tenant-wide, so both brands read the same version.
    await republishLearn(m, learnDocument({ salt: SALT_A }));
    const rotatedFirst = await outcomeEnrollment(m.env, TENANT as never, TENANT, SECOND_BRAND_VISITOR, true);
    const rotatedSecond = await outcomeEnrollment(m.env, TENANT as never, SECOND_BRAND, SECOND_BRAND_VISITOR, true);
    expect(rotatedFirst?.id, 'the rotation starts a new experiment for the first brand').toBe(`${TENANT}:${TENANT}:${SALT_A}`);
    expect(rotatedSecond?.id, 'and for the second brand, under the same tenant-wide salt').toBe(`${TENANT}:${SECOND_BRAND}:${SALT_A}`);
    expect(rotatedFirst?.saltVersion, 'R118(6) — the second distinct effective salt this tenant has published').toBe(2);
    expect(rotatedSecond?.saltVersion, 'representation (iv) — and an explicit salt is tenant-wide, so the second brand reads the same version').toBe(2);
  });

  for (const host of HOSTS) {
    it(`host (${host}): a decision served for a second brand of the same tenant carries that brand's own experiment id and an unknown salt version`, async () => {
      const m = await mount(host, { salt: '' });
      const sessionId = `s-${SECOND_BRAND_VISITOR.replace(/^vis-/, '')}`;
      const grant = await issueSessionCapability(m.env, { tenant: TENANT, subject: SECOND_BRAND_VISITOR, sessionId, kind: 'anonymous' });
      const call = (path: string, body?: unknown) => m.fetch(new Request(`https://synthetic.invalid${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      // Her own consent, through the route the SDK calls: she is in the
      // experiment, so the decision answers a provenance block at all.
      const consent = await call(`/realtime/session/${sessionId}/preferences`, {
        trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
      });
      expect(consent.status, `her consent choice must be accepted: ${await consent.clone().text()}`).toBe(200);
      await m.drain();
      const answerFor = async (brand: string) => {
        invalidatePublicationCache();
        const response = await call(`/v1/${TENANT}/decisions/snapshot?page=home&brand=${brand}`);
        const body = await response.clone().json().catch(() => ({})) as { experiment?: Provenance };
        await m.drain();
        return { status: response.status, experiment: body.experiment };
      };

      const tenantBrand = await answerFor(TENANT);
      expect(tenantBrand.status, 'the tenant-slug brand is served').toBe(200);
      expect(tenantBrand.experiment?.id, 'under its own effective salt').toBe(`${TENANT}:${TENANT}:${TENANT}`);
      expect(tenantBrand.experiment?.saltVersion, 'R130 — reading the annotation the publish computed for that salt').toBe(1);

      const other = await answerFor(SECOND_BRAND);
      expect(other.status, 'the second brand is served too').toBe(200);
      expect(other.experiment?.id, 'representation (iv) — and its records name its own experiment')
        .toBe(`${TENANT}:${SECOND_BRAND}:${SECOND_BRAND}`);
      expect(other.experiment?.saltVersion, 'W21-B2 residual 2 — with the honest unknown for a salt no annotation covers, never the other brand\'s number')
        .toBeNull();
    });
  }
});
