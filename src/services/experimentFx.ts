/**
 * experimentFx.ts — A/B + CMAB workstream (owner: ab-cmab).
 *
 * `launchExperiment()` is the ONE integration seam with the Revenue Radar workstream
 * (their Opal "Launch" → our engine → { experimentId, readoutUrl }). It builds a REAL
 * Optimizely artifact on top of the VALIDATED primitives in optimizelyFx.ts (ensureFlag /
 * ensureVariations / ensureRule / enableLive), preferring a true Optimizely **A/B experiment
 * rule** (multi-variation traffic split) and **auto-falling back to the proven
 * targeted-delivery path** if the experiment-rule REST is rejected — so the demo never breaks.
 *
 * Honesty tier (TDD §7): the artifact is real and pullable in the Optimizely UI; the lift
 * figures rendered in the Engine readout are clearly-labeled REPRESENTATIVE (real statistical
 * results need real traffic over time). Numbers are computed/stored by the route layer.
 */
import {
  type FxConfig,
  ensureFlag,
  ensureVariations,
  ensureRule,
  enableLive,
} from '@/services/optimizelyFx';

const FLAGS = 'https://api.optimizely.com/flags/v1';
const ADMIN = 'https://api.optimizely.com/v2';

/** Tiny REST helper (optimizelyFx's `api` is module-private; this mirrors it). */
async function api(cfg: FxConfig, method: string, path: string, body?: unknown): Promise<{ status: number; ok: boolean; json: any }> {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}

function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'experiment';
}
function rulesetUrl(cfg: FxConfig, flagKey: string, env: string): string {
  return `${FLAGS}/projects/${cfg.projectId}/flags/${flagKey}/environments/${env}/ruleset`;
}

export interface ExperimentVariation {
  key: string;
  name?: string;
  percentage?: number;             // basis points (10000 = 100%); auto-split if omitted
  variables?: Record<string, { value: string }>;
}
export interface ExperimentMetric {
  key: string;                     // e.g. 'payment_to_purchase'
  name?: string;                   // e.g. 'Checkout completion'
  eventKey?: string;               // demo_events event_type the readout attributes to (default 'purchase')
  aggregator?: 'unique' | 'count' | 'rate';
}

/** The seam contract — Revenue Radar builds to this shape blind. */
export interface LaunchExperimentInput {
  experimentKey?: string;          // flag key; default derived from name/audience
  name?: string;
  audienceId?: number;             // saved Optimizely audience (from createAudienceLive); omit → everyone
  audienceName?: string;           // for labels/readout
  variations: ExperimentVariation[]; // ≥2; index 0 is treated as control
  metric: ExperimentMetric;
  type?: 'ab' | 'mab' | 'cmab';    // readout flavour (default 'ab')
  environment?: string;
  baseUrl?: string;                // origin for readoutUrl (route passes the request origin)
}

export interface LaunchExperimentResult {
  experimentId: string;            // stable id (flag id, or key when id absent)
  experimentKey: string;           // flag key
  flagKey: string;
  ruleKey: string;
  environment: string;
  type: 'ab' | 'mab' | 'cmab';
  ruleType: 'a/b' | 'targeted_delivery';
  variations: { key: string; name: string; percentage: number; isControl: boolean; id?: number }[];
  audienceId?: number;
  metric: ExperimentMetric;
  readoutUrl: string;
  status: 'live';
  representative: true;            // honesty flag — lift figures are illustrative
  fellBack: boolean;              // true → the A/B rule REST was rejected and we used targeted-delivery
  diagnostics?: unknown;          // raw API error when we fell back (for verification, omit in UI)
}

interface NormVar { key: string; name: string; isControl: boolean; percentage: number; variables?: Record<string, { value: string }> }

function normalizeVariations(vars: ExperimentVariation[]): NormVar[] {
  const list = Array.isArray(vars) && vars.length >= 2
    ? vars.slice()
    : [{ key: 'control', name: 'Control' }, { key: 'treatment', name: 'Treatment' }];
  const n = list.length;
  const base = Math.floor(10000 / n);
  return list.map((v, i) => ({
    key: slug(v.key || (i === 0 ? 'control' : `variation_${i}`)),
    name: v.name || v.key || (i === 0 ? 'Control' : `Variation ${i}`),
    isControl: i === 0,
    percentage: typeof v.percentage === 'number' ? v.percentage : (i === n - 1 ? 10000 - base * (n - 1) : base),
    variables: v.variables,
  }));
}

/** A real Optimizely FX experiment ('a/b') rule value: a traffic split across variations + a metric. */
function experimentRuleValue(ruleKey: string, name: string, vars: NormVar[], audienceId?: number, metricRef?: { eventId?: number | null; eventKey?: string }): Record<string, unknown> {
  const variations: Record<string, unknown> = {};
  for (const v of vars) variations[v.key] = { key: v.key, name: v.name, percentage_included: v.percentage };
  const value: Record<string, unknown> = {
    key: ruleKey, name, type: 'a/b', percentage_included: 10000, variations,
  };
  // FX rejects an experiment rule with no metric. With an event id → unique-conversion on that event.
  // WITHOUT one → the built-in REVENUE metric (FX: "a metric without an event ID must be a revenue
  // metric, aggregator 'sum', field 'revenue'"), which needs no event creation — a valid primary
  // metric for a checkout/BNPL experiment.
  if (metricRef && metricRef.eventId) {
    value.metrics = [{ event_id: Number(metricRef.eventId), aggregator: 'unique', scope: 'visitor', winning_direction: 'increasing' }];
  } else {
    value.metrics = [{ aggregator: 'sum', field: 'revenue', winning_direction: 'increasing', scope: 'visitor' }];
  }
  if (audienceId) {
    value.audience_conditions = ['or', { audience_id: Number(audienceId) }];
    value.audience_ids = [Number(audienceId)];
  } else {
    value.audience_conditions = [];
  }
  return value;
}

/**
 * Ensure an Optimizely event exists (experiment metrics reference an event). Optimizely events
 * live on the v2 Admin API. Returns the id + raw diagnostics so a failed shape is visible.
 */
async function ensureMetricEvent(cfg: FxConfig, key: string, name?: string): Promise<{ id: number | null; diag: any }> {
  const k = slug(key);
  // List first — reuse an existing event by key (events archive, not hard-delete).
  const list = await api(cfg, 'GET', `${ADMIN}/events?project_id=${cfg.projectId}&per_page=100`);
  const items: any[] = Array.isArray(list.json) ? list.json : (list.json?.items || []);
  const found = items.find((e) => e && e.key === k);
  if (found) return { id: found.id ?? null, diag: { listStatus: list.status, reused: true, id: found.id } };
  // Create a custom event on the v2 Admin API.
  const r = await api(cfg, 'POST', `${ADMIN}/events`, {
    project_id: Number(cfg.projectId), key: k, name: name || k, event_type: 'custom', category: 'other',
    description: `Experiment metric event (ab-cmab): ${k}`,
  });
  return {
    id: r.ok ? (r.json?.id ?? null) : null,
    diag: { listStatus: list.status, listSample: items.slice(0, 1), createStatus: r.status, createBody: r.ok ? { id: r.json?.id } : r.json },
  };
}

/**
 * Launch an experiment. Creates (idempotently): flag → variations → an A/B experiment rule
 * (split traffic), enabled live. Falls back to a proven targeted-delivery rule (100% → the
 * treatment) if the experiment-rule PATCH is rejected, so the seam always resolves.
 */
export async function launchExperiment(cfg: FxConfig, input: LaunchExperimentInput): Promise<LaunchExperimentResult> {
  const env = input.environment || cfg.environment || 'development';
  const type = input.type || 'ab';
  const key = slug(input.experimentKey || input.name || input.audienceName || 'experiment');
  const name = input.name || `${input.audienceName || 'Experiment'} — ${input.metric?.name || 'lift'}`;
  const vars = normalizeVariations(input.variations);

  // 1) Flag — carries the assigned variant key + a treatment toggle the edge can read.
  const flag = await ensureFlag(cfg, {
    key,
    name,
    description: `A/B experiment (owner: ab-cmab)${input.metric?.name ? ' — ' + input.metric.name : ''}`,
    variable_definitions: {
      variant: { key: 'variant', type: 'string', default_value: 'control', description: 'Assigned variation key.' },
      module_enabled: { key: 'module_enabled', type: 'boolean', default_value: 'false', description: 'Render the treatment experience.' },
    },
  });

  // 2) Variations — each carries its own variant key + toggle (control off, others on).
  const variationIds = await ensureVariations(cfg, key, vars.map((v) => ({
    key: v.key,
    name: v.name,
    variables: v.variables || { variant: { value: v.key }, module_enabled: { value: v.isControl ? 'false' : 'true' } },
  })));

  // 3) Rule — prefer a real A/B experiment (split); fall back to targeted-delivery on rejection.
  const ruleKey = `${key}_exp`;
  let ruleType: 'a/b' | 'targeted_delivery' = 'a/b';
  let fellBack = false;
  let diagnostics: unknown;

  // A real A/B experiment rule requires ≥1 metric → ensure an Optimizely event to measure; if event
  // CREATE isn't available, reference it by KEY on the rule (FX may register it on first use).
  const metricKey = slug(input.metric?.eventKey || input.metric?.key || 'experiment_conversion');
  let metricEventId: number | null = null;
  let metricDiag: unknown = null;
  try {
    const ev = await ensureMetricEvent(cfg, metricKey, input.metric?.name);
    metricEventId = ev.id; metricDiag = ev.diag;
  } catch (e) { metricDiag = { error: e instanceof Error ? e.message : String(e) }; }

  const rs = await api(cfg, 'GET', rulesetUrl(cfg, key, env));
  const exists = !!rs.json?.rules?.[ruleKey];
  if (!exists) {
    const metricRef = { eventId: metricEventId, eventKey: metricKey };
    const patch = [
      { op: 'add', path: `/rules/${ruleKey}`, value: experimentRuleValue(ruleKey, name, vars, input.audienceId, metricRef) },
      { op: 'add', path: '/rule_priorities/-', value: ruleKey },
    ];
    const r = await api(cfg, 'PATCH', rulesetUrl(cfg, key, env), patch);
    if (r.ok) {
      ruleType = 'a/b';
    } else {
      // True experiment rule rejected — record EXACTLY why, then create the real targeted-delivery
      // artifact so the flag still goes live (labeled honestly as 'targeted_delivery', not 'a/b').
      fellBack = true;
      ruleType = 'targeted_delivery';
      diagnostics = { abRuleStatus: r.status, abRuleError: r.json, metricEvent: metricDiag, metricRefTried: metricRef };
      const treatment = vars.find((v) => !v.isControl) || vars[vars.length - 1];
      await ensureRule(cfg, key, env, {
        key: ruleKey, name, type: 'targeted_delivery', variationKey: treatment.key, percentage_included: 10000,
      }, input.audienceId);
    }
  } else {
    // A pre-existing rule — detect its type for an accurate readout label.
    ruleType = rs.json.rules[ruleKey]?.type === 'a/b' ? 'a/b' : 'targeted_delivery';
  }

  // 4) Take it live (flag-on in env + rule enabled).
  await enableLive(cfg, key, env, ruleKey);

  const readoutUrl = `${input.baseUrl || ''}/storefront?experiment=${encodeURIComponent(key)}#engine`;
  return {
    experimentId: String(flag?.id ?? key),
    experimentKey: key,
    flagKey: key,
    ruleKey,
    environment: env,
    type,
    ruleType,
    variations: vars.map((v) => ({ key: v.key, name: v.name, percentage: v.percentage, isControl: v.isControl, id: variationIds[v.key] })),
    audienceId: input.audienceId,
    metric: input.metric,
    readoutUrl,
    status: 'live',
    representative: true,
    fellBack,
    diagnostics,
  };
}
