// src/middleware/edgeAccess.test.ts
// The three gates against a tiny app: open mode is today's behavior exactly;
// enforced mode fails closed; a configured allow-list applies in either mode.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { corsOrigin, operatorWrites, originAllowed, originMatches, sdkKey, sdkKeyTable, verifySdkKey } from './edgeAccess';

const env = (over: Partial<Env> = {}): Env => ({
  JWT_SECRET: 'test-secret', JWT_ISSUER: 'iss', JWT_AUDIENCE: 'aud', ...over,
} as unknown as Env);

function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.use('*', cors({ origin: corsOrigin, credentials: true, allowHeaders: ['Content-Type', 'Authorization', 'X-SDK-Key'] }));
  a.use('/realtime/*', sdkKey());
  a.use('/v1/:tenant/*', sdkKey());
  a.use('/operator/*', operatorWrites());
  a.post('/realtime/action', (c) => c.json({ ok: true }));
  a.get('/realtime/ws', (c) => c.json({ ok: true }));
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
    expect(verifySdkKey('k-any', 'coach', e)).toEqual({ ok: true, tenant: 'coach' });
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
});

describe('operator writes', () => {
  it('open mode: writes pass without a token, as the demo console expects', async () => {
    expect((await app().request(`${SELF}/operator/audiences/publish`, { method: 'POST' }, env())).status).toBe(200);
  });

  it('enforced: reads open, writes need a verified token', async () => {
    const e = env({ AUTH_MODE: 'enforced' });
    expect((await app().request(`${SELF}/operator/audiences`, {}, e)).status).toBe(200);
    expect((await app().request(`${SELF}/operator/audiences/publish`, { method: 'POST' }, e)).status).toBe(401);
    expect((await app().request(`${SELF}/operator/audiences/publish`, { method: 'POST', headers: { Authorization: 'Bearer nope' } }, e)).status).toBe(401);
    const token = await new jose.SignJWT({ sub: 'ops-1', roles: ['operator'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('iss').setAudience('aud').setExpirationTime('5m')
      .sign(new TextEncoder().encode('test-secret'));
    expect((await app().request(`${SELF}/operator/audiences/publish`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, e)).status).toBe(200);
  });
});

describe('an operator token at the SDK gate (CW22)', () => {
  it('enforced: a verified Bearer token passes /v1 without a site key; a bad one does not; a site key still works', async () => {
    const e = env({ AUTH_MODE: 'enforced', SDK_KEYS: 'coach:k-coach' });
    expect((await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, {}, e)).status).toBe(401);
    expect((await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { Authorization: 'Bearer nope' } }, e)).status).toBe(401);
    const token = await new jose.SignJWT({ sub: 'ops-1', roles: ['operator'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('iss').setAudience('aud').setExpirationTime('5m')
      .sign(new TextEncoder().encode('test-secret'));
    const ok = await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { Authorization: `Bearer ${token}` } }, e);
    expect(ok.status).toBe(200);
    expect((await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { 'X-SDK-Key': 'k-coach' } }, e)).status).toBe(200);
    // a site key present but wrong is still refused, token or not: the key was the caller's claim
    expect((await app().request(`${SELF}/v1/coach/decisions/snapshot?visitorId=v`, { headers: { 'X-SDK-Key': 'k-other', Authorization: `Bearer ${token}` } }, e)).status).toBe(401);
  });
});
