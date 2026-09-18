import { AsyncLocalStorage } from 'node:async_hooks';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { shopperObject, shopperObjectName } from '@/tenancy/objects';
import { tenantMiddleware } from '@/tenancy/middleware';
import { errorHandler } from '@/middleware/error';
import type { KVLike } from '@/tenancy/tenant';
import { assertSessionTarget, SessionAccessError, type SessionCapability } from './sessionCapability';
import { consentDeadline, storedConsent, type Consent } from '@/content/consent';
import { tenantConfig } from '@/tenancy/middleware';
import type { CapturedMessage } from '@/ledger/records';
import type { Delivery, DeliveryCaptureReceipt } from '@/ledger/delivery';
import { MANAGED_BYTES, deliveryClaimSubset, validDeliveryCaptureReceipt } from '@/ledger/delivery';
import { isShopperId } from './shopperId';
import { requireRetention, readRetention, mergeExternalRetention, type ExternalRetention, type RetentionStamp, type RetentionCategory, type RetentionEnv } from '@/retention';
import type { RecoveryInput, RecoveryReceipt } from '@/ledger/recovery';

interface Invocation {
  owner: object;
  env: Env;
  active: boolean;
  pending: Promise<unknown>[];
  requests: WeakMap<Request, SessionCapability>;
  principals: Map<string, SessionCapability>;
  sessions?: KVLike;
  effectEnv?: Env;
  relay?: (operation: string, subject: string, tenant: string, body: unknown) => Promise<Response>;
  consent?: () => Promise<Consent>;
  restrictConsent?: (hints: Consent) => Promise<Consent>;
  consentGuards: Array<{ consent: Consent; purpose: 'tracking' | 'personalization' }>;
  ledgerOwners?: string[];
  retentionGuards?: Array<{ env: RetentionEnv; stamp: RetentionStamp }>;
  externalRetention?: ExternalRetention;
  eventRetention?: (id: string, digest: string, occurredAt: number) => Promise<ExternalRetention>;
  recovery?: (input: RecoveryInput, principal: SessionCapability) => Promise<RecoveryReceipt>;
  recoveryDeadlines?: number[];
}
// Async descendants share a lifetime, not an ambient reusable authorization bit.
const invocation = new AsyncLocalStorage<Invocation>();

export type LedgerOwnerOperation =
  | { kind: 'quarantine'; value: import('@/ledger/quarantine').QuarantineCase; wire: string }
  | { kind: 'survivors'; value: import('@/ledger/quarantine').QuarantineCase }
  | { kind: 'consume'; bodies: unknown[]; now: number; preparedClaims?: Record<string, string>; recovery?: boolean; recoveryDeadline?: number }
  | { kind: 'managed'; deliveries: Delivery[]; preparedClaims?: Record<string, string> }
  | { kind: 'batch'; messages: CapturedMessage[]; batchId: string }
  | { kind: 'rewrite'; tenant: string; subjects: string[]; options: { now?: number; retentionDays?: number; maxObjects?: number } }
  | { kind: 'erase'; tenant: string; subject: string; actor: string; now: number };
export type LedgerOwner = { tenant: string; subject: string };
const ledgerOwnerKey = (o: LedgerOwner) => `${o.tenant}:${o.subject}`;
export const LEDGER_OWNER_LIMIT = 8;
export const LEDGER_OPERATION_BYTES = 8 * 1024 * 1024;
// Cohorting preference is not the indivisible sink limit. Per-row RPC wrappers
// fit within the existing mandatory managed-row provenance allowance; reserve
// a second data-sized allowance plus fixed framing for exact claim witnesses.
export const LEDGER_OPERATION_HARD_BYTES = 2 * MANAGED_BYTES + 4096;
/** Include the real RPC envelope and the largest representable hop index. */
export const ledgerOperationBytes = (operation: LedgerOwnerOperation): number => new TextEncoder().encode(JSON.stringify({ operation, index: Number.MAX_SAFE_INTEGER })).byteLength;

/** The entire immutable envelope stays intact through a sorted owner chain.
 * Every preceding owner holds its existing serializer until the last owner
 * finishes the actual storage operation; no check-then-write RPC or callback. */
export async function ledgerOperationOwners(env: Env, operation: LedgerOwnerOperation): Promise<LedgerOwner[]> {
  const tenants = tenantConfig(env).provisioned;
  const { expandLedgerMessage, isCapturedMessage } = await import('@/ledger/writer');
  const { readDelivery } = await import('@/ledger/delivery');
  const owners = new Map<string, LedgerOwner>();
  const add = (tenant: unknown, subject: unknown) => {
    if (typeof tenant !== 'string' || !tenants.includes(tenant) || typeof subject !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(subject)) throw new SessionAccessError();
    const value = { tenant, subject }; owners.set(ledgerOwnerKey(value), value);
  };
  if (operation.kind === 'survivors') {
    if (!operation.value.survivors?.rows.length) throw new SessionAccessError();
    for (const row of operation.value.survivors.rows) { const record = JSON.parse(row.wire); add(record.tenant, record.visitor_id); }
  } else if (operation.kind === 'quarantine') {
    if (typeof operation.wire !== 'string') throw new SessionAccessError();
    const messages = expandLedgerMessage(JSON.parse(operation.wire));
    if (!messages.length) throw new SessionAccessError();
    for (const message of messages) add(message.record.tenant, message.record.visitor_id);
  } else if (operation.kind === 'rewrite') {
    if (!Array.isArray(operation.subjects) || !operation.options || typeof operation.options !== 'object'
      || Object.keys(operation.options).some(key => !['now', 'retentionDays', 'maxObjects'].includes(key))
      || Object.values(operation.options).some(value => !Number.isSafeInteger(value) || value < 0)) throw new SessionAccessError();
    for (const subject of operation.subjects) add(operation.tenant, subject);
  } else if (operation.kind === 'erase') {
    if (typeof operation.actor !== 'string' || !operation.actor || !Number.isSafeInteger(operation.now)) throw new SessionAccessError();
    add(operation.tenant, operation.subject);
  } else if (operation.kind === 'consume') {
    if (!Array.isArray(operation.bodies) || !Number.isSafeInteger(operation.now)) throw new SessionAccessError();
    for (const body of operation.bodies) {
      // Invalid envelopes remain positional retries in the unchanged consumer.
      // Resolve only completely admitted envelopes, never a subset of one.
      const messages = expandLedgerMessage(body);
      if (!messages.length || messages.some(m => !tenants.includes(m.record.tenant))) continue;
      for (const message of messages) add(message.record.tenant, message.record.visitor_id);
    }
  } else if (operation.kind === 'managed') {
    if (!Array.isArray(operation.deliveries)) throw new SessionAccessError();
    for (const delivery of operation.deliveries) {
      if (!delivery || !Array.isArray(delivery.messages) || !delivery.messages.length) throw new SessionAccessError();
      const bodies = delivery.messages.map(m => m.type === 'decision' ? m.record : null);
      const wire = bodies.every(Boolean)
        ? { kind: 'ledger', type: 'decisions', version: 1, delivery_id: delivery.id, records: bodies }
        : delivery.messages.length === 1 ? { ...delivery.messages[0], version: 1, delivery_id: delivery.id } : null;
      if (!wire || JSON.stringify(readDelivery(wire).messages) !== JSON.stringify(delivery.messages)) throw new SessionAccessError();
      for (const message of delivery.messages) add(message.record.tenant, message.record.visitor_id);
    }
  } else if (operation.kind === 'batch') {
    if (!Array.isArray(operation.messages) || typeof operation.batchId !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(operation.batchId)) throw new SessionAccessError();
    for (const message of operation.messages) {
      if (!isCapturedMessage(message)) throw new SessionAccessError();
      add(message.record.tenant, message.record.visitor_id);
    }
  } else throw new SessionAccessError();
  // Existing link and exact erasure effects hold browser then canonical person.
  // All new multi-owner work must extend, never reverse, those established edges.
  const sorted = [...owners.values()].sort((a, b) => a.tenant.localeCompare(b.tenant)
    || Number(isShopperId(a.subject)) - Number(isShopperId(b.subject)) || a.subject.localeCompare(b.subject));
  return sorted;
}
export function ledgerOperationHeld(owners: readonly LedgerOwner[]): boolean {
  const held = invocation.getStore();
  if (!held?.active) return false;
  recheckOwnerInvocation(held.owner);
  const expected = owners.map(ledgerOwnerKey);
  if (held.ledgerOwners) return JSON.stringify(held.ledgerOwners) === JSON.stringify(expected);
  // A live route can only capture its own subject while already owner-held.
  // Refuse a nested multi-owner acquisition, which could reverse lock order.
  return owners.length === 1 && [...held.principals.values()].some(p => p.tenant === owners[0]!.tenant && p.subject === owners[0]!.subject);
}
export async function executeLedgerOperation(env: Env, operation: LedgerOwnerOperation): Promise<unknown> {
  if (operation.kind === 'survivors') return (await import('@/ledger/consume')).consumeSurvivors(currentOwnerEnvironment(env), operation.value);
  if (operation.kind === 'quarantine') return (await import('@/ledger/quarantine')).captureQuarantineHeld(currentOwnerEnvironment(env), operation.value, operation.wire);
  if (operation.kind === 'rewrite') return (await import('@/ledger/erasure')).rewriteErasures(env.STORAGE, operation.tenant, operation.options, operation.subjects);
  if (operation.kind === 'consume') return (await import('@/ledger/consume')).consumeLedger(env, operation.bodies, operation.now, operation.preparedClaims, operation.recovery, operation.recoveryDeadline);
  if (operation.kind === 'managed') {
    for (const delivery of operation.deliveries) for (const { record } of delivery.messages) pinRetention(env, record.retention?.ledger, record.tenant, 'ledger');
    return (await import('@/ledger/writer')).persistDeliveries(currentOwnerEnvironment(env).STORAGE, operation.deliveries, operation.preparedClaims);
  }
  if (operation.kind === 'batch') {
    const { loadTombstones, hidden } = await import('@/ledger/erasure');
    const { writeBatches } = await import('@/ledger/writer');
    const allowed: typeof operation.messages = [];
    for (const tenant of new Set(operation.messages.map(m => m.record.tenant))) {
      const barriers = await loadTombstones(env.STORAGE, tenant);
      allowed.push(...operation.messages.filter(m => m.record.tenant === tenant && !hidden(barriers, m.record)));
    }
    for (const { record } of allowed) pinRetention(env, record.retention?.ledger, record.tenant, 'ledger');
    return writeBatches(currentOwnerEnvironment(env).STORAGE, allowed, operation.batchId);
  }
  return (await import('@/ledger/erasure')).eraseVisitorLedger(env, operation.tenant, operation.subject, operation.actor, operation.now);
}
/** Necessary immutable assignment only: no raw effect, no owner authority and
 * no capture receipt. All current input/tenant/policy checks precede any claim. */
export async function prepareLedgerDeliveries(env: Env, deliveries: readonly Delivery[]): Promise<{ claims: Record<string, string>; ready: boolean[] }> {
  const frozen = JSON.parse(JSON.stringify(deliveries)) as Delivery[];
  await ledgerOperationOwners(env, { kind: 'managed', deliveries: frozen });
  const { loadTombstones, hidden } = await import('@/ledger/erasure');
  const tombs = new Map(await Promise.all([...new Set(frozen.flatMap(delivery => delivery.messages.map(message => message.record.tenant)))].map(async tenant =>
    [tenant, await loadTombstones(env.STORAGE, tenant)] as const)));
  const identities = new Map<string, string>(), conflicts = new Set<string>();
  for (const delivery of frozen) {
    const body = JSON.stringify(delivery.messages.map(message => ({ type: message.type, record: message.record })));
    if (identities.has(delivery.id) && identities.get(delivery.id) !== body) conflicts.add(delivery.id);
    identities.set(delivery.id, body);
  }
  const eligible = frozen.map(delivery => {
    if (conflicts.has(delivery.id)) return false;
    try { for (const { record } of delivery.messages) if (!hidden(tombs.get(record.tenant)!, record)) requireRetention(env, record.retention?.ledger, record.tenant, 'ledger'); return true; }
    catch { return false; }
  });
  const { prepareDeliveryClaims } = await import('@/ledger/writer');
  const positions = frozen.map((_, index) => index).filter(index => eligible[index]);
  if (!positions.length) return { claims: {}, ready: eligible };
  const result = await prepareDeliveryClaims(env.STORAGE, positions.map(index => frozen[index]!));
  return { claims: result.claims, ready: eligible.map((value, index) => value && result.ready[positions.indexOf(index)] === true) };
}
export async function ledgerUnderOwners<T>(env: Env, operation: LedgerOwnerOperation, dispatched?: () => void): Promise<T> {
  const bytes = JSON.stringify(operation);
  const frozen = JSON.parse(bytes) as LedgerOwnerOperation, owners = await ledgerOperationOwners(env, frozen);
  const checked = (result: unknown): T => {
    if (frozen.kind === 'managed' && !validDeliveryCaptureReceipt(result, frozen.deliveries.map(delivery => delivery.messages.length))) throw new SessionAccessError();
    return result as T;
  };
  // The transport cap is not a new limit on an already-held local operation.
  if (ledgerOperationHeld(owners)) { dispatched?.(); return checked(await executeLedgerOperation(env, frozen)); }
  // A captured closed invocation may never fall through into backend authority.
  if (invocation.getStore()) throw new SessionAccessError();
  if (frozen.kind === 'managed' && frozen.deliveries.length > 1
    && (owners.length > LEDGER_OWNER_LIMIT || ledgerOperationBytes(frozen) > LEDGER_OPERATION_BYTES)) {
    const { captureReceipt } = await import('@/ledger/delivery');
    const result: DeliveryCaptureReceipt = { ...captureReceipt(frozen.deliveries.reduce((sum, delivery) => sum + delivery.messages.length, 0)), dispositions: frozen.deliveries.map(() => 'retry') };
    const seen = new Map<string, string>(), conflicts = new Set<string>();
    for (const delivery of frozen.deliveries) {
      const payload = JSON.stringify(delivery.messages.map(message => ({ type: message.type, record: message.record })));
      if (seen.has(delivery.id) && seen.get(delivery.id) !== payload) conflicts.add(delivery.id);
      seen.set(delivery.id, payload);
    }
    if (conflicts.size) { result.ok = false; result.code = 'conflict'; }
    let prepared: Awaited<ReturnType<typeof prepareLedgerDeliveries>>;
    try { prepared = frozen.preparedClaims ? { claims: frozen.preparedClaims, ready: frozen.deliveries.map(() => true) }
      : await prepareLedgerDeliveries(env, frozen.deliveries); }
    catch { return { ...result, ok: false, code: 'storage_unavailable' } as T; }
    const cohort = (indices: number[]): LedgerOwnerOperation => ({ kind: 'managed', deliveries: indices.map(i => frozen.deliveries[i]!),
      preparedClaims: deliveryClaimSubset(prepared.claims, indices.map(i => frozen.deliveries[i]!)) });
    const groups: number[][] = []; let group: number[] = [], keys = new Set<string>();
    for (const [index, delivery] of frozen.deliveries.entries()) {
      if (conflicts.has(delivery.id) || !prepared.ready[index]) { result.ok = false; result.code = 'conflict'; continue; }
      const next = await ledgerOperationOwners(env, { kind: 'managed', deliveries: [delivery] });
      const combined = new Set([...keys, ...next.map(ledgerOwnerKey)]);
      if (group.length && (combined.size > LEDGER_OWNER_LIMIT || ledgerOperationBytes(cohort([...group, index])) > LEDGER_OPERATION_BYTES)) {
        groups.push(group); group = []; keys = new Set();
      }
      group.push(index); for (const owner of next) keys.add(ledgerOwnerKey(owner));
    }
    if (group.length) groups.push(group);
    for (const indices of groups) {
      const total = indices.reduce((sum, i) => sum + frozen.deliveries[i]!.messages.length, 0);
      let attempted = false;
      try {
        const captured = await ledgerUnderOwners<DeliveryCaptureReceipt>(env, cohort(indices), () => { attempted = true; dispatched?.(); });
        if (!validDeliveryCaptureReceipt(captured, indices.map(i => frozen.deliveries[i]!.messages.length))) throw new SessionAccessError();
        result.notAttempted -= total - captured.notAttempted;
        for (const key of ['newlyStored', 'alreadyPresent', 'suppressed', 'unknown', 'objects'] as const) result[key] += captured[key];
        for (const [position, index] of indices.entries()) result.dispositions[index] = captured.dispositions[position]!;
        if (!captured.ok) { result.ok = false; result.code = captured.code; }
      } catch { result.ok = false; result.code = 'storage_unavailable'; if (attempted) { result.notAttempted -= total; result.unknown += total; } }
    }
    return result as T;
  }
  if (ledgerOperationBytes(frozen) > LEDGER_OPERATION_HARD_BYTES) throw new SessionAccessError();
  if (!owners.length) { dispatched?.(); return checked(await executeLedgerOperation(env, frozen)); }
  return checked(await forwardLedgerOperation<T>(env, frozen, owners, 0, dispatched));
}
export async function forwardLedgerOperation<T>(env: Env, operation: LedgerOwnerOperation, owners: readonly LedgerOwner[], index: number, dispatched?: () => void): Promise<T> {
  const target = owners[index]; if (!target) throw new SessionAccessError();
  if (ledgerOperationBytes(operation) > LEDGER_OPERATION_HARD_BYTES) throw new SessionAccessError();
  const targetObject = shopperObject(env.SHOPPER_REFLEX, target.subject, target.tenant);
  dispatched?.();
  const response = await targetObject.fetch('https://owner/identity/ledger', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': target.tenant, 'X-Reflex-Subject': target.subject },
    body: JSON.stringify({ operation, index }),
  });
  if (!response.ok) throw new SessionAccessError();
  return response.json() as Promise<T>;
}
export async function executeHeldLedger<T>(owner: object, owners: readonly LedgerOwner[], work: () => Promise<T>): Promise<T> {
  const held = invocation.getStore();
  if (!held?.active || held.owner !== owner || held.ledgerOwners) throw new SessionAccessError();
  held.ledgerOwners = owners.map(ledgerOwnerKey);
  try { return await work(); } finally { delete held.ledgerOwners; }
}
export function ownerHeld(owner: object): boolean {
  const held = invocation.getStore();
  return !!held?.active && held.owner === owner;
}
export function currentOwnerEnvironment(env: Env): Env {
  const held = invocation.getStore();
  if (!held?.active || held.env.SESSIONS !== env.SESSIONS) throw new SessionAccessError();
  return ownerEnvironment(held.owner, env);
}
export function retainOwnerWork(task: Promise<unknown>): void {
  const held = invocation.getStore();
  if (!held?.active) throw new SessionAccessError();
  // Observe rejection immediately, then report it while draining below.
  void task.catch(() => undefined);
  held.pending.push(task);
}
function trackedIO<T>(start: () => Promise<T>): Promise<T> {
  const held = invocation.getStore();
  if (held && !held.active) throw new SessionAccessError();
  const task = start();
  if (held) retainOwnerWork(task);
  return task;
}
/** Fence the actual binding/provider invocation, and retain even timeout-raced work. */
export function ownerEffect<T>(start: () => Promise<T>): Promise<T> {
  const held = invocation.getStore();
  if (held) recheckOwnerInvocation(held.owner);
  const task = (async () => {
    const result = await start();
    if (held) recheckOwnerInvocation(held.owner);
    return result;
  })();
  // Retain optional provider failures without replacing their existing fallback;
  // an authority/lifetime refusal is never optional.
  if (held) retainOwnerWork(task.then(() => undefined, error => { if (error instanceof SessionAccessError) throw error; }));
  return task;
}
/** Abort the real transport, not only a Promise.race facade. Provider responses
 * already transmitted remain ambiguous; cancellation cannot recall those bytes. */
export function ownerFetch(input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  if (!invocation.getStore() && timeoutMs === undefined) return fetch(input, init);
  return ownerEffect(async () => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    init?.signal?.addEventListener('abort', abort, { once: true });
    if (init?.signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs ?? 5000);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body,
        { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    finally { clearTimeout(timer); init?.signal?.removeEventListener('abort', abort); }
  });
}
export function admitOwnerPrincipal(owner: object, principal: SessionCapability): void {
  const held = invocation.getStore();
  if (!held?.active || held.owner !== owner) throw new SessionAccessError();
  held.principals.set(JSON.stringify(principal), principal);
}
export function recheckOwnerInvocation(owner: object): void {
  const held = invocation.getStore();
  if (!held?.active || held.owner !== owner) throw new SessionAccessError();
  for (const principal of held.principals.values()) assertSessionTarget(principal);
  for (const guard of held.consentGuards) if (consentDeadline(guard.consent, guard.purpose) <= Date.now()) throw new SessionAccessError();
  if (held.recoveryDeadlines?.some(deadline => deadline <= Date.now())) throw new SessionAccessError();
  for (const guard of held.retentionGuards ?? []) requireRetention(guard.env, guard.stamp, guard.stamp.tenant, guard.stamp.category);
}
export function pinRetention(env: RetentionEnv, stamp: unknown, tenant: string, category: RetentionCategory): RetentionStamp {
  const value = requireRetention(env, stamp, tenant, category), held = invocation.getStore();
  if (held) { recheckOwnerInvocation(held.owner); (held.retentionGuards ??= []).push({ env, stamp: value }); }
  return value;
}
export function pinProfileRetention(env: RetentionEnv, source: { retention?: RetentionStamp; externalRetention?: ExternalRetention } | null | undefined, tenant: string): RetentionStamp {
  const stamp = pinRetention(env, source?.retention, tenant, 'profile'), held = invocation.getStore();
  const external: ExternalRetention = {};
  for (const [category, value] of Object.entries(source?.externalRetention ?? {})) {
    if (!category.startsWith('external.')) throw new SessionAccessError();
    external[category as RetentionCategory] = readRetention(value, tenant, category as RetentionCategory);
  }
  if (held) held.externalRetention = held.externalRetention === undefined ? external : mergeExternalRetention(held.externalRetention, external, tenant);
  return stamp;
}
export function currentExternalRetention(env: RetentionEnv, tenant: string, category: RetentionCategory): RetentionStamp {
  const held = invocation.getStore(); if (!held) throw new SessionAccessError();
  recheckOwnerInvocation(held.owner);
  return pinRetention(env, held.externalRetention?.[category], tenant, category);
}
export async function eventExternalRetention(id: string, digest: string, occurredAt: number): Promise<ExternalRetention> {
  const held = invocation.getStore(); if (!held?.eventRetention) throw new SessionAccessError();
  return trackedIO(() => held.eventRetention!(id, digest, occurredAt));
}
export function currentOwnerIdentity(): { tenant: string; subject: string } | undefined {
  const held = invocation.getStore(); if (!held) return undefined;
  recheckOwnerInvocation(held.owner);
  const identities = [...held.principals.values()].map(principal => ({ tenant: principal.tenant, subject: principal.subject }));
  if (!identities.length || identities.some(value => value.tenant !== identities[0]!.tenant || value.subject !== identities[0]!.subject)) return undefined;
  return identities[0];
}
/** No token crosses this boundary or enters durable recovery storage. */
export async function admitOwnedRecovery(input: RecoveryInput): Promise<RecoveryReceipt> {
  const held = invocation.getStore();
  if (!held?.recovery) throw new SessionAccessError();
  recheckOwnerInvocation(held.owner);
  const principals = [...held.principals.values()].filter(p => p.tenant === input.tenant && p.subject === input.subject);
  if (principals.length !== 1) throw new SessionAccessError();
  return trackedIO(() => held.recovery!(input, structuredClone(principals[0]!)));
}
export function pinRecoveryDeadline(deadline: number): void {
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) throw new SessionAccessError();
  const held = invocation.getStore();
  if (!held) throw new SessionAccessError();
  recheckOwnerInvocation(held.owner);
  (held.recoveryDeadlines ??= []).push(deadline);
}
export function currentProfileBirth(tenant: string): number | undefined {
  const held = invocation.getStore(); if (!held) return undefined;
  recheckOwnerInvocation(held.owner);
  return held.retentionGuards?.find(guard => guard.stamp.tenant === tenant && guard.stamp.category === 'profile')?.stamp.bornAt;
}
/** Transient sink eligibility, not a new persisted choice/grant deadline. */
export function ownerRetentionDeadline(tenant: string): number {
  const held = invocation.getStore(); if (!held) return Infinity;
  recheckOwnerInvocation(held.owner);
  return Math.min(...(held.retentionGuards ?? []).filter(guard => guard.stamp.tenant === tenant).map(guard => guard.stamp.expiresAt));
}
/** Pin the purpose and its original deadline before any eligible work. The owner
 * checks it again at every actual sink and after all deferred work is drained. */
export function requireConsentPurpose(consent: Consent, purpose: 'tracking' | 'personalization'): void {
  if (consentDeadline(consent, purpose) <= Date.now()) throw new SessionAccessError();
  const held = invocation.getStore();
  if (held) {
    recheckOwnerInvocation(held.owner);
    held.consentGuards.push({ consent, purpose });
  }
}
export async function currentOwnerConsent(): Promise<Consent | undefined> {
  const held = invocation.getStore();
  if (!held) return undefined;
  recheckOwnerInvocation(held.owner);
  const result = held.consent ? await held.consent() : undefined;
  recheckOwnerInvocation(held.owner);
  return result ? storedConsent(result) : undefined;
}
export async function restrictOwnerConsent(hints: Consent): Promise<Consent | undefined> {
  const held = invocation.getStore();
  if (!held) return undefined;
  recheckOwnerInvocation(held.owner);
  return held.restrictConsent ? trackedIO(() => held.restrictConsent!(hints)) : undefined;
}
export function assertOwnerScope(env: Env, principal: SessionCapability): void {
  assertSessionTarget(principal);
  const held = invocation.getStore();
  if (!held?.active || held.env.SESSIONS !== env.SESSIONS || !held.principals.has(JSON.stringify(principal))) throw new SessionAccessError();
}
export function ownerOperationActive(env: Env): boolean {
  const held = invocation.getStore();
  return !!held?.active && held.env.SESSIONS === env.SESSIONS;
}
export async function importUnderOwner(env: Env, tenant: string, subject: string, body: Record<string, unknown>): Promise<unknown> {
  const operationId = crypto.randomUUID();
  const stub = shopperObject(env.SHOPPER_REFLEX, subject, tenant);
  const headers = { 'Content-Type': 'application/json', 'X-Reflex-Tenant': tenant, 'X-Reflex-Subject': subject };
  const payload = JSON.stringify({ ...body, shopperId: subject, operationId });
  let admission: Response;
  try { admission = await stub.fetch('https://shopper-reflex/identity/import/admission', { method: 'POST', headers, body: payload }); }
  catch { admission = await stub.fetch('https://shopper-reflex/identity/import/admission/result', { method: 'POST', headers, body: JSON.stringify({ operationId }) }); }
  if (!admission.ok) throw new SessionAccessError();
  const prepared = await admission.json() as { prepared?: unknown; reason?: unknown };
  if (prepared.reason) return prepared;
  if (prepared.prepared !== true) throw new SessionAccessError();
  let response: Response;
  try {
    response = await stub.fetch('https://shopper-reflex/identity/import', {
      method: 'POST', headers, body: payload,
    });
  } catch {
    // A lost reply is reconciled, never replayed under a new operation id.
    response = await stub.fetch('https://shopper-reflex/identity/import/result', {
      method: 'POST', headers, body: JSON.stringify({ operationId }),
    });
  }
  if (!response.ok) throw new SessionAccessError();
  return response.json();
}
/** Recheck lifetime on EVERY access: an async descendant cannot retain the binding. */
export function sessionAuthorityKV(env: Env, principal?: SessionCapability): KVLike {
  const select = (): KVLike => {
    if (principal) assertSessionTarget(principal);
    const held = invocation.getStore();
    if (held?.active && held.env.SESSIONS === env.SESSIONS && held.sessions
      && (!principal || held.principals.has(JSON.stringify(principal)))) return held.sessions;
    if (principal || held?.env.SESSIONS === env.SESSIONS) throw new SessionAccessError();
    return env.SESSIONS as unknown as KVLike;
  };
  return { get: (key, type) => trackedIO(() => select().get(key, type)), put: (key, value, options) => trackedIO(() => select().put(key, value, options)),
    delete: key => trackedIO(() => select().delete(key)), list: options => trackedIO(() => select().list(options)) };
}
export function ownerRelay(env: Env, operation: 'broadcast' | 'connections', tenant: string, subject: string, body?: unknown) {
  const held = invocation.getStore();
  if (!held?.active || held.env.SESSIONS !== env.SESSIONS || !held.relay) throw new SessionAccessError();
  return trackedIO(() => held.relay!(operation, subject, tenant, body));
}
export async function runOwnerOperation<T>(owner: object, env: Env, work: () => Promise<T>, sessions?: KVLike, relay?: Invocation['relay'], consent?: Invocation['consent'], restrictConsent?: Invocation['restrictConsent'], eventRetention?: Invocation['eventRetention'], recovery?: Invocation['recovery']): Promise<T> {
  const held: Invocation = { owner, env, active: true, pending: [], requests: new WeakMap(), principals: new Map(), sessions, relay, consent, restrictConsent, eventRetention, recovery, consentGuards: [] };
  return invocation.run(held, async () => {
    let failure: unknown, value: T | undefined;
    try { value = await work(); } catch (error) { failure = error; }
    try {
      // Includes descendants registered while previously registered work settles.
      while (held.pending.length) {
        const settled = await Promise.allSettled(held.pending.splice(0));
        for (const result of settled) if (result.status === 'rejected') failure ??= result.reason;
      }
      if (failure !== undefined) throw failure;
      recheckOwnerInvocation(owner);
      return value as T;
    } finally { held.active = false; }
  });
}
export function shopperRequestHeld(request: Request, principal: SessionCapability): boolean {
  const held = invocation.getStore(), admitted = held?.requests.get(request);
  return !!held?.active && !!admitted && JSON.stringify(admitted) === JSON.stringify(principal);
}
export function ownedRequestPath(request: Request): boolean {
  const { pathname: path } = new URL(request.url), method = request.method;
  if (method === 'HEAD') return /^\/realtime\/(?:session\/[^/]+\/analytics|(?:segments|connections)\/[^/]+)$/.test(path);
  if (request.headers.get('Upgrade') && !(method === 'GET' && path === '/realtime/ws')) return false;
  if (method === 'GET') return /^\/realtime\/(?:ws|reflex|(?:personalization|segments|connections)\/[^/]+|session\/[^/]+\/analytics)$/.test(path)
    || /^\/v1\/[^/]+\/decisions\/snapshot$/.test(path);
  if (method !== 'POST') return false;
  return /^\/realtime\/(?:action|session\/reset|session\/(?:[^/]+\/)?preferences|segments\/[^/]+)$/.test(path)
    || /^\/v1\/[^/]+\/decisions\/snapshot$/.test(path)
    || /^\/v1\/[^/]+\/identity\/(?:session|link|detach)$/.test(path)
    || /^\/sort\/?$/.test(path) || path === '/sort/intent' || path === '/search'
    || /^\/track\/(?:event|batch)$/.test(path) || /^\/optimizely\/(?:decisions|track)$/.test(path);
}
/** Reject ambiguous selectors before requireShopper can adopt/forward an owner. */
export function assertShopperSelectors(request: Request): void {
  const query = new URL(request.url).searchParams;
  for (const name of ['tenant', 'userId', 'visitorId', 'sessionId', 'sdkKey', 'page', 'brand', 'channel', 'entry', 'browsingSessionId', 'trackingConsent', 'personalizationEnabled']) {
    const values = query.getAll(name);
    if (values.length > 1 || (values.length && (!values[0] || values[0] !== values[0].trim()))) throw new SessionAccessError();
    if (values.length && ['userId', 'visitorId', 'sessionId'].includes(name) && !/^[A-Za-z0-9_.-]{1,200}$/.test(values[0]!)) throw new SessionAccessError();
  }
}
/** JSON.parse otherwise silently keeps the last duplicate switch/selector.
 * Tokenize strings atomically (including escaped keys/embedded entry JSON). */
export function parseShopperContext(text: string): unknown {
  if (text.length > 16_384) throw new SessionAccessError();
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new SessionAccessError(); }
  const stack: Array<Set<string> | null> = [];
  const tokens = /"(?:[^"\\]|\\.)*"|[{}]|\[|\]/g;
  for (const token of text.matchAll(tokens)) {
    const part = token[0];
    if (part === '{' || part === '[') stack.push(part === '{' ? new Set() : null);
    else if (part === '}' || part === ']') stack.pop();
    else if (/^\s*:/.test(text.slice(token.index! + part.length))) {
      const keys = stack.at(-1), key = JSON.parse(part) as string;
      if (!keys || keys.has(key)) throw new SessionAccessError();
      keys.add(key);
    }
  }
  return value;
}
/** The URL header selects only an allowlisted operation, never authority. */
export function coarseRequestCF(value: unknown): { country?: string; regionCode?: string } {
  const cf = value as { country?: unknown; regionCode?: unknown } | null;
  return { ...(typeof cf?.country === 'string' && /^[A-Za-z]{2}$/.test(cf.country) ? { country: cf.country } : {}),
    ...(typeof cf?.regionCode === 'string' && /^[A-Za-z0-9-]{1,16}$/.test(cf.regionCode) ? { regionCode: cf.regionCode } : {}) };
}
export async function forwardShopperRequest(env: Env, request: Request, principal: SessionCapability): Promise<Response> {
  if (!ownedRequestPath(request)) throw new SessionAccessError();
  const headers = new Headers(request.headers);
  headers.set('X-Owner-Request-URL', request.url);
  headers.set('X-Tenant', principal.tenant);
  // Always replace public input; only the platform's coarse request metadata
  // enters this binding-only hop. Never forward city/IP/coordinates/body geo.
  headers.set('X-Owner-Coarse-CF', JSON.stringify(coarseRequestCF((request as Request & { cf?: unknown }).cf)));
  return shopperObject(env.SHOPPER_REFLEX, principal.subject, principal.tenant).fetch(new Request('https://shopper-reflex/authority/request', {
    method: request.method, headers, ...(request.body ? { body: request.body, duplex: 'half' } : {}),
  } as RequestInit));
}
let routes: Promise<Hono<{ Bindings: Env }>> | undefined;
async function shopperRoutes() {
  return routes ??= (async () => {
    const [{ default: realtime }, { identityRoutes }, { decisionRoutes }, { sortRoutes }, { trackingRoutes }, { optimizelyRoutes }, { searchRoutes }] = await Promise.all([
      import('@/routes/realtime'), import('@/routes/identity'), import('@/routes/decisions'), import('@/routes/sort'), import('@/routes/tracking'), import('@/routes/optimizely'), import('@/routes/search'),
    ]);
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', tenantMiddleware()); app.onError((error, c) => error instanceof SessionAccessError
      ? c.json({ ok: false, error: 'Shopper session unavailable' }, 401) : errorHandler(error, c));
    app.route('/realtime', realtime); app.route('/v1', identityRoutes); app.route('/v1', decisionRoutes);
    app.route('/sort', sortRoutes); app.route('/search', searchRoutes); app.route('/track', trackingRoutes); app.route('/optimizely', optimizelyRoutes);
    return app;
  })();
}
/** Owner-local services and redispatched routes use the same actual-effect fence. */
export function ownerEnvironment(owner: object, env: Env): Env {
  const held = invocation.getStore();
  if (!held || held.owner !== owner) return env;
  if (!held.active) throw new SessionAccessError();
  if (held.effectEnv) return held.effectEnv;
  const scoped = Object.create(env) as Env;
  // Deferred code keeps the guarded binding, not a prechecked raw handle. A
  // tombstone/config await cannot move its later write outside the grant fence.
  const wrappers = new WeakMap<object, object>(), rawObjects = new WeakMap<object, object>();
  const unwrap = (value: unknown): unknown => Array.isArray(value) ? value.map(unwrap)
    : value && typeof value === 'object' ? rawObjects.get(value) ?? value : value;
  const guardBinding = (binding: object, kind: 'binding' | 'namespace' | 'statement' = 'binding'): object => {
    const saved = wrappers.get(binding); if (saved) return saved;
    const proxy = new Proxy(binding, { get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (!held.active || !ownerHeld(owner)) throw new SessionAccessError();
        recheckOwnerInvocation(owner);
        if (kind === 'namespace' && (property === 'idFromName' || property === 'idFromString' || property === 'newUniqueId')) return value.apply(target, args);
        if ((kind === 'namespace' && property === 'get') || property === 'prepare' || property === 'bind') {
          return guardBinding(value.apply(target, args.map(unwrap)), property === 'get' ? 'binding' : 'statement');
        }
        return ownerEffect(() => Promise.resolve(value.apply(target, args.map(unwrap))));
      };
    } });
    wrappers.set(binding, proxy); rawObjects.set(proxy, binding); bindingOrigins.set(proxy, binding); return proxy;
  };
  for (const key of ['CACHE', 'STORAGE', 'EVENT_QUEUE', 'DB', 'RATE_LIMITER', 'PERSONALIZATION_WEBSOCKET',
    'REGION_TREND', 'DECISION_RING', 'LEARN_STATS', 'MERIDIAN_REFLEX', 'SHOPPER_REFLEX'] as const) {
    Object.defineProperty(scoped, key, { get: () => {
      const binding = env[key];
      return binding ? guardBinding(binding,
        ['RATE_LIMITER', 'PERSONALIZATION_WEBSOCKET', 'REGION_TREND', 'DECISION_RING', 'LEARN_STATS', 'MERIDIAN_REFLEX', 'SHOPPER_REFLEX'].includes(key) ? 'namespace' : 'binding') : binding;
    } });
  }
  Object.defineProperty(scoped, 'ANALYTICS', { get: () => env.ANALYTICS ? {
    writeDataPoint: (...args: Parameters<AnalyticsEngineDataset['writeDataPoint']>) => {
      if (!held.active || !ownerHeld(owner)) throw new SessionAccessError();
      recheckOwnerInvocation(owner);
      return env.ANALYTICS!.writeDataPoint(...args);
    },
  } : undefined });
  held.effectEnv = scoped;
  return scoped;
}
const bindingOrigins = new WeakMap<object, object>();
/** Cache identity follows the actual backing binding across temporary owner
 * fences. Synthetic wrappers remain distinct physical contexts. */
export function ownerBindingIdentity<T extends object | undefined>(binding: T): T {
  let current: object | undefined = binding;
  while (current && bindingOrigins.has(current)) current = bindingOrigins.get(current);
  return current as T;
}
/** Called by the actual owner only after its serialized current-grant admission. */
export async function dispatchOwnedRequest(owner: object, env: Env, request: Request, principal: SessionCapability,
  localFetch: (request: Request) => Promise<Response>): Promise<Response> {
  const held = invocation.getStore();
  if (!held?.active || held.owner !== owner || held.env.SESSIONS !== env.SESSIONS || !ownedRequestPath(request)) throw new SessionAccessError();
  held.requests.set(request, principal);
  const id = env.SHOPPER_REFLEX.idFromName(shopperObjectName(principal.tenant, principal.subject)).toString();
  const namespace = env.SHOPPER_REFLEX;
  const scoped = Object.create(ownerEnvironment(owner, env)) as Env;
  Object.defineProperty(scoped, 'SHOPPER_REFLEX', { value: new Proxy(namespace, {
    get(target, key) {
      if (key === 'get') return (selected: DurableObjectId) => selected.toString() === id
        ? { fetch: (input: Request | string, init?: RequestInit) => {
          if (!held.active || !ownerHeld(owner)) throw new SessionAccessError();
          return trackedIO(() => localFetch(new Request(input, init)));
        } } : target.get(selected);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) });
  const context = { waitUntil: retainOwnerWork, passThroughOnException() {} } as ExecutionContext;
  return (await shopperRoutes()).fetch(request, scoped, context);
}
