// src/units/P10/LEDGER.unit.test.ts
// P10 under the Closure Ledger: the tests for the LOCAL criteria of the frozen
// P10 work order (`tapestry-parity-build`, ticket P10 "Signal floor"). DC1 and
// DC2 (decisions D1, D2) are ruled and exercised inside F1 and F2; LV1 and LV2
// are deferred live rows and get no test.
//
// One `describe('unit:P10.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P10 in section B,
//     amended 2026-10-07): "a per-tenant N, overridable per slot, with 'never'
//     allowed on a layout slot. Below N signals the shopper gets the default or
//     context-configured decision, and the first personalized response lands on
//     action N + 1. Existing tenants default to 0, so W16.C8.04 still holds";
//   · freeze sheet item 24 (D1 "A signal is an action with a behaviour weight
//     above zero"; D2 "below the floor only context terms apply (seeds, P01
//     orders, priors, ladder levels 0 to 2)") and item 36 ("The response to the
//     (N + 1)th signal is the first personalized one; a floor of 0 is off; below
//     the floor pins, exclusions, eligibility, freshness and merchandising still
//     apply and visitor-hashed exploration does not; signals are counted on the
//     shopper's persisted state");
//   · the investigation, sections G-B ("Is the layout per shopper or per
//     context?": the terms that read the individual shopper and the terms that
//     read only context) and G-C (option c, the context-only layout);
//   · the existing contract the work order cites: `src/units/W16/C8.unit.test.ts:784`
//     (unit:W16.C8.04), `src/reflex/core.ts:221-244` (the behaviour weights),
//     `src/learn/stats.ts:36-50` (levels 0-2 are context),
//     `src/content/decide.ts:241-243, 314-341`.
//
// THE READINGS THIS FILE RULES, ONE PER CRITERION (one representation for all):
//   The tenant floor is `signalFloor` on the slots document (a whole number,
//   absent = 0); a slot's own `signalFloor` (a whole number, or 'never' on the
//   page's declared layout slot only) overrides it. A shopper is below the floor
//   of a slot while her count of signals is at most the floor; her count is
//   every action whose behaviour weight is above zero.
//   F1  With a tenant floor of 3, the snapshot after each of her first three
//       signals is context-only (here: the catalogue order, though she has
//       interest), a weight-0 action (a page view) leaves the count where it
//       is, and the snapshot after the fourth signal is personalized.
//   F2  Below the floor a decision's records show the configured order, the pin,
//       the exclusion and eligibility, the seed's contribution, the regional
//       prior at λ = 1, freshness, merchandising and a learned lift from level 2
//       at most — and no driver from her own interests, no stage block, no
//       fatigue block and no exploration. The same shopper at floor 0 (the
//       control) shows every one of the terms the floor withholds.
//   F3  A slot's floor of 0 under a tenant floor of 3 personalizes that slot
//       after one signal while the rest of the page stays context-only; 'never'
//       on the declared layout slot keeps it context-only after four signals
//       while the content slot personalizes. `validateSlotCatalog` refuses
//       'never' on any other slot or as the tenant floor, and any floor that is
//       not a whole number of 0 or more, naming `signalFloor`.
//   F4  An explicit floor of 0 on the tenant and the slot decides, step for
//       step, exactly what a tenant with no floor decides (every term of every
//       decision of the content slot), by the third view the page reflects the
//       line she viewed (W16.C8.04), and a floor-0 decision replays equal under
//       exactly today's page markers.
//   F5  Every record of a context-only decision carries `explain.signalFloor:
//       { floor, signals }`; her receipt says she is below the signal floor,
//       with both numbers; the decision replays equal.
//   F6  docs/kit/02 and 03 each document `signalFloor`, 'never' on the layout
//       slot, and the counting rule (a signal is an action whose behaviour
//       weight is above zero).
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `signalFloor` on the slots document and on a slot, `explain.signalFloor` on
// the record. No new export is imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts); the
// learned ladder is built by the real fan-in and published by the real
// statistics objects, and the regional prior is the published trend snapshot
// the decision path reads.

import { describe, expect, it } from 'vitest';

import { validateSlotCatalog } from '@/content/kinds';
import type { DecisionRecord } from '@/content/types';
import { fanDecisions } from '@/learn/fan';
import { DEFAULT_STATS } from '@/learn/stats';
import { ts36 } from '@/ledger/records';
import { REGION_GENERATION, trendKey } from '@/reflex/regionTrend';
import { captureRetention } from '@/retention';

import {
  declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, putSlots, readTree, receiptsOf, replayOf, servedIn, servePage, shopperOn, storedDecisions, TABBY_VIEWS, TENANT, BRAND, toLedger,
  type Mounted, type Shopper,
} from '../_parity';

const STORY = 'pdp-story';
const story = (id: string, tags: Record<string, string[]>, over: Record<string, unknown> = {}) => ({ id, customerContentId: `TAP-${id.toUpperCase()}`,
  type: 'editorial', title: id, tags, slotTypes: [STORY], lifecycle: { status: 'live' }, ...over });
const DAY = 86_400_000;
/** The content slot's pieces, in catalogue order: the one her taste must overtake is listed first. */
const STORY_PIECES = [
  story('story.rogue', { line: ['Rogue'] }, { journeyStageFit: ['exploring'], freshnessDate: new Date(Date.now() - 2 * DAY).toISOString() }),
  story('story.willow', { line: ['Willow'] }, { merchandising: { season: 1 }, freshnessDate: new Date(Date.now() - DAY).toISOString() }),
  story('story.tabby', { line: ['Tabby'], occasion: ['evening'] }, { journeyStageFit: ['considering'] }),
  story('story.excluded', { line: ['Tabby'] }),
  story('story.expired', { line: ['Tabby'] }, { lifecycle: { status: 'expired' } }),
];
const PIECES = [...MODULES, ...STORY_PIECES];
const storySlot = (over: Record<string, unknown> = {}) => ({ slot: STORY, take: 2, weights: { line: 1 }, ...over });
/** With no signal the story slot serves its catalogue order. */
const STORY_CONTEXT_ONLY = ['story.rogue', 'story.willow'];
/** Her taste after Tabby views: the Tabby story first. */
const STORY_PERSONALIZED_FIRST = 'story.tabby';
const COLD_LAYOUT = [M.grid, M.reco1, M.reco2, M.editorial];
/** After four Tabby views (P02.A2's arithmetic, one more view): reco.2, editorial.1, grid.1, then reco.1 by catalogue order. */
const PERSONALIZED_LAYOUT = [M.reco2, M.editorial, M.grid, M.reco1];

async function paidSocial(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: her page view is accepted`).toBe(200);
  return s;
}
const page = async (s: Shopper) => {
  const snap = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p10') });
  expect(snap.status, JSON.stringify(snap.body).slice(0, 300)).toBe(200);
  return { story: servedIn(snap, STORY), layout: servedIn(snap, LAYOUT), snap };
};

// ===========================================================================
// unit:P10.F1 — the (N + 1)th signal brings the first personalized decision
// ===========================================================================

describe('unit:P10.F1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with a tenant floor of 3 the decision after each of her first three signals is context-only, a page view is not a signal, and the decision after the fourth signal is personalized`, async () => {
      const m = await mount(host, { pieces: PIECES, slots: declaredSlots([layoutSlot(), storySlot()], { signalFloor: 3 }), learn: learnDocument() });
      expectPublished(m, 'P10.F1 — the slots document with a tenant signal floor of 3 publishes');
      const s = await paidSocial(m);
      const steps: Array<{ after: string; story: string[]; layout: string[] }> = [];
      for (const [i, view] of TABBY_VIEWS.slice(0, 3).entries()) {
        expect((await s.action(view)).status).toBe(200);
        if (i === 0) {
          const taste = (await s.hydrate()).body as { affinity?: { dims?: Record<string, Record<string, number>> } };
          expect(taste.affinity?.dims?.line?.Tabby ?? 0, `${host}: CONTROL — her first view built Tabby interest`).toBeGreaterThan(0);
        }
        if (i === 1) expect((await s.action(PAGE_VIEW)).status, `${host}: a page view, weighted 0, between the second and third signals`).toBe(200);
        const { story: served, layout } = await page(s);
        steps.push({ after: `signal ${i + 1}`, story: served, layout });
      }
      expect.soft(steps, `${host}: P10.F1 — the decision after each of her first three signals is context-only (the page view counted for nothing)`)
        .toEqual(['signal 1', 'signal 2', 'signal 3'].map(after => ({ after, story: STORY_CONTEXT_ONLY, layout: COLD_LAYOUT })));
      expect((await s.action(TABBY_VIEWS[3]!)).status).toBe(200);
      const fourth = await page(s);
      expect(fourth.story[0], `${host}: P10.F1 — the decision after the fourth signal is the first personalized one`).toBe(STORY_PERSONALIZED_FIRST);
      expect(fourth.layout, `${host}: P10.F1 — on the layout slot too`).toEqual(PERSONALIZED_LAYOUT);
    });
  }
});

// ===========================================================================
// unit:P10.F2 — what a context-only decision applies, and what it does not
// ===========================================================================

const PAID_SOCIAL_FIRST = { channel: 'paid_social', visitBuckets: ['1'] };
const F2_ORDER = [M.grid, M.ugc, M.reco1];
const f2Slots = (signalFloor: number) => declaredSlots([
  layoutSlot({ pinnedPieceIds: [M.grid], orders: [{ context: PAID_SOCIAL_FIRST, modules: F2_ORDER }] }),
  storySlot({ weights: { line: 1, occasion: 0.5 }, excludedPieceIds: ['story.excluded'],
    seeds: [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'line', value: 'Willow' }], weight: 0.6 }],
    stage: { inStage: 0.4, outOfStage: 0.5 }, freshness: { weight: 0.2, halfLifeDays: 30 }, fatigue: { weight: 0.5, windowHours: 24, cap: 2 },
    merchandising: { season: 0.5 } }),
], { signalFloor });
/** Both slots on served-v1 here, so the capturing caller writes the ring her fatigue is read from. */
const F2_LEARN = learnDocument({ [LAYOUT]: { reward: 'click' }, [STORY]: { reward: 'click', gamma: 0.5, exploration: { mode: 'rotation', share: 1, floor: 50 } } },
  { regional: { enabled: true, kBlend: 1, minEvents: 1 } });
/** The cell the published ladder was learned in: paid social, first visit, considering. Levels 0-5 all reach nMin. */
const LEARNED_CELL = { channel: 'paid_social', visit_bucket: '1' as const, region: null, affinity: null, stage: 'mid' as const };

/** The learned ladder for the story slot: 40 served exposures of the Willow and Tabby stories in her cell, published by the real objects. */
async function learnedLadder(m: Mounted): Promise<void> {
  const at = Date.now() - 10 * 60_000;
  for (let k = 0; k < 40; k++) {
    const visitor = `v-p10-ladder-${k}`;
    const records = ['story.willow', 'story.tabby'].map((item, position) => ({
      decision_id: `${TENANT}:${ts36(at + k)}:${visitor}:pdp:${STORY}:${position}`, tenant: TENANT, brand: BRAND, visitor_id: visitor, session_id: `s-${visitor}`,
      identity_anchor: 'visitor', ts: at + k, page: 'pdp', slot: STORY, position, item_id: item, customer_item_id: `TAP-${item.toUpperCase()}`, candidates: [],
      cell: LEARNED_CELL, arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 },
      config_label: 'p10-ladder', explain: { drivers: [], score_base: 0.5, score_final: 0.5, lift: null }, measurementBasis: 'served-v1',
      retention: captureRetention(m.env as never, TENANT, at + k, Date.now()),
    } as unknown as DecisionRecord));
    const receipt = await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: visitor, records },
      () => ({ reward: 'click', objective: 'unit', stats: DEFAULT_STATS, measurementBasis: 'served-v1' }));
    expect(receipt.ok, `PRECONDITION: the ladder's exposures reach the fan-in (${JSON.stringify(receipt).slice(0, 200)})`).toBe(true);
  }
  for (const name of [...m.stats.keys()]) {
    const published = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/publish', { method: 'POST' });
    expect(await published.json(), `PRECONDITION: ${name} publishes its snapshot`).toMatchObject({ ok: true, published: true });
  }
}
/** What shoppers everywhere engage with: the Willow line, and evening. Never Tabby, so a Tabby driver can only be her own interest. */
async function publishTrend(m: Mounted): Promise<void> {
  const now = Date.now();
  await m.cache.put(trendKey(TENANT, '*'), JSON.stringify({ generation: REGION_GENERATION, tenant: TENANT, region: '*', level: 'global', events: 500,
    updatedAt: now, version: now, r: { line: { Willow: 10 }, occasion: { evening: 5 } }, share: { line: { Willow: 1 }, occasion: { evening: 0.5 } } }));
}

describe('unit:P10.F2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): below the floor the decision applies the seed rules, the configured order, the regional prior at full weight, the ladder at levels 0 to 2 and the slot's pins, exclusions, eligibility, freshness and merchandising, and none of her interests, her journey stage, fatigue, levels 3 to 5 or visitor-hashed exploration`, async () => {
      // Without the durable recovery path, so the capturing caller writes her ring directly (`fanDecisions`).
      const m = await mount(host, { pieces: PIECES, slots: f2Slots(10), learn: F2_LEARN }, { recovery: false });
      expectPublished(m, 'P10.F2 — the slots document with a tenant signal floor of 10, the per-context order and the story slot’s rules publishes');
      await learnedLadder(m);
      await publishTrend(m);
      const s = await paidSocial(m);
      for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status).toBe(200);
      // A page she was served (and the ring remembers), so fatigue has something to read.
      await servePage(m, s, 'pdp', { offer: false });
      const below = (await servePage(m, s, 'pdp')).records;
      const storyBelow = below.filter(r => r.slot === STORY), layoutBelow = below.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);

      // What applies below the floor.
      expect.soft(layoutBelow.map(r => r.item_id), `${host}: P10.F2 — the configured order for her context, exactly`).toEqual(F2_ORDER);
      expect.soft(layoutBelow[0]?.authority, `${host}: P10.F2 — the slot's pin holds its position`).toBe('pin');
      expect(storyBelow.filter(r => ['story.excluded', 'story.expired'].includes(r.item_id)).map(r => r.item_id),
        `${host}: P10.F2 — exclusions and eligibility still apply`).toEqual([]);
      const willow = storyBelow.find(r => r.item_id === 'story.willow');
      expect.soft(storyBelow.map(r => r.item_id)[0], `${host}: P10.F2 — the story her arrival's seed rule, the population's trend, freshness and merchandising favour is served first`).toBe('story.willow');
      expect.soft(willow?.explain.contextual?.applied ?? 0, `${host}: P10.F2 — the seed rule for her arrival contributed`).toBeGreaterThan(0);
      expect.soft(willow?.explain.freshness?.applied ?? 0, `${host}: P10.F2 — freshness applied`).toBeGreaterThan(0);
      expect.soft(willow?.explain.merchandising?.drivers?.length ?? 0, `${host}: P10.F2 — merchandising applied`).toBeGreaterThan(0);
      expect.soft(storyBelow.map(r => r.explain.regional?.lambda ?? null).filter(l => l !== null),
        `${host}: P10.F2 — the regional prior at full weight (λ = 1), her own evidence not weighing it down`).toEqual(storyBelow.filter(r => r.explain.regional).map(() => 1));
      // The ladder's own rule over levels 0 to 2: the finest of them that reaches nMin, which is level 2 (channel and visit bucket) here.
      expect.soft(willow?.explain.lift?.level ?? null, `${host}: P10.F2 — the learned ladder applies, answering from level 2 (channel and visit bucket)`).toBe(2);
      expect.soft(storyBelow.filter(r => r.explain.lift).map(r => `${r.item_id}: level ${r.explain.lift!.level}`),
        `${host}: P10.F2 — and no record's learned lift came from level 3, 4 or 5`).toEqual(storyBelow.filter(r => r.explain.lift).map(r => `${r.item_id}: level 2`));
      // What does not. Her own interest is Tabby; the population's is not, so Tabby in the scored vector can only be hers.
      expect.soft(storyBelow.map(r => r.inputs?.affinity?.line?.Tabby ?? 0), `${host}: P10.F2 — the interest vector the decision scored carries none of her own interests`)
        .toEqual(storyBelow.map(() => 0));
      expect.soft(storyBelow.flatMap(r => r.explain.drivers.filter(d => d.dim === 'line' && d.value === 'Tabby').map(() => r.item_id)),
        `${host}: P10.F2 — no driver reads her own interests`).toEqual([]);
      expect.soft(storyBelow.filter(r => r.explain.stage).map(r => r.item_id), `${host}: P10.F2 — no journey-stage rule`).toEqual([]);
      expect.soft(storyBelow.filter(r => r.explain.fatigue).map(r => r.item_id), `${host}: P10.F2 — no fatigue`).toEqual([]);
      expect.soft(below.filter(r => r.explored).map(r => `${r.slot}:${r.item_id}`), `${host}: P10.F2 — no visitor-hashed exploration`).toEqual([]);

      // CONTROL: the same shopper at floor 0 shows every term the floor withholds, so the fixture can tell them apart.
      expect((await putSlots(m, f2Slots(0))).status, `${host}: the floor of 0 publishes`).toBe(200);
      const above = (await servePage(m, s, 'pdp')).records.filter(r => r.slot === STORY);
      expect(above.some(r => (r.inputs?.affinity?.line?.Tabby ?? 0) > 0), `${host}: CONTROL — at floor 0 her Tabby interest is in the vector the decision scored`).toBe(true);
      expect(above.some(r => r.explain.stage), `${host}: CONTROL — at floor 0 the stage rule applies`).toBe(true);
      expect(above.some(r => r.explain.fatigue), `${host}: CONTROL — at floor 0 fatigue applies`).toBe(true);
      expect(above.some(r => r.explored), `${host}: CONTROL — at floor 0 the slot explores`).toBe(true);
      expect(above.some(r => (r.explain.lift?.level ?? 0) >= 3), `${host}: CONTROL — at floor 0 a finer ladder level answers`).toBe(true);
      expect(above.some(r => (r.explain.regional?.lambda ?? 1) < 1), `${host}: CONTROL — at floor 0 her evidence weighs the regional prior down`).toBe(true);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P10.F3 — the slot's own floor; never on the layout slot; refusals
// ===========================================================================

describe('unit:P10.F3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a slot's own floor overrides the tenant's, and never on the declared layout slot keeps it context-only for every shopper while the content slot personalizes`, async () => {
      const own = await mount(host, { pieces: PIECES, slots: declaredSlots([layoutSlot(), storySlot({ signalFloor: 0 })], { signalFloor: 3 }), learn: learnDocument() });
      expectPublished(own, 'P10.F3 — a tenant floor of 3 with the story slot’s own floor of 0 publishes');
      const s = await paidSocial(own);
      expect((await s.action(TABBY_VIEWS[0]!)).status).toBe(200);
      const first = await page(s);
      expect.soft([first.story[0], first.layout], `${host}: P10.F3 — after one signal the slot with its own floor of 0 personalizes and the layout, under the tenant's 3, stays context-only`)
        .toEqual([STORY_PERSONALIZED_FIRST, COLD_LAYOUT]);

      const never = await mount(host, { pieces: PIECES, slots: declaredSlots([layoutSlot({ signalFloor: 'never' }), storySlot()]), learn: learnDocument() });
      expectPublished(never, 'P10.F3 — never on the declared layout slot publishes');
      const t = await paidSocial(never);
      for (const view of TABBY_VIEWS) expect((await t.action(view)).status).toBe(200);
      const after = await page(t);
      expect(after.story[0], `${host}: CONTROL — the content slot personalizes`).toBe(STORY_PERSONALIZED_FIRST);
      expect(after.layout, `${host}: P10.F3 — never keeps the declared layout slot context-only after four signals`).toEqual(COLD_LAYOUT);
    });
  }

  it('logic: publication refuses never on any slot but the declared layout slot and as the tenant floor, and any floor that is not a whole number of 0 or more, with an error naming the floor', () => {
    const errors = (candidate: unknown): string[] => { const checked = validateSlotCatalog(candidate); return checked.ok ? [] : checked.errors; };
    const admitted = validateSlotCatalog(declaredSlots([layoutSlot({ signalFloor: 'never' }), storySlot({ signalFloor: 0 })], { signalFloor: 3 }));
    expect.soft(admitted.ok ? 'admitted' : (admitted as { errors: string[] }).errors.join('; '), 'P10.F3 — a tenant floor, a slot floor and never on the layout slot are admitted').toBe('admitted');
    expect.soft((admitted as { value?: Record<string, unknown> }).value?.signalFloor, 'P10.F3 — and the tenant floor is kept').toBe(3);
    const refusals: Array<[string, unknown, string]> = [
      ['never on a content slot', declaredSlots([layoutSlot(), storySlot({ signalFloor: 'never' })]), 'pages.pdp[1].signalFloor'],
      ['a fractional slot floor', declaredSlots([layoutSlot(), storySlot({ signalFloor: 1.5 })]), 'pages.pdp[1].signalFloor'],
      ['a negative slot floor', declaredSlots([layoutSlot({ signalFloor: -1 }), storySlot()]), 'pages.pdp[0].signalFloor'],
      ['a floor written as text', declaredSlots([layoutSlot(), storySlot({ signalFloor: '3' })]), 'pages.pdp[1].signalFloor'],
      ['never as the tenant floor', declaredSlots([layoutSlot(), storySlot()], { signalFloor: 'never' }), 'signalFloor'],
      ['a fractional tenant floor', declaredSlots([layoutSlot(), storySlot()], { signalFloor: 2.5 }), 'signalFloor'],
    ];
    expect(refusals.map(([name, candidate, address]) => [name, errors(candidate).some(e => e.startsWith(address))]),
      `P10.F3 — each is refused with an error naming the floor (${JSON.stringify(refusals.map(([name, candidate]) => [name, errors(candidate)]))})`)
      .toEqual(refusals.map(([name]) => [name, true]));
  });
});

// ===========================================================================
// unit:P10.F4 — a floor of 0 decides exactly as today
// ===========================================================================

describe('unit:P10.F4', () => {
  /** The content page both worlds publish: the story slot and the modules slot, neither declared a layout, so the page carries no new marker. */
  const today = { version: 'parity-today-slots', governanceVersion: 3, pages: { pdp: [{ ...layoutSlot(), layout: undefined }, storySlot()].map(s => JSON.parse(JSON.stringify(s))) } };
  const zero = { version: 'parity-zero-slots', governanceVersion: 4, signalFloor: 0,
    pages: { pdp: [{ ...layoutSlot(), layout: undefined }, storySlot({ signalFloor: 0 })].map(s => JSON.parse(JSON.stringify(s))) } };
  const terms = (decisions: Array<Record<string, unknown>>) => decisions.filter(d => d.slot === STORY)
    .map(({ decisionId: _d, renderOffer: _r, ...rest }) => { void _d; void _r; return rest; });

  for (const host of HOSTS) {
    it(`host (${host}): an explicit floor of 0 decides step for step exactly what a tenant without a floor decides, the page reflects her views by the third interaction, and a floor-0 decision replays equal under today's page markers`, async () => {
      // Both slots on served-v1, so the capturing caller writes the ledger the replay reads.
      const learn = learnDocument({ [LAYOUT]: { reward: 'click' } });
      // Without the durable recovery path: the replay reads what the real producer and consumer wrote.
      const worlds = { today: await mount(host, { pieces: PIECES, slots: today, retainedSlots: true, learn }, { recovery: false }),
        zero: await mount(host, { pieces: PIECES, slots: zero, learn }, { recovery: false }) };
      expectPublished(worlds.today, 'P10.F4 — a retained governance-3 document without a floor reads');
      expectPublished(worlds.zero, 'P10.F4 — the slots document with an explicit floor of 0 publishes');
      const shoppers = { today: await paidSocial(worlds.today), zero: await paidSocial(worlds.zero) };
      const steps: Array<{ step: number; today: unknown; zero: unknown }> = [];
      for (const [i, view] of TABBY_VIEWS.slice(0, 3).entries()) {
        const out: Record<string, unknown> = {};
        for (const key of ['today', 'zero'] as const) {
          expect((await shoppers[key].action(view)).status).toBe(200);
          out[key] = terms((await page(shoppers[key])).snap.decisions as unknown as Array<Record<string, unknown>>);
        }
        steps.push({ step: i + 1, today: out.today, zero: out.zero });
      }
      expect(steps.map(st => st.zero), `${host}: P10.F4 — every term of every decision at floor 0 is what the tenant without a floor is served`).toEqual(steps.map(st => st.today));
      expect((steps[2]!.zero as Array<{ contentId: string }>)[0]?.contentId, `${host}: P10.F4 — W16.C8.04: by the third interaction the page reflects the line she viewed`)
        .toBe(STORY_PERSONALIZED_FIRST);

      const m = worlds.zero;
      const set = await servePage(m, shoppers.zero, 'pdp', { offer: false });
      await toLedger(m, set.records);
      for (const record of storedDecisions(m, shoppers.zero.subject).filter(r => r.slot === STORY)) {
        // LOCKED (src/content/decide.ts:514-519; src/content/consent.test.ts:629 pins today's manifest): no new marker at floor 0.
        expect(Object.keys(record.inputs?.replay ?? {}).sort(), `${host}: P10.F4 — a floor-0 decision's page manifest carries exactly today's markers`)
          .toEqual(['candidateLimit', 'contentTypes', 'exploration', 'governance', 'learning', 'pins', 'slots', 'version']);
        const replay = await replayOf(m, record.decision_id);
        expect([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P10.F4 — ${record.item_id} replays equal`).toEqual([200, 'equal']);
      }
    }, 60_000);
  }
});

// ===========================================================================
// unit:P10.F5 — the record and the receipt say she is below the floor
// ===========================================================================

describe('unit:P10.F5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the record and the receipt of a context-only decision say the shopper is below the signal floor, with her count of signals and the floor in force, and the decision replays equal`, async () => {
      const m = await mount(host, { pieces: PIECES, slots: declaredSlots([layoutSlot(), storySlot()], { signalFloor: 3 }), learn: learnDocument() });
      expectPublished(m, 'P10.F5 — the slots document with a tenant signal floor of 3 publishes');
      const s = await paidSocial(m);
      for (const view of TABBY_VIEWS.slice(0, 2)) expect((await s.action(view)).status).toBe(200);
      const { snap } = await page(s);
      for (const d of snap.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(snap, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT);
      expect(records.length, `${host}: PRECONDITION — the ledger holds her four layout decisions`).toBe(4);
      for (const r of records) {
        expect.soft((r.explain as Record<string, unknown>).signalFloor, `${host}: P10.F5 — the record of ${r.item_id} says she is below the floor: two signals, floor 3`).toEqual({ floor: 3, signals: 2 });
        const replay = await replayOf(m, r.decision_id);
        expect.soft([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P10.F5 — ${r.item_id} replays equal`).toEqual([200, 'equal']);
      }
      const receipts = (await receiptsOf(m, s.subject)).filter(r => r.slot === LAYOUT);
      expect(receipts.length, `${host}: PRECONDITION — a receipt for every layout position`).toBe(4);
      for (const r of receipts) {
        const sentence = (r.why as string[]).find(w => /below the signal floor/i.test(w)) ?? '';
        expect.soft([/(^|[^0-9])2([^0-9]|$)/.test(sentence), /(^|[^0-9])3([^0-9]|$)/.test(sentence)],
          `${host}: P10.F5 — her receipt for ${String(r.item)} says she is below the signal floor, with her two signals and the floor of 3 (why: ${JSON.stringify(r.why)})`).toEqual([true, true]);
      }
    });
  }
});

// ===========================================================================
// unit:P10.F6 — the kit documents the floor, never and the counting rule
// ===========================================================================

describe('unit:P10.F6', () => {
  it('logic: the API reference and the payload schemas document the signal floor, never on the layout slot, and the counting rule', () => {
    const missing: string[] = [];
    for (const file of ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']) {
      const sentences = readTree(file).replace(/`/g, '').split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(x => x.replace(/\s+/g, ' '));
      if (!sentences.some(x => /signalFloor/.test(x))) missing.push(`${file}: signalFloor`);
      if (!sentences.some(x => /signalFloor|signal floor/i.test(x) && /\bnever\b/.test(x) && /layout/i.test(x))) missing.push(`${file}: never on the layout slot`);
      if (!sentences.some(x => /signal/i.test(x) && /weight/i.test(x) && /(above|greater than|more than) (zero|0)/i.test(x))) missing.push(`${file}: the counting rule (a signal is an action whose behaviour weight is above zero)`);
    }
    expect(missing, 'P10.F6 — the kit documents the floor, never and the counting rule').toEqual([]);
  });
});
