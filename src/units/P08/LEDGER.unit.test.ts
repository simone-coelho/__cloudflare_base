// src/units/P08/LEDGER.unit.test.ts
// P08 under the Closure Ledger: the tests for the LOCAL criteria of the P08 work
// order (`tapestry-parity-build`, ticket P08 "A module on several pages, pooled
// once, with the page as context"). DC1 (D1) and DC2 (D2) are ruled below and
// exercised in Q1-Q5; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P08.<criterion>')` per LOCAL criterion. Expected values
// come from the witnesses, never from what the engine answers today:
//   · the work order's authority (docs/BTI-Parity-Build-Tickets.md, P08 in
//     section A): "a module ID that appears on two pages can accumulate one
//     evidence record per context, with the page as a context dimension, as an
//     explicit, declared policy"; it "must not undo" W26 R2, which made the page
//     part of the storage identity so nothing pools silently;
//   · the parity document, section 9 item 3 (cited by number only): keep the
//     page out of the module ID so its evidence pools once, and let the page be
//     context;
//   · freeze sheet item 27 (D1: pooling is declared per module in the
//     catalogue; D2: the page enters the ladder after everyone under a W25
//     grammar version bump; W26 R2 untouched);
//   · the existing contract the work order cites: src/learn/fan.ts:92-125 (W26
//     R2), src/content/kinds.ts:483-485 (pageScopedSlotNames), src/learn/stats.ts:36-50
//     (evidence per slot, item and cell; no page level), src/learn/priors.ts
//     CELL_GRAMMAR (version 2, refusing another).
//
// THE READINGS THIS FILE RULES:
//   DECLARATION (D1). A catalogue piece may carry `pooled: true`. The catalogue
//     validator keeps it, and refuses any other value naming `pieces[i].pooled`.
//   ONE RECORD. A pooled module's exposures and credits, wherever it is served
//     (on every page and every slot that names it — a new slots document cannot
//     reuse one slot name on two pages, src/content/kinds.ts:422-428, so Tapestry's
//     module on two pages is one module id in two slots), accumulate in ONE
//     record. Its keys are `*` (everyone), then `p=<page>`, then the page with
//     today's levels: `p=<page>|c=…`, `p=<page>|c=…|v=…` and so on. The operator's
//     lift route for EITHER placement answers that record for the module
//     (`snapshot.items[module]`), and every decision on the module, on either
//     page, reads its lift from it; the record's `explain.lift.level_words` names
//     the page level `page`.
//   GRAMMAR (D2). `CELL_GRAMMAR.version` is 3; `CELL_GRAMMAR.order` stays
//     today's (c, v, s, r, a) so every undeclared cell is read as today, and
//     `CELL_GRAMMAR.pooledOrder` is ['p', …order]. A prior document declaring
//     version 3 may name a pooled module's cell `p=<page>…`; one declaring version
//     2 is refused with the migration named, as the check does today.
//   UNDECLARED (W26 R2 untouched). An undeclared module's evidence stays where it
//     is today: per slot, and for a retained slot name on two pages per page
//     (`slot@page`), never in a pooled record. A pooled module served under such
//     a retained cross-page name still pools: one record for both pages (Q3).
//   Q4's FORM (R-P37). The host leg asserts the answering level and n together
//     with the product page's own evidence below nMin (one product-page round,
//     three home rounds): ['everyone', 4]. Chosen because the leg's observable is
//     that the decision "reads the one record": only a level that pools both
//     pages proves it, while with three product-page rounds the page level
//     answers with that page's own three exposures (Q2's ladder), which a
//     page-scoped record holds as well.
//
// NO NEW EXPORT IS IMPORTED. `pooled`, `pooledOrder` and the page level are read
// loosely. The slots here are undeclared content slots of governance 3 (pooling
// does not depend on a layout declaration), so no unit waits on P02.
//
// HARNESS: src/units/_parity.ts (both shopper hosts; real acknowledgements and
// clicks into the real ledger and fan; the operator's lift and priors routes).
// The replay clause uses a served-v1 copy whose exposures reach the statistics
// through the real fan-in (`fanDecisions`, the idiom of src/units/_parity2.ts
// in S2) and whose composed records reach the ledger through the real producer
// and consumer (`toLedger`): acknowledged records with a lift replay as
// `explanation` today for the key-order defect R-P3, which no P08 clause is about.
//
// R10 (tests that lock present behaviour, listed for the lead):
//   · src/units/W25/B1.unit.test.ts:451, :478, :489, :496-499, :524 derive the
//     grammar from CELL_GRAMMAR (version − 1, `order`); they hold under version
//     3 only because `order` keeps today's five keys and the page order is a
//     separate member — a builder who puts `p` into `order` breaks :496-499.
//   · src/units/W26/LEDGER.unit.test.ts:429-631 (unit:W26.R2) asserts the
//     retained cross-page hero's two page objects for undeclared pieces; Q3
//     below asserts the same for an undeclared module beside a pooled one.
//   · src/content/kinds.ts:426 refuses a new slots document reusing a slot name
//     across pages; P08 keeps that rule (two slots, one module id).

import { describe, expect, it } from 'vitest';

import { validateContentCatalog } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { Cell, DecisionRecord } from '@/content/types';
import { CELL_GRAMMAR, PRIORS_KIND } from '@/learn/priors';
import { fanDecisions, statsName } from '@/learn/fan';
import { DEFAULT_STATS } from '@/learn/stats';
import { ts36 } from '@/ledger/records';
import { captureRetention } from '@/retention';

import {
  asOperator, BRAND, DIRECT_ENTRY, expectPublished, HOSTS, mount, PAID_SOCIAL_ENTRY, pageInstanceOf, replayOf, servePage, shopperOn,
  storedDecisions, TENANT, toLedger, VIEW_TABBY_26, type Host, type Mounted,
} from '../_parity';
import { missingStatements, publishStats } from '../_parity3';

const PDP_MODULES = 'pdp-modules', HOME_MODULES = 'home-modules';
/** A newsletter click: a third entry channel beside paid social and direct (src/services/visit.ts). */
const EMAIL_ENTRY = { utmMedium: 'email', utmSource: 'newsletter' };
/** Module ids with the page kept out of them (parity §9 item 3). */
const POOLED = 'module.complete-the-look.1', SHARED = 'module.reviews.1', PDP_ONLY = 'module.size-guide.1', HOME_ONLY = 'module.category-grid.1';
const module_ = (id: string, type: string, slotTypes: string[], over: Record<string, unknown> = {}) => ({ id,
  customerContentId: `TAP-${id.replace(/^module\./, '').replace(/\./g, '-').toUpperCase()}`, type, title: type, tags: { line: ['Tabby'] },
  slotTypes, journeyStageFit: ['considering'], lifecycle: { status: 'live' }, ...over });
const PIECES = [
  module_(POOLED, 'complete-the-look', [PDP_MODULES, HOME_MODULES], { pooled: true }),
  module_(SHARED, 'reviews', [PDP_MODULES, HOME_MODULES]),
  module_(PDP_ONLY, 'size-guide', [PDP_MODULES]),
  module_(HOME_ONLY, 'category-grid', [HOME_MODULES]),
];
const SLOTS = { version: 'parity-p08-slots', governanceVersion: 3, pages: {
  pdp: [{ slot: PDP_MODULES, take: 3, weights: { line: 1 } }], home: [{ slot: HOME_MODULES, take: 3, weights: { line: 1 } }] } };
const STATS = { ...DEFAULT_STATS, nMin: 2 };
const learnOf = (basis: 'served-v1' | 'rendered-v1') => ({ version: 'parity-p08-learn', holdout: { share: 0, salt: 'parity', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 }, stats: STATS,
  slots: { [PDP_MODULES]: { measurementBasis: basis, reward: 'click', gamma: 1 }, [HOME_MODULES]: { measurementBasis: basis, reward: 'click', gamma: 1 } } });

async function world(host: Host, basis: 'served-v1' | 'rendered-v1' = 'rendered-v1', slots: unknown = SLOTS, retainedSlots = false): Promise<Mounted> {
  const m = await mount(host, { pieces: PIECES, slots, learn: learnOf(basis), retainedSlots }, basis === 'served-v1' ? { recovery: false } : {});
  expectPublished(m, 'P08 — the catalogue declaring the pooled module, the two pages and the learn document publish');
  return m;
}

/** One shopper visit to a page: the shopper views a Tabby bag, the page is served and acknowledged in full, and the shopper clicks the pooled and the shared module. */
async function visit(m: Mounted, page: 'pdp' | 'home', entry: Record<string, string> = PAID_SOCIAL_ENTRY) {
  const s = await shopperOn(m);
  expect((await s.action(VIEW_TABBY_26, entry)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  const served = await s.snapshot(page, { pageInstance: pageInstanceOf(`p08-${page}`) });
  expect(served.decisions.map(d => d.contentId), `${m.host}: PRECONDITION — the ${page} slot serves the pooled and the shared module`).toEqual(expect.arrayContaining([POOLED, SHARED]));
  for (const d of served.decisions) expect((await s.ack(served, d)).status, `${m.host}: PRECONDITION — ${d.contentId} acknowledged`).toBe(200);
  for (const id of [POOLED, SHARED]) {
    const click = await s.click(served, served.decisions.find(d => d.contentId === id)!);
    expect(click.status, `${m.host}: PRECONDITION — the shopper's click on ${id} is accepted`).toBe(200);
  }
  await m.drainLedger();
  return s;
}

type Row = { n: number; s: number };
/** The record the operator's lift route answers for a module on one placement (`snapshot.items[module]`, by key). */
async function recordOn(m: Mounted, slot: string, item: string): Promise<Record<string, Row>> {
  await publishStats(m);
  const read = await asOperator(m, 'GET', `/v1/${TENANT}/lift?slot=${slot}`);
  expect(read.status, `PRECONDITION: the lift route answers for ${slot} (${JSON.stringify(read.body).slice(0, 200)})`).toBe(200);
  const items = ((read.body.snapshot as { items?: Record<string, Record<string, Row>> } | null)?.items ?? {});
  return items[item] ?? {};
}
const counts = (record: Record<string, Row>, key: string) => [Math.round(record[key]?.n ?? 0), Math.round(record[key]?.s ?? 0)];

/** The lift a fresh shopper's acknowledged decision on a page reads for a module. */
async function liftFor(m: Mounted, page: 'pdp' | 'home', item: string) {
  // The decision path holds a lift snapshot for a while (src/content/service.ts); the reader arrives after it has refreshed.
  invalidateLiftCache();
  const s = await shopperOn(m);
  await s.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY);
  const served = await s.snapshot(page, { pageInstance: pageInstanceOf(`p08-read-${page}`) });
  const d = served.decisions.find(x => x.contentId === item)!;
  expect(d, `${m.host}: PRECONDITION — ${item} is served on ${page}`).toBeTruthy();
  expect((await s.ack(served, d)).status).toBe(200);
  await m.drainLedger();
  return (storedDecisions(m, s.subject).find(r => r.item_id === item)?.explain.lift ?? null) as (Record<string, unknown> & { n?: number; level_words?: string }) | null;
}

// ===========================================================================
// unit:P08.Q1 — one evidence record across the pages, read on either page
// ===========================================================================

describe('unit:P08.Q1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D1 — the module the catalogue declares pooled, served on the product page and the home page, accumulates its exposures and credits in one record that the lift route answers for either placement and that either page's decision reads its lift from, while the undeclared module keeps one record per placement`, async () => {
      const m = await world(host);
      // Two visits to the product page, one to the home page: each acknowledges every module and clicks the pooled and the shared one.
      await visit(m, 'pdp');
      await visit(m, 'pdp');
      await visit(m, 'home');
      for (const [slot, own] of [[PDP_MODULES, 2], [HOME_MODULES, 1]] as const) {
        expect.soft(counts(await recordOn(m, slot, POOLED), '*'), `${host}: P08.Q1 — on ${slot}, the pooled module's record holds both pages' exposures and clicks`).toEqual([3, 3]);
        expect.soft(counts(await recordOn(m, slot, SHARED), '*'), `${host}: P08.Q1 — on ${slot}, the undeclared module's record holds only that placement's`).toEqual([own, own]);
      }
      // nMin 2, and decay keeps a placement's two exposures just under 2: only the record holding all three reaches it.
      for (const page of ['pdp', 'home'] as const) {
        const lift = await liftFor(m, page, POOLED);
        expect.soft(lift?.n === undefined ? lift : Math.round(lift.n), `${host}: P08.Q1 — the ${page} decision reads the pooled module's lift from the one record (n 3 at everyone)`).toBe(3);
      }
    });
  }
});

// ===========================================================================
// unit:P08.Q2 — the page is a ladder level directly after everyone
// ===========================================================================

describe('unit:P08.Q2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D2 — in the pooled record each page's evidence answers at the page level and pools at everyone, under a cell-grammar version bumped from 2`, async () => {
      const m = await world(host);
      // Three product-page visits from three channels, so no channel cell under the page reaches nMin and the page level must answer.
      await visit(m, 'pdp', PAID_SOCIAL_ENTRY);
      await visit(m, 'pdp', DIRECT_ENTRY);
      await visit(m, 'pdp', EMAIL_ENTRY);
      await visit(m, 'home');
      const record = await recordOn(m, PDP_MODULES, POOLED);
      expect.soft([counts(record, '*')[0], counts(record, 'p=pdp')[0], counts(record, 'p=home')[0]],
        `${host}: P08.Q2 — the record carries everyone (4), then the page: p=pdp (3) and p=home (1) (keys: ${Object.keys(record).join(', ')})`).toEqual([4, 3, 1]);
      const pdp = await liftFor(m, 'pdp', POOLED);
      expect.soft([pdp?.level_words ?? null, Math.round(pdp?.n ?? -1)], `${host}: P08.Q2 — on the product page, whose own evidence reaches nMin, the page level answers`).toEqual(['page', 3]);
      const home = await liftFor(m, 'home', POOLED);
      expect.soft([home?.level_words ?? null, Math.round(home?.n ?? -1)], `${host}: P08.Q2 — on the home page, whose own does not, everyone answers with both pages pooled`).toEqual(['everyone', 4]);
    });
  }

  it('logic: decision D2 — the cell grammar is version 3, today\'s order is kept for undeclared cells and the pooled order puts the page directly after everyone', () => {
    expect(CELL_GRAMMAR.version, 'P08.Q2 — the grammar version is bumped from 2').toBe(3);
    expect([...CELL_GRAMMAR.order], 'P08.Q2 — LOCKED: an undeclared cell keeps today\'s order (W25)').toEqual(['c', 'v', 's', 'r', 'a']);
    expect((CELL_GRAMMAR as unknown as { pooledOrder?: readonly string[] }).pooledOrder, 'P08.Q2 — a pooled module\'s order has the page first').toEqual(['p', 'c', 'v', 's', 'r', 'a']);
  });
});

// ===========================================================================
// unit:P08.Q3 — an undeclared module keeps W26 R2's page-scoped identity
// ===========================================================================

describe('unit:P08.Q3', () => {
  /** A RETAINED slots document carrying one slot name on two pages: the case W26 R2 page-scopes. */
  const RETAINED = { version: 'parity-p08-retained', governanceVersion: 3, pages: { pdp: [{ slot: 'modules', take: 3, weights: { line: 1 } }], home: [{ slot: 'modules', take: 3, weights: { line: 1 } }] } };
  const retainedPieces = PIECES.map(p => ({ ...p, slotTypes: ['modules'] }));
  for (const host of HOSTS) {
    it(`host (${host}): LOCKED (unit:W26.R2) — beside a pooled module, an undeclared module on a retained slot name carried on two pages keeps one statistics object, snapshot and lift table per page; and the pooled module pools under that retained cross-page name`, async () => {
      const m = await mount(host, { pieces: retainedPieces, slots: RETAINED, retainedSlots: true, learn: { ...learnOf('rendered-v1'), slots: { modules: { measurementBasis: 'rendered-v1', reward: 'click', gamma: 1 } } } });
      expectPublished(m, 'P08.Q3 — the retained cross-page document reads');
      for (const page of ['pdp', 'home'] as const) {
        const s = await shopperOn(m);
        await s.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY);
        const served = await s.snapshot(page, { pageInstance: pageInstanceOf(`p08-q3-${page}`) });
        expect(served.decisions.map(d => d.contentId), `${host}: PRECONDITION — the ${page} page serves the pooled and the undeclared module under the retained name`).toEqual(expect.arrayContaining([POOLED, SHARED]));
        for (const d of served.decisions) expect((await s.ack(served, d)).status).toBe(200);
        await m.drainLedger();
      }
      await publishStats(m);
      for (const page of ['pdp', 'home']) {
        const object = m.stats.get(statsName(TENANT, BRAND, 'modules', page));
        expect(object, `${host}: P08.Q3 — the ${page} page's object exists, as W26 R2 names it`).toBeTruthy();
        const read = await asOperator(m, 'GET', `/v1/${TENANT}/lift?slot=modules&page=${page}`);
        const items = ((read.body.snapshot as { items?: Record<string, Record<string, Row>> } | null)?.items ?? {});
        expect(counts(items[SHARED] ?? {}, '*'), `${host}: P08.Q3 — the undeclared module's ${page} lift table holds that page's exposure only`).toEqual([1, 0]);
      }
      const pageless = m.stats.get(statsName(TENANT, BRAND, 'modules'));
      const snapshot = pageless ? await (await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(statsName(TENANT, BRAND, 'modules'))).fetch('https://learn/snapshot', { method: 'POST' })).json() as { snapshot?: { items?: Record<string, unknown> } | null } : null;
      expect(Object.keys(snapshot?.snapshot?.items ?? {}).includes(SHARED), `${host}: P08.Q3 — the undeclared module never lands in a page-less object`).toBe(false);
      // The pooled module under the same retained cross-page name (R-P37): ONE record holding both pages' exposures,
      // which the lift route answers for either placement.
      for (const page of ['pdp', 'home']) {
        const read = await asOperator(m, 'GET', `/v1/${TENANT}/lift?slot=modules&page=${page}`);
        const items = ((read.body.snapshot as { items?: Record<string, Record<string, Row>> } | null)?.items ?? {});
        expect(counts(items[POOLED] ?? {}, '*'), `${host}: P08.Q3 — under the retained cross-page name, the lift answer for ${page} is the pooled module's one record, holding both pages' exposures`).toEqual([2, 0]);
      }
    });
  }
});

// ===========================================================================
// unit:P08.Q4 — prior import under the bumped grammar; a pooled decision replays
// ===========================================================================

/** Served-v1 exposures of each item on one page's slot, fanned by the real fan-in (src/units/_parity2.ts's ladder, in S2). */
async function exposeThroughFan(m: Mounted, page: 'pdp' | 'home', slot: string, items: string[], times: number) {
  const at = Date.now() - 10 * 60_000;
  const cell: Cell = { channel: 'email', visit_bucket: '4+', region: null, affinity: null, stage: 'late' };
  for (let k = 0; k < times; k++) {
    const visitor = `v-p08-${page}-${k}`;
    const records = items.map((item, position) => ({
      decision_id: `${TENANT}:${ts36(at + k)}:${visitor}:${page}:${slot}:${position}`, tenant: TENANT, brand: BRAND, visitor_id: visitor, session_id: `s-${visitor}`,
      identity_anchor: 'visitor', ts: at + k, page, slot, position, item_id: item, customer_item_id: `TAP-${item}`, candidates: [],
      cell, arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 },
      config_label: 'parity-p08', explain: { drivers: [], score_base: 0.5, score_final: 0.5, lift: null }, measurementBasis: 'served-v1',
      retention: captureRetention(m.env as never, TENANT, at + k, Date.now()),
    } as unknown as DecisionRecord));
    const receipt = await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: visitor, records },
      () => ({ reward: 'click', objective: 'unit', stats: STATS, measurementBasis: 'served-v1' }));
    expect(receipt.ok, `PRECONDITION: the exposures reach the fan-in (${JSON.stringify(receipt).slice(0, 200)})`).toBe(true);
  }
  await publishStats(m);
}

describe('unit:P08.Q4', () => {
  it('logic: prior import reads a pooled module\'s page cell under version 3 and refuses a document declaring version 2 with the migration named', () => {
    const v3 = { name: CELL_GRAMMAR.name, version: 3, order: ['c', 'v', 's', 'r', 'a'] };
    const read = PRIORS_KIND.validate({ cellGrammar: v3, rows: [{ slot: PDP_MODULES, item: POOLED, cell: 'p=pdp', p_prior: 0.2, n_equiv: 50 },
      { slot: PDP_MODULES, item: POOLED, cell: 'p=pdp|c=paid_social', p_prior: 0.25, n_equiv: 50 }] });
    expect(read.ok ? 'read' : (read as { errors: string[] }).errors.join('; '), 'P08.Q4 — a version-3 document naming the pooled module\'s page cells is read').toBe('read');
    const v2 = { name: CELL_GRAMMAR.name, version: 2, order: ['c', 'v', 's', 'r', 'a'] };
    const refused = PRIORS_KIND.validate({ cellGrammar: v2, rows: [{ slot: PDP_MODULES, item: SHARED, cell: 'c=direct', p_prior: 0.2, n_equiv: 50 }] });
    expect(refused.ok ? 'admitted' : (refused as { errors: string[] }).errors.some(e => /cellGrammar/.test(e) && e.includes(CELL_GRAMMAR.migration)) ? 'refused with the migration named' : (refused as { errors: string[] }).errors.join('; '),
      'P08.Q4 — a document declaring the previous grammar (2) is refused with the migration named').toBe('refused with the migration named');
  });

  for (const host of HOSTS) {
    it(`host (${host}): a decision on the pooled module reads the one record and replays exactly`, async () => {
      const m = await world(host, 'served-v1');
      // R-P37's first form: the product page's own evidence (one exposure) stays below nMin 2, the home page's
      // (three) does not, so the ladder of Q2 answers at everyone, where only the one pooled record holds both pages' four.
      await exposeThroughFan(m, 'pdp', PDP_MODULES, [POOLED, SHARED, PDP_ONLY], 1);
      await exposeThroughFan(m, 'home', HOME_MODULES, [POOLED, SHARED, HOME_ONLY], 3);
      const s = await shopperOn(m);
      await s.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY);
      const set = await servePage(m, s, 'pdp', { offer: false }) as unknown as { records: DecisionRecord[] };
      await toLedger(m, set.records);
      const pooled = set.records.find(r => r.item_id === POOLED);
      expect(pooled, `${host}: PRECONDITION — the pooled module is decided on the product page`).toBeTruthy();
      expect([pooled?.explain.lift?.level_words ?? null, Math.round(pooled?.explain.lift?.n ?? -1)],
        `${host}: P08.Q4 — the product page's own evidence is below nMin, so its lift is read at everyone from the one record (four exposures over both pages)`).toEqual(['everyone', 4]);
      const replay = await replayOf(m, pooled!.decision_id);
      expect([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P08.Q4 — the pooled decision replays equal (${JSON.stringify(replay.body.reason ?? replay.body.diff ?? '').slice(0, 200)})`).toEqual([200, 'equal']);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P08.Q5 — publication refuses a malformed declaration; the kit
// ===========================================================================

describe('unit:P08.Q5', () => {
  it('logic: decision D1 — the catalogue validator keeps a pooling declaration and refuses a malformed one naming pieces[i].pooled', () => {
    const kept = validateContentCatalog({ pieces: PIECES });
    expect(kept.ok, `PRECONDITION: the catalogue is admitted (${JSON.stringify(kept).slice(0, 200)})`).toBe(true);
    expect((kept as unknown as { value: { pieces: Array<Record<string, unknown>> } }).value.pieces[0]?.pooled, 'P08.Q5 — the declaration is kept on the module').toBe(true);
    for (const value of ['yes', 1, {}, null]) {
      const refused = validateContentCatalog({ pieces: [{ ...PIECES[0], pooled: value }] });
      expect.soft(refused.ok ? 'admitted' : (refused as { errors: string[] }).errors.some(e => e.startsWith('pieces[0].pooled')) ? 'refused by name' : (refused as { errors: string[] }).errors.join('; '),
        `P08.Q5 — pooled: ${JSON.stringify(value)} is refused naming pieces[0].pooled`).toBe('refused by name');
    }
  });

  for (const host of HOSTS) {
    it(`host (${host}): the catalogue route refuses a malformed pooling declaration by name and keeps the catalogue in force`, async () => {
      const m = await world(host);
      const before = await asOperator(m, 'GET', `/content/catalog?scope=${TENANT}`);
      const base = before.body as { revision: number; publication: { revision: number; digest: string } };
      const refused = await asOperator(m, 'PUT', `/content/catalog?scope=${TENANT}`, { document: { pieces: [{ ...PIECES[0], pooled: 'yes' }, ...PIECES.slice(1)] }, note: 'p08' },
        { 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` });
      expect([refused.status, ((refused.body.errors ?? []) as unknown[]).some(e => String(e).startsWith('pieces[0].pooled'))], `${host}: P08.Q5 — refused (422) naming pieces[0].pooled: ${JSON.stringify(refused.body).slice(0, 200)}`).toEqual([422, true]);
    });
  }

  it('logic: the API reference and the payload schemas document declared pooling and the grammar version', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'pooling is declared per module in the catalogue (pooled: true)', test: t => /pooled/.test(t) && /catalog/i.test(t) && /module|piece/i.test(t) },
      { name: 'a pooled module accumulates one record across the pages it appears on', test: t => /pooled/.test(t) && /one (evidence )?record|pools? once/i.test(t) && /page/i.test(t) },
      { name: 'the page is a ladder level directly after everyone', test: t => /page/i.test(t) && /after everyone|level after|directly after/i.test(t) },
      { name: 'the cell grammar is version 3', test: t => /cellGrammar|cell grammar|ladder-cell/i.test(t) && /version 3|"version": ?3|version: ?3/.test(t) },
      { name: 'an undeclared module keeps its page-scoped storage', test: t => /undeclared|not declared|without the declaration/i.test(t) && /page/i.test(t) },
    ]);
    expect(missing, 'P08.Q5 — the kit documents declared pooling and the grammar version').toEqual([]);
  });
});
