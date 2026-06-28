/**
 * /geo — first-touch context for the cold-start, read from Cloudflare's edge geolocation
 * (request.cf). Zero cookies, zero history: country/region/city/timezone + derived hemisphere
 * and LOCAL season, so the storefront can personalize the very first paint ("it already knows
 * where I am, and the season there right now"). request.cf is populated only on the deployed
 * Worker (empty under local preview), so we null-check everything and the client degrades to a
 * generic cold start.
 */
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { computeGeoCohort, getGeoCohortSource, type GeoInput } from '@/services/geo/cohort';

const geo = new Hono<{ Bindings: Env }>();

const FLIP: Record<string, string> = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' };
function seasonFor(hemisphere: string, month: number): string {
  const north = month === 11 || month <= 1 ? 'winter' : month <= 4 ? 'spring' : month <= 7 ? 'summer' : 'autumn';
  return hemisphere === 'S' ? FLIP[north] : north;
}

geo.get('/', (c) => {
  const cf: any = (c.req.raw as any).cf || {};
  const lat = parseFloat(cf.latitude);
  const hemisphere = isFinite(lat) ? (lat >= 0 ? 'N' : 'S') : 'N';
  const season = seasonFor(hemisphere, new Date().getUTCMonth());
  return c.json({
    country: cf.country || null,
    region: cf.region || null,
    regionCode: cf.regionCode || null,
    city: cf.city || null,
    postalCode: cf.postalCode || null,
    latitude: cf.latitude || null,
    longitude: cf.longitude || null,
    timezone: cf.timezone || null,
    continent: cf.continent || null,
    colo: cf.colo || null,   // serving data-center IATA — "served from the edge in {colo}"
    hemisphere,
    season,
  });
});

/**
 * GET /geo/cohort — the geo-cohort cold start (the anti-MasterCard cold start).
 *
 * Thin wrapper (mirrors /funnel) over the shared brain src/services/geo/cohort.ts, with the
 * REAL request.cf geo overlaid exactly like src/routes/signals.ts: identification is REAL
 * (edge geolocation), the query is REAL — only the first-party DATA is synthetic today
 * (dataSource:'synthetic'). Resolves a first-party-gated grain (ZIP → metro → region →
 * national), returns "what shoppers LIKE them, from here, buy" + REAL public census.
 *
 * Query overrides ?zip / ?region / ?city are the LABELED QA / demo path (e.g. the ⌘K
 * force-geo and the Winston-Salem demo moment /geo/cohort?zip=27101&region=NC) — when
 * present, geo.source is reported as 'query' instead of 'edge'.
 *
 * NEVER prices or gates by geography — curation only (doc 13 §10). Defensive end-to-end
 * (computeGeoCohort never throws); the belt-and-braces try/catch keeps the route safe too.
 */
geo.get('/cohort', async (c) => {
  const cf: any = (c.req.raw as any).cf || {};
  const q = c.req.query();
  // If ANY geo query param is present it's the LABELED QA / force-geo override (doc §4) and is
  // SELF-CONTAINED — we do not mix in the real cf (so e.g. ?region=CA can't be overridden by the
  // edge ZIP). Otherwise this is the live cold start: build purely from the REAL request.cf.
  const hasOverride = q.zip != null || q.region != null || q.city != null || q.country != null;
  const geoInput: GeoInput = hasOverride
    ? { zip: q.zip ?? null, region: q.region ?? null, city: q.city ?? null, country: q.country ?? null, source: 'query' }
    : {
        zip: cf.postalCode ?? null,
        region: cf.regionCode ?? cf.region ?? null,
        city: cf.city ?? null,
        country: cf.country ?? null,
        source: 'edge',
      };
  try {
    const cohort = await computeGeoCohort(geoInput, getGeoCohortSource(c.env));
    return c.json(cohort);
  } catch (error) {
    return c.json({ error: 'Failed to compute geo cohort', details: error instanceof Error ? error.message : String(error) }, 500);
  }
});

export { geo as geoRoutes };
