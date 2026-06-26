import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Env } from '@/types/env';

/**
 * Opal agent tool surface.
 *
 * These are the "real seams, mocked calls" tools the Opal chat exposes to Gemini.
 * Schemas are precise and final; bodies are safe to run today (no external creds
 * required) and are wired so that the real integrations can be dropped in later
 * behind the existing env gates.
 *
 *  - queryAudienceData ......... READ: aggregate-then-reason over D1 (falls back to
 *                                a deterministic mocked aggregate when no D1 is bound).
 *  - createOptimizelyAudience .. WRITE: Optimizely FX REST, clearly gated stub.
 *  - createFlag ................ WRITE: Optimizely FX REST, clearly gated stub.
 */
export function getOpalTools(env: Env): ToolSet {
  return {
    queryAudienceData: tool({
      description:
        'Query the customer/event datastore for an AGGREGATED, reasoned answer about an ' +
        'audience or segment (size, behaviour, revenue, conversion). Always aggregate in ' +
        'the query layer and reason over the summary — never request raw rows. Use this for ' +
        'any question about "how many", "what do they buy", segment performance, etc.',
      inputSchema: z.object({
        question: z
          .string()
          .describe('The natural-language analytics question being answered.'),
        segment: z
          .string()
          .optional()
          .describe(
            "Optional audience/segment to scope to, e.g. 'high-intent-handbags' or 'lapsed-vip'."
          ),
        metric: z
          .enum(['count', 'revenue', 'aov', 'conversion_rate', 'engagement'])
          .default('count')
          .describe('Primary metric to aggregate.'),
        window: z
          .enum(['24h', '7d', '30d', '90d'])
          .default('30d')
          .describe('Time window for the aggregation.'),
      }),
      execute: async ({ question, segment, metric, window }) => {
        // Prefer a real D1 binding when present; aggregate in SQL so only a compact
        // summary reaches the model (aggregate-then-reason).
        if (env.DB) {
          try {
            const scope = segment ? ' WHERE segment = ?1' : '';
            const stmt = env.DB.prepare(
              `SELECT COUNT(DISTINCT user_id) AS users,
                      ROUND(AVG(order_value), 2)   AS aov,
                      ROUND(SUM(order_value), 2)   AS revenue,
                      ROUND(AVG(converted) * 100, 1) AS conversion_rate
                 FROM events${scope}`
            );
            const row = await (segment ? stmt.bind(segment) : stmt).first<{
              users: number;
              aov: number;
              revenue: number;
              conversion_rate: number;
            }>();
            if (row) {
              return {
                source: 'd1',
                segment: segment ?? 'all',
                metric,
                window,
                aggregates: row,
                question,
              };
            }
          } catch {
            // Table not provisioned yet — fall through to the demo aggregate.
          }
        }

        // Deterministic mocked aggregate (clearly labelled). Safe for demos/smoke tests.
        const seed = (segment ?? 'all').length + window.length;
        const users = 1850 + seed * 137;
        const aggregates = {
          users,
          aov: 312.4,
          revenue: Math.round(users * 312.4 * 0.18),
          conversion_rate: 4.7,
          engagement_score: 0.62,
          top_categories: ['handbags', 'small-leather-goods', 'ready-to-wear'],
        };
        return {
          source: 'mock',
          segment: segment ?? 'all',
          metric,
          window,
          aggregates,
          question,
          note: 'Aggregated demo data (no D1 bound). Reason over these summaries; do not invent raw rows.',
        };
      },
    }),

    createOptimizelyAudience: tool({
      description:
        'Create a new audience in Optimizely Feature Experimentation (FX) via the REST API. ' +
        'WRITE action — gated. Returns a stub plan unless writes are explicitly enabled.',
      inputSchema: z.object({
        name: z.string().min(1).describe('Human-readable audience name.'),
        description: z.string().optional().describe('What this audience represents.'),
        conditions: z
          .string()
          .describe(
            'Optimizely audience condition tree as a JSON string, e.g. ' +
              '["and",["or",{"type":"custom_attribute","name":"segment","value":"vip"}]].'
          ),
      }),
      execute: async ({ name, description, conditions }) => {
        const gate = gateWrite(env);
        if (!gate.enabled) {
          return {
            status: 'stubbed',
            action: 'createOptimizelyAudience',
            reason: gate.reason,
            wouldSend: {
              method: 'POST',
              url: `https://api.optimizely.com/v2/audiences`,
              body: { project_id: env.OPTIMIZELY_PROJECT_ID ?? '<project_id>', name, description, conditions },
            },
          };
        }
        // Real wiring (enabled only when OPTIMIZELY_WRITE_ENABLED=true + token present).
        const res = await fetch('https://api.optimizely.com/v2/audiences', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.OPTIMIZELY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            project_id: Number(env.OPTIMIZELY_PROJECT_ID),
            name,
            description,
            conditions,
          }),
        });
        return { status: res.ok ? 'created' : 'error', http: res.status, body: await res.json().catch(() => null) };
      },
    }),

    createFlag: tool({
      description:
        'Create a new feature flag in Optimizely Feature Experimentation (FX) via the REST API. ' +
        'WRITE action — gated. Returns a stub plan unless writes are explicitly enabled.',
      inputSchema: z.object({
        key: z
          .string()
          .regex(/^[a-z0-9_]+$/, 'lower snake_case')
          .describe('Flag key (lower snake_case), e.g. "vip_free_shipping".'),
        name: z.string().min(1).describe('Human-readable flag name.'),
        description: z.string().optional().describe('What this flag controls.'),
      }),
      execute: async ({ key, name, description }) => {
        const gate = gateWrite(env);
        const projectId = env.OPTIMIZELY_PROJECT_ID ?? '<project_id>';
        if (!gate.enabled) {
          return {
            status: 'stubbed',
            action: 'createFlag',
            reason: gate.reason,
            wouldSend: {
              method: 'POST',
              url: `https://api.optimizely.com/flags/v1/projects/${projectId}/flags`,
              body: { key, name, description },
            },
          };
        }
        const res = await fetch(
          `https://api.optimizely.com/flags/v1/projects/${projectId}/flags`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.OPTIMIZELY_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ key, name, description }),
          }
        );
        return { status: res.ok ? 'created' : 'error', http: res.status, body: await res.json().catch(() => null) };
      },
    }),
  };
}

/** Gate for write tools: require an explicit flag + an API token. */
function gateWrite(env: Env): { enabled: boolean; reason: string } {
  if (env.OPTIMIZELY_WRITE_ENABLED !== 'true') {
    return { enabled: false, reason: 'OPTIMIZELY_WRITE_ENABLED is not "true" (writes disabled).' };
  }
  if (!env.OPTIMIZELY_API_TOKEN) {
    return { enabled: false, reason: 'OPTIMIZELY_API_TOKEN is not configured.' };
  }
  return { enabled: true, reason: 'enabled' };
}
