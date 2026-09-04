import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCore } from './core';
import { createListen } from './listen';
import { testHost } from './testHost';

const snapshot = {
  ok: true, page: 'home', arm: 'personalized', versions: { config: 41, lift: 0, prior: 0, policy: 0 }, config_label: 'reflex-demo-v1+r41',
  decisions: [
    { contentId: 'c2', customerContentId: 'CMS-2', type: 'editorial', slot: 'story', order: 2, score: 0.3, strategy: 'affinity', explain: { drivers: [] } },
    { contentId: 'c1', customerContentId: 'CMS-1', type: 'on-model', slot: 'hero', order: 0, score: 0.7, strategy: 'affinity', explain: { drivers: [] } },
    { contentId: 'c3', customerContentId: 'CMS-3', type: 'editorial', slot: 'story', order: 1, score: 0.4, strategy: 'affinity', explain: { drivers: [] } },
  ],
};

describe('listen', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

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
    expect(calls[0]?.url).toBe(`https://shop.example/v1/coach/decisions/snapshot?page=home&visitorId=${encodeURIComponent(core.visitorId)}&brand=coach&channel=paid%20social`);
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

  it('applies content_decisions frames from the socket', () => {
    const { host, sockets } = testHost();
    const core = createCore({ tenant: 'coach' }, host);
    const listen = createListen(core);
    const hero: unknown[] = []; listen.subscribe('hero', (d) => hero.push(d[0]?.contentId ?? null));
    core.connect(); sockets[0]!.open();
    sockets[0]!.receive({ type: 'content_decisions', page: 'home', decisions: snapshot.decisions });
    expect(hero).toEqual(['c1']);
  });

  it('rendered() sends one impression per slot and piece, and dwell while on screen', async () => {
    const { host, calls } = testHost({ responses: () => snapshot });
    let visible: ((v: boolean) => void) | null = null;
    host.dom = { querySelectorAll: () => [] as unknown as ArrayLike<never> & Iterable<never>, observe: (_el, cb) => { visible = cb; return () => {}; } };
    const core = createCore({ tenant: 'coach' }, host);
    const listen = createListen(core, { dwellMinMs: 1000 });
    await listen.hydrate({ page: 'home' });
    const el = { getAttribute: () => null, addEventListener: () => {} };
    listen.rendered('hero', 'c1', el); listen.rendered('hero', 'c1', el);
    await vi.runAllTimersAsync();
    const posted = () => calls.filter((c) => c.init?.method === 'POST').map((c) => JSON.parse(c.init!.body!));
    expect(posted()).toHaveLength(1);
    expect(posted()[0]).toMatchObject({ type: 'content_impression', data: { contentId: 'c1', slot: 'hero', customerContentId: 'CMS-1', contentType: 'on-model' } });
    const t0 = host.now();
    host.now = () => t0; visible!(true);
    host.now = () => t0 + 2500; visible!(false);
    await vi.runAllTimersAsync();
    expect(posted()[1]).toMatchObject({ type: 'content_dwell', data: { contentId: 'c1', ms: 2500 } });
  });

  it('listen-only mode sends nothing from rendered()', async () => {
    const { host, calls } = testHost({ responses: () => snapshot });
    const core = createCore({ tenant: 'coach', listenOnly: true }, host);
    const listen = createListen(core);
    await listen.hydrate({ page: 'home' });
    listen.rendered('hero', 'c1');
    await vi.runAllTimersAsync();
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
  });
});
