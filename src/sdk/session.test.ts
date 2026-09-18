// src/sdk/session.test.ts
// The browsing session (R12-1): one id across loads and tabs until thirty idle minutes, carried on
// the snapshot request and on every event, so the decision and the outcome compare equal.

import { describe, it, expect } from 'vitest';
import { createCore } from './core';
import { createListen } from './listen';
import { currentSessionId, DEFAULT_SESSION_IDLE_MS } from './identity';
import { testHost, offeredSet } from './testHost';

describe('the browsing session', () => {
  it('persists across page loads, touches on use, and rotates after thirty idle minutes', async () => {
    const { host } = testHost();
    const first = createCore({ tenant: 'coach' }, host);
    expect(first.sessionId).toBe(''); await first.ready();
    const id = first.sessionId;
    expect(id).toMatch(/^s-/);
    const second = createCore({ tenant: 'coach' }, host);              // a new page load, same storage
    await second.ready();
    expect(second.sessionId).toBe(id);
    expect(second.envelope('page_view').browsingSessionId).toBe(id);
    const t0 = host.now();
    host.now = () => t0 + DEFAULT_SESSION_IDLE_MS - 1000;
    expect(second.sessionId).toBe(id);                                  // touched, still the same session
    host.now = () => t0 + DEFAULT_SESSION_IDLE_MS - 1000 + DEFAULT_SESSION_IDLE_MS + 1;
    const rotated = second.sessionId;
    expect(rotated).not.toBe(id);
    expect(second.envelope('page_view').browsingSessionId).toBe(rotated);
    expect(currentSessionId(host)).toBe(rotated);
  });

  it('the snapshot request carries the same session the events carry', async () => {
    const { host, calls } = testHost({ renderAcks: true, responses: (_url, init) => ({ ok: true, ...offeredSet({ page: 'home', decisions: [
      { contentId: 'c1', customerContentId: 'CMS-1', type: 'editorial', slot: 'hero', order: 0, score: 1, strategy: 'affinity', explain: { drivers: [] } },
    ] }, JSON.parse(init!.body!).pageInstance) }) });
    const core = createCore({ tenant: 'coach', sdkKey: 'k' }, host);
    const listen = createListen(core);
    await listen.hydrate({ page: 'home' });
    const url = new URL(calls[1]!.url);
    expect(url.search).toBe('');
    expect(calls[1]!.init!.method).toBe('POST');
    const context = JSON.parse(calls[1]!.init!.body!);
    expect(context.browsingSessionId).toBe(core.sessionId);
    expect(context).not.toHaveProperty('sessionId'); expect(context).not.toHaveProperty('visitorId');
    await listen.rendered('hero', 'c1'); await core.send('content_click', { contentId: 'c1', slot: 'hero' });
    const actions = calls.filter(call => call.url.endsWith('/action')).map(call => JSON.parse(call.init!.body!));
    expect(actions.map(action => action.type)).toEqual(['content_impression', 'content_click']);
    for (const action of actions) { expect(action.browsingSessionId).toBe(core.sessionId); expect(action.sessionId).toBe(core.profileSessionId); }
  });
});
