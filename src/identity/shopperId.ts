// src/identity/shopperId.ts
// ---------------------------------------------------------------------------
// The canonical shopper id: what a person is called once they are recognised.
//
// A visitor id (`vis-…`) names a browser. An account id names a person, but it
// is the site's, it may be an email, and it must never be a key in our stores,
// a name on a Durable Object, or a column in a record that leaves for the
// warehouse. So a recognised person is named by a salted hash of the account id,
// scoped to the brand: `sh_` + 32 hex characters. Two brands with the same
// account id get two shoppers, which is the isolation rule (CW1) applied to
// people. The same account on two devices gets one shopper, which is the point.
//
// The salt is a secret (IDENTITY_SALT). Without it the hash is still opaque to a
// reader of the store, but a dictionary of account ids could be checked against
// it, so a deployment that handles real accounts sets one. The unsalted fallback
// exists so the demo and the tests run; it is named in the record (`salted:
// false`) rather than hidden.
// ---------------------------------------------------------------------------

import type { TenantId } from '@/tenancy/tenant';

export const SHOPPER_ID_PREFIX = 'sh_';
const UNSALTED = 'edge-identity-unsalted';

/** A canonical shopper id, as this module mints them. */
export function isShopperId(id: string): boolean {
  return /^sh_[0-9a-f]{32}$/.test(id);
}

/** Whether the deployment has a real salt. Recorded on every link. */
export function isSalted(env: { IDENTITY_SALT?: string }): boolean {
  return typeof env.IDENTITY_SALT === 'string' && env.IDENTITY_SALT.trim() !== '';
}

/**
 * The shopper id for an account on a brand. Deterministic, so the same account
 * resolves to the same shopper from any device, any pipeline, any day.
 *
 * The account id is trimmed and nothing else: it is the site's stable account
 * key, sent the same way every time. Case-folding an email would be a kindness
 * that silently merges two accounts on a site that treats them as distinct.
 */
export async function shopperIdFor(
  env: { IDENTITY_SALT?: string },
  tenant: TenantId,
  accountId: string,
): Promise<string> {
  const salt = isSalted(env) ? env.IDENTITY_SALT!.trim() : UNSALTED;
  const material = `${salt}\n${tenant}\n${accountId.trim()}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  return SHOPPER_ID_PREFIX + hex;
}
