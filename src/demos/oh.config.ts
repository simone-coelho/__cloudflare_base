// src/demos/oh.config.ts
// ──────────────────────────────────────────────────────
// The OH demo's constants for LG (docs/lg/OH-Demo-Design.md), in one place, for the demo
// kit's route factories (src/demos/kit, docs/demo-kit/Demo-Kit-Design.md §2.1).
// src/routes/oh.ts builds OH's routes from these and nothing else.
// Scaffolded by scripts/demo-kit/new-demo.mjs from public/oh/demo.config.json;
// the closed beat list below must stay the kit config's seed.beats.publishable.
// ──────────────────────────────────────────────────────

import type { DemoActionConfig } from '@/demos/kit/actionRoutes';
import type { DemoColdStartConfig } from '@/demos/kit/coldStartRoutes';

/** The demo's own tenant. */
export const OH_TENANT = 'oh';

/**
 * The beat documents the page may ask the worker to publish, and the document
 * kind each one is: files scripts/demo-kit/seed.mjs re-anchors under
 * public/oh/beats/. The list is closed on purpose: it is the whole reason
 * the beat route needs no login. Context beats publish nothing.
 */
export const OH_BEATS: Readonly<Record<string, 'catalog' | 'slots'>> = Object.freeze({
  'open-catalog': 'catalog',
  'open-slots': 'slots',
  '11-window-closes': 'catalog',
  '12-pin-launch': 'slots',
  '13-three-weeks': 'catalog',
});

/** The opening state, slots first so the catalog lands on the opening slots. */
export const OH_RESET: readonly string[] = Object.freeze(['open-slots', 'open-catalog']);

/** The slots a day report may be read for. */
export const OH_REPORT_SLOTS: ReadonlySet<string> = new Set(['hero', 'category-rail', 'deals', 'continue', 'grid-promo', 'pdp-modules', 'pdp-offers']);

/** The subject the demo publishes and reads as. TENANTS must grant it the demo tenant. */
export const OH_OPERATOR = 'oh-demo';

/** The values the page may assert as `ctx.intent`, as the visitor would say them. */
export const OH_ASSERTED_INTENTS: ReadonlySet<string> = new Set(['replace', 'remodel', 'new-home', 'upgrade']);

/**
 * The fictional sign-in demo accounts, by name only: a closed list. A demo's sign-in route takes one of these
 * names and nothing else; the secret that signs the assertion exists only on the worker, never here or on a page.
 */
export const OH_ACCOUNTS: readonly string[] = Object.freeze(['Dana Whitfield']);

/** What the cold-start panel says, verbatim, every time. */
export const OH_COLD_START_SENTENCE = 'aggregate, never the individual; we curate, never price.';

/** The dimensions a seeded regional sale may touch, and the exact values each may carry. */
export const OH_SEED_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  category: ['dishwashers', 'dryers', 'kitchen-packages', 'laundry-accessories', 'laundry-sets', 'microwaves', 'pedestals', 'ranges', 'refrigerators', 'soundbars', 'styler', 'tv-mounts', 'tvs', 'washer-dryer-combos', 'washers', 'washtowers'],
  type: ['3-piece', '4-piece', 'all-in-one', 'freestanding', 'french-door', 'front-control', 'front-load', 'hd', 'home-theater', 'lifestyle', 'micro-rgb', 'oled', 'over-the-range', 'pedestal-drawer', 'pedestal-riser', 'pedestal-washer', 'qned', 'rear-control', 'slide-in', 'sound-suite', 'soundbar', 'stacking-kit', 'steam-closet', 'top-control', 'top-load', 'uhd', 'wall-mount', 'washtower'],
  sizeBand: ['24-inch', '30-inch', '42-54', '55-64', '65-74', '75-82', '83-and-up', 'up-to-41'],
  priceTier: ['best', 'better', 'flagship', 'good'],
  fuel: ['dual-fuel', 'electric', 'gas', 'induction'],
};

/** Where the seed door records what it wrote, so the panel can label the lean. */
export const OH_SEED_MARKER_KEY = `demo:${OH_TENANT}:region-seed:v1`;

/** The beat, reset, receipt and report routes, mounted at /oh/api. */
export const OH_ACTIONS: DemoActionConfig = {
  tenant: OH_TENANT,
  operator: OH_OPERATOR,
  beats: OH_BEATS,
  reset: OH_RESET,
  reportSlots: OH_REPORT_SLOTS,
  asserted: OH_ASSERTED_INTENTS,
  beatsPath: '/oh/beats',
  seedScript: 'scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/oh.json',
};

/** The cold-start panel and its seed door, mounted at /oh/api/coldstart. */
export const OH_COLD_START: DemoColdStartConfig = {
  tenant: OH_TENANT,
  vocabulary: OH_SEED_VOCABULARY,
  sentence: OH_COLD_START_SENTENCE,
  markerKey: OH_SEED_MARKER_KEY,
  seedScript: 'scripts/demo-kit/region-seed.mjs --config scripts/demo-kit/configs/oh.json',
  scoredSentence: 'No census term enters any score. The census figure explains the lean; the lean is the brand’s own sales, seeded here as synthetic data.',
};
