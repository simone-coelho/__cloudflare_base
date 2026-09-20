// Shared managed-ledger protocol, not a second raw-data store.
import { fromTs36, hourPrefix, parseId, rewardOf, ts36, isProductSortRecord, isBehaviorRecord,
  type CapturedMessage, type CapturedRecord, type LedgerStream } from './records';
import { isEventNonce } from '@/events/actionTypes';

export const DELIVERY_FIELD = '_ledger_delivery' as const;
export const MANAGED_MARKER = 'ledger_delivery';
export const MANAGED_BYTES = 16 * 1024 * 1024;
// An ordinal/hash entry is at most 110 UTF-8 bytes; each corresponding
// original row already contains >55 bytes of mandatory transport provenance.
// Thus this bound admits every existing MANAGED_BYTES partition, without a
// new row-count cap. The fixed allowance covers the original claim envelope.
export const PARTITION_CLAIM_BYTES = 4096 + 2 * MANAGED_BYTES;
export const MANAGED_PARTS = 100;
export const CAS_RETRIES = 3;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type DeliveryRow = CapturedRecord & { _ledger_delivery: { id: string; ordinal: number } };
export interface Delivery { id: string; messages: CapturedMessage[] }
/** Retained original rows, never a filtered envelope with replacement ordinals. */
export interface DeliverySurvivors {
  deliveryId: string; originalCount: number; identityDigest: string; claims: Record<string, string>;
  rows: Array<{ ordinal: number; wire: string }>; suppressed: number; expired: number; proof: string;
}
export interface DeliveryClaim {
  version: 1 | 2; id: string; tenant: string; hour: string; stream: LedgerStream; digest: string; count: number; key: string;
  /** v2 hashes each exact original JSON row plus its terminating LF. */
  rows?: Array<{ ordinal: number; digest: string }>;
}
export interface CaptureReceipt {
  ok: boolean; total: number; newlyStored: number; alreadyPresent: number; suppressed: number; unknown: number; notAttempted: number; objects: number;
  code: 'captured' | 'invalid_delivery' | 'storage_unavailable' | 'recovery_required' | 'capture_limit' | 'conflict';
}
/** Internal proof for each exact input position; aggregate counts never imply completion. */
export interface DeliveryCaptureReceipt extends CaptureReceipt { dispositions: Array<'ack' | 'retry'> }
export const captureReceipt = (total: number): CaptureReceipt => ({ ok: true, total, newlyStored: 0, alreadyPresent: 0,
  suppressed: 0, unknown: 0, notAttempted: total, objects: 0, code: 'captured' });
/** Validate the entire received proof before merging any counts or positions. */
export function validCaptureReceipt(value: unknown, total: number): value is CaptureReceipt {
  if (!value || typeof value !== 'object') return false;
  const r = value as CaptureReceipt;
  return r.total === total && typeof r.ok === 'boolean'
    && ['captured', 'invalid_delivery', 'storage_unavailable', 'recovery_required', 'capture_limit', 'conflict'].includes(r.code)
    && [r.total, r.newlyStored, r.alreadyPresent, r.suppressed, r.unknown, r.notAttempted, r.objects].every(n => Number.isSafeInteger(n) && n >= 0)
    && r.newlyStored + r.alreadyPresent + r.suppressed + r.unknown + r.notAttempted === total
    && (!r.ok || (r.unknown === 0 && r.notAttempted === 0));
}
export function validDeliveryCaptureReceipt(value: unknown, sizes: readonly number[]): value is DeliveryCaptureReceipt {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!validCaptureReceipt(value, total)) return false;
  const r = value as DeliveryCaptureReceipt;
  if (!Array.isArray(r.dispositions) || r.dispositions.length !== sizes.length
    || sizes.some((_, i) => r.dispositions[i] !== 'ack' && r.dispositions[i] !== 'retry')
    || r.ok !== sizes.every((_, i) => r.dispositions[i] === 'ack')) return false;
  const acknowledged = sizes.reduce((sum, size, i) => sum + (r.dispositions[i] === 'ack' ? size : 0), 0);
  return acknowledged <= r.newlyStored + r.alreadyPresent + r.suppressed;
}
export const byteLength = (body: string): number => new TextEncoder().encode(body).length;
export const hasDelivery = (body: unknown): boolean => !!body && typeof body === 'object' && Object.hasOwn(body, 'delivery_id');
export function validCarrier(record: unknown, stream: LedgerStream): record is CapturedRecord & Record<string, unknown> {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>, id = r[stream === 'decision' ? 'decision_id' : stream === 'outcome' ? 'outcome_id' : 'record_id'];
  if (stream === 'behavior' || stream === 'product-sort') {
    const value = Object.fromEntries(Object.entries(r).filter(([key]) => key !== DELIVERY_FIELD));
    if (!(stream === 'behavior' ? isBehaviorRecord(value) : isProductSortRecord(value))) return false;
  }
  const carrier = typeof id === 'string' ? parseId(id) : null;
  return carrier !== null && r.tenant === carrier.tenant && r.ts === carrier.ts && Number.isSafeInteger(r.ts)
    && carrier.ts >= 0 && Number.isFinite(new Date(carrier.ts).getTime())
    && typeof r.visitor_id === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(r.visitor_id)
    && (id as string).split(':')[2] === r.visitor_id;
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Shared read identity policy; a legacy outcome is readable once, but cannot prove an exact retry. */
export function logicalIdentity(row: Record<string, unknown>, stream: LedgerStream): 'stable' | 'legacy' | null {
  if (Object.hasOwn(row, DELIVERY_FIELD)) {
    const p = row[DELIVERY_FIELD];
    if (!object(p) || Object.keys(p).length !== 2 || !Object.hasOwn(p, 'id') || !Object.hasOwn(p, 'ordinal')
      || typeof p.id !== 'string' || !UUID.test(p.id) || !Number.isSafeInteger(p.ordinal) || Number(p.ordinal) < 0) return null;
  }
  if (stream === 'outcome' && (Object.hasOwn(row, 'event_id') || Object.hasOwn(row, 'event_id_source'))) {
    if (!isEventNonce(row.event_id) || !['provided', 'request'].includes(row.event_id_source as string)
      || !validCarrier(row, stream) || typeof row.event !== 'string' || rewardOf({ type: row.event, userId: row.visitor_id as string })?.type !== row.type
      || row.outcome_id !== `${row.tenant}:${ts36(row.ts as number)}:${row.visitor_id}:${row.event}:n1:${row.event_id}`) return null;
    return 'stable';
  }
  return stream === 'outcome' ? 'legacy' : 'stable';
}

/** Compare complete JSON rows after identity validation; only top-level transport provenance is excluded. */
export function equalLogicalRows(first: Record<string, unknown>, second: Record<string, unknown>, spend: (n?: number) => void): boolean {
  const pending: Array<[unknown, unknown, boolean]> = [[first, second, true]];
  while (pending.length) {
    spend(); const [a, b, top] = pending.pop()!;
    if (a === b) continue;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      spend(a.length);
      for (let n = 0; n < a.length; n++) pending.push([a[n], b[n], false]);
    } else {
      if (!object(a) || !object(b)) return false;
      const keys = Object.keys(a).filter(k => !top || k !== DELIVERY_FIELD);
      if (keys.length !== Object.keys(b).filter(k => !top || k !== DELIVERY_FIELD).length) return false;
      spend(keys.length);
      for (const k of keys) {
        if (!Object.hasOwn(b, k)) return false;
        pending.push([a[k], b[k], false]);
      }
    }
  }
  return true;
}

/** Native streaming and legacy text adapters share byte accounting; callers own limits and refusal types. */
export async function boundedLedgerText(
  obj: { text(): Promise<string>; size?: number; body?: ReadableStream<Uint8Array> | null },
  budget: { bytes: number }, bound: (kind: 'objectBytes' | 'rawBytes', observed: number) => void, invalid: () => Error,
  preserveBOM = false,
): Promise<string> {
  const body = obj.body;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (obj.size !== undefined) {
      if (!Number.isSafeInteger(obj.size) || obj.size < 0) throw invalid();
      bound('objectBytes', obj.size); bound('rawBytes', budget.bytes + obj.size);
    }
    if (!body) {
      // Text-only adapters can check actual bytes only after materializing the body.
      const text = await obj.text(), size = /[\u0080-\uFFFF]/.test(text) ? byteLength(text) : text.length;
      bound('objectBytes', size); bound('rawBytes', budget.bytes + size); budget.bytes += size; return text;
    }
    reader = body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: preserveBOM });
    const decode = (bytes?: Uint8Array) => {
      try { return bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode(); } catch { throw invalid(); }
    };
    let text = '', size = 0;
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; bound('objectBytes', size); bound('rawBytes', budget.bytes + size);
      text += decode(next.value);
    }
    text += decode(); budget.bytes += size; return text;
  } catch (error) {
    try { if (reader) await reader.cancel(); else if (body) await body.cancel(); } catch { /* retain original refusal */ }
    throw error;
  } finally { reader?.releaseLock(); }
}
export function readDelivery(body: unknown): Delivery {
  const b = body as { kind?: unknown; version?: unknown; type?: unknown; delivery_id?: unknown; records?: unknown; record?: unknown };
  if (!b || b.kind !== 'ledger' || b.version !== 1 || typeof b.delivery_id !== 'string' || !UUID.test(b.delivery_id)
    || !['decisions', 'decision', 'outcome', 'product-sort', 'behavior'].includes(b.type as string)) throw new Error('Invalid managed delivery');
  const rows = b.type === 'decisions' ? b.records : [b.record], stream = (b.type === 'decisions' ? 'decision' : b.type) as LedgerStream;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Invalid managed delivery');
  const messages: CapturedMessage[] = [];
  for (const record of rows) {
    if (!validCarrier(record, stream) || Object.hasOwn(record, DELIVERY_FIELD)) throw new Error('Invalid managed delivery');
    messages.push({ kind: 'ledger', type: stream, record } as CapturedMessage);
  }
  return { id: b.delivery_id, messages };
}
export function managedKey(key: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}\/\d{4}-\d{2}-\d{2}\/\d{2}\/(decision|outcome|product-sort|behavior)\/[0-9a-z]{9}-[0-9a-z]{9}-managed-[a-f0-9-]{36}\.ndjson$/i.test(key)
    && UUID.test(key.slice(key.lastIndexOf('managed-') + 8, -7));
}
export function managedRows(body: string, key: string, metadata: Record<string, string> | undefined): DeliveryRow[] {
  if (!managedKey(key) || metadata?.[MANAGED_MARKER] !== '1' || byteLength(body) > MANAGED_BYTES) throw new Error('Managed ledger state unavailable');
  const stream = key.split('/')[3] as LedgerStream, seen = new Set<string>(), ids = new Set<string>();
  const range = /\/([0-9a-z]{9})-([0-9a-z]{9})-managed-/.exec(key)!;
  const rows: DeliveryRow[] = [];
  for (const line of body.split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as DeliveryRow, p = row?.[DELIVERY_FIELD];
    if (!validCarrier(row, stream) || !p || Object.keys(p).sort().join(',') !== 'id,ordinal'
      || !UUID.test(p.id) || !Number.isSafeInteger(p.ordinal) || p.ordinal < 0
      || row.ts < fromTs36(range[1]!) || row.ts > fromTs36(range[2]!)
      || !key.startsWith(`${hourPrefix(row.tenant, row.ts)}/${stream}/`) || seen.has(`${p.id}:${p.ordinal}`)) throw new Error('Managed ledger state unavailable');
    seen.add(`${p.id}:${p.ordinal}`); ids.add(p.id); rows.push(row);
  }
  if (ids.size > MANAGED_PARTS) throw new Error('Managed ledger state unavailable');
  return rows;
}
export const claimKey = (part: Pick<DeliveryClaim, 'id' | 'hour' | 'stream'>): string => `ledger-delivery/claims/${part.hour}/${part.stream}/${part.id}.json`;
export function deliveryClaimSubset(claims: Readonly<Record<string, string>>, deliveries: readonly Delivery[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const delivery of deliveries) {
    const paths = [`ledger-delivery/identities/${delivery.id}.json`, ...delivery.messages.map(message => claimKey({ id: delivery.id,
      hour: hourPrefix(message.record.tenant, message.record.ts), stream: message.type }))];
    for (const path of paths) {
      const hash = claims[path]; if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Managed delivery claim unavailable');
      result[path] = hash;
    }
  }
  return result;
}
export async function claimText(object: { text(): Promise<string>; size?: number; body?: ReadableStream<Uint8Array> | null } | null,
  kind: 'partition' | 'whole'): Promise<string> {
  if (!object) throw new Error('Managed delivery claim unavailable');
  const limit = kind === 'whole' ? 4096 : PARTITION_CLAIM_BYTES;
  return boundedLedgerText(object, { bytes: 0 }, (_kind, bytes) => {
    if (bytes > limit) throw new Error('Managed delivery claim unavailable');
  }, () => new Error('Managed delivery claim unavailable'), true);
}
export function readClaim(value: unknown, expected: Pick<DeliveryClaim, 'id' | 'tenant' | 'hour' | 'stream'>, wholeCount: number): DeliveryClaim {
  const c = value as DeliveryClaim;
  if (!c || (c.version !== 1 && c.version !== 2)
    || Object.keys(c).sort().join(',') !== (c.version === 1 ? 'count,digest,hour,id,key,stream,tenant,version' : 'count,digest,hour,id,key,rows,stream,tenant,version')
    || !UUID.test(c.id) || !Number.isSafeInteger(wholeCount) || wholeCount < 1 || !Number.isSafeInteger(c.count) || c.count < 1 || c.count > wholeCount
    || !/^[a-f0-9]{64}$/.test(c.digest)
    || ['id', 'tenant', 'hour', 'stream'].some(key => c[key as keyof DeliveryClaim] !== expected[key as keyof typeof expected])
    || typeof c.key !== 'string' || !managedKey(c.key) || !c.key.startsWith(`${expected.hour}/${expected.stream}/`)) throw new Error('Managed delivery claim conflict');
  if (c.version === 2 && (!Array.isArray(c.rows) || c.rows.length !== c.count || c.rows.some((row, index) => !row
    || Object.keys(row).sort().join(',') !== 'digest,ordinal' || !Number.isSafeInteger(row.ordinal) || row.ordinal < 0 || row.ordinal >= wholeCount
    || (index > 0 && row.ordinal <= c.rows![index - 1]!.ordinal) || !/^[a-f0-9]{64}$/.test(row.digest)))) throw new Error('Managed delivery claim conflict');
  return c;
}
export function checkedClaim(value: unknown, expected: Omit<DeliveryClaim, 'key'>, wholeCount: number): DeliveryClaim {
  const c = readClaim(value, expected, wholeCount);
  if (c.digest !== expected.digest || c.count !== expected.count
    || c.version === 2 && (!expected.rows || c.rows!.some((row, index) => row.ordinal !== expected.rows![index]?.ordinal || row.digest !== expected.rows![index]?.digest))) throw new Error('Managed delivery claim conflict');
  return c;
}
export async function digest(body: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// ── W22 R1.01: one vocabulary for every way evidence is lost ─────────────────
//
// N10 and F16 §5(b), §5(c), §5(g), §7.2–7.4: a producer rejection, a row the
// consumer could not place, a fan-out post that was not accepted and a message
// whose retries were exhausted are four different holes in the same evidence,
// and today each of them is a `console` line at most. They are counted here,
// per tenant, since a stated horizon, in ONE vocabulary that the ops monitor
// answers with — beside `governance`, which the decision path's own refusals
// use (`src/learn/slotGovernance.ts`), and in the same shape:
//   · Never read on a decision path. The four recording sites only WRITE, after
//     the work they describe has already failed, and every failure is swallowed.
//   · No shopper state: a tenant, a horizon and four counts. No visitor, no
//     session, no record id, no payload.
//   · BOUNDED: four integers and a horizon, one document per tenant.
//   · Never silent: a tenant that lost nothing reads zero on every path, with
//     the horizon those zeros are measured from, never an absent member.
//
// Like the governance counters these are a FLOOR within their horizon, not an
// accounting ledger: the read-modify-write is last-write-wins, so concurrent
// drops may collapse into one increment. The counter claims only "this
// happened, at least this often, since `since`".
export type EvidenceLossPath = 'producerFailed' | 'consumerSkipped' | 'fanOutRejected' | 'retriesExhausted';
export const EVIDENCE_LOSS_PATHS: readonly EvidenceLossPath[] = ['producerFailed', 'consumerSkipped', 'fanOutRejected', 'retriesExhausted'];
export interface EvidenceLoss {
  /** Epoch milliseconds: the horizon these counts start at. */
  since: number;
  /** Records the producer could not hand to the queue (`src/ledger/enqueue.ts`). */
  producerFailed: number;
  /** Rows the consumer could not place (`src/ledger/consume.ts`). */
  consumerSkipped: number;
  /** Rows whose fan-out post was attempted and not accepted (`src/learn/fan.ts`). */
  fanOutRejected: number;
  /** Rows captured from the dead-letter queue after their retries were exhausted. */
  retriesExhausted: number;
}
/** The window the counts are measured over; a platform constant, always stated on the answer. */
export const EVIDENCE_LOSS_HORIZON_MS = 30 * 86_400_000;
export const evidenceLossKey = (tenant: string): string => `evidence-loss:v1:${tenant}`;
const EVIDENCE_TENANT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
type LossStore = { CACHE?: { get(key: string, type: 'json'): Promise<unknown>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown> } };
const lossCount = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

function lossDocument(raw: unknown, now: number): EvidenceLoss | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) return null;
  const since = value.since;
  if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0 || since > now
    || now - since >= EVIDENCE_LOSS_HORIZON_MS) return null;
  return { since, producerFailed: lossCount(value.producerFailed), consumerSkipped: lossCount(value.consumerSkipped),
    fanOutRejected: lossCount(value.fanOutRejected), retriesExhausted: lossCount(value.retriesExhausted) };
}

/**
 * What the ops monitor answers with. `undefined` only when the store could not
 * be read, so a monitor result never states a zero it did not observe; an
 * absent document is a tenant that lost nothing, at a horizon of now.
 */
export async function readEvidenceLoss(env: LossStore, tenant: string, now: number): Promise<EvidenceLoss | undefined> {
  try {
    if (!EVIDENCE_TENANT.test(tenant) || !env.CACHE) return undefined;
    const raw = await env.CACHE.get(evidenceLossKey(tenant), 'json');
    return lossDocument(raw, now) ?? { since: now, producerFailed: 0, consumerSkipped: 0, fanOutRejected: 0, retriesExhausted: 0 };
  } catch { return undefined; }
}

/**
 * Add one occurrence set to a tenant's counters. Fire and forget: it resolves
 * whatever happens, and the platform's own monitoring probe never counts
 * against the tenant it is probing (R94(1)) — the synthetic scope is excluded
 * here, exactly as the decision path's governance counters exclude it.
 */
export async function recordEvidenceLoss(env: LossStore, tenant: string, path: EvidenceLossPath, occurrences: number, now = Date.now()): Promise<void> {
  try {
    if (!EVIDENCE_TENANT.test(tenant) || !env.CACHE || !EVIDENCE_LOSS_PATHS.includes(path)
      || !Number.isSafeInteger(occurrences) || occurrences <= 0) return;
    // Imported here rather than at module scope: the monitoring boundary itself
    // loads the ledger consumer, so a static edge would close an import cycle.
    const { syntheticOperation } = await import('@/ops/synthetic');
    if (syntheticOperation()) return;
    const previous = lossDocument(await env.CACHE.get(evidenceLossKey(tenant), 'json'), now);
    const document: EvidenceLoss = previous ?? { since: now, producerFailed: 0, consumerSkipped: 0, fanOutRejected: 0, retriesExhausted: 0 };
    const next = document[path] + occurrences;
    if (!Number.isSafeInteger(next)) return;
    document[path] = next;
    await env.CACHE.put(evidenceLossKey(tenant), JSON.stringify({ version: 1, ...document }),
      { expirationTtl: Math.floor(EVIDENCE_LOSS_HORIZON_MS / 1000) });
  } catch { /* a loss counter never fails the work that lost the row, and never retries */ }
}
