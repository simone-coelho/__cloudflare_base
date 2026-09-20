// src/ledger/writer.ts
// The consumer: messages in, batches out. Each batch is one R2 object under
// `{tenant}/{date}/{hour}/{stream}/`, and the object is NAMED by the id range it
// holds, `{minTs}-{maxTs}-{batch}.ndjson`. That name is the hour's manifest
// entry, written atomically with the batch, so two consumers draining the same
// hour never race on a shared manifest file. A point lookup lists the hour and
// reconciles every observed object whose range contains the id's time.
//
// R2 and Analytics Engine are two destinations, not one reading the other. This
// file writes R2; the producer wrote the points.

import { fromTs36, hourPrefix, isProductSortRecord, isBehaviorRecord, parseId, ts36, recordStream, validDecisionMeasurement,
  type CapturedMessage, type LedgerStream, type LedgerMessage, type LedgerWireMessage, type ProductSortRecord, type BehaviorRecord } from './records';
import type { DecisionRecord } from '@/content/types';
import type { OutcomeRecord } from './records';
import { assertManagedWriteAvailable, hidden, loadTombstones } from './erasure';
import { boundedLedgerText, byteLength, captureReceipt, CAS_RETRIES, checkedClaim, claimKey, claimText, DELIVERY_FIELD, digest, equalLogicalRows,
  logicalIdentity, MANAGED_BYTES, MANAGED_MARKER, MANAGED_PARTS, managedRows, readDelivery, validCarrier,
  readClaim, UUID, type DeliverySurvivors, type CaptureReceipt, type Delivery, type DeliveryCaptureReceipt, type DeliveryClaim, type DeliveryRow } from './delivery';

export interface R2Like {
  put(key: string, body: string, options?: R2PutOptions): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string>; etag?: string; customMetadata?: Record<string, string>; size?: number; body?: ReadableStream<Uint8Array> | null } | null>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}

type LedgerWriteMessage = CapturedMessage;
export interface WrittenBatch { key: string; count: number; stream: LedgerStream; prefix: string }

const streamOf = (m: LedgerWriteMessage) => m.type;
const idOf = (m: LedgerWriteMessage) => (m.type === 'decision' ? m.record.decision_id : m.type === 'outcome' ? m.record.outcome_id : m.record.record_id);

/** Is this a ledger message with a record we can place? Envelope admission handles rejection. */
export function isLedgerMessage(body: unknown): body is LedgerMessage {
  if (!body || typeof body !== 'object') return false;
  const m = body as { kind?: unknown; type?: unknown; record?: unknown };
  if (m.kind !== 'ledger' || (m.type !== 'decision' && m.type !== 'outcome') || !m.record || typeof m.record !== 'object') return false;
  if (m.type === 'decision' && !validDecisionMeasurement(m.record as DecisionRecord)) return false;
  const id = idOf(m as LedgerMessage);
  const carrier = typeof id === 'string' ? parseId(id) : null;
  const record = m.record as { tenant?: unknown; visitor_id?: unknown; ts?: unknown };
  return carrier !== null && record.tenant === carrier.tenant && record.ts === carrier.ts
    && Number.isSafeInteger(record.ts) && carrier.ts >= 0 && Number.isFinite(new Date(carrier.ts).getTime())
    && typeof record.visitor_id === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(record.visitor_id)
    && id.split(':')[2] === record.visitor_id;
}
export function isCapturedMessage(body: unknown): body is CapturedMessage {
  if (isLedgerMessage(body)) return true;
  const value = body as { kind?: unknown; type?: unknown; record?: unknown } | null;
  return value?.kind === 'ledger' && (value.type === 'product-sort' ? isProductSortRecord(value.record)
    : value.type === 'behavior' && isBehaviorRecord(value.record));
}
/** Validate the complete legacy envelope: no valid subset may hide rejected rows. */
export function expandLedgerMessage(body: unknown): CapturedMessage[] {
  if (!body || typeof body !== 'object') return [];
  if (Object.hasOwn(body, 'delivery_id')) {
    try { return readDelivery(body).messages; } catch { return []; }
  }
  const m = body as { kind?: unknown; type?: unknown; version?: unknown; records?: unknown };
  if (Object.hasOwn(m, 'version') && m.version !== 1) return [];
  if (isCapturedMessage(body)) return Object.hasOwn(body.record, DELIVERY_FIELD) ? [] : [body];
  if (m.kind !== 'ledger' || m.type !== 'decisions' || !Array.isArray(m.records) || !m.records.length) return [];
  const rows = Array.from(m.records as unknown[], (record) => ({ kind: 'ledger' as const, type: 'decision' as const, record: record as DecisionRecord }));
  return rows.every(row => isLedgerMessage(row) && !Object.hasOwn(row.record, DELIVERY_FIELD)) ? rows : [];
}
export type { LedgerWireMessage };

/** Group messages by stream and hour, write one object per group, return what was written. */
export async function writeBatches(r2: R2Like, messages: readonly LedgerWriteMessage[], batchId: string): Promise<WrittenBatch[]> {
  const groups = new Map<string, { prefix: string; stream: LedgerStream; rows: LedgerWriteMessage[]; min: number; max: number }>();
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (!isCapturedMessage(m)) continue;
    const id = parseId(idOf(m));
    if (!id) continue;
    const prefix = hourPrefix(id.tenant, id.ts);
    const stream = streamOf(m);
    const k = `${prefix}/${stream}`;
    const g = groups.get(k) ?? { prefix, stream, rows: [], min: Infinity, max: -Infinity };
    g.rows.push(m); g.min = Math.min(g.min, id.ts); g.max = Math.max(g.max, id.ts);
    groups.set(k, g);
  }
  const written: WrittenBatch[] = [];
  for (const g of groups.values()) {
    const key = `${g.prefix}/${g.stream}/${ts36(g.min)}-${ts36(g.max)}-${batchId}.ndjson`;
    const body = g.rows.map((m) => JSON.stringify(m.record)).join('\n') + '\n';
    await r2.put(key, body);
    written.push({ key, count: g.rows.length, stream: g.stream, prefix: g.prefix });
  }
  return written;
}

type DeliveryPart = { expected: Omit<DeliveryClaim, 'key'>; rows: DeliveryRow[]; body: string; bytes: number; copies: number; indices: number[]; key: string; min: number; max: number };
const acknowledged = (value: unknown): boolean => !!value && typeof value === 'object'
  && typeof (value as { etag?: unknown }).etag === 'string' && !!(value as { etag: string }).etag;

/** Shared producer/consumer sink. Immutable claims contain no raw records. */
export async function persistDeliveries(r2: R2Like | undefined, input: readonly Delivery[], preparedClaims?: Readonly<Record<string, string>>): Promise<DeliveryCaptureReceipt> {
  return persistDeliveryPhase(r2, input, false, preparedClaims);
}
/** Fix the full call's original bounded bins before its owner-held raw cohorts.
 * These necessary commitments contain hashes only and are never capture ACKs. */
export async function prepareDeliveryClaims(r2: R2Like | undefined, input: readonly Delivery[]): Promise<{ claims: Record<string, string>; ready: boolean[] }> {
  const result = await persistDeliveryPhase(r2, input, true);
  if (!result.preparedClaims || !result.preparedPositions) throw new Error('Managed delivery preparation unavailable');
  return { claims: result.preparedClaims, ready: result.preparedPositions };
}
/** Authenticate retained survivors against immutable full identity and v2 row
 * commitments. This never creates or changes an original claim. */
export async function validateSurvivors(r2: R2Like, saved: DeliverySurvivors): Promise<Array<{ claim: DeliveryClaim; rows: DeliveryRow[] }>> {
  if (!UUID.test(saved.deliveryId) || !Number.isSafeInteger(saved.originalCount) || saved.originalCount < 1
    || !Array.isArray(saved.rows) || !saved.rows.length || saved.rows.length > saved.originalCount
    || ![saved.suppressed, saved.expired].every(n => Number.isSafeInteger(n) && n >= 0)
    || saved.rows.length + saved.suppressed + saved.expired !== saved.originalCount) throw new Error('Original survivor evidence unavailable');
  const identityKey = `ledger-delivery/identities/${saved.deliveryId}.json`;
  const wholeRaw = await claimText(await r2.get(identityKey), 'whole'), whole = JSON.parse(wholeRaw);
  const wholeHash = await digest(wholeRaw);
  if (saved.claims[identityKey] !== undefined && saved.claims[identityKey] !== wholeHash || whole.version !== 1 || whole.id !== saved.deliveryId
    || whole.count !== saved.originalCount || !/^[a-f0-9]{64}$/.test(saved.identityDigest) || whole.digest !== saved.identityDigest) throw new Error('Original survivor identity conflict');
  saved.claims[identityKey] = wholeHash;
  const groups = new Map<string, { claim: DeliveryClaim; rows: DeliveryRow[] }>(), ordinals = new Set<number>();
  for (const entry of saved.rows) {
    const row = JSON.parse(entry.wire) as DeliveryRow, stream = recordStream(row);
    if (!Number.isSafeInteger(entry.ordinal) || entry.ordinal < 0 || entry.ordinal >= saved.originalCount || ordinals.has(entry.ordinal)
      || !validCarrier(row, stream) || row[DELIVERY_FIELD]?.id !== saved.deliveryId || row[DELIVERY_FIELD].ordinal !== entry.ordinal
      || JSON.stringify(row) !== entry.wire) throw new Error('Original survivor row conflict');
    ordinals.add(entry.ordinal);
    const expected = { id: saved.deliveryId, tenant: row.tenant, hour: hourPrefix(row.tenant, row.ts), stream }, key = claimKey(expected);
    let group = groups.get(key);
    if (!group) {
      const raw = await claimText(await r2.get(key), 'partition');
      const hash = await digest(raw);
      if (saved.claims[key] !== undefined && saved.claims[key] !== hash) throw new Error('Original survivor claim conflict');
      const claim = readClaim(JSON.parse(raw), expected, saved.originalCount);
      if (claim.version !== 2) throw new Error('Original survivor row proof unavailable');
      saved.claims[key] = hash;
      group = { claim, rows: [] }; groups.set(key, group);
    }
    const rowDigest = await digest(entry.wire + '\n');
    if (!group.claim.rows!.some(item => item.ordinal === entry.ordinal && item.digest === rowDigest)) throw new Error('Original survivor row conflict');
    group.rows.push(row);
  }
  return [...groups.values()];
}

/** Same bounded CAS sink as intact deliveries, using the original partition
 * keys and ordinal commitments instead of inventing a replacement envelope. */
export async function persistSurvivors(r2: R2Like, saved: DeliverySurvivors): Promise<CaptureReceipt> {
  saved = structuredClone(saved); // Read-only recovered witnesses are pinned for every subsequent CAS attempt.
  const result = captureReceipt(saved.rows.length);
  let groups: Awaited<ReturnType<typeof validateSurvivors>>;
  try { groups = await validateSurvivors(r2, saved); }
  catch { return { ...result, ok: false, code: 'conflict' }; }
  for (const group of groups) {
    let finished = false;
    try { for (let attempt = 0; attempt <= CAS_RETRIES; attempt++) {
      await validateSurvivors(r2, saved);
      const { claim, rows } = group, object = await r2.get(claim.key);
      if (object && (!object.etag || object.size !== undefined && object.size > MANAGED_BYTES)) throw new Error('Managed object unavailable');
      const body = object ? await object.text() : '', existing = object ? managedRows(body, claim.key, object.customMetadata) : [];
      await assertManagedWriteAvailable(r2, claim.tenant, claim.hour.split('/')[1]!);
      const barriers = await loadTombstones(r2, claim.tenant), present = new Map(existing.map(row => [`${row[DELIVERY_FIELD].id}:${row[DELIVERY_FIELD].ordinal}`, JSON.stringify(row)]));
      const adding: DeliveryRow[] = []; let suppressed = 0, already = 0;
      for (const row of rows) {
        if (hidden(barriers, row)) { suppressed++; continue; }
        const prior = present.get(`${row[DELIVERY_FIELD].id}:${row[DELIVERY_FIELD].ordinal}`);
        if (prior !== undefined) { if (prior !== JSON.stringify(row)) throw new Error('Managed row conflict'); already++; }
        else adding.push(row);
      }
      const next = body + (body && !body.endsWith('\n') && adding.length ? '\n' : '') + adding.map(row => JSON.stringify(row) + '\n').join('');
      if (byteLength(next) > MANAGED_BYTES || new Set([...existing, ...adding].map(row => row[DELIVERY_FIELD].id)).size > MANAGED_PARTS) throw new Error('Managed capacity exceeded');
      if (adding.length) {
        let put: unknown;
        try { put = await r2.put(claim.key, next, { onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
          customMetadata: { ...object?.customMetadata, [MANAGED_MARKER]: '1' }, httpMetadata: { contentType: 'application/x-ndjson' } }); }
        catch { result.unknown += adding.length; result.suppressed += suppressed; result.alreadyPresent += already; result.notAttempted -= rows.length; throw new Error('Managed acknowledgement unknown'); }
        if (put === null) continue;
        if (!acknowledged(put)) { result.unknown += adding.length; result.suppressed += suppressed; result.alreadyPresent += already; result.notAttempted -= rows.length; throw new Error('Managed acknowledgement unknown'); }
        result.objects++;
      }
      result.newlyStored += adding.length; result.alreadyPresent += already; result.suppressed += suppressed;
      result.notAttempted -= rows.length; finished = true; break;
    } } catch { /* Positional sink uncertainty stays explicit. */ }
    if (!finished) { result.ok = false; result.code = 'storage_unavailable'; }
  }
  return result;
}
async function persistDeliveryPhase(r2: R2Like | undefined, input: readonly Delivery[], prepareOnly: boolean,
  preparedClaims?: Readonly<Record<string, string>>): Promise<DeliveryCaptureReceipt & { preparedClaims?: Record<string, string>; preparedPositions?: boolean[] }> {
  const sizes = input.map(delivery => delivery.messages.length), handled = sizes.map(() => 0);
  const result: DeliveryCaptureReceipt = { ...captureReceipt(sizes.reduce((sum, count) => sum + count, 0)), dispositions: sizes.map(() => 'retry') };
  const blocked = new Set<string>(), tenants = new Set<string>();
  const fail = (code: CaptureReceipt['code']) => { result.ok = false; if (result.code === 'captured') result.code = code; };
  const failed = (error: unknown) => fail(error instanceof Error && error.message === 'Managed ledger recovery required' ? 'recovery_required'
    : error instanceof Error && ['Delivery identity conflict', 'Managed delivery claim conflict', 'Claim range conflict', 'Managed row conflict'].includes(error.message) ? 'conflict' : 'storage_unavailable');
  const finish = () => {
    result.dispositions = sizes.map((count, index) => count > 0 && handled[index] === count ? 'ack' : 'retry');
    result.ok = result.dispositions.every(disposition => disposition === 'ack');
    return result;
  };
  let parts: DeliveryPart[];
  const commitments = new Map<string, { body: string; count: number }>();
  const witnesses: Record<string, string> = Object.create(null);
  const witnessed = async (path: string, kind: 'whole' | 'partition', object: Awaited<ReturnType<R2Like['get']>>) => {
    const raw = await claimText(object, kind), hash = await digest(raw);
    if (preparedClaims && preparedClaims[path] !== hash) throw new Error('Managed delivery claim conflict');
    witnesses[path] = hash; return raw;
  };
  try {
    // Detach the entire call before hashing/storage awaits, including retries' shared inputs.
    const deliveries = JSON.parse(JSON.stringify(input)) as Delivery[];
    const byPart = new Map<string, DeliveryPart>();
    // Resolve every full-payload collision before writing either occurrence.
    for (const delivery of deliveries) {
      if (!delivery.messages.length) throw new Error('Invalid managed delivery');
      const full = JSON.stringify(delivery.messages.map(message => ({ type: message.type, record: message.record })));
      const priorDelivery = commitments.get(delivery.id);
      if (priorDelivery && priorDelivery.body !== full) { blocked.add(delivery.id); fail('conflict'); }
      commitments.set(delivery.id, { body: full, count: delivery.messages.length });
    }
    for (const [index, delivery] of deliveries.entries()) {
      const grouped = new Map<string, DeliveryRow[]>();
      for (const [ordinal, message] of delivery.messages.entries()) {
        readDelivery({ ...message, version: 1, delivery_id: delivery.id });
        const record = message.record, hour = hourPrefix(record.tenant, record.ts), group = `${hour}/${message.type}`;
        tenants.add(record.tenant);
        const rows = grouped.get(group) ?? [];
        rows.push({ ...record, [DELIVERY_FIELD]: { id: delivery.id, ordinal } }); grouped.set(group, rows);
      }
      if (blocked.has(delivery.id)) continue;
      for (const [group, rows] of grouped) {
        const body = rows.map(row => JSON.stringify(row)).join('\n') + '\n', key = `${delivery.id}/${group}`, prior = byPart.get(key);
        if (prior) { prior.copies++; prior.indices.push(index); continue; }
        const first = rows[0]!, stream = group.split('/').at(-1)! as LedgerStream;
        byPart.set(key, { expected: { version: 1, id: delivery.id, tenant: first.tenant, hour: hourPrefix(first.tenant, first.ts),
          stream, digest: '', count: rows.length }, rows, body, bytes: byteLength(body), copies: 1, indices: [index], key: '',
          min: rows.reduce((min, row) => Math.min(min, row.ts), Infinity), max: rows.reduce((max, row) => Math.max(max, row.ts), -Infinity) });
      }
    }
    parts = [...byPart.values()];
    for (const part of parts) if (part.bytes > MANAGED_BYTES) { blocked.add(part.expected.id); fail('capture_limit'); }
  } catch { return { ...result, ok: false, code: 'invalid_delivery' }; }
  if (!input.length) return result;
  if (!r2) return { ...result, ok: false, code: 'storage_unavailable' };
  try {
    await Promise.all([...tenants].map(tenant => loadTombstones(r2, tenant)));
    for (const [id, full] of commitments) {
      if (blocked.has(id)) continue;
      try {
        const path = `ledger-delivery/identities/${id}.json`, expected = { version: 1, id, digest: await digest(full.body), count: full.count };
        const validate = async (object: Awaited<ReturnType<R2Like['get']>>) => {
          const raw = await witnessed(path, 'whole', object);
          const stored = JSON.parse(raw) as typeof expected;
          if (!stored || Object.keys(stored).sort().join(',') !== 'count,digest,id,version'
            || Object.entries(expected).some(([key, value]) => stored[key as keyof typeof expected] !== value)) throw new Error('Delivery identity conflict');
        };
        const prior = await r2.get(path);
        if (prior !== null) await validate(prior);
        else {
          if (preparedClaims) throw new Error('Managed delivery claim conflict');
          const put = await r2.put(path, JSON.stringify(expected), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } });
          if (put === null) await validate(await r2.get(path));
          else if (!acknowledged(put)) throw new Error('Delivery commitment acknowledgement unavailable');
          else witnesses[path] = await digest(JSON.stringify(expected));
        }
      } catch (error) { blocked.add(id); failed(error); }
    }
    // Initial deliveries share an ordinary bounded batch. Regrouped retries keep
    // their first assignment, rather than creating one object per delivery.
    const bins = new Map<string, Array<{ parts: DeliveryPart[]; bytes: number }>>();
    for (const part of parts) {
      if (blocked.has(part.expected.id)) continue;
      const group = `${part.expected.hour}/${part.expected.stream}`, list = bins.get(group) ?? [{ parts: [], bytes: 0 }];
      let bin = list[list.length - 1]!;
      if (bin.parts.length >= MANAGED_PARTS || bin.bytes + part.bytes > MANAGED_BYTES) {
        bin = { parts: [], bytes: 0 }; list.push(bin);
      }
      bin.parts.push(part); bin.bytes += part.bytes; bins.set(group, list);
    }
    for (const [group, binsForGroup] of bins) for (const { parts: bin } of binsForGroup) {
      const key = `${group}/${ts36(Math.min(...bin.map(p => p.min)))}-${ts36(Math.max(...bin.map(p => p.max)))}-managed-${crypto.randomUUID()}.ndjson`;
      for (const part of bin) {
        if (blocked.has(part.expected.id)) continue;
        try {
          part.expected.digest = await digest(part.body);
          part.expected.version = 2;
          part.expected.rows = await Promise.all(part.rows.map(async row => ({ ordinal: row[DELIVERY_FIELD].ordinal, digest: await digest(JSON.stringify(row) + '\n') })));
          const wholeCount = commitments.get(part.expected.id)!.count;
          const path = claimKey(part.expected), prior = await r2.get(path);
          let claim: DeliveryClaim;
          if (prior !== null) {
            claim = checkedClaim(JSON.parse(await witnessed(path, 'partition', prior)), part.expected, wholeCount);
          } else {
            if (preparedClaims) throw new Error('Managed delivery claim conflict');
            const candidate: DeliveryClaim = { ...part.expected, key };
            const put = await r2.put(path, JSON.stringify(candidate), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } });
            if (put === null) {
              const won = await r2.get(path);
              claim = checkedClaim(JSON.parse(await witnessed(path, 'partition', won)), part.expected, wholeCount);
            } else {
              if (!acknowledged(put)) throw new Error('Claim acknowledgement unavailable');
              claim = candidate;
              witnesses[path] = await digest(JSON.stringify(candidate));
            }
          }
          const range = /\/([0-9a-z]{9})-([0-9a-z]{9})-managed-/.exec(claim.key);
          if (!range || fromTs36(range[1]!) > part.min || fromTs36(range[2]!) < part.max) throw new Error('Claim range conflict');
          part.key = claim.key;
        } catch (error) { blocked.add(part.expected.id); failed(error); }
      }
    }
    const groups = new Map<string, DeliveryPart[]>();
    for (const part of parts) {
      if (blocked.has(part.expected.id)) continue;
      const group = groups.get(part.key) ?? []; group.push(part); groups.set(part.key, group);
    }
    if (prepareOnly) return { ...result, ok: false, code: result.ok ? 'recovery_required' : result.code,
      preparedClaims: witnesses, preparedPositions: input.map(delivery => !blocked.has(delivery.id)
        && !!witnesses[`ledger-delivery/identities/${delivery.id}.json`]
        && parts.filter(part => part.expected.id === delivery.id).every(part => !!part.key && !!witnesses[claimKey(part.expected)])) };
    for (const [key, group] of groups) {
      try {
        let completed = false;
        for (let attempt = 0; attempt <= CAS_RETRIES; attempt++) {
          // Order matters: no stale pre-journal read may be reused after a CAS conflict.
          const object = await r2.get(key);
          if (object !== null && (!object || typeof object.etag !== 'string' || !object.etag || (object.size !== undefined && object.size > MANAGED_BYTES))) throw new Error('Managed object unavailable');
          const body = object === null ? '' : await object.text();
          const existing = object === null ? [] : managedRows(body, key, object.customMetadata);
          const first = group[0]!.expected;
          await assertManagedWriteAvailable(r2, first.tenant, first.hour.split('/')[1]!);
          const tombs = await loadTombstones(r2, first.tenant);
          if (preparedClaims) for (const part of group) {
            await witnessed(`ledger-delivery/identities/${part.expected.id}.json`, 'whole', await r2.get(`ledger-delivery/identities/${part.expected.id}.json`));
            await witnessed(claimKey(part.expected), 'partition', await r2.get(claimKey(part.expected)));
          }
          const present = new Map(existing.map(row => [`${row[DELIVERY_FIELD].id}:${row[DELIVERY_FIELD].ordinal}`, JSON.stringify(row)]));
          const adding: DeliveryRow[] = [];
          let suppressed = 0, already = 0, duplicates = 0;
          for (const part of group) for (const row of part.rows) {
            if (hidden(tombs, row)) { suppressed += part.copies; continue; }
            const prior = present.get(`${part.expected.id}:${row[DELIVERY_FIELD].ordinal}`);
            if (prior !== undefined) {
              if (prior !== JSON.stringify(row)) throw new Error('Managed row conflict');
              already += part.copies;
            } else { adding.push(row); duplicates += part.copies - 1; }
          }
          // Existing rows are append-only here. Only the coordinated eraser removes them.
          const next = body + (body && !body.endsWith('\n') && adding.length ? '\n' : '') + adding.map(row => JSON.stringify(row) + '\n').join('');
          if (byteLength(next) > MANAGED_BYTES || new Set([...existing, ...adding].map(row => row[DELIVERY_FIELD].id)).size > MANAGED_PARTS) {
            fail('capture_limit'); break;
          }
          const known = suppressed + already, pending = adding.length + duplicates;
          if (adding.length) {
            let put: unknown;
            try {
              put = await r2.put(key, next, { onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
                customMetadata: { ...object?.customMetadata, [MANAGED_MARKER]: '1' }, httpMetadata: { contentType: 'application/x-ndjson' } });
            } catch {
              result.suppressed += suppressed; result.alreadyPresent += already; result.unknown += pending;
              result.notAttempted -= known + pending; fail('storage_unavailable'); break;
            }
            if (put === null) continue;
            if (!acknowledged(put)) {
              result.suppressed += suppressed; result.alreadyPresent += already; result.unknown += pending;
              result.notAttempted -= known + pending; fail('storage_unavailable'); break;
            }
            result.objects++;
          }
          result.newlyStored += adding.length; result.alreadyPresent += already + duplicates; result.suppressed += suppressed;
          for (const part of group) for (const index of part.indices) handled[index]! += part.rows.length;
          result.notAttempted -= known + pending; completed = true; break;
        }
        if (!completed) fail('conflict');
      } catch (error) { failed(error); }
    }
    return finish();
  } catch (error) {
    failed(error); return finish();
  }
}

/** Conservative point-query refusal ceilings, sharing the existing raw-read numeric profile. */
const LOOKUP_LIMITS = { objects: 800, bytes: MANAGED_BYTES, work: 1_000_000, metadata: 2048 } as const;
const lookupUnavailable = () => new Error('Ledger record unavailable');
function lookupWork(): (n?: number) => void {
  let work = 0;
  return (n = 1) => { if ((work += n) > LOOKUP_LIMITS.work) throw lookupUnavailable(); };
}
function candidateRange(key: string, prefix: string): [number, number] {
  const m = key.startsWith(prefix) && /^([0-9a-z]{9})-([0-9a-z]{9})-[^/]+\.ndjson$/.exec(key.slice(prefix.length));
  if (!m) throw lookupUnavailable();
  const min = fromTs36(m[1]!), max = fromTs36(m[2]!);
  if (min > max || !Number.isSafeInteger(max) || !Number.isFinite(new Date(max).getTime())
    || !prefix.startsWith(`${hourPrefix(prefix.split('/')[0]!, min)}/`)
    || !prefix.startsWith(`${hourPrefix(prefix.split('/')[0]!, max)}/`)) throw lookupUnavailable();
  return [min, max];
}
async function lookupCandidates(r2: R2Like, tenant: string, ts: number, stream: LedgerStream, spend: (n?: number) => void): Promise<string[]> {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(tenant) || !Number.isSafeInteger(ts) || ts < 0
    || !Number.isFinite(new Date(ts).getTime()) || !['decision', 'outcome', 'product-sort', 'behavior'].includes(stream)) throw lookupUnavailable();
  const prefix = `${hourPrefix(tenant, ts)}/${stream}/`;
  const out = new Set<string>(), cursors = new Set<string>();
  const metadata = (value: unknown): value is string => {
    if (typeof value !== 'string' || !value.length || value.length > LOOKUP_LIMITS.metadata) return false;
    const bytes = byteLength(value); spend(bytes); return bytes <= LOOKUP_LIMITS.metadata;
  };
  let cursor: string | undefined;
  do {
    spend();
    const page = await r2.list({ prefix, cursor, limit: 1000 });
    if (!page || !Array.isArray(page.objects) || typeof page.truncated !== 'boolean') throw lookupUnavailable();
    for (const o of page.objects) {
      spend();
      if (!o || !metadata(o.key)) throw lookupUnavailable();
      const [min, max] = candidateRange(o.key, prefix);
      if (min <= ts && ts <= max) {
        out.add(o.key);
        if (out.size > LOOKUP_LIMITS.objects) throw lookupUnavailable();
      }
    }
    if (page.cursor !== undefined && !metadata(page.cursor)) throw lookupUnavailable();
    if (page.truncated && (!page.cursor || cursors.has(page.cursor))) throw lookupUnavailable();
    cursor = page.truncated ? page.cursor : undefined;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...out];
}

/** Every observed range candidate, with complete bounded pagination and physical-key echoes coalesced. */
export async function candidateKeys(r2: R2Like, tenant: string, ts: number, stream: LedgerStream): Promise<string[]> {
  return lookupCandidates(r2, tenant, ts, stream, lookupWork());
}

/** Reconcile all observed candidates before returning one logical record or a complete negative. No writes. */
export async function findById<T extends DecisionRecord | OutcomeRecord | ProductSortRecord | BehaviorRecord>(r2: R2Like, id: string, stream: LedgerStream): Promise<{ record: T; key: string } | null> {
  const parsed = parseId(id);
  if (!parsed || !Number.isSafeInteger(parsed.ts) || parsed.ts < 0 || !Number.isFinite(new Date(parsed.ts).getTime())) return null;
  const field = stream === 'decision' ? 'decision_id' : stream === 'outcome' ? 'outcome_id' : 'record_id';
  const spend = lookupWork(), budget = { bytes: 0 }, prefix = `${hourPrefix(parsed.tenant, parsed.ts)}/${stream}/`;
  let found: { record: T; key: string } | null = null;
  for (const key of await lookupCandidates(r2, parsed.tenant, parsed.ts, stream, spend)) {
    const [min, max] = candidateRange(key, prefix);
    const obj = await r2.get(key);
    if (!obj) throw lookupUnavailable();
    const text = await boundedLedgerText(obj, budget, (_kind, bytes) => { if (bytes > LOOKUP_LIMITS.bytes) throw lookupUnavailable(); }, lookupUnavailable);
    if (typeof text !== 'string') throw lookupUnavailable();
    for (let start = 0; start <= text.length;) {
      spend();
      const end = text.indexOf('\n', start), line = text.slice(start, end < 0 ? text.length : end);
      start = end < 0 ? text.length + 1 : end + 1;
      if (!line) continue;
      let value: unknown;
      try { value = JSON.parse(line); } catch { throw lookupUnavailable(); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw lookupUnavailable();
      const rec = value as Record<string, unknown>;
      if (!validCarrier(rec, stream)) throw lookupUnavailable();
      if (rec.tenant !== parsed.tenant || Number(rec.ts) < min || Number(rec.ts) > max) throw lookupUnavailable();
      const identity = logicalIdentity(rec, stream);
      if (identity === null) throw lookupUnavailable();
      if (rec[field] !== id) continue;
      if (found) {
        if (identity === 'legacy' || !equalLogicalRows(found.record as unknown as Record<string, unknown>, rec, spend)) throw lookupUnavailable();
      } else found = { record: rec as unknown as T, key };
    }
  }
  return found;
}
