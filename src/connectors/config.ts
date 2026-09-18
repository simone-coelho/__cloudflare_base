// Customer connector configuration is subordinate to TENANTS, never another registry.
import { z } from 'zod';
import type { Env } from '@/types/env';
import { DEFAULT_TENANT, isValidTenantId } from '@/tenancy/tenant';
import { tenantConfig } from '@/tenancy/middleware';
import { destinationRetentionCategory, type RetentionCategory } from '@/retention';

const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,95}$/).refine(v => !['constructor', 'prototype', '__proto__'].includes(v));
const key = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/);
const reference = z.string().regex(/^CONNECTOR_SECRET_[A-Z0-9_]{1,80}$/);
const url = z.string().url().max(1024).refine(value => {
  const u = new URL(value);
  return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
});
const namespace = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/);
export const SYNTHETIC_BINDINGS = ['CACHE', 'SESSIONS', 'STORAGE', 'EVENT_QUEUE', 'SHOPPER_REFLEX', 'DECISION_RING', 'LEARN_STATS', 'REGION_TREND', 'PERSONALIZATION_WEBSOCKET'] as const;
export const syntheticSchema = z.object({
  version: z.literal(1), enabled: z.literal(true),
  lifetimeMs: z.number().int().min(1000).max(300000),
  stageMs: z.number().int().min(1).max(30000),
  decisionMs: z.number().int().min(1).max(200), eventMs: z.number().int().min(1).max(300),
  thresholdSource: z.literal('document-32-server-diagnostics'),
  destinations: z.array(z.object({ binding: z.enum(SYNTHETIC_BINDINGS), purpose: z.literal('isolated-synthetic-monitor'),
    namespace: z.literal('ops-synthetic-v1'), accessPolicy: key }).strict()).length(SYNTHETIC_BINDINGS.length),
}).strict().refine(v => new Set(v.destinations.map(d => d.binding)).size === SYNTHETIC_BINDINGS.length && v.stageMs <= v.lifetimeMs);
export type SyntheticConfiguration = z.infer<typeof syntheticSchema>;
const telemetrySchema = z.object({
  environment: z.enum(['development', 'staging', 'production', 'test']),
  schema: z.literal('ops-v1'),
  analytics: z.object({ binding: z.literal('ANALYTICS'), dataset: key, accessPolicy: key }).strict().optional(),
  monitor: z.object({ binding: z.literal('CACHE'), namespace: z.literal('monitor'), accessPolicy: key }).strict().optional(),
  alert: z.object({ binding: z.literal('ALERT_WEBHOOK_URL'), destination: key, urlSha256: z.string().regex(/^[a-f0-9]{64}$/), accessPolicy: key }).strict().optional(),
  synthetic: syntheticSchema.optional(),
}).strict();
const fxSchema = z.object({ sdkKeyRef: reference, datafileUrl: url, eventsUrl: url,
  accountId: key, projectId: key, identityNamespace: namespace }).strict();
const actionSchema = z.object({ type: name, action: name.optional(), fields: z.record(
  name.refine(v => !['type', 'action', 'ts', 'idempotence_id', 'identifiers'].includes(v)), name).refine(v => Object.keys(v).length <= 32) }).strict();
const profileField = z.union([z.object({ dimension: name, value: key }).strict(),
  z.object({ dimension: name }).strict(), z.object({ journey: z.literal(true) }).strict()]);
const odpSchema = z.object({ apiHost: url.refine(v => new URL(v).pathname === '/'), publicKeyRef: reference,
  identityNamespace: namespace, actions: z.record(name, actionSchema).refine(v => Object.keys(v).length <= 64),
  audiences: z.record(key, key).refine(v => Object.keys(v).length <= 100),
  profile: z.record(name.refine(v => v !== 'vuid'), profileField).refine(v => Object.keys(v).length <= 100) }).strict();
// These are opt-in capabilities, never ambient provider credentials or tenant
// defaults. Approval identifiers describe configured authority, not live proof.
const approval = z.object({ egress: key, metering: key, providerRetention: key }).strict();
const taxonomy = z.array(z.object({ dimension: name, meaning: z.string().min(1).max(500),
  values: z.array(z.object({ value: key, meaning: z.string().min(1).max(500) }).strict()).min(1).max(200),
}).strict().refine(v => new Set(v.values.map(x => x.value)).size === v.values.length)).min(1).max(32)
  .refine(v => new Set(v.map(x => x.dimension)).size === v.length);
const modelPurpose = z.object({ version: z.literal(1), enabled: z.literal(true), provider: z.literal('google'),
  baseURL: z.literal('https://generativelanguage.googleapis.com/v1beta'), apiKeyRef: reference,
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/), approval,
  timeoutMs: z.number().int().min(100).max(30000), requestBytes: z.number().int().min(1024).max(2 * 1024 * 1024),
  responseBytes: z.number().int().min(1024).max(2 * 1024 * 1024), maxOutputTokens: z.number().int().min(64).max(32768),
  taxonomy,
}).strict();
export const enrichmentConfigurationSchema = modelPurpose.extend({
  fields: z.array(z.enum(['title', 'excerpt', 'subtitle', 'type', 'tags'])).min(1).max(5)
    .refine(v => new Set(v).size === v.length),
  images: z.object({ field: name, origins: z.array(url.refine(v => new URL(v).pathname === '/')).min(1).max(8),
    maxBytes: z.number().int().min(1).max(512 * 1024), maxImages: z.number().int().min(1).max(16),
  }).strict().optional(),
}).strict();
export const searchConfigurationSchema = modelPurpose.extend({
  currency: z.string().regex(/^[A-Z]{3}$/), priceMinorUnits: z.number().int().min(0).max(4),
  priceSource: name,
  giftMeaning: z.string().min(1).max(500),
}).strict();
export const catalogSearchConfigurationSchema = z.object({ version: z.literal(1), enabled: z.literal(true),
  url, tokenRef: reference, approval, mappingRevision: key,
  timeoutMs: z.number().int().min(100).max(30000), responseBytes: z.number().int().min(1024).max(2 * 1024 * 1024),
  maxPages: z.number().int().min(1).max(10), maxCandidates: z.number().int().min(1).max(500),
  maxAgeMs: z.number().int().min(1).max(300000),
}).strict();
const sqlName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
export const warehouseConfigurationSchema = z.object({ version: z.literal(1), enabled: z.literal(true),
  provider: z.literal('snowflake-sql-api'), account: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,100}$/),
  origin: url.refine(v => { const u = new URL(v); return u.pathname === '/' && /^[a-z0-9][a-z0-9.-]*\.snowflakecomputing\.com$/.test(u.hostname); }),
  user: sqlName, keyPairRef: reference, database: sqlName, schema: sqlName, warehouse: sqlName, role: sqlName,
  procedure: z.literal('APPLY_DELIVERY_V1'), identityNamespace: namespace, mappingRevision: key, approval,
  cadenceMs: z.number().int().min(60000).max(86400000), startAt: z.number().int().safe().nonnegative(),
  timeoutMs: z.number().int().min(100).max(30000), responseBytes: z.number().int().min(1024).max(2 * 1024 * 1024),
  maxObjects: z.number().int().min(1).max(100), maxRows: z.number().int().min(1).max(1000),
  maxBytes: z.number().int().min(2 * 1024 * 1024).max(4 * 1024 * 1024),
}).strict();
const registrySchema = z.object({ version: z.literal(1), tenants: z.record(z.string(),
  z.object({ fx: fxSchema.optional(), odp: odpSchema.optional(), telemetry: telemetrySchema.optional(),
    enrichment: enrichmentConfigurationSchema.optional(), search: searchConfigurationSchema.optional(),
    catalogSearch: catalogSearchConfigurationSchema.optional(), warehouse: warehouseConfigurationSchema.optional(),
  }).strict()) }).strict();
export type FxConfiguration = z.infer<typeof fxSchema>;
export type OdpConfiguration = z.infer<typeof odpSchema>;
export type EnrichmentConfiguration = z.infer<typeof enrichmentConfigurationSchema>;
export type SearchConfiguration = z.infer<typeof searchConfigurationSchema>;
export type CatalogSearchConfiguration = z.infer<typeof catalogSearchConfigurationSchema>;
export type WarehouseConfiguration = z.infer<typeof warehouseConfigurationSchema>;
export type ModelConfiguration = EnrichmentConfiguration | SearchConfiguration;
export type TenantConnectors = z.infer<typeof registrySchema>['tenants'][string];
export class ConnectorConfigurationError extends Error {
  constructor() { super('Tenant connector unavailable'); this.name = 'ConnectorConfigurationError'; }
}

/** Explicit demo is the only owner of the legacy stamp-global connector settings. */
export const legacyConnectors = (env: Env, tenant: string): boolean => tenant === DEFAULT_TENANT && env.DEPLOYMENT_PROFILE === 'demo';

export function connectorConfiguration(env: Env, tenant: string): TenantConnectors {
  try {
    const tenants = tenantConfig(env).provisioned;
    if (!tenants.includes(tenant)) throw new ConnectorConfigurationError();
    const raw = env.TENANT_CONNECTORS;
    if (raw === undefined) return {};
    const parsed = JSON.parse(raw);
    // Validate original keys before Zod can discard a special object key.
    if (!parsed?.tenants || typeof parsed.tenants !== 'object' || Array.isArray(parsed.tenants) ||
      Object.keys(parsed.tenants).some(t => !isValidTenantId(t) || !tenants.includes(t))) throw new ConnectorConfigurationError();
    const registry = registrySchema.parse(parsed);
    if (Object.keys(registry.tenants).length > 100 || Object.keys(registry.tenants).some(t => !tenants.includes(t))) throw new ConnectorConfigurationError();
    return Object.hasOwn(registry.tenants, tenant) ? registry.tenants[tenant]! : {};
  } catch { throw new ConnectorConfigurationError(); }
}

export interface OperationalDestination {
  kind: 'analytics' | 'monitor' | 'alert';
  category: RetentionCategory;
  configuration: Record<string, unknown>;
}
/** Desired local controls only, never an attestation of deployed IAM, dataset
 * existence, provider retention, or historical ownership. Operational clocks
 * are intentionally NOT external.* behavioral-copy clocks. */
export async function configuredOperationalDestinations(env: Env, tenant: string): Promise<OperationalDestination[]> {
  const telemetry = connectorConfiguration(env, tenant).telemetry;
  if (!telemetry) return [];
  if (telemetry.environment !== env.ENVIRONMENT) throw new ConnectorConfigurationError();
  const out: OperationalDestination[] = [];
  for (const kind of ['analytics', 'monitor', 'alert'] as const) {
    const descriptor = telemetry[kind];
    if (!descriptor) continue;
    const configuration = { tenant, environment: telemetry.environment, schema: telemetry.schema, ...descriptor };
    out.push({ kind, configuration, category: `telemetry.${kind}.${await connectorDigest(configuration)}` });
  }
  for (const descriptor of telemetry.synthetic?.destinations ?? []) {
    const configuration = { tenant, environment: telemetry.environment, schema: telemetry.schema, ...descriptor };
    out.push({ kind: 'monitor', configuration, category: `telemetry.monitor.${await connectorDigest(configuration)}` });
  }
  return out;
}

/** Resolve only the selected configuration's explicitly named binding. */
export function connectorSecret(env: Env, ref: string): string {
  if (!reference.safeParse(ref).success) throw new ConnectorConfigurationError();
  const value = (env as unknown as Record<string, unknown>)[ref];
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 4096) throw new ConnectorConfigurationError();
  return value;
}

export async function connectorDigest(value: unknown): Promise<string> {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)])) : v;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export async function connectorIdentity(tenant: string, space: string, subject: string): Promise<string> {
  if (!subject || subject.trim() !== subject) throw new ConnectorConfigurationError();
  return (await connectorDigest(['connector-identity-v1', tenant, space, subject])).slice(0, 32);
}

export interface ConfiguredDestination {
  kind: 'odp' | 'fx' | 'tracking' | 'model' | 'catalog' | 'warehouse';
  category: RetentionCategory;
  configuration: Record<string, unknown>;
  identityNamespace?: string;
}
/** Non-secret destination inventory for readiness and durable erasure obligations.
 * This does not resolve a secret or attest that a historical provider was used. */
export async function configuredDestinations(env: Env, tenant: string, unavailable?: () => void): Promise<ConfiguredDestination[]> {
  const connectors = connectorConfiguration(env, tenant), out: ConfiguredDestination[] = [];
  for (const kind of ['odp', 'fx'] as const) {
    const configuration = connectors[kind];
    if (configuration) out.push({ kind, configuration, identityNamespace: configuration.identityNamespace,
      category: await destinationRetentionCategory(kind, configuration) });
  }
  for (const purpose of ['enrichment', 'search', 'catalogSearch', 'warehouse'] as const) {
    const selected = connectors[purpose];
    if (!selected) continue;
    const kind = purpose === 'warehouse' ? 'warehouse' : purpose === 'catalogSearch' ? 'catalog' : 'model';
    const configuration = { purpose, tenant, ...selected };
    out.push({ kind, configuration,
      ...(purpose === 'warehouse' ? { identityNamespace: connectors.warehouse!.identityNamespace } : {}),
      category: await destinationRetentionCategory(kind, configuration) });
  }
  if (legacyConnectors(env, tenant) && !connectors.odp && env.ODP_API_HOST) {
    const configuration = { apiHost: env.ODP_API_HOST, identityNamespace: 'legacy-vuid' };
    out.push({ kind: 'odp', configuration, category: await destinationRetentionCategory('odp', configuration) });
  }
  if (env.WEBHOOK_ENDPOINTS !== undefined) {
    try {
    const parsed = z.array(z.object({ name: z.string().min(1).max(200), type: z.enum(['webhook', 'segment', 'amplitude', 'mixpanel', 'custom']),
      url, enabled: z.boolean() }).passthrough()).max(100).parse(JSON.parse(env.WEBHOOK_ENDPOINTS));
    const names = new Set<string>();
    for (const destination of parsed) {
      if (names.has(destination.name)) throw new ConnectorConfigurationError();
      names.add(destination.name);
      if (!destination.enabled) continue;
      const configuration = { name: destination.name, type: destination.type, url: new URL(destination.url).href };
      out.push({ kind: 'tracking', configuration, category: await destinationRetentionCategory('tracking', configuration) });
    }
    } catch (error) { if (!unavailable) throw error; unavailable(); }
  }
  return out;
}
