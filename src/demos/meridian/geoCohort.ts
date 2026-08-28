// src/demos/meridian/geoCohort.ts
// ─────────────────────────────────────────────────────────────────────────────
// What shoppers from here actually bought.
//
// coldstart.ts answers "what do we know about someone who has done nothing" from
// public census figures alone. This file adds the half that only the customer
// can own: their OWN first-party purchase history for the visitor's geography.
// A brand-new visitor, no profile, and the page still opens on the lines that
// shoppers from their metro actually carry — not a market-wide category average
// rented from a card network, but receipts.
//
// THE HONEST CHAIN, every link checkable on stage:
//   1. Geo is REAL — a property of the connection (request.cf), or a labelled
//      ?zip/?region override for rehearsal. We never fabricate the location.
//   2. The query is REAL — the same aggregation a production warehouse would run.
//   3. Only the DATA is swapped — representative rows today (dataSource
//      'synthetic'), the customer's warehouse later (MRD_GEO_COHORT_SOURCE
//      'warehouse'), with zero change to this query, the route or the client.
//   4. Census is REAL public ACS, cited with source and vintage on every row.
//
// THE ROLL-UP LADDER (doc 13 §4): ZIP → metro → region → national, stopping at
// the first grain whose DISTINCT FIRST-PARTY SHOPPER COUNT clears the gate. The
// gate is never the census — census stays reliable to the ZIP; what is thin at
// the ZIP is our own purchase count. The grain used is always surfaced.
//
// THE REPRESENTATIVE FALLBACK (doc 13 §12a): when nothing local clears and we
// land on the national floor, but the visitor's real region has a census row, we
// present the national leaders AT that region with the region's REAL census,
// flag `synthesized: true`, and suppress the borrowed N. Any presenter, anywhere
// in the US, gets a local cold start; the honesty tier is unchanged.
//
// CURATE, NEVER PRICE (doc 13 §10). This returns curation signals only — which
// lines lead, which band the page opens weighted toward. Nothing here is a
// price, a discount, a gate, or an eligibility decision, and nothing here may
// ever feed one. Aggregate, never the individual: "shoppers LIKE them, from here".
//
// ISOLATION: a FORK of the Coach pattern, not an import — the charter forbids
// reaching into Coach code. Reads Meridian's own mrd_transactions /
// mrd_purchase_items, plus the shared READ-ONLY reference tables geo_xref and
// geo_census (the charter's documented exception). Never writes anything.
//
// DEFENSIVE END TO END: every D1 read is try/caught; a missing table, an unbound
// database or a thrown source degrades to a valid national/empty payload. The
// exported entry points never throw.
// ─────────────────────────────────────────────────────────────────────────────

import type { Env } from '@/types/env';
import type { Vertical } from './types';
import { configFor } from './reflexConfig';

// ───────────────────────── Tunables ─────────────────────────

/**
 * Distinct first-party shoppers a grain must clear to be used as the cohort
 * (doc 13 §4: "first-party N ≥ ~30–50 buyers"). A ZIP rolls up because OUR
 * purchase counts are thin there, never because the census is.
 */
export const MIN_COHORT_SHOPPERS = 30;
const TOP_LINES_LIMIT = 6;
const TOP_FAMILIES_LIMIT = 6;

// ───────────────────────── Contract ─────────────────────────

export type GeoLevel = 'zip' | 'metro' | 'region' | 'national';
export type GeoProvenance = 'edge' | 'query';

/** The detected (or labelled-override) geography we open the page against. */
export interface GeoInput {
  zip?: string | null;
  region?: string | null;   // 2-letter state, e.g. 'NC'
  city?: string | null;
  country?: string | null;
  source?: GeoProvenance;
}

/** A grain to query at. `key` is the join key: ZIP | CBSA | state | 'US'. */
export interface ResolvedGrain {
  level: GeoLevel;
  key: string;
}

/** REAL public census facts for a grain (geo_census). */
export interface CensusFacts {
  level: string;
  key: string;
  label: string;
  medianHhIncome: number | null;
  medianHomeValue: number | null;
  source: string | null;
  vintage: string | null;
}

/** One rung of the ladder — kept in the payload because the grain used is the Why. */
export interface RollupRung {
  level: GeoLevel;
  key: string;
  sampleSize: number;
  cleared: boolean;
}

export interface GeoRollup {
  granularityUsed: GeoLevel;
  key: string;
  sampleSize: number;
  metroCbsa: string | null;
  region: string | null;
  ladder: RollupRung[];
}

export interface CohortLine {
  line: string;
  share: number;    // count / sampleSize, 0..1, 2dp
  count: number;    // distinct shoppers at the grain who bought the line
}

export interface CohortFamily {
  family: string;
  category: string;
  share: number;
  count: number;
}

/** Retail bands entry/core/premium; financial bands modest/core/major — the registry's own labels. */
export type CohortBand = 'entry' | 'core' | 'premium' | 'modest' | 'major';

export interface CohortAggregate {
  topLines: CohortLine[];
  topFamilies: CohortFamily[];
  modalBand: CohortBand | null;
  attachRate: number | null;   // share of orders with more than one item
  aov: number | null;          // whole USD
  browseToBuy: number | null;  // Meridian keeps no browse history in D1 — always null today, kept for the warehouse
}

export interface CohortHonesty {
  geo: 'real-connection-property' | 'query-override';
  query: 'real';
  firstParty: 'representative' | 'warehouse';
  census: 'real-public-acs';
}

/** The EXACT shape GET /meridian/api/cohort returns. The client is written against this. */
export interface GeoCohort {
  ok: true;
  vertical: Vertical;
  geo: { city: string | null; region: string | null; zip: string | null; country: string | null; source: GeoProvenance };
  /** The grain the first-party gate actually resolved. 'national' under the fallback. */
  granularityUsed: GeoLevel;
  /** The grain presented. Equals granularityUsed unless synthesized. */
  presentLevel: GeoLevel;
  grainLabel: string;
  synthesized: boolean;
  /** Distinct first-party shoppers at the grain used; null when synthesized (a borrowed N is not shown). */
  sampleSize: number | null;
  topLines: CohortLine[];
  topFamilies: CohortFamily[];
  modalBand: CohortBand | null;
  attachRate: number | null;
  aov: number | null;
  browseToBuy: number | null;
  census: CensusFacts | null;
  honesty: CohortHonesty;
  dataSource: 'synthetic' | 'warehouse';
  /** The rungs walked, finest first. The Why for the grain. */
  ladder: RollupRung[];
  ms: number;
}

/**
 * Source-agnostic backend. The service depends only on this interface:
 * MeridianD1Source now, WarehouseSource (the customer's real data) later.
 * Swap = a different implementation; the route, the payload and the client
 * never change. That property is the whole point of the honesty model.
 */
export interface GeoCohortSource {
  readonly kind: 'synthetic' | 'warehouse';
  /** Map a ZIP to its metro CBSA + region via geo_xref (null if unknown). */
  resolveXref(zip: string): Promise<{ metroCbsa: string | null; region: string | null; country: string | null } | null>;
  /** Distinct first-party shoppers at a grain — the roll-up gate. */
  countShoppers(grain: ResolvedGrain, vertical: Vertical): Promise<number>;
  /** The cohort aggregate at a grain. */
  aggregate(grain: ResolvedGrain, vertical: Vertical, sampleSize: number): Promise<CohortAggregate>;
  /** REAL public census facts for a grain. */
  census(grain: ResolvedGrain): Promise<CensusFacts | null>;
}

// ───────────────────────── helpers ─────────────────────────

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (x: number): number => Math.round(x * 100) / 100;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const norm = (s: string | null | undefined): string => (s ?? '').trim();
const upper = (s: string | null | undefined): string => norm(s).toUpperCase();

export const EMPTY_AGGREGATE: CohortAggregate = {
  topLines: [], topFamilies: [], modalBand: null, attachRate: null, aov: null, browseToBuy: null,
};

/**
 * The band cut points, read off the SAME registry the instrument on stage uses,
 * so a cohort's "premium" is the instrument's "premium" by construction rather
 * than by two constants agreeing.
 */
export function bandSpecFor(vertical: Vertical): { cuts: number[]; labels: string[] } {
  const spec = configFor(vertical).dimensions.find((d) => d.derive === 'band');
  const cuts = spec?.cuts ?? (vertical === 'retail' ? [75, 250] : [25_000, 250_000]);
  const labels = spec?.labels ?? (vertical === 'retail' ? ['entry', 'core', 'premium'] : ['modest', 'core', 'major']);
  return { cuts, labels };
}

export function bandOf(valueUsd: number, vertical: Vertical): CohortBand {
  const { cuts, labels } = bandSpecFor(vertical);
  let i = 0;
  while (i < cuts.length && valueUsd >= cuts[i]!) i += 1;
  return labels[i] as CohortBand;
}

/**
 * The modal band over a distribution of headline values (one per order — the
 * order's highest-value item, so a $165 scarf attached to a $385 bag does not
 * vote the cohort down a band). Ties break toward the higher band, which is
 * the conservative reading for a page that opens on it.
 */
export function modalBandOf(rows: Array<{ v: unknown; c: unknown }>, vertical: Vertical): CohortBand | null {
  const { labels } = bandSpecFor(vertical);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const band = bandOf(toNum(r.v), vertical);
    counts.set(band, (counts.get(band) ?? 0) + toNum(r.c));
  }
  let best: CohortBand | null = null;
  let bestCount = 0;
  for (const label of labels) {            // ascending, so ≥ prefers the higher band on a tie
    const c = counts.get(label) ?? 0;
    if (c > 0 && c >= bestCount) { best = label as CohortBand; bestCount = c; }
  }
  return best;
}

/** Short stage labels for the metros geo_census carries. Falls back to the visitor's city. */
const METRO_SHORT: Record<string, string> = {
  '35620': 'New York', '49180': 'Winston-Salem', '16740': 'Charlotte', '39580': 'Raleigh',
  '31080': 'Los Angeles', '19100': 'Dallas-Fort Worth', '33100': 'Miami', '16980': 'Chicago',
  '45940': 'Trenton', '14460': 'Boston', '42660': 'Seattle', '38300': 'Pittsburgh',
  '12060': 'Atlanta', '29820': 'Las Vegas', '40060': 'Richmond', '19740': 'Denver',
  '38060': 'Phoenix', '19820': 'Detroit',
};

export function grainLabelFor(level: GeoLevel, key: string, census: CensusFacts | null, city: string | null): string {
  switch (level) {
    case 'zip': return `ZIP ${key}`;
    case 'metro': return `${METRO_SHORT[key] ?? (norm(city) || census?.label || key)} metro`;
    case 'region': return census?.label || key;
    case 'national':
    default: return 'United States';
  }
}

// ───────────────────────── D1 source (wired) ─────────────────────────

/**
 * Per-grain JOIN / WHERE on mrd_transactions `t`. The metro grain joins the
 * shared geo_xref crosswalk (read-only) so a real ZIP maps to its CBSA; the
 * rest filter directly. Binds are positional and always end with the vertical.
 */
function grainClause(grain: ResolvedGrain): { join: string; where: string; binds: string[] } {
  switch (grain.level) {
    case 'zip':
      return { join: '', where: 't.billing_postal_code = ?', binds: [grain.key] };
    case 'metro':
      return { join: 'JOIN geo_xref x ON x.zip = t.billing_postal_code', where: 'x.metro_cbsa = ?', binds: [grain.key] };
    case 'region':
      return { join: '', where: 't.billing_region = ?', binds: [grain.key] };
    case 'national':
    default:
      return { join: '', where: '1 = 1', binds: [] };
  }
}

const censusKeyOf = (grain: ResolvedGrain): { level: string; key: string } =>
  grain.level === 'national' ? { level: 'national', key: 'US' } : { level: grain.level, key: grain.key };

export class MeridianD1Source implements GeoCohortSource {
  readonly kind = 'synthetic' as const;
  constructor(private readonly db: D1Database | undefined) {}

  async resolveXref(zip: string): Promise<{ metroCbsa: string | null; region: string | null; country: string | null } | null> {
    const z = norm(zip);
    if (!this.db || !z) return null;
    try {
      const row = await this.db
        .prepare(`SELECT metro_cbsa AS metroCbsa, region, country FROM geo_xref WHERE zip = ?`)
        .bind(z)
        .first<{ metroCbsa?: unknown; region?: unknown; country?: unknown }>();
      if (!row) return null;
      return {
        metroCbsa: row.metroCbsa != null ? String(row.metroCbsa) : null,
        region: row.region != null ? String(row.region) : null,
        country: row.country != null ? String(row.country) : null,
      };
    } catch {
      return null;   // crosswalk missing or unreadable → the ladder simply has no metro rung
    }
  }

  async countShoppers(grain: ResolvedGrain, vertical: Vertical): Promise<number> {
    if (!this.db) return 0;
    const { join, where, binds } = grainClause(grain);
    try {
      const row = await this.db
        .prepare(`SELECT COUNT(DISTINCT t.vuid) AS n FROM mrd_transactions t ${join} WHERE ${where} AND t.vertical = ?`)
        .bind(...binds, vertical)
        .first<{ n?: unknown }>();
      return toNum(row?.n);
    } catch {
      return 0;      // table missing → no cohort at this grain; the ladder keeps walking
    }
  }

  async aggregate(grain: ResolvedGrain, vertical: Vertical, sampleSize: number): Promise<CohortAggregate> {
    if (!this.db) return EMPTY_AGGREGATE;
    const { join, where, binds } = grainClause(grain);
    const out: CohortAggregate = { ...EMPTY_AGGREGATE };
    const denom = sampleSize > 0 ? sampleSize : 0;

    // (1) Top lines by distinct shoppers — what the hero and the rail lead with.
    try {
      const res = await this.db
        .prepare(
          `SELECT i.line AS line, COUNT(DISTINCT t.vuid) AS count
             FROM mrd_purchase_items i
             JOIN mrd_transactions t ON t.order_id = i.order_id ${join}
            WHERE ${where} AND t.vertical = ? AND i.line IS NOT NULL
            GROUP BY i.line
            ORDER BY count DESC, i.line
            LIMIT ${TOP_LINES_LIMIT}`,
        )
        .bind(...binds, vertical)
        .all<{ line?: unknown; count?: unknown }>();
      out.topLines = (res?.results ?? [])
        .filter((r) => r && typeof r.line === 'string')
        .map((r) => {
          const count = toNum(r.count);
          return { line: r.line as string, count, share: denom > 0 ? round2(clamp01(count / denom)) : 0 };
        });
    } catch { /* no line data — leave [] */ }

    // (2) Top families — the family × category pairs the cohort actually carries.
    try {
      const res = await this.db
        .prepare(
          `SELECT i.family AS family, i.category AS category, COUNT(DISTINCT t.vuid) AS count
             FROM mrd_purchase_items i
             JOIN mrd_transactions t ON t.order_id = i.order_id ${join}
            WHERE ${where} AND t.vertical = ? AND i.family IS NOT NULL
            GROUP BY i.family, i.category
            ORDER BY count DESC, i.family
            LIMIT ${TOP_FAMILIES_LIMIT}`,
        )
        .bind(...binds, vertical)
        .all<{ family?: unknown; category?: unknown; count?: unknown }>();
      out.topFamilies = (res?.results ?? [])
        .filter((r) => r && typeof r.family === 'string')
        .map((r) => {
          const count = toNum(r.count);
          return {
            family: r.family as string,
            category: r.category != null ? String(r.category) : '',
            count,
            share: denom > 0 ? round2(clamp01(count / denom)) : 0,
          };
        });
    } catch { /* leave [] */ }

    // (3) Modal band over each order's headline (highest-value) item. Bucketed
    //     here, against the registry's own cuts, rather than in SQL.
    try {
      const res = await this.db
        .prepare(
          `SELECT v, COUNT(*) AS c
             FROM (SELECT MAX(i.value_usd) AS v
                     FROM mrd_purchase_items i
                     JOIN mrd_transactions t ON t.order_id = i.order_id ${join}
                    WHERE ${where} AND t.vertical = ?
                    GROUP BY i.order_id)
            GROUP BY v`,
        )
        .bind(...binds, vertical)
        .all<{ v?: unknown; c?: unknown }>();
      out.modalBand = modalBandOf((res?.results ?? []) as Array<{ v: unknown; c: unknown }>, vertical);
    } catch { /* leave null */ }

    // (4) Orders → AOV + attach rate.
    try {
      const row = await this.db
        .prepare(
          `SELECT COUNT(*) AS orders, AVG(t.order_total_usd) AS aov,
                  SUM(CASE WHEN t.item_count > 1 THEN 1 ELSE 0 END) AS multi
             FROM mrd_transactions t ${join}
            WHERE ${where} AND t.vertical = ?`,
        )
        .bind(...binds, vertical)
        .first<{ orders?: unknown; aov?: unknown; multi?: unknown }>();
      const orders = toNum(row?.orders);
      if (orders > 0) {
        out.aov = Math.round(toNum(row?.aov));
        out.attachRate = round2(clamp01(toNum(row?.multi) / orders));
      }
    } catch { /* leave null */ }

    // (5) browse→buy: Meridian holds no browse history in D1. Null, and said so —
    //     a warehouse source fills it in.
    out.browseToBuy = null;
    return out;
  }

  async census(grain: ResolvedGrain): Promise<CensusFacts | null> {
    if (!this.db) return null;
    const { level, key } = censusKeyOf(grain);
    try {
      const row = await this.db
        .prepare(
          `SELECT geo_level AS level, geo_key AS key, label,
                  median_hh_income_usd AS medianHhIncome, median_home_value_usd AS medianHomeValue,
                  source, vintage
             FROM geo_census WHERE geo_level = ? AND geo_key = ? LIMIT 1`,
        )
        .bind(level, key)
        .first<Record<string, unknown>>();
      if (!row) return null;
      return {
        level: String(row.level ?? level),
        key: String(row.key ?? key),
        label: String(row.label ?? ''),
        medianHhIncome: row.medianHhIncome != null ? toNum(row.medianHhIncome) : null,
        medianHomeValue: row.medianHomeValue != null ? toNum(row.medianHomeValue) : null,
        source: row.source != null ? String(row.source) : null,
        vintage: row.vintage != null ? String(row.vintage) : null,
      };
    } catch {
      return null;   // no census layer — the cohort still returns
    }
  }
}

// ───────────────────────── Warehouse source (inert seam) ─────────────────────────

/** The seam is real even though nothing is behind it yet. Same message shape as the connector layer's. */
export class NotWiredError extends Error {
  constructor(what: string) {
    super(`${what}: live adapter not wired. Set MRD_GEO_COHORT_SOURCE=synthetic or supply warehouse credentials.`);
    this.name = 'NotWiredError';
  }
}

/**
 * The customer's REAL warehouse — the same query, their data. Inert until wired:
 * every method throws NotWiredError. computeGeoCohort is defensive, so a
 * warehouse-mode call degrades to a national/empty payload labelled
 * dataSource:'warehouse' rather than crashing the page.
 */
export class WarehouseSource implements GeoCohortSource {
  readonly kind = 'warehouse' as const;
  async resolveXref(): Promise<{ metroCbsa: string | null; region: string | null; country: string | null } | null> {
    throw new NotWiredError('GeoCohortSource(Warehouse)');
  }
  async countShoppers(): Promise<number> {
    throw new NotWiredError('GeoCohortSource(Warehouse)');
  }
  async aggregate(): Promise<CohortAggregate> {
    throw new NotWiredError('GeoCohortSource(Warehouse)');
  }
  async census(): Promise<CensusFacts | null> {
    throw new NotWiredError('GeoCohortSource(Warehouse)');
  }
}

/** 'synthetic' (default) | 'warehouse'. Surface-scoped var, absent by default, like MRD_ODP_*. */
export function getGeoCohortSource(env: Pick<Env, 'DB'> & { MRD_GEO_COHORT_SOURCE?: string }): GeoCohortSource {
  return env.MRD_GEO_COHORT_SOURCE === 'warehouse' ? new WarehouseSource() : new MeridianD1Source(env.DB);
}

// ───────────────────────── the ladder ─────────────────────────

async function buildLadder(geo: GeoInput, source: GeoCohortSource) {
  const zip = norm(geo.zip);
  const country = upper(geo.country) || null;
  // The ACS is a US survey and the crosswalk is US ZIPs. A non-US region code is
  // never walked as a US state — it would be pretending, which this file exists to avoid.
  const usLike = !country || country === 'US';
  let region = upper(geo.region) || null;
  let metroCbsa: string | null = null;

  if (zip) {
    const xref = await source.resolveXref(zip).catch(() => null);
    if (xref) {
      metroCbsa = xref.metroCbsa;
      region = region || upper(xref.region) || null;
    }
  }
  if (!usLike) region = null;

  const grains: ResolvedGrain[] = [];
  if (zip) grains.push({ level: 'zip', key: zip });
  if (metroCbsa) grains.push({ level: 'metro', key: metroCbsa });
  if (region) grains.push({ level: 'region', key: region });
  grains.push({ level: 'national', key: 'US' });
  return { grains, metroCbsa, region };
}

/**
 * Walk ZIP → metro → region → national, stopping at the first grain whose
 * distinct first-party shopper count ≥ MIN_COHORT_SHOPPERS. National is the
 * floor. Every rung is recorded, cleared or not — the grain used is the Why.
 * Never throws.
 */
export async function resolveGeoRollup(geo: GeoInput, source: GeoCohortSource, vertical: Vertical): Promise<GeoRollup> {
  const { grains, metroCbsa, region } = await buildLadder(geo, source);
  const ladder: RollupRung[] = [];
  let chosen: ResolvedGrain | null = null;

  for (const grain of grains) {
    const sampleSize = await source.countShoppers(grain, vertical).catch(() => 0);
    const cleared = sampleSize >= MIN_COHORT_SHOPPERS || grain.level === 'national';
    ladder.push({ level: grain.level, key: grain.key, sampleSize, cleared });
    if (!chosen && cleared) chosen = grain;
  }

  const used = chosen ?? { level: 'national' as GeoLevel, key: 'US' };
  const rung = ladder.find((r) => r.level === used.level && r.key === used.key);
  return { granularityUsed: used.level, key: used.key, sampleSize: rung?.sampleSize ?? 0, metroCbsa, region, ladder };
}

// ───────────────────────── main ─────────────────────────

/**
 * The full cohort for a geography: resolve the grain (gated on first-party
 * count), aggregate at it, join REAL census, apply the representative fallback,
 * and return the client contract. On any failure it degrades to a valid
 * national/empty payload. NEVER throws.
 */
export async function computeGeoCohort(geo: GeoInput, source: GeoCohortSource, vertical: Vertical): Promise<GeoCohort> {
  const t0 = Date.now();
  const provenance: GeoProvenance = geo.source ?? (norm(geo.zip) || norm(geo.region) || norm(geo.city) ? 'query' : 'edge');
  const geoEcho = {
    city: norm(geo.city) || null,
    region: upper(geo.region) || null,
    zip: norm(geo.zip) || null,
    country: upper(geo.country) || null,
    source: provenance,
  };
  const honesty: CohortHonesty = {
    geo: provenance === 'query' ? 'query-override' : 'real-connection-property',
    query: 'real',
    firstParty: source.kind === 'warehouse' ? 'warehouse' : 'representative',
    census: 'real-public-acs',
  };

  try {
    const rollup = await resolveGeoRollup(geo, source, vertical);
    const aggGrain: ResolvedGrain = { level: rollup.granularityUsed, key: rollup.key };
    let presentLevel: GeoLevel = rollup.granularityUsed;
    let presentKey = rollup.key;
    let censusGrain: ResolvedGrain = aggGrain;
    let synthesized = false;

    // The representative fallback (header). Aggregation stays national — we are
    // borrowing the leaders — while the census and the label become the region's.
    if (rollup.granularityUsed === 'national' && rollup.region) {
      const regionCensus = await source.census({ level: 'region', key: rollup.region }).catch(() => null);
      if (regionCensus) {
        synthesized = true;
        presentLevel = 'region';
        presentKey = rollup.region;
        censusGrain = { level: 'region', key: rollup.region };
      }
    }

    const [agg, census] = await Promise.all([
      source.aggregate(aggGrain, vertical, rollup.sampleSize).catch(() => EMPTY_AGGREGATE),
      source.census(censusGrain).catch(() => null),
    ]);

    return {
      ok: true,
      vertical,
      geo: geoEcho,
      granularityUsed: rollup.granularityUsed,
      presentLevel,
      grainLabel: grainLabelFor(presentLevel, presentKey, census, geoEcho.city),
      synthesized,
      sampleSize: synthesized ? null : rollup.sampleSize,
      topLines: agg.topLines,
      topFamilies: agg.topFamilies,
      modalBand: agg.modalBand,
      attachRate: agg.attachRate,
      aov: agg.aov,
      browseToBuy: agg.browseToBuy,
      census,
      honesty,
      dataSource: source.kind,
      ladder: rollup.ladder,
      ms: Date.now() - t0,
    };
  } catch {
    // Belt and braces: even a wholly unavailable source returns the contract.
    return {
      ok: true,
      vertical,
      geo: geoEcho,
      granularityUsed: 'national',
      presentLevel: 'national',
      grainLabel: grainLabelFor('national', 'US', null, null),
      synthesized: false,
      sampleSize: 0,
      topLines: [],
      topFamilies: [],
      modalBand: null,
      attachRate: null,
      aov: null,
      browseToBuy: null,
      census: null,
      honesty,
      dataSource: source.kind,
      ladder: [],
      ms: Date.now() - t0,
    };
  }
}
