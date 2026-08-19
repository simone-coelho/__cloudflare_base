// src/demos/brighthour/geoCohort.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE GEO-COHORT COLD START, for the Bright Hour surface.
//
// A brand-new anonymous visitor has no profile, no history and no cookie worth
// reading — and the first paint still has to be useful. So the page opens on the
// only true thing it knows about her: WHERE SHE IS, and what shoppers there
// actually buy. That is a PRIOR, not a profile, and the instant she does
// anything at all her own behaviour replaces it.
//
// Ported from the proven Coach beat (src/services/geo/cohort.ts + src/routes/
// geo.ts). This module does NOT fork it: the roll-up gate, the census read and
// the ZIP→metro crosswalk are the Coach shared brain's own D1 source, reached
// through getGeoCohortSource(env). What is new here is Bright Hour's own shape —
// eight catalogue categories instead of handbag lines, and its own eligibility
// gates — so the banner's cards are the SAME projection the ranked slots emit.
//
// THE HONESTY MODEL (load-bearing — the banner states it on screen):
//   · IDENTIFICATION IS REAL. city/region/postal arrive ON the request from
//     Cloudflare's edge (request.cf). No client code, no third-party pixel,
//     nothing an ad-blocker can refuse.
//   · THE QUERY IS REAL. The roll-up walks metro → state → national gated on
//     first-party cohort size, and the census join is a real join.
//   · THE CENSUS IS REAL PUBLIC DATA (US Census ACS, 17 U.S.C. §105), quoted
//     with its own vintage from the row it came from — never a rounded guess.
//   · ONLY THE COHORT DATA IS SWAPPED. The first-party purchase history behind
//     the lean is REPRESENTATIVE; in production it is the customer's own
//     warehouse. `representative: true` is on every payload and never optional.
//
// FAIRNESS RED LINES (absolute — doc 13 §10):
//   · Geography CURATES what is shown. It never prices, gates, discounts or
//     withholds. There is no geo-conditional price anywhere in this file.
//   · Census income is CONTEXT, shown honestly with its vintage and source. It
//     is never a targeting gate and never an input to eligibility or ranking.
//   · The cohort is an AGGREGATE ("shoppers near you"), never an inference about
//     the individual in front of us. N is suppressed when the leaders were
//     borrowed from a coarser grain, so a thin cohort can never masquerade as a
//     precise local claim.
// ─────────────────────────────────────────────────────────────────────────────

import type { Env } from '@/types/env';
import {
  MIN_COHORT_SHOPPERS,
  getGeoCohortSource,
  type CensusFacts,
  type GeoCohortSource,
} from '@/services/geo/cohort';
import { hashHex, plainItemView, type ComposerItem, type OfferView, type SafeItem } from './composer';

// ── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * The eight aisles the Bright Hour catalogue is merchandised into (design brief
 * §B2). The lean is drawn from THIS list, so a category the catalogue happens to
 * be thin on today still names a real aisle tomorrow.
 */
export const BH_CATEGORIES: readonly string[] = [
  'Kitchen & Table',
  'For the Home',
  'Beauty & Wellness',
  'Fashion',
  'Jewelry',
  'Electronics & Tech',
  'Garden & Outdoor',
  'Food & Wine',
];

/** The grain the cohort is presented at. `state` is Coach's `region`, renamed for the room. */
export type BhGeoGrain = 'metro' | 'state' | 'national';

/** How many items the banner opens with. Three reads as a prior; five reads as a rail. */
export const COHORT_ITEM_COUNT = 4;

// ── Contract ─────────────────────────────────────────────────────────────────

/** The geography we were handed — from request.cf (edge) or a labelled QA override (query). */
export interface BhGeoInput {
  city?: string | null;
  /** Full region name as the edge reports it, e.g. 'North Carolina'. */
  region?: string | null;
  /** 2-letter subdivision code, e.g. 'NC' — the census/roll-up join key. */
  regionCode?: string | null;
  /** CBSA code when known (from the ZIP crosswalk, or a QA override). */
  metroCbsa?: string | null;
  /** Nielsen DMA from request.cf. Carried for transparency; it is NOT a CBSA and never joins. */
  dmaCode?: string | null;
  postalCode?: string | null;
  country?: string | null;
  source?: 'edge' | 'query';
}

/** One rung of the roll-up ladder — always surfaced, so the grain used is never a mystery. */
export interface BhGeoRung {
  level: BhGeoGrain;
  key: string;
  n: number;
  cleared: boolean;
}

/** REAL public census facts, quoted with the vintage of the row they came from. */
export interface BhCensus {
  geoLevel: string;
  geoKey: string;
  label: string;
  medianHhIncome: number | null;
  medianHomeValue: number | null;
  source: string | null;
  vintage: string | null;
}

/** A cohort item: the SAME projection every ranked slot emits, so one card template renders both. */
export type BhCohortItem = SafeItem & { offer: OfferView; eligible: boolean };

/** The exact payload `GET /live/api/geo` returns — the client contract. */
export interface BhGeoCohort {
  location: {
    city: string | null;
    region: string | null;
    regionCode: string | null;
    metroCbsa: string | null;
    dmaCode: string | null;
    postalCode: string | null;
    country: string | null;
    /** What the banner greets her by: the city, else the region, else 'your area'. */
    label: string;
    /** How precisely we actually know where she is. Never overstated. */
    precision: 'city' | 'region' | 'country' | 'none';
    source: 'edge' | 'query';
  };
  census: BhCensus | null;
  grain: BhGeoGrain;
  grainLabel: string;
  /** Two of the eight aisles — deterministic per region, so a state always tells one story. */
  cohortLean: string[];
  cohortItems: BhCohortItem[];
  /** Distinct first-party shoppers at the grain, or null when the leaders were BORROWED. */
  cohortSize: number | null;
  /** True when nothing local cleared and we presented coarser leaders at her real geography. */
  borrowed: boolean;
  /** Always true. The cohort data is representative; in production it is the customer's warehouse. */
  representative: true;
  honesty: {
    location: 'live-edge';
    query: 'real';
    census: 'real-public';
    cohort: 'representative';
  };
  /** Glass-box record — the same grain / N / source fields every other slot carries. */
  explain: {
    grain: BhGeoGrain;
    n: number | null;
    threshold: number;
    source: string;
    censusSource: string | null;
    censusVintage: string | null;
    categories: string[];
    ladder: BhGeoRung[];
    /** Load-bearing: geography curates, it never prices or gates. Stated in the record. */
    curation_only: true;
  };
  generatedAt: number;
}

// ── Small helpers ────────────────────────────────────────────────────────────

const norm = (s: string | null | undefined): string => (typeof s === 'string' ? s.trim() : '');
const upper = (s: string | null | undefined): string => norm(s).toUpperCase();
const nullable = (s: string | null | undefined): string | null => norm(s) || null;

/** A 32-bit unsigned int from the shared composer hash — one hashing story on this surface. */
function seedOf(...parts: string[]): number {
  return parseInt(hashHex(...parts).slice(0, 8), 16) >>> 0;
}

// ── PURE CORE ────────────────────────────────────────────────────────────────

/**
 * The two aisles a region leans toward — DETERMINISTIC in the region code, so
 * North Carolina tells the same story in every rehearsal and on stage, and two
 * presenters in two states get two visibly different cold opens.
 *
 * This is a merchandising PRIOR drawn from a representative cohort, not a claim
 * about anybody who lives there — which is exactly why it is stable, coarse, and
 * labelled representative wherever it is shown.
 */
export function leanForRegion(regionCode: string | null | undefined): string[] {
  const key = upper(regionCode) || 'US';
  const h = seedOf('bh-geo-lean', key);
  const n = BH_CATEGORIES.length;
  const first = h % n;
  const rest = BH_CATEGORIES.filter((_, i) => i !== first);
  const second = Math.floor(h / n) % rest.length;
  return [BH_CATEGORIES[first], rest[second]];
}

/**
 * The cohort's opening items: ELIGIBLE items (the real gates — window open,
 * available, channel) from the lean aisles, alternating between the two so both
 * are visibly represented, ordered by a stable hash seeded on the grain key.
 *
 * Deterministic, so the same geography opens on the same shelf every time. If
 * the lean aisles cannot fill the row at this instant (windows close; that is
 * the whole Bright Hour premise), it tops up from anything else eligible rather
 * than showing a short, sad row.
 */
export function pickCohortItems(
  items: readonly ComposerItem[],
  lean: readonly string[],
  nowMs: number,
  seedKey: string,
  limit: number = COHORT_ITEM_COUNT
): BhCohortItem[] {
  const views: BhCohortItem[] = [];
  for (const item of items ?? []) {
    if (!item) continue;
    let view: BhCohortItem;
    try {
      view = plainItemView(item, nowMs);
    } catch {
      continue; // a malformed row must never cost the room its cold open
    }
    if (view.eligible) views.push(view);
  }

  const rank = (v: BhCohortItem): number => seedOf('bh-geo-item', seedKey, v.itemNumber || v.id);
  const byLean = lean.map((cat) =>
    views
      .filter((v) => v.category === cat)
      .sort((a, b) => rank(a) - rank(b) || a.itemNumber.localeCompare(b.itemNumber))
  );

  const out: BhCohortItem[] = [];
  const taken = new Set<string>();
  // Alternate the aisles so a two-category lean actually LOOKS like two categories.
  for (let round = 0; out.length < limit; round++) {
    let progressed = false;
    for (const bucket of byLean) {
      const v = bucket[round];
      if (!v || taken.has(v.itemNumber)) continue;
      progressed = true;
      taken.add(v.itemNumber);
      out.push(v);
      if (out.length >= limit) break;
    }
    if (!progressed) break;
  }

  if (out.length < limit) {
    const spare = views
      .filter((v) => !taken.has(v.itemNumber))
      .sort((a, b) => rank(a) - rank(b) || a.itemNumber.localeCompare(b.itemNumber));
    for (const v of spare) {
      if (out.length >= limit) break;
      taken.add(v.itemNumber);
      out.push(v);
    }
  }
  return out;
}

/** The label the banner greets her by. Never overstated: city → region → 'your area'. */
export function locationLabel(geo: BhGeoInput): { label: string; precision: 'city' | 'region' | 'country' | 'none' } {
  const city = norm(geo.city);
  if (city) return { label: city, precision: 'city' };
  const region = norm(geo.region) || upper(geo.regionCode);
  if (region) return { label: region, precision: 'region' };
  const country = upper(geo.country);
  if (country) return { label: 'your area', precision: 'country' };
  return { label: 'your area', precision: 'none' };
}

const GRAIN_FALLBACK_LABEL: Record<BhGeoGrain, string> = {
  metro: 'Metro',
  state: 'Statewide',
  national: 'United States',
};

/**
 * Assemble the payload. PURE — every fact is passed in, so the whole contract is
 * testable without D1 and the route is the only thing that touches a database.
 */
export function buildBhGeoCohort(input: {
  geo: BhGeoInput;
  items: readonly ComposerItem[];
  nowMs: number;
  census: CensusFacts | BhCensus | null;
  grain: BhGeoGrain;
  cohortSize: number | null;
  borrowed: boolean;
  ladder: BhGeoRung[];
  dataSource?: string;
}): BhGeoCohort {
  const { geo, items, nowMs, grain, borrowed } = input;
  const { label, precision } = locationLabel(geo);
  const regionCode = upper(geo.regionCode) || null;
  const lean = leanForRegion(regionCode);
  // The grain's own key seeds the shelf, so a metro and its state open differently.
  const seedKey = `${grain}:${
    grain === 'metro' ? norm(geo.metroCbsa) || regionCode || 'US' : grain === 'state' ? regionCode || 'US' : 'US'
  }`;
  const census = input.census
    ? {
        geoLevel: String(input.census.geoLevel ?? ''),
        geoKey: String(input.census.geoKey ?? ''),
        label: String(input.census.label ?? ''),
        medianHhIncome: input.census.medianHhIncome ?? null,
        medianHomeValue: input.census.medianHomeValue ?? null,
        source: input.census.source ?? null,
        vintage: input.census.vintage ?? null,
      }
    : null;

  // N is SUPPRESSED whenever the leaders were borrowed — a thin cohort must never
  // read as a precise local claim.
  const cohortSize = borrowed ? null : input.cohortSize;

  return {
    location: {
      city: nullable(geo.city),
      region: nullable(geo.region),
      regionCode,
      metroCbsa: nullable(geo.metroCbsa),
      dmaCode: nullable(geo.dmaCode),
      postalCode: nullable(geo.postalCode),
      country: upper(geo.country) || null,
      label,
      precision,
      source: geo.source === 'query' ? 'query' : 'edge',
    },
    census,
    grain,
    grainLabel: census?.label || GRAIN_FALLBACK_LABEL[grain],
    cohortLean: lean,
    cohortItems: pickCohortItems(items, lean, nowMs, seedKey),
    cohortSize,
    borrowed,
    representative: true,
    honesty: { location: 'live-edge', query: 'real', census: 'real-public', cohort: 'representative' },
    explain: {
      grain,
      n: cohortSize,
      threshold: MIN_COHORT_SHOPPERS,
      source: input.dataSource ?? 'representative first-party purchase history (D1)',
      censusSource: census?.source ?? null,
      censusVintage: census?.vintage ?? null,
      categories: lean,
      ladder: input.ladder,
      curation_only: true,
    },
    generatedAt: nowMs,
  };
}

// ── THIN D1 WRAPPER ──────────────────────────────────────────────────────────

/**
 * Walk metro → state → national, stopping at the finest grain whose distinct
 * first-party shopper count clears MIN_COHORT_SHOPPERS. National is the floor.
 *
 * The gate is on FIRST-PARTY count only — never on the census, which stays
 * reliable at every grain (doc 13 §4). A grain rolls up because OUR history is
 * thin there, never because the public data is.
 *
 * PRESENTER-AGNOSTIC FALLBACK (doc 13 §12): when nothing local clears but we know
 * her real state and have that state's REAL census, we present the coarser
 * (representative) leaders AT her state with her state's real census and set
 * `borrowed` — so a teammate demoing from any of the 50 states + DC still gets a
 * local cold open. Geography and census stay REAL; the cohort was always
 * representative; N is suppressed. Never throws: a missing table degrades to the
 * national floor and the banner still opens.
 */
async function resolveGrain(
  geo: BhGeoInput,
  source: GeoCohortSource
): Promise<{
  grain: BhGeoGrain;
  cohortSize: number | null;
  borrowed: boolean;
  ladder: BhGeoRung[];
  census: CensusFacts | null;
  /** The CBSA the ZIP crosswalk resolved, so the payload echoes the key it actually used. */
  metroCbsa: string | null;
}> {
  const regionCode = upper(geo.regionCode) || null;

  // The edge's metroCode is a Nielsen DMA and does NOT join to a CBSA — the ZIP
  // crosswalk is the only honest way up to a metro.
  let metroCbsa = nullable(geo.metroCbsa);
  const postal = norm(geo.postalCode);
  if (!metroCbsa && postal) {
    const xref = await source.resolveXref(postal).catch(() => null);
    if (xref?.metroCbsa) metroCbsa = xref.metroCbsa;
  }

  const ladder: BhGeoRung[] = [];
  const rungs: Array<{ level: BhGeoGrain; key: string; census: { level: string; key: string } }> = [];
  if (metroCbsa) rungs.push({ level: 'metro', key: metroCbsa, census: { level: 'metro', key: metroCbsa } });
  if (regionCode) rungs.push({ level: 'state', key: regionCode, census: { level: 'region', key: regionCode } });
  rungs.push({ level: 'national', key: 'US', census: { level: 'national', key: 'US' } });

  let chosen: (typeof rungs)[number] | null = null;
  for (const rung of rungs) {
    // Coach's own source speaks 'region'; this surface says 'state' to the room.
    const level = rung.level === 'state' ? 'region' : rung.level;
    const n = await source
      .countShoppers({ level: level as 'metro' | 'region' | 'national', key: rung.key })
      .catch(() => 0);
    const cleared = n >= MIN_COHORT_SHOPPERS || rung.level === 'national';
    ladder.push({ level: rung.level, key: rung.key, n, cleared });
    if (!chosen && cleared) chosen = rung;
  }

  const used = chosen ?? rungs[rungs.length - 1];
  const usedRung = ladder.find((r) => r.level === used.level && r.key === used.key);
  let grain: BhGeoGrain = used.level;
  let borrowed = false;
  let censusGrain = used.census;

  // Nothing local cleared → present the national leaders at her real state, with
  // her state's REAL census. Same honesty tier; N suppressed.
  if (grain === 'national' && regionCode) {
    const stateCensus = await source.census({ level: 'region', key: regionCode }).catch(() => null);
    if (stateCensus) {
      grain = 'state';
      borrowed = true;
      censusGrain = { level: 'region', key: regionCode };
    }
  }

  const census = await source
    .census({ level: censusGrain.level as 'metro' | 'region' | 'national' | 'zip', key: censusGrain.key })
    .catch(() => null);

  return { grain, cohortSize: usedRung?.n ?? 0, borrowed, ladder, census, metroCbsa };
}

/**
 * The whole cold start for a detected geography. Defensive end-to-end: a missing
 * table, an unreadable row or a wholly absent DB degrades to the national floor
 * with a null census — the banner still opens, and it still tells the truth about
 * what it knows. This function never throws.
 */
export async function resolveBhGeoCohort(
  env: Env,
  geo: BhGeoInput,
  items: readonly ComposerItem[],
  nowMs: number
): Promise<BhGeoCohort> {
  const source = getGeoCohortSource(env);
  let resolved: Awaited<ReturnType<typeof resolveGrain>>;
  try {
    resolved = await resolveGrain(geo, source);
  } catch {
    resolved = {
      grain: 'national',
      cohortSize: 0,
      borrowed: false,
      ladder: [{ level: 'national', key: 'US', n: 0, cleared: true }],
      census: null,
      metroCbsa: null,
    };
  }
  return buildBhGeoCohort({
    // Echo the CBSA the crosswalk actually resolved, so `location.metroCbsa` and
    // the grain key on the record can never disagree in front of the room.
    geo: { ...geo, metroCbsa: resolved.metroCbsa ?? geo.metroCbsa ?? null },
    items,
    nowMs,
    census: resolved.census,
    grain: resolved.grain,
    cohortSize: resolved.cohortSize,
    borrowed: resolved.borrowed,
    ladder: resolved.ladder,
    dataSource:
      source.kind === 'warehouse'
        ? 'customer warehouse'
        : 'representative first-party purchase history (D1)',
  });
}
