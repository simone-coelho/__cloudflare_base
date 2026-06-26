/**
 * experimentRun.ts — orchestration for the launchExperiment seam (owner: ab-cmab).
 *
 * Wraps the pure-FX `launchExperiment` with: the write-gate, a simulate-fallback (so the demo
 * loop NEVER breaks), a representative readout, and KV persistence. Used by BOTH the /experiment
 * route AND the Opal tool, so an experiment launched either way looks identical on the Engine
 * readout (and is fetchable at /experiment/:key/readout). Lift figures are representative (TDD §7).
 */
import type { Env } from '@/types/env';
import { launchExperiment, type LaunchExperimentInput, type ExperimentMetric } from '@/services/experimentFx';
import { fxConfig, gateWrite } from '@/services/fxEnv';

export const DEFAULT_METRIC: ExperimentMetric = { key: 'payment_to_purchase', name: 'Checkout completion', eventKey: 'purchase' };
export const DEFAULT_VARIATIONS = [
  { key: 'control', name: 'Control · static checkout' },
  { key: 'treatment', name: 'Treatment · BNPL + social proof' },
];

function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'experiment';
}

export interface ExperimentReadout {
  metric: ExperimentMetric; unit: string;
  arms: { key: string; name: string; isControl: boolean; rate: number; win: boolean }[];
  liftAbs: number; liftRel: number; confidence: number; foot: string; representative: true;
}

/** Representative readout (lift is illustrative — real stats need real traffic). */
export function buildReadout(input: LaunchExperimentInput): ExperimentReadout {
  const m = input.metric || DEFAULT_METRIC;
  const checkoutish = /payment|checkout|completion|purchase/i.test(`${m.key} ${m.name || ''}`);
  const control = checkoutish ? 62.0 : 3.1;   // §6: payment→purchase ~62% → ~73% on the hero slice
  const treatment = checkoutish ? 73.0 : 4.6;
  const vars = Array.isArray(input.variations) && input.variations.length >= 2 ? input.variations : DEFAULT_VARIATIONS;
  const arms = vars.map((v, i) => ({
    key: slug(v.key || (i === 0 ? 'control' : `variation_${i}`)),
    name: v.name || v.key || (i === 0 ? 'Control' : `Variation ${i}`),
    isControl: i === 0,
    rate: i === 0 ? control : treatment,
    win: i !== 0,
  }));
  const liftAbs = Math.round((treatment - control) * 10) / 10;
  const liftRel = Math.round(((treatment - control) / control) * 100);
  return {
    metric: m, unit: '%', arms, liftAbs, liftRel, confidence: 96,
    foot: `+${liftRel}% ${m.name || 'lift'} for the treatment · 96% confidence`,
    representative: true,
  };
}

export function normalizeInput(body: any): LaunchExperimentInput {
  return {
    experimentKey: body?.experimentKey,
    name: body?.name,
    audienceId: typeof body?.audienceId === 'number' ? body.audienceId : undefined,
    audienceName: body?.audienceName,
    variations: Array.isArray(body?.variations) && body.variations.length >= 2 ? body.variations : DEFAULT_VARIATIONS,
    metric: body?.metric || DEFAULT_METRIC,
    type: body?.type || 'ab',
  };
}

function simulatedExp(input: LaunchExperimentInput, env: Env, readout: ExperimentReadout, status: string, note: string) {
  const key = slug(input.experimentKey || input.name || input.audienceName || 'experiment');
  return {
    experimentId: key, experimentKey: key, flagKey: key, ruleKey: `${key}_exp`,
    environment: env.OPTIMIZELY_ENVIRONMENT || 'development',
    type: input.type || 'ab', ruleType: 'a/b' as const,
    variations: readout.arms.map((a) => ({ key: a.key, name: a.name, isControl: a.isControl })),
    audienceId: input.audienceId, metric: input.metric,
    readoutUrl: `/storefront?experiment=${encodeURIComponent(key)}#engine`,
    status, representative: true as const, fellBack: false, readout, note,
  };
}

async function save(env: Env, exp: { experimentKey: string }): Promise<void> {
  if (!env.CACHE) return;
  await env.CACHE.put(`exp:${exp.experimentKey}`, JSON.stringify(exp), { expirationTtl: 86400 });
  try {
    const idx: string[] = JSON.parse((await env.CACHE.get('exp:index')) || '[]');
    if (!idx.includes(exp.experimentKey)) {
      idx.unshift(exp.experimentKey);
      await env.CACHE.put('exp:index', JSON.stringify(idx.slice(0, 50)));
    }
  } catch { /* index optional */ }
}

export async function getExperiment(env: Env, key: string): Promise<any | null> {
  if (!env.CACHE) return null;
  const raw = await env.CACHE.get(`exp:${key}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listExperiments(env: Env): Promise<any[]> {
  if (!env.CACHE) return [];
  const idx: string[] = JSON.parse((await env.CACHE.get('exp:index')) || '[]');
  const out: any[] = [];
  for (const k of idx) { const e = await getExperiment(env, k); if (e) out.push(e); }
  return out;
}

/** Launch (gate → real FX, or simulate on gate-off/throw) → persist → return the experiment. */
export async function runLaunch(env: Env, input: LaunchExperimentInput): Promise<any> {
  const readout = buildReadout(input);
  const gate = gateWrite(env);
  if (!gate.enabled) {
    const exp = simulatedExp(input, env, readout, 'stubbed', gate.reason);
    await save(env, exp);
    return exp;
  }
  try {
    const r = await launchExperiment(fxConfig(env), input);
    const exp = { ...r, readout };
    await save(env, exp);
    return exp;
  } catch (e) {
    const exp = simulatedExp(input, env, readout, 'simulated', e instanceof Error ? e.message : String(e));
    await save(env, exp);
    return exp;
  }
}
