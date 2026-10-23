// src/units/P79/LEDGER.unit.test.ts
// P79 under the Closure Ledger: the tests for the LOCAL criteria PI1-PI4 of the P79 work order (the activation
// programme of amendment 11, ticket P79 "A new page instance on every product page view inside their app"). LV1 is a
// deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md,
// section 2, E1, "Done when"):
//   "navigating from one product page to another inside the app, and leaving a product page and returning to it,
//   opens a new page instance: a new decision set for the page view, its own deadline, receipts that belong to that
//   page view only, module and content impressions counted for the new page view; a page name or channel change still
//   opens one as today; a page view within the same product (a variant switch) does not; the kit states the rule."
// The work order (docs/parity/activation/program.json, P79): PI1 "a page view opened with the same page name and
// channel but another product (the page view's product key, a new member of the page view's options) opens a new page
// instance: a new pageInstance on the decision request, its own first-decision deadline (hydrateTimeoutMs from its own
// first request) and the earlier page view's holds released; leaving a product page and returning to it opens
// another"; PI2 "the render acknowledgement, the viewable impression and the module and content impressions of the new
// page view carry its pageInstance and are each sent once for it, and a late answer of the earlier product's page view
// never paints into the new one"; PI3 "a page name or channel change still opens a new page instance as today; a page
// view of the same product with another variant (the variant changed, the product key unchanged) opens none and keeps
// its deadline, holds and receipts; P34 T1-T5 and P40's viewable impression unchanged"; PI4 "what opens a page view
// (another page, another channel, another product) and what does not (a variant switch, a re-ask), in kit 01 beside
// the hold paragraph (:163-172) and the hydrateTimeoutMs row (:659) and in kit 02 :444". Remaining work: "The product
// key this ticket adds is the one P80 sends as the anchor product (ctx.anchor); name it so P80 can read it without
// another SDK option." The customer's front-end pack (docs/tapestry-packs/1-front-end/01-quick-start.md section 4, read
// as a document) opens a page view on every app route change with `client.listen.refresh({ page: 'pdp', ... })` and
// sends the product on its product events as `productId` (03-data-contract.md, "The events the product page sends").
//
// THE SDK-SIDE INPUT THIS FILE RULES (one name for load, refresh and the cached-layout view):
//   · `HydrateOptions.productId?: string` (src/sdk/listen.ts): the product of a product page view, the customer's
//     product identifier, the same value its product events carry as `productId`. It is the product key of the page
//     view. P80 sends it as the anchor product (`ctx.anchor`, the engine-side key it feeds: src/content/decide.ts reads
//     `ctx.anchor` from the request's ctx signals); P79 sends nothing new on the decision request.
//   · `HydrateOptions.variantId?: string`: the variant of that product (a colour, a size); P80 sends it as its own ctx
//     signal. A change of `variantId` alone is a variant switch.
//   · `LayoutExposure.productId?: string` (src/sdk/types.ts): the same product key on the cached layout's beacon, so a
//     layout drawn from a cache for another product belongs to its own page view (the builder's preparation, S20).
//   Both members are optional strings; a page that names no product keeps today's rule (page name and channel).
//
// THE READINGS THIS FILE RULES:
//   · "Opens a new page instance": the decision request the SDK sends for the new page view carries a page instance
//     the earlier page views did not use (`pageInstance` on the request, read at the fake engine and at the mounted
//     app), and the decisions delivered to the page carry it. Page views are numbered by the first appearance of
//     their instance: product A, product B, an unknown product and A again are page views [0, 1, 2, 3].
//   · "Its own deadline": `hydrateTimeoutMs` (1.5 s) measured from the new page view's first request: by then every
//     slot subscriber has the new page view's decisions or the empty list (P34 T2's ceiling, per page view).
//   · "The earlier page view's holds released": a slot held in product A's page view is repainted by product B's
//     first answer.
//   · "Receipts and impressions belong to the page view they were painted in": after product B's answer, B's
//     subscribers receive B's decisions (B's receipts), each painted placement's render acknowledgement is sent once
//     for B with B's pageInstance and B's decisionId (the module and content impressions: P03 decision D1, the
//     acknowledgement is the module's one impression per page instance), its viewable impression is sent once for B,
//     and an engagement carries B's decisionId. On the hosts, each admitted acknowledgement is one exposure (P03.E3),
//     so a module painted in two page views is counted twice.
//   · The cached layout (P30's beacon): a layout drawn from a cache for another product, with no hydrate or refresh
//     call, belongs to a new page view and its `layout_exposure` beacon is sent for it, once.
//   · "A late answer of the earlier product's page view never paints into the new one" (LOCK; the builder's
//     preparation found it already held by the intent counter and the pageInstance check).
//   · PI3's variant switch "opens none and keeps its deadline, holds and receipts": the request keeps the instance,
//     no empty list arrives 1.5 s after the switch, the held slot is not repainted, and the placements keep the
//     receipts they were painted with. A re-ask (`refresh()`, `refresh` of the same view, the SDK's own re-ask after
//     an acknowledged event) keeps the instance.
//   · PI4: read by sentence as P68 KT1 reads the kit. Beside the hold paragraph of kit 01 (the paragraph itself or
//     either neighbour) and beside kit 02's held-layout paragraph (:444): one sentence names another page, another
//     channel and another product (`productId`) as opening a page view, and one names a variant switch and a re-ask
//     as opening none (they may be one sentence). The `hydrateTimeoutMs` row of kit 01's configuration table names
//     another product (`productId`) and the variant switch.
//
// FIXTURE. The Coach catalogue (src/data/coach-catalog.json): product A is COA-CH857 (Tabby Shoulder Bag 26,
// Handbags), product B is COA-CB925 (Tabby Wallet With Chain, Small Leather Goods: another category), an unknown
// product COA-ZZ999 (not in the catalogue: the SDK names it as given), and the variants COA-CH857-BLACK and
// COA-CH857-CHALK (the catalogue's colours Black and Chalk of COA-CH857, as a customer's SKU names them). The host
// legs mount P02's product page (src/units/_parity.ts: the registered modules, the declared layout slot measured
// rendered-v1); the SDK legs drive createCore and createListen (and createEmit) on the repository's test host with a
// fake engine that admits only the receipts it issued, as P34 and P60 do.
//
// R10: no existing test pins what P79 changes (searched: the kit sentences at kit 01 :163-172, :659 and kit 02 :444
// are read by no test; no test calls hydrate or refresh with a product; P30's cached-layout tests name no product, so
// their page view is unchanged). Two constraints a build keeps: P68.KT1 checks that kit 02 :958's citations of
// src/sdk/listen.ts lines (:446, :459 and their continuations) land, so a line added above them in listen.ts re-points
// them (kit 02 is in the grant); and packages/sdk/package.json `sizeBudget` (P60.SD3, W40) has 3 245 bytes left on the
// ESM bundle and 3 126 on the IIFE at a91ba34a (the fix sketch used 285 of each).
//
// NO NEW EXPORT IS IMPORTED: the new members are read loosely (the page view's options cast), and the type-level leg
// of PI1 compiles a probe against src/sdk/listen.ts and src/sdk/types.ts, so this file compiles before they exist.
//
// MEASURED at a91ba34a (_evidence/parity-step3/S20/specifier/logs/b/, serial, --no-cache, working directory the tree):
// 14 RED for the missing behaviour (one page instance kept across products: [0, 0, 0, 0] where [0, 1, 2, 3] is expected;
// no deadline, no release of the hold, no impression, viewable impression or beacon for product B's page view; on both
// hosts B's paints acknowledged under A's page instance and counted once; the members not declared; the kit silent);
// the locks of PI3 and the late-answer lock of PI2 GREEN; 10 passed.
// NEGATIVE CONTROLS (scratch trees, never committed; _evidence/parity-step3/S20/specifier/sketches/p79.py): the fix
// (the three members; load and refresh open a page instance on a product change; the cached-layout view keyed by page
// and product; the kit sentences; listen.ts gains no line, so kit 02 :958's citations of listen.ts lines still land)
// turns all 24 GREEN three times, and P03, P13, P30, P34, P40, P60, P68, src/sdk/*.test.ts and
// src/routes/realtime.sdkContract.test.ts stay green under it with its bundles rebuilt (+285 bytes, within the budget);
// `variantopens` (a variant switch opens one) turns PI3's variant locks RED on the SDK and both hosts; `nopagename` and
// `nochannel` turn PI3's page-name and channel locks RED; `loadonly` (refresh unchanged) turns PI1's refresh, deadline,
// hold and host legs and PI2's receipt legs RED; `nocache` turns PI2's cached-layout leg (and the LayoutExposure member)
// RED.
//
// HARNESS: src/sdk/testHost.ts (the SDK legs), src/units/_parity.ts (the host legs). Imports from src/units/:
// ../_parity.

import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { identityRoutes } from '@/routes/identity';
import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createListen, type HydrateOptions } from '@/sdk/listen';
import { memoryHost } from '@/sdk/memoryHost';
import { authorityLocks, offeredSet, renderAck, testHost } from '@/sdk/testHost';
import type { ContentDecision, DecisionSet, LayoutExposure, RequestInitLike, ResponseLike } from '@/sdk/types';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

import {
  BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, M, MODULES, mount, readTree, rounded, shopperOn,
  TENANT, type Mounted,
} from '../_parity';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The products and variants of the fixture (src/data/coach-catalog.json). */
const A = 'COA-CH857', B = 'COA-CB925', UNKNOWN = 'COA-ZZ999';
const BLACK = 'COA-CH857-BLACK', CHALK = 'COA-CH857-CHALK';
const GRID = M.grid, RECO = M.reco1, LOOK = M.reco2, EDIT = M.editorial;

/**
 * A product page view's options as the customer's app passes them (`productId`, `variantId`: the members this file
 * rules). Cast, so this file compiles before the members exist.
 */
const pdpView = (productId?: string, variantId?: string, extra: Record<string, unknown> = {}): HydrateOptions =>
  ({ page: 'pdp', ...extra, ...(productId === undefined ? {} : { productId }), ...(variantId === undefined ? {} : { variantId }) }) as unknown as HydrateOptions;
/** The cached layout's beacon, with the product key this file rules on it. */
const beacon = (productId: string | undefined, modules: string[], contextKey = 'parity-context-key-1'): LayoutExposure =>
  ({ contextKey, page: 'pdp', slot: LAYOUT, modules, ...(productId === undefined ? {} : { productId }) }) as unknown as LayoutExposure;

/** Page views numbered by the first appearance of their page instance. */
const viewsOf = (instances: Array<string | undefined>): number[] => instances.map(i => [...new Set(instances)].indexOf(i));

// ===========================================================================
// The SDK legs: createCore, createListen and createEmit on the test host, with a fake engine.
// ===========================================================================

const decision = (slot: string, order: number, contentId: string): ContentDecision => ({ contentId,
  customerContentId: `TAP-${contentId.replace(/^module\./, '').replace(/\./g, '-').toUpperCase()}`, type: 'module', slot, order, slotPosition: order,
  score: 0.5, strategy: 'affinity', explain: { drivers: [] } });
/** The product page's layout slot, in the order given; `order` is page-wide, as the engine sends it. */
const layoutSet = (page: string, layout: string[]): DecisionSet => ({ page, arm: 'personalized', decisions: layout.map((id, i) => decision(LAYOUT, i, id)) });

/** One decision request in flight at the fake engine; `answer` resolves it with the layout given, its receipts minted under `revision`. */
interface Asked { page: string; pageInstance: string; answered: boolean; answer: (layout: string[], revision: string) => DecisionSet }
interface Sent { type: string; data: Record<string, unknown>; status: number }
const EL = { getAttribute: () => null, addEventListener: () => undefined };

/** The SDK as createClient composes it, over the test host and a fake engine that admits only the receipts it issued (P34's shape). */
function sdkPage(config: { hydrateTimeoutMs?: number } = {}) {
  const f = testHost();
  const asked: Asked[] = [], actions: Sent[] = [];
  const issued = new Map<string, string>(); // decisionId → renderOffer
  const passthrough = f.host.fetch;
  const respond = (json: unknown, status = 200): ResponseLike => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
    if (url.includes('/decisions/snapshot')) {
      const body = JSON.parse(init?.body ?? '{}') as { page: string; pageInstance: string };
      return new Promise<ResponseLike>(resolve => { asked.push({ page: body.page, pageInstance: body.pageInstance, answered: false, answer(layout, revision) {
        const offered = offeredSet(layoutSet(body.page, layout), body.pageInstance, revision);
        for (const d of offered.decisions) issued.set(d.decisionId!, d.renderOffer!);
        this.answered = true;
        resolve(respond({ ok: true, ...offered }));
        return offered;
      } }); });
    }
    if (url.endsWith('/action')) {
      const body = JSON.parse(init?.body ?? '{}') as { type: string; data?: Record<string, unknown> };
      const data = body.data ?? {};
      const known = typeof data.decisionId === 'string' && issued.has(data.decisionId);
      if (body.type === 'content_impression') {
        const admitted = known && issued.get(data.decisionId as string) === data.renderOffer;
        actions.push({ type: body.type, data, status: admitted ? 200 : 401 });
        return admitted ? respond(renderAck(init)) : respond({ success: false, error: 'render offer refused' }, 401);
      }
      if (/^content_/.test(body.type)) {
        actions.push({ type: body.type, data, status: known ? 200 : 401 });
        return known ? respond({ success: true, update: { data: { segments: [], decisions: {} } } }) : respond({ success: false, error: 'decision unknown' }, 401);
      }
      actions.push({ type: body.type, data, status: 200 });
      return respond({ success: true });
    }
    return passthrough(url, init);
  };
  const core = createCore({ tenant: TENANT, source: 'coach-pdp', ...config }, f.host);
  const listen = createListen(core);
  const emit = createEmit(core, listen);
  let elapsed = 0;
  const settle = () => vi.advanceTimersByTimeAsync(0);
  /** Time passes for the page: the host's clock and its timers. */
  const advance = async (ms: number) => { elapsed += ms; f.tick(ms); await vi.advanceTimersByTimeAsync(ms); };
  /** The page opens a view with `refresh` (as the customer's pack does on every route change) and the engine answers it with `layout`. */
  const open = async (view: HydrateOptions, layout: string[], revision: string, via: 'refresh' | 'hydrate' = 'refresh') => {
    const before = asked.length;
    void (via === 'refresh' ? listen.refresh(view) : listen.hydrate(view));
    await settle();
    const request = asked.slice(before).find(a => !a.answered);
    expect(request, `PRECONDITION: the page view (${JSON.stringify(view)}) asked for its decisions`).toBeTruthy();
    const offered = request!.answer(layout, revision);
    await settle();
    return { request: request!, offered };
  };
  const sent = (type: string) => actions.filter(a => a.type === type);
  return { f, core, listen, emit, asked, actions, sent, settle, advance, open, now: () => elapsed, destroy: () => { listen.destroy(); core.disconnect(); } };
}

/** An SDK leg runs on fake timers (the deadline, the viewable second), as P34 and P40 do. */
function sdkLeg(name: string, body: () => Promise<void>): void {
  it(name, async () => {
    vi.useFakeTimers();
    try { await body(); } finally { vi.useRealTimers(); }
  });
}
const ids = (decisions: ContentDecision[]) => decisions.map(d => d.contentId);
/** The receipts revision a delivered decision was minted under (`offeredSet`: `${revision}-${slot}-${order}-${contentId}`). */
const revisionOf = (d: ContentDecision) => (d.decisionId ?? '').split('-')[0];

// ===========================================================================
// The host legs: the same SDK over the mounted application, on each shopper host.
// ===========================================================================

/** P02's product page: the registered modules and the declared layout slot, measured rendered-v1. */
const DOCUMENTS = { pieces: MODULES, slots: declaredSlots([layoutSlot({ take: 3 })]), learn: learnDocument() };

/** The identity routes, mounted as src/index.ts mounts them (`app.route('/v1', identityRoutes)`), as src/units/_parity5.ts mounts them beside the parity app. */
const identityApp = new Hono<{ Bindings: Env }>();
identityApp.use('*', tenantMiddleware());
identityApp.route('/v1', identityRoutes);

interface Answered { pageInstance: string; decisions: Array<{ slot: string; contentId: string; decisionId?: string }> }
interface Acked { contentId: string; pageInstance: unknown; decisionId: unknown; status: number }

/**
 * The SDK (createCore, createListen) over the mounted application: every request it sends is served by `m.fetch` (the
 * identity routes by `identityApp` over the same bindings), under the shopper's own session and explicit choice
 * (shopperOn), the way src/routes/realtime.sdkContract.test.ts drives the SDK over the routes. Records the page instance of every decision request the application received, its answer,
 * and every render acknowledgement with the application's status.
 */
async function sdkOn(m: Mounted) {
  const shopper = await shopperOn(m);
  const requests: string[] = [], answers: Answered[] = [], acks: Acked[] = [];
  const host = memoryHost({ acquireAuthorityLock: authorityLocks(), uuid: () => crypto.randomUUID(), now: () => Date.now(),
    fetch: async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
      const target = new URL(url), body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      const request = new Request(`https://shop.invalid${target.pathname}${target.search}`, { method: init?.method ?? 'GET',
        headers: { ...(init?.headers ?? {}), 'X-Tenant': TENANT, [SHOPPER_HEADER]: init?.headers?.[SHOPPER_HEADER] ?? shopper.grant.capability },
        ...(init?.body === undefined ? {} : { body: init.body }) });
      const pending: Promise<unknown>[] = [];
      const response = target.pathname.includes('/identity/')
        ? await identityApp.fetch(request, m.env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext)
        : await m.fetch(request);
      const json = await response.json().catch(() => ({})) as Record<string, unknown>;
      while (pending.length) await Promise.all(pending.splice(0));
      await m.drain();
      if (target.pathname.endsWith('/decisions/snapshot')) {
        const instance = String(body?.pageInstance ?? target.searchParams.get('pageInstance'));
        requests.push(instance);
        answers.push({ pageInstance: instance, decisions: (Array.isArray(json.decisions) ? json.decisions : []) as Answered['decisions'] });
      }
      if (target.pathname === '/realtime/action' && body?.type === 'content_impression') {
        const data = (body.data ?? {}) as Record<string, unknown>;
        acks.push({ contentId: String(data.contentId), pageInstance: data.pageInstance, decisionId: data.decisionId, status: response.status });
      }
      return { ok: response.ok, status: response.status, json: async () => json };
    } });
  const core = createCore({ tenant: TENANT, endpoint: 'https://shop.invalid', source: 'sdk', brand: BRAND }, host);
  const listen = createListen(core);
  expect(await core.ready(), `PRECONDITION (${m.host}): the SDK holds the shopper's session`).toBe(true);
  /** The page opens a view and draws the layout slot it was answered: each module painted (`rendered`), in order. */
  const openAndPaint = async (view: HydrateOptions, paint = true): Promise<string[]> => {
    const set = await listen.refresh(view);
    const layout = (set?.decisions ?? []).filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
    expect(layout.length, `PRECONDITION (${m.host}): the page view (${JSON.stringify(view)}) is answered its layout`).toBeGreaterThan(0);
    if (paint) for (const d of layout) await listen.rendered(LAYOUT, d.contentId);
    await m.drain();
    return layout.map(d => d.contentId);
  };
  return { shopper, core, listen, requests, answers, acks, openAndPaint, destroy: () => { listen.destroy(); core.disconnect(); } };
}

/** A module's exposures the learning holds, as P03.E3 reads them: one per admitted acknowledgement. */
async function exposures(m: Mounted): Promise<Record<string, number>> {
  await m.drainLedger();
  return rounded(await learned(m), 'n');
}
/** How many of the page views given painted each module: what one exposure per admitted acknowledgement adds up to. */
const tally = (...views: string[][]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const view of views) for (const id of view) out[id] = (out[id] ?? 0) + 1;
  return out;
};

// ===========================================================================
// The type-level probe (P68.KT2's form): the members this file rules, as the compiler reads them.
// ===========================================================================

function typeCheck(probe: string): string[] {
  const probeFile = `${ROOT}src/sdk/__p79_probe__.ts`;
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, types: [] };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), source = host.getSourceFile.bind(host);
  host.readFile = name => (name === probeFile ? probe : read(name));
  host.fileExists = name => name === probeFile || exists(name);
  host.getSourceFile = (name, language) => (name === probeFile ? ts.createSourceFile(name, probe, language) : source(name, language));
  const program = ts.createProgram([probeFile], options, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(probeFile)).map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}
/** A probe that compiles only when `type` declares `member` as an optional member of type exactly `string`. */
const MEMBER_PROBE = (type: string, from: string, member: string) => `import type { ${type} } from '${from}';
type Exact<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
export const declared: '${member}' extends keyof ${type} ? true : false = true;
export const optional: {} extends Pick<${type}, Extract<'${member}', keyof ${type}>> ? true : false = true;
export const typed: Exact<${type}[Extract<'${member}', keyof ${type}>], string | undefined> = true;
`;
const memberState = (type: string, from: string, member: string): string =>
  typeCheck(MEMBER_PROBE(type, from, member)).length === 0 ? 'an optional string member' : 'not declared as an optional string member';

// ===========================================================================
// unit:P79.PI1 — another product opens a new page instance
// ===========================================================================

describe('unit:P79.PI1', () => {
  it('logic (type-level): the page view\'s options declare the product key and the variant (HydrateOptions.productId, HydrateOptions.variantId) and the cached layout\'s beacon the same product key (LayoutExposure.productId), each an optional string', () => {
    expect.soft([
      ['HydrateOptions.productId', memberState('HydrateOptions', './listen', 'productId')],
      ['HydrateOptions.variantId', memberState('HydrateOptions', './listen', 'variantId')],
      ['LayoutExposure.productId', memberState('LayoutExposure', './types', 'productId')],
    ], 'P79.PI1 — the SDK-side input this ticket rules, named once for load, refresh and the cached-layout view').toEqual([
      ['HydrateOptions.productId', 'an optional string member'],
      ['HydrateOptions.variantId', 'an optional string member'],
      ['LayoutExposure.productId', 'an optional string member'],
    ]);
  }, 120_000);

  it('CONTROL: the type-level probe has teeth — an existing optional string member passes, an undeclared one and a required one fail', () => {
    expect([memberState('HydrateOptions', './listen', 'channel'), memberState('HydrateOptions', './listen', 'p79NotAMember'), memberState('HydrateOptions', './listen', 'page')])
      .toEqual(['an optional string member', 'not declared as an optional string member', 'not declared as an optional string member']);
  }, 120_000);

  sdkLeg('sdk (refresh): product A, then product B (another category), then an unknown product, then A again, each opened with refresh on the same page name and channel, are four page instances: each decision request carries its own pageInstance and each page view\'s subscribers receive its own decisions', async () => {
    const p = sdkPage();
    await p.core.ready();
    const delivered: Array<{ instance?: string; revisions: string[] }> = [];
    p.listen.subscribe(LAYOUT, (ds, set) => delivered.push({ instance: set.pageInstance, revisions: [...new Set(ds.map(revisionOf))] }));
    const views: Array<[string, string]> = [[A, 'a'], [B, 'b'], [UNKNOWN, 'u'], [A, 'again']];
    const requests: string[] = [];
    for (const [product, revision] of views) requests.push((await p.open(pdpView(product), [GRID, RECO, LOOK], revision)).request.pageInstance);
    expect.soft(viewsOf(requests), 'P79.PI1 — each product page view opens its own page instance (today one page instance is kept across products)').toEqual([0, 1, 2, 3]);
    expect.soft(delivered.map(d => [viewsOf(requests)[requests.indexOf(d.instance ?? '')] ?? 'another page instance', d.revisions]),
      'P79.PI1 — each page view\'s subscribers receive that page view\'s own decision set').toEqual(views.map(([, revision], i) => [i, [revision]]));
    p.destroy();
  });

  sdkLeg('sdk (hydrate): product A then product B, each opened with hydrate on the same page name and channel, are two page instances', async () => {
    const p = sdkPage();
    await p.core.ready();
    const first = await p.open(pdpView(A), [GRID, RECO, LOOK], 'a', 'hydrate');
    const second = await p.open(pdpView(B), [GRID, RECO, LOOK], 'b', 'hydrate');
    expect.soft(viewsOf([first.request.pageInstance, second.request.pageInstance]), 'P79.PI1 — hydrate opens a page instance for another product as refresh does').toEqual([0, 1]);
    expect.soft(p.listen.current()?.pageInstance === second.request.pageInstance ? 'B\'s page instance' : `another page instance (${p.listen.current()?.pageInstance})`,
      'P79.PI1 — the page holds B\'s decision set').toBe('B\'s page instance');
    p.destroy();
  });

  sdkLeg('sdk: product B\'s page view has its own first-decision deadline: product A answered long before, B\'s request unanswered, every slot subscriber receives the empty list 1.5 s (hydrateTimeoutMs) after B\'s first request', async () => {
    const p = sdkPage({ hydrateTimeoutMs: 1500 });
    await p.core.ready();
    const seen: Array<{ at: number; list: string[] }> = [];
    p.listen.subscribe(LAYOUT, ds => seen.push({ at: p.now(), list: ids(ds) }));
    await p.open(pdpView(A), [GRID, RECO, LOOK], 'a');
    await p.advance(4000);
    const opened = p.now();
    void p.listen.refresh(pdpView(B));
    await p.settle();
    expect(p.asked.filter(a => !a.answered).length, 'PRECONDITION: B\'s first request is in flight and will not be answered').toBe(1);
    await p.advance(1500);
    expect.soft(seen.filter(e => e.at > opened).map(e => e.list), 'P79.PI1 — by 1.5 s from B\'s first request, the layout subscriber has B\'s decisions or the empty list (B\'s own deadline)')
      .toEqual([[]]);
    p.destroy();
  });

  sdkLeg('sdk: the layout held in product A\'s page view is released by product B\'s page view: B\'s first answer repaints the slot', async () => {
    const p = sdkPage();
    await p.core.ready();
    const calls: string[][] = [];
    p.listen.subscribe(LAYOUT, ds => calls.push(ids(ds)));
    await p.open(pdpView(A), [GRID, RECO, LOOK], 'a');
    p.listen.hold(LAYOUT);
    await p.open(pdpView(B), [LOOK, EDIT, GRID], 'b');
    expect.soft(calls.at(-1), 'P79.PI1 — B\'s answer repaints the layout A\'s page view held').toEqual([LOOK, EDIT, GRID]);
    p.destroy();
  });

  for (const host of HOSTS) {
    it(`host (${host}): the SDK over the mounted application, product A, then product B, then A again, each opened with refresh({ page: 'pdp', productId }): the application receives three decision requests under three page instances, and the page holds each page view's own set`, async () => {
      const m = await mount(host, DOCUMENTS);
      expectPublished(m, 'P79.PI1 — the product page with its declared layout slot publishes');
      const s = await sdkOn(m);
      try {
        const held: Array<string | undefined> = [];
        for (const product of [A, B, A]) { await s.openAndPaint(pdpView(product), false); held.push(s.listen.current()?.pageInstance); }
        expect.soft(viewsOf(s.requests), `${host}: P79.PI1 — each product page view's decision request carries its own page instance (today one is kept across products)`).toEqual([0, 1, 2]);
        expect.soft(held.map((instance, i) => instance === s.requests[i] ? 'its own page instance' : `another (${instance})`), `${host}: P79.PI1 — the page holds each page view's own decision set`)
          .toEqual(['its own page instance', 'its own page instance', 'its own page instance']);
      } finally { s.destroy(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P79.PI2 — receipts and impressions belong to the page view they were painted in
// ===========================================================================

describe('unit:P79.PI2', () => {
  sdkLeg('sdk: after product A\'s page view was painted, acknowledged and viewed, product B\'s page view (the same modules at the same positions) receives B\'s receipts; each placement\'s render acknowledgement is sent once for B with B\'s pageInstance and decisionId, its viewable impression once for B, and an engagement carries B\'s decisionId', async () => {
    const p = sdkPage();
    await p.core.ready();
    const calls: Array<{ instance?: string; receipts: string[] }> = [];
    p.listen.subscribe(LAYOUT, (ds, set) => calls.push({ instance: set.pageInstance, receipts: ds.map(d => d.decisionId ?? '') }));
    await p.open(pdpView(A), [GRID, RECO, LOOK], 'a');
    for (const id of [GRID, RECO, LOOK]) expect(await p.listen.rendered(LAYOUT, id, EL), `PRECONDITION: ${id} is acknowledged in A's page view`).toBeTruthy();
    p.listen.visible(LAYOUT, GRID, true);
    await p.advance(1000);
    expect(p.sent('content_viewable').length, 'PRECONDITION: A\'s grid sent its viewable impression').toBe(1);
    const before = p.actions.length;

    const b = await p.open(pdpView(B), [GRID, RECO, LOOK], 'b');
    const bInstance = b.request.pageInstance, bReceipt = (id: string) => b.offered.decisions.find(d => d.contentId === id)!.decisionId!;
    expect.soft(calls.at(-1), 'P79.PI2 — B\'s subscribers receive B\'s decisions, with B\'s receipts').toEqual({ instance: bInstance, receipts: [GRID, RECO, LOOK].map(bReceipt) });
    for (const id of [GRID, RECO, LOOK]) { await p.listen.rendered(LAYOUT, id, EL); await p.listen.rendered(LAYOUT, id, EL); }
    p.listen.visible(LAYOUT, GRID, true);
    await p.advance(1000);
    await p.emit.contentClick(GRID, LAYOUT);
    await p.settle();
    const sinceB = p.actions.slice(before);
    const of = (type: string) => sinceB.filter(x => x.type === type).map(x => [x.data.contentId, x.data.pageInstance ?? null, x.data.decisionId, x.status]);
    expect.soft(of('content_impression'), 'P79.PI2 — each placement\'s render acknowledgement (its impression) is sent once for B, with B\'s pageInstance and receipt')
      .toEqual([GRID, RECO, LOOK].map(id => [id, bInstance, bReceipt(id), 200]));
    expect.soft(of('content_viewable'), 'P79.PI2 — the grid\'s viewable impression is sent once for B').toEqual([[GRID, bInstance, bReceipt(GRID), 200]]);
    expect.soft(sinceB.filter(x => x.type === 'content_click').map(x => [x.data.decisionId, x.status]), 'P79.PI2 — the engagement on B\'s grid carries B\'s receipt')
      .toEqual([[bReceipt(GRID), 200]]);
    p.destroy();
  });

  sdkLeg('sdk: a layout drawn from a cache for another product, with no hydrate or refresh call, belongs to a new page view and its layout_exposure beacon is sent for it: A, then B, then A again are three beacons under three page instances; and after product A\'s page view opened with refresh, the cached layout of product B is reported under a page instance other than A\'s', async () => {
    const p = sdkPage();
    await p.core.ready();
    for (const product of [A, B, A]) { await p.listen.layoutExposure(beacon(product, [GRID, RECO, LOOK])); await p.settle(); }
    const cached = p.sent('layout_exposure').map(x => x.data.pageInstance as string | undefined);
    expect.soft(viewsOf(cached), 'P79.PI2 — each product\'s cached layout is reported once, under its own page view').toEqual([0, 1, 2]);

    const q = sdkPage();
    await q.core.ready();
    const opened = await q.open(pdpView(A), [GRID, RECO, LOOK], 'a');
    await q.listen.layoutExposure(beacon(A, [GRID, RECO, LOOK]));
    await q.listen.layoutExposure(beacon(B, [LOOK, GRID, EDIT]));
    await q.settle();
    const reported = q.sent('layout_exposure').map(x => x.data.pageInstance as string | undefined);
    expect.soft(viewsOf([opened.request.pageInstance, ...reported]), 'P79.PI2 — A\'s cached layout is reported under A\'s page view, B\'s under a new one').toEqual([0, 0, 1]);
    p.destroy(); q.destroy();
  });

  sdkLeg('sdk: LOCK — a late answer of product A\'s page view never paints into product B\'s: A\'s request in flight, the page opens B, A\'s answer arrives, and only B\'s answer reaches the subscribers', async () => {
    const p = sdkPage();
    await p.core.ready();
    const calls: string[][] = [];
    p.listen.subscribe(LAYOUT, ds => calls.push([...new Set(ds.map(revisionOf))]));
    void p.listen.refresh(pdpView(A));
    await p.settle();
    void p.listen.refresh(pdpView(B));
    await p.settle();
    p.asked[0]!.answer([GRID, RECO, LOOK], 'late');
    await p.settle();
    const forB = p.asked.find(x => !x.answered);
    expect(forB, 'PRECONDITION: B\'s page view asked for its decisions').toBeTruthy();
    forB!.answer([LOOK, EDIT, GRID], 'b');
    await p.settle();
    expect.soft(calls, 'P79.PI2 — the subscribers receive B\'s answer and never A\'s late one').toEqual([['b']]);
    p.destroy();
  });

  for (const host of HOSTS) {
    it(`host (${host}): the SDK over the mounted application, product A's page view painted, then product B's: B's render acknowledgements are admitted under B's page instance with B's receipts, and the learning counts each module once per page view it was painted in`, async () => {
      const m = await mount(host, DOCUMENTS);
      expectPublished(m, 'P79.PI2 — the product page with its declared layout slot publishes');
      const s = await sdkOn(m);
      try {
        const paintedA = await s.openAndPaint(pdpView(A));
        expect(s.acks.map(a => a.status), `${host}: PRECONDITION — A's paints are acknowledged and admitted`).toEqual(paintedA.map(() => 200));
        const fromA = s.acks.length;
        const paintedB = await s.openAndPaint(pdpView(B));
        const answerB = s.answers.at(-1)!;
        const receiptB = (id: string) => answerB.decisions.find(d => d.slot === LAYOUT && d.contentId === id)?.decisionId;
        expect.soft(s.acks.slice(fromA).map(a => [a.contentId, a.status, a.pageInstance, a.decisionId]),
          `${host}: P79.PI2 — each module painted in B's page view is acknowledged once for it, admitted, under B's page instance and with B's receipt`)
          .toEqual(paintedB.map(id => [id, 200, answerB.pageInstance, receiptB(id)]));
        expect.soft(await exposures(m), `${host}: P79.PI2 — one exposure per module per page view it was painted in`).toEqual(tally(paintedA, paintedB));
      } finally { s.destroy(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P79.PI3 — locks: a page name or channel change opens one; a variant switch and a re-ask do not
// ===========================================================================

describe('unit:P79.PI3', () => {
  sdkLeg('sdk: LOCK — a page name change still opens a new page instance: a page naming no product, the product page, the home page and the product page again are three page instances; and the same product (productId unchanged) on another page name is another page instance', async () => {
    const p = sdkPage();
    await p.core.ready();
    const requests: string[] = [];
    for (const [view, revision] of [[{ page: 'pdp' }, 'pdp'], [{ page: 'home' }, 'home'], [{ page: 'pdp' }, 'back']] as Array<[HydrateOptions, string]>) {
      requests.push((await p.open(view, [GRID, RECO, LOOK], revision)).request.pageInstance);
    }
    expect.soft(viewsOf(requests), 'P79.PI3 — another page opens a page instance, as today').toEqual([0, 1, 2]);
    const q = sdkPage();
    await q.core.ready();
    const product = await q.open(pdpView(A), [GRID, RECO, LOOK], 'pdp');
    const quickView = await q.open({ ...pdpView(A), page: 'quick-view' } as HydrateOptions, [GRID, RECO, LOOK], 'quick');
    expect.soft(viewsOf([product.request.pageInstance, quickView.request.pageInstance]), 'P79.PI3 — another page name with the same product opens a page instance').toEqual([0, 1]);
    p.destroy(); q.destroy();
  });

  sdkLeg('sdk: LOCK — a channel change still opens a new page instance: the same product page from the email channel, then from paid social, are two page instances', async () => {
    const p = sdkPage();
    await p.core.ready();
    const first = await p.open(pdpView(A, undefined, { channel: 'email' }), [GRID, RECO, LOOK], 'email');
    const second = await p.open(pdpView(A, undefined, { channel: 'paid_social' }), [GRID, RECO, LOOK], 'social');
    expect.soft(viewsOf([first.request.pageInstance, second.request.pageInstance]), 'P79.PI3 — another channel opens a page instance, as today').toEqual([0, 1]);
    p.destroy();
  });

  sdkLeg('sdk: LOCK — a variant switch (variantId changed, productId the same) opens no page instance and keeps the page view\'s deadline, holds and receipts', async () => {
    const p = sdkPage({ hydrateTimeoutMs: 1500 });
    await p.core.ready();
    const calls: Array<{ at: number; list: string[] }> = [];
    p.listen.subscribe(LAYOUT, ds => calls.push({ at: p.now(), list: ids(ds) }));
    const black = await p.open(pdpView(A, BLACK), [GRID, RECO, LOOK], 'black');
    const acked: unknown[] = [];
    for (const id of [GRID, RECO, LOOK]) acked.push((await p.listen.rendered(LAYOUT, id, EL))?.decisionId ?? null);
    expect(acked, 'PRECONDITION: the black variant\'s modules are acknowledged').toEqual(black.offered.decisions.map(d => d.decisionId));
    p.listen.hold(LAYOUT);
    await p.advance(4000);
    const switched = p.now();
    const chalk = await p.open(pdpView(A, CHALK), [LOOK, EDIT, GRID], 'chalk');
    // A second switch the engine does not answer: the page view's deadline, met long ago, delivers no empty list.
    void p.listen.refresh(pdpView(A, BLACK));
    await p.settle();
    await p.advance(1500);
    const kept: unknown[] = [];
    for (const id of [GRID, RECO, LOOK]) kept.push((await p.listen.rendered(LAYOUT, id, EL))?.decisionId ?? null);
    expect.soft({
      instances: viewsOf([black.request.pageInstance, chalk.request.pageInstance, p.asked.at(-1)!.pageInstance]),
      shown: calls.at(-1)?.list,
      receipts: kept,
    }, `P79.PI3 — the variant switch keeps the page instance, the held layout as painted (neither the chalk answer nor an empty list at 1.5 s; calls since the switch: ${JSON.stringify(calls.filter(c => c.at > switched).map(c => c.list))}) and the painted receipts`).toEqual({
      instances: [0, 0, 0], shown: [GRID, RECO, LOOK], receipts: acked,
    });
    p.destroy();
  });

  sdkLeg('sdk: LOCK — a re-ask opens no page instance: refresh() with no options, refresh of the same product page view, and the SDK\'s own re-ask after an acknowledged event all keep the page view\'s instance', async () => {
    const p = sdkPage();
    await p.core.ready();
    const opened = await p.open(pdpView(A, BLACK), [GRID, RECO, LOOK], 'first');
    void p.listen.refresh();
    await p.settle();
    p.asked.find(x => !x.answered)?.answer([GRID, RECO, LOOK], 'again');
    await p.settle();
    await p.open(pdpView(A, BLACK), [GRID, RECO, LOOK], 'same');
    await p.emit.productView(A, { line: 'Tabby', category: 'Handbags' });
    await p.settle();
    p.asked.find(x => !x.answered)?.answer([GRID, RECO, LOOK], 'follow');
    await p.settle();
    expect(p.asked.length, 'PRECONDITION: the page view asked four times (the first request and three re-asks)').toBe(4);
    expect.soft(viewsOf(p.asked.map(x => x.pageInstance)), 'P79.PI3 — every re-ask keeps the page view').toEqual([0, 0, 0, 0]);
    expect(opened.request.pageInstance, 'PRECONDITION: the first request named a page instance').toBeTruthy();
    p.destroy();
  });

  sdkLeg('sdk: LOCK — the cached layout of the same product, reported again (a variant drawn from the cache), belongs to the same page view: its beacon is sent once', async () => {
    const p = sdkPage();
    await p.core.ready();
    await p.listen.layoutExposure(beacon(A, [GRID, RECO, LOOK]));
    await p.listen.layoutExposure(beacon(A, [GRID, RECO, LOOK]));
    await p.settle();
    expect.soft(p.sent('layout_exposure').map(x => x.data.modules), 'P79.PI3 — one beacon for the page view').toEqual([[GRID, RECO, LOOK]]);
    p.destroy();
  });

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — the SDK over the mounted application, a variant switch of product A (black, then chalk): one page instance at the application, the variant's paints keep the receipts acknowledged before the switch, and the learning counts each module once`, async () => {
      const m = await mount(host, DOCUMENTS);
      expectPublished(m, 'P79.PI3 — the product page with its declared layout slot publishes');
      const s = await sdkOn(m);
      try {
        const black = await s.openAndPaint(pdpView(A, BLACK));
        const before = s.acks.map(a => [a.contentId, a.decisionId]);
        expect(s.acks.map(a => a.status), `${host}: PRECONDITION — the black variant's paints are admitted`).toEqual(black.map(() => 200));
        const set = await s.listen.refresh(pdpView(A, CHALK));
        const kept: Array<[string, unknown]> = [];
        for (const d of (set?.decisions ?? []).filter(x => x.slot === LAYOUT)) kept.push([d.contentId, (await s.listen.rendered(LAYOUT, d.contentId))?.decisionId ?? null]);
        expect.soft({ instances: viewsOf(s.requests), receipts: kept, exposures: await exposures(m) },
          `${host}: P79.PI3 — the variant switch keeps the page instance and the receipts, and counts no module twice`)
          .toEqual({ instances: [0, 0], receipts: before, exposures: tally(black) });
      } finally { s.destroy(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P79.PI4 — the kit states the rule
// ===========================================================================

/** A text's sentences (P68 KT1's split: after `.` or `;` followed by a space and a capital, a code span, emphasis or a parenthesis). */
const sentences = (text: string): string[] => text.split(/(?<=[.;])\s+(?=[A-Z`*(])/).map(s => s.trim()).filter(Boolean);
/** The paragraph of a document that holds `opening`, with the paragraph before and after it ("beside" it), each joined to one line. */
function beside(file: string, opening: string): { line: number; text: string } {
  const lines = readTree(file).split('\n'), paragraphs: Array<{ line: number; text: string }> = [];
  let start = -1;
  lines.forEach((text, i) => {
    if (text.trim() === '') { if (start >= 0) paragraphs.push({ line: start + 1, text: lines.slice(start, i).join(' ') }); start = -1; }
    else if (start < 0) start = i;
  });
  if (start >= 0) paragraphs.push({ line: start + 1, text: lines.slice(start).join(' ') });
  const at = paragraphs.findIndex(p => p.text.includes(opening));
  expect(at, `PRECONDITION: ${file} holds the paragraph "${opening}"`).toBeGreaterThanOrEqual(0);
  return { line: paragraphs[at]!.line, text: paragraphs.slice(Math.max(0, at - 1), at + 2).map(p => p.text).join(' ') };
}
/** What a passage states of the rule: what opens a page view, and what does not. */
function ruleOf(text: string): string[] {
  const said = sentences(text);
  const opens = said.some(s => /\bproductId\b/.test(s) && /\bchannel\b/i.test(s) && /\b(another|other|different)\s+page\b(?!\s+(view|instance))|\bpage name\b/i.test(s)
    && /\b(opens?|opening|begins?|starts?)\b|\bnew page (view|instance)\b/i.test(s));
  const not = said.some(s => /\bvariant/i.test(s) && /\bre-?asks?\b|\brefresh\(\)/i.test(s) && /\b(not|never|no|none)\b/i.test(s));
  return [opens ? 'states what opens a page view' : 'no sentence names another page, another channel and another product (`productId`) as opening a page view',
    not ? 'states what opens none' : 'no sentence names a variant switch and a re-ask as opening no page view'];
}
const STATED = ['states what opens a page view', 'states what opens none'];

describe('unit:P79.PI4', () => {
  it('logic: beside kit 01\'s hold paragraph ("Holding a layout for the page view", :163-172) one sentence names another page, another channel and another product (`productId`) as opening a page view, and one names a variant switch and a re-ask as opening none', () => {
    const { line, text } = beside('docs/kit/01-integration-guide.md', '**Holding a layout for the page view.**');
    expect.soft(ruleOf(text), `P79.PI4 — kit 01 :${line} states the rule`).toEqual(STATED);
  });

  it('logic: kit 01\'s hydrateTimeoutMs row (:659) names another product (`productId`) as a new page view with its own deadline and the variant switch as none', () => {
    const row = readTree('docs/kit/01-integration-guide.md').split('\n').map((text, i) => ({ text, line: i + 1 })).find(r => r.text.startsWith('| `hydrateTimeoutMs` |'));
    expect(row, 'PRECONDITION: kit 01 carries the hydrateTimeoutMs row').toBeTruthy();
    expect.soft([/\bproductId\b|\banother product\b/.test(row!.text) ? 'names another product' : 'names no product', /\bvariant/i.test(row!.text) ? 'names the variant switch' : 'names no variant switch'],
      `P79.PI4 — kit 01 :${row!.line}'s hydrateTimeoutMs row states the rule for the deadline`).toEqual(['names another product', 'names the variant switch']);
  });

  it('logic: beside kit 02\'s held-layout paragraph ("Receipts by position within the slot, and a held layout", :444) one sentence names another page, another channel and another product (`productId`) as opening a page view, and one names a variant switch and a re-ask as opening none', () => {
    const { line, text } = beside('docs/kit/02-api-reference.md', '**Receipts by position within the slot, and a held layout (browser SDK).**');
    expect.soft(ruleOf(text), `P79.PI4 — kit 02 :${line} states the rule`).toEqual(STATED);
  });

  it('CONTROL: the rule reader accepts the rule and refuses today\'s sentence', () => {
    expect([
      ruleOf('A new page view opens on another page, another channel or another product (`productId`); a variant switch (`variantId` changed) and a re-ask do not.'),
      ruleOf('Calling `release()` ends the hold, and so does a new page view (another page, or a new page instance); a release does not repaint by itself.'),
    ]).toEqual([STATED, [expect.stringMatching(/^no sentence names another page/), expect.stringMatching(/^no sentence names a variant/)]]);
  });
});
