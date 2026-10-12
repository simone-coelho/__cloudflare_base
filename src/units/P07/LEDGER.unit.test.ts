// src/units/P07/LEDGER.unit.test.ts
// P07 under the Closure Ledger: the tests for the LOCAL criteria of the P07 work
// order (`tapestry-parity-build`, ticket P07 "Channel and visit number before the
// first click"). DC1 (decision D1) is ruled and exercised inside C1, C2 and C4;
// LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P07.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P07 in section A): "for a
//     first-time visitor, channel and visit number shape the first decision
//     through a population prior per context, beside the regional prior, and the
//     receipt itemizes it ('population prior, paid social, first visit')";
//   · freeze sheet item 22 (D1: "the context prior takes the regional prior's
//     form: its own block and K, off when absent, aggregated per channel × visit
//     bucket") and item 37 ("falls back from channel and visit bucket to the
//     channel alone, never to everyone, so the regional prior's shares are not
//     double-counted; aggregated through the existing population-trend object,
//     with no new binding");
//   · the investigation, section G-B (C2 and "is the layout per shopper or per
//     context?": the channel × visit prior is a context term) and G-C (option c);
//   · the parity document, section 3.4 (cited by number only);
//   · the regional prior the work order names as the form to take:
//     src/reflex/regionTrend.ts:13-14 (λ = K / (K + Σ a), ã = (1 − λ)·a + λ·share),
//     :123-131 (shares within a dimension, leader = 1), :194-210 (the finest
//     level with at least minEvents events), src/content/service.ts:523-537 (read
//     only when the block enables it, never on the default arm),
//     src/content/kinds.ts:531-541 (the block: enabled, kBlend, minEvents),
//     src/content/decide.ts:455-469, :526, :558 (itemised per record, shares on
//     the record's inputs).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   The block is `contextPrior: { enabled, kBlend, minEvents }` in the learn
//   document, beside `regional`, with the regional block's own grammar. The
//   population shares are per tenant, entry channel and visit bucket ('1',
//   '2-3', '4+'), within each dimension with the leader at 1, as the regional
//   shares are. A decision reads the shares of the shopper's channel and visit
//   bucket when that pair has at least `minEvents` events, else the shares of
//   her channel alone (all buckets), never everyone's. λ = kBlend / (kBlend +
//   Σ personal affinity), its own K, so a first-time visitor's λ is 1.
//   "Beside the regional prior": both priors shape the decision; neither erases
//   the other (asserted only where every combination that keeps both agrees).
//   On the record: `explain.contextPrior: { channel, visitBucket, level
//   ('channel_visit' | 'channel'), lambda, version, events, contribution }`
//   where it contributed (the regional block's form, `explain.regional`), and
//   `inputs.context_share` (the shares used, the form of `inputs.regional_share`);
//   on the receipt, a sentence naming "population prior" with the channel and
//   the visit in words ("paid social", "first visit"); the channel alone names
//   no visit.
//   C1  With the block and the regional prior both on, a first-time paid-social
//       visitor's first layout leads with the module the paid-social first-visit
//       population favours, a first-time direct visitor's with the one the
//       direct population favours (with no prior both open on the grid); the
//       record itemises the context prior (paid_social, '1', channel_visit,
//       λ 1); the receipt says "population prior, paid social, first visit";
//       and on the same page the regional prior (published on the Brooklyn
//       line, which only the story slot's piece carries) still shapes and
//       itemises the story slot.
//   C2  λ uses the block's own K (4) while the regional prior keeps its own (1);
//       a returning paid-social shopper (bucket '2-3', whose pair has no events)
//       reads the channel's shares (level 'channel'), which hold no direct
//       visitor's value, and her receipt names the channel without a visit.
//   C3  Scored events fan into population shares per channel and visit bucket
//       through objects of the existing REGION_TREND namespace (no other binding
//       is bound), no object of it and no value it publishes holds a visitor or
//       session identifier, a shopper who refused tracking adds nothing, and a
//       shopper who allowed tracking only adds to the context shares exactly
//       when she adds to her region's trend.
//   C4  A learn document without the block decides exactly what it decided
//       before (the same population, the same terms); with the block, a shopper
//       on the holdout's default arm and one without personalization consent
//       get no context prior.
//   C5  Every record of a decision under the prior carries the shares it used;
//       the decision replays equal, the replay reproducing `explain.contextPrior`;
//       a record decided without the block replays equal as before.
//   C6  docs/kit/02 and 03 each document the block, its fallback and the
//       receipt line.
//
// LOCKS ADDED IN FIX ROUND 1 (R-P53), green against the build at 2b119290,
// each with its mutant control measured on a scratch copy:
//   C2  the minimum: a pair snapshot with events above 0 and below minEvents
//       gives way to the channel alone (level 'channel', the "every visit"
//       receipt, the channel's shares), and a pair with exactly minEvents
//       answers (level 'channel_visit', the visit in words); controls MP (the
//       pair used whenever its snapshot exists) and the off-by-one (the pair
//       used only above the minimum), src/reflex/regionTrend.ts:302.
//   C3  the rollup: context scopes stay out of the regional country and global
//       rollups, which count the leaf regions alone; control MR (a context
//       pair falling through to the regional leaf test: the `continue` at
//       src/reflex/regionTrend.ts:413 removed).
//   C4  the enablement: a block published with `enabled: false` decides term
//       for term as the block absent; control ME (`enabled` ignored where the
//       block is read), src/content/service.ts:598.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `contextPrior` in the learn document, `explain.contextPrior` and
// `inputs.context_share` on the record. No new export is imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts) and
// src/units/_parity2.ts (the REGION_TREND namespace on the real RegionTrend
// class, its objects published through their own doors). The page is the PDP
// with the modules slot UNDECLARED (governance 3): P07 does not depend on P02.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DecisionRecord } from '@/content/types';
import { REGION_GENERATION, trendKey } from '@/reflex/regionTrend';

import {
  DIRECT_ENTRY, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf,
  productView, putDocument, receiptsOf, recentSlot, replayOf, servedIn, servePage, shopperOn, storedDecisions, TENANT, toLedger,
  VIEW_TABBY_26, VIEW_TABBY_QUILTED, type Host, type Mounted, type Shopper,
} from '../_parity';
import { actionAt, bindTrend, missingStatements, publishTrends, trendStorageText } from '../_parity2';

const STORY = 'pdp-story';
/** Catalogue rows carrying the line values the fixture's other shoppers view, so the published vocabulary admits them (G-A). */
const STORY_PIECES = ['Rogue', 'Brooklyn'].map(line => ({ id: `story.${line.toLowerCase()}`, customerContentId: `TAP-STORY-${line.toUpperCase()}`,
  type: 'editorial', title: `${line} story`, tags: { line: [line] }, slotTypes: [STORY], lifecycle: { status: 'live' } }));
const PIECES = [...MODULES, ...STORY_PIECES];
/** The PDP with the modules slot undeclared (governance 3), the recently-viewed slot below it and a story slot. */
const SLOTS = JSON.parse(JSON.stringify({ version: 'parity-p07-slots', governanceVersion: 3,
  pages: { pdp: [{ ...layoutSlot(), layout: undefined }, recentSlot(), { slot: STORY, take: 1, weights: { line: 1 } }] } }));

/** Coach rows (src/data/coach-catalog.json): COA-C2621 Willow Shoulder Bag, COA-CP133 Rogue Bag 25, COA-CU068 Brooklyn Shoulder Bag 28. */
const VIEW_WILLOW = productView({ productId: 'COA-C2621', line: 'Willow', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['work', 'everyday'], price_usd: 350 });
const VIEW_ROGUE = productView({ productId: 'COA-CP133', line: 'Rogue', category: 'Handbags', subcategory: 'Top-Handle Bags', silhouette: 'top-handle', occasion: ['work', 'evening', 'special-occasion'], price_usd: 595 });
const VIEW_BROOKLYN = productView({ productId: 'COA-CU068', line: 'Brooklyn', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['work', 'everyday'], price_usd: 295 });
const EMAIL_ENTRY = { utmMedium: 'email', utmSource: 'newsletter' };
const NEW_YORK = { country: 'US', regionCode: 'NY' };

const CONTEXT_PRIOR = { enabled: true, kBlend: 1, minEvents: 3 };
const REGIONAL_ON = { enabled: true, kBlend: 1, minEvents: 1 };
/** With no signal: the first four eligible modules in catalogue order (P02.A2). */
const COLD = [M.grid, M.reco1, M.reco2, M.editorial];

/** Four paid-social first visitors who each view the quilted Tabby, and four direct first visitors who each view the Willow. */
async function population(m: Mounted, each = 4): Promise<Shopper[]> {
  const out: Shopper[] = [];
  for (const [entry, view] of [[PAID_SOCIAL_ENTRY, VIEW_TABBY_QUILTED], [DIRECT_ENTRY, VIEW_WILLOW]] as const) {
    for (let i = 0; i < each; i++) {
      const s = await shopperOn(m);
      expect((await s.action(view, entry)).status, `${m.host}: PRECONDITION — a population view is accepted`).toBe(200);
      out.push(s);
    }
  }
  return out;
}
/**
 * What the population everywhere engages with (the regional prior's published
 * global snapshot, written after the rollup that would replace it): the Brooklyn
 * line, which only the story slot's piece carries, so the regional prior moves
 * the story slot and leaves the layout to the context prior alone, whatever
 * arithmetic keeps both priors.
 */
async function publishRegionalEverywhere(m: Mounted): Promise<void> {
  const now = Date.now();
  await m.cache.put(trendKey(TENANT, '*'), JSON.stringify({ generation: REGION_GENERATION, tenant: TENANT, region: '*', level: 'global', events: 500,
    updatedAt: now, version: now, r: { line: { Brooklyn: 5 } }, share: { line: { Brooklyn: 1 } } }));
}
async function firstVisit(m: Mounted, entry: Record<string, string>): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, entry)).status, `${m.host}: her page view is accepted`).toBe(200);
  return s;
}
/** Her page through the route, every layout module acknowledged, and the ledger drained. */
async function pageAndLedger(m: Mounted, s: Shopper, label: string) {
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `${m.host}: ${JSON.stringify(page.body).slice(0, 300)}`).toBe(200);
  for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `${m.host}: ${d.contentId} acknowledged`).toBe(200);
  await m.drainLedger();
  const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT && page.decisions.some(d => d.decisionId === r.decision_id));
  return { served: servedIn(page, LAYOUT), records, page };
}
const contextOf = (r: DecisionRecord | undefined) => (r?.explain as Record<string, unknown> | undefined)?.contextPrior as Record<string, unknown> | undefined;
const sharesOf = (r: DecisionRecord | undefined) => (r?.inputs as Record<string, unknown> | undefined)?.context_share as Record<string, Record<string, number>> | undefined;
const sentenceOf = (receipt: Record<string, unknown> | undefined) => ((receipt?.why ?? []) as string[]).find(w => /population prior/i.test(w)) ?? '';
const sumOf = (dims: Record<string, Record<string, number>> | undefined) => Object.values(dims ?? {}).reduce((t, values) => t + Object.values(values).reduce((a, b) => a + b, 0), 0);

afterEach(() => { vi.useRealTimers(); });

// ===========================================================================
// unit:P07.C1 — the first decision is shaped by her channel and visit, beside the region
// ===========================================================================

describe('unit:P07.C1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with the context prior's block published, a first-time visitor's first decision blends the shares of her channel and visit bucket beside the regional prior, and the record and the receipt itemise it with its context in words`, async () => {
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: learnDocument({}, { regional: REGIONAL_ON, contextPrior: CONTEXT_PRIOR }) });
      expectPublished(m, 'P07.C1 — the learn document with the context prior’s block and the regional prior publishes');
      const trend = bindTrend(m);
      await population(m);
      await publishTrends(m, trend);
      await publishRegionalEverywhere(m);
      const sarah = await firstVisit(m, PAID_SOCIAL_ENTRY), dana = await firstVisit(m, DIRECT_ENTRY);
      const paid = await pageAndLedger(m, sarah, 'p07-c1-paid'), direct = await pageAndLedger(m, dana, 'p07-c1-direct');
      // Paid social, first visit: the population favours Tabby, Handbags and evening, so complete-the-look (Tabby, evening) leads;
      // direct, first visit: the population favours Willow, so the Willow recommendations lead. With no prior both open on the grid.
      expect.soft(paid.served[0], `${host}: P07.C1 — paid social, first visit: the module her context's population favours leads the first decision (served ${JSON.stringify(paid.served)})`).toBe(M.reco2);
      expect.soft(direct.served[0], `${host}: P07.C1 — direct, first visit: the module that context's population favours leads (served ${JSON.stringify(direct.served)})`).toBe(M.reco1);
      const reco2 = paid.records.find(r => r.item_id === M.reco2);
      expect.soft(contextOf(reco2) ?? `the record carries no explain.contextPrior (explain: ${Object.keys(reco2?.explain ?? {}).join(', ')})`,
        `${host}: P07.C1 — the record itemises the context prior: paid social, first visit, the pair's own shares, λ 1 for a first-time visitor`)
        .toMatchObject({ channel: 'paid_social', visitBucket: '1', level: 'channel_visit', lambda: 1 });
      const receipt = (await receiptsOf(m, sarah.subject)).find(r => r.slot === LAYOUT && r.item === M.reco2);
      const sentence = sentenceOf(receipt);
      expect.soft([/paid social/i.test(sentence), /first visit/i.test(sentence)],
        `${host}: P07.C1 — her receipt itemises "population prior, paid social, first visit" (why: ${JSON.stringify(receipt?.why)})`).toEqual([true, true]);
      // Beside the regional prior: the same decision still blends the region's shares, which move the story slot.
      const story = (await servePage(m, sarah, 'pdp')).records.find(r => r.slot === STORY);
      expect([story?.item_id, story?.explain.regional?.lambda], `${host}: CONTROL — beside it, the regional prior still shapes and itemises the same page (the story slot)`).toEqual(['story.brooklyn', 1]);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P07.C2 — its own K; the pair, else the channel alone, never everyone
// ===========================================================================

describe('unit:P07.C2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the context prior's weight is K / (K + Σ personal affinity) with its own K, and a shopper whose channel-and-visit pair has fewer events than the minimum reads her channel's shares alone, never everyone's`, async () => {
      const learn = learnDocument({}, { regional: REGIONAL_ON, contextPrior: { enabled: true, kBlend: 4, minEvents: 4 } });
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn });
      expectPublished(m, 'P07.C2 — the learn document with a context prior of K 4 and minimum 4 publishes');
      const trend = bindTrend(m);
      await population(m);
      await publishTrends(m, trend);
      await publishRegionalEverywhere(m);

      // Her own evidence: one Tabby view on her first visit.
      const own = await firstVisit(m, PAID_SOCIAL_ENTRY);
      expect((await own.action(VIEW_TABBY_26)).status).toBe(200);
      const evidence = sumOf(((await own.hydrate()).body as { affinity?: { dims?: Record<string, Record<string, number>> } }).affinity?.dims);
      expect(evidence, `${host}: PRECONDITION — her view built personal evidence`).toBeGreaterThan(0);
      const set = await servePage(m, own, 'pdp');
      const mine = set.records.find(r => r.slot === LAYOUT && r.item_id === M.reco2);
      expect(set.regional?.lambda ?? null, `${host}: CONTROL — the regional prior keeps its own K of 1: λ = 1 / (1 + Σ a)`).toBeCloseTo(1 / (1 + evidence), 2);
      expect.soft(Number(contextOf(mine)?.lambda ?? Number.NaN), `${host}: P07.C2 — the context prior weighs with its own K of 4: λ = 4 / (4 + Σ a), Σ a = ${evidence}`)
        .toBeCloseTo(4 / (4 + evidence), 2);

      // A returning paid-social shopper: her second visit (after the 30-minute gap) is bucket 2-3, a pair with no events.
      const back = await firstVisit(m, PAID_SOCIAL_ENTRY);
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31 * 60_000, shouldAdvanceTime: true });
      expect((await back.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${host}: her second visit's page view is accepted`).toBe(200);
      const returning = await pageAndLedger(m, back, 'p07-c2-back');
      const record = returning.records.find(r => r.item_id === M.reco2);
      expect(record?.cell.visit_bucket, `${host}: PRECONDITION — she is on her second visit`).toBe('2-3');
      expect.soft(contextOf(record) ?? 'no explain.contextPrior on her record', `${host}: P07.C2 — a pair below the minimum falls back to her channel alone`)
        .toMatchObject({ channel: 'paid_social', visitBucket: '2-3', level: 'channel' });
      expect.soft(sharesOf(record)?.line ?? 'no inputs.context_share on her record',
        `${host}: P07.C2 — the channel's own shares: paid social viewed only Tabby; a fallback to everyone would carry the direct visitors' Willow`).toEqual({ Tabby: 1 });
      expect.soft(returning.served[0], `${host}: P07.C2 — and the channel's population shapes her decision`).toBe(M.reco2);
      const sentence = sentenceOf((await receiptsOf(m, back.subject)).find(r => r.slot === LAYOUT && r.item === M.reco2));
      expect([/paid social/i.test(sentence), /first visit|visit 2-3/i.test(sentence)],
        `${host}: P07.C2 — her receipt names the population prior of her channel, and no visit it did not use (sentence: ${JSON.stringify(sentence)})`).toEqual([true, false]);
    }, 60_000);

    // LOCK (fix round 1, R-P53 b): green against the build at 2b119290. Its controls, measured on a scratch copy:
    // MP (src/reflex/regionTrend.ts:302, the pair used whenever its snapshot exists) turns the first clause RED on
    // both hosts; the off-by-one (the same line, the pair used only above the minimum) turns the boundary clause RED.
    // The expected values come from the work order, D1, freeze item 37 and the regional prior's form, not from the
    // engine. C2's observable reads the channel alone "when the pair has fewer events than the block's minimum, as
    // the regional prior falls back from region to country"; the regional form takes a level that has AT LEAST
    // minEvents events (src/reflex/regionTrend.ts:207 at abc7413a, `snap.events >= minEvents`), so a pair with exactly
    // the minimum answers itself; item 37 makes the fallback the channel alone over every visit bucket, never
    // everyone; R-P53 b names the "every visit" receipt. The fixture, under the C2 document (K 4, minimum 4): three
    // first-time email visitors each view the Willow (the email pair of the first visit: 3 events, above 0 and below
    // 4), and a returning email visitor's second visit views the Rogue (the email pair of visits 2-3: 1 event), so the
    // channel alone holds both lines (4 events, the roll-up's sum of its visit buckets) and the first-visit pair the
    // Willow only. A first-time email visitor (no signal, so λ = 4 / (4 + 0) = 1) then reads the channel: level
    // 'channel', 4 events, line shares holding the Rogue beside the Willow (the Willow the leader at 1; the Rogue's one
    // event against the Willow's three gives about 1/3: the roll-up sums the raw counts and re-normalises to the leader,
    // src/reflex/regionTrend.ts:123-145 at abc7413a, and the 31 minutes between them decay by about 2% under
    // REGION_TAU_MS of 24 hours, :28), and the receipt's "every visit" sentence, claiming no visit. One more first-time
    // email visitor viewing the Willow brings
    // the pair to exactly 4 events: the next first-time email visitor reads the pair, level 'channel_visit', 4 events,
    // line shares { Willow: 1 }, and the receipt says "email, first visit".
    it(`host (${host}): the minimum, a lock — a channel-and-visit pair with fewer events than the block's minimum gives way to the channel alone with the "every visit" receipt, and a pair with exactly the minimum answers itself`, async () => {
      const learn = learnDocument({}, { regional: REGIONAL_ON, contextPrior: { enabled: true, kBlend: 4, minEvents: 4 } });
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn });
      expectPublished(m, 'P07.C2 — the learn document with a context prior of K 4 and minimum 4 publishes');
      const trend = bindTrend(m);
      const firstTimeWillow = async () => {
        const s = await shopperOn(m);
        expect((await s.action(VIEW_WILLOW, EMAIL_ENTRY)).status, `${host}: PRECONDITION — a first-time email visitor's view is accepted`).toBe(200);
      };
      for (let i = 0; i < 3; i++) await firstTimeWillow();
      const returning = await firstVisit(m, EMAIL_ENTRY);
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31 * 60_000, shouldAdvanceTime: true });
      expect((await returning.action(VIEW_ROGUE, EMAIL_ENTRY)).status, `${host}: PRECONDITION — the returning email visitor's second-visit view is accepted`).toBe(200);
      await publishTrends(m, trend);
      await publishRegionalEverywhere(m);
      // The pair's snapshot exists below the minimum (the reviewer's weakness: the fallback had been exercised only with no
      // pair snapshot at all); read from the key the build publishes, `ctx:<channel>:<visit bucket>` (implementer's report, 6).
      const pairEvents = () => (JSON.parse(m.cache.data.get(trendKey(TENANT, 'ctx:email:1')) ?? 'null') as { events?: number } | null)?.events ?? null;
      expect(pairEvents(), `${host}: PRECONDITION — the email first-visit pair's snapshot is published with 3 events, above 0 and below the minimum of 4`).toBe(3);
      /** A first-time email visitor's page through the route: the Willow recommendations' record and its receipt sentence. */
      const reader = async (label: string) => {
        const visitor = await firstVisit(m, EMAIL_ENTRY);
        const record = (await pageAndLedger(m, visitor, label)).records.find(r => r.item_id === M.reco1);
        expect([record?.cell.channel ?? null, record?.cell.visit_bucket ?? null],
          `${host}: PRECONDITION — the reader is a first-time email visitor whose layout holds the Willow recommendations`).toEqual(['email', '1']);
        const receipt = (await receiptsOf(m, visitor.subject)).find(r => r.slot === LAYOUT && r.item === M.reco1);
        return { context: contextOf(record), line: sharesOf(record)?.line, sentence: sentenceOf(receipt) };
      };

      const below = await reader('p07-c2-below-minimum');
      expect.soft(below.context ?? 'no explain.contextPrior on the record',
        `${host}: P07.C2 — the pair has 3 events, above 0 and below the minimum of 4: the channel alone answers, over every visit bucket (4 events)`)
        .toMatchObject({ channel: 'email', visitBucket: '1', level: 'channel', events: 4, lambda: 1 });
      const line = below.line ?? {};
      expect.soft({ values: Object.keys(line).sort(), leader: line.Willow ?? null, rogueAboutOneThird: Math.abs((line.Rogue ?? 0) - 1 / 3) < 0.05 },
        `${host}: P07.C2 — the channel's own shares: the returning visitor's Rogue beside the first visitors' Willow (the pair alone holds the Willow only): ${JSON.stringify(below.line ?? null)}`)
        .toEqual({ values: ['Rogue', 'Willow'], leader: 1, rogueAboutOneThird: true });
      expect.soft([/population prior, email, every visit/i.test(below.sentence), /first visit|visit 2-3|visit 1\b/i.test(below.sentence)],
        `${host}: P07.C2 — the receipt reads the channel and every visit, claiming no visit (sentence: ${JSON.stringify(below.sentence)})`).toEqual([true, false]);

      await firstTimeWillow();
      await publishTrends(m, trend);
      await publishRegionalEverywhere(m);
      expect(pairEvents(), `${host}: PRECONDITION — the email first-visit pair's snapshot is published with exactly the minimum, 4 events`).toBe(4);
      const at = await reader('p07-c2-at-minimum');
      expect.soft(at.context ?? 'no explain.contextPrior on the record',
        `${host}: P07.C2 — the boundary: the pair with exactly the minimum (4 events) answers itself`)
        .toMatchObject({ channel: 'email', visitBucket: '1', level: 'channel_visit', events: 4, lambda: 1 });
      expect.soft(at.line ?? 'no inputs.context_share on the record',
        `${host}: P07.C2 — the boundary: the pair's own shares, the first-time email visitors having viewed the Willow alone`).toEqual({ Willow: 1 });
      expect.soft(/population prior, email, first visit/i.test(at.sentence),
        `${host}: P07.C2 — the boundary: the receipt names the channel and the visit in words (sentence: ${JSON.stringify(at.sentence)})`).toBe(true);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P07.C3 — the aggregation: per channel and bucket, no identifiers, consent, no new binding
// ===========================================================================

describe('unit:P07.C3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): scored events fan into population shares per tenant, channel and visit bucket that hold no visitor identifier, under the regional trend's consent gate, through the existing population-trend namespace with no new binding`, async () => {
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: learnDocument({}, { contextPrior: { enabled: true, kBlend: 1, minEvents: 1 } }) });
      expectPublished(m, 'P07.C3 — the learn document with the context prior’s block publishes');
      const trend = bindTrend(m);
      const people = await population(m);
      // None of these events carried a geolocation, so the regional trend wrote no object for them (src/reflex/regionTrend.ts:154-155).
      const objectsWithoutGeo = trend.size;
      // A paid-social shopper who refused tracking views the Rogue; an email shopper who allowed tracking only views the Brooklyn, geolocated in New York.
      const refused = await shopperOn(m, { tracking: false, personalization: false });
      await refused.action(VIEW_ROGUE, PAID_SOCIAL_ENTRY);
      const trackingOnly = await shopperOn(m, { tracking: true, personalization: false });
      expect((await actionAt(m, trackingOnly, VIEW_BROOKLYN, NEW_YORK, EMAIL_ENTRY)).status, `${host}: PRECONDITION — her geolocated view is answered`).toBe(200);
      const before = new Map(m.cache.data);
      await publishTrends(m, trend);

      expect.soft(objectsWithoutGeo, `${host}: P07.C3 — the context counts are kept by objects of the existing REGION_TREND namespace, the only population binding bound here`).toBeGreaterThan(0);
      const identifiers = [...people, refused, trackingOnly].flatMap(s => [s.subject, s.grant.sessionId]);
      const published = [...m.cache.data].filter(([key, value]) => before.get(key) !== value).map(([key, value]) => `${key}=${value}`).join('\n');
      const stored = trendStorageText(trend);
      expect(identifiers.filter(id => stored.includes(id) || published.includes(id)), `${host}: P07.C3 — no object of the namespace and no value it published holds a visitor or session identifier`).toEqual([]);

      const readers = { paid: await firstVisit(m, PAID_SOCIAL_ENTRY), direct: await firstVisit(m, DIRECT_ENTRY), email: await firstVisit(m, EMAIL_ENTRY) };
      const shares: Record<string, Record<string, Record<string, number>> | undefined> = {};
      for (const [name, s] of Object.entries(readers)) shares[name] = sharesOf((await pageAndLedger(m, s, `p07-c3-${name}`)).records[0]);
      expect.soft(shares.paid?.line ?? 'no inputs.context_share', `${host}: P07.C3 — paid social, first visit: only what paid-social visitors viewed (Tabby), not the direct visitors' Willow, and nothing from the shopper who refused tracking (Rogue)`).toEqual({ Tabby: 1 });
      expect.soft(shares.direct?.line ?? 'no inputs.context_share', `${host}: P07.C3 — direct, first visit: only what direct visitors viewed (Willow)`).toEqual({ Willow: 1 });
      const regionalNY = (JSON.parse(m.cache.data.get(trendKey(TENANT, 'US-NY')) ?? 'null') as { r?: Record<string, Record<string, number>> } | null)?.r;
      expect((shares.email?.line?.Brooklyn ?? 0) > 0, `${host}: P07.C3 — the tracking-only shopper's view reaches the context shares exactly when it reaches her region's trend (regional: ${JSON.stringify(regionalNY?.line ?? null)})`)
        .toBe((regionalNY?.line?.Brooklyn ?? 0) > 0);
    }, 60_000);

    // LOCK (fix round 1, R-P53 c): green against the build at 2b119290. Its control, measured on a scratch copy: MR
    // (the `continue` at src/reflex/regionTrend.ts:413 removed, so a context pair falls through to the regional leaf
    // test, which takes the '-' of the '2-3' bucket for a region) turns this leg RED on both hosts.
    // The expected values come from freeze item 37 and the regional prior's roll-up, not from the engine: the roll-up
    // sums every published leaf region into its country and into everyone (src/reflex/regionTrend.ts:258, :271, :278,
    // :280 at abc7413a); the context prior "falls back from channel and visit bucket to the channel alone, never to
    // everyone, so the regional prior's shares are not double-counted" (item 37), so no context population is ever a
    // region. The fixture: three geolocated product views from paid social, two on a first visit (New York, California)
    // and one on a returning visitor's second visit (New York), so two leaf regions (New York 2 events, California 1,
    // one event per scored view, src/reflex/regionTrend.ts:106 at abc7413a, summed by the roll-up at :139) and two
    // context scopes (paid social on the first visit, 2 events; on visits 2-3, 1 event; the build names them
    // `ctx:<channel>:<visit bucket>`, the implementer's report section 6). After the
    // operator's roll-up the country and everyone count the leaf regions alone, 2 + 1 = 3 (the 2-3 scope counted there
    // would make everyone 4), and the published regional levels are exactly the two regions, their country and
    // everyone: no `ctx:` scope appears under a region, the country or everyone.
    it(`host (${host}): the rollup, a lock — context scopes in two visit buckets stay out of the regional country and global rollups, which count the leaf regions alone`, async () => {
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: learnDocument({}, { contextPrior: { enabled: true, kBlend: 1, minEvents: 1 } }) });
      expectPublished(m, 'P07.C3 — the learn document with the context prior’s block publishes');
      const trend = bindTrend(m);
      const CALIFORNIA = { country: 'US', regionCode: 'CA' };
      for (const [cf, view] of [[NEW_YORK, VIEW_TABBY_QUILTED], [CALIFORNIA, VIEW_WILLOW]] as const) {
        const visitor = await shopperOn(m);
        expect((await actionAt(m, visitor, view, cf, PAID_SOCIAL_ENTRY)).status, `${host}: PRECONDITION — a geolocated first-visit view is answered`).toBe(200);
      }
      const returning = await shopperOn(m);
      expect((await actionAt(m, returning, PAGE_VIEW, NEW_YORK, PAID_SOCIAL_ENTRY)).status, `${host}: PRECONDITION — the returning visitor's first visit is answered`).toBe(200);
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31 * 60_000, shouldAdvanceTime: true });
      expect((await actionAt(m, returning, VIEW_ROGUE, NEW_YORK, PAID_SOCIAL_ENTRY)).status, `${host}: PRECONDITION — the second-visit view is answered`).toBe(200);
      await publishTrends(m, trend);

      const prefix = trendKey(TENANT, '');
      const published = [...m.cache.data].filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ scope: key.slice(prefix.length), ...(JSON.parse(value) as { level?: string; events?: number }) }));
      const eventsOf = (scope: string) => published.find(p => p.scope === scope)?.events ?? null;
      expect({ 'US-NY': eventsOf('US-NY'), 'US-CA': eventsOf('US-CA'), 'ctx:paid_social:1': eventsOf('ctx:paid_social:1'), 'ctx:paid_social:2-3': eventsOf('ctx:paid_social:2-3') },
        `${host}: PRECONDITION — the fan-in fed two leaf regions and two context scopes, one event per scored view`)
        .toEqual({ 'US-NY': 2, 'US-CA': 1, 'ctx:paid_social:1': 2, 'ctx:paid_social:2-3': 1 });
      expect.soft({ country: eventsOf('US'), everyone: eventsOf('*') },
        `${host}: P07.C3 — the country and everyone count the leaf regions alone (New York 2 + California 1 = 3), never a context scope`)
        .toEqual({ country: 3, everyone: 3 });
      expect.soft(published.filter(p => ['region', 'country', 'global'].includes(p.level ?? '')).map(p => `${p.level}:${p.scope}`).sort(),
        `${host}: P07.C3 — the regional levels hold exactly the two regions, their country and everyone: no ctx: scope under a region, the country or everyone`)
        .toEqual(['country:US', 'global:*', 'region:US-CA', 'region:US-NY']);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P07.C4 — off when absent; never on the default arm or without consent
// ===========================================================================

describe('unit:P07.C4', () => {
  const terms = (decisions: Array<Record<string, unknown>>) => decisions.filter(d => d.slot === LAYOUT)
    .map(({ decisionId: _d, renderOffer: _r, ...rest }) => { void _d; void _r; return rest; });
  for (const host of HOSTS) {
    it(`host (${host}): a learn document without the block decides exactly as before, the same population notwithstanding`, async () => {
      const decide = async (populated: boolean, learn: unknown) => {
        const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn });
        expectPublished(m, 'P07.C4 — the learn document publishes');
        const trend = bindTrend(m);
        if (populated) { await population(m); await publishTrends(m, trend); }
        const s = await firstVisit(m, PAID_SOCIAL_ENTRY);
        const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p07-c4') });
        return { served: servedIn(page, LAYOUT), terms: terms(page.decisions as unknown as Array<Record<string, unknown>>) };
      };
      const before = await decide(false, learnDocument()), without = await decide(true, learnDocument());
      expect.soft(without.served, `${host}: P07.C4 — without the block the first decision is the one before the prior existed`).toEqual(COLD);
      expect.soft(without.terms, `${host}: P07.C4 — term for term`).toEqual(before.terms);
      const withBlock = await decide(true, learnDocument({}, { contextPrior: CONTEXT_PRIOR }));
      expect(withBlock.served[0], `${host}: CONTROL — the same population with the block published does shape her first decision`).toBe(M.reco2);
    }, 60_000);

    // LOCK (fix round 1, R-P53 a): green against the build at 2b119290. Its control, measured on a scratch copy: ME
    // (src/content/service.ts:598, the block read without its `enabled`) turns this leg RED on both hosts.
    // The expected values come from the work order, D1 and the regional prior's form, not from the engine:
    // remaining-work item 2 gives the block "its enablement"; D1 gives the context prior the regional prior's form,
    // whose block applies only when `enabled` is true (src/content/service.ts:564-567 at abc7413a); so a block published
    // with `enabled: false` is the block absent, and C4's "a learn document without the block decides exactly as
    // before" holds for it term for term. With the regional prior on (published on the Brooklyn line, which no module
    // carries) the layout is the one with no prior, the first four eligible modules in catalogue order (COLD); the
    // answer's terms on every slot are those of the block absent; no record carries explain.contextPrior or
    // inputs.context_share; the stored layout records' term for term (the regional snapshot's publication time
    // aside) and their page manifest exactly today's eight markers, the key set src/units/P02/LEDGER.unit.test.ts:361
    // and src/content/consent.test.ts:629 (W27.02) pin; and the regional prior shapes the story slot as today
    // (story.brooklyn, λ 1 for a first-time visitor, unit:P07.C1's control). The CONTROL publishes the same block
    // with `enabled: true` over the same population: the prior applies and the paid-social module leads.
    it(`host (${host}): the enablement, a lock — a block published with enabled false decides term for term as the block absent, the same population notwithstanding`, async () => {
      const MANIFEST = ['candidateLimit', 'contentTypes', 'exploration', 'governance', 'learning', 'pins', 'slots', 'version'];
      const recordTerms = (r: DecisionRecord) => {
        const explain = JSON.parse(JSON.stringify(r.explain ?? {})) as Record<string, unknown>;
        if (explain.regional) explain.regional = { ...(explain.regional as Record<string, unknown>), version: 'the time the snapshot was published' };
        return { item: r.item_id, position: r.position, arm: r.arm, authority: r.authority, cell: r.cell, explain, inputs: Object.keys(r.inputs ?? {}).sort() };
      };
      const decide = async (label: string, learn: unknown) => {
        const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn });
        expectPublished(m, `P07.C4 — the learn document (${label}) publishes`);
        const trend = bindTrend(m);
        await population(m);
        await publishTrends(m, trend);
        await publishRegionalEverywhere(m);
        const visitor = await firstVisit(m, PAID_SOCIAL_ENTRY);
        const { served, records, page } = await pageAndLedger(m, visitor, `p07-c4-${label}`);
        expect(records.length, `${host}: PRECONDITION — the ledger holds the four layout decisions (${label})`).toBe(4);
        const set = await servePage(m, visitor, 'pdp');
        const story = set.records.find(r => r.slot === STORY);
        return {
          served,
          terms: page.decisions.map(({ decisionId: _d, renderOffer: _r, ...rest }) => { void _d; void _r; return rest; }),
          records: [...records].sort((a, b) => a.position - b.position).map(recordTerms),
          members: [...records, ...set.records].filter(r => contextOf(r) || sharesOf(r)).map(r => `${r.slot}:${r.item_id}`),
          manifests: records.map(r => Object.keys(r.inputs?.replay ?? {}).sort()),
          regional: [story?.item_id ?? null, story?.explain.regional?.lambda ?? null],
          prior: contextOf(records.find(r => r.item_id === M.reco2))?.level ?? null,
        };
      };
      const absent = await decide('absent', learnDocument({}, { regional: REGIONAL_ON }));
      const disabled = await decide('disabled', learnDocument({}, { regional: REGIONAL_ON, contextPrior: { ...CONTEXT_PRIOR, enabled: false } }));
      expect.soft(disabled.served, `${host}: P07.C4 — enabled false: the layout of the block absent, the first four eligible modules in catalogue order`).toEqual(COLD);
      expect.soft(disabled.terms, `${host}: P07.C4 — enabled false: term for term the answer of the block absent, on every slot`).toEqual(absent.terms);
      expect.soft(disabled.records, `${host}: P07.C4 — enabled false: the stored layout records term for term those of the block absent`).toEqual(absent.records);
      expect.soft({ absent: absent.members, disabled: disabled.members },
        `${host}: P07.C4 — enabled false, as absent: no record carries explain.contextPrior or inputs.context_share`).toEqual({ absent: [], disabled: [] });
      expect.soft({ absent: absent.manifests, disabled: disabled.manifests },
        `${host}: P07.C4 — enabled false, as absent: the page manifest carries exactly today's eight markers`).toEqual({ absent: [MANIFEST, MANIFEST, MANIFEST, MANIFEST], disabled: [MANIFEST, MANIFEST, MANIFEST, MANIFEST] });
      expect.soft({ absent: absent.regional, disabled: disabled.regional },
        `${host}: P07.C4 — enabled false, as absent: the regional prior shapes the story slot as today`).toEqual({ absent: ['story.brooklyn', 1], disabled: ['story.brooklyn', 1] });
      const enabled = await decide('enabled', learnDocument({}, { regional: REGIONAL_ON, contextPrior: CONTEXT_PRIOR }));
      expect([enabled.served[0], enabled.prior], `${host}: CONTROL — the same block with enabled true over the same population applies the prior, and the paid-social module leads`)
        .toEqual([M.reco2, 'channel_visit']);
    }, 120_000);

    it(`host (${host}): with the block published, a shopper on the holdout's default arm and a shopper without personalization consent get no context prior`, async () => {
      const holdout = learnDocument({}, { holdout: { share: 1, salt: 'p07-holdout', arms: ['default'] }, contextPrior: CONTEXT_PRIOR });
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: holdout });
      expectPublished(m, 'P07.C4 — the learn document with the block and a full holdout publishes');
      const trend = bindTrend(m);
      await population(m);
      await publishTrends(m, trend);
      const control = await firstVisit(m, PAID_SOCIAL_ENTRY);
      const noConsent = await shopperOn(m, { tracking: true, personalization: false });
      expect((await noConsent.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status).toBe(200);
      const priorOn = async (s: Shopper) => (await servePage(m, s, 'pdp')).records.filter(r => r.slot === LAYOUT && contextOf(r)).map(r => r.item_id);
      const defaultArm = await servePage(m, control, 'pdp');
      expect(defaultArm.arm, `${host}: PRECONDITION — she is on the holdout's default arm`).toBe('default');
      expect.soft(defaultArm.records.filter(r => r.slot === LAYOUT && contextOf(r)).map(r => r.item_id), `${host}: P07.C4 — never on the holdout's default arm`).toEqual([]);
      expect.soft(await priorOn(noConsent), `${host}: P07.C4 — never without personalization consent`).toEqual([]);
      expect((await putDocument(m, 'learn', learnDocument({}, { contextPrior: CONTEXT_PRIOR }))).status, `${host}: the holdout is lifted`).toBe(200);
      expect(await priorOn(control), `${host}: CONTROL — off the holdout, with consent, the same shopper's decision carries the context prior`).toContain(M.reco2);
      expect.soft(await priorOn(noConsent), `${host}: P07.C4 — still never without personalization consent`).toEqual([]);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P07.C5 — the record carries the shares; replay is exact; retained as before
// ===========================================================================

describe('unit:P07.C5', () => {
  const replayed = async (m: Mounted, host: Host, s: Shopper) => {
    const set = await servePage(m, s, 'pdp', { offer: false });
    await toLedger(m, set.records);
    const stored = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT);
    expect(stored.length, `${host}: PRECONDITION — the ledger holds her layout decisions`).toBe(4);
    const out = [];
    for (const r of stored) {
      const replay = await replayOf(m, r.decision_id);
      out.push({ r, status: replay.status, classification: replay.body.classification ?? replay.body.reason ?? null,
        replayedContext: ((replay.body.replayed as DecisionRecord | null)?.explain as Record<string, unknown> | undefined)?.contextPrior ?? null });
    }
    return out;
  };
  for (const host of HOSTS) {
    it(`host (${host}): every record of a decision under the context prior carries the shares it used and replays equal, and a record decided without the block replays equal as before`, async () => {
      // Served-v1 here and without the durable recovery path: the replay reads what the real producer and consumer wrote.
      const learn = learnDocument({ [LAYOUT]: { reward: 'click' } }, { contextPrior: CONTEXT_PRIOR });
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn }, { recovery: false });
      expectPublished(m, 'P07.C5 — the learn document with the context prior’s block publishes');
      const trend = bindTrend(m);
      await population(m);
      await publishTrends(m, trend);
      const results = await replayed(m, host, await firstVisit(m, PAID_SOCIAL_ENTRY));
      expect.soft(results.map(x => [x.r.item_id, sharesOf(x.r)?.line ?? null]), `${host}: P07.C5 — every record carries the context shares the decision used`)
        .toEqual(results.map(x => [x.r.item_id, { Tabby: 1 }]));
      expect.soft(results.map(x => [x.r.item_id, x.status, x.classification]), `${host}: P07.C5 — each replays equal`).toEqual(results.map(x => [x.r.item_id, 200, 'equal']));
      const reco2 = results.find(x => x.r.item_id === M.reco2);
      expect.soft(reco2?.replayedContext ?? 'the replay reproduced no explain.contextPrior', `${host}: P07.C5 — the replay reproduces the context prior's itemisation exactly`)
        .toEqual(contextOf(reco2?.r) ?? 'the served record carries none');

      const retained = await mount(host, { pieces: PIECES, slots: SLOTS, learn: learnDocument({ [LAYOUT]: { reward: 'click' } }) }, { recovery: false });
      expectPublished(retained, 'P07.C5 — a learn document without the block publishes');
      const before = await replayed(retained, host, await firstVisit(retained, PAID_SOCIAL_ENTRY));
      expect(before.map(x => [x.r.item_id, x.status, x.classification]), `${host}: P07.C5 — a record without context shares replays equal as before`)
        .toEqual(before.map(x => [x.r.item_id, 200, 'equal']));
    }, 60_000);
  }
});

// ===========================================================================
// unit:P07.C6 — the kit documents the block, the fallback and the receipt line
// ===========================================================================

describe('unit:P07.C6', () => {
  it('logic: the API reference and the payload schemas each document the context prior’s block, its fallback and the receipt line', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'the block contextPrior with enabled, kBlend and minEvents', test: s => /contextPrior/.test(s) && /\benabled\b/.test(s) && /kBlend/.test(s) && /minEvents/.test(s) },
      { name: 'its fallback: the channel and visit bucket, else the channel alone below minEvents, never everyone',
        test: s => /channel/i.test(s) && /visit bucket/i.test(s) && /\b(alone|only)\b/i.test(s) && /minEvents|minimum/i.test(s) },
      { name: 'the receipt line: population prior, with the channel and the visit in words', test: s => /population prior/i.test(s) && /paid social/i.test(s) && /first visit/i.test(s) },
    ]);
    expect(missing, 'P07.C6 — the kit documents the block, its fallback and the receipt line').toEqual([]);
  });
});
