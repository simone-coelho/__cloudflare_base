// src/routes/identity.test.ts
//
// CW25 through the wire, on the session host: a phone and a laptop browse as
// strangers, both sign in to the same account, and the person is the sum. Then
// the rules around the edges: the assertion, the shopper-id refusal, the shared
// computer, detach, history in both formats, and who may ask what.

import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { identityRoutes } from '@/routes/identity';
import { SessionManager } from '@/services/SessionManager';
import { DEFAULT_REFLEX_CONFIG, apply, audienceKey, emptyState, snapshot, type ReflexState } from '@/reflex/core';
import { signAssertion } from '@/identity/assertion';
import { shopperIdFor } from '@/identity/shopperId';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) { const r = this.store.get(key); return r === undefined ? null : (type === 'json' ? JSON.parse(r) : r); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(o?: { prefix?: string }) { const p = o?.prefix ?? ''; return { keys: [...this.store.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; }
}

const cfg = DEFAULT_REFLEX_CONFIG;
const TABBY = audienceKey('line', 'Tabby');

const mkEnv = (over: Record<string, unknown> = {}): Env => ({
  CACHE: new FakeKV(), SESSIONS: new FakeKV(), ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock',
  JWT_SECRET: 's', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', ...over,
} as unknown as Env);
const token = () => new jose.SignJWT({ sub: 'ops' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode('s'));

const browse = (values: string[], at: number): ReflexState => {
  let s = emptyState(cfg);
  values.forEach((v, i) => { s = apply(s, { action: 'product_view', touches: [{ dim: 'line', value: v }] }, at + i * 1000, cfg).state; });
  return s;
};

let env: Env;
let auth: Record<string, string>;

async function seedDevice(visitorId: string, sessionId: string, values: string[]) {
  const sm = new SessionManager(env);
  // Built a few seconds ago, not at T0: the route merges at Date.now(), and a vector from 2023 is dust by now.
  await sm.createOrUpdateSession(sessionId, visitorId, { reflex: browse(values, Date.now() - 5_000), attributes: { product_views: values.length } });
}

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> ?? {}) };
  let body = init.body;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  const res = await identityRoutes.request(path, { ...init, headers, body }, env);
  return { status: res.status, body: (await res.json()) as Record<string, any>, headers: res.headers };
}

beforeEach(async () => {
  env = mkEnv();
  auth = { Authorization: `Bearer ${await token()}` };
});

describe('the link, on the session host', () => {
  it('a phone signs in: the response names the person, sets the cookie, and the old cookie reads the person', async () => {
    await seedDevice('vis-phone', 's-phone', ['Tabby', 'Tabby', 'Tabby']);
    const r = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-phone', accountId: 'acct-1001' } });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('linked');
    expect(r.body.assurance).toBe('site');
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
    await seedDevice('vis-phone', 's-phone', ['Tabby', 'Tabby']);
    await seedDevice('vis-laptop', 's-laptop', ['Rogue', 'Rogue', 'Tabby']);
    const a = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-phone', accountId: 'acct-1001' } });
    const b = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-laptop', accountId: 'acct-1001', source: 'checkout' } });
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

  it('signing in again from the same browser merges nothing and still answers the cookie', async () => {
    await seedDevice('vis-phone', 's-phone', ['Tabby']);
    const a = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-phone', accountId: 'acct-1001' } });
    const b = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-phone', accountId: 'acct-1001' } });
    expect(b.body.outcome).toBe('already');
    expect(b.headers.get('set-cookie')).toContain('opt_session_id=');
    const sm = new SessionManager(env);
    expect((await sm.getSessionByUserId(a.body.shopperId))!.attributes.product_views).toBe(1);
  });

  it('a shared computer, second account without a logout: the second person inherits nothing, the first stays whole', async () => {
    // A client that did not adopt the id links the same visitor id to a second
    // account. (One that did adopt it carries a shopper id and gets a 409 below.)
    await seedDevice('vis-shared', 's-shared', ['Tabby', 'Tabby', 'Tabby']);
    const first = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-shared', accountId: 'acct-1001' } });
    const firstSid = /opt_session_id=([^;]+)/.exec(first.headers.get('set-cookie') ?? '')?.[1];
    const second = await call('/coach/identity/link', {
      method: 'POST', headers: { Cookie: `opt_session_id=${firstSid}` }, json: { visitorId: 'vis-shared', accountId: 'acct-2002' },
    });
    expect(second.body.outcome).toBe('relinked');
    expect(second.body.shopperId).not.toBe(first.body.shopperId);
    expect(second.body.audiences).toEqual([]);
    const secondSid = /opt_session_id=([^;]+)/.exec(second.headers.get('set-cookie') ?? '')?.[1];
    expect(secondSid).not.toBe(firstSid);
    const sm = new SessionManager(env);
    // The device now lands on person 2 (its cookie), the visitor key points there too,
    // and person 1's session was neither forwarded nor emptied.
    expect((await sm.getSession(secondSid!))?.userId).toBe(second.body.shopperId);
    expect(await sm.resolveSessionIdByUserId('vis-shared')).toBe(secondSid);
    const personOne = await sm.readRaw(firstSid!);
    expect(personOne?.forwardTo).toBeUndefined();
    expect(personOne?.reflex?.audiences).toContain(TABBY);
  });

  it('refuses to link a browser that already carries a shopper id', async () => {
    const sh = await shopperIdFor(env, 'coach', 'acct-1001');
    const r = await call('/coach/identity/link', { method: 'POST', json: { visitorId: sh, accountId: 'acct-2002' } });
    expect(r.status).toBe(409);
  });

  it('a browser with no session yet links fine: the person starts empty', async () => {
    const r = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-fresh', accountId: 'acct-1001' } });
    expect(r.status).toBe(200);
    expect(r.body.audiences).toEqual([]);
    const sm = new SessionManager(env);
    expect(await sm.resolveSessionIdByUserId('vis-fresh')).toBe(await sm.resolveSessionIdByUserId(r.body.shopperId));
  });

  it('validates the body and the tenant', async () => {
    expect((await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-1' } })).status).toBe(400);
    expect((await call('/coach/identity/link', { method: 'POST', json: { visitorId: 't:kate-spade:vis-1', accountId: 'a' } })).status).toBe(400);
    expect((await call('/not a tenant/identity/link', { method: 'POST', json: { visitorId: 'vis-1', accountId: 'a' } })).status).toBe(400);
  });
});

describe('the assertion, when the tenant has a secret', () => {
  beforeEach(() => { env = mkEnv({ IDENTITY_SECRETS: 'coach:s3cret' }); });

  it('refuses an unsigned link, accepts the site-signed one, and records signed assurance', async () => {
    const unsigned = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-1', accountId: 'acct-1001' } });
    expect(unsigned.status).toBe(401);
    const exp = Math.floor(Date.now() / 1000) + 120;
    const assertion = await signAssertion('s3cret', 'coach', 'vis-1', 'acct-1001', exp);
    const signed = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-1', accountId: 'acct-1001', exp, assertion } });
    expect(signed.status).toBe(200);
    expect(signed.body.assurance).toBe('signed');
    const forged = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-1', accountId: 'acct-9999', exp, assertion } });
    expect(forged.status).toBe(401);
  });
});

describe('detach', () => {
  it('clears the cookies and deletes nothing', async () => {
    await seedDevice('vis-phone', 's-phone', ['Tabby']);
    const linked = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-phone', accountId: 'acct-1001' } });
    const r = await call('/coach/identity/detach', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain('opt_session_id=; Max-Age=0');
    const sm = new SessionManager(env);
    expect((await sm.getSessionByUserId(linked.body.shopperId))?.userId).toBe(linked.body.shopperId);
  });
});

describe('the data team’s doors', () => {
  it('resolve, visitor and shopper want the operator token', async () => {
    expect((await call('/coach/identity/resolve', { method: 'POST', json: { accountIds: ['a'] } })).status).toBe(401);
    expect((await call('/coach/identity/visitor/vis-1')).status).toBe(401);
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
    await seedDevice('vis-phone', 's-phone', ['Tabby']);
    const linked = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-phone', accountId: 'acct-1001' } });
    const v = await call('/coach/identity/visitor/vis-phone', { headers: auth });
    expect(v.body.shopperId).toBe(linked.body.shopperId);
    expect(v.body.link.source).toBe('login');
    const s = await call(`/coach/identity/shopper/${linked.body.shopperId}`, { headers: auth });
    expect(s.body.shopper.visitors.map((x: { visitorId: string }) => x.visitorId)).toEqual(['vis-phone']);
    expect(JSON.stringify(s.body)).not.toContain('acct-1001');
    expect((await call('/coach/identity/visitor/vis-nobody', { headers: auth })).body.shopperId).toBeNull();
    expect((await call('/coach/identity/shopper/sh_' + 'e'.repeat(32), { headers: auth })).status).toBe(404);
  });
});

describe('historical rows', () => {
  it('JSON rows by account id build the person before they ever visit, discounted by their age', async () => {
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
    expect(r.body.perShopper[0]).toMatchObject({ shopperId: sh, rows: 3, created: true });
    const sm = new SessionManager(env);
    const person = await sm.getSessionByUserId(sh);
    const snap = snapshot(person!.reflex!, Date.now(), cfg);
    // Two purchases a minute ago at weight 5 are plenty; the day-old one is dust.
    expect(snap.dims.line.Brooklyn).toBeGreaterThanOrEqual(cfg.thetaIn);
    expect(person!.metadata.visitCount).toBeUndefined();
    const rec = await call(`/coach/identity/shopper/${sh}`, { headers: auth });
    expect(rec.body.shopper.history.rows).toBe(3);

    // Then she signs in on her phone: the browser folds into the person the import built.
    await seedDevice('vis-phone', 's-phone', ['Tabby']);
    const linked = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-phone', accountId: 'acct-1001' } });
    expect(linked.body.audiences).toContain(audienceKey('line', 'Brooklyn'));
  });

  it('CSV rows, the way a warehouse exports them', async () => {
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
    await seedDevice('vis-phone', 's-phone', ['Tabby']);
    const linked = await call('/coach/identity/link', { method: 'POST', json: { visitorId: 'vis-phone', accountId: 'acct-1001' } });
    const r = await call('/coach/identity/events', { method: 'POST', headers: auth, json: { rows: [
      { visitorId: 'vis-phone', action: 'purchase', at: Date.now() - 1000, product: { line: 'Rogue' } },
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
