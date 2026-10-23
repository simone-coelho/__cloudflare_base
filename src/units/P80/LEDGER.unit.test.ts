// src/units/P80/LEDGER.unit.test.ts
// P80 under the Closure Ledger: the tests for the LOCAL criteria AS1-AS4 of the P80 work order (the activation
// programme of amendment 11, ticket P80 "The carousel slot's candidates limited to the images of the product on the
// page"). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md,
// section 2, E2, "Done when"):
//   "a content slot can be declared as scoped to the anchor product: on a product page whose anchor product identifier
//   is known, its candidates are only the catalogue items whose product link names that product (by master
//   identifier, with the variant beside it where colour-specific images exist); an item of another product is never a
//   candidate; a slot with no anchor on the page returns its default; the receipt names the scope."
// The work order (docs/parity/activation/program.json, P80): AS1 "A content slot declared as scoped to the anchor
// product, on a request that names the anchor product, has as candidates only the catalogue items whose product link
// (featuredProductIds) names that product by master identifier, or the master and the variant the request names
// where an item names a variant; an item of another product is never a candidate on any arm"; AS2 "A scoped slot on a
// request that names no anchor, or whose anchor no item names, returns the empty list so the page keeps its default;
// the decision record and the receipt name the scope and the anchor, so a replay reproduces the candidates"; AS3 "The
// browser SDK sends the anchor: a page view opened with a product key (P79) sends it as ctx.anchor, and the variant
// as its own ctx signal, on the GET snapshot and on the first POST request alike"; AS4 "Locks: the complements
// preference on an unscoped slot unchanged; the scope can only withhold, never add or boost a piece (the form of P31's
// report); the kit states the scoped slot (kit 03 :236-237 and the slot rules in kit 02) and kit 02 :792's 'a ctx.
// signal on the query string gates no module' names the scope as its one exception". The customer's carousel note
// (docs/tapestry-packs/1-front-end/10-carousel-design-note.md, sections 1, 7 and 10, read as a document): each image
// record names its product in `featuredProductIds`, "(and variant, where only some colours show)"; the engine "limits
// the carousel to the images of the product on the page".
//
// THE REPRESENTATION THIS FILE RULES:
//   · The declaration: `scope: 'anchor'` on a content slot of the slots document (beside `take` and `weights`). P31's
//     rule stands: a page-asserted ctx signal gates no module; a slot DECLARED scoped withholds candidates by the
//     anchor the request names, and no other slot reads it so.
//   · The signals (AS3): the anchor is `ctx.anchor` (the master product: P79's `HydrateOptions.productId`) and the
//     variant is `ctx.variant` (P79's `HydrateOptions.variantId`), on the GET snapshot's query string as today and as
//     the same `ctx.<name>` keys, flat strings, in the POST body, under the GET's bounds (src/routes/decisions.ts: a
//     name /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, a value of 1 to 64 characters, at most 8 signals). The SDK sends them on
//     its decision request (the POST `core.getJson` sends) and on a new browser's first request (P13), only when the
//     page view names them; nothing else of the request changes. R-P264: with a session, a POST whose signals break the
//     bounds is answered as the GET is (400 and the GET's error, a value over 128 characters included); on a new
//     browser's first request (no session) the signals are checked with P13's other first-request checks BEFORE the
//     session is issued, and any failure is the same 401 writing nothing (no session, no shopper object, no key).
//   · THE MATCHING RULE: an item whose `featuredProductIds` names the anchor and nothing else is a candidate for every
//     variant; an item that names the anchor and other identifiers (a colour-specific image: the master with its
//     variant beside it) is a candidate only when the request names one of those identifiers as `ctx.variant`; an
//     item that does not name the anchor (another product, no product, a product the catalogue does not carry) is
//     never a candidate, on any arm. A request that names no `ctx.anchor` (a `ctx.variant` alone included), or whose
//     anchor no item names, decides the scoped slot empty: the page keeps its default. The witness does not determine
//     an item that names two different masters; no unit here fixes it.
//   · The record and the receipt (AS2): every decision of a scoped slot carries `explain.scope: { anchor, variant? }`
//     (the signals the scope read; keys sorted), and its receipt carries `scope` exactly as the record does, with a
//     `why` sentence that names the anchor; the record's page-level inputs carry the request's signals as
//     `inputs.anchor` and `inputs.variant` (as P31's `inputs.nothing_to_show`), so the replay reproduces the candidates
//     (classification `equal`).
//   · "Only withhold, never add or boost": what the scoped slot serves is, in order and with its scores, a
//     subsequence of what the same slot unscoped serves the same shopper.
//
// FIXTURE. The Coach catalogue (src/data/coach-catalog.json): the anchor COA-CH857 (Tabby Shoulder Bag 26, Handbags)
// with its colours Black and Chalk as variants COA-CH857-BLACK and COA-CH857-CHALK (and COA-CH857-RED, a variant no
// image names); COA-CB925 (Tabby Wallet With Chain, Small Leather Goods: another category) and COA-CW620 (Tabby
// Shoulder Bag 26 With Quilting, a product no image names); COA-ZZ999 (a product the catalogue does not carry). The
// carousel's images (shot tags as the carousel note's section 10 names them): two master images of COA-CH857, one
// Black and one Chalk detail image, one image of COA-CB925, one brand image naming no product, one image of
// COA-ZZ999. The shopper viewed the wallet three times, so the wallet's image (Small Leather Goods) would win on
// score. The product page's layout slot (P02) and an unscoped slot with a complements rule stand beside the carousel.
//
// R10: no existing test pins what P80 changes (searched: no test posts a ctx. key in the snapshot body; the kit
// sentences at kit 03 :236-237 and kit 02 :794 are read by no test; P39 and src/content/complements.test.ts read
// ctx.anchor through the GET and an unscoped complements slot, both kept by AS4's lock).
//
// NO NEW EXPORT IS IMPORTED: `scope`, `explain.scope`, `inputs.anchor`, `inputs.variant` and the receipt's `scope`
// are read loosely.
//
// MEASURED at 2641ede2 (P79's join merged; _evidence/parity-step3/S21/specifier/logs/, serial, --no-cache, working
// directory the tree): 19 RED for the missing behaviour (every image a candidate of the declared carousel, on both arms;
// no empty list without an anchor; no scope on the record or the receipt; the POST refusing a ctx. key, 401 "Shopper
// session unavailable", where the GET answers 400; the SDK sending neither signal; the kit silent); AS4's two locks
// GREEN on both hosts.
// NEGATIVE CONTROLS (scratch trees, never committed; _evidence/parity-step3/S21/specifier/sketches/p80.py): the fix
// turns all 23 GREEN three times and keeps P04, P13, P15, P26, P30, P31, P34, P39, P60, P68, P79, src/content/
// complements, decide and kinds tests, src/learn/receipts.test.ts, src/middleware/edgeAccess.test.ts,
// src/demos/kit/root.test.ts, src/sdk/*.test.ts, src/routes/realtime.sdkContract.test.ts and src/index.api-boundary.test.ts
// green, its SDK bundles rebuilt within their budget; `signalgate` (the filter on every slot whenever an anchor is named)
// turns AS4's complements and P31 locks RED; `noanchorall` (no anchor: every candidate) turns AS2's empty list RED;
// `novariant` (the variant ignored) turns AS1 and AS3's scoped answers RED; `getonly` (the POST still refusing ctx keys)
// turns AS3's POST, bounds and SDK legs RED; `nosdk` (the SDK sending nothing) turns AS3's SDK legs RED; `boost` (the
// scope also adds to an in-scope piece's score) turns AS4's only-withholds lock RED.
// R-P264 (the S21 spec review): the fix sketch now checks the POST's signals in the request's own context checks, so a
// new browser's first request that breaks them is refused 401 before its session is issued, and with a session they
// answer the GET's 400 (a value over 128 characters included). Measured (_evidence/parity-step3/S21/specifier/logs/r264/):
// the first-request leg GREEN on today's product (2641ede2) and under the fix; `oldbounds` (the first sketch, the bounds
// checked after the session is issued) and the P80 build befce139 turn it RED (400 with a shopper object and a key
// written) and the with-session leg RED at 129 characters (401); P13, P34, P54, P57, P60, P79, W16 and
// src/middleware/edgeAccess.test.ts green on today's product and under the fix.
//
// HARNESS: src/units/_parity.ts (the mounted application, both hosts), src/sdk/testHost.ts (the SDK legs). Imports
// from src/units/: ../_parity.

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { DecisionRecord } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { identityRoutes } from '@/routes/identity';
import { createCore } from '@/sdk/core';
import { createListen, type HydrateOptions } from '@/sdk/listen';
import { memoryHost } from '@/sdk/memoryHost';
import { authorityLocks, syntheticSession, testHost } from '@/sdk/testHost';
import type { RequestInitLike, ResponseLike } from '@/sdk/types';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

import {
  BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, MODULES, mount, pageInstanceOf, readTree, receiptsOf,
  replayOf, servedIn, shopperOn, storedDecisions, TENANT, VIEW_TABBY_WALLET, type Decision, type Mounted, type Shopper, type Snapshot,
} from '../_parity';

const CAROUSEL = 'pdp-carousel', COMPLETE = 'pdp-complete-the-look';
const A = 'COA-CH857', B = 'COA-CB925', UNNAMED = 'COA-CW620', UNKNOWN = 'COA-ZZ999';
const BLACK = 'COA-CH857-BLACK', CHALK = 'COA-CH857-CHALK', RED = 'COA-CH857-RED';

const image = (id: string, products: string[] | undefined, category: string, shot: string) => ({ id, customerContentId: `TAP-${id.toUpperCase()}`,
  type: shot, title: `${id} (${shot})`, tags: { category: [category], line: ['Tabby'], shot: [shot] }, slotTypes: [CAROUSEL], lifecycle: { status: 'live' },
  ...(products ? { featuredProductIds: products } : {}) });
/** The carousel's images, in catalogue order (the default arm's order). */
const IMAGES = [
  image('img-cb925-1', [B], 'Small Leather Goods', 'on-model'),
  image('img-brand-1', undefined, 'Small Leather Goods', 'flat-lay'),
  image('img-ch857-1', [A], 'Handbags', 'on-model'),
  image('img-ch857-2', [A], 'Handbags', 'studio'),
  image('img-ch857-black-3', [A, BLACK], 'Handbags', 'detail'),
  image('img-ch857-chalk-4', [A, CHALK], 'Handbags', 'detail'),
  image('img-zz999-1', [UNKNOWN], 'Small Leather Goods', 'on-model'),
];
/** The complements slot's pieces: one completes the anchor, one completes the wallet. */
const LOOKS = [
  { id: 'look.tabby.strap', customerContentId: 'TAP-LOOK-STRAP', type: 'editorial', title: 'A strap for the Tabby', tags: { category: ['Accessories'] },
    slotTypes: [COMPLETE], lifecycle: { status: 'live' }, complements: [A] },
  { id: 'look.wallet.charm', customerContentId: 'TAP-LOOK-CHARM', type: 'editorial', title: 'A charm for the wallet', tags: { category: ['Accessories'] },
    slotTypes: [COMPLETE], lifecycle: { status: 'live' }, complements: [B] },
];
const carouselSlot = (scoped: boolean) => ({ slot: CAROUSEL, take: IMAGES.length, weights: { category: 1, line: 0.5 }, ...(scoped ? { scope: 'anchor' } : {}) });
const completeSlot = { slot: COMPLETE, take: 2, weights: { category: 1 }, complements: { weight: 1 } };
const learn = (extra: Record<string, unknown> = {}) => learnDocument({ [CAROUSEL]: { measurementBasis: 'rendered-v1', reward: 'click' } }, extra);
const documents = (scoped = true, extra: Record<string, unknown> = {}) => ({ pieces: [...MODULES, ...IMAGES, ...LOOKS],
  slots: declaredSlots([layoutSlot(), carouselSlot(scoped), completeSlot]), learn: learn(extra) });
/** Every shopper on the holdout's default arm. */
const HOLDOUT = { holdout: { share: 1, salt: 'p80-default-arm', arms: ['default'] } };

/** The candidates the matching rule admits for each request, sorted. */
const MASTER = ['img-ch857-1', 'img-ch857-2'];
const CASES: Array<{ name: string; signals: Record<string, string>; candidates: string[] }> = [
  { name: 'the anchor and its Black variant', signals: { anchor: A, variant: BLACK }, candidates: [...MASTER, 'img-ch857-black-3'].sort() },
  { name: 'the anchor alone', signals: { anchor: A }, candidates: MASTER },
  { name: 'the anchor and its Chalk variant', signals: { anchor: A, variant: CHALK }, candidates: [...MASTER, 'img-ch857-chalk-4'].sort() },
  { name: 'the anchor and a variant no image names', signals: { anchor: A, variant: RED }, candidates: MASTER },
  { name: 'the wallet as the anchor', signals: { anchor: B }, candidates: ['img-cb925-1'] },
];

// ===========================================================================
// The host harness: the decision route, as the page and the SDK call it.
// ===========================================================================

/** A shopper who viewed the wallet three times, so the wallet's image would win on score. */
async function walletShopper(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  for (let i = 0; i < 3; i++) expect((await s.action(VIEW_TABBY_WALLET)).status, `PRECONDITION (${m.host}): the wallet view is accepted`).toBe(200);
  return s;
}
const query = (signals: Record<string, string>) => Object.entries(signals).map(([name, value]) => `&ctx.${name}=${encodeURIComponent(value)}`).join('');
const answered = async (m: Mounted, response: Response, pageInstance?: string): Promise<Snapshot> => {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body, page: 'pdp', ...(pageInstance ? { pageInstance } : {}), decisions: (body.decisions ?? []) as Decision[] };
};
/** The GET snapshot with the page's ctx signals on its query string (admitted today). */
async function getSnapshot(m: Mounted, s: Shopper, signals: Record<string, string>, label: string): Promise<Snapshot> {
  const pageInstance = pageInstanceOf(label);
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot?page=pdp&brand=${BRAND}&pageInstance=${pageInstance}${query(signals)}`,
    { method: 'GET', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability } }));
  return answered(m, response, pageInstance);
}
/** The POST snapshot (the SDK's form) with the page's ctx signals as `ctx.<name>` keys of its body; no session for a new browser's first request. */
async function postSnapshot(m: Mounted, capability: string | null, signals: Record<string, string>, label: string): Promise<Snapshot> {
  const pageInstance = pageInstanceOf(label);
  const body = { page: 'pdp', brand: BRAND, pageInstance, ...Object.fromEntries(Object.entries(signals).map(([name, value]) => [`ctx.${name}`, value])) };
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...(capability ? { [SHOPPER_HEADER]: capability } : {}) }, body: JSON.stringify(body) }));
  return answered(m, response, pageInstance);
}
const carousel = (snapshot: Snapshot) => servedIn(snapshot, CAROUSEL);
/** Signals outside the GET's bounds (src/routes/decisions.ts: a name /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, a value of 1 to 64 characters, at most 8). */
const OUT_OF_BOUNDS: Array<[string, Record<string, string>]> = [
  ['a value over 64 characters', { anchor: 'X'.repeat(65) }],
  ['a value over 128 characters', { anchor: 'X'.repeat(129) }],
  ['a bad name', { '9bad': 'v' }],
  ['nine signals', Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`signal${i}`, 'yes']))],
];
const sorted = (ids: string[]) => [...ids].sort();
const refusal = (snapshot: Snapshot) => `${snapshot.status} ${JSON.stringify(snapshot.body).slice(0, 160)}`;

/** The identity routes, mounted as src/index.ts mounts them, beside the parity app (src/units/_parity5.ts's form). */
const identityApp = new Hono<{ Bindings: Env }>();
identityApp.use('*', tenantMiddleware());
identityApp.route('/v1', identityRoutes);
/** The SDK (createCore, createListen) over the mounted application, under the shopper's own session and choice (P79's harness). */
async function sdkOn(m: Mounted, s: Shopper) {
  const host = memoryHost({ acquireAuthorityLock: authorityLocks(), uuid: () => crypto.randomUUID(), now: () => Date.now(),
    fetch: async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
      const target = new URL(url);
      const request = new Request(`https://shop.invalid${target.pathname}${target.search}`, { method: init?.method ?? 'GET',
        headers: { ...(init?.headers ?? {}), 'X-Tenant': TENANT, [SHOPPER_HEADER]: init?.headers?.[SHOPPER_HEADER] ?? s.grant.capability },
        ...(init?.body === undefined ? {} : { body: init.body }) });
      const pending: Promise<unknown>[] = [];
      const response = target.pathname.includes('/identity/')
        ? await identityApp.fetch(request, m.env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext)
        : await m.fetch(request);
      const json = await response.json().catch(() => ({})) as Record<string, unknown>;
      while (pending.length) await Promise.all(pending.splice(0));
      await m.drain();
      return { ok: response.ok, status: response.status, json: async () => json };
    } });
  const core = createCore({ tenant: TENANT, endpoint: 'https://shop.invalid', source: 'sdk', brand: BRAND }, host);
  const listen = createListen(core);
  expect(await core.ready(), `PRECONDITION (${m.host}): the SDK holds the shopper's session`).toBe(true);
  return { core, listen, destroy: () => { listen.destroy(); core.disconnect(); } };
}
/** A product page view's options as P79 rules them (`productId`, `variantId`), cast so this file compiles on any product. */
const view = (productId?: string, variantId?: string, extra: Record<string, unknown> = {}): HydrateOptions =>
  ({ page: 'pdp', ...extra, ...(productId === undefined ? {} : { productId }), ...(variantId === undefined ? {} : { variantId }) }) as unknown as HydrateOptions;

// ===========================================================================
// unit:P80.AS1 — a scoped slot's candidates are only the anchor's items
// ===========================================================================

describe('unit:P80.AS1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on a carousel declared scope: 'anchor', each request's candidates are only the images whose featuredProductIds names the anchor (master images for every variant; a colour image only for its own variant); the wallet's image, which would win on score, the brand image and the unknown product's image are never served on the anchor's page`, async () => {
      const m = await mount(host, documents());
      expectPublished(m, 'P80.AS1 — the carousel declared scoped publishes');
      const reference = await mount(host, documents(false));
      expectPublished(reference, 'P80.AS1 — the same carousel unscoped publishes');
      const r = await walletShopper(reference);
      const unscoped = await getSnapshot(reference, r, { anchor: A, variant: BLACK }, 'p80-as1-reference');
      expect(carousel(unscoped)[0], `${host}: PRECONDITION — unscoped, the wallet's image wins on score for this shopper`).toBe('img-cb925-1');
      const s = await walletShopper(m);
      const served: Array<[string, unknown]> = [];
      for (const c of CASES) {
        const page = await getSnapshot(m, s, c.signals, 'p80-as1');
        expect(page.status, `${host}: PRECONDITION — ${c.name}: the decision request is answered (${refusal(page)})`).toBe(200);
        served.push([c.name, sorted(carousel(page))]);
      }
      expect.soft(served, `${host}: P80.AS1 — each request's scoped carousel serves only the images of the anchor the request names (today every image is a candidate: the anchor is only a preference)`)
        .toEqual(CASES.map(c => [c.name, c.candidates]));
    }, 120_000);

    it(`host (${host}): on the holdout's default arm too, the scoped carousel's candidates are only the anchor's images: another product's image is never a candidate on any arm`, async () => {
      const m = await mount(host, documents(true, HOLDOUT));
      expectPublished(m, 'P80.AS1 — the carousel declared scoped publishes with every shopper on the default arm');
      const s = await walletShopper(m);
      const page = await getSnapshot(m, s, { anchor: A, variant: BLACK }, 'p80-as1-default');
      expect([page.status, page.body.arm], `${host}: PRECONDITION — the shopper is decided on the default arm (${refusal(page)})`).toEqual([200, 'default']);
      expect.soft(sorted(carousel(page)), `${host}: P80.AS1 — on the default arm the scoped carousel serves only the anchor's Black images`).toEqual(CASES[0]!.candidates);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P80.AS2 — no anchor: the empty list; the record and the receipt name the scope
// ===========================================================================

describe('unit:P80.AS2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a scoped carousel on a request that names no anchor (nothing, or a variant alone), or an anchor no image names (COA-CW620), is decided empty so the page keeps its default, while the page's other slots are served`, async () => {
      const m = await mount(host, documents());
      expectPublished(m, 'P80.AS2 — the carousel declared scoped publishes');
      const s = await walletShopper(m);
      const cases: Array<[string, Record<string, string>]> = [['no anchor', {}], ['a variant alone', { variant: BLACK }], ['an anchor no image names', { anchor: UNNAMED }]];
      const served: Array<[string, string[]]> = [];
      for (const [name, signals] of cases) {
        const page = await getSnapshot(m, s, signals, 'p80-as2-empty');
        expect([page.status, servedIn(page, LAYOUT).length > 0], `${host}: PRECONDITION — ${name}: the page is answered with its layout (${refusal(page)})`).toEqual([200, true]);
        served.push([name, carousel(page)]);
      }
      expect.soft(served, `${host}: P80.AS2 — the scoped carousel is decided empty: the page keeps its default (today every image is served)`)
        .toEqual(cases.map(([name]) => [name, []]));
    }, 120_000);

    it(`host (${host}): every record of the scoped carousel carries explain.scope { anchor, variant } and the request's signals as inputs.anchor and inputs.variant, its receipt carries the same scope with a why naming the anchor, and each record replays equal`, async () => {
      const m = await mount(host, documents());
      expectPublished(m, 'P80.AS2 — the carousel declared scoped publishes');
      const s = await walletShopper(m);
      const page = await getSnapshot(m, s, { anchor: A, variant: BLACK }, 'p80-as2-records');
      const images = page.decisions.filter(d => d.slot === CAROUSEL);
      expect(images.length, `${host}: PRECONDITION — the carousel is served (${refusal(page)})`).toBeGreaterThan(0);
      for (const d of images) expect((await s.ack(page, d)).status, `${host}: PRECONDITION — ${d.contentId} is acknowledged`).toBe(200);
      await m.drainLedger();
      const records = storedDecisions(m, s.subject).filter((r: DecisionRecord) => r.slot === CAROUSEL);
      expect(records.length, `${host}: PRECONDITION — the carousel's records are stored`).toBe(images.length);
      const scope = { anchor: A, variant: BLACK };
      expect.soft(records.map(r => [r.item_id, (r.explain as unknown as Record<string, unknown>).scope ?? null,
        (r.inputs as Record<string, unknown> | undefined)?.anchor ?? null, (r.inputs as Record<string, unknown> | undefined)?.variant ?? null]),
      `${host}: P80.AS2 — each record names the scope and the anchor it read`).toEqual(records.map(r => [r.item_id, scope, A, BLACK]));
      const receipts = (await receiptsOf(m, s.subject)).filter(x => x.slot === CAROUSEL);
      expect.soft(receipts.map(x => [x.item, x.scope ?? null, ((x.why ?? []) as string[]).some(w => w.includes(A)) ? 'a why names the anchor' : 'no why names the anchor']),
        `${host}: P80.AS2 — each receipt names the scope as the record does, and why`).toEqual(receipts.map(x => [x.item, scope, 'a why names the anchor']));
      const replays: unknown[][] = [];
      for (const r of records) { const replay = await replayOf(m, r.decision_id); replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
      expect.soft(replays, `${host}: P80.AS2 — each scoped decision replays equal`).toEqual(records.map(r => [r.item_id, 200, 'equal']));
    }, 120_000);
  }
});

// ===========================================================================
// unit:P80.AS3 — the SDK sends the anchor and the variant; the POST admits them
// ===========================================================================

/** The SDK on the test host with a fake engine that answers every decision request with an empty set and records its body. */
function sdkPage() {
  const f = testHost();
  const bodies: Array<Record<string, unknown>> = [];
  const passthrough = f.host.fetch;
  f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
    if (!url.includes('/decisions/snapshot')) return passthrough(url, init);
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    bodies.push(body);
    const answer = { ok: true, page: body.page, pageInstance: body.pageInstance, arm: 'personalized', decisions: [],
      ...(init?.headers?.[SHOPPER_HEADER] ? {} : { session: syntheticSession(f.host.now()) }) };
    return { ok: true, status: 200, json: async () => answer };
  };
  const core = createCore({ tenant: TENANT, source: 'coach-pdp', brand: BRAND }, f.host);
  const listen = createListen(core);
  return { f, core, listen, bodies, destroy: () => { listen.destroy(); core.disconnect(); } };
}
/** A request body without what differs between page views of one browser (the page instance). */
const lasting = (body: Record<string, unknown> | undefined) => { const { pageInstance: _instance, ...rest } = body ?? {}; void _instance; return rest; };

describe('unit:P80.AS3', () => {
  it('sdk: a page view opened with productId and variantId sends them as ctx.anchor and ctx.variant on its decision request, one with productId alone sends ctx.anchor alone, and nothing else of the request changes (the page, the brand, the channel, P31\'s nothingToShow report)', async () => {
    const p = sdkPage();
    expect(await p.core.ready(), 'PRECONDITION: the browser holds its session').toBe(true);
    const report = { channel: 'email', nothingToShow: ['module.PDP.reviews.1'] };
    await p.listen.refresh(view(undefined, undefined, report));
    await p.listen.refresh(view(A, BLACK, report));
    await p.listen.refresh(view(B, undefined, report));
    expect(p.bodies.length, 'PRECONDITION: three decision requests').toBe(3);
    const [plain, black, wallet] = p.bodies.map(lasting);
    expect.soft([black, wallet], 'P80.AS3 — the product page views\' requests are the plain page view\'s with ctx.anchor (and ctx.variant) added')
      .toEqual([{ ...plain, 'ctx.anchor': A, 'ctx.variant': BLACK }, { ...plain, 'ctx.anchor': B }]);
    p.destroy();
  });

  it('sdk: on a new browser (no session, P13\'s first request), the first decision request of a product page view carries ctx.anchor and ctx.variant beside what it carries today', async () => {
    const plain = sdkPage(), product = sdkPage();
    await plain.listen.hydrate(view());
    await product.listen.hydrate(view(A, BLACK));
    const sessionCalls = [plain, product].map(x => x.f.calls.filter(c => c.url.endsWith('/identity/session')).length);
    expect([plain.bodies.length, product.bodies.length, ...sessionCalls], 'PRECONDITION: each browser\'s first and only call is the decision request (P13)').toEqual([1, 1, 0, 0]);
    expect.soft(lasting(product.bodies[0]), 'P80.AS3 — the first request carries the anchor and the variant').toEqual({ ...lasting(plain.bodies[0]), 'ctx.anchor': A, 'ctx.variant': BLACK });
    plain.destroy(); product.destroy();
  });

  for (const host of HOSTS) {
    it(`host (${host}): the POST snapshot (the SDK's form) admits ctx.anchor and ctx.variant in its body: with the shopper's session, and as a new browser's first request (no session), the request is answered and the scoped carousel serves the anchor's Black images`, async () => {
      const m = await mount(host, documents());
      expectPublished(m, 'P80.AS3 — the carousel declared scoped publishes');
      const s = await walletShopper(m);
      const withSession = await postSnapshot(m, s.grant.capability, { anchor: A, variant: BLACK }, 'p80-as3-post');
      const first = await postSnapshot(m, null, { anchor: A, variant: BLACK }, 'p80-as3-first');
      expect.soft([withSession.status, sorted(carousel(withSession))], `${host}: P80.AS3 — the POST with the session admits the signals (answered ${refusal(withSession)})`)
        .toEqual([200, CASES[0]!.candidates]);
      expect.soft([first.status, typeof (first.body.session as { capability?: unknown } | undefined)?.capability, sorted(carousel(first))],
        `${host}: P80.AS3 — a new browser's first POST admits the signals and is issued its session (answered ${refusal(first)})`).toEqual([200, 'string', CASES[0]!.candidates]);
    }, 120_000);

    it(`host (${host}): the POST body's ctx signals are bounded as the GET's: a value over 64 characters, one over 128, a bad name and a ninth signal are refused with the GET's status and error`, async () => {
      const m = await mount(host, documents());
      expectPublished(m, 'P80.AS3 — the carousel declared scoped publishes');
      const s = await walletShopper(m);
      const answers: Array<[string, string, string]> = [];
      for (const [name, signals] of OUT_OF_BOUNDS) {
        const viaGet = await getSnapshot(m, s, signals, 'p80-as3-bound-get'), viaPost = await postSnapshot(m, s.grant.capability, signals, 'p80-as3-bound-post');
        expect(viaGet.status, `${host}: PRECONDITION — ${name}: the GET refuses it (${refusal(viaGet)})`).toBe(400);
        answers.push([name, `${viaGet.status} ${String(viaGet.body.error)}`, `${viaPost.status} ${String(viaPost.body.error)}`]);
      }
      expect.soft(answers.map(([name, , post]) => [name, post]), `${host}: P80.AS3 — the POST refuses as the GET does`).toEqual(answers.map(([name, get]) => [name, get]));
    }, 120_000);

    it(`host (${host}): R-P264 — a new browser's first POST (no session) whose ctx signals break the bounds (a value over 64 characters, a bad name, nine signals) is refused exactly as any other refused first request is, 401, writing nothing: no session, no shopper object, no key, nothing queued (P13's first-request rule)`, async () => {
      const m = await mount(host, documents());
      expectPublished(m, 'P80.AS3 — the carousel declared scoped publishes');
      const sessions = () => (m.env.SESSIONS as unknown as { data: Map<string, unknown> }).data.size;
      const keys = () => [...m.shoppers.values()].reduce((n, r) => n + r.data.size, 0);
      const firstPost = async (fields: Record<string, string>) => {
        const before = [sessions(), m.shoppers.size, keys(), m.queued.length];
        const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST', headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p80-as3-first-bounds'), ...fields }) }));
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        await m.drain();
        const after = [sessions(), m.shoppers.size, keys(), m.queued.length];
        return { answer: `${response.status} ${String(body.error)}`, written: after.map((n, i) => n - before[i]!) };
      };
      // The control: a first request refused by P13's own checks (a selector the body may not carry).
      const control = await firstPost({ userId: 'vis-00000000-0000-4000-8000-000000000000' });
      expect([control.answer.startsWith('401'), control.written], `${host}: PRECONDITION — a refused first request is a 401 writing nothing (${control.answer})`).toEqual([true, [0, 0, 0, 0]]);
      const rows: Array<[string, string, number[]]> = [];
      for (const [name, signals] of OUT_OF_BOUNDS.filter(([name]) => name !== 'a value over 128 characters')) {
        const refused = await firstPost(Object.fromEntries(Object.entries(signals).map(([key, value]) => [`ctx.${key}`, value])));
        rows.push([name, refused.answer, refused.written]);
      }
      expect.soft(rows, `${host}: P80.AS3 — each is refused as the control is, before anything is written (sessions, shopper objects, keys, queued: +0)`)
        .toEqual(rows.map(([name]) => [name, control.answer, [0, 0, 0, 0]]));
    }, 120_000);

    it(`host (${host}): the SDK over the mounted application, a product page view opened with refresh({ page: 'pdp', productId: 'COA-CH857', variantId: 'COA-CH857-BLACK' }), is delivered the scoped carousel: the anchor's Black images only`, async () => {
      const m = await mount(host, documents());
      expectPublished(m, 'P80.AS3 — the carousel declared scoped publishes');
      const s = await walletShopper(m);
      const sdk = await sdkOn(m, s);
      try {
        const set = await sdk.listen.refresh(view(A, BLACK));
        expect(set, `${m.host}: PRECONDITION — the page view is answered`).toBeTruthy();
        expect.soft(sorted((set?.decisions ?? []).filter(d => d.slot === CAROUSEL).map(d => d.contentId)),
          `${host}: P80.AS3 — the SDK sends the page's product and variant, and the carousel is scoped to them (today the SDK sends neither)`).toEqual(CASES[0]!.candidates);
      } finally { sdk.destroy(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P80.AS4 — locks, and the kit
// ===========================================================================

/** Whether `inner` is, in order and with its rounded scores, a subsequence of `outer`. */
function subsequence(inner: Decision[], outer: Decision[]): string {
  const key = (d: Decision) => `${d.contentId}@${Math.round((d.score ?? 0) * 100) / 100}`;
  const keys = outer.map(key);
  let at = 0;
  for (const d of inner) { const found = keys.indexOf(key(d), at); if (found < 0) return `not a subsequence: ${key(d)} (unscoped: ${keys.join(', ')})`; at = found + 1; }
  return 'a subsequence of the unscoped ranking, scores unchanged';
}

describe('unit:P80.AS4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — the scope only withholds: for each request, what the scoped carousel serves is, in order and with its scores, a subsequence of what the same carousel unscoped serves the same shopper`, async () => {
      const m = await mount(host, documents()), reference = await mount(host, documents(false));
      expectPublished(m, 'P80.AS4 — the carousel declared scoped publishes');
      expectPublished(reference, 'P80.AS4 — the same carousel unscoped publishes');
      const s = await walletShopper(m), r = await walletShopper(reference);
      const verdicts: Array<[string, string]> = [];
      for (const c of CASES) {
        const scoped = (await getSnapshot(m, s, c.signals, 'p80-as4-scoped')).decisions.filter(d => d.slot === CAROUSEL).sort((a, b) => a.order - b.order);
        const unscoped = (await getSnapshot(reference, r, c.signals, 'p80-as4-unscoped')).decisions.filter(d => d.slot === CAROUSEL).sort((a, b) => a.order - b.order);
        verdicts.push([c.name, subsequence(scoped, unscoped)]);
      }
      expect.soft(verdicts, `${host}: P80.AS4 — the scope adds and boosts nothing`).toEqual(CASES.map(c => [c.name, 'a subsequence of the unscoped ranking, scores unchanged']));
    }, 120_000);

    it(`host (${host}): LOCK — the complements preference on an unscoped slot is unchanged, and a page-asserted ctx signal gates no module of an unscoped slot (P31): with ctx.anchor=COA-CH857 the strap that completes it leads its slot with a completes driver, the charm is still served, and the layout is the one served without the signal`, async () => {
      const m = await mount(host, documents());
      expectPublished(m, 'P80.AS4 — the page publishes');
      const s = await walletShopper(m);
      const anchored = await getSnapshot(m, s, { anchor: A, variant: BLACK }, 'p80-as4-complements');
      const plain = await getSnapshot(m, s, {}, 'p80-as4-plain');
      const looks = anchored.decisions.filter(d => d.slot === COMPLETE).sort((a, b) => a.order - b.order);
      expect.soft([looks.map(d => d.contentId), looks[0]?.explain?.drivers?.find(x => x.dim === 'completes')?.value ?? null],
        `${host}: P80.AS4 — the complements slot prefers the strap that completes the anchor and withholds nothing`).toEqual([['look.tabby.strap', 'look.wallet.charm'], A]);
      expect.soft(servedIn(anchored, LAYOUT), `${host}: P80.AS4 — the layout is the same with and without the signal (P31)`).toEqual(servedIn(plain, LAYOUT));
    }, 120_000);
  }

  /** The paragraph of a document that holds `opening`, joined to one line. */
  const paragraphOf = (file: string, opening: RegExp): string => {
    const lines = readTree(file).split('\n'), at = lines.findIndex(l => opening.test(l));
    expect(at, `PRECONDITION: ${file} holds the passage ${opening}`).toBeGreaterThanOrEqual(0);
    let first = at, last = at;
    while (first > 0 && lines[first - 1]!.trim() !== '') first--;
    while (last < lines.length - 1 && lines[last + 1]!.trim() !== '') last++;
    return lines.slice(first, last + 1).join(' ');
  };
  const sentences = (text: string): string[] => text.split(/(?<=[.;])\s+(?=[A-Z`*(])/).map(x => x.trim()).filter(Boolean);
  /** What a passage says of the scoped slot. */
  const scopeStated = (text: string): string[] => [
    /`scope`|scope: 'anchor'/.test(text) ? 'names the scope declaration' : 'names no scope declaration (`scope`)',
    /ctx\.anchor/.test(text) ? 'names ctx.anchor' : 'names no ctx.anchor',
    /ctx\.variant/.test(text) ? 'names ctx.variant' : 'names no ctx.variant',
  ];

  it('logic: kit 03\'s featuredProductIds row (:236) names the scoped slot (`scope`), the anchor (ctx.anchor) and the variant (ctx.variant), and no longer says the link does "nothing more"', () => {
    const row = readTree('docs/kit/03-payload-schemas.md').split('\n').find(l => l.startsWith('| `featuredProductIds` |'));
    expect(row, 'PRECONDITION: kit 03 carries the featuredProductIds row').toBeTruthy();
    expect.soft([...scopeStated(row!), /nothing more/.test(row!) ? 'still says "nothing more"' : 'no "nothing more"'], 'P80.AS4 — kit 03 states the scope where it states the product link')
      .toEqual(['names the scope declaration', 'names ctx.anchor', 'names ctx.variant', 'no "nothing more"']);
  });

  it('logic: kit 02\'s sentence that a page-asserted ctx. signal gates no module (:794) names the scoped slot as its one exception, in that sentence or the next', () => {
    const said = sentences(paragraphOf('docs/kit/02-api-reference.md', /gates no module|gates no/));
    const at = said.findIndex(x => /gates no module/.test(x));
    expect(at, 'PRECONDITION: kit 02 still says a ctx. signal gates no module (P31)').toBeGreaterThanOrEqual(0);
    const near = said.slice(at, at + 2).join(' ');
    expect.soft([/scope/i.test(near) ? 'names the scope' : 'names no scope', /anchor/.test(near) ? 'names the anchor' : 'names no anchor'], 'P80.AS4 — kit 02 names the scope as the exception')
      .toEqual(['names the scope', 'names the anchor']);
  });

  it('logic: kit 02\'s content and configuration documents (section 4) state the scoped slot: `scope`, the product link it reads (featuredProductIds), the signals (ctx.anchor, ctx.variant) and the empty list when no anchor is named', () => {
    const text = readTree('docs/kit/02-api-reference.md'), start = text.indexOf('\n## 4. '), end = text.indexOf('\n## ', start + 1);
    expect(start, 'PRECONDITION: kit 02 has its section 4').toBeGreaterThanOrEqual(0);
    const paragraphs = text.slice(start, end < 0 ? undefined : end).split(/\n\s*\n/).map(x => x.split('\n').join(' '));
    const stated = paragraphs.find(x => /`scope`|scope: 'anchor'/.test(x) && /featuredProductIds/.test(x) && /ctx\.anchor/.test(x));
    expect.soft(stated === undefined ? ['no paragraph names `scope`, featuredProductIds and ctx.anchor'] : [...scopeStated(stated),
      /empty|\[\]|default/.test(stated) ? 'states the empty list when no anchor' : 'states nothing of a request without an anchor'],
    'P80.AS4 — kit 02 documents the scoped slot').toEqual(['names the scope declaration', 'names ctx.anchor', 'names ctx.variant', 'states the empty list when no anchor']);
  });
});
