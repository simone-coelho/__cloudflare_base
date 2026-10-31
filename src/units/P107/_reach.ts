// src/units/P107/_reach.ts
// P107's harness (programme `tapestry-parity-pack-proof`, amendment 13, E35): the publications P107's legs make and what
// each one's purge read, counted from the bucket's own calls. It reuses P98's meter (`under`: every call classed, with its
// range, its bytes and whether it came after the publication's commit) and P99's census (`lost`, `unnamed`) read-only, and
// holds no expected value: it mounts, publishes, counts and reads back. It never names the reach ledger's key or form
// (the design leaves the name to the builder): every count here is of the objects today's code already stores.
// Synthetic, customer-neutral names; tenant ids only.

import { expect } from 'vitest';

import { expectPublished, loadDocument, mount, TENANT, type Answer, type Host, type Mounted } from '../_parity';
import { declareProductSlots, DOCS_WITH_CART, importJson, preconditions, productRead, rangeProduct, rangeRecords, show } from '../P93/_catalog';
import { under, type Call, type Meter, type Rule } from '../P98/_load';
import { cold, contentBodies, lost } from '../P99/_purge';

export const CONTENT_DIR = `config-publication/v1/${TENANT}/content/`;
const REV = /\/content\/rev\/([0-9]+)\.json$/;
/** The revision a content revision key names (null for any other key). */
export const revisionOfKey = (key: string): number | null => { const hit = REV.exec(key); return hit ? Number(hit[1]) : null; };
/**
 * src/config/publication.ts `revisionTime`: the purge reads a revision's time from the first 4,096 bytes of its body (a
 * ranged read at offset 0). Reading P1: such a read is a header read, not a body read; every other read of a content
 * revision (whole, or a longer range) is a body read.
 */
export const HEADER_BYTES = 4096;
export const isBodyRead = (c: Call) => !c.failed && c.op === 'get' && c.cls === 'content revision' && (c.range === null || c.range.offset !== 0 || c.range.length < 0 || c.range.length > HEADER_BYTES);
/** Reading P2: a shard read is any read of a pack (whole or a range of it), a product shard, an id shard, a part or an id index. */
export const SHARD_CLASSES = ['pack', 'shard', 'idshard', 'part', 'ids'];
export const isShardRead = (c: Call) => !c.failed && c.op === 'get' && SHARD_CLASSES.includes(c.cls);

/** The key classes today's code stores under the catalogue's directory (P86, P93, P98: part, shard, idshard, ids, pack, rev). */
const TODAYS_CONTENT = /^config-publication\/v1\/[^/]+\/content\/(?:(?:part|shard|idshard|ids)\/[0-9a-f]{64}\.json|pack\/[0-9a-f]{64}\.pack|rev\/[0-9]+\.json)$/;
/** Whether a key lies under the catalogue's directory (`…/content/`) in a class today's code does not write there. */
export const outsideTodaysClasses = (key: string) => key.startsWith(CONTENT_DIR) && !TODAYS_CONTENT.test(key);
/** A listing's prefix under the catalogue's directory that today's code never lists (it lists part/ shard/ idshard/ ids/ pack/ rev/ and nothing above them). */
const TODAYS_LISTED = /^config-publication\/v1\/[^/]+\/content\/(?:part|shard|idshard|ids|pack|rev)\//;
export const unusualCall = (c: Call) => c.op === 'list' ? c.key.startsWith(CONTENT_DIR) && !TODAYS_LISTED.test(c.key) : outsideTodaysClasses(c.key);

// ── The retention setting ────────────────────────────────────────────────────────────────────────────────────────────
/** The configuration retention setting removed from the tenant's registry (a tenant that never set it, or an earlier release's writes). */
export function clearConfigurationRetention(m: Mounted): void {
  const registry = JSON.parse(String(m.env.RETENTION)) as { tenants: Record<string, Record<string, unknown>> };
  delete registry.tenants[TENANT]!.configuration;
  m.env.RETENTION = JSON.stringify(registry);
}
export const DAY_MS = 86_400_000;

// ── One publication, metered ─────────────────────────────────────────────────────────────────────────────────────────
export interface Publication {
  label: string; answer: Answer; calls: Call[];
  /** The content revisions stored before and after it, and the content revision in force after it. */
  before: number[]; after: number[]; committed: number;
}
const after = (p: { calls: readonly Call[] }) => p.calls.filter(c => c.phase === 'committed');
/** The content revisions read whole after the publication's commit, in call order (one entry per read). */
export const bodyReads = (p: { calls: readonly Call[] }) => after(p).filter(isBodyRead).map(c => revisionOfKey(c.key)!);
export const shardReads = (p: { calls: readonly Call[] }) => after(p).filter(isShardRead).length;
export const callsAfterCommit = (p: { calls: readonly Call[] }) => after(p).length;
export const bytesReadAfterCommit = (p: { calls: readonly Call[] }) => after(p).filter(c => c.op === 'get').reduce((n, c) => n + c.bytes, 0);
/** The content revisions the publication removed (stored before it, not after it). */
export const removed = (p: Publication) => p.before.filter(n => !p.after.includes(n));

/** A catalogue load through the operator's import route on a cold isolate, metered; `headers` as given (a re-send) or fresh. */
export async function catalogueLoad(m: Mounted, records: unknown[], label: string, rule?: Rule, turn?: (call: Call, meter: Meter) => Promise<void> | void, headers?: Record<string, string>): Promise<Publication & { headers: Record<string, string> }> {
  cold();
  const before = contentBodies(m), sent = headers ?? await preconditions(m);
  cold();
  const { result, meter } = await under(m, () => importJson(m, records, { mode: 'merge' }, sent), rule, turn);
  cold();
  const committed = (await loadDocument(m, 'catalog')).revision;
  cold();
  return { label, answer: result, calls: meter.calls, before, after: contentBodies(m), committed, headers: sent };
}
/** A load that must answer 200 (a fixture step). */
export async function load(m: Mounted, records: unknown[], label: string): Promise<Publication> {
  const p = await catalogueLoad(m, records, label);
  expect(p.answer.status, `PRECONDITION (${m.host}): the catalogue load ${label} answers 200 (${show(p.answer)})`).toBe(200);
  return p;
}

// ── What a publication's purge read, beside what the same publication reads with no setting ───────────────────────────
/**
 * The baseline: the content revisions a catalogue load reads whole after its commit with no setting (no purge runs),
 * each as its distance from the revision it committed (today: its own revision, once), and its calls after the commit.
 */
export interface Baseline { offsets: number[]; calls: number; bytes: number; shards: number; sequence: string[] }
export const sequenceAfterCommit = (p: { calls: readonly Call[] }) => after(p).map(c => `${c.op} ${c.cls}`);
export function baselineOf(p: Publication): Baseline {
  return { offsets: bodyReads(p).map(n => n - p.committed), calls: callsAfterCommit(p), bytes: bytesReadAfterCommit(p), shards: shardReads(p), sequence: sequenceAfterCommit(p) };
}
/** The baseline measured on a twin tenant (one rewriting load, then a one-product load with no setting). */
export async function twinBaseline(host: Host): Promise<Baseline> {
  const twin = await tenant(host);
  await load(twin, rewriting(1), 'twin v1');
  return baselineOf(await load(twin, rangeRecords(2000, 1, ' base'), 'twin base (no setting)'));
}
/** The bodies a publication's purge read: its body reads after the commit less the reads the same publication makes with no setting. */
export function purgeReads(p: Publication, base: Baseline): number[] {
  const reads = bodyReads(p);
  for (const offset of base.offsets) { const at = reads.indexOf(p.committed + offset); if (at >= 0) reads.splice(at, 1); }
  return reads.sort((a, b) => a - b);
}

/**
 * Reading P3: which stored content revisions a purge has run over. A revision is seen once a purge under the setting
 * read its body, or committed it (its value in hand) and read every stored revision below it. "The ledger covers every
 * stored revision" before a publication (RC1, RC2) when every revision stored before it is seen. The reading is a lower
 * bound on any watermark that is never passed by a body not read: a purge that has read less cannot cover more.
 */
export class Seen {
  readonly revisions = new Set<number>();
  note(p: Publication, base: Baseline): void {
    for (const n of purgeReads(p, base)) this.revisions.add(n);
    if (p.before.every(n => this.revisions.has(n) || !p.after.includes(n))) this.revisions.add(p.committed);
  }
  unseen(stored: readonly number[]): number[] { return stored.filter(n => !this.revisions.has(n)); }
  covers(stored: readonly number[]): boolean { return this.unseen(stored).length === 0; }
}

// ── Tenants ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The mounted application with its catalogue declaring its product slots. */
export async function tenant(host: Host): Promise<Mounted> {
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P107 — the tenant documents publish');
  await declareProductSlots(m);
  return m;
}
/** Products 1–4 with every part rewritten (load i): the design's rewriting load. */
export const rewriting = (i: number) => rangeRecords(1, 4, ` v${i}`);
/** One product per load, rotating over 1–4 (load i): the design's one-product load. */
export const oneProduct = (i: number) => rangeRecords(1 + (i % 4), 1, ` v${i}`);
/** A later one-product catalogue load (a product of its own, `k`). */
export const later = (k: number, label: string) => rangeRecords(k, 1, ` ${label}`);

/** Every stored revision's named objects held, and the products read back. */
export async function health(m: Mounted, products: readonly number[]): Promise<{ lost: string[]; reads: Record<string, number> }> {
  const reads: Record<string, number> = {};
  for (const k of products) { cold(); reads[rangeProduct(k)] = (await productRead(m, rangeProduct(k))).status; }
  cold();
  return { lost: lost(m, contentBodies(m)), reads };
}
export const allRead = (products: readonly number[]) => Object.fromEntries(products.map(k => [rangeProduct(k), 200]));
