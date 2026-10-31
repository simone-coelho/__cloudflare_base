// src/units/P106/LEDGER.unit.test.ts
// P106 under the Closure Ledger (programme `tapestry-parity-publish-cost`, amendment 13, item E31): the tests for the
// LOCAL criteria PC1–PC5 of the P106 work order (docs/parity/publish-cost/program.json at rem/integration 20898147, its
// decision D1; rulings R-P671 and R-P683; the analysis _evidence/parity-step3/R-P665-gate-speed/ANALYSIS.md, causes
// C1–C4, fixes F1–F4). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, as the work order states it: "each catalogue id's shard name is computed once per request, and the
// catalogue's SHA-256 synchronously with node:crypto where the bundle locks and a native run stay green; each value is
// serialised once; the harness caches are keyed by bucket and resolve verifies each pack once per stored pack string;
// stored bytes, names, pointers and digests equal today's; the proof counts digests and serialisations and never sets a
// time cap."
//
// THE CAUSES, re-found at d4596fd5 (the analysis cites lines before P99 and P102; the functions are named here so a
// later join can re-find them):
//   C1 publication.ts `catalogShardName` (:1216–1219) awaits one `crypto.subtle.digest` per id; content.ts `IndexEdit`
//      hashes the same ids again at each step — `namesOf` (:438–440), `pointer` (:469), `owner` (:476), `into` in
//      `assemble` (:621–624) — and a writing load or publish assembles twice (`IndexEdit.build`, :522; the import
//      :2107/:2110, the publish :2529/:2530). Measured here at N = 2,000 on the session host: a first load digests each
//      of its 4,010 ids four times (16,038 shard-name digests), a stage twice per id, a publish three times.
//   C1 (the catalogue's other SHA-256): publication.ts `digest` (:164–166), `PackWriter.add` (:1430) and `seal` (:1440),
//      `freshPack` (:1490–1493) each await `crypto.subtle.digest`.
//   C2 `canonical` (publication.ts :157–163) serialises the same values again: each part in `partPointers` (content.ts
//      :262–266, through `documentDigest`) and again in `PackWriter.add` in each build; each shard twice per build in
//      `catalogShardOf`/`catalogIdShardOf` (:1276/:1281, :1286/:1290), once more in `PackWriter.add`, in each build; each
//      shard a load reads back once on its read and once more in `IndexEdit.productShard`/`idShard` (`documentDigest`
//      of the shard read, content.ts :402, :417). Measured: a first load serialises each part 3 times and each shard and
//      id shard 6 times; a shard read back twice.
//   C3/C4 the harness: `packBuffers` (src/units/P98/_load.ts) and `packed` (src/units/P93/_catalog.ts) were module Maps
//      keyed by object key, shared by the twin hosts; `resolve` re-digested every object of every stored revision.
//
// THE SPECIFIER'S READINGS (the lead may re-rule):
//   R1 A shard-name digest is a SHA-256 whose input is exactly one catalogue id's UTF-8 bytes (a product id or a record
//      id), computed by any API (`crypto.subtle.digest`, `node:crypto` `createHash` or `hash`) from outside the unit
//      harness. "Each id's shard name is digested once" per request: no id is digested twice in one request. The work
//      order's "at most N plus a constant" (N products) is read as the ids the request names: the generator gives each
//      product one record, so a load of N products names about 2N ids, each digested at most once.
//   R2 "The catalogue path" is a SHA-256 called from src/config/publication.ts or src/routes/content.ts; in a load, a
//      stage or a publish none is WebCrypto's (`crypto.subtle.digest`), and the catalogue's digests are node:crypto's
//      (D1, R-P671: `createHash`; `hash` of the same module is counted with it).
//   R3 A serialisation is one run of the publication's `canonical` over a part (`{product, pieces}`), a product shard
//      or an id shard (src/units/P106/_count.ts). Values are counted by their content. A request whose writing build
//      moves nothing makes one build (F2: the writing build reuses the plain one), so each value is serialised at most
//      once in it; a request whose writing build re-homes a pack (the pack table loses a pack it named) or moves the
//      objects stored before packs (load F, over P93's form) makes two, so at most twice. A value read back (a shard the
//      load reads) is a value too, serialised once to check its digest. Every part, shard and id shard the request
//      writes into a pack is serialised at least once — the counter's own check that it sees the serialisation that
//      wrote it. The work order's list (parts' bytes carried from `partPointers`; one serialisation for a shard's size
//      and digest; the plain build reused) is completed by what its own count requires: a shard's serialisation carried
//      into `PackWriter.add` as a part's is, and a shard read back keeping the digest its read checked.
//   R4 "Stored bytes, names, pointers and digests equal today's on the same input": a fixed scenario run on each host
//      (N = 2,000 products; a reload over packs; two stages and their publish; a large reload; a load that re-homes a
//      thin pack; a rollback; a catalogue stored before packs and a one-level one, each converted by a load) is
//      fingerprinted after every step — the catalogue document as read (its shard names, pointers, pack table and
//      digests), every stored pack, part, shard, id shard and id index (key and bytes), and the answer's counts and
//      stage ids — and each step's fingerprint equals the one recorded at d4596fd5 (`FINGERPRINT_AT_D4596FD5`). A
//      stage's directory holds its base's set digest, which carries the set operation's id and time and so differs on
//      every run: that digest, every pack whose bytes hold it or name such a pack, and every object whose bytes name such
//      a pack (a shard's `packs`, its digest and the manifest's 128-bit prefix of it) are compared by name
//      (`volatileNames`), every other byte as stored; a pack table naming such a pack (ordered by digest) is compared row
//      by row by name, each pointer's row by its pack's name (`namedDocument`). The twin hosts store the same objects,
//      so one table serves both.
//   R5 "A native run of a catalogue load and publish passes" (PC2): the real Worker in workerd (src/units/_native.ts,
//      `nodejs_compat` on as wrangler.toml:4 has it) on each shopper host: the catalogue declared, a load, two stages and
//      their publish answer 200 and the products read back, and inside workerd the catalogue's digests equal workerd's
//      WebCrypto on the fixed corpus. It lives here; no deferral.
//   R6 No time cap: every leg is registered with `NO_TIME_CAP` (0, which vitest reads as no timeout); no leg reads a
//      clock or asserts a duration. PC5's lock legs pin the six lock files byte for byte as at d4596fd5; a later ticket
//      that changes one of them by its own grant re-pins `LOCKS_AT_D4596FD5` in the same commit (R10 by name).
//   R7 PC4 (the R10s, granted by name by R-P671 and the work order; the specifier's own, every expectation unchanged):
//      `packBuffers` (_load.ts) and `packed` (_catalog.ts) are keyed by bucket (a WeakMap of the bucket to its own map);
//      `resolve` (_load.ts) verifies each (pack, at, bytes, digest) once per stored pack string, its memo per bucket and
//      dropped when the pack's stored string changes. Observed through the harness's own SHA-256 work (counted) and
//      `packBytes`'s buffers.
//
// THE R10s (granted by name), before → after, every expectation unchanged:
//   src/units/P98/_load.ts `packBuffers`: a module Map keyed by the pack's key → a WeakMap of the bucket to its own Map;
//     `resolve`: each packed object's digest re-checked on every call → checked once per (pack, at, bytes, digest) while
//     the bucket holds the same pack string (a pack lost, altered or rewritten is checked again).
//   src/units/P93/_catalog.ts `packed`: a module Map keyed by the pack's key → a WeakMap of the bucket to its own Map.
//
// HARNESS: ../_parity (the mounted application, both hosts), ../P93/_catalog and ../P98/_load (the fixture, the doors,
// the stored forms), ../_native (workerd), ./_count (the digest and serialisation counters). Imports from src/units/:
// ../_parity, ../_native, ../P93/_catalog, ../P98/_load, ./_count.

import { createHash as realCreateHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

// The counting door on node:crypto: the real module, its `createHash` and `hash` counted while a request is measured.
const COUNTER = vi.hoisted(() => ({ on: false, digests: [] as unknown[], serialised: [] as unknown[] }));
vi.mock('node:crypto', async importOriginal => (await import('./_count')).countedNodeCrypto(await importOriginal<Record<string, unknown>>(), COUNTER as never));
vi.mock('crypto', async importOriginal => (await import('./_count')).countedNodeCrypto(await importOriginal<Record<string, unknown>>(), COUNTER as never));

import { catalogShardName, documentDigest, invalidatePublicationCache, PackWriter } from '@/config/publication';
import { RETENTION_CATEGORIES } from '@/retention';

import { bundleNativeWorker, nativeScratchDirectory, openNativeRuntime } from '../_native';
import { asOperator, expectPublished, HOSTS, loadDocument, mount, readTree, REFLEX_DOCUMENT, TENANT, type Answer, type Host, type Mounted } from '../_parity';
import { ANCHOR_IMAGES, classOf, declareProductSlots, DOCS, DOCS_WITH_CART, forgeObject, KEY, loseObject, OTHER_IMAGES, packedObjects, preconditions, rangeProduct,
  rangeRecordId, rangeRecords, show } from '../P93/_catalog';
import { canonicalJson, importOf, oneLevelTenant, packBytes, packTable, publishOf, resolve, shardedTenant, stageOf } from '../P98/_load';
import { counted, countSerialisations, countSubtle, kindOfValue, type Counter, type DigestSeen, type SerialisedSeen } from './_count';

const counter = COUNTER as unknown as Counter;
/** R6: vitest runs a leg registered with 0 without a timeout. */
const NO_TIME_CAP = 0;
const sha256 = (text: string | Buffer) => realCreateHash('sha256').update(text).digest('hex');
const CATALOGUE_FILES = new Set(['config/publication.ts', 'routes/content.ts']);
const N = 2000;

// ===========================================================================
// The scenario, once per host (R4): every request counted, every step fingerprinted
// ===========================================================================

/** One measured request: what it digested and serialised, and what it wrote. */
interface Measured {
  label: string; status: number;
  /** PC1: each catalogue id the request digested, and how many times. */
  perId: Map<string, number>;
  /** PC2: the request's SHA-256, by API and caller, from the catalogue's files. */
  subtleOnPath: Map<string, number>; nodeOnPath: number;
  /** PC3: each value serialised (by kind and content) and how many times; the values the request wrote into a pack. */
  serialised: Map<string, number>; written: string[]; bound: 1 | 2;
}
interface Step { label: string; fingerprint: string; objects: string }
interface Run { refused: string | null; measured: Measured[]; steps: Step[]; bases: string[] }
const RUNS = new Map<Host, Promise<Run>>();
const runOf = (host: Host) => { let run = RUNS.get(host); if (!run) { run = scenario(host); RUNS.set(host, run); } return run; };

/** Every id the scenario's records name (product ids, record ids, the images' ids and products). */
const IDS = (() => {
  const out = new Set<string>();
  for (let k = 1; k <= 2400; k++) { out.add(rangeProduct(k)); out.add(rangeRecordId(k)); }
  for (const r of [...ANCHOR_IMAGES, ...OTHER_IMAGES]) { out.add(r.id); for (const p of (r.featuredProductIds as string[] | undefined) ?? []) out.add(p); }
  return out;
})();
const keyOf = (s: SerialisedSeen) => `${s.kind} ${s.content}`;
const CONTENT_CLASSES = new Set(['pack', 'part', 'shard', 'idshard', 'ids']);
const packsOf = (m: Mounted) => new Set([...m.storage.objects.keys()].filter(k => classOf(k) === 'pack'));

/** The values of the objects inside the packs written since `before` (parts, shards, id shards), by kind and content. */
function writtenSince(m: Mounted, before: Set<string>): string[] {
  const out: string[] = [];
  for (const key of packsOf(m)) {
    if (before.has(key)) continue;
    const raw = Buffer.from(m.storage.objects.get(key)!, 'utf8'), digest = /([0-9a-f]{64})\.pack$/.exec(key)![1]!;
    for (const o of packedObjects(m, digest)) {
      const text = raw.subarray(o.at, o.at + o.bytes).toString('utf8'), kind = kindOfValue(JSON.parse(text));
      if (kind) out.push(`${kind} ${text}`);
    }
  }
  return out;
}
/** One request run with the counters on; its counts kept, its writes read back after. */
async function measure(m: Mounted, label: string, run: () => Promise<Answer>, bound: (before: string[], after: string[]) => 1 | 2): Promise<{ answer: Answer; measured: Measured }> {
  invalidatePublicationCache();
  const packsBefore = packsOf(m), tableBefore = packTable((await loadDocument(m, 'catalog')).document);
  invalidatePublicationCache();
  const seen = await counted(counter, run);
  const perId = new Map<string, number>(), subtleOnPath = new Map<string, number>(), serialised = new Map<string, number>();
  let nodeOnPath = 0;
  for (const d of seen.digests as DigestSeen[]) {
    if (d.file.startsWith('units/')) continue;
    if (d.text !== null && IDS.has(d.text)) perId.set(d.text, (perId.get(d.text) ?? 0) + 1);
    if (!CATALOGUE_FILES.has(d.file)) continue;
    if (d.api === 'subtle') subtleOnPath.set(`${d.file} ${d.fn}`, (subtleOnPath.get(`${d.file} ${d.fn}`) ?? 0) + 1); else nodeOnPath++;
  }
  for (const s of seen.serialised as SerialisedSeen[]) serialised.set(keyOf(s), (serialised.get(keyOf(s)) ?? 0) + 1);
  const tableAfter = packTable((await loadDocument(m, 'catalog')).document);
  return { answer: seen.result, measured: { label, status: seen.result.status, perId, subtleOnPath, nodeOnPath, serialised, written: writtenSince(m, packsBefore), bound: bound(tableBefore, tableAfter) } };
}
/**
 * R4: the volatile strings of a run, named by what they hold: each set digest a stage named as its base (a set carries
 * its operation's id and time, so it differs on every run) is `set~<k>`, and each pack whose bytes hold a volatile
 * string (a stage's pack, holding its base; a later pack whose shards name a stage's pack) is `pack~<SHA-256 of its
 * bytes with every volatile string named>`. Every other string is compared as stored.
 */
function volatileNames(m: Mounted, bases: readonly string[]): (text: string) => string {
  const packs = new Map([...m.storage.objects.keys()].filter(k => classOf(k) === 'pack').map(k => [/([0-9a-f]{64})\.pack$/.exec(k)![1]!, m.storage.objects.get(k)!]));
  const volatile = new Set(bases);
  for (let grew = true; grew;) {
    grew = false;
    for (const [digest, raw] of packs) if (!volatile.has(digest) && [...volatile].some(v => raw.includes(v))) { volatile.add(digest); grew = true; }
  }
  const names = new Map<string, string>(bases.map((b, k) => [b, `set~${k}`]));
  const named = (text: string) => { let out = text; for (const [real, name] of names) out = out.split(real).join(name); return out; };
  for (let grew = true; grew;) {
    grew = false;
    for (const digest of volatile) {
      if (names.has(digest)) continue;
      const raw = packs.get(digest)!, held = [...volatile].filter(v => v !== digest && raw.includes(v));
      if (held.every(v => names.has(v))) { names.set(digest, `pack~${sha256(named(raw))}`); grew = true; }
    }
  }
  // An object inside a pack whose bytes name a volatile pack (a shard's `packs`) has a volatile digest too, and the
  // manifest names it by its first 128 bits: both named by its bytes with every volatile string named.
  for (const [digest, raw] of packs) {
    if (!volatile.has(digest)) continue;
    const bytes = Buffer.from(raw, 'utf8');
    for (const o of packedObjects(m, digest)) {
      const text = bytes.subarray(o.at, o.at + o.bytes).toString('utf8'), full = /([0-9a-f]{64})\.json$/.exec(o.key)![1]!;
      if (names.has(full) || ![...volatile].some(v => text.includes(v))) continue;
      const name = sha256(named(text));
      names.set(full, `object~${name}`); names.set(full.slice(0, 32), `object32~${name.slice(0, 32)}`);
    }
  }
  return named;
}
/**
 * R4: the catalogue document with its volatile strings named. The pack table is ordered by digest, so where it names a
 * volatile pack its rows are compared by name (each row and each pointer's row named by its pack); otherwise as read.
 */
function namedDocument(doc: Record<string, unknown>, named: (text: string) => string): unknown {
  const index = doc.index as { packs?: Array<{ digest: string }>; shards?: Record<string, { pack?: number }>; ids?: Record<string, { pack?: number }> } | undefined;
  if (!index?.packs?.some(row => named(row.digest) !== row.digest)) return doc;
  const rows = index.packs.map(row => ({ ...row, digest: named(row.digest) }));
  const pointers = (group: Record<string, { pack?: number }> | undefined) => Object.fromEntries(Object.entries(group ?? {})
    .map(([name, p]) => [name, typeof p.pack === 'number' ? { ...p, pack: rows[p.pack]?.digest ?? `row ${p.pack}` } : p]));
  return { ...doc, index: { ...index, packs: Object.fromEntries(rows.map(row => [row.digest, row])), shards: pointers(index.shards), ids: pointers(index.ids) } };
}
/** R4: the step's fingerprint — the catalogue document as read, every stored content object, the answer's counts (volatile strings named). */
async function fingerprint(m: Mounted, label: string, answer: Answer | null, bases: readonly string[]): Promise<Step> {
  invalidatePublicationCache();
  const named = volatileNames(m, bases), doc = namedDocument((await loadDocument(m, 'catalog')).document, named);
  const objects = sha256([...m.storage.objects.keys()].filter(k => CONTENT_CLASSES.has(classOf(k))).sort()
    .map(k => `${named(k)} ${sha256(named(m.storage.objects.get(k)!))}`).sort().join('\n'));
  const said = answer ? { status: answer.status, ...Object.fromEntries(['received', 'imported', 'changed', 'removed', 'skipped', 'stage', 'stages', 'pieces'].filter(k => Object.hasOwn(answer.body, k))
    .map(k => [k, k === 'stage' ? named(String(answer.body[k])).replace(/^([^.]+)\.[0-9a-f]{64}\./, '$1.directory.') : answer.body[k]])) } : null;
  return { label, objects, fingerprint: sha256(named(canonicalJson({ document: doc, objects, answer: said }))) };
}
/** Two builds where the writing build re-homed a pack the table named before (a pack it names no longer); else one. */
const rehomes = (before: string[], after: string[]): 1 | 2 => before.some(d => !after.includes(d)) ? 2 : 1;

async function scenario(host: Host): Promise<Run> {
  const out: Run = { refused: null, measured: [], steps: [], bases: [] };
  const step = async (m: Mounted, label: string, run: () => Promise<Answer>, options: { measured?: boolean; bound?: (b: string[], a: string[]) => 1 | 2 } = {}) => {
    let answer: Answer;
    if (options.measured === false) answer = await run();
    else { const r = await measure(m, label, run, options.bound ?? rehomes); answer = r.answer; out.measured.push(r.measured); }
    if (answer.status !== 200) { out.refused ??= `${label}: ${show(answer)}`; }
    const base = ((answer.body.base as { publication?: { digest?: unknown } } | undefined)?.publication?.digest);
    if (answer.body.staged === true && typeof base === 'string' && !out.bases.includes(base)) out.bases.push(base);
    out.steps.push(await fingerprint(m, label, answer, out.bases));
    return answer;
  };
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P106 — the tenant documents publish');
  await declareProductSlots(m);
  out.steps.push(await fingerprint(m, 'declared', null, out.bases));
  await step(m, 'A first load of 2,000 products', async () => importOf(m, [...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(1, N)]));
  const afterA = await loadDocument(m, 'catalog');
  await step(m, 'B 200 retitled and 100 new over packs', async () => importOf(m, [...rangeRecords(1, 200, ' (p106 b)'), ...rangeRecords(2001, 100)]));
  const s1 = await step(m, 'C stage 1: 200 retitled', async () => stageOf(m, rangeRecords(201, 200, ' (p106 c)')));
  const s2 = await step(m, 'C stage 2: 100 new', async () => stageOf(m, rangeRecords(2101, 100)));
  await step(m, 'C publish of the two stages', async () => publishOf(m, [s1.body.stage, s2.body.stage]));
  await step(m, 'D 1,400 retitled', async () => importOf(m, rangeRecords(401, 1400, ' (p106 d)')));
  await step(m, 'E one retitled, a thin pack re-homed', async () => importOf(m, rangeRecords(1, 1, ' (p106 e)')));
  await step(m, 'H rollback to the first load', async () => asOperator(m, 'POST', `/content/catalog/rollback/${afterA.revision}?scope=${TENANT}`, {}, await preconditions(m)), { measured: false });
  const records = [...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(1, 300)];
  const sharded = (await shardedTenant(host, records)).m;
  out.steps.push(await fingerprint(sharded, 'F stored before packs (P93\'s form)', null, out.bases));
  await step(sharded, 'F 50 retitled over P93\'s form', async () => importOf(sharded, rangeRecords(1, 50, ' (p106 f)')), { bound: () => 2 });
  const oneLevel = (await oneLevelTenant(host, records)).m;
  out.steps.push(await fingerprint(oneLevel, 'G P86\'s one-level form', null, out.bases));
  await step(oneLevel, 'G 50 retitled over P86\'s one-level form', async () => importOf(oneLevel, rangeRecords(1, 50, ' (p106 g)')));
  return out;
}

/**
 * R4: each step's fingerprint at d4596fd5 (the scenario run on both hosts there; identical on both). `objects` is the
 * stored content objects alone (PC3's stored bytes); `fingerprint` adds the document as read and the answer's counts.
 */
const FINGERPRINT_AT_D4596FD5: Array<[string, string, string]> = [
  ['declared',
    'c48aef7ab9796e74f2adf6ebe93cdfc88a9a5754590a3c9c52e815c69ad5db85', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['A first load of 2,000 products',
    '887424c897927251ebc838c73f1e4e941ff3a57a016f7a90f7eba5a249be4492', 'e5faad2fab0f349b18baa10b71b19fd56fd1081baccc266f6db15565faaa3b70'],
  ['B 200 retitled and 100 new over packs',
    '40b4a2ea5a0158e31dbcebf142254c501e262b3a776568c922828d5d87529c89', '8335c17486509e679770138d6f0361a93b6109ce6e42d4fa31dadab693c7465f'],
  ['C stage 1: 200 retitled',
    'f5c2d81974a72652f1874db6bd49c5ec3e755500ac17e224c13a5b6af3b759bf', '12301b1967ea527d8f757257fafbdf4e1d2bbc6f0b151343105469645a3f511a'],
  ['C stage 2: 100 new',
    '21baf215a8682e6e05ce55a8d0638251196e217e5571edc0000392463b020ac7', 'de5c47dec3a9f5db1e71a03deb7352cc8a3712f6fe392cbdac11323701c23b26'],
  ['C publish of the two stages',
    '772fc7c89961d7f29b83dcb88e34e71c29dcc87122ec72cc7548c20f9975aeeb', 'a928bea3723195af504355a81830bfbc9f6bc98fb81c1e12da91d46d434f115d'],
  ['D 1,400 retitled',
    'b1d4d5a7546b721354d96c8e07bc128294f6ce7f87c12037fd364268c6593c0f', '2f204583c51924841fb8e07286fdf8fd540d8f75dddad6cd2a8ebac06a340442'],
  ['E one retitled, a thin pack re-homed',
    'a1c06ce6e1d4cb13e85b3f9744b9d3f493fa18019ce1faee8abdf58dd7d448b9', '2928a8265c6348f4b524f6db78266370b2c9c51ae7e97ed929ccf3de987934c9'],
  ['H rollback to the first load',
    'e40198f7b954703f0c8e4caf0ab9563ce507ab1a63c8c1daeb7cecc7acd081b2', '2928a8265c6348f4b524f6db78266370b2c9c51ae7e97ed929ccf3de987934c9'],
  ['F stored before packs (P93\'s form)',
    'f79397ca2d5f3ff05c1ceb745f64562c4da8bd47bc392ef69b294dbc646bdc9d', '155b117929f105a4563194d3f4539a416a3a39d7bfc77a3b60dabff7fcdc3dca'],
  ['F 50 retitled over P93\'s form',
    '2351b65280cca91008c9f6c164f19998a90577ef9dd132d4369fadb8201eaedf', '807eab8bc8dbf53f57fa0e8ed898c52d27bd1b4bf7c1f4a30b2d54752ed37a6b'],
  ['G P86\'s one-level form',
    'e8a57c0cad8f51ffe4eb3139d20c7a9af5bfc41a71e481deea392a246162bb5e', '90fb12ae605f3943d2aa8c601712a0d4eef2a66b84302d704e39114dfc4da725'],
  ['G 50 retitled over P86\'s one-level form',
    'a38d9b2df8a058cb824bc81606512fb76ee4dcc0a60aefb8aa591560c92c0997', 'a53edd183664b630ac5c6613a7682d2f19d7862c9df5bb9fa5885aea1a051c9b'],
];

const pc1Seen = (x: Measured) => {
  const over = [...x.perId].filter(([, n]) => n > 1), max = Math.max(0, ...x.perId.values());
  return over.length === 0 ? 'each id digested at most once'
    : `${over.length} of ${x.perId.size} ids digested more than once (at most ${max} times; ${[...x.perId.values()].reduce((a, b) => a + b, 0)} shard-name digests)`;
};
const pc2Seen = (x: Measured) => x.subtleOnPath.size === 0 && x.nodeOnPath > 0 ? 'no WebCrypto digest on the catalogue path; node:crypto computes them'
  : `${[...x.subtleOnPath.values()].reduce((a, b) => a + b, 0)} awaited crypto.subtle.digest on the catalogue path (${[...x.subtleOnPath].map(([k, n]) => `${k} ${n}`).join(', ')}); node:crypto ${x.nodeOnPath}`;
const pc3Seen = (x: Measured) => {
  const over = new Map<string, number>(), unseen = new Map<string, number>();
  for (const [k, n] of x.serialised) if (n > x.bound) { const kind = `${k.split(' ')[0]} x${n}`; over.set(kind, (over.get(kind) ?? 0) + 1); }
  for (const w of x.written) if (!x.serialised.has(w)) unseen.set(w.split(' ')[0]!, (unseen.get(w.split(' ')[0]!) ?? 0) + 1);
  const parts: string[] = [];
  if (over.size) parts.push(`serialised more than ${x.bound === 1 ? 'once' : 'twice'}: ${[...over].map(([k, n]) => `${n} ${k}`).join(', ')}`);
  if (unseen.size) parts.push(`written but never seen serialised by canonical: ${[...unseen].map(([k, n]) => `${n} ${k}`).join(', ')}`);
  return parts.length ? parts.join('; ') : `each value serialised at most ${x.bound === 1 ? 'once' : 'twice (two builds)'}, every written value seen`;
};

// ===========================================================================
// unit:P106.PC1 — each id's shard name digested once per request
// ===========================================================================

describe('unit:P106.PC1 (E31, F1 (i): each catalogue id\'s shard name is digested once per request)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): in a first load of 2,000 products, a load over packs, two stages and their publish, a 1,400-product reload, a load that re-homes a thin pack, and a load over P93's form and over P86's one-level form, no catalogue id's shard name is digested twice in one request (reading R1: the shard-name digests at most the ids the request names)`, async () => {
      const run = await runOf(host);
      expect(run.refused, `${host}: PRECONDITION — every step of the scenario answers 200`).toBeNull();
      expect(Object.fromEntries(run.measured.map(x => [x.label, pc1Seen(x)])), `${host}: P106.PC1 — each id's shard name once per request`)
        .toEqual(Object.fromEntries(run.measured.map(x => [x.label, 'each id digested at most once'])));
    }, NO_TIME_CAP);
    it(`host (${host}): PARITY — every shard name, pointer, digest and stored object equals today's on the same input: each step's fingerprint (the catalogue document as read, every stored pack, part, shard, id shard and id index, the answer's counts and stage ids) as recorded at d4596fd5`, async () => {
      const run = await runOf(host);
      expect(run.refused, `${host}: PRECONDITION — every step of the scenario answers 200`).toBeNull();
      expect(run.steps.map(s => [s.label, s.fingerprint, s.objects]), `${host}: P106.PC1 — the catalogue as today, step by step`).toEqual(FINGERPRINT_AT_D4596FD5);
    }, NO_TIME_CAP);
  }
});

// ===========================================================================
// unit:P106.PC2 — the catalogue's SHA-256 with node:crypto, never an awaited WebCrypto digest
// ===========================================================================

/** The fixed corpus: ids and values of every UTF-8 width, a lone surrogate, the empty string, nesting, and a value past 64 KiB. */
const CORPUS_IDS = ['', 'COA-R00001', 'img-r00001-1', 'COA-CH857-BLACK', 'Ünïcödé-ÄÖÜ', '商品-编号-七', 'emoji-👜-🧳', 'lone-\ud800-surrogate', 'x'.repeat(300), '"quoted\\back"'];
const CORPUS_VALUES: unknown[] = [
  {}, [], { product: 'COA-R00001', pieces: [{ id: 'img-r00001-1', title: 'Range product 1, studio', tags: { category: ['Handbags'] } }] },
  { b: 1, a: [true, false, null, 0, -1.5, 1e21], c: { z: 'ü', y: '👜', x: 'lone \udfff' } },
  { shard: '0a', products: { 'COA-R00001': { digest: 'f'.repeat(64), records: 1, at: 0, bytes: 10 } }, packs: ['e'.repeat(64)] },
  { shard: 'ff', ids: { 'img-r00001-1': 'COA-R00001' } },
  { text: 'α'.repeat(40_000), list: Array.from({ length: 2000 }, (_, i) => ({ i, s: `item ${i}` })) },
];
const hexOf = (buffer: ArrayBuffer) => Buffer.from(buffer).toString('hex');
const webcrypto = async (text: string) => hexOf(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

describe('unit:P106.PC2 (E31, F1 (ii), D1: the catalogue\'s SHA-256 computed synchronously with node:crypto)', () => {
  it('logic: PARITY — on the fixed corpus every catalogue digest is byte-equal to WebCrypto\'s: documentDigest of each value (its canonical UTF-8 bytes), catalogShardName of each id (the first byte of its UTF-8 bytes\' SHA-256), PackWriter.add\'s digest of each value and its range, and seal\'s digest of the pack\'s bytes', async () => {
    const seen: unknown[] = [], want: unknown[] = [];
    for (const v of CORPUS_VALUES) { seen.push(await documentDigest(v)); want.push(await webcrypto(canonicalJson(v))); }
    for (const id of CORPUS_IDS) { seen.push(await catalogShardName(id)); want.push((await webcrypto(id)).slice(0, 2)); }
    const writer = new PackWriter();
    let at = 0, body = '';
    for (const v of CORPUS_VALUES) {
      const raw = canonicalJson(v), bytes = new TextEncoder().encode(raw).byteLength;
      seen.push(await writer.add(v)); want.push({ at, bytes, digest: await webcrypto(raw) });
      at += bytes; body += raw;
    }
    const sealed = await writer.seal();
    seen.push(sealed && { digest: sealed.digest, bytes: sealed.bytes, objects: sealed.objects }); want.push({ digest: await webcrypto(body), bytes: at, objects: CORPUS_VALUES.length });
    expect(seen, 'P106.PC2 — every catalogue digest equals WebCrypto\'s on the fixed corpus').toEqual(want);
  }, NO_TIME_CAP);
  for (const host of HOSTS) {
    it(`host (${host}): in every load, stage and publish of the scenario no awaited crypto.subtle.digest is called on the catalogue path (publication.ts, content.ts) and node:crypto computes the catalogue's SHA-256 (reading R2)`, async () => {
      const run = await runOf(host);
      expect(run.refused, `${host}: PRECONDITION — every step of the scenario answers 200`).toBeNull();
      expect(Object.fromEntries(run.measured.map(x => [x.label, pc2Seen(x)])), `${host}: P106.PC2 — no WebCrypto digest on the catalogue path`)
        .toEqual(Object.fromEntries(run.measured.map(x => [x.label, 'no WebCrypto digest on the catalogue path; node:crypto computes them'])));
    }, NO_TIME_CAP);
  }
  for (const host of HOSTS) {
    it(`host (${host}, native): the real Worker in workerd (nodejs_compat) — the catalogue declared, a load of 200 products, two stages and their publish answer 200 and the products read back; inside workerd the catalogue's digests on the fixed corpus equal workerd's WebCrypto (reading R5)`, async () => {
      const seen = await nativeWorld(host, async w => {
        const declared = await w.put({ version: 'p106-native', productSlots: ['pdp-carousel'], pieces: DOCS.pieces });
        const loaded = await w.load('import', [...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(1, 200)]);
        const s1 = await w.load('stage', rangeRecords(1, 50, ' (p106 native)')), s2 = await w.load('stage', rangeRecords(201, 50));
        const published = await w.publish([s1.body.stage, s2.body.stage]);
        const reads = await Promise.all([rangeProduct(1), rangeProduct(100), rangeProduct(250)].map(p => w.read(p)));
        const digests = await w.digests();
        return { declared: declared.status, loaded: loaded.status, staged: [s1.status, s2.status], published: published.status,
          reads: reads.map(r => r.status), titles: [reads[0]!.titles.some(t => t.endsWith('(p106 native)')), reads[2]!.titles.length > 0], digests };
      });
      expect(seen, `${host} native: P106.PC2 — the catalogue loads and publishes in workerd, its digests WebCrypto's`).toEqual({
        declared: 200, loaded: 200, staged: [200, 200], published: 200, reads: [200, 200, 200], titles: [true, true], digests: 'equal' });
    }, NO_TIME_CAP);
  }
});

// ===========================================================================
// unit:P106.PC3 — each value serialised once per build
// ===========================================================================

describe('unit:P106.PC3 (E31, F2: each part, shard and id shard serialised once per build)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): in every load, stage and publish of the scenario the publication's canonical runs at most once per part, shard and id shard value in a request whose writing build moves nothing (the plain build reused), at most twice where it re-homes a pack or moves objects stored before packs, and every value written into a pack is seen serialised (reading R3)`, async () => {
      const run = await runOf(host);
      expect(run.refused, `${host}: PRECONDITION — every step of the scenario answers 200`).toBeNull();
      const rehomed = run.measured.find(x => x.label.startsWith('E '));
      expect(rehomed?.bound, `${host}: PRECONDITION — load E re-homes a thin pack (two builds)`).toBe(2);
      expect(Object.fromEntries(run.measured.map(x => [x.label, pc3Seen(x)])), `${host}: P106.PC3 — each value serialised once per build`)
        .toEqual(Object.fromEntries(run.measured.map(x => [x.label, `each value serialised at most ${x.bound === 1 ? 'once' : 'twice (two builds)'}, every written value seen`])));
    }, NO_TIME_CAP);
    it(`host (${host}): PARITY — the stored bytes equal today's: after each step every stored pack, part, shard, id shard and id index, key and bytes, as recorded at d4596fd5`, async () => {
      const run = await runOf(host);
      expect(run.refused, `${host}: PRECONDITION — every step of the scenario answers 200`).toBeNull();
      expect(run.steps.map(s => [s.label, s.objects]), `${host}: P106.PC3 — the stored objects as today, step by step`)
        .toEqual(FINGERPRINT_AT_D4596FD5.map(([label, , objects]) => [label, objects]));
    }, NO_TIME_CAP);
  }
});

// ===========================================================================
// unit:P106.PC4 — the harness caches keyed by bucket; resolve verifies once per stored pack string
// ===========================================================================

/** The twin hosts each holding the same 300 products in packs (byte-identical packs under the same keys). */
async function twins(): Promise<{ a: Mounted; b: Mounted; pack: string; doc: Record<string, unknown> }> {
  const mounted: Mounted[] = [];
  for (const host of HOSTS) {
    const m = await mount(host, DOCS_WITH_CART);
    expectPublished(m, 'P106 — the tenant documents publish');
    await declareProductSlots(m);
    const loaded = await importOf(m, [...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(1, 300)]);
    expect(loaded.status, `PRECONDITION (${host}): 300 products load (${show(loaded)})`).toBe(200);
    invalidatePublicationCache();
    mounted.push(m);
  }
  const [a, b] = mounted;
  const doc = (await loadDocument(a!, 'catalog')).document, pack = packTable(doc)[0]!;
  expect(a!.storage.objects.get(KEY.pack(pack)) === b!.storage.objects.get(KEY.pack(pack)) ? 'byte-identical' : 'differ',
    'PRECONDITION: the twin hosts hold the same pack under the same key').toBe('byte-identical');
  expect(a!.storage.objects.get(KEY.pack(pack)) !== undefined && b!.storage.objects.get(KEY.pack(pack)) !== undefined, 'PRECONDITION: both buckets hold it').toBe(true);
  return { a: a!, b: b!, pack, doc };
}
/** The harness's own SHA-256 work while `work` runs (the digests its files compute), by file. */
async function harnessDigests(work: () => unknown): Promise<Record<string, number>> {
  const seen = await counted(counter, async () => work());
  const out: Record<string, number> = {};
  for (const d of seen.digests as DigestSeen[]) if (d.file.startsWith('units/')) out[d.file] = (out[d.file] ?? 0) + 1;
  return out;
}

describe('unit:P106.PC4 (E31, F3/F4: the harness caches keyed by bucket; resolve verifies each pack once per stored pack string)', () => {
  it('logic: packBuffers (P98\'s _load.ts) is keyed by bucket — the twin hosts\' byte-identical pack under the same key is read as one buffer per bucket, never the other bucket\'s; within a bucket the same buffer while the stored string is the same, a new one once it changes', async () => {
    const { a, b, pack } = await twins();
    const first = packBytes(a, pack), other = packBytes(b, pack), again = packBytes(a, pack);
    const raw = a.storage.objects.get(KEY.pack(pack))!;
    a.storage.objects.set(KEY.pack(pack), raw.slice(0, -1) + ' ');
    const changed = packBytes(a, pack);
    a.storage.objects.set(KEY.pack(pack), raw);
    expect({ perBucket: first !== other, sameWhileSame: first === again, newOnChange: changed !== first && changed?.at(-1) === 0x20 },
      'P106.PC4 — packBuffers keyed by bucket').toEqual({ perBucket: true, sameWhileSame: true, newOnChange: true });
  }, NO_TIME_CAP);
  it('logic: packed (P93\'s _catalog.ts) is keyed by bucket — the second twin\'s first read of its own byte-identical pack parses and digests its own bytes, never the first bucket\'s entry; a repeated read of either digests nothing while its stored string is the same, and a changed string is read again', async () => {
    const { a, b, pack } = await twins();
    const firstA = await harnessDigests(() => packedObjects(a, pack)), firstB = await harnessDigests(() => packedObjects(b, pack));
    const againA = await harnessDigests(() => packedObjects(a, pack)), againB = await harnessDigests(() => packedObjects(b, pack));
    const raw = b.storage.objects.get(KEY.pack(pack))!;
    b.storage.objects.set(KEY.pack(pack), raw.slice(0, -1) + ' ');
    const changedB = await harnessDigests(() => packedObjects(b, pack));
    b.storage.objects.set(KEY.pack(pack), raw);
    const n = (x: Record<string, number>) => x['units/P93/_catalog.ts'] ?? 0;
    expect({ firstA: n(firstA) > 0, firstB: n(firstB) === n(firstA) ? 'its own bytes digested' : `${n(firstB)} digests (the first bucket's ${n(firstA)})`,
      again: [n(againA), n(againB)], changed: n(changedB) > 0 }, 'P106.PC4 — packed keyed by bucket').toEqual({ firstA: true, firstB: 'its own bytes digested', again: [0, 0], changed: true });
  }, NO_TIME_CAP);
  it('logic: resolve (P98\'s _load.ts) verifies each packed object once per stored pack string, its memo per bucket — a second resolve of the same revision on the same bucket digests nothing; the twin\'s first resolve digests its own; a packed part lost (loseObject) or forged (forgeObject) after the memo is warm is listed bad, and restored reads good again (the negative controls)', async () => {
    const { a, b, doc } = await twins();
    const r1 = resolve(a, doc), first = await harnessDigests(() => resolve(a, doc)), twin = await harnessDigests(() => resolve(b, doc));
    expect(r1.bad, 'PRECONDITION: every object the revision names resolves').toEqual([]);
    const part = Object.entries(r1.view.products).find(([, p]) => p.place)!;
    const key = KEY.part(part[1].digest), other = KEY.part(Object.values(r1.view.products).find(p => p.digest !== part[1].digest && p.place)!.digest);
    const restoreLost = loseObject(a, key); const lost = resolve(a, doc).bad; restoreLost();
    const healed = resolve(a, doc).bad;
    const restoreForged = forgeObject(a, key, other); const forged = resolve(a, doc).bad; restoreForged();
    const healedAgain = resolve(a, doc).bad;
    const n = (x: Record<string, number>) => x['units/P98/_load.ts'] ?? 0;
    const named = (bad: string[]) => bad.some(line => line.startsWith(`part ${part[0]} in pack`)) ? 'listed bad' : `not listed (${JSON.stringify(bad).slice(0, 120)})`;
    expect({ again: n(first), twin: n(twin) > 0, lost: named(lost), healed, forged: named(forged), healedAgain },
      'P106.PC4 — resolve verifies once per stored pack string; loseObject and forgeObject still bite').toEqual({ again: 0, twin: true, lost: 'listed bad', healed: [], forged: 'listed bad', healedAgain: [] });
  }, NO_TIME_CAP);
});

// ===========================================================================
// unit:P106.PC5 — the locks unchanged; no time cap
// ===========================================================================

/** R6: the lock files byte for byte as at d4596fd5 (SHA-256 of each file's bytes). */
const LOCKS_AT_D4596FD5: Record<string, string> = {
  'src/units/P98/LEDGER.unit.test.ts': 'cc4c78fe697b87410903552565a071a3b04da6e6f38f13d78fd2094a9a450515',
  'src/units/P99/LEDGER.unit.test.ts': '8447058e34da3e9513968ba19000d40736294633856f9a0850f41069e3a79e46',
  'src/units/P99/_purge.ts': '33dd8e40de6b9c487ed3d1985142ad49acacf6a35c905ab9a068a8d483c5f2b6',
  'src/units/P102/LEDGER.unit.test.ts': 'fc96bf0bef06c59232d3c8e5166cd479c1b25140392eac40a68da57a692f2c86', // re-pinned by P109.GD3's R10 (R-P707; R-P668, R-P709) and by P105's join of it with its CR2 R10 (R-P721)
  'src/units/P93/LEDGER.unit.test.ts': '13e1f2582f91c5d64b2f5f98fefce6eb2395266791dd5cadd472bdf17f589c09',
  'src/units/P86/LEDGER.unit.test.ts': 'd04bd6ccc2c8c566d933fe5695055f464e8d5277d91deb177cfe27db02e026c1',
  'src/units/P95/LEDGER.unit.test.ts': 'f710f74f24d8a1a1175ec573ba408eb8e79a15b84c8841fa3717be7680f175a6',
};
/** The names the two R10 files export at d4596fd5 (an R10 by name keeps every one). */
const EXPORTS_AT_D4596FD5: Record<string, string[]> = {
  'src/units/P98/_load.ts': [
    'Call', 'Fault', 'HEX64', 'Meter', 'OpName', 'PUBLISH_PATH', 'Phase', 'Rule', 'STAGE_PATH', 'STORAGE_NUMBER', 'STORAGE_WORDS', 'attemptsOf',
    'canonicalJson', 'digestOf', 'failFirst', 'importOf', 'leaked', 'loadedTenant', 'meter', 'minutesAgo', 'objectKindOf', 'oneLevelTenant',
    'packBytes', 'packTable', 'publishOf', 'rawImport', 'reached', 'recoverOf', 'resolve', 'revisionOf', 'shardedTenant', 'shortRetention',
    'stageOf', 'statusOf', 'storedPacks', 'tally', 'under', 'uploadedAt', 'valueAt'],
  'src/units/P93/_catalog.ts': [
    'A', 'ANCHOR_IMAGES', 'BLACK', 'CAROUSEL', 'DOCS', 'DOCS_WITH_CART', 'FEED_URL', 'IndexView', 'KEY', 'LEARN', 'MODULE_IDS', 'OTHER_IMAGES', 'Op',
    'Place', 'Pointer', 'READ_GAP', 'RangedRead', 'Rec', 'SERVED_FOR_BLACK', 'SHOTS', 'ShardPointer', 'bucketOf', 'bytesOf', 'carousel', 'catalogue',
    'classOf', 'declareProductSlots', 'forgeObject', 'fourOf', 'held', 'heldKeys', 'heldRaw', 'image', 'importJson', 'indexOf', 'loseObject',
    'metered', 'namedBy', 'objectKeys', 'packedObjects', 'partAt', 'placedKey', 'placedReadClasses', 'preconditions', 'productRead', 'pull',
    'rangeProduct', 'rangeRecordId', 'rangeRecords', 'rangeTenant', 'readAsWanted', 'readClasses', 'readIds', 'shardRead', 'show', 'snapshotOf',
    'sorted', 'storedBeforePacks', 'storedRevisionValues', 'storedValue', 'touched', 'unique', 'withinCaps'],
};
const exportsOf = (text: string) => [...text.matchAll(/^export (?:async )?(?:function|const|interface|type|class|let) ([A-Za-z0-9_]+)/gm)].map(m => m[1]!).sort();

describe('unit:P106.PC5 (E31: the locks unchanged; no time cap)', () => {
  it('logic: LOCK — the test files of P98, P99, P102, P93, P86 and P95 (and P99\'s purge harness) are byte for byte as at d4596fd5, and the two R10 harness files export the same names', () => {
    expect(Object.fromEntries(Object.keys(LOCKS_AT_D4596FD5).map(file => [file, sha256(readTree(file))])), 'P106.PC5 — the locks unchanged').toEqual(LOCKS_AT_D4596FD5);
    expect(Object.fromEntries(Object.keys(EXPORTS_AT_D4596FD5).map(file => [file, exportsOf(readTree(file))])), 'P106.PC5 — the R10 files\' exports unchanged').toEqual(EXPORTS_AT_D4596FD5);
  }, NO_TIME_CAP);
  it('logic: no test of P106 sets or relies on a time cap — every leg registered with NO_TIME_CAP (0: no timeout), no clock read, no timer, no timeout setting in P106\'s files', () => {
    const files = ['src/units/P106/LEDGER.unit.test.ts', 'src/units/P106/_count.ts'].map(file => [file, readTree(file)] as const);
    const forbidden = [['performance', 'now'], ['Date', 'now'], ['new ', 'Date('], ['set', 'Timeout'], ['set', 'Interval'], ['test', 'Timeout'], ['hook', 'Timeout'], ['vi.', 'setConfig'], ['useFake', 'Timers']]
      .map(parts => parts.join(''));
    const found = files.flatMap(([file, text]) => forbidden.filter(word => text.includes(word)).map(word => `${file}: ${word}`));
    const self = files[0]![1], legs = [...self.matchAll(/^\s*it\(/gm)].length, capped = [...self.matchAll(/\}, NO_TIME_CAP\);$/gm)].length;
    expect({ found, legs: legs > 0 && legs === capped ? 'every leg without a time cap' : `${capped} of ${legs} legs registered with NO_TIME_CAP`, cap: NO_TIME_CAP },
      'P106.PC5 — no time cap').toEqual({ found: [], legs: 'every leg without a time cap', cap: 0 });
  }, NO_TIME_CAP);
});

// ===========================================================================
// The native world (PC2, reading R5): the real Worker in workerd, on one shopper host
// ===========================================================================

const NATIVE_SECRET = 'p106-native-operator-signing-material';
const NATIVE_WRAPPER = `
import worker, { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet, documentDigest, catalogShardName, PackWriter } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { PRIORS_KIND, EMPTY_PRIORS } from './src/learn/priors.ts';
export { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend };
const hex = buffer => Array.from(new Uint8Array(buffer)).map(n => n.toString(16).padStart(2, '0')).join('');
const web = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== 'p106-fixture.invalid') return worker.fetch(request, env, ctx);
    const input = await request.json();
    if (url.pathname === '/publish') {
      const revision = value => ({ revision: 1, at: 1, actor: 'p106-native', note: '', value });
      await initializePublicationSet(env, [
        { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) }, { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
        { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) }, { kind: PRIORS_KIND, scope: input.tenant, revision: revision(EMPTY_PRIORS) },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision(input.reflex) },
      ], '0:' + crypto.randomUUID());
      return Response.json({ published: input.tenant });
    }
    if (url.pathname === '/digests') {
      const seen = [], want = [], writer = new PackWriter();
      let at = 0, body = '';
      for (const [i, v] of input.values.entries()) {
        seen.push(await documentDigest(v)); want.push(await web(input.canonical[i]));
        const added = await writer.add(v), bytes = new TextEncoder().encode(input.canonical[i]).byteLength;
        seen.push([added.at, added.bytes, added.digest]); want.push([at, bytes, await web(input.canonical[i])]);
        at += bytes; body += input.canonical[i];
      }
      for (const id of input.ids) { seen.push(await catalogShardName(id)); want.push((await web(id)).slice(0, 2)); }
      const sealed = await writer.seal();
      seen.push(sealed.digest); want.push(await web(body));
      return Response.json({ seen, want });
    }
    return new Response(null, { status: 404 });
  },
};`;
let nativeBundle: Promise<string> | undefined;
interface NativeWorld {
  put: (document: unknown) => Promise<Answer>;
  load: (door: 'import' | 'stage', records: unknown[]) => Promise<Answer>;
  publish: (stages: unknown[]) => Promise<Answer>;
  read: (product: string) => Promise<Answer & { titles: string[] }>;
  digests: () => Promise<string>;
}
async function nativeWorld<T>(host: Host, work: (w: NativeWorld) => Promise<T>): Promise<T> {
  const bundle = await (nativeBundle ??= bundleNativeWorker(NATIVE_WRAPPER, 'p106-ledger-native'));
  const directory = nativeScratchDirectory('p106-ledger-native-');
  const policy = { id: 'p106-native-policy', revision: 1, durationMs: 3650 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
  const runtime = await openNativeRuntime({ bundle, name: `p106-native-${host}`, persistDir: directory.path,
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket', DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
    kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
    bindings: { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host, JWT_SECRET: NATIVE_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      IDENTITY_SECRETS: `${TENANT}:p106-native-identity`, LEDGER_RECOVERY_ENABLED: 'true', TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
      RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, policy])) } }) } });
  try {
    const fixture = async (path: string, body: unknown) => {
      const response = await runtime.fetch(`https://p106-fixture.invalid${path}`, { method: 'POST', body: JSON.stringify(body) });
      expect(response.status, `PRECONDITION (${host} native): fixture door ${path}`).toBe(200);
      return await response.json() as Record<string, unknown>;
    };
    await fixture('/publish', { tenant: TENANT, content: { version: 'p106-native', pieces: DOCS.pieces }, slots: DOCS_WITH_CART.slots, learn: DOCS.learn, reflex: REFLEX_DOCUMENT });
    const parsed = async (response: Response): Promise<Answer> => {
      const text = await response.text();
      let body: Record<string, unknown>; try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { text }; }
      return { status: response.status, body };
    };
    const token = await new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a')
      .setExpirationTime('2h').sign(new TextEncoder().encode(NATIVE_SECRET));
    const operator = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => parsed(await runtime.fetch(`https://ops.invalid${path}`, {
      method, headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const base = async () => {
      const read = await operator('GET', `/content/catalog?scope=${TENANT}`), publication = read.body.publication as { revision: number; digest: string };
      return { 'If-Match': `"${String(read.body.revision)}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${String(read.body.revision)}:${crypto.randomUUID()}` };
    };
    return await work({
      put: async document => operator('PUT', `/content/catalog?scope=${TENANT}`, { document, note: 'p106 native' }, await base()),
      load: async (door, records) => operator('POST', `/content/catalog/${door}?scope=${TENANT}&mode=merge`, records, await base()),
      publish: async stages => operator('POST', `/content/catalog/publish?scope=${TENANT}`, { stages }, await base()),
      read: async product => {
        const a = await operator('GET', `/content/catalog?scope=${TENANT}&product=${encodeURIComponent(product)}`);
        return { ...a, titles: (((a.body.document as { pieces?: unknown } | undefined)?.pieces ?? []) as Array<{ title?: string }>).map(p => String(p.title)) };
      },
      digests: async () => {
        const answer = await fixture('/digests', { values: CORPUS_VALUES, canonical: CORPUS_VALUES.map(v => canonicalJson(v)), ids: CORPUS_IDS });
        return JSON.stringify(answer.seen) === JSON.stringify(answer.want) && (answer.seen as unknown[]).length > 0 ? 'equal' : `differ: ${JSON.stringify(answer).slice(0, 300)}`;
      },
    });
  } finally {
    await runtime.dispose(); directory.remove();
  }
}

// The counters, installed for the whole file (each counts only while a request is measured).
countSubtle(counter);
countSerialisations(counter);
