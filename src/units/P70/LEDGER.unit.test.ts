// src/units/P70/LEDGER.unit.test.ts
// P70 under the Closure Ledger: the tests for the LOCAL criteria WB1-WB2 of the P70 work
// order (the clock-and-budget programme of amendment 9, ticket P70 "The statistics object
// stays warm for the witness", re-scoped by R-P191). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-9/BTI-Parity-Amendment-2026-10-20c.md, section 2, P70):
//   "P70 — the statistics object stays warm for the witness. The placement's statistics object
//   keeps a bounded keep-warm heartbeat: after any witness call, exposure write or credit write
//   it records the touch and keeps one alarm due within `WARM_HEARTBEAT_MS` (about 5 s, under the
//   observed 12.7 s warm bound) for `WARM_TAIL_MS` (about 10 minutes) after the last touch; the
//   object's single alarm is shared (the next due time is the minimum of the heartbeat, the
//   publication due at `PUBLISH_DELAY_MS` and the effect expiry); a heartbeat publishes nothing and
//   writes no key; the 30 s publication timing, the effect-expiry order, P63's no-republication
//   rule, P42 PW2's marker clearing, W27 R4's retry and P62's witness, budgets and window are
//   unchanged; the default budgets stay 200 ms (the pair's 600 ms override is removed: it served
//   the same share and cost every cold answer 400 ms); the first decision after a quiet spell
//   longer than the tail is still `late` and named as such (P61); the kit states the heartbeat, its
//   bounds and its cost. The ring object (one per shopper) is NOT kept warm by this ticket: its cold
//   reads stay `late` and are named (an amendment-list item with its per-shopper cost). The KV
//   witness record (a decision that never wakes the object) stays on the amendment list as the
//   shape for long quiet spells: it needs an authority ruling on KV staleness (fan.ts:70, R-P110,
//   R-P113)."
// The work order (docs/parity/clock-and-budget/program.json, P70), remaining work: "Record the touch
// and arm the shared alarm within WARM_HEARTBEAT_MS for WARM_TAIL_MS (LearnStats.ts: arm,
// alarmScoped, the witness door); the heartbeat branch publishes nothing; kit 02/03; the pair's
// 600 ms override removed at the next release." Its decision D1 (R-P191 under R-P78): "The keep-warm
// heartbeat is the fix; its cost (up to 720 alarm invocations per object-hour inside the tail, the
// object resident for the tail) is told to the owner".
//
// One `describe('unit:P70.<criterion>')` per LOCAL criterion, both shopper hosts. Expected values come
// from the amendment, the work order and the analysis they cite (_evidence/baseline-52/lift-edge/
// ANALYSIS.md, LIFT-EDGE at 371bfca8: §1 the witness path and the object's alarm, §2 the eviction
// after 13-17 s of idleness, §5(v) the keep-warm shape: "Every `/witness` call, exposure write or
// credit write records `lastTouch`. While `now − lastTouch < WARM_TAIL_MS` (proposal: 10 min), the
// object keeps an alarm due within `HEARTBEAT_MS` (proposal: 5 s, well under the observed 12.7 s warm
// bound)"; "The object has one alarm, so it is shared: next = min(heartbeat, publication due at
// `PUBLISH_DELAY_MS`, effect expiry). The handler publishes only when a publication is due; a
// heartbeat does nothing but re-arm") and the engine's own constants, never from what the engine
// does today:
//   · `PUBLISH_DELAY_MS`: 30 000 ms (src/durable-objects/LearnStats.ts, `const PUBLISH_DELAY_MS =
//     30_000`, not exported; `arm`: a write arms the alarm at the earlier of now + PUBLISH_DELAY_MS
//     and the next learning-effect marker's expiry; kit 03: "a new version within 30 seconds");
//   · the ordinary alarm: the earliest expiry of the learning-effect markers the state holds
//     (LearnStats.ts `effectExpiries`, the alarm's `finally`), read from the stored state;
//   · the default budgets: src/learn/fan.ts `LIFT_WITNESS_BUDGET_MS` and `RING_READ_BUDGET_MS`, 200 ms
//     each (amendment 9 §2: "the default budgets stay 200 ms"; P62.LW1's derivation).
//
// THE READINGS THIS FILE RULES:
//   · THE CONSTANTS. `WARM_HEARTBEAT_MS` and `WARM_TAIL_MS`, exported by
//     src/durable-objects/LearnStats.ts (the ticket's file), numbers: 5 000 ms (the amendment's
//     "about 5 s"; D1's cost "up to 720 alarm invocations per object-hour" is one per 5 s; under the
//     12.7 s warm bound) and 600 000 ms (the amendment's "about 10 minutes", the analysis's proposal).
//     They do not exist today: read loosely (the P56.AA2 idiom), the RED names their absence, and the
//     behaviour legs use the ruled numbers until they exist, then the exported ones.
//   · A TOUCH is made on the real paths: a witness call is a decision on the product page (its lift
//     read calls the placement's `/witness` door, src/learn/fan.ts `LIFT_WITNESS_DOOR`) with no
//     acknowledgement; an exposure write is that decision's render acknowledgement; a credit write is
//     a click on the acknowledged decision (the placement learns against clicks).
//   · THE OBJECT starts again before the touch it is asked about (src/units/_parity9.ts
//     `restartObject`: a fresh LearnStats over the same stored state, as an evicted object wakes,
//     with no alarm armed and every key it writes logged), so the alarm read is the one the touch and
//     the alarms after it armed.
//   · THE ALARM DRIVER: the alarm the object holds (its storage's `getAlarm`) is fired as the platform
//     fires it at its due time: the clock moved to that time (`later`), `LearnStats.alarm()` run
//     (`runAlarm`, never src/units/_parity9.ts `fireAlarm`, whose clock the R10 below may move),
//     repeatedly, until no alarm is due or the next is due after the horizon the leg names. An alarm "due within WARM_HEARTBEAT_MS" after a touch or an alarm is due later than it and
//     at most WARM_HEARTBEAT_MS after the moment it ended.
//   · "Keeps re-arming until WARM_TAIL_MS after the last touch ... after the tail the heartbeats stop":
//     the chain of alarms after a touch is unbroken (each due within the heartbeat of the moment the one
//     before ended) until the tail; a second touch half-way through the tail extends it; the last
//     heartbeat fires between WARM_TAIL_MS − WARM_HEARTBEAT_MS and WARM_TAIL_MS + WARM_HEARTBEAT_MS
//     after the last touch, and the alarm it leaves is the ordinary one (the earliest marker expiry).
//   · "Publishes nothing and writes no key": across every heartbeat, the copy the store holds (its
//     bytes), the object's publication record (`learnPublished`), its recent publications
//     (`learnRecent`) and the archive are unchanged, and the object's storage logs no key written
//     (re-arming the alarm writes none).
//   · WB2 "the single alarm is shared ... the 30 s publication timing": after a credit write, exactly
//     one alarm publishes before the tail ends, the first whose due time is at least PUBLISH_DELAY_MS
//     after the write and at most PUBLISH_DELAY_MS plus the tolerance after it: the tolerance is
//     `WARM_HEARTBEAT_MS` once the engine exports it ("within the heartbeat's granularity"), and 0
//     until then (today the write's own alarm is the publication's). Every alarm before it publishes
//     nothing, so a heartbeat that replaced the publication alarm, or published early, breaks it.
//   · WB2 "the effect-expiry order": after the tail the alarm is due at the earliest marker expiry;
//     fired there, it removes the markers expired by then, and the alarm it leaves is the next
//     marker's expiry.
//   · WB2 "no new remote call before any answer": with 20 ms added to every remote binding call
//     (src/units/_parity8.ts `remoteLatency`, as P65.RS3 and P69.AK2 add it), a decision, its
//     acknowledgement and a click make, per binding and method, no more remote calls before their
//     answer than they make at 53de8f2b (BASE_CALLS_BEFORE_ANSWER, measured on this harness); the
//     decision's `sources.budgets` names the 200 ms defaults.
//   · WB2 "the ring object is NOT kept warm": a decision's ring read leaves the shopper's ring object's
//     alarm as it was.
//   · WB2's other locks — P63 NR1-NR3, P42 PW2, W27 R4 (P63.NR3's leg), P62 LW1-LW4, W38 B7 and P61's
//     `late` after a quiet spell — are their own units, in the gate; not re-implemented here. Kit 02/03
//     "states the heartbeat, its bounds and its cost": sentences the reviewer reads (doneWhen 4).
//
// MEASURED at 53de8f2b (_evidence/parity-step3/S18/specifier/logs/): WB1 RED on both hosts: the
// constants are not exported; a decision's witness call arms no alarm; an acknowledgement and a click
// each arm one alarm 30 s ahead; WB2 GREEN on both hosts.
//
// NEGATIVE CONTROLS (scratch copies, never committed; _evidence/parity-step3/S18/specifier/sketches/):
// a sketch of the heartbeat (the touch recorded; the shared alarm at the minimum of the heartbeat,
// the publication due and the next marker expiry; a heartbeat that only re-arms) turns every P70 unit
// GREEN; one whose heartbeat publishes turns WB1 RED (and P63.NR1); one that never stops re-arming
// turns WB1's tail leg RED; one arming only on writes turns WB1's witness leg RED; one whose heartbeat
// replaces the publication alarm instead of sharing it turns WB2's 30 s publication lock RED.
//
// R10 (expectations a build of P70 changes), applied in this batch under the lead's ruling R-P195 (the object's single
// alarm is shared; its handler does everything that is due when it fires; a publication is due PUBLISH_DELAY_MS after the
// write, or the republication, it publishes, never earlier): src/units/_parity9.ts `firePublicationAlarm` (beside
// `fireAlarm`, unchanged) and `republish` firing it; P63 NR1-NR3, P62 LW2's step (:328-330; LW3 and P61 LO1 change
// only through `republish`), P42 PW2's
// alarm leg fire the publication alarm; src/learn/learn.test.ts (W27.01, W10.01, the counts test),
// src/learn/priorsAbsent.test.ts (E2) and src/units/W27/LEDGER.unit.test.ts (W27.R4) run their alarms at the
// publication's due time or expect the earlier of the previous due time and the heartbeat (read loosely). MEASURED on
// scratch copies of 53de8f2b carrying them (_evidence/parity-step3/S18/specifier/logs/r10d/), over the 154 test files that
// read or fire an alarm or the lift world: today's product fails exactly what it failed without them (scratch-environment
// tests only); under a sketch of the heartbeat two more fail, outside this round's files:
//   · src/units/W27/B1.unit.test.ts W27.M1.01 (:646, `rearmed >= startedAt + 30_000`): the guarded failure re-arm keeps
//     the earlier heartbeat (R-P195; W27 R4's own rule); its lower bound was updated under R-P196 (08fb6959);
//   · src/units/P68 KT1's alarm-publication citations (kit 02 :1171, kit 03 :1474-1488 cite LearnStats.ts lines): any
//     edit of that file moves them, and the build re-points them (kit 02/03 are in P70's allowed paths).
//
// No new export is imported statically; `WARM_HEARTBEAT_MS` and `WARM_TAIL_MS` are read loosely.
//
// FIXTURE. P61's and P62's lift world (src/units/_parity9.ts `liftWorld`): P08's pooled world as
// P42.PW3 drives it (two product-page visits and one home-page visit, every placement published
// through its own door), the product page's slot carrying P10's fatigue dial; the product page's
// placement (`pdp-modules`) is the object under test.
//
// HARNESS: src/units/_parity.ts, _parity8.ts, _parity9.ts. Imports from src/units/: ../_parity,
// ../_parity8, ../_parity9.

import { describe, expect, it } from 'vitest';

import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { LIFT_WITNESS_BUDGET_MS, learningReadBudgets, ringName, RING_READ_BUDGET_MS } from '@/learn/fan';

import { BRAND, HOSTS, pageInstanceOf, TENANT, type Mounted, type Snapshot } from '../_parity';
import { ackWire, clickWire, remoteLatency, settle, workerApp, type WorkerApp } from '../_parity8';
import { decide, later, liftWorld, PDP_MODULES, placementOf, restartObject, sourcesMember, type StorageLog } from '../_parity9';

/** LearnStats.ts `const PUBLISH_DELAY_MS = 30_000` (not exported): a write's publication is due 30 s after it. */
const PUBLISH_DELAY_MS = 30_000;
/** The ruled values of the two constants (amendment 9 §2, D1's cost, LIFT-EDGE §5(v)). */
const RULED = { WARM_HEARTBEAT_MS: 5_000, WARM_TAIL_MS: 600_000 };
/** The default budgets that stay (amendment 9 §2; src/learn/fan.ts). */
const DEFAULT_BUDGET_MS = 200;
/** What every remote binding call waits under the lever (P65.RS3's lever). */
const LEVER_MS = 20;
/**
 * The remote calls a decision on the product page, its acknowledgement and a click make before their answer at 53de8f2b,
 * per binding and method, on this harness (measured with the lever above: _evidence/parity-step3/S18/specifier/logs/).
 */
const BASE_CALLS_BEFORE_ANSWER: Record<string, Record<string, Record<string, number>>> = {
  session: {
    decision: { 'STORAGE.get': 1, 'DECISION_RING.fetch': 1, 'LEARN_STATS.fetch': 1, 'CACHE.get': 1 },
    acknowledgement: { 'STORAGE.get': 3, 'CACHE.get': 11, 'SESSIONS.put': 2 },
    click: { 'STORAGE.get': 1, 'CACHE.get': 11, 'SESSIONS.put': 2 },
  },
  do: {
    decision: { 'STORAGE.get': 1, 'DECISION_RING.fetch': 1, 'LEARN_STATS.fetch': 1, 'CACHE.get': 1 },
    acknowledgement: { 'STORAGE.get': 3 },
    click: { 'STORAGE.get': 1 },
  },
};
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 300);

/** The two constants as the engine exports them (read loosely), and the values the legs run with: the exported ones, else the ruled ones. */
async function warm(): Promise<{ exported: Record<string, unknown>; heartbeat: number; tail: number; tolerance: number }> {
  const module = await import('@/durable-objects/LearnStats') as unknown as Record<string, unknown>;
  const heartbeat = typeof module.WARM_HEARTBEAT_MS === 'number' ? module.WARM_HEARTBEAT_MS : undefined;
  const tail = typeof module.WARM_TAIL_MS === 'number' ? module.WARM_TAIL_MS : undefined;
  return { exported: { WARM_HEARTBEAT_MS: heartbeat ?? 'not exported', WARM_TAIL_MS: tail ?? 'not exported' },
    heartbeat: heartbeat ?? RULED.WARM_HEARTBEAT_MS, tail: tail ?? RULED.WARM_TAIL_MS, tolerance: heartbeat ?? 0 };
}

/**
 * The product placement's alarm handler run now, as the platform runs it when the alarm fires (`LearnStats.alarm()`), and the
 * pending work drained. Called inside `later`, so "now" is the alarm's due time; never moves the clock itself (unlike a
 * harness helper whose clock may be ruled to move), so the due times below are this file's own.
 */
async function runAlarm(m: Mounted): Promise<void> {
  await (placementOf(m).object as unknown as { alarm: () => Promise<void> }).alarm();
  await m.drain();
}
/** The alarm the product placement's object holds (its storage's `getAlarm`, through the object's own state). */
const alarmOf = (m: Mounted): Promise<number | null> => (placementOf(m).object as unknown as { state: DurableObjectState }).state.storage.getAlarm();
/** The alarm the object holds if it is due after `at` (a fired alarm the object did not re-arm reads as none), else none. */
const alarmAfter = async (m: Mounted, at: number): Promise<number | null> => { const due = await alarmOf(m); return due !== null && due > at ? due : null; };
/** The ordinary alarm after `at`: the earliest expiry of the learning-effect markers the stored state holds later than `at`, or none. */
function ordinaryAfter(m: Mounted, at: number): number | null {
  const learn = placementOf(m).data.get('learn') as { effects?: Record<string, { expiresAt: number }>; retiredEffects?: Record<string, { expiresAt: number }> } | undefined;
  const expiries = [...Object.values(learn?.effects ?? {}), ...Object.values(learn?.retiredEffects ?? {})].map(marker => marker.expiresAt).filter(expiry => expiry > at);
  return expiries.length ? Math.min(...expiries) : null;
}
/** What the placement has published: the store's copy, the object's publication record and recent publications, the archived versions. */
function publishedOf(m: Mounted): string {
  const data = placementOf(m).data;
  return JSON.stringify({ copy: m.cache.data.get(`lift:${TENANT}:${BRAND}:${PDP_MODULES}`) ?? null, record: data.get('learnPublished') ?? null, recent: data.get('learnRecent') ?? null,
    archived: [...m.storage.objects.keys()].filter(key => key.startsWith(`lift/${TENANT}/${BRAND}/${PDP_MODULES}/`) && /\/\d+\.json$/.test(key)).sort() });
}

/** One alarm fired by the driver: when it was due, when it ended (the moved clock), what it published and wrote, and the alarm it left. */
interface Fired { at: number; ended: number; published: boolean; writes: string[]; next: number | null }
/**
 * The platform's alarm driver: the alarm the object holds fired at its due time (the clock moved there), again and again,
 * until no alarm is due (none armed, or the one held already fired) or the next is due after `horizon`.
 */
async function drive(m: Mounted, log: StorageLog, horizon: number, limit = 400): Promise<{ fired: Fired[]; next: number | null }> {
  const fired: Fired[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (let round = 0; round < limit; round++) {
    const due = await alarmOf(m);
    if (due === null || due <= last) return { fired, next: null };
    if (due > horizon) return { fired, next: due };
    const before = publishedOf(m), from = log.writes.length;
    let ended = due;
    await later(due - Date.now(), async () => { await runAlarm(m); ended = Date.now(); });
    last = due;
    fired.push({ at: due, ended, published: publishedOf(m) !== before, writes: log.writes.slice(from), next: await alarmOf(m) });
  }
  return { fired, next: await alarmOf(m) };
}
/** "Due within the heartbeat": later than `from` and at most `heartbeat` after `until`; else what it is. */
const within = (due: number | null, from: number, until: number, heartbeat: number): string =>
  due === null ? 'no alarm armed' : due > from && due <= until + heartbeat ? 'due within WARM_HEARTBEAT_MS' : `due ${due - until} ms after (now ${until})`;
/** The heartbeats of a drive: each fired alarm that left another due within the heartbeat of its end, unbroken; the first break named. */
function chain(fired: Fired[], heartbeat: number): string {
  const broken = fired.findIndex(alarm => within(alarm.next, alarm.at, alarm.ended, heartbeat) !== 'due within WARM_HEARTBEAT_MS');
  return broken < 0 ? 'unbroken' : `broken at alarm ${broken + 1} of ${fired.length}: ${within(fired[broken]!.next, fired[broken]!.at, fired[broken]!.ended, heartbeat)}`;
}
/** Across the alarms of a drive: what any of them published or wrote. */
const effectsOf = (fired: Fired[]) => ({ published: fired.filter(alarm => alarm.published).map(alarm => alarm.at), written: [...new Set(fired.flatMap(alarm => alarm.writes))] });

/** A decision on the product page through the route production serves, unacknowledged: its lift read calls the placement's `/witness` door. */
async function witnessTouch(m: Mounted, log: StorageLog, shopper?: Awaited<ReturnType<typeof decide>>['shopper']) {
  const from = log.reads.length;
  const decided = await decide(m, 'pdp', { ...(shopper ? { shopper } : {}), ack: false });
  expect(log.reads.slice(from).includes('learnPublished') ? 'witness door called' : `no witness call (${show(sourcesMember(decided.snapshot, 'lift'))})`,
    `PRECONDITION (${m.host}): the decision's lift read calls the placement's /witness door`).toBe('witness door called');
  return decided;
}

// ===========================================================================
// unit:P70.WB1 — a touch keeps the statistics object's alarm within the heartbeat for the tail; a heartbeat does nothing else
// ===========================================================================

describe('unit:P70.WB1', () => {
  it('logic: src/durable-objects/LearnStats.ts exports WARM_HEARTBEAT_MS (5 000 ms: about 5 s, one alarm per 5 s is D1\'s 720 per object-hour, under the 12.7 s warm bound) and WARM_TAIL_MS (600 000 ms: about 10 minutes)', async () => {
    const { exported } = await warm();
    expect(exported, 'P70.WB1 — the keep-warm constants are named and exported (amendment 9 §2)').toEqual(RULED);
  });

  for (const host of HOSTS) {
    it(`host (${host}): after a decision's witness call, the statistics object holds an alarm due within WARM_HEARTBEAT_MS and keeps re-arming it, each heartbeat publishing nothing and writing no key, until WARM_TAIL_MS after the last touch (a second witness call half-way through the tail extends it); then the heartbeats stop and the alarm left is the ordinary one (the earliest learning-effect marker's expiry)`, async () => {
      const { heartbeat, tail } = await warm();
      const { m } = await liftWorld(host);
      const log = restartObject(m);
      const t0 = Date.now();
      const first = await witnessTouch(m, log);
      const firstDue = await alarmOf(m), t0end = Date.now();
      const half = await drive(m, log, t0 + tail / 2);
      const t1 = t0 + tail / 2;
      let t1end = t1;
      await later(t1 - Date.now(), async () => { await witnessTouch(m, log, first.shopper); t1end = Date.now(); });
      const secondDue = await alarmOf(m);
      const rest = await drive(m, log, t1 + tail + 2 * heartbeat);
      const lastHeartbeat = rest.fired.at(-1)?.at ?? null;
      expect.soft([within(firstDue, t0, t0end, heartbeat), within(secondDue, t1, t1end, heartbeat)],
        `${host}: P70.WB1 — after each witness call the object holds an alarm due within WARM_HEARTBEAT_MS (${heartbeat} ms)`).toEqual(['due within WARM_HEARTBEAT_MS', 'due within WARM_HEARTBEAT_MS']);
      expect.soft([chain(half.fired, heartbeat), half.fired.length >= Math.floor(tail / 2 / heartbeat) - 1 ? 'kept warm to the second touch' : `${half.fired.length} alarms in the first half of the tail`],
        `${host}: P70.WB1 — the heartbeats re-arm, unbroken, until the second touch`).toEqual(['unbroken', 'kept warm to the second touch']);
      expect.soft([chain(rest.fired.slice(0, -1), heartbeat),
        lastHeartbeat !== null && lastHeartbeat >= t1 + tail - heartbeat && lastHeartbeat <= t1 + tail + heartbeat ? 'the last heartbeat at the end of the tail' : `last heartbeat ${lastHeartbeat === null ? 'none' : `${lastHeartbeat - t1} ms after the last touch`}`,
        rest.next === ordinaryAfter(m, lastHeartbeat ?? t1) ? 'then the ordinary alarm' : `then ${rest.next === null ? 'no alarm' : `an alarm ${rest.next - (lastHeartbeat ?? t1)} ms later`} (the ordinary one ${String(ordinaryAfter(m, lastHeartbeat ?? t1))})`],
      `${host}: P70.WB1 — the heartbeats keep re-arming until WARM_TAIL_MS (${tail} ms) after the last touch, then stop`).toEqual(['unbroken', 'the last heartbeat at the end of the tail', 'then the ordinary alarm']);
      expect.soft(effectsOf([...half.fired, ...rest.fired]), `${host}: P70.WB1 — no heartbeat publishes (no version, archive, recent entry or learnPublished change) or writes a key`)
        .toEqual({ published: [], written: [] });
    }, 120_000);

    it(`host (${host}): after an exposure write (the decision's render acknowledgement) and after a credit write (a click on it), the statistics object holds an alarm due within WARM_HEARTBEAT_MS (today a write arms it ${PUBLISH_DELAY_MS / 1000} s ahead)`, async () => {
      const { heartbeat } = await warm();
      const { m } = await liftWorld(host);
      const decided = await decide(m, 'pdp', { ack: false });
      expect(decided.decision?.renderOffer, `${host}: PRECONDITION — the pooled module is offered for acknowledgement`).toMatch(/^ro1\./);
      restartObject(m);
      const ta = Date.now();
      const ack = await decided.shopper.ack(decided.snapshot, decided.decision!);
      await m.drainLedger();
      const ackDue = await alarmOf(m), taEnd = Date.now();
      restartObject(m);
      const tc = Date.now();
      const click = await decided.shopper.click(decided.snapshot, decided.decision!);
      await m.drainLedger();
      const clickDue = await alarmOf(m), tcEnd = Date.now();
      expect([ack.status, click.status], `${host}: PRECONDITION — the acknowledgement and the click are accepted`).toEqual([200, 200]);
      expect.soft({ exposure: within(ackDue, ta, taEnd, heartbeat), credit: within(clickDue, tc, tcEnd, heartbeat) },
        `${host}: P70.WB1 — after each write the object holds an alarm due within WARM_HEARTBEAT_MS (${heartbeat} ms)`).toEqual({ exposure: 'due within WARM_HEARTBEAT_MS', credit: 'due within WARM_HEARTBEAT_MS' });
    }, 60_000);
  }
});

// ===========================================================================
// unit:P70.WB2 — locks: the shared alarm (the 30 s publication, the effect-expiry order), no new remote call, the budgets, the ring
// ===========================================================================

describe('unit:P70.WB2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — the single alarm is shared: after a credit write exactly one alarm publishes before the tail ends, the first due at least ${PUBLISH_DELAY_MS / 1000} s (PUBLISH_DELAY_MS) after the write and within the heartbeat's granularity of it; after the tail the alarm is the earliest learning-effect marker's expiry, which, fired, removes the markers expired by then and leaves the next marker's expiry`, async () => {
      const { heartbeat, tail, tolerance } = await warm();
      const { m } = await liftWorld(host);
      const decided = await decide(m, 'pdp');
      const log = restartObject(m);
      const tw = Date.now();
      const click = await decided.shopper.click(decided.snapshot, decided.decision!);
      await m.drainLedger();
      const ta = Date.now();
      expect(click.status, `${host}: PRECONDITION — the click (a credit write) is accepted`).toBe(200);
      const run = await drive(m, log, ta + PUBLISH_DELAY_MS + tail + 2 * heartbeat);
      const publications = run.fired.filter(alarm => alarm.published).map(alarm => alarm.at);
      const at = publications[0];
      expect.soft([publications.length, at !== undefined && at >= tw + PUBLISH_DELAY_MS && at <= ta + PUBLISH_DELAY_MS + tolerance
        ? 'at PUBLISH_DELAY_MS after the write' : `at ${at === undefined ? 'no alarm' : `${at - tw} ms after the write`} (window ${PUBLISH_DELAY_MS} to ${ta - tw + PUBLISH_DELAY_MS + tolerance} ms)`],
      `${host}: P70.WB2 — one publication, at the write's PUBLISH_DELAY_MS within ${tolerance} ms (the heartbeat's granularity once WARM_HEARTBEAT_MS is exported); every alarm before it published nothing (${show(run.fired.map(alarm => [alarm.at - tw, alarm.published]).slice(0, 12))})`)
        .toEqual([1, 'at PUBLISH_DELAY_MS after the write']);
      const lastFired = run.fired.at(-1)?.at ?? ta;
      const expiry = ordinaryAfter(m, lastFired);
      expect(expiry, `${host}: PRECONDITION — the state holds learning-effect markers that expire later`).toEqual(expect.any(Number));
      expect.soft(run.next === expiry ? 'the earliest marker expiry' : `${run.next === null ? 'no alarm' : `an alarm ${run.next - lastFired} ms after the last one`} (expiry ${expiry! - lastFired} ms after it)`,
        `${host}: P70.WB2 — after the tail the alarm is the earliest learning-effect marker's expiry`).toBe('the earliest marker expiry');
      const markers = () => {
        const learn = placementOf(m).data.get('learn') as { effects?: Record<string, { expiresAt: number }>; retiredEffects?: Record<string, { expiresAt: number }> };
        return [...Object.values(learn.effects ?? {}), ...Object.values(learn.retiredEffects ?? {})].map(marker => marker.expiresAt);
      };
      const before = markers().length;
      await later(expiry! - Date.now(), () => runAlarm(m));
      const held = markers();
      expect.soft([held.length < before ? 'expired markers removed' : `${held.length} of ${before} markers held`, held.every(expiresAt => expiresAt > expiry!) ? 'every marker held expires later' : 'an expired marker held',
        await alarmAfter(m, expiry!) === ordinaryAfter(m, expiry!) ? 'the next marker expiry armed' : `alarm ${String(await alarmAfter(m, expiry!))} (next expiry ${String(ordinaryAfter(m, expiry!))})`],
      `${host}: P70.WB2 — the effect-expiry order: fired at the earliest expiry, the alarm removes the markers expired by then and arms the next expiry`)
        .toEqual(['expired markers removed', 'every marker held expires later', 'the next marker expiry armed']);
    }, 180_000);

    it(`host (${host}): LOCK — no new remote call before any answer: with ${LEVER_MS} ms added to every remote binding call, a decision on the product page, its acknowledgement and a click make, per binding and method, no more remote calls before their answer than the base; the decision's sources.budgets names the ${DEFAULT_BUDGET_MS} ms defaults`, async () => {
      const { m } = await liftWorld(host);
      const app = workerApp(m);
      const shopper = (await decide(m, 'pdp', { ack: false })).shopper;
      const lever = remoteLatency(m);
      const beyond: Array<[string, string[]]> = [];
      const measured = async <T extends { answeredAt: number }>(name: string, work: () => Promise<T>): Promise<T> => {
        const first = lever.calls.length;
        lever.set(LEVER_MS);
        let answer: T;
        try { answer = await work(); } finally { lever.set(0); }
        const calls = lever.calls.slice(first).filter(call => call.at <= answer.answeredAt).map(call => `${call.binding}.${call.method}`);
        beyond.push([name, beyondBase(host, name, calls)]);
        await settle(m, app);
        return answer;
      };
      const page = await measured('decision', () => snapshotWire(app, shopper.grant.capability, pageInstanceOf('p70-wb2-latency')));
      const d = page.decisions.find(decision => decision.slot === PDP_MODULES && decision.renderOffer);
      expect([page.status, d ? 'an acknowledgeable decision' : 'none'], `${host}: PRECONDITION — the product page is served with an acknowledgeable decision (${show(page.body)})`).toEqual([200, 'an acknowledgeable decision']);
      const ack = await measured('acknowledgement', () => ackWire(app, shopper, page, d!));
      const click = await measured('click', () => clickWire(app, shopper, page, d!));
      expect([ack.status, click.status], `${host}: PRECONDITION — the acknowledgement and the click are accepted`).toEqual([200, 200]);
      expect.soft(beyond, `${host}: P70.WB2 — no remote call before an answer beyond the base's (a heartbeat is alarm work, never on the answer path)`)
        .toEqual([['decision', []], ['acknowledgement', []], ['click', []]]);
      expect.soft([sourcesMember(page, 'budgets'), learningReadBudgets({}), LIFT_WITNESS_BUDGET_MS, RING_READ_BUDGET_MS],
        `${host}: P70.WB2 — the default budgets stay ${DEFAULT_BUDGET_MS} ms and sources.budgets reports them (amendment 9 §2)`)
        .toEqual([{ lift: DEFAULT_BUDGET_MS, ring: DEFAULT_BUDGET_MS }, { lift: DEFAULT_BUDGET_MS, ring: DEFAULT_BUDGET_MS }, DEFAULT_BUDGET_MS, DEFAULT_BUDGET_MS]);
    }, 60_000);

    it(`host (${host}): LOCK — the ring object is not kept warm (amendment 9 §2): a decision's ring read leaves the shopper's ring object's alarm as it was`, async () => {
      const { m } = await liftWorld(host);
      const decided = await decide(m, 'pdp');
      const ring = m.rings.get(ringName(TENANT, decided.shopper.subject));
      expect(ring ? 'held' : 'absent', `${host}: PRECONDITION — the shopper's ring object exists after the first decision`).toBe('held');
      const ringAlarm = () => (ring!.object as unknown as { state: DurableObjectState }).state.storage.getAlarm();
      const before = await ringAlarm();
      const again = await decide(m, 'pdp', { shopper: decided.shopper, ack: false });
      expect(sourcesMember(again.snapshot, 'ring'), `${host}: PRECONDITION — the decision read the ring`).toEqual(expect.objectContaining({ outcome: expect.any(String) }));
      expect.soft(await ringAlarm(), `${host}: P70.WB2 — the ring's alarm is the one it held before the read`).toBe(before);
    }, 60_000);
  }

  it('CONTROL: the alarm driver fires an armed alarm at its due time and reports what it left; the readings name a missing or late alarm', async () => {
    const { m } = await liftWorld('do');
    const log = restartObject(m);
    const storage = (placementOf(m).object as unknown as { state: DurableObjectState }).state.storage;
    const due = Date.now() + 1_000;
    await storage.setAlarm(due);
    expect(await alarmOf(m), 'CONTROL — the alarm read is the one the object holds').toBe(due);
    const run = await drive(m, log, due);
    expect([run.fired.length, run.fired[0]?.at, run.fired[0]!.ended >= due], 'CONTROL — the driver fired it once, at its due time, and stopped at its horizon').toEqual([1, due, true]);
    expect([within(null, 0, 0, 5_000), within(40_000, 0, 1_000, 5_000), within(3_000, 0, 1_000, 5_000)], 'CONTROL — the readings name a missing, a late and a timely alarm')
      .toEqual(['no alarm armed', 'due 39000 ms after (now 1000)', 'due within WARM_HEARTBEAT_MS']);
    expect(chain([{ at: 0, ended: 10, published: false, writes: [], next: 30_010 }], 5_000), 'CONTROL — a chain broken by a late alarm is named').toMatch(/^broken at alarm 1 of 1/);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The wire.
// ---------------------------------------------------------------------------

/** The product page's snapshot as the shopper's page asks for it (the body src/units/_parity.ts `snapshot` sends), on the wire without a drain. */
async function snapshotWire(app: WorkerApp, capability: string, pageInstance: string): Promise<Snapshot & { answeredAt: number }> {
  const response = await app.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, {
    method: 'POST', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance }),
  }));
  const answeredAt = performance.now();
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, body, page: 'pdp', pageInstance, decisions: (body.decisions ?? []) as Snapshot['decisions'], answeredAt };
}
const callCounts = (calls: string[]) => calls.reduce<Record<string, number>>((out, call) => ({ ...out, [call]: (out[call] ?? 0) + 1 }), {});
function beyondBase(host: string, name: string, calls: string[]): string[] {
  const base = BASE_CALLS_BEFORE_ANSWER[host]![name] ?? {};
  return Object.entries(callCounts(calls)).filter(([call, count]) => count > (base[call] ?? 0)).map(([call, count]) => `${call} ×${count} (base ${base[call] ?? 0})`);
}
