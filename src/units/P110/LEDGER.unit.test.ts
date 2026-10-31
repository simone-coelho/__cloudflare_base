// src/units/P110/LEDGER.unit.test.ts
// P110 under the Closure Ledger (programme tapestry-parity-gate-sweep, amendment 13 E34, "The gate counts, never times:
// the remaining sites"): the meta-legs of the LOCAL criteria GS1-GS5.
//
// The work order (docs/parity/gate-sweep/program.json, P110; D1 tests only, no product path) asks that every remaining
// assertion of the gate's tests that bounds wall-clock time from above, or depends on one random visitor, asserts
// counts, waves, recorded events or pinned subjects instead, the time staying printed as evidence, and that each counted
// form still turns RED on the defect its timed form caught (R-P716, R-P738). The box law (R-P706): every variant here
// is deterministic — a fake timer, the virtual clock, a held read, a variant fixture — never load.
//
// THE R10s (granted by name, every other expectation unchanged; the specifier's own):
//   GS1 src/index.api-boundary.test.ts W12.02: the state after each refused native send (the wrong URL, the wrong owner,
//       the altered body) is compared with the admitted state through `armedState` (./_counted.ts): the alarm, which the
//       object re-arms itself between two reads, compared as armed; the whole work count, which the object's own alarm
//       moves, left out; the entries, the resets and the work requests were admitted to (the fixture's new requestWork)
//       exact. (:1407, the mode
//       loop's `learning: true`, is NOT converted: its cause is the scope's lifetime against KV's 60-second minimum
//       expiration, not a delivery; reported to the lead.)
//   GS2 src/units/P102/LEDGER.unit.test.ts CR4: the trip window read on the virtual clock (./_counted.ts virtualClock):
//       each held read of G ms moves performance.now() by G and nothing else does. src/units/P109/LEDGER.unit.test.ts
//       GD1: the runs `observedAfterDelivery` reports are asserted beside the monitor's.
//   GS3 src/content/consent.test.ts and src/index.api-boundary.test.ts W10.03 (HELD_REFUSAL_BOUND_MS): the held witness
//       door answers, healthy, AT the bound, so a refusal means the budget's timer, due first, abandoned the read; the
//       elapsed time printed. src/index.api-boundary.test.ts W12.02's sibling (VALIDATION_DEADLINE_MS): the batch's
//       answer arrived while the gate still held the synthetic, so the product's own deadline ended the hold; the
//       elapsed time printed. W04.03: the socket observations wait on recorded frames and closes (./_events.ts), never
//       on a 4 s deadline; a 10 ms keep-alive tick re-checks them inside workerd (which cancels a request waiting only
//       on another context's message as hung) and decides nothing. src/units/P94 AD3 (NOISE_MS, ANSWER_BOUND_MS): each answer recorded with its counter calls
//       still unsettled, the queue after its read was abandoned; the times printed. src/units/P97 FV1/FV2 (HOLD_MS,
//       SAME_MS, WHOLE_MS): the holds released by the answer itself (LIVENESS_MS only a last-resort release, RED); the
//       times printed. FV3 (TRIP_MS): the trip and the restriction's read held on the virtual clock. P62's
//       ACK_DEADLINE_MS (:246) compares two constants and is not a wall-clock bound (GS4's list).
//   GS4 (the audit; every assertion that bounds wall-clock time from above): src/units/P62 LW4 (the ring door answers
//       at the budget plus RING_BOUND_SLACK_MS), src/units/P56 AA2, P58 BA2, P59 CO2 (waves of remote calls before the
//       answer, R-P734's form), src/units/P76 FA1 (the door on the virtual clock), src/units/P57 RC3 (the held send
//       awaited by its event). Every other clock read of a gate test is on GS4's list with its disposition.
//   GS5 src/units/P10/LEDGER.unit.test.ts F2: the CONTROL's shopper drawn through the mint as a pinned visitor
//       (./_pin.ts interiorAcrossHours, ../P108/_pins.ts drawnAs). P108 made share 1 explore every visitor, so the
//       random draw could no longer fail; the pin makes the CONTROL measure the product, never the draw.
//   P106.PC5's LOCKS_AT_D4596FD5 entry for src/units/P102/LEDGER.unit.test.ts is re-pinned in the same commit (R-P668).
//
// THE META-LEGS:
//   GS1 logic: armedState against the variants of a refused send — the object's own re-arm and its own alarm's work
//       (the timed form RED, the counted GREEN), an entry written, work admitted, a reset, the alarm cleared or set
//       (both RED); source scan.
//   GS2 host (both): the real product's cold door on the virtual clock: the copy's read issued after the head's answer
//       (a serial read) turns CR4's window RED (2 waves in one trip); each answer held a further LATE_MS on the real
//       timer keeps it GREEN on the virtual clock while the real-clock window is RED. logic: source scans.
//   GS3 logic: the real budget races of src/learn/fan.ts (liftWitnessVerdict, readRingWithOutcome) on fake timers
//       against a door answering at the bound: refused at the product's budget (GREEN); a budget past the bound
//       (RED, the door's answer applied); a delay before the read (the timed measure RED, the counted GREEN). The real
//       eventWait against the former 4 s poll: frames at 5 s (timed RED, counted GREEN), never (counted pending). The
//       virtual clock under FV3's shape: the object's time started after the trip (GREEN), before it (RED), CPU only
//       (counted GREEN, the real-clock form RED). Source scans of every GS3 site.
//   GS4 logic: the static scan — every clock read of a gate test file is on the list with its disposition; a new one
//       fails until it is listed. Source scans of the converted GS4 sites.
//   GS5 logic: the pinned visitor is interior on P10's story slot at this hour and the next; the product's own
//       explorationPick explores it at share 1 and does not at share 0 (the defect the CONTROL caught: exploration
//       withheld); source scan of P10.F2.
//
// IMPORTS FROM src/units/ (R-P4): ../_parity, ./_counted, ./_events, ./_pin (which imports ../P108/_pins). No product
// export is new.

import { readdirSync, readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { invalidatePublicationCache } from '@/config/publication';
import { explorationPick, type ExploreConfig } from '@/learn/explore';
import { LIFT_WITNESS_BUDGET_MS, liftWitnessVerdict, readRingWithOutcome, RING_READ_BUDGET_MS } from '@/learn/fan';
import type { LiftSnapshot } from '@/learn/stats';

import {
  BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, pageInstanceOf, readTree, TENANT, type Host, type Mounted,
} from '../_parity';
import { armedState, onVirtualClock, virtualClock, type NativeState } from './_counted';
import { eventWait } from './_events';
import { interiorAcrossHours } from './_pin';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

type Verdict = 'GREEN' | 'RED';
const verdictOf = (check: () => void): Verdict => { try { check(); return 'GREEN'; } catch { return 'RED'; } };
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const count = (text: string, needle: string) => text.split(needle).length - 1;
/** The text of `source` from `from` to `to` (exclusive), or '' where either is missing. */
const block = (source: string, from: string, to: string) => { const s = source.indexOf(from), e = source.indexOf(to, s + 1); return s >= 0 && e > s ? source.slice(s, e) : ''; };

// ===========================================================================
// unit:P110.GS1 — W12.02's refused sends compared with the alarm as armed
// ===========================================================================

describe('unit:P110.GS1 (E34: W12.02\'s later legs compare the state without the absolute time of an alarm the object re-arms itself)', () => {
  it('logic: against the admitted state, what the object\'s own alarm does between two reads (re-arms itself, runs its own work) turns the exact comparison RED and keeps armedState GREEN; a refused send that writes an entry, is admitted to work, resets, clears the alarm or sets one is RED for both', () => {
    const admitted: NativeState = { entries: [['__monitor_authority_v1', { operation: 'op-a' }], ['__monitor_data/op-a/row', 1]], alarm: 1_793_458_214_670, work: 17, resets: 0, requestWork: 9 };
    const unarmed: NativeState = { ...admitted, alarm: null };
    const after: Record<string, [NativeState, NativeState]> = {
      unchanged: [admitted, structuredClone(admitted)],
      rearmedByTheObject: [admitted, { ...admitted, alarm: admitted.alarm! + 5_000 }],
      theObjectsOwnAlarmWorks: [admitted, { ...admitted, alarm: admitted.alarm! + 5_000, work: admitted.work + 1 }],
      refusedWritesAnEntry: [admitted, { ...admitted, entries: [...admitted.entries, ['__monitor_data/op-a/wrong-url', 'x']] }],
      refusedDoesWork: [admitted, { ...admitted, work: admitted.work + 1, requestWork: admitted.requestWork + 1 }],
      refusedResets: [admitted, { ...admitted, resets: 1 }],
      refusedClearsTheAlarm: [admitted, { ...admitted, alarm: null }],
      refusedSetsAnAlarm: [unarmed, { ...unarmed, alarm: admitted.alarm }],
    };
    const seen = Object.fromEntries(Object.entries(after).map(([name, [before, now]]) => [name, {
      timed: verdictOf(() => expect(now).toEqual(before)),
      counted: verdictOf(() => expect(armedState(now)).toEqual(armedState(before))),
    }]));
    expect(seen, 'P110.GS1 — the counted form ignores only what the object\'s own alarm does').toEqual({
      unchanged: { timed: 'GREEN', counted: 'GREEN' },
      rearmedByTheObject: { timed: 'RED', counted: 'GREEN' },
      theObjectsOwnAlarmWorks: { timed: 'RED', counted: 'GREEN' },
      refusedWritesAnEntry: { timed: 'RED', counted: 'RED' },
      refusedDoesWork: { timed: 'RED', counted: 'RED' },
      refusedResets: { timed: 'RED', counted: 'RED' },
      refusedClearsTheAlarm: { timed: 'RED', counted: 'RED' },
      refusedSetsAnAlarm: { timed: 'RED', counted: 'RED' },
    });
  });

  it('logic: W12.02 compares the state after its refused wrong-URL, wrong-owner and altered-body sends through armedState, and no longer with the absolute alarm', () => {
    const source = readTree('src/index.api-boundary.test.ts');
    const w12 = block(source, "it('W12.02 real native source delivery", '\n}, 300000);');
    expect({
      found: w12.length > 0,
      imported: source.includes("import { armedState } from './units/P110/_counted';"),
      requestWork: source.includes('if (request) object.fixtureRequestWork++;') && source.includes('requestWork: object.fixtureRequestWork });'),
      counted: count(w12, 'expect(armedState(await state(binding))).toEqual(armedState(admitted));'),
      exact: count(w12, 'expect(await state(binding)).toEqual(admitted);'),
      wrongUrlFirst: /wrongUrl: true \}\)\)\.status\)\.not\.toBe\(200\);\n(?:\s*\/\/[^\n]*\n)*\s*expect\(armedState\(await state\(binding\)\)\)\.toEqual\(armedState\(admitted\)\);/.test(w12),
    }, 'P110.GS1 — W12.02\'s refused sends compared with the alarm as armed').toEqual({ found: true, imported: true, requestWork: true, counted: 2, exact: 0, wrongUrlFirst: true });
  });
});

// ===========================================================================
// unit:P110.GS2 — P102.CR4's trip window on a controlled clock; P109's meta-legs assert their runs
// ===========================================================================

const DOCS = { pieces: [...MODULES], slots: declaredSlots([layoutSlot()]), learn: learnDocument() };
const HEAD = `config-publication/v2/${TENANT}/head.json`;
const SERVING = `config-publication/v2/${TENANT}/serving.json`;
/** P102's harness latency: 100 ms a read; CR4's window [G - 2, G + G / 2] (src/units/P102 `tripShape`, `waveBound(1)`). */
const G = 100, LO = G - 2, HI = G + G / 2;
/** P109.GD3's late answers: each held a further 120 ms after its read (the load's signature). */
const LATE_MS = 120;

interface Trip { ms: number; read: string }
/** One entry of `sources.trips` as P102 reads it (`tripOf`): one number and the words of what it read. */
function tripOf(entry: unknown): Trip | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const values = Object.values(entry as Record<string, unknown>), numbers = values.filter((v): v is number => typeof v === 'number');
  const words = values.flatMap(v => typeof v === 'string' ? [v] : Array.isArray(v) && v.every(x => typeof x === 'string') ? v as string[] : []);
  return numbers.length === 1 ? { ms: numbers[0]!, read: words.join(' ').toLowerCase() } : null;
}

/**
 * The real product's cold door (a new visitor's first request, P102's door) with every publication read held G ms on
 * `clock` ('virtual': ./_counted.ts virtualClock; 'real': the real timer), under a variant above the hold: `serial`
 * issues the serving copy's read only once the head's read has been answered; `late` holds each answer a further
 * LATE_MS on the real timer. Returns the door's first trip (head and copy) as CR4 reads it.
 */
async function coldTrip(m: Mounted, clock: 'virtual' | 'real', variant: 'serial' | 'late' | null): Promise<Trip | string> {
  const bucket = m.storage as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const saved = { get: bucket.get!, head: bucket.head! };
  let answerHead: () => void = () => undefined;
  const headAnswered = new Promise<void>(resolve => { answerHead = resolve; });
  const run = async (hold: (ms: number) => Promise<void>) => {
    for (const op of ['get', 'head'] as const) {
      const original = saved[op].bind(m.storage);
      bucket[op] = async (...args: unknown[]) => {
        const key = String(args[0]), counted = key.startsWith('config-publication/');
        if (counted && variant === 'serial' && key === SERVING) await headAnswered;
        const answer = original(...args);
        if (counted) await hold(G);
        const out = await answer;
        if (key === HEAD) answerHead();
        if (counted && variant === 'late' && (key === HEAD || key === SERVING)) await sleep(LATE_MS);
        return out;
      };
    }
    invalidatePublicationCache();
    try {
      const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf(`p110-gs2-${clock}-${variant}`) }) }));
      const body = await response.json().catch(() => ({})) as { sources?: { trips?: unknown } };
      await m.drain();
      const trips = Array.isArray(body.sources?.trips) ? (body.sources!.trips as unknown[]).map(tripOf) : [];
      return trips[0] ?? `no sources.trips (${response.status})`;
    } finally { bucket.get = saved.get; bucket.head = saved.head; }
  };
  return clock === 'virtual' ? onVirtualClock(c => run(ms => c.hold(ms))) : run(sleep);
}
/** CR4's window on one trip (src/units/P102 `tripShape`): the head and the copy, whole milliseconds, within [LO, HI]. */
const cr4 = (trip: Trip | string): Verdict => verdictOf(() => {
  expect(typeof trip === 'string' ? trip : { head: /head/.test(trip.read), copy: /serving|copy/.test(trip.read), whole: Number.isInteger(trip.ms), within: trip.ms >= LO && trip.ms <= HI })
    .toEqual({ head: true, copy: true, whole: true, within: true });
});

describe('unit:P110.GS2 (E34: P102.CR4\'s trip window on a controlled clock; P109\'s meta-legs assert their runs)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the virtual clock the cold door's first trip reads exactly G for one wave of the head and the copy (CR4 GREEN), 2G when the copy's read waits for the head's answer (RED), and G when each answer is held a further ${LATE_MS} ms on the real timer (GREEN, while the real-clock window is RED)`, async () => {
      const m = await mount(host as Host, DOCS);
      expectPublished(m, 'P110.GS2 — the tenant documents publish');
      const warm = await coldTrip(m, 'virtual', null);
      expect(typeof warm === 'string' ? warm : 'a trip', `${host}: PRECONDITION — the door reports its documents stage's trips`).toBe('a trip');
      const control = await coldTrip(m, 'virtual', null), serial = await coldTrip(m, 'virtual', 'serial');
      const late = await coldTrip(m, 'virtual', 'late'), lateReal = await coldTrip(m, 'real', 'late');
      console.log(`P110.GS2 ${host} evidence: control ${JSON.stringify(control)}, serial ${JSON.stringify(serial)}, late ${JSON.stringify(late)}, late on the real clock ${JSON.stringify(lateReal)}`);
      expect({ control: cr4(control), serial: cr4(serial), serialMs: typeof serial === 'string' ? serial : serial.ms, late: cr4(late), lateOnTheRealClock: cr4(lateReal) },
        `${host}: P110.GS2 — CR4's window on the virtual clock catches a serial read and ignores late answers`)
        .toEqual({ control: 'GREEN', serial: 'RED', serialMs: 2 * G, late: 'GREEN', lateOnTheRealClock: 'RED' });
    }, 120_000);
  }

  it('logic: P102.CR4 reads its trips on the virtual clock, its window unchanged; P109.GD1 asserts the runs the counted form reports', () => {
    const p102 = readTree('src/units/P102/LEDGER.unit.test.ts'), p109 = readTree('src/units/P109/LEDGER.unit.test.ts');
    const cr4Block = block(p102, "describe('unit:P102.CR4", "describe('unit:P102.CR5");
    expect({
      virtual: /onVirtualClock\(async clock => \{\s*meter\.onRead = \(\) => clock\.hold\(G\);/.test(cr4Block),
      unheld: count(cr4Block, 'measured(meter, 0, () =>') === 4 && count(cr4Block, 'measured(meter, G,') === 0,
      window: cr4Block.includes('tripShape(t, G - 2, waveBound(1))'),
      reported: p109.includes('reported: answered ? answered.runs : null,'),
      table: count(p109, 'reported: 2 }') === 3 && p109.includes("runs: 1, reported: null }") && p109.includes("runs: 1, reported: 1 }"),
    }, 'P110.GS2 — CR4 on the virtual clock, GD1\'s runs asserted').toEqual({ virtual: true, unheld: true, window: true, reported: true, table: true });
  });
});

// ===========================================================================
// unit:P110.GS3 — the named wall-clock bounds as recorded events
// ===========================================================================

const WITNESS = 'a'.repeat(64), DIGEST = 'd'.repeat(64);
const SNAPSHOT = { witness: WITNESS, version: 1 } as unknown as LiftSnapshot;
/** A door that answers `answer` at `atMs` unless the caller's abort comes first (as a real fetch's does). */
function doorAt(atMs: number, answer: () => Response, record: { answered: number; abandoned: number }) {
  return (_input: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => { record.answered++; resolve(answer()); }, atMs);
    const abandon = () => { clearTimeout(timer); record.abandoned++; reject(new DOMException('aborted', 'AbortError')); };
    if (init?.signal?.aborted) abandon(); else init?.signal?.addEventListener('abort', abandon, { once: true });
  });
}
const namespaceOf = (fetch: (input: unknown, init?: RequestInit) => Promise<Response>) => ({ idFromName: (name: string) => name, get: () => ({ fetch }) });
/** The healthy witness answer that serves SNAPSHOT (src/learn/fan.ts liftWitnessVerdict's 'served'). */
const healthy = () => Response.json({ ok: true, tenant: TENANT, brand: BRAND, slot: 'hero', state: 'healthy', witness: WITNESS, publication: { witness: WITNESS, version: 1, digest: DIGEST } });
const ringAnswer = () => Response.json({ ok: true, ring: [] });

/**
 * One budget race of the real product (src/learn/fan.ts) on fake timers: the door answers at `doorAtMs` unless
 * abandoned; `beforeMs` of fake time passes before the read starts (a delay on the path that is not the read); the read
 * runs under `budgetMs`. Returns the verdict and the caller's measure from the start (fake Date).
 */
async function race(kind: 'witness' | 'ring', budgetMs: number, doorAtMs: number, beforeMs = 0) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const record = { answered: 0, abandoned: 0 }, started = Date.now();
  let outcome: string | null = null;
  const reading = (async () => {
    await sleep(beforeMs);
    if (kind === 'witness') {
      const verdict = await liftWitnessVerdict({ LEARN_STATS: namespaceOf(doorAt(doorAtMs, healthy, record)) } as never, TENANT, BRAND, 'hero', SNAPSHOT, undefined, async () => DIGEST, budgetMs);
      return verdict.outcome;
    }
    return (await readRingWithOutcome({ DECISION_RING: namespaceOf(doorAt(doorAtMs, ringAnswer, record)) } as never, TENANT, 'vis-p110', budgetMs)).read.outcome;
  })().then(o => { outcome = o; return Date.now() - started; });
  await vi.advanceTimersByTimeAsync(beforeMs + Math.max(budgetMs, doorAtMs) + 1_000);
  const measured = await reading;
  vi.useRealTimers();
  return { outcome, measured, record };
}

describe('unit:P110.GS3 (E34: the named wall-clock bounds assert recorded events, the time printed)', () => {
  it('logic: the witness budget (consent and W10.03, HELD_REFUSAL_BOUND_MS): on fake timers, with the door answering healthy at the bound, the product\'s budget refuses before it (counted GREEN); a budget past the bound applies the door\'s answer (RED); a delay before the read keeps the refusal (counted GREEN) while the caller\'s measure passes the bound (timed RED)', async () => {
    const bound = LIFT_WITNESS_BUDGET_MS + 200;
    const counted = (r: { outcome: string | null; record: { answered: number; abandoned: number } }): Verdict =>
      verdictOf(() => expect({ refused: r.outcome !== 'served', record: r.record }).toEqual({ refused: true, record: { answered: 0, abandoned: 1 } }));
    const timed = (r: { measured: number }): Verdict => verdictOf(() => expect(r.measured).toBeLessThan(bound));
    const atBudget = await race('witness', LIFT_WITNESS_BUDGET_MS, bound);
    const pastTheBound = await race('witness', bound + 1_000, bound);
    const delayed = await race('witness', LIFT_WITNESS_BUDGET_MS, bound, 500);
    expect({
      atBudget: { outcome: atBudget.outcome, counted: counted(atBudget), timed: timed(atBudget) },
      pastTheBound: { outcome: pastTheBound.outcome, counted: counted(pastTheBound), timed: timed(pastTheBound) },
      delayed: { outcome: delayed.outcome, counted: counted(delayed), timed: timed(delayed) },
    }, 'P110.GS3 — the held door\'s answer at the bound decides, never the caller\'s clock').toEqual({
      atBudget: { outcome: 'late', counted: 'GREEN', timed: 'GREEN' },
      pastTheBound: { outcome: 'served', counted: 'RED', timed: 'RED' },
      delayed: { outcome: 'late', counted: 'GREEN', timed: 'RED' },
    });
  });

  it('logic: the ring budget (P62.LW4, RING_BOUND_SLACK_MS 300): on fake timers, with the ring\'s door answering at the budget plus 300 ms, the product\'s budget abandons it first (counted GREEN); a budget past it reads the ring (RED); a delay before the read keeps the abandonment (counted GREEN) while the caller\'s measure passes the bound (timed RED)', async () => {
    const bound = RING_READ_BUDGET_MS + 300;
    const counted = (r: { outcome: string | null }): Verdict => verdictOf(() => expect(r.outcome).toBe('late'));
    const timed = (r: { measured: number }): Verdict => verdictOf(() => expect(r.measured).toBeLessThan(bound));
    const atBudget = await race('ring', RING_READ_BUDGET_MS, bound), pastTheBound = await race('ring', bound + 1_000, bound), delayed = await race('ring', RING_READ_BUDGET_MS, bound, 500);
    expect({ atBudget: [counted(atBudget), timed(atBudget)], pastTheBound: [counted(pastTheBound), timed(pastTheBound), pastTheBound.outcome], delayed: [counted(delayed), timed(delayed)] },
      'P110.GS3 — the ring door\'s answer at the budget plus the slack decides').toEqual({ atBudget: ['GREEN', 'GREEN'], pastTheBound: ['RED', 'RED', 'read'], delayed: ['GREEN', 'RED'] });
  });

  it('logic: W04.03\'s socket observation (./_events.ts eventWait with the fixture\'s 10 ms keep-alive, the function the native fixture runs): frames recorded 5 s after the wait began turn the former 4 s poll RED and resolve the event wait (GREEN); a frame that never comes leaves the event wait pending past W04.03\'s 20 s timeout, the keep-alive deciding nothing; a close resolves it as a frame does', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    /** The former form, verbatim in substance: poll every 10 ms, throw past a 4 s deadline. */
    const polled = async (predicate: () => boolean) => { const deadline = Date.now() + 4000; while (!predicate()) { if (Date.now() >= deadline) throw new Error('W04.03 socket observation timed out'); await sleep(10); } };
    const variant = async (frameAtMs: number | null, closes = false) => {
      const item: { frames: Array<{ type: string }>; closed: number | null } = { frames: [], closed: null }, events = eventWait();
      if (frameAtMs !== null) setTimeout(() => { if (closes) item.closed = 1008; else item.frames.push({ type: 'connected' }); events.recorded(); }, frameAtMs);
      const predicate = closes ? () => item.closed !== null : () => item.frames.some(f => f.type === 'connected');
      let timed: Verdict | 'pending' = 'pending', counted: Verdict | 'pending' = 'pending';
      void polled(predicate).then(() => { timed = 'GREEN'; }, () => { timed = 'RED'; });
      void events.until(predicate, 10).then(() => { counted = 'GREEN'; });
      await vi.advanceTimersByTimeAsync(20_000);
      return { timed, counted, pending: events.pending() };
    };
    const seen = { late: await variant(5_000), never: await variant(null), onTime: await variant(50), closeLate: await variant(5_000, true) };
    vi.useRealTimers();
    expect(seen, 'P110.GS3 — W04.03 waits on the recorded frames, never on the clock').toEqual({
      late: { timed: 'RED', counted: 'GREEN', pending: 0 },
      never: { timed: 'RED', counted: 'pending', pending: 1 },
      onTime: { timed: 'GREEN', counted: 'GREEN', pending: 0 },
      closeLate: { timed: 'RED', counted: 'GREEN', pending: 0 },
    });
  });

  it('logic: P97.FV3\'s shape on the virtual clock (./_counted.ts, the clock FV3 runs on): the object\'s own time started after the trip\'s hold reads under TRIP_MS (GREEN); started before the hold, it reads the trip (RED); CPU after the hold moves nothing on the virtual clock (GREEN) and passes TRIP_MS on the real one (RED)', async () => {
    const TRIP = 400, RESTRICT = 150;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    /** The door holds the activation TRIP before the object; the object holds its restriction read RESTRICT and reports `op` from its own start. */
    const activation = async (hold: (ms: number) => Promise<void>, now: () => number, opStartsBeforeTrip: boolean, cpuMs: number) => {
      const early = now();
      await hold(TRIP);
      const arrived = opStartsBeforeTrip ? early : now();
      await hold(RESTRICT);
      if (cpuMs) await sleep(cpuMs); // CPU or a delay that is not a hold of the path (fake time passes, no hold)
      return Math.round(now() - arrived);
    };
    const onClock = async (opStartsBeforeTrip: boolean, cpuMs: number) => {
      const clock = virtualClock();
      try {
        const op = activation(ms => clock.hold(ms), () => performance.now(), opStartsBeforeTrip, cpuMs);
        await vi.advanceTimersByTimeAsync(TRIP + RESTRICT + cpuMs + 10);
        return await op;
      } finally { clock.restore(); }
    };
    const onRealClock = async (cpuMs: number) => { const op = activation(sleep, () => Date.now(), false, cpuMs); await vi.advanceTimersByTimeAsync(TRIP + RESTRICT + cpuMs + 10); return op; };
    const verdict = (op: number): Verdict => verdictOf(() => expect(op).toBeLessThan(TRIP));
    const seen = { ownTime: await onClock(false, 0), startedBeforeTheTrip: await onClock(true, 0), cpu: await onClock(false, 400), cpuOnTheRealClock: await onRealClock(400) };
    vi.useRealTimers();
    expect({ ...seen, verdicts: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, verdict(v)])) }, 'P110.GS3 — FV3\'s op on the virtual clock counts the holds on its path').toEqual({
      ownTime: RESTRICT, startedBeforeTheTrip: TRIP + RESTRICT, cpu: RESTRICT, cpuOnTheRealClock: RESTRICT + 400,
      verdicts: { ownTime: 'GREEN', startedBeforeTheTrip: 'RED', cpu: 'GREEN', cpuOnTheRealClock: 'RED' },
    });
  });

  it('logic: every named GS3 site asserts its recorded event and prints its time — consent and W10.03 (the held door answers at HELD_REFUSAL_BOUND_MS), W12.02\'s sibling (answered while the gate held), W04.03 (the event wait), P94.AD3 (unsettled records, the read abandoned), P97 FV1/FV2 (released by the answer; LIVENESS_MS) and FV3 (the virtual clock); P62\'s ACK_DEADLINE_MS compares two constants', () => {
    const consent = readTree('src/content/consent.test.ts'), boundary = readTree('src/index.api-boundary.test.ts');
    const p94 = readTree('src/units/P94/LEDGER.unit.test.ts'), p97 = readTree('src/units/P97/LEDGER.unit.test.ts'), p62 = readTree('src/units/P62/LEDGER.unit.test.ts');
    const fv3 = block(p97, "describe('unit:P97.FV3", "it(`host (${host}): LOCK — no answer a browser receives");
    expect({
      consent: { door: /setTimeout\(\(\) => \{ heldDoor\.answered\+\+; resolve\(target\.fetch\(/.test(consent) && consent.includes('}, HELD_REFUSAL_BOUND_MS);'),
        event: consent.includes('expect(heldDoor).toEqual({ abandoned: 1, answered: 0 });'), bound: /toBeLessThan\(HELD_REFUSAL_BOUND_MS\)/.test(consent) },
      w1003: { door: boundary.includes('const HELD_WITNESS_MS = HELD_REFUSAL_BOUND_MS;') && boundary.includes("this.fault.mode === 'hold-health') await new Promise(resolve => setTimeout(resolve, ${HELD_WITNESS_MS}));"),
        bound: /elapsedMs\)\.toBeLessThan\(/.test(boundary) },
      sibling: { bound: /expect\(elapsed\)\.toBeLessThan\(VALIDATION_DEADLINE_MS/.test(boundary), printed: boundary.includes("console.log('W12.02 ordinary sibling ' + JSON.stringify({ roundTrip, allowance, elapsed, deadline: VALIDATION_DEADLINE_MS }));") },
      w0403: { events: boundary.includes('const waitFor = (predicate, phase = \'unspecified\') => socketEvents.until(predicate, 10);') && count(boundary, 'socketEvents.recorded();') === 2,
        deadline: boundary.includes('const deadline = Date.now() + 4000;') },
      p94: { noise: /<= NOISE_MS/.test(p94), ordinaryTime: /ordinaryTime/.test(p94), events: p94.includes('queue: at.queue.readsAbandoned > 0') && p94.includes('recordAfterTheAnswer: true, counted') },
      p97: { hold: /< HOLD_MS|sleep\(HOLD_MS\)/.test(p97), same: /< SAME_MS|< WHOLE_MS/.test(p97), liveness: count(p97, 'sleep(LIVENESS_MS).then(() => null)') === 4 && count(p97, 'releasedByLiveness = true') === 2,
        fv3: fv3.includes('onVirtualClock(async clock => {') && count(fv3, 'await w.hold(TRIP_MS);') === 2 && fv3.includes("parts.op! < TRIP_MS") },
      p62: p62.includes("expect(Math.max(lift, ring) < ACK_DEADLINE_MS, 'P62.LW1 — both are inside the SDK\\'s deadline').toBe(true);"),
    }, 'P110.GS3 — each named site counts, its time printed').toEqual({
      consent: { door: true, event: true, bound: false },
      w1003: { door: true, bound: false },
      sibling: { bound: false, printed: true },
      w0403: { events: true, deadline: false },
      p94: { noise: false, ordinaryTime: false, events: true },
      p97: { hold: false, same: false, liveness: true, fv3: true },
      p62: true,
    });
  });
});

// ===========================================================================
// unit:P110.GS4 — the audit: every clock read of a gate test, converted or named
// ===========================================================================

type Disposition = 'converted' | 'not an upper bound' | 'reported';
interface Site { file: string; text: string; count?: number; disposition: Disposition; why: string }
/**
 * Every line of a gate test file (src/**\/*.test.ts and the src/units/ harness files they import) that reads the clock
 * for a duration — `performance.now()`, or `Date.now() - <a start>` — with what it is used for. A comment line is not
 * a clock read. `text` is a fragment of the line; `count` (default 1) the number of such lines in the file.
 */
const SITES: Site[] = [
  { file: 'src/content/consent.test.ts', text: 'samples.push(performance.now() - start);', disposition: 'not an upper bound', why: 'W10.03\'s cold and warm samples: asserted finite and at least 0 (a lower bound), printed' },
  { file: 'src/content/consent.test.ts', text: 'const heldMs = performance.now() - start;', disposition: 'converted', why: 'GS3: printed; the held door answering at HELD_REFUSAL_BOUND_MS decides (heldDoor abandoned 1, answered 0)' },
  { file: 'src/demos/kit/actionRoutes.retry.test.ts', text: 'took: Date.now() - started', disposition: 'not an upper bound', why: 'read on vi\'s fake clock (useFakeTimers with Date faked): an injected clock, never the wall' },
  { file: 'src/demos/kit/actionRoutes.retry.test.ts', text: 'expect(Date.now() - started).toBeGreaterThanOrEqual(1950);', disposition: 'not an upper bound', why: 'a lower bound: the retries waited at least their schedule' },
  { file: 'src/index.api-boundary.test.ts', text: 'delta = Date.now() - value.bornAt;', disposition: 'not an upper bound', why: 'the fixture\'s renewal shifts a scope by its age; no assertion' },
  { file: 'src/index.api-boundary.test.ts', text: 'return Response.json({ accepted, elapsedMs: Date.now() - start });', disposition: 'converted', why: 'GS3 (W10.03): printed; the hold-health door answers healthy at HELD_REFUSAL_BOUND_MS, accepted false decides' },
  { file: 'src/index.api-boundary.test.ts', text: 'roundTrip = Math.max(roundTrip, Date.now() - sent);', disposition: 'converted', why: 'GS3 (W12.02 sibling): the former allowance, printed only' },
  { file: 'src/index.api-boundary.test.ts', text: 'const elapsed = Date.now() - began;', disposition: 'converted', why: 'GS3 (W12.02 sibling): printed; the batch answered while the gate held the synthetic' },
  { file: 'src/middleware/auth.claims-boundary.test.ts', text: 'elapsedMs:Date.now()-started', disposition: 'not an upper bound', why: 'W02.06/W02.08 report the native run\'s time in console.info; not asserted' },
  { file: 'src/middleware/auth.claims-boundary.test.ts', text: 'elapsedMs:Date.now()-now', disposition: 'not an upper bound', why: 'printed in console.info; not asserted' },
  { file: 'src/middleware/auth.claims-boundary.test.ts', text: 'elapsedMs:Date.now()-barrierStarted', disposition: 'not an upper bound', why: 'printed in console.info; not asserted' },
  { file: 'src/reflex/contentCompose.test.ts', text: 'const start = performance.now();', disposition: 'not an upper bound', why: 'W38.05\'s composer samples: printed (median_improved printed, not asserted); the work counts are asserted' },
  { file: 'src/reflex/contentCompose.test.ts', text: 'samples[side].push(performance.now() - start);', disposition: 'not an upper bound', why: 'printed, as above' },
  { file: 'src/routes/realtime.sdkContract.test.ts', text: "const started = performance.now(); let phase = 'setup';", disposition: 'not an upper bound', why: 'W14\'s bounded import phases: console.info only' },
  { file: 'src/routes/realtime.sdkContract.test.ts', text: "console.info('W14 bounded import phase', { host, phase, elapsedMs: Math.round(performance.now() - started) });", count: 2, disposition: 'not an upper bound', why: 'console.info only' },
  { file: 'src/units/P102/LEDGER.unit.test.ts', text: "counted = meter.armed && key.startsWith('config-publication/'), start = performance.now();", disposition: 'not an upper bound', why: 'the meter\'s read start: waves (CR1-CR3, R-P707); CR4 reads it on the virtual clock (GS2)' },
  { file: 'src/units/P102/LEDGER.unit.test.ts', text: 'meter.reads.push({ key, cls: classOf(key), start, end: performance.now() });', disposition: 'not an upper bound', why: 'the meter\'s read end: waves; CR4 on the virtual clock' },
  { file: 'src/units/P103/LEDGER.unit.test.ts', text: 'held = true; at = performance.now(); reached();', disposition: 'not an upper bound', why: 'MP3\'s ring hold start: printed in the message only (heldMs)' },
  { file: 'src/units/P103/LEDGER.unit.test.ts', text: 'heldMs: () => (at ? performance.now() - at : 0)', disposition: 'not an upper bound', why: 'printed in MP3\'s message only; its `within(answer, bound + BOUND_SLACK_MS)` race is a race-form bound outside this scan (reported)' },
  { file: 'src/units/P104/_fold.ts', text: 'const started = performance.now();', disposition: 'not an upper bound', why: 'the fold run\'s time written to its log line; not asserted' },
  { file: 'src/units/P104/_fold.ts', text: 'ms: Math.round(performance.now() - started)', disposition: 'not an upper bound', why: 'logged, not asserted' },
  { file: 'src/units/P105/LEDGER.unit.test.ts', text: 'at: performance.now(), qualifying: issuedByQualification()', disposition: 'not an upper bound', why: 'the trace\'s call time: which calls came before the answer (event order)' },
  { file: 'src/units/P105/LEDGER.unit.test.ts', text: 'sentAt = performance.now();', count: 3, disposition: 'not an upper bound', why: 'the waves before the answer (R-P734); the ms printed as evidence' },
  { file: 'src/units/P105/LEDGER.unit.test.ts', text: 'const answeredAt = performance.now();', count: 3, disposition: 'not an upper bound', why: 'the waves before the answer (R-P734); the ms printed' },
  { file: 'src/units/P105/LEDGER.unit.test.ts', text: "counted = armed && key.startsWith('config-publication/'), start = performance.now();", disposition: 'not an upper bound', why: 'the read meter: waves' },
  { file: 'src/units/P105/LEDGER.unit.test.ts', text: 'if (counted) reads.push({ key, start, end: performance.now() });', disposition: 'not an upper bound', why: 'the read meter: waves' },
  { file: 'src/units/P109/LEDGER.unit.test.ts', text: "counted = meter.armed && key.startsWith('config-publication/'), start = performance.now();", disposition: 'not an upper bound', why: 'GD3\'s meter: waves' },
  { file: 'src/units/P109/LEDGER.unit.test.ts', text: "meter.reads.push({ cls: key === SERVING ? 'serving copy' : key === HEAD ? 'head' : key, start, end: performance.now() });", disposition: 'not an upper bound', why: 'GD3\'s meter: waves' },
  { file: 'src/units/P56/LEDGER.unit.test.ts', text: 'const start = performance.now();', disposition: 'not an upper bound', why: 'the lever CONTROL: took >= 195 (a lower bound)' },
  { file: 'src/units/P56/LEDGER.unit.test.ts', text: 'const took = performance.now() - start;', disposition: 'not an upper bound', why: 'a lower bound' },
  { file: 'src/units/P58/LEDGER.unit.test.ts', text: 'const start = performance.now();', disposition: 'not an upper bound', why: 'the lever CONTROL: a lower bound' },
  { file: 'src/units/P58/LEDGER.unit.test.ts', text: 'const took = performance.now() - start;', disposition: 'not an upper bound', why: 'a lower bound' },
  { file: 'src/units/P59/LEDGER.unit.test.ts', text: 'pathname, at: performance.now() });', disposition: 'not an upper bound', why: 'the door log: a credit before the next answer (event order)' },
  { file: 'src/units/P59/LEDGER.unit.test.ts', text: 'const start = performance.now();', disposition: 'not an upper bound', why: 'the lever CONTROL: a lower bound' },
  { file: 'src/units/P59/LEDGER.unit.test.ts', text: 'const took = performance.now() - start;', disposition: 'not an upper bound', why: 'a lower bound' },
  { file: 'src/units/P61/LEDGER.unit.test.ts', text: 'const sentAt = performance.now();', disposition: 'not an upper bound', why: 'LO3: the waves before the answer (R-P734); ms printed' },
  { file: 'src/units/P61/LEDGER.unit.test.ts', text: 'const answeredAt = performance.now();', disposition: 'not an upper bound', why: 'LO3: the waves before the answer' },
  { file: 'src/units/P62/LEDGER.unit.test.ts', text: 'const started = performance.now();', disposition: 'converted', why: 'GS4 (LW4): printed; the ring door answers at the budget plus RING_BOUND_SLACK_MS' },
  { file: 'src/units/P62/LEDGER.unit.test.ts', text: 'const elapsed = performance.now() - started, calls = lever.calls.length;', disposition: 'converted', why: 'GS4 (LW4): printed' },
  { file: 'src/units/P66/LEDGER.unit.test.ts', text: 'answeredAt = performance.now();', disposition: 'not an upper bound', why: 'the calls made before the last link\'s answer (event order)' },
  { file: 'src/units/P67/LEDGER.unit.test.ts', text: 'timestamp: Date.now() - offset', disposition: 'not an upper bound', why: 'builds an event\'s past timestamp; not a measure' },
  { file: 'src/units/P70/LEDGER.unit.test.ts', text: 'const answeredAt = performance.now();', disposition: 'not an upper bound', why: 'the calls made before the answer (event order)' },
  { file: 'src/units/P76/LEDGER.unit.test.ts', text: 'const start = performance.now();', disposition: 'converted', why: 'GS4 (FA1): the held forward\'s start, read on the virtual clock' },
  { file: 'src/units/P76/LEDGER.unit.test.ts', text: 'held.forward = { start, end: performance.now() };', disposition: 'converted', why: 'GS4 (FA1): on the virtual clock' },
  { file: 'src/units/P76/LEDGER.unit.test.ts', text: 'const started = performance.now();', disposition: 'converted', why: 'GS4 (FA1): the door\'s measure on the virtual clock' },
  { file: 'src/units/P76/LEDGER.unit.test.ts', text: 'const measured = performance.now() - started;', disposition: 'converted', why: 'GS4 (FA1): on the virtual clock' },
  { file: 'src/units/P93/LEDGER.unit.test.ts', text: 'out.seconds = Math.round((Date.now() - started) / 1000);', disposition: 'not an upper bound', why: 'printed in CS1\'s messages only' },
  { file: 'src/units/P94/LEDGER.unit.test.ts', text: 'const sent = performance.now();', disposition: 'converted', why: 'GS3 (AD3): printed; unsettled records and the abandoned read decide' },
  { file: 'src/units/P94/LEDGER.unit.test.ts', text: 'ms: performance.now() - sent', disposition: 'converted', why: 'GS3 (AD3): printed' },
  { file: 'src/units/P94/LEDGER.unit.test.ts', text: 'Date.now() - seen.at < KV_READ_CACHE_MS', disposition: 'not an upper bound', why: 'the fixture\'s 60 s KV read cache (the platform\'s behaviour emulated); no assertion' },
  { file: 'src/units/P96/LEDGER.unit.test.ts', text: 'const started = performance.now();', disposition: 'reported', why: 'LOCK: total <= measured + 2 (internal within external: load only grows measured) and |sum - total| < SLACK, a CPU-only gap with no hold on its path: no count sees it (the R-P707 trade); reported to the lead, kept' },
  { file: 'src/units/P96/LEDGER.unit.test.ts', text: 'const measured = performance.now() - started;', disposition: 'reported', why: 'as above' },
  { file: 'src/units/P97/LEDGER.unit.test.ts', text: 'const started = performance.now();', disposition: 'converted', why: 'GS3 (FV1/FV2 printed; FV3 on the virtual clock)' },
  { file: 'src/units/P97/LEDGER.unit.test.ts', text: 'const measured = performance.now() - started;', disposition: 'converted', why: 'GS3: printed' },
  { file: 'src/units/P97/_copy.ts', text: 'started: performance.now(), ended: null', disposition: 'not an upper bound', why: 'recorded on the copy call, never asserted' },
  { file: 'src/units/P97/_copy.ts', text: 'call.ended = performance.now();', disposition: 'not an upper bound', why: 'recorded, never asserted' },
  { file: 'src/units/P98/_load.ts', text: 'new Date(Date.now() - minutes * 60_000)', disposition: 'not an upper bound', why: 'builds a past upload time; not a measure' },
  { file: 'src/units/W23/B1.unit.test.ts', text: '${Date.now() - decisionTs} ms later', disposition: 'not an upper bound', why: 'in a message only' },
  { file: 'src/units/W37/FIX2.unit.test.ts', text: 'while (Date.now() - started < 90_000 && Date.now() - since < 7_000) {', disposition: 'reported', why: 'a settle wait (7 s without change, 90 s cap) before the stored objects are read: not an assertion bound, but an elapsed-time dependence of the kind of W12.02 :1407; reported as a follow-up' },
  { file: 'src/units/W37/LEDGER.unit.test.ts', text: 'while (Date.now() - started < 90_000 && Date.now() - since < 7_000) {', disposition: 'reported', why: 'as FIX2\'s: a settle wait, reported as a follow-up' },
  { file: 'src/units/W38/LEDGER.unit.test.ts', text: 'const started = performance.now();', disposition: 'not an upper bound', why: 'W38.B5\'s measurement: printed; decisions asserted' },
  { file: 'src/units/W38/LEDGER.unit.test.ts', text: 'ms = performance.now() - started;', disposition: 'not an upper bound', why: 'printed' },
  { file: 'src/units/_parity8.ts', text: 'const sentAt = performance.now();', disposition: 'reported', why: 'the Wire: waves before the answer (P56.AA2, P58.BA2, P59.CO2 converted, GS4; P61, P105 R-P734) and event order (P59, P66, P70); P64.OT4 bounds ms(refused) - ms(success) < COUNTER_STORE_MS / 2 from above: reported to the lead, kept' },
  { file: 'src/units/_parity8.ts', text: 'const answeredAt = performance.now();', disposition: 'reported', why: 'as above (P64.OT4 reported)' },
  { file: 'src/units/_parity8.ts', text: 'const call: RemoteCall = { binding, method, at: performance.now() };', disposition: 'not an upper bound', why: 'the lever\'s call start: waves and event order' },
  { file: 'src/units/_parity8.ts', text: 'call.end = performance.now();', disposition: 'not an upper bound', why: 'the lever\'s call end (R-P734): waves' },
  { file: 'src/units/_parity8.ts', text: 'writes.push({ key, value, at: performance.now() });', disposition: 'not an upper bound', why: 'session writes before the answer (event order, P58)' },
];
/** The scan's rule: a line reading the clock for a duration; a comment line is not one. */
const CLOCK_READ = /performance\.now\(\)|Date\.now\(\) *- *[a-z_][A-Za-z0-9_.]*/;
const ROOT = new URL('../../../', import.meta.url);
function clockReads(): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
      const rel = `${dir}${entry.name}`;
      if (entry.isDirectory()) { walk(`${rel}/`); continue; }
      if (!/\.ts$/.test(entry.name) || !(/\.test\.ts$/.test(rel) || rel.startsWith('src/units/')) || rel.startsWith('src/units/P110/')) continue;
      readFileSync(new URL(rel, ROOT), 'utf8').split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (CLOCK_READ.test(line) && !/^(\/\/|\/\*|\*)/.test(trimmed)) out.push({ file: rel, line: i + 1, text: trimmed });
      });
    }
  };
  walk('src/');
  return out;
}

describe('unit:P110.GS4 (E34: every clock read of a gate test converted or named, with its line)', () => {
  it('logic: every line of a gate test file that reads the clock for a duration is on the list with its disposition; a new one fails until it is listed', () => {
    const found = clockReads();
    const unlisted = found.filter(f => !SITES.some(s => s.file === f.file && f.text.includes(s.text))).map(f => `${f.file}:${f.line} ${f.text.slice(0, 160)}`);
    const over = SITES.map(s => ({ s, n: found.filter(f => f.file === s.file && f.text.includes(s.text)).length })).filter(({ s, n }) => n > (s.count ?? 1))
      .map(({ s, n }) => `${s.file}: "${s.text}" ${n} times, listed ${s.count ?? 1}`);
    const listed = SITES.map(s => `${s.disposition.padEnd(18)} ${s.file}:${found.filter(f => f.file === s.file && f.text.includes(s.text)).map(f => f.line).join(',') || 'gone'} — ${s.why}`);
    console.log(`P110.GS4 — ${found.length} clock reads, ${SITES.length} listed:\n${listed.join('\n')}`);
    expect({ unlisted, over }, 'P110.GS4 — a clock read not on the list (convert it, or list it with its disposition and line)').toEqual({ unlisted: [], over: [] });
  });

  it('logic: the converted GS4 sites count — P62.LW4 the ring door at the bound, P56.AA2/P58.BA2/P59.CO2 waves before the answer, P76.FA1 on the virtual clock, P57.RC3 the held send by its event', () => {
    const p62 = readTree('src/units/P62/LEDGER.unit.test.ts'), p57 = readTree('src/units/P57/LEDGER.unit.test.ts'), p76 = readTree('src/units/P76/LEDGER.unit.test.ts');
    const waves = ['P56', 'P58', 'P59'].map(u => readTree(`src/units/${u}/LEDGER.unit.test.ts`));
    expect({
      p62: { door: p62.includes('lever.delay(ringBudget + RING_BOUND_SLACK_MS);'), race: /setTimeout\(\(\) => resolve\('unanswered'\), ringBudget \+ RING_BOUND_SLACK_MS\)/.test(p62) },
      waves: waves.map(t => ({ counted: /expect\.soft\(waves, `\$\{host\}: P5[689]\.[A-Z]+2 — /.test(t) && t.includes('.toBeLessThan(') && /wavesBefore\(lever\.calls, first, answer\.answeredAt\)/.test(t), elapsed: /expect\.soft\(elapsed,/.test(t) })),
      p76: count(p76, 'await onClock(() => door(') === 2,
      p57: { event: p57.includes('while (!reached) { await later(); reached = held.sends > 0; }'), bound: /Date\.now\(\) - start < HOLD_BOUND_MS/.test(p57) },
    }, 'P110.GS4 — the converted sites').toEqual({
      p62: { door: true, race: false }, waves: [{ counted: true, elapsed: false }, { counted: true, elapsed: false }, { counted: true, elapsed: false }],
      p76: true, p57: { event: true, bound: false },
    });
  });
});

// ===========================================================================
// unit:P110.GS5 — P10's exploration CONTROL draws a pinned visitor
// ===========================================================================

describe('unit:P110.GS5 (E34: P10.F2\'s "at floor 0 the slot explores" draws a pinned visitor)', () => {
  it('logic: the pinned visitor is interior on P10\'s story slot at this hour and the next; the product\'s explorationPick explores it at share 1 and not at share 0 (the CONTROL\'s defect: exploration withheld), at both hours; P10.F2 draws its shopper as that visitor through the mint', () => {
    const STORY = 'pdp-story', now = Date.now(), pin = interiorAcrossHours(STORY, now);
    const ranked = [{ id: 'story.tabby', score: 0.9 }, { id: 'story.willow', score: 0.5 }, { id: 'story.rogue', score: 0.1 }];
    const pick = (share: number, at: number) => explorationPick({ visitorId: pin.subject, slot: STORY, nowMs: at, ranked, snapshot: null,
      cfg: { mode: 'rotation', share, floor: 50 } as ExploreConfig })?.mode ?? 'not explored';
    const p10 = readTree('src/units/P10/LEDGER.unit.test.ts'), f2 = block(p10, "describe('unit:P10.F2", "describe('unit:P10.F3");
    expect({
      interior: pin.raw.every(raw => raw < 0.5), subject: /^vis-[0-9a-f-]{36}$/.test(pin.subject),
      shareOne: [pick(1, now), pick(1, now + 3_600_000)], shareZero: [pick(0, now), pick(0, now + 3_600_000)],
      drawn: f2.includes('const s = await drawnAs(interiorAcrossHours(STORY, Date.now()), () => paidSocial(m));'), random: /const s = await paidSocial\(m\);/.test(f2),
      control: f2.includes("expect(above.some(r => r.explored), `${host}: CONTROL — at floor 0 the slot explores`).toBe(true);"),
    }, `P110.GS5 — the pinned visitor ${pin.subject} (raw ${JSON.stringify(pin.raw)})`).toEqual({
      interior: true, subject: true, shareOne: ['rotation', 'rotation'], shareZero: ['not explored', 'not explored'], drawn: true, random: false, control: true,
    });
  });
});

