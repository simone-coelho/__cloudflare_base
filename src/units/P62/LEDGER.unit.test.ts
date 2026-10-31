// src/units/P62/LEDGER.unit.test.ts
// P62 under the Closure Ledger: the tests for the LOCAL criteria of the P62 work
// order (the lift-witness programme, amendment 6, ticket P62 "The lift witness
// tolerates the edge: named, configurable budgets with an edge-sized default, a light
// witness door, and a same-generation superseded copy served with asOf"). D1 and D2
// (RESOLVED, R-P110 decisions 1 and 2) are exercised inside LW1 and LW3; LV1 is a
// deferred live row and gets no test.
//
// One `describe('unit:P62.<criterion>')` per LOCAL criterion, every host leg walked
// on both shopper hosts. Expected values come from the work order and the witnesses
// it cites, never from what the engine answers today:
//   · THE AUTHORITY, verbatim (docs/parity/authority/amendment-6/BTI-Parity-Amendment-2026-10-19b.md,
//     section 2, P62): "(a) The lift witness budget and the ring read budget are
//     exported named constants, overridable by a validated, bounded environment value,
//     with code defaults sized for the edge from the engine's own measured object cost
//     and a per-call round trip, derived in the specification; W38 B7's "a health
//     answer 200 ms late serves nothing" keeps its property as "budget plus margin" in
//     R10 form. (b) The statistics object answers a light witness door from a verdict
//     cached at commit or publish, never re-reading or digesting its whole state; the
//     existing health door stays for operators. (c) A copy whose `{version, digest}` is
//     among the object's recent publications within a bounded window, with the same
//     witness (same configuration, fence and projection) and a healthy state, is
//     served; the record then carries `explain.lift.asOf { version, publishedAt,
//     latest }` only when the copy is not the latest, so no current unit changes.
//     Unchanged: `compatible()`, the refusal of a digest the object never published,
//     the generation and fence binding, `state === 'healthy'`, the P42 `stale` and P49
//     `republished` members, no lift read on the default arm, the page-scoped witness,
//     the ring's "never extends a decision by more than its budget", and the publish
//     order (`learnPublished` before the KV put)."
//   · R-P110 (_evidence/parity-step3/AMENDMENTS.md): decision 1, "the code default is
//     raised (sized for the edge, derived in the specification from the measured object
//     cost and the ACK-LAT per-call estimate) … the W38 B7 lock keeps its property with
//     the literal replaced"; decision 2, "F2 accepted as bounded above"; "a light
//     `POST /witness` door answering from a verdict cached at publish".
//   · THE ANALYSIS (_evidence/baseline-52/lift-budget/ANALYSIS.md at 452d2c38): §1 rows
//     3, 3a, 3b, 4; §3 E1, E2b, E3, E4; §4; §5 F2, F3, the must-not-change list and the
//     RED tests R1-R4, R6; §6 (the hosted laps).
//
// THE DEFAULTS, DERIVED (R-P110 decision 1; the analysis's own measurements):
//   · O, the statistics object's own work per witness call at the acceptance pair's
//     scale: `/health` p50 11.3 ms, max 12.7 ms at 426 KB and 1 600 events (§3 E2b),
//     taken at its maximum, 13 ms.
//   · R, one round trip from the edge to a Durable Object: ACK-LAT's per-call estimate,
//     130-180 ms (a HYPOTHESIS fitted to the hosted logs:
//     _evidence/baseline-52/ack-latency/ANALYSIS.md:8, :140, :222), taken at its top,
//     180 ms.
//   · LIFT_WITNESS_BUDGET_MS = R + O = 193 ms, rounded up to the next 10 ms: 200 ms.
//     It is above every witness lap the edge showed (the pair's warm laps 19-44 ms, §6;
//     the served laps 21-69 ms of L7's PW3 probe and 36-96 ms of CH5's six served
//     records, §2) by at least twice the largest, and it is 1/25 of the SDK's
//     ACK_DEADLINE_MS (5 000 ms, src/sdk/core.ts:21), which cuts every request the SDK
//     makes, the decision included, so a decision waiting out the whole budget keeps
//     4.8 s of the SDK's deadline.
//   · RING_READ_BUDGET_MS: the ring read is the same shape (one hop to the visitor's
//     DecisionRing, `/recent`, src/learn/fan.ts:864): R = 180 ms; the ring's own read is
//     not measured, and the ring is bounded (RING_MAX = 200 entries,
//     src/durable-objects/DecisionRing.ts:37), far below the statistics object's
//     426 KB, so O's 13 ms allowance stands for it: 200 ms.
//   · THE OVERRIDE'S BOUNDS: the environment values `LIFT_WITNESS_BUDGET_MS` and
//     `RING_READ_BUDGET_MS` (the constants' own names) are admitted when they are the
//     decimal text of a whole number of milliseconds greater than 0 and less than
//     ACK_DEADLINE_MS (5 000): a budget of 0 can never be met, and one of the SDK's
//     whole deadline or more lets one read outlast the request that waits on it.
//   · THE WINDOW'S FLOOR: `LIFT_RECENT_WINDOW_MS` (the analysis's "bounded window, e.g.
//     10 min, a named constant", §5 F2) is at least LIFT_TTL_MS (60 000 ms: how long an
//     isolate holds a copy, src/content/service.ts:108) plus the largest store
//     propagation the pair showed (55 800 ms, logs/hosted-L3-lift-kv-lag.txt, §1 row
//     1): 115 800 ms; otherwise its value is the builder's.
//
// THE MEMBERS AND THE DOOR, RULED (R-P15; R-P7 for every explain member compared in
// replay):
//   · src/learn/fan.ts exports `LIFT_WITNESS_BUDGET_MS = 200`, `RING_READ_BUDGET_MS =
//     200` and `LIFT_RECENT_WINDOW_MS` (≥ 115 800); the decision path's witness and
//     ring read use them unless an admitted override applies. R10 (amendment 10, P72;
//     R-P236/R-P237, test-only, R-P195's form): the defaults are P72's to state (600 ms
//     each); this file reads them as the exported constants wherever it pinned 200, and
//     keeps the 100 ms its titles name for a read inside the default.
//   · `sources.budgets` on every answer: `{ lift, ring }`, the budgets in force for the
//     decision (ms), with `refused` — the names of the refused overrides, sorted — only
//     when an override was refused. A refused override leaves the default in force.
//   · `POST /witness` on LearnStats (the body `/health` takes: tenant, brand, slot,
//     page) answers 200 `{ ok: true, tenant, brand, slot, state, publication, witness, … }`
//     whose `state`, `publication` and `witness` are those `/health` answers for the
//     same state; the decision path's witness calls it and never `/health`. On an object
//     that has committed or published since it started, it reads no `learn` entry (no
//     `get`, no listing) and digests no input the size of its state. `/health` keeps
//     today's members and its whole-state `digest` for operators.
//     R-P112(5): the FIRST door call of an object started since its last commit or
//     publication (an evicted object) may read its stored state once, to establish its
//     verdict, and never digests it (no input of the state's size); a second call reads
//     none; a stored state damaged as W23 H1.01 damages it makes that first answer report
//     the state /health reports, `recovery-required`, never `healthy`.
//   · A served copy that is not the object's latest publication, recognised inside the
//     window, is applied and its record's `explain.lift` carries
//     `asOf: { latest, publishedAt, version }` (keys sorted): `version` and `publishedAt`
//     the copy's own, `latest` the version of the object's latest publication. A copy
//     that is the latest carries no `asOf`. The record names the copy it decided with
//     (`versions.lift`), and replays equal.
//     The window (R-P112(6)): it runs from the copy's PUBLICATION (its `publishedAt`).
//     A copy published at T is accepted at T + LIFT_RECENT_WINDOW_MS − 1 ms and refused
//     at T + LIFT_RECENT_WINDOW_MS + 1 ms, whenever it was superseded (seconds after T,
//     or half a window after T); the units read those two instants on a clock held still
//     for the read (`frozenAt`), so a decision's own run cannot move it across the edge.
//     A bound on the count of publications kept is allowed beside it (two or three
//     publications here).
//   · R-P113: a copy that is still the object's latest publication but whose witness
//     changed after a reset (an explicit reset and new evidence: the fence moved) is
//     not applied, and the answer names the outcome `unrecognized` (the publication the
//     object now confirms is not that copy's), never `superseded`.
//
// RULED MEMBERS AND EXPORTS THAT DO NOT EXIST YET (read loosely, so no new type error):
// the three constants (src/learn/fan.ts, read through src/units/_parity9.ts
// `fanExports`); `sources.budgets`; the `/witness` door; `explain.lift.asOf`.
//
// BOUNDARY (R-P112(2): src/learn/replay.ts joins P62's allowed paths for the carry; the
// replay test stays): a record served with `asOf` cannot replay equal
// unless the replay carries the served record's `asOf` (src/learn/replay.ts
// `replayDecision`, beside the `measurementBasis`/`objective` carry at :577-580; the
// replay recomputes `explain.lift` from the archived copy, which holds no `asOf`, and
// `compareRecords` compares it by value at :93). src/learn/replay.ts is not in P62's
// allowed paths: measured on the sketch, LW3's replay leg is GREEN with a one-line
// carry in replay.ts and RED without it (`diff` on explain.lift;
// _evidence/parity-step3/S11/specifier/logs/sketch-noreplay-p62.log).
//
// THE RING'S BOUND (R-P112(1): made true by P62, not restated): the ring's "never
// extends a decision by more than its budget" is not true on the request path today. `readRing` stops waiting at its budget
// (src/learn/fan.ts:859-872) but leaves the ring call running, and the shopper's owner
// drains every call started inside it before it answers
// (src/identity/sessionAuthority.ts `runOwnerOperation`, :538-546), so the answer waits
// for the ring: measured on both hosts, a ring answering 1 000 ms late holds the answer
// about 1 000 ms (_evidence/parity-step3/S11/specifier/logs/probe-h.log), and a ring that
// never answers holds it past the budget plus RING_BOUND_SLACK_MS (LW4's leg, RED today). The witness does not have
// this defect: it aborts its call at its budget (fan.ts:30-43). A sketch that aborts the
// ring call at its budget the same way (src/learn/fan.ts, inside P62's allowed paths)
// turns the leg GREEN.
//
// R10 (expectations that lock present behaviour; R-P112(3): the updates below are the
// specifier's, joined with the build). R10'd in this batch, in its own commit: the W38 B7 late-answer lock
// (src/units/W38/LEDGER.unit.test.ts:857-866, "budget plus margin"). Measured RED under
// a sketch of P61 and P62 (the whole suite on a scratch copy of this tree,
// _evidence/parity-step3/S11/specifier/logs/sketch2-full.*, against the same copy
// without the sketch, base-full.*), none edited here:
//   · src/units/W38/LEDGER.unit.test.ts:519 (unit:W38.B4): its statistics stub answers
//     the witness on `/health` only and `{ ok: true }` on every other path, so the
//     decision path's `/witness` call reads no witness answer and B4's lift versions
//     read 0. R10 form: the stub answers `/witness` as it answers `/health`.
//   · src/content/consent.test.ts:757-763, :778, :786-787, :794 (W10.03 "checks actual
//     serving health"): counts and holds the decision path's witness calls on `/health`.
//     R10 form: count and hold `/witness`.
//   · src/content/consent.test.ts:813-816 (W24.01): the stub answers the witness on
//     `/health` only. R10 form: on `/witness` as well.
//   · src/index.api-boundary.test.ts:284 and :1724-1726 (W10.03 native): the
//     `hold-health` fault holds `/health` only, and the witness under it must refuse in
//     under 400 ms. R10 form: the fault holds `/witness` too (the 400 ms bound holds at
//     the 200 ms default).
//   · src/learn/learn.test.ts:1771 (W06.06): advances fake timers 60 ms, today's ring
//     default, and times out at RING_READ_BUDGET_MS = 200. R10 form: advance by
//     RING_READ_BUDGET_MS.
// Measured GREEN but without teeth under the raised budget (a mutant that digests the
// whole snapshot inside the witness budget passes it at 200 ms and fails it at 50 ms,
// logs/sketch-w38b7-mutant.log, base-w38b7-mutant.log): src/units/W38/LEDGER.unit.test.ts:831
// (W38 B7's main leg advances its fake timers 60 ms, today's budget plus 10). R10 form:
// advance by the budget in force plus 10. Outside this batch's grant (the late-answer
// lock only); listed for the lead.
//
// FIXTURE. P61's (src/units/_parity9.ts `liftWorld`): P08's pooled world as P42.PW3
// drives it, the product page's slot carrying P10's fatigue dial. LW4's page-scoped leg
// uses P08's catalogue without the pooled declaration under a RETAINED pages document
// carrying the product page's slot name on the product and home pages (W26 R2's case).
//
// HARNESS: src/units/_parity.ts, _parity3.ts, _parity6.ts, _parity9.ts. Imports from
// src/units/: ../_parity, ../_parity3, ../_parity6, ../_parity9.

import { describe, expect, it, vi } from 'vitest';

import { invalidateLiftCache } from '@/content/service';
import type { DecisionRecord } from '@/content/types';
import { liftKey, LIFT_WITNESS_BUDGET_MS, RING_READ_BUDGET_MS, statsName } from '@/learn/fan';
import { recoveryDigest } from '@/ledger/recovery';
import { ACK_DEADLINE_MS } from '@/sdk/core';

import { asOperator, BRAND, expectPublished, HOSTS, mount, putDocument, replayOf, shopperOn, TENANT, type Mounted } from '../_parity';
import { publishStats } from '../_parity3';
import { dials, failPooledDoor, learnOf, liftOf, objectPublish, P08_PIECES, visit } from '../_parity6';
import {
  copyLever, copyOf, damageAndRestart, decide, digestLog, fanExports, fatigued, firePublicationAlarm, forged, HOME_MODULES, inForce, kvReadLog, later,
  liftOnRecord, liftReadOf, liftWorld, objectDoor, PDP_MODULES, placementOf, republish, restartObject, ringLever, sourcesMember, witnessLever, type Copy,
  type StorageLog,
} from '../_parity9';

/** The defaults: the exported constants (R10, amendment 10 P72: 200 ms each until P72, then 600 ms; the header). */
const LIFT_DEFAULT_MS = LIFT_WITNESS_BUDGET_MS, RING_DEFAULT_MS = RING_READ_BUDGET_MS;
/** A read inside either default: the 100 ms the titles name (twice today's 50 ms literal, above the edge's largest served witness lap, 96 ms). */
const INSIDE_MS = 100;
/** The window's derived floor (header): LIFT_TTL_MS plus the largest observed store propagation. */
const WINDOW_FLOOR_MS = 60_000 + 55_800;
/**
 * LW4's ring bound (R-P113): how far past the ring budget a decision whose ring call
 * is abandoned at the budget may answer in this harness — the harness's own scheduling
 * slack, not the product's. Measured on the S11 sketch at a machine load of 11
 * (_evidence/parity-step3/S11/specifier/logs/fix1-slack-probe.log, 15 decisions per
 * host): with the ring held, the decision answers 13-19 ms after the ring budget; with
 * the ring answering at once, it takes 13-19 ms. 300 ms is about fifteen times the
 * largest, room for a loaded machine, and under a third of the 1 000 ms that a ring
 * call aborted one second late would add (the reviewer's mutant m7a).
 */
const RING_BOUND_SLACK_MS = 300;
/**
 * R-P112(6): runs `work` with `Date.now()` held at `time` (timers and `performance.now()`
 * stay real), so a read happens at that instant however long the decision takes.
 */
async function frozenAt<T>(time: number, work: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(time);
  try { return await work(); } finally { spy.mockRestore(); }
}

const UNSERVED = { version: 0, lift: null };
const servedFrom = (version: number) => ({ version, lift: expect.objectContaining({ lift: expect.any(Number), n: expect.any(Number) }) });
/** A named constant of src/learn/fan.ts, asserted to exist (the P56.AA2 idiom): its value. */
async function named(name: string, words: string): Promise<number> {
  const fan = await fanExports();
  expect(typeof fan[name], `P62 — ${words} is not a named constant: src/learn/fan.ts exports no number ${name}`).toBe('number');
  return fan[name] as number;
}
const setEnv = (m: Mounted, values: Record<string, string>) => { Object.assign(m.env as unknown as Record<string, unknown>, values); };
/** The pooled module's itemised lift on a record, or a sentence. */
const itemisedLift = (record: DecisionRecord | undefined): Record<string, unknown> | string =>
  (record?.explain.lift as Record<string, unknown> | null | undefined) ?? `no itemised lift on the record (${JSON.stringify(liftOnRecord(record)).slice(0, 120)})`;
/** `explain.lift.asOf` of a record, or a sentence naming its absence. */
const asOfOf = (record: DecisionRecord | undefined): unknown => {
  const lift = itemisedLift(record);
  return typeof lift === 'string' ? lift : Object.hasOwn(lift, 'asOf') ? lift.asOf : `no asOf member (explain.lift members: ${Object.keys(lift).join(', ')})`;
};
/** The ruled `asOf` for a copy served while `latest` is the object's latest publication (keys sorted, R-P7). */
const asOf = (copy: Copy, latest: Copy) => ({ latest: latest.version, publishedAt: copy.publishedAt, version: copy.version });

// ===========================================================================
// unit:P62.LW1 — named budgets, an edge-sized default, a bounded override
// ===========================================================================

describe('unit:P62.LW1 (R-P110 decision 1)', () => {
  it('logic: the lift witness budget and the ring read budget are exported named constants of src/learn/fan.ts at their edge-sized defaults (R10, amendment 10 P72: the exported defaults), under the SDK\'s deadline', async () => {
    const lift = await named('LIFT_WITNESS_BUDGET_MS', 'the lift witness budget');
    const ring = await named('RING_READ_BUDGET_MS', 'the ring read budget');
    expect({ lift, ring }, 'P62.LW1 — the code defaults are the exported ones (R10, amendment 10 P72 states their value)').toEqual({ lift: LIFT_DEFAULT_MS, ring: RING_DEFAULT_MS });
    expect(Math.max(lift, ring) < ACK_DEADLINE_MS, 'P62.LW1 — both are inside the SDK\'s deadline').toBe(true);
  });

  for (const host of HOSTS) {
    it(`host (${host}): with no override, a witness answering in 100 ms (twice today's 50 ms literal, above the largest witness lap the edge showed on a served decision, 96 ms) is applied and one answering 10 ms after LIFT_WITNESS_BUDGET_MS is not; the ring answering in 100 ms fatigues and 10 ms after RING_READ_BUDGET_MS does not; sources.budgets names the defaults`, async () => {
      const { m, v1 } = await liftWorld(host);
      const witness = witnessLever(m), ring = ringLever(m);
      witness.delay(INSIDE_MS); ring.delay(INSIDE_MS);
      const first = await decide(m, 'pdp');
      const inside = await decide(m, 'pdp', { shopper: first.shopper });
      expect(liftOnRecord(inside.record), `${host}: P62.LW1 — the edge-sized default applies a copy whose witness answers in ${INSIDE_MS} ms`).toEqual(servedFrom(v1!.version));
      expect(fatigued(inside.snapshot), `${host}: P62.LW1 — and fatigues from a ring answering in ${INSIDE_MS} ms`).toBe(true);
      const lift = await named('LIFT_WITNESS_BUDGET_MS', 'the lift witness budget'), ringBudget = await named('RING_READ_BUDGET_MS', 'the ring read budget');
      witness.delay(lift + 10); ring.delay(ringBudget + 10);
      const late = await decide(m, 'pdp', { shopper: first.shopper });
      witness.restore(); ring.restore();
      expect(liftOnRecord(late.record), `${host}: P62.LW1 — a witness answer ${lift + 10} ms late serves nothing`).toEqual(UNSERVED);
      expect(fatigued(late.snapshot), `${host}: P62.LW1 — a ring answer ${ringBudget + 10} ms late fatigues nothing`).toBe(false);
      expect(sourcesMember(late.snapshot, 'budgets'), `${host}: P62.LW1 — sources.budgets names the budgets the decision ran under`).toEqual({ lift: LIFT_DEFAULT_MS, ring: RING_DEFAULT_MS });
    }, 120_000);

    it(`host (${host}): an admitted override (LIFT_WITNESS_BUDGET_MS and RING_READ_BUDGET_MS set to "120") is in force: a witness answering in 60 ms is applied and one answering in 130 ms is not, the ring the same, and sources.budgets names 120 and 120`, async () => {
      const { m, v1 } = await liftWorld(host);
      setEnv(m, { LIFT_WITNESS_BUDGET_MS: '120', RING_READ_BUDGET_MS: '120' });
      const witness = witnessLever(m), ring = ringLever(m);
      witness.delay(60); ring.delay(60);
      const first = await decide(m, 'pdp');
      const inside = await decide(m, 'pdp', { shopper: first.shopper });
      witness.delay(130); ring.delay(130);
      const late = await decide(m, 'pdp', { shopper: first.shopper });
      witness.restore(); ring.restore();
      expect(liftOnRecord(inside.record), `${host}: P62.LW1 — under the 120 ms override a witness answering in 60 ms is applied`).toEqual(servedFrom(v1!.version));
      expect(fatigued(inside.snapshot), `${host}: P62.LW1 — and a ring answering in 60 ms fatigues`).toBe(true);
      expect(liftOnRecord(late.record), `${host}: P62.LW1 — under the 120 ms override a witness answering in 130 ms serves nothing (under the default it would serve)`).toEqual(UNSERVED);
      expect(fatigued(late.snapshot), `${host}: P62.LW1 — and a ring answering in 130 ms fatigues nothing`).toBe(false);
      expect(sourcesMember(late.snapshot, 'budgets'), `${host}: P62.LW1 — sources.budgets names the override in force`).toEqual({ lift: 120, ring: 120 });
    }, 120_000);

    for (const value of ['0', String(ACK_DEADLINE_MS), '12.5', 'fast']) {
      it(`host (${host}): an override out of its bounds ("${value}") is refused: the defaults stay in force (a witness answering in 100 ms is applied, one 10 ms after the default is not) and sources.budgets names both refusals`, async () => {
        const { m, v1 } = await liftWorld(host);
        setEnv(m, { LIFT_WITNESS_BUDGET_MS: value, RING_READ_BUDGET_MS: value });
        const witness = witnessLever(m);
        witness.delay(INSIDE_MS);
        const inside = await decide(m, 'pdp');
        witness.delay(LIFT_DEFAULT_MS + 10);
        const late = await decide(m, 'pdp');
        witness.restore();
        expect(liftOnRecord(inside.record), `${host}: P62.LW1 — "${value}" refused, the default applies a witness answering in ${INSIDE_MS} ms`).toEqual(servedFrom(v1!.version));
        expect(liftOnRecord(late.record), `${host}: P62.LW1 — "${value}" refused, the default refuses a witness answering ${LIFT_DEFAULT_MS + 10} ms late`).toEqual(UNSERVED);
        expect(sourcesMember(late.snapshot, 'budgets'), `${host}: P62.LW1 — sources.budgets names the defaults and both refused overrides`)
          .toEqual({ lift: LIFT_DEFAULT_MS, ring: RING_DEFAULT_MS, refused: ['LIFT_WITNESS_BUDGET_MS', 'RING_READ_BUDGET_MS'] });
      }, 120_000);
    }
  }
});

// ===========================================================================
// unit:P62.LW2 — a light witness door, which the decision path uses
// ===========================================================================

/** `/health`'s members today, in order (src/durable-objects/LearnStats.ts `recoveryControl`, :1599-1603). */
const HEALTH_MEMBERS = ['ok', 'tenant', 'brand', 'slot', 'state', 'generation', 'digest', 'bytes', 'publication', 'witness'];
const verdict = (body: Record<string, unknown>) => ({ state: body.state, publication: body.publication, witness: body.witness });
/** The bytes of the placement's stored state, as `JSON.stringify` writes it. */
const stateBytes = (m: Mounted) => new TextEncoder().encode(JSON.stringify(placementOf(m).data.get('learn'))).length;
/** What one door call read and digested: the `learn` reads and listings, and the digests at least nine tenths of the state's size. */
async function doorCost(m: Mounted, path: string, log: StorageLog): Promise<{ answer: { status: number; body: Record<string, unknown> }; wholeStateReads: string[]; wholeStateDigests: number[] }> {
  const floor = Math.floor(0.9 * stateBytes(m));
  log.reads.length = 0;
  const digests = digestLog();
  let answer: { status: number; body: Record<string, unknown> };
  try { answer = await objectDoor(m, path); } finally { digests.restore(); }
  return { answer, wholeStateReads: log.reads.filter(key => key === 'learn' || (key.startsWith('list:') && 'learn'.startsWith(key.slice(5)))),
    wholeStateDigests: digests.sizes.filter(size => size >= floor) };
}

describe('unit:P62.LW2 (R-P110)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the statistics object answers POST /witness with the verdict /health gives — after a publication, after new evidence, after the next publication — without reading its learn state and without a whole-state digest`, async () => {
      const { m } = await liftWorld(host);
      // The placement's object started again over its stored state, its storage logging every key (an evicted object starts so).
      const log = restartObject(m);
      expect((await objectDoor(m, '/publish', {})).status, `${host}: PRECONDITION — the started object publishes (its verdict is cached at publication)`).toBe(200);
      const steps: Array<[string, () => Promise<void>]> = [
        ['after a publication', async () => undefined],
        ['after new evidence (a commit)', async () => { await visit(m, 'pdp'); }],
        // R10 (S18, R-P195): the next publication is the placement's publication alarm, at its due time (_parity9.ts `firePublicationAlarm`).
        ['after the next publication (the alarm)', async () => { await firePublicationAlarm(m); }],
      ];
      for (const [when, step] of steps) {
        await step();
        const door = await doorCost(m, '/witness', log);
        expect(door.answer.status, `${host}: P62.LW2 — ${when}: the object answers POST /witness (${JSON.stringify(door.answer.body).slice(0, 160)})`).toBe(200);
        const health = await objectDoor(m, '/health');
        expect(verdict(door.answer.body), `${host}: P62.LW2 — ${when}: the door's verdict is the one /health gives for the same state`).toEqual(verdict(health.body));
        expect({ reads: door.wholeStateReads, digests: door.wholeStateDigests }, `${host}: P62.LW2 — ${when}: the door reads no learn state and digests no input of the state's size (${stateBytes(m)} bytes)`)
          .toEqual({ reads: [], digests: [] });
      }
    }, 120_000);

    it(`host (${host}): the decision path's witness calls POST /witness and never /health, and the copy is applied`, async () => {
      const { m, v1 } = await liftWorld(host);
      const lever = witnessLever(m);
      const d = await decide(m, 'pdp');
      lever.restore();
      expect(liftOnRecord(d.record), `${host}: PRECONDITION — the copy is applied`).toEqual(servedFrom(v1!.version));
      expect(lever.calls.filter(call => call.name === statsName(TENANT, BRAND, PDP_MODULES)).map(call => call.path),
        `${host}: P62.LW2 — the decision path's witness uses the light door`).toEqual(['/witness']);
    }, 120_000);

    it(`host (${host}): R-P112(5) — an evicted statistics object (started again over its stored state) answers its FIRST POST /witness with /health's verdict, reading its stored learn state at most once and digesting no input of the state's size; its second call reads none; with the stored state damaged as W23 H1.01 damages it, the first answer reports the state /health reports (recovery-required), again digesting nothing of the state's size`, async () => {
      const { m } = await liftWorld(host);
      const log = restartObject(m);
      const first = await doorCost(m, '/witness', log);
      expect(first.answer.status, `${host}: P62.LW2 — the evicted object answers its first POST /witness (${JSON.stringify(first.answer.body).slice(0, 160)})`).toBe(200);
      const health = await objectDoor(m, '/health');
      expect(verdict(first.answer.body), `${host}: P62.LW2 — its first verdict is the one /health gives for the same state`).toEqual(verdict(health.body));
      expect({ learnReads: first.wholeStateReads.length <= 1, digests: first.wholeStateDigests },
        `${host}: P62.LW2 — R-P112(5): the first call reads the stored state at most once (${JSON.stringify(first.wholeStateReads)}) and digests no input of the state's size (${stateBytes(m)} bytes)`)
        .toEqual({ learnReads: true, digests: [] });
      const second = await doorCost(m, '/witness', log);
      expect({ reads: second.wholeStateReads, digests: second.wholeStateDigests }, `${host}: P62.LW2 — R-P112(5): the second call reads and digests nothing of the state`).toEqual({ reads: [], digests: [] });

      const damagedLog = damageAndRestart(m);
      const damaged = await doorCost(m, '/witness', damagedLog);
      const damagedHealth = await objectDoor(m, '/health');
      expect(damagedHealth.body.state, `${host}: PRECONDITION (W23 H1.01) — /health reports the damaged state`).toBe('recovery-required');
      expect({ state: damaged.answer.body.state, digests: damaged.wholeStateDigests },
        `${host}: P62.LW2 — R-P112(5): the evicted object's first answer over a damaged state is not healthy, as /health says, and digests nothing of the state's size`)
        .toEqual({ state: 'recovery-required', digests: [] });
    }, 120_000);

    it(`host (${host}): LOCK — /health stays for operators: today's members, and its digest is the whole-state digest an operator's repair names (recoveryDigest of the stored state and fence), before and after new evidence; CONTROL: the digest moves with the state`, async () => {
      const { m } = await liftWorld(host);
      const wholeState = async () => recoveryDigest({ raw: placementOf(m).data.get('learn') ?? null, fence: placementOf(m).data.get('learnFence') ?? { whole: 0, items: {} } });
      const before = await objectDoor(m, '/health');
      expect([Object.keys(before.body), before.body.state, before.body.digest], `${host}: P62.LW2 — LOCKED: /health answers today's members and the whole-state digest`)
        .toEqual([HEALTH_MEMBERS, 'healthy', await wholeState()]);
      await visit(m, 'pdp');
      const after = await objectDoor(m, '/health');
      expect([Object.keys(after.body), after.body.digest], `${host}: P62.LW2 — LOCKED: and after new evidence, the new state's digest`).toEqual([HEALTH_MEMBERS, await wholeState()]);
      expect(after.body.digest === before.body.digest, `${host}: CONTROL — new evidence moves the whole-state digest, so the lock reads the live state`).toBe(false);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P62.LW3 — a same-generation superseded copy is served, marked asOf
// ===========================================================================

describe('unit:P62.LW3 (R-P110 decision 2)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): V1 published and decided; new evidence and the alarm publish V2; a decision within the isolate cache still holding V1, and one from a store still answering V1, are both applied with explain.lift.asOf { latest: V2, publishedAt: V1's, version: V1 }; a decision on V2 carries no asOf`, async () => {
      const { m, v1 } = await liftWorld(host);
      const first = await decide(m, 'pdp');
      expect(liftOnRecord(first.record), `${host}: PRECONDITION — V1 is applied (and held in the isolate's cache)`).toEqual(servedFrom(v1!.version));
      const v2 = await republish(m);
      expect(v2.version === v1!.version, `${host}: PRECONDITION — V2 (${v2.version}) is another version than V1 (${v1!.version})`).toBe(false);
      const cached = await decide(m, 'pdp');
      expect(liftOnRecord(cached.record), `${host}: P62.LW3 — the isolate's V1, a same-generation copy inside the window, is applied`).toEqual(servedFrom(v1!.version));
      expect(asOfOf(cached.record), `${host}: P62.LW3 — and marked asOf V1, latest V2`).toEqual(asOf(v1!, v2));
      const held = asOfOf(cached.record);
      expect(typeof held === 'object' && held !== null ? Object.keys(held) : held, `${host}: P62.LW3 — R-P7: asOf's keys sorted`).toEqual(['latest', 'publishedAt', 'version']);
      invalidateLiftCache();
      const undo = copyLever(m, v1!.raw);
      const stale = await decide(m, 'pdp');
      undo();
      expect(liftOnRecord(stale.record), `${host}: P62.LW3 — a store still answering V1 is applied`).toEqual(servedFrom(v1!.version));
      expect(asOfOf(stale.record), `${host}: P62.LW3 — and marked asOf V1, latest V2`).toEqual(asOf(v1!, v2));
      invalidateLiftCache();
      const current = await decide(m, 'pdp');
      expect(liftOnRecord(current.record), `${host}: P62.LW3 — the latest copy, V2, is applied`).toEqual(servedFrom(v2.version));
      expect(Object.hasOwn(itemisedLift(current.record) as object, 'asOf'), `${host}: P62.LW3 — a copy that is the latest carries no asOf member`).toBe(false);
    }, 120_000);

    it(`host (${host}): a record applied with asOf replays equal (GET /v1/:tenant/replay/:id)`, async () => {
      const { m, v1 } = await liftWorld(host);
      await decide(m, 'pdp');
      const v2 = await republish(m);
      const cached = await decide(m, 'pdp');
      expect(asOfOf(cached.record), `${host}: PRECONDITION — the decision was applied from V1 marked asOf`).toEqual(asOf(v1!, v2));
      const replay = await replayOf(m, cached.record!.decision_id);
      expect([replay.status, replay.body.equal, replay.body.diff], `${host}: P62.LW3 — the asOf record replays equal`).toEqual([200, true, []]);
    }, 120_000);

    it(`host (${host}): the recent-publication window is a named constant of at least ${WINDOW_FLOOR_MS} ms; V1 read from the store seconds after V2 is applied (asOf); read LIFT_RECENT_WINDOW_MS + 60 s later, it is not`, async () => {
      const window = await named('LIFT_RECENT_WINDOW_MS', 'the recent-publication window');
      expect(Number.isFinite(window) && window >= WINDOW_FLOOR_MS, `${host}: P62.LW3 — the window covers an isolate's hold plus the store's observed propagation (${window} ms)`).toBe(true);
      const { m, v1 } = await liftWorld(host);
      const v2 = await republish(m);
      invalidateLiftCache();
      let undo = copyLever(m, v1!.raw);
      const inside = await decide(m, 'pdp');
      undo();
      expect(asOfOf(inside.record), `${host}: P62.LW3 — inside the window, V1 is applied, asOf`).toEqual(asOf(v1!, v2));
      invalidateLiftCache();
      undo = copyLever(m, v1!.raw);
      // The last decision of the test: what it writes under the moved clock is read by nothing after it.
      const outside = await later(window + 60_000, () => decide(m, 'pdp'));
      undo();
      expect(liftOnRecord(outside.record), `${host}: P62.LW3 — outside the window, V1 is not applied`).toEqual(UNSERVED);
    }, 120_000);

    it(`host (${host}): R-P112(6) — the window runs from the copy's publication: V1, published at T and superseded seconds later or half a window later, is applied (asOf) when read at T + LIFT_RECENT_WINDOW_MS − 1 ms and not at T + LIFT_RECENT_WINDOW_MS + 1 ms`, async () => {
      const window = await named('LIFT_RECENT_WINDOW_MS', 'the recent-publication window');
      const outcomes: Record<string, unknown> = {}, expected: Record<string, unknown> = {};
      for (const [label, after] of [['superseded seconds after T', 0], ['superseded half a window after T', Math.floor(window / 2)]] as const) {
        const { m, v1 } = await liftWorld(host);
        const published = v1!.publishedAt;
        const v2 = after === 0 ? await republish(m) : await frozenAt(published + after, () => republish(m));
        expect(v2.publishedAt - published >= after, `${host}: PRECONDITION — V2 supersedes V1 ${after} ms or more after V1's publication (${v2.publishedAt - published} ms)`).toBe(true);
        const readAt = async (time: number) => {
          invalidateLiftCache();
          const undo = copyLever(m, v1!.raw);
          try { return liftOnRecord((await frozenAt(time, () => decide(m, 'pdp'))).record); } finally { undo(); }
        };
        // The later instant last: what the reads write under the held clock is read by nothing after them.
        const inside = await readAt(published + window - 1), outside = await readAt(published + window + 1);
        outcomes[label] = { inside, outside };
        expected[label] = { inside: servedFrom(v1!.version), outside: UNSERVED };
      }
      expect(outcomes, `${host}: P62.LW3 — R-P112(6): accepted 1 ms before the window ends counted from V1's publication, refused 1 ms after, whenever V1 was superseded`).toEqual(expected);
    }, 180_000);

    it(`host (${host}): R-P113 — after an explicit reset (the object's /recovery and /recover doors) and new evidence, the copy that is still the object's latest publication (its witness changed with the reset's fence) is not applied and the answer names the outcome 'unrecognized'`, async () => {
      const { m, v1 } = await liftWorld(host);
      const status = await objectDoor(m, '/recovery');
      const reset = await objectDoor(m, '/recover', { tenant: TENANT, brand: BRAND, slot: PDP_MODULES, intent: 'reset', operationId: 'd'.repeat(32), digest: status.body.digest, generation: status.body.generation });
      expect([status.status, reset.status, reset.body.reset], `${host}: PRECONDITION — the explicit reset is applied (${JSON.stringify(reset.body).slice(0, 160)})`).toEqual([200, 200, true]);
      await visit(m, 'pdp');
      invalidateLiftCache();
      const refused = await decide(m, 'pdp');
      const witnessAfter = (await objectDoor(m, '/health')).body.witness, copy = JSON.parse(v1!.raw) as { witness: string };
      expect([copyOf(m)?.version, witnessAfter === copy.witness], `${host}: PRECONDITION — the store still answers V1, the object's latest publication, and the object's witness has moved`).toEqual([v1!.version, false]);
      expect(liftOnRecord(refused.record), `${host}: P62.LW3 — LOCKED: that copy is not applied`).toEqual(UNSERVED);
      const read = liftReadOf(refused.snapshot);
      expect(typeof read === 'object' && read !== null ? 'named' : read, `${host}: PRECONDITION (P61.LO1) — the answer names sources.lift['${PDP_MODULES}']`).toBe('named');
      expect((read as { outcome?: unknown }).outcome, `${host}: P62.LW3 — R-P113: the latest publication whose witness changed after a reset is 'unrecognized'`).toBe('unrecognized');
    }, 120_000);

    it(`host (${host}): LOCK — forged copies are not applied, of V1 (superseded) or of V2 (the latest); CONTROL: V2 as published is`, async () => {
      const { m, v1 } = await liftWorld(host);
      const v2 = await republish(m);
      const refused: unknown[] = [];
      for (const raw of [forged(v1!.raw), forged(v2.raw)]) {
        invalidateLiftCache();
        const undo = copyLever(m, raw);
        refused.push(liftOnRecord((await decide(m, 'pdp')).record));
        undo();
      }
      invalidateLiftCache();
      const control = await decide(m, 'pdp');
      expect(refused, `${host}: P62.LW3 — LOCKED (W38 B7): a digest the object never published is never applied, inside the window or not`).toEqual([UNSERVED, UNSERVED]);
      expect(liftOnRecord(control.record), `${host}: CONTROL — V2 as published is applied`).toEqual(servedFrom(v2.version));
    }, 120_000);

    it(`host (${host}): LOCK — a different witness after a configuration change: the product slot's reward moved to add_to_bag and back to click, each through a learn republish and the operator's generation transition; V1 is not applied (compatible again, another witness); CONTROL: before the change V1 is`, async () => {
      const { m, v1 } = await liftWorld(host);
      const control = await decide(m, 'pdp');
      for (const reward of ['add_to_bag', 'click']) {
        const republished = await putDocument(m, 'learn', learnOf({ [PDP_MODULES]: dials(reward), [HOME_MODULES]: dials() }), `p62-${reward}`);
        expect(republished.status, `${host}: PRECONDITION — the learn document republishes with reward ${reward}`).toBe(200);
        const transition = await asOperator(m, 'POST', `/v1/${TENANT}/learn/generation`, { slot: PDP_MODULES, reward });
        expect(transition.status, `${host}: PRECONDITION — the operator's generation transition to ${reward} (${JSON.stringify(transition.body).slice(0, 160)})`).toBe(200);
      }
      invalidateLiftCache();
      const undo = copyLever(m, v1!.raw);
      const refused = await decide(m, 'pdp');
      undo();
      expect(liftOnRecord(control.record), `${host}: CONTROL — V1 is applied before the change`).toEqual(servedFrom(v1!.version));
      expect(liftOnRecord(refused.record), `${host}: P62.LW3 — LOCKED: a copy of another witness is not applied, inside the window`).toEqual(UNSERVED);
    }, 120_000);

    it(`host (${host}): LOCK — an unhealthy object (W23 H1.01's damage, the object started over it) applies neither V1 inside the window nor V2; CONTROL: before the damage V2 is`, async () => {
      const { m, v1 } = await liftWorld(host);
      const v2 = await republish(m);
      invalidateLiftCache();
      const control = await decide(m, 'pdp');
      damageAndRestart(m);
      const refused: unknown[] = [];
      for (const copy of [v1!, v2]) {
        invalidateLiftCache();
        const undo = copyLever(m, copy.raw);
        refused.push(liftOnRecord((await decide(m, 'pdp')).record));
        undo();
      }
      expect(liftOnRecord(control.record), `${host}: CONTROL — V2 is applied before the damage`).toEqual(servedFrom(v2.version));
      expect(refused, `${host}: P62.LW3 — LOCKED (W23 H1.01): an object that is not healthy confirms no copy`).toEqual([UNSERVED, UNSERVED]);
    }, 120_000);

    it(`host (${host}): LOCK — after an explicit reset (the object's /recovery and /recover doors with intent reset, as the operator's audited route calls them) and new evidence, V1 — still the object's last publication — is not applied; CONTROL: before the reset it is`, async () => {
      const { m, v1 } = await liftWorld(host);
      const control = await decide(m, 'pdp');
      const status = await objectDoor(m, '/recovery');
      const reset = await objectDoor(m, '/recover', { tenant: TENANT, brand: BRAND, slot: PDP_MODULES, intent: 'reset', operationId: 'c'.repeat(32), digest: status.body.digest, generation: status.body.generation });
      expect([status.status, reset.status, reset.body.reset], `${host}: PRECONDITION — the explicit reset is applied (${JSON.stringify(reset.body).slice(0, 160)})`).toEqual([200, 200, true]);
      await visit(m, 'pdp');
      invalidateLiftCache();
      const undo = copyLever(m, v1!.raw);
      const refused = await decide(m, 'pdp');
      undo();
      expect(liftOnRecord(control.record), `${host}: CONTROL — V1 is applied before the reset`).toEqual(servedFrom(v1!.version));
      expect(liftOnRecord(refused.record), `${host}: P62.LW3 — LOCKED: after an explicit reset V1 is another generation's copy`).toEqual(UNSERVED);
    }, 120_000);

    it(`host (${host}): LOCK — after the operator's generation transition (reward click, the same tuple), V1 is not applied although published seconds before; CONTROL: before the transition it is`, async () => {
      const { m, v1 } = await liftWorld(host);
      const control = await decide(m, 'pdp');
      const transition = await asOperator(m, 'POST', `/v1/${TENANT}/learn/generation`, { slot: PDP_MODULES, reward: 'click' });
      expect(transition.status, `${host}: PRECONDITION — the generation transition (${JSON.stringify(transition.body).slice(0, 160)})`).toBe(200);
      invalidateLiftCache();
      const undo = copyLever(m, v1!.raw);
      const refused = await decide(m, 'pdp');
      undo();
      expect(liftOnRecord(control.record), `${host}: CONTROL — V1 is applied before the transition`).toEqual(servedFrom(v1!.version));
      expect(liftOnRecord(refused.record), `${host}: P62.LW3 — LOCKED (W24 G1.02, LearnStats.ts:1116-1123): the superseded generation's copy is not applied`).toEqual(UNSERVED);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P62.LW4 — LOCKS: what does not change
// ===========================================================================

/** Every member a record's `explain.lift` may carry today (src/content/types.ts `LiftApplied`, :809-850). */
const LIFT_APPLIED_MEMBERS = ['applied', 'evidenceFloor', 'gamma', 'level', 'level_words', 'lift', 'measurementBasis', 'n', 'n0', 'objective', 'p0', 'p_hat', 'pooled', 'prior', 'reward', 's'];
/** P08's catalogue without the pooled declaration, under a retained pages document carrying the product slot's name on two pages (W26 R2's case). */
const SCOPED_PIECES = P08_PIECES.map(piece => Object.fromEntries(Object.entries(piece).filter(([key]) => key !== 'pooled')));
const SCOPED_SLOTS = { version: 'parity-s11-scoped', governanceVersion: 3, pages: {
  pdp: [{ slot: PDP_MODULES, take: 3, weights: { line: 1 } }], home: [{ slot: PDP_MODULES, take: 3, weights: { line: 1 } }] } };

describe('unit:P62.LW4 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — compatible(): after the learn document is republished with nMin 3, the nMin-2 copy is not applied; CONTROL: before, it is`, async () => {
      const { m, v1 } = await liftWorld(host);
      const control = await decide(m, 'pdp');
      const base = learnOf({ [PDP_MODULES]: dials(), [HOME_MODULES]: dials() }) as { stats: Record<string, unknown> };
      const republished = await putDocument(m, 'learn', { ...base, stats: { ...base.stats, nMin: 3 } }, 'p62-nmin');
      expect(republished.status, `${host}: PRECONDITION — the learn document republishes with nMin 3`).toBe(200);
      invalidateLiftCache();
      const refused = await decide(m, 'pdp');
      expect(liftOnRecord(control.record), `${host}: CONTROL — applied before the republish`).toEqual(servedFrom(v1!.version));
      expect(liftOnRecord(refused.record), `${host}: P62.LW4 — LOCKED (src/content/service.ts:156-161): a copy compatible() refuses is not applied`).toEqual(UNSERVED);
    }, 120_000);

    it(`host (${host}): LOCK — the default arm reads no lift: no store read of a lift key and no witness call for a shopper who withheld tracking and personalization; CONTROL: a consenting shopper's decision makes both`, async () => {
      const { m } = await liftWorld(host);
      const kv = kvReadLog(m), lever = witnessLever(m);
      await decide(m, 'pdp', { shopper: await shopperOn(m, { tracking: false, personalization: false }), ack: false });
      const withheld = { liftReads: kv.keys.filter(key => key.startsWith('lift:')).length, witnessCalls: lever.calls.length };
      invalidateLiftCache();
      await decide(m, 'pdp', { ack: false });
      const consenting = { liftReads: kv.keys.filter(key => key.startsWith('lift:')).length - withheld.liftReads, witnessCalls: lever.calls.length - withheld.witnessCalls };
      kv.restore(); lever.restore();
      expect(withheld, `${host}: P62.LW4 — LOCKED (src/content/service.ts:908): the default arm reads no lift`).toEqual({ liftReads: 0, witnessCalls: 0 });
      expect(consenting.liftReads > 0 && consenting.witnessCalls > 0, `${host}: CONTROL — a personalizing decision reads the copy and calls the witness (${JSON.stringify(consenting)})`).toBe(true);
    }, 120_000);

    it(`host (${host}): LOCK — the page-scoped witness (W26 R2): under a retained pages document carrying ${PDP_MODULES} on the product and home pages, each page's decision witnesses its own page's object only and reads that page's copy`, async () => {
      const m = await mount(host, { pieces: SCOPED_PIECES, slots: SCOPED_SLOTS, learn: learnOf({ [PDP_MODULES]: dials() }), retainedSlots: true });
      expectPublished(m, 'P62.LW4 — the retained pages document carrying one slot name on two pages publishes');
      await visit(m, 'pdp'); await visit(m, 'pdp'); await visit(m, 'home');
      await publishStats(m);
      invalidateLiftCache();
      const lever = witnessLever(m);
      const named = { pdp: [] as string[], home: [] as string[] }, versions = { pdp: 0, home: 0 };
      for (const page of ['pdp', 'home'] as const) {
        const before = lever.calls.length;
        versions[page] = (await decide(m, page)).record?.versions.lift ?? -1;
        named[page] = [...new Set(lever.calls.slice(before).map(call => call.name))];
      }
      lever.restore();
      const copyField = (page: string, field: 'version' | 'witness') => (JSON.parse(m.cache.data.get(liftKey(TENANT, BRAND, PDP_MODULES, page)) ?? '{}') as Record<string, unknown>)[field];
      expect(named, `${host}: P62.LW4 — LOCKED (src/learn/fan.ts:32-35): each page's witness is its own page's object`)
        .toEqual({ pdp: [statsName(TENANT, BRAND, PDP_MODULES, 'pdp')], home: [statsName(TENANT, BRAND, PDP_MODULES, 'home')] });
      expect(versions, `${host}: P62.LW4 — LOCKED: and each page decides with its own page's copy`).toEqual({ pdp: copyField('pdp', 'version'), home: copyField('home', 'version') });
      expect(copyField('pdp', 'witness') === copyField('home', 'witness'), `${host}: CONTROL — the two pages' copies are two placements' publications (each page's witness binds its page)`).toBe(false);
    }, 120_000);

    // R10 (P110.GS4, E34, R-P738; by name, R-P716): the bound is the ring door's own answer, not the caller's clock. The
    // ring's door answers at the ring budget in force plus RING_BOUND_SLACK_MS (an abort of the call ends the wait, as a
    // real fetch's does), so a decision that waited past that answers WITH the fatigue term; one answered without it was
    // cut by the budget's timer, due before the door's. Two timers fire in the order they are due, whatever the load; the
    // elapsed time stays printed.
    it(`host (${host}): the ring never extends a decision by more than its budget: with the ring's door answering only at the ring budget in force plus RING_BOUND_SLACK_MS (300 ms; an abort of the call ends the wait, as a real fetch's does), the product page is answered without the fatigue term; CONTROL: with the ring answering, it fatigues`, async () => {
      const { ringBudget } = await inForce();
      const { m } = await liftWorld(host);
      const first = await decide(m, 'pdp');
      const lever = ringLever(m);
      lever.delay(ringBudget + RING_BOUND_SLACK_MS);
      const started = performance.now();
      const answered = await decide(m, 'pdp', { shopper: first.shopper, ack: false });
      const elapsed = performance.now() - started, calls = lever.calls.length;
      lever.restore();
      console.log(`${host}: P62.LW4 evidence — answered in ${Math.round(elapsed)} ms; the ring's door answers at ${ringBudget + RING_BOUND_SLACK_MS} ms`);
      expect(calls, `${host}: PRECONDITION — the decision called the ring`).toBeGreaterThan(0);
      expect(fatigued(answered.snapshot),
        `${host}: P62.LW4 — the authority's unchanged property (src/learn/fan.ts:854-858): answered before the ring's door answers at ${ringBudget} ms + ${RING_BOUND_SLACK_MS} ms, without the fatigue term`).toBe(false);
      const control = await decide(m, 'pdp', { shopper: first.shopper, ack: false });
      expect(fatigued(control.snapshot), `${host}: CONTROL — with the ring answering, the module served before is fatigued`).toBe(true);
    }, 120_000);

    it(`host (${host}): LOCK — the publish order: every write the object makes for a publication, learnPublished among them, precedes the store's put of the copy; CONTROL: the order check catches a copy put first`, async () => {
      const { m } = await liftWorld(host);
      await visit(m, 'pdp');
      const log = restartObject(m), order: string[] = [];
      const objectWrites = log.writes, put = m.cache.put;
      const key = liftKey(TENANT, BRAND, PDP_MODULES);
      m.cache.put = async (k: string, value: string) => { if (k === key) order.push(`copy after ${objectWrites.length} object writes`); return put.call(m.cache, k, value); };
      log.writes.length = 0;
      const published = await objectDoor(m, '/publish', {});
      m.cache.put = put;
      const putsBefore = (entry: string | undefined) => Number(entry?.match(/after (\d+)/)?.[1] ?? -1);
      expect(published.status, `${host}: PRECONDITION — the placement publishes`).toBe(200);
      expect({ learnPublished: log.writes.includes('learnPublished'), allBeforeTheCopy: order.length === 1 && putsBefore(order[0]) === log.writes.length },
        `${host}: P62.LW4 — LOCKED (src/durable-objects/LearnStats.ts:1182-1183): learnPublished, and every write the publication makes, before the copy (writes ${JSON.stringify(log.writes)}; ${order[0]})`)
        .toEqual({ learnPublished: true, allBeforeTheCopy: true });
      expect(putsBefore('copy after 0 object writes') === log.writes.length, `${host}: CONTROL — a copy put before the object's writes fails the check`).toBe(false);
    }, 120_000);

    it(`host (${host}): LOCK — the P42 stale and P49 republished members: under a home-page /pooled fault the product placement's refused publication marks GET lift stale; a learn republish changing the product slot's reward marks it republished; CONTROL: the home placement, which never failed, carries neither`, async () => {
      const { m } = await liftWorld(host);
      await visit(m, 'pdp');
      const restore = failPooledDoor(m, HOME_MODULES);
      const refused = await (async () => { try { return await objectPublish(m, PDP_MODULES); } finally { restore(); } })();
      expect(refused.status, `${host}: PRECONDITION (P42) — the pooled fault refuses the product placement's publication`).toBe(503);
      const stale = await liftOf(m, PDP_MODULES);
      expect(Object.hasOwn(stale.body, 'stale'), `${host}: P62.LW4 — LOCKED (P42.PW2): GET lift for the product slot carries stale`).toBe(true);
      const republished = await putDocument(m, 'learn', learnOf({ [PDP_MODULES]: dials('add_to_bag'), [HOME_MODULES]: dials() }), 'p62-p49');
      expect(republished.status, `${host}: PRECONDITION (P49) — the learn document republishes with reward add_to_bag`).toBe(200);
      expect((await objectPublish(m, PDP_MODULES)).status, `${host}: PRECONDITION (P49) — the product placement's publication is refused`).toBe(503);
      expect(Object.hasOwn((await liftOf(m, PDP_MODULES)).body, 'republished'), `${host}: P62.LW4 — LOCKED (P49.LR1): GET lift for the product slot carries republished`).toBe(true);
      const home = await liftOf(m, HOME_MODULES);
      expect(['stale', 'republished'].filter(member => Object.hasOwn(home.body, member)), `${host}: CONTROL — the home placement carries neither`).toEqual([]);
    }, 120_000);

    it(`host (${host}): LOCK — a record decided with the latest copy is today's: explain.lift carries only members a lift carries today (no asOf), and it replays equal; CONTROL: an asOf member is caught`, async () => {
      const { m, v1 } = await liftWorld(host);
      const d = await decide(m, 'pdp');
      expect(liftOnRecord(d.record), `${host}: PRECONDITION — the latest copy is applied`).toEqual(servedFrom(v1!.version));
      const beyond = (lift: Record<string, unknown> | string) => (typeof lift === 'string' ? [lift] : Object.keys(lift).filter(key => !LIFT_APPLIED_MEMBERS.includes(key)));
      expect(beyond(itemisedLift(d.record)), `${host}: P62.LW4 — LOCKED: a record without asOf is byte for byte today's in its lift`).toEqual([]);
      const replay = await replayOf(m, d.record!.decision_id);
      expect([replay.status, replay.body.equal], `${host}: P62.LW4 — LOCKED: and replays equal`).toEqual([200, true]);
      expect(beyond({ ...(itemisedLift(d.record) as Record<string, unknown>), asOf: asOf(copyOf(m)!, copyOf(m)!) }), `${host}: CONTROL — an asOf member on the latest copy's record is caught`).toEqual(['asOf']);
    }, 120_000);
  }
});
