/**
 * experimentTools.ts — Opal tool for the A/B + MAB + CMAB workstream (owner: ab-cmab).
 * One-per-file (memo §11.2). Registered additively in agents/tools.ts via getExperimentTools().
 * Reuses experimentRun.runLaunch so an Opal-launched experiment is identical to a route-launched one.
 * Optionally drives the on-store experiment banner (#xsurf) via a preset `scenario` whose variations
 * carry crafted creative; the richer return lets the island auto-preview the first variation live.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { runLaunch, normalizeInput } from '@/services/experimentRun';
import { applyScenario } from '@/services/experimentScenarios';

export function getExperimentTools(env: Env): ToolSet {
  return {
    launchExperiment: tool({
      description:
        'Launch an experiment (A/B, MAB or CMAB) and take it LIVE in Optimizely (flag + variations + ' +
        'experiment rule + event metric), then render it on the storefront experiment banner + the Engine ' +
        'readout. WRITE action — gated; returns a SIMULATED experiment if writes are disabled so the demo ' +
        'still works. Prefer a PRESET `scenario` for crafted, on-brand variations the shopper sees live: ' +
        'welcome_email_phone (A/B: email-15% vs phone-10%) · hero_creative_bandit (MAB hero creatives) · ' +
        'context_welcome (CMAB, different offer per shopper-context) · move_brooklyn (MAB, sell a slow line ' +
        'with no markdown) · bnpl_rogue (A/B pay-in-4) · tiktok_tabby_moment (MAB: the Signal-Led Moment ' +
        'encore — an "As seen on TikTok" Tabby takeover that delivers discrete hero feature variables ' +
        '(hero_image/eyebrow/headline/subcopy/offer/cta_label/badge…) and a real multi_armed_bandit rule; ' +
        'for tiktok_tabby_moment you may pass `copy` to put your own headline/eyebrow/etc. into those ' +
        'variables). Pass an audienceId (from createOptimizelyAudience) to target a segment.',
      inputSchema: z.object({
        scenario: z.string().optional().describe('Preset scenario id — see the list in the description. If set, its type/variations/metric drive the on-store banner.'),
        name: z.string().optional().describe('Experiment name (used when no scenario).'),
        audienceId: z.number().optional().describe('Optimizely audience id to target (from createOptimizelyAudience). Omit for everyone.'),
        audienceName: z.string().optional().describe('Audience label for the readout.'),
        type: z.enum(['ab', 'mab', 'cmab']).optional().describe('Experiment flavour (default "ab"); ignored if a scenario is given.'),
        metric: z.object({ key: z.string(), name: z.string().optional(), eventKey: z.string().optional() }).optional()
          .describe('Success metric (ignored if a scenario is given), e.g. {key:"add_to_cart", eventKey:"add_to_cart"}.'),
        variations: z.array(z.object({ key: z.string(), name: z.string().optional() })).min(2).optional()
          .describe('Variations (ignored if a scenario is given); index 0 is control.'),
        copy: z.object({
          eyebrow: z.string().optional(),
          headline: z.string().optional(),
          subcopy: z.string().optional(),
          offer: z.string().optional(),
          ctaLabel: z.string().optional(),
          badge: z.string().optional(),
        }).optional().describe('Signal-Led Moment ONLY (scenario:"tiktok_tabby_moment"): your written copy flows into the discrete hero feature variables on the winning arm (eyebrow/headline/subcopy/offer/cta_label/badge). Omit to use the on-brand canned copy.'),
      }),
      execute: async (args) => {
        const exp = await runLaunch(env, normalizeInput(applyScenario(args)));
        const vlist = (exp.variations || []).map((v: any) => ({ key: v.key, name: v.name, isControl: v.isControl }));
        const firstTreat = vlist.find((v: any) => !v.isControl) || vlist[0];
        return {
          status: exp.status,                 // 'live' | 'stubbed' | 'simulated'
          experimentId: exp.experimentId,
          experimentKey: exp.experimentKey,   // the flag the storefront decides/renders
          flagKey: exp.flagKey,
          ruleType: exp.ruleType,             // a/b · multi_armed_bandit · contextual_multi_armed_bandit · targeted_delivery
          metricKind: exp.metricKind,
          enabled: exp.enabled,
          readoutUrl: exp.readoutUrl,
          lift: exp.readout?.foot,
          variations: vlist,
          firstVariationKey: firstTreat ? firstTreat.key : undefined,
          metricEventKey: exp.metric?.eventKey || exp.metric?.key,
          representative: true,
          note: 'Live in Optimizely (or simulated if writes are off). The storefront renders the assigned ' +
            'variation on the experiment banner; the Engine readout shows the result — figures representative.',
        };
      },
    }),
  };
}
