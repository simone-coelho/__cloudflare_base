// src/routes/vantageColdStart.ts
// ──────────────────────────────────────────────────────
// The Vantage carrier demo (docs/verizon/Vantage-Demo-Design.md §5): the data
// behind the cold-start panel, and the door its synthetic regional sales are
// seeded through (scripts/seed-vantage-region.mjs). Lane L1 mounts this sub-app
// at /vantage/api/coldstart.
//
// The read, the seed door and their gates (absent off the demo profile or
// where the worker does not provision `vantage`; the door in development only,
// for X-Tenant: vantage, over a closed vocabulary) live in the demo kit's
// factory, src/demos/kit/coldStartRoutes.ts; Vantage's constants live in
// src/demos/vantage.config.ts. This file builds the one from the other and
// keeps every name it exported before the kit (lane K1), so src/index.ts and
// src/routes/vantageColdStart.test.ts import it unchanged.
// ──────────────────────────────────────────────────────

import { demoColdStartRoutes } from '@/demos/kit/coldStartRoutes';
import { VANTAGE_COLD_START } from '@/demos/vantage.config';

export { VANTAGE_TENANT, COLD_START_SENTENCE, SEED_VOCABULARY, SEED_MARKER_KEY } from '@/demos/vantage.config';
export { estimateOf, resolveRegion, censusFor } from '@/demos/kit/coldStartRoutes';
export type { SeedMarker, CensusFigure, ResolvedRegion } from '@/demos/kit/coldStartRoutes';

export const vantageColdStartRoutes = demoColdStartRoutes(VANTAGE_COLD_START);
