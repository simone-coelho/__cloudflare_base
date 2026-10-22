// src/units/H3/PROBE.unit.test.ts
// Unit H3-1 — the customer's connection check passes against a customer-profile
// stamp: a readiness probe names no tenant.
//
// THE DEFECT, measured on the staging stamp (customer profile, AUTH_MODE=enforced):
// `GET /health/ready` with no `X-Tenant` answered 403 `{"ok":false,"error":"Tenant
// unavailable"}`, because the tenant middleware (src/index.ts, the global
// `app.use('*', tenantMiddleware())`) runs before the health routes; with the
// header it answered 200 `{"status":"ready"}`. A load balancer's or an operator's
// readiness probe sends no tenant, so it read an outage on a healthy stamp, and the
// first check of scripts/verify-origin.sh failed with it.
//
// THE PROPERTY. The two probes the customer boundary admits (src/customerBoundary.ts
// `/health/live`, `/health/ready`) answer the same on a customer stamp whether or not
// the caller names a tenant, because they read none (src/routes/health.ts: the signing
// configuration, the identity material against the stamp's registry, the recovery
// prerequisites); and every tenant-scoped route keeps its refusal without one.
//
// THE DOOR. The REAL Worker default export of `src/index.ts` (its customer boundary,
// its global middleware, every mounted route) over the W08 customer stamp's
// environment (src/units/W08/_customer.ts), called with no `X-Tenant` header, which
// that stamp's own `call` always adds — hence the Worker is called here directly.

import { vi, describe, it, expect } from 'vitest';
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import type { Env } from '@/types/env';
import { customerStamp, TENANT } from '../W08/_customer';

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };
const ORIGIN = 'https://stamp.invalid';
const ctx = { waitUntil() { /* nothing is retained */ }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext;

/**
 * The W08 stamp, made READY for its two provisioned tenants: its signing material is the stamp's own, and its identity
 * proof material names only the first tenant and is shorter than the 32 bytes a customer stamp requires
 * (src/identity/material.mjs `safeIdentitySecret`, `validateIdentityMaterial`), which is a stamp that answers
 * `/health/ready` 503 whatever the caller names. Here the one thing that must differ between two answers is the tenant header.
 */
const READY_IDENTITY = 'acme:h3-1-identity-proof-material-for-acme-0123,globex:h3-1-identity-proof-material-for-globex-0123';

async function door() {
  const stamp = await customerStamp('session');
  (stamp.env as { IDENTITY_SECRETS?: string }).IDENTITY_SECRETS = READY_IDENTITY;
  const worker = (await import('@/index')).default as unknown as Worker;
  const ask = async (env: Env, method: string, path: string, headers: Record<string, string> = {}) => {
    const response = await worker.fetch(new Request(ORIGIN + path, { method, headers }), env, ctx);
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { body = { unparsed: text.slice(0, 200) }; }
    return { status: response.status, body, cacheControl: response.headers.get('Cache-Control') };
  };
  return { stamp, ask };
}
/** What an answer says, in one value that a failure prints whole: the status and the member that names the outcome. */
const said = (a: { status: number; body: Record<string, unknown> }) => [a.status, a.body.status ?? a.body.error];

/** The two switches the answer must not depend on: the stamp's profile, and whether the caller names a tenant. */
const PROFILES = ['customer', 'demo'] as const;
const PROBES = [['/health/ready', 'ready'], ['/health/live', 'alive']] as const;

describe('unit:H3.1 a readiness probe names no tenant', () => {
  for (const profile of PROFILES) {
    for (const [path, status] of PROBES) {
      it(`${profile} profile, GET ${path}: ${status} with no tenant, and the same with one`, async () => {
        const { stamp, ask } = await door();
        const env = { ...stamp.env, DEPLOYMENT_PROFILE: profile } as Env;
        const without = await ask(env, 'GET', path);
        const withTenant = await ask(env, 'GET', path, { 'X-Tenant': TENANT });
        expect(said(without)).toEqual([200, status]);
        expect(said(withTenant)).toEqual([200, status]);
        // The same answer in everything but the clock.
        const { timestamp: a, ...left } = without.body, { timestamp: b, ...right } = withTenant.body;
        expect([typeof a, typeof b, left]).toEqual(['number', 'number', right]);
        expect(without.cacheControl).toBe(withTenant.cacheControl);
      });
    }
  }

  it('HEAD answers as GET does, with no tenant', async () => {
    const { stamp, ask } = await door();
    for (const [path] of PROBES) expect([path, (await ask(stamp.env, 'HEAD', path)).status]).toEqual([path, 200]);
    for (const [path] of PROBES) expect([path, (await ask(stamp.env, 'HEAD', path, { 'X-Tenant': TENANT })).status]).toEqual([path, 200]);
  });

  it('a probe spelled with an encoded character is the same probe: the path is read as the router reads it', async () => {
    const { stamp, ask } = await door();
    for (const [path, status] of [['/health/%72eady', 'ready'], ['/health/l%69ve', 'alive']] as const) {
      expect([path, ...said(await ask(stamp.env, 'GET', path))]).toEqual([path, 200, status]);
      expect([path, ...said(await ask(stamp.env, 'GET', path, { 'X-Tenant': TENANT }))]).toEqual([path, 200, status]);
    }
  });

  it('a probe that is not ready still says so with no tenant: the exemption is of the tenant, not of the check', async () => {
    const { stamp, ask } = await door();
    const env = { ...stamp.env } as Env; delete (env as { JWT_SECRET?: string }).JWT_SECRET;
    const without = await ask(env, 'GET', '/health/ready'), withTenant = await ask(env, 'GET', '/health/ready', { 'X-Tenant': TENANT });
    expect(said(without)).toEqual([503, 'not_ready']);
    expect(said(withTenant)).toEqual([503, 'not_ready']);
    expect(without.body.error).toBe(withTenant.body.error);
  });

  describe('nothing else is exempted: every tenant-scoped route keeps its refusal without a tenant', () => {
    // Each is a route the customer boundary admits (src/customerBoundary.ts CUSTOMER_ROUTES), chosen so that WITH a
    // provisioned tenant it gets past the tenant middleware and is answered by its own gate (401: no credential),
    // and WITHOUT one it is refused by the tenant middleware before any gate.
    const SCOPED: Array<[string, string]> = [
      ['GET', '/content/catalog'], ['GET', '/config/reflex'], ['GET', '/operator/audiences'], ['GET', '/auth/me'],
      ['POST', '/sort'], ['POST', '/search'], ['GET', '/realtime/ws'], ['POST', '/auth/login'],
    ];
    const REFUSAL = { ok: false, error: 'Tenant unavailable' };
    for (const profile of PROFILES) for (const [method, path] of SCOPED) {
      it(`${profile} profile, ${method} ${path}`, async () => {
        const { stamp, ask } = await door();
        const env = { ...stamp.env, DEPLOYMENT_PROFILE: profile } as Env;
        const without = await ask(env, method, path);
        expect([path, without.status, without.body]).toEqual([path, 403, REFUSAL]);
        const other = await ask(env, method, path, { 'X-Tenant': 'initech' });
        expect([path, other.status, other.body]).toEqual([path, 403, REFUSAL]);
        const named = await ask(env, method, path, { 'X-Tenant': TENANT });
        expect([path, named.status === 403 && JSON.stringify(named.body) === JSON.stringify(REFUSAL)]).toEqual([path, false]);
      });
    }

    // The two probes are the whole exemption. On a demo stamp (where the boundary does not pre-filter paths) any other
    // path, and any other method on a probe, is still refused by the tenant middleware before a route sees it; on a customer
    // stamp the boundary answers 404 for what it does not list. Neither is ever answered as a probe is.
    const NOT_PROBES = ['/health/ready/', '/health/readyz', '/health/ready/x', '/health/live/x', '/healthz', '//health/ready', '/health/%72eady/x'];
    const NOT_FOUND = { error: 'Not Found' };

    it('a path that only begins like a probe is no probe: demo, the tenant is still required', async () => {
      const { stamp, ask } = await door();
      const env = { ...stamp.env, DEPLOYMENT_PROFILE: 'demo' } as Env;
      for (const path of NOT_PROBES) { const a = await ask(env, 'GET', path); expect([path, a.status, a.body]).toEqual([path, 403, REFUSAL]); }
    });

    it('a path that only begins like a probe is no probe: customer, the boundary does not list it', async () => {
      const { stamp, ask } = await door();
      for (const path of [...NOT_PROBES, '/health', '/health/']) { const a = await ask(stamp.env, 'GET', path); expect([path, a.status, a.body]).toEqual([path, 404, NOT_FOUND]); }
    });

    it('a write to a probe is no probe: demo, the tenant is still required; customer, the boundary lists only the reads', async () => {
      const { stamp, ask } = await door();
      const demo = { ...stamp.env, DEPLOYMENT_PROFILE: 'demo' } as Env;
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) for (const [path] of PROBES) {
        const d = await ask(demo, method, path), c = await ask(stamp.env, method, path);
        expect([method, path, d.status, d.body, c.status, c.body]).toEqual([method, path, 403, REFUSAL, 404, NOT_FOUND]);
      }
    });
  });
});
