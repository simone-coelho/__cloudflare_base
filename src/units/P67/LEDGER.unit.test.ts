// src/units/P67/LEDGER.unit.test.ts
// P67 under the Closure Ledger: the tests for the LOCAL criteria OM1-OM2 of the P67 work
// order (the order-memory programme of amendment 8, ticket P67 "The alarm's carried purchase
// records its order"). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-8/BTI-Parity-Amendment-2026-10-20b.md, section 2, P67):
//   "P67 — the alarm's carried purchase records its order. On both hosts, when the alarm
//   writes a carried purchase outcome it records the order as purchased exactly as the
//   engine's own path does (the object host through its own order memory, the session host
//   through the session record), so a later purchase of the same order under a new event id
//   is dropped as `duplicate_order`; the ordinary path's one-purchase-per-order rule (P40),
//   P65's answers (RS1–RS3), W06's digests and replay are unchanged; no new remote call
//   before any answer; the record the alarm writes carries no stamp into any digest. The
//   specification batch S16 also adds the additive locks of finding (b) to the P63, P64 and
//   P65 unit files (test-only, reviewed honest, landing with P67's build)."
// The work order (docs/parity/order-memory/program.json, P67), remaining work: "When the alarm
// admits a carried purchase outcome, record the order as the engine's own path does: the
// object host through its order memory (withOrder, src/reflex/core.ts), the session host
// through a write of the session record from the alarm via SessionManager (a new grant)."
// and "Kit 02 :99 states it."
//
// One `describe('unit:P67.<criterion>')` per LOCAL criterion, both shopper hosts, in process.
// Expected values come from the work order, the amendment, the reproduction it cites (the P65
// delivery review, _evidence/parity-step3/P65/reviewer/REPORT.md "Order-memory gap", its probe
// _evidence/parity-step3/S13/reviewer-p65/scripts/probe/rvw.cases.test.ts `order-gap`) and the
// engine's own rule, never from what the engine answers today:
//   · P40 (R-P48): a purchase is unique per order for the shopper; a second purchase naming an
//     order the shopper's state recorded under another event is answered 200 with
//     `dropped: 'duplicate_order'` and writes no outcome; the recording event delivered again
//     is not a second purchase (src/reflex/core.ts `isDuplicateOrder`, `withOrder`; the
//     engine's doors in ShopperReflex.ts `ingest` and RealtimeSegmentEngine.ts);
//   · P65 (R-P124): a purchase whose object resets right after its behaviour capture's durable
//     admission carries its outcome in that admission, and the alarm writes it
//     (src/ledger/recovery.ts `settleCarriedOutcome`), unless the engine would drop it;
//   · W06: an operation's id `recoveryDigest({ kind, tenant, subject, ids })` and its source
//     digest over its rows without their processing stamps (recovery.ts `sourceOf`).
//
// THE READINGS THIS FILE RULES (one representation with P65, src/units/P65/LEDGER.unit.test.ts):
//   · the reset: src/units/_parity10.ts `resettable`, placed right after the purchase's
//     behaviour capture's durable admission (P65.RS1's placement), the object rebuilt over the
//     same storage and its alarm, seen armed, fired;
//   · the purchase: the kit's purchase payload (docs/kit/03-payload-schemas.md; P40's
//     `kitPurchase`, P65's `purchaseOf`) for the quilted Tabby, naming its order, client times
//     in the past (admitted exactly as given);
//   · OM1: after the reset and the alarm (which wrote the first purchase's outcome), a purchase
//     of the same order under a new event id is answered 200 `dropped: 'duplicate_order'`, and
//     the ledger holds exactly one outcome record for the order. MEASURED TODAY at 8d07696f on
//     both hosts (_evidence/parity-step3/S16/specifier/logs/): the second purchase is answered
//     200 with its outcome and the ledger holds two, the review's reproduction: RED.
//     CONTROL (green today, the review's own controls): a purchase of the same order under a
//     new id sent after the reset and BEFORE the alarm leaves one outcome record (the alarm
//     re-decides the carried copy a duplicate, P65).
//   · OM2 LOCKS, green at specification:
//       P40's ordinary rule: with no reset, a second purchase of an order is dropped as
//       `duplicate_order` and the ledger holds one outcome record for it;
//       W06 and the replay after the alarm: the outcome the alarm wrote is the route's own
//       (records.ts `outcomeFromAction` with the visitor's experiment block, without its
//       processing stamps), the behaviour record is behavior.ts's, each operation of the event is
//       under W06's id with the source digest of its stored row, recovered; the same purchase
//       re-sent (same id and time) after the alarm is not a second purchase: answered 200 without
//       a `dropped` member, its behaviour capture `recovered`, one behaviour row and one outcome
//       row. "The record the alarm writes carries no stamp into any digest": the outcome row's
//       content above, and the operations' digests, are those a build without the order memory
//       writes;
//       no new remote call before any answer: with 20 ms added to every remote binding call, an
//       ordinary purchase makes, per binding and method, no more remote calls before its answer
//       than this ticket's base (8d07696f, three runs per host, identical: the session host
//       STORAGE.get 1, CACHE.get 11, SESSIONS.put 2; the object host STORAGE.get 1;
//       logs/probe-purchase.log);
//       P65 RS1-RS3 and P64 unchanged: their own acceptance commands, run beside this one.
//
// SKETCHES (scratch copies of 8d07696f, never committed; _evidence/parity-step3/S16/specifier/sketches/sketch-p67.py):
//   conforming (the alarm that writes a carried purchase records its order: the object host in its own
//   record, `withOrder` on `affinity.reflex`; the session host in the session record, SessionManager
//   `readRaw` / `writeBufferedSession`): every P67 unit GREEN, both hosts;
//   object-only (the object host's half alone): OM1 RED on the session host;
//   stamp (conforming, the alarm-written outcome carrying an `order_recorded` member, so into its row and
//   its W06 source digest): OM2's W06 and replay legs RED, both hosts.
//
// No new export is imported; every member read exists at this head.
//
// FIXTURE. P33 K3's world as OUT-K3 reproduced it (src/units/_parity10.ts `outcomeWorld`), as
// P64's and P65's files build it. Order identifiers are synthetic.
//
// HARNESS: src/units/_parity.ts, src/units/_parity8.ts and src/units/_parity10.ts. Imports from
// src/units/: ../_parity, ../_parity8, ../_parity10.

import { describe, expect, it } from 'vitest';

import { personalizes, storedConsent } from '@/content/consent';
import { outcomeEnrollment } from '@/content/holdout';
import type { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { outcomeFromAction, ts36 } from '@/ledger/records';
import { recoveryDigest, recoveryJSON } from '@/ledger/recovery';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';

import { BRAND, HOSTS, storedOutcomes, TENANT, type Host, type Mounted, type Shopper } from '../_parity';
import { actionWire, admissionsOf, remoteLatency, shopperHeld, storedBehavior, UNANSWERED, within, type Identity, type Wire } from '../_parity8';
import { BAG, outcomeWorld, resettable, settleAll, type OutcomeWorld } from '../_parity10';

const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);
type Event = { type: string; data: Record<string, unknown> };
/** The kit's purchase payload for the quilted Tabby, naming its order (P65's `purchaseOf`). */
const purchaseOf = (orderId: string): Event => ({ type: 'purchase', data: { orderId, value: 575, currency: 'USD', items: [{ productId: BAG, quantity: 1, price: 575 }], brand: BRAND } });
const without = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
const PROCESSING = ['retention', 'externalRetention', '_ledger_delivery'];
const behaviourRows = (m: Mounted, s: Shopper, eventId: string) => storedBehavior(m, s.subject).filter(row => row.event_id === eventId);
const outcomeRows = (m: Mounted, s: Shopper, eventIds: string[]) => storedOutcomes(m, s.subject).filter(row => eventIds.includes(String(row.event_id)));
const objectOf = (m: Mounted, s: Shopper) => m.shoppers.get(shopperObjectName(TENANT as TenantId, s.subject))!.object as unknown as ShopperReflex;
const answerOf = (answer: Wire | typeof UNANSWERED) => (answer === UNANSWERED ? UNANSWERED : `${answer.status} ${show(answer.body)}`);
const fresh = (offset: number): Identity => ({ eventId: crypto.randomUUID(), timestamp: Date.now() - offset });

/** The shopper object's alarm, fired as the platform fires it; what it threw, if anything. */
async function fireAlarm(m: Mounted, s: Shopper): Promise<string> {
  try { await objectOf(m, s).alarm(); return 'ran'; } catch (error) { return `threw ${(error as Error).message}`; }
}

/** The outcome record the route emits for the event (records.ts `outcomeFromAction` with the visitor's experiment block), without its processing stamps. */
async function expectedOutcome(m: Mounted, s: Shopper, event: Event, identity: Identity) {
  const outcome = outcomeFromAction({ ...event, userId: s.subject, sessionId: s.grant.sessionId, eventId: identity.eventId, eventIdSource: 'provided', timestamp: identity.timestamp }, TENANT)!;
  const experiment = await outcomeEnrollment(m.env, TENANT as TenantId, outcome.brand, s.subject, personalizes(storedConsent(shopperHeld(m, s.subject, 'consent'))));
  return without({ ...outcome, ...(experiment ? { experiment } : {}) }, PROCESSING);
}

/** W06's operation of a stored row: its id and the source digest of exactly that row (without its processing stamps). */
async function w06Of(s: Shopper, kind: 'behavior' | 'outcome', row: Record<string, unknown>) {
  const id = String(kind === 'behavior' ? row.record_id : row.outcome_id);
  return { id: await recoveryDigest({ kind, tenant: TENANT, subject: s.subject, ids: [id] }),
    digest: await recoveryDigest({ kind, tenant: TENANT, subject: s.subject, brand: String(row.brand), rows: [without(row, PROCESSING)] }) };
}

interface CarriedPurchase { world: OutcomeWorld; order: string; first: Identity; answer: Wire | typeof UNANSWERED }

/**
 * A purchase of a new order whose shopper object resets right after its behaviour capture's durable admission (P65.RS1's
 * placement); `beforeAlarm` runs after the object is rebuilt and before its alarm fires; then the alarm, the work settled and
 * the ledger drained. Preconditions: the reset followed the admission, the alarm was armed by it.
 */
async function carriedPurchase(host: Host, label: string, beforeAlarm?: (world: OutcomeWorld, order: string) => Promise<void>): Promise<CarriedPurchase> {
  const world = await outcomeWorld(host, label);
  const { m, app, s } = world;
  const order = `p67-order-${crypto.randomUUID()}`, first = fresh(5);
  const reset = resettable(m, s.subject, first.eventId);
  const answer = await within(actionWire(app, s, purchaseOf(order), first), 20_000);
  await settleAll(m, app);
  const armed = await reset.alarmAt();
  const rebuilt = reset.revive();
  expect([reset.state.fired, armed === null ? 'no alarm' : 'alarm armed'], `PRECONDITION (${host}): the purchase's behaviour capture was admitted and the reset followed it (answered ${answerOf(answer)})`)
    .toEqual([true, 'alarm armed']);
  if (beforeAlarm) await beforeAlarm(world, order);
  let alarm = 'ran';
  try { await rebuilt.alarm(); } catch (error) { alarm = `threw ${(error as Error).message}`; }
  await settleAll(m, app);
  await m.drainLedger();
  expect(alarm, `PRECONDITION (${host}): the rebuilt object's alarm ran`).toBe('ran');
  return { world, order, first, answer };
}

// ===========================================================================
// unit:P67.OM1 — the alarm's carried purchase records its order
// ===========================================================================

describe('unit:P67.OM1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a purchase of an order whose shopper object resets between its behaviour capture's admission and its outcome's, its outcome written by the alarm, leaves the order recorded as purchased: a later purchase of the same order under a new event id is answered 200 dropped as duplicate_order, and the ledger holds one outcome record for the order`, async () => {
      const { world: { m, app, s }, order, first } = await carriedPurchase(host, 'p67-om1');
      expect(outcomeRows(m, s, [first.eventId]).length, `${host}: PRECONDITION (P65.RS1) — the alarm wrote the first purchase's outcome`).toBe(1);
      const second = fresh(1);
      const again = await actionWire(app, s, purchaseOf(order), second);
      await settleAll(m, app);
      const alarm = await fireAlarm(m, s);
      await settleAll(m, app);
      await m.drainLedger();
      expect.soft([again.status, again.body.dropped ?? null], `${host}: P67.OM1 — the later purchase of the same order is dropped as a duplicate (${show(again.body)}; alarm ${alarm})`)
        .toEqual([200, 'duplicate_order']);
      expect.soft(outcomeRows(m, s, [first.eventId, second.eventId]).map(row => row.event_id), `${host}: P67.OM1 — the ledger holds one outcome record for the order, the first purchase's`)
        .toEqual([first.eventId]);
    }, 120_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}): CONTROL — a purchase of the same order under a new event id sent after the reset and BEFORE the alarm leaves one outcome record for the order (the alarm re-decides the carried copy a duplicate, P65)`, async () => {
      let second: Identity | undefined, again: Wire | undefined;
      const { world: { m, s }, first } = await carriedPurchase(host, 'p67-om1-before-alarm', async (world, order) => {
        second = fresh(1);
        again = await actionWire(world.app, world.s, purchaseOf(order), second);
        await settleAll(world.m, world.app);
      });
      expect(again?.status, `${host}: PRECONDITION — the purchase before the alarm is accepted (${show(again?.body)})`).toBe(200);
      expect(outcomeRows(m, s, [first.eventId, second!.eventId]).length, `${host}: CONTROL — one outcome record for the order`).toBe(1);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P67.OM2 — locks: P40's ordinary rule, W06 and the replay, the answer path
// ===========================================================================

/** The remote calls the base makes before an ordinary purchase's answer, per binding and method (8d07696f, this world; the header). */
const BASE_CALLS_BEFORE_ANSWER: Record<Host, Record<string, number>> = {
  session: { 'STORAGE.get': 1, 'CACHE.get': 11, 'SESSIONS.put': 2 },
  do: { 'STORAGE.get': 1 },
};
const beyondBase = (host: Host, calls: string[]) => Object.entries(calls.reduce<Record<string, number>>((out, call) => ({ ...out, [call]: (out[call] ?? 0) + 1 }), {}))
  .filter(([call, count]) => count > (BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0)).map(([call, count]) => `${call} ×${count} (base ${BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0})`);

describe('unit:P67.OM2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK (P40) — with no reset, a second purchase of an order under a new event id is answered 200 dropped as duplicate_order, and the ledger holds one outcome record for the order`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p67-om2-p40');
      const order = `p67-order-${crypto.randomUUID()}`, first = fresh(5), second = fresh(1);
      const one = await actionWire(app, s, purchaseOf(order), first);
      await settleAll(m, app);
      const two = await actionWire(app, s, purchaseOf(order), second);
      await settleAll(m, app);
      await m.drainLedger();
      expect([one.status, one.body.dropped ?? null], `${host}: PRECONDITION — the first purchase is accepted (${show(one.body)})`).toEqual([200, null]);
      expect.soft([two.status, two.body.dropped ?? null, outcomeRows(m, s, [first.eventId, second.eventId]).map(row => row.event_id)],
        `${host}: P67.OM2 — P40's rule: the second purchase is a duplicate, one outcome record (${show(two.body)})`).toEqual([200, 'duplicate_order', [first.eventId]]);
    }, 120_000);

    it(`host (${host}): LOCK (W06, the replay) — after the reset and the alarm, the outcome the alarm wrote is the route's own and each operation of the purchase is under W06's id with the source digest of its stored row, recovered; the same purchase re-sent (same id and time) is not a second purchase: answered 200 without a dropped member, its behaviour capture recovered, one behaviour row and one outcome row`, async () => {
      const { world: { m, app, s }, order, first } = await carriedPurchase(host, 'p67-om2-w06');
      const event = purchaseOf(order);
      const [behaviour] = behaviourRows(m, s, first.eventId), [outcome] = outcomeRows(m, s, [first.eventId]);
      expect([behaviour ? 'behaviour row' : 'none', outcome ? 'outcome row' : 'none'], `${host}: PRECONDITION (P65.RS1) — both rows are stored after the alarm`).toEqual(['behaviour row', 'outcome row']);
      expect.soft(recoveryJSON(without(outcome!, PROCESSING)), `${host}: P67.OM2 — the outcome the alarm wrote is the route's own, nothing added to it`)
        .toBe(recoveryJSON(await expectedOutcome(m, s, event, first)));
      expect.soft([behaviour!.record_id, behaviour!.event, behaviour!.ts], `${host}: P67.OM2 — the behaviour record is behavior.ts's`)
        .toEqual([`${TENANT}:${ts36(first.timestamp)}:${s.subject}:behavior:${first.eventId}`, 'purchase', first.timestamp]);
      const held = admissionsOf(m, s.subject);
      const w06 = [await w06Of(s, 'behavior', behaviour!), await w06Of(s, 'outcome', outcome!)];
      expect.soft(w06.map(({ id, digest }) => { const a = held.find(x => x.id === id); return a ? [a.meta.digest === digest, a.meta.receipt.source.state] : 'no operation under W06\'s id'; }),
        `${host}: P67.OM2 — W06's digests: each operation under its W06 id with the source digest of its stored row, recovered`).toEqual([[true, 'recovered'], [true, 'recovered']]);
      const again = await actionWire(app, s, event, first);
      await settleAll(m, app);
      await m.drainLedger();
      const receipt = (again.body.behavior as { receipt?: { source?: { state?: unknown } } } | undefined)?.receipt;
      expect.soft([again.status, again.body.dropped ?? null, receipt?.source?.state], `${host}: P67.OM2 — the same purchase re-sent is not a second purchase (${show(again.body)})`)
        .toEqual([200, null, 'recovered']);
      expect.soft([behaviourRows(m, s, first.eventId).length, outcomeRows(m, s, [first.eventId]).length], `${host}: P67.OM2 — one behaviour row and one outcome row`).toEqual([1, 1]);
    }, 120_000);

    it(`host (${host}): LOCK — no new remote call before any answer: with 20 ms added to every remote binding call, an ordinary purchase makes, per binding and method, no more remote calls before its answer than the base`, async () => {
      const { m, app, s } = await outcomeWorld(host, 'p67-om2-latency');
      const lever = remoteLatency(m), first = lever.calls.length;
      lever.set(20);
      let answer: Wire;
      try { answer = await actionWire(app, s, purchaseOf(`p67-order-${crypto.randomUUID()}`), fresh(1)); } finally { lever.set(0); }
      const before = lever.calls.slice(first).filter(call => call.at <= answer.answeredAt).map(call => `${call.binding}.${call.method}`);
      await settleAll(m, app);
      expect(answer.status, `${host}: PRECONDITION — the purchase is accepted (${show(answer.body)})`).toBe(200);
      expect.soft(beyondBase(host, before), `${host}: P67.OM2 — no remote call before the answer beyond the base's`).toEqual([]);
    }, 120_000);
  }

  it('CONTROL: a new remote call before the answer is caught; the content comparison has teeth', async () => {
    expect(beyondBase('do', ['STORAGE.get', 'CACHE.get']), 'CONTROL — a call beyond the base is named').toEqual(['CACHE.get ×1 (base 0)']);
    const row = { outcome_id: 'x', brand: TENANT, ts: 1, retention: { a: 1 } };
    expect(recoveryJSON(without({ ...row, orderRecorded: true }, PROCESSING)) === recoveryJSON(without(row, PROCESSING)), 'CONTROL — a stamp added to the row is seen').toBe(false);
  });
});
