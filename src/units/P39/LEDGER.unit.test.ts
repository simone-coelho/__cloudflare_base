// src/units/P39/LEDGER.unit.test.ts
// P39 under the Closure Ledger, the second parity programme:
// the tests for the LOCAL criteria NP1 to NP6 of the P39 work order ("Negative
// preference with an expiry: remove from cart and the purchase rule"). DC1 and
// DC2 (decisions D1, D2, RESOLVED 2026-10-09, amendment item 62) are ruled and
// exercised inside NP1 to NP4; LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P39.<criterion>')` per criterion. Every expected value comes
// from the work order, its decisions or a witness it cites, never from what the
// engine answers today:
//   · the work order's Done-when (amended ticket file, section E, P39): "a named
//     action (`remove_from_cart`) suppresses, for the shopper, the values it names
//     for a configurable window; a server-confirmed purchase strengthens the
//     product's style, collection, colour and price band at the purchase weight
//     and suppresses the bought product type for a configurable window (default 30
//     days), after which the suppression lapses; a suppressed value does not lead a
//     decision on the shopper's own interest while suppressed and context terms are
//     unaffected; the receipt itemises each suppression with its expiry; the floor
//     is unaffected (R-P33); a tenant without the settings behaves exactly as
//     today; the kit documents the rule";
//   · D1: per-shopper suppression with an expiry, never a negative weight (weights
//     stay bounded 0 to 1000, interest floored at zero). D2: the windows and the
//     action list are tenant settings with the defaults 30 days for the purchase
//     rule and for remove from cart, full suppression;
//   · the customer's T8 row 15 and the purchase rule (authority copy): "a shopper
//     who just bought a crossbody is shown a matching wallet, not another
//     crossbody"; the investigation DI-12 (suppression of the bought product type;
//     the matching wallet is the built `complements` preference), DI-16, §3.4 (the
//     registry keys productType, style, collection, color, priceBand);
//   · R-P33 (the signal floor reads the action's own weight: remove_from_cart at
//     weight 0 is no signal) and R-P7 (new explain members compared in replay carry
//     sorted keys); P10's representation as specified (src/units/P10/LEDGER.unit.test.ts
//     on rem/spec-p10-fix1: `signalFloor` on the slots document, `explain.signalFloor:
//     { floor, signals }` on a record below the floor);
//   · the code at af671ce7: the weight bound (src/reflex/configStore.ts:349-356),
//     the accumulation and the purchase weight 5 and view weight 1
//     (src/reflex/core.ts:221-244, :567-592), a = R / (R + K) with K 1.8
//     (src/reflex/core.ts:259-262, :287-290), the complements preference and its
//     anchor (src/content/decide.ts:116, :330-341, :696-698), the seed arithmetic
//     rule weight × slot weight (unit:W16.C3.01), an unnamed action weighing 0 and
//     `custom` + `data.event` naming the action (src/reflex/contentTelemetry.ts:77-84).
//
// THE REPRESENTATION THIS FILE RULES (one for all six criteria):
//   · The settings are the tenant registry document's member (`PUT /config/reflex`,
//     the published, stamped, versioned reflex revision):
//       suppression: { actions: { <action>: { days? } }, purchase: { days? } }
//     A named action suppresses the values it carries; `purchase` makes the purchase
//     rule active. `days` is a positive whole number; absent is the default 30
//     (D2); anything else (0, a negative, a fraction, a string) refuses the write
//     naming `suppression` and `days`. Weights stay validated 0..1000 as today.
//   · remove_from_cart travels as the SDK's custom event naming it
//     (`{ type: 'custom', data: { event: 'remove_from_cart', … } }`), weighs 0 and
//     records, for that shopper, a suppression of every registry value it carries,
//     expiring `days` after the action; the purchase rule records a suppression of
//     the purchase's `productType` value expiring `days` after the purchase, while
//     the purchase strengthens every value it carries at the purchase weight as
//     today (style, collection, color and priceBand among them).
//   · While a suppression is in force, a suppressed value contributes no interest
//     term to any score (the stored interest is not changed); the piece stays
//     eligible; context terms (seeds, the complements preference, orders) apply as
//     before; at the expiry the suppression lapses.
//   · Every record of a decision made while a suppression is in force carries
//     `explain.suppressions: [{ action, dimension, expiresAt, value }]` (keys sorted,
//     entries sorted by dimension then value, `expiresAt` in epoch milliseconds);
//     its receipt carries the same member and a `why` sentence naming each value,
//     its action and its expiry date; the decision replays equal.
//   · Across an identity link (remaining-work item 2, "merge it on a link"; the S5
//     specification review's missing test): every suppression in force on the
//     anonymous shopper is in force on the linked shopper with its value, its action
//     and its `expiresAt` unchanged. Where both hold a suppression of one value (one
//     dimension and one value), the merge keeps the later `expiresAt` with its
//     action, whichever side holds it, so a link never shortens a suppression and
//     never lengthens one beyond what an action recorded; on equal expiries the
//     linked shopper's own is kept. (The same rule as a second action on one
//     shopper: the later expiry stands.) It runs where both hosts merge the
//     shopper's reflex state on a link (src/reflex/identityMerge.ts
//     mergeReflexStates, called by src/durable-objects/ShopperReflex.ts:3107 and
//     src/services/SessionManager.ts:650).
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the
// reflex member `suppression`, the record and receipt member `suppressions`. No new
// export is imported. P10 (the signal floor) is absent from this branch: the legs
// that read P10's own observable are marked "measured at build" (P10 lands before
// P39 builds) and fail first on a PRECONDITION naming P10.
//
// HARNESS: src/units/_parity.ts (mount, both hosts, the operator, the ledger) and
// src/units/_parity5.ts (the shopper with the reachable return); the identity link
// (`POST /v1/:tenant/identity/link` with the site's signed assertion,
// src/identity/assertion.ts) through the identity routes mounted as src/index.ts
// mounts them, as unit:W21.B1 and unit:W35 link a shopper.

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  asOperator, BRAND, errorsOf, HOSTS, mount, receiptsOf, REFLEX_DOCUMENT, readTree, replayOf, storedDecisions, TENANT, type Answer, type Decision, type Mounted,
} from '../_parity';
import { continuityReflex, DAY_MS, homeLearn, visitorOn, type Visitor } from '../_parity5';
import { signAssertion } from '@/identity/assertion';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { identityRoutes } from '@/routes/identity';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';

const PDP = 'pdp', RECS = 'pdp-recs';
const SITE = 'www.shop.test';
const PAID_SOCIAL = { utmMedium: 'paid_social', utmSource: 'instagram', referrer: 'l.instagram.com', siteHost: SITE };
const K = 1.8;
const BOUGHT = 'SKU-CROSSBODY-1';
const rec = (id: string, productType: string, over: Record<string, unknown> = {}) =>
  ({ id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'product-tile', title: id, tags: { productType: [productType] }, slotTypes: [RECS], lifecycle: { status: 'live' }, ...over });
/** Three recommendation tiles, one product type each; the wallet completes the crossbody bought. Catalogue order: crossbody, tote, wallet. */
const PIECES = [rec('rec.crossbody', 'crossbody'), rec('rec.tote', 'tote'), rec('rec.wallet', 'wallet', { complements: [BOUGHT] })];
/** The slot weights product type; a paid-social arrival seeds crossbody by 0.2 (a context term); the complements preference at 1. */
const slots = (extra: Record<string, unknown> = {}) => ({ version: 'parity5-slots', ...extra, pages: { [PDP]: [{ slot: RECS, take: 3, weights: { productType: 1 },
  seeds: [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'productType', value: 'crossbody' }], weight: 0.2 }], complements: { weight: 1 } }] } });
/** The tenant's registry on the investigation's §3.4 keys, scoring the event's own values; with the given suppression settings and the continuity block. */
const registry = (suppression?: unknown, weights: Record<string, number> = {}) => continuityReflex({ ...REFLEX_DOCUMENT, version: 'parity5-negative-registry',
  dimensions: ['productType', 'style', 'collection', 'color', 'priceBand'].map(key => ({ key, source: key })),
  weights: { ...REFLEX_DOCUMENT.weights, ...weights }, ...(suppression === undefined ? {} : { suppression }) });
const SETTINGS_1_DAY = { actions: { remove_from_cart: { days: 1 } }, purchase: { days: 1 } };
const SETTINGS_DEFAULT = { actions: { remove_from_cart: {} }, purchase: {} };
const docs = (suppression?: unknown, slotsExtra: Record<string, unknown> = {}) =>
  ({ pieces: PIECES, slots: slots(slotsExtra), learn: homeLearn({ slots: { [RECS]: { measurementBasis: 'served-v1', reward: 'click' } } }), reflex: registry(suppression) });

const view = (productId: string, productType: string) => ({ type: 'product_view', data: { productId, productType } });
const REMOVE = { type: 'custom', data: { event: 'remove_from_cart', productId: BOUGHT, productType: 'crossbody' } };
const PURCHASE = { type: 'purchase', data: { orderId: 'ORD-P39-1', value: 450, currency: 'USD', productId: BOUGHT, productType: 'crossbody', style: 'classic',
  collection: 'harbor', color: 'black', priceBand: 'core', items: [{ productId: BOUGHT, quantity: 1, price: 450 }] } };

/** The shopper's arrival (paid social) and taste: three crossbody views and one tote view. */
async function browsed(m: Mounted, opts: { continuity?: boolean } = {}): Promise<Visitor> {
  const v = await visitorOn(m, opts);
  expect((await v.action({ type: 'page_view', data: { path: '/' } }, { entry: PAID_SOCIAL })).status, `${m.host}: PRECONDITION — the shopper's arrival is accepted`).toBe(200);
  for (const [id, type] of [['SKU-CROSSBODY-1', 'crossbody'], ['SKU-CROSSBODY-2', 'crossbody'], ['SKU-CROSSBODY-3', 'crossbody'], ['SKU-TOTE-1', 'tote']]) {
    expect((await v.action(view(id!, type!))).status, `${m.host}: PRECONDITION — the shopper's view of ${id} is accepted`).toBe(200);
  }
  return v;
}
/** The tiles in served order with their public scores. */
const recsOf = (snap: { decisions: Array<{ contentId: string; slot: string; order: number; score?: number }> }) =>
  snap.decisions.filter(d => d.slot === RECS).sort((a, b) => a.order - b.order).map(d => [d.contentId, d.score ?? 0] as [string, number]);
const near = (rows: Array<[string, number]>) => rows.map(([id, score]) => [id, Math.round(score * 100) / 100]);
/** `GET /v1/:tenant/decisions/snapshot` naming the page's anchor product as `ctx.anchor` (the complements preference's context). */
async function anchoredSnapshot(m: Mounted, v: Visitor, anchor: string) {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot?page=${PDP}&brand=${TENANT}&ctx.anchor=${encodeURIComponent(anchor)}`, {
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: v.grant.capability } }));
  const body = await response.json().catch(() => ({})) as { decisions?: Array<{ contentId: string; slot: string; order: number; score?: number }> };
  await m.drain();
  return { status: response.status, decisions: body.decisions ?? [] };
}
/** `PUT /config/reflex` with the authored preconditions of the registry's head. */
async function putRegistry(m: Mounted, config: unknown): Promise<Answer> {
  const base = await asOperator(m, 'GET', '/config/reflex');
  expect(base.status, 'the operator reads the registry').toBe(200);
  const publication = base.body.publication as { revision: number; digest: string };
  return asOperator(m, 'PUT', '/config/reflex', { config, note: 'suppression settings' }, {
    'If-Match': `"${base.body.revision as number}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${base.body.revision as number}:${crypto.randomUUID()}` });
}

/** The identity routes, mounted as `src/index.ts` mounts them (`app.route('/v1', identityRoutes)`), over the same bindings. */
const identityApp = new Hono<{ Bindings: Env }>();
identityApp.use('*', tenantMiddleware());
identityApp.route('/v1', identityRoutes);
interface Linked { status: number; body: Record<string, unknown>; session?: { capability: string; subject: string; sessionId: string } }
/** `POST /v1/:tenant/identity/link` from the shopper's browser, carrying the assertion the site's backend signs with the tenant's identity material. */
async function link(m: Mounted, v: Visitor, accountId: string): Promise<Linked> {
  const material = String(m.env.IDENTITY_SECRETS).split(',').find(entry => entry.startsWith(`${TENANT}:`)) ?? '';
  const exp = Math.floor(Date.now() / 1000) + 300;
  const assertion = await signAssertion(material.slice(TENANT.length + 1).split('|')[0]!, TENANT as TenantId, v.subject, accountId, exp);
  const pending: Promise<unknown>[] = [];
  const response = await identityApp.fetch(new Request(`https://shop.invalid/v1/${TENANT}/identity/link`, {
    method: 'POST', body: JSON.stringify({ visitorId: v.subject, accountId, exp, assertion }),
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', [SHOPPER_HEADER]: v.grant.capability },
  }), m.env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  while (pending.length) await Promise.all(pending.splice(0));
  await m.drain();
  return { status: response.status, body, session: body.session as Linked['session'] };
}
/** The linked shopper's page through the route production serves, with the capability the link handed back. */
async function linkedPage(m: Mounted, capability: string): Promise<{ status: number; decisions: Decision[] }> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: PDP, brand: BRAND, entry: JSON.stringify(PAID_SOCIAL) }) }));
  const body = await response.json().catch(() => ({})) as { decisions?: Decision[] };
  await m.drain();
  return { status: response.status, decisions: body.decisions ?? [] };
}
/** The `explain.suppressions` of every stored record of a page's decisions. */
async function suppressionsOn(m: Mounted, subject: string, page: { decisions: Array<{ decisionId?: string }> }): Promise<unknown[]> {
  await m.drainLedger();
  const ids = new Set(page.decisions.map(d => d.decisionId));
  return storedDecisions(m, subject).filter(r => ids.has(r.decision_id)).map(r => (r.explain as unknown as { suppressions?: unknown }).suppressions ?? null);
}

// ===========================================================================
// unit:P39.NP1 — the settings, their refusals, the weight bound kept
// ===========================================================================

describe('unit:P39.NP1', () => {
  it('host: a tenant publishes the suppression settings without a deployment; a window that is not a positive whole number of days is refused naming it, and the action weights stay bounded 0 to 1000 as today', async () => {
    const m = await mount('session', docs());
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const published = await putRegistry(m, registry(SETTINGS_1_DAY));
    expect(published.status, `P39.NP1 — the settings publish through PUT /config/reflex: ${JSON.stringify(errorsOf(published))}`).toBe(200);
    expect(((await asOperator(m, 'GET', '/config/reflex')).body.config as Record<string, unknown>).suppression, 'P39.NP1 — the registry in force carries them').toEqual(SETTINGS_1_DAY);
    const refusals: Array<[string, unknown]> = [
      ['a window of 0 days', { actions: { remove_from_cart: { days: 0 } }, purchase: { days: 30 } }],
      ['a negative window', { actions: { remove_from_cart: { days: -3 } }, purchase: { days: 30 } }],
      ['a fraction of a day', { actions: { remove_from_cart: { days: 1.5 } }, purchase: { days: 30 } }],
      ['a window written as text', { actions: { remove_from_cart: { days: '30' } }, purchase: { days: 30 } }],
      ['a purchase window of 0 days', { actions: { remove_from_cart: { days: 30 } }, purchase: { days: 0 } }],
    ];
    const outcomes: Array<[string, number, boolean]> = [];
    for (const [name, suppression] of refusals) {
      const answer = await putRegistry(m, registry(suppression));
      outcomes.push([name, answer.status, errorsOf(answer).some(e => e.includes('suppression') && e.includes('days'))]);
    }
    expect(outcomes, `P39.NP1 — each window is refused (422) naming suppression and days`).toEqual(refusals.map(([name]) => [name, 422, true]));
    // LOCKED (src/reflex/configStore.ts:349-356): a weight is 0..1000; a negative one is refused, never a negative preference (D1).
    const weights: Array<[string, number]> = [];
    for (const w of [-1, 1001, 0]) weights.push([`remove_from_cart weight ${w}`, (await putRegistry(m, registry(SETTINGS_1_DAY, { remove_from_cart: w }))).status]);
    expect(weights, 'P39.NP1 — the weight bound is kept').toEqual([['remove_from_cart weight -1', 422], ['remove_from_cart weight 1001', 422], ['remove_from_cart weight 0', 200]]);
  }, 120_000);
});

// ===========================================================================
// unit:P39.NP2 — remove_from_cart suppresses the values it names, for its window
// ===========================================================================

describe('unit:P39.NP2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): remove_from_cart suppresses for the shopper the value it names: the next decision does not lead with the tile on the shopper's interest in it, other values and the arrival's seed unaffected, and after the window it lapses`, async () => {
      const T0 = Date.now() - 10 * DAY_MS;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const m = await mount(host, docs(SETTINGS_1_DAY));
        expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
        const v = await browsed(m, { continuity: true });
        const before = recsOf(await v.snapshot(PDP, { entry: PAID_SOCIAL }));
        // a = R / (R + K): crossbody 3 / 4.8 plus the seed 0.2; tote 1 / 2.8; wallet nothing.
        expect(near(before), `${host}: PRECONDITION — before the removal the shopper's crossbody interest leads`).toEqual(near([['rec.crossbody', 3 / (3 + K) + 0.2], ['rec.tote', 1 / (1 + K)], ['rec.wallet', 0]]));
        expect((await v.action(REMOVE)).status, `${host}: PRECONDITION — the removal is accepted`).toBe(200);
        const after = recsOf(await v.snapshot(PDP, { entry: PAID_SOCIAL }));
        expect(near(after), `${host}: P39.NP2 — crossbody no longer leads on the shopper's interest; tote is untouched; the seed still adds its 0.2 to crossbody`)
          .toEqual(near([['rec.tote', 1 / (1 + K)], ['rec.crossbody', 0.2], ['rec.wallet', 0]]));
        // After the 1-day window: the return on day 2 is decided on the shopper's interest again.
        clock.mockReturnValue(T0 + 2 * DAY_MS);
        await v.returnNow();
        expect((await v.action({ type: 'page_view', data: { path: '/' } }, { entry: PAID_SOCIAL })).status, `${host}: PRECONDITION — the shopper's return opens a visit`).toBe(200);
        const lapsed = recsOf(await v.snapshot(PDP, { entry: PAID_SOCIAL }));
        expect(lapsed.map(([id]) => id), `${host}: P39.NP2 — after the window the suppression lapses and the shopper's crossbody interest leads again`).toEqual(['rec.crossbody', 'rec.tote', 'rec.wallet']);
      } finally { clock.mockRestore(); }
    }, 180_000);

    it(`host (${host}): the removal weighs 0, so the shopper's count of signals is unchanged (R-P33) — measured at build on P10's own count (P10 lands before P39 builds)`, async () => {
      // P10's representation (src/units/P10/LEDGER.unit.test.ts, rem/spec-p10-fix1): a tenant `signalFloor` on the slots
      // document, and `explain.signalFloor: { floor, signals }` on every record of a decision below it.
      const m = await mount(host, docs(SETTINGS_1_DAY, { signalFloor: 9 }));
      expect(m.refused, `${host}: PRECONDITION (P10, measured at build) — the slots document carrying P10's tenant signalFloor publishes`).toBeNull();
      const v = await browsed(m);
      const signals = async () => {
        const snap = await v.snapshot(PDP, { entry: PAID_SOCIAL });
        await m.drainLedger();
        const ids = new Set(snap.decisions.map(d => d.decisionId));
        const record = storedDecisions(m, v.subject).find(r => ids.has(r.decision_id));
        return (record?.explain as { signalFloor?: { signals?: number } } | undefined)?.signalFloor;
      };
      const counted = await signals();
      expect(counted ? 'present' : 'absent', `${host}: PRECONDITION (P10, measured at build) — the record below the floor carries P10's explain.signalFloor`).toBe('present');
      expect((await v.action(REMOVE)).status, `${host}: PRECONDITION — the removal is accepted`).toBe(200);
      expect((await signals())?.signals, `${host}: P39.NP2 — the removal is no signal: the shopper's count is unchanged`).toBe(counted!.signals);
    }, 120_000);

    it(`host (${host}): a suppression recorded on the anonymous shopper is in force for the shopper after an identity link, with the same expiresAt; two suppressions of one value merge on a link to the later expiry, whichever side holds it`, async () => {
      const T0 = Date.now() - 3 * 3_600_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const m = await mount(host, docs(SETTINGS_1_DAY));
        expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
        const ACCOUNT = 'acct-p39-link';
        const at = (minute: number) => T0 + minute * 60_000;
        /** The suppression of crossbody by remove_from_cart, expiring the 1-day window after the removal at `removed`. */
        const held = (removed: number) => [{ action: 'remove_from_cart', dimension: 'productType', expiresAt: removed + DAY_MS, value: 'crossbody' }];
        const onEveryRecord = (removed: number) => [0, 1, 2].map(() => held(removed));
        // The anonymous shopper (browser A): the arrival and the taste, the removal at minute 10.
        const a = await browsed(m);
        clock.mockReturnValue(at(10));
        expect((await a.action(REMOVE)).status, `${host}: PRECONDITION — the removal is accepted`).toBe(200);
        const anonymous = await a.snapshot(PDP, { entry: PAID_SOCIAL });
        expect.soft(await suppressionsOn(m, a.subject, anonymous), `${host}: PRECONDITION (NP2, NP4) — the anonymous shopper's records carry the suppression, expiring a day after the removal`).toEqual(onEveryRecord(at(10)));
        clock.mockReturnValue(at(15));
        const first = await link(m, a, ACCOUNT);
        expect(first.status, `${host}: PRECONDITION — the identity link is accepted: ${JSON.stringify(first.body).slice(0, 240)}`).toBe(200);
        const linked = await linkedPage(m, first.session!.capability);
        expect(linked.status, `${host}: PRECONDITION — the linked shopper's page is served`).toBe(200);
        expect.soft(recsOf(linked).map(([id]) => id), `${host}: P39.NP2 — after the link the suppression is in force: the tote leads, crossbody does not lead on the shopper's interest`).toEqual(['rec.tote', 'rec.crossbody', 'rec.wallet']);
        expect.soft(await suppressionsOn(m, first.session!.subject, linked), `${host}: P39.NP2 — the linked shopper holds it with the same expiresAt as the anonymous shopper`).toEqual(onEveryRecord(at(10)));
        // Two more browsers of the same person remove the same value: C at minute 30, B at minute 40.
        clock.mockReturnValue(at(20));
        const b = await visitorOn(m), c = await visitorOn(m);
        clock.mockReturnValue(at(30));
        expect((await c.action(REMOVE)).status, `${host}: PRECONDITION — browser C's removal is accepted`).toBe(200);
        clock.mockReturnValue(at(40));
        expect((await b.action(REMOVE)).status, `${host}: PRECONDITION — browser B's removal is accepted`).toBe(200);
        // The queue is consumed before the links, as it is for browser A above (a record queued by an anonymous owner the link has retired is not the subject here).
        await m.drainLedger();
        // B is linked first: the later expiry is carried in.
        clock.mockReturnValue(at(45));
        const second = await link(m, b, ACCOUNT);
        expect(second.status, `${host}: PRECONDITION — browser B's link is accepted: ${JSON.stringify(second.body).slice(0, 240)}`).toBe(200);
        const later = await linkedPage(m, second.session!.capability);
        expect.soft(await suppressionsOn(m, second.session!.subject, later), `${host}: P39.NP2 — merged on the link: the later expiry, carried in, replaces the one held`).toEqual(onEveryRecord(at(40)));
        // C is linked last: an earlier expiry carried in leaves the later one held.
        clock.mockReturnValue(at(50));
        const third = await link(m, c, ACCOUNT);
        expect(third.status, `${host}: PRECONDITION — browser C's link is accepted: ${JSON.stringify(third.body).slice(0, 240)}`).toBe(200);
        expect([second.session?.subject, third.session?.subject], `${host}: PRECONDITION — the three links resolve one shopper`).toEqual([first.session?.subject, first.session?.subject]);
        const earlier = await linkedPage(m, third.session!.capability);
        expect.soft(await suppressionsOn(m, third.session!.subject, earlier), `${host}: P39.NP2 — and an earlier expiry carried in does not shorten the one held`).toEqual(onEveryRecord(at(40)));
      } finally { clock.mockRestore(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P39.NP3 — the purchase rule
// ===========================================================================

describe('unit:P39.NP3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a purchase strengthens style, collection, colour and price band at the purchase weight and suppresses the bought product type for the purchase window, and the complements preference still serves the matching wallet on the page of the crossbody bought`, async () => {
      const T0 = Date.now() - 10 * DAY_MS;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const m = await mount(host, docs(SETTINGS_1_DAY));
        expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
        const v = await visitorOn(m, { continuity: true });
        expect((await v.action({ type: 'page_view', data: { path: '/' } }, { entry: { referrer: '', siteHost: SITE } })).status, `${host}: PRECONDITION — the shopper's arrival is accepted`).toBe(200);
        for (const id of ['SKU-TOTE-1', 'SKU-TOTE-2']) expect((await v.action(view(id, 'tote'))).status, `${host}: PRECONDITION — the shopper's view of ${id}`).toBe(200);
        expect((await v.action(PURCHASE)).status, `${host}: PRECONDITION — the purchase is accepted`).toBe(200);
        const read = await v.hydrate();
        const dims = (read.body.affinity as { dims?: Record<string, Record<string, number>> } | null)?.dims ?? {};
        const r = (x: number | undefined) => (x === undefined ? 'no interest' : Math.round(x * 100) / 100);
        // LOCKED (src/reflex/core.ts:221-244, :567-592): each carried value strengthened at the purchase weight 5 → 5 / (5 + K).
        expect([dims.style?.classic, dims.collection?.harbor, dims.color?.black, dims.priceBand?.core].map(r),
          `${host}: P39.NP3 — style, collection, colour and price band strengthened at the purchase weight`).toEqual([0, 0, 0, 0].map(() => r(5 / (5 + K))));
        const page = recsOf(await v.snapshot(PDP));
        expect(near(page), `${host}: P39.NP3 — the bought crossbody does not lead on the shopper's interest (5 / (5 + K) suppressed); the tote does (2 / (2 + K))`)
          .toEqual(near([['rec.tote', 2 / (2 + K)], ['rec.crossbody', 0], ['rec.wallet', 0]]));
        const anchored = await anchoredSnapshot(m, v, BOUGHT);
        expect(anchored.status, `${host}: PRECONDITION — the page of the crossbody bought is served`).toBe(200);
        // LOCKED (src/content/decide.ts:330-341, :696-698): the wallet completes the anchor at the slot's weight 1.
        expect(recsOf(anchored)[0], `${host}: P39.NP3 — on the page of the crossbody bought the complements preference serves the matching wallet first`).toEqual(['rec.wallet', 1]);
        clock.mockReturnValue(T0 + 2 * DAY_MS);
        await v.returnNow();
        expect((await v.action({ type: 'page_view', data: { path: '/' } }, { entry: { referrer: '', siteHost: SITE } })).status, `${host}: PRECONDITION — the shopper's return opens a visit`).toBe(200);
        expect(recsOf(await v.snapshot(PDP)).map(([id]) => id), `${host}: P39.NP3 — after the 1-day purchase window the shopper's crossbody interest leads again`).toEqual(['rec.crossbody', 'rec.tote', 'rec.wallet']);
      } finally { clock.mockRestore(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P39.NP4 — the record and the receipt itemise each suppression; replay exact
// ===========================================================================

describe('unit:P39.NP4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): every record and receipt of a decision made under a suppression itemise the value, the action and the expiry (the default 30 days), the decision replays equal, and a decision without one replays as before`, async () => {
      const m = await mount(host, docs(SETTINGS_DEFAULT), { recovery: false });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const v = await browsed(m);
      const first = await v.snapshot(PDP, { entry: PAID_SOCIAL });
      const T = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T);
      let second;
      try {
        expect((await v.action(REMOVE)).status, `${host}: PRECONDITION — the removal is accepted`).toBe(200);
        second = await v.snapshot(PDP, { entry: PAID_SOCIAL });
      } finally { clock.mockRestore(); }
      await m.drainLedger();
      const stored = storedDecisions(m, v.subject);
      const ids = (snap: typeof first) => new Set(snap.decisions.map(d => d.decisionId));
      const underSuppression = stored.filter(r => ids(second!).has(r.decision_id)), without = stored.filter(r => ids(first).has(r.decision_id));
      expect([underSuppression.length, without.length], `${host}: PRECONDITION — the ledger holds both decisions' three records`).toEqual([3, 3]);
      const expected = [{ action: 'remove_from_cart', dimension: 'productType', expiresAt: T + 30 * DAY_MS, value: 'crossbody' }];
      for (const r of underSuppression) {
        expect.soft((r.explain as Record<string, unknown>).suppressions, `${host}: P39.NP4 — the record of ${r.item_id} itemises the suppression in force, its action and its 30-day expiry`).toEqual(expected);
      }
      const receipts = (await receiptsOf(m, v.subject)).filter(r => ids(second!).has(r.decision_id as string));
      expect(receipts.length, `${host}: PRECONDITION — a receipt for each record`).toBe(3);
      const day = new Date(T + 30 * DAY_MS).toISOString().slice(0, 10);
      for (const r of receipts) {
        expect.soft(r.suppressions, `${host}: P39.NP4 — the receipt of ${String(r.item)} itemises it`).toEqual(expected);
        expect.soft((r.why as string[]).some(s => /suppress/i.test(s) && s.includes('crossbody') && s.includes('remove_from_cart') && s.includes(day)),
          `${host}: P39.NP4 — and says it in words: the value, the action, the expiry ${day} (why: ${JSON.stringify(r.why)})`).toBe(true);
      }
      const replays = async (records: typeof stored) => {
        const out: unknown[] = [];
        for (const r of records) { const replay = await replayOf(m, r.decision_id); out.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
        return out;
      };
      expect(await replays(underSuppression), `${host}: P39.NP4 — the decision made under the suppression replays equal`).toEqual(underSuppression.map(r => [r.item_id, 200, 'equal']));
      // LOCKED (src/learn/replay.ts): a record without a suppression replays as before.
      expect(await replays(without), `${host}: P39.NP4 — a record without one replays as before`).toEqual(without.map(r => [r.item_id, 200, 'equal']));
    }, 180_000);
  }
});

// ===========================================================================
// unit:P39.NP5 — a tenant without the settings decides as today
// ===========================================================================

describe('unit:P39.NP5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a tenant without the settings decides term for term as today: the removal changes nothing, the purchase strengthens every value it carries including the product type, and each decision replays equal (the src/units/P10 clause measured at build)`, async () => {
      const m = await mount(host, docs(), { recovery: false });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const v = await browsed(m);
      const before = await v.snapshot(PDP, { entry: PAID_SOCIAL });
      expect((await v.action(REMOVE)).status, `${host}: PRECONDITION — the removal is accepted`).toBe(200);
      const afterRemoval = await v.snapshot(PDP, { entry: PAID_SOCIAL });
      // LOCKED (src/reflex/contentTelemetry.ts:77-84, src/reflex/core.ts:221-244): remove_from_cart names no weight, so it is 0 and builds nothing.
      expect(near(recsOf(afterRemoval)), `${host}: P39.NP5 — the removal changes nothing`).toEqual(near(recsOf(before)));
      expect((await v.action(PURCHASE)).status, `${host}: PRECONDITION — the purchase is accepted`).toBe(200);
      const afterPurchase = await v.snapshot(PDP, { entry: PAID_SOCIAL });
      // The purchase adds 5 to the shopper's crossbody interest: (3 + 5) / (8 + K), plus the seed.
      expect(near(recsOf(afterPurchase)), `${host}: P39.NP5 — the purchase strengthens the product type too, as today`)
        .toEqual(near([['rec.crossbody', 8 / (8 + K) + 0.2], ['rec.tote', 1 / (1 + K)], ['rec.wallet', 0]]));
      await m.drainLedger();
      const replays: unknown[] = [];
      for (const r of storedDecisions(m, v.subject)) { const replay = await replayOf(m, r.decision_id); replays.push([replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
      expect(replays.length, `${host}: PRECONDITION — the ledger holds the three decisions' records`).toBe(9);
      expect(replays, `${host}: P39.NP5 — each replays equal`).toEqual(replays.map(() => [200, 'equal']));
    }, 180_000);
  }
});

// ===========================================================================
// unit:P39.NP6 — the kit documents the settings, the rule and the receipt line
// ===========================================================================

describe('unit:P39.NP6', () => {
  it('logic: docs/kit/02-api-reference.md and docs/kit/03-payload-schemas.md document the suppression settings, the purchase rule and the receipt line', () => {
    const missing: string[] = [];
    for (const file of ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']) {
      const lines = readTree(file).split('\n');
      const has = (...words: string[]) => lines.some(line => words.every(w => line.includes(w)));
      if (!has('suppression', 'remove_from_cart', 'days')) missing.push(`${file}: the suppression settings (the actions and their windows in days)`);
      if (!has('purchase', 'productType', 'style', 'collection', 'color', 'priceBand')) missing.push(`${file}: the purchase rule (style, collection, color and priceBand strengthened; productType suppressed)`);
      if (!has('30 days', 'suppression')) missing.push(`${file}: the default window of 30 days`);
      if (!has('suppressions', 'expiresAt')) missing.push(`${file}: the record and receipt line (suppressions with expiresAt)`);
    }
    expect(missing, 'P39.NP6 — the kit documents the rule').toEqual([]);
  });
});
