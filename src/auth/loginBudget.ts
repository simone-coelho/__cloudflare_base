import type { Env } from '@/types/env';
import type { SigningConfig } from './signingConfig.mjs';

export const LOGIN_BUDGET_OBJECT = 'operator-login:v1';
export const LOGIN_BUDGET_PATH = '/auth/login-budget';
export const LOGIN_WINDOW_MS = 60_000;
export const LOGIN_GLOBAL_LIMIT = 100;
export const LOGIN_SOURCE_LIMIT = 10;
export const LOGIN_BODY_LIMIT = 4096;
export const LOGIN_BUDGET_UNAVAILABLE = 'Sign-in admission unavailable';
export type LoginBudget = { allowed: boolean; remaining: number; resetTime: number };

// Cloudflare ingress must supply this header faithfully. Other caller headers,
// account identifiers and tenant selectors never select a budget or object.
function normalizedSource(raw: string | null): string {
  if (!raw || raw.length > 64) return 'unknown';
  const value = raw.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split('.').map(Number);
    return parts.every(part => part <= 255) ? parts.join('.') : 'unknown';
  }
  if (value.length > 45 || !/^[\da-f:.]+$/i.test(value) || !value.includes(':')) return 'unknown';
  try {
    const canonical = new URL('http://[' + value + ']/').hostname.slice(1, -1);
    const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
    if (mapped) {
      const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }
    return canonical;
  } catch { return 'unknown'; }
}

/** One fixed object, with only an expiring purpose-separated source digest sent to it. */
export async function admitLogin(env: Pick<Env, 'RATE_LIMITER'>, signing: SigningConfig, request: Request): Promise<LoginBudget | null> {
  try {
    const namespace = env.RATE_LIMITER;
    const key = await crypto.subtle.importKey('raw', signing.key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key,
      new TextEncoder().encode(LOGIN_BUDGET_OBJECT + '\0source\0' + normalizedSource(request.headers.get('CF-Connecting-IP'))));
    const sourceKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const response = await namespace.get(namespace.idFromName(LOGIN_BUDGET_OBJECT)).fetch('https://login-budget.invalid' + LOGIN_BUDGET_PATH, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey }),
    });
    if (response.status !== 200) return null;
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const result = value as LoginBudget;
    const now = Date.now();
    if (Object.keys(value).length !== 3 || typeof result.allowed !== 'boolean'
      || !Number.isSafeInteger(result.remaining) || result.remaining < 0 || result.remaining >= LOGIN_SOURCE_LIMIT
      || (!result.allowed && result.remaining !== 0)
      || !Number.isSafeInteger(result.resetTime) || result.resetTime <= now
      || result.resetTime !== Math.floor(now / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS + LOGIN_WINDOW_MS) return null;
    return result;
  } catch { return null; }
}

/** Count streamed bytes, including when Content-Length is missing or dishonest. */
export async function readLoginBody(request: Request): Promise<{ value: unknown; overflow: boolean }> {
  const reader = request.body?.getReader();
  if (!reader) return { value: null, overflow: false };
  const bytes = new Uint8Array(LOGIN_BODY_LIMIT);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > LOGIN_BODY_LIMIT - length) {
        void reader.cancel().catch(() => undefined);
        return { value: null, overflow: true };
      }
      bytes.set(value, length); length += value.byteLength;
    }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, length))), overflow: false };
  } catch { return { value: null, overflow: false }; }
  finally { reader.releaseLock(); }
}
