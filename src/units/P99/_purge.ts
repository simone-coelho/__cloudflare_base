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
import { bucketOf, CAROUSEL, classOf, KEY, namedBy, objectKeys, sorted } from '../P93/_catalog';

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

// ── R2's listing, as the platform's bucket answers it ────────────────────────────────────────────────────────────────
/**
 * The mount's bucket lists as R2 does (`delimiter` rolls keys up into `delimitedPrefixes`, `startAfter`, an opaque
 * `cursor` that resumes after the last name a page answered, at most `limit` names a page): the in-memory double of
 * ../_parity lists prefixes alone, so the purge's rolled-up listing of the ledger's days and hours (publication.ts
 * decisionsName) finds no day there and no stored decision can name a revision. Installed over whatever the bucket
 * answers now; every object listed as uploaded at time 0, as the double lists it.
 */
export function listAsR2(m: Mounted): void {
  Object.defineProperty(m.storage, 'list', { configurable: true, writable: true, value: async (options: { prefix?: string; delimiter?: string; startAfter?: string; cursor?: string; limit?: number } = {}) => {
    const prefix = options.prefix ?? '', after = options.cursor ?? options.startAfter ?? '', limit = Math.min(options.limit ?? 1000, 1000);
    const names: Array<{ name: string; rolled: boolean }> = [];
    for (const key of [...m.storage.objects.keys()].filter(k => k.startsWith(prefix)).sort()) {
      const cut = options.delimiter ? key.indexOf(options.delimiter, prefix.length) : -1;
      const name = cut >= 0 ? key.slice(0, cut + options.delimiter!.length) : key;
      if (name <= after || names.at(-1)?.name === name) continue;
      names.push({ name, rolled: cut >= 0 });
    }
    const page = names.slice(0, limit), truncated = names.length > limit;
    return { objects: page.filter(n => !n.rolled).map(n => ({ key: n.name, size: Buffer.byteLength(m.storage.objects.get(n.name) ?? '', 'utf8'), uploaded: new Date(0) })),
      delimitedPrefixes: page.filter(n => n.rolled).map(n => n.name), truncated, ...(truncated ? { cursor: page.at(-1)!.name } : {}) };
  } });
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
/** The classes of the objects a catalogue revision names beside its body (P86, P93, and P98's packs). */
export const ATTACHMENT_CLASSES = ['part', 'shard', 'idshard', 'ids', 'pack'] as const;
export const attachments = (m: Mounted) => ATTACHMENT_CLASSES.flatMap(cls => objectKeys(m, cls));
/** Every object the named stored revisions reach, through the objects the store still holds (a shard it lacks names nothing). */
export function reached(m: Mounted, revisions?: readonly number[]): Set<string> {
  const out = new Set<string>();
  for (const [n, value] of storedContent(m)) if (!revisions || revisions.includes(n)) for (const key of namedBy(m, value)) out.add(key);
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
/** The shard and id-shard digests a stored revision's index names, by name (either form). */
export function indexDigests(value: Record<string, unknown>): { shards: Record<string, string>; ids: Record<string, string> } {
  const index = value.index as { shards?: Record<string, { digest: string }>; ids?: Record<string, { digest: string }> } | undefined;
  const pick = (group: Record<string, { digest: string }> | undefined) => Object.fromEntries(Object.entries(group ?? {}).map(([name, p]) => [name, p.digest]));
  return { shards: pick(index?.shards), ids: pick(index?.ids) };
}
/** How many of the 256 product shards and 256 id shards a revision's index names under a digest the revision before did not. */
export function touchedBy(before: Record<string, unknown>, after: Record<string, unknown>): { shards: number; ids: number } {
  const a = indexDigests(before), b = indexDigests(after);
  return { shards: Object.entries(b.shards).filter(([name, d]) => a.shards[name] !== d).length, ids: Object.entries(b.ids).filter(([name, d]) => a.ids[name] !== d).length };
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
