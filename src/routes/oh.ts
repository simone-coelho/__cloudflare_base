// src/routes/oh.ts
// ──────────────────────────────────────────────────────
// The OH demo for LG (docs/lg/OH-Demo-Design.md): its merchandiser half, its receipts and
// its cold-start panel, for the `oh` tenant. Thin, by design: the routes and
// their safety model (absent off the demo profile, a closed list of beat names, a
// genuine 60-second operator token into the ordinary pipeline, receipts for the
// caller's own decisions only, the cold-start read in aggregate and never scored)
// live in the demo kit's factories, src/demos/kit/; OH's constants live in
// src/demos/oh.config.ts. Scaffolded by scripts/demo-kit/new-demo.mjs.
//
// Mounted in src/index.ts by the lead (the scaffold prints the lines, never applies them):
//   app.route('/oh/api', ohRoutes(async (request, env, ctx) => app.fetch(request, env, ctx)));
//   app.route('/oh/api/coldstart', ohColdStartRoutes);
// ──────────────────────────────────────────────────────

import { demoActionRoutes, type Dispatch } from '@/demos/kit/actionRoutes';
import { demoColdStartRoutes } from '@/demos/kit/coldStartRoutes';
import { OH_ACTIONS, OH_COLD_START } from '@/demos/oh.config';

export { OH_TENANT, OH_BEATS, OH_RESET, OH_REPORT_SLOTS } from '@/demos/oh.config';

/** The beat, reset, receipt and report routes, re-entering the worker's own app through `dispatch`. */
export function ohRoutes(dispatch: Dispatch) {
  return demoActionRoutes({ ...OH_ACTIONS, dispatch });
}

/** The cold-start panel and its seed door. */
export const ohColdStartRoutes = demoColdStartRoutes(OH_COLD_START);
