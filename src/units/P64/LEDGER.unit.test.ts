// src/units/P64/LEDGER.unit.test.ts
// P64 under the Closure Ledger: the tests for the LOCAL criteria OT1-OT4 of the P64
// work order (the outcome-telling programme of amendment 7, ticket P64 "The action answer
// names its outcome record and a pre-admission failure counts in the monitor"). LV1 is a
// deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-7/BTI-Parity-Amendment-2026-10-20.md, section 2, P64):
//   "P64 — the outcome is told. On both shopper hosts, the answer to a tracked action that
//   emits an outcome names it: `outcome: { recordId }` beside `behavior`, built from the
//   same engine time the behaviour record carries; a dropped event, a tracking-refused
//   event and an action without a reward carry no `outcome` member; a failure before the
//   outcome's durable admission counts once in the monitor's lost-evidence counter
//   (`producerFailed`) for the tenant and is still logged; the clamp (`realtime.ts:183-184`),
//   the `outcome_id` format (`records.ts:411`), the `behavior` member, the status codes and
//   amendment 5's answer-at-admission (no new wait on the answer path) do not change; kit 02
//   and 03 state the member."
// The work order's decision D1 (docs/parity/outcome-telling/program.json, P64): "Named on
// the answer, never on the record." Its remaining work: "emitOutcome returns the outcome id
// it built; the answer adds outcome: { recordId }; recordEvidenceLoss(…, 'producerFailed', 1)
// in outcomeToLearning's catch." and "Kit 02 and 03 state the member."
//
// One `describe('unit:P64.<criterion>')` per LOCAL criterion, each walked on both shopper
// hosts through the parity harness. Expected values come from the work order, the
// amendment, the analysis it cites (_evidence/baseline-52/outcome-k3/ANALYSIS.md, OUT-K3:
// §1 the path, §2 the skew case, §4 the optional product unit and its two tests, §5
// observability) and the engine's own functions, never from what the engine answers today:
//   · the outcome's id: records.ts's own `outcomeFromAction` (`outcome_id` =
//     `${tenant}:${ts36(ts)}:${visitor}:${event}:n1:${eventId}`, src/ledger/records.ts
//     `outcomeFromAction`), called as the action route calls it (src/routes/realtime.ts
//     `emitOutcome`) at the engine time the answer's own `behavior.recordId` carries
//     (src/ledger/behavior.ts `captureBehavior`: `${tenant}:${ts36(time)}:${subject}:behavior:
//     ${eventId}`), never at the client's time: the route admits a client time ahead of its
//     clock at its own present (realtime.ts, the W23 T1.01 clamp `Math.min(client, engineNow)`),
//     OUT-K3 §3's root cause;
//   · the ledger read: the operator's `GET /v1/:tenant/ledger/:id?stream=outcome`
//     (src/routes/decisions.ts), which matches the whole id (OUT-K3 §1 step 9);
//   · the lost-evidence counter: the vocabulary of src/ledger/delivery.ts
//     (`EvidenceLossPath`, `recordEvidenceLoss`), read as the monitor reads it
//     (src/ops/monitor.ts `runMonitor`, `readEvidenceLoss(env, tenant, now)`);
//   · the log line: `learning_incomplete` (src/learn/fan.ts `reportLearningIncomplete`,
//     called from src/learn/route.ts `outcomeToLearning`'s catch).
//
// THE READINGS THIS FILE RULES (one representation with P65, src/units/P65/LEDGER.unit.test.ts):
//   · "a tracked action that emits an outcome" (OT1): the customer's buy-box add to bag of
//     the quilted Tabby (P33 K3's event, OUT-K3's reproduction) and a content click on an
//     acknowledged layout module, both with tracking consent; the add to bag carries a client
//     time 25 ms ahead of the engine (OUT-K3 §4 test 1), so the outcome id built from the
//     client's clock is not the stored one. The answer is 200 with `outcome` exactly
//     `{ recordId }`, `recordId` the outcome id derived above; once the effects settle, the
//     ledger holds exactly one outcome row of the event, under that id, and the operator's
//     read of that id answers 200. Kit 02 and kit 03 each say so in one sentence (a sentence
//     naming the action answer's `outcome` member and its `recordId`).
//   · OT2: the customer's add to bag of a product the tenant does not hold, every value
//     refused (W35's `UNKNOWN`), dropped as `unknown_product`; the same buy-box add to bag
//     from a shopper whose explicit choice refuses tracking; a page view (no reward,
//     records.ts `rewardOf`). Each answers 200 with no `outcome` member and leaves no outcome
//     row. Today no answer carries the member, so OT2 is a LOCK, GREEN at specification; its
//     CONTROL shows a stray member is caught.
//   · OT3 "a failure before the outcome's durable admission": the learn document read the
//     outcome's learning preparation makes (route.ts `outcomeToLearning`,
//     `readRevision(env, LEARN_KIND, scope)`, before `admitOwnedRecovery`) refuses once
//     (src/units/_parity10.ts `failLearnReadOnce`, the seam src/content/consent.test.ts:1069
//     injects "a propagated preparation failure" at). The answer keeps its status: 200,
//     `success: true`, the behaviour capture durable; the tenant's `producerFailed` counter
//     reads exactly one more than before, and stays so after a following successful add to
//     bag (once, not per retry); `learning_incomplete` is logged. NOT RULED (no witness):
//     whether such an answer names the outcome id it built; this file reads no `outcome`
//     member on it. Not specified either: a refusal of the outcome's own admission
//     transaction (a mechanism P65 may change: one transaction with the behaviour capture
//     fails the action, a carried outcome is no longer "before its durable admission"); and
//     the path without durable recovery, where `enqueueOutcome` already counts its own
//     failures (src/ledger/enqueue.ts) and nothing is durably admitted.
//   · OT4 LOCKS, GREEN at specification:
//       the clamp: a client time a minute ahead is admitted at the engine's present (the
//       answer's behaviour time is at most the wall clock when it arrived and earlier than
//       the client's), a client time in the past exactly as given, and the stored outcome
//       carries the behaviour record's time in both cases;
//       the `outcome_id` format: the stored row's id is the literal template above;
//       the `behavior` member: exactly `{ status: 'durable', recordId, receipt: { version: 1,
//       operation, durable: true, source: { expected: 1, state: 'pending' } } }`, `operation`
//       the engine's `recoveryDigest({ kind: 'behavior', tenant, subject, ids: [recordId] })`
//       (P58.BA1's shape);
//       the status codes: the accepted, dropped, refused and no-reward actions answer 200,
//       an invalid event 400 `Invalid action event`;
//       "no new wait on the answer path": with 20 ms added to every remote binding call
//       (src/units/_parity8.ts `remoteLatency`, P56.AA2's and P59.CO2's lever), the remote
//       calls an add to bag and a click make before their answer are, per binding and
//       method, never more than this ticket's base makes (measured at 2ce8ffa6 on this
//       world, three runs per host, _evidence/parity-step3/S13/specifier/logs/probe-latency-base.log:
//       the session host STORAGE.get 1, CACHE.get 11, SESSIONS.put 2; the object host
//       STORAGE.get 1, for both events, every run);
//       the units P56-P60 unchanged: their own acceptance commands, run beside this one
//       (a unit file is never imported into another).
//
// R10 (expectations a build of P64 changes): NONE MEASURED. The whole suite under a sketch of
// P64 on a scratch copy (_evidence/parity-step3/S13/specifier/sketches/sketch-p64.py: `emitOutcome`
// returns the id it built, every action answer spreads `outcome: { recordId }` beside `behavior`
// when one was built, `outcomeToLearning`'s catch adds `recordEvidenceLoss(env, scope,
// 'producerFailed', 1)` when durable recovery is on and nothing was admitted, one kit sentence
// each) fails exactly what an unmodified copy fails: W40.P4's deploy leg, the scratch's
// symlinked node_modules (lesson 2026-10-08); P45-P53 and W39, which need a git index, green on
// both once given one (logs/suite-base.json, suite-p64.json, env-base.json, env-p64.json). No
// test pins the action answer's member set (src/units/W16/B8.unit.test.ts:1298-1324 pins the
// hydrate's); src/content/consent.test.ts:1069-1077 fails the same learn read and asserts the
// log line and no fan-out only, so the new count leaves it green; src/units/W22/B1.unit.test.ts
// :1026's lossy tenant counts producerFailed through the producer's own path, which P64 does not touch.
// Mutants of the sketch the units catch (logs/mutant-*.log): the outcome built from the client's
// clock (OT1, OT4), the member on every answer (OT2), the failure counted twice (OT3), not logged
// (OT3), every admitted outcome counted (OT3, OT4's answer path).
//
// No new export is imported; every member read exists at this head. The ruled member is
// read loosely (`outcome` on the answer), so the file adds no type error.
//
// FIXTURE. P33 K3's world as OUT-K3 reproduced it (src/units/_parity10.ts `outcomeWorld`):
// the registered modules in catalogue order (the unknown-dimension and cross-category
// modules among them) with complete-the-look featuring the quilted Tabby, the declared
// layout slot and the recently-viewed and content slots, the layout learning against
// add_to_bag; one shopper with their explicit choice, a page view, the product page with its
// page instance, every layout decision acknowledged, the ledger drained and the shopper
// object's alarm cleared before the unit's own event.
//
// HARNESS: src/units/_parity.ts, src/units/_parity8.ts and src/units/_parity10.ts. Imports
// from src/units/: ../_parity, ../_parity8, ../_parity10.

import { describe, expect, it, vi } from 'vitest';

import { outcomeFromAction, ts36 } from '@/ledger/records';
import { recoveryDigest } from '@/ledger/recovery';

import { HOSTS, LAYOUT, PAGE_VIEW, readTree, slotPositionOf, storedOutcomes, TENANT, type Host, type Shopper, type Snapshot } from '../_parity';
import { actionWire, admissionsOf, remoteLatency, type Identity, type Wire } from '../_parity8';
import {
  BUY_BOX, evidenceLoss, failLearnReadOnce, outcomeRead, outcomeWorld, settleAll, timeOfRecordId, UNKNOWN_ADD,
} from '../_parity10';

const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);
/** The ruled member, read loosely: absent today. */
const memberOf = (wire: Pick<Wire, 'body'>, member: string): unknown =>
  (Object.hasOwn(wire.body, member) ? wire.body[member] : `no ${member} member (members: ${Object.keys(wire.body).sort().join(', ')})`);
const behaviorOf = (wire: Pick<Wire, 'body'>) => wire.body.behavior as { status?: unknown; recordId?: unknown; reason?: unknown } | undefined;

/** A content engagement (click) on a painted decision, in the body src/units/_parity.ts `click` sends. */
const clickOf = (page: Snapshot, d: Snapshot['decisions'][number]) => ({ type: 'content_click',
  data: { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, page: page.page, position: d.order, slotPosition: slotPositionOf(page, d) } });

/** The outcome id records.ts's own `outcomeFromAction` builds for the event as the action route calls it, at `time`. */
const outcomeIdAt = (s: Shopper, event: { type: string; data: Record<string, unknown> }, eventId: string, time: number): string =>
  outcomeFromAction({ ...event, userId: s.subject, sessionId: s.grant.sessionId, eventId, eventIdSource: 'provided', timestamp: time }, TENANT)!.outcome_id;

/** The rows the ledger stored for one event. */
const rowsOfEvent = (m: Parameters<typeof storedOutcomes>[0], s: Shopper, eventId: string) => storedOutcomes(m, s.subject).filter(row => row.event_id === eventId);

// ===========================================================================
// unit:P64.OT1 — the answer names the outcome record the engine stores
// ===========================================================================

describe('unit:P64.OT1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a buy-box add to bag sent with a client time 25 ms ahead of the engine, and a click on an acknowledged module, each answer 200 with outcome exactly { recordId }, recordId the outcome id records.ts builds at the engine time the answer's own behavior.recordId carries; the ledger stores exactly that one row and the operator's read of that id answers 200`, async () => {
      const { m, app, s, page } = await outcomeWorld(host, 'p64-ot1');
      const told: Array<[string, unknown]> = [], expected: Array<[string, unknown]> = [];
      const cases: Array<[string, { type: string; data: Record<string, unknown> }, Identity]> = [
        ['the buy-box add to bag', BUY_BOX, { eventId: crypto.randomUUID(), timestamp: Date.now() + 25 }],
        ['the click', clickOf(page, page.decisions.find(d => d.slot === LAYOUT)!), { eventId: crypto.randomUUID(), timestamp: Date.now() }],
      ];
      for (const [label, event, identity] of cases) {
        const answer = await actionWire(app, s, event, identity);
        await settleAll(m, app);
        await m.drainLedger();
        const admitted = timeOfRecordId(behaviorOf(answer)?.recordId);
        expect([answer.status, behaviorOf(answer)?.status, admitted === null ? 'no engine time' : 'engine time'],
          `${host}: PRECONDITION — ${label} is accepted with its behaviour capture durable, naming its engine time (${show(answer.body)})`).toEqual([200, 'durable', 'engine time']);
        const id = outcomeIdAt(s, event, identity.eventId, admitted!);
        told.push([label, memberOf(answer, 'outcome')]);
        expected.push([label, { recordId: id }]);
        expect.soft(rowsOfEvent(m, s, identity.eventId).map(row => row.outcome_id), `${host}: P64.OT1 — ${label}: the ledger stores exactly one outcome row of the event, under the id built at the engine time`)
          .toEqual([id]);
        expect.soft(await outcomeRead(m, id), `${host}: P64.OT1 — ${label}: the operator's ledger read of that id answers 200`).toBe(200);
      }
      expect.soft(told, `${host}: P64.OT1 — each answer names its outcome record beside behavior: outcome exactly { recordId }, the id the engine stores`).toEqual(expected);
    }, 60_000);
  }

  it('logic: kit 02 (the API reference) and kit 03 (the payload schemas) each state, in one sentence, that the action answer names its outcome record as outcome.recordId', () => {
    const sentences = (file: string) => readTree(file).replace(/`/g, '').split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(text => text.replace(/\s+/g, ' ').trim());
    const states = (text: string) => /\boutcome\b/.test(text) && /\brecordId\b/.test(text) && /\b(answer|response|action)/i.test(text) && !/product-sort/.test(text);
    const missing = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'].filter(file => !sentences(file).some(states));
    expect(missing, 'P64.OT1 — the kit states the action answer\'s outcome member and its recordId').toEqual([]);
  });

  it('CONTROL: the ledger read answers 404 for an id the ledger does not hold, and the expectation refuses today\'s answer (no outcome member) and a member naming the client-time id', async () => {
    const { m, app, s } = await outcomeWorld('session', 'p64-ot1-control');
    const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() + 25 };
    const answer = await actionWire(app, s, BUY_BOX, identity);
    await settleAll(m, app);
    await m.drainLedger();
    const id = outcomeIdAt(s, BUY_BOX, identity.eventId, timeOfRecordId(behaviorOf(answer)?.recordId)!);
    expect(await outcomeRead(m, id.replace(identity.eventId, crypto.randomUUID())), 'CONTROL — the read of an id no row carries answers 404').toBe(404);
    expect(() => expect(memberOf({ body: { success: true, behavior: {} } }, 'outcome')).toEqual({ recordId: id }), 'CONTROL — an answer without the member does not satisfy OT1').toThrow();
    const clientId = `${TENANT}:${ts36(identity.timestamp)}:${s.subject}:add_to_cart:n1:${identity.eventId}`;
    expect(() => expect({ recordId: clientId }).toEqual({ recordId: id === clientId ? `${id}-` : id }), 'CONTROL — a member built from the client\'s clock does not satisfy OT1').toThrow();
  }, 60_000);
});

// ===========================================================================
// unit:P64.OT2 — no outcome member where no outcome is emitted (LOCK)
// ===========================================================================

/** The answer carries no `outcome` member at all (the ruled absence). */
const noOutcomeMember = (wire: Pick<Wire, 'body'>): string => (Object.hasOwn(wire.body, 'outcome') ? `an outcome member: ${show(wire.body.outcome)}` : 'no outcome member');

describe('unit:P64.OT2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a dropped add to bag (a product the tenant does not hold), the same buy-box add to bag from a shopper who refused tracking, and a page view each answer 200 with no outcome member, and leave no outcome row`, async () => {
      const tracked = await outcomeWorld(host, 'p64-ot2');
      const refused = await outcomeWorld(host, 'p64-ot2-refused', { tracking: false, personalization: false });
      const cases: Array<[string, typeof tracked, { type: string; data: Record<string, unknown> }, (wire: Wire) => unknown, unknown]> = [
        ['the dropped add to bag', tracked, UNKNOWN_ADD, wire => wire.body.dropped, 'unknown_product'],
        ['the add to bag refused tracking', refused, BUY_BOX, wire => behaviorOf(wire)?.reason, 'tracking_refused'],
        ['the page view', tracked, PAGE_VIEW, wire => behaviorOf(wire)?.status, 'durable'],
      ];
      for (const [label, { m, app, s }, event, precondition, named] of cases) {
        const eventId = crypto.randomUUID();
        const answer = await actionWire(app, s, event, { eventId, timestamp: Date.now() });
        await settleAll(m, app);
        await m.drainLedger();
        expect([answer.status, precondition(answer)], `${host}: PRECONDITION — ${label} answers 200 as such (${show(answer.body)})`).toEqual([200, named]);
        expect.soft(noOutcomeMember(answer), `${host}: P64.OT2 — ${label} carries no outcome member`).toBe('no outcome member');
        expect.soft(rowsOfEvent(m, s, eventId).length, `${host}: P64.OT2 — and ${label} leaves no outcome row`).toBe(0);
      }
    }, 60_000);
  }

  it('CONTROL: a stray outcome member on any of those answers is caught', () => {
    const stray = { body: { success: true, dropped: 'unknown_product', outcome: { recordId: `${TENANT}:0:vis:add_to_cart:n1:x` } } };
    expect(() => expect(noOutcomeMember(stray)).toBe('no outcome member'), 'CONTROL — a dropped answer naming an outcome does not satisfy OT2').toThrow();
    expect(() => expect(noOutcomeMember({ body: { success: true, outcome: undefined } })).toBe('no outcome member'), 'CONTROL — even an undefined member is a member').toThrow();
  });
});

// ===========================================================================
// unit:P64.OT3 — a failure before the outcome's durable admission counts once, and is logged
// ===========================================================================

describe('unit:P64.OT3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): when the outcome's learning preparation fails to read the learn document, before the outcome's durable admission, the add to bag still answers 200 with its behaviour capture durable, the tenant's producerFailed lost-evidence counter (read as the monitor reads it) is exactly one higher, also after a following successful add to bag, and learning_incomplete is logged`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p64-ot3');
      const before = await evidenceLoss(m);
      const warn = vi.spyOn(console, 'warn');
      const fault = failLearnReadOnce();
      const eventId = crypto.randomUUID();
      let answer: Wire, admittedAtAnswer: unknown[];
      try {
        answer = await actionWire(app, s, BUY_BOX, { eventId, timestamp: Date.now() - 1 });
        admittedAtAnswer = admissionsOf(m, s.subject).filter(a => a.payload?.input.kind === 'outcome'
          && (a.payload.input as { outcome: { event_id?: string } }).outcome.event_id === eventId).map(a => a.id);
        await settleAll(m, app);
      } finally { fault.restore(); }
      const logged = warn.mock.calls.filter(args => args[0] === 'learning_incomplete').length;
      warn.mockRestore();
      await m.drainLedger();
      expect([fault.failed, admittedAtAnswer], `${host}: PRECONDITION — the learn document read failed once, and no outcome of the event was admitted`).toEqual([1, []]);
      expect.soft([answer.status, answer.body.success, behaviorOf(answer)?.status], `${host}: P64.OT3 — the answer's status is unchanged: 200, its engine answer and its behaviour capture durable (${show(answer.body)})`)
        .toEqual([200, true, 'durable']);
      const afterFailure = await evidenceLoss(m);
      expect.soft(afterFailure.producerFailed - before.producerFailed, `${host}: P64.OT3 — the failure before the outcome's durable admission counts once in the tenant's producerFailed counter (today it is not counted)`).toBe(1);
      expect.soft(logged, `${host}: P64.OT3 — and it is still logged as learning_incomplete`).toBeGreaterThanOrEqual(1);
      // Once, not per later event: a following add to bag whose outcome is admitted adds nothing.
      const next = await actionWire(app, s, BUY_BOX, { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 });
      await settleAll(m, app);
      expect(next.status, `${host}: PRECONDITION — the following add to bag is accepted`).toBe(200);
      expect.soft((await evidenceLoss(m)).producerFailed - before.producerFailed, `${host}: P64.OT3 — exactly once: a following successful add to bag adds nothing`).toBe(1);
    }, 60_000);

    // R-P125 (the lead, on the P64 build c60542be): the answer names `outcome.recordId` ONLY when the outcome was durably
    // admitted; under P59 that admission completes before the answer, so the route knows. A preparation that failed admits
    // nothing, and no record will ever be stored under the id it built.
    it(`host (${host}): R-P125 — when the outcome's learning preparation fails before its durable admission, the 200 carries NO outcome member while its behavior member stays, the loss counted once and logged; CONTROL: the same add to bag without the failure names its outcome record`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p64-ot3-r-p125');
      const before = await evidenceLoss(m);
      const warn = vi.spyOn(console, 'warn');
      const fault = failLearnReadOnce();
      const eventId = crypto.randomUUID();
      let refused: Wire;
      try {
        refused = await actionWire(app, s, BUY_BOX, { eventId, timestamp: Date.now() - 1 });
        await settleAll(m, app);
      } finally { fault.restore(); }
      const logged = warn.mock.calls.filter(args => args[0] === 'learning_incomplete').length;
      warn.mockRestore();
      await m.drainLedger();
      expect([fault.failed, refused.status, rowsOfEvent(m, s, eventId).length], `${host}: PRECONDITION — the learn read failed once, the add to bag was accepted, and no outcome of it is stored`).toEqual([1, 200, 0]);
      expect.soft(noOutcomeMember(refused), `${host}: P64.OT3 (R-P125) — the answer names no outcome record the engine did not admit`).toBe('no outcome member');
      expect.soft([behaviorOf(refused)?.status, typeof behaviorOf(refused)?.recordId], `${host}: P64.OT3 (R-P125) — its behavior member stays`).toEqual(['durable', 'string']);
      expect.soft([(await evidenceLoss(m)).producerFailed - before.producerFailed, logged >= 1], `${host}: P64.OT3 (R-P125) — the loss counted once and logged`).toEqual([1, true]);
      // CONTROL: the same add to bag without the refusal names its outcome record (OT1's member), so the absence above is the refusal's.
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
      const told = await actionWire(app, s, BUY_BOX, identity);
      await settleAll(m, app);
      expect.soft(memberOf(told, 'outcome'), `${host}: P64.OT3 (R-P125) CONTROL — without the refusal the same add to bag names its outcome record`)
        .toEqual({ recordId: outcomeIdAt(s, BUY_BOX, identity.eventId, identity.timestamp) });
    }, 60_000);
  }

  it('CONTROL: the lever refuses only the first learn read; without it a successful add to bag counts nothing and its outcome is stored', async () => {
    const { m, app, s } = await outcomeWorld('do', 'p64-ot3-control');
    const before = await evidenceLoss(m);
    const eventId = crypto.randomUUID();
    const answer = await actionWire(app, s, BUY_BOX, { eventId, timestamp: Date.now() - 1 });
    await settleAll(m, app);
    await m.drainLedger();
    expect([answer.status, rowsOfEvent(m, s, eventId).length, (await evidenceLoss(m)).producerFailed - before.producerFailed], 'CONTROL — a successful add to bag stores its outcome and counts nothing')
      .toEqual([200, 1, 0]);
    const fault = failLearnReadOnce();
    try {
      const { readRevision } = await import('@/config/versionedStore');
      const { LEARN_KIND } = await import('@/content/kinds');
      await expect(readRevision(m.env, LEARN_KIND, TENANT), 'CONTROL — the first learn read refuses').rejects.toThrow('injected');
      await expect(readRevision(m.env, LEARN_KIND, TENANT), 'CONTROL — the second answers').resolves.toBeTruthy();
    } finally { fault.restore(); }
    expect(fault.failed, 'CONTROL — one refusal').toBe(1);
  }, 60_000);
});

// ===========================================================================
// unit:P64.OT4 — locks: the clamp, the id format, the behavior member, the status codes, the answer path
// ===========================================================================

/** The remote calls the base makes before the answer, per binding and method (2ce8ffa6, this world; the header). */
const BASE_CALLS_BEFORE_ANSWER: Record<Host, Record<string, number>> = {
  session: { 'STORAGE.get': 1, 'CACHE.get': 11, 'SESSIONS.put': 2 },
  do: { 'STORAGE.get': 1 },
};
const countsOf = (calls: string[]) => calls.reduce<Record<string, number>>((out, call) => ({ ...out, [call]: (out[call] ?? 0) + 1 }), {});
/** The calls made beyond the base's, per binding and method; empty when none is new. */
const beyondBase = (host: Host, calls: string[]) => Object.entries(countsOf(calls))
  .filter(([call, count]) => count > (BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0)).map(([call, count]) => `${call} ×${count} (base ${BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0})`);

describe('unit:P64.OT4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — the clamp (a client time a minute ahead admitted at the engine's present, a past one exactly), the outcome_id format, the behavior member, and the status codes`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p64-ot4');
      for (const [label, offset] of [['a minute ahead', 60_000], ['a second in the past', -1_000]] as const) {
        const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() + offset };
        const answer = await actionWire(app, s, BUY_BOX, identity);
        const wall = Date.now();
        await settleAll(m, app);
        await m.drainLedger();
        const recordId = behaviorOf(answer)?.recordId, admitted = timeOfRecordId(recordId);
        expect([answer.status, admitted === null ? 'no engine time' : 'engine time'], `${host}: PRECONDITION — the add to bag ${label} is accepted (${show(answer.body)})`).toEqual([200, 'engine time']);
        expect.soft(offset > 0 ? [admitted! <= wall, admitted! < identity.timestamp] : admitted, `${host}: P64.OT4 — the clamp: a client time ${label} is admitted ${offset > 0 ? 'at the engine\'s present' : 'exactly as given'}`)
          .toEqual(offset > 0 ? [true, true] : identity.timestamp);
        const rows = rowsOfEvent(m, s, identity.eventId);
        expect.soft(rows.map(row => [row.outcome_id, row.ts]), `${host}: P64.OT4 — the outcome_id format (records.ts): \`\${tenant}:\${ts36(time)}:\${visitor}:add_to_cart:n1:\${eventId}\` at the behaviour record's time`)
          .toEqual([[`${TENANT}:${ts36(admitted!)}:${s.subject}:add_to_cart:n1:${identity.eventId}`, admitted]]);
        const expectedRecord = `${TENANT}:${ts36(admitted!)}:${s.subject}:behavior:${identity.eventId}`;
        expect.soft(answer.body.behavior, `${host}: P64.OT4 — the behavior member is P58's, unchanged`).toEqual({ status: 'durable', recordId: expectedRecord,
          receipt: { version: 1, operation: await recoveryDigest({ kind: 'behavior', tenant: TENANT, subject: s.subject, ids: [expectedRecord] }), durable: true, source: { expected: 1, state: 'pending' } } });
      }
      const statuses: Array<[string, number]> = [];
      for (const [label, event] of [['dropped', UNKNOWN_ADD], ['page view', PAGE_VIEW], ['invalid', { type: 'not_an_event', data: {} }]] as const) {
        const answer = await actionWire(app, s, event);
        await settleAll(m, app);
        statuses.push([label, answer.status]);
        if (label === 'invalid') expect.soft(answer.body, `${host}: P64.OT4 — an invalid event is refused as today`).toEqual({ error: 'Invalid action event' });
      }
      expect.soft(statuses, `${host}: P64.OT4 — the status codes: dropped 200, no reward 200, invalid 400`).toEqual([['dropped', 200], ['page view', 200], ['invalid', 400]]);
    }, 60_000);

    it(`host (${host}): LOCK — no new remote call before the answer: with 20 ms added to every remote binding call, an add to bag and a click make, per binding and method, no more remote calls before their answer than this ticket's base`, async () => {
      const { m, app, s, page } = await outcomeWorld(host, 'p64-ot4-latency');
      const lever = remoteLatency(m);
      const beyond: Array<[string, string[]]> = [];
      for (const [label, event] of [['add to bag', BUY_BOX], ['click', clickOf(page, page.decisions.find(d => d.slot === LAYOUT)!)]] as const) {
        const first = lever.calls.length;
        lever.set(20);
        let answer: Wire;
        try { answer = await actionWire(app, s, event); } finally { lever.set(0); }
        const before = lever.calls.slice(first).filter(call => call.at <= answer.answeredAt).map(call => `${call.binding}.${call.method}`);
        await settleAll(m, app);
        expect(answer.status, `${host}: PRECONDITION — the ${label} is accepted (${show(answer.body)})`).toBe(200);
        beyond.push([label, beyondBase(host, before)]);
      }
      expect.soft(beyond, `${host}: P64.OT4 — no remote call before the answer beyond the base's (amendment 5's answer-at-admission, no new wait)`).toEqual([['add to bag', []], ['click', []]]);
    }, 60_000);
  }

  it('CONTROL: a new remote call before the answer is caught', () => {
    expect(beyondBase('do', ['STORAGE.get', 'CACHE.get']), 'CONTROL — one more call than the base is named').toEqual(['CACHE.get ×1 (base 0)']);
    expect(beyondBase('session', ['STORAGE.get', 'STORAGE.get']), 'CONTROL — a repeated call is counted').toEqual(['STORAGE.get ×2 (base 1)']);
  });
});
