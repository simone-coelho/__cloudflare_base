// @vitest-environment jsdom
// src/units/W17/L2.unit.test.ts
// W17 — the three follow-up lifecycle-ownership units that close W17's local
// scope (batch W17-B2): `client.destroy()` on its own, a foreign script that
// re-wraps the page's tag layer after the SDK attached, and the dwell
// precedence when both capture paths cover one painted node.
//
// One `describe('unit:W17.L1.NN')` per unit, one `it` per ruled leg (`sdk`).
// Every expected value comes from the witnesses, never from what the SDK does
// today:
//   · document 35 §5 row W17 · G2 — "Real lifecycle ownership/unbind for
//     declarative click/commerce, dataLayer wrappers and rendered observers.
//     Test detach/remount, changed DOM attributes, new clients, either teardown
//     order, identity/tenant switches, pending callbacks and zero events after
//     full detach in a real DOM/browser. Do not close on the proposed bind-once
//     WeakMap guard." — and §5 line 249: "Require actual ownership-aware unbind,
//     changed attributes, new-client tests, either-order wrapper teardown and
//     zero events after detach."
//   · document 35 §2 F12/F34 and `docs/architecture/35-verification-reports/F34.md`
//     §2B/§2D (a re-scan leaks observers; `rendered()`'s observer is never
//     released, and duplicated observation duplicates capture) and §2G (the
//     dataLayer adapter: "after the integrator has fully torn everything down
//     the layer is left instrumented, closed over a client the page has
//     discarded, and still posting").
//   · the documented integrator contract, which is the authority for the three
//     ruled outcomes below (`src/sdk/README.md` "Binding and unbinding";
//     `docs/kit/01-integration-guide.md` §4):
//       - "`client.destroy()` releases the listeners and observations the client
//         still holds, so `destroy()` before the detach functions and the detach
//         functions before `destroy()` both leave the page with no live
//         listener, wrapper, observer or pending callback, and nothing reaches
//         the transport afterwards." (unit .09)
//       - "The tag layer is the page's, not the client's. `dataLayer()` wraps
//         `push` once however many clients and attachments capture from it, each
//         live client sees the page's push once, and the page's own `push`
//         function is restored — by identity — only when the last attachment has
//         been released." and "Detach removes, it does not merely mute … so
//         nothing of the SDK is left on a node the page reuses." (unit .10)
//       - "`rendered(slot, contentId, element, decisionId)` admits the exact
//         painted choice, then observes dwell"; `src/sdk/core.ts:79-88` states
//         the precedence this batch guards: "an element is observed once per
//         client however many capture paths name it, so a declarative scan and a
//         `rendered()` call over the same node produce one observation and one
//         dwell rather than two". (unit .11)
//   · the W17-B1 build review (`_evidence/W17-B1/reviewer-build/REPORT.md`)
//     findings 3, 4 and 5, which named these three gaps: the double capture when
//     a foreign script re-wraps `push` between two SDK attachments, `destroy()`
//     alone having no unit, and the unnamed dwell precedence rule.
//   · the customer fixture: Coach's Tabby lifestyle hero, a craft story and an
//     add-to-bag call to action (docs/architecture/tapestry_requirements.txt
//     lines 113-122, 529-532, 567 — hero/editorial slots, GA4 tag layer). It is
//     the fixture `src/units/W17/L1.unit.test.ts` uses, unchanged, so the two
//     files demand one representation of the same page.
//
// HOW THIS RUNS THE REAL PATH. The file runs under jsdom (the repository
// default is node) with real elements, real attributes, a real page dataLayer
// array and a real IntersectionObserver, and drives the real SDK modules
// (`core.ts`, `emit.ts`, `listen.ts`, `identify.ts`) against the repository's
// memory host (`src/sdk/testHost.ts`), whose `fetch` IS the transport boundary.
// `src/sdk/host.ts` and `src/sdk/index.ts` are excluded from the app tsconfig
// (they need the DOM lib), so they cannot be imported here; instead:
//   · the DOM port is rebuilt line for line from `host.ts:12-24` and the shipped
//     lines are pinned on every run, as `L1.unit.test.ts` does; and
//   · the client is composed exactly as `createClient` composes it
//     (`index.ts:32-35`, pinned); and
//   · the teardown is not copied and not re-stated. Ruling R55: the teardown
//     composition is a typecheck-visible product module, `src/sdk/teardown.ts`,
//     exporting `destroyClient(core, listen, emit, identity)` with no DOM types,
//     which `createClient`'s `destroy` delegates to. Unit .09 imports
//     `destroyClient` by that name and runs it over the same four locals, and
//     pins that the shipped `destroy` delegates to it. That module does not
//     exist at specification: it is the ruled-missing export (R21), so .09 is
//     RED on it until the build creates it. This answers the W17-B1 review's
//     finding 4 — the L1 harness rebuilt `destroy` as its pre-change shape, so
//     nothing tested the shipped teardown — without a copy that can drift.
//
// WHAT IS ASSERTED. Primary observable: the transport boundary — every `fetch`
// the SDK makes, with the parsed `/realtime/action` envelopes. Secondary
// observable, because a guard that merely mutes does not satisfy ownership: the
// PAGE's own state — how many click listeners are registered on the element,
// how many live observers watch it, whether `dataLayer.push` is the function the
// page put there, and what the page's own array holds. No internal SDK flag is
// read.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createIdentity } from '@/sdk/identify';
import { createListen, type ListenOptions } from '@/sdk/listen';
// R55/R21 — the ruled-missing export. `src/sdk/teardown.ts` does not exist at
// specification, so this is the one permitted app typecheck error (TS2307) and
// the reason unit .09 is RED; the type import is erased by the bundler, so the
// other two units in this file still run.
import type { destroyClient as destroyClientSignature } from '@/sdk/teardown';
import { offeredSet, testHost } from '@/sdk/testHost';
import type { DomLike, ElementLike, RequestInitLike, ResponseLike } from '@/sdk/types';

type DestroyClient = typeof destroyClientSignature;
/** Held in a const so the bundler leaves the resolution to run time: see unit .09. */
const TEARDOWN_MODULE = '@/sdk/teardown';

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

// ---------------------------------------------------------------------------
// The shipped SDK files this harness rebuilds, read as text and pinned. If a
// remedy changes what is pinned, every unit in this file fails by design and
// the rebuild has to be re-ruled before any of them can mean anything again.
// ---------------------------------------------------------------------------

// `import.meta.url` is read through a const and the specifiers below are plain
// literals: `new URL(<template literal>, import.meta.url)` is rewritten by the
// bundler into an asset URL (`file:///src/sdk/index.ts`), which never exists, and
// a `process.cwd()` fallback would then read whichever checkout the process was
// started in — another lane's tree. There is no fallback: a miss throws, so a pin
// can never be silently unread or read from the wrong tree.
const metaUrl = import.meta.url;
function readShipped(url: URL): string {
  const path = url.protocol === 'file:' ? fileURLToPath(url) : decodeURIComponent(url.pathname).replace(/^\/@fs/, '');
  return readFileSync(path, 'utf8');
}
const SHIPPED_PORT = readShipped(new URL('../../sdk/host.ts', metaUrl));
const SHIPPED_CLIENT = readShipped(new URL('../../sdk/index.ts', metaUrl));
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The load-bearing lines of `domOf()` at `src/sdk/host.ts:12-24`. */
const SHIPPED_PORT_LINES = [
  'querySelectorAll: (sel) => Array.from(doc.querySelectorAll(sel)) as unknown as ArrayLike<ElementLike> & Iterable<ElementLike>,',
  "observe: (el, cb) => { if (typeof win.IntersectionObserver !== 'function') { cb(true); return () => {}; }",
  'const io = new win.IntersectionObserver((entries) => { for (const e of entries) cb(e.intersectionRatio >= 0.5); }, { threshold: [0, 0.5] });',
  'io.observe(el as unknown as Element); return () => io.disconnect();',
];
/** The composition `createClient` performs at `src/sdk/index.ts:32-35`. */
const SHIPPED_CLIENT_LINES = [
  'const core = createCore(config, host);',
  'const listen = createListen(core, options);',
  'const emit = createEmit(core, listen);',
  'const identity = createIdentity(core);',
];

/**
 * The `destroy` property of the object `createClient` RETURNS — the client's
 * own, not a decoy declared elsewhere in the file: the scan starts at the
 * `return {` of `createClient` and refuses to read anything if that object
 * declares more than one `destroy:`.
 */
function shippedClientDestroy(): string {
  const fn = SHIPPED_CLIENT.indexOf('export function createClient');
  const returned = fn < 0 ? -1 : SHIPPED_CLIENT.indexOf('return {', fn);
  const at = returned < 0 ? -1 : SHIPPED_CLIENT.indexOf('destroy:', returned);
  if (at < 0) throw new Error("src/sdk/index.ts: the object createClient returns declares no `destroy:`; unit W17.L1.09 must be re-ruled against the new shape");
  if (SHIPPED_CLIENT.indexOf('destroy:', at + 1) >= 0) throw new Error("src/sdk/index.ts: more than one `destroy:` follows createClient's `return {`; unit W17.L1.09 must be re-ruled against the new shape");
  let depth = 0;
  for (let i = at; i < SHIPPED_CLIENT.length; i++) {
    const ch = SHIPPED_CLIENT[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === '}') { if (depth === 0) return SHIPPED_CLIENT.slice(at, i); depth--; }
    else if (ch === ',' && depth === 0) return SHIPPED_CLIENT.slice(at, i);
  }
  throw new Error("src/sdk/index.ts: createClient's `destroy` property does not terminate; unit W17.L1.09 must be re-ruled against the new shape");
}

/** True of every unit: the DOM port and the client composition this file rebuilds. */
function pinShipped(): void {
  for (const line of SHIPPED_PORT_LINES) {
    expect(squash(SHIPPED_PORT), `src/sdk/host.ts:12-24 still builds the DOM port this file rebuilds: ${line}`).toContain(line);
  }
  for (const line of SHIPPED_CLIENT_LINES) {
    expect(squash(SHIPPED_CLIENT), `src/sdk/index.ts still composes the client this file rebuilds: ${line}`).toContain(line);
  }
}

/**
 * Unit .09 only: what the page calls — `client.destroy()` — is the function
 * this unit runs. R55: `createClient`'s `destroy` delegates to
 * `destroyClient(core, listen, emit, identity)` from `src/sdk/teardown.ts`.
 */
function pinShippedDestroyDelegation(): void {
  expect(squash(shippedClientDestroy()),
    "src/sdk/index.ts: the `destroy` on the client createClient returns delegates to the teardown module this unit runs (R55)")
    .toContain('destroyClient(core, listen, emit, identity)');
}

/** The DOM port `browserHost()` builds in production (src/sdk/host.ts:12-24), verbatim. */
function pageDom(): DomLike {
  const win = globalThis as unknown as {
    IntersectionObserver?: new (cb: (entries: IOEntry[]) => void, opts?: unknown) => { observe(el: unknown): void; disconnect(): void };
  };
  return {
    querySelectorAll: (sel) => Array.from(doc().querySelectorAll(sel)) as unknown as ArrayLike<ElementLike> & Iterable<ElementLike>,
    observe: (el, cb) => {
      // The shipped port returns `() => {}` here; `() => undefined` is the same
      // function for every caller and is what this repository's lint rule
      // permits in new code (src/sdk/listen.ts:278 uses the same form).
      if (typeof win.IntersectionObserver !== 'function') { cb(true); return () => undefined; }
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
// The customer fixture, identical to `src/units/W17/L1.unit.test.ts`: Coach's
// storefront, where the Tabby lifestyle hero and the craft story are pieces the
// engine chose, the teaser is a piece the page carries that the engine did not
// choose, and the button is the add-to-bag call to action.
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

/** GA4-shaped entries, the shape most tag layers already produce. */
const ga4 = (event: string, itemId: string) => ({ event, ecommerce: { items: [{ item_id: itemId }] } });
const eventNames = (layer: unknown[]): string[] => layer.map((e) => String((e as { event?: unknown }).event ?? ''));

interface Posted { type: string; source: string; data: Record<string, unknown> }
type PagePush = (...items: unknown[]) => number;

function page() {
  pinShipped();
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

  // Every fetch the SDK makes, in order: the transport boundary. The
  // repository's own host answers them (src/sdk/testHost.ts), including the
  // grant recovery two clients on one page share.
  const traffic: Array<{ url: string; init?: RequestInitLike }> = [];
  const base = f.host.fetch;
  f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
    traffic.push({ url, init });
    return base(url, init);
  };

  const sent = (): Posted[] => traffic.filter((c) => c.url.endsWith('/action')).map((c) => {
    const envelope = JSON.parse(c.init!.body!) as { type: string; source: string; data: Record<string, unknown> };
    return { type: envelope.type, source: envelope.source, data: envelope.data };
  });
  const urls = (): string[] => traffic.map((c) => c.url);
  /** The four locals `createClient` composes (src/sdk/index.ts:32-35, pinned). */
  const client = (source: string, options: ListenOptions = {}) => {
    const core = createCore({ tenant: 'coach', source }, f.host);
    const listen = createListen(core, options);
    const emit = createEmit(core, listen);
    const identity = createIdentity(core);
    return { core, listen, emit, identity };
  };
  return { f, hero, story, teaser, cta, layer, sent, urls, client };
}

/** A settled tick: every microtask and the SDK's own zero-delay work has run. */
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5)); };

// ===========================================================================

describe('unit:W17.L1.09', () => {
  it('sdk: `client.destroy()` alone gives the page back its listeners, its observers and its own dataLayer push, and nothing reaches the transport afterwards — whether a dwell is pending or not', async () => {
    // src/sdk/README.md, "Binding and unbinding": "`client.destroy()` releases
    // the listeners and observations the client still holds, so `destroy()`
    // before the detach functions and the detach functions before `destroy()`
    // both leave the page with no live listener, wrapper, observer or pending
    // callback, and nothing reaches the transport afterwards." This unit is the
    // first half of that sentence, which W17-B1 never measured (review finding
    // 4): the page calls NO detach function at all, only `destroy()`.
    //
    // R55: what `client.destroy()` runs is `destroyClient(core, listen, emit,
    // identity)` from `src/sdk/teardown.ts`, so that is what this unit runs, on
    // the same four locals. The specifier at `@/sdk/teardown` is resolved at run
    // time (the type import at the top of this file is the compile-time half),
    // so the ruled-missing module reds THIS unit and leaves .10 and .11 alive.
    const { destroyClient } = await import(TEARDOWN_MODULE) as { destroyClient: DestroyClient };
    pinShippedDestroyDelegation();

    for (const moment of ['no dwell pending', 'a dwell pending'] as const) {
      const p = page();
      const pagePush: PagePush = p.layer.push;
      const c = p.client('coach-web');
      expect(await c.core.ready()).toBe(true);
      c.listen.apply(coachSet());

      // The page binds every documented capture path and keeps none of the
      // detach functions — the integration it is entitled to write, because
      // `destroy()` is documented to release whatever the client still holds.
      c.emit.declarative();
      c.emit.dataLayer();
      expect(await c.emit.rendered('hero', 'cnt_tabby_lifestyle', p.hero), 'the painted hero is admitted')
        .toMatchObject({ version: 1, status: 'durable', decisionId: HERO_RECEIPT });

      // Live control for the dwell silence asserted after the teardown: while
      // the page is mounted, one on-screen cycle over this node IS a dwell.
      let mark = p.sent().length;
      intersect(p.hero, true);
      p.f.tick(3_000);
      intersect(p.hero, false);
      await settle();
      expect(p.sent().slice(mark).map((e) => [e.type, e.data.decisionId, e.data.ms]),
        `the mounted page reports one dwell for one on-screen cycle (${moment})`).toEqual([['content_dwell', HERO_RECEIPT, 3_000]]);

      // Live control for the click and push silence, and the registrations the
      // zeros below are a removal of.
      mark = p.sent().length;
      p.cta.click();
      p.layer.push(ga4('add_to_cart', 'COACH-TABBY-26'));
      await settle();
      expect(p.sent().slice(mark).map((e) => e.type).sort(), `the mounted page reports its own click and push (${moment})`)
        .toEqual(['add_to_cart', 'add_to_cart']);
      expect(liveClickListeners(p.hero), `click registrations on the content element while mounted (${moment})`).toBe(1);
      expect(liveClickListeners(p.cta), `click registrations on the commerce element while mounted (${moment})`).toBe(1);
      expect(liveObservers(p.hero), `live observers watching the content element while mounted (${moment})`).toBe(1);

      // The second pass tears down mid-measurement: the hero is on screen and a
      // dwell is being measured that has not been reported.
      if (moment === 'a dwell pending') { intersect(p.hero, true); await settle(); }

      destroyClient(c.core, c.listen, c.emit, c.identity);

      expect(liveClickListeners(p.hero), `click registrations left on the content element after destroy alone (${moment})`).toBe(0);
      expect(liveClickListeners(p.cta), `click registrations left on the commerce element after destroy alone (${moment})`).toBe(0);
      expect(liveObservers(p.hero), `observers left watching the content element after destroy alone (${moment})`).toBe(0);
      expect(p.layer.push, `the page's own push function after destroy alone (${moment})`).toBe(pagePush);

      const quiet = p.urls().length;
      p.hero.click();
      p.cta.click();
      p.layer.push(ga4('view_item', 'COACH-ROGUE-25'));
      intersect(p.hero, true);
      p.f.tick(3_000);
      intersect(p.hero, false); // a pending dwell would land here
      await settle();
      expect(p.urls().slice(quiet), `transport calls the page makes after destroy alone (${moment})`).toEqual([]);
      expect(eventNames(p.layer), `the page's array still receives its own pushes (${moment})`)
        .toEqual(['add_to_cart', 'view_item']);
    }
  });
});

describe('unit:W17.L1.10', () => {
  it("sdk: when a foreign tag script re-wraps the page's dataLayer push after the SDK attached, every live attachment still captures each push exactly once, the foreign wrappers keep working, and after the last release the page is left with its own chain", async () => {
    // src/sdk/README.md: "The tag layer is the page's, not the client's.
    // `dataLayer()` wraps `push` once however many clients and attachments
    // capture from it, each live client sees the page's push once, and the
    // page's own `push` function is restored — by identity — only when the last
    // attachment has been released." A consent tool, GTM or Tealium wrapping
    // `push` after the SDK did is ordinary on a real storefront; the W17-B1
    // review's finding 3 named it as the unmeasured risk of the layer registry.
    const p = page();

    // 1 · The SDK attaches first, to an empty layer.
    const a = p.client('coach-web-route-a');
    expect(await a.core.ready()).toBe(true);
    const offA = a.emit.dataLayer();
    let mark = p.sent().length;
    p.layer.push(ga4('add_to_cart', 'COACH-TABBY-26'));
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.source, e.data.productId]), 'the page push reaches the attached client once')
      .toEqual([['add_to_cart', 'coach-web-route-a', 'COACH-TABBY-26']]);

    // 2 · A foreign tag script wraps the layer's push after the SDK did, the
    // way a tag manager or a consent tool does: it keeps whatever it found and
    // calls through to it.
    const seenByFirstTag: string[] = [];
    const underFirstTag: PagePush = p.layer.push;
    const firstTag: PagePush = function (this: unknown[], ...entries: unknown[]): number {
      for (const entry of entries) seenByFirstTag.push(String((entry as { event?: unknown }).event ?? ''));
      return underFirstTag.apply(this, entries);
    };
    p.layer.push = firstTag;

    mark = p.sent().length;
    p.layer.push(ga4('view_item', 'COACH-ROGUE-25'));
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.source, e.data.productId]),
      'with the foreign wrapper on top the attached client still captures the push once')
      .toEqual([['product_view', 'coach-web-route-a', 'COACH-ROGUE-25']]);
    expect(seenByFirstTag, 'the foreign wrapper sees the push it wrapped').toEqual(['view_item']);

    // 3 · The page mounts a second client while the foreign wrapper is in
    // place. One push is one event for each live client — never two.
    const b = p.client('coach-web-route-b');
    expect(await b.core.ready()).toBe(true);
    // The layer's entries were already reported by the live attachment, so the
    // remount takes the documented no-replay attachment.
    const offB = b.emit.dataLayer({ replay: false });
    mark = p.sent().length;
    p.layer.push(ga4('add_to_cart', 'COACH-ROGUE-25'));
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.source, e.data.productId]).sort(),
      'one push is exactly one event for each live client, with the foreign wrapper between them').toEqual([
      ['add_to_cart', 'coach-web-route-a', 'COACH-ROGUE-25'],
      ['add_to_cart', 'coach-web-route-b', 'COACH-ROGUE-25'],
    ]);
    expect(seenByFirstTag, 'the foreign wrapper keeps working after the second SDK attachment')
      .toEqual(['view_item', 'add_to_cart']);

    // 4 · A second foreign tag wraps the layer, and a third client mounts after
    // it. Still exactly one event per live client, and both foreign wrappers
    // see the push once.
    const seenBySecondTag: string[] = [];
    const underSecondTag: PagePush = p.layer.push;
    const secondTag: PagePush = function (this: unknown[], ...entries: unknown[]): number {
      for (const entry of entries) seenBySecondTag.push(String((entry as { event?: unknown }).event ?? ''));
      return underSecondTag.apply(this, entries);
    };
    p.layer.push = secondTag;

    const c = p.client('coach-web-route-c');
    expect(await c.core.ready()).toBe(true);
    const offC = c.emit.dataLayer({ replay: false });
    mark = p.sent().length;
    p.layer.push(ga4('add_to_cart', 'COACH-WILLOW-24'));
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.source, e.data.productId]).sort(),
      'one push is exactly one event for each of the three live clients').toEqual([
      ['add_to_cart', 'coach-web-route-a', 'COACH-WILLOW-24'],
      ['add_to_cart', 'coach-web-route-b', 'COACH-WILLOW-24'],
      ['add_to_cart', 'coach-web-route-c', 'COACH-WILLOW-24'],
    ]);
    expect(seenByFirstTag, 'the first foreign wrapper sees each push once').toEqual(['view_item', 'add_to_cart', 'add_to_cart']);
    expect(seenBySecondTag, 'the second foreign wrapper sees each push once').toEqual(['add_to_cart']);

    // 5 · Every SDK attachment is released, in mount order. What is left on the
    // layer is the page's own chain: the foreign wrapper the page put there
    // last, over the page's own push, with nothing of the SDK still capturing.
    offA();
    offB();
    offC();
    expect(p.layer.push, "the page's push after every SDK attachment is released is the page's own foreign wrapper").toBe(secondTag);

    const quiet = p.urls().length;
    const length = p.layer.push(ga4('view_item', 'COACH-WILLOW-24'));
    await settle();
    expect(p.urls().slice(quiet), 'transport calls a push makes after every SDK attachment is released').toEqual([]);
    expect(length, "the page's own push still answers with the array's new length").toBe(p.layer.length);
    expect(seenByFirstTag, 'the first foreign wrapper still sees the page\'s pushes').toEqual(['view_item', 'add_to_cart', 'add_to_cart', 'view_item']);
    expect(seenBySecondTag, 'the second foreign wrapper still sees the page\'s pushes').toEqual(['add_to_cart', 'view_item']);
    expect(eventNames(p.layer), "the page's array holds each push exactly once, in order")
      .toEqual(['add_to_cart', 'view_item', 'add_to_cart', 'add_to_cart', 'view_item']);

    // 6 · A later mount is captured exactly once too: nothing the SDK left in
    // the page's chain delivers a second time.
    const d = p.client('coach-web-route-d');
    expect(await d.core.ready()).toBe(true);
    const offD = d.emit.dataLayer({ replay: false });
    mark = p.sent().length;
    p.layer.push(ga4('add_to_cart', 'COACH-TABBY-26'));
    await settle();
    expect(p.sent().slice(mark).map((e) => [e.type, e.source, e.data.productId]),
      'a client that mounts after the whole cycle captures the push exactly once')
      .toEqual([['add_to_cart', 'coach-web-route-d', 'COACH-TABBY-26']]);
    offD();
    expect(p.layer.push, "the page's push after the later mount is released is the page's own foreign wrapper again").toBe(secondTag);
    expect(eventNames(p.layer), "the page's array holds every push it was given exactly once, in order")
      .toEqual(['add_to_cart', 'view_item', 'add_to_cart', 'add_to_cart', 'view_item', 'add_to_cart']);
  });
});

describe('unit:W17.L1.11', () => {
  it('sdk: one painted node covered by both the declarative scan and `rendered()` sends exactly one dwell, on the declarative threshold and carrying the served receipt; after detach neither path sends one, and a remount sends one again', async () => {
    // The precedence `src/sdk/listen.ts:270-273` implements and
    // `src/sdk/core.ts:79-88` states: "an element is observed once per client
    // however many capture paths name it, so a declarative scan and a
    // `rendered()` call over the same node produce one observation and one
    // dwell rather than two" (document 35 §5 W17; F34 §2B/§2D). The two
    // thresholds differ on purpose: 1_500 ms is the declarative scan's option,
    // the rule that survives; 500 ms is the renderer observer's (the client's
    // ListenOptions), the rule that is dropped.
    const p = page();
    const c = p.client('coach-web', { dwellMinMs: 500 });
    expect(await c.core.ready()).toBe(true);
    c.listen.apply(coachSet());

    const bind = c.emit.declarative({ dwellMinMs: 1_500 });
    expect(await c.emit.rendered('hero', 'cnt_tabby_lifestyle', p.hero), 'the painted hero is admitted')
      .toMatchObject({ version: 1, status: 'durable', decisionId: HERO_RECEIPT });
    expect(liveObservers(p.hero), 'live observers watching the node both capture paths cover').toBe(1);

    // An on-screen cycle under the declarative threshold and over the
    // renderer's: the declarative rule governs, so this is not a dwell.
    let mark = p.sent().length;
    intersect(p.hero, true);
    p.f.tick(900);
    intersect(p.hero, false);
    await settle();
    expect(p.sent().slice(mark).filter((e) => e.type === 'content_dwell'),
      'an on-screen cycle under the declarative threshold is no dwell from either path').toEqual([]);

    // Over the declarative threshold: exactly one dwell, carrying the served
    // receipt and the declarative attribute payload.
    mark = p.sent().length;
    intersect(p.hero, true);
    p.f.tick(2_000);
    intersect(p.hero, false);
    await settle();
    expect(p.sent().slice(mark).filter((e) => e.type === 'content_dwell').map((e) => e.data),
      'one node covered by both capture paths sends exactly one dwell, on the declarative rule').toEqual([
      { contentId: 'cnt_tabby_lifestyle', slot: 'hero', contentType: 'editorial', decisionId: HERO_RECEIPT, ms: 2_000 },
    ]);

    // Detach: the documented detach function, and neither path sends a dwell
    // for the same cycle. (This unit is about the precedence between the two
    // capture paths, so it uses only the detach function `declarative()`
    // returns; `client.destroy()` is unit .09's subject.)
    bind();
    expect(liveObservers(p.hero), 'observers left watching the node after the page ran the detach function').toBe(0);
    const quiet = p.urls().length;
    intersect(p.hero, true);
    p.f.tick(2_000);
    intersect(p.hero, false);
    await settle();
    expect(p.urls().slice(quiet), 'transport calls the same on-screen cycle makes after detach').toEqual([]);

    // Remount: one observation and one dwell again, from the mounted client.
    const b = p.client('coach-web-route-b', { dwellMinMs: 500 });
    expect(await b.core.ready()).toBe(true);
    b.listen.apply(coachSet());
    const rebind = b.emit.declarative({ dwellMinMs: 1_500 });
    expect(await b.emit.rendered('hero', 'cnt_tabby_lifestyle', p.hero), 'the remounted hero is admitted')
      .toMatchObject({ version: 1, status: 'durable', decisionId: HERO_RECEIPT });
    expect(liveObservers(p.hero), 'live observers watching the node after the remount').toBe(1);

    mark = p.sent().length;
    intersect(p.hero, true);
    p.f.tick(2_000);
    intersect(p.hero, false);
    await settle();
    expect(p.sent().slice(mark).filter((e) => e.type === 'content_dwell').map((e) => [e.source, e.data.decisionId, e.data.ms]),
      'the remounted page sends one dwell again, from the mounted client').toEqual([['coach-web-route-b', HERO_RECEIPT, 2_000]]);
    rebind();
    expect(liveObservers(p.hero), 'observers left watching the node after the remounted page detached').toBe(0);
  });
});
