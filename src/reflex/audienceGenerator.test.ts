// @vitest-environment node
// src/reflex/audienceGenerator.test.ts
// The generator's spec: the catalog writes the audiences; the diff never
// clobbers human curation (doc 16 §5).
import { describe, expect, it } from 'vitest';
import type { AudienceDef } from '@/connectors/types';
import type { AudienceStore } from '@/connectors/AudienceStore';
import { DEFAULT_REFLEX_CONFIG } from './core';
import {
  DEFAULT_GENERATOR_CONFIG,
  generateAffinityAudiences,
  hashDef,
  regenerateCatalogAudiences,
} from './audienceGenerator';

const CFG = DEFAULT_REFLEX_CONFIG;

// A miniature catalog with clean counts at minProducts=3:
//   PASS: Tabby(4) · Handbags(5) · Shoulder Bags(3) · shoulder(3) · evening(3) · everyday(3)
//   FILTERED: Rogue(1) · Crossbody/Satchels(1) · date-night/work(1) · priceBands(2 each)
const CATALOG = [
  { id: '1', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['evening', 'everyday'], price_usd: 475 },
  { id: '2', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['evening', 'everyday'], price_usd: 395 },
  { id: '3', line: 'Tabby', category: 'Handbags', subcategory: 'Crossbody Bags', silhouette: 'crossbody', occasion: ['date-night', 'everyday'], price_usd: 350 },
  { id: '4', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['evening'], price_usd: 425 },
  { id: '5', line: 'Rogue', category: 'Handbags', subcategory: 'Satchels', silhouette: 'satchel', occasion: ['work'], price_usd: 795 },
];

/** Tiny in-memory AudienceStore for diff tests. */
function memStore(initial: AudienceDef[] = []) {
  const map = new Map<string, AudienceDef>(initial.map((d) => [d.key, d]));
  const store: AudienceStore = {
    async listPublished() {
      return [...map.values()].filter((d) => d.status === 'published');
    },
    async publish(def) {
      map.set(def.key, { ...def, status: 'published' });
    },
    async get(key) {
      return map.get(key) ?? null;
    },
    async seed(defs) {
      for (const d of defs) if (!map.has(d.key)) map.set(d.key, { ...d, status: 'published' });
    },
    async archive(key) {
      const d = map.get(key);
      if (d) map.set(key, { ...d, status: 'archived' });
    },
    async rename(key, name, description) {
      const d = map.get(key);
      if (!d) return null;
      const next = { ...d, name, ...(description === undefined ? {} : { description }) };
      map.set(key, next);
      return next;
    },
    async setPinned(key, pinned) {
      const d = map.get(key);
      if (!d) return null;
      const next = { ...d, pinned };
      map.set(key, next);
      return next;
    },
  };
  return { store, map };
}

describe('generateAffinityAudiences — the catalog writes the audiences', () => {
  it('names come from catalog values; keys are dimension-namespaced; θ_in is the condition', () => {
    const defs = generateAffinityAudiences(CATALOG, CFG, DEFAULT_GENERATOR_CONFIG);
    const tabby = defs.find((d) => d.key === 'line_tabby_affinity');
    expect(tabby).toBeDefined();
    expect(tabby!.name).toBe('Tabby Affinity');
    expect(tabby!.source).toBe('catalog');
    expect(tabby!.evaluation).toBe('realtime');
    expect(tabby!.anchorLine).toBe('Tabby');
    expect(tabby!.conditions).toEqual({
      attribute: 'line_affinity.tabby',
      operator: 'gte',
      value: CFG.thetaIn,
    });
    expect(tabby!.generatorHash).toBe(hashDef(tabby!));
    // Multi-word values prettify; already-capitalized values stay verbatim.
    const dateNight = defs.find((d) => d.key === 'occasion_date_night_affinity');
    expect(dateNight).toBeUndefined(); // only 1 product carries date-night → filtered
    const handbags = defs.find((d) => d.key === 'category_handbags_affinity');
    expect(handbags!.name).toBe('Handbags Affinity');
  });

  it('applies the population filter (minProducts) — sparse values are noise, not audiences', () => {
    const defs = generateAffinityAudiences(CATALOG, CFG, { minProducts: 3 });
    const keys = defs.map((d) => d.key);
    expect(keys).toContain('line_tabby_affinity'); // 4 products
    expect(keys).toContain('occasion_everyday_affinity'); // 3 products
    expect(keys).not.toContain('line_rogue_affinity'); // 1 product
    expect(keys).not.toContain('occasion_work_affinity'); // 1 product
    expect(keys).not.toContain('priceband_core_affinity'); // 2 products
  });

  it('optional traffic filter culls values without demand', () => {
    const defs = generateAffinityAudiences(
      CATALOG,
      CFG,
      { minProducts: 1, minTraffic: 10 },
      { 'line:Tabby': 50, 'line:Rogue': 2 } // only Tabby has demand
    );
    const keys = defs.map((d) => d.key);
    expect(keys).toContain('line_tabby_affinity');
    expect(keys).not.toContain('line_rogue_affinity');
  });

  it('is deterministic: identical inputs → byte-identical output', () => {
    const a = generateAffinityAudiences(CATALOG, CFG, DEFAULT_GENERATOR_CONFIG);
    const b = generateAffinityAudiences(CATALOG, CFG, DEFAULT_GENERATOR_CONFIG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((d) => d.key)).toEqual([...a.map((d) => d.key)].sort());
  });
});

describe('regenerateCatalogAudiences — a diff, never a clobber', () => {
  const generated = () => generateAffinityAudiences(CATALOG, CFG, { minProducts: 3 });

  it('publishes new audiences into an empty store', async () => {
    const { store, map } = memStore();
    const summary = await regenerateCatalogAudiences(store, generated());
    expect(summary.published.length).toBe(generated().length);
    expect(summary.updated).toEqual([]);
    expect(summary.archived).toEqual([]);
    expect(map.get('line_tabby_affinity')!.status).toBe('published');
  });

  it('is idempotent: a second run changes nothing', async () => {
    const { store } = memStore();
    await regenerateCatalogAudiences(store, generated());
    const second = await regenerateCatalogAudiences(store, generated());
    expect(second.published).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.archived).toEqual([]);
  });

  it('updates its own untouched audiences when config changes the content', async () => {
    const { store } = memStore();
    await regenerateCatalogAudiences(store, generated());
    // Threshold tuned 0.6 → 0.7: the generated content changes.
    const retuned = generateAffinityAudiences(CATALOG, CFG, { minProducts: 3, thetaIn: 0.7 });
    const summary = await regenerateCatalogAudiences(store, retuned);
    expect(summary.updated).toContain('line_tabby_affinity');
    const def = await store.get('line_tabby_affinity');
    expect((def!.conditions as { value: number }).value).toBe(0.7);
  });

  it('NEVER touches a human-edited audience (hash mismatch)', async () => {
    const { store, map } = memStore();
    await regenerateCatalogAudiences(store, generated());
    // A human renames the audience in place — hash no longer matches.
    const cur = map.get('line_tabby_affinity')!;
    map.set(cur.key, { ...cur, name: 'Tabby Lovers (curated)' });
    const retuned = generateAffinityAudiences(CATALOG, CFG, { minProducts: 3, thetaIn: 0.7 });
    const summary = await regenerateCatalogAudiences(store, retuned);
    expect(summary.skippedHumanEdited).toContain('line_tabby_affinity');
    expect(map.get('line_tabby_affinity')!.name).toBe('Tabby Lovers (curated)'); // survived
  });

  it('NEVER touches a pinned audience', async () => {
    const { store, map } = memStore();
    await regenerateCatalogAudiences(store, generated());
    const cur = map.get('line_tabby_affinity')!;
    map.set(cur.key, { ...cur, pinned: true });
    const summary = await regenerateCatalogAudiences(
      store,
      generateAffinityAudiences(CATALOG, CFG, { minProducts: 3, thetaIn: 0.8 })
    );
    expect(summary.skippedPinned).toContain('line_tabby_affinity');
    expect((map.get('line_tabby_affinity')!.conditions as { value: number }).value).toBe(CFG.thetaIn);
  });

  it('archives its own audiences whose catalog value disappeared — but not human-edited ones', async () => {
    const { store, map } = memStore();
    await regenerateCatalogAudiences(store, generated());
    // Tabby line drops out of the catalog entirely.
    const withoutTabby = CATALOG.filter((p) => p.line !== 'Tabby');
    // Human edits ONE of the soon-dead audiences first.
    const edited = map.get('silhouette_shoulder_affinity')!;
    map.set(edited.key, { ...edited, description: 'hand-tuned' });
    const summary = await regenerateCatalogAudiences(
      store,
      generateAffinityAudiences(withoutTabby, CFG, { minProducts: 3 })
    );
    expect(summary.archived).toContain('line_tabby_affinity');
    expect(map.get('line_tabby_affinity')!.status).toBe('archived');
    expect(summary.skippedHumanEdited).toContain('silhouette_shoulder_affinity');
    expect(map.get('silhouette_shoulder_affinity')!.status).toBe('published'); // survived
  });

  it('leaves non-catalog audiences (seed / opal) completely alone', async () => {
    const seedDef: AudienceDef = {
      key: 'high_intent_tabby_browser',
      name: 'High-Intent Tabby Browser',
      description: 'seeded',
      conditions: { attribute: 'viewed_product_line', operator: 'eq', value: 'Tabby' },
      evaluation: 'realtime',
      source: 'seed',
      createdAt: 0,
      status: 'published',
    };
    const { store, map } = memStore([seedDef]);
    const summary = await regenerateCatalogAudiences(store, generated());
    expect(summary.archived).not.toContain('high_intent_tabby_browser');
    expect(map.get('high_intent_tabby_browser')!.status).toBe('published');
  });
});

// ── The three human verbs (§1.2), performed through the store rather than by
// mutating the map. The generator has always honoured the RESULT of a rename or
// a pin; these prove the API produces exactly that state.
describe('rename, pin and prune — §1.2 performed, not simulated', () => {
  const generated = () => generateAffinityAudiences(CATALOG, CFG, { minProducts: 3 });

  it('rename keeps the KEY and changes only the label', async () => {
    const { store } = memStore();
    await regenerateCatalogAudiences(store, generated());
    const updated = await store.rename('line_tabby_affinity', 'Tabby Lovers (curated)');
    expect(updated!.key).toBe('line_tabby_affinity');
    expect(updated!.name).toBe('Tabby Lovers (curated)');
  });

  it('a renamed audience survives the next regeneration, with no flag to remember', async () => {
    // The protection is a CONSEQUENCE of the edit: hashDef covers name, so a
    // rename makes the stored def stop hashing to its recorded generatorHash,
    // and the generator reads that as human ownership.
    const { store, map } = memStore();
    await regenerateCatalogAudiences(store, generated());
    await store.rename('line_tabby_affinity', 'Tabby Lovers (curated)');

    const summary = await regenerateCatalogAudiences(
      store, generateAffinityAudiences(CATALOG, CFG, { minProducts: 3, thetaIn: 0.7 }),
    );
    expect(summary.skippedHumanEdited).toContain('line_tabby_affinity');
    expect(map.get('line_tabby_affinity')!.name).toBe('Tabby Lovers (curated)');
  });

  it('rename also carries a new description when one is given, and leaves it alone when not', async () => {
    const { store } = memStore();
    await regenerateCatalogAudiences(store, generated());
    const before = (await store.get('line_tabby_affinity'))!.description;

    const kept = await store.rename('line_tabby_affinity', 'A');
    expect(kept!.description).toBe(before);

    const changed = await store.rename('line_tabby_affinity', 'B', 'shoppers who keep coming back to Tabby');
    expect(changed!.description).toBe('shoppers who keep coming back to Tabby');
  });

  it('pin protects an audience even when its content STILL matches the generator', async () => {
    // The case a hash can never catch: nothing was edited, the merchandiser
    // simply wants this one kept. Pinned is checked before ownership for exactly
    // this reason.
    const { store, map } = memStore();
    await regenerateCatalogAudiences(store, generated());
    await store.setPinned('line_tabby_affinity', true);

    const summary = await regenerateCatalogAudiences(store, generated());
    expect(summary.skippedPinned).toContain('line_tabby_affinity');
    expect(map.get('line_tabby_affinity')!.pinned).toBe(true);
  });

  it('unpinning hands the audience back to the generator', async () => {
    const { store } = memStore();
    await regenerateCatalogAudiences(store, generated());
    await store.setPinned('line_tabby_affinity', true);
    await store.setPinned('line_tabby_affinity', false);

    const summary = await regenerateCatalogAudiences(
      store, generateAffinityAudiences(CATALOG, CFG, { minProducts: 3, thetaIn: 0.7 }),
    );
    expect(summary.skippedPinned).not.toContain('line_tabby_affinity');
  });

  it('prune drops the audience out of qualification but keeps its key resolvable', async () => {
    // Archive rather than delete, so a decision recorded weeks ago that names
    // this audience can still be explained.
    const { store } = memStore();
    await regenerateCatalogAudiences(store, generated());
    await store.archive('line_tabby_affinity');

    const live = await store.listPublished();
    expect(live.map((d) => d.key)).not.toContain('line_tabby_affinity');
    expect((await store.get('line_tabby_affinity'))!.status).toBe('archived');
  });

  it('returns null rather than throwing for a key that does not exist', async () => {
    const { store } = memStore();
    expect(await store.rename('nope', 'x')).toBeNull();
    expect(await store.setPinned('nope', true)).toBeNull();
  });
});
