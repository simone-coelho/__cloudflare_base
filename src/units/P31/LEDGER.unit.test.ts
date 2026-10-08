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
});
