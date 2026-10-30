// src/units/P108/LEDGER.unit.test.ts
// P108 under the Closure Ledger (`tapestry-parity-gate-determinism`, ticket
// P108 "Exploration at share 1 explores every visitor", amendment 13 E32,
// R-P707): the tests for the LOCAL criteria XB1–XB3. LV1 is a deferred live row
// and gets no test. D1 (RESOLVED) is the rule every criterion is read under.
//
// One `describe('unit:P108.<criterion>')` per criterion. The witnesses:
//   · the work order (docs/parity/gate-determinism/program.json, P108): "at an
//     exploration share of 1 every visitor explores; at every share below 1 the
//     decision is identical to today's; a decision recorded before the fix
//     replays under its recorded rules unchanged; P04's N1/N2 CONTROL, and P10's
//     and P15's exploration controls where their share is below 1, draw a
//     pinned visitor at a pinned hour";
//   · D1 (R-P707): "the minimal fix — share 1 always explores — is chosen over
//     comparing the unrounded bucket, because the latter changes decisions at
//     every share's rounding boundary and the replay of recorded decisions";
//     effect "Only share 1 changes; every share below 1 is identical to today's,
//     and recorded decisions replay unchanged";
//   · the analysis (_evidence/parity-step3/S55/analyst-intermittents/DESIGN.md
//     §4): `explorationPick` (src/learn/explore.ts) rounds the visitor's bucket
//     to three decimals and refuses on `bucket >= share`, so a raw bucket of at
//     least 0.9995 rounds to 1.000 and does not explore at share 1 (94 of
//     200,000 random visitors, logs/p04-probe-share1.log; a pinned boundary
//     visitor fails P04.N2's CONTROL on both hosts, an interior one passes,
//     logs/p04-probe-pinned-visitor.log);
//   · the exploration contract (doc 22 §7; src/learn/explore.ts): rotation
//     serves the under-observed item with the fewest observations, ties by id,
//     and records the decision explored with its mode.
//
// THE READINGS THIS FILE RULES
//   XB1  At share 1, a boundary visitor (raw bucket >= 0.9995, FOUND through the
//        product's own `bucketOf` from a fixed sequence of identifiers,
//        src/units/P108/_pins.ts) explores: logic, on the visitor bucket and
//        on P30's context bucket, in every mode the live path runs (rotation,
//        epsilon, the adjacent swap); host, on both hosts, the decision of the
//        page's declared layout slot under P04's rotation dials records the
//        same exploration for the boundary visitor as for an interior one at
//        the same pinned hour (the CONTROL).
//   XB2  At every share below 1 the decision equals today's: logic, a fixed
//        corpus of visitors, contexts and hours (the boundary windows of every
//        share included: a raw bucket just under the share that rounds UP to
//        it, the one below that window, and one just over it), in every live
//        mode, with and without an item under a merchandiser's control, under
//        the current rules and under the rules before (`historicalRules`),
//        fingerprinted per share at the specification's base fedda087; host,
//        on both hosts, the layout slot's records for the boundary visitors of
//        shares 0.5 and 0.999 equal the records measured at fedda087. And a
//        decision recorded before the fix replays under its recorded rules
//        unchanged: a record that states no `explorationRules` replays under
//        HISTORICAL_EXPLORATION_RULES (src/learn/replay.ts), and under them the
//        whole corpus at share 1, the boundary visitors included, decides as at
//        fedda087 — a boundary visitor at share 1 was not explored then and is
//        not explored on replay.
//        R-P708 (round 2): decisions made under the fixed rule state a new
//        exploration-rules marker, `recorded-draws-v2`, beside the page manifest
//        (`inputs.explorationRules`, never inside `inputs.replay`); a decision
//        stating `recorded-draws-v1` replays under v1's share-1 refusal, and one
//        stating none under HISTORICAL_EXPLORATION_RULES, each exactly as
//        recorded. Logic (decideContent and replayDecision, unit:W28.R2's
//        idiom) and host, on both hosts (the serving route, the real ledger
//        producer and consumer, GET /v1/:tenant/replay/:decisionId): (a) the
//        decisions fedda087's engine RECORDED for the boundary visitor at share
//        1 (src/units/P108/_v1Records.ts, verbatim: v1, not explored) replay
//        equal, not explored; (b) the boundary visitor's decision made now
//        states recorded-draws-v2 beside the manifest, explores (rotation serves
//        editorial.1 first), and replays equal. The marker's words come from
//        R-P708 and the amended work order (50ad38ef); how the build names the
//        v1 tier in code is not ruled and is not read.
//   XB3  The controls' pinned subjects, read: P04 N1/N2's CONTROL draws
//        P04_CONTROL (an interior visitor) at PINNED_AT through the product's
//        mint (`drawnAs`, `atPinnedHour`), and it explores at P04's share of 1
//        under today's rule; P10's control (:367) and P15's (:434, :456) are at
//        share 1, so after XB1 every visitor explores there and the brief's
//        "where their share is below 1" asks no pin of them; a share below 1
//        on any of them without a pin turns XB3 RED.
//
// FINGERPRINTS (XB2) are today's decisions, recorded at fedda087 by running
// this file there: the work order rules "equals today's, recorded as a
// fingerprint at the specification's base". They are the only measured
// expectations in this file.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts);
// src/units/P108/_pins.ts (the pinned visitors, hours and seams);
// src/units/P108/_replay.ts (the logic and host worlds the marker is written and
// read in); src/units/P108/_v1Records.ts (the v1 records, captured at fedda087).
// No new export is imported.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { DecisionRecord } from '@/content/types';
import { replayDecision, replayDeps } from '@/learn/replay';
import { captureRetention } from '@/retention';
import {
  ADJACENT_SWAP, bucketOf, contextBucketOf, explorationPick, type ExploreConfig, type ExploreMode, HISTORICAL_EXPLORATION_RULES, hourKeyOf,
  recordedExplorationRules,
} from '@/learn/explore';
import type { LiftSnapshot } from '@/learn/stats';

import {
  declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learnDocument, M, MODULES, mount, recentSlot, replayOf, servePage, TENANT,
  toLedger, type Mounted, type Shopper,
} from '../_parity';
import {
  ANONYMOUS_SUBJECT, atPinnedHour, contextWhere, CORPUS_HOURS, isBoundary, isInterior, P04_CONTROL, PINNED_AT, roundedBucket,
  subjectOf, subjectWhere, uuidOf, type Pin,
} from './_pins';
import { hostRecords, hostWorld, logicReceipts, logicWorld, tabbyShopperAs } from './_replay';
import { V1_BOUNDARY_RECORDS } from './_v1Records';

/** The checkout this file lives in (never the cwd). */
const ROOT = new URL('../../../', import.meta.url);
const source = (rel: string) => readFileSync(new URL(rel, ROOT), 'utf8');

const BASE = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]) };
/** P04's exploring dials (src/units/P04/LEDGER.unit.test.ts EXPLORE_ALL): rotation at share `share`, floor 50. */
const exploring = (share: number) => learnDocument({ [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', exploration: { mode: 'rotation', share, floor: 50 } } });
const LIVE_MODES: readonly ExploreMode[] = ['rotation', 'epsilon', ADJACENT_SWAP];

/** The layout slot's records of one decision, in position order: position, module, explored, and the exploration it states. */
async function layoutRecords(m: Mounted, s: Shopper) {
  const records = (await servePage(m, s, 'pdp')).records.filter((r: DecisionRecord) => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
  return records.map(r => [r.position, r.item_id, r.explored, r.explain.exploration ? { mode: r.explain.exploration.mode, bucket: r.explain.exploration.bucket, reason: r.explain.exploration.reason } : null] as const);
}
const exploredOf = (records: Awaited<ReturnType<typeof layoutRecords>>) => records.filter(([, , explored]) => explored).map(([position, item, , exploration]) => [position, item, exploration?.mode ?? null]);

// The logic corpus: the shopper's ranking of P04 (src/units/P04 RANKED) with scores, and a snapshot that leaves
// two modules over the floor of 50, two under it with 3 observations and one with none.
const RANKED = [
  { id: M.reco2, score: 0.8125 }, { id: M.editorial, score: 0.625 }, { id: M.grid, score: 0.3125 }, { id: M.reco1, score: 0.2 }, { id: M.ugc, score: 0 }];
const SNAPSHOT = { items: {
  [M.reco2]: { '*': { n: 120, s: 12 } }, [M.editorial]: { '*': { n: 3, s: 1 } }, [M.grid]: { '*': { n: 60, s: 9 } }, [M.reco1]: { '*': { n: 3, s: 0 } },
} } as unknown as LiftSnapshot;
const CONTROLLED = new Set([M.reco1]);
const cfgOf = (mode: ExploreMode, share: number): ExploreConfig => ({ mode, share, floor: 50 });

describe('unit:P108.XB1', () => {
  it('logic: at an exploration share of 1, a boundary visitor (raw bucket at least 0.9995, which rounds to 1.000) explores in every mode the live path runs, on the visitor bucket and on the context bucket alike, exactly as an interior visitor does', () => {
    const boundary = subjectWhere(LAYOUT, PINNED_AT, isBoundary), interior = subjectWhere(LAYOUT, PINNED_AT, isInterior);
    const context = contextWhere(LAYOUT, PINNED_AT, isBoundary);
    expect([roundedBucket(boundary.raw), roundedBucket(context.raw)], 'PRECONDITION — the boundary visitor and context round to 1.000').toEqual([1, 1]);
    const pick = (visitorId: string, mode: ExploreMode, ctx?: string) =>
      explorationPick({ visitorId, slot: LAYOUT, nowMs: PINNED_AT, ranked: RANKED, snapshot: null, cfg: cfgOf(mode, 1), ...(ctx === undefined ? {} : { context: ctx }) });
    // CONTROL: the interior visitor explores in every mode, rotation drawing the under-observed module with the fewest observations, ties by id.
    expect(LIVE_MODES.map(mode => [mode, pick(interior.subject, mode)?.mode ?? null]), 'CONTROL — an interior visitor explores at share 1 in every live mode')
      .toEqual(LIVE_MODES.map(mode => [mode, mode]));
    const outcomes = [
      ...LIVE_MODES.map(mode => [`visitor ${boundary.subject} (raw ${boundary.raw}), ${mode}`, pick(boundary.subject, mode)?.mode ?? 'did not explore']),
      ...LIVE_MODES.map(mode => [`context ${context.context} (raw ${context.raw}), ${mode}`, pick(boundary.subject, mode, context.context)?.mode ?? 'did not explore']),
    ];
    expect(outcomes, 'P108.XB1 — at share 1 every visitor explores: the boundary visitor and the boundary context explore in every live mode')
      .toEqual([...LIVE_MODES.map(mode => [`visitor ${boundary.subject} (raw ${boundary.raw}), ${mode}`, mode]),
        ...LIVE_MODES.map(mode => [`context ${context.context} (raw ${context.raw}), ${mode}`, mode])]);
    expect(pick(boundary.subject, 'rotation')?.pieceId ?? null, 'P108.XB1 — the boundary visitor\'s rotation draws the under-observed module with the fewest observations, ties by id, as every draw does')
      .toBe(pick(interior.subject, 'rotation')?.pieceId);
  });

  for (const host of HOSTS) {
    it(`host (${host}): at an exploration share of 1 on the page's declared layout slot, a boundary visitor's decision is explored exactly as an interior visitor's is at the same pinned hour`, async () => {
      const boundary = subjectWhere(LAYOUT, PINNED_AT, isBoundary), interior = subjectWhere(LAYOUT, PINNED_AT, isInterior);
      await atPinnedHour(PINNED_AT, async () => {
        const m = await mount(host, { ...BASE, learn: exploring(1) });
        expectPublished(m, 'P108.XB1 — the declared layout slot exploring at share 1 publishes');
        const control = exploredOf(await layoutRecords(m, await tabbyShopperAs(m, interior)));
        // The shopper's ranking is reco.2, editorial.1, grid.1, reco.1, ugc.1 (P02.A2); every module holds 0 observations, so
        // rotation draws editorial.1 (fewest observations, ties by id) and serves it first, recorded explored.
        expect(control, `${host}: CONTROL — an interior visitor (raw ${interior.raw}) is explored: rotation serves editorial.1 first, recorded explored`)
          .toEqual([[0, M.editorial, 'rotation']]);
        const explored = exploredOf(await layoutRecords(m, await tabbyShopperAs(m, boundary)));
        expect(explored, `${host}: P108.XB1 — at share 1 the boundary visitor ${boundary.subject} (raw ${boundary.raw}, rounded 1.000) explores exactly as the interior one: editorial.1 served first, recorded explored with mode rotation`)
          .toEqual(control);
      });
    }, 90_000);
  }
});

// ---------------------------------------------------------------------------
// XB2's corpus. Shares below 1, the rounding boundaries included: three-decimal
// shares (the bucket's own grid), shares off that grid, and the ones next to 1.
// ---------------------------------------------------------------------------
const SHARES = [0, 0.001, 0.0015, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.999, 0.9994, 0.9995, 0.9999];
/** The windows around a share: just under it (rounds UP to it), the one under that (rounds below it), just over it, and the boundary of 1. */
const windowsOf = (share: number): Array<[string, number, number]> => ([
  [`[${share}-0.001, ${share}-0.0005)`, share - 0.001, share - 0.0005],
  [`[${share}-0.0005, ${share})`, share - 0.0005, share],
  [`[${share}, ${share}+0.0005)`, share, share + 0.0005],
] as Array<[string, number, number]>).filter(([, lo, hi]) => hi > 0 && lo < 1);
const ALL_WINDOWS: Array<[string, number, number]> = [...SHARES.flatMap(windowsOf), ['[0.9995, 1)', 0.9995, 1]];

/** The corpus of one hour: 32 identifiers of the fixed sequence, then the first one met in every window. */
const visitorCorpus = new Map<number, string[]>();
function visitorsAt(at: number): string[] {
  const known = visitorCorpus.get(at);
  if (known) return known;
  const hour = hourKeyOf(at), out = Array.from({ length: 32 }, (_, n) => subjectOf(uuidOf(n)));
  const open = new Map(ALL_WINDOWS.map(w => [w[0], w] as const));
  for (let n = 0; open.size > 0 && n < 400_000; n++) {
    const subject = subjectOf(uuidOf(n)), raw = bucketOf(subject, LAYOUT, hour);
    for (const [key, [, lo, hi]] of open) if (raw >= lo && raw < hi) { out.push(subject); open.delete(key); }
  }
  expect([...open.keys()], `PRECONDITION — every boundary window of the corpus is met at ${new Date(at).toISOString()}`).toEqual([]);
  visitorCorpus.set(at, out);
  return out;
}
/** The contexts of the pinned hour: 16 of a fixed sequence, then the first one met in every window. */
const contextCorpus = new Map<number, string[]>();
function contextsAt(at: number): string[] {
  const known = contextCorpus.get(at);
  if (known) return known;
  const hour = hourKeyOf(at), key = (n: number) => `pdp|paid_social|1|mobile|r${n}`;
  const out = Array.from({ length: 16 }, (_, n) => key(n));
  const open = new Map(ALL_WINDOWS.map(w => [w[0], w] as const));
  for (let n = 0; open.size > 0 && n < 400_000; n++) {
    const raw = contextBucketOf(key(n), LAYOUT, hour);
    for (const [k, [, lo, hi]] of open) if (raw >= lo && raw < hi) { out.push(key(n)); open.delete(k); }
  }
  expect([...open.keys()], 'PRECONDITION — every boundary window of the context corpus is met').toEqual([]);
  contextCorpus.set(at, out);
  return out;
}

type Rules = 'current' | 'historical';
/** Every decision of the corpus at one share: each hour, visitor or context, live mode, control set and rule set. */
function decisionsAt(share: number, rulesSets: readonly Rules[]) {
  const rows: unknown[] = [];
  let explored = 0;
  for (const at of CORPUS_HOURS) {
    const subjects: Array<{ visitorId: string; context?: string }> = visitorsAt(at).map(visitorId => ({ visitorId }));
    if (at === PINNED_AT) subjects.push(...contextsAt(at).map(context => ({ visitorId: subjectOf(uuidOf(0)), context })));
    for (const subject of subjects) for (const mode of LIVE_MODES) for (const controlled of [undefined, CONTROLLED]) for (const rules of rulesSets) {
      const pick = explorationPick({ ...subject, slot: LAYOUT, nowMs: at, ranked: RANKED, snapshot: SNAPSHOT, cfg: cfgOf(mode, share), ...(controlled ? { controlled } : {}) },
        undefined, rules === 'historical' ? HISTORICAL_EXPLORATION_RULES : undefined);
      if (pick) explored++;
      rows.push([at, subject.context ?? subject.visitorId, mode, controlled ? 'controlled' : 'free', rules, pick]);
    }
  }
  return { explored, digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 32) };
}

/** XB2's fingerprint, recorded at fedda087: per share, the decisions that explored and the digest of every decision. */
const FINGERPRINT_BELOW_1: Record<string, { explored: number; digest: string }> = {
  0: { explored: 0, digest: '928a648d435fe53040e711bc250d87ba' },
  0.001: { explored: 80, digest: 'ca1001afdb67af4abf7f92f4b41d5558' },
  0.0015: { explored: 272, digest: 'baa05e3ad1574c5c184d5d362cf4b1fb' },
  0.1: { explored: 514, digest: '36afaffd1b0a5a2579df24415505c0f3' },
  0.25: { explored: 840, digest: 'a2d649c35243f6dd6a07424922f4f840' },
  0.5: { explored: 1272, digest: '42d18d5ec279d4bfd65f4441331e7f53' },
  0.75: { explored: 1634, digest: '2393344aac7e5449dd1c5683b0842f4d' },
  0.9: { explored: 2082, digest: 'b70270588d7565ea6d85b9786d99e586' },
  0.95: { explored: 2298, digest: 'dc6191c86a9c818ffab82d27ad576c9e' },
  0.999: { explored: 2480, digest: '9766894f2782f81b56d503d5c87f81a6' },
  0.9994: { explored: 2816, digest: '35791f0590a7616de38a9079fff5e684' },
  0.9995: { explored: 2816, digest: '54a86d7ea1b4ec044701ffbe9aad9174' },
  0.9999: { explored: 2816, digest: 'ad8c9cd75be5ff6c7baeb08355e72cff' },
};
/** The replay fingerprint, recorded at fedda087: share 1 under the rules before (`historicalRules`). */
const FINGERPRINT_REPLAY_AT_1: { explored: number; digest: string } = { explored: 1340, digest: '38a620089196c406fee54cb3881236c9' };

/** XB2's host corpus: the boundary windows of shares 0.5 and 0.999 at the pinned hour on the layout slot. */
const HOST_SHARES = [0.5, 0.999];
const hostVisitors = (share: number): Array<[string, Pin]> => [
  [`[${share}-0.001, ${share}-0.0005)`, subjectWhere(LAYOUT, PINNED_AT, raw => raw >= share - 0.001 && raw < share - 0.0005)],
  [`[${share}-0.0005, ${share})`, subjectWhere(LAYOUT, PINNED_AT, raw => raw >= share - 0.0005 && raw < share)],
  [`[${share}, ${share}+0.0005)`, subjectWhere(LAYOUT, PINNED_AT, raw => raw >= share && raw < share + 0.0005)],
  ...(share > 0.99 ? [['[0.9995, 1)', subjectWhere(LAYOUT, PINNED_AT, isBoundary)] as [string, Pin]] : []),
];
/** The layout slot's records per host-corpus visitor, recorded at fedda087. */
/** The layout slot served with no draw: the shopper's ranking (P02.A2), take 4. */
const NOT_EXPLORED = [[0, M.reco2, false, null], [1, M.editorial, false, null], [2, M.grid, false, null], [3, M.reco1, false, null]];
/** Rotation drew editorial.1 (fewest observations, ties by id) and served it first, recorded explored with the rounded bucket. */
const EXPLORED = (bucket: number, share: number) => [[0, M.editorial, true, { mode: 'rotation', bucket, reason: `bucket ${bucket} < share ${share}: under-observed, n 0 < floor 50` }],
  [1, M.reco2, false, null], [2, M.grid, false, null], [3, M.reco1, false, null]];
const HOST_FINGERPRINT: Record<string, unknown> = {
  'share 0.5, raw [0.5-0.001, 0.5-0.0005)': EXPLORED(0.499, 0.5),
  'share 0.5, raw [0.5-0.0005, 0.5)': NOT_EXPLORED,
  'share 0.5, raw [0.5, 0.5+0.0005)': NOT_EXPLORED,
  'share 0.999, raw [0.999-0.001, 0.999-0.0005)': EXPLORED(0.998, 0.999),
  'share 0.999, raw [0.999-0.0005, 0.999)': NOT_EXPLORED,
  'share 0.999, raw [0.999, 0.999+0.0005)': NOT_EXPLORED,
  'share 0.999, raw [0.9995, 1)': NOT_EXPLORED,
};

// R-P708's marker legs: the boundary visitor of the pinned hour on the layout slot (the one XB1 explores).
const BOUNDARY: Pin = subjectWhere(LAYOUT, PINNED_AT, isBoundary);
const markerOf = (r: DecisionRecord) => (r.inputs as unknown as { explorationRules?: unknown } | undefined)?.explorationRules ?? null;
const inManifest = (r: DecisionRecord) => Object.prototype.hasOwnProperty.call((r.inputs as unknown as { replay?: object } | undefined)?.replay ?? {}, 'explorationRules');
/** What a v1 record states: its visitor, the hour's raw bucket of at least 0.9995, its marker, explored or not. */
const premisesOf = (records: DecisionRecord[]) => records.map(r => [r.visitor_id, isBoundary(bucketOf(r.visitor_id, LAYOUT, hourKeyOf(r.ts))), markerOf(r), r.explored]);
const V1_PREMISE = [BOUNDARY.subject, true, 'recorded-draws-v1', false];
/** One replay: the position, the module, the classification (or the refusal's reason), and whether the replayed decision explored. */
const replayOf1 = (r: DecisionRecord, classification: unknown, replayed: unknown, reason: unknown) =>
  [r.position, r.item_id, classification === 'equal' ? 'equal' : `${String(classification)}${reason ? ` (${String(reason)})` : ''}`, (replayed as DecisionRecord | undefined)?.explored ?? null];
/** What a decision made now states: the marker of each position, whether any carries it inside the manifest, what explored, how each replays. */
const madeOf = (made: DecisionRecord[], replays: unknown[]) => ({
  markers: made.map(markerOf), insideManifest: made.some(inManifest),
  explored: made.filter(r => r.explored).map(r => [r.position, r.item_id, r.explain.exploration?.mode ?? null]), replays,
});
/** The shopper's ranking is reco.2, editorial.1, grid.1, reco.1; every module holds 0 observations, so rotation draws editorial.1 (ties by id) and serves it first. */
const V2_EXPECTED = { markers: ['recorded-draws-v2', 'recorded-draws-v2', 'recorded-draws-v2', 'recorded-draws-v2'], insideManifest: false,
  explored: [[0, M.editorial, 'rotation']], replays: ['equal', 'equal', 'equal', 'equal'] };

describe('unit:P108.XB2', () => {
  it(`logic: at every exploration share below 1 (${SHARES.join(', ')}), the decision for each visitor, context and hour of a fixed corpus, the boundary windows of every share included, equals today's fingerprint, in every live mode, with and without a controlled module, under the current rules and the rules before`, () => {
    const measured = Object.fromEntries(SHARES.map(share => [String(share), decisionsAt(share, ['current', 'historical'])]));
    expect(measured, 'P108.XB2 — below share 1 every decision equals the one recorded at fedda087 (per share: the decisions that explored, the digest of all)')
      .toEqual(FINGERPRINT_BELOW_1);
  });

  it('logic: a decision recorded before the fix replays under its recorded rules unchanged — a record that states no explorationRules replays under the rules before, and under them every decision of the corpus at share 1, a boundary visitor\'s included, equals the one recorded at fedda087', () => {
    expect(recordedExplorationRules({}), 'PRECONDITION — a record that states no marker replays under the rules before (src/learn/replay.ts)').toBe('historical');
    expect(decisionsAt(1, ['historical']), 'P108.XB2 — at share 1 under the rules before, every decision of the corpus equals the one recorded at fedda087').toEqual(FINGERPRINT_REPLAY_AT_1);
    const boundary = subjectWhere(LAYOUT, PINNED_AT, isBoundary);
    const replayed = LIVE_MODES.map(mode => [mode, explorationPick({ visitorId: boundary.subject, slot: LAYOUT, nowMs: PINNED_AT, ranked: RANKED, snapshot: SNAPSHOT, cfg: cfgOf(mode, 1) },
      undefined, HISTORICAL_EXPLORATION_RULES)?.mode ?? 'not explored, as recorded']);
    expect(replayed, `P108.XB2 — the boundary visitor ${boundary.subject} (raw ${boundary.raw}) was not explored at share 1 before the fix, and its record replays so under the rules before`)
      .toEqual(LIVE_MODES.map(mode => [mode, 'not explored, as recorded']));
  });

  for (const host of HOSTS) {
    it(`host (${host}): at shares ${HOST_SHARES.join(' and ')} on the page's declared layout slot, the records of the visitors in each share's boundary windows at the pinned hour equal the ones recorded at fedda087`, async () => {
      const measured: Record<string, unknown> = {};
      await atPinnedHour(PINNED_AT, async () => {
        for (const share of HOST_SHARES) {
          const m = await mount(host, { ...BASE, learn: exploring(share) });
          expectPublished(m, `P108.XB2 — the declared layout slot exploring at share ${share} publishes`);
          for (const [window, pin] of hostVisitors(share)) measured[`share ${share}, raw ${window}`] = await layoutRecords(m, await tabbyShopperAs(m, pin));
        }
      });
      expect(measured, `${host}: P108.XB2 — below share 1 the layout slot's records equal the ones recorded at fedda087`).toEqual(HOST_FINGERPRINT);
    }, 120_000);
  }

  // R-P708 (a): the decisions recorded under recorded-draws-v1 replay as recorded.
  it('logic: (R-P708) the decisions fedda087\'s engine recorded under recorded-draws-v1 for the boundary visitor at share 1 — not explored, v1\'s share-1 refusal — replay as recorded: equal, not explored', async () => {
    const env = await logicWorld();
    const recorded = V1_BOUNDARY_RECORDS.logic.map(r => ({ ...structuredClone(r), retention: captureRetention(env, TENANT, r.ts) }));
    expect(premisesOf(recorded), 'PRECONDITION — the records are the boundary visitor\'s at share 1, stating recorded-draws-v1, none explored').toEqual(recorded.map(() => V1_PREMISE));
    const replays: unknown[] = [];
    for (const r of recorded) { const replay = await replayDecision(env, r, replayDeps(env)); replays.push(replayOf1(r, replay.classification, replay.replayed, replay.reason)); }
    expect(replays, 'P108.XB2 (R-P708) — a decision stating recorded-draws-v1 replays under v1\'s share-1 refusal, exactly as recorded: each position equal, the boundary visitor not explored')
      .toEqual(recorded.map(r => [r.position, r.item_id, 'equal', false]));
  });

  // R-P708 (b): a decision made under the fix states recorded-draws-v2 and explores.
  it('logic: (R-P708) the boundary visitor\'s decision at share 1 made now states recorded-draws-v2 beside the page manifest, explores (rotation serves editorial.1 first), and replays equal', async () => {
    const env = await logicWorld();
    const made = logicReceipts(env, BOUNDARY.subject);
    const replays: unknown[] = [];
    for (const r of made) { const replay = await replayDecision(env, r, replayDeps(env)); replays.push(replay.classification ?? replay.reason); }
    expect(madeOf(made, replays), 'P108.XB2 (R-P708) — a decision under the fixed rule states recorded-draws-v2 beside the manifest (never inside inputs.replay), the boundary visitor explores, and the decision replays equal')
      .toEqual(V2_EXPECTED);
  });

  for (const host of HOSTS) {
    it(`host (${host}): (R-P708) the decisions fedda087's engine recorded under recorded-draws-v1 for the boundary visitor at share 1, put in the ledger, replay through the replay route as recorded: equal, not explored`, async () => {
      const recorded = V1_BOUNDARY_RECORDS[host];
      expect(premisesOf(recorded), `${host}: PRECONDITION — the records are the boundary visitor's at share 1, stating recorded-draws-v1, none explored`).toEqual(recorded.map(() => V1_PREMISE));
      const replays: unknown[] = [];
      await atPinnedHour(PINNED_AT, async () => {
        const m = await hostWorld(host);
        await toLedger(m, structuredClone(recorded));
        for (const r of recorded) { const replay = await replayOf(m, r.decision_id); replays.push(replayOf1(r, replay.body.classification ?? replay.status, replay.body.replayed, replay.body.reason)); }
      });
      expect(replays, `${host}: P108.XB2 (R-P708) — a decision stating recorded-draws-v1 replays under v1's share-1 refusal, exactly as recorded: each position equal, the boundary visitor not explored`)
        .toEqual(recorded.map(r => [r.position, r.item_id, 'equal', false]));
    }, 90_000);

    it(`host (${host}): (R-P708) the boundary visitor's decision at share 1 served now states recorded-draws-v2 beside the page manifest, explores (rotation serves editorial.1 first), and replays equal through the replay route`, async () => {
      let made: DecisionRecord[] = [];
      const replays: unknown[] = [];
      await atPinnedHour(PINNED_AT, async () => {
        const m = await hostWorld(host);
        made = await hostRecords(m, await tabbyShopperAs(m, BOUNDARY));
        for (const r of made) { const replay = await replayOf(m, r.decision_id); replays.push(replay.body.classification ?? replay.body.reason ?? replay.status); }
      });
      expect(madeOf(made, replays), `${host}: P108.XB2 (R-P708) — a decision under the fixed rule states recorded-draws-v2 beside the manifest (never inside inputs.replay), the boundary visitor explores, and the decision replays equal`)
        .toEqual(V2_EXPECTED);
    }, 90_000);
  }
});

// ---------------------------------------------------------------------------
// XB3: the controls' pinned subjects, read.
// ---------------------------------------------------------------------------
/** The text of one describe block of a unit file, from its title to the next unit's. */
const blockOf = (text: string, unit: string, next: string) => {
  const from = text.indexOf(`describe('unit:${unit}'`), to = text.indexOf(`describe('unit:${next}'`);
  expect([from >= 0, to > from], `PRECONDITION — the block of unit:${unit} is found`).toEqual([true, true]);
  return text.slice(from, to);
};
/** The exploration share a learn constant of a unit file states for its exploring slot. */
const shareOf = (text: string, constant: string): number | null => {
  const line = text.split('\n').find(l => l.startsWith(`const ${constant} = learnDocument(`));
  const share = line?.match(/exploration: \{ mode: '[a-z-]+', share: ([0-9.]+)/)?.[1];
  return share === undefined ? null : Number(share);
};

describe('unit:P108.XB3', () => {
  it('logic: P04 N1/N2\'s CONTROL draws the pinned visitor P04_CONTROL at the pinned hour through the product\'s own mint, and that visitor explores at P04\'s share of 1 under today\'s rule', () => {
    expect([ANONYMOUS_SUBJECT.test(P04_CONTROL.subject), P04_CONTROL.subject === subjectOf(P04_CONTROL.uuid), P04_CONTROL.at, P04_CONTROL.slot],
      'P108.XB3 — the pinned subject has the mint\'s shape, is the mint\'s visitor for its identifier, at the pinned hour, on the layout slot').toEqual([true, true, PINNED_AT, LAYOUT]);
    const raw = bucketOf(P04_CONTROL.subject, LAYOUT, hourKeyOf(P04_CONTROL.at));
    expect([raw === P04_CONTROL.raw, roundedBucket(raw) < 1], `P108.XB3 — the pinned visitor's bucket (raw ${raw}) rounds below 1.000, so it explores at share 1 today and after the fix`).toEqual([true, true]);
    expect(explorationPick({ visitorId: P04_CONTROL.subject, slot: LAYOUT, nowMs: P04_CONTROL.at, ranked: RANKED, snapshot: null, cfg: cfgOf('rotation', 1) })?.mode ?? null,
      'P108.XB3 — under P04\'s dials (rotation, share 1, floor 50) the pinned visitor explores').toBe('rotation');
    const p04 = source('src/units/P04/LEDGER.unit.test.ts');
    const draws = [['N1', 'N2'], ['N2', 'N3']].map(([unit, next]) => {
      const block = blockOf(p04, `P04.${unit!}`, `P04.${next!}`);
      return [unit, block.split('atPinnedHour(P04_CONTROL.at').length - 1, block.split('drawnAs(P04_CONTROL').length - 1];
    });
    expect(draws, 'P108.XB3 — each of N1 and N2 builds its exploring world at the pinned hour and draws its CONTROL\'s shopper as the pinned visitor, once each')
      .toEqual([['N1', 1, 1], ['N2', 1, 1]]);
  });

  it('logic: P10\'s exploration control (:367) and P15\'s (:434, :456) are at share 1, where every visitor explores, so they need no pin; at a share below 1 each would draw a pinned visitor', () => {
    const p10 = source('src/units/P10/LEDGER.unit.test.ts'), p15 = source('src/units/P15/LEDGER.unit.test.ts');
    const controls = [
      ['P10 :367, at floor 0 the slot explores', shareOf(p10, 'F2_LEARN'), /drawnAs\(/.test(blockOf(p10, 'P10.F2', 'P10.F3'))],
      ['P15 :434 and :456, the rotation draws', shareOf(p15, 'ROTATION_LEARN'), /drawnAs\(/.test(blockOf(p15, 'P15.M1', 'P15.M2'))],
    ] as const;
    expect(controls.map(([name, share, pinned]) => [name, share === 1 ? 'share 1: every visitor explores' : pinned ? 'pinned' : `share ${share} without a pinned visitor`]),
      'P108.XB3 — each exploration control either explores every visitor (share 1) or draws a pinned visitor at a pinned hour')
      .toEqual(controls.map(([name, share]) => [name, share === 1 ? 'share 1: every visitor explores' : 'pinned']));
  });
});
