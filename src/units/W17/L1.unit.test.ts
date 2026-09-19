// @vitest-environment jsdom
// src/units/W17/L1.unit.test.ts
// W17 — real SDK lifecycle ownership and unbind for declarative click and
// commerce listeners, dataLayer wrappers and rendered observers (batch W17-B1).
//
// One `describe('unit:W17.L1.0N')` per unit, one `it` per ruled leg (`sdk`).
// Every expected value comes from the witnesses, never from what the SDK does
// today:
//   · document 35 §5 row W17 — "Real lifecycle ownership/unbind for declarative
//     click/commerce, dataLayer wrappers and rendered observers. Test
//     detach/remount, changed DOM attributes, new clients, either teardown
//     order, identity/tenant switches, pending callbacks and zero events after
//     full detach in a real DOM/browser. Do not close on the proposed bind-once
//     WeakMap guard."
//   · document 35 §2 F12/F34 and `docs/architecture/35-verification-reports/F34.md`
//     §2A/§2B/§2D/§2G/§3/§6 — duplicate click and commerce capture after a
//     correct attach/detach/remount, duplicated impressions and leaked
//     observers on re-scan, `rendered()`'s observer with no release, and the
//     dataLayer restore that clobbers a live wrapper and leaves the page's
//     array instrumented by a discarded client. §6 records that the module-
//     global bind-once WeakMap guard is the emergency fix and NOT the end
//     state, because "a DOM node whose data-op-content changes in place keeps
//     its first click listener and will keep reporting the old content id. Only
//     a real removeEventListener fixes that."
//   · docs/handover/HANDOFF-2026-09-18.md §6 row W17 — keep the existing
//     inactive-callback guards and observer teardown; finish real listener and
//     wrapper ownership, changed-attribute rebinding, either teardown order,
//     detach/remount/new clients, tenant/identity changes and zero events after
//     detach.
//   · docs/handover/HANDOFF-2026-09-16.md §6 — the actual-module dataLayer
//     teardown reproduction: two attachments on one page layer, "after
//     detaching A and pushing again {A:1,B:1}; B should be 2. A's teardown
//     restores an older `push`, removing B's still-active wrapper."
//   · the documented integrator contract: `emit.declarative()` "Scan
//     [data-op-content] and [data-op-track] elements. Returns a detach
//     function" and `emit.dataLayer()` "Wrap a dataLayer's push. Returns a
//     detach function that restores it" (src/sdk/emit.ts:40-43), plus
//     docs/kit/01-integration-guide.md §4-§5 and src/sdk/README.md.
//   · the customer fixture: Coach's Tabby lifestyle hero, a craft story and an
//     add-to-bag call to action (docs/architecture/tapestry_requirements.txt
//     lines 113-122, 529-532, 567 — hero/editorial slots, GA4 tag layer).
//
// HOW THIS RUNS THE REAL PATH. The file runs under jsdom (the repository
// default is node) with real elements, real attributes, a real page dataLayer
// array and a real IntersectionObserver, and drives the real SDK entry — the
// same composition `createClient` performs in `src/sdk/index.ts:31-45`
// (createCore + createListen + createEmit + createIdentity) — against the
// repository's memory host (`src/sdk/testHost.ts`), whose `fetch` IS the
// transport boundary. The DOM port is the shape `browserHost()` builds
// (`src/sdk/host.ts:12-24`): `querySelectorAll` over the real document and
// `observe` over a real `window.IntersectionObserver` whose detacher is
// `io.disconnect()`. `src/sdk/host.ts` and `src/sdk/index.ts` are excluded from
// the app tsconfig, so the port is rebuilt here line for line rather than
// imported; everything under test (emit.ts, listen.ts, core.ts, identify.ts) is
// the product's own code.
//
// WHAT IS ASSERTED. Primary observable: the transport boundary — what would be
// sent (every `fetch` the SDK makes, with the parsed `/realtime/action`
// envelopes and their `X-Tenant` header). Secondary observable, required by the
// ruling that a guard which merely ignores a second bind does not satisfy
// ownership: the PAGE's own state — how many click listeners are registered on
// the element, how many live observers watch it, and whether `dataLayer.push`
// is the page's own function again. No internal SDK flag is read.

import { describe, it, expect, vi } from 'vitest';

import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createIdentity } from '@/sdk/identify';
import { createListen } from '@/sdk/listen';
import { offeredSet, syntheticSession, testHost } from '@/sdk/testHost';
import type { DomLike, ElementLike, RequestInitLike, ResponseLike } from '@/sdk/types';

// ---------------------------------------------------------------------------
// The page. Real jsdom elements; the DOM typings are declared locally because
// the app tsconfig's lib is ES2022 (no DOM lib).
// ---------------------------------------------------------------------------

interface PageElement extends ElementLike {
  setAttribute(name: string, value: string): void;
  removeEventListener(type: string, listener: (ev: unknown) => void): void;
  click(): void;
}
interface PageDocument {
  body: { innerHTML: string };
  querySelectorAll(selector: string): ArrayLike<PageElement> & Iterable<PageElement>;
}
const doc = (): PageDocument => (globalThis as unknown as { document: PageDocument }).document;

/** A real browser-API IntersectionObserver: a disconnected observer never calls back again. */
type IOEntry = { target: unknown; intersectionRatio: number; isIntersecting: boolean };
class PageIntersectionObserver {
  static readonly live = new Set<PageIntersectionObserver>();
  private readonly targets = new Set<unknown>();
  constructor(private readonly cb: (entries: IOEntry[]) => void) { PageIntersectionObserver.live.add(this); }
  observe(el: unknown): void { this.targets.add(el); }
  unobserve(el: unknown): void { this.targets.delete(el); }
  disconnect(): void { this.targets.clear(); PageIntersectionObserver.live.delete(this); }
  takeRecords(): IOEntry[] { return []; }
  /** How many live observers watch this element: the page's own observation count. */
  static watching(el: unknown): number { return [...PageIntersectionObserver.live].filter((o) => o.targets.has(el)).length; }
  /** The browser delivering a visibility change to every observer that is still connected. */
  static deliver(el: unknown, visible: boolean): void {
    for (const o of [...PageIntersectionObserver.live]) {
      if (o.targets.has(el)) o.cb([{ target: el, intersectionRatio: visible ? 1 : 0, isIntersecting: visible }]);
    }
  }
}
const intersect = (el: PageElement, visible: boolean): void => PageIntersectionObserver.deliver(el, visible);
const liveObservers = (el: PageElement): number => PageIntersectionObserver.watching(el);

/** The DOM port `browserHost()` builds in production (src/sdk/host.ts:12-24), verbatim. */
function pageDom(): DomLike {
  const win = globalThis as unknown as {
    IntersectionObserver?: new (cb: (entries: IOEntry[]) => void, opts?: unknown) => { observe(el: unknown): void; disconnect(): void };
  };
  return {
    querySelectorAll: (sel) => Array.from(doc().querySelectorAll(sel)) as unknown as ArrayLike<ElementLike> & Iterable<ElementLike>,
    observe: (el, cb) => {
      if (typeof win.IntersectionObserver !== 'function') { cb(true); return () => {}; }
      const io = new win.IntersectionObserver((entries) => { for (const e of entries) cb(e.intersectionRatio >= 0.5); }, { threshold: [0, 0.5] });
      io.observe(el);
      return () => io.disconnect();
    },
  };
}

/**
 * The page counts the click listeners registered on its own element. Every
 * registration and removal still goes through the real EventTarget, so a click
 * dispatches for real; only the tally is added.
 */
const registries = new Map<unknown, Map<string, Set<unknown>>>();
function counted(el: PageElement): PageElement {
  const registry = new Map<string, Set<unknown>>();
  registries.set(el, registry);
  const add = (el.addEventListener as (...a: unknown[]) => void).bind(el);
  const remove = (el.removeEventListener as (...a: unknown[]) => void).bind(el);
  Object.defineProperty(el, 'addEventListener', { configurable: true, value: (type: string, fn: unknown, ...rest: unknown[]) => {
    const set = registry.get(type) ?? new Set<unknown>(); set.add(fn); registry.set(type, set); add(type, fn, ...rest);
  } });
  Object.defineProperty(el, 'removeEventListener', { configurable: true, value: (type: string, fn: unknown, ...rest: unknown[]) => {
    registry.get(type)?.delete(fn); remove(type, fn, ...rest);
  } });
  return el;
}
const liveClickListeners = (el: PageElement): number => registries.get(el)?.get('click')?.size ?? 0;

// ---------------------------------------------------------------------------
// The customer fixture. Coach's storefront: the Tabby lifestyle hero and the
// craft story are pieces the engine chose; the teaser is a piece the page
// carries that the engine did not choose (an unknown, cross-checked in unit
// .04); the button is the add-to-bag call to action.
// ---------------------------------------------------------------------------

const HTML = `
  <section id="hero" data-op-slot="hero" data-op-content="cnt_tabby_lifestyle" data-op-type="editorial">Tabby, in her own light</section>
  <section id="story" data-op-slot="story" data-op-content="cnt_craft_story" data-op-type="editorial">Made in our Tuscan tannery</section>
  <section id="teaser" data-op-slot="feature" data-op-content="cnt_unpublished_teaser" data-op-type="editorial">Coming soon</section>
  <button id="cta" data-op-track="add_to_cart" data-op-product="COACH-TABBY-26" data-op-label="hero-cta">Add to bag</button>
`;

/** The two pieces the engine actually chose, with their served receipts. */
const coachSet = () => offeredSet({ page: 'home', decisions: [
  { contentId: 'cnt_tabby_lifestyle', customerContentId: 'CMS-tabby-lifestyle', slot: 'hero', order: 0, type: 'editorial',
    strategy: 'affinity' as const, score: 0.82, explain: { drivers: [{ dim: 'aesthetic', value: 'contemporary', a: 0.7, weight: 1 }] } },
  { contentId: 'cnt_craft_story', customerContentId: 'CMS-craft-story', slot: 'story', order: 0, type: 'editorial',
    strategy: 'affinity' as const, score: 0.64, explain: { drivers: [{ dim: 'aesthetic', value: 'classic', a: 0.5, weight: 1 }] } },
] });
/** `offeredSet` mints `${revision}-${slot}-${order}-${contentId}` (src/sdk/testHost.ts:22-25). */
const HERO_RECEIPT = 'original-hero-0-cnt_tabby_lifestyle';
const STORY_RECEIPT = 'original-story-0-cnt_craft_story';

/** The shopper the platform names for each tenant, and the person a sign-in carries (CW25). */
const SUBJECT: Record<string, string> = {
  coach: 'vis-00000000-0000-4000-8000-00000000c0ac',
  'coach-eu': 'vis-00000000-0000-4000-8000-0000000000eu',
};
const SHOPPER = 'shp-coach-1043988';

/** A GA4 purchase already in the page's tag layer before the SDK ever attaches. */
const HISTORIC_PURCHASE = { event: 'purchase', ecommerce: { transaction_id: 'T-9001', value: 495, currency: 'USD',
  items: [{ item_id: 'COACH-TABBY-26', item_name: 'Tabby Shoulder Bag 26', price: 495, quantity: 1 }] } };
const ga4 = (event: string, itemId: string) => ({ event, ecommerce: { items: [{ item_id: itemId }] } });

interface Posted { type: string; source: string; userId: string; tenant: string | undefined; data: Record<string, unknown> }

function page() {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = PageIntersectionObserver;
  PageIntersectionObserver.live.clear();
  registries.clear();
  doc().body.innerHTML = HTML;
  const pick = (id: string): PageElement => counted([...doc().querySelectorAll(`#${id}`)][0]!);
  const hero = pick('hero'), story = pick('story'), teaser = pick('teaser'), cta = pick('cta');
  const layer: unknown[] = [];
  const f = testHost({ renderAcks: true });
  f.host.dom = pageDom();
  f.host.dataLayer = layer;

  // Every fetch the SDK makes, in order: the transport boundary.
  const traffic: Array<{ url: string; init?: RequestInitLike }> = [];
  const base = f.host.fetch;
  // A sign-in is linked within the tenant it happened in; another brand's
  // tenant keeps naming its own shopper.
  const linked = new Set<string>();
  f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
    traffic.push({ url, init });
    const tenant = init?.headers?.['X-Tenant'] ?? 'coach';
    if (url.endsWith('/identity/session')) {
      const session = syntheticSession(f.host.now(), linked.has(tenant) ? SHOPPER : SUBJECT[tenant], tenant);
      return { ok: true, status: 200, json: async () => ({ ok: true, session }) };
    }
    if (url.endsWith('/identity/link')) {
      // The platform answers a sign-in with the person's own shopper id (CW25;
      // docs/kit/01-integration-guide.md §5).
      linked.add(tenant);
      const session = syntheticSession(f.host.now(), SHOPPER, tenant);
      return { ok: true, status: 200, json: async () => ({ ok: true, carry: SHOPPER, outcome: 'linked', session }) };
    }
    return base(url, init);
  };

  const sent = (): Posted[] => traffic.filter((c) => c.url.endsWith('/action')).map((c) => {
    const envelope = JSON.parse(c.init!.body!) as { type: string; source: string; userId: string; data: Record<string, unknown> };
    return { type: envelope.type, source: envelope.source, userId: envelope.userId, data: envelope.data, tenant: c.init!.headers!['X-Tenant'] };
  });
  const urls = (): string[] => traffic.map((c) => c.url);
  const client = (source: string, tenant = 'coach', refreshMs?: number) => {
    const core = createCore({ tenant, source }, f.host);
    const listen = createListen(core, refreshMs === undefined ? {} : { refreshMs });
    const emit = createEmit(core, listen);
    // `client.destroy()` as `src/sdk/index.ts:42` defines it.
    return { core, listen, emit, identity: createIdentity(core), destroy: () => { listen.destroy(); core.disconnect(); } };
  };
  return { f, hero, story, teaser, cta, layer, sent, urls, client };
}

/** A settled tick: every microtask and the SDK's own zero-delay work has run. */
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5)); };

// ===========================================================================

describe('unit:W17.L1.01', () => {
  it('sdk: declarative click and commerce listeners are owned — a second bind leaves exactly one live listener, detach removes it, and a click after detach emits nothing', async () => {
    const p = page();
    const c = p.client('coach-web');
    expect(await c.core.ready()).toBe(true);
    c.listen.apply(coachSet());

    // The correct integration of F34 §2A: the page mounts, and mounts again
    // (a route re-render, or React 18 StrictMode's double-invoked effect).
    const firstBind = c.emit.declarative();
    const secondBind = c.emit.declarative();

    intersect(p.hero, true);
    await vi.waitFor(() => expect(p.sent().filter((e) => e.type === 'content_impression')).toHaveLength(1));

    // Ownership: the element carries the SDK's listener once, however many
    // times the page bound it (document 35 §5 W17; F34 §2A/§3).
    expect(liveClickListeners(p.hero), 'live click registrations on the content element after two binds').toBe(1);
    expect(liveClickListeners(p.cta), 'live click registrations on the commerce element after two binds').toBe(1);
    expect(liveObservers(p.hero), 'live observers watching the content element after two binds').toBe(1);

    // One human click on each element is one event of each kind on the wire.
    const mark = p.sent().length;
    p.hero.click();
    p.cta.click();
    await settle();
    const after = p.sent().slice(mark);
    expect(after.map((e) => e.type).sort(), 'one click on the content element and one on the commerce element').toEqual(['add_to_cart', 'content_click']);
    expect(after.find((e) => e.type === 'content_click')!.data, 'the content click carries the served receipt').toEqual({
      contentId: 'cnt_tabby_lifestyle', slot: 'hero', contentType: 'editorial', decisionId: HERO_RECEIPT,
    });
    expect(after.find((e) => e.type === 'add_to_cart')!.data, 'the commerce click carries what the button names').toEqual({
      label: 'hero-cta', productId: 'COACH-TABBY-26',
    });

    // Detach: the page gets its elements back, with nothing of the SDK on them.
    firstBind();
    secondBind();
    expect(liveClickListeners(p.hero), 'click registrations left on the content element after detach').toBe(0);
    expect(liveClickListeners(p.cta), 'click registrations left on the commerce element after detach').toBe(0);
    expect(liveObservers(p.hero), 'observers left watching the content element after detach').toBe(0);

    const quiet = p.urls().length;
    p.hero.click();
    p.cta.click();
    await settle();
    expect(p.urls().slice(quiet), 'transport calls a click makes after detach').toEqual([]);
  });
});

describe('unit:W17.L1.02', () => {
  it("sdk: the page's dataLayer push is wrapped once, keeps capturing while any attachment is live, and the page's own push identity comes back when the last is released", async () => {
    const p = page();
    const c = p.client('coach-web');
    expect(await c.core.ready()).toBe(true);
    const pagePush = p.layer.push;
    p.layer.push(HISTORIC_PURCHASE);

    // F34 §2G line 1: attaching twice must not double-capture and must not
    // replay the layer's history a second time.
    const first = c.emit.dataLayer();
    const second = c.emit.dataLayer();
    await settle();
    expect(p.sent().filter((e) => e.type === 'purchase'), "the layer's existing purchase is replayed once").toHaveLength(1);
    expect(p.sent()[0]!.data, 'the replayed purchase is the order the tag layer recorded').toMatchObject({
      orderId: 'T-9001', value: 495, currency: 'USD', items: [{ productId: 'COACH-TABBY-26', quantity: 1, price: 495 }],
    });

    let mark = p.sent().length;
    p.layer.push(ga4('add_to_cart', 'COACH-TABBY-26'));
    await settle();
    expect(p.sent().slice(mark).map((e) => e.type), 'one push with both attachments live is one event').toEqual(['add_to_cart']);

    // HANDOFF-2026-09-16 §6: releasing the first attachment must not remove the
    // second's capture ("B should be 2").
    first();
    mark = p.sent().length;
    p.layer.push(ga4('add_to_cart', 'COACH-ROGUE-25'));
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.data.productId]),
      'the live attachment still captures after the first one is released').toEqual([['add_to_cart', 'COACH-ROGUE-25']]);

    // The last release restores the page's own push, by identity (F34 §2G line 2).
    second();
    expect(p.layer.push, "the page's own push function after the last attachment is released").toBe(pagePush);
    const quiet = p.urls().length;
    p.layer.push(ga4('view_item', 'COACH-ROGUE-25'));
    await settle();
    expect(p.urls().slice(quiet), 'transport calls a push makes after detach').toEqual([]);
    // Every push, before and after, reached the page's own array.
    expect(p.layer.map((e) => (e as { event: string }).event), "the page's array keeps every entry it was pushed")
      .toEqual(['purchase', 'add_to_cart', 'add_to_cart', 'view_item']);
  });
});

describe('unit:W17.L1.03', () => {
  it('sdk: one rendered element is observed once, its observers are gone after detach, and a remount observes it once again', async () => {
    const p = page();
    const a = p.client('coach-web-route-a');
    expect(await a.core.ready()).toBe(true);
    a.listen.apply(coachSet());

    // Both documented capture paths for the same painted element: the
    // declarative scan and the renderer callback
    // (docs/kit/01-integration-guide.md §4; src/sdk/README.md).
    const bind = a.emit.declarative();
    expect(await a.emit.rendered('hero', 'cnt_tabby_lifestyle', p.hero), 'the painted hero is admitted').toMatchObject({ version: 1, status: 'durable', decisionId: HERO_RECEIPT });
    expect(liveObservers(p.hero), 'live observers watching the rendered element').toBe(1);

    // One on-screen cycle is one dwell (F34 §2A/§2B/§2D: duplicated observation
    // duplicates capture and biases learning).
    let mark = p.sent().length;
    intersect(p.hero, true);
    p.f.tick(3_000);
    intersect(p.hero, false);
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.data.contentId, e.data.slot, e.data.decisionId, e.data.ms]),
      'one on-screen cycle over one element is one dwell').toEqual([['content_dwell', 'cnt_tabby_lifestyle', 'hero', HERO_RECEIPT, 3_000]]);

    // Detach: no observer is left watching, and the browser delivering a later
    // visibility change reaches nothing.
    bind();
    a.destroy();
    expect(liveObservers(p.hero), 'observers left watching after detach').toBe(0);
    const quiet = p.urls().length;
    intersect(p.hero, true);
    p.f.tick(3_000);
    intersect(p.hero, false);
    await settle();
    expect(p.urls().slice(quiet), 'transport calls an intersection makes after detach').toEqual([]);

    // Remount: fresh observers, no duplicates.
    const b = p.client('coach-web-route-b');
    expect(await b.core.ready()).toBe(true);
    b.listen.apply(coachSet());
    const rebind = b.emit.declarative();
    expect(await b.emit.rendered('hero', 'cnt_tabby_lifestyle', p.hero), 'the remounted hero is admitted').toMatchObject({ version: 1, status: 'durable', decisionId: HERO_RECEIPT });
    expect(liveObservers(p.hero), 'live observers watching the rendered element after remount').toBe(1);

    mark = p.sent().length;
    intersect(p.hero, true);
    p.f.tick(3_000);
    intersect(p.hero, false);
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.source, e.data.ms]),
      'one on-screen cycle after remount is one dwell, from the mounted client').toEqual([['content_dwell', 'coach-web-route-b', 3_000]]);
    rebind();
    b.destroy();
  });
});

describe('unit:W17.L1.04', () => {
  it('sdk: when a bound element’s slot or piece attributes change, the next interaction emits the new identity and never the stale one', async () => {
    const p = page();
    const c = p.client('coach-web');
    expect(await c.core.ready()).toBe(true);
    c.listen.apply(coachSet());
    const bind = c.emit.declarative();

    // Both chosen pieces are painted and acknowledged.
    intersect(p.hero, true);
    intersect(p.story, true);
    await vi.waitFor(() => expect(p.sent().filter((e) => e.type === 'content_impression')).toHaveLength(2));

    // The route re-renders in place: the hero node now carries the craft story,
    // and the button now sells the Rogue. The nodes themselves are the same.
    p.hero.setAttribute('data-op-slot', 'story');
    p.hero.setAttribute('data-op-content', 'cnt_craft_story');
    p.cta.setAttribute('data-op-product', 'COACH-ROGUE-25');
    p.cta.setAttribute('data-op-label', 'pdp-cta');

    const mark = p.sent().length;
    p.hero.click();
    p.cta.click();
    await settle();
    const after = p.sent().slice(mark);
    expect(after.filter((e) => e.type === 'content_click').map((e) => e.data),
      'the content click after the attributes changed carries the piece the node now shows').toEqual([
      { contentId: 'cnt_craft_story', slot: 'story', contentType: 'editorial', decisionId: STORY_RECEIPT },
    ]);
    expect(after.filter((e) => e.type === 'add_to_cart').map((e) => e.data),
      'the commerce click after the attributes changed carries the product the button now sells').toEqual([
      { label: 'pdp-cta', productId: 'COACH-ROGUE-25' },
    ]);

    // An element naming a piece the engine never chose stays unreportable: a
    // declarative attribute alone cannot mint an offer (src/sdk/README.md:66).
    // The control for that absence: this element is bound and observed exactly
    // like the two that do report.
    expect(liveClickListeners(p.teaser), 'the unchosen element is bound like the others').toBe(1);
    expect(liveObservers(p.teaser), 'the unchosen element is observed like the others').toBe(1);
    const quiet = p.sent().length;
    intersect(p.teaser, true);
    p.teaser.click();
    await settle();
    expect(p.sent().slice(quiet).map((e) => e.type), 'an unchosen piece produces no content event').toEqual([]);
    bind();
  });
});

describe('unit:W17.L1.05', () => {
  it('sdk: either teardown order leaves no live listener, wrapper or observer, and no pending callback emits afterwards', async () => {
    for (const order of ['core-before-listeners', 'listeners-before-core'] as const) {
      const p = page();
      const c = p.client('coach-web');
      expect(await c.core.ready()).toBe(true);
      c.listen.apply(coachSet());
      const pagePush = p.layer.push;
      const bind = c.emit.declarative();
      const wrap = c.emit.dataLayer();
      expect(await c.emit.rendered('hero', 'cnt_tabby_lifestyle', p.hero), 'the painted hero is admitted').toMatchObject({ version: 1, status: 'durable', decisionId: HERO_RECEIPT });

      // A callback is pending when the page tears down: the hero is on screen,
      // so a dwell is being measured and has not been reported yet.
      intersect(p.hero, true);
      await settle();

      // The live control for the silence asserted below: while the page is
      // mounted the same three inputs do reach the transport.
      const live = p.sent().length;
      p.cta.click();
      p.layer.push(ga4('add_to_cart', 'COACH-TABBY-26'));
      await settle();
      expect(p.sent().slice(live).map((e) => e.type).sort(), `the mounted page reports its own click and push (${order})`)
        .toEqual(['add_to_cart', 'add_to_cart']);

      if (order === 'core-before-listeners') { c.destroy(); bind(); wrap(); } else { bind(); wrap(); c.destroy(); }

      expect(liveClickListeners(p.hero), `click registrations on the content element after teardown (${order})`).toBe(0);
      expect(liveClickListeners(p.cta), `click registrations on the commerce element after teardown (${order})`).toBe(0);
      expect(liveObservers(p.hero), `observers watching the content element after teardown (${order})`).toBe(0);
      expect(p.layer.push, `the page's own push function after teardown (${order})`).toBe(pagePush);

      const quiet = p.urls().length;
      p.hero.click();
      p.cta.click();
      p.layer.push(ga4('add_to_cart', 'COACH-TABBY-26'));
      p.f.tick(3_000);
      intersect(p.hero, false); // the pending dwell would land here
      await settle();
      expect(p.urls().slice(quiet), `transport calls after teardown (${order})`).toEqual([]);
    }
  });
});

describe('unit:W17.L1.06', () => {
  it('sdk: after detach a new client owns exactly one set of listeners and wrappers, the discarded client never emits, and every event is the new client’s', async () => {
    const p = page();
    const pagePush = p.layer.push;
    const a = p.client('coach-web-route-a');
    expect(await a.core.ready()).toBe(true);
    a.listen.apply(coachSet());
    const bindA = a.emit.declarative();
    const wrapA = a.emit.dataLayer();
    expect(await a.emit.rendered('hero', 'cnt_tabby_lifestyle', p.hero), 'the painted hero is admitted').toMatchObject({ version: 1, status: 'durable', decisionId: HERO_RECEIPT });
    intersect(p.hero, true); // a dwell is pending on the client the page is about to discard
    p.cta.click();
    await vi.waitFor(() => expect(p.sent().filter((e) => e.type === 'add_to_cart')).toHaveLength(1));

    // The route unmounts and the page builds a fresh client, as an SPA does.
    bindA();
    wrapA();
    a.destroy();
    const b = p.client('coach-web-route-b');
    expect(await b.core.ready()).toBe(true);
    b.listen.apply(coachSet());
    const bindB = b.emit.declarative();
    const wrapB = b.emit.dataLayer();

    expect(liveClickListeners(p.cta), 'live click registrations on the commerce element after the remount').toBe(1);
    expect(liveClickListeners(p.hero), 'live click registrations on the content element after the remount').toBe(1);

    const mark = p.sent().length;
    p.cta.click();
    p.layer.push(ga4('view_item', 'COACH-ROGUE-25'));
    p.f.tick(3_000);
    intersect(p.hero, false); // the discarded client's pending dwell must not land
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.source]).sort(),
      'one click and one push are one event each, both the new client’s').toEqual([
      ['add_to_cart', 'coach-web-route-b'], ['product_view', 'coach-web-route-b'],
    ]);

    bindB();
    wrapB();
    b.destroy();
    expect(liveClickListeners(p.cta), 'click registrations left on the commerce element after the new client detaches').toBe(0);
    expect(liveClickListeners(p.hero), 'click registrations left on the content element after the new client detaches').toBe(0);
    expect(p.layer.push, "the page's own push function after the new client detaches").toBe(pagePush);
  });
});

describe('unit:W17.L1.07', () => {
  it('sdk: a sign-in and a tenant switch rebind ownership — later events carry the new identity and tenant, from one set of listeners, and none carries the old', async () => {
    const p = page();
    const c = p.client('coach-web');
    expect(await c.core.ready()).toBe(true);
    const bind = c.emit.declarative();
    const wrap = c.emit.dataLayer();
    p.cta.click();
    await vi.waitFor(() => expect(p.sent()).toHaveLength(1));
    expect(p.sent()[0]!.userId, 'before the sign-in the browser is the anonymous shopper').toBe(SUBJECT.coach);

    // The site signs the person in (CW25; docs/kit/01-integration-guide.md §5).
    const result = await c.identity.identify('ACCT-1043988', {
      source: 'login', exp: Math.floor(p.f.host.now() / 1_000) + 600, assertion: 'fixture-backend-assertion',
    });
    expect(result, 'the platform carries the person’s shopper id').toMatchObject({ ok: true, shopperId: SHOPPER, visitorId: SHOPPER });

    let mark = p.sent().length;
    p.cta.click();
    p.layer.push(ga4('view_item', 'COACH-TABBY-26'));
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.userId]).sort(),
      'after the sign-in one click and one push are one event each, the person’s').toEqual([
      ['add_to_cart', SHOPPER], ['product_view', SHOPPER],
    ]);
    expect(liveClickListeners(p.cta), 'live click registrations on the commerce element after the identity change').toBe(1);
    expect(liveClickListeners(p.hero), 'live click registrations on the content element after the identity change').toBe(1);

    // The page moves to the European brand: the old client is torn down and a
    // client for the other tenant takes the same elements.
    bind();
    wrap();
    c.destroy();
    const eu = p.client('coach-web-eu', 'coach-eu');
    expect(await eu.core.ready()).toBe(true);
    const euBind = eu.emit.declarative();
    // The entries already in the layer were reported under the previous brand,
    // so the remount takes the documented no-replay attachment.
    const euWrap = eu.emit.dataLayer({ replay: false });
    expect(liveClickListeners(p.cta), 'live click registrations on the commerce element after the tenant switch').toBe(1);

    mark = p.sent().length;
    p.cta.click();
    p.layer.push(ga4('view_item', 'COACH-TABBY-26'));
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.tenant, e.userId]).sort(),
      'after the tenant switch every event is the new tenant’s shopper').toEqual([
      ['add_to_cart', 'coach-eu', SUBJECT['coach-eu']], ['product_view', 'coach-eu', SUBJECT['coach-eu']],
    ]);
    euBind();
    euWrap();
    eu.destroy();
  });
});

describe('unit:W17.L1.08', () => {
  it('sdk: after a full detach, clicks, commerce, dataLayer pushes, intersections and pending timers produce zero transport calls, and the page is left clean', async () => {
    const p = page();
    const pagePush = p.layer.push;
    // Two mounts, as a route change produces, torn down in the F34 §2G order:
    // the first attachment is released before the second.
    const a = p.client('coach-web-route-a', 'coach', 1_000);
    expect(await a.core.ready()).toBe(true);
    a.listen.apply(coachSet());
    const bindA = a.emit.declarative();
    const wrapA = a.emit.dataLayer();
    expect(await a.emit.rendered('hero', 'cnt_tabby_lifestyle', p.hero), 'the painted hero is admitted').toMatchObject({ version: 1, status: 'durable', decisionId: HERO_RECEIPT });
    intersect(p.hero, true); // a dwell is pending
    await a.listen.hydrate({ page: 'home' }); // arms the periodic refresh timer

    // The live control for the silence asserted below: while the page is
    // mounted, a click and a push do reach the transport.
    const live = p.sent().length;
    p.cta.click();
    p.layer.push(ga4('view_item', 'COACH-ROGUE-25'));
    await settle();
    expect(p.sent().slice(live).map((e) => e.type).sort(), 'the mounted page reports its own click and push')
      .toEqual(['add_to_cart', 'product_view']);

    const b = p.client('coach-web-route-b', 'coach', 1_000);
    expect(await b.core.ready()).toBe(true);
    b.listen.apply(coachSet());
    const bindB = b.emit.declarative();
    const wrapB = b.emit.dataLayer();
    await b.listen.hydrate({ page: 'home' });

    bindA(); wrapA(); a.destroy();
    bindB(); wrapB(); b.destroy();
    await settle();

    expect(liveClickListeners(p.hero), 'click registrations on the content element after the full detach').toBe(0);
    expect(liveClickListeners(p.cta), 'click registrations on the commerce element after the full detach').toBe(0);
    expect(liveObservers(p.hero), 'observers watching the content element after the full detach').toBe(0);
    expect(p.layer.push, "the page's own push function after the full detach").toBe(pagePush);

    const quiet = p.urls().length;
    p.hero.click();
    p.cta.click();
    p.layer.push(ga4('add_to_cart', 'COACH-TABBY-26'));
    p.layer.push(HISTORIC_PURCHASE);
    intersect(p.hero, true);
    p.f.tick(3_000);
    intersect(p.hero, false);
    await settle();
    // Past the periodic refresh interval both mounts armed.
    await new Promise((r) => setTimeout(r, 1_300));
    expect(p.urls().slice(quiet), 'transport calls the detached page makes over a settled tick').toEqual([]);
    expect(p.layer.map((e) => (e as { event: string }).event), "the page's array still receives its own pushes")
      .toEqual(['view_item', 'add_to_cart', 'purchase']);
  });
});
