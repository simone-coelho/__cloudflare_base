// src/ledger/consume.ts
// What the worker's queue handler calls for the ledger messages in a batch.
// Reject complete malformed envelopes without blocking valid siblings. The
// queue applies explicit positional dispositions, not a whole-batch success bit.

import type { Env } from '@/types/env';
import { expandLedgerMessage, persistDeliveries, writeBatches, type R2Like } from './writer';
import type { CapturedMessage } from './records';
import type { HoldoutConfig } from '@/content/types';
import type { TenantId } from '@/tenancy/tenant';
import { hidden, loadTombstones, type R2Readable } from './erasure';
import { hasDelivery, readDelivery, captureReceipt, deliveryClaimSubset, validCaptureReceipt, validDeliveryCaptureReceipt, type CaptureReceipt, type Delivery } from './delivery';
import { tenantConfig } from '@/tenancy/middleware';
import { requireRetention } from '@/retention';
import type { QuarantineCase } from './quarantine';
import { ledgerOperationHeld, ledgerOperationOwners, ledgerUnderOwners, prepareLedgerDeliveries, LEDGER_OWNER_LIMIT, LEDGER_OPERATION_BYTES, ledgerOperationBytes, pinRetention, currentOwnerEnvironment, type LedgerOwnerOperation } from '@/identity/sessionAuthority';

/**
 * W21 E1.03 (ruling R101): the experiment provenance an OUTCOME record carries.
 *
 * A DECISION record carries the provenance the decision path answered, written
 * by the producer and stored and exported unchanged — nothing here re-derives
 * it, because today's published salt applied to a decision taken under an older
 * one would silently restate which experiment that decision belonged to
 * (F07 §5.7). An outcome is different: it is not a decision, and what a reader
 * needs from it is which experiment its VISITOR is enrolled in, resolved from
 * her persistent anchor at the time the outcome is recorded. That is a stored
 * fact about her, not a fresh draw: the same anchor and the same published salt
 * answer the same arm on every retry.
 *
 * It is an annotation, never a condition of the write: a tenant whose learn
 * document cannot be read, or a visitor whose anchor cannot be resolved, simply
 * produces a record without the block. A record is never lost over it, and a
 * record whose own arm says the visitor was not eligible is never given one.
 */
async function stampOutcomeEnrollment(env: Env, messages: readonly CapturedMessage[]): Promise<void> {
  const pending = messages.filter(m => m.type === 'outcome'
    && (m.record as { experiment?: unknown }).experiment === undefined
    && (m.record as { arm?: unknown }).arm !== 'ineligible');
  if (!pending.length) return;
  const { LEARN_KIND } = await import('@/content/kinds');
  const { readPublication } = await import('@/config/publication');
  const { enrollmentAnchorOf, enrollmentFor } = await import('@/content/holdout');
  const published = new Map<string, { holdout: HoldoutConfig; revision: number } | null>();
  for (const message of pending) {
    const record = message.record as unknown as { tenant: string; brand: string; visitor_id: string; experiment?: unknown };
    try {
      if (!published.has(record.tenant)) {
        // Never the serving cache: this read is a queue-time annotation and must
        // not install a publication snapshot that a later decision would serve from.
        const revision = await readPublication(env, LEARN_KIND, record.tenant);
        published.set(record.tenant, revision?.value?.holdout ? { holdout: revision.value.holdout, revision: revision.revision } : null);
      }
      const learn = published.get(record.tenant);
      if (!learn) continue;
      const anchor = await enrollmentAnchorOf(env, record.tenant as TenantId, record.visitor_id);
      record.experiment = enrollmentFor({ tenant: record.tenant, brand: record.brand, holdout: learn.holdout,
        saltVersion: learn.revision, ...anchor }).provenance;
    } catch { /* provenance is an annotation; a record is never lost over it */ }
  }
}

export type LedgerDisposition = 'ack' | 'retry';
export interface ConsumeResult {
  written: number; objects: number;
  /** Rejected/unplaceable envelopes, not acknowledged drops or a record count. */
  skipped: number;
  suppressed: number; ok: boolean; dispositions: LedgerDisposition[]; error?: string; capture?: CaptureReceipt;
}

/** Restricted quarantine continuation: exact retained claim/ordinal evidence,
 * original owner locks, deadlines and the ordinary canonical managed sink. */
export async function consumeSurvivors(env: Env, value: QuarantineCase): Promise<CaptureReceipt> {
  const operation: LedgerOwnerOperation = { kind: 'survivors', value }, owners = await ledgerOperationOwners(env, operation);
  if (!ledgerOperationHeld(owners)) {
    const result = await ledgerUnderOwners<CaptureReceipt>(env, operation);
    if (!validCaptureReceipt(result, value.survivors!.originalCount)) throw new Error('Survivor receipt unavailable');
    return result;
  }
  const { loadQuarantine } = await import('./quarantine'), { recoveryJSON } = await import('./recovery');
  const loaded = await loadQuarantine(env, value.id);
  if (!loaded || recoveryJSON(loaded.value) !== recoveryJSON(value) || !value.survivors || value.expiresAt <= Date.now()) throw new Error('Original quarantine evidence unavailable');
  const { pinRecoveryDeadline } = await import('@/identity/sessionAuthority');
  pinRecoveryDeadline(value.expiresAt);
  for (const entry of value.survivors.rows) {
    const row = JSON.parse(entry.wire), barrier = await (await import('./erasure')).loadTombstone(env.STORAGE, row.tenant, row.visitor_id);
    if (!barrier || row.ts > barrier.erased_at) pinRetention(env, row.retention?.ledger, row.tenant, 'ledger');
  }
  const result = await (await import('./writer')).persistSurvivors(currentOwnerEnvironment(env).STORAGE, value.survivors);
  return { ...result, total: value.survivors.originalCount, suppressed: result.suppressed + value.survivors.suppressed,
    notAttempted: result.notAttempted + value.survivors.expired, ok: result.ok && value.survivors.expired === 0 };
}

function validConsumeResult(value: unknown, bodies: readonly unknown[]): value is ConsumeResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as ConsumeResult;
  const positions = Array.from({ length: bodies.length }, (_, i) => i);
  if (!Array.isArray(r.dispositions) || r.dispositions.length !== bodies.length
    || positions.some(i => r.dispositions[i] !== 'ack' && r.dispositions[i] !== 'retry') || typeof r.ok !== 'boolean'
    || r.ok !== positions.every(i => r.dispositions[i] === 'ack')
    || ![r.written, r.objects, r.skipped, r.suppressed].every(n => Number.isSafeInteger(n) && n >= 0)
    || r.skipped > bodies.length || (r.error !== undefined && typeof r.error !== 'string')) return false;
  const sizes: number[] = [], managed: LedgerDisposition[] = []; let rows = 0, acknowledgedLegacy = 0;
  for (const [index, body] of bodies.entries()) {
    const messages = expandLedgerMessage(body); rows += messages.length;
    if (!messages.length && r.dispositions[index] !== 'retry') return false;
    if (hasDelivery(body)) { sizes.push(readDelivery(body).messages.length); managed.push(r.dispositions[index]!); }
    else if (r.dispositions[index] === 'ack') acknowledgedLegacy += messages.length;
  }
  if (r.written + r.suppressed > rows) return false;
  if (!sizes.length) return r.capture === undefined && acknowledgedLegacy === r.written + r.suppressed;
  return validDeliveryCaptureReceipt(r.capture && { ...r.capture, dispositions: managed }, sizes)
    && r.written >= r.capture!.newlyStored && r.objects >= r.capture!.objects && r.suppressed >= r.capture!.suppressed
    && acknowledgedLegacy === r.written - r.capture!.newlyStored + r.suppressed - r.capture!.suppressed;
}

/**
 * Validate every envelope before grouped persistence. Managed completion is
 * positional and requires every partition; legacy failure retries that cohort.
 * Managed retries converge; legacy ones may duplicate.
 */
export async function consumeLedger(env: Pick<Env, 'STORAGE' | 'TENANTS' | 'DEPLOYMENT_PROFILE'> & Partial<Pick<Env, 'SHOPPER_REFLEX' | 'SESSIONS' | 'RETENTION'>>, bodies: readonly unknown[], now = Date.now(), preparedClaims?: Record<string, string>, recovery = false, recoveryDeadline?: number): Promise<ConsumeResult> {
  const messages: CapturedMessage[] = [];
  const deliveries: Delivery[] = [];
  const dispositions: LedgerDisposition[] = Array.from(bodies, () => 'retry');
  const legacyIndices: number[] = [], managedIndices: number[] = [];
  let skipped = 0;
  let tenants: string[];
  try { tenants = tenantConfig(env as Env).provisioned; }
  catch { return { written: 0, objects: 0, skipped: bodies.length, suppressed: 0, ok: bodies.length === 0, dispositions,
    error: 'Ledger tenant configuration unavailable' }; }
  for (const [index, b] of bodies.entries()) {
    try {
      if (hasDelivery(b)) {
        const delivery = readDelivery(b);
        if (delivery.messages.some(m => !tenants.includes(m.record.tenant))) { skipped++; continue; }
        deliveries.push(delivery); managedIndices.push(index);
      }
      else {
        const got = expandLedgerMessage(b);
        if (!got.length || got.some(m => !tenants.includes(m.record.tenant))) { skipped++; continue; }
        messages.push(...got);
        legacyIndices.push(index);
      }
    } catch { skipped++; }
  }
  if (!legacyIndices.length && !managedIndices.length) return { written: 0, objects: 0, skipped, suppressed: 0, ok: bodies.length === 0, dispositions };
  // Before any claim, cohort or owner dispatch, so every later view of these
  // records — the claim digest, the retry, the stored object — sees one record.
  await stampOutcomeEnrollment(env as Env, [...messages, ...deliveries.flatMap(delivery => delivery.messages)]);
  let ownerDispatched = false;
  try {
    // JSON cannot preserve own undefined fields or sparse arrays. An envelope
    // rejected above must never acquire a different meaning across the RPC.
    const admittedIndices = new Set([...legacyIndices, ...managedIndices]);
    bodies = bodies.map((body, index) => admittedIndices.has(index) ? body : null);
    recovery ||= bodies.some(body => !!body && typeof body === 'object' && Object.hasOwn(body, 'recovery_id'));
    const operation: LedgerOwnerOperation = { kind: 'consume', bodies: [...bodies], now, ...(preparedClaims ? { preparedClaims } : {}), ...(recovery ? { recovery: true } : {}),
      ...(recoveryDeadline === undefined ? {} : { recoveryDeadline }) };
    const owners = await ledgerOperationOwners(env as Env, operation);
    if (!ledgerOperationHeld(owners)) {
      if ((owners.length > LEDGER_OWNER_LIMIT || ledgerOperationBytes(operation) > LEDGER_OPERATION_BYTES) && bodies.length > 1) {
        // Cohort only whole envelopes. Validate duplicate full commitments before
        // any cohort writes, so regrouping cannot turn a conflicting delivery into
        // a partially accepted one. Each response maps back to original positions.
        const identities = new Map<string, string>(), conflicts = new Set<string>();
        for (const delivery of deliveries) {
          const bytes = JSON.stringify(delivery.messages.map(message => ({ type: message.type, record: message.record })));
          if (identities.has(delivery.id) && identities.get(delivery.id) !== bytes) conflicts.add(delivery.id);
          identities.set(delivery.id, bytes);
        }
        const prepared = preparedClaims ? { claims: preparedClaims, ready: deliveries.map(() => true) }
          : deliveries.length ? await prepareLedgerDeliveries(env as Env, deliveries) : { claims: {}, ready: [] };
        const preparedPositions = new Set(managedIndices.filter((_, index) => prepared.ready[index]));
        const groups: number[][] = []; let group: number[] = [], keys = new Set<string>();
        for (let index = 0; index < bodies.length; index++) {
          if (hasDelivery(bodies[index])) {
            try { if (conflicts.has(readDelivery(bodies[index]).id) || !preparedPositions.has(index)) continue; } catch { /* retain positional invalid envelope */ }
          }
          const next = await ledgerOperationOwners(env as Env, { kind: 'consume', bodies: [bodies[index]], now });
          const combined = new Set([...keys, ...next.map(owner => `${owner.tenant}:${owner.subject}`)]);
          if (group.length && (combined.size > LEDGER_OWNER_LIMIT || ledgerOperationBytes({ kind: 'consume', bodies: [...group.map(i => bodies[i]), bodies[index]], now }) > LEDGER_OPERATION_BYTES)) {
            groups.push(group); group = []; keys = new Set();
          }
          group.push(index); for (const owner of next) keys.add(`${owner.tenant}:${owner.subject}`);
        }
        if (group.length) groups.push(group);
        let written = 0, objects = 0, suppressed = 0, rejected = conflicts.size ? 'Managed delivery identity conflict' : undefined;
        const capture = deliveries.length ? captureReceipt(deliveries.reduce((sum, delivery) => sum + delivery.messages.length, 0)) : undefined;
        for (const indices of groups) {
          const selected = deliveries.filter((_, position) => indices.includes(managedIndices[position]!));
          const total = selected.reduce((sum, delivery) => sum + delivery.messages.length, 0);
          let attempted = false;
          try {
            const result = await ledgerUnderOwners<ConsumeResult>(env as Env, { kind: 'consume', bodies: indices.map(index => bodies[index]), now, ...(recovery ? { recovery: true } : {}),
              ...(recoveryDeadline === undefined ? {} : { recoveryDeadline }),
              ...(selected.length ? { preparedClaims: deliveryClaimSubset(prepared.claims, selected) } : {}) }, () => { attempted = true; });
            if (!validConsumeResult(result, indices.map(index => bodies[index]))) throw new Error('Ledger positional result unavailable');
            for (const [position, index] of indices.entries()) dispositions[index] = result.dispositions[position]!;
            written += result.written; objects += result.objects; suppressed += result.suppressed;
            if (capture && result.capture) {
              capture.notAttempted -= result.capture.total - result.capture.notAttempted;
              for (const key of ['newlyStored', 'alreadyPresent', 'suppressed', 'unknown', 'objects'] as const) capture[key] += result.capture[key];
              if (!result.capture.ok) { capture.ok = false; capture.code = result.capture.code; }
            }
            if (result.error) rejected = result.error;
          } catch {
            rejected = 'Ledger owner authority unavailable';
            if (capture && attempted) { capture.notAttempted -= total; capture.unknown += total; }
          }
        }
        if (capture && managedIndices.some(index => dispositions[index] !== 'ack')) { capture.ok = false; if (capture.code === 'captured') capture.code = 'storage_unavailable'; }
        return { written, objects, skipped, suppressed, ok: dispositions.every(value => value === 'ack'), dispositions,
          ...(rejected ? { error: rejected } : {}), ...(capture ? { capture } : {}) };
      }
      const result = await ledgerUnderOwners<ConsumeResult>(env as Env, operation, () => { ownerDispatched = true; });
      if (!validConsumeResult(result, bodies)) throw new Error('Ledger positional result unavailable');
      return result;
    }
  } catch {
    const total = deliveries.reduce((sum, delivery) => sum + delivery.messages.length, 0);
    return { written: 0, objects: 0, skipped, suppressed: 0, ok: false, dispositions, error: 'Ledger owner authority unavailable',
      ...(total ? { capture: { ...captureReceipt(total), ok: false, code: 'storage_unavailable' as const,
        unknown: ownerDispatched ? total : 0, notAttempted: ownerDispatched ? 0 : total } } : {}) };
  }
  const batchId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let capture: CaptureReceipt | undefined;
  let legacyWritten = 0, legacyObjects = 0, legacySuppressed = 0, error: string | undefined;
  try {
    // The entire exact-owner chain stays held across these reads and all puts.
    // No capture can slip behind that subject's completed erasure boundary.
    const barriers = new Map(await Promise.all([...new Set([...messages, ...deliveries.flatMap(d => d.messages)].map(m => m.record.tenant))].map(async tenant =>
      [tenant, await loadTombstones(env.STORAGE as unknown as R2Readable, tenant)] as const)));
    if (deliveries.length) {
      let attemptedManaged = 0;
      try {
        const admitted: Delivery[] = [], positions: number[] = [];
        for (const [position, delivery] of deliveries.entries()) {
          try {
            for (const { record } of delivery.messages) if (!hidden(barriers.get(record.tenant)!, record)) requireRetention(env as Env, record.retention?.ledger, record.tenant, 'ledger');
            admitted.push(delivery); positions.push(managedIndices[position]!);
          } catch { skipped++; error = 'Ledger retention authority unavailable'; }
        }
        for (const delivery of admitted) for (const { record } of delivery.messages) if (!hidden(barriers.get(record.tenant)!, record)) pinRetention(env as Env, record.retention?.ledger, record.tenant, 'ledger');
        attemptedManaged = admitted.reduce((sum, delivery) => sum + delivery.messages.length, 0);
        const managed = await persistDeliveries(currentOwnerEnvironment(env as Env).STORAGE as unknown as R2Like, admitted, preparedClaims);
        if (!validDeliveryCaptureReceipt(managed, admitted.map(delivery => delivery.messages.length))) throw new Error('Managed ledger proof unavailable');
        const refused = deliveries.reduce((sum, delivery) => sum + delivery.messages.length, 0) - admitted.reduce((sum, delivery) => sum + delivery.messages.length, 0);
        capture = { ...managed, total: managed.total + refused, notAttempted: managed.notAttempted + refused,
          ok: managed.ok && refused === 0, code: refused ? 'storage_unavailable' : managed.code };
        // Require proof for the exact input array, never infer positions from totals.
        const valid = Array.isArray(managed.dispositions) && managed.dispositions.length === admitted.length
          && positions.every((_, position) => managed.dispositions[position] === 'ack' || managed.dispositions[position] === 'retry');
        if (valid) for (const [position, index] of positions.entries()) dispositions[index] = managed.dispositions[position]!;
        if (!valid || managedIndices.some(index => dispositions[index] !== 'ack')) error = 'Managed ledger capture unavailable';
      } catch {
        error = 'Managed ledger capture unavailable';
        const total = deliveries.reduce((sum, delivery) => sum + delivery.messages.length, 0);
        capture = { ...captureReceipt(total), ok: false, code: 'storage_unavailable', unknown: attemptedManaged, notAttempted: total - attemptedManaged };
      }
    }
    const admittedLegacy: CapturedMessage[] = [], admittedPositions: number[] = [];
    for (const index of legacyIndices) {
      const rows = expandLedgerMessage(bodies[index]);
      try {
        for (const { record } of rows) if (!hidden(barriers.get(record.tenant)!, record)) requireRetention(env as Env, record.retention?.ledger, record.tenant, 'ledger');
        admittedLegacy.push(...rows); admittedPositions.push(index);
      } catch { skipped++; error = 'Ledger retention authority unavailable'; }
    }
    const allowed = admittedLegacy.filter(m => !hidden(barriers.get(m.record.tenant)!, m.record));
    for (const { record } of allowed) pinRetention(env as Env, record.retention?.ledger, record.tenant, 'ledger');
    const written = await writeBatches(currentOwnerEnvironment(env as Env).STORAGE as unknown as R2Like, allowed, batchId);
    legacyWritten = allowed.length; legacyObjects = written.length; legacySuppressed = admittedLegacy.length - allowed.length;
    for (const index of admittedPositions) dispositions[index] = 'ack';
  } catch { error = 'Ledger storage or erasure state unavailable'; }
  return { written: legacyWritten + (capture?.newlyStored ?? 0), objects: legacyObjects + (capture?.objects ?? 0), skipped,
    suppressed: legacySuppressed + (capture?.suppressed ?? 0), ok: dispositions.every(value => value === 'ack'), dispositions,
    ...(error ? { error } : {}), ...(capture ? { capture } : {}) };
}
