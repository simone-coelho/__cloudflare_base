/**
 * /signals — the DETECT layer of the Signal-Led Moment encore (owner: ab-cmab).
 *
 *   GET  /signals/next    — the next trend signal (MockSignalProvider.nextSignal()), with the
 *                           REAL /geo region (request.cf) overlaid onto the signal's mocked region
 *                           as a genuine "this part is live" tell — velocity/window stay mocked.
 *   POST /signals/ingest  — partner-push seam (live: a real push webhook; mock: echo + queue).
 *
 * DETECT is the ONLY mocked stage of the moment — a partner social-listening layer; Optimizely
 * ships no native social listener. simulated:true + the honesty _meta ride along on every response.
 * See docs/architecture/12-signal-led-moment-build-brief.md §4.2 + §6 Phase A4.
 */
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { getConnectors } from '@/connectors';
import signalsData from '@/data/signals.json';

const signals = new Hono<{ Bindings: Env }>();

/** Honest note from the fixture (DETECT is a mocked partner layer) — echoed on every response. */
const META = (signalsData as { _meta?: Record<string, unknown> })._meta ?? {};

// ── GET /signals/next — fixture signal + REAL region overlay (the one live tell) ──────────────
signals.get('/next', async (c) => {
  const signal = await getConnectors(c.env).signals.nextSignal();

  // The ONE genuinely-live part of DETECT: the REAL region from Cloudflare edge geolocation
  // (request.cf), overlaid onto the signal's mocked region. Velocity/window stay mocked.
  // Mirrors src/routes/geo.ts. request.cf is empty under local preview → keep the fixture region.
  const cf: any = (c.req.raw as any).cf || {};
  const realCode = cf.regionCode || cf.region || null;
  const realCountry = cf.country || null;
  const liveRegion = realCode
    ? (realCountry ? `${realCountry}-${realCode}` : String(realCode))
    : signal.region;

  return c.json({
    ...signal,
    region: liveRegion,                 // REAL (live) when available, else the mocked fixture region
    regionMocked: signal.region,        // what the fixture said (for the honesty chip)
    regionLive: !!realCode,             // true → region came from real edge geolocation
    detectedAt: signal.detectedAt && signal.detectedAt > 0 ? signal.detectedAt : Date.now(),
    geo: { country: realCountry, region: cf.region || null, regionCode: cf.regionCode || null, city: cf.city || null, colo: cf.colo || null },
    _meta: META,
  });
});

// ── POST /signals/ingest — partner-push seam (mock echoes/queues; live = real webhook) ─────────
signals.post('/ingest', async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  try {
    const accepted = await getConnectors(c.env).signals.ingest(body);
    return c.json({ ok: true, accepted, queued: true, simulated: accepted.simulated, _meta: META });
  } catch (e) {
    // The live adapter is inert (NotWiredError) until a partner feed is supplied — report honestly.
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e), _meta: META }, 501);
  }
});

export { signals as signalRoutes };
