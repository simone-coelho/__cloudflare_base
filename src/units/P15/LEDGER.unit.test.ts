// src/units/P15/LEDGER.unit.test.ts
// P15 under the Closure Ledger: the tests for the LOCAL criteria of the P15 work
// order (`tapestry-parity-build`, ticket P15 "Position bands inside one slot").
// DC1 (D1) is ruled below and exercised in M1-M3; LV1 is a deferred live row and
// gets no test.
//
// One `describe('unit:P15.<criterion>')` per LOCAL criterion. Expected values
// come from the witnesses, never from what the engine answers today:
//   · the work order's authority (docs/BTI-Parity-Build-Tickets.md, P15 in
//     section B): "positions 1–2 of a slot can run one strategy and positions
//     3–5 another, with one de-duplicated result";
//   · the parity document, section 5 row B3 (cited by number only): position
//     rules inside a slot, either two slots or position bands on one;
//   · freeze sheet item 29 (D1: a band overrides only dimension weights, over
//     contiguous ranges covering 1 to take);
//   · the investigation, section G-C, the table's row (d) (position bands are
//     P15; today two slots);
//   · the existing contract the work order cites: src/content/kinds.ts:255-376
//     (one set of dimension weights per slot), src/reflex/contentCompose.ts:252-339
//     (each slot ranked once, the tag sum Σ a·w over the slot's weights, ties to
//     catalogue order, served to its take).
//
// THE READINGS THIS FILE RULES:
//   BANDS (D1). A slot strategy may carry `bands: [{ from, to, weights }]`,
//     positions counted from 1 within the slot. The bands are contiguous, do not
//     overlap and together cover 1..take; a band carries nothing but `from`, `to`
//     and `weights` (dimension → weight, as the slot's own `weights`).
//     Publication refuses anything else with an error naming
//     `pages.<page>[i].bands`.
//   RANKING. Positions are filled in order. A position the pinned prefix holds is
//     the pin's, as today. Every other position k is filled by ranking the
//     candidates still eligible — after the slot's exclusions, eligibility, the
//     page's reservations and every module already served on the page — with the
//     weights of the band that covers k in place of the slot's `weights`; every
//     other term is computed exactly as today. One de-duplicated result.
//     A diversity yield at position k is filled by the next still-eligible
//     candidate under the weights of the band covering k; the yielding module
//     stays eligible for the later positions and is ranked there under their
//     bands' weights; exploration is applied to the banded result as before
//     (R-P34); a slot without bands keeps today's diversity (R-P76).
//     A draw that moves nothing (an exploration pick that lands on the banded
//     ranking's leader) leaves every position filled as with no draw, the
//     leader recorded explored; only a pick that moved a module is served
//     first and the rest in today's take loop over the banded ranking, the
//     diversity rule acting on that order as on a slot without bands (R-P77).
//   EVERY READ OF THE WEIGHTS (M2). The band's weights replace the slot's
//     `weights` wherever the composition reads them for a position of the band:
//     the tag sum Σ a·w, and the slot weight a seed rule's contribution is
//     scaled by (today `rule.weight × weights[tag.dimension]`,
//     src/content/decide.ts seedDriversFor), so a seed whose dimension a band
//     does not weight contributes nothing in that band. Unchanged in every band:
//     the seed rule's own `weight`, freshness, merchandising and the learned
//     term lift^γ, each in today's order (src/content/decide.ts preLift and
//     adjust). Under R-P34 bands act on the behaviour term only, a pinned
//     position stays the pin's (M2's first leg) and exploration is applied to
//     the banded ranking (not exercised here: no exploring item in M2's
//     fixture). Stage and fatigue are not exercised: the visitor's stage word
//     under the tenant's journey grammar is not fixed by a witness in this
//     fixture, and fatigue needs the ring's served counts of an earlier page.
//   MEMBERS. The record of a banded position carries `explain.band = { from, to }`
//     and its receipt `band = { from, to }`; built with sorted keys (R-P3).
//     The record and the receipt of a position carry only the terms of the
//     scoring that ranked it: a term that did not apply to the score is not
//     explained (R-P76).
//
// NO NEW EXPORT IS IMPORTED. `bands` and the members are read loosely. The slots
// are content slots without the P02 declaration (governance 3), so no unit waits
// on P02; the modules are the shared catalogue pieces of src/units/_parity.ts.
//
// HARNESS: src/units/_parity.ts (both shopper hosts; acknowledgements into the
// real ledger). Replays of decisions with drivers use a served-v1 copy whose
// composed records reach the ledger through the real producer and consumer
// (`toLedger`), as src/units/P10 does, because acknowledged records with drivers
// replay as `explanation` today for the key-order defect R-P3.
//
// R10 (tests that lock present behaviour, listed for the lead):
//   · src/content/consent.test.ts:629 and src/learn/phase3.test.ts:438 pin the
//     page manifest's markers for documents without bands; M3's lock keeps them.
//   · src/learn/receipts.test.ts:41-51 pins a receipt's exact `why` array; the
//     band is a member, no new sentence is required.

import { describe, expect, it } from 'vitest';

import { validateSlotCatalog } from '@/content/kinds';
import type { Cell, DecisionRecord } from '@/content/types';
import { bucketOf, hourKeyOf } from '@/learn/explore';

import {
  expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount, PAID_SOCIAL_ENTRY, PAGE_VIEW, pageInstanceOf,
  putDocument, receiptsOf, recentSlot, RECENT_SLOT, replayOf, servedIn, servePage, shopperOn, storedDecisions, TABBY_VIEWS, toLedger,
  type Host, type Mounted,
} from '../_parity';
import { feedStats, missingStatements, publishStats } from '../_parity3';

/** Positions 1–2 lean on category, positions 3–5 on line. */
const BANDS = [{ from: 1, to: 2, weights: { category: 1, occasion: 0.25 } }, { from: 3, to: 5, weights: { line: 1 } }];
/** The page's modules slot without the P02 declaration, K = 5, and the recently-viewed slot below it. */
const modulesSlot = (over: Record<string, unknown> = {}) => JSON.parse(JSON.stringify({ ...layoutSlot(), layout: undefined, take: 5, ...over }));
const slotsDoc = (pdp: unknown[]) => ({ version: 'parity-p15-slots', governanceVersion: 3, pages: { pdp } });
const BANDED = slotsDoc([modulesSlot({ bands: BANDS }), recentSlot()]);
const learnOf = (basis: 'served-v1' | 'rendered-v1') => learnDocument({ [LAYOUT]: { measurementBasis: basis, reward: 'click' } });

/**
 * After three Tabby views every value the catalogue names reads a = 3/(3+K) = 0.625 (K = 1.8): line Tabby,
 * category Handbags, occasion evening. Eligible for the slot: grid.1, reco.1, reco.2, editorial.1, ugc.1
 * (reviews.1 excluded, lookbook.1 expired, recent.1 reserved below, charms.1 closed).
 *   band 1 (category 1, occasion 0.25): grid.1 0.625, reco.2 0.156, the rest 0  → positions 1–2: grid.1, reco.2
 *   band 2 (line 1) over what is left:  editorial.1 0.625, reco.1 0, ugc.1 0 (catalogue order) → positions 3–5
 * Without bands (line 1, category 0.5, occasion 0.5): reco.2, editorial.1, grid.1, reco.1, ugc.1.
 */
const BANDED_ORDER = [M.grid, M.reco2, M.editorial, M.reco1, M.ugc];
const UNBANDED_ORDER = [M.reco2, M.editorial, M.grid, M.reco1, M.ugc];
const BAND_OF = [{ from: 1, to: 2 }, { from: 1, to: 2 }, { from: 3, to: 5 }, { from: 3, to: 5 }, { from: 3, to: 5 }];

// ---------------------------------------------------------------------------
// M2's second leg: the slot's other terms on the banded slot of M1 (BANDS), each
// term in today's arithmetic (src/content/decide.ts) with the band's weights read
// where the slot's weights are read.
//   · a seed rule: arrivals from paid social are evidence for line Willow, rule
//     weight 0.5 (decide.ts seedDriversFor: rule.weight × the slot weight for the
//     tag's dimension);
//   · freshness { weight 0.4, halfLifeDays 30 } and ugc.1 fresh a minute ago: +0.4
//     (weight × 2^(−age/halfLife), age a minute);
//   · merchandising { promotion 0.5 } and editorial.1 on promotion (1): × 1.5 on a
//     positive base (src/reflex/merchandising.ts applyMerchandising);
//   · the learned term at gamma 1: × lift, the lift p̂/p₀ clamped to 0.5..2 (the
//     reading src/units/P11's floorless lock measures), from 100 exposures of
//     each module and of reviews.1 in a cell that shares only everyone with the
//     shopper: credits 12, 36, 25, 20, 25 and 2, so p₀ = 120/600 = 0.2 and the
//     lifts are grid.1 0.6, reco.1 1.8, reco.2 1.25, editorial.1 1.0, ugc.1 1.25.
// a = 0.625 for line Tabby, category Handbags and occasion evening (above).
//   band 1 (category 1, occasion 0.25), every eligible module:
//     ugc.1        (0 + fresh 0.4) × 1.25                          = 0.5
//     grid.1       (category 1 × a) × 0.6                          = 0.375
//     reco.2       (occasion 0.25 × a) × 1.25                      = 0.1953
//     reco.1       0 — band 1 weights no line, so the seed adds 0  = 0
//     editorial.1  0 — merchandising multiplies nothing            = 0
//     → positions 1–2: ugc.1, grid.1
//   band 2 (line 1), over what is left:
//     editorial.1  (line 1 × a) × promotion 1.5 × 1.0              = 0.9375
//     reco.1       (0 + seed 0.5 × line 1) × 1.8                   = 0.9
//     reco.2       (line 1 × a) × 1.25                             = 0.78125
//     → positions 3–5: editorial.1, reco.1, reco.2
// Each term moves the answer: without freshness band 1 is grid.1, reco.2; without
// the lift grid.1, ugc.1; with the seed scaled by the SLOT's line weight in band 1,
// reco.1 (0.9) would take position 1; without the seed, reco.1 falls to position 5;
// without merchandising, editorial.1 (0.625) falls behind reco.1 and reco.2.
// ---------------------------------------------------------------------------
const FRESH_AT = new Date(Date.now() - 60_000).toISOString();
const M2_PIECES = MODULES.map(p => p.id === M.editorial ? { ...p, merchandising: { promotion: 1 } } : p.id === M.ugc ? { ...p, freshnessDate: FRESH_AT } : p);
const M2_RULES = {
  seeds: [{ signal: 'entry_channel', value: 'paid_social', weight: 0.5, tags: [{ dimension: 'line', value: 'Willow' }] }],
  freshness: { weight: 0.4, halfLifeDays: 30 },
  merchandising: { promotion: 0.5 },
};
const M2_STATS = { n0: 0.001, tauLearnMs: 1_814_400_000, liftMin: 0.5, liftMax: 2, nMin: 30 };
const M2_LEARN = learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', gamma: 1 } }, { stats: M2_STATS });
const M2_ELSEWHERE: Cell = { channel: 'email', visit_bucket: '4+', region: null, affinity: null, stage: 'late' };
const M2_EVIDENCE: Record<string, { n: number; s: number }> = { [M.grid]: { n: 100, s: 12 }, [M.reco1]: { n: 100, s: 36 }, [M.reco2]: { n: 100, s: 25 },
  [M.editorial]: { n: 100, s: 20 }, [M.ugc]: { n: 100, s: 25 }, [M.reviews]: { n: 100, s: 2 } };
const M2_P0 = Object.values(M2_EVIDENCE).reduce((t, e) => t + e.s, 0) / Object.values(M2_EVIDENCE).reduce((t, e) => t + e.n, 0);
const m2Lift = (id: string) => Math.min(M2_STATS.liftMax, Math.max(M2_STATS.liftMin, M2_EVIDENCE[id]!.s / M2_EVIDENCE[id]!.n / M2_P0));
const A = 3 / (3 + 1.8);
const M2_FINAL: Record<string, number> = {
  [M.ugc]: (0 + 0.4) * m2Lift(M.ugc),
  [M.grid]: (1 * A) * m2Lift(M.grid),
  [M.editorial]: (1 * A) * 1.5 * m2Lift(M.editorial),
  [M.reco1]: (0 + 0.5 * 1) * m2Lift(M.reco1),
  [M.reco2]: (1 * A) * m2Lift(M.reco2),
};
const M2_WHY: Record<string, string> = {
  [M.ugc]: 'band 1: freshness 0.4 × lift 1.25', [M.grid]: 'band 1: category 1 × 0.625 × lift 0.6',
  [M.editorial]: 'band 2: line 1 × 0.625 × promotion 1.5 × lift 1.0', [M.reco1]: 'band 2: seed 0.5 × line 1 × lift 1.8', [M.reco2]: 'band 2: line 1 × 0.625 × lift 1.25',
};
const M2_ORDER = [M.ugc, M.grid, M.editorial, M.reco1, M.reco2];

// ---------------------------------------------------------------------------
// M1's diversity leg (R-P76): a yield at position 2, inside the first band.
// The slot carries a diversity rule on line, at most 1 per line (CW33: a module
// that would put a value over the limit yields to the next candidate; when
// nothing else is eligible it fills the position over the limit, relaxed), the
// seed rule of M2 (arrivals from paid social are evidence for line Willow, rule
// weight 0.5 × the ranking's weight for line) and its own weights (line 0.8,
// category 1, occasion 0.5), which only the CONTROL ranks with: the bands cover
// 1..5. a = 0.625 for line Tabby, category Handbags and occasion evening (above);
// line Willow and Small Leather Goods read 0.
//   band 1 (line 1, occasion 0.25), position 1, every eligible module:
//     reco.2       line 1 × a + occasion 0.25 × a        = 0.78125
//     editorial.1  line 1 × a                            = 0.625
//     reco.1       0 + seed 0.5 × line 1                 = 0.5
//     grid.1, ugc.1                                      = 0
//     → position 1: reco.2 (line Tabby, 1 of the 1 allowed)
//   band 1, position 2, over what is left: editorial.1 (0.625) yields, line Tabby
//     being at its limit, so the next still-eligible module under band 1's
//     weights takes it: reco.1 (0.5)
//   band 2 (category 1), positions 3–5, over what is left, editorial.1 among them:
//     grid.1       category 1 × a                        = 0.625
//     editorial.1  0 — band 2 weights no line            = 0
//     ugc.1        0                                     = 0
//     → position 3: grid.1; position 4: editorial.1 yields again and ugc.1 takes
//       it (catalogue order breaks the tie at 0); position 5: editorial.1, the
//       only module left, over the limit (relaxed), ranked under band 2's
//       weights at 0
// Without the seed, position 2 would go to grid.1 (0, first in catalogue order),
// hence the PRECONDITION on the arrival. Diversity applied to a precomputed
// banded ranking instead puts band 2's top pick, grid.1, at position 2 and serves
// editorial.1 at position 5 with band 1's score and band.
// CONTROL, the same slot without bands (its own weights, today's rule):
//     reco.2 0.8 × a + 0.5 × a = 0.8125, grid.1 1 × a = 0.625, editorial.1
//     0.8 × a = 0.5, reco.1 seed 0.5 × line 0.8 = 0.4, ugc.1 0
//     → reco.2, grid.1, editorial.1 yields, reco.1, ugc.1, editorial.1 relaxed
// ---------------------------------------------------------------------------
const r2 = (x: number) => Math.round(x * 100) / 100;
/** A delivered decision's score to two places, null when it carries none. */
const scoreOf = (d: { score?: number }) => (typeof d.score === 'number' ? r2(d.score) : null);
const B1 = { from: 1, to: 2 }, B2 = { from: 3, to: 5 };
const DIV_BANDS = [{ ...B1, weights: { line: 1, occasion: 0.25 } }, { ...B2, weights: { category: 1 } }];
const DIV_SLOT = { weights: { line: 0.8, category: 1, occasion: 0.5 }, diversity: { dimension: 'line', max: 1 }, seeds: M2_RULES.seeds };
/** Position by position: the module, its score under the weights that ranked it, and the band it was ranked in. */
const DIV_BANDED: Array<[string, number, { from: number; to: number }]> = [
  [M.reco2, 1 * A + 0.25 * A, B1], [M.reco1, 0 + 0.5 * 1, B1], [M.grid, 1 * A, B2], [M.ugc, 0, B2], [M.editorial, 0, B2]];
const DIV_UNBANDED: Array<[string, number]> = [[M.reco2, 0.8 * A + 0.5 * A], [M.grid, 1 * A], [M.reco1, 0.5 * 0.8], [M.ugc, 0], [M.editorial, 0.8 * A]];

// ---------------------------------------------------------------------------
// M1's exploration legs (R-P77): the diversity world above (DIV_SLOT with
// DIV_BANDS, the shopper of warmShopper) under a rotation draw. The learn dials:
// rotation, share 1, floor 50, gamma 0, so the learned term is lift^0 = 1 and
// every score is the one computed above. Rotation draws the module under the
// floor with the fewest observations (W28; read only to build the fixture). The
// fixture leaves exactly ONE module under the floor: the four others are fed 100
// exposures and 20 credits each in a cell that shares only everyone with the
// shopper (M2_ELSEWHERE), so they hold 100 observations at everyone, over the
// floor; the one left unfed holds 0. Every shopper is drawn with a decision
// bucket below 1.000 (visitor, slot, hour; R-P62 (4)), so a share of 1 holds
// every decision.
//   LEADER DRAW: reco.2 left unfed, so the draw is reco.2. reco.2 leads the
//     banded ranking (band 1, position 1: 0.78125 over editorial.1 0.625,
//     reco.1 0.5, grid.1 and ugc.1 0) and the unbanded one (0.8125 over grid.1
//     0.625, editorial.1 0.5, reco.1 0.4, ugc.1 0): the draw lands on the leader
//     of both and moves nothing.
//     → the banded slot serves DIV_BANDED exactly, its order with no draw:
//       reco.2 0.78125 {1,2}, reco.1 0.5 {1,2} (editorial.1 yields at position 2
//       to band 1's next module under band 1's weights), grid.1 0.625 {3,5},
//       ugc.1 0 {3,5}, editorial.1 0 {3,5} relaxed; reco.2 recorded explored
//       (mode rotation) at position 1 and no other position explored.
//     → CONTROL, without bands: DIV_UNBANDED exactly, its order with no draw,
//       reco.2 explored at position 1 the same way (R-P7).
//     Today's loop over the precomputed banded ranking (the order R-P76
//     rejected) serves instead reco.2, grid.1 0.625 {3,5} at position 2, reco.1
//     0 {3,5}, ugc.1, editorial.1 0.625 {1,2} relaxed.
//   MOVED PICK (MD3, R-P34): editorial.1 left unfed, so the draw is editorial.1.
//     The banded ranking (the banded result before the diversity rule, run by
//     run as RANKING fills positions):
//       band 1 ranks the five; positions 1–2 take reco.2 (line 1 × a +
//         occasion 0.25 × a = 0.78125) and editorial.1 (line 1 × a = 0.625);
//       band 2 ranks what is left; positions 3–5 take grid.1 (category 1 × a
//         = 0.625), reco.1 (0: band 2 weights no line, so the seed adds 0) and
//         ugc.1 (0; catalogue order breaks the tie).
//     editorial.1 is second, so the draw moves it: editorial.1, then reco.2,
//     grid.1, reco.1, ugc.1, and today's take loop with the diversity rule (line,
//     at most 1) acts on that order as on a slot without bands:
//       position 1 editorial.1 (line Tabby, 1 of the 1 allowed), explored;
//       reco.2 (Tabby) yields; position 2 grid.1 (no line), naming reco.2;
//       position 3 reco.1 (Willow); position 4 ugc.1 (no line);
//       position 5 reco.2, the only module left, over the limit (relaxed).
//     Each module keeps the score and the band of the run that ranked it:
//     nothing is re-ranked per position.
//     A fill that also ran after a moved pick would serve the per-position order
//     DIV_BANDED (reco.2, reco.1, grid.1, ugc.1, editorial.1) and record no
//     position explored.
// ---------------------------------------------------------------------------
const ROTATION_LEARN = learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', gamma: 0, exploration: { mode: 'rotation', share: 1, floor: 50 } } }, { stats: M2_STATS });
/** The modules the slot ranks in the diversity world; every one but the module left under the floor is fed. */
const DIV_ELIGIBLE = [M.grid, M.reco1, M.reco2, M.editorial, M.ugc];
type Yield = { skipped: string[]; relaxed: boolean } | null;
/** Position by position under the moved pick: the module, its score and band from the run that ranked it, and the diversity rule's note on the position. */
const DIV_MOVED: Array<[string, number, { from: number; to: number }, Yield]> = [
  [M.editorial, 1 * A, B1, null], [M.grid, 1 * A, B2, { skipped: [M.reco2], relaxed: false }], [M.reco1, 0 + 0.5 * 0, B2, null], [M.ugc, 0, B2, null],
  [M.reco2, 1 * A + 0.25 * A, B1, { skipped: [], relaxed: true }]];
/** The positions (from 1) a stored decision records as explored, with the module and the exploration's mode. */
const exploredIn = (records: DecisionRecord[]) => records.filter(r => r.explored).map(r => [r.position + 1, r.item_id, r.explain.exploration?.mode ?? null]);
const yieldOf = (r: DecisionRecord): Yield => (r.explain.diversity ? { skipped: r.explain.diversity.skipped, relaxed: r.explain.diversity.relaxed } : null);

// ---------------------------------------------------------------------------
// M4's X1 leg (R-P76): a merchandised module that the first band's run scored
// on a positive base and the second band ranked at a base of 0.
// Bands: position 1 (line 1, occasion 1), positions 2–5 (category 1); the slot's
// merchandising { promotion 0.5 }; reco.2 and editorial.1 on promotion (1):
// × (1 + 0.5 × 1) = 1.5 on a positive base, and a multiplier on nothing is
// nothing (src/reflex/merchandising.ts applyMerchandising).
//   band 1, position 1, every eligible module:
//     reco.2       (line 1 × a + occasion 1 × a) × 1.5    = 1.875   → position 1
//     editorial.1  (line 1 × a) × 1.5                     = 0.9375
//     grid.1, reco.1, ugc.1                                = 0
//   band 2 (category 1), positions 2–5, over what is left:
//     grid.1 category 1 × a = 0.625; reco.1, editorial.1, ugc.1 0 (catalogue order)
//     → editorial.1 at position 4 on a base of 0: no merchandising applied to the
//       score that ranked it, so its record carries no merchandising block and no
//       other term, its receipt no merchandising sentence, and both name band 2
//       ({ from: 2, to: 5 }); reco.2 at position 1 keeps its merchandising
//       (× 1.5) on both, and both name band 1 ({ from: 1, to: 1 }).
// CONTROL, band 2's weights as the slot's own (category 1) and no bands:
//     grid.1 0.625; reco.1, reco.2, editorial.1, ugc.1 0 → editorial.1 at
//     position 4 on a base of 0, no term, no merchandising sentence.
// ---------------------------------------------------------------------------
const X1_PIECES = MODULES.map(p => p.id === M.reco2 || p.id === M.editorial ? { ...p, merchandising: { promotion: 1 } } : p);
const X1_MERCHANDISING = { promotion: 0.5 };
const X1_BOOST = 1 + 0.5 * 1;
const X1_BANDS = [{ from: 1, to: 1, weights: { line: 1, occasion: 1 } }, { from: 2, to: 5, weights: { category: 1 } }];
const X1_ORDER = [M.reco2, M.grid, M.reco1, M.editorial, M.ugc];
const X1_CONTROL_ORDER = [M.grid, M.reco1, M.reco2, M.editorial, M.ugc];
/** The terms a record explains between its base and its final score (src/content/types.ts, DecisionRecord.explain). */
const TERMS = ['contextual', 'external', 'stage', 'freshness', 'fatigue', 'merchandising'] as const;
const X1_EXPECTED: Record<string, unknown> = {
  [M.reco2]: { position: 1, band: { from: 1, to: 1 }, score: r2((1 * A + 1 * A) * X1_BOOST), terms: [`merchandising ×${X1_BOOST}`], receipt: { band: { from: 1, to: 1 }, merchandisingSentences: 1 } },
  [M.editorial]: { position: 4, band: { from: 2, to: 5 }, score: 0, terms: [], receipt: { band: { from: 2, to: 5 }, merchandisingSentences: 0 } },
};
/** What a stored record and its receipt explain for one position: the band, the final score, every term present, the receipt's merchandising sentences. */
const explainedOf = (r: DecisionRecord, receipt: Record<string, unknown> | undefined) => ({
  position: r.position + 1,
  band: (r.explain as unknown as { band?: unknown }).band ?? null,
  score: r2(r.explain.score_final),
  terms: TERMS.filter(t => r.explain[t] != null).map(t => t === 'merchandising' ? `merchandising ×${r.explain.merchandising!.boost}` : t),
  receipt: { band: receipt?.band ?? null, merchandisingSentences: ((receipt?.why ?? []) as string[]).filter(w => w.startsWith('Merchandising:')).length },
});

async function world(host: Host, slots: unknown, basis: 'served-v1' | 'rendered-v1' = 'rendered-v1', retainedSlots = false): Promise<Mounted> {
  const m = await mount(host, { pieces: MODULES, slots, learn: learnOf(basis), retainedSlots }, basis === 'served-v1' ? { recovery: false } : {});
  expectPublished(m, 'P15 — the page with its banded slot publishes');
  return m;
}
async function warmShopper(m: Mounted) {
  const s = await shopperOn(m);
  await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  return s;
}
/** R-P77: the diversity world's slot under the rotation dials, every eligible module but `underFloor` fed to 100 observations, the snapshot published. */
async function rotationWorld(host: Host, slot: Record<string, unknown>, underFloor: string): Promise<Mounted> {
  const m = await mount(host, { pieces: MODULES, slots: slotsDoc([modulesSlot(slot), recentSlot()]), learn: ROTATION_LEARN });
  expectPublished(m, 'P15.M1 (R-P77) — the slot and the learn document with the rotation dials publish');
  for (const item of DIV_ELIGIBLE.filter(id => id !== underFloor)) {
    await feedStats(m, { slot: LAYOUT, item, cell: M2_ELSEWHERE, exposures: 100, credits: 20, config: { reward: 'click', stats: M2_STATS, objective: 'unit', measurementBasis: 'rendered-v1' } });
  }
  await publishStats(m);
  return m;
}
/** R-P62 (4): a shopper whose decision bucket (visitor, slot, hour) lies below 1.000 this hour and the next, so a share of 1 holds; then warmShopper's arrival and views. */
async function warmInsideShare(m: Mounted) {
  const inside = (subject: string, at: number) => Math.round(bucketOf(subject, LAYOUT, hourKeyOf(at)) * 1000) / 1000 < 1;
  for (let draw = 0; draw < 20; draw++) {
    const s = await shopperOn(m), now = Date.now();
    if (!inside(s.subject, now) || !inside(s.subject, now + 3_600_000)) continue;
    await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
    for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
    return s;
  }
  return expect.unreachable(`${m.host}: PRECONDITION — none of twenty shoppers drawn has a bucket below 1.000`);
}
/** R-P77: one decision of the slot, every position acknowledged and its record read back from the ledger, in position order. */
async function rotationDecision(m: Mounted, label: string) {
  const s = await warmInsideShare(m);
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
  const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
  for (const d of layout) expect((await s.ack(page, d)).status, `${m.host}: PRECONDITION — ${d.contentId} acknowledged`).toBe(200);
  await m.drainLedger();
  const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
  expect([...new Set(records.map(r => r.cell.channel))], `${m.host}: PRECONDITION — the shopper arrived from paid social, so the seed rule fires`).toEqual(['paid_social']);
  return { page, layout, records };
}

// ===========================================================================
// unit:P15.M1 — two bands, one de-duplicated result
// ===========================================================================

describe('unit:P15.M1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D1 — positions 1 to 2 are ranked with the first band's weights and positions 3 to 5 with the second's, with no module served twice in the slot or on the page`, async () => {
      const m = await world(host, BANDED);
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p15-m1') });
      expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
      expect(servedIn(page, LAYOUT), `${host}: P15.M1 — positions 1–2 by the first band, 3–5 by the second`).toEqual(BANDED_ORDER);
      expect(servedIn(page, RECENT_SLOT), `${host}: the recently-viewed slot keeps its pinned module`).toEqual([M.recent]);
      const ids = page.decisions.map(d => d.contentId);
      expect(ids.length, `${host}: P15.M1 — no module twice on the page`).toBe(new Set(ids).size);
    });
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P76 — a diversity yield at position 2 inside the first band is filled by the first band's next module under its weights, and the yielding module stays eligible for positions 3 to 5 under the second band's weights, each record naming the band its position was ranked in; CONTROL: the same slot without bands serves today's order under the same yield`, async () => {
      const m = await world(host, slotsDoc([modulesSlot({ ...DIV_SLOT, bands: DIV_BANDS }), recentSlot()]));
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p15-m1-diversity') });
      expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
      const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
      for (const d of layout) expect((await s.ack(page, d)).status, `${host}: PRECONDITION — ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      expect([...new Set(records.map(r => r.cell.channel))], `${host}: PRECONDITION — the shopper arrived from paid social, so the seed rule fires`).toEqual(['paid_social']);
      expect.soft(layout.map(d => d.contentId), `${host}: P15.M1 (R-P76) — editorial.1 yields at position 2 and band 1's next module under band 1's weights, reco.1 (0.5), takes it, not band 2's top pick; positions 3–5 by band 2, editorial.1 among them`)
        .toEqual(DIV_BANDED.map(([id]) => id));
      expect.soft(layout.map(d => [d.contentId, scoreOf(d)]), `${host}: P15.M1 (R-P76) — each module scored under the weights of the band covering the position it fills`)
        .toEqual(DIV_BANDED.map(([id, score]) => [id, r2(score)]));
      expect.soft(records.map(r => [r.item_id, (r.explain as unknown as { band?: unknown }).band ?? null]), `${host}: P15.M1 (R-P76) — each record names the band its position was ranked in`)
        .toEqual(DIV_BANDED.map(([id, , band]) => [id, band]));
      const ids = page.decisions.map(d => d.contentId);
      expect(ids.length, `${host}: P15.M1 — no module twice on the page`).toBe(new Set(ids).size);

      // CONTROL (R-P7): the same slot without bands keeps today's diversity under the same yield.
      const today = await (await warmShopper(await world(host, slotsDoc([modulesSlot(DIV_SLOT), recentSlot()])))).snapshot('pdp', { pageInstance: pageInstanceOf('p15-m1-diversity-control') });
      expect(today.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order).map(d => [d.contentId, scoreOf(d)]),
        `${host}: CONTROL — without bands: reco.2, grid.1, editorial.1 yields to reco.1, ugc.1, editorial.1 over the limit`).toEqual(DIV_UNBANDED.map(([id, score]) => [id, r2(score)]));
    });
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P77 — a rotation draw that lands on the banded ranking's leader moves nothing, so the slot serves exactly the per-position order it serves with no draw, the leader recorded explored with its mode and each record naming the band its position was ranked in; CONTROL: the same slot without bands under the same leader draw serves exactly its order with no draw`, async () => {
      const { page, layout, records } = await rotationDecision(await rotationWorld(host, { ...DIV_SLOT, bands: DIV_BANDS }, M.reco2), 'p15-m1-leader-draw');
      expect.soft(exploredIn(records), `${host}: P15.M1 (R-P77) — the rotation drew reco.2, the only module under the floor and the banded ranking's leader: recorded explored (mode rotation) at position 1, no other position explored`)
        .toEqual([[1, M.reco2, 'rotation']]);
      expect.soft(layout.map(d => d.contentId), `${host}: P15.M1 (R-P77) — a draw on the leader moves nothing: editorial.1 yields at position 2 and band 1's next module under band 1's weights, reco.1 (0.5), takes it as with no draw, not band 2's grid.1 from today's loop over the banded ranking; positions 3–5 by band 2, editorial.1 among them`)
        .toEqual(DIV_BANDED.map(([id]) => id));
      expect.soft(layout.map(d => [d.contentId, scoreOf(d)]), `${host}: P15.M1 (R-P77) — under the leader draw each module is scored under the weights of the band covering the position it fills, as with no draw`)
        .toEqual(DIV_BANDED.map(([id, score]) => [id, r2(score)]));
      expect.soft(records.map(r => [r.item_id, (r.explain as unknown as { band?: unknown }).band ?? null]), `${host}: P15.M1 (R-P77) — under the leader draw each record names the band its position was ranked in, as with no draw`)
        .toEqual(DIV_BANDED.map(([id, , band]) => [id, band]));
      const ids = page.decisions.map(d => d.contentId);
      expect(ids.length, `${host}: P15.M1 — no module twice on the page`).toBe(new Set(ids).size);

      // CONTROL (R-P7): the same slot without bands under the same draw, which lands on its own leader too.
      const today = await rotationDecision(await rotationWorld(host, DIV_SLOT, M.reco2), 'p15-m1-leader-draw-control');
      expect.soft(exploredIn(today.records), `${host}: CONTROL — without bands the draw is reco.2 again, the slot's own leader (0.8125): recorded explored (mode rotation) at position 1`)
        .toEqual([[1, M.reco2, 'rotation']]);
      expect(today.layout.map(d => [d.contentId, scoreOf(d)]), `${host}: CONTROL — without bands a draw on the leader serves exactly the order with no draw: reco.2, grid.1, editorial.1 yields to reco.1, ugc.1, editorial.1 over the limit`)
        .toEqual(DIV_UNBANDED.map(([id, score]) => [id, r2(score)]));
    });
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P77 LOCKED (MD3, R-P34) — a rotation draw that moves a module serves the pick first, recorded explored, and the rest in today's take loop over the banded ranking, the diversity rule acting on that order as on a slot without bands and nothing re-ranked per position; CONTROL: the pick is first and recorded explored, which a fill that also ran after a moved pick would lose`, async () => {
      const { page, layout, records } = await rotationDecision(await rotationWorld(host, { ...DIV_SLOT, bands: DIV_BANDS }, M.editorial), 'p15-m1-moved-pick');
      expect.soft(layout.map(d => d.contentId), `${host}: P15.M1 (R-P77, R-P34) — the pick editorial.1 first, then today's take loop over the banded ranking reco.2, grid.1, reco.1, ugc.1: reco.2 yields to grid.1 and is served last, over the limit`)
        .toEqual(DIV_MOVED.map(([id]) => id));
      expect.soft(layout.map(d => [d.contentId, scoreOf(d)]), `${host}: P15.M1 (R-P77, R-P34) — each module keeps the score of the band run that ranked it: nothing is re-ranked per position`)
        .toEqual(DIV_MOVED.map(([id, score]) => [id, r2(score)]));
      expect.soft(records.map(r => [r.item_id, (r.explain as unknown as { band?: unknown }).band ?? null]), `${host}: P15.M1 (R-P77, R-P34) — each record names the band whose run ranked the module, reco.2 band 1 at position 5`)
        .toEqual(DIV_MOVED.map(([id, , band]) => [id, band]));
      expect.soft(records.map(r => [r.item_id, yieldOf(r)]), `${host}: P15.M1 (R-P77, R-P34) — the diversity rule acts on the explored order as on a slot without bands: grid.1 names reco.2 as yielding, reco.2 is served relaxed`)
        .toEqual(DIV_MOVED.map(([id, , , note]) => [id, note]));
      const ids = page.decisions.map(d => d.contentId);
      expect(ids.length, `${host}: P15.M1 — no module twice on the page`).toBe(new Set(ids).size);

      // CONTROL (the lock's teeth): a fill that also ran after a moved pick would serve the per-position order with the pick lost from the records.
      expect([layout[0]?.contentId ?? null, exploredIn(records)], `${host}: CONTROL — the pick editorial.1 is served first and recorded explored (mode rotation) at position 1; a fill that also ran after a moved pick would serve reco.2, reco.1, grid.1, ugc.1, editorial.1 (the per-position order) and record no position explored`)
        .toEqual([M.editorial, [[1, M.editorial, 'rotation']]]);
    });
  }
});

// ===========================================================================
// unit:P15.M2 — a band replaces only the weights; every other rule applies to every band
// ===========================================================================

describe('unit:P15.M2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a band's weights replace the slot's weights for its positions while the pinned prefix, the exclusions, eligibility, the page's reservations and the take apply unchanged to every band`, async () => {
      // The editorial module is pinned at position 1, and complete-the-look is excluded as well as reviews.
      const m = await world(host, slotsDoc([modulesSlot({ bands: BANDS, pinnedPieceIds: [M.editorial], excludedPieceIds: [M.reviews, M.reco2] }), recentSlot()]));
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p15-m2') });
      // Position 1: the pin. Position 2 (band 1) over grid.1, reco.1, ugc.1: grid.1 (0.625). Positions 3–5 (band 2): reco.1, ugc.1 — only two remain.
      expect(servedIn(page, LAYOUT), `${host}: P15.M2 — the pin holds position 1, band 1 ranks position 2, band 2 ranks what remains, exclusions and eligibility as today`).toEqual([M.editorial, M.grid, M.reco1, M.ugc]);
      expect(page.decisions.filter(d => d.slot === LAYOUT).map(d => d.strategy), `${host}: P15.M2 — the pinned position keeps its authority`).toEqual(['tenant-pinned', 'affinity', 'default', 'default']);
      const scores = Object.fromEntries(page.decisions.filter(d => d.slot === LAYOUT).map(d => [d.contentId, d.score]));
      expect(scores[M.grid], `${host}: P15.M2 — grid.1 at position 2 is scored by band 1's weights (category 1 × 0.625)`).toBeCloseTo(0.625, 3);
      const all = page.decisions.map(d => d.contentId);
      expect(all.filter(id => [M.reviews, M.reco2, M.lookbook, M.charms].includes(id as never)), `${host}: P15.M2 — never an excluded or ineligible module`).toEqual([]);
      expect(all.length, `${host}: no module twice on the page`).toBe(new Set(all).size);
    });
  }

  for (const host of HOSTS) {
    it(`host (${host}): on a banded slot the seed rule is scaled by the band's weight for its dimension and keeps its own weight, and freshness, merchandising and the learned lift apply unchanged to every band`, async () => {
      const m = await mount(host, { pieces: M2_PIECES, slots: slotsDoc([modulesSlot({ bands: BANDS, ...M2_RULES }), recentSlot()]), learn: M2_LEARN });
      expectPublished(m, 'P15.M2 — the banded slot with its seed rule, freshness and merchandising, and the learn document at gamma 1, publish');
      for (const [item, { n, s }] of Object.entries(M2_EVIDENCE)) {
        await feedStats(m, { slot: LAYOUT, item, cell: M2_ELSEWHERE, exposures: n, credits: s, config: { reward: 'click', stats: M2_STATS, objective: 'unit', measurementBasis: 'rendered-v1' } });
      }
      await publishStats(m);
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p15-m2-terms') });
      expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
      const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
      for (const d of layout) expect((await s.ack(page, d)).status, `${host}: PRECONDITION — ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT);
      expect([...new Set(records.map(r => r.cell.channel))], `${host}: PRECONDITION — the shopper arrived from paid social, so the seed rule fires`).toEqual(['paid_social']);
      expect(records.map(r => [r.item_id, Math.round((r.explain.lift?.lift ?? 0) * 100) / 100]).sort(), `${host}: PRECONDITION — every module's learned lift is read at everyone from the fed evidence`)
        .toEqual(Object.keys(M2_FINAL).map(id => [id, Math.round(m2Lift(id) * 100) / 100]).sort());
      expect(layout.map(d => d.contentId), `${host}: P15.M2 — band 1 ranks freshness, merchandising and the lift over its own weights, band 2 the seed rule scaled by its weight for line, with merchandising and the lift`).toEqual(M2_ORDER);
      for (const d of layout) {
        expect(d.score, `${host}: P15.M2 — ${d.contentId} at position ${layout.indexOf(d) + 1} scores ${M2_FINAL[d.contentId]!.toFixed(4)} (${M2_WHY[d.contentId]})`).toBeCloseTo(M2_FINAL[d.contentId]!, 2);
      }
    });
  }
});

// ===========================================================================
// unit:P15.M3 — publication refusals; a slot without bands decides and replays as before
// ===========================================================================

const BAD: Array<{ name: string; bands: unknown }> = [
  { name: 'overlapping bands', bands: [{ from: 1, to: 3, weights: { category: 1 } }, { from: 3, to: 5, weights: { line: 1 } }] },
  { name: 'a gap', bands: [{ from: 1, to: 2, weights: { category: 1 } }, { from: 4, to: 5, weights: { line: 1 } }] },
  { name: 'bands short of the take', bands: [{ from: 1, to: 2, weights: { category: 1 } }, { from: 3, to: 4, weights: { line: 1 } }] },
  { name: 'bands not starting at 1', bands: [{ from: 2, to: 5, weights: { line: 1 } }] },
  { name: 'a band setting the take', bands: [{ from: 1, to: 2, weights: { category: 1 }, take: 2 }, { from: 3, to: 5, weights: { line: 1 } }] },
  { name: 'a band setting pins', bands: [{ from: 1, to: 2, weights: { category: 1 }, pinnedPieceIds: [M.grid] }, { from: 3, to: 5, weights: { line: 1 } }] },
];

describe('unit:P15.M3', () => {
  it('logic: decision D1 — publication admits contiguous bands covering 1 to take with weights only, and refuses overlap, a gap, short or late coverage, and any other setting, naming the slot\'s bands', () => {
    const admitted = validateSlotCatalog(BANDED);
    expect(admitted.ok ? 'admitted' : (admitted as { errors: string[] }).errors.join('; '), 'P15.M3 — the two bands are admitted').toBe('admitted');
    expect((admitted as { value?: { pages: Record<string, Array<Record<string, unknown>>> } }).value?.pages.pdp?.[0]?.bands, 'P15.M3 — and kept on the slot').toEqual(BANDS);
    for (const bad of BAD) {
      const refused = validateSlotCatalog(slotsDoc([modulesSlot({ bands: bad.bands }), recentSlot()]));
      expect.soft(refused.ok ? 'admitted' : (refused as { errors: string[] }).errors.some(e => e.startsWith('pages.pdp[0].bands')) ? 'refused by name' : (refused as { errors: string[] }).errors.join('; '),
        `P15.M3 — ${bad.name} is refused naming pages.pdp[0].bands`).toBe('refused by name');
    }
  });

  for (const host of HOSTS) {
    it(`host (${host}): the slots route refuses malformed bands by name; LOCKED — a retained slot without bands decides as before and every decision replays equal`, async () => {
      const m = await world(host, slotsDoc([modulesSlot(), recentSlot()]), 'rendered-v1', true);
      for (const bad of BAD.slice(0, 2)) {
        const refused = await putDocument(m, 'slots', slotsDoc([modulesSlot({ bands: bad.bands }), recentSlot()]), 'p15');
        expect.soft([refused.status, ((refused.body.errors ?? []) as unknown[]).some(e => String(e).startsWith('pages.pdp[0].bands'))],
          `${host}: P15.M3 — publishing ${bad.name} is refused (422) naming the bands: ${JSON.stringify(refused.body).slice(0, 200)}`).toEqual([422, true]);
      }
      // A cold shopper: catalogue order, no drivers, so the acknowledged records replay without R-P3.
      const s = await shopperOn(m);
      await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p15-m3') });
      expect(servedIn(page, LAYOUT), `${host}: P15.M3 — the slot without bands serves the first five eligible in catalogue order, as before`).toEqual([M.grid, M.reco1, M.reco2, M.editorial, M.ugc]);
      for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status).toBe(200);
      await m.drainLedger();
      for (const record of storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT)) {
        expect(Object.keys(record.inputs?.replay ?? {}).sort(), `${host}: P15.M3 — the page manifest carries exactly today's markers`)
          .toEqual(['candidateLimit', 'contentTypes', 'exploration', 'governance', 'learning', 'pins', 'slots', 'version']);
        const replay = await replayOf(m, record.decision_id);
        expect([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P15.M3 — ${record.item_id} replays equal`).toEqual([200, 'equal']);
      }
    });
  }
});

// ===========================================================================
// unit:P15.M4 — the record and the receipt name the band; a banded decision replays exactly
// ===========================================================================

describe('unit:P15.M4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the record and the receipt of each position name the band it was ranked in, and the banded decision replays exactly`, async () => {
      const m = await world(host, BANDED);
      const s = await warmShopper(m);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p15-m4') });
      for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status).toBe(200);
      await m.drainLedger();
      const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      expect.soft(records.map(r => r.item_id), `${host}: P15.M4 — the ledger holds the shopper's five positions in the banded order`).toEqual(BANDED_ORDER);
      expect.soft(records.map(r => (r.explain as unknown as { band?: unknown }).band ?? null), `${host}: P15.M4 — each record names its band`).toEqual(BAND_OF);
      const receipts = await receiptsOf(m, s.subject);
      expect.soft(records.map(r => receipts.find(x => x.decision_id === r.decision_id)?.band ?? null), `${host}: P15.M4 — each receipt names its band`).toEqual(BAND_OF);

      // The replay: the served-v1 copy, composed by the route's own call and written by the real producer and consumer.
      const sv = await world(host, BANDED, 'served-v1');
      const warm = await warmShopper(sv);
      const set = await servePage(sv, warm, 'pdp', { offer: false }) as unknown as { records: DecisionRecord[] };
      const composed = set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
      expect.soft(composed.map(r => r.item_id), `${host}: P15.M4 — the composed decision is the banded order`).toEqual(BANDED_ORDER);
      await toLedger(sv, set.records);
      for (const record of composed) {
        const replay = await replayOf(sv, record.decision_id);
        expect.soft([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P15.M4 — ${record.item_id} at position ${record.position + 1} replays equal (${JSON.stringify(replay.body.diff ?? replay.body.reason ?? '').slice(0, 160)})`).toEqual([200, 'equal']);
      }
    });
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P76 — a merchandised module that the first band's run scored on a positive base and the second band ranked at a base of 0 carries no merchandising block on its record and no merchandising sentence on its receipt, both naming the band that ranked it, while the position merchandising ranked keeps it; CONTROL: with band 2's weights as the slot's own and no bands the module explains no merchandising either`, async () => {
      const read = async (slot: Record<string, unknown>, label: string) => {
        const m = await mount(host, { pieces: X1_PIECES, slots: slotsDoc([slot, recentSlot()]), learn: learnOf('rendered-v1') });
        expectPublished(m, `P15.M4 (R-P76) — the ${label} slot with merchandising publishes`);
        const s = await warmShopper(m);
        const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(`p15-m4-x1-${label}`) });
        expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
        for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `${host}: PRECONDITION — ${d.contentId} acknowledged`).toBe(200);
        await m.drainLedger();
        const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT);
        const receipts = await receiptsOf(m, s.subject);
        const explained = (id: string) => {
          const r = records.find(x => x.item_id === id);
          return r ? explainedOf(r, receipts.find(x => x.decision_id === r.decision_id)) : null;
        };
        return { served: servedIn(page, LAYOUT), explained };
      };
      const banded = await read(modulesSlot({ bands: X1_BANDS, merchandising: X1_MERCHANDISING }), 'banded');
      expect.soft(banded.served, `${host}: P15.M4 (R-P76) — reco.2 by band 1, then grid.1, reco.1, editorial.1, ugc.1 by band 2`).toEqual(X1_ORDER);
      expect.soft(banded.explained(M.reco2), `${host}: P15.M4 (R-P76) — reco.2 at position 1, ranked by band 1 on a positive base, explains its merchandising (× 1.5) on its record and its receipt, band 1 on both`)
        .toEqual(X1_EXPECTED[M.reco2]);
      expect.soft(banded.explained(M.editorial), `${host}: P15.M4 (R-P76) — editorial.1 at position 4, ranked by band 2 on a base of 0: no merchandising block (and no other term) on its record, no merchandising sentence on its receipt, band 2 on both`)
        .toEqual(X1_EXPECTED[M.editorial]);

      // CONTROL: band 2's weights published as the slot's own, without bands.
      const control = await read(modulesSlot({ weights: { category: 1 }, merchandising: X1_MERCHANDISING }), 'control');
      expect.soft(control.served, `${host}: CONTROL — grid.1, then the modules at 0 in catalogue order`).toEqual(X1_CONTROL_ORDER);
      const plain = control.explained(M.editorial);
      expect.soft(plain && { position: plain.position, score: plain.score, terms: plain.terms, merchandisingSentences: plain.receipt.merchandisingSentences },
        `${host}: CONTROL — editorial.1 at position 4 on a base of 0 explains no merchandising on its record or its receipt`).toEqual({ position: 4, score: 0, terms: [], merchandisingSentences: 0 });
    });
  }
});

// ===========================================================================
// unit:P15.M5 — the kit
// ===========================================================================

describe('unit:P15.M5', () => {
  it('logic: the API reference and the payload schemas document position bands', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'a slot may carry position bands (bands: from, to, weights)', test: t => /\bbands\b/.test(t) && /from/.test(t) && /\bto\b/.test(t) && /weights/.test(t) },
      { name: 'a band overrides only the dimension weights', test: t => /band/i.test(t) && /only/i.test(t) && /weights/i.test(t) },
      { name: 'the bands are contiguous and cover positions 1 to take', test: t => /band/i.test(t) && /contiguous|no gap/i.test(t) && /take/i.test(t) },
      { name: 'one de-duplicated result across the bands', test: t => /band/i.test(t) && /de-?duplicat|never twice|no (module|piece) twice/i.test(t) },
      { name: 'the record and the receipt name the band', test: t => /band/i.test(t) && /record|receipt/i.test(t) && /explain\.band|band:? ?\{|names? the band/i.test(t) },
    ]);
    expect(missing, 'P15.M5 — the kit documents position bands').toEqual([]);
  });
});
