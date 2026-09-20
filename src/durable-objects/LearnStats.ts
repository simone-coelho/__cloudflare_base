// src/durable-objects/LearnStats.ts
// One object per tenant, brand and slot. Application budgets bound admission;
// refusal never evicts evidence or changes the estimator's pooling semantics.

import type { Env } from '@/types/env';
import { SyntheticObjectBoundary, syntheticOperation } from '@/ops/synthetic';
import type { Cell } from '@/content/types';
import type { RewardType } from '@/ledger/records';
import { boundStats, coarsenStats, depth, buildSnapshot, emptyStats, levelKeys, parentKey, recordExposure, recordSuccess, type AttributionContract, type StatsState, type LiftSnapshot, type Level } from '@/learn/stats';
import { liftArchiveKey, liftKey, ONLINE_RING_REACH_MS, type SlotLearnConfig, type StatsWriteReceipt } from '@/learn/fan';
import { committedPublication, pinPublication, readPinnedPublication } from '@/config/publication';
import { LEARN_KIND } from '@/content/kinds';
import { DEFAULT_STATS } from '@/learn/stats';
import { indexPriors, PRIORS_KIND } from '@/learn/priors';
import { attributionContractOf } from '@/learn/route';
import { loadTombstone } from '@/ledger/erasure';
import { requireRetention } from '@/retention';
import { learningEffectId, recoveryDigest, RECOVERY_LIMITS, type LearningEffect, type LearningGeneration } from '@/ledger/recovery';
import { entryChannelOf } from '@/services/visit';

const PUBLISH_DELAY_MS = 30_000;
/** Conservative application budgets, not a measurement of a provider limit. */
export const LEARN_LIMITS = { requestBytes: 256 * 1024, rows: 1000, stateBytes: 512 * 1024,
  items: 256, counters: 4096, component: 256, keyBytes: 2048,
  priorRows: 4096, priorBytes: 256 * 1024, snapshotBytes: 2 * 1024 * 1024,
  repairBytes: 8 * 1024 * 1024, repairCounters: 65536, totalBytes: 640 * 1024 } as const;
const rewards = new Set(['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom']);
const utf8 = new TextEncoder();
interface EffectMarker { digest: string; subject: string; ts: number; expiresAt: number; item: string }
interface Stored { tenant: string; brand: string; slot: string; config: SlotLearnConfig; stats: StatsState;
  effects?: Record<string, EffectMarker>; retiredEffects?: Record<string, { digest: string; expiresAt: number }> }
interface GenerationFence { whole: number; items: Record<string, number> }
type Row = { item: string; cell: Cell; ts: number; reward?: RewardType; weight?: number; effect?: LearningEffect; decision?: string; digest?: string };
/**
 * W22 D1.02 (F16 §7, §2.3): the bounded, durable journal of exposures this
 * object has already applied, so a REDELIVERED exposure — the at-least-once
 * repeat F16 §2.3 measured counting one impression twice — is recognized and
 * not counted again. It is keyed by the decision's own logical id, which the
 * `/exposures` payload now carries, because a decision is served exactly once.
 *
 * It lives under its own storage key rather than inside `learn`, so it can
 * never take room from the estimator's counters or make `fit()` coarsen them,
 * and it is charged against the object's existing total bound. It is pruned to
 * the online horizon and then to these two caps, oldest first; a repeat that
 * arrives after it has been pruned is applied again, and nothing claims
 * otherwise. Credits are NOT journalled here: the visitor's ring is the one
 * place that can tell two outcomes apart, and it does that before it sends.
 */
const SEEN_KEY = 'learnSeen';
const SEEN_MAX_BYTES = 32 * 1024;
const SEEN_MAX_ROWS = 512;
interface SeenExposure { id: string; digest: string; ts: number }
class Refusal extends Error {
  constructor(readonly status: 400 | 409 | 413 | 503, message: string) { super(message); }
}
const capacity = () => new Refusal(413, 'statistics capacity exceeded');
const invalid = () => new Refusal(400, 'invalid statistics input');
const recovery = () => new Refusal(503, 'statistics recovery required');
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const fields = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).every(k => keys.includes(k));
const component = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= LEARN_LIMITS.component;
const itemName = (v: unknown): v is string => component(v) && !Object.prototype.hasOwnProperty.call(Object.prototype, v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const control = (v: string): boolean => [...v].some(char => char.charCodeAt(0) < 32);
const time = (v: unknown): v is number => finite(v) && Number.isFinite(new Date(v).getTime());
function bytes(v: unknown): number {
  return utf8.encode(JSON.stringify(v, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw invalid();
    return value;
  })).length;
}
function keyBound(key: string): void {
  if (Object.prototype.hasOwnProperty.call(Object.prototype, key)) throw invalid();
  if (!key || utf8.encode(key).length > LEARN_LIMITS.keyBytes || key.split('|').length > 5) throw capacity();
  if (key !== '*' && key.split('|').some((part, i) => !part.startsWith(['c=', 'v=', 's=', 'r=', 'a='][i]!)
    || part.length < 3 || part.length > LEARN_LIMITS.component + 2 || part.slice(2).includes('=') || control(part.slice(2)))) throw invalid();
}
function configValid(v: unknown): v is SlotLearnConfig {
  if (!fields(v, ['reward', 'stats', 'objective', 'measurementBasis']) || typeof v.reward !== 'string' || !rewards.has(v.reward)
    || v.measurementBasis !== undefined && v.measurementBasis !== 'served-v1' && v.measurementBasis !== 'rendered-v1'
    || (v.objective !== undefined && (typeof v.objective !== 'string' || !['unit', 'revenue', 'margin'].includes(v.objective)))) return false;
  const s = v.stats;
  return fields(s, ['n0', 'tauLearnMs', 'liftMin', 'liftMax', 'nMin'])
    && finite(s.n0) && s.n0 > 0 && finite(s.tauLearnMs) && s.tauLearnMs > 0
    && finite(s.nMin) && Number.isSafeInteger(s.nMin) && s.nMin >= 1
    && finite(s.liftMin) && s.liftMin > 0 && s.liftMin <= 1
    && finite(s.liftMax) && s.liftMax >= 1 && s.liftMax > s.liftMin;
}
function stateValid(value: unknown, repairing = false): asserts value is Stored {
  if (!fields(value, ['tenant', 'brand', 'slot', 'config', 'stats', 'effects', 'retiredEffects']) || !component(value.tenant) || !component(value.brand)
    || !component(value.slot) || !configValid(value.config)) throw invalid();
  if (value.effects !== undefined && (!object(value.effects) || Object.keys(value.effects).length > RECOVERY_LIMITS.effects
    || Object.entries(value.effects).some(([id, m]) => !/^[a-f0-9]{64}$/.test(id)
      || !fields(m, ['digest', 'subject', 'ts', 'expiresAt', 'item']) || typeof m.digest !== 'string' || !/^[a-f0-9]{64}$/.test(m.digest)
      || !component(m.subject) || !time(m.ts) || !time(m.expiresAt) || !itemName(m.item)))) throw invalid();
  if (value.retiredEffects !== undefined && (!object(value.retiredEffects)
    || Object.entries(value.retiredEffects).some(([id, m]) => !/^[a-f0-9]{64}$/.test(id) || !fields(m, ['digest', 'expiresAt'])
      || typeof m.digest !== 'string' || !/^[a-f0-9]{64}$/.test(m.digest) || !time(m.expiresAt)))) throw invalid();
  if (Object.keys(value.effects ?? {}).length + Object.keys(value.retiredEffects ?? {}).length > RECOVERY_LIMITS.effects) throw capacity();
  const st = value.stats;
  if (!fields(st, ['items', 'slot', 'events', 'updatedAt', 'bounded']) || !object(st.items) || !object(st.slot)
    || !Number.isSafeInteger(st.events) || (st.events as number) < 0 || !time(st.updatedAt)) throw invalid();
  if (bytes(value) > (repairing ? LEARN_LIMITS.repairBytes : LEARN_LIMITS.stateBytes)
    || Object.keys(st.items).length > (repairing ? LEARN_LIMITS.repairCounters : LEARN_LIMITS.items)) throw capacity();
  const entryValid = (v: unknown) => fields(v, ['s', 't']) && finite(v.s) && v.s >= 0 && time(v.t);
  if (st.bounded !== undefined && (!fields(st.bounded, ['depth', 'omitted', 'omittedEvents', 'selection', 'closed'])
    || !Number.isInteger(st.bounded.depth) || Number(st.bounded.depth) < 0 || Number(st.bounded.depth) > 5
    || !Number.isSafeInteger(st.bounded.omittedEvents) || Number(st.bounded.omittedEvents) < 0
    || !['first-seen', 'lexical-repair'].includes(String(st.bounded.selection))
    || st.bounded.closed !== undefined && typeof st.bounded.closed !== 'boolean')) throw invalid();
  let count = 0;
  const maps: Array<[string, unknown]> = [['', st.slot], ...Object.entries(st.items)];
  if (st.bounded) maps.push(['omitted', { '*': (st.bounded as StatsState['bounded'])!.omitted }]);
  for (const [index, [item, map]] of maps.entries()) {
    if ((index > 0 && !itemName(item)) || !object(map)) throw invalid();
    for (const [key, c] of Object.entries(map)) {
      keyBound(key);
      if (++count > (repairing ? LEARN_LIMITS.repairCounters : LEARN_LIMITS.counters)) throw capacity();
      if (!repairing && st.bounded && depth(key) > Number((st.bounded as StatsState['bounded'])!.depth)) throw invalid();
      if (!fields(c, ['n', 's']) || !entryValid(c.n) || !object(c.s)
        || Object.entries(c.s).some(([reward, e]) => !rewards.has(reward) || !entryValid(e))) throw invalid();
    }
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function failure(error: unknown): Response {
  return error instanceof Refusal
    ? json({ ok: false, error: error.message, ...(error.status === 413 || error.status === 409 ? { applied: false } : {}) }, error.status)
    : json({ ok: false, error: 'statistics acknowledgement unavailable' }, 503);
}
/** Count the actual stream, not a caller-controlled Content-Length. */
async function input(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw invalid();
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let size = 0, text = '';
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > LEARN_LIMITS.requestBytes) throw capacity();
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text); if (!object(value)) throw invalid(); return value;
  } catch (error) {
    try { await reader.cancel(); } catch { /* cancellation cannot replace the refusal */ }
    throw error instanceof Refusal ? error : invalid();
  } finally { reader.releaseLock(); }
}
function rowsOf(rows: unknown[], kind: StatsWriteReceipt['kind']): Row[] {
  if (rows.length > LEARN_LIMITS.rows) throw capacity();
  const accepted: Row[] = [];
  for (const row of rows) {
    // Retain the old handler's ineligible/null-row skipped contract.
    if (!object(row) || !row.item || !row.cell || (kind === 'credits' && !row.reward)) continue;
    if (!itemName(row.item) || !object(row.cell)) throw invalid();
    for (const name of ['channel', 'visit_bucket', 'stage', 'region', 'affinity']) {
      const v = row.cell[name]; if (v !== undefined && v !== null && (!component(v) || v.includes('|') || v.includes('=') || control(v))) throw invalid();
    }
    const cell = row.cell as unknown as Cell;
    for (const key of levelKeys(cell)) keyBound(key);
    const ts = row.ts === undefined || row.ts === null ? Date.now() : Number(row.ts);
    const weight = row.weight === undefined || row.weight === null ? 1 : Number(row.weight);
    if (!time(ts) || !Number.isFinite(weight) || weight < 0 || (kind === 'credits' && (typeof row.reward !== 'string' || !rewards.has(row.reward)))) throw invalid();
    if (row.decision !== undefined && (typeof row.decision !== 'string' || !row.decision || utf8.encode(row.decision).length > LEARN_LIMITS.keyBytes)) throw invalid();
    if (row.digest !== undefined && (typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest))) throw invalid();
    accepted.push({ item: row.item, cell, ts, ...(kind === 'credits' ? { reward: row.reward as RewardType, weight } : {}),
      ...(typeof row.decision === 'string' ? { decision: row.decision } : {}),
      ...(typeof row.digest === 'string' ? { digest: row.digest } : {}),
      ...(Object.hasOwn(row, 'effect') ? { effect: row.effect as LearningEffect } : {}) });
  }
  return accepted;
}

export class LearnStats {
  private data: Stored | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastAllocated = 0;
  private synthetic: SyntheticObjectBoundary;
  constructor(private state: DurableObjectState, private env: Env) {
    this.synthetic = new SyntheticObjectBoundary(state, env, 'LEARN_STATS', () => { this.data = null; this.lastAllocated = 0; });
    this.state = this.synthetic.state; this.env = this.synthetic.env;
  }

  async fetch(request: Request): Promise<Response> {
    return this.synthetic.run(request, () => this.fetchScoped(request)).catch(error => failure(error));
  }

  private async fetchScoped(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/monitor-effects') {
        const scope = syntheticOperation(), b = await input(request);
        if (!scope || !Array.isArray(b.effects) || !b.effects.length || b.effects.length > 16) throw invalid();
        return this.serialize(async () => {
          const d = await this.loadIfAny(); let complete = !!d && d.tenant === scope.tenant && d.brand === scope.tenant;
          for (const raw of b.effects as Array<Record<string, unknown>>) {
            if (!['exposures', 'credits'].includes(String(raw.kind)) || typeof raw.decision !== 'string' || typeof raw.item !== 'string'
              || raw.kind === 'credits' && typeof raw.outcome !== 'string') throw invalid();
            const id = await learningEffectId(raw.kind as 'exposures' | 'credits', `${scope.tenant}:${scope.tenant}:${d?.slot}`, raw.decision, raw.outcome as string | undefined);
            const marker = d?.effects?.[id]; complete &&= !!marker && marker.subject === scope.subject && marker.item === raw.item && marker.expiresAt > Date.now();
          }
          if (complete && d) {
            // Ingestion markers do not prove serving publication. Exercise the
            // actual immutable archive and KV publication, then read back the
            // same current snapshot before reporting a completed monitor.
            const snapshot = await this.publish();
            if (!snapshot) complete = false;
            else {
              const [archive, cached] = await Promise.all([
                this.env.STORAGE.get(liftArchiveKey(d.tenant, d.brand, d.slot, snapshot.version)),
                this.env.CACHE.get(liftKey(d.tenant, d.brand, d.slot), 'json'),
              ]);
              complete = !!archive && await recoveryDigest(await archive.json()) === await recoveryDigest(snapshot)
                && await recoveryDigest(cached) === await recoveryDigest(snapshot);
            }
          }
          return json({ complete });
        });
      }
      if (path === '/health' || path === '/recovery' || path === '/recover') {
        const b = await input(request);
        if (!component(b.tenant) || !component(b.brand) || !component(b.slot)) throw invalid();
        // A read-only committed-state health query must not queue behind an
        // unrelated archive/KV publication wait.
        return await (path === '/health' ? this.recoveryControl(b, path) : this.serialize(() => this.recoveryControl(b, path)));
      }
      if (path === '/generation') {
        const b = await input(request);
        if (!Array.isArray(b.items) || b.items.length > LEARN_LIMITS.items || b.items.some(item => !itemName(item))) throw invalid();
        const items = b.items;
        return await this.serialize(async () => {
          const fence = await this.fence();
          const current = await this.loadIfAny(); if (current) await this.totalBound(current, fence);
          // The first generation is durable before it can be included in a plan.
          await this.state.storage.put('learnFence', fence);
          return json({ ok: true, whole: fence.whole, items: Object.fromEntries(items.map(item => [String(item), fence.items[String(item)] ?? 0])) });
        });
      }
      if (path === '/erase-effects' || path === '/cleanup-effects') {
        const b = await input(request);
        if (!component(b.tenant) || !component(b.subject) || (path === '/erase-effects' && !time(b.cutoff))) throw invalid();
        return await this.serialize(async () => {
          const current = await this.loadIfAny();
          if (current && current.tenant !== b.tenant) throw invalid();
          const barrier = await loadTombstone(this.env.STORAGE, b.tenant as string, b.subject as string);
          if (path === '/erase-effects' && (!barrier || barrier.erased_at < (b.cutoff as number))) throw invalid();
          const candidate = current && structuredClone(current);
          let next = Infinity;
          if (candidate?.effects) {
            for (const [id, marker] of Object.entries(candidate.effects)) if (marker.subject === b.subject) {
              if (b.retired === true && marker.expiresAt > Date.now()) {
                (candidate.retiredEffects ??= {})[id] = { digest: marker.digest, expiresAt: marker.expiresAt };
                delete candidate.effects[id];
              } else if (marker.expiresAt <= Date.now() || barrier && marker.ts <= barrier.erased_at) delete candidate.effects[id];
              else next = Math.min(next, marker.expiresAt);
            }
            await this.commit(candidate);
            if (b.retired === true) await this.arm();
          }
          // W22 D1.02: the journal holds decision ids, which carry the subject,
          // so erasure removes hers from it exactly as it removes her markers.
          const journal = await this.seenExposures();
          const remaining = journal.filter(row => row.id.split(':')[2] !== b.subject);
          if (remaining.length !== journal.length) await this.rememberExposures(remaining);
          if (Number.isFinite(next)) {
            const prior = await this.state.storage.getAlarm();
            if (prior === null || prior > next) await this.state.storage.setAlarm(next);
          }
          return json({ ok: true, complete: !Number.isFinite(next), ...(Number.isFinite(next) ? { next } : {}) });
        });
      }
      if (path === '/exposures' || path === '/credits') {
        const kind = path === '/exposures' ? 'exposures' : 'credits', b = await input(request), raw = b[kind];
        if (!component(b.tenant) || !component(b.brand) || !component(b.slot) || !Array.isArray(raw)
          || !configValid(b.config)) throw invalid();
        const rows = rowsOf(raw, kind);
        const managed = b.version === 2;
        if ((b.version !== undefined && b.version !== 2) || (managed ? rows.length !== raw.length || rows.some(row => !row.effect) : rows.some(row => row.effect))) throw invalid();
        return await this.writeRows(kind, raw.length, b.tenant, b.brand, b.slot, b.config, rows, managed);
      }
      if (path === '/snapshot') {
        const snapshot = await this.serialize(async () => { const d = await this.loadIfAny(); return d ? this.snapshot(d) : null; });
        return json({ ok: true, snapshot });
      }
      if (path === '/publish') {
        const snap = await this.serialize(() => this.publish());
        return json({ ok: true, published: snap !== null, snapshot: snap });
      }
      if (path === '/reset') {
        await this.serialize(async () => {
          try {
            const saved = await this.state.storage.get('learnFence');
            const current = await this.state.storage.get<Stored>('learn');
            if (saved === undefined && !current?.stats?.bounded && await this.state.storage.get('learnReset') === undefined && this.env.LEDGER_RECOVERY_ENABLED !== 'true') await this.state.storage.deleteAll();
            else {
              const fence = await this.fence();
              if (!Number.isSafeInteger(fence.whole + 1)) throw recovery();
              await this.state.storage.transaction(async tx => {
                await tx.put('learnFence', { whole: fence.whole + 1, items: {} });
                await tx.delete('learn'); await tx.delete(SEEN_KEY);
              });
            }
          } finally { this.data = null; }
        });
        return json({ ok: true, reset: true });
      }
      if (path === '/reset-item') {
        const b = await input(request); if (!itemName(b.item)) throw invalid();
        if (b.publication !== undefined || b.operationId !== undefined) return await this.serialize(() => this.publishedReset(b));
        const had = await this.serialize(async () => {
          const current = await this.loadIfAny();
          const fenced = await this.state.storage.get('learnFence') !== undefined || await this.state.storage.get('learnPublished') !== undefined
            || !!current?.stats.bounded || this.env.LEDGER_RECOVERY_ENABLED === 'true';
          if (fenced) {
            const fence = await this.fence(), item = b.item as string;
            if (!(item in fence.items) && Object.keys(fence.items).length >= LEARN_LIMITS.items) throw capacity();
            fence.items[item] = (fence.items[item] ?? 0) + 1;
            if (!Number.isSafeInteger(fence.items[item])) throw recovery();
            const candidate = current && structuredClone(current), had = !!candidate && Object.hasOwn(candidate.stats.items, item);
            if (candidate) {
              delete candidate.stats.items[item];
              for (const [id, marker] of Object.entries(candidate.effects ?? {})) if (marker.item === item) delete candidate.effects![id];
              stateValid(candidate);
              await this.totalBound(candidate, fence);
            }
            try {
              await this.state.storage.transaction(async tx => { await tx.put('learnFence', fence); if (candidate) await tx.put('learn', candidate); });
            } finally { this.data = null; }
            if (had) try { await this.publish(); } catch { throw new Error('statistics publication unavailable'); }
            return had;
          }
          if (!current || !Object.prototype.hasOwnProperty.call(current.stats.items, b.item as string)) return false;
          const candidate = structuredClone(current); delete candidate.stats.items[b.item as string];
          await this.commit(candidate);
          // Publication can refuse after the deletion committed: never report applied:false.
          try { await this.publish(); } catch { throw new Error('statistics publication unavailable'); }
          return true;
        });
        return json({ ok: true, item: b.item, had });
      }
      return json({ ok: false, error: 'not found' }, 404);
    } catch (error) { return failure(error); }
  }

  async alarm(): Promise<void> { return this.synthetic.run(undefined, () => this.alarmScoped()); }
  private async alarmScoped(): Promise<void> { await this.serialize(async () => {
    const current = await this.loadIfAny();
    if (current?.effects || current?.retiredEffects) {
      const candidate = structuredClone(current);
      for (const [id, marker] of Object.entries(candidate.effects ?? {})) if (marker.expiresAt <= Date.now()) delete candidate.effects![id];
      for (const [id, marker] of Object.entries(candidate.retiredEffects ?? {})) if (marker.expiresAt <= Date.now()) delete candidate.retiredEffects![id];
      await this.commit(candidate);
    }
    try { await this.publish(); }
    finally {
      const expiry = [...Object.values(this.data?.effects ?? {}), ...Object.values(this.data?.retiredEffects ?? {})].map(marker => marker.expiresAt).filter(at => at > Date.now());
      if (expiry.length) {
        const next = Math.min(...expiry), currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null || currentAlarm <= Date.now() || currentAlarm > next) await this.state.storage.setAlarm(next);
      }
    }
  }); }

  private async fence(): Promise<GenerationFence> {
    const value = await this.state.storage.get<GenerationFence>('learnFence') ?? { whole: 0, items: {} };
    if (!fields(value, ['whole', 'items']) || !Number.isSafeInteger(value.whole) || value.whole < 0 || !object(value.items)
      || Object.keys(value.items).length > LEARN_LIMITS.items || Object.entries(value.items).some(([key, n]) => !itemName(key) || !Number.isSafeInteger(n) || n < 0)) throw recovery();
    return structuredClone(value);
  }

  private async loadIfAny(): Promise<Stored | null> {
    if (this.data) return this.data;
    const stored: unknown = await this.state.storage.get('learn');
    if (stored === undefined) return null;
    try { stateValid(stored); } catch { throw recovery(); }
    this.data = stored; return stored;
  }

  private async candidate(tenant: string, brand: string, slot: string, config: SlotLearnConfig): Promise<Stored> {
    const existing = await this.loadIfAny();
    if (existing && (existing.tenant !== tenant || existing.brand !== brand || existing.slot !== slot)) throw recovery();
    // A forward anchor only: the stored tuple does not attest to legacy history.
    if (existing && (existing.config.reward !== config.reward
      || (existing.config.objective ?? 'unit') !== (config.objective ?? 'unit')
      || (existing.config.measurementBasis ?? 'served-v1') !== (config.measurementBasis ?? 'served-v1')
      || existing.config.stats.tauLearnMs !== config.stats.tauLearnMs)) {
      throw new Refusal(409, 'statistics configuration incompatible');
    }
    return existing ? { ...structuredClone(existing), config }
      : { tenant, brand, slot, config, stats: { ...emptyStats(), bounded: { depth: 5, omitted: { n: { s: 0, t: 0 }, s: {} }, omittedEvents: 0, selection: 'first-seen' } } };
  }

  private async commit(candidate: Stored): Promise<void> {
    this.fit(candidate); await this.totalBound(candidate);
    try { await this.state.storage.put('learn', candidate); }
    catch (error) { this.data = null; throw error; }
    this.data = candidate;
  }

  private writeRows(kind: StatsWriteReceipt['kind'], received: number, tenant: string, brand: string, slot: string,
    config: SlotLearnConfig, rows: Row[], managed = false): Promise<Response> {
    return this.serialize(async () => {
      const candidate = await this.candidate(tenant, brand, slot, config);
      const fence = managed ? await this.fence() : null;
      // W22 D1.02: the unmanaged online path's own idempotence. The managed
      // path already proves it with effect markers, so the journal is read only
      // where there are none.
      const journal = !managed && kind === 'exposures' ? await this.seenExposures() : null;
      const applied = journal ? new Set(journal.map(row => `${row.id}:${row.digest}`)) : null;
      const added: SeenExposure[] = [];
      let newlyApplied = 0, alreadyApplied = 0, suppressed = 0;
      if (managed) {
        candidate.effects ??= {};
        for (const [id, marker] of Object.entries(candidate.effects)) if (marker.expiresAt <= Date.now()) delete candidate.effects[id];
        for (const [id, marker] of Object.entries(candidate.retiredEffects ?? {})) if (marker.expiresAt <= Date.now()) delete candidate.retiredEffects![id];
      }
      for (const row of rows) {
        if (managed) {
          const effect = row.effect;
          if (!fields(effect, ['version', 'id', 'decision', 'outcome', 'tenant', 'subject', 'generation', 'retention', 'consentUntil'])
            || effect.version !== 1 || effect.tenant !== tenant || !component(effect.subject) || typeof effect.decision !== 'string'
            || !fields(effect.generation, ['whole', 'item']) || !time(effect.consentUntil)
            || effect.consentUntil <= Date.now() || effect.id !== await learningEffectId(kind, `${tenant}:${brand}:${slot}`, effect.decision, effect.outcome)) throw invalid();
          const expected = effect.generation as LearningGeneration;
          if (expected.whole !== fence!.whole || expected.item !== (fence!.items[row.item] ?? 0)) throw new Refusal(409, 'statistics generation changed');
          const retention = requireRetention(this.env, effect.retention, tenant, 'online');
          const barrier = await loadTombstone(this.env.STORAGE, tenant, effect.subject);
          if (barrier && row.ts <= barrier.erased_at) { suppressed++; continue; }
          const digest = await recoveryDigest({ kind, tenant, brand, slot, config, row }), prior = candidate.effects![effect.id];
          const retired = candidate.retiredEffects?.[effect.id];
          if (retired) { if (retired.digest !== digest) throw new Refusal(409, 'statistics effect conflict'); suppressed++; continue; }
          if (prior) {
            if (prior.digest !== digest) throw new Refusal(409, 'statistics effect conflict');
            alreadyApplied++; continue;
          }
          if (Object.keys(candidate.effects!).length + Object.keys(candidate.retiredEffects ?? {}).length >= RECOVERY_LIMITS.effects) throw capacity();
          candidate.effects![effect.id] = { digest, subject: effect.subject, ts: row.ts,
            expiresAt: Math.min(retention.expiresAt, effect.consentUntil), item: row.item };
        }
        // A redelivered exposure is not applied a second time. It is reported as
        // PROCESSED, not skipped: the delivery is complete — this object already
        // holds that impression — and a skip would tell the fan-out it failed.
        // The key is the decision's logical id AND the digest of the record it
        // was served from: a different record under the same id is a different
        // event and is applied, never silently dropped (F16 §5(j)).
        if (applied && row.decision && row.digest) {
          const key = `${row.decision}:${row.digest}`;
          if (applied.has(key)) continue;
          applied.add(key); added.push({ id: row.decision, digest: row.digest, ts: row.ts });
        }
        const cell = candidate.stats.bounded ? { ...row.cell, channel: entryChannelOf(row.cell.channel) ?? 'unknown',
          visit_bucket: ['1', '2-3', '4+'].includes(row.cell.visit_bucket) ? row.cell.visit_bucket : 'unknown',
          stage: ['early', 'mid', 'late'].includes(row.cell.stage ?? '') ? row.cell.stage : 'unknown' } as Cell : row.cell;
        if (kind === 'exposures') recordExposure(candidate.stats, row.item, cell, row.ts, candidate.config.stats);
        else recordSuccess(candidate.stats, row.item, cell, row.reward!, row.ts, row.weight!, candidate.config.stats);
        this.fit(candidate);
        newlyApplied++;
      }
      // Hashing and barrier reads above may yield past any earlier row's deadline.
      for (const row of rows) if (managed) {
        requireRetention(this.env, row.effect!.retention, tenant, 'online');
        if (row.effect!.consentUntil <= Date.now()) throw invalid();
      }
      if (managed) {
        this.fit(candidate); await this.totalBound(candidate);
        try { await this.state.storage.transaction(async tx => {
          await tx.put('learnFence', fence!);
          for (const row of rows) {
            requireRetention(this.env, row.effect!.retention, tenant, 'online');
            if (row.effect!.consentUntil <= Date.now()) throw invalid();
          }
          await tx.put('learn', candidate);
        }); }
        catch (error) { this.data = null; throw error; }
        this.data = candidate;
      } else await this.commit(candidate);
      if (journal && added.length) await this.rememberExposures([...journal, ...added]);
      let alarm: StatsWriteReceipt['alarm'] = 'scheduled';
      try { await this.arm(); } catch { alarm = 'unknown'; }
      const receipt: StatsWriteReceipt = { version: managed ? 2 : 1, kind, received, processed: rows.length, skipped: received - rows.length, alarm,
        ...(managed ? { newlyApplied, alreadyApplied, suppressed } : {}) };
      return json({ ok: true, receipt });
    });
  }

  /** The journal as it stands, pruned to the online horizon. Never throws on a
   * shape it does not recognize: an unreadable journal means no repeat can be
   * recognized, which is the behaviour before it existed, never a refusal. */
  private async seenExposures(): Promise<SeenExposure[]> {
    let stored: unknown;
    try { stored = await this.state.storage.get(SEEN_KEY); } catch { return []; }
    if (!Array.isArray(stored)) return [];
    const now = Date.now(), out: SeenExposure[] = [];
    for (const entry of stored as unknown[]) {
      if (!fields(entry, ['id', 'digest', 'ts']) || typeof entry.id !== 'string' || !entry.id
        || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest) || !time(entry.ts)) continue;
      if (now - (entry.ts as number) > ONLINE_RING_REACH_MS) continue;
      out.push({ id: entry.id, digest: entry.digest, ts: entry.ts as number });
    }
    return out;
  }
  /** Oldest first, inside both caps and inside the object's total bound. */
  private async rememberExposures(rows: SeenExposure[]): Promise<void> {
    try {
      const now = Date.now();
      let kept = rows.filter(row => now - row.ts <= ONLINE_RING_REACH_MS).sort((a, b) => a.ts - b.ts);
      if (kept.length > SEEN_MAX_ROWS) kept = kept.slice(-SEEN_MAX_ROWS);
      while (kept.length && bytes(kept) > SEEN_MAX_BYTES) kept = kept.slice(1);
      await this.totalBound(this.data, undefined, undefined, undefined, kept);
      await this.state.storage.put(SEEN_KEY, kept);
    } catch { /* a repeat this object cannot remember is applied again, never refused */ }
  }

  private async arm(): Promise<void> {
    await this.loadIfAny();
    const next = Math.min(Date.now() + PUBLISH_DELAY_MS, ...[...Object.values(this.data?.effects ?? {}), ...Object.values(this.data?.retiredEffects ?? {})].map(marker => marker.expiresAt));
    const previous = await this.state.storage.getAlarm();
    if (previous === null || previous > next) await this.state.storage.setAlarm(next);
  }

  private async snapshot(d: Stored): Promise<LiftSnapshot> {
    const priors = await this.priorsFor(d);
    // W22 A1.01: the online path has the tenant's published policy in scope
    // here — `priorsFor` has just read the same learn document against which
    // this object's configuration is checked — so the snapshot declares the
    // window that document asks for, and the horizon the visitor's ring really
    // keeps (`ONLINE_RING_REACH_MS`, the ring's own age limit), never
    // a constant of its own.
    const contract = await this.attributionContract(d);
    // Count exactly the item/cell identities the builder will materialize.
    const byItem = new Map(Object.entries(d.stats.items).map(([item, keys]) => [item, new Set(Object.keys(keys))]));
    const slotKeys = new Set(Object.keys(d.stats.slot));
    for (const [item, cells] of priors?.index ?? []) {
      if (!itemName(item)) throw capacity();
      const keys = byItem.get(item) ?? new Set<string>();
      for (const cell of cells.keys()) keys.add(cell);
      byItem.set(item, keys);
    }
    if (byItem.size > LEARN_LIMITS.items) throw capacity();
    let count = 0;
    for (const keys of byItem.values()) for (const key of keys) {
      keyBound(key); count++;
      for (let k: string | null = key; k !== null; k = parentKey(k)) slotKeys.add(k);
    }
    if (count + slotKeys.size > LEARN_LIMITS.counters) throw capacity();
    const snap = buildSnapshot(d.stats, d, d.config.reward, Date.now(), d.config.stats, priors, d.config.objective ?? 'unit', d.config.measurementBasis ?? 'served-v1', contract);
    snap.witness = await this.witness(d, await this.fence());
    if (bytes(snap) > LEARN_LIMITS.snapshotBytes) throw capacity();
    return snap;
  }

  private async publish(): Promise<LiftSnapshot | null> {
    const d = await this.loadIfAny();
    if (!d || d.stats.events === 0) return null;
    // State/prior/snapshot refusals retain their existing semantics. Freeze the
    // estimates and publication time once; allocation never recomputes them.
    const frozen = await this.snapshot(d);
    let version = Math.max(frozen.version, this.lastAllocated + 1);
    try {
      for (let attempt = 0; attempt < 8; attempt++, version++) {
        if (!Number.isSafeInteger(version) || version <= 0) throw new Error('Snapshot version unavailable');
        const snap = { ...frozen, version }, body = JSON.stringify(snap), size = utf8.encode(body).length;
        if (size > LEARN_LIMITS.snapshotBytes) throw capacity();
        const publication = { witness: snap.witness, digest: await recoveryDigest(snap), version };
        await this.totalBound(d, undefined, publication);
        this.lastAllocated = version;
        const key = liftArchiveKey(d.tenant, d.brand, d.slot, version);
        const archived = await this.env.STORAGE.put(key, body, {
          onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' },
        });
        if (archived === null) continue; // A retained key is never overwritten, including after reset/restart.
        if (!archived || archived.key !== key || typeof archived.etag !== 'string' || !archived.etag.trim()
          || archived.etag.length > 256 || archived.size !== size) throw new Error('Archive acknowledgement unavailable');
        await this.state.storage.put('learnPublished', publication);
        await this.env.CACHE.put(liftKey(d.tenant, d.brand, d.slot), body);
        return snap;
      }
      throw new Error('Snapshot versions occupied');
    } catch (error) {
      if (error instanceof Refusal) throw error;
      // An archive or KV acknowledgement can be lost after its write. Keep any
      // orphan archive, schedule only publication again, and never claim rollback.
      await this.state.storage.setAlarm(Date.now() + PUBLISH_DELAY_MS);
      throw new Error('Snapshot publication unavailable');
    }
  }

  /** The tenant's published attribution policy, as this object's own snapshot
   * declares it. Absent when the publication cannot be read: the snapshot then
   * carries no contract rather than a guessed one. */
  private async attributionContract(d: Stored): Promise<AttributionContract | undefined> {
    try {
      const pin = await pinPublication(this.env, d.tenant, true);
      const learn = await readPinnedPublication(this.env, LEARN_KIND, d.tenant, pin);
      return attributionContractOf(learn.value, ONLINE_RING_REACH_MS);
    } catch { return undefined; }
  }

  private async priorsFor(d: Stored): Promise<{ version: number; index: ReturnType<typeof indexPriors> } | null> {
    // Unavailable authority is not an explicit empty prior document. Never
    // publish a prior-free replacement merely because the authority failed.
    const pin = await pinPublication(this.env, d.tenant, true);
    const [rev, learn] = await Promise.all([readPinnedPublication(this.env, PRIORS_KIND, d.tenant, pin), readPinnedPublication(this.env, LEARN_KIND, d.tenant, pin)]);
    const configured = { reward: learn.value.slots?.[d.slot]?.reward ?? 'click', stats: learn.value.stats ?? DEFAULT_STATS,
      objective: learn.value.slots?.[d.slot]?.objective ?? 'unit', measurementBasis: learn.value.slots?.[d.slot]?.measurementBasis ?? 'served-v1' };
    if (await recoveryDigest(configured) !== await recoveryDigest({ ...d.config, objective: d.config.objective ?? 'unit', measurementBasis: d.config.measurementBasis ?? 'served-v1' })) throw recovery();
    if (!Array.isArray(rev.value.rows) || rev.value.rows.length > LEARN_LIMITS.priorRows || bytes(rev.value) > LEARN_LIMITS.priorBytes) throw capacity();
    for (const row of rev.value.rows) if (row.slot === d.slot) {
      if (!itemName(row.item)) throw capacity();
      keyBound(row.cell);
    }
    const index = indexPriors(rev.value, d.slot, d.config.measurementBasis ?? 'served-v1');
    if (d.stats.bounded) for (const [item, keys] of index) {
      if (d.stats.bounded.closed && !Object.hasOwn(d.stats.items, item)) { index.delete(item); continue; }
      for (const key of keys.keys()) if (depth(key) > d.stats.bounded.depth) keys.delete(key);
      if (!keys.size) index.delete(item);
    }
    return { version: rev.revision, index };
  }

  private fit(candidate: Stored): void {
    for (;;) {
      try { stateValid(candidate); return; }
      catch (error) {
        if (!(error instanceof Refusal) || error.status !== 413 || !candidate.stats.bounded || candidate.stats.bounded.depth === 0) throw error;
        boundStats(candidate.stats, (candidate.stats.bounded.depth - 1) as Level);
      }
    }
  }
  private async totalBound(candidate: Stored | null, fence?: GenerationFence, publication?: unknown, reset?: unknown, seen?: unknown): Promise<void> {
    // Fixed key inventory: learn, fence, publication identity, one repair
    // receipt, and the bounded exposure journal (W22 D1.02).
    if (bytes(candidate) + bytes(fence ?? await this.fence()) + bytes(await this.state.storage.get('learnRepair') ?? null)
      + bytes(publication ?? await this.state.storage.get('learnPublished') ?? null)
      + bytes(reset ?? await this.state.storage.get('learnReset') ?? null)
      + bytes(seen ?? await this.state.storage.get(SEEN_KEY) ?? null) > LEARN_LIMITS.totalBytes) throw capacity();
  }
  private async publishedReset(b: Record<string, unknown>): Promise<Response> {
    if (!component(b.tenant) || !component(b.brand) || !component(b.slot) || !itemName(b.item) || typeof b.operationId !== 'string'
      || !object(b.publication)) throw invalid();
    const id = b.publication as unknown as { revision: number; digest: string };
    const set = await committedPublication(this.env, b.tenant, id), op = set.operation;
    if (op.kind !== 'learn' || op.scope !== b.tenant || op.operationId !== b.operationId || op.initialize || op.note !== 'item reset admitted') throw invalid();
    const requestDigest = await recoveryDigest({ operationId: op.operationId, expectedRevision: op.expectedRevision, expectedPublication: op.base,
      actor: op.actor, note: op.note, changes: [{ kind: 'learn', scope: b.tenant, request: { type: 'item-reset', item: b.item, slot: b.slot, brand: b.brand } }] });
    if (requestDigest !== op.requestDigest) throw invalid();
    type Receipt = { operationId: string; publication: { revision: number; digest: string }; item: string; had: boolean };
    const prior = await this.state.storage.get<Receipt>('learnReset');
    if (prior && prior.publication.revision >= id.revision) {
      if (prior.operationId !== b.operationId || prior.publication.digest !== id.digest || prior.item !== b.item) throw new Refusal(409, 'Reset has been superseded; destructive replay refused');
      // The deletion is already committed. Publication alone may be retried.
      let publicationOutcome = 'acknowledged';
      try { await this.publish(); } catch { publicationOutcome = 'unknown'; }
      return json({ ok: true, item: b.item, had: prior.had, resetCompleted: true, publicationOutcome });
    }
    const current = await this.loadIfAny();
    if (current && (current.tenant !== b.tenant || current.brand !== b.brand || current.slot !== b.slot)) throw invalid();
    const fence = await this.fence(), item = b.item;
    if (!(item in fence.items) && Object.keys(fence.items).length >= LEARN_LIMITS.items) throw capacity();
    fence.items[item] = (fence.items[item] ?? 0) + 1; if (!Number.isSafeInteger(fence.items[item])) throw recovery();
    const candidate = current && structuredClone(current), had = !!candidate && Object.hasOwn(candidate.stats.items, item);
    if (candidate) {
      delete candidate.stats.items[item];
      for (const [key, marker] of Object.entries(candidate.effects ?? {})) if (marker.item === item) delete candidate.effects![key];
      stateValid(candidate);
    }
    const receipt: Receipt = { operationId: b.operationId, publication: id, item, had };
    await this.totalBound(candidate, fence, undefined, receipt);
    try {
      await this.state.storage.transaction(async tx => {
        await tx.put('learnFence', fence); if (candidate) await tx.put('learn', candidate); await tx.put('learnReset', receipt);
      });
    } finally { this.data = null; }
    let publicationOutcome = 'acknowledged';
    try { await this.publish(); } catch { publicationOutcome = 'unknown'; }
    return json({ ok: true, item, had, resetCompleted: true, publicationOutcome });
  }
  private witness(d: Stored, fence: GenerationFence): Promise<string> {
    return recoveryDigest({ tenant: d.tenant, brand: d.brand, slot: d.slot, config: d.config, fence,
      projection: d.stats.bounded ? { depth: d.stats.bounded.depth, closed: d.stats.bounded.closed === true } : null });
  }
  private async recoveryControl(b: Record<string, unknown>, path: string): Promise<Response> {
    const raw: unknown = await this.state.storage.get('learn'), fence = await this.fence();
    if (raw !== undefined && (!object(raw) || raw.tenant !== b.tenant || raw.brand !== b.brand || raw.slot !== b.slot)) throw recovery();
    const size = bytes(raw ?? null);
    if (size > LEARN_LIMITS.repairBytes) throw recovery();
    const digest = await recoveryDigest({ raw: raw ?? null, fence });
    let healthy = true;
    try { if (raw !== undefined) { stateValid(raw); await this.totalBound(raw); } } catch { healthy = false; }
    const publication = await this.state.storage.get<{ digest: string; witness: string; version: number }>('learnPublished');
    if (path !== '/recover') return json({ ok: true, tenant: b.tenant, brand: b.brand, slot: b.slot,
      state: raw === undefined ? 'empty' : healthy ? 'healthy' : 'recovery-required', generation: fence.whole, digest, bytes: size,
      publication: publication && /^[a-f0-9]{64}$/.test(publication.digest) && /^[a-f0-9]{64}$/.test(publication.witness) && Number.isSafeInteger(publication.version)
        ? { digest: publication.digest, witness: publication.witness, version: publication.version } : null,
      witness: healthy && raw !== undefined ? await this.witness(raw as unknown as Stored, fence) : null });
    if (b.intent !== 'coarsen' || typeof b.operationId !== 'string' || !/^[a-f0-9]{32}$/.test(b.operationId)
      || typeof b.digest !== 'string' || !/^[a-f0-9]{64}$/.test(b.digest) || !Number.isSafeInteger(b.generation)) throw invalid();
    const prior = await this.state.storage.get<{ operationId: string; before: string; after: string; generation: number }>('learnRepair');
    if (prior?.operationId === b.operationId) {
      if (prior.before !== b.digest || prior.generation !== b.generation || prior.after !== digest) throw new Refusal(409, 'statistics recovery precondition changed');
      this.data = null; await this.arm();
      return json({ ok: true, recovered: true, digest, generation: fence.whole });
    }
    if (digest !== b.digest || fence.whole !== b.generation || raw === undefined) throw new Refusal(409, 'statistics recovery precondition changed');
    stateValid(raw, true); // bounded full shape/provenance validation, not a reset
    const candidate = structuredClone(raw);
    if (!candidate.stats.slot['*'] || Object.values(candidate.stats.items).some(map => !map['*'])) throw recovery();
    coarsenStats(candidate.stats, candidate.config.stats);
    this.fit(candidate);
    const nextFence = { whole: fence.whole + 1, items: {} };
    if (!Number.isSafeInteger(nextFence.whole)) throw recovery();
    const after = await recoveryDigest({ raw: candidate, fence: nextFence });
    const receipt = { operationId: b.operationId, before: digest, after, generation: fence.whole };
    if (bytes(candidate) + bytes(nextFence) + bytes(receipt) + bytes(publication ?? null) + bytes(await this.state.storage.get('learnReset') ?? null) > LEARN_LIMITS.totalBytes) throw capacity();
    try {
      await this.state.storage.transaction(async tx => {
        if (await recoveryDigest({ raw: await tx.get('learn') ?? null, fence: await tx.get('learnFence') ?? { whole: 0, items: {} } }) !== digest) throw new Refusal(409, 'statistics recovery precondition changed');
        await tx.put('learn', candidate); await tx.put('learnFence', nextFence); await tx.put('learnRepair', receipt);
      });
    } catch (error) {
      this.data = null;
      const readback = await recoveryDigest({ raw: await this.state.storage.get('learn') ?? null, fence: await this.fence() });
      if (readback !== after) throw error;
    }
    this.data = null;
    await this.arm();
    return json({ ok: true, recovered: true, digest: after, generation: nextFence.whole });
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn); this.chain = run.catch(() => undefined); return run;
  }
}
