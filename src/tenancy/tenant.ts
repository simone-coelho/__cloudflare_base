// src/tenancy/tenant.ts
// ---------------------------------------------------------------------------
// CW1, the foundation: tenant identity and key spacing.
//
// Scope appendix §1.7 promises "per-brand content catalogs, configurations,
// strategy profiles, and audiences, with hard data isolation between brands",
// available on signature. Today there is no tenancy at all: every KV key, D1
// table and Durable Object name is global, and the nine occurrences of the word
// "tenant" in the codebase are comments.
//
// THE DEFAULT TENANT IS UNPREFIXED, AND THAT IS THE WHOLE TRICK. Coach is the
// first tenant and Coach is also the existing key space. If Coach's keys gained a
// prefix, every audience, session, profile and config already stored would be
// orphaned on deploy. So the default tenant reads and writes exactly the keys it
// always did, and every other tenant is namespaced. Nothing migrates. The demo
// registry already uses this pattern for audience keys (`audienceKeyPrefixFor`
// returns '' for coach), and this is the same idea applied to the whole store.
//
// THE DANGER THAT CREATES, STATED SO IT IS NOT DISCOVERED LATER. If the default
// tenant is unprefixed, then code that IGNORES the tenant entirely still behaves
// correctly for Coach. Tenancy will look finished while the core is still
// hardcoded, and the bug only appears when a second brand is provisioned -- which
// is the one moment §1.7 promises is "a provisioning exercise rather than another
// build". Every isolation test therefore uses TWO NON-DEFAULT tenants as well as
// the default, because only that pair can fail.
// ---------------------------------------------------------------------------

/** A brand inside a stamp. Lower-case, url-safe, stable for the life of the brand. */
export type TenantId = string;

/**
 * The tenant whose keys are unprefixed. Coach, confirmed 2026-09-02: the account
 * team's framing, Nitin writing coach.com, and the fact that the existing catalog,
 * audiences and seeds are all Coach's already.
 */
export const DEFAULT_TENANT: TenantId = 'coach';

const TENANT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** A tenant id is part of a key, so it must not be able to escape its namespace. */
export function isValidTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && TENANT_RE.test(value);
}

export interface TenantSignals {
  /** An explicit choice: a route parameter, a body field, a job argument. */
  explicit?: string | null;
  /** The `X-Tenant` header, for server-to-server callers. */
  header?: string | null;
  /** The request host, for brands on their own domain. */
  host?: string | null;
  /** host -> tenant, supplied by stamp configuration. */
  hostMap?: Record<string, TenantId> | null;
}

/**
 * Resolve which brand a request belongs to.
 *
 * Precedence is explicit, then header, then host. An unrecognised or malformed
 * value resolves to the DEFAULT TENANT rather than throwing or inventing one:
 * the failure mode of a bad tenant id must be "you got Coach", never "you got
 * another brand's data" and never a 500 on the decision path.
 */
export function resolveTenant(signals: TenantSignals): TenantId {
  const explicit = normalize(signals.explicit);
  if (isValidTenantId(explicit)) return explicit;

  const header = normalize(signals.header);
  if (isValidTenantId(header)) return header;

  const host = normalize(signals.host);
  if (host && signals.hostMap) {
    const mapped = signals.hostMap[host];
    if (isValidTenantId(mapped)) return mapped;
  }
  return DEFAULT_TENANT;
}

function normalize(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * The key `tenant` should use for a logical key.
 *
 * The default tenant gets the bare key, so everything already stored keeps
 * working. Every other tenant is prefixed `t:{tenant}:`, which no existing key
 * uses.
 */
export function tenantKey(tenant: TenantId, key: string): string {
  return tenant === DEFAULT_TENANT ? key : `t:${tenant}:${key}`;
}

/** The prefix a tenant's keys carry. Empty for the default tenant. */
export function tenantPrefix(tenant: TenantId): string {
  return tenant === DEFAULT_TENANT ? '' : `t:${tenant}:`;
}

/**
 * The logical key behind a physical one, or null when it belongs to a different
 * tenant. Used to strip the namespace back off when listing.
 */
export function logicalKey(tenant: TenantId, physical: string): string | null {
  const prefix = tenantPrefix(tenant);
  if (prefix === '') {
    // The default tenant owns everything that is NOT namespaced to someone else.
    return physical.startsWith('t:') ? null : physical;
  }
  return physical.startsWith(prefix) ? physical.slice(prefix.length) : null;
}

// -- The scoped store --------------------------------------------------------

/** The subset of KVNamespace this wrapper needs, so tests can supply a fake. */
export interface KVLike {
  get(key: string, type?: string): Promise<unknown>;
  put(key: string, value: string, options?: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete?: boolean;
    cursor?: string;
  }>;
}

/**
 * A KV namespace scoped to one tenant.
 *
 * Callers pass the LOGICAL key they always passed, and get back logical keys from
 * list(). The namespacing is invisible, which is what makes this adoptable one
 * store at a time instead of in a single sweep: a call site that has not been
 * converted keeps working against the default tenant, and a converted one is
 * isolated. Half-converted is therefore safe, which matters because a partially
 * tenanted key space that throws is worse than one that is merely incomplete.
 */
export class TenantKV implements KVLike {
  constructor(private readonly kv: KVLike, readonly tenant: TenantId) {}

  private physical(key: string): string {
    return tenantKey(this.tenant, key);
  }

  get(key: string, type?: string): Promise<unknown> {
    return this.kv.get(this.physical(key), type);
  }

  put(key: string, value: string, options?: unknown): Promise<void> {
    return this.kv.put(this.physical(key), value, options);
  }

  delete(key: string): Promise<void> {
    return this.kv.delete(this.physical(key));
  }

  /**
   * List within this tenant, returning logical names.
   *
   * The default tenant needs the extra filter: its physical prefix is empty, so
   * an unfiltered list would sweep up every other tenant's namespaced keys as
   * well. That is precisely the isolation leak the unprefixed default invites,
   * and it is the reason logicalKey() rejects anything starting with `t:`.
   */
  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete?: boolean;
    cursor?: string;
  }> {
    const logicalPrefix = options?.prefix ?? '';
    const res = await this.kv.list({
      ...options,
      prefix: tenantKey(this.tenant, logicalPrefix),
    });
    const keys: Array<{ name: string }> = [];
    for (const k of res.keys) {
      const name = logicalKey(this.tenant, k.name);
      if (name !== null && name.startsWith(logicalPrefix)) keys.push({ ...k, name });
    }
    return { ...res, keys };
  }
}
