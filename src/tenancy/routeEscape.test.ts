// src/tenancy/routeEscape.test.ts
//
// objects.test.ts proves shopperObjectName() refuses a namespace-escaping id.
// This proves the ROUTE refuses it too, on the path where it matters: the
// per-shopper Durable Object holds the affinity vector, and every
// shopperObject() call is gated behind REFLEX_HOST='do', which is not the
// default. A live smoke test against the default host never reaches the guard,
// so the assertion has to force that mode.
//
// Shopper routes are owner-dispatched: requireShopper verifies the signed
// capability and forwards the request to the owner object, and
// ownedRequestPath() only recognizes the mounted path (`/realtime/reflex`), not
// a sub-router driven standalone (src/identity/sessionCapability.ts:141-176;
// src/identity/sessionAuthority.ts:478-490, :525-537). So the fixture mounts the
// real app and carries a real capability; the namespace is still a spy.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { tenantMiddleware } from '@/tenancy/middleware';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';

/** A namespace that records what it was asked for and never returns real state. */
function spyNamespace() {
  const asked: string[] = [];
  return {
    asked,
    idFromName(name: string) { asked.push(name); return name; },
    get() {
      return { fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) };
    },
  };
}

function envWithDoHost(reflex: ReturnType<typeof spyNamespace>) {
  return {
    REFLEX_HOST: 'do',
    SHOPPER_REFLEX: reflex,
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) },
    ENVIRONMENT: 'test',
    CONNECTOR_MODE: 'mock',
    // Signing material for the shopper capability the owner dispatch verifies.
    JWT_SECRET: 'routeescape-synthetic-local-signing-material',
    JWT_ISSUER: 'routeescape',
    JWT_AUDIENCE: 'routeescape',
  } as unknown as Record<string, unknown>;
}

/** The worker as it is mounted in src/index.ts, so the path is the real one. */
async function mounted(env: Record<string, unknown>) {
  const { default: realtimeRoutes } = await import('@/routes/realtime');
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  const session = await newAnonymousSession(env as unknown as Env, 'coach');
  const request = (query: string) => app.request(`https://routeescape.invalid/realtime/reflex${query}`,
    { headers: { [SHOPPER_HEADER]: session.capability } }, env);
  return { app, session, request };
}

describe('a namespace-escaping visitor id never reaches another brand object', () => {
  it('asks the namespace for the ordinary id on the happy path', async () => {
    const reflex = spyNamespace();
    const { session, request } = await mounted(envWithDoHost(reflex));
    await request(`?userId=${encodeURIComponent(session.subject)}`);
    // The owner object is addressed by the capability's own subject
    // (src/identity/sessionAuthority.ts:534; src/tenancy/objects.ts:48-54).
    expect(reflex.asked).toEqual([session.subject]);
  });

  it('never asks for the escaping name, and does not answer 2xx', async () => {
    const reflex = spyNamespace();
    const { request } = await mounted(envWithDoHost(reflex));
    const res = await request(`?userId=${encodeURIComponent('t:kate-spade:vis-victim')}`);
    // The object is never addressed...
    expect(reflex.asked).toEqual([]);
    // ...and the caller is refused rather than quietly served someone else's data.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
