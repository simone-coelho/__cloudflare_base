// W04.01 proof-provider controls retained; W04.02 adds owned bootstrap and local generations.
import { describe, it, expect, vi } from 'vitest';
import { createCore } from './core';
import { createIdentity, type IdentifyOptions } from './identify';
import { testHost, syntheticSession } from './testHost';
import { createListen } from './listen';

const LINK = 'https://shop.example/v1/coach/identity/link';
const DETACH = 'https://shop.example/v1/coach/identity/detach';
const SHOPPER = 'sh_' + 'a'.repeat(32);
const SECOND = 'sh_' + 'b'.repeat(32);
const proof = () => ({ assertion: 'backend-proof', exp: 1_800_000_000 });
const response = (json: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
async function fixture() {
  const f = testHost();
  const core = createCore({ tenant: 'coach', sdkKey: 'site-key' }, f.host), identity = createIdentity(core);
  await core.ready();
  f.calls.length = 0;
  return { ...f, core, identity };
}
function gate() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
async function adopt(core: ReturnType<typeof createCore>, session: ReturnType<typeof syntheticSession>) {
  const generation = core.beginTransition();
  try { expect(await core.ready(true)).toBe(true); expect(core.adoptSession(session, generation, 'identified')).toBe(true); }
  finally { core.finishTransition(generation); }
}

describe('identify and logout with owned sessions', () => {
  it('posts exact backend proof, adopts only a server session, persists identity and reconnects', async () => {
    const f = await fixture(), before = f.core.visitorId, oldProfile = f.core.profileSessionId;
    const person = syntheticSession(f.host.now(), SHOPPER);
    f.host.fetch = async (url, init) => { f.calls.push({ url, init }); return response({ ok: true, carry: SHOPPER, shopperId: SHOPPER, outcome: 'linked', session: person }); };
    f.core.connect(); await Promise.resolve();
    const changes: unknown[] = []; f.core.on('identity', change => changes.push(change));
    const r = await f.identity.identify('acct', { source: 'login', ...proof() });
    await Promise.resolve();
    expect(r).toEqual({ ok: true, shopperId: SHOPPER, visitorId: SHOPPER, outcome: 'linked', retried: false });
    expect(f.calls.map(c => c.url)).toEqual([LINK]);
    expect(JSON.parse(f.calls[0]!.init!.body!)).toEqual({ visitorId: before, accountId: 'acct', source: 'login', ...proof() });
    expect(f.calls[0]!.init!.headers).toMatchObject({ 'X-Tenant': 'coach', 'X-SDK-Key': 'site-key', 'X-Shopper-Session': expect.stringMatching(/^ss1\./) });
    expect(f.host.storage.get('opt_visitor_id')).toBe(SHOPPER); expect(f.host.cookie.get('opt_visitor_id')).toBe(SHOPPER);
    expect(f.core.profileSessionId).toBe(person.sessionId); expect(f.core.profileSessionId).not.toBe(oldProfile);
    expect(f.sockets.at(-1)!.url).toBe('wss://shop.example/realtime/ws?tenant=coach');
    expect(f.sockets.at(-1)!.protocols).toEqual(['shopper-session-v1', person.capability, 'sdk-key-v1.' + btoa('site-key').replace(/=/g, '')]);
    expect(changes).toEqual([{ previous: before, visitorId: SHOPPER, reason: 'identified' }]);
    expect(f.core.envelope('page_view').userId).toBe(SHOPPER);
    f.core.disconnect();
  });

  it('refused or malformed link changes no identity, while logout requires application success and rotates both identities', async () => {
    const f = await fixture(), before = f.core.visitorId;
    f.host.fetch = async () => response({ ok: false, error: 'assertion invalid' }, 401);
    expect(await f.identity.identify('acct')).toMatchObject({ ok: false, status: 401, error: 'assertion invalid' });
    expect(f.core.visitorId).toBe(before);
    expect(await f.identity.identify('')).toMatchObject({ ok: false, error: 'accountId required' });
    f.host.fetch = async () => response({ ok: true, carry: SHOPPER });
    expect(await f.identity.identify('acct', proof())).toMatchObject({ ok: false });
    expect(f.core.visitorId).toBe(before);
    const person = syntheticSession(f.host.now(), SHOPPER), fresh = syntheticSession(f.host.now());
    await adopt(f.core, person);
    const oldBrowsing = f.core.sessionId;
    f.host.fetch = async (url, init) => { f.calls.push({ url, init }); return response({ ok: true, detached: true, session: fresh }); };
    expect(await f.identity.logout()).toMatchObject({ ok: true, visitorId: fresh.subject });
    expect(f.calls.at(-1)!.url).toBe(DETACH); expect(f.core.profileSessionId).toBe(fresh.sessionId);
    expect(f.core.sessionId).not.toBe(oldBrowsing);
  });

  it('provider409 retries once only after successful detach, with proof for the fresh owned visitor', async () => {
    const f = await fixture(), person = syntheticSession(f.host.now(), SHOPPER), fresh = syntheticSession(f.host.now()), next = syntheticSession(f.host.now(), SECOND);
    await adopt(f.core, person);
    let links = 0;
    f.host.fetch = async (url, init) => { f.calls.push({ url, init });
      return url === DETACH ? response({ ok: true, detached: true, session: fresh })
        : ++links === 1 ? response({ ok: false, error: 'conflict' }, 409) : response({ ok: true, carry: SECOND, session: next });
    };
    const provider = vi.fn(proof);
    expect(await f.identity.identify('acct-2', { assertion: 'static-must-not-win', exp: 1, getAssertion: provider })).toMatchObject({ ok: true, shopperId: SECOND, retried: true });
    expect(f.calls.map(c => c.url)).toEqual([LINK, DETACH, LINK]);
    expect(provider.mock.calls).toHaveLength(2);
    expect(provider).toHaveBeenNthCalledWith(1, { tenant: 'coach', visitorId: SHOPPER, accountId: 'acct-2' });
    expect(provider).toHaveBeenNthCalledWith(2, { tenant: 'coach', visitorId: fresh.subject, accountId: 'acct-2' });
    expect(f.calls.filter(c => c.url === LINK).map(c => JSON.parse(c.init!.body!).assertion)).toEqual(['backend-proof', 'backend-proof']);
  });

  it('provider wins over static fields and invalid/throwing providers never fall back', async () => {
    for (const getAssertion of [() => { throw new Error('PRIVATE'); }, () => undefined, () => ({}), () => ({ assertion: ' ', exp: 1 }), () => ({ assertion: 'proof', exp: NaN }), () => ({ assertion: 'proof', exp: 1.5 }), 'invalid']) {
      const f = await fixture(), before = f.core.visitorId;
      const r = await f.identity.identify('acct', { ...proof(), getAssertion: getAssertion as unknown as IdentifyOptions['getAssertion'] });
      expect(r).toMatchObject({ ok: false, status: 0, retried: false }); expect(JSON.stringify(r)).not.toContain('PRIVATE');
      expect(f.calls).toEqual([]); expect(f.core.visitorId).toBe(before);
    }
  });

  it('static409 never detaches; failed detach/fresh proof or a second409 cannot loop', async () => {
    for (const mode of ['static', 'http', 'application', 'not-detached', 'missing', 'proof', 'second409']) {
      const f = await fixture(), before = f.core.visitorId, fresh = syntheticSession(f.host.now());
      f.host.fetch = async (url, init) => { f.calls.push({ url, init });
        if (url === LINK) return response({ ok: false, error: 'conflict' }, 409);
        if (mode === 'http') return response({ ok: true, detached: true, session: fresh }, 500);
        if (mode === 'application') return response({ ok: false, detached: true, session: fresh });
        if (mode === 'not-detached') return response({ ok: true, detached: false, session: fresh });
        if (mode === 'missing') return response(null);
        return response({ ok: true, detached: true, session: fresh });
      };
      let proofs = 0;
      const getAssertion = () => { if (++proofs > 1 && mode === 'proof') throw new Error('PRIVATE'); return proof(); };
      const r = await f.identity.identify('acct', { ...proof(), ...(mode === 'static' ? {} : { getAssertion }) });
      expect(r.ok).toBe(false); expect(r.retried).toBe(mode === 'second409'); expect(JSON.stringify(r)).not.toContain('PRIVATE');
      expect(f.calls.filter(c => c.url === LINK)).toHaveLength(mode === 'second409' ? 2 : 1);
      expect(f.calls.filter(c => c.url === DETACH)).toHaveLength(mode === 'static' ? 0 : 1);
      expect(f.core.visitorId).toBe(['proof', 'second409'].includes(mode) ? fresh.subject : before);
    }
  });

  it('rejects stale proof/link/detach and ABA, including the caller continuation microtask', async () => {
    for (const phase of ['proof', 'link', 'detach']) {
      const f = await fixture(), hold = gate(), entered = gate(), before = f.core.visitorId;
      f.host.fetch = async (url, init) => { f.calls.push({ url, init });
        if ((phase === 'link' && url === LINK) || (phase === 'detach' && url === DETACH)) { entered.release(); await hold.promise; }
        return url === LINK && phase === 'detach' ? response({ ok: false }, 409) : response({ ok: true, carry: SHOPPER, detached: true, session: syntheticSession(f.host.now(), SHOPPER) });
      };
      const pending = f.identity.identify('acct', { getAssertion: async () => { if (phase === 'proof') { entered.release(); await hold.promise; } return proof(); } });
      await entered.promise;
      f.core.setVisitorId('temporary', 'logout'); f.core.setVisitorId(before, 'logout');
      hold.release();
      expect(await pending).toMatchObject({ ok: false, status: 0, error: 'identity changed during identify', retried: false });
      expect(f.core.visitorId).toBe(before);
      expect(f.calls.filter(c => c.url === LINK)).toHaveLength(phase === 'proof' ? 0 : 1);
    }
    for (const status of [200, 409]) {
      const f = await fixture();
      f.host.fetch = async (url, init) => { f.calls.push({ url, init }); return response({ ok: status === 200, carry: SHOPPER, session: syntheticSession(f.host.now(), SHOPPER) }, status); };
      const post = f.core.postJson;
      f.core.postJson = async (path, body) => { const result = await post(path, body); queueMicrotask(() => queueMicrotask(() => f.core.setVisitorId('newer', 'logout'))); return result; };
      expect(await f.identity.identify('acct', { getAssertion: proof })).toMatchObject({ ok: false, error: 'identity changed during identify' });
      expect(f.calls.map(c => c.url)).toEqual([LINK]);
    }
  });

  it('W04.02 transition pauses new data, clears cached decisions and ignores stale callbacks/results', async () => {
    const f = await fixture(), listen = createListen(f.core), hold = gate(), entered = gate();
    listen.apply({ page: 'home', decisions: [] });
    const pending = f.identity.identify('acct', { getAssertion: async () => { entered.release(); await hold.promise; return proof(); } });
    await entered.promise; expect(listen.current()).toBeNull();
    expect(await f.core.send('page_view')).toBeNull(); expect(await listen.hydrate({ page: 'home' })).toBeNull(); expect(f.calls).toEqual([]);
    f.core.setVisitorId('newer', 'logout'); hold.release(); expect((await pending).ok).toBe(false);
    const c = await fixture(), updates: unknown[] = [];
    c.host.fetch = async () => response({ update: { data: { segments: ['private'] } }, odp: { receiptId: 'private' } });
    c.core.on('sent', () => c.core.setVisitorId('callback-newer', 'logout')); c.core.on('update', update => updates.push(update));
    expect(await c.core.send('page_view')).toBeNull(); expect(updates).toEqual([]);
  });

  it('W04.02 failed logout discards the local grant without clearing a newer transition', async () => {
    for (const mode of ['http', 'application', 'missing']) {
      const f = await fixture(); await adopt(f.core, syntheticSession(f.host.now(), SHOPPER));
      f.host.fetch = async () => response(mode === 'missing' ? null : { ok: mode !== 'application', detached: true }, mode === 'http' ? 500 : 200);
      expect((await f.identity.logout()).ok).toBe(false); expect(f.core.visitorId).toBe(''); expect(f.core.headers()).not.toHaveProperty('X-Shopper-Session');
    }
    const f = await fixture(), hold = gate(), entered = gate();
    f.host.fetch = async () => { entered.release(); await hold.promise; return response(null, 500); };
    const pending = f.identity.logout(); await entered.promise;
    const generation = f.core.beginTransition(), newer = syntheticSession(f.host.now(), SECOND);
    const ready = f.core.ready(true); hold.release(); expect(await ready).toBe(true);
    expect(f.core.adoptSession(newer, generation, 'identified')).toBe(true); f.core.finishTransition(generation);
    expect((await pending).ok).toBe(false); expect(f.core.visitorId).toBe(SECOND);
  });
});
