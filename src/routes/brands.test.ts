// src/routes/brands.test.ts
// The brand picker's list: every provisioned tenant, the default first, and the scope itself.

import { describe, it, expect } from 'vitest';
import type { Env } from '@/types/env';
import { decisionRoutes } from './decisions';

describe('GET /v1/:tenant/brands', () => {
  it('answers the provisioned brands with the default first', async () => {
    const env = { TENANTS: JSON.stringify({ provisioned: ['coach', 'kate-spade'], hosts: {} }) } as unknown as Env;
    const r = await decisionRoutes.request('http://w/coach/brands', {}, env);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, tenant: 'coach', brands: [{ id: 'coach', default: true }, { id: 'kate-spade', default: false }] });
  });
  it('an unconfigured stamp answers its default brand, and the scope asked for', async () => {
    const r = await decisionRoutes.request('http://w/acme/brands', {}, {} as Env);
    const body = (await r.json()) as { brands: Array<{ id: string; default: boolean }> };
    expect(body.brands[0]!.default).toBe(true);
    expect(body.brands.map((b) => b.id)).toContain('acme');
  });
});
