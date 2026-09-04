// src/sdk/session.test.ts
// The browsing session (R12-1): one id across loads and tabs until thirty idle minutes, carried on
// the snapshot request and on every event, so the decision and the outcome compare equal.

import { describe, it, expect } from 'vitest';
import { createCore } from './core';
import { createListen } from './listen';
import { currentSessionId, DEFAULT_SESSION_IDLE_MS } from './identity';
import { testHost } from './testHost';

describe('the browsing session', () => {
  it('persists across page loads, touches on use, and rotates after thirty idle minutes', () => {
    const { host } = testHost();
    const first = createCore({ tenant: 'coach' }, host);
    const id = first.sessionId;
    expect(id).toMatch(/^s-/);
    const second = createCore({ tenant: 'coach' }, host);              // a new page load, same storage
    expect(second.sessionId).toBe(id);
    expect(second.envelope('page_view').sessionId).toBe(id);
    const t0 = host.now();
    host.now = () => t0 + DEFAULT_SESSION_IDLE_MS - 1000;
    expect(second.sessionId).toBe(id);                                  // touched, still the same session
    host.now = () => t0 + DEFAULT_SESSION_IDLE_MS - 1000 + DEFAULT_SESSION_IDLE_MS + 1;
    const rotated = second.sessionId;
    expect(rotated).not.toBe(id);
    expect(second.envelope('page_view').sessionId).toBe(rotated);
    expect(currentSessionId(host)).toBe(rotated);
  });

  it('the snapshot request carries the same session the events carry', async () => {
    const { host, calls } = testHost({ responses: () => ({ ok: true, page: 'home', decisions: [] }) });
    const core = createCore({ tenant: 'coach', sdkKey: 'k' }, host);
    const listen = createListen(core);
    await listen.hydrate({ page: 'home' });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('sessionId')).toBe(core.sessionId);
    expect(url.searchParams.get('visitorId')).toBe(core.visitorId);
    await core.send('content_click', { contentId: 'c1', slot: 'hero' });
    expect(JSON.parse(String(calls[1]!.init!.body)).sessionId).toBe(core.sessionId);
  });
});
