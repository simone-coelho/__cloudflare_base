// src/units/P59/LEDGER.unit.test.ts
// P59 under the Closure Ledger: the tests for the LOCAL criteria CO1-CO3 of the P59
// work order (the acknowledgement programme of amendment 5, ticket P59 "The click's
// outcome recovery leaves the answer path"). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-5/BTI-Parity-Amendment-2026-10-19.md, section 2, P59):
//   "P59 — the click's outcome recovery leaves the answer path. `content_click`
//   (hosted p50 6.6 s on the session host) answers at admission; its outcome recovery
//   continues after the answer in the serializer; attribution and the ledger rows
//   unchanged."
// The work order's remaining work (docs/parity/acknowledgement/program.json, P59):
//   "Move the outcome recovery (realtime.ts:256-286) from retained waitUntil work to the
//   post-answer continuation."
//
// One `describe('unit:P59.<criterion>')` per LOCAL criterion, each walked on both shopper
// hosts through the parity harness. Expected values come from the work order, the
// amendment, the analysis it cites (_evidence/baseline-52/ack-latency/ANALYSIS.md,
// track-analyst at afa24293: out-of-scope note 1, "content_click is slower still (hosted
// p50 6.6 s session, 4.8 s object). Its outcome recovery sits in retained `waitUntil` work
// (`realtime.ts:256-286`), which is drained before the answer") and the engine's own
// functions, never from what the engine answers today:
//   · the mechanism the click's outcome leaves: the action route's `emitOutcome`
//     (src/routes/realtime.ts, the outcome's `p` registered with `c.executionCtx.waitUntil`,
//     which inside the shopper's owner is `retainOwnerWork`, src/identity/sessionAuthority.ts
//     `dispatchOwnedRequest`), drained by `runOwnerOperation` before the owner answers; the
//     post-answer continuation P56 built (`continueAfterOwnerAnswer`, sessionAuthority.ts),
//     entered through the shopper's own serializer (ShopperReflex.ts `serialize`);
//   · the reward row: records.ts's own `outcomeFromAction` for the click as the route calls
//     it (the admitted time, the provided event id, the shopper's session), the experiment
//     block content/holdout.ts's own `outcomeEnrollment` resolves for the visitor
//     (realtime.ts emitOutcome, W21 E1.02/E1.03), and the retention stamps retention.ts's own
//     `captureRetention` and `externalRetentionBirths` give for the outcome's time at its
//     admission time (processing time, which W06 leaves out of its source commitment,
//     src/ledger/recovery.ts `sourceOf`); compared byte for byte in the engine's canonical
//     form (`recoveryJSON`, sorted keys), without the ledger writer's delivery provenance
//     (`_ledger_delivery`);
//   · the outcome's recovery operation: its id the engine's `recoveryDigest({ kind:
//     'outcome', tenant, subject, ids: [outcome_id] })` (recovery.ts `runOwnerRecovery`),
//     its source digest `recoveryDigest(sourceOf(input))` (transcribed in
//     src/units/_parity8.ts `w06SourceOf`);
//   · attribution read as src/units/P03/LEDGER.unit.test.ts:294 and P56.AA3 read it: the
//     click credit (`s`) of the statistics objects, through `learned()`;
//   · the SDK's deadline: `ACK_DEADLINE_MS`, exported by src/sdk/core.ts since P56.
//
// THE READINGS THIS FILE RULES (one representation with P56 and P58):
//   · "Answers at admission ... while the queue send is held" (CO1): the event queue
//     (`EVENT_QUEUE`) answers no `send` or `sendBatch` until released
//     (src/units/_parity8.ts `holdQueue`); the click answers 200 with its engine answer
//     (`success: true`) and its behaviour capture durable (P58) within HOLD_BOUND_MS; the
//     wait is bounded and the hold always released. Today the click's outcome recovery
//     sends to the queue inside the retained work the owner drains before it answers, so
//     nothing answers while the send is held (measured on this harness at d1e7a33e, both
//     hosts: _evidence/parity-step3/S12/specifier/logs/probe-p59-base.log, "no answer",
//     one held send).
//   · "After release and drain ... exist once" (CO1): the hold released, every pending
//     piece of work awaited (src/units/_parity8.ts `settle`), the ledger batch written by
//     the real consumer; then exactly one reward row for the click's event id, carrying the
//     decision it names; its credit counted once, to the acknowledged module; the exposure
//     still counted once; exactly one outcome recovery operation, recovered.
//   · CO2: P56.AA2's reading for the click (customer profile, the latency lever
//     `remoteLatency` at ACK_DEADLINE_MS / 10 per remote call, set only while the click is
//     in flight). Today the click makes 26 remote calls before it answers on the session
//     host and 24 on the object host (probe-p59-base.log, at 20 ms per call); at 500 ms each
//     no answer comes within the deadline (measured: 10 calls made by then, both hosts): RED,
//     the message counts the calls made by the deadline. A
//     sketch of the work order's remaining work on a scratch copy (the outcome's work
//     handed to `continueAfterOwnerAnswer`; _evidence/parity-step3/S12/specifier/scratch/
//     sketch-p59.cjs) answers after 3 calls on the session host (STORAGE.get, two
//     SESSIONS.put) and 1 on the object host.
//   · CO3 "the order of effects", the orders a witness fixes and nothing more:
//       (a) a durable admission precedes its own effects (recovery.ts runOwnerRecovery,
//           :176 "Durable admission precedes queue, R2, ring counters or credit effects"; the
//           invariant W09.09 is named for, R-P108(1)): at every queue send the click's work
//           makes, the operation the sent body names (`recovery_id`, runOwnerRecovery
//           :167-168) is held
//           by the shopper object with its body, and each of the click's two operations
//           (its behaviour capture, its outcome) is sent once;
//       (b) "continues after the answer in the serializer": the click's outcome effects run
//           ahead of any later request of the same shopper (ShopperReflex `serialize`, FIFO;
//           sessionAuthority.ts `continueAfterOwnerAnswer` "ahead of every request that
//           reaches the owner later"): with the ring's `/outcome/prepare` door held
//           (`holdObjectDoor`) once the click's outcome reached it, a product view sent
//           next is answered only after the click's credit reached the statistics object.
//           Green today (the outcome runs inside the click's own operation) and after a
//           build that keeps the serializer; RED for an outcome run beside it.
//     NOT RULED HERE (no witness): the order between the click's behaviour capture effects
//     and its outcome effects. Today the outcome sends first (it is drained before the
//     answer, the behaviour capture's effects continue after it, P58); the work order's
//     mechanism enters the outcome's work in the serializer after the behaviour capture's
//     continuation, which P58 registers at the capture's admission before the engine runs,
//     so a build sends the behaviour first (measured on the sketch: probe2-sketch.log). The
//     one place that pins today's order is W09.09 (src/routes/realtime.sdkContract.test.ts
//     :604), listed below for the lead.
//   · "P56/P58 units unchanged": their own acceptance commands in the gate (a unit file is
//     never imported into another); this file adds no lever to src/units/_parity8.ts.
//
// THE MECHANISM IS NOT RULED BEYOND THE OBSERVABLES: an outcome durably admitted before the
// answer with its effects after it, or the whole outcome work after the answer, both satisfy
// CO1-CO3 (the sketch is the second, the work order's wording; the first would need
// src/learn/route.ts `outcomeToLearning`, outside P59's allowed paths, or a second copy of it).
//
// R10 (expectations a build of P59 changes, listed for the lead; none is edited here),
// measured with the whole suite under the sketch on a scratch copy
// (_evidence/parity-step3/S12/specifier/logs/sketch-p59-full.json: 3453 of 3479, every other
// failure the scratch's own environment — no .git for the console and seed files, re-run
// with the worktree's git objects 48/48 in sketch-p59-gitfiles.log; W40.P4's deploy leg and
// the symlinked node_modules, lesson 2026-10-08):
//   · src/routes/realtime.sdkContract.test.ts :604 and :612 (W09.09): the queue mock expects
//     two admitted operations and the outcome's send first (:604); under the sketch the
//     purchase's behaviour capture sends first and its outcome is admitted after the answer,
//     the expectation throws inside the send, `started` never resolves, and the test times
//     out at :612, where it also expects the purchase unanswered while its send is held. The
//     honest form (measured: green on the sketch, RED at d1e7a33e on :612 alone,
//     logs/w0909-r10-p59.log and w0909-r10-base.log): :604 `expect(admitted.has(
//     'recoveryOperation:' + sending)).toBe(true)` beside its body check (each send's operation
//     admitted with its body, the order left free), :612 `expect(returned).toBe(true)` (the
//     purchase answered before its effects' held send; P59).
//
// No new export is imported; every member read exists at this head.
//
// FIXTURE. P02's world (src/units/P02/LEDGER.unit.test.ts:100-105) as P56's and P58's files
// build it: the registered modules in catalogue order, the declared layout slot (K = 4,
// rendered-v1, click reward) and the recently-viewed slot; one shopper with their explicit
// choice, one page view, one product page with its page instance; the cold layout
// [grid.1, reco.1, reco.2, editorial.1], every module offered for acknowledgement; the
// first module acknowledged (its effects drained) before any click; the second never
// acknowledged. The later request of CO3 is the customer's product view (COA-CH857).
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object classes,
// both shopper hosts) and src/units/_parity8.ts (the worker's error path, the wire without a
// drain, the levers and the readers). Imports from src/units/: ../_parity, ../_parity8.

import { describe, expect, it } from 'vitest';

import { personalizes, storedConsent } from '@/content/consent';
import { outcomeEnrollment } from '@/content/holdout';
import { outcomeFromAction, type OutcomeRecord } from '@/ledger/records';
import { recoveryDigest, recoveryJSON, type RecoveryInput } from '@/ledger/recovery';
import { captureRetention, externalRetentionBirths } from '@/retention';
import { ACK_DEADLINE_MS } from '@/sdk/core';
import type { TenantId } from '@/tenancy/tenant';

import {
  declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learned, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, recentSlot, rounded, shopperOn, slotPositionOf, storedOutcomes, TENANT, VIEW_TABBY_26,
  type Decision, type Host, type Mounted, type Shopper, type Snapshot,
} from '../_parity';
import {
  ackWire, actionWire, admissionsOf, holdObjectDoor, holdQueue, remoteLatency, settle, shopperHeld, UNANSWERED, w06SourceOf, within, workerApp,
  type Identity, type Latency, type WorkerApp,
} from '../_parity8';

const DOCUMENTS = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
/** P02's cold layout (src/units/P02/LEDGER.unit.test.ts:105). */
const COLD_LAYOUT = [M.grid, M.reco1, M.reco2, M.editorial];
/** Nothing resolves a held queue send: an engine that waits on it never answers, and this bound decides. */
const HOLD_BOUND_MS = 4_000;
/** How long CO3's later request is given while the click's outcome attribution is held (an in-process action answers in tens of ms). */
const LATER_WINDOW_MS = 1_500;
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);

interface World { m: Mounted; app: WorkerApp; s: Shopper; page: Snapshot; d: Decision; other: Decision; latency?: Latency }

/** P02's world on one host, as P56's and P58's files build it, with the first module acknowledged and its effects drained. */
async function world(host: Host, label: string, options: { profile?: 'customer'; latency?: boolean } = {}): Promise<World> {
  const m = await mount(host, DOCUMENTS);
  expectPublished(m, 'P59 — the product page with its declared rendered-v1 layout slot (P02) publishes');
  // The stamps' profile, set as a stamp sets it, before the shopper exists (CO2 only; P56's header).
  if (options.profile) (m.env as unknown as Record<string, unknown>).DEPLOYMENT_PROFILE = options.profile;
  const latency = options.latency ? remoteLatency(m) : undefined;
  const app = workerApp(m);
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${host}): the shopper's page view is accepted`).toBe(200);
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `PRECONDITION (${host}): the shopper's product page is served (${show(page.body)})`).toBe(200);
  const layout = page.decisions.filter(x => x.slot === LAYOUT).sort((a, b) => a.order - b.order);
  expect(layout.map(x => x.contentId), `PRECONDITION (${host}): the cold layout (P02.A2)`).toEqual(COLD_LAYOUT);
  const [d, other] = [layout[0]!, layout[1]!];
  const ack = await ackWire(app, s, page, d);
  await settle(m, app);
  expect([ack.status, (ack.body.render as { status?: unknown } | undefined)?.status], `PRECONDITION (${host}): ${d.contentId} is acknowledged, durable (${show(ack.body)})`)
    .toEqual([200, 'durable']);
  return { m, app, s, page, d, other, ...(latency ? { latency } : {}) };
}

/** A content engagement (click) on a painted decision, in the body src/units/_parity.ts `click` sends (:486-488). */
const clickOf = (page: Snapshot, d: Decision) => ({ type: 'content_click',
  data: { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, page: page.page, position: d.order, slotPosition: slotPositionOf(page, d) } });
/** The reward record records.ts's own `outcomeFromAction` builds for the click as the action route calls it (realtime.ts emitOutcome). */
const outcomeOf = (s: Shopper, click: ReturnType<typeof clickOf>, identity: Identity): OutcomeRecord =>
  outcomeFromAction({ ...click, userId: s.subject, sessionId: s.grant.sessionId, eventId: identity.eventId, eventIdSource: 'provided', timestamp: identity.timestamp }, TENANT)!;
/** The outcome's recovery operation id (recovery.ts runOwnerRecovery), by the engine's own digest. */
const outcomeOperationOf = (s: Shopper, outcome: OutcomeRecord) => recoveryDigest({ kind: 'outcome', tenant: TENANT, subject: s.subject, ids: [outcome.outcome_id] });
const withoutDelivery = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_ledger_delivery'));

/** Every request one object binding receives from now on, by path and time (`performance.now()`); nothing is held or changed. */
function doorLog(m: Mounted, binding: 'LEARN_STATS' | 'DECISION_RING'): Array<{ path: string; at: number }> {
  const log: Array<{ path: string; at: number }> = [];
  const namespace = m.env[binding] as unknown as { get: (id: unknown) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } };
  const get = namespace.get.bind(namespace);
  namespace.get = (id: unknown) => {
    const stub = get(id);
    return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      log.push({ path: new URL(input instanceof Request ? input.url : String(input)).pathname, at: performance.now() });
      return stub.fetch(input, init);
    } };
  };
  return log;
}

interface Sent { operation: string; admitted: boolean }
/** Every body sent to the event queue from now on, with whether the shopper object held the operation it names, body and all, at the send. */
function sendsAgainstAdmissions(m: Mounted, subject: string): Sent[] {
  const sent: Sent[] = [];
  const original = m.env.EVENT_QUEUE as unknown as { send: (body: unknown, options?: unknown) => Promise<void>; sendBatch: (messages: Array<{ body: unknown }>, options?: unknown) => Promise<void> };
  const note = (body: unknown) => {
    const operation = String((body as { recovery_id?: unknown }).recovery_id ?? 'no recovery_id');
    const held = admissionsOf(m, subject).find(a => a.id === operation);
    sent.push({ operation, admitted: !!held && held.keys.some(key => key.startsWith(`recoveryBody:${operation}:`)) });
  };
  m.env.EVENT_QUEUE = {
    send: async (body: unknown, options?: unknown) => { note(body); return original.send(body, options); },
    sendBatch: async (messages: Array<{ body: unknown }>, options?: unknown) => { for (const message of messages) note(message.body); return original.sendBatch(messages, options); },
  } as unknown as Mounted['env']['EVENT_QUEUE'];
  return sent;
}

// ===========================================================================
// unit:P59.CO1 — the click answers while its outcome's queue send is held; the outcome follows
// ===========================================================================

describe('unit:P59.CO1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): while the queue send is held unresolved, a content_click on an acknowledged decision answers 200 with its engine answer and its behaviour capture durable; after release and drain exactly one reward row, the click's, carries the decision, its credit is counted once to the acknowledged module, and one outcome recovery operation exists, recovered`, async () => {
      const { m, app, s, page, d } = await world(host, 'p59-co1');
      const click = clickOf(page, d), identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const outcome = outcomeOf(s, click, identity);
      const held = holdQueue(m);
      const sent = actionWire(app, s, click, identity);
      let answer: Awaited<typeof sent> | typeof UNANSWERED = UNANSWERED;
      try { answer = await within(sent, HOLD_BOUND_MS); } finally { held.release(); }
      const eventual = await sent;
      await settle(m, app);
      await m.drainLedger();
      const unanswered = `${UNANSWERED} within ${HOLD_BOUND_MS} ms while the queue send was held (${held.sends} held send(s); answered ${eventual.status} only after its release)`;
      expect.soft(answer === UNANSWERED ? unanswered : [answer.status, answer.body.success, (answer.body.behavior as { status?: unknown } | undefined)?.status],
        `${host}: P59.CO1 — the content_click answers 200 at admission, its engine answer and its behaviour capture durable, while its outcome's queue send is held (its outcome recovery continues after the answer)`)
        .toEqual([200, true, 'durable']);
      const rows = storedOutcomes(m, s.subject).filter(row => row.event_id === identity.eventId);
      expect.soft(rows.map(row => [row.outcome_id, row.decision_id]), `${host}: P59.CO1 — after release and drain, exactly one reward row, the click's, carrying the decision it names`)
        .toEqual([[outcome.outcome_id, d.decisionId]]);
      const state = await learned(m);
      expect.soft([rounded(state, 's'), rounded(state, 'n')], `${host}: P59.CO1 — its credit counted once, to the acknowledged module (attribution read as P03/LEDGER.unit.test.ts:294), the exposure still once`)
        .toEqual([{ [d.contentId]: 1 }, { [d.contentId]: 1 }]);
      const operation = await outcomeOperationOf(s, outcome);
      expect.soft(admissionsOf(m, s.subject).filter(a => a.id === operation || a.payload?.input.kind === 'outcome').map(a => [a.id, a.meta.receipt.source.state]),
        `${host}: P59.CO1 — one outcome recovery operation, the click's (recovery.ts runOwnerRecovery's id), recovered`).toEqual([[operation, 'recovered']]);
    }, 60_000);
  }

  it('CONTROL: the held queue answers no send until released, and the expectation refuses the answer the engine gives today (none while the send is held)', async () => {
    const m = await mount('session', DOCUMENTS);
    const held = holdQueue(m);
    const send = (m.env.EVENT_QUEUE as unknown as { send: (body: unknown) => Promise<void> }).send({ control: 'p59-co1' });
    expect(await within(send, 100), 'CONTROL — while held, a queue send is not answered').toBe(UNANSWERED);
    held.release();
    await send;
    expect(m.queued.at(-1), 'CONTROL — once released, the held send reaches the queue the harness built').toEqual({ control: 'p59-co1' });
    // Today's answer while the send is held (probe-p59-base.log, both hosts): none.
    expect(() => expect(`${UNANSWERED} within ${HOLD_BOUND_MS} ms`).toEqual([200, true, 'durable']), 'CONTROL — no answer does not satisfy CO1').toThrow();
  });
});

// ===========================================================================
// unit:P59.CO2 — under one tenth of the SDK's deadline per remote call, the click answers in time
// ===========================================================================

describe('unit:P59.CO2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with one tenth of ACK_DEADLINE_MS added to every remote binding call, a content_click on an acknowledged decision answers 200 in under ACK_DEADLINE_MS (today 24 to 26 remote calls before the answer)`, async () => {
      const perCall = ACK_DEADLINE_MS / 10;
      const { m, app, s, page, d, latency } = await world(host, 'p59-co2', { profile: 'customer', latency: true });
      const lever = latency!;
      const first = lever.calls.length;
      lever.set(perCall);
      let answer: Awaited<ReturnType<typeof actionWire>> | typeof UNANSWERED = UNANSWERED, byDeadline = 0;
      let eventual: Awaited<ReturnType<typeof actionWire>>;
      const sent = actionWire(app, s, clickOf(page, d));
      try { answer = await within(sent, ACK_DEADLINE_MS); byDeadline = lever.calls.length - first; }
      finally { lever.set(0); eventual = await sent; await settle(m, app); }
      // Only the calls made before the answer, or before the deadline passed without one (R-P101).
      const made = answer === UNANSWERED ? byDeadline : lever.calls.slice(first).filter(call => call.at <= answer.answeredAt).length;
      const elapsed = answer === UNANSWERED ? Infinity : answer.answeredAt - answer.sentAt;
      expect.soft(elapsed, `${host}: P59.CO2 — the content_click answers in under ${ACK_DEADLINE_MS} ms with ${perCall} ms on every remote call: ${answer === UNANSWERED
        ? `${UNANSWERED} within the deadline; ${made} remote calls made before it passed (${lever.calls.slice(first, first + made).map(call => call.binding + '.' + call.method).join(' ')})`
        : `answered in ${Math.round(elapsed)} ms after ${made} remote calls`}`).toBeLessThan(ACK_DEADLINE_MS);
      expect.soft([eventual.status, eventual.body.success], `${host}: P59.CO2 — and the answer is the engine's (${show(eventual.body)})`).toEqual([200, true]);
    }, 60_000);
  }

  it('CONTROL: the latency lever delays and records a remote call', async () => {
    const m = await mount('do', DOCUMENTS);
    const lever = remoteLatency(m);
    lever.set(200);
    const start = performance.now();
    await m.storage.get('control/p59-co2');
    const took = performance.now() - start;
    lever.set(0);
    expect([took >= 195, lever.calls.at(-1)?.binding, lever.calls.at(-1)?.method], `CONTROL — one R2 read under a 200 ms lever takes at least 200 ms (${Math.round(took)} ms) and is recorded`)
      .toEqual([true, 'STORAGE', 'get']);
  });
});

// ===========================================================================
// unit:P59.CO3 — locks: attribution, the reward row, the order of effects
// ===========================================================================

describe('unit:P59.CO3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — attribution to the decision: a click on the acknowledged module is credited to it, and a click on a module returned but never acknowledged is credited nothing`, async () => {
      const { m, app, s, page, d, other } = await world(host, 'p59-co3-attribution');
      const clicked = await actionWire(app, s, clickOf(page, d));
      await settle(m, app);
      const stray = await actionWire(app, s, clickOf(page, other));
      await settle(m, app);
      await m.drainLedger();
      expect([clicked.status, stray.status], `${host}: PRECONDITION — both clicks are accepted (${show(clicked.body)} ${show(stray.body)})`).toEqual([200, 200]);
      expect.soft(rounded(await learned(m), 's'), `${host}: P59.CO3 — the click on ${d.contentId} is credited to it, the click on ${other.contentId} (never acknowledged) to nothing`)
        .toEqual({ [d.contentId]: 1 });
      // CONTROL: the stray click was recorded, so its missing credit is attribution's and not a lost event.
      expect(storedOutcomes(m, s.subject).map(row => row.decision_id).sort(), `${host}: CONTROL — both clicks are in the ledger, each naming its decision`)
        .toEqual([d.decisionId, other.decisionId].sort());
    }, 60_000);

    it(`host (${host}): LOCK — the reward row byte for byte: the click's one ledger row is records.ts's outcomeFromAction for the click with the experiment block outcomeEnrollment resolves and the retention stamps of its admission, and its recovery operation is W06's (id and source digest by the engine's own functions)`, async () => {
      const { m, app, s, page, d } = await world(host, 'p59-co3-row');
      const click = clickOf(page, d), identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const answer = await actionWire(app, s, click, identity);
      await settle(m, app);
      await m.drainLedger();
      expect(answer.status, `${host}: PRECONDITION — the click is accepted (${show(answer.body)})`).toBe(200);
      const rows = storedOutcomes(m, s.subject).filter(row => row.event_id === identity.eventId);
      expect(rows.length, `${host}: PRECONDITION — one reward row for the click`).toBe(1);
      const row = rows[0]!;
      const consent = storedConsent(shopperHeld(m, s.subject, 'consent'));
      const outcome = outcomeOf(s, click, identity);
      const experiment = await outcomeEnrollment(m.env, TENANT as TenantId, outcome.brand, s.subject, personalizes(consent));
      // Processing time: the moment the row's retention was admitted, read off the row itself (W06 leaves it out of its commitment).
      const admittedAt = (row.retention as { ledger?: { bornAt?: number } } | undefined)?.ledger?.bornAt ?? Number.NaN;
      const expected = { ...outcome, ...(experiment ? { experiment } : {}),
        retention: captureRetention(m.env, TENANT, outcome.ts, admittedAt), externalRetention: externalRetentionBirths(m.env, TENANT, outcome.ts, admittedAt) };
      expect.soft(recoveryJSON(withoutDelivery(row)), `${host}: P59.CO3 — the reward row is outcomeFromAction's for the click (records.ts), with outcomeEnrollment's experiment block and its retention stamps, byte for byte in recoveryJSON's form`)
        .toBe(recoveryJSON(expected));
      const operation = await outcomeOperationOf(s, outcome);
      const admitted = admissionsOf(m, s.subject).find(a => a.id === operation);
      expect.soft(admitted?.payload ? [admitted.meta.digest === await recoveryDigest(w06SourceOf(admitted.payload.input)), (admitted.payload.input as Extract<RecoveryInput, { kind: 'outcome' }>).outcome.outcome_id]
        : 'no outcome recovery operation under its W06 id', `${host}: P59.CO3 — the outcome's recovery operation is W06's: its id recoveryDigest({ kind, tenant, subject, ids }) and its source digest recoveryDigest(sourceOf(input))`)
        .toEqual([true, outcome.outcome_id]);
      // CONTROL: the comparison has teeth — the same click at another time is another row.
      expect(recoveryJSON(withoutDelivery(row)) === recoveryJSON({ ...expected, ...outcomeOf(s, click, { ...identity, timestamp: identity.timestamp - 1000 }) }),
        `${host}: CONTROL — the same click at another time is not this row`).toBe(false);
    }, 60_000);

    it(`host (${host}): LOCK — the order of effects: at every queue send of the click's work the operation it names is held with its body (admission precedes its own effects), each of the click's two operations is sent once, and the click's outcome effects run ahead of the shopper's next request (a product view is answered only after the click's credit reached the statistics object)`, async () => {
      const { m, app, s, page, d } = await world(host, 'p59-co3-order');
      const sends = sendsAgainstAdmissions(m, s.subject);
      const stats = doorLog(m, 'LEARN_STATS');
      const prepare = holdObjectDoor(m, 'DECISION_RING', '/outcome/prepare');
      const click = clickOf(page, d), identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const clicked = actionWire(app, s, click, identity);
      // The click's outcome reaches the ring's prepare door (recovery.ts resumeOwnerRecovery, outcome) and is held there.
      for (let waited = 0; prepare.requests === 0 && waited < HOLD_BOUND_MS; waited += 10) await new Promise(resolve => setTimeout(resolve, 10));
      const reached = prepare.requests;
      const later = actionWire(app, s, VIEW_TABBY_26);
      await within(later, LATER_WINDOW_MS);
      prepare.release();
      const [clickAnswer, laterAnswer] = await Promise.all([clicked, later]);
      await settle(m, app);
      expect(reached, `${host}: PRECONDITION — the click's outcome attribution reaches the ring's prepare door`).toBe(1);
      expect([clickAnswer.status, laterAnswer.status], `${host}: PRECONDITION — the click and the product view are accepted (${show(clickAnswer.body)} ${show(laterAnswer.body)})`).toEqual([200, 200]);

      const outcomeOperation = await outcomeOperationOf(s, outcomeOf(s, click, identity));
      const behaviorOperation = (clickAnswer.body.behavior as { receipt?: { operation?: string } } | undefined)?.receipt?.operation ?? 'no behaviour receipt';
      const own = sends.filter(sent => sent.operation === outcomeOperation || sent.operation === behaviorOperation);
      expect.soft(own.filter(sent => !sent.admitted).map(sent => sent.operation), `${host}: P59.CO3 — every queue send of the click's work names an operation the shopper object holds with its body at the send (recovery.ts runOwnerRecovery :176)`)
        .toEqual([]);
      expect.soft(own.map(sent => sent.operation).sort(), `${host}: P59.CO3 — each of the click's two operations, its behaviour capture and its outcome, is sent once`)
        .toEqual([behaviorOperation, outcomeOperation].sort());
      const credit = stats.find(call => call.path === '/credits');
      expect.soft(credit ? (credit.at < laterAnswer.answeredAt ? 'credited before the next request answered'
        : `the next request answered ${Math.round(credit.at - laterAnswer.answeredAt)} ms before the click's credit`) : 'the click was never credited',
      `${host}: P59.CO3 — the click's outcome effects run in the shopper's serializer, ahead of the shopper's next request`).toBe('credited before the next request answered');
      expect.soft(rounded(await learned(m), 's'), `${host}: P59.CO3 — and the click is credited to the acknowledged module once`).toEqual({ [d.contentId]: 1 });
    }, 60_000);
  }

  it('CONTROL: a queue send naming an operation the shopper object does not hold is recorded as not admitted; the door log records a request without holding it; the held prepare door holds only that door until released', async () => {
    const m = await mount('session', DOCUMENTS);
    const sends = sendsAgainstAdmissions(m, 'control-p59-co3');
    await (m.env.EVENT_QUEUE as unknown as { sendBatch: (messages: Array<{ body: unknown }>) => Promise<void> }).sendBatch([{ body: { recovery_id: 'f'.repeat(64) } }]);
    expect(sends, 'CONTROL — a send whose operation is not held is recorded as not admitted').toEqual([{ operation: 'f'.repeat(64), admitted: false }]);
    const log = doorLog(m, 'LEARN_STATS');
    const stats = m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName('control-p59-co3'));
    const health = await within(stats.fetch('https://learn/snapshot', { method: 'POST' }), 2_000);
    expect([health === UNANSWERED ? UNANSWERED : 'answered', log.map(call => call.path)], 'CONTROL — the logged request is answered and recorded').toEqual(['answered', ['/snapshot']]);
    const prepare = holdObjectDoor(m, 'DECISION_RING', '/outcome/prepare');
    const ring = m.env.DECISION_RING!.get(m.env.DECISION_RING!.idFromName('control-p59-co3'));
    const held = ring.fetch('https://learn/outcome/prepare', { method: 'POST', body: '{}' });
    expect(await within(held, 100), 'CONTROL — while held, the prepare door is not answered').toBe(UNANSWERED);
    const recent = await within(ring.fetch('https://learn/recent'), 2_000);
    expect(recent === UNANSWERED ? UNANSWERED : 'answered', 'CONTROL — another door of the same ring answers').toBe('answered');
    prepare.release();
    expect(await within(held, 2_000) === UNANSWERED ? UNANSWERED : 'answered', 'CONTROL — once released, the prepare request reaches the ring').toBe('answered');
  });
});
