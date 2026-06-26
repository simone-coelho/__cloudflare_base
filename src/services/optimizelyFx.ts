/**
 * optimizelyFx.ts — validated Optimizely Feature Experimentation REST helpers.
 *
 * Worker-friendly port of scripts/create-fx-entities.mjs (proven LIVE against the real
 * API 2026-06-25). Takes a cfg {token, projectId, environment, sdkKey} instead of
 * reading files, and returns structured results. The Opal chat's write-tools call these
 * so a merchandiser's plain-language request becomes a REAL, live Optimizely audience +
 * targeted flag.
 *
 * Validated gotchas baked in:
 *  1. An attribute's DISPLAY name must equal its key (audience condition leaves resolve
 *     by display name, not key) — every attribute is created with name === key.
 *  2. Variation variables are stringly: { <key>: { value: "<string>" } }; a flag
 *     variable default_value is a string too.
 *  3. percentage_included is BASIS POINTS (10000 = 100%).
 *  4. Ruleset edits are JSON Patch (GET -> merge -> PATCH); append priority with "-".
 *  5. Going live is TWO calls: POST .../ruleset/enabled then PATCH rule enabled=true.
 *  6. Audiences/attributes archive (no hard delete); helpers revive archived entities.
 */

const ADMIN = 'https://api.optimizely.com/v2';
const FLAGS = 'https://api.optimizely.com/flags/v1';

export interface FxConfig {
  token: string;
  projectId: string;
  environment?: string;
  sdkKey?: string;
}

interface ApiResult { status: number; ok: boolean; json: any }

async function api(cfg: FxConfig, method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Collect custom_attribute leaf keys from an Optimizely condition tree. */
export function extractAttrKeys(conditions: unknown): string[] {
  const keys = new Set<string>();
  const walk = (n: any): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object' && typeof n.name === 'string') keys.add(n.name);
  };
  walk(conditions);
  return [...keys];
}

export async function ensureAttributes(cfg: FxConfig, keys: string[]): Promise<Record<string, number>> {
  if (!keys.length) return {};
  const list = await api(cfg, 'GET', `${ADMIN}/attributes?project_id=${cfg.projectId}&per_page=100`);
  const existing: any[] = Array.isArray(list.json) ? list.json : [];
  const byKey = new Map<string, any>(existing.map((a) => [a.key, a]));
  const out: Record<string, number> = {};
  for (const key of keys) {
    const found = byKey.get(key);
    if (found) {
      const patch: Record<string, unknown> = {};
      if (found.archived) patch.archived = false;
      if (found.name !== key) patch.name = key; // gotcha #1: condition lookups match display name
      if (Object.keys(patch).length) await api(cfg, 'PATCH', `${ADMIN}/attributes/${found.id}`, patch);
      out[key] = found.id;
      continue;
    }
    const r = await api(cfg, 'POST', `${ADMIN}/attributes`, { key, name: key, project_id: Number(cfg.projectId) });
    if (!r.ok) throw new Error(`attribute ${key} create failed: ${r.status} ${JSON.stringify(r.json)}`);
    out[key] = r.json?.id;
  }
  return out;
}

export interface AudienceSpec { name: string; description?: string; conditions: unknown }

export async function ensureAudience(cfg: FxConfig, aud: AudienceSpec): Promise<number> {
  const conditions = typeof aud.conditions === 'string' ? aud.conditions : JSON.stringify(aud.conditions);
  const list = await api(cfg, 'GET', `${ADMIN}/audiences?project_id=${cfg.projectId}&per_page=100`);
  const existing = (Array.isArray(list.json) ? list.json : []).find((a: any) => a.name === aud.name);
  if (existing) {
    if (existing.archived) await api(cfg, 'PATCH', `${ADMIN}/audiences/${existing.id}`, { archived: false });
    return existing.id;
  }
  const body = { name: aud.name, description: aud.description || '', project_id: Number(cfg.projectId), conditions };
  let last: ApiResult | undefined;
  for (let i = 1; i <= 4; i++) {
    const r = await api(cfg, 'POST', `${ADMIN}/audiences`, body);
    if (r.ok) return r.json?.id;
    last = r;
    if (/does not exist/i.test(JSON.stringify(r.json))) { await sleep(1500); continue; } // attr propagation lag
    break;
  }
  throw new Error(`audience create failed: ${last?.status} ${JSON.stringify(last?.json)}`);
}

export interface FlagSpec { key: string; name: string; description?: string; variable_definitions?: Record<string, unknown> }

export async function ensureFlag(cfg: FxConfig, flag: FlagSpec): Promise<any> {
  const get = await api(cfg, 'GET', `${FLAGS}/projects/${cfg.projectId}/flags/${flag.key}`);
  if (get.status === 200) return get.json;
  const r = await api(cfg, 'POST', `${FLAGS}/projects/${cfg.projectId}/flags`, {
    key: flag.key, name: flag.name, description: flag.description || '',
    variable_definitions: flag.variable_definitions || {},
  });
  if (!r.ok) throw new Error(`flag create failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

export interface VariationSpec { key: string; name?: string; description?: string; variables?: Record<string, { value: string }> }

export async function ensureVariations(cfg: FxConfig, flagKey: string, variations: VariationSpec[] = []): Promise<Record<string, number>> {
  const cur = await api(cfg, 'GET', `${FLAGS}/projects/${cfg.projectId}/flags/${flagKey}/variations?per_page=100`);
  const have = new Map<string, any>((((cur.json?.items as any[]) || [])).map((v) => [v.key, v]));
  const ids: Record<string, number> = {};
  for (const v of variations) {
    const found = have.get(v.key);
    if (found) { ids[v.key] = found.id; continue; }
    const r = await api(cfg, 'POST', `${FLAGS}/projects/${cfg.projectId}/flags/${flagKey}/variations`, {
      key: v.key, name: v.name || v.key, description: v.description || '', variables: v.variables || {},
    });
    if (!r.ok) throw new Error(`variation ${v.key} create failed: ${r.status} ${JSON.stringify(r.json)}`);
    ids[v.key] = r.json?.id;
  }
  return ids;
}

export interface RuleSpec {
  key: string; name?: string; type?: string; variationKey: string;
  percentage_included?: number; variations?: Record<string, unknown>;
}

export async function ensureRule(cfg: FxConfig, flagKey: string, env: string, rule: RuleSpec, audienceId?: number): Promise<any> {
  const rs = await api(cfg, 'GET', `${FLAGS}/projects/${cfg.projectId}/flags/${flagKey}/environments/${env}/ruleset`);
  const rules = rs.json?.rules || {};
  if (rules[rule.key]) return rs.json;
  const variations = rule.variations || {
    [rule.variationKey]: { key: rule.variationKey, name: rule.variationKey, percentage_included: 10000 },
  };
  const value: Record<string, unknown> = {
    key: rule.key, name: rule.name || rule.key, type: rule.type || 'targeted_delivery',
    percentage_included: rule.percentage_included ?? 10000, variations,
  };
  if (audienceId) {
    value.audience_conditions = ['or', { audience_id: Number(audienceId) }];
    value.audience_ids = [Number(audienceId)];
  } else {
    value.audience_conditions = [];
  }
  const patch = [
    { op: 'add', path: `/rules/${rule.key}`, value },
    { op: 'add', path: '/rule_priorities/-', value: rule.key }, // "-" appends
  ];
  const r = await api(cfg, 'PATCH', `${FLAGS}/projects/${cfg.projectId}/flags/${flagKey}/environments/${env}/ruleset`, patch);
  if (!r.ok) throw new Error(`rule create failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

export async function enableLive(cfg: FxConfig, flagKey: string, env: string, ruleKey: string): Promise<any> {
  const base = `${FLAGS}/projects/${cfg.projectId}/flags/${flagKey}/environments/${env}/ruleset`;
  const rs = await api(cfg, 'GET', base);
  if (rs.json?.enabled !== true) {
    const e = await api(cfg, 'POST', `${base}/enabled`); // turn the flag on in the env
    if (!e.ok) throw new Error(`ruleset enable failed: ${e.status} ${JSON.stringify(e.json)}`);
  }
  if (rs.json?.rules?.[ruleKey]?.enabled !== true) {
    const p = await api(cfg, 'PATCH', base, [{ op: 'replace', path: `/rules/${ruleKey}/enabled`, value: true }]);
    if (!p.ok) throw new Error(`rule enable failed: ${p.status} ${JSON.stringify(p.json)}`);
    return p.json;
  }
  return rs.json;
}

// ---- high-level orchestration used by the Opal chat write-tools ----

export async function createAudienceLive(
  cfg: FxConfig,
  aud: AudienceSpec
): Promise<{ audienceId: number; attributeIds: Record<string, number> }> {
  const condTree = typeof aud.conditions === 'string' ? JSON.parse(aud.conditions) : aud.conditions;
  const attributeIds = await ensureAttributes(cfg, extractAttrKeys(condTree));
  const audienceId = await ensureAudience(cfg, { ...aud, conditions: condTree });
  return { audienceId, attributeIds };
}

export interface LaunchFlagInput {
  flagKey: string; flagName: string; description?: string; audienceId?: number; environment?: string;
}

export async function launchTargetedFlag(cfg: FxConfig, input: LaunchFlagInput): Promise<{
  flagId: any; flagKey: string; ruleKey: string; environment: string; revision: any; live: boolean; datafileUrl?: string;
}> {
  const env = input.environment || cfg.environment || 'development';
  const flag = await ensureFlag(cfg, {
    key: input.flagKey, name: input.flagName, description: input.description,
    variable_definitions: {
      module_enabled: { key: 'module_enabled', type: 'boolean', default_value: 'false', description: 'Render the personalized module.' },
    },
  });
  await ensureVariations(cfg, input.flagKey, [
    { key: 'on', name: 'On', variables: { module_enabled: { value: 'true' } } },
  ]);
  const ruleKey = `${input.flagKey}_rule`;
  await ensureRule(cfg, input.flagKey, env, {
    key: ruleKey, name: `${input.flagName} delivery`, type: 'targeted_delivery', variationKey: 'on', percentage_included: 10000,
  }, input.audienceId);
  const fin = await enableLive(cfg, input.flagKey, env, ruleKey);
  return {
    flagId: flag?.id, flagKey: input.flagKey, ruleKey, environment: env,
    revision: fin?.revision, live: true,
    datafileUrl: cfg.sdkKey ? `https://cdn.optimizely.com/datafiles/${cfg.sdkKey}.json` : undefined,
  };
}

// ---- personalized-banner: ONE flag, cascading message rules (one rule per audience) ----

const BANNER_FLAG = 'personalized_banner';

function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'audience';
}

/** Derive an attribute map that SATISFIES a condition tree — used to "preview as this audience". */
export function satisfyingAttributes(conditions: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const walk = (n: any): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object' && typeof n.name === 'string' && 'value' in n) {
      const m = n.match_type || n.match || 'exact';
      const v = n.value;
      if (m === 'gt' && typeof v === 'number') out[n.name] = v + 1;
      else if (m === 'lt' && typeof v === 'number') out[n.name] = Math.max(0, v - 1);
      else out[n.name] = v;
    } else if (n && typeof n === 'object' && typeof n.name === 'string' && (n.match_type === 'exists' || n.match === 'exists')) {
      out[n.name] = true;
    }
  };
  walk(conditions);
  return out;
}

/**
 * Add ONE cascading message rule to the shared `personalized_banner` flag:
 * ensure flag (with enabled+message vars, created ONCE) → ensure attributes → ensure audience →
 * add a variation carrying THIS audience's message → append a targeted-delivery rule (GET→merge→PATCH,
 * so existing rules cascade) → enable. The flag is reused across calls; only rules accumulate.
 */
export async function addMessageRule(
  cfg: FxConfig,
  input: { audienceName: string; conditions: unknown; message: string; flagKey?: string }
): Promise<{
  flagKey: string; flagId: any; audienceId: number; audienceName: string; ruleKey: string; variationKey: string;
  message: string; previewAttributes: Record<string, string | number | boolean>;
  environment: string; revision: any; datafileUrl?: string;
}> {
  const env = cfg.environment || 'development';
  const flagKey = input.flagKey || BANNER_FLAG;
  const condTree = typeof input.conditions === 'string' ? JSON.parse(input.conditions) : input.conditions;

  const flag = await ensureFlag(cfg, {
    key: flagKey,
    name: 'Personalized Banner',
    description: 'AI-authored banner messaging — one targeted-delivery rule per audience (cascading).',
    variable_definitions: {
      enabled: { key: 'enabled', type: 'boolean', default_value: 'false', description: 'Show the banner.' },
      message: { key: 'message', type: 'string', default_value: '', description: 'Banner copy.' },
    },
  });
  await ensureAttributes(cfg, extractAttrKeys(condTree));
  const audienceId = await ensureAudience(cfg, { name: input.audienceName, description: `Opal: ${input.audienceName}`, conditions: condTree });

  const vKey = slug(input.audienceName);
  await ensureVariations(cfg, flagKey, [
    { key: vKey, name: input.audienceName, variables: { enabled: { value: 'true' }, message: { value: input.message } } },
  ]);
  const ruleKey = `${vKey}_rule`;
  await ensureRule(cfg, flagKey, env, { key: ruleKey, name: `${input.audienceName} banner`, type: 'targeted_delivery', variationKey: vKey, percentage_included: 10000 }, audienceId);
  const fin = await enableLive(cfg, flagKey, env, ruleKey);

  return {
    flagKey, flagId: flag?.id, audienceId, audienceName: input.audienceName, ruleKey, variationKey: vKey,
    message: input.message, previewAttributes: satisfyingAttributes(condTree), environment: env,
    revision: fin?.revision, datafileUrl: cfg.sdkKey ? `https://cdn.optimizely.com/datafiles/${cfg.sdkKey}.json` : undefined,
  };
}
