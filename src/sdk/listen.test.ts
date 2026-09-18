import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCore } from './core';
import { createListen } from './listen';
import { createClient } from './index';
import { syntheticSession, testHost, preferenceAck, offeredSet, renderAck } from './testHost';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import type { ClientConfig, DecisionSet, Host, RequestInitLike } from './types';
import { createServerBridge, bootstrapJSON, sessionWitness } from './server';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import type { ActionEnvelope } from './types';

// Use the repository's existing DOM dependency without adding SDK runtime types.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis };
};

const snapshot = {
  ok: true, page: 'home', arm: 'personalized', versions: { config: 41, lift: 0, prior: 0, policy: 0 }, config_label: 'reflex-demo-v1+r41',
  decisions: [
    { contentId: 'c2', customerContentId: 'CMS-2', type: 'editorial', slot: 'story', order: 2, score: 0.3, strategy: 'affinity', explain: { drivers: [] } },
    { contentId: 'c1', customerContentId: 'CMS-1', type: 'on-model', slot: 'hero', order: 0, score: 0.7, strategy: 'affinity', explain: { drivers: [] } },
    { contentId: 'c3', customerContentId: 'CMS-3', type: 'editorial', slot: 'story', order: 1, score: 0.4, strategy: 'affinity', explain: { drivers: [] } },
  ],
};
const offerResponse = (init?: RequestInitLike) => ({ ok: true, ...offeredSet(snapshot as DecisionSet, JSON.parse(init?.body ?? '{}').pageInstance) });

describe('listen', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('W05.06 acknowledges snapshot refusal before rendered callbacks and strips attribution across the readiness await', async () => {
    const f = testHost({ responses: () => ({ ...snapshot, arm: 'default', decisions: snapshot.decisions.map(d => ({ ...d, strategy: 'default' })), sources: { consent: { tracking: false, personalization: false } } }) });
    const core = createCore({ tenant: 'coach' }, f.host), listen = createListen(core);
    const observe = vi.fn(() => () => {});
    f.host.dom = { querySelectorAll: () => [], observe };
    const delivered: string[] = [];
    listen.subscribe('hero', ds => { delivered.push(ds[0]?.contentId ?? 'default'); listen.rendered('hero', 'c1', { getAttribute: () => null, addEventListener: () => {} }); });
    await core.ready();
    const getJson = core.getJson;
    core.getJson = (path, query) => { const pending = getJson(path, query); f.host.cookie.set('opt_tracking_consent', 'false', 10); return pending; };
    await listen.hydrate({ page: 'home', channel: 'private-campaign' });
    expect(delivered).toEqual(['c1']); expect(observe).not.toHaveBeenCalled();
    const captured = f.calls.find(c => c.url.includes('/decisions/snapshot'))!;
    expect(new URL(captured.url).search).toBe(''); expect(captured.init!.method).toBe('POST');
    const request = { searchParams: new URLSearchParams(JSON.parse(captured.init!.body!)) };
    expect(request.searchParams.get('trackingConsent')).toBe('false');
    expect(request.searchParams.has('browsingSessionId')).toBe(false); expect(request.searchParams.has('channel')).toBe(false);
    expect(request.searchParams.has('entry')).toBe(false);
    expect(f.calls.filter(c => c.url.endsWith('/action'))).toEqual([]);
    const before = f.host.storage.get('opt_session');
    await listen.hydrate({ page: 'home', channel: 'private-campaign' });
    expect(f.host.storage.get('opt_session')).toBe(before);
    expect(core.consent).toEqual({ tracking: false, personalization: false });
  });

  it('W05.06 invalidates rendered dwell/dedupe during withdrawal and handles synchronous observers', async () => {
    const f = testHost({ renderAcks: true }), core = createCore({ tenant: 'coach' }, f.host), listen = createListen(core);
    await core.ready();
    const visible: Array<(v: boolean) => void> = [], off = vi.fn();
    f.host.dom = { querySelectorAll: () => [], observe: (_el, cb) => { visible.push(cb); cb(true); return off; } };
    const el = { getAttribute: () => null, addEventListener: () => {} };
    listen.apply(offeredSet(snapshot as DecisionSet)); await listen.rendered('hero', 'c1', el); await vi.advanceTimersByTimeAsync(0);
    const path = `/realtime/session/${core.profileSessionId}/preferences`, fetch = f.host.fetch;
    f.host.fetch = async (url, init) => url.endsWith('/preferences') ? { ok: true, status: 200, json: async () => preferenceAck(f.host, init, JSON.parse(init!.body!)) } : fetch(url, init);
    await core.postJson(path, { trackingConsent: false }); f.tick(5000); expect(off).toHaveBeenCalledTimes(1);
    await core.postJson(path, { trackingConsent: true });
    listen.apply(offeredSet(snapshot as DecisionSet)); visible[0]!(false); await listen.rendered('hero', 'c1', el); f.tick(1500); visible[1]!(false);
    await vi.advanceTimersByTimeAsync(0);
    const actions = f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!));
    expect(actions.map(v => v.type)).toEqual(['content_impression', 'content_impression', 'content_dwell']);
    expect(actions.at(-1).data.ms).toBe(1500); expect(off).toHaveBeenCalledTimes(2);
    f.host.dom.observe = (_el, cb) => { const g = core.beginTransition(); cb(true); core.finishTransition(g); return off; };
    await listen.rendered('story', 'c2', el); expect(off).toHaveBeenCalledTimes(3);
  });

  it('W04.02 readiness timeout covers bootstrap, and stale hydrate/cache callbacks are discarded', async () => {
    const f = testHost(); let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    f.host.fetch = async () => { await delayed; return { ok: false, status: 503, json: async () => ({ ok: false }) }; };
    const core = createCore({ tenant: 'coach', hydrateTimeoutMs: 100 }, f.host), listen = createListen(core), seen: unknown[] = [];
    listen.onDecisions(s => seen.push(s));
    const pending = listen.hydrate({ page: 'home' }); vi.advanceTimersByTime(100); expect(seen).toEqual([null]);
    release(); expect(await pending).toBeNull(); expect(seen).toEqual([null]);
    const r = testHost(), active = createCore({ tenant: 'coach' }, r.host), receiver = createListen(active); await active.ready();
    let done!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { done = resolve; });
    r.host.fetch = async () => { entered(); await gate; return { ok: true, status: 200, json: async () => snapshot }; };
    receiver.apply(snapshot as never);
    const request = receiver.hydrate({ page: 'home' }); await started;
    active.setVisitorId('newer', 'logout'); expect(receiver.current()).toBeNull(); done(); expect(await request).toBeNull();
    // Identity withdrawal is now a known absence, not stale cached content or silent subscription.
    const late: unknown[] = []; receiver.subscribe('hero', d => late.push(d)); expect(late).toEqual([[]]);
  });

  it('hydrates from the snapshot and delivers each slot its decisions in order', async () => {
    const { host, calls } = testHost({ responses: () => snapshot });
    const core = createCore({ tenant: 'coach', brand: 'coach' }, host);
    const listen = createListen(core);
    const hero: unknown[] = [], story: unknown[] = [], rail: unknown[] = [], sets: unknown[] = [];
    listen.subscribe('hero', (d) => hero.push(d.map((x) => x.contentId)));
    listen.subscribe('story', (d) => story.push(d.map((x) => x.contentId)));
    listen.subscribe('rail', (d) => rail.push(d));
    listen.onDecisions((s) => sets.push(s?.arm ?? null));
    const set = await listen.hydrate({ page: 'home', channel: 'paid social' });
    const url = new URL(calls[1]!.url);
    const context = JSON.parse(calls[1]!.init!.body!);
    expect(JSON.parse(context.entry)).toEqual({ utmMedium: 'paid_social', utmSource: 'tiktok', referrer: 'www.tiktok.com', siteHost: 'shop.example' });
    delete context.entry;
    expect(url.toString()).toBe('https://shop.example/v1/coach/decisions/snapshot');
    expect(context).toEqual({ page: 'home', pageInstance: expect.any(String), browsingSessionId: core.sessionId, brand: 'coach', channel: 'paid social' });
    expect(set?.decisions).toHaveLength(3);
    expect(hero).toEqual([['c1']]);
    expect(story).toEqual([['c3', 'c2']]);
    expect(rail).toEqual([[]]);           // nothing for this slot: told plainly, default stands
    expect(sets).toEqual(['personalized']);
    expect(listen.current()?.config_label).toBe('reflex-demo-v1+r41');
    // A late subscriber gets the current truth immediately.
    const late: unknown[] = []; listen.subscribe('hero', (d) => late.push(d.length));
    expect(late).toEqual([1]);
  });

  it('declares graceful absence on the deadline, then applies a late snapshot', async () => {
    let resolveFetch!: (v: unknown) => void;
    const { host } = testHost({ responses: () => new Promise((r) => { resolveFetch = r; }) });
    const core = createCore({ tenant: 'coach', hydrateTimeoutMs: 1500 }, host);
    const listen = createListen(core);
    const sets: unknown[] = []; listen.onDecisions((s) => sets.push(s ? 'set' : null));
    const p = listen.hydrate({ page: 'home' });
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(1500);
    expect(sets).toEqual([null]);
    resolveFetch(snapshot);
    await p;
    expect(sets).toEqual([null, 'set']);
  });

  it('a failed or malformed snapshot is absence, not an error', async () => {
    const { host } = testHost({ responses: () => ({ ok: false }) });
    const core = createCore({ tenant: 'coach' }, host);
    const listen = createListen(core);
    const sets: unknown[] = []; listen.onDecisions((s) => sets.push(s));
    await expect(listen.hydrate({ page: 'home' })).resolves.toBeNull();
    expect(sets).toEqual([null]);
  });

  it('applies content_decisions frames from the socket', async () => {
    const { host, sockets } = testHost();
    const core = createCore({ tenant: 'coach' }, host);
    const listen = createListen(core);
    const hero: unknown[] = []; listen.subscribe('hero', (d) => hero.push(d[0]?.contentId ?? null));
    await core.ready(); core.connect(); await Promise.resolve(); sockets[0]!.open();
    sockets[0]!.receive({ type: 'content_decisions', page: 'home', decisions: snapshot.decisions });
    expect(hero).toEqual(['c1']);
  });

  it('rendered() sends one impression per slot and piece, and dwell while on screen', async () => {
    const { host, calls } = testHost({ renderAcks: true, responses: (_url, init) => offerResponse(init) });
    let visible: ((v: boolean) => void) | null = null;
    host.dom = { querySelectorAll: () => [] as unknown as ArrayLike<never> & Iterable<never>, observe: (_el, cb) => { visible = cb; return () => {}; } };
    const core = createCore({ tenant: 'coach' }, host);
    const listen = createListen(core, { dwellMinMs: 1000 });
    await listen.hydrate({ page: 'home' });
    const el = { getAttribute: () => null, addEventListener: () => {} };
    listen.rendered('hero', 'c1', el); listen.rendered('hero', 'c1', el);
    await vi.advanceTimersByTimeAsync(0);
    const posted = () => calls.filter((c) => c.url.endsWith('/action')).map((c) => JSON.parse(c.init!.body!));
    expect(posted()).toHaveLength(1);
    expect(posted()[0]).toMatchObject({ type: 'content_impression', data: { contentId: 'c1', slot: 'hero', customerContentId: 'CMS-1', contentType: 'on-model' } });
    const t0 = host.now();
    host.now = () => t0; visible!(true);
    host.now = () => t0 + 2500; visible!(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(posted()[1]).toMatchObject({ type: 'content_dwell', data: { contentId: 'c1', ms: 2500 } });
  });

  it('listen-only mode sends nothing from rendered()', async () => {
    const { host, calls } = testHost({ responses: () => snapshot });
    const core = createCore({ tenant: 'coach', listenOnly: true }, host);
    const listen = createListen(core);
    await listen.hydrate({ page: 'home' });
    listen.rendered('hero', 'c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c.url.endsWith('/action'))).toHaveLength(0);
  });

  it('W20.06 delivers known absence to slots and cancels prior or queued capture without inventing impressions', async () => {
    for (const response of [null, { ok: false }, { ok: true, decisions: 'malformed' }]) {
      const f = testHost({ renderAcks: true, responses: () => response }), core = createCore({ tenant: 'coach' }, f.host), listen = createListen(core);
      const seen: Array<[string, number]> = [], sets: Array<DecisionSet | null> = [], off = vi.fn();
      let visibility: (v: boolean) => void = () => undefined;
      f.host.dom = { querySelectorAll: () => [], observe: (_el, cb) => { visibility = cb; return off; } };
      listen.subscribe('hero', () => { throw new Error('isolated listener'); });
      listen.subscribe('hero', (ds, set) => seen.push([set.page, ds.length]));
      listen.onDecisions(set => sets.push(set));
      expect(seen).toEqual([]); await core.ready(); listen.apply(offeredSet(snapshot as DecisionSet));
      listen.rendered('hero', 'c1', { getAttribute: () => null, addEventListener: () => undefined });
      await vi.advanceTimersByTimeAsync(0); visibility(true);
      expect(await listen.hydrate({ page: 'catalog' })).toBeNull();
      expect(listen.current()).toBeNull(); expect(seen).toEqual([['home', 1], ['catalog', 0]]); expect(sets.at(-1)).toBeNull();
      const late: unknown[] = []; listen.subscribe('story', (ds, set) => late.push([ds, set.page]));
      expect(late).toEqual([[[], 'catalog']]); expect(off).toHaveBeenCalledTimes(1);
      f.tick(5000); visibility(false); await vi.advanceTimersByTimeAsync(0);
      const actions = () => f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!));
      expect(actions().map(a => a.type)).toEqual(['content_impression']);
      // W15 supersedes uncorrelated fallback: absence is never a render offer.
      listen.rendered('hero', 'c1'); await vi.advanceTimersByTimeAsync(0);
      expect(actions().map(a => a.type)).toEqual(['content_impression']);
      listen.apply({ page: 'empty', decisions: [] });
      expect(listen.current()).toEqual({ page: 'empty', decisions: [] }); expect(sets.at(-1)).not.toBeNull();
    }
    const f = testHost({ responses: () => ({ ok: false }) }), fetch = f.host.fetch;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    f.host.fetch = async (url, init) => { await gate; return fetch(url, init); };
    const core = createCore({ tenant: 'coach', hydrateTimeoutMs: 50 }, f.host), listen = createListen(core);
    listen.apply(snapshot as DecisionSet); listen.rendered('hero', 'c1');
    const pending = listen.hydrate({ page: 'queued' });
    await vi.advanceTimersByTimeAsync(50); expect(listen.current()).toBeNull();
    release(); expect(await pending).toBeNull(); await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.filter(c => c.url.endsWith('/action'))).toEqual([]);
  });

  it('W20.06 latest intent owns timers and results across same-generation and callback reentry', async () => {
    const requests: Array<(value: unknown) => void> = [];
    const f = testHost({ responses: () => new Promise(resolve => { requests.push(resolve); }) });
    const core = createCore({ tenant: 'coach', hydrateTimeoutMs: 100 }, f.host), listen = createListen(core);
    await core.ready();
    const seen: string[] = []; listen.onDecisions(s => seen.push(s?.page ?? 'absent'));
    const old = listen.hydrate({ page: 'old' }); await vi.advanceTimersByTimeAsync(0);
    const latest = listen.hydrate({ page: 'latest' }); await vi.advanceTimersByTimeAsync(0);
    requests[1]!({ ...snapshot, page: 'latest' }); expect((await latest)?.page).toBe('latest');
    await vi.advanceTimersByTimeAsync(100); requests[0]!({ ...snapshot, page: 'old' });
    expect(await old).toBeNull(); expect(seen).toEqual(['latest']);
    const late = listen.hydrate({ page: 'late' }); await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(['latest', 'absent']);
    requests[2]!({ ...snapshot, page: 'late' }); expect((await late)?.page).toBe('late');
    const stale = listen.hydrate({ page: 'stale' }); await vi.advanceTimersByTimeAsync(0);
    listen.apply({ page: 'socket', decisions: [] }); await vi.advanceTimersByTimeAsync(100);
    requests[3]!({ ok: false }); expect(await stale).toBeNull(); expect(listen.current()?.page).toBe('socket');
    const reentrant: string[] = [];
    const remove = listen.subscribe('hero', (_ds, set) => { if (set.page === 'outer') listen.apply({ page: 'inner', decisions: [] }); });
    listen.subscribe('story', (_ds, set) => reentrant.push(set.page)); reentrant.length = 0;
    const outer = listen.hydrate({ page: 'outer' }); await vi.advanceTimersByTimeAsync(0);
    requests[4]!({ ...snapshot, page: 'outer' }); expect(await outer).toBeNull();
    expect(reentrant).toEqual(['inner']); expect(listen.current()?.page).toBe('inner'); remove();
    let nested: Promise<DecisionSet | null> | undefined;
    const stop = listen.subscribe('hero', (ds, set) => {
      if (!ds.length && set.page === 'timeout-parent') nested = listen.hydrate({ page: 'timeout-child' });
    });
    const parent = listen.hydrate({ page: 'timeout-parent' }); await vi.advanceTimersByTimeAsync(100);
    requests[5]!({ ...snapshot, page: 'timeout-parent' }); expect(await parent).toBeNull();
    requests[6]!({ ...snapshot, page: 'timeout-child' }); expect((await nested)?.page).toBe('timeout-child'); stop();
    // An expired grant changes generation inside ready(), but must not cancel its own renewal.
    const fetch = f.host.fetch;
    f.host.fetch = async (url, init) => url.endsWith('/identity/session')
      ? { ok: true, status: 200, json: async () => ({ ok: true, session: { ...syntheticSession(f.host.now()), consent: { tracking: false, personalization: false } } }) } : fetch(url, init);
    f.tick(3_600_001);
    const renewal = listen.hydrate({ page: 'renewed' }); await vi.advanceTimersByTimeAsync(0);
    // Expired-token recovery is a new OFF owner, so its usable first paint is
    // genuinely default content, not the old owner's private snapshot.
    const recoveredDefault = { ...snapshot, arm: 'default', decisions: snapshot.decisions.map(d => ({ ...d, strategy: 'default' })) };
    requests.at(-1)!({ ...recoveredDefault, page: 'renewed' }); expect((await renewal)?.page).toBe('renewed');
    // A genuinely newer request started synchronously by ready() still owns the result.
    const ready = core.ready; let once = true;
    let generationChild: Promise<DecisionSet | null> | undefined;
    core.ready = () => { const pending = ready(); if (once) { once = false; generationChild = listen.hydrate({ page: 'identity-child' }); } return pending; };
    const before = requests.length;
    expect(await listen.hydrate({ page: 'identity-parent' })).toBeNull(); await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(before + 1);
    requests[before]!({ ...recoveredDefault, page: 'identity-child' }); expect((await generationChild)?.page).toBe('identity-child');
  });

  it('W35.02 source and shipped SDKs carry host-only entry and strip it across readiness withdrawal', async () => {
    const source = (config: ClientConfig, host: Host) => { const core = createCore(config, host); return { core, listen: createListen(core) }; };
    const factories = [source];
    for (const format of ['iife', 'esm']) {
      const code = readFileSync(`public/sdk/edge-personalization${format === 'esm' ? '.esm' : ''}.js`, 'utf8');
      const api = runInNewContext(format === 'esm' ? transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;'
        : code + '\nglobalThis.EdgePersonalization;', { module: { exports: {} }, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder,
        btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval }) as { createClient: typeof source };
      factories.push(api.createClient);
    }
    for (const factory of factories) {
      const f = testHost({ responses: () => snapshot, referrer: 'https://www.tiktok.com/private/path?secret=never-send' });
      const { core, listen } = factory({ tenant: 'coach' }, f.host);
      expect(await listen.hydrate({ page: 'home' })).not.toBeNull();
      const request = () => {
        const captured = f.calls.filter(c => c.url.includes('/decisions/snapshot')).at(-1)!;
        expect(new URL(captured.url).search).toBe(''); expect(captured.init!.method).toBe('POST');
        return { href: captured.url, searchParams: new URLSearchParams(JSON.parse(captured.init!.body!)) };
      };
      expect(JSON.parse(request().searchParams.get('entry')!)).toEqual({ utmMedium: 'paid_social', utmSource: 'tiktok', referrer: 'www.tiktok.com', siteHost: 'shop.example' });
      expect(request().href).not.toMatch(/secret|private|never-send/); expect(request().searchParams.has('channel')).toBe(false);
      await listen.hydrate({ page: 'home', channel: 'email' }); expect(request().searchParams.get('channel')).toBe('email');
      const getJson = core.getJson;
      core.getJson = (path, query) => { const pending = getJson(path, query); f.host.cookie.set('opt_tracking_consent', 'false', 10); return pending; };
      await listen.hydrate({ page: 'home' }); expect(request().searchParams.has('entry')).toBe(false);
      expect(request().searchParams.get('trackingConsent')).toBe('false');
      const oversized = testHost({ responses: () => snapshot, location: { href: 'https://shop.example', host: 'shop.example', hostname: 'shop.example', protocol: 'https:', search: '?utm_source=' + 'x'.repeat(257) } });
      await factory({ tenant: 'coach' }, oversized.host).listen.hydrate({ page: 'home' });
      expect(JSON.parse(oversized.calls.at(-1)!.init!.body!)).not.toHaveProperty('entry');
    }
  });

  it('W20.06 source and shipped SDKs drive actual storefront defaults and guarded actual-paint attribution', async () => {
    const sourceClient = (config: ClientConfig, host: Host) => {
      const core = createCore(config, host);
      return { core, listen: createListen(core), on: core.on, visitorId: core.visitorId, connect: () => undefined };
    };
    type Client = ReturnType<typeof sourceClient>;
    const factories: Array<[string, typeof sourceClient]> = [['source', sourceClient]];
    for (const format of ['iife', 'esm']) {
      const file = `public/sdk/edge-personalization${format === 'esm' ? '.esm' : ''}.js`;
      const code = readFileSync(file, 'utf8');
      const context = { module: { exports: {} }, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval };
      const api = runInNewContext(format === 'esm'
        ? transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;'
        : code + '\nglobalThis.EdgePersonalization;', context) as { createClient: typeof sourceClient };
      factories.push([format, api.createClient]);
    }
    for (const [format, factory] of factories) {
      const selectedResponse: { value?: DecisionSet } = {};
      const f = testHost({ renderAcks: true, responses: (_url, init) => JSON.parse(init?.body ?? '{}').page === 'home' && selectedResponse.value ? { ok: true, ...selectedResponse.value, pageInstance: JSON.parse(init!.body!).pageInstance } : ({ ok: false }) });
      const client = factory({ tenant: 'coach', hydrateTimeoutMs: 100 }, f.host);
      const elements = Object.fromEntries(['hero-content', 'hero-art', 'hero', 'story-card', 'story'].map(id => {
        const classes = new Set<string>();
        return [id, {
        innerHTML: id === 'hero-content' ? 'Site hero' : id === 'story-card' ? 'Site story' : '',
        dataset: {} as Record<string, string>, style: {} as Record<string, string>, classes,
        classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
        getAttribute: () => null, addEventListener: () => undefined,
      }]; }));
      const timers: Array<() => void> = [], transitions: Array<() => void> = [];
      const doc = { getElementById: (id: string) => elements[id], querySelector: () => null, addEventListener: vi.fn(),
        startViewTransition: undefined as undefined | ((fn: () => void) => void) };
      let loadMap!: (value: unknown) => void;
      const catalog = new Promise(resolve => { loadMap = resolve; });
      const sandbox = { document: doc, window: { EdgePersonalization: { createClient: () => ({ ...client, connect: () => undefined }) } },
        fetch: () => catalog, setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; }, performance: { now: () => 0 } };
      const prototype = runInNewContext(readFileSync('public/storefront.js', 'utf8') + '\nCoachStorefront.prototype;', sandbox) as object;
      type Store = {
        initSdk(): boolean; _renderEngineSlots(slot?: string): void; heroCta(): void;
        sdk: Client; contentById: Map<string, unknown> | null; _engineHero: unknown; _engineStory: unknown;
        _paintedEngineHero: { contentId: string } | null; _sdkHeroOwned: boolean; _sdkStoryOwned: boolean;
      };
      const store = Object.assign(Object.create(prototype) as Store, { lineImage: () => 'existing-site-art', renderMarkers: vi.fn(),
        logEvent: vi.fn(), go: vi.fn(), eventCount: 0 });
      expect(store.initSdk(), format).toBe(true); await client.core.ready(); await vi.advanceTimersByTimeAsync(0);
      expect(elements['hero-content']!.innerHTML).toBe('Site hero'); expect(elements['story-card']!.innerHTML).toBe('Site story');
      const selected = offeredSet({ ...snapshot, decisions: snapshot.decisions.map(d => ({ ...d, slot: d.slot === 'hero' ? 'chero' : d.slot })) } as DecisionSet,
        JSON.parse(f.calls.find(c => c.url.endsWith('/decisions/snapshot'))!.init!.body!).pageInstance);
      selectedResponse.value = selected;
      client.listen.apply(selected); expect(timers).toHaveLength(0); store.heroCta();
      const actions = () => f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!));
      expect(actions()).toEqual([]);
      const pieces = selected.decisions.map(d => ({ id: d.contentId, title: `Paint ${d.contentId}`, tags: {}, art: 'held-art' }));
      loadMap({ json: async () => ({ pieces }) }); await vi.advanceTimersByTimeAsync(0);
      expect(timers).toHaveLength(2); expect(actions()).toEqual([]);
      client.listen.apply({ page: 'home', decisions: [] });
      for (const fill of timers.splice(0).reverse()) fill();
      expect(elements['hero-content']!.innerHTML).toBe('Site hero'); expect(elements['story-card']!.innerHTML).toBe('Site story');
      expect(actions()).toEqual([]);
      client.listen.apply(selected);
      for (const fill of timers.splice(0).reverse()) fill(); await vi.advanceTimersByTimeAsync(0);
      expect(elements['hero-content']!.innerHTML).toContain('Paint c1'); expect(elements['story-card']!.innerHTML).toContain('Paint c3');
      expect(actions().map(a => [a.type, a.data.contentId])).toEqual([['content_impression', 'c3'], ['content_impression', 'c1']]);
      const beforeClick = actions().length;
      store.heroCta(); await vi.advanceTimersByTimeAsync(0);
      expect(actions().slice(beforeClick)).toEqual([expect.objectContaining({ type: 'content_click', data: expect.objectContaining({ contentId: 'c1', decisionId: selected.decisions.find(d => d.slot === 'chero')!.decisionId }) })]);
      const count = actions().length;
      let throwTransition = true;
      doc.startViewTransition = fn => { if (throwTransition) { throwTransition = false; throw new Error('use fade once'); } transitions.push(fn); };
      const newer = offeredSet({ page: 'home', decisions: selected.decisions.map(d => ({ ...d, contentId: d.contentId + '-new' })) }, selected.pageInstance);
      // Different IDs with the same displayed title must not take the old title-only fast path.
      for (const d of newer.decisions) store.contentById!.set(d.contentId, { id: d.contentId, title: `Paint ${d.contentId.replace('-new', '')}`, tags: {}, art: 'held-art' });
      client.listen.apply(newer); expect(actions()).toHaveLength(count); expect(store._paintedEngineHero?.contentId).toBe('c1');
      expect(elements['hero-content']!.classes.has('fading')).toBe(true);
      // Absence reaches each slot separately; it must not capture the still-pending sibling.
      store.contentById = null; client.listen.apply({ page: 'home', decisions: [] });
      expect(store._paintedEngineHero).toBeNull(); store.heroCta(); await vi.advanceTimersByTimeAsync(0);
      expect(actions()).toHaveLength(count);
      for (const fill of transitions.splice(0).reverse()) fill();
      for (const fill of timers.splice(0).reverse()) fill(); await vi.advanceTimersByTimeAsync(0);
      expect(elements['hero-content']!.innerHTML).toContain('The Tabby Shop'); expect(elements['story-card']!.innerHTML).toContain('Since 1941');
      expect(elements['hero-content']!.classes.has('fading')).toBe(false); expect(elements['story-card']!.classes.has('fading')).toBe(false);
      expect(actions()).toHaveLength(count); client.listen.apply({ page: 'home', decisions: [] });
      expect(timers).toHaveLength(0); expect(transitions).toHaveLength(0);
      store.contentById = new Map(pieces.map(p => [p.id, p])); client.listen.apply(selected);
      for (const fill of transitions.splice(0)) fill(); for (const fill of timers.splice(0)) fill(); await vi.advanceTimersByTimeAsync(0);
      store.contentById = new Map(); client.listen.apply(newer);
      for (const fill of transitions.splice(0)) fill(); for (const fill of timers.splice(0)) fill();
      expect(elements['hero-content']!.innerHTML).toContain('The Tabby Shop'); expect(store._paintedEngineHero).toBeNull();
      expect(await client.listen.hydrate({ page: 'failure' })).toBeNull(); expect(client.listen.current()).toBeNull();
      const late: unknown[] = []; client.listen.subscribe('chero', (ds, set) => late.push([ds, set.page]));
      expect(late).toEqual([[[], 'failure']]);
    }
  });
});

describe('W15 supported refresh, render admission and server adoption', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('crypto', webcrypto); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  function factories() {
    const entries: Array<[string, typeof createClient]> = [['source', createClient]];
    for (const format of ['iife', 'esm']) {
      const code = readFileSync(`public/sdk/edge-personalization${format === 'esm' ? '.esm' : ''}.js`, 'utf8');
      const api = runInNewContext(format === 'esm' ? transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;'
        : code + '\nglobalThis.EdgePersonalization;', { module: { exports: {} }, URL, URLSearchParams, AbortController,
        TextEncoder, TextDecoder, crypto: webcrypto, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval }) as { createClient: typeof createClient };
      entries.push([format, api.createClient]);
    }
    return entries;
  }
  function publishedCallback(): string {
    const callbacks = ['docs/kit/01-integration-guide.md', 'src/sdk/README.md'].map(path => {
      const callback = readFileSync(path, 'utf8').match(/client\.listen\.subscribe\('hero', \(decisions\) => \{[\s\S]*?\n\}\);/)?.[0];
      expect(callback, path).toBeTruthy(); return callback!;
    });
    expect(callbacks[1]).toBe(callbacks[0]);
    return callbacks[0]!;
  }
  it('W15 exact published callback paints after one to three acknowledged interactions and refuses unusable CMS assets', async () => {
    const callback = publishedCallback();
    for (const [format, factory] of factories()) for (const interactionCount of [1, 2, 3]) {
      const dom = new JSDOM('<main><section id="hero"><a href="/default">Site default</a></section></main>', { url: 'https://shop.example/home' });
      const document = dom.window.document, heroElement = document.querySelector<HTMLElement>('#hero')!, initialDocument = document;
      const defaultMarkup = heroElement.innerHTML;
      let cmsId = 'CMS-initial', revision = 0, acknowledged = 0, holdSnapshots = false, active = 0, maxActive = 0;
      const cms = new Map([
        ['CMS-initial', { category: 'bags', title: 'Initial hero' }],
        ['CMS-interest', { category: 'bags', title: 'Interest hero' }],
        ['CMS-published', { category: 'bags', title: 'Published hero' }],
        ['CMS-deleted', { category: 'bags', title: 'Deleted hero' }],
        ['CMS-cross-category', { category: 'shoes', title: 'Wrong category' }],
      ]);
      const pending: Array<() => void> = [], offers: DecisionSet[] = [], captured: Array<{ event: ActionEnvelope; html: string }> = [];
      const sent: ActionEnvelope[] = [];
      const f = testHost({ responses: async (url, init) => {
        if (url.endsWith('/action')) {
          const event = JSON.parse(init!.body!) as ActionEnvelope;
          captured.push({ event, html: heroElement.innerHTML });
          if (event.type === 'product_view') { acknowledged++; cmsId = 'CMS-interest'; }
          return renderAck(init);
        }
        expect(url).toContain('/decisions/snapshot'); active++; maxActive = Math.max(maxActive, active);
        try {
          if (holdSnapshots) await new Promise<void>(resolve => pending.push(resolve));
          const set = offeredSet({ ...snapshot, versions: { config: 41 + revision }, decisions: [
            { ...snapshot.decisions[1]!, customerContentId: cmsId },
          ] } as DecisionSet, JSON.parse(init!.body!).pageInstance, `offer-${++revision}`);
          offers.push(set); return { ok: true, ...set };
        } finally { active--; }
      } });
      f.host.dom = { querySelectorAll: selector => document.querySelectorAll(selector), observe: () => () => undefined };
      const client = factory({ tenant: 'coach', brand: 'coach' }, f.host, { refreshMs: 1000 });
      client.on('sent', event => sent.push(event));
      const renderDefaultHero = vi.fn(() => { heroElement.innerHTML = defaultMarkup; });
      const renderHero = vi.fn((id: string) => {
        if (id === 'CMS-failed') throw new Error('Synthetic CMS lookup failed');
        const asset = cms.get(id); if (!asset || asset.category !== 'bags') return false;
        const link = document.createElement('a'); link.href = '/bags'; link.textContent = asset.title;
        link.dataset.cmsId = id; heroElement.replaceChildren(link); return true;
      });
      const rendered = vi.spyOn(client.emit, 'rendered');
      runInNewContext(callback, { client, renderHero, renderDefaultHero, heroElement });
      await client.listen.refresh({ page: 'home' }); await vi.advanceTimersByTimeAsync(0);
      const impressions = () => captured.filter(x => x.event.type === 'content_impression');
      expect(heroElement.textContent, format).toBe('Initial hero'); expect(impressions()).toHaveLength(1);
      expect(impressions()[0]!.html).toContain('CMS-initial');
      const pageInstance = offers[0]!.pageInstance, initialReceipt = impressions()[0]!.event.data.decisionId;
      // No direct refresh/apply after setup: the real ACK->sent listener owns this burst.
      holdSnapshots = true;
      await client.emit.productView('bag-0', { category: 'bags' }); await vi.advanceTimersByTimeAsync(0);
      expect(pending).toHaveLength(1); // Remaining ACKs arrive during the actual first snapshot.
      await Promise.all(Array.from({ length: interactionCount - 1 }, (_, n) => client.emit.productView(`bag-${n + 1}`, { category: 'bags' })));
      await vi.advanceTimersByTimeAsync(0);
      expect(acknowledged).toBe(interactionCount);
      expect(sent.filter(e => e.type === 'product_view')).toHaveLength(interactionCount);
      expect(pending).toHaveLength(1); expect(offers).toHaveLength(1); expect(heroElement.textContent).toBe('Initial hero');
      pending.shift()!(); await vi.advanceTimersByTimeAsync(0);
      if (interactionCount > 1) {
        expect(pending).toHaveLength(1); expect(heroElement.textContent).toBe('Initial hero');
        expect(impressions()).toHaveLength(1); pending.shift()!(); await vi.advanceTimersByTimeAsync(0);
      }
      holdSnapshots = false;
      expect(pending).toHaveLength(0); expect(maxActive).toBe(1);
      expect(offers).toHaveLength(interactionCount === 1 ? 2 : 3);
      expect(heroElement.textContent).toBe('Interest hero'); expect(impressions()).toHaveLength(2);
      const interest = impressions()[1]!.event;
      expect(interest.data).toMatchObject({ customerContentId: 'CMS-interest', decisionId: offers.at(-1)!.decisions[0]!.decisionId, pageInstance });
      expect(interest.data.decisionId).not.toBe(initialReceipt); expect(impressions()[1]!.html).toContain('CMS-interest');
      expect(await rendered.mock.results.at(-1)!.value).toMatchObject({ status: 'durable', decisionId: interest.data.decisionId, eventId: interest.eventId });
      // Another real interaction requests a new offer but cannot re-admit unchanged DOM.
      const interestNode = heroElement.firstChild, paintCount = renderHero.mock.calls.length;
      await client.emit.productView('same-bag'); await vi.advanceTimersByTimeAsync(0);
      expect(heroElement.firstChild).toBe(interestNode); expect(renderHero).toHaveBeenCalledTimes(paintCount);
      expect(impressions()).toHaveLength(2); expect(client.listen.current()!.decisions[0]!.decisionId).toBe(interest.data.decisionId);
      const click = vi.fn(() => { void client.emit.contentClick('c1', 'hero', { decisionId: interest.data.decisionId }); });
      heroElement.querySelector('a')!.addEventListener('click', event => { event.preventDefault(); click(); });
      heroElement.querySelector('a')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(0); expect(click).toHaveBeenCalledTimes(1);
      expect(captured.filter(x => x.event.type === 'content_click').map(x => x.event.data.decisionId)).toEqual([interest.data.decisionId]);
      expect(impressions()).toHaveLength(2);
      // Simulate the already-covered operator publication boundary; supported polling observes it.
      cmsId = 'CMS-published'; const beforePublication = offers.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(offers).toHaveLength(beforePublication + 1); expect(heroElement.textContent).toBe('Published hero');
      expect(heroElement.firstChild).not.toBe(interestNode); expect(impressions()).toHaveLength(3);
      const published = impressions()[2]!.event;
      expect(published.data).toMatchObject({ customerContentId: 'CMS-published', pageInstance, decisionId: offers.at(-1)!.decisions[0]!.decisionId });
      expect(published.data.decisionId).not.toBe(interest.data.decisionId); expect(impressions()[2]!.html).toContain('CMS-published');
      expect(await rendered.mock.results.at(-1)!.value).toMatchObject({ status: 'durable', decisionId: published.data.decisionId, eventId: published.eventId });
      for (const unavailable of ['CMS-missing', 'CMS-deleted', 'CMS-cross-category', 'CMS-failed']) {
        if (unavailable === 'CMS-deleted') { expect(cms.has(unavailable)).toBe(true); cms.delete(unavailable); }
        cmsId = unavailable; const before = captured.length, renderCalls = rendered.mock.calls.length;
        await vi.advanceTimersByTimeAsync(1000);
        expect(heroElement.innerHTML, `${format}:${unavailable}`).toBe(defaultMarkup);
        expect(renderHero).toHaveBeenLastCalledWith(unavailable); expect(rendered).toHaveBeenCalledTimes(renderCalls);
        const refused = offers.at(-1)!.decisions[0]!;
        expect(await client.emit.contentClick('c1', 'hero', { decisionId: refused.decisionId })).toBeNull();
        expect(await client.emit.contentDwell('c1', 'hero', 1500, { decisionId: refused.decisionId })).toBeNull();
        expect(await client.emit.contentClick('c1', 'hero', { decisionId: published.data.decisionId })).toBeNull();
        expect(captured).toHaveLength(before); expect(impressions()).toHaveLength(3);
      }
      expect(renderDefaultHero).toHaveBeenCalledTimes(4);
      expect(dom.window.document).toBe(initialDocument); expect(dom.window.location.href).toBe('https://shop.example/home');
      expect(offers.every(set => set.pageInstance === pageInstance)).toBe(true);
      client.destroy(); dom.window.close();
    }
  });
  it('W15 coalesces every trailing intent and never paints an older same-page interaction response', async () => {
    for (const [format, factory] of factories()) {
      const waits: Array<{ request: { page: string; pageInstance: string }; resolve: (value: unknown) => void }> = [];
      const f = testHost({ responses: (_url, init) => new Promise(resolve => waits.push({ request: JSON.parse(init!.body!), resolve })) });
      const client = factory({ tenant: 'coach', hydrateTimeoutMs: 100 }, f.host), seen: string[] = [];
      client.listen.onDecisions(set => { if (set) seen.push(set.page); }); await client.core.ready();
      const first = client.listen.refresh({ page: 'home' }); await vi.advanceTimersByTimeAsync(0);
      expect(waits, format).toHaveLength(1); expect(client.listen.refresh()).toBe(first);
      const reply = (index: number) => waits[index]!.resolve({ ok: true, ...offeredSet({ ...snapshot, page: waits[index]!.request.page } as DecisionSet, waits[index]!.request.pageInstance) });
      reply(0); await vi.advanceTimersByTimeAsync(0); expect(waits).toHaveLength(2); expect(seen).toEqual([]);
      client.listen.refresh({ page: 'category-b' }); client.listen.refresh();
      reply(1); await vi.advanceTimersByTimeAsync(0); expect(waits).toHaveLength(3); expect(seen).toEqual([]);
      expect(waits[2]!.request.page).toBe('category-b'); reply(2); expect((await first)?.page).toBe('category-b'); expect(seen).toEqual(['category-b']);
      client.destroy();
    }
  });
  it('W15 retries exactly one original render identity, gates outcomes, preserves unchanged paint and replaces changed assets', async () => {
    for (const [format, factory] of factories()) {
      let release!: (value: unknown) => void, held = true;
      const f = testHost({ responses: (_url, init) => held ? new Promise(resolve => { release = resolve; }) : renderAck(init) });
      const client = factory({ tenant: 'coach' }, f.host); await client.core.ready();
      const set = offeredSet(snapshot as DecisionSet), piece = set.decisions.find(d => d.slot === 'hero')!;
      const paints = vi.fn(); client.listen.subscribe('hero', paints); client.listen.apply(set);
      const original = client.listen.rendered('hero', 'c1'), click = client.emit.contentClick('c1', 'hero'); await vi.advanceTimersByTimeAsync(0);
      const actions = () => f.calls.filter(c => c.url.endsWith('/action')); expect(actions(), format).toHaveLength(1);
      release({ success: true, render: { ...renderAck(actions()[0]!.init).render, decisionId: 'foreign' } });
      expect(await original).toBeNull(); expect(await click).toBeNull(); expect(actions()).toHaveLength(1);
      held = false; f.tick(1000); expect(await client.listen.rendered('hero', 'c1')).toMatchObject({ decisionId: piece.decisionId });
      expect(actions()[1]!.init!.body).toBe(actions()[0]!.init!.body);
      client.listen.apply(offeredSet({ ...snapshot, versions: { config: 42 } } as DecisionSet, set.pageInstance, 'poll'));
      expect(client.listen.current()!.decisions.find(d => d.slot === 'hero')!.decisionId).toBe(piece.decisionId); expect(paints.mock.calls.at(-1)![0][0]).toEqual(piece);
      expect(paints).toHaveBeenCalledTimes(1);
      const callbacks = paints.mock.calls.length;
      await client.emit.contentClick('c1', 'hero'); expect(JSON.parse(actions().at(-1)!.init!.body!).data.decisionId).toBe(piece.decisionId);
      const changed = offeredSet({ ...snapshot, decisions: snapshot.decisions.map(d => d.slot === 'hero' ? { ...d, customerContentId: 'CMS-published', type: 'video' } : d) } as DecisionSet, set.pageInstance, 'published');
      client.listen.apply(changed); expect(paints).toHaveBeenCalledTimes(callbacks + 1); const count = actions().length;
      expect(await client.emit.contentClick('c1', 'hero')).toBeNull(); expect(actions()).toHaveLength(count);
      expect(await client.listen.rendered('hero', 'c1')).toMatchObject({ decisionId: changed.decisions.find(d => d.slot === 'hero')!.decisionId });
      await client.emit.contentClick('c1', 'hero'); expect(JSON.parse(actions().at(-1)!.init!.body!).data.decisionId).toMatch(/^published-/);
      client.destroy();
    }
  });
  it('W15 bounds a stalled broker body, cancels its reader and releases the authority lease for a retry', async () => {
    for (const [format, factory] of factories()) {
      const f = testHost(), grant = syntheticSession(f.host.now()), cancel = vi.fn(); let stalled = true;
      f.host.fetch = async (url, init) => {
        f.calls.push({ url, init }); expect(url).toBe('https://shop.example/shopper-broker');
        if (!stalled) {
          expect(JSON.parse(init!.body!)).toEqual({ consent: { tracking: false, personalization: false } });
          return { ok: true, status: 200, json: async () => ({ ok: true, session: { ...grant, consent: { tracking: false, personalization: false } } }) };
        }
        return new Response(new ReadableStream({ cancel }));
      };
      const client = factory({ tenant: 'coach', sessionBroker: '/shopper-broker', hydrateTimeoutMs: 100 }, f.host), defaults: unknown[] = [];
      client.listen.onDecisions(set => defaults.push(set)); const pending = client.listen.refresh({ page: 'home' });
      await vi.advanceTimersByTimeAsync(5001); expect(await pending, format).toBeNull(); expect(defaults).toEqual([null]); expect(cancel).toHaveBeenCalledTimes(1);
      stalled = false; expect(await client.core.ready()).toBe(true); expect(client.core.consent).toEqual({ tracking: false, personalization: false }); expect(f.calls).toHaveLength(2); client.destroy();
    }
  });
  it('W15 actual DOM server adoption uses canonical same-cookie authority and inert private bootstrap without repaint', async () => {
    const f = testHost(); vi.setSystemTime(f.host.now()); const grant = syntheticSession(f.host.now());
    const requests: Request[] = [];
    const bridge = createServerBridge({ tenant: 'coach', origin: 'https://shop.example', endpoint: 'https://engine.example', sdkKey: 'synthetic-site-key' }, async (input, init) => {
      const request = new Request(input, init); requests.push(request);
      if (request.url.endsWith('/identity/session')) return Response.json({ ok: true, session: grant });
      const body = await request.json() as { page: string; pageInstance: string };
      return Response.json({ ok: true, tenant: 'coach', ...offeredSet({ ...snapshot, page: body.page } as DecisionSet, body.pageInstance) });
    });
    const { bootstrap, headers } = await bridge.snapshot(new Request('https://shop.example/home'), 'home');
    expect(bootstrap).not.toBeNull(); expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('Set-Cookie')).toContain('Secure; HttpOnly; SameSite=Lax'); expect(requests).toHaveLength(2);
    expect(requests[1]!.headers.get('X-Shopper-Session')).toBe(grant.capability); expect(bootstrapJSON(bootstrap!)).not.toContain(grant.capability);
    const escaped = bootstrapJSON({ ...bootstrap!, decisions: [{ ...bootstrap!.decisions[0]!, customerContentId: '</script><script>bad</script>\u2028' }] });
    expect(escaped).not.toContain('<'); expect(escaped).toContain('\\u003c'); expect(escaped).toContain('\\u2028');
    const callback = publishedCallback();
    for (const [format, factory] of factories()) for (const refusal of ['stale', 'foreign']) {
      const local = testHost({ renderAcks: true }), base = local.host.fetch;
      local.host.fetch = async (url, init) => url === 'https://shop.example/shopper-broker'
        ? { ok: true, status: 200, json: async () => ({ ok: true, session: grant }) } : base(url, init);
      const dom = new JSDOM('<section id="hero"></section><section id="story"></section><script id="bootstrap" type="application/json"></script>', { url: 'https://shop.example/home' });
      const document = dom.window.document, heroElement = document.querySelector<HTMLElement>('#hero')!, storyElement = document.querySelector<HTMLElement>('#story')!;
      document.querySelector('#bootstrap')!.textContent = bootstrapJSON(bootstrap!);
      const parsed = JSON.parse(document.querySelector('#bootstrap')!.textContent!);
      for (const d of bootstrap!.decisions) {
        const element = document.createElement('a'); element.textContent = `Server ${d.customerContentId}`; element.href = '/content';
        for (const [key, value] of Object.entries({ 'data-op-page-instance': bootstrap!.pageInstance, 'data-op-slot': d.slot,
          'data-op-content': d.contentId, 'data-op-position': String(d.order), 'data-op-decision-id': d.decisionId! })) element.setAttribute(key, value);
        document.querySelector(`#${d.slot}`)!.append(element);
      }
      const elements = [...document.querySelectorAll('[data-op-page-instance]')], html = document.body.innerHTML;
      local.host.dom = { querySelectorAll: selector => document.querySelectorAll(selector), observe: () => () => undefined };
      const client = factory({ tenant: 'coach', endpoint: 'https://engine.example', sessionBroker: '/shopper-broker' }, local.host), repaint = vi.fn();
      const renderHero = vi.fn(() => { heroElement.textContent = 'Unexpected client paint'; return true; });
      const renderDefaultHero = vi.fn(() => { heroElement.textContent = 'Site hero default'; });
      runInNewContext(callback, { client, renderHero, renderDefaultHero, heroElement });
      const storyRepaint = vi.fn((decisions: DecisionSet['decisions']) => { if (!decisions.length) storyElement.textContent = 'Site story default'; });
      client.listen.subscribe('story', storyRepaint);
      client.listen.subscribe('hero', repaint); expect(await client.listen.adopt(parsed, { page: 'home' }), format).toBe(true);
      client.listen.subscribe('hero', repaint); await vi.advanceTimersByTimeAsync(0); expect(repaint).not.toHaveBeenCalled();
      expect(renderHero).not.toHaveBeenCalled(); expect(renderDefaultHero).not.toHaveBeenCalled(); expect(storyRepaint).not.toHaveBeenCalled();
      expect(document.body.innerHTML).toBe(html);
      const adoptedElements = [...document.querySelectorAll('[data-op-page-instance]')];
      expect(adoptedElements).toHaveLength(elements.length); elements.forEach((element, index) => { expect(adoptedElements[index]).toBe(element); expect(element.isConnected).toBe(true); });
      const actions = () => local.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!) as ActionEnvelope);
      expect(actions()).toHaveLength(3);
      expect(actions().map(a => a.data.decisionId).sort()).toEqual(bootstrap!.decisions.map(d => d.decisionId).sort());
      expect(actions().every(a => a.type === 'content_impression' && a.data.pageInstance === bootstrap!.pageInstance)).toBe(true);
      const invalid = refusal === 'stale' ? { ...parsed, until: local.host.now() }
        : { ...parsed, sessionWitness: await sessionWitness(syntheticSession(f.host.now()).capability) };
      expect(await client.listen.adopt(invalid, { page: 'home' }), `${format}:${refusal}`).toBe(false);
      expect(repaint).toHaveBeenCalled(); expect(client.listen.current()).toBeNull();
      expect(renderDefaultHero).toHaveBeenCalledTimes(1); expect(renderHero).not.toHaveBeenCalled();
      expect(heroElement.textContent).toBe('Site hero default'); expect(storyElement.textContent).toBe('Site story default');
      expect(document.querySelectorAll('[data-op-page-instance]')).toHaveLength(0); expect(elements.every(element => !element.isConnected)).toBe(true);
      expect(await client.emit.contentClick('c1', 'hero', { decisionId: bootstrap!.decisions.find(d => d.slot === 'hero')!.decisionId })).toBeNull();
      expect(actions()).toHaveLength(3); client.destroy(); dom.window.close();
    }
  });
  it('W15 server broker cancels stalled inbound and injected outbound readers, refusing foreign origins without egress', async () => {
    const inboundCancel = vi.fn(), outboundCancel = vi.fn(), transport = vi.fn(async () => new Response(new ReadableStream({ cancel: outboundCancel })));
    const bridge = createServerBridge({ tenant: 'coach', origin: 'https://shop.example', endpoint: 'https://engine.example', sdkKey: 'synthetic', timeoutMs: 100 }, transport);
    const request = new Request('https://shop.example/broker', { method: 'POST', headers: { Origin: 'https://shop.example' }, body: new ReadableStream({ cancel: inboundCancel }), duplex: 'half' } as RequestInit);
    const pending = bridge.broker(request); await vi.advanceTimersByTimeAsync(101); expect((await pending).status).toBe(401); expect(inboundCancel).toHaveBeenCalledTimes(1); expect(transport).not.toHaveBeenCalled();
    const outbound = bridge.broker(new Request('https://shop.example/broker', { method: 'POST', headers: { Origin: 'https://shop.example' }, body: '{}' }));
    await vi.advanceTimersByTimeAsync(101); expect((await outbound).status).toBe(401); expect(outboundCancel).toHaveBeenCalledTimes(1);
    const count = transport.mock.calls.length; expect((await bridge.broker(new Request('https://shop.example/broker', { method: 'POST', headers: { Origin: 'https://foreign.example' }, body: '{}' }))).status).toBe(401);
    expect(transport).toHaveBeenCalledTimes(count);
  });
});

describe('W05.10 R1 actual client decision delivery', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const lifetime = 30 * 86400 * 1000;
  const privateSet: DecisionSet = { ...snapshot, decisions: snapshot.decisions as DecisionSet['decisions'] };
  // Exploration can choose a visitor-keyed non-default arm without positive
  // affinity scores or per-piece drivers. A real default pin remains public.
  const exploration: DecisionSet = { page: 'home', arm: 'explore', decisions: [
    { ...privateSet.decisions[0]!, slot: 'hero', strategy: 'default', score: 0, explain: { drivers: [] } },
  ] };
  const defaultPin: DecisionSet = { ...exploration, arm: 'default', decisions: exploration.decisions.map(d => ({ ...d, strategy: 'tenant-pinned' })) };

  function factory(format: string): typeof createClient {
    if (format === 'source') return createClient;
    const code = readFileSync(`public/sdk/edge-personalization${format === 'esm' ? '.esm' : ''}.js`, 'utf8');
    const api = runInNewContext(format === 'esm' ? transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;'
      : code + '\nglobalThis.EdgePersonalization;', { module: { exports: {} }, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder,
      btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval }) as { createClient: typeof createClient };
    return api.createClient;
  }
  async function setup(format: string, choice: 'live' | 'near-expiry' | 'absent' = 'live', response: DecisionSet = privateSet) {
    const f = testHost(), grant = syntheticSession(f.host.now());
    if (choice === 'near-expiry') for (const key of ['tracking', 'personalization'] as const) {
      grant.consent.instruction[key] = { value: true, chosenAt: f.host.now() + 10 - lifetime, expiresAt: f.host.now() + 10 };
    }
    f.host.fetch = async (url, init) => {
      f.calls.push({ url, init });
      const body = url.endsWith('/identity/session') ? { ok: true, session: choice === 'absent' ? { ...grant, consent: { tracking: false, personalization: false } } : grant }
        : url.endsWith('/preferences') ? preferenceAck(f.host, init, JSON.parse(init!.body!))
        : { ok: true, ...response, ...(response.arm === 'default' ? { sources: { consent: { tracking: false, personalization: false } } } : {}) };
      return { ok: true, status: 200, json: async () => body };
    };
    const client = factory(format)({ tenant: 'coach' }, f.host);
    expect(await client.core.ready()).toBe(true);
    return { ...f, client, grant };
  }
  async function holdMirror(f: Awaited<ReturnType<typeof setup>>) {
    const acquire = f.host.acquireAuthorityLock!;
    const key = `opt_shopper_session:${encodeURIComponent(f.client.core.config.endpoint)}:coach:authority`;
    const release = await acquire(key);
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    f.host.acquireAuthorityLock = name => { expect(name).toBe(key); entered(); return acquire(name); };
    return { waiting, release };
  }

  for (const format of ['source', 'esm', 'iife']) {
    it(`W07.05 ${format}: actual client keeps context/identity/key out of URLs and preserves exact choice ownership`, async () => {
      const f = testHost(), grant = syntheticSession(f.host.now()), siteKey = 'fixture-secret-ü';
      f.host.fetch = async (url, init) => {
        f.calls.push({ url, init });
        return { ok: true, status: 200, json: async () => url.endsWith('/identity/session') ? { ok: true, session: grant }
          : url.endsWith('/preferences') ? preferenceAck(f.host, init, JSON.parse(init!.body!)) : { ok: true, ...privateSet, page: JSON.parse(init?.body ?? '{}').page ?? privateSet.page } };
      };
      const client = factory(format)({ tenant: 'coach', sdkKey: siteKey }, f.host);
      expect(await client.core.ready()).toBe(true); client.connect(); await vi.advanceTimersByTimeAsync(0);
      expect(f.sockets[0]!.url).toBe('wss://shop.example/realtime/ws?tenant=coach');
      expect(f.sockets[0]!.protocols).toEqual(['shopper-session-v1', grant.capability,
        'sdk-key-v1.' + btoa(String.fromCharCode(...new TextEncoder().encode(siteKey))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')]);
      expect(await client.listen.hydrate({ page: 'private-page', channel: 'private-channel' })).not.toBeNull();
      const request = f.calls.find(c => c.url.endsWith('/decisions/snapshot'))!;
      expect(request.url).toBe('https://shop.example/v1/coach/decisions/snapshot'); expect(request.init!.method).toBe('POST');
      expect(request.init!.headers).toMatchObject({ 'X-Shopper-Session': grant.capability, 'X-SDK-Key': siteKey });
      const body = JSON.parse(request.init!.body!); expect(body).toMatchObject({ page: 'private-page', channel: 'private-channel', browsingSessionId: client.core.sessionId });
      expect(body).not.toHaveProperty('visitorId'); expect(body).not.toHaveProperty('sessionId'); expect(body).not.toHaveProperty('userId');
      const count = f.calls.length;
      for (const query of [{ visitorId: 'other' }, { userId: '' }, { sessionId: 'old' }, { userId: null }]) {
        expect(await client.core.getJson(client.core.config.paths.snapshot, query as never)).toBeNull();
      }
      expect(f.calls).toHaveLength(count);
      expect(await client.core.postJson('/realtime/session/old/preferences', { trackingConsent: false })).toEqual({ ok: false, status: 0, json: null });
      expect(f.calls).toHaveLength(count);
      await client.core.postJson('/realtime/session/' + grant.sessionId + '/preferences', { userId: grant.subject, trackingConsent: false });
      const preference = f.calls.at(-1)!;
      expect(preference.url).toBe('https://shop.example/realtime/session/preferences');
      expect(JSON.parse(preference.init!.body!)).toMatchObject({ trackingConsent: false, choice: { grantId: grant.grantId } });
      expect(JSON.parse(preference.init!.body!)).not.toHaveProperty('userId');
      expect(client.core.consent.tracking).toBe(false); expect(client.core.visitorId).toBe(grant.subject);
      client.disconnect();
    });
    it(`${format}: expiry during the actual mirror lock suppresses hydrate and public core returns`, async () => {
      for (const direct of [false, true]) {
        const f = await setup(format, 'near-expiry'), seen: unknown[] = [];
        f.client.listen.onDecisions(set => seen.push(set));
        const lock = await holdMirror(f);
        const pending = direct ? f.client.core.getJson(f.client.core.config.paths.snapshot, { page: 'home' }) : f.client.listen.hydrate({ page: 'home' });
        await lock.waiting;
        f.tick(11); expect(f.client.core.isCurrent(f.client.core.generation)).toBe(true);
        lock.release(); expect(await pending).toBeNull();
        expect(f.client.listen.current()).toBeNull(); expect(seen.every(value => value === null)).toBe(true);
      }
    });

    it(`${format}: populated private cache is unavailable to current, immediate subscriptions and direct apply after refusal or expiry`, async () => {
      for (const refusal of [false, true]) {
        const f = await setup(format, 'near-expiry');
        f.client.listen.apply(privateSet); expect(f.client.listen.current()).toEqual(privateSet);
        if (refusal) f.host.cookie.set('opt_personalization_enabled', 'false', 30);
        else f.tick(11);
        expect(f.client.listen.current()).toBeNull();
        const late: unknown[] = [];
        f.client.listen.subscribe('hero', (decisions, set) => late.push([decisions, set.page]));
        expect(late).toEqual([[[], 'home']]);
        f.client.listen.apply(exploration); expect(f.client.listen.current()).toBeNull();
        expect(late.every(value => (value as [unknown[]])[0].length === 0)).toBe(true);
        expect(f.calls.filter(call => call.url.endsWith('/action'))).toEqual([]);
      }
    });

    it(`${format}: zero-score non-default arms require a choice while genuine default pins and their refusal acknowledgments remain usable`, async () => {
      const f = await setup(format, 'absent', defaultPin), seen: unknown[] = [];
      f.client.listen.onDecisions(set => seen.push(set));
      f.client.listen.apply(exploration); expect(f.client.listen.current()).toBeNull(); expect(seen).toEqual([null]);
      for (const arm of [undefined, 'unknown']) {
        f.client.listen.apply({ ...exploration, arm }); expect(f.client.listen.current()).toBeNull();
      }
      f.client.listen.apply({ page: 'home', decisions: [] }); expect(f.client.listen.current()).toEqual({ page: 'home', decisions: [] });
      f.client.listen.apply(defaultPin); expect(f.client.listen.current()).toEqual(defaultPin);
      expect(await f.client.listen.hydrate({ page: 'home' })).toEqual(defaultPin);
      expect(await f.client.core.getJson(f.client.core.config.paths.snapshot)).toMatchObject(defaultPin);
      expect(f.client.core.consent).toEqual({ tracking: false, personalization: false });
      const consenting = await setup(format, 'live', defaultPin);
      expect(await consenting.client.listen.hydrate({ page: 'home' })).toEqual(defaultPin);
      expect(consenting.client.core.consent).toEqual({ tracking: false, personalization: false });
    });

    it(`${format}: callback-time expiry and reentrant default delivery cannot return or deliver the old private set`, async () => {
      for (const reentrant of [false, true]) {
        const f = await setup(format, 'near-expiry'), seen: string[] = [];
        f.client.listen.subscribe('hero', (_decisions, set) => {
          seen.push(`first:${set.arm ?? 'absence'}`);
          if (set.arm === privateSet.arm) { f.tick(11); if (reentrant) f.client.listen.apply(defaultPin); }
        });
        f.client.listen.subscribe('hero', (_decisions, set) => seen.push(`second:${set.arm ?? 'absence'}`));
        f.client.listen.onDecisions(set => seen.push(`set:${set?.arm ?? 'absence'}`));
        expect(await f.client.listen.hydrate({ page: 'home' })).toBeNull();
        expect(seen).toContain('first:personalized'); expect(seen).not.toContain('second:personalized'); expect(seen).not.toContain('set:personalized');
        expect(f.client.listen.current()).toEqual(reentrant ? defaultPin : null);
        if (reentrant) expect(seen).toContain('second:default');
      }
    });

    it(`${format}: same-grant withdrawal and acknowledged re-enable during the mirror await cannot revive a pre-withdrawal snapshot`, async () => {
      for (const direct of [false, true]) {
        const f = await setup(format), lock = await holdMirror(f);
        const generation = f.client.core.generation, session = f.client.core.profileSessionId;
        const pending = direct ? f.client.core.getJson(f.client.core.config.paths.snapshot) : f.client.listen.hydrate({ page: 'home' });
        await lock.waiting;
        const path = `/realtime/session/${session}/preferences`;
        const withdrawal = f.client.core.postJson(path, { trackingConsent: false, personalizationEnabled: false });
        await vi.advanceTimersByTimeAsync(0); expect(f.client.core.consent).toEqual({ tracking: false, personalization: false });
        const enable = f.client.core.postJson(path, { trackingConsent: true, personalizationEnabled: true });
        await vi.advanceTimersByTimeAsync(0); expect(f.client.core.consent).toEqual({ tracking: true, personalization: true });
        expect(f.client.core.generation).toBe(generation); expect(f.client.core.profileSessionId).toBe(session);
        lock.release(); const result = await pending;
        expect((await withdrawal).ok).toBe(true); expect((await enable).ok).toBe(true);
        expect(result).toBeNull(); expect(f.client.listen.current()).toBeNull();
      }
    });
  }
});
