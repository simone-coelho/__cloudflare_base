#!/usr/bin/env node
/**
 * create-fx-entities.mjs — LIVE Optimizely Feature Experimentation creator.
 * --------------------------------------------------------------------------
 * Drives the validated FX REST chain end to end, IDEMPOTENTLY:
 *
 *   attributes  (POST /v2/attributes)              — prereqs for audience conditions
 *     -> audience   (POST /v2/audiences)           — targets the people
 *       -> flag     (POST /flags/v1/.../flags)     — created DISABLED
 *         -> variations (POST .../variations)      — the content the edge serves
 *           -> rule  (PATCH .../ruleset)           — targeted_delivery (or a/b), DRAFT
 *             -> ENABLE (POST .../ruleset/enabled  +  PATCH rule enabled:true) -> LIVE
 *
 * After ENABLE the per-environment datafile regenerates (revision bumps) and the
 * flag propagates to https://cdn.optimizely.com/datafiles/<SDK_KEY>.json in
 * seconds. See docs/architecture/09-optimizely-api-plan.md.
 *
 * VALIDATED GOTCHAS baked in (proven against the real API 2026-06-25):
 *  1. Attributes referenced in an audience condition MUST already exist, AND the
 *     condition leaf's `name` is matched against the attribute's DISPLAY name
 *     (not its key). So this script creates every attribute with name === key and
 *     references attributes by key in conditions. (A custom display name != key
 *     makes the audience fail with "Custom attribute '<key>' does not exist".)
 *  2. Variation `variables` use the shape { "<key>": { "value": "<string>" } } —
 *     values are STRINGS even for boolean/integer; flag variable default_value is
 *     a STRING too.
 *  3. percentage_included is BASIS POINTS: 10000 = 100%.
 *  4. Ruleset edits are JSON Patch (RFC 6902): always GET -> merge -> PATCH so you
 *     never clobber sibling rules. Append priority with the "-" token.
 *  5. Going LIVE is two calls: POST .../ruleset/enabled (turn the flag on in the
 *     env) THEN PATCH replace /rules/<key>/enabled=true (the env ruleset enable
 *     does NOT by itself flip the rule on).
 *  6. Teardown: flags hard-DELETE (after the ruleset is disabled); audiences and
 *     attributes have NO hard delete — they archive (PATCH/DELETE -> archived:true).
 *
 * Auth: Bearer personal access token in OPTIMIZELY_API_TOKEN (server-side only;
 * NEVER printed). Project id in OPTIMIZELY_PROJECT_ID. Both resolve env-first,
 * then .dev.vars / llm-models-keys.md (gitignored) for local ergonomics.
 *
 * Usage:
 *   OPTIMIZELY_API_TOKEN=... node scripts/create-fx-entities.mjs [spec.json]
 *   DRY_RUN=1 node scripts/create-fx-entities.mjs [spec.json]   # log writes, send none
 *
 * With no spec path a built-in Coach example (complete_the_look) is used.
 * Re-running with the same spec is safe: existing entities are reused, not duplicated.
 * --------------------------------------------------------------------------
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = 'https://api.optimizely.com/v2';
const FLAGS = 'https://api.optimizely.com/flags/v1';
const DRY_RUN = !!process.env.DRY_RUN || process.argv.includes('--dry-run');

// ---- config resolution (env first, then gitignored files); never echo secrets ----
function fromFiles(name) {
  for (const f of ['.dev.vars', 'llm-models-keys.md']) {
    try {
      const t = readFileSync(join(REPO_ROOT, f), 'utf8');
      const m = t.match(new RegExp('^' + name + '=(.+)$', 'm'));
      if (m) return m[1].trim();
    } catch { /* ignore */ }
  }
  return '';
}
const cfg = (name) => (process.env[name] || fromFiles(name) || '').trim();

const TOKEN = cfg('OPTIMIZELY_API_TOKEN');
const PROJECT_ID = cfg('OPTIMIZELY_PROJECT_ID');
const SDK_KEY = cfg('OPTIMIZELY_SDK_KEY'); // optional, only to print the datafile URL

// ---- HTTP helper. Returns {status, ok, json}. Honors DRY_RUN for writes. --------
async function api(method, path, body) {
  const url = path.startsWith('http') ? path : path; // paths below are absolute
  if (DRY_RUN && method !== 'GET') {
    console.log(`  [dry-run] ${method} ${url}${body ? ' ' + JSON.stringify(body) : ''}`);
    return { status: 0, ok: true, json: { __dryRun: true } };
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Step 1: attributes (idempotent; enforce display name === key) --------------
async function ensureAttributes(keys) {
  const list = await api('GET', `${ADMIN}/attributes?project_id=${PROJECT_ID}&per_page=100`);
  const existing = Array.isArray(list.json) ? list.json : [];
  const byKey = new Map(existing.map((a) => [a.key, a]));
  const out = {};
  for (const key of keys) {
    const found = byKey.get(key);
    if (found) {
      // Revive if archived and/or fix the display name. Gotcha #1: condition lookups
      // match the attribute's display NAME, so keep name === key.
      const patch = {};
      if (found.archived) patch.archived = false;
      if (found.name !== key) patch.name = key;
      if (Object.keys(patch).length) {
        await api('PATCH', `${ADMIN}/attributes/${found.id}`, patch);
        console.log(`  attribute ${key}: reuse id=${found.id} (${JSON.stringify(patch)})`);
      } else {
        console.log(`  attribute ${key}: reuse id=${found.id}`);
      }
      out[key] = found.id;
      continue;
    }
    const r = await api('POST', `${ADMIN}/attributes`, { key, name: key, project_id: Number(PROJECT_ID) });
    if (!r.ok && !DRY_RUN) throw new Error(`attribute ${key} create failed: ${r.status} ${JSON.stringify(r.json)}`);
    out[key] = r.json?.id;
    console.log(`  attribute ${key}: created id=${out[key]}`);
  }
  return out;
}

// ---- Step 2: audience (idempotent by name; defensive retry on attr propagation) -
async function ensureAudience(aud) {
  const conditions = typeof aud.conditions === 'string' ? aud.conditions : JSON.stringify(aud.conditions);
  const list = await api('GET', `${ADMIN}/audiences?project_id=${PROJECT_ID}&per_page=100`);
  const existing = (Array.isArray(list.json) ? list.json : []).find((a) => a.name === aud.name);
  if (existing) {
    if (existing.archived) {
      await api('PATCH', `${ADMIN}/audiences/${existing.id}`, { archived: false });
      console.log(`  audience "${aud.name}": revived archived id=${existing.id}`);
    } else {
      console.log(`  audience "${aud.name}": reuse id=${existing.id}`);
    }
    return existing.id;
  }
  const body = { name: aud.name, description: aud.description || '', project_id: Number(PROJECT_ID), conditions };
  // Retry a few times: a just-created attribute can briefly lag the audience validator.
  let last;
  for (let i = 1; i <= 4; i++) {
    const r = await api('POST', `${ADMIN}/audiences`, body);
    if (r.ok || DRY_RUN) {
      console.log(`  audience "${aud.name}": created id=${r.json?.id}`);
      return r.json?.id;
    }
    last = r;
    if (/does not exist/i.test(JSON.stringify(r.json))) { await sleep(1500); continue; }
    break; // a different error -> fail fast
  }
  throw new Error(`audience create failed: ${last?.status} ${JSON.stringify(last?.json)}`);
}

// ---- Step 3: flag (idempotent by key) -------------------------------------------
async function ensureFlag(flag) {
  const get = await api('GET', `${FLAGS}/projects/${PROJECT_ID}/flags/${flag.key}`);
  if (get.status === 200) {
    console.log(`  flag ${flag.key}: reuse id=${get.json?.id}`);
    return get.json;
  }
  const r = await api('POST', `${FLAGS}/projects/${PROJECT_ID}/flags`, {
    key: flag.key,
    name: flag.name,
    description: flag.description || '',
    variable_definitions: flag.variable_definitions || {},
  });
  if (!r.ok && !DRY_RUN) throw new Error(`flag create failed: ${r.status} ${JSON.stringify(r.json)}`);
  console.log(`  flag ${flag.key}: created id=${r.json?.id} (status=${r.json?.status})`);
  return r.json;
}

// ---- Step 4: variations (idempotent by key) -------------------------------------
async function ensureVariations(flagKey, variations = []) {
  const cur = await api('GET', `${FLAGS}/projects/${PROJECT_ID}/flags/${flagKey}/variations?per_page=100`);
  const have = new Set((cur.json?.items || []).map((v) => v.key));
  const ids = {};
  for (const v of variations) {
    if (have.has(v.key)) {
      const found = (cur.json.items || []).find((x) => x.key === v.key);
      ids[v.key] = found?.id;
      console.log(`  variation ${v.key}: reuse id=${ids[v.key]}`);
      continue;
    }
    const r = await api('POST', `${FLAGS}/projects/${PROJECT_ID}/flags/${flagKey}/variations`, {
      key: v.key,
      name: v.name || v.key,
      description: v.description || '',
      variables: v.variables || {}, // shape: { key: { value: "<string>" } }
    });
    if (!r.ok && !DRY_RUN) throw new Error(`variation ${v.key} create failed: ${r.status} ${JSON.stringify(r.json)}`);
    ids[v.key] = r.json?.id;
    console.log(`  variation ${v.key}: created id=${ids[v.key]}`);
  }
  return ids;
}

// ---- Step 5: rule via JSON Patch (GET -> merge -> PATCH; idempotent by key) ------
async function ensureRule(flagKey, env, rule, audienceId) {
  const rs = await api('GET', `${FLAGS}/projects/${PROJECT_ID}/flags/${flagKey}/environments/${env}/ruleset`);
  const rules = rs.json?.rules || {};
  if (rules[rule.key]) {
    console.log(`  rule ${rule.key}: already present (enabled=${rules[rule.key].enabled})`);
    return rs.json;
  }
  // Default single-variation delivery; allow spec to override `variations`/metrics for a/b.
  const variations = rule.variations || {
    [rule.variationKey]: { key: rule.variationKey, name: rule.variationKey, percentage_included: 10000 },
  };
  const value = {
    key: rule.key,
    name: rule.name || rule.key,
    type: rule.type || 'targeted_delivery',
    percentage_included: rule.percentage_included ?? 10000,
    variations,
  };
  if (audienceId) {
    value.audience_conditions = ['or', { audience_id: Number(audienceId) }];
    value.audience_ids = [Number(audienceId)];
  } else {
    value.audience_conditions = []; // everyone
  }
  if (rule.type === 'a/b') {
    value.distribution_mode = rule.distribution_mode || 'manual';
    if (rule.metrics) value.metrics = rule.metrics;
  }
  const patch = [
    { op: 'add', path: `/rules/${rule.key}`, value },
    { op: 'add', path: '/rule_priorities/-', value: rule.key }, // "-" appends
  ];
  const r = await api('PATCH', `${FLAGS}/projects/${PROJECT_ID}/flags/${flagKey}/environments/${env}/ruleset`, patch);
  if (!r.ok && !DRY_RUN) throw new Error(`rule create failed: ${r.status} ${JSON.stringify(r.json)}`);
  console.log(`  rule ${rule.key}: created (ruleset revision=${r.json?.revision})`);
  return r.json;
}

// ---- Step 6: enable -> LIVE (two calls; both idempotent via pre-checks) ----------
async function enable(flagKey, env, ruleKey) {
  const base = `${FLAGS}/projects/${PROJECT_ID}/flags/${flagKey}/environments/${env}/ruleset`;
  let rs = await api('GET', base);
  if (rs.json?.enabled !== true) {
    const e = await api('POST', `${base}/enabled`); // no body
    if (!e.ok && !DRY_RUN) throw new Error(`ruleset enable failed: ${e.status} ${JSON.stringify(e.json)}`);
    console.log('  ruleset: enabled in environment');
  } else {
    console.log('  ruleset: already enabled');
  }
  const ruleEnabled = rs.json?.rules?.[ruleKey]?.enabled === true;
  if (!ruleEnabled) {
    const p = await api('PATCH', base, [{ op: 'replace', path: `/rules/${ruleKey}/enabled`, value: true }]);
    if (!p.ok && !DRY_RUN) throw new Error(`rule enable failed: ${p.status} ${JSON.stringify(p.json)}`);
    console.log(`  rule ${ruleKey}: enabled (status=${p.json?.status}, revision=${p.json?.revision})`);
    return p.json;
  }
  console.log(`  rule ${ruleKey}: already enabled`);
  return rs.json;
}

// ---- Built-in Coach example spec (used when no spec path is passed) --------------
const DEFAULT_SPEC = {
  environment: 'development',
  // attributes created with name === key (gotcha #1); referenced by key in conditions.
  attributes: ['viewed_category', 'session_aov'],
  audience: {
    name: 'High-AOV Handbag Browsers',
    description: 'Viewed handbags this session with high running AOV.',
    // Decoded condition tree; the script JSON-encodes it. Leaves reference attrs by key.
    conditions: [
      'and',
      ['or', ['or', { name: 'viewed_category', type: 'custom_attribute', match_type: 'exact', value: 'handbags' }]],
      ['or', ['or', { name: 'session_aov', type: 'custom_attribute', match_type: 'gt', value: 500 }]],
    ],
  },
  flag: {
    key: 'complete_the_look',
    name: 'Complete the Look module',
    description: 'Shows the AI complete-the-look module on PDP/PLP.',
    variable_definitions: {
      module_enabled: { key: 'module_enabled', type: 'boolean', default_value: 'false', description: 'Render the module.' },
      headline: { key: 'headline', type: 'string', default_value: 'Complete the look', description: 'Module headline.' },
      max_items: { key: 'max_items', type: 'integer', default_value: '3', description: 'How many rec items to show.' },
    },
    variations: [
      {
        key: 'ctl_on',
        name: 'Complete-the-look ON',
        description: 'Module on, 3 items.',
        // variables: { key: { value: "<string>" } } — strings even for bool/int (gotcha #2)
        variables: { module_enabled: { value: 'true' }, headline: { value: 'Complete the look' }, max_items: { value: '3' } },
      },
    ],
  },
  rule: {
    key: 'ctl_for_high_aov',
    name: 'Complete-the-look for high-AOV handbag browsers',
    type: 'targeted_delivery', // or 'a/b' (then add metrics + multi-variation split)
    variationKey: 'ctl_on',
    percentage_included: 10000, // 100%
  },
};

async function main() {
  if (!TOKEN) { console.error('✘ OPTIMIZELY_API_TOKEN not set (env or .dev.vars/llm-models-keys.md).'); process.exit(1); }
  if (!PROJECT_ID) { console.error('✘ OPTIMIZELY_PROJECT_ID not set.'); process.exit(1); }

  const specPath = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
  const spec = specPath ? JSON.parse(readFileSync(resolve(specPath), 'utf8')) : DEFAULT_SPEC;
  const env = spec.environment || cfg('OPTIMIZELY_ENVIRONMENT') || 'development';

  console.log(`FX entity creator${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`  token resolved (length ${TOKEN.length}, redacted) · project ${PROJECT_ID} · env ${env}`);
  console.log(`  spec: ${specPath || '(built-in Coach example)'}\n`);

  console.log('1) attributes');
  await ensureAttributes(spec.attributes || []);

  console.log('2) audience');
  const audienceId = await ensureAudience(spec.audience);

  console.log('3) flag');
  const flag = await ensureFlag(spec.flag);

  console.log('4) variations');
  const variationIds = await ensureVariations(spec.flag.key, spec.flag.variations || []);

  console.log('5) rule');
  await ensureRule(spec.flag.key, env, spec.rule, audienceId);

  console.log('6) enable -> LIVE');
  const finalRs = await enable(spec.flag.key, env, spec.rule.key);

  console.log('\n=== CREATED / LIVE ===');
  console.log(JSON.stringify({
    projectId: Number(PROJECT_ID),
    environment: env,
    audienceId,
    flagKey: spec.flag.key,
    flagId: flag?.id,
    variationIds,
    ruleKey: spec.rule.key,
    rulesetRevision: finalRs?.revision,
    rulesetStatus: finalRs?.status,
    datafileUrl: SDK_KEY ? `https://cdn.optimizely.com/datafiles/${SDK_KEY}.json` : '(set OPTIMIZELY_SDK_KEY to print)',
  }, null, 2));
  console.log('\n✓ Done. Datafile regenerates in seconds; poll the revision until it bumps, then reveal.');
}

main().catch((e) => { console.error('✘ create-fx-entities failed:', e.message); process.exit(1); });
