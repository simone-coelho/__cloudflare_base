// src/units/P83/LEDGER.unit.test.ts
// P83 under the Closure Ledger: the tests for the LOCAL criteria GR1-GR4 of the P83 work order (the activation programme
// of amendment 11, ticket P83 "Two brand rules as guarantees", E6). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md,
// section 2, E6, "Done when"):
//   "(a) a slot rule "at least N items carrying tag T in the first K positions" is enforced at decision time, not
//   weighted, and the receipt names it; (b) a pin may carry a date window and a tag rather than an item identifier ("the
//   item tagged `launch-hero` leads from date A to date B"), so that a shared slot on every product page pins the right
//   item on each page and nothing after the window; an ineligible pinned item no longer refuses the whole slot where the
//   pin is tag-driven."
// The work order (docs/parity/activation/program.json, P83): GR1 "A slot rule 'at least N items carrying tag T in the first
// K positions' is enforced at decision time on every arm that ranks: with at least N eligible items carrying T, the first
// K positions hold at least N of them whatever the scores and bands; with fewer, all of them are in the first K; the
// receipt names the rule"; GR2 "A pin may name a tag and a date window instead of an item: from date A to date B the
// eligible item carrying the tag (among the slot's candidates, so on a scoped carousel the page's product's image, P80)
// leads; before A and after B the slot decides as without the pin"; GR3 "A tag-driven pin that no eligible item
// satisfies refuses nothing: the slot decides as without it and pinDiagnostics names the unmet pin; an item-identifier pin
// that is missing, ineligible or excluded still refuses the whole slot (P04 decision D1)"; GR4 "Locks and kit: P04, P15 and
// W20 locks unchanged for item pins and bands; the kit states both rules".
//
// THE READINGS THIS FILE RULES (the lead's provisional readings 1-4, made concrete; each named for ratification):
//   · RULE (a), `minimum: { dimension, value, count, within }` on a slot beside `diversity`: the tag is an exact
//     dimension/value pair, as `excludedTags` names one (no normalization); `count` ≥ 1 and `within` ≤ the slot's `take`
//     are integers with `count` ≤ `within`; publication refuses anything else by name (`pages.{page}[i].minimum`). Read on
//     every governance version, as `diversity` is. Enforced on every arm that ranks (the holdout's default arm included),
//     after the slot's pins and its ranking (bands, exploration and the diversity rule included): when the first `within`
//     positions hold fewer than `count` items carrying the tag, the best-ranked eligible items carrying it that the slot
//     did not place there are brought in, the lowest-ranked items not carrying it (never a pinned one) leaving those
//     positions, until `count` are there or none is left; the first `within` positions then hold their items in the
//     slot's own rank order, and the items that left follow at once, in rank order, before the rest of the take. With
//     none eligible the slot decides as without the rule. A decision the rule moved carries `explain.minimum: { count,
//     dimension, from, value, within }` (keys sorted), `from` its position counted from 1 in the slot's ranking without
//     the rule; its record and its receipt carry the same member, and the receipt's `why` names the tag; the replay is
//     equal.
//   · RULE (b), `pinnedTag: { dimension, value, window: { from, to } }` on a content slot, governance 3 or later as
//     `pinnedPieceIds`, both window ends required, ISO 8601, `from` before `to`; with the piece window's comparison
//     (src/content/lifecycle.ts isLiveAt): in effect from `from` INCLUSIVE to `to` EXCLUSIVE, by the decision's clock.
//     Mutually exclusive with `pinnedPieceId` and `pinnedPieceIds`, refused by name. In effect, the best-ranked eligible
//     candidate carrying the tag (after P80's scope narrows the candidates) is served at position 1 on every arm that
//     ranks, never scored or explored (`strategy: 'tenant-pinned'`), its decision carrying `explain.pinnedTag: {
//     dimension, value, window }` as its record and receipt do; the other positions rank as without the pin. Outside the
//     window the slot decides as without the pin, and nothing is held.
//   · UNMET (reading 3): a tag pin in effect with no eligible candidate carrying the tag refuses nothing: the slot decides
//     as without it, and the decision set's `pinDiagnostics` names it as `{ pinnedTag: { dimension, value }, reason:
//     'unmet_tag_pin', slot }` — a reason that refuses nothing, as P43's `module_not_returned` is. An item pin still
//     refuses (P04 decision D1). With both rules on one slot, the tag pin takes position 1 first and the guarantee then
//     counts it.
//   · Untouched (reading 4): `positionPins`, the stored catalogue, the bands and the item-pin sentences of the kit.
//
// READINGS THE CODE CONTRADICTS, for the lead: (1) "a value outside the vocabulary … refused at validation as the
// diversity rule's dimension is" — the diversity rule's dimension is checked as a non-empty string only
// (src/content/kinds.ts validateSlot, the `diversity` member), against no vocabulary; this file holds rule (a) to the
// same shape check and asks nothing of a vocabulary. (2) `pinDiagnostics` entries are refusals by the composer's own
// comment (src/reflex/contentCompose.ts `unreturnedPins`) and the snapshot counts every entry in `refusedCount`
// (src/routes/decisions.ts); P43's `module_not_returned` already rides the same array as a non-refusal, so the unmet tag
// pin follows it with a reason of its own.
//
// R10: none found (P04, P15, W20 and P80 run under the sketch; see MEASURED).
//
// DEFERRED, with the reason: the Meridian bundle (public/meridian/engine.bundle.js, generated from contentCompose.ts by
// node scripts/build-meridian.mjs, outside the ticket's allowedPaths: the lead rules at the build who commits it).
// TOLD, not a leg: a tag pin on the page's declared layout slot is not ruled (the work order names a content slot).
//
// NO NEW EXPORT IS IMPORTED: `minimum`, `pinnedTag` and their explain members are read loosely.
//
// FIXTURE. The parity mount (src/units/_parity.ts) on the demo profile, both shopper hosts: P02's product page (the
// declared layout slot over the registered modules) and a carousel content slot of images tagged by shot and category,
// in P80's shape; the shopper who viewed a handbag (her interest ranks the handbag images above the others), or a cold one;
// the holdout's default arm in a world of its own. The decision's clock is moved with fake Date only.
//
// HARNESS: src/units/_parity.ts. Imports from src/units/: ../_parity.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DecisionRecord } from '@/content/types';

import {
  BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, pageInstanceOf, putDocument, readTree, receiptsOf, replayOf,
  shopperOn, storedDecisions, TENANT, VIEW_TABBY_26, type Decision, type Mounted, type Shopper, type Snapshot,
} from '../_parity';

const CAROUSEL = 'pdp-carousel';
const A = 'COA-CH857', B = 'COA-CB925', C = 'COA-CW620';
const image = (id: string, shot: string[], category = 'Handbags', products?: string[]) => ({ id, customerContentId: `TAP-${id.toUpperCase()}`,
  type: 'image', title: id, tags: { category: [category], shot }, slotTypes: [CAROUSEL], lifecycle: { status: 'live' },
  ...(products ? { featuredProductIds: products } : {}) });
/** GR1: four handbag images, then two on-model images of another category (her interest ranks them last, as the catalogue does). */
const RAIL = [image('img-flat-1', ['flat-lay']), image('img-studio-2', ['studio']), image('img-detail-3', ['detail']), image('img-flat-4', ['flat-lay']),
  image('img-model-5', ['on-model'], 'Small Leather Goods'), image('img-model-6', ['on-model'], 'Small Leather Goods')];
const RAIL_WITHOUT_MODELS = RAIL.slice(0, 4);
const minimumOf = (count: number, within: number) => ({ dimension: 'shot', value: 'on-model', count, within });
const carousel = (over: Record<string, unknown> = {}) => ({ slot: CAROUSEL, take: 4, weights: { category: 1 }, ...over });
const learnFor = (holdout: boolean) => learnDocument({ [CAROUSEL]: { measurementBasis: 'rendered-v1', reward: 'click' } },
  holdout ? { holdout: { share: 1, salt: 'p83-default-arm', arms: ['default'] } } : {});
const docs = (pieces: unknown[], slot: Record<string, unknown>, holdout = false) => ({ pieces: [...MODULES, ...pieces], slots: declaredSlots([layoutSlot(), slot]), learn: learnFor(holdout) });

/** GR2/GR3: per product, its images in catalogue order, the launch image last. */
const LAUNCH = 'launch-hero';
const SCOPED = [
  image('img-a-studio', ['studio'], 'Handbags', [A]), image('img-a-flat', ['flat-lay'], 'Handbags', [A]), image('img-a-model', ['on-model'], 'Handbags', [A]),
  image('img-a-launch', [LAUNCH], 'Handbags', [A]),
  image('img-b-model', ['on-model'], 'Small Leather Goods', [B]), image('img-b-launch', [LAUNCH, 'on-model'], 'Small Leather Goods', [B]),
  image('img-c-studio', ['studio'], 'Handbags', [C]), image('img-c-flat', ['flat-lay'], 'Handbags', [C]),
];
/** The window: from one hour to three hours past the test's own start, so every grant issued at the start stays live. */
const T0 = Math.floor(Date.now() / 60_000) * 60_000;
const FROM = T0 + 3_600_000, TO = T0 + 3 * 3_600_000;
const WINDOW = { from: new Date(FROM).toISOString(), to: new Date(TO).toISOString() };
const pinnedTagOf = (window = WINDOW) => ({ dimension: 'shot', value: LAUNCH, window });
const scopedCarousel = (over: Record<string, unknown> = {}) => ({ slot: CAROUSEL, take: 3, weights: { category: 1 }, scope: 'anchor', ...over });

afterEach(() => { vi.useRealTimers(); });
/** The decision's clock at `at` (fake Date only; every timer stays real). */
const clockAt = (at: number) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at); };

/** `POST /v1/{tenant}/decisions/snapshot` for the product page, naming the anchor product when given (P80's ctx signal). */
async function page(m: Mounted, s: Shopper, anchor?: string): Promise<Snapshot> {
  const pageInstance = pageInstanceOf('p83');
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, 'X-Shopper-Session': s.grant.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance, ...(anchor ? { 'ctx.anchor': anchor } : {}) }) }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body, page: 'pdp', pageInstance, decisions: (body.decisions ?? []) as Decision[] };
}
const railOf = (snap: Snapshot) => snap.decisions.filter(d => d.slot === CAROUSEL).sort((a, b) => a.order - b.order).map(d => d.contentId);
const show = (snap: { status: number; body: Record<string, unknown> }) => `${snap.status} ${JSON.stringify(snap.body).slice(0, 240)}`;
/** A shopper who viewed a handbag: her interest ranks the handbag images above every other. */
async function handbagShopper(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(VIEW_TABBY_26)).status, `PRECONDITION (${m.host}): the handbag view is accepted`).toBe(200);
  return s;
}
/** The carousel's records after the page acknowledges every image it drew. */
async function recordsOf(m: Mounted, s: Shopper, snap: Snapshot): Promise<DecisionRecord[]> {
  for (const d of snap.decisions.filter(x => x.slot === CAROUSEL)) expect((await s.ack(snap, d)).status, `PRECONDITION (${m.host}): ${d.contentId} is acknowledged`).toBe(200);
  await m.drainLedger();
  return storedDecisions(m, s.subject).filter(r => r.slot === CAROUSEL).sort((a, b) => a.position - b.position);
}
const sortedKeys = (o: unknown) => o && typeof o === 'object' ? Object.fromEntries(Object.entries(o as Record<string, unknown>).sort(([x], [y]) => x < y ? -1 : 1)) : o;

// ===========================================================================
// unit:P83.GR1 — at least N items carrying T in the first K positions, enforced
// ===========================================================================

describe('unit:P83.GR1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the holdout's default arm (catalogue order) the rule brings the best-ranked on-model images into the first K positions — N of N, all of fewer than N, none when none is eligible — the items that left following at once`, async () => {
      const cases: Array<[string, unknown[], Record<string, unknown>, string[]]> = [
        ['no rule', RAIL, carousel(), ['img-flat-1', 'img-studio-2', 'img-detail-3', 'img-flat-4']],
        ['1 in the first 2', RAIL, carousel({ minimum: minimumOf(1, 2) }), ['img-flat-1', 'img-model-5', 'img-studio-2', 'img-detail-3']],
        ['2 in the first 2', RAIL, carousel({ minimum: minimumOf(2, 2) }), ['img-model-5', 'img-model-6', 'img-flat-1', 'img-studio-2']],
        ['3 in the first 3, 2 eligible', RAIL, carousel({ minimum: minimumOf(3, 3) }), ['img-flat-1', 'img-model-5', 'img-model-6', 'img-studio-2']],
        ['1 in the first 2, none eligible', RAIL_WITHOUT_MODELS, carousel({ minimum: minimumOf(1, 2) }), ['img-flat-1', 'img-studio-2', 'img-detail-3', 'img-flat-4']],
      ];
      const served: Array<[string, string[]]> = [];
      for (const [name, pieces, slot] of cases) {
        const m = await mount(host, docs(pieces, slot, true));
        expectPublished(m, `P83.GR1 — ${name}: the documents publish`);
        const snap = await page(m, await shopperOn(m));
        expect(snap.status, `${host}: PRECONDITION — ${name}: the page is answered (${show(snap)})`).toBe(200);
        served.push([name, railOf(snap)]);
      }
      expect.soft(served, `${host}: P83.GR1 — the guarantee on the default arm (today the rule is not read: the catalogue order)`).toEqual(cases.map(([name, , , rail]) => [name, rail]));
    }, 180_000);

    it(`host (${host}): on the personalized arm, her interest ranking the on-model images last and with position bands, the first 2 positions hold an on-model image; the moved decisions name the rule in their records and receipts, and each replays equal`, async () => {
      const bands = [{ from: 1, to: 2, weights: { category: 1 } }, { from: 3, to: 4, weights: { category: 0.5 } }];
      const cases: Array<[string, Record<string, unknown>]> = [['without bands', carousel({ minimum: minimumOf(1, 2) })], ['with bands', carousel({ minimum: minimumOf(1, 2), bands })]];
      const served: Array<[string, string[]]> = [];
      let records: DecisionRecord[] = [], m: Mounted | null = null, s: Shopper | null = null;
      for (const [name, slot] of cases) {
        m = await mount(host, docs(RAIL, slot));
        expectPublished(m, `P83.GR1 — ${name}: the documents publish`);
        s = await handbagShopper(m);
        const snap = await page(m, s);
        expect(snap.status, `${host}: PRECONDITION — ${name}: the page is answered (${show(snap)})`).toBe(200);
        served.push([name, railOf(snap)]);
        if (name === 'with bands') records = await recordsOf(m, s, snap);
      }
      expect.soft(served, `${host}: P83.GR1 — the guarantee whatever her scores and the bands (today the on-model images are not served at all)`).toEqual([
        ['without bands', ['img-flat-1', 'img-model-5', 'img-studio-2', 'img-detail-3']], ['with bands', ['img-flat-1', 'img-model-5', 'img-studio-2', 'img-detail-3']]]);
      const rule = { count: 1, dimension: 'shot', value: 'on-model', within: 2 };
      expect.soft(records.map(r => [r.item_id, sortedKeys((r.explain as unknown as Record<string, unknown>).minimum ?? null)]),
        `${host}: P83.GR1 — each decision the rule moved names it and the position it held without it`).toEqual([
        ['img-flat-1', null], ['img-model-5', { ...rule, from: 5 }], ['img-studio-2', { ...rule, from: 2 }], ['img-detail-3', { ...rule, from: 3 }]]);
      const receipts = (await receiptsOf(m!, s!.subject)).filter(x => x.slot === CAROUSEL);
      expect.soft(receipts.filter(x => x.item === 'img-model-5').map(x => [sortedKeys(x.minimum ?? null), ((x.why ?? []) as string[]).some(w => w.includes('on-model')) ? 'a why names the tag' : 'no why names the tag']),
        `${host}: P83.GR1 — the receipt carries the rule as the record does, and says why`).toEqual([[{ ...rule, from: 5 }, 'a why names the tag']]);
      const replays: unknown[][] = [];
      for (const r of records) { const replay = await replayOf(m!, r.decision_id); replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
      expect.soft(replays, `${host}: P83.GR1 — each decision replays equal`).toEqual(records.map(r => [r.item_id, 200, 'equal']));
    }, 180_000);
  }

  it('host: publication refuses a malformed rule by name — a count over the span, a span over the take, a count below 1, a missing tag — and admits a well-formed one', async () => {
    const m = await mount('session', docs(RAIL, carousel()));
    expectPublished(m, 'P83.GR1 — the documents publish');
    const put = async (minimum: unknown) => {
      const answer = await putDocument(m, 'slots', declaredSlots([layoutSlot(), carousel({ minimum })]), 'p83 minimum');
      return [answer.status, ((answer.body.errors ?? []) as unknown[]).some(e => String(e).includes('.minimum')) ? 'named' : `not named (${JSON.stringify(answer.body).slice(0, 200)})`];
    };
    expect.soft({
      countOverSpan: await put(minimumOf(3, 2)), spanOverTake: await put(minimumOf(1, 5)), countBelowOne: await put(minimumOf(0, 2)),
      missingTag: await put({ count: 1, within: 2 }),
    }, 'P83.GR1 — each refused by name (today the member is not read: every one is published)').toEqual({
      countOverSpan: [422, 'named'], spanOverTake: [422, 'named'], countBelowOne: [422, 'named'], missingTag: [422, 'named'] });
    expect((await putDocument(m, 'slots', declaredSlots([layoutSlot(), carousel({ minimum: minimumOf(1, 2) })]), 'p83 well formed')).status, 'P83.GR1 — a well-formed rule publishes').toBe(200);
  }, 120_000);
});

// ===========================================================================
// unit:P83.GR2 — a pin naming a tag and a window
// ===========================================================================

describe('unit:P83.GR2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the scoped carousel's tag pin leads each product page with that page's own launch image from the window's start (inclusive) to its end (exclusive); before and after, the order is the order without the pin`, async () => {
      const pinned = await mount(host, docs(SCOPED, scopedCarousel({ pinnedTag: pinnedTagOf() })));
      const plain = await mount(host, docs(SCOPED, scopedCarousel()));
      expectPublished(pinned, 'P83.GR2 — the tag pin publishes'); expectPublished(plain, 'P83.GR2 — the carousel without it publishes');
      const s = await shopperOn(pinned), t = await shopperOn(plain);
      const at = async (when: number) => { clockAt(when); const out = { a: railOf(await page(pinned, s, A)), b: railOf(await page(pinned, s, B)) }; vi.useRealTimers(); return out; };
      const noPin = { a: railOf(await page(plain, t, A)), b: railOf(await page(plain, t, B)) };
      expect(noPin, `${host}: PRECONDITION — without the pin each page serves its own images in catalogue order`).toEqual({
        a: ['img-a-studio', 'img-a-flat', 'img-a-model'], b: ['img-b-model', 'img-b-launch'] });
      const inside = { a: ['img-a-launch', 'img-a-studio', 'img-a-flat'], b: ['img-b-launch', 'img-b-model'] };
      expect.soft({ before: await at(FROM - 1), atTheStart: await at(FROM), beforeTheEnd: await at(TO - 1), atTheEnd: await at(TO), after: await at(TO + 3_600_000) },
        `${host}: P83.GR2 — the launch image leads in the window only, each page its own (today the pin is not read)`).toEqual({
        before: noPin, atTheStart: inside, beforeTheEnd: inside, atTheEnd: noPin, after: noPin });
    }, 180_000);

    it(`host (${host}): in the window the pinned decision is the merchandiser's (never ranked), names the pin in its record and receipt, and replays equal; the holdout's default arm is pinned too`, async () => {
      const m = await mount(host, docs(SCOPED, scopedCarousel({ pinnedTag: pinnedTagOf() })));
      const holdout = await mount(host, docs(SCOPED, scopedCarousel({ pinnedTag: pinnedTagOf() }), true));
      expectPublished(m, 'P83.GR2 — the tag pin publishes'); expectPublished(holdout, 'P83.GR2 — the tag pin publishes on the default arm');
      const s = await shopperOn(m), h = await shopperOn(holdout);
      // The whole leg on the window's clock: the page, its acknowledgements, the receipts and the replays.
      clockAt(FROM + 60_000);
      const snap = await page(m, s, A), defaultArm = railOf(await page(holdout, h, A));
      const records = await recordsOf(m, s, snap);
      const pin = { dimension: 'shot', value: LAUNCH, window: WINDOW };
      const lead = snap.decisions.filter(d => d.slot === CAROUSEL).sort((x, y) => x.order - y.order)[0];
      const receipts = (await receiptsOf(m, s.subject)).filter(x => x.slot === CAROUSEL && x.item === 'img-a-launch');
      const replays: unknown[][] = [];
      for (const r of records) { const replay = await replayOf(m, r.decision_id); replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
      expect.soft({
        lead: [lead?.contentId ?? 'nothing', lead?.strategy ?? null],
        records: records.map(r => [r.item_id, sortedKeys((r.explain as unknown as Record<string, unknown>).pinnedTag ?? null)]),
        receipt: receipts.map(x => [sortedKeys(x.pinnedTag ?? null), ((x.why ?? []) as string[]).some(w => w.includes(LAUNCH)) ? 'a why names the tag' : 'no why names the tag']),
        defaultArm,
      }, `${host}: P83.GR2 — the tag pin named on the record and the receipt (today the pin is not read)`).toEqual({
        lead: ['img-a-launch', 'tenant-pinned'],
        records: [['img-a-launch', pin], ['img-a-studio', null], ['img-a-flat', null]],
        receipt: [[pin, 'a why names the tag']],
        defaultArm: ['img-a-launch', 'img-a-studio', 'img-a-flat'],
      });
      expect.soft(replays, `${host}: P83.GR2 — each decision replays equal (the window read at the decision's own time)`).toEqual(records.map(r => [r.item_id, 200, 'equal']));
    }, 180_000);
  }

  it('host: publication refuses a malformed tag pin by name — beside an item pin, a window whose start is not before its end, a window end that is no date, below governance 3 — and admits a well-formed one', async () => {
    const m = await mount('session', docs(SCOPED, scopedCarousel()));
    expectPublished(m, 'P83.GR2 — the documents publish');
    const put = async (slot: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const answer = await putDocument(m, 'slots', { ...declaredSlots([layoutSlot(), slot]), ...extra }, 'p83 pinned tag');
      return [answer.status, ((answer.body.errors ?? []) as unknown[]).some(e => String(e).includes('pinnedTag')) ? 'named' : `not named (${JSON.stringify(answer.body).slice(0, 200)})`];
    };
    expect.soft({
      besideAnItemPin: await put(scopedCarousel({ pinnedTag: pinnedTagOf(), pinnedPieceIds: ['img-a-studio'] })),
      startNotBeforeEnd: await put(scopedCarousel({ pinnedTag: pinnedTagOf({ from: WINDOW.to, to: WINDOW.from }) })),
      endNoDate: await put(scopedCarousel({ pinnedTag: pinnedTagOf({ from: WINDOW.from, to: 'next week' }) })),
      belowGovernance3: await put({ ...scopedCarousel({ pinnedTag: pinnedTagOf() }), scope: undefined }, { governanceVersion: 2, pages: { pdp: [{ ...scopedCarousel({ pinnedTag: pinnedTagOf() }), scope: undefined }] } }),
    }, 'P83.GR2 — each refused by name (today the member is not read: every one is published)').toEqual({
      besideAnItemPin: [422, 'named'], startNotBeforeEnd: [422, 'named'], endNoDate: [422, 'named'], belowGovernance3: [422, 'named'] });
    expect((await putDocument(m, 'slots', declaredSlots([layoutSlot(), scopedCarousel({ pinnedTag: pinnedTagOf() })]), 'p83 well formed')).status, 'P83.GR2 — a well-formed tag pin publishes').toBe(200);
  }, 120_000);
});

// ===========================================================================
// unit:P83.GR3 — an unmet tag pin refuses nothing; an item pin still refuses; the two rules together
// ===========================================================================

describe('unit:P83.GR3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): in the window a page whose product has no launch image is decided as without the pin and pinDiagnostics names the unmet tag pin; an item pin of an image ineligible on the page still refuses the whole slot (P04 D1)`, async () => {
      const pinned = await mount(host, docs(SCOPED, scopedCarousel({ pinnedTag: pinnedTagOf() })));
      // An item pin of another product's image, withheld on product A's page by the scope (P80): ineligible there.
      const itemPinned = await mount(host, docs(SCOPED, scopedCarousel({ pinnedPieceIds: ['img-b-model'] })));
      expectPublished(pinned, 'P83.GR3 — the tag pin publishes'); expectPublished(itemPinned, 'P83.GR3 — the item pin publishes');
      const s = await shopperOn(pinned), t = await shopperOn(itemPinned);
      clockAt(FROM + 60_000);
      const unmet = await page(pinned, s, C), refused = await page(itemPinned, t, A);
      vi.useRealTimers();
      const diagnostics = ((unmet.body.pinDiagnostics ?? []) as Array<Record<string, unknown>>).filter(d => d.slot === CAROUSEL).map(sortedKeys);
      const itemDiagnostics = ((refused.body.pinDiagnostics ?? []) as Array<Record<string, unknown>>).filter(d => d.slot === CAROUSEL).map(d => [d.pinnedPieceId, d.reason]);
      expect([unmet.status, refused.status], `${host}: PRECONDITION — both pages are answered`).toEqual([200, 200]);
      expect.soft({ unmetRail: railOf(unmet), diagnostics, itemPinRail: railOf(refused), itemDiagnostics }, `${host}: P83.GR3 — unmet, nothing refused and the pin named; an item pin refuses as P04 rules`).toEqual({
        unmetRail: ['img-c-studio', 'img-c-flat'], diagnostics: [{ pinnedTag: { dimension: 'shot', value: LAUNCH }, reason: 'unmet_tag_pin', slot: CAROUSEL }],
        itemPinRail: [], itemDiagnostics: [['img-b-model', 'missing_or_ineligible']] });
    }, 180_000);

    it(`host (${host}): with the tag pin and the rule (1 on-model image in the first 2) on one slot, the pin takes position 1 and the rule counts it: a launch image that is not on-model brings the on-model image to position 2; one that is on-model brings nothing`, async () => {
      const m = await mount(host, docs(SCOPED, scopedCarousel({ pinnedTag: pinnedTagOf(), minimum: minimumOf(1, 2) })));
      expectPublished(m, 'P83.GR3 — both rules publish on one slot');
      const s = await shopperOn(m);
      clockAt(FROM + 60_000);
      const a = railOf(await page(m, s, A)), b = railOf(await page(m, s, B));
      vi.useRealTimers();
      expect.soft({ a, b }, `${host}: P83.GR3 — the pin first, then the guarantee counting it`).toEqual({
        a: ['img-a-launch', 'img-a-model', 'img-a-studio'], b: ['img-b-launch', 'img-b-model'] });
    }, 180_000);
  }
});

// ===========================================================================
// unit:P83.GR4 — the kit states both rules; the item-pin and band sentences unchanged
// ===========================================================================

describe('unit:P83.GR4', () => {
  it('logic: kit 02 and kit 03 state the guarantee (`minimum`, its count and span, enforced not weighted) and the tag pin (`pinnedTag`, its window and its ends, the unmet pin refusing nothing); the item-pin and position-band sentences stand', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const paragraphs = (text: string) => text.split(/\n\s*\n/).map(p => p.split('\n').join(' '));
    const has = (text: string, ...words: Array<string | RegExp>) => paragraphs(text).some(p => words.every(w => typeof w === 'string' ? p.includes(w) : w.test(p)));
    expect.soft({
      kit02Minimum: has(kit02, '`minimum`', 'count', 'within', /enforced|guarantee/i),
      kit02PinnedTag: has(kit02, '`pinnedTag`', 'window', /inclusive|exclusive/i),
      kit02Unmet: has(kit02, '`pinnedTag`', 'unmet_tag_pin'),
      kit03Minimum: has(kit03, '`minimum`', 'count', 'within'),
      kit03PinnedTag: has(kit03, '`pinnedTag`', 'window'),
    }, 'P83.GR4 — the kit states both rules (today neither)').toEqual({ kit02Minimum: true, kit02PinnedTag: true, kit02Unmet: true, kit03Minimum: true, kit03PinnedTag: true });
    expect.soft({
      itemPinRefuses: kit03.includes('missing, ineligible or excluded refuses the whole slot (decision D1)'),
      prefixExclusive: kit02.includes('It is mutually exclusive with scalar `pinnedPieceId`, even with [].'),
      bandsSection: kit02.includes('### Position bands (`bands`)'),
    }, 'P83.GR4 — LOCK: the item-pin and band sentences stand').toEqual({ itemPinRefuses: true, prefixExclusive: true, bandsSection: true });
  });
});
