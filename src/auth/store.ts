// src/auth/store.ts
// Where operator accounts, their sessions and the audit live: D1 (doc 30),
// behind one small interface so the routes and the tests run against the
// same logic. The in-memory store exists for the tests only; the worker
// always gets D1.

import { z } from 'zod';
import { federationGate } from './oidc';

export type Role = 'operator' | 'admin';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  permissions: string[];
  /** `pbkdf2$<iterations>$<salt>$<hash>`, base64url. */
  password_hash?: string | null;
  authMode?: 'password' | 'oidc' | 'dual';
  /** Only on a KV record from before hashing; never stored in D1. */
  password?: string;
  must_change_password?: boolean;
  disabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
  lastSignInAt?: number;
}

export interface FederationSession { tenant: string; issuer: string; linkRevision: string; configDigest: string; accountRevision: number; epoch: string; authTime: number; expiresAt: number }
export interface SessionRow { jti: string; accountId: string; tokenHash: string; createdAt: number; expiresAt: number; authMethod?: 'password' | 'oidc'; federation?: FederationSession }
export type AccountPatch = Partial<Pick<UserRecord, 'name' | 'roles' | 'permissions' | 'disabled'>>;

export type AuditAction =
  | 'sign_in' | 'sign_in_failed' | 'sign_in_locked' | 'sign_out' | 'password_changed'
  | 'account_created' | 'account_reset' | 'account_disabled' | 'account_enabled' | 'account_changed' | 'account_removed' | 'account_migrated' | 'subject_read' | 'subject_operation' | 'ledger_recovery' | 'learning_recovery';
export const learningRecoveryAuditSchema = z.object({ v: z.literal(1), requestId: z.string().uuid(),
  operation: z.enum(['status', 'repair']), kind: z.enum(['stats', 'ring']), targetRef: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['admitted', 'result']), digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  generation: z.number().int().nonnegative().optional(), status: z.number().int().min(100).max(599).optional(),
}).strict().refine(v => v.phase === 'admitted' ? v.status === undefined : v.status !== undefined);
export const recoveryAuditSchema = z.object({ v: z.literal(1), requestId: z.string().uuid(),
  operation: z.enum(['list', 'status', 'redrive', 'resolve']), route: z.literal('/operator/ledger-recovery'),
  phase: z.enum(['admitted', 'result']), caseId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  digest: z.string().regex(/^[a-f0-9]{64}$/).optional(), revision: z.number().int().positive().optional(),
  status: z.number().int().min(100).max(599).optional(), outcome: z.enum(['recorded', 'outcome_unknown']).optional(),
}).strict().refine(value => value.phase === 'admitted' ? value.status === undefined && value.outcome === undefined : value.status !== undefined && value.outcome !== undefined);
export interface AuditEntry { at: number; action: AuditAction; tenant?: string; actorId?: string | null; actorEmail?: string | null; targetId?: string | null; targetEmail?: string | null; detail?: string | null }
export interface AuditRow extends AuditEntry { id: number }
export const SUBJECT_AUDIT_ROUTES = {
  recent: '/v1/:tenant/visitors/:visitorId/recent', receipts: '/v1/:tenant/visitors/:visitorId/receipts',
  ledger: '/v1/:tenant/ledger/:id', replay: '/v1/:tenant/replay/:id',
  batches: '/v1/:tenant/ledger/batches', erasures: '/v1/:tenant/ledger/erasures', audit: '/v1/:tenant/audit',
} as const;
export type SubjectAuditOperation = keyof typeof SUBJECT_AUDIT_ROUTES;
export interface SubjectAuditDetail {
  v: 1; requestId: string; operation: SubjectAuditOperation; route: string; phase: 'admitted' | 'result';
  selector: { kind: 'tenant' } | { kind: 'visitor' | 'record'; ref: string };
  status?: number; subjectRef?: string;
}
export interface SubjectAuditRow { id: number; at: number; tenant: string; actorId: string; detail: SubjectAuditDetail | OperationAuditDetail }
export const SUBJECT_OPERATION_ROUTES = {
  identity_visitor: '/v1/:tenant/identity/visitor/:visitorId', identity_shopper: '/v1/:tenant/identity/shopper/:shopperId',
  identity_resolve: '/v1/:tenant/identity/resolve', identity_erase: '/v1/:tenant/identity/erase',
  ledger_erase: '/v1/:tenant/ledger/erasures', ledger_rewrite: '/v1/:tenant/ledger/erasures/rewrite',
  identity_import: '/v1/:tenant/identity/events',
} as const;
export type SubjectOperation = keyof typeof SUBJECT_OPERATION_ROUTES;
const auditCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const auditRef = z.string().regex(/^[a-f0-9]{64}$/);
const memberSchema = z.object({ ordinal: z.number().int().min(0).max(999), accountRef: auditRef, shopperRef: auditRef.optional() }).strict();
const historyTotal = z.number().int().min(1).max(1000);
const historyCount = z.number().int().min(0).max(1000);
// W16 C8.11 (R64): `out_of_vocabulary` is the row the tenant's own published
// catalogue refused — a different audited fact from `no_registry_touch`, the
// row that carried nothing the registry names at all.
export const historySkipReasonSchema = z.enum(['invalid_shopper', 'invalid_visitor', 'no_subject', 'erased', 'selector_conflict',
  'unweighted_action', 'no_registry_touch', 'out_of_vocabulary', 'profile_missing', 'consent_missing', 'consent_refused',
  'stale_profile', 'replayed_profile']);
const historyMember = z.object({ ordinal: z.number().int().min(0).max(999), rowKind: z.enum(['behavioral', 'profile']),
  accountRef: auditRef.optional(), shopperRef: auditRef.optional(), visitorRef: auditRef.optional(),
}).strict().refine(m => !!(m.accountRef || m.shopperRef || m.visitorRef));
const historyResultMember = z.union([
  z.object({ kind: z.literal('skipped'), ordinal: z.number().int().min(0).max(999), reason: historySkipReasonSchema }).strict(),
  z.object({ kind: z.literal('subject'), subjectKind: z.enum(['visitor', 'shopper']), subjectRef: auditRef, rows: historyTotal }).strict(),
]);
export type HistoryAuditResultMember = z.infer<typeof historyResultMember>;
const historySelectorBase = { format: z.enum(['json', 'csv']), total: historyTotal };
const operationSelectorSchema = z.union([
  z.object({ kind: z.enum(['visitor', 'shopper']), ref: auditRef }).strict(),
  z.object({ kind: z.literal('identity'), visitorRef: auditRef.optional(), shopperRef: auditRef.optional() }).strict()
    .refine(s => !!(s.visitorRef || s.shopperRef)),
  z.object({ kind: z.literal('tenant') }).strict(),
  z.object({ kind: z.literal('accounts'), total: z.number().int().min(1).max(1000), chunk: z.number().int().min(0).max(99),
    members: z.array(memberSchema).min(1).max(10) }).strict(),
  z.object({ kind: z.literal('history_inputs'), ...historySelectorBase, chunk: z.number().int().min(0).max(199),
    members: z.array(historyMember).min(1).max(5) }).strict(),
  z.object({ kind: z.literal('history_results'), ...historySelectorBase, chunk: z.number().int().min(0).max(99),
    members: z.array(historyResultMember).min(1).max(10) }).strict(),
  z.object({ kind: z.literal('history_unknown'), ...historySelectorBase }).strict(),
]);
export const operationResultSchema = z.union([
  z.object({ outcome: z.literal('read'), found: z.boolean() }).strict(),
  z.object({ outcome: z.literal('resolved') }).strict(),
  z.object({ outcome: z.literal('identity_import'), received: historyTotal, applied: historyCount, skipped: historyCount, shoppers: historyCount }).strict()
    .refine(r => r.applied + r.skipped === r.received && r.shoppers <= r.applied && (r.applied === 0) === (r.shoppers === 0)),
  z.object({ outcome: z.literal('identity_erase'), status: z.enum(['local_complete', 'pending', 'conflict', 'failed']),
    localComplete: z.boolean(), complete: z.literal(false), cutoff: auditCount }).strict().refine(r => r.localComplete === (r.status === 'local_complete')),
  z.object({ outcome: z.literal('ledger_erase'), ok: z.boolean(), ring: z.enum(['reset', 'unbound', 'failed']),
    complete: z.literal(false), cutoff: auditCount }).strict().refine(r => r.ok === (r.ring !== 'failed')),
  z.object({ outcome: z.literal('ledger_rewrite'), complete: z.literal(false), more: z.boolean(), remaining: auditCount,
    tombstones: auditCount, objects_opened: auditCount, objects_rewritten: auditCount, objects_deleted: auditCount,
    rows_removed: auditCount, retired: auditCount }).strict(),
  z.object({ outcome: z.literal('outcome_unknown'), operationMayHaveApplied: z.boolean() }).strict(),
]);
export type OperationAuditResult = z.infer<typeof operationResultSchema>;
const operationDetailSchema = z.object({
  v: z.literal(2), requestId: z.string().uuid(), operation: z.enum(['identity_visitor', 'identity_shopper', 'identity_resolve', 'identity_erase', 'ledger_erase', 'ledger_rewrite', 'identity_import']),
  route: z.string(), method: z.enum(['GET', 'HEAD', 'POST']), phase: z.enum(['admitted', 'result']), selector: operationSelectorSchema,
  status: z.number().int().min(100).max(599).optional(), result: operationResultSchema.optional(), subjectRef: auditRef.optional(),
}).strict().superRefine((d, context) => {
  const invalid = () => context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid operation audit' });
  const read = d.operation === 'identity_visitor' || d.operation === 'identity_shopper';
  const kind = d.operation === 'identity_visitor' || d.operation === 'ledger_erase' ? 'visitor' : d.operation === 'identity_shopper' ? 'shopper'
    : d.operation === 'identity_resolve' ? 'accounts' : d.operation === 'identity_erase' ? 'identity'
      : d.operation === 'identity_import' ? d.phase === 'admitted' ? 'history_inputs' : d.result?.outcome === 'outcome_unknown' ? 'history_unknown' : 'history_results' : 'tenant';
  if (d.route !== SUBJECT_OPERATION_ROUTES[d.operation] || (read ? d.method === 'POST' : d.method !== 'POST') || d.selector.kind !== kind) invalid();
  if (d.phase === 'admitted') {
    if (d.status !== undefined || d.result !== undefined || d.subjectRef !== undefined) invalid();
  } else {
    if (d.status === undefined || d.result === undefined) invalid();
    const result = d.result, outcome = result?.outcome;
    if (outcome !== 'outcome_unknown' && outcome !== (read ? 'read' : d.operation === 'identity_resolve' ? 'resolved' : d.operation)) invalid();
    if (result?.outcome === 'outcome_unknown' && (d.status !== 503 || result.operationMayHaveApplied !== (!read && d.operation !== 'identity_resolve'))) invalid();
    if (result?.outcome === 'identity_erase' && d.status !== ({ local_complete: 200, pending: 202, conflict: 409, failed: 503 })[result.status]) invalid();
    if (result?.outcome === 'read' && d.status !== (result.found || d.operation === 'identity_visitor' ? 200 : 404)) invalid();
    if ((outcome === 'resolved' || outcome === 'ledger_erase' || outcome === 'ledger_rewrite' || outcome === 'identity_import') && d.status !== 200) invalid();
    if (d.subjectRef !== undefined && !read && d.operation !== 'identity_erase') invalid();
  }
  if (d.selector.kind === 'accounts') {
    const s = d.selector, length = Math.min(10, s.total - s.chunk * 10);
    if (s.members.length !== length || s.members.some((m, i) => m.ordinal !== s.chunk * 10 + i
      || (d.phase === 'result' && d.result?.outcome === 'resolved' ? m.shopperRef === undefined : m.shopperRef !== undefined))) invalid();
  }
  if (d.selector.kind === 'history_inputs') {
    const s = d.selector;
    if (s.members.length !== Math.min(5, s.total - s.chunk * 5) || s.members.some((m, i) => m.ordinal !== s.chunk * 5 + i)) invalid();
  }
  if (d.selector.kind === 'history_results') {
    const s = d.selector, r = d.result;
    if (r?.outcome !== 'identity_import' || r.received !== s.total
      || s.members.length !== Math.min(10, r.shoppers + r.skipped - s.chunk * 10)
      || s.members.some(m => m.kind === 'skipped' ? m.ordinal >= s.total : m.rows > r.applied)) invalid();
  }
});
export type OperationAuditDetail = z.infer<typeof operationDetailSchema>;
const operationEntrySchema = z.object({ at: auditCount, action: z.literal('subject_operation'),
  tenant: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i), actorId: z.string().min(1).max(200).refine(s => !!s.trim()), detail: z.string() }).strict();
function operationAuditRow(row: AuditRow, tenant: string): SubjectAuditRow {
  if (row.tenant !== tenant || !Number.isSafeInteger(row.id) || row.id < 1 || row.actorEmail != null || row.targetId != null || row.targetEmail != null) throw auditUnavailable();
  const entry = operationEntrySchema.parse({ at: row.at, action: row.action, tenant: row.tenant, actorId: row.actorId, detail: row.detail });
  if (new TextEncoder().encode(entry.detail).byteLength > 2048) throw auditUnavailable();
  return { id: row.id, at: entry.at, tenant, actorId: entry.actorId, detail: operationDetailSchema.parse(JSON.parse(entry.detail)) };
}
/** A whole phase is validated before its one SQL statement (or memory append). */
function operationPhase(entries: AuditEntry[]): string {
  const rows = z.array(operationEntrySchema).min(1).max(200).parse(entries);
  const details = rows.map(row => operationAuditRow({ ...row, id: 1 }, row.tenant).detail as OperationAuditDetail), first = details[0]!;
  const history = first.operation === 'identity_import';
  if (!history && rows.length > 100) throw auditUnavailable();
  if (rows.some((row, i) => row.tenant !== rows[0]!.tenant || row.actorId !== rows[0]!.actorId || row.at !== rows[0]!.at
    || details[i]!.requestId !== first.requestId || details[i]!.operation !== first.operation || details[i]!.phase !== first.phase
    || details[i]!.method !== first.method || details[i]!.status !== first.status || JSON.stringify(details[i]!.result) !== JSON.stringify(first.result))) throw auditUnavailable();
  if (first.selector.kind === 'accounts') {
    const total = first.selector.total;
    if (rows.length !== Math.ceil(total / 10) || details.some((d, i) => d.selector.kind !== 'accounts' || d.selector.total !== total || d.selector.chunk !== i)) throw auditUnavailable();
  } else if (first.selector.kind === 'history_inputs' || first.selector.kind === 'history_results') {
    const initial = first.selector, result = first.result;
    const count = initial.kind === 'history_inputs' ? initial.total : result?.outcome === 'identity_import' ? result.shoppers + result.skipped : 0;
    const size = initial.kind === 'history_inputs' ? 5 : 10;
    if (rows.length !== Math.ceil(count / size) || details.some((d, i) => d.selector.kind !== initial.kind
      || !('chunk' in d.selector) || d.selector.chunk !== i || !('format' in d.selector)
      || d.selector.format !== initial.format || d.selector.total !== initial.total)) throw auditUnavailable();
    if (initial.kind === 'history_results') {
      const members = details.flatMap(d => d.selector.kind === 'history_results' ? d.selector.members : []);
      const skipped = members.filter(m => m.kind === 'skipped'), subjects = members.filter(m => m.kind === 'subject');
      if (result?.outcome !== 'identity_import' || skipped.length !== result.skipped || subjects.length !== result.shoppers
        || subjects.reduce((n, m) => n + m.rows, 0) !== result.applied
        || new Set(subjects.map(m => m.subjectKind + ':' + m.subjectRef)).size !== subjects.length
        || skipped.some((m, i) => i > 0 && m.ordinal <= skipped[i - 1]!.ordinal)
        || members.some((m, i) => (i < subjects.length) !== (m.kind === 'subject'))) throw auditUnavailable();
    }
  } else if (rows.length !== 1) throw auditUnavailable();
  const encoded = JSON.stringify(rows);
  if (new TextEncoder().encode(encoded).byteLength > (history ? 1024 : 512) * 1024) throw auditUnavailable();
  return encoded;
}
const auditUnavailable = () => new Error('Subject audit unavailable');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const subjectAuditTenant = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(v);
const ref = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
/** Strict minimized readback; never forward arbitrary detail or legacy account fields. */
function subjectAuditRow(row: AuditRow, tenant: string): SubjectAuditRow {
  if (row.action !== 'subject_read' || row.tenant !== tenant || !subjectAuditTenant(tenant)
    || !Number.isSafeInteger(row.id) || row.id < 1 || !Number.isSafeInteger(row.at) || row.at < 0
    || typeof row.actorId !== 'string' || !row.actorId.trim() || row.actorId.length > 200 || row.actorEmail != null || row.targetEmail != null || row.targetId != null
    || typeof row.detail !== 'string' || row.detail.length > 2048) throw auditUnavailable();
  const d: unknown = JSON.parse(row.detail);
  if (!object(d) || d.v !== 1 || typeof d.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(d.requestId)
    || typeof d.operation !== 'string' || !Object.hasOwn(SUBJECT_AUDIT_ROUTES, d.operation)
    || d.route !== SUBJECT_AUDIT_ROUTES[d.operation as SubjectAuditOperation]
    || (d.phase !== 'admitted' && d.phase !== 'result') || !object(d.selector)) throw auditUnavailable();
  const selector = d.selector, expected = ['v', 'requestId', 'operation', 'route', 'phase', 'selector'];
  if (d.phase === 'result') {
    if (!Number.isInteger(d.status) || (d.status as number) < 100 || (d.status as number) > 599) throw auditUnavailable();
    expected.push('status');
    if (Object.hasOwn(d, 'subjectRef')) { if (!ref(d.subjectRef)) throw auditUnavailable(); expected.push('subjectRef'); }
  }
  const kind = d.operation === 'recent' || d.operation === 'receipts' ? 'visitor'
    : d.operation === 'ledger' || d.operation === 'replay' ? 'record' : 'tenant';
  if (selector.kind !== kind || Object.keys(selector).length !== (kind === 'tenant' ? 1 : 2)
    || (kind !== 'tenant' && !ref(selector.ref)) || Object.keys(d).length !== expected.length
    || !expected.every(k => Object.hasOwn(d, k))) throw auditUnavailable();
  return { id: row.id, at: row.at, tenant, actorId: row.actorId, detail: d as unknown as SubjectAuditDetail };
}
function auditPage(tenant: string, before: number | undefined, limit: number): void {
  if (!subjectAuditTenant(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (before !== undefined && (!Number.isSafeInteger(before) || before < 1))) throw auditUnavailable();
}
type RemovalActor = Pick<AuditEntry, 'at' | 'actorId' | 'actorEmail'>;
type AccountIdentity = Pick<UserRecord, 'id' | 'email'>;

export interface CurrentHumanActor { id: string; sid: string; accountRevision: number; federation?: FederationSession }
export interface AccountStore {
  getByEmail(email: string): Promise<UserRecord | null>;
  getById(id: string): Promise<UserRecord | null>;
  create(user: UserRecord, actor?: CurrentHumanActor): Promise<boolean>;
  importLegacy(user: UserRecord): Promise<boolean>;
  hasRemoval(user: AccountIdentity): Promise<boolean>;
  completeSignIn(expected: UserRecord, session: SessionRow, now: number): Promise<boolean>;
  replacePassword(expected: UserRecord, sourceSid: string, hash: string, session: SessionRow, now: number): Promise<boolean>;
  patchAccount(expected: UserRecord, patch: AccountPatch, now: number, actor?: CurrentHumanActor): Promise<boolean>;
  resetPassword(expected: UserRecord, hash: string, now: number, actor?: CurrentHumanActor): Promise<boolean>;
  removeAccount(expected: UserRecord, actor: RemovalActor, authority?: CurrentHumanActor): Promise<boolean>;
  list(): Promise<UserRecord[]>;
  getSession(jti: string): Promise<SessionRow | null>;
  revokeSessions(accountId: string): Promise<void>;
  audit(e: AuditEntry): Promise<void>;
  auditOperations(entries: AuditEntry[]): Promise<void>;
  /** Failed sign-ins recorded against this email since `sinceMs`. */
  failedSignIns(email: string, sinceMs: number): Promise<number>;
  recentAudit(limit: number): Promise<AuditRow[]>;
  subjectAudit(tenant: string, before: number | undefined, limit: number): Promise<SubjectAuditRow[]>;
}

// ── D1 ───────────────────────────────────────────────────────────────────────

type WriteResult = { success: boolean; meta: { changes: number } };
type Statement = { bind(...args: unknown[]): Statement; first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<{ success?: boolean; results: T[] }>; run(): Promise<WriteResult> };
type D1Like = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<WriteResult[]> };

interface AccountRow { id: string; email: string; name: string; roles: string; permissions: string; password_hash: string | null; auth_mode: 'password' | 'oidc' | 'dual'; must_change_password: number; disabled: number; created_at: number; updated_at: number; last_sign_in_at: number | null }

const parseList = (s: string | null | undefined, fallback: string[]): string[] => { try { const v = JSON.parse(s || ''); return Array.isArray(v) ? v.map(String) : fallback; } catch { return fallback; } };
const fromRow = (r: AccountRow): UserRecord => ({
  id: r.id, email: r.email, name: r.name, roles: parseList(r.roles, ['operator']) as Role[], permissions: parseList(r.permissions, ['read']),
  password_hash: r.password_hash, authMode: r.auth_mode ?? 'password', must_change_password: Boolean(r.must_change_password), disabled: Boolean(r.disabled),
  createdAt: r.created_at, updatedAt: r.updated_at, lastSignInAt: r.last_sign_in_at ?? undefined,
});

// updated_at is a monotonic security revision. Compare the actual authority too:
// a same-millisecond or external field change must not match a stale snapshot.
const expectedSQL = `id = ? AND email = ? AND password_hash IS ? AND json(roles) = json(?) AND json(permissions) = json(?)
  AND must_change_password = ? AND disabled = ? AND updated_at = ? AND auth_mode = ?`;
const expectedArgs = (u: UserRecord): unknown[] => [u.id, u.email, u.password_hash ?? null, JSON.stringify(u.roles), JSON.stringify(u.permissions),
  u.must_change_password ? 1 : 0, u.disabled ? 1 : 0, u.updatedAt ?? 0, u.authMode ?? 'password'];
const matches = (current: UserRecord | undefined, expected: UserRecord): current is UserRecord =>
  Boolean(current) && JSON.stringify(expectedArgs(current!)) === JSON.stringify(expectedArgs(expected));
const revision = (u: UserRecord, now: number) => Math.max((u.updatedAt ?? 0) + 1, now);
const sessionArgs = (s: SessionRow) => [s.jti, s.accountId, s.tokenHash, s.createdAt, s.expiresAt];
const sessionGate = 'EXISTS (SELECT 1 FROM operator_sessions WHERE jti = ? AND account_id = ? AND token_hash = ?)';
const gateArgs = (s: SessionRow) => [s.jti, s.accountId, s.tokenHash];
const changed = (r: WriteResult) => { if (!r.success) throw new Error('Account mutation failed'); return r.meta.changes === 1; };
// Removal history is also the durable legacy-import barrier. It survives explicit
// recreation and must be retained even when the best-effort KV deletion fails.
const removalSQL = "action = 'account_removed' AND (target_id = ? OR target_email = ?)";
const identityArgs = (u: AccountIdentity) => [u.id, u.email.trim().toLowerCase()];

export function d1Store(db: D1Like, validateActor?: (actor: CurrentHumanActor) => Promise<void>): AccountStore {
  const q = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  const actorGate = (a: CurrentHumanActor, at: number) => {
    const f = federationGate(a.sid, a.federation);
    return { sql: `EXISTS (SELECT 1 FROM operator_accounts a
    JOIN operator_sessions s ON s.account_id=a.id WHERE a.id=? AND a.updated_at=? AND a.disabled=0
    AND a.must_change_password=0 AND s.jti=? AND s.expires_at>? AND ${f.sql})`, args: [a.id, a.accountRevision, a.sid, at, ...f.args] };
  };
  const revokeIf = (u: UserRecord) => q(`DELETE FROM operator_sessions WHERE account_id = ? AND EXISTS
    (SELECT 1 FROM operator_accounts WHERE ${expectedSQL})`, u.id, ...expectedArgs(u));
  // Even when authority no longer matches, a reused JTI must abort the batch:
  // it cannot masquerade as the new insert that authorizes dependent statements.
  const insertIf = (u: UserRecord, s: SessionRow, extra = '', args: unknown[] = []) => q(`INSERT INTO operator_sessions
    (jti, account_id, token_hash, created_at, expires_at) SELECT ?, ?, ?, ?, ? WHERE
    EXISTS (SELECT 1 FROM operator_accounts WHERE ${expectedSQL} AND disabled = 0 ${extra})
    OR EXISTS (SELECT 1 FROM operator_sessions WHERE jti = ?)`, ...sessionArgs(s), ...expectedArgs(u), ...args, s.jti);
  const batch = async (statements: Statement[], resultIndex: number, actor?: CurrentHumanActor) => {
    if (actor) {
      await validateActor?.(actor);
      const gate = actorGate(actor, Date.now());
      // A zero-write assertion at the start of the native transaction. Invalid
      // authority deliberately violates NOT NULL and aborts the entire batch.
      // Unlike repeating a SID predicate after revocation, this also permits a
      // legitimate owner to reset their own account atomically.
      statements = [q(`INSERT INTO operator_sessions (jti,account_id,token_hash,created_at,expires_at)
        SELECT '',NULL,'',0,0 WHERE NOT (${gate.sql})`, ...gate.args), ...statements];
      resultIndex++;
    }
    const results = await db.batch(statements);
    if (results.length !== statements.length || results.some(r => !r.success)) throw new Error('Account mutation failed');
    return changed(results[resultIndex]!);
  };
  const create = async (u: UserRecord, legacy: boolean, actor?: CurrentHumanActor) => {
    if (actor) await validateActor?.(actor);
    const now = Date.now();
    const gate = actor && actorGate(actor, now);
    return changed(await q(
      `INSERT INTO operator_accounts (id, email, name, roles, permissions, password_hash, must_change_password, disabled, created_at, updated_at, last_sign_in_at, auth_mode)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${legacy ? `NOT EXISTS (SELECT 1 FROM operator_audit WHERE ${removalSQL})` : '1'}${gate ? ` AND ${gate.sql}` : ''}
       ON CONFLICT DO NOTHING`,
      u.id, u.email.trim().toLowerCase(), u.name, JSON.stringify(u.roles), JSON.stringify(u.permissions), u.password_hash ?? null,
      u.must_change_password ? 1 : 0, u.disabled ? 1 : 0, u.createdAt ?? now, u.updatedAt ?? now, u.lastSignInAt ?? null, u.authMode ?? 'password',
      ...(legacy ? identityArgs(u) : []),
      ...(gate?.args ?? []),
    ).run());
  };
  return {
    async getByEmail(email) { const r = await q('SELECT * FROM operator_accounts WHERE email = ?', email.trim().toLowerCase()).first<AccountRow>(); return r ? fromRow(r) : null; },
    async getById(id) { const r = await q('SELECT * FROM operator_accounts WHERE id = ?', id).first<AccountRow>(); return r ? fromRow(r) : null; },
    async create(u, actor) { return create(u, false, actor); },
    async importLegacy(u) { return create(u, true); },
    async hasRemoval(u) { return Boolean(await q(`SELECT 1 FROM operator_audit WHERE ${removalSQL} LIMIT 1`, ...identityArgs(u)).first()); },
    async completeSignIn(u, s, now) {
      if (s.accountId !== u.id || s.expiresAt <= now || u.authMode === 'oidc') return false;
      return batch([
        insertIf(u, s),
        q(`UPDATE operator_accounts SET last_sign_in_at = MAX(COALESCE(last_sign_in_at, 0), ?)
          WHERE ${expectedSQL} AND disabled = 0 AND ${sessionGate}`, now, ...expectedArgs(u), ...gateArgs(s)),
      ], 0);
    },
    async replacePassword(u, sourceSid, hash, s, now) {
      if (s.accountId !== u.id || s.jti === sourceSid || s.expiresAt <= now || u.authMode === 'oidc') return false;
      const source = 'EXISTS (SELECT 1 FROM operator_sessions WHERE jti = ? AND account_id = ? AND expires_at > ?)';
      return batch([
        insertIf(u, s, `AND ${source}`, [sourceSid, u.id, now]),
        // Revoke while the old account predicate still holds. Replaying a stale
        // attempt cannot use its earlier replacement JTI to revoke newer sessions.
        q(`DELETE FROM operator_sessions WHERE account_id = ? AND jti <> ? AND ${sessionGate}
          AND EXISTS (SELECT 1 FROM operator_accounts WHERE ${expectedSQL} AND disabled = 0)`,
          u.id, s.jti, ...gateArgs(s), ...expectedArgs(u)),
        q(`UPDATE operator_accounts SET password_hash = ?, must_change_password = 0, updated_at = MAX(updated_at + 1, ?)
          WHERE ${expectedSQL} AND disabled = 0 AND ${sessionGate}`, hash, now, ...expectedArgs(u), ...gateArgs(s)),
      ], 0);
    },
    async patchAccount(u, patch, now, actor) {
      const sets: string[] = [], args: unknown[] = [];
      if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name); }
      if (patch.roles !== undefined) { sets.push('roles = ?'); args.push(JSON.stringify(patch.roles)); }
      if (patch.permissions !== undefined) { sets.push('permissions = ?'); args.push(JSON.stringify(patch.permissions)); }
      if (patch.disabled !== undefined) { sets.push('disabled = ?'); args.push(patch.disabled ? 1 : 0); }
      sets.push('updated_at = MAX(updated_at + 1, ?)'); args.push(now);
      const update = q(`UPDATE operator_accounts SET ${sets.join(', ')} WHERE ${expectedSQL}`, ...args, ...expectedArgs(u));
      const revokes = patch.roles !== undefined || patch.permissions !== undefined || patch.disabled !== undefined;
      return batch(revokes ? [revokeIf(u), update] : [update], revokes ? 1 : 0, actor);
    },
    async resetPassword(u, hash, now, actor) {
      if (u.authMode === 'oidc') return false; // Explicit owner-recovery/mode transition only.
      return batch([revokeIf(u), q(`UPDATE operator_accounts SET password_hash = ?, must_change_password = 1,
        updated_at = MAX(updated_at + 1, ?) WHERE ${expectedSQL}`, hash, now, ...expectedArgs(u))], 1, actor);
    },
    async removeAccount(u, actor, authority) {
      return batch([
        q(`INSERT INTO operator_audit (at, action, actor_id, actor_email, target_id, target_email)
          SELECT ?, 'account_removed', ?, ?, id, lower(trim(email)) FROM operator_accounts WHERE ${expectedSQL}`,
          actor.at, actor.actorId ?? null, actor.actorEmail ?? null, ...expectedArgs(u)),
        revokeIf(u), q(`DELETE FROM operator_accounts WHERE ${expectedSQL}`, ...expectedArgs(u)),
      ], 2, authority);
    },
    async list() { const r = await q('SELECT * FROM operator_accounts ORDER BY email').all<AccountRow>(); return r.results.map(fromRow); },
    async getSession(jti) {
      const r = await q('SELECT jti, account_id, token_hash, created_at, expires_at, auth_method FROM operator_sessions WHERE jti = ?', jti).first<{ jti: string; account_id: string; token_hash: string; created_at: number; expires_at: number; auth_method: string }>();
      if (!r) return null;
      const f = await q('SELECT * FROM operator_oidc_sessions WHERE session_id=?', jti).first<{ account_id: string; tenant: string; issuer: string; link_revision: string; config_digest: string; account_revision: number; epoch: string; auth_time: number; expires_at: number }>();
      if (!['password', 'oidc'].includes(r.auth_method) || (r.auth_method === 'oidc') !== jti.startsWith('oidc.')
        || (r.auth_method === 'oidc') !== Boolean(f) || (f && (f.account_id !== r.account_id || f.expires_at !== r.expires_at))) throw new Error('Session provenance unavailable');
      return { jti: r.jti, accountId: r.account_id, tokenHash: r.token_hash, createdAt: r.created_at, expiresAt: r.expires_at, authMethod: r.auth_method as 'password' | 'oidc',
        ...(f ? { federation: { tenant: f.tenant, issuer: f.issuer, linkRevision: f.link_revision, configDigest: f.config_digest,
          accountRevision: f.account_revision, epoch: f.epoch, authTime: f.auth_time, expiresAt: f.expires_at } } : {}) };
    },
    async revokeSessions(accountId) {
      await batch([q('UPDATE operator_accounts SET updated_at = MAX(updated_at + 1, ?) WHERE id = ?', Date.now(), accountId),
        q('DELETE FROM operator_sessions WHERE account_id = ?', accountId)], 0);
    },
    async audit(e) {
      if (e.action === 'learning_recovery') learningRecoveryAuditSchema.parse(JSON.parse(e.detail ?? 'null'));
      if (e.action === 'ledger_recovery') recoveryAuditSchema.parse(JSON.parse(e.detail ?? 'null'));
      if (e.action === 'subject_operation') throw auditUnavailable(); // Only the whole-phase writer may append v2.
      if (e.action === 'subject_read') subjectAuditRow({ ...e, id: 1 }, e.tenant ?? '');
      if (e.tenant !== undefined && !subjectAuditTenant(e.tenant)) throw auditUnavailable();
      const args = [e.at, e.action, e.actorId ?? null, e.actorEmail ?? null, e.targetId ?? null, e.targetEmail ?? null, e.detail ?? null];
      const result = await (e.tenant === undefined
        ? q('INSERT INTO operator_audit (at, action, actor_id, actor_email, target_id, target_email, detail) VALUES (?, ?, ?, ?, ?, ?, ?)', ...args)
        : q('INSERT INTO operator_audit (at, action, actor_id, actor_email, target_id, target_email, detail, tenant) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...args, e.tenant)).run();
      if (result?.success !== true || result.meta?.changes !== 1) throw auditUnavailable();
    },
    async auditOperations(entries) {
      const encoded = operationPhase(entries), count = entries.length;
      const result = await q(`INSERT INTO operator_audit (at, action, actor_id, tenant, detail)
        SELECT json_extract(value, '$.at'), json_extract(value, '$.action'), json_extract(value, '$.actorId'),
          json_extract(value, '$.tenant'), json_extract(value, '$.detail') FROM json_each(?) ORDER BY CAST(key AS INTEGER)`, encoded).run();
      if (result?.success !== true || result.meta?.changes !== count) throw auditUnavailable();
    },
    async failedSignIns(email, sinceMs) {
      const r = await q("SELECT COUNT(*) AS n FROM operator_audit WHERE target_email = ? AND action = 'sign_in_failed' AND at >= ?", email.trim().toLowerCase(), sinceMs).first<{ n: number }>();
      return Number(r?.n ?? 0);
    },
    async recentAudit(limit) {
      const r = await q("SELECT id, at, action, actor_id, actor_email, target_id, target_email, detail FROM operator_audit WHERE action NOT IN ('subject_read', 'subject_operation') ORDER BY at DESC, id DESC LIMIT ?", Math.max(1, Math.min(500, limit))).all<{ id: number; at: number; action: AuditAction; actor_id: string | null; actor_email: string | null; target_id: string | null; target_email: string | null; detail: string | null }>();
      return r.results.map((x) => ({ id: x.id, at: x.at, action: x.action, actorId: x.actor_id, actorEmail: x.actor_email, targetId: x.target_id, targetEmail: x.target_email, detail: x.detail }));
    },
    async subjectAudit(tenant, before, limit) {
      auditPage(tenant, before, limit);
      const r = await q(`SELECT id, at, action, tenant, actor_id, actor_email, target_id, target_email, detail
        FROM operator_audit WHERE tenant = ? AND action IN ('subject_read', 'subject_operation')${before === undefined ? '' : ' AND id < ?'}
        ORDER BY id DESC LIMIT ?`, tenant, ...(before === undefined ? [] : [before]), limit + 1)
        .all<{ id: number; at: number; action: AuditAction; tenant: string; actor_id: string; actor_email: string | null; target_id: string | null; target_email: string | null; detail: string }>();
      if (r?.success !== true || !Array.isArray(r.results) || r.results.length > limit + 1) throw auditUnavailable();
      let previous = before ?? Infinity;
      return r.results.map(x => {
        const row = (x.action === 'subject_operation' ? operationAuditRow : subjectAuditRow)({ ...x, actorId: x.actor_id, actorEmail: x.actor_email, targetId: x.target_id, targetEmail: x.target_email }, tenant);
        if (row.id >= previous) throw auditUnavailable(); previous = row.id; return row;
      });
    },
  };
}

// ── In memory, for the tests ─────────────────────────────────────────────────

export function memoryStore(): AccountStore & { users: Map<string, UserRecord>; sessions: Map<string, SessionRow>; log: AuditRow[];
  put(u: UserRecord): Promise<void>; remove(id: string): Promise<void>; putSession(s: SessionRow): Promise<void> } {
  const users = new Map<string, UserRecord>();
  const sessions = new Map<string, SessionRow>();
  const log: AuditRow[] = [];
  const currentActor = (a?: CurrentHumanActor) => {
    if (!a) return true;
    const u = users.get(a.id), s = sessions.get(a.sid);
    return Boolean(u && !u.disabled && !u.must_change_password && (u.updatedAt ?? 0) === a.accountRevision
      && s && s.accountId === a.id && s.expiresAt > Date.now()
      && (!s.jti.startsWith('oidc.') || (s.authMethod === 'oidc' && s.federation && JSON.stringify(s.federation) === JSON.stringify(a.federation))));
  };
  const revoke = (id: string) => { for (const [key, s] of sessions) if (s.accountId === id) sessions.delete(key); };
  const insertSession = (s: SessionRow) => { if (sessions.has(s.jti)) throw new Error('Duplicate session'); sessions.set(s.jti, { ...s }); };
  const hasRemoval = (u: AccountIdentity) => log.some(e => e.action === 'account_removed'
    && (e.targetId === u.id || e.targetEmail === u.email.trim().toLowerCase()));
  const create = (u: UserRecord) => {
    if (users.has(u.id) || [...users.values()].some(x => x.email === u.email.trim().toLowerCase())) return false;
    users.set(u.id, { ...u, email: u.email.trim().toLowerCase() }); return true;
  };
  return {
    users, sessions, log,
    async getByEmail(email) { const e = email.trim().toLowerCase(); return [...users.values()].find((u) => u.email === e) ?? null; },
    async getById(id) { return users.get(id) ?? null; },
    async put(u) { users.set(u.id, { ...u, email: u.email.trim().toLowerCase() }); },
    async remove(id) { users.delete(id); },
    async create(u, actor) { return currentActor(actor) && create(u); },
    async importLegacy(u) { return !hasRemoval(u) && create(u); },
    async hasRemoval(u) { return hasRemoval(u); },
    async completeSignIn(u, s, now) {
      const current = users.get(u.id);
      if (s.accountId !== u.id || s.expiresAt <= now || u.authMode === 'oidc') return false;
      if (sessions.has(s.jti)) throw new Error('Duplicate session');
      if (!matches(current, u) || current.disabled) return false;
      insertSession(s); users.set(u.id, { ...current, lastSignInAt: Math.max(current.lastSignInAt ?? 0, now) }); return true;
    },
    async replacePassword(u, sourceSid, hash, s, now) {
      const current = users.get(u.id), source = sessions.get(sourceSid);
      if (s.accountId !== u.id || s.jti === sourceSid || s.expiresAt <= now || u.authMode === 'oidc') return false;
      if (sessions.has(s.jti)) throw new Error('Duplicate session');
      if (!matches(current, u) || current.disabled || !source || source.accountId !== u.id || source.expiresAt <= now) return false;
      insertSession(s);
      for (const [key, other] of sessions) if (other.accountId === u.id && key !== s.jti) sessions.delete(key);
      users.set(u.id, { ...current, password_hash: hash, must_change_password: false, updatedAt: revision(current, now) }); return true;
    },
    async patchAccount(u, patch, now, actor) {
      const current = users.get(u.id); if (!currentActor(actor) || !matches(current, u)) return false;
      if (patch.roles !== undefined || patch.permissions !== undefined || patch.disabled !== undefined) revoke(u.id);
      users.set(u.id, { ...current, ...patch, updatedAt: revision(current, now) }); return true;
    },
    async resetPassword(u, hash, now, actor) {
      if (u.authMode === 'oidc') return false;
      const current = users.get(u.id); if (!currentActor(actor) || !matches(current, u)) return false;
      revoke(u.id); users.set(u.id, { ...current, password_hash: hash, must_change_password: true, updatedAt: revision(current, now) }); return true;
    },
    async removeAccount(u, actor, authority) {
      if (!currentActor(authority) || !matches(users.get(u.id), u)) return false;
      log.push({ id: log.length + 1, at: actor.at, action: 'account_removed', actorId: actor.actorId ?? null,
        actorEmail: actor.actorEmail ?? null, targetId: u.id, targetEmail: u.email.trim().toLowerCase() });
      revoke(u.id); users.delete(u.id); return true;
    },
    async list() { return [...users.values()].sort((a, b) => a.email.localeCompare(b.email)); },
    async putSession(s) { sessions.set(s.jti, s); },
    async getSession(jti) { return sessions.get(jti) ?? null; },
    async revokeSessions(accountId) { const u = users.get(accountId); if (u) users.set(accountId, { ...u, updatedAt: revision(u, Date.now()) }); revoke(accountId); },
    async audit(e) { if (e.action === 'learning_recovery') learningRecoveryAuditSchema.parse(JSON.parse(e.detail ?? 'null')); if (e.action === 'ledger_recovery') recoveryAuditSchema.parse(JSON.parse(e.detail ?? 'null')); if (e.action === 'subject_operation') throw auditUnavailable(); if (e.action === 'subject_read') subjectAuditRow({ ...e, id: 1 }, e.tenant ?? ''); log.push({ id: log.length + 1, ...e }); },
    async auditOperations(entries) { const rows = JSON.parse(operationPhase(entries)) as AuditEntry[]; log.push(...rows.map((e, i) => ({ ...e, id: log.length + i + 1 }))); },
    async failedSignIns(email, sinceMs) { const e = email.trim().toLowerCase(); return log.filter((x) => x.action === 'sign_in_failed' && x.targetEmail === e && x.at >= sinceMs).length; },
    async recentAudit(limit) { return [...log].reverse().filter(row => row.action !== 'subject_read' && row.action !== 'subject_operation').slice(0, limit); },
    async subjectAudit(tenant, before, limit) {
      auditPage(tenant, before, limit);
      return [...log].reverse().filter(row => row.tenant === tenant && (row.action === 'subject_read' || row.action === 'subject_operation') && (before === undefined || row.id < before))
        .slice(0, limit + 1).map(row => (row.action === 'subject_operation' ? operationAuditRow : subjectAuditRow)(row, tenant));
    },
  };
}
