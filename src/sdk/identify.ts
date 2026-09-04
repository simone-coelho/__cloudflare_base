// src/sdk/identify.ts
// CW25, the client half of identity stitching (docs/architecture/25-identity-stitching.md §4).
// identify() tells the edge which account this browser belongs to; on success the
// browser carries the person's shopper id as its visitor id from then on, and the
// socket reconnects under it, because pushes go to the object named by the id.
// logout() detaches, mints a fresh anonymous id, and reconnects under that. The
// assertion, when the site has an identity secret, is computed by the site's
// backend at login and handed to the page; without one the link is recorded as
// site-assured. A 409 means this browser still carries the previous person's
// shopper id: the SDK logs that person out and links once more with a fresh id.

import type { Core } from './core';
import { freshVisitorId } from './identity';

export interface IdentifyOptions {
  /** HMAC from the site's backend over tenant, visitorId, accountId and exp (see signAssertion). */
  assertion?: string;
  /** Unix seconds the assertion expires, at most 24 h ahead. */
  exp?: number;
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
  async function attempt(accountId: string, o: IdentifyOptions) {
    return core.postJson(core.config.paths.identityLink, {
      visitorId: core.visitorId, accountId,
      ...(o.source ? { source: o.source } : {}),
      ...(typeof o.exp === 'number' ? { exp: o.exp } : {}),
      ...(o.assertion ? { assertion: o.assertion } : {}),
    });
  }

  async function logout(): Promise<LogoutResult> {
    const previous = core.visitorId;
    const res = await core.postJson(core.config.paths.identityDetach, { visitorId: previous });
    core.setVisitorId(freshVisitorId(core.host), 'logout');
    return { ok: res.ok, status: res.status, visitorId: core.visitorId };
  }

  async function identify(accountId: string, options: IdentifyOptions = {}): Promise<IdentifyResult> {
    if (!accountId || typeof accountId !== 'string') return { ok: false, status: 0, error: 'accountId required', retried: false };
    let retried = false;
    let res = await attempt(accountId, options);
    if (res.status === 409) {
      // The previous person never logged out. Detach, take a fresh id, link once more.
      await logout();
      retried = true;
      res = await attempt(accountId, options);
    }
    const body = (res.json ?? {}) as { ok?: boolean; carry?: unknown; shopperId?: unknown; outcome?: unknown; error?: unknown };
    const shopperId = typeof body.carry === 'string' ? body.carry : typeof body.shopperId === 'string' ? body.shopperId : null;
    if (!res.ok || body.ok === false || !shopperId) {
      return { ok: false, status: res.status, error: typeof body.error === 'string' ? body.error : 'link refused', retried };
    }
    core.setVisitorId(shopperId, 'identified');
    return { ok: true, shopperId, visitorId: core.visitorId, outcome: typeof body.outcome === 'string' ? body.outcome : null, retried };
  }

  return { identify, logout };
}
