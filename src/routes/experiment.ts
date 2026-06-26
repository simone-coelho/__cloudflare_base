/**
 * experiment.ts — A/B + CMAB routes (owner: ab-cmab). The integration seam for Revenue Radar.
 *
 *   POST /experiment/launch        — the launchExperiment seam → { experimentId, readoutUrl, ... }
 *   GET  /experiment/:key/readout  — readout JSON for the Engine tab
 *   GET  /experiment               — list launched experiments (newest first)
 *   GET  /experiment/cmab/decide   — CMAB decision for one context (?device=&segment=&intent=…)
 *   GET  /experiment/cmab/matrix   — per-context winners table (beat 13)
 *
 * Orchestration (gate, simulate-fallback, readout, KV persistence) lives in experimentRun.ts so
 * the Opal tool and this route produce identical experiments. demo_events event_type taxonomy I
 * emit (non-overlapping with Revenue Radar's checkout_* set): experiment_launched ·
 * variation_assigned · experiment_view · conversion · mab_reallocation · cmab_decision.
 */
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { runLaunch, normalizeInput, getExperiment, listExperiments } from '@/services/experimentRun';
import { decideCmab, cmabMatrix, type CmabContext } from '@/services/cmab';
import { fxConfig } from '@/services/fxEnv';

const experiment = new Hono<{ Bindings: Env }>();

// ── POST /experiment/launch — the ONE seam Revenue Radar calls ────────────────
experiment.post('/launch', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const exp = await runLaunch(c.env, normalizeInput(body));
  return c.json(exp);
});

// ── CMAB endpoints (static paths declared before /:key) ───────────────────────
experiment.get('/cmab/decide', (c) => {
  const q = c.req.query();
  const ctx: CmabContext = {
    device: (q.device as CmabContext['device']) || undefined,
    segment: q.segment || undefined,
    intent: (q.intent as CmabContext['intent']) || undefined,
    genZ: q.genZ === 'true' || undefined,
    aovBand: (q.aovBand as CmabContext['aovBand']) || undefined,
    bnplAffinity: q.bnplAffinity === 'true' || undefined,
    paymentStall: q.paymentStall === 'true' || undefined,
    label: q.label || undefined,
  };
  return c.json(decideCmab(ctx));
});
experiment.get('/cmab/matrix', (c) => c.json({ contexts: cmabMatrix(), representative: true }));

// TEMP diagnostic (internal) — read back a flag's live ruleset to verify rule type / metric shape.
experiment.get('/_diag/ruleset/:key', async (c) => {
  const cfg = fxConfig(c.env);
  const env = c.env.OPTIMIZELY_ENVIRONMENT || 'development';
  const r = await fetch(`https://api.optimizely.com/flags/v1/projects/${cfg.projectId}/flags/${c.req.param('key')}/environments/${env}/ruleset`, {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
  });
  return c.json({ status: r.status, ruleset: await r.json() });
});

// ── readout + list ────────────────────────────────────────────────────────────
experiment.get('/:key/readout', async (c) => {
  const exp = await getExperiment(c.env, c.req.param('key'));
  if (!exp) return c.json({ error: 'experiment not found', key: c.req.param('key') }, 404);
  return c.json(exp);
});
experiment.get('/', async (c) => c.json({ experiments: await listExperiments(c.env) }));

export { experiment as experimentRoutes };
