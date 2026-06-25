// src/data/seed-audiences.ts
// The Coach launch AudienceDef[] seeded into the shared AudienceStore at boot.
// See docs/architecture/05-demo-build-spec.md §1.5 and data/synthetic/README.md.
//
// These are the 10 pre-aggregated ODP "insight views" from insights.json, lifted
// verbatim into the connector layer's AudienceDef shape. Because both mock
// adapters (MockSegmentProvider reads, MockAudienceAuthoring writes) point at the
// same store, seeding these makes them immediately qualifiable by ODP — the very
// first event a shopper generates is evaluated against every condition tree here.
//
// Cloudflare Workers cannot read files at runtime, so the data is BUNDLED via a
// static JSON import (resolveJsonModule). insights.json is a local copy of
// data/synthetic/insights.json; regenerate both with scripts/generate-synthetic-data.mjs.

import type { AudienceCondition, AudienceDef } from '@/connectors/types';
import insightsData from './insights.json';

/**
 * Shape of one entry in insights.json `insights[]` (ODP insight view).
 * `conditions` is already an ODP-shaped AudienceCondition tree, runtime-evaluable
 * by MockSegmentProvider — see data/synthetic/README.md "Pre-aggregated insight".
 */
export interface InsightView {
  key: string;
  name: string;
  description: string;
  nl_prompt: string;
  evaluation: 'realtime' | 'batch';
  recommended_module: string;
  anchor_line: string | null;
  conditions: AudienceCondition;
  stats: Record<string, number>;
  top_products?: Array<{
    product_id: string;
    name: string;
    line?: string;
    price_usd?: number;
    viewers?: number;
  }>;
  complete_the_look?: Array<{ product_id: string; name: string; price_usd?: number }>;
  sample_vuids?: string[];
}

/**
 * The raw insight views as bundled from insights.json (the Opal suggestion corpus).
 * Cast through `unknown`: the JSON's inferred literal types (e.g. `evaluation: string`,
 * loosely-typed `conditions` tuples) don't structurally overlap with the hand-written
 * InsightView, but the data is authored to this contract — see data/synthetic/README.md.
 */
export const INSIGHTS: InsightView[] = (insightsData as unknown as { insights: InsightView[] }).insights;

/**
 * Map one ODP insight view onto a published, real-time AudienceDef.
 * `conditions` is carried VERBATIM so what ODP qualifies against matches the
 * evidence the operator console showed. createdAt:0 marks these as boot seeds
 * (Opal-created audiences carry Date.now()).
 */
export function insightToAudienceDef(insight: InsightView): AudienceDef {
  return {
    key: insight.key,
    name: insight.name,
    description: insight.description,
    conditions: insight.conditions,
    evaluation: 'realtime',
    source: 'seed',
    status: 'published',
    createdAt: 0,
    recommendedModule: insight.recommended_module,
    // anchorLine is optional on AudienceDef; only set it when the insight has one.
    ...(insight.anchor_line ? { anchorLine: insight.anchor_line } : {}),
    stats: insight.stats,
  };
}

/**
 * The Coach launch audiences (cold-start, Tabby-affinity, journey-stage, intent,
 * loyalty and recovery cuts). KvAudienceStore.seed() loads these idempotently at
 * boot — it will not clobber audiences created live by Opal.
 */
export const SEED_AUDIENCES: AudienceDef[] = INSIGHTS.map(insightToAudienceDef);
