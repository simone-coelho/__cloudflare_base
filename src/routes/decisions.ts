// src/routes/decisions.ts
// CW4 — the content decision surface (scope appendix §2.3, API-first delivery).
//
//   GET /v1/:tenant/decisions/snapshot?page=home&visitorId=…[&brand=&channel=]
//
// Returns the delivery contract the customer's front end paints (`decisions`,
// one per slot position, addressed by their own content id) and the ledger
// records the outcome-learning design records (`records`, doc 22 §3.1). Reads
// only; never cached; SDK-key authentication arrives with CW10.

import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { serveContentDecisions } from '@/content/service';

export const decisionRoutes = new Hono<{ Bindings: Env }>();

const TENANT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

decisionRoutes.get('/:tenant/decisions/snapshot', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const visitorId = (c.req.query('visitorId') ?? '').trim().slice(0, 128);
  if (!visitorId) return c.json({ ok: false, error: 'visitorId required' }, 400);
  const page = ((c.req.query('page') ?? 'home').trim() || 'home').slice(0, 64);
  const brand = (c.req.query('brand') ?? '').trim() || undefined;
  const channel = (c.req.query('channel') ?? '').trim() || null;
  const cf = ((c.req.raw as unknown as { cf?: unknown }).cf ?? null) as { country?: string; regionCode?: string } | null;

  const out = await serveContentDecisions(c.env, {
    tenant, brand, page, visitorId, channel, cf, cookieHeader: c.req.header('Cookie') ?? null,
  });
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, ...out });
});
