// src/units/P99/LEDGER.unit.test.ts
// P99 under the Closure Ledger (programme `tapestry-parity-hardening`, amendment 13, item E23; batch S44): the tests for the
// LOCAL criteria PG1–PG3 of the P99 work order (docs/parity/hardening/program.json, ticket P99). LV1 is a deferred live row
// and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md:15–18, E23):
//   "#### E23 · The purge at scale
//    - **Authority:** P93's delivery review (R-P506): under its 256-call budget the purge never removes a revision whose
//      load touched all 256 shards (storage grows by one such revision per large load; nothing lost); P95's delivery
//      review (R-P531): a tenant whose stored learn history can never establish the salt count (an early revision purged,
//      a retained baseline) now keeps every learn revision for good under the retention setting.
//    - **Done when:** the purge keeps its progress across passes so a large revision is removed over several
//      publications; the latent delete order (shard keys queued before the parts behind them) cannot strand a part; a
//      tenant whose salt count can never be established is told (an advisory on the operator's reads) and its learn
//      revisions purged past a stated bound once the count is null for good, or the owner's alternative.
//    - **Needed by:** before the first activation (January). Two days."
//   The owner (R-P545): every problem fixed at its cause, nothing papered over. These legs pin the cause's fix — a purge
//   whose work survives its budget, a deletion order that cannot strand, a rule that tells a count lost for good from one
//   not yet established — never a larger budget, a sweep by hand or a kit sentence in place of the behaviour.
//
// TODAY (d5d8581c): src/config/publication.ts purgeByPolicy resolves a sharded revision's objects in orphansOf, one budget
// call per shard read, before sweep lists or deletes anything, so a revision naming 512 shards exhausts the 256-call
// budget on every pass and is never removed (PG1); orphansOf queues a shard's key before the parts behind it and sweep
// deletes 1,000 keys a call, so a stop between calls strands parts no stored shard reaches (PG2); saltCountCarried answers
// no for every null count and learnAdvisory (src/routes/content.ts) carries the conversion advisory alone, so a tenant
// whose count can never be established keeps every learn revision for good and is told nothing (PG3); kit 02's purge
// paragraph says the purge keeps every learn revision wherever the current one carries no exact count.
//
// P98 (E25, R-P549, R-P551) CHANGES THE STORAGE THESE LEGS PURGE, AND IS JOINED FIRST. Read at rem/spec-p98 65d52397
// (and its round 2, 8da80056) and rem/p98-build eafe219d and 1113cc75: each load stores one pack; a manifest pointer into
// a pack names its object by the pack's row and a byte range (1113cc75: `{ pack, at, bytes, products, records }`, no
// digest), an object stored on its own keeps `{ digest, … }`; a writing load moves the shards and id shards stored before
// packs into its pack (their parts only when it reads them); a pack revision's purge resolves its packs from the pack
// tables (no shard read), and the objects stored before packs are collected by listing once no stored revision names one.
// Stored revisions are immutable, so the revisions written before P98's release keep naming 256 product shards and 256 id
// shards of their own. HOW THESE LEGS BUILD THEM AFTER P98: every PG1 and PG2 leg runs in two forms, (a) loaded through
// the operator's import route (today P93's form; after P98 P98's packs — the "pack revisions" the brief names, where
// these legs are the locks that P98's pack purge keeps the criterion) and (b) planted in P93's form (./_purge.ts
// plantRevision: each part, each product shard and each id shard an object of its own at its content address, the
// manifest's `index` naming them with no byte range, published by the publication authority's own `publish` — P98's own
// fixture form for objects stored before packs, S43/_load.ts shardedTenant). (b) is the same on every tree; its later
// loads go through the route, so after P98 a planted revision is purged beside the pack revisions a load after the
// release writes. The objects a revision names are read by ./_purge.ts namedObjects in every stored form (round 2's
// ../P93/_catalog indexOf finds an object by its digest and so cannot read 1113cc75's place-only pointers: measured on
// the scratch merge, 458 of 458 shard pointers reported missing). Measured on a scratch merge of rem/p98-build 1113cc75
// with rem/spec-p98 8da80056 (the harness R10s P98's build reads through): see the report.
//
// READINGS (where the work order is silent; for the lead):
//   R1 "On both hosts": the purge and the learn routes are the operator's path, the same on either shopper host; every
//      host leg mounts the application on that host (`REFLEX_HOST` session or do), as P95's R6.
//   R2 "A bounded number of later publications": at most eight later publications per such revision, 64 for the eight
//      (LATER_PUBLICATIONS); the later publications re-publish the slots document (configuration publications that load
//      nothing), so the catalogue history the purge works on is the fixture's own.
//   R3 PG1's tenant (R-P506 (2)): 40,000 products in eight 5,000-product revisions, each naming all 256 product shards and
//      all 256 id shards under digests the revision before did not (PRECONDITION), then two one-product loads through the
//      route, so the eight are neither the current nor the previous revision; the configuration-revision setting at 1 ms.
//   R4 "Within its own budget": a publication's purge is the bucket calls, and the bytes read, after its commit beyond
//      those of the same publication with the setting unset (measured once, on the same tenant, before the setting);
//      at most 256 calls and 16 MiB (PURGE_OPERATIONS, PURGE_BYTES, as the work order cites them). "Nothing another stored
//      revision names is removed": after every publication nothing the current or the previous revision reaches is
//      missing, and at the end nothing any stored revision reaches. "Nothing is left that no stored revision names": the
//      catalogue's object directories (part, shard, idshard, ids, pack) hold nothing a stored revision does not reach
//      through objects the store holds (./_purge.ts namedObjects: an object of its own named by its digest, or a pack and
//      a byte range, as P98's builds eafe219d and 1113cc75 store them; the reader holds no expected value).
//   R5 PG2's revision: four product shards holding 1,200 products only that revision points at (ids chosen by the bucket
//      rule, P93's reading 1), more than 1,000 objects, so its removal needs more than one deletion call (R2 deletes at
//      most 1,000 keys a call) and today's order is reached within today's budget (R-P506 (3): "not reachable under the
//      budget" otherwise). That count is the planted form's PRECONDITION; the route-loaded form after P98 stores the
//      crowd in packs, whose removal deletes whole packs named by the tables, and is run as the lock that it strands
//      nothing. "Stopped after each deletion call in turn": for k = 1…D, D the deletion calls one unstopped
//      purge makes on a twin tenant, every deletion call after the k-th fails (a failed deletion stops the purge); then
//      every stored object is reachable through a stored shard or a stored revision (PG2's words), nothing the current or
//      the previous revision reaches is missing, and at most four next publications remove the revision.
//   R6 PG3's "can never be established": a learn revision before the current one purged (P95's R4 form: revision 2, the
//      only one on its salt, removed under the setting, so it reads 410 revision_purged), or a retained baseline (the
//      initializer's own path, learn adopted at revision 5: minRevision 5, revision 1 reads 409 legacy_history_unavailable).
//      "A transient storage failure": a learn publication whose count met a failing read of revision 3 over a complete
//      history stored before the annotation.
//   R7 The advisory: the answer outside its `document` names `saltVersion` and the store's own code for why
//      (`revision_purged`, `legacy_history_unavailable`) on GET /content/learn and the 200 answers of POST
//      /content/learn/validate and PUT /content/learn; the member's name and shape are the builder's. A tenant whose count
//      is exact, and one whose count failed for a transient failure, are told neither code.
//   R8 The bound: src/config/publication.ts exports SALT_UNKNOWN_LEARN_KEPT, a whole number of 1 or more: the most recent
//      learn revisions (by revision number, the current one counted) the purge keeps for such a tenant; past them its
//      learn revisions go under the purge's other rules (older than the setting, neither the current nor the previous,
//      named by no stored decision). Every expectation is derived from the constant (R-P195's form): the fixture is the
//      bound plus eight revisions, and the kit states the constant's decimal value. The name is this specification's.
//   R9 The kit sentences are ruled verbatim (kitSentences): one appended to kit 02's salt-version paragraph, which keeps
//      the opening P100's HN3 finds it by ("`saltVersion` is 1 for the first salt"); in the purge paragraph today's
//      sentence (P95's KIT_PURGE_KEEPS) narrowed to a count the stored history can still establish, and one added;
//      P95's KIT_CARRY and KIT_PURGE_NEVER kept.
//   R10 "Under the purge's other rules" is shown by the previous revision and one learn revision a stored decision names
//      (a consenting shopper's decision while it was in force, written by the real ledger producer and consumer, found by
//      the purge's rolled-up listing of the ledger's days and hours: the R2 double lists as R2 does, R-P597), both past the
//      bound and both kept. NR4 is kept: the next learn publication of such a tenant still carries the unknown.
//   R11 The 15-minute grace (R-P424) stays as P86 CS1 and P93 CS5 lock it: an object inside the grace is not deleted and
//      its revision's body still goes (a sketch that kept the body instead turned those four legs RED; after P98 no load
//      writes an object of its own, so the grace no longer touches the objects stored before packs). These legs list
//      every object as uploaded at time 0, as the double does, so the grace does not enter them.
//
// THE R10 BY NAME (the work order's grant, by the specifier; not edited here — the lead rules it before the build):
//   src/units/P95/LEDGER.unit.test.ts KIT_PURGE_KEEPS (:300), before → after:
//     'Where the current learn revision carries none (a learn document published before this release, or a count that
//      could not be finished), the purge keeps every learn revision, so the next learn publication can count over the
//      whole stored history.'
//     → 'Where the current learn revision carries none (a learn document published before this release, or a count that
//      could not be finished) and the stored learn history can still establish it, the purge keeps every learn revision,
//      so the next learn publication can count over the whole stored history.'
//   Its use at :551 (purge.includes(KIT_PURGE_KEEPS)) is unchanged.
//   src/units/_parity.ts UnitR2.list (R-P597; made here), before → after: a prefix and an offset cursor only, every key an
//     object (no `delimiter`, no `startAfter`) → R2's listing: the keys after `startAfter`; a key holding `delimiter`
//     past the prefix rolled up into one `delimitedPrefixes` entry; at most `limit` names a page, objects and prefixes
//     counted together; an opaque `cursor` resuming after the last name a page answered. Uploads still at time 0.
//
// LOCKS (the gate): P93 CS5, P95 SV1–SV5 (as amended by the R10), W38 LEDGER and FIX1 B4.x, W21 B1–B3 and LEDGER, P86,
// src/config/versionedStore.test.ts, src/config/publication.optionalMember.test.ts, src/routes/content.test.ts, every test
// reading publication.ts, holdout.ts or the learn routes, and P98's file as of 65d52397. PG3's transient leg is itself a
// LOCK (P95 SV2, SV4; W38 B4).
//
// DEFERRED: LV1 (lane L21, the pair's next release, the stamps read-only; a pair tenant that sets the configuration-revision
// setting, else proxied to these legs, as LV1 says).
// RESIDUALS (told, not tested): a tenant with more stored catalogue revisions than one budget can read (each candidate
// reads every other stored revision's manifest; P98's pack sweep reads every stored revision's table) is a scale this
// ticket does not size; the grace (15 minutes) is not exercised here (the in-memory bucket lists every object as uploaded
// at time 0); the time to remove eight revisions is reported, not bounded beyond R2; heap per publication (Node is not
// workerd).
//
// HARNESS: ../_parity (the mounted application on both hosts), ../P93/_catalog (P86's fixture and generator, the import),
// ./_purge (the meter, the deletion stop, the planted forms, the objects a revision names in every stored
// form, the learn histories). Imports from src/units/: ../_parity, ../P93/_catalog, ./_purge. Tenant ids only; no network; documents
// read from this tree (import.meta.url).

import { describe, expect, it } from 'vitest';

import * as publication from '@/config/publication';
import { LEARN_KIND } from '@/content/kinds';

import { declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, pageInstanceOf, putDocument, readTree, shopperOn, TENANT, type Answer,
  type Host, type Mounted } from '../_parity';
import { bucketOf, declareProductSlots, DOCS_WITH_CART, importJson, rangeProduct, rangeRecords, rangeTenant, sorted } from '../P93/_catalog';
import {
  afterCommit, cold, contentBodies, getLearn, learnKey, lost, pause, plantLearnHistory, plantRevision, putLearn, range, reached, retainedBaselineTenant, routed,
  setConfigurationRetention, show, slotsPublication, storedContent, storedLearn, touchedBy, unnamed, validateLearn, type Form,
} from './_purge';

const DAY_MS = 86_400_000;
/** The purge's budget per publication, as the work order cites it (src/config/publication.ts PURGE_OPERATIONS, PURGE_BYTES). */
const PURGE_OPERATIONS = 256, PURGE_BYTES = 16 * 1024 * 1024;

// ===========================================================================
// unit:P99.PG1 — the purge removes a revision that named 512 shards, over later publications, each within its budget
// ===========================================================================

/** R-P506 (2): P93's delivery review loaded 40,000 products in eight 5,000-product files, each touching all 256 + 256 shards. */
const LOADS = 8, PER_LOAD = 5000, PRODUCTS = LOADS * PER_LOAD;
/** Reading R2: "a bounded number of later publications" — at most eight later publications per such revision. */
const LATER_PUBLICATIONS = 8 * LOADS;

interface Tenant { m: Mounted; eight: number[]; kept: number[] }
/** The two small loads after the eight (one product each), so that the eight are neither the current nor the previous revision. */
async function smallLoads(m: Mounted): Promise<number[]> {
  for (const k of [PRODUCTS + 1, PRODUCTS + 2]) {
    const loaded = await importJson(m, rangeRecords(k, 1), { mode: 'merge' });
    expect(loaded.status, `PRECONDITION (${m.host}): the one-product load of ${rangeProduct(k)} is accepted (${show(loaded)})`).toBe(200);
  }
  return contentBodies(m).slice(-2);
}
/** Reading R3 (a): the eight loads through the operator's import route, as P93's reviewer made them (P93's rangeTenant). */
async function loadedTenant(host: Host): Promise<Tenant> {
  const m = await rangeTenant(host, PRODUCTS, PER_LOAD);
  const eight = contentBodies(m).slice(-LOADS);
  return { m, eight, kept: await smallLoads(m) };
}
/** Reading R3 (b): the eight revisions as P93's release stored them (512 objects of their own each), planted beside the routes. */
async function plantedTenant(host: Host): Promise<Tenant> {
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P99 — the tenant documents publish');
  await declareProductSlots(m);
  const products = new Map<string, unknown[]>(), eight: number[] = [];
  let shared: unknown[] = [];
  for (let load = 0; load < LOADS; load++) {
    const batch = routed(rangeRecords(load * PER_LOAD + 1, PER_LOAD));
    shared = batch.shared;
    for (const [product, pieces] of batch.parts) products.set(product, pieces);
    eight.push(await plantRevision(m, products, shared, `p99-load-${load + 1}`));
  }
  return { m, eight, kept: await smallLoads(m) };
}
function requireEightLoads(t: Tenant): void {
  const values = new Map(storedContent(t.m)), touched = t.eight.map(n => touchedBy(values.get(n - 1) ?? {}, values.get(n) ?? {}));
  const last = (values.get(t.eight[LOADS - 1]!)?.index ?? {}) as { shards?: Record<string, { products: number }> };
  const products = Object.values(last.shards ?? {}).reduce((n, p) => n + p.products, 0);
  expect({ revisions: t.eight.length, touched, atLeast40000: products >= PRODUCTS },
    `PRECONDITION (${t.m.host}): eight stored revisions, each naming all 256 product shards and all 256 id shards under digests the revision before did not, the last indexing ${products} products`)
    .toEqual({ revisions: LOADS, touched: t.eight.map(() => ({ shards: 256, ids: 256 })), atLeast40000: true });
}
interface Pass { publication: number; calls: number; bytes: number; deletions: number }
/**
 * Later configuration publications (the slots document re-published) under the configuration-revision setting at 1 ms, until
 * the eight bodies are gone and nothing is left that no stored revision names, at most LATER_PUBLICATIONS: each one's
 * purge measured as its calls and bytes after its commit beyond the same publication's with the setting unset (`base`).
 */
async function purgeLater(t: Tenant): Promise<{ passes: Pass[]; lostKept: string[]; remaining: number[]; left: string[] }> {
  const base = afterCommit((await slotsPublication(t.m, 'base')).calls);
  setConfigurationRetention(t.m, 1);
  await pause(25);
  const passes: Pass[] = [], lostKept = new Set<string>();
  for (let i = 1; i <= LATER_PUBLICATIONS; i++) {
    const after = afterCommit((await slotsPublication(t.m, `later-${i}`)).calls);
    passes.push({ publication: i, calls: after.calls - base.calls, bytes: after.bytes - base.bytes, deletions: after.deletions });
    for (const key of lost(t.m, t.kept)) lostKept.add(key);
    if (t.eight.every(n => !contentBodies(t.m).includes(n)) && !unnamed(t.m).length) break;
  }
  return { passes, lostKept: sorted(lostKept), remaining: t.eight.filter(n => contentBodies(t.m).includes(n)), left: unnamed(t.m) };
}
const overBudget = (passes: readonly Pass[]) => passes.filter(p => p.calls > PURGE_OPERATIONS || p.bytes > PURGE_BYTES).map(p => `publication ${p.publication}: ${p.calls} calls, ${p.bytes} bytes`);
const spread = (passes: readonly Pass[]) => passes.length ? `${passes.length} publications, purge calls ${Math.min(...passes.map(p => p.calls))}–${Math.max(...passes.map(p => p.calls))}, deletions ${passes.reduce((n, p) => n + p.deletions, 0)}` : 'no publication';

describe('unit:P99.PG1', () => {
  for (const host of HOSTS) {
    for (const [form, build] of [['loaded through the import route', loadedTenant], ['as stored before P98 (P93\'s 512 objects of their own, planted)', plantedTenant]] as const) {
      it(`host (${host}): 40,000 products in eight 5,000-product revisions ${form}, each naming all 256 product shards and 256 id shards, then two one-product loads: under the configuration-revision setting each of the eight is removed — its body and the shards and parts only it names — within ${LATER_PUBLICATIONS} later publications, each publication's purge within 256 storage calls and 16 MiB and its progress kept to the next; nothing the current or the previous revision names is removed and nothing is left that no stored revision names`, async () => {
        const t = await build(host);
        requireEightLoads(t);
        expect(unnamed(t.m), `PRECONDITION (${host}): before the purge every stored object is named by a stored revision`).toEqual([]);
        const run = await purgeLater(t);
        expect({ remaining: run.remaining, left: run.left.length, lostKept: run.lostKept, overBudget: overBudget(run.passes) },
          `${host}: P99.PG1 — the eight revisions are removed within ${LATER_PUBLICATIONS} later publications, each purge within its budget, nothing kept lost, nothing left unnamed (${spread(run.passes)}; today every pass starts afresh and spends its 256 calls reading the shards a revision names, publication.ts orphansOf, before sweep deletes anything)`)
          .toEqual({ remaining: [], left: 0, lostKept: [], overBudget: [] });
      }, 1_200_000);
    }
  }
});

// ===========================================================================
// unit:P99.PG2 — no order of deletions strands a part: the purge stopped after each deletion call in turn
// ===========================================================================

/** Four product shards, each holding about 300 products (reading R5): one revision's purge names more than 1,000 objects. */
const CROWDED = ['1c', '5d', '9e', 'd3'], PER_SHARD = 300;
const crowd = (() => {
  const out: number[] = [], count = new Map<string, number>();
  for (let k = 1; out.length < CROWDED.length * PER_SHARD; k++) {
    const b = bucketOf(rangeProduct(k));
    if (CROWDED.includes(b) && (count.get(b) ?? 0) < PER_SHARD) { out.push(k); count.set(b, (count.get(b) ?? 0) + 1); }
  }
  return out;
})();
const crowdRecords = (suffix: string) => crowd.flatMap(k => rangeRecords(k, 1, suffix));
/** A product outside the four shards. */
const LONE = (() => { for (let k = 1_000_000; ; k++) if (!CROWDED.includes(bucketOf(rangeProduct(k)))) return k; })();
interface Crowd { m: Mounted; target: number; kept: number[] }
/** Reading R5 (a): through the import route — the crowd loaded, then retitled, then one more product. */
async function crowdLoaded(host: Host): Promise<Crowd> {
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P99 — the tenant documents publish');
  await declareProductSlots(m);
  for (const records of [crowdRecords(''), crowdRecords(', retitled'), rangeRecords(LONE, 1)]) {
    const loaded = await importJson(m, records, { mode: 'merge' });
    expect(loaded.status, `PRECONDITION (${host}): the load of ${records.length} records is accepted (${show(loaded)})`).toBe(200);
  }
  const bodies = contentBodies(m);
  return { m, target: bodies.at(-3)!, kept: bodies.slice(-2) };
}
/** Reading R5 (b): the same three revisions as P93's release stored them, planted. */
async function crowdPlanted(host: Host): Promise<Crowd> {
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P99 — the tenant documents publish');
  await declareProductSlots(m);
  const first = routed(crowdRecords('')), second = routed(crowdRecords(', retitled')), lone = routed(rangeRecords(LONE, 1));
  const target = await plantRevision(m, first.parts, first.shared, 'p99-crowd');
  const kept = [await plantRevision(m, second.parts, second.shared, 'p99-crowd-retitled'),
    await plantRevision(m, new Map([...second.parts, ...lone.parts]), second.shared, 'p99-crowd-and-one')];
  return { m, target, kept };
}
/** The objects only `target` names among the stored revisions. */
function onlyNamedBy(c: Crowd): string[] {
  const others = reached(c.m, contentBodies(c.m).filter(n => n !== c.target));
  return [...reached(c.m, [c.target])].filter(key => !others.has(key));
}
interface Stop { after: number; stranded: string[]; lostKept: string[]; next: { removed: boolean; left: string[]; lostKept: string[] } }

describe('unit:P99.PG2', () => {
  for (const host of HOSTS) {
    for (const [form, build, crowded] of [
      ['loaded through the import route (P93\'s shards before P98, P98\'s packs after it: a pack holds a load\'s parts and shards whole, so this form is the lock that no order strands one there)', crowdLoaded, false],
      ['as stored before P98 (planted), its four product shards holding 1,200 products only it points at — more than 1,000 objects, so its purge needs more than one deletion call', crowdPlanted, true],
    ] as const) {
      it(`host (${host}): the crowded revision ${form} — purged with the purge stopped after each of its deletion calls in turn: every object not yet deleted stays reachable through a stored shard or a stored revision, nothing the current or the previous revision names is removed, and the next publications finish the removal`, async () => {
        const twin = await build(host), only = onlyNamedBy(twin).length;
        expect({ only: crowded ? only > 1000 : 'any', left: unnamed(twin.m) }, `PRECONDITION (${host}): every stored object is named${crowded ? `, and the revision under purge names more than 1,000 objects no other stored revision names (${only})` : ` (the revision under purge names ${only} objects only it names)`}`)
          .toEqual({ only: crowded ? true : 'any', left: [] });
        setConfigurationRetention(twin.m, 1);
        await pause(25);
        const full = afterCommit((await slotsPublication(twin.m, 'twin')).calls);
        expect({ deletions: full.deletions >= 2, removed: !contentBodies(twin.m).includes(twin.target) },
          `PRECONDITION (${host}): unstopped, one publication's purge removes the revision in ${full.deletions} deletion calls`).toEqual({ deletions: true, removed: true });
        const stops: Stop[] = [];
        for (let after = 1; after <= full.deletions; after++) {
          const c = await build(host);
          setConfigurationRetention(c.m, 1);
          await pause(25);
          await slotsPublication(c.m, `stopped-after-${after}`, k => k > after);
          const stop: Stop = { after, stranded: unnamed(c.m), lostKept: lost(c.m, c.kept), next: { removed: false, left: [], lostKept: [] } };
          for (let i = 1; i <= 4 && contentBodies(c.m).includes(c.target); i++) await slotsPublication(c.m, `next-${after}-${i}`);
          stop.next = { removed: !contentBodies(c.m).includes(c.target), left: unnamed(c.m), lostKept: lost(c.m, c.kept) };
          stops.push(stop);
        }
        const summary = stops.map(s => ({ after: s.after, stranded: s.stranded.length, lostKept: s.lostKept.length, next: { removed: s.next.removed, left: s.next.left.length, lostKept: s.next.lostKept.length } }));
        expect(summary, `${host}: P99.PG2 — stopped after each of the ${full.deletions} deletion calls in turn, nothing is stranded or lost and the next publications finish the removal (today orphansOf queues each shard's key before the parts behind it and sweep deletes 1,000 keys a call, so a stop after the first call strands the parts of the second: ${JSON.stringify(summary.filter(s => s.stranded || s.next.left))})`)
          .toEqual(stops.map(s => ({ after: s.after, stranded: 0, lostKept: 0, next: { removed: true, left: 0, lostKept: 0 } })));
      }, 900_000);
    }
  }
});

// ===========================================================================
// unit:P99.PG3 — a tenant whose salt count can never be established is told, and keeps its learn revisions only within a bound
// ===========================================================================

/** Reading R8: the bound is a code constant src/config/publication.ts exports under this name. */
const BOUND_NAME = 'SALT_UNKNOWN_LEARN_KEPT';
const BOUND: unknown = (publication as unknown as Record<string, unknown>)[BOUND_NAME];
const boundOf = (): number => {
  expect({ exported: typeof BOUND, whole: Number.isSafeInteger(BOUND) && (BOUND as number) >= 1 },
    `P99.PG3 — the bound is a code constant: src/config/publication.ts exports ${BOUND_NAME}, the number of most recent learn revisions the purge keeps for a tenant whose salt count can never be established, a whole number of 1 or more (today: ${String(BOUND)})`)
    .toEqual({ exported: 'number', whole: true });
  return BOUND as number;
};

const PAGE = 'pdp';
const SALT_A = 'p99-salt-a', SALT_B = 'p99-salt-b', SALT_C = 'p99-salt-c';
/** P95's learn document of revision n on one salt: the regional threshold moves with n, so every revision is a new document. */
const learnOn = (salt: string, n: number) => learnDocument({}, { holdout: { share: 0.5, salt, arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 + n } });
const DOCS = { pieces: MODULES, slots: declaredSlots([layoutSlot()]), learn: learnOn(SALT_A, 1) };
/** The salt of learn revision n: SALT_A at 1, a short-lived SALT_B at 2, SALT_C from 3 (the count is 3 from revision 3 on). */
const saltOf = (n: number) => n === 1 ? SALT_A : n === 2 ? SALT_B : SALT_C;
const unknownOn = (salt: string) => ({ salt, version: null });
const annotationOf = async (m: Mounted, n: number) => {
  cold();
  return publication.carriedSaltVersion(await publication.publicationVersion(m.env, LEARN_KIND, TENANT, n));
};
const codeOfRead = async (m: Mounted, n: number) => {
  cold();
  return publication.publicationVersion(m.env, LEARN_KIND, TENANT, n).then(() => 'read', (error: { status?: number; code?: string }) => `${error.status} ${error.code}`);
};
/** Learn revisions from..to through the operator's route, revision n on saltOf(n); a decision served while `servedAt` is in force. */
async function publishLearnHistory(m: Mounted, from: number, to: number, servedAt?: number): Promise<void> {
  for (let n = from; n <= to; n++) {
    const answer = await putLearn(m, learnOn(saltOf(n), n));
    expect(answer.body.revision, `PRECONDITION (${m.host}): learn revision ${n} publishes (${show(answer)})`).toBe(n);
    if (n === servedAt) await serveDecisionAt(m, n);
  }
}
/** A consenting shopper's decision while learn revision n is in force, rendered (acknowledged) and so written to the ledger by the real producer and consumer. */
async function serveDecisionAt(m: Mounted, n: number): Promise<void> {
  const shopper = await shopperOn(m);
  const snapshot = await shopper.snapshot(PAGE, { pageInstance: pageInstanceOf(`p99-learn-${n}`) });
  const rendered = snapshot.decisions[0];
  if (rendered) await shopper.ack(snapshot, rendered);
  await m.drainLedger();
  const named = [...m.storage.objects.entries()].filter(([key]) => key.includes('/decision/') && key.endsWith('.ndjson'))
    .flatMap(([, raw]) => raw.split('\n').filter(Boolean).map(line => (JSON.parse(line) as { versions?: { learn?: number } }).versions?.learn));
  expect({ status: snapshot.status, named: named.includes(n) }, `PRECONDITION (${m.host}): a stored decision names learn revision ${n} (${show(snapshot)})`).toEqual({ status: 200, named: true });
}
/**
 * The pair's l1 with an early learn revision purged (P95's R3 and R4): learn revisions 1…h, 1…h-2 stored before the
 * annotation and h-1, h carrying the unknown; revision 2 (the only one on SALT_B) removed under the setting, so it reads
 * 410 revision_purged and no count can ever be established again.
 */
async function purgedEarlyTenant(host: Host, h: number, servedAt?: number): Promise<Mounted> {
  const m = await mount(host, DOCS);
  expectPublished(m, 'P99 — the product page and the learn document on SALT_A publish');
  await publishLearnHistory(m, 2, h, servedAt);
  await plantLearnHistory(m, (n): Form => n <= h - 2 ? 'before' : 'unknown');
  setConfigurationRetention(m, 3650 * DAY_MS);
  await m.storage.delete(learnKey(2));
  expect({ two: await codeOfRead(m, 2), current: await annotationOf(m, h) }, `PRECONDITION (${host}): learn revision 2 reads as purged and the current revision carries the unknown`)
    .toEqual({ two: '410 revision_purged', current: unknownOn(SALT_C) });
  return m;
}
/** A tenant whose learn history starts at a retained baseline (revision `floor`), then learn revisions floor+1…h through the route. */
async function baselineTenant(host: Host, floor: number, h: number, servedAt?: number): Promise<Mounted> {
  const m = await retainedBaselineTenant(host, { ...DOCS, learn: learnOn(SALT_C, floor) }, floor);
  await publishLearnHistory(m, floor + 1, h, servedAt);
  expect({ one: await codeOfRead(m, 1), current: await annotationOf(m, h) }, `PRECONDITION (${host}): learn revision 1 predates the retained baseline and the current revision carries the unknown`)
    .toEqual({ one: '409 legacy_history_unavailable', current: unknownOn(SALT_C) });
  return m;
}

/** Reading R7: the advisory names `saltVersion` and the store's own code for why, in the answer outside its `document`. */
const NEVER = ['revision_purged', 'legacy_history_unavailable'] as const;
function advisoryOf(answer: Answer): string {
  const { document: _document, ...rest } = answer.body; void _document;
  return JSON.stringify(rest);
}
const advises = (answer: Answer, reason: string) => {
  const text = advisoryOf(answer);
  return answer.status === 200 && text.includes('saltVersion') && text.includes(reason) ? `names saltVersion and ${reason}` : `does not (${answer.status} ${text.slice(0, 240)})`;
};
const neverAdvised = (answer: Answer) => NEVER.filter(reason => advisoryOf(answer).includes(reason));
/** The three learn answers: the read, a dry run of the next document and the next document published. */
async function learnAnswers(m: Mounted, next: number): Promise<{ get: Answer; validate: Answer; put: Answer }> {
  const get = await getLearn(m), validate = await validateLearn(m, learnOn(SALT_C, next)), put = await putLearn(m, learnOn(SALT_C, next));
  expect([get.status, validate.status, put.status], `PRECONDITION (${m.host}): the learn read, its dry run and its publication answer (${show(put)})`).toEqual([200, 200, 200]);
  return { get, validate, put };
}
/** Catalogue publications (configuration publications that are not learn publications) until `settled` holds twice running, at most `max`. */
async function catalogueUntil(m: Mounted, max: number, settled: () => boolean): Promise<number> {
  let held = 0, i = 0;
  while (i < max && held < 2) {
    i++;
    const answer = await putDocument(m, 'catalog', { version: `p99-catalogue-${i}`, pieces: MODULES }, `p99 catalogue ${i}`);
    expect(answer.status, `PRECONDITION (${m.host}): catalogue publication ${i} is accepted (${show(answer)})`).toBe(200);
    held = settled() ? held + 1 : 0;
  }
  return i;
}
const publicationsFor = (h: number) => 2 * Math.ceil((h + 16) / 16) + 8;
/** The learn revisions the purge keeps for a tenant whose count can never be established: the newest `bound`, the current and the previous, and one a stored decision names. */
const keptUnder = (stored: readonly number[], h: number, bound: number, named: number) => stored.filter(n => n > h - bound || n >= h - 1 || n === named);

describe('unit:P99.PG3', () => {
  it(`logic: the bound is a code constant — src/config/publication.ts exports ${BOUND_NAME}, a whole number of 1 or more`, () => {
    boundOf();
  });

  for (const host of HOSTS) {
    it(`host (${host}): a tenant whose stored learn history can never establish the salt count is told on every operator learn read — GET /content/learn and the answers of POST /content/learn/validate and PUT /content/learn name the unknown saltVersion and why: revision_purged where an earlier learn revision was purged, legacy_history_unavailable where the history starts at a retained baseline; LOCK: a tenant whose count is exact is told neither`, async () => {
      const purged = await purgedEarlyTenant(host, 8), baseline = await baselineTenant(host, 5, 7);
      const exact = await mount(host, DOCS);
      expectPublished(exact, 'P99 — the product page and the learn document on SALT_A publish');
      await publishLearnHistory(exact, 2, 3);
      expect(await annotationOf(exact, 3), `PRECONDITION (${host}): the exact tenant's current revision carries 3`).toEqual({ salt: SALT_C, version: 3 });
      const told = { purged: await learnAnswers(purged, 9), baseline: await learnAnswers(baseline, 8), exact: await learnAnswers(exact, 4) };
      expect({
        purged: { get: advises(told.purged.get, 'revision_purged'), validate: advises(told.purged.validate, 'revision_purged'), put: advises(told.purged.put, 'revision_purged') },
        baseline: { get: advises(told.baseline.get, 'legacy_history_unavailable'), validate: advises(told.baseline.validate, 'legacy_history_unavailable'), put: advises(told.baseline.put, 'legacy_history_unavailable') },
        exact: { get: neverAdvised(told.exact.get), validate: neverAdvised(told.exact.validate), put: neverAdvised(told.exact.put) },
      }, `${host}: P99.PG3 — the learn advisory channel names the unknown salt version and why on all three answers (today learnAdvisory, src/routes/content.ts, carries the conversion advisory alone)`).toEqual({
        purged: { get: 'names saltVersion and revision_purged', validate: 'names saltVersion and revision_purged', put: 'names saltVersion and revision_purged' },
        baseline: { get: 'names saltVersion and legacy_history_unavailable', validate: 'names saltVersion and legacy_history_unavailable', put: 'names saltVersion and legacy_history_unavailable' },
        exact: { get: [], validate: [], put: [] },
      });
    }, 300_000);

    for (const [kind, build] of [
      ['an earlier learn revision purged', (bound: number) => ({ h: Math.max(bound, 2) + 8, named: 3, from: 1, make: (h: number) => purgedEarlyTenant(host, h, 3) })],
      ['a retained baseline at learn revision 5', (bound: number) => ({ h: 5 + Math.max(bound, 2) + 7, named: 6, from: 5, make: (h: number) => baselineTenant(host, 5, h, 6) })],
    ] as const) {
      it(`host (${host}): under the configuration-revision setting a tenant with ${kind} — its count null for good — keeps only its ${BOUND_NAME} most recent learn revisions beside those the purge's other rules keep (the current and the previous, and one a stored decision names), and its next learn publication still carries the unknown, never a smaller number`, async () => {
        const bound = boundOf(), plan = build(bound), m = await plan.make(plan.h);
        const before = storedLearn(m), expected = keptUnder(before, plan.h, bound, plan.named);
        expect(before.length - expected.length, `PRECONDITION (${host}): ${before.length - expected.length} stored learn revisions lie past the bound, none of them the current, the previous or the one a decision names`).toBeGreaterThanOrEqual(6);
        setConfigurationRetention(m, 1);
        await pause(25);
        const publications = await catalogueUntil(m, publicationsFor(plan.h), () => JSON.stringify(storedLearn(m)) === JSON.stringify(expected));
        const kept = storedLearn(m);
        const next = await putLearn(m, learnOn(SALT_C, plan.h + 1));
        expect({ kept, next: [next.status, await annotationOf(m, plan.h + 1)] },
          `${host}: P99.PG3 — after ${publications} later publications the purge keeps the ${bound} most recent learn revisions, the current, the previous and revision ${plan.named} a decision names, and removes the rest; the count stays unknown (today saltCountCarried answers no for every null count, so every learn revision is kept for good)`)
          .toEqual({ kept: expected, next: [200, unknownOn(SALT_C)] });
      }, 600_000);
    }

    it(`host (${host}): LOCK (P95 SV2, SV4) — a count that could not finish for a transient storage failure is not one that can never be established: the operator's learn answers name no reason for good, every learn revision is kept under the setting until a publication establishes the count, and the next learn publication over a healthy store carries it exactly`, async () => {
      const h = Math.max(Number.isSafeInteger(BOUND) ? BOUND as number : 0, 24) + 8;
      const m = await mount(host, DOCS);
      expectPublished(m, 'P99 — the product page and the learn document on SALT_A publish');
      await publishLearnHistory(m, 2, h);
      await plantLearnHistory(m, (): Form => 'before');
      setConfigurationRetention(m, 1);
      await pause(25);
      const bucket = m.storage as unknown as Record<string, unknown>, get = (bucket.get as (...args: unknown[]) => Promise<unknown>).bind(m.storage);
      Object.defineProperty(bucket, 'get', { configurable: true, writable: true, value: async (...args: unknown[]) => {
        if (args[0] === learnKey(3)) throw new Error('P99 fixture: a transient object-store read failure');
        return get(...args);
      } });
      let failing: Answer;
      try { failing = await putLearn(m, learnOn(SALT_C, h + 1)); } finally { Reflect.deleteProperty(bucket, 'get'); }
      expect({ status: failing.status, annotation: await annotationOf(m, h + 1) }, `PRECONDITION (${host}): the learn publication whose count met the failing read is accepted and carries the unknown`)
        .toEqual({ status: 200, annotation: unknownOn(SALT_C) });
      const get2 = await getLearn(m), validate = await validateLearn(m, learnOn(SALT_C, h + 2));
      await catalogueUntil(m, publicationsFor(h), () => false);
      const kept = storedLearn(m);
      const healthy = await putLearn(m, learnOn(SALT_C, h + 2));
      expect({ told: { put: neverAdvised(failing), get: neverAdvised(get2), validate: neverAdvised(validate) }, kept, next: [healthy.status, await annotationOf(m, h + 2)] },
        `${host}: P99.PG3 LOCK — a transient failure is never told as a count lost for good, every learn revision is kept, and the next healthy publication counts SALT_A, SALT_B, SALT_C — 3`)
        .toEqual({ told: { put: [], get: [], validate: [] }, kept: range(1, h + 1), next: [200, { salt: SALT_C, version: 3 }] });
    }, 600_000);
  }

  it('logic: kit 02 states the advisory and the bound in its salt-version paragraph and its purge paragraph; the purge paragraph no longer says the purge keeps every learn revision wherever the current one carries no exact count; its carry and never-unknown sentences are kept', () => {
    const bound = Number.isSafeInteger(BOUND) && (BOUND as number) >= 1 ? BOUND as number : null, kit02 = readTree('docs/kit/02-api-reference.md');
    const salt = paragraphOf(kit02, KIT_SALT_OPENING), purge = kit02.split('\n').find(line => line.startsWith(KIT_PURGE_OPENING)) ?? '';
    const sentences = kitSentences(bound ?? `<${BOUND_NAME}>`);
    expect({
      bound: bound === null ? `${BOUND_NAME} is not exported (${String(BOUND)})` : 'the exported constant',
      salt: { never: salt.includes(sentences.saltNever), opening: salt.startsWith(KIT_SALT_OPENING) },
      purge: { still: purge.includes(sentences.purgeStill), never: purge.includes(sentences.purgeNever), today: purge.includes(KIT_PURGE_KEEPS_TODAY), carry: purge.includes(KIT_CARRY), noUnknown: purge.includes(KIT_PURGE_NO_UNKNOWN) },
    }, `P99.PG3 — kit 02 states, in the salt-version paragraph: "${sentences.saltNever}"; in the purge paragraph: "${sentences.purgeStill}" and "${sentences.purgeNever}" in place of "${KIT_PURGE_KEEPS_TODAY}", beside "${KIT_CARRY}" and "${KIT_PURGE_NO_UNKNOWN}"`)
      .toEqual({ bound: 'the exported constant', salt: { never: true, opening: true }, purge: { still: true, never: true, today: false, carry: true, noUnknown: true } });
  });
});

// ---------------------------------------------------------------------------
// The kit (reading R9: the sentences ruled verbatim, the bound written as the constant's decimal value).
// ---------------------------------------------------------------------------

/** The opening of kit 02's salt-version paragraph, as P100's HN3 finds it (unchanged). */
const KIT_SALT_OPENING = '`saltVersion` is 1 for the first salt';
/** The opening of kit 02's purge paragraph, as P95's SV5 finds it. */
const KIT_PURGE_OPENING = 'Configuration PUT/PATCH, import, pull, rollback and item reset require';
/** Today's sentence (src/units/P95/LEDGER.unit.test.ts KIT_PURGE_KEEPS, :300): untrue once a tenant can never establish the count. */
const KIT_PURGE_KEEPS_TODAY = 'Where the current learn revision carries none (a learn document published before this release, or a count that could not be finished), the purge keeps every learn revision, so the next learn publication can count over the whole stored history.';
/** Kept (P95's KIT_CARRY and KIT_PURGE_NEVER). */
const KIT_CARRY = 'A learn revision builds its salt count from the one before it where that one carries an exact count.';
const KIT_PURGE_NO_UNKNOWN = 'So a purge never turns an exact `saltVersion` into an unknown.';
function kitSentences(bound: number | string) {
  const never = 'Where the stored learn history can never establish it (a learn revision before the current one was purged, or the history starts at a retained baseline)';
  return {
    /** The salt-version paragraph: the advisory and the bound. */
    saltNever: `${never}, \`GET /content/learn\` and the answers of \`POST /content/learn/validate\` and \`PUT /content/learn\` carry an advisory naming the unknown \`saltVersion\` and why (\`revision_purged\` or \`legacy_history_unavailable\`), and under the \`configuration\` retention category the purge keeps only that tenant's ${bound} most recent learn revisions beside those its other rules keep.`,
    /** The purge paragraph: today's sentence narrowed to a count the stored history can still establish (the R10 of P95's KIT_PURGE_KEEPS). */
    purgeStill: 'Where the current learn revision carries none (a learn document published before this release, or a count that could not be finished) and the stored learn history can still establish it, the purge keeps every learn revision, so the next learn publication can count over the whole stored history.',
    /** The purge paragraph: the tenant whose count can never be established. */
    purgeNever: `${never}, the operator's learn reads say so and the purge removes that tenant's learn revisions older than its ${bound} most recent, under its other rules.`,
  };
}
/** The paragraph holding `marker`, white space normalised, or '' where there is none (P100's paragraphOf). */
function paragraphOf(text: string, marker: string): string {
  const where = text.indexOf(marker);
  if (where < 0) return '';
  const from = text.lastIndexOf('\n\n', where), to = text.indexOf('\n\n', where);
  return text.slice(from < 0 ? 0 : from, to < 0 ? undefined : to).replace(/\s+/g, ' ').trim();
}
