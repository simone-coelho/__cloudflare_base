import { describe, it, expect, vi } from 'vitest';
import { createCore } from './core';
import { createListen } from './listen';
import { createEmit } from './emit';
import { testHost, preferenceAck, offeredSet } from './testHost';
import type { ElementLike } from './types';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

function setup(opts: Parameters<typeof testHost>[0] = {}, listenOnly = false) {
  const t = testHost({ renderAcks: true, ...opts });
  const core = createCore({ tenant: 'coach', listenOnly }, t.host);
  const listen = createListen(core);
  const emit = createEmit(core, listen);
  const posted = () => t.calls.filter((c) => c.url.endsWith('/action')).map((c) => JSON.parse(c.init!.body!) as { type: string; data: Record<string, unknown> });
  return { ...t, core, listen, emit, posted };
}
const contentSet = (...items: Array<[string, string]>) => offeredSet({ page: 'home', decisions: items.map(([contentId, slot], order) => ({ contentId,
  customerContentId: `CMS-${contentId}`, slot, order, type: 'editorial', strategy: 'affinity' as const, score: 1, explain: { drivers: [] } })) });

describe('emit', () => {
  it('W26.02 carries only explicitly painted receipt IDs in source and both shipped capture paths', async () => {
    const sourceClient = (config: Parameters<typeof createCore>[0], host: Parameters<typeof createCore>[1]) => {
      const core = createCore(config, host), listen = createListen(core);
      return { core, listen, emit: createEmit(core, listen), get visitorId() { return core.visitorId; } };
    };
    const factories: Array<[string, typeof sourceClient]> = [['source', sourceClient]];
    for (const format of ['iife', 'esm']) {
      const code = readFileSync(`public/sdk/edge-personalization${format === 'esm' ? '.esm' : ''}.js`, 'utf8');
      const api = runInNewContext(format === 'esm' ? transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;'
        : code + '\nglobalThis.EdgePersonalization;', { module: { exports: {} }, URL, URLSearchParams, AbortController,
          TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval }) as { createClient: typeof sourceClient };
      factories.push([format, api.createClient]);
    }
    for (const [format, factory] of factories) {
      const f = testHost({ renderAcks: true }), client = factory({ tenant: 'coach' }, f.host); await client.core.ready();
      const id = `coach:${f.host.now().toString(36)}:${client.visitorId}:home:hero:0`, later = id + ':n1:later';
      const d = { contentId: 'c1', customerContentId: 'cms-c1', type: 'editorial', slot: 'hero', order: 0, score: 0,
        strategy: 'default' as const, explain: { drivers: [] }, decisionId: later };
      const posted = () => f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!) as { type: string; data: Record<string, unknown> });
      const visible: Array<(value: boolean) => void> = [], clicks: Array<(event: unknown) => void> = [], off = vi.fn();
      const attrs: Record<string, string> = { 'data-op-content': 'c1', 'data-op-slot': 'hero', 'data-op-decision-id': id };
      const el: ElementLike = { getAttribute: key => attrs[key] ?? null, addEventListener: (_type, fn) => { clicks.push(fn); } };
      f.host.dom = { querySelectorAll: s => s === '[data-op-content]' ? [el] : [], observe: (_el, cb) => { visible.push(cb); return off; } };
      const initial = { page: 'home', pageInstance: 'fixture-page', decisions: [{ ...d, decisionId: id, renderOffer: 'fixture-offer-original' }] };
      client.listen.apply({ ...initial, decisions: [{ ...d, renderOffer: 'fixture-offer-later' }] });
      expect(await client.emit.rendered('hero', 'c1', el, id)).toBeNull(); expect(posted()).toEqual([]);
      client.listen.apply(initial); await client.emit.rendered('hero', 'c1', el, id);
      visible[0]!(true); f.tick(1500); visible[0]!(false);
      await vi.waitFor(() => expect(posted(), format).toHaveLength(2));
      expect(posted().map(p => [p.type, p.data.decisionId])).toEqual([['content_impression', id], ['content_dwell', id]]);
      await client.emit.contentClick('c1', 'hero', { decisionId: id });
      await client.emit.purchase({ orderId: 'o1', value: 1, decisionId: id });
      await client.emit.contentClick('c1', 'hero');
      expect(posted().slice(2).map(p => p.data.decisionId)).toEqual([id, id, id]);
      client.listen.apply({ ...initial, decisions: [{ ...d, renderOffer: 'fixture-offer-later' }] });
      await client.emit.rendered('hero', 'c1'); expect(posted()).toHaveLength(5);
      const detach = client.emit.declarative(); attrs['data-op-decision-id'] = later;
      visible.at(-1)!(true); f.tick(1500); visible.at(-1)!(false); clicks.at(-1)!({});
      await vi.waitFor(() => expect(posted()).toHaveLength(7));
      expect(posted().slice(5).every(p => p.data.decisionId === id)).toBe(true);
      detach(); const count = posted().length; clicks.at(-1)!({}); visible.at(-1)!(true);
      await new Promise(resolve => setTimeout(resolve, 0)); expect(posted()).toHaveLength(count);
      attrs['data-op-decision-id'] = ''; const empty = client.emit.declarative(); clicks.at(-1)!({});
      await client.emit.contentClick('c1', 'hero', { decisionId: null }); await new Promise(resolve => setTimeout(resolve, 0));
      expect(posted()).toHaveLength(count); empty();
      const buttonAttrs: Record<string, string> = { 'data-op-track': 'add_to_cart', 'data-op-product': 'bag-1', 'data-op-decision-id': id };
      const button: ElementLike = { getAttribute: key => buttonAttrs[key] ?? null, addEventListener: (_type, fn) => { clicks.push(fn); } };
      const dom = { querySelectorAll: (selector: string) => selector === '[data-op-track]' ? [button] : [], observe: () => off };
      const stopButton = client.emit.declarative({ dom }); buttonAttrs['data-op-decision-id'] = later; clicks.at(-1)!({});
      await vi.waitFor(() => expect(posted()).toHaveLength(count + 1));
      expect(posted().at(-1)).toMatchObject({ type: 'add_to_cart', data: { productId: 'bag-1', decisionId: id } }); stopButton();
      buttonAttrs['data-op-decision-id'] = ''; const stopEmptyButton = client.emit.declarative({ dom }); clicks.at(-1)!({});
      await vi.waitFor(() => expect(posted()).toHaveLength(count + 2)); expect(posted().at(-1)!.data).toHaveProperty('decisionId', ''); stopEmptyButton();
      const g = client.core.beginTransition(); client.core.finishTransition(g); clicks.at(-1)!({});
      await new Promise(resolve => setTimeout(resolve, 0)); expect(posted()).toHaveLength(count + 2);
    }
  });
  it('the explicit API puts each event on the wire under an accepted type', async () => {
    const { core, listen, emit, posted } = setup(); await core.ready();
    listen.apply(contentSet(['c1', 'hero'], ['c9', 'story'])); await listen.rendered('hero', 'c1'); await listen.rendered('story', 'c9');
    await emit.productView('SKU-1', { line: 'Drover' });
    await emit.addToCart('SKU-1');
    await emit.wishlistAdd('SKU-2');
    await emit.purchase({ orderId: 'o-9', value: 395, items: [{ productId: 'SKU-1' }] });
    await emit.contentClick('c1', 'hero');
    await emit.videoComplete('c9', 'story');
    await emit.custom('newsletter_open', { campaign: 'fall' });
    expect(posted().slice(2).map((p) => [p.type, p.data.event ?? null])).toEqual([
      ['product_view', null], ['add_to_cart', null], ['wishlist_add', null],
      ['purchase', null], ['content_click', null], ['video_complete', null], ['custom', 'newsletter_open'],
    ]);
    expect(posted()[5]!.data).toMatchObject({ orderId: 'o-9', value: 395 });
  });

  it('the dataLayer adapter replays what is there, maps GA4 pushes, ignores the rest, and detaches cleanly', async () => {
    const { core, emit, posted } = setup(); await core.ready();
    const layer: unknown[] = [{ event: 'view_item', ecommerce: { items: [{ item_id: 'SKU-7', item_name: 'Tote', price: 295 }] } }];
    const detach = emit.dataLayer({ layer });
    layer.push({ event: 'add_to_cart', ecommerce: { items: [{ item_id: 'SKU-7' }] } });
    layer.push({ event: 'scroll_depth', value: 50 });
    layer.push({ event: 'purchase', ecommerce: { transaction_id: 'T1', value: 295, currency: 'USD', items: [{ item_id: 'SKU-7', quantity: 1, price: 295 }] } });
    await vi.waitFor(() => expect(posted()).toHaveLength(3));
    expect(posted()[0]).toMatchObject({ type: 'product_view', data: { productId: 'SKU-7', name: 'Tote', price: 295 } });
    expect(posted()[1]).toMatchObject({ type: 'add_to_cart', data: { productId: 'SKU-7' } });
    expect(posted()[2]).toMatchObject({ type: 'purchase', data: { orderId: 'T1', value: 295, items: [{ productId: 'SKU-7', quantity: 1, price: 295 }] } });
    detach();
    layer.push({ event: 'view_item', ecommerce: { items: [{ item_id: 'SKU-8' }] } });
    await new Promise((r) => setTimeout(r, 0));
    expect(posted()).toHaveLength(3);
    expect(layer).toHaveLength(5);   // the layer itself is untouched: every push still lands
  });

  it('declarative capture: impression when on screen, dwell on leaving, click', async () => {
    const { host, core, listen, emit, posted } = setup();
    const listeners = new Map<string, (ev: unknown) => void>();
    let visible: ((v: boolean) => void) | null = null;
    const el: ElementLike = {
      getAttribute: (n) => ({ 'data-op-content': 'c1', 'data-op-slot': 'story', 'data-op-type': 'editorial' } as Record<string, string>)[n] ?? null,
      addEventListener: (t, fn) => { listeners.set(t, fn); },
    };
    const btn: ElementLike = {
      getAttribute: (n) => ({ 'data-op-track': 'add_to_cart', 'data-op-product': 'SKU-3' } as Record<string, string>)[n] ?? null,
      addEventListener: (t, fn) => { listeners.set(`btn:${t}`, fn); },
    };
    host.dom = {
      querySelectorAll: (sel) => (sel === '[data-op-content]' ? [el] : [btn]) as unknown as ArrayLike<ElementLike> & Iterable<ElementLike>,
      observe: (_e, cb) => { visible = cb; return () => {}; },
    };
    const detach = emit.declarative({ dwellMinMs: 1000 });
    await core.ready(); listen.apply(contentSet(['c1', 'story'])); await Promise.resolve();
    const t0 = host.now();
    host.now = () => t0; visible!(true); visible!(true);
    await vi.waitFor(() => expect(posted()).toHaveLength(1));
    host.now = () => t0 + 1800; visible!(false);
    listeners.get('click')!({});
    await vi.waitFor(() => expect(posted()).toHaveLength(3)); listeners.get('btn:click')!({});
    await vi.waitFor(() => expect(posted()).toHaveLength(4));
    expect(posted().map((p) => [p.type, p.data.event ?? null])).toEqual([
      ['content_impression', null], ['content_dwell', null], ['content_click', null], ['add_to_cart', null],
    ]);
    expect(posted()[1]!.data).toMatchObject({ contentId: 'c1', slot: 'story', contentType: 'editorial', ms: 1800 });
    expect(posted()[3]!.data).toEqual({ productId: 'SKU-3' });
    detach();
  });

  it('listen-only keeps declarative capture off but leaves the explicit API and the adapter on', async () => {
    const { host, emit, posted } = setup({}, true);
    host.dom = { querySelectorAll: () => [] as unknown as ArrayLike<never> & Iterable<never>, observe: () => () => {} };
    expect(typeof emit.declarative()).toBe('function');
    const layer: unknown[] = [];
    emit.dataLayer({ layer });
    layer.push({ event: 'view_item', ecommerce: { items: [{ item_id: 'SKU-1' }] } });
    await emit.addToCart('SKU-1');
    await vi.waitFor(() => expect(posted()).toHaveLength(2));
  });

  it('W05.06 drops refused explicit payloads, DOM reads and dataLayer replay/mapping, then captures only new permitted activity', async () => {
    const f = setup(); f.host.cookie.set('opt_tracking_consent', 'false', 10);
    const reads = vi.fn(), mapper = vi.fn(() => ({ type: 'custom' as const, data: {} }));
    const payload = { get private() { reads(); return 'synthetic'; } };
    Object.defineProperty(f.host.location!, 'href', { get() { reads(); return 'https://synthetic.invalid/'; } });
    f.host.dom = { querySelectorAll: () => { reads(); return []; }, observe: () => { reads(); return () => {}; } };
    const layer: unknown[] = [{ get event() { reads(); return 'custom'; } }];
    f.emit.dataLayer({ layer, mapping: { custom: mapper } }); const detach = f.emit.declarative();
    await f.emit.pageView(payload); await f.emit.productView('p', payload); await f.emit.contentClick('c', 's', payload);
    await f.emit.purchase(payload as never); await f.emit.contentDwell('c', 's', 1000, payload); await f.emit.custom('x', payload);
    f.emit.rendered('s', 'c'); layer.push({ get event() { reads(); return 'custom'; } });
    await f.core.ready(); expect(reads).not.toHaveBeenCalled(); expect(mapper).not.toHaveBeenCalled(); expect(f.posted()).toEqual([]);
    detach();
    const fetch = f.host.fetch;
    f.host.fetch = async (url, init) => url.endsWith('/preferences') ? { ok: true, status: 200, json: async () => preferenceAck(f.host, init, { trackingConsent: true }) } : fetch(url, init);
    await f.core.postJson(`/realtime/session/${f.core.profileSessionId}/preferences`, { trackingConsent: true });
    expect(reads).not.toHaveBeenCalled(); expect(mapper).not.toHaveBeenCalled();
    layer.push({ event: 'custom' }); await vi.waitFor(() => expect(f.posted()).toHaveLength(1)); expect(mapper).toHaveBeenCalledTimes(1);
  });

  it('W05.06 resets declarative dwell on withdrawal/identity and leaves detached callbacks inert', async () => {
    const f = setup(); await f.core.ready();
    f.listen.apply(contentSet(['c1', 'hero']));
    const visible: Array<(v: boolean) => void> = [], clicks: Array<(e: unknown) => void> = [], disconnected = vi.fn();
    const el = { getAttribute: (n: string) => n === 'data-op-content' ? 'c1' : n === 'data-op-slot' ? 'hero' : null, addEventListener: (_t: string, fn: (e: unknown) => void) => { clicks.push(fn); } };
    f.host.dom = { querySelectorAll: s => s === '[data-op-content]' ? [el] : [], observe: (_e, cb) => { visible.push(cb); return disconnected; } };
    const detach = f.emit.declarative(); visible[0]!(true); await vi.waitFor(() => expect(f.posted()).toHaveLength(1));
    const path = `/realtime/session/${f.core.profileSessionId}/preferences`, fetch = f.host.fetch;
    f.host.fetch = async (url, init) => url.endsWith('/preferences') ? { ok: true, status: 200, json: async () => preferenceAck(f.host, init, JSON.parse(init!.body!)) } : fetch(url, init);
    await f.core.postJson(path, { trackingConsent: false }); f.tick(5000);
    await f.core.postJson(path, { trackingConsent: true });
    f.listen.apply(contentSet(['c1', 'hero']));
    visible[0]!(false); clicks[0]!({}); visible[1]!(false); expect(f.posted()).toHaveLength(1);
    visible[1]!(true); f.tick(1500); visible[1]!(false);
    await vi.waitFor(() => expect(f.posted()).toHaveLength(3)); expect(f.posted()[2]!.data.ms).toBe(1500);
    const g = f.core.beginTransition(); f.core.finishTransition(g);
    expect(visible).toHaveLength(3); expect(disconnected).toHaveBeenCalledTimes(2);
    detach(); clicks[2]!({}); visible[2]!(true);
    await new Promise(r => setTimeout(r, 0)); expect(f.posted()).toHaveLength(3);
    const off = vi.fn(), clicked = vi.fn();
    el.addEventListener = clicked;
    f.host.dom.observe = (_e, cb) => { f.host.cookie.set('opt_tracking_consent', 'false', 10); cb(true); return off; };
    f.emit.declarative(); expect(off).toHaveBeenCalledTimes(1); expect(clicked).not.toHaveBeenCalled();
  });
  it('W15 gates first-class, custom and data-layer content aliases on the exact durable ACK', async () => {
    const f = setup(); await f.core.ready(); f.listen.apply(contentSet(['c1', 'hero']));
    const aliases = async () => {
      await f.emit.custom('content_click', { contentId: 'c1', slot: 'hero' });
      await f.emit.track('custom', { action: 'content_dwell', contentId: 'c1', slot: 'hero', ms: 321 });
      await f.emit.track('custom', { eventName: 'video_complete', contentId: 'c1', slot: 'hero' });
    };
    await aliases(); expect(f.posted()).toEqual([]);
    await f.core.send('custom', { event: 'content_click', contentId: 'c1', slot: 'hero' });
    await f.core.send('content_click', { contentId: 'c1', slot: 'hero' }); expect(f.posted()).toEqual([]);
    const layer: unknown[] = [], detach = f.emit.dataLayer({ layer, mapping: { legacy: () => ({ type: 'custom', data: { event: 'content_click', contentId: 'c1', slot: 'hero' } }) } });
    layer.push({ event: 'legacy' }); await new Promise(resolve => setTimeout(resolve, 0)); expect(f.posted()).toEqual([]);
    const ack = await f.listen.rendered('hero', 'c1'); expect(ack).not.toBeNull(); await aliases(); layer.push({ event: 'legacy' });
    await vi.waitFor(() => expect(f.posted()).toHaveLength(5));
    expect(f.posted().slice(1).map(p => p.type)).toEqual(['content_click', 'content_dwell', 'video_complete', 'content_click']);
    expect(f.posted().slice(1).every(p => p.data.decisionId === ack!.decisionId && !('renderOffer' in p.data))).toBe(true);
    await f.emit.custom('ordinary_custom', { safe: 1 }); expect(f.posted().at(-1)).toMatchObject({ type: 'custom', data: { event: 'ordinary_custom', safe: 1 } });
    detach();
  });
});
