// Shared by the Worker and the add-only staging tool. Never include material in errors.
export const IDENTITY_MATERIAL_UNAVAILABLE = 'Identity material unavailable';
const slug = /^[a-z0-9][a-z0-9-]{0,31}$/;
export function requiresSafeIdentity(env) {
  return env.DEPLOYMENT_PROFILE === 'customer' || env.AUTH_MODE === 'enforced';
}
export function safeIdentitySecret(value) {
  return typeof value === 'string' && value === value.trim()
    && new globalThis.TextEncoder().encode(value).length >= 32 && value.length <= 512
    && !/[\s,|:]/.test(value) && new Set(value).size >= 8
    && !/example|changeme|change-me|replace-me|placeholder|development|test-secret/i.test(value);
}
export function parseIdentitySecrets(raw, safe = false) {
  if (typeof raw !== 'string' || !raw || raw.length > 65536) throw new Error(IDENTITY_MATERIAL_UNAVAILABLE);
  const entries = raw.split(',');
  if (entries.length > 128) throw new Error(IDENTITY_MATERIAL_UNAVAILABLE);
  const table = new Map();
  for (const entry of entries) {
    const split = entry.indexOf(':');
    const tenant = entry.slice(0, split).trim();
    const values = entry.slice(split + 1).split('|').map(value => value.trim());
    if (split < 1 || (tenant !== '*' && !slug.test(tenant)) || table.has(tenant)
      || values.length > 2 || new Set(values).size !== values.length
      || values.some(value => !value || value.length > 512 || /[\r\n,:|]/.test(value)
        || (safe && !safeIdentitySecret(value)))) throw new Error(IDENTITY_MATERIAL_UNAVAILABLE);
    table.set(tenant, values);
  }
  return table;
}
/** Tenants must come from the canonical registry, not from secret binding names. */
export function validateIdentityMaterial(env, tenants) {
  if (!Array.isArray(tenants) || !tenants.length || tenants.some(tenant => !slug.test(tenant))) throw new Error(IDENTITY_MATERIAL_UNAVAILABLE);
  const safe = requiresSafeIdentity(env);
  const table = parseIdentitySecrets(env.IDENTITY_SECRETS, safe);
  if (safe && !safeIdentitySecret(env.IDENTITY_SALT)) throw new Error(IDENTITY_MATERIAL_UNAVAILABLE);
  for (const tenant of tenants) {
    if (!table.has(tenant) && !(tenants.length === 1 && table.has('*') && env.DEPLOYMENT_PROFILE !== 'customer')) throw new Error(IDENTITY_MATERIAL_UNAVAILABLE);
  }
  return table;
}
