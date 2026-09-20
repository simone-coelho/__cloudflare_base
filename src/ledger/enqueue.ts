// src/ledger/enqueue.ts
// The producer side: queue I/O is not awaited by the response, but serialization
// begins synchronously. Optional Analytics Engine capture is held until an
// exact destination retention policy is supported; the canonical ledger path
// remains independent of that destination. The online ring feeds attribution.

import type { Env } from '@/types/env';
import type { DecisionRecord } from '@/content/types';
import { LEDGER_KIND, type LedgerWireMessage, type OutcomeRecord, type CapturedRecord, type CapturedMessage } from './records';
import { captureReceipt, DELIVERY_FIELD, readDelivery, recordEvidenceLoss, type CaptureReceipt } from './delivery';
import type { R2Like } from './writer';
import { ledgerUnderOwners, pinRetention } from '@/identity/sessionAuthority';
import { requireRetention, type RetentionEnv } from '@/retention';

type QueueLike = { send(body: unknown, options: { contentType: 'json' }): Promise<void>; sendBatch?(messages: Array<{ body: unknown; contentType: 'json' }>): Promise<void> };
type AnalyticsLike = { writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void };

// Body-only limits leave headroom for queue metadata and batch framing.
export const LEDGER_BODY_BYTES = 120_000;
export const LEDGER_BATCH_BYTES = 240_000;
export const LEDGER_BATCH_MESSAGES = 100;
type DeliveryCode = 'accepted' | 'empty' | 'configuration_unavailable' | 'queue_unavailable' | 'oversized_record' | 'serialization_failed' | 'queue_rejected';
type Counts = { total: number; acknowledged: number; unknown: number; notAttempted: number };
export interface LedgerDeliveryReceipt {
  code: DeliveryCode;
  /** False means preflight refused the invocation; no wire messages were planned. */
  prepared: boolean;
  records: Counts;
  /** Counts only finalized, planned messages, not hypothetical chunks on preflight failure. */
  messages: Counts;
  /** Independent canonical R2 disposition, never added to queue acknowledgement counts. */
  capture?: CaptureReceipt;
}
export type PreparedMessage = { body: LedgerWireMessage; bytes: number; records: number };
const utf8 = new TextEncoder();
const setFramingBytes = utf8.encode(JSON.stringify({ kind: LEDGER_KIND, type: 'decisions', version: 1, records: [] })).length;
const outcomeFramingBytes = utf8.encode('{"kind":"ledger","type":"outcome","version":1,"record":}').length;
const counts = (total: number): Counts => ({ total, acknowledged: 0, unknown: 0, notAttempted: total });

function receipt(total: number, messages: number, prepared = true): LedgerDeliveryReceipt {
  return { code: total ? 'accepted' : 'empty', prepared, records: counts(total), messages: counts(messages) };
}

/** One fixed-code/numeric summary for ignored waitUntil receipts; never raw payloads or errors. */
function finish(result: LedgerDeliveryReceipt): LedgerDeliveryReceipt {
  if (result.code !== 'accepted' && result.code !== 'empty') {
    try {
      console.error('ledger_delivery_failed', { code: result.code, prepared: Number(result.prepared),
        records: result.records.total, acknowledgedRecords: result.records.acknowledged, unknownRecords: result.records.unknown,
        notAttemptedRecords: result.records.notAttempted, plannedMessages: result.messages.total,
        acknowledgedMessages: result.messages.acknowledged, unknownMessages: result.messages.unknown, notAttemptedMessages: result.messages.notAttempted,
        ...(result.capture ? { captureOk: Number(result.capture.ok), captureCode: result.capture.code, newlyStored: result.capture.newlyStored, alreadyPresent: result.capture.alreadyPresent,
          suppressed: result.capture.suppressed, captureUnknown: result.capture.unknown, captureNotAttempted: result.capture.notAttempted } : {}) });
    } catch { /* Even a failing diagnostic sink must not reject the producer promise. */ }
  }
  return result;
}

function snapshot<T>(value: T): { record: T; bytes: number } {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new Error('unserializable record');
  const record: unknown = JSON.parse(json);
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid serialized record');
  // Every record is separately detached before any queue await. Caller changes
  // (including shared inputs) cannot change a later message's measured bytes.
  return { record: record as T, bytes: utf8.encode(json).length };
}

function prepareDecisions(records: readonly DecisionRecord[]): PreparedMessage[] | null {
  const messages: PreparedMessage[] = [];
  let chunk: DecisionRecord[] = [], bytes = setFramingBytes;
  const flush = () => {
    if (chunk.length) messages.push({ body: { kind: LEDGER_KIND, type: 'decisions', version: 1, records: chunk }, bytes, records: chunk.length });
    chunk = []; bytes = setFramingBytes;
  };
  for (const value of records) {
    const next = snapshot(value);
    if (setFramingBytes + next.bytes > LEDGER_BODY_BYTES) return null;
    if (bytes + next.bytes + (chunk.length ? 1 : 0) > LEDGER_BODY_BYTES) flush();
    bytes += next.bytes + (chunk.length ? 1 : 0);
    chunk.push(next.record);
  }
  flush();
  return messages;
}

async function sendAll(env: ProducerEnv, messages: PreparedMessage[], total: number, report = true): Promise<LedgerDeliveryReceipt> {
  const result = receipt(total, messages.length);
  if (!messages.length) return result;
  let batch: QueueLike['sendBatch'], single: QueueLike['send'] | undefined;
  try {
    const queue = env.EVENT_QUEUE as unknown as QueueLike | undefined;
    if (!queue) throw new Error('Queue unavailable');
    const capability = queue.sendBatch;
    if (capability !== undefined) batch = capability.bind(queue);
    else single = queue.send.bind(queue);
  } catch { result.code = 'queue_unavailable'; return report ? finish(result) : result; }
  for (let offset = 0; offset < messages.length;) {
    let end = offset, bytes = 0, records = 0;
    do {
      const next = messages[end]!;
      if (end > offset && (end - offset >= LEDGER_BATCH_MESSAGES || bytes + next.bytes > LEDGER_BATCH_BYTES)) break;
      bytes += next.bytes; records += next.records; end++;
    } while (batch && end < messages.length);
    const count = end - offset;
    try {
      for (const { body } of messages.slice(offset, end)) {
        const rows = body.type === 'decisions' ? body.records : [body.record];
        for (const row of rows) requireRetention(env as RetentionEnv, row.retention?.ledger, row.tenant, 'ledger');
      }
    } catch { result.code = 'configuration_unavailable'; return report ? finish(result) : result; }
    result.records.notAttempted -= records; result.messages.notAttempted -= count;
    try {
      if (batch) await batch(messages.slice(offset, end).map(({ body }) => ({ body, contentType: 'json' as const })));
      else await single!(messages[offset]!.body, { contentType: 'json' });
    } catch {
      // Rejection cannot establish whether this attempted group was accepted.
      // Do not retry or fall back: earlier acknowledgements and the tail differ.
      result.code = 'queue_rejected'; result.records.unknown += records; result.messages.unknown += count;
      return report ? finish(result) : result;
    }
    result.records.acknowledged += records; result.messages.acknowledged += count;
    offset = end;
  }
  return result;
}

type ProducerEnv = Pick<Env, 'EVENT_QUEUE' | 'ANALYTICS'> & Partial<Pick<Env, 'STORAGE' | 'CACHE' | 'LEDGER_RECOVERY_ENABLED' | 'SHOPPER_REFLEX' | 'SESSIONS' | 'TENANTS' | 'DEPLOYMENT_PROFILE' | 'RETENTION'>>;

/**
 * W22 R1.01: the producer's own loss, counted where an operator reads it
 * instead of only in a `console.error` (N10; F16 §5(b), §7.3). A record whose
 * fate the queue could not confirm and which the canonical sink did not capture
 * either is a row that never reached the ledger.
 */
async function reportProducerLoss(env: ProducerEnv, tenant: string, result: LedgerDeliveryReceipt): Promise<LedgerDeliveryReceipt> {
  if (result.code === 'accepted' || result.code === 'empty' || result.capture?.ok) return result;
  await recordEvidenceLoss(env, tenant, 'producerFailed', result.records.unknown + result.records.notAttempted);
  return result;
}
export function prepareManaged(type: 'decisions' | 'outcome' | 'product-sort' | 'behavior', values: readonly CapturedRecord[]): PreparedMessage[] {
  // Preserve the full snapshot even if one row cannot fit on the queue: it may
  // still fit the bounded canonical R2 sink. No partial queue send on oversize.
  const snapshots = values.map(value => {
    if (value && Object.hasOwn(value, DELIVERY_FIELD)) throw new Error('Reserved ledger provenance');
    return snapshot(value);
  });
  const messages: PreparedMessage[] = [];
  let rows: DecisionRecord[] = [], bytes = 0, id = '';
  const framing = () => {
    id = crypto.randomUUID();
    bytes = utf8.encode(JSON.stringify({ kind: LEDGER_KIND, type: 'decisions', version: 1, delivery_id: id, records: [] })).length;
  };
  const flush = () => {
    if (rows.length) messages.push({ body: { kind: LEDGER_KIND, type: 'decisions', version: 1, delivery_id: id, records: rows }, bytes, records: rows.length });
    rows = []; framing();
  };
  framing();
  for (const next of snapshots) {
    if (type !== 'decisions') {
      const body = { kind: LEDGER_KIND, type, version: 1 as const, delivery_id: crypto.randomUUID(), record: next.record } as CapturedMessage;
      messages.push({ body, bytes: utf8.encode(JSON.stringify({ ...body, record: null })).length - 4 + next.bytes, records: 1 });
    } else {
      if (rows.length && bytes + next.bytes + 1 > LEDGER_BODY_BYTES) flush();
      bytes += next.bytes + (rows.length ? 1 : 0); rows.push(next.record as DecisionRecord);
    }
  }
  if (type === 'decisions') flush();
  for (const message of messages) readDelivery(message.body);
  return messages;
}
export async function sendManaged(env: ProducerEnv, messages: PreparedMessage[], total: number): Promise<LedgerDeliveryReceipt> {
  const result = messages.some(message => message.bytes > LEDGER_BODY_BYTES)
    ? { ...receipt(total, 0, false), code: 'oversized_record' as const }
    : await sendAll(env, messages, total, false);
  if (result.code !== 'accepted' && result.code !== 'empty') {
    const remaining = result.prepared ? messages.slice(result.messages.acknowledged) : messages;
    const count = remaining.reduce((sum, message) => sum + message.records, 0);
    let storage: R2Like | undefined;
    try { storage = env.STORAGE as unknown as R2Like | undefined; }
    catch { /* No storage call occurred; every remaining record is not attempted. */ }
    if (!storage) result.capture = { ...captureReceipt(count), ok: false, code: 'storage_unavailable' };
    else {
      let attempted = false;
      try { result.capture = await ledgerUnderOwners<CaptureReceipt>(env as Env, { kind: 'managed', deliveries: remaining.map(message => readDelivery(message.body)) }, () => { attempted = true; }); }
      catch {
        result.capture = { ...captureReceipt(count), ok: false, code: 'storage_unavailable', unknown: attempted ? count : 0, notAttempted: attempted ? 0 : count };
      }
    }
  }
  return finish(result);
}

/** Retained API, deliberately held. Free-form behavioral dimensions (including
 * outcome item/order IDs) are not an operational aggregate schema. Neither a
 * bare binding nor ledger retention authorizes this independent destination. */
export function pointsForDecisions(analytics: AnalyticsLike | undefined, records: readonly DecisionRecord[]): void {
  void analytics; void records;
}

export function pointForOutcome(analytics: AnalyticsLike | undefined, o: OutcomeRecord): void {
  void analytics; void o;
}

/** Enqueue every record of a served decision set. Resolves without throwing. */
export async function enqueueDecisions(env: ProducerEnv, records: readonly DecisionRecord[]): Promise<LedgerDeliveryReceipt> {
  if (!records.length) return receipt(0, 0);
  const tenant = records[0]!.tenant;
  const lost = (result: LedgerDeliveryReceipt) => reportProducerLoss(env, tenant, result);
  try { for (const row of records) pinRetention(env as RetentionEnv, row.retention?.ledger, row.tenant, 'ledger'); }
  catch { return lost(finish({ ...receipt(records.length, 0, false), code: 'configuration_unavailable' })); }
  let recovery: boolean;
  try { recovery = env.LEDGER_RECOVERY_ENABLED === 'true'; }
  catch { return lost(finish({ ...receipt(records.length, 0, false), code: 'configuration_unavailable' })); }
  // A ledger deadline does not authorize the separately configured AE store.
  // Do not even acquire that optional binding without destination authority.
  if (recovery) {
    let managed: PreparedMessage[];
    try { managed = prepareManaged('decisions', records); }
    catch { return lost(finish({ ...receipt(records.length, 0, false), code: 'serialization_failed' })); }
    return lost(await sendManaged(env, managed, records.length));
  }
  let messages: PreparedMessage[] | null;
  try { messages = prepareDecisions(records); }
  catch { return lost(finish({ ...receipt(records.length, 0, false), code: 'serialization_failed' })); }
  if (!messages) return lost(finish({ ...receipt(records.length, 0, false), code: 'oversized_record' }));
  return lost(await sendAll(env, messages, records.length));
}

export async function enqueueOutcome(env: ProducerEnv, outcome: OutcomeRecord | null): Promise<LedgerDeliveryReceipt> {
  if (!outcome) return receipt(0, 0);
  const lost = (result: LedgerDeliveryReceipt) => reportProducerLoss(env, outcome.tenant, result);
  try { pinRetention(env as RetentionEnv, outcome.retention?.ledger, outcome.tenant, 'ledger'); }
  catch { return lost(finish({ ...receipt(1, 0, false), code: 'configuration_unavailable' })); }
  let recovery: boolean;
  try { recovery = env.LEDGER_RECOVERY_ENABLED === 'true'; }
  catch { return lost(finish({ ...receipt(1, 0, false), code: 'configuration_unavailable' })); }
  // Optional AE is independently fail-closed; canonical delivery continues.
  if (recovery) {
    let managed: PreparedMessage[];
    try { managed = prepareManaged('outcome', [outcome]); }
    catch { return lost(finish({ ...receipt(1, 0, false), code: 'serialization_failed' })); }
    return lost(await sendManaged(env, managed, 1));
  }
  let next: ReturnType<typeof snapshot<OutcomeRecord>>;
  try { next = snapshot(outcome); }
  catch { return lost(finish({ ...receipt(1, 0, false), code: 'serialization_failed' })); }
  const bytes = outcomeFramingBytes + next.bytes;
  if (bytes > LEDGER_BODY_BYTES) return lost(finish({ ...receipt(1, 0, false), code: 'oversized_record' }));
  return lost(await sendAll(env,
    [{ body: { kind: LEDGER_KIND, type: 'outcome', version: 1, record: next.record }, bytes, records: 1 }], 1));
}
