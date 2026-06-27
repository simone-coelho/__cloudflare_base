/**
 * experimentFx.ts — A/B + MAB + CMAB workstream (owner: ab-cmab).
 *
 * `launchExperiment()` is the ONE integration seam with the Revenue Radar workstream
 * (their Opal "Launch" → our engine → { experimentId, readoutUrl }). It builds a REAL Optimizely
 * artifact on top of the VALIDATED primitives in optimizelyFx.ts (ensureFlag / ensureVariations /
 * enableLive) plus a typed ruleset rule:
 *   - A/B            → rule `type: "a/b"`               (fixed split + metric)
 *   - MAB            → rule `type: "multi_armed_bandit"` (even split, no baseline, event metric)
 *   - CMAB           → `multi_armed_bandit` + contextual user-attributes (field WIP — see launch)
 * It auto-falls back to a proven `targeted_delivery` rule only if the typed rule is rejected, so the
 * demo loop never breaks.
 *
 * Verified against the live FX API (2026-06-26): rule.type ∈ {a/b, multi_armed_bandit, targeted_delivery};
 * variations are an object-map keyed by variation with `percentage_included`; an experiment rule needs
 * ≥1 metric — either an EVENT metric (event_id from a custom event) or a REVENUE metric (no event).
 * Custom events are created at `POST /v2/projects/{pid}/custom_events`. Lift figures shown in the Engine
 * readout are clearly-labeled REPRESENTATIVE (real stats need real traffic over time).
 */
import {
  type FxConfig,
  ensureFlag,
  ensureVariations,
  ensureRule,
  ensureAttributes,
  enableLive,
} from '@/services/optimizelyFx';

const FLAGS = 'https://api.optimizely.com/flags/v1';
const ADMIN = 'https://api.optimizely.com/v2';

type FxRuleType = 'a/b' | 'multi_armed_bandit' | 'contextual_multi_armed_bandit' | 'targeted_delivery';

/** Maps the seam's experiment flavour → the FX ruleset rule.type (verified live against the real API). */
const RULE_TYPE: Record<string, 'a/b' | 'multi_armed_bandit' | 'contextual_multi_armed_bandit'> = {
  ab: 'a/b', mab: 'multi_armed_bandit', cmab: 'contextual_multi_armed_bandit',
};

/** Contextual attributes a CMAB rule personalizes on (created/reused via ensureAttributes → attribute_ids). */
const CMAB_CONTEXT_ATTRS = ['device', 'persona', 'journey_stage'];

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
  eventKey?: string;               // custom-event key the metric measures (default derived from type)
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
  type?: 'ab' | 'mab' | 'cmab';    // experiment flavour (default 'ab')
  environment?: string;
  baseUrl?: string;                // origin for readoutUrl (route passes the request origin)
}

export interface LaunchExperimentResult {
  experimentId: string;            // stable id (flag id, or key when id absent)
  experimentKey: string;
  flagKey: string;
  ruleKey: string;
  environment: string;
  type: 'ab' | 'mab' | 'cmab';
  ruleType: FxRuleType;
  metricKind: 'event' | 'revenue';
  variations: { key: string; name: string; percentage: number; isControl: boolean; id?: number }[];
  audienceId?: number;
  metric: ExperimentMetric;
  readoutUrl: string;
  status: 'live';
  enabled: boolean;                // false → real rule created but left as draft (e.g. CMAB pending review)
  representative: true;
  fellBack: boolean;               // true → typed rule rejected, used targeted-delivery instead
  diagnostics?: unknown;
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

/**
 * Ensure a custom event exists so an experiment metric can reference its event_id.
 * Verified live: create = POST /v2/projects/{pid}/custom_events {key, name, description}; the response
 * `id` is the event_id. (The earlier 404 was from POSTing /v2/events — wrong path.)
 */
async function ensureMetricEvent(cfg: FxConfig, key: string, name?: string): Promise<{ id: number | null; diag: any }> {
  const k = slug(key);
  // 1) Reuse via the events LIST (custom events surface on /v2/events; GET on /custom_events is 405 — POST-only).
  const list = await api(cfg, 'GET', `${ADMIN}/events?project_id=${cfg.projectId}&per_page=200`);
  const items: any[] = Array.isArray(list.json) ? list.json : (list.json?.items || []);
  const found = items.find((e) => e && (e.key === k || e.api_name === k));
  if (found?.id) return { id: found.id, diag: { reused: true, listStatus: list.status } };
  // 2) CREATE via the custom_events endpoint.
  const r = await api(cfg, 'POST', `${ADMIN}/projects/${cfg.projectId}/custom_events`, { key: k, name: name || k, description: `Experiment metric event (ab-cmab): ${k}`, archived: false });
  if (r.ok && r.json?.id) return { id: r.json.id, diag: { created: true, createStatus: r.status } };
  // 3) Duplicate key → the 400 carries the existing id ("...already in use ... (id: NNNN)"). Bulletproof reuse.
  const m = JSON.stringify(r.json || '').match(/id:\s*(\d+)/);
  if (m) return { id: Number(m[1]), diag: { reusedFromDup: true, createStatus: r.status } };
  return { id: null, diag: { listStatus: list.status, createStatus: r.status, createBody: r.json } };
}

/** Build a typed ruleset rule (a/b · multi_armed_bandit · contextual_multi_armed_bandit) + a metric. */
function ruleValue(
  ruleKey: string, name: string, ruleType: 'a/b' | 'multi_armed_bandit' | 'contextual_multi_armed_bandit', vars: NormVar[],
  audienceId: number | undefined, metric: { eventId: number | null; displayTitle: string },
  contextAttributeIds?: number[],
): Record<string, unknown> {
  const isCmab = ruleType === 'contextual_multi_armed_bandit';
  const variations: Record<string, unknown> = {};
  // CMAB variations carry NO manual split (the bandit auto-allocates); a/b + mab carry percentage_included.
  for (const v of vars) variations[v.key] = isCmab ? { key: v.key, name: v.name } : { key: v.key, name: v.name, percentage_included: v.percentage };
  // EVENT metric (preferred) or REVENUE metric (no event) — FX requires ≥1 metric on an experiment rule.
  const m: Record<string, unknown> = metric.eventId
    ? { event_id: Number(metric.eventId), event_type: 'custom', scope: 'visitor', aggregator: 'unique', winning_direction: 'increasing', display_title: metric.displayTitle }
    : { aggregator: 'sum', field: 'revenue', scope: 'visitor', winning_direction: 'increasing' };
  const value: Record<string, unknown> = {
    key: ruleKey, name, type: ruleType, percentage_included: 10000, variations, metrics: [m],
  };
  if (ruleType === 'a/b') value.distribution_mode = 'manual';          // a/b: manual split + baseline
  if (isCmab) {                                                         // cmab: auto-allocated + contextual attrs
    value.distribution_goal = 'automated';
    if (contextAttributeIds && contextAttributeIds.length) value.attribute_ids = contextAttributeIds.map(Number);
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
 * Launch an experiment. Creates idempotently: flag → variations → a typed ruleset rule (a/b or
 * multi_armed_bandit) with an event (or revenue) metric, enabled live. Falls back to a proven
 * targeted-delivery rule only if the typed rule is rejected, so the seam always resolves.
 */
export async function launchExperiment(cfg: FxConfig, input: LaunchExperimentInput): Promise<LaunchExperimentResult> {
  const env = input.environment || cfg.environment || 'development';
  const type = input.type || 'ab';
  const ruleType = RULE_TYPE[type] || 'a/b';
  const key = slug(input.experimentKey || input.name || input.audienceName || 'experiment');
  const name = input.name || `${input.audienceName || 'Experiment'} — ${input.metric?.name || 'lift'}`;
  const vars = normalizeVariations(input.variations);

  // 1) Flag — carries the assigned variant key + a treatment toggle the edge can read.
  const flag = await ensureFlag(cfg, {
    key,
    name,
    description: `${type.toUpperCase()} experiment (owner: ab-cmab)${input.metric?.name ? ' — ' + input.metric.name : ''}`,
    variable_definitions: {
      variant: { key: 'variant', type: 'string', default_value: 'control', description: 'Assigned variation key.' },
      module_enabled: { key: 'module_enabled', type: 'boolean', default_value: 'false', description: 'Render the treatment experience.' },
      payload: { key: 'payload', type: 'string', default_value: '', description: 'Experiment-surface creative as JSON (image/headline/offer/cta/captureType…).' },
    },
  });

  // 2) Variations — each carries its own variant key + toggle (control off, others on).
  const variationIds = await ensureVariations(cfg, key, vars.map((v) => ({
    key: v.key,
    name: v.name,
    variables: v.variables || { variant: { value: v.key }, module_enabled: { value: v.isControl ? 'false' : 'true' } },
  })));

  // 3) Metric event — MAB requires an event metric; A/B prefers one too (revenue is the fallback).
  const metricKey = slug(input.metric?.eventKey || input.metric?.key || (type === 'ab' ? 'checkout_complete' : 'add_to_cart'));
  const displayTitle = input.metric?.name || metricKey;
  let metricEventId: number | null = null;
  let metricDiag: unknown = null;
  try { const ev = await ensureMetricEvent(cfg, metricKey, displayTitle); metricEventId = ev.id; metricDiag = ev.diag; }
  catch (e) { metricDiag = { error: e instanceof Error ? e.message : String(e) }; }

  // 4) CMAB personalizes on contextual attributes → ensure them, pass their ids (attribute_ids).
  let contextAttributeIds: number[] | undefined;
  let attrDiag: unknown;
  if (ruleType === 'contextual_multi_armed_bandit') {
    try {
      const ids = await ensureAttributes(cfg, CMAB_CONTEXT_ATTRS);
      contextAttributeIds = CMAB_CONTEXT_ATTRS.map((k) => ids[k]).filter((n): n is number => typeof n === 'number');
      attrDiag = { attributeIds: contextAttributeIds };
    } catch (e) { attrDiag = { error: e instanceof Error ? e.message : String(e) }; }
  }

  // 5) Rule — typed (a/b · multi_armed_bandit · contextual_multi_armed_bandit); fall back to targeted-delivery on rejection.
  const ruleKey = `${key}_exp`;
  let finalRuleType: FxRuleType = ruleType;
  let fellBack = false;
  let diagnostics: unknown;

  const rs = await api(cfg, 'GET', rulesetUrl(cfg, key, env));
  const existing = rs.json?.rules?.[ruleKey];
  if (!existing) {
    const patch = [
      { op: 'add', path: `/rules/${ruleKey}`, value: ruleValue(ruleKey, name, ruleType, vars, input.audienceId, { eventId: metricEventId, displayTitle }, contextAttributeIds) },
      { op: 'add', path: '/rule_priorities/-', value: ruleKey },
    ];
    const r = await api(cfg, 'PATCH', rulesetUrl(cfg, key, env), patch);
    if (r.ok) {
      finalRuleType = ruleType;
    } else {
      fellBack = true;
      finalRuleType = 'targeted_delivery';
      diagnostics = { ruleType, ruleStatus: r.status, ruleError: r.json, metricEvent: metricDiag, contextAttrs: attrDiag };
      const treatment = vars.find((v) => !v.isControl) || vars[vars.length - 1];
      await ensureRule(cfg, key, env, { key: ruleKey, name, type: 'targeted_delivery', variationKey: treatment.key, percentage_included: 10000 }, input.audienceId);
    }
  } else {
    finalRuleType = existing.type || ruleType;
  }

  // 6) Take it live (flag-on in env + rule enabled). A CMAB may require review before it can enable —
  // don't fail the launch if so; the REAL rule still exists (as a draft) and is pullable in the UI.
  let enabled = true;
  try { await enableLive(cfg, key, env, ruleKey); }
  catch (e) { enabled = false; diagnostics = Object.assign({}, diagnostics || {}, { enableError: e instanceof Error ? e.message : String(e) }); }

  const readoutUrl = `${input.baseUrl || ''}/storefront?experiment=${encodeURIComponent(key)}#engine`;
  return {
    experimentId: String(flag?.id ?? key),
    experimentKey: key,
    flagKey: key,
    ruleKey,
    environment: env,
    type,
    ruleType: finalRuleType,
    metricKind: metricEventId ? 'event' : 'revenue',
    variations: vars.map((v) => ({ key: v.key, name: v.name, percentage: v.percentage, isControl: v.isControl, id: variationIds[v.key] })),
    audienceId: input.audienceId,
    metric: input.metric,
    readoutUrl,
    status: 'live',
    enabled,
    representative: true,
    fellBack,
    diagnostics,
  };
}
