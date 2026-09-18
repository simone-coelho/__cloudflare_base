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
// Every link requires configured backend proof, including demo/open modes.
// Historical `assurance: 'site'` records remain readable; no new link receives
// that assurance merely because verification material is missing.
// ---------------------------------------------------------------------------

import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';
import { tenantConfig } from '@/tenancy/middleware';
import { parseIdentitySecrets, requiresSafeIdentity, validateIdentityMaterial } from './material.mjs';

type AssertionEnvironment = Pick<Env, 'IDENTITY_SECRETS' | 'IDENTITY_SALT' | 'AUTH_MODE' | 'TENANTS' | 'DEPLOYMENT_PROFILE'>;

export const ASSERTION_MAX_TTL_S = 24 * 3600;

export type Assurance = 'signed' | 'site';

export function secretTable(env: { IDENTITY_SECRETS?: string }): Map<string, string[]> {
  try { return parseIdentitySecrets(env.IDENTITY_SECRETS); } catch { return new Map(); }
}

/** The secrets that may sign for a tenant: its own, plus any under `*`. */
export function secretsFor(env: AssertionEnvironment, tenant: TenantId): string[] {
  let table: Map<string, string[]>;
  try {
    table = requiresSafeIdentity(env) ? validateIdentityMaterial(env, tenantConfig(env).provisioned) : secretTable(env);
  } catch { return []; }
  let wildcard = env.AUTH_MODE !== 'enforced';
  if (!wildcard) {
    try { const configured = tenantConfig(env); wildcard = configured.provisioned.length === 1 && configured.provisioned.includes(tenant); }
    catch { wildcard = false; }
  }
  return [...(table.get(tenant) ?? []), ...(wildcard ? table.get('*') ?? [] : [])];
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
 * Decide whether a link may proceed: configured backend signature or refusal.
 */
export async function verifyAssertion(
  env: AssertionEnvironment,
  tenant: TenantId,
  claim: { visitorId: string; accountId: string; exp?: number; assertion?: string },
  nowMs = Date.now(),
): Promise<AssertionVerdict> {
  const secrets = secretsFor(env, tenant);
  if (secrets.length === 0) return { ok: false, reason: 'identity verification not configured' };

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
