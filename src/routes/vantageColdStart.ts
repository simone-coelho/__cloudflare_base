// src/routes/vantageColdStart.ts
// ──────────────────────────────────────────────────────
// The Vantage carrier demo (docs/verizon/Vantage-Demo-Design.md §5): the data
// behind the cold-start panel, and the door its synthetic regional sales are
// seeded through. Lane L1 mounts this sub-app at /vantage/api/coldstart.
//
//   GET  /       credential-free. For the resolved or asserted region: the
//                region, the grain used, the census figure with its vintage
//                and source, the regional lean in force with its label, and the
//                sentence the panel prints.
//   POST /prior  operator only. Replaces one rehearsed region's synthetic sales
//                in the tenant's regional prior (scripts/seed-vantage-region.mjs).
//
// What makes the read safe to expose without a login:
//
//   • It exists only where DEPLOYMENT_PROFILE is 'demo' AND the worker
//     provisions the `vantage` tenant. Anywhere else it answers 404: absent,
//     not merely refused.
//   • It returns aggregates only: public census rows and the population prior
//     the decision path already reads. Nothing about any visitor is read, and
//     the census rows are never an input to any score. The census figure is
//     shown as the public explanation of the lean; the lean is the carrier's own
//     (here synthetic) sales. Nothing ties a neighbourhood's income to a price,
//     a plan, financing, credit or eligibility.
//   • Grain is state or metro, never ZIP: IP location on cellular networks is
//     off by about 200 km at the median, so the edge's postal code is not read.
//     A metro is used only when a caller asserts one, and geo_xref must place
//     it in the region's state.
//
// The seed door is the ordinary region object's own ingest, driven with
// minted-elsewhere operator authority (operatorJwt with a grant on `vantage`),
// on the demo profile, in development, for US states only, over a closed
// vocabulary that carries no census, no household and no line count.
// ──────────────────────────────────────────────────────

import { Hono, type Context } from 'hono';
import type { Env } from '@/types/env';
import type { TenantVariables } from '@/tenancy/tenant';
import type { AuthContext } from '@/middleware/auth';
import { tenantConfig } from '@/tenancy/middleware';
import { operatorJwt } from '@/middleware/operatorAuth';
import { readPublication, PublicationError } from '@/config/publication';
import { DEFAULT_LEARN, LEARN_KIND } from '@/content/kinds';
import type { RegionalConfig } from '@/content/types';
import { demoAssertedRegion } from '@/content/service';
import {
  REGION_GENERATION, REGION_TAU_MS, invalidateTrendCache, lambdaFor, objectName, readTrend, regionKeyOf, rollupTenant,
  sharesWithin, trendKey, type IngestFrame, type TrendSnapshot,
} from '@/reflex/regionTrend';

/** The demo's own tenant. Not configurable: this sub-app exists for one demo. */
export const VANTAGE_TENANT = 'vantage';

/** What the panel says, verbatim, every time. */
export const COLD_START_SENTENCE = 'aggregate, never the individual; we curate, never price.';

/** The dimensions a seeded regional sale may touch, and the exact values each may carry. */
export const SEED_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  category: ['phones', 'plans', 'home-internet', 'accessories', 'watches-tablets'],
  brand: ['apple', 'samsung', 'google', 'motorola'],
  ecosystem: ['ios', 'android'],
  priceBand: ['entry', 'core', 'premium'],
};

/** Where the seed door records what it wrote, so the panel can label the lean. */
export const SEED_MARKER_KEY = `demo:${VANTAGE_TENANT}:region-seed:v1`;

const MAX_ROWS = 64, MAX_UNITS_PER_ROW = 400, MAX_UNITS = 800, MAX_BODY_BYTES = 64 * 1024;

type Ctx = { Bindings: Env; Variables: TenantVariables & { auth: AuthContext } };

export interface SeedMarker {
  generator: string;
  dataSource: 'synthetic';
  swapTo: 'warehouse';
  regions: Record<string, { units: number; seededAt: number; label: string }>;
}

export interface CensusFigure {
  grain: 'metro' | 'state' | 'national';
  geoLevel: string;
  geoKey: string;
  label: string;
  medianHouseholdIncomeUsd: number | null;
  medianHomeValueUsd: number | null;
  /** The table's own provenance, verbatim. */
  source: string;
  vintage: string;
  /** The estimate this figure is, in words the panel prints. */
  estimate: string;
  tables: ['B19013', 'B25077'];
  representative: boolean;
}

const provisioned = (env: Env): boolean => {
  try { return tenantConfig(env).provisioned.includes(VANTAGE_TENANT); } catch { return false; }
};

/** US state region keys only: the census tables and the rehearsed regions are American. */
const stateOf = (region: string | null): string | null => (region && /^US-[A-Z]{2}$/.test(region) ? region.slice(3) : null);

/** State and metro rows of the 2024 ACS are the 1-year file; any ZIP row would be the 2020–2024 5-year file. */
export function estimateOf(level: string, source: string, vintage: string): string {
  if (/^representative/i.test(source)) return `representative: a state-level proxy (${source})`;
  if (level === 'zip') return 'ACS 2020–2024 5-year';
  if (/^Census ACS 2024/i.test(source)) return 'ACS 2024 1-year';
  return `${source}, ${vintage}`;
}

async function censusRow(env: Env, level: 'national' | 'region' | 'metro', key: string): Promise<Omit<CensusFigure, 'grain'> | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT geo_level, geo_key, label, median_hh_income_usd, median_home_value_usd, source, vintage FROM geo_census WHERE geo_level = ?1 AND geo_key = ?2',
    ).bind(level, key).first() as Record<string, unknown> | null;
    if (!row) return null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const source = String(row.source ?? ''), vintage = String(row.vintage ?? '');
    return {
      geoLevel: String(row.geo_level), geoKey: String(row.geo_key), label: String(row.label ?? ''),
      medianHouseholdIncomeUsd: num(row.median_hh_income_usd), medianHomeValueUsd: num(row.median_home_value_usd),
      source, vintage, estimate: estimateOf(String(row.geo_level), source, vintage), tables: ['B19013', 'B25077'],
      representative: /^representative/i.test(source),
    };
  } catch {
    return null; // tables missing or unreadable: the ladder falls through, never throws
  }
}

/** The states geo_xref places a metro (CBSA) in. The crosswalk is read metro-up only, never from a ZIP. */
async function statesOfMetro(env: Env, cbsa: string): Promise<string[]> {
  if (!env.DB) return [];
  try {
    const res = await env.DB.prepare('SELECT DISTINCT region FROM geo_xref WHERE metro_cbsa = ?1').bind(cbsa).all();
    return ((res?.results ?? []) as Array<{ region?: unknown }>).map(r => String(r.region ?? '')).filter(Boolean).sort();
  } catch { return []; }
}

export interface ResolvedRegion { key: string | null; source: 'asserted' | 'edge' | 'none'; metro: string | null; notes: string[] }

/** The asserted region wins, as it does for the prior on the demo profile; else the edge; never a ZIP. */
export async function resolveRegion(env: Env, query: { region?: string; metro?: string }, cf: { country?: string | null; regionCode?: string | null } | null): Promise<ResolvedRegion> {
  const notes: string[] = [];
  const asserted = demoAssertedRegion(env, query.region);
  if (query.region !== undefined && !asserted) notes.push(`"${String(query.region).slice(0, 16)}" is not a region key; the edge region is used`);
  let metro = typeof query.metro === 'string' && /^\d{5}$/.test(query.metro.trim()) ? query.metro.trim() : null;
  if (query.metro !== undefined && !metro) notes.push('a metro is a five-digit CBSA code; none is used');
  let key = asserted, source: ResolvedRegion['source'] = asserted ? 'asserted' : 'none';
  if (metro) {
    const states = await statesOfMetro(env, metro);
    if (!states.length) { notes.push(`geo_xref does not place metro ${metro} in any state; the metro is not used`); metro = null; }
    else if (key && !states.includes(stateOf(key) ?? '')) { notes.push(`metro ${metro} is not in ${key}; the metro is not used`); metro = null; }
    else if (!key) { key = `US-${states[0]}`; source = 'asserted'; }
  }
  if (!key) {
    const edge = regionKeyOf(cf);
    if (edge) { key = edge; source = 'edge'; }
  }
  return { key, source, metro, notes };
}

/** Metro (asserted only) → state → national. Fails closed to national, naming why. */
export async function censusFor(env: Env, region: ResolvedRegion): Promise<{ figure: CensusFigure | null; fellBack: string | null }> {
  if (region.metro) {
    const row = await censusRow(env, 'metro', region.metro);
    if (row) return { figure: { grain: 'metro', ...row }, fellBack: null };
  }
  const state = stateOf(region.key);
  let fellBack: string | null = null;
  if (state) {
    const row = await censusRow(env, 'region', state);
    if (row) return { figure: { grain: 'state', ...row }, fellBack: region.metro ? `no census row for metro ${region.metro}; the state is shown` : null };
    fellBack = `no census rows for ${region.key}; the national figure is shown`;
  } else {
    fellBack = region.key ? `no census rows for ${region.key}; the national figure is shown` : 'no region resolved; the national figure is shown';
  }
  const national = await censusRow(env, 'national', 'US');
  return { figure: national ? { grain: 'national', ...national } : null, fellBack: national ? fellBack : 'census tables unavailable' };
}

/** The leading value of each dimension (share = 1), in registry order. */
function leadersOf(share: TrendSnapshot['share']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dim, values] of Object.entries(share)) {
    const best = Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) out[dim] = best[0];
  }
  return out;
}

async function readMarker(env: Env): Promise<SeedMarker | null> {
  try { return (await env.CACHE.get(SEED_MARKER_KEY, 'json')) as SeedMarker | null; } catch { return null; }
}

async function regionalSettings(env: Env): Promise<RegionalConfig | null> {
  try {
    const learn = (await readPublication(env, LEARN_KIND, VANTAGE_TENANT, true))?.value ?? DEFAULT_LEARN;
    return learn.regional ?? { enabled: false, kBlend: 1, minEvents: 30 };
  } catch (error) {
    if (error instanceof PublicationError) return null;
    throw error;
  }
}

export const vantageColdStartRoutes = new Hono<Ctx>();

// Absent, not merely refused, off the demo profile or where `vantage` is not served.
vantageColdStartRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (c.env.DEPLOYMENT_PROFILE !== 'demo' || !provisioned(c.env)) return c.json({ error: 'Not Found' }, 404);
  return next();
});

vantageColdStartRoutes.get('/', async (c) => {
  const cf = ((c.req.raw as unknown as { cf?: { country?: string; regionCode?: string } }).cf) ?? null;
  const region = await resolveRegion(c.env, { region: c.req.query('region'), metro: c.req.query('metro') }, cf);
  const [census, settings, marker] = await Promise.all([censusFor(c.env, region), regionalSettings(c.env), readMarker(c.env)]);
  const trend = settings ? await readTrend(c.env, VANTAGE_TENANT, region.key, settings.minEvents) : null;
  const seeded = trend && marker ? marker.regions[trend.region] ?? null : null;
  // Labelled by what answered: a region is synthetic only if it was seeded; a
  // country or everyone level is synthetic when any seeded region rolled into it.
  const synthetic = trend?.level === 'region' ? Boolean(seeded) : Boolean(marker && Object.keys(marker.regions).length);
  // Only the dimensions the prior blends (learn.regional.dimensions; absent: all), so the panel never shows
  // a lean the decision does not use: live intent, lines, perk or content type stay off it (lane F3).
  const share = trend ? sharesWithin(trend.snapshot.share, settings?.dimensions) : {};
  const lean = trend ? {
    inForce: Boolean(settings?.enabled),
    level: trend.level, answered: trend.region, events: trend.snapshot.events, minEvents: settings!.minEvents,
    // A stranger has no evidence of her own, so the population speaks at full weight: λ = K/(K + 0).
    lambdaForStranger: lambdaFor(null, settings!.kBlend), kBlend: settings!.kBlend,
    leaders: leadersOf(share), share, publishedAt: trend.snapshot.updatedAt,
    // Labelled for what it is: the seeded synthetic sales (swap to the warehouse), or, with no seed, only this worker's own visits.
    dataSource: synthetic ? 'synthetic' as const : 'observed' as const, swapTo: 'warehouse' as const,
    label: synthetic ? 'synthetic → warehouse' : 'observed on this demo worker only',
    seeded: seeded ? { units: seeded.units, at: seeded.seededAt, label: seeded.label } : null,
    // The region object also counts this demo's own visits from that region, on top of the seed.
    liveEvents: seeded && trend.level === 'region' ? Math.max(0, trend.snapshot.events - seeded.units) : null,
    horizonHours: REGION_TAU_MS / 3_600_000,
  } : null;
  return c.json({
    ok: true, tenant: VANTAGE_TENANT,
    region: { key: region.key, source: region.source, metro: region.metro, notes: region.notes },
    grain: census.figure?.grain ?? null,
    census: census.figure ? { ...census.figure, fellBack: census.fellBack } : null,
    lean,
    prior: settings ? { enabled: settings.enabled, kBlend: settings.kBlend, minEvents: settings.minEvents }
      : { enabled: null, reason: 'the learn document could not be read' },
    scored: { census: false, sentence: 'No census term enters any score. The census figure explains the lean; the lean is the carrier\'s own sales, seeded here as synthetic data.' },
    sentence: COLD_START_SENTENCE,
  });
});

/** One seeded row: the touches one synthetic sale carries, and how many sales. */
interface SeedRow { touches: Record<string, string>; units: number }

function validSeed(body: unknown): { region: string; label: string; rows: SeedRow[] } | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
  const b = body as { region?: unknown; label?: unknown; rows?: unknown };
  const region = typeof b.region === 'string' ? b.region.trim().toUpperCase() : '';
  if (!/^US-[A-Z]{2}$/.test(region)) return 'region must be a US state key, e.g. US-TX';
  if (!Array.isArray(b.rows) || b.rows.length < 1 || b.rows.length > MAX_ROWS) return `rows: 1..${MAX_ROWS}`;
  const rows: SeedRow[] = [];
  let total = 0;
  for (const [index, raw] of b.rows.entries()) {
    const r = raw as { touches?: unknown; units?: unknown } | null;
    if (!r || typeof r !== 'object' || !r.touches || typeof r.touches !== 'object' || Array.isArray(r.touches)) return `rows[${index}].touches: object of dimension → value`;
    const entries = Object.entries(r.touches as Record<string, unknown>);
    if (!entries.length) return `rows[${index}].touches: at least one dimension`;
    for (const [dim, value] of entries) {
      if (!Object.hasOwn(SEED_VOCABULARY, dim)) return `rows[${index}].touches.${dim}: not a seeded dimension (${Object.keys(SEED_VOCABULARY).join(', ')})`;
      if (typeof value !== 'string' || !SEED_VOCABULARY[dim]!.includes(value)) return `rows[${index}].touches.${dim}: one of ${SEED_VOCABULARY[dim]!.join(', ')}`;
    }
    if (typeof r.units !== 'number' || !Number.isSafeInteger(r.units) || r.units < 1 || r.units > MAX_UNITS_PER_ROW) return `rows[${index}].units: whole number 1..${MAX_UNITS_PER_ROW}`;
    total += r.units;
    rows.push({ touches: Object.fromEntries(entries) as Record<string, string>, units: r.units });
  }
  if (total > MAX_UNITS) return `at most ${MAX_UNITS} units per region`;
  const label = (typeof b.label === 'string' ? b.label : '').replace(/[^\p{L}\p{N} .,:;'’()—-]/gu, '').slice(0, 80);
  return { region, label, rows };
}

async function objectCall(env: Env, region: string, path: string, body?: unknown): Promise<boolean> {
  const stub = env.REGION_TREND!.get(env.REGION_TREND!.idFromName(objectName(VANTAGE_TENANT, region)));
  const res = await stub.fetch(`https://region-trend${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const out = await res.json().catch(() => null) as { ok?: boolean } | null;
  return res.ok && out?.ok === true;
}

async function seedPrior(c: Context<Ctx>) {
  if (c.env.ENVIRONMENT !== 'development') return c.json({ ok: false, error: 'seeding is a development-environment demo operation' }, 403);
  if (c.get('tenant') !== VANTAGE_TENANT) return c.json({ ok: false, error: `X-Tenant must be ${VANTAGE_TENANT}` }, 403);
  if (!c.env.REGION_TREND) return c.json({ ok: false, error: 'the region object is not bound on this worker' }, 503);
  if (Number(c.req.header('Content-Length') ?? 0) > MAX_BODY_BYTES) return c.json({ ok: false, error: 'body too large' }, 413);
  const checked = validSeed(await c.req.json().catch(() => null));
  if (typeof checked === 'string') return c.json({ ok: false, error: checked }, 400);
  const { region, label, rows } = checked;

  // Replace, never add: a reseed leaves exactly the synthetic sales this call names.
  if (!await objectCall(c.env, region, '/reset')) return c.json({ ok: false, stage: 'reset', error: 'the region object refused the reset' }, 502);
  const ts = Date.now();
  let frames = 0;
  for (const row of rows) {
    const touches = Object.entries(row.touches).map(([dim, value]) => ({ dim, value }));
    for (let n = 0; n < row.units; n++) {
      const frame: IngestFrame = { generation: REGION_GENERATION, tenant: VANTAGE_TENANT, region, touches, w: 1, ts };
      if (!await objectCall(c.env, region, '/ingest', frame)) return c.json({ ok: false, stage: 'ingest', frames, error: 'the region object refused a frame' }, 502);
      frames++;
    }
  }
  // Publish now rather than on the object's coalescing alarm, so the next read sees it.
  if (!await objectCall(c.env, region, '/publish')) return c.json({ ok: false, stage: 'publish', frames, error: 'the region object did not publish' }, 502);

  const marker: SeedMarker = (await readMarker(c.env)) ?? { generator: 'scripts/seed-vantage-region.mjs', dataSource: 'synthetic', swapTo: 'warehouse', regions: {} };
  marker.regions[region] = { units: frames, seededAt: ts, label };
  await c.env.CACHE.put(SEED_MARKER_KEY, JSON.stringify(marker));
  invalidateTrendCache();
  // The country and everyone levels are sums of the leaf regions (the hourly cron does the same).
  const rollup = await rollupTenant(c.env, VANTAGE_TENANT).catch(() => null);
  const published = await c.env.CACHE.get(trendKey(VANTAGE_TENANT, region), 'json').catch(() => null) as TrendSnapshot | null;
  return c.json({ ok: true, tenant: VANTAGE_TENANT, region, label, frames, dataSource: 'synthetic', swapTo: 'warehouse',
    published: published ? { events: published.events, share: published.share, leaders: leadersOf(published.share) } : null,
    rollup });
}

vantageColdStartRoutes.post('/prior', operatorJwt(), seedPrior);
