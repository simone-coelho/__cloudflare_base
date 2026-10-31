// src/units/P61/LEDGER.unit.test.ts
// P61 under the Closure Ledger: the tests for the LOCAL criteria of the P61 work
// order (the lift-witness programme, amendment 6, ticket P61 "Every lift and ring
// outcome is told in sources and counted in the monitor"). D1 (RESOLVED, R-P110:
// outcomes are named on the answer's sources, never on the record) is exercised
// inside LO1-LO4; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P61.<criterion>')` per LOCAL criterion, every host leg walked
// on both shopper hosts. Expected values come from the work order and the witnesses
// it cites, never from what the engine answers today:
//   · THE AUTHORITY, verbatim (docs/parity/authority/amendment-6/BTI-Parity-Amendment-2026-10-19b.md,
//     section 2, P61): "On both shopper hosts, every decision's answer names the
//     lift read's outcome per learning slot in `sources.lift` (`served | none |
//     incompatible | late | superseded | unrecognized | unhealthy | failed`, with the
//     milliseconds) and the ring read's outcome in `sources.ring` (`read | late |
//     failed | skipped`, with the milliseconds); the monitor counts each outcome per
//     tenant; the ledger record, the replay equality and the shopper's
//     `decisions[]` do not change (P07 C4, P42 PW3, P49, P50 units unchanged); the
//     witness returns its reason internally while its boolean shape stays for
//     today's callers."
//   · THE ANALYSIS (_evidence/baseline-52/lift-budget/ANALYSIS.md at 452d2c38):
//     §1 rows 1-4 (the store read, `compatible()`, the witness and its match
//     conditions, the ring read: "a miss withholds the lift or the fatigue term
//     silently (`explain.lift: null`, `versions.lift: 0`, nothing in `sources`, no
//     log line, no counter)"); §3 E1 (a witness answer after the budget: "sources
//     keys unchanged (no member names the miss)"), E3 (a superseded copy refused),
//     E4 (the ring after its budget: no fatigue term); §5 F1 and the RED tests R1
//     (budget ± 10), R4 (the ring ± 10) and R5 (the monitor counts).
//   · TODAY'S CODE the ruling reads: the decision path's one `Promise.all` of the
//     ring read and every slot's lift read, skipped on the default arm
//     (src/content/service.ts `serveContentDecisions`, :906-908); the lift read
//     (`readLift`, :154-192: the isolate cache, the store read, `compatible()`, the
//     witness on a cache hit and on a cold read); the witness
//     (src/learn/fan.ts `currentLiftWitness`, :24-45: `false` on any refusal, its
//     50 ms timer at :43); the ring read (`readRing`, :859-872: `null` when late or
//     failing, its 60 ms default); the answer's `sources` (service.ts:1137-1148,
//     passed whole onto the snapshot answer by src/routes/decisions.ts:1154); the
//     monitor's tenant counters and the three conditions they are written under
//     (service.ts `serveContentDecisions`, the W20 G2 governance counters, :1060-1085,
//     R94(1): tracking consent, no synthetic operation, no self-check; CW31).
//
// THE TELLING, RULED (D1 leaves the representation to the specifier; R-P7, R-P15):
//   · `sources.lift` is present on every answer: an object keyed by slot name with
//     one member per slot whose lift the decision read — every active slot of the
//     page on an arm that personalizes (service.ts:908) — each exactly
//     `{ ms, outcome }`; `{}` on the default arm, which reads no lift.
//   · `outcome`, the first that applies:
//       'none'          the store holds no copy for the placement;
//       'incompatible'  `compatible()` refuses the copy (service.ts:156-161);
//       'failed'        the store read or the witness call errored, or the witness
//                       answer is not a witness answer (not OK, not JSON, another
//                       placement's);
//       'late'          the witness did not answer within its budget;
//       'unhealthy'     the object answered a state other than `healthy`;
//       'served'        the copy was applied (the record names its version);
//       'superseded'    a copy the object published and no longer accepts: it has
//                       published a later version since (P62 then serves a copy of
//                       the same generation inside its window, which is 'served';
//                       outside it, or of another generation, it stays 'superseded');
//       'unrecognized'  any other copy: a version or a digest the object never
//                       published (a forged or damaged copy), and (R-P113) a copy
//                       that is still the object's latest publication when a reset
//                       has since changed the object's witness (P62.LW3 tests it).
//     `ms`: the slot's lift read, from its start to its outcome, in whole
//     milliseconds; for 'late' at least the budget in force. The units allow 1 ms
//     below the budget for the timer's granularity (libuv fires a timer by its
//     cached loop time, which can trail `performance.now()` by up to a millisecond).
//   · `sources.ring` is present on every answer, exactly `{ ms, outcome }`: 'read'
//     (the ring answered within its budget, an empty ring included), 'late' (it did
//     not), 'failed' (the call errored or its answer is not a ring answer),
//     'skipped' with `ms: 0` (the decision read no ring: no slot of the page has a
//     fatigue dial it applies, or the default arm: service.ts:906-907).
//   · THE MONITOR: the run's result (`POST /v1/:tenant/monitor`, src/routes/decisions.ts:684-690,
//     `runMonitor`) carries `learningReads: { since, scope: 'tenant', lift: { <each
//     of the eight outcomes>: count }, ring: { <each of the four>: count } }`, every
//     outcome present, zero reported as zero; `since` the counters' horizon, as the
//     governance counters state theirs. A decision is counted exactly when the
//     governance counters would count it (tracking consent, no synthetic
//     operation, no self-check), so the monitor's own probe decisions never count
//     and a shopper who withheld tracking is never counted (CW31).
//   · NOTHING ELSE CHANGES: the ledger record (no member of its own, no word of an
//     outcome), its replay, the answer's top-level members and every
//     `decisions[]` member are today's; `currentLiftWitness` still resolves to a
//     boolean for its callers (service.ts:167, :191; src/index.api-boundary.test.ts:497).
//   · THE BUDGETS IN FORCE. P61 rules no budget. Its units read the budget in force
//     loosely (src/units/_parity9.ts `inForce`): `LIFT_WITNESS_BUDGET_MS` and
//     `RING_READ_BUDGET_MS` once P62 exports them, today's literals (50 and 60)
//     before; and P62's recent-publication window `LIFT_RECENT_WINDOW_MS` (0 before
//     P62), so the 'superseded' copy is one P62 does not accept either and every
//     unit of the batch can be green at once.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `sources.lift`, `sources.ring` on the answer; `learningReads` on the monitor's
// result. No new export is imported.
//
//   · R-P120 (the P61 delivery review's findings F2-F4, pinned on the build at 949e695b):
//       F3 — a read answered from the isolate's cache entry that a failed store read
//       filled is `failed` too, with its ms, as the read that filled it;
//       F2 (R-P115) — the count never waits on the shopper: under the AA2 latency lever
//       (500 ms on every remote call, customer profile, cold lift cache) the counted
//       snapshot and the render acknowledgement sent right after it answer with the
//       same own remote calls as when the count's own store calls cost nothing, and
//       (R-P734, counted, never timed) no more waves of remote calls before either answer; the count's
//       store calls are the ones naming its document (`learningReadsKey`, src/learn/fan.ts
//       in the build);
//       F4 — the count's work is handed the operator cache alone (no other binding is
//       reachable from it); it is never invoked for a synthetic operation (the
//       internal synthetic monitor's served decision, armed as W26.R2.synthetic arms
//       it); and it starts only when the shopper's owner operation answered (an
//       operation refused for authority mid-way, `SessionAccessError` from a binding
//       call, counts nothing). The count's hand-over is observed by a pass-through of
//       its after-answer hook (`afterOwnerAnswer`, the module mock at the end of this
//       file: it records each registration, whether its work started and the bindings
//       reachable from the environment the work was handed, and forwards all of it).
//   · NOT RULED: `learningReads` on a kept result (`GET /v1/:tenant/monitor`,
//     `readMonitor` → `projectMonitor`, which rebuilds a kept result member by member);
//     the counters' behaviour under concurrent decisions.
//
// R10 (expectations that lock present behaviour, listed for the lead; none is edited
// here): none from P61. Measured under a sketch of P61 and P62 on a scratch copy of
// this tree (the whole suite, _evidence/parity-step3/S11/specifier/logs/sketch2-full.*,
// against the same copy without the sketch, base-full.*): every expectation the sketch
// turns RED is P62's (the witness door, the raised budgets) and is listed in
// src/units/P62/LEDGER.unit.test.ts. The answer's top-level key pin
// (src/routes/realtime.sdkContract.test.ts:6385) holds: the telling lives inside
// `sources`.
//
// FIXTURE. P08's pooled world (src/units/_parity6.ts: the complete-the-look module
// pooled on the product and home pages; rendered-v1, reward click, γ 1, nMin 2), as
// P42.PW3 drives it (two product-page visits, one home-page visit, every placement
// published), with P10's fatigue dial on the product page's slot so a product-page
// decision reads the visitor's ring; the home page has no fatigue dial. Every
// decision is a new consenting shopper's product or home page through
// `POST /v1/:tenant/decisions/snapshot`, the pooled module's render acknowledged and
// its stored record read back (P42.PW3's path).
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (publication through every
// object's own door), src/units/_parity6.ts (P08's world), src/units/_parity9.ts (the
// lift world, the levers, the readers). Imports from src/units/: ../_parity,
// ../_parity3, ../_parity6, ../_parity9.

import { describe, expect, it, vi } from 'vitest';

import { invalidateLiftCache } from '@/content/service';
import type { DecisionRecord } from '@/content/types';
import { currentLiftWitness, liftKey } from '@/learn/fan';
import type { LiftSnapshot } from '@/learn/stats';

import { BRAND, HOSTS, PAID_SOCIAL_ENTRY, pageInstanceOf, putDocument, replayOf, shopperOn, TENANT, VIEW_TABBY_26, type Decision, type Mounted, type Snapshot } from '../_parity';
import { publishStats } from '../_parity3';
import { dials, learnOf } from '../_parity6';
import {
  copyLever, copyOf, damageAndRestart, decide, fanExports, fatigued, forged, HOME_MODULES, inForce, later, liftOnRecord, liftReadOf, liftWorld, monitorRun, PDP_MODULES,
  POOLED, republish, ringLever, ringReadOf, sourcesMember, witnessLever,
} from '../_parity9';

const LIFT_OUTCOMES = ['served', 'none', 'incompatible', 'late', 'superseded', 'unrecognized', 'unhealthy', 'failed'] as const;
const RING_OUTCOMES = ['read', 'late', 'failed', 'skipped'] as const;

/** The ruled report of one read, exactly `{ ms, outcome }`; returns its milliseconds. */
function expectRead(read: unknown, outcome: string, label: string): number {
  expect(read, `${label}: the answer names { outcome: '${outcome}', ms }`).toEqual({ outcome, ms: expect.any(Number) });
  const ms = (read as { ms: number }).ms;
  expect(Number.isInteger(ms) && ms >= 0, `${label}: ms is a whole, non-negative number of milliseconds (${ms})`).toBe(true);
  return ms;
}
/** The record of a decision that applied no learned lift (src/content/decide.ts:1975: `versions.lift` 0, `explain.lift` null). */
const UNSERVED = { version: 0, lift: null };
/** The record of a decision that applied the copy: its version, and the pooled module's lift itemised. */
const servedFrom = (version: number) => ({ version, lift: expect.objectContaining({ lift: expect.any(Number), n: expect.any(Number) }) });
/** The slots `sources.lift` names, or the sentence naming its absence. */
const slotsNamed = (snapshot: Snapshot): unknown => {
  const lift = sourcesMember(snapshot, 'lift');
  return typeof lift === 'object' && lift !== null ? Object.keys(lift).sort() : lift;
};

// ===========================================================================
// unit:P61.LO1 — every lift read names its outcome, with its milliseconds
// ===========================================================================

describe('unit:P61.LO1 (R-P110, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): served — a published, confirmed copy is applied and the answer names sources.lift['${PDP_MODULES}'] { outcome: 'served', ms } (and sources.lift['${HOME_MODULES}'] on the home page); a page names its own slots only`, async () => {
      const { m, v1 } = await liftWorld(host);
      const pdp = await decide(m, 'pdp');
      expect(liftOnRecord(pdp.record), `${host}: PRECONDITION — the decision applied the published copy (its record names version ${v1!.version})`).toEqual(servedFrom(v1!.version));
      expectRead(liftReadOf(pdp.snapshot, PDP_MODULES), 'served', `${host}: P61.LO1 — served, product page`);
      expect(slotsNamed(pdp.snapshot), `${host}: P61.LO1 — the product page's answer names its own slot only`).toEqual([PDP_MODULES]);
      const home = await decide(m, 'home');
      expect(liftOnRecord(home.record), `${host}: PRECONDITION — the home page applied its own placement's copy`).toEqual(servedFrom(copyOf(m, HOME_MODULES)!.version));
      expectRead(liftReadOf(home.snapshot, HOME_MODULES), 'served', `${host}: P61.LO1 — served, home page`);
      expect(slotsNamed(home.snapshot), `${host}: P61.LO1 — the home page's answer names its own slot only`).toEqual([HOME_MODULES]);
    }, 120_000);

    it(`host (${host}): late — with the witness door answering 10 ms after the budget in force, the copy is not applied and the answer names 'late' with ms at or above the budget; CONTROL: answering at a fifth of the budget, 'served' with ms at or above that delay`, async () => {
      const { liftBudget } = await inForce();
      const { m, v1 } = await liftWorld(host);
      const lever = witnessLever(m);
      lever.delay(liftBudget + 10);
      const late = await decide(m, 'pdp');
      lever.delay(Math.floor(liftBudget / 5));
      const control = await decide(m, 'pdp');
      lever.restore();
      expect(lever.calls.length, `${host}: PRECONDITION — the decision path called the statistics object's witness door through the lever`).toBeGreaterThanOrEqual(2);
      expect(liftOnRecord(late.record), `${host}: PRECONDITION (ANALYSIS §3 E1) — a witness answer after the budget applies nothing`).toEqual(UNSERVED);
      const ms = expectRead(liftReadOf(late.snapshot), 'late', `${host}: P61.LO1 — late (budget ${liftBudget} ms, the door ${liftBudget + 10} ms late)`);
      expect(ms, `${host}: P61.LO1 — a late read reports at least the budget it waited (${liftBudget} ms, less the timer's 1 ms granularity)`).toBeGreaterThanOrEqual(liftBudget - 1);
      expect(liftOnRecord(control.record), `${host}: CONTROL — a witness answer inside the budget applies the copy`).toEqual(servedFrom(v1!.version));
      const controlMs = expectRead(liftReadOf(control.snapshot), 'served', `${host}: P61.LO1 CONTROL — served under the budget`);
      expect(controlMs, `${host}: P61.LO1 CONTROL — the served read reports the ${Math.floor(liftBudget / 5)} ms the door took`).toBeGreaterThanOrEqual(Math.floor(liftBudget / 5) - 1);
    }, 120_000);

    it(`host (${host}): unrecognized — a copy the object never published (the published copy with one counter changed, its version and witness kept) is not applied and the answer names 'unrecognized'; CONTROL: the copy as published is 'served'`, async () => {
      const { m, v1 } = await liftWorld(host);
      let undo = copyLever(m, forged(v1!.raw));
      const refused = await decide(m, 'pdp');
      undo();
      invalidateLiftCache();
      undo = copyLever(m, v1!.raw);
      const control = await decide(m, 'pdp');
      undo();
      expect(liftOnRecord(refused.record), `${host}: PRECONDITION (W38 B7, :857-863) — a digest the object did not publish is refused`).toEqual(UNSERVED);
      expectRead(liftReadOf(refused.snapshot), 'unrecognized', `${host}: P61.LO1 — unrecognized`);
      expect(liftOnRecord(control.record), `${host}: CONTROL — the copy as published is applied`).toEqual(servedFrom(v1!.version));
      expectRead(liftReadOf(control.snapshot), 'served', `${host}: P61.LO1 CONTROL — served`);
    }, 120_000);

    it(`host (${host}): incompatible — after the learn document is republished with the product slot measured on served-v1, the rendered-v1 copy is refused by compatible() and the answer names 'incompatible'; CONTROL: before the republish, 'served'`, async () => {
      const { m } = await liftWorld(host);
      const control = await decide(m, 'pdp');
      const changed = await putDocument(m, 'learn', learnOf({ [PDP_MODULES]: dials('click', { measurementBasis: 'served-v1' }), [HOME_MODULES]: dials() }), 'p61-incompatible');
      expect(changed.status, `${host}: PRECONDITION — the learn document republishes (${JSON.stringify(changed.body).slice(0, 200)})`).toBe(200);
      invalidateLiftCache();
      const refused = await decide(m, 'pdp', { ack: false });
      expectRead(liftReadOf(refused.snapshot), 'incompatible', `${host}: P61.LO1 — incompatible`);
      expectRead(liftReadOf(control.snapshot), 'served', `${host}: P61.LO1 CONTROL — served before the republish`);
    }, 120_000);

    it(`host (${host}): none — with no copy published for the placement the answer names 'none'; CONTROL: once the placement publishes, 'served'`, async () => {
      const { m } = await liftWorld(host, { publish: false });
      const nothing = await decide(m, 'pdp');
      await publishStats(m);
      invalidateLiftCache();
      const control = await decide(m, 'pdp');
      expect(liftOnRecord(nothing.record), `${host}: PRECONDITION — nothing published, nothing applied`).toEqual(UNSERVED);
      expectRead(liftReadOf(nothing.snapshot), 'none', `${host}: P61.LO1 — none`);
      expectRead(liftReadOf(control.snapshot), 'served', `${host}: P61.LO1 CONTROL — served once published`);
    }, 120_000);

    it(`host (${host}): unhealthy — with the statistics object's state damaged as W23 H1.01 damages it (counters anchored thirty days ahead) and the object started over it, the answer names 'unhealthy'; CONTROL: before the damage, 'served'`, async () => {
      const { m, v1 } = await liftWorld(host);
      const control = await decide(m, 'pdp');
      damageAndRestart(m);
      invalidateLiftCache();
      const refused = await decide(m, 'pdp');
      expect(liftOnRecord(refused.record), `${host}: PRECONDITION (W23 H1.01) — an object that is not healthy confirms nothing`).toEqual(UNSERVED);
      expectRead(liftReadOf(refused.snapshot), 'unhealthy', `${host}: P61.LO1 — unhealthy`);
      expect(liftOnRecord(control.record), `${host}: CONTROL — the healthy object's copy is applied`).toEqual(servedFrom(v1!.version));
      expectRead(liftReadOf(control.snapshot), 'served', `${host}: P61.LO1 CONTROL — served before the damage`);
    }, 120_000);

    it(`host (${host}): superseded — after new evidence and the placement's alarm publish V2, a store still answering V1, read later than the recent-publication window in force, is not applied and the answer names 'superseded'; CONTROL: the store answering V2, 'served'`, async () => {
      const { window } = await inForce();
      const { m, v1 } = await liftWorld(host);
      const v2 = await republish(m);
      invalidateLiftCache();
      const control = await decide(m, 'pdp');
      invalidateLiftCache();
      const undo = copyLever(m, v1!.raw);
      // The shifted clock writes nothing to the statistics object: the decision is not acknowledged.
      const refused = await later(window > 0 ? window + 60_000 : 0, () => decide(m, 'pdp', { ack: false }));
      undo();
      expect(liftOnRecord(control.record), `${host}: CONTROL — the latest copy, V2, is applied`).toEqual(servedFrom(v2.version));
      expectRead(liftReadOf(refused.snapshot), 'superseded', `${host}: P61.LO1 — superseded (V1 ${v1!.version}, V2 ${v2.version}, read ${window > 0 ? `${window + 60_000} ms later, past the window` : 'with no window in force'})`);
      expectRead(liftReadOf(control.snapshot), 'served', `${host}: P61.LO1 CONTROL — served from V2`);
    }, 120_000);

    it(`host (${host}): failed — with the witness call failing, the answer names 'failed'; CONTROL: with the call restored, 'served'`, async () => {
      const { m, v1 } = await liftWorld(host);
      const lever = witnessLever(m);
      lever.fail(true);
      const refused = await decide(m, 'pdp');
      lever.fail(false);
      const control = await decide(m, 'pdp');
      lever.restore();
      expect(liftOnRecord(refused.record), `${host}: PRECONDITION — a failed witness confirms nothing`).toEqual(UNSERVED);
      expectRead(liftReadOf(refused.snapshot), 'failed', `${host}: P61.LO1 — failed`);
      expect(liftOnRecord(control.record), `${host}: CONTROL — restored, the copy is applied`).toEqual(servedFrom(v1!.version));
      expectRead(liftReadOf(control.snapshot), 'served', `${host}: P61.LO1 CONTROL — served`);
    }, 120_000);

    it(`host (${host}): a decision that reads no lift — the default arm of a shopper who withheld tracking and personalization (src/content/service.ts:908) — names no outcome: sources.lift is {}`, async () => {
      const { m } = await liftWorld(host);
      const shopper = await shopperOn(m, { tracking: false, personalization: false });
      const refused = await decide(m, 'pdp', { shopper, ack: false });
      expect(refused.snapshot.body.arm, `${host}: PRECONDITION — the shopper's decision is the default arm`).toBe('default');
      expect(sourcesMember(refused.snapshot, 'lift'), `${host}: P61.LO1 — the default arm reads no lift and names none: sources.lift is {}`).toEqual({});
    }, 120_000);

    it(`host (${host}): failed (R-P120 F3) — a lift store read that throws is 'failed' with its ms, and so is the read answered from the cache entry it filled; CONTROL: the store answering and the cache dropped, 'served'`, async () => {
      const { m } = await liftWorld(host);
      const restore = failingStoreRead(m);
      const cold = await decide(m, 'pdp', { ack: false });
      restore();
      const cached = await decide(m, 'pdp', { ack: false });
      invalidateLiftCache();
      const fresh = await decide(m, 'pdp', { ack: false });
      expectRead(liftReadOf(cold.snapshot), 'failed', `${host}: P61.LO1 — a lift store read that throws`);
      expectRead(liftReadOf(cached.snapshot), 'failed', `${host}: P61.LO1 — R-P120 F3: the read answered from the cache entry that failed read filled`);
      expectRead(liftReadOf(fresh.snapshot), 'served', `${host}: P61.LO1 CONTROL — the store answering, a fresh read`);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P61.LO2 — the ring read names its outcome, with its milliseconds
// ===========================================================================

describe('unit:P61.LO2 (R-P110, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): read — the product page's fatigue dial reads the visitor's ring, and the answer names sources.ring { outcome: 'read', ms } (an empty ring on the shopper's first page, the pooled module fatigued on the second)`, async () => {
      const { m } = await liftWorld(host);
      const first = await decide(m, 'pdp');
      const again = await decide(m, 'pdp', { shopper: first.shopper });
      expect(fatigued(again.snapshot), `${host}: PRECONDITION — the ring was read: the module served on the shopper's first page is fatigued on the second`).toBe(true);
      expectRead(ringReadOf(first.snapshot), 'read', `${host}: P61.LO2 — read (an empty ring)`);
      expectRead(ringReadOf(again.snapshot), 'read', `${host}: P61.LO2 — read`);
    }, 120_000);

    it(`host (${host}): late — with the ring answering 10 ms after the ring budget in force, no fatigue term and 'late' with ms at or above the budget; CONTROL: answering at a fifth of the budget, 'read' and fatigued`, async () => {
      const { ringBudget } = await inForce();
      const { m } = await liftWorld(host);
      const first = await decide(m, 'pdp');
      const lever = ringLever(m);
      lever.delay(ringBudget + 10);
      const late = await decide(m, 'pdp', { shopper: first.shopper });
      lever.delay(Math.floor(ringBudget / 5));
      const control = await decide(m, 'pdp', { shopper: first.shopper });
      lever.restore();
      expect(fatigued(late.snapshot), `${host}: PRECONDITION (ANALYSIS §3 E4) — a ring answer after its budget leaves no fatigue term`).toBe(false);
      const ms = expectRead(ringReadOf(late.snapshot), 'late', `${host}: P61.LO2 — late (budget ${ringBudget} ms)`);
      expect(ms, `${host}: P61.LO2 — a late ring read reports at least the budget it waited (${ringBudget} ms, less 1 ms)`).toBeGreaterThanOrEqual(ringBudget - 1);
      expect(fatigued(control.snapshot), `${host}: CONTROL — a ring answer inside the budget fatigues the module served before`).toBe(true);
      const controlMs = expectRead(ringReadOf(control.snapshot), 'read', `${host}: P61.LO2 CONTROL — read under the budget`);
      expect(controlMs, `${host}: P61.LO2 CONTROL — the read reports the ${Math.floor(ringBudget / 5)} ms the ring took`).toBeGreaterThanOrEqual(Math.floor(ringBudget / 5) - 1);
    }, 120_000);

    it(`host (${host}): failed — with the ring call failing, no fatigue term and 'failed'; CONTROL: restored, 'read' and fatigued`, async () => {
      const { m } = await liftWorld(host);
      const first = await decide(m, 'pdp');
      const lever = ringLever(m);
      lever.fail(true);
      const refused = await decide(m, 'pdp', { shopper: first.shopper });
      lever.fail(false);
      const control = await decide(m, 'pdp', { shopper: first.shopper });
      lever.restore();
      expect(fatigued(refused.snapshot), `${host}: PRECONDITION — a failed ring read leaves no fatigue term`).toBe(false);
      expectRead(ringReadOf(refused.snapshot), 'failed', `${host}: P61.LO2 — failed`);
      expect(fatigued(control.snapshot), `${host}: CONTROL — restored, the module served before is fatigued`).toBe(true);
      expectRead(ringReadOf(control.snapshot), 'read', `${host}: P61.LO2 CONTROL — read`);
    }, 120_000);

    it(`host (${host}): skipped — a page with no fatigue dial (the home page) and a default-arm decision read no ring and name { outcome: 'skipped', ms: 0 }; CONTROL: the product page's dial, 'read'`, async () => {
      const { m } = await liftWorld(host);
      const lever = ringLever(m);
      const home = await decide(m, 'home');
      const withheld = await decide(m, 'pdp', { shopper: await shopperOn(m, { tracking: false, personalization: false }), ack: false });
      const reads = lever.calls.length;
      const control = await decide(m, 'pdp');
      lever.restore();
      expect(reads, `${host}: PRECONDITION — neither the home page nor the default arm called the ring`).toBe(0);
      expect(ringReadOf(home.snapshot), `${host}: P61.LO2 — skipped, the home page has no fatigue dial`).toEqual({ outcome: 'skipped', ms: 0 });
      expect(ringReadOf(withheld.snapshot), `${host}: P61.LO2 — skipped, the default arm`).toEqual({ outcome: 'skipped', ms: 0 });
      expectRead(ringReadOf(control.snapshot), 'read', `${host}: P61.LO2 CONTROL — the product page reads the ring`);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P61.LO3 — the monitor counts each outcome per tenant
// ===========================================================================

type Counts = { lift: Record<string, number>; ring: Record<string, number> };
const zeros = (): Counts => ({ lift: Object.fromEntries(LIFT_OUTCOMES.map(o => [o, 0])), ring: Object.fromEntries(RING_OUTCOMES.map(o => [o, 0])) });
/** The run's `learningReads`, or a sentence naming its absence and the result's members. */
function learningReadsOf(result: Record<string, unknown>): Record<string, unknown> | string {
  return Object.hasOwn(result, 'learningReads') && typeof result.learningReads === 'object' && result.learningReads !== null
    ? result.learningReads as Record<string, unknown>
    : `absent: the monitor result carries no learningReads member (members: ${Object.keys(result).join(', ')})`;
}
/** The counts of a `learningReads` member, every outcome named (a missing one reads as the sentence that names it). */
function countsOf(reads: Record<string, unknown>): { lift: Record<string, unknown>; ring: Record<string, unknown> } {
  const pick = (block: unknown, names: readonly string[]) => Object.fromEntries(names.map(n => [n,
    block && typeof block === 'object' && Object.hasOwn(block, n) ? (block as Record<string, unknown>)[n] : `no ${n} count`]));
  return { lift: pick(reads.lift, LIFT_OUTCOMES), ring: pick(reads.ring, RING_OUTCOMES) };
}
const delta = (after: ReturnType<typeof countsOf>, before: ReturnType<typeof countsOf>): Counts => ({
  lift: Object.fromEntries(LIFT_OUTCOMES.map(o => [o, Number(after.lift[o]) - Number(before.lift[o])])),
  ring: Object.fromEntries(RING_OUTCOMES.map(o => [o, Number(after.ring[o]) - Number(before.ring[o])])),
});
/** What the answers reported, tallied: every slot's lift outcome and the ring outcome of each answer. */
function tally(snapshots: Snapshot[]): Counts {
  const out = zeros();
  for (const snapshot of snapshots) {
    const lift = sourcesMember(snapshot, 'lift'), ring = ringReadOf(snapshot) as { outcome?: string };
    for (const read of Object.values(typeof lift === 'object' && lift !== null ? lift as Record<string, { outcome?: string }> : {})) {
      if (read?.outcome && read.outcome in out.lift) out.lift[read.outcome]! += 1;
    }
    if (ring?.outcome && ring.outcome in out.ring) out.ring[ring.outcome]! += 1;
  }
  return out;
}

describe('unit:P61.LO3 (R-P110, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): five consenting decisions (served/read; late/read; served/late; the home page served/skipped; unrecognized/read) and one tracking-withheld decision: the monitor's learningReads moves by exactly the outcomes the five reported, for the tenant; CONTROL: a second run with no decision between moves nothing (the monitor's own probe decisions are never counted)`, async () => {
      const { liftBudget, ringBudget } = await inForce();
      const { m, v1 } = await liftWorld(host);
      const first = learningReadsOf(await monitorRun(m));
      expect(first, `${host}: P61.LO3 — the monitor counts the tenant's lift and ring outcomes`).toMatchObject({ scope: 'tenant', since: expect.any(Number) });
      const baseline = countsOf(first as Record<string, unknown>);
      expect(Object.values(baseline.lift).concat(Object.values(baseline.ring)).every(n => Number.isSafeInteger(n) && (n as number) >= 0),
        `${host}: P61.LO3 — every outcome is counted, zero reported as zero (${JSON.stringify(baseline)})`).toBe(true);

      const answers: Snapshot[] = [];
      answers.push((await decide(m, 'pdp')).snapshot);
      const witness = witnessLever(m);
      witness.delay(liftBudget + 10);
      answers.push((await decide(m, 'pdp')).snapshot);
      witness.restore();
      const ring = ringLever(m);
      ring.delay(ringBudget + 10);
      answers.push((await decide(m, 'pdp')).snapshot);
      ring.restore();
      answers.push((await decide(m, 'home')).snapshot);
      invalidateLiftCache();
      const undo = copyLever(m, forged(v1!.raw));
      answers.push((await decide(m, 'pdp')).snapshot);
      undo();
      invalidateLiftCache();
      await decide(m, 'pdp', { shopper: await shopperOn(m, { tracking: false, personalization: false }), ack: false });

      const expected = zeros();
      Object.assign(expected.lift, { served: 3, late: 1, unrecognized: 1 });
      Object.assign(expected.ring, { read: 3, late: 1, skipped: 1 });
      const second = countsOf(learningReadsOf(await monitorRun(m)) as Record<string, unknown>);
      expect(delta(second, baseline), `${host}: P61.LO3 — the tenant's counts move by exactly the outcomes of the five consenting decisions`).toEqual(expected);
      expect(tally(answers), `${host}: P61.LO3 — and those are the outcomes the five answers reported`).toEqual(expected);
      const third = countsOf(learningReadsOf(await monitorRun(m)) as Record<string, unknown>);
      expect(delta(third, second), `${host}: P61.LO3 CONTROL — a run with no decision between counts nothing more (its own probe decisions are not the tenant's)`).toEqual(zeros());
    }, 180_000);

    it(`host (${host}): R-P115 (R-P120 F2) — under the AA2 latency lever (500 ms on every remote call, customer profile, cold lift cache), the counted snapshot and the render acknowledgement sent right after it answer with the same own remote calls as when the count's own store calls cost nothing, and the count adds no wave of remote calls before either answer (counted, never timed; R-P734)`, async () => {
      const { m } = await liftWorld(host);
      const run = await countLatency(m);
      const free = await run(true), counted = await run(false);
      expect({ free: free.countCalls > 0, counted: counted.countCalls > 0 }, `${host}: PRECONDITION — the count ran after both snapshots (its store calls: ${free.countCalls} free, ${counted.countCalls} at ${PER_CALL_MS} ms)`).toEqual({ free: true, counted: true });
      expect({ snapshot: counted.snapshot.own, ack: counted.ack.own }, `${host}: P61.LO3 — R-P115: with the count's calls at ${PER_CALL_MS} ms, each answer makes the same own remote calls as when they cost nothing`)
        .toEqual({ snapshot: free.snapshot.own, ack: free.ack.own });
      // R-P734 (R-P716): the time is evidence only; the clause is counted.
      console.log(`P61.LO3 evidence (${host}): snapshot ${counted.snapshot.ms} ms (${free.snapshot.ms} ms with the count free), acknowledgement ${counted.ack.ms} ms (${free.ack.ms} ms)`);
      expect({ snapshot: counted.snapshot.waves, ack: counted.ack.waves },
        `${host}: P61.LO3 — R-P115: the count adds no wave of remote calls before either answer: counted ${counted.snapshot.waves} and ${counted.ack.waves} waves, free ${free.snapshot.waves} and ${free.ack.waves}`)
        .toEqual({ snapshot: free.snapshot.waves, ack: free.ack.waves });
    }, 180_000);

    it(`host (${host}): R-P120 F4 — a served synthetic decision (the internal synthetic monitor's first run in this world, armed as W26.R2.synthetic arms it) is never counted: the count is never handed over for it; CONTROL: a consenting shopper's decision hands it over once`, async () => {
      const { m } = await liftWorld(host);
      const settleSynthetic = await armSyntheticMonitor(m);
      countCalls.length = 0;
      const { runSynthetic } = await import('@/ops/synthetic');
      const result = await runSynthetic(m.env, TENANT, host);
      await settleSynthetic();
      const synthetic = countCalls.length;
      await decide(m, 'pdp', { ack: false });
      await m.drain();
      expect(result.decision, `${host}: PRECONDITION — the synthetic monitor's decision is served, personalized, on the ${host} host (${JSON.stringify(result).slice(0, 200)})`).toBe(true);
      expect({ synthetic, consenting: countCalls.length - synthetic }, `${host}: P61.LO3 — R-P120 F4: the count is never handed over for a synthetic operation, once for a consenting shopper`).toEqual({ synthetic: 0, consenting: 1 });
    }, 180_000);

    it(`host (${host}): R-P120 F4 — the count's work is handed the operator cache alone: no binding but CACHE is reachable from the environment it is called with`, async () => {
      const { m } = await liftWorld(host);
      countCalls.length = 0;
      await decide(m, 'pdp', { ack: false });
      await m.drain();
      expect(countCalls.map(call => ({ started: call.started, bindings: call.bindings })), `${host}: P61.LO3 — R-P120 F4: one count, started, its environment reaching CACHE alone`).toEqual([{ started: true, bindings: ['CACHE'] }]);
    }, 120_000);

    it(`host (${host}): R-P120 F4 — the count starts only if the owner operation answered: a snapshot whose operation is refused for authority mid-way (a binding call refused with SessionAccessError) counts nothing; CONTROL: the same snapshot answered counts once`, async () => {
      const { m } = await liftWorld(host);
      const first = learningReadsOf(await monitorRun(m));
      expect(first, `${host}: P61.LO3 — the monitor counts the tenant's lift and ring outcomes`).toMatchObject({ scope: 'tenant', since: expect.any(Number) });
      const before = countsOf(first as Record<string, unknown>);
      countCalls.length = 0;
      const shopper = await shopperOn(m);
      expect((await shopper.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY)).status, `${host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
      const restore = await refuseWitnessForAuthority(m);
      const refused = await snapshotAnswer(m, shopper);
      restore();
      await m.drain();
      const failedStarts = countCalls.filter(call => call.started).length;
      const afterFailed = countsOf(learningReadsOf(await monitorRun(m)) as Record<string, unknown>);
      await decide(m, 'pdp', { ack: false });
      await m.drain();
      const afterAnswered = countsOf(learningReadsOf(await monitorRun(m)) as Record<string, unknown>);
      const once = zeros();
      Object.assign(once.lift, { served: 1 });
      Object.assign(once.ring, { read: 1 });
      expect(refused.status, `${host}: PRECONDITION — the operation is refused, not answered (${JSON.stringify(refused.body).slice(0, 160)})`).toBe(401);
      expect({ started: failedStarts, moved: delta(afterFailed, before) }, `${host}: P61.LO3 — R-P120 F4: an operation that did not answer starts no count and counts nothing`).toEqual({ started: 0, moved: zeros() });
      expect(delta(afterAnswered, afterFailed), `${host}: P61.LO3 CONTROL — the same snapshot answered is counted once`).toEqual(once);
    }, 180_000);
  }
});

// ===========================================================================
// unit:P61.LO4 — LOCKS: the record, the replay, decisions[] and the witness's shape
// ===========================================================================

/**
 * Today's members (P42.PW3's idiom, src/units/P42/LEDGER.unit.test.ts:194-203), each from
 * the code that writes it: the snapshot answer (src/routes/decisions.ts, the snapshot
 * route's `payload`, :1132-1154); a served decision (src/content/decide.ts's served
 * decision and src/content/service.ts `serveContentDecisions`, :1117-1127: `slotPosition`,
 * `decisionId`, `renderOffer`); its explain (`drivers`, `note`); the decision record
 * (decide.ts `decideContent`, the `records` map, :1942-2017, stamped by
 * `serveContentDecisions` — `retention` and `measurementBasis` :982-983, `experiment`
 * :1006, `journey` :1020 — and by the ledger: `rendered`, `externalRetention`,
 * `_ledger_delivery`), its explain in this world (`drivers`, `lift`, `score_base`,
 * `score_final`, and `fatigue` once the ring shows the module served), its versions,
 * and every member a record's `explain.lift` may carry (src/content/types.ts
 * `LiftApplied`, :809-850).
 */
const ANSWER_MEMBERS = ['arm', 'brand', 'config_label', 'decisions', 'experiment', 'ok', 'page', 'pageInstance', 'sources', 'tenant', 'ts', 'versions'];
const DECISION_MEMBERS = ['contentId', 'customerContentId', 'decisionId', 'explain', 'order', 'renderOffer', 'score', 'slot', 'slotPosition', 'strategy', 'type'];
const DECISION_EXPLAIN_MEMBERS = ['drivers', 'note'];
const RECORD_MEMBERS = ['_ledger_delivery', 'arm', 'authority', 'brand', 'candidates', 'cell', 'config_label', 'customer_item_id', 'decision_id', 'experiment', 'explain',
  'explored', 'externalRetention', 'identity_anchor', 'inputs', 'item_id', 'journey', 'measurementBasis', 'page', 'position', 'ranking_position', 'rendered', 'request_id',
  'retention', 'session_id', 'slot', 'tenant', 'ts', 'versions', 'visitor_id'];
const RECORD_EXPLAIN_MEMBERS = ['drivers', 'fatigue', 'lift', 'score_base', 'score_final'];
const VERSIONS_MEMBERS = ['catalog', 'config', 'learn', 'lift', 'policy', 'prior', 'slots'];
const LIFT_APPLIED_MEMBERS = ['applied', 'evidenceFloor', 'gamma', 'level', 'level_words', 'lift', 'measurementBasis', 'n', 'n0', 'objective', 'p0', 'p_hat', 'pooled', 'prior', 'reward', 's'];
/** Words only the telling uses; a record carries none of them today. */
const TELLING_WORDS = ['"outcome"', 'superseded', 'unrecognized', 'unhealthy', '"late"', '"skipped"', 'learningReads'];

const outside = (keys: string[], allowed: string[]) => keys.filter(k => !allowed.includes(k));
/** What a record holds beyond today's members, member by member (empty when it is today's). */
function recordBeyondToday(record: DecisionRecord | undefined): Record<string, unknown> {
  if (!record) return { record: 'no stored record' };
  const explain = record.explain as unknown as Record<string, unknown>, lift = explain.lift as Record<string, unknown> | null;
  const words = TELLING_WORDS.filter(word => JSON.stringify(record).includes(word));
  return Object.fromEntries(Object.entries({
    record: outside(Object.keys(record), RECORD_MEMBERS), explain: outside(Object.keys(explain), RECORD_EXPLAIN_MEMBERS),
    versions: outside(Object.keys(record.versions), VERSIONS_MEMBERS), lift: lift ? outside(Object.keys(lift), LIFT_APPLIED_MEMBERS) : [], words,
  }).filter(([, extra]) => extra.length > 0));
}
/** What an answer holds beyond today's members (empty when it is today's). */
function answerBeyondToday(snapshot: Snapshot): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  const top = outside(Object.keys(snapshot.body), ANSWER_MEMBERS);
  if (top.length) extra.answer = top;
  snapshot.decisions.forEach((d, i) => {
    const members = outside(Object.keys(d), DECISION_MEMBERS), explain = outside(Object.keys(d.explain ?? {}), DECISION_EXPLAIN_MEMBERS);
    if (members.length || explain.length) extra[`decisions[${i}]`] = { members, explain };
  });
  return extra;
}

describe('unit:P61.LO4 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a served decision and a late one: each stored record holds today's members only and no word of an outcome, and each replays equal; CONTROL: a record with one telling member added is caught, and a stored record whose lift is altered replays unequal`, async () => {
      const { liftBudget } = await inForce();
      const { m, v1 } = await liftWorld(host);
      const served = await decide(m, 'pdp');
      const lever = witnessLever(m);
      lever.delay(liftBudget + 10);
      const late = await decide(m, 'pdp');
      lever.restore();
      expect([liftOnRecord(served.record), liftOnRecord(late.record)], `${host}: PRECONDITION — one decision applied the copy and one did not`).toEqual([servedFrom(v1!.version), UNSERVED]);
      for (const [label, d] of [['served', served], ['late', late]] as const) {
        expect(recordBeyondToday(d.record), `${host}: P61.LO4 — LOCKED: the ${label} decision's record is today's, member for member, and names no outcome`).toEqual({});
        const replay = await replayOf(m, d.record!.decision_id);
        expect([replay.status, replay.body.equal, replay.body.diff], `${host}: P61.LO4 — LOCKED: the ${label} decision replays equal`).toEqual([200, true, []]);
      }
      const doctored = structuredClone(served.record!) as unknown as { explain: { lift: Record<string, unknown> } };
      doctored.explain.lift.outcome = 'served';
      expect(recordBeyondToday(doctored as unknown as DecisionRecord), `${host}: CONTROL — the lock catches a telling member on the record`)
        .toEqual({ lift: ['outcome'], words: ['"outcome"'] });
      // The stored ndjson line of the served record, its lift altered, replays unequal: the replay compares explain.lift.
      const id = served.record!.decision_id, key = [...m.storage.objects.keys()].find(k => k.includes('/decision/') && m.storage.objects.get(k)!.includes(id))!;
      const lines = m.storage.objects.get(key)!.split('\n');
      m.storage.objects.set(key, lines.map(line => (line.includes(id) ? JSON.stringify({ ...JSON.parse(line), explain: { ...JSON.parse(line).explain,
        lift: { ...JSON.parse(line).explain.lift, lift: 9 } } }) : line)).join('\n'));
      const altered = await replayOf(m, id);
      expect([altered.status, altered.body.equal], `${host}: CONTROL — a record whose lift is not the one decided replays unequal`).toEqual([200, false]);
    }, 120_000);

    it(`host (${host}): LOCK — the answer's top-level members and every decisions[] member are today's, served or late, on the product page and the home page; CONTROL: a decision with one more member is caught`, async () => {
      const { liftBudget } = await inForce();
      const { m } = await liftWorld(host);
      const answers = [(await decide(m, 'pdp')).snapshot, (await decide(m, 'home')).snapshot];
      const lever = witnessLever(m);
      lever.delay(liftBudget + 10);
      answers.push((await decide(m, 'pdp')).snapshot);
      lever.restore();
      for (const snapshot of answers) {
        expect(answerBeyondToday(snapshot), `${host}: P61.LO4 — LOCKED: the ${snapshot.page} answer and its decisions carry today's members only (the telling lives inside sources)`).toEqual({});
      }
      const doctored = { ...answers[0]!, decisions: answers[0]!.decisions.slice(0, 1).map(d => ({ ...d, lift: 'served' })) };
      expect(answerBeyondToday(doctored), `${host}: CONTROL — the lock catches a member added to a decision`).toEqual({ 'decisions[0]': { members: ['lift'], explain: [] } });
    }, 120_000);

    it(`logic (${host}): LOCK — currentLiftWitness, which the decision path calls (src/content/service.ts:167, :191), still resolves to the boolean true for the published copy and to false for a forged one; CONTROL: a reason object in its place is caught`, async () => {
      const { m, v1 } = await liftWorld(host);
      const copy = JSON.parse(v1!.raw) as LiftSnapshot, fake = JSON.parse(forged(v1!.raw)) as LiftSnapshot;
      const shapeOf = (value: unknown) => [typeof value, value];
      expect(shapeOf(await currentLiftWitness(m.env, TENANT, BRAND, PDP_MODULES, copy)), `${host}: P61.LO4 — LOCKED: the witness answers today's callers with the boolean true`).toEqual(['boolean', true]);
      expect(shapeOf(await currentLiftWitness(m.env, TENANT, BRAND, PDP_MODULES, fake)), `${host}: P61.LO4 — LOCKED: and with the boolean false for a copy the object never published`).toEqual(['boolean', false]);
      expect(() => expect(shapeOf({ ok: true, reason: 'served' })).toEqual(['boolean', true]), `${host}: CONTROL — a reason object in the boolean's place fails the lock`).toThrow();
    }, 120_000);
  }
});

// ===========================================================================
// R-P120: the levers and the observation the R-P120 tests above use
// ===========================================================================

/** The AA2 lever's latency per remote call (src/units/P56/LEDGER.unit.test.ts, AA2: the SDK's deadline over ten). */
const PER_CALL_MS = 500;

/**
 * The count's hand-over to the shopper's owner (`afterOwnerAnswer`,
 * src/identity/sessionAuthority.ts in the build; the count is its only caller,
 * src/content/service.ts:1168): every registration since the list was emptied, and
 * for each, whether its work started and the bindings reachable from the
 * environment the work was handed. Filled by a pass-through of the hook (the module
 * mock below), which forwards every call and every work unchanged.
 */
const countCalls = vi.hoisted(() => [] as Array<{ started: boolean; bindings: string[] }>);
vi.mock('@/identity/sessionAuthority', async importOriginal => {
  const actual = await importOriginal() as Record<string, unknown>;
  const hook = actual.afterOwnerAnswer as ((work: (env: Record<string, unknown>) => Promise<unknown>) => Promise<void>) | undefined;
  const names = ['CACHE', 'SESSIONS', 'STORAGE', 'LEARN_STATS', 'DECISION_RING', 'SHOPPER_REFLEX', 'EVENT_QUEUE', 'DB', 'PERSONALIZATION_WEBSOCKET', 'REGION_TREND'];
  return { ...actual, ...(typeof hook === 'function' ? { afterOwnerAnswer: (work: (env: Record<string, unknown>) => Promise<unknown>) => {
    const call = { started: false, bindings: [] as string[] };
    countCalls.push(call);
    return hook(env => { call.started = true; call.bindings = names.filter(name => env[name] !== undefined); return work(env); });
  } } : {}) };
});

/** The product page's lift store read throws (a store that cannot be read); returns the restore. */
function failingStoreRead(m: Mounted): () => void {
  const key = liftKey(TENANT, BRAND, PDP_MODULES), original = m.cache.get;
  m.cache.get = async (k: string, type?: string) => { if (k === key) throw new Error('lever: the lift store read failed'); return original.call(m.cache, k, type); };
  return () => { m.cache.get = original; };
}

/** The statistics objects' witness doors refuse for authority (`SessionAccessError`), the refusal an owner operation fails on; returns the restore. */
async function refuseWitnessForAuthority(m: Mounted): Promise<() => void> {
  const { SessionAccessError } = await import('@/identity/sessionCapability');
  const namespace = m.env.LEARN_STATS as unknown as { get: (id: unknown) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } };
  const original = namespace.get;
  namespace.get = (id: unknown) => {
    const stub = original.call(namespace, id);
    return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (path === '/health' || path === '/witness') throw new SessionAccessError();
      return stub.fetch(input, init);
    } };
  };
  return () => { namespace.get = original; };
}

/** `POST /v1/:tenant/decisions/snapshot` for the product page, answered as the shopper is answered (status and body), without the harness's checks. */
async function snapshotAnswer(m: Mounted, shopper: Awaited<ReturnType<typeof shopperOn>>): Promise<{ status: number; body: Record<string, unknown> }> {
  const { SHOPPER_HEADER } = await import('@/identity/sessionCapability');
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: shopper.grant.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p61-lo3-refused') }) }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/**
 * R-P115 under the AA2 lever (src/units/_parity8.ts `remoteLatency`, `workerApp`,
 * `ackWire`, `settle`; the reviewer's measurement, P61 review §3): the customer
 * profile, every remote binding call 500 ms late, the count's own store calls (the
 * key `learningReadsKey(tenant)` names) optionally free. Each run: a new shopper's
 * Tabby view, the lift cache dropped, the product-page snapshot, the pooled
 * module's render acknowledgement sent right after its answer without draining;
 * each answer's time and its own remote calls (the count's left out).
 */
async function countLatency(m: Mounted) {
  const { ackWire, remoteLatency, settle, workerApp } = await import('../_parity8');
  const { SHOPPER_HEADER } = await import('@/identity/sessionCapability');
  const keyOf = (await fanExports()).learningReadsKey as ((tenant: string) => string) | undefined;
  const countKey = typeof keyOf === 'function' ? keyOf(TENANT) : null;
  (m.env as unknown as Record<string, unknown>).DEPLOYMENT_PROFILE = 'customer';
  const latency = remoteLatency(m), app = workerApp(m), counted = new Set<number>();
  let free = false, countCallsMade = 0;
  for (const method of ['get', 'put'] as const) {
    const store = m.cache as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const levered = store[method]!, unlevered = Object.getPrototypeOf(m.cache)[method] as (...args: unknown[]) => Promise<unknown>;
    Object.defineProperty(m.cache, method, { configurable: true, writable: true, value: (...args: unknown[]) => {
      if (countKey === null || args[0] !== countKey) return levered.apply(m.cache, args);
      countCallsMade++;
      if (free) return unlevered.apply(m.cache, args);
      counted.add(latency.calls.length);
      return levered.apply(m.cache, args);
    } });
  }
  const own = (from: number, until: number) => latency.calls.filter((call, index) => index >= from && call.at <= until && !counted.has(index)).length;
  return async (countFree: boolean) => {
    free = countFree;
    const callsBefore = countCallsMade;
    const shopper = await shopperOn(m);
    expect((await shopper.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
    invalidateLiftCache();
    const pageInstance = pageInstanceOf('p61-lo3-latency'), first = latency.calls.length;
    latency.set(PER_CALL_MS);
    const sentAt = performance.now();
    const response = await app.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
      headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: shopper.grant.capability, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance }) }));
    const answeredAt = performance.now();
    const body = await response.json() as Record<string, unknown>;
    const page: Snapshot = { status: response.status, body, page: 'pdp', pageInstance, decisions: (body.decisions ?? []) as Decision[] };
    const pooled = page.decisions.find(d => d.contentId === POOLED && d.renderOffer);
    const ackFirst = latency.calls.length;
    const ack = pooled ? await ackWire(app, shopper, page, pooled) : null;
    latency.set(0);
    await settle(m, app);
    expect([response.status, ack?.status], `${m.host}: PRECONDITION — the snapshot and the pooled module's acknowledgement answer 200`).toEqual([200, 200]);
    return { snapshot: { ms: Math.round(answeredAt - sentAt), own: own(first, answeredAt), waves: wavesBefore(latency.calls, first, answeredAt) },
      ack: { ms: Math.round(ack!.answeredAt - ack!.sentAt), own: own(ackFirst, ack!.answeredAt), waves: wavesBefore(latency.calls, ackFirst, ack!.answeredAt) },
      countCalls: countCallsMade - callsBefore };
  };
}

/**
 * R-P734 (R-P716: counted, never timed): the waves of remote calls made from `from` that went through before `until`
 * (an answer), as the lever recorded them. A call made before every call of the open wave went through joins that
 * wave; otherwise it opens the next one. A count on an answer's path adds a serial wave before it; a count beside it
 * adds none.
 */
function wavesBefore(calls: ReadonlyArray<{ at: number; end?: number }>, from: number, until: number): number {
  let waves = 0, openUntil = Number.NEGATIVE_INFINITY;
  for (const call of calls.slice(from).filter(c => c.end !== undefined && c.end <= until).sort((a, b) => a.at - b.at)) {
    if (waves > 0 && call.at < openUntil) openUntil = Math.min(openUntil, call.end!);
    else { waves++; openUntil = call.end!; }
  }
  return waves;
}

/**
 * The tenant's internal synthetic monitor armed over this harness as
 * src/units/W26/LEDGER.unit.test.ts `armSyntheticMonitor` arms it (its telemetry
 * descriptor with the isolated destinations, their retention, the recovery queues,
 * a region-trend binding, and the source queue delivering each synthetic envelope
 * to the worker's own synthetic consumer in its own invocation). Returns the settle.
 */
async function armSyntheticMonitor(m: Mounted): Promise<() => Promise<void>> {
  const [{ configuredOperationalDestinations, SYNTHETIC_BINDINGS }, { consumeSynthetic, SYNTHETIC_KIND }, { AsyncResource }] =
    await Promise.all([import('@/connectors/config'), import('@/ops/synthetic'), import('node:async_hooks')]);
  const env = m.env as unknown as Record<string, unknown>;
  const destinations = SYNTHETIC_BINDINGS.map(binding => ({ binding, purpose: 'isolated-synthetic-monitor', namespace: 'ops-synthetic-v1', accessPolicy: 'p61-local-only' }));
  env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { [TENANT]: { telemetry: { environment: 'test', schema: 'ops-v1', synthetic: {
    version: 1, enabled: true, lifetimeMs: 120_000, stageMs: 10_000, decisionMs: 200, eventMs: 300, thresholdSource: 'document-32-server-diagnostics', destinations } } } } });
  const retention = JSON.parse(m.env.RETENTION as string) as { tenants: Record<string, Record<string, unknown>> };
  for (const destination of await configuredOperationalDestinations(m.env, TENANT)) retention.tenants[TENANT]![destination.category] =
    { id: 'p61-synthetic', revision: 1, durationMs: 120_000, basis: 'occurred', renewal: 'new-record-only' };
  env.RETENTION = JSON.stringify(retention);
  env.LEDGER_RECOVERY_CONFIG = JSON.stringify({ version: 1, sourceQueue: 'p61-source', deadLetterQueue: 'p61-dlq' });
  env.REGION_TREND = { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ ok: true }) }) };
  const deliver = AsyncResource.bind((body: unknown) => consumeSynthetic(m.env, 'p61-source', body));
  const deliveries: Promise<unknown>[] = [], queue = m.env.EVENT_QUEUE!;
  const send = async (body: unknown) => {
    await queue.send(body);
    if ((body as { kind?: unknown } | null)?.kind === SYNTHETIC_KIND) deliveries.push(new Promise(resolve => setTimeout(resolve, 0)).then(() => deliver(body)).catch(() => undefined));
  };
  env.EVENT_QUEUE = { send, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const message of messages) await send(message.body); } };
  return async () => { while (deliveries.length) await Promise.all(deliveries.splice(0)); await m.drain(); };
}
