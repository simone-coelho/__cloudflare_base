// src/ops/monitor.ts
// The platform watching itself, every five minutes, from inside the worker:
// A refused default probe plus explicitly approved, isolated synthetic work
// through both real shopper hosts. Single samples are diagnostics, not SLOs.
// Results and alert outcomes are kept for operators, with aggregate telemetry.
// Problem alerts are limited to once per half hour per tenant; failed recovery
// delivery is retried on later healthy runs while its result remains in KV.

import type { Env } from '@/types/env';
import { runSynthetic } from './synthetic';
// Exact create/alter result of product migrations 0010–0013. Read-only
// sqlite_master comparison includes columns, constraints, indexes and trigger.
export const PRODUCT_SCHEMA = [
  {
    "type": "index",
    "name": "idx_operator_audit_at",
    "tbl_name": "operator_audit",
    "sql": "CREATE INDEX idx_operator_audit_at ON operator_audit(at)"
  },
  {
    "type": "index",
    "name": "idx_operator_audit_target",
    "tbl_name": "operator_audit",
    "sql": "CREATE INDEX idx_operator_audit_target ON operator_audit(target_email, action, at)"
  },
  {
    "type": "index",
    "name": "idx_operator_audit_tenant_id",
    "tbl_name": "operator_audit",
    "sql": "CREATE INDEX idx_operator_audit_tenant_id ON operator_audit(tenant, id DESC)"
  },
  {
    "type": "index",
    "name": "idx_operator_memberships_tenant",
    "tbl_name": "operator_memberships",
    "sql": "CREATE INDEX idx_operator_memberships_tenant ON operator_memberships(tenant,account_id)"
  },
  {
    "type": "index",
    "name": "idx_operator_oidc_completions_expiry",
    "tbl_name": "operator_oidc_completions",
    "sql": "CREATE INDEX idx_operator_oidc_completions_expiry ON operator_oidc_completions(expires_at)"
  },
  {
    "type": "index",
    "name": "idx_operator_oidc_transactions_expiry",
    "tbl_name": "operator_oidc_transactions",
    "sql": "CREATE INDEX idx_operator_oidc_transactions_expiry ON operator_oidc_transactions(expires_at)"
  },
  {
    "type": "index",
    "name": "idx_operator_services_tenant",
    "tbl_name": "operator_service_credentials",
    "sql": "CREATE INDEX idx_operator_services_tenant ON operator_service_credentials(tenant, created_at)"
  },
  {
    "type": "index",
    "name": "idx_operator_sessions_account",
    "tbl_name": "operator_sessions",
    "sql": "CREATE INDEX idx_operator_sessions_account ON operator_sessions(account_id)"
  },
  {
    "type": "table",
    "name": "operator_accounts",
    "tbl_name": "operator_accounts",
    "sql": "CREATE TABLE \"operator_accounts\" ( id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, roles TEXT NOT NULL DEFAULT '[\"operator\"]', permissions TEXT NOT NULL DEFAULT '[\"read\"]', password_hash TEXT, must_change_password INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_sign_in_at INTEGER, auth_mode TEXT NOT NULL DEFAULT 'password' CHECK (auth_mode IN ('password','oidc','dual')), CHECK ((auth_mode='oidc' AND password_hash IS NULL AND must_change_password=0) OR (auth_mode IN ('password','dual') AND password_hash IS NOT NULL)) )"
  },
  {
    "type": "table",
    "name": "operator_audit",
    "tbl_name": "operator_audit",
    "sql": "CREATE TABLE operator_audit ( id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, actor_id TEXT, actor_email TEXT, target_id TEXT, target_email TEXT, detail TEXT , tenant TEXT)"
  },
  {
    "type": "table",
    "name": "operator_memberships",
    "tbl_name": "operator_memberships",
    "sql": "CREATE TABLE \"operator_memberships\" ( account_id TEXT NOT NULL REFERENCES \"operator_accounts\"(id) ON DELETE CASCADE, tenant TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('operator','admin')), disabled INTEGER NOT NULL CHECK (disabled IN (0,1)), removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0,1)), revision TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (account_id,tenant) )"
  },
  {
    "type": "table",
    "name": "operator_oidc_completions",
    "tbl_name": "operator_oidc_completions",
    "sql": "CREATE TABLE operator_oidc_completions ( id TEXT PRIMARY KEY, cookie_hash TEXT NOT NULL, tenant TEXT NOT NULL, origin TEXT NOT NULL, epoch TEXT NOT NULL, session_id TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER )"
  },
  {
    "type": "table",
    "name": "operator_oidc_epoch",
    "tbl_name": "operator_oidc_epoch",
    "sql": "CREATE TABLE operator_oidc_epoch (id INTEGER PRIMARY KEY CHECK (id=1), epoch TEXT NOT NULL)"
  },
  {
    "type": "table",
    "name": "operator_oidc_links",
    "tbl_name": "operator_oidc_links",
    "sql": "CREATE TABLE operator_oidc_links ( account_id TEXT PRIMARY KEY REFERENCES operator_accounts(id) ON DELETE CASCADE, issuer TEXT NOT NULL, subject TEXT NOT NULL, revision TEXT NOT NULL, disabled INTEGER NOT NULL CHECK (disabled IN (0,1)), updated_at INTEGER NOT NULL, UNIQUE (issuer,subject) )"
  },
  {
    "type": "table",
    "name": "operator_oidc_sessions",
    "tbl_name": "operator_oidc_sessions",
    "sql": "CREATE TABLE operator_oidc_sessions ( session_id TEXT PRIMARY KEY REFERENCES operator_sessions(jti) ON DELETE CASCADE, account_id TEXT NOT NULL, tenant TEXT NOT NULL, issuer TEXT NOT NULL, link_revision TEXT NOT NULL, config_digest TEXT NOT NULL, account_revision INTEGER NOT NULL, epoch TEXT NOT NULL, auth_time INTEGER NOT NULL, expires_at INTEGER NOT NULL )"
  },
  {
    "type": "table",
    "name": "operator_oidc_transactions",
    "tbl_name": "operator_oidc_transactions",
    "sql": "CREATE TABLE operator_oidc_transactions ( state TEXT PRIMARY KEY, cookie_hash TEXT NOT NULL, tenant TEXT NOT NULL, origin TEXT NOT NULL, account_id TEXT NOT NULL, account_revision INTEGER NOT NULL, link_revision TEXT NOT NULL, config_digest TEXT NOT NULL, epoch TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, session_id TEXT )"
  },
  {
    "type": "table",
    "name": "operator_recovery_requests",
    "tbl_name": "operator_recovery_requests",
    "sql": "CREATE TABLE operator_recovery_requests ( operation_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, target_scope TEXT NOT NULL, account_id TEXT NOT NULL, email TEXT NOT NULL, expected_revision INTEGER NOT NULL, password_hash TEXT NOT NULL, flags TEXT NOT NULL CHECK (flags = 'temporary-password+enable'), at INTEGER NOT NULL )"
  },
  {
    "type": "table",
    "name": "operator_service_credentials",
    "tbl_name": "operator_service_credentials",
    "sql": "CREATE TABLE operator_service_credentials ( id TEXT PRIMARY KEY, subject TEXT NOT NULL, tenant TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('operator', 'admin')), token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, created_by TEXT NOT NULL, revoked_at INTEGER )"
  },
  {
    "type": "table",
    "name": "operator_sessions",
    "tbl_name": "operator_sessions",
    "sql": "CREATE TABLE operator_sessions ( jti TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL , auth_method TEXT NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password','oidc')))"
  },
  {
    "type": "trigger",
    "name": "operator_oidc_link_remove",
    "tbl_name": "operator_oidc_links",
    "sql": "CREATE TRIGGER operator_oidc_link_remove AFTER DELETE ON operator_oidc_links BEGIN UPDATE operator_accounts SET updated_at=updated_at+1 WHERE id=OLD.account_id; DELETE FROM operator_sessions WHERE account_id=OLD.account_id; END"
  },
  {
    "type": "trigger",
    "name": "operator_oidc_link_revision",
    "tbl_name": "operator_oidc_links",
    "sql": "CREATE TRIGGER operator_oidc_link_revision AFTER UPDATE ON operator_oidc_links BEGIN UPDATE operator_accounts SET updated_at=MAX(updated_at+1,NEW.updated_at) WHERE id=NEW.account_id; DELETE FROM operator_sessions WHERE account_id=NEW.account_id; END"
  },
  {
    "type": "trigger",
    "name": "operator_oidc_mode_revision",
    "tbl_name": "operator_accounts",
    "sql": "CREATE TRIGGER operator_oidc_mode_revision AFTER UPDATE OF auth_mode ON operator_accounts WHEN NEW.auth_mode<>OLD.auth_mode BEGIN UPDATE operator_accounts SET updated_at=MAX(updated_at+1,NEW.updated_at+1) WHERE id=NEW.id; DELETE FROM operator_sessions WHERE account_id=NEW.id; END"
  },
  {
    "type": "trigger",
    "name": "operator_recovery_apply",
    "tbl_name": "operator_recovery_requests",
    "sql": "CREATE TRIGGER operator_recovery_apply AFTER INSERT ON operator_recovery_requests BEGIN SELECT CASE WHEN NOT EXISTS ( SELECT 1 FROM operator_accounts WHERE id=NEW.account_id AND email=NEW.email AND updated_at=NEW.expected_revision ) THEN RAISE(ABORT,'Recovery target changed') END; UPDATE operator_accounts SET password_hash=NEW.password_hash,auth_mode='password', must_change_password=1,disabled=0,updated_at=MAX(updated_at+1,NEW.at) WHERE id=NEW.account_id AND email=NEW.email AND updated_at=NEW.expected_revision; DELETE FROM operator_sessions WHERE account_id=NEW.account_id; INSERT INTO operator_audit (at,action,actor_id,target_id,target_email,detail) VALUES (NEW.at,'account_reset','stamp-maintenance',NEW.account_id,NEW.email, json_object('operation','owner_recovery','operationId',NEW.operation_id)); END"
  },
  {
    "type": "trigger",
    "name": "operator_session_method_immutable",
    "tbl_name": "operator_sessions",
    "sql": "CREATE TRIGGER operator_session_method_immutable BEFORE UPDATE OF auth_method,jti ON operator_sessions WHEN NEW.auth_method<>OLD.auth_method OR NEW.jti<>OLD.jti BEGIN SELECT RAISE(ABORT,'Session origin is immutable'); END"
  }
];
export async function checkProductSchema(env: Env): Promise<void> {
  const result = await env.DB.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name LIMIT 128").all<{ type: string; name: string; tbl_name: string; sql: string }>();
  if (!result.success || result.results.length >= 128) throw new Error('Schema unavailable');
  const actual = result.results.filter(row => PRODUCT_SCHEMA.some(expected => expected.name === row.name)).map(row => ({ ...row, sql: row.sql.replace(/\s+/g, ' ').trim() }));
  if (JSON.stringify(actual) !== JSON.stringify(PRODUCT_SCHEMA)) throw new Error('Schema unavailable');
  const migrations = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id LIMIT 128').all<{ name: string }>();
  if (!migrations.success || migrations.results.length >= 128 || ['0010_operator_accounts.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql'].some(name => !migrations.results.some(row => row.name === name))) throw new Error('Migrations unavailable');
}
import { serveContentDecisions } from '@/content/service';
import { tenantConfig } from '@/tenancy/middleware';
import { isValidTenantId } from '@/tenancy/tenant';
import { IDENTITY_MATERIAL_UNAVAILABLE, requiresSafeIdentity, validateIdentityMaterial } from '@/identity/material.mjs';
import { RETENTION_CATEGORIES, retentionPolicy, retentionBirth, requireRetention, type RetentionStamp } from '@/retention';
import { configuredDestinations, configuredOperationalDestinations, type OperationalDestination } from '@/connectors/config';
import { tenantSlotGovernance } from '@/learn/slotGovernance';

export interface CheckResult { ok: boolean; ms: number; detail?: string }
export interface MonitorResult {
  at: number;
  tenant: string;
  environment: string;
  /** Check health only; alert delivery has its own outcome below. */
  ok: boolean;
  checks: Record<string, CheckResult>;
  /** What was wrong, as sentences; empty when everything answered. */
  problems: string[];
  /** Absent on legacy records; every new run reports its final delivery state. */
  alert?: {
    kind: 'problem' | 'recovery' | null;
    /** sent means an HTTP success response, not confirmation that somebody was paged. */
    status: 'not-needed' | 'sent' | 'no-webhook' | 'cooling-down' | 'failed' | 'held';
  };
  /**
   * W20 G2 (R83, R86, R94(2)): the tenant's slot-governance counters since the
   * horizon they state — how many pins the decision path refused and how many
   * times a pinned slot could not fill its `take` — summed over the tenant's
   * slots from the SAME counters the operator slots page reads per slot, in the
   * same vocabulary. Never a value the synthetic probe produced: the probe's own
   * compose is excluded where the counters are written. Absent on a legacy
   * record that carries none, and on a run whose counter store could not be
   * read, so no result states a zero it did not observe.
   */
  governance?: { since: number; refusedPinCount: number; shortTakeCount: number };
}

export interface Thresholds { decisionMs: number }
export const DEFAULT_THRESHOLDS: Thresholds = { decisionMs: 200 };
export const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const CHECKS = ['identity', 'retention', 'kv', 'sessions', 'storage', 'database', 'objects', 'decision', 'personalizedSession', 'personalizedObject', 'producer', 'consumer', 'ledger', 'learning', 'event', 'delivery'] as const;
const environments = ['development', 'staging', 'production', 'test'];
const bounded = (v: unknown, max = 86_400_000): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : 0;
const field = (v: unknown, k: string): unknown => v && typeof v === 'object' ? Object.getOwnPropertyDescriptor(v, k)?.value : undefined;
const environmentOf = (v: unknown): string => typeof v === 'string' && environments.includes(v) ? v : 'unknown';
const safeChecks = (v: unknown): Record<string, CheckResult> => Object.fromEntries(CHECKS.flatMap(name => {
  const value = field(v, name);
  if (value === undefined) return [];
  const ok = field(value, 'ok') === true;
  return [[name, { ok, ms: bounded(field(value, 'ms')), ...(ok ? {} : { detail: 'CHECK_FAILED' }) }]];
}));

/** The tenant counters a kept result carries, projected as safely as its checks:
 * three plain numbers or nothing at all. A record written before W20 G2, or one
 * whose counters were unreadable, carries none and keeps its former shape. */
const safeGovernance = (value: unknown): MonitorResult['governance'] | undefined => {
  const since = field(value, 'since'), refusedPinCount = field(value, 'refusedPinCount'), shortTakeCount = field(value, 'shortTakeCount');
  if (typeof since !== 'number' || typeof refusedPinCount !== 'number' || typeof shortTakeCount !== 'number') return undefined;
  return { since: bounded(since, 8_640_000_000_000_000), refusedPinCount: bounded(refusedPinCount, Number.MAX_SAFE_INTEGER),
    shortTakeCount: bounded(shortTakeCount, Number.MAX_SAFE_INTEGER) };
};

/** One safe projection for origin, historical reads and alert construction.
 * Unknown keys, raw details and hostile accessors are never copied/coerced. */
export function projectMonitor(value: unknown, tenant: string, environment: string): MonitorResult {
  const checks = safeChecks(field(value, 'checks'));
  const rawAlert = field(value, 'alert'), kind = field(rawAlert, 'kind'), status = field(rawAlert, 'status');
  const originalProblems = field(value, 'problems');
  const problems = CHECKS.filter(name => checks[name]?.ok === false).map(name => `${name}: CHECK_FAILED`);
  // Preserve closed originating codes, including a caller's explicit latency
  // threshold. Never recompute that policy with the projection's defaults.
  if (Array.isArray(originalProblems) && originalProblems.length <= CHECKS.length + 1
    && Array.from({ length: originalProblems.length }, (_, i) => field(originalProblems, String(i))).includes('decision: LATENCY_EXCEEDED')) problems.push('decision: LATENCY_EXCEEDED');
  const governance = safeGovernance(field(value, 'governance'));
  return { at: bounded(field(value, 'at'), 8_640_000_000_000_000),
    tenant: isValidTenantId(tenant) ? tenant : 'unknown', environment: environmentOf(environment),
    ok: field(value, 'ok') === true, checks, problems,
    alert: { kind: kind === 'problem' || kind === 'recovery' ? kind : null,
      status: ['not-needed', 'sent', 'no-webhook', 'cooling-down', 'failed', 'held'].includes(status as string) ? status as NonNullable<MonitorResult['alert']>['status'] : 'not-needed' },
    ...(governance ? { governance } : {}) };
}
type Admission = { destination: OperationalDestination; stamp: RetentionStamp };
async function admit(env: Env, tenant: string, kind: OperationalDestination['kind'], at: number): Promise<Admission | null> {
  try {
    const destination = (await configuredOperationalDestinations(env, tenant)).find(d => d.kind === kind && d.configuration.purpose !== 'isolated-synthetic-monitor');
    return destination ? { destination, stamp: retentionBirth(env, tenant, destination.category, at, at) } : null;
  } catch { return null; }
}
async function eligible(env: Env, tenant: string, admitted: Admission | null): Promise<boolean> {
  if (!admitted) return false;
  try {
    const current = (await configuredOperationalDestinations(env, tenant)).find(d => d.kind === admitted.destination.kind && d.configuration.purpose !== 'isolated-synthetic-monitor');
    if (current?.category !== admitted.destination.category) return false;
    requireRetention(env, admitted.stamp, tenant, current.category);
    return true;
  } catch { return false; }
}

/** The sentences an alert carries, from the checks. Pure. */
export function problemsOf(checks: Record<string, CheckResult>, t: Thresholds = DEFAULT_THRESHOLDS): string[] {
  const out: string[] = [];
  for (const [name, c] of Object.entries(safeChecks(checks))) {
    if (!c.ok) out.push(`${name}: CHECK_FAILED`);
    else if (name === 'decision' && c.ms > bounded(t.decisionMs)) out.push('decision: LATENCY_EXCEEDED');
  }
  return out;
}

/** The message the webhook receives: readable in a chat channel, parseable by a tool. */
export function alertPayload(r: MonitorResult): { text: string; environment: string; tenant: string; at: string; problems: string[]; checks: Record<string, CheckResult> } {
  r = projectMonitor(r, typeof field(r, 'tenant') === 'string' ? field(r, 'tenant') as string : '', environmentOf(field(r, 'environment')));
  const text = `${r.environment}: ${r.tenant} ${r.ok ? 'recovered' : 'has a problem'} at ${new Date(r.at).toISOString()}${r.problems.length ? `: ${r.problems.join('; ')}` : ''}`;
  return { text, environment: r.environment, tenant: r.tenant, at: new Date(r.at).toISOString(), problems: r.problems, checks: r.checks };
}

async function timed(fn: () => Promise<string | void>): Promise<CheckResult> {
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([fn(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic deadline')), 5000); })]); return { ok: true, ms: bounded(Date.now() - t0) }; }
  catch { return { ok: false, ms: bounded(Date.now() - t0), detail: 'CHECK_FAILED' }; }
  finally { if (timer) clearTimeout(timer); }
}
class MonitorDeadline extends Error {}
async function monitorDeadline<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new MonitorDeadline()), 5000); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export const monitorKey = (tenant: string) => `monitor:${tenant}:last`;
const alertedKey = (tenant: string) => `monitor:${tenant}:alerted`;
const recoveryKey = (tenant: string) => `monitor:${tenant}:recovery`;

export async function readMonitor(env: Env, tenant: string): Promise<MonitorResult | null> {
  const admission = await admit(env, tenant, 'monitor', Date.now());
  if (!await eligible(env, tenant, admission)) return null;
  try {
    const raw: unknown = await monitorDeadline(env.CACHE.get(monitorKey(tenant), 'json'));
    if (!raw || !await eligible(env, tenant, admission)) return null;
    const stamp = field(raw, 'retention');
    if (stamp !== undefined) requireRetention(env, stamp, tenant, admission!.destination.category);
    // Legacy data is projected only, never re-stamped or rewritten. Its raw
    // diagnostics are not retention-authorized by today's configuration.
    const result = projectMonitor(raw, tenant, env.ENVIRONMENT ?? 'unknown');
    if (stamp === undefined) { result.checks = {}; result.problems = []; }
    return result;
  } catch { return null; }
}

/** Basic binding checks and the consent-refused default decision path, in process. */
export async function runChecks(env: Env, tenant: string, now = Date.now()): Promise<Record<string, CheckResult>> {
  const checks: Record<string, CheckResult> = {};
  checks.identity = await timed(async () => {
    if (!requiresSafeIdentity(env)) return;
    const tenants = tenantConfig(env).provisioned;
    if (!tenants.includes(tenant)) throw new Error(IDENTITY_MATERIAL_UNAVAILABLE);
    validateIdentityMaterial(env, tenants);
  });
  checks.retention = await timed(async () => {
    try {
      for (const category of RETENTION_CATEGORIES) retentionPolicy(env, tenant, category);
      for (const destination of await configuredDestinations(env, tenant)) retentionPolicy(env, tenant, destination.category);
      for (const destination of await configuredOperationalDestinations(env, tenant)) retentionPolicy(env, tenant, destination.category);
    } catch { throw new Error('Retention policy unavailable'); }
  });
  checks.kv = await timed(async () => { await env.CACHE.get('monitor-probe'); });
  checks.sessions = await timed(async () => { await env.SESSIONS.get('monitor-probe'); });
  checks.storage = await timed(async () => { await env.STORAGE.head('monitor-probe'); });
  checks.database = await timed(() => checkProductSchema(env));
  checks.objects = await timed(async () => {
    if (!env.LEARN_STATS) throw new Error('LEARN_STATS not bound');
    const res = await env.LEARN_STATS.get(env.LEARN_STATS.idFromName(`${tenant}:${tenant}:monitor-probe`)).fetch('https://learn/snapshot');
    if (!res.ok && res.status !== 404) throw new Error(`answered ${res.status}`);
  });
  checks.decision = await timed(async () => {
    // Explicit refusal bypasses shopper state and customer measurement; monitor bookkeeping is separate.
    // `selfCheck`: this compose is the platform testing itself on the tenant's
    // real page, so its refused pins and short pinned slots are the probe's, not
    // the tenant's serving, and the governance counters skip it (W20 G2, R94(1)).
    const out = await serveContentDecisions(env, { tenant, page: 'home', visitorId: `monitor-${now.toString(36)}`, sessionId: `monitor-${now.toString(36)}`, channel: 'monitor', cf: null, cookieHeader: 'opt_tracking_consent=false; opt_personalization_enabled=false', stateTenant: tenant as never, nowMs: now, selfCheck: true });
    if (out.write) throw new Error('a monitor decision was going to be written');
    if (out.records.length === 0) throw new Error(`0 decisions from ${out.sources.catalog.pieces} pieces`);
    return `${out.records.length} decisions from ${out.sources.catalog.pieces} pieces`;
  });
  const [session, object] = await Promise.all([runSynthetic(env, tenant, 'session'), runSynthetic(env, tenant, 'do')]);
  checks.personalizedSession = { ok: session.state === 'complete', ms: bounded(session.decisionMs) };
  checks.personalizedObject = { ok: object.state === 'complete', ms: bounded(object.decisionMs) };
  for (const name of ['producer', 'consumer', 'ledger', 'learning', 'event'] as const) checks[name] = { ok: session[name] && object[name], ms: name === 'event' ? bounded(Math.max(session.eventMs, object.eventMs)) : 0 };
  checks.delivery = { ok: session.state === 'complete' && object.state === 'complete' && !session.dlq && !object.dlq, ms: 0 };
  // A missing-key or 404 connectivity result is never the object readiness proof.
  checks.objects.ok &&= session.state === 'complete' && object.state === 'complete';
  return checks;
}

/** One run for one tenant: checks, the kept result, the analytics point, and the alert with its cooldown. */
export async function runMonitor(env: Env, tenant: string, now = Date.now(), thresholds: Thresholds = DEFAULT_THRESHOLDS): Promise<MonitorResult> {
  if (!tenantConfig(env).provisioned.includes(tenant)) throw new Error('Monitor scope unavailable');
  const [storageAdmission, analyticsAdmission, alertAdmission] = await Promise.all(['monitor', 'analytics', 'alert'].map(kind => admit(env, tenant, kind as OperationalDestination['kind'], now)));
  const checks = await runChecks(env, tenant, now);
  const problems = problemsOf(checks, thresholds);
  // W20 G2: what this tenant's own serving refused since the counters' horizon,
  // read here and not probed: the checks above are the platform testing itself,
  // and their own compose is excluded from the counters (`selfCheck`).
  const governance = await tenantSlotGovernance(env, tenant, now);
  const result: MonitorResult = { at: now, tenant, environment: environmentOf(env.ENVIRONMENT), ok: problems.length === 0, checks, problems,
    alert: { kind: null, status: 'not-needed' }, ...(governance ? { governance } : {}) };
  let previous: MonitorResult | null = null;
  let savedRecovery: unknown;
  try {
    savedRecovery = await monitorDeadline(env.CACHE.get(recoveryKey(tenant), 'json'));
    if (!savedRecovery) {
      const raw: unknown = await monitorDeadline(env.CACHE.get(monitorKey(tenant), 'json'));
      if (raw) previous = projectMonitor(raw, tenant, result.environment);
    }
  } catch { /* necessary retry state is best effort, never a durable outbox */ }
  const recoveryPending = field(savedRecovery, 'pending') === true || (previous?.alert?.kind === 'recovery' && ['failed', 'no-webhook', 'held'].includes(previous.alert.status));
  const recovered = result.ok && (field(savedRecovery, 'ok') === false || previous?.ok === false || recoveryPending);
  if (!result.ok || recovered) result.alert = { kind: result.ok ? 'recovery' : 'problem', status: await alert(env, result, now, alertAdmission) };
  // Necessary bounded retry/cooldown state has no diagnostic payload or policy
  // TTL. Holding optional sinks must not erase a failed recovery obligation.
  let recoverySaved = false, resultSaved = false;
  try { await monitorDeadline(env.CACHE.put(recoveryKey(tenant), JSON.stringify({ version: 1, ok: result.ok, pending: !result.ok || (recovered && result.alert?.status !== 'sent') }))); recoverySaved = true; } catch { /* no durable delivery claim */ }
  try {
    if (await eligible(env, tenant, storageAdmission)) { await monitorDeadline(env.CACHE.put(monitorKey(tenant), JSON.stringify({ ...result, retention: storageAdmission!.stamp }), { expiration: Math.floor(storageAdmission!.stamp.expiresAt / 1000) })); resultSaved = true; }
  } catch { /* returned safe result remains available */ }
  try {
    if (await eligible(env, tenant, analyticsAdmission)) env.ANALYTICS?.writeDataPoint({
      blobs: ['ops-v1', result.environment, tenant, 'monitor', result.ok ? 'ok' : 'problem', result.alert!.status],
      doubles: [result.ok ? 1 : 0, bounded(checks.decision?.ms), bounded(checks.database?.ms), bounded(checks.kv?.ms)], indexes: [tenant] });
  } catch { /* scheduling is not a dataset readback */ }
  console.log('monitor result; ok/decisionMs/problems', result.ok ? 1 : 0, checks.decision?.ms ?? -1, result.problems.length);
  console.log('monitor delivery; status/resultSaved/recoverySaved', result.alert!.status, Number(resultSaved), Number(recoverySaved));
  return result;
}

/** POST the alert to the configured webhook, once per cooldown per tenant; a recovery always goes. */
export async function alert(env: Env, r: MonitorResult, now = Date.now(), retained?: Admission | null): Promise<'sent' | 'no-webhook' | 'cooling-down' | 'failed' | 'held'> {
  const admission = retained === undefined ? await admit(env, r.tenant, 'alert', r.at) : retained;
  if (!await eligible(env, r.tenant, admission)) return 'held';
  const url = (env.ALERT_WEBHOOK_URL ?? '').trim();
  if (!url) return 'no-webhook';
  if (!r.ok) {
    let last = 0;
    try { last = Number(await monitorDeadline(env.CACHE.get(alertedKey(r.tenant)))) || 0; } catch (error) { if (error instanceof MonitorDeadline) return 'failed'; last = 0; }
    // No earlier alert always sends; only an alert inside the cooldown is held back.
    if (last > 0 && now - last < ALERT_COOLDOWN_MS) return 'cooling-down';
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return 'held';
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== admission!.destination.configuration.urlSha256 || !await eligible(env, r.tenant, admission)) return 'held';
    const res = await monitorDeadline(fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alertPayload(r)), signal: AbortSignal.timeout(5000) }));
    if (!res.ok) return 'failed';
    if (!r.ok) { try { await monitorDeadline(env.CACHE.put(alertedKey(r.tenant), String(now), { expirationTtl: 3600 })); } catch { /* delivered, but cooldown is not durable */ } }
    return 'sent';
  } catch { return 'failed'; }
}
