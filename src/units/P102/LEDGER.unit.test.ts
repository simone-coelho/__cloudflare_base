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
// THE READINGS (R1–R8 ratified by R-P570; R9 is R-P570 (b); R4, R9 and R10 as R-P580 rules them):
//   R1 The serving copy's fixed name per scope is the design's (§8): `config-publication/v2/<scope>/serving.json`. The
//      R10 lists of P93 and P86 name it, so it is one name for the batch.
//   R2 C's copy is read beside the head by a pin that NAMES its members (the decision's documents stage and the P84 class
//      draw) on a machine holding nothing of the tenant under that bucket; a serving read that names none (an event's
//      vocabulary read, src/config/publication.servingCache.test.ts's actions) reads as today (A and B only). So the
//      servingCache test's cold lists at :76 and :112 are unchanged, and :88 and :97 hold.
//   R3 CR4's member is `sources.trips` (R-P570): an array, one entry per storage trip in order, each entry an object
//      carrying its time as its one number (whole milliseconds) and naming what it read in its text members — `head`,
//      `set` (with its members), `serving` or `copy`; kit 02 names it. Each trip is bounded on its own duration (from the
//      injected read time less 2 ms to half a read above it) and the trips add up to no more than the documents stage, one
//      millisecond of rounding a trip (R-P580 F2).
//   R4 Each time bound is held by the median of three answers (the design's §5), at the midpoint between n and n + 1
//      waves: n × 100 ms + 50 ms — one wave ≤ 150 ms (the work order's 120), two waves ≤ 250 ms (its 220) — and the waves
//      are also counted from the read log (R-P580 F5). This discriminates waves; it does not loosen the target.
//      Superseded for CR1, CR2 and CR3 by P109.GD3 (E33, R-P707): the medians are printed as evidence and none is
//      asserted; the waves counted from the read log hold each clause.
//   R5 "Identical to today's" is compared against the same product reading an existing tenant's publication (no
//      metadata, no copy): the path today's code takes, three waves.
//   R6 "The backfill then changes nothing": neither the head (its bytes, metadata and version) nor the serving copy the
//      publication wrote is touched by a five-minute run that lost to it.
//   R7 Kit 02's serving paragraph is the one that says configuration administration bypasses the serving cache; the
//      clauses are read in it sentence by sentence.
//   R8 The backfill rides the tenant's existing five-minute job (src/index.ts, the hourly fold's per-tenant waitUntil):
//      src/index.api-boundary.test.ts W07.04 (:3496) pins the run's waitUntil count, which one new job per tenant breaks.
//   R9 The serving copy carries the revision objects' integrity guarantee for EVERY member it holds (R-P580 F1): a member
//      whose bytes differ from its reference under the same revision is never served from the copy — the answer comes from
//      the revision objects, in B's two waves (F4) — and with the member's revision object altered too the read is refused
//      as W20.03 (src/content/consent.test.ts) refuses it: "Configuration publication authority unavailable". The decision
//      reads content, slots, learn and reflex; the priors member is read on the learning path (LearnStats priorsFor: a
//      serving pin, then the optional member), so its leg reads it that way after the decision. Each change keeps the
//      member's version label, so only its bytes' digest tells it apart.
//   R10 The copy is altered whatever its layout (R-P580 F3): decoded, walked, the member found by its reference (kind,
//      scope, revision, digest) as an object or as the JSON text of one, its value changed, its revision and digest kept.
//
// R10 BY NAME (the brief S48/SPEC-BRIEF-P102.md; the work order's allowedPaths as amended by R-P570), before → after:
//   src/config/publication.servingCache.test.ts:128–141 — "keeps the administrative read and the cache expiry as they
//     were": past 30 s [head, set, reflex, content] → "past the serving cache's 30 seconds … the head alone": [head]
//     (A). :76 and :112 unchanged (R2).
//   src/units/P93/LEDGER.unit.test.ts:108–111 (pageReads) — head, set, four revisions, shard, part (8) → head, the
//     serving copy, shard, part (4) (C); :568 (the one-level page) — head, set, four revisions, part (7) → head, the
//     serving copy, part (3); :289 and :302 (the CS2 title and message) — "the head, the set, the content, slots,
//     learn and reflex revisions" and "8 reads" → "the head, the serving copy" and "4 reads".
//   src/units/P86/LEDGER.unit.test.ts:1036–1043 (P86 CS2's exact cold list) — head, set, four revisions, shard, part →
//     head, the serving copy, shard, part.
//   src/index.api-boundary.test.ts:3174–3176 (W03.02) — four puts in order → the same four in order, and the serving
//     copy's one put (its place in the order not pinned).
//   src/routes/content.test.ts:1491 (W14.04) — 22 objects → 24 (one serving copy per tenant).
//   src/content/consent.test.ts W20.04 (:381–383) — the slots revision object lost → it and the serving copy lost; W20.03
//     (the store double, :432–441) — the slots revision lost, altered or out → the copy answers alike (its slots bytes
//     altered where it holds them as stored, else lost; out with it); W28.01 (:578–585) — one read of the learn
//     revision object on a fresh serve → one read of it or of the serving copy. Every refusal and other expectation
//     unchanged.
//   RE-POINT ROUND (R-P570 (c), (d); the brief S48/SPEC-BRIEF-P102-repoint.md, onto rem/integration 8d6b0dd0 with P97 and
//   P98): src/units/P97/LEDGER.unit.test.ts `contentOf` also deletes `sources.trips` (reading R4's read pin unchanged);
//   onto P98's pack reads, a shard or part inside a pack is read by its range in that pack — src/units/P93/_catalog.ts
//   gains `placedReadClasses` and `placedKey` (test helpers); P93's `pageReads` and its CS1 and CS2 call sites, P93.CS4's
//   one-level page (its part an object of its own, read as its own), P86.CS2's exact cold list (its meter `counted` notes
//   a ranged read's range) and this file's CR3 page leg name the shard and the part `<key> by range <at>+<bytes> in <pack>`;
//   every other expectation unchanged; P93's "8 reads" titles and header say 4.
//   R-P676 (the delivery review's finding 1): CR2 gains a leg pinning the five-minute run's guarded copy write (over the
//   stale copy's etag it saw, or only where none is), a publication committed between its look and its write.
//   COLLISION (told, not granted): P93's kit leg (`unit:P93` logic, kits 03 and 02) still requires kit 03 to say the
//   product page's "8 reads"; P102's four reads make that sentence stale.
//
// DEFERRED: LV1 (lane L21: the stamps' cold first answer within about 300 ms of server time with P97; the per-trip split
// from CR4 on both pair hosts and both stamps; the stamps' pilot tenant backfilled without a publication).
// RESIDUALS (told, not pinned): the byte bound of what A holds (the work order names no figure) and the writers'
// invalidation of it (no answer or read shows it in one isolate: a new publication is a new identity); the synthetic
// monitor's scoped bucket (src/ops/synthetic.ts:211–223) needs a telemetry policy this harness has not, so its reads are
// left to the gate's src/index.api-boundary.test.ts, which runs it natively. The copy across P98's pack moves and sweep is
// pinned by CR3's survival leg (the brief's item 4).
//
// HARNESS: src/units/_parity.ts and src/units/P93/_catalog.ts (the range tenant, its index and meter); the real Worker's
// scheduled handler (src/index.ts) for the five-minute run, with the module doubles every suite loading the Worker
// registers (src/units/P96/LEDGER.unit.test.ts). NO NEW EXPORT IS IMPORTED. Imports from src/units/: ../_parity,
// ../P93/_catalog, ../P98/_load (P98's loads, retention and upload times, for CR3's survival leg).

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { invalidatePublicationCache, pinPublication, readOptionalPinnedPublication } from '@/config/publication';
import { PRIORS_KIND } from '@/learn/priors';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import type { Env } from '@/types/env';

import {
  asOperator, BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, loadDocument, MODULES, mount, pageInstanceOf, readTree,
  shopperOn, TENANT, UnitR2, type Answer, type Mounted,
} from '../_parity';
import {
  A, ANCHOR_IMAGES, BLACK, bucketOf, carousel, catalogue, indexOf, KEY, metered, placedKey, placedReadClasses, rangeProduct, rangeRecords, rangeTenant, readClasses,
  SERVED_FOR_BLACK, snapshotOf,
} from '../P93/_catalog';
import { importOf, loadedTenant, minutesAgo, packTable, resolve, shortRetention, uploadedAt } from '../P98/_load';

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

/** A member of the committed set: its reference and its revision object's key. */
interface MemberRef { key: string; kind: string; scope: string; revision: number; digest: string; object: string }
function refsOf(m: Mounted): MemberRef[] {
  const head = JSON.parse(m.storage.objects.get(HEAD)!) as { committed: { revision: number } };
  const set = JSON.parse(m.storage.objects.get(setKey(head.committed.revision))!) as { refs: Record<string, { kind: string; scope: string; revision: number; digest: string }> };
  return Object.entries(set.refs).map(([key, r]) => ({ key, kind: r.kind, scope: r.scope, revision: r.revision, digest: r.digest,
    object: `config-publication/v1/${r.scope}/${r.kind}/rev/${r.revision}.json` })).sort((a, b) => a.key.localeCompare(b.key));
}
/**
 * F3 (R-P580): the serving copy altered whatever its layout — decoded, walked, the member found by its reference (an
 * object, or the JSON text of one, carrying the reference's kind, scope, revision and digest) and its value changed by
 * `change`, its revision and digest kept. Null where the copy does not decode or holds no such member.
 */
function alteredCopy(copy: string | null, ref: MemberRef, change: (value: unknown) => unknown): string | null {
  if (copy === null) return null;
  let found = false;
  const isMember = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, 'value')
    && (v as Record<string, unknown>).kind === ref.kind && (v as Record<string, unknown>).scope === ref.scope
    && (v as Record<string, unknown>).revision === ref.revision && (v as Record<string, unknown>).digest === ref.digest;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      let parsed: unknown; try { parsed = JSON.parse(node); } catch { return node; }
      if (isMember(parsed)) { found = true; return JSON.stringify({ ...parsed, value: change(parsed.value) }); }
      return node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      if (isMember(node)) { found = true; return { ...node, value: change(node.value) }; }
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  let root: unknown; try { root = JSON.parse(copy); } catch { return null; }
  const out = walk(root);
  return found ? JSON.stringify(out) : null;
}
/** W20.03's altered revision object: its value changed, its revision and digest kept. */
const alteredObject = (text: string, change: (value: unknown) => unknown) => { const v = JSON.parse(text) as Record<string, unknown>; return JSON.stringify({ ...v, value: change(v.value) }); };
type Doc = Record<string, unknown>;
/** F1 (R-P580): for each member kind the copy carries, a change of its bytes under the same revision whose effect a reader serving it would show — its version label kept, so only the bytes' digest tells. */
const ALTER: Record<string, (value: unknown) => unknown> = {
  content: v => ({ ...(v as Doc), pieces: [...((v as Doc).pieces as unknown[])].reverse() }),
  slots: v => ({ ...(v as Doc), pages: { ...((v as Doc).pages as Doc), pdp: (((v as Doc).pages as Doc).pdp as Doc[]).map(s => ({ ...s, take: 2 })) } }),
  learn: v => ({ ...(v as Doc), holdout: { ...((v as Doc).holdout as Doc), salt: 'p102-altered' } }),
  reflex: v => Object.fromEntries(Object.entries(v as Doc).filter(([k]) => k !== 'journey')),
  prior: v => ({ ...(v as Doc), version: 'p102-altered-priors' }),
};
/** What the decision serves from its documents: the answer, and the documents' labels and journey source it names. */
const servedOf = (r: Reply) => { const s = (r.body.sources ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return { answer: answerOf(r), labels: [s.catalog?.version, s.slots?.version, s.learn?.version, s.config?.label], journey: s.journey ?? null }; };
/** The learning path's serving read of the priors member (src/durable-objects/LearnStats.ts priorsFor: one serving pin, then the optional member). */
async function priorsRead(m: Mounted): Promise<unknown> {
  try { return (await readOptionalPinnedPublication(m.env, PRIORS_KIND, TENANT, await pinPublication(m.env, TENANT, true)))?.value ?? null; }
  catch (error) { return `refused: ${(error as Error).message}`; }
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
/** `sources.trips` (R3, R-P570), the documents stage's trips, or what `sources` holds instead. */
function tripReport(r: Reply): { name: string; trips: Trip[] } | { name: null; members: string[] } {
  const sources = (r.body.sources ?? {}) as Record<string, unknown>, value = sources.trips;
  return Array.isArray(value) && value.length > 0 && value.every(e => tripOf(e) !== null) ? { name: 'trips', trips: value.map(e => tripOf(e)!) }
    : { name: null, members: sorted(Object.keys(sources)) };
}
const tripsShown = (r: Reply) => { const report = tripReport(r); return report.name === null ? `no sources.trips reporting the trips (sources: ${report.members.join(', ')})` : JSON.stringify(report.trips); };
/** A trip's report reduced to what it read (reading R3's words) and its time within [lo, hi]. */
const tripShape = (trip: Trip, lo: number, hi: number) => ({ head: /head/.test(trip.read), set: /\bset\b/.test(trip.read), copy: /serving|copy/.test(trip.read),
  whole: Number.isInteger(trip.ms), within: trip.ms >= lo && trip.ms <= hi });
/** F5 (R-P580): a time bound at the midpoint between n and n + 1 waves: n × the injected read time plus half of it. */
const waveBound = (n: number) => n * G + G / 2;
/**
 * R10 (P109.GD3, E33, R-P707; by name): CR1, CR2 and CR3 print their documents stage's wall-clock times as evidence and
 * assert none. The reads and waves each leg already checks pin the clause (a serial read of the head and the copy turns
 * CR3's waves [2,2,2], unit:P109.GD3); the time on a shared machine carries its load. Every other expectation unchanged.
 */
const evidence = (what: string, times: number[], waveCounts: number[]) =>
  console.log(`${what} — evidence only, asserted by the waves (R-P707): documents stage ${JSON.stringify(times)} ms, median ${median(times)} ms (the work order's bound ${waveBound(waveCounts[0] ?? 1)} ms), waves ${JSON.stringify(waveCounts)}`);

// ===========================================================================
// unit:P102.CR1 — fix A: a publication's set and documents held by its identity for as long as memory allows
// ===========================================================================

describe('unit:P102.CR1 (fix A: held by identity; the head read on every decision)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an idle machine — the same isolate 61 s and 400 days after it last read the tenant — answers a new visitor's first request reading the head alone, in one wave at 100 ms a read (its documents stage's time printed as evidence, R-P707), the answer the warm machine's`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR1 — the tenant documents publish');
      const meter = meterOf(m);
      const warm = await door(m, 'p102-cr1-warm');
      expect(warm.status, `${host}: PRECONDITION — the door answers (${show(warm)})`).toBe(200);
      const idle: Array<{ reads: string[]; waves: number; documents: number; answer: unknown }> = [];
      for (let rep = 1; rep <= 3; rep++) {
        const run = await later(61_000 * rep, () => measured(meter, G, () => door(m, `p102-cr1-idle-${rep}`)));
        idle.push({ reads: readSet(run.reads), waves: waves(run.reads).length, documents: documentsOf(run.result), answer: answerOf(run.result) });
      }
      const ancient = await later(400 * 86_400_000, () => measured(meter, 0, () => door(m, 'p102-cr1-ancient')));
      expect.soft({ reads: idle.map(i => i.reads), waves: idle.map(i => i.waves), answers: idle.map(i => i.answer), ancient: [readSet(ancient.reads), answerOf(ancient.result)] },
        `${host}: P102.CR1 — an idle machine reads the head alone, at 61 s and at 400 days (observed ${JSON.stringify(idle.map(i => i.reads))}; at 400 days ${JSON.stringify(readSet(ancient.reads))}; today the set and the four documents again past 30 s)`).toEqual({
        reads: [['head'], ['head'], ['head']], waves: [1, 1, 1], answers: idle.map(() => answerOf(warm)), ancient: [['head'], answerOf(warm)] });
      evidence(`${host}: P102.CR1 — an idle machine at 100 ms a read, one wave`, idle.map(i => i.documents), idle.map(i => i.waves));
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
    it(`host (${host}): the commit writes each member's revision as the head object's storage metadata, the head's JSON, digest and field set as today; a machine holding nothing without the serving copy reads the head, then the set and the content, slots, learn and reflex documents together — two waves at 100 ms a read (its documents stage's time printed as evidence, R-P707)`, async () => {
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
        `${host}: P102.CR2 — two waves, the set and the four members together in the second (observed ${JSON.stringify(cold[0]?.waves)}; today three)`).toEqual({
        waves: [2, 2, 2], second: cold.map(() => ['content revision', 'learn revision', 'reflex revision', 'set', 'slots revision']), answers: cold.map(() => answerOf(warm)) });
      evidence(`${host}: P102.CR2 — a machine holding nothing, without the copy, at 100 ms a read, two waves`, cold.map(c => c.documents), cold.map(c => c.waves.length));
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
        `${host}: P102.CR2 — PRECONDITION: the second commit's head carries metadata of its own (observed ${JSON.stringify(second.meta)}; today none)`).toEqual({ hinted: true, slots: 2 });
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
        `${host}: PRECONDITION — the five-minute run rewrote the head while the publication was in flight (head version ${start.version} → ${rewritten?.version ?? 'n/a'}; today no backfill)`).toEqual({ rewrote: true });
      expect.soft({ met: met.status, slots: (next.body.versions as { slots?: unknown } | undefined)?.slots ?? null },
        `${host}: P102.CR2 — the publication that met the rewrite is committed, not refused (${met.status} ${JSON.stringify(met.body).slice(0, 200)})`).toEqual({ met: 200, slots: 2 });
    }, 120_000);

    it(`host (${host}): the five-minute run writes the serving copy only over the stale copy it saw, or only where none is (R-P676; R6 for the copy) — with the head already naming its members, a stale copy (a) and an absent one (b), and a publication committed between the run's look at the copy and its write: the publication's own copy remains and the run changes nothing`, async () => {
      const seen: Record<string, unknown> = {}, wanted: Record<string, unknown> = {};
      for (const [label, staleCopy] of [['stale', true], ['absent', false]] as const) {
        const m = await mount(host, DOCS);
        expectPublished(m, `P102.CR2 — the tenant documents publish (${label})`);
        const meter = meterOf(m);
        const first = stored(m), firstCopyMeta = { ...(m.storage.metadata.get(SERVING) ?? {}) };
        expect((await publish(m, 'slots', SLOTS_2, `p102 cr2 copy ${label}`)).status, `${host}: PRECONDITION — the second slots document publishes (${label})`).toBe(200);
        if (staleCopy && first.copy !== null) await UnitR2.prototype.put.call(m.storage, SERVING, first.copy, { customMetadata: firstCopyMeta } as R2PutOptions);
        if (!staleCopy) await UnitR2.prototype.delete.call(m.storage, SERVING);
        const before = stored(m);
        let racing = false, raced: Answer | null = null, after: Stored | null = null, afterCopyVersion = 0;
        meter.onPut = async key => {
          if (racing || raced || key !== SERVING) return;
          racing = true;
          try { raced = await publish(m, 'slots', SLOTS_3, `p102 cr2 copy race ${label}`); after = stored(m); afterCopyVersion = m.storage.versions.get(SERVING) ?? 0; } finally { racing = false; }
        };
        const run = await fiveMinuteRun(m);
        meter.onPut = undefined;
        const end = stored(m), lost = raced as Answer | null, committed = after as Stored | null;
        seen[label] = {
          precondition: { hinted: Object.keys(before.meta).length > 0, copy: staleCopy ? before.copy !== null && before.copy === first.copy : before.copy === null,
            raced: lost?.status ?? 'the run wrote no copy to race', published: committed?.copy !== null && committed?.copy !== undefined && committed.copy !== before.copy },
          end: committed ? { run: run.rejected, copy: end.copy === committed.copy, copyVersion: (m.storage.versions.get(SERVING) ?? 0) === afterCopyVersion,
            head: end.head === committed.head, meta: JSON.stringify(end.meta) === JSON.stringify(committed.meta), version: end.version === committed.version } : 'no publication raced the run',
        };
        wanted[label] = { precondition: { hinted: true, copy: true, raced: 200, published: true },
          end: { run: 0, copy: true, copyVersion: true, head: true, meta: true, version: true } };
      }
      expect.soft(seen, `${host}: P102.CR2 — the run's copy write lost to the publication committed meanwhile (stale and absent copy; today the run writes no copy)`).toEqual(wanted);
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
    it(`host (${host}): a machine holding nothing reads the head and the serving copy together — one wave, those two objects alone, at 100 ms a read (its documents stage's time printed as evidence, R-P707), the answer the warm machine's`, async () => {
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
        `${host}: P102.CR3 — the head and the serving copy, one wave (observed ${JSON.stringify(cold[0]?.reads)} in ${cold[0]?.waves} waves; today six objects in three)`).toEqual({
        reads: cold.map(() => ['head', 'serving copy']), waves: [1, 1, 1], answers: cold.map(() => answerOf(warm)) });
      evidence(`${host}: P102.CR3 — a machine holding nothing at 100 ms a read, one wave`, cold.map(c => c.documents), cold.map(c => c.waves));
    }, 120_000);

    it(`host (${host}): the copy is used only where it is the head's committed identity and every member matches its ref — a stale copy (the previous publication's), a copy whose slots member was altered, a malformed copy and a missing one each give the answer the true copy gives, reading as CR2 in two waves (R-P580 F4)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P102.CR3 — the tenant documents publish');
      const meter = meterOf(m);
      const first = stored(m);
      expect((await publish(m, 'slots', SLOTS_2, 'p102 cr3 copy')).status, `${host}: PRECONDITION — the second slots document publishes`).toBe(200);
      const second = stored(m), slots = refsOf(m).find(r => r.kind === 'slots')!;
      const altered = alteredCopy(second.copy, slots, ALTER.slots!);
      const ask = async (copy: string | null, label: string) => {
        if (copy === null) await UnitR2.prototype.delete.call(m.storage, SERVING); else await UnitR2.prototype.put.call(m.storage, SERVING, copy);
        invalidatePublicationCache();
        const run = await measured(meter, 20, () => door(m, `p102-cr3-${label}`));
        return { answer: answerOf(run.result), waves: waves(run.reads).length };
      };
      const truth = await ask(second.copy, 'true');
      const stale = await ask(first.copy, 'stale');
      const alteredRun = await ask(altered, 'altered');
      const malformed = await ask('{"schema":"not a serving copy"}', 'malformed');
      const missing = await ask(null, 'missing');
      expect.soft({ copies: [first.copy !== null, second.copy !== null && second.copy !== first.copy, altered !== null], slots: (truth.answer.versions as { slots?: unknown } | null)?.slots ?? null },
        `${host}: P102.CR3 — PRECONDITION: each commit wrote its serving copy, holding the slots member by its reference (today none)`).toEqual({ copies: [true, true, true], slots: 2 });
      expect.soft({ answers: { stale: stale.answer, altered: alteredRun.answer, malformed: malformed.answer, missing: missing.answer }, waves: [truth.waves, stale.waves, alteredRun.waves, malformed.waves, missing.waves] },
        `${host}: P102.CR3 — a stale, altered, malformed or missing copy changes no answer and costs one parallel read: B's two waves`).toEqual({
        answers: { stale: truth.answer, altered: truth.answer, malformed: truth.answer, missing: truth.answer }, waves: [1, 2, 2, 2, 2] });
    }, 120_000);

    it(`host (${host}): the serving copy carries the revision objects' integrity guarantee for every member it holds (R-P570 (b), R-P580 F1) — a member's bytes altered in the copy alone, under the same revision, are never served: the answer is the revision objects', read from them in B's two waves; with the member's revision object altered too the read is refused, as W20.03 refuses it`, async () => {
      const seen: Record<string, unknown> = {}, wanted: Record<string, unknown> = {};
      for (const kind of Object.keys(ALTER)) {
        const m = await mount(host, DOCS);
        expectPublished(m, `P102.CR3 — the tenant documents publish (${kind})`);
        const meter = meterOf(m), ref = refsOf(m).find(r => r.kind === kind), copy = stored(m).copy;
        const altered = ref ? alteredCopy(copy, ref, ALTER[kind]!) : null, object = ref ? m.storage.objects.get(ref.object) ?? null : null;
        /** The decision's documents stage reads content, slots, learn and reflex; the priors member is read by the learning path (priorsRead). */
        const decided = kind !== 'prior';
        invalidatePublicationCache();
        const truth = decided ? servedOf(await door(m, `p102-cr3-integrity-${kind}-true`)) : await priorsRead(m);
        if (altered !== null) await UnitR2.prototype.put.call(m.storage, SERVING, altered);
        invalidatePublicationCache();
        const alone = await measured(meter, 20, async () => decided ? servedOf(await door(m, `p102-cr3-integrity-${kind}-copy`))
          : (await door(m, `p102-cr3-integrity-${kind}-copy`), await priorsRead(m)));
        const readFrom = alone.reads.filter(r => r.cls === `${kind} revision`).length > 0, two = decided ? waves(alone.reads).length : 'n/a';
        if (object !== null) await UnitR2.prototype.put.call(m.storage, ref!.object, alteredObject(object, ALTER[kind]!));
        invalidatePublicationCache();
        const both = decided ? await door(m, `p102-cr3-integrity-${kind}-both`) : null;
        const refused = decided ? [both!.status >= 500, Array.isArray(both!.body.decisions), JSON.stringify(both!.body).includes('Configuration publication authority unavailable')]
          : (await door(m, `p102-cr3-integrity-${kind}-both`), [String(await priorsRead(m)).includes('Configuration publication authority unavailable')]);
        seen[kind] = { held: altered !== null, alone: [alone.result, readFrom, two], refused };
        wanted[kind] = { held: true, alone: [truth, true, decided ? 2 : 'n/a'], refused: decided ? [true, false, true] : [true] };
      }
      expect.soft(seen, `${host}: P102.CR3 — a member altered in the copy alone is not served; altered in its revision object too, refused (held: the copy holds the member by its reference; today no copy)`).toEqual(wanted);
    }, 300_000);

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

    it(`host (${host}): P93's anchored product page reads at most 4 objects cold — the head, the serving copy, the anchor's shard and its part, each of these two by its range in its pack (P98) — and serves P80's carousel; warm it reads no shard and no part`, async () => {
      const m = await rangeTenant(host, 50);
      const { view } = await catalogue(m);
      expect(view.form, `${host}: PRECONDITION — the range tenant's catalogue is sharded (P93)`).toBe('sharded');
      const s = await shopperOn(m);
      invalidatePublicationCache();
      const cold = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p102-cr3-page-cold'));
      const warm = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p102-cr3-page-warm'));
      const shardOrPart = (classes: string[]) => classes.filter(c => /\/content\/(shard|part)\//.test(c));
      // R-P570 (d), onto P98's pack reads: a shard or part inside a pack is read by its range in that pack (placedKey).
      expect.soft({ status: cold.result.status, served: carousel(cold.result), reads: placedReadClasses(cold), count: readClasses(cold.ops).length <= 4, warm: shardOrPart(readClasses(warm.ops)) },
        `${host}: P102.CR3 — the anchored page cold: 4 objects (observed ${JSON.stringify(placedReadClasses(cold))}; today 8)`).toEqual({
        status: 200, served: SERVED_FOR_BLACK, count: true, warm: [],
        reads: sorted(['head', SERVING, placedKey(KEY.shard(view.shards[bucketOf(A)]?.digest ?? `no shard for ${A}`), view.places?.shards[bucketOf(A)]),
          placedKey(KEY.part(view.products[A]?.digest ?? `no pointer for ${A}`), view.products[A]?.place)]) });
    }, 300_000);

    it(`host (${host}): the serving copy survives P98's pack moves and sweep — after a load re-homes a pack under a quarter live and the anchor's part moves at each retitle, and the publications' purge sweeps the pack the re-homing left, the copy is the committed set's (its content member the revision in force, naming only stored packs) and a machine holding nothing reads the anchored page from the head, the copy, and the shard and the part by their ranges in their packs`, async () => {
      const m = await loadedTenant(host, 20);
      // P98.LD6's quarter-live construction: 100 products of large records, 90 of them retitled, then one more load.
      const heavy = (from: number, suffix = '') => rangeRecords(from, 100, suffix).map(r => ({ ...r, excerpt: `Heavy record ${r.id} `.padEnd(2000, 'h') }));
      const kept = Array.from({ length: 10 }, (_, i) => rangeProduct(3090 + i));
      expect((await importOf(m, heavy(3000))).status, `${host}: PRECONDITION — the heavy load`).toBe(200);
      const quarter = indexOf(m, (await loadDocument(m, 'catalog')).document).products[kept[0]!]?.place?.pack ?? 'no pack';
      expect((await importOf(m, heavy(3000, ' (p102 most)').slice(0, 90))).status, `${host}: PRECONDITION — 90 of the 100 retitled`).toBe(200);
      expect((await importOf(m, rangeRecords(3500, 1))).status, `${host}: PRECONDITION — one more load`).toBe(200);
      const anchorBefore = indexOf(m, (await loadDocument(m, 'catalog')).document).products[A]?.place?.pack ?? 'no pack';
      // The publications whose purge sweeps (the retention setting at its smallest, every object uploaded an hour ago): each
      // retitles the anchor's first image, so the anchor's part moves to that load's pack each time.
      shortRetention(m);
      const restoreTimes = uploadedAt(m, minutesAgo(60));
      try {
        for (let i = 1; i <= 4; i++) {
          const a = await importOf(m, [{ ...ANCHOR_IMAGES[0]!, title: `${ANCHOR_IMAGES[0]!.title}, p102 retouch ${i}` }]);
          expect(a.status, `${host}: PRECONDITION — publication ${i} is accepted`).toBe(200);
        }
      } finally { restoreTimes(); }
      await m.drain();
      const doc = (await loadDocument(m, 'catalog')).document, view = indexOf(m, doc);
      expect({ moved: kept.every(p => !!view.products[p]?.place && view.products[p]!.place!.pack !== quarter), anchorMoved: view.products[A]?.place?.pack !== anchorBefore,
        quarterStored: m.storage.objects.has(KEY.pack(quarter)), bad: resolve(m, doc).bad },
      `${host}: PRECONDITION — P98's moves and sweep: the kept parts re-homed, the anchor's part moved, the pack under a quarter live collected, every object the revision in force names resolved`).toEqual({
        moved: true, anchorMoved: true, quarterStored: false, bad: [] });
      // The copy after the sweep: readable, the committed set's, its content member the revision in force's value, naming only stored packs.
      const copy = m.storage.objects.get(SERVING) ?? null, content = refsOf(m).find(r => r.kind === 'content')!;
      const identity = (JSON.parse(m.storage.objects.get(HEAD)!) as { committed: { digest: string } }).committed.digest;
      let held: unknown = 'the copy holds no content member by its reference';
      alteredCopy(copy, content, value => { held = value; return value; });
      const inForce = (JSON.parse(m.storage.objects.get(content.object)!) as { value: Record<string, unknown> }).value;
      const named = held && typeof held === 'object' ? packTable(held as Record<string, unknown>) : [];
      expect.soft({ copy: copy === null ? 'no serving copy after the sweep' : copy.includes(identity) ? 'the committed set\'s' : 'another set\'s',
        content: JSON.stringify(held) === JSON.stringify(inForce) ? 'the revision in force' : `not the revision in force (${JSON.stringify(held).slice(0, 120)})`,
        packs: named.length > 0 && named.every(d => m.storage.objects.has(KEY.pack(d))) ? 'every pack it names stored' : `names ${named.filter(d => !m.storage.objects.has(KEY.pack(d))).length} of ${named.length} packs gone` },
      `${host}: P102.CR3 — the serving copy after P98's pack moves and sweep (today no copy)`).toEqual({ copy: 'the committed set\'s', content: 'the revision in force', packs: 'every pack it names stored' });
      const s = await shopperOn(m);
      invalidatePublicationCache();
      const cold = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p102-cr3-swept-cold'));
      expect.soft({ status: cold.result.status, served: carousel(cold.result), reads: placedReadClasses(cold) },
        `${host}: P102.CR3 — after the sweep a machine holding nothing reads the head, the copy, and the shard and the part by their ranges (observed ${JSON.stringify(placedReadClasses(cold))})`).toEqual({
        status: 200, served: SERVED_FOR_BLACK, reads: sorted(['head', SERVING, placedKey(KEY.shard(view.shards[bucketOf(A)]?.digest ?? `no shard for ${A}`), view.places?.shards[bucketOf(A)]),
          placedKey(KEY.part(view.products[A]?.digest ?? `no pointer for ${A}`), view.products[A]?.place)]) });
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
        `${host}: P102.CR3 — the class draw's own reads (observed without the copy ${JSON.stringify(waves(drawOf(without.reads)))}; today three waves)`).toEqual({
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
      // F2 (R-P580): each trip bounded on its own duration, near the injected read time (within half a read of it), and the
      // trips adding up to no more than the documents stage (one whole millisecond of rounding a trip).
      const shape = (r: Reply) => { const report = tripReport(r); return report.name === null ? tripsShown(r)
        : { trips: report.trips.map(t => tripShape(t, G - 2, waveBound(1))), sum: report.trips.reduce((n, t) => n + t.ms, 0) <= documentsOf(r) + report.trips.length }; };
      const trip = (head: boolean, set: boolean, copy: boolean) => ({ head, set, copy, whole: true, within: true });
      expect.soft({ cold: shape(cold), held: shape(view), idle: shape(idle), bare: shape(bare) },
        `${host}: P102.CR4 — the trips, in order (cold ${tripsShown(cold)}; held ${tripsShown(view)}; idle ${tripsShown(idle)}; without the copy ${tripsShown(bare)})`).toEqual({
        cold: { trips: [trip(true, false, true)], sum: true }, held: { trips: [trip(true, false, false)], sum: true }, idle: { trips: [trip(true, false, false)], sum: true },
        bare: { trips: [trip(true, false, true), trip(false, true, false)], sum: true } });
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
