// src/units/P57/LEDGER.unit.test.ts
// P57 under the Closure Ledger: the tests for the LOCAL criteria RC1-RC3 of the P57
// work order (the acknowledgement programme of amendment 5, ticket P57 "A
// same-id acknowledgement re-send is idempotent; a conflicting one answers a typed
// 409, never an untyped 500"). LV1 is a deferred live row and gets no test. D1
// (RESOLVED, R-P99) is exercised inside RC1 and RC2.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-5/BTI-Parity-Amendment-2026-10-19.md, section 2, P57):
//   "P57 — a same-id re-send is idempotent; a conflicting one is told. On both hosts,
//   a re-send carrying the same `eventId` and `pageInstance` for the same decision
//   answers 200 with the original receipt whatever the engine's clock did to the first
//   delivery's timestamp (the stored `rendered.at` is reused; the behaviour record id
//   is identical; one ledger row); a different `eventId` on an already-acknowledged
//   decision answers a typed 409 with words naming the conflict; the owner's drain
//   never turns a retained admission failure into an untyped 500 after the route has
//   answered. W23's first-delivery clamp and the digest functions do not change."
//
// One `describe('unit:P57.<criterion>')` per LOCAL criterion, each walked on both
// shopper hosts through the parity harness. Expected values come from the work order,
// the amendment, the analysis it cites (_evidence/baseline-52/ack-latency/ANALYSIS.md,
// track-analyst at afa24293, §5) and the engine's own code and functions, never from
// what the engine answers today:
//   · the conflict today: the route admits a client time ahead of the engine AT the
//     engine's present (W23, src/routes/realtime.ts:166-184), that time becomes the
//     render's `rendered.at` (src/content/renderOffer.ts:107), so a same-id re-send
//     admitted at a later present carries another `rendered.at`, `sourceOf`
//     (src/ledger/recovery.ts:81-82) another digest under the same operation id (:149),
//     and :152 throws "Recovery logical conflict"; the route's own catch answers its
//     500 (realtime.ts:423-437), then the owner's drain rethrows the retained admission
//     (src/identity/sessionAuthority.ts:504-508) and the worker's error handler answers
//     `{"error":"Internal server error","message":"Recovery logical conflict"}`
//     (src/middleware/error.ts:30-37). Measured on this harness at 9026e8b5 on both
//     hosts (_evidence/parity-step3/S9/specifier/logs/probe-base.log and probe-two.log), as the
//     analysis reproduced it 13/13 on a stamp-profile rig;
//   · the receipt: the render acknowledgement `{ version: 1, decisionId, eventId,
//     pageInstance, status: 'durable', source }` (renderOffer.ts:23-26, :110-111; kit
//     02:869), the behaviour persistence `{ status: 'durable', recordId, receipt }`
//     (src/ledger/behavior.ts:44) whose record id is
//     `<tenant>:<ts36(time)>:<subject>:behavior:<eventId>` (:38) and whose operation id
//     is the engine's `recoveryDigest({ kind, tenant, subject, ids })` (recovery.ts:149);
//   · a typed refusal of the shopper's owner: an error the owner maps by its class to
//     a status and `{ ok: false, error: <words> }` — the owner app's `onError` maps
//     `SessionAccessError` (src/identity/sessionCapability.ts) to 401 `{ ok: false,
//     error: 'Shopper session unavailable' }` (sessionAuthority.ts:670-671), the
//     object's catch does the same (ShopperReflex.ts:535), and the object's typed 409
//     answers `{ ok: false, error: 'Consent choice conflict' }` (ShopperReflex.ts:972);
//     the work order's remaining work maps the new conflict "to 409 in ShopperReflex
//     and the owner app's onError", the same two places;
//   · W06's commitments, compared with the engine's own exported functions
//     (`recoveryDigest`, `recoveryJSON`) over what the shopper object stores (as
//     src/units/P56/LEDGER.unit.test.ts AA4 compares them).
//
// THE READINGS THIS FILE RULES (one representation with P56):
//   · "The original receipt": the render receipt's members other than `source`, and
//     the behaviour persistence's `status`, `recordId` and `receipt.operation`. `source`
//     reports the progress of the same admission: P56 answers a first acknowledgement
//     `pending` and "a same-id re-send after the effects ... `recovered`", so the
//     re-send here, sent after the first answer's work drained, answers `recovered`.
//   · "The stored `rendered.at` is reused": the one ledger row carries the time the
//     FIRST delivery was admitted at (the engine's present then, between the moments
//     the test sent it and received its answer, and before the client's time), and the
//     behaviour record carries the same time in its id and its `ts`.
//   · "A typed 409 with words naming the conflict": status 409, exactly the members
//     `error` and `ok`, `ok: false`, and `error` saying it is a conflict, that the
//     decision was already acknowledged, and that the event id differs (for example
//     "render acknowledgement conflict: this decision was already acknowledged with
//     another event id"); nothing written: no second ledger row, no behaviour record of
//     the refused event, the shopper object's recovery state byte for byte.
//   · "The owner's drain never turns a retained admission failure into an untyped 500
//     after the route has answered": when the admission fails (the shopper object's
//     storage refuses its transaction, src/units/_parity8.ts `refuseAdmission`), the
//     shopper receives the route's own answer to it, status and body:
//     `500 { error: 'Failed to process action event', details: <the failure's message> }`
//     (realtime.ts:432-437). P56.AA4 locks the status of the same answer (500, no
//     render receipt), which this keeps.
//   · "The in-flight same-id duplicate": a re-send with the first delivery's identity,
//     sent while the first acknowledgement's queue send is held (the first request
//     still unanswered today; its effects still running under P56), so it waits in the
//     shopper object's serializer behind the work that holds the queue.
//
// R10 (tests that lock the present behaviour, listed for the lead; none is edited
// here): no test asserts the "Recovery logical conflict" text or a 500 for a re-sent
// or conflicting render acknowledgement (grep at 9026e8b5); the W15 refusal legs of
// src/routes/realtime.sdkContract.test.ts and src/index.api-boundary.test.ts assert
// `>= 400`, which a 409 keeps; under a sketch of P56 and P57 on a scratch copy the whole
// suite failed nothing P57's change could explain (_evidence/parity-step3/S9/specifier/logs/
// sketch-full.json). See the S9 specifier report.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the 409
// refusal and its words. No new export is imported.
//
// FIXTURE. P02's world (src/units/P02/LEDGER.unit.test.ts:100-105), as P56's file
// builds it: the declared rendered-v1 layout slot, one shopper with their explicit
// choice and a page view, their product page with its page instance, the cold layout.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts) and src/units/_parity8.ts (the worker's error path,
// the wire without a drain, the levers and the readers). Imports from src/units/:
// ../_parity, ../_parity8.

import { describe, expect, it } from 'vitest';

import type { RecoveryInput } from '@/ledger/recovery';
import { recoveryDigest, recoveryJSON } from '@/ledger/recovery';
import { parseId, ts36 } from '@/ledger/records';

import {
  declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learned, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, recentSlot, rounded, shopperOn, storedDecisions, TENANT, type Decision, type Host, type Mounted, type Shopper, type Snapshot,
} from '../_parity';
import {
  ackWire, admissionsOf, decisionAdmissionOf, holdQueue, refuseAdmission, rowsOf, settle, shopperHeld, storedBehavior, w06SourceOf, within,
  workerApp, type Identity, type Wire, type WorkerApp,
} from '../_parity8';

const DOCUMENTS = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
/** P02's cold layout (src/units/P02/LEDGER.unit.test.ts:105). */
const COLD_LAYOUT = [M.grid, M.reco1, M.reco2, M.editorial];
/** The client's clock ahead of the engine's by 3 s, as the analysis reproduced the conflict (ANALYSIS §5). */
const AHEAD_MS = 3_000;
/** Nothing resolves a held queue send: a wait on it is bounded, never open. */
const HOLD_BOUND_MS = 4_000;
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);

interface World { m: Mounted; app: WorkerApp; s: Shopper; page: Snapshot; layout: Decision[] }

/** P02's world on one host: published, one shopper with their choice and a page view, their product page with its page instance. */
async function world(host: Host, label: string): Promise<World> {
  const m = await mount(host, DOCUMENTS);
  expectPublished(m, 'P57 — the product page with its declared rendered-v1 layout slot (P02) publishes');
  const app = workerApp(m);
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${host}): the shopper's page view is accepted`).toBe(200);
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `PRECONDITION (${host}): the shopper's product page is served (${show(page.body)})`).toBe(200);
  const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
  expect(layout.map(d => d.contentId), `PRECONDITION (${host}): the cold layout (P02.A2)`).toEqual(COLD_LAYOUT);
  for (const d of layout) expect(d.renderOffer, `PRECONDITION (${host}): ${d.contentId} is offered for a render acknowledgement (rendered-v1)`).toMatch(/^ro1\./);
  return { m, app, s, page, layout };
}

/** The render receipt's identity: every member but `source` (renderOffer.ts:23-26, :110-111). */
const receiptIdentity = (page: Snapshot, d: Decision, identity: Identity) =>
  ({ version: 1, decisionId: d.decisionId, eventId: identity.eventId, pageInstance: page.pageInstance, status: 'durable' });
const identityOf = (render: unknown) => {
  if (!render || typeof render !== 'object') return `no render receipt (${show(render)})`;
  return Object.fromEntries(Object.entries(render as Record<string, unknown>).filter(([key]) => key !== 'source'));
};
const sourceOf = (wire: Wire) => (wire.body.render as { source?: unknown } | undefined)?.source;
/** The behaviour persistence's identity: its status, record id and operation id (behavior.ts:44). */
const behaviorIdentityOf = (behavior: unknown) => {
  const b = behavior as { status?: unknown; recordId?: unknown; receipt?: { operation?: unknown } } | undefined;
  return b ? { status: b.status, recordId: b.recordId, operation: b.receipt?.operation } : 'no behaviour persistence';
};
/** The record id of the behaviour capture (behavior.ts:38) for an event admitted at `at`. */
const behaviorIdOf = (s: Shopper, identity: Identity, at: number) => `${TENANT}:${ts36(at)}:${s.subject}:behavior:${identity.eventId}`;
const operationOf = (kind: RecoveryInput['kind'], subject: string, id: string) => recoveryDigest({ kind, tenant: TENANT, subject, ids: [id] });
/** What the refusal's words name, against the ruling: a conflict, an acknowledgement already made, another event id. */
function wordsOf(error: unknown) {
  const text = String(error ?? '');
  return { conflict: /\bconflict/i.test(text), acknowledged: /\balready acknowledged\b/i.test(text), event: /\bevent ?id\b/i.test(text) };
}
const NAMED = { conflict: true, acknowledged: true, event: true };
const later = () => new Promise(resolve => setTimeout(resolve, 5));

// ===========================================================================
// unit:P57.RC1 — a same-id re-send of a clamped first delivery is idempotent
// ===========================================================================

describe('unit:P57.RC1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a first delivery whose client time is ${AHEAD_MS / 1000} s ahead of the engine, then a re-send with the same eventId and pageInstance: 200 twice with the same receipt, the stored render time reused, one ledger row and one behaviour record`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p57-rc1');
      const d = layout[0]!;
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() + AHEAD_MS };
      const before = Date.now();
      const first = await ackWire(app, s, page, d, identity);
      const after = Date.now();
      await settle(m, app);
      await later(); // the re-send is admitted at a later engine millisecond
      const second = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      await m.drainLedger();

      expect.soft([first.status, second.status], `${host}: P57.RC1 — both deliveries answer 200 (second: ${show(second.body)})`).toEqual([200, 200]);
      expect.soft([identityOf(first.body.render), identityOf(second.body.render)], `${host}: P57.RC1 — with the same render receipt`)
        .toEqual([receiptIdentity(page, d, identity), receiptIdentity(page, d, identity)]);
      expect.soft(sourceOf(second), `${host}: P57.RC1 — the re-send, after the first's effects ran, answers recovered (P56)`).toBe('recovered');
      const rows = rowsOf(storedDecisions(m, s.subject), d.decisionId);
      const at = rows[0]?.rendered?.at ?? Number.NaN;
      expect.soft(rows.length === 1 && at >= before && at <= after && at < identity.timestamp ? 'one row, admitted at the first delivery'
        : `rows ${show(rows.map(row => row.rendered))} (first sent ${before}, answered ${after}, client time ${identity.timestamp})`,
      `${host}: P57.RC1 — one ledger row, its render time the engine's present at the first delivery (W23 clamp)`).toBe('one row, admitted at the first delivery');
      expect.soft(rows.map(row => row.rendered), `${host}: P57.RC1 — the row's render is the first delivery's`)
        .toEqual([{ version: 1, eventId: identity.eventId, at, pageInstance: page.pageInstance }]);
      const recordId = behaviorIdOf(s, identity, at);
      const behavior = { status: 'durable', recordId, operation: await operationOf('behavior', s.subject, recordId) };
      expect.soft([behaviorIdentityOf(first.body.behavior), behaviorIdentityOf(second.body.behavior)], `${host}: P57.RC1 — the behaviour record id is identical on both answers, the first delivery's time in it`)
        .toEqual([behavior, behavior]);
      expect.soft(storedBehavior(m, s.subject).filter(row => row.event_id === identity.eventId).map(row => [row.record_id, row.ts]), `${host}: P57.RC1 — one behaviour record, at the first delivery's time`)
        .toEqual([[recordId, at]]);
      expect.soft(rounded(await learned(m), 'n'), `${host}: P57.RC1 — the exposure counted once`).toEqual({ [d.contentId]: 1 });
    }, 60_000);

    it(`host (${host}): CONTROL — the same two deliveries with a client time at the engine's present are answered 200 twice with the same receipt (ANALYSIS §5 control): the conflict is the clamp's`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p57-rc1-control');
      const d = layout[0]!;
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const first = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      await later();
      const second = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      expect([first.status, second.status, identityOf(second.body.render)], `${host}: CONTROL — 200 twice (${show(second.body)})`)
        .toEqual([200, 200, receiptIdentity(page, d, identity)]);
    }, 60_000);
  }

  it('CONTROL: the answer the engine gives today to the clamped re-send (500, the worker\'s untyped body) does not satisfy RC1', () => {
    const today = { status: 500, body: { error: 'Internal server error', message: 'Recovery logical conflict' } };
    expect(() => expect([200, today.status]).toEqual([200, 200]), 'CONTROL — a 500 re-send fails RC1').toThrow();
    expect(identityOf((today.body as Record<string, unknown>).render), 'CONTROL — and carries no receipt').toBe('no render receipt (undefined)');
  });
});

// ===========================================================================
// unit:P57.RC2 — a different eventId on an acknowledged decision is a typed 409
// ===========================================================================

describe('unit:P57.RC2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a different eventId on an already-acknowledged decision answers a typed 409 { ok: false, error } whose words name the conflict, and writes nothing: one ledger row, no behaviour record of the refused event, the recovery state byte for byte`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p57-rc2');
      const d = layout[0]!;
      const acknowledged = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const first = await ackWire(app, s, page, d, acknowledged);
      await settle(m, app);
      expect(first.status, `${host}: PRECONDITION — the decision is acknowledged (${show(first.body)})`).toBe(200);
      const state = JSON.stringify(admissionsOf(m, s.subject));

      await later();
      const conflicting = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const second = await ackWire(app, s, page, d, conflicting);
      await settle(m, app);
      await m.drainLedger();
      expect.soft(second.status, `${host}: P57.RC2 — the conflicting acknowledgement answers 409 (${show(second.body)})`).toBe(409);
      expect.soft([Object.keys(second.body).sort(), second.body.ok], `${host}: P57.RC2 — a typed refusal of the owner: exactly { ok: false, error } (sessionAuthority.ts:670-671; ShopperReflex.ts:535, :972)`)
        .toEqual([['error', 'ok'], false]);
      expect.soft(wordsOf(second.body.error), `${host}: P57.RC2 — whose words name the conflict: a conflict, the decision already acknowledged, another event id (${String(second.body.error)})`).toEqual(NAMED);
      expect.soft(JSON.stringify(admissionsOf(m, s.subject)) === state, `${host}: P57.RC2 — the refusal writes nothing to the shopper object's recovery state`).toBe(true);
      expect.soft(rowsOf(storedDecisions(m, s.subject), d.decisionId).map(row => row.rendered?.eventId), `${host}: P57.RC2 — no second ledger row: the one row is the first acknowledgement's`)
        .toEqual([acknowledged.eventId]);
      expect.soft(storedBehavior(m, s.subject).filter(row => row.event_id === conflicting.eventId), `${host}: P57.RC2 — no behaviour record of the refused event`).toEqual([]);
      expect.soft(rounded(await learned(m), 'n'), `${host}: P57.RC2 — the exposure counted once`).toEqual({ [d.contentId]: 1 });
      // CONTROL: the refusal left the acknowledged admission as it was — its own re-send is still the idempotent replay.
      const replay = await ackWire(app, s, page, d, acknowledged);
      await settle(m, app);
      expect([replay.status, identityOf(replay.body.render), sourceOf(replay)], `${host}: CONTROL — the first acknowledgement's re-send is answered as before (${show(replay.body)})`)
        .toEqual([200, receiptIdentity(page, d, acknowledged), 'recovered']);
    }, 60_000);
  }

  it('CONTROL: the words check refuses the engine\'s untyped message today ("Recovery logical conflict" names neither the acknowledgement nor the event id), and the members check refuses the worker\'s untyped body', () => {
    expect(wordsOf('Recovery logical conflict'), 'CONTROL — today\'s message does not name the conflict as ruled').toEqual({ conflict: true, acknowledged: false, event: false });
    expect(Object.keys({ error: 'Internal server error', message: 'Recovery logical conflict' }).sort(), 'CONTROL — the untyped body has other members').toEqual(['error', 'message']);
  });
});

// ===========================================================================
// unit:P57.RC3 — locks, and the drain never answers an untyped 500 after the route answered
// ===========================================================================

describe('unit:P57.RC3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — W23's clamp: a first delivery whose client time is ahead of the engine is admitted at the engine's present (render time and behaviour time), and one whose time is at or before it exactly as given (realtime.ts:166-184)`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p57-rc3-clamp');
      const [d, past] = [layout[0]!, layout[1]!];
      const ahead = { eventId: crypto.randomUUID(), timestamp: Date.now() + AHEAD_MS };
      const before = Date.now();
      const first = await ackWire(app, s, page, d, ahead);
      const after = Date.now();
      await settle(m, app);
      const given = { eventId: crypto.randomUUID(), timestamp: parseId(past.decisionId!)!.ts };
      const second = await ackWire(app, s, page, past, given);
      await settle(m, app);
      await m.drainLedger();
      expect([first.status, second.status], `${host}: PRECONDITION — both are admitted (${show(first.body)} ${show(second.body)})`).toEqual([200, 200]);
      const at = rowsOf(storedDecisions(m, s.subject), d.decisionId)[0]?.rendered?.at ?? Number.NaN;
      expect.soft(at >= before && at <= after && at < ahead.timestamp ? 'at the engine\'s present' : `at ${at} (sent ${before}, answered ${after}, client ${ahead.timestamp})`,
        `${host}: P57.RC3 — a client time ahead of the engine is admitted at the engine's present (realtime.ts:183-184)`).toBe('at the engine\'s present');
      expect.soft(storedBehavior(m, s.subject).filter(row => row.event_id === ahead.eventId).map(row => [row.record_id, row.ts]), `${host}: P57.RC3 — the behaviour record at the same present`)
        .toEqual([[behaviorIdOf(s, ahead, at), at]]);
      expect.soft([rowsOf(storedDecisions(m, s.subject), past.decisionId).map(row => row.rendered?.at), storedBehavior(m, s.subject).filter(row => row.event_id === given.eventId).map(row => row.ts)],
        `${host}: P57.RC3 — a time at or before the engine's present is admitted exactly as given`).toEqual([[given.timestamp], [given.timestamp]]);
    }, 60_000);

    it(`host (${host}): LOCK — W06's commitments for a clamped first delivery: the operation id, the source digest of sourceOf, the payload digest and the logical key are the engine's own functions of what is stored`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p57-rc3-digest');
      const d = layout[0]!;
      const ahead = { eventId: crypto.randomUUID(), timestamp: Date.now() + AHEAD_MS };
      const first = await ackWire(app, s, page, d, ahead);
      await settle(m, app);
      expect(first.status, `${host}: PRECONDITION — the clamped first delivery is admitted (${show(first.body)})`).toBe(200);
      const admission = decisionAdmissionOf(m, s.subject, d.decisionId!);
      expect(admission?.payload ? 'admitted' : 'no admission', `${host}: PRECONDITION — the shopper object holds the decision's admission`).toBe('admitted');
      const { id, meta, text, payload } = admission!;
      const input = payload!.input as Extract<RecoveryInput, { kind: 'decisions' }>;
      expect.soft([id, meta.digest, meta.payloadDigest, text], `${host}: P57.RC3 — operation id (recovery.ts:149), sourceOf digest (:81-82), payload digest and text (:100-106) unchanged`)
        .toEqual([await operationOf('decisions', s.subject, d.decisionId!), await recoveryDigest(w06SourceOf(input)), await recoveryDigest(payload), recoveryJSON(payload)]);
      const logical = shopperHeld(m, s.subject, 'recoveryLogical:' + await recoveryDigest({ stream: 'decision', id: d.decisionId }));
      expect.soft(logical, `${host}: P57.RC3 — the logical key holds the operation and its digest (recovery.ts:112-120)`).toEqual({ operation: id, digest: meta.digest });
      // CONTROL: the digest commits to the render time — the same input at another time is another digest.
      const moved = { ...input, records: input.records.map(row => ({ ...row, rendered: { ...row.rendered!, at: row.rendered!.at + 1 } })) } as RecoveryInput;
      expect(await recoveryDigest(w06SourceOf(moved)) === meta.digest, `${host}: CONTROL — another render time is another source digest (why the clamped re-send conflicts today)`).toBe(false);
    }, 60_000);

    it(`host (${host}): LOCK — the in-flight same-id duplicate: a re-send with the first delivery's identity, sent while the first acknowledgement's queue send is held, waits in the serializer and answers 200 recovered with the same receipt; one ledger row, one behaviour record, one exposure`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p57-rc3-inflight');
      const d = layout[0]!;
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const held = holdQueue(m);
      const first = ackWire(app, s, page, d, identity);
      let duplicate: Promise<Wire> | undefined;
      let reached = false;
      try {
        // R10 (P110.GS4, E34, R-P738; by name, R-P716): the held queue send is awaited by its recorded event, never against
        // a wall-clock bound; a first acknowledgement that makes none fails on this leg's own timeout.
        while (!reached) { await later(); reached = held.sends > 0; }
        if (reached) { duplicate = ackWire(app, s, page, d, identity); await within(duplicate, 50); }
      } finally { held.release(); }
      const [a, b] = [await first, duplicate ? await duplicate : undefined];
      await settle(m, app);
      await m.drainLedger();
      expect(reached ? 'held' : `the first acknowledgement made no queue send within ${HOLD_BOUND_MS} ms`, `${host}: PRECONDITION — the first acknowledgement's queue send is held`).toBe('held');
      expect.soft(a.status, `${host}: P57.RC3 — the first acknowledgement answers 200 (${show(a.body)})`).toBe(200);
      expect.soft(b ? [b.status, identityOf(b.body.render), sourceOf(b)] : 'no duplicate', `${host}: P57.RC3 — the in-flight duplicate answers 200 recovered with the same receipt (${show(b?.body)})`)
        .toEqual([200, receiptIdentity(page, d, identity), 'recovered']);
      expect.soft([rowsOf(storedDecisions(m, s.subject), d.decisionId).length, storedBehavior(m, s.subject).filter(row => row.event_id === identity.eventId).length, rounded(await learned(m), 'n')],
        `${host}: P57.RC3 — one ledger row, one behaviour record, one exposure`).toEqual([1, 1, { [d.contentId]: 1 }]);
    }, 60_000);

    it(`host (${host}): when the admission fails after the route has answered it, the shopper receives the route's own answer — 500 { error: 'Failed to process action event', details } (realtime.ts:432-437) — and not the drain's untyped 500 (sessionAuthority.ts:504-508, error.ts:30-37); the same acknowledgement is admitted once the storage accepts it`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p57-rc3-drain');
      const d = layout[0]!;
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const failure = 'P57 unit lever: the shopper object refused the admission transaction';
      const restore = refuseAdmission(m, s.subject, failure);
      let refused: Wire;
      try { refused = await ackWire(app, s, page, d, identity); await settle(m, app); }
      finally { restore(); }
      expect.soft({ status: refused.status, body: refused.body }, `${host}: P57.RC3 — the route's own answer to the failed admission, not the owner's drain rethrowing it (answered ${refused.status} ${show(refused.body)})`)
        .toEqual({ status: 500, body: { error: 'Failed to process action event', details: failure } });
      // CONTROL: the failure was the lever's — the same acknowledgement is admitted once the storage accepts it.
      const admitted = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      expect([admitted.status, identityOf(admitted.body.render)], `${host}: CONTROL — admitted once the storage accepts it (${show(admitted.body)})`).toEqual([200, receiptIdentity(page, d, identity)]);
    }, 60_000);
  }

  it('CONTROL: the drain\'s untyped body today does not satisfy the ruled answer', () => {
    const failure = 'P57 unit lever: the shopper object refused the admission transaction';
    expect(() => expect({ status: 500, body: { error: 'Internal server error', message: failure } }).toEqual({ status: 500, body: { error: 'Failed to process action event', details: failure } }),
      'CONTROL — the worker\'s untyped 500 fails RC3').toThrow();
  });
});
