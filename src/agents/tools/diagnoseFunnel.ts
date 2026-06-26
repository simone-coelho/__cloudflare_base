/**
 * Revenue Radar — diagnoseFunnel OPAL TOOL (thin wrapper).
 *
 * The diagnosis logic lives in src/services/funnel/diagnose.ts (shared with GET /funnel/diagnose),
 * so the Opal chat and the Revenue Radar panel produce IDENTICAL recommendations.
 *
 * Mirrors the existing tool surface in src/agents/tools.ts: same `tool({ description, inputSchema,
 * execute })` shape from `ai`, and the same env-access mechanism — a factory capturing `env` via
 * closure (getOpalTools(env)). Register it in OpalAgent.ts.
 */
import { tool } from 'ai';
import { z } from 'zod';

import type { Env } from '@/types/env';
import { buildFunnelDiagnosis } from '@/services/funnel/diagnose';

export function diagnoseFunnel(env: Env) {
  return tool({
    description:
      'Diagnose WHERE a checkout funnel is losing revenue for a brand + generational cohort, and propose a ' +
      'launchable fix. Reads the live funnel, ranks the most anomalous drop-offs, and returns ranked ' +
      'recommendations — each with a target audience (an Optimizely condition tree ready for ' +
      'createOptimizelyAudience), a remedy (BNPL, cart recovery, shipping estimator, or reassurance), a ' +
      'control-vs-treatment experiment on the purchase metric, and projected $ recovery. Use when asked ' +
      '"where are we losing checkout revenue", to analyse the funnel, or to find/fix checkout drop-off. ' +
      'Read-only — it proposes the plan; actually launching the audience/flag is a separate gated step.',
    inputSchema: z.object({
      brand: z
        .string()
        .optional()
        .describe("Brand to diagnose — one of: Coach, Kate Spade, Stuart Weitzman. Default 'Coach'."),
      cohort: z
        .string()
        .optional()
        .describe("Generational cohort — one of: gen_z, millennial, gen_x, boomer. Default 'gen_z'."),
    }),
    execute: async ({ brand, cohort }) => buildFunnelDiagnosis(env, { brand, cohort }),
  });
}
