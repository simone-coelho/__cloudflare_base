// src/units/P102/LEDGER.unit.test.ts
// P102 under the Closure Ledger (programme `tapestry-parity-first-paint`, amendment 13, item E27; batch S48): the tests
// for the LOCAL criteria CR1–CR6 of the P102 work order (docs/parity/first-paint/program.json). LV1 is a deferred live
// row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md:30–33, E27):
//   "#### E27 · The first answer's content read
//    - **Authority:** P97's root-cause analysis (R-P547) left the customer stamps' first answer bounded by reading the
//      published content; the diagnosis `S44/analyst-stamps-content/DESIGN.md` (R-P553): every first answer on a machine
//      holding nothing reads the published content in three sequential storage trips, the per-isolate memory forgets
//      after 30 s, and a stamp's storage trip costs about 1.7× the pair's. In force under the owner's direction of
//      28 October (R-P545): every problem fixed at its root cause.
//    - **Done when:** a publication's set and documents are kept for as long as memory allows (the head still checked on
//      every decision); the head carries each document's version so a machine holding nothing reads the content in one
//      round, existing tenants backfilled without an operator's publication; a brand-new machine reaches the content in
//      one trip; the per-trip storage time reported so the stamps' slower trip is measured live; the answers identical;
//      the stamps' cold first answer within about 300 ms of server time once P97 ships.
//    - **Needed by:** the first activation (January), with P97. Three to four days."
// THE DESIGN (R-P553, R-P555; _evidence/parity-step3/S44/analyst-stamps-content/DESIGN.md): A holds a publication's set and
// documents by its identity for as long as memory allows; B writes each member's revision as the head object's storage
// metadata so a machine holding nothing reads the set and its members in one round; C writes one serving copy per commit,
// read beside the head; the backfill from the five-minute scheduled run; the per-trip report; the P84 class draw's pin
// naming its learn member. The legs pin the cause's fix — the storage trips a machine makes before the content is read —
// never a cache length.
//
// THE HARNESS (the S44 probe's, `tools-kept/probe.unit.test.ts`): src/units/_parity.ts mounts the routes production serves
// over the real Durable Object classes on either shopper host; every get and head of the mount's bucket under
// `config-publication/` is metered, and where a leg names a latency each is held that long (100 ms where the work order
// sets a bound) after the object is taken, so reads issued together overlap and a read issued after another's answer
// opens a new wave. "Holding nothing" is a machine after invalidatePublicationCache (a brand-new isolate); "idle" is the
// same isolate 61 s (and 400 days) after it last read the tenant (Date.now moved, as the probe moved it); "warm" is a
// second answer moments later. An existing tenant (today's commit) is the head rewritten with its own bytes and no
// storage metadata and no serving copy, as today's `finish` leaves it.
//
// THE READINGS (where the work order leaves a shape open; the lead may re-rule):
//   R1 The serving copy's fixed name per scope is the design's (§8): `config-publication/v2/<scope>/serving.json`. The
//      R10 lists of P93 and P86 name it, so it is one name for the batch.
//   R2 C's copy is read beside the head by a pin that NAMES its members (the decision's documents stage and the P84 class
//      draw) on a machine holding nothing of the tenant under that bucket; a serving read that names none (an event's
//      vocabulary read, src/config/publication.servingCache.test.ts's actions) reads as today (A and B only). So the
//      servingCache test's cold lists at :76 and :112 are unchanged, and :88 and :97 hold (they are outside the grant
//      and change if every serving pin read the copy).
//   R3 CR4's member: the one member of `sources` beside `timings` whose value is an array, one entry per storage trip in
//      order, each entry an object carrying its time as its one number (whole milliseconds) and naming what it read in
//      its text members — `head`, `set` (with its members), `serving` or `copy`. Its name is the builder's; kit 02 names
//      it as `sources.<name>`.
//   R4 The bounds (120 ms, 220 ms, 120 ms) are held by the median of three answers, as the design measured (§5).
//   R5 "Identical to today's" is compared against the same product reading an existing tenant's publication (no
//      metadata, no copy): the path today's code takes, three waves.
//   R6 "The backfill then changes nothing": neither the head (its bytes, metadata and version) nor the serving copy the
//      publication wrote is touched by a five-minute run that lost to it.
//   R7 Kit 02's serving paragraph is the one that says configuration administration bypasses the serving cache; the
//      clauses are read in it sentence by sentence.
//
// R10 BY NAME (the brief S48/SPEC-BRIEF-P102.md; the work order's allowedPaths), before → after:
//   src/config/publication.servingCache.test.ts:128–141 — "keeps the administrative read and the cache expiry as they
//     were": past 30 s [head, set, reflex, content] → "past the serving cache's 30 seconds … the head alone": [head]
//     (A). :76 and :112 unchanged (R2).
//   src/units/P93/LEDGER.unit.test.ts:108–111 (pageReads) — head, set, four revisions, shard, part (8) → head, the
//     serving copy, shard, part (4) (C); :568 (the one-level page) — head, set, four revisions, part (7) → head, the
//     serving copy, part (3).
//   src/units/P86/LEDGER.unit.test.ts:1036–1043 (P86 CS2's exact cold list) — head, set, four revisions, shard, part →
//     head, the serving copy, shard, part.
//
// DEFERRED: LV1 (lane L21: the stamps' cold first answer within about 300 ms of server time with P97; the per-trip split
// from CR4 on both pair hosts and both stamps; the stamps' pilot tenant backfilled without a publication).
// RESIDUALS (told, not pinned): the byte bound of what A holds (the work order names no figure) and the writers'
// invalidation of it (no answer or read shows it in one isolate: a new publication is a new identity); the synthetic
// monitor's scoped bucket (src/ops/synthetic.ts:211–223) needs a telemetry policy this harness has not, so its reads are
// left to the gate's src/index.api-boundary.test.ts, which runs it natively; P98 rewrites the shard and part reads into
// packs, so the P93 helpers this file imports follow P98's R10.
//
// HARNESS: src/units/_parity.ts and src/units/P93/_catalog.ts (the range tenant, its index and meter); the real Worker's
// scheduled handler (src/index.ts) for the five-minute run, with the module doubles every suite loading the Worker
// registers (src/units/P96/LEDGER.unit.test.ts). NO NEW EXPORT IS IMPORTED. Imports from src/units/: ../_parity,
// ../P93/_catalog.

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { invalidatePublicationCache } from '@/config/publication';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import type { Env } from '@/types/env';

import {
  asOperator, BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, loadDocument, MODULES, mount, pageInstanceOf, readTree,
  shopperOn, TENANT, UnitR2, type Answer, type Mounted,
} from '../_parity';
import { A, BLACK, bucketOf, carousel, catalogue, KEY, metered, rangeTenant, readClasses, SERVED_FOR_BLACK, snapshotOf } from '../P93/_catalog';

const DOCS = { pieces: [...MODULES], slots: declaredSlots([layoutSlot()]), learn: learnDocument() };
/** CR5: a context-only layout slot, so the answer carries a context key (P30). */
const DOCS_WITH_KEY = { pieces: [...MODULES], slots: declaredSlots([layoutSlot({ contextOnly: { enabled: true } })]), learn: learnDocument() };
const HEAD = `config-publication/v2/${TENANT}/head.json`;
/** Reading R1: the serving copy's fixed name for the tenant. */
const SERVING = `config-publication/v2/${TENANT}/serving.json`;
const setKey = (n: number) => `config-publication/v2/${TENANT}/set/${n}.json`;
/** The work order's harness latency: 100 ms a read. */
const G = 100;
const MiB = 1024 * 1024;
/** The forwarded decision's five stages and the door's own entries (P76, P96), as Server-Timing names them today. */
const STAGES = ['documents', 'shopper', 'trend', 'lift', 'decide'];
const DOOR_TIMINGS = [...STAGES, 'session', 'forward', 'total'];
const sorted = (values: Iterable<string>) => [...values].sort();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

// ---------------------------------------------------------------------------
// The meter (the S44 probe's): the bucket's reads under config-publication/, held `g` ms each, and its writes.
// ---------------------------------------------------------------------------

interface Read { key: string; cls: string; start: number; end: number }
interface Meter {
  g: number; armed: boolean; reads: Read[]; puts: string[];
  /** Called once a read is issued (the object already taken), before its answer is returned. */
  onRead?: (key: string) => Promise<void>;
  /** Called before a write reaches the bucket. */
  onPut?: (key: string) => Promise<void>;
}
/** A key's class: the head, the serving copy (R1), a set, `<kind> revision`, else the key itself. */
function classOf(key: string): string {
  if (key === SERVING) return 'serving copy';
  if (/\/head\.json$/.test(key)) return 'head';
  if (/\/set\/[0-9]+\.json$/.test(key)) return 'set';
  const revision = /^config-publication\/v1\/[^/]+\/([^/]+)\/rev\/[0-9]+\.json$/.exec(key);
  return revision ? `${revision[1]} revision` : key;
}
function meterOf(m: Mounted): Meter {
  const meter: Meter = { g: 0, armed: false, reads: [], puts: [] };
  const bucket = m.storage as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const op of ['get', 'head'] as const) {
    const original = bucket[op]!.bind(m.storage);
    bucket[op] = async (...args: unknown[]) => {
      const key = String(args[0]), counted = meter.armed && key.startsWith('config-publication/'), start = performance.now();
      const answer = original(...args);
      if (counted && meter.onRead) await meter.onRead(key);
      if (counted && meter.g) await sleep(meter.g);
      const out = await answer;
      if (counted) meter.reads.push({ key, cls: classOf(key), start, end: performance.now() });
      return out;
    };
  }
  const put = bucket.put!.bind(m.storage);
  bucket.put = async (...args: unknown[]) => {
    const key = String(args[0]);
    if (meter.armed && key.startsWith('config-publication/')) meter.puts.push(key);
    if (meter.onPut && key.startsWith('config-publication/')) await meter.onPut(key);
    return put(...args);
  };
  return meter;
}
/** Sequential waves (the probe's): a read that starts before the earliest end of the current wave joins it; else it opens the next. */
function waves(reads: readonly Read[]): string[][] {
  const out: Array<{ end: number; classes: string[] }> = [];
  for (const r of [...reads].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && r.start < last.end - 0.5) { last.classes.push(r.cls); last.end = Math.min(last.end, r.end); }
    else out.push({ end: r.end, classes: [r.cls] });
  }
  return out.map(w => sorted(w.classes));
}
/** One measured operation: the meter armed at `g`, its reads and writes. */
async function measured<T>(meter: Meter, g: number, run: () => Promise<T>): Promise<{ result: T; reads: Read[]; puts: string[] }> {
  meter.reads = []; meter.puts = []; meter.g = g; meter.armed = true;
  try { return { result: await run(), reads: meter.reads, puts: meter.puts }; }
  finally { meter.armed = false; meter.g = 0; }
}
const readSet = (reads: readonly Read[]) => sorted(reads.map(r => r.cls));

// ---------------------------------------------------------------------------
// The shopper: the first-request door and a held session's page view (P13 H4, P76).
// ---------------------------------------------------------------------------

interface Reply { status: number; body: Record<string, unknown>; header: string | null; contextKey: string | null; capability: string }
async function snapshot(m: Mounted, capability: string | null, label: string, extra: Record<string, unknown> = {}): Promise<Reply> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...(capability ? { [SHOPPER_HEADER]: capability } : {}) },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf(label), ...extra }) }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body, header: response.headers.get('Server-Timing'), contextKey: response.headers.get('X-Context-Key'),
    capability: capability ?? (body.session as { capability?: string } | undefined)?.capability ?? '' };
}
/** A new visitor's first request (the door). */
const door = (m: Mounted, label: string, extra: Record<string, unknown> = {}) => snapshot(m, null, label, extra);
/** The same visitor's next page view, holding the session the door issued. */
const held = (m: Mounted, capability: string, label: string) => snapshot(m, capability, label);
const timingsOf = (r: Reply) => ((r.body.sources as { timings?: Record<string, number> } | undefined)?.timings ?? {});
const documentsOf = (r: Reply) => timingsOf(r).documents ?? Number.NaN;
const show = (r: Reply) => `${r.status} ${JSON.stringify(r.body).slice(0, 240)}`;
/** What the shopper is answered: the versions, the decisions, the experiment and the context key (CR5). */
const answerOf = (r: Reply) => ({ status: r.status, versions: r.body.versions ?? null,
  decisions: ((r.body.decisions ?? []) as Array<{ slot: string; contentId: string; order: number; strategy?: string }>).map(d => [d.slot, d.contentId, d.order, d.strategy ?? null]),
  experiment: r.body.experiment ?? null, contextKey: r.contextKey });
/** Server-Timing's entry names, in order. */
const headerNames = (header: string | null) => ((header ?? '').match(/(?:[^,"]|"[^"]*")+/g) ?? []).map(p => p.trim()).filter(Boolean).map(p => p.split(';')[0]!.trim());

/** Run `work` with Date.now moved `ms` ahead (the S44 probe's idle machine). */
async function later<T>(ms: number, work: () => Promise<T>): Promise<T> {
  const realNow = Date.now.bind(Date), base = realNow();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => base + ms + (realNow() - base));
  try { return await work(); } finally { clock.mockRestore(); }
}

// ---------------------------------------------------------------------------
// The publication as stored.
// ---------------------------------------------------------------------------

/** A merchandiser's save through the operator's route (kit 02: If-Match plus Idempotency-Key); the cache is NOT cleared here. */
async function publish(m: Mounted, kind: 'slots' | 'catalog', document: unknown, note: string): Promise<Answer> {
  const base = await loadDocument(m, kind);
  return asOperator(m, 'PUT', `/content/${kind}?scope=${TENANT}`, { document, note }, {
    'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` });
}
/** The second slots publication: its own version label and K = 3, so an answer under it differs from one under the first. */
const SLOTS_2 = declaredSlots([layoutSlot({ take: 3 })], { version: 'p102-slots-2' });
const SLOTS_3 = declaredSlots([layoutSlot({ take: 2 })], { version: 'p102-slots-3' });
interface Stored { head: string; meta: Record<string, string>; version: number; copy: string | null }
const stored = (m: Mounted): Stored => ({ head: m.storage.objects.get(HEAD) ?? '', meta: { ...(m.storage.metadata.get(HEAD) ?? {}) },
  version: m.storage.versions.get(HEAD) ?? 0, copy: m.storage.objects.get(SERVING) ?? null });
/** An existing tenant's publication as today's commit leaves it: the head's own bytes with no storage metadata, and no serving copy. */
async function asCommittedToday(m: Mounted): Promise<void> {
  await UnitR2.prototype.put.call(m.storage, HEAD, m.storage.objects.get(HEAD)!);
  await UnitR2.prototype.delete.call(m.storage, SERVING);
}
/** Put back what `stored` saw (the head's metadata and the serving copy). */
async function restore(m: Mounted, saved: Stored): Promise<void> {
  await UnitR2.prototype.put.call(m.storage, HEAD, saved.head, { customMetadata: saved.meta } as R2PutOptions);
  if (saved.copy !== null) await UnitR2.prototype.put.call(m.storage, SERVING, saved.copy);
}
/** The canonical JSON the publication seals (keys sorted, no whitespace) and its SHA-256. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
/** The head as today's code reads it: its five fields, `pending` null, its digest the seal of the rest, its bytes canonical. */
function headAsToday(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as Record<string, unknown>, { digest, ...rest } = value;
  return { fields: sorted(Object.keys(value)), pending: Object.hasOwn(value, 'pending') ? value.pending : 'absent', sealed: digest === sha256(canonical(rest)), canonical: text === canonical(value) };
}
const HEAD_AS_TODAY = { fields: ['committed', 'digest', 'pending', 'schema', 'scope'], pending: null, sealed: true, canonical: true };
/** The members of the committed set (`<kind>:<scope>` → revision). */
function membersOf(m: Mounted): Record<string, number> {
  const head = JSON.parse(m.storage.objects.get(HEAD)!) as { committed: { revision: number } };
  const set = JSON.parse(m.storage.objects.get(setKey(head.committed.revision))!) as { refs: Record<string, { revision: number }> };
  return Object.fromEntries(Object.entries(set.refs).map(([key, ref]) => [key, ref.revision]));
}
/** Whether the head object's storage metadata names every member of the committed set with its revision. */
function metadataNamesMembers(m: Mounted): string {
  const text = JSON.stringify(m.storage.metadata.get(HEAD) ?? {});
  const missing = Object.entries(membersOf(m)).filter(([key, revision]) => !new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^0-9]{1,12}${revision}(?![0-9])`).test(text));
  return text === '{}' ? 'no storage metadata on the head' : missing.length ? `metadata ${text.slice(0, 200)} does not name ${missing.map(([k, n]) => `${k} ${n}`).join(', ')}` : 'names every member\'s revision';
}

// ---------------------------------------------------------------------------
// The five-minute scheduled run, through the real Worker's handler.
// ---------------------------------------------------------------------------

type Worker = { scheduled(event: { cron: string; scheduledTime: number; noRetry(): void }, env: Env, ctx: ExecutionContext): Promise<void> };
let worker: Promise<Worker> | undefined;
const loadWorker = (): Promise<Worker> => (worker ??= import('@/index').then(module => module.default as unknown as Worker));
async function fiveMinuteRun(m: Mounted): Promise<{ jobs: number; rejected: number }> {
  const app = await loadWorker(), pending: Promise<unknown>[] = [];
  await app.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now(), noRetry() { /* the platform's; never called here */ } }, m.env,
    { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p)); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  let rejected = 0;
  for (let i = 0; i < pending.length; i++) { try { await pending[i]; } catch { rejected++; } }
  await m.drain();
  return { jobs: pending.length, rejected };
}

// ---------------------------------------------------------------------------
// CR4's report (reading R3).
// ---------------------------------------------------------------------------

interface Trip { ms: number; read: string }
function tripOf(entry: unknown): Trip | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const values = Object.values(entry as Record<string, unknown>), numbers = values.filter((v): v is number => typeof v === 'number');
  const words = values.flatMap(v => typeof v === 'string' ? [v] : Array.isArray(v) && v.every(x => typeof x === 'string') ? v as string[] : []);
  if (numbers.length !== 1 || numbers.length + values.filter(v => typeof v === 'string' || Array.isArray(v)).length !== values.length) return null;
  return { ms: numbers[0]!, read: words.join(' ').toLowerCase() };
}
/** The member of `sources` beside `timings` that reports the documents stage's trips, or what `sources` holds instead. */
function tripReport(r: Reply): { name: string; trips: Trip[] } | { name: null; members: string[] } {
  const sources = (r.body.sources ?? {}) as Record<string, unknown>;
  const found = Object.entries(sources).filter(([name, value]) => name !== 'timings' && Array.isArray(value) && value.length > 0 && value.every(e => tripOf(e) !== null));
  return found.length === 1 ? { name: found[0]![0], trips: (found[0]![1] as unknown[]).map(e => tripOf(e)!) } : { name: null, members: sorted(Object.keys(sources)) };
}
const tripsShown = (r: Reply) => { const report = tripReport(r); return report.name === null ? `no member of sources reports the trips (sources: ${report.members.join(', ')})` : JSON.stringify(report.trips); };
/** A trip's report reduced to what it read (reading R3's words) and its time within [lo, hi]. */
const tripShape = (trip: Trip, lo: number, hi: number) => ({ head: /head/.test(trip.read), set: /\bset\b/.test(trip.read), copy: /serving|copy/.test(trip.read),
  whole: Number.isInteger(trip.ms), within: trip.ms >= lo && trip.ms <= hi });

// ===========================================================================
// unit:P102.CR1 — fix A: a publication's set and documents held by its identity for as long as memory allows
// ===========================================================================

describe('unit:P102.CR1 (fix A: held by identity; the head read on every decision)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an idle machine — the same isolate 61 s and 400 days after it last read the tenant — answers a new visitor's first request reading the head alone, its documents stage at most 120 ms at 100 ms a read, the answer the warm machine's`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR1 — the tenant documents publish');
      const meter = meterOf(m);
      const warm = await door(m, 'p102-cr1-warm');
      expect(warm.status, `${host}: PRECONDITION — the door answers (${show(warm)})`).toBe(200);
      const idle: Array<{ reads: string[]; documents: number; answer: unknown }> = [];
      for (let rep = 1; rep <= 3; rep++) {
        const run = await later(61_000 * rep, () => measured(meter, G, () => door(m, `p102-cr1-idle-${rep}`)));
        idle.push({ reads: readSet(run.reads), documents: documentsOf(run.result), answer: answerOf(run.result) });
      }
      const ancient = await later(400 * 86_400_000, () => measured(meter, 0, () => door(m, 'p102-cr1-ancient')));
      expect.soft({ reads: idle.map(i => i.reads), answers: idle.map(i => i.answer), ancient: [readSet(ancient.reads), answerOf(ancient.result)] },
        `${host}: P102.CR1 — an idle machine reads the head alone, at 61 s and at 400 days (today the set and the four documents again past 30 s: ${JSON.stringify(idle.map(i => i.reads))}; at 400 days ${JSON.stringify(readSet(ancient.reads))})`).toEqual({
        reads: [['head'], ['head'], ['head']], answers: idle.map(() => answerOf(warm)), ancient: [['head'], answerOf(warm)] });
      expect.soft(median(idle.map(i => i.documents)), `${host}: P102.CR1 — an idle machine's documents stage at 100 ms a read, median of ${JSON.stringify(idle.map(i => i.documents))} ms (today about 305)`).toBeLessThanOrEqual(120);
    }, 120_000);

    it(`host (${host}): the head is still read on every decision, so a publication committed meanwhile is served on the very next one; what is held is cleared by invalidatePublicationCache, never taken by an administrative read, and never answers when the head cannot be read`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR1 — the tenant documents publish');
      const meter = meterOf(m);
      expect((await door(m, 'p102-cr1-first')).status, `${host}: PRECONDITION — the door answers`).toBe(200);
      // An idle machine: the next decision reads the head alone (A) — the precondition of every clause below.
      const idle = await later(61_000, () => measured(meter, 0, () => door(m, 'p102-cr1-idle')));
      // An administrative read on a machine idle again (no serving entry fresh) reads the head, the set and its member from storage.
      const admin = await later(122_000, () => measured(meter, 0, () => asOperator(m, 'GET', `/content/learn?scope=${TENANT}`)));
      // A publication, then the very next decision.
      const published = await publish(m, 'slots', SLOTS_2, 'p102 cr1');
      const next = await later(183_000, () => measured(meter, 0, () => door(m, 'p102-cr1-next')));
      // Cleared: after invalidatePublicationCache the publication is read again.
      await later(244_000, () => door(m, 'p102-cr1-fill'));
      invalidatePublicationCache();
      const cleared = await later(305_000, () => measured(meter, 0, () => door(m, 'p102-cr1-cleared')));
      // The head cannot be read, 61 s after the machine last read it: nothing held answers.
      await later(366_000, () => door(m, 'p102-cr1-hold'));
      meter.onRead = async key => { if (key === HEAD) throw new Error('synthetic authority outage of the head'); };
      const outage = await later(427_000, () => measured(meter, 0, () => door(m, 'p102-cr1-outage')));
      meter.onRead = undefined;
      expect.soft({ idle: readSet(idle.reads), admin: [admin.result.status, readSet(admin.reads)], published: published.status,
        next: [next.result.status, (next.result.body.versions as { slots?: unknown } | undefined)?.slots ?? null, readSet(next.reads).includes('head')],
        cleared: readSet(cleared.reads).some(c => c === 'serving copy' || c === 'set'), outage: [outage.result.status >= 500, Array.isArray(outage.result.body.decisions)] },
      `${host}: P102.CR1 — held past 30 s, the head read every time, cleared and refused as today (idle read ${JSON.stringify(readSet(idle.reads))}; next ${show(next.result)})`).toEqual({
        idle: ['head'], admin: [200, ['head', 'learn revision', 'set']], published: 200, next: [200, 2, true], cleared: true, outage: [true, false] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P102.CR2 — fix B: the head names its members; the backfill from the five-minute run
// ===========================================================================

describe('unit:P102.CR2 (fix B: the head object\'s member metadata; the five-minute backfill)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the commit writes each member's revision as the head object's storage metadata, the head's JSON, digest and field set as today; a machine holding nothing without the serving copy reads the head, then the set and the content, slots, learn and reflex documents together — two waves, its documents stage at most 220 ms at 100 ms a read`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR2 — the tenant documents publish');
      const meter = meterOf(m);
      const warm = await door(m, 'p102-cr2-warm');
      await UnitR2.prototype.delete.call(m.storage, SERVING);
      const cold: Array<{ waves: string[][]; documents: number; answer: unknown }> = [];
      for (let rep = 1; rep <= 3; rep++) {
        invalidatePublicationCache();
        const run = await measured(meter, G, () => door(m, `p102-cr2-cold-${rep}`));
        cold.push({ waves: waves(run.reads), documents: documentsOf(run.result), answer: answerOf(run.result) });
      }
      const second = (w: string[][]) => w[1] ?? [];
      expect.soft({ head: headAsToday(m.storage.objects.get(HEAD) ?? '{}'), metadata: metadataNamesMembers(m) },
        `${host}: P102.CR2 — the committed head's JSON as today, its storage metadata naming each member's revision`).toEqual({ head: HEAD_AS_TODAY, metadata: 'names every member\'s revision' });
      expect.soft({ waves: cold.map(c => c.waves.length), second: cold.map(c => second(c.waves)), answers: cold.map(c => c.answer) },
        `${host}: P102.CR2 — two waves, the set and the four members together in the second (today three: ${JSON.stringify(cold[0]?.waves)})`).toEqual({
        waves: [2, 2, 2], second: cold.map(() => ['content revision', 'learn revision', 'reflex revision', 'set', 'slots revision']), answers: cold.map(() => answerOf(warm)) });
      expect.soft(median(cold.map(c => c.documents)), `${host}: P102.CR2 — a machine holding nothing, without the copy, at 100 ms a read: median of ${JSON.stringify(cold.map(c => c.documents))} ms (today about 307)`).toBeLessThanOrEqual(220);
    }, 120_000);

    it(`host (${host}): the metadata is a hint and never authority — a hint naming absent revisions, a stale slots revision or malformed text gives the answer a true hint gives`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR2 — the tenant documents publish');
      const first = stored(m);
      const published = await publish(m, 'slots', SLOTS_2, 'p102 cr2 hint');
      expect(published.status, `${host}: PRECONDITION — the second slots document publishes (${published.status})`).toBe(200);
      const second = stored(m);
      await UnitR2.prototype.delete.call(m.storage, SERVING);
      const ask = async (meta: Record<string, string>, label: string) => {
        m.storage.metadata.set(HEAD, meta); invalidatePublicationCache();
        return answerOf(await door(m, `p102-cr2-${label}`));
      };
      const truth = await ask(second.meta, 'true');
      const absent = await ask(Object.fromEntries(Object.entries(second.meta).map(([k, v]) => [k, v.replace(/[0-9]+/g, '99')])), 'absent');
      const stale = await ask(first.meta, 'stale');
      const malformed = await ask(Object.fromEntries(Object.keys(second.meta).map(k => [k, 'not json {'])), 'malformed');
      expect.soft({ hinted: Object.keys(second.meta).length > 0 && JSON.stringify(second.meta) !== JSON.stringify(first.meta), slots: (truth.versions as { slots?: unknown } | null)?.slots ?? null },
        `${host}: P102.CR2 — PRECONDITION: the second commit's head carries metadata of its own (today none: ${JSON.stringify(second.meta)})`).toEqual({ hinted: true, slots: 2 });
      expect.soft({ absent, stale, malformed }, `${host}: P102.CR2 — a wrong hint changes no answer`).toEqual({ absent: truth, stale: truth, malformed: truth });
    }, 120_000);

    it(`host (${host}): an existing tenant (a head without the metadata, no serving copy) is read as today by a decision that writes nothing; the five-minute scheduled run rewrites its head with the same bytes and the metadata, and a second run writes nothing`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR2 — the tenant documents publish');
      const meter = meterOf(m);
      const reference = answerOf(await door(m, 'p102-cr2-reference'));
      await asCommittedToday(m);
      const before = stored(m);
      invalidatePublicationCache();
      const today = await measured(meter, 20, () => door(m, 'p102-cr2-today'));
      const untouched = stored(m);
      const run = await fiveMinuteRun(m);
      const backfilled = stored(m);
      const metadata = metadataNamesMembers(m);
      await UnitR2.prototype.delete.call(m.storage, SERVING);
      invalidatePublicationCache();
      const hinted = await measured(meter, 20, () => door(m, 'p102-cr2-hinted'));
      await fiveMinuteRun(m);
      const settled = stored(m);
      await fiveMinuteRun(m);
      const again = stored(m);
      expect.soft({ today: [answerOf(today.result), waves(today.reads).length, today.puts], untouched: [untouched.head === before.head, untouched.meta, untouched.version === before.version] },
        `${host}: P102.CR2 — an existing tenant's head is read as before (three waves), and the decision writes nothing (${JSON.stringify(today.puts)})`).toEqual({
        today: [reference, 3, []], untouched: [true, {}, true] });
      expect.soft({ run: run.rejected, head: backfilled.head === before.head, json: headAsToday(backfilled.head), metadata, hinted: [answerOf(hinted.result), waves(hinted.reads).length],
        again: [again.version === settled.version, again.head === settled.head, JSON.stringify(again.meta) === JSON.stringify(settled.meta), again.copy === settled.copy] },
      `${host}: P102.CR2 — the five-minute run backfills the head (same bytes, the metadata) once (head version ${before.version} → ${backfilled.version} → ${settled.version} → ${again.version}; metadata ${JSON.stringify(backfilled.meta)})`).toEqual({
        run: 0, head: true, json: HEAD_AS_TODAY, metadata: 'names every member\'s revision', hinted: [reference, 2], again: [true, true, true, true] });
    }, 120_000);

    it(`host (${host}): a publication committed between the five-minute run's read and its write wins, and the run then changes nothing (R6); a publication that meets the run's rewrite of its head is not refused for it`, async () => {
      // A publication committed meanwhile wins.
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR2 — the tenant documents publish');
      const meter = meterOf(m);
      await asCommittedToday(m);
      let racing = false, raced: Answer | null = null, after: Stored | null = null;
      meter.onPut = async key => {
        if (racing || raced || (key !== HEAD && key !== SERVING)) return;
        racing = true;
        try { raced = await publish(m, 'slots', SLOTS_2, 'p102 cr2 meanwhile'); after = stored(m); } finally { racing = false; }
      };
      await fiveMinuteRun(m);
      meter.onPut = undefined;
      const end = stored(m);
      const lost = raced as Answer | null, committed = after as Stored | null;
      expect.soft({ raced: lost?.status ?? 'the run wrote nothing to race (no backfill)' },
        `${host}: P102.CR2 — PRECONDITION: the run's backfill writes, and a publication commits before its write lands`).toEqual({ raced: 200 });
      if (committed) {
        expect.soft({ head: end.head === committed.head, meta: JSON.stringify(end.meta) === JSON.stringify(committed.meta), version: end.version === committed.version,
          copy: end.copy === committed.copy, committed: (JSON.parse(end.head) as { committed?: { revision?: number } }).committed?.revision ?? null },
        `${host}: P102.CR2 — the run that lost changes nothing: the head and the copy are the publication's (head version ${committed.version} → ${end.version})`).toEqual({
          head: true, meta: true, version: true, copy: true, committed: 2 });
      }
      // A publication that meets the run's rewrite of its head.
      const n = await mount(host, DOCS);
      expectPublished(n, 'P102.CR2 — the tenant documents publish');
      const nMeter = meterOf(n);
      await asCommittedToday(n);
      const start = stored(n);
      let ran = false, during: Stored | null = null;
      nMeter.onPut = async key => {
        if (ran || key !== HEAD) return;
        ran = true; nMeter.onPut = undefined;
        await fiveMinuteRun(n); during = stored(n);
      };
      const met = await publish(n, 'slots', SLOTS_2, 'p102 cr2 met');
      nMeter.onPut = undefined;
      invalidatePublicationCache();
      const next = await door(n, 'p102-cr2-met');
      const rewritten = during as Stored | null;
      expect.soft({ rewrote: rewritten ? rewritten.version > start.version && Object.keys(rewritten.meta).length > 0 : 'the run did not run' },
        `${host}: PRECONDITION — the five-minute run rewrote the head while the publication was in flight (today no backfill: version ${start.version} → ${rewritten?.version ?? 'n/a'})`).toEqual({ rewrote: true });
      expect.soft({ met: met.status, slots: (next.body.versions as { slots?: unknown } | undefined)?.slots ?? null },
        `${host}: P102.CR2 — the publication that met the rewrite is committed, not refused (${met.status} ${JSON.stringify(met.body).slice(0, 200)})`).toEqual({ met: 200, slots: 2 });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P102.CR3 — fix C: the serving copy, read beside the head
// ===========================================================================

/** A catalogue piece no slot serves whose excerpt makes the catalogue about 1.1 MB, so the copy would pass 1 MiB. */
const LONG_PIECE = { id: 'module.PDP.longread.1', customerContentId: 'TAP-PDP-LONGREAD-1', type: 'editorial', title: 'A long read', tags: { line: ['Tabby'] },
  slotTypes: ['p102-no-slot'], journeyStageFit: ['exploring'], lifecycle: { status: 'live' }, excerpt: 'Tabby '.repeat(190_000) };

describe('unit:P102.CR3 (fix C: one serving copy per commit, read beside the head)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a machine holding nothing reads the head and the serving copy together — one wave, those two objects alone — its documents stage at most 120 ms at 100 ms a read, the answer the warm machine's`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR3 — the tenant documents publish');
      const meter = meterOf(m);
      const warm = await door(m, 'p102-cr3-warm');
      const cold: Array<{ reads: string[]; waves: number; documents: number; answer: unknown }> = [];
      for (let rep = 1; rep <= 3; rep++) {
        invalidatePublicationCache();
        const run = await measured(meter, G, () => door(m, `p102-cr3-cold-${rep}`));
        cold.push({ reads: readSet(run.reads), waves: waves(run.reads).length, documents: documentsOf(run.result), answer: answerOf(run.result) });
      }
      expect.soft({ reads: cold.map(c => c.reads), waves: cold.map(c => c.waves), answers: cold.map(c => c.answer) },
        `${host}: P102.CR3 — the head and the serving copy, one wave (today: ${JSON.stringify(cold[0]?.reads)} in ${cold[0]?.waves} waves)`).toEqual({
        reads: cold.map(() => ['head', 'serving copy']), waves: [1, 1, 1], answers: cold.map(() => answerOf(warm)) });
      expect.soft(median(cold.map(c => c.documents)), `${host}: P102.CR3 — a machine holding nothing at 100 ms a read: median of ${JSON.stringify(cold.map(c => c.documents))} ms (today about 307)`).toBeLessThanOrEqual(120);
    }, 120_000);

    it(`host (${host}): the copy is used only where it is the head's committed identity and every member matches its ref — a stale copy (the previous publication's), a copy whose slots member was altered, a malformed copy and a missing one each give the answer the true copy gives`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR3 — the tenant documents publish');
      const first = stored(m);
      expect((await publish(m, 'slots', SLOTS_2, 'p102 cr3 copy')).status, `${host}: PRECONDITION — the second slots document publishes`).toBe(200);
      const second = stored(m);
      const ask = async (copy: string | null, label: string) => {
        if (copy === null) await UnitR2.prototype.delete.call(m.storage, SERVING); else await UnitR2.prototype.put.call(m.storage, SERVING, copy);
        invalidatePublicationCache();
        return answerOf(await door(m, `p102-cr3-${label}`));
      };
      const truth = await ask(second.copy, 'true');
      const stale = await ask(first.copy, 'stale');
      const altered = await ask(second.copy?.replace('"take":3', '"take":4') ?? null, 'altered');
      const malformed = await ask('{"schema":"not a serving copy"}', 'malformed');
      const missing = await ask(null, 'missing');
      expect.soft({ copies: [first.copy !== null, second.copy !== null && second.copy !== first.copy, second.copy?.includes('"take":3') ?? false], slots: (truth.versions as { slots?: unknown } | null)?.slots ?? null },
        `${host}: P102.CR3 — PRECONDITION: each commit wrote its serving copy (today none)`).toEqual({ copies: [true, true, true], slots: 2 });
      expect.soft({ stale, altered, malformed, missing }, `${host}: P102.CR3 — a stale, altered, malformed or missing copy changes no answer`).toEqual({ stale: truth, altered: truth, malformed: truth, missing: truth });
    }, 120_000);

    it(`host (${host}): the copy is at most 1 MiB — a publication whose copy would pass it writes none, and a machine holding nothing then reads the head, then the set and its members (CR2's two waves), answering the new catalogue`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR3 — the tenant documents publish');
      const meter = meterOf(m);
      const small = stored(m);
      const big = await publish(m, 'catalog', { version: 'p102-long-catalogue', pieces: [...MODULES, LONG_PIECE] }, 'p102 cr3 bound');
      expect(big.status, `${host}: PRECONDITION — the long catalogue (within the publication's 2 MiB) publishes (${big.status} ${JSON.stringify(big.body).slice(0, 200)})`).toBe(200);
      const copy = m.storage.objects.get(SERVING) ?? null;
      invalidatePublicationCache();
      const cold = await measured(meter, 20, () => door(m, 'p102-cr3-long'));
      expect.soft({ before: small.copy !== null, copy: copy === null ? 'none' : new TextEncoder().encode(copy).byteLength <= MiB && !copy.includes(LONG_PIECE.id) ? 'none of this publication, within 1 MiB' : `${new TextEncoder().encode(copy).byteLength} bytes holding the long catalogue` },
        `${host}: P102.CR3 — no copy is written past 1 MiB (the mount's own commit wrote one: ${small.copy !== null})`).toEqual({ before: true, copy: copy === null ? 'none' : 'none of this publication, within 1 MiB' });
      expect.soft({ status: cold.result.status, catalogue: (cold.result.body.versions as { catalog?: unknown } | undefined)?.catalog ?? null, waves: waves(cold.reads).length, second: waves(cold.reads)[1] ?? [] },
        `${host}: P102.CR3 — past the bound a machine holding nothing takes CR2's two waves (${JSON.stringify(waves(cold.reads))})`).toEqual({
        status: 200, catalogue: 2, waves: 2, second: ['content revision', 'learn revision', 'reflex revision', 'set', 'slots revision'] });
    }, 120_000);

    it(`host (${host}): P93's anchored product page reads at most 4 objects cold — the head, the serving copy, the anchor's shard and its part — and serves P80's carousel; warm it reads no shard and no part`, async () => {
      const m = await rangeTenant(host, 50);
      const { view } = await catalogue(m);
      expect(view.form, `${host}: PRECONDITION — the range tenant's catalogue is sharded (P93)`).toBe('sharded');
      const s = await shopperOn(m);
      invalidatePublicationCache();
      const cold = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p102-cr3-page-cold'));
      const warm = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p102-cr3-page-warm'));
      const shardOrPart = (classes: string[]) => classes.filter(c => /\/content\/(shard|part)\//.test(c));
      expect.soft({ status: cold.result.status, served: carousel(cold.result), reads: readClasses(cold.ops), count: readClasses(cold.ops).length <= 4, warm: shardOrPart(readClasses(warm.ops)) },
        `${host}: P102.CR3 — the anchored page cold: 4 objects (today 8: ${JSON.stringify(readClasses(cold.ops))})`).toEqual({
        status: 200, served: SERVED_FOR_BLACK, count: true, warm: [],
        reads: sorted(['head', SERVING, KEY.shard(view.shards[bucketOf(A)]?.digest ?? `no shard for ${A}`), KEY.part(view.products[A]?.digest ?? `no pointer for ${A}`)]) });
    }, 300_000);

    it(`host (${host}): the P84 class draw's pin before the session joins the one-round read on a machine holding nothing — the head and the copy together, or without the copy the head, then the set and its learn member together (R-P555)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR3 — the tenant documents publish');
      const meter = meterOf(m);
      const drawn = { arm: JSON.stringify({ class: 'personalized', tableVersion: 'p102-table' }) };
      /** The class draw's reads: every read issued before the decision's own head read (the second head). */
      const drawOf = (reads: readonly Read[]) => {
        const ordered = [...reads].sort((a, b) => a.start - b.start), heads = ordered.filter(r => r.cls === 'head');
        return heads.length < 2 ? ordered : ordered.filter(r => r.start < heads[1]!.start);
      };
      invalidatePublicationCache();
      const withCopy = await measured(meter, 20, () => door(m, 'p102-cr3-draw', drawn));
      await UnitR2.prototype.delete.call(m.storage, SERVING);
      invalidatePublicationCache();
      const without = await measured(meter, 20, () => door(m, 'p102-cr3-draw-bare', drawn));
      const cls = (r: Reply) => [r.status, (r.body.armRequest as { class?: unknown } | undefined)?.class ?? null];
      expect.soft({ answers: [cls(withCopy.result), cls(without.result)] }, `${host}: PRECONDITION — the door mints into the drawn class`).toEqual({ answers: [[200, 'personalized'], [200, 'personalized']] });
      expect.soft({ withCopy: waves(drawOf(withCopy.reads)), without: waves(drawOf(without.reads)) },
        `${host}: P102.CR3 — the class draw's own reads (today three waves: ${JSON.stringify(waves(drawOf(without.reads)))})`).toEqual({
        withCopy: [['head', 'serving copy']], without: [['head', 'serving copy'], ['learn revision', 'set']] });
    }, 120_000);

    it(`host (${host}): an existing tenant's serving copy is written by the five-minute run (no publication), and a machine holding nothing then reads the head and the copy in one wave`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR3 — the tenant documents publish');
      const meter = meterOf(m);
      const reference = answerOf(await door(m, 'p102-cr3-existing-reference'));
      await asCommittedToday(m);
      const run = await fiveMinuteRun(m);
      const copy = m.storage.objects.get(SERVING) ?? null;
      invalidatePublicationCache();
      const cold = await measured(meter, 20, () => door(m, 'p102-cr3-existing'));
      const identity = (JSON.parse(m.storage.objects.get(HEAD)!) as { committed: { digest: string } }).committed.digest;
      expect.soft({ run: run.rejected, copy: copy === null ? 'none written' : [new TextEncoder().encode(copy).byteLength <= MiB, copy.includes(identity)], cold: [readSet(cold.reads), waves(cold.reads).length, answerOf(cold.result)] },
        `${host}: P102.CR3 — the run writes the existing tenant's copy (holding the committed set), read beside the head (${JSON.stringify(readSet(cold.reads))})`).toEqual({
        run: 0, copy: [true, true], cold: [['head', 'serving copy'], 1, reference] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P102.CR4 — the per-trip report beside sources.timings; Server-Timing unchanged
// ===========================================================================

describe('unit:P102.CR4 (the documents stage\'s storage trips, reported in the body)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the door's answer and a held session's report the storage trips their documents stage waited on, in order and in whole milliseconds, each by what it read, in a member beside sources.timings that kit 02 names; Server-Timing and sources.timings carry today's names alone`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR4 — the tenant documents publish');
      const meter = meterOf(m);
      invalidatePublicationCache();
      const cold = (await measured(meter, G, () => door(m, 'p102-cr4-cold'))).result;
      const view = (await measured(meter, G, () => held(m, cold.capability, 'p102-cr4-held'))).result;
      const idle = (await later(61_000, () => measured(meter, G, () => door(m, 'p102-cr4-idle')))).result;
      await UnitR2.prototype.delete.call(m.storage, SERVING);
      invalidatePublicationCache();
      const bare = (await measured(meter, G, () => door(m, 'p102-cr4-bare'))).result;
      const shape = (r: Reply) => { const report = tripReport(r); return report.name === null ? tripsShown(r) : report.trips.map(t => tripShape(t, G - 2, documentsOf(r) + 1)); };
      const trip = (head: boolean, set: boolean, copy: boolean) => ({ head, set, copy, whole: true, within: true });
      expect.soft({ cold: shape(cold), held: shape(view), idle: shape(idle), bare: shape(bare) },
        `${host}: P102.CR4 — the trips, in order (cold ${tripsShown(cold)}; held ${tripsShown(view)}; idle ${tripsShown(idle)}; without the copy ${tripsShown(bare)})`).toEqual({
        cold: [trip(true, false, true)], held: [trip(true, false, false)], idle: [trip(true, false, false)], bare: [{ ...trip(true, false, true) }, trip(false, true, false)] });
      const report = tripReport(cold), kit = readTree('docs/kit/02-api-reference.md');
      expect.soft(report.name === null ? 'no member' : kit.includes(`sources.${report.name}`) ? 'named' : `sources.${report.name} is not named`,
        `${host}: P102.CR4 — kit 02 names the member`).toBe('named');
      expect.soft({ door: [headerNames(cold.header), sorted(Object.keys(timingsOf(cold)))], held: [headerNames(view.header), sorted(Object.keys(timingsOf(view)))] },
        `${host}: P102.CR4 — Server-Timing and sources.timings unchanged (door ${cold.header}; held ${view.header})`).toEqual({
        door: [DOOR_TIMINGS, sorted(DOOR_TIMINGS)], held: [STAGES, sorted(STAGES)] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P102.CR5 — LOCK: the answers identical; one pinned set per decision
// ===========================================================================

describe('unit:P102.CR5 (LOCK: the answers identical to today\'s path; one pinned set per decision)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with A, B and C on, one visitor's answers — on a machine holding nothing with and without the copy, an idle one and a warm one — equal the answer today's path gives (R5), and so do they after a publication committed between two decisions and one committed during a decision, each decision answering one set`, async () => {
      const m = await mount(host, DOCS_WITH_KEY);
      expectPublished(m, 'P102.CR5 — the tenant documents publish');
      const meter = meterOf(m);
      const visitor = await door(m, 'p102-cr5-door');
      expect([visitor.status, visitor.contextKey !== null], `${host}: PRECONDITION — the door answers with a context key (${show(visitor)})`).toEqual([200, true]);
      /** The visitor's page view on the path today's code takes: the head with no metadata, no copy, nothing held. */
      const todayPath = async (label: string) => {
        const saved = stored(m);
        await asCommittedToday(m); invalidatePublicationCache();
        const run = await measured(meter, 20, () => held(m, visitor.capability, label));
        await restore(m, saved); invalidatePublicationCache();
        return { answer: answerOf(run.result), waves: waves(run.reads).length };
      };
      const reference = await todayPath('p102-cr5-today');
      const saved = stored(m);
      invalidatePublicationCache();
      const cold = await measured(meter, 20, () => held(m, visitor.capability, 'p102-cr5-cold'));
      await UnitR2.prototype.delete.call(m.storage, SERVING); invalidatePublicationCache();
      const bare = await measured(meter, 20, () => held(m, visitor.capability, 'p102-cr5-bare'));
      await restore(m, saved);
      const warm = await measured(meter, 0, () => held(m, visitor.capability, 'p102-cr5-warm'));
      const idle = await later(61_000, () => measured(meter, 0, () => held(m, visitor.capability, 'p102-cr5-idle')));
      expect.soft({ today: reference.waves, cold: readSet(cold.reads), bare: waves(bare.reads).length, idle: readSet(idle.reads) },
        `${host}: PRECONDITION — A, B and C on: today's path three waves, cold the head and the copy, without the copy two waves, idle the head alone`).toEqual({
        today: 3, cold: ['head', 'serving copy'], bare: 2, idle: ['head'] });
      expect.soft({ cold: answerOf(cold.result), bare: answerOf(bare.result), warm: answerOf(warm.result), idle: answerOf(idle.result) },
        `${host}: P102.CR5 — the answers equal today's path's`).toEqual({ cold: reference.answer, bare: reference.answer, warm: reference.answer, idle: reference.answer });
      // A publication between two decisions: the very next one answers it, as today's path does.
      expect((await publish(m, 'slots', SLOTS_2, 'p102 cr5 between')).status, `${host}: PRECONDITION — the second slots document publishes`).toBe(200);
      const next = await later(122_000, () => held(m, visitor.capability, 'p102-cr5-next'));
      const nextToday = await todayPath('p102-cr5-next-today');
      // A publication committed during a decision, once the decision's first reads are issued: the decision answers the
      // set of the head it read, whole; the decision after it answers the new one.
      let during: Answer | null = null;
      meter.onRead = async () => { meter.onRead = undefined; meter.armed = false; during = await publish(m, 'slots', SLOTS_3, 'p102 cr5 during'); meter.armed = true; };
      const raced = await measured(meter, 0, () => held(m, visitor.capability, 'p102-cr5-during'));
      meter.onRead = undefined;
      const after = await held(m, visitor.capability, 'p102-cr5-after');
      const afterToday = await todayPath('p102-cr5-after-today');
      expect.soft({ next: answerOf(next), during: (during as Answer | null)?.status ?? null, raced: answerOf(raced.result), after: answerOf(after) },
        `${host}: P102.CR5 — across a publication between two decisions and one during a decision`).toEqual({
        next: nextToday.answer, during: 200, raced: nextToday.answer, after: afterToday.answer });
      expect.soft([(nextToday.answer.versions as { slots?: unknown } | null)?.slots, (afterToday.answer.versions as { slots?: unknown } | null)?.slots],
        `${host}: PRECONDITION — the publications moved the slots document`).toEqual([2, 3]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P102.CR6 — kit 02's serving paragraph states the read as built
// ===========================================================================

describe('unit:P102.CR6 (kit 02 :1848 states the read as built)', () => {
  it('host (session): kit 02\'s serving paragraph says the head is checked on every decision so a publication is honoured on the very next read, the set and documents are held by their identity for as long as memory allows, the head carries its members\' revisions as metadata, the serving copy and its 1 MiB bound, and names CR4\'s member; "expire within 30 seconds of the read\'s start" is gone', async () => {
    const m = await mount('session', DOCS);
    expectPublished(m, 'P102.CR6 — the tenant documents publish');
    const report = tripReport(await door(m, 'p102-cr6'));
    const paragraph = readTree('docs/kit/02-api-reference.md').split(/\n\s*\n/).map(p => p.split('\n').join(' ')).find(p => p.includes('bypasses the serving cache')) ?? '';
    expect(paragraph.includes('serving'), 'PRECONDITION — kit 02 has its serving paragraph (reading R7)').toBe(true);
    const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z*`])/);
    const says = (...patterns: RegExp[]) => sentences.some(s => patterns.every(p => p.test(s))) ? 'said' : 'not said';
    expect.soft({
      expiry: paragraph.includes('expire within 30 seconds of the read') ? 'still there' : 'gone',
      head: says(/\bhead\b/i, /every (decision|serving)/i, /very next read/i),
      held: says(/identity/i, /as long as memory allows/i),
      metadata: says(/\bhead\b/i, /metadata/i, /revision/i),
      copy: says(/serving copy/i, /1 MiB/),
      report: report.name === null ? 'no member to name' : paragraph.includes(`sources.${report.name}`) ? 'said' : `sources.${report.name} not named`,
    }, 'P102.CR6 — kit 02\'s serving paragraph, sentence by sentence').toEqual({ expiry: 'gone', head: 'said', held: 'said', metadata: 'said', copy: 'said', report: 'said' });
  }, 120_000);
});
