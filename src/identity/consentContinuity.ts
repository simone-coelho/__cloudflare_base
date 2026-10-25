import type { Env } from '@/types/env';
import { consentFromCookies, consentOf, intersectConsent, storedConsent, type Consent } from '@/content/consent';
import { SessionManager } from '@/services/SessionManager';
import { shopperObject } from '@/tenancy/objects';
import { newAnonymousSession, signSessionCapability, SessionAccessError, SHOPPER_HEADER, type SessionCapability } from './sessionCapability';

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

/** The new grant is not returned until every necessary refusal write succeeds. */
export async function anonymousWithConsent(env: Env, tenant: string, consent: Consent) {
  const session = await newAnonymousSession(env, tenant);
  {
    const response = await shopperObject(env.SHOPPER_REFLEX, session.subject, tenant).fetch('https://shopper-reflex/identity/activate', {
      method: 'POST', headers: { [SHOPPER_HEADER]: session.capability, 'X-Tenant': tenant, 'Content-Type': 'application/json' }, body: JSON.stringify({ consent }),
    });
    if (!response.ok) throw new SessionAccessError();
    const body = await response.json() as { ok?: unknown; consent?: unknown };
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
