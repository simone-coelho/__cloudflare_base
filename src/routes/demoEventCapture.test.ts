import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import { tenantMiddleware } from '@/tenancy/middleware';
import { demoEventCaptureEnabled } from '@/routes/realtime';
import { funnelRoutes } from '@/routes/funnel';

const demo = { AUTH_MODE: 'open' as const, ENVIRONMENT: 'development', DEMO_EVENT_CAPTURE: 'true' };

describe('W06.10 legacy demo capture policy', () => {
  it('requires explicit open mode, development and true; missing or invalid values deny', () => {
    expect(demoEventCaptureEnabled(demo, DEFAULT_TENANT)).toBe(true);
    expect(demoEventCaptureEnabled({ ...demo, ENVIRONMENT: ' Development ', DEMO_EVENT_CAPTURE: ' TRUE ' }, DEFAULT_TENANT)).toBe(true);
    for (const [key, values] of Object.entries({
      AUTH_MODE: [undefined, null, '', 'enforced', 'OPEN', ' open ', true],
      ENVIRONMENT: [undefined, null, '', 'staging', 'production', 'test', 1],
      DEMO_EVENT_CAPTURE: [undefined, null, '', 'false', 'yes', true, 1],
    })) for (const value of values) {
      expect(demoEventCaptureEnabled({ ...demo, [key]: value }, DEFAULT_TENANT), key + ':' + String(value)).toBe(false);
    }
    expect(demoEventCaptureEnabled({}, DEFAULT_TENANT)).toBe(false);
  });

  it('requires the supplied canonical default tenant without falling back or normalizing selectors', () => {
    for (const tenant of [undefined, '', 'Coach', ' coach ', 'meridian', 'harbor']) {
      expect(demoEventCaptureEnabled(demo, tenant)).toBe(false);
    }
  });
});

describe('W06.10 actual checkout capture route', () => {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware()); app.route('/funnel', funnelRoutes);
  const event = { event_type: 'begin_checkout', vuid: 'vis-demo-only', sessionId: 's-demo-only', line: 'Tabby', price_usd: 12.6, tenant: 'coach', surface: 'coach' };
  const call = (env: Env, tenant = DEFAULT_TENANT, body = JSON.stringify(event)) => app.request('https://synthetic.invalid/funnel/event', {
    method: 'POST', headers: { 'X-Tenant': tenant, 'Content-Type': 'application/json' }, body,
  }, env);

  it('denies before body validation and D1, including true overrides and two provisioned nondefault tenants', async () => {
    for (const [config, tenant] of [
      [{}, DEFAULT_TENANT],
      [{ ...demo, AUTH_MODE: 'enforced' }, DEFAULT_TENANT],
      [{ ...demo, ENVIRONMENT: 'staging' }, DEFAULT_TENANT],
      [{ ...demo, ENVIRONMENT: 'production' }, DEFAULT_TENANT],
      [{ ...demo, DEMO_EVENT_CAPTURE: 'invalid' }, DEFAULT_TENANT],
      [demo, 'meridian'], [demo, 'harbor'],
    ] as const) {
      const prepare = vi.fn(() => { throw new Error('Unexpected D1 access'); });
      const env = { ...config, TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian', 'harbor'] }), DB: { prepare } } as unknown as Env;
      for (const body of [JSON.stringify(event), '{invalid-json']) {
        const response = await call(env, tenant, body);
        expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
      }
      expect(prepare).not.toHaveBeenCalled();
    }
  });

  it('retains the explicit demo insert and best-effort missing or rejecting D1 behavior', async () => {
    const run = vi.fn(async () => ({ success: true })), bind = vi.fn(() => ({ run })), prepare = vi.fn(() => ({ bind }));
    const env = { ...demo, DB: { prepare } } as unknown as Env;
    const response = await call(env);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO demo_events'));
    expect(bind).toHaveBeenCalledWith(expect.any(Number), event.vuid, event.sessionId, event.sessionId, event.event_type, event.line, 13);
    expect(run).toHaveBeenCalledTimes(1);
    for (const DB of [undefined, { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('Synthetic D1 failure'); } }) }) }]) {
      const result = await call({ ...demo, DB } as unknown as Env);
      expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true });
    }
  });
});
