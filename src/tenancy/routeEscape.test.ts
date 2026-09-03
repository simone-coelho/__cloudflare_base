// src/tenancy/routeEscape.test.ts
//
// objects.test.ts proves shopperObjectName() refuses a namespace-escaping id.
// This proves the ROUTE refuses it too, on the path where it matters: the
// per-shopper Durable Object holds the affinity vector, and every
// shopperObject() call is gated behind REFLEX_HOST='do', which is not the
// default. A live smoke test against the default host never reaches the guard,
// so the assertion has to force that mode.

import { describe, it, expect } from 'vitest';

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
  } as unknown as Record<string, unknown>;
}

describe('a namespace-escaping visitor id never reaches another brand object', () => {
  it('asks the namespace for the ordinary id on the happy path', async () => {
    const reflex = spyNamespace();
    const { default: realtimeRoutes } = await import('@/routes/realtime');
    await realtimeRoutes.request('/reflex?userId=vis-normal', {}, envWithDoHost(reflex));
    expect(reflex.asked).toEqual(['vis-normal']);
  });

  it('never asks for the escaping name, and does not answer 2xx', async () => {
    const reflex = spyNamespace();
    const { default: realtimeRoutes } = await import('@/routes/realtime');
    const res = await realtimeRoutes.request(
      `/reflex?userId=${encodeURIComponent('t:kate-spade:vis-victim')}`,
      {},
      envWithDoHost(reflex),
    );
    // The object is never addressed...
    expect(reflex.asked).toEqual([]);
    // ...and the caller is refused rather than quietly served someone else's data.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
