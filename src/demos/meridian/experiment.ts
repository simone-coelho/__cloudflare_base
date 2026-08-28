// src/demos/meridian/experiment.ts
// ─────────────────────────────────────────────────────────────────────────────
// A campaign signal arrives; we create a REAL experiment in the REAL Optimizely
// project, on stage, and then open the Optimizely UI and show it sitting there.
//
// WHAT THIS DELIBERATELY DOES NOT DO — and why.
//
// It does not show a bandit reallocating traffic toward a winner, and it does
// not show a lift figure. The bandit reallocation charts elsewhere in this repo
// are hardcoded curves, the contextual-bandit lift numbers are computed as
// hash(...) % band, and the SDK version installed here cannot decide a
// contextual bandit at all. None of that is defensible in a room containing
// engineers, so this beat is scoped to the part that is unarguably real:
// the experiment is created, live, against the production API, in front of them.
//
// Results come from traffic. This room will not generate traffic in 45 minutes,
// and saying so out loud is stronger than any invented chart.
//
// IT ALSO NEVER FALLS BACK SILENTLY. The shared implementation downgrades a
// rejected a/b rule to a targeted_delivery — a 100% rollout that is not a test —
// and reports it in a `fellBack` field a presenter will not be reading. Here a
// rejection is an error, loudly, because "we created an experiment" is a claim
// we should only make when it is true.
// ─────────────────────────────────────────────────────────────────────────────

import type { Env } from '@/types/env';
import type { Vertical } from './types';

const FLAGS = 'https://api.optimizely.com/flags/v1';
const ADMIN = 'https://api.optimizely.com/v2';

/** The three rule flavours, with the verified type strings. */
export type Flavour = 'ab' | 'mab' | 'cmab';
const RULE_TYPE: Record<Flavour, string> = {
  ab: 'a/b',
  mab: 'multi_armed_bandit',
  cmab: 'contextual_multi_armed_bandit',
};

/** Contextual attributes a CMAB personalises on. Created if absent, then referenced by id. */
const CMAB_ATTRS = ['visit_number', 'entry_channel', 'price_band'];

/** Own namespace. Cannot collide with Coach's unprefixed keys or Bright Hour's bh_. */
const KEY_PREFIX = 'mrd_';

export interface DispatchResult {
  ok: boolean;
  simulated: boolean;
  reason?: string;
  flagKey?: string;
  ruleKey?: string;
  variations?: string[];
  environment?: string;
  projectId?: string;
  /** Deep link so the presenter can show it in the Optimizely UI immediately. */
  consoleUrl?: string;
  /** The real audience the rule is targeted at, when one was asked for. */
  audience?: { id: number; name: string; created: boolean } | null;
  /**
   * Whether this call actually created the rule, or found one already live and
   * reused it. On stage the flag will usually exist from rehearsal, and "we just
   * created this" would then be false — so the response says which happened and
   * the surface repeats it. A small distinction, but it is the difference
   * between a demonstration and a performance.
   */
  created?: boolean;
  ms?: number;
  /** Verbatim API error when something is rejected. Never swallowed. */
  error?: unknown;
}

interface Cfg { token: string; projectId: string; environment: string }

function cfgOf(env: Env): Cfg {
  return {
    token: String(env.OPTIMIZELY_API_TOKEN ?? ''),
    projectId: String(env.OPTIMIZELY_PROJECT_ID ?? ''),
    environment: env.OPTIMIZELY_ENVIRONMENT || 'development',
  };
}

function gate(env: Env): { ok: boolean; reason: string } {
  if (env.OPTIMIZELY_WRITE_ENABLED !== 'true') {
    return { ok: false, reason: 'OPTIMIZELY_WRITE_ENABLED is not "true" — nothing was written.' };
  }
  if (!env.OPTIMIZELY_API_TOKEN) return { ok: false, reason: 'OPTIMIZELY_API_TOKEN is not set — nothing was written.' };
  if (!env.OPTIMIZELY_PROJECT_ID) return { ok: false, reason: 'OPTIMIZELY_PROJECT_ID is not set — nothing was written.' };
  return { ok: true, reason: 'enabled' };
}

/**
 * A custom event, created once and reused. A revenue metric needs no event id and
 * is fine for A/B — but a CMAB rejects it outright, so the bandits need a real
 * event. Verified path: POST /v2/projects/{pid}/custom_events returns the id;
 * a duplicate create returns the existing id inside the 400 body.
 */
async function ensureEvent(cfg: Cfg, key: string): Promise<number | null> {
  const list = await api(cfg, 'GET', `${ADMIN}/events?project_id=${cfg.projectId}&per_page=100`);
  const found = Array.isArray(list.json) ? list.json.find((e: any) => e?.key === key) : null;
  if (found?.id) return Number(found.id);

  const made = await api(cfg, 'POST', `${ADMIN}/projects/${cfg.projectId}/custom_events`, {
    key, name: key, description: 'Calder demo — hero engagement', archived: false,
  });
  if (made.ok && (made.json as any)?.id) return Number((made.json as any).id);
  const dup = JSON.stringify(made.json ?? '').match(/(\d{6,})/);   // duplicate → id is in the message
  return dup ? Number(dup[1]) : null;
}

/** Numeric attribute ids for a CMAB's contextual attributes. */
async function ensureAttributes(cfg: Cfg, keys: string[]): Promise<number[]> {
  const list = await api(cfg, 'GET', `${ADMIN}/attributes?project_id=${cfg.projectId}&per_page=100`);
  const have = new Map<string, number>();
  if (Array.isArray(list.json)) for (const a of list.json) if (a?.key) have.set(a.key, Number(a.id));
  const ids: number[] = [];
  for (const k of keys) {
    if (have.has(k)) { ids.push(have.get(k)!); continue; }
    // The v2 validator resolves a condition leaf's name against the DISPLAY NAME,
    // not the key — so name must equal key or targeting 400s in a way that looks
    // like a propagation hang.
    const r = await api(cfg, 'POST', `${ADMIN}/attributes`, {
      project_id: Number(cfg.projectId), key: k, name: k, description: `Calder demo context: ${k}`,
    });
    const id = (r.json as any)?.id;
    if (id) ids.push(Number(id));
  }
  return ids;
}

/**
 * A real Optimizely audience for a Revenue Radar cohort, created if absent and
 * reused if not. This exists because the beat CLAIMS the fix is targeted at the
 * cohort we just diagnosed — and an even 50/50 rollout with no audience on it
 * would make that claim false in front of a room that can open the console.
 *
 * The v2 condition leaf resolves `name` against the attribute's DISPLAY name,
 * which is why ensureAttributes writes name === key.
 */
async function ensureAudience(
  cfg: Cfg, keys: Array<{ dim: string; value: string }>,
): Promise<{ id: number; name: string; created: boolean } | null> {
  if (!keys.length) return null;
  const name = `Calder · ${keys.map((k) => `${k.dim}=${k.value}`).join(' + ')}`;

  const list = await api(cfg, 'GET', `${ADMIN}/audiences?project_id=${cfg.projectId}&per_page=100`);
  if (Array.isArray(list.json)) {
    const hit = list.json.find((a: any) => a?.name === name);
    if (hit?.id) return { id: Number(hit.id), name, created: false };
  }

  await ensureAttributes(cfg, keys.map((k) => k.dim));

  // Flat conjunction, and the leaf key is `match_type` — NOT `match`, which is
  // what the flags API uses. Verified against an audience the project already
  // held rather than guessed: the wrong key is accepted as JSON and then fails
  // validation, which returns null and looks exactly like "no audience wanted".
  const conditions = JSON.stringify([
    'and',
    ...keys.map((k) => ({
      type: 'custom_attribute', name: k.dim, match_type: 'exact', value: k.value,
    })),
  ]);

  const r = await api(cfg, 'POST', `${ADMIN}/audiences`, {
    project_id: Number(cfg.projectId), name, conditions,
    description: 'Created by the Calder Revenue Radar from a diagnosed cohort.',
  });
  const id = (r.json as any)?.id;
  if (!id) {
    // Loud, not null. A silent failure here puts an untargeted rule on screen
    // under a sentence claiming it is targeted.
    throw new Error(`audience "${name}" was rejected (${r.status}): ${JSON.stringify(r.json).slice(0, 300)}`);
  }
  return { id: Number(id), name, created: true };
}

async function api(cfg: Cfg, method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { ok: res.ok, status: res.status, json };
}

const rulesetUrl = (c: Cfg, flagKey: string) =>
  `${FLAGS}/projects/${c.projectId}/flags/${flagKey}/environments/${c.environment}/ruleset`;

/**
 * The experiment the signal actually justifies: when paid traffic lands, does
 * the hero lead with what this visitor's affinity says, or with the campaign the
 * media buy is promoting? That is a real disagreement between two teams, and it
 * is a thing our engine can genuinely vary per visitor.
 */
export function experimentSpec(vertical: Vertical, source: string, flavour: Flavour = 'ab') {
  // The Revenue Radar launches a REMEDY, not a hero test. Reusing the hero flag
  // for it would put a flag named "hero strategy" on screen one sentence after
  // the presenter said "wallet payment is failing" — and this room checks.
  if (source === 'radar') {
    const key = `${KEY_PREFIX}checkout_remedy_${vertical}`;
    return {
      key,
      ruleKey: `${key}_exp_${Date.now().toString(36)}`,   // a NEW rule on every press — 'created just now' is then always true
      name: `Calder checkout remedy · A/B — ${vertical} (Revenue Radar)`,
      variations: vertical === 'retail'
        ? [
          { key: 'wallet_first', name: 'Wallet payment first (current)', isControl: true },
          { key: 'saved_card_first', name: 'Saved card first, wallet alternate', isControl: false },
        ]
        : [
          { key: 'verify_inline', name: 'Identity check inline (current)', isControl: true },
          { key: 'resume_by_link', name: 'Offer resume-by-link before the check', isControl: false },
        ],
    };
  }

  const key = `${KEY_PREFIX}hero_strategy_${vertical}${flavour === 'ab' ? '' : '_' + flavour}`;
  return {
    key,
    ruleKey: `${key}_exp_${Date.now().toString(36)}`,   // a NEW rule on every press — 'created just now' is then always true
    name: `Calder hero strategy · ${flavour.toUpperCase()} — ${vertical} (${source} arrival)`,
    variations: [
      { key: 'affinity_led', name: 'Affinity leads the hero', isControl: true },
      { key: 'campaign_pinned', name: 'Campaign pins the hero', isControl: false },
    ],
  };
}

export async function dispatch(
  env: Env, vertical: Vertical, source: string, flavour: Flavour = 'ab',
  cohort: Array<{ dim: string; value: string }> = [],
): Promise<DispatchResult> {
  const t0 = Date.now();
  const g = gate(env);
  const spec = experimentSpec(vertical, source, flavour);

  if (!g.ok) {
    // Say plainly that nothing was written. Never dress a no-op as a success.
    return { ok: false, simulated: true, reason: g.reason, flagKey: spec.key, ruleKey: spec.ruleKey,
             variations: spec.variations.map((v) => v.key), ms: Date.now() - t0 };
  }

  const cfg = cfgOf(env);

  // 1) The flag. Idempotent: an existing key is reused, not duplicated.
  const flagBody = {
    key: spec.key,
    name: spec.name,
    description: 'Created live from the Meridian surface when a paid-campaign arrival was detected.',
    variable_definitions: {
      strategy: { key: 'strategy', type: 'string', default_value: 'affinity_led',
                  description: 'Which strategy composes the hero slot.' },
    },
  };
  const mk = await api(cfg, 'POST', `${FLAGS}/projects/${cfg.projectId}/flags`, flagBody);
  if (!mk.ok && mk.status !== 409) {
    return { ok: false, simulated: false, reason: `Flag create failed (${mk.status})`, error: mk.json, ms: Date.now() - t0 };
  }

  // 2) Variations — in parallel. They are independent, and on stage every
  //    sequential round trip is a second of someone watching a spinner.
  const varResults = await Promise.all(
    spec.variations.map((v) =>
      api(cfg, 'POST', `${FLAGS}/projects/${cfg.projectId}/flags/${spec.key}/variations`, {
        key: v.key, name: v.name, variables: { strategy: { value: v.key } },
      }).then((r) => ({ v, r })),
    ),
  );
  for (const { v, r } of varResults) {
    if (!r.ok && r.status !== 409) {
      return { ok: false, simulated: false, reason: `Variation "${v.key}" failed (${r.status})`, error: r.json, ms: Date.now() - t0 };
    }
  }

  // 3) The A/B rule. Variations are an OBJECT MAP keyed by variation key, each
  //    with percentage_included in basis points; an experiment rule is rejected
  //    without at least one metric, and a revenue metric needs no event id.
  const rs = await api(cfg, 'GET', rulesetUrl(cfg, spec.key));
  const already = (rs.json as any)?.rules?.[spec.ruleKey];
  const created = !already;

  // Idempotent, and done before either branch so the reused path is targeted too.
  let audience: { id: number; name: string; created: boolean } | null = null;
  try {
    audience = await ensureAudience(cfg, cohort);
  } catch (e) {
    return {
      ok: false, simulated: false, flagKey: spec.key, ruleKey: spec.ruleKey,
      reason: `the cohort audience could not be created, so nothing was targeted: ${(e as Error).message}`,
      ms: Date.now() - t0,
    };
  }

  if (!already) {
    // A CMAB allocates its own traffic, so its variations carry NO manual split.
    const variations: Record<string, unknown> = {};
    for (const v of spec.variations) {
      variations[v.key] = flavour === 'cmab'
        ? { key: v.key, name: v.name }
        : { key: v.key, name: v.name, percentage_included: 5000 };
    }

    let metric: Record<string, unknown> =
      { aggregator: 'sum', field: 'revenue', scope: 'visitor', winning_direction: 'increasing' };
    if (flavour !== 'ab') {
      const eventId = await ensureEvent(cfg, `${KEY_PREFIX}hero_engaged`);
      if (!eventId) {
        return { ok: false, simulated: false, reason: `${flavour.toUpperCase()} needs an event metric and the event could not be created or found`, ms: Date.now() - t0 };
      }
      metric = { event_id: eventId, event_type: 'custom', scope: 'visitor',
                 aggregator: 'unique', winning_direction: 'increasing', display_title: 'Hero engaged' };
    }

    const rule: Record<string, unknown> = {
      key: spec.ruleKey, name: spec.name, type: RULE_TYPE[flavour],
      percentage_included: 10000, variations, metrics: [metric],
    };
    if (flavour === 'cmab') {
      rule.distribution_goal = 'automated';
      rule.attribute_ids = await ensureAttributes(cfg, CMAB_ATTRS);
    }

    // Targeting, when a cohort was diagnosed. Without this the rule runs on
    // everyone and the sentence on screen would be false.
    if (audience) rule.audience_conditions = ['and', { audience_id: audience.id }];

    const patch = [
      { op: 'add', path: `/rules/${spec.ruleKey}`, value: rule },
      { op: 'add', path: '/rule_priorities/-', value: spec.ruleKey },
    ];
    const r = await api(cfg, 'PATCH', rulesetUrl(cfg, spec.key), patch);
    if (!r.ok) {
      // Loud. The shared path would quietly become a 100% rollout here.
      return {
        ok: false, simulated: false,
        reason: `${flavour.toUpperCase()} rule rejected (${r.status}). Not downgrading it to a rollout — a rollout is not a test.`,
        error: r.json, flagKey: spec.key, ms: Date.now() - t0,
      };
    }
  }

  // A rule left over from an earlier run predates its audience, so bring its
  // targeting up to date rather than letting the screen overstate it.
  if (already && audience) {
    await api(cfg, 'PATCH', rulesetUrl(cfg, spec.key), [
      { op: 'replace', path: `/rules/${spec.ruleKey}/audience_conditions`,
        value: ['and', { audience_id: audience.id }] },
    ]);
  }

  // 4) Take it live.
  const on = await api(cfg, 'POST', `${rulesetUrl(cfg, spec.key)}/enabled`, {});
  const ruleOn = await api(cfg, 'PATCH', rulesetUrl(cfg, spec.key), [
    { op: 'replace', path: `/rules/${spec.ruleKey}/enabled`, value: true },
  ]);

  return {
    ok: true,
    simulated: false,
    flagKey: spec.key,
    ruleKey: spec.ruleKey,
    variations: spec.variations.map((v) => v.key),
    environment: cfg.environment,
    projectId: cfg.projectId,
    consoleUrl: `https://app.optimizely.com/v2/projects/${cfg.projectId}/flags/manage/${spec.key}/rules/${cfg.environment}`,
    audience,
    created,
    reason: !on.ok || !ruleOn.ok
      ? 'written, but the enable step reported a problem'
      : created
        ? 'created and enabled just now'
        : 'already live from an earlier run — reused, not recreated',
    ms: Date.now() - t0,
  };
}

/** Read-only: is this beat safe to run right now? Checked before the room, not during. */
export function status(env: Env) {
  const g = gate(env);
  const cfg = cfgOf(env);
  return {
    ok: g.ok,
    writeGate: g.ok ? 'enabled' : 'disabled',
    reason: g.reason,
    projectId: cfg.projectId || null,
    environment: cfg.environment,
    hasToken: Boolean(env.OPTIMIZELY_API_TOKEN),
  };
}
