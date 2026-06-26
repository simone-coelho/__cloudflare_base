/**
 * /funnel — Revenue Radar funnel compute endpoint.
 *
 *   GET /funnel?brand=Coach&cohort=all   → FunnelResult (see services/funnel/contract.ts)
 *
 * brand defaults to 'Coach' (the live-clickstream brand), cohort to 'all'. Both are
 * validated against the contract's BRANDS / COHORTS allow-lists (400 on an unknown value).
 * The compute layer itself is defensive and never throws; the try/catch is belt-and-braces.
 */
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { BRANDS, COHORTS, CHECKOUT_EVENT_TYPES, type Brand, type Cohort } from '@/services/funnel/contract';
import { computeFunnel } from '@/services/funnel/compute';
import { buildFunnelDiagnosis } from '@/services/funnel/diagnose';

const funnel = new Hono<{ Bindings: Env }>();

funnel.get('/', async (c) => {
  const brand = c.req.query('brand') ?? 'Coach';
  const cohort = c.req.query('cohort') ?? 'all';

  if (!(BRANDS as readonly string[]).includes(brand)) {
    return c.json({ error: `Unknown brand '${brand}'`, allowed: BRANDS }, 400);
  }
  if (cohort !== 'all' && !(COHORTS as readonly string[]).includes(cohort)) {
    return c.json({ error: `Unknown cohort '${cohort}'`, allowed: ['all', ...COHORTS] }, 400);
  }

  try {
    const result = await computeFunnel(c.env, { brand: brand as Brand, cohort: cohort as Cohort });
    return c.json(result);
  } catch (error) {
    console.error('Funnel compute error:', error);
    return c.json(
      { error: 'Failed to compute funnel', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});

// POST /funnel/event — record a REAL checkout-funnel event from the storefront checkout into
// demo_events (the /realtime/action schema enum doesn't allow the checkout event types, so the
// checkout flow posts here). Best-effort: never throws, never blocks checkout. Counts as Coach.
funnel.post('/event', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const et = String(body?.event_type ?? '');
  const allowed = ['add_to_cart', ...CHECKOUT_EVENT_TYPES];
  if (!allowed.includes(et)) return c.json({ error: `bad event_type '${et}'`, allowed }, 400);
  if (c.env.DB && body?.vuid) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO demo_events (ts, vuid, session_id, demo_run_id, event_type, line, price_usd, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'demo')`
      )
        .bind(
          Date.now(),
          String(body.vuid),
          body.sessionId ?? null,
          body.sessionId ?? null,
          et,
          typeof body.line === 'string' ? body.line : null,
          typeof body.price_usd === 'number' ? Math.round(body.price_usd) : null
        )
        .run();
    } catch {
      /* a D1 hiccup must never break the checkout */
    }
  }
  return c.json({ ok: true });
});

// GET /funnel/diagnose?brand=&cohort= → ranked recommendations (same logic as the Opal diagnoseFunnel tool)
funnel.get('/diagnose', async (c) => {
  const diagnosis = await buildFunnelDiagnosis(c.env, {
    brand: c.req.query('brand') ?? 'Coach',
    cohort: c.req.query('cohort') ?? 'gen_z',
  });
  return c.json(diagnosis);
});

export { funnel as funnelRoutes };
