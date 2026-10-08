// src/units/P32/LEDGER.unit.test.ts
// P32 under the Closure Ledger: the tests for the LOCAL criteria of the P32 work
// order (`tapestry-parity-build`, ticket P32 "Module type as a dimension, and
// engagement that teaches a module's tags"). DC1-DC3 (decisions D1-D3) are ruled
// here and exercised inside Y1-Y5; LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P32.<criterion> …')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P32 in section E): "the
//     registry draft carries the module-type dimension and the catalogue
//     diagnostics distinguish it from content format; a module engagement raises
//     the shopper's interest on the module's type and on its other tags by the
//     configured weight; a module without an explicit type tag no longer scores
//     its free-text `type` as a content type silently (a diagnostic names it)";
//   · freeze sheet item 12 (D1: a registry-draft dimension with nine proposed
//     types, kept apart from content format; D2: engagement teaches tags at
//     weight 0 by default; D3: the free-text fallback retired only under a new
//     catalogue marker) and item 42 ("The type fallback is retired in slot
//     exclusions as well as in ranking; the registry draft is placed in the
//     kit's payload schemas document"). Both UNANSWERED at the freeze: every
//     unit names them (R-P15);
//   · the investigation, sections G-A (per module: "a module-type dimension of
//     its own (reviews, user-generated, material story, craftsmanship story,
//     recommendations, complete the look, category grid, recently viewed,
//     editorial), kept separate from content format"; "a module without an
//     explicit content-type tag scores on its `type` string as if that were a
//     content type") and G-B (option A);
//   · the existing contract: src/content/typeAffinity.ts (the fallback),
//     src/reflex/contentTelemetry.ts (a content event teaches its own values and
//     the piece's format only), src/reflex/core.ts (a = R / (R + K), K 1.8 in the
//     shipped tuning), src/content/catalogDiagnostics.ts (warnings and counts).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   The dimension is `moduleType` (registry entry `{ key: 'moduleType', source:
//   'moduleType' }`), a module carrying `tags.moduleType`; content format stays
//   `contentType`. The catalogue diagnostics carry `dimensionRoles: { moduleType:
//   'module_type', contentType: 'content_format' }`. The teaching weight is the
//   reflex document's `moduleEngagementWeight` (absent = 0). A module engagement
//   is P03's: a content_click naming the module (`contentId`) on its layout slot;
//   at weight w it adds w to the shopper's R on the module's moduleType value and
//   on each value of its other registered tags. The marker is the catalogue
//   document's `typeFallback: 'retired'`. The catalogue diagnostics name the
//   fallback in a member of their own, `typeFallback: { retired, pieceIndexes }`
//   (never in `warnings`, `counts` or `warningCount`, which existing tests pin,
//   e.g. src/units/W19/B3.unit.test.ts:366): without the marker `retired: false`
//   and the stored index of each piece the fallback scores; under it
//   `retired: true` and each piece without an explicit contentType tag.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `dimensionRoles` and `typeFallback` in the catalogue diagnostics,
// `moduleEngagementWeight`, the catalogue document's `typeFallback`. No new
// export is imported.
//
// PRECONDITIONS (R-P6): every host leg on the layout needs P02 (a declared
// layout slot, governance 4) and fails first with a message labelled
// PRECONDITION P02; a module engagement is P03's event.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts).

import { describe, expect, it } from 'vitest';

import {
  asOperator, declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, putDocument, readTree, recentSlot, REFLEX_DOCUMENT, replayOf, servePage, shopperOn, storedDecisions, TENANT, toLedger,
  type Mounted, type Shopper,
} from '../_parity';

/** The module type of each module, from decision D1's nine proposed types. */
const MODULE_TYPE: Record<string, string> = {
  [M.grid]: 'category-grid', [M.reviews]: 'reviews', [M.reco1]: 'recommendations', [M.lookbook]: 'editorial', [M.recent]: 'recently-viewed',
  [M.reco2]: 'complete-the-look', [M.editorial]: 'editorial', [M.ugc]: 'user-generated', [M.charms]: 'editorial',
};
/** Modules tagged with their module type, and the complete-the-look module also with its content format. */
const TYPED_MODULES = MODULES.map(m => ({ ...m, tags: { ...m.tags, moduleType: [MODULE_TYPE[m.id]!], ...(m.id === M.reco2 ? { contentType: ['on-model'] } : {}) } }));
const REGISTRY = { ...REFLEX_DOCUMENT, version: 'parity-p32-registry', dimensions: [...REFLEX_DOCUMENT.dimensions, { key: 'moduleType', source: 'moduleType' }] };
const SLOTS = declaredSlots([layoutSlot(), recentSlot()]);
const K = REFLEX_DOCUMENT.K;
const precondition = (m: Mounted, ticket: string) => expectPublished(m, `${ticket} — PRECONDITION P02: the page's declared layout slot (governance 4) publishes`);

/** P03's module engagement: a click inside the module's container, on its layout slot. */
async function engage(m: Mounted, s: Shopper, moduleId: string): Promise<void> {
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p32-engage'), entry: PAID_SOCIAL_ENTRY });
  expect(page.status, `${m.host}: her page is answered: ${JSON.stringify(page.body).slice(0, 200)}`).toBe(200);
  const d = page.decisions.find(x => x.contentId === moduleId);
  expect(d, `${m.host}: PRECONDITION — ${moduleId} is served on her page`).toBeDefined();
  expect((await s.click(page, d!)).status, `${m.host}: her engagement with ${moduleId} is accepted`).toBe(200);
}
/** Her interests as the next decision reads them (the record's `inputs.affinity`). */
async function interests(m: Mounted, s: Shopper): Promise<Record<string, Record<string, number>>> {
  const set = await servePage(m, s, 'pdp', { entry: PAID_SOCIAL_ENTRY });
  return (set.records[0]?.inputs?.affinity ?? {}) as Record<string, Record<string, number>>;
}
async function arrived(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: her page view is accepted`).toBe(200);
  return s;
}
const diagnosticsOf = async (m: Mounted) => {
  const read = await asOperator(m, 'GET', `/content/catalog?scope=${TENANT}`);
  expect(read.status, `${m.host}: the operator reads the catalogue`).toBe(200);
  return (read.body.diagnostics ?? {}) as { dimensionRoles?: Record<string, string>; typeFallback?: unknown; counts?: Record<string, number>; warnings?: Array<Record<string, unknown>> };
};

// ===========================================================================
// unit:P32.Y1 — the module-type dimension, apart from content format
// ===========================================================================

describe('unit:P32.Y1 (freeze items 12 and 42)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a registry with the moduleType dimension validates, the catalogue diagnostics name moduleType as the module type and contentType as the content format, and a module-type value never builds content-format interest`, async () => {
      const m = await mount(host, { pieces: TYPED_MODULES, slots: SLOTS, learn: learnDocument(), reflex: { ...REGISTRY, moduleEngagementWeight: K } });
      precondition(m, 'P32.Y1');
      const diagnostics = await diagnosticsOf(m);
      expect(diagnostics.dimensionRoles ?? 'no dimensionRoles in the catalogue diagnostics', `${host}: P32.Y1 — the diagnostics tell the module-type tag and the content-format tag apart`)
        .toMatchObject({ moduleType: 'module_type', contentType: 'content_format' });
      const s = await arrived(m);
      await engage(m, s, M.reco2);
      const contentFormats = Object.keys((await interests(m, s)).contentType ?? {});
      expect(contentFormats.filter(v => Object.values(MODULE_TYPE).includes(v)), `${host}: P32.Y1 — no module-type value appears as a content-format interest (contentType: ${JSON.stringify(contentFormats)})`).toEqual([]);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P32.Y2 — at a weight above 0 a module engagement teaches its type and its tags
// ===========================================================================

describe('unit:P32.Y2 (freeze item 12)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with moduleEngagementWeight at K, one engagement with complete-the-look raises her interest on moduleType complete-the-look, line Tabby and occasion evening each by that weight (a = w / (w + K) = 0.5)`, async () => {
      const m = await mount(host, { pieces: TYPED_MODULES, slots: SLOTS, learn: learnDocument(), reflex: { ...REGISTRY, moduleEngagementWeight: K } });
      precondition(m, 'P32.Y2');
      const s = await arrived(m);
      await engage(m, s, M.reco2);
      const a = await interests(m, s);
      const read = (dim: string, value: string) => Math.round((a[dim]?.[value] ?? 0) * 1000) / 1000;
      expect([read('moduleType', 'complete-the-look'), read('line', 'Tabby'), read('occasion', 'evening')],
        `${host}: P32.Y2 — each of the module's type and its other registered tags is raised by the weight (interests: ${JSON.stringify(a)})`).toEqual([0.5, 0.5, 0.5]);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P32.Y3 — at the shipped weight 0 a module engagement teaches exactly what it teaches today (LOCK)
// ===========================================================================

describe('unit:P32.Y3 (freeze item 12)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — with moduleEngagementWeight 0, and with it absent, a module engagement teaches exactly what it teaches today, term for term`, async () => {
      const taught: Record<string, unknown> = {};
      for (const [name, reflex] of [['absent', REGISTRY], ['weight 0', { ...REGISTRY, moduleEngagementWeight: 0 }]] as const) {
        const m = await mount(host, { pieces: TYPED_MODULES, slots: SLOTS, learn: learnDocument(), reflex });
        precondition(m, `P32.Y3 (${name})`);
        const s = await arrived(m);
        await engage(m, s, M.reco2);
        taught[name] = await interests(m, s);
      }
      expect(taught.absent, `${host}: CONTROL — today an engagement teaches the module's content format only`).toEqual({ contentType: { 'on-model': expect.any(Number) } });
      expect(taught['weight 0'], `${host}: P32.Y3 — at weight 0 exactly what it teaches today`).toEqual(taught.absent);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P32.Y4 — the fallback retired under the marker, named without it; replay
// ===========================================================================

describe('unit:P32.Y4 (freeze items 12 and 42)', () => {
  /** A content-format piece the shopper engages with, so she carries content-format interest on 'user-generated'. */
  const STORY = 'pdp-story';
  const UGC_STORY = { id: 'story.ugc', customerContentId: 'TAP-STORY-UGC', type: 'editorial', title: 'Worn by you', tags: { contentType: ['user-generated'] }, slotTypes: [STORY], lifecycle: { status: 'live' } };
  const PIECES = [...MODULES, UGC_STORY];
  const pagesWith = (layout: Record<string, unknown>) => declaredSlots([layoutSlot(layout), recentSlot(), { slot: STORY, take: 1, weights: { contentType: 1 } }]);
  const marked = (pieces: unknown[]) => ({ version: 'parity-p32-catalogue', typeFallback: 'retired', pieces });
  async function ugcFan(m: Mounted): Promise<Shopper> {
    const s = await arrived(m);
    const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p32-y4'), entry: PAID_SOCIAL_ENTRY });
    const story = page.decisions.find(d => d.contentId === 'story.ugc');
    expect(story, `${m.host}: PRECONDITION — the user-generated story is served`).toBeDefined();
    expect((await s.click(page, story!)).status, `${m.host}: her click on the story is accepted`).toBe(200);
    return s;
  }
  for (const host of HOSTS) {
    it(`host (${host}): under the marker, ugc.1 (type user-generated, no contentType tag) scores nothing from its type on a layout weighting contentType, a contentType exclusion no longer drops it, and the diagnostics name it; without the marker the fallback holds and the diagnostics name each piece it scores`, async () => {
      // Without the marker: today's fallback, named.
      const plain = await mount(host, { pieces: PIECES, slots: pagesWith({ weights: { contentType: 1 } }), learn: learnDocument() });
      precondition(plain, 'P32.Y4');
      const fan = await ugcFan(plain);
      const before = (await servePage(plain, fan, 'pdp', { entry: PAID_SOCIAL_ENTRY })).records.filter(r => r.slot === LAYOUT).map(r => r.item_id);
      expect(before[0], `${host}: CONTROL — without the marker the fallback scores ugc.1 as user-generated content and it leads`).toBe(M.ugc);
      const fallbackPieces = PIECES.map((p, i) => [p, i] as const).filter(([p]) => !Object.hasOwn(p.tags, 'contentType')).map(([, i]) => i);
      expect((await diagnosticsOf(plain)).typeFallback ?? 'no typeFallback in the catalogue diagnostics', `${host}: P32.Y4 — without the marker the diagnostics name each piece the fallback scores`)
        .toEqual({ retired: false, pieceIndexes: fallbackPieces });

      // Under the marker: retired in ranking, in exclusions, and named.
      const m = await mount(host, { pieces: PIECES, slots: pagesWith({ weights: { contentType: 1 } }), learn: learnDocument() });
      precondition(m, 'P32.Y4');
      const put = await putDocument(m, 'catalog', marked(PIECES), 'p32 marker');
      expect(put.status, `${host}: P32.Y4 — the catalogue with the marker publishes: ${JSON.stringify(put.body).slice(0, 200)}`).toBe(200);
      const s = await ugcFan(m);
      const after = (await servePage(m, s, 'pdp', { entry: PAID_SOCIAL_ENTRY })).records.filter(r => r.slot === LAYOUT).map(r => r.item_id);
      expect(after, `${host}: P32.Y4 — under the marker no module scores a content format from its type: the slot's own cold order`).toEqual([M.grid, M.reco1, M.reco2, M.editorial]);
      expect((await diagnosticsOf(m)).typeFallback ?? 'no typeFallback in the catalogue diagnostics', `${host}: P32.Y4 — under the marker the diagnostics name each piece without an explicit contentType tag`)
        .toEqual({ retired: true, pieceIndexes: fallbackPieces });

      const excluded = await mount(host, { pieces: PIECES, slots: pagesWith({ take: 5, weights: {}, excludedTags: [{ dimension: 'contentType', value: 'user-generated' }] }), learn: learnDocument() });
      precondition(excluded, 'P32.Y4');
      expect((await putDocument(excluded, 'catalog', marked(PIECES), 'p32 marker')).status, `${host}: the catalogue with the marker publishes`).toBe(200);
      const served = (await servePage(excluded, await arrived(excluded), 'pdp')).records.filter(r => r.slot === LAYOUT).map(r => r.item_id);
      expect(served, `${host}: P32.Y4 — under the marker a contentType exclusion no longer matches ugc.1's free-text type`).toEqual([M.grid, M.reco1, M.reco2, M.editorial, M.ugc]);
    }, 120_000);

    it(`host (${host}): decisions under the marker and without it each replay equal`, async () => {
      const replays: unknown[][] = [];
      for (const withMarker of [false, true]) {
        // Served-v1 and without the durable recovery path (R-P14).
        const m = await mount(host, { pieces: PIECES, slots: pagesWith({ weights: { contentType: 1 } }), learn: learnDocument({ [LAYOUT]: { reward: 'click' } }) }, { recovery: false });
        precondition(m, 'P32.Y4');
        if (withMarker) expect((await putDocument(m, 'catalog', marked(PIECES), 'p32 marker')).status, `${host}: the catalogue with the marker publishes`).toBe(200);
        const s = await arrived(m);
        const set = await servePage(m, s, 'pdp', { offer: false });
        await toLedger(m, set.records);
        for (const r of storedDecisions(m, s.subject).filter(x => x.slot === LAYOUT)) {
          const replay = await replayOf(m, r.decision_id);
          replays.push([withMarker ? 'marker' : 'plain', r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
        }
      }
      expect(replays.length, `${host}: PRECONDITION — the ledger holds both sets of layout decisions`).toBe(8);
      expect(replays, `${host}: P32.Y4 — every decision replays equal, under the marker and without it`).toEqual(replays.map(([kind, id]) => [kind, id, 200, 'equal']));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P32.Y5 — the registry draft in the payload schemas
// ===========================================================================

describe('unit:P32.Y5 (freeze items 12 and 42)', () => {
  it('logic: docs/kit/03-payload-schemas.md documents the module-type dimension as a registry draft kept apart from content format, with the nine draft types and the teaching weight', () => {
    const text = readTree('docs/kit/03-payload-schemas.md').replace(/`/g, '');
    const sentences = text.split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(s => s.replace(/\s+/g, ' ').trim());
    const NINE = ['reviews', 'user-generated', 'material story', 'craftsmanship story', 'recommendations', 'complete the look', 'category grid', 'recently viewed', 'editorial'];
    const section = sentences.filter(s => /moduleType/.test(s)).join(' ').toLowerCase().replace(/-/g, ' ');
    const missing = [
      ...(sentences.some(s => /moduleType/.test(s) && /draft/i.test(s)) ? [] : ['moduleType as a registry draft']),
      ...(sentences.some(s => /moduleType/.test(s) && /contentType|content format/i.test(s) && /(apart|separate|not the same|distinct)/i.test(s)) ? [] : ['kept apart from content format']),
      ...NINE.filter(t => !section.includes(t.replace(/-/g, ' '))).map(t => `the draft type "${t}"`),
      ...(sentences.some(s => /moduleEngagementWeight/.test(s) && /\b0\b/.test(s)) ? [] : ['the teaching weight moduleEngagementWeight, 0 by default']),
    ];
    expect(missing, 'P32.Y5 — the payload schemas document the module-type registry draft').toEqual([]);
  });
});
