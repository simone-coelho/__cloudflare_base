/**
 * Geo-Cohort Cold Start — SHARED BRAIN (single source of truth).
 *
 * The "anti-MasterCard" cold start: a brand-new visitor with no profile → infer a
 * geo-cohort from (a) the customer's OWN first-party purchase history for that geography
 * and (b) REAL public census income/home-value data, and open the store on "what shoppers
 * LIKE them, from here, actually buy." Geo is a COARSE OPENING PRIOR we replace with real
 * behaviour the instant they engage. See docs/architecture/13-geo-cohort-coldstart-prd-tdd.md.
 *
 * This module is consumed by BOTH `GET /geo/cohort` (src/routes/geo.ts) AND the Opal
 * `geoCohort` tool (src/agents/tools/geoCohort.ts) — the same shared-brain triangle as
 * diagnose.ts / funnel.ts / diagnoseFunnel.ts, so the storefront and the chat narrate the
 * IDENTICAL numbers.
 *
 *   resolveGeoRollup(geo, source) — walk ZIP → metro → region → national, stopping at the
 *     first grain whose distinct FIRST-PARTY shopper count clears the threshold; returns
 *     granularityUsed + sampleSize + the full ladder (we always surface the grain used).
 *   computeGeoCohort(geo, source) — for the resolved grain: top hero lines, modal price
 *     band, attach rate, AOV, browse→buy (if available), joined to geo_census for income.
 *
 * SOURCE-AGNOSTIC: the service depends only on the GeoCohortSource interface (mirrors
 * getConnectors(env)). D1SyntheticSource is wired now; WarehouseSource is an inert stub
 * (throws NotWiredError) — swap = change the impl, ZERO change to route/tool/UI.
 *
 * HONESTY / FAIRNESS (doc §3/§10 — load-bearing):
 *   * geo = REAL (edge geolocation), the query = REAL, only the first-party DATA is
 *     synthetic today (dataSource:'synthetic' → 'warehouse'); census = REAL public.
 *   * Aggregate, never individual ("shoppers LIKE them, from here"). Roll-up is gated on
 *     FIRST-PARTY count, never census (census stays reliable to the ZIP — doc §4).
 *   * CURATE merchandising only — NEVER price/gate by geography; income/home-value only,
 *     never protected classes or ZIP-as-proxy; never tie to credit.
 *
 * Defensive: every D1 read is wrapped — a missing table / unreadable row degrades to a
 * safe default (national grain, empty cohort, null census). This function never throws.
 */
import type { Env } from '@/types/env';
import { NotWiredError } from '@/connectors/types';

// ───────────────────────── Tunables (centralized) ─────────────────────────
/**
 * Distinct first-party shoppers a grain must clear to be used as the cohort (doc §4:
 * "first-party N ≥ ~30–50 buyers"). We gate on first-party count ONLY — census stays
 * reliable down to the ZIP in the headline geography (CV < 8%, doc §4), so a ZIP rolls up
 * because OUR purchase counts are thin there, never because the census is.
 */
export const MIN_COHORT_SHOPPERS = 30;
/** Hero merchandising category the cold-start grid/hero leads with (top lines are scoped here;
 *  add-on behaviour is captured separately by attachRate). */
const HERO_CATEGORY = 'Handbags';
/** Cap on the number of top lines returned. */
const TOP_LINES_LIMIT = 6;

// ───────────────────────── Typed contract (exported) ─────────────────────────
export type GeoLevel = 'zip' | 'metro' | 'region' | 'national';

/** The real detected (or QA-overridden) geography we open the store against. */
export interface GeoInput {
  zip?: string | null;
  region?: string | null; // 2-letter state/subdivision code, e.g. 'NC'
  city?: string | null;
  country?: string | null;
  /** Provenance: 'edge' = real request.cf geolocation; 'query' = labeled QA / force-geo override. */
  source?: 'edge' | 'query';
}

/** A resolved grain to query the cohort at. `key` is the join key at that grain. */
export interface ResolvedGrain {
  level: GeoLevel;
  key: string; // zip | CBSA code | 2-letter state | 'US'
}

/** REAL public census facts for a grain (joined from geo_census). */
export interface CensusFacts {
  geoLevel: string;
  geoKey: string;
  label: string;
  medianHhIncome: number | null;
  medianHomeValue: number | null;
  source: string | null;
  vintage: string | null;
}

/** One rung of the roll-up ladder (we always surface the grain used + why). */
export interface RollupRung {
  level: GeoLevel;
  geoKey: string;
  sampleSize: number;
  cleared: boolean;
}

/** Output of resolveGeoRollup — the grain chosen + the ladder that got us there. */
export interface GeoRollup {
  granularityUsed: GeoLevel;
  geoKey: string;
  sampleSize: number;
  metroCbsa: string | null;
  region: string | null;
  ladder: RollupRung[];
}

/** A ranked hero line within the cohort. */
export interface CohortLine {
  line: string;
  shoppers: number; // distinct first-party shoppers who bought this line at the grain
  share: number; // shoppers / sampleSize, 0..1 (2dp)
}

/** The full cohort payload — the EXACT shape `GET /geo/cohort` returns (frontend contract). */
export interface GeoCohort {
  geo: { city: string | null; region: string | null; zip: string | null; country: string | null; source: 'edge' | 'query' };
  granularityUsed: GeoLevel;
  grainLabel: string;
  sampleSize: number;
  dataSource: 'synthetic' | 'warehouse';
  topLines: CohortLine[];
  priceBand: string | null; // modal price band across the cohort's purchases
  attachRate: number | null; // 0..1 — share of orders with an add-on (charm/SLG) attach
  aov: number | null; // average order value, whole USD
  browseToBuy: number | null; // 0..1 — cohort product-view→purchase ratio (null if unavailable)
  census: CensusFacts | null;
  honesty: { geo: 'real'; query: 'real'; firstParty: 'representative'; census: 'real-public' };
  ladder: RollupRung[];
  generatedAt: number;
}

/** Per-grain aggregate the source returns (assembled into GeoCohort). */
export interface GeoCohortAggregate {
  topLines: CohortLine[];
  priceBand: string | null;
  attachRate: number | null;
  aov: number | null;
  browseToBuy: number | null;
}

/**
 * Source-agnostic cohort backend. The service depends ONLY on this interface, exactly like
 * getConnectors(env): D1SyntheticSource now, WarehouseSource (a real warehouse) later —
 * the route, the Opal tool and the storefront never change.
 */
export interface GeoCohortSource {
  readonly kind: 'synthetic' | 'warehouse';
  /** Map a real ZIP to its metro CBSA + region via geo_xref (null if unknown). */
  resolveXref(zip: string): Promise<{ metroCbsa: string | null; region: string | null; country: string | null } | null>;
  /** Distinct first-party shoppers (buyers) at a grain — the roll-up gate. */
  countShoppers(grain: ResolvedGrain): Promise<number>;
  /** The cohort aggregate at a resolved grain. */
  aggregate(grain: ResolvedGrain, sampleSize: number): Promise<GeoCohortAggregate>;
  /** REAL public census facts for a grain. */
  census(grain: ResolvedGrain): Promise<CensusFacts | null>;
}

// ───────────────────────── numeric helpers ─────────────────────────
const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const norm = (s: string | null | undefined): string => (s ?? '').trim();
const upper = (s: string | null | undefined): string => norm(s).toUpperCase();

const EMPTY_AGG: GeoCohortAggregate = { topLines: [], priceBand: null, attachRate: null, aov: null, browseToBuy: null };

// ───────────────────────── D1 synthetic source (wired) ─────────────────────────

/**
 * Per-grain WHERE/JOIN clause on coach_transactions `t`. The metro grain joins geo_xref
 * (so we trust the crosswalk, never the random historical billing_postal_code); the rest
 * filter directly. `param` is the single bound value (national binds nothing).
 */
function grainClause(grain: ResolvedGrain): { join: string; where: string; param: string | null } {
  switch (grain.level) {
    case 'zip':
      return { join: '', where: 'CAST(t.billing_postal_code AS TEXT) = ?1', param: grain.key };
    case 'metro':
      return {
        join: 'JOIN geo_xref x ON x.zip = CAST(t.billing_postal_code AS TEXT)',
        where: 'x.metro_cbsa = ?1',
        param: grain.key,
      };
    case 'region':
      return { join: '', where: 't.billing_region = ?1', param: grain.key };
    case 'national':
    default:
      return { join: '', where: '1 = 1', param: null };
  }
}

const censusKey = (grain: ResolvedGrain): { level: string; key: string } => {
  switch (grain.level) {
    case 'zip':
      return { level: 'zip', key: grain.key };
    case 'metro':
      return { level: 'metro', key: grain.key };
    case 'region':
      return { level: 'region', key: grain.key };
    case 'national':
    default:
      return { level: 'national', key: 'US' };
  }
};

export class D1SyntheticSource implements GeoCohortSource {
  readonly kind = 'synthetic' as const;
  constructor(private readonly env: Env) {}

  async resolveXref(zip: string): Promise<{ metroCbsa: string | null; region: string | null; country: string | null } | null> {
    const z = norm(zip);
    if (!this.env.DB || !z) return null;
    try {
      const row = (await this.env.DB.prepare(
        'SELECT metro_cbsa AS metroCbsa, region, country FROM geo_xref WHERE zip = ?1'
      )
        .bind(z)
        .first()) as { metroCbsa?: unknown; region?: unknown; country?: unknown } | null;
      if (!row) return null;
      return {
        metroCbsa: row.metroCbsa != null ? String(row.metroCbsa) : null,
        region: row.region != null ? String(row.region) : null,
        country: row.country != null ? String(row.country) : null,
      };
    } catch {
      return null; // geo_xref missing/unreadable → unknown crosswalk
    }
  }

  async countShoppers(grain: ResolvedGrain): Promise<number> {
    if (!this.env.DB) return 0;
    const { join, where, param } = grainClause(grain);
    try {
      const stmt = this.env.DB.prepare(`SELECT COUNT(DISTINCT t.vuid) AS n FROM coach_transactions t ${join} WHERE ${where}`);
      const row = (await (param != null ? stmt.bind(param) : stmt).first()) as { n?: unknown } | null;
      return toNum(row?.n);
    } catch {
      return 0; // table missing / unreadable → no cohort at this grain
    }
  }

  async aggregate(grain: ResolvedGrain, sampleSize: number): Promise<GeoCohortAggregate> {
    if (!this.env.DB) return EMPTY_AGG;
    const { join, where, param } = grainClause(grain);
    const bind = <T extends D1PreparedStatement>(s: T): D1PreparedStatement => (param != null ? s.bind(param) : s);
    const out: GeoCohortAggregate = { ...EMPTY_AGG };

    // (1) Top HERO lines by distinct shoppers (the cold-start hero/grid leads with these).
    try {
      const res = await bind(
        this.env.DB.prepare(
          `SELECT i.line AS line, COUNT(DISTINCT i.vuid) AS shoppers
             FROM coach_purchase_items i
             JOIN coach_transactions t ON t.order_id = i.order_id ${join}
            WHERE ${where} AND i.category = '${HERO_CATEGORY}' AND i.line IS NOT NULL
            GROUP BY i.line
            ORDER BY shoppers DESC, i.line
            LIMIT ${TOP_LINES_LIMIT}`
        )
      ).all();
      const rows = (res?.results ?? []) as Array<{ line?: unknown; shoppers?: unknown }>;
      const denom = sampleSize > 0 ? sampleSize : 0;
      out.topLines = rows
        .filter((r) => r && typeof r.line === 'string')
        .map((r) => {
          const shoppers = toNum(r.shoppers);
          return { line: r.line as string, shoppers, share: denom > 0 ? round2(shoppers / denom) : 0 };
        });
    } catch {
      /* no line data — leave [] */
    }

    // (2) Modal price band across ALL the cohort's purchases (unambiguous overall band).
    try {
      const row = (await bind(
        this.env.DB.prepare(
          `SELECT i.price_band AS band, COUNT(*) AS c
             FROM coach_purchase_items i
             JOIN coach_transactions t ON t.order_id = i.order_id ${join}
            WHERE ${where} AND i.price_band IS NOT NULL
            GROUP BY i.price_band
            ORDER BY c DESC, i.price_band
            LIMIT 1`
        )
      ).first()) as { band?: unknown } | null;
      out.priceBand = row && typeof row.band === 'string' ? row.band : null;
    } catch {
      /* leave null */
    }

    // (3) Orders → AOV + attach rate (share of orders with an add-on attach).
    try {
      const row = (await bind(
        this.env.DB.prepare(
          `SELECT COUNT(*) AS orders, AVG(t.subtotal_usd) AS aov,
                  SUM(CASE WHEN t.item_count > 1 THEN 1 ELSE 0 END) AS multi
             FROM coach_transactions t ${join}
            WHERE ${where}`
        )
      ).first()) as { orders?: unknown; aov?: unknown; multi?: unknown } | null;
      const orders = toNum(row?.orders);
      if (orders > 0) {
        out.aov = Math.round(toNum(row?.aov));
        out.attachRate = round2(clamp01(toNum(row?.multi) / orders));
      }
    } catch {
      /* leave null */
    }

    // (4) browse→buy (if available): cohort product-view → purchase ratio from profiles.
    try {
      const row = (await bind(
        this.env.DB.prepare(
          `SELECT SUM(p.purchases) AS buys, SUM(p.product_views) AS views
             FROM coach_odp_profiles p
            WHERE p.vuid IN (SELECT DISTINCT t.vuid FROM coach_transactions t ${join} WHERE ${where})`
        )
      ).first()) as { buys?: unknown; views?: unknown } | null;
      const views = toNum(row?.views);
      out.browseToBuy = views > 0 ? round4(clamp01(toNum(row?.buys) / views)) : null;
    } catch {
      /* leave null */
    }

    return out;
  }

  async census(grain: ResolvedGrain): Promise<CensusFacts | null> {
    if (!this.env.DB) return null;
    const { level, key } = censusKey(grain);
    try {
      const row = (await this.env.DB.prepare(
        `SELECT geo_level AS geoLevel, geo_key AS geoKey, label,
                median_hh_income_usd AS medianHhIncome, median_home_value_usd AS medianHomeValue,
                source, vintage
           FROM geo_census WHERE geo_level = ?1 AND geo_key = ?2`
      )
        .bind(level, key)
        .first()) as Record<string, unknown> | null;
      if (!row) return null;
      return {
        geoLevel: String(row.geoLevel ?? level),
        geoKey: String(row.geoKey ?? key),
        label: String(row.label ?? ''),
        medianHhIncome: row.medianHhIncome != null ? toNum(row.medianHhIncome) : null,
        medianHomeValue: row.medianHomeValue != null ? toNum(row.medianHomeValue) : null,
        source: row.source != null ? String(row.source) : null,
        vintage: row.vintage != null ? String(row.vintage) : null,
      };
    } catch {
      return null; // geo_census missing/unreadable → no census layer (cohort still returns)
    }
  }
}

// ───────────────────────── Warehouse source (inert stub) ─────────────────────────

/**
 * The customer's REAL data warehouse — same query, swapped data. Inert until wired:
 * every method throws NotWiredError, exactly like LiveSignalProvider/LiveSegmentProvider.
 * resolveGeoRollup / computeGeoCohort are defensive, so a warehouse-mode call degrades to
 * a safe national/empty payload (dataSource:'warehouse', sampleSize 0) rather than crashing.
 */
export class WarehouseSource implements GeoCohortSource {
  readonly kind = 'warehouse' as const;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolveXref(_zip: string): Promise<{ metroCbsa: string | null; region: string | null; country: string | null } | null> {
    throw new NotWiredError('GeoCohortSource(Warehouse)');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async countShoppers(_grain: ResolvedGrain): Promise<number> {
    throw new NotWiredError('GeoCohortSource(Warehouse)');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async aggregate(_grain: ResolvedGrain, _sampleSize: number): Promise<GeoCohortAggregate> {
    throw new NotWiredError('GeoCohortSource(Warehouse)');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async census(_grain: ResolvedGrain): Promise<CensusFacts | null> {
    throw new NotWiredError('GeoCohortSource(Warehouse)');
  }
}

/**
 * Pick the cohort source from env, mirroring getConnectors(env). Default 'synthetic' (the
 * current demo); GEO_COHORT_SOURCE='warehouse' selects the inert warehouse stub. Read via a
 * cast so we don't have to touch the shared Env type.
 */
export function getGeoCohortSource(env: Env): GeoCohortSource {
  const mode = (env as { GEO_COHORT_SOURCE?: string }).GEO_COHORT_SOURCE ?? 'synthetic';
  return mode === 'warehouse' ? new WarehouseSource() : new D1SyntheticSource(env);
}

// ───────────────────────── roll-up ladder ─────────────────────────

/** Build the candidate ladder (finest → coarsest) for a geo, using the xref to map ZIP up. */
async function buildLadder(geo: GeoInput, source: GeoCohortSource): Promise<{ grains: ResolvedGrain[]; metroCbsa: string | null; region: string | null }> {
  const zip = norm(geo.zip);
  let region = upper(geo.region) || null;
  let metroCbsa: string | null = null;

  if (zip) {
    const xref = await source.resolveXref(zip).catch(() => null);
    if (xref) {
      metroCbsa = xref.metroCbsa;
      region = region || upper(xref.region) || null;
    }
  }

  const grains: ResolvedGrain[] = [];
  if (zip) grains.push({ level: 'zip', key: zip });
  if (metroCbsa) grains.push({ level: 'metro', key: metroCbsa });
  if (region) grains.push({ level: 'region', key: region });
  grains.push({ level: 'national', key: 'US' });
  return { grains, metroCbsa, region };
}

/**
 * Walk ZIP → metro → region → national, stopping at the first grain whose distinct
 * first-party shopper count ≥ MIN_COHORT_SHOPPERS. National is the floor (always used if
 * nothing finer clears). Returns the grain used + the full ladder. Never throws.
 */
export async function resolveGeoRollup(geo: GeoInput, source: GeoCohortSource): Promise<GeoRollup> {
  const { grains, metroCbsa, region } = await buildLadder(geo, source);
  const ladder: RollupRung[] = [];
  let chosen: ResolvedGrain | null = null;

  // `cleared` = this grain met the threshold (or is the national floor). The chosen grain
  // (granularityUsed) is the FIRST cleared rung; coarser rungs may also clear — we record
  // them all for transparency ("we show the grain we used", doc §4).
  for (const grain of grains) {
    const sampleSize = await source.countShoppers(grain).catch(() => 0);
    const meets = sampleSize >= MIN_COHORT_SHOPPERS || grain.level === 'national';
    ladder.push({ level: grain.level, geoKey: grain.key, sampleSize, cleared: meets });
    if (!chosen && meets) chosen = grain;
  }

  const used = chosen ?? { level: 'national' as GeoLevel, key: 'US' };
  const usedRung = ladder.find((r) => r.level === used.level && r.geoKey === used.key);
  return {
    granularityUsed: used.level,
    geoKey: used.key,
    sampleSize: usedRung?.sampleSize ?? 0,
    metroCbsa,
    region,
    ladder,
  };
}

// ───────────────────────── main ─────────────────────────

/**
 * The full geo-cohort for a detected geography. Resolves the grain (gated on first-party
 * count), computes the cohort aggregate + joins REAL census, and returns the frontend
 * contract. Defensive end-to-end — on any failure it degrades to a safe national/empty
 * payload and NEVER throws.
 */
export async function computeGeoCohort(geo: GeoInput, source: GeoCohortSource): Promise<GeoCohort> {
  const honesty = { geo: 'real', query: 'real', firstParty: 'representative', census: 'real-public' } as const;
  const geoEcho = {
    city: norm(geo.city) || null,
    region: upper(geo.region) || null,
    zip: norm(geo.zip) || null,
    country: upper(geo.country) || null,
    source: (geo.source ?? (norm(geo.zip) || norm(geo.region) ? 'query' : 'edge')) as 'edge' | 'query',
  };

  try {
    const rollup = await resolveGeoRollup(geo, source);
    const grain: ResolvedGrain = { level: rollup.granularityUsed, key: rollup.geoKey };

    const [agg, census] = await Promise.all([
      source.aggregate(grain, rollup.sampleSize).catch(() => EMPTY_AGG),
      source.census(grain).catch(() => null),
    ]);

    return {
      geo: geoEcho,
      granularityUsed: rollup.granularityUsed,
      grainLabel: census?.label || GRAIN_FALLBACK_LABEL[rollup.granularityUsed],
      sampleSize: rollup.sampleSize,
      dataSource: source.kind,
      topLines: agg.topLines,
      priceBand: agg.priceBand,
      attachRate: agg.attachRate,
      aov: agg.aov,
      browseToBuy: agg.browseToBuy,
      census,
      honesty,
      ladder: rollup.ladder,
      generatedAt: Date.now(),
    };
  } catch {
    // Belt-and-braces: even if the source is wholly unavailable, return a valid contract.
    return {
      geo: geoEcho,
      granularityUsed: 'national',
      grainLabel: GRAIN_FALLBACK_LABEL.national,
      sampleSize: 0,
      dataSource: source.kind,
      topLines: [],
      priceBand: null,
      attachRate: null,
      aov: null,
      browseToBuy: null,
      census: null,
      honesty,
      ladder: [],
      generatedAt: Date.now(),
    };
  }
}

const GRAIN_FALLBACK_LABEL: Record<GeoLevel, string> = {
  zip: 'ZIP',
  metro: 'Metro',
  region: 'Region',
  national: 'United States',
};
