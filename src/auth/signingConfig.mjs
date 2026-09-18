/** @typedef {{ key: Uint8Array, issuer: string, audience: string }} SigningConfig */

export const SIGNING_CONFIGURATION_UNAVAILABLE = 'Authentication configuration unavailable';
const PUBLISHED_PLACEHOLDER = 'development-secret-key-change-in-production';

/**
 * Validate once, then use the same snapshot for signing or verification.
 * This checks minimum suitability, not secret entropy or provisioning state.
 * Whitespace is inspected for classification; accepted material is never changed.
 * @param {{ JWT_SECRET?: unknown, JWT_ISSUER?: unknown, JWT_AUDIENCE?: unknown }} env
 * @returns {SigningConfig | null}
 */
export function readSigningConfig(env) {
  const { JWT_SECRET: secret, JWT_ISSUER: issuer, JWT_AUDIENCE: audience } = env;
  if (typeof secret !== 'string' || !secret.trim() || secret.trim() === PUBLISHED_PLACEHOLDER
    || typeof issuer !== 'string' || !issuer.trim()
    || typeof audience !== 'string' || !audience.trim()) return null;
  const key = new TextEncoder().encode(secret);
  if (key.byteLength < 32) return null;
  return { key, issuer, audience };
}
