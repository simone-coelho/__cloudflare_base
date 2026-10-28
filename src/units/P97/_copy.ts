// src/units/P97/_copy.ts
// The blank in-memory copy of a brand-new visitor's record (P97, R-P547; _evidence/parity-step3/S44/analyst-first-answer/
// DESIGN.md §4): the first-request door decides a new visitor's first answer with TODAY'S OWN CODE — the ShopperReflex
// class — over empty in-memory storage and a write-refusing environment, contacting, creating and writing nothing, and
// creates the visitor's real record (the namespace's object) right after the answer.
//
// A test reaches that copy the only way it can without a product seam: through the class's own `fetch`, on an instance
// the mounted namespace does not hold. Every call made to such an instance while a watch is active is recorded and handed
// to the watch's `around`, which may hold it, time it, attempt an effect in the copy's own environment or answer for it;
// every call to an object the namespace holds passes through untouched. The class's `fetch` is wrapped once, when this
// module loads (vitest gives every test file its own module graph, so no other file is touched). It holds no expected
// value of any ticket.
//
// Shared, by R10 (R-P548), by src/units/P97/LEDGER.unit.test.ts and by the re-pointed holds of
// src/units/P76/LEDGER.unit.test.ts (P76 FA1) and src/units/P94/LEDGER.unit.test.ts (P94 AD1).

import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import type { Env } from '@/types/env';

import type { Mounted } from '../_parity';

/** One call to the copy. */
export interface CopyCall {
  /** The path the copy was asked: `/identity/activate` (the activation) or `/authority/request` (the forwarded decision). */
  path: string;
  /** The request as it reached the copy; its body is still unread when `around` runs (clone it to read it). */
  request: Request;
  /** The shopper capability the call carried (the minted session's). */
  capability: string | null;
  /** performance.now() when the call reached the copy's `fetch`, and when the copy's answer was handed back. */
  started: number;
  ended: number | null;
  /** The copy's answer: its status and its own headers (an internal answer, never a browser's). */
  status: number | null;
  headers: Headers | null;
}

/**
 * Runs one call to the copy. `proceed()` hands the call to the copy itself and resolves with its answer; what `around`
 * resolves with is what the copy's caller receives. `env` is the copy's own environment (the one its code runs on).
 */
export type AroundCopy = (call: CopyCall, proceed: () => Promise<Response>, env: Env) => Promise<Response>;

export interface CopyWatch {
  /** Every call made to a copy while the watch was active, in the order the calls were made. */
  calls: CopyCall[];
  /** Ends the watch (a later watch replaces an earlier one; only one is active). */
  stop: () => void;
}

const original = ShopperReflex.prototype.fetch;
let active: { m: Mounted; calls: CopyCall[]; around: AroundCopy } | null = null;

ShopperReflex.prototype.fetch = async function watched(this: ShopperReflex, request: Request): Promise<Response> {
  const watch = active;
  // An object the mounted namespace holds is the record itself (today's path, or the record created after the answer).
  if (!watch || [...watch.m.shoppers.values()].some(item => item.object === (this as unknown))) return original.call(this, request);
  const call: CopyCall = { path: new URL(request.url).pathname, request, capability: request.headers.get(SHOPPER_HEADER),
    started: performance.now(), ended: null, status: null, headers: null };
  watch.calls.push(call);
  // The environment the copy's code runs on (the synthetic boundary's view of the environment it was built with).
  const env = (this as unknown as { rawEnv: Env }).rawEnv;
  try {
    const answer = await watch.around(call, () => original.call(this, request), env);
    call.status = answer.status;
    call.headers = new Headers(answer.headers);
    return answer;
  } finally { call.ended = performance.now(); }
};

/** Watches the copies the first-request door builds on mount `m` until `stop()`; `around` runs every call made to one. */
export function watchCopies(m: Mounted, around: AroundCopy = (_call, proceed) => proceed()): CopyWatch {
  const watch = { m, calls: [] as CopyCall[], around };
  active = watch;
  return { calls: watch.calls, stop: () => { if (active === watch) active = null; } };
}
