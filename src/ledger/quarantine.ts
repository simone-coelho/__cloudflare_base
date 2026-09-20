import type { Env } from '@/types/env';
import { z } from 'zod';
import { tenantConfig } from '@/tenancy/middleware';
import { readDelivery, byteLength, digest as wireDigest, DELIVERY_FIELD, recordEvidenceLoss, validCaptureReceipt, type DeliverySurvivors, type Delivery, type CaptureReceipt } from './delivery';
import { consumeLedger, consumeSurvivors } from './consume';
import { expandLedgerMessage, prepareDeliveryClaims } from './writer';
import { recoveryDigest, recoveryJSON, RECOVERY_LIMITS } from './recovery';
import { retentionBirth, retentionPolicy, readRetention, type RetentionStamp } from '@/retention';
import { shopperObjectName } from '@/tenancy/objects';
import { loadTombstone } from './erasure';

const name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/);
const policy = z.object({ id: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/), revision: z.number().int().positive(),
  durationMs: z.number().int().positive().safe(), basis: z.literal('admitted'), renewal: z.literal('new-record-only'),
  disposal: z.literal('delete-on-expiry') }).strict();
const configuration = z.object({ version: z.literal(1), sourceQueue: name, deadLetterQueue: name, unknown: policy.optional() }).strict()
  .refine(value => value.sourceQueue !== value.deadLetterQueue);
export type RecoveryConfiguration = z.infer<typeof configuration>;
export function recoveryConfiguration(env: Env): RecoveryConfiguration {
  if (env.LEDGER_RECOVERY_ENABLED !== undefined && !['false', 'true'].includes(env.LEDGER_RECOVERY_ENABLED)) throw new Error('Recovery intent unavailable');
  return configuration.parse(JSON.parse(env.LEDGER_RECOVERY_CONFIG ?? 'null'));
}
export function recoveryReady(env: Env): boolean {
  try {
    if (env.LEDGER_RECOVERY_ENABLED !== 'true') return false;
    const config = recoveryConfiguration(env);
    if (!config.unknown || !env.EVENT_QUEUE || !env.STORAGE || !env.SHOPPER_REFLEX || !env.DECISION_RING || !env.LEARN_STATS) return false;
    for (const tenant of tenantConfig(env).provisioned) for (const category of ['ledger', 'online', 'recovery', 'quarantine'] as const) retentionPolicy(env, tenant, category);
    return true;
  } catch { return false; }
}

export type CaseState = 'pending' | 'recovered' | 'suppressed_erased' | 'expired_unrecovered' | 'irrecoverable' | 'disposal_pending';
export interface QuarantineCase {
  version: 1; id: string; digest: string; revision: number; tenant: string | null;
  provenance: string;
  source: { queue: string; message: string }; admittedAt: number; expiresAt: number;
  retention: RetentionStamp | z.infer<typeof policy>; state: CaseState;
  safety: 'managed' | 'unsafe_history'; records: number | null; wire?: string;
  ownership?: { tenant: string; subject: string; admission: string; expiresAt: number };
  survivors?: DeliverySurvivors;
  /** Recognizable legacy rows remain unsafe for replay, but are erasable. */
  legacyRows?: string[];
  sink?: CaptureReceipt; terminalLoss: number | null;
}
export const quarantinePrefix = 'ledger-quarantine/v1/';
const idSchema = z.string().regex(/^[a-f0-9]{64}$/);
const keyOf = (id: string) => quarantinePrefix + idSchema.parse(id) + '.json';
const maximumCaseBytes = 1024 * 1024;
type LoadedCase = { value: QuarantineCase; etag: string };
async function provenance(env: Env, value: QuarantineCase): Promise<string> {
  if (typeof env.IDENTITY_SALT !== 'string' || env.IDENTITY_SALT.trim().length < 32) throw new Error('Quarantine provenance key unavailable');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.IDENTITY_SALT.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const identity = { version: value.version, id: value.id, digest: value.digest, tenant: value.tenant, ownership: value.ownership ?? null,
    source: value.source, admittedAt: value.admittedAt, expiresAt: value.expiresAt, retention: value.retention, safety: value.safety, records: value.records,
    survivors: value.survivors ?? null, legacyRows: value.legacyRows ?? null };
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(recoveryJSON(identity))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadQuarantine(env: Env, id: string): Promise<LoadedCase | null> {
  const object = await env.STORAGE.get(keyOf(id));
  if (object === null) return null;
  if (!object.etag || object.size > maximumCaseBytes) throw new Error('Quarantine state unavailable');
  const text = await object.text();
  if (byteLength(text) > maximumCaseBytes) throw new Error('Quarantine capacity exceeded');
  const value = JSON.parse(text) as QuarantineCase;
  if (value.version !== 1 || value.id !== id || !idSchema.safeParse(value.digest).success
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.expiresAt)
    || !['pending', 'recovered', 'suppressed_erased', 'expired_unrecovered', 'irrecoverable', 'disposal_pending'].includes(value.state)
    || !['managed', 'unsafe_history'].includes(value.safety) || (value.records !== null && (!Number.isSafeInteger(value.records) || value.records < 0))
    || (value.wire !== undefined && (typeof value.wire !== 'string' || await recoveryDigest(value.wire) !== value.digest))
    || typeof value.source?.queue !== 'string' || typeof value.source?.message !== 'string'
    || !Number.isSafeInteger(value.admittedAt) || value.admittedAt < 0 || value.expiresAt < 0
    || (value.tenant !== null && (!value.ownership || value.ownership.tenant !== value.tenant
      || !idSchema.safeParse(value.ownership.admission).success || !/^[A-Za-z0-9_.-]{1,200}$/.test(value.ownership.subject)
      || !Number.isSafeInteger(value.ownership.expiresAt)))) throw new Error('Quarantine commitment unavailable');
  if (value.tenant) readRetention(value.retention, value.tenant, 'quarantine');
  else policy.parse(value.retention);
  if (value.id !== await recoveryDigest({ version: 1, queue: value.source.queue, messageId: value.source.message })
    || value.provenance !== await provenance(env, value)) throw new Error('Quarantine provenance conflict');
  if (value.survivors) {
    const { proof, ...original } = value.survivors;
    if (value.wire !== undefined || value.safety !== 'managed' || original.originalCount !== value.records
      || !Array.isArray(original.rows) || !original.rows.length || proof !== await recoveryDigest({ original: value.digest, ...original })) throw new Error('Quarantine survivor commitment conflict');
  }
  if (value.wire !== undefined && value.ownership) {
    const delivery = readDelivery(JSON.parse(value.wire));
    if (delivery.messages.some(message => message.record.tenant !== value.ownership!.tenant || message.record.visitor_id !== value.ownership!.subject)
      || (JSON.parse(value.wire) as { recovery_id?: unknown }).recovery_id !== value.ownership.admission) throw new Error('Quarantine ownership conflict');
  }
  return { value, etag: object.etag };
}
async function saveCase(env: Env, value: QuarantineCase, etag?: string): Promise<void> {
  value.provenance = await provenance(env, value);
  const body = recoveryJSON(value), key = keyOf(value.id);
  if (byteLength(body) > maximumCaseBytes) throw new Error('Quarantine capacity exceeded');
  const put = await env.STORAGE.put(key, body, { onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
    customMetadata: { tenant: value.tenant ?? '', digest: value.digest }, httpMetadata: { contentType: 'application/json' } });
  if (!put || put.key !== key || !put.etag || put.size !== byteLength(body)) throw new Error('Quarantine acknowledgement unavailable');
}
export function publicCase(value: QuarantineCase) {
  return { version: value.version, id: value.id, digest: value.digest, revision: value.revision, tenant: value.tenant,
    state: value.state, safety: value.safety, source: { operations: 1, records: value.records },
    effects: value.sink ?? null, terminalLoss: value.terminalLoss, admittedAt: value.admittedAt, expiresAt: value.expiresAt };
}

/** A DLQ acknowledgement means exact durable capture, never a diagnostic write. */
export async function captureQuarantine(env: Env, queue: string, messageId: string, body: unknown): Promise<QuarantineCase> {
  const config = recoveryConfiguration(env);
  if (queue !== config.deadLetterQueue || typeof messageId !== 'string' || !messageId || messageId.length > 256) throw new Error('DLQ provenance unavailable');
  const text = quarantineWire(body);
  if (byteLength(text) > 256 * 1024) throw new Error('Quarantine body exceeded');
  body = JSON.parse(text);
  const id = await recoveryDigest({ version: 1, queue, messageId }), digest = await recoveryDigest(text), existing = await loadQuarantine(env, id);
  if (existing) {
    if (existing.value.digest !== digest || existing.value.source.queue !== queue || existing.value.source.message !== messageId) throw new Error('DLQ identity conflict');
    return existing.value;
  }
  let delivery: Delivery | undefined;
  try { delivery = readDelivery(body); if (expandLedgerMessage(body).length !== delivery.messages.length) delivery = undefined; }
  catch { /* Unknown and legacy input never acquire managed proof. */ }
  let ownership: QuarantineCase['ownership'];
  const recognized = expandLedgerMessage(body), first = delivery?.messages[0]?.record;
  if (first && delivery!.messages.every(message => message.record.tenant === first.tenant && message.record.visitor_id === first.visitor_id)
    && tenantConfig(env).provisioned.includes(first.tenant)) {
    try {
      const response = await env.SHOPPER_REFLEX.get(env.SHOPPER_REFLEX.idFromName(shopperObjectName(first.tenant, first.visitor_id)))
        .fetch('https://owner/identity/recovery/proof', { method: 'POST', headers: { 'Content-Type': 'application/json',
          'X-Reflex-Tenant': first.tenant, 'X-Reflex-Subject': first.visitor_id }, body: JSON.stringify({ wire: text }) });
      const result = await response.json() as { ok?: boolean; proof?: QuarantineCase['ownership'] };
      if (response.ok && result.ok === true && result.proof?.tenant === first.tenant && result.proof.subject === first.visitor_id
        && idSchema.safeParse(result.proof.admission).success && Number.isSafeInteger(result.proof.expiresAt)) ownership = result.proof;
    } catch { /* No receipt means unassigned, never guessed tenant-admin ownership. */ }
  }
  const tenant = ownership?.tenant ?? null;
  if (delivery && Object.hasOwn(body as object, 'recovery_id') && !ownership) {
    const erased = await Promise.all(delivery.messages.map(async message => {
      const barrier = await loadTombstone(env.STORAGE, message.record.tenant, message.record.visitor_id);
      return !!barrier && message.record.ts <= barrier.erased_at;
    }));
    if (!erased.every(Boolean)) throw new Error('Original recovery authority unavailable');
  }
  const now = Date.now();
  let retention: QuarantineCase['retention'], expiresAt: number;
  if (tenant) {
    retention = retentionBirth(env, tenant, 'quarantine', Math.min(...delivery!.messages.map(message => message.record.ts)), now);
    expiresAt = Math.min(retention.expiresAt, ownership!.expiresAt);
  } else {
    if (!config.unknown) throw new Error('Unknown-owner retention/disposal unavailable');
    retention = config.unknown; expiresAt = now + retention.durationMs;
    if (!Number.isSafeInteger(expiresAt)) throw new Error('Unknown-owner retention unavailable');
  }
  // Even unassigned/mixed history cannot gain a longer original row lifetime.
  for (const message of recognized) if (delivery || message.record.retention?.ledger) {
    const stamp = readRetention(message.record.retention?.ledger, message.record.tenant, 'ledger');
    expiresAt = Math.min(expiresAt, stamp.expiresAt);
  }
  const expired = expiresAt <= now;
  const value: QuarantineCase = { version: 1, id, digest, provenance: '', revision: 1, tenant, source: { queue, message: messageId },
    admittedAt: now, expiresAt, retention, state: expired ? 'expired_unrecovered' : 'pending', safety: delivery ? 'managed' : 'unsafe_history',
    records: recognized.length || null, ...(ownership ? { ownership } : {}), ...(expired ? {} : { wire: text }),
    terminalLoss: expired ? null : 0 };
  value.provenance = await provenance(env, value);
  if (recognized.length) {
    const { ledgerUnderOwners } = await import('@/identity/sessionAuthority');
    const captured = await ledgerUnderOwners<QuarantineCase>(env, { kind: 'quarantine', value, wire: text });
    await countExhausted(env, recognized);
    return captured;
  }
  try { await saveCase(env, value); }
  catch (error) {
    // A lost PUT response is reconciled read-only. Never assign a new identity/birth.
    const won = await loadQuarantine(env, id);
    if (!won || won.value.digest !== digest || won.value.source.queue !== queue || won.value.source.message !== messageId) throw error;
    return won.value;
  }
  await countExhausted(env, recognized);
  return value;
}

/**
 * W22 R1.01: a message whose retries were exhausted is a row that never reached
 * the ledger, counted against the tenant its own records name (N10; F16 §7.2).
 * It is counted once per newly admitted case: a repeated DLQ delivery of the
 * same message returns the existing case above without reaching here. The case
 * itself may carry no tenant — shopper ownership is a separate, stronger proof —
 * so the count is attributed from the recognized rows, never invented.
 */
async function countExhausted(env: Env, recognized: ReturnType<typeof expandLedgerMessage>): Promise<void> {
  try {
    if (!recognized.length) return;
    const provisioned = tenantConfig(env).provisioned;
    const byTenant = new Map<string, number>();
    for (const message of recognized) {
      const tenant = message.record.tenant;
      if (provisioned.includes(tenant)) byTenant.set(tenant, (byTenant.get(tenant) ?? 0) + 1);
    }
    for (const [tenant, rows] of byTenant) await recordEvidenceLoss(env, tenant, 'retriesExhausted', rows);
  } catch { /* the capture stands whatever the counter does */ }
}

/** The exact sorted owner chain excludes erasure through the actual case PUT.
 * Delayed queue arrivals are sanitized even after an earlier scan completed. */
export async function captureQuarantineHeld(env: Env, value: QuarantineCase, wire: string): Promise<QuarantineCase> {
  if (await recoveryDigest(wire) !== value.digest || value.provenance !== await provenance(env, value)) throw new Error('Quarantine provenance conflict');
  const existing = await loadQuarantine(env, value.id);
  if (existing) { if (existing.value.digest !== value.digest) throw new Error('Quarantine identity conflict'); return existing.value; }
  const body = JSON.parse(wire), messages = expandLedgerMessage(body), surviving: Array<{ ordinal: number; wire: string }> = [];
  if (!messages.length) throw new Error('Recognizable quarantine owner unavailable');
  const delivery = value.safety === 'managed' ? readDelivery(body) : undefined;
  let suppressed = 0, expired = 0;
  for (const [ordinal, message] of messages.entries()) {
    const row = message.record, barrier = await loadTombstone(env.STORAGE, row.tenant, row.visitor_id);
    if (barrier && row.ts <= barrier.erased_at) { suppressed++; continue; }
    if (value.expiresAt <= Date.now() || row.retention?.ledger && readRetention(row.retention.ledger, row.tenant, 'ledger').expiresAt <= Date.now()) { expired++; continue; }
    surviving.push({ ordinal, wire: JSON.stringify(delivery ? { ...row, [DELIVERY_FIELD]: { id: delivery.id, ordinal } } : message) });
  }
  if (suppressed || expired) {
    delete value.wire;
    if (surviving.length && delivery) {
      const prepared = await prepareDeliveryClaims(env.STORAGE, [delivery]).catch(() => null);
      const original = { deliveryId: delivery.id, originalCount: delivery.messages.length,
        identityDigest: await wireDigest(JSON.stringify(delivery.messages.map(message => ({ type: message.type, record: message.record })))),
        claims: prepared?.claims ?? {}, rows: surviving, suppressed, expired };
      value.survivors = { ...original, proof: await recoveryDigest({ original: value.digest, ...original }) };
    } else if (surviving.length) value.legacyRows = surviving.map(row => row.wire);
    else {
      value.state = expired ? 'expired_unrecovered' : 'suppressed_erased'; value.terminalLoss = expired ? null : 0;
    }
  }
  // A preceding claim/barrier await may cross even the unassigned-case deadline.
  if (value.expiresAt <= Date.now()) { delete value.wire; delete value.survivors; delete value.legacyRows; value.state = 'expired_unrecovered'; value.terminalLoss = null; }
  try { await saveCase(env, value); }
  catch (error) {
    const observed = await loadQuarantine(env, value.id);
    if (!observed || observed.value.digest !== value.digest) throw error;
    return observed.value;
  }
  return value;
}

export async function listQuarantine(env: Env, tenant: string | null, after?: string) {
  if (after !== undefined) idSchema.parse(after);
  const page = await env.STORAGE.list({ prefix: quarantinePrefix, limit: RECOVERY_LIMITS.cases,
    ...(after ? { startAfter: keyOf(after) } : {}) });
  const items = [];
  for (const object of page.objects) {
    const id = object.key.slice(quarantinePrefix.length, -5); idSchema.parse(id);
    const current = await loadQuarantine(env, id);
    if (current?.value.tenant === tenant) items.push(publicCase(current.value));
  }
  return { items, next: page.truncated && page.objects.length ? page.objects.at(-1)!.key.slice(quarantinePrefix.length, -5) : null };
}

export async function operateQuarantine(env: Env, id: string, expected: { digest: string; revision: number },
  action: 'redrive' | 'resolve', disposition: 'irrecoverable' | 'disposal_pending' | undefined,
  authorize: (tenant: string | null) => Promise<void>): Promise<ReturnType<typeof publicCase>> {
  const loaded = await loadQuarantine(env, id);
  if (!loaded || loaded.value.digest !== expected.digest || loaded.value.revision !== expected.revision) throw new Error('Quarantine revision conflict');
  const value = loaded.value;
  await authorize(value.tenant);
  if (action === 'redrive') {
    if (value.state !== 'pending' || value.safety !== 'managed' || (value.wire === undefined && !value.survivors) || value.expiresAt <= Date.now()) throw new Error('Safe redrive unavailable');
    // No producer call: retain the original body, ID, ordering and managed claims.
    const sink = value.survivors ? await consumeSurvivors(env, value)
      : (await consumeLedger(env, [JSON.parse(value.wire!)], Date.now(), undefined, !!value.ownership, value.expiresAt)).capture;
    if (!validCaptureReceipt(sink, value.records!)) throw new Error('Quarantine sink acknowledgement unavailable');
    value.sink = sink;
    if (sink?.ok) {
      value.state = sink.suppressed === sink.total ? 'suppressed_erased' : 'recovered';
      delete value.wire; delete value.survivors;
    }
  } else {
    if (!disposition || !['irrecoverable', 'disposal_pending'].includes(disposition)) throw new Error('Terminal disposition unavailable');
    if (value.state !== 'pending' && value.state !== 'disposal_pending') throw new Error('Terminal case cannot change disposition');
    value.state = disposition;
    value.terminalLoss = value.sink && value.sink.unknown === 0 && value.sink.notAttempted === 0 ? 0 : null;
    // Irrecoverable is recorded loss. Disposal remains distinct and requires
    // its original configured policy; neither is reported as recovered.
    // Loss classification is not permission for early physical disposal.
  }
  await authorize(value.tenant);
  value.revision++;
  await saveCase(env, value, loaded.etag);
  return publicCase(value);
}

export async function expireQuarantine(env: Env, tenant: string | null, after?: string) {
  const page = await env.STORAGE.list({ prefix: quarantinePrefix, limit: RECOVERY_LIMITS.cases,
    ...(after ? { startAfter: keyOf(after) } : {}) });
  let removed = 0, unresolved = 0;
  for (const object of page.objects) {
    try {
    const current = await loadQuarantine(env, object.key.slice(quarantinePrefix.length, -5));
    if (!current) throw new Error('Quarantine expiry read unavailable');
    if (current.value.tenant !== tenant || current.value.expiresAt > Date.now()
      || (current.value.wire === undefined && current.value.survivors === undefined && current.value.legacyRows === undefined)) continue;
    const value = current.value;
    delete value.wire; delete value.survivors; delete value.legacyRows; value.revision++; value.state = 'expired_unrecovered';
    value.terminalLoss = value.sink && value.sink.unknown === 0 && value.sink.notAttempted === 0 ? 0 : null;
    await saveCase(env, value, current.etag); removed++;
    } catch { unresolved++; } // Keep invalid/uncertain evidence; wrapping the scan retries it.
  }
  if (page.truncated && !page.objects.length) throw new Error('Quarantine expiry continuation unavailable');
  return { removed, unresolved, next: page.truncated && page.objects.length ? page.objects.at(-1)!.key.slice(quarantinePrefix.length, -5) : null };
}

/** Physical erasure keeps the immutable claims and surviving row ordinals. A
 * filtered original envelope is never presented as a new managed delivery. */
export async function eraseQuarantineSubject(env: Env, tenant: string, subject: string, cutoff: number): Promise<boolean> {
  const journalKey = 'ledger-quarantine-erasure/' + await recoveryDigest({ tenant, subject }) + '.json';
  const previous = await env.STORAGE.get(journalKey);
  const saved = previous ? JSON.parse(await previous.text()) as { cutoff: number; cursor: string | null; complete: boolean; unresolved?: boolean } : null;
  if (saved && (!Number.isSafeInteger(saved.cutoff) || typeof saved.complete !== 'boolean' || (saved.cursor !== null && typeof saved.cursor !== 'string')
    || (saved.unresolved !== undefined && typeof saved.unresolved !== 'boolean') || (saved.complete && saved.unresolved))) throw new Error('Quarantine erasure journal unavailable');
  if (saved?.cutoff === cutoff && saved.complete) return true;
  const cursor = saved?.cutoff === cutoff ? saved.cursor : null;
  // Carry uncertainty across pages. At wrap, begin another complete pass: bad
  // cases remain discoverable without an unbounded list of failed raw keys.
  let unresolved = cursor !== null && saved?.unresolved === true;
  const page = await env.STORAGE.list({ prefix: quarantinePrefix, limit: RECOVERY_LIMITS.cases, ...(cursor ? { cursor } : {}) });
  for (const object of page.objects) {
    try {
    const loaded = await loadQuarantine(env, object.key.slice(quarantinePrefix.length, -5));
    if (!loaded) throw new Error('Quarantine erasure read unavailable');
    const value = loaded.value;
    let delivery: Delivery | undefined;
    if (value.wire !== undefined) try { delivery = readDelivery(JSON.parse(value.wire)); } catch { /* Unassigned unknown bodies cannot invent an owner. */ }
    if (!delivery && !value.survivors) {
      const legacy = value.legacyRows?.map(row => JSON.parse(row)) ?? (value.wire === undefined ? [] : expandLedgerMessage(JSON.parse(value.wire)));
      const matches = legacy.filter(message => message.record.tenant === tenant && message.record.visitor_id === subject && message.record.ts <= cutoff);
      if (!matches.length) continue;
      const barrier = await loadTombstone(env.STORAGE, tenant, subject);
      if (!barrier || barrier.erased_at < cutoff) throw new Error('Quarantine erasure barrier unavailable');
      const remaining = legacy.filter(message => !matches.includes(message));
      delete value.wire; value.revision++;
      if (remaining.length) value.legacyRows = remaining.map(message => JSON.stringify(message));
      else { delete value.legacyRows; value.state = 'suppressed_erased'; value.terminalLoss = 0; }
      await saveCase(env, value, loaded.etag); continue;
    }
    const existing = value.survivors;
    const rows = delivery ? delivery.messages.map((message, ordinal) => ({ ordinal, wire: JSON.stringify({ ...message.record,
      [DELIVERY_FIELD]: { id: delivery!.id, ordinal } }) })) : existing?.rows;
    if (!rows) continue;
    const matching = rows.filter(row => {
      const record = JSON.parse(row.wire) as { tenant?: string; visitor_id?: string; ts?: number };
      return record.tenant === tenant && record.visitor_id === subject && typeof record.ts === 'number' && record.ts <= cutoff;
    });
    if (!matching.length) continue;
    const barrier = await loadTombstone(env.STORAGE, tenant, subject);
    if (!barrier || barrier.erased_at < cutoff) throw new Error('Quarantine erasure barrier unavailable');
    const surviving = rows.filter(row => !matching.includes(row));
    if (!surviving.length) {
      // No replay proof is needed to dispose all raw rows. A conflicting
      // historical claim must not make physical erasure impossible.
      delete value.wire; delete value.survivors; value.revision++; value.state = 'suppressed_erased'; value.terminalLoss = 0;
      await saveCase(env, value, loaded.etag); continue;
    }
    let claims = existing?.claims;
    if (!claims) {
      const prepared = await prepareDeliveryClaims(env.STORAGE, [delivery!]).catch(() => null);
      // Missing/unreadable/conflicting proof must not delay erasure or discard
      // exact live ordinals. A later read may recover existing matching v2
      // claims, but can never create claims from a filtered original body.
      claims = prepared?.claims ?? {};
    }
    const original = { deliveryId: delivery?.id ?? existing!.deliveryId, originalCount: delivery?.messages.length ?? existing!.originalCount,
      identityDigest: delivery ? await wireDigest(JSON.stringify(delivery.messages.map(message => ({ type: message.type, record: message.record })))) : existing!.identityDigest,
      claims, rows: surviving, suppressed: (existing?.suppressed ?? 0) + matching.length, expired: existing?.expired ?? 0 };
    value.survivors = { ...original, proof: await recoveryDigest({ original: value.digest, ...original }) };
    delete value.wire; value.revision++;
    if (!surviving.length) { value.state = 'suppressed_erased'; value.terminalLoss = 0; delete value.survivors; }
    await saveCase(env, value, loaded.etag);
    } catch { unresolved = true; }
  }
  if (page.truncated && !page.cursor) throw new Error('Quarantine erasure continuation unavailable');
  const complete = !page.truncated && !unresolved;
  const body = JSON.stringify({ cutoff, cursor: page.truncated ? page.cursor : null, complete, unresolved });
  const put = await env.STORAGE.put(journalKey, body, { onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } });
  if (!put?.etag) throw new Error('Quarantine erasure acknowledgement unavailable');
  return complete;
}

function quarantineWire(value: unknown): string {
  const pending = [value], seen = new Set<object>(); let work = 0;
  while (pending.length) {
    const next = pending.pop();
    if (++work > 256 * 1024) throw new Error('Quarantine body exceeded');
    if (next === null || typeof next === 'string' || typeof next === 'boolean' || (typeof next === 'number' && Number.isFinite(next))) continue;
    if (!next || typeof next !== 'object' || seen.has(next) || Object.getOwnPropertySymbols(next).length
      || (!Array.isArray(next) && ![Object.prototype, null].includes(Object.getPrototypeOf(next)))) throw new Error('Unsupported DLQ representation');
    seen.add(next);
    if (Array.isArray(next) && (Object.keys(next).length !== next.length || next.some((_, index) => !Object.hasOwn(next, index)))) throw new Error('Unsupported DLQ representation');
    for (const key of Object.keys(next)) {
      const property = Object.getOwnPropertyDescriptor(next, key);
      if (!property || !Object.hasOwn(property, 'value') || key === 'toJSON') throw new Error('Unsupported DLQ representation');
      pending.push(property.value);
    }
  }
  return JSON.stringify(value);
}
