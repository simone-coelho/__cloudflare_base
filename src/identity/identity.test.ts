// src/identity/identity.test.ts
//
// The primitives: the id a person gets, the proof the site gives, and the link
// table. Nothing here touches a profile; that is link.test.ts.

import { describe, it, expect } from 'vitest';
import { isSalted, isShopperId, shopperIdFor } from '@/identity/shopperId';
import { secretsFor, signAssertion, verifyAssertion } from '@/identity/assertion';
import { IdentityStore } from '@/identity/store';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) { const r = this.store.get(key); return r === undefined ? null : (type === 'json' ? JSON.parse(r) : r); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(o?: { prefix?: string }) { const p = o?.prefix ?? ''; return { keys: [...this.store.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; }
}

describe('the shopper id', () => {
  it('is deterministic, opaque, and in its own format', async () => {
    const a = await shopperIdFor({}, 'coach', 'acct-1001');
    const b = await shopperIdFor({}, 'coach', 'acct-1001');
    expect(a).toBe(b);
    expect(isShopperId(a)).toBe(true);
    expect(a).not.toContain('1001');
  });

  it('differs by brand for the same account: isolation applied to people', async () => {
    expect(await shopperIdFor({}, 'coach', 'acct-1001')).not.toBe(await shopperIdFor({}, 'kate-spade', 'acct-1001'));
  });

  it('differs with the salt, and says whether one was used', async () => {
    const unsalted = await shopperIdFor({}, 'coach', 'acct-1001');
    const salted = await shopperIdFor({ IDENTITY_SALT: 'pepper' }, 'coach', 'acct-1001');
    expect(salted).not.toBe(unsalted);
    expect(isSalted({})).toBe(false);
    expect(isSalted({ IDENTITY_SALT: 'pepper' })).toBe(true);
  });

  it('trims but never case-folds: two accounts a site treats as distinct stay distinct', async () => {
    expect(await shopperIdFor({}, 'coach', ' A@x.com ')).toBe(await shopperIdFor({}, 'coach', 'A@x.com'));
    expect(await shopperIdFor({}, 'coach', 'A@x.com')).not.toBe(await shopperIdFor({}, 'coach', 'a@x.com'));
  });

  it('recognises only its own format', () => {
    expect(isShopperId('vis-abc')).toBe(false);
    expect(isShopperId('sh_' + 'f'.repeat(32))).toBe(true);
    expect(isShopperId('sh_' + 'f'.repeat(31))).toBe(false);
    expect(isShopperId('SH_' + 'f'.repeat(32))).toBe(false);
  });
});

describe('the assertion', () => {
  const nowMs = 1_800_000_000_000;
  const exp = Math.floor(nowMs / 1000) + 300;
  const claim = { visitorId: 'vis-1', accountId: 'acct-1001', exp };

  it('is not required for a tenant with no secret, and the record says so', async () => {
    const v = await verifyAssertion({}, 'coach', { visitorId: 'vis-1', accountId: 'acct-1001' }, nowMs);
    expect(v).toEqual({ ok: true, assurance: 'site' });
  });

  it('is required once the tenant has a secret', async () => {
    const v = await verifyAssertion({ IDENTITY_SECRETS: 'coach:s3cret' }, 'coach', { visitorId: 'vis-1', accountId: 'acct-1001' }, nowMs);
    expect(v.ok).toBe(false);
  });

  it('verifies what the site signed, and nothing else', async () => {
    const env = { IDENTITY_SECRETS: 'coach:s3cret' };
    const assertion = await signAssertion('s3cret', 'coach', 'vis-1', 'acct-1001', exp);
    expect(await verifyAssertion(env, 'coach', { ...claim, assertion }, nowMs)).toEqual({ ok: true, assurance: 'signed' });
    // A different visitor, account, tenant or expiry: the signature no longer covers the claim.
    expect((await verifyAssertion(env, 'coach', { ...claim, visitorId: 'vis-2', assertion }, nowMs)).ok).toBe(false);
    expect((await verifyAssertion(env, 'coach', { ...claim, accountId: 'acct-1002', assertion }, nowMs)).ok).toBe(false);
    expect((await verifyAssertion({ IDENTITY_SECRETS: 'kate-spade:s3cret' }, 'kate-spade', { ...claim, assertion }, nowMs)).ok).toBe(false);
    expect((await verifyAssertion(env, 'coach', { ...claim, exp: exp + 1, assertion }, nowMs)).ok).toBe(false);
  });

  it('refuses an expired assertion and one dated too far ahead', async () => {
    const env = { IDENTITY_SECRETS: 'coach:s3cret' };
    const past = Math.floor(nowMs / 1000) - 1;
    const pastSig = await signAssertion('s3cret', 'coach', 'vis-1', 'acct-1001', past);
    expect(await verifyAssertion(env, 'coach', { ...claim, exp: past, assertion: pastSig }, nowMs)).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) });
    const far = Math.floor(nowMs / 1000) + 2 * 24 * 3600;
    const farSig = await signAssertion('s3cret', 'coach', 'vis-1', 'acct-1001', far);
    expect(await verifyAssertion(env, 'coach', { ...claim, exp: far, assertion: farSig }, nowMs)).toMatchObject({ ok: false, reason: expect.stringMatching(/too far/) });
  });

  it('accepts the previous secret during a rotation, and a wildcard secret', async () => {
    const old = await signAssertion('old', 'coach', 'vis-1', 'acct-1001', exp);
    expect((await verifyAssertion({ IDENTITY_SECRETS: 'coach:new|old' }, 'coach', { ...claim, assertion: old }, nowMs)).ok).toBe(true);
    const wild = await signAssertion('any', 'kate-spade', 'vis-1', 'acct-1001', exp);
    expect((await verifyAssertion({ IDENTITY_SECRETS: '*:any' }, 'kate-spade', { ...claim, assertion: wild }, nowMs)).ok).toBe(true);
    expect(secretsFor({ IDENTITY_SECRETS: 'coach:a|b,*:c' }, 'coach')).toEqual(['a', 'b', 'c']);
  });
});

describe('the link table', () => {
  const sh1 = 'sh_' + '1'.repeat(32);
  const sh2 = 'sh_' + '2'.repeat(32);

  it('links, resolves, and is idempotent for the same pair', async () => {
    const store = new IdentityStore(new FakeKV(), 'coach');
    const first = await store.link({ visitorId: 'vis-a', shopperId: sh1, assurance: 'site', source: 'login', salted: false, now: 1000 });
    expect(first.outcome).toBe('linked');
    expect(await store.resolveVisitor('vis-a')).toBe(sh1);
    const again = await store.link({ visitorId: 'vis-a', shopperId: sh1, assurance: 'site', source: 'login', salted: false, now: 2000 });
    expect(again.outcome).toBe('already');
    expect(again.link.linkedAt).toBe(1000);
    expect(again.shopper.visitors).toHaveLength(1);
  });

  it('a shopper id resolves to itself; an unknown visitor to nobody', async () => {
    const store = new IdentityStore(new FakeKV(), 'coach');
    expect(await store.resolveVisitor(sh1)).toBe(sh1);
    expect(await store.resolveVisitor('vis-nobody')).toBeNull();
  });

  it('moves a browser to another person and keeps the trail', async () => {
    const store = new IdentityStore(new FakeKV(), 'coach');
    await store.link({ visitorId: 'vis-a', shopperId: sh1, assurance: 'site', source: 'login', salted: false, now: 1000 });
    const moved = await store.link({ visitorId: 'vis-a', shopperId: sh2, assurance: 'signed', source: 'login', salted: false, now: 5000 });
    expect(moved.outcome).toBe('relinked');
    expect(moved.link.previous).toEqual([{ shopperId: sh1, linkedAt: 1000, until: 5000 }]);
    expect(await store.resolveVisitor('vis-a')).toBe(sh2);
    // Both people remember the browser: the first as history, the second as current.
    expect((await store.shopper(sh1))!.visitors.map((v) => v.visitorId)).toEqual(['vis-a']);
    expect((await store.shopper(sh2))!.visitors.map((v) => v.visitorId)).toEqual(['vis-a']);
  });

  it('two browsers on one person: the cross-device case', async () => {
    const store = new IdentityStore(new FakeKV(), 'coach');
    await store.link({ visitorId: 'vis-phone', shopperId: sh1, assurance: 'site', source: 'login', salted: false });
    await store.link({ visitorId: 'vis-laptop', shopperId: sh1, assurance: 'site', source: 'checkout', salted: false });
    expect((await store.shopper(sh1))!.visitors.map((v) => v.visitorId).sort()).toEqual(['vis-laptop', 'vis-phone']);
  });

  it('is isolated per brand, and never stores the account id', async () => {
    const kv = new FakeKV();
    await new IdentityStore(kv, 'coach').link({ visitorId: 'vis-a', shopperId: sh1, assurance: 'site', source: 'login', salted: false });
    expect(await new IdentityStore(kv, 'kate-spade').resolveVisitor('vis-a')).toBeNull();
    expect(await new IdentityStore(kv, 'coach').resolveVisitor('vis-a')).toBe(sh1);
    expect([...kv.store.keys()].every((k) => k.startsWith('identity:'))).toBe(true);
    await new IdentityStore(kv, 'kate-spade').link({ visitorId: 'vis-b', shopperId: sh2, assurance: 'site', source: 'login', salted: false });
    expect([...kv.store.keys()].some((k) => k.startsWith('t:kate-spade:identity:'))).toBe(true);
  });

  it('records applied history on the person', async () => {
    const store = new IdentityStore(new FakeKV(), 'coach');
    await store.noteHistory(sh1, 3, 1_000, false, 5_000);
    await store.noteHistory(sh1, 2, 900, false, 6_000);
    expect((await store.shopper(sh1))!.history).toEqual({ rows: 5, latestAt: 1_000, appliedAt: 6_000 });
  });
});
