// src/demos/@@SLUG@@.config.ts
// ──────────────────────────────────────────────────────
// The @@NAME@@ demo's constants@@CUSTOMER@@ (@@DESIGN@@), in one place, for the demo
// kit's route factories (src/demos/kit, docs/demo-kit/Demo-Kit-Design.md §2.1).
// src/routes/@@SLUG@@.ts builds @@NAME@@'s routes from these and nothing else.
// Scaffolded by scripts/demo-kit/new-demo.mjs from public/@@SLUG@@/demo.config.json;
// the closed beat list below must stay the kit config's seed.beats.publishable.
// ──────────────────────────────────────────────────────

import type { DemoActionConfig } from '@/demos/kit/actionRoutes';
import type { DemoColdStartConfig } from '@/demos/kit/coldStartRoutes';

/** The demo's own tenant. */
export const @@CONST@@_TENANT = '@@TENANT@@';

/**
 * The beat documents the page may ask the worker to publish, and the document
 * kind each one is: files scripts/demo-kit/seed.mjs re-anchors under
 * public/@@SLUG@@/beats/. The list is closed on purpose: it is the whole reason
 * the beat route needs no login. Context beats publish nothing.
 */
export const @@CONST@@_BEATS: Readonly<Record<string, 'catalog' | 'slots'>> = Object.freeze({
@@BEATS@@
});

/** The opening state, slots first so the catalog lands on the opening slots. */
export const @@CONST@@_RESET: readonly string[] = Object.freeze(['open-slots', 'open-catalog']);

/** The slots a day report may be read for. */
export const @@CONST@@_REPORT_SLOTS: ReadonlySet<string> = new Set(@@REPORT_SLOTS@@);

/** The subject the demo publishes and reads as. TENANTS must grant it the demo tenant. */
export const @@CONST@@_OPERATOR = '@@OPERATOR@@';

/** The values the page may assert as `ctx.intent`, as the visitor would say them. */
export const @@CONST@@_ASSERTED_INTENTS: ReadonlySet<string> = new Set(@@ASSERTED@@);

/**
 * The fictional sign-in demo accounts, by name only: a closed list. A demo's sign-in route takes one of these
 * names and nothing else; the secret that signs the assertion exists only on the worker, never here or on a page.
 */
export const @@CONST@@_ACCOUNTS: readonly string[] = Object.freeze(@@ACCOUNTS@@);

/** What the cold-start panel says, verbatim, every time. */
export const @@CONST@@_COLD_START_SENTENCE = @@SENTENCE@@;

/** The dimensions a seeded regional sale may touch, and the exact values each may carry. */
export const @@CONST@@_SEED_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
@@VOCABULARY@@
};

/** Where the seed door records what it wrote, so the panel can label the lean. */
export const @@CONST@@_SEED_MARKER_KEY = `demo:${@@CONST@@_TENANT}:region-seed:v1`;

/** The beat, reset, receipt and report routes, mounted at /@@SLUG@@/api. */
export const @@CONST@@_ACTIONS: DemoActionConfig = {
  tenant: @@CONST@@_TENANT,
  operator: @@CONST@@_OPERATOR,
  beats: @@CONST@@_BEATS,
  reset: @@CONST@@_RESET,
  reportSlots: @@CONST@@_REPORT_SLOTS,
  asserted: @@CONST@@_ASSERTED_INTENTS,
  beatsPath: '/@@SLUG@@/beats',
  seedScript: @@SEED_SCRIPT@@,
};

/** The cold-start panel and its seed door, mounted at /@@SLUG@@/api/coldstart. */
export const @@CONST@@_COLD_START: DemoColdStartConfig = {
  tenant: @@CONST@@_TENANT,
  vocabulary: @@CONST@@_SEED_VOCABULARY,
  sentence: @@CONST@@_COLD_START_SENTENCE,
  markerKey: @@CONST@@_SEED_MARKER_KEY,
  seedScript: @@REGION_SCRIPT@@,
  scoredSentence: @@SCORED@@,
};
