import { retentionBirth, requireRetention, externalRetentionBirths, type RetentionStamp, type ExternalRetention } from '@/retention';
import type { Env } from '@/types/env';
import type { DecisionRecord } from '@/content/types';
import type { OutcomeRecord, BehaviorRecord, ProductSortRecord, CapturedRecord } from './records';
import type { SessionCapability } from '@/identity/sessionCapability';
import type { SlotLearnConfig, LearningReceipt } from '@/learn/fan';
import type { AttributionPolicy } from '@/learn/policy';
import type { PreparedMessage, LedgerDeliveryReceipt } from './enqueue';
import type { CaptureReceipt } from './delivery';
import { admitOwnedRecovery, durableRecoveryEnabled, RecoveryUnavailableError } from '@/identity/sessionAuthority';

/** A generation is captured before durable admission, never refreshed on retry. */
export interface LearningGeneration { whole: number; item: number }
export interface LearningEffect {
  version: 1;
  id: string;
  decision: string;
  outcome?: string;
  tenant: string;
  subject: string;
  generation: LearningGeneration;
  retention: RetentionStamp;
  consentUntil: number;
}
export const RECOVERY_LIMITS = { operations: 64, bytes: 8 * 1024 * 1024, chunk: 48 * 1024,
  effects: 4096, plans: 64, cases: 100, responseBytes: 128 * 1024 } as const;

/** Stable JSON commitment; credentials and mutable caller objects are never retained. */
export function recoveryJSON(value: unknown): string {
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, visit(item)]));
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Recovery input unavailable');
    return v;
  };
  const text = JSON.stringify(visit(value));
  if (text === undefined) throw new Error('Recovery input unavailable');
  return text;
}
export async function recoveryDigest(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(recoveryJSON(value))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function learningEffectId(kind: 'exposures' | 'credits', destination: string, decision: string, outcome?: string): Promise<string> {
  if (!destination || !decision || (kind === 'credits' ? !outcome : outcome !== undefined)) throw new Error('Learning identity unavailable');
  return recoveryDigest({ version: 1, kind, destination, decision, ...(outcome ? { outcome } : {}) });
}

export type RecoveryInput = { kind: 'decisions'; tenant: string; subject: string; brand: string;
  records: DecisionRecord[]; configs: Record<string, SlotLearnConfig>; firstAdmissionUntil?: number }
  | { kind: 'outcome'; tenant: string; subject: string; brand: string; outcome: OutcomeRecord;
    policy: AttributionPolicy; configs: Record<string, SlotLearnConfig>; defaultConfig: SlotLearnConfig }
  | { kind: 'behavior'; tenant: string; subject: string; brand: string; record: BehaviorRecord }
  | { kind: 'product-sort'; tenant: string; subject: string; brand: string; record: ProductSortRecord };
export interface RecoveryReceipt {
  version: 1; operation: string; durable: true;
  source: { expected: number; state: 'pending' | 'recovered' | 'suppressed_erased' | 'expired_unrecovered' };
  ledger?: CaptureReceipt; queue?: LedgerDeliveryReceipt; learning?: LearningReceipt;
}
interface RecoveryPayload { input: RecoveryInput; messages: PreparedMessage[]; effects?: Record<string, LearningEffect>; prepared?: boolean }
export interface OwnerRecovery {
  version: 1; id: string; digest: string; payloadDigest: string; chunks: number; bytes: number;
  principal: SessionCapability; consentUntil: number; retention: RetentionStamp; expiresAt: number;
  tenant: string; subject: string; records: number; occurredAt: number; destinations: string[];
  receipt: RecoveryReceipt; cleanup?: 'erased' | 'expired' | 'retired'; learning?: boolean;
}
const rowsOf = (input: RecoveryInput): CapturedRecord[] => input.kind === 'decisions' ? input.records : input.kind === 'outcome' ? [input.outcome] : [input.record];
const learningInput = (input: RecoveryInput): input is Extract<RecoveryInput, { kind: 'decisions' | 'outcome' }> => input.kind === 'decisions' || input.kind === 'outcome';
const categoriesOf = (input: RecoveryInput): Array<'ledger' | 'online'> => learningInput(input) ? ['ledger', 'online'] : ['ledger'];
// A repeated logical action receives fresh processing-time stamps at ingress.
// Those never refresh its admitted lifetime: compare logical data, then reuse
// the first complete payload and its original retention/configuration below.
const sourceOf = (input: RecoveryInput) => ({ kind: input.kind, tenant: input.tenant, subject: input.subject, brand: input.brand,
  rows: rowsOf(input).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'retention' && key !== 'externalRetention'))) });
const chunkKey = (id: string, index: number) => `recoveryBody:${id}:${index}`;
const metaKey = (id: string) => `recoveryOperation:${id}`;

async function payloadOf(storage: DurableObjectStorage, meta: OwnerRecovery): Promise<RecoveryPayload> {
  if (meta.version !== 1 || !/^[a-f0-9]{64}$/.test(meta.id) || !Number.isSafeInteger(meta.chunks)
    || meta.chunks < 1 || meta.chunks > Math.ceil(4 * RECOVERY_LIMITS.bytes / RECOVERY_LIMITS.chunk)) throw new Error('Recovery state unavailable');
  let text = '';
  for (let index = 0; index < meta.chunks; index++) {
    const part = await storage.get<string>(chunkKey(meta.id, index));
    if (typeof part !== 'string') throw new Error('Recovery body unavailable'); text += part;
  }
  if (new TextEncoder().encode(text).length !== meta.bytes) throw new Error('Recovery body unavailable');
  const payload: RecoveryPayload = JSON.parse(text);
  if (await recoveryDigest(payload) !== meta.payloadDigest || await recoveryDigest(sourceOf(payload.input)) !== meta.digest) throw new Error('Recovery body conflict');
  return payload;
}

async function savePayload(storage: DurableObjectStorage, meta: OwnerRecovery, payload: RecoveryPayload, logical?: string[], firstAdmissionUntil?: number): Promise<void> {
  const text = recoveryJSON(payload), size = new TextEncoder().encode(text).length;
  if (size > RECOVERY_LIMITS.bytes) throw new Error('Recovery capacity exceeded');
  // UTF-16 slices are small enough even for worst-case UTF-8; no lossy byte decoding.
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += RECOVERY_LIMITS.chunk / 4) chunks.push(text.slice(offset, offset + RECOVERY_LIMITS.chunk / 4));
  if (!chunks.length) throw new Error('Recovery body unavailable');
  const priorChunks = meta.chunks;
  meta.chunks = chunks.length; meta.bytes = size; meta.payloadDigest = await recoveryDigest(payload);
  await storage.transaction(async tx => {
    const firstAdmission = () => { if (firstAdmissionUntil !== undefined && (!Number.isSafeInteger(firstAdmissionUntil) || firstAdmissionUntil <= Date.now())) throw new Error('Original first admission expired'); };
    firstAdmission();
    if (logical) for (const key of logical) {
      const old = await tx.get<{ operation: string; digest: string }>('recoveryLogical:' + key);
      if (old && (old.operation !== meta.id || old.digest !== meta.digest)) throw new Error('Recovery logical conflict');
    }
    for (let i = 0; i < chunks.length; i++) await tx.put(chunkKey(meta.id, i), chunks[i]);
    for (let i = chunks.length; i < priorChunks; i++) await tx.delete(chunkKey(meta.id, i));
    await tx.put(metaKey(meta.id), meta);
    if (logical) for (const key of logical) await tx.put('recoveryLogical:' + key, { operation: meta.id, digest: meta.digest });
    // The final check is inside the transaction: a stalled read/write that
    // crosses the original offer deadline rolls back chunks, logical and meta.
    firstAdmission();
  });
}

async function armRecovery(storage: DurableObjectStorage, deadline: number): Promise<void> {
  const next = Math.min(deadline, Date.now() + 30_000), prior = await storage.getAlarm();
  if (prior === null || prior <= Date.now() || prior > next) await storage.setAlarm(Math.max(Date.now() + 1, next));
}

/** Owner serializer remains held through admission and effects. The guard is the
 * owner's current exact grant/epoch and consent check, not a stored bearer. */
export async function runOwnerRecovery(storage: DurableObjectStorage, env: Env, input: RecoveryInput,
  principal: SessionCapability, consentUntil: number, guard: (principal: SessionCapability, until: number) => Promise<void>): Promise<RecoveryReceipt> {
  if (!durableRecoveryEnabled(env)) throw new RecoveryUnavailableError();
  input = JSON.parse(recoveryJSON(input)) as RecoveryInput;
  const { isCapturedMessage } = await import('./writer'), { logicalIdentity } = await import('./delivery');
  const rows = rowsOf(input), stream = input.kind === 'decisions' ? 'decision' : input.kind;
  if (!rows.length || rows.length > 1000 || rows.some(row => row.tenant !== input.tenant || row.visitor_id !== input.subject
    || (learningInput(input) && (!('brand' in row) || row.brand !== input.brand)) || !isCapturedMessage({ kind: 'ledger', type: stream, record: row })
    || logicalIdentity(row as unknown as Record<string, unknown>, stream) !== 'stable')) throw new Error('Recovery input unavailable');
  if (principal.tenant !== input.tenant || principal.subject !== input.subject) throw new Error('Recovery owner unavailable');
  const firstAdmissionUntil = input.kind === 'decisions' ? input.firstAdmissionUntil : undefined;
  if (input.kind === 'decisions' && (input.records.some(row => row.measurementBasis === 'rendered-v1') && firstAdmissionUntil === undefined
    || firstAdmissionUntil !== undefined && (!Number.isSafeInteger(firstAdmissionUntil) || firstAdmissionUntil <= 0
      || firstAdmissionUntil > principal.exp * 1000 || input.records.some(row => firstAdmissionUntil > (row.retention?.ledger?.expiresAt ?? 0)
        || firstAdmissionUntil > (row.retention?.online?.expiresAt ?? 0) || row.rendered && row.rendered.at > firstAdmissionUntil)))) throw new Error('Original first admission unavailable');
  const ids = rows.map(row => 'outcome_id' in row ? row.outcome_id : 'decision_id' in row ? row.decision_id : row.record_id);
  const id = await recoveryDigest({ kind: input.kind, tenant: input.tenant, subject: input.subject, ids }), digest = await recoveryDigest(sourceOf(input));
  let meta = await storage.get<OwnerRecovery>(metaKey(id));
  if (meta) {
    if (meta.digest !== digest) throw new Error('Recovery logical conflict');
    return resumeOwnerRecovery(storage, env, meta, guard);
  }
  if (await storage.get('recoveryTerminal:' + id)) throw new Error('Original recovery operation is terminal');
  const all = await storage.list<OwnerRecovery>({ prefix: 'recoveryOperation:', limit: RECOVERY_LIMITS.operations + 1 });
  const terminals = await storage.list({ prefix: 'recoveryTerminal:', limit: RECOVERY_LIMITS.operations + 1 });
  if (all.size + terminals.size >= RECOVERY_LIMITS.operations) throw new Error('Recovery capacity exceeded');
  await guard(principal, consentUntil);
  for (const row of rows) for (const category of categoriesOf(input)) requireRetention(env, row.retention?.[category], row.tenant, category);
  const occurredAt = Math.min(...rows.map(row => row.ts)), retention = retentionBirth(env, input.tenant, 'recovery', occurredAt);
  // Only the first durable source admission captures destination lifetimes.
  // Retries above retain the original payload; a warehouse scan cannot mint it.
  for (const row of rows) if (!('externalRetention' in row)) (row as CapturedRecord & { externalRetention?: ExternalRetention }).externalRetention = externalRetentionBirths(env, row.tenant, row.ts);
  const { prepareManaged } = await import('./enqueue');
  const payload: RecoveryPayload = { input, messages: prepareManaged(input.kind, rows) };
  payload.messages = payload.messages.map(message => ({ ...message,
    body: { ...message.body, recovery_id: id } }));
  for (const message of payload.messages) message.bytes = new TextEncoder().encode(JSON.stringify(message.body)).length;
  meta = { version: 1, id, digest, payloadDigest: '', chunks: 0, bytes: 0, principal: structuredClone(principal), consentUntil,
    retention, expiresAt: Math.min(retention.expiresAt, consentUntil, principal.exp * 1000,
      ...rows.flatMap(row => categoriesOf(input).map(category => row.retention![category]!.expiresAt))),
    tenant: input.tenant, subject: input.subject, records: rows.length, occurredAt, destinations: [], learning: learningInput(input),
    receipt: { version: 1, operation: id, durable: true, source: { expected: rows.length, state: 'pending' } } };
  if (meta.expiresAt <= Date.now()) throw new Error('Recovery authority expired');
  // Durable admission precedes queue, R2, ring counters or credit effects.
  await savePayload(storage, meta, payload, await Promise.all(ids.map(value => recoveryDigest({ stream, id: value }))), firstAdmissionUntil);
  await armRecovery(storage, meta.expiresAt);
  try { return await resumeOwnerRecovery(storage, env, meta, guard); }
  catch (error) {
    if (learningInput(input)) throw error;
    // The source transaction is already durable. A downstream unknown effect
    // is pending recovery, never a false canonical completion or lost source.
    await guard(principal, consentUntil); return meta.receipt;
  }
}

export async function resumeOwnerRecovery(storage: DurableObjectStorage, env: Env, meta: OwnerRecovery,
  guard: (principal: SessionCapability, until: number) => Promise<void>): Promise<RecoveryReceipt> {
  if (meta.cleanup || meta.expiresAt <= Date.now()) {
    await disposeOwnerRecovery(storage, env, meta, meta.cleanup === 'erased'); return recoveryCleanup(meta, meta.cleanup === 'erased').receipt;
  }
  await guard(meta.principal, meta.consentUntil);
  const { pinRetention, pinRecoveryDeadline } = await import('@/identity/sessionAuthority');
  pinRetention(env, meta.retention, meta.tenant, 'recovery');
  pinRecoveryDeadline(meta.expiresAt);
  const { loadTombstone } = await import('./erasure'), tombstone = await loadTombstone(env.STORAGE, meta.tenant, meta.subject);
  if (tombstone && meta.occurredAt <= tombstone.erased_at) {
    await disposeOwnerRecovery(storage, env, meta, true); return { ...meta.receipt, source: { expected: meta.records, state: 'suppressed_erased' } };
  }
  if (meta.receipt.source.state === 'recovered') {
    const prior = await storage.getAlarm();
    if (prior === null || prior > meta.expiresAt) await storage.setAlarm(meta.expiresAt);
    return meta.receipt;
  }
  const payload = await payloadOf(storage, meta), input = payload.input;
  const { fanDecisions, fanOutcome, prepareExposureEffects, ringName, statsName } = await import('@/learn/fan');
  if (!payload.prepared) {
    if (input.kind === 'decisions') {
      payload.effects = await prepareExposureEffects(env, input.records, meta.consentUntil);
      meta.destinations = [...new Set(input.records.filter(row => row.arm === 'personalized').map(row => statsName(row.tenant, row.brand, row.slot)))];
    } else if (input.kind === 'outcome') {
      if (!env.DECISION_RING) throw new Error('Attribution preparation unavailable');
      const response = await env.DECISION_RING.get(env.DECISION_RING.idFromName(ringName(input.tenant, input.subject))).fetch('https://learn/outcome/prepare', {
        method: 'POST', body: recoveryJSON({ version: 2, tenant: input.tenant, brand: input.brand, outcome: input.outcome,
          policy: input.policy, slotConfig: input.configs, defaultSlotConfig: input.defaultConfig, consentUntil: meta.consentUntil }),
      });
      const body = await response.json() as { ok?: boolean; digest?: string; destinations?: string[] };
      if (!response.ok || body.ok !== true || !Array.isArray(body.destinations)) throw new Error('Attribution preparation unavailable');
      meta.destinations = body.destinations;
    }
    payload.prepared = true;
    await guard(meta.principal, meta.consentUntil);
    await savePayload(storage, meta, payload);
  }
  await guard(meta.principal, meta.consentUntil);
  for (const row of rowsOf(input)) for (const category of categoriesOf(input)) requireRetention(env, row.retention?.[category], row.tenant, category);
  const { sendManaged } = await import('./enqueue'), { readDelivery } = await import('./delivery'), { ledgerUnderOwners } = await import('@/identity/sessionAuthority');
  // Queue acceptance is transport evidence only. The canonical sink receipt is
  // independently reconciled with the same persisted delivery IDs and claims.
  meta.receipt.queue = await sendManaged(env, payload.messages, meta.records);
  meta.receipt.ledger = await ledgerUnderOwners<CaptureReceipt>(env, { kind: 'managed', deliveries: payload.messages.map(message => readDelivery(message.body)) });
  await guard(meta.principal, meta.consentUntil);
  if (learningInput(input)) meta.receipt.learning = input.kind === 'decisions'
    ? await fanDecisions(env, { tenant: input.tenant, brand: input.brand, visitor_id: input.subject, records: input.records }, slot => input.configs[slot]!, { effects: payload.effects! })
    : await fanOutcome(env, input.tenant, input.outcome, input.policy, input.brand, input.configs, input.defaultConfig, { consentUntil: meta.consentUntil });
  if (meta.receipt.ledger.ok && (!learningInput(input) || meta.receipt.learning?.ok)) meta.receipt.source.state = 'recovered';
  await storage.put(metaKey(meta.id), meta);
  await armRecovery(storage, meta.expiresAt);
  return meta.receipt;
}

/** Transactional owner erasure keeps this minimal continuation, not raw work. */
export function recoveryCleanup(meta: OwnerRecovery, erased = true, retired = false): OwnerRecovery {
  const state = erased ? 'suppressed_erased' : meta.receipt.source.state === 'recovered' ? 'recovered' : 'expired_unrecovered';
  return { ...meta, chunks: 0, bytes: 0, payloadDigest: '', cleanup: erased ? 'erased' : retired ? 'retired' : 'expired',
    receipt: { version: 1, operation: meta.id, durable: true, source: { expected: meta.records, state } } };
}
/** Local immutable deadlines authorize raw disposal without any remote read.
 * Run over the whole bounded owner cohort before unrelated/child maintenance. */
export async function stripExpiredOwnerRecovery(storage: DurableObjectStorage, owns: (tenant: string, subject: string) => boolean): Promise<void> {
  const entries = await storage.list<OwnerRecovery>({ prefix: 'recoveryOperation:', limit: RECOVERY_LIMITS.operations + 1 });
  if (entries.size > RECOVERY_LIMITS.operations) throw new Error('Recovery capacity exceeded');
  const now = Date.now(); let next = Infinity;
  for (const [key, meta] of entries) {
    if (key !== metaKey(meta.id) || !owns(meta.tenant, meta.subject) || !Number.isSafeInteger(meta.expiresAt)
      || !Number.isSafeInteger(meta.chunks) || meta.chunks < 0 || meta.chunks > Math.ceil(RECOVERY_LIMITS.bytes / (RECOVERY_LIMITS.chunk / 4))
      || (meta.cleanup !== undefined && !['erased', 'expired', 'retired'].includes(meta.cleanup))) throw new Error('Recovery commitment unavailable');
    next = Math.min(next, meta.cleanup || meta.expiresAt <= now ? now + 30_000 : meta.expiresAt);
  }
  await storage.transaction(async tx => {
    for (const [key, meta] of entries) if (meta.cleanup || meta.expiresAt <= now) {
      await tx.put(key, recoveryCleanup(meta, meta.cleanup === 'erased', meta.cleanup === 'retired'));
      for (let i = 0; i < meta.chunks; i++) await tx.delete(chunkKey(meta.id, i));
    }
  });
  if (Number.isFinite(next)) await armRecovery(storage, next);
}
export async function disposeOwnerRecovery(storage: DurableObjectStorage, env: Env, meta: OwnerRecovery, erased: boolean): Promise<void> {
  const { ringName } = await import('@/learn/fan'), { loadTombstone } = await import('./erasure');
  // Persist the cleanup debt before deleting its body or losing destination references.
  await storage.transaction(async tx => {
    await tx.put(metaKey(meta.id), recoveryCleanup(meta, erased, meta.cleanup === 'retired'));
    for (let i = 0; i < meta.chunks; i++) await tx.delete(chunkKey(meta.id, i));
  });
  // Immutable local expiry is sufficient to remove the body even while R2 is
  // unavailable; remote barrier/child reads affect cleanup debt only.
  const barrier = await loadTombstone(env.STORAGE, meta.tenant, meta.subject);
  if (erased && !barrier) { await armRecovery(storage, Date.now() + 30_000); throw new Error('Erasure cleanup barrier unavailable'); }
  for (const name of meta.destinations) {
    if (!env.LEARN_STATS) throw new Error('Learning cleanup unavailable');
    const response = await env.LEARN_STATS.get(env.LEARN_STATS.idFromName(name)).fetch('https://learn/cleanup-effects', {
      method: 'POST', body: JSON.stringify({ tenant: meta.tenant, subject: meta.subject, ...(meta.cleanup === 'retired' ? { retired: true } : {}) }),
    });
    const result = await response.json() as { ok?: boolean; complete?: boolean; next?: number };
    if (!response.ok || result.ok !== true || result.complete !== true) {
      await armRecovery(storage, Number.isSafeInteger(result.next) && result.next! > Date.now() ? result.next! : Date.now() + 30_000);
      throw new Error('Learning cleanup pending');
    }
  }
  if (meta.learning !== false) {
    if (!env.DECISION_RING) throw new Error('Attribution cleanup unavailable');
    const ring = await env.DECISION_RING.get(env.DECISION_RING.idFromName(ringName(meta.tenant, meta.subject))).fetch('https://learn/' + (meta.cleanup === 'retired' ? 'retire' : 'erase'), {
      method: 'POST', body: JSON.stringify({ tenant: meta.tenant, visitorId: meta.subject }),
    });
    if (!ring.ok || (await ring.json() as { ok?: boolean }).ok !== true) { await armRecovery(storage, Date.now() + 30_000); throw new Error('Attribution cleanup pending'); }
  }
  await storage.transaction(async tx => {
    await tx.put('recoveryTerminal:' + meta.id, { digest: meta.digest, records: meta.records,
      state: erased ? 'suppressed_erased' : meta.receipt.source.state === 'recovered' ? 'recovered' : 'expired_unrecovered' });
    await tx.delete(metaKey(meta.id));
  });
}

export async function recoverDecisions(env: Env, set: { tenant: string; brand: string; visitor_id: string; records: DecisionRecord[] }, config: (slot: string) => SlotLearnConfig, firstAdmissionUntil?: number): Promise<RecoveryReceipt> {
  if (!durableRecoveryEnabled(env)) throw new RecoveryUnavailableError('Recovery admission disabled');
  // Register the owner-held I/O before yielding; a dynamic import here could
  // otherwise resume only after the caller's owner invocation has drained.
  return admitOwnedRecovery({ kind: 'decisions', tenant: set.tenant, subject: set.visitor_id, brand: set.brand,
    records: set.records, configs: Object.fromEntries([...new Set(set.records.map(row => row.slot))].map(slot => [slot, config(slot)])),
    ...(firstAdmissionUntil === undefined ? {} : { firstAdmissionUntil }) });
}

/** A queue repair cannot turn a current operator into fresh shopper authority. */
export async function authorizeRecoveryBodies(storage: DurableObjectStorage, env: Env, tenant: string, subject: string, bodies: unknown[],
  guard: (principal: SessionCapability, until: number) => Promise<void>): Promise<void> {
  const { readDelivery } = await import('./delivery'), { loadTombstone } = await import('./erasure');
  const barrier = await loadTombstone(env.STORAGE, tenant, subject);
  for (const body of bodies) {
    const delivery = readDelivery(body), owned = delivery.messages.filter(message => message.record.tenant === tenant && message.record.visitor_id === subject);
    if (!owned.length || owned.every(message => barrier && message.record.ts <= barrier.erased_at)) continue;
    const reference = (body as { recovery_id?: unknown }).recovery_id;
    if (typeof reference !== 'string' || !/^[a-f0-9]{64}$/.test(reference)) throw new Error('Original owner admission unavailable');
    const meta = await storage.get<OwnerRecovery>(metaKey(reference));
    if (!meta || meta.cleanup || meta.tenant !== tenant || meta.subject !== subject || meta.expiresAt <= Date.now()) throw new Error('Original owner admission unavailable');
    await guard(meta.principal, meta.consentUntil);
    requireRetention(env, meta.retention, tenant, 'recovery');
    const payload = await payloadOf(storage, meta);
    if (!payload.messages.some(message => recoveryJSON(message.body) === recoveryJSON(body))) throw new Error('Original delivery conflict');
    const { pinRetention, pinRecoveryDeadline } = await import('@/identity/sessionAuthority');
    pinRetention(env, meta.retention, tenant, 'recovery'); pinRecoveryDeadline(meta.expiresAt);
  }
}

export async function recoveryOwnershipProof(storage: DurableObjectStorage, tenant: string, subject: string, wire: string) {
  const body = JSON.parse(wire) as { recovery_id?: unknown }, id = body.recovery_id;
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Original owner evidence unavailable');
  const meta = await storage.get<OwnerRecovery>(metaKey(id));
  if (!meta || meta.cleanup || meta.tenant !== tenant || meta.subject !== subject || !meta.principal.grantId || !meta.principal.authorityEpoch) throw new Error('Original owner evidence unavailable');
  const payload = await payloadOf(storage, meta);
  if (!payload.messages.some(message => JSON.stringify(message.body) === wire)) throw new Error('Original wire evidence unavailable');
  return { tenant, subject, admission: id, expiresAt: meta.expiresAt };
}

export async function authorizeRecoverySurvivors(storage: DurableObjectStorage, env: Env, value: import('./quarantine').QuarantineCase,
  tenant: string, subject: string, guard: (principal: SessionCapability, until: number) => Promise<void>): Promise<void> {
  if (!value.ownership) return; // Historical managed claims retain their original protocol, never a fabricated shopper grant.
  const meta = await storage.get<OwnerRecovery>(metaKey(value.ownership.admission));
  if (!meta || meta.cleanup || meta.tenant !== tenant || meta.subject !== subject || meta.expiresAt <= Date.now()) throw new Error('Original recovery authority unavailable');
  await guard(meta.principal, meta.consentUntil);
  const payload = await payloadOf(storage, meta), { readDelivery, DELIVERY_FIELD } = await import('./delivery');
  const original = payload.messages.map(message => readDelivery(message.body)).find(delivery => delivery.id === value.survivors!.deliveryId);
  if (!original || original.messages.length !== value.survivors!.originalCount) throw new Error('Original recovery delivery unavailable');
  for (const row of value.survivors!.rows) {
    const message = original.messages[row.ordinal];
    if (!message || JSON.stringify({ ...message.record, [DELIVERY_FIELD]: { id: original.id, ordinal: row.ordinal } }) !== row.wire) throw new Error('Original recovery survivor conflict');
  }
  const { pinRetention, pinRecoveryDeadline } = await import('@/identity/sessionAuthority');
  pinRetention(env, meta.retention, tenant, 'recovery'); pinRecoveryDeadline(meta.expiresAt);
}

/** Authority retirement removes local raw work immediately, retaining only
 * bounded cleanup references until the original sink markers are disposed. */
export async function retireOwnerRecovery(storage: DurableObjectStorage): Promise<void> {
  const entries = await storage.list<OwnerRecovery>({ prefix: 'recoveryOperation:', limit: RECOVERY_LIMITS.operations + 1 });
  if (entries.size > RECOVERY_LIMITS.operations) throw new Error('Recovery capacity exceeded');
  await storage.transaction(async tx => {
    for (const [key, meta] of entries) {
      if (meta.cleanup) continue;
      await tx.put(key, recoveryCleanup(meta, false, true));
      for (let i = 0; i < meta.chunks; i++) await tx.delete(chunkKey(meta.id, i));
    }
    if (entries.size) await tx.setAlarm(Date.now() + 1);
  });
}
