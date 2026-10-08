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
});
