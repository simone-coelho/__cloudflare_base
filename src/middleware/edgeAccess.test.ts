// src/middleware/edgeAccess.test.ts
// The three gates against a tiny app: open mode is today's behavior exactly;
// enforced mode fails closed; a configured allow-list applies in either mode.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { tenantMiddleware } from '@/tenancy/middleware';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantVariables } from '@/tenancy/tenant';
import { corsOrigin, operatorWrites, originAllowed, originMatches, sdkKey, sdkKeyTable, verifySdkKey } from './edgeAccess';

const env = (over: Partial<Env> = {}): Env => ({
  TENANTS: JSON.stringify({ provisioned: ['coach', 'acme', 'globex', 'kate'], hosts: { 'acme.example': 'acme', 'globex.example': 'globex' }, operatorGrants: { 'ops-1': ['coach'] } }),
  JWT_SECRET: 'w0202-edge-fixture-signing-material', JWT_ISSUER: 'iss', JWT_AUDIENCE: 'aud', ...over,
} as unknown as Env);

function app() {
  const a = new Hono<{ Bindings: Env; Variables: TenantVariables }>();
  a.use('*', cors({ origin: corsOrigin, credentials: true, allowHeaders: ['Content-Type', 'Authorization', 'X-SDK-Key', 'X-Tenant'] }));
  a.use('*', tenantMiddleware());
  a.use('/realtime/*', sdkKey());
  a.use('/v1/:tenant/*', sdkKey());
  a.use('/operator/*', operatorWrites());
  a.post('/realtime/action', (c) => c.json({ ok: true, tenant: c.get('tenant'), destination: shopperObjectName(c.get('tenant'), 'fixture') }));
  a.get('/realtime/ws', (c) => c.json({ ok: true, tenant: c.get('tenant'), destination: shopperObjectName(c.get('tenant'), 'fixture') }));
  a.get('/v1/:tenant/decisions/snapshot', (c) => c.json({ ok: true, tenant: c.req.param('tenant') }));
  a.get('/operator/audiences', (c) => c.json({ ok: true }));
  a.post('/operator/audiences/publish', (c) => c.json({ ok: true }));
  return a;
}
const SELF = 'https://edge-platform.example.workers.dev';

describe('CORS policy', () => {
  it('open mode with nothing configured reflects any origin: today, unchanged', async () => {
    const res = await app().request(`${SELF}/operator/audiences`, { headers: { Origin: 'https://anything.example' } }, env());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://anything.example');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('enforced mode with nothing configured answers only the page itself', async () => {
    const e = env({ AUTH_MODE: 'enforced' });
    const cross = await app().request(`${SELF}/operator/audiences`, { headers: { Origin: 'https://anything.example' } }, e);
    expect(cross.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const same = await app().request(`${SELF}/operator/audiences`, { headers: { Origin: SELF } }, e);
    expect(same.headers.get('Access-Control-Allow-Origin')).toBe(SELF);
    expect(originAllowed('http://localhost:9100', `${SELF}/x`, e)).toBe(true);
  });

  it('a configured allow-list applies in either mode, exact or wildcard', async () => {
    const e = env({ CORS_ORIGINS: 'https://www.coach.com, *.kate-spade.com' });
    expect(originAllowed('https://www.coach.com', `${SELF}/x`, e)).toBe(true);
    expect(originAllowed('https://staging.kate-spade.com', `${SELF}/x`, e)).toBe(true);
    expect(originAllowed('https://kate-spade.com', `${SELF}/x`, e)).toBe(true);
    expect(originAllowed('https://evil.example', `${SELF}/x`, e)).toBe(false);
    expect(originAllowed('https://notkate-spade.com', `${SELF}/x`, e)).toBe(false);
    expect(originMatches('*', 'https://anything')).toBe(true);
    const res = await app().request(`${SELF}/operator/audiences`, { headers: { Origin: 'https://evil.example' } }, e);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('SDK keys', () => {
  const e = env({ AUTH_MODE: 'enforced', SDK_KEYS: 'coach:k-coach|k-coach-2, kate:k-kate, *:k-any' });
  it('W07.05 independently gates canonical socket key protocols before route effects', async () => {
    const encoded = (value: string) => 'sdk-key-v1.' + btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const ask = (protocol: string, query = '', key?: string) => app().request(`${SELF}/realtime/ws?tenant=coach${query}`, {
      headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `shopper-session-v1, synthetic-capability, ${protocol}`, ...(key ? { 'X-SDK-Key': key } : {}) },
    }, e);
    expect((await ask(encoded('k-coach'))).status).toBe(200);
    expect((await ask(encoded('k-kate'))).status).toBe(403);
    for (const [protocol, query, key] of [[encoded('k-coach') + ', ' + encoded('k-coach'), '', undefined],
      ['sdk-key-v1.%%%%', '', undefined], [encoded('k-coach') + '=', '', undefined], [encoded('k-coach'), '&tenant=kate', undefined],
      [encoded('k-coach'), '', 'k-kate'], ['sdk-key-v1.' + 'YQ'.repeat(600), '', undefined]] as const) {
      expect((await ask(protocol, query, key)).status).toBe(query ? 403 : 401); // Canonical tenancy rejects ambiguity before the key gate.
    }
    const notSocket = await app().request(`${SELF}/realtime/action`, { method: 'POST', headers: { 'Sec-WebSocket-Protocol': encoded('k-coach') } }, e);
    expect(notSocket.status).toBe(401);
  });

  it('parses the table', () => {
    const t = sdkKeyTable(e);
    expect([...t.get('coach')!]).toEqual(['k-coach', 'k-coach-2']);
    expect(t.get('*')!.has('k-any')).toBe(true);
    expect(sdkKeyTable(env()).size).toBe(0);
  });

  it('verdicts: missing, unknown, wrong tenant, ok, wildcard', () => {
    expect(verifySdkKey('', 'coach', e)).toMatchObject({ ok: false, status: 401 });
    expect(verifySdkKey('nope', 'coach', e)).toMatchObject({ ok: false, status: 401 });
    expect(verifySdkKey('k-kate', 'coach', e)).toMatchObject({ ok: false, status: 403 });
    expect(verifySdkKey('k-coach-2', 'coach', e)).toEqual({ ok: true, tenant: 'coach' });
    expect(verifySdkKey('k-any', 'coach', e)).toMatchObject({ ok: false, status: 403 });
    expect(verifySdkKey('k-kate', null, e)).toEqual({ ok: true, tenant: 'kate' });
  });

  it('open mode passes everything through; enforced gates header and query alike', async () => {
    const open = await app().request(`${SELF}/realtime/action`, { method: 'POST' }, env());
    expect(open.status).toBe(200);
    expect((await app().request(`${SELF}/realtime/action`, { method: 'POST' }, e)).status).toBe(401);
    expect((await app().request(`${SELF}/realtime/action`, { method: 'POST', headers: { 'X-SDK-Key': 'k-coach' } }, e)).status).toBe(200);
    expect((await app().request(`${SELF}/realtime/ws?userId=v1&sdkKey=k-coach`, {}, e)).status).toBe(200);
    expect((await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { 'X-SDK-Key': 'k-kate' } }, e)).status).toBe(403);
    const ok = await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { 'X-SDK-Key': 'k-coach' } }, e);
    expect(await ok.json()).toEqual({ ok: true, tenant: 'coach' });
  });

  it('W37.08 binds named keys to the canonical destination through header, host and socket selectors', async () => {
    const bindings = env({ AUTH_MODE: 'enforced', SDK_KEYS: 'coach:k-coach,acme:k-acme,globex:k-globex,*:k-any' });
    for (const tenant of ['acme', 'globex']) {
      const other = tenant === 'acme' ? 'globex' : 'acme';
      for (const [url, init] of [
        [`${SELF}/realtime/action`, { method: 'POST', headers: { 'X-Tenant': tenant } }],
        [`https://${tenant}.example/realtime/action`, { method: 'POST' }],
        [`${SELF}/realtime/ws?tenant=${tenant}`, { headers: { Upgrade: 'websocket' } }],
      ] as Array<[string, RequestInit]>) {
        for (const key of [`k-${tenant}`, 'k-any', `k-${other}`]) {
          const response = await app().request(url, { ...init, headers: { ...init.headers, 'X-SDK-Key': key } }, bindings);
          expect(response.status).toBe(key === `k-${tenant}` ? 200 : 403);
          if (response.ok) expect(await response.json()).toEqual({ ok: true, tenant, destination: `t:${tenant}:fixture` });
          else {
            expect(await response.json()).toEqual({ ok: false, error: 'SDK key is for a different tenant' });
            expect(response.headers.get('Cache-Control')).toBe('no-store');
          }
        }
        const queryKey = await app().request(`${url}${url.includes('?') ? '&' : '?'}sdkKey=k-${tenant}`, init, bindings);
        expect(await queryKey.json()).toEqual({ ok: true, tenant, destination: `t:${tenant}:fixture` });
      }
    }
    const conflict = await app().request(`${SELF}/v1/acme/decisions/snapshot`, {
      headers: { 'X-Tenant': 'globex', 'X-SDK-Key': 'k-acme' },
    }, bindings);
    expect(conflict.status).toBe(403);
    expect(await conflict.json()).toEqual({ ok: false, error: 'Tenant unavailable' });
    const fallback = await app().request(`${SELF}/realtime/action`, { method: 'POST', headers: { 'X-SDK-Key': 'k-acme' } }, bindings);
    expect(fallback.status).toBe(403);
    const legacy = await app().request(`${SELF}/realtime/action`, { method: 'POST', headers: { 'X-SDK-Key': 'k-coach' } }, bindings);
    expect(await legacy.json()).toEqual({ ok: true, tenant: 'coach', destination: 'fixture' });
  });

  it('W37.08 refuses absent or invalid canonical context without path or key-owner fallback', async () => {
    for (const tenant of [undefined, null, '', 'ACME', ' acme', '*', 42, {}, []]) {
      const a = new Hono<{ Bindings: Env; Variables: { tenant: unknown } }>();
      let reached = false;
      a.use('*', async (c, next) => { if (tenant !== undefined) c.set('tenant', tenant); await next(); });
      a.use('/v1/:tenant/*', sdkKey());
      a.get('/v1/:tenant/probe', c => { reached = true; return c.json({ ok: true }); });
      const response = await a.request(`${SELF}/v1/acme/probe`, { headers: { 'X-SDK-Key': 'k-acme' } }, env({ AUTH_MODE: 'enforced', SDK_KEYS: 'acme:k-acme' }));
      expect(response.status).toBe(403); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ ok: false, error: 'Tenant unavailable' }); expect(reached).toBe(false);
    }
    for (const key of [undefined, 'unknown']) {
      const response = await app().request(`${SELF}/realtime/action`, { method: 'POST', headers: key ? { 'X-SDK-Key': key } : {} }, e);
      expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('W37.09 restricts only wildcard reliance using canonical distinct-brand configuration', async () => {
    const SDK_KEYS = '*:k-any|k-shared,acme:k-acme|k-shared|k-both,globex:k-globex|k-both';
    const multiple = env({ AUTH_MODE: 'enforced', SDK_KEYS });
    for (const tenant of ['acme', 'globex']) {
      expect(verifySdkKey('k-both', tenant, multiple)).toEqual({ ok: true, tenant });
      expect(verifySdkKey('k-any', tenant, multiple)).toMatchObject({ ok: false, status: 403 });
      expect(verifySdkKey('k-shared', tenant, multiple).ok).toBe(tenant === 'acme');
    }
    for (const TENANTS of [undefined, JSON.stringify({ provisioned: ['coach'] }), JSON.stringify({ provisioned: ['coach', 'coach'] })]) {
      const bindings = env({ AUTH_MODE: 'enforced', SDK_KEYS, TENANTS });
      expect(verifySdkKey('k-any', 'coach', bindings)).toEqual({ ok: true, tenant: 'coach' });
      const response = await app().request(`${SELF}/realtime/action`, { method: 'POST', headers: { 'X-SDK-Key': 'k-any' } }, bindings);
      expect(await response.json()).toEqual({ ok: true, tenant: 'coach', destination: 'fixture' });
    }
    const single = env({ AUTH_MODE: 'enforced', SDK_KEYS, TENANTS: JSON.stringify({ provisioned: ['acme', 'acme'] }) });
    expect(verifySdkKey('k-any', 'acme', single)).toEqual({ ok: true, tenant: 'acme' });
    for (const TENANTS of ['', '{', '{}', JSON.stringify({ provisioned: [] }), JSON.stringify({ provisioned: ['acme', 'globex', 'acme'] })]) {
      expect(verifySdkKey('k-any', 'acme', env({ AUTH_MODE: 'enforced', SDK_KEYS, TENANTS }))).toMatchObject({ ok: false, status: 403 });
    }
    const noRegistry = Object.defineProperty(env({ AUTH_MODE: 'enforced', SDK_KEYS }), 'TENANTS', { get() { throw new Error('Registry read'); } });
    for (const key of ['k-acme', 'k-shared', 'k-both']) expect(verifySdkKey(key, 'acme', noRegistry)).toEqual({ ok: true, tenant: 'acme' });
    expect(verifySdkKey('k-shared', null, noRegistry)).toEqual({ ok: true, tenant: 'acme' });
    expect(verifySdkKey('k-any', 'acme', noRegistry)).toMatchObject({ ok: false, status: 403 });
    expect(verifySdkKey('', 'acme', noRegistry)).toMatchObject({ ok: false, status: 401 });
    expect(verifySdkKey('unknown', 'acme', noRegistry)).toMatchObject({ ok: false, status: 401 });
    const open = env({ AUTH_MODE: 'open', SDK_KEYS });
    expect(verifySdkKey('k-any', 'globex', open)).toEqual({ ok: true, tenant: 'globex' });
    const response = await app().request(`${SELF}/realtime/action`, { method: 'POST', headers: { 'X-Tenant': 'globex', 'X-SDK-Key': 'k-any' } }, open);
    expect(await response.json()).toEqual({ ok: true, tenant: 'globex', destination: 't:globex:fixture' });
  });
});

describe('operator writes', () => {
  it('open mode: writes pass without a token, as the demo console expects', async () => {
    expect((await app().request(`${SELF}/operator/audiences/publish`, { method: 'POST' }, env())).status).toBe(200);
  });

  it('enforced: reads and writes need a verified token with an explicit tenant grant', async () => {
    const e = env({ AUTH_MODE: 'enforced' });
    expect((await app().request(`${SELF}/operator/audiences`, {}, e)).status).toBe(401);
    expect((await app().request(`${SELF}/operator/audiences/publish`, { method: 'POST' }, e)).status).toBe(401);
    expect((await app().request(`${SELF}/operator/audiences/publish`, { method: 'POST', headers: { Authorization: 'Bearer nope' } }, e)).status).toBe(401);
    const token = await new jose.SignJWT({ sub: 'ops-1', type: 'service', roles: ['operator'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('iss').setAudience('aud').setExpirationTime('5m')
      .sign(new TextEncoder().encode('w0202-edge-fixture-signing-material'));
    expect((await app().request(`${SELF}/operator/audiences/publish`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, e)).status).toBe(200);
    expect((await app().request(`${SELF}/operator/audiences`, { headers: { Authorization: `Bearer ${token}` } }, e)).status).toBe(200);
  });
});

it('W03.02 grants exact subjects only named provisioned tenants, without changing named shopper authorization', async () => {
  const issue = (sub: string) => new jose.SignJWT({ sub, type: 'service', roles: ['admin'], permissions: ['*'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('iss').setAudience('aud').setExpirationTime('5m')
    .sign(new TextEncoder().encode('w0202-edge-fixture-signing-material'));
  const rawSubject = ' \t exact operator ';
  const token = await issue(rawSubject);
  for (const grants of [undefined, null, [], 'acme', {}, { '*': ['acme'] }, { [rawSubject]: '*' },
    { [rawSubject]: ['*'] }, { [rawSubject]: ['unknown'] }, { [rawSubject.trim()]: ['acme'] },
    { [rawSubject]: ['acme'], broken: [7] }, { [rawSubject]: ['acme'] }]) {
    const valid = grants && typeof grants === 'object' && !Array.isArray(grants)
      && Object.keys(grants).length === 1 && Object.hasOwn(grants, rawSubject)
      && JSON.stringify(Object.values(grants)[0]) === '["acme"]';
    const bindings = env({ AUTH_MODE: 'enforced', SDK_KEYS: 'acme:k-acme',
      TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'], operatorGrants: grants }) });
    for (const tenant of ['acme', 'globex']) {
      for (const [path, method] of [['/operator/audiences', 'GET'], ['/operator/audiences', 'HEAD'],
        ['/operator/audiences/publish', 'POST'], ['/realtime/action', 'POST']]) {
        const response = await app().request(SELF + path, { method, headers: { 'X-Tenant': tenant, Authorization: `Bearer ${token}` } }, bindings);
        expect(response.status).toBe(valid && tenant === 'acme' ? 200 : 403);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
      }
    }
    expect((await app().request(SELF + '/realtime/action', { method: 'POST', headers: { 'X-Tenant': 'acme', 'X-SDK-Key': 'k-acme' } }, bindings)).status).toBe(200);
  }
  const inherited = await issue('constructor');
  expect((await app().request(SELF + '/operator/audiences', { headers: { 'X-Tenant': 'acme', Authorization: `Bearer ${inherited}` } },
    env({ AUTH_MODE: 'enforced', TENANTS: JSON.stringify({ provisioned: ['acme'], operatorGrants: {} }) }))).status).toBe(403);
  for (const tenant of [undefined, '', 'ACME', 'unknown']) {
    const bare = new Hono<{ Bindings: Env; Variables: { tenant: unknown } }>();
    bare.use('*', async (c, next) => { c.set('tenant', tenant); await next(); });
    bare.use('*', operatorWrites()); bare.get('/probe', c => c.json({ ok: true }));
    expect((await bare.request(SELF + '/probe', { headers: { Authorization: `Bearer ${token}` } },
      env({ AUTH_MODE: 'enforced', TENANTS: JSON.stringify({ provisioned: ['acme'], operatorGrants: { [rawSubject]: ['acme'] } }) }))).status).toBe(403);
  }
});

describe('an operator token at the SDK gate (CW22)', () => {
  it('enforced: a verified Bearer token passes /v1 without a site key; a bad one does not; a site key still works', async () => {
    const e = env({ AUTH_MODE: 'enforced', SDK_KEYS: 'coach:k-coach' });
    expect((await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, {}, e)).status).toBe(401);
    expect((await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { Authorization: 'Bearer nope' } }, e)).status).toBe(401);
    const token = await new jose.SignJWT({ sub: 'ops-1', type: 'service', roles: ['operator'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('iss').setAudience('aud').setExpirationTime('5m')
      .sign(new TextEncoder().encode('w0202-edge-fixture-signing-material'));
    const ok = await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { Authorization: `Bearer ${token}` } }, e);
    expect(ok.status).toBe(200);
    expect((await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { 'X-SDK-Key': 'k-coach' } }, e)).status).toBe(200);
    // a site key present but wrong is still refused, token or not: the key was the caller's claim
    expect((await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { 'X-SDK-Key': 'k-other', Authorization: `Bearer ${token}` } }, e)).status).toBe(401);
    const wildcard = await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, {
      headers: { 'X-SDK-Key': 'k-any', Authorization: `Bearer ${token}` },
    }, env({ AUTH_MODE: 'enforced', SDK_KEYS: '*:k-any' }));
    expect(wildcard.status).toBe(403); expect(wildcard.headers.get('Cache-Control')).toBe('no-store');
  });
});
