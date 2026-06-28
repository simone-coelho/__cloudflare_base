/**
 * Geo-Cohort Cold Start — geoCohort OPAL TOOL (thin wrapper).
 *
 * The logic lives in src/services/geo/cohort.ts (shared with GET /geo/cohort), so the Opal
 * chat and the storefront cold start narrate the IDENTICAL numbers — the same shared-brain
 * triangle as diagnoseFunnel / GET /funnel/diagnose.
 *
 * Mirrors the existing tool surface: same `tool({ description, inputSchema, execute })` shape
 * from `ai`, and the same env-via-closure mechanism (getOpalTools(env)). Register in OpalAgent.ts.
 *
 * Geo is an OPENING PRIOR (replaced by real behaviour on engagement) and an AGGREGATE
 * ("shoppers LIKE them, from here" — never an individual). Opal must CURATE, never price/gate,
 * and cite census with its vintage. See docs/architecture/13-geo-cohort-coldstart-prd-tdd.md.
 */
import { tool } from 'ai';
import { z } from 'zod';

import type { Env } from '@/types/env';
import { computeGeoCohort, getGeoCohortSource, type GeoInput } from '@/services/geo/cohort';

export function geoCohort(env: Env) {
  return tool({
    description:
      'Resolve the GEO-COHORT cold start for a brand-new visitor with no profile — "what shoppers LIKE them, ' +
      'from here, actually buy" — from the brand\'s OWN first-party purchase history plus REAL public census ' +
      'income/home-value. Use for cold-start / first-touch questions ("a visitor just landed in Winston-Salem, ' +
      'what do we open on?", "what do NC shoppers buy?", "geo cold start for ZIP 27101"). It walks the roll-up ' +
      'ladder ZIP → metro → region → national, STOPPING at the first grain with enough first-party shoppers, and ' +
      'returns granularityUsed + sampleSize (always cite the grain used), the top hero lines, modal price band, ' +
      'attach rate, AOV, browse→buy, and the census facts (median HH income + home value, with source + vintage). ' +
      'HONESTY: geo is REAL, the query is REAL, the first-party data is REPRESENTATIVE/synthetic ' +
      '(dataSource:"synthetic"), census is REAL public. It is an AGGREGATE opening prior replaced by real behaviour ' +
      'the moment they engage — describe "shoppers LIKE them", never this individual\'s income. CURATE merchandising ' +
      'only — NEVER price, gate, or vary access by geography. Read-only.',
    inputSchema: z.object({
      zip: z.string().optional().describe('5-digit ZIP of the detected visitor, e.g. "27101". Optional.'),
      region: z.string().optional().describe('2-letter state/subdivision code, e.g. "NC". Optional.'),
      city: z.string().optional().describe('Detected city, e.g. "Winston-Salem". Optional (label only).'),
      country: z.string().optional().describe('ISO-2 country, e.g. "US". Optional.'),
    }),
    execute: async ({ zip, region, city, country }) => {
      const geo: GeoInput = { zip, region, city, country };
      return computeGeoCohort(geo, getGeoCohortSource(env));
    },
  });
}
