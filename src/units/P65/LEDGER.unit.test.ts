// src/units/P65/LEDGER.unit.test.ts
// P65 under the Closure Ledger: the tests for the LOCAL criteria RS1-RS3 of the P65 work
// order (the outcome-telling programme of amendment 7, ticket P65 "The outcome survives a
// reset between the behaviour capture's admission and its own"). LV1 is a deferred live
// row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-7/BTI-Parity-Amendment-2026-10-20.md, section 2, P65):
//   "P65 — the outcome survives a reset. On both hosts, once a tracked action's behaviour
//   capture is durably admitted, its outcome is durably admitted in the same transaction or
//   by a mechanism that a reset between the two cannot defeat (an outcome whose admission
//   fails after the behaviour's is written by the alarm, or the behaviour's admission is
//   not committed without the outcome's); a reset injected between the two admissions
//   therefore leaves, after the alarm, exactly one behaviour record and one outcome record
//   with the unit's content; the client's answer in that case is the typed answer the route
//   gives today for a reset (not a silent 200 without an outcome); W06's digests, the
//   idempotent replay and amendment 5's answer-at-admission unchanged."
// The work order's decision D1 (docs/parity/outcome-telling/program.json, P65): "The
// mechanism is the specifier's choice inside fail-closed; the observable is one behaviour
// and one outcome record after the alarm." Its remaining work: "Admit the outcome within
// the behaviour capture's durable admission (one transaction) or make the behaviour's
// admission carry the pending outcome so the alarm writes both; the specifier chooses
// inside fail-closed."
//
// One `describe('unit:P65.<criterion>')` per LOCAL criterion, both shopper hosts. Expected
// values come from the work order, the amendment, the analysis it cites
// (_evidence/baseline-52/outcome-k3/ANALYSIS.md, OUT-K3: §1 the path, §2 case b1 and its
// reproduction test logs/repro-REPRO.unit.test.ts.txt, §4 gap b1) and the engine's own
// functions, never from what the engine answers today:
//   · the outcome record: records.ts's own `outcomeFromAction` for the event as the action
//     route calls it (src/routes/realtime.ts `emitOutcome`: the shopper's session, the
//     provided event id, the admitted time), with the experiment block content/holdout.ts's
//     own `outcomeEnrollment` resolves for the visitor (W21 E1.02/E1.03), compared in the
//     engine's canonical form (`recoveryJSON`) without the members W06 leaves out of its
//     source commitment (`retention`, `externalRetention`: src/ledger/recovery.ts `sourceOf`)
//     and the ledger writer's delivery provenance (`_ledger_delivery`), as P59.CO3 compares it;
//   · the behaviour record: src/ledger/behavior.ts `captureBehavior` — its id
//     `${tenant}:${ts36(time)}:${subject}:behavior:${eventId}`, the event's type, id and time,
//     and its typed projection of the event's data (its `fields` list, transcribed: for the
//     add to bag `productId`, `price`, `currency`, `quantity`; for the click `contentId`,
//     `slot`, `decisionId`; for the dropped add to bag also `line` and `category`);
//   · the admitted time: a client time at or before the engine's present is admitted exactly
//     as given (realtime.ts, the W23 T1.01 clamp), so every id is derived from the request;
//   · W06: an operation's id `recoveryDigest({ kind, tenant, subject, ids })` and its source
//     digest `recoveryDigest({ kind, tenant, subject, brand, rows })` over its rows without
//     their processing stamps (recovery.ts `runOwnerRecovery`, `sourceOf`).
//
// THE READINGS THIS FILE RULES (one representation with P64, src/units/P64/LEDGER.unit.test.ts):
//   · "a reset injected between the two admissions" (src/units/_parity10.ts `resettable`): the
//     analyst's lever (repro :29-80: the instance's storage and every remote effect fail with
//     "Connection closed…", then a new instance is built over the same storage and its alarm
//     fired by a direct call once it is seen armed), placed by the BEHAVIOUR capture's durable
//     admission and not by the outcome's: right after the storage transaction that writes the
//     event's behaviour capture (a `recoveryBody:` chunk carrying `"kind":"behavior"` and the
//     event id; W06's admission, recovery.ts `savePayload`) has committed and the alarm calls
//     that arm its backstop (`armRecovery`) are made, the object's next storage call fails,
//     and the object stays down until rebuilt. The lever does not choose the mechanism: an
//     outcome admitted in that same transaction is committed with it (the one-transaction
//     admission), and an outcome carried by that admission is in it (the carried admission);
//     today the outcome is admitted only after the engine runs, which the reset prevents
//     (measured at 2ce8ffa6 on both hosts: the add to bag answers 401, after the alarm one
//     behaviour row and no outcome row, OUT-K3 case b1's result:
//     _evidence/parity-step3/S13/specifier/logs/probe1.log). The analyst's own placement (the
//     reset inside the outcome's admission transaction, before it commits) is NOT used: under
//     the one-transaction admission that transaction is the behaviour's too, so nothing is
//     between the two admissions and nothing of the event is committed, which the ticket
//     admits ("the behaviour's admission is not committed without the outcome's").
//   · RS1: the customer's buy-box add to bag of the quilted Tabby (OUT-K3's event) and a click
//     on an acknowledged layout module, each in its own world, each with a client time 1 ms in
//     the past; after the reset, the rebuilt object's alarm and the ledger drained: exactly one
//     behaviour row of the event and exactly one outcome row, each with the content above.
//   · RS2 "the typed answer the route gives today for a reset": what the engine answers a
//     tracked action whose object resets on its answer path, today, on both hosts: the owner's
//     typed refusal `401 { ok: false, error: 'Shopper session unavailable' }` (the reset
//     object's storage refuses the boundary's marker read, src/durable-objects/ShopperReflex.ts
//     `fetch`, Baseline 52 G10; on the object host the route passes the refusal on with its
//     `behavior` member, realtime.ts `{ ...out, behavior }` at the object's status), or, where
//     the reset reaches an error path first, a 500 whose body names the reset: the worker's
//     `{ error: 'Internal server error', message }` (src/middleware/error.ts; OUT-K3 §2 case b1
//     at both shas) or the route's own `{ error: 'Failed to process action event', details }`
//     (realtime.ts). Never a 2xx without an `outcome` member (P64's member). "In that case"
//     is a reset that falls after the behaviour capture's admission and before the outcome's:
//     when the transaction that admitted the behaviour capture also wrote the outcome's own
//     operation (`recoveryOperation:<W06 id>`, the one-transaction admission), no reset can fall
//     between the two, and the answer is then either the typed reset answer or a 2xx that names
//     that outcome (P64's `outcome.recordId`) whose record the alarm leaves; measured on the two
//     sketches below (one transaction: 200 naming the outcome on both hosts; the carried
//     outcome: the typed 401 on both hosts).
//   · RS3 LOCKS, GREEN at specification:
//       W06's digests on the ordinary path: the add to bag's behaviour and outcome operations
//       are held under W06's ids, each with the source digest of the row the ledger stored;
//       the idempotent replay: after the reset and the alarm, the same event re-sent (same id
//       and time) answers 200 with its behaviour capture `recovered`, and leaves exactly one
//       behaviour row, one outcome row and one operation of each kind for the event, each
//       under W06's id and digest, recovered;
//       amendment 5's answer-at-admission (P59.CO1's shape, for the add to bag): with the event
//       queue held, the add to bag answers 200 with its behaviour capture durable, its outcome
//       already durably admitted (its operation held with its body, pending) and the alarm armed
//       within 30 s; after release and drain one outcome row and its operation recovered;
//       no new remote call before the answer: as P64.OT4 (the base counts of 2ce8ffa6 on this
//       world, per binding and method);
//       fail-closed (D1): an add to bag the engine drops (W35 A1, "no outcome": realtime.ts, the
//       drop answer) whose object resets right after its behaviour capture's admission leaves,
//       after the alarm, its behaviour record and NO outcome record, whatever mechanism carried
//       the outcome; and so, R-P129 (2), for every drop the engine decides: a second purchase of
//       an order (P40, R-P48: `duplicate_order`, decided on the shopper's stored order memory,
//       `isDuplicateOrder`), after a first purchase of it and a second answered `duplicate_order`;
//       R-P129 (1), R-P124(1), behaviour first (the action route's comment at the behaviour capture,
//       realtime.ts `captureBehavior`: "Actual accepted action source is admitted durably BEFORE
//       profile, queue, learning or external side effects; a downstream refusal cannot erase the
//       original event identity"): an add to bag whose engine fails once (the session host's
//       segment engine, the object host's `/ingest` door, as the specification review's probe
//       fails it) keeps its one behaviour record;
//       R-P129 (5), R-P126: a carried outcome is never counted lost: the tenant's `producerFailed`
//       (P64's counter) is unchanged after RS1's reset and the alarm, and after a reset inside the
//       outcome's own admission transaction (OUT-K3 case b1's placement: src/units/_parity10.ts
//       `resettable`, `killBeforeCommitOf`) and the alarm. Written in RS3 and not RS1: RS1's
//       observable is the two records after the alarm; this is a lock on P64's counter that P65's
//       mechanism must leave as it is, green today, as RS3's other locks are;
//       the units P56-P60 and P64 unchanged: their own acceptance commands, run beside this one.
//
// PRECONDITIONS: none on P64. RS2 accepts a 2xx only when it names the outcome (P64's member);
// no P65 leg reads P64's member otherwise.
//
// SKETCHES (scratch copies, never committed; _evidence/parity-step3/S13/specifier/sketches/, both
// on sketch-p64.py):
//   A, ONE TRANSACTION (sketch-p65a.py): a tracked reward action's behaviour capture waits for the
//   engine and is admitted in one storage transaction with the event's prepared outcome
//   (recovery.ts, the two operations' bodies and records in one `storage.transaction`, one alarm),
//   both answering at admission; an action that emits none captures its behaviour alone. Units:
//   P64 15/15, P65 17/17 on both hosts (logs/p65-draft4-a.log). Its answer to the reset: 200
//   naming the outcome (both admissions committed before the reset).
//   B, THE CARRIED OUTCOME (sketch-p65b.py): the behaviour capture's admission carries the event's
//   prepared outcome before the engine runs; the alarm that resumes a behaviour operation admits it
//   when no admission of it exists; an event that emits none withdraws it before the answer.
//   Units: P64 15/15, P65 15/17 (logs/p65-draft4-b.log): the fail-closed lock fails on both hosts,
//   since a reset before the engine has decided the drop leaves an outcome record for a dropped
//   event. Its answer to the reset: the typed 401.
//   So the units accept the one-transaction admission, and a carried outcome only where the drop
//   is decided before it is carried or again at the alarm.
//   R-P124 rules design B with the drop re-decided before the alarm writes the carried outcome. The
//   R-P129 legs, measured (_evidence/parity-step3/S13/specifier/logs/r129-*.log; sketch-p65cb.py on the
//   P64 build 03300b44, which re-decides W35 A1's unknown product and P40's duplicate order at the alarm
//   and counts a failed preparation once through P61's `afterOwnerAnswer`): conforming B GREEN on every
//   P64 and P65 unit; behaviour first RED under A (no behaviour row after the engine's failure); the
//   duplicate order RED under B re-deciding the unknown product alone (the review's sketch, and
//   sketch-p65cb.py `unknown-only`: one outcome row); the uncounted carry RED under B counting a carried
//   outcome whose own admission failed (sketch-p65cb.py `count-carried`: producerFailed +1 after the
//   reset inside that admission). Mutants the units catch
//   (logs/mutant-*.log): sketch B without the alarm's admission (RS1), the alarm admitting the
//   carried outcome at its own time under another id (RS1, RS3's replay).
//
// R10 (expectations a build of P65 changes): NONE MEASURED. The whole suite under each sketch on
// a scratch copy given a git index fails only W40.P4's deploy leg, which fails identically on an
// unmodified copy (the scratch's symlinked node_modules, lesson 2026-10-08): logs/suite-p65a.json,
// suite-p65b.json, suite-base.json, env-base.json. One documented invariant the one-transaction
// admission moves, pinned by no test: the action route's comment at the behaviour capture
// (realtime.ts: "Actual accepted action source is admitted durably BEFORE profile, queue,
// learning or external side effects; a downstream refusal cannot erase the original event
// identity"); under A a reward action whose engine fails, or whose object resets while the engine
// runs, keeps no behaviour record (today it keeps one; read from the sketch, not measured), which
// the ticket admits ("the behaviour's admission is not committed without the outcome's").
//
// No new export is imported; every member read exists at this head.
//
// FIXTURE. P33 K3's world as OUT-K3 reproduced it (src/units/_parity10.ts `outcomeWorld`), as
// P64's file builds it.
//
// HARNESS: src/units/_parity.ts, src/units/_parity8.ts and src/units/_parity10.ts. Imports from
// src/units/: ../_parity, ../_parity8, ../_parity10.

import { describe, expect, it, vi } from 'vitest';

import { personalizes, storedConsent } from '@/content/consent';
import { outcomeEnrollment } from '@/content/holdout';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { outcomeFromAction, ts36 } from '@/ledger/records';
import { recoveryDigest, recoveryJSON } from '@/ledger/recovery';
import { RealtimeSegmentEngine } from '@/services/RealtimeSegmentEngine';
import type { TenantId } from '@/tenancy/tenant';

import { BRAND, HOSTS, LAYOUT, slotPositionOf, storedOutcomes, TENANT, type Host, type Mounted, type Shopper, type Snapshot } from '../_parity';
import {
  actionWire, admissionsOf, clearShopperAlarm, holdQueue, remoteLatency, shopperHeld, shopperStorage, storedBehavior, UNANSWERED, within, type Identity, type Wire,
} from '../_parity8';
import { BAG, BUY_BOX, evidenceLoss, outcomeWorld, RESET_MESSAGE, resettable, settleAll, UNKNOWN_ADD, type OutcomeWorld } from '../_parity10';
// S16 additive locks (amendment 8, finding (b)): the levers they use.
import * as versionedStore from '@/config/versionedStore';
import { LEARN_KIND } from '@/content/kinds';
import * as authority from '@/identity/sessionAuthority';
import { SessionAccessError } from '@/identity/sessionCapability';

const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);
type Event = { type: string; data: Record<string, unknown> };
/** Nothing resolves a held queue send: an engine that waits on it never answers, and this bound decides. */
const HOLD_BOUND_MS = 4_000;

/** A content engagement (click) on a painted decision, in the body src/units/_parity.ts `click` sends. */
const clickOf = (page: Snapshot, d: Snapshot['decisions'][number]): Event => ({ type: 'content_click',
  data: { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, page: page.page, position: d.order, slotPosition: slotPositionOf(page, d) } });
const firstModule = (page: Snapshot) => page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order)[0]!;
type Kind = 'add to bag' | 'click' | 'dropped add to bag';
/** The event of each case, in its own world. */
const eventOf = (kind: Kind, page: Snapshot): Event => (kind === 'add to bag' ? BUY_BOX : kind === 'dropped add to bag' ? UNKNOWN_ADD : clickOf(page, firstModule(page)));
/** behavior.ts's typed projection of an event's data: its `fields` list, transcribed (src/ledger/behavior.ts `fields`), for these events' primitive values. */
const BEHAVIOR_FIELDS = ['productId', 'product_id', 'sku', 'contentId', 'content_id', 'decisionId', 'slot', 'pageType', 'event',
  'ms', 'dwellMs', 'value', 'price', 'margin', 'currency', 'quantity', 'orderId', 'line', 'category', 'occasion', 'color', 'silhouette', 'priceBand'];
const projectionOf = (event: Event): Record<string, unknown> => Object.fromEntries(BEHAVIOR_FIELDS.filter(key => Object.hasOwn(event.data, key)).map(key => [key, event.data[key]]));

/** The kit's purchase payload (docs/kit/03-payload-schemas.md; P40's `kitPurchase`) for the quilted Tabby, naming its order. */
const purchaseOf = (orderId: string): Event => ({ type: 'purchase', data: { orderId, value: 575, currency: 'USD', items: [{ productId: BAG, quantity: 1, price: 575 }], brand: BRAND } });

/**
 * The engine fails once on the next action, as the specification review's probe failed it
 * (_evidence/parity-step3/S13/reviewer/probes/BEHAVIOUR-FIRST.probe.test.ts): on the session host the segment engine's
 * `processActionEventWithSession`, on the object host the shopper object's own `/ingest` door the route calls.
 */
function engineFailsOnce(host: Host): { readonly failed: number; restore: () => void } {
  let failed = 0;
  const failure = () => { failed++; return Promise.reject(new Error('injected: engine failure')); };
  if (host === 'session') {
    const spy = vi.spyOn(RealtimeSegmentEngine.prototype, 'processActionEventWithSession').mockImplementationOnce(failure);
    return { get failed() { return failed; }, restore: () => spy.mockRestore() };
  }
  const original = ShopperReflex.prototype.fetch;
  const spy = vi.spyOn(ShopperReflex.prototype, 'fetch').mockImplementation(function (this: ShopperReflex, request: Request) {
    if (!failed && new URL(request.url).pathname === '/ingest') return failure() as Promise<Response>;
    return original.call(this, request);
  });
  return { get failed() { return failed; }, restore: () => spy.mockRestore() };
}

const without = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
const PROCESSING = ['retention', 'externalRetention', '_ledger_delivery'];

/** The outcome record the route emits for the event (records.ts `outcomeFromAction` with the visitor's experiment block), without its processing stamps. */
async function expectedOutcome(m: Mounted, s: Shopper, event: Event, identity: Identity) {
  const outcome = outcomeFromAction({ ...event, userId: s.subject, sessionId: s.grant.sessionId, eventId: identity.eventId, eventIdSource: 'provided', timestamp: identity.timestamp }, TENANT)!;
  const consent = storedConsent(shopperHeld(m, s.subject, 'consent'));
  const experiment = await outcomeEnrollment(m.env, TENANT as TenantId, outcome.brand, s.subject, personalizes(consent));
  return { ...outcome, ...(experiment ? { experiment } : {}) };
}
/** The behaviour record's content (behavior.ts `captureBehavior`). */
const expectedBehaviour = (s: Shopper, event: Event, identity: Identity) => ({ record_id: `${TENANT}:${ts36(identity.timestamp)}:${s.subject}:behavior:${identity.eventId}`,
  event: event.type, event_id: identity.eventId, ts: identity.timestamp, data: projectionOf(event) });
const behaviourContent = (row: Record<string, unknown>) => ({ record_id: row.record_id, event: row.event, event_id: row.event_id, ts: row.ts, data: row.data });

const behaviourRows = (m: Mounted, s: Shopper, eventId: string) => storedBehavior(m, s.subject).filter(row => row.event_id === eventId);
const outcomeRows = (m: Mounted, s: Shopper, eventId: string) => storedOutcomes(m, s.subject).filter(row => row.event_id === eventId);
/** The event's recovery operations, by kind: [kind, id, state]. */
const operationsOf = (m: Mounted, s: Shopper, eventId: string) => admissionsOf(m, s.subject).filter(a => {
  const input = a.payload?.input as { kind?: string; record?: { event_id?: string }; outcome?: { event_id?: string } } | undefined;
  return input && (input.kind === 'behavior' ? input.record?.event_id === eventId : input.kind === 'outcome' ? input.outcome?.event_id === eventId : false);
}).map(a => [a.payload!.input.kind, a.id, a.meta.receipt.source.state] as const).sort((a, b) => a[0].localeCompare(b[0]));

/** W06's operation of a stored row: its id and the source digest of exactly that row (without its processing stamps). */
async function w06Of(s: Shopper, kind: 'behavior' | 'outcome', row: Record<string, unknown>) {
  const id = String(kind === 'behavior' ? row.record_id : row.outcome_id);
  return { id: await recoveryDigest({ kind, tenant: TENANT, subject: s.subject, ids: [id] }),
    digest: await recoveryDigest({ kind, tenant: TENANT, subject: s.subject, brand: String(row.brand), rows: [without(row, PROCESSING)] }) };
}

interface ResetRun extends OutcomeWorld { event: Event; identity: Identity; answer: Wire | typeof UNANSWERED; fired: boolean; committed: string[]; killedAt: string; alarm: number | null; alarmRan: string }

/**
 * The reset of RS1-RS3: the event sent with a client time 1 ms in the past; the shopper's object reset right after the
 * event's behaviour capture is durably admitted (src/units/_parity10.ts `resettable`); every pending piece of work settled;
 * the object rebuilt over the same storage and its alarm, seen armed, fired; the ledger drained.
 */
async function resetRun(host: Host, label: string, kind: Kind): Promise<ResetRun> {
  const world = await outcomeWorld(host, label);
  return resetRunOn(world, eventOf(kind, world.page));
}
/** The same reset on a world already built, for one event; `killBeforeCommitOf` places it inside that key's transaction instead. */
async function resetRunOn(world: OutcomeWorld, event: Event, identity: Identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 },
  options: { killBeforeCommitOf?: string } = {}): Promise<ResetRun> {
  const { m, app, s } = world;
  const reset = resettable(m, s.subject, identity.eventId, options);
  const answer = await within(actionWire(app, s, event, identity), 20_000);
  await settleAll(m, app);
  const killedAt = reset.state.killedAt, alarm = await reset.alarmAt();
  const fresh = reset.revive();
  let alarmRan = 'not armed';
  if (alarm !== null) { alarmRan = 'ran'; try { await fresh.alarm(); } catch (error) { alarmRan = `threw ${(error as Error).message}`; } }
  await settleAll(m, app);
  await m.drainLedger();
  return { ...world, event, identity, answer, fired: reset.state.fired, committed: reset.state.committed, killedAt, alarm, alarmRan };
}
const preconditions = (host: Host, run: ResetRun) =>
  expect([run.fired, run.alarm === null ? 'no alarm' : 'alarm armed', run.alarmRan], `${host}: PRECONDITION — the behaviour capture's durable admission was seen to commit (the reset followed it${run.killedAt ? `, at ${run.killedAt}` : ''}) and the alarm armed by it is fired`)
    .toEqual([true, 'alarm armed', 'ran']);

// ===========================================================================
// unit:P65.RS1 — after a reset between the two admissions and the alarm: one behaviour record and one outcome record
// ===========================================================================

describe('unit:P65.RS1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a buy-box add to bag, and a click on an acknowledged module, whose shopper object resets right after the event's behaviour capture is durably admitted, leave after the alarm exactly one behaviour record and exactly one outcome record of the event, each with the event's content (today the behaviour record only)`, async () => {
      for (const kind of ['add to bag', 'click'] as const) {
        const run = await resetRun(host, `p65-rs1-${kind.replace(/ /g, '-')}`, kind);
        const { m, s, event, identity } = run;
        preconditions(host, run);
        const expected = await expectedOutcome(m, s, event, identity);
        expect.soft([behaviourRows(m, s, identity.eventId).map(behaviourContent), outcomeRows(m, s, identity.eventId).map(row => recoveryJSON(without(row, PROCESSING)))],
          `${host}: P65.RS1 — ${kind}: after the alarm, exactly one behaviour record and one outcome record of the event, with the event's content (answered ${run.answer === UNANSWERED ? UNANSWERED : `${run.answer.status} ${show(run.answer.body)}`})`)
          .toEqual([[expectedBehaviour(s, event, identity)], [recoveryJSON(without(expected, PROCESSING))]]);
      }
    }, 90_000);
  }

  it('CONTROL: the lever sends the object down only after the behaviour admission of its own event, keeps that admission, and the comparison has teeth', async () => {
    const { m, app, s } = await outcomeWorld('do', 'p65-rs1-control');
    const reset = resettable(m, s.subject, crypto.randomUUID());
    const other = await actionWire(app, s, BUY_BOX, { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 });
    await settleAll(m, app);
    expect([other.status, reset.state.fired, reset.state.killedAt], 'CONTROL — another event\'s admission does not fire the lever').toEqual([200, false, '']);
    reset.revive();
    const run = await resetRun('session', 'p65-rs1-control-run', 'add to bag');
    expect([run.fired, run.killedAt !== '', behaviourRows(run.m, run.s, run.identity.eventId).length], 'CONTROL — the reset follows the behaviour admission, which the alarm then completes').toEqual([true, true, 1]);
    const expected = await expectedOutcome(run.m, run.s, run.event, run.identity);
    const elsewhen = await expectedOutcome(run.m, run.s, run.event, { ...run.identity, timestamp: run.identity.timestamp - 1000 });
    expect(recoveryJSON(without(expected, PROCESSING)) === recoveryJSON(without(elsewhen, PROCESSING)), 'CONTROL — the same event at another time is another outcome record').toBe(false);
    // Today's result (probe1.log): the behaviour record only; it does not satisfy RS1.
    expect(() => expect([[expectedBehaviour(run.s, run.event, run.identity)], []]).toEqual([[expectedBehaviour(run.s, run.event, run.identity)], [recoveryJSON(without(expected, PROCESSING))]]),
      'CONTROL — the behaviour record alone does not satisfy RS1').toThrow();
  }, 90_000);
});

// ===========================================================================
// unit:P65.RS2 — the client's answer in that case is the typed reset answer, never a silent 200
// ===========================================================================

/** How the answer to a reset event reads: a typed reset answer, a 2xx that names the event's outcome (P64), or neither. */
function readingOf(answer: Wire | typeof UNANSWERED, outcomeId: string): string {
  if (answer === UNANSWERED) return `${UNANSWERED} within 20 s`;
  const body = answer.body;
  if (answer.status === 401 && body.ok === false && body.error === 'Shopper session unavailable') return 'the typed reset answer';
  if (answer.status === 500 && ((body.error === 'Internal server error' && body.message === RESET_MESSAGE)
    || (body.error === 'Failed to process action event' && body.details === RESET_MESSAGE))) return 'the typed reset answer';
  if (answer.status >= 200 && answer.status < 300) {
    const told = (body.outcome as { recordId?: unknown } | undefined)?.recordId;
    return told === outcomeId ? 'a 2xx naming the outcome record' : `a ${answer.status} without the event's outcome (${show(body.outcome ?? 'no outcome member')})`;
  }
  return `an untyped ${answer.status}: ${show(body)}`;
}

/** RS2's verdict: the typed reset answer; a 2xx only when the outcome was admitted in the behaviour capture's own transaction, named and stored. */
const verdictOf = (reading: string, together: boolean, stored: boolean): string => (reading === 'the typed reset answer'
  || (together && stored && reading === 'a 2xx naming the outcome record') ? 'accepted'
  : `${reading}${together ? ' (the outcome was admitted with the behaviour capture)' : ' (the outcome was not admitted with the behaviour capture: a reset between the two)'}`);

describe('unit:P65.RS2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the add to bag whose shopper object resets right after its behaviour capture's durable admission is answered with the route's typed reset answer (401 Shopper session unavailable, or a 500 naming the reset), never a 2xx without its outcome; a 2xx is admitted only when the outcome was admitted in the behaviour capture's own transaction and names it`, async () => {
      const run = await resetRun(host, 'p65-rs2', 'add to bag');
      preconditions(host, run);
      const outcomeId = outcomeFromAction({ ...run.event, userId: run.s.subject, sessionId: run.s.grant.sessionId, eventId: run.identity.eventId, eventIdSource: 'provided', timestamp: run.identity.timestamp }, TENANT)!.outcome_id;
      const operation = await recoveryDigest({ kind: 'outcome', tenant: TENANT, subject: run.s.subject, ids: [outcomeId] });
      const together = run.committed.includes(`recoveryOperation:${operation}`);
      const stored = outcomeRows(run.m, run.s, run.identity.eventId).some(row => row.outcome_id === outcomeId);
      expect.soft(verdictOf(readingOf(run.answer, outcomeId), together, stored),
        `${host}: P65.RS2 — the client's answer is the typed reset answer, never a 2xx without its outcome (${run.answer === UNANSWERED ? UNANSWERED : `${run.answer.status} ${show(run.answer.body)}`})`)
        .toBe('accepted');
    }, 60_000);
  }

  it('CONTROL: a silent 200, a 200 naming another outcome and an untyped 500 are not the typed reset answer; both typed shapes are', () => {
    const wire = (status: number, body: Record<string, unknown>): Wire => ({ status, body, answeredAt: 0, sentAt: 0 });
    expect(readingOf(wire(200, { success: true, behavior: { status: 'durable' } }), 'x'), 'CONTROL — a silent 200').not.toBe('the typed reset answer');
    expect(readingOf(wire(200, { success: true, outcome: { recordId: 'y' } }), 'x'), 'CONTROL — a 200 naming another outcome').toMatch(/without the event's outcome/);
    expect(readingOf(wire(500, { error: 'Internal server error', message: 'something else' }), 'x'), 'CONTROL — a 500 not naming the reset').toMatch(/^an untyped 500/);
    expect([readingOf(wire(401, { ok: false, error: 'Shopper session unavailable', behavior: {} }), 'x'), readingOf(wire(500, { error: 'Internal server error', message: RESET_MESSAGE }), 'x')],
      'CONTROL — the typed shapes').toEqual(['the typed reset answer', 'the typed reset answer']);
    const told = readingOf(wire(200, { success: true, outcome: { recordId: 'x' } }), 'x');
    expect([verdictOf(told, false, true), verdictOf(told, true, false), verdictOf(told, true, true), verdictOf('the typed reset answer', false, false)],
      'CONTROL — a 2xx naming the outcome is refused when the outcome was not admitted with the behaviour capture or is not stored; the typed answer always stands')
      .toEqual([expect.stringMatching(/a reset between the two/), expect.stringMatching(/admitted with the behaviour capture\)$/), 'accepted', 'accepted']);
  });
});

// ===========================================================================
// unit:P65.RS3 — locks: W06's digests, the idempotent replay, the answer at admission, the answer path
// ===========================================================================

/** The remote calls the base makes before the answer, per binding and method (2ce8ffa6, this world; P64's file, OT4). */
const BASE_CALLS_BEFORE_ANSWER: Record<Host, Record<string, number>> = {
  session: { 'STORAGE.get': 1, 'CACHE.get': 11, 'SESSIONS.put': 2 },
  do: { 'STORAGE.get': 1 },
};
const beyondBase = (host: Host, calls: string[]) => Object.entries(calls.reduce<Record<string, number>>((out, call) => ({ ...out, [call]: (out[call] ?? 0) + 1 }), {}))
  .filter(([call, count]) => count > (BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0)).map(([call, count]) => `${call} ×${count} (base ${BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0})`);

// S16 additive locks (amendment 8, finding (b); the P65 delivery review, findings 3 to 5): their levers.
/** Every read of the tenant's learn document through `readRevision` (the outcome's learning preparation), counted and answered as before. */
function countLearnReads(): { readonly reads: number; restore: () => void } {
  let reads = 0;
  const original = versionedStore.readRevision;
  const spy = vi.spyOn(versionedStore, 'readRevision').mockImplementation(((env: Parameters<typeof original>[0], kind: Parameters<typeof original>[1], scope: string, now?: number) => {
    if (kind.name === LEARN_KIND.name && scope === TENANT) reads++;
    return original(env, kind, scope, now);
  }) as typeof original);
  return { get reads() { return reads; }, restore: () => spy.mockRestore() };
}
/** `admitOwnedRecovery` (src/identity/sessionAuthority.ts) refuses the next OUTCOME admission once, before the store (the P65 review's probe, a SessionAccessError). */
function refuseOutcomeAdmissionOnce(): { readonly refused: number; restore: () => void } {
  let refused = 0;
  const original = authority.admitOwnedRecovery;
  const spy = vi.spyOn(authority, 'admitOwnedRecovery').mockImplementation(((input, options) => {
    if (input.kind === 'outcome' && !refused) { refused++; return Promise.reject(new SessionAccessError()); }
    return original(input, options);
  }) as typeof original);
  return { get refused() { return refused; }, restore: () => spy.mockRestore() };
}
/**
 * The shopper object's storage refuses, once, the transaction that withdraws the outcome a behaviour operation carries: the
 * first transaction writing that operation's record (`recoveryOperation:<operation>`) with no `carries` member
 * (src/ledger/recovery.ts `withdrawCarriedOutcome`: the body written again without it, the record naming it no longer).
 */
function failWithdrawalOnce(m: Mounted, subject: string, operation: string): { readonly failed: number; restore: () => void } {
  type Transaction = (run: (tx: DurableObjectTransaction) => Promise<unknown>) => Promise<unknown>;
  const storage = shopperStorage(m, subject) as unknown as { transaction: Transaction };
  const original = storage.transaction;
  let failed = 0;
  storage.transaction = run => original(tx => run(new Proxy(tx, { get: (target, property) => {
    const value = Reflect.get(target, property, target) as unknown;
    if (property !== 'put' || typeof value !== 'function') return value;
    return (key: unknown, stored?: unknown, ...rest: unknown[]) => {
      if (!failed && key === `recoveryOperation:${operation}` && stored && typeof stored === 'object' && !Object.hasOwn(stored, 'carries')) {
        failed++; throw new Error('lever: the withdrawal of the carried outcome failed');
      }
      return (value as (...args: unknown[]) => unknown).call(target, key, stored, ...rest);
    };
  } })));
  return { get failed() { return failed; }, restore: () => { storage.transaction = original; } };
}

describe('unit:P65.RS3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — W06's digests: an ordinary add to bag's behaviour and outcome operations are held under W06's ids, each with the source digest of the row the ledger stored, recovered`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p65-rs3-w06');
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
      const answer = await actionWire(app, s, BUY_BOX, identity);
      await settleAll(m, app);
      await m.drainLedger();
      expect(answer.status, `${host}: PRECONDITION — the add to bag is accepted (${show(answer.body)})`).toBe(200);
      const [behaviour] = behaviourRows(m, s, identity.eventId), [outcome] = outcomeRows(m, s, identity.eventId);
      expect([behaviour ? 'behaviour row' : 'none', outcome ? 'outcome row' : 'none'], `${host}: PRECONDITION — both rows are stored`).toEqual(['behaviour row', 'outcome row']);
      const held = admissionsOf(m, s.subject);
      const w06 = [await w06Of(s, 'behavior', behaviour!), await w06Of(s, 'outcome', outcome!)];
      expect.soft(w06.map(({ id, digest }) => { const a = held.find(x => x.id === id); return a ? [a.meta.digest === digest, a.meta.receipt.source.state] : 'no operation under W06\'s id'; }),
        `${host}: P65.RS3 — W06's digests: each operation under recoveryDigest({ kind, tenant, subject, ids }) with the source digest of its stored row, recovered`).toEqual([[true, 'recovered'], [true, 'recovered']]);
    }, 60_000);

    it(`host (${host}): LOCK — the idempotent replay: after the reset and the alarm, the add to bag re-sent with the same id and time answers 200 with its behaviour capture recovered, and leaves exactly one behaviour row, one outcome row and one operation of each kind for the event, under W06's ids and digests, recovered`, async () => {
      const run = await resetRun(host, 'p65-rs3-replay', 'add to bag');
      const { m, app, s, event, identity } = run;
      preconditions(host, run);
      const again = await actionWire(app, s, event, identity);
      await settleAll(m, app);
      await m.drainLedger();
      const receipt = (again.body.behavior as { receipt?: { source?: { state?: unknown } } } | undefined)?.receipt;
      expect.soft([again.status, receipt?.source?.state], `${host}: P65.RS3 — the same-id re-send answers 200 with its behaviour capture recovered (${show(again.body)})`).toEqual([200, 'recovered']);
      const behaviour = behaviourRows(m, s, identity.eventId), outcome = outcomeRows(m, s, identity.eventId);
      expect.soft([behaviour.length, outcome.length], `${host}: P65.RS3 — one behaviour row and one outcome row`).toEqual([1, 1]);
      const expected = [
        ...(behaviour[0] ? [['behavior', (await w06Of(s, 'behavior', behaviour[0])).id, 'recovered'] as const] : []),
        ...(outcome[0] ? [['outcome', (await w06Of(s, 'outcome', outcome[0])).id, 'recovered'] as const] : []),
      ];
      expect.soft(operationsOf(m, s, identity.eventId), `${host}: P65.RS3 — one operation of each kind for the event, under W06's ids, recovered`).toEqual(expected);
      const held = admissionsOf(m, s.subject);
      const digests = await Promise.all([...behaviour.map(row => w06Of(s, 'behavior', row)), ...outcome.map(row => w06Of(s, 'outcome', row))]);
      expect.soft(digests.map(({ id, digest }) => held.find(a => a.id === id)?.meta.digest === digest), `${host}: P65.RS3 — each with the source digest of its stored row`).toEqual(digests.map(() => true));
    }, 60_000);

    it(`host (${host}): LOCK — amendment 5's answer at admission: while the event queue is held, the add to bag answers 200 with its behaviour capture durable, its outcome already durably admitted (its operation held with its body, pending) and the alarm armed within 30 s; after release and drain one outcome row and its operation recovered`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p65-rs3-admission');
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
      const outcomeId = outcomeFromAction({ ...BUY_BOX, userId: s.subject, sessionId: s.grant.sessionId, eventId: identity.eventId, eventIdSource: 'provided', timestamp: identity.timestamp }, TENANT)!.outcome_id;
      const operation = await recoveryDigest({ kind: 'outcome', tenant: TENANT, subject: s.subject, ids: [outcomeId] });
      const held = holdQueue(m);
      const sentWall = Date.now();
      const sent = actionWire(app, s, BUY_BOX, identity);
      let answer: Wire | typeof UNANSWERED = UNANSWERED, atAnswer: unknown = 'no answer', alarm: number | null = null, alarmRead = 0;
      try {
        answer = await within(sent, HOLD_BOUND_MS);
        const admission = admissionsOf(m, s.subject).find(a => a.id === operation);
        atAnswer = admission ? [admission.meta.receipt.source.state, admission.keys.some(key => key.startsWith(`recoveryBody:${operation}:`))] : 'no admission of the outcome when the add to bag was answered';
        alarm = await shopperStorage(m, s.subject).getAlarm(); alarmRead = Date.now();
      } finally { held.release(); }
      await sent;
      await settleAll(m, app);
      await m.drainLedger();
      const unanswered = `${UNANSWERED} within ${HOLD_BOUND_MS} ms while the queue send was held`;
      expect.soft(answer === UNANSWERED ? unanswered : [answer.status, answer.body.success, (answer.body.behavior as { status?: unknown } | undefined)?.status],
        `${host}: P65.RS3 — the add to bag answers 200 at admission while the queue send is held`).toEqual([200, true, 'durable']);
      expect.soft(answer === UNANSWERED ? unanswered : atAnswer, `${host}: P65.RS3 — when it answers, its outcome is durably admitted (held with its body, pending)`).toEqual(['pending', true]);
      const armed = typeof alarm === 'number' && alarm > sentWall && alarm <= alarmRead + 30_000;
      expect.soft(answer === UNANSWERED ? unanswered : armed ? 'armed within 30 s' : `alarm ${String(alarm)}`, `${host}: P65.RS3 — and the alarm is armed within 30 s`).toBe('armed within 30 s');
      expect.soft([outcomeRows(m, s, identity.eventId).map(row => row.outcome_id), admissionsOf(m, s.subject).find(a => a.id === operation)?.meta.receipt.source.state],
        `${host}: P65.RS3 — after release and drain, one outcome row and its operation recovered`).toEqual([[outcomeId], 'recovered']);
    }, 60_000);

    it(`host (${host}): LOCK — no new remote call before the answer: with 20 ms added to every remote binding call, an add to bag and a click make, per binding and method, no more remote calls before their answer than the base`, async () => {
      const { m, app, s, page } = await outcomeWorld(host, 'p65-rs3-latency');
      const lever = remoteLatency(m);
      const beyond: Array<[string, string[]]> = [];
      for (const [label, event] of [['add to bag', BUY_BOX], ['click', clickOf(page, firstModule(page))]] as const) {
        const first = lever.calls.length;
        lever.set(20);
        let answer: Wire;
        try { answer = await actionWire(app, s, event); } finally { lever.set(0); }
        const before = lever.calls.slice(first).filter(call => call.at <= answer.answeredAt).map(call => `${call.binding}.${call.method}`);
        await settleAll(m, app);
        expect(answer.status, `${host}: PRECONDITION — the ${label} is accepted (${show(answer.body)})`).toBe(200);
        beyond.push([label, beyondBase(host, before)]);
      }
      expect.soft(beyond, `${host}: P65.RS3 — no remote call before the answer beyond the base's`).toEqual([['add to bag', []], ['click', []]]);
    }, 60_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — fail-closed: an add to bag of a product the tenant does not hold (dropped, W35 A1: "no outcome") whose shopper object resets right after its behaviour capture's durable admission leaves, after the alarm, its one behaviour record and no outcome record`, async () => {
      const run = await resetRun(host, 'p65-rs3-dropped', 'dropped add to bag');
      const { m, s, event, identity } = run;
      preconditions(host, run);
      expect.soft([behaviourRows(m, s, identity.eventId).map(behaviourContent), outcomeRows(m, s, identity.eventId).length],
        `${host}: P65.RS3 — a dropped event's reset leaves its behaviour record and no outcome record, whatever carried it`).toEqual([[expectedBehaviour(s, event, identity)], 0]);
    }, 60_000);
  }

  // R-P129 (1), R-P124(1): behaviour first. The action route's own comment at the behaviour capture (realtime.ts
  // `captureBehavior`): "Actual accepted action source is admitted durably BEFORE profile, queue, learning or external side
  // effects; a downstream refusal cannot erase the original event identity". Measured by the specification review
  // (_evidence/parity-step3/S13/reviewer/logs/probe-behaviour-first-*.log): one behaviour row today and under the carried
  // outcome, none under the one-transaction admission that waits for the engine.
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — behaviour first (R-P124(1)): an add to bag whose engine fails once keeps its behaviour record, admitted before the engine ran`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p65-rs3-behaviour-first');
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
      const fault = engineFailsOnce(host);
      let answer: Wire;
      try {
        answer = await actionWire(app, s, BUY_BOX, identity);
        await settleAll(m, app);
      } finally { fault.restore(); }
      await m.drainLedger();
      expect(fault.failed, `${host}: PRECONDITION — the engine failed once on the add to bag (answered ${answer.status} ${show(answer.body)})`).toBe(1);
      expect.soft(behaviourRows(m, s, identity.eventId).map(behaviourContent), `${host}: P65.RS3 — behaviour first: the add to bag whose engine failed keeps its behaviour record`)
        .toEqual([expectedBehaviour(s, BUY_BOX, identity)]);
    }, 60_000);
  }

  // R-P129 (2): fail-closed for every drop the engine decides (unknown_product above, duplicate_order here: P40, R-P48, the
  // engine's own `isDuplicateOrder` on the shopper's stored order memory, on both hosts), not only the one decided from the catalogue.
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — fail-closed for every drop the engine decides: a second purchase of an order (dropped, P40: duplicate_order) whose shopper object resets right after its behaviour capture's durable admission leaves, after the alarm, its behaviour record and no outcome record`, async () => {
      const world = await outcomeWorld(host, 'p65-rs3-duplicate');
      const { m, app, s } = world;
      const order = `p65-order-${crypto.randomUUID()}`;
      const first = { eventId: crypto.randomUUID(), timestamp: Date.now() - 3 }, again = { eventId: crypto.randomUUID(), timestamp: Date.now() - 2 };
      const firstAnswer = await actionWire(app, s, purchaseOf(order), first);
      await settleAll(m, app);
      const againAnswer = await actionWire(app, s, purchaseOf(order), again);
      await settleAll(m, app);
      await m.drainLedger();
      expect([firstAnswer.status, firstAnswer.body.dropped ?? null, outcomeRows(m, s, first.eventId).length, againAnswer.status, againAnswer.body.dropped ?? null, outcomeRows(m, s, again.eventId).length],
        `${host}: PRECONDITION — the order's first purchase is accepted with its outcome; a second purchase of it is dropped as duplicate_order (P40) with none (${show(againAnswer.body)})`)
        .toEqual([200, null, 1, 200, 'duplicate_order', 0]);
      await clearShopperAlarm(m, s.subject);
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
      const run = await resetRunOn(world, purchaseOf(order), identity);
      preconditions(host, run);
      expect.soft([behaviourRows(m, s, identity.eventId).map(row => [row.record_id, row.event, row.ts, (row.data as { orderId?: unknown } | undefined)?.orderId]), outcomeRows(m, s, identity.eventId).length],
        `${host}: P65.RS3 — a duplicate order's reset leaves its behaviour record and no outcome record, whatever carried it`)
        .toEqual([[[`${TENANT}:${ts36(identity.timestamp)}:${s.subject}:behavior:${identity.eventId}`, 'purchase', identity.timestamp, order]], 0]);
    }, 90_000);
  }

  // R-P129 (5), R-P126: a carried outcome is never counted lost. A lock on P64's lost-evidence counter across P65's mechanism,
  // which RS1's observable (the records after the alarm) does not include: written here, beside the other locks P65 keeps.
  // Two placements of the reset: RS1's (right after the behaviour capture's admission) and the analyst's own (inside the
  // outcome's own admission transaction, before it commits: OUT-K3 case b1), where a carried outcome's own admission fails.
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a carried outcome is never counted lost (R-P126): after a reset right after the add to bag's behaviour capture admission, and after a reset inside its outcome's own admission transaction, and the alarm, the tenant's producerFailed counter is unchanged`, async () => {
      const after = await outcomeWorld(host, 'p65-rs3-uncounted-after');
      const beforeAfter = (await evidenceLoss(after.m)).producerFailed;
      const runAfter = await resetRunOn(after, BUY_BOX);
      preconditions(host, runAfter);
      const inside = await outcomeWorld(host, 'p65-rs3-uncounted-inside');
      const beforeInside = (await evidenceLoss(inside.m)).producerFailed;
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
      const outcomeId = outcomeFromAction({ ...BUY_BOX, userId: inside.s.subject, sessionId: inside.s.grant.sessionId, eventId: identity.eventId, eventIdSource: 'provided', timestamp: identity.timestamp }, TENANT)!.outcome_id;
      const operation = await recoveryDigest({ kind: 'outcome', tenant: TENANT, subject: inside.s.subject, ids: [outcomeId] });
      const runInside = await resetRunOn(inside, BUY_BOX, identity, { killBeforeCommitOf: `recoveryOperation:${operation}` });
      expect(runInside.fired, `${host}: PRECONDITION — the outcome's own admission was attempted and the reset fell inside it (answered ${runInside.answer === UNANSWERED ? UNANSWERED : runInside.answer.status})`).toBe(true);
      expect.soft([(await evidenceLoss(after.m)).producerFailed - beforeAfter, (await evidenceLoss(inside.m)).producerFailed - beforeInside],
        `${host}: P65.RS3 — producerFailed unchanged after either reset and the alarm (the outcome after the behaviour's reset; after the reset inside its own admission)`).toEqual([0, 0]);
    }, 90_000);
  }

  // S16 additive lock (the P65 review, finding 3, mutant M5c): an outcome whose OWN admission is refused (before the store)
  // after the behaviour capture carried it is written by the alarm and never counted lost (R-P126).
  for (const host of HOSTS) {
    it(`host (${host}): LOCK (S16, P65 review F3, R-P126) — when admitOwnedRecovery refuses the outcome's own admission, the carried outcome is written by the alarm and nothing is counted lost: one outcome row after the alarm, producerFailed unchanged`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p65-rs3-refused-own-admission');
      const before = (await evidenceLoss(m)).producerFailed;
      const refusal = refuseOutcomeAdmissionOnce();
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
      let answered: Wire;
      try { answered = await actionWire(app, s, BUY_BOX, identity); await settleAll(m, app); } finally { refusal.restore(); }
      expect([refusal.refused, answered.status], `${host}: PRECONDITION — the outcome's own admission was refused once and the add to bag answered (${show(answered.body)})`).toEqual([1, 200]);
      const object = m.shoppers.get([...m.shoppers.keys()].find(name => name.includes(s.subject))!)!.object as unknown as ShopperReflex;
      await object.alarm();
      await settleAll(m, app);
      await m.drainLedger();
      expect.soft([outcomeRows(m, s, identity.eventId).length, (await evidenceLoss(m)).producerFailed - before], `${host}: P65.RS3 (S16) — the alarm wrote the carried outcome; nothing counted lost`).toEqual([1, 0]);
    }, 60_000);
  }

  // S16 additive lock (the P65 review, finding 4, mutants M2a and M12): the learn document is read once for an outcome, by
  // the route's preparation: an ordinary add to bag reads it exactly once through its effects, and the alarm that writes a
  // carried outcome reads it never (it admits the input the route prepared).
  for (const host of HOSTS) {
    it(`host (${host}): LOCK (S16, P65 review F4) — the learn document is read once per outcome: an ordinary add to bag reads it exactly once through its effects, and the alarm that writes a carried outcome reads it never`, async () => {
      const counter = countLearnReads();
      try {
        const ordinary = await outcomeWorld(host, 'p65-rs3-learn-reads');
        const start = counter.reads;
        const answered = await actionWire(ordinary.app, ordinary.s, BUY_BOX, { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 });
        await settleAll(ordinary.m, ordinary.app);
        const routeReads = counter.reads - start;
        expect(answered.status, `${host}: PRECONDITION — the ordinary add to bag is accepted`).toBe(200);
        const world = await outcomeWorld(host, 'p65-rs3-learn-reads-alarm');
        const { m, app, s } = world;
        const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
        const reset = resettable(m, s.subject, identity.eventId);
        await within(actionWire(app, s, BUY_BOX, identity), 20_000);
        await settleAll(m, app);
        const rebuilt = reset.revive();
        const beforeAlarm = counter.reads;
        await rebuilt.alarm();
        await settleAll(m, app);
        const alarmReads = counter.reads - beforeAlarm;
        await m.drainLedger();
        expect(outcomeRows(m, s, identity.eventId).length, `${host}: PRECONDITION (P65.RS1) — the alarm wrote the carried outcome`).toBe(1);
        expect.soft({ routeReads, alarmReads }, `${host}: P65.RS3 (S16) — one learn read by the route, none by the alarm`).toEqual({ routeReads: 1, alarmReads: 0 });
      } finally { counter.restore(); }
    }, 90_000);
  }

  // S16 additive lock (the P65 review, finding 5, mutant M6a): the withdrawal of a carried outcome is AWAITED by the route,
  // never retained work of the owner: when it fails (the object's storage refusing it once), the route keeps its answer (the
  // drop answered as today) and leaves the carried copy to the alarm, which re-decides the drop; a retained withdrawal's
  // rejection would fail that answer instead (src/identity/sessionAuthority.ts runOwnerOperation: a retained rejection fails a
  // 2xx answer).
  for (const host of HOSTS) {
    it(`host (${host}): LOCK (S16, P65 review F5) — the withdrawal of a dropped event's carried outcome is awaited, not retained: when it fails once, the add to bag is still answered 200 dropped as unknown_product, and after the alarm no outcome is written`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p65-rs3-withdrawal-awaited');
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() - 1 };
      const recordId = `${TENANT}:${ts36(identity.timestamp)}:${s.subject}:behavior:${identity.eventId}`;
      const operation = await recoveryDigest({ kind: 'behavior', tenant: TENANT, subject: s.subject, ids: [recordId] });
      const lever = failWithdrawalOnce(m, s.subject, operation);
      let answered: Wire;
      try { answered = await actionWire(app, s, UNKNOWN_ADD, identity); await settleAll(m, app); } finally { lever.restore(); }
      expect(lever.failed, `${host}: PRECONDITION — the withdrawal of the carried outcome was attempted and failed once`).toBe(1);
      expect.soft([answered.status, answered.body.dropped ?? null], `${host}: P65.RS3 (S16) — the route keeps its answer (${show(answered.body)})`).toEqual([200, 'unknown_product']);
      const object = m.shoppers.get([...m.shoppers.keys()].find(name => name.includes(s.subject))!)!.object as unknown as ShopperReflex;
      await object.alarm();
      await settleAll(m, app);
      await m.drainLedger();
      expect.soft(outcomeRows(m, s, identity.eventId).length, `${host}: P65.RS3 (S16) — the alarm re-decides the drop: no outcome`).toBe(0);
    }, 60_000);
  }

  it('CONTROL: W06\'s digest of a row changes with its content; the held queue answers nothing until released', async () => {
    const s = { subject: 'vis-control' } as Shopper;
    const row = { record_id: `${TENANT}:0:vis-control:behavior:x`, brand: TENANT, event: 'add_to_cart', retention: { a: 1 } };
    const [a, b, c] = await Promise.all([w06Of(s, 'behavior', row), w06Of(s, 'behavior', { ...row, retention: { a: 2 } }), w06Of(s, 'behavior', { ...row, event: 'purchase' })]);
    expect([a.digest === b.digest, a.digest === c.digest], 'CONTROL — processing stamps are left out of the digest; content is not').toEqual([true, false]);
    const { m } = await outcomeWorld('session', 'p65-rs3-control');
    const held = holdQueue(m);
    const send = (m.env.EVENT_QUEUE as unknown as { send: (body: unknown) => Promise<void> }).send({ control: 'p65-rs3' });
    expect(await within(send, 100), 'CONTROL — while held, a queue send is not answered').toBe(UNANSWERED);
    held.release();
    await send;
  }, 60_000);
});
