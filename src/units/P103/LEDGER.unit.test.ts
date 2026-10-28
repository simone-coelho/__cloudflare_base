// src/units/P103/LEDGER.unit.test.ts
// P103 under the Closure Ledger: the tests for the LOCAL criteria MP1-MP6 of the P103 work order (the programme
// tapestry-parity-learning-truth of amendment 13, ticket P103 "Money learning: a money policy that can be published, and
// one credit rule online and offline", E28; batch S50). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md, section 2, E28):
//   "**Authority:** the airline demo's engine verification (`S47/engine/VERIFY.md` §1 Engine 18, R-P557): a slot whose
//   objective is `revenue` or `margin` refuses every outcome that names a currency, and no money policy can be published:
//   the learn document has no member for it, no producer reads one (`src/learn/route.ts:228`, `src/ledger/recovery.ts:303`,
//   `:325`), the offline folds weigh value with no currency check so the report credits revenue that live learning refused,
//   and the SDK sends `USD` when the page names no currency (`src/sdk/emit.ts:121`); 7 of the airline demo's 10 money slots
//   learn nothing even from its synthetic history. A defect of the shipped engine, hitting any customer with a money slot
//   fed by the SDK; fixed at its cause under the owner's direction of 28 October (R-P545)."
//   "**Done when:** the learn document carries a money policy (`money`: the currency its money counters are in, and what a
//   value at or below zero means), validated when it is published; both outcome producers and the recovery path pass it
//   on; the money rule sits inside the one credit rule that live learning and every offline fold read, so the report
//   credits exactly what live learning credits; the SDK sends a currency only when the page's data layer names one; kit 02
//   says how to publish the policy. The policy's values are the tenant's to publish; what a starting assumption means for a
//   revenue slot (D09) is not part of this item, and priors on money slots stay as they are."
// The work order (docs/parity/learning-truth/program.json, P103): MP1 the learn document's `money` member { currency,
// nonpositive } (the existing MoneyPolicy shape, src/learn/fan.ts MoneyPolicy) published, read back, refused 422 naming
// the member when malformed, dropped from a retained revision, named by LearnConfig; MP2 the policy reaching the money
// rule on every outcome path on both hosts, direct and managed recovery alike; MP3 the money rule inside the one credit
// rule (src/learn/policy.ts successCreditOf) the ring, foldRetainedDay with the W24 rebuild, the hourly fold and the raw
// grids read, each with the policy of the learn document it folds under; MP4 the SDK sending a currency only when the
// page's data layer names one, the six bundles regenerated within their budgets; MP5 kit 02's money paragraph as built;
// MP6 the locks (a unit slot counts every event, no policy refuses as today, priors on money slots refused as today).
//
// THE WITNESSES: _evidence/parity-step3/S47/engine/VERIFY.md §1 Engine 18 (REPRODUCED: `validateLearnConfig` accepts and
// drops a `money` member, `ok: true, keptMoney: false`; through `outcomeToLearning` a purchase and an add_to_cart naming
// EUR leave both money slots empty; `fanOutcome` with MoneyPolicy { EUR } credits the EUR purchase; `foldRetainedDay`
// credits the EUR purchase the ring refuses) and its remedy (1-5) and "Tests that would pin it"; logs
// S47/engine/logs/probe-int-ed7d6bbe.jsonl. Reproduced again here at d5d8581c on both hosts and both outcome paths
// (S50/specifier/logs/probe-2.log): live 295 on the revenue slot, the day report, the raw day and the rebuild 870.
//
// THE FIXTURE (one representation for MP1-MP6; R-P7). Coach's home page (served-v1, holdout 0, the default learning policy:
// session scope, direct match with featured products, last credit): four slots, one Tabby story each, every story featuring
// the Tabby Shoulder Bag 26 With Quilting (COA-CW620, src/data/coach-catalog.json, the bag _parity.ts's VIEW_TABBY_QUILTED
// names): `home-hero` learns revenue on purchase, `home-story` margin on purchase, `home-teaser` revenue on add_to_bag (the
// airline's seven add_to_bag money slots), `home-banner` unit on purchase (the control); its story is cross-category
// (Handbags and Small Leather Goods). The shopper's events are what a page and its data layer send through
// `/realtime/action`: a purchase of the bag (orderId, value, margin, items, a currency or none), an add to bag of it, and a
// purchase of a product no story features (not-a-held-sku, the unknown input: credited nowhere, on every path alike). A
// statistics horizon of 100 years (`stats.tauLearnMs`, a published dial) keeps decay out of the comparison of live and
// offline sums, which are compared rounded to whole units of the slot's currency.
//
// READINGS (where the sources are silent; for the lead):
//   R1 "Malformed" (MP1): `money` not an object; `currency` absent or anything but three upper-case letters A–Z (ruled,
//      R-P571 (a): `eur` and `EURO` are refused naming `money` and write nothing); `nonpositive` absent or any word but
//      `refuse` and `credit`; any key but those two. An absent `nonpositive` is malformed rather than defaulted: the
//      policy's values are the tenant's to publish (E28), so the platform invents none. The comparison with an outcome's
//      declared currency stays the one moneyRefusal makes (trimmed, case-insensitive).
//   R2 "Naming the member" (MP1): every refusal names `money` in `errors[]` (as P36's name `contextVocabulary` and P11's
//      `evidenceFloors`); nothing is written (the revision in force is unchanged).
//   R3 "Behave as named" (MP2): under `nonpositive: refuse` an outcome whose value (for `margin`, whose margin) is at or
//      below zero is refused `money_policy_unset` naming the currency it declared, as moneyRefusal does today; under
//      `credit` it is not refused for money and the money slot takes it (`attributed` counts it). What it is then worth,
//      and whether a refund subtracts, is D09 and is not asserted (no credit weight of a nonpositive outcome is tested).
//   R4 "Credited" is what live learning takes: the slot's success sum in its statistics object and the receipt's
//      `attributed`; offline it is the slot's learning grid (`grids.<slot>.learning`) and the learning policy's `credits`
//      on the day report, the same members on the raw day, and the slot's sum after the W24 rebuild. MP3 compares every one
//      of them with the table the money rule gives, on every path.
//   R5 "Every offline fold" (MP3) includes the open hour's working fold (src/learn/hourly.ts foldWorkingHour, run by the
//      five-minute job's foldOpenHours exactly as src/index.ts runs it), which builds its own fold context beside
//      buildHour's: the report reads it while the hour is open.
//   R6 The receipt's naming of a slot refused for both its reward and money stays `money` (money decided first, W24.R5,
//      src/units/W24/LEDGER.unit.test.ts); the expected receipts below follow it, so the one rule keeps that order.
//   R7 "Sent with none" (MP4): the posted purchase carries no `currency` member, or one that is null; a currency the page
//      names is sent unchanged. The six bundles are exercised as shipped (the IIFE as a page script in a jsdom window, the
//      ESM module as emit.test.ts's W26.02 runs it), each within packages/sdk/package.json's `sizeBudget`.
//   R8 MP5 is read in the paragraphs of kit 02 that speak of the money policy, by facts and never by wording: the member
//      and its two fields with their two words, that the tenant publishes its own values, what is refused and named
//      without and with a policy, that live learning and the report credit the same outcomes, that the SDK sends a
//      currency only when the data layer names one; the two sentences the work order names are gone, and with them kit 02
//      :1267's "A money policy cannot be published yet" (the same claim, which the built feature makes false). Kit 03's
//      learn-document table lists the `money` member with its two fields and their words (ruled, R-P571 (c)).
//   R9 The managed recovery path is the shopper's `/realtime/action` with LEDGER_RECOVERY_ENABLED 'true' (the harness's
//      default, the prepare body and the admit call of src/ledger/recovery.ts resumeOwnerRecovery); the direct path the same
//      action with 'false' (src/learn/route.ts outcomeToLearning's fanOutcome). The ring's answer is read on the wire, as
//      unit:W24.R4 reads it; nothing is stubbed.
//   R10 "LearnConfig names it" (MP1) is read off src/content/types.ts's LearnConfig declaration (an optional `money`
//      member), the one observable a type has without a compile error today.
//   R11 The policy rides the outcome's recovery input (src/ledger/recovery.ts OutcomeRecoveryInput, persisted with the
//      operation), so an alarm that completes the outcome later carries the policy the action prepared (ruled, R-P571 (b):
//      the grant names OutcomeRecoveryInput's money member).
//   R12 (R-P571 (d)) A policy published between an hourly fold's start and its recovery CANNOT make the offline credits
//      differ from live, and the fold's recovery fingerprint must not name the policy. The fold computes every shard and the
//      hour's aggregate in one pass under the learn document it read at its start (src/index.ts:307 reads it; src/learn/
//      hourly.ts buildHour :2668 builds the context), then writes the whole result as a plan into shard 0 before anything
//      else (:2729-2738, `targets` and `aggregate`); a recovery folds nothing again: it checks the fingerprint (:2571-2573)
//      and replays the stored targets and aggregate (:2574-2600, finishHour), so what it commits is the start's computation
//      under one policy, never a mixture. Measured on both hosts on the sketch (S50/specifier/scratch/probes/
//      PROBE-recovery.unit.test.ts; logs probe-recovery-sketch.log): the hour aggregate's put failing once after the plan,
//      the policy changed (none to EUR, EUR to none), the next run commits the plan and the day reports exactly the live
//      credits (295/118, 870/348). With the policy named in the fingerprint (probe-recovery-fingerprint.log) the recovery
//      is refused, "Hourly recovery conflict", the hour stays unfolded and the day reports 0 against live 295/870; the
//      pending plan in shard 0 also refuses every other hour (:2570). Under R13 below no fold reads the money policy from
//      the learn document at all, so the fingerprint has nothing to name.
//   R13 (R-P576) A policy published after an hour's outcomes and before its fold must not change what the fold credits:
//      every offline fold credits an outcome under the policy live learning took it under. MP3's eight R-P576 legs (both
//      hosts, both outcome paths; none to EUR, EUR to GBP) measure live against the open hour's fold, the closed hour's fold
//      and the day it publishes, the raw day and the W24 rebuild. "The policy live learning took it under" is the one the
//      outcome's producer read: prepareOutcomeAdmission's learn read at the action on the managed path, outcomeToLearning's
//      on the direct path. A row recorded before P103 names none and is read under no policy, which is what live learning
//      applied to it (no producer passed one before P103). The legs pin the behaviour, not a representation; the sketch
//      (S50/specifier/scratch/sketch/apply.py) stamps the policy on the outcome record and the one credit rule reads the
//      stamp, so nothing re-reads a historic learn document (P99's purge of old revisions cannot reach it).
//   R14 (R-P588) The SDK's retry of an event the platform already took (the same wire body: its first event id and time,
//      src/routes/realtime.ts:143-146), arriving after a policy publication, is that outcome: credited once, under the
//      policy it was first taken under, live and in every fold. MP3's four R-P588 legs (both hosts, both paths) retry an
//      EUR purchase (counted on the unit slot) and an EUR add to bag (refused everywhere) taken under no policy, after EUR
//      is published, beside a new EUR purchase. Measured: the managed path already takes a retry as its first admission
//      (src/ledger/recovery.ts runOwnerRecovery :184-187 replays the stored payload; sourceOf :98-99 leaves its processing
//      stamps out). The direct path does not, with or without money: each delivery carries a fresh `retention` stamp
//      (captureRetention, src/retention.ts:154, admission time `Date.now()`), which the ledger's logical comparison and the
//      ring's credited journal both include (src/ledger/delivery.ts LOGICAL_EXCLUDED_FIELDS :111; DecisionRing.ts
//      creditedDigest :735-739), so today the retry is credited again live and the hour's fold refuses "conflicting rows
//      under one logical id" (the raw day 500, the rebuild 503). The sketch: the logical comparison leaves out `retention`
//      and `money` (a retry's processing stamps; the first row read is kept: ledger keys sort by write time, writer.ts :85),
//      and the ring takes every delivery of an outcome id under the stamp it first saw (a bounded record beside the credited
//      journal), so an all-refused outcome's retry meets the same refusal (W24.R1.04's words) whatever is published since.
//
// DEFERRED: LV1 (lane L21, the pair's next release: a EUR policy published on a pair tenant, an SDK purchase naming EUR
// credited live and in the day's report; another currency refused by name live and absent from the report).
// RESIDUALS: the meaning of a nonpositive credit is D09 (R3); money priors stay refused (D09, MP6).
//
// LOCKS (MP6 and the gate): W24 B1, B2, LEDGER (R1.02, R1.04, R2, R5), P16, P33, W26, P94, W25, src/sdk/emit.test.ts,
// W40 LEDGER P3/P4, src/learn/hourly.test.ts, report.test.ts, objective.test.ts, P68.KT1. Measured: the whole suite under
// the sketch (S50/specifier/logs/full-sketch.json) fails only on files that fail alike on an unchanged scratch copy (no
// .git, linked node_modules: P45, P46, P47, P51, P52, P53, P87.SC3, W39, W40.P4) and on P68.KT1, whose kit 02 :99
// citations (src/learn/route.ts :152, :157, :176; src/ledger/recovery.ts :380, :397; and, for R13's mechanism,
// src/ledger/records.ts :411 and src/routes/realtime.ts :404, whose line must keep `receipt.code === 'accepted'`) a sketch
// adding lines above them moves: the build keeps those edits line-neutral or re-points the citations in kit 02 (granted).
// Round 3 (S50/specifier/logs/full-sketch-r3.json) fails only on the same environment files, on P68.KT1 before the two
// line-neutral edits (then 8/8) and once on P76.FA1's timing under a load average near 40 (then 8/8). No R10 is needed.
//
// HARNESS: src/units/_parity.ts (the mounted app over the real Durable Object classes, both hosts; shopperOn, asOperator,
// putDocument, learned). Imports from src/units/: ../_parity. NEW EXPORTS IMPORTED: none. Tenant ids only; no network.

import { statSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { read } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, LEARN_KIND, SLOTS_KIND, validateLearnConfig } from '@/content/kinds';
import type { LearnConfig } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import type { MoneyPolicy } from '@/learn/fan';
import { catchUp, foldOpenHours, HOUR_MS, RUN_BUDGET } from '@/learn/hourly';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createListen } from '@/sdk/listen';
import { testHost } from '@/sdk/testHost';

import {
  asOperator, BRAND, errorsOf, expectPublished, HOSTS, learned, mount, PAGE_VIEW, putDocument, readTree, REFLEX_DOCUMENT, shopperOn, TENANT,
  type Answer, type Host, type Mounted, type Shopper,
} from '../_parity';

// ---------------------------------------------------------------------------
// The fixture.
// ---------------------------------------------------------------------------

/** COA-CW620 · Tabby Shoulder Bag 26 With Quilting · Handbags (src/data/coach-catalog.json). */
const BAG = 'COA-CW620';
/** A product no story features: the unknown input, credited nowhere on any path. */
const UNKNOWN_PRODUCT = 'not-a-held-sku';
const HERO = 'home-hero', STORY = 'home-story', TEASER = 'home-teaser', BANNER = 'home-banner';
const SLOTS_IN_ORDER = [HERO, STORY, TEASER, BANNER] as const;
type Slot = (typeof SLOTS_IN_ORDER)[number];
const ITEM: Record<Slot, string> = { [HERO]: 'story.tabby.quilted', [STORY]: 'story.tabby.edit', [TEASER]: 'story.tabby.carry', [BANNER]: 'story.tabby.charms' };
const story = (slot: Slot, title: string, category: string[]) => ({ id: ITEM[slot], customerContentId: `TAP-${ITEM[slot].toUpperCase().replace(/\./g, '-')}`,
  type: 'editorial', title, tags: { line: ['Tabby'], category }, slotTypes: [slot], lifecycle: { status: 'live' }, featuredProductIds: [BAG] });
const PIECES = [
  story(HERO, 'The quilted Tabby, after six', ['Handbags']),
  story(STORY, 'The Tabby edit', ['Handbags']),
  story(TEASER, 'Carry the Tabby', ['Handbags']),
  /** Cross-category: the charms story spans two categories. */
  story(BANNER, 'Charms, across the case', ['Small Leather Goods', 'Handbags']),
];
const SLOTS = { version: 'p103-coach-slots', governanceVersion: 3, pages: { home: SLOTS_IN_ORDER.map(slot => ({ slot, take: 1, weights: { line: 1 } })) } };
/** A horizon of 100 years: decay moves nothing between the live sum and an offline one taken an hour later. */
const STATS = { n0: 30, tauLearnMs: 3_153_600_000_000, liftMin: 0.5, liftMax: 2, nMin: 30 };
const DIALS = {
  [HERO]: { measurementBasis: 'served-v1', reward: 'purchase', objective: 'revenue' },
  [STORY]: { measurementBasis: 'served-v1', reward: 'purchase', objective: 'margin' },
  [TEASER]: { measurementBasis: 'served-v1', reward: 'add_to_bag', objective: 'revenue' },
  [BANNER]: { measurementBasis: 'served-v1', reward: 'purchase', objective: 'unit' },
};
/** The learn document, with the tenant's money policy when one is given (`money` absent otherwise). */
const learnOf = (money?: unknown): Record<string, unknown> => ({ version: 'p103-coach-learn', holdout: { share: 0, salt: 'p103', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 }, stats: STATS, ...(money === undefined ? {} : { money }), slots: DIALS });
const docs = (money?: unknown) => ({ pieces: PIECES, slots: SLOTS, learn: learnOf(money) });

/** The tenant's own values for the walk (the airline publishes EUR; LV1 names EUR as the lane's value). */
const EUR_REFUSE: MoneyPolicy = { currency: 'EUR', nonpositive: 'refuse' };
const EUR_CREDIT: MoneyPolicy = { currency: 'EUR', nonpositive: 'credit' };
/** R-P576: the policy changed after the outcomes, before the fold. */
const GBP_REFUSE: MoneyPolicy = { currency: 'GBP', nonpositive: 'refuse' };

/** R1: the malformed money members a new learn document is refused for, naming `money`. */
const MALFORMED: Array<[string, unknown]> = [
  ['a currency that is empty', { currency: '', nonpositive: 'refuse' }],
  ['a currency that is blank', { currency: '   ', nonpositive: 'refuse' }],
  ['a currency that is not a string', { currency: 978, nonpositive: 'refuse' }],
  ['a currency in lower case (R-P571 (a))', { currency: 'eur', nonpositive: 'refuse' }],
  ['a currency of four letters (R-P571 (a))', { currency: 'EURO', nonpositive: 'refuse' }],
  ['no currency', { nonpositive: 'refuse' }],
  ['a nonpositive outside the two words', { currency: 'EUR', nonpositive: 'subtract' }],
  ['no nonpositive (never defaulted: the values are the tenant\'s)', { currency: 'EUR' }],
  ['an unknown key', { currency: 'EUR', nonpositive: 'refuse', rate: 1.08 }],
  ['a member that is not an object', 'EUR'],
];

// ---------------------------------------------------------------------------
// The shopper's events: what the page and its data layer send through `/realtime/action`.
// ---------------------------------------------------------------------------

type Event = { type: string; data: Record<string, unknown> };
let orders = 0;
const purchase = (value: number, margin: number, currency?: string, product = BAG): Event => ({ type: 'purchase', data: {
  orderId: `p103-order-${++orders}`, value, margin, ...(currency === undefined ? {} : { currency }),
  items: [{ productId: product, quantity: 1, price: Math.abs(value) }] } });
const addToBag = (price: number, currency?: string): Event => ({ type: 'add_to_cart', data: { productId: BAG, price, quantity: 1,
  ...(currency === undefined ? {} : { currency }) } });

/** The ring's answer to one outcome, as the wire carried it. */
interface Receipt { attributed?: number; refusedBySlot?: Record<string, string>; money?: { code?: string; reason?: string } }

/**
 * The visitor's ring, read on the wire (unit:W24.R4's idiom): every `/outcome` the platform sends the REAL ring and the
 * answer it gets, by the outcome's id. Nothing is changed in transit.
 */
function tapRing(m: Mounted): Map<string, Receipt> {
  const answers = new Map<string, Receipt>();
  const ring = m.env.DECISION_RING!;
  (m.env as unknown as Record<string, unknown>).DECISION_RING = {
    idFromName: (name: string) => ring.idFromName(name),
    get: (id: DurableObjectId) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const outcome = new URL(request.url).pathname === '/outcome';
      const sent = outcome ? await request.clone().json().catch(() => null) as { outcome?: { outcome_id?: string } } | null : null;
      const response = await ring.get(id).fetch(request);
      if (outcome && sent?.outcome?.outcome_id) {
        const body = await response.clone().json().catch(() => null) as { receipt?: Receipt } | null;
        if (body?.receipt) answers.set(sent.outcome.outcome_id, body.receipt);
      }
      return response;
    } }),
  };
  return answers;
}

/** One event through the mounted app, as the SDK sends it, with its own event id so its outcome can be found. */
async function act(m: Mounted, s: Shopper, event: Event): Promise<{ status: number; eventId: string; body: Record<string, unknown>; wire: string }> {
  const eventId = crypto.randomUUID();
  return send(m, s, JSON.stringify({ ...event, source: 'sdk', userId: s.grant.subject, sessionId: s.grant.sessionId, timestamp: Date.now(), eventId }), eventId);
}
/** The wire body sent as it is: the SDK's retry of an event carries its first event id and time (src/routes/realtime.ts:143-146). */
async function send(m: Mounted, s: Shopper, wire: string, eventId: string): Promise<{ status: number; eventId: string; body: Record<string, unknown>; wire: string }> {
  const response = await m.fetch(new Request('https://shop.invalid/realtime/action', { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' }, body: wire }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, eventId, body, wire };
}

/** A shopper with her consent, her page view and the home page served in all four slots. */
async function servedShopper(m: Mounted, label: string): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW)).status, `${label}: PRECONDITION — her page view is accepted`).toBe(200);
  const page = await s.snapshot('home');
  expect(page.decisions.map(d => [d.slot, d.contentId]).sort(), `${label}: PRECONDITION — the home page serves one Tabby story in each of the four slots (answered ${page.status}: ${JSON.stringify(page.body).slice(0, 200)})`)
    .toEqual(SLOTS_IN_ORDER.map(slot => [slot, ITEM[slot]]).sort());
  return s;
}

/** What the ring said of one event: how many slots took it, the money refusal, and each slot's word (`taken` when not refused). */
function told(answers: Map<string, Receipt>, eventId: string): Record<string, unknown> | string {
  const found = [...answers].find(([id]) => id.endsWith(`:n1:${eventId}`))?.[1];
  if (!found) return `no ring answer for the outcome of event ${eventId}`;
  return { attributed: found.attributed, money: found.money ?? 'none',
    ...Object.fromEntries(SLOTS_IN_ORDER.map(slot => [slot, found.refusedBySlot?.[slot] ?? 'taken'])) };
}

/** Live learning: each slot's success sum in its own statistics object, in whole units of the slot's currency. */
async function liveCredits(m: Mounted): Promise<Record<Slot, number>> {
  const held = await learned(m);
  return Object.fromEntries(SLOTS_IN_ORDER.map(slot => [slot, Math.round(held[ITEM[slot]]?.s ?? 0)])) as Record<Slot, number>;
}

type DayReport = { grids?: Record<string, Record<string, { items?: Record<string, Record<string, { s?: number }>> }>>; policies?: Array<{ name?: string; role?: string; credits?: number }> };
/** A day report's learning grids, slot by slot, and the learning policy's credit count. */
function reportCredits(report: DayReport | undefined): { slots: Record<Slot, number>; credits: number | string } {
  const slots = Object.fromEntries(SLOTS_IN_ORDER.map(slot => [slot, Math.round(report?.grids?.[slot]?.learning?.items?.[ITEM[slot]]?.['*']?.s ?? 0)])) as Record<Slot, number>;
  const learning = report?.policies?.find(p => p.role === 'learning');
  return { slots, credits: learning?.credits ?? `no learning policy on the day (${JSON.stringify(report?.policies ?? null).slice(0, 160)})` };
}

/** P05's clock (src/units/P05/LEDGER.unit.test.ts fixedHour): the world runs inside one hour, from its first minute. */
function fixedHour(): { hourStart: number; restore: () => void } {
  const real = Date.now.bind(Date), start = real();
  const hourStart = (Math.floor(start / HOUR_MS) + 1) * HOUR_MS, shift = hourStart + 60_000 - start;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => real() + shift);
  return { hourStart, restore: () => clock.mockRestore() };
}

/** The learn document in force, read the way the five-minute job reads it (src/index.ts). */
const learnInForce = (m: Mounted) => read<LearnConfig>(m.env, LEARN_KIND, TENANT, DEFAULT_LEARN);

/** `GET` then `PUT /content/<kind>` with the authored preconditions (the harness's putDocument, for any kind). */
async function putKind(m: Mounted, kind: string, document: unknown): Promise<Answer> {
  const base = await asOperator(m, 'GET', `/content/${kind}?scope=${TENANT}`);
  const publication = base.body.publication as { revision: number; digest: string };
  const answer = await asOperator(m, 'PUT', `/content/${kind}?scope=${TENANT}`, { document, note: 'p103' }, {
    'If-Match': `"${base.body.revision}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${base.body.revision}:${crypto.randomUUID()}` });
  invalidatePublicationCache();
  return answer;
}

/**
 * The mounted app with the learn document published RETAINED, as a revision stored before P103 (src/units/P11's
 * mountRetainedLearn): the harness stores nothing when a baseline document is refused, so it is handed none, and the one
 * baseline set is published here with the learn revision marked `retainedValue` (read through LEARN_KIND.validateStored).
 */
async function mountRetainedLearn(host: Host, learn: unknown): Promise<Mounted> {
  const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: null });
  expect(m.refused ?? '', `PRECONDITION (${host}): the harness stored nothing before the retained publication`).toMatch(/invalid_baseline/);
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope: string = TENANT, retained = false): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'parity-fixture', note: 'fixture', value }, ...(retained ? { retainedValue: true as const } : {}) });
  let refused: string | null = null;
  try {
    await initializePublicationSet(m.env, [
      baseline(CONTENT_KIND, { version: 'parity-coach-catalogue', pieces: PIECES }),
      baseline(SLOTS_KIND, SLOTS),
      baseline(LEARN_KIND, learn, TENANT, true),
      baseline(PRIORS_KIND, EMPTY_PRIORS),
      baseline(REFLEX_KIND, REFLEX_DOCUMENT, reflexScopeForTenant(TENANT)),
    ], '0:' + crypto.randomUUID());
  } catch (error) { refused = `${(error as Error).message} (${(error as { code?: string }).code ?? ''})`; }
  invalidatePublicationCache();
  return { ...m, refused };
}

// ===========================================================================
// unit:P103.MP1 — the learn document's money member
// ===========================================================================

describe('unit:P103.MP1', () => {
  it('logic: the learn validator keeps a well-formed money member, refuses each malformed one naming money, and the retained reader keeps a well-formed one and drops a malformed one; LearnConfig names it', () => {
    for (const policy of [EUR_REFUSE, EUR_CREDIT]) {
      const kept = validateLearnConfig(learnOf(policy));
      expect(kept.ok ? (kept.value as unknown as Record<string, unknown>).money ?? 'dropped' : (kept as { errors: string[] }).errors.join('; '),
        `P103.MP1 — a new learn document's well-formed money member ${JSON.stringify(policy)} is accepted and KEPT (today it is accepted and dropped: S47 Engine 18, ok true, keptMoney false)`)
        .toEqual(policy);
    }
    expect(MALFORMED.map(([what, money]) => { const r = validateLearnConfig(learnOf(money)); return [what, !r.ok && r.errors.some(e => /\bmoney\b/.test(e))]; }),
      'P103.MP1 — a malformed money member is refused, naming money (R1, R2)').toEqual(MALFORMED.map(([what]) => [what, true]));
    const retainedKept = LEARN_KIND.validateStored!(learnOf(EUR_REFUSE));
    expect(retainedKept.ok ? (retainedKept.value as unknown as Record<string, unknown>).money ?? 'dropped' : (retainedKept as { errors: string[] }).errors.join('; '),
      'P103.MP1 — the retained reader (every read of a published revision) keeps a well-formed money member').toEqual(EUR_REFUSE);
    expect(MALFORMED.map(([what, money]) => { const r = LEARN_KIND.validateStored!(learnOf(money));
      return [what, r.ok ? ('money' in (r.value as unknown as Record<string, unknown>) ? 'kept' : 'dropped') : `refused: ${r.errors.join('; ')}`]; }),
    'P103.MP1 — a retained revision carrying a malformed money member reads with the member dropped, as P36\'s and P11\'s members are').toEqual(MALFORMED.map(([what]) => [what, 'dropped']));
    const types = readTree('src/content/types.ts');
    const learnConfig = types.slice(types.indexOf('export interface LearnConfig {'));
    const body = learnConfig.slice(0, learnConfig.indexOf('\n}\n'));
    expect(/\n\s*money\?\s*:/.test(body) ? 'named' : 'LearnConfig (src/content/types.ts) declares no optional money member',
      'P103.MP1 — LearnConfig names the money member').toBe('named');
  });

  for (const host of HOSTS) {
    it(`host (${host}): PUT /content/learn publishes a money member and GET reads it back; a malformed one is refused 422 naming money and writes nothing; a retained revision with a malformed one reads with it dropped`, async () => {
      const m = await mount(host, docs());
      expectPublished(m, 'P103.MP1 — the catalogue, the home page and a learn document without money publish');
      const published = await putDocument(m, 'learn', learnOf(EUR_REFUSE), 'p103 money policy');
      expect(published.status, `${host}: PRECONDITION — a learn document carrying money publishes: ${JSON.stringify(published.body).slice(0, 300)}`).toBe(200);
      const after = await asOperator(m, 'GET', `/content/learn?scope=${TENANT}`);
      expect((after.body.document as Record<string, unknown> | undefined)?.money ?? 'absent from the document in force',
        `${host}: P103.MP1 — the money member is published and read back with the learn document (today it is dropped)`).toEqual(EUR_REFUSE);

      const refusals: Array<[string, number, boolean]> = [];
      for (const [what, money] of MALFORMED) {
        const answer = await putDocument(m, 'learn', learnOf(money), `p103 ${what}`);
        refusals.push([what, answer.status, errorsOf(answer).some(e => /\bmoney\b/.test(e))]);
      }
      expect(refusals, `${host}: P103.MP1 — each malformed money member is refused 422, naming money`).toEqual(MALFORMED.map(([what]) => [what, 422, true]));
      const unchanged = await asOperator(m, 'GET', `/content/learn?scope=${TENANT}`);
      expect([unchanged.body.revision, (unchanged.body.document as Record<string, unknown> | undefined)?.money],
        `${host}: P103.MP1 — a refused publication writes nothing: the revision in force and its money are unchanged`).toEqual([after.body.revision, EUR_REFUSE]);

      const retained = await mountRetainedLearn(host, learnOf({ currency: 'EUR', nonpositive: 'subtract' }));
      expectPublished(retained, 'P103.MP1 — a retained learn revision carrying a malformed money member is stored as given');
      const read = await asOperator(retained, 'GET', `/content/learn?scope=${TENANT}`);
      const document = read.body.document as Record<string, unknown> | undefined;
      expect({ money: document && 'money' in document ? document.money : 'dropped', slots: Object.keys((document?.slots ?? {}) as object).sort() },
        `${host}: P103.MP1 — the retained revision reads with its malformed money member dropped and every other member kept`).toEqual({ money: 'dropped', slots: [...SLOTS_IN_ORDER].sort() });
    }, 60_000);
  }
});

// ===========================================================================
// unit:P103.MP2 — the published policy reaches the money rule on every outcome path
// ===========================================================================

describe('unit:P103.MP2', () => {
  for (const host of HOSTS) for (const path of ['direct', 'managed recovery'] as const) {
    it(`host (${host}, ${path}): with a policy of EUR, an EUR purchase is credited on the revenue and the margin slot and an EUR add to bag on the add_to_bag revenue slot, a GBP purchase is refused money_policy_unset naming GBP, and nonpositive refuse and credit each behave as named`, async () => {
      const m = await mount(host, docs(EUR_REFUSE), { recovery: path === 'managed recovery' });
      expectPublished(m, 'P103.MP2 — the home page and a learn document with the money policy EUR/refuse publish');
      const answers = tapRing(m);
      const s = await servedShopper(m, `${host}, ${path}`);
      const events = { eur: purchase(575, 230, 'EUR'), gbp: purchase(495, 198, 'GBP'), add: addToBag(575, 'EUR'), refund: purchase(-575, -230, 'EUR') };
      const ids: Record<string, string> = {};
      for (const [name, event] of Object.entries(events)) {
        const sent = await act(m, s, event);
        expect(sent.status, `${host}, ${path}: PRECONDITION — the ${name} event is accepted: ${JSON.stringify(sent.body).slice(0, 200)}`).toBe(200);
        ids[name] = sent.eventId;
      }
      await m.drainLedger();
      const live = await liveCredits(m);
      const moneyTold = (code: string) => ({ code, reason: 'money_policy_unset' });
      expect({ eur: told(answers, ids.eur!), gbp: told(answers, ids.gbp!), add: told(answers, ids.add!), refund: told(answers, ids.refund!), live },
        `${host}, ${path}: P103.MP2 — the published EUR policy reaches the money rule: the EUR purchase credits the revenue slot 575 and the margin slot 230, the EUR add to bag credits the add_to_bag revenue slot 575; the GBP purchase is refused money_policy_unset naming GBP; under nonpositive refuse the EUR refund is refused naming EUR (today no producer passes the policy, so every EUR outcome is refused as unset: S47 Engine 18)`)
        .toEqual({
          eur: { attributed: 3, money: 'none', [HERO]: 'taken', [STORY]: 'taken', [TEASER]: 'reward', [BANNER]: 'taken' },
          gbp: { attributed: 1, money: moneyTold('GBP'), [HERO]: 'money', [STORY]: 'money', [TEASER]: 'money', [BANNER]: 'taken' },
          add: { attributed: 1, money: 'none', [HERO]: 'reward', [STORY]: 'reward', [TEASER]: 'taken', [BANNER]: 'reward' },
          refund: { attributed: 1, money: moneyTold('EUR'), [HERO]: 'money', [STORY]: 'money', [TEASER]: 'money', [BANNER]: 'taken' },
          live: { [HERO]: 575, [STORY]: 230, [TEASER]: 575, [BANNER]: 3 },
        });

      const credit = await putDocument(m, 'learn', learnOf(EUR_CREDIT), 'p103 nonpositive credit');
      expect(credit.status, `${host}, ${path}: PRECONDITION — the policy EUR/credit publishes: ${JSON.stringify(credit.body).slice(0, 200)}`).toBe(200);
      const refundAgain = await act(m, s, purchase(-575, -230, 'EUR'));
      expect(refundAgain.status, `${host}, ${path}: PRECONDITION — the second refund is accepted`).toBe(200);
      await m.drainLedger();
      expect(told(answers, refundAgain.eventId),
        `${host}, ${path}: P103.MP2 — under nonpositive credit the EUR refund is not refused for money: the revenue and the margin slot take it (R3; what it is worth is D09's and is not asserted)`)
        .toEqual({ attributed: 3, money: 'none', [HERO]: 'taken', [STORY]: 'taken', [TEASER]: 'reward', [BANNER]: 'taken' });
    }, 60_000);
  }
});

// ===========================================================================
// unit:P103.MP3 — one credit rule: live learning and every offline fold credit the same outcomes
// ===========================================================================

describe('unit:P103.MP3', () => {
  /** The money rule's table for the day below: no policy refuses every outcome naming a currency; EUR credits EUR alone. */
  const EXPECTED = {
    none: { slots: { [HERO]: 295, [STORY]: 118, [TEASER]: 375, [BANNER]: 3 }, credits: 6 },
    EUR: { slots: { [HERO]: 575 + 295, [STORY]: 230 + 118, [TEASER]: 575 + 375, [BANNER]: 3 }, credits: 9 },
  } as const;
  type Credited = { slots: Record<Slot, number>; credits: number | string };
  /** Each path's credits, or what it answered instead (a refused day is an observation, never a precondition). */
  type Observed = Record<'live' | 'openHour' | 'hourly' | 'raw', Credited | string> & { rebuild: { slots: Record<Slot, number> } | string };
  const refusal = (what: string, answer: Answer) => `${what} answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 160)}`;

  /**
   * One day of the shopper's outcomes taken under `taken` (the policy published when they happen), then, when `folded`
   * differs, another policy published (R-P576: after the hour's outcomes, before its fold), then every offline fold: the
   * open hour's (the five-minute job's foldOpenHours), the closed hour's (catchUp, P05's foldedCredit) and the day it
   * publishes, the raw day (POST /v1/:tenant/learn/report with a custom policy) and the W24 rebuild of every slot.
   */
  /** The day every MP3 leg but R-P588's takes. */
  const DAY = (): Event[] => [purchase(575, 230, 'EUR'), purchase(495, 198, 'GBP'), purchase(295, 118), addToBag(575, 'EUR'), addToBag(375), purchase(99, 40, 'EUR', UNKNOWN_PRODUCT)];
  /** After the publication: the SDK's retries of the day's events (by index, the same wire body) and new events. */
  interface After { retry: number[]; fresh: Event[] }
  async function dayAlike(host: Host, taken: MoneyPolicy | undefined, folded: MoneyPolicy | undefined, recovery = true,
    day: Event[] = DAY(), after: After = { retry: [], fresh: [] }): Promise<Observed> {
    const clock = fixedHour();
    try {
      const m = await mount(host, docs(taken), { recovery });
      expectPublished(m, `P103.MP3 — the home page and a learn document ${taken ? `with the money policy ${taken.currency}` : 'without money'} publish`);
      const answers = tapRing(m);
      const s = await servedShopper(m, `${host}, ${taken?.currency ?? 'none'}`);
      const ids: string[] = [], wires: Array<{ eventId: string; wire: string }> = [];
      for (const event of day) {
        const sent = await act(m, s, event);
        expect(sent.status, `${host}: PRECONDITION — the ${event.type} is accepted: ${JSON.stringify(sent.body).slice(0, 200)}`).toBe(200);
        ids.push(sent.eventId); wires.push(sent);
      }
      await m.drainLedger();

      if (JSON.stringify(folded ?? null) !== JSON.stringify(taken ?? null)) {
        const republished = await putDocument(m, 'learn', learnOf(folded), 'p103 policy published after the outcomes, before the fold');
        expect(republished.status, `${host}: PRECONDITION — the policy ${folded?.currency ?? 'removed'} publishes after the outcomes: ${JSON.stringify(republished.body).slice(0, 200)}`).toBe(200);
      }
      // R-P588: the SDK retries an event the platform already took, with its first event id and time, after the publication.
      for (const index of after.retry) {
        const again = await send(m, s, wires[index]!.wire, wires[index]!.eventId);
        expect(again.status, `${host}: PRECONDITION — the retry of event ${index} is accepted: ${JSON.stringify(again.body).slice(0, 200)}`).toBe(200);
      }
      for (const event of after.fresh) {
        const sent = await act(m, s, event);
        expect(sent.status, `${host}: PRECONDITION — the new ${event.type} is accepted: ${JSON.stringify(sent.body).slice(0, 200)}`).toBe(200);
        ids.push(sent.eventId);
      }
      await m.drainLedger();
      // One answer per outcome id (a retry's answer replaces its first's): what live learning credited, once per outcome.
      const attributed = ids.map(id => [...answers].find(([outcome]) => outcome.endsWith(`:n1:${id}`))?.[1]?.attributed);
      const live = { slots: await liveCredits(m), credits: attributed.every(n => typeof n === 'number') ? attributed.reduce((a, b) => a! + b!, 0)! : `ring answers ${JSON.stringify(attributed)}` };
      const date = new Date(clock.hourStart).toISOString().slice(0, 10), learn = await learnInForce(m);
      // The open hour: the five-minute job's working fold, exactly as src/index.ts runs it, then the day it published.
      await foldOpenHours(m.env.STORAGE as unknown as Parameters<typeof foldOpenHours>[0], TENANT, learn, Date.now(), { start: true, publish: true, budget: RUN_BUDGET }, m.env as never);
      const open = await asOperator(m, 'GET', `/v1/${TENANT}/learn/report?date=${date}&brand=${BRAND}`);
      const openHour = open.status === 200 ? reportCredits(open.body.report as DayReport) : refusal('the day the open hour\'s fold published', open);
      // The hour closed: the five-minute job's catch-up (P05's foldedCredit), until a run folds nothing.
      const failed: unknown[] = [];
      for (let run = 0; run < 40; run++) {
        const result = await catchUp(m.env.STORAGE as unknown as Parameters<typeof catchUp>[0], TENANT, learn, clock.hourStart + HOUR_MS + 6 * 60_000, {}, m.env as never);
        failed.push(...result.failed, ...result.reports.failed);
        if (!result.built.length) break;
      }
      const foldedDay = await asOperator(m, 'GET', `/v1/${TENANT}/learn/report?date=${date}&brand=${BRAND}`);
      const hourly = failed.length ? `the five-minute job's fold refused the hour: ${JSON.stringify(failed).slice(0, 200)}`
        : foldedDay.status === 200 ? reportCredits(foldedDay.body.report as DayReport) : refusal('the folded day', foldedDay);
      // The raw day: the operator's report over the ledger records (a request with a custom policy).
      const rawDay = await asOperator(m, 'POST', `/v1/${TENANT}/learn/report`, { date, brand: BRAND, policies: [{ name: 'p103-direct', scope: 'session', match: 'direct', credit: 'last' }] });
      const raw = rawDay.status === 200 ? reportCredits(rawDay.body.report as DayReport) : refusal('the raw day', rawDay);
      // The W24 rebuild of every slot from the retained day (POST /v1/:tenant/learn/generation { rebuildFrom }).
      const unbuilt: string[] = [];
      for (const slot of SLOTS_IN_ORDER) {
        const rebuilt = await asOperator(m, 'POST', `/v1/${TENANT}/learn/generation`, { slot, brand: BRAND, rebuildFrom: date });
        if (rebuilt.status !== 200) unbuilt.push(refusal(`the rebuild of ${slot}`, rebuilt));
      }
      return { live, openHour, hourly, raw, rebuild: unbuilt.length ? unbuilt.join('; ') : { slots: await liveCredits(m) } };
    } finally { clock.restore(); }
  }
  const alike = (expected: { slots: Record<Slot, number>; credits: number }) => ({ live: expected, openHour: expected, hourly: expected, raw: expected, rebuild: { slots: expected.slots } });

  for (const host of HOSTS) for (const policy of ['none', 'EUR'] as const) {
    it(`host (${host}): ${policy === 'none' ? 'with no money policy, an outcome naming a currency is refused' : 'with a policy of EUR, an EUR outcome is credited and a GBP one refused'} alike by live learning, the open hour's fold, the hourly fold, the raw day and the W24 rebuild`, async () => {
      const taken = policy === 'EUR' ? EUR_REFUSE : undefined;
      expect(await dayAlike(host, taken, taken),
        `${host}: P103.MP3 — one credit rule: live learning and every offline fold ${policy === 'none' ? 'refuse each outcome naming a currency on a money slot' : 'credit the EUR outcomes and refuse the GBP one'}, so the report and a rebuild credit exactly what live learning credits (today the offline folds weigh value with no currency check: S47 Engine 18${policy === 'EUR' ? ', and live learning never receives the policy' : ''})`)
        .toEqual(alike(EXPECTED[policy]));
    }, 90_000);
  }

  // R-P576: a policy published after the hour's outcomes and before its fold. Live learning took each outcome under the
  // policy in force when it happened; every offline fold must credit exactly that, whatever is published when it runs.
  for (const host of HOSTS) for (const path of ['managed recovery', 'direct'] as const) {
    it(`host (${host}, ${path}): outcomes taken under no money policy, then EUR published, then the hour folded, the day read and rebuilt: the report credits what live learning credited`, async () => {
      expect(await dayAlike(host, undefined, EUR_REFUSE, path === 'managed recovery'),
        `${host}, ${path}: P103.MP3 (R-P576) — outcomes live learning took with no policy published are folded as it took them, though EUR is published before the fold: the EUR outcomes stay refused offline as they were live (a fold reading the policy in force when it runs credits them)`)
        .toEqual(alike(EXPECTED.none));
    }, 90_000);
    it(`host (${host}, ${path}): outcomes taken under EUR, then the policy changed to GBP, then the hour folded, the day read and rebuilt: the report credits what live learning credited`, async () => {
      expect(await dayAlike(host, EUR_REFUSE, GBP_REFUSE, path === 'managed recovery'),
        `${host}, ${path}: P103.MP3 (R-P576) — outcomes live learning took under EUR are folded as it took them, though GBP is published before the fold: the EUR outcomes stay credited and the GBP one refused offline as live (a fold reading the policy in force when it runs swaps them)`)
        .toEqual(alike(EXPECTED.EUR));
    }, 90_000);
  }

  // R-P588: an SDK retry of an outcome the platform already took, straddling a publication, is the same outcome:
  // deduplicated, credited once, under its first stamp, live and in every fold. The day: an EUR purchase (575, margin 230)
  // and an EUR add to bag (575) under no policy (refused on the money slots; the purchase counted on the unit slot), a
  // purchase naming no currency (295, margin 118) and an add to bag naming none (375); EUR published; the SDK retries the
  // EUR purchase and the EUR add to bag; a new EUR purchase (495, margin 198) follows, taken under EUR.
  const RETRIED = { slots: { [HERO]: 295 + 495, [STORY]: 118 + 198, [TEASER]: 375, [BANNER]: 3 }, credits: 1 + 3 + 0 + 1 + 3 };
  for (const host of HOSTS) for (const path of ['managed recovery', 'direct'] as const) {
    it(`host (${host}, ${path}): the SDK's retry of outcomes taken under no money policy, sent after EUR is published, is the same outcome — credited once under its first policy, live and in the hour folded, the day read and rebuilt — while a new EUR outcome is credited under EUR`, async () => {
      const day = [purchase(575, 230, 'EUR'), purchase(295, 118), addToBag(575, 'EUR'), addToBag(375)];
      expect(await dayAlike(host, undefined, EUR_REFUSE, path === 'managed recovery', day, { retry: [0, 2], fresh: [purchase(495, 198, 'EUR')] }),
        `${host}, ${path}: P103.MP3 (R-P588) — a retry is the outcome it repeats: the EUR purchase and add to bag stay refused on the money slots and the purchase counts once on the unit slot, live and in every fold, though EUR is in force when the retry arrives; the new EUR purchase is credited 495 and 198`)
        .toEqual(alike(RETRIED));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P103.MP4 — the SDK sends a currency only when the page names one
// ===========================================================================

describe('unit:P103.MP4', () => {
  /** GA4 purchases as a page's data layer pushes them: one naming no currency, one naming EUR. */
  const ga4Purchase = (id: string, currency?: string) => ({ event: 'purchase', ecommerce: { transaction_id: id, value: 575,
    ...(currency === undefined ? {} : { currency }), items: [{ item_id: BAG, item_name: 'Tabby Shoulder Bag 26 With Quilting', quantity: 1, price: 575 }] } });
  type Client = { core: { ready: () => Promise<unknown> }; emit: { dataLayer: (options: { layer: unknown[] }) => () => void } };
  type Factory = (config: { tenant: string }, host: ReturnType<typeof testHost>['host']) => Client;

  /** What one client sends for the two pushes: each purchase's order and currency (`none` when it names none, R7). */
  async function sentFor(factory: Factory, layer: unknown[]): Promise<Array<{ orderId: unknown; currency: unknown }>> {
    const t = testHost({ renderAcks: true });
    const client = factory({ tenant: 'coach' }, t.host);
    await client.core.ready();
    const detach = client.emit.dataLayer({ layer });
    layer.push(ga4Purchase('T-none'), ga4Purchase('T-eur', 'EUR'));
    const purchases = () => t.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!) as { type: string; data: Record<string, unknown> })
      .filter(p => p.type === 'purchase');
    await vi.waitFor(() => expect(purchases().length, 'PRECONDITION — both data-layer purchases are sent').toBe(2));
    detach();
    return purchases().map(p => ({ orderId: p.data.orderId, currency: p.data.currency ?? 'none' }));
  }
  const EXPECTED = [{ orderId: 'T-none', currency: 'none' }, { orderId: 'T-eur', currency: 'EUR' }];

  it('sdk: the SDK source, composed as createClient composes it, sends a data-layer purchase naming no currency with none and one naming EUR with EUR', async () => {
    const source: Factory = (config, host) => { const core = createCore(config, host), listen = createListen(core); return { core, emit: createEmit(core, listen) }; };
    expect(await sentFor(source, []),
      'P103.MP4 — the SDK sends a currency only when the page\'s data layer names one (today the GA4 mapping sends currency: x.currency ?? \'USD\', src/sdk/emit.ts GA4_MAPPING.purchase)')
      .toEqual(EXPECTED);
  });

  it('sdk: each of the six shipped bundles, run as a page runs it, sends a purchase naming no currency with none and one naming EUR with EUR, within its size budget', async () => {
    const budgets = JSON.parse(readTree('packages/sdk/package.json')).sizeBudget as Record<string, number>;
    const shipped: Array<{ path: string; sent: unknown; bytes: number; budget: number }> = [];
    for (const dir of ['public/sdk', 'public/sdk/0.2.0', 'packages/sdk']) for (const file of ['edge-personalization.js', 'edge-personalization.esm.js']) {
      const path = `${dir}/${file}`, code = readTree(path);
      let factory: Factory;
      let layer: unknown[];
      if (file === 'edge-personalization.js') {
        // The script-tag build, as a page script in a jsdom window.
        const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.coach.com/products/tabby-shoulder-bag-26', runScripts: 'outside-only' });
        const page = dom.window as unknown as { eval: (code: string) => unknown; EdgePersonalization?: { createClient: Factory }; dataLayer?: unknown[] };
        page.eval(code);
        page.eval('window.dataLayer = window.dataLayer || [];');
        factory = page.EdgePersonalization!.createClient;
        layer = page.dataLayer!;
      } else {
        // The module build, as src/sdk/emit.test.ts's W26.02 runs it.
        const api = runInNewContext(transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;', { module: { exports: {} }, URL, URLSearchParams, AbortController,
          TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval }) as { createClient: Factory };
        factory = api.createClient;
        layer = [];
      }
      shipped.push({ path, sent: await sentFor(factory, layer), bytes: statSync(new URL(`../../../${path}`, import.meta.url)).size, budget: budgets[`./${file}`]! });
    }
    expect(shipped.map(({ path, sent }) => ({ path, sent })),
      'P103.MP4 — every shipped bundle is regenerated from the SDK that sends a currency only when the data layer names one (node scripts/build-sdk.mjs)')
      .toEqual(shipped.map(({ path }) => ({ path, sent: EXPECTED })));
    expect(shipped.map(({ path, bytes, budget }) => ({ path, withinBudget: Number.isSafeInteger(budget) && bytes <= budget })),
      'P103.MP4 — each bundle within its size budget (packages/sdk/package.json sizeBudget)').toEqual(shipped.map(({ path }) => ({ path, withinBudget: true })));
  });
});

// ===========================================================================
// unit:P103.MP5 — kit 02 says how to publish the policy
// ===========================================================================

describe('unit:P103.MP5', () => {
  it('logic: kit 02 states the learn document\'s money member and its two fields, that the tenant publishes its own values, what is refused and named with and without a policy, that live learning and the report credit the same outcomes, and that the SDK sends a currency only when the data layer names one; the sentences saying none can be published and that the SDK always sends one are gone; kit 03\'s learn-document table lists the money member', () => {
    const text = readTree('docs/kit/02-api-reference.md');
    /** A document's reading units: prose paragraphs, and each table row on its own (unit:W24.R2's idiom). */
    const units = text.split(/\n\s*\n/).flatMap(block => block.trimStart().startsWith('|') ? block.split('\n') : [block]).map(u => u.replace(/\s+/g, ' '));
    const money = units.filter(u => /money polic|`money`|money_policy_unset/.test(u));
    const any = (test: (u: string) => boolean) => money.some(test);
    const sentences = money.flatMap(u => u.split(/(?<=[.;])\s+(?=[A-Z`(])/));
    const flat = text.replace(/\s+/g, ' ');
    const schemas = readTree('docs/kit/03-payload-schemas.md');
    const learnSection = schemas.slice(schemas.indexOf('\n## The learn document'));
    const learnTable = learnSection.slice(0, learnSection.indexOf('\n### ')).split('\n').filter(line => line.startsWith('|'));
    const facts = {
      // How to publish it: the learn document's `money` member, its two fields and their two words.
      member: any(u => /`money`/.test(u) && /PUT \/content\/learn|learn document/i.test(u) && /`currency`/.test(u) && /`nonpositive`/.test(u) && /\brefuse\b/.test(u) && /\bcredit\b/.test(u)),
      // The values are the tenant's own (kept from today's paragraph).
      tenantPublishes: any(u => /publish/i.test(u) && /\b(tenant|customer)/i.test(u) && /\bown\b|invents?\b/i.test(u) && /`money`|money policy/.test(u)),
      // Without a policy: a revenue or margin slot refuses an outcome declaring a currency, by name (W24.R2's facts, kept).
      refusedWithout: any(u => /money_policy_unset/.test(u) && /\b(revenue|margin)\b/.test(u) && /(until|without|no) (a )?money policy/i.test(u) && /declares? a currency/i.test(u)),
      // With a policy: an outcome declaring another currency is refused (a sentence that is not the no-policy one).
      refusedWithPolicy: sentences.some(x => /refus/i.test(x) && /(another|other|different) currency|currency other than/i.test(x) && /polic|published/i.test(x) && !/\buntil\b|\bwithout\b/i.test(x)),
      // Named: the receipt's `code` is the currency the outcome declared (kept).
      namedByCurrency: any(u => /`code`/.test(u) && /currency the outcome declared|declared currency/i.test(u)),
      liveAndReportAlike: any(u => /\b(live|online)\b/i.test(u) && /\b(report|offline|fold|rebuild)/i.test(u) && /\b(same|exactly|alike|identical)\b/i.test(u) && /currenc|money/i.test(u)),
      sdkOnlyWhenNamed: any(u => /\bSDK\b/.test(u) && /data layer/i.test(u) && /currency/i.test(u) && /\bonly when\b|\bonly if\b|names none|names no currency/i.test(u) && !/always carries a currency/.test(u)),
      goneNoneCanBePublished: !/none can be published yet/.test(flat) && !/money policy cannot be published yet/i.test(flat),
      goneSdkAlwaysUsd: !/always carries a currency/.test(flat) && !/`USD` when the data layer names none/.test(flat),
      // Kit 03's learn-document table (its `## The learn document` section): a row naming the `money` member, its two
      // fields and their two words (R-P571 (c)).
      kit03LearnSchema: learnTable.some(row => /^\|\s*`money/.test(row) && /currency/.test(row) && /nonpositive/.test(row) && /\brefuse\b/.test(row) && /\bcredit\b/.test(row)),
    };
    expect(learnTable.length, 'PRECONDITION — kit 03 carries the learn document\'s table').toBeGreaterThan(10);
    expect(facts, `P103.MP5 — kit 02's money paragraph states the money policy as built, and kit 03's learn-document table lists it (R8; ${money.length} unit(s) of kit 02 speak of money today)`)
      .toEqual(Object.fromEntries(Object.keys(facts).map(key => [key, true])));
  });
});

// ===========================================================================
// unit:P103.MP6 — LOCK: unit slots, no policy, priors on money slots
// ===========================================================================

describe('unit:P103.MP6', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCKED — with no money policy every money slot refuses each outcome naming a currency (EUR, GBP, USD) by that currency's name and credits the one naming none, while the unit slot counts every one`, async () => {
      const m = await mount(host, docs());
      expectPublished(m, 'P103.MP6 — the home page and a learn document without money publish');
      const answers = tapRing(m);
      const s = await servedShopper(m, host);
      const ids: Record<string, string> = {};
      for (const [code, event] of [['EUR', purchase(575, 230, 'EUR')], ['GBP', purchase(495, 198, 'GBP')], ['USD', purchase(395, 158, 'USD')], ['none', purchase(295, 118)]] as const) {
        const sent = await act(m, s, event);
        expect(sent.status, `${host}: PRECONDITION — the ${code} purchase is accepted`).toBe(200);
        ids[code] = sent.eventId;
      }
      await m.drainLedger();
      const word = (code: string) => { const t = told(answers, ids[code]!); return typeof t === 'string' ? t : { money: t.money, [HERO]: t[HERO], [STORY]: t[STORY], [BANNER]: t[BANNER] }; };
      const refused = (code: string) => ({ money: { code, reason: 'money_policy_unset' }, [HERO]: 'money', [STORY]: 'money', [BANNER]: 'taken' });
      expect({ EUR: word('EUR'), GBP: word('GBP'), USD: word('USD'), none: word('none'), live: await liveCredits(m) },
        `${host}: P103.MP6 — LOCK: no money policy published, no currency assumed (the platform invents none, USD included): every outcome naming a currency is refused on the money slots by its name, the one naming none is credited, and the unit slot counts all four`)
        .toEqual({ EUR: refused('EUR'), GBP: refused('GBP'), USD: refused('USD'), none: { money: 'none', [HERO]: 'taken', [STORY]: 'taken', [BANNER]: 'taken' },
          live: { [HERO]: 295, [STORY]: 118, [TEASER]: 0, [BANNER]: 4 } });
    }, 60_000);

    it(`host (${host}): LOCKED — with a policy of EUR the unit slot still counts every purchase whatever currency it names, and an imported prior on a money slot is still refused at the import door (D09 is not part of P103) while one on the unit slot is accepted`, async () => {
      const m = await mount(host, docs(EUR_REFUSE));
      expectPublished(m, 'P103.MP6 — the home page and a learn document with the money policy EUR publish');
      const s = await servedShopper(m, host);
      for (const event of [purchase(575, 230, 'EUR'), purchase(495, 198, 'GBP'), purchase(395, 158, 'USD'), purchase(295, 118)]) {
        expect((await act(m, s, event)).status, `${host}: PRECONDITION — the purchase is accepted`).toBe(200);
      }
      await m.drainLedger();
      expect((await liveCredits(m))[BANNER], `${host}: P103.MP6 — LOCK: a slot whose objective is unit counts every event whatever currency it names (moneyRefusal answers null for unit)`).toBe(4);

      const prior = (slot: Slot) => ({ version: 'p103-priors', rows: [{ slot, item: ITEM[slot], cell: '*', p_prior: 0.2, n_equiv: 50 }] });
      const money = await putKind(m, 'priors', prior(HERO));
      const unit = await putKind(m, 'priors', prior(BANNER));
      expect({ money: [money.status, errorsOf(money).some(e => /p_prior/.test(e) && /revenue/.test(e))], unit: unit.status },
        `${host}: P103.MP6 — LOCK: with a money policy published, an imported prior on the revenue slot is still refused 422 naming the row's unit (priorUnitErrors, src/learn/priors.ts; D09), and one on the unit slot is accepted`)
        .toEqual({ money: [422, true], unit: 200 });
    }, 60_000);
  }
});
