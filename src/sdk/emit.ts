// src/sdk/emit.ts
// The emit module: the four capture paths, used together. Explicit API for
// commerce (the conversion event is non-negotiable for outcome learning),
// declarative data-attributes for slot-level capture, a dataLayer adapter for
// sites that already have a tag layer, and the automatic path, which lives on
// the listen module because the SDK knows what it delivered.

import { contentInteraction, type Core } from './core';
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
  /**
   * Release every attachment this client laid on the page — its declarative
   * scans and its tag-layer capture — whether or not the page kept the detach
   * functions. What `client.destroy()` runs (src/sdk/teardown.ts).
   */
  release(): void;
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

/**
 * One capturing wrapper per page tag layer, however many clients and
 * attachments capture from it. The page's `push` is wrapped when the first
 * attachment arrives and its own function is handed back only when the last one
 * is released, so releasing one attachment can never remove another's — the
 * defect HANDOFF-2026-09-16 §6 reproduced ("A's teardown restores an older
 * `push`, removing B's still-active wrapper") and F34 §2G recorded. The layer
 * is the page's, not a client's, so this registry is keyed by the array itself;
 * it holds no page, tenant or customer state of its own.
 *
 * A tag manager, a consent tool or any other foreign script may wrap `push`
 * again after the SDK did, and ordinarily calls through to what it found. The
 * SDK then wraps the layer once more, so it still sees the pushes that now
 * arrive through the foreign wrapper; the wrapper it laid before is marked
 * superseded and, because foreign code closed over it and it cannot be taken
 * out of the chain, it only forwards from then on. Exactly one wrapper of the
 * SDK's dispatches, so one push stays one capture for each attachment however
 * many times the layer has been re-wrapped.
 */
interface LayerAttachment { handle: (entry: unknown) => void; refs: number; live: boolean }
interface LayerRegistry {
  original: (...items: unknown[]) => number;
  wrapper: (...items: unknown[]) => number;
  /** The layer's attachments, shared by every wrapper the SDK has laid on it. */
  attached: Map<object, LayerAttachment>;
  /** A superseded wrapper forwards the push and never dispatches it. */
  superseded: boolean;
}
const layerRegistries = new WeakMap<object, LayerRegistry>();

function layerRegistryFor(layer: unknown[]): LayerRegistry {
  const existing = layerRegistries.get(layer);
  if (existing && layer.push === existing.wrapper) return existing;
  // Either nothing has wrapped this layer yet, or something outside the SDK
  // replaced `push` after we did; in both cases the function now on the layer
  // is the one a release has to put back, and the wrapper laid before it must
  // stop dispatching: a foreign wrapper that calls through keeps it live in the
  // chain, and two dispatching wrappers over one layer report every push twice.
  if (existing) existing.superseded = true;
  const original = layer.push as (...items: unknown[]) => number;
  const registry: LayerRegistry = {
    original, superseded: false, attached: existing?.attached ?? new Map<object, LayerAttachment>(),
    wrapper: function (this: unknown[], ...args: unknown[]): number {
      const result = original.apply(layer, args);
      if (registry.superseded) return result;
      for (const entry of args) for (const attachment of [...registry.attached.values()]) attachment.handle(entry);
      return result;
    },
  };
  layer.push = registry.wrapper;
  layerRegistries.set(layer, registry);
  return registry;
}

/**
 * Give up one client's capture of a layer. The page's own `push` comes back, by
 * identity, only when the layer has no attachment left, and only from the
 * wrapper that is actually on the layer — never an older one a foreign script
 * has since wrapped, whose restore would remove that script's work.
 */
function releaseLayerAttachment(layer: unknown[], attached: Map<object, LayerAttachment>, owner: object, held: LayerAttachment): void {
  held.live = false;
  held.refs = 0;
  if (attached.get(owner) !== held) return;
  attached.delete(owner);
  if (attached.size) return;
  const registry = layerRegistries.get(layer);
  if (!registry || registry.attached !== attached) return;
  registry.superseded = true;
  if (layer.push === registry.wrapper) layer.push = registry.original;
  layerRegistries.delete(layer);
}

export function createEmit(core: Core, listen: Listen): Emit {
  const host = core.host;
  const track = async (type: SdkEventType, input: Record<string, unknown> | (() => Record<string, unknown>) = {}): Promise<EngineUpdate | null> => {
    if (!await core.ready() || !core.trackingAllowed) return null;
    const data = typeof input === 'function' ? input() : input;
    // All supported wire aliases share the same painted-receipt gate. Custom
    // events that do not name content interactions retain their ordinary path.
    const content = contentInteraction(type, data);
    if (content) type = content;
    if (type === 'content_impression') return listen.rendered(String(data.slot ?? ''), String(data.contentId ?? ''), undefined,
      typeof data.decisionId === 'string' ? data.decisionId : undefined).then(() => null);
    if (['content_click', 'content_dwell', 'video_complete'].includes(type)) return listen.outcome(type, String(data.contentId ?? ''), String(data.slot ?? ''), data);
    return core.send(type, data);
  };
  const withItem = (type: SdkEventType) => (productId: string, attrs: Record<string, unknown> = {}) => core.send(type, () => ({ productId, ...attrs }));
  const withContent = (type: SdkEventType) => (contentId: string, slot: string, attrs: Record<string, unknown> = {}) => track(type, () => ({ contentId, slot, ...attrs }));

  /**
   * One declarative attachment per document this client scans. Binding the
   * same document again — a route re-render, React StrictMode's double-invoked
   * effect — joins the attachment already live instead of laying a second
   * listener over every element, and the page's nodes come back only when the
   * last hold is released (document 35 §5 W17; F34 §2A). Options are the first
   * attachment's; a page that wants different ones detaches first.
   */
  const scans = new Map<DomLike, { refs: number; detach(): void }>();

  function scan(dom: DomLike, dwellMinMs: number): { refs: number; detach(): void } {
    const holds: Array<() => void> = [];
    const seen = new Set<string>();
    let detached = false, installed = false, binding = 0;
    const stop = () => { binding++; installed = false; seen.clear(); for (const off of holds.splice(0)) off(); };
    const start = () => core.capture(() => {
      if (detached || installed) return;
      installed = true;
      const current = binding;
      const permitted = () => core.trackingAllowed && !detached && current === binding;

      for (const el of dom.querySelectorAll('[data-op-content]')) {
        if (!permitted()) return;
        if (!el.getAttribute('data-op-content')) continue;
        // The receipt is the offer that was served for this node, not a claim
        // the page can revise: it is read once, when the SDK binds (W26.02).
        // What the node SHOWS is read at the moment the shopper acts, so a node
        // re-rendered in place reports the piece it now carries and never the
        // one it carried when it was bound (document 35 §5 W17; F34 §6).
        const decisionId = el.getAttribute('data-op-decision-id');
        const shown = (): Record<string, unknown> | null => {
          const contentId = el.getAttribute('data-op-content') ?? '';
          if (!contentId) return null;
          const contentType = el.getAttribute('data-op-type');
          return { contentId, slot: el.getAttribute('data-op-slot') ?? 'unknown',
            ...(decisionId !== null ? { decisionId } : {}), ...(contentType ? { contentType } : {}) };
        };
        let shownAt: number | null = null;
        const off = core.bindings.addObserver(dom, el, (visible) => {
          const attrs = shown();
          if (!permitted() || !attrs) { shownAt = null; return; }
          if (visible) {
            if (shownAt === null) shownAt = host.now();
            const key = `${String(attrs.slot)}:${String(attrs.contentId)}`;
            if (!seen.has(key)) { seen.add(key); void track('content_impression', attrs); }
            return;
          }
          if (shownAt === null) return;
          const ms = host.now() - shownAt;
          shownAt = null;
          if (ms >= dwellMinMs) void track('content_dwell', { ...attrs, ms });
        });
        if (!permitted()) { off?.(); return; }
        if (off) holds.push(off);
        holds.push(core.bindings.addListener(el, 'click', () => {
          const attrs = permitted() ? shown() : null;
          if (attrs) void track('content_click', attrs);
        }));
      }

      for (const el of dom.querySelectorAll('[data-op-track]')) {
        if (!permitted()) return;
        if (!(String(el.getAttribute('data-op-track') ?? '') in WIRE)) continue;
        const decisionId = el.getAttribute('data-op-decision-id');
        holds.push(core.bindings.addListener(el, 'click', () => {
          if (!permitted()) return;
          // Re-read for the same reason: a button re-rendered in place sells
          // the product it now names, never the one it named when bound.
          const type = el.getAttribute('data-op-track') ?? '';
          if (!(type in WIRE)) return;
          const label = el.getAttribute('data-op-label');
          const productId = el.getAttribute('data-op-product');
          void track(type as SdkEventType, { ...(label ? { label } : {}), ...(productId ? { productId } : {}),
            ...(decisionId !== null ? { decisionId } : {}) });
        }));
      }
    });
    const consentOff = core.onConsentChange(() => { if (core.trackingAllowed) start(); else stop(); });
    const generationOff = core.on('generation', stop);
    start();
    return { refs: 0, detach: () => { detached = true; consentOff(); generationOff(); stop(); } };
  }

  function declarative(opts: DeclarativeOptions = {}): () => void {
    if (core.config.listenOnly) return () => {};
    const dom = opts.dom ?? host.dom;
    if (!dom) return () => {};
    const attachment = scans.get(dom) ?? scan(dom, opts.dwellMinMs ?? 1_000);
    scans.set(dom, attachment);
    attachment.refs++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--attachment.refs > 0) return;
      if (scans.get(dom) === attachment) scans.delete(dom);
      attachment.detach();
    };
  }

  /**
   * Every layer this client captures from, with the attachment it holds there
   * and the release that hands the layer back. The attachment is recorded
   * beside the release so a detach function can tell its own from a later
   * one's: a page that destroys a client and attaches again holds a detach
   * function for an attachment that no longer exists (R60).
   */
  const layerHolds = new Map<unknown[], { held: LayerAttachment; hold: () => void }>();
  function releaseLayer(layer: unknown[]): void {
    const entry = layerHolds.get(layer);
    if (!entry) return;
    layerHolds.delete(layer);
    entry.hold();
  }

  function dataLayer(opts: DataLayerOptions = {}): () => void {
    const layer = opts.layer ?? host.dataLayer;
    if (!layer) return () => {};
    const registry = layerRegistryFor(layer);
    const attached = registry.attached;
    // One capture per client per layer: a client that attaches twice reports
    // the page's push once, and each live client reports it once (F34 §2G).
    let attachment = attached.get(core);
    const fresh = attachment === undefined;
    if (!attachment) {
      const mapping: DataLayerMapping = { ...GA4_MAPPING, ...(opts.mapping ?? {}) };
      const own: LayerAttachment = { refs: 0, live: true, handle: (entry) => core.capture(() => {
        if (!own.live) return;
        if (!entry || typeof entry !== 'object') return;
        const e = entry as Record<string, unknown>;
        const name = typeof e.event === 'string' ? e.event : null;
        if (!name) return;
        const m = mapping[name];
        if (!m) return;
        let mapped: ReturnType<DataLayerMapper> = null;
        try { mapped = m(e); } catch { mapped = null; }
        if (mapped) void track(mapped.type, mapped.data);
      }) };
      attachment = own;
      attached.set(core, own);
    }
    const held = attachment;
    held.refs++;
    // This attachment's own release, so `client.destroy()` gives the page its
    // push back even when the page kept none of the detach functions, and so a
    // detach function that outlived its attachment releases nothing else: it
    // names the attachment it was handed out for, and `releaseLayerAttachment`
    // does nothing when that one has already gone (R60).
    const hold = (): void => releaseLayerAttachment(layer, attached, core, held);
    layerHolds.set(layer, { held, hold });
    if (fresh) {
      const replayLength = opts.replay !== false && core.trackingAllowed ? layer.length : 0;
      if (replayLength) core.capture(() => { if (held.live) for (let i = 0; i < replayLength; i++) held.handle(layer[i]); });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (held.refs > 0) held.refs--;
      if (held.refs > 0) return;
      // The last hold on THIS attachment hands the page its own function back,
      // by identity. A detach function from a discarded attachment changes
      // nothing: it runs its own release, which does nothing once that
      // attachment has gone, and the layer's current hold — a later
      // attachment's — is left exactly where it is.
      if (layerHolds.get(layer)?.held === held) layerHolds.delete(layer);
      hold();
    };
  }

  /** What `client.destroy()` runs: every attachment this client laid, released. */
  function release(): void {
    for (const [dom, attachment] of [...scans]) {
      if (scans.get(dom) === attachment) scans.delete(dom);
      attachment.refs = 0;
      attachment.detach();
    }
    for (const layer of [...layerHolds.keys()]) releaseLayer(layer);
  }

  return {
    track,
    pageView: (data = {}) => core.send('page_view', () => ({ path: host.location?.href ?? '', ...data })),
    productView: withItem('product_view'),
    addToCart: withItem('add_to_cart'),
    wishlistAdd: withItem('wishlist_add'),
    purchase: (input) => core.send('purchase', () => ({ ...input }), { keepalive: true }),
    contentImpression: withContent('content_impression'),
    contentClick: withContent('content_click'),
    contentDwell: (contentId, slot, ms, attrs = {}) => track('content_dwell', () => ({ contentId, slot, ms, ...attrs })),
    videoComplete: withContent('video_complete'),
    custom: (name, data = {}) => track('custom', () => ({ event: name, ...data })),
    declarative,
    dataLayer,
    release,
    rendered: (slot: string, contentId: string, el?: ElementLike, decisionId?: string) => listen.rendered(slot, contentId, el, decisionId),
  };
}
