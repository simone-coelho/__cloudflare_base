// src/units/P58/LEDGER.unit.test.ts
// P58 under the Closure Ledger: the tests for the LOCAL criteria BA1-BA5 of the P58
// work order (the acknowledgement programme of amendment 5, ticket P58 "Every tracked
// action's behaviour capture answers at admission", with the two requirements the
// addendum of section 4 adds). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENTS, verbatim (docs/parity/authority/amendment-5/BTI-Parity-Amendment-2026-10-19.md):
//   section 2: "P58 — every tracked action's behaviour capture answers at admission.
//   Same mechanism and same locks as P56 for `product_view` and every other tracked
//   action whose behaviour capture runs a durable recovery on the answer path (hosted
//   p50 2.7 s today); the engine's projection and outcome semantics unchanged."
//   section 4, P58-D: "After the route has answered, whatever its status, a retained
//   rejection inside the owner never replaces the answer the shopper receives: a
//   client error the route answered itself (for example the `400 Validation error`
//   for an oversized identity merge) reaches the shopper as that 400, not as an
//   untyped 500. The test at `src/routes/realtime.sdkContract.test.ts:3530` (W14.05),
//   which pins today's 500 for that case, is updated in R10 form to the route's own
//   400 with a witness naming this addendum."
//   section 4, P58-E: "A same-id re-send of an operation whose effects are still
//   pending answers `source: 'pending'` and completes its effects once; reverting the
//   pending-replay path (`recovery.ts`'s existing-meta branch) to an inline resume
//   turns the lock red on both hosts."
//
// One `describe('unit:P58.<criterion>')` per LOCAL criterion, both shopper hosts.
// Expected values come from the work order, the amendment, the analysis
// (_evidence/baseline-52/ack-latency/ANALYSIS.md: §1 step 13, the behaviour capture's
// inline recovery; out-of-scope note 2, every tracked action pays it) and the engine's
// own functions, never from what the engine answers today:
//   · P56's mechanism as merged: `runOwnerRecovery`'s `answerAtAdmission` answers with
//     the admission's receipt, source `pending` (src/ledger/recovery.ts:174, :179,
//     :213-221), the effects continuing in the shopper's serializer
//     (src/identity/sessionAuthority.ts `continueAfterOwnerAnswer`), the alarm armed at
//     admission (recovery.ts:126-129, :178); the action route opts the behaviour capture
//     in only for a render acknowledgement today (src/routes/realtime.ts:241,
//     `hasOffer ? { answerAtAdmission: true } : undefined`);
//   · the behaviour record, derived by behavior.ts's own `captureBehavior`
//     (src/ledger/behavior.ts:16-45) for the same event inside an owner operation whose
//     recovery hook records what it is asked to admit (`behaviorRecordOf` below); its
//     operation id the engine's `recoveryDigest({ kind, tenant, subject, ids })`
//     (recovery.ts:149); W06 commits the record without its processing-time
//     `retention` and `externalRetention` stamps (recovery.ts:81-82), and so does the
//     comparison here;
//   · the reward row, derived by records.ts's own `outcomeFromAction`
//     (src/ledger/records.ts:401-439), as the action route calls it;
//   · the drain rule as the P57 build left it: src/identity/sessionAuthority.ts
//     `runOwnerOperation` (:526), a work answer of 500 or more stands over a retained
//     rejection (:537 `status >= 500`, :543), a retained `SessionAccessError` still
//     refuses (:543), any other retained rejection still fails the answer (:544, :547);
//   · the oversized merge's own answer: the profile schema's refusal "at most8 sources"
//     (src/identity/profileEnrichment.ts:18) answered by the owner app's error path as
//     `400 { error: 'Validation error', details }` (sessionAuthority.ts:709
//     `shopperRoutes` onError → src/middleware/error.ts:19-27).
//
// THE READINGS THIS FILE RULES:
//   · BA1 "a tracked action without a render offer": `product_view` carrying the
//     customer's attributes and no product id (counted whatever the catalogue holds),
//     and a `content_impression` without an offer, each answering 200 with its engine
//     answer (`success: true`) and the behaviour capture's persistence at admission,
//     `{ status: 'durable', recordId, receipt: { version: 1, operation, durable: true,
//     source: { expected: 1, state: 'pending' } } }` (behavior.ts:44, recovery.ts:174),
//     while the event queue answers nothing (src/units/_parity8.ts `holdQueue`); the
//     shopper object's alarm, cleared right before, armed within 30 s (R-P101); after
//     release and drain, one behaviour operation, recovered, and one behaviour row in
//     the ledger. The wait for the answer is bounded and the hold always released.
//   · BA2: P56.AA2's reading for `product_view` (customer profile, the latency lever,
//     ACK_DEADLINE_MS from src/sdk/core.ts); today 15 serial calls on the session host
//     and 13 on the object host (logs/probe-a.log at 50 ms per call), at 500 ms each
//     7 500 and 6 500 ms: RED; after P58 the behaviour admission is local and the
//     answer path keeps the engine's two KV writes on the session host.
//   · BA3 "the projection writes unchanged": the engine's projection is written before
//     the answer — the shopper object's `pipeline` counts the view at the answer on both
//     hosts, and on the session host every session-KV write the action made before its
//     answer equals the shopper object's committed projection of that key
//     (`sessionProjection:<key>`, not pending; ShopperReflex.ts `sessionProjectionStore`
//     `publish`). "P56's units unchanged": P56's acceptance command in the gate (a unit
//     file is never imported into another).
//   · BA4: W14.05's own case, in process on both hosts, through the identity routes
//     mounted as src/index.ts mounts them (src/units/_parity3.ts `identityDoor`, which,
//     like W14.05's fixture app, has no error handler of its own): the shopper object's
//     owner app answers the link with its own `400 Validation error` and today the drain
//     rethrows the retained ZodError after it, which reaches the test as the framework's
//     untyped 500. The drain rule itself is measured on `runOwnerOperation` (logic leg),
//     its kept behaviours as controls. In workerd (src/units/_native.ts, the native
//     legs) the shopper receives today 500 `{"error":"Internal server error","message":
//     "ZodError: [ … at most8 sources … ]"}` on both hosts, and still does when only the
//     drain threshold moves to 400 (_evidence/parity-step3/S10/specifier/logs/probe-c.log,
//     sketch-units-1.log): the merge's refusal is raised in the account's own shopper
//     object and reaches the browser's object as a plain Error across the Durable Object
//     boundary, so there the route's own answer is already a 500. R-P106 (the lead's ruling): P58 includes the native
//     behaviour — that refusal crosses the boundary typed, and the browser-side route
//     answers its own 400 with the same details natively. The native legs run every
//     step in turn (no wait, no race): they do not depend on timing.
//   · BA5 "an operation whose effects are still pending": the decision recovery of a
//     render acknowledgement whose continuation failed once (the first read of its
//     operation after the admission fails, src/units/_parity8.ts
//     `failReadOnceAfterAdmission`, the P56 delivery review's probe): it stays pending
//     with nothing effected; its same-id re-send, sent while the queue is held, answers
//     `pending` at admission (recovery.ts:153) and its effects complete once after
//     release. A re-send cannot be answered while the FIRST acknowledgement's own
//     effects hold the queue: it waits behind them in the shopper's serializer.
//
// R10 (expectations a build of P58 changes, listed for the lead; measured with the
// whole suite under a sketch of P58 on a scratch copy — every tracked action's
// behaviour capture opted into the answer at admission, the drain threshold at 400 —
// _evidence/parity-step3/S10/specifier/logs/sketch-full.json, environment-only
// failures re-run on an unmodified copy):
//   · src/routes/realtime.sdkContract.test.ts:3530 (W14.05, the oversized merge's 500):
//     updated in its own commit to the route's own 400 (addendum §4, P58-D);
//   · src/routes/realtime.sdkContract.test.ts:604 and :612 (W09.09, the test at :573):
//     the queue mock expects exactly one more admitted operation at each send (:604);
//     under P58 the purchase's outcome recovery is admitted and sends before the
//     deferred effects of its behaviour capture, the mock's expectation throws inside
//     the send, `started` never resolves and the test times out at :612;
//   · src/units/W37/FIX2.unit.test.ts:483-485 (unit:W37.T5.01, session host): the
//     `act` helper reads `response.clone().text()`, drains, then `response.json()`;
//     under the sketch :485 fails intermittently with "Body is unusable: Body has
//     already been read" (2 of 4 runs alone and the suite run; 0 of 6 at the base).
//
// No new export is imported; every member read exists at this head.
//
// FIXTURE. P02's world (src/units/P02/LEDGER.unit.test.ts:100-105) as P56's file builds
// it; BA4 replays W14.05's oversized merge on the same documents, in process and in workerd (src/routes/realtime.sdkContract.test.ts:3502-3530): two shoppers'
// profile rows (sources crm, warehouse) linked to one account, then a third shopper
// with seven more sources linked to it.
//
// HARNESS: src/units/_parity.ts, src/units/_parity3.ts (the identity routes and the
// tenant's identity material), src/units/_parity8.ts (the worker's error path, the
// wire without a drain, the levers, the readers) and src/units/_native.ts (workerd, for
// BA4's native legs). Imports from src/units/: ../_parity, ../_parity3, ../_parity8,
// ../_native.

import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { storedConsent } from '@/content/consent';
import { signAssertion } from '@/identity/assertion';
import { admitOwnerPrincipal, retainOwnerWork, runOwnerOperation } from '@/identity/sessionAuthority';
import { SessionAccessError, verifySessionCapability } from '@/identity/sessionCapability';
import { EMPTY_PRIORS } from '@/learn/priors';
import { captureBehavior } from '@/ledger/behavior';
import { outcomeFromAction, type BehaviorRecord } from '@/ledger/records';
import { recoveryDigest, type RecoveryInput, type RecoveryReceipt } from '@/ledger/recovery';
import { RETENTION_CATEGORIES } from '@/retention';
import { identityRoutes } from '@/routes/identity';
import { ACK_DEADLINE_MS } from '@/sdk/core';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { TenantId } from '@/tenancy/tenant';

import {
  declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learned, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf,
  productView, recentSlot, REFLEX_DOCUMENT, rounded, shopperOn, slotPositionOf, storedDecisions, storedOutcomes, TENANT, VIEW_TABBY_26,
  type Decision, type Host, type Mounted, type Shopper, type Snapshot,
} from '../_parity';
import {
  ackWire, actionWire, admissionsOf, clearShopperAlarm, decisionAdmissionOf, failReadOnceAfterAdmission, holdQueue, remoteLatency, rowsOf, sessionKvWrites,
  settle, shopperHeld, shopperStorage, storedBehavior, UNANSWERED, within, workerApp, type Identity, type Latency, type WorkerApp,
} from '../_parity8';
import { identityDoor, identitySecretOf } from '../_parity3';
import { bundleNativeWorker, nativeScratchDirectory, openNativeRuntime } from '../_native';

const DOCUMENTS = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
/** P02's cold layout (src/units/P02/LEDGER.unit.test.ts:105). */
const COLD_LAYOUT = [M.grid, M.reco1, M.reco2, M.editorial];
/** Nothing resolves a held queue send: an engine that waits on it never answers, and this bound decides. */
const HOLD_BOUND_MS = 4_000;
/** The customer's product view with its catalogue attributes and no product id, so it is counted whatever the catalogue holds. */
const COUNTED_VIEW = productView(Object.fromEntries(Object.entries(VIEW_TABBY_26.data).filter(([key]) => key !== 'productId')));
/** A module's impression without a render offer (the declarative capture's, kit 03 `content_impression`). */
const IMPRESSION = { type: 'content_impression', data: { contentId: M.grid, slot: LAYOUT, page: 'pdp' } };
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);

interface World { m: Mounted; app: WorkerApp; s: Shopper; page: Snapshot; layout: Decision[]; latency?: Latency }

/** P02's world on one host, as src/units/P56/LEDGER.unit.test.ts builds it. */
async function world(host: Host, label: string, options: { profile?: 'customer'; latency?: boolean } = {}): Promise<World> {
  const m = await mount(host, DOCUMENTS);
  expectPublished(m, 'P58 — the product page with its declared rendered-v1 layout slot (P02) publishes');
  if (options.profile) (m.env as unknown as Record<string, unknown>).DEPLOYMENT_PROFILE = options.profile;
  const latency = options.latency ? remoteLatency(m) : undefined;
  const app = workerApp(m);
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${host}): the shopper's page view is accepted`).toBe(200);
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `PRECONDITION (${host}): the shopper's product page is served (${show(page.body)})`).toBe(200);
  const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
  expect(layout.map(d => d.contentId), `PRECONDITION (${host}): the cold layout (P02.A2)`).toEqual(COLD_LAYOUT);
  return { m, app, s, page, layout, ...(latency ? { latency } : {}) };
}

/**
 * The behaviour record behavior.ts's own `captureBehavior` builds for an event the
 * action route admits (realtime.ts:239-241: the admitted time, the provided event id,
 * `source: 'sdk'`, the event's data, the shopper's session), inside an owner operation
 * whose recovery hook only records what it is asked to admit.
 */
async function behaviorRecordOf(m: Mounted, s: Shopper, event: { type: string; data: Record<string, unknown> }, identity: Identity): Promise<BehaviorRecord> {
  const principal = await verifySessionCapability(m.env, s.grant.capability, TENANT);
  const consent = storedConsent(shopperHeld(m, s.subject, 'consent'));
  const owner = {};
  let asked: RecoveryInput | undefined;
  const record = async (input: RecoveryInput): Promise<RecoveryReceipt> => { asked = input; return { version: 1, operation: '0'.repeat(64), durable: true, source: { expected: 1, state: 'pending' } }; };
  await runOwnerOperation(owner, m.env, async () => {
    admitOwnerPrincipal(owner, principal);
    return captureBehavior(m.env, principal, consent, { type: event.type, eventId: identity.eventId, eventIdSource: 'provided', timestamp: identity.timestamp,
      source: 'sdk', data: event.data }, principal.sessionId);
  }, undefined, undefined, undefined, undefined, undefined, record);
  expect(asked?.kind, `PRECONDITION (${m.host}): behavior.ts admits a behaviour record for the event`).toBe('behavior');
  return (asked as Extract<RecoveryInput, { kind: 'behavior' }>).record;
}
/** A record as W06 commits it: without its processing-time retention stamps (recovery.ts:81-82); a ledger row also without its delivery provenance. */
const logical = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !['retention', 'externalRetention', '_ledger_delivery'].includes(key)));
const operationOf = (kind: RecoveryInput['kind'], subject: string, id: string) => recoveryDigest({ kind, tenant: TENANT, subject, ids: [id] });
const pendingPersistence = async (s: Shopper, recordId: string) =>
  ({ status: 'durable', recordId, receipt: { version: 1, operation: await operationOf('behavior', s.subject, recordId), durable: true, source: { expected: 1, state: 'pending' } } });
/** The render acknowledgement the route answers (src/content/renderOffer.ts RenderAcknowledgment; kit 02). */
const renderReceipt = (page: Snapshot, d: Decision, identity: Identity, source: 'pending' | 'recovered') =>
  ({ version: 1, decisionId: d.decisionId, eventId: identity.eventId, pageInstance: page.pageInstance, status: 'durable', source });

// ===========================================================================
// unit:P58.BA1 — a tracked action without an offer answers at its behaviour admission
// ===========================================================================

describe('unit:P58.BA1', () => {
  for (const host of HOSTS) {
    for (const [name, event] of [['product_view', COUNTED_VIEW], ['content_impression without a render offer', IMPRESSION]] as const) {
      it(`host (${host}): while the queue send is held unresolved, a ${name} answers 200 with its behaviour capture durable and pending and the alarm armed within 30 s; after release and drain its behaviour operation is recovered and its behaviour row exists once in the ledger`, async () => {
        const { m, app, s } = await world(host, 'p58-ba1');
        const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
        const record = await behaviorRecordOf(m, s, event, identity);
        await clearShopperAlarm(m, s.subject); // R-P101: the page view armed it first; cleared so the clause reads this action's own.
        const held = holdQueue(m);
        const sentWall = Date.now();
        const sent = actionWire(app, s, event, identity);
        let answer: Awaited<typeof sent> | typeof UNANSWERED = UNANSWERED, alarm: number | null = null, alarmRead = 0;
        try { answer = await within(sent, HOLD_BOUND_MS); alarm = await shopperStorage(m, s.subject).getAlarm(); alarmRead = Date.now(); }
        finally { held.release(); }
        const eventual = await sent;
        await settle(m, app);
        const unanswered = `${UNANSWERED} within ${HOLD_BOUND_MS} ms while the queue send was held (answered ${eventual.status} ${show(eventual.body.behavior)} only after its release)`;
        expect.soft(answer === UNANSWERED ? unanswered : [answer.status, answer.body.success, answer.body.behavior],
          `${host}: P58.BA1 — the ${name} answers 200, its engine answer and its behaviour capture durable and pending, while its queue send is held`)
          .toEqual([200, true, await pendingPersistence(s, record.record_id)]);
        const armed = typeof alarm === 'number' && alarm > sentWall && alarm <= alarmRead + 30_000;
        expect.soft(answer === UNANSWERED ? unanswered : armed ? 'armed within 30 s' : `alarm ${String(alarm)} (sent ${sentWall}, read ${alarmRead})`,
          `${host}: P58.BA1 — when it answers, the shopper object's alarm is armed within 30 s, the backstop of the held effects (recovery.ts:126-129)`).toBe('armed within 30 s');
        await m.drainLedger();
        const operation = await operationOf('behavior', s.subject, record.record_id);
        expect.soft([admissionsOf(m, s.subject).filter(a => a.id === operation).map(a => a.meta.receipt.source.state), storedBehavior(m, s.subject).filter(row => row.record_id === record.record_id).length],
          `${host}: P58.BA1 — after release and drain, one behaviour operation, recovered, and one behaviour row in the ledger`).toEqual([['recovered'], 1]);
      }, 60_000);
    }
  }

  it('CONTROL: the expectation refuses the answer the engine gives today once its effects ran (the behaviour receipt recovered)', () => {
    const today = { status: 'durable', recordId: 'control', receipt: { version: 1, operation: 'control', durable: true, source: { expected: 1, state: 'recovered' } } };
    expect(() => expect([200, true, today]).toEqual([200, true, { ...today, receipt: { ...today.receipt, source: { expected: 1, state: 'pending' } } }]),
      'CONTROL — a behaviour receipt reading recovered does not satisfy BA1').toThrow();
  });
});

// ===========================================================================
// unit:P58.BA2 — product_view answers within the SDK's deadline under one tenth of it per remote call
// ===========================================================================

describe('unit:P58.BA2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with one tenth of ACK_DEADLINE_MS added to every remote binding call, a product_view answers 200 in under ACK_DEADLINE_MS (today 13 to 15 serial calls)`, async () => {
      const perCall = ACK_DEADLINE_MS / 10;
      const { m, app, s, latency } = await world(host, 'p58-ba2', { profile: 'customer', latency: true });
      const lever = latency!;
      const first = lever.calls.length;
      lever.set(perCall);
      let answer: Awaited<ReturnType<typeof actionWire>> | typeof UNANSWERED = UNANSWERED, byDeadline = 0;
      let eventual: Awaited<ReturnType<typeof actionWire>>;
      const sent = actionWire(app, s, COUNTED_VIEW);
      try { answer = await within(sent, ACK_DEADLINE_MS); byDeadline = lever.calls.length - first; }
      finally { lever.set(0); eventual = await sent; await settle(m, app); }
      const made = answer === UNANSWERED ? byDeadline : lever.calls.slice(first).filter(call => call.at <= answer.answeredAt).length;
      const elapsed = answer === UNANSWERED ? Infinity : answer.answeredAt - answer.sentAt;
      expect.soft(elapsed, `${host}: P58.BA2 — the product_view answers in under ${ACK_DEADLINE_MS} ms with ${perCall} ms on every remote call: ${answer === UNANSWERED
        ? `${UNANSWERED} within the deadline; ${made} remote calls made before it passed (${lever.calls.slice(first, first + made).map(call => call.binding + '.' + call.method).join(' ')})`
        : `answered in ${Math.round(elapsed)} ms after ${made} remote calls`}`).toBeLessThan(ACK_DEADLINE_MS);
      expect.soft([eventual.status, eventual.body.success, (eventual.body.behavior as { status?: unknown } | undefined)?.status], `${host}: P58.BA2 — and the answer is the engine's with a durable behaviour capture (${show(eventual.body)})`)
        .toEqual([200, true, 'durable']);
    }, 60_000);
  }

  it('CONTROL: the latency lever delays and records a remote call', async () => {
    const m = await mount('session', DOCUMENTS);
    const lever = remoteLatency(m);
    lever.set(200);
    const start = performance.now();
    await m.storage.get('control/p58-ba2');
    const took = performance.now() - start;
    lever.set(0);
    expect([took >= 195, lever.calls.at(-1)?.binding, lever.calls.at(-1)?.method], `CONTROL — one R2 read under a 200 ms lever takes at least 200 ms (${Math.round(took)} ms) and is recorded`)
      .toEqual([true, 'STORAGE', 'get']);
  });
});

// ===========================================================================
// unit:P58.BA3 — locks: the behaviour record, the projection writes, the reward row
// ===========================================================================

describe('unit:P58.BA3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — the behaviour record of a product_view is the one behavior.ts builds for the event: its id on the answer and in the ledger, and the ledger row's logical record`, async () => {
      const { m, app, s } = await world(host, 'p58-ba3-record');
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const record = await behaviorRecordOf(m, s, COUNTED_VIEW, identity);
      const answer = await actionWire(app, s, COUNTED_VIEW, identity);
      await settle(m, app);
      await m.drainLedger();
      expect(answer.status, `${host}: PRECONDITION — the product_view is accepted (${show(answer.body)})`).toBe(200);
      const rows = storedBehavior(m, s.subject).filter(row => row.event_id === identity.eventId);
      expect.soft([(answer.body.behavior as { recordId?: unknown } | undefined)?.recordId, rows.map(row => row.record_id)], `${host}: P58.BA3 — the record id on the answer and in the ledger is behavior.ts's (behavior.ts:38)`)
        .toEqual([record.record_id, [record.record_id]]);
      expect.soft(rows.map(logical), `${host}: P58.BA3 — the ledger row is the record behavior.ts builds, field for field (without the processing-time stamps W06 leaves out)`)
        .toEqual([logical(record as unknown as Record<string, unknown>)]);
      // CONTROL: the comparison has teeth — the same event at another time is another record id.
      const other = await behaviorRecordOf(m, s, COUNTED_VIEW, { ...identity, timestamp: identity.timestamp - 1000 });
      expect(other.record_id === record.record_id, `${host}: CONTROL — the same event at another time is another record id`).toBe(false);
    }, 60_000);

    it(`host (${host}): LOCK — the engine's projection is written before the answer: the shopper object's pipeline counts the product view when the answer arrives${host === 'session' ? ', and every session-KV write the action made before its answer is the object\'s committed projection of that key' : ''}`, async () => {
      const { m, app, s } = await world(host, 'p58-ba3-projection');
      const writes = sessionKvWrites(m);
      const pipeline = () => shopperHeld(m, s.subject, 'pipeline') as { attributes?: Record<string, unknown> } | undefined;
      const viewsBefore = Number(pipeline()?.attributes?.product_views ?? 0);
      const kvBefore = new Map((m.env.SESSIONS as unknown as { data: Map<string, string> }).data);
      const answer = await actionWire(app, s, COUNTED_VIEW);
      const viewsAtAnswer = Number(pipeline()?.attributes?.product_views ?? 0);
      const madeBefore = writes.filter(write => write.at <= answer.answeredAt);
      const committed = madeBefore.map(write => {
        const projection = shopperHeld(m, s.subject, 'sessionProjection:' + write.key) as { value?: unknown; pending?: unknown } | undefined;
        return [write.key, projection?.value === write.value && projection?.pending === false];
      });
      await settle(m, app);
      expect(answer.status, `${host}: PRECONDITION — the product_view is accepted (${show(answer.body)})`).toBe(200);
      expect.soft(viewsAtAnswer, `${host}: P58.BA3 — at the answer the object's pipeline has counted the view (src/durable-objects/ShopperReflex.ts pipeline; before ${viewsBefore})`).toBe(viewsBefore + 1);
      if (host === 'session') {
        const sessionKey = `session:${String(answer.body.sessionId)}`;
        expect.soft(committed, `${host}: P58.BA3 — every session-KV write made before the answer equals the object's committed projection of its key, and the session's projection is among them`)
          .toEqual(madeBefore.map(write => [write.key, true]));
        expect.soft(madeBefore.map(write => write.key), `${host}: P58.BA3 — the session's projection is written before the answer`).toContain(sessionKey);
        // CONTROL: the comparison has teeth — the session's projection before the action is not the committed one after it.
        const projection = shopperHeld(m, s.subject, 'sessionProjection:' + sessionKey) as { value?: unknown } | undefined;
        expect(kvBefore.get(sessionKey) === projection?.value, `${host}: CONTROL — the projection the action replaced differs from the one it committed`).toBe(false);
      } else {
        expect.soft(madeBefore.map(write => write.key), `${host}: P58.BA3 — the object host's projection lives in the object: the action writes no session KV before its answer`).toEqual([]);
      }
    }, 60_000);

    it(`host (${host}): LOCK — the reward row of a content_click on an acknowledged decision is the outcome records.ts's outcomeFromAction builds for the click, stored once`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p58-ba3-outcome');
      const d = layout[0]!;
      expect((await ackWire(app, s, page, d)).status, `${host}: PRECONDITION — the decision is acknowledged`).toBe(200);
      await settle(m, app);
      const click = { type: 'content_click', data: { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, page: page.page, position: d.order, slotPosition: slotPositionOf(page, d) } };
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const answer = await actionWire(app, s, click, identity);
      await settle(m, app);
      await m.drainLedger();
      expect(answer.status, `${host}: PRECONDITION — the click is accepted (${show(answer.body)})`).toBe(200);
      const action = { ...click, userId: s.subject, sessionId: s.grant.sessionId, eventId: identity.eventId, eventIdSource: 'provided' as const, timestamp: identity.timestamp };
      const expected = outcomeFromAction(action, TENANT)!;
      const stored = storedOutcomes(m, s.subject).filter(row => row.event_id === identity.eventId);
      expect.soft(stored.length, `${host}: P58.BA3 — one reward row for the click`).toBe(1);
      expect.soft(stored[0] ?? 'no reward row', `${host}: P58.BA3 — the reward row is outcomeFromAction's for the click (records.ts:401-439)`).toMatchObject(expected as unknown as Record<string, unknown>);
      // CONTROL: the comparison has teeth — the same click under another event id is another outcome.
      expect(outcomeFromAction({ ...action, eventId: crypto.randomUUID() }, TENANT)!.outcome_id === expected.outcome_id, `${host}: CONTROL — another event id is another outcome id`).toBe(false);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P58.BA4 — the route's own answer stands over a retained rejection, whatever its status
// ===========================================================================

/**
 * W14.05's oversized merge (src/routes/realtime.sdkContract.test.ts:3502-3530) on one
 * host, in process: two browsers' profile rows (sources crm and warehouse) applied by
 * the operator and both browsers linked to one account; a third browser with seven
 * more sources linked to it. The shopper calls go through src/units/_parity3.ts
 * `identityDoor` (the identity routes mounted as src/index.ts mounts them, on the
 * mounted app's bindings, with the framework's own answer to an error that escapes, as
 * W14.05's fixture app has), so whatever the shopper object answers reaches the test
 * as that object answered it. Returns the third browser's answer.
 */
async function oversizedMerge(host: Host): Promise<{ status: number; body: Record<string, unknown> }> {
  const m = await mount(host, DOCUMENTS);
  expectPublished(m, 'P58.BA4 — the tenant\'s documents publish');
  const door = identityDoor(m), secret = identitySecretOf(m);
  const operator = new Hono<{ Bindings: Mounted['env'] }>();
  operator.use('*', tenantMiddleware());
  operator.route('/v1', identityRoutes);
  const rows = async (list: unknown[]) => {
    const response = await operator.fetch(new Request(`https://ops.invalid/v1/${TENANT}/identity/events`, { method: 'POST',
      headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: list }) }), m.env);
    expect(response.status, `PRECONDITION (${host}): the operator's profile rows are applied (${(await response.clone().text()).slice(0, 200)})`).toBe(200);
    await door.drain();
  };
  const row = (subject: string, source: string, empty = false) => ({ kind: 'profile', version: 1, source, visitorId: subject, at: Date.now() - 1000,
    fields: empty ? {} : { tier: { type: 'string', meaning: 'Synthetic loyalty tier', value: 'gold' } }, audiences: empty ? {} : { vip: 'Synthetic provider VIP membership' } });
  const link = async (s: Shopper, accountId: string) => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    return door.call(`/v1/${TENANT}/identity/link`, s.grant.capability, { visitorId: s.subject, accountId, exp, assertion: await signAssertion(secret, TENANT as TenantId, s.subject, accountId, exp) });
  };
  const browser = async () => {
    const s = await shopperOn(m);
    expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${host}): the browser's page view is accepted`).toBe(200);
    return s;
  };
  const a = await browser(), b = await browser();
  await rows([row(a.subject, 'crm'), row(b.subject, 'warehouse')]);
  expect([(await link(a, 'p58-person')).status, (await link(b, 'p58-person')).status], `PRECONDITION (${host}): two browsers linked to one account carry two sources`).toEqual([200, 200]);
  const d = await browser();
  await rows(Array.from({ length: 7 }, (_, n) => row(d.subject, 'extra' + n, true)));
  const answer = await link(d, 'p58-person');
  return { status: answer.status, body: answer.body };
}

const NATIVE_SECRET = 'p58-native-operator-signing-material';
const NATIVE_IDENTITY = 'p58-native-identity-material';
/** The real src/index.ts in workerd; the doors only publish a tenant's documents and mint an anonymous grant (src/units/W37/LEDGER.unit.test.ts's idiom, :289-343). */
const NATIVE_WRAPPER = `
import worker, { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { PRIORS_KIND } from './src/learn/priors.ts';
import { newAnonymousSession } from './src/identity/sessionCapability.ts';
export { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== 'p58-fixture') return worker.fetch(request, env, ctx);
    const input = await request.json();
    if (url.pathname === '/publish') {
      const revision = value => ({ revision: 1, at: 1, actor: 'p58-native', note: '', value });
      await initializePublicationSet(env, [
        { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) }, { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
        { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) }, { kind: PRIORS_KIND, scope: input.tenant, revision: revision(input.priors) },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision(input.reflex) },
      ], '0:' + crypto.randomUUID());
      return Response.json({ published: input.tenant });
    }
    if (url.pathname === '/grant') return Response.json(await newAnonymousSession(env, input.tenant));
    return new Response(null, { status: 404 });
  },
};`;
let nativeBundle: Promise<string> | undefined;

/**
 * W14.05's oversized merge in workerd (src/units/_native.ts: the real src/index.ts,
 * SQLite-backed Durable Objects, KV and R2, no network) on one host, every step
 * awaited in turn: the same documents published, three browsers each with their
 * explicit choice and a page view, the operator's profile rows through
 * `POST /v1/:tenant/identity/events`, and the browsers' signed links through
 * `POST /v1/:tenant/identity/link`. Returns the third browser's answer.
 */
async function oversizedMergeNative(host: Host): Promise<{ status: number; body: Record<string, unknown> }> {
  const bundle = await (nativeBundle ??= bundleNativeWorker(NATIVE_WRAPPER, 'p58-ledger-native'));
  const directory = nativeScratchDirectory('p58-ledger-native-');
  const policy = { id: 'p58-native-policy', revision: 1, durationMs: 3650 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
  const runtime = await openNativeRuntime({ bundle, name: `p58-native-${host}`, persistDir: directory.path,
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket', DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
    kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
    bindings: { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host, JWT_SECRET: NATIVE_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      IDENTITY_SECRETS: `${TENANT}:${NATIVE_IDENTITY}`, LEDGER_RECOVERY_ENABLED: 'true', TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
      RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, policy])) } }) } });
  try {
    const door = async (path: string, body: unknown) => {
      const response = await runtime.fetch(`https://p58-fixture${path}`, { method: 'POST', body: JSON.stringify(body) });
      expect(response.status, `PRECONDITION (${host} native): fixture door ${path}`).toBe(200);
      return await response.json() as Record<string, unknown>;
    };
    await door('/publish', { tenant: TENANT, content: { version: 'p58-native', pieces: MODULES }, slots: DOCUMENTS.slots, learn: DOCUMENTS.learn, priors: EMPTY_PRIORS, reflex: REFLEX_DOCUMENT });
    const token = await new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a')
      .setExpirationTime('2h').sign(new TextEncoder().encode(NATIVE_SECRET));
    const browser = async () => {
      const g = await door('/grant', { tenant: TENANT }) as unknown as { capability: string; subject: string; sessionId: string; grantId: string; iat: number; exp: number };
      const call = async (path: string, body: unknown) => {
        const response = await runtime.fetch(`https://shop.example${path}`, { method: 'POST',
          headers: { 'X-Tenant': TENANT, 'X-Shopper-Session': g.capability, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const text = await response.text();
        let parsed: Record<string, unknown>; try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = { text }; }
        return { status: response.status, body: parsed };
      };
      expect((await call(`/realtime/session/${g.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: g.grantId, iat: g.iat, exp: g.exp } })).status, `PRECONDITION (${host} native): the browser's explicit choice`).toBe(200);
      expect((await call('/realtime/action', { ...PAGE_VIEW, source: 'sdk', userId: g.subject, sessionId: g.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() })).status,
        `PRECONDITION (${host} native): the browser's page view`).toBe(200);
      const link = async (accountId: string) => {
        const exp = Math.floor(Date.now() / 1000) + 300;
        return call(`/v1/${TENANT}/identity/link`, { visitorId: g.subject, accountId, exp, assertion: await signAssertion(NATIVE_IDENTITY, TENANT as TenantId, g.subject, accountId, exp) });
      };
      return { subject: g.subject, link };
    };
    const rows = async (list: unknown[]) => {
      const response = await runtime.fetch(`https://ops.example/v1/${TENANT}/identity/events`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: list }) });
      expect(response.status, `PRECONDITION (${host} native): the operator's profile rows are applied (${(await response.text()).slice(0, 200)})`).toBe(200);
    };
    const row = (subject: string, source: string, empty = false) => ({ kind: 'profile', version: 1, source, visitorId: subject, at: Date.now() - 1000,
      fields: empty ? {} : { tier: { type: 'string', meaning: 'Synthetic loyalty tier', value: 'gold' } }, audiences: empty ? {} : { vip: 'Synthetic provider VIP membership' } });
    const a = await browser(), b = await browser();
    await rows([row(a.subject, 'crm'), row(b.subject, 'warehouse')]);
    expect([(await a.link('p58-person')).status, (await b.link('p58-person')).status], `PRECONDITION (${host} native): two browsers linked to one account carry two sources`).toEqual([200, 200]);
    const d = await browser();
    await rows(Array.from({ length: 7 }, (_, n) => row(d.subject, 'extra' + n, true)));
    return await d.link('p58-person');
  } finally { await runtime.dispose(); directory.remove(); }
}

/** How `runOwnerOperation` settles an answer of `status` while a retained piece of its work rejects with `retained`. */
async function drainOf(status: number, retained: Error): Promise<string> {
  const owner = {};
  try {
    const answer = await runOwnerOperation(owner, {} as Mounted['env'], async () => {
      retainOwnerWork(Promise.reject(retained));
      return new Response('{}', { status });
    });
    return `answered ${(answer as Response).status}`;
  } catch (error) { return `failed with ${error instanceof SessionAccessError ? 'SessionAccessError' : (error as Error).message}`; }
}

describe('unit:P58.BA4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): W14.05's oversized identity merge reaches the shopper as the shopper object's own 400 Validation error naming "at most8 sources", not as the framework's untyped 500 for an error rethrown after it`, async () => {
      const answer = await oversizedMerge(host);
      expect([answer.status, answer.body.error, (answer.body.details as Array<{ message?: unknown }> | undefined)?.map(detail => detail.message)],
        `${host}: P58.BA4 — the route's own answer stands (profileEnrichment.ts:18 refused by the owner's error path, error.ts:19-27): ${show(answer.body)}`)
        .toEqual([400, 'Validation error', ['at most8 sources']]);
    }, 120_000);
  }

  for (const host of HOSTS) {
    it(`native (${host}): R-P106 — in workerd too, W14.05's oversized identity merge reaches the shopper as the route's own 400 Validation error naming "at most8 sources": the refusal raised in the account's own shopper object crosses the Durable Object boundary typed`, async () => {
      const answer = await oversizedMergeNative(host);
      expect([answer.status, answer.body.error, (answer.body.details as Array<{ message?: unknown }> | undefined)?.map(detail => detail.message)],
        `${host} native: P58.BA4 (R-P106) — the browser-side route answers its own 400 with the same details, not a 500: ${show(answer.body)}`)
        .toEqual([400, 'Validation error', ['at most8 sources']]);
    }, 120_000);
  }

  it('logic: after a 4xx answer of its work, a retained rejection inside the owner leaves that answer standing (sessionAuthority.ts runOwnerOperation, :537)', async () => {
    expect.soft(await drainOf(400, new Error('retained work failed')), 'P58.BA4 — a 400 the route answered stands').toBe('answered 400');
    expect.soft(await drainOf(409, new Error('retained work failed')), 'P58.BA4 — a 409 the route answered stands').toBe('answered 409');
  });

  it('CONTROL (kept by the P57 build, sessionAuthority.ts:537-547): a 5xx answer stands; a retained SessionAccessError still refuses after any answer; a retained rejection still fails a 2xx answer', async () => {
    expect(await drainOf(500, new Error('retained work failed')), 'CONTROL — a 500 the route answered stands (:537, :543)').toBe('answered 500');
    expect(await drainOf(400, new SessionAccessError()), 'CONTROL — a retained authority refusal refuses after a 400 (:543)').toBe('failed with SessionAccessError');
    expect(await drainOf(503, new SessionAccessError()), 'CONTROL — and after a 503 (:543)').toBe('failed with SessionAccessError');
    expect(await drainOf(200, new Error('retained work failed')), 'CONTROL — a retained rejection fails a 200 answer (:544, :547)').toBe('failed with retained work failed');
  });
});

// ===========================================================================
// unit:P58.BA5 — lock: the replay of a still-pending operation answers pending, its effects once
// ===========================================================================

describe('unit:P58.BA5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a same-id re-send of a render acknowledgement whose effects are still pending answers pending at admission while its queue send is held, and after release its effects complete once (one ledger row, one exposure); a later re-send answers recovered`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p58-ba5');
      const d = layout[0]!;
      const operation = await operationOf('decisions', s.subject, d.decisionId!);
      const fault = failReadOnceAfterAdmission(m, s.subject, 'recoveryOperation:' + operation, 'P58 unit lever: the first read after the admission failed once');
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      let first: Awaited<ReturnType<typeof ackWire>>;
      try { first = await ackWire(app, s, page, d, identity); await settle(m, app); } finally { fault.restore(); }
      await m.drainLedger();
      expect([first.status, first.body.render, fault.failed, decisionAdmissionOf(m, s.subject, d.decisionId!)?.meta.receipt.source.state, rowsOf(storedDecisions(m, s.subject), d.decisionId).length, rounded(await learned(m), 'n')],
        `${host}: PRECONDITION — answered pending at admission, its continuation failed once, the operation is pending with nothing effected`)
        .toEqual([200, renderReceipt(page, d, identity, 'pending'), 1, 'pending', 0, {}]);

      const held = holdQueue(m);
      const sent = ackWire(app, s, page, d, identity);
      let answer: Awaited<typeof sent> | typeof UNANSWERED = UNANSWERED;
      try { answer = await within(sent, HOLD_BOUND_MS); } finally { held.release(); }
      const eventual = await sent;
      await settle(m, app);
      await m.drainLedger();
      expect.soft(answer === UNANSWERED ? `${UNANSWERED} within ${HOLD_BOUND_MS} ms while the queue send was held (answered ${eventual.status} ${show(eventual.body.render)} only after its release)` : [answer.status, answer.body.render],
        `${host}: P58.BA5 — the re-send of the still-pending operation answers pending at admission (recovery.ts:153) while its queue send is held`)
        .toEqual([200, renderReceipt(page, d, identity, 'pending')]);
      expect.soft([decisionAdmissionOf(m, s.subject, d.decisionId!)?.meta.receipt.source.state, rowsOf(storedDecisions(m, s.subject), d.decisionId).length, rounded(await learned(m), 'n')],
        `${host}: P58.BA5 — after release the effects completed once: the operation recovered, one ledger row, the exposure counted once`).toEqual(['recovered', 1, { [d.contentId]: 1 }]);
      const third = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      expect.soft([third.status, third.body.render], `${host}: P58.BA5 — a later re-send answers recovered`).toEqual([200, renderReceipt(page, d, identity, 'recovered')]);
    }, 60_000);
  }
});
