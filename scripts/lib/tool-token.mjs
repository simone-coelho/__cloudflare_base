import { SignJWT } from 'jose';
import { readSigningConfig } from '../../src/auth/signingConfig.mjs';

const UNAVAILABLE = 'Operator credentials unavailable: provide an explicit operator token or valid JWT_SECRET, JWT_ISSUER and JWT_AUDIENCE for permitted minting.';

/** Preserve absence; a present flag with no value is an invalid explicit override. */
export function tokenFromArgs(argv) {
  const index = argv.indexOf('--token');
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return typeof value === 'string' && !value.startsWith('--') ? value : '';
}

/** Exact loopback targets for tools whose historical minting path is local-only. */
export function isLoopbackTarget(base) {
  try {
    const url = new URL(base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

/** Explicit tokens are opaque; no signing configuration is needed to pass one through. */
export async function resolveToolToken({ token, env = process.env, payload, expiresIn, typ, allowMint = true }) {
  const supplied = token !== undefined ? token : env.OPERATOR_TOKEN;
  if (supplied !== undefined) {
    if (typeof supplied !== 'string' || !supplied.trim()) throw new Error(UNAVAILABLE);
    return supplied;
  }
  const signing = readSigningConfig(env);
  // Customer credentials must be explicitly issued and registered. Possession
  // of signing material alone no longer opts an operational tool into minting.
  if (!allowMint || !signing || env.DEPLOYMENT_PROFILE !== 'demo') throw new Error(UNAVAILABLE);
  return new SignJWT({ ...payload, type: 'service' }).setProtectedHeader({ alg: 'HS256', ...(typ ? { typ } : {}) })
    .setIssuedAt().setIssuer(signing.issuer).setAudience(signing.audience).setExpirationTime(expiresIn).sign(signing.key);
}
