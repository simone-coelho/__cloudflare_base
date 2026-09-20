// src/durable-objects/DecisionRing.ts
// The visitor's own object for what she was shown (doc 22 §3.3, §4.3): the
// 200-deep ring of served decisions, a long index of ids, and online
// attribution. One writer, itself. When an outcome arrives it applies the
// learning policy against the ring, emits credited pairs to each slot's
// statistics object, and moves on. No global join anywhere.

import type { Env } from '@/types/env';
import { SyntheticObjectBoundary } from '@/ops/synthetic';
import type { DecisionRecord } from '@/content/types';
import { parseId, type OutcomeRecord } from '@/ledger/records';
import { loadTombstone } from '@/ledger/erasure';
import { isLedgerMessage } from '@/ledger/writer';
import { logicalIdentity } from '@/ledger/delivery';
import { attribute, creditWeight, type AttributionPolicy, type RingEntry } from '@/learn/policy';
// Must precede the '@/learn/fan' import below: the fan-out binds its own
// ONLINE_RING_REACH_MS to this object's re-export at module scope, so the
// module that declares the value has to be evaluated before the fan-out's body.
import { RING_MAX_AGE_MS } from '@/learn/stats';
import { deliverStats, emptyStatsDelivery, learningGenerations, ringEntryOf, statsName, sumStatsDeliveries, type AppendReceipt, type OutcomeReceipt, type SlotLearnConfig, type StatsDelivery } from '@/learn/fan';
import { requireRetention, readRetention, mergeRetention, type RetentionStamp } from '@/retention';
import { recoveryDigest, learningEffectId, RECOVERY_LIMITS, type LearningEffect } from '@/ledger/recovery';

const RING_MAX = 200;
/**
 * How far back this ring reaches. Exported because it is not this object's
 * private business: the online fan-out declares it as the horizon it actually
 * applied and the statistics object forgets a delivery at the same moment, so
 * every reader names the same constant instead of restating its value
 * (W22 A1.02). It is declared in `@/learn/stats`, which neither this object nor
 * the fan-out can cycle with, and re-exported here because this is the object
 * that enforces it.
 */
export { RING_MAX_AGE_MS };
const INDEX_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** Application admission budgets, not a native capacity or 200-full-record guarantee. */
export const RING_LIMITS = { requestBytes: 1024 * 1024, rows: 1000, stateBytes: 1024 * 1024, index: 4096, idBytes: 2048,
  totalBytes: 4 * 1024 * 1024, repairBytes: 8 * 1024 * 1024, repairRows: 32768 } as const;

class Capacity extends Error {}
class Collision extends Error {}
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).byteLength;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object'
  && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Complete JSON equality without recursion or serialized key-order dependence.
 * Work and pending pairs are bounded by the already admitted record payloads. */
function sameRecord(left: DecisionRecord, right: DecisionRecord): boolean {
  const pending: Array<[unknown, unknown]> = [[left, right]];
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (a === b) continue;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) pending.push([a[i], b[i]]);
    } else {
      if (!object(a) || !object(b)) return false;
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(b, key)) return false;
        pending.push([a[key], b[key]]);
      }
    }
  }
  return true;
}

/** Count the actual stream before JSON parsing; Content-Length is not authority. */
async function bodyOf(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let size = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RING_LIMITS.requestBytes) throw new Capacity();
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    try { await reader.cancel(); } catch { /* A failed cancellation does not change the refusal. */ }
    if (error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  } finally { reader.releaseLock(); }
}

/**
 * W22 D1.02 (F16 §7: "carry a bounded set of recently credited `outcome_id`s in
 * `DecisionRing`'s stored state … and drop a repeat before `attribute()`";
 * §2.3 measured one outcome credited twice).
 *
 * The journal is this object's own state, under its own key, so it never
 * competes with the ring for the 200 receipts a visitor keeps. It is BOUNDED
 * three ways and pruned in this order: an entry past its own online retention
 * goes first, then an entry older than the ring's horizon, then the oldest
 * entries until both caps below hold. At the caps it is at most 256 KiB inside
 * `RING_LIMITS.stateBytes` (1 MiB), and it is charged against the object's
 * `RING_LIMITS.totalBytes` (4 MiB) together with the ring and the credit plans.
 *
 * A repeat that arrives after its entry has been pruned is credited again: the
 * unit that drives this never claims otherwise, and the residual is named.
 * Only an outcome whose logical identity is STABLE is journalled — an old
 * outcome id with no event nonce can be two genuinely distinct events (F16
 * §5(j)), and dropping the second would drop a real credit.
 */
const CREDITED_KEY = 'credited';
const CREDITED_MAX_BYTES = 256 * 1024;
const CREDITED_MAX_ROWS = 4096;
interface CreditedOutcome { id: string; ts: number; expiresAt: number }

interface Stored { ring: DecisionRecord[]; index: Array<{ id: string; ts: number; retention?: RetentionStamp; digest?: string }> }
interface Subject { tenant: string; visitor_id: string }
interface CreditPlan { receipt: OutcomeReceipt; batches: Array<{ name: string; body: unknown; received: number }>; retention?: RetentionStamp }
interface ManagedOutcome { tenant: string; brand?: string; outcome: OutcomeRecord; policy: AttributionPolicy;
  slotConfig?: Record<string, SlotLearnConfig>; defaultSlotConfig?: SlotLearnConfig; version?: number; consentUntil?: number }
interface SavedPlan { version: 1; digest: string; generation: number; tenant: string; subject: string; ts: number;
  retention: RetentionStamp; consentUntil: number; plan: CreditPlan; completed: Record<string, StatsDelivery>; cleanup?: true; retired?: true }

function recordSubject(record: DecisionRecord | OutcomeRecord, type: 'decision' | 'outcome'): Subject {
  if (!isLedgerMessage({ kind: 'ledger', type, record })) throw new Error('Ring scope unavailable');
  if (type === 'outcome' && logicalIdentity(record as unknown as Record<string, unknown>, type) === null) throw new Error('Ring scope unavailable');
  if (bytes(type === 'decision' ? (record as DecisionRecord).decision_id : (record as OutcomeRecord).outcome_id) > RING_LIMITS.idBytes) throw new Capacity();
  return { tenant: record.tenant, visitor_id: record.visitor_id };
}

function sameSubject(current: Subject | undefined, next: Subject): Subject {
  if (current && (current.tenant !== next.tenant || current.visitor_id !== next.visitor_id)) throw new Error('Ring scope unavailable');
  return next;
}

function stateSubject(d: Stored, subject?: Subject): Subject | undefined {
  for (const record of d.ring) subject = sameSubject(subject, recordSubject(record, 'decision'));
  for (const entry of d.index) {
    const id = object(entry) && typeof entry.id === 'string' ? parseId(entry.id) : null;
    if (!id || Object.keys(entry).some(key => !['id', 'ts', 'retention', 'digest'].includes(key))
      || (entry.digest !== undefined && (typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest)))) throw new Error('Ring scope unavailable');
    // Index-only state still establishes its subject and exact timestamp from the carrier.
    subject = sameSubject(subject, recordSubject({ decision_id: entry.id, tenant: id.tenant,
      visitor_id: entry.id.split(':')[2], ts: entry.ts } as DecisionRecord, 'decision'));
  }
  return subject;
}

function capacity(d: Stored): void {
  if (d.ring.length > RING_MAX || d.index.length > RING_LIMITS.index || bytes(JSON.stringify(d)) > RING_LIMITS.stateBytes) throw new Capacity();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export class DecisionRing {
  private state: DurableObjectState;
  private env: Env;
  private synthetic: SyntheticObjectBoundary;
  private data: Stored | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: Env) {
    this.synthetic = new SyntheticObjectBoundary(state, env, 'DECISION_RING', () => { this.data = null; });
    this.state = this.synthetic.state; this.env = this.synthetic.env;
  }

  async fetch(request: Request): Promise<Response> {
    try { return await this.synthetic.run(request, () => this.handle(request)); }
    catch (error) {
      // This refusal concerns only the ring: fan-out statistics may already have run.
      return error instanceof Capacity ? json({ ok: false, error: 'ring capacity exceeded', applied: false }, 413)
        : error instanceof Collision ? json({ ok: false, error: 'ring decision collision', applied: false }, 409)
        : json({ ok: false, error: 'ring unavailable' }, 503);
    }
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/recovery':
      case '/recover': {
        const body = await bodyOf(request);
        if (!object(body) || typeof body.tenant !== 'string' || typeof body.visitorId !== 'string'
          || !body.tenant || !body.visitorId || body.tenant.length > 256 || body.visitorId.length > 256) return json({ ok: false }, 400);
        return this.serialize(() => this.recoveryControl(body, url.pathname === '/recover'));
      }
      case '/append': {
        const body = await bodyOf(request) as { tenant?: string; visitorId?: string; records?: DecisionRecord[]; version?: number } | null;
        if (!object(body) || !Array.isArray(body.records)) return json({ ok: false, error: 'records required' }, 400);
        if (body.records.length > RING_LIMITS.rows) throw new Capacity();
        const receipt = await this.serialize(() => this.append(body.records!, body.tenant, body.visitorId, body.version === 2));
        return json({ ok: true, ring: receipt.retained, receipt });
      }
      case '/outcome/prepare':
      case '/outcome': {
        const body = await bodyOf(request) as ManagedOutcome | null;
        if (!object(body) || !body.outcome || !body.policy || !body.tenant) return json({ ok: false, error: 'outcome and policy required' }, 400);
        if (body.version === 2) {
          const saved = await this.managedPlan(body), key = 'creditPlan:' + await recoveryDigest(body.outcome.outcome_id);
          if (url.pathname === '/outcome/prepare') return json({ ok: true, digest: saved.digest, destinations: saved.plan.batches.map(batch => batch.name) });
          const parts: StatsDelivery[] = [];
          for (const batch of saved.plan.batches) {
            await this.checkPlan(saved);
            if (saved.completed[batch.name]) {
              const prior = saved.completed[batch.name]!;
              parts.push({ ...prior, newlyApplied: 0, alreadyApplied: prior.processed - (prior.suppressed ?? 0), suppressed: prior.suppressed ?? 0 }); continue;
            }
            const result = await deliverStats(this.env.LEARN_STATS, batch.name, 'credits', batch.body, batch.received);
            parts.push(result);
            if (result.acknowledged === 1 && result.unknown === 0 && result.notAttempted === 0) await this.serialize(async () => {
              await this.checkPlan(saved);
              const current = await this.state.storage.get<SavedPlan>(key);
              if (!current || current.digest !== saved.digest || current.generation !== saved.generation) throw new Collision();
              current.completed[batch.name] = result; await this.totalBound(undefined, { key, value: current }); await this.state.storage.put(key, current);
            });
          }
          const receipt = { ...saved.plan.receipt, credits: sumStatsDeliveries(parts) };
          return json({ ok: true, credits: receipt.attributed, receipt });
        }
        if (url.pathname === '/outcome/prepare') return json({ ok: false }, 400);
        // W22 D1.02 (F16 §7, §2.3): a repeat is recognized BEFORE anything is
        // sent, so a redelivered outcome leaves every online counter exactly
        // where one delivery left it.
        const repeat = await this.serialize(() => this.alreadyCredited(body.outcome!));
        const plan = await this.serialize(() => this.outcome(body.tenant!, body.brand ?? body.tenant!, body.outcome!, body.policy!, body.slotConfig ?? {}, body.defaultSlotConfig));
        if (repeat) {
          // The receipt says what this outcome attributes to and that those
          // credits are applied in the statistics — which they are, by the
          // delivery that was journalled. It is not a claim that anything was
          // sent again: nothing was, which is the whole point.
          plan.receipt.credits = sumStatsDeliveries(plan.batches.map(batch =>
            ({ ...emptyStatsDelivery(), destinations: 1, acknowledged: 1, received: batch.received, processed: batch.received })));
          return json({ ok: true, credits: plan.receipt.attributed, receipt: plan.receipt });
        }
        // Attribution and fresh barriers are serialized; downstream waits must not hold /recent's lock.
        plan.receipt.credits = sumStatsDeliveries(await Promise.all(plan.batches.map(batch => {
          requireRetention(this.env, body.outcome!.retention?.online, body.tenant!, 'online');
          return deliverStats(this.env.LEARN_STATS, batch.name, 'credits', batch.body, batch.received);
        })));
        // Journalled only once the credits are actually applied: an outcome
        // whose delivery was refused or unknown may be redelivered and must be.
        const delivered = plan.receipt.credits;
        if (plan.receipt.attributed > 0 && delivered.unknown === 0 && delivered.notAttempted === 0 && delivered.skipped === 0) {
          await this.serialize(() => this.rememberCredited(body.outcome!, body.tenant!));
        }
        return json({ ok: true, credits: plan.receipt.attributed, receipt: plan.receipt });
      }
      case '/recent': {
        const { data: d } = await this.serialize(() => this.current());
        const stamps = [...d.ring.map(row => row.retention!.online!), ...d.index.map(row => row.retention!)];
        const retentionWitness = stamps.reduce<RetentionStamp | null>((prior, stamp) => !prior || stamp.expiresAt < prior.expiresAt ? stamp : prior, null);
        if (retentionWitness) requireRetention(this.env, retentionWitness, retentionWitness.tenant, 'online');
        const response = json({ ok: true, ring: d.ring, index: d.index.length });
        if (retentionWitness) response.headers.set('X-Retention-Witness', JSON.stringify(retentionWitness));
        return response;
      }
      case '/reset': {
        await this.serialize(async () => {
          this.data = null;
          const generation = await this.state.storage.get<number>('creditGeneration');
          if (generation === undefined && this.env.LEDGER_RECOVERY_ENABLED !== 'true') await this.state.storage.deleteAll();
          else {
            if (!Number.isSafeInteger((generation ?? 0) + 1)) throw new Collision();
            await this.state.storage.transaction(async tx => { await tx.put('creditGeneration', (generation ?? 0) + 1); await tx.delete('ring'); await tx.delete(CREDITED_KEY); });
          }
          this.data = { ring: [], index: [] };
        });
        return json({ ok: true, reset: true });
      }
      case '/retire':
      case '/erase': {
        const body = await bodyOf(request) as { tenant?: string; visitorId?: string } | null;
        if (!body?.tenant || !body.visitorId) return json({ ok: false }, 400);
        if (url.pathname === '/retire') await this.serialize(async () => {
          const plans = await this.state.storage.list<SavedPlan>({ prefix: 'creditPlan:', limit: RECOVERY_LIMITS.plans + 1 });
          if (plans.size > RECOVERY_LIMITS.plans) throw new Capacity();
          for (const saved of plans.values()) if (saved.tenant !== body.tenant || saved.subject !== body.visitorId) throw new Collision();
          const generation = await this.state.storage.get<number>('creditGeneration') ?? 0;
          if (!Number.isSafeInteger(generation + 1)) throw new Collision();
          await this.state.storage.transaction(async tx => {
            await tx.put('creditGeneration', generation + 1);
            for (const [key, saved] of plans) {
              saved.cleanup = true; saved.retired = true; saved.completed = {};
              saved.plan.batches = saved.plan.batches.map(batch => ({ name: batch.name, received: 0, body: null }));
              await tx.put(key, saved);
            }
          });
        });
        // W22 D1.02: every entry of this object's journal is this visitor's, so
        // her erasure removes the journal with her ring.
        else await this.serialize(async () => {
          await this.current({ tenant: body.tenant!, visitor_id: body.visitorId! }, true);
          await this.state.storage.delete(CREDITED_KEY);
        });
        await this.cleanupPlans();
        return json({ ok: true, reset: true });
      }
      default: return json({ ok: false, error: 'not found' }, 404);
    }
  }

  private async load(): Promise<Stored> {
    if (!this.data) {
      const stored = await this.state.storage.get<Stored>('ring');
      if (stored !== undefined) {
        try {
          if (!object(stored) || Object.keys(stored).some(key => key !== 'ring' && key !== 'index')
            || !Array.isArray(stored.ring) || !Array.isArray(stored.index)) throw new Error();
          capacity(stored);
          stateSubject(stored);
        } catch { throw new Error('Ring state unavailable'); } // Existing oversize is recovery-required, not an unapplied input.
      }
      this.data = stored === undefined ? { ring: [], index: [] } : stored;
    }
    return this.data;
  }

  /** Re-read the exact barrier for every invocation, including cached and index-only legacy state. */
  private async current(subject?: Subject, cleanup = false): Promise<{ data: Stored; cutoff?: number }> {
    const d = await this.load();
    subject = stateSubject(d, subject);
    const cutoff = subject ? (await loadTombstone(this.env.STORAGE, subject.tenant, subject.visitor_id))?.erased_at : undefined;
    const now = Date.now();
    const alive = (stamp: unknown) => stamp === undefined || readRetention(stamp, subject!.tenant, 'online').expiresAt > now;
    const physical: Stored = { ring: d.ring.filter(r => (cutoff === undefined || r.ts > cutoff) && alive(r.retention?.online)),
      index: d.index.filter(e => (cutoff === undefined || e.ts > cutoff) && alive(e.retention)) };
    if (cleanup && (physical.ring.length !== d.ring.length || physical.index.length !== d.index.length)) {
      try { await this.state.storage.put('ring', physical); } catch (error) { this.data = null; throw error; }
      this.data = physical;
    }
    await this.scheduleExpiry(physical);
    const usable = (stamp: unknown) => { try { requireRetention(this.env, stamp, subject!.tenant, 'online'); return true; } catch { return false; } };
    return { data: { ring: physical.ring.filter(r => usable(r.retention?.online)), index: physical.index.filter(e => usable(e.retention)) }, cutoff };
  }

  private async scheduleExpiry(data: Stored): Promise<void> {
    const subject = stateSubject(data); if (!subject) return;
    const stamps = [...data.ring.map(row => row.retention?.online), ...data.index.map(row => row.retention)].filter(value => value !== undefined);
    const deadline = Math.min(...stamps.flatMap(stamp => {
      try { return [readRetention(stamp, subject.tenant, 'online').expiresAt]; }
      catch { return []; } // Unproved history is held, never expiry authority.
    }));
    if (Number.isFinite(deadline)) {
      const previous = await this.state.storage.getAlarm();
      if (previous === null || previous > deadline) await this.state.storage.setAlarm(deadline);
    }
  }
  /** Called under local serialization, before any remote alarm work. A valid
   * immutable stamp suffices for expiry; no stamp/config inference is made. */
  private async stripExpiredRing(): Promise<void> {
    // W22 D1.02: the journal expires on its own stamps first, on the same pass.
    try {
      const stored = await this.state.storage.get(CREDITED_KEY);
      if (Array.isArray(stored)) {
        const kept = await this.creditedOutcomes();
        if (kept.length !== stored.length) {
          if (kept.length) await this.state.storage.put(CREDITED_KEY, kept); else await this.state.storage.delete(CREDITED_KEY);
        }
      }
    } catch { /* expiry of the journal never blocks the ring's own */ }
    const data = await this.load(), subject = stateSubject(data), now = Date.now();
    if (!subject) return;
    const keep = (stamp: unknown) => {
      try { return readRetention(stamp, subject.tenant, 'online').expiresAt > now; }
      catch { return true; }
    };
    const physical = { ring: data.ring.filter(row => keep(row.retention?.online)), index: data.index.filter(row => keep(row.retention)) };
    if (physical.ring.length !== data.ring.length || physical.index.length !== data.index.length) {
      try { await this.state.storage.put('ring', physical); } catch (error) { this.data = null; throw error; }
      this.data = physical;
    }
    await this.scheduleExpiry(physical);
  }
  async alarm(): Promise<void> {
    return this.synthetic.run(undefined, () => this.alarmScoped());
  }

  private async alarmScoped(): Promise<void> {
    // Every locally provable raw expiry precedes the first R2/child await,
    // including current() itself. Remote cleanup remains outside this phase.
    await this.serialize(async () => { await this.stripExpiredPlans(); await this.stripExpiredRing(); });
    try { await this.serialize(async () => { await this.current(undefined, true); }); }
    finally { await this.cleanupPlans(); }
  }

  private async append(records: DecisionRecord[], tenant?: string, visitorId?: string, managed = false): Promise<AppendReceipt & { version: 2 }> {
    let subject: Subject | undefined;
    for (const record of records) subject = sameSubject(subject, recordSubject(record, 'decision'));
    if (subject && ((tenant !== undefined && tenant !== subject.tenant) || (visitorId !== undefined && visitorId !== subject.visitor_id))) throw new Error('Ring scope unavailable');
    if (!subject && (tenant !== undefined || visitorId !== undefined)) {
      if (typeof tenant !== 'string' || typeof visitorId !== 'string') throw new Error('Ring scope unavailable');
      subject = { tenant, visitor_id: visitorId };
    }
    const { data: d, cutoff } = await this.current(subject);
    const receipt: AppendReceipt & { version: 2 } = { version: 2, kind: 'append', received: records.length, accepted: 0, duplicates: 0, cutoffSkipped: 0, retained: d.ring.length, indexed: d.index.length };
    if (!records.length) return receipt;
    const kept = records.filter(r => cutoff === undefined || r.ts > cutoff);
    for (const row of kept) requireRetention(this.env, row.retention?.online, row.tenant, 'online');
    receipt.cutoffSkipped = records.length - kept.length;
    const known = new Map<string, DecisionRecord | null>();
    for (const row of d.ring) known.set(row.decision_id, known.has(row.decision_id) ? null : row);
    const indexed = new Set(d.index.map(row => row.id)), unique: DecisionRecord[] = [];
    for (const row of kept) {
      if (known.has(row.decision_id)) {
        const prior = known.get(row.decision_id);
        if (!prior || !sameRecord(prior, row)) throw new Collision();
        receipt.duplicates++;
      } else {
        // An index has no full payload to prove an exact retry. Never guess or
        // repair historical ambiguity, including a late conflict in this batch.
        if (indexed.has(row.decision_id)) {
          const prior = d.index.find(entry => entry.id === row.decision_id);
          if (!managed || !prior?.digest || prior.digest !== await recoveryDigest(row)) throw new Collision();
          receipt.duplicates++; continue;
        }
        known.set(row.decision_id, row); unique.push(row);
      }
    }
    receipt.accepted = unique.length;
    const now = Math.max(Date.now(), ...kept.map(r => r.ts));
    const physical = await this.load();
    // Ineligible is not expired: config drift cannot authorize deleting a held
    // legacy or differently-pinned row when new eligible rows arrive.
    const held = (ts: number, stamp: unknown) => (cutoff === undefined || ts > cutoff)
      && (stamp === undefined || readRetention(stamp, subject!.tenant, 'online').expiresAt > now);
    const legacyRing = physical.ring.filter(row => held(row.ts, row.retention?.online) && !d.ring.includes(row));
    const legacyIndex = physical.index.filter(row => held(row.ts, row.retention) && !d.index.includes(row));
    const next = {
      // Stable occurrence-time order keeps late arrivals from evicting newer evidence.
      ring: [...legacyRing, ...[...d.ring, ...unique].filter(r => now - r.ts <= RING_MAX_AGE_MS).sort((a, b) => a.ts - b.ts).slice(-RING_MAX)],
      index: [...legacyIndex, ...[...d.index, ...await Promise.all(unique.map(async r => ({ id: r.decision_id, ts: r.ts, retention: r.retention!.online!,
        ...(managed ? { digest: await recoveryDigest(r) } : {}) })))]
        .filter(e => now - e.ts <= INDEX_MAX_AGE_MS)],
    };
    capacity(next); // Whole post-retention candidate, before any save or cache replacement.
    await this.totalBound(next);
    await this.scheduleExpiry(next);
    for (const row of kept) requireRetention(this.env, row.retention?.online, row.tenant, 'online');
    try { await this.state.storage.put('ring', next); }
    catch (error) { this.data = null; throw error; } // An ambiguous save must be reloaded before reuse.
    this.data = next;
    receipt.retained = next.ring.length; receipt.indexed = next.index.length;
    return receipt;
  }

  private async outcome(tenant: string, brand: string, outcome: OutcomeRecord, policy: AttributionPolicy, slotConfig: Record<string, SlotLearnConfig>, defaultSlotConfig?: SlotLearnConfig, managed = false): Promise<CreditPlan> {
    const subject = recordSubject(outcome, 'outcome');
    if (tenant !== subject.tenant || brand !== outcome.brand) throw new Error('Ring scope unavailable');
    const { data: d, cutoff } = await this.current(subject);
    const plan: CreditPlan = { receipt: { version: 1, kind: 'outcome', received: 1, cutoffSkipped: 0,
      attributed: 0, eligible: 0, weightSkipped: 0, credits: emptyStatsDelivery() }, batches: [] };
    if (managed) plan.retention = requireRetention(this.env, outcome.retention?.online, tenant, 'online');
    if (cutoff !== undefined && outcome.ts <= cutoff) { plan.receipt.cutoffSkipped = 1; return plan; }
    requireRetention(this.env, outcome.retention?.online, tenant, 'online');
    // Explicit references check ambiguity before arm filtering. Doc 22 §10
    // still forbids forwarding any holdout credit to online statistics.
    const all: RingEntry[] = d.ring.map(ringEntryOf), correlated = Object.hasOwn(outcome, 'decision_id');
    const ring = correlated ? all : all.filter((e) => e.arm === 'personalized' && e.brand === outcome.brand);
    const compatible = ring.filter(e => (e.measurementBasis ?? 'served-v1') === ((slotConfig[e.slot] ?? defaultSlotConfig)?.measurementBasis ?? 'served-v1'));
    const credits = attribute(outcome, compatible, policy).filter(c => !correlated
      || all.some(e => e.id === c.decision_id && e.arm === 'personalized'));
    plan.receipt.attributed = credits.length;
    // Prepare every destination before sending, preserving the existing per-slot objective arithmetic.
    const bySlot = new Map<string, typeof credits>();
    for (const c of credits) bySlot.set(c.slot, [...(bySlot.get(c.slot) ?? []), c]);
    for (const [slot, list] of bySlot) {
      // Only a supplied document default may fill an absent override. A present
      // malformed override refuses the entire plan before any downstream send.
      const config = Object.prototype.hasOwnProperty.call(slotConfig, slot) ? slotConfig[slot] : defaultSlotConfig;
      if (!object(config) || !['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom'].includes(config.reward)
        || (config.objective !== undefined && !['unit', 'revenue', 'margin'].includes(config.objective)) || !object(config.stats)) throw new Error('Credit configuration unavailable');
      const s = config.stats;
      if (!Object.keys(config).every(k => ['reward', 'stats', 'objective', 'measurementBasis'].includes(k))
        || config.measurementBasis !== undefined && config.measurementBasis !== 'served-v1' && config.measurementBasis !== 'rendered-v1'
        || !Object.keys(s).every(k => ['n0', 'tauLearnMs', 'nMin', 'liftMin', 'liftMax'].includes(k))
        || ![s.n0, s.tauLearnMs, s.nMin, s.liftMin, s.liftMax].every(v => typeof v === 'number' && Number.isFinite(v))
        || s.n0 <= 0 || s.tauLearnMs <= 0 || !Number.isSafeInteger(s.nMin) || s.nMin < 1
        || s.liftMin <= 0 || s.liftMin > 1 || s.liftMax < 1 || s.liftMax <= s.liftMin) throw new Error('Credit configuration unavailable');
      // CW27: the credit is worth what the slot's objective says; a worthless credit is not sent.
      const weighed = list.map((c) => ({ ...c, weight: creditWeight(config.objective, outcome) })).filter((c) => c.weight > 0);
      if (managed) for (const credit of weighed) {
        const selected = d.ring.filter(row => row.decision_id === credit.decision_id);
        if (selected.length !== 1) throw new Collision();
        // Attribution copies decision identifiers/item/cell, so its earliest
        // compatible source cohort governs the frozen plan and every effect.
        const original = requireRetention(this.env, selected[0]!.retention?.online, tenant, 'online');
        plan.retention = mergeRetention(plan.retention, original, tenant, 'online');
      }
      plan.receipt.eligible += weighed.length; plan.receipt.weightSkipped += list.length - weighed.length;
      if (weighed.length) plan.batches.push({ name: statsName(tenant, brand, slot), received: weighed.length,
        body: { tenant, brand, slot, config, credits: weighed } });
    }
    return plan;
  }

  /** The journal as it stands, with every entry that is past its own retention
   * or past the ring's horizon already gone. Unreadable state answers empty:
   * a repeat this object cannot recognize is credited again, never refused. */
  private async creditedOutcomes(): Promise<CreditedOutcome[]> {
    let stored: unknown;
    try { stored = await this.state.storage.get(CREDITED_KEY); } catch { return []; }
    if (!Array.isArray(stored)) return [];
    const now = Date.now(), out: CreditedOutcome[] = [];
    for (const entry of stored as unknown[]) {
      if (!object(entry) || Object.keys(entry).sort().join(',') !== 'expiresAt,id,ts'
        || typeof entry.id !== 'string' || !entry.id || bytes(entry.id) > RING_LIMITS.idBytes
        || !Number.isSafeInteger(entry.ts) || !Number.isSafeInteger(entry.expiresAt)) continue;
      if (entry.expiresAt as number <= now || now - (entry.ts as number) > RING_MAX_AGE_MS) continue;
      out.push({ id: entry.id, ts: entry.ts as number, expiresAt: entry.expiresAt as number });
    }
    return out;
  }
  /** Has this exact outcome already been credited, inside the horizon? */
  private async alreadyCredited(outcome: OutcomeRecord): Promise<boolean> {
    if (logicalIdentity(outcome as unknown as Record<string, unknown>, 'outcome') !== 'stable') return false;
    const id = outcome.outcome_id;
    if (typeof id !== 'string' || !id) return false;
    return (await this.creditedOutcomes()).some(entry => entry.id === id);
  }
  private async rememberCredited(outcome: OutcomeRecord, tenant: string): Promise<void> {
    try {
      if (logicalIdentity(outcome as unknown as Record<string, unknown>, 'outcome') !== 'stable') return;
      const id = outcome.outcome_id;
      if (typeof id !== 'string' || !id || bytes(id) > RING_LIMITS.idBytes) return;
      // The journal never outlives the online retention of the event it records.
      const expiresAt = readRetention(outcome.retention?.online, tenant, 'online').expiresAt;
      const now = Date.now();
      let kept = [...(await this.creditedOutcomes()).filter(entry => entry.id !== id), { id, ts: outcome.ts, expiresAt }]
        .sort((a, b) => a.ts - b.ts);
      if (kept.length > CREDITED_MAX_ROWS) kept = kept.slice(-CREDITED_MAX_ROWS);
      while (kept.length && bytes(JSON.stringify(kept)) > CREDITED_MAX_BYTES) kept = kept.slice(1);
      if (bytes(JSON.stringify(kept)) > RING_LIMITS.stateBytes) return;
      await this.totalBound(undefined, undefined, undefined, kept);
      await this.state.storage.put(CREDITED_KEY, kept);
      const next = Math.min(...kept.map(entry => entry.expiresAt));
      if (Number.isFinite(next) && next > now) {
        const previous = await this.state.storage.getAlarm();
        if (previous === null || previous > next) await this.state.storage.setAlarm(next);
      }
    } catch { /* a credit this object cannot remember is a repeat it may apply again */ }
  }

  private async checkPlan(saved: SavedPlan): Promise<void> {
    if (saved.cleanup) throw new Collision();
    if (!saved.plan.retention || JSON.stringify(saved.plan.retention) !== JSON.stringify(saved.retention)) throw new Collision();
    requireRetention(this.env, saved.retention, saved.tenant, 'online');
    if (saved.consentUntil <= Date.now() || saved.generation !== (await this.state.storage.get<number>('creditGeneration') ?? 0)) throw new Collision();
    const barrier = await loadTombstone(this.env.STORAGE, saved.tenant, saved.subject);
    if (barrier && saved.ts <= barrier.erased_at) throw new Collision();
    if (saved.generation !== (await this.state.storage.get<number>('creditGeneration') ?? 0)) throw new Collision();
    if (saved.consentUntil <= Date.now()) throw new Collision();
    requireRetention(this.env, saved.retention, saved.tenant, 'online');
  }

  private async managedPlan(body: ManagedOutcome): Promise<SavedPlan> {
    if (!Number.isSafeInteger(body.consentUntil) || body.consentUntil! <= Date.now()) throw new Collision();
    const digest = await recoveryDigest(body), key = 'creditPlan:' + await recoveryDigest(body.outcome.outcome_id);
    const first = await this.serialize(async () => {
      const existing = await this.state.storage.get<SavedPlan>(key);
      if (existing) { if (existing.digest !== digest) throw new Collision(); await this.checkPlan(existing); return { existing }; }
      const generation = await this.state.storage.get<number>('creditGeneration') ?? 0;
      if (!Number.isSafeInteger(generation) || generation < 0) throw new Collision();
      await this.state.storage.put('creditGeneration', generation);
      const plan = await this.outcome(body.tenant, body.brand ?? body.tenant, body.outcome, body.policy, body.slotConfig ?? {}, body.defaultSlotConfig, true);
      return { plan, generation };
    });
    if (first.existing) return first.existing;
    const saved: SavedPlan = { version: 1, digest, generation: first.generation!, tenant: body.tenant, subject: body.outcome.visitor_id,
      ts: body.outcome.ts, retention: requireRetention(this.env, first.plan!.retention, body.tenant, 'online'),
      consentUntil: body.consentUntil!, plan: first.plan!, completed: {} };
    // Generation reads and every downstream wait occur outside the recent-ring lock.
    for (const batch of saved.plan.batches) {
      const value = batch.body as { tenant: string; brand: string; slot: string; credits: Array<{ decision_id: string; item: string; ts: number; effect?: LearningEffect }>; version?: number };
      const generations = await learningGenerations(this.env.LEARN_STATS, batch.name, value.credits.map(row => row.item));
      value.version = 2;
      for (const row of value.credits) row.effect = { version: 1, id: await learningEffectId('credits', batch.name, row.decision_id, body.outcome.outcome_id),
        decision: row.decision_id, outcome: body.outcome.outcome_id, tenant: saved.tenant, subject: saved.subject,
        generation: generations[row.item]!, retention: saved.retention, consentUntil: saved.consentUntil };
    }
    return this.serialize(async () => {
      await this.checkPlan(saved);
      const prior = await this.state.storage.get<SavedPlan>(key);
      if (prior) { if (prior.digest !== digest) throw new Collision(); return prior; }
      const plans = await this.state.storage.list<SavedPlan>({ prefix: 'creditPlan:', limit: RECOVERY_LIMITS.plans + 1 });
      if (plans.size >= RECOVERY_LIMITS.plans || bytes(JSON.stringify(saved)) > RING_LIMITS.stateBytes) throw new Capacity();
      await this.totalBound(undefined, { key, value: saved });
      await this.state.storage.put(key, saved);
      const next = Math.min(saved.retention.expiresAt, saved.consentUntil), previous = await this.state.storage.getAlarm();
      if (previous === null || previous > next) await this.state.storage.setAlarm(next);
      return saved;
    });
  }

  /** Local-only; caller holds serialization. Retain minimal destination debt
   * and original deadlines/reasons before any barrier or child request. */
  private async stripExpiredPlans(): Promise<{ plans: Map<string, SavedPlan>; next: number }> {
    const plans = await this.state.storage.list<SavedPlan>({ prefix: 'creditPlan:', limit: RECOVERY_LIMITS.plans + 1 });
    if (plans.size > RECOVERY_LIMITS.plans) throw new Capacity();
    let next = Infinity;
    for (const [key, saved] of plans) {
      let deadline: number;
      try { deadline = this.planDeadline(saved); }
      catch { next = Math.min(next, Date.now() + 30_000); continue; }
      if (!saved.cleanup && deadline <= Date.now()) {
        saved.cleanup = true; saved.completed = {};
        saved.plan.batches = saved.plan.batches.map(batch => ({ name: batch.name, received: 0, body: null }));
        await this.state.storage.put(key, saved);
      }
      next = Math.min(next, saved.cleanup ? Date.now() + 30_000 : deadline);
    }
    await this.schedulePlanCleanup(next);
    return { plans, next };
  }

  private async totalBound(ring?: Stored, replacement?: { key: string; value: SavedPlan }, repair?: unknown, credited?: unknown): Promise<void> {
    const plans = await this.state.storage.list<SavedPlan>({ prefix: 'creditPlan:', limit: RECOVERY_LIMITS.plans + 1 });
    if (replacement) plans.set(replacement.key, replacement.value);
    if (plans.size > RECOVERY_LIMITS.plans) throw new Capacity();
    const savedRing = ring ?? await this.state.storage.get<Stored>('ring') ?? { ring: [], index: [] };
    let size = bytes(JSON.stringify(savedRing)) + bytes(JSON.stringify(repair ?? await this.state.storage.get('ringRepair') ?? null)) + 256
      + bytes(JSON.stringify(credited ?? await this.state.storage.get(CREDITED_KEY) ?? null));
    for (const [key, value] of plans) {
      const n = bytes(JSON.stringify(value)); if (n > RING_LIMITS.stateBytes) throw new Capacity();
      size += bytes(key) + n;
    }
    if (size > RING_LIMITS.totalBytes) throw new Capacity();
  }
  private async recoveryControl(body: Record<string, unknown>, mutate: boolean): Promise<Response> {
    const raw = await this.state.storage.get<Stored>('ring'), generation = await this.state.storage.get<number>('creditGeneration') ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Collision();
    if (raw !== undefined && (!object(raw) || Object.keys(raw).some(key => !['ring', 'index'].includes(key))
      || !Array.isArray(raw.ring) || !Array.isArray(raw.index) || raw.ring.length + raw.index.length > RING_LIMITS.repairRows
      || bytes(JSON.stringify(raw)) > RING_LIMITS.repairBytes)) throw new Error('Ring recovery proof unavailable');
    if (raw) stateSubject(raw, { tenant: body.tenant as string, visitor_id: body.visitorId as string });
    const digest = await recoveryDigest({ raw: raw ?? null, generation });
    let healthy = true; try { if (raw) capacity(raw); await this.totalBound(); } catch { healthy = false; }
    if (!mutate) return json({ ok: true, state: !raw ? 'empty' : healthy ? 'healthy' : 'recovery-required', digest, generation, bytes: bytes(JSON.stringify(raw ?? null)) });
    if (body.intent !== 'compact' || typeof body.operationId !== 'string' || !/^[a-f0-9]{32}$/.test(body.operationId)
      || typeof body.digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.digest) || !Number.isSafeInteger(body.generation)) return json({ ok: false }, 400);
    const prior = await this.state.storage.get<{ operationId: string; before: string; after: string; generation: number }>('ringRepair');
    if (prior?.operationId === body.operationId) {
      if (prior.before !== body.digest || prior.after !== digest || prior.generation !== body.generation) throw new Collision();
      if (raw) await this.scheduleExpiry(raw);
      await this.stripExpiredPlans();
      return json({ ok: true, recovered: true, digest, generation });
    }
    if (!raw || body.digest !== digest || body.generation !== generation) throw new Collision();
    // Deduplicate only byte-equivalent logical evidence. Missing index entries
    // may be reconstructed from retained full records; conflicts remain held.
    const ring = new Map<string, DecisionRecord>(), index = new Map<string, Stored['index'][number]>();
    const live = (stamp: unknown) => { try { return readRetention(stamp, body.tenant as string, 'online').expiresAt > Date.now(); } catch { return true; } };
    for (const row of raw.ring) if (live(row.retention?.online)) {
      const old = ring.get(row.decision_id); if (old && !sameRecord(old, row)) throw new Collision();
      ring.set(row.decision_id, row);
    }
    for (const row of raw.index) if (live(row.retention)) {
      const old = index.get(row.id); if (old && await recoveryDigest(old) !== await recoveryDigest(row)) throw new Collision();
      index.set(row.id, row);
    }
    for (const row of ring.values()) {
      const old = index.get(row.decision_id), hash = await recoveryDigest(row);
      if (old && (old.ts !== row.ts || old.digest !== undefined && old.digest !== hash)) throw new Collision();
      if (!old) index.set(row.decision_id, { id: row.decision_id, ts: row.ts, ...(row.retention?.online ? { retention: row.retention.online } : {}), digest: hash });
    }
    const candidate = { ring: [...ring.values()], index: [...index.values()] };
    capacity(candidate); await this.totalBound(candidate);
    if (!Number.isSafeInteger(generation + 1)) throw new Collision();
    const after = await recoveryDigest({ raw: candidate, generation: generation + 1 });
    const receipt = { operationId: body.operationId, before: digest, after, generation };
    await this.totalBound(candidate, undefined, receipt);
    try {
      await this.state.storage.transaction(async tx => {
        if (await recoveryDigest({ raw: await tx.get('ring') ?? null, generation: await tx.get('creditGeneration') ?? 0 }) !== digest) throw new Collision();
        await tx.put('ring', candidate); await tx.put('creditGeneration', generation + 1);
        await tx.put('ringRepair', receipt);
      });
    } catch (error) {
      this.data = null;
      if (await recoveryDigest({ raw: await this.state.storage.get('ring') ?? null, generation: await this.state.storage.get('creditGeneration') ?? 0 }) !== after) throw error;
    }
    this.data = null;
    await this.scheduleExpiry(candidate);
    await this.stripExpiredPlans();
    return json({ ok: true, recovered: true, digest: after, generation: generation + 1 });
  }
  private planDeadline(saved: SavedPlan): number {
    if (!Number.isSafeInteger(saved.consentUntil) || saved.consentUntil < 0) throw new Error('Credit lifetime unavailable');
    return Math.min(readRetention(saved.retention, saved.tenant, 'online').expiresAt, saved.consentUntil);
  }
  private async schedulePlanCleanup(next: number): Promise<void> {
    if (!Number.isFinite(next)) return;
    const prior = await this.state.storage.getAlarm();
    if (prior === null || prior <= Date.now() || prior > next) await this.state.storage.setAlarm(Math.max(Date.now() + 1, next));
  }
  /** Keep child cleanup references until every marker destination acknowledges deletion. */
  private async cleanupPlans(): Promise<void> {
    const local = await this.serialize(() => this.stripExpiredPlans()), plans = local.plans;
    let next = local.next;
    try { for (const [key, saved] of plans) {
      const deadline = this.planDeadline(saved);
      const barrier = await loadTombstone(this.env.STORAGE, saved.tenant, saved.subject);
      const erased = !!barrier && saved.ts <= barrier.erased_at;
      if (!saved.cleanup && !erased && deadline > Date.now()) { next = Math.min(next, deadline); continue; }
      // The raw attribution expires on time even when a child is unavailable.
      // Only exact destination cleanup references remain until acknowledgement.
      if (!saved.cleanup) {
        saved.cleanup = true; saved.completed = {};
        saved.plan.batches = saved.plan.batches.map(batch => ({ name: batch.name, received: 0, body: null }));
        await this.serialize(async () => { await this.state.storage.put(key, saved); });
      }
      for (const batch of saved.plan.batches) {
        if (!this.env.LEARN_STATS) throw new Error('Learning cleanup unavailable');
        const response = await this.env.LEARN_STATS.get(this.env.LEARN_STATS.idFromName(batch.name)).fetch('https://learn/cleanup-effects', {
          method: 'POST', body: JSON.stringify({ tenant: saved.tenant, subject: saved.subject, ...(saved.retired ? { retired: true } : {}) }),
        });
        const result = await response.json() as { ok?: boolean; complete?: boolean };
        if (!response.ok || result.ok !== true || result.complete !== true) throw new Error('Learning cleanup incomplete');
      }
      await this.serialize(async () => { await this.state.storage.delete(key); });
    } } catch (error) { next = Math.min(next, Date.now() + 30_000); throw error; }
    finally { await this.schedulePlanCleanup(next); }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
