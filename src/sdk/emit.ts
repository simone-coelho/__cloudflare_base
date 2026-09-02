// src/sdk/emit.ts
// The emit module: the four capture paths, used together. Explicit API for
// commerce (the conversion event is non-negotiable for outcome learning),
// declarative data-attributes for slot-level capture, a dataLayer adapter for
// sites that already have a tag layer, and the automatic path, which lives on
// the listen module because the SDK knows what it delivered.

import type { Core } from './core';
import type { Listen } from './listen';
import type { DomLike, ElementLike, EngineUpdate, SdkEventType } from './types';
import { WIRE } from './wire';

export interface PurchaseInput {
  orderId: string;
  value: number;
  currency?: string;
  items?: Array<{ productId: string; quantity?: number; price?: number; [k: string]: unknown }>;
  [k: string]: unknown;
}

export type DataLayerMapper = (entry: Record<string, unknown>) => { type: SdkEventType; data: Record<string, unknown> } | null;
export type DataLayerMapping = Record<string, DataLayerMapper>;

export interface DeclarativeOptions { dom?: DomLike; dwellMinMs?: number }
export interface DataLayerOptions { layer?: unknown[]; mapping?: DataLayerMapping; replay?: boolean }

export interface Emit {
  track(type: SdkEventType, data?: Record<string, unknown>): Promise<EngineUpdate | null>;
  pageView(data?: Record<string, unknown>): Promise<EngineUpdate | null>;
  productView(productId: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
  addToCart(productId: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
  wishlistAdd(productId: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
  /** The conversion event. Sent with keepalive so a navigation away does not lose it. */
  purchase(input: PurchaseInput): Promise<EngineUpdate | null>;
  contentImpression(contentId: string, slot: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
  contentClick(contentId: string, slot: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
  contentDwell(contentId: string, slot: string, ms: number, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
  videoComplete(contentId: string, slot: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
  custom(name: string, data?: Record<string, unknown>): Promise<EngineUpdate | null>;
  /** Scan `[data-op-content]` and `[data-op-track]` elements. Returns a detach function. */
  declarative(opts?: DeclarativeOptions): () => void;
  /** Wrap a dataLayer's push. Returns a detach function that restores it. */
  dataLayer(opts?: DataLayerOptions): () => void;
  rendered: Listen['rendered'];
}

const first = (v: unknown): Record<string, unknown> => (Array.isArray(v) && v[0] && typeof v[0] === 'object' ? (v[0] as Record<string, unknown>) : {});
const eco = (e: Record<string, unknown>): Record<string, unknown> => (e.ecommerce && typeof e.ecommerce === 'object' ? (e.ecommerce as Record<string, unknown>) : e);

function ga4Item(e: Record<string, unknown>): Record<string, unknown> {
  const it = first(eco(e).items);
  return {
    productId: String(it.item_id ?? it.id ?? ''),
    ...(it.item_name !== undefined ? { name: it.item_name } : {}),
    ...(it.price !== undefined ? { price: it.price } : {}),
    ...(it.item_category !== undefined ? { category: it.item_category } : {}),
    ...(it.item_brand !== undefined ? { brand: it.item_brand } : {}),
    ...(it.item_variant !== undefined ? { variant: it.item_variant } : {}),
  };
}

/** GA4-style events, the shape most tag layers already produce. Override per site. */
export const GA4_MAPPING: DataLayerMapping = {
  page_view: (e) => ({ type: 'page_view', data: { path: e.page_location ?? e.page_path ?? '' } }),
  view_item: (e) => { const d = ga4Item(e); return d.productId ? { type: 'product_view', data: d } : null; },
  add_to_cart: (e) => { const d = ga4Item(e); return d.productId ? { type: 'add_to_cart', data: d } : null; },
  add_to_wishlist: (e) => { const d = ga4Item(e); return d.productId ? { type: 'wishlist_add', data: d } : null; },
  purchase: (e) => {
    const x = eco(e);
    const items = Array.isArray(x.items) ? (x.items as Array<Record<string, unknown>>).map((it) => ({
      productId: String(it.item_id ?? it.id ?? ''), quantity: it.quantity ?? 1, ...(it.price !== undefined ? { price: it.price } : {}),
    })) : [];
    return { type: 'purchase', data: { orderId: String(x.transaction_id ?? ''), value: Number(x.value ?? 0), currency: x.currency ?? 'USD', items } };
  },
};

export function createEmit(core: Core, listen: Listen): Emit {
  const host = core.host;
  const track = (type: SdkEventType, data: Record<string, unknown> = {}) => core.send(type, data);
  const withItem = (type: SdkEventType) => (productId: string, attrs: Record<string, unknown> = {}) => track(type, { productId, ...attrs });
  const withContent = (type: SdkEventType) => (contentId: string, slot: string, attrs: Record<string, unknown> = {}) => track(type, { contentId, slot, ...attrs });

  function declarative(opts: DeclarativeOptions = {}): () => void {
    if (core.config.listenOnly) return () => {};
    const dom = opts.dom ?? host.dom;
    if (!dom) return () => {};
    const dwellMinMs = opts.dwellMinMs ?? 1_000;
    const offs: Array<() => void> = [];
    const seen = new Set<string>();

    for (const el of dom.querySelectorAll('[data-op-content]')) {
      const contentId = el.getAttribute('data-op-content') ?? '';
      const slot = el.getAttribute('data-op-slot') ?? 'unknown';
      if (!contentId) continue;
      const attrs = { contentId, slot, ...(el.getAttribute('data-op-type') ? { contentType: el.getAttribute('data-op-type') } : {}) };
      let shownAt: number | null = null;
      offs.push(dom.observe(el, (visible) => {
        if (visible) {
          if (shownAt === null) shownAt = host.now();
          const key = `${slot}:${contentId}`;
          if (!seen.has(key)) { seen.add(key); void track('content_impression', attrs); }
          return;
        }
        if (shownAt === null) return;
        const ms = host.now() - shownAt;
        shownAt = null;
        if (ms >= dwellMinMs) void track('content_dwell', { ...attrs, ms });
      }));
      el.addEventListener('click', () => { void track('content_click', attrs); });
    }

    for (const el of dom.querySelectorAll('[data-op-track]')) {
      const type = el.getAttribute('data-op-track') ?? '';
      if (!(type in WIRE)) continue;
      const label = el.getAttribute('data-op-label');
      const productId = el.getAttribute('data-op-product');
      el.addEventListener('click', () => {
        void track(type as SdkEventType, { ...(label ? { label } : {}), ...(productId ? { productId } : {}) });
      });
    }
    return () => { for (const off of offs) off(); };
  }

  function dataLayer(opts: DataLayerOptions = {}): () => void {
    const layer = opts.layer ?? host.dataLayer;
    if (!layer) return () => {};
    const mapping: DataLayerMapping = { ...GA4_MAPPING, ...(opts.mapping ?? {}) };
    const handle = (entry: unknown) => {
      if (!entry || typeof entry !== 'object') return;
      const e = entry as Record<string, unknown>;
      const name = typeof e.event === 'string' ? e.event : null;
      if (!name) return;
      const m = mapping[name];
      if (!m) return;
      let mapped: ReturnType<DataLayerMapper> = null;
      try { mapped = m(e); } catch { mapped = null; }
      if (mapped) void track(mapped.type, mapped.data);
    };
    if (opts.replay !== false) for (const entry of [...layer]) handle(entry);
    const original = layer.push;
    layer.push = function (this: unknown[], ...args: unknown[]) {
      const r = original.apply(layer, args);
      for (const a of args) handle(a);
      return r;
    };
    return () => { layer.push = original; };
  }

  return {
    track,
    pageView: (data = {}) => track('page_view', { path: host.location?.href ?? '', ...data }),
    productView: withItem('product_view'),
    addToCart: withItem('add_to_cart'),
    wishlistAdd: withItem('wishlist_add'),
    purchase: (input) => core.send('purchase', { ...input }, { keepalive: true }),
    contentImpression: withContent('content_impression'),
    contentClick: withContent('content_click'),
    contentDwell: (contentId, slot, ms, attrs = {}) => track('content_dwell', { contentId, slot, ms, ...attrs }),
    videoComplete: withContent('video_complete'),
    custom: (name, data = {}) => track('custom', { event: name, ...data }),
    declarative,
    dataLayer,
    rendered: (slot: string, contentId: string, el?: ElementLike) => listen.rendered(slot, contentId, el),
  };
}
