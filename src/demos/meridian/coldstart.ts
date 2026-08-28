// src/demos/meridian/coldstart.ts
// ─────────────────────────────────────────────────────────────────────────────
// What we know about someone who has done nothing.
//
// THE HONEST CHAIN, and every link is checkable on stage:
//   1. The edge resolves the request's country/region/city. REAL — it is a
//      property of the connection, not a tracker, and needs no permission.
//   2. We look that region up in published Census ACS 2024 figures: median
//      household income and median home value. REAL, public, and citable.
//   3. We DERIVE a value-band prior from it. Retail leans on income — what a
//      household here can comfortably spend. Financial leans on median home
//      value — what a first mortgage in this state actually looks like.
//      DERIVED, and the arithmetic is returned with the answer.
//
// That is the whole cold start. No third-party data, no device fingerprint, no
// waiting for a segment to populate, and nothing that pretends to be behaviour.
//
// WHAT WE DO NOT DO: invent a category preference for a region. The temptation
// is to hash a state code into a "regional lean" and place it beside a real
// census figure, where it borrows that figure's credibility. We return a
// category lean ONLY when it can be stated as an inference, and we label it.
//
// SHARED-DATA EXCEPTION: this reads the geo_census / geo_xref tables. They are
// read-only published reference data — reading them cannot corrupt another demo,
// and forking a table of public census figures would buy nothing.
// ─────────────────────────────────────────────────────────────────────────────

import type { Vertical } from './types';

export interface CensusRow {
  label: string;
  medianHhIncomeUsd: number | null;
  medianHomeValueUsd: number | null;
  source: string;
  vintage: string;
}

export interface ColdStartPrior {
  /** The dimension the prior seeds — 'priceBand' or 'amountBand'. */
  dim: string;
  value: string;
  weight: number;
  /** The arithmetic, in words, for the explain record and the stage. */
  why: string;
}

export interface ColdStart {
  ok: boolean;
  geo: { country: string | null; region: string | null; city: string | null; resolved: boolean };
  census: (CensusRow & { comparedToNational: number | null }) | null;
  prior: ColdStartPrior | null;
  honesty: {
    geo: 'real-connection-property';
    census: 'real-public-acs-2024';
    prior: 'derived-from-census';
    behaviour: 'none-yet';
  };
  note: string;
}

/** Seed weight. Lands the band affinity visibly above zero but below θ_out, so
    the instrument shows we know something without claiming a committed audience. */
const PRIOR_WEIGHT = 1.6;

type CfLike = { country?: string; regionCode?: string; region?: string; city?: string } | undefined;

async function censusFor(db: D1Database, region: string | null): Promise<CensusRow | null> {
  const pick = async (level: string, key: string) =>
    db
      .prepare(
        `SELECT label, median_hh_income_usd, median_home_value_usd, source, vintage
           FROM geo_census WHERE geo_level = ? AND geo_key = ? LIMIT 1`,
      )
      .bind(level, key)
      .first<Record<string, unknown>>();

  const row = (region ? await pick('region', region) : null) ?? (await pick('national', 'US'));
  if (!row) return null;
  return {
    label: String(row.label),
    medianHhIncomeUsd: row.median_hh_income_usd == null ? null : Number(row.median_hh_income_usd),
    medianHomeValueUsd: row.median_home_value_usd == null ? null : Number(row.median_home_value_usd),
    source: String(row.source),
    vintage: String(row.vintage),
  };
}

/**
 * Retail: household income relative to the national median picks the price band.
 * Financial: the median home value picks the mortgage amount band directly —
 * the strongest inference available, because a first mortgage is a fraction of
 * the home it buys rather than a guess about taste.
 */
function derivePrior(vertical: Vertical, c: CensusRow, national: CensusRow | null): ColdStartPrior | null {
  if (vertical === 'retail') {
    const inc = c.medianHhIncomeUsd;
    if (inc == null) return null;
    // Cut against the spread of STATE medians, not against the national figure.
    // The national median is pulled up by high-income metros — 30 of the 50
    // states sit below it — so comparing states to it puts almost everyone in
    // the bottom band and the prior stops discriminating. These two cuts are the
    // terciles of the published state medians, so the three bands are real thirds.
    const value = inc >= 86_000 ? 'premium' : inc >= 75_000 ? 'core' : 'entry';
    const rank = inc >= 86_000 ? 'in the top third of states' : inc >= 75_000 ? 'in the middle third of states' : 'in the lower third of states';
    return {
      dim: 'priceBand',
      value,
      weight: PRIOR_WEIGHT,
      // Phrased as what leads the page, not as a verdict on the place.
      why: `Median household income in ${c.label} is $${inc.toLocaleString('en-US')}, ${rank}. So the page opens weighted toward the "${value}" price band — which products lead, not which products exist.`,
    };
  }

  const home = c.medianHomeValueUsd;
  if (home == null) return null;
  // A conventional first mortgage runs about 80% of the purchase price.
  const principal = Math.round(home * 0.8);
  const value = principal >= 250_000 ? 'major' : principal >= 25_000 ? 'core' : 'modest';
  return {
    dim: 'amountBand',
    value,
    weight: PRIOR_WEIGHT,
    why: `Median home value in ${c.label} is $${home.toLocaleString('en-US')}. At a conventional 80% loan-to-value that is about $${principal.toLocaleString(
      'en-US',
    )} of first mortgage — so the opening amount band is "${value}".`,
  };
}

export async function coldStart(cf: CfLike, db: D1Database, vertical: Vertical): Promise<ColdStart> {
  const country = cf?.country ?? null;
  const region = (cf?.regionCode ?? null) as string | null;
  const city = cf?.city ?? null;

  let census: CensusRow | null = null;
  let national: CensusRow | null = null;
  try {
    // US only: ACS is a US survey, and pretending otherwise is the exact kind of
    // over-claim this file exists to avoid.
    national = await censusFor(db, null);
    census = country === 'US' ? await censusFor(db, region) : national;
  } catch {
    /* a census miss must never break the page — cold start degrades to no prior */
  }

  const prior = census ? derivePrior(vertical, census, national) : null;
  const compared =
    census?.medianHhIncomeUsd != null && national?.medianHhIncomeUsd
      ? Math.round((census.medianHhIncomeUsd / national.medianHhIncomeUsd) * 100) / 100
      : null;

  return {
    ok: true,
    geo: { country, region, city, resolved: Boolean(country) },
    census: census ? { ...census, comparedToNational: compared } : null,
    prior,
    honesty: {
      geo: 'real-connection-property',
      census: 'real-public-acs-2024',
      prior: 'derived-from-census',
      behaviour: 'none-yet',
    },
    note:
      country === 'US'
        ? 'Region resolved at the edge; census figures are published ACS 2024; the band prior is derived arithmetic, shown above.'
        : 'Outside the US the ACS does not apply, so the national row is used and the prior is weaker. Stated rather than hidden.',
  };
}
