// src/sdk/identify.ts
// CW25, the client half of identity stitching (docs/architecture/25-identity-stitching.md §4).
// identify() tells the edge which account this browser belongs to; on success the
// browser carries the person's shopper id as its visitor id from then on, and the
// socket reconnects under it, because pushes go to the object named by the id.
// logout() detaches, mints a fresh anonymous id, and reconnects under that. The
// assertion is always computed by the site's backend and handed to the page.
// A proof provider can obtain a fresh visitor-bound assertion after a 409 and
// successful detach; static proof is never reused for a different visitor.

import type { Core } from './core';

export interface IdentifyOptions {
  /** HMAC from the site's backend over tenant, visitorId, accountId and exp (see signAssertion). */
  assertion?: string;
  /** Unix seconds the assertion expires, at most 24 h ahead. */
  exp?: number;
  /** Obtain backend proof for this exact request. Called again after a successful 409 detach. */
  getAssertion?: (claim: { tenant: string; visitorId: string; accountId: string }) =>
    { assertion: string; exp: number } | Promise<{ assertion: string; exp: number }>;
  /** Where the sign-in happened, for the audit trail: 'login', 'checkout', … */
  source?: string;
}

export type IdentifyResult =
  | { ok: true; shopperId: string; visitorId: string; outcome: string | null; retried: boolean }
  | { ok: false; status: number; error: string; retried: boolean };

export interface LogoutResult { ok: boolean; status: number; visitorId: string }

export interface Identity {
  identify(accountId: string, options?: IdentifyOptions): Promise<IdentifyResult>;
  logout(): Promise<LogoutResult>;
}

export function createIdentity(core: Core): Identity {
  const failure = (error: string, status = 0, retried = false): IdentifyResult => ({ ok: false, status, error, retried });
  async function attempt(accountId: string, o: IdentifyOptions, generation: number, retry = false): Promise<
    { visitorId: string; response: Awaited<ReturnType<Core['postJson']>> } | { failure: IdentifyResult }
  > {
    const visitorId = core.visitorId;
    let assertion = o.assertion, exp = o.exp;
    if (o.getAssertion !== undefined) {
      try {
        if (typeof o.getAssertion !== 'function') return { failure: failure('identity proof provider invalid') };
        const proof = await o.getAssertion({ tenant: core.config.tenant, visitorId, accountId });
        if (!core.isCurrent(generation) || core.visitorId !== visitorId) return { failure: failure('identity changed during identify') };
        assertion = proof?.assertion; exp = proof?.exp;
        if (typeof assertion !== 'string' || !assertion.trim() || assertion.length > 200 || !Number.isInteger(exp)) {
          return { failure: failure('identity proof provider returned invalid proof') };
        }
      } catch {
        return { failure: failure('identity proof provider failed') };
      }
    }
    if (!core.isCurrent(generation) || core.visitorId !== visitorId) return { failure: failure('identity changed during identify') };
    const response = await core.postJson(core.config.paths.identityLink, {
      visitorId, accountId,
      ...(o.source ? { source: o.source } : {}),
      ...(typeof exp === 'number' ? { exp } : {}),
      ...(assertion ? { assertion } : {}),
    });
    if (!core.isCurrent(generation) || core.visitorId !== visitorId) return { failure: failure('identity changed during identify', 0, retry) };
    return { visitorId, response };
  }

  async function logout(): Promise<LogoutResult> {
    const g = core.beginTransition();
    try {
      if (!await core.ready(true) || !core.isCurrent(g)) { core.forgetSession(g); return { ok: false, status: 0, visitorId: core.visitorId }; }
      const res = await core.postJson(core.config.paths.identityDetach, { visitorId: core.visitorId });
      const body = res.json as { ok?: unknown; detached?: unknown; session?: unknown } | null;
      const ok = core.isCurrent(g) && res.ok && body?.ok === true && body.detached === true && core.adoptSession(body.session, g, 'logout');
      if (!ok) core.forgetSession(g);
      return { ok, status: res.status, visitorId: core.visitorId };
    } finally { core.finishTransition(g); }
  }

  async function identify(accountId: string, options: IdentifyOptions = {}): Promise<IdentifyResult> {
    if (!accountId || typeof accountId !== 'string') return { ok: false, status: 0, error: 'accountId required', retried: false };
    const g = core.beginTransition();
    try {
    if (!await core.ready(true) || !core.isCurrent(g)) return failure('shopper session unavailable');
    let retried = false;
    let attempted = await attempt(accountId, options, g);
    if ('failure' in attempted) return attempted.failure;
    if (!core.isCurrent(g) || core.visitorId !== attempted.visitorId) return failure('identity changed during identify');
    if (attempted.response.status === 409 && options.getAssertion !== undefined) {
      // A retry needs successful detach AND proof for the freshly minted id.
      const detached = await core.postJson(core.config.paths.identityDetach, { visitorId: attempted.visitorId });
      if (!core.isCurrent(g) || core.visitorId !== attempted.visitorId) return failure('identity changed during identify');
      const body = detached.json as { ok?: unknown; detached?: unknown; session?: unknown } | null;
      if (!detached.ok || body?.ok !== true || body?.detached !== true) return failure('identity detach failed', detached.status);
      if (!core.adoptSession(body.session, g, 'logout')) return failure('identity detach failed', detached.status);
      attempted = await attempt(accountId, options, g, true);
      if ('failure' in attempted) return attempted.failure;
      retried = true;
    }
    if (!core.isCurrent(g) || core.visitorId !== attempted.visitorId) return failure('identity changed during identify', 0, retried);
    const res = attempted.response;
    const body = (res.json ?? {}) as { ok?: boolean; carry?: unknown; shopperId?: unknown; outcome?: unknown; error?: unknown; session?: { subject?: unknown; kind?: unknown } };
    const shopperId = typeof body.carry === 'string' ? body.carry : typeof body.shopperId === 'string' ? body.shopperId : null;
    if (!res.ok || body.ok === false || !shopperId) {
      return { ok: false, status: res.status, error: typeof body.error === 'string' ? body.error : 'link refused', retried };
    }
    if (body.session?.kind !== 'recognized' || body.session.subject !== shopperId || !core.adoptSession(body.session, g, 'identified')) return failure('shopper session unavailable', res.status, retried);
    return { ok: true, shopperId, visitorId: core.visitorId, outcome: typeof body.outcome === 'string' ? body.outcome : null, retried };
    } finally { core.finishTransition(g); }
  }

  return { identify, logout };
}
