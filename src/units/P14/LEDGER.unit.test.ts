// src/units/P14/LEDGER.unit.test.ts
// P14 under the Closure Ledger: the tests for the LOCAL criteria of the P14 work
// order (`tapestry-parity-build`, ticket P14 "Action weights per product type").
// DC1 (D1) and DC2 (D2) are ruled below and exercised in J1-J3; LV1 and LV2 are
// deferred live rows and get no test.
//
// One `describe('unit:P14.<criterion>')` per LOCAL criterion. Expected values
// come from the witnesses, never from what the engine answers today:
//   · the work order's authority (docs/BTI-Parity-Build-Tickets.md, P14 in
//     section B): "an action's weight can differ by product type, is configured
//     without a deployment and is itemized on the receipt";
//   · the parity document, section 5 row B11 (cited by number only): an add to
//     cart for a purse counting differently from an add to cart for a trinket;
//   · freeze sheet items 26 (D1: product type is the value of one
//     tenant-declared dimension on the event; D2: the weight is itemised on the
//     event's interest update) and 49 (the population trend an event feeds keeps
//     the action's own weight; only the shopper's interest update takes the
//     product-type weight);
//   · the existing contract the work order cites: src/reflex/core.ts:567-574
//     (one weight per action: R ← R·e^(−Δt/τ) + w), src/reflex/configStore.ts:343-355
//     (weights 0..1000), public/console/views-config.js:141-185 (the interests
//     screen, in force without a deployment), the hosts' interest update
//     (src/services/RealtimeSegmentEngine.ts, src/durable-objects/ShopperReflex.ts).
//
// THE READINGS THIS FILE RULES:
//   DOCUMENT (D1). The reflex document carries `productTypeWeights: { dimension,
//     weights: { [action]: { [value]: w } } }`: `dimension` is the key of one
//     registry dimension; an event's product type is the raw value the event
//     carries on that dimension's source field; `w` is 0..1000. The validator
//     refuses, naming `productTypeWeights`, a weight outside 0..1000 or not a
//     number and a dimension the registry does not declare. An event of an
//     action with a weight for its product type accumulates `w` in place of the
//     action's own weight on every interest it touches; an event on another
//     value, or with no value on the dimension, accumulates the action's own.
//   ITEMISED (D2). The interest update the action route returns on both hosts
//     carries `update.data.affinity.applied = { action, dimension, productType,
//     weight }` — `productType` null when the event has no value on the
//     dimension, `weight` the one the step accumulated.
//   TREND (item 49). The frame the host sends to the population trend
//     (`fanInRegionTrend`, the REGION_TREND ingest door) keeps `w` = the action's
//     own weight; it is observed at that door, which the stamp binds.
//   CONSOLE. The interests screen shows the dimension and one weight control per
//     declared (action, value), focus key `ptw:<action>:<value>`; a save publishes
//     the revision, in force without a deployment (unit:W20.R2's idiom).
//
// NO NEW EXPORT IS IMPORTED. The ruled members are read loosely.
//
// HARNESS: src/units/_parity.ts (both shopper hosts; the shipped console under
// jsdom). The edge's geolocation is attached to the request as `request.cf`, as
// src/units/_parity2.ts (S2) does; REGION_TREND is bound to a recording ingest
// door, the only binding the population trend has (src/types/env.ts).
//
// R10 (tests that lock present behaviour, listed for the lead):
//   · src/reflex/shopperReflex.test.ts:464 and :585 and
//     src/routes/realtime.sdkContract.test.ts:3722-3748 read the update's
//     `affinity` with toMatchObject / member reads, not an exact key set; an
//     `applied` member collides with none of them.
//   · W19 enrichment tests (src/units/W19) and src/content/typeAffinity tests
//     weigh content-type interest from content events; no product-type weight is
//     declared there, so those documents score as today.

import { describe, expect, it } from 'vitest';

import { validateReflexConfig } from '@/reflex/configStore';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';

import {
  asOperator, expectPublished, HOSTS, learnDocument, MODULES, mount, openConsole, recentSlot, REFLEX_DOCUMENT, shopperOn, TENANT,
  type Answer, type Mounted, type Shopper,
} from '../_parity';
import { missingStatements } from '../_parity3';

const K = 1.8;
const aff = (r: number) => r / (r + K);
const ADD_TO_CART = 'add_to_cart';
/** The shipped weight of an add to bag (src/reflex/core.ts DEFAULT_REFLEX_CONFIG.weights). */
const OWN = REFLEX_DOCUMENT.weights[ADD_TO_CART]!;

/** A purse counts for 8, a trinket (a bag charm) for 1 (parity §5 B11). */
const PTW = { dimension: 'category', weights: { [ADD_TO_CART]: { Handbags: 8, Accessories: 1 } } };
const REFLEX_WITH_PTW = { ...REFLEX_DOCUMENT, productTypeWeights: PTW };
const SLOTS = { version: 'parity-p14-slots', governanceVersion: 3, pages: { pdp: [recentSlot()] } };
const documents = (reflex: unknown) => ({ pieces: MODULES, slots: SLOTS, learn: learnDocument(), reflex });

// Coach's own rows (src/data/coach-catalog.json).
const cart = (data: Record<string, unknown>) => ({ type: ADD_TO_CART, data });
/** COA-CH857 · Tabby Shoulder Bag 26 · Handbags: a purse. */
const CART_PURSE = cart({ productId: 'COA-CH857', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags', price_usd: 475 });
/** COA-CCZ00 · Tabby Bag Charm · Accessories: a trinket. */
const CART_TRINKET = cart({ productId: 'COA-CCZ00', line: 'Tabby', category: 'Accessories', subcategory: 'Bag Charms', price_usd: 150 });
/** COA-CB925 · Tabby Wallet With Chain · Small Leather Goods: a value with no product-type weight. */
const CART_WALLET = cart({ productId: 'COA-CB925', line: 'Tabby', category: 'Small Leather Goods', subcategory: 'Wallets', price_usd: 250 });
/** A Tabby product whose event names no category at all. */
const CART_UNTYPED = cart({ productId: 'COA-CH857', line: 'Tabby' });

const CASES = [
  { name: 'a purse (Handbags, weighted 8)', event: CART_PURSE, productType: 'Handbags', weight: 8 },
  { name: 'a trinket (Accessories, weighted 1)', event: CART_TRINKET, productType: 'Accessories', weight: 1 },
  { name: 'a wallet (Small Leather Goods, no product-type weight)', event: CART_WALLET, productType: 'Small Leather Goods', weight: OWN },
  { name: 'a product with no category on the event', event: CART_UNTYPED, productType: null, weight: OWN },
] as const;

/** A real accepted event through the mounted app, arriving through an edge that geolocated it. */
async function actionFrom(m: Mounted, s: Shopper, event: { type: string; data: Record<string, unknown> }): Promise<Answer> {
  const request = new Request('https://shop.invalid/realtime/action', {
    method: 'POST', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...event, source: 'sdk', userId: s.grant.subject, sessionId: s.grant.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() }),
  });
  Object.defineProperty(request, 'cf', { value: { country: 'US', regionCode: 'NY', region: 'New York', city: 'New York', continent: 'NA' } });
  const response = await m.fetch(request);
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}

/** The population trend's ingest door, recording every frame a host sends it. */
function recordTrend(m: Mounted): Array<{ w: number; touches: unknown[] }> {
  const frames: Array<{ w: number; touches: unknown[] }> = [];
  (m.env as unknown as Record<string, unknown>).REGION_TREND = { idFromName: (n: string) => n, get: () => ({ fetch: async (_url: string, init?: RequestInit) => {
    frames.push(JSON.parse(String(init?.body ?? '{}')));
    return Response.json({ ok: true });
  } }) };
  return frames;
}

type Affinity = { dims?: Record<string, Record<string, number>>; applied?: Record<string, unknown> };
const affinityOf = (answer: Answer) => (((answer.body.update as { data?: { affinity?: Affinity } } | undefined)?.data?.affinity) ?? {}) as Affinity;

// ===========================================================================
// unit:P14.J1 — the product-type weight in place of the action's own
// ===========================================================================

describe('unit:P14.J1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D1 — with the category dimension declared for product type, an add to bag of a purse raises interest by 8, of a trinket by 1, and of another value or of a product with no category by the action's own weight; the population trend is fed the action's own weight`, async () => {
      const m = await mount(host, documents(REFLEX_WITH_PTW));
      expectPublished(m, 'P14.J1 — the reflex document declaring product-type weights publishes');
      const frames = recordTrend(m);
      for (const c of CASES) {
        const s = await shopperOn(m);
        const before = frames.length;
        const answer = await actionFrom(m, s, c.event);
        expect(answer.status, `${host}: PRECONDITION — the add to bag of ${c.name} is accepted (${JSON.stringify(answer.body).slice(0, 200)})`).toBe(200);
        expect.soft(affinityOf(answer).dims?.line?.Tabby, `${host}: P14.J1 — ${c.name}: her Tabby interest rises by ${c.weight}`).toBeCloseTo(aff(c.weight), 3);
        const fed = frames.slice(before);
        expect.soft(fed.map(f => f.w), `${host}: P14.J1 (item 49) — the population trend is fed the action's own weight (${OWN}) for ${c.name}`).toEqual([OWN]);
      }
    });
  }
});

// ===========================================================================
// unit:P14.J2 — the weight applied is itemised on the interest update
// ===========================================================================

describe('unit:P14.J2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D2 — the interest update each event returns itemises the action, the product type and the weight it applied`, async () => {
      const m = await mount(host, documents(REFLEX_WITH_PTW));
      expectPublished(m, 'P14.J2 — the reflex document declaring product-type weights publishes');
      for (const c of CASES) {
        const s = await shopperOn(m);
        const answer = await actionFrom(m, s, c.event);
        expect(answer.status, `${host}: PRECONDITION — the add to bag of ${c.name} is accepted`).toBe(200);
        expect.soft(affinityOf(answer).applied ?? `the update carries no affinity.applied (affinity carries ${Object.keys(affinityOf(answer)).join(', ')})`,
          `${host}: P14.J2 — ${c.name}: the update itemises the action, the product type and the weight`).toEqual({ action: ADD_TO_CART, dimension: 'category', productType: c.productType, weight: c.weight });
      }
    });
  }
});

// ===========================================================================
// unit:P14.J3 — the validator, and a document without product-type weights
// ===========================================================================

describe('unit:P14.J3', () => {
  it('logic: the reflex document validator admits product-type weights on a declared dimension and refuses, naming productTypeWeights, a weight outside 0 to 1000 and a dimension the registry does not declare', () => {
    const admitted = validateReflexConfig(REFLEX_WITH_PTW);
    expect(admitted.ok, `PRECONDITION: the declaring document is admitted (${JSON.stringify(admitted).slice(0, 200)})`).toBe(true);
    const bad: Array<{ name: string; value: unknown }> = [
      { name: 'a weight above 1000', value: { dimension: 'category', weights: { [ADD_TO_CART]: { Handbags: 1001 } } } },
      { name: 'a negative weight', value: { dimension: 'category', weights: { [ADD_TO_CART]: { Handbags: -1 } } } },
      { name: 'a weight that is not a number', value: { dimension: 'category', weights: { [ADD_TO_CART]: { Handbags: '8' } } } },
      { name: 'a dimension the registry does not declare', value: { dimension: 'material', weights: { [ADD_TO_CART]: { Handbags: 8 } } } },
    ];
    for (const b of bad) {
      const refused = validateReflexConfig({ ...REFLEX_DOCUMENT, productTypeWeights: b.value });
      expect.soft(refused.ok ? 'admitted' : (refused as { errors: string[] }).errors.some(e => e.includes('productTypeWeights')) ? 'refused by name' : (refused as { errors: string[] }).errors.join('; '),
        `P14.J3 — ${b.name} is refused naming productTypeWeights`).toBe('refused by name');
    }
  });

  for (const host of HOSTS) {
    it(`host (${host}): LOCKED — a reflex document without product-type weights scores every add to bag by the action's own weight, exactly as today`, async () => {
      const m = await mount(host, documents(REFLEX_DOCUMENT));
      expectPublished(m, 'P14.J3 — the registry without product-type weights publishes');
      for (const c of CASES) {
        const s = await shopperOn(m);
        const answer = await actionFrom(m, s, c.event);
        expect(answer.status).toBe(200);
        expect(affinityOf(answer).dims?.line?.Tabby, `${host}: P14.J3 — ${c.name}: the action's own weight (${OWN}), as today`).toBeCloseTo(aff(OWN), 3);
      }
    });
  }
});

// ===========================================================================
// unit:P14.J4 — the shipped console edits product-type weights, in force without a deployment
// ===========================================================================

describe('unit:P14.J4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the shipped console's interests screen shows the product-type dimension and edits a product-type weight, and the saved revision is in force for the next event without a deployment`, async () => {
      const m = await mount(host, documents(REFLEX_WITH_PTW));
      expectPublished(m, 'P14.J4 — the reflex document declaring product-type weights publishes');
      const before = await asOperator(m, 'GET', '/config/reflex');
      const c = await openConsole(m, `#/interests?scope=${TENANT}`);
      try {
        expect(c.text(), 'PRECONDITION: the interests screen renders').toContain('What each shopper action counts for');
        const control = c.control(`ptw:${ADD_TO_CART}:Handbags`);
        expect(control ? control.value : `no control with focus key ptw:${ADD_TO_CART}:Handbags (keys: ${c.all('[data-focus-key]').map(e => (e as unknown as { getAttribute: (k: string) => string }).getAttribute('data-focus-key')).join(', ').slice(0, 300)})`,
          'P14.J4 — the interests screen shows the purse weight in force').toBe('8');
        expect(/category/i.test(c.text()) && /product type/i.test(c.text()), 'P14.J4 — and names the dimension that decides the product type').toBe(true);
        await c.type(`ptw:${ADD_TO_CART}:Handbags`, '12');
        await c.save();
      } finally { c.close(); }
      const after = await asOperator(m, 'GET', '/config/reflex');
      expect(after.body.revision, 'P14.J4 — the save published a new revision').toBe((before.body.revision as number) + 1);
      expect(((after.body.config as Record<string, unknown>).productTypeWeights as typeof PTW | undefined)?.weights?.[ADD_TO_CART]?.Handbags, 'P14.J4 — carrying the edited weight').toBe(12);
      const s = await shopperOn(m);
      const answer = await actionFrom(m, s, CART_PURSE);
      expect(affinityOf(answer).dims?.line?.Tabby, 'P14.J4 — the next add to bag of a purse rises by 12, no deployment in between').toBeCloseTo(aff(12), 3);
    });
  }
});

// ===========================================================================
// unit:P14.J5 — the kit
// ===========================================================================

describe('unit:P14.J5', () => {
  it('logic: the API reference and the payload schemas document product-type weights and the itemised interest update', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'product-type weights live in the reflex document on one declared dimension (productTypeWeights)', test: t => /productTypeWeights/.test(t) && /dimension/i.test(t) },
      { name: 'an event of another value, or with no value on the dimension, counts by the action\'s own weight', test: t => /product.type/i.test(t) && /(own|action's) weight/i.test(t) },
      { name: 'a product-type weight is 0 to 1000', test: t => /productTypeWeights|product.type weight/i.test(t) && /1000|1,000/.test(t) },
      { name: 'the interest update itemises the action, the product type and the weight (affinity.applied)', test: t => /applied/.test(t) && /product.?type/i.test(t) && /weight/i.test(t) },
      { name: 'the population trend keeps the action\'s own weight', test: t => /trend|population|regional/i.test(t) && /own weight|action's weight/i.test(t) },
    ]);
    expect(missing, 'P14.J5 — the kit documents product-type weights').toEqual([]);
  });
});
