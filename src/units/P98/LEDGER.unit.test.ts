// src/units/P98/LEDGER.unit.test.ts
// P98 under the Closure Ledger (programme `tapestry-parity-hardening`, amendment 13, item E25): the tests for the LOCAL
// criteria LD1–LD8 of the P98 work order (docs/parity/hardening/program.json, hash sha256:d10259c4…, rulings R-P545,
// R-P549, R-P551). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md:9–13, E25):
//   "#### E25 · Catalogue loads that do not fail at random, and run faster
//    - **Authority:** lane L20 (R-P540): 15% of the fill loads (29 of 193) answered 503 `publication_unavailable`, nothing
//      written, a re-send succeeding; ~200 s for a 5,000-product file. The diagnosis `S42/analyst-503/DIAGNOSIS.md`
//      (R-P543): one storage call failing with no retry (about 1 call in 8,000), every failure mapped to one answer that
//      hides its cause and whether anything is pending; reads strictly one at a time and writes 8 at a time with a
//      barrier, so a 5,000-product load is ~1,250 sequential steps; the `changed` count over-counting on a fresh isolate;
//      a refused load's objects never collected.
//    - **Done when:** a failed storage call on the load's path is retried once inside the request (bounded, idempotent:
//      exact-creates and reads only); the load's calls run in a bounded pool without batch barriers; the 503 names the
//      operation, the object kind and the storage error's number (never a key or a body) and a `state` —
//      `nothing_written`, `pending` (recover) or `committed`; the `changed` count compares records independent of field
//      order; the purge collects the objects a refused load left once they are older than the grace; kit 02 and kit 03
//      state the load protocol (file size, client timeout, read the status then recover or re-send); the live walk
//      measures the refusal rate and the time per 5,000 products on both pair hosts, one host at a time.
//    - **Starts from:** `src/config/publication.ts` (the error mapping, the part and shard writes, the purge),
//      `src/routes/content.ts` (the import path, the `changed` count).
//    - **Needed by:** the December test (the customer's 40,000-product loads). Two to three days."
//   The owner's direction of 28 October (R-P545 (2)) withdrew the retry-and-pool design as papering over: the load is
//   redesigned around its root cause, one file of products turned into thousands of storage calls; the kit's operator
//   advice (file sizes, timeouts, re-sends) is not a fix and is not shipped as one. R-P549 adopted design C (one
//   content-addressed pack per load, pointers with byte ranges) and C2 (files staged in parallel, published once); the
//   work order's LD1–LD8 carry its numbers. These legs pin the root-cause fix (calls bounded by the pack, not by the
//   product count); the in-request retry is a safety net on the bounded path (LD2), never the fix.
//
// THE DESIGN (S44/analyst-load/DESIGN.md §4, ruled R-P549) as these legs read it:
//   · a pack is one immutable object at `config-publication/v1/<scope>/content/pack/<SHA-256 of its bytes>.pack`, holding
//     the canonical bytes of every part whose digest moved and every product shard and id shard the load rebuilt;
//   · a manifest pointer (`index.shards[n]`, `index.ids[n]`) into a pack carries `pack` (its place in the manifest's
//     `index.packs` table), `at` and `bytes`; a part pointer inside a shard carries `at` and `bytes` (its shard's own pack)
//     or also `pack` (its place in the shard's own `packs` table); a pointer with no range is an object of its own (P93,
//     P86), read as before; each object keeps the digest of its canonical value, checked on every read.
//
// THE SPECIFIER'S READINGS (where the work order and the design leave a shape open; the lead may re-rule):
//   S1 The stage and publish doors (LD2): `POST /content/catalog/stage?scope=&mode=…` takes the records as the import
//      takes them (a JSON array here) with the import's preconditions naming its base, and answers 200 with a `stage`
//      member (an opaque string); `POST /content/catalog/publish?scope=` takes `{ stages: [<stage>…] }` with the
//      publication's preconditions (`If-Match` of the base the stages were staged over, `Idempotency-Key`) and answers as
//      the import does (200 with `revision`; the import's refusals). Only `merge` stages are exercised.
//   S2 The 503 (LD4) carries `operation` (the R2 method: get, put, head, list, delete), `objectKind` (the kind of the
//      storage object the call named: pack, head, set, revision, and part, shard, idshard for an object stored before
//      packs), `storageStatus` (the number the platform's error ends with, a number; absent or null when it carries none)
//      and `state` (`nothing_written`, `pending`, `committed`), beside today's `error` and `code`. The names are those of
//      the withdrawn brief's ruled shape, which LD4 keeps in substance. The call a 503 names is the call whose two
//      consecutive failures refused the request (the last failed call).
//   S3 "Calls" are every call the request makes on the tenant's bucket (get, put, head, list, delete), the purge's
//      included (the fixture sets configuration retention for every tenant, so the purge runs on every publication), on a
//      cold isolate (the publication caches cleared before the load), as the design measured them. "Reads" of a page are
//      its GETs of `config-publication/` keys (P93's count); its bytes are those reads' lengths.
//   S4 The 26 behaviours (LD1): the steps of the design's behaviour probe (S44/analyst-load/proto-kept/probe/
//      analystload.behave.test.ts) through the routes — 21 operator steps, the cold page and the catalogue read (the
//      probe's replay step passed no decision id and answered 404 on both trees, so it is left out) — with today's status,
//      code, skip, dry run and revision movement (S44 logs/behave/today-behave.json) and the EXACT changed count of LD5: the
//      probe ran each step on a cold isolate, where today over-counts (2 for 3 on the move, 1 for 2 on the freed id, 150 for
//      152 on the reload), so those three values are today's count without the field-order defect, which LD5 requires.
//   S5 The pack table's live figures (LD6): each entry names its pack (the digest, or an object whose `digest` is it) and,
//      where an entry is an object, carries the objects and the bytes the revision reaches in that pack among its numbers.
//      "Past 64 packs … re-homed by a later load" (at most one pack per load, design §4) is read as: the table never names
//      more than 65 packs; "under a quarter live" by bytes.
//   S6 "Uploaded" (the grace): the in-memory bucket lists every object as uploaded at time 0 (src/units/_parity.ts, outside
//      this ticket's grant), so the LD6 legs report upload times through their own wrapper (`uploadedAt`, 14 minutes ago or
//      16 minutes ago); elsewhere every object reads as past the grace, which the sketch measured against the locks.
//   S7 The catalogue-import credential (LD2) is exercised on the parity mount (the demo profile) with a service token
//      minted with `roles: ['catalog-import']` under the mount's own signing material; the customer profile's boundary
//      (src/customerBoundary.ts CUSTOMER_ROUTES) is outside the grant and is reported, not tested.
//   S8 load_too_large (LD1): within today's input caps (2 MiB a request) a pack passes 64 MiB only by rewriting large
//      parts: 36 products whose parts are each about 1.9 MiB, each loaded alone, then one load naming all 36.
//   S9 "Repeated once" (LD2, LD4) is counted as the consecutive attempts of one call (its operation, key and range): the
//      failure and the repeats that follow it up to the first that does not fail; a later call of the same key (the head
//      read again after the reservation, a pack headed again after it) is a call of its own.
//   S10 The objects stored before packs (LD6, LD8): a pointer without a byte range is such an object; the parts move into
//      a pack when a load names their product, so "one full reload" is read as a reload that changes every product's
//      records (a reload of unchanged records is the skip and writes nothing); the shards and id shards stored before
//      packs are moved by the loads after the release (each read once, LD8), so after such a reload and the publications
//      that purge the older revisions, no stored revision names an object without a range.
//   S11 "No sentence advises re-sending a file as the remedy for a refusal" (LD7): no sentence of either kit that names a
//      file, a load, the import or the catalogue and a 503, a refusal, a timeout or a failure also tells the reader to send
//      it again (re-send, resend, sent again, resubmit, try or retry the file or load again). Kit 03 may keep a true sentence
//      naming files of 200 to 300 products (P93.CS7's lock reads one; no R10 on that file is granted).
//
// THE R10s (granted by name, R-P551), before → after:
//   src/units/_parity.ts UnitR2 (:171–195): `get(key)` → `get(key, { range })` answers the range's bytes with the
//     object's size (R2's ranged read); `head(key)` answered `{ key }` → `{ key, etag, size, customMetadata }`. Nothing
//     else in the double changed (its list still reports `uploaded: new Date(0)`).
//   src/units/P93/_catalog.ts (:88–220): `KEY.pack` and the `pack` class added; `indexOf` reads a shard and an id shard
//     pointer with a byte range from its pack, gives each part pointer its `place` (pack and range), reports a missing pack
//     by its key, and names the places (`places`); `namedBy` names the pack an object lives in, and every pack the table
//     names; `partAt` reads a part from its place. A pointer without a range reads exactly as before.
//   src/units/P86/LEDGER.unit.test.ts (:303–390): `productsOf`, `shardOf`, `partOf`, `idShardKeysOf` and `indexOf` read a
//     pointer with a byte range from its pack (`shardOf` and `idShardKeysOf` then name the pack's key); `partKeys` and
//     `idsKeys` still list the objects of their own.
//
// DEFERRALS: LV1 (lane L21 on the pair's next release, one pair host at a time: 40,000 products staged in parallel and
// published once, timed against 30 s; the refusal rate over the lane's loads; a page's cold bytes against 120 KB; l3's
// objects stored before packs repacked by one full reload and collected).
// RESIDUALS (told, not tested): heap per request (Node is not workerd; the stage keeps a 5,000-product file's memory, the
// publish reads no staged part, LD2); the customer profile's boundary for the two new doors (S7); a stage that adopts a
// pack uploaded long ago and is published past the grace; `replace` and `full` stages; the receipts, telemetry and
// ingest-vocabulary readers through a pack (P93.CS6 and P85 run them as locks); live ranged-read latency.
//
// HARNESS: ../_parity (the mounted application on both hosts), ../P93/_catalog (P86's fixture and generator, the stored
// forms read back), ./_load (the meter and fault injector, the pack reader, the doors, the stored forms planted). Imports
// from src/units/: ../_parity, ../P93/_catalog, ./_load.

import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

// The customer profile's leg (LD2, R-P569 (c)) mounts the real Worker through P87's stamp, which needs the module doubles
// src/units/P87/LEDGER.unit.test.ts registers (the Agents router and the browser binding are on no path these units call).
vi.mock('agents', () => ({ routeAgentRequest: async () => undefined }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { initializePublicationSet, invalidatePublicationCache } from '@/config/publication';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';

import { asOperator, expectPublished, HOSTS, loadDocument, MODULES, mount, putDocument, readTree, REFLEX_DOCUMENT, shopperOn, TENANT, UnitR2, type Answer, type Host,
  type Mounted } from '../_parity';
import { A, ANCHOR_IMAGES, BLACK, bucketOf, carousel, CAROUSEL, declareProductSlots, DOCS, DOCS_WITH_CART, image, indexOf, KEY, OTHER_IMAGES, preconditions, productRead,
  rangeProduct, rangeRecordId, rangeRecords, readIds, SERVED_FOR_BLACK, shardRead, SHOTS, show, snapshotOf, withinCaps, type Rec } from '../P93/_catalog';
import { stamp } from '../P87/_stamp';
import { attemptsOf, canonicalJson, failFirst, importOf, leaked, loadedTenant, meter, minutesAgo, objectKindOf, oneLevelTenant, packTable, publishOf, rawImport, reached,
  recoverOf, resolve, revisionOf, shardedTenant, shortRetention, stageOf, statusOf, STORAGE_NUMBER, storedPacks, tally, under, uploadedAt, type Call, type Meter,
  type Rule } from './_load';

// ── Shared readings of an answer ─────────────────────────────────────────────────────────────────────────────────────
const atMost = (value: number, bound: number) => value <= bound ? `at most ${bound}` : `${value} (more than ${bound})`;
const PUBLICATION_WRITES = { 'put content revision': 1, 'put head': 2, 'put pack': 1, 'put set': 1 };
interface Row { status: number; code: string | null; skipped: unknown; dryRun: unknown; changed: unknown; calls: number; puts: Record<string, number>; packs: string[] }
const rowOf = (answer: Answer, st: Meter): Row => ({ status: answer.status, code: (answer.body.code as string | undefined) ?? null, skipped: answer.body.skipped ?? null,
  dryRun: answer.body.dryRun ?? null, changed: answer.body.changed ?? null, calls: st.calls.length, puts: tally(st.calls, 'put'),
  packs: st.calls.filter(c => c.op === 'put' && c.cls === 'pack' && !c.failed).map(c => c.key) });
/** One import on a cold isolate (its preconditions read first), metered. */
async function measuredLoad(m: Mounted, records: unknown[], members: Record<string, string> = { mode: 'merge' }, rule?: Rule) {
  const headers = await preconditions(m);
  invalidatePublicationCache();
  const { result, meter: st } = await under(m, () => importOf(m, records, headers, members), rule);
  return { row: rowOf(result, st), meter: st, answer: result, headers };
}
const PACK_KEY = /\/content\/pack\/([0-9a-f]{64})\.pack$/;
const packDigest = (key: string) => PACK_KEY.exec(key)?.[1] ?? key;

// ── The page (LD3): cold and warm reads, their bytes, how the shard and part are read ───────────────────────────────
interface PageRow { status: number; served: string[]; reads: number; bytes: number; ranged: number; ownObjects: string[]; warmReads: number }
async function pageOf(m: Mounted, label: string): Promise<PageRow> {
  const s = await shopperOn(m);
  invalidatePublicationCache();
  const cold = await under(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, `${label}-cold`));
  const warm = await under(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, `${label}-warm`));
  const readsOf = (calls: readonly Call[]) => calls.filter(c => c.op === 'get' && c.key.startsWith('config-publication/'));
  const coldReads = readsOf(cold.meter.calls);
  return { status: cold.result.status, served: carousel(cold.result), reads: coldReads.length, bytes: coldReads.reduce((n, c) => n + c.bytes, 0),
    ranged: coldReads.filter(c => c.cls === 'pack' && c.range).length, ownObjects: coldReads.filter(c => ['shard', 'part', 'idshard'].includes(c.cls)).map(c => c.cls),
    warmReads: readsOf(warm.meter.calls).length };
}
/** The page as LD3 states it; its bytes bounded at 40,000 products (122,880), the size the criterion names, and not elsewhere. */
const PAGE_EXPECTED = (bytes?: number) => ({ status: 200, served: SERVED_FOR_BLACK, reads: 'at most 8', bytes: bytes ? `at most ${bytes}` : 'not bounded', ranged: 2, ownObjects: [], warmReads: 'at most 1' });
const pageSeen = (row: PageRow, bytes?: number) => ({ ...row, reads: atMost(row.reads, 8), bytes: bytes ? atMost(row.bytes, bytes) : 'not bounded', warmReads: atMost(row.warmReads, 1) });

// ===========================================================================
// The scale measurement, once per host, read by LD1 (calls, the one pack, the rollback) and LD3 (the page at 40,000)
// ===========================================================================

interface Scale {
  refused: string | null; page40000: PageRow | null; lost: [number, boolean] | string;
  /** The manifest at 40,000 in packs: its canonical bytes, its shared pieces' and the packs its table names (R-P569 (b)). */
  manifest: { bytes: number; shared: number; packs: number } | null;
  at5000: Row | null; at40000: Row | null; new100: Row | null; new1000: Row | null; changed5000: Row | null; skip5000: Row | null;
  newPack: { bad: string[]; partsElsewhere: number; shardsElsewhere: number; rebuilt: number } | null;
  reload: Row | null; rollback: Row | null; restored: boolean | null;
}
const SCALE = new Map<Host, Promise<Scale>>();
const scale = (host: Host) => { let run = SCALE.get(host); if (!run) { run = measureScale(host); SCALE.set(host, run); } return run; };
async function measureScale(host: Host): Promise<Scale> {
  const out: Scale = { refused: null, page40000: null, lost: 'not measured', manifest: null, at5000: null, at40000: null, new100: null, new1000: null, changed5000: null, skip5000: null,
    newPack: null, reload: null, rollback: null, restored: null };
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P98 — the tenant documents publish');
  await declareProductSlots(m);
  for (let k = 0; k < 8; k++) {
    const loaded = await importOf(m, [...(k === 0 ? [...ANCHOR_IMAGES, ...OTHER_IMAGES] : []), ...rangeRecords(1 + 5000 * k, 5000)]);
    if (loaded.status !== 200) { out.refused = `the fill's file ${k + 1} was refused: ${show(loaded)}`; return out; }
  }
  const filled = (await loadDocument(m, 'catalog')).document;
  out.manifest = { bytes: Buffer.byteLength(canonicalJson(filled), 'utf8'), shared: Buffer.byteLength(canonicalJson(filled.pieces), 'utf8'), packs: packTable(filled).length };
  out.page40000 = await pageOf(m, `p98-scale-${host}`);
  // A lost pack: the one holding the anchor's part.
  const anchorPack = indexOf(m, (await loadDocument(m, 'catalog')).document).products[A]?.place?.pack;
  if (anchorPack) {
    const key = KEY.pack(anchorPack), raw = m.storage.objects.get(key)!;
    m.storage.objects.delete(key);
    const s = await shopperOn(m); invalidatePublicationCache();
    const lost = await snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p98-lost-pack');
    out.lost = [lost.status, JSON.stringify(lost.body).includes('part_unavailable')];
    m.storage.objects.set(key, raw); invalidatePublicationCache();
  } else out.lost = 'no pack holds the anchor\'s part';
  // N = 5,000 against N = 40,000: the same file of 5,000 new products.
  const small = await loadedTenant(host, 5000);
  out.at5000 = (await measuredLoad(small, rangeRecords(100001, 5000))).row;
  const before = indexOf(m, (await loadDocument(m, 'catalog')).document);
  const big = await measuredLoad(m, rangeRecords(100001, 5000));
  out.at40000 = big.row;
  const after = resolve(m, (await loadDocument(m, 'catalog')).document), written = big.row.packs.map(packDigest);
  const rebuilt = Object.entries(after.view.shards).filter(([name, p]) => before.shards[name]?.digest !== p.digest).map(([name]) => name);
  out.newPack = { bad: after.bad,
    partsElsewhere: Array.from({ length: 5000 }, (_, i) => rangeProduct(100001 + i)).filter(p => !written.includes(after.view.products[p]?.place?.pack ?? 'none')).length,
    shardsElsewhere: rebuilt.filter(name => !written.includes(after.view.places?.shards[name]?.pack ?? 'none')).length, rebuilt: rebuilt.length };
  out.new100 = (await measuredLoad(m, rangeRecords(110001, 100))).row;
  out.new1000 = (await measuredLoad(m, rangeRecords(120001, 1000))).row;
  out.changed5000 = (await measuredLoad(m, rangeRecords(20001, 5000, ' (p98 retitle)'))).row;
  out.skip5000 = (await measuredLoad(m, rangeRecords(20001, 5000, ' (p98 retitle)'))).row;
  // The bounded rollback: a 5,000-product reload, then the rollback undoing it.
  const target = await loadDocument(m, 'catalog'), targetView = indexOf(m, target.document);
  out.reload = (await measuredLoad(m, rangeRecords(30001, 5000, ' (p98 reload)'))).row;
  const headers = await preconditions(m); invalidatePublicationCache();
  const back = await under(m, () => asOperator(m, 'POST', `/content/catalog/rollback/${target.revision}?scope=${TENANT}`, {}, headers));
  out.rollback = rowOf(back.result, back.meter);
  const rolled = indexOf(m, (await loadDocument(m, 'catalog')).document);
  out.restored = Array.from({ length: 5000 }, (_, i) => rangeProduct(30001 + i)).every(p => rolled.products[p]?.digest === targetView.products[p]?.digest);
  return out;
}

// ===========================================================================
// unit:P98.LD1 — a load's calls are bounded by its pack, not its product count
// ===========================================================================

/** The behaviour probe's steps (reading S4): [label, status, code, skipped, dryRun, changed, revision moved]. */
type Step = [string, number, string | null, boolean | null, boolean | null, number | null, number];
const STEPS: Step[] = [
  ['record_moved (an id of COA-R00001 sent under COA-R00002 alone)', 422, 'record_moved', null, null, null, 0],
  ['move with both products in the file', 200, null, null, null, 2, 1],
  ['id_in_part (a shared piece carrying a part record\'s id)', 422, 'id_in_part', null, null, null, 0],
  ['id_shared (a part record carrying a shared piece\'s id)', 422, 'id_shared', null, null, null, 0],
  ['merge 20 retitled', 200, null, null, null, 20, 1],
  ['the same file again (the skip)', 200, null, true, null, 0, 0],
  ['dry run of 20 more', 200, null, null, true, 20, 0],
  ['replace of one product with a new record', 200, null, null, null, 1, 1],
  ['full of one product, wrong expire', 409, 'expire_mismatch', null, null, null, 0],
  ['?product= COA-R00040', 200, null, null, null, null, 0],
  ['?shard= of COA-R00001', 200, null, null, null, null, 0],
  ['?shard=zz9', 400, null, null, null, null, 0],
  ['?product= unknown', 404, null, null, null, null, 0],
  ['PUT the manifest as read, removeProducts COA-R00050', 200, null, null, null, null, 1],
  ['?product= COA-R00050 after its removal', 404, null, null, null, null, 0],
  ['its record id loaded under COA-R00051 (the id freed)', 200, null, null, null, 1, 1],
  ['PUT with an index not as read', 422, null, null, null, null, 0],
  ['add 100 new products', 200, null, null, null, 100, 1],
  ['rollback undoing the add', 200, null, null, null, null, 1],
  ['reload 150 retitled', 200, null, null, null, 150, 1],
  ['rollback undoing the reload', 200, null, null, null, null, 1],
];
const rec = (k: number, product: string, extra: Record<string, unknown> = {}) => ({ ...rangeRecords(k, 1)[0]!, featuredProductIds: [product], ...extra });
/** The records of one of 36 products whose parts are each about 1.9 MiB (reading S8): 1,550 records of about 1.3 KB each, one file within the input caps. */
const bigPart = (k: number) => Array.from({ length: 1550 }, (_, i) => image(`img-big${k}-${i}`, [`COA-BIG${String(k).padStart(2, '0')}`], 'Handbags', 'studio',
  { excerpt: `Large record ${k}/${i} `.padEnd(1000, 'x') }));
const BIG_PARTS = 36;

describe('unit:P98.LD1 (R-P549, R-P551: one pack per load; calls bounded by the pack, not the product count)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): over a catalogue stored in packs, a 5,000-product file makes at most 40 storage calls at N = 40,000 and at N = 5,000, the two within 10 of each other; 100 and 1,000 new products and 5,000 changed products at most 40 each; an unchanged re-send of 5,000 products (the skip) at most 15`, async () => {
      const run = await scale(host);
      expect(run.refused, `${host}: PRECONDITION — 40,000 products load in eight files`).toBeNull();
      const calls = (row: Row | null, bound: number) => row ? [row.status, atMost(row.calls, bound)] : 'not measured';
      const diff = run.at5000 && run.at40000 ? atMost(Math.abs(run.at40000.calls - run.at5000.calls), 10) : 'not measured';
      expect.soft({ new5000At40000: calls(run.at40000, 40), new5000At5000: calls(run.at5000, 40), difference: diff, new100: calls(run.new100, 40), new1000: calls(run.new1000, 40),
        changed5000: calls(run.changed5000, 40), skip5000: run.skip5000 ? [run.skip5000.status, run.skip5000.skipped, atMost(run.skip5000.calls, 15)] : 'not measured' },
      `${host}: P98.LD1 — the calls of each load (measured: ${JSON.stringify([run.at40000?.calls, run.at5000?.calls, run.new100?.calls, run.new1000?.calls, run.changed5000?.calls, run.skip5000?.calls])}; today a load makes one exact-create per changed part and one read per touched shard)`).toEqual({
        new5000At40000: [200, 'at most 40'], new5000At5000: [200, 'at most 40'], difference: 'at most 10', new100: [200, 'at most 40'], new1000: [200, 'at most 40'],
        changed5000: [200, 'at most 40'], skip5000: [200, true, 'at most 15'] });
    }, 1_800_000);

    it(`host (${host}): a load writes one pack beside the publication's own writes (the head reservation, the revision, the set and the head commit) and the skip writes nothing; every part whose digest moved and every shard it rebuilt is inside that pack, addressed by the pack and a byte range, each object there the value its own digest names`, async () => {
      const run = await scale(host);
      expect(run.refused, `${host}: PRECONDITION — 40,000 products load in eight files`).toBeNull();
      expect.soft({ puts: [run.at40000?.puts, run.new100?.puts, run.new1000?.puts, run.changed5000?.puts, run.skip5000?.puts], newPack: run.newPack },
        `${host}: P98.LD1 — the writes of each load (today one part per changed product and one shard per moved shard: ${JSON.stringify(run.at40000?.puts)})`).toEqual({
        puts: [PUBLICATION_WRITES, PUBLICATION_WRITES, PUBLICATION_WRITES, PUBLICATION_WRITES, {}],
        newPack: { bad: [], partsElsewhere: 0, shardsElsewhere: 0, rebuilt: run.newPack?.rebuilt && run.newPack.rebuilt > 0 ? run.newPack.rebuilt : 'some shard rebuilt' } });
    }, 1_800_000);

    it(`host (${host}): the bounded rollback counts packs — undoing a 5,000-product reload at 40,000 products answers 200 within 40 calls and brings back every reloaded product's part`, async () => {
      const run = await scale(host);
      expect(run.refused, `${host}: PRECONDITION — 40,000 products load in eight files`).toBeNull();
      expect.soft({ reload: run.reload?.status ?? null, rollback: run.rollback ? [run.rollback.status, run.rollback.code, atMost(run.rollback.calls, 40)] : null, restored: run.restored },
        `${host}: P98.LD1 — the rollback (today refused 413 rollback_too_large after 774 calls: ${JSON.stringify(run.rollback)})`).toEqual({
        reload: 200, rollback: [200, null, 'at most 40'], restored: true });
    }, 1_800_000);

    it(`host (${host}): LOCK — the behaviour probe's steps answer as today (status, code, the skip, the dry run, the revision), the changed count exact (reading S4): the three refusals of an id in two places, the move with both products, the skip, the dry run, replace, full with a wrong expire, ?product=, ?shard=, the PUT round trip with removeProducts, an index not as read, the rollbacks; the page serves P80's carousel and the catalogue reads`, async () => {
      const m = await loadedTenant(host, 200);
      const seen: Step[] = [];
      const step = async (label: string, run: (h: Record<string, string>) => Promise<Answer>) => {
        const before = await revisionOf(m), h = await preconditions(m);
        const a = await run(h), after = await revisionOf(m);
        seen.push([label, a.status, (a.body.code as string | undefined) ?? null, (a.body.skipped as boolean | undefined) ?? null, (a.body.dryRun as boolean | undefined) ?? null,
          (a.body.changed as number | undefined) ?? null, after - before]);
      };
      await step(STEPS[0]![0], h => importOf(m, [rec(1, rangeProduct(2))], h));
      await step(STEPS[1]![0], h => importOf(m, [rec(1, rangeProduct(2)), { ...rangeRecords(1, 1)[0]!, id: 'img-r00001-9' }], h));
      await step(STEPS[2]![0], h => importOf(m, [{ ...MODULES[0]!, id: rangeRecordId(3) }], h));
      await step(STEPS[3]![0], h => importOf(m, [{ ...rangeRecords(4, 1)[0]!, id: MODULES[0]!.id }], h));
      const file = rangeRecords(10, 20, ' (b1)');
      await step(STEPS[4]![0], h => importOf(m, file, h));
      await step(STEPS[5]![0], h => importOf(m, file, h));
      await step(STEPS[6]![0], h => importOf(m, rangeRecords(30, 20, ' (dry)'), { 'If-Match': h['If-Match']! }, { mode: 'merge', dryRun: '1' }));
      await step(STEPS[7]![0], h => importOf(m, [{ ...rangeRecords(40, 1)[0]!, id: 'img-r00040-2' }], h, { mode: 'replace' }));
      await step(STEPS[8]![0], h => importOf(m, [{ ...rangeRecords(41, 1)[0]!, id: 'img-r00041-2' }], h, { mode: 'full', expire: '7' }));
      await step(STEPS[9]![0], () => productRead(m, rangeProduct(40)));
      await step(STEPS[10]![0], () => shardRead(m, bucketOf(rangeProduct(1))));
      await step(STEPS[11]![0], () => shardRead(m, 'zz9'));
      await step(STEPS[12]![0], () => productRead(m, 'COA-NOPE'));
      const doc = (await loadDocument(m, 'catalog')).document;
      await step(STEPS[13]![0], () => putDocument(m, 'catalog', { ...doc, removeProducts: [rangeProduct(50)] }));
      await step(STEPS[14]![0], () => productRead(m, rangeProduct(50)));
      await step(STEPS[15]![0], h => importOf(m, [rec(50, rangeProduct(51))], h));
      await step(STEPS[16]![0], () => putDocument(m, 'catalog', { ...doc, index: { ...(doc.index as Record<string, unknown>), shards: {} } }));
      const beforeAdd = await revisionOf(m);
      await step(STEPS[17]![0], h => importOf(m, rangeRecords(1000, 100), h));
      await step(STEPS[18]![0], h => asOperator(m, 'POST', `/content/catalog/rollback/${beforeAdd}?scope=${TENANT}`, {}, h));
      const beforeReload = await revisionOf(m);
      await step(STEPS[19]![0], h => importOf(m, rangeRecords(1, 150, ' (reload)'), h));
      await step(STEPS[20]![0], h => asOperator(m, 'POST', `/content/catalog/rollback/${beforeReload}?scope=${TENANT}`, {}, h));
      const s = await shopperOn(m); invalidatePublicationCache();
      const page = await snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p98-behave');
      const read = await asOperator(m, 'GET', `/content/catalog?scope=${TENANT}`);
      expect.soft({ steps: seen, page: [page.status, carousel(page)], read: read.status }, `${host}: P98.LD1 — the catalogue's behaviours as today`).toEqual({
        steps: STEPS, page: [200, SERVED_FOR_BLACK], read: 200 });
    }, 600_000);

    it(`host (${host}): a pack is at most 64 MiB — a load whose pack would pass it (36 parts of about 1.9 MiB rewritten) is refused 413 load_too_large, nothing written; the four 2 MiB refusals answer as today (part_too_large, index_shard_too_large, id_index_too_large, manifest_too_large), nothing written`, async () => {
      const refusal = async (m: Mounted, records: unknown[]) => {
        expect(withinCaps(records), 'PRECONDITION: the refused load is within the import\'s caps').toBe(true);
        const before = await revisionOf(m), { row } = await measuredLoad(m, records);
        return [row.status, row.code, row.puts, (await revisionOf(m)) === before];
      };
      // load_too_large: 36 products, each part about 1.9 MiB, then one load retitling one record of each.
      const big = await mount(host, DOCS);
      await declareProductSlots(big);
      const loaded: number[] = [];
      for (let k = 0; k < BIG_PARTS; k++) { const records = bigPart(k); expect(withinCaps(records), 'PRECONDITION: one large part is within the import\'s caps').toBe(true); loaded.push((await importOf(big, records)).status); }
      expect(loaded.every(s => s === 200), `${host}: PRECONDITION — the ${BIG_PARTS} large parts load (${loaded.join(',')})`).toBe(true);
      const tooLarge = await refusal(big, Array.from({ length: BIG_PARTS }, (_, k) => ({ ...bigPart(k)[0]!, title: 'retitled to rewrite the part' })));
      // part_too_large: one product's part past 2 MiB across two loads.
      const part = await mount(host, DOCS);
      await declareProductSlots(part);
      expect((await importOf(part, bigPart(90))).status, `${host}: PRECONDITION — a part of about 1.95 MiB loads`).toBe(200);
      const partRefused = await refusal(part, Array.from({ length: 200 }, (_, i) => image(`img-big90-more-${i}`, ['COA-BIG90'], 'Handbags', 'studio', { excerpt: 'more '.padEnd(1000, 'y') })));
      // index_shard_too_large: 6,400 products of 256 characters in bucket 00, two loads of 3,200 (P93.CS3's construction).
      const products: string[] = []; for (let k = 0; products.length < 6400; k++) { const id = `COA-CAP-${k}-`.padEnd(256, 'X'); if (bucketOf(id) === '00') products.push(id); }
      const capRecord = (id: string, product: string) => ({ id, type: 'on-model', title: 't', slotTypes: [CAROUSEL], featuredProductIds: [product] });
      const shard = await mount(host, DOCS);
      await declareProductSlots(shard);
      expect((await importOf(shard, products.slice(0, 3200).map((p, i) => capRecord(`capp-${i}`, p)))).status, `${host}: PRECONDITION — the first 3,200 load`).toBe(200);
      const shardRefused = await refusal(shard, products.slice(3200).map((p, i) => capRecord(`capp-${3200 + i}`, p)));
      // id_index_too_large: 280 record ids of 8,000 characters in bucket 00, two loads of 140.
      const ids: string[] = []; for (let k = 0; ids.length < 280; k++) { const id = `cap-record-${k}-`.padEnd(8000, 'y'); if (bucketOf(id) === '00') ids.push(id); }
      const idShard = await mount(host, DOCS);
      await declareProductSlots(idShard);
      expect((await importOf(idShard, ids.slice(0, 140).map((id, i) => capRecord(id, `COA-IDS-${i}`)))).status, `${host}: PRECONDITION — the first 140 load`).toBe(200);
      const idRefused = await refusal(idShard, ids.slice(140).map((id, i) => capRecord(id, `COA-IDS-${140 + i}`)));
      // manifest_too_large: shared pieces alone past 2 MiB, in two loads.
      const sharedRecords = (from: number) => Array.from({ length: 6000 }, (_, i) => ({ id: `shared-${from + i}`, type: 'flat-lay', title: `Shared piece ${from + i}`.padEnd(160, '.'), slotTypes: [CAROUSEL] }));
      const manifest = await mount(host, DOCS);
      await declareProductSlots(manifest);
      expect((await importOf(manifest, sharedRecords(0))).status, `${host}: PRECONDITION — the first 6,000 shared pieces load`).toBe(200);
      const manifestRefused = await refusal(manifest, sharedRecords(6000));
      expect.soft({ tooLarge, partRefused, shardRefused, idRefused, manifestRefused }, `${host}: P98.LD1 — the caps (today a load has no cap of its own: ${JSON.stringify(tooLarge)})`).toEqual({
        tooLarge: [413, 'load_too_large', {}, true], partRefused: [413, 'part_too_large', {}, true], shardRefused: [413, 'index_shard_too_large', {}, true],
        idRefused: [413, 'id_index_too_large', {}, true], manifestRefused: [413, 'manifest_too_large', {}, true] });
    }, 1_800_000);
  }
});

// ===========================================================================
// unit:P98.LD2 — 40,000 products staged in parallel and published once; no refusal from one transient failure
// ===========================================================================

/** The stages of a range: eight files of 5,000 (the first with P80's images), within today's input caps. */
const stagedFiles = (suffix = '') => Array.from({ length: 8 }, (_, k) => [...(k === 0 && !suffix ? [...ANCHOR_IMAGES, ...OTHER_IMAGES] : []), ...rangeRecords(1 + 5000 * k, 5000, suffix)]);
const keyed = (base: Record<string, string>) => ({ 'If-Match': base['If-Match']!, 'Idempotency-Key': base['Idempotency-Key']!.replace(/:.*/, `:${crypto.randomUUID()}`) });
interface StagedRun { stages: Array<[number, boolean]>; stagePuts: Record<string, number>; between: [boolean, string]; publish: Row; moved: number; total: number; publishReadsStagedPart: number; bad: string[] }
/** Eight files staged in parallel over one base, then published once; every call metered (reading S3). */
async function stagedRun(m: Mounted, files: unknown[][]): Promise<StagedRun> {
  const base = await preconditions(m), revision = await revisionOf(m);
  invalidatePublicationCache();
  const staged = await under(m, () => Promise.all(files.map(file => stageOf(m, file, keyed(base)))));
  const stages = staged.result.map(a => [a.status, typeof a.body.stage === 'string' && a.body.stage.length > 0] as [number, boolean]);
  const between: [boolean, string] = [(await revisionOf(m)) === revision, await statusOf(m)];
  invalidatePublicationCache();
  const published = await under(m, () => publishOf(m, staged.result.map(a => a.body.stage), keyed(base)));
  // Where the staged parts live (the final revision's part places in the stages' packs), and whether the publish read any of those bytes.
  const stagePacks = new Set(staged.meter.calls.filter(c => c.op === 'put' && c.cls === 'pack' && !c.failed).map(c => packDigest(c.key)));
  const resolved = resolve(m, (await loadDocument(m, 'catalog')).document);
  const parts = resolved.places.filter(p => p.kind === 'part' && p.place && stagePacks.has(p.place.pack)).map(p => p.place!);
  const reads = published.meter.calls.filter(c => c.op === 'get' && c.cls === 'pack' && stagePacks.has(packDigest(c.key)));
  const overlaps = reads.filter(c => parts.some(p => p.pack === packDigest(c.key) && (!c.range || (c.range.offset < p.at + p.bytes && (c.range.length < 0 || c.range.offset + c.range.length > p.at))))).length;
  return { stages, stagePuts: tally(staged.meter.calls, 'put'), between, publish: rowOf(published.result, published.meter), moved: (await revisionOf(m)) - revision,
    total: staged.meter.calls.length + published.meter.calls.length,
    publishReadsStagedPart: overlaps, bad: resolved.bad };
}
const stagedExpected = (n: number) => ({ stages: Array.from({ length: n }, () => [200, true]), stagePuts: { 'put pack': n }, between: [true, 'idle'],
  publish: [200, PUBLICATION_WRITES], moved: 1, total: 'at most 250', publishReadsStagedPart: 0, bad: [] });
const stagedSeen = (run: StagedRun) => ({ stages: run.stages, stagePuts: run.stagePuts, between: run.between, publish: [run.publish.status, run.publish.puts], moved: run.moved,
  total: atMost(run.total, 250), publishReadsStagedPart: run.publishReadsStagedPart, bad: run.bad });
/** A service token with the catalogue-import role only (reading S7), signed with the parity mount's own operator signing material. */
const catalogueToken = () => new SignJWT({ sub: 'ops', type: 'service', roles: ['catalog-import'] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
  .setIssuer('i').setAudience('a').setExpirationTime('2h').sign(new TextEncoder().encode('parity-synthetic-operator-signing-material'));

describe('unit:P98.LD2 (R-P549 C2: files staged in parallel and published once; one transient failure never refuses a load)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): 40,000 products as eight staged files of 5,000 sent in parallel, then published once, make at most 250 storage calls and one publication (one head reservation, one commit); each stage writes its pack and publishes nothing; the publish reads no staged part; every product reads back and the page serves P80's carousel; the nightly reload of all 40,000 the same way`, async () => {
      const m = await mount(host, DOCS_WITH_CART);
      expectPublished(m, 'P98.LD2 — the tenant documents publish');
      await declareProductSlots(m);
      const first = await stagedRun(m, stagedFiles());
      const reads = await Promise.all([1, 20000, 40000].map(async k => { const a = await productRead(m, rangeProduct(k)); return [a.status, readIds(a)]; }));
      const s = await shopperOn(m); invalidatePublicationCache();
      const page = await snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p98-staged');
      const nightly = await stagedRun(m, stagedFiles(' (p98 nightly)'));
      const title = ((await productRead(m, rangeProduct(20000))).body.document as { pieces?: Array<{ title?: string }> } | undefined)?.pieces?.[0]?.title ?? null;
      expect.soft({ first: stagedSeen(first), reads, page: [page.status, carousel(page)], nightly: stagedSeen(nightly), title },
        `${host}: P98.LD2 — the staged load (today there is no stage door: ${JSON.stringify(first.stages.slice(0, 2))}; calls ${first.total} and ${nightly.total})`).toEqual({
        first: stagedExpected(8), reads: [1, 20000, 40000].map(k => [200, [rangeRecordId(k)]]), page: [200, SERVED_FOR_BLACK], nightly: stagedExpected(8),
        title: rangeRecords(20000, 1, ' (p98 nightly)')[0]!.title });
    }, 1_800_000);

    it(`host (${host}): the publish runs the refusals of an id in two places across the stages, as one file of the same records would: a record moved between two stages' products is accepted, record_moved and id_in_part across stages are refused, nothing published; each stage alone over the base is accepted`, async () => {
      const cases: Array<[string, unknown[][], number, string | null]> = [
        ['a move across stages (the source product in the other stage)', [[rec(1, rangeProduct(2))], [{ ...rangeRecords(1, 1)[0]!, id: 'img-r00001-9' }]], 200, null],
        ['record_moved across stages (no stage carries the source product)', [[rec(3, rangeProduct(4))], rangeRecords(10, 1)], 422, 'record_moved'],
        ['id_in_part across stages (a shared piece and a part record with one new id)', [[{ ...MODULES[0]!, id: 'p98-one-place' }], [{ ...rangeRecords(20, 1)[0]!, id: 'p98-one-place' }]], 422, 'id_in_part'],
      ];
      const seen: unknown[] = [], wanted: unknown[] = [];
      for (const [label, files, status, code] of cases) {
        const staged = await loadedTenant(host, 200), oneFile = await loadedTenant(host, 200);
        const base = await preconditions(staged), before = await revisionOf(staged);
        const stages = [];
        for (const file of files) stages.push(await stageOf(staged, file, keyed(base)));
        const published = await publishOf(staged, stages.map(a => a.body.stage), keyed(base));
        const single = await importOf(oneFile, files.flat());
        const owner = label.startsWith('a move') ? indexOf(staged, (await loadDocument(staged, 'catalog')).document).ids['img-r00001-1'] ?? null : null;
        seen.push([label, stages.map(a => a.status), [published.status, (published.body.code as string | undefined) ?? null], (await revisionOf(staged)) - before, owner]);
        wanted.push([label, files.map(() => 200), [single.status, (single.body.code as string | undefined) ?? null], status === 200 ? 1 : 0, label.startsWith('a move') ? rangeProduct(2) : null]);
        expect([single.status, single.body.code ?? null], `${host}: PRECONDITION — one file of the same records answers ${status} ${code}`).toEqual([status, code]);
      }
      expect.soft(seen, `${host}: P98.LD2 — the refusals across the stages, as one file (today there is no stage door)`).toEqual(wanted);
    }, 600_000);

    it(`host (${host}): no load, stage or publish is refused for one transient failure of a safe-to-repeat call — each GET and HEAD, the pack's exact-create (thrown, or landed then thrown and adopted), the revision and set exact-creates, a read after the reservation or after the commit — each repeated once; the head's compare-and-set is never re-sent blindly: a reservation or commit that landed then threw, or a commit that threw, is finished in the request; a lost race answers 409 with one reservation attempted`, async () => {
      const m = await loadedTenant(host, 600);
      let next = 700;
      const fresh = () => { const r = rangeRecords(next, 10); next += 10; return r; };
      const isPackPut = (c: Call) => c.op === 'put' && c.cls === 'pack';
      const faults: Array<[string, Rule, boolean]> = [
        ['the first read of the head', failFirst(c => c.op === 'get' && c.cls === 'head'), false],
        ['a read of the set', failFirst(c => c.op === 'get' && c.cls === 'set'), false],
        ['a read of the content revision', failFirst(c => c.op === 'get' && c.cls === 'content revision'), false],
        ['a ranged read of a pack (the base shards)', failFirst(c => c.op === 'get' && c.cls === 'pack' && !!c.range), true],
        ['the pack exact-create, thrown', failFirst(isPackPut), true],
        ['the pack exact-create, landed then thrown (adopted)', failFirst(isPackPut, 1, 'land-then-throw'), true],
        ['the HEAD that adopts the pack', (() => { const put = failFirst(isPackPut, 1, 'land-then-throw'), head = failFirst(c => c.op === 'head' && c.cls === 'pack');
          return (c: Call, st: Meter) => put(c, st) ?? head(c, st); })(), true],
        ['the revision exact-create', failFirst(c => c.op === 'put' && c.cls === 'content revision'), true],
        ['the set exact-create', failFirst(c => c.op === 'put' && c.cls === 'set'), true],
        ['the head read after the reservation', failFirst((c, st) => c.op === 'get' && c.cls === 'head' && st.phase === 'reserved'), false],
        ['the reservation, landed then thrown', failFirst(c => c.head === 'reservation', 1, 'land-then-throw'), false],
        ['the commit, thrown', failFirst(c => c.head === 'commit'), false],
        ['the commit, landed then thrown', failFirst(c => c.head === 'commit', 1, 'land-then-throw'), false],
        ['a read after the commit', failFirst((c, st) => c.op === 'get' && st.phase === 'committed'), false],
      ];
      const seen: unknown[] = [], wanted: unknown[] = [];
      for (const [label, rule, single] of faults) {
        const before = await revisionOf(m), { row, meter: st } = await measuredLoad(m, fresh(), { mode: 'merge' }, rule);
        const failed = st.failed.at(-1);
        seen.push([label, row.status, (await revisionOf(m)) - before, st.failed.length > 0, single ? attemptsOf(st, failed) : 'n/a', await statusOf(m)]);
        wanted.push([label, 200, 1, true, single ? 2 : 'n/a', 'idle']);
      }
      // On a stage and on the publish.
      const base = await preconditions(m), before = await revisionOf(m);
      invalidatePublicationCache();
      const stage = await under(m, () => stageOf(m, fresh(), keyed(base)), failFirst(isPackPut));
      const other = await stageOf(m, fresh(), keyed(base));
      invalidatePublicationCache();
      const publish = await under(m, () => publishOf(m, [stage.result.body.stage, other.body.stage], keyed(base)),
        (() => { const read = failFirst(c => c.op === 'get' && c.cls === 'pack'), commit = failFirst(c => c.head === 'commit'); return (c: Call, st: Meter) => read(c, st) ?? commit(c, st); })());
      seen.push(['a stage whose pack exact-create threw once', stage.result.status, attemptsOf(stage.meter, stage.meter.failed.at(-1))],
        ['a publish whose first pack read and whose commit each threw once', publish.result.status, publish.meter.failed.length, (await revisionOf(m)) - before, await statusOf(m)]);
      wanted.push(['a stage whose pack exact-create threw once', 200, 2], ['a publish whose first pack read and whose commit each threw once', 200, 2, 1, 'idle']);
      // A lost race: the reservation's precondition fails.
      const raced = await measuredLoad(m, fresh(), { mode: 'merge' }, failFirst(c => c.head === 'reservation', 1, 'null'));
      seen.push(['a lost race', raced.row.status, raced.row.code, raced.meter.calls.filter(c => c.head === 'reservation').length, await statusOf(m)]);
      wanted.push(['a lost race', 409, 'publication_conflict', 1, 'idle']);
      // A reservation that threw before it landed: re-read, and either retried against the same etag (200) or answered nothing_written.
      const thrown = await measuredLoad(m, fresh(), { mode: 'merge' }, failFirst(c => c.head === 'reservation'));
      const outcome = [thrown.row.status, thrown.row.status === 200 ? 'committed' : thrown.answer.body.state ?? null, await statusOf(m)];
      seen.push(['a reservation thrown before it landed', [[200, 'committed', 'idle'], [503, 'nothing_written', 'idle']].some(o => JSON.stringify(o) === JSON.stringify(outcome)) ? 'matches the store' : outcome]);
      wanted.push(['a reservation thrown before it landed', 'matches the store']);
      expect.soft(seen, `${host}: P98.LD2 — one transient failure of each safe call (today nothing is repeated: ${JSON.stringify(seen.slice(0, 3))})`).toEqual(wanted);
      expect.soft(resolve(m, (await loadDocument(m, 'catalog')).document).bad, `${host}: P98.LD2 — every object the revision names resolves`).toEqual([]);
    }, 600_000);

    it(`host (${host}): R-P569 (c) — on the customer profile (the stamps' boundary) the stage and publish doors admit the catalogue-import credential as on the parity mount; what the customer boundary refuses stays refused (another method or path, another kind's stage, the catalogue PUT with that credential)`, async () => {
      const s = await stamp(host, 'customer');
      expect(s.refused ?? 'ready', `PRECONDITION (${host}): the stamp's tenant has its first publication set (${s.refused})`).toBe('ready');
      // The stamp's recording double (src/units/P87/_stamp.ts RecordingR2.get) drops a read's range; this leg's own copy honours it.
      Object.defineProperty(s.storage, 'get', { configurable: true, writable: true, value: (key: string, options?: { range?: { offset?: number; length?: number } }) => {
        s.rec.calls.push('r2 get ' + key); return UnitR2.prototype.get.call(s.storage, key, options);
      } });
      const registered = await s.call('POST', '/auth/service-credentials', { body: { id: crypto.randomUUID(), subject: 'p98-load-job', role: 'catalog-import', expiresAt: Math.floor(Date.now() / 1000) + 86_400 } });
      const token = typeof registered.body.token === 'string' ? registered.body.token : '';
      expect([registered.status, token.length > 0], `${host}: PRECONDITION — a catalogue-import credential is registered (${JSON.stringify(registered.body).slice(0, 200)})`).toEqual([201, true]);
      const base = async (as?: string) => {
        const d = await s.call('GET', '/content/catalog', { token: as }), publication = (d.body.publication ?? {}) as { revision?: number; digest?: string };
        return { 'If-Match': `"${String(d.body.revision)}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${String(d.body.revision)}:${crypto.randomUUID()}` };
      };
      const declared = await s.call('PUT', '/content/catalog', { body: { document: { version: 'p98-stamp', productSlots: [CAROUSEL], pieces: [] }, note: 'p98 product slots' }, headers: await base() });
      expect(declared.status, `${host}: PRECONDITION — the catalogue declares its product slots (${JSON.stringify(declared.body).slice(0, 200)})`).toBe(200);
      const over = await base(token);
      const staged = await s.call('POST', '/content/catalog/stage?mode=merge', { token, body: rangeRecords(1, 5), headers: over });
      const published = await s.call('POST', '/content/catalog/publish', { token, body: { stages: [staged.body.stage] }, headers: keyed(over) });
      const read = await s.call('GET', `/content/catalog?product=${rangeProduct(3)}`, { token });
      const refused = [];
      for (const [method, path] of [['GET', '/content/catalog/stage'], ['POST', '/content/catalog/stage/more'], ['POST', '/content/slots/stage'], ['POST', '/content/catalog/publish/more']] as const) {
        refused.push((await s.call(method, path, { token, body: method === 'POST' ? {} : undefined })).status);
      }
      const put = await s.call('PUT', '/content/catalog', { token, body: { document: { version: 'p98-stamp', productSlots: [CAROUSEL], pieces: [] } }, headers: await base(token) });
      expect.soft({ staged: [staged.status, typeof staged.body.stage === 'string'], published: published.status, read: [read.status, readIds(read)], refused, put: [put.status, put.body.code ?? null] },
        `${host}: P98.LD2 — the two doors on the customer profile (today the boundary has no stage or publish door: ${staged.status} | ${published.status})`).toEqual({
        staged: [200, true], published: 200, read: [200, [rangeRecordId(3)]], refused: [404, 404, 404, 404], put: [403, 'catalog_credential'] });
    }, 300_000);

    it(`host (${host}): the stage and publish doors admit the catalogue-import credential as the import does (a PUT with it is still refused 403 catalog_credential)`, async () => {
      const m = await loadedTenant(host, 50), token = await catalogueToken();
      const base = await preconditions(m), as = { Authorization: `Bearer ${token}` };
      const imported = await asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}&mode=merge`, rangeRecords(60, 1), { ...keyed(base), ...as });
      const base2 = await preconditions(m);
      const staged = await asOperator(m, 'POST', `/content/catalog/stage?scope=${TENANT}&mode=merge`, rangeRecords(61, 1), { ...keyed(base2), ...as });
      const published = await asOperator(m, 'POST', `/content/catalog/publish?scope=${TENANT}`, { stages: [staged.body.stage] }, { ...keyed(base2), ...as });
      const put = await asOperator(m, 'PUT', `/content/catalog?scope=${TENANT}`, { document: (await loadDocument(m, 'catalog')).document }, { ...keyed(await preconditions(m)), ...as });
      expect.soft({ imported: imported.status, staged: staged.status, published: published.status, put: [put.status, put.body.code ?? null] },
        `${host}: P98.LD2 — the catalogue credential on the two doors (${show(staged)} | ${show(published)})`).toEqual({
        imported: 200, staged: 200, published: 200, put: [403, 'catalog_credential'] });
    }, 300_000);
  }
});

// ===========================================================================
// unit:P98.LD3 — a product page at any size: 8 reads cold, 1 warm, its shard and part by byte range
// ===========================================================================

describe('unit:P98.LD3 (R-P549: the page reads its shard and part from the pack by byte range)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): at N = 40,000 the anchor's page reads at most 8 objects cold (122,880 bytes or fewer) and 1 warm, its shard and its part each by one ranged read of a pack, and serves P80's carousel; the pack holding its part lost, the page answers 503 part_unavailable`, async () => {
      const run = await scale(host);
      expect(run.refused, `${host}: PRECONDITION — 40,000 products load in eight files`).toBeNull();
      expect.soft({ page: run.page40000 ? pageSeen(run.page40000, 122880) : 'not measured', lost: run.lost },
        `${host}: P98.LD3 — the page at 40,000 (today its shard and part are objects of their own: ${JSON.stringify(run.page40000)})`).toEqual({
        page: PAGE_EXPECTED(122880), lost: [503, true] });
    }, 1_800_000);

    it(`host (${host}): R-P569 (b) — at N = 40,000 in packs the manifest every cold page reads stays within 64 KB beside its shared pieces (P93.CS1's delivered bound; the pointers name their pack by the table)`, async () => {
      const run = await scale(host);
      expect(run.refused, `${host}: PRECONDITION — 40,000 products load in eight files`).toBeNull();
      const seen = run.manifest ? { inPacks: run.manifest.packs > 0, beside: atMost(run.manifest.bytes - run.manifest.shared, 65536) } : 'not measured';
      expect.soft(seen, `${host}: P98.LD3 — the manifest at 40,000 (${JSON.stringify(run.manifest)})`).toEqual({ inPacks: true, beside: 'at most 65536' });
    }, 1_800_000);

    it(`host (${host}): at N = 50 and N = 5,000 the anchor's page reads at most 8 objects cold and 1 warm, its shard and part each by one ranged read of a pack, and serves P80's carousel`, async () => {
      const rows: unknown[] = [];
      for (const n of [50, 5000]) rows.push(pageSeen(await pageOf(await loadedTenant(host, n), `p98-page-${n}`)));
      expect.soft(rows, `${host}: P98.LD3 — the page at 50 and 5,000`).toEqual([PAGE_EXPECTED(), PAGE_EXPECTED()]);
    }, 900_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}): LOCK (R-P578 (b), R-P582) — integrity is not traded for size: two products' part pointers swapped in a stored shard (its name, its product count and its length kept) are refused as today, read from a pack by its range as from an object of its own — the product's read answers 503 part_unavailable, never the other product's records`, async () => {
      // Today (publication.ts readCatalogShard :851–861): a shard is checked against the digest its pointer names, so an
      // altered shard is refused 503 part_unavailable (measured on today's tree by this leg).
      const m = await loadedTenant(host, 600), view = indexOf(m, (await loadDocument(m, 'catalog')).document);
      let swapped: { product: string; other: string; where: string } | null = null;
      for (const [name, pointer] of Object.entries(view.shards)) {
        if (swapped) break;
        const place = view.places?.shards[name], where = place ? KEY.pack(place.pack) : KEY.shard(pointer.digest), raw = m.storage.objects.get(where);
        if (raw === undefined) continue;
        const bytes = Buffer.from(raw, 'utf8'), at = place?.at ?? 0, length = place?.bytes ?? bytes.length, text = bytes.subarray(at, at + length).toString('utf8');
        const entries = [...text.matchAll(/"(COA-R\d{5})":(\{[^{}]*\})/g)];
        for (let a = 0; a < entries.length && !swapped; a++) for (let b = a + 1; b < entries.length && !swapped; b++) {
          const [ea, eb] = [entries[a]!, entries[b]!];
          if (ea[2]!.length !== eb[2]!.length || ea[2] === eb[2]) continue;
          const altered = text.slice(0, ea.index! + ea[1]!.length + 3) + eb[2] + text.slice(ea.index! + ea[0].length, eb.index! + eb[1]!.length + 3) + ea[2] + text.slice(eb.index! + eb[0].length);
          bytes.write(altered, at, 'utf8'); m.storage.objects.set(where, bytes.toString('utf8')); invalidatePublicationCache();
          swapped = { product: ea[1]!, other: eb[1]!, where };
        }
      }
      expect(swapped, `${host}: PRECONDITION — a shard holds two products whose part pointers have the same length`).not.toBeNull();
      const read = await productRead(m, swapped!.product);
      expect.soft([read.status, read.body.code ?? (JSON.stringify(read.body).includes('part_unavailable') ? 'part_unavailable' : null), readIds(read).includes(rangeRecordId(Number(swapped!.other.slice(5))))],
        `${host}: P98.LD3 — an altered shard refused as today (${show(read)})`).toEqual([503, 'part_unavailable', false]);
    }, 300_000);
  }

  it('host (session): at N = 100,000 the anchor\'s page reads at most 8 objects cold and 1 warm, its shard and part each by one ranged read of a pack, and serves P80\'s carousel', async () => {
    const m = await loadedTenant('session', 100000);
    expect.soft(pageSeen(await pageOf(m, 'p98-page-100000')), 'session: P98.LD3 — the page at 100,000').toEqual(PAGE_EXPECTED());
  }, 1_800_000);
});

// ===========================================================================
// unit:P98.LD4 — the 503 names its cause and the state it left
// ===========================================================================

/** The 503's members (reading S2), what it must never carry, and the store's own state. */
async function named503(m: Mounted, answer: Answer, st: Meter) {
  const failing = st.failed.at(-1);
  return { status: answer.status, code: answer.body.code ?? null, operation: answer.body.operation ?? null, objectKind: answer.body.objectKind ?? null,
    storageStatus: answer.body.storageStatus ?? null, state: answer.body.state ?? null, leaked: leaked(answer, failing, m.operatorToken), attempts: attemptsOf(st, failing),
    store: await statusOf(m) };
}
const expected503 = (failing: Call | undefined, state: string, storageStatus: number | null, store: string) => ({ status: 503, code: 'publication_unavailable',
  operation: failing?.op ?? 'a failed call', objectKind: failing ? objectKindOf(failing.cls) : 'a failed call', storageStatus, state, leaked: [], attempts: 2, store });

describe('unit:P98.LD4 (R-P549 §6: the 503 names the operation, the object kind, the storage status and the state)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): nothing_written — a ranged pack read failing twice, and the pack's exact-create failing twice (without a storage number), answer 503 publication_unavailable naming the operation and the object kind, state nothing_written, never a key, a path, a digest, the credential or the storage error's words; nothing pending; the same file re-sent is accepted`, async () => {
      const m = await loadedTenant(host, 600);
      const read = await measuredLoad(m, rangeRecords(700, 10), { mode: 'merge' }, failFirst(c => c.op === 'get' && c.cls === 'pack' && !!c.range, 2));
      const readSeen = await named503(m, read.answer, read.meter), readPacks = read.row.puts['put pack'] ?? 0;
      const again = await importOf(m, rangeRecords(700, 10));
      const write = await measuredLoad(m, rangeRecords(710, 10), { mode: 'merge' }, failFirst(c => c.op === 'put' && c.cls === 'pack', 2, 'throw-bare'));
      const writeSeen = await named503(m, write.answer, write.meter);
      expect.soft({ read: readSeen, readPacks, again: again.status, write: writeSeen }, `${host}: P98.LD4 — nothing written (today: ${show(read.answer)})`).toEqual({
        read: expected503(read.meter.failed.at(-1), 'nothing_written', STORAGE_NUMBER, 'idle'), readPacks: 0, again: 200,
        write: expected503(write.meter.failed.at(-1), 'nothing_written', null, 'idle') });
    }, 600_000);

    it(`host (${host}): a pack exact-create that landed and threw, its repeat failing too, answers 503 nothing_written and leaves exactly one pack no revision names; nothing pending`, async () => {
      const m = await loadedTenant(host, 600);
      const packsBefore = storedPacks(m);
      let attempt = 0;
      const answered = await measuredLoad(m, rangeRecords(700, 10), { mode: 'merge' }, c => c.op === 'put' && c.cls === 'pack' ? (++attempt === 1 ? 'land-then-throw' : 'throw') : undefined);
      const left = storedPacks(m).filter(k => !packsBefore.includes(k)), named = new Set(packTable((await loadDocument(m, 'catalog')).document).map(d => KEY.pack(d)));
      expect.soft({ answer: await named503(m, answered.answer, answered.meter), left: left.length, unnamed: left.filter(k => !named.has(k)).length },
        `${host}: P98.LD4 — one unnamed pack (today: ${show(answered.answer)})`).toEqual({
        answer: expected503(answered.meter.failed.at(-1), 'nothing_written', STORAGE_NUMBER, 'idle'), left: 1, unnamed: 1 });
    }, 600_000);

    it(`host (${host}): pending — a commit that fails on every attempt answers 503 naming put and head, state pending; the publication's status reads pending; POST /content/catalog/publication/recover with the same headers finishes it (200) and the same file re-sent is then the skip; the same for a publish of stages`, async () => {
      const m = await loadedTenant(host, 600);
      const before = await revisionOf(m);
      const load = await measuredLoad(m, rangeRecords(700, 10), { mode: 'merge' }, c => c.head === 'commit' ? 'throw' : undefined);
      const loadSeen = await named503(m, load.answer, load.meter), loadFailing = load.meter.failed.at(-1);
      const recovered = await recoverOf(m, load.headers), skip = await importOf(m, rangeRecords(700, 10));
      const base = await preconditions(m);
      const stage = await stageOf(m, rangeRecords(720, 10), keyed(base));
      invalidatePublicationCache();
      const publish = await under(m, () => publishOf(m, [stage.body.stage], { ...keyed(base) }), c => c.head === 'commit' ? 'throw' : undefined);
      const publishSeen = await named503(m, publish.result, publish.meter);
      expect.soft({ load: { ...loadSeen, attempts: loadSeen.attempts >= 1 ? 'repeated or not' : loadSeen.attempts }, recovered: recovered.status, skip: [skip.status, skip.body.skipped ?? null],
        revisions: (await revisionOf(m)) - before, publish: { ...publishSeen, attempts: publishSeen.attempts >= 1 ? 'repeated or not' : publishSeen.attempts } },
      `${host}: P98.LD4 — pending (today: ${show(load.answer)})`).toEqual({
        load: { ...expected503(loadFailing, 'pending', STORAGE_NUMBER, 'pending'), attempts: 'repeated or not' }, recovered: 200, skip: [200, true], revisions: 1,
        publish: { ...expected503(publish.meter.failed.at(-1), 'pending', STORAGE_NUMBER, 'pending'), attempts: 'repeated or not' } });
    }, 600_000);

    it(`host (${host}): committed — every read of the head, the set and the content revision after the commit landed failing answers 503 naming get and that object's kind, state committed; the revision moved and nothing is pending; the same file re-sent is the skip`, async () => {
      const m = await loadedTenant(host, 600);
      const before = await revisionOf(m);
      const load = await measuredLoad(m, rangeRecords(700, 10), { mode: 'merge' }, (c, st) => c.op === 'get' && st.phase === 'committed' && ['head', 'set', 'content revision'].includes(c.cls) ? 'throw' : undefined);
      const seen = await named503(m, load.answer, load.meter), moved = (await revisionOf(m)) - before, skip = await importOf(m, rangeRecords(700, 10));
      expect.soft({ answer: seen, moved, skip: [skip.status, skip.body.skipped ?? null] }, `${host}: P98.LD4 — committed (today: ${show(load.answer)})`).toEqual({
        answer: expected503(load.meter.failed.at(-1), 'committed', STORAGE_NUMBER, 'idle'), moved: 1, skip: [200, true] });
    }, 600_000);

    it(`host (${host}): a stage whose pack exact-create fails twice answers 503 put pack, state nothing_written, and publishes nothing`, async () => {
      const m = await loadedTenant(host, 600);
      const base = await preconditions(m), before = await revisionOf(m);
      invalidatePublicationCache();
      const stage = await under(m, () => stageOf(m, rangeRecords(700, 10), keyed(base)), failFirst(c => c.op === 'put' && c.cls === 'pack', 2));
      expect.soft({ answer: await named503(m, stage.result, stage.meter), moved: (await revisionOf(m)) - before }, `${host}: P98.LD4 — a stage (today there is no stage door: ${show(stage.result)})`).toEqual({
        answer: expected503(stage.meter.failed.at(-1), 'nothing_written', STORAGE_NUMBER, 'idle'), moved: 0 });
    }, 300_000);

    it(`host (${host}): LOCK — the absent-member refusal keeps its body byte for byte (a four-member set's priors read)`, async () => {
      const m = await mount(host, DOCS);
      m.storage.objects.clear(); m.storage.versions.clear(); m.storage.metadata.clear(); invalidatePublicationCache();
      const at = Date.now(), revision = (value: unknown, note: string) => ({ revision: 1, value, actor: 'ops', note, at });
      await initializePublicationSet(m.env, [
        { kind: CONTENT_KIND, scope: TENANT, revision: revision({ version: 'p98-four', pieces: MODULES }, 'demo scope bootstrap: catalog') },
        { kind: SLOTS_KIND, scope: TENANT, revision: revision(DOCS.slots, 'demo scope bootstrap: slots') },
        { kind: LEARN_KIND, scope: TENANT, revision: revision(DOCS.learn, 'demo scope bootstrap: learn') },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(TENANT), revision: revision(REFLEX_DOCUMENT, 'demo scope bootstrap: reflex') },
      ] as Parameters<typeof initializePublicationSet>[1], `0:${crypto.randomUUID()}`);
      invalidatePublicationCache();
      const priors = await asOperator(m, 'GET', `/content/priors?scope=${TENANT}`);
      expect([priors.status, priors.body], `${host}: P98.LD4 — LOCK (P48.BP2, P54.CP2): the absent member's refusal`).toEqual([503, { ok: false,
        error: 'Configuration publication authority unavailable: priors is not in this tenant\'s publication set; add it with POST /ops/demo-bootstrap/complete, which adds its compiled empty once and changes no other member',
        code: 'publication_unavailable' }]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P98.LD5 — the changed count is exact on a fresh and on a warm isolate
// ===========================================================================

const FIVE = 'COA-X00001';
const fiveRecords = () => [1, 2, 3, 4, 5].map(i => image(`img-x00001-${i}`, [FIVE], 'Handbags', SHOTS[i % 4]!));
/** The same record with its fields in the reverse order (an unchanged record, sent otherwise). */
const reversed = (record: Rec) => Object.fromEntries(Object.entries(record).reverse());

describe('unit:P98.LD5 (S42 §4: the changed count compares records whatever the order of their fields)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a product of five records in a pack — one record retitled answers changed 1 on a warm isolate and on a fresh one, in the committed answer and in the dry run, an unchanged record sent with its fields in another order counted as unchanged`, async () => {
      const m = await mount(host, DOCS_WITH_CART);
      await declareProductSlots(m);
      const recs = fiveRecords();
      expect((await importOf(m, [...recs, ...rangeRecords(1, 20)])).status, `${host}: PRECONDITION — the five records load`).toBe(200);
      const title = (i: number, t: string) => ({ ...recs[i]!, title: t });
      const warm = await importOf(m, [title(1, 'retitled warm')]);
      const warmDry = await importOf(m, [title(2, 'retitled warm, dry')], { 'If-Match': (await preconditions(m))['If-Match']! }, { mode: 'merge', dryRun: '1' });
      const headers = await preconditions(m); invalidatePublicationCache();
      const cold = await importOf(m, [title(3, 'retitled cold'), reversed(recs[4]!) as Rec], headers);
      const dryHeaders = await preconditions(m); invalidatePublicationCache();
      const coldDry = await importOf(m, [title(4, 'retitled cold, dry')], { 'If-Match': dryHeaders['If-Match']! }, { mode: 'merge', dryRun: '1' });
      expect.soft({ warm: [warm.status, warm.body.changed], warmDry: [warmDry.status, warmDry.body.changed], cold: [cold.status, cold.body.changed], coldDry: [coldDry.status, coldDry.body.changed] },
        `${host}: P98.LD5 — the exact count (today a fresh isolate counts every record of the product: ${show(cold)})`).toEqual({
        warm: [200, 1], warmDry: [200, 1], cold: [200, 1], coldDry: [200, 1] });
    }, 300_000);

    it(`host (${host}): a product of five records whose part is still an object of its own (stored before packs) — one record retitled answers changed 1 in the dry run and the committed answer on a fresh isolate`, async () => {
      const { m } = await shardedTenant(host, [...fiveRecords(), ...rangeRecords(1, 20)]);
      const headers = await preconditions(m); invalidatePublicationCache();
      const dry = await importOf(m, [{ ...fiveRecords()[1]!, title: 'retitled, dry' }], { 'If-Match': headers['If-Match']! }, { mode: 'merge', dryRun: '1' });
      invalidatePublicationCache();
      const committed = await importOf(m, [{ ...fiveRecords()[2]!, title: 'retitled' }], headers);
      expect.soft({ dry: [dry.status, dry.body.changed], committed: [committed.status, committed.body.changed] }, `${host}: P98.LD5 — a part of its own (${show(committed)})`).toEqual({
        dry: [200, 1], committed: [200, 1] });
    }, 300_000);
  }
});

// ===========================================================================
// unit:P98.LD6 — nothing left that the pack-aware purge does not collect; nothing collected that a revision needs
// ===========================================================================

/** Every pack any stored content revision names (its table, or through a pointer), and the pending set's when the head holds one. */
function namedPacks(m: Mounted): Set<string> {
  const out = new Set<string>(), values: Array<Record<string, unknown>> = [];
  for (const [key, raw] of m.storage.objects) if (/\/content\/rev\/[0-9]+\.json$/.test(key)) values.push((JSON.parse(raw) as { value?: Record<string, unknown> }).value ?? {});
  const head = m.storage.objects.get(`config-publication/v2/${TENANT}/head.json`);
  const pending = head ? (JSON.parse(head) as { pending?: { documents?: Array<{ kind?: string; value?: Record<string, unknown> }> } | null }).pending : null;
  for (const document of pending?.documents ?? []) if (document.kind === 'content' && document.value) values.push(document.value);
  for (const value of values) {
    for (const digest of packTable(value)) out.add(KEY.pack(digest));
    for (const pack of reached(m, value).keys()) out.add(KEY.pack(pack));
  }
  return out;
}
const unnamedPacks = (m: Mounted) => { const named = namedPacks(m); return storedPacks(m).filter(k => !named.has(k)); };
/** One small publication (a one-record retitle of the anchor's first image), its answer required. */
let retouch = 0;
async function publication(m: Mounted, what: string): Promise<void> {
  const a = await importOf(m, [{ ...ANCHOR_IMAGES[0]!, title: `${ANCHOR_IMAGES[0]!.title}, retouch ${++retouch}` }]);
  expect(a.status, `PRECONDITION: ${what} — a publication is accepted (${show(a)})`).toBe(200);
}

describe('unit:P98.LD6 (R-P549 §4: the pack-aware purge; R-P546: never collect what a load in flight reuses)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a refused load's pack and a stage never published are kept within the 15-minute grace and collected past it by the next publications, which read no shard and leave every pack a stored revision names`, async () => {
      const run = async (minutes: number) => {
        const m = await loadedTenant(host, 300);
        shortRetention(m);
        const restore = uploadedAt(m, minutesAgo(minutes));
        try {
          let attempt = 0;
          const refused = await measuredLoad(m, rangeRecords(400, 20), { mode: 'merge' }, c => c.op === 'put' && c.cls === 'pack' ? (++attempt === 1 ? 'land-then-throw' : 'throw') : undefined);
          const stage = await stageOf(m, rangeRecords(500, 20));
          const left = unnamedPacks(m);
          const purges: Meter[] = [];
          for (let i = 0; i < 4; i++) { const st = meter(m); try { await publication(m, `publication ${i + 1}`); } finally { st.restore(); } purges.push(st); }
          const afterCommit = purges.flatMap(st => st.calls.filter(c => c.phase === 'committed'));
          return { refused: refused.row.status, staged: stage.status, left: left.length, stillThere: left.filter(k => m.storage.objects.has(k)).length,
            shardReads: afterCommit.filter(c => c.op === 'get' && (['shard', 'idshard', 'part'].includes(c.cls) || (c.cls === 'pack' && !!c.range))).length,
            lost: [...namedPacks(m)].filter(k => !m.storage.objects.has(k)), bad: resolve(m, (await loadDocument(m, 'catalog')).document).bad };
        } finally { restore(); }
      };
      const within = await run(14), past = await run(16);
      expect.soft({ within, past }, `${host}: P98.LD6 — the grace and the collection (today a refused load's objects are never collected)`).toEqual({
        within: { refused: 503, staged: 200, left: 2, stillThere: 2, shardReads: 0, lost: [], bad: [] },
        past: { refused: 503, staged: 200, left: 2, stillThere: 0, shardReads: 0, lost: [], bad: [] } });
    }, 600_000);

    it(`host (${host}): a pack the pending set names is never deleted — a second writer reserving between a publication's commit and its purge (its revision's exact-create then failing, so only the pending set names its pack) keeps its pack though it is past the grace; recovered, its products read back`, async () => {
      const m = await loadedTenant(host, 300);
      shortRetention(m);
      const restore = uploadedAt(m, minutesAgo(60));
      let other: { stage: Answer; headers: Record<string, string>; pack: string | null } | null = null, inOther = false;
      try {
        const first = await preconditions(m); invalidatePublicationCache();
        const a = await under(m, () => importOf(m, rangeRecords(400, 20), first), c => inOther && c.op === 'put' && c.cls === 'content revision' ? 'throw' : undefined, async (call, st) => {
          if (other || call.head !== 'commit') return;
          inOther = true;
          const before = st.calls.length;
          const { answer, headers } = await rawImport(m, rangeRecords(500, 20));
          other = { stage: answer, headers, pack: st.calls.slice(before).find(c => c.op === 'put' && c.cls === 'pack' && !c.failed)?.key ?? null };
          inOther = false;
        });
        const otherNow = other as { stage: Answer; headers: Record<string, string>; pack: string | null } | null;
        const kept = otherNow?.pack ? m.storage.objects.has(otherNow.pack) : 'the second writer wrote no pack';
        const recovered = otherNow ? (await recoverOf(m, otherNow.headers)).status : 0;
        invalidatePublicationCache();
        const read = await productRead(m, rangeProduct(510));
        expect.soft({ first: a.result.status, second: [otherNow?.stage.status ?? null, otherNow?.stage.body.state ?? null], kept, recovered, read: [read.status, readIds(read)],
          bad: resolve(m, (await loadDocument(m, 'catalog')).document).bad },
        `${host}: P98.LD6 — the pending set's pack (today no load writes a pack)`).toEqual({
          first: 200, second: [503, 'pending'], kept: true, recovered: 200, read: [200, [rangeRecordId(510)]], bad: [] });
      } finally { restore(); }
    }, 300_000);

    it(`host (${host}): a pack a load in flight reuses is never collected — a load adopting the pack a refused load left, that pack deleted by a concurrent purge after the adoption, writes it again after reserving the head; every object of the revision then resolves`, async () => {
      const twin = await loadedTenant(host, 300), file = rangeRecords(400, 20);
      let attempt = 0, deleted = false;
      const refused = await measuredLoad(twin, file, { mode: 'merge' }, c => c.op === 'put' && c.cls === 'pack' ? (++attempt === 1 ? 'land-then-throw' : 'throw') : undefined);
      const left = refused.meter.calls.find(c => c.op === 'put' && c.cls === 'pack')?.key ?? null;
      // The same file over the same base, with a concurrent purge's deletion of that pack right after the adoption's HEAD.
      const headers = await preconditions(twin); invalidatePublicationCache();
      const adopted = await under(twin, () => importOf(twin, file, headers), undefined, call => {
        if (!deleted && call.op === 'head' && call.cls === 'pack') { twin.storage.objects.delete(call.key); deleted = true; }
      });
      const adoption = adopted.meter.calls.filter(c => c.key === left).map(c => c.op);
      expect.soft({ precondition: [refused.row.status, left !== null], adoption: adoption.slice(0, 2), deleted, answer: adopted.result.status,
        bad: resolve(twin, (await loadDocument(twin, 'catalog')).document).bad, read: (await productRead(twin, rangeProduct(410))).status },
      `${host}: P98.LD6 — the reused pack written again (today no load writes a pack: ${JSON.stringify(adoption)})`).toEqual({
        precondition: [503, true], adoption: ['put', 'head'], deleted: true, answer: 200, bad: [], read: 200 });
      expect.soft(twin.storage.objects.has(left ?? 'no pack'), `${host}: P98.LD6 — the reused pack is stored again`).toBe(true);
    }, 300_000);

    it(`host (${host}): the manifest's pack table names every pack the revision reaches with its live objects and bytes (reading S5); past 64 packs the table is re-homed by later loads (never more than 65 named); a pack under a quarter live is re-homed by a later load, its live parts unchanged`, async () => {
      const m = await loadedTenant(host, 1);
      const tables: number[] = [], misses: string[] = [], figures: string[] = [];
      for (let k = 0; k < 70; k++) {
        expect((await importOf(m, rangeRecords(2000 + k * 7, 1))).status, `${host}: PRECONDITION — one-product load ${k + 1}`).toBe(200);
        const doc = (await loadDocument(m, 'catalog')).document, table = packTable(doc), live = reached(m, doc);
        tables.push(table.length);
        for (const pack of live.keys()) if (!table.includes(pack)) misses.push(`load ${k + 1}: ${pack.slice(0, 12)}`);
        const entries = ((doc.index as { packs?: unknown[] } | undefined)?.packs ?? []).filter(e => e && typeof e === 'object') as Array<Record<string, unknown>>;
        for (const entry of entries) {
          const held = live.get(String(entry.digest)), numbers = Object.values(entry).filter(v => typeof v === 'number');
          if (held && !(numbers.includes(held.objects) && numbers.includes(held.bytes))) figures.push(`load ${k + 1}: ${String(entry.digest).slice(0, 12)} ${JSON.stringify(numbers)} for ${JSON.stringify(held)}`);
        }
      }
      // A pack under a quarter live: 100 products of large records, then 90 of them retitled, then one more load.
      const q = await loadedTenant(host, 20);
      const heavy = (from: number, suffix = '') => rangeRecords(from, 100, suffix).map(r => ({ ...r, excerpt: `Heavy record ${r.id} `.padEnd(2000, 'h') }));
      const loaded = await measuredLoad(q, heavy(3000));
      const quarter = loaded.row.packs[0] ? packDigest(loaded.row.packs[0]) : 'no pack written';
      const keptProducts = Array.from({ length: 10 }, (_, i) => rangeProduct(3090 + i)), loadedView = indexOf(q, (await loadDocument(q, 'catalog')).document);
      const digestsBefore = keptProducts.map(p => loadedView.products[p]?.digest ?? null);
      expect((await importOf(q, heavy(3000, ' (p98 most)').slice(0, 90))).status, `${host}: PRECONDITION — 90 of the 100 retitled`).toBe(200);
      expect((await importOf(q, rangeRecords(3500, 1))).status, `${host}: PRECONDITION — one more load`).toBe(200);
      const after = (await loadDocument(q, 'catalog')).document, view = indexOf(q, after);
      expect.soft({ reachedInTable: misses, figures, mostNamed: atMost(Math.max(0, ...tables), 65), packsNamed: tables.at(-1)! > 0,
        quarter: { inTable: packTable(after).includes(quarter), keptElsewhere: keptProducts.every(p => view.products[p]?.place && view.products[p]!.place!.pack !== quarter),
          digests: keptProducts.map(p => view.products[p]?.digest ?? null) } },
      `${host}: P98.LD6 — the pack table (tables named ${JSON.stringify(tables.slice(-5))})`).toEqual({
        reachedInTable: [], figures: [], mostNamed: 'at most 65', packsNamed: true, quarter: { inTable: false, keptElsewhere: true, digests: digestsBefore } });
    }, 600_000);

    it(`host (${host}): the objects stored before packs (a leftover no revision ever named included) are collected once no stored revision names an object without a byte range — after one full reload and the publications that purge the older revisions`, async () => {
      const { m } = await shardedTenant(host, [...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(1, 100)]);
      const leftover = { product: 'COA-LEFTOVER', pieces: [rangeRecords(9999, 1)[0]] };
      await m.storage.put(KEY.part('f'.repeat(64)), canonicalJson(leftover));
      shortRetention(m);
      const restore = uploadedAt(m, minutesAgo(60));
      try {
        const reloaded = await importOf(m, [...ANCHOR_IMAGES.map(r => ({ ...r, title: `${r.title} (p98 full reload)` })), ...OTHER_IMAGES.map(r => ({ ...r, title: `${r.title} (p98 full reload)` })),
          ...rangeRecords(1, 100, ' (p98 full reload)')]);
        for (let i = 0; i < 4; i++) await publication(m, `purge ${i + 1}`);
        const standalone = [...m.storage.objects.keys()].filter(k => /\/content\/(?:part|shard|idshard|ids)\//.test(k));
        expect.soft({ reloaded: reloaded.status, standalone, bad: resolve(m, (await loadDocument(m, 'catalog')).document).bad, page: (await productRead(m, rangeProduct(50))).status },
          `${host}: P98.LD6 — the objects stored before packs (today they stay: ${standalone.length})`).toEqual({ reloaded: 200, standalone: [], bad: [], page: 200 });
      } finally { restore(); }
    }, 300_000);
  }
});

// ===========================================================================
// unit:P98.LD7 — the kits state the load as built
// ===========================================================================

describe('unit:P98.LD7 (R-P545 (2), R-P549: the kits state the pack, the stages, the file size, the calls, the 503 and its state; no re-send as a remedy)', () => {
  it('logic: kits 02 and 03 state the pack (one object per load, pointers with byte ranges), the stages and the publish, the file size (5,000 products or 2 MiB), the calls and the time a load takes, the 503\'s members and how to act on its state, the exact changed count and the collection of a refused load\'s or a stage\'s pack; kit 02 lists the stage and publish doors, names the storage refusal on the import row and admits the catalogue credential to both doors; no sentence advises re-sending a file as the remedy for a refusal; today\'s small-file advice and one-object-per-part sentence are gone', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const paragraphs = (text: string) => text.split(/\n\s*\n/).map(p => p.split('\n').join(' '));
    const has = (text: string, ...words: RegExp[]) => paragraphs(text).some(p => words.every(w => w.test(p)));
    const sentences = (text: string) => paragraphs(text).flatMap(p => p.split(/(?<=[.;])\s+(?=[A-Z`(])/));
    const callsStated = (text: string) => paragraphs(text).some(p => /\bpack\b/.test(p) && [...p.matchAll(/\b(\d{1,3}) storage calls\b/g)].some(m => Number(m[1]) <= 40));
    const resend = (text: string) => sentences(text).filter(s => /\bre-?sen[dt]|\bsen[dt] (?:it|the (?:same )?(?:file|load)) again\b|\b(?:be )?sent again\b|\bresubmit|\b(?:try|retry) (?:the (?:file|load)|it) again\b/i.test(s)
      && /\b503\b|refus|time ?out|\bfail/i.test(s) && /\bfiles?\b|\bloads?\b|\bimport\b|\bcatalog(?:ue)?\b/i.test(s));
    const row = (path: string) => kit02.split('\n').find(line => line.startsWith(`| \`POST ${path}`)) ?? '';
    const credential = kit02.split('\n').find(line => line.startsWith('Customer machine credentials are independently registered')) ?? '';
    const flat03 = kit03.replace(/\s+/g, ' ');
    const state = [/`?publication_unavailable`?/, /`operation`/, /`objectKind`/, /`storageStatus`/, /`state`/, /`?nothing_written`?/, /`?pending`?/, /`?committed`?/, /\/content\/catalog\/publication\/recover/];
    const each = (text: string) => ({
      pack: has(text, /\bpacks?\b/, /\bbyte ranges?\b/, /\bone (?:object|pack)\b/),
      stages: has(text, /\bstages?\b/, /\/content\/catalog\/stage\b/, /\/content\/catalog\/publish\b/, /\bonce\b/),
      fileSize: has(text, /\b5,000 products\b/, /\b2 MiB\b/),
      calls: callsStated(text),
      time: has(text, /\b40,000 products\b/, /\b\d+(?:[–-]\d+)? ?(?:s|seconds)\b|\bhalf a minute\b/),
      state: has(text, ...state),
      changed: has(text, /`changed`/, /\bfield order\b|\border of (?:its|their|the) fields\b/),
      collected: has(text, /\bpacks?\b/, /\brefused\b/, /\bstage\b/, /\b15 minutes\b/),
      resend: resend(text),
    });
    expect.soft({
      kit02: each(kit02), kit03: each(kit03),
      rows: { stage: row('/content/catalog/stage').length > 0, publish: row('/content/catalog/publish').length > 0, importNamesRefusal: row('/content/catalog/import').includes('publication_unavailable') },
      credential: sentences(credential).some(s => s.includes('catalog-import') && /admit/i.test(s) && /POST \/content\/catalog\/stage\b/.test(s) && /POST \/content\/catalog\/publish\b/.test(s)),
      gone: ['Send a large range as files of about 200 to 300 products', 'Keep files to a few hundred products', 'is not yet measured on the hosted stamps',
        'Each part is one immutable object holding that product\'s records'].filter(sentence => flat03.includes(sentence)),
    }, 'P98.LD7 — the kits state the load as built (today: per-product parts, files of 200 to 300 products, no publication_unavailable, no stage)').toEqual({
      kit02: { pack: true, stages: true, fileSize: true, calls: true, time: true, state: true, changed: true, collected: true, resend: [] },
      kit03: { pack: true, stages: true, fileSize: true, calls: true, time: true, state: true, changed: true, collected: true, resend: [] },
      rows: { stage: true, publish: true, importNamesRefusal: true }, credential: true, gone: [] });
  });
});

// ===========================================================================
// unit:P98.LD8 — the migration needs no operator step
// ===========================================================================

describe('unit:P98.LD8 (R-P549 §5: a catalogue stored before packs is served as it is; each load moves into its pack what it touches)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a catalogue stored in P93's shards and parts is served unchanged before any load (the page 8 reads, the per-product read); the first loads read each old shard at most once (512 in all at most) and write one pack each; an old part costs one read the first time a load names its product and is in a pack after it (the next retitle of those products at most 40 calls, no object of its own read)`, async () => {
      const { m, parts } = await shardedTenant(host, [...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(1, 600)]);
      const before = await pageOf(m, 'p98-migration-before'), read = await productRead(m, rangeProduct(300));
      const loads = [await measuredLoad(m, rangeRecords(1000, 100)), await measuredLoad(m, rangeRecords(1, 100, ' (p98 m1)'))];
      const ownReads = loads.flatMap(l => l.meter.calls.filter(c => c.op === 'get' && ['shard', 'idshard'].includes(c.cls)).map(c => c.key));
      const partReads = loads[1]!.meter.calls.filter(c => c.op === 'get' && c.cls === 'part').map(c => c.key);
      const view = indexOf(m, (await loadDocument(m, 'catalog')).document);
      const named = Array.from({ length: 100 }, (_, i) => rangeProduct(1 + i));
      const third = await measuredLoad(m, rangeRecords(1, 100, ' (p98 m2)'));
      const after = await pageOf(m, 'p98-migration-after');
      expect.soft({
        before: [before.status, before.served, atMost(before.reads, 8)], read: [read.status, readIds(read)],
        loads: loads.map(l => [l.row.status, l.row.puts]), oldShards: [atMost(ownReads.length, 512), ownReads.length === new Set(ownReads).size],
        oldParts: [partReads.length, new Set(partReads).size === partReads.length, named.every(p => partReads.includes(KEY.part(parts.get(p) ?? 'none')))],
        inPack: named.every(p => !!view.products[p]?.place), third: [third.row.status, atMost(third.row.calls, 40), third.meter.calls.filter(c => c.op === 'get' && ['part', 'shard', 'idshard'].includes(c.cls)).length],
        after: [after.status, after.served, atMost(after.reads, 8)], bad: resolve(m, (await loadDocument(m, 'catalog')).document).bad,
      }, `${host}: P98.LD8 — the migration from P93's form (today a load writes parts and shards of their own: ${JSON.stringify(loads[0]!.row.puts)})`).toEqual({
        before: [200, SERVED_FOR_BLACK, 'at most 8'], read: [200, [rangeRecordId(300)]],
        loads: [[200, PUBLICATION_WRITES], [200, PUBLICATION_WRITES]], oldShards: ['at most 512', true],
        oldParts: [100, true, true], inPack: true, third: [200, 'at most 40', 0], after: [200, SERVED_FOR_BLACK, 'at most 8'], bad: [] });
    }, 600_000);

    it(`host (${host}): a catalogue in P86's one-level form is served as it is, and converted by one load writing one pack: every shard and id shard of the conversion in that pack, every part it did not change still its own object with its digest unchanged`, async () => {
      const { m, parts } = await oneLevelTenant(host, [...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(1, 40)]);
      const before = await pageOf(m, 'p98-one-level-before');
      const load = await measuredLoad(m, [{ ...rangeRecords(3, 1)[0]!, title: 'retitled once' }]);
      const doc = (await loadDocument(m, 'catalog')).document, resolved = resolve(m, doc), written = load.row.packs.map(packDigest);
      const unchanged = [...parts.keys()].filter(p => p !== rangeProduct(3));
      expect.soft({
        before: [before.status, before.served], load: [load.row.status, load.row.puts], form: indexOf(m, doc).form,
        shardsInPack: [resolved.own.shards, resolved.own.idShards, resolved.places.filter(p => p.kind !== 'part').every(p => p.place && written.includes(p.place.pack))],
        parts: unchanged.every(p => resolved.view.products[p]?.digest === parts.get(p) && !resolved.view.products[p]?.place), bad: resolved.bad,
      }, `${host}: P98.LD8 — the one-level form converted by one pack (today up to 512 shard objects: ${JSON.stringify(load.row.puts)})`).toEqual({
        before: [200, SERVED_FOR_BLACK], load: [200, PUBLICATION_WRITES], form: 'sharded', shardsInPack: [0, 0, true], parts: true, bad: [] });
    }, 300_000);
  }
});
