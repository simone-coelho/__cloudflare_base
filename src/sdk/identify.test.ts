// src/sdk/identify.test.ts
// CW25, the client half: identify() and logout() against the contract in
// docs/architecture/25-identity-stitching.md §4, with the server faked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCore } from './core';
import { createIdentity } from './identify';
import { testHost } from './testHost';
import type { ClientConfig, Host } from './types';

// The client's identify() and logout() are one-line delegations to this pair; index.ts pulls the
// browser host (DOM types) into the root typecheck, so the test builds the pair the way the client does.
function createClient(config: ClientConfig, host: Host) {
  const core = createCore(config, host);
  const identity = createIdentity(core);
  return { core, get visitorId() { return core.visitorId; }, connect: () => core.connect(), on: core.on, identify: identity.identify, logout: identity.logout };
}

const LINK = 'https://shop.example/v1/coach/identity/link';
const DETACH = 'https://shop.example/v1/coach/identity/detach';

describe('identify and logout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('posts the contract, stores the shopper id in both stores, reconnects the socket under it, and says so', async () => {
    const { host, calls, sockets } = testHost({ responses: (url) => (url === LINK ? { ok: true, shopperId: 'shp-9', carry: 'shp-9', outcome: 'linked' } : { ok: true }) });
    const client = createClient({ tenant: 'coach', sdkKey: 'k-1' }, host);
    const before = client.visitorId;
    expect(before).toMatch(/^vis-/);
    client.connect();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toContain(`userId=${before}`);
    const changes: unknown[] = [];
    client.on('identity', (c) => changes.push(c));
    const r = await client.identify('acct-42', { source: 'login', exp: 1_800_000_000, assertion: 'sig' });
    expect(r).toEqual({ ok: true, shopperId: 'shp-9', visitorId: 'shp-9', outcome: 'linked', retried: false });
    const link = calls.find((c) => c.url === LINK)!;
    expect(link.init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-SDK-Key': 'k-1' } });
    expect(JSON.parse(link.init!.body!)).toEqual({ visitorId: before, accountId: 'acct-42', source: 'login', exp: 1_800_000_000, assertion: 'sig' });
    expect(client.visitorId).toBe('shp-9');
    expect(host.storage.get('opt_visitor_id')).toBe('shp-9');
    expect(host.cookie.get('opt_visitor_id')).toBe('shp-9');
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.url).toContain('userId=shp-9');
    expect(changes).toEqual([{ visitorId: 'shp-9', previous: before, reason: 'identified' }]);
    // every later event is the person's
    expect(client.core.envelope('page_view').userId).toBe('shp-9');
  });

  it('a refused link changes nothing', async () => {
    const { host, sockets } = testHost({ responses: () => ({ ok: false, error: 'assertion invalid' }) });
    host.fetch = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'assertion invalid' }) });
    const client = createClient({ tenant: 'coach' }, host);
    const before = client.visitorId;
    const r = await client.identify('acct-42');
    expect(r).toEqual({ ok: false, status: 401, error: 'assertion invalid', retried: false });
    expect(client.visitorId).toBe(before);
    expect(sockets).toHaveLength(0);
    expect(await client.identify('')).toMatchObject({ ok: false, error: 'accountId required' });
  });

  it('logout detaches, mints a fresh anonymous id, and reconnects under it', async () => {
    const { host, calls, sockets } = testHost({ responses: (url) => (url === LINK ? { ok: true, carry: 'shp-9' } : { ok: true, detached: true }) });
    const client = createClient({ tenant: 'coach' }, host);
    client.connect();
    await client.identify('acct-42');
    expect(client.visitorId).toBe('shp-9');
    const out = await client.logout();
    expect(out.ok).toBe(true);
    expect(calls.find((c) => c.url === DETACH)).toBeTruthy();
    expect(client.visitorId).toMatch(/^vis-/);
    expect(client.visitorId).not.toBe('shp-9');
    expect(host.storage.get('opt_visitor_id')).toBe(client.visitorId);
    expect(sockets[sockets.length - 1]!.url).toContain(`userId=${client.visitorId}`);
  });

  it('on 409 the previous person is logged out and the link is retried once with the fresh id', async () => {
    const { host, calls } = testHost();
    let links = 0;
    host.fetch = async (url, init) => {
      calls.push({ url, init });
      if (url === LINK) {
        links += 1;
        const body = JSON.parse(String(init?.body)) as { visitorId: string };
        if (links === 1) return { ok: false, status: 409, json: async () => ({ ok: false, error: 'this browser already carries a shopper id; detach first' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, carry: 'shp-2', linkedFrom: body.visitorId }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, detached: true }) };
    };
    host.storage.set('opt_visitor_id', 'shp-1');                              // the previous person never logged out
    const client = createClient({ tenant: 'coach' }, host);
    expect(client.visitorId).toBe('shp-1');
    const r = await client.identify('acct-2');
    expect(r).toMatchObject({ ok: true, shopperId: 'shp-2', retried: true });
    const linkCalls = calls.filter((c) => c.url === LINK).map((c) => JSON.parse(String(c.init?.body)) as { visitorId: string });
    expect(linkCalls[0]!.visitorId).toBe('shp-1');
    expect(linkCalls[1]!.visitorId).toMatch(/^vis-/);                        // never the old shopper id again
    expect(calls.some((c) => c.url === DETACH)).toBe(true);
    expect(client.visitorId).toBe('shp-2');
  });
});
