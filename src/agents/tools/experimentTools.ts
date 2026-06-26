/**
 * experimentTools.ts — Opal tool for the A/B + CMAB workstream (owner: ab-cmab).
 * One-per-file (memo §11.2). Registered additively in agents/tools.ts via getExperimentTools().
 * Reuses experimentRun.runLaunch so an Opal-launched experiment is identical to a route-launched
 * one (same gate/simulate-fallback/readout/KV persistence). This is also the Opal-side entry of
 * the Revenue Radar seam: Opal "Launch" → runLaunch → { experimentId, readoutUrl }.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { runLaunch, normalizeInput } from '@/services/experimentRun';

export function getExperimentTools(env: Env): ToolSet {
  return {
    launchExperiment: tool({
      description:
        'Launch an experiment (A/B, MAB or CMAB) on a saved audience and take it LIVE in Optimizely FX ' +
        '(flag + variations + experiment rule), then show it in the Engine tab with a representative lift ' +
        'readout. WRITE action — gated; returns a SIMULATED experiment if writes are disabled so the demo ' +
        'still works. Use when the user asks to "launch/run an A/B test, experiment or bandit" or to ' +
        'activate a recommended fix. Pass the audienceId from createOptimizelyAudience to target a segment.',
      inputSchema: z.object({
        name: z.string().optional().describe('Experiment name, e.g. "Gen-Z BNPL checkout save".'),
        audienceId: z.number().optional().describe('Optimizely audience id to target (from createOptimizelyAudience). Omit for everyone.'),
        audienceName: z.string().optional().describe('Audience label for the readout.'),
        type: z.enum(['ab', 'mab', 'cmab']).optional().describe('Experiment flavour (default "ab").'),
        metric: z.object({ key: z.string(), name: z.string().optional() }).optional()
          .describe('Success metric, e.g. {key:"payment_to_purchase", name:"Checkout completion"}.'),
        variations: z.array(z.object({ key: z.string(), name: z.string().optional() })).min(2).optional()
          .describe('Variations; index 0 is control. Default: control vs BNPL + social-proof treatment.'),
      }),
      execute: async (args) => {
        const exp = await runLaunch(env, normalizeInput(args));
        return {
          status: exp.status,                 // 'live' | 'stubbed' | 'simulated'
          experimentId: exp.experimentId,
          experimentKey: exp.experimentKey,
          flagKey: exp.flagKey,
          ruleType: exp.ruleType,             // 'a/b' | 'targeted_delivery' (fell back)
          readoutUrl: exp.readoutUrl,
          lift: exp.readout?.foot,
          representative: true,
          note: 'Live in Optimizely FX (or simulated if writes are off). The Engine tab renders it as ' +
            'A/B → MAB with representative lift — figures illustrative; the platform is GA.',
        };
      },
    }),
  };
}
