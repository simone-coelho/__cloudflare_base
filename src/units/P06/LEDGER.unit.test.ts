// src/units/P06/LEDGER.unit.test.ts
// P06 under the Closure Ledger: the tests for the LOCAL criteria of the P06 work
// order (`tapestry-parity-build`, ticket P06 "The order the engine would have
// shown, at trust dial zero"). DC1 and DC2 (decisions D1, D2) are ruled and
// exercised inside S1 and S2; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P06.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P06 in section A, amended
//     2026-10-07): "each decision record on a layout slot carries the baseline
//     order (the configured P01 order for the context, else catalogue order)
//     beside the order the engine would have served with every term applied,
//     and names each term that would have moved a module … the shadow is
//     therefore recorded against the baseline explicitly";
//   · freeze sheet item 21 (D1: "every term applied" means the learned term at
//     full trust, γ = 1; D2: on a blend slot, a configured shadow p defaulting to
//     10 percent) and item 8 (P28's blend: score = R + (1 − p) × B + p × Q, R =
//     (M − i) / M from the configured order else catalogue order, B the pre-lift
//     behaviour score, Q the clamped lift minus one, p defaulting to 0);
//   · the investigation, section G-B (C4: "affinity, seeds, the regional prior,
//     stage, freshness and fatigue reorder at γ = 0");
//   · the parity document, section 3.5 (cited by number only);
//   · the existing contract: src/content/decide.ts:372-386 (base × lift^γ; a
//     merchandiser's frozen lift is applied through γ like a learned one,
//     :374-378), :533-573 (the record), src/learn/replay.ts (replay).
//
// THE READINGS THIS FILE RULES (one representation for every criterion, on the
// page's DECLARED layout slot):
//   Every record of the layout carries `explain.baselineOrder` (P04's baseline:
//   the configured order for her context, else the slot's eligible modules in
//   catalogue order) and `explain.shadowOrder` (the order with every term
//   applied and the learned term at γ 1), each cut at the slot's take, and
//   `explain.shadowTerms: { module: [term] }` for each module whose shadow
//   position differs from its baseline position, the terms named in P29's words
//   (`affinity`, `lift`, …). The learned term of these fixtures is a
//   merchandiser's frozen lift of 2 (decide.ts:374-378), which the trust dial
//   applies exactly as it applies a learned one. P28's opt-in is ruled here as
//   `blend: { p }` on the slot's learn dials and P06's shadow p as
//   `blend.shadowP` (0.1 when absent): P28 is not yet specified, and its
//   specification must use the same name or the lead rules one.
//   S1  At γ 0 her Tabby interests serve reco.2, editorial.1, grid.1, reco.1;
//       with editorial.1's lift of 2 at γ 1 the shadow is editorial.1, reco.2,
//       grid.1, reco.1; the baseline is grid.1, reco.1, reco.2, editorial.1.
//   S2  On a blend slot with ugc.1's lift at 2 (Q = 1): served at p 0 and shadow
//       at a configured 0.9, then served at p 0.9 and shadow at the default 0.1;
//       each order is R + (1 − p) B + p Q's ranking for its own p.
//   S3  In S1's decision, editorial.1 (4 → 1) is named with `affinity` and
//       `lift`, reco.2 (3 → 2) with `affinity`.
//   S4  The decisions served on the declared layout equal, term for term, those
//       served on the same slot undeclared (no shadow), and so do the exposures
//       and the credits they produce.
//   S5  A decision with a shadow replays equal with the shadow reproduced; a
//       decision without one replays equal as before; `validateLearnConfig`
//       refuses a shadow p outside 0..1 naming `shadowP`; the kit documents the
//       baseline and shadow members.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `explain.baselineOrder`, `explain.shadowOrder`, `explain.shadowTerms`, and in
// the learn document `blend: { p, shadowP }` (P28's opt-in). No new export is imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts).

import { describe, expect, it } from 'vitest';

import { validateLearnConfig } from '@/content/kinds';
import type { DecisionRecord } from '@/content/types';

import {
  declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, recentSlot, replayOf, rounded, servePage, shopperOn, storedDecisions, TABBY_VIEWS, toLedger, type Mounted, type Shopper,
} from '../_parity';
import { missingStatements } from '../_parity2';

const SLOTS = declaredSlots([layoutSlot(), recentSlot()]);
const BASELINE = [M.grid, M.reco1, M.reco2, M.editorial];
const SERVED_AT_ZERO = [M.reco2, M.editorial, M.grid, M.reco1];
const SHADOW_AT_ONE = [M.editorial, M.reco2, M.grid, M.reco1];
const frozen = (id: string) => ({ items: { [id]: { mode: 'freeze', lift: 2 } } });
const dials = (extra: Record<string, unknown>, basis: 'rendered-v1' | 'served-v1' = 'rendered-v1') =>
  learnDocument({ [LAYOUT]: { ...(basis === 'rendered-v1' ? { measurementBasis: 'rendered-v1' } : {}), reward: 'click', ...extra } });

async function tabby(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: her page view is accepted`).toBe(200);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: her view is accepted`).toBe(200);
  return s;
}
const ex = (r: DecisionRecord | undefined) => (r?.explain ?? {}) as Record<string, unknown>;
const layoutRecords = async (m: Mounted, s: Shopper, offer = true) => (await servePage(m, s, 'pdp', offer ? {} : { offer: false })).records
  .filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);

// ===========================================================================
// unit:P06.S1 — the baseline and the shadow at γ 1 on every record
// ===========================================================================

describe('unit:P06.S1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D1 — every record of a layout decision carries the baseline order and the shadow order computed with every term applied and the learned term at γ 1, whatever γ serves`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: dials({ gamma: 0, ...frozen(M.editorial) }) });
      expectPublished(m, 'P06.S1 — the declared layout slot at γ 0 with editorial.1’s lift frozen at 2 publishes');
      const records = await layoutRecords(m, await tabby(m));
      expect(records.map(r => r.item_id), `${host}: PRECONDITION — at γ 0 her interests are served and the lift moves nothing`).toEqual(SERVED_AT_ZERO);
      expect(records.map(r => [r.item_id, ex(r).baselineOrder ?? null, ex(r).shadowOrder ?? null]),
        `${host}: P06.S1 — each record carries the baseline (catalogue order) and the shadow with the learned term at γ 1`)
        .toEqual(records.map(r => [r.item_id, BASELINE, SHADOW_AT_ONE]));
    }, 60_000);
  }

  // Locks for the review's uncovered mutants M6a, M6b and M12 (R-P64), green at 9dccd05c. The shadow is the order
  // with every term applied, ranked with no exploration pick and no adjacent swap (decision D1, R-P34; kit 02, "The
  // baseline and the shadow"), and the three members belong to the records of the declared layout slot only.
  const EXPLORING = (mode: 'epsilon' | 'adjacent-swap') => dials({ gamma: 1, ...frozen(M.editorial), exploration: { mode, share: 1, floor: 50 } });
  const explorationOf = (r: DecisionRecord) => (ex(r).exploration ?? null) as { mode?: string; positions?: [number, number] } | null;
  for (const host of HOSTS) {
    it(`host (${host}): lock M6a — on a slot that explores every decision by epsilon, the served order shows the exploration pick and the shadow order is the ranking without it`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: EXPLORING('epsilon') });
      expectPublished(m, 'P06.S1 lock M6a — the declared layout slot at γ 1, exploring by epsilon at share 1, publishes');
      // The pick is uniform over the slot's eligible modules (grid.1, reco.1, reco.2, editorial.1, ugc.1): the lock reads
      // a shopper whose pick is not the ranking's first module, so the pick shows in the served order.
      let records: DecisionRecord[] = [];
      for (let k = 0; k < 12 && (!records.length || records[0]!.item_id === SHADOW_AT_ONE[0]); k++) records = await layoutRecords(m, await tabby(m));
      expect([[M.reco2, M.grid, M.reco1, M.ugc].some(id => id === records[0]?.item_id), records[0] ? explorationOf(records[0])?.mode ?? null : null],
        `${host}: PRECONDITION — the first position is the epsilon pick, an eligible module other than the ranking's first (${JSON.stringify(records.map(r => r.item_id))})`)
        .toEqual([true, 'epsilon']);
      expect(records.map(r => [r.item_id, ex(r).shadowOrder ?? null]), `${host}: P06.S1 lock M6a — the shadow order carries no exploration pick`)
        .toEqual(records.map(r => [r.item_id, SHADOW_AT_ONE]));
    }, 60_000);

    it(`host (${host}): lock M6b — on a slot that swaps two adjacent positions on every decision, the served order shows the swap and the shadow order is the ranking without it`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: EXPLORING('adjacent-swap') });
      expectPublished(m, 'P06.S1 lock M6b — the declared layout slot at γ 1, exploring by adjacent swap at share 1, publishes');
      const records = await layoutRecords(m, await tabby(m));
      const [a, b] = records.map(explorationOf).find(e => e?.mode === 'adjacent-swap')?.positions ?? [0, 0];
      const swapped = SHADOW_AT_ONE.map((id, k) => (k === a - 1 ? SHADOW_AT_ONE[b - 1]! : k === b - 1 ? SHADOW_AT_ONE[a - 1]! : id));
      expect([b - a, records.map(r => r.item_id)], `${host}: PRECONDITION — the served order is the ranking with two adjacent positions swapped`).toEqual([1, swapped]);
      expect(records.map(r => [r.item_id, ex(r).shadowOrder ?? null]), `${host}: P06.S1 lock M6b — the shadow order carries no adjacent swap`)
        .toEqual(records.map(r => [r.item_id, SHADOW_AT_ONE]));
    }, 60_000);

    it(`host (${host}): lock M12 — on the declared page the layout slot's records carry the baseline, the shadow and the terms, and the other slot's record carries none of them`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: dials({ gamma: 0, ...frozen(M.editorial) }) });
      expectPublished(m, 'P06.S1 lock M12 — the declared layout slot and the recently-viewed slot publish');
      const records = (await servePage(m, await tabby(m), 'pdp')).records;
      const other = recentSlot().slot, members = ['baselineOrder', 'shadowOrder', 'shadowTerms'];
      expect(records.map(r => r.slot).sort(), `${host}: PRECONDITION — the page serves the layout slot's four records and the other slot's one`)
        .toEqual([LAYOUT, LAYOUT, LAYOUT, LAYOUT, other].sort());
      expect(records.map(r => [r.slot, r.item_id, members.filter(k => k in ex(r))]), `${host}: P06.S1 lock M12 — the three members on the layout slot's records only`)
        .toEqual(records.map(r => [r.slot, r.item_id, r.slot === LAYOUT ? members : []]));
    }, 60_000);
  }
});

// ===========================================================================
// unit:P06.S2 — on a blend slot, the shadow uses the configured shadow p, else 0.1
// ===========================================================================

describe('unit:P06.S2', () => {
  // R over the eligible modules in catalogue order (grid, reco.1, reco.2, editorial, ugc); B her Tabby scores; Q = 1 for ugc's lift of 2.
  const AT_ZERO = [M.reco2, M.grid, M.editorial, M.reco1];
  const AT_POINT_ONE = AT_ZERO;
  const AT_POINT_NINE = [M.ugc, M.grid, M.reco1, M.reco2];
  for (const host of HOSTS) {
    it(`host (${host}): decision D2 — on a slot opted into the blend the shadow order uses the slot's configured shadow p, 0.1 when none is published, while the served order uses the served p`, async () => {
      const outcomes: unknown[][] = [];
      for (const [name, blend, served, shadow] of [
        ['served p 0, shadow p 0.9', { p: 0, shadowP: 0.9 }, AT_ZERO, AT_POINT_NINE],
        ['served p 0.9, shadow p absent (0.1)', { p: 0.9 }, AT_POINT_NINE, AT_POINT_ONE],
      ] as const) {
        const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: dials({ blend, ...frozen(M.ugc) }) });
        expectPublished(m, `P06.S2 — the blend (${name}) publishes`);
        const records = await layoutRecords(m, await tabby(m));
        outcomes.push([name, records.map(r => r.item_id), ex(records[0]).shadowOrder ?? null, served, shadow]);
      }
      expect(outcomes.map(([name, served, shadow]) => [name, served, shadow]), `${host}: P06.S2 — the served order at the served p, the shadow at the shadow p`)
        .toEqual(outcomes.map(([name, , , served, shadow]) => [name, served, shadow]));
    }, 60_000);
  }
});

// ===========================================================================
// unit:P06.S3 — the terms that would have moved each module
// ===========================================================================

describe('unit:P06.S3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the record names, for each module whose shadow position differs from its baseline position, each term that would have moved it`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: dials({ gamma: 0, ...frozen(M.editorial) }) });
      expectPublished(m, 'P06.S3 — the declared layout slot at γ 0 with editorial.1’s lift frozen at 2 publishes');
      const records = await layoutRecords(m, await tabby(m));
      for (const r of records) {
        expect.soft(ex(r).shadowTerms ?? `no explain.shadowTerms on the record of ${r.item_id}`, `${host}: P06.S3 — editorial.1 (4 → 1) moved by her affinity and the lift; reco.2 (3 → 2) by her affinity`)
          .toMatchObject({ [M.editorial]: expect.arrayContaining(['affinity', 'lift']), [M.reco2]: expect.arrayContaining(['affinity']) });
      }
    }, 60_000);
  }

  // R-P64 (the P06 delivery review's D-1, probe B.take2). The S1 world with the layout slot's take at 2: the slot
  // declared as layoutSlot() declares it with only `take` overridden to 2, everything else of the world as S1 has
  // it. The baseline take is [grid.1, reco.1], the shadow take [editorial.1, reco.2]: grid.1 and reco.1 leave the
  // take in the shadow, a shadow position that differs from their baseline position, so S3 names them, each with
  // every term that moved it down (R-P56 as amended and R-P57: the same threshold, the fixed order).
  // Derivation of their terms. The modules that passed grid.1 (baseline 1) and reco.1 (baseline 2) are the shadow
  // take's editorial.1 (baseline 4) and reco.2 (baseline 3), the same two that pass them at the slot's own take, and
  // no module's score depends on the take. Taken together, editorial.1 and reco.2 lead each of them on affinity
  // (both carry the line the shopper viewed; grid.1 carries only the two categories at weight 0.5, reco.1 a line
  // the shopper never viewed) and on the lift (editorial.1's frozen 2 at γ 1 against no lift on either, half of
  // editorial.1's base on average, far above the 0.0005 grain). The slot weighs tags only and declares no stage,
  // freshness, fatigue or merchandising rule, so no other term separates them: each is named affinity and lift, in
  // the fixed order, exactly as S3's world names them at take 4 (the control below). editorial.1 and reco.2 keep
  // the terms S3 names for them: the modules they pass are the same at both takes.
  const TAKE_TWO = declaredSlots([layoutSlot({ take: 2 }), recentSlot()]);
  const S3_TERMS: Record<string, string[]> = {
    [M.editorial]: ['affinity', 'lift'], [M.grid]: ['affinity', 'lift'], [M.reco1]: ['affinity', 'lift'], [M.reco2]: ['affinity'],
  };
  const S3_NAMED = Object.keys(S3_TERMS).sort();
  const termsOf = (r: DecisionRecord) => (ex(r).shadowTerms ?? {}) as Record<string, unknown>;
  for (const host of HOSTS) {
    it(`host (${host}): R-P64 — at a take of 2 the record names each module of the baseline take that the shadow pushes out of its take, with each term that moved it down, beside the modules the shadow brings in`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: TAKE_TWO, learn: dials({ gamma: 0, ...frozen(M.editorial) }) });
      expectPublished(m, 'P06.S3 (R-P64) — the declared layout slot at a take of 2, at γ 0 with editorial.1’s lift frozen at 2, publishes');
      const records = await layoutRecords(m, await tabby(m));
      expect(records.map(r => r.item_id), `${host}: PRECONDITION — at γ 0 the take of 2 serves the shopper's interests and the lift moves nothing`)
        .toEqual(SERVED_AT_ZERO.slice(0, 2));
      expect(records.map(r => [r.item_id, ex(r).baselineOrder ?? null, ex(r).shadowOrder ?? null]),
        `${host}: PRECONDITION — each record carries the baseline take [grid.1, reco.1] and the shadow take [editorial.1, reco.2] (P06.S1 cut at the take)`)
        .toEqual(records.map(r => [r.item_id, BASELINE.slice(0, 2), SHADOW_AT_ONE.slice(0, 2)]));
      expect.soft(records.map(r => [r.item_id, Object.keys(termsOf(r)).sort()]),
        `${host}: P06.S3 (R-P64) — grid.1 (baseline 1) and reco.1 (baseline 2), pushed out of the shadow's take, are named beside editorial.1 and reco.2, which the shadow brings in`)
        .toEqual(records.map(r => [r.item_id, S3_NAMED]));
      expect.soft(records.map(r => [r.item_id, termsOf(r)]),
        `${host}: P06.S3 (R-P64) — editorial.1 and reco.2, which passed grid.1 and reco.1, lead them taken together on affinity and on editorial.1's lift: grid.1 and reco.1 named affinity and lift; editorial.1 affinity and lift, reco.2 affinity, as S3 names them`)
        .toEqual(records.map(r => [r.item_id, S3_TERMS]));
    }, 60_000);

    it(`host (${host}): control (R-P64) — at the slot's own take, every module in both takes, the record names exactly the modules whose shadow position differs from their baseline position, with the same terms`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: dials({ gamma: 0, ...frozen(M.editorial) }) });
      expectPublished(m, 'P06.S3 control — the declared layout slot at γ 0 with editorial.1’s lift frozen at 2 publishes');
      const records = await layoutRecords(m, await tabby(m));
      expect(records.map(r => [r.item_id, ex(r).baselineOrder ?? null, ex(r).shadowOrder ?? null]), `${host}: PRECONDITION — the baseline and the shadow of S1 on each record`)
        .toEqual(records.map(r => [r.item_id, BASELINE, SHADOW_AT_ONE]));
      const differing = BASELINE.filter(id => SHADOW_AT_ONE.indexOf(id) !== BASELINE.indexOf(id)).sort();
      expect(records.map(r => [r.item_id, Object.keys(termsOf(r)).sort()]), `${host}: P06.S3 control — exactly the modules whose shadow position differs from their baseline position are named`)
        .toEqual(records.map(r => [r.item_id, differing]));
      expect(records.map(r => [r.item_id, termsOf(r)]), `${host}: P06.S3 control — the same terms the take of 2 names`)
        .toEqual(records.map(r => [r.item_id, S3_TERMS]));
    }, 60_000);

    it(`host (${host}): lock M5 — the keys of shadowTerms are sorted, in a world whose moved modules in shadow order (editorial.1, reco.2, grid.1, reco.1) are not in sorted order`, async () => {
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: dials({ gamma: 0, ...frozen(M.editorial) }) });
      expectPublished(m, 'P06.S3 lock M5 — the declared layout slot at γ 0 with editorial.1’s lift frozen at 2 publishes');
      const records = await layoutRecords(m, await tabby(m));
      expect(records.map(r => ex(r).shadowOrder ?? null), `${host}: PRECONDITION — the shadow of S1 on each record`).toEqual(records.map(() => SHADOW_AT_ONE));
      expect(records.map(r => [r.item_id, Object.keys(termsOf(r))]), `${host}: P06.S3 lock M5 — shadowTerms carries its keys sorted (R-P7; kit 03, "keys sorted")`)
        .toEqual(records.map(r => [r.item_id, S3_NAMED]));
    }, 60_000);
  }
});

// ===========================================================================
// unit:P06.S4 — recording the shadow changes nothing served, counted or credited
// ===========================================================================

describe('unit:P06.S4', () => {
  const terms = (decisions: Array<Record<string, unknown>>) => decisions.filter(d => d.slot === LAYOUT)
    .map(({ decisionId: _d, renderOffer: _r, ...rest }) => { void _d; void _r; return rest; });
  for (const host of HOSTS) {
    it(`host (${host}): the served decisions, the exposures and the credits of a layout decision with its shadow equal, term for term, those of the same decision on the slot without a shadow`, async () => {
      const learn = dials({ gamma: 0, ...frozen(M.editorial) });
      const undeclared = { version: 'parity-p06-undeclared', governanceVersion: 3, pages: { pdp: [{ ...layoutSlot(), layout: undefined }, recentSlot()].map(s => JSON.parse(JSON.stringify(s))) } };
      const out: Record<string, { terms: unknown; n: Record<string, number>; s: Record<string, number> }> = {};
      for (const [name, slots] of [['without a shadow', undeclared], ['with its shadow', SLOTS]] as const) {
        const m = await mount(host, { pieces: MODULES, slots, retainedSlots: name === 'without a shadow', learn });
        expectPublished(m, `P06.S4 — the layout ${name} publishes`);
        const s = await tabby(m);
        const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(name === 'with its shadow' ? 'p06-s4-shadow' : 'p06-s4-plain') });
        expect(page.status, `${host}: PRECONDITION — her page is answered (${name}): ${JSON.stringify(page.body).slice(0, 300)}`).toBe(200);
        const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
        expect(layout.length, `${host}: PRECONDITION — the layout is served (${name})`).toBe(4);
        for (const d of layout) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
        expect((await s.click(page, layout[0]!)).status, `${host}: her click is accepted`).toBe(200);
        await m.drainLedger();
        const counts = await learned(m);
        out[name] = { terms: terms(page.decisions as unknown as Array<Record<string, unknown>>), n: rounded(counts, 'n'), s: rounded(counts, 's') };
      }
      expect(out['with its shadow'], `${host}: P06.S4 — served, counted and credited exactly as without the shadow`).toEqual(out['without a shadow']);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P06.S5 — replay; retained records; the shadow p refusal; the kit
// ===========================================================================

describe('unit:P06.S5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a decision with a shadow replays equal with the baseline and the shadow reproduced, and a decision without one replays equal as before`, async () => {
      const replays = async (m: Mounted, s: Shopper) => {
        const set = await servePage(m, s, 'pdp', { offer: false });
        await toLedger(m, set.records);
        const out: unknown[][] = [];
        for (const r of storedDecisions(m, s.subject).filter(x => x.slot === LAYOUT)) {
          const replay = await replayOf(m, r.decision_id);
          const again = ex(replay.body.replayed as DecisionRecord | undefined);
          out.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null,
            JSON.stringify([again.baselineOrder ?? null, again.shadowOrder ?? null, again.shadowTerms ?? null]) === JSON.stringify([ex(r).baselineOrder ?? null, ex(r).shadowOrder ?? null, ex(r).shadowTerms ?? null])]);
        }
        return out;
      };
      // Served-v1 and without the durable recovery path: the replay reads what the real producer and consumer wrote.
      const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: dials({ gamma: 0, ...frozen(M.editorial) }, 'served-v1') }, { recovery: false });
      expectPublished(m, 'P06.S5 — the declared layout slot publishes');
      const s = await tabby(m);
      const withShadow = await replays(m, s);
      const records = storedDecisions(m, s.subject).filter(x => x.slot === LAYOUT);
      expect.soft(records.map(r => ex(r).shadowOrder ?? null), `${host}: P06.S5 — the stored records carry the shadow`).toEqual(records.map(() => SHADOW_AT_ONE));
      expect.soft(withShadow, `${host}: P06.S5 — each replays equal, the baseline, the shadow and its terms reproduced`).toEqual(withShadow.map(([id]) => [id, 200, 'equal', true]));

      const undeclared = { version: 'parity-p06-retained', governanceVersion: 3, pages: { pdp: [{ ...layoutSlot(), layout: undefined }, recentSlot()].map(x => JSON.parse(JSON.stringify(x))) } };
      const before = await mount(host, { pieces: MODULES, slots: undeclared, retainedSlots: true, learn: dials({ gamma: 0, ...frozen(M.editorial) }, 'served-v1') }, { recovery: false });
      expectPublished(before, 'P06.S5 — a retained slots document without a layout reads');
      const plain = await replays(before, await tabby(before));
      expect(plain.map(([id, status, classification]) => [id, status, classification]), `${host}: P06.S5 — a decision without a shadow replays equal as before`)
        .toEqual(plain.map(([id]) => [id, 200, 'equal']));
    }, 60_000);
  }

  it('logic: publication refuses a shadow p outside 0 to 1 with an error naming it, and admits and keeps one inside', () => {
    const blend = (shadowP: number) => learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', blend: { p: 0, shadowP } } });
    const admitted = validateLearnConfig(blend(0.2));
    expect.soft(admitted.ok ? 'admitted' : (admitted as { errors: string[] }).errors.join('; '), 'P06.S5 — a shadow p of 0.2 is admitted').toBe('admitted');
    expect.soft((admitted as { value?: { slots?: Record<string, Record<string, unknown>> } }).value?.slots?.[LAYOUT]?.blend, 'P06.S5 — and kept').toEqual({ p: 0, shadowP: 0.2 });
    const named = (shadowP: number) => { const checked = validateLearnConfig(blend(shadowP)); return checked.ok ? [] : checked.errors; };
    expect([-0.1, 1.5].map(v => [v, named(v).some(e => e.includes('shadowP'))]), `P06.S5 — a shadow p outside 0..1 is refused naming shadowP (${JSON.stringify([named(-0.1), named(1.5)])})`)
      .toEqual([[-0.1, true], [1.5, true]]);
  });

  it('logic: the API reference and the payload schemas each document the baseline and shadow members', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'baselineOrder: the configured order for the context, else catalogue order', test: s => /baselineOrder/.test(s) && /configured order|catalogue order/i.test(s) },
      { name: 'shadowOrder: every term applied, the learned term at full trust', test: s => /shadowOrder/.test(s) && /(γ|gamma|trust)/i.test(s) },
      { name: 'shadowTerms: the terms that would have moved each module', test: s => /shadowTerms/.test(s) && /\bterms?\b/.test(s) },
      { name: 'shadowP on a blend slot, 0.1 by default', test: s => /shadowP/.test(s) && /0\.1|10 ?(%|percent)/.test(s) },
    ]);
    expect(missing, 'P06.S5 — the kit documents the baseline and shadow members').toEqual([]);
  });

  // Locks for the review's uncovered mutants M9a, M9b and M10 (R-P64), green at 9dccd05c: replay compares each of
  // the three members by value, and a record written without them (as before P06) replays without them, adding no
  // replay marker (R-P23 C11). The stored record is rewritten in the ledger the replay route reads.
  const stored = async (m: Mounted) => {
    const s = await tabby(m);
    await toLedger(m, (await servePage(m, s, 'pdp', { offer: false })).records);
    return storedDecisions(m, s.subject).filter(x => x.slot === LAYOUT).sort((a, b) => a.position - b.position);
  };
  const rewrite = (m: Mounted, decisionId: string, edit: (explain: Record<string, unknown>) => void) => {
    for (const [key, raw] of m.storage.objects) {
      if (!key.includes('/decision/') || !key.endsWith('.ndjson')) continue;
      m.storage.objects.set(key, raw.split('\n').filter(Boolean).map(line => {
        const r = JSON.parse(line) as DecisionRecord;
        if (r.decision_id === decisionId) edit(r.explain as unknown as Record<string, unknown>);
        return JSON.stringify(r);
      }).join('\n') + '\n');
    }
  };
  const replayWorld = async (host: (typeof HOSTS)[number]) => {
    const m = await mount(host, { pieces: MODULES, slots: SLOTS, learn: dials({ gamma: 0, ...frozen(M.editorial) }, 'served-v1') }, { recovery: false });
    expectPublished(m, 'P06.S5 replay locks — the declared layout slot publishes');
    return m;
  };
  for (const host of HOSTS) {
    it(`host (${host}): locks M9a and M9b — a stored record whose baselineOrder, shadowOrder or shadowTerms differs from what replay reproduces replays as a difference naming that member`, async () => {
      const m = await replayWorld(host);
      const records = await stored(m);
      expect(records.map(r => [r.item_id, ex(r).shadowOrder ?? null, Object.keys((ex(r).shadowTerms ?? {}) as object).includes(M.editorial)]),
        `${host}: PRECONDITION — the four stored layout records carry the shadow, and terms naming editorial.1`)
        .toEqual(SERVED_AT_ZERO.map(id => [id, SHADOW_AT_ONE, true]));
      const edits: Array<[string, (e: Record<string, unknown>) => void]> = [
        ['explain.baselineOrder', e => { e.baselineOrder = [...(e.baselineOrder as string[])].reverse(); }],
        ['explain.shadowOrder', e => { e.shadowOrder = [...(e.shadowOrder as string[])].reverse(); }],
        ['explain.shadowTerms', e => { const terms = { ...(e.shadowTerms as Record<string, string[]>) }; delete terms[M.editorial]; e.shadowTerms = terms; }],
      ];
      const out: unknown[][] = [];
      for (const [k, [field, edit]] of edits.entries()) {
        rewrite(m, records[k]!.decision_id, edit);
        const replay = await replayOf(m, records[k]!.decision_id);
        out.push([field, replay.status, replay.body.classification ?? replay.body.reason ?? null, ((replay.body.diff ?? []) as Array<{ field?: string }>).map(d => d.field ?? null)]);
      }
      expect(out, `${host}: P06.S5 locks M9a and M9b — each member compared by value, a difference named by its field`)
        .toEqual(edits.map(([field]) => [field, 200, 'explanation', [field]]));
    }, 60_000);

    it(`host (${host}): lock M10 — a stored record of a declared layout slot without the three members, as written before P06, replays equal, without them and with no new replay marker`, async () => {
      const m = await replayWorld(host);
      const records = await stored(m);
      const target = records[0]!;
      expect(['baselineOrder', 'shadowOrder', 'shadowTerms'].filter(k => k in ex(target)), `${host}: PRECONDITION — the stored record carries the three members before they are removed`)
        .toEqual(['baselineOrder', 'shadowOrder', 'shadowTerms']);
      rewrite(m, target.decision_id, e => { delete e.baselineOrder; delete e.shadowOrder; delete e.shadowTerms; });
      const replay = await replayOf(m, target.decision_id);
      const again = replay.body.replayed as DecisionRecord | undefined;
      const markers = (r: DecisionRecord | undefined) => Object.keys(((r?.inputs ?? {}) as unknown as { replay?: Record<string, unknown> }).replay ?? {}).sort();
      expect([replay.status, replay.body.classification ?? replay.body.reason ?? null, ['baselineOrder', 'shadowOrder', 'shadowTerms'].filter(k => k in ex(again)), markers(again)],
        `${host}: P06.S5 lock M10 — replays equal without the members, the replay markers those it was written with`)
        .toEqual([200, 'equal', [], markers(target)]);
    }, 60_000);
  }
});
