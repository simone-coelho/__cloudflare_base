// src/units/P99/_purge.ts
// P99's harness (programme `tapestry-parity-hardening`, amendment 13, item E23): the storage meter of one operator
// publication (every call on the mount's bucket, its bytes, and whether it came after the publication's commit), the
// deletion stop (every deletion call after the k-th fails), the catalogue as P93's release stored it planted beside the
// routes (each product's part, each of the 256 product shards and 256 id shards an object of its own, the manifest
// published by the publication authority's own `publish`), the objects a stored revision names read back in either form
// (through ../P93/_catalog, which reads P98's packs once P98 has re-pointed it), the configuration retention setting, a
// retained-baseline learn history, and the learn history in the stored forms P95's R3 planted. It holds no expected value:
// it mounts, calls and reads back. Synthetic, customer-neutral names; tenant ids only.

import { createHash } from 'node:crypto';
import { expect } from 'vitest';

import { initializePublicationSet, invalidatePublicationCache, publish, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateSaltVersions } from '@/content/holdout';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentCatalog } from '@/content/types';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';

import { asOperator, expectPublished, loadDocument, MODULES, mount, REFLEX_DOCUMENT, TENANT, type Answer, type Documents, type Host, type Mounted } from '../_parity';
import { bucketOf, CAROUSEL, classOf, KEY, sorted } from '../P93/_catalog';

// ── Canonical values and digests (the publication's own rule: keys sorted, no insignificant white space) ─────────────
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const digestOf = (value: unknown) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');

/** A cold isolate: no publication, document, lift or salt count held from an earlier request. */
export const cold = () => { invalidatePublicationCache(); invalidateCache(); invalidateLiftCache(); invalidateSaltVersions(); };
export const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
export const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;

// ── The configuration retention setting (W38 B4, decision D3), in the registry's own policy form ─────────────────────
export function setConfigurationRetention(m: Mounted, durationMs: number): void {
  const registry = JSON.parse(String(m.env.RETENTION)) as { version: number; tenants: Record<string, Record<string, unknown>> };
  registry.tenants[TENANT]!.configuration = { id: 'p99-configuration-revisions', revision: 1, durationMs, basis: 'occurred', renewal: 'new-record-only' };
  m.env.RETENTION = JSON.stringify(registry);
}

// ── The meter: every call one operation makes on the mount's bucket ──────────────────────────────────────────────────
export type OpName = 'get' | 'put' | 'head' | 'list' | 'delete';
export interface Call { op: OpName; key: string; cls: string; bytes: number; afterCommit: boolean }
const HEAD_KEY = `config-publication/v2/${TENANT}/head.json`;
/**
 * Every bucket call `run` makes, in order, through whatever the bucket answers with now (an earlier override included).
 * `afterCommit` marks the calls made after the put of the head that commits the publication (its body holds no pending
 * set): the purge runs there (src/config/publication.ts publishSet, after `finish`). `deletion(k)`, where given, is asked
 * before the k-th deletion call (from 1) and fails that call when it answers true (a failed deletion: the purge stops).
 */
export async function metered<T>(m: Mounted, run: () => Promise<T>, deletion?: (k: number) => boolean): Promise<{ result: T; calls: Call[] }> {
  const bucket = m.storage as unknown as Record<string, unknown>, calls: Call[] = [], saved = new Map<string, PropertyDescriptor | undefined>();
  let committed = false, deletions = 0;
  for (const name of ['get', 'put', 'head', 'list', 'delete'] as const) {
    saved.set(name, Object.getOwnPropertyDescriptor(bucket, name));
    const current = (bucket[name] as (...args: unknown[]) => Promise<unknown>).bind(m.storage);
    Object.defineProperty(bucket, name, { configurable: true, writable: true, value: async (...args: unknown[]) => {
      const first = args[0], key = name === 'list' ? String((first as { prefix?: string } | undefined)?.prefix ?? '') : Array.isArray(first) ? first.join(',') : String(first);
      const call: Call = { op: name, key, cls: name === 'list' ? 'list' : classOf(key), bytes: name === 'put' ? Buffer.byteLength(String(args[1] ?? ''), 'utf8') : 0, afterCommit: committed };
      calls.push(call);
      if (name === 'delete' && deletion?.(++deletions)) throw new Error('P99 fixture: the purge is stopped at this deletion call');
      const result = await current(...args) as { size?: number; range?: { length?: number } } | null;
      if (name === 'get' && result) call.bytes = Number(result.range?.length ?? result.size ?? 0);
      if (name === 'put' && key === HEAD_KEY && result) { try { committed = (JSON.parse(String(args[1])) as { pending?: unknown }).pending === null; } catch { /* not a head body */ } }
      return result;
    } });
  }
  try { return { result: await run(), calls }; }
  finally { for (const [name, d] of saved) { if (d) Object.defineProperty(bucket, name, d); else Reflect.deleteProperty(bucket, name); } }
}
/** The calls and the bytes read after a publication's commit. */
export const afterCommit = (calls: readonly Call[]) => {
  const after = calls.filter(c => c.afterCommit);
  return { calls: after.length, bytes: after.filter(c => c.op === 'get').reduce((n, c) => n + c.bytes, 0), deletions: after.filter(c => c.op === 'delete').length };
};

// ── The operator's publications ──────────────────────────────────────────────────────────────────────────────────────
export const preconditionsOf = (base: { revision: number; publication: { revision: number; digest: string } }) =>
  ({ 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` });
/**
 * One configuration publication that is not a catalogue load (`PUT /content/slots`, the slots document in force under a
 * new version label), on a cold isolate, metered: every configuration publication runs the purge after its commit.
 */
export async function slotsPublication(m: Mounted, label: string, deletion?: (k: number) => boolean): Promise<{ answer: Answer; calls: Call[] }> {
  cold();
  const base = await loadDocument(m, 'slots');
  cold();
  const { result, calls } = await metered(m, () => asOperator(m, 'PUT', `/content/slots?scope=${TENANT}`,
    { document: { ...base.document, version: `p99-slots-${label}` }, note: `p99 ${label}` }, preconditionsOf(base)), deletion);
  cold();
  expect(result.status, `PRECONDITION (${m.host}): the operator's slots publication ${label} is accepted (${show(result)})`).toBe(200);
  return { answer: result, calls };
}

// ── The catalogue's stored revisions and the objects they name (either form; P98's packs through ../P93/_catalog) ─────
const CONTENT_REV = new RegExp(`^config-publication/v1/${TENANT}/content/rev/([0-9]+)\\.json$`);
/** The content revisions whose bodies are stored, ascending, with their values. */
export function storedContent(m: Mounted): Array<[number, Record<string, unknown>]> {
  const out: Array<[number, Record<string, unknown>]> = [];
  for (const [key, raw] of m.storage.objects) {
    const hit = CONTENT_REV.exec(key);
    if (hit) out.push([Number(hit[1]), (JSON.parse(raw) as { value?: Record<string, unknown> }).value ?? {}]);
  }
  return out.sort(([a], [b]) => a - b);
}
export const contentBodies = (m: Mounted) => storedContent(m).map(([n]) => n);
/**
 * The objects a catalogue revision names beside its body, read in every stored form, by the key of the object the store
 * holds each in: P86's one-level parts and id index; P93's product shards and id shards, each an object of its own named
 * by its digest, and the parts their pointers name by digest; and P98's packs — a manifest pointer with a byte range
 * (`at`, `bytes`) lives in the pack its `pack` row of the manifest's table names (with or without a digest beside it), a
 * part pointer with a range in its shard's own `packs` row or, without one, in the pack its shard lives in; every pack
 * the table names. Read straight from the bucket (no expected value; the reader of the forms P98's builds wrote at
 * eafe219d and 1113cc75). `missing` lists the objects a pointer names that the store does not hold.
 */
const CONTENT_DIR = `config-publication/v1/${TENANT}/content/`;
const own = (kind: 'part' | 'shard' | 'idshard' | 'ids', digest: string) => `${CONTENT_DIR}${kind}/${digest}.json`;
export const packKey = (digest: string) => `${CONTENT_DIR}pack/${digest}.pack`;
interface Placed { digest?: string; pack?: number; at?: number; bytes?: number }
const packBodies = new Map<string, { raw: string; bytes: Buffer }>();
function slice(m: Mounted, pack: string, at: number, bytes: number): Record<string, unknown> | null {
  const raw = m.storage.objects.get(packKey(pack));
  if (raw === undefined) return null;
  let held = packBodies.get(pack);
  if (!held || held.raw !== raw) { held = { raw, bytes: Buffer.from(raw, 'utf8') }; packBodies.set(pack, held); }
  try { return JSON.parse(held.bytes.subarray(at, at + bytes).toString('utf8')) as Record<string, unknown>; } catch { return null; }
}
const parsed = (m: Mounted, key: string) => { const raw = m.storage.objects.get(key); return raw === undefined ? null : JSON.parse(raw) as Record<string, unknown>; };
const ranged = (p: Placed) => typeof p.at === 'number' && typeof p.bytes === 'number';
export function namedObjects(m: Mounted, value: Record<string, unknown>): { keys: Set<string>; missing: string[] } {
  const keys = new Set<string>(), missing: string[] = [];
  const index = value.index as { packs?: Array<string | { digest?: string }>; shards?: Record<string, Placed>; ids?: Record<string, Placed> } | undefined;
  if (index && typeof index === 'object') {
    const table = (index.packs ?? []).map(row => typeof row === 'string' ? row : String(row?.digest ?? ''));
    for (const digest of table) if (digest) keys.add(packKey(digest));
    const open = (kind: 'shard' | 'idshard', p: Placed): { body: Record<string, unknown> | null; key: string; pack?: string } => {
      if (ranged(p)) { const pack = typeof p.pack === 'number' ? table[p.pack] ?? '' : ''; return { body: pack ? slice(m, pack, p.at!, p.bytes!) : null, key: packKey(pack || 'unnamed'), pack }; }
      const key = own(kind, String(p.digest)); return { body: parsed(m, key), key };
    };
    for (const p of Object.values(index.shards ?? {})) {
      const { body, key, pack } = open('shard', p);
      keys.add(key);
      if (!body) { missing.push(key); continue; }
      const packs = Array.isArray(body.packs) ? body.packs as string[] : [];
      for (const part of Object.values((body.products ?? {}) as Record<string, Placed>)) {
        if (!ranged(part)) { keys.add(own('part', String(part.digest))); continue; }
        const home = typeof part.pack === 'number' ? packs[part.pack] : pack;
        keys.add(packKey(home || 'unnamed'));
      }
    }
    for (const p of Object.values(index.ids ?? {})) { const { body, key } = open('idshard', p); keys.add(key); if (!body) missing.push(key); }
  } else if (value.products && typeof value.products === 'object') {
    for (const p of Object.values(value.products as Record<string, Placed>)) keys.add(own('part', String(p.digest)));
    const ids = value.idIndex as Placed | undefined;
    if (ids?.digest) keys.add(own('ids', ids.digest));
  }
  return { keys, missing };
}
/** The catalogue's object directories (P86's parts and id indexes, P93's shards and id shards, P98's packs). */
const ATTACHMENT = new RegExp(`^config-publication/v1/${TENANT}/content/(?:(?:part|shard|idshard|ids)/[0-9a-f]{64}\\.json|pack/[0-9a-f]{64}\\.pack)$`);
export const attachments = (m: Mounted) => sorted([...m.storage.objects.keys()].filter(key => ATTACHMENT.test(key)));
/** Every object the named stored revisions reach, through the objects the store still holds (a shard it lacks names nothing). */
export function reached(m: Mounted, revisions?: readonly number[]): Set<string> {
  const out = new Set<string>();
  for (const [n, value] of storedContent(m)) if (!revisions || revisions.includes(n)) for (const key of namedObjects(m, value).keys) out.add(key);
  return out;
}
/** Stored objects that no stored revision reaches (a stranded or leaked object). */
export const unnamed = (m: Mounted) => { const named = reached(m); return attachments(m).filter(key => !named.has(key)); };
/** Objects the named revisions reach (or name by pointer) that the store no longer holds. */
export const lost = (m: Mounted, revisions: readonly number[]) => sorted([...reached(m, revisions)].filter(key => !m.storage.objects.has(key)));

// ── The catalogue as P93's release stored it, planted beside the routes ──────────────────────────────────────────────
/** The pieces the content kind admits, routed as the catalogue routes them: shared, or one product's part (P98's S43 fixture rule). */
export function routed(records: unknown[]): { shared: unknown[]; parts: Map<string, unknown[]> } {
  const checked = CONTENT_KIND.validate({ pieces: [...MODULES, ...records] });
  if (!checked.ok) throw new Error(`P99 fixture: ${checked.errors.slice(0, 3).join('; ')}`);
  const shared: unknown[] = [], parts = new Map<string, unknown[]>();
  for (const piece of checked.value.pieces) {
    const product = piece.slotTypes?.every(s => s === CAROUSEL) && piece.featuredProductIds?.[0] ? piece.featuredProductIds[0] : null;
    if (product === null) shared.push(piece); else parts.set(product, [...(parts.get(product) ?? []), piece]);
  }
  return { shared, parts };
}
async function publishManifest(m: Mounted, manifest: Record<string, unknown>, note: string): Promise<number> {
  cold();
  const base = await loadDocument(m, 'catalog');
  const written = await publish<ContentCatalog>(m.env, CONTENT_KIND, TENANT, { type: 'replace', candidate: manifest },
    { actor: 'p99-fixture', note, operationId: `${base.revision}:${crypto.randomUUID()}`, expectedRevision: base.revision, expectedPublication: base.publication },
    () => manifest);
  if (!written.ok) throw new Error(`P99 fixture: the stored form was refused: ${written.errors.slice(0, 3).join('; ')}`);
  cold();
  return written.revision.revision;
}
/**
 * One catalogue revision in P93's form, as the release before P98 stored it: each product's part, each product shard and
 * each id shard an object of its own at its content address (exact-create: an object already stored is kept), the
 * manifest's `index` naming every shard with no byte range; published by the publication authority. `products` is the
 * catalogue's whole product set at this revision (product → its part's pieces).
 */
export async function plantRevision(m: Mounted, products: ReadonlyMap<string, unknown[]>, shared: unknown[], version: string): Promise<number> {
  const put = async (key: string, value: unknown) => { if (!m.storage.objects.has(key)) await m.storage.put(key, canonicalJson(value)); };
  const shards = new Map<string, Record<string, { digest: string; records: number }>>(), idShards = new Map<string, Record<string, string>>();
  for (const product of [...products.keys()].sort()) {
    const pieces = products.get(product)!, value = { product, pieces }, digest = digestOf(value);
    await put(KEY.part(digest), value);
    const shard = shards.get(bucketOf(product)) ?? {}; shard[product] = { digest, records: pieces.length }; shards.set(bucketOf(product), shard);
    for (const piece of pieces as Array<{ id: string }>) { const ids = idShards.get(bucketOf(piece.id)) ?? {}; ids[piece.id] = product; idShards.set(bucketOf(piece.id), ids); }
  }
  const index = { key: 'sha256-hex2', shards: {} as Record<string, unknown>, ids: {} as Record<string, unknown> };
  for (const name of [...shards.keys()].sort()) {
    const value = { shard: name, products: shards.get(name)! }, digest = digestOf(value);
    await put(KEY.shard(digest), value);
    index.shards[name] = { digest, products: Object.keys(value.products).length, records: Object.values(value.products).reduce((n, p) => n + p.records, 0) };
  }
  for (const name of [...idShards.keys()].sort()) {
    const value = { shard: name, ids: idShards.get(name)! }, digest = digestOf(value);
    await put(KEY.idshard(digest), value);
    index.ids[name] = { digest, records: Object.keys(value.ids).length };
  }
  return publishManifest(m, { version, productSlots: [CAROUSEL], pieces: shared, index }, `P93's form, before packs: ${version}`);
}
/** Each product shard and id shard a stored revision's index names, by name, as the pointer names its object (its digest, or its pack and range). */
export function indexPointers(value: Record<string, unknown>): { shards: Record<string, string>; ids: Record<string, string> } {
  const index = value.index as { packs?: Array<string | { digest?: string }>; shards?: Record<string, Placed>; ids?: Record<string, Placed> } | undefined;
  const table = (index?.packs ?? []).map(row => typeof row === 'string' ? row : String(row?.digest ?? ''));
  const name = (p: Placed) => ranged(p) ? `${typeof p.pack === 'number' ? table[p.pack] : '?'}@${p.at}+${p.bytes}` : String(p.digest);
  const pick = (group: Record<string, Placed> | undefined) => Object.fromEntries(Object.entries(group ?? {}).map(([n, p]) => [n, name(p)]));
  return { shards: pick(index?.shards), ids: pick(index?.ids) };
}
/** How many of the product shards and id shards a revision's index names under an object the revision before did not. */
export function touchedBy(before: Record<string, unknown>, after: Record<string, unknown>): { shards: number; ids: number } {
  const a = indexPointers(before), b = indexPointers(after);
  return { shards: Object.entries(b.shards).filter(([n, d]) => a.shards[n] !== d).length, ids: Object.entries(b.ids).filter(([n, d]) => a.ids[n] !== d).length };
}

// ── Learn histories ──────────────────────────────────────────────────────────────────────────────────────────────────
export const learnKey = (n: number) => `config-publication/v1/${TENANT}/learn/rev/${n}.json`;
const LEARN_REV = new RegExp(`^config-publication/v1/${TENANT}/learn/rev/([0-9]+)\\.json$`);
/** The learn revisions whose bodies are stored, ascending. */
export const storedLearn = (m: Mounted) => [...m.storage.objects.keys()].map(key => LEARN_REV.exec(key)).filter(Boolean).map(hit => Number(hit![1])).sort((a, b) => a - b);
/** The operator's learn publication through the mounted route (kit 02: If-Match from the loaded draft, Idempotency-Key), on a cold isolate. */
export async function putLearn(m: Mounted, document: unknown, note = 'p99 fixture'): Promise<Answer> {
  cold();
  const base = await loadDocument(m, 'learn');
  cold();
  const answer = await asOperator(m, 'PUT', `/content/learn?scope=${TENANT}`, { document, note }, preconditionsOf(base));
  cold();
  return answer;
}
export const getLearn = async (m: Mounted) => { cold(); const answer = await asOperator(m, 'GET', `/content/learn?scope=${TENANT}`); cold(); return answer; };
export const validateLearn = async (m: Mounted, document: unknown) => { cold(); const answer = await asOperator(m, 'POST', `/content/learn/validate?scope=${TENANT}`, { document }); cold(); return answer; };

/**
 * P95's R3, as src/units/P95/LEDGER.unit.test.ts plantLearnHistory (:240–268) does it: a stored learn history rewritten
 * into the form an older writer left it — `before` (no salt annotation) or `unknown` (`{ salt, version: null }`) — every
 * digest that names it (the set references, the chain of sets, the head) resealed over canonical JSON exactly as the
 * engine seals it, so the engine re-verifies every digest when it reads them. Nothing under test is stubbed.
 */
export type Form = 'before' | 'unknown' | 'kept';
const sealed = (basis: Record<string, unknown>) => ({ ...basis, digest: digestOf(basis) });
export async function plantLearnHistory(m: Mounted, formOf: (n: number) => Form): Promise<void> {
  const storage = m.storage, revisions = `config-publication/v1/${TENANT}/learn/rev/`, sets = `config-publication/v2/${TENANT}/set/`;
  const documentDigests = new Map<string, string>(), setDigests = new Map<string, string>();
  for (const key of [...storage.objects.keys()].filter(key => key.startsWith(revisions))) {
    const form = formOf(Number(key.slice(revisions.length, -'.json'.length)));
    if (form === 'kept') continue;
    const { derived, digest, ...basis } = JSON.parse(storage.objects.get(key)!) as Record<string, unknown> & { derived?: { salt: string } };
    expect(derived?.salt, `PRECONDITION (${m.host}): ${key} was published with its salt annotation`).toEqual(expect.any(String));
    const envelope = sealed(form === 'before' ? basis : { ...basis, derived: { salt: derived!.salt, version: null } });
    documentDigests.set(digest as string, envelope.digest);
    await storage.put(key, canonicalJson(envelope));
  }
  const setRevisions = [...storage.objects.keys()].filter(key => key.startsWith(sets)).map(key => Number(key.slice(sets.length, -'.json'.length))).sort((a, b) => a - b);
  for (const n of setRevisions) {
    const { digest, ...set } = JSON.parse(storage.objects.get(`${sets}${n}.json`)!) as { digest: string; refs: Record<string, { digest: string }>; operation: { base: { revision: number; digest: string } | null } };
    for (const ref of Object.values(set.refs)) ref.digest = documentDigests.get(ref.digest) ?? ref.digest;
    if (set.operation.base) set.operation.base = { revision: set.operation.base.revision, digest: setDigests.get(set.operation.base.digest) ?? set.operation.base.digest };
    const resealed = sealed(set as unknown as Record<string, unknown>);
    setDigests.set(digest, resealed.digest);
    await storage.put(`${sets}${n}.json`, canonicalJson(resealed));
  }
  const { digest: headDigest, ...current } = JSON.parse(storage.objects.get(HEAD_KEY)!) as { digest: string; committed: { revision: number; digest: string } };
  expect(typeof headDigest, `PRECONDITION (${m.host}): the head is sealed`).toBe('string');
  current.committed = { revision: current.committed.revision, digest: setDigests.get(current.committed.digest)! };
  await storage.put(HEAD_KEY, canonicalJson(sealed(current as unknown as Record<string, unknown>)));
  cold();
}

/**
 * A tenant whose learn history starts at a retained baseline (W38 B3; kit 02: "Versions below that baseline report
 * `legacy_history_unavailable`"): the mounted application, its first configuration publication set made by the
 * publication authority's own initializer (`initializePublicationSet`) with the tenant's documents at revision 1 and its
 * learn document adopted at revision `baseline` (so its history floor, `minRevision`, is `baseline`).
 */
export async function retainedBaselineTenant(host: Host, documents: Documents, baseline: number): Promise<Mounted> {
  const m = await mount(host, documents);
  expectPublished(m, 'P99 — the tenant documents publish');
  for (const key of [...m.storage.objects.keys()]) if (key.startsWith('config-publication/')) m.storage.objects.delete(key);
  cold();
  const at = (revision: number, value: unknown) => ({ revision, at: 1, actor: 'p99-fixture', note: 'retained baseline', value });
  const baselines: PublicationBaseline[] = [
    { kind: CONTENT_KIND, scope: TENANT, revision: at(1, { version: 'p99-catalogue', pieces: documents.pieces }) },
    { kind: SLOTS_KIND, scope: TENANT, revision: at(1, documents.slots) },
    { kind: LEARN_KIND, scope: TENANT, revision: at(baseline, documents.learn) },
    { kind: PRIORS_KIND, scope: TENANT, revision: at(1, EMPTY_PRIORS) },
    { kind: REFLEX_KIND, scope: reflexScopeForTenant(TENANT), revision: at(1, documents.reflex ?? REFLEX_DOCUMENT) },
  ] as PublicationBaseline[];
  await initializePublicationSet(m.env, baselines, '0:' + crypto.randomUUID());
  cold();
  return m;
}
