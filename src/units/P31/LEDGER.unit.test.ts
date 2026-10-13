// src/units/P31/LEDGER.unit.test.ts
// P31 under the Closure Ledger: the tests for the LOCAL criteria of the P31 work
// order (`tapestry-parity-build`, ticket P31 "'Nothing to show': module
// eligibility by page signal and by context"). It has no decision; LV1 and LV2
// are deferred live rows and get no test.
//
// One `describe('unit:P31.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P31 in section E): "the
//     page can report that a module has nothing to show for this page view, and
//     that module is neither returned nor counted as an exposure; a per-module
//     eligibility rule by context (region, entry channel, visit bucket, stage)
//     can be declared and fails closed; the `eligibleWhen` rule on the demo
//     branch is the starting point, ported with the engine's own context signals";
//   · the investigation, sections G-A (per module, item 9: "when it has nothing
//     to show, and how the page tells us") and G-B (C1 option C: "a per-module
//     eligibility rule by context and state … plus a page-sent 'module is
//     empty' flag"; "the engine cannot know that a module is empty");
//   · the demo branch's rule (src/content/lifecycle.ts:37-73 at 82f41b8d:
//     `eligibleWhen: { regions, context }`, failing closed; a region rule names
//     a region key or its country) and the engine's own context signals
//     (src/services/visit.ts:33-37 the six channel words and the buckets,
//     src/services/JourneyStage.ts:33-36 the stage words);
//   · the existing contract: src/routes/decisions.ts:784-812 (the decision
//     request's fields), src/sdk/listen.ts:11-15, :176-182 (the SDK's request).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   The page's report is `nothingToShow` on the decision request: a JSON array
//   of module identifiers, sent as a string field like `entry` (every field of
//   the request is a string, src/routes/decisions.ts:800-805); the SDK takes it
//   as `nothingToShow: string[]` beside `page` in `hydrate`/`refresh`. A
//   module's rule is the demo branch's `eligibleWhen: { regions?: [region key
//   or country], context?: { entry_channel?: [...], visit_bucket?: [...],
//   journey_stage?: [...] } }`, each list of the engine's own words (the six
//   channel words; '1', '2-3', '4+'; 'exploring', 'considering', 'deciding'),
//   evaluated on the decision's cell, an unknown value satisfying no rule. The
//   record carries the report as `inputs.nothing_to_show` and each rule's verdict
//   as `inputs.eligibility_verdicts` (module → true | false). P29's layout
//   reason names each withheld module as `withheld: [{ module, cause:
//   'nothing_to_show' | 'eligibility_rule' }]` on a changed layout.
//   V1  A module the page reports is neither returned, nor recorded, nor counted;
//       the take fills from the remaining ranking.
//   V2  Grid (rule: the US), reco.1 (deciding), reco.2 (paid social), editorial
//       (a second visit or later), ugc (no rule): a paid-social first visitor
//       geolocated in New York is served reco.2, grid and ugc; a first visitor
//       whose channel and region are unknown is served ugc alone.
//   V3  A direct visitor whose later request carries a paid-social arrival is
//       still direct on her cell, so the paid-social module stays withheld; a
//       report naming a withheld, an excluded and an unregistered module serves
//       exactly what the decision without it serves.
//   V4  `validateContentCatalog` refuses, naming the rule, an unknown signal and
//       a value outside each signal's vocabulary; the record carries the report
//       and the verdicts and every decision replays equal; a catalogue without
//       rules decides and replays as before.
//   V5  The SDK sends the report on its decision request; docs/kit/01, 02 and 03
//       document the report and the rule.
//   V6  The layout reason names the reported module and the rule-withheld
//       modules with their causes.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `nothingToShow` on the decision request and in the SDK's hydrate options,
// `eligibleWhen` on a catalogue piece, `inputs.nothing_to_show`,
// `inputs.eligibility_verdicts`, `layoutReason.withheld`. No new export is
// imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts) and
// src/units/_parity2.ts; the sdk leg drives the real SDK composition
// (`createCore` + `createListen`) over the repository's test host, as
// src/units/P03/LEDGER.unit.test.ts does.

import { describe, expect, it } from 'vitest';

import { validateContentCatalog } from '@/content/kinds';
import type { DecisionRecord } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { createCore } from '@/sdk/core';
import { createListen } from '@/sdk/listen';
import { testHost } from '@/sdk/testHost';

import {
  BRAND, declaredSlots, DIRECT_ENTRY, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, M, MODULES, mount, PAGE_VIEW,
  PAID_SOCIAL_ENTRY, pageInstanceOf, recentSlot, replayOf, rounded, servedIn, shopperOn, storedDecisions, TABBY_VIEWS, TENANT,
  type Decision, type Mounted, type Shopper, type Snapshot,
} from '../_parity';
import { missingStatements } from '../_parity2';
import { vi } from 'vitest';

import { invalidatePublicationCache } from '@/config/publication';

import { asOperator, errorsOf, loadDocument, putDocument, receiptsOf, RECENT_SLOT, type Answer, type Documents, type Host } from '../_parity';

const BASE = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
const NEW_YORK = { country: 'US', regionCode: 'NY' };
const RULES: Record<string, unknown> = {
  [M.grid]: { regions: ['US'] },
  [M.reco1]: { context: { journey_stage: ['deciding'] } },
  [M.reco2]: { context: { entry_channel: ['paid_social'] } },
  [M.editorial]: { context: { visit_bucket: ['2-3', '4+'] } },
};
const RULED = { ...BASE, pieces: MODULES.map(p => RULES[p.id] ? { ...p, eligibleWhen: RULES[p.id] } : p) };

/** The decision request through the route production serves, with the page's fields and, when given, the edge's geolocation. */
async function decisionRequest(m: Mounted, s: Shopper, fields: Record<string, string>, cf?: Record<string, string>): Promise<Snapshot> {
  const request = new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'pdp', brand: BRAND, ...fields }) });
  if (cf) Object.defineProperty(request, 'cf', { value: cf });
  const response = await m.fetch(request);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body, page: 'pdp', ...(fields.pageInstance ? { pageInstance: fields.pageInstance } : {}), decisions: (body.decisions ?? []) as Decision[] };
}
async function arrive(m: Mounted, entry?: Record<string, string>, views: Array<{ type: string; data: Record<string, unknown> }> = []): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, entry)).status, `${m.host}: her page view is accepted`).toBe(200);
  for (const view of views) expect((await s.action(view)).status, `${m.host}: her view is accepted`).toBe(200);
  return s;
}
/** Every layout module of the page acknowledged, the ledger drained, and her stored layout records of this page. */
async function acknowledged(m: Mounted, s: Shopper, page: Snapshot): Promise<DecisionRecord[]> {
  for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `${m.host}: ${d.contentId} acknowledged`).toBe(200);
  await m.drainLedger();
  return storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT && page.decisions.some(d => d.decisionId === r.decision_id));
}
const report = (ids: string[]) => ({ nothingToShow: JSON.stringify(ids) });

// ---------------------------------------------------------------------------
// P31 fix round 1 (R-P59), after the delivery review at e7df0ce6
// (_evidence/parity-step3/P31/reviewer/REPORT.md: probes X1, X1b, U8, X10, X3,
// X7, X4, X5, U10, U4, R7, R1; mutants M15, M16, M4, M11, M1b). The readings
// the tests added below rule, each from R-P59 and the witnesses it names:
//   (1) the layout slot's off-limits mark holds reco.1 at its baseline place
//       (P04) and the reason's baseline is drawn before the withholding
//       (R-P23 C7), so a decision that withholds reco.1 (the page reports it, or
//       its rule is not satisfied) names reco.1 in `withheld` with its cause,
//       as kit 02 names "a module the baseline would have served on one of its
//       positions", and every record of the layout replays equal;
//   (2) a pin refused only because the page reported its module still reserves
//       that module before the withholding, so a page whose report names only
//       the recently-viewed slot's pinned module records its layout, and the
//       reason, exactly as the same page without the report;
//   (3) a receipt of a layout with withheld modules carries them on
//       `layoutReason.withheld`, and its last sentence names each one and its
//       cause before any move (kit 02);
//   (4) publication checks a rule's entry_channel and visit_bucket against the
//       tenant's context vocabulary and visit-bucket cut in force (P36): such a
//       tenant publishes its own channel ids and the names of its cut and is
//       refused a bucket name its cut does not hold; a tenant without the
//       settings is refused and admitted exactly as the V4 logic leg states.
//   The locks for M4, M11 and M1b (R-P59 (5)) pin what the build already does.
// Every page below is decided through the route on rendered-v1 with render
// acknowledgements (R-P18), on the mount the V4 host legs above use.
// ---------------------------------------------------------------------------

/** The layout slot with one module marked off-limits (P04), beside the recently-viewed slot. */
const markedSlots = (id: string) => declaredSlots([layoutSlot({ offLimitsPieceIds: [id] }), recentSlot()]);
/** A rule no shopper of these tests satisfies: the region key CA, while every decision request is geolocated in New York. */
const ELSEWHERE = { regions: ['CA'] };
/** The registered modules, each given its rule where one is named. */
const withRules = (rules: Record<string, unknown>) => MODULES.map(p => rules[p.id] ? { ...p, eligibleWhen: rules[p.id] } : p);
type Withheld = { cause: string; module: string };
type Reason = { status?: unknown; withheld?: Withheld[]; moves?: Array<{ from?: unknown; module: string; to?: unknown }> } & Record<string, unknown>;
/** A record's layout reason, or a sentence saying it has none. */
const reasonOn = (r: DecisionRecord): Reason | string => ((r.explain as Record<string, unknown> | undefined)?.layoutReason as Reason | undefined) ?? 'no explain.layoutReason';
const isServed = (page: Snapshot, slot: string, id: string) => (servedIn(page, slot).includes(id) ? 'served' : 'not served');

interface World { name: string; label: string; docs: Documents; views: boolean; fields: Record<string, string> }
/** R-P59 (1): reco.1 marked off-limits and withheld, reported by the page or by its own rule, for a Tabby shopper and a cold one (probes X1, X1b, U8, X10). */
const MARK_WORLDS: Array<World & { cause: 'nothing_to_show' | 'eligibility_rule' }> = [
  { name: 'reco.1 reported, a Tabby shopper', label: 'p31-r59-reported-tabby', docs: { ...BASE, slots: markedSlots(M.reco1) }, views: true, fields: report([M.reco1]), cause: 'nothing_to_show' },
  { name: 'reco.1 reported, a cold shopper', label: 'p31-r59-reported-cold', docs: { ...BASE, slots: markedSlots(M.reco1) }, views: false, fields: report([M.reco1]), cause: 'nothing_to_show' },
  { name: 'reco.1 withheld by its rule, a Tabby shopper', label: 'p31-r59-ruled-tabby', docs: { ...BASE, pieces: withRules({ [M.reco1]: ELSEWHERE }), slots: markedSlots(M.reco1) },
    views: true, fields: {}, cause: 'eligibility_rule' },
  { name: 'reco.1 withheld by its rule, a cold shopper', label: 'p31-r59-ruled-cold', docs: { ...BASE, pieces: withRules({ [M.reco1]: ELSEWHERE }), slots: markedSlots(M.reco1) },
    views: false, fields: {}, cause: 'eligibility_rule' },
];
/** The controls: the mark holding reco.1 while the page reports reco.2 (X3); a marked module the baseline places beyond the take of 4, reported (X7). */
const HOLDS: World = { name: 'reco.1 marked, reco.2 reported, a Tabby shopper', label: 'p31-r59-holds', docs: { ...BASE, slots: markedSlots(M.reco1) }, views: true, fields: report([M.reco2]) };
const BEYOND: World = { name: 'ugc.1 marked and reported, a Tabby shopper', label: 'p31-r59-beyond', docs: { ...BASE, slots: markedSlots(M.ugc) }, views: true, fields: report([M.ugc]) };
/**
 * R-P59 (3) and the M11 lock: reco.1 withheld by its rule and reco.2 reported, for a Tabby shopper in New York. The baseline
 * is grid.1, reco.1, reco.2, editorial.1 (ugc.1 next); less the withheld modules it is grid.1, editorial.1, ugc.1; the
 * shopper's Tabby interests (P02.A2: reco.2, editorial.1, grid.1, reco.1, ugc.1) serve editorial.1, grid.1, ugc.1.
 */
const BOTH: World = { name: 'reco.1 withheld by its rule, reco.2 reported, a Tabby shopper', label: 'p31-r59-both', docs: { ...BASE, pieces: withRules({ [M.reco1]: ELSEWHERE }) },
  views: true, fields: report([M.reco2]) };
const BOTH_WITHHELD: Withheld[] = [{ cause: 'eligibility_rule', module: M.reco1 }, { cause: 'nothing_to_show', module: M.reco2 }];

/** A world's page through the route on rendered-v1 (R-P18), every drawn layout module acknowledged; the layout records the real consumer stored, by position. */
async function decidedPage(host: Host, w: World): Promise<{ m: Mounted; s: Shopper; page: Snapshot; records: DecisionRecord[] }> {
  const m = await mount(host, w.docs);
  expectPublished(m, `P31 (R-P59, ${w.name}) — the documents publish`);
  const s = await arrive(m, PAID_SOCIAL_ENTRY, w.views ? TABBY_VIEWS.slice(0, 3) : []);
  const page = await decisionRequest(m, s, { pageInstance: pageInstanceOf(w.label), ...w.fields }, NEW_YORK);
  expect(page.status, `${host}: PRECONDITION (${w.name}) — the decision request is answered: ${JSON.stringify(page.body).slice(0, 200)}`).toBe(200);
  const records = (await acknowledged(m, s, page)).sort((a, b) => a.position - b.position);
  expect(records.length, `${host}: PRECONDITION (${w.name}) — the shopper's layout records are stored`).toBeGreaterThan(0);
  return { m, s, page, records };
}
/** Each record's replay through the operator route as [module, status, classification], and the fields each differing replay names. */
async function replaysOf(m: Mounted, records: DecisionRecord[]): Promise<{ table: unknown[][]; diff: string }> {
  const table: unknown[][] = [], diff: unknown[] = [];
  for (const r of records) {
    const replay = await replayOf(m, r.decision_id);
    table.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
    if (Array.isArray(replay.body.diff)) diff.push([r.item_id, (replay.body.diff as Array<{ field?: unknown }>).map(d => d.field)]);
  }
  return { table, diff: JSON.stringify(diff).slice(0, 400) };
}
const allEqual = (records: DecisionRecord[]) => records.map(r => [r.item_id, 200, 'equal']);

/** The legacy GET of the decision route, with query fields and the edge's geolocation (the reviewer's probe U4). */
async function legacyRequest(m: Mounted, s: Shopper, query: string, cf: Record<string, string>): Promise<Snapshot> {
  const request = new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot?page=pdp&brand=${BRAND}${query}`, {
    method: 'GET', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability } });
  Object.defineProperty(request, 'cf', { value: cf });
  const response = await m.fetch(request);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body, page: 'pdp', decisions: (body.decisions ?? []) as Decision[] };
}
const CALIFORNIA = { country: 'US', regionCode: 'CA' };
const EMAIL_ENTRY = { utmMedium: 'email', utmSource: 'newsletter', referrer: '', siteHost: 'www.coach.com' };
/** Every shopper on the holdout's default arm (the reviewer's probe R7). */
const HOLDOUT_LEARN = learnDocument({}, { holdout: { share: 1, salt: 'p31-r59', arms: ['default'] } });

/**
 * R-P59 (4): P36's tenant settings (src/units/P36/LEDGER.unit.test.ts:218-251, the reviewer's probe U10): the customer's
 * nine channels with a published mapping, and the visit-bucket cut [1, 2, 3, 6], whose buckets are 1, 2, 3-5 and 6+.
 */
const CUT_VOCABULARY = {
  channels: [
    { id: 'paid_social', name: 'Paid social' }, { id: 'paid_search_brand', name: 'Paid search (brand)' },
    { id: 'paid_search_nonbrand', name: 'Paid search (non-brand)' }, { id: 'organic', name: 'Organic search' },
    { id: 'email', name: 'Email' }, { id: 'sms', name: 'SMS' }, { id: 'affiliate', name: 'Affiliate' },
    { id: 'referral', name: 'Referral' }, { id: 'direct', name: 'Direct' },
  ],
  rules: [
    { channel: 'sms', utmMedium: ['sms'] },
    { channel: 'email', utmMedium: ['email', 'newsletter', 'crm'] },
    { channel: 'affiliate', utmMedium: ['affiliate'] },
    { channel: 'paid_social', utmMedium: ['paid_social', 'paidsocial'] },
    { channel: 'paid_social', utmMedium: ['cpc', 'paid'], utmSource: ['facebook', 'instagram', 'tiktok', 'pinterest', 'snapchat', 'youtube'] },
    { channel: 'paid_search_brand', utmMedium: ['cpc', 'ppc'], utmCampaign: ['brand'] },
    { channel: 'paid_search_nonbrand', utmMedium: ['cpc', 'ppc'] },
    { channel: 'organic', untagged: true, referrer: ['google.com', 'bing.com'] },
    { channel: 'referral', untagged: true, referrer: 'external' },
    { channel: 'direct', untagged: true, referrer: 'none' },
  ],
  sourcePlatforms: [
    { id: 'meta', name: 'Meta', networks: ['facebook.com', 'instagram.com'] },
    { id: 'tiktok', name: 'TikTok', networks: ['tiktok.com'] },
    { id: 'pinterest', name: 'Pinterest', networks: ['pinterest.com'] },
    { id: 'google', name: 'Google', networks: ['google.com'] },
    { id: 'bing', name: 'Bing', networks: ['bing.com'] },
  ],
  landingPageTypes: [
    { id: 'homepage', name: 'Homepage' }, { id: 'category', name: 'Category page' },
    { id: 'product', name: 'Product page' }, { id: 'editorial', name: 'Editorial or campaign page' },
  ],
  visitBuckets: [1, 2, 3, 6],
  ladder: { order: ['c', 'v', 's', 'r', 'a'], depth: 5 },
};
/** The cut's own bucket names that today's buckets (1, 2-3, 4+) do not hold: a refusal naming the cut's buckets names these. */
const CUT_ONLY = ['3-5', '6+'];
/** An SMS arrival as the published mapping names it (P36's ARRIVALS). */
const SMS_ENTRY = { utmMedium: 'sms', utmSource: 'text_platform', referrer: '', siteHost: 'www.coach.com' };
/** A catalogue publication through the authoring door (PUT /content/catalog), the modules given the named rules. */
const publishRules = (m: Mounted, rules: Record<string, unknown>, note: string) => putDocument(m, 'catalog', { version: 'parity-p31-r59', pieces: withRules(rules) }, note);
/** A publication's status, and whether one of its errors names the rule and every given word. */
const refusal = (answer: { status: number; body: Record<string, unknown> }, words: string[]) =>
  [answer.status, errorsOf(answer).some(e => e.includes('eligibleWhen') && words.every(w => e.includes(w)))];
/**
 * R-P59 (4) as amended: every catalogue write path that validates a rule's words: the primary PUT, the dry run
 * (POST /content/catalog/validate), a catalogue sent as a related member of a slots PUT (publicationChanges) and the
 * JSON import (POST /content/catalog/import), each write with the authored preconditions (kit 02: If-Match plus
 * Idempotency-Key), as the review's door probe drove them.
 */
const WRITE_PATHS = ['the primary PUT', 'the dry run', 'a related member of a slots PUT', 'the JSON import'] as const;
type WritePath = (typeof WRITE_PATHS)[number];
const preconditionsOf = (base: { revision: number; publication: { revision: number; digest: string } }) =>
  ({ 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` });
async function writeRules(m: Mounted, path: WritePath, rules: Record<string, unknown>, note: string): Promise<Answer> {
  if (path === 'the primary PUT') return publishRules(m, rules, note);
  const document = { version: 'parity-p31-r59', pieces: withRules(rules) };
  if (path === 'the dry run') return asOperator(m, 'POST', `/content/catalog/validate?scope=${TENANT}`, { document });
  const answer = path === 'a related member of a slots PUT'
    ? await asOperator(m, 'PUT', `/content/slots?scope=${TENANT}`, { document: BASE.slots, note, publicationChanges: [{ kind: 'catalog', document }] }, preconditionsOf(await loadDocument(m, 'slots')))
    : await asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}&format=json&mode=replace`, document, preconditionsOf(await loadDocument(m, 'catalog')));
  invalidatePublicationCache();
  return answer;
}
/** The refusals a tenant without the settings answers today on every path (the V4 logic leg's words), and the rule it admits. */
const REFUSED_TODAY: Array<[string, unknown, string]> = [
  ['a channel outside the six words', { context: { entry_channel: ['tiktok'] } }, 'tiktok'],
  ['sms, not one of the six words', { context: { entry_channel: ['sms'] } }, 'sms'],
  ['a visit bucket outside the buckets', { context: { visit_bucket: ['5'] } }, '5'],
  ['3-5, not one of today\'s buckets', { context: { visit_bucket: ['3-5'] } }, '3-5'],
];
const TODAY_WORDS = { context: { entry_channel: ['direct', 'paid_social', 'paid_search', 'email', 'organic', 'referral'], visit_bucket: ['1', '2-3', '4+'] } };
/** R-P59 (3) as amended: each withheld module's own cause in words. */
const CAUSE_SAID: Record<string, RegExp> = { eligibility_rule: /eligibility[ _]rule/i, nothing_to_show: /nothing[ _]to[ _]show/i };

// ===========================================================================
// unit:P31.V1 — nothing to show: not returned, not recorded, not counted
// ===========================================================================

describe('unit:P31.V1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a module the page reports as having nothing to show for this page view is neither returned nor recorded nor counted as an exposure, and the slot fills its take from the remaining ranked modules`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P31.V1 — the declared layout slot (P02) publishes');
      const s = await arrive(m, PAID_SOCIAL_ENTRY, TABBY_VIEWS.slice(0, 3));
      const page = await decisionRequest(m, s, { pageInstance: pageInstanceOf('p31-v1'), ...report([M.reco2]) });
      expect(page.status, `${host}: P31.V1 — the decision request carrying the page's report is answered: ${JSON.stringify(page.body).slice(0, 200)}`).toBe(200);
      // Her ranking (P02.A2) is reco.2, editorial.1, grid.1, reco.1, ugc.1: without reco.2 the take of 4 fills from the rest.
      expect.soft(servedIn(page, LAYOUT), `${host}: P31.V1 — the reported module is not returned and the take fills from the remaining ranking`).toEqual([M.editorial, M.grid, M.reco1, M.ugc]);
      const records = await acknowledged(m, s, page);
      expect.soft(records.map(r => r.item_id).sort(), `${host}: P31.V1 — only what was returned is recorded`).toEqual([M.editorial, M.grid, M.reco1, M.ugc].sort());
      expect(rounded(await learned(m), 'n'), `${host}: P31.V1 — one exposure for each module returned and drawn, none for the reported module`)
        .toEqual({ [M.editorial]: 1, [M.grid]: 1, [M.reco1]: 1, [M.ugc]: 1 });
    }, 60_000);
  }

  // R-P59 (5), the review's mutant M4: the report applies on every arm.
  for (const host of HOSTS) {
    it(`host (${host}): LOCK (R-P59 (5), M4) — on the holdout's default arm a module the page reports is not returned, as on the personalized arm; CONTROL: the same shopper on the same arm without the report is served it`, async () => {
      const m = await mount(host, { ...BASE, learn: HOLDOUT_LEARN });
      expectPublished(m, 'P31.V1 (M4) — the holdout puts every shopper on its default arm');
      const s = await arrive(m, PAID_SOCIAL_ENTRY, TABBY_VIEWS.slice(0, 3));
      const control = await decisionRequest(m, s, { pageInstance: pageInstanceOf('p31-m4-control') }, NEW_YORK);
      expect([control.status, control.body.arm, isServed(control, LAYOUT, M.grid)], `${host}: CONTROL — on the default arm, without a report, grid.1 is served`).toEqual([200, 'default', 'served']);
      const page = await decisionRequest(m, s, { pageInstance: pageInstanceOf('p31-m4'), ...report([M.grid]) }, NEW_YORK);
      expect([page.status, page.body.arm, isServed(page, LAYOUT, M.grid)], `${host}: P31.V1 (M4) — on the default arm the reported grid.1 is not returned`).toEqual([200, 'default', 'not served']);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P31.V2 — the eligibility rule by context, failing closed
// ===========================================================================

describe('unit:P31.V2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a module whose rule names a region, entry channel, visit bucket or journey stage the decision's context does not satisfy is not a candidate, an unknown context value satisfies no rule, and a module without a rule is unaffected`, async () => {
      const m = await mount(host, RULED);
      expectPublished(m, 'P31.V2 — the catalogue with per-module eligibility rules publishes');
      const known = await arrive(m, PAID_SOCIAL_ENTRY, TABBY_VIEWS.slice(0, 3));
      const unknown = await arrive(m);
      const inNewYork = await decisionRequest(m, known, { pageInstance: pageInstanceOf('p31-v2-known') }, NEW_YORK);
      const nowhere = await decisionRequest(m, unknown, { pageInstance: pageInstanceOf('p31-v2-unknown') });
      expect(inNewYork.status).toBe(200);
      expect.soft(servedIn(inNewYork, LAYOUT), `${host}: P31.V2 — paid social, first visit, New York, not deciding: reco.2 (paid social) and grid.1 (the US) pass, reco.1 (deciding) and editorial.1 (a later visit) are withheld, ugc.1 (no rule) is unaffected`)
        .toEqual([M.reco2, M.grid, M.ugc]);
      expect(servedIn(nowhere, LAYOUT), `${host}: P31.V2 — an unknown channel and an unknown region satisfy no rule: only the module without a rule is served`).toEqual([M.ugc]);
    }, 60_000);
  }

  // R-P59 (5), the review's mutant M4: the rule applies on every arm.
  for (const host of HOSTS) {
    it(`host (${host}): LOCK (R-P59 (5), M4) — on the holdout's default arm a module whose rule the decision's context does not satisfy is not a candidate; CONTROL: a module whose rule it satisfies is served on the same page`, async () => {
      const m = await mount(host, { ...BASE, pieces: withRules({ [M.grid]: { regions: ['US'] }, [M.reco1]: ELSEWHERE }), learn: HOLDOUT_LEARN });
      expectPublished(m, 'P31.V2 (M4) — the rules publish and the holdout puts every shopper on its default arm');
      const s = await arrive(m, PAID_SOCIAL_ENTRY, TABBY_VIEWS.slice(0, 3));
      const page = await decisionRequest(m, s, { pageInstance: pageInstanceOf('p31-m4-rule') }, NEW_YORK);
      expect([page.status, page.body.arm, isServed(page, LAYOUT, M.grid)], `${host}: CONTROL — on the default arm grid.1, whose rule (the US) New York satisfies, is served`).toEqual([200, 'default', 'served']);
      expect(isServed(page, LAYOUT, M.reco1), `${host}: P31.V2 (M4) — on the default arm reco.1, whose rule (CA) New York does not satisfy, is withheld`).toBe('not served');
    }, 60_000);
  }
});

// ===========================================================================
// unit:P31.V3 — the engine's own cell; the report withholds, never adds
// ===========================================================================

describe('unit:P31.V3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the rule is evaluated on the decision's cell as the engine derives it, never on a value the page sends, and the page's report can withhold a module but never add one`, async () => {
      const m = await mount(host, RULED);
      expectPublished(m, 'P31.V3 — the catalogue with per-module eligibility rules publishes');
      const paid = await arrive(m, PAID_SOCIAL_ENTRY, TABBY_VIEWS.slice(0, 3));
      const control = await decisionRequest(m, paid, { pageInstance: pageInstanceOf('p31-v3-control') }, NEW_YORK);
      expect(servedIn(control, LAYOUT), `${host}: CONTROL — the paid-social shopper is served the paid-social module`).toContain(M.reco2);
      // Her visit is established as direct; a later request that carries a paid-social arrival cannot relabel it (src/content/service.ts:472-474).
      const direct = await arrive(m, DIRECT_ENTRY, TABBY_VIEWS.slice(0, 3));
      const relabelled = await decisionRequest(m, direct, { pageInstance: pageInstanceOf('p31-v3-direct'), entry: JSON.stringify(PAID_SOCIAL_ENTRY) }, NEW_YORK);
      expect(relabelled.status).toBe(200);
      expect.soft(servedIn(relabelled, LAYOUT), `${host}: P31.V3 — the rule reads her cell (direct), not the paid-social arrival her page sent`).toEqual([M.grid, M.ugc]);
      const asked = await decisionRequest(m, paid, { pageInstance: pageInstanceOf('p31-v3-report'), ...report([M.editorial, M.reviews, 'module.PDP.unregistered.9']) }, NEW_YORK);
      expect(asked.status, `${host}: P31.V3 — the decision request carrying the report is answered: ${JSON.stringify(asked.body).slice(0, 200)}`).toBe(200);
      expect(servedIn(asked, LAYOUT), `${host}: P31.V3 — a report naming a withheld, an excluded and an unregistered module adds none of them`).toEqual(servedIn(control, LAYOUT));
    }, 60_000);
  }

  // R-P59 (5), the review's mutant M1b: the page's ctx signals, which only the legacy GET carries, admit nothing.
  for (const host of HOSTS) {
    it(`host (${host}): LOCK (R-P59 (5), M1b) — through the legacy GET a request asserting ctx.region=US-CA and ctx.entry_channel=email for a paid-social shopper decided in New York is served neither the US-CA module nor the email module; CONTROL: a shopper whose own cell is US-CA and email is served both through the same GET`, async () => {
      const m = await mount(host, { ...BASE, pieces: withRules({ [M.grid]: { regions: ['US-CA'] }, [M.reco1]: { context: { entry_channel: ['email'] } } }) });
      expectPublished(m, 'P31.V3 (M1b) — the catalogue with a region rule and a channel rule publishes');
      const own = await arrive(m, EMAIL_ENTRY);
      const control = await legacyRequest(m, own, '', CALIFORNIA);
      expect([control.status, isServed(control, LAYOUT, M.grid), isServed(control, LAYOUT, M.reco1)],
        `${host}: CONTROL — an email arrival decided in California is served the US-CA module and the email module: ${JSON.stringify(control.body).slice(0, 200)}`).toEqual([200, 'served', 'served']);
      const asserting = await arrive(m, PAID_SOCIAL_ENTRY);
      const page = await legacyRequest(m, asserting, '&ctx.region=US-CA&ctx.entry_channel=email', NEW_YORK);
      expect(page.status, `${host}: PRECONDITION — the legacy GET with ctx signals is answered: ${JSON.stringify(page.body).slice(0, 200)}`).toBe(200);
      expect([isServed(page, LAYOUT, M.grid), isServed(page, LAYOUT, M.reco1)], `${host}: P31.V3 (M1b) — the page's ctx signals satisfy no rule: the shopper's own cell (New York, paid social) does not`)
        .toEqual(['not served', 'not served']);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P31.V4 — publication refusals; report and verdicts on the record; replay
// ===========================================================================

describe('unit:P31.V4', () => {
  it('logic: publication refuses, with an error naming the rule, a rule that names an unknown signal or a value outside that signal’s vocabulary, and admits and keeps a rule in the engine’s own words', () => {
    const withRule = (rule: unknown) => ({ pieces: [{ ...MODULES[0]!, eligibleWhen: rule }] });
    const errors = (rule: unknown): string[] => { const checked = validateContentCatalog(withRule(rule)); return checked.ok ? [] : checked.errors; };
    const valid = { regions: ['US', 'US-NY'], context: { entry_channel: ['paid_social', 'email'], visit_bucket: ['1', '2-3'], journey_stage: ['exploring', 'considering'] } };
    const admitted = validateContentCatalog(withRule(valid));
    expect.soft(admitted.ok ? 'admitted' : (admitted as { errors: string[] }).errors.join('; '), 'P31.V4 — a rule in the engine’s own words is admitted').toBe('admitted');
    expect.soft((admitted as { value?: { pieces: Array<Record<string, unknown>> } }).value?.pieces[0]?.eligibleWhen, 'P31.V4 — and kept on the module').toEqual(valid);
    const refusals: Array<[string, unknown, string]> = [
      ['an unknown signal', { context: { weather: ['snow'] } }, 'weather'],
      ['a channel outside the six words', { context: { entry_channel: ['tiktok'] } }, 'tiktok'],
      ['a visit bucket outside the buckets', { context: { visit_bucket: ['5'] } }, '5'],
      ['a stage outside the stage words', { context: { journey_stage: ['buying'] } }, 'buying'],
      ['a region that is no region key', { regions: ['north america'] }, 'north america'],
    ];
    expect(refusals.map(([name, rule, offending]) => [name, errors(rule).some(e => e.includes('eligibleWhen') && e.includes(offending))]),
      `P31.V4 — each is refused naming the rule and the offending value (${JSON.stringify(refusals.map(([name, rule]) => [name, errors(rule)]))})`)
      .toEqual(refusals.map(([name]) => [name, true]));
  });

  for (const host of HOSTS) {
    it(`host (${host}): the page's report and each rule's verdict ride the record's inputs and every decision replays equal, while a catalogue without rules decides and replays as before`, async () => {
      const m = await mount(host, RULED);
      expectPublished(m, 'P31.V4 — the catalogue with per-module eligibility rules publishes');
      // No views: her decision carries no interest driver, so the replay compares the rule's work alone.
      const s = await arrive(m, PAID_SOCIAL_ENTRY);
      const page = await decisionRequest(m, s, { pageInstance: pageInstanceOf('p31-v4'), ...report([M.reco2]) }, NEW_YORK);
      expect(page.status, `${host}: P31.V4 — the decision request carrying the report is answered: ${JSON.stringify(page.body).slice(0, 200)}`).toBe(200);
      const records = await acknowledged(m, s, page);
      expect.soft(records.map(r => [r.item_id, (r.inputs as Record<string, unknown> | undefined)?.nothing_to_show ?? null]),
        `${host}: P31.V4 — every record carries the page's report`).toEqual(records.map(r => [r.item_id, [M.reco2]]));
      expect.soft(records.map(r => [r.item_id, (r.inputs as Record<string, unknown> | undefined)?.eligibility_verdicts ?? null]),
        `${host}: P31.V4 — and each rule's verdict on her cell`).toEqual(records.map(r => [r.item_id, { [M.grid]: true, [M.reco1]: false, [M.reco2]: true, [M.editorial]: false }]));
      const replays: unknown[][] = [];
      for (const r of records) { const replay = await replayOf(m, r.decision_id); replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
      expect.soft(replays, `${host}: P31.V4 — each replays equal`).toEqual(records.map(r => [r.item_id, 200, 'equal']));
      expect(records.length, `${host}: P31.V4 — her decision served the ruled-in modules less the reported one`).toBe(2);

      const before = await mount(host, BASE);
      expectPublished(before, 'P31.V4 — a catalogue without rules publishes');
      const t = await arrive(before, PAID_SOCIAL_ENTRY);
      const plain = await decisionRequest(before, t, { pageInstance: pageInstanceOf('p31-v4-plain') });
      expect(servedIn(plain, LAYOUT), `${host}: P31.V4 — a catalogue without rules decides as before`).toEqual([M.grid, M.reco1, M.reco2, M.editorial]);
      const plainRecords = await acknowledged(before, t, plain);
      const plainReplays: unknown[][] = [];
      for (const r of plainRecords) { const replay = await replayOf(before, r.decision_id); plainReplays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
      expect(plainReplays, `${host}: P31.V4 — and replays equal as before`).toEqual(plainRecords.map(r => [r.item_id, 200, 'equal']));
    }, 60_000);
  }

  // R-P59 (1): a withheld module the off-limits mark would hold replays as it was served (the review's X1, X1b, U8, X10).
  for (const host of HOSTS) {
    it(`host (${host}): R-P59 (1) — on the declared layout slot with reco.1 marked off-limits, a decision that withholds reco.1, because the page reports it or because its rule is not satisfied, for a Tabby shopper and for a cold shopper, does not serve reco.1 and every record of the layout replays equal`, async () => {
      for (const w of MARK_WORLDS) {
        const { m, page, records } = await decidedPage(host, w);
        expect.soft(isServed(page, LAYOUT, M.reco1), `${host}: P31.V4 (R-P59 (1), ${w.name}) — reco.1 is not served`).toBe('not served');
        const replays = await replaysOf(m, records);
        expect.soft(replays.table, `${host}: P31.V4 (R-P59 (1), ${w.name}) — every record of the layout replays equal (differing fields: ${replays.diff})`).toEqual(allEqual(records));
      }
    }, 120_000);

    it(`host (${host}): CONTROL (R-P59 (1)) — the mark holding reco.1 while the page reports reco.2, and a marked module the baseline places beyond the take reported, each replay equal on every record of the layout`, async () => {
      for (const w of [HOLDS, BEYOND]) {
        const { m, records } = await decidedPage(host, w);
        const replays = await replaysOf(m, records);
        expect.soft(replays.table, `${host}: CONTROL (${w.name}) — every record of the layout replays equal (differing fields: ${replays.diff})`).toEqual(allEqual(records));
      }
    }, 120_000);
  }

  // R-P59 (4): the publication door reads the tenant's own vocabulary and cut (the review's reading 2).
  for (const host of HOSTS) {
    it(`host (${host}): R-P59 (4) — on a tenant whose published context vocabulary names nine channels with sms and the visit-bucket cut [1, 2, 3, 6], a rule naming entry_channel sms publishes (200) and an sms arrival is served the module while a direct arrival is not; a rule naming today's '2-3' is refused (422) naming the cut's buckets; a rule naming the cut's '3-5' publishes and matches the shopper's third visit; a channel the vocabulary does not name stays refused; and on every catalogue write path (the primary PUT, the dry run, a related member of a slots PUT, the JSON import) its own words are admitted while '2-3' and tiktok are refused naming them`, async () => {
      const m = await mount(host, { ...BASE, learn: learnDocument({}, { contextVocabulary: CUT_VOCABULARY }) });
      expectPublished(m, 'P31.V4 (R-P59 (4)) — the tenant with the context vocabulary and the cut publishes');
      const T0 = Date.now() - 2 * 86_400_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const sms = await publishRules(m, { [M.grid]: { context: { entry_channel: ['sms'] } } }, 'a rule naming the tenant\'s sms channel');
        expect.soft(sms.status, `${host}: P31.V4 (R-P59 (4)) — a rule naming the tenant's own channel sms publishes: ${JSON.stringify(errorsOf(sms))}`).toBe(200);
        const bySms = await arrive(m, SMS_ENTRY);
        const byDirect = await arrive(m, DIRECT_ENTRY);
        const smsPage = await decisionRequest(m, bySms, { pageInstance: pageInstanceOf('p31-r59-sms') });
        const directPage = await decisionRequest(m, byDirect, { pageInstance: pageInstanceOf('p31-r59-direct') });
        expect(smsPage.status, `${host}: PRECONDITION — the sms arrival's page is answered`).toBe(200);
        expect(directPage.status, `${host}: PRECONDITION — the direct arrival's page is answered`).toBe(200);
        expect.soft([isServed(smsPage, LAYOUT, M.grid), isServed(directPage, LAYOUT, M.grid)],
          `${host}: P31.V4 (R-P59 (4)) — the sms rule's module is served to the sms arrival and withheld from the direct arrival`).toEqual(['served', 'not served']);
        const tiktok = await publishRules(m, { [M.grid]: { context: { entry_channel: ['tiktok'] } } }, 'a channel the vocabulary does not name');
        expect.soft(refusal(tiktok, ['tiktok']), `${host}: P31.V4 (R-P59 (4)) — a channel the tenant's vocabulary does not name is refused, naming it: ${JSON.stringify(errorsOf(tiktok))}`).toEqual([422, true]);
        const today = await publishRules(m, { [M.editorial]: { context: { visit_bucket: ['2-3'] } } }, 'today\'s bucket 2-3');
        expect.soft(refusal(today, ['2-3', ...CUT_ONLY]), `${host}: P31.V4 (R-P59 (4)) — today's '2-3', not a bucket of the cut, is refused naming it and the cut's buckets 1, 2, 3-5, 6+: ${JSON.stringify(errorsOf(today))}`)
          .toEqual([422, true]);
        const cut = await publishRules(m, { [M.editorial]: { context: { visit_bucket: ['3-5'] } } }, 'the cut\'s bucket 3-5');
        expect.soft(cut.status, `${host}: P31.V4 (R-P59 (4)) — a rule naming the cut's bucket '3-5' publishes: ${JSON.stringify(errorsOf(cut))}`).toBe(200);
        const v = await shopperOn(m);
        const visits: string[] = [];
        for (let visit = 1; visit <= 3; visit++) {
          clock.mockReturnValue(T0 + visit * 31 * 60_000);
          expect((await v.action(PAGE_VIEW, DIRECT_ENTRY)).status, `${host}: PRECONDITION — visit ${visit} opens`).toBe(200);
          const page = await decisionRequest(m, v, { pageInstance: pageInstanceOf('p31-r59-visit') });
          expect(page.status, `${host}: PRECONDITION — visit ${visit}: the page is answered`).toBe(200);
          visits.push(isServed(page, LAYOUT, M.editorial));
        }
        expect.soft(visits, `${host}: P31.V4 (R-P59 (4)) — the '3-5' rule's module is withheld on visits 1 and 2 (buckets 1 and 2) and served on visit 3 (bucket 3-5)`)
          .toEqual(['not served', 'not served', 'served']);
        // R-P59 (4) as amended: the same words on every catalogue write path.
        const paths: unknown[][] = [], said: unknown[][] = [];
        for (const path of WRITE_PATHS) {
          const own = await writeRules(m, path, { [M.ugc]: { context: { entry_channel: ['sms'], visit_bucket: ['3-5'] } } }, 'the tenant\'s own sms and 3-5');
          const outside = await writeRules(m, path, { [M.ugc]: { context: { visit_bucket: ['2-3'] } } }, 'today\'s 2-3');
          const unnamed = await writeRules(m, path, { [M.ugc]: { context: { entry_channel: ['tiktok'] } } }, 'tiktok');
          paths.push([path, 'the tenant\'s own sms and 3-5', own.status], [path, 'today\'s 2-3', ...refusal(outside, ['2-3', ...CUT_ONLY])], [path, 'tiktok', ...refusal(unnamed, ['tiktok'])]);
          said.push([path, errorsOf(own), errorsOf(outside), errorsOf(unnamed)]);
        }
        expect.soft(paths, `${host}: P31.V4 (R-P59 (4)) — on every catalogue write path the tenant's own sms and '3-5' are admitted, today's '2-3' is refused naming it and the cut's buckets, and tiktok is refused naming it (${JSON.stringify(said).slice(0, 600)})`)
          .toEqual(WRITE_PATHS.flatMap(path => [[path, 'the tenant\'s own sms and 3-5', 200], [path, 'today\'s 2-3', 422, true], [path, 'tiktok', 422, true]]));
      } finally { clock.mockRestore(); }
    }, 120_000);

    it(`host (${host}): CONTROL (R-P59 (4)) — a tenant without the settings is refused and admitted at publication exactly as the V4 logic leg states: tiktok, sms, '5' and '3-5' refused naming the value; the six channel words and the buckets 1, 2-3 and 4+ admitted; on every catalogue write path (the primary PUT, the dry run, a related member of a slots PUT, the JSON import)`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P31.V4 (R-P59 (4)) — the tenant without the settings publishes');
      const outcomes: unknown[][] = [], said: unknown[][] = [];
      for (const path of WRITE_PATHS) {
        for (const [name, rule, word] of REFUSED_TODAY) {
          const answer = await writeRules(m, path, { [M.grid]: rule }, name);
          outcomes.push([path, name, ...refusal(answer, ['context', word])]);
          said.push([path, name, errorsOf(answer)]);
        }
        const admitted = await writeRules(m, path, { [M.grid]: TODAY_WORDS }, 'the six words and today\'s buckets');
        outcomes.push([path, 'the six words and the buckets 1, 2-3, 4+', admitted.status]);
        said.push([path, 'the six words and the buckets 1, 2-3, 4+', errorsOf(admitted)]);
      }
      expect(outcomes, `${host}: CONTROL — refused and admitted as today on every catalogue write path (${JSON.stringify(said).slice(0, 600)})`).toEqual(WRITE_PATHS.flatMap(path => [
        ...REFUSED_TODAY.map(([name]) => [path, name, 422, true]), [path, 'the six words and the buckets 1, 2-3, 4+', 200]]));
    }, 60_000);
  }
});

// ===========================================================================
// unit:P31.V5 — the SDK sends the report; the kit documents report and rule
// ===========================================================================

describe('unit:P31.V5', () => {
  it('sdk: the real SDK sends the page’s nothing-to-show report on its decision request, as the string field the route reads', async () => {
    const f = testHost({ responses: (url) => url.includes('/decisions/snapshot') ? { ok: true, page: 'pdp', decisions: [] } : { success: true } });
    const core = createCore({ tenant: 'coach', source: 'coach-pdp' }, f.host);
    const listen = createListen(core);
    expect(await core.ready(), 'PRECONDITION: the client is ready').toBe(true);
    await listen.hydrate({ page: 'pdp', nothingToShow: [M.recent] } as unknown as Parameters<typeof listen.hydrate>[0]);
    const request = f.calls.find(c => c.url.includes('/decisions/snapshot'));
    expect(request, 'PRECONDITION: the SDK asked for the page’s decisions').toBeDefined();
    const sent = JSON.parse(request!.init?.body ?? '{}') as Record<string, unknown>;
    expect([typeof sent.nothingToShow, typeof sent.nothingToShow === 'string' ? JSON.parse(sent.nothingToShow) : sent.nothingToShow ?? null],
      `P31.V5 — the decision request carries the report as a JSON string of module identifiers (sent: ${JSON.stringify(sent)})`).toEqual(['string', [M.recent]]);
  });

  it('logic: the integration guide, the API reference and the payload schemas each document the nothing-to-show report and the eligibility rule', () => {
    const missing = missingStatements(['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'the report nothingToShow: a module with nothing to show is neither returned nor counted', test: s => /nothingToShow/.test(s) && /(not|neither) (be )?returned|never returned/i.test(s) },
      { name: 'the rule eligibleWhen by region, entry channel, visit bucket and journey stage', test: s => /eligibleWhen/.test(s) && /region/i.test(s) && /entry_channel|entry channel/i.test(s) && /visit_bucket|visit bucket/i.test(s) && /journey_stage|stage/i.test(s) },
      { name: 'the rule fails closed: an unknown value satisfies no rule', test: s => /eligibleWhen|rule/i.test(s) && /unknown/i.test(s) && /(satisf|match)/i.test(s) },
    ]);
    expect(missing, 'P31.V5 — the kit documents the report and the rule').toEqual([]);
  });
});

// ===========================================================================
// unit:P31.V6 — the layout reason names the withheld modules
// ===========================================================================

describe('unit:P31.V6', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the layout reason names a module withheld for nothing to show, and the modules withheld by their eligibility rule, as the causes of the change they made`, async () => {
      const m = await mount(host, RULED);
      expectPublished(m, 'P31.V6 — the catalogue with per-module eligibility rules publishes');
      const s = await arrive(m, PAID_SOCIAL_ENTRY);
      const page = await decisionRequest(m, s, { pageInstance: pageInstanceOf('p31-v6'), ...report([M.reco2]) }, NEW_YORK);
      expect(page.status, `${host}: P31.V6 — the decision request carrying the report is answered: ${JSON.stringify(page.body).slice(0, 200)}`).toBe(200);
      const records = await acknowledged(m, s, page);
      expect(records.length, `${host}: PRECONDITION — her served layout records`).toBeGreaterThan(0);
      for (const r of records) {
        expect.soft((r.explain as Record<string, unknown>).layoutReason ?? 'no explain.layoutReason', `${host}: P31.V6 — the record of ${r.item_id} names each withheld module and why`).toMatchObject({
          status: 'changed', withheld: expect.arrayContaining([{ module: M.reco2, cause: 'nothing_to_show' }, { module: M.reco1, cause: 'eligibility_rule' }, { module: M.editorial, cause: 'eligibility_rule' }]) });
      }
    }, 60_000);
  }

  // R-P59 (1): the reason names a withheld module the off-limits mark would hold (the review's X1, X1b, U8, X10).
  for (const host of HOSTS) {
    it(`host (${host}): R-P59 (1) — on the declared layout slot with reco.1 marked off-limits, the reason of a decision that withholds reco.1, because the page reports it or because its rule is not satisfied, for a Tabby shopper and for a cold shopper, names reco.1 in withheld with its cause on every record of the layout`, async () => {
      for (const w of MARK_WORLDS) {
        const { page, records } = await decidedPage(host, w);
        expect.soft(isServed(page, LAYOUT, M.reco1), `${host}: P31.V6 (R-P59 (1), ${w.name}) — reco.1 is not served`).toBe('not served');
        expect.soft(records.map(r => [r.item_id, reasonOn(r)]), `${host}: P31.V6 (R-P59 (1), ${w.name}) — every record names reco.1 withheld, cause ${w.cause}, on a changed layout`)
          .toEqual(records.map(r => [r.item_id, expect.objectContaining({ status: 'changed', withheld: [{ cause: w.cause, module: M.reco1 }] })]));
      }
    }, 120_000);

    it(`host (${host}): CONTROL (R-P59 (1)) — the mark holding reco.1 at its baseline position 2 while the page reports reco.2 names reco.2 alone as withheld; a marked module the baseline places beyond the take, reported, is named by no record (kit 02: only a module the baseline would have served on one of its positions)`, async () => {
      const holds = await decidedPage(host, HOLDS);
      expect.soft(servedIn(holds.page, LAYOUT)[1], `${host}: CONTROL (${HOLDS.name}) — the mark holds reco.1 at position 2`).toBe(M.reco1);
      expect.soft(holds.records.map(r => [r.item_id, reasonOn(r)]), `${host}: CONTROL (${HOLDS.name}) — every record names reco.2 withheld, cause nothing_to_show`)
        .toEqual(holds.records.map(r => [r.item_id, expect.objectContaining({ status: 'changed', withheld: [{ cause: 'nothing_to_show', module: M.reco2 }] })]));
      const beyond = await decidedPage(host, BEYOND);
      expect.soft(isServed(beyond.page, LAYOUT, M.ugc), `${host}: CONTROL (${BEYOND.name}) — ugc.1 is not served`).toBe('not served');
      expect.soft(beyond.records.map(r => { const reason = reasonOn(r); return [r.item_id, typeof reason === 'string' ? reason : [reason.status, (reason.withheld ?? []).map(x => x.module)]]; }),
        `${host}: CONTROL (${BEYOND.name}) — the shopper's Tabby interests changed the layout and no record names ugc.1, which the baseline places at 5`)
        .toEqual(beyond.records.map(r => [r.item_id, ['changed', []]]));
    }, 120_000);
  }

  // R-P59 (2): a pin refused only by the withholding still reserves its module before the withholding (the review's X4 against X5).
  for (const host of HOSTS) {
    it(`host (${host}): R-P59 (2) — a cold shopper's page whose report names only the recently-viewed slot's pinned module, refusing that pin, records its layout unchanged with exactly the reason of the same page without the report, and every record of the layout replays equal`, async () => {
      const control = await decidedPage(host, { name: 'no report (X5)', label: 'p31-r59-x5', docs: BASE, views: false, fields: {} });
      const unchanged = reasonOn(control.records[0]!);
      expect(typeof unchanged === 'string' ? unchanged : unchanged.status, `${host}: CONTROL — without the report the cold shopper's layout is unchanged: ${JSON.stringify(unchanged)}`).toBe('unchanged');
      const reported = await decidedPage(host, { name: 'recent.1 reported (X4)', label: 'p31-r59-x4', docs: BASE, views: false, fields: report([M.recent]) });
      expect(isServed(reported.page, RECENT_SLOT, M.recent), `${host}: PRECONDITION — the reported recent.1 is not returned`).toBe('not served');
      expect(servedIn(reported.page, LAYOUT), `${host}: PRECONDITION — the layout served is the layout served without the report`).toEqual(servedIn(control.page, LAYOUT));
      expect.soft(reported.records.map(r => [r.item_id, reasonOn(r)]), `${host}: P31.V6 (R-P59 (2)) — every record carries the unreported page's reason: unchanged, ${JSON.stringify(unchanged)}`)
        .toEqual(reported.records.map(r => [r.item_id, unchanged]));
      const replays = await replaysOf(reported.m, reported.records);
      expect.soft(replays.table, `${host}: P31.V6 (R-P59 (2)) — every record of the layout replays equal (differing fields: ${replays.diff})`).toEqual(allEqual(reported.records));
    }, 120_000);
  }

  // R-P59 (3): the receipt side of remaining-work item 4 (the review's mutants M15 and M16).
  for (const host of HOSTS) {
    it(`host (${host}): R-P59 (3) — the receipt of a layout with withheld modules, read through the route on rendered-v1 with render acknowledgements (R-P18), carries layoutReason.withheld with each module and its cause in baseline order, and its last sentence names each withheld module with its own cause before the moves`, async () => {
      const { m, s, records } = await decidedPage(host, BOTH);
      const reason = reasonOn(records[0]!);
      const moved = typeof reason === 'string' ? [] : (reason.moves ?? []).map(x => x.module);
      expect(moved.length, `${host}: PRECONDITION — the layout changed with moves: ${JSON.stringify(reason)}`).toBeGreaterThan(0);
      const receipts = (await receiptsOf(m, s.subject)).filter(r => r.slot === LAYOUT);
      expect(receipts.length, `${host}: PRECONDITION — a receipt for every acknowledged layout record`).toBe(records.length);
      expect.soft(receipts.map(r => [r.item, r.layoutReason ?? 'no layoutReason']), `${host}: P31.V6 (R-P59 (3)) — every receipt carries the withheld modules, reco.1 (its rule) then reco.2 (the report)`)
        .toEqual(receipts.map(r => [r.item, expect.objectContaining({ status: 'changed', withheld: BOTH_WITHHELD })]));
      const sentences = receipts.map(r => String(((r.why as unknown[] | undefined) ?? []).at(-1) ?? ''));
      // R-P59 (3) as amended: each withheld module is paired with its own cause, in the words from its name up to the next module the sentence names.
      const named = sentences.map((sentence, k) => {
        const firstMove = Math.min(sentence.length, ...moved.map(id => sentence.indexOf(id)).filter(at => at >= 0));
        const marks = [...BOTH_WITHHELD.map(w => w.module), ...moved].map(id => sentence.indexOf(id)).filter(at => at >= 0).sort((a, b) => a - b);
        const paired = BOTH_WITHHELD.map(w => {
          const start = sentence.indexOf(w.module);
          if (start < 0 || start >= firstMove) return false;
          return CAUSE_SAID[w.cause]!.test(sentence.slice(start, marks.find(at => at > start) ?? sentence.length));
        });
        return [receipts[k]!.item, ...paired];
      });
      expect.soft(named, `${host}: P31.V6 (R-P59 (3)) — the last sentence names reco.1 with its own cause (its eligibility rule) and reco.2 with its own (nothing to show), each before the moves (${JSON.stringify(sentences[0])})`)
        .toEqual(receipts.map(r => [r.item, true, true]));
    }, 60_000);

    // R-P59 (5), the review's mutant M11: the moves compare the served order with the baseline less the withheld modules.
    it(`host (${host}): LOCK (R-P59 (5), M11) — with reco.1 withheld by its rule and reco.2 reported, the moves compare the served order with the baseline less the withheld modules: editorial.1 from 2 to 1 and grid.1 from 1 to 2 on every record, and ugc.1, which only took a withheld module's place, is not called moved`, async () => {
      const { records } = await decidedPage(host, BOTH);
      expect(records.map(r => r.item_id), `${host}: PRECONDITION — the Tabby shopper is served editorial.1, grid.1, ugc.1`).toEqual([M.editorial, M.grid, M.ugc]);
      const moves = (r: DecisionRecord) => { const reason = reasonOn(r); return typeof reason === 'string' ? reason
        : [...(reason.moves ?? [])].sort((a, b) => Number(a.to) - Number(b.to)).map(x => [x.module, x.from, x.to]); };
      expect(records.map(r => [r.item_id, moves(r)]), `${host}: P31.V6 (M11) — the moves, measured against grid.1, editorial.1, ugc.1`)
        .toEqual(records.map(r => [r.item_id, [[M.editorial, 2, 1], [M.grid, 1, 2]]]));
    }, 60_000);
  }
});
