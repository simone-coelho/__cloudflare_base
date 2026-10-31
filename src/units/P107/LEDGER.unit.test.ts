// src/units/P107/LEDGER.unit.test.ts
// P107 under the Closure Ledger (programme `tapestry-parity-pack-proof`, amendment 13, item E35): the tests for the LOCAL
// criteria RC1–RC7 of the P107 work order (docs/parity/pack-proof/program.json at rem/integration ba189a75; ruling R-P741
// adopting _evidence/parity-step3/S59/analyst-p107/DESIGN.md §3, decisions D1–D4). LV1 is a deferred live row and gets
// no test.
//
// THE REQUIREMENT, as the work order states it: "the purge proves a catalogue pack, and an object stored before packs,
// unnamed from a reach ledger it keeps itself from the immutable stored revisions, reading only the revisions committed
// since the ledger's watermark, never every stored revision; the walk keeps removing up to 16 revisions per publication at
// any count, and a refused load's pack or a stage never published is collected; every object today's code writes stays
// byte-identical."
//
// TODAY (spec head 285f58f7 = P105's join 75f2279f with rem/integration ba189a75; the purge is c9e135bd's, +31 lines):
// src/config/publication.ts purgeByPolicy's `examine` proves a pack-table revision's packs unnamed by reading the other
// stored bodies nearest first until each pack is found (none stops the search when the revision alone names one); a
// revision stored before packs reads every other body and each peer's shard (`othersOf`, `peerResolver`); and
// sweepCatalogue reads every stored body's table after every catalogue publication. All within PURGE_OPERATIONS 256 and
// PURGE_BYTES 16 MiB. The design measured (DESIGN.md §1.4): 37 and 245–250 body reads per publication at 35 and 263
// stored revisions; 0, 1, 1 revisions removed and the stage kept at 263; 54 body reads and 114 peer-shard reads, the
// pre-pack revision kept and 6 objects left beside 64 pack revisions.
//
// THE SPECIFIER'S READINGS (the lead may re-rule):
//   P1 A body read is a read of a content revision (`…/content/rev/<n>.json`) after the publication's commit, whole or by
//      a range other than the first 4,096 bytes; that range is the revision's time header (`revisionTime`), not a body.
//   P2 A shard read is any read of a pack (whole or a range of it), a product shard, an id shard, a part or an id index.
//   P3 "The publication's own" reads (RC1) are the body reads the same catalogue load makes with no setting, measured in
//      the leg (today: its own revision, once, after the purge). A purge's reads are a publication's body reads less those.
//   P4 "The ledger covers every stored revision" is read from what the purges did, never from the ledger object (its key
//      and form are the builder's, DESIGN.md §2.1): a revision is covered once a purge under the setting read its body, or
//      committed it and read every stored revision below it (./_reach.ts Seen). No watermark that never passes a body
//      not read can cover more, so a leg conditioned on coverage never demands more than the design's ledger gives.
//   P5 "Within 256 calls and 16 MiB" (RC2) is the purge's calls after the commit (the publication's calls after its commit
//      less the same load's with no setting) and the bytes those calls read.
//   P6 A revision eligible for removal (RC2) is a stored content revision two or more behind the one committed (a stored
//      successor follows it), every one of them past the 1 ms setting; no stored decision names any (none is served).
//   P7 RC4's "earlier release" is simulated as the work order says: a revision written with no setting. RC4's "in-request
//      begun resume" is the same import re-sent with its headers after its commit failed (publishSet's `previous` path
//      finishes the pending set with no purge); the "recover-route finish" is POST /content/catalog/publication/recover.
//   P8 RC5 (a): a stop is the purge's k-th call failing (a storage fault, P98's meter), for every k from the first to the
//      last of the purge's calls in an unstopped twin; the watermark never passing the last body read is seen as the next
//      purge reading every revision no purge has covered (P4) — an injected fault stops the pass, so the RED variant of
//      the work order (the watermark written as the highest listed revision when a pass stops on the budget) is met by a
//      second leg in which the first pass stops on the budget at 263 stored revisions and nothing may be lost after it.
//   P9 RC5 (b): the newcomer commits after the older purge's sweep lists content/ids/ then content/rev/ (the window of P98
//      LD6 R-P646 (1)), before its first deletion check, with no purge of its own (the setting read as absent for its
//      request, as an earlier release's write). The older purge then deletes nothing; the newer purge (the next
//      publication's) reads the newcomer's body, keeps what it names and collects what nothing names.
//   P10 RC7: "exactly today's calls" is the ordered list of calls (operation and object class) a catalogue load with no
//      setting makes at the spec head, measured here on both hosts (TODAYS_NO_SETTING_LOAD); "touches no ledger key" is
//      no call on, and no stored object at, a key under the catalogue's directory outside the classes today's code writes.
//      Byte-identity of every object today's code writes is P106 PC1/PC3's, run unchanged in the acceptance command.
//   P11 RC5 (a)'s "everything a stored revision names stays": a revision whose removal began keeps its body until the
//      objects only it names are gone (P86, P93: R-P487 (8); the design keeps that order), so right after a stop what only
//      such a revision names may be missing; every revision still stored once the next publications (two, up to four
//      while one is unfinished) have run names nothing missing, as P99 PG2 reads it. RC6's "nothing lost" is every other
//      stored revision's objects, the planted revision being the one under removal.
//
// Every leg is registered with NO_TIME_CAP (0: no timeout) and asserts no clock: counts only. Synthetic names; tenant ids.

import { describe, expect, it } from 'vitest';

import { asOperator, HOSTS, loadDocument, TENANT, type Answer, type Host, type Mounted } from '../_parity';
import { classOf, importJson, preconditions, rangeRecords, show } from '../P93/_catalog';
import { packTable, recoverOf, stageOf, type Call } from '../P98/_load';
import { cold, contentBodies, lost, packKey, pause, plantRevision, reached, routed, setConfigurationRetention, slotsPublication, storedContent, unnamed } from '../P99/_purge';
import { allRead, baselineOf, bytesReadAfterCommit, callsAfterCommit, catalogueLoad, clearConfigurationRetention, CONTENT_DIR, DAY_MS, health, isBodyRead, later, load,
  oneProduct, outsideTodaysClasses, purgeReads, removed, revisionOfKey, rewriting, Seen, sequenceAfterCommit, shardReads, tenant, twinBaseline, unusualCall, type Baseline,
  type Publication } from './_reach';

const NO_TIME_CAP = 0;
const PURGE_CALLS = 256, PURGE_BYTES = 16 * 1024 * 1024, PURGE_CANDIDATES = 16;
const sortedNumbers = (list: Iterable<number>) => [...list].sort((a, b) => a - b);
const stagePack = (stage: unknown) => `${CONTENT_DIR}pack/${String(stage).split('.')[0]}.pack`;
/**
 * Whether a stored catalogue value names an object stored before packs, as src/config/publication.ts `namesLegacy` and
 * the manifest's `legacy` count state it: P86's parts, P93's shards and id shards (no pack table), or a pack-table
 * manifest whose `legacy` count (every pointer without a byte range, content.ts) is not 0.
 */
function namesBeforePacks(value: Record<string, unknown>): boolean {
  const products = value.products, index = value.index as { packs?: unknown; legacy?: unknown; shards?: object; ids?: object } | undefined;
  if (products && typeof products === 'object' && Object.keys(products).length) return true;
  if (!index || typeof index !== 'object') return false;
  if (!Array.isArray(index.packs)) return Object.keys(index.shards ?? {}).length + Object.keys(index.ids ?? {}).length > 0;
  return index.legacy !== 0;
}

/** The design's tenant (DESIGN.md §1.4): K loads (rewriting products 1–4, or one product each) with no setting, then a stage never published, then a load with no setting (the baseline). */
async function storedTenant(host: Host, K: number, form: 'rewriting' | 'one product'): Promise<{ m: Mounted; stage: string; base: Baseline }> {
  const m = await tenant(host);
  for (let i = 1; i <= K; i++) await load(m, form === 'rewriting' ? rewriting(i) : oneProduct(i), `v${i}`);
  cold();
  const staged = await stageOf(m, rangeRecords(900, 2));
  expect(staged.status, `PRECONDITION (${host}): a stage never published is left (${show(staged)})`).toBe(200);
  const base = await load(m, rangeRecords(2000, 1, ' base'), 'base (no setting)');
  return { m, stage: stagePack(staged.body.stage), base: baselineOf(base) };
}

interface Pass { label: string; before: number; unseen: number; covered: boolean; reads: number; readsUnseen: number; shards: number; calls: number; bytes: number; removed: number; eligible: number; status: number; watched: boolean }
/**
 * Later one-product catalogue loads under the setting (each metered), until `coveredWanted` of them started covered
 * (P4), or one that started uncovered read no body it had not covered (no progress), or `cap` loads.
 */
async function laterLoads(m: Mounted, base: Baseline, seen: Seen, coveredWanted: number, cap: number, watch = ''): Promise<{ passes: Pass[]; covered: Publication[] }> {
  const passes: Pass[] = [], covered: Publication[] = [];
  for (let p = 1; p <= cap && covered.length < coveredWanted; p++) {
    const unseen = seen.unseen(contentBodies(m)), startCovered = unseen.length === 0;
    const pub = await catalogueLoad(m, later(3000 + p, `later ${p}`), `later ${p}`);
    const reads = purgeReads(pub, base);
    passes.push({ label: pub.label, before: pub.before.length, unseen: unseen.length, covered: startCovered, reads: reads.length, readsUnseen: reads.filter(n => unseen.includes(n)).length,
      shards: shardReads(pub) - base.shards, calls: callsAfterCommit(pub) - base.calls, bytes: bytesReadAfterCommit(pub) - base.bytes, removed: removed(pub).length,
      eligible: pub.before.filter(n => n <= pub.committed - 2).length, status: pub.answer.status, watched: m.storage.objects.has(watch) });
    seen.note(pub, base);
    if (startCovered) covered.push(pub);
    else if (!passes.at(-1)!.readsUnseen || pub.answer.status !== 200) break;
  }
  return { passes, covered };
}
const brief = (passes: Pass[]) => passes.map(p => `${p.label}: ${p.before} stored, ${p.unseen} uncovered${p.covered ? ' (covered)' : ''}, ${p.reads} bodies read (${p.readsUnseen} uncovered), ${p.shards} shards, ${p.calls} calls, ${p.removed} removed, ${p.status}`).join('; ');

// ===========================================================================
// unit:P107.RC1 — the proof reads what changed
// ===========================================================================

describe('unit:P107.RC1 (E35 RC1: once the reach ledger covers every stored revision, a catalogue publication\'s purge reads no body beyond the publication\'s own and no shard)', () => {
  for (const host of HOSTS) {
    for (const K of [32, 260]) {
      it(`host (${host}): ${K} four-product loads, each rewriting every part it carries, then the retention setting at 1 ms: once the purges cover every stored revision, each of the next three catalogue publications' purges reads no content body beyond the bodies the same load reads with no setting, and no shard (RED at c9e135bd: 37 and 245–250 body reads per publication)`, async () => {
        const { m, base } = await storedTenant(host, K, 'rewriting');
        expect(base.offsets, `PRECONDITION (${host}): a catalogue load with no setting reads its own revision's body once after its commit`).toEqual([0]);
        setConfigurationRetention(m, 1);
        await pause(25);
        const seen = new Seen(), { passes, covered } = await laterLoads(m, base, seen, 3, K + 6);
        const observed = { covered: covered.length, steady: passes.filter(p => p.covered).map(p => ({ bodies: p.reads, shards: p.shards, status: p.status })) };
        expect(observed, `${host}: P107.RC1 (K = ${K}) — once covered, each catalogue publication's purge reads no body and no shard (${brief(passes)})`)
          .toEqual({ covered: 3, steady: [0, 0, 0].map(() => ({ bodies: 0, shards: 0, status: 200 })) });
      }, NO_TIME_CAP);
    }
  }
});

// ===========================================================================
// unit:P107.RC2 — no stall past one budget; migration by ordinary publications
// ===========================================================================

describe('unit:P107.RC2 (E35 RC2: 263 stored revisions written with no setting — the purges cover them within the budget, then remove min(16, eligible) a publication and collect the stage)', () => {
  for (const host of HOSTS) for (const form of ['rewriting', 'one product'] as const) {
    it(`host (${host}): 263 stored revisions written with no setting (no ledger) by ${form === 'rewriting' ? 'four-product loads rewriting every part' : 'one-product loads'}, a stage never published: each later catalogue publication's purge, within ${PURGE_CALLS} calls and 16 MiB, reads at least one stored revision no purge has covered until every one is covered (ordinary publications only: no route, script or operator step); from then on each publication removes min(16, eligible) content revisions, the stage's pack is gone after the first publication that starts covered, and nothing a stored revision names is lost (RED at c9e135bd: 0, 1, 1 removed and the stage kept)`, async () => {
      const { m, stage, base } = await storedTenant(host, 260, form);
      expect({ stored: contentBodies(m).length, stage: m.storage.objects.has(stage) }, `PRECONDITION (${host}): 263 stored content revisions and the stage's pack`).toEqual({ stored: 263, stage: true });
      setConfigurationRetention(m, 1);
      await pause(25);
      const seen = new Seen(), { passes, covered } = await laterLoads(m, base, seen, 3, 270, stage);
      const stageAfter = passes.find(p => p.covered)?.watched ?? 'never covered';
      const migration = passes.filter(p => !p.covered).map(p => ({ progress: p.readsUnseen >= 1, calls: p.calls <= PURGE_CALLS, bytes: p.bytes <= PURGE_BYTES, status: p.status }));
      const steady = passes.filter(p => p.covered).map(p => ({ removed: p.removed, calls: p.calls <= PURGE_CALLS, bytes: p.bytes <= PURGE_BYTES, status: p.status }));
      const end = await health(m, [1, 2, 3, 4, ...passes.map((_, i) => 3001 + i)]);
      expect({ migration, covered: covered.length, steady, stageAfter, lost: end.lost, reads: end.reads },
        `${host}: P107.RC2 — the purges cover the stored revisions within the budget, then remove min(16, eligible) a publication and collect the stage (${brief(passes)})`).toEqual({
        migration: migration.map(() => ({ progress: true, calls: true, bytes: true, status: 200 })), covered: 3,
        steady: passes.filter(p => p.covered).map(p => ({ removed: Math.min(PURGE_CANDIDATES, p.eligible), calls: true, bytes: true, status: 200 })),
        stageAfter: false, lost: [], reads: allRead([1, 2, 3, 4, ...passes.map((_, i) => 3001 + i)]) });
    }, NO_TIME_CAP);
  }
});

// ===========================================================================
// unit:P107.RC3 — re-entry
// ===========================================================================

describe('unit:P107.RC3 (E35 RC3: a rollback names an old pack again; the setting shortened, nothing a stored revision names is lost and nothing unnamed is left)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a rollback to a revision inside the setting names its pack again (re-entry); the setting then shortened to 1 ms, three slots publications and one catalogue load: the re-entered pack stays, the product reads 200, nothing a stored revision names is lost and nothing no stored revision names is left (P99's census) (RED: a ledger ignoring re-entry loses the pack and the product answers 503)`, async () => {
      const m = await tenant(host);
      setConfigurationRetention(m, DAY_MS);
      const first = await load(m, rewriting(1), 'v1');
      await load(m, rewriting(2), 'v2');
      await load(m, rewriting(3), 'v3');
      cold();
      const back = await asOperator(m, 'POST', `/content/catalog/rollback/${first.committed}?scope=${TENANT}`, {}, await preconditions(m));
      cold();
      const current = await loadDocument(m, 'catalog');
      const tableOf = (n: number) => packTable(storedContent(m).find(([k]) => k === n)?.[1] ?? {});
      const reentered = tableOf(first.committed).filter(d => tableOf(current.revision).includes(d));
      expect({ back: back.status, reentered: reentered.length >= 1 }, `PRECONDITION (${host}): the rollback to revision ${first.committed} answers 200 and its revision names a pack of the target's again (${show(back)})`)
        .toEqual({ back: 200, reentered: true });
      setConfigurationRetention(m, 1);
      await pause(25);
      for (let p = 1; p <= 3; p++) await slotsPublication(m, `p107-reentry-${p}`);
      await load(m, rangeRecords(5000, 1, ' after'), 'after');
      const end = await health(m, [1, 2, 3, 4, 5000]);
      expect({ stays: reentered.map(d => m.storage.objects.has(packKey(d))), lost: end.lost, unnamed: unnamed(m), reads: end.reads },
        `${host}: P107.RC3 — the re-entered pack stays and the census is clean`).toEqual({ stays: reentered.map(() => true), lost: [], unnamed: [], reads: allRead([1, 2, 3, 4, 5000]) });
    }, NO_TIME_CAP);
  }
});

// ===========================================================================
// unit:P107.RC4 — revisions no purge saw
// ===========================================================================

describe('unit:P107.RC4 (E35 RC4: the next purge reads exactly the revisions no purge saw, before it judges any pack, and deletes nothing they name)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): under the setting four loads; then revisions no purge saw — two loads with no setting, an earlier release's revision written with no setting, a recover-route finish and the in-request begun resume of a load whose commit failed; then the setting at 1 ms and one catalogue load: its purge reads exactly those five bodies, each once, before its first deletion, and nothing a stored revision names is lost (RED: the watermark trusted without catch-up, the load answers 503 part_unavailable)`, async () => {
      const m = await tenant(host);
      setConfigurationRetention(m, DAY_MS);
      for (let i = 1; i <= 4; i++) await load(m, rewriting(i), `v${i}`);
      const unseen: number[] = [];
      clearConfigurationRetention(m);
      for (const [i, label] of [[5, 'no setting'], [6, 'no setting'], [7, 'an earlier release (no setting)']] as const) unseen.push((await load(m, rewriting(i), `v${i}, ${label}`)).committed);
      setConfigurationRetention(m, DAY_MS);
      const failing = (i: number) => catalogueLoad(m, rewriting(i), `v${i}, commit failing`, c => c.head === 'commit' ? 'throw' : undefined);
      const toRecover = await failing(8);
      cold();
      const recovered = await recoverOf(m, toRecover.headers);
      cold();
      unseen.push((await loadDocument(m, 'catalog')).revision);
      const toResume = await failing(9);
      const resumed = await catalogueLoad(m, rewriting(9), 'v9, re-sent', undefined, undefined, toResume.headers);
      unseen.push(resumed.committed);
      expect({ pending: [toRecover.answer.body.state, toResume.answer.body.state], recovered: recovered.status, resumed: resumed.answer.status, resumedPurged: resumed.calls.some(c => c.phase === 'committed' && c.op === 'list'), revisions: unseen.length === new Set(unseen).size },
        `PRECONDITION (${host}): the two loads' commits fail pending; the recover route and the re-sent load each finish one with no purge (${show(recovered)}; ${show(resumed.answer)})`)
        .toEqual({ pending: ['pending', 'pending'], recovered: 200, resumed: 200, resumedPurged: false, revisions: true });
      const base = await twinBaseline(host);
      setConfigurationRetention(m, 1);
      await pause(25);
      const next = await catalogueLoad(m, rangeRecords(6000, 1, ' after'), 'after');
      const reads = purgeReads(next, base), calls = next.calls.filter(c => c.phase === 'committed');
      const firstDelete = calls.findIndex(c => c.op === 'delete');
      const lastUnseenRead = Math.max(-1, ...calls.map((c, i) => isBodyRead(c) && unseen.includes(revisionOfKey(c.key)!) ? i : -1));
      const end = await health(m, [1, 2, 3, 4, 6000]);
      expect({ status: next.answer.status, reads, beforeDeletion: firstDelete < 0 || lastUnseenRead < firstDelete, lost: end.lost, reads200: end.reads },
        `${host}: P107.RC4 — the next purge reads exactly the revisions no purge saw (${sortedNumbers(unseen).join(', ')}) and loses nothing (${show(next.answer)})`).toEqual({
        status: 200, reads: sortedNumbers(unseen), beforeDeletion: true, lost: [], reads200: allRead([1, 2, 3, 4, 6000]) });
    }, NO_TIME_CAP);
  }
});

// ===========================================================================
// unit:P107.RC5 — stops and races
// ===========================================================================

interface Stop { k: number; call: string; status: number; lostKept: string[]; nextReadUncovered: boolean; next: number[]; end: { lost: string[]; reads: Record<string, number> } }
describe('unit:P107.RC5 (E35 RC5: (a) the purge stopped at each of its calls in turn, or on its budget, loses nothing and the watermark never passes the last body read; (b) a publication committed inside another\'s purge: the older deletes nothing, the newer reads the newcomer)', () => {
  for (const host of HOSTS) {
    /** Four loads under the setting (a ledger kept), four with no setting (to catch up), a stage never published, a baseline load, then the setting at 1 ms. */
    const build = async (base: Baseline) => {
      const m = await tenant(host), seen = new Seen();
      setConfigurationRetention(m, DAY_MS);
      for (let i = 1; i <= 4; i++) seen.note(await load(m, rewriting(i), `v${i}`), base);
      clearConfigurationRetention(m);
      for (let i = 5; i <= 8; i++) await load(m, rewriting(i), `v${i}, no setting`);
      cold();
      expect((await stageOf(m, rangeRecords(900, 2))).status, `PRECONDITION (${host}): a stage never published is left`).toBe(200);
      setConfigurationRetention(m, 1);
      await pause(25);
      return { m, seen };
    };
    it(`host (${host}): (a) the purge stopped at each of its calls in turn (its reading of what it keeps, each body it reads to catch up, its write, each deletion: the k-th call failing, for every k): the publication answers 200, everything a stored revision names stays (but what only a revision under removal names, its body kept until the next publications finish it), the next purge reads every stored revision no purge has covered (the watermark never passes the last body read), and the next publications (two, up to four while a removal is unfinished) finish with nothing lost`, async () => {
      const base = await twinBaseline(host), full = await build(base);
      const unstopped = await catalogueLoad(full.m, later(3001, 'stopped'), 'unstopped');
      // The purge's calls: those after the commit that the same load makes with no setting are the publication's own (today
      // three before the purge, seven after it).
      const purgeCalls = callsAfterCommit(unstopped) - base.calls, sequence = sequenceAfterCommit(unstopped);
      let prefix = 0;
      while (prefix < base.sequence.length && sequence[prefix] === base.sequence[prefix]) prefix++;
      expect({ status: unstopped.answer.status, purgeCalls: purgeCalls >= 1, prefix: prefix < base.sequence.length }, `PRECONDITION (${host}): unstopped, the purge makes ${purgeCalls} calls after the commit, from its ${prefix + 1}th call after the commit`).toEqual({ status: 200, purgeCalls: true, prefix: true });
      const stops: Stop[] = [];
      for (let k = 1; k <= purgeCalls; k++) {
        const { m, seen } = await build(base);
        let afterCommit = 0, failed: Call | null = null;
        const stopped = await catalogueLoad(m, later(3001, 'stopped'), `stopped at ${k}`, c => {
          if (c.phase !== 'committed' || ++afterCommit !== prefix + k) return undefined;
          failed = c; return 'throw';
        });
        // Reading P11: a revision whose removal began holds its body until the objects only it names are gone (P86, P93:
        // R-P487 (8)); what it alone named may be missing after a stop, and the next publications finish its removal.
        const missingAfterStop = new Map(contentBodies(m).map(n => [n, lost(m, [n])] as const).filter(([, keys]) => keys.length));
        seen.note(stopped, base);
        const uncovered = seen.unseen(contentBodies(m));
        const next = await catalogueLoad(m, later(3002, 'next'), 'next');
        const nextReads = purgeReads(next, base);
        seen.note(next, base);
        const statuses = [next.answer.status];
        for (let i = 3; i <= 5 && (i === 3 || lost(m, contentBodies(m)).length); i++) statuses.push((await catalogueLoad(m, later(3000 + i, `after ${i}`), `after ${i}`)).answer.status);
        const end = await health(m, [1, 2, 3, 4, ...statuses.map((_, i) => 3001 + i), 3001 + statuses.length]);
        const f = failed as Call | null;
        stops.push({ k, call: f ? `${f.op} ${classOf(f.key)}` : 'none', status: stopped.answer.status,
          lostKept: [...missingAfterStop].filter(([n]) => contentBodies(m).includes(n)).flatMap(([n, keys]) => keys.map(key => `${n}: ${key}`)),
          nextReadUncovered: uncovered.every(n => nextReads.includes(n)), next: statuses, end });
      }
      expect(stops, `${host}: P107.RC5 (a) — stopped at each of the purge's ${purgeCalls} calls in turn, nothing is lost and the next purge reads what no purge covered`)
        .toEqual(stops.map(s => ({ ...s, status: 200, lostKept: [], nextReadUncovered: true, next: s.next.map(() => 200), end: { lost: [], reads: allRead([1, 2, 3, 4, ...s.next.map((_, i) => 3001 + i), 3001 + s.next.length]) } })));
    }, NO_TIME_CAP);

    it(`host (${host}): (a) a pass that stops on its budget — 263 stored revisions written with no setting, then the setting at 1 ms: the first publication's purge spends its budget before it has read every stored body; after it and each of the next two publications every load answers 200, nothing a stored revision names is lost and every product reads 200 (RED: the watermark written as the highest listed revision when a pass stops on the budget)`, async () => {
      const { m, base } = await storedTenant(host, 260, 'rewriting');
      setConfigurationRetention(m, 1);
      await pause(25);
      const seen = new Seen(), rounds: Array<{ status: number; lost: string[]; reads: Record<string, number> }> = [];
      let firstCovered: boolean | null = null;
      for (let p = 1; p <= 3; p++) {
        const pub = await catalogueLoad(m, later(3000 + p, `later ${p}`), `later ${p}`);
        seen.note(pub, base);
        if (p === 1) firstCovered = seen.covers(contentBodies(m));
        const end = await health(m, [1, 2, 3, 4, 3001, 3002, 3003].slice(0, 4 + p));
        rounds.push({ status: pub.answer.status, lost: end.lost, reads: end.reads });
      }
      expect(firstCovered, `PRECONDITION (${host}): the first pass stopped on its budget before covering every stored revision`).toBe(false);
      expect(rounds, `${host}: P107.RC5 (a) — after a pass that stops on its budget nothing is lost`).toEqual([1, 2, 3].map(p => ({ status: 200, lost: [], reads: allRead([1, 2, 3, 4, 3001, 3002, 3003].slice(0, 4 + p)) })));
    }, NO_TIME_CAP);

    it(`host (${host}): (b) a publication commits inside another's purge, after its sweep lists content/ids/ then content/rev/ and before its first deletion check, with no purge of its own: the older purge deletes nothing (the stage it would collect stays); the next publication's purge reads the newcomer's body, keeps everything a stored revision names and collects the stage (RED: the head check removed from deleteWhileIdle)`, async () => {
      const m = await tenant(host);
      setConfigurationRetention(m, DAY_MS);
      for (let i = 1; i <= 4; i++) await load(m, rewriting(i), `v${i}`);
      cold();
      const staged = await stageOf(m, rangeRecords(900, 2)), stage = stagePack(staged.body.stage);
      expect(staged.status, `PRECONDITION (${host}): a stage never published is left`).toBe(200);
      const base = await twinBaseline(host);
      let armed = false, from = -1, to = -1, newcomer: Answer | null = null, newcomerRevision = 0;
      const older = await catalogueLoad(m, later(3001, 'older'), 'older', undefined, async (call, meter) => {
        if (from >= 0 || call.phase !== 'committed') return;
        if (call.op === 'list' && call.key === `${CONTENT_DIR}ids/`) { armed = true; return; }
        if (!armed || call.op !== 'list' || call.key !== `${CONTENT_DIR}rev/`) return;
        from = meter.calls.length;
        clearConfigurationRetention(m);
        cold();
        newcomer = await importJson(m, later(4001, 'newcomer'), { mode: 'merge' }, await preconditions(m));
        cold();
        newcomerRevision = (await loadDocument(m, 'catalog')).revision;
        setConfigurationRetention(m, DAY_MS);
        to = meter.calls.length;
      });
      expect({ fired: from >= 0, newcomer: (newcomer as Answer | null)?.status ?? null }, `PRECONDITION (${host}): the newcomer committed inside the older purge's sweep`).toEqual({ fired: true, newcomer: 200 });
      const olderDeletes = older.calls.filter((c, i) => c.phase === 'committed' && c.op === 'delete' && (i < from || i >= to)).length;
      const stageAfterOlder = m.storage.objects.has(stage);
      const newer = await catalogueLoad(m, later(3002, 'newer'), 'newer');
      const end = await health(m, [1, 2, 3, 4, 3001, 3002, 4001]);
      expect({ older: older.answer.status, olderDeletes, stageAfterOlder, newerReadsNewcomer: purgeReads(newer, base).includes(newcomerRevision), stageAfterNewer: m.storage.objects.has(stage), lost: end.lost, reads: end.reads },
        `${host}: P107.RC5 (b) — the older purge deletes nothing once the newcomer committed; the newer reads it`).toEqual({
        older: 200, olderDeletes: 0, stageAfterOlder: true, newerReadsNewcomer: true, stageAfterNewer: false, lost: [], reads: allRead([1, 2, 3, 4, 3001, 3002, 4001]) });
    }, NO_TIME_CAP);
  }
});

// ===========================================================================
// unit:P107.RC6 — the pre-pack body
// ===========================================================================

describe('unit:P107.RC6 (E35 RC6: a revision stored before packs beside 64 pack revisions is removed reading only the revisions that name objects stored before packs, and no peer shard)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): one revision in P93's form (planted) beside 64 pack revisions, then the setting at 1 ms and two catalogue loads: no purge reads a body beyond the revisions no purge had covered and the revisions naming objects stored before packs, nor any peer shard; the planted revision and the objects only it names are gone after the two, nothing lost (RED at c9e135bd: 54 body reads and 114 peer-shard reads, the revision kept and 6 objects left)`, async () => {
      const m = await tenant(host);
      const batch = routed(rangeRecords(1, 4, ' planted'));
      const planted = await plantRevision(m, batch.parts, batch.shared, 'p107-planted');
      for (let i = 1; i <= 64; i++) await load(m, rewriting(i), `v${i}`);
      const legacy = storedContent(m).filter(([, value]) => namesBeforePacks(value)).map(([n]) => n);
      const ownObjects = [...reached(m, [planted])], others = reached(m, contentBodies(m).filter(n => n !== planted));
      const onlyIt = ownObjects.filter(key => !others.has(key));
      expect({ legacy, onlyIt: onlyIt.length >= 1 }, `PRECONDITION (${host}): only the planted revision ${planted} names objects stored before packs (the 64 later revisions' legacy count is 0), and some objects only it names`).toEqual({ legacy: [planted], onlyIt: true });
      const base = await twinBaseline(host);
      setConfigurationRetention(m, 1);
      await pause(25);
      const seen = new Seen(), rows: Array<{ beyond: number[]; peerShards: number; status: number }> = [];
      const peer = (c: Call) => c.op === 'get' && c.phase === 'committed' && (c.cls === 'pack' || ((c.cls === 'shard' || c.cls === 'idshard') && !ownObjects.includes(c.key)));
      for (let p = 1; p <= 2; p++) {
        const uncovered = seen.unseen(contentBodies(m));
        const pub = await catalogueLoad(m, later(7000 + p, `later ${p}`), `later ${p}`);
        rows.push({ beyond: purgeReads(pub, base).filter(n => !uncovered.includes(n) && !legacy.includes(n)), peerShards: pub.calls.filter(peer).length - base.shards, status: pub.answer.status });
        seen.note(pub, base);
      }
      const end = await health(m, [1, 2, 3, 4, 7001, 7002]);
      expect({ rows, planted: contentBodies(m).includes(planted), left: onlyIt.filter(key => m.storage.objects.has(key)), lost: lost(m, contentBodies(m).filter(n => n !== planted)), reads: end.reads },
        `${host}: P107.RC6 — the pre-pack revision is removed reading only the legacy revisions and no peer shard`).toEqual({
        rows: [1, 2].map(() => ({ beyond: [], peerShards: 0, status: 200 })), planted: false, left: [], lost: [], reads: allRead([1, 2, 3, 4, 7001, 7002]) });
    }, NO_TIME_CAP);
  }
});

// ===========================================================================
// unit:P107.RC7 — locks and parity
// ===========================================================================

/**
 * Reading P10: the calls (operation and object class, in order) a catalogue load of one new product makes with no
 * setting, after eight loads rewriting products 1–4, measured at the spec head 285f58f7 on both hosts. Ten come after the
 * commit (DESIGN.md §1.4's base: 10).
 */
const TODAYS_NO_SETTING_LOAD = [
  'get head', 'get set', 'get head', 'get set', 'get content revision', 'get pack', 'get pack', 'put pack', 'put head', 'get head', 'get set', 'put content revision',
  'put set', 'get reflex revision', 'get learn revision', 'get prior revision', 'get slots revision', 'put head',
  'get head', `put config-publication/v2/${TENANT}/serving.json`, 'get set', 'get content revision', 'get head', 'get set', 'get slots revision', 'get head', 'get set', 'get reflex revision'];
const TODAYS_AFTER_COMMIT = 10;
describe('unit:P107.RC7 (E35 RC7: with no setting exactly today\'s calls and no ledger key; under the setting the sweep\'s window still fires; the locks are run unchanged)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a tenant that never sets the retention setting: nine catalogue loads touch no key outside the classes today's code writes under the catalogue's directory and store none, and the ninth makes exactly today's calls (${TODAYS_AFTER_COMMIT} after its commit) (RED: the ledger kept without the setting, which moves the base count)`, async () => {
      const m = await tenant(host), loads: Publication[] = [];
      for (let i = 1; i <= 8; i++) loads.push(await load(m, rewriting(i), `v${i}`));
      const ninth = await load(m, rangeRecords(2000, 1, ' base'), 'ninth (no setting)');
      loads.push(ninth);
      expect({ calls: ninth.calls.map(c => `${c.op} ${c.cls}`), afterCommit: callsAfterCommit(ninth), unusual: loads.flatMap(p => p.calls.filter(unusualCall).map(c => `${p.label}: ${c.op} ${c.key}`)),
        stored: [...m.storage.objects.keys()].filter(outsideTodaysClasses) },
      `${host}: P107.RC7 — with no setting, exactly today's calls and no ledger key`).toEqual({ calls: TODAYS_NO_SETTING_LOAD, afterCommit: TODAYS_AFTER_COMMIT, unusual: [], stored: [] });
    }, NO_TIME_CAP);

    it(`host (${host}): LOCK (P98 LD6 R-P646 (1)) — under the setting, the catalogue publication whose sweep collects a stage never published lists content/ids/, then content/rev/, before it reads the head and deletes the stage's pack`, async () => {
      const { m, stage } = await storedTenant(host, 8, 'rewriting');
      setConfigurationRetention(m, 1);
      await pause(25);
      const pub = await catalogueLoad(m, later(3001, 'later'), 'later');
      const after = pub.calls.filter(c => c.phase === 'committed');
      const deleting = after.findIndex(c => c.op === 'delete' && c.key.includes(stage));
      const head = deleting < 0 ? -1 : after.slice(0, deleting).map(c => c.op === 'get' && c.cls === 'head').lastIndexOf(true);
      const rev = head < 0 ? -1 : after.slice(0, head).map(c => c.op === 'list' && c.key === `${CONTENT_DIR}rev/`).lastIndexOf(true);
      const ids = rev < 0 ? -1 : after.slice(0, rev).map(c => c.op === 'list' && c.key === `${CONTENT_DIR}ids/`).lastIndexOf(true);
      const between = rev < 0 ? [] : after.slice(rev + 1, head).filter(c => c.op === 'get' && c.cls === 'head');
      expect({ status: pub.answer.status, deleted: deleting >= 0, order: ids >= 0 && rev > ids && head > rev, headReadBetween: between.length },
        `${host}: P107.RC7 — the sweep lists content/ids/ then content/rev/ before it reads the head (${after.map(c => `${c.op} ${c.cls === c.key ? c.key.replace(CONTENT_DIR, '') : c.cls}`).join(', ').slice(0, 600)})`)
        .toEqual({ status: 200, deleted: true, order: true, headReadBetween: 0 });
    }, NO_TIME_CAP);
  }
});
