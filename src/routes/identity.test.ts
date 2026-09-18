// src/routes/identity.test.ts
//
// CW25 through the wire, on the session host: a phone and a laptop browse as
// strangers, both sign in to the same account, and the person is the sum. Then
// the rules around the edges: the assertion, the shopper-id refusal, the shared
// computer, detach, history in both formats, and who may ask what.
import { connectorIdentity } from '@/connectors/config';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { identityRoutes } from '@/routes/identity';
import { SessionManager, type SessionData } from '@/services/SessionManager';
import { RealtimeSegmentEngine } from '@/services/RealtimeSegmentEngine';
import { FeatureVariableManager } from '@/services/FeatureVariableManager';
import { CDPService } from '@/services/CDPService';
import { DEFAULT_REFLEX_CONFIG, apply, audienceKey, emptyState, snapshot, type ReflexState } from '@/reflex/core';
import { signAssertion } from '@/identity/assertion';
import { isShopperId, shopperIdFor } from '@/identity/shopperId';
import { createCore } from '@/sdk/core';
import { createIdentity } from '@/sdk/identify';
import { memoryHost } from '@/sdk/memoryHost';
import { issueSessionCapability, verifySessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { erasureJobKey, erasureRawDigest, ERASURE_STEP_LIMIT, ERASURE_DISCOVERY_PAGE_LIMIT } from '@/identity/erase';
import { IdentityStore } from '@/identity/store';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { PersonalizationWebSocket } from '@/durable-objects/PersonalizationWebSocket';
import { authorityLocks } from '@/sdk/testHost';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { shopperObjectName } from '@/tenancy/objects';
import { tenantKey } from '@/tenancy/tenant';
import { applyHistory, historyRowSchema } from '@/identity/history';
import { loadTombstone, tombstoneKey, writeTombstone } from '@/ledger/erasure';
import { reflexScopeForTenant, writeReflexConfig } from '@/reflex/configStore';
import { Hono } from 'hono';
import { tenantMiddleware, tenantConfig } from '@/tenancy/middleware';
import { decisionRoutes } from '@/routes/decisions';
import { memoryStore, type OperationAuditDetail } from '@/auth/store';
import { CONSENT_LIFETIME_MS } from '@/content/consent';
import { retentionBirth, type RetentionCategory } from '@/retention';


class FakeKV {
  store = new Map<string, string>();
  pageSize = 1000;
  async get(key: string, type?: string) { const r = this.store.get(key); return r === undefined ? null : type === 'stream' ? new Response(r).body : (type === 'json' ? JSON.parse(r) : r); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const names = [...this.store.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort();
    const start = Number(o?.cursor ?? 0), end = start + Math.min(this.pageSize, o?.limit ?? 1000);
    return { keys: names.slice(start, end).map(name => ({ name })), list_complete: end >= names.length,
      ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const cfg = DEFAULT_REFLEX_CONFIG;
const TABBY = audienceKey('line', 'Tabby');

/** Enough of R2 for the ledger's tombstones: put, get, delete, list by prefix. */
class FakeR2 {
  store = new Map<string, string>();
  versions = new Map<string, number>();
  async put(key: string, body: string, options?: { onlyIf?: Headers | R2Conditional }) {
    const current = this.store.has(key) ? 'v' + (this.versions.get(key) ?? 0) : null;
    const condition = options?.onlyIf;
    if (condition instanceof Headers ? (condition.get('If-None-Match') === '*' && current !== null)
      || (condition.has('If-Match') && condition.get('If-Match') !== JSON.stringify(current))
      : (condition?.etagDoesNotMatch === '*' && current !== null) || (condition?.etagMatches !== undefined && condition.etagMatches !== current)) return null;
    this.store.set(key, body); const version = (this.versions.get(key) ?? 0) + 1; this.versions.set(key, version);
    return { etag: 'v' + version };
  }
  async get(key: string) { const v = this.store.get(key); return v === undefined ? null : { text: async () => v, etag: 'v' + (this.versions.get(key) ?? 0) }; }
  async delete(key: string) { this.store.delete(key); }
  async list(o: { prefix: string }) { return { objects: [...this.store.keys()].filter((k) => k.startsWith(o.prefix)).map((key) => ({ key })), truncated: false }; }
}

const mkEnv = (over: Record<string, unknown> = {}): Env => ({
  CACHE: new FakeKV(), SESSIONS: new FakeKV(), STORAGE: new FakeR2(), ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock',
  JWT_SECRET: 'w0202-synthetic-route-signing-material', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'coach:s3cret', ...over,
} as unknown as Env);
const token = (sub = 'ops') => new jose.SignJWT({ sub }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode('w0202-synthetic-route-signing-material'));

const browse = (values: string[], at: number): ReflexState => {
  let s = emptyState(cfg);
  values.forEach((v, i) => { s = apply(s, { action: 'product_view', touches: [{ dim: 'line', value: v }] }, at + i * 1000, cfg).state; });
  return s;
};

let env: Env;
let auth: Record<string, string>;
let ownedIds = new Map<string, string>();

async function seedDevice(visitorId: string, sessionId: string, values: string[]) {
  ownedIds.set(visitorId, sessionId);
  const sm = new SessionManager(env);
  // Built a few seconds ago, not at T0: the route merges at Date.now(), and a vector from 2023 is dust by now.
  await sm.createOrUpdateSession(sessionId, visitorId, { reflex: browse(values, Date.now() - 5_000), attributes: { product_views: values.length } });
}

function historyProfile(subject: string, now = Date.now()): SessionData {
  return { userId: subject, segments: [], attributes: {}, reflex: emptyState(cfg),
    ...(isShopperId(subject) ? { identity: { shopperId: subject, linkedAt: now } } : {}),
    metadata: { firstSeen: now, lastSeen: 0, sessionCount: 0, engagementScore: 0, lastSegmentUpdate: now },
    preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
  };
}
async function seedHistorySession(tenant: string, subject: string) {
  const sid = 's-history-' + subject, kv = env.SESSIONS as unknown as FakeKV;
  await kv.put(tenantKey(tenant, 'session:' + sid), JSON.stringify(historyProfile(subject)));
  await kv.put(tenantKey(tenant, 'user:' + subject), sid);
  return sid;
}

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> ?? {}) };
  let body = init.body;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  const app = new Hono().use('*', tenantMiddleware()).route('/v1', identityRoutes);
  const mounted = headers[SHOPPER_HEADER] !== undefined || path.endsWith('/identity/session');
  const res = mounted ? await app.request('/v1' + path, { ...init, headers, body }, env)
    : await identityRoutes.request(path, { ...init, headers, body }, env);
  return { status: res.status, body: (await res.json()) as Record<string, any>, headers: res.headers };
}

async function ownedCall(path: string, init: RequestInit & { json?: unknown }) {
  const visitorId = (init.json as { visitorId?: string })?.visitorId ?? 'vis-00000000-0000-4000-8000-000000000099';
  const subject = /^[A-Za-z0-9_.-]+$/.test(visitorId) ? visitorId : 'vis-00000000-0000-4000-8000-000000000099';
  const session = await issueSessionCapability(env, { tenant: 'coach', subject, sessionId: ownedIds.get(subject) ?? 's-owned-fresh', kind: subject.startsWith('sh_') ? 'recognized' : 'anonymous' });
  return call(path, { ...init, headers: { ...init.headers, [SHOPPER_HEADER]: session.capability } });
}

// Explicit positive-fixture signing only. The SDK transport below never uses this helper.
async function signedCall(path: string, init: RequestInit & { json?: unknown }) {
  const body = init.json as { visitorId: string; accountId: string };
  const exp = Math.floor(Date.now() / 1000) + 120;
  const assertion = await signAssertion('s3cret', 'coach', body.visitorId, body.accountId, exp);
  return ownedCall(path, { ...init, json: { ...body, exp, assertion } });
}

beforeEach(async () => {
  env = mkEnv();
  ownedIds = new Map();
  auth = { Authorization: `Bearer ${await token()}` };
});
afterEach(() => { vi.restoreAllMocks(); });

async function auditedIdentityFixture() {
  const accounts = memoryStore(), tokens = new Map<string, string>();
  env.AUTH_MODE = 'enforced'; env.IDENTITY_SALT = 'w0305-Synthetic-Identity-Salt-0123456789'; env.ACCOUNTS = accounts;
  env.TENANTS = JSON.stringify({ provisioned: ['meridian', 'harbor'], operatorGrants: { 'audit-operator': ['meridian'], 'retry-operator': ['meridian'], 'other-operator': ['harbor'] } });
  for (const sub of ['audit-operator', 'retry-operator', 'other-operator']) tokens.set(sub, await new jose.SignJWT({ type: 'service', roles: ['admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuer('i').setAudience('a').setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.JWT_SECRET)));
  const app = new Hono().use('*', tenantMiddleware()).route('/v1', identityRoutes).route('/v1', decisionRoutes);
  const send = (tenant: string, suffix: string, body?: unknown, sub = 'audit-operator', method = body === undefined ? 'GET' : 'POST') =>
    app.request(`/v1/${tenant}/${suffix}`, { method, headers: { 'X-Tenant': tenant, 'Content-Type': 'application/json',
      ...(tokens.has(sub) ? { Authorization: 'Bearer ' + tokens.get(sub) } : {}) }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }, env);
  const details = () => accounts.log.map(row => JSON.parse(row.detail!) as OperationAuditDetail);
  return { accounts, send, details };
}

it('W03.05 audits exact identity owners and every1000-account mapping with two acknowledged bounded phases', async () => {
  const f = await auditedIdentityFixture(), kv = env.SESSIONS as unknown as FakeKV;
  const ids = Array.from({ length: 1000 }, (_, i) => 'acct-' + i); ids[1] = '__proto__'; ids[2] = 'constructor'; ids[3] = ' acct-0 ';
  const write = vi.spyOn(f.accounts, 'auditOperations'), digest = crypto.subtle.digest.bind(crypto.subtle);
  const derivation = vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, data) => {
    expect(f.accounts.log).toHaveLength(100); expect(f.details().every(d => d.phase === 'admitted')).toBe(true); return digest(algorithm, data);
  });
  const response = await f.send('meridian', 'identity/resolve', { accountIds: ids });
  expect(response.status).toBe(200); expect(write).toHaveBeenCalledTimes(2); expect(derivation).toHaveBeenCalledTimes(1000); derivation.mockRestore();
  const body = await response.json() as { resolved: Record<string, string> };
  expect(Object.keys(body.resolved)).toHaveLength(1000); expect(Object.hasOwn(body.resolved, '__proto__')).toBe(true);
  expect(body.resolved[' acct-0 ']).toBe(body.resolved['acct-0']);
  expect(body.resolved.__proto__).toBe(await shopperIdFor(env, 'meridian', '__proto__'));
  const details = f.details(); expect(details).toHaveLength(200); expect(new Set(details.map(d => d.requestId)).size).toBe(1);
  for (const [index, detail] of details.entries()) {
    expect(new TextEncoder().encode(JSON.stringify(detail)).length).toBeLessThanOrEqual(2048);
    expect(detail.selector.kind).toBe('accounts');
    if (detail.selector.kind !== 'accounts') throw new Error('Expected account membership');
    expect(detail.selector.chunk).toBe(index % 100); expect(detail.selector.total).toBe(1000);
    expect(detail.selector.members.map(m => m.ordinal)).toEqual(Array.from({ length: 10 }, (_, n) => (index % 100) * 10 + n));
    expect(detail.selector.members.every(m => /^[a-f0-9]{64}$/.test(m.accountRef) && (index < 100 ? m.shopperRef === undefined : /^[a-f0-9]{64}$/.test(m.shopperRef!)))).toBe(true);
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.IDENTITY_SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify([
    'operator-subject-operation', 2, 'meridian', 'shopper', body.resolved['acct-999'],
  ]))))].map(b => b.toString(16).padStart(2, '0')).join('');
  const last = details.at(-1)!.selector; expect(last.kind === 'accounts' && last.members.at(-1)!.shopperRef).toBe(expected);
  expect(JSON.stringify(f.accounts.log)).not.toContain('acct-'); expect(JSON.stringify(f.accounts.log)).not.toContain(env.IDENTITY_SALT);
  write.mockClear();
  for (const accountIds of [[], ['ok', 1], [' '], ['x'.repeat(201)], [...ids, 'extra']]) expect((await f.send('meridian', 'identity/resolve', { accountIds })).status).toBe(400);
  expect((await f.send('meridian', 'identity/resolve', JSON.stringify({ accountIds: ['x'.repeat(1024 * 1024)] }))).status).toBe(413);
  expect(write).not.toHaveBeenCalled();
  write.mockRejectedValueOnce(new Error('PRIVATE_ADMISSION'));
  const noDerivation = vi.spyOn(crypto.subtle, 'digest');
  expect((await f.send('meridian', 'identity/resolve', { accountIds: ['allowed'] })).status).toBe(503); expect(noDerivation).not.toHaveBeenCalled(); noDerivation.mockRestore();
  write.mockRestore();
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(r => { release = r; }), waiting = new Promise<void>(r => { reached = r; });
  const phase = f.accounts.auditOperations.bind(f.accounts);
  const held = vi.spyOn(f.accounts, 'auditOperations').mockImplementation(async rows => {
    if (JSON.parse(rows[0]!.detail!).phase === 'result') { reached(); await gate; } await phase(rows);
  });
  let returned = false;
  const pending = Promise.resolve(f.send('meridian', 'identity/resolve', { accountIds: ['held'] })).then(r => { returned = true; return r; });
  await waiting; expect(returned).toBe(false); release(); expect((await pending).status).toBe(200); held.mockRestore();
  const shopper = await shopperIdFor(env, 'meridian', 'one'), visitor = 'vis-audit', link = { visitorId: visitor, shopperId: shopper, linkedAt: 1, assurance: 'signed', source: 'login' };
  const person = { shopperId: shopper, createdAt: 1, salted: true, visitors: [{ visitorId: visitor, linkedAt: 1, assurance: 'signed', source: 'login' }] };
  kv.store.set(tenantKey('meridian', 'identity:visitor:' + visitor), JSON.stringify(link));
  kv.store.set(tenantKey('meridian', 'identity:shopper:' + shopper), JSON.stringify(person));
  for (const [suffix, good, keyName] of [['visitor/' + visitor, link, 'identity:visitor:' + visitor], ['shopper/' + shopper, person, 'identity:shopper:' + shopper]] as const) {
    expect((await f.send('meridian', 'identity/' + suffix)).status).toBe(200);
    for (const bad of [null, false, 0, '', [], {}, { ...good, ...(suffix.startsWith('visitor') ? { visitorId: 'other' } : { shopperId: 'sh_' + 'f'.repeat(32) }) }]) {
      kv.store.set(tenantKey('meridian', keyName), JSON.stringify(bad));
      const denied = await f.send('meridian', 'identity/' + suffix); expect(denied.status).toBe(503); expect(await denied.text()).not.toContain(shopper);
    }
    kv.store.delete(tenantKey('meridian', keyName));
    expect((await f.send('meridian', 'identity/' + suffix)).status).toBe(suffix.startsWith('visitor') ? 200 : 404);
  }
  const self = await f.send('meridian', 'identity/visitor/' + shopper);
  expect(self.status).toBe(200); expect(await self.json()).toMatchObject({ visitorId: shopper, shopperId: shopper, link: null });
  kv.store.set(tenantKey('meridian', 'identity:visitor:' + shopper), JSON.stringify({ ...link, visitorId: shopper, shopperId: 'sh_' + 'f'.repeat(32) }));
  const contradictory = await f.send('meridian', 'identity/visitor/' + shopper);
  expect(contradictory.status).toBe(503); expect(await contradictory.text()).not.toContain('sh_');
  expect(f.details().at(-1)!.subjectRef).toBeUndefined();
  const page = await (await f.send('meridian', 'audit?limit=100')).json() as { entries: Array<{ tenant: string; detail: { v: number } }> };
  expect(page.entries.every(e => e.tenant === 'meridian')).toBe(true); expect(page.entries.some(e => e.detail.v === 2)).toBe(true);
  expect(await f.accounts.recentAudit(100)).toEqual([]);
  expect((await f.send('harbor', 'identity/resolve', { accountIds: ['one'] })).status).toBe(403);
});

describe('the link, on the session host', () => {
  it('a phone signs in: the response names the person, sets the cookie, and the old cookie reads the person', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby', 'Tabby', 'Tabby']);
    const r = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('linked');
    expect(r.body.assurance).toBe('signed');
    expect(r.body.shopperId).toBe(await shopperIdFor(env, 'coach', 'acct-1001'));
    expect(r.body.carry).toBe(r.body.shopperId);
    expect(r.body.audiences).toContain(TABBY);
    const cookies = r.headers.get('set-cookie') ?? '';
    expect(cookies).toContain('opt_session_id=');
    expect(cookies).toContain(`opt_user_id=${r.body.shopperId}`);
    expect(cookies).not.toContain('opt_session_id=s-phone');

    const sm = new SessionManager(env);
    expect((await sm.getSession('s-phone'))?.userId).toBe(r.body.shopperId);
  });

  it('a laptop signs in to the same account: cross-device, the person is the sum', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby', 'Tabby']);
    await seedDevice('vis-00000000-0000-4000-8000-000000000002', 's-laptop', ['Rogue', 'Rogue', 'Tabby']);
    const a = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    const b = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000002', accountId: 'acct-1001', source: 'checkout' } });
    expect(b.body.shopperId).toBe(a.body.shopperId);
    expect(b.body.outcome).toBe('linked');

    const sm = new SessionManager(env);
    const person = await sm.getSessionByUserId(b.body.shopperId);
    const snap = snapshot(person!.reflex!, Date.now(), cfg);
    expect(Object.keys(snap.dims.line).sort()).toEqual(['Rogue', 'Tabby']);
    expect(person!.attributes.product_views).toBe(5);
    expect(person!.metadata.visitCount).toBe(2);
    // Either browser resolves to the person.
    expect((await sm.getSession('s-phone'))?.userId).toBe(b.body.shopperId);
    expect((await sm.getSession('s-laptop'))?.userId).toBe(b.body.shopperId);
  });

  it('the old anonymous grant cannot follow the linked browser into the person', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby']);
    const a = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    const b = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    expect(b.status).toBe(401);
    expect((await new SessionManager(env).getSessionByUserId(a.body.shopperId))!.attributes.product_views).toBe(1);
  });

  it('a shared computer requires detach and a newly owned browser before linking another account', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby', 'Tabby', 'Tabby']);
    const first = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    const refused = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-2002' } });
    expect(refused.status).toBe(401);
    const detached = await call('/coach/identity/detach', { method: 'POST', headers: { [SHOPPER_HEADER]: first.body.session.capability } });
    const fresh = detached.body.session;
    const exp = Math.floor(Date.now() / 1000) + 120;
    const assertion = await signAssertion('s3cret', 'coach', fresh.subject, 'acct-2002', exp);
    const second = await call('/coach/identity/link', { method: 'POST', headers: { [SHOPPER_HEADER]: fresh.capability }, json: { visitorId: fresh.subject, accountId: 'acct-2002', exp, assertion } });
    expect(second.status).toBe(200); expect(second.body.shopperId).not.toBe(first.body.shopperId); expect(second.body.audiences).toEqual([]);
    expect((await new SessionManager(env).getSessionByUserId(first.body.shopperId))?.reflex?.audiences).toContain(TABBY);
  });

  it('refuses to link a browser that already carries a shopper id', async () => {
    const sh = await shopperIdFor(env, 'coach', 'acct-1001');
    const r = await ownedCall('/coach/identity/link', { method: 'POST', json: { visitorId: sh, accountId: 'acct-2002' } });
    expect(r.status).toBe(409);
  });

  it('a browser with no session yet links fine: the person starts empty', async () => {
    const r = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000004', accountId: 'acct-1001' } });
    expect(r.status).toBe(200);
    expect(r.body.audiences).toEqual([]);
    const sm = new SessionManager(env);
    expect(await sm.resolveSessionIdByUserId('vis-00000000-0000-4000-8000-000000000004')).toBe(await sm.resolveSessionIdByUserId(r.body.shopperId));
  });

  it('validates the body and the tenant', async () => {
    expect((await ownedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000005' } })).status).toBe(400);
    expect((await ownedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 't:kate-spade:vis-00000000-0000-4000-8000-000000000005', accountId: 'a' } })).status).toBe(401);
    expect((await ownedCall('/not a tenant/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000005', accountId: 'a' } })).status).toBe(401);
  });
});

describe('the assertion, when the tenant has a secret', () => {
  beforeEach(() => { env = mkEnv({ IDENTITY_SECRETS: 'coach:s3cret' }); destinations(); });

  it('refuses an unsigned link, accepts the site-signed one, and records signed assurance', async () => {
    const unsigned = await ownedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000005', accountId: 'acct-1001' } });
    expect(unsigned.status).toBe(401);
    const exp = Math.floor(Date.now() / 1000) + 120;
    const assertion = await signAssertion('s3cret', 'coach', 'vis-00000000-0000-4000-8000-000000000005', 'acct-1001', exp);
    const signed = await ownedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000005', accountId: 'acct-1001', exp, assertion } });
    expect(signed.status).toBe(200);
    expect(signed.body.assurance).toBe('signed');
    const forged = await ownedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000005', accountId: 'acct-9999', exp, assertion } });
    expect(forged.status).toBe(401);
  });
});

describe('W04.01 mandatory proof and actual SDK retry', () => {
  it('denies before store/object/cookie effects in every mode and host, with signed positive controls', async () => {
    for (const host of ['session', 'do']) {
      const objectCalls: string[] = [];
      const objects = {
        idFromName(name: string) { objectCalls.push('id'); return name; },
        get() { objectCalls.push('get'); return { async fetch(url: string) {
          objectCalls.push(new URL(url).pathname);
          return Response.json({ ok: true, consent: { tracking: true, personalization: true }, sessionId: 's-owned-do', audiences: ['W0401_PRIVATE_AUDIENCE'], changes: { entered: [], exited: [], explain: [] } });
        } }; },
      };
      const exp = Math.floor(Date.now() / 1000) + 120;
      const signed = await signAssertion('s3cret', 'coach', 'vis-00000000-0000-4000-8000-000000000006', 'acct-proof', exp);
      const oldExp = Math.floor(Date.now() / 1000) - 1;
      const expired = await signAssertion('s3cret', 'coach', 'vis-00000000-0000-4000-8000-000000000006', 'acct-proof', oldExp);
      const attempts = [
        ...[undefined, '', 'coach: | ', 'other:key', 42].flatMap(material =>
          [undefined, 'open', 'enforced'].map(mode => ({ material, mode, proof: {} }))),
        ...[{}, { exp, assertion: 'forged' }, { exp: oldExp, assertion: expired }]
          .map(proof => ({ material: 'coach:s3cret', mode: 'enforced', proof })),
      ];
      for (const { material, mode, proof } of attempts) {
        env = mkEnv({ REFLEX_HOST: host, AUTH_MODE: mode, IDENTITY_SECRETS: material, SHOPPER_REFLEX: objects });
        const kvs = [env.CACHE, env.SESSIONS] as unknown as FakeKV[];
        kvs.forEach(kv => kv.store.set('synthetic-private', 'W0401_PRIVATE_STORE'));
        const before = kvs.map(kv => [...kv.store]);
        const calls = kvs.flatMap(kv => ['get', 'put', 'delete', 'list'].map(method => vi.spyOn(kv, method as 'get')));
        objectCalls.length = 0;
        const r = await ownedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000006', accountId: 'acct-proof', ...proof } });
        expect(r.status).toBe(401); expect(r.headers.has('set-cookie')).toBe(false);
        expect(calls.every(spy => spy.mock.calls.length === 0)).toBe(true);
        expect(kvs.map(kv => [...kv.store])).toEqual(before); expect(objectCalls).toEqual([]);
        calls.forEach(spy => spy.mockRestore());
      }
      env = mkEnv({ REFLEX_HOST: host, DEPLOYMENT_PROFILE: 'demo', IDENTITY_SECRETS: 'coach:s3cret' });
      const actual = destinations();
      objectCalls.length = 0;
      const r = await ownedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000006', accountId: 'acct-proof', exp, assertion: signed } });
      expect(r.status).toBe(200); expect(r.body.assurance).toBe('signed');
      expect((env.SESSIONS as unknown as FakeKV).store.size).toBeGreaterThan(0);
      expect(actual.calls.some(value => value.startsWith('object:'))).toBe(true);
      if (host === 'do') {
        // This is now the actual receipt/grant protocol, not three permissive
        // export/absorb/forward stubs returning invented private audiences.
        expect(r.body.session).toMatchObject({ kind: 'recognized', subject: r.body.shopperId });
        expect(r.body.audiences).toEqual([]);
        expect(r.headers.has('set-cookie')).toBe(false);
      } else expect(r.headers.has('set-cookie')).toBe(true);
    }
  });

  it('uses freshly signed new-visitor proof through the actual SDK/router and retries only once', async () => {
    destinations();
    let sequence = 0;
    const requests: Array<{ path: string; status: number; visitorId: string; assertion?: string }> = [];
    const host = memoryHost({ acquireAuthorityLock: authorityLocks(), uuid: () => `w0401-varying-uuid-${++sequence}`,
      location: { protocol: 'https:', host: 'synthetic.invalid', hostname: 'synthetic.invalid', href: 'https://synthetic.invalid/', search: '' },
      fetch: async (url, init) => {
        const path = new URL(url).pathname.replace(/^\/v1/, '');
        const body = JSON.parse(String(init?.body));
        // Raw transport: do not add or replace the SDK's proof.
        const app = new Hono().use('*', tenantMiddleware()).route('/v1', identityRoutes);
        const r = await app.request('/v1' + path, { method: 'POST', headers: init?.headers, body: String(init?.body) }, env);
        requests.push({ path, status: r.status, visitorId: body.visitorId, assertion: body.assertion });
        return { ok: r.ok, status: r.status, json: () => r.json() };
      },
    });
    const boot = await call('/coach/identity/session', { method: 'POST', json: {} });
    expect(boot.status).toBe(200);
    const anonymous = boot.body.session, exp = Math.floor(Date.now() / 1000) + 120;
    const signed = await call('/coach/identity/link', { method: 'POST', headers: { [SHOPPER_HEADER]: anonymous.capability },
      json: { visitorId: anonymous.subject, accountId: 'prior-account', exp, assertion: await signAssertion('s3cret', 'coach', anonymous.subject, 'prior-account', exp) } });
    expect(signed.status).toBe(200);
    const prior = signed.body.session, old = prior.subject;
    host.storage.set('opt_shopper_session:https%3A%2F%2Fsynthetic.invalid:coach', prior.capability);
    host.storage.set('opt_visitor_id', 'untrusted-old-cookie');
    const core = createCore({ tenant: 'coach' }, host), identity = createIdentity(core);
    const proofs: Array<{ visitorId: string; assertion: string }> = [];
    const result = await identity.identify('acct-next', { source: 'login', assertion: 'static-must-not-win', exp: 1,
      getAssertion: async ({ tenant, visitorId, accountId }) => {
        const exp = Math.floor(Date.now() / 1000) + 120;
        const assertion = await signAssertion('s3cret', tenant, visitorId, accountId, exp);
        proofs.push({ visitorId, assertion }); return { exp, assertion };
      },
    });
    expect(result).toMatchObject({ ok: true, retried: true });
    expect(requests.map(r => r.status)).toEqual([200, 409, 200, 200]);
    expect(proofs).toHaveLength(2); expect(proofs[0]!.visitorId).toBe(old);
    expect(proofs[1]!.visitorId).not.toBe(old); expect(proofs[1]!.visitorId).toMatch(/^vis-/);
    expect(requests.filter(r => r.path.endsWith('/link')).map(r => ({ visitorId: r.visitorId, assertion: r.assertion }))).toEqual(proofs);
    const person = await new SessionManager(env).getSessionByUserId(core.visitorId);
    expect(person?.identity?.shopperId).toBe(core.visitorId);
    expect(core.visitorId).toBe(await shopperIdFor(env, 'coach', 'acct-next'));
  });
});

describe('detach', () => {
  it('clears the cookies and deletes nothing', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby']);
    const linked = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    const r = await call('/coach/identity/detach', { method: 'POST', headers: { [SHOPPER_HEADER]: linked.body.session.capability } });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain('opt_session_id=; Max-Age=0');
    const sm = new SessionManager(env);
    expect((await sm.getSessionByUserId(linked.body.shopperId))?.userId).toBe(linked.body.shopperId);
  });
});

describe('the data team’s doors', () => {
  it('resolve, visitor and shopper want the operator token', async () => {
    expect((await call('/coach/identity/resolve', { method: 'POST', json: { accountIds: ['a'] } })).status).toBe(401);
    expect((await call('/coach/identity/visitor/vis-00000000-0000-4000-8000-000000000005')).status).toBe(401);
    expect((await call('/coach/identity/shopper/sh_' + 'a'.repeat(32))).status).toBe(401);
    expect((await call('/coach/identity/events', { method: 'POST', json: { rows: [] } })).status).toBe(401);
  });

  it('resolve gives the warehouse its join key', async () => {
    const r = await call('/coach/identity/resolve', { method: 'POST', headers: auth, json: { accountIds: ['acct-1001', 'acct-2002'] } });
    expect(r.status).toBe(200);
    expect(r.body.resolved['acct-1001']).toBe(await shopperIdFor(env, 'coach', 'acct-1001'));
    expect(r.body.salted).toBe(false);
  });

  it('visitor and shopper lookups show the link from both ends', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby']);
    const linked = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    const v = await call('/coach/identity/visitor/vis-00000000-0000-4000-8000-000000000001', { headers: auth });
    expect(v.body.shopperId).toBe(linked.body.shopperId);
    expect(v.body.link.source).toBe('login');
    const s = await call(`/coach/identity/shopper/${linked.body.shopperId}`, { headers: auth });
    expect(s.body.shopper.visitors.map((x: { visitorId: string }) => x.visitorId)).toEqual(['vis-00000000-0000-4000-8000-000000000001']);
    expect(JSON.stringify(s.body)).not.toContain('acct-1001');
    expect((await call('/coach/identity/visitor/vis-nobody', { headers: auth })).body.shopperId).toBeNull();
    expect((await call('/coach/identity/shopper/sh_' + 'e'.repeat(32), { headers: auth })).status).toBe(404);
  });
});

describe('historical rows', () => {
  it('JSON rows by account id enrich an existing consenting person, discounted by their age', async () => {
    await seedHistorySession('coach', await shopperIdFor(env, 'coach', 'acct-1001'));
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const r = await call('/coach/identity/events', { method: 'POST', headers: auth, json: { rows: [
      { accountId: 'acct-1001', action: 'purchase', at: dayAgo, product: { line: 'Brooklyn', category: 'Bags' } },
      { accountId: 'acct-1001', action: 'purchase', at: Date.now() - 60_000, product: { line: 'Brooklyn' } },
      { accountId: 'acct-1001', action: 'purchase', at: Date.now() - 30_000, product: { line: 'Brooklyn' } },
      { accountId: 'acct-1001', action: 'page_view', at: dayAgo, product: { line: 'Tabby' } },       // no weight
      { accountId: 'acct-1001', action: 'purchase', at: dayAgo, product: { sku: 'x' } },            // nothing the registry reads
    ] } });
    expect(r.status).toBe(200);
    expect(r.body.received).toBe(5);
    expect(r.body.applied).toBe(3);
    expect(r.body.skipped.map((s: { index: number }) => s.index)).toEqual([3, 4]);
    expect(r.body.shoppers).toBe(1);
    const sh = await shopperIdFor(env, 'coach', 'acct-1001');
    expect(r.body.perShopper[0]).toMatchObject({ shopperId: sh, rows: 3, created: false });
    const sm = new SessionManager(env);
    const person = await sm.getSessionByUserId(sh);
    const snap = snapshot(person!.reflex!, Date.now(), cfg);
    // Two purchases a minute ago at weight 5 are plenty; the day-old one is dust.
    expect(snap.dims.line.Brooklyn).toBeGreaterThanOrEqual(cfg.thetaIn);
    expect(person!.metadata.visitCount).toBeUndefined();
    const rec = await call(`/coach/identity/shopper/${sh}`, { headers: auth });
    expect(rec.body.shopper.history.rows).toBe(3);

    // Then she signs in on her phone: the browser folds into the enriched person.
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby']);
    const linked = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    expect(linked.body.audiences).toContain(audienceKey('line', 'Brooklyn'));
  });

  it('CSV rows, the way a warehouse exports them', async () => {
    for (const account of ['acct-1001', 'acct-2002']) await seedHistorySession('coach', await shopperIdFor(env, 'coach', account));
    const csv = [
      'account_id,action,at,line,price_usd',
      `acct-1001,purchase,${Math.floor(Date.now() / 1000) - 10},"Tabby",395`,
      `acct-1001,add_to_cart,${Math.floor(Date.now() / 1000) - 5},Tabby,395`,
      `acct-2002,purchase,${new Date(Date.now() - 5000).toISOString()},Rogue,795`,
    ].join('\n');
    const r = await call('/coach/identity/events', { method: 'POST', headers: { ...auth, 'Content-Type': 'text/csv' }, body: csv });
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(3);
    expect(r.body.shoppers).toBe(2);
    const sm = new SessionManager(env);
    const one = await sm.getSessionByUserId(await shopperIdFor(env, 'coach', 'acct-1001'));
    const snap = snapshot(one!.reflex!, Date.now(), cfg);
    expect(snap.dims.line.Tabby).toBeGreaterThanOrEqual(cfg.thetaIn);
    expect(snap.dims.priceBand?.core).toBeGreaterThan(0); // 395 falls in the core band: derived dimensions work on imports too
  });

  it('rows by visitor id land on the person when the browser was linked, on the browser when not', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby']);
    const linked = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    await seedHistorySession('coach', 'vis-stranger');
    const r = await call('/coach/identity/events', { method: 'POST', headers: auth, json: { rows: [
      { visitorId: 'vis-00000000-0000-4000-8000-000000000001', action: 'purchase', at: Date.now() - 1000, product: { line: 'Rogue' } },
      { visitorId: 'vis-stranger', action: 'purchase', at: Date.now() - 1000, product: { line: 'Rogue' } },
    ] } });
    expect(r.body.perShopper.map((p: { shopperId: string }) => p.shopperId).sort()).toEqual([linked.body.shopperId, 'vis-stranger'].sort());
  });

  it('rejects a malformed row, an empty batch, and too many rows', async () => {
    expect((await call('/coach/identity/events', { method: 'POST', headers: auth, json: { rows: [{ action: 'purchase', at: 1 }] } })).status).toBe(400);
    expect((await call('/coach/identity/events', { method: 'POST', headers: auth, json: { rows: [] } })).status).toBe(400);
    const many = Array.from({ length: 1001 }, () => ({ accountId: 'a', action: 'purchase', at: 1 }));
    expect((await call('/coach/identity/events', { method: 'POST', headers: auth, json: { rows: many } })).status).toBe(413);
  });
});

  function destinations() {
    const calls: string[] = [];
    const fail = { object: false, ring: false, relay: false };
    function namespace(kind: 'object' | 'ring' | 'relay') {
      const items = new Map<string, { data: Map<string, unknown>; object: { fetch(request: Request): Promise<Response> }; state: DurableObjectState; writes: string[] }>();
      function open(name: string) {
        let item = items.get(name);
        if (!item) {
          const data = new Map<string, unknown>(), writes: string[] = [];
          const state = { id: name, getWebSockets: () => [], blockConcurrencyWhile: (run: () => Promise<unknown>) => run(), waitUntil: (p: Promise<unknown>) => p, storage: {
            get: async (key: string | string[]) => Array.isArray(key) ? new Map(key.map(k => [k, data.get(k)])) : data.get(key),
            put: async (key: string | Record<string, unknown>, value?: unknown) => {
              writes.push(typeof key === 'string' ? 'put:' + key : 'put:profile');
              if (typeof key === 'string') data.set(key, value); else for (const [k, v] of Object.entries(key)) data.set(k, v);
            }, delete: async (key: string) => data.delete(key), deleteAll: async () => { writes.push('deleteAll'); data.clear(); },
            list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) => structuredClone(new Map([...data]
              .filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
              .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
            transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
              const candidate = structuredClone(data);
              const result = await run({ list: async () => structuredClone(candidate),
                delete: async (keys: string[]) => { for (const key of keys) candidate.delete(key); return keys.length; },
                put: async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) candidate.set(key, structuredClone(value)); },
                deleteAlarm: async () => undefined,
                setAlarm: async () => undefined,
              } as unknown as DurableObjectTransaction);
              data.clear(); for (const [key, value] of candidate) data.set(key, value); writes.push('erase-transaction'); return result;
            },
            getAlarm: async () => null, setAlarm: async () => { writes.push('alarm'); },
          } } as unknown as DurableObjectState;
          item = { data, state, writes, object: kind === 'object' ? new ShopperReflex(state, env) : kind === 'ring' ? new DecisionRing(state, env) : new PersonalizationWebSocket(state, env) }; items.set(name, item);
        }
        return item;
      }
      const ns = { idFromName: (n: string) => n, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(kind + ':' + name);
        if (fail[kind]) return Response.json({ ok: true }); // Deliberately incomplete ring acknowledgment; object failure uses HTTP error.
        return open(name).object.fetch(new Request(input, init));
      } }) } as unknown as DurableObjectNamespace;
      return { ns, open, items };
    }
    const object = namespace('object'), ring = namespace('ring'), relay = namespace('relay');
    env.SHOPPER_REFLEX = object.ns; env.DECISION_RING = ring.ns; env.PERSONALIZATION_WEBSOCKET = relay.ns;
    return { object, ring, relay, calls, fail };
  }
describe('W06.01 durable local erasure retry', () => {
  async function configureHistory(tenant: string) {
    env.TENANTS = JSON.stringify({ provisioned: [...new Set([...tenantConfig(env).provisioned, tenant])] });
    env.RETENTION = JSON.stringify({ version: 1, tenants: Object.fromEntries(tenantConfig(env).provisioned.map(selected => [selected,
      Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, { id: 'fixture-' + category, revision: 1,
        durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' }]))])) });
    expect((await writeReflexConfig(env, reflexScopeForTenant(tenant), cfg, { actor: 'w0509-synthetic' })).ok).toBe(true);
  }
  async function seedHistoryTarget(d: ReturnType<typeof destinations>, tenant: string, subject: string, sid = 's-history-' + subject) {
    const item = d.object.open(shopperObjectName(tenant, subject)), now = Date.now();
    await registerSession(d, tenant, subject, sid);
    item.data.set('consent', { version: 1, tenant, subject, revision: 'history-explicit-choice',
      tracking: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS },
      personalization: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } });
    if (env.REFLEX_HOST !== 'do') {
      const kv = env.SESSIONS as unknown as FakeKV;
      kv.store.set(tenantKey(tenant, 'session:' + sid), JSON.stringify({ ...historyProfile(subject), retention: retentionBirth(env, tenant, 'profile', now, now), externalRetention: {} }));
      kv.store.set(tenantKey(tenant, 'user:' + subject), sid);
    }
    else {
      item.data.set('affinity', { shopperId: subject, reflex: emptyState(cfg), odpSeed: [], odpSeedAt: 0, odpRecentEvents: [], lastSeen: 0, configVersion: cfg.version,
        retention: retentionBirth(env, tenant, 'profile', now, now), externalRetention: {} });
      item.data.set('pipeline', { attributes: {}, segments: [], journeyStage: 'early', sessionId: sid, visitorId: subject, firstSeen: now, sessionCount: 0 });
    }
    item.object = new ShopperReflex(item.state, env);
    return sid;
  }
  async function freshHistoryLink(tenant: string, visitorId: string, shopperId: string) {
    const store = new IdentityStore(env.SESSIONS as never, tenant), now = Date.now();
    const result = await store.link({ visitorId, shopperId, source: 'login', assurance: 'signed', salted: false, now });
    await store.publish({ ...result.link, retention: retentionBirth(env, tenant, 'identity', now, now) },
      { ...result.shopper, retention: result.shopper.retention ?? retentionBirth(env, tenant, 'identity', now, now) });
  }
  it('W05.09 requires existing explicit stored consent before historical effects on both hosts', async () => {
    const subject = 'sh_' + '9'.repeat(32), tenant = 'meridian';
    const modes = ['both', 'tracking-only', 'personalization-only', 'neither', 'cold', 'missing-profile', 'missing-consent', 'missing-switch',
      'malformed-consent', 'malformed-profile', 'malformed-reflex', 'wrong-owner', 'missing-identity', 'forward', 'falsy-forward', 'null-state', 'falsy-state', 'undefined-read', 'read-error'];
    for (const host of ['session', 'do']) for (const mode of modes) {
      env = mkEnv({ REFLEX_HOST: host }); const d = destinations(); await configureHistory(tenant);
      const sid = mode === 'cold' ? 's-history-' + subject : await seedHistoryTarget(d, tenant, subject);
      const kv = env.SESSIONS as unknown as FakeKV, key = tenantKey(tenant, 'session:' + sid), userKey = tenantKey(tenant, 'user:' + subject);
      const item = d.object.open(shopperObjectName(tenant, subject));
      const tracking = mode !== 'personalization-only' && mode !== 'neither', personalization = mode !== 'tracking-only' && mode !== 'neither';
      if (mode !== 'cold') {
        if (host === 'session') {
          const raw = JSON.parse(kv.store.get(key)!) as SessionData;
          raw.preferences.trackingConsent = tracking; raw.preferences.personalizationEnabled = personalization;
          if (mode === 'missing-consent') delete (raw as Partial<SessionData>).preferences;
          if (mode === 'missing-switch') delete (raw.preferences as Partial<SessionData['preferences']>).personalizationEnabled;
          if (mode === 'malformed-consent') raw.preferences.trackingConsent = 'true' as never;
          if (mode === 'malformed-profile') raw.attributes = [] as never;
          if (mode === 'malformed-reflex') raw.reflex = { v: 0, dims: {} } as never;
          if (mode === 'wrong-owner') raw.userId = 'vis-another';
          if (mode === 'missing-identity') delete raw.identity;
          if (mode === 'forward') raw.forwardTo = 's-another';
          if (mode === 'falsy-forward') raw.forwardTo = false as never;
          kv.store.set(key, JSON.stringify(raw));
          if (mode === 'null-state' || mode === 'falsy-state') kv.store.set(key, mode === 'null-state' ? 'null' : 'false');
          if (mode === 'missing-profile') kv.store.delete(key);
          if (mode === 'undefined-read') vi.spyOn(kv, 'get').mockImplementation(async k => k === userKey ? undefined as never : null);
          if (mode === 'read-error') vi.spyOn(kv, 'get').mockRejectedValue(new Error('synthetic read failure'));
        } else {
          const instruction = item.data.get('consent') as { tracking: { value: boolean }; personalization: { value: boolean } };
          instruction.tracking.value = tracking; instruction.personalization.value = personalization;
          if (mode === 'missing-profile') { item.data.delete('affinity'); item.data.delete('pipeline'); }
          if (mode === 'missing-consent') item.data.delete('consent');
          if (mode === 'missing-switch') delete (instruction as Partial<typeof instruction>).personalization;
          if (mode === 'malformed-consent') item.data.set('consent', { tracking: 'true', personalization: true });
          if (mode === 'malformed-profile') item.data.set('pipeline', { ...(item.data.get('pipeline') as object), attributes: [] });
          if (mode === 'malformed-reflex') item.data.set('affinity', { ...(item.data.get('affinity') as object), reflex: { v: 0, dims: {} } });
          if (mode === 'wrong-owner') item.data.set('affinity', { ...(item.data.get('affinity') as object), shopperId: 'vis-another' });
          if (mode === 'missing-identity') item.data.set('pipeline', { ...(item.data.get('pipeline') as object), sessionId: undefined });
          if (mode === 'forward') item.data.set('forwardTo', shopperObjectName(tenant, 'vis-another'));
          if (mode === 'falsy-forward') item.data.set('forwardTo', false);
          if (mode === 'null-state' || mode === 'falsy-state') { item.data.set('affinity', mode === 'null-state' ? null : false); item.data.set('pipeline', mode === 'null-state' ? null : false); }
          if (mode === 'undefined-read') vi.spyOn(item.state.storage, 'get').mockResolvedValue(undefined as never);
          if (mode === 'read-error') vi.spyOn(item.state.storage, 'get').mockRejectedValue(new Error('synthetic read failure'));
        }
      }
      const before = [...kv.store], objectBefore = structuredClone([...item.data]), puts = vi.spyOn(kv, 'put'), ownerPuts = vi.spyOn(item.state.storage, 'put');
      const rows = [historyRowSchema.parse({ shopperId: subject, action: 'purchase', at: Date.now() - 1000, product: { line: 'Tabby' }, consent: { tracking: true, personalization: true } })];
      const terminal = ['malformed-consent', 'malformed-profile', 'malformed-reflex', 'wrong-owner', 'missing-identity', 'forward', 'falsy-forward', 'null-state', 'falsy-state', 'undefined-read', 'read-error'].includes(mode);
      if (terminal) await expect(applyHistory(env, tenant, rows), host + ':' + mode).rejects.toThrow();
      else {
        const response = await call('/' + tenant + '/identity/events', { method: 'POST', headers: auth, json: { rows, consent: { tracking: true, personalization: true } } });
        expect(response.status, host + ':' + mode).toBe(200);
        expect(response.body).toMatchObject({ received: 1, applied: mode === 'both' ? 1 : 0, shoppers: mode === 'both' ? 1 : 0 });
        if (mode !== 'both') {
          expect(response.body.perShopper).toEqual([]);
          expect(response.body.skipped).toEqual([{ index: 0, reason: mode === 'cold' || mode === 'missing-profile' ? 'profile_missing'
            : mode === 'missing-consent' || (mode === 'missing-switch' && host === 'session') ? 'consent_missing' : 'consent_refused' }]);
        }
      }
      if (mode !== 'both') {
        expect([...kv.store], host + ':' + mode).toEqual(before); expect(puts).not.toHaveBeenCalled();
        expect([...item.data]).toEqual(objectBefore); expect(item.writes).toEqual([]);
        expect((item.object as unknown as { audienceOwner: unknown }).audienceOwner).toBeUndefined();
      } else {
        expect(puts.mock.calls.filter(([k]) => k === userKey).map(([, value]) => value)).toEqual(host === 'session' ? [sid] : []);
        // Owner preparation, the atomic history fold and (session host only)
        // compatibility projection are distinct commits in the W04 protocol.
        expect(item.writes.filter(w => w === 'put:profile')).toHaveLength(host === 'session' ? 3 : 2);
        expect(ownerPuts.mock.calls.filter(([value]) => value && typeof value === 'object'
          && Object.hasOwn(value, 'affinity') && Object.keys(value).some(key => key.startsWith('identityImport:')))).toHaveLength(1);
        expect(item.writes.some(w => w.startsWith('put:identityImport:'))).toBe(true);
      }
      vi.restoreAllMocks();
    }
    env = mkEnv({ REFLEX_HOST: 'do' }); const d = destinations(); await configureHistory(tenant);
    const sid = await seedHistoryTarget(d, tenant, subject), item = d.object.open(shopperObjectName(tenant, subject));
    const grant = await issueSessionCapability(env, { tenant, subject, sessionId: sid, kind: 'recognized' });
    const request = new Request('https://shopper-reflex/identity/import', { method: 'POST', headers: { [SHOPPER_HEADER]: grant.capability, 'X-Tenant': tenant }, body: 'not JSON' });
    const parse = vi.spyOn(request, 'json'), before = structuredClone([...item.data]);
    expect((await item.object.fetch(request)).status).toBe(401); expect(parse).not.toHaveBeenCalled();
    expect([...item.data]).toEqual(before); expect(item.writes).toEqual([]);
  });

  it('W05.09 resolves consistent tenant subjects and preserves allowed historical arithmetic', async () => {
    for (const host of ['session', 'do']) {
      env = mkEnv({ REFLEX_HOST: host }); const d = destinations(), now = Date.now();
      for (const tenant of ['meridian', 'harbor']) {
        await configureHistory(tenant);
        const subject = await shopperIdFor(env, tenant, 'w0509-account'), visitor = 'vis-w0509-linked';
        const sid = await seedHistoryTarget(d, tenant, subject), anonymous = 'vis-00000000-0000-4000-8000-000000005009';
        await seedHistoryTarget(d, tenant, anonymous);
        await freshHistoryLink(tenant, visitor, subject);
        const kv = env.SESSIONS as unknown as FakeKV, profileKey = tenantKey(tenant, 'session:' + sid);
        const item = d.object.open(shopperObjectName(tenant, subject));
        const before = host === 'do' ? structuredClone(item.data.get('pipeline')) : JSON.parse(kv.store.get(profileKey)!) as SessionData;
        const rows = [
          { accountId: 'w0509-account', shopperId: subject, visitorId: visitor, action: 'purchase', at: now - 2000, product: { line: 'Tabby' } },
          { visitorId: visitor, action: 'purchase', at: now - 1000, product: { line: 'Tabby' } },
          { visitorId: anonymous, action: 'purchase', at: now - 1000, product: { line: 'Rogue' } },
          { visitorId: 'vis-w0509-unknown', action: 'purchase', at: now - 1000, product: { line: 'Brooklyn' } },
          { accountId: 'w0509-account', shopperId: 'sh_' + '8'.repeat(32), action: 'purchase', at: now - 1000, product: { line: 'Willow' } },
        ].map(r => historyRowSchema.parse(r));
        const report = await applyHistory(env, tenant, rows, now);
        expect(report).toMatchObject({ received: 5, applied: 3, shoppers: 2, skipped: [{ index: 3, reason: 'profile_missing' }, { index: 4, reason: 'identity selectors disagree' }] });
        expect(report.perShopper.every(p => p.created === false)).toBe(true);
        const state = host === 'do' ? (item.data.get('affinity') as { reflex: ReflexState }).reflex
          : (await new SessionManager(env, { tenant }).readRaw(sid, true))!.reflex!;
        expect(state.dims.line.Tabby.t).toBe(now - 1000);
        expect(state.dims.line.Tabby.s).toBeCloseTo(5 + 5 * Math.exp(-1000 / cfg.tauMs), 10);
        const current = host === 'do' ? item.data.get('pipeline') : await new SessionManager(env, { tenant }).readRaw(sid, true);
        if (host === 'do') expect(current).toMatchObject({ ...(before as object), segments: expect.any(Array) });
        else expect((current as SessionData).metadata).toEqual({ ...(before as SessionData).metadata, lastSegmentUpdate: now, journeyStage: 'early' });
        expect((await new IdentityStore(env.SESSIONS as never, tenant).shopper(subject))?.history).toMatchObject({ rows: 2, latestAt: now - 1000 });

        const linkKey = tenantKey(tenant, 'identity:visitor:' + visitor), original = kv.store.get(linkKey)!;
        for (const bad of ['undefined', 'broken-json', 'null', 'wrong-visitor', 'bad-target', 'read-error']) {
          if (bad === 'broken-json') kv.store.set(linkKey, '{');
          else if (bad === 'null') kv.store.set(linkKey, 'null');
          else if (bad === 'wrong-visitor') kv.store.set(linkKey, JSON.stringify({ visitorId: 'vis-other', shopperId: subject }));
          else if (bad === 'bad-target') kv.store.set(linkKey, JSON.stringify({ visitorId: visitor, shopperId: 'not-canonical' }));
          const get = kv.get.bind(kv);
          if (bad === 'undefined' || bad === 'read-error') vi.spyOn(kv, 'get').mockImplementation(async (key, type) => {
            if (key === linkKey) { if (bad === 'read-error') throw new Error('synthetic link read failure'); return undefined as never; }
            return get(key, type);
          });
          const stored = [...kv.store], object = structuredClone([...item.data]), writes = [...item.writes], put = vi.spyOn(kv, 'put');
          await expect(applyHistory(env, tenant, [rows[1]], now)).rejects.toThrow();
          expect([...kv.store]).toEqual(stored); expect(put).not.toHaveBeenCalled(); expect([...item.data]).toEqual(object); expect(item.writes).toEqual(writes);
          vi.restoreAllMocks(); kv.store.set(linkKey, original);
        }
      }
      expect(await shopperIdFor(env, 'meridian', 'w0509-account')).not.toBe(await shopperIdFor(env, 'harbor', 'w0509-account'));
    }
  });

  it('W05.09 reads current import state and preserves erasure and acknowledgment barriers', async () => {
    const tenant = 'meridian', subject = 'sh_' + '7'.repeat(32), at = Date.now();
    for (const refusal of [false, true]) {
      env = mkEnv(); const d = destinations(); await configureHistory(tenant);
      const sid = await seedHistoryTarget(d, tenant, subject), kv = env.SESSIONS as unknown as FakeKV, key = tenantKey(tenant, 'session:' + sid);
      // The import now enters the durable owner, not SessionManager.applyImport.
      // Pause at its actual initial raw witness read, before preparation/adoption.
      const get = kv.get.bind(kv); let changed = false;
      vi.spyOn(kv, 'get').mockImplementation(async (requested, type) => {
        if (requested === key && !changed) {
          changed = true;
          const latest = JSON.parse(kv.store.get(key)!) as SessionData;
          latest.reflex = browse(['Rogue'], at); latest.preferences.trackingConsent = !refusal;
          kv.store.set(key, JSON.stringify(latest));
        }
        return get(requested, type);
      });
      const put = vi.spyOn(kv, 'put'), rows = [historyRowSchema.parse({ shopperId: subject, action: 'purchase', at, product: { line: 'Tabby' } })];
      const result = await applyHistory(env, tenant, rows, at);
      expect(changed).toBe(true);
      expect(result.applied).toBe(refusal ? 0 : 1);
      const stored = JSON.parse(kv.store.get(key)!) as SessionData;
      expect(stored.reflex?.dims.line.Rogue.s).toBe(1);
      if (refusal) { expect(stored.reflex?.dims.line.Tabby).toBeUndefined(); expect(put).not.toHaveBeenCalled(); }
      else expect(stored.reflex?.dims.line.Tabby.s).toBe(5);
      vi.restoreAllMocks();
    }
    env = mkEnv({ REFLEX_HOST: 'do' }); const d = destinations(); await configureHistory(tenant);
    await seedHistoryTarget(d, tenant, subject); const item = d.object.open(shopperObjectName(tenant, subject));
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const request = new Request('https://shopper-reflex/consent/refusal', { method: 'POST', headers: { 'X-Reflex-Tenant': tenant, 'X-Reflex-Subject': subject }, body: '{}' });
    vi.spyOn(request, 'json').mockImplementation(async () => { enter(); await gate; return { tracking: false, personalization: false }; });
    const withdrawal = item.object.fetch(request); await entered;
    const imported = applyHistory(env, tenant, [historyRowSchema.parse({ shopperId: subject, action: 'purchase', at, product: { line: 'Tabby' } })], at);
    release(); expect((await withdrawal).status).toBe(200);
    expect(await imported).toMatchObject({ applied: 0, shoppers: 0, skipped: [{ index: 0, reason: 'consent_refused' }] });
    expect(item.writes.filter(w => w !== 'alarm')).toEqual(['put:consent']);
    expect((item.data.get('affinity') as { reflex: ReflexState }).reflex.dims).toEqual({});
    expect(item.data.has('audienceOwner')).toBe(false);
    item.object = new ShopperReflex(item.state, env);
    expect((await applyHistory(env, tenant, [historyRowSchema.parse({ shopperId: subject, action: 'purchase', at, product: { line: 'Tabby' } })], at)).applied).toBe(0);
    expect(item.writes.filter(w => w !== 'alarm')).toEqual(['put:consent']);
    vi.restoreAllMocks();
    for (const host of ['session', 'do']) {
      env = mkEnv({ REFLEX_HOST: host }); const current = destinations(); await configureHistory(tenant);
      const f = await currentSeed(current); await seedHistoryTarget(current, tenant, f.sh, f.sid);
      const erased = await erase(f); expect(erased.status).toBe(200);
      const kv = env.SESSIONS as unknown as FakeKV, before = [...kv.store], owned = current.object.open(shopperObjectName(tenant, f.sh));
      const bytes = structuredClone([...owned.data]), writes = [...owned.writes];
      const result = await applyHistory(env, tenant, [historyRowSchema.parse({ shopperId: f.sh, action: 'purchase', at: erased.body.at + 1, product: { line: 'Tabby' } })]);
      expect(result).toMatchObject({ applied: 0, shoppers: 0, skipped: [{ index: 0, reason: 'profile_missing' }] });
      expect([...kv.store]).toEqual(before); expect([...owned.data]).toEqual(bytes); expect(owned.writes).toEqual(writes);
    }
  });
  async function seed(tenant = 'meridian', count = 2, currentSubjects = false) {
    const kv = env.SESSIONS as unknown as FakeKV, store = new IdentityStore(kv, tenant);
    const sh = await shopperIdFor(env, tenant, 'w0601-synthetic-account'), sid = 's-person-' + tenant;
    // Historical erasure fixture, deliberately not a consent-granting live write.
    kv.store.set(tenantKey(tenant, 'session:' + sid), JSON.stringify({ ...historyProfile(sh), identity: { shopperId: sh, linkedAt: 1 }, attributes: { product_views: 9 } }));
    kv.store.set(tenantKey(tenant, 'user:' + sh), sid);
    const visitors = Array.from({ length: count }, (_, i) => currentSubjects
      ? 'vis-00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0') : 'vis-retry-' + i);
    const own = visitors.map((_, i) => 's-own-' + tenant + '-' + i);
    for (const [i, visitorId] of visitors.entries()) {
      kv.store.set(tenantKey(tenant, 'session:' + own[i]), JSON.stringify({ ...historyProfile(visitorId), attributes: { product_views: i + 1 } }));
      const key = tenantKey(tenant, 'session:' + own[i]);
      kv.store.set(key, JSON.stringify({ ...JSON.parse(kv.store.get(key)!), forwardTo: sid }));
      kv.store.set(tenantKey(tenant, 'user:' + visitorId), sid);
      await store.link({ visitorId, shopperId: sh, assurance: 'signed', source: 'login', salted: true });
      await store.noteOwnSession(visitorId, own[i]);
    }
    return { tenant, sh, sid, visitors, own, selector: { visitorId: visitors[0] }, ids: [sh, ...visitors] };
  }
  async function registerSession(d: ReturnType<typeof destinations>, tenant: string, subject: string, sessionId: string) {
    const issued = await issueSessionCapability(env, { tenant, subject, sessionId, kind: isShopperId(subject) ? 'recognized' : 'anonymous' });
    const grant = await verifySessionCapability(env, issued.capability, tenant);
    // Synthetic persisted authority, still parsed and enforced by the actual
    // object class erasure protocol with synthetic storage, not native workerd.
    d.object.open(shopperObjectName(tenant, subject)).data.set('grantAuthority',
      { version: 1, epoch: grant.authorityEpoch, grants: { [grant.grantId!]: grant } });
    return grant;
  }
  async function currentSeed(d: ReturnType<typeof destinations>, tenant = 'meridian', count = 2) {
    const f = await seed(tenant, count, true);
    await registerSession(d, tenant, f.sh, f.sid);
    for (const [i, visitor] of f.visitors.entries()) await registerSession(d, tenant, visitor, f.own[i]!);
    return f;
  }

  it('W03.07 retains unregistered legacy erasure refusal instead of inventing SID authority', async () => {
    env = mkEnv(); const d = destinations(), legacy = await seed();
    const kv = env.SESSIONS as unknown as FakeKV, before = [...kv.store], del = vi.spyOn(kv, 'delete');
    const result = await erase(legacy);
    expect(result.status).toBe(503); expect([...kv.store]).toEqual(before); expect(del).not.toHaveBeenCalled();
    expect(d.calls.some(call => call.startsWith('ring:'))).toBe(false);
    expect(JSON.parse((env.STORAGE as unknown as FakeR2).store.get(await erasureJobKey(legacy.tenant, legacy.selector))!).state).toBe('pending');
  });
  const erase = (fixture: Awaited<ReturnType<typeof seed>>, headers = auth) => call('/' + fixture.tenant + '/identity/erase', { method: 'POST', headers, json: fixture.selector });
  const pendingPlan = (record: Record<string, any>) => [3, 4, 5, 6, 7].includes(record.version) && record.state === 'pending' ? record.base : record;
  async function prepareLegacy(f: Awaited<ReturnType<typeof seed>>, version: 2 | 3 | 5 | 6 = 3) {
    const bucket = env.STORAGE as unknown as FakeR2, key = await erasureJobKey(f.tenant, f.selector), put = bucket.put.bind(bucket);
    const capture = vi.spyOn(bucket, 'put').mockImplementation(async (k, body, options) => {
      if (k === key) {
        const parsed = JSON.parse(body), legacy = version === 2 ? parsed.base : parsed;
        legacy.version = version;
        for (const field of ['destinations', 'historicalCompleted', 'historicalStep']) delete legacy[field];
        if (version !== 6) for (const session of (legacy.base ?? legacy).sessions) delete session.serialized;
        if (version === 3) for (const field of ['sessionScan', 'nextSessionPage', 'sessionCleanupCursor', 'sessionSteps', 'sessionCompacting', 'sources']) delete legacy[field];
        await put(k, JSON.stringify(legacy), options);
        throw new Error('synthetic exact legacy fixture capture');
      }
      return put(k, body, options);
    });
    expect((await erase(f)).status).toBe(503);
    capture.mockRestore();
    expect(JSON.parse(bucket.store.get(key)!)).toMatchObject(version === 2 ? { version, next: 0 } : { version, base: { next: 0 } });
  }
  function clean(f: Awaited<ReturnType<typeof seed>>) {
    const kv = env.SESSIONS as unknown as FakeKV;
    for (const sid of [f.sid, ...f.own]) expect(kv.store.has(tenantKey(f.tenant, 'session:' + sid))).toBe(false);
    for (const id of f.ids) expect(kv.store.has(tenantKey(f.tenant, 'user:' + id))).toBe(false);
    for (const id of f.visitors) expect(kv.store.has(tenantKey(f.tenant, 'identity:visitor:' + id))).toBe(false);
    expect(kv.store.has(tenantKey(f.tenant, 'identity:shopper:' + f.sh))).toBe(false);
  }
  function cacheSeed(f: Awaited<ReturnType<typeof seed>>, freshRead = false) {
    const cache = env.CACHE as unknown as FakeKV, keys: string[] = [];
    for (const id of f.ids) for (const key of ['profile:' + id, 'profile:user:' + id, 'profile:anon:' + id]) {
      keys.push(tenantKey(f.tenant, key));
      cache.store.set(tenantKey(f.tenant, key), JSON.stringify({ userId: id, segments: ['private-segment'], attributes: { private: true }, traits: { private: true },
        ...(freshRead ? { retention: retentionBirth(env, f.tenant, 'profile', Date.now()), externalRetention: {} } : {}) }));
    }
    for (let i = 0; i < 3; i++) {
      const key = tenantKey(f.tenant, 'override:' + f.visitors[0] + ':flag-' + i + ':variable'); keys.push(key);
      cache.store.set(key, JSON.stringify({ userId: f.visitors[0], featureKey: 'flag-' + i, variableKey: 'variable', value: 'private-value', expiresAt: Date.now() + 60_000 }));
    }
    return keys;
  }

  it('W06.12 retains exact v6 nonzero cursors and retries v4 destination publication before any local deletion', async () => {
    env = mkEnv(); const d = destinations(), f = await currentSeed(d, 'meridian', 0); f.selector = { visitorId: f.sh };
    await prepareLegacy(f, 6);
    const bucket = env.STORAGE as unknown as FakeR2, root = await erasureJobKey(f.tenant, f.selector), put = bucket.put.bind(bucket);
    const initial = JSON.parse(bucket.store.get(root)!); expect(initial.version).toBe(6); expect(initial.base.sessions[0]).toHaveProperty('serialized');
    const interrupt = vi.spyOn(bucket, 'put').mockImplementation(async (key, body, options) => {
      const result = await put(key, body, options), value = JSON.parse(body);
      if (key === root && value.version === 6 && value.base?.next > 0) throw new Error('synthetic v6 nonzero cursor acknowledgement');
      return result;
    });
    expect((await erase(f)).status).toBe(503); interrupt.mockRestore();
    const checkpoint = JSON.parse(bucket.store.get(root)!); expect(checkpoint.version).toBe(6); expect(checkpoint.base.next).toBeGreaterThan(0);
    let done = await erase(f); for (let n = 0; done.status === 202 && n < 10; n++) done = await erase(f);
    expect(done.status).toBe(200); expect(JSON.parse(bucket.store.get(root)!)).toMatchObject({ version: 6, state: 'local_complete' });
    for (const ambiguous of [false, true]) {
      env = mkEnv({ TENANTS: JSON.stringify({ provisioned: ['meridian'] }) });
      const seeded = await seed('meridian', 0); seeded.selector = { visitorId: seeded.sh };
      const configuration = { apiHost: 'https://retained-odp.invalid', publicKeyRef: 'CONNECTOR_SECRET_RETAINED', identityNamespace: 'retained', actions: {}, audiences: {}, profile: {} };
      env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { meridian: { odp: configuration } } });
      const storage = env.STORAGE as unknown as FakeR2, kv = env.SESSIONS as unknown as FakeKV, before = [...kv.store], originalPut = storage.put.bind(storage);
      const lost = vi.spyOn(storage, 'put').mockImplementation(async (key, body, options) => {
        if (key.endsWith('/destinations.json')) { if (ambiguous) await originalPut(key, body, options); throw new Error('synthetic destination acknowledgement'); }
        return originalPut(key, body, options);
      });
      const failed = await erase(seeded); expect(failed.status).toBe(503); expect([...kv.store]).toEqual(before); lost.mockRestore();
      expect(JSON.parse(storage.store.get(await erasureJobKey(seeded.tenant, seeded.selector))!).version).toBe(4);
      if (ambiguous) env.TENANT_CONNECTORS = undefined;
      let resumed = await erase(seeded); for (let n = 0; resumed.status === 202 && n < 10; n++) resumed = await erase(seeded);
      expect(resumed.status).toBe(200);
      const saved = [...storage.store].find(([key]) => key.endsWith('/destinations.json'))!;
      expect(JSON.parse(saved[1]).obligations.find((entry: { kind: string }) => entry.kind === 'odp').configuration).toEqual(configuration);
    }
  });

  it('W06.12 preserves registered-only physical discovery, bounds each source step and establishes replay barriers before acknowledgement', async () => {
    env = mkEnv(); const d = destinations(), f = await currentSeed(d, 'meridian', 0); f.selector = { visitorId: f.sh };
    const kv = env.SESSIONS as unknown as FakeKV, bucket = env.STORAGE as unknown as FakeR2;
    const target = d.object.open(shopperObjectName(f.tenant, f.sh)), sources: Array<{ subject: string; sid: string; raw: string; pointer: string }> = [];
    target.data.set('affinity', { shopperId: f.sh, reflex: emptyState(cfg), odpSeed: [], odpSeedAt: 0, odpRecentEvents: [], lastSeen: 0, configVersion: cfg.version });
    target.data.set('pipeline', { attributes: {}, segments: [], journeyStage: 'early', sessionId: f.sid, visitorId: f.sh, firstSeen: Date.now(), sessionCount: 0 });
    target.object = new ShopperReflex(target.state, env);
    for (let n = 0; n < 7; n++) {
      const subject = 'vis-' + crypto.randomUUID(), sid = 's-registered-' + n, grant = await registerSession(d, f.tenant, subject, sid);
      const source = d.object.open(shopperObjectName(f.tenant, subject));
      const intent = { version: 1, id: crypto.randomUUID(), tenant: f.tenant, visitorId: subject, sourceSessionId: sid,
        sourceEpoch: grant.authorityEpoch, shopperId: f.sh, at: Date.now(), assurance: 'signed', source: 'login', salted: true };
      const admitted = await target.object.fetch(new Request('https://owner/identity/admission', { method: 'POST',
        headers: { 'X-Reflex-Tenant': f.tenant, 'X-Reflex-Subject': f.sh }, body: JSON.stringify({ intent }) }));
      expect(admitted.status).toBe(200); expect(await admitted.json()).toMatchObject({ ok: true, registration: { intent, sequence: n + 1 } });
      source.data.set('identityIntent', intent);
      const raw = tenantKey(f.tenant, 'session:' + sid), pointer = tenantKey(f.tenant, 'user:' + subject), serialized = JSON.stringify(historyProfile(subject));
      kv.store.set(raw, serialized); kv.store.set(pointer, sid);
      source.data.set('sessionProjection:' + raw, { value: serialized, pending: false, expires: Date.now() + 60000 });
      source.data.set('sessionProjection:' + pointer, { value: sid, pending: false, expires: Date.now() + 60000 });
      source.object = new ShopperReflex(source.state, env); sources.push({ subject, sid, raw, pointer });
    }
    const unknownKey = tenantKey(f.tenant, 'session:unregistered-orphan'); kv.store.set(unknownKey, JSON.stringify(historyProfile('unproven-owner')));
    const unknown = kv.store.get(unknownKey), root = await erasureJobKey(f.tenant, f.selector);
    const ownerCalls = sources.map(source => vi.spyOn(d.object.open(shopperObjectName(f.tenant, source.subject)).object, 'fetch'));
    const rawDeletes = vi.spyOn(kv, 'delete'), barrierWrites = vi.spyOn(bucket, 'put');
    const rawKeys = new Set(sources.flatMap(source => [source.raw, source.pointer])), barrierKeys = new Set(sources.map(source => tombstoneKey(f.tenant, source.subject)));
    const physical = () => ownerCalls.reduce((n, spy) => n + spy.mock.calls.filter(([request]) => new URL(request.url).pathname === '/identity/erase/source').length, 0)
      + rawDeletes.mock.calls.filter(([key]) => rawKeys.has(key)).length + barrierWrites.mock.calls.filter(([key]) => barrierKeys.has(key)).length
      + d.calls.filter(call => sources.some(source => call === 'ring:' + f.tenant + ':' + source.subject)).length;
    const measured: number[] = [];
    const measuredErase = async () => { const before = physical(), response = await erase(f), effects = physical() - before;
      measured.push(effects); expect(effects).toBeLessThanOrEqual(ERASURE_STEP_LIMIT); expect(response.body.attempted).toBeGreaterThanOrEqual(effects); return response; };
    d.fail.ring = true;
    const failed = await measuredErase(); expect(failed.status).toBe(503);
    const pending = JSON.parse(bucket.store.get(root)!); expect(pending).toMatchObject({ version: 7, historicalStep: 3, sources: { page: { processed: 0 } } });
    expect(target.data.get('identityRegistration:' + String(1).padStart(16, '0'))).toHaveProperty('intent');
    expect([...bucket.store.keys()].some(key => key.includes('/sources/1.json'))).toBe(true);
    expect(await loadTombstone(env.STORAGE, f.tenant, sources[0]!.subject)).toMatchObject({ erased_at: failed.body.at });
    d.fail.ring = false;
    const receipts = [failed.body]; let result = await measuredErase();
    for (let n = 0; result.status === 202 && n < 20; n++) { receipts.push(result.body); result = await measuredErase(); }
    receipts.push(result.body); expect(result.status).toBe(200);
    expect(receipts.every(receipt => receipt.attempted <= ERASURE_STEP_LIMIT)).toBe(true);
    expect(receipts.some(receipt => receipt.attempted === ERASURE_STEP_LIMIT)).toBe(true);
    // Seven owner erasures + fourteen raw deletes + seven durable cutoffs +
    // eight ring attempts (one failed acknowledgement). The retry of the
    // already-established cutoff is charged by the controller but makes no put.
    expect(measured.reduce((sum, effects) => sum + effects, 0)).toBe(36);
    for (const [n, source] of sources.entries()) {
      expect(kv.store.has(source.raw)).toBe(false); expect(kv.store.has(source.pointer)).toBe(false);
      expect(await loadTombstone(env.STORAGE, f.tenant, source.subject)).toMatchObject({ erased_at: failed.body.at });
      expect(target.data.get('identityRegistration:' + String(n + 1).padStart(16, '0'))).not.toHaveProperty('intent');
      const proof = [...bucket.store].find(([key]) => key.endsWith('/sources/' + (n + 1) + '.json'));
      expect(JSON.parse(proof![1])).toMatchObject({ at: failed.body.at, physical: { subject: source.subject, cutoff: failed.body.at, entries: expect.any(Array) } });
      expect(JSON.parse(proof![1]).physical.entries).toHaveLength(2);
    }
    expect(kv.store.get(unknownKey)).toBe(unknown);
  });

  it('W07.05 W06.12 freezes later session-owner destinations from the original generation and reconciles only audited operator attestations', async () => {
    env = mkEnv(); const d = destinations(), audit = await auditedIdentityFixture(), f = await currentSeed(d, 'meridian', 0); f.selector = { visitorId: f.sh };
    const configuration = { apiHost: 'https://original-odp.invalid', publicKeyRef: 'CONNECTOR_SECRET_MERIDIAN_ODP', identityNamespace: 'original-space', actions: {}, audiences: {}, profile: {} };
    env.ENVIRONMENT = 'test';
    const telemetry = { environment: 'test', schema: 'ops-v1', analytics: { binding: 'ANALYTICS', dataset: 'original_ops', accessPolicy: 'original-access' },
      monitor: { binding: 'CACHE', namespace: 'monitor', accessPolicy: 'original-access' },
      alert: { binding: 'ALERT_WEBHOOK_URL', destination: 'original-alert', urlSha256: 'a'.repeat(64), accessPolicy: 'original-access' } };
    env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { meridian: { odp: configuration, telemetry } } });
    // A bad optional webhook does not discard the independently valid ODP pin.
    env.WEBHOOK_ENDPOINTS = '{malformed';
    const kv = env.SESSIONS as unknown as FakeKV, bucket = env.STORAGE as unknown as FakeR2, subject = 'vis-' + crypto.randomUUID(), sid = 's-late-scanned';
    await new IdentityStore(kv, f.tenant).link({ visitorId: subject, shopperId: f.sh, assurance: 'signed', source: 'login', salted: true });
    kv.store.delete(tenantKey(f.tenant, 'identity:shopper:' + f.sh));
    kv.store.set(tenantKey(f.tenant, 'session:' + sid), JSON.stringify(historyProfile(subject))); kv.store.set(tenantKey(f.tenant, 'user:' + subject), sid);
    await registerSession(d, f.tenant, subject, sid);
    const list = kv.list.bind(kv);
    vi.spyOn(kv, 'list').mockImplementation(async options => {
      const page = await list(options); return options?.prefix === tenantKey(f.tenant, 'identity:visitor:')
        ? { ...page, keys: page.keys.filter(key => key.name !== tenantKey(f.tenant, 'identity:visitor:' + subject)) } : page;
    });
    const put = bucket.put.bind(bucket), stop = vi.spyOn(bucket, 'put').mockImplementation(async (key, body, options) => {
      const value = JSON.parse(body), result = await put(key, body, options);
      if (value.kind === 'sessions' && value.state === 'discovered' && value.sessions.some((row: { owner: { id: string } }) => row.owner.id === subject)) throw new Error('synthetic captured session page reply lost');
      return result;
    });
    const first = await audit.send(f.tenant, 'identity/erase', f.selector), firstBody = await first.json() as any;
    expect(first.status).toBe(503); stop.mockRestore();
    const reference = firstBody.reconciliation; expect(reference).toMatchObject({ at: firstBody.at, readVia: 'identity/erase' });
    env.TENANT_CONNECTORS = undefined; env.WEBHOOK_ENDPOINTS = undefined;
    const remove = kv.delete.bind(kv); let observed = false;
    vi.spyOn(kv, 'delete').mockImplementation(async key => {
      if (key === tenantKey(f.tenant, 'session:' + sid)) {
        const scopes = [...bucket.store.values()].map(text => JSON.parse(text)).filter(value => value.scope && value.obligations);
        const obligation = scopes.flatMap(value => value.obligations).find(value => value.kind === 'odp' && value.identities.some((id: { subject: string }) => id.subject === subject));
        expect(obligation).toMatchObject({ configuration, identities: [{ subject, providerId: await connectorIdentity(f.tenant, 'original-space', subject) }] }); observed = true;
      }
      await remove(key);
    });
    let completed = await audit.send(f.tenant, 'identity/erase', f.selector);
    for (let n = 0; completed.status === 202 && n < 20; n++) completed = await audit.send(f.tenant, 'identity/erase', f.selector);
    expect(completed.status).toBe(200); expect(observed).toBe(true); expect(kv.store.has(tenantKey(f.tenant, 'session:' + sid))).toBe(false);
    const read = await audit.send(f.tenant, 'identity/erase', { ...f.selector, reconcile: { at: reference.at, erasureId: reference.erasureId, read: true } });
    expect(read.status, await read.clone().text()).toBe(202); const retained = await read.json() as any;
    expect(audit.details().slice(-2)).toEqual([expect.objectContaining({ phase: 'admitted', operation: 'identity_erase' }),
      expect.objectContaining({ phase: 'result', status: 202, result: { outcome: 'identity_erase', status: 'pending', localComplete: false, complete: false, cutoff: reference.at } })]);
    const odp = retained.reconciliation.obligations.find((entry: { kind: string }) => entry.kind === 'odp');
    expect(odp.configuration).toEqual(configuration); expect(retained.reconciliation.scopes.length).toBeGreaterThan(0);
    for (const kind of ['analytics', 'monitor', 'alert'] as const) {
      const saved = retained.reconciliation.obligations.find((entry: { kind: string }) => entry.kind === kind);
      expect(saved).toMatchObject({ kind, identities: [], status: 'unresolved', configuration: { tenant: 'meridian', environment: 'test', schema: 'ops-v1', ...telemetry[kind] } });
    }
    const reconcile = { at: reference.at, erasureId: reference.erasureId, obligationId: odp.id, configurationDigest: odp.configurationDigest,
      claim: 'independently_verified', evidence: 'synthetic-proof/reference', digest: 'a'.repeat(64) };
    const attested = await audit.send(f.tenant, 'identity/erase', { ...f.selector, reconcile }); expect(attested.status).toBe(202);
    expect(audit.details().at(-1)).toMatchObject({ phase: 'result', status: 202, result: { outcome: 'identity_erase', status: 'pending', localComplete: false, complete: false, cutoff: reference.at } });
    expect(await attested.json()).toMatchObject({ complete: false, reconciliation: { providerVerified: false, historicalCoverageVerified: false, obligation: { status: 'operator_attested', attestation: { claim: 'independently_verified' } } } });
    expect((await audit.send(f.tenant, 'identity/erase', { ...f.selector, reconcile: { ...reconcile, configurationDigest: 'b'.repeat(64) } })).status).toBe(409);
    expect(audit.details().at(-1)!.result).toMatchObject({ outcome: 'identity_erase', status: 'conflict', complete: false });
    expect((await audit.send('harbor', 'identity/erase', { ...f.selector, reconcile })).status).toBe(403);
  });

  it('W03.05 gates actual both-host erasure and records current callers, retained cutoffs and post-effect ambiguity', async () => {
    for (const host of ['session', 'do']) {
      env = mkEnv({ REFLEX_HOST: host }); const d = destinations(), f = await auditedIdentityFixture(), a = await currentSeed(d, 'meridian');
      const kv = env.SESSIONS as unknown as FakeKV, r2 = env.STORAGE as unknown as FakeR2;
      const snapshot = () => JSON.stringify({ kv: [...kv.store], r2: [...r2.store] });
      const before = snapshot();
      const writes = vi.spyOn(f.accounts, 'auditOperations').mockRejectedValueOnce(new Error('PRIVATE_ADMISSION'));
      const refused = await f.send('meridian', 'identity/erase', a.selector);
      expect(refused.status).toBe(503); expect(await refused.json()).toMatchObject({ operationMayHaveApplied: false, auditStatus: 'unavailable' });
      expect(snapshot()).toBe(before); expect(d.calls).toEqual([]);
      d.fail.ring = true;
      const failed = await f.send('meridian', 'identity/erase', a.selector), first = await failed.json() as { at: number; actor: string };
      expect(failed.status).toBe(503); expect(f.details().at(-1)!.result).toMatchObject({ outcome: 'identity_erase', status: 'failed', complete: false, cutoff: first.at });
      expect(d.calls.some(call => call.startsWith('ring:'))).toBe(true);
      d.fail.ring = false;
      const resumed = await f.send('meridian', 'identity/erase', a.selector, 'retry-operator'), receipt = await resumed.json();
      expect(resumed.status).toBe(200); expect(receipt).toMatchObject({ status: 'local_complete', complete: false, actor: 'audit-operator', at: first.at });
      expect(f.accounts.log.at(-1)!.actorId).toBe('retry-operator'); clean(a);
      writes.mockRestore();
      env = mkEnv({ REFLEX_HOST: host }); const d2 = destinations();
      const f2 = await auditedIdentityFixture(), b = await currentSeed(d2, 'meridian'), pendingKey = await erasureJobKey(b.tenant, b.selector);
      const real2 = f2.accounts.auditOperations.bind(f2.accounts);
      vi.spyOn(f2.accounts, 'auditOperations').mockImplementation(async rows => { if (JSON.parse(rows[0]!.detail!).phase === 'result') throw new Error('PRIVATE_RESULT'); await real2(rows); });
      const ambiguous = await f2.send('meridian', 'identity/erase', b.selector);
      expect(ambiguous.status).toBe(503); expect(await ambiguous.json()).toMatchObject({ outcome: 'outcome_unknown', operationMayHaveApplied: true, auditStatus: 'unconfirmed', requestId: expect.any(String) });
      expect(JSON.parse((env.STORAGE as unknown as FakeR2).store.get(pendingKey)!).state).toBe('local_complete'); clean(b);
      expect(f2.details().at(-1)!.phase).toBe('admitted');
      env = mkEnv({ REFLEX_HOST: host }); const d3 = destinations();
      const f3 = await auditedIdentityFixture(), many = await currentSeed(d3, 'meridian', 8), partial = await f3.send('meridian', 'identity/erase', many.selector);
      expect(partial.status).toBe(202); expect(f3.details().at(-1)!.result).toMatchObject({ outcome: 'identity_erase', status: 'pending', localComplete: false, complete: false });
      const state3 = () => JSON.stringify({ kv: [...(env.SESSIONS as unknown as FakeKV).store], r2: [...(env.STORAGE as unknown as FakeR2).store] });
      const logSize = f3.accounts.log.length, state = state3();
      for (const body of [null, [], { visitorId: 7 }, { visitorId: 'bad/value' }, { visitorId: 'valid', extra: true }]) {
        expect((await f3.send('meridian', 'identity/erase', body)).status).toBe(400);
      }
      expect(f3.accounts.log).toHaveLength(logSize); expect(state3()).toBe(state);
      vi.restoreAllMocks();
    }
  });

  it('cleans both actual bound reset hosts regardless of active host, separates two non-default tenants, and compacts only local completion', async () => {
    for (const host of ['session', 'do']) {
      env = mkEnv({ REFLEX_HOST: host }); const d = destinations();
      const a = await currentSeed(d, 'meridian'), b = await currentSeed(d, 'harbor');
      await configureHistory(a.tenant); await configureHistory(b.tenant);
      const cache = env.CACHE as unknown as FakeKV, aCache = cacheSeed(a, true), bCache = cacheSeed(b, true); cache.pageSize = 2;
      const untouched = ['profile:vis-other', 'profile:user:vis-other', 'profile:anon:vis-other', 'override:vis-other:flag:variable',
        'profile:email:synthetic@example.invalid', 'config:shared', 'optimizely:datafile'];
      for (const key of untouched) cache.store.set(tenantKey(a.tenant, key), 'preserve');
      const cacheBefore = new Map(cache.store), listed = vi.spyOn(cache, 'list');
      // Actual readers with synthetic storage; getUserProfile does not use the connector on this branch.
      const engine = new RealtimeSegmentEngine(env, {} as never, { tenant: a.tenant });
      const variables = new FeatureVariableManager(env, a.tenant), cdp = new CDPService(env, a.tenant);
      expect((await engine.getUserProfile(a.visitors[0])).segments).toEqual(['private-segment']);
      expect((await variables.getUserOverrides(a.visitors[0])).length).toBeGreaterThan(0);
      listed.mockClear();
      for (const f of [a, b]) for (const id of f.ids) {
        d.object.open(shopperObjectName(f.tenant, id)).data.set('private', { subject: id });
        const decisionId = `${f.tenant}:1:${id}:home:hero:private`;
        d.ring.open(f.tenant + ':' + id).data.set('ring', { ring: [{ tenant: f.tenant, visitor_id: id, decision_id: decisionId, ts: 1 }], index: [{ id: decisionId, ts: 1 }] });
      }
      const bObjects = b.ids.map(id => structuredClone([...d.object.open(shopperObjectName(b.tenant, id)).data]));
      const bRings = b.ids.map(id => structuredClone([...d.ring.open(b.tenant + ':' + id).data]));
      const oldEpochs = a.ids.map(id => (d.object.open(shopperObjectName(a.tenant, id)).data.get('grantAuthority') as { epoch: string }).epoch);
      const r2 = env.STORAGE as unknown as FakeR2, key = await erasureJobKey(a.tenant, a.selector), jobWrites = vi.spyOn(r2, 'put');
      const kv = env.SESSIONS as unknown as FakeKV, bBefore = [...kv.store].filter(([k]) => k.startsWith('t:harbor:'));
      const originalShopperDigest = await erasureRawDigest(kv.store.get(tenantKey(a.tenant, 'identity:shopper:' + a.sh))!);
      const originalSessionDigest = await erasureRawDigest(kv.store.get(tenantKey(a.tenant, 'session:' + a.sid))!);
      const r = await erase(a); expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body).toMatchObject({ ok: true, complete: false, erased: [], localComplete: true }); clean(a);
      const jobIds = [...new Set(jobWrites.mock.calls.filter(([k]) => k === key).map(([, body]) =>
        (JSON.parse(body) as { sources?: { erasureId: string } }).sources?.erasureId).filter((id): id is string => !!id))];
      expect(jobIds).toHaveLength(1);
      const erasureId = jobIds[0]!, receiptKey = 'identityErasure:' + erasureId;
      const canonical = jobWrites.mock.calls.filter(([k]) => k === key).map(([, body]) => JSON.parse(body).base?.canonical).find(Boolean);
      expect(canonical).toEqual({ version: 1, tenant: a.tenant, subject: a.sh, erasureId, epoch: oldEpochs[0],
        discoveryDigest: expect.stringMatching(/^[0-9a-f]{64}$/), shopperHash: originalShopperDigest, pointer: a.sid,
        session: { sid: a.sid, sourceId: a.sh, userId: a.sh, forwardTo: null, identity: a.sh, serializedDigest: originalSessionDigest } });
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(erasureId).toMatch(uuid);
      expect(r.body.localCompleted.filter((s: { stage: string }) => s.stage === 'cache')).toHaveLength(aCache.length);
      expect(listed.mock.calls.filter(([o]) => o?.prefix === tenantKey(a.tenant, 'override:' + a.visitors[0] + ':'))).toHaveLength(2);
      for (const key of aCache) expect(cache.store.has(key)).toBe(false);
      for (const key of [...bCache, ...untouched.map(key => tenantKey(a.tenant, key))]) expect(cache.store.get(key)).toBe(cacheBefore.get(key));
      for (const id of a.ids) {
        expect(await engine.getUserProfile(id)).toMatchObject({ userId: id, segments: [], attributes: {} });
        expect(await variables.getUserOverrides(id)).toEqual([]);
        expect(await cdp.getProfile({ userId: id })).toBeNull();
        expect(await cdp.getProfile({ anonymousId: id })).toBeNull();
      }
      expect([...kv.store].filter(([k]) => k.startsWith('t:harbor:'))).toEqual(bBefore);
      for (const [i, id] of a.ids.entries()) {
        const data = d.object.open(shopperObjectName(a.tenant, id)).data;
        const epoch = (data.get('grantAuthority') as { epoch: string }).epoch, sid = i === 0 ? a.sid : a.own[i - 1]!;
        expect(epoch).toMatch(uuid); expect(epoch).not.toBe(oldEpochs[i]);
        expect(Object.fromEntries(data)).toEqual({
          grantAuthority: { version: 1, epoch, grants: {} },
          [receiptKey]: { version: 1, kind: i === 0 ? 'target' : 'object', highWater: 0, witness: null, continuationEpoch: epoch, ...(i === 0 ? { canonical } : {}) },
          ['identitySessionErasure:' + erasureId + ':' + sid]: { version: 1, sessionId: sid, epoch: oldEpochs[i], receiptKey, witness: null },
        });
        expect(data.has('private')).toBe(false); expect([...d.ring.open(a.tenant + ':' + id).data]).toEqual([['ring', { ring: [], index: [] }]]);
      }
      for (const [i, id] of b.ids.entries()) { expect([...d.object.open(shopperObjectName(b.tenant, id)).data]).toEqual(bObjects[i]); expect([...d.ring.open(b.tenant + ':' + id).data]).toEqual(bRings[i]); }
      const compact = JSON.parse(r2.store.get(key)!);
      expect(compact).toMatchObject({ version: 7, state: 'local_complete' }); expect(compact).not.toHaveProperty('targets'); expect(compact).not.toHaveProperty('selector'); expect(compact).not.toHaveProperty('sessions'); expect(compact).not.toHaveProperty('cacheKeys'); expect(compact).not.toHaveProperty('base');
      for (const id of [...a.ids, ...a.own, a.sid]) expect(r2.store.get(key)).not.toContain(id);
      // A later explicit erase gets a fresh cutoff and discovers newly created local state.
      kv.store.set(tenantKey(a.tenant, 'session:s-new-after-completion'), JSON.stringify(historyProfile(a.visitors[0])));
      kv.store.set(tenantKey(a.tenant, 'user:' + a.visitors[0]), 's-new-after-completion');
      await registerSession(d, a.tenant, a.visitors[0]!, 's-new-after-completion');
      const later = await erase(a); expect(later.status).toBe(200); expect(later.body.at).toBeGreaterThan(r.body.at);
      expect(kv.store.has(tenantKey(a.tenant, 'session:s-new-after-completion'))).toBe(false);
    }
  });

  it('stops before deletion on discovery/create corruption or conflict and preserves pending work on checkpoint failures', async () => {
    for (const failure of ['discovery-read', 'discovery-null', 'wrong-shopper', 'inconsistent-selector', 'create', 'create-conflict', 'create-ambiguous', 'checkpoint', 'checkpoint-ambiguous', 'checkpoint-conflict']) {
      env = mkEnv(); const d = destinations(), f = await currentSeed(d), kv = env.SESSIONS as unknown as FakeKV, r2 = env.STORAGE as unknown as FakeR2;
      // These retained fixed ordinal1 checkpoints belong to the original
      // persisted v3 layout, not v7's object-first admission phase.
      if (failure.startsWith('checkpoint')) await prepareLegacy(f);
      const key = await erasureJobKey(f.tenant, f.selector), before = [...kv.store], del = vi.spyOn(kv, 'delete');
      if (failure === 'discovery-read') vi.spyOn(kv, 'get').mockRejectedValueOnce(new Error('synthetic read failure'));
      if (failure === 'discovery-null') kv.store.set(tenantKey(f.tenant, 'identity:visitor:' + f.visitors[0]), 'null');
      if (failure === 'wrong-shopper') { const k = tenantKey(f.tenant, 'identity:shopper:' + f.sh), record = JSON.parse(kv.store.get(k)!); record.visitors.push({ ...record.visitors[0], visitorId: 'sh_' + 'f'.repeat(32) }); kv.store.set(k, JSON.stringify(record)); }
      if (failure === 'inconsistent-selector') Object.assign(f.selector, { shopperId: 'sh_' + 'f'.repeat(32) });
      const original = r2.put.bind(r2);
      if (failure.startsWith('create') || failure.startsWith('checkpoint')) vi.spyOn(r2, 'put').mockImplementation(async (k, body, options) => {
        const record = pendingPlan(JSON.parse(body));
        if (k === key && (failure.startsWith('create') ? record.next === 0 : record.next === 1)) {
          if (failure.endsWith('ambiguous')) await original(k, body, options);
          if (failure.endsWith('conflict')) return null;
          throw new Error('synthetic write failure');
        }
        return original(k, body, options);
      });
      const r = await erase(f); expect(r.status).toBe(failure.endsWith('conflict') || failure === 'inconsistent-selector' ? 409 : 503);
      expect(r.body.ok).toBe(false); expect(r.body.erased).toEqual([]); expect(d.calls).toEqual([]);
      if (!failure.startsWith('checkpoint')) expect(del).not.toHaveBeenCalled();
      else { expect(del).toHaveBeenCalledTimes(1); expect(r.body.attempted).toBe(1); expect(pendingPlan(JSON.parse(r2.store.get(key)!)).next).toBe(failure.endsWith('ambiguous') ? 1 : 0); }
      if (failure === 'create' || failure === 'create-conflict' || failure === 'create-ambiguous') expect([...kv.store]).toEqual(before);
      vi.restoreAllMocks();
      if (failure.startsWith('checkpoint') || failure === 'create-ambiguous') { const resumed = await erase(f); expect(resumed.status).toBe(200); clean(f); }
    }
  });

  it('reconstructs original-selector retries after deleted discovery, keeps cutoff/actor, refuses changed targets or lost bindings and validates reset receipts', async () => {
    env = mkEnv(); const d = destinations(), f = await currentSeed(d), r2 = env.STORAGE as unknown as FakeR2, kv = env.SESSIONS as unknown as FakeKV;
    const key = await erasureJobKey(f.tenant, f.selector), original = r2.put.bind(r2);
    const writer = vi.spyOn(r2, 'put').mockImplementation(async (k, body, options) => {
      const record = pendingPlan(JSON.parse(body));
      if (k === key && record.next === 25) throw new Error('synthetic checkpoint failure after first link deletion');
      return original(k, body, options);
    });
    const failed = await erase(f); expect(failed.status).toBe(503); expect(failed.body.attempted).toBe(25);
    expect(kv.store.has(tenantKey(f.tenant, 'identity:visitor:' + f.visitors[0]))).toBe(false);
    expect(kv.store.has(tenantKey(f.tenant, 'user:' + f.visitors[0]))).toBe(false); writer.mockRestore();
    const resumed = await erase(f, { Authorization: 'Bearer ' + await token('retry-operator') });
    expect(resumed.status).toBe(200); expect(resumed.body.at).toBe(failed.body.at); expect(resumed.body.actor).toBe('ops'); expect(resumed.body.targets).toEqual(f.ids); clean(f);
    for (const mode of ['ring', 'object', 'binding', 'relink', 'pointer', 'corrupt-job', 'wrong-job-tenant', 'foreign-target']) {
      env = mkEnv(); const io = destinations(), a = await currentSeed(io), bucket = env.STORAGE as unknown as FakeR2, keys = env.SESSIONS as unknown as FakeKV;
      const jobKey = await erasureJobKey(a.tenant, a.selector), put = bucket.put.bind(bucket);
      const stop = vi.spyOn(bucket, 'put').mockImplementation(async (k, b, o) => { if (k === jobKey && pendingPlan(JSON.parse(b)).next === 1) throw new Error('synthetic checkpoint failure'); return put(k, b, o); });
      expect((await erase(a)).status).toBe(503); stop.mockRestore();
      if (mode === 'ring') io.fail.ring = true;
      if (mode === 'object') vi.spyOn(io.object.open(shopperObjectName(a.tenant, a.sh)).object, 'fetch').mockResolvedValue(Response.json({ ok: false }));
      if (mode === 'binding') (env as unknown as { SHOPPER_REFLEX?: unknown }).SHOPPER_REFLEX = undefined;
      if (mode === 'relink') await new IdentityStore(keys, a.tenant).link({ visitorId: a.visitors[0], shopperId: 'sh_' + 'f'.repeat(32), assurance: 'signed', source: 'login', salted: true });
      if (mode === 'pointer') keys.store.set(tenantKey(a.tenant, 'user:' + a.visitors[0]), 's-another-account');
      if (mode === 'corrupt-job') bucket.store.set(jobKey, 'null');
      if (mode === 'wrong-job-tenant' || mode === 'foreign-target') { const job = JSON.parse(bucket.store.get(jobKey)!); if (mode === 'wrong-job-tenant') job.tenant = 'harbor'; else pendingPlan(job).targets.push({ id: 'sh_' + 'f'.repeat(32), pointer: null, ownSessionId: null, linkHash: null }); bucket.store.set(jobKey, JSON.stringify(job)); }
      io.calls.length = 0; const deleted = vi.spyOn(keys, 'delete'), result = await erase(a);
      expect(result.status).toBe(['relink', 'pointer'].includes(mode) ? 409 : 503); expect(result.body.ok).toBe(false); expect(result.body.localComplete).toBe(false);
      if (!['ring', 'object'].includes(mode)) { expect(deleted).not.toHaveBeenCalled(); expect(io.calls).toEqual([]); }
      vi.restoreAllMocks();
    }
  });

  it('bounds manual continuation to32 attempts and stops a conflicting concurrent retry after its first uncheckpointed step', async () => {
    env = mkEnv(); const io = destinations(), f = await currentSeed(io, 'meridian', 8);
    const first = await erase(f); expect(first.status).toBe(202); expect(first.body).toMatchObject({ status: 'pending', complete: false, manualRetry: true, attempted: ERASURE_STEP_LIMIT });
    const second = await erase(f); expect(second.status).toBe(202); expect(second.body.attempted).toBe(ERASURE_STEP_LIMIT);
    const third = await erase(f); expect(third.status).toBe(200); expect(third.body.attempted).toBeLessThanOrEqual(ERASURE_STEP_LIMIT);
    expect(third.body.localCompleted.filter((s: { stage: string }) => s.stage === 'cache')).toHaveLength(3 * f.ids.length); clean(f);
    env = mkEnv(); const d = destinations(), a = await currentSeed(d), bucket = env.STORAGE as unknown as FakeR2, key = await erasureJobKey(a.tenant, a.selector), put = bucket.put.bind(bucket);
    let release!: () => void, arrived!: () => void, stopped = false;
    const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { arrived = resolve; });
    vi.spyOn(bucket, 'put').mockImplementation(async (k, b, o) => {
      if (k === key && pendingPlan(JSON.parse(b)).next === 1 && !stopped) { stopped = true; arrived(); await held; }
      return put(k, b, o);
    });
    const loser = erase(a); await entered;
    const winner = await erase(a); expect(winner.status).toBe(200); const calls = d.calls.length; release();
    const conflicted = await loser; expect(conflicted.status).toBe(409); expect(conflicted.body.attempted).toBe(1); expect(d.calls.length).toBe(calls); clean(a);
  });

  it('fails CACHE discovery closed before any deletion on missing binding, incomplete/malformed pages, unsafe keys or repeated cursors', async () => {
    for (const failure of ['binding', 'list', 'missing-complete', 'missing-cursor', 'bad-cursor', 'repeated-cursor', 'foreign-key', 'other-subject', 'empty-suffix', 'duplicate-key']) {
      env = mkEnv(); const d = destinations(), f = await seed(), cache = env.CACHE as unknown as FakeKV;
      cacheSeed(f); const before = [...cache.store], kv = env.SESSIONS as unknown as FakeKV, sessionsBefore = [...kv.store];
      const del = vi.spyOn(cache, 'delete'), sessionDel = vi.spyOn(kv, 'delete');
      const prefix = tenantKey(f.tenant, 'override:' + f.sh + ':');
      if (failure === 'binding') (env as unknown as { CACHE?: unknown }).CACHE = undefined;
      else if (failure === 'list') vi.spyOn(cache, 'list').mockRejectedValue(new Error('synthetic cache listing failure'));
      else {
        const page: Record<string, unknown> = { keys: [], list_complete: true };
        if (failure === 'missing-complete') delete page.list_complete;
        if (failure === 'missing-cursor') page.list_complete = false;
        if (failure === 'bad-cursor') page.cursor = 7;
        if (failure === 'repeated-cursor') { page.list_complete = false; page.cursor = 'same-cursor'; }
        if (failure === 'foreign-key') page.keys = [{ name: tenantKey('harbor', 'override:' + f.sh + ':flag') }];
        if (failure === 'other-subject') page.keys = [{ name: tenantKey(f.tenant, 'override:vis-other:flag') }];
        if (failure === 'empty-suffix') page.keys = [{ name: prefix }];
        if (failure === 'duplicate-key') page.keys = [{ name: prefix + 'flag' }, { name: prefix + 'flag' }];
        vi.spyOn(cache, 'list').mockResolvedValue(page as never);
      }
      const result = await erase(f);
      expect(result.status, failure).toBe(503); expect(result.body).toMatchObject({ ok: false, complete: false, localComplete: false, attempted: 0 });
      expect(del).not.toHaveBeenCalled(); expect(sessionDel).not.toHaveBeenCalled(); expect(d.calls).toEqual([]);
      expect([...cache.store]).toEqual(before); expect([...kv.store]).toEqual(sessionsBefore);
      expect((env.STORAGE as unknown as FakeR2).store.size).toBe(0);
      vi.restoreAllMocks();
    }
  });

  it('resumes frozen v2 CACHE steps after delete/checkpoint ambiguity and refuses missing bindings or unsafe stored plans', async () => {
    for (const failure of ['delete', 'delete-ambiguous', 'checkpoint', 'checkpoint-ambiguous', 'binding', 'unsafe-plan', 'missing-profile']) {
      env = mkEnv(); destinations(); const f = await seed(), cache = env.CACHE as unknown as FakeKV, cacheKeys = cacheSeed(f);
      const r2 = env.STORAGE as unknown as FakeR2, key = await erasureJobKey(f.tenant, f.selector), put = r2.put.bind(r2), remove = cache.delete.bind(cache);
      await prepareLegacy(f, 2);
      const firstCache = [...cacheKeys].sort()[0];
      // Three captured sessions, then four legacy target steps per discovered subject.
      const firstCacheCursor = 3 + f.ids.length * 4 + 1;
      if (failure.startsWith('delete')) vi.spyOn(cache, 'delete').mockImplementation(async k => {
        if (k === firstCache) { if (failure.endsWith('ambiguous')) await remove(k); throw new Error('synthetic cache deletion failure'); }
        return remove(k);
      });
      else vi.spyOn(r2, 'put').mockImplementation(async (k, b, o) => {
        if (k === key && pendingPlan(JSON.parse(b)).next === firstCacheCursor) {
          if (failure === 'checkpoint-ambiguous') await put(k, b, o);
          throw new Error('synthetic cache checkpoint failure');
        }
        return put(k, b, o);
      });
      const failed = await erase(f); expect(failed.status, failure).toBe(503); expect(failed.body.ok).toBe(false);
      expect(failed.body.localComplete).toBe(false); expect(failed.body.attempted).toBe(firstCacheCursor);
      // Preserve an exact historical v2 plan and numeric cursor for the retry assertions.
      const saved = pendingPlan(JSON.parse(r2.store.get(key)!)); r2.store.set(key, JSON.stringify(saved));
      expect(saved).toMatchObject({ version: 2, actor: 'ops', next: firstCacheCursor - (failure === 'checkpoint-ambiguous' ? 0 : 1), bindings: { cache: true } });
      expect(saved.cacheKeys.map((k: string) => tenantKey(f.tenant, k))).toEqual([...cacheKeys].sort());
      for (const id of f.visitors) expect((env.SESSIONS as unknown as FakeKV).store.has(tenantKey(f.tenant, 'identity:visitor:' + id))).toBe(true);
      vi.restoreAllMocks();
      if (failure === 'binding') (env as unknown as { CACHE?: unknown }).CACHE = undefined;
      if (failure === 'unsafe-plan' || failure === 'missing-profile') {
        const changed = { ...saved, cacheKeys: [...saved.cacheKeys] };
        if (failure === 'unsafe-plan') changed.cacheKeys.push('profile:vis-other');
        else changed.cacheKeys.splice(changed.cacheKeys.findIndex((k: string) => k.startsWith('profile:')), 1);
        changed.cacheKeys.sort(); r2.store.set(key, JSON.stringify(changed));
      }
      const listed = vi.spyOn(cache, 'list'), deleted = vi.spyOn(cache, 'delete');
      if (['binding', 'unsafe-plan', 'missing-profile'].includes(failure)) {
        const refused = await erase(f); expect(refused.status).toBe(503); expect(refused.body.attempted).toBe(0);
        expect(deleted).not.toHaveBeenCalled(); env.CACHE = cache as unknown as KVNamespace; r2.store.set(key, JSON.stringify(saved));
      }
      const resumed = await erase(f, { Authorization: 'Bearer ' + await token('retry-operator') });
      expect(resumed.status, failure).toBe(200); expect(resumed.body.actor).toBe('ops'); expect(resumed.body.at).toBe(failed.body.at);
      expect(listed).not.toHaveBeenCalled(); // The persisted discovery plan, not a new scan, owns this retry.
      for (const k of cacheKeys) expect(cache.store.has(k)).toBe(false);
      expect(resumed.body.localCompleted.filter((s: { stage: string }) => s.stage === 'cache')).toHaveLength(cacheKeys.length);
      expect(JSON.parse(r2.store.get(key)!)).toMatchObject({ version: 2, state: 'local_complete' }); clean(f);
      vi.restoreAllMocks();
    }
  });

  it('retains a nonzero v1 cursor after discovery disappears, without CACHE coverage, then admits a fresh v6 erase', async () => {
    env = mkEnv(); destinations(); const f = await seed(), cache = env.CACHE as unknown as FakeKV, cacheKeys = cacheSeed(f);
    const r2 = env.STORAGE as unknown as FakeR2, key = await erasureJobKey(f.tenant, f.selector), put = r2.put.bind(r2);
    await prepareLegacy(f, 2);
    // Capture existing discovery and reconstruct the exact historical v1 wire schema, not a migrated cursor.
    const stop = vi.spyOn(r2, 'put').mockImplementation(async (k, b, o) => {
      if (k === key && pendingPlan(JSON.parse(b)).next === 1) throw new Error('synthetic pre-checkpoint stop');
      return put(k, b, o);
    });
    expect((await erase(f)).status).toBe(503); stop.mockRestore();
    const legacy = pendingPlan(JSON.parse(r2.store.get(key)!)); legacy.version = 1; delete legacy.cacheKeys; delete legacy.bindings.cache;
    r2.store.set(key, JSON.stringify(legacy));
    (env as unknown as { CACHE?: unknown }).CACHE = undefined;
    const failLink = vi.spyOn(r2, 'put').mockImplementation(async (k, b, o) => {
      if (k === key && JSON.parse(b).next === 16) throw new Error('synthetic v1 checkpoint after first visitor link deletion');
      return put(k, b, o);
    });
    const failed = await erase(f); expect(failed.status).toBe(503); expect(failed.body.attempted).toBe(16);
    expect(JSON.parse(r2.store.get(key)!)).toMatchObject({ version: 1, next: 15 });
    expect((env.SESSIONS as unknown as FakeKV).store.has(tenantKey(f.tenant, 'identity:visitor:' + f.visitors[0]))).toBe(false);
    failLink.mockRestore();
    const resumed = await erase(f, { Authorization: 'Bearer ' + await token('retry-operator') });
    expect(resumed.status).toBe(200); expect(resumed.body).toMatchObject({ actor: legacy.actor, at: legacy.at, attempted: 3, complete: false });
    expect(resumed.body.localCompleted.some((s: { stage: string }) => s.stage === 'cache')).toBe(false);
    expect(resumed.body.notReached).toContain('CACHE profiles/overrides, learning seen indexes and D1 demo_events are not erased by this operation');
    const compact = JSON.parse(r2.store.get(key)!); expect(compact).toMatchObject({ version: 1, state: 'local_complete', steps: 18 }); expect(compact).not.toHaveProperty('cacheKeys');
    for (const k of cacheKeys) expect(cache.store.has(k)).toBe(true); clean(f);
    env.CACHE = cache as unknown as KVNamespace;
    const fresh = await erase(f); expect(fresh.status).toBe(200); expect(fresh.body.at).toBeGreaterThan(legacy.at);
    expect(JSON.parse(r2.store.get(key)!)).toMatchObject({ version: 7, state: 'local_complete' });
    expect(fresh.body.targets).toEqual([f.visitors[0]]); // Removed reverse links do not authorize rediscovery of former siblings.
    for (const k of cacheKeys) expect(cache.store.has(k)).toBe(!k.includes(f.visitors[0]));
  });

  it('W06.08 scans capped current links before cleanup, bounds batches, preserves other ownership and compacts every page', async () => {
    destinations();
    const f = await seed('meridian', 56), otherTenant = await seed('harbor', 2), kv = env.SESSIONS as unknown as FakeKV;
    f.selector = { visitorId: f.visitors[55] }; // A retained selector must still find the evicted browsers.
    await prepareLegacy(f); // Explicit pending v3 wire schema.
    const cache = env.CACHE as unknown as FakeKV, cacheKeys = cacheSeed(f), otherCache = cacheSeed(otherTenant);
    const otherShopper = await shopperIdFor(env, f.tenant, 'another-account');
    await new IdentityStore(kv, f.tenant).link({ visitorId: f.visitors[0], shopperId: otherShopper, assurance: 'signed', source: 'login', salted: true });
    const unrelated = 'vis-unrelated';
    await new IdentityStore(kv, f.tenant).link({ visitorId: unrelated, shopperId: otherShopper, assurance: 'signed', source: 'login', salted: true });
    const retained = new Map([...kv.store].filter(([k]) => k.startsWith('t:harbor:') || k.includes(f.own[0])
      || k === tenantKey(f.tenant, 'user:' + f.visitors[0]) || k === tenantKey(f.tenant, 'identity:visitor:' + f.visitors[0])
      || k === tenantKey(f.tenant, 'identity:visitor:' + unrelated) || k === tenantKey(f.tenant, 'identity:shopper:' + otherShopper)));
    kv.pageSize = 17;
    const list = vi.spyOn(kv, 'list'), del = vi.spyOn(kv, 'delete'), bucket = env.STORAGE as unknown as FakeR2;
    const key = await erasureJobKey(f.tenant, f.selector);
    let result!: Awaited<ReturnType<typeof erase>>, calls = 0;
    do {
      const listsBefore = list.mock.calls.length;
      result = await erase(f); calls++;
      expect([200, 202]).toContain(result.status); expect(result.body.attempted).toBeLessThanOrEqual(ERASURE_STEP_LIMIT);
      expect(list.mock.calls.length - listsBefore).toBeLessThanOrEqual(1);
      expect(result.body.discovery.receiptScope).toBe('current_batch');
      if (result.body.discovery.phase === 'scanning') {
        expect(result.body.attempted).toBe(0); expect(del).not.toHaveBeenCalled();
        expect(result.body.discovery.pagesSaved).toBe(calls);
      }
      if (result.body.discovery.phase === 'extra_cleanup') {
        expect(kv.store.has(tenantKey(f.tenant, 'session:' + f.sid))).toBe(true);
        expect(kv.store.has(tenantKey(f.tenant, 'identity:shopper:' + f.sh))).toBe(true);
        expect(cache.store.has(tenantKey(f.tenant, 'profile:' + f.sh))).toBe(true);
        if (result.body.targets.includes(f.visitors[1])) {
          expect(result.body.targets).not.toContain(f.sh);
          expect(result.body.profiles.some((p: { id: string }) => p.id === f.sh)).toBe(false);
          expect(result.body.ledger.some((p: { id: string }) => p.id === f.sh)).toBe(false);
        }
      }
      expect(calls).toBeLessThan(40);
    } while (result.status === 202);
    expect(list).toHaveBeenCalledTimes(4);
    expect(list.mock.calls.every(([o]) => o?.limit === ERASURE_DISCOVERY_PAGE_LIMIT && o.prefix === tenantKey(f.tenant, 'identity:visitor:'))).toBe(true);
    expect(result.body.discovery).toMatchObject({ phase: 'local_complete', pagesSaved: 4, pagesCompleted: 4, extraTargetsCompleted: 5 });
    expect(result.body.complete).toBe(false); expect(result.body.erased).toEqual([]);
    for (const [k, v] of retained) expect(kv.store.get(k), k).toBe(v);
    const erasedIds = [f.sh, ...f.visitors.slice(1)];
    for (const id of erasedIds) {
      expect(kv.store.has(tenantKey(f.tenant, 'user:' + id))).toBe(false);
      expect(await loadTombstone(bucket, f.tenant, id)).not.toBeNull();
    }
    for (const sid of [f.sid, ...f.own.slice(1)]) expect(kv.store.has(tenantKey(f.tenant, 'session:' + sid))).toBe(false);
    for (const id of f.visitors.slice(1)) expect(kv.store.has(tenantKey(f.tenant, 'identity:visitor:' + id))).toBe(false);
    for (const k of cacheKeys) expect(cache.store.has(k)).toBe(k.includes(f.visitors[0]));
    for (const k of otherCache) expect(cache.store.has(k)).toBe(true);
    expect(JSON.parse(bucket.store.get(key)!)).toMatchObject({ version: 3, state: 'local_complete' });
    const children = [...bucket.store].filter(([k]) => k.startsWith(key.slice(0, -5) + '/') && k.includes('/pages/'));
    expect([...bucket.store.keys()].some(k => k.startsWith(key.slice(0, -5) + '/') && k.endsWith('/destinations.json'))).toBe(true);
    expect(children).toHaveLength(4);
    for (const [, body] of children) {
      expect(JSON.parse(body).state).toBe('compacted');
      for (const raw of [...f.ids, ...f.own, f.sid, 'cursor', 'lastKey', 'plan']) expect(body).not.toContain(raw);
    }
  });

  it('W06.08 resumes frozen pages, cleanup and compaction across page/root write ambiguity', async () => {
    for (const failure of ['page', 'page-ambiguous', 'root-scan', 'root-scan-ambiguous', 'cleanup', 'cleanup-ambiguous',
      'compact', 'compact-ambiguous', 'root-compact', 'root-compact-ambiguous']) {
      env = mkEnv(); const f = await seed('meridian', 52); f.selector = { visitorId: f.visitors[51] };
      await prepareLegacy(f);
      const kv = env.SESSIONS as unknown as FakeKV, bucket = env.STORAGE as unknown as FakeR2, cacheKeys = cacheSeed(f);
      const key = await erasureJobKey(f.tenant, f.selector), put = bucket.put.bind(bucket);
      const write = vi.spyOn(bucket, 'put').mockImplementation(async (k, body, options) => {
        const record = JSON.parse(body), stage = failure.replace('-ambiguous', '');
        const matches = stage === 'page' ? k !== key && record.state === 'discovered' && record.ordinal === 0 && record.plan?.next === 0
          : stage === 'root-scan' ? k === key && record.scan?.pages === 1
          : stage === 'cleanup' ? k !== key && record.state === 'discovered' && record.plan?.next === 1
          : stage === 'compact' ? k !== key && record.state === 'compacted'
          : k === key && record.nextPage === 1;
        if (matches) { if (failure.endsWith('-ambiguous')) await put(k, body, options); throw new Error('synthetic ' + failure); }
        return put(k, body, options);
      });
      let failed = await erase(f), attempts = 0;
      while (failed.status === 202 && attempts++ < 10) failed = await erase(f);
      expect(failed.status, failure).toBe(503); expect(failed.body.localComplete).toBe(false);
      expect(kv.store.has(tenantKey(f.tenant, 'identity:shopper:' + f.sh))).toBe(true);
      if (failure === 'cleanup-ambiguous') {
        expect(JSON.parse(bucket.store.get(key)!)).toMatchObject({ version: 3, nextPage: 0 });
        expect([...bucket.store.values()].map(b => JSON.parse(b)).some(p => p.state === 'discovered' && p.plan?.next === 1)).toBe(true);
      }
      write.mockRestore();
      const list = vi.spyOn(kv, 'list');
      let resumed = await erase(f, { Authorization: 'Bearer ' + await token('retry-operator') });
      if (['page-ambiguous', 'root-scan'].includes(failure)) expect(list).not.toHaveBeenCalled();
      expect(resumed.body.actor).toBe('ops'); expect(resumed.body.at).toBe(failed.body.at);
      attempts = 0;
      while (resumed.status === 202 && attempts++ < 30) {
        expect(resumed.body.attempted).toBeLessThanOrEqual(ERASURE_STEP_LIMIT);
        resumed = await erase(f);
      }
      expect(resumed.status, failure).toBe(200); clean(f);
      for (const k of cacheKeys) expect((env.CACHE as unknown as FakeKV).store.has(k)).toBe(false);
      const children = [...bucket.store].filter(([k]) => k.startsWith(key.slice(0, -5) + '/') && k.includes('/pages/'));
      expect([...bucket.store.keys()].some(k => k.startsWith(key.slice(0, -5) + '/') && k.endsWith('/destinations.json'))).toBe(true);
      expect(children).toHaveLength(2); expect(children.every(([, body]) => JSON.parse(body).state === 'compacted')).toBe(true);
      vi.restoreAllMocks();
    }
  });

  it('W06.08 refuses malformed scans, unsafe saved capsules and changed ownership; empty advancing pages remain pending', async () => {
    for (const failure of ['list', 'missing-complete', 'missing-cursor', 'bad-cursor', 'oversized', 'foreign-key', 'duplicate-key',
      'malformed-link', 'cursor-cycle', 'changed-pointer', 'changed-link', 'uncovered-shopper-session', 'missing-page', 'wrong-page-tenant', 'out-of-page-target']) {
      env = mkEnv(); const f = await seed('meridian', 52); f.selector = { visitorId: f.visitors[51] };
      await prepareLegacy(f);
      const kv = env.SESSIONS as unknown as FakeKV, bucket = env.STORAGE as unknown as FakeR2, key = await erasureJobKey(f.tenant, f.selector);
      const prefix = tenantKey(f.tenant, 'identity:visitor:'), remove = vi.spyOn(kv, 'delete');
      if (failure === 'uncovered-shopper-session') {
        kv.store.set(tenantKey(f.tenant, 'session:s-unindexed-person'), JSON.stringify(historyProfile(f.sh)));
        kv.store.set(tenantKey(f.tenant, 'user:' + f.sh), f.sid);
        kv.store.set(tenantKey(f.tenant, 'user:' + f.visitors[0]), 's-unindexed-person');
      }
      if (failure === 'malformed-link') kv.store.set(prefix + f.visitors[0], 'null');
      if (failure === 'list') vi.spyOn(kv, 'list').mockRejectedValue(new Error('synthetic list failure'));
      if (['missing-complete', 'missing-cursor', 'bad-cursor', 'oversized', 'foreign-key', 'duplicate-key'].includes(failure)) {
        const page: Record<string, unknown> = { keys: [], list_complete: true };
        if (failure === 'missing-complete') delete page.list_complete;
        if (failure === 'missing-cursor') page.list_complete = false;
        if (failure === 'bad-cursor') page.cursor = null;
        if (failure === 'oversized') page.keys = Array.from({ length: 33 }, () => ({ name: prefix + f.visitors[0] }));
        if (failure === 'foreign-key') page.keys = [{ name: tenantKey('harbor', 'identity:visitor:' + f.visitors[0]) }];
        if (failure === 'duplicate-key') page.keys = [{ name: prefix + f.visitors[0] }, { name: prefix + f.visitors[0] }];
        vi.spyOn(kv, 'list').mockResolvedValue(page as never);
      }
      if (failure === 'cursor-cycle') {
        const list = vi.spyOn(kv, 'list').mockImplementation(async o => ({ keys: [], list_complete: false, cursor: o?.cursor === 'a' ? 'b' : 'a' }));
        for (let i = 0; i < 3; i++) { const pending = await erase(f); expect(pending.status).toBe(202); expect(pending.body.attempted).toBe(0); }
        expect(list).toHaveBeenCalledTimes(3);
      } else if (['changed-pointer', 'changed-link', 'missing-page', 'wrong-page-tenant', 'out-of-page-target'].includes(failure)) {
        expect((await erase(f)).status).toBe(202);
        const childKey = [...bucket.store.keys()].find(k => k.startsWith(key.slice(0, -5) + '/') && k.includes('/pages/'))!;
        if (failure === 'changed-pointer') kv.store.set(tenantKey(f.tenant, 'user:' + f.visitors[0]), 's-new-owner');
        if (failure === 'changed-link') {
          const linkKey = prefix + f.visitors[0], link = JSON.parse(kv.store.get(linkKey)!);
          kv.store.set(linkKey, JSON.stringify({ ...link, shopperId: 'sh_' + 'f'.repeat(32) }));
        }
        if (failure === 'missing-page') bucket.store.delete(childKey);
        if (failure === 'wrong-page-tenant' || failure === 'out-of-page-target') {
          const page = JSON.parse(bucket.store.get(childKey)!);
          if (failure === 'wrong-page-tenant') page.tenant = 'harbor';
          else page.output.lastKey = prefix + 'vis-before-all';
          bucket.store.set(childKey, JSON.stringify(page));
        }
      }
      const result = await erase(f);
      expect(result.status, failure).toBe(['changed-pointer', 'changed-link', 'uncovered-shopper-session'].includes(failure) ? 409 : 503);
      expect(result.body.localComplete).toBe(false); expect(remove).not.toHaveBeenCalled();
      expect(kv.store.has(tenantKey(f.tenant, 'identity:shopper:' + f.sh))).toBe(true);
      vi.restoreAllMocks();
    }
  });

  it('W35.07 freezes one-read raw bytes across scanned, canonical-extra and base sessions before adjacent deletion', async () => {
    for (const branch of ['scan', 'extra', 'base']) {
      env = mkEnv(); const d = destinations(), f = await seed('meridian', 0);
      f.selector = { visitorId: f.sh };
      const kv = env.SESSIONS as unknown as FakeKV, bucket = env.STORAGE as unknown as FakeR2;
      const sid = branch === 'base' ? f.sid : 's-w3507-' + branch, sessionKey = tenantKey(f.tenant, 'session:' + sid);
      if (branch !== 'base') kv.store.set(sessionKey, kv.store.get(tenantKey(f.tenant, 'session:' + f.sid))!);
      if (branch === 'extra') {
        await new IdentityStore(kv, f.tenant).link({ visitorId: 'vis-w3507-extra', shopperId: f.sh, assurance: 'signed', source: 'login', salted: true });
        kv.store.delete(tenantKey(f.tenant, 'identity:shopper:' + f.sh));
        kv.store.set(tenantKey(f.tenant, 'user:vis-w3507-extra'), sid);
        const list = kv.list.bind(kv);
        vi.spyOn(kv, 'list').mockImplementation(async options => {
          const page = await list(options); return { ...page, keys: page.keys.filter(key => key.name !== sessionKey) };
        });
      }
      const object = d.object.open(shopperObjectName(f.tenant, f.sh)), epoch = crypto.randomUUID(), iat = Math.floor(Date.now() / 1000);
      const grants = [f.sid, sid].map(sessionId => ({ tenant: f.tenant, subject: f.sh, sessionId, kind: 'recognized',
        grantId: crypto.randomUUID(), authorityEpoch: epoch, iat, exp: iat + 3600 }));
      object.data.set('grantAuthority', { version: 1, epoch, grants: Object.fromEntries(grants.map(grant => [grant.grantId, grant])) });
      const original = kv.store.get(sessionKey)!, serialized = original.slice(0, -1) + ',"unknownGeneration":"old"}';
      kv.store.set(sessionKey, serialized);
      if (branch === 'base') {
        const authority = structuredClone([...object.data]);
        for (const absent of [true, false]) {
          if (absent) kv.store.delete(sessionKey); else kv.store.set(sessionKey, 'null');
          const preserved = [...kv.store], remove = vi.spyOn(kv, 'delete');
          expect((await erase(f)).status).toBe(503); expect(remove).not.toHaveBeenCalled();
          expect([...kv.store]).toEqual(preserved); expect([...object.data]).toEqual(authority); expect(bucket.store.size).toBe(0);
          remove.mockRestore();
        }
        kv.store.set(sessionKey, serialized);
      }
      const get = kv.get.bind(kv), snapshotRead = SessionManager.prototype.readSnapshot;
      const reads = vi.spyOn(kv, 'get');
      const oneRead = vi.spyOn(SessionManager.prototype, 'readSnapshot').mockImplementation(async function(this: SessionManager, id) {
        const before = reads.mock.calls.filter(([key]) => key === tenantKey(f.tenant, 'session:' + id)).length;
        const result = await snapshotRead.call(this, id);
        expect(reads.mock.calls.filter(([key]) => key === tenantKey(f.tenant, 'session:' + id)).length - before).toBe(1);
        return result;
      });
      // The first read returns old bytes while the store has already changed.
      // A second capture read would silently pin the replacement instead.
      let firstRead = true;
      reads.mockImplementation(async (key, type) => {
        const result = await get(key, type);
        if (key === sessionKey && firstRead) { firstRead = false; kv.store.set(key, serialized.replace('"old"', '"new"')); }
        return result;
      });
      const key = await erasureJobKey(f.tenant, f.selector), put = bucket.put.bind(bucket);
      const stop = vi.spyOn(bucket, 'put').mockImplementation(async (path, body, options) => {
        const value = JSON.parse(body), match = branch === 'base' ? path === key && value.sources?.highWater === null
          : branch === 'extra' ? value.plan?.sessions.some((session: { sid: string }) => session.sid === sid)
          : value.kind === 'sessions' && value.sessions?.some((entry: { session: { sid: string } }) => entry.session.sid === sid);
        const result = await put(path, body, options);
        if (match) throw new Error('synthetic frozen raw snapshot acknowledgement');
        return result;
      });
      expect((await erase(f)).status, branch).toBe(503); stop.mockRestore();
      const frozen = [...bucket.store.values()].map(body => JSON.parse(body)).flatMap(value => value.base?.sessions ?? value.plan?.sessions
        ?? value.sessions?.map((entry: { session: unknown }) => entry.session) ?? []).find(session => session.sid === sid);
      expect(frozen.serialized).toBe(serialized);
      const before = [...kv.store], cache = [...(env.CACHE as unknown as FakeKV).store], deletes = vi.spyOn(kv, 'delete');
      const resumed = await erase(f);
      expect(resumed.status, branch).toBe(409); expect(resumed.body.localComplete).toBe(false);
      expect(deletes).not.toHaveBeenCalled(); expect([...kv.store]).toEqual(before); expect([...(env.CACHE as unknown as FakeKV).store]).toEqual(cache);
      kv.store.set(sessionKey, serialized);
      object.object = new ShopperReflex(object.state, env);
      const objectFetch = vi.spyOn(object.object, 'fetch');
      const remove = kv.delete.bind(kv);
      deletes.mockImplementationOnce(async name => { await remove(name); throw new Error('synthetic delete acknowledgement'); });
      expect((await erase(f)).status).toBe(503);
      deletes.mockRestore();
      // Checkpoint the deletion itself, then stop before shared-key cleanup.
      // For scan, also consume/compact its capsule and checkpoint the base SID:
      // the remaining owner guard must still see a successor using the scanned SID.
      const checkpoint = vi.spyOn(bucket, 'put').mockImplementation(async (path, body, options) => {
        const value = JSON.parse(body), result = await put(path, body, options);
        if (branch === 'extra' ? value.plan?.next === 2 : path === key && value.base?.next === 2) {
          throw new Error('synthetic acknowledged session cursor before adjacent cleanup');
        }
        return result;
      });
      expect((await erase(f)).status, branch).toBe(503); checkpoint.mockRestore();
      expect(kv.store.has(sessionKey)).toBe(false);
      if (branch === 'scan') {
        expect(JSON.parse(bucket.store.get(key)!).nextSessionPage).toBe(1);
        expect([...bucket.store].filter(([path]) => path.includes('/sessions/')).every(([, body]) => JSON.parse(body).state === 'compacted')).toBe(true);
      }
      const inert = structuredClone([...object.data]), savedKV = [...kv.store];
      const cacheKV = env.CACHE as unknown as FakeKV, savedCache = [...cacheKV.store];
      for (const reuse of ['same', 'different']) {
        const successorSid = reuse === 'same' ? sid : sid + '-successor', successorEpoch = crypto.randomUUID();
        const grant = { ...grants[0], sessionId: successorSid, grantId: crypto.randomUUID(), authorityEpoch: successorEpoch };
        object.data.set('grantAuthority', { version: 1, epoch: successorEpoch, grants: { [grant.grantId]: grant } });
        object.object = new ShopperReflex(object.state, env);
        kv.store.set(tenantKey(f.tenant, 'session:' + successorSid), serialized); // Same raw compatibility bytes.
        cacheKV.store.set(tenantKey(f.tenant, 'profile:' + f.sh), 'successor-cache');
        const preservedKV = [...kv.store], preservedCache = [...cacheKV.store], remove = vi.spyOn(kv, 'delete'), cacheRemove = vi.spyOn(cacheKV, 'delete');
        const rejected = await erase(f);
        expect(rejected.status, branch + ':' + reuse).toBe(503); expect(rejected.body.localComplete).toBe(false);
        expect(remove).not.toHaveBeenCalled(); expect(cacheRemove).not.toHaveBeenCalled();
        expect([...kv.store]).toEqual(preservedKV); expect([...cacheKV.store]).toEqual(preservedCache);
        remove.mockRestore(); cacheRemove.mockRestore();
        object.data.clear(); for (const [name, value] of inert) object.data.set(name, structuredClone(value));
        object.object = new ShopperReflex(object.state, env);
        kv.store.clear(); for (const [name, value] of savedKV) kv.store.set(name, value);
        cacheKV.store.clear(); for (const [name, value] of savedCache) cacheKV.store.set(name, value);
      }
      if (branch !== 'scan') {
        kv.store.set(sessionKey, serialized.replace('"old"', '"new"'));
        const remove = vi.spyOn(kv, 'delete');
        expect((await erase(f)).status, branch).toBe(409); expect(remove).not.toHaveBeenCalled();
        remove.mockRestore(); kv.store.delete(sessionKey);
      }
      let result = await erase(f), attempts = 0;
      while (result.status === 202 && attempts++ < 8) result = await erase(f);
      expect(result.status, branch).toBe(200); expect(kv.store.has(sessionKey)).toBe(false);
      const authorizations = objectFetch.mock.calls.map(([request]) => request).filter(request =>
        ['/identity/erase/session', '/identity/erase/effect'].includes(new URL(request.url).pathname));
      expect(authorizations.length).toBeGreaterThan(0);
      expect(authorizations.every(request => request.headers.get('X-Reflex-Subject') === f.sh)).toBe(true);
      expect(JSON.parse(bucket.store.get(key)!)).toMatchObject({ version: 7, state: 'local_complete' });
      oneRead.mockRestore(); vi.restoreAllMocks();
    }
  });

  it('W35.07 tags equivalent v5 prefixes and refuses ambiguous progress through layout-save loss and compaction', async () => {
    for (const phase of ['zero', 'full', 'partial', 'layout-before', 'layout-after', 'compacted']) {
      env = mkEnv(); destinations(); const f = await seed('meridian', 0); f.selector = { visitorId: f.sh };
      const kv = env.SESSIONS as unknown as FakeKV, bucket = env.STORAGE as unknown as FakeR2;
      await new IdentityStore(kv, f.tenant).link({ visitorId: 'vis-v5-extra', shopperId: f.sh, assurance: 'signed', source: 'login', salted: true });
      kv.store.delete(tenantKey(f.tenant, 'identity:shopper:' + f.sh));
      kv.store.set(tenantKey(f.tenant, 'user:vis-v5-extra'), f.sid);
      await prepareLegacy(f, 5);
      const key = await erasureJobKey(f.tenant, f.selector), put = bucket.put.bind(bucket);
      const freeze = vi.spyOn(bucket, 'put').mockImplementation(async (path, body, options) => {
        const value = JSON.parse(body);
        if (path === key && value.nextSessionPage === 1) { await put(path, body, options); throw new Error('synthetic before extra cleanup'); }
        return put(path, body, options);
      });
      expect((await erase(f)).status).toBe(503); freeze.mockRestore();
      const childKey = [...bucket.store.keys()].find(path => path.includes('/pages/'))!, page = JSON.parse(bucket.store.get(childKey)!);
      expect(page.layout).toBeUndefined(); expect(page.plan.next).toBe(0);
      // This extra plan has object, pointer, tombstone, ring, three CACHE keys,
      // and a visitor link. Its canonical SID is already covered by base.
      const full = 8;
      page.plan.next = phase === 'partial' ? 1 : ['full', 'compacted'].includes(phase) ? full : 0;
      bucket.store.set(childKey, JSON.stringify(page));
      if (phase === 'compacted') {
        const root = JSON.parse(bucket.store.get(key)!);
        root.compacting = { nextCursor: null, steps: full, targets: 1 };
        bucket.store.set(key, JSON.stringify(root));
        const { version, tenant, selectorHash, actor, at, ordinal } = page;
        bucket.store.set(childKey, JSON.stringify({ version, tenant, selectorHash, actor, at, ordinal, state: 'compacted' }));
      }
      const deletes = vi.spyOn(kv, 'delete'), state = JSON.stringify([...bucket.store]), before = [...kv.store];
      let hits = 0;
      const layout = vi.spyOn(bucket, 'put').mockImplementation(async (path, body, options) => {
        if (path === childKey && JSON.parse(body).layout === 'object-first-v1') {
          hits++;
          if (phase === 'layout-before') throw new Error('synthetic layout rejection');
          if (phase === 'layout-after') { await put(path, body, options); throw new Error('synthetic layout acknowledgement'); }
        }
        return put(path, body, options);
      });
      const result = await erase(f);
      if (phase === 'partial') {
        expect(result.status).toBe(409); expect(JSON.stringify([...bucket.store])).toBe(state); expect([...kv.store]).toEqual(before);
        expect(deletes).not.toHaveBeenCalled(); expect(hits).toBe(0);
      } else if (phase.startsWith('layout-')) {
        expect(result.status).toBe(503); expect(deletes).not.toHaveBeenCalled(); expect([...kv.store]).toEqual(before);
        expect(JSON.parse(bucket.store.get(childKey)!).layout).toBe(phase === 'layout-after' ? 'object-first-v1' : undefined);
        layout.mockRestore(); expect((await erase(f)).status).toBe(200);
      } else {
        expect(result.status, phase).toBe(200); expect(hits).toBe(phase === 'compacted' ? 0 : phase === 'full' ? 1 : full + 1);
      }
      if (phase !== 'partial') {
        expect(JSON.parse(bucket.store.get(key)!)).toMatchObject({ version: 5, state: 'local_complete' });
        expect(JSON.parse(bucket.store.get(childKey)!)).toMatchObject({ state: 'compacted' });
        if (phase === 'full' || phase === 'compacted') expect(deletes.mock.calls.some(([name]) => name.includes('vis-v5-extra'))).toBe(false);
      }
      vi.restoreAllMocks();
    }
  });

  it('W06.09 scans older owned sessions before cleanup, handles an unlisted canonical pointer and preserves other ownership', async () => {
    destinations();
    const f = await seed('meridian', 54), foreign = await seed('harbor'), kv = env.SESSIONS as unknown as FakeKV;
    f.selector = { visitorId: f.visitors[53] };
    const bucket = env.STORAGE as unknown as FakeR2, key = await erasureJobKey(f.tenant, f.selector);
    const copy = (sid: string, userId: string, from = f.sid, fields: Record<string, unknown> = {}) => {
      kv.store.set(tenantKey(f.tenant, 'session:' + sid), JSON.stringify({ ...JSON.parse(kv.store.get(tenantKey(f.tenant, 'session:' + from))!), userId, ...fields }));
    };
    const older = ['s-older-canonical', 's-older-base', 's-older-extra', 's-unlisted-canonical'];
    copy(older[0], f.sh); copy(older[1], f.visitors[53], f.own[53]); copy(older[2], f.visitors[0], f.own[0]); copy(older[3], f.sh);
    kv.store.set(tenantKey(f.tenant, 'user:' + f.visitors[0]), older[3]);
    const otherShopper = 'sh_' + 'f'.repeat(32);
    await new IdentityStore(kv, f.tenant).link({ visitorId: f.visitors[1], shopperId: otherShopper, assurance: 'signed', source: 'login', salted: true });
    copy('s-misleading-other', f.visitors[1], f.own[1], { forwardTo: f.sid, identity: { shopperId: f.sh, linkedAt: 1 }, anonymousId: f.visitors[0] });
    copy('s-linkless-other', 'vis-linkless-other', f.own[1], { forwardTo: f.sid, identity: { shopperId: f.sh, linkedAt: 1 }, anonymousId: f.visitors[0] });
    const preserved = new Map([...kv.store].filter(([k]) => k.startsWith('t:harbor:') || k.endsWith('session:s-misleading-other')
      || k.endsWith('session:s-linkless-other') || k.endsWith('session:' + f.own[1]) || k.endsWith('user:' + f.visitors[1])
      || k.endsWith('identity:visitor:' + f.visitors[1]) || k.endsWith('identity:shopper:' + otherShopper)));
    const listOriginal = kv.list.bind(kv), list = vi.spyOn(kv, 'list').mockImplementation(async options => {
      const page = await listOriginal(options);
      return { ...page, keys: page.keys.filter(k => k.name !== tenantKey(f.tenant, 'session:' + older[3])) };
    });
    await prepareLegacy(f, 5); // Grantless records retain their historical v5 contract; fresh v6 refuses them.
    const remove = vi.spyOn(kv, 'delete');
    let result!: Awaited<ReturnType<typeof erase>>, requests = 0, sawSessionBatch = false;
    do {
      const start = list.mock.calls.length;
      result = await erase(f); requests++;
      expect([200, 202]).toContain(result.status); expect(result.body.attempted).toBeLessThanOrEqual(32);
      for (const prefix of ['identity:visitor:', 'session:']) {
        const calls = list.mock.calls.slice(start).filter(([o]) => o?.prefix === tenantKey(f.tenant, prefix));
        expect(calls.length).toBeLessThanOrEqual(1); expect(calls.every(([o]) => o?.limit === 32)).toBe(true);
      }
      if (['scanning', 'session_scanning'].includes(result.body.discovery.phase)) {
        expect(remove).not.toHaveBeenCalled(); expect(result.body.attempted).toBe(0);
      }
      if (result.body.sessions) {
        sawSessionBatch = true; expect(result.body.profiles).toEqual([]); expect(result.body.ledger).toEqual([]);
        expect(result.body.links).toEqual({ visitors: 0, shopper: false });
      }
      if (['session_cleanup', 'extra_cleanup'].includes(result.body.discovery.phase)) {
        expect(kv.store.has(tenantKey(f.tenant, 'identity:shopper:' + f.sh))).toBe(true);
        expect(kv.store.has(tenantKey(f.tenant, 'session:' + f.sid))).toBe(true);
      }
      for (const [k, body] of bucket.store) if (k.includes('/sessions/')) {
        const page = JSON.parse(body);
        if (page.state === 'discovered') expect(page.sessions.length).toBeLessThanOrEqual(32);
      }
      expect(requests).toBeLessThan(35);
    } while (result.status === 202);
    expect(sawSessionBatch).toBe(true);
    expect(result.body.discovery).toMatchObject({ phase: 'local_complete', pagesSaved: 2, pagesCompleted: 2, sessionPagesSaved: 2, sessionPagesCompleted: 2 });
    expect(result.body.discovery.sessionsCompleted).toBeGreaterThanOrEqual(3);
    expect(result.body).toMatchObject({ complete: false, erased: [] });
    for (const sid of [f.sid, ...f.own.filter((_, i) => i !== 1), ...older]) expect(kv.store.has(tenantKey(f.tenant, 'session:' + sid)), sid).toBe(false);
    for (const [k, value] of preserved) expect(kv.store.get(k), k).toBe(value);
    expect(kv.store.has(tenantKey(foreign.tenant, 'session:' + foreign.sid))).toBe(true);
    const children = [...bucket.store].filter(([k]) => k.startsWith(key.slice(0, -5) + '/') && /\/(pages|sessions)\//.test(k));
    expect([...bucket.store.keys()].some(k => k.startsWith(key.slice(0, -5) + '/') && k.endsWith('/destinations.json'))).toBe(true);
    expect(children).toHaveLength(4);
    for (const [, body] of children) {
      expect(JSON.parse(body).state).toBe('compacted');
      for (const raw of [...f.ids, ...f.own, f.sid, ...older, 'cursor', 'owner', 'lastKey']) expect(body).not.toContain(raw);
    }
    expect(JSON.parse(bucket.store.get(key)!)).toMatchObject({ version: 5, state: 'local_complete' });
  });

  it('W06.09 anonymous discovery erases only the selected userId and shares the32-step continuation budget', async () => {
    const visitorId = 'vis-anonymous-owner', kv = env.SESSIONS as unknown as FakeKV;
    const original = historyProfile(visitorId);
    kv.store.set(tenantKey('meridian', 'session:s-current-anonymous'), JSON.stringify(original));
    kv.store.set(tenantKey('meridian', 'user:' + visitorId), 's-current-anonymous');
    const older = Array.from({ length: 35 }, (_, i) => 's-anonymous-old-' + String(i).padStart(2, '0'));
    for (const sid of older) kv.store.set(tenantKey('meridian', 'session:' + sid), JSON.stringify(original));
    kv.store.set(tenantKey('meridian', 'session:s-other-anonymous'), JSON.stringify({ ...original, userId: 'vis-other', anonymousId: visitorId, forwardTo: 's-current-anonymous' }));
    kv.store.set(tenantKey('harbor', 'session:s-current-anonymous'), JSON.stringify(original));
    const list = vi.spyOn(kv, 'list'), del = vi.spyOn(kv, 'delete');
    const request = () => call('/meridian/identity/erase', { method: 'POST', headers: auth, json: { visitorId } });
    const first = await request(); expect(first.status).toBe(202); expect(first.body.attempted).toBe(0); expect(del).not.toHaveBeenCalled();
    const second = await request(); expect(second.status).toBe(202); expect(second.body.attempted).toBe(32);
    expect(second.body.profiles).toEqual([]); expect(second.body.sessions).toHaveLength(32);
    const final = await request(); expect(final.status).toBe(200); expect(final.body.attempted).toBeLessThanOrEqual(32);
    expect(final.body.discovery).toMatchObject({ pagesSaved: 0, sessionPagesSaved: 2, sessionPagesCompleted: 2, sessionsCompleted: 35 });
    expect(list).toHaveBeenCalledTimes(2); expect(list.mock.calls.every(([o]) => o?.prefix === tenantKey('meridian', 'session:') && o.limit === 32)).toBe(true);
    for (const sid of [...older, 's-current-anonymous']) expect(kv.store.has(tenantKey('meridian', 'session:' + sid))).toBe(false);
    expect(kv.store.has(tenantKey('meridian', 'session:s-other-anonymous'))).toBe(true);
    expect(kv.store.has(tenantKey('harbor', 'session:s-current-anonymous'))).toBe(true);
  });

  it('W06.09 resumes session page/root/delete/checkpoint/compaction ambiguity with the original actor and cutoff', async () => {
    for (const failure of ['page', 'page-ambiguous', 'root-scan', 'root-scan-ambiguous', 'delete', 'delete-ambiguous',
      'checkpoint', 'checkpoint-ambiguous', 'compact', 'compact-ambiguous', 'root-compact', 'root-compact-ambiguous']) {
      env = mkEnv(); const f = await seed(), kv = env.SESSIONS as unknown as FakeKV, bucket = env.STORAGE as unknown as FakeR2;
      const sid = 's-old-retry', oldKey = tenantKey(f.tenant, 'session:' + sid), key = await erasureJobKey(f.tenant, f.selector);
      kv.store.set(oldKey, kv.store.get(tenantKey(f.tenant, 'session:' + f.own[0]))!);
      const put = bucket.put.bind(bucket), remove = kv.delete.bind(kv), stage = failure.replace('-ambiguous', '');
      if (stage === 'delete') vi.spyOn(kv, 'delete').mockImplementation(async k => {
        if (k === oldKey) { if (failure.endsWith('ambiguous')) await remove(k); throw new Error('synthetic ' + failure); }
        return remove(k);
      });
      else vi.spyOn(bucket, 'put').mockImplementation(async (k, body, options) => {
        const record = JSON.parse(body);
        const matches = stage === 'page' ? record.kind === 'sessions' && record.state === 'discovered' && record.next === 0
          : stage === 'root-scan' ? k === key && record.sessionScan?.pages === 1
          : stage === 'checkpoint' ? record.kind === 'sessions' && record.state === 'discovered' && record.next === 1
          : stage === 'compact' ? record.kind === 'sessions' && record.state === 'compacted'
          : k === key && record.nextSessionPage === 1;
        if (matches) { if (failure.endsWith('ambiguous')) await put(k, body, options); throw new Error('synthetic ' + failure); }
        return put(k, body, options);
      });
      const failed = await erase(f); expect(failed.status, failure).toBe(503); expect(failed.body.localComplete).toBe(false);
      expect(kv.store.has(tenantKey(f.tenant, 'identity:visitor:' + f.visitors[0]))).toBe(true);
      expect(kv.store.has(tenantKey(f.tenant, 'user:' + f.visitors[0]))).toBe(true);
      vi.restoreAllMocks(); const list = vi.spyOn(kv, 'list');
      const resumed = await erase(f, { Authorization: 'Bearer ' + await token('retry-operator') });
      expect(resumed.status, failure).toBe(200); expect(resumed.body).toMatchObject({ actor: 'ops', at: failed.body.at, complete: false });
      if (failure !== 'page') expect(list).not.toHaveBeenCalled();
      expect(resumed.body.attempted).toBeLessThanOrEqual(32); expect(kv.store.has(oldKey)).toBe(false); clean(f);
      const children = [...bucket.store].filter(([k]) => k.startsWith(key.slice(0, -5) + '/') && /\/(pages|sessions)\//.test(k));
      expect([...bucket.store.keys()].some(k => k.startsWith(key.slice(0, -5) + '/') && k.endsWith('/destinations.json'))).toBe(true);
      expect(children).toHaveLength(2); expect(children.every(([, body]) => JSON.parse(body).state === 'compacted')).toBe(true);
      vi.restoreAllMocks();
    }
  });

  it('W06.09 refuses changed session/owner witnesses and malformed or unsafe frozen session pages before deleting', async () => {
    for (const failure of ['userId', 'forwardTo', 'identity', 'link', 'missing-link', 'pointer', 'missing-pointer', 'unsafe-owner', 'malformed-record']) {
      env = mkEnv(); const f = await seed(), kv = env.SESSIONS as unknown as FakeKV, bucket = env.STORAGE as unknown as FakeR2;
      const oldKey = tenantKey(f.tenant, 'session:s-old-guard'), key = await erasureJobKey(f.tenant, f.selector), put = bucket.put.bind(bucket);
      kv.store.set(oldKey, kv.store.get(tenantKey(f.tenant, 'session:' + f.own[0]))!);
      const stop = vi.spyOn(bucket, 'put').mockImplementation(async (k, body, options) => {
        if (k === key && JSON.parse(body).sessionScan?.pages === 1) throw new Error('synthetic stop after frozen session page');
        return put(k, body, options);
      });
      expect((await erase(f)).status).toBe(503); stop.mockRestore();
      const linkKey = tenantKey(f.tenant, 'identity:visitor:' + f.visitors[0]), pointerKey = tenantKey(f.tenant, 'user:' + f.visitors[0]);
      if (failure === 'missing-link') kv.store.delete(linkKey);
      else if (failure === 'missing-pointer') kv.store.delete(pointerKey);
      else if (failure === 'pointer') kv.store.set(pointerKey, 's-new-pointer');
      else if (failure === 'link') kv.store.set(linkKey, JSON.stringify({ ...JSON.parse(kv.store.get(linkKey)!), shopperId: 'sh_' + 'f'.repeat(32) }));
      else if (failure === 'unsafe-owner') {
        const childKey = [...bucket.store.keys()].find(k => k.includes('/sessions/'))!, page = JSON.parse(bucket.store.get(childKey)!);
        page.sessions[0].owner.id = 'vis-another'; bucket.store.set(childKey, JSON.stringify(page));
      } else if (failure === 'malformed-record') kv.store.set(oldKey, 'null');
      else {
        const record = JSON.parse(kv.store.get(oldKey)!);
        if (failure === 'userId') record.userId = 'vis-another';
        if (failure === 'forwardTo') record.forwardTo = 's-another';
        if (failure === 'identity') record.identity = { shopperId: 'sh_' + 'f'.repeat(32), linkedAt: 1 };
        kv.store.set(oldKey, JSON.stringify(record));
      }
      const del = vi.spyOn(kv, 'delete'), list = vi.spyOn(kv, 'list'), result = await erase(f);
      expect(result.status, failure).toBe(['unsafe-owner', 'malformed-record'].includes(failure) ? 503 : 409);
      expect(result.body.localComplete).toBe(false); expect(del).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
      expect(kv.store.has(oldKey)).toBe(true); expect(kv.store.has(tenantKey(f.tenant, 'identity:shopper:' + f.sh))).toBe(true);
      vi.restoreAllMocks();
    }
    for (const failure of ['foreign-key', 'malformed-record', 'cursor-cycle']) {
      env = mkEnv(); const f = await seed(), kv = env.SESSIONS as unknown as FakeKV, original = kv.list.bind(kv);
      if (failure === 'malformed-record') kv.store.set(tenantKey(f.tenant, 'session:s-unknown-malformed'), 'null');
      else vi.spyOn(kv, 'list').mockImplementation(async options => {
        if (options?.prefix !== tenantKey(f.tenant, 'session:')) return original(options);
        return failure === 'foreign-key' ? { keys: [{ name: tenantKey('harbor', 'session:s-other') }], list_complete: true }
          : { keys: [], list_complete: false, cursor: options?.cursor === 'a' ? 'b' : 'a' };
      });
      const del = vi.spyOn(kv, 'delete');
      if (failure === 'cursor-cycle') for (let i = 0; i < 3; i++) {
        const pending = await erase(f); expect(pending.status).toBe(202); expect(pending.body.attempted).toBe(0);
      }
      const result = await erase(f); expect(result.status, failure).toBe(503); expect(del).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('W06.05 skips erased history on both actual hosts, preserves indexes and only applies post-cutoff or other-subject/tenant rows', async () => {
    for (const host of ['session', 'do']) {
      env = mkEnv({ REFLEX_HOST: host }); const d = destinations(), f = await currentSeed(d), r2 = env.STORAGE as unknown as FakeR2;
      await configureHistory(f.tenant); await configureHistory('harbor');
      const erased = await erase(f); expect(erased.status).toBe(200); clean(f);
      const at = erased.body.at as number, id = f.visitors[0], store = new IdentityStore(env.SESSIONS as never, f.tenant);
      const replay = (tenant: string, rows: unknown[]) => call('/' + tenant + '/identity/events', { method: 'POST', headers: auth, json: { rows } });
      const row = (who: Record<string, string>, time: number | string, line = 'Tabby') => ({ ...who, action: 'purchase', at: time, product: { line } });
      const writes = vi.spyOn(env.SESSIONS as unknown as FakeKV, 'put'), reads = vi.spyOn(r2, 'get'), listing = vi.spyOn(r2, 'list'); d.calls.length = 0;
      const denied = await replay(f.tenant, [row({ visitorId: id }, at - 1), row({ shopperId: f.sh }, new Date(at).toISOString()), row({ accountId: 'w0601-synthetic-account' }, at)]);
      expect(denied.status).toBe(200); expect(denied.body).toMatchObject({ received: 3, applied: 0, shoppers: 0, perShopper: [] });
      expect(denied.body.skipped.map((s: { index: number }) => s.index)).toEqual([0, 1, 2]);
      expect(writes).not.toHaveBeenCalled(); expect(d.calls).toEqual([]); expect(listing).not.toHaveBeenCalled(); clean(f);
      expect(reads.mock.calls.filter(([key]) => key === tombstoneKey(f.tenant, f.sh))).toHaveLength(1);
      const csv = 'visitor_id,action,at,line\n' + id + ',purchase,' + Math.floor(at / 1000) + ',Tabby';
      const csvDenied = await call('/' + f.tenant + '/identity/events', { method: 'POST', headers: { ...auth, 'Content-Type': 'text/csv' }, body: csv });
      expect(csvDenied.body).toMatchObject({ applied: 0, shoppers: 0 }); expect(writes).not.toHaveBeenCalled();

      const other = 'sh_' + 'e'.repeat(32);
      await seedHistoryTarget(d, f.tenant, f.sh); await seedHistoryTarget(d, f.tenant, other);
      // An erased supplied visitor remains restrictive even when the row explicitly chooses another target.
      const mixed = await replay(f.tenant, [row({ shopperId: f.sh }, at), row({ visitorId: id, shopperId: other }, at),
        row({ shopperId: f.sh }, at + 1, 'Brooklyn'), row({ shopperId: other }, at - 1, 'Rogue')]);
      expect(mixed.status).toBe(200); expect(mixed.body).toMatchObject({ received: 4, applied: 2, shoppers: 2 });
      expect(mixed.body.skipped.map((s: { index: number }) => s.index)).toEqual([0, 1]);
      expect(mixed.body.perShopper.map((p: { rows: number }) => p.rows)).toEqual([1, 1]);
      expect((await store.shopper(f.sh))?.history).toMatchObject({ rows: 1, latestAt: at + 1 });
      expect((await store.shopper(other))?.history?.rows).toBe(1);
      if (host === 'session') {
        const current = await new SessionManager(env, { tenant: f.tenant }).getSessionByUserId(f.sh);
        expect(Object.keys(current!.reflex!.dims.line)).toEqual(['Brooklyn']);
      } else {
        const current = d.object.open(shopperObjectName(f.tenant, f.sh)).data.get('affinity') as { reflex: ReflexState };
        expect(Object.keys(current.reflex.dims.line)).toEqual(['Brooklyn']);
      }
      await freshHistoryLink(f.tenant, 'vis-live-link', f.sh);
      const beforeHistory = (await store.shopper(f.sh))!.history;
      expect((await replay(f.tenant, [row({ visitorId: 'vis-live-link' }, at)])).body.applied).toBe(0);
      expect((await store.shopper(f.sh))!.history).toEqual(beforeHistory);
      await seedHistoryTarget(d, 'harbor', f.sh);
      const foreign = await replay('harbor', [row({ shopperId: f.sh }, at)]);
      expect(foreign.body).toMatchObject({ applied: 1, shoppers: 1 });
      expect((await new IdentityStore(env.SESSIONS as never, 'harbor').shopper(f.sh))?.history?.rows).toBe(1);
      vi.restoreAllMocks();
    }
  });

  it('W06.05 strictly checks all history barriers before writes and never reports a failed DO acknowledgment as applied', async () => {
    for (const host of ['session', 'do']) for (const failure of ['binding', 'read', 'undefined', 'null-json', 'wrong-tenant', 'wrong-subject', 'invalid-cutoff', 'impossible-day']) {
      env = mkEnv({ REFLEX_HOST: host }); const d = destinations(), bucket = env.STORAGE as unknown as FakeR2;
      await configureHistory('meridian');
      const tenant = 'meridian', visitor = 'vis-erased-history', at = Date.now() - 1000, key = tombstoneKey(tenant, visitor);
      await writeTombstone(bucket, tenant, visitor, 'ops', at);
      if (failure === 'binding') (env as unknown as { STORAGE?: unknown }).STORAGE = undefined;
      else if (failure === 'read') vi.spyOn(bucket, 'get').mockImplementation(async k => { if (k === key) throw new Error('synthetic read failure'); return null; });
      else if (failure === 'undefined') vi.spyOn(bucket, 'get').mockImplementation(async k => k === key ? undefined as never : null);
      else if (failure === 'null-json') bucket.store.set(key, 'null');
      else {
        const record = JSON.parse(bucket.store.get(key)!);
        if (failure === 'wrong-tenant') record.tenant = 'harbor';
        if (failure === 'wrong-subject') record.visitor_id = 'vis-another';
        if (failure === 'invalid-cutoff') record.erased_at = -1;
        if (failure === 'impossible-day') record.done_through = '2026-02-30';
        bucket.store.set(key, JSON.stringify(record));
      }
      const rows = [{ visitorId: 'vis-first-valid', action: 'purchase', at, product: { line: 'Brooklyn' } },
        { visitorId: visitor, action: 'purchase', at, product: { line: 'Tabby' } }].map(r => historyRowSchema.parse(r));
      const put = vi.spyOn(env.SESSIONS as unknown as FakeKV, 'put');
      await expect(applyHistory(env, tenant, rows)).rejects.toThrow();
      expect(put).not.toHaveBeenCalled(); expect(d.calls).toEqual([]);
      vi.restoreAllMocks();
    }
    for (const response of [Response.json({ ok: true, applied: 1, audiences: [] }, { status: 503 }), Response.json({ ok: false, applied: 1, audiences: [] }),
      Response.json({ ok: true, audiences: [] }), Response.json({ ok: true, applied: 0, audiences: [] }), Response.json(null)]) {
      env = mkEnv({ REFLEX_HOST: 'do' }); const d = destinations(), shopperId = 'sh_' + 'a'.repeat(32);
      await configureHistory('meridian');
      await seedHistoryTarget(d, 'meridian', shopperId);
      const owner = d.object.open(shopperObjectName('meridian', shopperId)).object, fetch = owner.fetch.bind(owner);
      vi.spyOn(owner, 'fetch').mockImplementation(request => new URL(request.url).pathname === '/identity/import' ? Promise.resolve(response.clone()) : fetch(request));
      await expect(applyHistory(env, 'meridian', [historyRowSchema.parse({ shopperId, action: 'purchase', at: Date.now(), product: { line: 'Tabby' } })])).rejects.toThrow(response.ok ? 'acknowledgment' : 'Shopper session unavailable');
      expect(await new IdentityStore(env.SESSIONS as never, 'meridian').shopper(shopperId)).toBeNull();
      vi.restoreAllMocks();
    }
    const bucket = new FakeR2(), at = Date.now(), tenant = 'meridian', visitor = 'vis-completed';
    await writeTombstone(bucket, tenant, visitor, 'ops', at);
    const key = tombstoneKey(tenant, visitor), record = JSON.parse(bucket.store.get(key)!);
    bucket.store.set(key, JSON.stringify({ ...record, rewritten_at: at, window_days: 1, done_through: new Date(at - 86_400_000).toISOString().slice(0, 10) }));
    expect((await loadTombstone(bucket, tenant, visitor))?.erased_at).toBe(at);
    expect(await loadTombstone(bucket, 'harbor', visitor)).toBeNull();
  });
});

describe('erase: the right to be forgotten (CW28)', () => {
  it('forgets a person: links, both browsers\u2019 profiles, the person\u2019s session, and a tombstone per id', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby']);
    await seedDevice('vis-00000000-0000-4000-8000-000000000002', 's-laptop', ['Rogue']);
    const a = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000002', accountId: 'acct-1001' } });
    const sh = a.body.shopperId as string;

    const r = await call('/coach/identity/erase', { method: 'POST', headers: auth, json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001' } });
    expect(r.status).toBe(200);
    expect(r.body.shopperId).toBe(sh);
    expect(r.body).toMatchObject({ ok: true, status: 'local_complete', complete: false, erased: [] });
    expect([...r.body.targets].sort()).toEqual([sh, 'vis-00000000-0000-4000-8000-000000000002', 'vis-00000000-0000-4000-8000-000000000001'].sort());
    expect(r.body.links).toEqual({ visitors: 2, shopper: true });
    expect(r.body.profiles.filter((p: { host: string }) => p.host === 'session').every((p: { result: string }) => p.result === 'local_completed')).toBe(true);
    expect(r.body.profiles.filter((p: { host: string }) => p.host === 'object').every((p: { result: string }) => p.result === 'unbound')).toBe(true);
    expect(r.body.ledger.map((l: { id: string; tombstone: string | null }) => [l.id, !!l.tombstone]).every(([, t]: [string, boolean]) => t)).toBe(true);
    expect(r.body.notReached[0]).toMatch(/ODP/);
    expect(r.body.notReached.slice(1, 3)).toEqual([
      'Analytics Engine: historical subject-bearing route events are not erased by this operation; dataset contents, retention and disposition remain unverified',
      'Worker/application logs: historical request, event and subject data are not erased by this operation; other logging paths remain and retention/disposition are unverified',
    ]);
    expect(env.ANALYTICS).toBeUndefined(); // Historical limits are unconditional, not a current-binding check.
    expect(r.body.actor).toBe('ops');

    // Nothing resolves to the person any more, and the person's session is gone.
    const sm = new SessionManager(env);
    expect(await sm.resolveSessionIdByUserId(sh)).toBeNull();
    expect(await sm.resolveSessionIdByUserId('vis-00000000-0000-4000-8000-000000000001')).toBeNull();
    // The browsers' own pre-link records, which only the link remembered, are gone too.
    expect(await sm.readRaw('s-phone')).toBeNull();
    expect(await sm.readRaw('s-laptop')).toBeNull();
    expect((await call('/coach/identity/visitor/vis-00000000-0000-4000-8000-000000000002', { headers: auth })).body.shopperId).toBeNull();
    expect((await call(`/coach/identity/shopper/${sh}`, { headers: auth })).status).toBe(404);
    // The tombstones the ledger's readers honour at once.
    const r2 = (env as unknown as { STORAGE: FakeR2 }).STORAGE;
    expect([...r2.store.keys()].filter((k) => k.startsWith('erasures/coach/pending/'))).toHaveLength(3);
  });

  it('forgets an unlinked browser on its own', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000007', 's-alone', ['Tabby']);
    const r = await call('/coach/identity/erase', { method: 'POST', headers: auth, json: { visitorId: 'vis-00000000-0000-4000-8000-000000000007' } });
    expect(r.body.shopperId).toBeNull();
    expect(r.body.erased).toEqual([]); expect(r.body.targets).toEqual(['vis-00000000-0000-4000-8000-000000000007']);
    expect(r.body.profiles[0]).toMatchObject({ id: 'vis-00000000-0000-4000-8000-000000000007', host: 'session', result: 'local_completed' });
    expect((env.SESSIONS as unknown as FakeKV).store.has('session:s-alone')).toBe(false);
  });

  it('accepts a shopper id directly, and is idempotent', async () => {
    await seedDevice('vis-00000000-0000-4000-8000-000000000001', 's-phone', ['Tabby']);
    const a = await signedCall('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000001', accountId: 'acct-1001' } });
    const first = await call('/coach/identity/erase', { method: 'POST', headers: auth, json: { shopperId: a.body.shopperId } });
    expect(first.body.links.visitors).toBe(1);
    const again = await call('/coach/identity/erase', { method: 'POST', headers: auth, json: { shopperId: a.body.shopperId } });
    expect(again.status).toBe(200);
    expect(again.body.links.visitors).toBe(0);
    expect(again.body.profiles[0].result).toBe('local_completed');
    expect(again.body.at).toBeGreaterThan(first.body.at); expect(again.body.erased).toEqual([]);
    expect(again.body.notReached).toEqual(first.body.notReached);
  });

  it('wants the operator token and a real id', async () => {
    expect((await call('/coach/identity/erase', { method: 'POST', json: { visitorId: 'vis-00000000-0000-4000-8000-000000000005' } })).status).toBe(401);
    expect((await call('/coach/identity/erase', { method: 'POST', headers: auth, json: {} })).status).toBe(400);
    expect((await call('/coach/identity/erase', { method: 'POST', headers: auth, json: { shopperId: 'not-a-shopper' } })).status).toBe(400);
  });
});
