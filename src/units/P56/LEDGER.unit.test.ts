// src/units/P56/LEDGER.unit.test.ts
// P56 under the Closure Ledger: the tests for the LOCAL criteria AA1-AA4 of the P56
// work order (the acknowledgement programme of amendment 5, ticket P56
// "The render acknowledgement answers at durable admission"). LV1 is a deferred live
// row and gets no test. D1 and D2 (RESOLVED, R-P99) are exercised inside AA1-AA3.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-5/BTI-Parity-Amendment-2026-10-19.md, section 2, P56):
//   "P56 — the render acknowledgement answers at durable admission. On both shopper
//   hosts, an acknowledgement of a rendered-v1 decision answers 200 once both of its
//   source admissions (`savePayload` and `armRecovery`, `recovery.ts:177-178`) are
//   committed, with `render: { status: 'durable', source: 'pending' }`; the queue
//   send, the ledger write and the learning fan-out of both recoveries continue right
//   after the answer in the same shopper's FIFO serializer, with the existing alarm as
//   backstop; a later request from the same shopper observes their effects (a click
//   sent immediately after a `pending` acknowledgement is attributed to that
//   decision); a same-id re-send after the effects answers `source: 'recovered'`, one
//   ledger row exists and the exposure is counted once. Under the parity harness with
//   one tenth of the SDK's deadline added to every remote binding call, the
//   acknowledgement answers in under the SDK's deadline, exported as a named
//   constant. The durable admission, W06's digests, the idempotent replay, the
//   redemption checks and the rule that an admission failure fails the
//   acknowledgement do not change. Every unit or walker expectation that read
//   `recovered` on a first acknowledgement is updated in R10 form, naming this
//   amendment."
//
// One `describe('unit:P56.<criterion>')` per LOCAL criterion, each walked on both
// shopper hosts through the parity harness. Expected values come from the work order,
// the amendment, the analysis it cites (_evidence/baseline-52/ack-latency/ANALYSIS.md,
// track-analyst at afa24293: §1 the path, §2 the reproduction, §4 the RED tests and
// the must-not-change list) and the engine's own constants and functions, never from
// what the engine answers today:
//   · the render receipt: `{ version: 1, decisionId, eventId, pageInstance, status:
//     'durable', source }` (src/content/renderOffer.ts:23-26, :110-111; kit 02:869);
//     D1 (R-P99): a `pending` receipt satisfies the rendered-v1 contract, and the SDK
//     already accepts it (src/sdk/core.ts:978-980);
//   · the behaviour persistence of the same request: `{ status: 'durable', recordId,
//     receipt }` (src/ledger/behavior.ts:44), its record id
//     `<tenant>:<ts36(time)>:<subject>:behavior:<eventId>` (:38), its receipt at
//     admission `{ version: 1, operation, durable: true, source: { expected: 1, state:
//     'pending' } }` (src/ledger/recovery.ts:174), the operation id the engine's own
//     `recoveryDigest({ kind, tenant, subject, ids })` (:149); D2 (R-P99): both
//     recoveries of the acknowledgement request answer at admission;
//   · the backstop: `armRecovery` arms the shopper object's alarm at the latest 30 s
//     after the admission (recovery.ts:126-129, :178), and the alarm resumes pending
//     operations (ShopperReflex.ts alarm, the `recoveryOperation:` loop);
//   · attribution read as src/units/P03/LEDGER.unit.test.ts:294 reads it: the click
//     credit (`s`) of the statistics objects, through `learned()`;
//   · the SDK's deadline: the 5 s the SDK cuts its acknowledgement at (amendment
//     section 1; src/sdk/core.ts:945, a bare literal today), exported by the name the
//     analysis rules (ANALYSIS §4, RED test 2: `ACK_DEADLINE_MS`);
//   · W06's commitments, compared with the engine's own exported functions
//     (`recoveryDigest`, `recoveryJSON`) over what the shopper object stores: the
//     operation id (recovery.ts:148-149), the source digest of `sourceOf` (:81-82,
//     transcribed in src/units/_parity8.ts `w06SourceOf` because it is not exported),
//     the payload digest and byte count (:100-106), the logical key
//     `recoveryDigest({ stream, id })` holding `{ operation, digest }` (:112-120,
//     :177) and the first-admission deadline the offer carries (renderOffer.ts:62-64
//     `until`, :108; recovery.ts:143-147).
//
// THE READINGS THIS FILE RULES (one representation for P56 and P57):
//   · "Answers while the queue send is held": the event queue (`EVENT_QUEUE`) answers
//     no `send` or `sendBatch` until released; nothing else is held. The wait for the
//     answer is bounded (HOLD_BOUND_MS): nothing resolves the held send, so an engine
//     that waits on it never answers and the bound decides; the test then releases the
//     hold, lets the request finish and drains, and never hangs.
//   · "A click sent immediately after a `pending` acknowledgement is attributed to that
//     decision" (AA3): the acknowledgement's effects are held at the ring append (the
//     ring's `/append` door, src/learn/fan.ts fanDecisions; src/units/_parity8.ts
//     `holdObjectDoor`), the effect the click's attribution reads; the click is sent at
//     once and given CLICK_WINDOW_MS to be answered while the append is held, then the
//     append is released. In the shopper's FIFO serializer the click waits behind the
//     held effects and is credited; an engine that ran it beside them would answer it
//     inside the window and credit nothing.
//   · "After release and drain": the hold released, then every pending piece of work
//     awaited (the worker's and each object's `state.waitUntil`, src/units/_parity8.ts
//     `settle`), then the same-id re-send, which enters the shopper object's
//     serializer after anything queued there.
//   · "Under the parity harness with one tenth of the SDK's deadline added to every
//     remote binding call": src/units/_parity8.ts `remoteLatency` adds
//     ACK_DEADLINE_MS / 10 before every call to the R2 bucket, both KV namespaces, the
//     queue and the statistics and ring objects, from the moment the acknowledgement is
//     sent until it is answered (or the deadline passes); the mounted environment's
//     deployment profile is the CUSTOMER profile the finding was measured on
//     (amendment section 1: "on the customer-profile stamps"; ANALYSIS §2 rig:
//     `DEPLOYMENT_PROFILE=customer`). On the parity harness's default demo profile the
//     session host's engine also seeds the demo surface's audiences on every action
//     (src/services/RealtimeSegmentEngine.ts `ensureAudiencesSeeded`, demo profile and
//     default tenant only: eleven serial CACHE reads measured), a stamp never runs
//     that code, and no path P56 may change removes it.
//   · "Identical receipt" (AA4's replay, and P57): the render receipt's members other
//     than `source`; `source` reports the progress of the same admission (`pending`,
//     then `recovered` once its effects ran).
//   · "An admission failure fails the acknowledgement": the shopper object's storage
//     refuses the admission's transaction (src/units/_parity8.ts `refuseAdmission`);
//     the acknowledgement answers 500 with no render receipt, nothing of the
//     decision is admitted or written, and the same acknowledgement is admitted once
//     the storage accepts it (P57.RC3 rules the body of that 500; this file locks
//     only its status, which P57 keeps).
//
// THE ARITHMETIC OF AA2 (witness: ANALYSIS §2 Table B, §4; measured on this harness at
// 9026e8b5 on the customer profile with a counting lever,
// _evidence/parity-step3/S9/specifier/logs/probe-four.log and probe-aa2-today.log):
// L = ACK_DEADLINE_MS / 10 = 500 ms per remote call. Today the acknowledgement awaits
// about 32 serial remote calls on the session host (34 calls, two pairs in parallel)
// and about 30 on the object host (32 calls) — the analysis's 30 and 28, plus the
// statistics objects' own reads — so at least 28 x 500 = 14 000 ms = 2.8 x the
// deadline: RED (measured: no answer within 5 000 ms, 10 calls made by then, both
// hosts). After P56 the answer path keeps the redemption's publication reads and, on
// the session host, the engine's two KV writes (ANALYSIS §4: 30 -> 4 and 28 -> 2):
// a sketch of the ruled mechanism on a scratch copy measured 5 calls in 2 525 ms on the
// session host and 3 calls in 1 525 ms on the object host, at most 0.5 x the deadline:
// GREEN with about 2 500 ms to spare for in-process work.
//
// THE BOUNDARY (measured on the scratch copy, for the lead): any named export added to
// src/sdk/core.ts changes the generated declaration packages/sdk/types/core.d.ts, and
// using it for the cut at :945 also changes the shipped bundles
// (public/sdk/edge-personalization.esm.js first); `node scripts/build-sdk.mjs --check`
// and src/units/P34 T5 then fail until they are regenerated, and neither path is in
// P56's allowed paths.
//
// RULED MEMBERS AND EXPORTS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `ACK_DEADLINE_MS` exported by src/sdk/core.ts (imported dynamically; AA2 is RED on
// its absence first, with the words "the SDK deadline is not a named constant").
//
// R10 (expectations that read `recovered` on a first acknowledgement, or read its
// effects before they can have run, listed for the lead; none is edited here):
// src/routes/realtime.sdkContract.test.ts:386 (the W15 retry's render `toEqual` the
// first answer's) and src/index.api-boundary.test.ts:1237-1244 (W15 native: the ring
// and the statistics read right after the first answer, and the retry's render
// `toEqual` the first's). Both measured RED, and nothing else of the suite, under a sketch
// of P56 and P57 on a scratch copy (_evidence/parity-step3/S9/specifier/logs/sketch-full.json,
// load flakes re-run alone). See the S9 specifier report.
//
// FIXTURE. P02's world (src/units/P02/LEDGER.unit.test.ts:100-105): the registered
// modules in catalogue order, the declared layout slot (K = 4, rendered-v1, click
// reward) and the recently-viewed slot; one shopper with their explicit choice, one
// page view, one product page with its page instance; the cold layout
// [grid.1, reco.1, reco.2, editorial.1], every module offered for acknowledgement.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts) and src/units/_parity8.ts (the worker's error path,
// the wire without a drain, the levers and the readers). Imports from src/units/:
// ../_parity, ../_parity8.

import { describe, expect, it, vi } from 'vitest';

import { RENDER_OFFER_WINDOW_MS } from '@/content/renderOffer';
import type { RecoveryInput } from '@/ledger/recovery';
import { recoveryDigest, recoveryJSON } from '@/ledger/recovery';
import { parseId, ts36 } from '@/ledger/records';

import {
  declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learned, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, recentSlot, rounded, shopperOn, storedDecisions, TENANT, type Decision, type Host, type Mounted, type Shopper, type Snapshot,
} from '../_parity';
import {
  ackWire, admissionsOf, clickWire, decisionAdmissionOf, holdObjectDoor, holdQueue, refuseAdmission, remoteLatency, rowsOf, settle, shopperHeld, shopperStorage,
  storedBehavior, UNANSWERED, w06SourceOf, within, workerApp, type Identity, type Latency, type WorkerApp,
} from '../_parity8';

const DOCUMENTS = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
/** P02's cold layout (src/units/P02/LEDGER.unit.test.ts:105): the first four eligible modules in catalogue order. */
const COLD_LAYOUT = [M.grid, M.reco1, M.reco2, M.editorial];
/** Nothing resolves a held queue send: an engine that waits on it never answers, and this bound decides. */
const HOLD_BOUND_MS = 4_000;
/** How long AA3's clicks are given to be answered while the ring append is held (an in-process click answers in tens of ms). */
const CLICK_WINDOW_MS = 1_500;
/** Amendment 5, section 1: "The SDK cuts its own acknowledgement request at 5 s" (src/sdk/core.ts:943-945). */
const SDK_CUT_MS = 5 * 1000;
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);

interface World { m: Mounted; app: WorkerApp; s: Shopper; page: Snapshot; layout: Decision[]; latency?: Latency }

/** P02's world on one host: published, one shopper with their choice and a page view, their product page with its page instance. */
async function world(host: Host, label: string, options: { profile?: 'customer'; latency?: boolean } = {}): Promise<World> {
  const m = await mount(host, DOCUMENTS);
  expectPublished(m, 'P56 — the product page with its declared rendered-v1 layout slot (P02) publishes');
  // The stamps' profile, set as a stamp sets it, before the shopper exists (AA2 only; header).
  if (options.profile) (m.env as unknown as Record<string, unknown>).DEPLOYMENT_PROFILE = options.profile;
  const latency = options.latency ? remoteLatency(m) : undefined;
  const app = workerApp(m);
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${host}): the shopper's page view is accepted`).toBe(200);
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `PRECONDITION (${host}): the shopper's product page is served (${show(page.body)})`).toBe(200);
  const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
  expect(layout.map(d => d.contentId), `PRECONDITION (${host}): the cold layout (P02.A2)`).toEqual(COLD_LAYOUT);
  for (const d of layout) expect(d.renderOffer, `PRECONDITION (${host}): ${d.contentId} is offered for a render acknowledgement (rendered-v1)`).toMatch(/^ro1\./);
  return { m, app, s, page, layout, ...(latency ? { latency } : {}) };
}

/** The render acknowledgement the route answers (renderOffer.ts:23-26, :110-111; kit 02:869). */
const renderReceipt = (page: Snapshot, d: Decision, identity: Identity, source: 'pending' | 'recovered') =>
  ({ version: 1, decisionId: d.decisionId, eventId: identity.eventId, pageInstance: page.pageInstance, status: 'durable', source });
/** The record id of the behaviour capture (behavior.ts:38) for an event admitted at `at`. */
const behaviorIdOf = (s: Shopper, identity: Identity, at: number) => `${TENANT}:${ts36(at)}:${s.subject}:behavior:${identity.eventId}`;
/** A recovery operation's id (recovery.ts:149), by the engine's own digest. */
const operationOf = (kind: RecoveryInput['kind'], subject: string, id: string) => recoveryDigest({ kind, tenant: TENANT, subject, ids: [id] });
/** The `rendered` member the redemption writes onto the decision (renderOffer.ts:107). */
const renderedOf = (page: Snapshot, identity: Identity, at: number) => ({ version: 1, eventId: identity.eventId, at, pageInstance: page.pageInstance });
const utf8 = (text: string) => new TextEncoder().encode(text).length;

// ===========================================================================
// unit:P56.AA1 — the acknowledgement answers at durable admission; the effects follow
// ===========================================================================

describe('unit:P56.AA1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): while the queue send is held unresolved, the acknowledgement of a rendered-v1 decision answers 200 with render durable and pending, and the behaviour capture of the same request durable and pending, the alarm armed as the backstop; after release and drain a same-id re-send answers recovered, one ledger row and one behaviour record exist, and the exposure is counted once`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p56-aa1');
      const d = layout[0]!;
      const held = holdQueue(m);
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const sentWall = Date.now();
      const sent = ackWire(app, s, page, d, identity);
      const answer = await within(sent, HOLD_BOUND_MS);
      const alarm = await shopperStorage(m, s.subject).getAlarm(), alarmRead = Date.now();
      held.release();
      const eventual = await sent;
      await settle(m, app);

      const recordId = behaviorIdOf(s, identity, identity.timestamp);
      const unanswered = `${UNANSWERED} within ${HOLD_BOUND_MS} ms while the queue send was held (answered ${eventual.status} ${show(eventual.body.render)} only after its release)`;
      expect.soft(answer === UNANSWERED ? unanswered : [answer.status, answer.body.render],
        `${host}: P56.AA1 — the acknowledgement answers 200 at durable admission, render durable and pending, while its queue send is held`)
        .toEqual([200, renderReceipt(page, d, identity, 'pending')]);
      expect.soft(answer === UNANSWERED ? unanswered : answer.body.behavior,
        `${host}: P56.AA1 (D2) — the behaviour capture of the same request answers at its own admission, durable and pending`)
        .toEqual({ status: 'durable', recordId, receipt: { version: 1, operation: await operationOf('behavior', s.subject, recordId), durable: true, source: { expected: 1, state: 'pending' } } });
      const armed = typeof alarm === 'number' && alarm > sentWall && alarm <= alarmRead + 30_000;
      expect.soft(answer === UNANSWERED ? unanswered : armed ? 'armed within 30 s' : `alarm ${String(alarm)} (sent ${sentWall}, read ${alarmRead})`,
        `${host}: P56.AA1 — when it answers, the shopper object's alarm is armed within 30 s, the backstop of the held effects (recovery.ts:126-129)`).toBe('armed within 30 s');

      const resend = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      expect.soft([resend.status, resend.body.render], `${host}: P56.AA1 — after release and drain, a same-id re-send answers recovered (${show(resend.body)})`)
        .toEqual([200, renderReceipt(page, d, identity, 'recovered')]);
      await m.drainLedger();
      expect.soft(rowsOf(storedDecisions(m, s.subject), d.decisionId).map(row => row.rendered), `${host}: P56.AA1 — exactly one ledger row for the decision, carrying its render`)
        .toEqual([renderedOf(page, identity, identity.timestamp)]);
      expect.soft(storedBehavior(m, s.subject).filter(row => row.event_id === identity.eventId).map(row => row.record_id), `${host}: P56.AA1 — exactly one behaviour record for the acknowledgement`)
        .toEqual([recordId]);
      expect.soft(rounded(await learned(m), 'n'), `${host}: P56.AA1 — the exposure is counted once, for the acknowledged module only`).toEqual({ [d.contentId]: 1 });
    }, 60_000);
  }

  it('CONTROL: the held queue answers no send until released, the bounded wait reports no answer, and the expectation refuses the answer the engine gives today (render recovered after the effects)', async () => {
    const m = await mount('session', DOCUMENTS);
    const held = holdQueue(m);
    const send = (m.env.EVENT_QUEUE as unknown as { send: (body: unknown) => Promise<void> }).send({ control: 'p56-aa1' });
    expect(await within(send, 100), 'CONTROL — while held, a queue send is not answered').toBe(UNANSWERED);
    held.release();
    await send;
    expect(m.queued.at(-1), 'CONTROL — once released, the held send reaches the queue the harness built').toEqual({ control: 'p56-aa1' });
    const identity = { eventId: 'control-event', timestamp: 1 }, page = { page: 'pdp', pageInstance: 'control-page', decisions: [], status: 200, body: {} };
    const d = { contentId: M.grid, slot: LAYOUT, order: 0, decisionId: 'control-decision' };
    // Today's first answer (ANALYSIS §2 Table A, measured on this harness: _evidence/parity-step3/S9/specifier/logs/probe-base.log): durable, recovered.
    expect(() => expect([200, renderReceipt(page, d, identity, 'recovered')]).toEqual([200, renderReceipt(page, d, identity, 'pending')]),
      'CONTROL — a first answer reading recovered does not satisfy AA1').toThrow();
  });
});

// ===========================================================================
// unit:P56.AA2 — under one tenth of the SDK's deadline per remote call, it answers in time
// ===========================================================================

describe('unit:P56.AA2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with one tenth of the SDK's named deadline added to every remote binding call, the acknowledgement of a rendered-v1 decision answers 200 durable in under that deadline (today at least 28 serial calls: at least 2.8 times the deadline)`, async () => {
      const sdk = await import('@/sdk/core') as unknown as Record<string, unknown>;
      expect(typeof sdk.ACK_DEADLINE_MS, `${host}: P56.AA2 — the SDK deadline is not a named constant: src/sdk/core.ts exports no number ACK_DEADLINE_MS (its 5 s cut is a bare literal in boundedJSON, :945)`).toBe('number');
      const deadline = sdk.ACK_DEADLINE_MS as number;
      expect(deadline, `${host}: P56.AA2 — the named deadline is the SDK's 5 s acknowledgement cut (amendment 5, section 1)`).toBe(SDK_CUT_MS);
      const perCall = deadline / 10;

      const { m, app, s, page, layout, latency } = await world(host, 'p56-aa2', { profile: 'customer', latency: true });
      const d = layout[0]!;
      const lever = latency!;
      const first = lever.calls.length;
      lever.set(perCall);
      let answer: Awaited<ReturnType<typeof ackWire>> | typeof UNANSWERED = UNANSWERED;
      let eventual: Awaited<ReturnType<typeof ackWire>>;
      const sent = ackWire(app, s, page, d);
      try { answer = await within(sent, deadline); }
      finally { lever.set(0); eventual = await sent; await settle(m, app); }
      const made = (answer === UNANSWERED ? lever.calls.slice(first) : lever.calls.slice(first).filter(call => call.at <= answer.answeredAt)).length;
      const elapsed = answer === UNANSWERED ? Infinity : answer.answeredAt - answer.sentAt;
      expect.soft(elapsed, `${host}: P56.AA2 — the acknowledgement answers in under ${deadline} ms with ${perCall} ms on every remote call: ${answer === UNANSWERED
        ? `${UNANSWERED} within the deadline; ${made} remote calls made before it passed (${lever.calls.slice(first, first + 40).map(call => call.binding + '.' + call.method).join(' ')})`
        : `answered in ${Math.round(elapsed)} ms after ${made} remote calls`}`).toBeLessThan(deadline);
      expect.soft([eventual.status, (eventual.body.render as { status?: unknown } | undefined)?.status], `${host}: P56.AA2 — and the answer is the durable acknowledgement (${show(eventual.body)})`)
        .toEqual([200, 'durable']);
    }, 60_000);
  }

  it('CONTROL: the latency lever delays and records a remote call, and the bounded wait reports a request that has not answered', async () => {
    const m = await mount('do', DOCUMENTS);
    const lever = remoteLatency(m);
    lever.set(200);
    const start = performance.now();
    await m.storage.get('control/p56-aa2');
    const took = performance.now() - start;
    lever.set(0);
    expect([took >= 195, lever.calls.at(-1)?.binding, lever.calls.at(-1)?.method], `CONTROL — one R2 read under a 200 ms lever takes at least 200 ms (${Math.round(took)} ms) and is recorded`)
      .toEqual([true, 'STORAGE', 'get']);
    expect(await within(new Promise(() => { /* never answers */ }), 50), 'CONTROL — a request that never answers is reported, not awaited').toBe(UNANSWERED);
  });
});

// ===========================================================================
// unit:P56.AA3 — a click sent at once after a pending acknowledgement is attributed to it
// ===========================================================================

describe('unit:P56.AA3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a content_click sent immediately after a pending acknowledgement, while its effects are still held before the ring append, is credited to that decision once they run (the ring append ran first in the serializer); a click on a module returned but never acknowledged is credited nothing`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p56-aa3');
      const [d, unacknowledged] = [layout[0]!, layout[1]!];
      // The acknowledgement's effects stop at the ring append (fan.ts fanDecisions, `post(... '/append' ...)`), the effect a later click's attribution reads.
      const append = holdObjectDoor(m, 'DECISION_RING', '/append');
      const sent = ackWire(app, s, page, d);
      const answer = await within(sent, HOLD_BOUND_MS);
      if (answer === UNANSWERED) { append.release(); await sent; await settle(m, app); }
      expect(answer === UNANSWERED ? `${UNANSWERED} within ${HOLD_BOUND_MS} ms while the ring append was held` : [answer.status, (answer.body.render as { source?: unknown } | undefined)?.source],
        `${host}: PRECONDITION (P56.AA1) — the acknowledgement answers pending while its effects are held`).toEqual([200, 'pending']);

      // At once, while the ring append is still held. An engine that ran the clicks beside the held effects,
      // outside the shopper's serializer, would answer them within this window and attribute nothing.
      const clicked = clickWire(app, s, page, d), stray = clickWire(app, s, page, unacknowledged);
      await within(Promise.all([clicked, stray]), CLICK_WINDOW_MS);
      append.release();
      const [click, other] = await Promise.all([clicked, stray]);
      await settle(m, app);
      await m.drainLedger();
      expect.soft([click.status, other.status], `${host}: P56.AA3 — both clicks are accepted (${show(click.body)} ${show(other.body)})`).toEqual([200, 200]);
      const state = await learned(m);
      expect.soft(rounded(state, 's'), `${host}: P56.AA3 — the click is credited to the decision its pending acknowledgement admitted (attribution read as P03/LEDGER.unit.test.ts:294), and the click on ${unacknowledged.contentId}, never acknowledged, to nothing`)
        .toEqual({ [d.contentId]: 1 });
      expect.soft(rounded(state, 'n'), `${host}: P56.AA3 — the acknowledged module's exposure is counted once`).toEqual({ [d.contentId]: 1 });
    }, 60_000);
  }

  it('CONTROL: the held ring door holds the append only, until released', async () => {
    const m = await mount('session', DOCUMENTS);
    const append = holdObjectDoor(m, 'DECISION_RING', '/append');
    const ring = m.env.DECISION_RING!.get(m.env.DECISION_RING!.idFromName('control-p56-aa3'));
    const held = ring.fetch('https://learn/append', { method: 'POST', body: '{}' });
    expect(await within(held, 100), 'CONTROL — while held, the ring append is not answered').toBe(UNANSWERED);
    const other = await within(ring.fetch('https://learn/recent'), 2_000);
    expect(other === UNANSWERED ? UNANSWERED : 'answered', 'CONTROL — another door of the same ring answers').toBe('answered');
    append.release();
    expect(await within(held, 2_000) === UNANSWERED ? UNANSWERED : 'answered', 'CONTROL — once released, the append reaches the ring').toBe('answered');
  });
});

// ===========================================================================
// unit:P56.AA4 — locks: admission, W06's digests, the replay, the redemption checks, an admission failure
// ===========================================================================

describe('unit:P56.AA4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — the durable admission: the decision's operation id, its source and payload digests and byte count, its logical key and its first-admission deadline are W06's, computed by the engine's own functions; the operation holds its meta and chunks only; the alarm is armed within 30 s`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p56-aa4-admission');
      const d = layout[0]!;
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const ack = await ackWire(app, s, page, d, identity);
      const alarm = await shopperStorage(m, s.subject).getAlarm(), alarmRead = Date.now();
      await settle(m, app);
      expect(ack.status, `${host}: PRECONDITION — the acknowledgement is admitted (${show(ack.body)})`).toBe(200);
      const admission = decisionAdmissionOf(m, s.subject, d.decisionId!);
      expect(admission?.payload ? 'admitted' : 'no admission', `${host}: PRECONDITION — the shopper object holds the decision's admission`).toBe('admitted');
      const { id, meta, text, payload, keys } = admission!;
      const input = payload!.input as Extract<RecoveryInput, { kind: 'decisions' }>;

      expect.soft(id, `${host}: P56.AA4 — the operation id is recoveryDigest({ kind, tenant, subject, ids }) (recovery.ts:149)`).toBe(await operationOf('decisions', s.subject, d.decisionId!));
      expect.soft(meta.digest, `${host}: P56.AA4 — the source digest is recoveryDigest(sourceOf(input)) (recovery.ts:81-82, :149)`).toBe(await recoveryDigest(w06SourceOf(input)));
      expect.soft([meta.payloadDigest, meta.bytes, text], `${host}: P56.AA4 — the payload is stored as recoveryJSON(payload), its digest and byte count committed (recovery.ts:100-106)`)
        .toEqual([await recoveryDigest(payload), utf8(text), recoveryJSON(payload)]);
      expect.soft(shopperHeld(m, s.subject, 'recoveryLogical:' + await recoveryDigest({ stream: 'decision', id: d.decisionId })),
        `${host}: P56.AA4 — the logical key recoveryDigest({ stream, id }) holds the operation and its digest (recovery.ts:112-120, :177)`).toEqual({ operation: id, digest: meta.digest });
      expect.soft(keys.sort(), `${host}: P56.AA4 — the operation holds its meta and its chunks, nothing else`)
        .toEqual([...Array.from({ length: meta.chunks }, (_, index) => `recoveryBody:${id}:${index}`), `recoveryOperation:${id}`].sort());
      expect.soft([input.records.map(row => row.rendered), input.firstAdmissionUntil], `${host}: P56.AA4 — the admitted record carries its render, and the first-admission deadline is the offer's (the decision's time plus the offer window, within the grant; renderOffer.ts:62-64, :107-108)`)
        .toEqual([[renderedOf(page, identity, identity.timestamp)], Math.min(parseId(d.decisionId!)!.ts + RENDER_OFFER_WINDOW_MS, s.grant.exp * 1000)]);
      expect.soft(typeof alarm === 'number' && alarm <= alarmRead + 30_000 ? 'armed within 30 s' : `alarm ${String(alarm)}`, `${host}: P56.AA4 — armRecovery armed the alarm within 30 s (recovery.ts:126-129)`)
        .toBe('armed within 30 s');
      // CONTROL: the lock has teeth — a source commitment that left out the render would not be the stored digest.
      const withoutRender = { ...input, records: input.records.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'rendered'))) } as unknown as RecoveryInput;
      expect(await recoveryDigest(w06SourceOf(withoutRender)) === meta.digest, `${host}: CONTROL — a digest of a source without its render differs from the stored one`).toBe(false);
    }, 60_000);

    it(`host (${host}): LOCK — the idempotent replay: after the effects, a same-id re-send answers 200 with the identical render receipt (recovered) and the stored behaviour receipt, writes nothing (the object's recovery state byte for byte), and leaves one ledger row, one behaviour record and one exposure`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p56-aa4-replay');
      const d = layout[0]!;
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const first = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      expect(first.status, `${host}: PRECONDITION — the acknowledgement is admitted (${show(first.body)})`).toBe(200);
      const recordId = behaviorIdOf(s, identity, identity.timestamp);
      const behaviorOperation = await operationOf('behavior', s.subject, recordId);
      const before = JSON.stringify(admissionsOf(m, s.subject));
      const stored = admissionsOf(m, s.subject).find(a => a.id === behaviorOperation);

      const resend = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      expect.soft([resend.status, resend.body.render], `${host}: P56.AA4 — the re-send answers 200 with the same render receipt, recovered`).toEqual([200, renderReceipt(page, d, identity, 'recovered')]);
      expect.soft(resend.body.behavior, `${host}: P56.AA4 — and the behaviour persistence the capture stored (recovery.ts:150-153 returns the stored receipt)`)
        .toEqual({ status: 'durable', recordId, receipt: stored?.meta.receipt ?? 'no stored behaviour operation' });
      expect.soft(JSON.stringify(admissionsOf(m, s.subject)) === before, `${host}: P56.AA4 — the re-send writes nothing: the object's recovery operations byte for byte`).toBe(true);
      await m.drainLedger();
      expect.soft([rowsOf(storedDecisions(m, s.subject), d.decisionId).length, storedBehavior(m, s.subject).filter(row => row.event_id === identity.eventId).length, rounded(await learned(m), 'n')],
        `${host}: P56.AA4 — one ledger row, one behaviour record, one exposure`).toEqual([1, 1, { [d.contentId]: 1 }]);
      // CONTROL: the byte comparison has teeth — another decision's acknowledgement adds an operation.
      await ackWire(app, s, page, layout[1]!);
      await settle(m, app);
      expect(JSON.stringify(admissionsOf(m, s.subject)) === before, `${host}: CONTROL — a second decision's acknowledgement changes the recovery state`).toBe(false);
    }, 60_000);

    it(`host (${host}): LOCK — the redemption checks: an acknowledgement naming another module, another page instance, another slot, a time before the decision, a tampered offer, or an offer past its window is refused 401 as today and admits nothing; the untampered acknowledgement is then admitted`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p56-aa4-redeem');
      const [d, next] = [layout[0]!, layout[1]!];
      const refusal = { status: 401, body: { ok: false, error: 'Shopper session unavailable' } };
      const tampered = d.renderOffer!.slice(0, -2) + (d.renderOffer!.endsWith('AA') ? 'BB' : 'AA');
      const variants: Array<[string, () => ReturnType<typeof ackWire>]> = [
        ['another module', () => ackWire(app, s, page, { ...d, contentId: next.contentId })],
        ['another page instance', () => ackWire(app, s, { ...page, pageInstance: pageInstanceOf('p56-aa4-other') }, d)],
        ['another slot', () => ackWire(app, s, page, { ...d, slot: 'pdp-recent' })],
        ['a time before the decision', () => ackWire(app, s, page, d, { eventId: crypto.randomUUID(), timestamp: parseId(d.decisionId!)!.ts - 1 })],
        ['a tampered offer', () => ackWire(app, s, page, { ...d, renderOffer: tampered })],
      ];
      for (const [name, send] of variants) {
        const answer = await send();
        await settle(m, app);
        expect.soft({ status: answer.status, body: answer.body }, `${host}: P56.AA4 — ${name} is refused as today (renderOffer.ts:96-106; the owner's typed refusal, sessionAuthority.ts:670-671)`).toEqual(refusal);
      }
      // The offer window (renderOffer.ts:44-45, RENDER_OFFER_WINDOW_MS): the same acknowledgement one window after the decision.
      const later = Date.now() + RENDER_OFFER_WINDOW_MS + 1;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
      let expired: Awaited<ReturnType<typeof ackWire>>;
      try { expired = await ackWire(app, s, page, d, { eventId: crypto.randomUUID(), timestamp: later - 1 }); await settle(m, app); }
      finally { clock.mockRestore(); }
      expect.soft({ status: expired.status, body: expired.body }, `${host}: P56.AA4 — an offer past its window is refused as today`).toEqual(refusal);
      expect.soft([decisionAdmissionOf(m, s.subject, d.decisionId!) ? 'admitted' : 'nothing admitted', rowsOf(storedDecisions(m, s.subject), d.decisionId).length],
        `${host}: P56.AA4 — no refused acknowledgement admitted or wrote anything`).toEqual(['nothing admitted', 0]);
      // CONTROL: the refusals were the tampering's, not the fixture's.
      const honest = await ackWire(app, s, page, d);
      await settle(m, app);
      expect([honest.status, (honest.body.render as { status?: unknown } | undefined)?.status], `${host}: CONTROL — the untampered acknowledgement is admitted (${show(honest.body)})`).toEqual([200, 'durable']);
    }, 60_000);

    it(`host (${host}): LOCK — an admission failure fails the acknowledgement: when the shopper object's storage refuses the admission's transaction, the acknowledgement answers 500 with no render receipt and nothing of the decision is admitted, written or counted; the same acknowledgement is admitted once the storage accepts it`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p56-aa4-refused');
      const d = layout[0]!;
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const restore = refuseAdmission(m, s.subject, 'P56 unit lever: the shopper object refused the admission transaction');
      let refused: Awaited<ReturnType<typeof ackWire>>;
      try { refused = await ackWire(app, s, page, d, identity); await settle(m, app); }
      finally { restore(); }
      expect.soft([refused.status, Object.hasOwn(refused.body, 'render')], `${host}: P56.AA4 — the acknowledgement fails (500) and carries no render receipt (${show(refused.body)})`).toEqual([500, false]);
      await m.drainLedger();
      expect.soft([decisionAdmissionOf(m, s.subject, d.decisionId!) ? 'admitted' : 'nothing admitted', rowsOf(storedDecisions(m, s.subject), d.decisionId).length, rounded(await learned(m), 'n')],
        `${host}: P56.AA4 — nothing of the decision is admitted, written or counted`).toEqual(['nothing admitted', 0, {}]);
      // CONTROL: the failure was the storage's — the same acknowledgement is admitted once it accepts.
      const admitted = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      expect([admitted.status, (admitted.body.render as { status?: unknown } | undefined)?.status], `${host}: CONTROL — the same acknowledgement is admitted once the storage accepts it (${show(admitted.body)})`).toEqual([200, 'durable']);
    }, 60_000);
  }
});
