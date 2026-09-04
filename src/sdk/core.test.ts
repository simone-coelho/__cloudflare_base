import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCore } from './core';
import { testHost } from './testHost';

describe('core', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('builds the envelope the storefront sends, field for field', () => {
    const { host } = testHost();
    const core = createCore({ tenant: 'coach', source: 'coach-storefront', surface: 'coach' }, host);
    const env = core.envelope('product_view', { productId: 'SKU-1' });
    expect(Object.keys(env)).toEqual(['type', 'userId', 'anonymousId', 'sessionId', 'data', 'source', 'surface', 'entry', 'timestamp']);
    expect(env.userId).toMatch(/^vis-/);
    expect(env.anonymousId).toMatch(/^v-[A-Z0-9]{9}$/);
    expect(env.sessionId).toMatch(/^s-[A-Z0-9]+$/);
    expect(env.data).toEqual({ productId: 'SKU-1' });
    expect(env.entry).toEqual({ utmMedium: 'paid_social', utmSource: 'tiktok', referrer: 'https://www.tiktok.com/', siteHost: 'shop.example' });
    expect(env.timestamp).toBe(1_725_000_000_000);
    expect(Object.keys(createCore({ tenant: 'coach' }, host).envelope('page_view'))).not.toContain('surface');
  });

  it('POSTs to /realtime/action with credentials, applies the update, and reports the receipt', async () => {
    const { host, calls } = testHost({ responses: () => ({ success: true, update: { data: { timestamp: 7, segments: ['evening_affinity'] } }, odp: { receiptId: 'r1' } }) });
    const core = createCore({ tenant: 'coach', sdkKey: 'k-1' }, host);
    const updates: unknown[] = [], receipts: unknown[] = [], sent: unknown[] = [];
    core.on('update', (u, m) => updates.push([u, m])); core.on('receipt', (r) => receipts.push(r)); core.on('sent', (_e, m) => sent.push(m));
    const out = await core.send('add_to_cart', { productId: 'SKU-1' });
    expect(calls[0]?.url).toBe('https://shop.example/realtime/action');
    expect(calls[0]?.init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-SDK-Key': 'k-1' } });
    expect(JSON.parse(calls[0]!.init!.body!)).toMatchObject({ type: 'add_to_cart', data: { productId: 'SKU-1' } });
    expect(out).toEqual({ timestamp: 7, segments: ['evening_affinity'] });
    expect(updates).toEqual([[{ timestamp: 7, segments: ['evening_affinity'] }, { fromPush: false, rttMs: 0 }]]);
    expect(receipts).toEqual([{ receiptId: 'r1' }]);
    expect(sent).toEqual([{ via: 'fetch' }]);
  });

  it('a failed POST resolves null and never throws', async () => {
    const { host } = testHost();
    host.fetch = async () => { throw new Error('offline'); };
    const core = createCore({ tenant: 'coach' }, host);
    await expect(core.send('page_view')).resolves.toBeNull();
  });

  it('uses the beacon when asked and available', async () => {
    const { host, calls, beacons } = testHost();
    const core = createCore({ tenant: 'coach' }, host);
    await core.send('purchase', { orderId: 'o1', value: 10 }, { beacon: true });
    expect(beacons).toHaveLength(1);
    expect(JSON.parse(beacons[0]!.body)).toMatchObject({ type: 'purchase', data: { orderId: 'o1' } });
    expect(calls).toHaveLength(0);
  });

  it('opens the socket on the visitor id, heartbeats, dedupes the echo, reconnects on close', async () => {
    const { host, sockets } = testHost({ responses: () => ({ update: { data: { timestamp: 42, segments: ['a'] } } }) });
    const core = createCore({ tenant: 'coach', heartbeatMs: 1000, reconnectMs: 500 }, host);
    const status: string[] = []; core.on('socket', (s) => status.push(s));
    const updates: unknown[] = []; core.on('update', (u) => updates.push(u));
    core.connect();
    expect(sockets[0]?.url).toBe(`wss://shop.example/realtime/ws?userId=${encodeURIComponent(core.visitorId)}`);
    sockets[0]!.open();
    sockets[0]!.receive({ type: 'connected', userId: core.visitorId });
    expect(core.socketStatus).toBe('connected');
    vi.advanceTimersByTime(1000);
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: 'heartbeat' })]);
    // The action's response applies once; the socket echo with the same timestamp is dropped.
    await core.send('product_view', { productId: 'x' });
    sockets[0]!.receive({ type: 'personalization_update', data: { timestamp: 42, segments: ['a'] } });
    expect(updates).toHaveLength(1);
    sockets[0]!.receive({ type: 'personalization_update', data: { timestamp: 43, segments: ['b'], decisionMs: 12 } });
    expect(updates).toHaveLength(2);
    // Content decisions and receipts are their own events.
    const decisions: unknown[] = []; core.on('decisions', (d) => decisions.push(d));
    sockets[0]!.receive({ type: 'content_decisions', page: 'home', decisions: [] });
    expect(decisions).toHaveLength(1);
    sockets[0]!.close();
    expect(core.socketStatus).toBe('reconnecting');
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    core.disconnect();
    expect(core.socketStatus).toBe('closed');
    expect(status[0]).toBe('connecting');
  });

  it('reports the socket as unavailable when the host has none', () => {
    const { host } = testHost({ withSocket: false });
    const core = createCore({ tenant: 'coach' }, host);
    core.connect();
    expect(core.socketStatus).toBe('unavailable');
  });
});
