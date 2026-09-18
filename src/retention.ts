import type { Env } from '@/types/env';
import { tenantConfig } from '@/tenancy/middleware';
import { isValidTenantId } from '@/tenancy/tenant';

export const RETENTION_CATEGORIES = ['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'] as const;
export type RetentionCategory = typeof RETENTION_CATEGORIES[number] | `external.${'odp' | 'fx' | 'tracking' | 'model' | 'catalog' | 'warehouse'}.${string}` | `telemetry.${'analytics' | 'monitor' | 'alert'}.${string}`;
const categoryValid = (value: string): value is RetentionCategory => (RETENTION_CATEGORIES as readonly string[]).includes(value)
  || /^external\.(odp|fx|tracking|model|catalog|warehouse)\.[a-f0-9]{64}$/.test(value) || /^telemetry\.(analytics|monitor|alert)\.[a-f0-9]{64}$/.test(value);
/** Every configured destination gets its own policy key. Only non-secret,
 * canonical destination/mapping descriptors belong in this commitment. */
export async function destinationRetentionCategory(kind: 'odp' | 'fx' | 'tracking' | 'model' | 'catalog' | 'warehouse', descriptor: unknown): Promise<RetentionCategory> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const bytes = JSON.stringify(canonical(descriptor));
  if (!bytes || bytes.length > 64 * 1024) throw new RetentionUnavailable();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bytes));
  return `external.${kind}.${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export interface RetentionPolicy {
  id: string;
  revision: number;
  durationMs: number;
  basis: 'occurred' | 'admitted';
  /** A new record may have a new birth; updating/copying an existing cohort may not. */
  renewal: 'new-record-only';
}
export interface RetentionStamp {
  version: 1;
  tenant: string;
  category: RetentionCategory;
  policyId: string;
  policyRevision: number;
  basis: RetentionPolicy['basis'];
  bornAt: number;
  expiresAt: number;
}
export type RetentionEnv = Pick<Env, 'TENANTS' | 'DEPLOYMENT_PROFILE' | 'RETENTION'>;
export class RetentionUnavailable extends Error {
  constructor() { super('Retention policy or retained-data authority unavailable'); this.name = 'RetentionUnavailable'; }
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const time = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && Number.isFinite(new Date(v as number).getTime());
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(',') === [...keys].sort().join(',');
function checkedPolicy(v: unknown): RetentionPolicy {
  if (!object(v) || !exact(v, ['id', 'revision', 'durationMs', 'basis', 'renewal']) || !identifier(v.id)
    || !Number.isSafeInteger(v.revision) || (v.revision as number) < 1 || !Number.isSafeInteger(v.durationMs) || (v.durationMs as number) < 1
    || (v.basis !== 'occurred' && v.basis !== 'admitted') || v.renewal !== 'new-record-only') throw new RetentionUnavailable();
  return { id: v.id, revision: v.revision as number, durationMs: v.durationMs as number, basis: v.basis, renewal: v.renewal };
}

/** Configuration is subordinate to the complete canonical tenant registry.
 * Missing categories deliberately have no default. This parser never mutates
 * data or interprets the old scan/idle horizons as an approved lifetime. */
export function retentionConfiguration(env: RetentionEnv): Record<string, Partial<Record<RetentionCategory, RetentionPolicy>>> {
  try {
    const tenants = tenantConfig(env).provisioned;
    if (typeof env.RETENTION !== 'string' || !env.RETENTION.trim()) throw new RetentionUnavailable();
    const raw: unknown = JSON.parse(env.RETENTION);
    if (!object(raw) || !exact(raw, ['version', 'tenants']) || raw.version !== 1 || !object(raw.tenants)) throw new RetentionUnavailable();
    const result: Record<string, Partial<Record<RetentionCategory, RetentionPolicy>>> = Object.create(null);
    for (const [tenant, categories] of Object.entries(raw.tenants)) {
      if (!isValidTenantId(tenant) || !tenants.includes(tenant) || !object(categories)) throw new RetentionUnavailable();
      const policies: Partial<Record<RetentionCategory, RetentionPolicy>> = Object.create(null);
      for (const [category, policy] of Object.entries(categories)) {
        if (!categoryValid(category)) throw new RetentionUnavailable();
        policies[category as RetentionCategory] = checkedPolicy(policy);
      }
      result[tenant] = policies;
    }
    return result;
  } catch { throw new RetentionUnavailable(); }
}
export function retentionPolicy(env: RetentionEnv, tenant: string, category: RetentionCategory): RetentionPolicy {
  const policy = retentionConfiguration(env)[tenant]?.[category];
  if (!policy) throw new RetentionUnavailable();
  return policy;
}
/** A missing stamp means legacy, never newly authorized or automatically disposable. */
export function readRetention(value: unknown, tenant: string, category: RetentionCategory): RetentionStamp {
  if (!object(value) || !exact(value, ['version', 'tenant', 'category', 'policyId', 'policyRevision', 'basis', 'bornAt', 'expiresAt'])
    || value.version !== 1 || !isValidTenantId(tenant) || !categoryValid(category) || value.tenant !== tenant || value.category !== category
    || !identifier(value.policyId) || !Number.isSafeInteger(value.policyRevision) || (value.policyRevision as number) < 1
    || (value.basis !== 'occurred' && value.basis !== 'admitted') || !time(value.bornAt) || !time(value.expiresAt) || value.expiresAt <= value.bornAt) throw new RetentionUnavailable();
  return { version: 1, tenant, category, policyId: value.policyId, policyRevision: value.policyRevision as number,
    basis: value.basis, bornAt: value.bornAt, expiresAt: value.expiresAt };
}
export function retentionBirth(env: RetentionEnv, tenant: string, category: RetentionCategory, occurredAt: number, admittedAt = Date.now()): RetentionStamp {
  const policy = retentionPolicy(env, tenant, category), bornAt = policy.basis === 'occurred' ? occurredAt : admittedAt;
  const expiresAt = bornAt + policy.durationMs;
  if (!time(admittedAt) || !time(bornAt) || bornAt > admittedAt || !time(expiresAt) || expiresAt <= admittedAt) throw new RetentionUnavailable();
  return { version: 1, tenant, category, policyId: policy.id, policyRevision: policy.revision, basis: policy.basis, bornAt, expiresAt };
}
/** Admission/replay checks the selected policy AND the immutable original
 * lifetime. A config change may refuse a pending record, never restart it. */
export function requireRetention(env: RetentionEnv, stamp: unknown, tenant: string, category: RetentionCategory, now = Date.now()): RetentionStamp {
  const value = readRetention(stamp, tenant, category), policy = retentionPolicy(env, tenant, category);
  if (!time(now) || value.bornAt > now || value.expiresAt <= now || value.policyId !== policy.id || value.policyRevision !== policy.revision
    || value.basis !== policy.basis || value.expiresAt - value.bornAt !== policy.durationMs) throw new RetentionUnavailable();
  return value;
}
/** Copies and cumulative same-policy cohorts retain the earliest birth. A
 * legacy/mixed cohort must be refused by its caller, not silently retagged. */
export function mergeRetention(left: unknown, right: unknown, tenant: string, category: RetentionCategory): RetentionStamp {
  const a = readRetention(left, tenant, category), b = readRetention(right, tenant, category);
  if (a.policyId !== b.policyId || a.policyRevision !== b.policyRevision || a.basis !== b.basis
    || a.expiresAt - a.bornAt !== b.expiresAt - b.bornAt) throw new RetentionUnavailable();
  return a.expiresAt <= b.expiresAt ? a : b;
}

export type CaptureRetention = Partial<Record<'ledger' | 'online' | 'hourly', RetentionStamp>>;
export type ExternalRetention = Partial<Record<RetentionCategory, RetentionStamp>>;
/** Original source cohort policy, captured before any configured provider await. */
export function externalRetentionBirths(env: RetentionEnv, tenant: string, occurredAt: number, admittedAt = Date.now()): ExternalRetention {
  const result: ExternalRetention = {};
  for (const category of Object.keys(retentionConfiguration(env)[tenant] ?? {}) as RetentionCategory[]) if (category.startsWith('external.')) {
    try { result[category] = retentionBirth(env, tenant, category, occurredAt, admittedAt); } catch { /* no usable authority */ }
  }
  return result;
}
export function mergeExternalRetention(left: ExternalRetention | undefined, right: ExternalRetention | undefined, tenant: string): ExternalRetention {
  const result: ExternalRetention = {};
  for (const category of Object.keys(left ?? {}) as RetentionCategory[]) if (category.startsWith('external.') && right?.[category]) {
    try { result[category] = mergeRetention(left![category], right[category], tenant, category); } catch { /* incompatible copies cannot authorize that destination */ }
  }
  return result;
}
/** One trusted producer admission, before the raw and learning paths diverge.
 * Missing categories remain absent; downstream consumers refuse that purpose. */
export function captureRetention(env: RetentionEnv, tenant: string, occurredAt: number, admittedAt = Date.now()): CaptureRetention {
  const result: CaptureRetention = {};
  for (const category of ['ledger', 'online', 'hourly'] as const) {
    try { result[category] = retentionBirth(env, tenant, category, occurredAt, admittedAt); } catch { /* no policy is no capture authority */ }
  }
  return result;
}
