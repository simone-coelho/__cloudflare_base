// @vitest-environment node
// src/reflex/odpLoop.test.ts
// The ODP wire contract, pinned by tests — the shapes here are the ones
// LIVE-VERIFIED against the Coach RTS instance (2026-07-03).
import { describe, expect, it, vi } from 'vitest';
import {
  gqlObjectLiteral, identityKeyOf, mapActionToOdp as mapLegacyAction, toRecentEventFlat,
  vuidFor, vuidFrom, vuidFromSession, ODP_MIRRORED_AUDIENCES,
  odpEnabled, updateOdpRing, refreshOdpSeedIfDue, forwardEventToOdp, upsertOdpProfile, fetchOdpAudiences,
} from '@/services/odpLoop';
import type { ActionEvent } from '@/services/RealtimeSegmentEngine';
import type { Env } from '@/types/env';
import { DEFAULT_TENANT, type TenantId } from '@/tenancy/tenant';
import { CatalogService } from '@/services/CatalogService';
import { getConnectors } from '@/connectors';
import { NotWiredError } from '@/connectors/types';
import { tenantAudienceKeyPrefix } from '@/demos/registry';
import optimizely from '@optimizely/optimizely-sdk/lite';
import { OptimizelyService } from '@/services/OptimizelyService';
import { FeatureVariableManager } from '@/services/FeatureVariableManager';
import { connectorConfiguration, connectorIdentity, configuredDestinations } from '@/connectors/config';
import { projectOdpState, mergeOdpState } from '@/services/odpLoop';
import { externalRetentionBirths, retentionBirth, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { pinProfileRetention, runOwnerOperation } from '@/identity/sessionAuthority';
import { storedConsent, CONSENT_LIFETIME_MS } from '@/content/consent';

const mapActionToOdp = (event: ActionEvent) => mapLegacyAction(event, DEFAULT_TENANT);

async function customerFixture() {
  const data = new Map<string, string>(), calls: string[] = [];
  const cache = { get: async (k: string, kind?: string) => { calls.push('get:' + k); const v = data.get(k); return v === undefined ? null : kind === 'json' ? JSON.parse(v) : v; },
    put: async (k: string, v: string) => { calls.push('put:' + k); data.set(k, v); },
    delete: async (k: string) => { calls.push('delete:' + k); data.delete(k); }, list: async () => ({ keys: [], list_complete: true }) };
  const tenants = Object.fromEntries(['meridian', 'harbor'].map(t => [t, {
    fx: { sdkKeyRef: 'CONNECTOR_SECRET_' + t.toUpperCase() + '_FX', datafileUrl: 'https://fx-' + t + '.invalid/datafile',
      eventsUrl: 'https://fx-' + t + '.invalid/events', accountId: 'account-' + t, projectId: 'project-' + t, identityNamespace: 'customer' },
    odp: { apiHost: 'https://odp-' + t + '.invalid', publicKeyRef: 'CONNECTOR_SECRET_' + t.toUpperCase() + '_ODP', identityNamespace: 'customer',
      actions: { product_view: { type: 'product', action: 'detail', fields: { product_id: 'productId', custom_label: 'label', selected: 'selected' } } },
      audiences: { ['remote_' + t]: 'owned_' + t }, profile: { score: { dimension: 'taste', value: 'blue' }, top: { dimension: 'taste' }, stage: { journey: true } } },
  }]));
  const env = { DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced', TENANTS: JSON.stringify({ provisioned: ['meridian', 'harbor'] }),
    TENANT_CONNECTORS: JSON.stringify({ version: 1, tenants }), CACHE: cache,
    CONNECTOR_SECRET_MERIDIAN_FX: 'synthetic-fx-a', CONNECTOR_SECRET_HARBOR_FX: 'synthetic-fx-b',
    CONNECTOR_SECRET_MERIDIAN_ODP: 'synthetic-odp-a', CONNECTOR_SECRET_HARBOR_ODP: 'synthetic-odp-b',
    get OPTIMIZELY_SDK_KEY() { throw new Error('Global FX forbidden'); }, get ODP_PUBLIC_KEY() { throw new Error('Global ODP forbidden'); },
  } as unknown as Env;
  const at = Date.now(), policy: RetentionPolicy = { id: 'synthetic-provider', revision: 1, durationMs: 120000, basis: 'admitted', renewal: 'new-record-only' };
  const policies: Record<string, Partial<Record<RetentionCategory, RetentionPolicy>>> = {};
  for (const tenant of ['meridian', 'harbor']) {
    policies[tenant] = { profile: { ...policy, durationMs: 86400_000 } };
    for (const destination of await configuredDestinations(env, tenant, () => {})) policies[tenant]![destination.category] = policy;
  }
  env.RETENTION = JSON.stringify({ version: 1, tenants: policies });
  const profiles = Object.fromEntries(['meridian', 'harbor'].map(tenant => [tenant, {
    retention: retentionBirth(env, tenant, 'profile', at, at), externalRetention: externalRetentionBirths(env, tenant, at, at),
  }]));
  // Unit-only held-owner seam: exact original provider stamps and explicit
  // choice clocks; mounted both-host cases separately establish caller authority.
  const run = <T>(tenant: string, work: () => Promise<T>) => runOwnerOperation({}, env, async () => {
    pinProfileRetention(env, profiles[tenant], tenant); return work();
  }, undefined, undefined, async () => storedConsent({ version: 1, tenant, subject: 'same-visitor', revision: 'provider-fixture',
    tracking: { value: true, chosenAt: at, expiresAt: at + CONSENT_LIFETIME_MS },
    personalization: { value: true, chosenAt: at, expiresAt: at + CONSENT_LIFETIME_MS } }));
  return { env, data, calls, tenants, profiles, run, at };
}

describe('W03.07 configured customer connectors', () => {
  it('binds ordinary, direct variable, raw fresh decisions and both refresh paths to tenant FX identity/cache/destination', async () => {
    const f = await customerFixture(), users: Array<[string, string]> = [], dispatchers: Array<{ dispatchEvent: (e: unknown, cb: (v: unknown) => void) => void }> = [];
    let revision = 1;
    const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), tenant = url.includes('meridian') ? 'meridian' : 'harbor';
      expect(init?.redirect).toBe('error');
      return url.endsWith('/events') ? new Response(null, { status: 202 })
        : Response.json({ accountId: 'account-' + tenant, projectId: 'project-' + tenant, revision: String(revision), featureFlags: [{ key: 'owned_flag' }] });
    });
    vi.stubGlobal('fetch', network);
    vi.spyOn(optimizely, 'createInstance').mockImplementation((options: any) => {
      const tenant = options.datafile.projectId.slice('project-'.length);
      dispatchers.push(options.eventDispatcher);
      return { onReady: async () => ({ success: true }), getVariation: (_key: string, id: string) => { users.push([tenant, id]); return 'owned'; },
        isFeatureEnabled: (_key: string, id: string) => { users.push([tenant, id]); return true; },
        getAllFeatureVariables: (_key: string, id: string) => { users.push([tenant, id]); return { label: tenant }; },
        createUserContext: (id: string) => { users.push([tenant, id]); return { decide: () => ({ flagKey: 'owned_flag', enabled: true, variationKey: 'owned', variables: { label: tenant } }) }; },
      } as any;
    });
    try {
      for (const tenant of ['meridian', 'harbor']) {
        const service = new OptimizelyService(f.env, tenant);
        expect(await service.getVariation('owned_flag', 'same-visitor')).toBe('owned');
        const manager = new FeatureVariableManager(f.env, tenant);
        expect((await manager.getFeatureVariables('same-visitor', {}, ['owned_flag'])).owned_flag?.source).toBe('optimizely');
        expect(await getConnectors(f.env, tenant).decisions.decide('owned_flag', 'same-visitor', [], {})).toMatchObject({ enabled: true, variables: { label: tenant } });
        revision++;
        expect(await service.refreshDatafileCache()).toMatchObject({ revision: String(revision), flags: 1 });
        revision++;
        expect(await service.refreshDatafile()).toBe(true);
        expect([...f.data].filter(([k]) => k.startsWith('t:' + tenant + ':connector:fx:')).map(([, v]) => JSON.parse(v).revision)).toEqual([String(revision)]);
      }
      for (const tenant of ['meridian', 'harbor']) expect(users.filter(([t]) => t === tenant).map(([, id]) => id)).toEqual(
        Array(users.filter(([t]) => t === tenant).length).fill(await connectorIdentity(tenant, 'customer', 'same-visitor')));
      expect(users.some(([t, id]) => t === 'harbor' && id === users[0]![1])).toBe(false);
      await f.run('meridian', () => new Promise(resolve => dispatchers[0]!.dispatchEvent({ url: 'https://foreign.invalid', httpVerb: 'POST', params: { account_id: 'account-meridian' } }, resolve)));
      expect(network.mock.calls.at(-1)?.[0]).toBe('https://fx-meridian.invalid/events');
      const before = network.mock.calls.length;
      await new Promise(resolve => dispatchers[0]!.dispatchEvent({ params: { account_id: 'account-harbor' } }, resolve));
      expect(network).toHaveBeenCalledTimes(before);
      expect(f.calls.filter(k => /connector:fx/.test(k)).every(k => /^\w+:t:(meridian|harbor):connector:fx:/.test(k))).toBe(true);
      f.env.TENANTS = JSON.stringify({ provisioned: ['harbor'] });
      const state = [...f.data], accesses = f.calls.length;
      expect(await new OptimizelyService(f.env, 'meridian').refreshDatafile()).toBe(false);
      await expect(new OptimizelyService(f.env, 'meridian').createFreshClient()).rejects.toThrow('Tenant connector unavailable');
      expect(f.calls).toHaveLength(accesses); expect([...f.data]).toEqual(state); expect(network).toHaveBeenCalledTimes(before);
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('maps ODP taxonomy/profile/audiences and exact escaped primitives without sharing provider identities or accepting stale provenance', async () => {
    const f = await customerFixture(), identity = { visitorId: 'same-visitor', sessionId: 'same-session' };
    const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const tenant = String(input).includes('meridian') ? 'meridian' : 'harbor';
      expect(init?.redirect).toBe('error');
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe(tenant === 'meridian' ? 'synthetic-odp-a' : 'synthetic-odp-b');
      return Response.json({ data: { customer: { audiences: { edges: [
        { node: { name: 'remote_' + tenant, state: 'qualified' } }, { node: { name: 'foreign', state: 'qualified' } },
      ] } } } });
    }); vi.stubGlobal('fetch', network);
    try {
      const contexts: Record<string, string> = {};
      for (const tenant of ['meridian', 'harbor']) {
        const event = ev('product_view', { productId: 'customer-only', label: 'quote" slash\\ line\n tab\t', selected: true });
        const ring = updateOdpRing([], event, 120_000, tenant, f.env);
        expect(ring).toEqual([expect.objectContaining({ type: 'product', action: 'detail', ts: 120, selected: true, custom_label: event.data.label })]);
        await f.run(tenant, () => forwardEventToOdp(f.env, tenant, event, identity));
        const sent = JSON.parse(network.mock.calls.at(-1)![1]!.body as string);
        expect(sent.identifiers.vuid).toBe(await connectorIdentity(tenant, 'customer', 'same-visitor'));
        expect(sent.data).toEqual({ product_id: 'customer-only', custom_label: event.data.label, selected: true });
        await f.run(tenant, () => upsertOdpProfile(f.env, tenant, identity, { dims: { taste: { blue: 0.75 } } }, 'early'));
        expect(JSON.parse(network.mock.calls.at(-1)![1]!.body as string)[0].attributes).toEqual({ vuid: sent.identifiers.vuid, score: 0.75, top: 'blue', stage: 'early' });
        expect(await f.run(tenant, () => fetchOdpAudiences(f.env, tenant, identity, ring))).toEqual(['owned_' + tenant]);
        const query = JSON.parse(network.mock.calls.at(-1)![1]!.body as string).query;
        expect(query).toContain('custom_label: ' + JSON.stringify(event.data.label)); expect(query).toContain('selected: true');
        expect(query).toContain('subset: ["remote_' + tenant + '"]');
        const empty = await projectOdpState(f.env, tenant, { odpSeed: ['owned_' + tenant], odpRecentEvents: ring });
        contexts[tenant] = empty.odpContext;
        expect(empty).toMatchObject({ odpSeed: [], odpRecentEvents: [], odpSeedAt: 0 });
        const proven = { ...empty, odpSeed: ['owned_' + tenant], odpSeedAt: 123, odpRecentEvents: ring };
        const retained = { ...proven, externalRetention: f.profiles[tenant]!.externalRetention };
        expect(await projectOdpState(f.env, tenant, retained)).toEqual(proven);
        expect(await mergeOdpState(f.env, tenant, retained, { odpSeed: ['foreign'], odpSeedAt: 999, odpRecentEvents: [{ secret: 'foreign' }] })).toEqual(proven);
      }
      expect(contexts.meridian).not.toBe(contexts.harbor);
      const old = { odpContext: contexts.meridian, odpSeed: ['owned_meridian'], odpRecentEvents: [{ old: true }], odpSeedAt: 999 };
      (f.env as any).CONNECTOR_SECRET_MERIDIAN_ODP = 'synthetic-rotated';
      expect(await projectOdpState(f.env, 'meridian', old)).toMatchObject({ odpSeed: [], odpRecentEvents: [], odpSeedAt: 0 });
      expect(await projectOdpState(f.env, 'harbor', old)).toMatchObject({ odpSeed: [], odpRecentEvents: [] });
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('refuses unknown/raw special tenant keys, reserved envelope mappings, foreign datafiles and missing secrets before destination effects', async () => {
    const f = await customerFixture(), network = vi.fn(async () => Response.json({ accountId: 'account-harbor', projectId: 'project-harbor' }));
    vi.stubGlobal('fetch', network);
    try {
      await expect(new OptimizelyService(f.env, 'meridian').createFreshClient()).rejects.toThrow('Tenant connector unavailable');
      expect(f.data.size).toBe(0);
      for (const raw of ['{"version":1,"tenants":{"__proto__":{}}}', '{"version":1,"tenants":{"unknown":{}}}']) {
        f.env.TENANT_CONNECTORS = raw; expect(() => connectorConfiguration(f.env, 'meridian')).toThrow('Tenant connector unavailable');
      }
      for (const reserved of ['ts', 'type', 'action', 'idempotence_id', 'identifiers']) {
        f.tenants.meridian!.odp.actions.product_view.fields = { [reserved]: 'label' } as any;
        f.env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: f.tenants });
        expect(() => connectorConfiguration(f.env, 'meridian')).toThrow('Tenant connector unavailable');
      }
      const clean = await customerFixture(); delete (clean.env as any).CONNECTOR_SECRET_MERIDIAN_FX;
      await expect(new OptimizelyService(clean.env, 'meridian').createFreshClient()).rejects.toThrow('Tenant connector unavailable');
      expect(network).toHaveBeenCalledOnce(); expect(clean.calls).toEqual([]);
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });
});

const ev = (type: ActionEvent['type'], data: Record<string, any>): ActionEvent =>
  ({ type, userId: 'u', data, timestamp: 0, source: 't' }) as ActionEvent;

describe('W06.12 original provider lifetime', () => {
  it('retains exact destination clocks through retry, refuses policy renewal and removes expired retained ODP contributions', async () => {
    const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at), network = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: { customer: { audiences: { edges: [] } } } }));
    vi.stubGlobal('fetch', network);
    try {
      const f = await customerFixture(), original = structuredClone(f.profiles.meridian), identity = { visitorId: 'same-visitor', sessionId: 'same-session' };
      const event = ev('product_view', { productId: 'customer-only' });
      await f.run('meridian', () => forwardEventToOdp(f.env, 'meridian', event, identity));
      expect(network).toHaveBeenCalledOnce(); expect(network.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
      clock.mockReturnValue(at + 1000);
      await f.run('meridian', () => forwardEventToOdp(f.env, 'meridian', event, identity));
      expect(network).toHaveBeenCalledTimes(2); expect(f.profiles.meridian).toEqual(original);
      const projected = await projectOdpState(f.env, 'meridian', null);
      const saved = { ...projected, odpSeed: ['owned_meridian'], odpSeedAt: at, odpRecentEvents: [{ type: 'private' }], externalRetention: original!.externalRetention };
      expect((await projectOdpState(f.env, 'meridian', saved)).odpSeed).toEqual(['owned_meridian']);
      const configuration = JSON.parse(f.env.RETENTION!);
      for (const [category, policy] of Object.entries(configuration.tenants.meridian)) if (category.startsWith('external.')) Object.assign(policy as object, { revision: 2, durationMs: 240000 });
      const priorConfiguration = f.env.RETENTION; f.env.RETENTION = JSON.stringify(configuration);
      await f.run('meridian', () => forwardEventToOdp(f.env, 'meridian', event, identity)).catch(() => undefined);
      expect(network).toHaveBeenCalledTimes(2); expect(f.profiles.meridian).toEqual(original);
      expect((await projectOdpState(f.env, 'meridian', saved)).odpSeed).toEqual([]);
      f.env.RETENTION = priorConfiguration; clock.mockReturnValue(at + 120000);
      await f.run('meridian', () => forwardEventToOdp(f.env, 'meridian', event, identity)).catch(() => undefined);
      expect(network).toHaveBeenCalledTimes(2);
      expect(await projectOdpState(f.env, 'meridian', saved)).toMatchObject({ odpSeed: [], odpRecentEvents: [], odpSeedAt: 0 });
      expect(original).toEqual(f.profiles.meridian);
    } finally { clock.mockRestore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });
});

describe('W37.06 legacy ODP owner boundary', () => {
  it('denies missing/nondefault tenant before credentials, identity, catalog, receipts or retained-state work', async () => {
    const credentials = vi.fn(() => { throw new Error('Foreign credential access'); });
    const env = { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'live', get ODP_API_HOST() { return credentials(); }, get ODP_PUBLIC_KEY() { return credentials(); } } as unknown as Env;
    const remote = vi.fn(async () => { throw new Error('Unexpected remote call'); }); vi.stubGlobal('fetch', remote);
    const hash = vi.spyOn(crypto.subtle, 'digest'), catalog = vi.spyOn(CatalogService.prototype, 'getProduct'), receipt = vi.fn();
    const event = ev('product_view', { productId: 'COA-CH857' });
    const identity = { visitorId: 'same-visitor', sessionId: 'same-session' };
    const ring = [{ type: 'product', product_line: 'Tabby', ts: 99 }];
    try {
      for (const tenant of ['meridian', 'brighthour', '', undefined] as Array<TenantId>) {
        expect(odpEnabled(env, tenant)).toBe(false);
        expect(mapLegacyAction(event, tenant)).toBeNull();
        expect(mapLegacyAction(ev('page_view', {}), tenant)).toBeNull();
        expect(updateOdpRing(ring, event, 100_000, tenant)).toEqual([]);
        expect(await refreshOdpSeedIfDue(env, tenant, identity, ring, { seed: ['retained'], seedAt: 100_000 }, 100_001, false)).toEqual({ seed: [], seedAt: 0 });
        expect(await fetchOdpAudiences(env, tenant, identity, ring)).toBeNull();
        await forwardEventToOdp(env, tenant, event, identity, 'blocked', receipt);
        await upsertOdpProfile(env, tenant, identity, { dims: { line: { Tabby: 1 } } }, 'late');
        if (tenant) expect(() => getConnectors(env, tenant)).toThrow('Tenant connector unavailable');
      }
      // JavaScript callers omitting the new argument cannot fall into Coach.
      expect(Reflect.apply(odpEnabled, null, [env])).toBe(false);
      expect(Reflect.apply(mapLegacyAction, null, [event])).toBeNull();
      expect(Reflect.apply(updateOdpRing, null, [ring, event, 100_000])).toEqual([]);
      for (const spy of [credentials, hash, catalog, remote, receipt]) expect(spy).not.toHaveBeenCalled();
      expect(ring).toEqual([{ type: 'product', product_line: 'Tabby', ts: 99 }]);
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('retains default credentials, ring/throttle and demo prefixes while customer keys ignore surfaces', async () => {
    const host = vi.fn(() => 'https://synthetic.invalid');
    const env = { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'live', get ODP_API_HOST() { return host(); }, ODP_PUBLIC_KEY: 'synthetic' } as unknown as Env;
    expect(odpEnabled(env, DEFAULT_TENANT)).toBe(true);
    const identity = { sessionId: 'same-session' }, current = { seed: ['retained'], seedAt: 100_000 };
    const ring = updateOdpRing([], ev('product_view', { productId: 'COA-CH857' }), 100_000, DEFAULT_TENANT);
    expect(ring).toEqual([expect.objectContaining({ product_line: 'Tabby', ts: 100 })]);
    expect(await refreshOdpSeedIfDue(env, DEFAULT_TENANT, identity, ring, current, 100_001, false)).toBe(current);
    host.mockClear();
    await expect(getConnectors(env, DEFAULT_TENANT).segments.fetchQualifiedSegments('same-visitor')).rejects.toBeInstanceOf(NotWiredError);
    expect(host).toHaveBeenCalledOnce();
    for (const surface of ['coach', 'brighthour'] as const) {
      expect(tenantAudienceKeyPrefix(DEFAULT_TENANT, surface)).toBe(surface === 'coach' ? '' : 'bh_');
      for (const tenant of ['meridian', 'brighthour']) expect(tenantAudienceKeyPrefix(tenant, surface)).toBe('');
    }
  });
});

describe('vuidFromSession — the PRE-CUTOVER behaviour, pinned', () => {
  it('always 32 hex chars, deterministic, session-distinct', async () => {
    const a1 = await vuidFromSession('s-ABC123');
    const a2 = await vuidFromSession('s-ABC123');
    const b = await vuidFromSession('s-DIFFERENT');
    expect(a1).toMatch(/^[0-9a-f]{32}$/);
    expect(a1).toBe(a2);
    // The defect this function name describes: a new session was a new person.
    expect(a1).not.toBe(b);
  });
});

describe('vuidFor — the identity cutover (CW7b)', () => {
  it('gives ONE vuid to one shopper across different sessions', async () => {
    // The whole point. Before the cutover these were two people, so every
    // cross-visit memory claim in the scope appendix was false for a returning
    // shopper, and doc 22's visit bucket had nothing stable to count against.
    const monday = await vuidFor({ visitorId: 'vis-abc', sessionId: 's-monday' });
    const friday = await vuidFor({ visitorId: 'vis-abc', sessionId: 's-friday' });
    expect(monday).toBe(friday);
    expect(monday).toMatch(/^[0-9a-f]{32}$/);
  });

  it('still separates different shoppers', async () => {
    const a = await vuidFor({ visitorId: 'vis-abc', sessionId: 's-1' });
    const b = await vuidFor({ visitorId: 'vis-xyz', sessionId: 's-1' });
    expect(a).not.toBe(b);
  });

  it('falls back to the session when no stable id exists, rather than failing', async () => {
    // A client that predates the stable id, or one with localStorage AND cookies
    // blocked. Worse than a stable id, better than nothing, and never a throw.
    const viaFallback = await vuidFor({ sessionId: 's-only' });
    expect(viaFallback).toBe(await vuidFromSession('s-only'));
    expect(viaFallback).toMatch(/^[0-9a-f]{32}$/);
  });

  it('treats an empty or whitespace visitor id as absent', async () => {
    expect(await vuidFor({ visitorId: '', sessionId: 's-1' })).toBe(await vuidFrom('s-1'));
    expect(await vuidFor({ visitorId: '   ', sessionId: 's-1' })).toBe(await vuidFrom('s-1'));
    expect(await vuidFor({ visitorId: null, sessionId: 's-1' })).toBe(await vuidFrom('s-1'));
  });

  it('reports WHICH identity it used, so the fallback is observable', () => {
    expect(identityKeyOf({ visitorId: 'vis-abc', sessionId: 's-1' })).toEqual({ key: 'vis-abc', stable: true });
    expect(identityKeyOf({ sessionId: 's-1' })).toEqual({ key: 's-1', stable: false });
  });

  it('trims the stable id, so a stray space is not a different person', async () => {
    expect(await vuidFor({ visitorId: ' vis-abc ', sessionId: 's-1' }))
      .toBe(await vuidFor({ visitorId: 'vis-abc', sessionId: 's-2' }));
  });
});

describe('mapActionToOdp — internal actions → the ODP taxonomy the RTS fire on', () => {
  it('product_view → type:product / action:detail (the RTS "Product Detail" behavior)', () => {
    const m = mapActionToOdp(ev('product_view', { productId: 'COA-CH857', action: 'product_view' }));
    expect(m).toMatchObject({ type: 'product', action: 'detail' });
    expect(m!.data).toMatchObject({
      product_id: 'COA-CH857',
      product_line: 'Tabby',
      product_price_band: 'elevated',
    });
    expect(typeof m!.data.product_occasions).toBe('string'); // comma-joined per spec §4
  });
  it('add_to_cart → action:add_to_cart (fires High Purchase Intent — live-proven)', () => {
    const m = mapActionToOdp(ev('add_to_cart', { product_id: 'COA-CH857' }));
    expect(m).toMatchObject({ type: 'product', action: 'add_to_cart' });
  });
  it('wishlist → save_for_later; page_view → pageview', () => {
    expect(mapActionToOdp(ev('wishlist_add', { productId: 'COA-CH857' }))).toMatchObject({ action: 'save_for_later' });
    expect(mapActionToOdp(ev('page_view', { path: '/plp' }))).toMatchObject({ type: 'pageview', data: { page: '/plp' } });
  });
  it('internal signals never leave the edge; unknown products are dropped', () => {
    expect(mapActionToOdp(ev('custom', { action: 'reflex_tick' }))).toBeNull();
    expect(mapActionToOdp(ev('product_view', { productId: 'NOT-A-SKU' }))).toBeNull();
  });
});

describe('recent_events flat shape (Part 1 of the ODP reference)', () => {
  it('fields sit FLAT on the event (not under data), ts in epoch SECONDS, idempotence_id present', () => {
    const mapped = mapActionToOdp(ev('product_view', { productId: 'COA-CH857' }))!;
    const flat = toRecentEventFlat(mapped, 1_783_083_996_500);
    expect(flat.type).toBe('product');
    expect(flat.action).toBe('detail');
    expect(flat.ts).toBe(1_783_083_996);                    // seconds, floored
    expect(flat.product_line).toBe('Tabby');                // FLAT — not nested
    expect((flat as any).data).toBeUndefined();
    expect(String(flat.idempotence_id)).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('serializes as a GraphQL literal with bare keys and escaped strings', () => {
    const lit = gqlObjectLiteral({ type: 'product', action: 'detail', ts: 123, product_line: 'Tabby' });
    expect(lit).toBe('{type: "product", action: "detail", ts: 123, product_line: "Tabby"}');
  });
});

describe('mirrored audience list', () => {
  it('matches the 5 keys from the ODP handoff exactly', () => {
    expect([...ODP_MIRRORED_AUDIENCES].sort()).toEqual([
      'late_journey_ready_to_buy',
      'line_tabby_affinity',
      'luxe_affinity',
      'occasion_evening_affinity',
      'silhouette_tote_affinity',
    ]);
  });
});

describe('mapActionToOdp — purchases reach ODP (they used to fall through `default`)', () => {
  it('maps a purchase with a product to a product-level purchase, RTS-qualifiable', () => {
    // The highest-weighted action in the engine returned null here. The edge's
    // affinity learned from purchases; ODP's memory of the shopper never did.
    const m = mapActionToOdp(ev('purchase', { productId: 'COA-CH857', orderId: 'ord-1', total: 425, currency: 'usd' }));
    expect(m).toMatchObject({
      type: 'product', action: 'purchase',
      data: { product_id: 'COA-CH857', order_id: 'ord-1', total: 425, currency: 'USD' },
    });
    // and the flattened catalog fields ride along, like every other product action
    expect(m?.data.product_line).toBeTruthy();
  });

  it('accepts the aliases the engine weights identically, however they arrive', () => {
    // The storefront names the action in data.action on a first-class type;
    // the SDK rides the accepted `custom` type with the real event in data.event.
    // Both conventions resolve through actionOf().
    expect(mapActionToOdp(ev('purchase', { productId: 'COA-CH857', action: 'checkout' }))).toMatchObject({ action: 'purchase' });
    expect(mapActionToOdp(ev('custom', { productId: 'COA-CH857', event: 'order_complete' }))).toMatchObject({ action: 'purchase' });
  });

  it('hears an SDK-shaped purchase: type custom, the real event in data.event', () => {
    // This was the silent gap: every server resolver read data.action and
    // data.eventName but never data.event, so an SDK purchase was 'custom',
    // weighed zero, and never reached ODP.
    const m = mapActionToOdp(ev('custom', { event: 'purchase', productId: 'COA-CH857', orderId: 'ord-9' }));
    expect(m).toMatchObject({ type: 'product', action: 'purchase', data: { order_id: 'ord-9' } });
  });

  it('maps an order-level purchase when no single product is named', () => {
    const m = mapActionToOdp(ev('custom', { event: 'order_complete', order_id: 'ord-2', order_total: '199.50' }));
    expect(m).toMatchObject({ type: 'order', action: 'purchase', data: { order_id: 'ord-2', total: 199.5 } });
  });

  it('sends only what the checkout carried, and drops what it cannot trust', () => {
    const m = mapActionToOdp(ev('purchase', { productId: 'COA-CH857', total: 'not a number', orderId: '  ' }));
    expect(m?.data).not.toHaveProperty('total');
    expect(m?.data).not.toHaveProperty('order_id');
  });

  it('returns null for a purchase that names neither a known product nor an order', () => {
    // Nothing to tell ODP, so nothing is sent. Silence beats an empty record.
    expect(mapActionToOdp(ev('purchase', {}))).toBeNull();
    expect(mapActionToOdp(ev('purchase', { productId: 'NOT-IN-CATALOG' }))).toBeNull();
  });
});
