// src/units/P85/LEDGER.unit.test.ts
// P85 under the Closure Ledger: the tests for the LOCAL criteria CX1-CX3 of the P85 work order (the activation programme
// of amendment 11, group B, ticket P85 "An exposure record for a carousel drawn before paint", E9; batch S31). LV1 is a
// deferred live row and gets no test. The shapes were proposed at f7552cb0 and RULED by R-P382 (below).
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md, section 2,
// E9):
//   "**Authority:** the carousel design note (credit and the holdout comparison)."
//   "**Done when:** a carousel order applied by the head script before paint is recorded as an exposure of that page view
//   with its context and arm, as the layout exposure is for modules, and credited the same way."
//   "**Starts from:** the layout exposure beacon (P30)." "**Relates to:** P30, P33."
// The carousel design note §9 (docs/tapestry-packs/1-front-end/10-carousel-design-note.md, the Windows checkout; a document
//   only): "Impression | An image is first on screen ... | Exposure: which image was seen, in which position and context";
//   "Click | A tap on an image | Engagement: credits that image and its shot type ..."; "The SDK captures both ... under the
//   shopper's tracking consent only; add to bag and purchase are credited to the carousel the shopper saw." (Its §11 is
//   "The honest trade-off" and names no holdout comparison; the brief's "§11 the holdout comparison" reads E9's authority.)
// The work order (docs/parity/activation/program.json, P85): CX1 the beacon (the context key or table row, the page, the
// carousel slot, the image ids in drawn order, the pageInstance) adds one exposure per drawn image to its context's
// learning, once per page view, under tracking consent, for a key or row the engine issued; CX2 an engagement or outcome
// of a beacon-drawn image credited to that exposure as a layout module's is (P30, P33), the holdout's arms never counted,
// P30's layout beacon unchanged; CX3 the kit (kit 01 :582-587; kit 02 :209-216 and :639; kit 03 :26 and :1095).
//
// P84'S SHAPES THIS FILE RELIES ON (P84 final at 72aa84ed, joined at 6af00c40): GET /v1/<tenant>/context-table/<page>
// (`version` the SHA-256 of the document's canonical bytes; `rows` [{ channel, visitBucket, layout, shotOrder: { mobile,
// desktop } }]; `default`; `carouselSlot`; `holdout`), src/content/decide.ts contextTableOf; the head script's outputs
// `data-op-context` (`<channel>|<visitBucket>|<device>` or `default`), `data-op-arm` (`default` | `personalized`),
// `data-op-table` (the version), the painted order in `--op-<carouselSlot>-<n>`.
//
// THE SHAPES (proposed at f7552cb0, ruled by R-P382; each asserted below):
//   S1 The beacon: `client.listen.carouselExposure({ tableVersion, context, page, slot, images, arm })` once per page view
//      and carousel slot, the SDK adding the page view's `pageInstance` as `layoutExposure` does (src/sdk/listen.ts
//      layoutExposure); sent as the action `carousel_exposure` with data `{ tableVersion, context, page, slot, images,
//      pageInstance, arm }` (images in painted order, 1..50 distinct ids), only under tracking consent; it asks for no
//      decisions. The route answers it itself before any host, as `layout_exposure` (src/routes/realtime.ts): `{ success:
//      true, exposure: 'admitted', images: n }` or `{ success: true, exposure: 'ignored', reason }`; malformed data 400
//      'Invalid carousel exposure'.
//   S2 Ignored reasons (P30's words where P30 has one): `tracking_refused` (no tracking consent); `stale_table` (a version
//      that is not the one in force, S3); `unknown_context` (a context that version has no row for: channel × bucket of
//      its rows and a device mobile|desktop, or `default`); `not_carousel` (a slot that is not that version's
//      `carouselSlot` for the page); `unknown_image` (an image that is not a catalogue piece naming the slot, or more
//      images than the slot's take); `not_learning` (the ENGINE's arm for the shopper is the holdout's `default` or
//      `no_learning`, R-P393; R3: it records nothing); `not_measured` (the carousel not on `rendered-v1`, P30's rule); `unavailable`. A repeat for
//      the same page view is answered `admitted` and counted once (P30's form; R-P382 amends the brief's "ignored").
//   S3 Only the table version in force for the page is admitted; a page cached before a publication sends `stale_table`
//      for up to a minute (the stable address's max-age), told in the kit (R-P382; the replaced-version window dropped).
//   S4 The learning: one exposure per drawn image in the carousel slot's statistics object, in the cell of the context's
//      channel and visit bucket (P30's form: stage unknown, no region, no interest; the device no learning level), each
//      row's identity the page view's own (the shopper, the page, the slot, the painted position, the pageInstance), so a
//      repeat for the same page view is counted once. A `default` context counts at the root only. Per image, not per shot
//      type (R4): the shot-type roll-up is a recorded residual.
//   S5 The credit (R1 as R-P382 rules it, "credited the same way" = as P30's modules are credited today): an engagement
//      (`content_click`) or an outcome (`add_to_cart`) of a beacon-drawn image is credited when the shopper's ring holds the
//      engine's own decision for that image on that page view (the decision set the SDK takes after paint, its render
//      acknowledged), through the ring's existing crediting (src/learn/fan.ts's routes; src/durable-objects/DecisionRing.ts
//      not granted); a cached paint without a decision credits nothing; the holdout's click credits nothing; one click is
//      credited once whatever the beacon added (no double credit).
//
// READINGS THE CODE CONTRADICTED, AS R-P382 RULES THEM: R1 (a cached paint reaches no ring: credit only through the
// engine's own decision, S5); R2 (repeats answered admitted, S2); R3 (the holdout's beacon ignored, nothing recorded,
// S2); R4 (per image, S4); R5 (no issued-version store: the version in force only, S3).
//
// R10 SWEEP (none needed on these shapes): P30's layout beacon locks (src/units/P30/LEDGER.unit.test.ts :431-462, the
// host legs; :464-494, the SDK leg) hold: `layout_exposure` and its `not_context_only` are unchanged (asserted here as a
// lock); src/events/actionTypes.test.ts reads the list generically (:40-44); P79's beacon reads (src/units/P79/
// LEDGER.unit.test.ts :462, :471, :600) filter `layout_exposure` by type. To measure under the sketch: the realtime action
// tests, the fan tests, the SDK tests, P79, P81, P84.
//
// R-P393 (from the builder's plan): `not_learning` is decided by the ENGINE's own arm — the shopper's assignment as the
// decision draws it (armFor over the enrollment anchor; an unavailable anchor is not_learning, fail closed) — never the
// page's claim; the page's `arm` stays in the beacon, the answer carries it as `armClaimed`, and a disagreement between
// the claim and the engine's arm is counted in P84's arm_draw `mismatch` (the learn queue). The `default` context is
// recorded as the engine records an unknown context (the cell { channel: unknown, visit_bucket: unknown }: the root and
// the c=unknown level); these tests read the root. src/routes/decisions.ts is granted (adb14184) for the shared
// table-version helper.
// R-P398 (the spec review at 405ddca8): the fail-closed rule pinned — a recognised shopper whose anchor cannot be read is
// `not_learning` (W21.E1.08's harness form: the identity projection's reads failing on the sessions and cache stores).
// GRANT (R-P386, 24a45d6d): src/sdk/wire.ts is in P85's allowedPaths — the SDK's wire table sends an unlisted type as
// `custom`, so `carousel_exposure` needs its entry (src/sdk/wire.ts :35). MEASURED (s31b, 7e32d3a8): under the sketch the
// SDK bundles grow past their recorded budgets (edge-personalization.esm.js 108,329 of 107,520 bytes, edge-personalization.js
// 113,714 of 112,640), so `build-sdk --check` fails (P84.CO2's build leg): packages/sdk/package.json's sizeBudget follows
// W40.P3's rule (the measured size rounded up to the next 5,120 bytes), set by the builder (a granted path), no R10.
// NO NEW EXPORT IS IMPORTED. Read loosely: `listen.carouselExposure`, the action `carousel_exposure`, the answer members.
// DEFERRED / RESIDUAL: LV1; the shot-type roll-up (R4); the day report's carousel rows.
//
// HARNESS: src/units/_parity.ts (the mounted app, real DO classes, both hosts; `learned`), src/sdk/testHost.ts (the SDK
// leg). Imports from src/units/: ../_parity.

import { describe, expect, it } from 'vitest';

import { issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { createCore } from '@/sdk/core';
import { createListen } from '@/sdk/listen';
import { testHost } from '@/sdk/testHost';
import type { RequestInitLike, ResponseLike } from '@/sdk/types';

import {
  asOperator, BRAND, declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learnDocument, learned, MODULES, mount, pageInstanceOf, putDocument, readTree, shopperOn, TENANT,
  type Answer, type Decision, type Mounted, type Shopper,
} from '../_parity';

// ---------------------------------------------------------------------------
// The fixture: P84's product page — the declared layout slot and its carousel with per-context shot orders, the images of
// one product with their shot tags (an untagged one, an unnamed shot), the wallet's image (another product's, a cross
// input); the carousel measured on rendered-v1, learning against the click; no holdout.
// ---------------------------------------------------------------------------

const CAROUSEL = 'pdp-carousel';
const A = 'COA-CH857', B = 'COA-CB925';
const image = (n: number, contentType: string[] | null, product = A) => ({ id: `img-${product.slice(4).toLowerCase()}-${n}`, customerContentId: `TAP-IMG-${product}-${n}`,
  type: 'image', title: `${product} image ${n}`, tags: { category: [product === A ? 'Handbags' : 'Small Leather Goods'], ...(contentType ? { contentType } : {}) },
  slotTypes: product === A ? [CAROUSEL] : ['pdp-wallets'], lifecycle: { status: 'live' }, featuredProductIds: [product] });
const IMAGES = [image(1, ['studio']), image(2, ['flat_lay']), image(3, ['on_model']), image(4, ['detail']), image(5, ['on_model']), image(6, ['studio']),
  image(7, null), image(8, ['video'])];
const WALLET = image(1, ['on_model'], B);
const id = (n: number) => `img-ch857-${n}`;
const SHOT_ORDERS = [
  { context: { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' }, order: ['on_model', 'detail', 'studio', 'flat_lay'] },
  { context: { channel: 'email', visitBuckets: 'any' }, order: ['flat_lay', 'detail', 'studio', 'on_model'] },
];
const carousel = (over: Record<string, unknown> = {}) => ({ slot: CAROUSEL, take: 8, weights: { category: 1 }, shotOrders: SHOT_ORDERS, ...over });
const SLOTS = { ...declaredSlots([]), pages: { pdp: [layoutSlot(), carousel()] } };
const learnOf = (reward = 'click', holdout?: Record<string, unknown>) =>
  learnDocument({ [CAROUSEL]: { measurementBasis: 'rendered-v1', reward } }, holdout ? { holdout } : {});
const DOCS = { pieces: [...MODULES, ...IMAGES, WALLET], slots: SLOTS, learn: learnOf() };
const docsWith = (over: { slots?: unknown; learn?: unknown }) => ({ ...DOCS, ...over });
/** The paint P84's head script makes for paid social on mobile: on_model, detail, studio, flat_lay, then the rest. */
const PAINTED = [id(3), id(5), id(4), id(1), id(6), id(2), id(7), id(8)];

/** The table in force, as the server render reads it (P84). */
async function tableOf(m: Mounted): Promise<{ status: number; version: string; rows: unknown[] }> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/context-table/pdp`, { headers: { 'X-Tenant': TENANT } }));
  const body = await response.json().catch(() => ({})) as { version?: unknown; rows?: unknown };
  return { status: response.status, version: typeof body.version === 'string' ? body.version : '', rows: Array.isArray(body.rows) ? body.rows : [] };
}
/** The beacon as the SDK sends it (S1), through POST /realtime/action. */
const carouselBeacon = (s: Pick<Shopper, 'action'>, data: Record<string, unknown>): Promise<Answer> =>
  s.action({ type: 'carousel_exposure', data: { page: 'pdp', slot: CAROUSEL, arm: 'personalized', ...data } });
/** What the carousel's statistics object holds for an item at one level key (P30's read, on the carousel slot's object alone): `n` exposures, `s` credits. */
async function at(m: Mounted, key: string, field: 'n' | 's'): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of [...m.stats.keys()].sort().filter(n => n.endsWith(`:${CAROUSEL}`))) {
    const response = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/snapshot', { method: 'POST' });
    const body = await response.json().catch(() => ({})) as { snapshot?: { items?: Record<string, Record<string, { n: number; s: number }>> } | null };
    for (const [item, cells] of Object.entries(body.snapshot?.items ?? {})) if (cells[key]) out[item] = Math.round((out[item] ?? 0) + cells[key]![field]);
  }
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n !== 0));
}
const CELL = 'c=paid_social|v=1';
/**
 * R-P398: a RECOGNISED shopper (a canonical `sh_` id, a recognised session) with her own explicit choice through the real
 * route — the shopper whose enrollment anchor is read from the identity projection (src/content/holdout.ts
 * enrollmentAnchorOf), unlike `shopperOn`'s anonymous browser, which is its own anchor.
 */
async function recognisedOn(m: Mounted): Promise<Pick<Shopper, 'action'> & { subject: string }> {
  const subject = `sh_${crypto.randomUUID().replace(/-/g, '')}`;
  const grant = await issueSessionCapability(m.env, { tenant: TENANT, subject, sessionId: `s-${crypto.randomUUID()}`, kind: 'recognized' });
  const call = async (path: string, body: unknown): Promise<Answer> => {
    const response = await m.fetch(new Request(`https://shop.invalid${path}`, { method: 'POST',
      headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
    await m.drain();
    return answer;
  };
  const chosen = await call(`/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
    choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } });
  expect(chosen.status, `PRECONDITION (${m.host}): the recognised shopper's explicit choice is accepted (${JSON.stringify(chosen.body).slice(0, 160)})`).toBe(200);
  return { subject, action: (event: { type: string; data: Record<string, unknown> }) => call('/realtime/action', { ...event, source: 'sdk', userId: subject,
    sessionId: grant.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() }) };
}
/** W21.E1.08's form (src/units/W21/B2.unit.test.ts): the identity projection's reads fail on the sessions and the cache stores. */
function identityReadsFail(m: Mounted): void {
  for (const store of [m.env.SESSIONS, m.cache] as unknown as Array<{ get: (key: string, type?: string) => Promise<unknown> }>) {
    const get = store.get.bind(store);
    store.get = async (key: string, type?: string) => { if (key.startsWith('identity:shopper:')) throw new Error('identity store unavailable'); return get(key, type); };
  }
}
const answerOf = (a: Answer) => [a.status, a.body.exposure ?? null, a.body.reason ?? a.body.images ?? null];

// ===========================================================================
// unit:P85.CX1 — the carousel beacon: admitted for the version in force and a named row, once per page view; ignored by name
// ===========================================================================

describe('unit:P85.CX1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a beacon under tracking consent naming the table version in force, a row's context (paid social, visit 1, mobile), the carousel slot and the eight images in painted order is admitted and adds one exposure per drawn image to that context's cell; a repeat for the same page view adds nothing (P30's journal, answered admitted); a default context is admitted and counts at the root only`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX1 — P84\'s product page publishes');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m);
      const pageInstance = pageInstanceOf('p85-cx1');
      const first = await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance });
      const repeat = await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance });
      await m.drainLedger();
      expect.soft([answerOf(first), answerOf(repeat)], `${host}: P85.CX1 — admitted, the repeat too (P30's form) (today the action is refused: ${JSON.stringify(first.body).slice(0, 160)})`)
        .toEqual([[200, 'admitted', 8], [200, 'admitted', 8]]);
      expect.soft(await at(m, CELL, 'n'), `${host}: P85.CX1 — one exposure per drawn image in the context's cell, the repeat counted once`)
        .toEqual(Object.fromEntries(PAINTED.map(item => [item, 1])));
      const cellBefore = await at(m, CELL, 'n');
      const fallback = await carouselBeacon(s, { tableVersion: table.version, context: 'default', images: IMAGES.map(p => p.id), pageInstance: pageInstanceOf('p85-cx1-default') });
      await m.drainLedger();
      expect.soft([answerOf(fallback), await at(m, 'c=unknown', 'n'), await at(m, CELL, 'n')],
        `${host}: P85.CX1 — the default row admitted and counted as an unknown context is (R-P393): at the c=unknown level of the carousel's own object, the paid-social cell unchanged`)
        .toEqual([[200, 'admitted', 8], Object.fromEntries(IMAGES.map(p => [p.id, 1])), cellBefore]);
    }, 120_000);

    it(`host (${host}): ignored by name and adding nothing — no tracking consent (tracking_refused), a version never issued (stale_table), a context the version has no row for (unknown_context), a slot that is not the carousel (not_carousel), another product's image (unknown_image); malformed data 400; P30's layout beacon on the carousel slot still answers not_context_only (lock)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX1 — the documents publish');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m), untracked = await shopperOn(m, { tracking: false, personalization: false });
      const valid = { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED };
      const cases: Array<[string, Shopper, Record<string, unknown>, string]> = [
        ['no tracking consent', untracked, valid, 'tracking_refused'],
        ['a version never issued', s, { ...valid, tableVersion: '0'.repeat(64) }, 'stale_table'],
        ['a context with no row (a bucket outside the cut)', s, { ...valid, context: 'paid_social|7|mobile' }, 'unknown_context'],
        ['a context with no row (a channel outside the words)', s, { ...valid, context: 'tiktok|1|mobile' }, 'unknown_context'],
        ['a context with no row (a device outside the classes)', s, { ...valid, context: 'paid_social|1|watch' }, 'unknown_context'],
        ['the layout slot', s, { ...valid, slot: LAYOUT, images: [MODULES[0]!.id] }, 'not_carousel'],
        ['another product\'s image', s, { ...valid, images: [id(3), WALLET.id] }, 'unknown_image'],
      ];
      const answers: unknown[][] = [];
      for (const [name, who, data] of cases) answers.push([name, ...answerOf(await carouselBeacon(who, { ...data, pageInstance: pageInstanceOf('p85-cx1-ignored') }))]);
      await m.drainLedger();
      expect.soft(answers, `${host}: P85.CX1 — each ignored by name`).toEqual(cases.map(([name, , , reason]) => [name, 200, 'ignored', reason]));
      expect.soft(await at(m, CELL, 'n'), `${host}: P85.CX1 — and nothing counted`).toEqual({});
      const malformed: unknown[][] = [];
      for (const data of [{ ...valid, images: [] }, { ...valid, images: [id(3), id(3)] }, { ...valid, tableVersion: 7 }, { ...valid, context: '' }, { ...valid, arm: 'treated' }]) {
        const answer = await carouselBeacon(s, { ...data, pageInstance: pageInstanceOf('p85-cx1-malformed') });
        malformed.push([answer.status, answer.body.error ?? null]);
      }
      expect.soft(malformed, `${host}: P85.CX1 — malformed beacons refused 400 by name`).toEqual(malformed.map(() => [400, 'Invalid carousel exposure']));
      const layout = await s.action({ type: 'layout_exposure', data: { contextKey: 'pdp|c=paid_social|v=1|k=0', page: 'pdp', slot: CAROUSEL, modules: [id(3)], pageInstance: pageInstanceOf('p85-cx1-lock') } });
      expect.soft([layout.status, layout.body.exposure ?? null, layout.body.reason ?? null], `${host}: P85.CX1 — LOCK: P30's layout beacon is unchanged`).toEqual([200, 'ignored', 'key_not_issued']);
    }, 120_000);

    it(`host (${host}): two more ignored reasons, adding nothing — a carousel not measured on rendered-v1 (not_measured), and more images than the carousel's take (unknown_image)`, async () => {
      const servedLearn = learnDocument({ [CAROUSEL]: { measurementBasis: 'served-v1', reward: 'click' } });
      const served = await mount(host, docsWith({ learn: servedLearn }));
      expectPublished(served, 'P85.CX1 — the carousel on served-v1 publishes');
      const narrow = await mount(host, docsWith({ slots: { ...SLOTS, pages: { pdp: [layoutSlot(), carousel({ take: 4 })] } } }));
      expectPublished(narrow, 'P85.CX1 — the carousel taking four publishes');
      const answers: unknown[][] = [];
      for (const [name, m] of [['not on rendered-v1', served], ['eight images on a carousel taking four', narrow]] as const) {
        const table = await tableOf(m);
        expect(table.status, `${host}: PRECONDITION P84 — the context table answers (${name})`).toBe(200);
        const answer = await carouselBeacon(await shopperOn(m), { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance: pageInstanceOf('p85-cx1-more') });
        await m.drainLedger();
        answers.push([name, ...answerOf(answer), Object.keys(await at(m, CELL, 'n')).length]);
      }
      expect.soft(answers, `${host}: P85.CX1 — each ignored by name, nothing counted`).toEqual([['not on rendered-v1', 200, 'ignored', 'not_measured', 0],
        ['eight images on a carousel taking four', 200, 'ignored', 'unknown_image', 0]]);
    }, 120_000);

    it(`host (${host}): the engine's own arm decides (R-P393) — a shopper the engine assigns to the holdout's default arm is ignored not_learning even when the page claims personalized, and a personalized shopper is admitted even when the page claims default; each answer carries the page's claim as armClaimed and each disagreement is counted in the learn queue's arm_draw mismatch`, async () => {
      const outcome = async (learn: unknown, claim: string) => {
        const m = await mount(host, docsWith({ learn }));
        expectPublished(m, 'P85.CX1 — the documents publish');
        const table = await tableOf(m);
        expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
        const s = await shopperOn(m);
        const answer = await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance: pageInstanceOf('p85-cx1-claim'), arm: claim });
        await m.drainLedger();
        const queue = await asOperator(m, 'GET', `/v1/${TENANT}/learn/queue?brand=${BRAND}`);
        return [...answerOf(answer), answer.body.armClaimed ?? null, (queue.body.arm_draw as { mismatch?: number } | undefined)?.mismatch ?? null, Object.keys(await at(m, CELL, 'n')).length];
      };
      const holdoutClaimingPersonalized = await outcome(learnOf('click', { share: 1, salt: 'p85-holdout', arms: ['default'] }), 'personalized');
      const personalizedClaimingDefault = await outcome(learnOf(), 'default');
      expect.soft({ holdoutClaimingPersonalized, personalizedClaimingDefault }, `${host}: P85.CX1 — the engine's arm, never the page's claim, decides; the disagreement counted`).toEqual({
        holdoutClaimingPersonalized: [200, 'ignored', 'not_learning', 'personalized', 1, 0], personalizedClaimingDefault: [200, 'admitted', 8, 'default', 1, 8] });
    }, 120_000);

    it(`host (${host}): fail closed (R-P393, R-P398) — a recognised shopper whose enrollment anchor cannot be read (her identity projection's reads fail) is ignored not_learning, nothing counted, though the page claims personalized and the holdout share is 0`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX1 — the documents publish');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await recognisedOn(m);
      identityReadsFail(m);
      const answer = await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance: pageInstanceOf('p85-cx1-unavailable') });
      await m.drainLedger();
      expect.soft([...answerOf(answer), Object.keys(await at(m, CELL, 'n')).length], `${host}: P85.CX1 — an unavailable anchor is not learning (fail closed), nothing counted`)
        .toEqual([200, 'ignored', 'not_learning', 0]);
    }, 120_000);

    it(`host (${host}): the version in force only (S3) — after a slots publication moves the version, a beacon naming the replaced version is ignored stale_table at once and the new version is admitted`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX1 — the documents publish');
      const old = await tableOf(m);
      expect(old.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const moved = await putDocument(m, 'slots', { ...SLOTS, pages: { pdp: [layoutSlot(), carousel({ shotOrders: [SHOT_ORDERS[0]] })] } }, 'p85 one order');
      expect(moved.status, `${host}: PRECONDITION — the changed shot orders publish`).toBe(200);
      const current = await tableOf(m);
      expect(current.version !== old.version, `${host}: PRECONDITION P84 — the version moved`).toBe(true);
      const s = await shopperOn(m);
      const send = (version: string, label: string) => carouselBeacon(s, { tableVersion: version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance: pageInstanceOf(label) });
      const replaced = await send(old.version, 'p85-cx1-replaced');
      const fresh = await send(current.version, 'p85-cx1-current');
      expect.soft([answerOf(replaced), answerOf(fresh)], `${host}: P85.CX1 — the replaced version stale at once, the version in force admitted`)
        .toEqual([[200, 'ignored', 'stale_table'], [200, 'admitted', 8]]);
    }, 120_000);
  }

  it('sdk: the real SDK sends one carousel_exposure per page view and carousel slot under tracking consent, with the head script\'s values and the page view, asking for no decisions; none without tracking consent', async () => {
    const sentBy = async (tracking: boolean) => {
      const f = testHost({ responses: () => ({ success: true }) });
      if (!tracking) {
        const base = f.host.fetch;
        f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
          const answer = await base(url, init);
          if (!url.endsWith('/identity/session')) return answer;
          const body = await answer.json() as { session: { consent: { tracking: boolean; personalization: boolean; instruction: Record<string, unknown> } } };
          const refused = { value: false, chosenAt: f.host.now(), expiresAt: f.host.now() + 30 * 86_400_000 };
          body.session.consent = { ...body.session.consent, tracking: false, personalization: false, instruction: { ...body.session.consent.instruction, tracking: refused, personalization: refused } };
          return { ok: true, status: 200, json: async () => body };
        };
      }
      const core = createCore({ tenant: 'coach', source: 'coach-pdp' }, f.host);
      const listen = createListen(core) as unknown as Record<string, unknown>;
      expect(await core.ready(), 'PRECONDITION: the client is ready').toBe(true);
      const send = listen.carouselExposure as ((beacon: Record<string, unknown>) => Promise<unknown>) | undefined;
      expect(typeof send, 'P85.CX1 — the SDK offers listen.carouselExposure').toBe('function');
      const snapshotsBefore = f.calls.filter(c => c.url.includes('/decisions/snapshot')).length;
      const beacon = { tableVersion: 'a'.repeat(64), context: 'paid_social|1|mobile', page: 'pdp', slot: CAROUSEL, images: PAINTED, arm: 'personalized' };
      await send!(beacon);
      await send!(beacon);
      for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
      return { sent: f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!) as { type: string; data: Record<string, unknown> })
        .filter(e => e.type === 'carousel_exposure'), asked: f.calls.filter(c => c.url.includes('/decisions/snapshot')).length - snapshotsBefore };
    };
    const tracked = await sentBy(true);
    expect.soft({ beacons: tracked.sent.map(e => [e.data.tableVersion, e.data.context, e.data.page, e.data.slot, e.data.images, e.data.arm, typeof e.data.pageInstance]), asked: tracked.asked },
      'P85.CX1 — under tracking consent one carousel_exposure per page view and slot, carrying the head script\'s values and the page view; no decision asked')
      .toEqual({ beacons: [['a'.repeat(64), 'paid_social|1|mobile', 'pdp', CAROUSEL, PAINTED, 'personalized', 'string']], asked: 0 });
    expect.soft((await sentBy(false)).sent.length, 'P85.CX1 — without tracking consent the SDK sends no beacon').toBe(0);
  });
});

// ===========================================================================
// unit:P85.CX2 — the credit: a click and an add to bag on a beacon-drawn image; the holdout's arms; no double credit
// ===========================================================================

/** A click on an image of the page view, as the SDK's capture sends it for a painted image (S5): no decision behind it. */
const clickOn = (s: Shopper, image: string, position: number, pageInstance: string) => s.action({ type: 'content_click',
  data: { contentId: image, slot: CAROUSEL, page: 'pdp', pageInstance, position } });

/** The decision set the SDK takes after paint, and the render of one image's decision acknowledged: the ring then holds it (S5). */
async function decided(m: Mounted, s: Shopper, pageInstance: string, image: string): Promise<Decision | null> {
  const snap = await s.snapshot('pdp', { pageInstance });
  const decision = snap.decisions.filter((d: Decision) => d.slot === CAROUSEL).find((d: Decision) => d.contentId === image) ?? null;
  if (decision) expect((await s.ack(snap, decision)).status, `${m.host}: PRECONDITION — the render of ${image}'s decision is acknowledged`).toBe(200);
  await m.drainLedger();
  return decision;
}
/** Credits (`s`) at the root, rounded, the items with none left out. */
const creditsOf = async (m: Mounted) => Object.fromEntries(Object.entries(await learned(m)).map(([item, v]) => [item, Math.round(v.s)] as const).filter(([, v]) => v !== 0));

describe('unit:P85.CX2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): credited as P30's modules are (S5) — a click on a beacon-drawn image whose decision the ring holds for that page view is credited once, the admitted beacon adding no second credit; a click on a beacon-drawn image with no decision behind it on its page view credits nothing`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P85.CX2 — the documents publish');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m);
      const withDecision = pageInstanceOf('p85-cx2-decided'), without = pageInstanceOf('p85-cx2-undecided');
      const held = await decided(m, s, withDecision, id(5));
      expect(held, `${host}: PRECONDITION — the engine decided image 5 for the page view`).toBeTruthy();
      const beacons = [await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED.slice(0, 4), pageInstance: withDecision }),
        await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED.slice(0, 4), pageInstance: without })];
      expect((await clickOn(s, id(5), 2, withDecision)).status, `${host}: PRECONDITION — the click is accepted`).toBe(200);
      expect((await clickOn(s, id(3), 1, without)).status, `${host}: PRECONDITION — the click on the undecided page view is accepted`).toBe(200);
      await m.drainLedger();
      expect.soft(beacons.map(answerOf), `${host}: P85.CX2 — both beacons admitted (today the action is refused)`).toEqual([[200, 'admitted', 4], [200, 'admitted', 4]]);
      expect.soft(await creditsOf(m), `${host}: P85.CX2 — the click credited once through the engine's decision; nothing without one`).toEqual({ [id(5)]: 1 });
    }, 120_000);

    it(`host (${host}): an add to bag originating at a beacon-drawn image (the image and the page view named, P33's form) is credited through the engine's decision for it, once, on a carousel learning against add to bag; without a decision on its page view, nothing`, async () => {
      const m = await mount(host, { ...DOCS, learn: learnOf('add_to_bag') });
      expectPublished(m, 'P85.CX2 — the documents publish');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m);
      const withDecision = pageInstanceOf('p85-cx2-bag'), without = pageInstanceOf('p85-cx2-bag-undecided');
      expect(await decided(m, s, withDecision, id(4)), `${host}: PRECONDITION — the engine decided image 4 for the page view`).toBeTruthy();
      const beacon = await carouselBeacon(s, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED.slice(0, 4), pageInstance: withDecision });
      expect((await s.action({ type: 'add_to_cart', data: { productId: A, contentId: id(4), slot: CAROUSEL, page: 'pdp', pageInstance: withDecision } })).status,
        `${host}: PRECONDITION — the add to bag is accepted`).toBe(200);
      const other = await shopperOn(m);
      await carouselBeacon(other, { tableVersion: table.version, context: 'paid_social|1|mobile', images: PAINTED.slice(0, 4), pageInstance: without });
      await other.action({ type: 'add_to_cart', data: { productId: A, contentId: id(3), slot: CAROUSEL, page: 'pdp', pageInstance: without } });
      await m.drainLedger();
      expect.soft([answerOf(beacon), await creditsOf(m)], `${host}: P85.CX2 — the beacon admitted; the add to bag credited to the image the shopper saw, through its decision`)
        .toEqual([[200, 'admitted', 4], { [id(4)]: 1 }]);
    }, 120_000);

    it(`host (${host}): the holdout's arm — a beacon naming arm default is ignored not_learning, and its page view's click credits nothing (the holdout learns nothing)`, async () => {
      const m = await mount(host, { ...DOCS, learn: learnOf('click', { share: 1, salt: 'p85-holdout', arms: ['default'] }) });
      expectPublished(m, 'P85.CX2 — the holdout documents publish');
      const table = await tableOf(m);
      expect(table.status, `${host}: PRECONDITION P84 — the context table answers`).toBe(200);
      const s = await shopperOn(m);
      const pageInstance = pageInstanceOf('p85-cx2-holdout');
      await decided(m, s, pageInstance, id(3));
      const recordedBefore = [await at(m, 'c=unknown', 'n'), await at(m, CELL, 'n')];
      const beacon = await carouselBeacon(s, { tableVersion: table.version, context: 'default', images: PAINTED.slice(0, 4), pageInstance, arm: 'default' });
      await clickOn(s, id(3), 1, pageInstance);
      await m.drainLedger();
      expect.soft([answerOf(beacon), await creditsOf(m), [await at(m, 'c=unknown', 'n'), await at(m, CELL, 'n')]], `${host}: P85.CX2 — ignored not_learning, nothing recorded by the beacon, nothing credited`)
        .toEqual([[200, 'ignored', 'not_learning'], {}, recordedBefore]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P85.CX3 — the kit states the carousel beacon
// ===========================================================================

describe('unit:P85.CX3', () => {
  it('logic: kit 01 states listen.carouselExposure beside the layout beacon (once per page view, under consent, the head script\'s values); kit 02 states the carousel_exposure action, its admission (the version in force only; a page cached before a publication sends stale_table for up to a minute) and its ignored reasons by name; kit 03 lists carousel_exposure and its payload', () => {
    const kit01 = readTree('docs/kit/01-integration-guide.md'), kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const has = (text: string, patterns: RegExp[]) => patterns.map(p => [p.source, p.test(text)]);
    const all = (patterns: RegExp[]) => patterns.map(p => [p.source, true]);
    const k01 = [/client\.listen\.carouselExposure\(\{ tableVersion, context, page, slot, images, arm \}\)/, /carousel_exposure[^.]*once per page view/, /carousel_exposure[^.]*tracking consent/];
    const k02 = [/`carousel_exposure`/, /`stale_table`/, /`unknown_context`/, /`not_carousel`/, /`unknown_image`/, /`not_learning`/, /`stale_table`[^.]*(minute|max-age)|(minute|max-age)[^.]*`stale_table`/,
      /`tableVersion`/, /`images`/];
    const k03 = [/\| `carousel_exposure` \|/, /carousel_exposure[^.]*`tableVersion`[^.]*`context`[^.]*`images`/];
    expect.soft({ kit01: has(kit01, k01), kit02: has(kit02, k02), kit03: has(kit03, k03) }, 'P85.CX3 — the kit states the carousel beacon (today it states the layout beacon only)')
      .toEqual({ kit01: all(k01), kit02: all(k02), kit03: all(k03) });
  });
});
