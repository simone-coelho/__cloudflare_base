// src/units/P104/_fold.ts
// The harness of src/units/P104/LEDGER.unit.test.ts (P104, amendment 13 E29): the
// learning report's fold driven the way production drives it — the REAL Worker
// default export's five-minute run (`scheduled`, cron '*/5 * * * *') and its queue
// consumer (`queue`, batch.queue 'events', the existing events queue), and the
// operator's routes — over src/units/_parity.ts's mounted environment on either
// shopper host, with the STORAGE binding replaced by this file's own R2 double.
//
// It holds no expected value of any criterion. It writes the ledger a scenario
// hands it (in the writer's layout, src/ledger/writer.ts:85), drives the platform
// and reads back what storage and the routes hold, and it MEASURES each
// invocation:
//   · a STEP is one invocation: one queue message delivered alone in its batch,
//     one five-minute run (with every waitUntil it schedules), or one operator
//     request (with the Durable Object calls it makes);
//   · what a step HOLDS is the live heap of the process while it runs: sampled at
//     every storage call the step makes and when it ends, above the heap the
//     process held before it began (collected); a sample above the bound is
//     collected and taken again, so garbage never counts, only what is held;
//   · what a step READS: the bytes and the objects of the hour's ledger (keys of
//     the writer's layout, `isLearningKey`) and every other byte it read.
// A step runs inside an AsyncLocalStorage context, so a step cut off at a storage
// call stays dead: every later call of that step never returns, as a killed
// isolate's would not, and nothing it started is charged to the next step.

import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { SignJWT } from 'jose';
import { vi } from 'vitest';

import type { DecisionRecord } from '@/content/types';
import { isLearningKey, ts36 } from '@/ledger/records';
import type { OutcomeRecord } from '@/ledger/records';
import { RETENTION_CATEGORIES, type RetentionPolicy, type RetentionStamp } from '@/retention';
import type { Env } from '@/types/env';

import { expectPublished, mount, TENANT, type Documents, type Host, type Mounted } from '../_parity';

export const MiB = 1024 * 1024;
export const H = 3_600_000;
export const MIN = 60_000;
export const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Memory: the collector, and what the process holds.
// ---------------------------------------------------------------------------

setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as () => void;
/** Where a measurement run writes each step's record (the specification's evidence); unset in the acceptance run. */
const TRACE = process.env.P104_TRACE;
const PRECISE = process.env.P104_PRECISE === '1' || process.env.P104_PRECISE === '2';
/** P104_PRECISE=2: every sample collected first, so a step's figure is the live heap it held, garbage left out (slow; evidence only). */
const LIVE = process.env.P104_PRECISE === '2';
const heap = (): number => process.memoryUsage().heapUsed;

// ---------------------------------------------------------------------------
// One step's measurement.
// ---------------------------------------------------------------------------

export interface StepRecord {
  index: number;
  kind: 'scheduled' | 'queue' | 'request';
  label: string;
  /** The live heap the step held above the heap before it, in bytes (peak). */
  held: number;
  /** Bytes and distinct objects of the ledger (the writer's layout) the step read. */
  ledgerBytes: number;
  ledgerObjects: number;
  /** Every other byte the step read from storage. */
  otherBytes: number;
  /** The ledger keys the step read, in order (each once). */
  ledgerKeys: string[];
  calls: number;
  writes: string[];
  outcome: 'done' | 'threw' | 'cut';
  error?: string;
}

interface Running {
  record: StepRecord;
  base: number;
  bound: number;
  dead: boolean;
  seen: Set<string>;
  cut: () => void;
}

const context = new AsyncLocalStorage<Running>();

/**
 * The live heap the harness itself holds, taken after a collection at the start
 * of every settle (`settled`) and of every operator request. Between two
 * collections the harness only adds to what it holds (records, journal), so a
 * step's base taken from it never exceeds the heap live at the step's start:
 * what a step is charged is never less than what it holds.
 */
let lastLive = 0;
export function settled(): void { collect(); lastLive = heap(); }

function sample(run: Running | undefined): void {
  if (!run) return;
  let held = heap() - run.base;
  if (held > run.record.held && (held > run.bound || LIVE)) { collect(); held = heap() - run.base; }
  if (held > run.record.held) run.record.held = held;
}

/** A fault a scenario plants: at a storage call of a step, the step throws there, or is cut off there (never returns). */
export type Fault = (call: { op: 'get' | 'head' | 'put' | 'delete' | 'list'; key: string; step: StepRecord; n: number }) => 'throw' | 'cut' | undefined;

// ---------------------------------------------------------------------------
// The R2 double: ranged reads, conditional writes, listings with size, etag and
// upload time; every stored body kept as bytes outside the JS heap, every read
// handed out as a fresh copy, so what a step reads is what it holds.
// ---------------------------------------------------------------------------

interface Stored { bytes: Buffer; etag: string; uploaded: number; customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> }
type Conditional = { etagMatches?: string; etagDoesNotMatch?: string; uploadedBefore?: Date; uploadedAfter?: Date } | Headers;
type Range = { offset?: number; length?: number; suffix?: number } | Headers;
const unquote = (v: string | null | undefined) => v == null ? v : v.replace(/^W\//, '').replace(/^"|"$/g, '');

export class FoldR2 {
  objects = new Map<string, Stored>();
  /** Every write and delete, in order, with the step that made it and the time (the frozen clock) it was made at. */
  journal: Array<{ op: 'put' | 'delete'; key: string; bytes: number; step: number; at: number }> = [];
  fault: Fault | null = null;
  private seq = 0;

  private enter(op: 'get' | 'head' | 'put' | 'delete' | 'list', key: string): Promise<never> | null {
    const run = context.getStore();
    if (!run) return null;
    if (run.dead) return new Promise<never>(() => { /* a cut-off step never resumes */ });
    run.record.calls++;
    sample(run);
    const verdict = this.fault?.({ op, key, step: run.record, n: run.record.calls });
    if (verdict === 'cut') { run.dead = true; run.cut(); return new Promise<never>(() => { /* cut off here */ }); }
    if (verdict === 'throw') throw new Error('storage unavailable (planted fault)');
    return null;
  }

  private charge(key: string, n: number): void {
    const run = context.getStore();
    if (!run) return;
    if (isLearningKey(key)) {
      run.record.ledgerBytes += n;
      if (!run.seen.has(key)) { run.seen.add(key); run.record.ledgerObjects++; run.record.ledgerKeys.push(key); }
    } else run.record.otherBytes += n;
    sample(run);
  }

  private meta(key: string, s: Stored) {
    return { key, version: s.etag, size: s.bytes.length, etag: s.etag, httpEtag: `"${s.etag}"`, uploaded: new Date(s.uploaded),
      checksums: {}, storageClass: 'Standard', customMetadata: { ...(s.customMetadata ?? {}) }, httpMetadata: { ...(s.httpMetadata ?? {}) },
      writeHttpMetadata: (headers: Headers) => { if (s.httpMetadata?.contentType) headers.set('content-type', s.httpMetadata.contentType); } };
  }

  async head(key: string) {
    const blocked = this.enter('head', key); if (blocked) return blocked;
    const s = this.objects.get(key);
    return s ? this.meta(key, s) : null;
  }

  async get(key: string, options?: { range?: Range; onlyIf?: Conditional }) {
    const blocked = this.enter('get', key); if (blocked) return blocked;
    const s = this.objects.get(key);
    if (!s) return null;
    if (options?.onlyIf && !this.passes(s, options.onlyIf)) return this.meta(key, s);
    let offset = 0, length = s.bytes.length;
    const range = options?.range;
    if (range instanceof Headers) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.get('range') ?? '');
      if (m) {
        if (m[1] === '') { length = Math.min(s.bytes.length, Number(m[2])); offset = s.bytes.length - length; }
        else { offset = Number(m[1]); length = (m[2] === '' ? s.bytes.length - 1 : Number(m[2])) - offset + 1; }
      }
    } else if (range) {
      if (range.suffix !== undefined) { length = Math.min(s.bytes.length, range.suffix); offset = s.bytes.length - length; }
      else { offset = range.offset ?? 0; length = range.length ?? s.bytes.length - offset; }
    }
    offset = Math.max(0, Math.min(offset, s.bytes.length)); length = Math.max(0, Math.min(length, s.bytes.length - offset));
    const slice = s.bytes.subarray(offset, offset + length);
    const fresh = () => { this.charge(key, slice.length); return new Uint8Array(slice); };
    let used = false, stream: ReadableStream<Uint8Array> | undefined;
    const once = () => { if (used) throw new TypeError('body already used'); used = true; };
    return { ...this.meta(key, s), ...(range ? { range: { offset, length } } : {}),
      /** One stream per object body, as R2's: its bytes are charged to the step when it is read. */
      get body() {
        return (stream ??= new ReadableStream<Uint8Array>({ pull(controller) { once(); controller.enqueue(fresh()); controller.close(); } }));
      },
      get bodyUsed() { return used; },
      text: async () => { once(); return new TextDecoder().decode(fresh()); },
      json: async () => { once(); return JSON.parse(new TextDecoder().decode(fresh())) as unknown; },
      arrayBuffer: async () => { once(); return fresh().buffer; },
      blob: async () => { once(); return new Blob([fresh()]); } };
  }

  private passes(s: Stored | undefined, condition: Conditional): boolean {
    const match = condition instanceof Headers ? unquote(condition.get('if-match')) : unquote(condition.etagMatches);
    const none = condition instanceof Headers ? unquote(condition.get('if-none-match')) : unquote(condition.etagDoesNotMatch);
    if (match != null && (s === undefined || (match !== '*' && match !== s.etag))) return false;
    if (none != null && s !== undefined && (none === '*' || none === s.etag)) return false;
    return true;
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
    options?: { onlyIf?: Conditional; httpMetadata?: Record<string, string> | Headers; customMetadata?: Record<string, string> }) {
    const blocked = this.enter('put', key); if (blocked) return blocked;
    const bytes = await toBytes(value);
    const before = this.objects.get(key);
    if (options?.onlyIf && !this.passes(before, options.onlyIf)) return null;
    const http = options?.httpMetadata instanceof Headers ? { contentType: options.httpMetadata.get('content-type') ?? '' } : options?.httpMetadata;
    const stored: Stored = { bytes, etag: `e${(++this.seq).toString(16).padStart(8, '0')}`, uploaded: Date.now(),
      ...(options?.customMetadata ? { customMetadata: { ...options.customMetadata } } : {}), ...(http ? { httpMetadata: { ...http } } : {}) };
    this.objects.set(key, stored);
    const run = context.getStore();
    if (run) run.record.writes.push(key);
    this.journal.push({ op: 'put', key, bytes: bytes.length, step: run?.record.index ?? -1, at: Date.now() });
    sample(run);
    return this.meta(key, stored);
  }

  async delete(keys: string | string[]) {
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      const blocked = this.enter('delete', key); if (blocked) return blocked;
      if (this.objects.delete(key)) this.journal.push({ op: 'delete', key, bytes: 0, step: context.getStore()?.record.index ?? -1, at: Date.now() });
    }
  }

  async list(options: { prefix?: string; cursor?: string; limit?: number; delimiter?: string; startAfter?: string; include?: string[] } = {}) {
    const blocked = this.enter('list', options.prefix ?? ''); if (blocked) return blocked;
    const prefix = options.prefix ?? '', limit = Math.min(options.limit ?? 1000, 1000);
    let names = [...this.objects.keys()].filter(k => k.startsWith(prefix) && (!options.startAfter || k > options.startAfter)).sort();
    const delimited = new Set<string>();
    if (options.delimiter) {
      const kept: string[] = [];
      for (const name of names) {
        const at = name.indexOf(options.delimiter, prefix.length);
        if (at >= 0) delimited.add(name.slice(0, at + options.delimiter.length)); else kept.push(name);
      }
      names = kept;
    }
    const start = Number(options.cursor ?? 0), end = start + limit;
    return { objects: names.slice(start, end).map(key => this.meta(key, this.objects.get(key)!)), truncated: end < names.length,
      ...(end < names.length ? { cursor: String(end) } : {}), delimitedPrefixes: [...delimited].sort() };
  }

  async createMultipartUpload(key: string, options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }) {
    const parts: Array<{ partNumber: number; bytes: Buffer }> = [];
    const write = (bytes: Buffer) => this.put(key, bytes, options);
    return { key, uploadId: `u${++this.seq}`,
      async uploadPart(partNumber: number, value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob) {
        parts.push({ partNumber, bytes: await toBytes(value) }); return { partNumber, etag: `p${partNumber}` };
      },
      async complete() {
        const bytes = Buffer.concat(parts.sort((a, b) => a.partNumber - b.partNumber).map(p => p.bytes));
        return write(bytes);
      },
      async abort() { parts.length = 0; } };
  }

  /** Bytes the ledger of a prefix holds. */
  ledgerBytesUnder(prefix: string): number {
    let n = 0; for (const [key, s] of this.objects) if (key.startsWith(prefix) && isLearningKey(key)) n += s.bytes.length; return n;
  }
  /** A stored body as text (the test's own read, outside every step). */
  text(key: string): string | null { const s = this.objects.get(key); return s ? s.bytes.toString('utf8') : null; }
  /** Write a body directly (a fixture), outside every step. */
  seed(key: string, body: string | Buffer, customMetadata?: Record<string, string>): void {
    this.objects.set(key, { bytes: typeof body === 'string' ? Buffer.from(body) : body, etag: `e${(++this.seq).toString(16).padStart(8, '0')}`, uploaded: Date.now(),
      ...(customMetadata ? { customMetadata } : {}) });
  }
}

async function toBytes(value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null): Promise<Buffer> {
  if (value === null) return Buffer.alloc(0);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof Blob) return Buffer.from(new Uint8Array(await value.arrayBuffer()));
  const chunks: Uint8Array[] = []; const reader = (value as ReadableStream<Uint8Array>).getReader();
  for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// The tenant's retention registry: every category the fixture policy of
// src/units/_parity.ts, the hourly category's duration the scenario's.
// ---------------------------------------------------------------------------

export function retentionRegistry(hourlyMs = 3650 * DAY): { config: string; policy: (category: string) => RetentionPolicy } {
  const policy = (category: string): RetentionPolicy => ({ id: `p104-${category}`, revision: 1, durationMs: category === 'hourly' ? hourlyMs : 3650 * DAY,
    basis: 'admitted', renewal: 'new-record-only' });
  const categories = Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, policy(category)]));
  return { config: JSON.stringify({ version: 1, tenants: { [TENANT]: categories } }), policy };
}

export function stampsAt(registry: ReturnType<typeof retentionRegistry>, ts: number): { ledger: RetentionStamp; online: RetentionStamp; hourly: RetentionStamp } {
  const one = (category: 'ledger' | 'online' | 'hourly'): RetentionStamp => {
    const p = registry.policy(category);
    return { version: 1, tenant: TENANT, category, policyId: p.id, policyRevision: p.revision, basis: p.basis, bornAt: ts, expiresAt: ts + p.durationMs } as RetentionStamp;
  };
  return { ledger: one('ledger'), online: one('online'), hourly: one('hourly') };
}

// ---------------------------------------------------------------------------
// The tenant's traffic: decision rows shaped exactly as the production producer
// writes them (src/content/decide.ts; a coach record captured at d5d8581c and
// frozen here, so no change to the producer changes a fixture), outcomes as
// src/ledger/records.ts outcomeFromAction writes a nonce-bearing event.
// ---------------------------------------------------------------------------

/** Deterministic generator (xorshift32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export interface Cell { channel: string; visit_bucket: string; region: string }
export interface DecisionSpec { visitor: string; ts: number; page: string; slot: string; item: string; cell: Cell; position?: number; arm?: string }

const CANDIDATES = [1, 5, 9, 2, 6, 0, 3, 4, 7, 8].map((n, i) => ({ contentId: `story.${n}`, score: i < 3 ? 1 : i < 5 ? 0.5 : 0 }));

/** One decision row: the frozen producer record with its identity, time, placement, item and cell. */
export function decisionRow(spec: DecisionSpec, registry: ReturnType<typeof retentionRegistry>): DecisionRecord {
  const position = spec.position ?? 0;
  return {
    decision_id: `${TENANT}:${ts36(spec.ts)}:${spec.visitor}:${spec.page}:${spec.slot}:${position}`,
    tenant: TENANT, brand: TENANT, visitor_id: spec.visitor, session_id: `s-${spec.visitor}`, identity_anchor: 'visitor', ts: spec.ts,
    page: spec.page, slot: spec.slot, position, item_id: spec.item, customer_item_id: `TAP-${spec.item.toUpperCase()}`, ranking_position: position,
    candidates: CANDIDATES, cell: { ...spec.cell, affinity: null }, arm: spec.arm ?? 'personalized', explored: false, authority: 'engine',
    versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 1792454400000, prior: 0, policy: 1 }, config_label: 'coach-v1',
    explain: { drivers: [{ dim: 'line', value: 'Tabby', a: 1, weight: 1 }], score_base: 1, lift: null, score_final: 1 },
    inputs: { affinity: { line: { Tabby: 1, Willow: 0.5 } }, replay: { version: 1, learning: true, candidateLimit: 10, exploration: 'supported-only',
      pins: 'prefix-reserved-v2', contentTypes: 'catalog-tags-v1', governance: 'slot-gates-v2', slots: [{ slot: spec.slot, lift: 1792454400000, prior: 0 }] },
      explorationRules: 'recorded-draws-v1' },
    retention: stampsAt(registry, spec.ts),
  } as unknown as DecisionRecord;
}

export interface OutcomeSpec { visitor: string; ts: number; event: 'content_click' | 'add_to_cart' | 'purchase'; item: string; nonce: string; value?: number | null; currency?: string | null }
const REWARD: Record<OutcomeSpec['event'], string> = { content_click: 'click', add_to_cart: 'add_to_bag', purchase: 'purchase' };

/** One outcome row: a nonce-bearing event as outcomeFromAction records it (src/ledger/records.ts:411). */
export function outcomeRow(spec: OutcomeSpec, registry: ReturnType<typeof retentionRegistry>): OutcomeRecord {
  return {
    outcome_id: `${TENANT}:${ts36(spec.ts)}:${spec.visitor}:${spec.event}:n1:${spec.nonce}`, event_id: spec.nonce, event_id_source: 'provided',
    tenant: TENANT, brand: TENANT, visitor_id: spec.visitor, session_id: `s-${spec.visitor}`, ts: spec.ts, type: REWARD[spec.event], event: spec.event,
    item_id: spec.item, slot: null, value: spec.value ?? null, currency: spec.currency ?? null, margin: null, products: null, arm: null,
    retention: stampsAt(registry, spec.ts),
  } as unknown as OutcomeRecord;
}

/** The writer's object name for rows of one hour and stream (src/ledger/writer.ts:85). */
export const ledgerKey = (prefix: string, stream: 'decision' | 'outcome', min: number, max: number, batch: string) =>
  `${prefix}/${stream}/${ts36(min)}-${ts36(max)}-${batch}.ndjson`;
export const hourPrefixOf = (ms: number) => {
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0');
  return `${TENANT}/${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}/${p(d.getUTCHours())}`;
};

/**
 * Ledger objects for rows, in the writer's layout: one object per batch, hour and
 * stream, `perObject` rows each, in time order; `tag` names the batch.
 */
export function ledgerObjects(rows: Array<DecisionRecord | OutcomeRecord>, perObject: number, tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const groups = new Map<string, Array<DecisionRecord | OutcomeRecord>>();
  for (const row of rows) {
    const stream = 'decision_id' in row ? 'decision' : 'outcome';
    const key = `${hourPrefixOf(row.ts)}|${stream}`;
    const list = groups.get(key) ?? []; list.push(row); groups.set(key, list);
  }
  for (const [group, list] of groups) {
    const [prefix, stream] = group.split('|') as [string, 'decision' | 'outcome'];
    list.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < list.length; i += perObject) {
      const chunk = list.slice(i, i + perObject);
      out.set(ledgerKey(prefix, stream, chunk[0]!.ts, chunk[chunk.length - 1]!.ts, `${tag}${i}`), chunk.map(r => JSON.stringify(r)).join('\n') + '\n');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The stamp: one host's mounted platform, the R2 double in STORAGE, the events
// queue captured, the Worker's own handlers.
// ---------------------------------------------------------------------------

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled(event: { cron: string; scheduledTime: number; noRetry(): void }, env: Env, ctx: ExecutionContext): Promise<void>;
  queue(batch: unknown, env: Env, ctx: ExecutionContext): Promise<void>;
};
let worker: Promise<Worker> | undefined;
/** The real Worker default export, loaded once per file (after the file's module doubles are registered). */
export const loadWorker = (): Promise<Worker> => (worker ??= import('@/index').then(module => module.default as unknown as Worker));

export interface Queued { id: string; body: unknown; attempts: number }

export interface Stamp {
  host: Host;
  m: Mounted;
  env: Env;
  r2: FoldR2;
  queue: Queued[];
  steps: StepRecord[];
  /** One mark per queue message the platform sent (what the five-minute run and the steps enqueued). */
  sent: number[];
  /** Every operator request and the status it was answered with. */
  answers: Array<{ method: string; path: string; status: number; at: number }>;
}

export const RECOVERY = JSON.stringify({ version: 1, sourceQueue: 'events', deadLetterQueue: 'events-dead-letter' });
/** Deliveries of one message before the platform gives up on it (wrangler.toml [[queues.consumers]] max_retries = 2). */
export const DELIVERIES = 3;

export async function stamp(host: Host, documents: Documents, registry: ReturnType<typeof retentionRegistry>, what: string): Promise<Stamp> {
  const m = await mount(host, documents);
  expectPublished(m, what);
  const r2 = new FoldR2();
  for (const [key, body] of m.storage.objects) r2.seed(key, body, m.storage.metadata.get(key));
  const queue: Queued[] = [], sent: number[] = [];
  let ids = 0;
  const push = (body: unknown) => { sent.push(1); queue.push({ id: `m${++ids}`, body: structuredClone(body), attempts: 0 }); };
  Object.assign(m.env as unknown as Record<string, unknown>, {
    STORAGE: r2, RETENTION: registry.config, LEDGER_RECOVERY_CONFIG: RECOVERY, IDENTITY_SALT: 'p104-synthetic-identity-salt-quarantine-provenance',
    EVENT_QUEUE: { send: async (body: unknown) => { push(body); }, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const message of messages) push(message.body); } },
  });
  return { host, m, env: m.env, r2, queue, steps: [], sent, answers: [] };
}

const waitAll = async (pending: Promise<unknown>[]) => { while (pending.length) await Promise.allSettled(pending.splice(0)); };

/** Run one step under its measurement. */
export async function step<T>(s: Stamp, kind: StepRecord['kind'], label: string, run: (ctx: ExecutionContext) => Promise<T>, bound = 64 * MiB): Promise<{ record: StepRecord; value?: T }> {
  const record: StepRecord = { index: s.steps.length, kind, label, held: 0, ledgerBytes: 0, ledgerObjects: 0, otherBytes: 0, ledgerKeys: [], calls: 0, writes: [], outcome: 'done' };
  s.steps.push(record);
  const started = performance.now();
  // P104_PRECISE (a measurement run's evidence): every step's base taken after a collection, so its figure is what it held alone.
  if (!lastLive || kind === 'request' || PRECISE) settled();
  let cut!: () => void;
  const cutOff = new Promise<'cut'>(resolve => { cut = () => resolve('cut'); });
  const running: Running = { record, base: lastLive, bound, dead: false, seen: new Set(), cut };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext;
  let value: T | undefined;
  const body = context.run(running, async () => { const v = await run(ctx); await waitAll(pending); return v; });
  try {
    const result = await Promise.race([body, cutOff]);
    if (result === 'cut') record.outcome = 'cut'; else value = result as T;
  } catch (error) { record.outcome = 'threw'; record.error = error instanceof Error ? error.message : String(error); }
  if (record.outcome !== 'cut') sample(running);
  // A cut-off step never returns, and what it held stays held: the harness's base is taken again past it.
  else settled();
  if (TRACE) appendFileSync(TRACE, JSON.stringify({ host: s.host, i: record.index, kind, label, held: +(record.held / MiB).toFixed(1), ledger: +(record.ledgerBytes / MiB).toFixed(2),
    objects: record.ledgerObjects, other: +(record.otherBytes / MiB).toFixed(2), calls: record.calls, outcome: record.outcome, ms: Math.round(performance.now() - started), at: new Date(Date.now()).toISOString() }) + '\n');
  return { record, ...(value !== undefined ? { value } : {}) };
}

/** One five-minute run of the Worker at the frozen time `at`. */
export async function fiveMinuteRun(s: Stamp, at: number): Promise<StepRecord> {
  vi.setSystemTime(at);
  const app = await loadWorker();
  return (await step(s, 'scheduled', `*/5 at ${new Date(at).toISOString()}`, ctx =>
    app.scheduled({ cron: '*/5 * * * *', scheduledTime: at, noRetry() { /* never */ } }, s.env, ctx))).record;
}

export interface DeliveryPlan {
  /** Called before each delivery: return 'drop-ack' to run the step and lose its acknowledgement (a crash after the step), or a Fault to plant for this delivery. */
  before?: (message: Queued, n: number) => { fault?: Fault; dropAck?: boolean; twice?: boolean } | undefined;
}

/**
 * Deliver every queued message, one per batch, in order, until the queue is empty:
 * a message neither acknowledged nor retried by its step, or whose step threw or
 * was cut off, is delivered again (at most DELIVERIES times in all), as the queue
 * does; one the platform gave up on is dropped (dead-lettered).
 */
export async function drainQueue(s: Stamp, at: number, plan: DeliveryPlan = {}, cap = 20_000): Promise<void> {
  vi.setSystemTime(at);
  const app = await loadWorker();
  let n = 0;
  while (s.queue.length) {
    if (++n > cap) throw new Error(`the events queue did not drain within ${cap} deliveries`);
    const message = s.queue.shift()!;
    message.attempts++;
    const directive = plan.before?.(message, n);
    const deliver = async () => {
      let acked = false, retried = false;
      const batch = { queue: 'events', messages: [{ id: message.id, timestamp: new Date(at), body: structuredClone(message.body), attempts: message.attempts,
        ack: () => { acked = true; }, retry: () => { retried = true; } }], ackAll: () => { acked = true; }, retryAll: () => { retried = true; } };
      const standing = s.r2.fault;
      s.r2.fault = directive?.fault ?? standing;
      const { record } = await step(s, 'queue', `message ${message.id} (delivery ${message.attempts})`, ctx => app.queue(batch, s.env, ctx));
      s.r2.fault = standing;
      return { record, acked: acked && !retried && record.outcome === 'done' && !directive?.dropAck };
    };
    let result;
    if (directive?.twice) {
      const [a, b] = await Promise.all([deliver(), deliver()]);
      result = { acked: a.acked || b.acked };
    } else result = await deliver();
    if (!result.acked && message.attempts < DELIVERIES) s.queue.push(message);
  }
}

/**
 * The platform's own schedule at one moment: five-minute runs at the frozen time
 * `at`, each followed by the queue drained, until a run and its queue change no
 * stored object (at most `runs` runs).
 */
/** Writes that are not the learning report's: the warehouse slice's schedule, which every five-minute run rewrites. */
const NOISE = /^warehouse\//;
export async function settleAt(s: Stamp, at: number, plan: DeliveryPlan = {}, runs = 40): Promise<number> {
  settled();
  for (let i = 1; i <= runs; i++) {
    const before = s.r2.journal.length;
    await fiveMinuteRun(s, at);
    await drainQueue(s, at, plan);
    if (!s.r2.journal.slice(before).some(entry => !NOISE.test(entry.key))) return i;
  }
  return runs + 1;
}

/** As production schedules it: the five-minute runs from `from` to `to`, each settled. */
export async function scheduleBetween(s: Stamp, from: number, to: number, plan: DeliveryPlan = {}): Promise<void> {
  for (let at = from; at <= to; at += 5 * MIN) await settleAt(s, at, plan, 20);
}

/** An operator credential minted at the frozen clock's present (the mount's own expires two hours after the mount), as _parity mints it. */
async function operatorToken(env: Env): Promise<string> {
  const e = env as unknown as { JWT_SECRET: string; JWT_ISSUER: string; JWT_AUDIENCE: string };
  return new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setIssuer(e.JWT_ISSUER).setAudience(e.JWT_AUDIENCE).setExpirationTime('2h').sign(new TextEncoder().encode(e.JWT_SECRET));
}

/** An operator request through the mounted routes, measured as one step. */
export async function operator(s: Stamp, method: 'GET' | 'POST', path: string, body?: unknown, at?: number): Promise<{ status: number; body: Record<string, unknown>; record: StepRecord }> {
  if (at !== undefined) vi.setSystemTime(at);
  const { record, value } = await step(s, 'request', `${method} ${path}`, async () => {
    const response = await s.m.fetch(new Request(`http://local${path}`, { method, headers: { Authorization: `Bearer ${await operatorToken(s.env)}`, 'Content-Type': 'application/json', 'X-Tenant': TENANT },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const text = await response.text();
    await s.m.drain();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = { raw: text.slice(0, 300) }; }
    return { status: response.status, body: parsed };
  });
  s.answers.push({ method, path, status: value?.status ?? 599, at: Date.now() });
  return { status: value?.status ?? 599, body: value?.body ?? { error: record.error ?? record.outcome }, record };
}

/** Write a scenario's ledger objects (a fixture: written outside every step, at the time the queue would have written them). */
export function writeLedger(s: Stamp, objects: Map<string, string>): void {
  for (const [key, body] of objects) s.r2.seed(key, body);
}

/** The steps that broke the bound or a fixed input, each named. */
export function overBound(steps: readonly StepRecord[], bound = 64 * MiB): string[] {
  return steps.filter(r => r.held > bound).map(r => `${r.label}: held ${(r.held / MiB).toFixed(1)} MiB (ledger ${(r.ledgerBytes / MiB).toFixed(1)} MiB in ${r.ledgerObjects} objects, other ${(r.otherBytes / MiB).toFixed(1)} MiB)`);
}
export function overPage(steps: readonly StepRecord[], bytes = 16 * MiB, objects = 200): string[] {
  return steps.filter(r => r.ledgerBytes > bytes || r.ledgerObjects > objects).map(r => `${r.label}: read ${(r.ledgerBytes / MiB).toFixed(2)} MiB of ledger in ${r.ledgerObjects} objects`);
}

// ---------------------------------------------------------------------------
// The tenant (coach): ten content slots on six pages, ten pieces each, the three
// rewards the kit names (click, add to bag, purchase), no holdout.
// ---------------------------------------------------------------------------

export const DATE = '2026-10-20';
export const DAY0 = Date.UTC(2026, 9, 20);
/** A moment of the scenario day (hours may pass 23 into the next day). */
export const at = (hour: number, minute = 0, second = 0) => DAY0 + hour * H + minute * MIN + second * 1000;
export const SLOTS = ['home-hero', 'home-stories', 'plp-banner', 'plp-editorial', 'pdp-story', 'pdp-complete', 'cart-reco', 'search-promo', 'account-offers', 'checkout-upsell'] as const;
export const PAGE_OF: Record<string, string> = { 'home-hero': 'home', 'home-stories': 'home', 'plp-banner': 'plp', 'plp-editorial': 'plp', 'pdp-story': 'pdp',
  'pdp-complete': 'pdp', 'cart-reco': 'cart', 'search-promo': 'search', 'account-offers': 'account', 'checkout-upsell': 'checkout' };
const REWARDS = ['click', 'add_to_bag', 'purchase'] as const;
export const REWARD_OF: Record<string, string> = Object.fromEntries(SLOTS.map((slot, i) => [slot, REWARDS[i % 3]!]));
const LINES = ['Tabby', 'Willow', 'Brooklyn', 'Rogue'];

/** The product a piece features (a Coach-shaped product id): a purchase naming it credits the decision that showed the piece. */
export const featuredProduct = (slot: string, n: number) => `COA-${slot.split('-').map(w => w[0]!.toUpperCase()).join('')}${String(n).padStart(3, '0')}`;
export function documents(learnExtra: Record<string, unknown> = {}, slotExtra: Record<string, Record<string, unknown>> = {}): Documents {
  const pieces = SLOTS.flatMap(slot => Array.from({ length: 10 }, (_, n) => ({ id: `${slot}.${n}`, customerContentId: `TAP-${slot.toUpperCase()}-${n}`, type: 'editorial',
    title: `${slot} ${n}`, tags: { line: [LINES[n % 4]!] }, slotTypes: [slot], lifecycle: { status: 'live' }, featuredProductIds: [featuredProduct(slot, n)] })));
  const pages: Record<string, unknown[]> = {};
  for (const slot of SLOTS) (pages[PAGE_OF[slot]!] ??= []).push({ slot, take: 4, weights: { line: 1 } });
  return { pieces, slots: { version: 'p104-slots', pages }, learn: { version: 'p104-learn', holdout: { share: 0, salt: 'p104', arms: ['default'] },
    regional: { enabled: false, kBlend: 1, minEvents: 30 }, ...learnExtra,
    slots: Object.fromEntries(SLOTS.map(slot => [slot, { reward: REWARD_OF[slot], ...(slotExtra[slot] ?? {}) }])) } };
}

/** Today's visitor hash (FNV-1a, src/learn/hourly.ts:124 shardOf), frozen here: a leaf is a residue class of it (the design §4). */
export function visitorHash(visitor: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < visitor.length; i++) { h ^= visitor.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
/** `count` visitor ids of residue class `r` modulo `modulus`, named `<prefix>-<n>`. */
export function visitorsOf(prefix: string, count: number, r?: number, modulus = 64): string[] {
  const out: string[] = [];
  for (let n = 0; out.length < count; n++) { const id = `${prefix}-${n}`; if (r === undefined || visitorHash(id) % modulus === r) out.push(id); }
  return out;
}

export const NARROW = { channels: ['direct', 'search'], buckets: ['1'], regions: ['US-NY', 'US-CA'] };
/** T5's wide context, held under the live table's 4,096 counters per slot: 4 channels x 3 visit buckets x 10 regions. */
export const WIDE = { channels: ['direct', 'search', 'email', 'social'], buckets: ['1', '2-3', '4+'], regions: ['US-NY', 'US-CA', 'US-TX', 'US-FL', 'US-IL', 'US-WA', 'GB-LND', 'FR-IDF', 'JP-13', 'CA-ON'] };

export interface Visit { visitor: string; decisions: DecisionRecord[]; outcomes: OutcomeRecord[] }
/**
 * One visit: `count` decisions over twenty minutes from `start`, cycling the ten
 * slots, a random piece of each; a click on the first and the fourth piece shown,
 * an add to bag on the second, and a purchase on the ninth one visit in ten.
 */
export interface Content { context: { channels: string[]; buckets: string[]; regions: string[] }; slots: readonly string[]; items: number }
/** The whole tenant: ten slots of ten pieces, two channels and two regions. */
export const FULL: Content = { context: NARROW, slots: SLOTS, items: 10 };
/** The parity scenarios' small content space (three slots, one per reward, of four pieces; one context cell), so their committed reference stays small. */
export const SMALL: Content = { context: { channels: ['direct'], buckets: ['1'], regions: ['US-NY'] }, slots: ['home-hero', 'plp-banner', 'checkout-upsell'], items: 4 };
export function visit(registry: ReturnType<typeof retentionRegistry>, visitor: string, start: number, count: number, r: () => number,
  content: Content = FULL, tag = ''): Visit {
  const context = content.context;
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  const cell = { channel: pick(context.channels), visit_bucket: pick(context.buckets), region: pick(context.regions) };
  const decisions: DecisionRecord[] = [];
  for (let k = 0; k < count; k++) {
    const slot = content.slots[k % content.slots.length]!;
    decisions.push(decisionRow({ visitor, ts: start + Math.floor((k * 20 * MIN) / Math.max(1, count)) + k, page: PAGE_OF[slot]!, slot, item: `${slot}.${Math.floor(r() * content.items)}`, cell }, registry));
  }
  const outcomes: OutcomeRecord[] = [];
  const credit = (event: OutcomeSpec['event'], k: number, lag: number, value: number | null = null) => {
    const d = decisions[Math.min(k, count - 1)]!;
    outcomes.push(outcomeRow({ visitor, ts: d.ts + lag, event, item: d.item_id, nonce: `${tag}${visitor}-${event}-${k}`, value }, registry));
  };
  if (count > 0) {
    credit('content_click', 0, 30_000); credit('content_click', 3, 30_000); credit('add_to_cart', 1, 60_000);
    if (r() < 0.1) credit('purchase', 8, 120_000, 575);
  }
  return { visitor, decisions, outcomes };
}
export const rowsOf = (visits: readonly Visit[]) => visits.flatMap(v => [...v.decisions, ...v.outcomes]);

// ---------------------------------------------------------------------------
// Scenarios: what the ledger holds and when, and what the operator does when.
// A moment's ledger objects are written at its time (as the queue writes them),
// its operator actions run, then the platform settles at that time.
// ---------------------------------------------------------------------------

export type Action = (s: Stamp) => Promise<void>;
export interface Moment { at: number; ledger?: Map<string, string>; actions?: Action[] }
export interface Scenario { name: string; moments: Moment[]; hours: number[] }

/** The custom-policy POST (raw day): today's operator surface that files a read conflict it meets (src/routes/decisions.ts:2030–2043). */
export const RAW_POLICY = { name: 'p104-raw', scope: 'session', match: 'direct', credit: 'last' };
export const fileConflicts: Action = async s => { await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE, policies: [RAW_POLICY] }); };
export const erase = (visitorId: string): Action => async s => { await operator(s, 'POST', `/v1/${TENANT}/ledger/erasures`, { visitorId }); };

export async function play(s: Stamp, scenario: Scenario, plan: DeliveryPlan = {}, until = Infinity): Promise<void> {
  for (const moment of scenario.moments) {
    if (moment.at > until) break;
    vi.setSystemTime(moment.at);
    // Written, then let go: the ledger lives in the store as bytes, not in the test's heap the steps are measured against.
    if (moment.ledger) { writeLedger(s, moment.ledger); moment.ledger = undefined; settled(); }
    for (const action of moment.actions ?? []) { await action(s); await drainQueue(s, moment.at, plan); }
    await settleAt(s, moment.at, plan);
  }
}

const hourVisits = (registry: ReturnType<typeof retentionRegistry>, ids: readonly string[], hour: number, r: () => number, span = 35, count = 22, content: Content = SMALL, tag = '') =>
  ids.map(id => visit(registry, id, at(hour) + Math.floor(r() * span * MIN), count, r, content, tag));

/** Objects split by the hour their name places them in (`<tenant>/<date>/<hh>/…`). */
export function byHour(objects: Map<string, string>): Map<number, Map<string, string>> {
  const out = new Map<number, Map<string, string>>();
  for (const [key, body] of objects) {
    const [, date, hh] = /^[^/]+\/(\d{4}-\d{2}-\d{2})\/(\d{2})\//.exec(key)!;
    const hour = Math.round((Date.parse(`${date}T00:00:00Z`) - DAY0) / H) + Number(hh);
    const map = out.get(hour) ?? new Map<string, string>(); map.set(key, body); out.set(hour, map);
  }
  return out;
}
/** Each hour's objects written when it has closed, at the five-minute run that may fold it (hh+1:06). */
function hourly(objects: Map<string, string>): Moment[] {
  return [...byHour(objects)].sort(([a], [b]) => a - b).map(([hour, ledger]) => ({ at: at(hour + 1, 6), ledger }));
}
/** Moments merged by time (ledger objects and actions of one time kept together, in order). */
function timeline(...lists: Moment[][]): Moment[] {
  const merged = new Map<number, Moment>();
  for (const moment of lists.flat()) {
    const held = merged.get(moment.at) ?? { at: moment.at };
    if (moment.ledger) { held.ledger ??= new Map(); for (const [k, v] of moment.ledger) held.ledger.set(k, v); }
    if (moment.actions) held.actions = [...(held.actions ?? []), ...moment.actions];
    merged.set(moment.at, held);
  }
  return [...merged.values()].sort((a, b) => a.at - b.at);
}
const twinOf = (d: DecisionRecord, shift: number): DecisionRecord =>
  ({ ...d, item_id: d.item_id.replace(/\.(\d)$/, (_m, n: string) => `.${(Number(n) + shift) % 10}`) }) as DecisionRecord;
const single = (row: DecisionRecord, tag: string) => new Map([[ledgerKey(hourPrefixOf(row.ts), 'decision', row.ts, row.ts, tag), JSON.stringify(row) + '\n']]);

/**
 * C — commit and resume. Hour 12: 200 visitors (about 8.6 MiB of ledger, in
 * objects of 100 rows), one decision of theirs delivered a second time with
 * another piece (a conflict, not yet filed); hour 13: 450 visitors (about 19 MiB,
 * two pages), so the rings pass today's 3.69 MiB. The operator files the
 * conflict at 13:20 with the custom-policy POST.
 */
export function scenarioC(registry: ReturnType<typeof retentionRegistry>): Scenario & { conflictId: string; conflictKeys: string[] } {
  const r = rng(104_003);
  const h12 = hourVisits(registry, visitorsOf('c12', 200), 12, r), h13 = hourVisits(registry, visitorsOf('c13', 450), 13, r);
  const twin = h12[7]!.decisions[5]!;
  const objects = ledgerObjects(rowsOf(h12), 100, 'b');
  for (const [k, v] of ledgerObjects(rowsOf(h13), 500, 'b')) objects.set(k, v);
  const conflict = single(twinOf(twin, 1), 'redelivered');
  const original = [...objects].find(([, body]) => body.includes(`"decision_id":"${twin.decision_id}"`))![0];
  return { name: 'C', hours: [12, 13], conflictId: twin.decision_id, conflictKeys: [original, ...conflict.keys()],
    moments: timeline(hourly(objects), [{ at: at(13, 6), ledger: conflict }, { at: at(13, 20), actions: [fileConflicts] }, { at: at(13, 26) }, { at: at(14, 30) }]) };
}

/**
 * M — migration. A store today's code wrote (fixtures/v2-store.json: the 64
 * shards with hour 12's v2 plan left in shard zero, no other shard yet written),
 * hour 12's ledger (4 visitors, 10 decisions each) and hour 13's (450 visitors, two pages).
 */
export function scenarioM(registry: ReturnType<typeof retentionRegistry>): Scenario {
  const r = rng(104_013);
  const objects = ledgerObjects(rowsOf(hourVisits(registry, visitorsOf('m12', 4), 12, r, 35, 10)), 100, 'b');
  for (const [k, v] of ledgerObjects(rowsOf(hourVisits(registry, visitorsOf('m13', 450), 13, r)), 500, 'b')) objects.set(k, v);
  return { name: 'M', hours: [12, 13], moments: timeline(hourly(objects), [{ at: at(14, 30) }]) };
}

/**
 * P — parity. Hours 10 to 14 of one day: visitors crossing from 11 into 12 and
 * from 12 into 13, fifteen of hour 11's back in hour 12; hour 13 above two pages
 * (about 19 MiB), its first object a recovery object that also holds the rows of
 * its last one (so those rows are read on the first page and again on the last);
 * a conflict in hour 12 filed before its fold; two erasures; hourly retention of
 * three hours, so hour 11's ring entries have expired by hour 14's fold; a late
 * object in hour 12 after its fold (a re-fold of a grown hour); hour 10's objects
 * arriving after hour 11 was folded (an earlier hour folded after a later one).
 */
export function scenarioP(registry: ReturnType<typeof retentionRegistry>): Scenario {
  const r = rng(104_002);
  const h11 = hourVisits(registry, visitorsOf('p11', 60), 11, r, 55);
  const h12 = [...hourVisits(registry, visitorsOf('p12', 70), 12, r, 58), ...visitorsOf('p11', 15).map((id, i) => visit(registry, id, at(12, 40, i), 6, r, SMALL, 'back-'))];
  const h13 = hourVisits(registry, visitorsOf('p13', 460), 13, r, 50);
  const h14 = hourVisits(registry, visitorsOf('p14', 40), 14, r, 30);
  const objects = ledgerObjects(rowsOf([...h11, ...h12, ...h14]), 200, 'b');
  const l13 = ledgerObjects(rowsOf(h13), 500, 'b');
  const keys13 = [...l13.keys()].filter(k => k.startsWith(hourPrefixOf(at(13))) && k.includes('/decision/')).sort();
  const firstKey = keys13[0]!, lastKey = keys13[keys13.length - 1]!;
  const lastRows = l13.get(lastKey)!.split('\n').filter(Boolean), lastMax = (JSON.parse(lastRows[lastRows.length - 1]!) as DecisionRecord).ts;
  const firstMin = (JSON.parse(l13.get(firstKey)!.split('\n')[0]!) as DecisionRecord).ts;
  l13.set(ledgerKey(hourPrefixOf(firstMin), 'decision', firstMin, lastMax, 'recovered'), l13.get(firstKey)! + lastRows.join('\n') + '\n');
  l13.delete(firstKey);
  for (const [k, v] of l13) objects.set(k, v);
  const twin = h12[3]!.decisions[4]!;
  const late10 = ledgerObjects(rowsOf(hourVisits(registry, visitorsOf('p10', 12), 10, r, 0, 8)), 200, 'late');
  const late12 = ledgerObjects(rowsOf([visit(registry, visitorsOf('p12late', 1)[0]!, at(12, 50), 10, r, SMALL, 'late-')]), 200, 'late');
  return { name: 'P', hours: [10, 11, 12, 13, 14], moments: timeline(hourly(objects), [
    { at: at(11, 6) },
    { at: at(12, 36), ledger: late10 },
    { at: at(13, 6), ledger: single(twinOf(twin, 3), 'redelivered') },
    { at: at(13, 20), actions: [erase(h12[9]!.visitor), erase(h13[11]!.visitor)] },
    { at: at(13, 30), ledger: late12 },
    { at: at(15, 30) },
  ]).map(m => (m.at === at(13, 6) ? { ...m, actions: [fileConflicts, ...(m.actions ?? [])] } : m)) };
}
