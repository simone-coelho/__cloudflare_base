// src/units/P30/LEDGER.unit.test.ts
// P30 under the Closure Ledger: the tests for the LOCAL criteria of the P30 work
// order (`tapestry-parity-build`, ticket P30 "Context-only layout mode per slot,
// with an exposure beacon"). DC1 and DC2 (decisions D1, D2) are ruled here and
// exercised inside X1-X6; LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P30.<criterion> …')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P30 in section E): "a
//     layout slot flagged context-only ignores affinity, stage and fatigue, stops
//     the ladder at channel × visit (optionally region), hashes exploration on
//     context and hour, and two shoppers in the same context receive the
//     identical order; a light per-view beacon records exposure of a cached
//     layout so learning counts it; the answer exposes the context key as a
//     non-identifying value; a shopper on the holdout or without consent
//     receives the default variant";
//   · freeze sheet item 10 (D1: built now, a per-slot switch, off by default;
//     D2: a non-identifying context-key header and an exposure beacon) and item
//     41 ("A context-only slot ignores seed rules on campaign term and referrer
//     network, so two shoppers in one context cannot receive different orders").
//     Both items are UNANSWERED at the freeze: every unit names them (R-P15);
//   · the investigation, sections G-B ("Is the layout per shopper or per
//     context?", option A) and G-C (caching option (c): "page × channel × visit
//     bucket, plus a default variant, plus region if the regional prior is on");
//   · the existing contract: src/learn/stats.ts (levels 0 everyone, 1 channel,
//     2 channel and visit bucket, 3 and above the shopper's stage, region and
//     leading interest), src/learn/explore.ts (bucketOf hashed on visitor, slot
//     and hour), src/routes/decisions.ts (Cache-Control no-store).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   The switch is `contextOnly: { enabled: true }` on the page's DECLARED layout
//   slot in the slots document, `contextOnly: { enabled: true, region: true }`
//   to admit the region; absent is off. The context is page × entry channel ×
//   visit bucket (× region where admitted). The answer to POST
//   /v1/:tenant/decisions/snapshot carries the key in the response header
//   `X-Context-Key`. The beacon is the action `layout_exposure` through POST
//   /realtime/action with data `{ contextKey, page, slot, modules, pageInstance }`
//   (`modules` in drawn order), sent by the SDK's `listen.layoutExposure({
//   contextKey, page, slot, modules })` under tracking consent. A context-only
//   record carries no affinity driver, no stage, no fatigue and no seed driver
//   on campaign term or referrer network, and its learned lift answers from a
//   level no finer than 2 (channel and visit bucket). With the region admitted
//   (`region: true`) the region is part of the context: the regional prior
//   applies as it does for a shopper with no interest (S4-C21), so one region
//   gets one order whatever the shoppers' histories, and two regions whose
//   priors differ get differing orders (R-P38).
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `contextOnly` on the slot, the `X-Context-Key` header, the `layout_exposure`
// action, `listen.layoutExposure`. No new export is imported.
//
// PRECONDITIONS (R-P6): every host leg needs P02 (a declared layout slot,
// governance 4) and fails first with a message labelled PRECONDITION P02. The
// beacon's exposures are counted through the rendered-v1 learning of P02 D1.
//
// HARNESS: src/units/_parity.ts and src/units/_parity4.ts.

import { describe, expect, it } from 'vitest';

import type { DecisionRecord } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { trendKey, REGION_GENERATION } from '@/reflex/regionTrend';
import { invalidateLiftCache } from '@/content/service';
import { createCore } from '@/sdk/core';
import { createListen } from '@/sdk/listen';
import { testHost } from '@/sdk/testHost';
import type { RequestInitLike, ResponseLike } from '@/sdk/types';

import {
  BRAND, declaredSlots, errorsOf, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, loadSlots, M, MODULES, mount, PAGE_VIEW,
  PAID_SOCIAL_ENTRY, DIRECT_ENTRY, pageInstanceOf, productView, putSlots, readTree, recentSlot, replayOf, servePage, shopperOn,
  storedDecisions, TABBY_VIEWS, TENANT, toLedger, type Decision, type Mounted, type Shopper,
} from '../_parity';
import { learnedLift } from '../_parity4';

const SEEDS = [
  { signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'line', value: 'Tabby' }], weight: 1 },
  { signal: 'campaign_term', value: 'willow', tags: [{ dimension: 'line', value: 'Willow' }], weight: 1 },
  { signal: 'referrer_network', value: 'instagram.com', tags: [{ dimension: 'occasion', value: 'evening' }], weight: 1 },
];
const SHOPPER_RULES = { seeds: SEEDS, stage: { outOfStage: 0.5, inStage: 0.3 }, fatigue: { weight: 0.5, windowHours: 24, cap: 2 } };
const contextOnlySlots = (switchValue: unknown = { enabled: true }) => declaredSlots([layoutSlot({ ...SHOPPER_RULES, contextOnly: switchValue }), recentSlot()]);
const LEARN = learnDocument();
const VIEW_WILLOW = productView({ productId: 'COA-C2621', line: 'Willow', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['work', 'everyday'], price_usd: 350 });
const TERM_ENTRY = { ...PAID_SOCIAL_ENTRY, utmTerm: 'willow' };
const REFERRED_ENTRY = { ...PAID_SOCIAL_ENTRY, referrer: 'www.instagram.com', siteHost: 'www.coach.com' };
const NEW_YORK = { country: 'US', regionCode: 'NY' }, CALIFORNIA = { country: 'US', regionCode: 'CA' };
const precondition = (m: Mounted, ticket: string) => expectPublished(m, `${ticket} — PRECONDITION P02: the page's declared layout slot (governance 4) publishes`);

interface Answered { status: number; headers: Headers; body: Record<string, unknown>; decisions: Decision[]; page: string; pageInstance: string }
/** POST /v1/:tenant/decisions/snapshot as the SDK sends it, with the edge's geolocation, keeping the response headers. */
async function ask(m: Mounted, s: Shopper, entry: Record<string, string>, cf?: Record<string, string>, label = 'p30'): Promise<Answered> {
  const pageInstance = pageInstanceOf(label);
  const request = new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance, entry: JSON.stringify(entry) }) });
  if (cf) Object.defineProperty(request, 'cf', { value: cf });
  const response = await m.fetch(request);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, headers: response.headers, body, decisions: (body.decisions ?? []) as Decision[], page: 'pdp', pageInstance };
}
const layoutOf = (a: { decisions: Decision[] }) => a.decisions.filter(d => d.slot === LAYOUT).sort((x, y) => x.order - y.order).map(d => d.contentId);
async function arrive(m: Mounted, entry: Record<string, string>, views: Array<{ type: string; data: Record<string, unknown> }> = [], consent?: { tracking: boolean; personalization: boolean }): Promise<Shopper> {
  const s = await shopperOn(m, consent ?? { tracking: true, personalization: true });
  expect((await s.action(PAGE_VIEW, entry)).status, `${m.host}: the shopper's page view is accepted`).toBe(200);
  for (const view of views) expect((await s.action(view)).status, `${m.host}: the shopper's view is accepted`).toBe(200);
  return s;
}
/** What every statistics object holds for an item at one level key, summed (`learned` in _parity.ts reads the root). */
async function exposuresAt(m: Mounted, key: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of [...m.stats.keys()].sort()) {
    const response = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/snapshot', { method: 'POST' });
    const body = await response.json().catch(() => ({})) as { snapshot?: { items?: Record<string, Record<string, { n: number }>> } | null };
    for (const [item, cells] of Object.entries(body.snapshot?.items ?? {})) if (cells[key]) out[item] = Math.round((out[item] ?? 0) + cells[key]!.n);
  }
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n !== 0));
}
const beacon = (s: Shopper, data: Record<string, unknown>) => s.action({ type: 'layout_exposure', data: { page: 'pdp', slot: LAYOUT, ...data } });

// ===========================================================================
// unit:P30.X1 — a context-only slot decides from its context alone
// ===========================================================================

describe('unit:P30.X1 (freeze items 10 and 41)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): three shoppers in one context — one with no history, one with Tabby interests, a served history and a campaign term, one with Willow interests arriving from an Instagram referral — decided in the same hour receive the identical order, and no record carries an interest, stage, fatigue or out-of-context seed term`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: contextOnlySlots(), learn: LEARN });
      precondition(m, 'P30.X1');
      const fresh = await arrive(m, PAID_SOCIAL_ENTRY);
      const tabby = await arrive(m, TERM_ENTRY, TABBY_VIEWS);
      await ask(m, tabby, TERM_ENTRY, undefined, 'p30-x1-history');
      const willow = await arrive(m, REFERRED_ENTRY, [VIEW_WILLOW, VIEW_WILLOW, VIEW_WILLOW]);
      const orders: Array<[string, string[]]> = [];
      for (const [name, s, entry] of [['no history', fresh, PAID_SOCIAL_ENTRY], ['Tabby, served, campaign term', tabby, TERM_ENTRY], ['Willow, Instagram referral', willow, REFERRED_ENTRY]] as const) {
        const answer = await ask(m, s, entry, undefined, 'p30-x1');
        expect(answer.status, `${host}: the shopper's page is answered: ${JSON.stringify(answer.body).slice(0, 200)}`).toBe(200);
        orders.push([name, layoutOf(answer)]);
      }
      expect(orders, `${host}: P30.X1 — the three shoppers in one context receive the identical order`).toEqual(orders.map(([name]) => [name, orders[0]![1]]));
      const records = (await servePage(m, tabby, 'pdp', { entry: TERM_ENTRY })).records.filter(r => r.slot === LAYOUT);
      const shopperTerms = (r: DecisionRecord) => [r.item_id,
        r.explain.drivers.filter(d => ['line', 'category', 'occasion', 'silhouette', 'subcategory'].includes(d.dim)).length,
        Boolean(r.explain.stage), Boolean(r.explain.fatigue),
        (r.explain.contextual?.drivers ?? []).filter(d => d.signal !== 'entry_channel').length];
      expect(records.map(shopperTerms), `${host}: P30.X1 — each record of the context-only slot carries no interest driver, no stage, no fatigue and no campaign-term or referrer seed`)
        .toEqual(records.map(r => [r.item_id, 0, false, false, 0]));
    }, 90_000);

    it(`host (${host}): the learned ladder of a context-only slot stops at channel and visit bucket, even where the shopper's own stage level has evidence`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: contextOnlySlots(), learn: learnDocument({ [LAYOUT]: { reward: 'click', gamma: 1 } }) });
      precondition(m, 'P30.X1');
      const s = await arrive(m, PAID_SOCIAL_ENTRY, TABBY_VIEWS);
      const cell = (await servePage(m, s, 'pdp', { entry: PAID_SOCIAL_ENTRY })).records[0]?.cell;
      expect(cell?.stage && cell.stage !== 'unknown' ? cell.channel : null, `${host}: PRECONDITION — the shopper's decision is in the paid-social context with a known stage`).toBe('paid_social');
      const otherStage = cell!.stage === 'early' ? 'late' : 'early';
      // The shopper's own stage level (3 and finer) saw ugc.1 used often; the channel and visit bucket as a whole saw it rarely.
      await learnedLift(m, LAYOUT, [{ item: M.ugc, exposures: 40, successes: 20 }, { item: M.grid, exposures: 40, successes: 2 }], cell!);
      await learnedLift(m, LAYOUT, [{ item: M.ugc, exposures: 400, successes: 0 }, { item: M.grid, exposures: 400, successes: 2 }], { ...cell!, stage: otherStage });
      // The shopper's first decision read the lift before any was published; the serving path caches per placement in process.
      invalidateLiftCache();
      const records = (await servePage(m, s, 'pdp', { entry: PAID_SOCIAL_ENTRY })).records.filter(r => r.slot === LAYOUT && r.explain.lift);
      expect(records.length, `${host}: PRECONDITION — learned lifts reach the layout's decision`).toBeGreaterThan(0);
      expect(records.map(r => [r.item_id, (r.explain.lift?.level ?? 99) <= 2]), `${host}: P30.X1 — every learned lift answers from level 2 (channel and visit bucket) or coarser (levels: ${JSON.stringify(records.map(r => r.explain.lift?.level))})`)
        .toEqual(records.map(r => [r.item_id, true]));
    }, 120_000);

    it(`host (${host}): with the region not admitted, two shoppers of one context in two regions whose regional priors differ receive the identical order`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: contextOnlySlots(), learn: learnDocument({}, { regional: { enabled: true, kBlend: 1, minEvents: 1 } }) });
      precondition(m, 'P30.X1');
      const now = Date.now();
      for (const [region, line] of [['US-NY', 'Tabby'], ['US-CA', 'Willow']] as const) {
        await m.cache.put(trendKey(TENANT, region), JSON.stringify({ generation: REGION_GENERATION, tenant: TENANT, region, level: 'region', events: 500,
          updatedAt: now, version: now, r: { line: { [line]: 5 } }, share: { line: { [line]: 1 } } }));
      }
      const ny = await arrive(m, PAID_SOCIAL_ENTRY), ca = await arrive(m, PAID_SOCIAL_ENTRY);
      const a = await ask(m, ny, PAID_SOCIAL_ENTRY, NEW_YORK, 'p30-x1-ny'), b = await ask(m, ca, PAID_SOCIAL_ENTRY, CALIFORNIA, 'p30-x1-ca');
      expect([a.status, b.status], `${host}: both pages are answered`).toEqual([200, 200]);
      expect(layoutOf(b), `${host}: P30.X1 — New York and California, one context, the identical order`).toEqual(layoutOf(a));
    }, 90_000);

    it(`host (${host}): with the region admitted, three shoppers of one context in one region — no history, Tabby interests with a served history, Willow interests — receive one order, and two regions whose regional priors differ receive differing orders`, async () => {
      // The regional prior fixture of the leg above: New York leans Tabby, California leans Willow.
      const m = await mount(host, { pieces: MODULES, slots: contextOnlySlots({ enabled: true, region: true }), learn: learnDocument({}, { regional: { enabled: true, kBlend: 1, minEvents: 1 } }) });
      precondition(m, 'P30.X1');
      const now = Date.now();
      for (const [region, line] of [['US-NY', 'Tabby'], ['US-CA', 'Willow']] as const) {
        await m.cache.put(trendKey(TENANT, region), JSON.stringify({ generation: REGION_GENERATION, tenant: TENANT, region, level: 'region', events: 500,
          updatedAt: now, version: now, r: { line: { [line]: 5 } }, share: { line: { [line]: 1 } } }));
      }
      const byRegion: Array<[string, Array<[string, string[]]>]> = [];
      for (const [region, cf] of [['New York', NEW_YORK], ['California', CALIFORNIA]] as const) {
        const fresh = await arrive(m, PAID_SOCIAL_ENTRY);
        const tabby = await arrive(m, PAID_SOCIAL_ENTRY, TABBY_VIEWS);
        await ask(m, tabby, PAID_SOCIAL_ENTRY, cf, 'p30-x1-region-history');
        const willow = await arrive(m, PAID_SOCIAL_ENTRY, [VIEW_WILLOW, VIEW_WILLOW, VIEW_WILLOW]);
        const orders: Array<[string, string[]]> = [];
        for (const [name, s] of [['no history', fresh], ['Tabby, served', tabby], ['Willow', willow]] as const) {
          const answer = await ask(m, s, PAID_SOCIAL_ENTRY, cf, 'p30-x1-region');
          expect(answer.status, `${host}: the shopper's page in ${region} is answered: ${JSON.stringify(answer.body).slice(0, 200)}`).toBe(200);
          orders.push([name, layoutOf(answer)]);
        }
        expect(orders.map(([, order]) => order.length), `${host}: PRECONDITION — each page in ${region} carries the layout's four modules`).toEqual([4, 4, 4]);
        byRegion.push([region, orders]);
      }
      expect(byRegion, `${host}: P30.X1 — with the region admitted, the three shoppers of one context in one region receive the identical order`)
        .toEqual(byRegion.map(([region, orders]) => [region, orders.map(([name]) => [name, orders[0]![1]])]));
      const [newYork, california] = byRegion.map(([, orders]) => JSON.stringify(orders[0]![1]));
      expect(newYork === california ? 'the identical order in both regions' : 'differing orders',
        `${host}: P30.X1 — with the region admitted, New York and California, whose regional priors differ, receive differing orders (${newYork} / ${california})`).toBe('differing orders');
    }, 120_000);
  }
});

// ===========================================================================
// unit:P30.X2 — exploration hashed on the context and the hour
// ===========================================================================

describe('unit:P30.X2 (freeze item 10)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on a context-only slot exploring every decision, five shoppers of one context in the same hour receive the identical explored order`, async () => {
      const learn = learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', exploration: { mode: 'epsilon', share: 1, floor: 0 } } });
      const m = await mount(host, { pieces: MODULES, slots: contextOnlySlots(), learn });
      precondition(m, 'P30.X2');
      const picks: unknown[][] = [];
      for (let i = 0; i < 5; i++) {
        const s = await arrive(m, PAID_SOCIAL_ENTRY);
        const records = (await servePage(m, s, 'pdp', { entry: PAID_SOCIAL_ENTRY })).records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
        picks.push([records.map(r => r.item_id), records.find(r => r.explored)?.explain.exploration?.bucket ?? null]);
      }
      expect(picks.every(([, bucket]) => typeof bucket === 'number'), `${host}: PRECONDITION — every decision explored (${JSON.stringify(picks)})`).toBe(true);
      expect(picks, `${host}: P30.X2 — one context, one hour: the identical explored order and bucket for every shopper`).toEqual(picks.map(() => picks[0]));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P30.X3 — the non-identifying context key
// ===========================================================================

describe('unit:P30.X3 (freeze item 10)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the answer carries X-Context-Key built from the page, the channel and the visit bucket — equal within a context, different across contexts, holding no visitor, session or decision identifier — and stays Cache-Control no-store`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: contextOnlySlots(), learn: LEARN });
      precondition(m, 'P30.X3');
      const a = await arrive(m, PAID_SOCIAL_ENTRY, TABBY_VIEWS), b = await arrive(m, PAID_SOCIAL_ENTRY), c = await arrive(m, DIRECT_ENTRY);
      const answers = [await ask(m, a, PAID_SOCIAL_ENTRY), await ask(m, b, PAID_SOCIAL_ENTRY), await ask(m, c, DIRECT_ENTRY)];
      const keys = answers.map(x => x.headers.get('X-Context-Key'));
      expect(answers.map(x => x.headers.get('Cache-Control')), `${host}: P30.X3 — every decision response is still Cache-Control no-store`).toEqual(['no-store', 'no-store', 'no-store']);
      expect(keys.map(k => typeof k === 'string' && k.length > 0), `${host}: P30.X3 — each answer carries the X-Context-Key header (${JSON.stringify(keys)})`).toEqual([true, true, true]);
      expect([keys[0] === keys[1], keys[0] === keys[2]], `${host}: P30.X3 — equal within one context, different for another channel`).toEqual([true, false]);
      expect([/pdp/.test(keys[0] ?? ''), /paid_social/.test(keys[0] ?? ''), /direct/.test(keys[2] ?? '')], `${host}: P30.X3 — built from the page and the channel`).toEqual([true, true, true]);
      const identifiers = [a, b, c].flatMap(s => [s.subject, s.grant.sessionId]).concat(answers.flatMap(x => x.decisions.map(d => d.decisionId ?? '')).filter(Boolean));
      expect(identifiers.filter(id => keys.some(k => (k ?? '').includes(id))), `${host}: P30.X3 — no key holds a visitor, session or decision identifier`).toEqual([]);
    }, 90_000);

    it(`host (${host}): the visit bucket enters the key, and the region enters it exactly where the slot admits the region`, async () => {
      // With no page view the visit is not established, so the visit bucket is unknown (src/units/P01/LEDGER.unit.test.ts, unit:P01.O2).
      const keyOf = async (m: Mounted, entry: Record<string, string>, cf: Record<string, string>, visited = true) => {
        const s = visited ? await arrive(m, entry) : await shopperOn(m);
        return (await ask(m, s, entry, cf)).headers.get('X-Context-Key');
      };
      const without = await mount(host, { pieces: MODULES, slots: contextOnlySlots({ enabled: true }), learn: LEARN });
      precondition(without, 'P30.X3');
      const regionOff = [await keyOf(without, PAID_SOCIAL_ENTRY, NEW_YORK), await keyOf(without, PAID_SOCIAL_ENTRY, CALIFORNIA)];
      const withRegion = await mount(host, { pieces: MODULES, slots: contextOnlySlots({ enabled: true, region: true }), learn: LEARN });
      precondition(withRegion, 'P30.X3');
      const regionOn = [await keyOf(withRegion, PAID_SOCIAL_ENTRY, NEW_YORK), await keyOf(withRegion, PAID_SOCIAL_ENTRY, NEW_YORK), await keyOf(withRegion, PAID_SOCIAL_ENTRY, CALIFORNIA)];
      expect([regionOff.every(Boolean), regionOn.every(Boolean)], `${host}: P30.X3 — every answer carries the key (${JSON.stringify([regionOff, regionOn])})`).toEqual([true, true]);
      expect([regionOff[0] === regionOff[1], regionOn[0] === regionOn[1], regionOn[0] === regionOn[2]],
        `${host}: P30.X3 — without the region two regions share a key; with it one region shares a key and two regions do not`).toEqual([true, true, false]);
      const t = await mount(host, { pieces: MODULES, slots: contextOnlySlots(), learn: LEARN });
      precondition(t, 'P30.X3');
      const buckets = [await keyOf(t, DIRECT_ENTRY, NEW_YORK), await keyOf(t, DIRECT_ENTRY, NEW_YORK, false)];
      expect([buckets.every(Boolean), buckets[0] === buckets[1]], `${host}: P30.X3 — a first visit and an unknown visit bucket do not share a key (${JSON.stringify(buckets)})`).toEqual([true, false]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P30.X4 — the per-view beacon counts a cached layout's exposures
// ===========================================================================

describe('unit:P30.X4 (freeze item 10)', () => {
  const learn = learnDocument();
  for (const host of HOSTS) {
    it(`host (${host}): a beacon with the issued key and the drawn modules adds one exposure per drawn module to that context's learning; without tracking consent, with a key the engine did not issue, or repeated for the same page view it adds none`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: contextOnlySlots(), learn });
      precondition(m, 'P30.X4');
      const s = await arrive(m, PAID_SOCIAL_ENTRY);
      const answer = await ask(m, s, PAID_SOCIAL_ENTRY);
      const key = answer.headers.get('X-Context-Key');
      const drawn = layoutOf(answer).slice(0, 3);
      expect.soft(key, `${host}: P30.X4 — the answer issues the context key the beacon names (P30.X3)`).toBeTruthy();
      const pageInstance = pageInstanceOf('p30-x4-cached');
      expect((await beacon(s, { contextKey: key, modules: drawn, pageInstance })).status, `${host}: P30.X4 — the beacon is accepted`).toBe(200);
      await beacon(s, { contextKey: key, modules: drawn, pageInstance });
      const untracked = await shopperOn(m, { tracking: false, personalization: false });
      await beacon(untracked, { contextKey: key, modules: drawn, pageInstance: pageInstanceOf('p30-x4-untracked') });
      await beacon(s, { contextKey: 'pdp|paid_social|forged', modules: drawn, pageInstance: pageInstanceOf('p30-x4-forged') });
      await m.drainLedger();
      expect(await exposuresAt(m, 'c=paid_social|v=1'), `${host}: P30.X4 — one exposure for each of the three drawn modules in the paid-social first-visit context, and nothing from the repeat, the untracked shopper or the forged key`)
        .toEqual(Object.fromEntries(drawn.map(id => [id, 1])));
    }, 90_000);
  }

  it('sdk: the real SDK sends the per-view beacon for a cached layout under tracking consent, with the key and the drawn modules, and sends nothing without tracking consent', async () => {
    const sentBy = async (tracking: boolean) => {
      const f = testHost({ responses: () => ({ success: true }) });
      if (!tracking) {
        const base = f.host.fetch;
        f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
          const answer = await base(url, init);
          if (!url.endsWith('/identity/session')) return answer;
          const body = await answer.json() as { session: { consent: { tracking: boolean; personalization: boolean; instruction: Record<string, unknown> } } };
          const refused = { value: false, chosenAt: f.host.now(), expiresAt: f.host.now() + 30 * 86_400_000 };
          body.session.consent = { ...body.session.consent, tracking: false, personalization: false,
            instruction: { ...body.session.consent.instruction, tracking: refused, personalization: refused } };
          return { ok: true, status: 200, json: async () => body };
        };
      }
      const core = createCore({ tenant: 'coach', source: 'coach-pdp' }, f.host);
      const listen = createListen(core) as unknown as Record<string, unknown>;
      expect(await core.ready(), 'PRECONDITION: the client is ready').toBe(true);
      const send = listen.layoutExposure as ((beacon: Record<string, unknown>) => Promise<unknown>) | undefined;
      expect(typeof send, 'P30.X4 — the SDK offers listen.layoutExposure for a cached layout').toBe('function');
      await send!({ contextKey: 'pdp|paid_social|1', page: 'pdp', slot: LAYOUT, modules: [M.grid, M.reco1] });
      for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
      return f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!) as { type: string; data: Record<string, unknown> })
        .filter(e => e.type === 'layout_exposure');
    };
    const tracked = await sentBy(true);
    expect(tracked.map(e => [e.data.contextKey, e.data.page, e.data.slot, e.data.modules, typeof e.data.pageInstance]),
      'P30.X4 — under tracking consent one layout_exposure carrying the key, the page, the slot, the drawn modules and the page view')
      .toEqual([['pdp|paid_social|1', 'pdp', LAYOUT, [M.grid, M.reco1], 'string']]);
    expect((await sentBy(false)).length, 'P30.X4 — without tracking consent the SDK sends no beacon').toBe(0);
  });
});

// ===========================================================================
// unit:P30.X5 — the default variant; a slot without the switch as before
// ===========================================================================

describe('unit:P30.X5 (freeze item 10)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a shopper on the holdout's default arm and a shopper without consent receive the default variant — the slot's own default order — under one key of its own`, async () => {
      const holdout = await mount(host, { pieces: MODULES, slots: contextOnlySlots(), learn: learnDocument({}, { holdout: { share: 1, salt: 'p30-holdout', arms: ['default'] } }) });
      precondition(holdout, 'P30.X5');
      const onHoldout = await ask(holdout, await arrive(holdout, PAID_SOCIAL_ENTRY, TABBY_VIEWS), PAID_SOCIAL_ENTRY);
      const m = await mount(host, { pieces: MODULES, slots: contextOnlySlots(), learn: LEARN });
      precondition(m, 'P30.X5');
      const refused = await ask(m, await shopperOn(m, { tracking: false, personalization: false }), PAID_SOCIAL_ENTRY);
      const personalised = await ask(m, await arrive(m, PAID_SOCIAL_ENTRY), PAID_SOCIAL_ENTRY);
      const DEFAULT = [M.grid, M.reco1, M.reco2, M.editorial];
      expect([layoutOf(onHoldout), layoutOf(refused)], `${host}: P30.X5 — both receive the default variant: the first four eligible modules in catalogue order`).toEqual([DEFAULT, DEFAULT]);
      const keys = [onHoldout, refused, personalised].map(x => x.headers.get('X-Context-Key'));
      expect([Boolean(keys[0]), keys[0] === keys[1], keys[0] === keys[2]], `${host}: P30.X5 — the default variant carries its own key, shared by both and distinct from the context's (${JSON.stringify(keys)})`)
        .toEqual([true, true, false]);
    }, 90_000);

    it(`host (${host}): LOCK — a declared layout slot without the switch decides exactly as the same slot undeclared, and every decision replays equal`, async () => {
      const undeclared = { version: 'parity-p30-undeclared', governanceVersion: 3, pages: { pdp: [{ ...layoutSlot(SHOPPER_RULES), layout: undefined }, recentSlot()].map(x => JSON.parse(JSON.stringify(x))) } };
      // Served-v1 and without the durable recovery path: the replay reads what the real producer and consumer wrote (R-P14).
      const servedLearn = learnDocument({ [LAYOUT]: { reward: 'click' } });
      const before = await mount(host, { pieces: MODULES, slots: undeclared, retainedSlots: true, learn: servedLearn }, { recovery: false });
      expectPublished(before, 'P30.X5 — the undeclared retained slots document reads');
      const reference = (await servePage(before, await arrive(before, PAID_SOCIAL_ENTRY, TABBY_VIEWS), 'pdp', { offer: false })).records
        .filter(r => r.slot === LAYOUT).map(r => [r.item_id, r.position, r.explain.score_base, r.explain.score_final]);
      const m = await mount(host, { pieces: MODULES, slots: declaredSlots([layoutSlot(SHOPPER_RULES), recentSlot()]), learn: servedLearn }, { recovery: false });
      precondition(m, 'P30.X5');
      const s = await arrive(m, PAID_SOCIAL_ENTRY, TABBY_VIEWS);
      const set = await servePage(m, s, 'pdp', { offer: false });
      expect(set.records.filter(r => r.slot === LAYOUT).map(r => [r.item_id, r.position, r.explain.score_base, r.explain.score_final]),
        `${host}: P30.X5 — without the switch the declared layout decides term for term as before`).toEqual(reference);
      await toLedger(m, set.records);
      const replays: unknown[][] = [];
      for (const r of storedDecisions(m, s.subject).filter(x => x.slot === LAYOUT)) {
        const replay = await replayOf(m, r.decision_id);
        replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
      }
      expect(replays.length, `${host}: PRECONDITION — the ledger holds the layout decisions`).toBe(4);
      expect(replays, `${host}: P30.X5 — each replays equal`).toEqual(replays.map(([id]) => [id, 200, 'equal']));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P30.X6 — publication refuses the switch off the layout slot; the kit
// ===========================================================================

describe('unit:P30.X6 (freeze item 10)', () => {
  it('host: publication refuses the switch on a slot that is not the page’s declared layout slot with an error naming it, writing no revision, and admits and keeps it on the layout slot', async () => {
    const m = await mount('session', { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: LEARN });
    precondition(m, 'P30.X6');
    const admitted = await putSlots(m, declaredSlots([layoutSlot({ contextOnly: { enabled: true, region: true } }), recentSlot()]), 'p30 switch');
    expect(admitted.status, `P30.X6 — CONTROL: the switch on the declared layout slot publishes: ${JSON.stringify(errorsOf(admitted))}`).toBe(200);
    const stored = (await loadSlots(m)).document as { pages: Record<string, Array<Record<string, unknown>>> };
    expect(stored.pages.pdp?.find(slot => slot.slot === LAYOUT)?.contextOnly, 'P30.X6 — the published slot keeps the switch as authored').toEqual({ enabled: true, region: true });
    const revision = (await loadSlots(m)).revision;
    const refused = await putSlots(m, declaredSlots([layoutSlot(), recentSlot({ contextOnly: { enabled: true } })]), 'p30 switch off the layout');
    expect([refused.status, errorsOf(refused).some(e => /contextOnly/.test(e) && /pdp-recent/.test(e))],
      `P30.X6 — the switch on the recently-viewed slot is refused (422) with an error naming contextOnly and the slot: ${JSON.stringify(errorsOf(refused))}`).toEqual([422, true]);
    expect((await loadSlots(m)).revision, 'P30.X6 — and no revision is written').toBe(revision);
  }, 60_000);

  it('logic: the integration guide, the API reference and the payload schemas each document the switch, the key and the beacon', () => {
    const sentences = (file: string) => readTree(file).replace(/`/g, '').split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(s => s.replace(/\s+/g, ' ').trim());
    const statements: Array<[string, (s: string) => boolean]> = [
      ['contextOnly: a per-slot switch on the layout slot, off by default', s => /contextOnly/.test(s) && /(off by default|absent|default)/i.test(s)],
      ['X-Context-Key: the non-identifying context key header', s => /X-Context-Key/.test(s) && /(non-identifying|no visitor|not identify)/i.test(s)],
      ['layout_exposure: the per-view beacon counting a cached layout', s => /layout_exposure|layoutExposure/.test(s) && /(cached|cache)/i.test(s)],
    ];
    const missing = ['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']
      .flatMap(file => statements.filter(([, test]) => !sentences(file).some(test)).map(([name]) => `${file}: ${name}`));
    expect(missing, 'P30.X6 — the kit documents the switch, the key and the beacon').toEqual([]);
  });
});
