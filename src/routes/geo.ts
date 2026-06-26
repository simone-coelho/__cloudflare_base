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

export { geo as geoRoutes };
