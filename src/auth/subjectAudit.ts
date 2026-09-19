import type { Context } from 'hono';
import type { Env } from '@/types/env';
import type { TenantVariables } from '@/tenancy/tenant';
import type { AuthContext } from '@/middleware/auth';
import { hasOperatorGrant } from '@/middleware/operatorAuth';
import { storeFor } from './accounts';
import { SUBJECT_AUDIT_ROUTES, type SubjectAuditDetail, type SubjectAuditOperation } from './store';
import { SUBJECT_OPERATION_ROUTES, operationResultSchema, type SubjectOperation, type OperationAuditDetail, type OperationAuditResult } from './store';
import { historySkipReasonSchema, type HistoryAuditResultMember } from './store';
import { z } from 'zod';
import { isShopperId } from '@/identity/shopperId';
import { authorityFor, stampOwner } from './authority';
import { assertFederationSession } from './oidc';

async function currentFederation(c: AuditContext): Promise<void> {
  const auth = c.get('auth'), user = auth?.user;
  const federated = user?.sid?.startsWith('oidc.') || user?.authMethod === 'oidc';
  // Service credentials and explicitly configured demo grants keep their separate
  // authority. Customer human grants must remain current across every audit wait.
  if (!federated && (c.env.DEPLOYMENT_PROFILE !== 'customer' || auth?.authority?.credentialId)) return;
  if (!auth?.isAuthenticated || user?.type !== 'access' || !user.sub || !user.sid) throw new Error('Current human authority unavailable');
  const store = storeFor(c.env), account = await store.getById(user!.sub), session = await store.getSession(user!.sid!);
  if (!account || account.disabled || account.must_change_password || (c.env.DEPLOYMENT_PROFILE === 'customer' && (account.updatedAt ?? 0) !== auth.authority?.accountRevision)
    || !session || session.accountId !== account.id || session.expiresAt <= Date.now()
    || !Number.isSafeInteger(user.exp) || user.exp! * 1000 <= Date.now()) throw new Error('Current human authority unavailable');
  if (c.env.DEPLOYMENT_PROFILE === 'customer') {
    const tenant = c.get('tenant'), grant = auth.authority?.grants?.find(g => g.tenant === tenant);
    const member = await authorityFor(c.env).member(account.id, tenant);
    if (!grant || !member || member.disabled || member.removed || member.revision !== grant.revision || member.role !== grant.role) throw new Error('Current tenant authority unavailable');
  }
  await assertFederationSession(c.env, account, session, user.authMethod);
}

export async function recoveryHuman(c: AuditContext, tenant: string | null): Promise<void> {
  const auth = c.get('auth'), user = auth?.user;
  if (!auth?.isAuthenticated || user?.type !== 'access' || !user.sub || !user.sid || auth.authority?.credentialId) throw new Error('Human recovery authority required');
  const store = storeFor(c.env), account = await store.getById(user.sub), session = await store.getSession(user.sid);
  if (!account || account.disabled || account.must_change_password || (account.updatedAt ?? 0) !== auth.authority?.accountRevision
    || !session || session.accountId !== account.id || session.expiresAt <= Date.now()) throw new Error('Current human recovery authority unavailable');
  await assertFederationSession(c.env, account, session, user.authMethod);
  if (tenant === null) { if (!stampOwner(c.env, account.id)) throw new Error('Stamp owner required'); }
  else {
    if (c.get('tenant') !== tenant) throw new Error('Recovery tenant mismatch');
    const member = await authorityFor(c.env).member(account.id, tenant);
    if (!member || member.disabled || member.removed || member.role !== 'admin') throw new Error('Tenant admin required');
  }
  if (!Number.isSafeInteger(user.exp) || user.exp! * 1000 <= Date.now() || session.expiresAt <= Date.now()) throw new Error('Human recovery authority expired');
}

export async function auditedRecovery(c: AuditContext, tenant: string | null, operation: 'list' | 'status' | 'redrive' | 'resolve',
  selector: { caseId?: string; digest?: string; revision?: number }, run: () => Promise<Response>): Promise<Response> {
  const requestId = crypto.randomUUID(); let entered = false;
  c.header('Cache-Control', 'no-store');
  try {
    await recoveryHuman(c, tenant);
    const phase = async (name: 'admitted' | 'result', response?: Response) => {
      await recoveryHuman(c, tenant);
      await storeFor(c.env).audit({ at: Date.now(), action: 'ledger_recovery', actorId: c.get('auth').user!.sub,
        ...(tenant === null ? {} : { tenant }), detail: JSON.stringify({ v: 1, requestId, operation, route: '/operator/ledger-recovery',
          phase: name, ...selector, ...(response ? { status: response.status, outcome: response.ok ? 'recorded' : 'outcome_unknown' } : {}) }) });
      await recoveryHuman(c, tenant);
    };
    await phase('admitted'); entered = true;
    let response: Response;
    try { response = await run(); } catch { response = c.json({ ok: false, error: 'Recovery operation unavailable', outcome: 'outcome_unknown' }, 503); }
    await phase('result', response);
    return response;
  } catch { return c.json({ ok: false, error: 'Recovery audit/authority unavailable', requestId,
    outcome: 'outcome_unknown', operationMayHaveApplied: entered && (operation === 'redrive' || operation === 'resolve') }, 503); }
}

type AuditContext = Context<{ Bindings: Env; Variables: TenantVariables & { auth: AuthContext } }>;

export async function auditedLearningRecovery(c: AuditContext, tenant: string, operation: 'status' | 'repair', kind: 'stats' | 'ring',
  target: string, selector: { digest?: string; generation?: number }, run: () => Promise<Response>): Promise<Response> {
  const requestId = crypto.randomUUID(); let entered = false;
  c.header('Cache-Control', 'no-store');
  try {
    await recoveryHuman(c, tenant);
    const salt = c.env.IDENTITY_SALT; if (!salt?.trim()) throw new Error('Audit reference unavailable');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(['learning-recovery', 1, tenant, kind, target])));
    const targetRef = [...new Uint8Array(signature)].map(x => x.toString(16).padStart(2, '0')).join('');
    const phase = async (phase: 'admitted' | 'result', status?: number) => {
      await recoveryHuman(c, tenant);
      await storeFor(c.env).audit({ at: Date.now(), action: 'learning_recovery', tenant, actorId: c.get('auth').user!.sub,
        detail: JSON.stringify({ v: 1, requestId, operation, kind, targetRef, phase, ...selector, ...(status === undefined ? {} : { status }) }) });
      await recoveryHuman(c, tenant);
    };
    await phase('admitted');
    await recoveryHuman(c, tenant); entered = true;
    let response: Response;
    try { response = await run(); } catch { response = c.json({ ok: false, error: 'Learning recovery unavailable', outcome: 'outcome_unknown' }, 503); }
    await phase('result', response.status); return response;
  } catch { return c.json({ ok: false, error: 'Learning recovery authority/audit unavailable', requestId,
    operationMayHaveApplied: entered && operation === 'repair' }, 503); }
}
type SubjectBinder = (subject: string) => Promise<void>;
const unavailable = (c: AuditContext) => c.json({ ok: false, error: 'Subject audit unavailable' }, 503);

/** Admission precedes protected reads; result precedes release, not proof of client delivery. */
export async function auditedSubjectRead(c: AuditContext, tenant: string, operation: SubjectAuditOperation,
  selector: string | undefined, read: (bindSubject: SubjectBinder) => Promise<Response>, mandatory = false): Promise<Response> {
  if (!mandatory && c.env.AUTH_MODE !== 'enforced') return read(async () => undefined);
  c.header('Cache-Control', 'no-store');
  try {
    const actorId = c.get('auth')?.user?.sub, salt = c.env.IDENTITY_SALT;
    if (!actorId?.trim() || actorId.length > 200 || c.get('tenant') !== tenant || !hasOperatorGrant(c.env, actorId, tenant, c.get('auth'))
      || typeof salt !== 'string' || !salt.trim()) return unavailable(c);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const reference = async (kind: 'visitor' | 'record', value: string) => {
      const material = JSON.stringify(['operator-subject-read', 1, tenant, kind, value]);
      return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(material)))].map(b => b.toString(16).padStart(2, '0')).join('');
    };
    const kind = operation === 'recent' || operation === 'receipts' ? 'visitor' : operation === 'ledger' || operation === 'replay' ? 'record' : 'tenant';
    if (kind !== 'tenant' && (typeof selector !== 'string' || !selector || selector.length > 2048)) return unavailable(c);
    const detail: SubjectAuditDetail = { v: 1, requestId: crypto.randomUUID(), operation, route: SUBJECT_AUDIT_ROUTES[operation], phase: 'admitted',
      selector: kind === 'tenant' ? { kind } : { kind, ref: await reference(kind, selector!) } };
    const store = storeFor(c.env);
    await currentFederation(c);
    await store.audit({ at: Date.now(), action: 'subject_read', tenant, actorId, detail: JSON.stringify(detail) });
    await currentFederation(c);
    let subjectRef: string | undefined, response: Response;
    try {
      response = await read(async subject => {
        if (!/^[A-Za-z0-9_.-]{1,200}$/.test(subject)) throw new Error('Subject unavailable');
        subjectRef = await reference('visitor', subject);
      });
    } catch { response = c.json({ ok: false, error: 'Requested data unavailable' }, 503); }
    await currentFederation(c);
    await store.audit({ at: Date.now(), action: 'subject_read', tenant, actorId,
      detail: JSON.stringify({ ...detail, phase: 'result', status: response.status, ...(subjectRef ? { subjectRef } : {}) }) });
    await currentFederation(c);
    return response;
  } catch { return unavailable(c); }
}

type OperationSelector = { kind: 'visitor' | 'shopper'; value: string } | { kind: 'identity'; visitorId?: string; shopperId?: string }
  | { kind: 'tenant' } | { kind: 'accounts'; values: string[] }
  | { kind: 'history'; format: 'json' | 'csv'; rows: Array<{ kind?: 'profile'; accountId?: string; shopperId?: string; visitorId?: string; action?: string }> };
interface OperationReport {
  result(value: OperationAuditResult): void;
  subject(value: string): Promise<void>;
  resolved(shoppers: string[]): Promise<void>;
  imported(receipt: unknown): Promise<void>;
}
const importCount = z.number().int().min(0).max(1000);
const importReceipt = z.object({ received: importCount, applied: importCount, shoppers: importCount,
  skipped: z.array(z.object({ index: importCount, reason: z.string() })).max(1000),
  perShopper: z.array(z.object({ shopperId: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/), rows: importCount.refine(n => n > 0) })).max(1000),
});
const fixedHistoryReasons: Record<string, z.infer<typeof historySkipReasonSchema>> = {
  'shopperId is not a shopper id': 'invalid_shopper', 'visitorId is not a visitor id': 'invalid_visitor', 'no shopper': 'no_subject',
  'event is at or before subject erasure': 'erased', 'identity selectors disagree': 'selector_conflict',
  'no registry attribute on the row': 'no_registry_touch',
  // W16 C8.11 (R64, R76): the row the tenant's own published catalogue refused.
  // The operator's receipt and the auditor's record read ONE vocabulary, so the
  // audited token is the same word the import report answers with.
  out_of_vocabulary: 'out_of_vocabulary',
  profile_missing: 'profile_missing', consent_missing: 'consent_missing',
  consent_refused: 'consent_refused', stale_profile: 'stale_profile', replayed_profile: 'replayed_profile',
};
/** One acknowledged SQL statement per phase, including a 1000-account resolve. */
export async function auditedSubjectOperation(c: AuditContext, tenant: string, operation: SubjectOperation, selector: OperationSelector,
  run: (report: OperationReport) => Promise<Response>): Promise<Response> {
  const enforced = c.env.AUTH_MODE === 'enforced', requestId = crypto.randomUUID();
  const mutation = operation === 'identity_erase' || operation === 'ledger_erase' || operation === 'ledger_rewrite' || operation === 'identity_import';
  let entered = false;
  c.header('Cache-Control', 'no-store');
  const refusal = (auditStatus: 'unavailable' | 'unconfirmed') => c.json({ ok: false, error: 'Subject audit unavailable', requestId, auditStatus,
    ...(mutation ? { outcome: 'outcome_unknown', operationMayHaveApplied: entered } : {}) }, 503);
  try {
    const actorId = c.get('auth')?.user?.sub, salt = c.env.IDENTITY_SALT;
    if (enforced && (!actorId?.trim() || actorId.length > 200 || c.get('tenant') !== tenant || !hasOperatorGrant(c.env, actorId, tenant, c.get('auth'))
      || typeof salt !== 'string' || !salt.trim())) return refusal('unavailable');
    const key = enforced ? await crypto.subtle.importKey('raw', new TextEncoder().encode(salt!.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) : null;
    const reference = async (kind: string, value: string) => {
      if (!key) return '';
      const material = JSON.stringify(['operator-subject-operation', 2, tenant, kind, value]);
      return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(material)))].map(b => b.toString(16).padStart(2, '0')).join('');
    };
    let selectors: OperationAuditDetail['selector'][];
    if (selector.kind === 'history') {
      if (operation !== 'identity_import' || !['json', 'csv'].includes(selector.format) || !selector.rows.length || selector.rows.length > 1000) throw new Error('Invalid selector');
      const members = await Promise.all(selector.rows.map(async (row, ordinal) => {
        for (const name of ['accountId', 'shopperId', 'visitorId'] as const) {
          const value = row[name];
          if (value !== undefined && (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > (name === 'shopperId' ? 64 : 200))) throw new Error('Invalid selector');
        }
        if (!row.accountId && !row.shopperId && !row.visitorId) throw new Error('Invalid selector');
        return { ordinal, rowKind: row.kind === 'profile' ? 'profile' as const : 'behavioral' as const,
          ...(row.accountId ? { accountRef: await reference('account', row.accountId) } : {}),
          ...(row.shopperId ? { shopperRef: await reference('shopper', row.shopperId) } : {}),
          ...(row.visitorId ? { visitorRef: await reference('visitor', row.visitorId) } : {}) };
      }));
      selectors = Array.from({ length: Math.ceil(members.length / 5) }, (_, chunk) => ({ kind: 'history_inputs', format: selector.format,
        total: members.length, chunk, members: members.slice(chunk * 5, chunk * 5 + 5) }));
    } else if (selector.kind === 'accounts') {
      if (!selector.values.length || selector.values.length > 1000 || selector.values.some(v => typeof v !== 'string' || !v.trim() || v.trim().length > 200)) throw new Error('Invalid selector');
      const members = await Promise.all(selector.values.map(async (value, ordinal) => ({ ordinal, accountRef: await reference('account', value.trim()) })));
      selectors = Array.from({ length: Math.ceil(members.length / 10) }, (_, chunk) => ({ kind: 'accounts', total: members.length, chunk, members: members.slice(chunk * 10, chunk * 10 + 10) }));
    } else if (selector.kind === 'identity') {
      if (!selector.visitorId && !selector.shopperId) throw new Error('Invalid selector');
      for (const value of [selector.visitorId, selector.shopperId]) if (value !== undefined && !/^[A-Za-z0-9_.-]{1,200}$/.test(value)) throw new Error('Invalid selector');
      selectors = [{ kind: 'identity', ...(selector.visitorId ? { visitorRef: await reference('visitor', selector.visitorId) } : {}),
        ...(selector.shopperId ? { shopperRef: await reference('shopper', selector.shopperId) } : {}) }];
    } else if (selector.kind === 'tenant') selectors = [{ kind: 'tenant' }];
    else {
      if (!/^[A-Za-z0-9_.-]{1,200}$/.test(selector.value)) throw new Error('Invalid selector');
      selectors = [{ kind: selector.kind, ref: await reference(selector.kind, selector.value) }];
    }
    const method = c.req.method as OperationAuditDetail['method'];
    const phase = async (name: 'admitted' | 'result', status?: number, result?: OperationAuditResult, subjectRef?: string) => {
      if (!enforced) return;
      await currentFederation(c);
      const at = Date.now();
      await storeFor(c.env).auditOperations(selectors.map(s => ({ at, action: 'subject_operation', tenant, actorId,
        detail: JSON.stringify({ v: 2, requestId, operation, route: SUBJECT_OPERATION_ROUTES[operation], method, phase: name, selector: s,
          ...(name === 'result' ? { status, result, ...(subjectRef ? { subjectRef } : {}) } : {}) }) })));
      await currentFederation(c);
    };
    await phase('admitted');
    let result: OperationAuditResult | undefined, subjectRef: string | undefined, response: Response;
    try {
      entered = true;
      response = await run({
        result(value) { result = operationResultSchema.parse(value); },
        async subject(value) {
          if (!/^sh_[a-f0-9]{32}$/.test(value)) throw new Error('Invalid subject');
          subjectRef = await reference('shopper', value);
        },
        async resolved(shoppers) {
          if (selector.kind !== 'accounts' || shoppers.length !== selector.values.length || shoppers.some(v => !/^sh_[a-f0-9]{32}$/.test(v))) throw new Error('Invalid resolution');
          const refs = await Promise.all(shoppers.map(v => reference('shopper', v)));
          selectors = selectors.map(s => s.kind === 'accounts' ? { ...s, members: s.members.map(m => ({ ...m, shopperRef: refs[m.ordinal]! })) } : s);
          result = { outcome: 'resolved' };
        },
        async imported(receipt) {
          if (selector.kind !== 'history') throw new Error('Invalid import result');
          const r = importReceipt.parse(receipt);
          if (r.received !== selector.rows.length || r.applied + r.skipped.length !== r.received || r.shoppers !== r.perShopper.length
            || r.perShopper.reduce((sum, target) => sum + target.rows, 0) !== r.applied
            || new Set(r.perShopper.map(target => target.shopperId)).size !== r.shoppers
            || r.skipped.some((s, i) => s.index >= r.received || (i > 0 && s.index <= r.skipped[i - 1]!.index))) throw new Error('Invalid import result');
          const members: HistoryAuditResultMember[] = await Promise.all(r.perShopper.map(async target => {
            const subjectKind = isShopperId(target.shopperId) ? 'shopper' as const : 'visitor' as const;
            return { kind: 'subject' as const, subjectKind, subjectRef: await reference(subjectKind, target.shopperId), rows: target.rows };
          }));
          for (const skip of r.skipped) {
            const row = selector.rows[skip.index]!;
            const reason = Object.hasOwn(fixedHistoryReasons, skip.reason) ? fixedHistoryReasons[skip.reason]
              : row.kind !== 'profile' && typeof row.action === 'string' && skip.reason === `action "${row.action}" has no weight` ? 'unweighted_action' : undefined;
            members.push({ kind: 'skipped', ordinal: skip.index, reason: historySkipReasonSchema.parse(reason) });
          }
          result = operationResultSchema.parse({ outcome: 'identity_import', received: r.received, applied: r.applied, skipped: r.skipped.length, shoppers: r.shoppers });
          selectors = Array.from({ length: Math.ceil(members.length / 10) }, (_, chunk) => ({ kind: 'history_results', format: selector.format,
            total: r.received, chunk, members: members.slice(chunk * 10, chunk * 10 + 10) }));
        },
      });
      if (!result) throw new Error('Missing operation result');
      // Validate the operation-specific terminal shape before attempting its write.
      if (result.outcome !== (mutation ? operation : operation === 'identity_resolve' ? 'resolved' : 'read')) throw new Error('Invalid operation result');
    } catch {
      result = { outcome: 'outcome_unknown', operationMayHaveApplied: mutation }; subjectRef = undefined;
      selectors = selector.kind === 'history' ? [{ kind: 'history_unknown', format: selector.format, total: selector.rows.length }]
        : selectors.map(s => s.kind === 'accounts' ? { ...s, members: s.members.map(({ ordinal, accountRef }) => ({ ordinal, accountRef })) } : s);
      response = c.json({ ok: false, error: 'Operation outcome unavailable', requestId, outcome: 'outcome_unknown', operationMayHaveApplied: mutation,
        auditStatus: enforced ? 'recorded' : 'not_recorded' }, 503);
    }
    await phase('result', response.status, result, subjectRef);
    return response;
  } catch { return refusal(entered ? 'unconfirmed' : 'unavailable'); }
}
