// src/auth/store.ts
// Where operator accounts, their sessions and the audit live: D1 (doc 30),
// behind one small interface so the routes and the tests run against the
// same logic. The in-memory store exists for the tests only; the worker
// always gets D1.

export type Role = 'operator' | 'admin';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  permissions: string[];
  /** `pbkdf2$<iterations>$<salt>$<hash>`, base64url. */
  password_hash?: string;
  /** Only on a KV record from before hashing; never stored in D1. */
  password?: string;
  must_change_password?: boolean;
  disabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
  lastSignInAt?: number;
}

export interface SessionRow { jti: string; accountId: string; tokenHash: string; createdAt: number; expiresAt: number }

export type AuditAction =
  | 'sign_in' | 'sign_in_failed' | 'sign_in_locked' | 'sign_out' | 'password_changed'
  | 'account_created' | 'account_reset' | 'account_disabled' | 'account_enabled' | 'account_changed' | 'account_removed' | 'account_migrated';
export interface AuditEntry { at: number; action: AuditAction; actorId?: string | null; actorEmail?: string | null; targetId?: string | null; targetEmail?: string | null; detail?: string | null }
export interface AuditRow extends AuditEntry { id: number }

export interface AccountStore {
  getByEmail(email: string): Promise<UserRecord | null>;
  getById(id: string): Promise<UserRecord | null>;
  put(user: UserRecord): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<UserRecord[]>;
  putSession(s: SessionRow): Promise<void>;
  getSession(jti: string): Promise<SessionRow | null>;
  revokeSessions(accountId: string): Promise<void>;
  audit(e: AuditEntry): Promise<void>;
  /** Failed sign-ins recorded against this email since `sinceMs`. */
  failedSignIns(email: string, sinceMs: number): Promise<number>;
  recentAudit(limit: number): Promise<AuditRow[]>;
}

// ── D1 ───────────────────────────────────────────────────────────────────────

type D1Like = { prepare(sql: string): { bind(...args: unknown[]): { first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<{ results: T[] }>; run(): Promise<unknown> } } };

interface AccountRow { id: string; email: string; name: string; roles: string; permissions: string; password_hash: string; must_change_password: number; disabled: number; created_at: number; updated_at: number; last_sign_in_at: number | null }

const parseList = (s: string | null | undefined, fallback: string[]): string[] => { try { const v = JSON.parse(s || ''); return Array.isArray(v) ? v.map(String) : fallback; } catch { return fallback; } };
const fromRow = (r: AccountRow): UserRecord => ({
  id: r.id, email: r.email, name: r.name, roles: parseList(r.roles, ['operator']) as Role[], permissions: parseList(r.permissions, ['read']),
  password_hash: r.password_hash, must_change_password: Boolean(r.must_change_password), disabled: Boolean(r.disabled),
  createdAt: r.created_at, updatedAt: r.updated_at, lastSignInAt: r.last_sign_in_at ?? undefined,
});

export function d1Store(db: D1Like): AccountStore {
  const q = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  return {
    async getByEmail(email) { const r = await q('SELECT * FROM operator_accounts WHERE email = ?', email.trim().toLowerCase()).first<AccountRow>(); return r ? fromRow(r) : null; },
    async getById(id) { const r = await q('SELECT * FROM operator_accounts WHERE id = ?', id).first<AccountRow>(); return r ? fromRow(r) : null; },
    async put(u) {
      const now = Date.now();
      await q(
        `INSERT INTO operator_accounts (id, email, name, roles, permissions, password_hash, must_change_password, disabled, created_at, updated_at, last_sign_in_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, roles = excluded.roles, permissions = excluded.permissions,
           password_hash = excluded.password_hash, must_change_password = excluded.must_change_password, disabled = excluded.disabled,
           updated_at = excluded.updated_at, last_sign_in_at = excluded.last_sign_in_at`,
        u.id, u.email.trim().toLowerCase(), u.name, JSON.stringify(u.roles), JSON.stringify(u.permissions), u.password_hash ?? '',
        u.must_change_password ? 1 : 0, u.disabled ? 1 : 0, u.createdAt ?? now, u.updatedAt ?? now, u.lastSignInAt ?? null,
      ).run();
    },
    async remove(id) { await q('DELETE FROM operator_accounts WHERE id = ?', id).run(); },
    async list() { const r = await q('SELECT * FROM operator_accounts ORDER BY email').all<AccountRow>(); return r.results.map(fromRow); },
    async putSession(s) { await q('INSERT INTO operator_sessions (jti, account_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', s.jti, s.accountId, s.tokenHash, s.createdAt, s.expiresAt).run(); },
    async getSession(jti) {
      const r = await q('SELECT jti, account_id, token_hash, created_at, expires_at FROM operator_sessions WHERE jti = ?', jti).first<{ jti: string; account_id: string; token_hash: string; created_at: number; expires_at: number }>();
      return r ? { jti: r.jti, accountId: r.account_id, tokenHash: r.token_hash, createdAt: r.created_at, expiresAt: r.expires_at } : null;
    },
    async revokeSessions(accountId) { await q('DELETE FROM operator_sessions WHERE account_id = ?', accountId).run(); },
    async audit(e) { await q('INSERT INTO operator_audit (at, action, actor_id, actor_email, target_id, target_email, detail) VALUES (?, ?, ?, ?, ?, ?, ?)', e.at, e.action, e.actorId ?? null, e.actorEmail ?? null, e.targetId ?? null, e.targetEmail ?? null, e.detail ?? null).run(); },
    async failedSignIns(email, sinceMs) {
      const r = await q("SELECT COUNT(*) AS n FROM operator_audit WHERE target_email = ? AND action = 'sign_in_failed' AND at >= ?", email.trim().toLowerCase(), sinceMs).first<{ n: number }>();
      return Number(r?.n ?? 0);
    },
    async recentAudit(limit) {
      const r = await q('SELECT id, at, action, actor_id, actor_email, target_id, target_email, detail FROM operator_audit ORDER BY at DESC, id DESC LIMIT ?', Math.max(1, Math.min(500, limit))).all<{ id: number; at: number; action: AuditAction; actor_id: string | null; actor_email: string | null; target_id: string | null; target_email: string | null; detail: string | null }>();
      return r.results.map((x) => ({ id: x.id, at: x.at, action: x.action, actorId: x.actor_id, actorEmail: x.actor_email, targetId: x.target_id, targetEmail: x.target_email, detail: x.detail }));
    },
  };
}

// ── In memory, for the tests ─────────────────────────────────────────────────

export function memoryStore(): AccountStore & { users: Map<string, UserRecord>; sessions: Map<string, SessionRow>; log: AuditRow[] } {
  const users = new Map<string, UserRecord>();
  const sessions = new Map<string, SessionRow>();
  const log: AuditRow[] = [];
  return {
    users, sessions, log,
    async getByEmail(email) { const e = email.trim().toLowerCase(); return [...users.values()].find((u) => u.email === e) ?? null; },
    async getById(id) { return users.get(id) ?? null; },
    async put(u) { users.set(u.id, { ...u, email: u.email.trim().toLowerCase() }); },
    async remove(id) { users.delete(id); },
    async list() { return [...users.values()].sort((a, b) => a.email.localeCompare(b.email)); },
    async putSession(s) { sessions.set(s.jti, s); },
    async getSession(jti) { return sessions.get(jti) ?? null; },
    async revokeSessions(accountId) { for (const [k, s] of sessions) if (s.accountId === accountId) sessions.delete(k); },
    async audit(e) { log.push({ id: log.length + 1, ...e }); },
    async failedSignIns(email, sinceMs) { const e = email.trim().toLowerCase(); return log.filter((x) => x.action === 'sign_in_failed' && x.targetEmail === e && x.at >= sinceMs).length; },
    async recentAudit(limit) { return [...log].reverse().slice(0, limit); },
  };
}
