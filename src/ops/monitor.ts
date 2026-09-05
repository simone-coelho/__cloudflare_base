// src/ops/monitor.ts
// The platform watching itself, every five minutes, from inside the worker:
// each store answered, and a real decision served to a synthetic visitor who
// withholds tracking, so the whole path runs and nothing is written. The
// result is kept for an operator to read and sent to Analytics Engine; when a
// check fails or the decision is slow, an alert goes to the webhook the
// customer configured (Slack, Teams, PagerDuty and most on-call tools accept a
// JSON post), once per half hour per tenant. No vendor, no agent, no page to
// poll from outside.

import type { Env } from '@/types/env';
import { serveContentDecisions } from '@/content/service';

export interface CheckResult { ok: boolean; ms: number; detail?: string }
export interface MonitorResult {
  at: number;
  tenant: string;
  environment: string;
  ok: boolean;
  checks: Record<string, CheckResult>;
  /** What was wrong, as sentences; empty when everything answered. */
  problems: string[];
}

export interface Thresholds { decisionMs: number }
export const DEFAULT_THRESHOLDS: Thresholds = { decisionMs: 1500 };
export const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

/** The sentences an alert carries, from the checks. Pure. */
export function problemsOf(checks: Record<string, CheckResult>, t: Thresholds = DEFAULT_THRESHOLDS): string[] {
  const out: string[] = [];
  for (const [name, c] of Object.entries(checks)) {
    if (!c.ok) out.push(`${name} failed${c.detail ? `: ${c.detail}` : ''} (${c.ms} ms)`);
    else if (name === 'decision' && c.ms > t.decisionMs) out.push(`a decision took ${c.ms} ms, above ${t.decisionMs} ms`);
  }
  return out;
}

/** The message the webhook receives: readable in a chat channel, parseable by a tool. */
export function alertPayload(r: MonitorResult): { text: string; environment: string; tenant: string; at: string; problems: string[]; checks: Record<string, CheckResult> } {
  const text = `${r.environment}: ${r.tenant} ${r.ok ? 'recovered' : 'has a problem'} at ${new Date(r.at).toISOString()}${r.problems.length ? `: ${r.problems.join('; ')}` : ''}`;
  return { text, environment: r.environment, tenant: r.tenant, at: new Date(r.at).toISOString(), problems: r.problems, checks: r.checks };
}

async function timed(fn: () => Promise<string | void>): Promise<CheckResult> {
  const t0 = Date.now();
  try { const detail = await fn(); return { ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) }; }
}

export const monitorKey = (tenant: string) => `monitor:${tenant}:last`;
const alertedKey = (tenant: string) => `monitor:${tenant}:alerted`;

/** Every check, in process. The decision is the one that matters: it runs the whole path. */
export async function runChecks(env: Env, tenant: string, now = Date.now()): Promise<Record<string, CheckResult>> {
  const checks: Record<string, CheckResult> = {};
  checks.kv = await timed(async () => { await env.CACHE.get('monitor-probe'); });
  checks.sessions = await timed(async () => { await env.SESSIONS.get('monitor-probe'); });
  checks.storage = await timed(async () => { await env.STORAGE.head('monitor-probe'); });
  checks.database = await timed(async () => { const r = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>(); if (r?.one !== 1) throw new Error('did not answer 1'); });
  checks.objects = await timed(async () => {
    if (!env.LEARN_STATS) throw new Error('LEARN_STATS not bound');
    const res = await env.LEARN_STATS.get(env.LEARN_STATS.idFromName(`${tenant}:${tenant}:monitor-probe`)).fetch('https://learn/snapshot');
    if (!res.ok && res.status !== 404) throw new Error(`answered ${res.status}`);
  });
  checks.decision = await timed(async () => {
    // A synthetic visitor who withholds tracking: the whole path runs, the answer is the defaults, nothing is written.
    const out = await serveContentDecisions(env, { tenant, page: 'home', visitorId: `monitor-${now.toString(36)}`, sessionId: `monitor-${now.toString(36)}`, channel: 'monitor', cf: null, cookieHeader: 'opt_tracking_consent=false; opt_personalization_enabled=false', stateTenant: tenant as never, nowMs: now });
    if (out.write) throw new Error('a monitor decision was going to be written');
    return `${out.records.length} decisions from ${out.sources.catalog.pieces} pieces`;
  });
  return checks;
}

/** One run for one tenant: checks, the kept result, the analytics point, and the alert with its cooldown. */
export async function runMonitor(env: Env, tenant: string, now = Date.now(), thresholds: Thresholds = DEFAULT_THRESHOLDS): Promise<MonitorResult> {
  const checks = await runChecks(env, tenant, now);
  const problems = problemsOf(checks, thresholds);
  const result: MonitorResult = { at: now, tenant, environment: env.ENVIRONMENT || 'unknown', ok: problems.length === 0, checks, problems };
  let previous: MonitorResult | null = null;
  try { previous = (await env.CACHE.get(monitorKey(tenant), 'json')) as MonitorResult | null; } catch { previous = null; }
  try { await env.CACHE.put(monitorKey(tenant), JSON.stringify(result), { expirationTtl: 7 * 24 * 3600 }); } catch { /* the point still goes */ }
  try { env.ANALYTICS?.writeDataPoint({ blobs: ['monitor', result.environment, tenant, result.ok ? 'ok' : 'problem', ...result.problems.slice(0, 3)], doubles: [result.ok ? 1 : 0, checks.decision?.ms ?? -1, checks.database?.ms ?? -1, checks.kv?.ms ?? -1], indexes: [tenant] }); } catch { /* buffered */ }
  const recovered = result.ok && previous !== null && previous.ok === false;
  if (!result.ok || recovered) await alert(env, result, now);
  console.log(JSON.stringify({ monitor: tenant, ok: result.ok, decisionMs: checks.decision?.ms, problems: result.problems }));
  return result;
}

/** POST the alert to the configured webhook, once per cooldown per tenant; a recovery always goes. */
export async function alert(env: Env, r: MonitorResult, now = Date.now()): Promise<'sent' | 'no-webhook' | 'cooling-down' | 'failed'> {
  const url = (env.ALERT_WEBHOOK_URL ?? '').trim();
  if (!url) return 'no-webhook';
  if (!r.ok) {
    let last = 0;
    try { last = Number(await env.CACHE.get(alertedKey(r.tenant))) || 0; } catch { last = 0; }
    // No earlier alert always sends; only an alert inside the cooldown is held back.
    if (last > 0 && now - last < ALERT_COOLDOWN_MS) return 'cooling-down';
  }
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alertPayload(r)), signal: AbortSignal.timeout(5000) });
    if (!res.ok) return 'failed';
    if (!r.ok) { try { await env.CACHE.put(alertedKey(r.tenant), String(now), { expirationTtl: 3600 }); } catch { /* fine */ } }
    return 'sent';
  } catch { return 'failed'; }
}
