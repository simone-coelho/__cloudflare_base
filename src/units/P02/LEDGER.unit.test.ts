// src/units/P02/LEDGER.unit.test.ts
// P02 under the Closure Ledger: the tests for the LOCAL criteria of the frozen
// P02 work order (`tapestry-parity-build`, ticket P02 "Modules as items in a
// layout slot"). DC1 (decision D1) is ruled and exercised inside A3 (a host leg
// and a host-internal leg, see RESIDUAL); LV1 and LV2 are deferred live rows and
// get no test.
//
// One `describe('unit:P02.<criterion>')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the work order's authority (docs/BTI-Parity-Build-Tickets.md, P02 in
//     section A, amended 2026-10-07): "modules are registered with their ID,
//     kind and journey stages. A page's layout is declared as one slot of K
//     positions over M ≥ K registered modules. The decision returns up to K
//     module IDs in ranked order, with eligibility, exclusions and
//     de-duplication applied; a module not returned is not drawn, and layout
//     slots are measured on rendered-v1 so a module that is not drawn is not an
//     exposure";
//   · the investigation, section G-B (C1) and G-A (per module: "P02's three
//     fields map onto existing piece fields: the identifier, the kind as `type`
//     … the journey stages as `journeyStageFit`"), and G-C (C6: "its list is the
//     sequence, and a `take` below the number of eligible modules is the
//     selection");
//   · freeze sheet item 16 (decision D1): a declared layout slot is captured
//     only when its learn basis is rendered-v1; otherwise it is served without
//     exposure and the decision set names the mismatch;
//   · the parity document, sections 3.3 and 3.10 (cited by number only);
//   · the existing contract the work order cites: `src/content/kinds.ts:86`
//     (type required), `:263` (take 1..50), `:382` (governance versions 1-3),
//     `src/reflex/contentCompose.ts:252, 271, 316-339`, `src/content/service.ts:126,
//     165, 589, 652-653`, `src/learn/replay.ts:151-155`.
//
// THE READINGS THIS FILE RULES, ONE PER CRITERION:
//   A1  A module is a catalogue piece; its kind is `type`, its journey stages
//       `journeyStageFit`; it is a candidate of the layout slot it names in
//       `slotTypes`. A module without `id` or `type` is refused by the catalogue
//       validator naming `pieces[i].id` / `pieces[i].type` (today's errors, kept).
//   A2  The layout slot is DECLARED: `layout: true` on one slot of a page, in a
//       slots document marked `governanceVersion: 4`. With no signal it returns
//       the first K eligible modules in catalogue order; with signal it returns
//       up to K in score order, ties to catalogue order — never an excluded
//       (`excludedPieceIds`), ineligible (expired, window closed) or
//       already-served (reserved by another slot of the page) module.
//   A3  On rendered-v1, exposure follows the render acknowledgement: a returned
//       module acknowledged once or twice is one exposure; a returned module not
//       acknowledged, and a module not returned, are none. D1: on served-v1 a
//       declared layout slot is served without a render offer and is never
//       captured at serve time — measured through the trusted synthetic
//       snapshot, the one production caller whose snapshot with the route's
//       offer is captured (`src/content/service.ts:608-612`), against the same
//       snapshot's served-v1 content slot, which is — and the decision set the
//       route composes with its offer carries `layoutDiagnostics: [{ slot,
//       reason: 'measurement_basis', measurementBasis: 'served-v1' }]`.
//   A4  Publication (`validateSlotCatalog`, the write validator every publish
//       runs) refuses, naming the slot's address: a layout take outside 1..50
//       (`pages.<page>[i].take`), a second `layout: true` slot on one page, and a
//       declaration in a document marked governanceVersion 1, 2 or 3 (the error
//       names `layout` and governance version 4). A RETAINED governance-3
//       document without a declaration decides and replays exactly as before:
//       the first K eligible modules in catalogue order, every decision replays
//       `equal`, and its page manifest carries exactly today's markers.
//   A5  Each of docs/kit/01, 02 and 03 states, in sentences about the layout,
//       (i) the returned list is the layout's sequence, (ii) a module not
//       returned is not drawn and its container stays hidden, (iii) every drawn
//       module is acknowledged.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `layout` on a slot strategy, `governanceVersion: 4`, `layoutDiagnostics` on
// the decision set. No new export is imported.
//
// HARNESS: src/units/_parity.ts — the mounted application in process with the
// real route modules and the real DO classes over storage stubs, on both shopper
// hosts. Documents are read from the tree this file lives in. D1's capture leg
// runs the tenant's internal synthetic monitor (`runSynthetic`) over that
// harness, configured as src/units/W26/LEDGER.unit.test.ts:888 configures it.
//
// RESIDUAL (A3, decision D1 — the naming of the mismatch): the leg that reads
// `layoutDiagnostics` is `host-internal`. The snapshot route answers from an
// explicit member list (`src/routes/decisions.ts:870-887`: decisions, pin
// diagnostics, records only for a trusted synthetic operation, sources) that
// carries no decision-set diagnostic, and `src/routes/decisions.ts` is outside
// P02's allowed paths; so the decision set is read one layer in, composed with
// the offer the route passes (`src/routes/decisions.ts:855-861`). The missing
// public observable is the mismatch on the snapshot answer.

import { AsyncResource } from 'node:async_hooks';

import { describe, expect, it } from 'vitest';

import { configuredOperationalDestinations, SYNTHETIC_BINDINGS } from '@/connectors/config';
import { validateContentCatalog, validateSlotCatalog } from '@/content/kinds';
import { consumeSynthetic, runSynthetic, SYNTHETIC_KIND } from '@/ops/synthetic';

import {
  declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learned, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, putDocument, readTree, recentSlot, replayOf, rounded, RECENT_SLOT, servedIn, servePage, shopperOn, storedDecisions,
  TABBY_VIEWS, TENANT, errorsOf, type Mounted,
} from '../_parity';

/** The declared page: the layout slot first, the recently-viewed slot below it. */
const DECLARED = declaredSlots([layoutSlot(), recentSlot()]);
const DOCUMENTS = { pieces: MODULES, slots: DECLARED, learn: learnDocument() };

/** K = 4. No signal: the first four ELIGIBLE modules in catalogue order (reviews excluded, lookbook expired, recent reserved below, charms closed). */
const COLD_LAYOUT = [M.grid, M.reco1, M.reco2, M.editorial];
/**
 * After three Tabby views (line Tabby, category Handbags, occasion evening — the
 * values the published catalogue names, R64) every value reads a = 3/(3+K),
 * K = 1.8, and the slot weights line 1, category 0.5, occasion 0.5:
 * reco.2 = a + a/2, editorial.1 = a, grid.1 = a/2, reco.1 = ugc.1 = 0 (tie to catalogue order).
 */
const RANKED_LAYOUT = [M.reco2, M.editorial, M.grid, M.reco1];
const NEVER_IN_LAYOUT = [M.reviews, M.lookbook, M.recent, M.charms];

// ---------------------------------------------------------------------------
// D1's capture leg: the tenant's internal synthetic monitor (src/ops/synthetic.ts,
// run by the scheduled monitor), the one caller whose snapshot WITH the route's
// offer is captured at serve time (`trustedSynthetic`, src/content/service.ts:608-612).
// It composes the monitor page `home` through the real snapshot route, so the
// fixture's home page carries a served-v1 content slot FIRST (the record the
// monitor engages, so its own correlation holds) and the declared layout slot,
// measured on served-v1, below it. Configured over this harness the way
// src/units/W26/LEDGER.unit.test.ts:888 (`armSyntheticMonitor`) configures it.
// ---------------------------------------------------------------------------

const HOME_STORY = 'home-story';
const HOME_STORY_PIECE = { id: 'story.home.tabby', customerContentId: 'TAP-STORY-HOME-TABBY', type: 'editorial', title: 'The Tabby, at home',
  tags: { line: ['Tabby'] }, slotTypes: [HOME_STORY], lifecycle: { status: 'live' } };
const MONITOR_DOCUMENTS = {
  pieces: [HOME_STORY_PIECE, ...MODULES],
  slots: { version: 'parity-monitor-slots', governanceVersion: 4, pages: { home: [{ slot: HOME_STORY, take: 1, weights: { line: 1 } }, layoutSlot()] } },
  learn: learnDocument({ [LAYOUT]: { reward: 'click' } }),
};

async function armSyntheticMonitor(m: Mounted) {
  const env = m.env as unknown as Record<string, unknown>;
  const destinations = SYNTHETIC_BINDINGS.map(binding => ({ binding, purpose: 'isolated-synthetic-monitor', namespace: 'ops-synthetic-v1', accessPolicy: 'p02-local-only' }));
  env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { [TENANT]: { telemetry: { environment: 'test', schema: 'ops-v1', synthetic: {
    version: 1, enabled: true, lifetimeMs: 120_000, stageMs: 10_000, decisionMs: 200, eventMs: 300, thresholdSource: 'document-32-server-diagnostics', destinations } } } } });
  const retention = JSON.parse(m.env.RETENTION as string) as { tenants: Record<string, Record<string, unknown>> };
  for (const destination of await configuredOperationalDestinations(m.env, TENANT)) retention.tenants[TENANT]![destination.category] =
    { id: 'p02-synthetic', revision: 1, durationMs: 120_000, basis: 'occurred', renewal: 'new-record-only' };
  env.RETENTION = JSON.stringify(retention);
  env.LEDGER_RECOVERY_ENABLED = 'true';
  env.LEDGER_RECOVERY_CONFIG = JSON.stringify({ version: 1, sourceQueue: 'p02-source', deadLetterQueue: 'p02-dlq' });
  env.REGION_TREND = { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ ok: true }) }) };
  // A queue delivers in its own invocation, never inside the producer's.
  const deliver = AsyncResource.bind((body: unknown) => consumeSynthetic(m.env, 'p02-source', body));
  const deliveries: Promise<unknown>[] = [], refused: string[] = [], queue = m.env.EVENT_QUEUE!;
  const send = async (body: unknown) => {
    await queue.send(body);
    if ((body as { kind?: unknown } | null)?.kind === SYNTHETIC_KIND) {
      deliveries.push(new Promise(resolve => setTimeout(resolve, 0)).then(() => deliver(body))
        .then(acked => { if (!acked) refused.push('not acknowledged'); }, error => { refused.push(String(error)); }));
    }
  };
  env.EVENT_QUEUE = { send, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const message of messages) await send(message.body); } };
  const settle = async () => { while (deliveries.length) await Promise.all(deliveries.splice(0)); await m.drain(); };
  return { refused, settle };
}

/** The decisions the synthetic snapshot handed to the ledger producer at serve time, by slot: the monitor's own durable wires (`monitor-wire/`, src/ops/synthetic.ts:239-249). */
function capturedDecisions(m: Mounted): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, raw] of m.storage.objects) {
    if (!key.includes('/monitor-wire/')) continue;
    const wire = JSON.parse(raw) as { kind?: string; rows?: Array<{ slot: string; item: string }> };
    if (wire.kind !== 'decision') continue;
    for (const row of wire.rows ?? []) (out[row.slot] ??= []).push(row.item);
  }
  return out;
}

// ===========================================================================
// unit:P02.A1 — a module registered by identifier, kind and journey stages
// ===========================================================================

describe('unit:P02.A1', () => {
  it('logic: the catalogue validator registers a module with its identifier, its kind and its journey stages, and refuses a module without an identifier or a kind with a named error', () => {
    const registered = validateContentCatalog({ pieces: [MODULES[0]] });
    expect(registered.ok, `the catalogue validator registers ${M.grid}: ${JSON.stringify(registered).slice(0, 300)}`).toBe(true);
    // LOCKED (src/content/kinds.ts:82, :86, :134-147): identifier, kind and stages are carried.
    expect((registered as unknown as { value: { pieces: Array<Record<string, unknown>> } }).value.pieces[0])
      .toMatchObject({ id: M.grid, type: 'category-grid', journeyStageFit: ['exploring'], slotTypes: [LAYOUT] });
    const { id: _id, ...withoutId } = MODULES[2]!; void _id;
    const { type: _type, ...withoutKind } = MODULES[5]!; void _type;
    const refused = validateContentCatalog({ pieces: [withoutId, withoutKind, { ...MODULES[6]!, type: '' }] });
    expect(refused.ok, 'a module without an identifier or a kind is refused').toBe(false);
    // LOCKED (src/content/kinds.ts:82, :86): the refusal names the module's address and the missing field.
    expect((refused as { errors: string[] }).errors).toEqual(expect.arrayContaining([
      'pieces[0].id: required string', 'pieces[1].type: required string', 'pieces[2].type: required string']));
  });

  for (const host of HOSTS) {
    it(`host (${host}): a module the operator registers through the real catalogue route is a candidate of the declared layout slot it names, a module naming another slot is not, and a module without a kind is refused by name`, async () => {
      const m = await mount(host, DOCUMENTS);
      expectPublished(m, 'P02.A1 — the slots document declaring the page’s layout slot (`layout: true`, governanceVersion 4) publishes');
      const added = { id: 'module.PDP.styling.1', customerContentId: 'TAP-PDP-STYLING-1', type: 'styling-story', title: 'How she wears it',
        tags: { line: ['Willow'] }, slotTypes: [LAYOUT], journeyStageFit: ['exploring', 'considering'], lifecycle: { status: 'live' } };
      const elsewhere = { ...added, id: 'module.PDP.gallery.1', customerContentId: 'TAP-PDP-GALLERY-1', type: 'gallery', slotTypes: ['pdp-gallery'] };
      // Placed FIRST in catalogue order: a cold shopper's layout is the first K eligible candidates, so a candidate is returned at position 0.
      const written = await putDocument(m, 'catalog', { pieces: [elsewhere, added, ...MODULES] });
      expect(written.status, `the catalogue route registers both modules: ${JSON.stringify(written.body).slice(0, 300)}`).toBe(200);
      const s = await shopperOn(m);
      await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p02-a1') });
      expect(page.status, JSON.stringify(page.body).slice(0, 300)).toBe(200);
      expect(servedIn(page, LAYOUT), `${host}: P02.A1 — the registered module is a candidate of the layout slot it names, served first for a shopper with no signal; the module naming another slot is not`)
        .toEqual([added.id, M.grid, M.reco1, M.reco2]);

      const { type: _kind, ...kindless } = { ...added, id: 'module.PDP.kindless.1' }; void _kind;
      const refused = await putDocument(m, 'catalog', { pieces: [kindless, ...MODULES] });
      expect(refused.status, `${host}: a module without a kind is refused`).toBe(422);
      expect(errorsOf(refused), `${host}: and the refusal names it`).toEqual(expect.arrayContaining(['pieces[0].type: required string']));
    });
  }
});

// ===========================================================================
// unit:P02.A2 — K of M, in rank order, with eligibility, exclusions and de-duplication
// ===========================================================================

describe('unit:P02.A2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the declared layout slot returns at most K module identifiers — with no signal the first K eligible in catalogue order, with signal in rank order — and never an excluded, ineligible or already-served module`, async () => {
      const m = await mount(host, DOCUMENTS);
      expectPublished(m, 'P02.A2 — the slots document declaring the page’s layout slot (`layout: true`, governanceVersion 4) publishes');
      const s = await shopperOn(m);
      await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
      const cold = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p02-a2-cold') });
      expect(cold.status, JSON.stringify(cold.body).slice(0, 300)).toBe(200);
      expect(servedIn(cold, LAYOUT), `${host}: P02.A2 — with no signal, the first K = 4 eligible modules in catalogue order`).toEqual(COLD_LAYOUT);
      expect(servedIn(cold, RECENT_SLOT), `${host}: the recently-viewed slot serves its own pinned module`).toEqual([M.recent]);

      for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${host}: her view is accepted`).toBe(200);
      const ranked = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p02-a2-ranked') });
      const layout = servedIn(ranked, LAYOUT);
      expect(layout.length, `${host}: P02.A2 — at most K = 4 module identifiers`).toBeLessThanOrEqual(4);
      expect(layout, `${host}: P02.A2 — in rank order, ties to catalogue order`).toEqual(RANKED_LAYOUT);
      for (const page of [cold, ranked]) {
        expect(servedIn(page, LAYOUT).filter(id => NEVER_IN_LAYOUT.includes(id as never)),
          `${host}: P02.A2 — never the excluded, the expired, the closed or the module another slot of the page already serves`).toEqual([]);
        expect(page.decisions.map(d => d.contentId).length, `${host}: no module twice on the page`).toBe(new Set(page.decisions.map(d => d.contentId)).size);
      }
    });
  }
});

// ===========================================================================
// unit:P02.A3 — measured on rendered-v1: drawn and acknowledged is one exposure
// ===========================================================================

describe('unit:P02.A3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the rendered-v1 layout slot a module returned, drawn and acknowledged adds exactly one exposure, and a module returned but not acknowledged, or not returned, adds none`, async () => {
      const m = await mount(host, DOCUMENTS);
      expectPublished(m, 'P02.A3 — the slots document declaring the page’s layout slot (`layout: true`, governanceVersion 4) publishes');
      const s = await shopperOn(m);
      await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p02-a3') });
      const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
      expect(layout.map(d => d.contentId), `${host}: PRECONDITION — the layout returns its four modules`).toEqual(COLD_LAYOUT);
      for (const d of layout) expect(d.renderOffer, `${host}: PRECONDITION — ${d.contentId} is offered for a render acknowledgement (rendered-v1)`).toMatch(/^ro1\./);
      // The page draws the first three and acknowledges them; the first one is
      // sent again with its first wire identity, as the SDK retries it.
      const drawn = layout.slice(0, 3);
      const first = [] as Array<{ eventId: string; timestamp: number }>;
      for (const d of drawn) {
        const ack = await s.ack(page, d);
        expect(ack.status, `${host}: the acknowledgement of ${d.contentId} is admitted: ${JSON.stringify(ack.body).slice(0, 200)}`).toBe(200);
        first.push(ack.identity);
      }
      const retry = await s.ack(page, drawn[0]!, first[0]);
      expect(retry.status, `${host}: the retried acknowledgement of ${drawn[0]!.contentId} is answered: ${JSON.stringify(retry.body).slice(0, 200)}`).toBe(200);
      await m.drainLedger();
      expect(rounded(await learned(m), 'n'), `${host}: P02.A3 — one exposure for each module drawn and acknowledged, none for ${layout[3]!.contentId} (returned, not drawn) and none for any module not returned`)
        .toEqual(Object.fromEntries(drawn.map(d => [d.contentId, 1])));
    });
  }

  for (const host of HOSTS) {
    it(`host (${host}): decision D1 — through the trusted synthetic snapshot, the one production path that captures served-v1 decisions at serve time, a declared layout slot measured on served-v1 is never captured as an exposure while the page's served-v1 content slot is`, async () => {
      const m = await mount(host, MONITOR_DOCUMENTS);
      expectPublished(m, 'P02.A3 (D1) — the home page with its declared layout slot (`layout: true`, governanceVersion 4) on served-v1 publishes');
      const monitor = await armSyntheticMonitor(m);
      const result = await runSynthetic(m.env, TENANT, host);
      await monitor.settle();
      expect([result.decision, monitor.refused], `${host}: PRECONDITION — the synthetic snapshot decided the monitor page as a personalized shopper (${JSON.stringify(result)})`)
        .toEqual([true, []]);
      const captured = capturedDecisions(m);
      // CONTROL: the served-v1 content slot of the same snapshot is captured at serve time, so the capture path ran.
      expect(captured[HOME_STORY] ?? [], `${host}: CONTROL — the served-v1 content slot of the synthetic snapshot is captured at serve time`).toEqual([HOME_STORY_PIECE.id]);
      expect(captured[LAYOUT] ?? [], `${host}: P02.A3 (D1) — no module of the declared served-v1 layout slot is captured as an exposure, though nothing drew it`).toEqual([]);
    }, 120_000);

    it(`host-internal (${host}): decision D1 — the decision set the snapshot route composes, with the offer the route passes, serves the declared served-v1 layout without a render offer and names the measurement-basis mismatch`, async () => {
      const m = await mount(host, { ...DOCUMENTS, learn: learnDocument({ [LAYOUT]: { reward: 'click' } }) });
      expectPublished(m, 'P02.A3 (D1) — the slots document declaring the page’s layout slot (`layout: true`, governanceVersion 4) publishes');
      const s = await shopperOn(m);
      await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p02-a3-served') });
      expect(servedIn(page, LAYOUT), `${host}: the layout is still served`).toEqual(COLD_LAYOUT);
      // LOCKED (src/content/service.ts:652): only a rendered-v1 placement is offered for acknowledgement.
      expect(page.decisions.filter(d => d.slot === LAYOUT && d.renderOffer !== undefined).map(d => d.contentId),
        `${host}: no served-v1 layout decision is offered for a render acknowledgement`).toEqual([]);
      // One layer in, with the offer the route passes (src/routes/decisions.ts:855-861): the decision set the route answers from.
      const set = await servePage(m, s, 'pdp') as unknown as { layoutDiagnostics?: unknown; records: Array<{ slot: string; item_id: string }> };
      expect(set.records.filter(r => r.slot === LAYOUT).map(r => r.item_id), `${host}: PRECONDITION — the route's composition decides the same layout`).toEqual(COLD_LAYOUT);
      expect(set.layoutDiagnostics ?? `the decision set carries no \`layoutDiagnostics\` (it carries ${Object.keys(set).join(', ')})`,
        `${host}: P02.A3 (D1) — the decision set names the measurement-basis mismatch of the declared layout slot`)
        .toEqual([{ slot: LAYOUT, reason: 'measurement_basis', measurementBasis: 'served-v1' }]);
    });
  }
});

// ===========================================================================
// unit:P02.A4 — publication refusals, and a retained document decides as before
// ===========================================================================

describe('unit:P02.A4', () => {
  it('logic: publication refuses a layout take outside 1 to 50, two layout slots on one page and a declaration under a governance version earlier than 4, each with a named error, and admits one declared layout slot per page', () => {
    const errors = (candidate: unknown): string[] => { const checked = validateSlotCatalog(candidate); return checked.ok ? [] : checked.errors; };
    // The positive control: one declared layout slot on each of two pages publishes.
    const admitted = validateSlotCatalog({ governanceVersion: 4, pages: { pdp: [layoutSlot(), recentSlot()], home: [{ ...layoutSlot(), slot: 'home-modules' }] } });
    expect.soft(admitted.ok ? 'admitted' : (admitted as { errors: string[] }).errors.join('; '),
      'P02.A4 — one declared layout slot per page, under governanceVersion 4, is admitted').toBe('admitted');
    expect.soft((admitted as { value?: { pages: Record<string, Array<Record<string, unknown>>> } }).value?.pages.pdp?.[0]?.layout,
      'P02.A4 — and the declaration is kept on the slot it was published on').toBe(true);

    // LOCKED (src/content/kinds.ts:263): a take outside 1..50 is refused by the slot's address.
    for (const take of [0, 51]) {
      expect.soft(errors({ governanceVersion: 4, pages: { pdp: [layoutSlot({ take }), recentSlot()] } }).some(e => e.startsWith('pages.pdp[0].take')),
        `P02.A4 — a layout take of ${take} is refused naming pages.pdp[0].take`).toBe(true);
    }
    const two = errors({ governanceVersion: 4, pages: { pdp: [layoutSlot(), { ...layoutSlot(), slot: 'pdp-modules-2' }] } });
    expect.soft(two.some(e => e.includes('pages.pdp') && /layout/.test(e)),
      `P02.A4 — a second layout slot on one page is refused with an error naming the page and the declaration (errors: ${JSON.stringify(two)})`).toBe(true);
    for (const governanceVersion of [1, 2, 3]) {
      const early = errors({ governanceVersion, pages: { pdp: [layoutSlot(), recentSlot()] } });
      expect.soft(early.some(e => e.includes('pages.pdp') && /layout/.test(e) && /governance ?version|governanceVersion/i.test(e) && e.includes('4')),
        `P02.A4 — a declaration in a document marked governanceVersion ${governanceVersion} is refused with an error naming the slot, the declaration and the version (4) that introduces it (errors: ${JSON.stringify(early)})`).toBe(true);
    }
  });

  for (const host of HOSTS) {
    it(`host (${host}): a retained governance-3 slots document without a declaration decides the first K eligible modules in catalogue order, and every decision replays equal under exactly today's page markers`, async () => {
      const retained = { version: 'parity-retained-slots', governanceVersion: 3, pages: { pdp: [{ ...layoutSlot(), layout: undefined }, recentSlot()].map(slot => JSON.parse(JSON.stringify(slot))) } };
      const m = await mount(host, { ...DOCUMENTS, slots: retained, retainedSlots: true });
      expectPublished(m, 'P02.A4 — the retained governance-3 document reads');
      const s = await shopperOn(m);
      await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY);
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p02-a4') });
      // LOCKED: the retained slot decides as it did — the first K eligible modules in catalogue order.
      expect(servedIn(page, LAYOUT), `${host}: P02.A4 — the retained document decides as before`).toEqual(COLD_LAYOUT);
      for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `${host}: ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      const stored = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT);
      expect(stored.map(r => r.item_id).sort(), `${host}: PRECONDITION — the ledger holds her four layout decisions`).toEqual([...COLD_LAYOUT].sort());
      for (const record of stored) {
        // LOCKED (src/content/decide.ts:514-519; the manifest src/content/consent.test.ts:629 pins): no marker beyond today's.
        expect(Object.keys(record.inputs?.replay ?? {}).sort(), `${host}: P02.A4 — the retained decision's page manifest carries exactly today's markers`)
          .toEqual(['candidateLimit', 'contentTypes', 'exploration', 'governance', 'learning', 'pins', 'slots', 'version']);
        const replay = await replayOf(m, record.decision_id);
        expect([replay.status, replay.body.classification ?? replay.body.reason ?? null], `${host}: P02.A4 — ${record.item_id} replays equal`).toEqual([200, 'equal']);
      }
    });
  }
});

// ===========================================================================
// unit:P02.A5 — the kit states the layout contract
// ===========================================================================

/** The sentences of a document, flattened, so a statement is judged within one sentence. */
const sentencesOf = (text: string): string[] => text.replace(/[‘’]/g, "'").replace(/`/g, '').split(/(?<=[.!?])\s+|\n\s*\n|\n[-*] /).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
const STATEMENTS: Array<{ name: string; test: (sentence: string) => boolean }> = [
  { name: 'the returned list is the layout’s sequence',
    test: s => /layout/i.test(s) && /return/i.test(s) && /\bsequence\b|in (that|the returned|this) order|draws? (them|the modules) in (that|the) order/i.test(s) },
  { name: 'a module not returned is not drawn and its container stays hidden',
    test: s => /not returned/i.test(s) && /not (be )?drawn|never drawn|does not draw|is not painted/i.test(s) && /hidden|hide/i.test(s) },
  { name: 'every drawn module is acknowledged',
    test: s => /(every|each) (drawn module|module (it|you|the page) draws?|module drawn)/i.test(s) && /acknowledg/i.test(s) },
];

describe('unit:P02.A5', () => {
  it('logic: the integration guide, the API reference and the payload schemas each state that the returned list is the layout’s sequence, that a module not returned is not drawn and its container stays hidden, and that every drawn module is acknowledged', () => {
    const missing: string[] = [];
    for (const file of ['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']) {
      const sentences = sentencesOf(readTree(file));
      for (const statement of STATEMENTS) if (!sentences.some(statement.test)) missing.push(`${file}: ${statement.name}`);
    }
    expect(missing, 'P02.A5 — every kit document states the three parts of the layout contract').toEqual([]);
  });
});
