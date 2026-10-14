// src/units/P11/LEDGER.unit.test.ts
// P11 under the Closure Ledger: the tests for the LOCAL criteria of the P11 work
// order (`tapestry-parity-build`, ticket P11 "Evidence floors per page type").
// DC1 (D1) and DC2 (D2) are ruled below and exercised in U1-U3; LV1 and LV2 are
// deferred live rows and get no test.
//
// One `describe('unit:P11.<criterion>')` per LOCAL criterion. Expected values
// come from the witnesses, never from what the engine answers today:
//   · the work order's authority (docs/BTI-Parity-Build-Tickets.md, P11 in
//     section B): "floors are configurable per page type. Below the floor, a
//     piece's own performance is shrunk toward the baseline rather than
//     ignored, and exposures-to-floor are reported against the configured floor";
//   · freeze sheet item 25 (D1: a page type is the slots document's page key;
//     D2: below its floor the estimate is shrunk by the exposures it lacks,
//     floor − n, never skipped) and item 40 (the shrinkage applies to the
//     estimate the ladder answers with; a piece with no level reaching nMin
//     still gets no lift, so W25 is unchanged);
//   · the parity document, section 5 row B7 and section 7 (cited by number
//     only): the per-page-type floors (product page 300), below the floor the
//     estimate pulled toward the baseline, not ignored;
//   · the existing contract the work order cites: src/learn/stats.ts:20 (nMin
//     30), :483-496 (the finest level reaching nMin answers; a lift is p̂ / p₀,
//     clamped), src/learn/explore.ts:35, src/learn/rows.ts:198-221.
//
// THE READINGS THIS FILE RULES:
//   FLOORS (D1). The learn document carries `evidenceFloors: { [pageKey]: F }`,
//     F a whole number of 1 or more; publication refuses anything else naming
//     `evidenceFloors.<page>`. A page without a floor decides exactly as today.
//   SHRINKAGE (D2, item 40). Let the answering level (today's rule, untouched)
//     carry n exposures and the estimate p̂, and let p₀ be the slot's rate in
//     that cell, the lift's own reference (the baseline). When the decision's
//     page has a floor F and n < F, the estimate becomes
//         p_F = (n·p̂ + (F − n)·p₀) / F
//     — the n exposures it has at its own estimate and the F − n it lacks at the
//     baseline rate — and the lift p_F / p₀ (clamped as today) is applied, never
//     skipped. n ≥ F: applied as today. No level reaching nMin: no lift, as today.
//     The fixture's n₀ is 0.001, so p̂ = s/n to five decimals and the reading
//     above and "F − n pseudo-exposures at p₀ added to the estimate's evidence"
//     agree to the precision asserted.
//   MEMBERS. The record's `explain.lift.evidenceFloor = { page, floor, n,
//     lacking }` (lacking = F − n) and the receipt's `evidenceFloor` with the
//     same members; built with its keys sorted (R-P3), absent where no floor
//     applied. The exploring route answers `evidenceFloor: { page, floor }` and
//     each row `to_evidence_floor` (F − n, never below 0); the lift route
//     answers `evidenceFloor: { page, floor }` and `toEvidenceFloor: { item:
//     F − n }` for every item of the snapshot at level everyone; the console's
//     exploring screen shows the page's floor and each row's distance to it.
//
// NO NEW EXPORT IS IMPORTED. The ruled members are read loosely.
//
// HARNESS: src/units/_parity.ts (both shopper hosts; acknowledgements through
// the durable rendered admission into the real ledger) and src/units/_parity3.ts
// (exposures and credits written into the real statistics objects through
// their own doors, then published). Replay clauses use the decision set the
// snapshot route composes, through the real producer and consumer (`toLedger`,
// src/units/P10's idiom), because acknowledged records with drivers or a lift
// replay as `explanation` today for the key-order defect R-P3, which no P11
// assertion is about.
//
// RETAINED (U5, R-P38). The harness publishes a learn document through its
// write validator; U5's document is instead published RETAINED, as a revision
// stored before P11: the publication authority's own baseline path with
// `retainedValue` (initializePublicationSet, src/config/publication.ts), which
// stores the bytes as given and reads them through the learn kind's retained
// reader, validateRetainedLearn (`LEARN_KIND.validateStored`,
// src/content/kinds.ts:520, :671), exactly as the harness does for a retained
// slots document (`retainedSlots`). `mountRetainedLearn` below holds that path.
//
// R10 (tests that lock present behaviour, listed for the lead):
//   · src/content/consent.test.ts:629 and src/learn/phase3.test.ts:438 pin the
//     page manifest's exact markers; the floor rides the retained learn
//     revision the manifest already names, so no marker is ruled.
//   · src/learn/receipts.test.ts:41-51 asserts a receipt's exact `why` array;
//     the floor is a MEMBER of the receipt, no new sentence is required.
//   · src/learn/rows.test.ts (exploringRows) asserts rows of exactly
//     { item, customer_item_id, title, n, to_floor }; `to_evidence_floor` is
//     added only where the page has a floor, so a floorless call keeps them.

import { describe, expect, it } from 'vitest';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { Cell, DecisionRecord } from '@/content/types';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';

import {
  asOperator, expectPublished, HOSTS, mount, openConsole, PAID_SOCIAL_ENTRY, pageInstanceOf, putDocument, receiptsOf, REFLEX_DOCUMENT, replayOf, servePage,
  shopperOn, storedDecisions, TENANT, toLedger, VIEW_TABBY_26, type Host, type Mounted, type Shopper,
} from '../_parity';
import { feedStats, missingStatements, publishStats, type SlotStatsConfig } from '../_parity3';

const PDP_STORY = 'pdp-story', HOME_STORY = 'home-story';
const X = 'story.tabby.quilted', Y = 'story.tabby.charm', Z = 'story.tabby.new';
const piece = (id: string, title: string) => ({ id, customerContentId: `TAP-${id.replace(/\./g, '-').toUpperCase()}`, type: 'editorial', title,
  tags: { line: ['Tabby'] }, slotTypes: [PDP_STORY, HOME_STORY], lifecycle: { status: 'live' } });
const PIECES = [piece(X, 'The quilted Tabby'), piece(Y, 'The Tabby charm'), piece(Z, 'The new Tabby')];
const SLOTS = { version: 'parity-p11-slots', governanceVersion: 3, pages: {
  pdp: [{ slot: PDP_STORY, take: 3, weights: { line: 1 } }], home: [{ slot: HOME_STORY, take: 3, weights: { line: 1 } }] } };
const STATS = { n0: 0.001, tauLearnMs: 1_814_400_000, liftMin: 0.5, liftMax: 2, nMin: 30 };
const learn = (extra: Record<string, unknown> = {}, basis: 'served-v1' | 'rendered-v1' = 'rendered-v1') => ({ version: 'parity-p11-learn', holdout: { share: 0, salt: 'parity', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 }, stats: STATS, ...extra,
  slots: { [PDP_STORY]: { measurementBasis: basis, reward: 'click', gamma: 1 }, [HOME_STORY]: { measurementBasis: basis, reward: 'click', gamma: 1 } } });
const configOf = (basis: 'served-v1' | 'rendered-v1'): SlotStatsConfig => ({ reward: 'click', stats: STATS, objective: 'unit', measurementBasis: basis });
/** A cell that shares only level 0 (everyone) with the shopper below, so level 0 answers with exactly the fed counts. */
const ELSEWHERE: Cell = { channel: 'email', visit_bucket: '4+', region: null, affinity: null, stage: 'late' };

/** The evidence: per piece, exposures n and click credits s, the same on both pages' slots. */
const EVIDENCE = { [X]: { n: 60, s: 30 }, [Y]: { n: 60, s: 6 }, [Z]: { n: 10, s: 5 } } as const;
const P0 = (30 + 6 + 5) / (60 + 60 + 10);
const clamp = (lift: number) => Math.min(STATS.liftMax, Math.max(STATS.liftMin, lift));
const asToday = (item: keyof typeof EVIDENCE) => clamp(EVIDENCE[item].s / EVIDENCE[item].n / P0);
const underFloor = (item: keyof typeof EVIDENCE, floor: number) => {
  const { n, s } = EVIDENCE[item];
  return clamp(((n * (s / n)) + (floor - n) * P0) / floor / P0);
};

/**
 * The mounted app with the learn document published RETAINED (see RETAINED above). The harness's
 * mount stores nothing when a document it publishes is unreadable — its baseline set is validated whole
 * before any write — so it is handed no learn document, and the one baseline set is then published here
 * with the learn revision marked `retainedValue`, the other members exactly as the harness publishes them.
 */
async function mountRetainedLearn(host: Host, document: unknown, options: { recovery?: boolean }): Promise<Mounted> {
  const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: null }, options);
  expect(m.refused ?? '', `PRECONDITION (${host}): the harness stored nothing before the retained publication`).toMatch(/invalid_baseline/);
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope: string = TENANT, retained = false): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'parity-fixture', note: 'fixture', value }, ...(retained ? { retainedValue: true as const } : {}) });
  let refused: string | null = null;
  try {
    await initializePublicationSet(m.env, [
      baseline(CONTENT_KIND, { version: 'parity-coach-catalogue', pieces: PIECES }),
      baseline(SLOTS_KIND, SLOTS),
      baseline(LEARN_KIND, document, TENANT, true),
      baseline(PRIORS_KIND, EMPTY_PRIORS),
      baseline(REFLEX_KIND, REFLEX_DOCUMENT, reflexScopeForTenant(TENANT)),
    ], '0:' + crypto.randomUUID());
  } catch (error) { refused = `${(error as Error).message} (${(error as { code?: string }).code ?? ''})`; }
  invalidatePublicationCache();
  return { ...m, refused };
}

async function world(host: Host, extra: Record<string, unknown>, basis: 'served-v1' | 'rendered-v1' = 'rendered-v1', retainedLearn = false): Promise<{ m: Mounted; s: Shopper }> {
  // The served-v1 world runs without the durable recovery path: the replay reads what the real producer and consumer wrote (src/units/P10).
  const options = basis === 'served-v1' ? { recovery: false } : {};
  const m = retainedLearn ? await mountRetainedLearn(host, learn(extra, basis), options) : await mount(host, { pieces: PIECES, slots: SLOTS, learn: learn(extra, basis) }, options);
  expectPublished(m, `P11 — the catalogue, the two pages and the ${retainedLearn ? 'retained ' : ''}learn document publish`);
  for (const slot of [PDP_STORY, HOME_STORY]) for (const [item, { n, s }] of Object.entries(EVIDENCE)) {
    await feedStats(m, { slot, item, cell: ELSEWHERE, exposures: n, credits: s, config: configOf(basis) });
  }
  await publishStats(m);
  const s = await shopperOn(m);
  expect((await s.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY)).status, `${host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  return { m, s };
}

/** The records the ledger holds for one page the shopper was served and acknowledged in full: the production path. */
async function acknowledgedPage(m: Mounted, s: Shopper, page: 'pdp' | 'home'): Promise<DecisionRecord[]> {
  const served = await s.snapshot(page, { pageInstance: pageInstanceOf(`p11-${page}`) });
  expect(served.decisions.map(d => d.contentId).sort(), `${m.host}: PRECONDITION — the ${page} slot serves its three pieces`).toEqual([X, Y, Z].sort());
  for (const d of served.decisions) expect((await s.ack(served, d)).status, `${m.host}: PRECONDITION — ${d.contentId} is acknowledged`).toBe(200);
  await m.drainLedger();
  return storedDecisions(m, s.subject).filter(r => r.page === page);
}
const liftOn = (records: DecisionRecord[], item: string) => records.find(r => r.item_id === item)?.explain.lift as (Record<string, unknown> & { lift?: number }) | null | undefined;

// ===========================================================================
// unit:P11.U1 — floors published per page key, refused when not a whole number ≥ 1
// ===========================================================================

const BAD_FLOORS: Array<{ name: string; value: unknown }> = [
  { name: 'zero', value: 0 }, { name: 'a fraction', value: 2.5 }, { name: 'a negative number', value: -300 }, { name: 'a string', value: '300' }, { name: 'null', value: null },
];

describe('unit:P11.U1', () => {
  it('logic: decision D1 — the learn validator keeps floors per page key and refuses a floor that is not a whole number of 1 or more by name', () => {
    const kept = LEARN_KIND.validate(learn({ evidenceFloors: { home: 500, pdp: 300 } }));
    expect(kept.ok, `P11.U1 — floors per page key are admitted: ${JSON.stringify(kept).slice(0, 200)}`).toBe(true);
    expect((kept as { value?: Record<string, unknown> }).value?.evidenceFloors, 'P11.U1 — and kept on the document').toEqual({ home: 500, pdp: 300 });
    for (const bad of BAD_FLOORS) {
      const refused = LEARN_KIND.validate(learn({ evidenceFloors: { pdp: bad.value } }));
      expect.soft(refused.ok ? 'admitted' : (refused as { errors: string[] }).errors.some(e => e.includes('evidenceFloors.pdp')) ? 'refused by name' : (refused as { errors: string[] }).errors.join('; '),
        `P11.U1 — a floor of ${bad.name} is refused naming evidenceFloors.pdp`).toBe('refused by name');
    }
  });

  for (const host of HOSTS) {
    it(`host (${host}): the learn route publishes floors per page key and refuses a malformed floor by name, and a page without a floor decides exactly as today`, async () => {
      const { m, s } = await world(host, { evidenceFloors: { pdp: 300 } });
      for (const bad of BAD_FLOORS) {
        const refused = await putDocument(m, 'learn', learn({ evidenceFloors: { pdp: 300, home: bad.value } }), 'p11');
        expect.soft([refused.status, ((refused.body.errors ?? []) as unknown[]).some(e => String(e).includes('evidenceFloors.home'))],
          `${host}: P11.U1 — publishing a home floor of ${bad.name} is refused (422) naming evidenceFloors.home: ${JSON.stringify(refused.body).slice(0, 200)}`).toEqual([422, true]);
      }
      const read = await asOperator(m, 'GET', `/content/learn?scope=${TENANT}`);
      expect.soft((read.body.document as Record<string, unknown> | undefined)?.evidenceFloors, `${host}: P11.U1 — the published document carries its floors`).toEqual({ pdp: 300 });
      // LOCKED: home has no floor, so home decides exactly as today.
      const home = await acknowledgedPage(m, s, 'home');
      for (const item of [X, Y] as const) expect(liftOn(home, item)?.lift, `${host}: P11.U1 — ${item} on the floorless home page: lift as today`).toBeCloseTo(asToday(item), 3);
    });
  }
});

// ===========================================================================
// unit:P11.U2 — below its page's floor the estimate is shrunk by F − n and applied
// ===========================================================================

describe('unit:P11.U2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D2 — on the product page (floor 300) an estimate on 60 exposures is shrunk toward the baseline by 240 exposures at the baseline rate and applied; on a page whose floor (50) it meets it is applied as today; with no level reaching nMin there is no lift`, async () => {
      const { m, s } = await world(host, { evidenceFloors: { pdp: 300, home: 50 } });
      const pdp = await acknowledgedPage(m, s, 'pdp');
      for (const item of [X, Y] as const) {
        expect(liftOn(pdp, item)?.lift, `${host}: P11.U2 — ${item} (n 60 of 300): (60·p̂ + 240·p₀)/300 over p₀ is applied, never skipped`).toBeCloseTo(underFloor(item, 300), 3);
      }
      // LOCKED (item 40, src/learn/stats.ts:491): no level reaches nMin for the new piece, so no lift.
      expect(liftOn(pdp, Z) ?? null, `${host}: P11.U2 — ${Z} (n 10, below nMin 30) still gets no lift`).toBeNull();
      const home = await acknowledgedPage(m, s, 'home');
      for (const item of [X, Y] as const) expect(liftOn(home, item)?.lift, `${host}: P11.U2 — ${item} meets the home floor of 50: lift as today`).toBeCloseTo(asToday(item), 3);
      // What the shopper sees moves with it: the served score is the base times the applied lift (gamma 1).
      for (const r of pdp.filter(x => x.item_id !== Z)) {
        expect(r.explain.score_final, `${host}: P11.U2 — ${r.item_id}'s final score is its base times the floored lift`).toBeCloseTo(r.explain.score_base * underFloor(r.item_id as keyof typeof EVIDENCE, 300), 2);
      }
    });
  }
});

// ===========================================================================
// unit:P11.U3 — the record and the receipt name the floor; a floored decision replays exactly
// ===========================================================================

describe('unit:P11.U3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the record and the receipt of a decision under a floor name the floor, n and F − n, and the decision replays exactly`, async () => {
      const { m, s } = await world(host, { evidenceFloors: { pdp: 300 } });
      const pdp = await acknowledgedPage(m, s, 'pdp');
      for (const item of [X, Y] as const) {
        const floor = liftOn(pdp, item)?.evidenceFloor as { page?: string; floor?: number; n?: number; lacking?: number } | undefined;
        expect.soft(floor ?? `the record's explain.lift carries no evidenceFloor (${JSON.stringify(liftOn(pdp, item)).slice(0, 200)})`,
          `${host}: P11.U3 — ${item}'s record names its page's floor`).toMatchObject({ page: 'pdp', floor: 300 });
        expect.soft(floor?.n, `${host}: P11.U3 — and the n the estimate rests on`).toBeCloseTo(60, 2);
        expect.soft(floor?.lacking, `${host}: P11.U3 — and the F − n it lacks`).toBeCloseTo(240, 2);
      }
      const receipts = await receiptsOf(m, s.subject);
      for (const item of [X, Y] as const) {
        const record = pdp.find(r => r.item_id === item)!;
        const receipt = receipts.find(r => r.decision_id === record.decision_id);
        expect.soft(receipt, `${host}: PRECONDITION — the receipt of ${item} is listed`).toBeTruthy();
        const floor = receipt?.evidenceFloor as { floor?: number; n?: number; lacking?: number } | undefined;
        expect.soft([floor?.floor ?? null, Math.round(floor?.n ?? -1), Math.round(floor?.lacking ?? -1)], `${host}: P11.U3 — ${item}'s receipt names the floor, n and F − n`).toEqual([300, 60, 240]);
      }
      // Replay: the decision set the snapshot route composes, through the real producer and consumer.
      // served-v1 (the basis whose composed records the trusted path captures at serve time), as src/units/P10 does.
      const sv = await world(host, { evidenceFloors: { pdp: 300 } }, 'served-v1');
      const set = await servePage(sv.m, sv.s, 'pdp', { offer: false }) as unknown as { records: DecisionRecord[] };
      await toLedger(sv.m, set.records);
      for (const record of set.records.filter(r => r.item_id !== Z)) {
        expect.soft(record.explain.lift?.lift, `${host}: P11.U3 — the composed ${record.item_id} decision carries the floored lift`).toBeCloseTo(underFloor(record.item_id as keyof typeof EVIDENCE, 300), 3);
        const replay = await replayOf(sv.m, record.decision_id);
        expect.soft([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P11.U3 — the floored ${record.item_id} decision replays equal (${JSON.stringify(replay.body.reason ?? replay.body.diff ?? '').slice(0, 200)})`).toEqual([200, 'equal']);
      }
    });
  }
});

// ===========================================================================
// unit:P11.U4 — exposures-to-floor reported against the configured floor
// ===========================================================================

describe('unit:P11.U4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the operator's exploring and lift routes, and the console's exploring screen, report each piece's exposures-to-floor against its page's configured floor`, async () => {
      const { m } = await world(host, { evidenceFloors: { pdp: 300 } });
      const exploring = await asOperator(m, 'GET', `/v1/${TENANT}/learn/exploring?slot=${PDP_STORY}`);
      expect(exploring.status, `PRECONDITION: the exploring route answers (${JSON.stringify(exploring.body).slice(0, 200)})`).toBe(200);
      expect.soft(exploring.body.evidenceFloor, `${host}: P11.U4 — the exploring answer names the page's configured floor`).toEqual({ page: 'pdp', floor: 300 });
      const rows = (exploring.body.rows ?? []) as Array<{ item: string; n: number; to_floor: number; to_evidence_floor?: number }>;
      expect(rows.map(r => r.item), `${host}: PRECONDITION — the piece under the observation floor is listed, as today`).toEqual([Z]);
      expect.soft(rows[0]?.to_evidence_floor, `${host}: P11.U4 — its exposures-to-floor are counted against the configured floor (300 − 10)`).toBeCloseTo(290, 1);
      const lift = await asOperator(m, 'GET', `/v1/${TENANT}/lift?slot=${PDP_STORY}`);
      expect(lift.status, `PRECONDITION: the lift route answers (${JSON.stringify(lift.body).slice(0, 200)})`).toBe(200);
      expect.soft(lift.body.evidenceFloor, `${host}: P11.U4 — the lift answer names the page's configured floor`).toEqual({ page: 'pdp', floor: 300 });
      const toFloor = (lift.body.toEvidenceFloor ?? {}) as Record<string, number>;
      for (const [item, want] of [[X, 240], [Y, 240], [Z, 290]] as const) expect.soft(toFloor[item], `${host}: P11.U4 — the lift answer reports ${item}'s exposures-to-floor`).toBeCloseTo(want, 1);

      const c = await openConsole(m, `#/exploring?scope=${TENANT}&slot=${PDP_STORY}`);
      try {
        const text = c.text();
        expect.soft(/\b300\b/.test(text), `${host}: P11.U4 — the console's exploring screen shows the page's configured floor of 300 (text: ${text.slice(0, 400)})`).toBe(true);
        expect.soft(/\b290(\.0)?\b/.test(text), `${host}: P11.U4 — and the piece's 290 exposures to that floor`).toBe(true);
      } finally { c.close(); }
    });
  }
});

// ===========================================================================
// unit:P11.U5 — a retained learn document without floors decides and replays as before; the kit
// ===========================================================================

describe('unit:P11.U5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCKED — a RETAINED learn document without floors, stored as given and read through the retained reader (validateRetainedLearn), decides every page as today and every decision replays equal`, async () => {
      const { m, s } = await world(host, {}, 'rendered-v1', true);
      // The replays: the served-v1 copy of the same retained world, whose composed records the trusted path captures at serve time.
      const sv = await world(host, {}, 'served-v1', true);
      for (const page of ['pdp', 'home'] as const) {
        const records = await acknowledgedPage(m, s, page);
        for (const item of [X, Y] as const) expect(liftOn(records, item)?.lift, `${host}: P11.U5 — ${item} on ${page}: lift as today`).toBeCloseTo(asToday(item), 3);
        expect(liftOn(records, Z) ?? null, `${host}: P11.U5 — no lift below nMin, as today`).toBeNull();
        const set = await servePage(sv.m, sv.s, page, { offer: false }) as unknown as { records: DecisionRecord[] };
        await toLedger(sv.m, set.records);
        for (const record of set.records) {
          const replay = await replayOf(sv.m, record.decision_id);
          expect([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P11.U5 — ${record.item_id} on ${page} replays equal (${JSON.stringify(replay.body.reason ?? replay.body.diff ?? '').slice(0, 200)})`).toEqual([200, 'equal']);
        }
      }
    });
  }

  it('logic: the API reference and the payload schemas document the floors per page key, the shrinkage, the members that name it and the report against the floor', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'floors are published per page key in the learn document (evidenceFloors)', test: t => /evidenceFloors/.test(t) && /page/i.test(t) },
      { name: 'a floor is a whole number of 1 or more', test: t => /evidenceFloors|evidence floor/i.test(t) && /whole number|integer/i.test(t) },
      { name: 'below its floor an estimate is shrunk toward the baseline by the exposures it lacks, never skipped', test: t => /floor/i.test(t) && /shr[iu]nk|pulled toward/i.test(t) && /baseline/i.test(t) },
      { name: 'the record and the receipt name the floor, n and F − n (evidenceFloor)', test: t => /evidenceFloor\b/.test(t) && /lacking|F ?[−-] ?n|floor minus/i.test(t) },
      { name: 'exposures-to-floor are reported against the configured floor', test: t => /to_evidence_floor|toEvidenceFloor|exposures.to.floor/i.test(t) && /configured|evidence floor/i.test(t) },
    ]);
    expect(missing, 'P11.U5 — the kit documents the floors').toEqual([]);
  });
});
