import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { createAudienceLive, launchTargetedFlag, addMessageRule, type FxConfig } from '@/services/optimizelyFx';

/**
 * Opal agent tool surface.
 *
 *  - queryData ................. READ: ONE guarded read-only SQL SELECT over the Coach
 *      datastore (allow-listed tables/views, LIMIT-capped). Lets Opal answer ANY
 *      analytical question over the real seeded data (the full schema is in the agent's
 *      system prompt), instead of a handful of fixed filters.
 *  - createOptimizelyAudience .. WRITE (gated): real FX audience via the validated chain.
 *  - createFlag ................ WRITE (gated): real FX flag + rule, taken LIVE.
 */

const ALLOWED_TABLES = new Set([
  'v_audience_base', 'v_profiles', 'v_demo_profiles', 'demo_events',
  'coach_catalog', 'coach_transactions', 'coach_purchase_items', 'coach_odp_profiles',
  'meta_attribute_catalog',
]);

/** Validate `sql` is a single read-only SELECT over allow-listed tables; enforce a LIMIT. */
function guardSelect(sql: string): { ok: true; sql: string } | { ok: false; error: string } {
  let s = (sql || '').trim().replace(/;\s*$/, '');
  if (!s) return { ok: false, error: 'Empty query.' };
  if (s.includes(';')) return { ok: false, error: 'Only one statement is allowed (no semicolons).' };
  if (!/^(select|with)\b/i.test(s)) return { ok: false, error: 'Only SELECT (or WITH … SELECT) queries are allowed.' };
  if (/\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex|truncate)\b/i.test(s)) {
    return { ok: false, error: 'Only read-only SELECT is allowed (no writes/DDL/pragma).' };
  }
  const refs = [...s.matchAll(/\b(?:from|join)\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/gi)].map((m) => m[1].toLowerCase());
  for (const r of refs) {
    if (!ALLOWED_TABLES.has(r)) {
      return { ok: false, error: `Table/view "${r}" is not queryable. Allowed: ${[...ALLOWED_TABLES].join(', ')}.` };
    }
  }
  if (!/\blimit\s+\d+/i.test(s)) s = `${s} LIMIT 200`;
  return { ok: true, sql: s };
}

export function getOpalTools(env: Env): ToolSet {
  return {
    queryData: tool({
      description:
        'Run ONE read-only SQLite SELECT against the Coach customer + commerce datastore to answer ANY ' +
        'analytical question — audience sizing, behaviour, revenue, products, loyalty, churn, gifting, BNPL, ' +
        'geography, 90-day trends, and more. Aggregate IN the SQL (COUNT / AVG / SUM / GROUP BY) and reason ' +
        'over the returned summary — never request raw customer rows. The full schema is in your system ' +
        'instructions. Results are capped at 200 rows; if a query errors, read the message and correct the SQL.',
      inputSchema: z.object({
        sql: z.string().describe('A single read-only SQLite SELECT (or WITH … SELECT) over the allowed tables/views.'),
        purpose: z.string().optional().describe('One line: the business question this answers.'),
      }),
      execute: async ({ sql }) => {
        if (!env.DB) return { error: 'No database is bound.' };
        const g = guardSelect(sql);
        if (!g.ok) return { error: g.error };
        try {
          const res = await env.DB.prepare(g.sql).all();
          const rows = (res.results as unknown[]) || [];
          return { source: 'd1', sql: g.sql, rowCount: rows.length, rows: rows.slice(0, 100) };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e), sql: g.sql, hint: 'Check column/table names against the schema.' };
        }
      },
    }),

    createOptimizelyAudience: tool({
      description:
        'Create a REAL audience in Optimizely Feature Experimentation. WRITE action — gated. ' +
        'Returns the exact plan unless writes are explicitly enabled. Use after the user asks to ' +
        'create/save an audience. Provide the condition tree referencing attributes by key.',
      inputSchema: z.object({
        name: z.string().min(1).describe('Human-readable audience name.'),
        description: z.string().optional().describe('What this audience represents.'),
        conditions: z
          .string()
          .describe(
            'Optimizely condition tree as a JSON string. Leaves: ' +
              '{"name":"<attr_key>","type":"custom_attribute","match_type":"exact|gt|lt","value":...}. ' +
              'e.g. ["and",["or",{"name":"persona","type":"custom_attribute","match_type":"exact","value":"luxe_collector"}]]'
          ),
      }),
      execute: async ({ name, description, conditions }) => {
        const gate = gateWrite(env);
        if (!gate.enabled) {
          return { status: 'stubbed', action: 'createOptimizelyAudience', reason: gate.reason, wouldCreate: { name, description, conditions } };
        }
        try {
          const cfg = fxConfig(env);
          const r = await createAudienceLive(cfg, { name, description, conditions });
          return {
            status: 'created',
            ...r,
            datafileUrl: cfg.sdkKey ? `https://cdn.optimizely.com/datafiles/${cfg.sdkKey}.json` : undefined,
            note: 'Audience created in Optimizely FX. Use createFlag with this audienceId to take an experience live to it.',
          };
        } catch (e) {
          return { status: 'error', action: 'createOptimizelyAudience', message: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    createFlag: tool({
      description:
        'Create a feature flag AND take it LIVE to a targeted audience in Optimizely FX ' +
        '(flag + an "on" variation + a targeted-delivery rule, then enable it). WRITE action — gated. ' +
        'Pass the audienceId returned by createOptimizelyAudience.',
      inputSchema: z.object({
        key: z.string().regex(/^[a-z0-9_]+$/, 'lower snake_case').describe('Flag key (lower snake_case), e.g. "complete_the_look".'),
        name: z.string().min(1).describe('Human-readable flag name.'),
        description: z.string().optional().describe('What this flag controls.'),
        audienceId: z.number().optional().describe('Optimizely audience id to target (from createOptimizelyAudience). Omit to serve everyone.'),
      }),
      execute: async ({ key, name, description, audienceId }) => {
        const gate = gateWrite(env);
        if (!gate.enabled) {
          return { status: 'stubbed', action: 'createFlag', reason: gate.reason, wouldLaunch: { key, name, audienceId } };
        }
        try {
          const cfg = fxConfig(env);
          const r = await launchTargetedFlag(cfg, { flagKey: key, flagName: name, description, audienceId });
          return { status: 'live', ...r, note: 'Flag is live. The datafile regenerates in ~20-30s; the storefront SDK (Mode-B) then serves it.' };
        } catch (e) {
          return { status: 'error', action: 'createFlag', message: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    targetMessageToAudience: tool({
      description:
        'Personalize the storefront BANNER for an audience: create the audience and append a cascading ' +
        'targeted-delivery rule to the shared `personalized_banner` flag that shows a specific MESSAGE to ' +
        'that audience. Use this whenever the user wants to "show/target a banner or message to [audience]", ' +
        '"if this audience is met, change their messaging to …", or "personalize the banner for …". ' +
        'WRITE action — gated.',
      inputSchema: z.object({
        audienceName: z.string().min(1).describe('Short audience name, e.g. "High-intent Tabby browsers".'),
        conditions: z
          .string()
          .describe(
            'Audience condition tree as a JSON string referencing attributes by key (viewed_product_line, persona, ' +
              'loyalty_tier, cart_abandoned, etc.). e.g. ["and",["or",{"name":"viewed_product_line","type":"custom_attribute","match_type":"exact","value":"Tabby"}]]'
          ),
        message: z.string().min(1).describe('The exact banner copy to show this audience.'),
      }),
      execute: async ({ audienceName, conditions, message }) => {
        const gate = gateWrite(env);
        if (!gate.enabled) {
          return { status: 'stubbed', action: 'targetMessageToAudience', reason: gate.reason, wouldCreate: { audienceName, conditions, message } };
        }
        try {
          const r = await addMessageRule(fxConfig(env), { audienceName, conditions, message });
          return { status: 'live', ...r, note: 'Banner rule is live on the personalized_banner flag. The storefront can now preview this audience to render the message.' };
        } catch (e) {
          return { status: 'error', action: 'targetMessageToAudience', message: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
  };
}

function fxConfig(env: Env): FxConfig {
  return {
    token: String(env.OPTIMIZELY_API_TOKEN ?? ''),
    projectId: String(env.OPTIMIZELY_PROJECT_ID ?? ''),
    environment: env.OPTIMIZELY_ENVIRONMENT || 'development',
    sdkKey: env.OPTIMIZELY_SDK_KEY,
  };
}

/** Gate for write tools: require an explicit flag + an API token. */
function gateWrite(env: Env): { enabled: boolean; reason: string } {
  if (env.OPTIMIZELY_WRITE_ENABLED !== 'true') {
    return { enabled: false, reason: 'OPTIMIZELY_WRITE_ENABLED is not "true" — showing the plan only (writes disabled).' };
  }
  if (!env.OPTIMIZELY_API_TOKEN) {
    return { enabled: false, reason: 'OPTIMIZELY_API_TOKEN is not configured.' };
  }
  return { enabled: true, reason: 'enabled' };
}
