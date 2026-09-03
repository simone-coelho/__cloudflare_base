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
import { NAMESPACE_MARKER, type TenantVariables } from '@/tenancy/tenant';
import { enqueueDecisions } from '@/ledger/enqueue';
import { findById, type R2Like } from '@/ledger/writer';
import type { DecisionRecord } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import { readTrend, regionKeyOf, rollupTenant } from '@/reflex/regionTrend';
import { liftKey, ringName } from '@/learn/fan';
import { jwt } from '@/middleware/auth';

export const decisionRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();

const TENANT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/**
 * GET /v1/:tenant/trend[?region=US-NY]
 * The population prior in force for a region: which level answered (region,
 * country, everyone), how much evidence it holds, and the shares themselves.
 * Aggregates only, so it is open. Absent ?region=, the request's own geolocation.
 */
decisionRoutes.get('/:tenant/trend', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const cf = ((c.req.raw as unknown as { cf?: { country?: string; regionCode?: string } }).cf) ?? null;
  const region = (c.req.query('region') ?? '').trim().toUpperCase() || regionKeyOf(cf);
  const minEvents = Math.max(1, Number(c.req.query('minEvents') ?? 30) || 30);
  const read = await readTrend(c.env, tenant, region, minEvents);
  c.header('Cache-Control', 'no-store');
  if (!read) return c.json({ ok: true, tenant, region, level: null, snapshot: null });
  return c.json({ ok: true, tenant, region, asked: region, level: read.level, answered: read.region, snapshot: read.snapshot });
});

/**
 * GET /v1/:tenant/lift?slot=hero[&brand=]
 * The lift snapshot in force for a slot: every item's decayed counts, estimate and
 * lift at every pooling level, and the slot's own rate per cell. Aggregates only,
 * so it is open. This is the console's grid (doc 22 §12.2) as data.
 */
decisionRoutes.get('/:tenant/lift', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const slot = (c.req.query('slot') ?? '').trim();
  if (!slot) return c.json({ ok: false, error: 'slot required' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  let snapshot: unknown = null;
  try { snapshot = await c.env.CACHE.get(liftKey(tenant, brand, slot), 'json'); } catch { snapshot = null; }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, brand, slot, snapshot });
});

/** GET /v1/:tenant/visitors/:visitorId/recent: what this visitor was shown, from her own object. Authenticated. */
decisionRoutes.get('/:tenant/visitors/:visitorId/recent', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const visitorId = (c.req.param('visitorId') ?? '').trim();
  if (!TENANT.test(tenant) || !visitorId || visitorId.startsWith(NAMESPACE_MARKER)) return c.json({ ok: false, error: 'bad tenant or visitor id' }, 400);
  const ns = c.env.DECISION_RING;
  if (!ns) return c.json({ ok: false, error: 'ring not bound' }, 503);
  const res = await ns.get(ns.idFromName(ringName(tenant, visitorId))).fetch('https://learn/recent');
  c.header('Cache-Control', 'no-store');
  return c.json(await res.json());
});

/** POST /v1/:tenant/trend/rollup: what the hourly cron does, on demand. Authenticated. */
decisionRoutes.post('/:tenant/trend/rollup', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  return c.json({ ok: true, tenant, ...(await rollupTenant(c.env, tenant)) });
});

decisionRoutes.get('/:tenant/decisions/snapshot', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const visitorId = (c.req.query('visitorId') ?? '').trim().slice(0, 128);
  if (!visitorId) return c.json({ ok: false, error: 'visitorId required' }, 400);
  // A visitor id is a Durable Object name and a session key. One that starts with
  // the namespace marker would address another brand's namespace directly.
  if (visitorId.startsWith(NAMESPACE_MARKER)) return c.json({ ok: false, error: 'visitorId may not start with the namespace marker' }, 400);
  const page = ((c.req.query('page') ?? 'home').trim() || 'home').slice(0, 64);
  const brand = (c.req.query('brand') ?? '').trim() || undefined;
  const channel = (c.req.query('channel') ?? '').trim() || null;
  const cf = ((c.req.raw as unknown as { cf?: unknown }).cf ?? null) as { country?: string; regionCode?: string } | null;

  // Two names, on purpose, until CW1 provisions tenants: the path names the SCOPE
  // the documents are read under; the tenancy middleware names the brand whose
  // shopper state and session this request belongs to.
  const out = await serveContentDecisions(c.env, {
    tenant, brand, page, visitorId, channel, cf, cookieHeader: c.req.header('Cookie') ?? null,
    stateTenant: c.get('tenant'),
  });
  // Phase 0 and Phase 1, after the response, never on it: the ledger, the visitor's ring, each slot's exposures.
  const ledger = enqueueDecisions(c.env, out.records);
  try { c.executionCtx.waitUntil(ledger); c.executionCtx.waitUntil(out.afterResponse); } catch { void ledger; void out.afterResponse; }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, ...out });
});

/**
 * GET /v1/:tenant/ledger/:id[?stream=outcome]
 * One record by id, straight from R2 with no index (doc 22 §3.4): the id names
 * the brand and the hour, the batch objects are named by the id range they hold.
 * Authenticated, because a record carries a visitor id. Behind by the queue lag
 * during a peak; exact afterwards.
 */
decisionRoutes.get('/:tenant/ledger/:id', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const id = (c.req.param('id') ?? '').trim();
  if (!TENANT.test(tenant) || !id.startsWith(`${tenant}:`)) return c.json({ ok: false, error: 'id must belong to the tenant in the path' }, 400);
  const stream = c.req.query('stream') === 'outcome' ? 'outcome' : 'decision';
  const found = await findById<DecisionRecord | OutcomeRecord>(c.env.STORAGE as unknown as R2Like, id, stream);
  c.header('Cache-Control', 'no-store');
  return found ? c.json({ ok: true, stream, key: found.key, record: found.record }) : c.json({ ok: false, error: 'not found, or not yet written by the consumer' }, 404);
});
