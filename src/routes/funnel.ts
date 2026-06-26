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
import { BRANDS, COHORTS, type Brand, type Cohort } from '@/services/funnel/contract';
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

// GET /funnel/diagnose?brand=&cohort= → ranked recommendations (same logic as the Opal diagnoseFunnel tool)
funnel.get('/diagnose', async (c) => {
  const diagnosis = await buildFunnelDiagnosis(c.env, {
    brand: c.req.query('brand') ?? 'Coach',
    cohort: c.req.query('cohort') ?? 'gen_z',
  });
  return c.json(diagnosis);
});

export { funnel as funnelRoutes };
