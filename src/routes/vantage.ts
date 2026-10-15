// src/routes/vantage.ts
// ──────────────────────────────────────────────────────
// The Vantage carrier demo (docs/verizon): its merchandiser half and its
// receipts, for the `vantage` tenant.
//
// The page performs a merchandiser's day (two weeks pass, Black Friday arrives,
// the iPhone Duo pre-order is pinned) and shows why every decision came back
// the way it did. Every merchandiser press is a real versioned publish against
// the demo tenant, and every "why these" is the decision's own ledger record,
// because the argument of the demo is that nothing is staged in the browser.
//
// The routes and their safety model (absent off the demo profile, a closed
// list of beat names, a genuine 60-second operator token into the ordinary
// pipeline, receipts for the caller's own decisions only) live in the demo
// kit's factory, src/demos/kit/actionRoutes.ts; Vantage's constants live in
// src/demos/vantage.config.ts. This file builds the one from the other and
// keeps every name it exported before the kit (lane K1), so src/index.ts and
// src/routes/vantage.test.ts import it unchanged.
// ──────────────────────────────────────────────────────

import { demoActionRoutes, type Dispatch } from '@/demos/kit/actionRoutes';
import { assertedContextOf as assertedContextAgainst, ownDecisionId as ownDecisionIdOn, type AssertedContext } from '@/demos/kit/helpers';
import { VANTAGE_ACTIONS, VANTAGE_ASSERTED_INTENTS, VANTAGE_TENANT } from '@/demos/vantage.config';

export { VANTAGE_TENANT, VANTAGE_BEATS, VANTAGE_RESET, VANTAGE_REPORT_SLOTS } from '@/demos/vantage.config';
export { noteOf, publishedDocument, receiptOf, assertedOf, reportTooLarge } from '@/demos/kit/helpers';
export type { AssertedContext } from '@/demos/kit/helpers';

/** Whether a decision id names one of THIS visitor's decisions on the `vantage` tenant. */
export function ownDecisionId(id: unknown, subject: string): id is string {
  return ownDecisionIdOn(id, subject, VANTAGE_TENANT);
}

/** The page's own assertions on a receipt request, against the buy-box toggle's values. */
export function assertedContextOf(value: unknown): AssertedContext | null | Error {
  return assertedContextAgainst(value, VANTAGE_ASSERTED_INTENTS);
}

/** The beat, reset, receipt and report routes, re-entering the worker's own app through `dispatch`. */
export function vantageRoutes(dispatch: Dispatch) {
  return demoActionRoutes({ ...VANTAGE_ACTIONS, dispatch });
}
