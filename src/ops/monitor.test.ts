// src/ops/monitor.test.ts
// Check health, actual default decisions and retained webhook delivery outcomes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Env } from '@/types/env';
import { invalidateCache, write } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND, DEFAULT_LEARN } from '@/content/kinds';
import { alert, alertPayload, monitorKey, problemsOf, projectMonitor, readMonitor, runChecks, runMonitor, PRODUCT_SCHEMA, type MonitorResult } from './monitor';
import { initializePublicationSet, pinPublication } from '@/config/publication';
import * as synthetic from './synthetic';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { configuredDestinations, configuredOperationalDestinations, SYNTHETIC_BINDINGS } from '@/connectors/config';
import { RETENTION_CATEGORIES } from '@/retention';
import { readTrend, invalidateTrendCache } from '@/reflex/regionTrend';
import { readLift, invalidateLiftCache } from '@/content/service';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import { recoveryDigest } from '@/ledger/recovery';

class FakeKV {
  store = new Map<string, string>();
  reads: string[] = [];
  writes: string[] = [];
  async get(key: string, type?: string): Promise<unknown> { this.reads.push(key); const raw = this.store.get(key); if (raw === undefined) return null; return type === 'json' ? JSON.parse(raw) : type === 'stream' ? new Response(raw).body : raw; }
  async put(key: string, value: string): Promise<void> { this.writes.push(key); this.store.set(key, value); }
}

describe('W12.02 isolated monitoring admission and caches', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); invalidateTrendCache(); invalidateLiftCache(); });
  it('isolates lift snapshots while retaining ordinary TTL and current health on cache hits', async () => {
    const cache = new FakeKV(), isolated = new FakeKV(), key = 'lift:acme:acme:hero';
    const snapshot = { tenant: 'acme', brand: 'acme', slot: 'hero', reward: 'click', objective: 'unit', version: 1, publishedAt: 1, events: 1,
      tauLearnMs: DEFAULT_STATS.tauLearnMs, n0: DEFAULT_STATS.n0, nMin: DEFAULT_STATS.nMin, liftMin: DEFAULT_STATS.liftMin, liftMax: DEFAULT_STATS.liftMax,
      items: {}, slotRates: {}, witness: 'a'.repeat(64) } as LiftSnapshot;
    cache.store.set(key, JSON.stringify(snapshot)); let healthy = true;
    const digest = await recoveryDigest(snapshot), health = vi.fn(async () => Response.json({ ok: true, state: healthy ? 'healthy' : 'degraded',
      tenant: 'acme', brand: 'acme', slot: 'hero', witness: snapshot.witness, publication: { version: 1, digest, witness: snapshot.witness } }));
    const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: health }) };
    const ordinary = { CACHE: cache, LEARN_STATS: namespace } as unknown as Env, other = { CACHE: isolated, LEARN_STATS: namespace } as unknown as Env;
    const config = { reward: 'click' as const, stats: DEFAULT_STATS };
    expect(await readLift(ordinary, 'acme', 'acme', 'hero', 1, config)).toEqual(snapshot);
    expect(await readLift(other, 'acme', 'acme', 'hero', 2, config)).toBeNull();
    expect(await readLift(ordinary, 'acme', 'acme', 'hero', 3, config)).toEqual(snapshot);
    healthy = false;
    expect(await readLift(ordinary, 'acme', 'acme', 'hero', 4, config)).toBeNull();
    expect(cache.reads).toEqual([key]); expect(health).toHaveBeenCalledTimes(3);
    healthy = true;
    expect(await readLift(ordinary, 'acme', 'acme', 'hero', 60001, config)).toEqual(snapshot);
    expect(cache.reads).toEqual([key, key]); expect(cache.writes).toEqual([]);
  });
  it('does not let synthetic-only policies grant the ordinary monitor destination', async () => {
    const cache = new FakeKV(), env = { CACHE: cache, TENANTS: JSON.stringify({ provisioned: ['acme'] }), ENVIRONMENT: 'test' } as unknown as Env;
    env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { acme: { telemetry: { environment: 'test', schema: 'ops-v1', synthetic: {
      version: 1, enabled: true, lifetimeMs: 60000, stageMs: 1000, decisionMs: 200, eventMs: 300, thresholdSource: 'document-32-server-diagnostics',
      destinations: SYNTHETIC_BINDINGS.map(binding => ({ binding, purpose: 'isolated-synthetic-monitor', namespace: 'ops-synthetic-v1', accessPolicy: 'local-only' })),
    } } } } });
    env.RETENTION = JSON.stringify({ version: 1, tenants: { acme: Object.fromEntries((await configuredOperationalDestinations(env, 'acme')).map(d => [d.category,
      { id: 'local-only', revision: 1, durationMs: 60000, basis: 'occurred', renewal: 'new-record-only' }])) } });
    expect(await readMonitor(env, 'acme')).toBeNull(); expect(cache.reads).toEqual([]);
    const result = await runMonitor(env, 'acme');
    expect(result.ok).toBe(false); expect(result.alert?.status).toBe('held');
    expect(cache.writes).toEqual(['monitor:acme:recovery']);
  });
  it('bounds an unresolved control read and fences its late continuation', async () => {
    vi.useFakeTimers();
    let release!: (value: null) => void;
    const put = vi.fn(), get = vi.fn(() => new Promise<null>(resolve => { release = resolve; }));
    const env = { STORAGE: { get, put }, TENANTS: JSON.stringify({ provisioned: ['acme'] }) } as unknown as Env;
    const pending = synthetic.runSynthetic(env, 'acme', 'session');
    await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toMatchObject({ state: 'failed', consumer: false, failedStage: 'admission' });
    release(null); await vi.advanceTimersByTimeAsync(1); expect(put).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledOnce();
  });
  it('holds absent approval and forged native scope without customer access', async () => {
    const calls: string[] = [];
    const env = { TENANTS: JSON.stringify({ provisioned: ['acme'] }), STORAGE: { get: async (key: string) => { calls.push(key); return null; } } } as unknown as Env;
    expect(await synthetic.runSynthetic(env, 'acme', 'session')).toMatchObject({ state: 'held', consumer: false });
    expect(calls).toEqual(['ops-synthetic-v1/acme/session/control.json']);
    const stored = new Map(), state = { id: { toString: () => 'actual-native-id' }, storage: { get: async (key: string) => stored.get(key) } } as unknown as DurableObjectState;
    const boundary = new synthetic.SyntheticObjectBoundary(state, env, 'SHOPPER_REFLEX');
    const work = vi.fn(async () => true);
    await expect(boundary.run(new Request('https://native/authority/request', { headers: { [synthetic.SYNTHETIC_HEADER]: '{"value":{"tenant":"acme"},"signature":"forged"}' } }), work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled(); expect(stored.size).toBe(0);
  });
  it('interleaves ordinary and synthetic regional snapshots without null contamination', async () => {
    const ordinary = new FakeKV(), isolated = new FakeKV(), key = 'trend:v2:acme:US-NY';
    const value = { generation: 2, tenant: 'acme', region: 'US-NY', level: 'region', events: 50, version: 1, updatedAt: 1,
      r: { taste: { ordinary: 10 } }, share: { taste: { ordinary: 1 } } };
    ordinary.store.set(key, JSON.stringify(value));
    const a = { CACHE: ordinary } as unknown as Env, b = { CACHE: isolated } as unknown as Env;
    expect((await readTrend(a, 'acme', 'US-NY', 1, 100))?.snapshot.share).toEqual(value.share);
    expect(await readTrend(b, 'acme', 'US-NY', 1, 100)).toBeNull();
    expect((await readTrend(a, 'acme', 'US-NY', 1, 101))?.snapshot.share).toEqual(value.share);
    expect(ordinary.reads).toEqual([key]); expect(ordinary.writes).toEqual([]);
  });
});

async function configureMonitor(env: Env, tenants: string[]) {
  env.TENANTS = JSON.stringify({ provisioned: tenants }); env.ENVIRONMENT = 'test';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.ALERT_WEBHOOK_URL ?? '')))].map(v => v.toString(16).padStart(2, '0')).join('');
  env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: Object.fromEntries(tenants.map(tenant => [tenant, { telemetry: {
    environment: 'test', schema: 'ops-v1', analytics: { binding: 'ANALYTICS', dataset: 'synthetic_ops', accessPolicy: 'synthetic-only' },
    monitor: { binding: 'CACHE', namespace: 'monitor', accessPolicy: 'synthetic-only' },
    alert: { binding: 'ALERT_WEBHOOK_URL', destination: 'synthetic-alert', urlSha256: hash, accessPolicy: 'synthetic-only' },
  } }])) });
  const configured: Record<string, unknown> = {};
  for (const tenant of tenants) configured[tenant] = Object.fromEntries([...RETENTION_CATEGORIES, ...(await configuredOperationalDestinations(env, tenant)).map(d => d.category)]
    .map(category => [category, { id: 'test-only', revision: 1, durationMs: 3_600_000, basis: 'occurred', renewal: 'new-record-only' }]));
  env.RETENTION = JSON.stringify({ version: 1, tenants: configured });
}

describe('the monitor', () => {
  it('names a failed check and a slow decision as problems, and nothing else', () => {
    expect(problemsOf({ kv: { ok: true, ms: 3 }, decision: { ok: true, ms: 120 } })).toEqual([]);
    expect(problemsOf({ kv: { ok: false, ms: 5000, detail: 'timed out' }, decision: { ok: true, ms: 2100 } })).toEqual(['kv: CHECK_FAILED', 'decision: LATENCY_EXCEEDED']);
    expect(problemsOf({ decision: { ok: true, ms: 900 } }, { decisionMs: 800 })).toEqual(['decision: LATENCY_EXCEEDED']);
  });

  it('the webhook receives a sentence and the facts', () => {
    const r: MonitorResult = { at: Date.UTC(2026, 8, 5, 12, 0, 0), tenant: 'coach', environment: 'production', ok: false, checks: { database: { ok: false, ms: 40, detail: 'no such table' } }, problems: ['database failed: no such table (40 ms)'] };
    const p = alertPayload(r);
    expect(p.text).toBe('production: coach has a problem at 2026-09-05T12:00:00.000Z: database: CHECK_FAILED');
    expect(alertPayload({ ...r, ok: true, checks: {}, problems: [] }).text).toBe('production: coach recovered at 2026-09-05T12:00:00.000Z');
  });

  it('alerts once per half hour per tenant, always on recovery, and never without a webhook', async () => {
    const posts: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => { posts.push(String(init?.body)); return new Response('ok', { status: 200 }); }) as typeof fetch;
    try {
      const env = { CACHE: new FakeKV(), ALERT_WEBHOOK_URL: 'https://hooks.example.test/x' } as unknown as Env;
      await configureMonitor(env, ['coach']); vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const bad: MonitorResult = { at: 1_000_000, tenant: 'coach', environment: 'staging', ok: false, checks: {}, problems: ['kv failed (1 ms)'] };
      expect(await alert(env, bad, 1_000_000)).toBe('sent');
      expect(await alert(env, bad, 1_000_000 + 60_000)).toBe('cooling-down');
      expect(await alert(env, bad, 1_000_000 + 31 * 60_000)).toBe('sent');
      expect(await alert(env, { ...bad, ok: true, problems: [] }, 1_000_000 + 32 * 60_000)).toBe('sent');
      expect(posts).toHaveLength(3);
      expect(JSON.parse(posts[2]!).text).toContain('recovered');
      expect(await alert({ ...env, ALERT_WEBHOOK_URL: undefined } as Env, bad)).toBe('no-webhook');
    } finally { globalThis.fetch = realFetch; vi.restoreAllMocks(); }
  });
});

describe('W12.01 actual monitor results', () => {
  beforeEach(() => {
    invalidateCache();
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected external request'); }));
  });
  afterEach(() => { invalidateCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function fixture(host: 'do' | 'session' = 'do') {
    // Retained W12.01 tests isolate the refused-default and alert contracts.
    // Real synthetic continuity is exercised by the native W12.02 group.
    vi.spyOn(synthetic, 'runSynthetic').mockResolvedValue({ state: 'complete', decision: true, event: true, producer: true, consumer: true,
      ledger: true, learning: true, dlq: false, decisionMs: 0, eventMs: 0 });
    const cache = new FakeKV();
    const customerIO = vi.fn(() => { throw new Error('synthetic monitor must not touch customer state or measurement'); });
    const sessions = vi.fn(async (key: string) => { expect(key).toBe('monitor-probe'); return null; });
    const snapshots: string[] = [];
    const point = vi.fn((_point: unknown) => undefined);
    const env = {
      CACHE: cache, ENVIRONMENT: 'synthetic', REFLEX_HOST: host,
      SESSIONS: { get: sessions, put: customerIO, delete: customerIO },
      SHOPPER_REFLEX: { idFromName: customerIO, get: customerIO },
      DECISION_RING: { idFromName: customerIO, get: customerIO },
      EVENT_QUEUE: { send: customerIO, sendBatch: customerIO },
      STORAGE: { head: async (key: string) => { expect(key).toBe('monitor-probe'); return null; }, get: customerIO, put: customerIO },
      DB: { prepare: (query: string) => ({ all: async () => ({ success: true, results: query.includes('sqlite_master') ? PRODUCT_SCHEMA
        : ['0010_operator_accounts.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql'].map(name => ({ name })) }) }) },
      LEARN_STATS: { idFromName: (name: string) => name, get: (id: string) => ({ fetch: async (url: string, init?: RequestInit) => {
        snapshots.push(`${id} ${init?.method ?? 'GET'} ${url}`);
        return new Response('{}', { status: 404 });
      } }) },
      ANALYTICS: { writeDataPoint: point }, ALERT_WEBHOOK_URL: 'https://synthetic.invalid/alert',
    } as unknown as Env;
    await configureMonitor(env, ['w12-pine', 'w12-cedar']);
    const documents = new Map<string, { text: string; etag: string }>(); let revision = 0;
    Object.assign(env.STORAGE, {
      get: async (key: string) => {
        if (!key.startsWith('config-publication/')) return customerIO();
        const v = documents.get(key); return v ? { etag: v.etag, size: v.text.length, body: new Response(v.text).body,
          text: async () => v.text, json: async () => JSON.parse(v.text) as unknown } : null;
      },
      put: async (key: string, text: string, options?: R2PutOptions) => {
        if (!key.startsWith('config-publication/')) return customerIO();
        const condition = options?.onlyIf;
        if (condition instanceof Headers ? documents.has(key) : condition && condition.etagMatches !== documents.get(key)?.etag) return null;
        const etag = String(++revision); documents.set(key, { text, etag }); return { key, etag, size: text.length };
      },
    });
    for (const tenant of ['w12-pine', 'w12-cedar']) {
      const revision = (value: unknown) => ({ revision: 1, at: 1, actor: 'synthetic', note: '', value });
      await initializePublicationSet(env, [
        { kind: CONTENT_KIND, scope: tenant, revision: revision({ pieces: [] }) },
        { kind: SLOTS_KIND, scope: tenant, revision: revision({ pages: {} }) },
        { kind: LEARN_KIND, scope: tenant, revision: revision(DEFAULT_LEARN) },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: revision(DEFAULT_REFLEX_CONFIG) },
      ], '0:' + crypto.randomUUID());
    }
    cache.writes.length = 0;
    const ready = async (tenant: string, home = true) => {
      const replace = async <T,>(kind: import('@/config/versionedStore').DocumentKind<T>, value: T) => {
        const pin = await pinPublication(env, tenant), expectedRevision = pin.refs[kind.name + ':' + tenant]!.revision;
        expect((await write(env, kind, tenant, value, { actor: 'synthetic', expectedRevision, expectedPublication: { revision: pin.revision, digest: pin.digest }, operationId: expectedRevision + ':' + crypto.randomUUID() })).ok).toBe(true);
      };
      await replace(CONTENT_KIND, { pieces: [{ id: 'a', customerContentId: 'cms-a', type: 'editorial', title: 'a', tags: { line: ['Example'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } }] });
      await replace(SLOTS_KIND, { pages: { home: home ? [{ slot: 'hero', take: 1, weights: { line: 0.5 } }] : [] } });
      await replace(LEARN_KIND, { ...DEFAULT_LEARN, holdout: { share: 0, salt: '', arms: ['default'] }, slots: { hero: { gamma: 1 } } });
      cache.writes.length = 0;
    };
    return { env, cache, customerIO, sessions, snapshots, point, ready };
  }

  async function runStored(f: Awaited<ReturnType<typeof fixture>>, tenant: string, now: number) {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const priorWrites = f.cache.writes.filter(key => key === monitorKey(tenant)).length;
    const result = await runMonitor(f.env, tenant, now);
    const { retention, ...stored } = JSON.parse(f.cache.store.get(monitorKey(tenant))!);
    expect(stored).toEqual(result); expect(retention.bornAt).toBe(now);
    expect(f.cache.writes.filter(key => key === monitorKey(tenant))).toHaveLength(priorWrites + 1);
    return result;
  }

  it('W06.12 reports explicit category and destination readiness without admitting customer capture', async () => {
    const f = await fixture(), tenant = 'w12-pine';
    f.env.TENANTS = JSON.stringify({ provisioned: [tenant] });
    f.env.TENANT_CONNECTORS = undefined; f.env.RETENTION = undefined;
    f.env.WEBHOOK_ENDPOINTS = JSON.stringify([{ name: 'first', type: 'webhook', url: 'https://first.invalid/events', enabled: true }, { name: 'second', type: 'webhook', url: 'https://second.invalid/events', enabled: true }]);
    await f.ready(tenant);
    const absent = await runChecks(f.env, tenant);
    expect(absent.retention).toMatchObject({ ok: false, detail: 'CHECK_FAILED' });
    expect(absent.decision.ok).toBe(true);
    const policy = { id: 'synthetic-monitor', revision: 1, durationMs: 60000, basis: 'admitted', renewal: 'new-record-only' };
    const categories = Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, policy]));
    f.env.RETENTION = JSON.stringify({ version: 1, tenants: { [tenant]: categories } });
    expect((await runChecks(f.env, tenant)).retention.ok).toBe(false);
    for (const destination of await configuredDestinations(f.env, tenant)) categories[destination.category] = policy;
    f.env.RETENTION = JSON.stringify({ version: 1, tenants: { [tenant]: categories } });
    expect((await runChecks(f.env, tenant)).retention.ok).toBe(true);
    f.env.RETENTION = '{"sensitive_invalid_policy":true}';
    const malformed = await runChecks(f.env, tenant);
    expect(malformed.retention).toMatchObject({ ok: false, detail: 'CHECK_FAILED' });
    expect(JSON.stringify(malformed)).not.toContain('sensitive_invalid_policy');
    expect(f.customerIO).not.toHaveBeenCalled(); expect(f.point).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('W04.03 readiness reports unsafe tenant identity material without disclosing values or reading shopper state', async () => {
    const f = await fixture();
    Object.assign(f.env, { DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced', TENANTS: JSON.stringify({ provisioned: ['w12-pine'], hosts: {} }),
      IDENTITY_SECRETS: 'w12-pine:short-sensitive-value', IDENTITY_SALT: 'ZYXwvutsRQPONmlkjIHGFedcba98765432' });
    const refused = await runChecks(f.env, 'w12-pine');
    expect(refused.identity).toMatchObject({ ok: false, detail: 'CHECK_FAILED' });
    expect(JSON.stringify(refused)).not.toContain('short-sensitive-value'); expect(f.customerIO).not.toHaveBeenCalled();
    f.env.IDENTITY_SECRETS = 'w12-pine:0123456789ABCdefghijkLMNOPqrstUVWX';
    expect((await runChecks(f.env, 'w12-pine')).identity.ok).toBe(true); expect(f.customerIO).not.toHaveBeenCalled();
  });

  it.each([['do', 'w12-pine'], ['session', 'w12-cedar']] as const)('rejects empty decisions and serves nonempty refused defaults on %s for %s without customer I/O', async (host, tenant) => {
    const f = await fixture(host);
    const empty = await runChecks(f.env, tenant, 1_000_000);
    expect(empty.decision).toMatchObject({ ok: false, detail: 'CHECK_FAILED' });
    await f.ready(tenant);
    const healthy = await runStored(f, tenant, 1_000_001);
    expect(healthy.ok).toBe(true);
    expect(healthy.checks.decision).toEqual({ ok: true, ms: 0 });
    expect(healthy.alert).toEqual({ kind: null, status: 'not-needed' });
    expect(f.cache.writes).toEqual([`monitor:${tenant}:recovery`, monitorKey(tenant)]);
    await f.ready(tenant, false);
    const noSlots = await runChecks(f.env, tenant, 1_000_002);
    expect(noSlots.decision).toMatchObject({ ok: false, detail: 'CHECK_FAILED' });
    expect(f.cache.writes).toEqual([]);
    expect(f.customerIO).not.toHaveBeenCalled();
    expect(f.sessions.mock.calls).toEqual([['monitor-probe'], ['monitor-probe'], ['monitor-probe']]);
    expect(f.snapshots).toEqual(Array(3).fill(`${tenant}:${tenant}:monitor-probe GET https://learn/snapshot`));
    expect(f.cache.reads.some(key => key.startsWith('lift:'))).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('retains problem failures, missing destinations, success and tenant-isolated cooldown in final results', async () => {
    const f = await fixture(), tenant = 'w12-pine';
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockRejectedValueOnce(new Error('synthetic destination unavailable'))
      .mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    for (const now of [1_000_000, 1_000_001]) {
      const failed = await runStored(f, tenant, now);
      expect(failed.ok).toBe(false);
      expect(failed.problems).toContain('decision: CHECK_FAILED');
      expect(failed.alert).toEqual({ kind: 'problem', status: 'failed' });
      expect(f.cache.store.has(`monitor:${tenant}:alerted`)).toBe(false);
    }
    f.env.ALERT_WEBHOOK_URL = ' ';
    expect((await runStored(f, tenant, 1_000_002)).alert).toEqual({ kind: 'problem', status: 'no-webhook' });
    expect(fetch).toHaveBeenCalledTimes(2);
    f.env.ALERT_WEBHOOK_URL = 'https://synthetic.invalid/alert';
    expect((await runStored(f, tenant, 1_000_003)).alert).toEqual({ kind: 'problem', status: 'sent' });
    expect((await runStored(f, tenant, 1_000_004)).alert).toEqual({ kind: 'problem', status: 'cooling-down' });
    expect((await runStored(f, 'w12-cedar', 1_000_004)).alert).toEqual({ kind: 'problem', status: 'sent' });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(f.cache.store.get(`monitor:${tenant}:alerted`)).toBe('1000003');
    expect(f.cache.store.get('monitor:w12-cedar:alerted')).toBe('1000004');
  });

  it.each(['failed', 'no-webhook'] as const)('retries a %s recovery from a legacy failure until sent, then clears it', async status => {
    const f = await fixture(), tenant = 'w12-pine';
    await f.ready(tenant);
    const legacy: MonitorResult = { at: 999_999, tenant, environment: 'synthetic', ok: false, checks: {}, problems: ['previous failure'] };
    f.cache.store.set(monitorKey(tenant), JSON.stringify(legacy));
    f.cache.store.set(`monitor:${tenant}:alerted`, '999999');
    const persistedDuringDelivery: number[] = [];
    const fetch = vi.fn(async () => {
      // The previous result remains intact until delivery has settled.
      persistedDuringDelivery.push(JSON.parse(f.cache.store.get(monitorKey(tenant))!).at);
      return new Response('{}', { status: 503 });
    });
    vi.stubGlobal('fetch', fetch);
    if (status === 'no-webhook') f.env.ALERT_WEBHOOK_URL = undefined;
    for (const now of [1_000_000, 1_000_001]) {
      const pending = await runStored(f, tenant, now);
      expect(pending.ok).toBe(true); expect(pending.problems).toEqual([]);
      expect(pending.alert).toEqual({ kind: 'recovery', status });
    }
    expect(fetch).toHaveBeenCalledTimes(status === 'failed' ? 2 : 0);
    expect(persistedDuringDelivery).toEqual(status === 'failed' ? [999_999, 1_000_000] : []);
    f.env.ALERT_WEBHOOK_URL = 'https://synthetic.invalid/alert';
    fetch.mockImplementation(async () => new Response('{}'));
    expect((await runStored(f, tenant, 1_000_002)).alert).toEqual({ kind: 'recovery', status: 'sent' });
    expect((await runStored(f, tenant, 1_000_003)).alert).toEqual({ kind: null, status: 'not-needed' });
    expect(fetch).toHaveBeenCalledTimes(status === 'failed' ? 3 : 1);
    expect(f.cache.store.get(`monitor:${tenant}:alerted`)).toBe('999999');
  });

  it('returns delivery status despite best-effort monitor KV and aggregate telemetry failures', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const f = await fixture(), tenant = 'w12-pine', get = f.cache.get.bind(f.cache);
    vi.spyOn(f.cache, 'get').mockImplementation(async (key, type) => {
      if (key.startsWith('monitor:')) throw new Error('synthetic monitor read failure');
      return get(key, type);
    });
    const put = vi.spyOn(f.cache, 'put').mockRejectedValue(new Error('synthetic monitor save failure'));
    f.point.mockImplementation(() => { throw new Error('synthetic aggregate buffer failure'); });
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const result = await runMonitor(f.env, tenant, 1_000_000);
    expect(result.ok).toBe(false); expect(result.alert).toEqual({ kind: 'problem', status: 'sent' });
    expect(fetch).toHaveBeenCalledOnce(); expect(f.point).toHaveBeenCalledOnce();
    expect(put.mock.calls.map(([key]) => key)).toEqual([`monitor:${tenant}:alerted`, `monitor:${tenant}:recovery`, monitorKey(tenant)]);
    const { retention: _retention, ...stored } = JSON.parse(put.mock.calls[2]![1]); expect(stored).toEqual(result);
    expect(f.cache.store.has(monitorKey(tenant))).toBe(false);
    expect(log).toHaveBeenCalledWith('monitor delivery; status/resultSaved/recoverySaved', 'sent', 0, 0);
  });

  it.each(['rejected', 'stalled'])('W12.02 reports failed alerts and %s last-result persistence through closed aggregates', async failure => {
    const f = await fixture(), tenant = 'w12-pine', save = f.cache.put.bind(f.cache);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetch);
    let entered!: () => void; const saving = new Promise<void>(resolve => { entered = resolve; });
    const put = vi.spyOn(f.cache, 'put').mockImplementation(async (key, value) => {
      if (key !== monitorKey(tenant)) return save(key, value);
      entered(); if (failure === 'rejected') throw new Error('Synthetic result persistence refusal');
      return new Promise<void>(() => undefined);
    });
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    try {
      const pending = runMonitor(f.env, tenant, 1_000_000); await saving;
      await vi.advanceTimersByTimeAsync(5001); const result = await pending;
      expect(result.ok).toBe(false); expect(result.alert).toEqual({ kind: 'problem', status: 'failed' });
      expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
      expect(put.mock.calls.map(([key]) => key)).toEqual([`monitor:${tenant}:recovery`, monitorKey(tenant)]);
      expect(JSON.parse(f.cache.store.get(`monitor:${tenant}:recovery`)!)).toEqual({ version: 1, ok: false, pending: true });
      expect(f.cache.store.has(monitorKey(tenant))).toBe(false);
      const { retention: _retention, ...attempted } = JSON.parse(put.mock.calls[1]![1]); expect(attempted).toEqual(result);
      expect(log).toHaveBeenCalledWith('monitor delivery; status/resultSaved/recoverySaved', 'failed', 0, 1);
      expect(log).toHaveBeenCalledWith('monitor result; ok/decisionMs/problems', 0, result.checks.decision!.ms, result.problems.length);
    } finally { vi.useRealTimers(); }
  });

  it('W07.05 projects hostile and historical diagnostics without losing canonical tenant or explicit threshold results', async () => {
    const coerce = vi.fn(() => { throw new Error('private'); });
    const hostile = { toString: coerce, toJSON: coerce, get ok() { return coerce(); } };
    const safe = projectMonitor({ at: 1, ok: false, checks: { kv: { ok: false, ms: Infinity, detail: hostile }, unknown: hostile },
      problems: ['private', 'decision: LATENCY_EXCEEDED'], private: hostile }, '7brand', 'test');
    expect(safe).toEqual({ at: 1, tenant: '7brand', environment: 'test', ok: false, checks: { kv: { ok: false, ms: 0, detail: 'CHECK_FAILED' } },
      problems: ['kv: CHECK_FAILED', 'decision: LATENCY_EXCEEDED'], alert: { kind: null, status: 'not-needed' } });
    expect(coerce).not.toHaveBeenCalled(); expect(JSON.stringify(safe)).not.toContain('private');
    for (const [ms, threshold, problems] of [[900, 800, ['decision: LATENCY_EXCEEDED']], [2100, 3000, []]] as const) {
      const checks = { decision: { ok: true, ms } }, original = { at: 1, ok: problems.length === 0, checks, problems: problemsOf(checks, { decisionMs: threshold }) };
      expect(projectMonitor(original, '7brand', 'test').problems).toEqual(problems);
    }
    const f = await fixture(), tenant = 'w12-pine'; vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const legacy = JSON.stringify({ at: 10, tenant: 'foreign', environment: 'private', ok: false, checks: { kv: { ok: false, ms: 1, detail: 'private' } }, problems: ['private'] });
    f.cache.store.set(monitorKey(tenant), legacy);
    expect(await readMonitor(f.env, tenant)).toEqual({ at: 10, tenant, environment: 'test', ok: false, checks: {}, problems: [], alert: { kind: null, status: 'not-needed' } });
    expect(f.cache.store.get(monitorKey(tenant))).toBe(legacy);
    const policy = f.env.RETENTION; f.env.RETENTION = undefined; f.cache.reads.length = 0;
    expect(await readMonitor(f.env, tenant)).toBeNull(); expect(f.cache.reads).toEqual([]);
    f.env.RETENTION = policy;
    const get = f.cache.get.bind(f.cache); vi.spyOn(f.cache, 'get').mockImplementation(async (key, type) => {
      const value = await get(key, type); if (key === monitorKey(tenant)) vi.spyOn(Date, 'now').mockReturnValue(4_600_001); return value;
    });
    expect(await readMonitor(f.env, tenant)).toBeNull(); expect(f.cache.store.get(monitorKey(tenant))).toBe(legacy);
  });

  it('W07.05 holds optional sinks at use-time expiry and preserves pending recovery without raw diagnostics', async () => {
    const f = await fixture(), tenant = 'w12-pine'; await f.ready(tenant);
    const policies = JSON.parse(f.env.RETENTION!);
    for (const category of Object.keys(policies.tenants[tenant])) if (category.startsWith('telemetry.')) policies.tenants[tenant][category].durationMs = 1000;
    f.env.RETENTION = JSON.stringify(policies);
    f.cache.store.set(`monitor:${tenant}:recovery`, JSON.stringify({ version: 1, ok: false, pending: true }));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000), get = f.cache.get.bind(f.cache);
    const deferred = vi.spyOn(f.cache, 'get').mockImplementation(async (key, type) => {
      const result = await get(key, type); if (key === 'monitor-probe') clock.mockReturnValue(1_001_000); return result;
    });
    const remote = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', remote);
    const held = await runMonitor(f.env, tenant, 1_000_000);
    expect(held.ok).toBe(true); expect(held.alert).toEqual({ kind: 'recovery', status: 'held' });
    expect(remote).not.toHaveBeenCalled(); expect(f.point).not.toHaveBeenCalled(); expect(f.cache.store.has(monitorKey(tenant))).toBe(false);
    expect(JSON.parse(f.cache.store.get(`monitor:${tenant}:recovery`)!)).toEqual({ version: 1, ok: true, pending: true });
    deferred.mockRestore(); clock.mockReturnValue(1_002_000);
    const current = await runMonitor(f.env, tenant, 1_002_000);
    expect(current.alert).toEqual({ kind: 'recovery', status: 'sent' }); expect(remote).toHaveBeenCalledOnce(); expect(f.point).toHaveBeenCalledOnce();
    expect(JSON.parse(f.cache.store.get(`monitor:${tenant}:recovery`)!)).toEqual({ version: 1, ok: true, pending: false });
    const point = f.point.mock.calls[0]![0] as any;
    expect(point).toEqual({ blobs: ['ops-v1', 'test', tenant, 'monitor', 'ok', 'sent'], doubles: [1, 0, 0, 0], indexes: [tenant] });
    expect((remote.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('error');
    f.env.ALERT_WEBHOOK_URL = 'https://different.invalid';
    expect(await alert(f.env, { ...current, ok: true }, 1_002_000)).toBe('held'); expect(remote).toHaveBeenCalledOnce();
    expect(f.customerIO).not.toHaveBeenCalled();
  });
});
