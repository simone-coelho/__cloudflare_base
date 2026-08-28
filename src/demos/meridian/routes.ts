// src/demos/meridian/routes.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Meridian data plane, mounted at /meridian/api.
//
// It does NOT proxy into /realtime/action. Entering the shared pipeline would
// pull in surface resolution, the Coach catalog's event enrichment, the Coach
// decision set, the shared audience store, and origin-wide cookies — every one
// of which is a way this demo could be broken by, or could break, another.
//
// Nothing here sets a cookie. Identity is the client's own mrd_visitor_id and
// every request arrives with credentials omitted, so the Coach session cookies
// that are scoped Path=/ across this origin never take part.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { itemsFor, blocksFor, catalogStats } from './catalog';
import { configFor, SHAPE_OF_KEY, SHAPE_ORDER } from './reflexConfig';
import { coldStart } from './coldstart';
import { funnel, defectCohortFor, defectDrilldownFor } from './funnel';
import { concierge } from './concierge';
import { search } from './search';
import { propose, vocabularyFor, audienceKeyFor } from './opal';
import { capture, exportRows, MRD_DECISION_COLUMNS } from './receipts';
import { signalsFor, writeMoment } from './moment';
import { scenesFor } from './scenes';
import { dispatch, status as fxStatus, type Flavour } from './experiment';
import type { Vertical } from './types';

const meridian = new Hono<{ Bindings: Env }>();

const VERTICALS = new Set<Vertical>(['retail', 'financial']);
function verticalOf(v: unknown): Vertical {
  return VERTICALS.has(v as Vertical) ? (v as Vertical) : 'retail';
}

/** One object per visitor, keyed on the client's own id namespace. */
function stub(env: Env, visitorId: string) {
  return env.MERIDIAN_REFLEX.get(env.MERIDIAN_REFLEX.idFromName(visitorId));
}

/**
 * The whole catalog, once, at page load. The client composes every slot locally
 * from this — which is why a visual beat never waits on the network. The engine
 * still decides affinity server-side; the page only paints what it already holds.
 */
meridian.get('/catalog', (c) => {
  const vertical = verticalOf(c.req.query('vertical'));
  const cfg = configFor(vertical);
  return c.json({
    ok: true,
    vertical,
    items: itemsFor(vertical),
    blocks: blocksFor(vertical),
    registry: {
      version: cfg.version,
      // The instrument keeps its rows across a swap: same shapes, same order,
      // different labels. The client renders from this, not from a hardcoded list.
      dimensions: cfg.dimensions.map((d) => ({
        key: d.key,
        shape: SHAPE_OF_KEY[d.key],
        tauMs: d.tauMs ?? cfg.tauMs,
        K: d.K ?? cfg.K,
        thetaIn: d.thetaIn ?? cfg.thetaIn,
        thetaOut: d.thetaOut ?? cfg.thetaOut,
        multi: Boolean(d.multi),
        labels: d.labels,
      })),
      shapeOrder: SHAPE_ORDER,
      weights: cfg.weights,
    },
  });
});

/**
 * What we know about someone who has done nothing.
 *
 * `?region=NC` overrides the detected region. That is the venue-wifi safety net
 * and it is meant to be rehearsed with, not discovered on the day — conference
 * networks routinely resolve to somewhere unhelpful.
 */
// The cohort reveal. Traffic is simulated; every rate on this response is
// computed from those rows on this request — including for a cohort we never
// rehearsed, which is the claim that has to survive a question from the floor.
// The concierge. Ids are enum-bound to the live catalogue MINUS what this
// conversation already showed, so hallucinating a product and repeating itself
// are both unrepresentable rather than merely discouraged.
meridian.post('/concierge', async (c) => {
  const body = await c.req.json().catch(() => null as any);
  const vertical = verticalOf(body?.vertical);
  const message = String(body?.message ?? '').slice(0, 400);
  if (!message.trim()) return c.json({ ok: false, reason: 'empty message' }, 200);
  const history = Array.isArray(body?.history) ? body.history.slice(-6) : [];
  const shown = Array.isArray(body?.shown) ? body.shown.map(String) : [];
  const affinity = body?.affinity && typeof body.affinity === 'object' ? body.affinity : {};
  return c.json(await concierge(c.env, vertical, message, history, shown, affinity));
});

meridian.get('/funnel', (c) => {
  const vertical = (c.req.query('vertical') === 'financial' ? 'financial' : 'retail') as Vertical;
  const raw = c.req.query('cohort') ?? '';
  const cohort = raw
    ? raw.split(',').map((p) => p.split(':')).filter((x) => x.length === 2)
        .map(([dim, value]) => ({ dim: dim!.trim(), value: value!.trim() }))
    : [];
  return c.json({
    ok: true,
    ...funnel(vertical, cohort),
    suggested: { first: defectCohortFor(vertical), drilldown: defectDrilldownFor(vertical) },
  });
});

meridian.get('/coldstart', async (c) => {
  const vertical = verticalOf(c.req.query('vertical'));
  const cf = (c.req.raw as any).cf as Record<string, string> | undefined;
  const override = c.req.query('region');
  const geo = override
    ? { country: 'US', regionCode: override.toUpperCase(), city: c.req.query('city') ?? null }
    : cf;
  const out = await coldStart(geo as any, c.env.DB, vertical);
  return c.json({ ...out, overridden: Boolean(override) });
});

/** Live socket. Frames arrive here when an alarm fires with nobody touching anything. */
meridian.get('/ws', async (c) => {
  const visitorId = c.req.query('visitorId');
  if (!visitorId) return c.json({ ok: false, error: 'visitorId required' }, 400);
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.json({ ok: false, error: 'expected websocket upgrade' }, 426);
  }
  const vertical = verticalOf(c.req.query('vertical'));
  const url = `https://do/ws?visitorId=${encodeURIComponent(visitorId)}&vertical=${vertical}`;
  return stub(c.env, visitorId).fetch(new Request(url, { headers: c.req.raw.headers }));
});

meridian.post('/action', async (c) => {
  const body = await c.req.json().catch(() => null as any);
  const visitorId = body?.visitorId;
  if (!visitorId) return c.json({ ok: false, error: 'visitorId required' }, 400);
  const vertical = verticalOf(body?.vertical);
  const events = Array.isArray(body?.events) ? body.events : [body?.event ?? body];
  const res = await stub(c.env, visitorId).fetch(
    new Request('https://do/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, vertical, events }),
    }),
  );
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
});

meridian.get('/snapshot', async (c) => {
  const visitorId = c.req.query('visitorId');
  if (!visitorId) return c.json({ ok: false, error: 'visitorId required' }, 400);
  const res = await stub(c.env, visitorId).fetch(new Request('https://do/snapshot'));
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
});

/** The swap. Same engine, same object, new registry and a fresh vector under it. */
meridian.post('/vertical', async (c) => {
  const body = await c.req.json().catch(() => null as any);
  const visitorId = body?.visitorId;
  if (!visitorId) return c.json({ ok: false, error: 'visitorId required' }, 400);
  const res = await stub(c.env, visitorId).fetch(
    new Request('https://do/vertical', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertical: verticalOf(body?.vertical) }),
    }),
  );
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
});

/** Scoped to this visitor and this surface only. Cannot touch another demo. */
meridian.post('/reset', async (c) => {
  const body = await c.req.json().catch(() => null as any);
  const visitorId = body?.visitorId;
  if (!visitorId) return c.json({ ok: false, error: 'visitorId required' }, 400);
  const res = await stub(c.env, visitorId).fetch(new Request('https://do/reset', { method: 'POST' }));
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
});

/**
 * Ask in language. The model routes the sentence to one of a fixed set of scenes
 * and nothing else; the engine still picks the products, and the copy and artwork
 * were written before the demo started.
 */
meridian.post('/search', async (c) => {
  const body = await c.req.json().catch(() => null as any);
  const vertical = verticalOf(body?.vertical);
  const answer = await search(c.env, vertical, String(body?.query ?? ''));
  return c.json(answer);
});

/** The closed set itself — so the page can show the room what the model may choose from. */
meridian.get('/scenes', (c) => c.json({ ok: true, scenes: scenesFor(verticalOf(c.req.query('vertical'))) }));

/**
 * A paid-campaign arrival was detected; create the experiment it justifies —
 * for real, in the real project, while the room watches.
 */
meridian.post('/experiment/dispatch', async (c) => {
  const body = await c.req.json().catch(() => null as any);
  const flavour = (['ab', 'mab', 'cmab'].includes(body?.flavour) ? body.flavour : 'ab') as Flavour;
  const cohort = Array.isArray(body?.cohort)
    ? body.cohort.filter((k: any) => k && typeof k.dim === 'string' && typeof k.value === 'string')
        .map((k: any) => ({ dim: String(k.dim), value: String(k.value) }))
    : [];
  const out = await dispatch(c.env, verticalOf(body?.vertical), String(body?.source ?? 'tiktok'), flavour, cohort);
  return c.json(out, out.ok ? 200 : 200); // a refusal is information, not an HTTP failure
});

/** Pre-flight. Run this before the session, not during it. */
meridian.get('/experiment/status', (c) => c.json(fxStatus(c.env)));

/**
 * Opal proposes. It does not publish — see opal.ts for why that split is the beat
 * rather than a limitation.
 */
meridian.post('/opal/propose', async (c) => {
  const body = await c.req.json().catch(() => null as any);
  const vertical = verticalOf(body?.vertical);
  const out = await propose(c.env, vertical, String(body?.ask ?? ''));
  return c.json({ ...out, key: out.name ? audienceKeyFor(out.name) : undefined });
});

/** What the model was allowed to choose from — shown on screen, not just claimed. */
meridian.get('/opal/vocabulary', (c) => {
  const vertical = verticalOf(c.req.query('vertical'));
  const v = vocabularyFor(vertical);
  return c.json({ ok: true, vertical, dimensions: Object.keys(v).length,
                  values: Object.values(v).reduce((n, a) => n + a.length, 0), vocabulary: v });
});

/**
 * Capture. Written off the response path — receipts must never be able to slow a
 * decision down.
 */
meridian.post('/decisions', async (c) => {
  const body = await c.req.json().catch(() => null as any);
  if (!body?.visitorId || !Array.isArray(body?.decisions)) {
    return c.json({ ok: false, error: 'visitorId and decisions required' }, 400);
  }
  const input = {
    visitorId: String(body.visitorId), vertical: verticalOf(body.vertical),
    decisions: body.decisions, arrivalSurface: body.arrivalSurface ?? null,
    demoRunId: body.demoRunId ?? null, now: Date.now(),
  };
  c.executionCtx.waitUntil(capture(c.env.DB, input).catch(() => undefined));
  return c.json({ ok: true, queued: input.decisions.length });
});

/** The rows. Hand them over; let them compute their own lift. */
meridian.get('/decisions/export', async (c) => {
  try {
    const out = await exportRows(c.env.DB, c.req.query('visitorId') ?? null, Number(c.req.query('limit') ?? 100));
    return c.json({ ok: true, ...out });
  } catch (e) {
    // D1 may be unbound on a given deployment. Say so rather than returning an
    // empty array that reads like "no decisions were made".
    return c.json({ ok: false, columns: MRD_DECISION_COLUMNS, rows: [],
      error: e instanceof Error ? e.message : String(e) }, 503);
  }
});

/** The simulated feed's catalogue of signals. Labelled as simulated everywhere. */
meridian.get('/moment/signals', (c) =>
  c.json({ ok: true, detectionSimulated: true, signals: signalsFor(verticalOf(c.req.query('vertical'))) }));

/** Opal writes the creative for a signal. It composes onto approved artwork. */
meridian.post('/moment/write', async (c) => {
  const body = await c.req.json().catch(() => null as any);
  const vertical = verticalOf(body?.vertical);
  const signals = signalsFor(vertical);
  const signal = signals.find((s) => s.itemId === body?.itemId) ?? signals[0];
  return c.json(await writeMoment(c.env, vertical, signal));
});

/** Boot check. A mis-seeded catalog fails loudly here rather than quietly on stage. */
meridian.get('/wire-check', (c) => {
  const stats = catalogStats();
  const retail = configFor('retail');
  const financial = configFor('financial');
  const parallel =
    retail.dimensions.length === financial.dimensions.length &&
    // Parallel means the same SHAPES in the same order — not the same source
    // fields. Retail's narrow shape reads `line`, financial's reads `subcategory`;
    // that is the vocabulary difference the flip exists to show, not a fault.
    retail.dimensions.every((d, i) => SHAPE_OF_KEY[d.key] === SHAPE_OF_KEY[financial.dimensions[i].key]);
  return c.json({
    ok: stats.duplicateIds === 0 && parallel && stats.retail > 0 && stats.financial > 0,
    catalog: stats,
    registriesParallel: parallel,
    versions: { retail: retail.version, financial: financial.version },
  });
});

export { meridian as meridianRoutes };
