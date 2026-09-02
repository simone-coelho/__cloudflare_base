import { describe, it, expect, vi } from 'vitest';
import { createCore } from './core';
import { createListen } from './listen';
import { createEmit } from './emit';
import { testHost } from './testHost';
import type { ElementLike } from './types';

function setup(opts: Parameters<typeof testHost>[0] = {}, listenOnly = false) {
  const t = testHost(opts);
  const core = createCore({ tenant: 'coach', listenOnly }, t.host);
  const listen = createListen(core);
  const emit = createEmit(core, listen);
  const posted = () => t.calls.filter((c) => c.init?.method === 'POST').map((c) => JSON.parse(c.init!.body!) as { type: string; data: Record<string, unknown> });
  return { ...t, core, listen, emit, posted };
}

describe('emit', () => {
  it('the explicit API puts each event on the wire under an accepted type', async () => {
    const { emit, posted } = setup();
    await emit.productView('SKU-1', { line: 'Drover' });
    await emit.addToCart('SKU-1');
    await emit.wishlistAdd('SKU-2');
    await emit.purchase({ orderId: 'o-9', value: 395, items: [{ productId: 'SKU-1' }] });
    await emit.contentClick('c1', 'hero');
    await emit.videoComplete('c9', 'story');
    await emit.custom('newsletter_open', { campaign: 'fall' });
    expect(posted().map((p) => [p.type, p.data.event ?? null])).toEqual([
      ['product_view', null], ['add_to_cart', null], ['wishlist_add', null],
      ['custom', 'purchase'], ['custom', 'content_click'], ['custom', 'video_complete'], ['custom', 'newsletter_open'],
    ]);
    expect(posted()[3]!.data).toMatchObject({ orderId: 'o-9', value: 395 });
  });

  it('the dataLayer adapter replays what is there, maps GA4 pushes, ignores the rest, and detaches cleanly', async () => {
    const { emit, posted } = setup();
    const layer: unknown[] = [{ event: 'view_item', ecommerce: { items: [{ item_id: 'SKU-7', item_name: 'Tote', price: 295 }] } }];
    const detach = emit.dataLayer({ layer });
    layer.push({ event: 'add_to_cart', ecommerce: { items: [{ item_id: 'SKU-7' }] } });
    layer.push({ event: 'scroll_depth', value: 50 });
    layer.push({ event: 'purchase', ecommerce: { transaction_id: 'T1', value: 295, currency: 'USD', items: [{ item_id: 'SKU-7', quantity: 1, price: 295 }] } });
    await vi.waitFor(() => expect(posted()).toHaveLength(3));
    expect(posted()[0]).toMatchObject({ type: 'product_view', data: { productId: 'SKU-7', name: 'Tote', price: 295 } });
    expect(posted()[1]).toMatchObject({ type: 'add_to_cart', data: { productId: 'SKU-7' } });
    expect(posted()[2]).toMatchObject({ type: 'custom', data: { event: 'purchase', orderId: 'T1', value: 295, items: [{ productId: 'SKU-7', quantity: 1, price: 295 }] } });
    detach();
    layer.push({ event: 'view_item', ecommerce: { items: [{ item_id: 'SKU-8' }] } });
    await new Promise((r) => setTimeout(r, 0));
    expect(posted()).toHaveLength(3);
    expect(layer).toHaveLength(5);   // the layer itself is untouched: every push still lands
  });

  it('declarative capture: impression when on screen, dwell on leaving, click', async () => {
    const { host, emit, posted } = setup();
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
    const t0 = host.now();
    host.now = () => t0; visible!(true); visible!(true);
    host.now = () => t0 + 1800; visible!(false);
    listeners.get('click')!({});
    listeners.get('btn:click')!({});
    await vi.waitFor(() => expect(posted()).toHaveLength(4));
    expect(posted().map((p) => [p.type, p.data.event ?? null])).toEqual([
      ['custom', 'content_impression'], ['custom', 'content_dwell'], ['custom', 'content_click'], ['add_to_cart', null],
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
});
