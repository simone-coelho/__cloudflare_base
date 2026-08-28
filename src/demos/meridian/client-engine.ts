// src/demos/meridian/client-engine.ts
// The browser entry point.
//
// The client keeps its OWN mirror of the affinity vector and applies each touch
// the instant it happens, using the SAME apply() the Durable Object runs. Then
// the server frame arrives and overwrites it. The server stays authoritative;
// the client is a predictor that agrees because it is the identical function.
//
// That is what buys the First National Bank property — no visual beat ever waits
// on the network — without the dishonesty of a local lookup table pretending to
// be an engine. Pull the ethernet cable and the page keeps deciding correctly.
export { compose, SLOT_STRATEGIES, type AffinityView, type ComposeInput } from './composer';
// Section order (D4): where each region sits, per visitor, with its receipt.
export { composeLayout, SECTIONS, OFFER_COPY, type LayoutInput, type LayoutResult } from './layout';
export type { SectionDecision, SectionSpec, SectionStrategy, OfferCopy } from './types';
export { SHAPE_OF_KEY, SHAPE_ORDER, configFor, DEMO_TAUS, PROD_TAUS,
         stageTouchFor, decidingValueFor, stageKeyFor, STAGE_LABELS, expiryOf } from './reflexConfig';
export {
  apply, tick, snapshot, emptyState, extractTouches, effectiveScore, affinityOf,
  type ReflexState, type ReflexConfig, type ReflexResult, type AffinitySnapshot,
  audienceKey,
} from '@/reflex/core';
export { packshot, silhouetteFor } from './silhouettes';
export type { MeridianItem, MeridianBlock, MeridianSlot, MeridianDecision } from './types';
