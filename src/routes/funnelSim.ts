/**
 * /funnel/sim — Revenue Radar TRAFFIC SIMULATOR control surface (writes funnel_live).
 *
 *   POST /tick   { brand?, sessions? }                              → ambient top-of-funnel stream
 *   POST /burst  { brand, cohort, throughStage, count, convert }    → presenter amplify-on-action
 *   POST /reset  {}                                                 → wipe the live overlay
 *
 * AMBIENT CADENCE IS CLIENT-DRIVEN. Cloudflare Workers have no background timers / cron inside a
 * request, so the service is request-scoped only — it does work solely when called. The storefront
 * runs a `setInterval` that POSTs /tick ~1×/second to produce the ambient "live traffic" motion;
 * the presenter fires /burst on a button press for the hero abandon→recover beats; /reset clears it.
 *
 * Timestamps are minted HERE (Date.now()) and passed into the service as nowMs (the service stays
 * clock-free). Inputs are validated against the shared contract's allow-lists; the service layer is
 * itself best-effort and never throws, so handlers stay thin.
 */
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { BRANDS, COHORTS, STAGE_KEYS, type Brand, type Cohort } from '@/services/funnel/contract';
import { simTick, simAmplify, simReset } from '@/services/funnel/sim';

const funnelSim = new Hono<{ Bindings: Env }>();

const MAX_TICK_SESSIONS = 2000; // sane ceiling so a stray client can't flood the batch
const MAX_BURST_COUNT = 100_000;

const isBrand = (v: unknown): v is Brand => typeof v === 'string' && (BRANDS as readonly string[]).includes(v);
const isCohort = (v: unknown): v is Cohort =>
  typeof v === 'string' && (v === 'all' || (COHORTS as readonly string[]).includes(v));

/** AMBIENT — generate ~`sessions` new add_to_cart sessions for `brand`, walked down the funnel. */
funnelSim.post('/tick', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { brand?: unknown; sessions?: unknown };

  let brand: Brand | undefined;
  if (body.brand !== undefined) {
    if (!isBrand(body.brand)) return c.json({ ok: false, error: `Unknown brand`, allowed: BRANDS }, 400);
    brand = body.brand;
  }

  let sessions: number | undefined;
  if (body.sessions !== undefined) {
    const n = Number(body.sessions);
    if (!Number.isFinite(n)) return c.json({ ok: false, error: `sessions must be a number` }, 400);
    sessions = Math.min(MAX_TICK_SESSIONS, Math.max(0, Math.floor(n)));
  }

  const added = await simTick(c.env, { brand, sessions, nowMs: Date.now() });
  return c.json({ ok: true, brand: brand ?? 'Coach', added });
});

/** AMPLIFY-ON-ACTION — inject `count` sessions reaching `throughStage` (swell), optionally converting (recover). */
funnelSim.post('/burst', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    brand?: unknown;
    cohort?: unknown;
    throughStage?: unknown;
    count?: unknown;
    convert?: unknown;
  };

  if (!isBrand(body.brand)) return c.json({ ok: false, error: `Unknown brand`, allowed: BRANDS }, 400);
  if (!isCohort(body.cohort)) return c.json({ ok: false, error: `Unknown cohort`, allowed: ['all', ...COHORTS] }, 400);
  if (typeof body.throughStage !== 'string' || !STAGE_KEYS.includes(body.throughStage)) {
    return c.json({ ok: false, error: `Unknown throughStage`, allowed: STAGE_KEYS }, 400);
  }
  const count = Math.min(MAX_BURST_COUNT, Math.max(0, Math.floor(Number(body.count))));
  if (!Number.isFinite(count) || count <= 0) return c.json({ ok: false, error: `count must be a positive number` }, 400);

  const added = await simAmplify(c.env, {
    brand: body.brand,
    cohort: body.cohort,
    throughStage: body.throughStage,
    count,
    convert: body.convert === true,
    nowMs: Date.now(),
  });
  return c.json({ ok: true, brand: body.brand, cohort: body.cohort, throughStage: body.throughStage, convert: body.convert === true, added });
});

/** RESET — drop all funnel_live rows; the funnel falls back to seed + real demo_events. */
funnelSim.post('/reset', async (c) => {
  await simReset(c.env);
  return c.json({ ok: true, reset: true });
});

export { funnelSim as funnelSimRoutes };
