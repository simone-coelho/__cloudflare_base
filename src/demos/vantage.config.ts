// src/demos/vantage.config.ts
// ──────────────────────────────────────────────────────
// The Vantage carrier demo's constants (docs/verizon), in one place, for the
// demo kit's route factories (src/demos/kit, docs/demo-kit/Demo-Kit-Design.md
// §2.1). src/routes/vantage.ts and src/routes/vantageColdStart.ts build
// Vantage's routes from these and nothing else: a new demo is a file like this
// one, not a fork of a route.
// ──────────────────────────────────────────────────────

import type { DemoActionConfig } from '@/demos/kit/actionRoutes';
import type { DemoColdStartConfig } from '@/demos/kit/coldStartRoutes';

/** The demo's own tenant. */
export const VANTAGE_TENANT = 'vantage';

/**
 * The beat documents the page may ask the worker to publish, and the document
 * kind each one is. These are files scripts/seed-vantage.mjs writes into
 * public/vantage/beats/. The list is closed on purpose: it is the whole reason
 * the beat route needs no login. Context beats (the other twelve) are read by
 * the page directly and publish nothing.
 */
export const VANTAGE_BEATS: Readonly<Record<string, 'catalog' | 'slots'>> = Object.freeze({
  'open-catalog': 'catalog',
  'open-slots': 'slots',
  '11-two-weeks-pass': 'catalog',
  '12-black-friday': 'catalog',
  '13-pin-duo-preorder': 'slots',
});

/** The opening state, slots first so the catalog lands on the opening slots. */
export const VANTAGE_RESET: readonly string[] = Object.freeze(['open-slots', 'open-catalog']);

/** The slots a day report may be read for. */
export const VANTAGE_REPORT_SLOTS: ReadonlySet<string> = new Set(['hero', 'deals', 'pdp-modules', 'plan-pairing']);

/** The subject the demo publishes and reads as. TENANTS must grant it the demo tenant. */
export const VANTAGE_OPERATOR = 'vantage-demo';

/** The buy-box toggle's values, as the page asserts them on the snapshot (`ctx.intent`). */
export const VANTAGE_ASSERTED_INTENTS: ReadonlySet<string> = new Set(['new', 'add-line', 'upgrade', 'byod']);

/** What the cold-start panel says, verbatim, every time. */
export const COLD_START_SENTENCE = 'aggregate, never the individual; we curate, never price.';

/** The dimensions a seeded regional sale may touch, and the exact values each may carry. */
export const SEED_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  category: ['phones', 'plans', 'home-internet', 'accessories', 'watches-tablets'],
  brand: ['apple', 'samsung', 'google', 'motorola'],
  ecosystem: ['ios', 'android'],
  priceBand: ['entry', 'core', 'premium'],
};

/** Where the seed door records what it wrote, so the panel can label the lean. */
export const SEED_MARKER_KEY = `demo:${VANTAGE_TENANT}:region-seed:v1`;

/** The beat, reset, receipt and report routes, mounted at /vantage/api. */
export const VANTAGE_ACTIONS: DemoActionConfig = {
  tenant: VANTAGE_TENANT,
  operator: VANTAGE_OPERATOR,
  beats: VANTAGE_BEATS,
  reset: VANTAGE_RESET,
  reportSlots: VANTAGE_REPORT_SLOTS,
  asserted: VANTAGE_ASSERTED_INTENTS,
  beatsPath: '/vantage/beats',
  seedScript: 'scripts/seed-vantage.mjs',
};

/** The cold-start panel and its seed door, mounted at /vantage/api/coldstart. */
export const VANTAGE_COLD_START: DemoColdStartConfig = {
  tenant: VANTAGE_TENANT,
  vocabulary: SEED_VOCABULARY,
  sentence: COLD_START_SENTENCE,
  markerKey: SEED_MARKER_KEY,
  seedScript: 'scripts/seed-vantage-region.mjs',
  scoredSentence: 'No census term enters any score. The census figure explains the lean; the lean is the carrier\'s own sales, seeded here as synthetic data.',
};
