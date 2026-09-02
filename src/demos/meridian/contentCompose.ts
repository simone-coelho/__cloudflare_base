// src/demos/meridian/contentCompose.ts
// The content composer is engine arithmetic and lives with the engine:
// src/reflex/contentCompose.ts. Re-exported here so every Meridian import path
// keeps working and the stage runs the real function, not a copy of it. The
// isolation charter (README.md, isolation.test.ts) allows that module by name.
export { composeContent, composeContentDetailed } from '@/reflex/contentCompose';
export type {
  ContentPieceLike, ContentSlotSpec, ContentDecision, AffinityViewLike, SlotCandidate, ComposeContentResult,
} from '@/reflex/contentCompose';
