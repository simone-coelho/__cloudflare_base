// src/routes/sort.test.ts
//
// The pure sorter is covered in sortCandidates.test.ts. This proves the route:
// the shape a commerce platform gets back, parity through the wire, and the two
// refusals.

import { describe, it, expect } from 'vitest';
import { sortRoutes } from '@/routes/sort';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) { const r = this.store.get(key); return r === undefined ? null : (type === 'json' ? JSON.parse(r) : r); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(o?: { prefix?: string }) { const p = o?.prefix ?? ''; return { keys: [...this.store.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; }
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    CACHE: new FakeKV(), SESSIONS: new FakeKV(),
    ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock',
    ...overrides,
  } as unknown as Record<string, unknown>;
}

const FEED = [
  { id: 'P1', line: 'Rogue', price_usd: 795 },
  { id: 'P2', line: 'Tabby', price_usd: 380 },
  { id: 'P3', line: 'Tabby', price_usd: 350 },
];

async function post(body: unknown, e = env()) {
  const res = await sortRoutes.request('/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, e);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /sort', () => {
  it('returns the ids in an order, plus the receipt a commerce team can read', async () => {
    const { status, body } = await post({ userId: 'vis-new', candidates: FEED });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.order).toEqual(['P1', 'P2', 'P3']);       // no history: the platform's order stands
    expect(body.tenant).toBe('coach');
    expect(typeof body.configVersion).toBe('string');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('reproduces the feed order at affinity 0, through the wire', async () => {
    const { body } = await post({ userId: 'vis-new', candidates: FEED, weights: { affinity: 0 } });
    expect(body.order).toEqual(['P1', 'P2', 'P3']);
    expect(body.affinityWeight).toBe(0);
  });

  it('refuses a malformed body with 400, not 500', async () => {
    expect((await post({ candidates: FEED })).status).toBe(400);
    expect((await post({ userId: 'v', candidates: 'nope' })).status).toBe(400);
    expect((await post({ userId: 'v', candidates: [{ line: 'x' }] })).status).toBe(400);
  });

  it('bounds the candidate set, because a page of results is not a catalog', async () => {
    const huge = Array.from({ length: 501 }, (_, i) => ({ id: `P${i}` }));
    expect((await post({ userId: 'v', candidates: huge })).status).toBe(400);
  });

  it('refuses a visitor id that addresses another brand, on the DO host', async () => {
    const asked: string[] = [];
    const e = env({
      REFLEX_HOST: 'do',
      SHOPPER_REFLEX: {
        idFromName: (n: string) => { asked.push(n); return n; },
        get: () => ({ fetch: async () => new Response(JSON.stringify({ affinity: { dims: {} } })) }),
      },
    });
    const { status } = await post({ userId: 't:kate-spade:vis-victim', candidates: FEED }, e);
    expect(status).toBe(400);
    expect(asked).toEqual([]);
  });
});
