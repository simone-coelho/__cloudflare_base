// Explicit registry authority must never silently select the legacy namespace.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { DEFAULT_TENANT, TenantResolutionError } from '@/tenancy/tenant';
import { tenantConfig, tenantForRequest, tenantMiddleware, TenantConfigurationError } from '@/tenancy/middleware';
import { shopperTenant, SessionAccessError } from '@/identity/sessionCapability';

const envWith = (TENANTS?: unknown) => ({ TENANTS }) as unknown as Env;
const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
const configured = (provisioned = ['acme', 'globex']) => JSON.stringify({ provisioned,
  hosts: { ' ACME.example ': 'acme', 'globex.example': 'globex' } });

describe('reading the stamp configuration', () => {
  it('W03.07 customer profiles require an explicit registry before downstream work', () => {
    expect(() => tenantConfig({ DEPLOYMENT_PROFILE: 'customer' } as Env)).toThrow(TenantConfigurationError);
    expect(tenantConfig({ DEPLOYMENT_PROFILE: 'customer', TENANTS: configured() } as Env).provisioned).toEqual(['acme', 'globex']);
  });
  it('retains an independently owned default only when undefined', () => {
    const first = tenantConfig(envWith());
    expect(first).toEqual({ provisioned: [DEFAULT_TENANT], hosts: {} });
    first.provisioned.push('acme'); first.hosts['other.example'] = 'acme';
    expect(tenantConfig(envWith())).toEqual({ provisioned: [DEFAULT_TENANT], hosts: {} });
  });

  it('preserves exact declared order, deduplicates and normalizes consistent hosts without Coach', () => {
    const cfg = tenantConfig(envWith(JSON.stringify({ provisioned: ['globex', 'acme', 'globex'],
      hosts: { ' ACME.example ': 'acme', 'acme.example': 'acme', 'globex.example': 'globex' } })));
    expect(cfg).toEqual({ provisioned: ['globex', 'acme'], hosts: { 'acme.example': 'acme', 'globex.example': 'globex' } });
    expect(tenantConfig(envWith(configured(['acme', 'globex', 'initech']))).provisioned).toEqual(['acme', 'globex', 'initech']);
    expect(tenantConfig(envWith(JSON.stringify({ provisioned: ['acme'], hosts: { '[::1]': 'acme' } }))).hosts['[::1]']).toBe('acme');
  });

  it('refuses every invalid explicit manifest instead of partially accepting it', () => {
    const bad = [null, 42, {}, '', ' ', 'not json', '[]', 'null', '"text"', '42', '{}',
      ...[{ provisioned: [] }, { provisioned: 'acme' }, { provisioned: ['acme', 'UPPER'] },
        { provisioned: ['acme', null] }, { provisioned: [' acme '] }, { provisioned: ['acme'], hosts: null },
        { provisioned: ['acme'], hosts: [] }, { provisioned: ['acme'], hosts: 42 },
        { provisioned: ['acme'], hosts: { 'acme.example': 'globex' } },
        { provisioned: ['acme', 'globex'], hosts: { ' ACME.EXAMPLE ': 'acme', 'acme.example': 'globex' } },
        ...['', '__proto__', 'a..example', '-bad.example', 'bad_.example', 'x/y', 'x:443', '[::1]:1234',
          'https://x', 'x?y', 'user@x', 'x#y', 'a b'].map(host => ({ provisioned: ['acme'], hosts: { [host]: 'acme' } })),
      ].map(value => JSON.stringify(value))];
    for (const raw of bad) expect(() => tenantConfig(envWith(raw)), String(raw)).toThrow(TenantConfigurationError);
  });
});

describe('resolving a request', () => {
  it('resolves each customer from a path, header or mapped host and permits only agreeing signals', () => {
    const env = envWith(configured());
    for (const tenant of ['acme', 'globex']) {
      expect(tenantForRequest(env, req(`https://${tenant}.example/`))).toBe(tenant);
      expect(tenantForRequest(env, req(`https://shared.example/v1/${tenant}/brands`))).toBe(tenant);
      expect(tenantForRequest(env, req('https://shared.example/', { 'X-Tenant': tenant.toUpperCase() }))).toBe(tenant);
      expect(tenantForRequest(env, req(`https://${tenant}.example/v1/${tenant}/brands`, { 'X-Tenant': tenant }))).toBe(tenant);
    }
    expect(tenantForRequest(env, req('https://shared.example/%761/%61cme/brands'))).toBe('acme');
    for (const url of ['https://acme.example/v1/globex/brands', 'https://acme.example/v1/unknown/brands',
      'https://acme.example/v1/ACME/brands', 'https://acme.example/v1/%20acme/brands',
      'https://acme.example/v1/acme%2fglobex/brands', 'https://acme.example/v1/%2561cme/brands',
      'https://acme.example/v1/%GG/brands', 'https://shared.example/']) {
      expect(() => tenantForRequest(env, req(url)), url).toThrow(TenantResolutionError);
    }
    for (const header of ['globex', 'unknown', '', 'bad:name']) {
      expect(() => tenantForRequest(env, req('https://acme.example/', { 'X-Tenant': header }))).toThrow(TenantResolutionError);
    }
    expect(tenantForRequest(envWith(), req('https://shared.example/'))).toBe('coach');
    expect(tenantForRequest(envWith(configured(['coach', 'acme', 'globex'])), req('https://shared.example/'))).toBe('coach');
  });

  it('shares WebSocket authority with shopper checks and verifies supplied context', () => {
    const env = envWith(configured());
    const socket = req('https://acme.example/realtime/ws?tenant=ACME&tenant=acme', { Upgrade: 'websocket', 'X-Tenant': 'acme' });
    expect(tenantForRequest(env, socket)).toBe('acme'); expect(shopperTenant(env, socket, 'acme')).toBe('acme');
    for (const resolved of ['globex', 'coach', 'ACME', '', 'unknown']) expect(() => shopperTenant(env, socket, resolved)).toThrow(SessionAccessError);
    for (const query of ['globex', '', 'unknown', 'acme&tenant=globex']) {
      const conflicting = req(`https://acme.example/realtime/ws?tenant=${query}`, { Upgrade: 'websocket' });
      expect(() => tenantForRequest(env, conflicting)).toThrow(TenantResolutionError);
      expect(() => shopperTenant(env, conflicting, 'acme')).toThrow(SessionAccessError);
    }
    expect(tenantForRequest(env, req('https://acme.example/?tenant=globex'))).toBe('acme');
  });

  it('returns generic no-store refusals before downstream work', async () => {
    const app = new Hono<{ Bindings: Env }>(); let effects = 0;
    app.use('*', tenantMiddleware()); app.get('*', c => { effects++; return c.json({ ok: true }); });
    for (const [env, request, status, error] of [
      [envWith('PRIVATE_INVALID_CONFIG'), req('https://acme.example/'), 503, 'Tenant configuration unavailable'],
      [envWith(configured()), req('https://acme.example/', { 'X-Tenant': 'globex' }), 403, 'Tenant unavailable'],
    ] as const) {
      const response = await app.request(request, undefined, env);
      expect(response.status).toBe(status); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ ok: false, error });
    }
    expect(effects).toBe(0);
  });
});
