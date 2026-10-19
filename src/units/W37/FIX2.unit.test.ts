// src/units/W37/FIX2.unit.test.ts
// W37 fix round 2 — the two defects the delivery review of 7a1b087 found and the
// gated tests at 84147aa do not catch (reviewer report
// _evidence/W37-delivery/reviewer/REPORT.md; lead ruling of 2026-09-30,
// _evidence/step3/AMENDMENTS.md, the last W37 entry). One
// `describe('unit:W37.<criterion>.<nn>')` per requirement, one `it` per leg.
//
// AUTHORITY: document 35 §5 row W37 (:444), the frozen work order
// (docs/remediation/delivery-control/program.json, ticket W37):
//   · T2 — "Every cron and the hourly fold publish per brand as the tenant's own
//     records define brands (no brand registry exists); the day-report cron does
//     not assume brand equals tenant."
//   · T5 — "Per-shopper export and erasure work for shoppers of two non-default
//     brands and reach every store that holds that tenant's shopper data
//     (decision D2)."
//
// DEFECT 1 (T2). The nightly job writes the tenant's own day even when another
// brand's day of that date was not stored; the five-minute run takes a saved own
// day that names every built hour as "the date is published" and skips the date,
// so the failed brand's day is never published again (reviewer probe-t2.log).
// The five-minute run's own rule — "a date whose other brand's day failed or was
// superseded is published again, whole, by the next run" (kit 02 as built, the
// T2 paragraph) — must hold after the nightly job too. Whether the nightly job
// withholds the own day or the run retries the date is the build's choice
// (brief); this file asserts on the stored reports only.
//
// DEFECT 2 (T5). The erasure reaches, besides the browsers her person record
// lists, every browser the tenant's `identity:visitor:` links name as hers
// (src/identity/erase.ts discoverPage, the paged link scan). Her person record
// lists at most 50 browsers (src/identity/store.ts link, `slice(-50)`; the
// object host's `identityMembers` the same), so a browser that signed in to her
// account before 50 later ones is linked to her and missing from her record: the
// erasure deletes it, the export at 7a1b087 does not answer it (reviewer probe
// P4). LEAD RULING (2026-09-30): the export must reach the browsers the erasure
// reaches; a text-only correction does not meet T5.
//
// ONE REPRESENTATION with src/units/W37/LEDGER.unit.test.ts: the same fixture
// stamp (acme and globex registered, no default tenant; acme also serves the
// brand acme-outlet), the kit's Coach taxonomy with an unknown category and a
// cross-category occasion list, the same ledger day for T2, and for T5 the same
// ruled export data per id (the documented operator reads and the ruled store
// members, each "as stored") and the same carry rule (a datum is exported when
// the answer carries it at any depth and under any name). Paging is the export's
// own: `complete:false` with `next`, continued with `cursor: next`.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import type { Env } from '@/types/env';
import { tenantMiddleware } from '@/tenancy/middleware';
import { sdkKey, operatorWrites } from '@/middleware/edgeAccess';
import { errorHandler } from '@/middleware/error';
import realtimeRoutes from '@/routes/realtime';
import { identityRoutes } from '@/routes/identity';
import { decisionRoutes } from '@/routes/decisions';
import { sortRoutes } from '@/routes/sort';
import { authRoutes } from '@/routes/auth';
import { operatorRoutes } from '@/routes/operator';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { RegionTrend } from '@/durable-objects/RegionTrend';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { newAnonymousSession, issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { storedConsent } from '@/content/consent';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { invalidateTrendCache } from '@/reflex/regionTrend';
import { shopperObjectName } from '@/tenancy/objects';
import { retentionBirth, type RetentionPolicy } from '@/retention';
import { hourPrefix, ts36 } from '@/ledger/records';
import { reportKey } from '@/learn/report';
import { signAssertion } from '@/identity/assertion';
import { isShopperId } from '@/identity/shopperId';
import { bundleNativeWorker, nativeScratchDirectory, openNativeRuntime, type NativeRuntime } from '../_native';

// ===========================================================================
// The fixture stamp (as src/units/W37/LEDGER.unit.test.ts:85-110).
// ===========================================================================

const ACME = 'acme', GLOBEX = 'globex', OUTLET = 'acme-outlet';
const DAY = 86_400_000, HOUR = 3_600_000;
const SECRET = 'w37-fix2-synthetic-signing-material-only';
const policy = (durationMs = 365 * DAY): RetentionPolicy => ({ id: 'w37-fix2-fixture-policy', revision: 1, durationMs, basis: 'admitted', renewal: 'new-record-only' });
const categories = () => ({ profile: policy(), identity: policy(), ledger: policy(), online: policy(), hourly: policy() });
const retentionFor = (tenants: string[]) => JSON.stringify({ version: 1, tenants: Object.fromEntries(tenants.map(tenant => [tenant, categories()])) });
const registry = (tenants: string[]) => JSON.stringify({ provisioned: tenants });

/** The kit's Coach taxonomy (docs/kit/03-payload-schemas.md:19), with an unknown and a cross-category value. */
const TABBY_VIEW = { productId: 'W37-TABBY-26', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['evening', 'work'], price_usd: 395 };
const UNKNOWN_VIEW = { productId: 'W37-UNFILED', line: 'Unfiled', category: 'Unknown Category', occasion: ['evening', 'travel', 'gift'], price_usd: 12 };

/** The tenant's published configuration: publication is the only configuration authority (src/config/publication.ts:19). */
function publicationFor(tenant: string, learn: unknown = { holdout: { share: 0, salt: `w37-${tenant}`, arms: ['default'] }, slots: { hero: { reward: 'click' } } }): PublicationBaseline[] {
  const revision = (value: unknown) => ({ revision: 1, at: 1, actor: 'w37-fix2-fixture', note: '', value });
  return [
    { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: revision({ ...DEFAULT_REFLEX_CONFIG, version: `w37-${tenant}`, eventAttributes: 'event-when-unknown' as const }) },
    { kind: CONTENT_KIND, scope: tenant, revision: revision({ pieces: [
      { id: 'tabby-evening', customerContentId: 'CMS-TABBY-EVENING', type: 'editorial', title: 'Tabby, after six', tags: { line: ['Tabby'], occasion: ['evening'] }, slotTypes: ['hero'] },
      { id: 'rogue-work', customerContentId: 'CMS-ROGUE-WORK', type: 'video', title: 'The Rogue, at work', tags: { line: ['Rogue'], occasion: ['work'] }, slotTypes: ['hero'] },
    ] }) },
    { kind: SLOTS_KIND, scope: tenant, revision: revision({ pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1, occasion: 0.5 } }] } }) },
    { kind: LEARN_KIND, scope: tenant, revision: revision(learn) },
  ];
}

// ===========================================================================
// unit:W37.T2.01 — the nightly job during which one brand's day write fails,
// then the next five-minute run.
//
// The ledger day is the gated one (LEDGER.unit.test.ts:505-529): yesterday, in
// one hour, acme served two decisions under its own brand and three under
// acme-outlet, globex one under its own, each with a click; objects written as
// the consumer writes them, with their retention births.
//
// The runtime is the REAL src/index.ts in workerd (src/units/_native.ts), its
// scheduled handler run by the cron name, as the gated T2 legs run it. The
// wrapper adds fixture doors only: publish a tenant's documents, seed raw ledger
// objects, move the runtime's clock forward, read stored objects back, and a
// STORAGE fault: while a prefix is set, the scheduled handler's STORAGE refuses a
// put under it (an outage of that one brand's day objects) and counts it.
//
// The runtime's clock is moved to 12:20 UTC (forward only), so every hour the
// runs fold after the date is closed belongs to today, never to the ledger's
// day: a new hour of that date cannot republish it by accident whatever the
// wall-clock time of the run.
// ===========================================================================

function ledgerDay(tenants: string[], at: number) {
  const retentionEnv = { TENANTS: registry(tenants), RETENTION: retentionFor(tenants), DEPLOYMENT_PROFILE: 'demo' } as Pick<Env, 'TENANTS' | 'RETENTION' | 'DEPLOYMENT_PROFILE'>;
  const hour = Math.floor(at / HOUR) * HOUR, objects: [string, string][] = [];
  const cell = { channel: 'direct', visit_bucket: '1', region: 'US-NY', affinity: null };
  const stamps = (tenant: string, ts: number) => Object.fromEntries((['ledger', 'online', 'hourly'] as const).map(category => [category, retentionBirth(retentionEnv, tenant, category, ts, ts)]));
  const served: Array<{ tenant: string; brand: string; visitor: string }> = [
    { tenant: ACME, brand: ACME, visitor: 'vis-w37-acme-1' }, { tenant: ACME, brand: ACME, visitor: 'vis-w37-acme-2' },
    { tenant: ACME, brand: OUTLET, visitor: 'vis-w37-outlet-1' }, { tenant: ACME, brand: OUTLET, visitor: 'vis-w37-outlet-2' }, { tenant: ACME, brand: OUTLET, visitor: 'vis-w37-outlet-3' },
    { tenant: GLOBEX, brand: GLOBEX, visitor: 'vis-w37-globex-1' },
  ];
  served.forEach(({ tenant, brand, visitor }, n) => {
    const ts = hour + (n + 1) * 60_000, clicked = ts + 1_000;
    const decision = { decision_id: `${tenant}:${ts36(ts)}:${visitor}:home:hero:0`, tenant, brand, visitor_id: visitor, session_id: `s-${visitor}`, identity_anchor: 'visitor', ts,
      page: 'home', slot: 'hero', position: 0, item_id: 'tabby-evening', customer_item_id: 'CMS-TABBY-EVENING', candidates: [], cell, arm: 'personalized', explored: false,
      authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: `w37-${tenant}`, explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
      retention: stamps(tenant, ts) };
    const outcome = { outcome_id: `${tenant}:${ts36(clicked)}:${visitor}:click`, tenant, brand, visitor_id: visitor, session_id: `s-${visitor}`, ts: clicked, type: 'click', event: 'click',
      item_id: 'tabby-evening', slot: 'hero', value: null, currency: null, margin: null, products: null, arm: null, retention: stamps(tenant, clicked) };
    objects.push([`${hourPrefix(tenant, ts)}/decision/${ts36(ts)}-${ts36(ts)}-w37.ndjson`, JSON.stringify(decision) + '\n']);
    objects.push([`${hourPrefix(tenant, clicked)}/outcome/${ts36(clicked)}-${ts36(clicked)}-w37.ndjson`, JSON.stringify(outcome) + '\n']);
  });
  const date = new Date(hour).toISOString().slice(0, 10);
  const expected = { [`${ACME}/${ACME}`]: 2, [`${ACME}/${OUTLET}`]: 3, [`${GLOBEX}/${GLOBEX}`]: 1 };
  return { objects, date, hour, expected, retention: retentionEnv.RETENTION! };
}

const NATIVE_WRAPPER = `
import worker, { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
export { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend };
let clockAdvance = 0, clockInstalled = false, failing = null, refused = 0;
/** The scheduled handler's STORAGE while a prefix is set: a put under it is refused, as an outage of those objects would refuse it. */
function faulty(storage) {
  return new Proxy(storage, { get(target, property) {
    if (property === 'put') return async (key, value, options) => {
      if (failing !== null && typeof key === 'string' && key.startsWith(failing)) { refused++; throw new Error('fixture: this brand\\'s day write fails'); }
      return target.put(key, value, options);
    };
    const member = Reflect.get(target, property);
    return typeof member === 'function' ? member.bind(target) : member;
  } });
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== 'w37-fix2-fixture') return worker.fetch(request, env, ctx);
    const input = request.method === 'POST' ? await request.json() : {};
    if (url.pathname === '/publish') {
      const revision = value => ({ revision: 1, at: 1, actor: 'w37-fix2-native', note: '', value });
      await initializePublicationSet(env, [
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision(input.reflex) },
        { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) },
        { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
        { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) },
      ], '0:' + crypto.randomUUID());
      return Response.json({ published: input.tenant });
    }
    if (url.pathname === '/seed') { for (const [key, body] of input.objects) await env.STORAGE.put(key, body); return Response.json({ seeded: input.objects.length }); }
    if (url.pathname === '/clock') {
      if (!(Number.isSafeInteger(input.advanceMs) && input.advanceMs > 0)) return new Response(null, { status: 400 });
      if (!clockInstalled) { const wall = Date.now.bind(Date); Date.now = () => wall() + clockAdvance; clockInstalled = true; }
      clockAdvance += input.advanceMs;
      return Response.json({ advancedMs: clockAdvance, now: Date.now() });
    }
    if (url.pathname === '/fail') { failing = typeof input.prefix === 'string' ? input.prefix : null; return Response.json({ failing }); }
    if (url.pathname === '/scheduled') {
      const pending = []; refused = 0;
      const runtimeEnv = failing === null ? env : { ...env, STORAGE: faulty(env.STORAGE) };
      await worker.scheduled({ cron: input.cron, scheduledTime: Date.now(), noRetry() {} }, runtimeEnv,
        { waitUntil(promise) { pending.push(Promise.resolve(promise)); }, passThroughOnException() {} });
      let rejected = 0; for (let i = 0; i < pending.length; i++) { try { await pending[i]; } catch { rejected++; } }
      return Response.json({ jobs: pending.length, rejected, refused, now: Date.now() });
    }
    if (url.pathname === '/objects') {
      const out = {}; let cursor;
      do { const page = await env.STORAGE.list({ prefix: input.prefix, cursor });
        for (const o of page.objects) out[o.key] = await (await env.STORAGE.get(o.key)).text(); cursor = page.truncated ? page.cursor : undefined; } while (cursor);
      return Response.json(out);
    }
    return new Response(null, { status: 404 });
  },
};`;

async function nativeStamp(name: string, bindings: Record<string, string>) {
  const bundle = await bundleNativeWorker(NATIVE_WRAPPER, 'w37-fix2-native');
  const directory = nativeScratchDirectory('w37-fix2-native-');
  const runtime: NativeRuntime = await openNativeRuntime({
    bundle, name, persistDir: directory.path,
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket',
      DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
    kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
    bindings: { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', ...bindings },
  });
  const door = async (path: string, body?: unknown) => {
    const response = await runtime.fetch(`https://w37-fix2-fixture${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
    expect(response.status, `fixture door ${path}`).toBe(200);
    return await response.json() as Record<string, unknown>;
  };
  const documents = (tenant: string) => {
    const [reflex, content, slots, learn] = publicationFor(tenant).map(entry => entry.revision.value);
    return { tenant, reflex, content, slots, learn };
  };
  return { runtime, door, documents, close: async () => { await runtime.dispose(); directory.remove(); } };
}

describe('unit:W37.T2.01', () => {
  it('native: in workerd, after a nightly job during which acme-outlet\'s day write failed, the next five-minute run publishes acme-outlet\'s day, and every brand\'s day of the date ends up stored, each counting only its own brand', async () => {
    const stamp = await nativeStamp('w37fix2t2', { REFLEX_HOST: 'do', TENANTS: registry([ACME, GLOBEX]), RETENTION: retentionFor([ACME, GLOBEX]) });
    try {
      // The runtime's clock at 12:20 UTC (forward only); the ledger day is the day before it.
      const wall = Date.now(), noon = Math.floor(wall / DAY) * DAY + 12 * HOUR + 20 * 60_000, target = noon - wall >= 5 * 60_000 ? noon : noon + DAY;
      const clock = await stamp.door('/clock', { advanceMs: target - Date.now() });
      const day = ledgerDay([ACME, GLOBEX], (clock.now as number) - DAY);
      for (const tenant of [ACME, GLOBEX]) await stamp.door('/publish', stamp.documents(tenant));
      await stamp.door('/seed', { objects: day.objects });
      const outletDay = reportKey(ACME, OUTLET, day.date);
      const reports = async () => Object.fromEntries(Object.entries(await stamp.door('/objects', { prefix: 'reports/' }) as Record<string, string>)
        .filter(([key]) => key.endsWith(`/${day.date}.json`))
        .map(([key, body]) => { const r = JSON.parse(body); return [key, { tenant: r.tenant, brand: r.brand, date: r.date, decisions: r.counts?.decisions, outcomes: r.counts?.outcomes }]; }));

      // acme-outlet's day objects are unavailable from here until the nightly job has finished.
      await stamp.door('/fail', { prefix: `reports/${ACME}/${OUTLET}/` });
      // The five-minute runs fold every closed hour of the lookback (two a run), until a run folds nothing more.
      const aggregates = async () => Object.keys(await stamp.door('/objects', { prefix: 'aggregates/' })).filter(key => /^aggregates\/[^/]+\/\d{4}-\d{2}-\d{2}\/\d{2}\.json$/.test(key)).sort();
      let folded = await aggregates(), quiet = false;
      for (let run = 0; run < 24 && !quiet; run++) {
        await stamp.door('/scheduled', { cron: '*/5 * * * *' });
        const now = await aggregates();
        quiet = JSON.stringify(now) === JSON.stringify(folded); folded = now;
      }
      expect(quiet, 'fixture: the five-minute runs folded every closed hour of the lookback').toBe(true);
      expect(folded, 'fixture: the data hour of both tenants is folded').toEqual(expect.arrayContaining([ACME, GLOBEX].map(tenant => `aggregates/${tenant}/${day.date}/${new Date(day.hour).toISOString().slice(11, 13)}.json`)));
      expect(Object.keys(await reports()), 'fixture: the outage kept acme-outlet\'s day from being published by the five-minute runs').not.toContain(outletDay);

      // The nightly job (03:00) builds yesterday's day for every brand while acme-outlet's write still fails.
      const nightly = await stamp.door('/scheduled', { cron: '0 3 * * *' });
      expect(nightly.jobs as number, 'the real scheduled handler handed its jobs to the runtime').toBeGreaterThan(0);
      expect(nightly.refused as number, 'fixture: the nightly job attempted acme-outlet\'s day and its write failed').toBeGreaterThan(0);

      // The outage is over; the next five-minute run.
      await stamp.door('/fail', {});
      await stamp.door('/scheduled', { cron: '*/5 * * * *' });
      const stored = await reports();
      const expected = Object.fromEntries(Object.entries(day.expected).map(([pair, count]) => { const [tenant, brand] = pair.split('/') as [string, string];
        return [reportKey(tenant, brand, day.date), { tenant, brand, date: day.date, decisions: count, outcomes: count }]; }));
      expect(stored[outletDay], `W37.T2 — the next five-minute run publishes ${outletDay}, whose write failed during the nightly job: the nightly job stored acme's own day although acme-outlet's was not stored (src/learn/hourly.ts runBrandDayReports), so the run takes the date as published and skips it`)
        .toEqual(expected[outletDay]);
      expect(stored, `W37.T2 — every brand's day of ${day.date} ends up stored, each counting only its own brand`).toEqual(expected);
      expect(stamp.runtime.outboundAttempts(), 'no job reached the network').toBe(0);
    } finally { await stamp.close(); }
  }, 300_000);
});

// ===========================================================================
// The in-process host for T5: the mounted routes behind the ingress chain of
// src/index.ts, over KV/R2/queue doubles, and the REAL Durable Object classes
// addressed by name — the harness of LEDGER.unit.test.ts:120-275 (itself the
// shape of src/routes/realtime.sdkContract.test.ts:137-245).
// ===========================================================================

class MemoryKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : type === 'stream' ? new Response(v).body : v; }
  async put(key: string, value: string) { this.data.set(key, String(value)); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}
class MemoryR2 {
  data = new Map<string, string>(); versions = new Map<string, number>(); metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.data.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length, customMetadata: this.metadata.get(key),
      body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.data.has(key) ? { key, etag: 'v' + this.versions.get(key), size: this.data.get(key)!.length } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const text = typeof raw === 'string' ? raw : await new Response(raw as BodyInit).text();
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : (condition as R2Conditional | undefined)?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : (condition as R2Conditional | undefined)?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, text); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(text).length };
  }
  async delete(key: string | string[]) { for (const k of typeof key === 'string' ? [key] : key) this.data.delete(k); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

interface Item { data: Map<string, unknown>; alarms: number[]; state: DurableObjectState; instance: { fetch(r: Request): Promise<Response>; alarm?(): Promise<void> } }

function objectStorage(item: { data: Map<string, unknown>; alarms: number[] }) {
  const { data, alarms } = item;
  return {
    get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
    put: async (k: string | Record<string, unknown>, v?: unknown) => {
      if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
    },
    delete: async (k: string | string[]) => { const keys = typeof k === 'string' ? [k] : k; let n = 0; for (const key of keys) if (data.delete(key)) n++; return typeof k === 'string' ? n > 0 : n; },
    list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
      structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
        .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
    transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
      const candidate = structuredClone(data); let deleteAlarm = false, nextAlarm: number | undefined;
      const tx = {
        list: async (options?: { prefix?: string }) => structuredClone(new Map([...candidate].filter(([key]) => key.startsWith(options?.prefix ?? '')))),
        get: async (key: string) => structuredClone(candidate.get(key)),
        delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
        put: async (values: string | Record<string, unknown>, value?: unknown) => {
          if (typeof values === 'string') candidate.set(values, structuredClone(value)); else for (const [key, v] of Object.entries(values)) candidate.set(key, structuredClone(v));
        },
        deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (at: number) => { nextAlarm = at; }, getAlarm: async () => alarms.at(-1) ?? null,
      } as unknown as DurableObjectTransaction;
      const result = await run(tx);
      data.clear(); for (const [key, value] of candidate) data.set(key, value);
      if (deleteAlarm) alarms.length = 0;
      if (nextAlarm !== undefined) alarms.push(nextAlarm);
      return result;
    },
    deleteAll: async () => data.clear(),
    setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null, deleteAlarm: async () => { alarms.length = 0; },
  };
}

function host(kind: 'session' | 'do', options: { retention: string; extra?: Record<string, unknown> }) {
  const queued: unknown[] = [], pending: Promise<unknown>[] = [];
  const cache = new MemoryKV(), sessions = new MemoryKV(), storage = new MemoryR2();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', REFLEX_HOST: kind, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    CACHE: cache, SESSIONS: sessions, STORAGE: storage, JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: registry([ACME, GLOBEX]), RETENTION: options.retention,
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); }, sendBatch: async (bodies: Array<{ body: unknown }>) => { for (const b of bodies) queued.push(b.body); } },
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }), first: async () => null, all: async () => ({ success: true, results: [] }) }) }) },
    ...options.extra,
  } as unknown as Env;
  const objects = new Map<string, Item>();
  const namespace = (binding: string, make: (state: DurableObjectState) => Item['instance']) => ({
    idFromName: (name: string) => name,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const id = binding + '|' + name;
      let item = objects.get(id);
      if (!item) {
        const data = new Map<string, unknown>(), alarms: number[] = [], sockets: WebSocket[] = [];
        const state = { id: { toString: () => name, name } as unknown as DurableObjectId, storage: objectStorage({ data, alarms }), getWebSockets: () => sockets,
          waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, alarms, state, instance: make(state) };
        objects.set(id, item);
      }
      return item.instance.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespace('SHOPPER_REFLEX', state => new ShopperReflex(state, env)) as unknown as DurableObjectNamespace;
  env.REGION_TREND = namespace('REGION_TREND', state => new RegionTrend(state, env)) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespace('DECISION_RING', state => new DecisionRing(state, env)) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespace('LEARN_STATS', state => new LearnStats(state, env)) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.use('/realtime/*', sdkKey()); app.use('/v1/:tenant/*', sdkKey()); app.use('/operator/*', operatorWrites());
  app.onError(errorHandler);
  app.route('/auth', authRoutes); app.route('/operator', operatorRoutes); app.route('/sort', sortRoutes);
  app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes); app.route('/v1', identityRoutes);

  const call = async (path: string, opts: { grant?: { capability: string }; body?: unknown; tenant?: string; headers?: Record<string, string>; cf?: unknown } = {}) => {
    const request = new Request(`https://w37.synthetic.invalid${path}`, {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.tenant ? { 'X-Tenant': opts.tenant } : {}),
        ...(opts.grant ? { [SHOPPER_HEADER]: opts.grant.capability } : {}), ...opts.headers },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    if (opts.cf) Object.defineProperty(request, 'cf', { value: opts.cf });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
  };
  const drain = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  const item = (binding: string, name: string) => objects.get(binding + '|' + name);
  const restart = (binding: string, name: string) => {
    const it = item(binding, name)!;
    if (binding === 'SHOPPER_REFLEX') it.instance = new ShopperReflex(it.state, env);
    return it;
  };
  return { env, call, drain, cache, sessions, storage, queued, objects, item, restart };
}
type Host = ReturnType<typeof host>;
type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;

/** The SDK's explicit choice (D06-W05): the only consent that grants a purpose (src/content/consent.ts:6-8). */
async function choose(h: Host, grant: Grant, tracking: boolean, personalization: boolean) {
  const current = h.item('SHOPPER_REFLEX', shopperObjectName(grant.tenant, grant.subject))?.data.get('consent');
  const response = await h.call(`/realtime/session/${grant.sessionId}/preferences`, { grant, tenant: grant.tenant, body: {
    trackingConsent: tracking, personalizationEnabled: personalization,
    choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
  } });
  expect(response.status, `explicit choice for ${grant.tenant}: ${await response.clone().text()}`).toBe(200);
}

// ===========================================================================
// unit:W37.T5.01 / .02 — the browser linked to her that her person record does
// not list.
//
// THE FIXTURE (per host): at acme, her first browser shops the day before (the
// kit's Coach taxonomy with an unknown category and a cross-category occasion
// list; a rendered decision on the durable basis, its impression and a click; a
// purchase; a manual segment; a product sort) and signs in with her account id,
// and she shops once more as the linked shopper — the gated T5 journey
// (LEDGER.unit.test.ts:947-1004). Then fifty more browsers sign in to the same
// account through the same public link route with their own signed assertions,
// so her person record keeps the last fifty (src/identity/store.ts `slice(-50)`;
// ShopperReflex identityMembers `slice(-50)`) and her FIRST browser — the one
// that holds her shopping — is linked to her and missing from her record.
// Beside her: another person at acme (her own browser, a product view, a
// sign-in with another account) — the boundary: the export must never widen to
// a browser that is not hers; and her first browser at globex, the second
// non-default brand, signed in there with the same account — never exported by
// acme.
//
// THE RULED DATA per id (the gated T5 export unit's, LEDGER.unit.test.ts:1104-
// 1144): the documented operator reads of the id (the browser's link
// `GET identity/visitor/{id}`, receipts, ring and receipted ledger records), its
// rows in each stream of the tenant's ledger partition, the SHOPPER_REFLEX
// `affinity`, `consent` and `pipeline` of the object named for it, and the
// SESSIONS `t:{tenant}:session:*` and CACHE `t:{tenant}:profile:*` records whose
// subject it is — each as stored (or as the documented read returns it).
// ===========================================================================

const T5_RETENTION = JSON.stringify({ version: 1, tenants: Object.fromEntries([ACME, GLOBEX].map(tenant => [tenant, { ...categories(), recovery: policy(), quarantine: policy() }])) });
const T5_LEARN = (tenant: string) => ({ holdout: { share: 0, salt: `w37-${tenant}`, arms: ['default'] }, slots: { hero: { reward: 'click', measurementBasis: 'rendered-v1' } } });
const HER_ACCOUNT = 'w37-person-account-0042', OTHER_ACCOUNT = 'w37-other-person-account-0077';
const T5_STREAMS = ['decision', 'outcome', 'product-sort', 'behavior'] as const;
const LATER_BROWSERS = 50;

interface T5Answer { status: number; body: Record<string, any> }
interface T5Entry { store: string; member: string; value: unknown; raw?: string }

async function cappedWorld(kind: 'session' | 'do') {
  invalidateCache(); invalidateTrendCache();
  const today = Math.floor(Date.now() / DAY) * DAY, served = today - DAY + 12 * HOUR, exportedAt = today + 12 * HOUR;
  vi.setSystemTime(served);
  const h = host(kind, { retention: T5_RETENTION, extra: { LEDGER_RECOVERY_ENABLED: 'true', IDENTITY_SALT: 'w37-fix2-synthetic-identity-salt',
    IDENTITY_SECRETS: `${ACME}:${ACME}-identity-material,${GLOBEX}:${GLOBEX}-identity-material` } });
  for (const tenant of [ACME, GLOBEX]) await initializePublicationSet(h.env, publicationFor(tenant, T5_LEARN(tenant)), '0:' + crypto.randomUUID());
  const cf = { country: 'US', regionCode: 'NY' };
  const act = async (grant: Grant, type: string, data: Record<string, unknown>) => {
    const response = await h.call('/realtime/action', { grant, tenant: grant.tenant, cf, body: { type, userId: grant.subject, sessionId: grant.sessionId, source: 'sdk', timestamp: Date.now(), eventId: crypto.randomUUID(), data } });
    const text = await response.text(); expect(response.status, `${kind} ${grant.tenant} ${type}: ${text}`).toBe(200); // G21 class (R-P108(2)): the body is read once; a read clone collected by GC during the drain cancels the original's body under Node's undici ("Body is unusable")
    await h.drain();
    return JSON.parse(text) as Record<string, unknown>;
  };
  const page = async (grant: Grant, pageInstance: string) => {
    const response = await h.call(`/v1/${grant.tenant}/decisions/snapshot?page=home&pageInstance=${pageInstance}`, { grant, tenant: grant.tenant, cf });
    const piece = (await response.json() as { decisions?: Array<{ contentId: string; decisionId: string; renderOffer?: string }> }).decisions?.[0];
    await h.drain();
    expect(piece?.renderOffer, `${kind} ${grant.tenant}: the rendered basis offers an acknowledgement`).toBeTruthy();
    const ack = await act(grant, 'content_impression', { contentId: piece!.contentId, decisionId: piece!.decisionId, renderOffer: piece!.renderOffer, page: 'home', pageInstance, slot: 'hero', position: 0 });
    expect(ack.render, `${kind} ${grant.tenant}: the render is durably acknowledged`).toMatchObject({ version: 1, decisionId: piece!.decisionId, status: 'durable' });
    await act(grant, 'content_click', { contentId: piece!.contentId, slot: 'hero', decisionId: piece!.decisionId, contentType: 'editorial' });
    return piece!.decisionId;
  };
  /** The public sign-in: POST /v1/{tenant}/identity/link with the browser's grant and the site's signed assertion. */
  const signIn = async (grant: Grant, account: string) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const linked = await h.call(`/v1/${grant.tenant}/identity/link`, { grant, tenant: grant.tenant, body: { visitorId: grant.subject, accountId: account, exp,
      assertion: await signAssertion(`${grant.tenant}-identity-material`, grant.tenant, grant.subject, account, exp) } });
    const body = await linked.json() as { shopperId: string; outcome: string; session: Grant };
    expect(linked.status, `${kind} ${grant.tenant}: the signed link of ${grant.subject}: ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
    await h.drain();
    return body;
  };

  // Her first browser: her shopping, then her sign-in, then her shopping as the linked person.
  const first = await newAnonymousSession(h.env, ACME);
  await choose(h, first, true, true);
  await act(first, 'product_view', TABBY_VIEW);
  await act(first, 'product_view', UNKNOWN_VIEW);
  const firstDecision = await page(first, 'w37-fix2-first-anonymous');
  await act(first, 'purchase', { orderId: 'W37-FIX2-ACME-ORDER-7731', value: 395, currency: 'USD', items: [{ productId: TABBY_VIEW.productId, quantity: 1, price: 395 }] });
  for (const [path, body] of [[`/realtime/segments/${first.subject}`, { segment: 'w37-manual' }], [`/realtime/personalization/${first.subject}`, undefined],
    ['/sort', { userId: first.subject, sessionId: first.sessionId, candidates: [{ id: 'tabby', line: 'Tabby' }, { id: 'rogue', line: 'Rogue' }, { id: 'unfiled', line: 'Unfiled' }] }]] as Array<[string, unknown]>) {
    const response = await h.call(path, { grant: first, tenant: ACME, body, cf });
    expect(response.status, `${kind} acme ${path}: ${await response.clone().text()}`).toBe(200);
  }
  const her = await signIn(first, HER_ACCOUNT);
  await act(her.session, 'product_view', TABBY_VIEW);
  await page(her.session, 'w37-fix2-signed-in');

  // Fifty later browsers sign in to her account: her record keeps the last fifty.
  const later: string[] = [];
  for (let n = 0; n < LATER_BROWSERS; n++) {
    const browser = await newAnonymousSession(h.env, ACME);
    const linked = await signIn(browser, HER_ACCOUNT);
    expect(linked.shopperId, `${kind}: browser ${n + 2} signs in as her`).toBe(her.shopperId);
    later.push(browser.subject);
  }

  // Another person at acme, and her first browser at globex (signed in there with the same account).
  const otherBrowser = await newAnonymousSession(h.env, ACME);
  await choose(h, otherBrowser, true, true);
  await act(otherBrowser, 'product_view', TABBY_VIEW);
  const otherDecision = await page(otherBrowser, 'w37-fix2-other-person');
  const other = await signIn(otherBrowser, OTHER_ACCOUNT);
  const atGlobex = await issueSessionCapability(h.env, { tenant: GLOBEX, subject: first.subject, sessionId: first.sessionId, kind: 'anonymous' }) as Grant;
  await choose(h, atGlobex, true, true);
  await act(atGlobex, 'product_view', TABBY_VIEW);
  const globexDecision = await page(atGlobex, 'w37-fix2-globex');
  const globexPerson = await signIn(atGlobex, HER_ACCOUNT);
  h.queued.length = 0; // transport copies of what the managed path already stored (as the gated T5 world)

  vi.setSystemTime(exportedAt);
  const date = new Date(served).toISOString().slice(0, 10);
  const operatorToken = () => new SignJWT({ sub: 'w37-operator', type: 'service', roles: ['admin'], permissions: ['*'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
  const operator = async (tenant: string, path: string, body?: unknown): Promise<T5Answer> => {
    const response = await h.call(`/v1/${tenant}${path}`, { tenant, body, headers: { Authorization: `Bearer ${await operatorToken()}` } });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
  };
  const rowId = (row: Record<string, any>) => String(row.decision_id ?? row.outcome_id ?? row.record_id ?? row.behavior_id ?? row.event_id ?? JSON.stringify(row));

  /** The ruled export data of these ids at this tenant, each labelled with the store that holds it (LEDGER.unit.test.ts:1112-1144). */
  const exportTruth = async (tenant: string, ids: string[]): Promise<T5Entry[]> => {
    const entries: T5Entry[] = [];
    const add = (store: string, member: string, value: unknown, raw?: string) => { if (value !== undefined && value !== null) entries.push({ store, member, value, ...(raw === undefined ? {} : { raw }) }); };
    for (const id of ids) {
      if (isShopperId(id)) {
        const person = await operator(tenant, `/identity/shopper/${id}`);
        if (person.status === 200) add('SESSIONS', `GET identity/shopper/${id}`, person.body.shopper);
      } else add('SESSIONS', `GET identity/visitor/${id} link`, (await operator(tenant, `/identity/visitor/${id}`)).body.link);
      for (const receipt of (await operator(tenant, `/visitors/${id}/receipts`)).body.receipts ?? []) {
        add('DECISION_RING', `GET visitors/${id}/receipts ${receipt.decision_id}`, receipt);
        const record = await operator(tenant, `/ledger/${encodeURIComponent(receipt.decision_id)}`);
        if (record.status === 200) add('STORAGE', `GET ledger/${receipt.decision_id}`, record.body.record);
      }
      for (const entry of (await operator(tenant, `/visitors/${id}/recent`)).body.ring ?? []) add('DECISION_RING', `GET visitors/${id}/recent ${entry.decision_id}`, entry);
    }
    for (const stream of T5_STREAMS) for (const object of ((await operator(tenant, `/ledger/batches?date=${date}&stream=${stream}`)).body.objects ?? []) as Array<{ key: string }>)
      for (const line of (h.storage.data.get(object.key) ?? '').split('\n').filter(Boolean)) {
        const row = JSON.parse(line) as Record<string, any>;
        if (ids.includes(row.visitor_id)) add('STORAGE', `GET ledger/batches ${stream} ${object.key} ${rowId(row)}`, row);
      }
    for (const id of ids) {
      const name = shopperObjectName(tenant, id), object = h.item('SHOPPER_REFLEX', name);
      for (const key of ['affinity', 'consent', 'pipeline']) add('SHOPPER_REFLEX', `${name} ${key}`, object?.data.get(key));
    }
    for (const [store, data, prefix] of [['SESSIONS', h.sessions.data, `t:${tenant}:session:`], ['CACHE', h.cache.data, `t:${tenant}:profile:`]] as const)
      for (const [key, raw] of data) {
        if (!key.startsWith(prefix)) continue;
        const value = JSON.parse(raw) as { userId?: string };
        if (ids.includes(value?.userId ?? '')) add(store, key, value, raw);
      }
    return entries;
  };
  /** Her export, followed page by page: `complete:false` with `next` is continued with `cursor: next` (the export's own paging). */
  const exportPages = async (tenant: string, selector: { visitorId?: string; shopperId?: string }) => {
    const pages: T5Answer[] = [];
    let cursor: string | undefined;
    for (let call = 0; call < 40; call++) {
      const answer = await operator(tenant, '/identity/export', { ...selector, ...(cursor ? { cursor } : {}) });
      pages.push(answer);
      if (answer.status !== 200 || answer.body.complete !== false || typeof answer.body.next !== 'string') break;
      cursor = answer.body.next;
    }
    return pages;
  };
  /** The tenant's browser links as stored: visitor id → the shopper id the link names. */
  const links = (tenant: string) => new Map([...h.sessions.data].filter(([key]) => key.startsWith(`t:${tenant}:identity:visitor:`))
    .map(([key, raw]) => [key.slice(`t:${tenant}:identity:visitor:`.length), (JSON.parse(raw) as { shopperId?: string }).shopperId]));
  /** Erase her through the documented route, resumed with the same selector while it is pending, with the object alarms it arms (LEDGER.unit.test.ts:1080-1089). */
  const erase = async (selector: { visitorId?: string; shopperId?: string }) => {
    let answer = await operator(ACME, '/identity/erase', selector);
    for (let resume = 0; answer.body.status === 'pending' && resume < 80; resume++) answer = await operator(ACME, '/identity/erase', selector);
    await h.drain();
    for (let round = 0; round < 3; round++) for (const [id, it] of h.objects) {
      if (!id.startsWith(`SHOPPER_REFLEX|${shopperObjectName(ACME, '')}`) || !it.alarms.length) continue;
      it.alarms.length = 0;
      await (h.restart('SHOPPER_REFLEX', id.slice('SHOPPER_REFLEX|'.length)).instance as ShopperReflex).alarm();
      await h.drain();
    }
    return answer;
  };
  return { h, kind, date, operator, exportTruth, exportPages, links, erase,
    her: { shopperId: her.shopperId, first: first.subject, later, firstDecision, all: [her.shopperId, first.subject, ...later] },
    other: { shopperId: other.shopperId, visitorId: otherBrowser.subject, decision: otherDecision },
    globex: { shopperId: globexPerson.shopperId, decision: globexDecision } };
}

/** A value's canonical JSON: object keys sorted at every depth, array order kept (LEDGER.unit.test.ts:1154). */
const canonical = (value: unknown) => JSON.stringify(value, (_key, v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
/** Every value an answer carries, at any depth and under any name, in canonical form. */
function carried(answer: unknown): Set<string> {
  const seen = new Set<string>();
  const walk = (value: unknown) => { seen.add(canonical(value)); if (value && typeof value === 'object') for (const child of Object.values(value)) walk(child); };
  walk(answer);
  return seen;
}
const carries = (seen: Set<string>, entry: T5Entry) => seen.has(canonical(entry.value)) || (entry.raw !== undefined && seen.has(canonical(entry.raw)));
/** The ruled data an answer omits: each entry of `before` it carries neither as it was before nor as the same member stands after. */
function exportGaps(answer: unknown, before: T5Entry[], after: T5Entry[]): string[] {
  const seen = carried(answer), now = new Map(after.map(entry => [`${entry.store} ${entry.member}`, entry]));
  return before.filter(entry => !carries(seen, entry) && !(now.has(`${entry.store} ${entry.member}`) && carries(seen, now.get(`${entry.store} ${entry.member}`)!)))
    .map(entry => `${entry.store} ${entry.member}`);
}
/** The entries of `theirs` an answer carries that are not also equal to an entry of `own`. */
function foreignCarried(answer: unknown, theirs: T5Entry[], own: T5Entry[]): string[] {
  const seen = carried(answer), mine = new Set(own.map(entry => canonical(entry.value)));
  return theirs.filter(entry => !mine.has(canonical(entry.value)) && carries(seen, entry)).map(entry => `${entry.store} ${entry.member}`);
}

describe('unit:W37.T5.01', () => {
  for (const kind of ['session', 'do'] as const) {
    it(`host (${kind}): POST /v1/{tenant}/identity/export of the acme shopper answers the browser linked to her through the tenant's identity links although her person record (at most 50) no longer lists it — its link and every ruled datum it holds, as the erasure reaches it, by either selector — and never a browser of another person or of the other brand`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const w = await cappedWorld(kind), first = w.her.first;
        // CONTROL: the fixture's premise — her record lists her fifty later browsers and not the first; the first browser's link names her.
        const person = await w.operator(ACME, `/identity/shopper/${w.her.shopperId}`);
        expect(person.status, `${kind}: her person record`).toBe(200);
        expect(person.body.shopper.visitors.map((v: { visitorId: string }) => v.visitorId).sort(), `${kind}: her record lists the fifty later browsers`).toEqual([...w.her.later].sort());
        expect((await w.operator(ACME, `/identity/visitor/${first}`)).body, `${kind}: the first browser is linked to her`).toMatchObject({ ok: true, visitorId: first, shopperId: w.her.shopperId });
        expect(w.links(ACME).get(first), `${kind}: the tenant's identity:visitor: link of the first browser names her (what the erasure's link scan reads)`).toBe(w.her.shopperId);
        const firstTruth = await w.exportTruth(ACME, [first]);
        expect([...new Set(firstTruth.map(entry => entry.store))].sort(), `${kind}: the first browser holds her data in every store the export answers`)
          .toEqual(expect.arrayContaining(['DECISION_RING', 'SESSIONS', 'SHOPPER_REFLEX', 'STORAGE']));
        for (const stream of ['decision', 'outcome'] as const) expect(firstTruth.some(entry => entry.member.startsWith(`GET ledger/batches ${stream} `)), `${kind}: the first browser's ${stream} rows are in the partition`).toBe(true);

        const own = await w.exportTruth(ACME, w.her.all);
        const otherTruth = await w.exportTruth(ACME, [w.other.visitorId, w.other.shopperId]);
        const globexTruth = await w.exportTruth(GLOBEX, [first, w.globex.shopperId]);
        expect(otherTruth.length && globexTruth.length, `${kind}: the other person and the other brand hold data of their own to protect`).toBeGreaterThan(0);

        for (const selector of [{ shopperId: w.her.shopperId }, { visitorId: w.her.later.at(-1)! }, { visitorId: first }] as Array<{ visitorId?: string; shopperId?: string }>) {
          const label = `W37.T5 export — ${kind} acme ${Object.keys(selector)[0]}${selector.visitorId === first ? ' (the first browser)' : selector.visitorId ? ' (a listed browser)' : ''}`;
          const before = await w.exportTruth(ACME, [first]);
          const pages = await w.exportPages(ACME, selector);
          const after = await w.exportTruth(ACME, [first]);
          expect(pages.map(page => [page.status, page.body.ok]), `${label}: every page answers the operator: ${JSON.stringify(pages.at(-1)!.body).slice(0, 200)}`).toEqual(pages.map(() => [200, true]));
          const finished = pages.at(-1)!.body.complete !== false;
          expect(finished, `${label}: the export finishes within 40 calls (its last page is not complete:false)`).toBe(true);
          const bodies = pages.map(page => page.body);
          expect(exportGaps(bodies, before, after), `${label}: the export answers the browser linked to her that her record does not list — its link and every ruled datum it holds (the erasure reaches it through the tenant's identity links, src/identity/erase.ts discoverPage)`).toEqual([]);
          // THE BOUNDARY: another person's browser at the same brand, and the other brand's records, are never hers.
          expect(foreignCarried(bodies, otherTruth, own), `${label}: nothing of another person at acme`).toEqual([]);
          const text = JSON.stringify(bodies);
          expect([w.other.visitorId, w.other.shopperId, w.other.decision].filter(id => text.includes(id)), `${label}: no identifier of another person at acme`).toEqual([]);
          expect(foreignCarried(bodies, globexTruth, own), `${label}: nothing of globex's`).toEqual([]);
          expect([w.globex.shopperId, w.globex.decision].filter(id => text.includes(id)), `${label}: no identifier of her globex person`).toEqual([]);
          expect(text.includes(HER_ACCOUNT), `${label}: never the account id (kit 02 :350)`).toBe(false);
        }
      } finally { vi.useRealTimers(); }
    }, 300_000);
  }
});

describe('unit:W37.T5.02', () => {
  for (const kind of ['session', 'do'] as const) {
    it(`host (${kind}): every browser the erasure deletes for her selector is one her export returned — the parity of the export's subject and the erasure's, measured on the same stores`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const w = await cappedWorld(kind), selector = { shopperId: w.her.shopperId };
        const linksBefore = w.links(ACME);
        // Each browser's link as the documented read answers it (GET identity/visitor/{id}), before anything is erased.
        const read = new Map<string, unknown>();
        for (const visitorId of linksBefore.keys()) read.set(visitorId, (await w.operator(ACME, `/identity/visitor/${visitorId}`)).body.link);
        const pages = await w.exportPages(ACME, selector);
        expect(pages.map(page => [page.status, page.body.ok]), `${kind}: her export answers the operator`).toEqual(pages.map(() => [200, true]));

        const answer = await w.erase(selector);
        expect(answer, `${kind}: the documented erasure completes its local steps`).toMatchObject({ status: 200, body: { ok: true, status: 'local_complete', tenant: ACME, shopperId: w.her.shopperId } });
        const linksAfter = w.links(ACME);
        const deleted = [...linksBefore.keys()].filter(visitorId => !linksAfter.has(visitorId)).sort();
        // CONTROL (the witness, measured): the erasure deletes the first browser through the tenant's identity links, and leaves the other person's.
        expect(deleted, `${kind}: the erasure deletes her browsers, the first one included`).toEqual(expect.arrayContaining([w.her.first, ...w.her.later]));
        expect(linksAfter.get(w.other.visitorId), `${kind}: the erasure leaves another person's browser`).toBe(w.other.shopperId);

        const seen = carried(pages.map(page => page.body));
        expect(deleted.filter(visitorId => !seen.has(canonical(read.get(visitorId)))), `W37.T5 — ${kind}: every browser the erasure deletes for her selector is one her export returned (its link as GET identity/visitor answers it)`).toEqual([]);
      } finally { vi.useRealTimers(); }
    }, 300_000);
  }
});
