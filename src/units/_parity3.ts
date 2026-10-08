// src/units/_parity3.ts
// The third shared harness of the `tapestry-parity-build` unit files: what the
// S3 tickets (P12, P34, P11, P14, P08, P15, P26) need beyond src/units/_parity.ts,
// which is carried byte-for-byte from the S1 branch and never edited here.
//
// It holds no expected value of any ticket. It mounts the identity routes beside
// the routes _parity.ts mounts (as `src/index.ts` mounts them: `/v1` carries both
// the decision and the identity routes), signs what a tenant's backend signs with
// the tenant's own identity material, sends a decision request with extra fields,
// writes exposures and credits into the REAL statistics objects through their own
// doors (as the fan does, src/units/W25/B1.unit.test.ts's idiom) and publishes
// them, and reads the kit sentence by sentence (src/units/P02's idiom).

import { Hono } from 'hono';
import { expect } from 'vitest';

import type { Cell } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { statsName } from '@/learn/fan';
import type { StatsConfig } from '@/learn/stats';
import { identityRoutes } from '@/routes/identity';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

import { BRAND, readTree, TENANT, type Answer, type Decision, type Mounted, type Shopper, type Snapshot } from './_parity';

// ---------------------------------------------------------------------------
// Identity: the link route, mounted as production mounts it.
// ---------------------------------------------------------------------------

/** The tenant's identity material, as the stamp holds it (`IDENTITY_SECRETS`, `tenant:secret`). */
export function identitySecretOf(m: Mounted): string {
  const entry = String(m.env.IDENTITY_SECRETS ?? '').split(',').find(e => e.startsWith(`${TENANT}:`));
  expect(entry, `PRECONDITION (${m.host}): the stamp holds identity material for ${TENANT}`).toBeTruthy();
  return entry!.slice(TENANT.length + 1).split('|')[0]!;
}

const b64url = (bytes: ArrayBuffer): string => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** HMAC-SHA256 over `material`, base64url: what the site's backend computes (src/identity/assertion.ts header). */
export async function hmacOf(secret: string, material: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(material)));
}

/** SHA-256 of a string as lower-case hex: the shape a hashed e-mail commonly takes. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface IdentityDoor {
  /** A shopper call through an app carrying the identity routes as well (`/v1/:tenant/identity/*`). */
  call: (path: string, capability: string, body?: unknown) => Promise<Answer & { headers: Headers }>;
  drain: () => Promise<void>;
}

/**
 * The identity routes on the same bindings as the mounted app: `src/index.ts`
 * mounts `identityRoutes` under `/v1` beside `decisionRoutes`. Every other path
 * is answered by the mounted app itself.
 */
export function identityDoor(m: Mounted): IdentityDoor {
  const pending: Promise<unknown>[] = [];
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/v1', identityRoutes);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await m.drain(); };
  const call: IdentityDoor['call'] = async (path, capability, body) => {
    const request = new Request(`https://shop.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: capability, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = /^\/v1\/[^/]+\/identity\//.test(path)
      ? await app.fetch(request, m.env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext)
      : await m.fetch(request);
    const answer = { status: response.status, headers: response.headers, body: await response.json().catch(() => ({})) as Record<string, unknown> };
    await drain();
    return answer;
  };
  return { call, drain };
}

// ---------------------------------------------------------------------------
// A decision request with fields beyond the page and the brand.
// ---------------------------------------------------------------------------

/** `POST /v1/:tenant/decisions/snapshot` with extra fields (strings, as the route reads every field). */
export async function snapshotWith(m: Mounted, s: Shopper, page: string, fields: Record<string, string>): Promise<Snapshot> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, {
    method: 'POST', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page, brand: BRAND, ...fields }),
  }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return { ...answer, page, ...(fields.pageInstance ? { pageInstance: fields.pageInstance } : {}), decisions: (answer.body.decisions ?? []) as Decision[] };
}

// ---------------------------------------------------------------------------
// Evidence in the real statistics objects.
// ---------------------------------------------------------------------------

/** The configuration a slot's statistics object is written under: what the published learn document states. */
export interface SlotStatsConfig { reward: 'click'; stats: StatsConfig; objective: 'unit'; measurementBasis: 'served-v1' | 'rendered-v1' }

/** One statistics object's door, as the fan reaches it (`statsName`, src/learn/fan.ts:119). */
export async function statsCall(m: Mounted, slot: string, path: string, body?: unknown, page?: string): Promise<Record<string, unknown>> {
  const stub = m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(statsName(TENANT, BRAND, slot, page)));
  const response = await stub.fetch(new Request('https://learn' + path, body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) }));
  return await response.json() as Record<string, unknown>;
}

/** `exposures` exposures and `credits` click credits of one item in one cell, written as the fan writes them. */
export async function feedStats(m: Mounted, input: { slot: string; page?: string; item: string; cell: Cell; exposures: number; credits: number; config: SlotStatsConfig }): Promise<void> {
  const { slot, page, item, cell, exposures, credits, config } = input;
  const ids = { tenant: TENANT, brand: BRAND, slot, ...(page ? { page } : {}), config };
  const exposed = await statsCall(m, slot, '/exposures', { ...ids, exposures: Array.from({ length: exposures }, () => ({ item, cell, ts: Date.now() })) }, page);
  expect(exposed.ok, `PRECONDITION (${m.host}): ${exposures} exposures of ${item} reach ${slot}${page ? ` on ${page}` : ''} (${JSON.stringify(exposed).slice(0, 200)})`).toBe(true);
  if (credits > 0) {
    const credited = await statsCall(m, slot, '/credits', { ...ids, credits: Array.from({ length: credits }, (_, i) => ({ decision_id: `parity3-${slot}-${item}-${i}-${crypto.randomUUID()}`,
      slot, item, cell, reward: config.reward, event: config.reward, ts: Date.now(), weight: 1 })) }, page);
    expect(credited.ok, `PRECONDITION (${m.host}): ${credits} credits of ${item} reach ${slot}${page ? ` on ${page}` : ''} (${JSON.stringify(credited).slice(0, 200)})`).toBe(true);
  }
}

/** Every statistics object of the namespace publishes its snapshot through its own `/publish` door. */
export async function publishStats(m: Mounted): Promise<void> {
  await m.drain();
  for (const name of [...m.stats.keys()]) {
    const published = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/publish', { method: 'POST' });
    expect(await published.json(), `PRECONDITION: ${name} publishes its snapshot`).toMatchObject({ ok: true, published: true });
  }
}

// ---------------------------------------------------------------------------
// The kit.
// ---------------------------------------------------------------------------

/** The sentences of a kit document, flattened, so a statement is judged within one sentence (P02.A5's idiom). */
export const kitSentences = (file: string): string[] => readTree(file).replace(/[‘’]/g, "'").replace(/`/g, '')
  .split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** Each statement the named kit documents lack, as `file: statement`. */
export function missingStatements(files: string[], statements: Array<{ name: string; test: (sentence: string) => boolean }>): string[] {
  const missing: string[] = [];
  for (const file of files) {
    const sentences = kitSentences(file);
    for (const statement of statements) if (!sentences.some(statement.test)) missing.push(`${file}: ${statement.name}`);
  }
  return missing;
}
