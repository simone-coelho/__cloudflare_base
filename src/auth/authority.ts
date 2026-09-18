import type { Env } from '@/types/env';
import type { AccountStore } from './store';
import { isValidTenantId } from '@/tenancy/tenant';
import { assertFederationSession, federationGate } from './oidc';
import { storeFor } from './accounts';

export type TenantRole = 'operator' | 'admin';
export interface TenantGrant { tenant: string; role: TenantRole; revision: string }
export interface Membership extends TenantGrant { accountId: string; disabled: boolean; removed: boolean; updatedAt: number }
export interface ServiceCredential {
  id: string; subject: string; tenant: string; role: TenantRole; tokenHash: string;
  expiresAt: number; createdAt: number; createdBy: string; revokedAt: number | null;
}
export interface AuthorityActor { id: string; sid: string; accountRevision: number; owner: boolean; tenant: string; membershipRevision?: string; federation?: import('./store').FederationSession }
export interface AuthorityPage<T> { items: T[]; next: string | null }
export interface AuthorityStore {
  grants(accountId: string): Promise<TenantGrant[]>;
  members(tenant: string, after?: string): Promise<AuthorityPage<Membership>>;
  member(accountId: string, tenant: string): Promise<Membership | null>;
  changeMember(expected: Membership | null, next: Membership | null, actor: AuthorityActor, at: number): Promise<boolean>;
  credential(id: string): Promise<ServiceCredential | null>;
  credentials(tenant: string, after?: string): Promise<AuthorityPage<ServiceCredential>>;
  issue(row: ServiceCredential, actor: AuthorityActor, replaces?: ServiceCredential): Promise<boolean>;
  revoke(row: ServiceCredential, actor: AuthorityActor, at: number): Promise<boolean>;
}

export const customerAuthority = (env: Pick<Env, 'DEPLOYMENT_PROFILE'>): boolean => env.DEPLOYMENT_PROFILE === 'customer';
export function stampOwner(env: Pick<Env, 'STAMP_OWNER_SUBJECTS'>, subject: string | undefined): boolean {
  try {
    const owners: unknown = JSON.parse(env.STAMP_OWNER_SUBJECTS ?? '[]');
    return Boolean(subject) && Array.isArray(owners) && owners.length > 0 && owners.length <= 100
      && owners.every(id => typeof id === 'string' && id.trim() === id && id.length > 0 && id.length <= 200 && id !== '*')
      && new Set(owners).size === owners.length && owners.includes(subject);
  } catch { return false; }
}
const role = (value: unknown): value is TenantRole => value === 'operator' || value === 'admin';
const unavailable = () => new Error('Operator authority unavailable');
function memberRow(r: Record<string, unknown>): Membership {
  if (typeof r.account_id !== 'string' || !r.account_id || !isValidTenantId(r.tenant) || !role(r.role)
    || ![0, 1].includes(r.disabled as number) || ![0, 1].includes(r.removed as number) || typeof r.revision !== 'string' || !r.revision
    || !Number.isSafeInteger(r.updated_at)) throw unavailable();
  return { accountId: r.account_id, tenant: r.tenant, role: r.role, disabled: r.disabled === 1, removed: r.removed === 1,
    revision: r.revision, updatedAt: r.updated_at as number };
}
function credentialRow(r: Record<string, unknown>): ServiceCredential {
  if (typeof r.id !== 'string' || !r.id || typeof r.subject !== 'string' || !r.subject.trim()
    || !isValidTenantId(r.tenant) || !role(r.role) || typeof r.token_hash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(r.token_hash)
    || !Number.isSafeInteger(r.expires_at) || !Number.isSafeInteger(r.created_at) || typeof r.created_by !== 'string'
    || (r.revoked_at !== null && !Number.isSafeInteger(r.revoked_at))) throw unavailable();
  return { id: r.id, subject: r.subject, tenant: r.tenant, role: r.role, tokenHash: r.token_hash,
    expiresAt: r.expires_at as number, createdAt: r.created_at as number, createdBy: r.created_by, revokedAt: r.revoked_at as number | null };
}
type AuthorityDB = Pick<D1Database, 'prepare' | 'batch'>;
/** Writes recheck the actor's human session/account and tenant admin revision in
 * the same native transaction as the target change and its audit. */
export function d1Authority(db: AuthorityDB, validateActor?: (actor: AuthorityActor) => Promise<void>): AuthorityStore {
  const q = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  const gate = (a: AuthorityActor, at: number, ownerOnly = false) => { const f = federationGate(a.sid, a.federation); return ({
    sql: `EXISTS (SELECT 1 FROM operator_accounts a JOIN operator_sessions s ON s.account_id=a.id
      WHERE a.id=? AND a.updated_at=? AND a.disabled=0 AND a.must_change_password=0 AND s.jti=? AND s.expires_at>? AND ${f.sql})
      AND (?=1 ${ownerOnly ? '' : "OR EXISTS (SELECT 1 FROM operator_memberships WHERE account_id=? AND tenant=? AND role='admin' AND disabled=0 AND removed=0 AND revision=?)"})`,
    args: [a.id, a.accountRevision, a.sid, at, ...f.args, a.owner ? 1 : 0,
      ...(ownerOnly ? [] : [a.id, a.tenant, a.membershipRevision ?? ''])],
  }); };
  const batch = async (statements: D1PreparedStatement[], mutation: number) => {
    const results = await db.batch(statements);
    if (results.length !== statements.length || results.some(r => r.success !== true || !Number.isInteger(r.meta?.changes))) throw unavailable();
    if (results.some(r => r.meta.changes !== results[mutation]!.meta.changes)) throw unavailable();
    return results[mutation]!.meta.changes === 1;
  };
  const audit = (a: AuthorityActor, at: number, action: string, target: string, condition: string, args: unknown[]) =>
    q(`INSERT INTO operator_audit (at,action,actor_id,target_id,tenant,detail)
      SELECT ?,?,?,?,?,'{}' WHERE ${condition}`, at, action, a.id, target, a.tenant, ...args);
  const readMembers = async (condition: string, ...args: unknown[]) => {
    const r = await q(`SELECT * FROM operator_memberships WHERE ${condition} ORDER BY account_id,tenant LIMIT 201`, ...args).all<Record<string, unknown>>();
    if (r.success !== true || !Array.isArray(r.results) || r.results.length > 200) throw unavailable();
    return r.results.map(memberRow);
  };
  const serviceCondition = (r: ServiceCredential) => ({ sql: `id=? AND subject=? AND tenant=? AND role=? AND token_hash=?
    AND expires_at=? AND created_at=? AND created_by=? AND revoked_at IS NULL`,
  args: [r.id, r.subject, r.tenant, r.role, r.tokenHash, r.expiresAt, r.createdAt, r.createdBy] });
  return {
    async grants(id) { return (await readMembers('account_id=? AND disabled=0 AND removed=0', id)).map(({ tenant, role, revision }) => ({ tenant, role, revision })); },
    async members(tenant, after = '') {
      const r = await q('SELECT * FROM operator_memberships WHERE tenant=? AND account_id>? ORDER BY account_id LIMIT 101', tenant, after).all<Record<string, unknown>>();
      if (r.success !== true || !Array.isArray(r.results) || r.results.length > 101) throw unavailable();
      const rows = r.results.map(memberRow), items = rows.slice(0, 100);
      return { items, next: rows.length > 100 ? items.at(-1)!.accountId : null };
    },
    async member(id, tenant) { const row = await q('SELECT * FROM operator_memberships WHERE account_id=? AND tenant=?', id, tenant).first<Record<string, unknown>>(); return row ? memberRow(row) : null; },
    async changeMember(expected, next, a, at) {
      await validateActor?.(a);
      const target = next ?? expected;
      if (!target || target.tenant !== a.tenant || (expected && next && (expected.accountId !== next.accountId || expected.tenant !== next.tenant))) return false;
      const g = gate(a, at), identity = [target.accountId, target.tenant];
      const match = expected ? 'EXISTS (SELECT 1 FROM operator_memberships WHERE account_id=? AND tenant=? AND revision=?)'
        : 'NOT EXISTS (SELECT 1 FROM operator_memberships WHERE account_id=? AND tenant=?)';
      const condition = `${g.sql} AND ${match} AND EXISTS (SELECT 1 FROM operator_accounts WHERE id=?)`;
      const args = [...g.args, ...identity, ...(expected ? [expected.revision] : []), target.accountId];
      // Retain the generation after removal: a delayed expected-null create
      // cannot turn a completed remove into a fresh grant. Regrant names it.
      const mutation = !next ? q(`UPDATE operator_memberships SET removed=1,disabled=1,revision=?,updated_at=? WHERE account_id=? AND tenant=? AND ${condition}`,
        crypto.randomUUID(), at, ...identity, ...args)
        : expected ? q(`UPDATE operator_memberships SET role=?,disabled=?,removed=?,revision=?,updated_at=? WHERE account_id=? AND tenant=? AND ${condition}`,
          next.role, next.disabled ? 1 : 0, next.removed ? 1 : 0, next.revision, at, ...identity, ...args)
          : q(`INSERT INTO operator_memberships (account_id,tenant,role,disabled,revision,updated_at)
            SELECT ?,?,?,?,?,? WHERE ${condition} ON CONFLICT DO NOTHING`, ...identity, next.role, next.disabled ? 1 : 0, next.revision, at, ...args);
      return batch([audit(a, at, next ? 'membership_changed' : 'membership_removed', target.accountId, condition, args), mutation], 1);
    },
    async credential(id) { const r = await q('SELECT * FROM operator_service_credentials WHERE id=?', id).first<Record<string, unknown>>(); return r ? credentialRow(r) : null; },
    async credentials(tenant, after = '') {
      const r = await q('SELECT * FROM operator_service_credentials WHERE tenant=? AND id>? ORDER BY id LIMIT 101', tenant, after).all<Record<string, unknown>>();
      if (r.success !== true || !Array.isArray(r.results) || r.results.length > 101) throw unavailable();
      const rows = r.results.map(credentialRow), items = rows.slice(0, 100);
      return { items, next: rows.length > 100 ? items.at(-1)!.id : null };
    },
    async issue(row, a, replaces) {
      await validateActor?.(a);
      if (!a.owner || row.tenant !== a.tenant || row.createdBy !== a.id || row.revokedAt !== null
        || (replaces && (replaces.tenant !== a.tenant || replaces.revokedAt !== null || replaces.id === row.id))) return false;
      const g = gate(a, row.createdAt, true), old = replaces && serviceCondition(replaces);
      const condition = `${g.sql} AND NOT EXISTS (SELECT 1 FROM operator_service_credentials WHERE id=?)`
        + (old ? ` AND EXISTS (SELECT 1 FROM operator_service_credentials WHERE ${old.sql})` : '');
      const args = [...g.args, row.id, ...(old?.args ?? [])];
      const statements = [audit(a, row.createdAt, replaces ? 'service_replaced' : 'service_issued', row.id, condition, args),
        q(`INSERT INTO operator_service_credentials (id,subject,tenant,role,token_hash,expires_at,created_at,created_by,revoked_at)
          SELECT ?,?,?,?,?,?,?,?,NULL WHERE (${condition}) OR EXISTS (SELECT 1 FROM operator_service_credentials WHERE id=?)`, row.id, row.subject, row.tenant, row.role, row.tokenHash,
          row.expiresAt, row.createdAt, row.createdBy, ...args, row.id)];
      if (old) statements.push(q(`UPDATE operator_service_credentials SET revoked_at=? WHERE ${old.sql}
        AND EXISTS (SELECT 1 FROM operator_service_credentials WHERE id=? AND token_hash=?)`, row.createdAt, ...old.args, row.id, row.tokenHash));
      return batch(statements, 1);
    },
    async revoke(row, a, at) {
      await validateActor?.(a);
      if (!a.owner || row.tenant !== a.tenant || row.revokedAt !== null) return false;
      const g = gate(a, at, true), old = serviceCondition(row);
      const condition = `${g.sql} AND EXISTS (SELECT 1 FROM operator_service_credentials WHERE ${old.sql})`, args = [...g.args, ...old.args];
      return batch([audit(a, at, 'service_revoked', row.id, condition, args),
        q(`UPDATE operator_service_credentials SET revoked_at=? WHERE ${old.sql} AND ${g.sql}`, at, ...old.args, ...g.args)], 1);
    },
  };
}

export const authorityFor = (env: Env): AuthorityStore => env.AUTHORITY ?? d1Authority(env.DB, async actor => {
  if (!actor.sid.startsWith('oidc.')) return;
  const store = storeFor(env), user = await store.getById(actor.id), session = await store.getSession(actor.sid);
  if (!user || !session || (user.updatedAt ?? 0) !== actor.accountRevision) throw unavailable();
  await assertFederationSession(env, user, session, 'oidc');
});

/** Synthetic-only equivalent; native D1 tests exercise transaction guarantees. */
export function memoryAuthority(accounts: AccountStore): AuthorityStore & { memberships: Map<string, Membership>; services: Map<string, ServiceCredential> } {
  const memberships = new Map<string, Membership>(), services = new Map<string, ServiceCredential>();
  const key = (id: string, tenant: string) => JSON.stringify([id, tenant]);
  const clone = <T>(value: T): T => structuredClone(value);
  const admit = async (a: AuthorityActor, at: number, ownerOnly = false) => {
    const s = await accounts.getSession(a.sid), u = await accounts.getById(a.id), m = memberships.get(key(a.id, a.tenant));
    return Boolean(s && s.accountId === a.id && s.expiresAt > at && u && !u.disabled && !u.must_change_password
      && (u.updatedAt ?? 0) === a.accountRevision && (a.owner || (!ownerOnly && m && !m.disabled && !m.removed && m.role === 'admin' && m.revision === a.membershipRevision)));
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return {
    memberships, services,
    async grants(id) { return [...memberships.values()].filter(m => m.accountId === id && !m.disabled && !m.removed).map(({ tenant, role, revision }) => ({ tenant, role, revision })); },
    async members(tenant, after = '') {
      const rows = [...memberships.values()].filter(m => m.tenant === tenant && m.accountId > after).sort((a, b) => a.accountId < b.accountId ? -1 : 1);
      return { items: clone(rows.slice(0, 100)), next: rows.length > 100 ? rows[99]!.accountId : null };
    },
    async member(id, tenant) { return clone(memberships.get(key(id, tenant)) ?? null); },
    async changeMember(expected, next, a, at) {
      const target = next ?? expected;
      if (!target || target.tenant !== a.tenant || !await admit(a, at) || !await accounts.getById(target.accountId)) return false;
      const k = key(target.accountId, target.tenant);
      if (!same(memberships.get(k) ?? null, expected)) return false;
      memberships.set(k, next ? clone(next) : { ...target, removed: true, disabled: true, revision: crypto.randomUUID(), updatedAt: at });
      return true;
    },
    async credential(id) { return clone(services.get(id) ?? null); },
    async credentials(tenant, after = '') {
      const rows = [...services.values()].filter(s => s.tenant === tenant && s.id > after).sort((a, b) => a.id < b.id ? -1 : 1);
      return { items: clone(rows.slice(0, 100)), next: rows.length > 100 ? rows[99]!.id : null };
    },
    async issue(row, a, replaces) {
      if (!a.owner || row.tenant !== a.tenant || row.revokedAt !== null || !await admit(a, row.createdAt, true) || services.has(row.id)
        || (replaces && (replaces.revokedAt !== null || replaces.tenant !== a.tenant || !same(services.get(replaces.id), replaces)))) return false;
      services.set(row.id, clone(row)); if (replaces) services.set(replaces.id, { ...replaces, revokedAt: row.createdAt }); return true;
    },
    async revoke(row, a, at) {
      if (!a.owner || row.tenant !== a.tenant || row.revokedAt !== null || !await admit(a, at, true) || !same(services.get(row.id), row)) return false;
      services.set(row.id, { ...row, revokedAt: at }); return true;
    },
  };
}
