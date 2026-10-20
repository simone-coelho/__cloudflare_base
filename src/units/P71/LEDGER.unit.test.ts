// src/units/P71/LEDGER.unit.test.ts
// P71 under the Closure Ledger: the tests for the LOCAL criteria BR1-BR2 of the P71 work
// order (the clock-and-budget programme of amendment 9, ticket P71 "The object host's buffered
// re-decision fires"). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-9/BTI-Parity-Amendment-2026-10-20c.md, section 2, P71):
//   "P71 — the object host's buffered re-decision fires. On the object host a buffered-door event
//   with no profile, reset between the behaviour capture's admission and the outcome's, gets NO
//   outcome record after the alarm (the re-decision reads the loaded `null` as "no profile"); the
//   session host unchanged; P65's other legs unchanged."
// The work order (docs/parity/clock-and-budget/program.json, P71), remaining work:
// "ShopperReflex.ts:4029: treat the loaded null as "no profile" in the buffered re-decision."
// Its decision D1 (R-P170 under R-P78): "A one-line fail-closed correction with RED units on the
// object host."
//
// One `describe('unit:P71.<criterion>')` per LOCAL criterion, both shopper hosts. Expected values
// come from the amendment (§1(c): "on the object host `ShopperReflex.ts:4029` tests
// `this.affinity === undefined` while `load()` sets `null`, so a buffered-door event with no
// profile, reset between its admissions, gets an outcome the engine would have dropped"), the work
// order, the finding it cites (_evidence/parity-step3/P67/implementer/REPORT.md, "P65 gap I found":
// "`ShopperReflex.ts:4029` checks `this.affinity === undefined`, but `load()` (`:3852-3853`) sets
// `null`. So the object host's buffered `profile_missing` re-decision never fires, and no P65 unit
// covers it") and the engine's own decision for the same event without the reset (the buffered
// door's `profile_missing`: ShopperReflex.ts `ingest`, "if (affinity === undefined || pipeline ===
// undefined) return answer(false, 'profile_missing')"; the re-decision's own rule, ShopperReflex.ts
// `carriedEventDropped`: "`profile_missing`, on the buffered doors: no profile (this object's
// record on the object host) or no session record (the session host) to apply it to"), never from
// what the engine answers today.
//
// THE READINGS THIS FILE RULES:
//   · "a buffered-door event": the SDK's buffered delivery of an original event
//     (`processing: 'buffered'`, its own `eventId` and time, the browsing session it belongs to;
//     src/units/P40/LEDGER.unit.test.ts `deliverBuffered`), here P65's buy-box add to bag of the
//     quilted Tabby (src/units/_parity10.ts `BUY_BOX`, a reward-bearing event, so its behaviour
//     capture's admission carries its outcome: P65), sent through the worker's app on the wire.
//   · "with no profile": the shopper made their explicit choice and nothing else (no live event:
//     "The buffered door never creates a profile", P40's reading), so the shopper's object holds no
//     profile record (`affinity`, `pipeline`) and, on the session host, no session record.
//   · "reset between the behaviour capture's admission and the outcome's": P65's reset
//     (src/units/_parity10.ts `resettable`, right after the behaviour capture's durable admission),
//     every pending piece of work settled, the object rebuilt over the same storage, its alarm,
//     seen armed, fired, the ledger drained (P65's `resetRunOn`, transcribed).
//   · "the engine would have dropped": the same delivery in a twin world without the reset records
//     no outcome (on the object host the buffered door answers `dropped: 'profile_missing'`): a
//     PRECONDITION, so the RED names the alarm's re-decision, not the fixture.
//   · "the session host unchanged": the same reset of the same delivery on the session host leaves
//     no outcome record after the alarm, as today (a lock inside BR1).
//   · BR2 "a buffered-door event WITH a profile, reset the same way, keeps its outcome after the
//     alarm": the shopper's live page view first, then the same delivery and reset: after the alarm
//     one behaviour record and one outcome record, the outcome the route emits for it
//     (records.ts `outcomeFromAction`, its `outcome_id`), as the engine keeps it without the reset.
//   · BR2 "P65 RS1-RS3 and the additive legs unchanged; P67 unchanged": their own commands
//     (src/units/P65, and P67's units with the additive P65 legs where amendment 8 lands them), in
//     the gate; not re-implemented here.
//
// MEASURED at 0e94aaa6 (_evidence/parity-step3/S17/specifier/logs/): BR1 RED on the object host,
// one outcome record after the alarm (the re-decision's `this.affinity === undefined` is false on
// the loaded `null`); GREEN on the session host (no outcome); BR2 GREEN on both hosts.
//
// NEGATIVE CONTROLS (scratch copies, never committed; _evidence/parity-step3/S17/specifier/sketches/):
// the re-decision reading the loaded null as "no profile" (`!this.affinity || !this.pipeline`) turns
// every P71 unit GREEN; a re-decision that drops every buffered carried outcome turns BR2's
// with-profile lock RED on both hosts.
//
// No new export is imported; every member read exists at this head.
//
// FIXTURE. P33 K3's catalogue, slots and learn document as OUT-K3 reproduced them
// (src/units/_parity10.ts `OUTCOME_PIECES`, `OUTCOME_SLOTS`, `OUTCOME_LEARN`): the layout and the
// story slot learning against add_to_bag.
//
// HARNESS: src/units/_parity.ts, src/units/_parity8.ts and src/units/_parity10.ts. Imports from
// src/units/: ../_parity, ../_parity8, ../_parity10.

import { describe, expect, it } from 'vitest';

import { outcomeFromAction, ts36 } from '@/ledger/records';

import { expectPublished, HOSTS, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY, shopperOn, storedOutcomes, TENANT, type Host, type Mounted, type Shopper } from '../_parity';
import { actionWire, clearShopperAlarm, storedBehavior, UNANSWERED, within, workerApp, type Identity, type Wire, type WorkerApp } from '../_parity8';
import { BUY_BOX, OUTCOME_LEARN, OUTCOME_PIECES, OUTCOME_SLOTS, resettable, settleAll } from '../_parity10';

const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);

interface BufferedWorld { m: Mounted; app: WorkerApp; s: Shopper }

/** The world on one host: published, one shopper with their explicit choice; with `profile`, their live page view too. */
async function bufferedWorld(host: Host, profile: boolean): Promise<BufferedWorld> {
  const m = await mount(host, { pieces: OUTCOME_PIECES, slots: OUTCOME_SLOTS, learn: OUTCOME_LEARN });
  expectPublished(m, 'P71 — P33 K3\'s catalogue, slots and learn document publish');
  const s = await shopperOn(m);
  if (profile) {
    expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${host}): the shopper's live page view is accepted (the profile exists)`).toBe(200);
    await m.drainLedger();
    await clearShopperAlarm(m, s.subject);
  }
  return { m, app: workerApp(m), s };
}

/** The SDK's buffered delivery of the buy-box add to bag (P40's `deliverBuffered` body), in the shopper's browsing session. */
const bufferedAdd = (s: Shopper) => ({ ...BUY_BOX, processing: 'buffered', browsingSessionId: s.grant.sessionId });

interface Delivery { answer: Wire | typeof UNANSWERED; identity: Identity; fired: boolean; killedAt: string; alarm: number | null; alarmRan: string }

/** The buffered delivery sent, with P65's reset right after its behaviour capture's durable admission, then the alarm (P65's `resetRunOn`). */
async function deliver(world: BufferedWorld, reset: boolean): Promise<Delivery> {
  const { m, app, s } = world;
  const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
  const lever = reset ? resettable(m, s.subject, identity.eventId) : undefined;
  const answer = await within(actionWire(app, s, bufferedAdd(s), identity), 20_000);
  await settleAll(m, app);
  let alarm: number | null = null, alarmRan = 'not armed';
  if (lever) {
    alarm = await lever.alarmAt();
    const fresh = lever.revive();
    if (alarm !== null) { alarmRan = 'ran'; try { await fresh.alarm(); } catch (error) { alarmRan = `threw ${(error as Error).message}`; } }
    await settleAll(m, app);
  }
  await m.drainLedger();
  return { answer, identity, fired: lever?.state.fired ?? false, killedAt: lever?.state.killedAt ?? '', alarm, alarmRan };
}
const preconditions = (host: Host, run: Delivery) =>
  expect([run.fired, run.alarm === null ? 'no alarm' : 'alarm armed', run.alarmRan], `${host}: PRECONDITION — the behaviour capture's durable admission was seen to commit (the reset followed it${run.killedAt ? `, at ${run.killedAt}` : ''}) and the alarm armed by it is fired`)
    .toEqual([true, 'alarm armed', 'ran']);

const behaviourOf = (m: Mounted, s: Shopper, identity: Identity) => storedBehavior(m, s.subject).filter(row => row.event_id === identity.eventId).map(row => [row.record_id, row.event, row.ts]);
const expectedBehaviour = (s: Shopper, identity: Identity) => [[`${TENANT}:${ts36(identity.timestamp)}:${s.subject}:behavior:${identity.eventId}`, BUY_BOX.type, identity.timestamp]];
const outcomesOf = (m: Mounted, s: Shopper, identity: Identity) => storedOutcomes(m, s.subject).filter(row => row.event_id === identity.eventId).map(row => row.outcome_id);
/** The outcome id the route emits for the delivery (records.ts `outcomeFromAction`, as the action route calls it). */
const expectedOutcomeId = (s: Shopper, identity: Identity) =>
  outcomeFromAction({ ...BUY_BOX, userId: s.subject, sessionId: s.grant.sessionId, eventId: identity.eventId, eventIdSource: 'provided', timestamp: identity.timestamp }, TENANT)!.outcome_id;
const droppedOf = (run: Delivery) => (run.answer === UNANSWERED ? UNANSWERED : run.answer.body.dropped ?? null);

// ===========================================================================
// unit:P71.BR1 — no profile, reset between the admissions: no outcome record after the alarm
// ===========================================================================

describe('unit:P71.BR1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a buffered add to bag of a shopper with no profile (their explicit choice only), whose shopper object resets right after the event's behaviour capture is durably admitted, leaves after the alarm its behaviour record and NO outcome record, as the engine leaves it without the reset (${host === 'do' ? 'the re-decision reads the loaded null as "no profile"' : 'the session host unchanged'})`, async () => {
      const twin = await bufferedWorld(host, false);
      const engine = await deliver(twin, false);
      expect([host === 'do' ? droppedOf(engine) : 'not read on the session host', outcomesOf(twin.m, twin.s, engine.identity).length],
        `${host}: PRECONDITION — without the reset the engine records no outcome for it${host === 'do' ? ' (the buffered door drops it: profile_missing)' : ''} (${engine.answer === UNANSWERED ? UNANSWERED : show(engine.answer.body)})`)
        .toEqual([host === 'do' ? 'profile_missing' : 'not read on the session host', 0]);

      const world = await bufferedWorld(host, false);
      const run = await deliver(world, true);
      preconditions(host, run);
      expect.soft([behaviourOf(world.m, world.s, run.identity), outcomesOf(world.m, world.s, run.identity)],
        `${host}: P71.BR1 — after the reset and the alarm: its behaviour record, and no outcome record (the alarm's re-decision drops it as the buffered door did: profile_missing)`)
        .toEqual([expectedBehaviour(world.s, run.identity), []]);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P71.BR2 — locks: with a profile the outcome is kept; P65 and P67 by their own commands
// ===========================================================================

describe('unit:P71.BR2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a buffered add to bag of a shopper WITH a profile (their live page view first), reset the same way, keeps its outcome after the alarm: its behaviour record and one outcome record, the outcome the route emits for it, as the engine keeps it without the reset`, async () => {
      const twin = await bufferedWorld(host, true);
      const engine = await deliver(twin, false);
      expect([engine.answer === UNANSWERED ? UNANSWERED : engine.answer.status, droppedOf(engine), outcomesOf(twin.m, twin.s, engine.identity)],
        `${host}: PRECONDITION — without the reset the buffered door applies it and the engine records its outcome (${engine.answer === UNANSWERED ? UNANSWERED : show(engine.answer.body)})`)
        .toEqual([200, null, [expectedOutcomeId(twin.s, engine.identity)]]);

      const world = await bufferedWorld(host, true);
      const run = await deliver(world, true);
      preconditions(host, run);
      expect.soft([behaviourOf(world.m, world.s, run.identity), outcomesOf(world.m, world.s, run.identity)],
        `${host}: P71.BR2 — after the reset and the alarm: its behaviour record and its one outcome record`)
        .toEqual([expectedBehaviour(world.s, run.identity), [expectedOutcomeId(world.s, run.identity)]]);
    }, 90_000);
  }
});
