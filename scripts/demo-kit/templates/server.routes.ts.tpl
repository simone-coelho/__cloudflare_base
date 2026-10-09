// src/routes/@@SLUG@@.ts
// ──────────────────────────────────────────────────────
// The @@NAME@@ demo@@CUSTOMER@@ (@@DESIGN@@): its merchandiser half, its receipts and
// its cold-start panel, for the `@@TENANT@@` tenant. Thin, by design: the routes and
// their safety model (absent off the demo profile, a closed list of beat names, a
// genuine 60-second operator token into the ordinary pipeline, receipts for the
// caller's own decisions only, the cold-start read in aggregate and never scored)
// live in the demo kit's factories, src/demos/kit/; @@NAME@@'s constants live in
// src/demos/@@SLUG@@.config.ts. Scaffolded by scripts/demo-kit/new-demo.mjs.
//
// Mounted in src/index.ts by the lead (the scaffold prints the lines, never applies them):
//   app.route('/@@SLUG@@/api', @@CAMEL@@Routes(async (request, env, ctx) => app.fetch(request, env, ctx)));
//   app.route('/@@SLUG@@/api/coldstart', @@CAMEL@@ColdStartRoutes);
// ──────────────────────────────────────────────────────

import { demoActionRoutes, type Dispatch } from '@/demos/kit/actionRoutes';
import { demoColdStartRoutes } from '@/demos/kit/coldStartRoutes';
import { @@CONST@@_ACTIONS, @@CONST@@_COLD_START } from '@/demos/@@SLUG@@.config';

export { @@CONST@@_TENANT, @@CONST@@_BEATS, @@CONST@@_RESET, @@CONST@@_REPORT_SLOTS } from '@/demos/@@SLUG@@.config';

/** The beat, reset, receipt and report routes, re-entering the worker's own app through `dispatch`. */
export function @@CAMEL@@Routes(dispatch: Dispatch) {
  return demoActionRoutes({ ...@@CONST@@_ACTIONS, dispatch });
}

/** The cold-start panel and its seed door. */
export const @@CAMEL@@ColdStartRoutes = demoColdStartRoutes(@@CONST@@_COLD_START);
