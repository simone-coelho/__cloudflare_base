import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCore } from './core';
import { testHost, syntheticSession, authorityLocks, preferenceAck } from './testHost';
import { createIdentity } from './identify';
import { createListen } from './listen';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import type { EngineUpdate } from './types';

function mirroredRefusal(host: ReturnType<typeof testHost>['host'], key: string) {
  const result: { tracking?: false; personalization?: false } = {};
  for (const k of ['tracking', 'personalization'] as const) {
    const raw = host.cookie.get(encodeURIComponent(key) + '_' + k);
    if (raw) {
      const copy = JSON.parse(decodeURIComponent(raw));
      expect(copy.choice.expiresAt - copy.choice.chosenAt).toBe(30 * 86400 * 1000);
      if (copy.choice.expiresAt > host.now()) result[k] = false;
    }
  }
  expect(host.storage.get(key) ?? '').toBe('');
  return result;
}

describe('W04.03 shared authority ownership', () => {
  function factories() {
    const entries: Array<[string, typeof createCore]> = [['source', createCore]];
    for (const format of ['iife', 'esm']) {
      const code = readFileSync(`public/sdk/edge-personalization${format === 'esm' ? '.esm' : ''}.js`, 'utf8');
      const context = { module: { exports: {} }, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval };
      const api = runInNewContext(format === 'esm' ? transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;'
        : code + '\nglobalThis.EdgePersonalization;', context) as { createClient: (config: Parameters<typeof createCore>[0], host: Parameters<typeof createCore>[1]) => { core: ReturnType<typeof createCore> } };
      entries.push([format, (config, host) => api.createClient(config, host).core]);
    }
    return entries;
  }
  function shared(factory: typeof createCore) {
    const a = testHost(), b = testHost(), values = new Map<string, string>(), locks = authorityLocks();
    const grants = new Map<string, ReturnType<typeof syntheticSession> & { consent?: unknown }>(), revoked = new Set<string>();
    const requests: string[] = [];
    let paused: Promise<void> | undefined;
    const storage = { get: (key: string) => values.get(key) ?? null, set: (key: string, value: string) => { values.set(key, value); } };
    for (const f of [a, b]) {
      f.host.storage = storage; f.host.acquireAuthorityLock = locks; f.host.cookie = a.host.cookie;
      f.host.fetch = async (url, init) => {
        requests.push(url);
        const token = init?.headers?.['X-Shopper-Session'], existing = token && !revoked.has(token) ? grants.get(token) : undefined;
        const body = init?.body ? JSON.parse(init.body) : {};
        if (url.endsWith('/identity/session')) {
          if (token && !existing) return { ok: false, status: 401, json: async () => ({}) };
          const original = existing || syntheticSession(f.host.now());
          const grant = { ...original, consent: body.consent ? { ...original.consent, ...body.consent } : original.consent };
          grants.set(grant.capability, grant); return { ok: true, status: 200, json: async () => ({ ok: true, session: grant }) };
        }
        if (url.endsWith('/identity/detach')) {
          if (!existing) return { ok: false, status: 401, json: async () => ({}) };
          revoked.add(token!); const grant = syntheticSession(f.host.now()); grants.set(grant.capability, grant);
          return { ok: true, status: 200, json: async () => ({ ok: true, detached: true, session: grant }) };
        }
        if (url.endsWith('/identity/link')) {
          const grant = syntheticSession(f.host.now(), 'sh_' + 'a'.repeat(32)); grants.set(grant.capability, grant);
          return { ok: true, status: 200, json: async () => ({ ok: true, shopperId: grant.subject, session: grant }) };
        }
        await paused;
        return { ok: true, status: 200, json: async () => ({ update: { data: { segments: ['old-private'] } } }) };
      };
    }
    const A = factory({ tenant: 'coach' }, a.host), B = factory({ tenant: 'coach' }, b.host);
    return { a, b, A, B, values, requests, revoked, pause: (value?: Promise<void>) => { paused = value; } };
  }
  it('W05.10 starts OFF without provenance and stops collection/cached callbacks at original choice expiry in source and both bundles', async () => {
    for (const [format, factory] of factories()) {
      const f = testHost(), grant = syntheticSession(f.host.now());
      let opted = false, reads = 0, deliveries = 0;
      const base = f.host.fetch;
      f.host.fetch = async (url, init) => {
        if (url.endsWith('/identity/session')) return { ok: true, status: 200, json: async () => ({ ok: true, session: { ...grant, consent: { tracking: true, personalization: true } } }) };
        if (url.endsWith('/preferences')) {
          const request = JSON.parse(init!.body!); opted = true;
          const choice = { value: true, chosenAt: f.host.now() + 100 - 30 * 86400 * 1000, expiresAt: f.host.now() + 100 };
          return { ok: true, status: 200, json: async () => ({ success: true, sessionId: grant.sessionId,
            preferences: { trackingConsent: true, personalizationEnabled: true }, consent: { tracking: true, personalization: true,
              instruction: { version: 1, tenant: 'coach', subject: grant.subject, revision: request.choice.id, tracking: choice, personalization: choice } } }) };
        }
        return base(url, init);
      };
      const core = factory({ tenant: 'coach' }, f.host), listen = createListen(core);
      expect(await core.ready(), format).toBe(true); expect(core.consent).toEqual({ tracking: false, personalization: false });
      await core.send('page_view', () => { reads++; return {}; }); expect(reads).toBe(0);
      expect((await core.postJson(`/realtime/session/${core.profileSessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true })).ok).toBe(true);
      expect(opted).toBe(true); expect(core.consent).toEqual({ tracking: true, personalization: true });
      core.on('update', () => { deliveries++; f.tick(101); }); core.on('update', () => { deliveries++; });
      core.applyIncoming({ userId: grant.subject, type: 'personalization_update', data: { segments: ['private'], timestamp: f.host.now(), source: 'synthetic' } }, false, null);
      expect(deliveries).toBe(1);
      expect(core.consent).toEqual({ tracking: false, personalization: false });
      await core.send('page_view', () => { reads++; return {}; }); expect(reads).toBe(0);
      expect(listen.current()).toBeNull();
    }
  });
  it('W05.10 memory-host cookie deadlines physically remove a dormant mirror without refreshing on reads', () => {
    const f = testHost();
    f.host.cookie.set('choice', 'false', 2); f.tick(1000); expect(f.host.cookie.get('choice')).toBe('false');
    f.tick(1000); expect(f.host.cookie.get('choice')).toBeNull();
    f.host.cookie.set('choice', 'false', 2); f.host.cookie.set('choice', '', 0); expect(f.host.cookie.get('choice')).toBeNull();
    vi.useFakeTimers();
    const deletion = vi.spyOn(Map.prototype, 'delete');
    try {
      const idle = testHost(); idle.host.cookie.set('idle-choice', 'false', 2);
      deletion.mockClear(); vi.advanceTimersByTime(2000);
      expect(deletion).toHaveBeenCalledWith('idle-choice'); // timer, without cookie.get
      expect(idle.host.cookie.get('idle-choice')).toBeNull();
    } finally { deletion.mockRestore(); vi.useRealTimers(); }
  });
  it('W05.10 shares pending refusal, reconciles exact lost replies and expires each mirror independently in source and both bundles', async () => {
    for (const [format, factory] of factories()) {
      const f = shared(factory); await f.A.ready(); await f.B.ready();
      const calls: any[] = [], path = `/realtime/session/${f.A.profileSessionId}/preferences`;
      let reply = false;
      f.a.host.fetch = async (_url, init) => {
        const body = JSON.parse(init!.body!); calls.push(body);
        if (!reply) throw new Error('synthetic lost reply');
        return { ok: true, status: 200, json: async () => preferenceAck(f.a.host, init, { trackingConsent: false }) };
      };
      const first = { trackingConsent: false };
      expect((await f.A.postJson(path, first)).ok, format).toBe(false);
      await Promise.resolve(); await Promise.resolve();
      const key = 'opt_shopper_refusal:https%3A%2F%2Fshop.example:coach';
      const original = f.a.host.cookie.get(encodeURIComponent(key) + '_tracking');
      let captured = 0; f.B.capture(() => { captured++; }); await f.B.send('page_view', () => { captured++; return {}; });
      expect(captured).toBe(0); expect(f.B.consent.tracking).toBe(false);
      f.a.tick(1000); expect((await f.A.postJson(path, { trackingConsent: false })).ok).toBe(false);
      expect(calls[1].choice).toEqual(calls[0].choice);
      await Promise.resolve(); await Promise.resolve(); expect(f.a.host.cookie.get(encodeURIComponent(key) + '_tracking')).toBe(original);
      reply = true; expect((await f.A.postJson(path, first)).ok).toBe(true); expect(calls[2].choice).toEqual(calls[0].choice);
      // Two failed partial choices under the same grant retain separate physical deadlines.
      const g = shared(factory); await g.A.ready();
      g.a.host.fetch = async () => { throw new Error('synthetic unavailable'); };
      const p = `/realtime/session/${g.A.profileSessionId}/preferences`;
      await g.A.postJson(p, { trackingConsent: false }); await Promise.resolve(); await Promise.resolve();
      const earlier = g.a.host.now(); g.a.tick(1000);
      await g.A.postJson(p, { personalizationEnabled: false }); await Promise.resolve(); await Promise.resolve();
      g.a.tick(30 * 86400 * 1000 - 1000);
      expect(g.a.host.now()).toBe(earlier + 30 * 86400 * 1000);
      expect(g.a.host.cookie.get(encodeURIComponent(key) + '_tracking')).toBeNull();
      expect(g.a.host.cookie.get(encodeURIComponent(key) + '_personalization')).not.toBeNull();
      g.a.tick(1000); expect(g.a.host.cookie.get(encodeURIComponent(key) + '_personalization')).toBeNull();
    }
  });
  it('W05.10 rechecks personalized decisions at each callback while preserving default delivery', async () => {
    for (const [format, factory] of factories()) {
      const f = testHost(), core = factory({ tenant: 'coach' }, f.host); await core.ready();
      const seen: string[] = [];
      core.on('decisions', () => { seen.push('first'); f.host.cookie.set('opt_tracking_consent', 'false', 10); });
      core.on('decisions', () => { seen.push('second'); });
      core.emit('decisions', { page: 'home', arm: 'personalized', decisions: [] }); expect(seen, format).toEqual(['first']);
      core.emit('decisions', { page: 'home', arm: 'default', decisions: [] }); expect(seen).toEqual(['first', 'first', 'second']);
    }
  });
  it('W05.10 never clears a newer same-time sibling refusal when both tabs were already false', async () => {
    for (const [format, factory] of factories()) {
      const f = shared(factory); await f.A.ready(); await f.B.ready();
      const path = `/realtime/session/${f.A.profileSessionId}/preferences`, name = encodeURIComponent('opt_shopper_refusal:https%3A%2F%2Fshop.example:coach') + '_tracking';
      f.a.host.fetch = async () => { throw new Error('synthetic unavailable'); };
      await f.A.postJson(path, { trackingConsent: false }); await Promise.resolve(); await Promise.resolve();
      expect(f.B.consent.tracking).toBe(false); expect(f.A.consent.tracking).toBe(false);
      let release!: () => void, entered!: () => void;
      const hold = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
      f.a.host.fetch = async (_url, init) => { entered(); await hold; return { ok: true, status: 200, json: async () => preferenceAck(f.a.host, init, { trackingConsent: true }) }; };
      const late = f.A.postJson(path, { trackingConsent: true }); await started;
      const old = f.a.host.cookie.get(name);
      f.b.host.uuid = () => 'newer-sibling-choice'; f.b.host.fetch = async () => { throw new Error('synthetic failed newer choice'); };
      await f.B.postJson(path, { trackingConsent: false }); await Promise.resolve(); await Promise.resolve();
      const newer = f.b.host.cookie.get(name); expect(newer, format).not.toBe(old);
      expect(JSON.parse(decodeURIComponent(newer!)).choice.chosenAt).toBe(JSON.parse(decodeURIComponent(old!)).choice.chosenAt);
      release(); await late;
      expect(f.a.host.cookie.get(name)).toBe(newer); expect(f.A.consent.tracking).toBe(false); expect(f.B.consent.tracking).toBe(false);
      let reads = 0; await f.A.send('page_view', () => { reads++; return {}; }); expect(reads).toBe(0);
    }
  });
  it('fences delayed cross-tab HTTP, callbacks, cached reads and stale clears in source and both bundles', async () => {
    for (const [format, factory] of factories()) {
      const f = shared(factory);
      expect((await createIdentity(f.A).identify('account', { assertion: 'synthetic', exp: Math.floor(f.a.host.now() / 1000) + 60 })).ok, format).toBe(true);
      expect(await f.B.ready()).toBe(true);
      const listen = createListen(f.B), oldGeneration = f.B.generation;
      listen.apply({ page: 'home', decisions: [] }); expect(listen.current()).not.toBeNull();
      let release!: () => void; f.pause(new Promise<void>(resolve => { release = resolve; }));
      const pending = f.B.send('page_view');
      await Promise.resolve(); await Promise.resolve();
      const oldToken = f.B.headers()['X-Shopper-Session'];
      expect((await createIdentity(f.A).logout()).ok, format).toBe(true);
      expect(f.revoked.has(oldToken)).toBe(true); expect(f.B.isCurrent(oldGeneration)).toBe(false);
      expect(listen.current()).toBeNull(); const immediate: unknown[] = []; listen.subscribe('hero', value => immediate.push(value)); expect(immediate).toEqual([]);
      const saved = [...f.values]; f.B.forgetSession(oldGeneration); expect([...f.values]).toEqual(saved);
      release(); expect(await pending).toBeNull(); f.pause();
      expect(await f.B.ready()).toBe(true); expect(f.B.visitorId).toMatch(/^vis-/);
      expect(f.B.headers()['X-Shopper-Session']).not.toBe(oldToken);
      // The discarded-grant recovery above intentionally refuses personalization.
      // Exercise callback ownership on a separate positively consented instance.
      const callbacks = shared(factory); expect(await callbacks.B.ready()).toBe(true);
      const delivered: string[] = [];
      callbacks.B.on('update', () => { delivered.push('first'); const key = [...callbacks.values.keys()].find(key => key.endsWith(':authority'))!;
        callbacks.values.set(key, JSON.stringify({ version: 1, id: 'other-process-transition', persisted: false, pending: true })); });
      callbacks.B.on('update', () => delivered.push('forbidden-later-callback'));
      callbacks.B.applyIncoming({ segments: ['private-before-transition'] }, true, null);
      expect(delivered).toEqual(['first']);
    }
  });
  it('keeps overlapping proof work under its original lock and releases after fallible anchor reads', async () => {
    const f = shared(createCore); await f.A.ready();
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    const first = createIdentity(f.A).identify('account', { getAssertion: async () => { started(); await hold; return { assertion: 'synthetic', exp: Math.floor(f.a.host.now() / 1000) + 60 }; } });
    await entered;
    let secondDone = false; const second = createIdentity(f.A).logout().then(value => { secondDone = true; return value; });
    await Promise.resolve(); await Promise.resolve(); expect(secondDone).toBe(false);
    release(); expect((await first).ok).toBe(false); await second;
    const g = shared(createCore), original = g.a.host.storage.get;
    let once = true; g.a.host.storage.get = key => { if (key.endsWith(':authority') && once) { once = false; throw new Error('synthetic blocked read'); } return original(key); };
    expect(await g.A.ready()).toBe(false); expect(await g.B.ready()).toBe(true);
    const absent = testHost(); delete absent.host.acquireAuthorityLock;
    expect(await createCore({ tenant: 'coach' }, absent.host).ready()).toBe(false); expect(absent.calls).toEqual([]);
  });
  it('revokes issued authority on anchor-write failure and rereads a later refusal under its lease', async () => {
    const f = shared(createCore); await createIdentity(f.A).identify('account', { assertion: 'synthetic', exp: Math.floor(f.a.host.now() / 1000) + 60 }); await f.B.ready();
    const old = f.A.headers()['X-Shopper-Session'], set = f.a.host.storage.set;
    f.a.host.storage.set = (key, value) => { if (key.endsWith(':authority')) throw new Error('synthetic quota refusal'); set(key, value); };
    expect((await createIdentity(f.A).logout()).ok).toBe(false); expect(f.revoked.has(old)).toBe(true);
    f.a.host.storage.set = set;
    const reloaded = createCore({ tenant: 'coach' }, f.a.host); expect(await reloaded.ready()).toBe(true); expect(reloaded.visitorId.startsWith('sh_')).toBe(false);
    const g = shared(createCore); await g.A.ready();
    const refusal = [...g.values.keys()].find(key => key.startsWith('opt_shopper_session:') && !key.endsWith(':authority'))!.replace('opt_shopper_session:', 'opt_shopper_refusal:');
    g.a.host.cookie.set(encodeURIComponent(refusal) + '_tracking', encodeURIComponent(JSON.stringify({ version: 1, endpoint: g.A.config.endpoint,
      tenant: 'coach', subject: g.A.visitorId, switch: 'tracking', pending: true,
      choice: { value: false, chosenAt: g.a.host.now(), expiresAt: g.a.host.now() + 30 * 86400 * 1000 } })), 30 * 86400);
    expect(await g.B.ready()).toBe(true); expect(g.B.consent.tracking).toBe(false); expect(g.B.trackingAllowed).toBe(false);
  });
  it('revokes only retained authority when transition anchor reads throw or silently disappear', async () => {
    for (const [format, factory] of factories()) for (const mode of ['throw', 'null']) {
      const f = shared(factory);
      expect((await createIdentity(f.A).identify('account', { assertion: 'synthetic', exp: Math.floor(f.a.host.now() / 1000) + 60 })).ok).toBe(true);
      await f.B.ready(); const old = f.A.headers()['X-Shopper-Session'], storage = f.a.host.storage;
      f.a.host.storage = { ...storage, get: key => { if (key.endsWith(':authority')) { if (mode === 'throw') throw new Error('synthetic blocked anchor read'); return null; } return storage.get(key); } };
      expect((await createIdentity(f.A).logout()).ok, format + ':' + mode).toBe(false); expect(f.revoked.has(old)).toBe(true);
      f.a.host.storage = storage;
      const reloaded = factory({ tenant: 'coach' }, f.a.host); expect(await reloaded.ready()).toBe(true); expect(reloaded.visitorId.startsWith('sh_')).toBe(false);
      const newer = shared(factory); await newer.A.ready(); await newer.B.ready();
      expect((await createIdentity(newer.B).identify('newer-account', { assertion: 'synthetic', exp: Math.floor(newer.b.host.now() / 1000) + 60 })).ok).toBe(true);
      const current = newer.B.headers()['X-Shopper-Session'], bytes = [...newer.values], prior = newer.a.host.storage;
      newer.a.host.storage = { ...prior, get: key => key.endsWith(':authority') ? null : prior.get(key) };
      expect((await createIdentity(newer.A).logout()).ok).toBe(false);
      expect(newer.revoked.has(current)).toBe(false); expect([...newer.values]).toEqual(bytes);
      newer.a.host.storage = prior; expect(newer.B.isCurrent(newer.B.generation)).toBe(true);
    }
  });
});

describe('core', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('W05.06 retains acknowledged refusal before payload/entry/attribution work and preserves tracking-only measurement', async () => {
    for (const tracking of [false, true]) for (const personalization of [false, true]) {
      const f = testHost({ responses: () => ({ consent: { tracking, personalization }, update: { data: { segments: ['private'] } }, odp: { receiptId: 'synthetic' } }) });
      const reads: string[] = [], callbacks: string[] = [];
      Object.defineProperty(f.host.location!, 'search', { get() { reads.push('search'); return '?utm_source=synthetic'; } });
      Object.defineProperty(f.host, 'referrer', { get() { reads.push('referrer'); return 'https://synthetic.invalid/'; } });
      const fetch = f.host.fetch;
      f.host.fetch = async (url, init) => {
        const r = await fetch(url, init);
        const grant = syntheticSession(f.host.now()); grant.consent.tracking = tracking; grant.consent.personalization = personalization;
        grant.consent.instruction.tracking.value = tracking; grant.consent.instruction.personalization.value = personalization;
        return url.endsWith('/identity/session') ? { ...r, json: async () => ({ ...await r.json() as object, session: grant }) } : r;
      };
      const core = createCore({ tenant: 'coach' }, f.host);
      expect(reads).toEqual([]);
      core.on('sent', () => callbacks.push('sent')); core.on('receipt', () => callbacks.push('receipt')); core.on('update', () => callbacks.push('update'));
      const data = { get orderId() { reads.push('payload'); return 'synthetic-order'; }, value: 3 };
      const result = await core.send('purchase', data, { beacon: true, keepalive: true });
      expect(f.calls.filter(c => c.url.endsWith('/action'))).toHaveLength(tracking ? 1 : 0);
      expect(f.beacons).toEqual([]);
      expect(callbacks).toEqual(tracking ? ['sent', 'receipt', ...(personalization ? ['update'] : [])] : []);
      expect(result).toEqual(tracking && personalization ? { segments: ['private'] } : null);
      if (!tracking) {
        expect(reads).toEqual([]); expect(f.host.storage.get('opt_session')).toBeNull();
        core.envelope('purchase', data); expect(reads).toEqual([]);
        core.adoptSession({ ...syntheticSession(f.host.now(), 'sh_' + 'a'.repeat(32)), consent: { tracking: true, personalization: true } }, core.generation, 'identified');
        expect(core.consent.tracking).toBe(false); expect(f.host.storage.get('opt_session')).toBeNull();
        const g = core.beginTransition(); core.forgetSession(g); core.finishTransition(g);
        expect(f.host.storage.get('opt_session')).toBeNull();
      } else expect(reads).toEqual(['payload', 'search', 'referrer']);
    }
    const f = testHost(), fetch = f.host.fetch;
    f.host.cookie.set('opt_personalization_enabled', 'false', 10);
    f.host.fetch = async (url, init) => {
      const r = await fetch(url, init);
      const grant = syntheticSession(f.host.now()); grant.consent.personalization = false; grant.consent.instruction.personalization.value = false;
      return url.endsWith('/identity/session') ? { ...r, json: async () => ({ ok: true, session: grant }) } : r;
    };
    const core = createCore({ tenant: 'coach' }, f.host);
    await core.send('purchase', { orderId: 'first-cookie-measurement' });
    expect(f.calls.map(c => new URL(c.url).pathname)).toEqual(['/v1/coach/identity/session', '/realtime/action']);
    expect(core.consent).toEqual({ tracking: true, personalization: false });
  });

  it('W05.06 applies refusal before callbacks, drops crossed sends, and never upgrades from ordinary true', async () => {
    const f = testHost(), core = createCore({ tenant: 'coach' }, f.host); await core.ready();
    const seen: string[] = [];
    core.on('sent', () => seen.push('sent')); core.on('receipt', () => seen.push('receipt')); core.on('update', () => seen.push('update'));
    f.host.fetch = async () => ({ ok: true, status: 200, json: async () => ({ consent: { tracking: false }, update: { data: { segments: ['private'] } }, odp: { id: 'private' } }) });
    expect(await core.send('page_view')).toBeNull(); expect(seen).toEqual([]);
    f.host.cookie.set('opt_tracking_consent', 'true', 10);
    core.adoptSession({ ...syntheticSession(f.host.now()), consent: { tracking: true, personalization: true } }, core.generation, 'logout');
    f.host.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, sources: { consent: { tracking: true, personalization: true } } }) });
    await core.getJson(core.config.paths.snapshot); expect(core.trackingAllowed).toBe(false);
    const r = testHost(), ready = createCore({ tenant: 'coach' }, r.host); await ready.ready();
    const attempted = ready.send('purchase', { get orderId() { r.host.cookie.set('opt_tracking_consent', 'false', 10); return 'must-not-send'; } });
    expect(await attempted).toBeNull(); expect(r.calls.filter(c => c.url.endsWith('/action'))).toEqual([]);
    const direct = testHost(), transport = createCore({ tenant: 'coach' }, direct.host); await transport.ready();
    let release!: () => void; const held = new Promise<void>(r => { release = r; });
    direct.host.fetch = async (url, init) => {
      if (url.endsWith('/action')) { await held; return { ok: true, status: 200, json: async () => ({ update: { data: { segments: ['stale-private'] } }, consent: { tracking: true } }) }; }
      return { ok: true, status: 200, json: async () => preferenceAck(direct.host, init, JSON.parse(init!.body!)) };
    };
    const stale = transport.postJson(transport.config.paths.action, { type: 'purchase', data: { orderId: 'old-event' } }); await Promise.resolve();
    const path = `/realtime/session/${transport.profileSessionId}/preferences`;
    await transport.postJson(path, { trackingConsent: false }); await transport.postJson(path, { trackingConsent: true });
    release(); expect(await stale).toEqual({ ok: false, status: 0, json: null });
  });

  it('W05.06 only current exact owned preference acknowledgments enable requested switches and expire old false mirrors', async () => {
    const f = testHost(), core = createCore({ tenant: 'coach' }, f.host); await core.ready();
    const path = `/realtime/session/${core.profileSessionId}/preferences`;
    const key = 'opt_shopper_refusal:https%3A%2F%2Fshop.example:coach';
    f.host.fetch = async () => ({ ok: false, status: 503, json: async () => ({ success: false }) });
    const refused = core.postJson(path, { trackingConsent: false, personalizationEnabled: false });
    expect(core.consent).toEqual({ tracking: false, personalization: false });
    expect(await core.send('page_view')).toBeNull(); await refused;
    expect(f.host.storage.get(key)).toBe(''); expect(f.host.cookie.get(encodeURIComponent(key) + '_tracking')).toContain('false');
    const acknowledge = (preferences: Record<string, unknown>, init: Parameters<typeof f.host.fetch>[1]) => ({ ok: true, status: 200, json: async () => preferenceAck(f.host, init, preferences) });
    f.host.fetch = async (_url, init) => acknowledge({ trackingConsent: true, personalizationEnabled: true }, init);
    await core.postJson(path + '?unowned=1', { trackingConsent: true }); expect(core.trackingAllowed).toBe(false);
    f.host.cookie.set('opt_tracking_consent', 'false', 10); f.host.cookie.set('opt_personalization_enabled', 'false', 10);
    const cookie = vi.spyOn(f.host.cookie, 'set');
    f.host.fetch = async (_url, init) => acknowledge({ trackingConsent: true }, init);
    await core.postJson(path, { trackingConsent: true, personalizationEnabled: true });
    expect(core.consent).toEqual({ tracking: true, personalization: false });
    expect(cookie).toHaveBeenCalledWith('opt_tracking_consent', '', 0);
    expect(cookie).not.toHaveBeenCalledWith('opt_personalization_enabled', '', 0);
    expect(core.trackingAllowed).toBe(false); // personalization refusal is still unacknowledged
    for (const body of [{ ok: false, decisions: [] }, { ok: true }]) {
      f.host.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ...body, sources: { consent: { tracking: true, personalization: false } } }) });
      await core.getJson(core.config.paths.snapshot); expect(core.trackingAllowed).toBe(false);
    }
    f.host.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, decisions: [], sources: { consent: { tracking: true, personalization: false } } }) });
    await core.getJson(core.config.paths.snapshot); expect(core.trackingAllowed).toBe(true);
    f.host.fetch = async (_url, init) => acknowledge({ trackingConsent: false }, init);
    await core.postJson(path, { trackingConsent: false });
    let release!: () => void; const hold = new Promise<void>(r => { release = r; });
    f.host.fetch = async (_url, init) => { await hold; return acknowledge({ trackingConsent: true }, init); };
    const stale = core.postJson(path, { trackingConsent: true }); await Promise.resolve();
    f.host.fetch = async (_url, init) => acknowledge({ trackingConsent: false }, init);
    await core.postJson(path, { trackingConsent: false }); release(); await stale;
    expect(core.trackingAllowed).toBe(false);
    f.host.fetch = async (_url, init) => acknowledge({ trackingConsent: true }, init);
    const oldGet = f.host.cookie.get; f.host.cookie.get = k => k === 'opt_tracking_consent' ? 'false' : oldGet(k);
    await core.postJson(path, { trackingConsent: true }); expect(core.trackingAllowed).toBe(false);
    f.host.cookie.get = oldGet;
    await core.postJson(path, { trackingConsent: true }); expect(core.consent).toEqual({ tracking: true, personalization: false });
    expect(core.consent.personalization).toBe(false);
    f.host.fetch = async (_url, init) => acknowledge({ trackingConsent: false }, init); await core.postJson(path, { trackingConsent: false });
    f.host.cookie.set('opt_tracking_consent', '', 0); cookie.mockClear();
    let finish!: () => void; const gate = new Promise<void>(r => { finish = r; });
    f.host.fetch = async (_url, init) => { await gate; return acknowledge({ trackingConsent: true }, init); };
    const newerCookie = core.postJson(path, { trackingConsent: true }); await Promise.resolve();
    f.host.cookie.set('opt_tracking_consent', 'false', 10); finish(); await newerCookie;
    expect(core.trackingAllowed).toBe(false); expect(cookie).not.toHaveBeenCalledWith('opt_tracking_consent', '', 0);
    let done!: () => void; const wait = new Promise<void>(r => { done = r; });
    f.host.fetch = async (_url, init) => { await wait; return acknowledge({ trackingConsent: true }, init); };
    const oldIdentity = core.postJson(path, { trackingConsent: true }); await Promise.resolve();
    const generation = core.beginTransition(); core.finishTransition(generation); done(); await oldIdentity;
    expect(core.trackingAllowed).toBe(false);
  });

  it('W04.02 coalesces bootstrap, scopes persisted credentials and recovers invalid grants once without bypassing503', async () => {
    const f = testHost(); f.host.storage.set('opt_visitor_id', 'victim'); f.host.cookie.set('opt_session_id', 'victim', 100);
    const core = createCore({ tenant: 'meridian' }, f.host);
    await Promise.all([core.ready(), core.send('page_view'), core.getJson('/realtime/reflex')]);
    expect(f.calls.filter(c => c.url.endsWith('/identity/session'))).toHaveLength(1);
    expect(core.visitorId).not.toBe('victim'); expect(core.headers()['X-Tenant']).toBe('meridian');
    for (const call of f.calls.filter(c => !c.url.endsWith('/identity/session'))) {
      expect(call.init?.headers?.['X-Shopper-Session']).toMatch(/^ss1\./); expect(call.url).not.toContain('ss1.');
    }
    const other = createCore({ tenant: 'coach', endpoint: 'https://other.invalid' }, f.host); await other.ready();
    expect(f.calls.at(-1)!.init?.headers).not.toHaveProperty('X-Shopper-Session');
    for (const status of [401, 503]) {
      const r = testHost(); r.host.storage.set('opt_shopper_session:https%3A%2F%2Fshop.example:coach', 'bad-persisted');
      let calls = 0;
      r.host.fetch = async (_url, init) => { calls++;
        return init?.headers?.['X-Shopper-Session'] ? { ok: false, status, json: async () => ({ ok: false }) }
          : { ok: true, status: 200, json: async () => ({ ok: true, session: { ...syntheticSession(r.host.now()), consent: { tracking: false, personalization: false } } }) };
      };
      expect(await createCore({ tenant: 'coach' }, r.host).ready()).toBe(status === 401);
      expect(calls).toBe(status === 401 ? 2 : 1);
    }
  });

  it('W04.02 delayed bootstrap/action and old socket frames cannot survive an ABA transition', async () => {
    const f = testHost(); let release!: () => void;
    const hold = new Promise<void>(r => { release = r; });
    f.host.fetch = async () => { await hold; return { ok: true, status: 200, json: async () => ({ ok: true, session: syntheticSession(f.host.now()) }) }; };
    const core = createCore({ tenant: 'coach' }, f.host), pending = core.ready();
    core.setVisitorId('newer', 'logout'); release(); expect(await pending).toBe(false); expect(core.visitorId).toBe('newer');
    const r = testHost(), active = createCore({ tenant: 'coach' }, r.host); await active.ready(); active.connect(); await Promise.resolve();
    const old = r.sockets[0]!, updates: unknown[] = []; active.on('update', u => updates.push(u));
    let done!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const delayed = new Promise<void>(resolve => { done = resolve; });
    r.host.fetch = async () => { entered(); await delayed; return { ok: true, status: 200, json: async () => ({ update: { data: { segments: ['PRIVATE'] } } }) }; };
    const action = active.send('page_view'); await started;
    const visitor = active.visitorId; active.disconnect(); active.setVisitorId('other', 'logout'); active.setVisitorId(visitor, 'logout');
    old.receive({ type: 'personalization_update', data: { segments: ['PRIVATE'] } }); done();
    expect(await action).toBeNull(); expect(updates).toEqual([]);
  });

  it('W05.01 retains scoped refusal recovery across missing acknowledgments and silently failed credential persistence', async () => {
    const f = testHost(), key = 'opt_shopper_refusal:https%3A%2F%2Fshop.example:coach';
    const core = createCore({ tenant: 'coach' }, f.host); await core.ready();
    const g = core.beginTransition(); core.forgetSession(g); core.finishTransition(g);
    const store = f.host.storage.set;
    f.host.storage.set = (key, value) => { if (!(key.startsWith('opt_shopper_session:') && !key.endsWith(':authority') && value)) store(key, value); };
    const requests: any[] = []; let ack = false;
    f.host.fetch = async (_url, init) => {
      const body = JSON.parse(init?.body ?? '{}'); requests.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true, session: { ...syntheticSession(f.host.now(), undefined, init?.headers?.['X-Tenant']), ...(ack ? { consent: body.consent ?? { tracking: true, personalization: true } } : {}) } }) };
    };
    expect(await core.ready()).toBe(false); expect(mirroredRefusal(f.host, key)).toEqual({ tracking: false, personalization: false });
    ack = true; expect(await core.ready()).toBe(true); expect(mirroredRefusal(f.host, key)).toEqual({ tracking: false, personalization: false });
    expect(await createCore({ tenant: 'coach' }, f.host).ready()).toBe(true);
    expect(requests.slice(0, 3)).toEqual(Array(3).fill({ consent: { tracking: false, personalization: false } }));
    f.tick(3_601_000); expect(await core.ready()).toBe(true);
    expect(requests.at(-1)).toEqual({ consent: { tracking: false, personalization: false } });
    expect(await createCore({ tenant: 'meridian' }, f.host).ready()).toBe(true);
    expect(requests.at(-1)).toEqual({});
    for (const tracking of [false, true]) {
      const ordinary = testHost(), ordinaryCore = createCore({ tenant: 'coach' }, ordinary.host);
      await ordinaryCore.ready();
      const previous = syntheticSession(ordinary.host.now(), 'sh_' + 'a'.repeat(32));
      const identified = ordinaryCore.beginTransition(); expect(await ordinaryCore.ready(true)).toBe(true);
      expect(ordinaryCore.adoptSession(previous, identified, 'identified')).toBe(true); ordinaryCore.finishTransition(identified);
      const ordinaryStore = ordinary.host.storage.set;
      ordinary.host.storage.set = (key, value) => { if (!(key.startsWith('opt_shopper_session:') && !key.endsWith(':authority') && value)) ordinaryStore(key, value); };
      const fresh = syntheticSession(ordinary.host.now()); fresh.consent.tracking = tracking; fresh.consent.instruction.tracking.value = tracking;
      const loggingOut = ordinaryCore.beginTransition(); expect(await ordinaryCore.ready(true)).toBe(true);
      expect(ordinaryCore.adoptSession(fresh, loggingOut, 'logout')).toBe(true); ordinaryCore.finishTransition(loggingOut);
      expect(ordinaryCore.visitorId).toBe(fresh.subject);
      expect(ordinary.host.storage.get('opt_shopper_session:https%3A%2F%2Fshop.example:coach')).toBe(previous.capability);
      const expected = tracking ? { tracking: false, personalization: false } : { tracking: false };
      expect(mirroredRefusal(ordinary.host, key)).toEqual(expected);
      const ordinaryRequests: any[] = [];
      ordinary.host.fetch = async (_url, init) => {
        ordinaryRequests.push(JSON.parse(init?.body ?? '{}'));
        expect(init?.headers).not.toHaveProperty('X-Shopper-Session');
        return { ok: true, status: 200, json: async () => ({ ok: true, session: { ...syntheticSession(ordinary.host.now()), consent: { tracking: false, personalization: expected.personalization !== false } } }) };
      };
      const reloaded = createCore({ tenant: 'coach' }, ordinary.host);
      expect(await reloaded.ready()).toBe(true); expect(reloaded.visitorId).not.toBe(previous.subject);
      expect(ordinaryRequests).toEqual([{ consent: expected }]);
    }
  });

  it('builds the envelope the storefront sends, field for field', async () => {
    const { host } = testHost();
    const core = createCore({ tenant: 'coach', source: 'coach-storefront', surface: 'coach' }, host);
    await core.ready();
    const env = core.envelope('product_view', { productId: 'SKU-1' });
    expect(Object.keys(env)).toEqual(['eventId', 'type', 'userId', 'anonymousId', 'sessionId', 'browsingSessionId', 'data', 'source', 'surface', 'entry', 'timestamp']);
    expect(env.userId).toMatch(/^vis-/);
    expect(env.anonymousId).toBe(env.userId);
    expect(env.sessionId).toBe(core.profileSessionId);
    expect(env.browsingSessionId).toBe(core.sessionId);
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
    expect(calls[1]?.url).toBe('https://shop.example/realtime/action');
    expect(calls[1]?.init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-SDK-Key': 'k-1' } });
    expect(JSON.parse(calls[1]!.init!.body!)).toMatchObject({ type: 'add_to_cart', data: { productId: 'SKU-1' } });
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

  it('W09.05 mints distinct same-clock envelopes with compatible opaque tokens and refuses invalid sources without sending', async () => {
    const f = testHost(), core = createCore({ tenant: 'coach' }, f.host);
    const uuid = vi.fn(() => 'fallbackbase36'); f.host.uuid = uuid;
    // The legacy direct helper can mint browsing attribution before ready; it
    // must not consume a logical event sequence number there.
    expect(core.envelope('purchase')).not.toHaveProperty('eventId');
    await core.ready();
    const sent: unknown[] = []; core.on('sent', event => sent.push(event));
    await core.send('purchase', { orderId: 'same' }); await core.send('purchase', { orderId: 'same' });
    const bodies = f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!));
    expect(bodies.map(b => b.eventId)).toEqual(['fallbackbase36-1', 'fallbackbase36-2']);
    expect(bodies[0].timestamp).toBe(bodies[1].timestamp); expect(sent).toEqual(bodies);
    expect(JSON.parse(JSON.stringify(sent[0]))).toEqual(bodies[0]);
    for (const token of ['', 'bad:token', 'abc\n', 'x'.repeat(97)]) {
      uuid.mockReturnValue(token); await expect(core.send('purchase')).resolves.toBeNull();
    }
    expect(f.calls.filter(c => c.url.endsWith('/action'))).toHaveLength(2);
    uuid.mockReturnValue('safe');
    const zero = testHost({ now: () => 0 }), atZero = createCore({ tenant: 'coach' }, zero.host); zero.host.uuid = uuid;
    await atZero.ready(); expect(atZero.envelope('purchase')).toMatchObject({ eventId: 'safe-1', timestamp: 0 });
    f.host.cookie.set('opt_tracking_consent', 'false', 10); uuid.mockClear();
    expect(core.envelope('purchase')).not.toHaveProperty('eventId'); await core.send('purchase');
    expect(uuid).not.toHaveBeenCalled();
  });

  it('uses authenticated keepalive fetch instead of a headerless beacon', async () => {
    const { host, calls, beacons } = testHost();
    const core = createCore({ tenant: 'coach' }, host);
    await core.send('purchase', { orderId: 'o1', value: 10 }, { beacon: true });
    expect(beacons).toHaveLength(0);
    expect(JSON.parse(calls[1]!.init!.body!)).toMatchObject({ type: 'purchase', data: { orderId: 'o1' } });
    expect(calls[1]!.init).toMatchObject({ keepalive: true, headers: { 'X-Shopper-Session': expect.stringMatching(/^ss1\./), 'X-Tenant': 'coach' } });
    expect(calls).toHaveLength(2);
  });

  it('opens the socket on the visitor id, heartbeats, dedupes the echo, reconnects on close', async () => {
    const { host, sockets } = testHost({ responses: () => ({ update: { data: { timestamp: 42, segments: ['a'] } } }) });
    const core = createCore({ tenant: 'coach', heartbeatMs: 1000, reconnectMs: 500 }, host);
    const status: string[] = []; core.on('socket', (s) => status.push(s));
    const updates: unknown[] = []; core.on('update', (u) => updates.push(u));
    await core.ready();
    core.connect();
    await Promise.resolve();
    expect(sockets[0]?.url).toBe('wss://shop.example/realtime/ws?tenant=coach');
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
    await Promise.resolve();
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

  it('W15.01 bounds generic update freshness and echoes across source and both shipped transports without losing delivery ownership', async () => {
    const factories: Array<[string, typeof createCore]> = [['source', createCore]];
    for (const format of ['iife', 'esm']) {
      const code = readFileSync(`public/sdk/edge-personalization${format === 'esm' ? '.esm' : ''}.js`, 'utf8');
      const context = { module: { exports: {} }, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval };
      const api = runInNewContext(format === 'esm'
        ? transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;'
        : code + '\nglobalThis.EdgePersonalization;', context) as { createClient: (config: Parameters<typeof createCore>[0], host: Parameters<typeof createCore>[1]) => { core: ReturnType<typeof createCore> } };
      factories.push([format, (config, host) => api.createClient(config, host).core]);
    }
    for (const [format, factory] of factories) {
      const setup = async () => {
        let response: unknown;
        const f = testHost({ responses: () => response });
        const core = factory({ tenant: 'coach' }, f.host);
        await core.ready(); core.connect(); await Promise.resolve(); f.sockets.at(-1)!.open();
        const send = (update: EngineUpdate) => {
          response = { update: { data: update }, odp: { receiptId: 'synthetic-ack' } };
          return core.send('page_view');
        };
        const push = (update: EngineUpdate) => f.sockets.at(-1)!.receive({ type: 'personalization_update', data: update });
        return { f, core, send, push };
      };
      const { f, core, send, push } = await setup();
      const seen: EngineUpdate[] = [], acknowledgments: string[] = [];
      core.on('update', u => seen.push(u));
      core.on('sent', () => acknowledgments.push('sent')); core.on('receipt', () => acknowledgments.push('receipt'));
      const first = { timestamp: 10, segments: ['first'] };
      expect(await send(first), format).toEqual(first); push(first); expect(seen).toHaveLength(1);
      const second = { timestamp: 20, segments: ['second'] };
      push(second); expect(await send(second)).toBeNull(); expect(seen).toHaveLength(2);
      expect(await send({ timestamp: 19, segments: ['stale-http'] })).toBeNull();
      push({ timestamp: 18, segments: ['stale-push'] }); expect(seen).toHaveLength(2);
      expect(acknowledgments).toEqual(['sent', 'receipt', 'sent', 'receipt', 'sent', 'receipt']);
      const distinct = { timestamp: 20, segments: ['distinct'] };
      expect(await send(distinct)).toEqual(distinct); push(distinct); expect(seen).toHaveLength(3);
      for (const timestamp of [undefined, NaN, Infinity, -Infinity]) {
        const legacy = { timestamp, segments: ['legacy'] }, before = seen.length;
        expect(await send(legacy)).toEqual(legacy); expect(await send(legacy)).toEqual(legacy);
        expect(seen).toHaveLength(before + 2);
      }
      expect(await send({ timestamp: 19 })).toBeNull(); expect(await send(second)).toBeNull();
      const beforeReconnect = seen.length, browsing = core.sessionId;
      core.disconnect(); core.connect(); await Promise.resolve(); f.sockets.at(-1)!.open();
      push(first); expect(seen).toHaveLength(beforeReconnect);
      f.tick(31 * 60_000); core.envelope('page_view');
      expect(core.sessionId).not.toBe(browsing); expect(await send(first)).toBeNull();
      const g = core.beginTransition(); core.finishTransition(g);
      expect(await send(first)).toEqual(first); // only the identity generation resets freshness
      core.disconnect();

      const bounded = await setup(), cached: EngineUpdate[] = [];
      bounded.core.on('update', u => cached.push(u));
      for (let i = 0; i < 33; i++) bounded.core.applyIncoming({ timestamp: 1, value: i }, true, null);
      expect(cached).toHaveLength(33);
      bounded.core.applyIncoming({ timestamp: 1, value: 32 }, false, 1); expect(cached).toHaveLength(33);
      bounded.core.applyIncoming({ timestamp: 1, value: 0 }, false, 1); expect(cached).toHaveLength(34); // FIFO eviction
      const wideA = { timestamp: 2, value: 'a'.repeat(40_000) }, wideB = { timestamp: 2, value: 'b'.repeat(40_000) };
      bounded.push(wideA); bounded.push(wideB); bounded.push(wideA); expect(cached).toHaveLength(37); // total-unit cap
      const exact = { timestamp: 3, value: '' }; exact.value = 'x'.repeat(65_536 - JSON.stringify(exact).length);
      expect(JSON.stringify(exact)).toHaveLength(65_536);
      bounded.push(exact); bounded.push(exact); expect(cached).toHaveLength(38);
      const oversized = { timestamp: 4, value: 'x'.repeat(65_536) };
      bounded.push(oversized); bounded.push(oversized); expect(cached).toHaveLength(40);
      bounded.push(exact); expect(cached).toHaveLength(40); // bypass still advances the finite high-water
      const cyclic: EngineUpdate = { timestamp: 5 }; cyclic.self = cyclic;
      expect(await bounded.send(cyclic)).toBe(cyclic); expect(await bounded.send(cyclic)).toBe(cyclic);
      const throws: EngineUpdate = { timestamp: 6, toJSON() { throw new Error('synthetic serialization refusal'); } };
      expect(await bounded.send(throws)).toBe(throws); expect(await bounded.send(throws)).toBe(throws);
      bounded.push({ timestamp: 5 }); expect(cached).toHaveLength(44);
      bounded.core.disconnect();

      const owned = await setup(), delivered: unknown[] = [];
      owned.core.on('update', u => {
        if (u.value === 'mutation') u.value = 'mutated';
        if (u.value === 'outer') owned.core.applyIncoming({ timestamp: 30, value: 'inner' }, true, null);
        if (u.value === 'keep') {
          owned.core.applyIncoming({ timestamp: 29, value: 'stale' }, true, null);
          owned.core.applyIncoming({ timestamp: 40, value: 'keep' }, true, null);
        }
      });
      owned.core.on('update', u => delivered.push(u.value));
      expect(await owned.send({ timestamp: 10, value: 'mutation' })).toMatchObject({ value: 'mutated' });
      owned.push({ timestamp: 10, value: 'mutation' }); expect(delivered).toEqual(['mutated']);
      expect(await owned.send({ timestamp: 20, value: 'outer' })).toBeNull();
      expect(delivered).toEqual(['mutated', 'inner']); // old remaining listener never receives outer
      expect(await owned.send({ timestamp: 40, value: 'keep' })).toMatchObject({ value: 'keep' });
      expect(delivered).toEqual(['mutated', 'inner', 'keep']); // rejected reentry cannot steal ownership
      const duringSerialization: EngineUpdate = { timestamp: 50, toJSON() {
        owned.core.applyIncoming({ timestamp: 60, value: 'serialization-child' }, true, null);
        return { timestamp: 50, value: 'serialization-parent' };
      } };
      expect(await owned.send(duringSerialization)).toBeNull();
      expect(delivered.at(-1)).toBe('serialization-child'); expect(await owned.send({ timestamp: 55 })).toBeNull();
      const duringGeneration: EngineUpdate = { timestamp: 1000, toJSON() {
        const next = owned.core.beginTransition(); owned.core.finishTransition(next);
        return { timestamp: 1000 };
      } };
      expect(await owned.send(duringGeneration)).toBeNull();
      expect(await owned.send({ timestamp: 1, value: 'new-generation' })).toMatchObject({ value: 'new-generation' });
      const off = owned.core.on('update', u => { if (u.value === 'change-generation') {
        const next = owned.core.beginTransition(); owned.core.finishTransition(next);
      } });
      expect(await owned.send({ timestamp: 2, value: 'change-generation' })).toBeNull(); off();
      owned.core.disconnect();
    }
  });
});
