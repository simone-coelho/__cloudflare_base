// src/identity/assertion.ts
// ---------------------------------------------------------------------------
// Proof that the site, not the page, says who this visitor is.
//
// A link request arrives from the browser carrying the site key, and the site
// key names the SITE. Anything the page can send, anyone with the page can send,
// so with the site key alone a visitor could claim any account id and be handed
// that person's profile. The site's backend knows who is signed in; it signs
// the claim, the page carries the signature, and the worker checks it.
//
// The assertion is an HMAC-SHA256 over exactly what is being asserted:
//
//     tenant \n visitorId \n accountId \n exp
//
// keyed by the tenant's identity secret and encoded base64url. `exp` is unix
// seconds; a signature is good until then and no longer than a day. A secret
// per tenant, in IDENTITY_SECRETS as `tenant:secret[|previous],tenant2:secret`,
// with `|` allowing two to be valid during a rotation.
//
// When a tenant has NO secret configured, a link is accepted on the site key
// alone and the record says so (`assurance: 'site'`). That is the demo setting.
// A deployment that handles real accounts sets the secret, at which point an
// unsigned link is refused; the assurance level is on every link record so a
// reader of the warehouse can tell the two apart.
// ---------------------------------------------------------------------------

import type { TenantId } from '@/tenancy/tenant';

export const ASSERTION_MAX_TTL_S = 24 * 3600;

export type Assurance = 'signed' | 'site';

export function secretTable(env: { IDENTITY_SECRETS?: string }): Map<string, string[]> {
  const table = new Map<string, string[]>();
  for (const entry of (env.IDENTITY_SECRETS ?? '').split(',')) {
    const i = entry.indexOf(':');
    if (i < 0) continue;
    const tenant = entry.slice(0, i).trim();
    const secrets = entry.slice(i + 1).split('|').map((s) => s.trim()).filter(Boolean);
    if (!tenant || secrets.length === 0) continue;
    table.set(tenant, [...(table.get(tenant) ?? []), ...secrets]);
  }
  return table;
}

/** The secrets that may sign for a tenant: its own, plus any under `*`. */
export function secretsFor(env: { IDENTITY_SECRETS?: string }, tenant: TenantId): string[] {
  const table = secretTable(env);
  return [...(table.get(tenant) ?? []), ...(table.get('*') ?? [])];
}

export function assertionMaterial(tenant: TenantId, visitorId: string, accountId: string, exp: number): string {
  return `${tenant}\n${visitorId}\n${accountId}\n${exp}`;
}

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, material: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(material)));
}

/** What the site's backend computes. Exported so a test, and a reference integration, can mint one. */
export async function signAssertion(
  secret: string, tenant: TenantId, visitorId: string, accountId: string, exp: number,
): Promise<string> {
  return hmac(secret, assertionMaterial(tenant, visitorId, accountId, exp));
}

function equalStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type AssertionVerdict =
  | { ok: true; assurance: Assurance }
  | { ok: false; reason: string };

/**
 * Decide whether a link may proceed. Signed when the tenant has a secret and
 * the signature checks; site-assured when the tenant has no secret at all;
 * refused otherwise.
 */
export async function verifyAssertion(
  env: { IDENTITY_SECRETS?: string },
  tenant: TenantId,
  claim: { visitorId: string; accountId: string; exp?: number; assertion?: string },
  nowMs = Date.now(),
): Promise<AssertionVerdict> {
  const secrets = secretsFor(env, tenant);
  if (secrets.length === 0) return { ok: true, assurance: 'site' };

  if (!claim.assertion) return { ok: false, reason: 'identity assertion required for this tenant' };
  const exp = claim.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return { ok: false, reason: 'assertion exp missing' };
  const nowS = Math.floor(nowMs / 1000);
  if (exp <= nowS) return { ok: false, reason: 'assertion expired' };
  if (exp > nowS + ASSERTION_MAX_TTL_S) return { ok: false, reason: 'assertion exp too far ahead' };

  const material = assertionMaterial(tenant, claim.visitorId, claim.accountId, exp);
  for (const secret of secrets) {
    if (equalStrings(await hmac(secret, material), claim.assertion)) return { ok: true, assurance: 'signed' };
  }
  return { ok: false, reason: 'assertion does not verify' };
}
