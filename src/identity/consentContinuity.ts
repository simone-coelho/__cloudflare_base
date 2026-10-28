import type { Env } from '@/types/env';
import { consentFromCookies, consentOf, intersectConsent, storedConsent, type Consent } from '@/content/consent';
import { SessionManager } from '@/services/SessionManager';
import { shopperObject } from '@/tenancy/objects';
import { newAnonymousSession, signSessionCapability, SessionAccessError, SHOPPER_HEADER, type MintTarget, type SessionCapability } from './sessionCapability';

/** Exact owned source only; no cookies, user pointers or forwards select state. */
export async function ownedConsent(env: Env, principal: SessionCapability, capability: string, cookie?: string | null): Promise<Consent> {
  let consent: Consent;
  {
    const response = await shopperObject(env.SHOPPER_REFLEX, principal.subject, principal.tenant).fetch('https://shopper-reflex/consent', {
      headers: { [SHOPPER_HEADER]: capability, 'X-Tenant': principal.tenant },
    });
    if (!response.ok) throw new SessionAccessError();
    const body = await response.json() as { ok?: unknown; consent?: unknown };
    if (body.ok !== true || body.consent === undefined) throw new SessionAccessError();
    consent = storedConsent(body.consent);
  }
  return intersectConsent(consent, consentFromCookies(cookie));
}

export async function establishRefusal(env: Env, principal: SessionCapability, capability: string, consent: Consent): Promise<Consent> {
  if (consent.tracking && consent.personalization) return consent;
  const response = await shopperObject(env.SHOPPER_REFLEX, principal.subject, principal.tenant).fetch('https://shopper-reflex/consent/refusal', {
    method: 'POST', headers: { [SHOPPER_HEADER]: capability, 'X-Tenant': principal.tenant, 'Content-Type': 'application/json' }, body: JSON.stringify(consent),
  });
  if (!response.ok) throw new SessionAccessError();
  const body = await response.json() as { ok?: unknown; consent?: unknown };
  if (body.ok !== true || body.consent === undefined) throw new SessionAccessError();
  const stored = storedConsent(body.consent);
  if ((!consent.tracking && stored.tracking) || (!consent.personalization && stored.personalization)) throw new SessionAccessError();
  return stored;
}

/**
 * P97 (FV3, R-P547): the shopper object's own parts of an activation, in whole milliseconds, on the activation's
 * answer only. That answer is an internal hop read here and by the object's own rotation, never passed on: no answer
 * a browser receives carries this header. Its entries are `name;dur=ms`, as Server-Timing writes them.
 */
export const OWNER_TIMING_HEADER = 'X-Owner-Timing';

/**
 * P97 (FV3): the object's lap clock for its activation. `lap(name)` names the time since the previous lap (the first
 * lap counts from `started`); `header()` adds `op`, the object's whole operation from `arrived` (its own arrival),
 * and writes the entries. Reading the clock is all it does: it cannot throw and changes nothing it times.
 */
export function ownerTimer(arrived: number, started: number = performance.now()) {
  const parts: Array<[string, number]> = [];
  let last = started;
  return {
    lap(name: string): void { const now = performance.now(); parts.push([name, Math.max(0, Math.round(now - last))]); last = now; },
    header(): string { return [...parts, ['op', Math.max(0, Math.round(performance.now() - arrived))] as [string, number]].map(([name, ms]) => `${name};dur=${ms}`).join(', '); },
  };
}

/** P97 (FV3): `X-Owner-Timing` read back as name → whole milliseconds; anything else in it is left out, never thrown. */
export function ownerTimingOf(header: string | null): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const entry of (header ?? '').split(',')) {
    const match = /^\s*([a-z]{1,16});dur=(\d{1,9})\s*$/.exec(entry);
    if (match && !Object.hasOwn(parts, match[1]!)) parts[match[1]!] = Number(match[2]);
  }
  return parts;
}

/**
 * P97 (FV3): where the first-request door's session went, beside its `session` entry: `mint` (the issue and signing
 * of the new identifier's pass), `activate` (the activation's round trip to the shopper's object, its answer read) and
 * `object` (the object's own parts of that activation, from `X-Owner-Timing`), in whole milliseconds.
 */
export interface SessionParts { mint?: number; activate?: number; object?: Record<string, number> }

/**
 * The new grant is not returned until every necessary refusal write succeeds.
 * P84: `target`, the class a brand-new browser's page drew, is passed to the mint.
 * P97 (FV3): with `parts`, the mint, the activation's round trip and the object's own parts are recorded in it; a
 * caller that passes none (the session route) is answered exactly as before.
 */
export async function anonymousWithConsent(env: Env, tenant: string, consent: Consent, target?: MintTarget, parts?: SessionParts) {
  const minting = performance.now();
  const session = await newAnonymousSession(env, tenant, target);
  {
    const activating = performance.now();
    const response = await shopperObject(env.SHOPPER_REFLEX, session.subject, tenant).fetch('https://shopper-reflex/identity/activate', {
      method: 'POST', headers: { [SHOPPER_HEADER]: session.capability, 'X-Tenant': tenant, 'Content-Type': 'application/json' }, body: JSON.stringify({ consent }),
    });
    if (!response.ok) throw new SessionAccessError();
    const body = await response.json() as { ok?: unknown; consent?: unknown };
    if (parts) {
      parts.mint = Math.round(activating - minting);
      parts.activate = Math.round(performance.now() - activating);
      parts.object = ownerTimingOf(response.headers.get(OWNER_TIMING_HEADER));
    }
    if (body.ok !== true || body.consent === undefined) throw new SessionAccessError();
    return { ...session, consent: storedConsent(body.consent) };
  }
}

/** A revoked bearer can recover only its exact durable rotation receipt. */
export async function rotateObjectSession(env: Env, principal: SessionCapability, capability: string, operation: 'detach' | 'reset', cookie?: string | null) {
  const response = await shopperObject(env.SHOPPER_REFLEX, principal.subject, principal.tenant).fetch('https://shopper-reflex/identity/rotate', {
    method: 'POST', headers: { [SHOPPER_HEADER]: capability, 'X-Tenant': principal.tenant, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, consent: consentFromCookies(cookie) }),
  });
  if (!response.ok) throw new SessionAccessError();
  const body = await response.json() as { ok?: unknown; grant?: SessionCapability; consent?: unknown };
  if (body.ok !== true || !body.grant || body.grant.tenant !== principal.tenant || body.grant.kind !== 'anonymous' || body.consent === undefined) throw new SessionAccessError();
  return { ...await signSessionCapability(env, body.grant), consent: storedConsent(body.consent) };
}
