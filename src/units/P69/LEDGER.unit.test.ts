// src/units/P69/LEDGER.unit.test.ts
// P69 under the Closure Ledger: the tests for the LOCAL criteria AK1-AK2 of the P69 work
// order (the clock-and-budget programme of amendment 9, ticket P69 "The acknowledgement is
// admitted at the decision's time"). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-9/BTI-Parity-Amendment-2026-10-20c.md, section 2, P69):
//   "P69 — the acknowledgement is admitted at the decision's time. On both hosts, a render
//   acknowledgement whose client timestamp is earlier than the decision's engine time is
//   admitted with `admitted.at` (and the behaviour record's time) equal to the decision's time,
//   never refused for that reason; a client clock ahead of the engine is still clamped to the
//   engine's present (W23); a re-send keeps the first admission's time (P57); `rendered.at >= ts`
//   holds on every ledger row; no new remote call before the answer; the other refusals of P56
//   AA4 (unknown decision, another shopper's decision, outside the window) unchanged; kit 02 :933
//   says it. The specification updates P56 AA4's ":434 a time before the decision is refused"
//   variant (test-only, R10)."
// The work order (docs/parity/clock-and-budget/program.json, P69), remaining work: "Drop the
// client-before-decision refusal at renderOffer.ts:102; admit a first delivery at
// max(event.timestamp, record.ts) at :118; kit 02 :933 sentence; the specification updates P56
// AA4's :434 variant (R10, test-only)." Its decision D1 (R-P171): "The clamp (the lower bound
// matching W23's upper bound) is the fix; no SDK-only fix because old bundles stay in use."
//
// One `describe('unit:P69.<criterion>')` per LOCAL criterion, both shopper hosts, through the
// parity harness. Expected values come from the amendment, the work order and the analysis they
// cite (_evidence/baseline-52/ack-401/ANALYSIS.md, ACK-401, track-analyst at f7cbf331: §1 the
// path, §3 the local reproduction and its probe logs/ack401-probe.unit.test.ts, §8 the fix shape
// and its sketch logs/fix-sketch.diff), and the engine's own functions, never from what the engine
// answers today:
//   · the decision's engine time: the time its id carries (`parseId(decisionId).ts`, the
//     record's `ts`: src/content/decide.ts, ANALYSIS §1), which the offer seals;
//   · the render receipt: `{ version: 1, decisionId, eventId, pageInstance, status: 'durable',
//     source }` (renderOffer.ts `RenderAcknowledgment`), `pending` on a first answer (P56.AA1,
//     the same fixture: one representation), `recovered` on a re-send after the effects (P57);
//   · the admitted time: the `rendered` member the redemption writes onto the decision,
//     `{ version: 1, eventId, at, pageInstance }`, read from the shopper object's admission
//     (src/units/_parity8.ts `decisionAdmissionOf`) and from the ledger row;
//   · the behaviour record of the same request: `<tenant>:<ts36(time)>:<subject>:behavior:
//     <eventId>` (src/ledger/behavior.ts), its time the render's admitted time
//     (realtime.ts: "a re-send of an acknowledged render carries the time that render was
//     admitted at", `actionEvent.timestamp = redeemed.at`);
//   · the ledger's invariant: `validDecisionMeasurement` requires `rendered.at >= ts`
//     (src/ledger/records.ts), enforced by the writer, the report and the replay (ANALYSIS §3:
//     with the refusal dropped and the client's time kept, the acknowledgement answers 500).
//
// THE READINGS THIS FILE RULES:
//   · "150 ms behind, sent the moment the snapshot answers": the acknowledgement carries the
//     decision's engine time minus LAG_MS as its client timestamp (the walker machine's lag
//     10:00-11:00Z on 2026-10-20, ANALYSIS §3-§4; the observable's own number), and is sent the
//     moment the product page's snapshot answers: the snapshot on the wire without a drain
//     (`snapshotWire` below, the body src/units/_parity.ts `snapshot` sends), as the analyst's
//     probe sent it ("NO drain anywhere between the calls"), then the acknowledgement at once.
//   · "admitted (200, source durable or pending)": the answer is 200 with the render receipt,
//     status `durable`, source `pending` (P56.AA1's first answer on the same fixture).
//   · "a client clock ahead is clamped to the engine's present": a client time ten minutes ahead
//     is admitted at a time between the moment the acknowledgement was sent and the moment it
//     was answered, at or after the decision's time, with the behaviour record at that time.
//   · "rendered.at >= ts on every ledger row": acknowledgements on time, ahead and behind the
//     decision each end either admitted, with one ledger row whose `rendered.at` is at or after
//     the decision's time, or refused 401 before anything is admitted (the refusal of today,
//     which AK1 makes RED, not this lock); an answer of any other kind, such as the ledger
//     invariant's 500 when the client's time is admitted, breaks the lock.
//   · "the other P56 AA4 refusals": a decision the engine never issued (a well-formed id one
//     millisecond off the decision's own), another shopper's decision (the offer redeemed with
//     another shopper's grant) and an offer past RENDER_OFFER_WINDOW_MS (the clock set past it,
//     as P56.AA4 sets it), each with its client time on time and LAG_MS behind the decision:
//     refused `401 { ok: false, error: 'Shopper session unavailable' }` (the owner's typed
//     refusal) and nothing of the decision admitted or written; then the honest acknowledgement
//     is admitted (the refusals were the variants', not the fixture's).
//   · "no new remote call before the answer under the latency lever": with 20 ms added to every
//     remote binding call (src/units/_parity8.ts `remoteLatency`, as P65.RS3 adds it), an
//     acknowledgement on time and one LAG_MS behind the decision make, per binding and method, no
//     more remote calls before their answer than an acknowledgement makes at 0e94aaa6 (the base,
//     BASE_CALLS_BEFORE_ANSWER, measured on this harness; ANALYSIS §8.7: "one in-process
//     Math.max and adds no remote call").
//   · kit 02 :933 "says it": a sentence of a document, read by the reviewer at the artifact
//     (doneWhen 4); no unit here.
//
// MEASURED at 0e94aaa6 (_evidence/parity-step3/S17/specifier/logs/): AK1 RED on both hosts, the
// acknowledgement answered `401 {"ok":false,"error":"Shopper session unavailable"}` and nothing
// admitted (renderOffer.ts `redeemRenderOffer`: `event.timestamp! < value.record.ts` refuses it);
// AK2 GREEN on both hosts.
//
// NEGATIVE CONTROLS (scratch copies, never committed; _evidence/parity-step3/S17/specifier/sketches/):
// the analyst's sketch (the clause dropped, a first delivery admitted at max(event.timestamp,
// record.ts)) turns every P69 unit GREEN; the clause dropped without the max turns AK1 and AK2's
// rendered.at lock RED (500 from the ledger invariant); the decision admitted at max but the
// behaviour record kept at the client's time turns AK1's behaviour leg RED; the decision admitted
// at the engine's present turns AK1's admitted.at leg RED.
//
// R10 (expectations a build of P69 changes): src/units/P56/LEDGER.unit.test.ts, AA4's redemption
// lock (its ":434 a time before the decision is refused" variant), updated in this batch by the
// lead's ruling (test-only): the variant moved out of the refused list into an assertion that it is
// admitted at the decision's time (RED until P69 is built). MEASURED under the analyst's sketch on a
// scratch copy (logs/s17/r10-base.json, r10-fix.json: every test file naming `renderOffer`, P56 as it
// was): no other new failure. Wording only, no assertion: P57.RC3's clamp lock title says a time "at
// or before [the engine's present] exactly as given", and its fixture sends the decision's own time,
// which P69 still admits exactly; the W23 comment in src/routes/realtime.ts ("a client time at or
// before it is admitted EXACTLY as given") and kit 02 :73 ("the engine still uses its own processing
// clock") are in P69's allowed paths.
//
// No new export is imported; every member read exists at this head.
//
// FIXTURE. P02's world as P56 builds it (src/units/P56/LEDGER.unit.test.ts `world`): the
// registered modules in catalogue order, the declared layout slot (K = 4, rendered-v1, click
// reward) and the recently-viewed slot; one shopper with their explicit choice and a page view;
// the product page with its page instance, its snapshot on the wire without a drain; the cold
// layout [grid.1, reco.1, reco.2, editorial.1], every module offered for acknowledgement.
//
// HARNESS: src/units/_parity.ts and src/units/_parity8.ts. Imports from src/units/: ../_parity, ../_parity8.

import { describe, expect, it, vi } from 'vitest';

import { RENDER_OFFER_WINDOW_MS } from '@/content/renderOffer';
import type { DecisionRecord } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { parseId, ts36 } from '@/ledger/records';

import {
  BRAND, declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learned, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, recentSlot, rounded, shopperOn, storedDecisions, TENANT, type Decision, type Host, type Mounted, type Shopper, type Snapshot,
} from '../_parity';
import { ackWire, decisionAdmissionOf, remoteLatency, rowsOf, settle, storedBehavior, workerApp, type Identity, type Wire, type WorkerApp } from '../_parity8';

const DOCUMENTS = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
/** P02's cold layout (src/units/P02/LEDGER.unit.test.ts:105): the first four eligible modules in catalogue order. */
const COLD_LAYOUT = [M.grid, M.reco1, M.reco2, M.editorial];
/** The client's clock behind the decision's engine time (amendment 9 §1(a), ANALYSIS §3: the lag the reproduction used). */
const LAG_MS = 150;
/** A client clock ahead of the engine (P57.RC3 sends one ahead the same way). */
const AHEAD_MS = 10 * 60_000;
/** What every remote binding call waits under the lever (P65.RS3's lever). */
const LEVER_MS = 20;
/**
 * The remote calls an acknowledgement makes before its answer at 0e94aaa6, per binding and method, on this harness
 * (measured with the lever above: _evidence/parity-step3/S17/specifier/logs/).
 */
const BASE_CALLS_BEFORE_ANSWER: Record<Host, Record<string, number>> = {
  session: { 'STORAGE.get': 3, 'CACHE.get': 11, 'SESSIONS.put': 2 },
  do: { 'STORAGE.get': 3 },
};
const REFUSAL = { status: 401, body: { ok: false, error: 'Shopper session unavailable' } };
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);

interface World { m: Mounted; app: WorkerApp; s: Shopper; page: Snapshot; layout: Decision[] }

/** The product page's snapshot as the shopper's page asks for it (the body src/units/_parity.ts `snapshot` sends), answered on the wire WITHOUT a drain. */
async function snapshotWire(app: WorkerApp, s: Shopper, pageInstance: string): Promise<Snapshot> {
  const response = await app.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, {
    method: 'POST', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance }),
  }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, body, page: 'pdp', pageInstance, decisions: (body.decisions ?? []) as Decision[] };
}

/** P02's world on one host: published, one shopper with their choice and a page view, their product page's snapshot just answered. */
async function world(host: Host, label: string): Promise<World> {
  const m = await mount(host, DOCUMENTS);
  expectPublished(m, 'P69 — the product page with its declared rendered-v1 layout slot (P02) publishes');
  const app = workerApp(m);
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${host}): the shopper's page view is accepted`).toBe(200);
  const page = await snapshotWire(app, s, pageInstanceOf(label));
  expect(page.status, `PRECONDITION (${host}): the shopper's product page is served (${show(page.body)})`).toBe(200);
  const layout = page.decisions.filter(d => d.slot === LAYOUT).sort((a, b) => a.order - b.order);
  expect(layout.map(d => d.contentId), `PRECONDITION (${host}): the cold layout (P02.A2)`).toEqual(COLD_LAYOUT);
  for (const d of layout) expect(d.renderOffer, `PRECONDITION (${host}): ${d.contentId} is offered for a render acknowledgement (rendered-v1)`).toMatch(/^ro1\./);
  return { m, app, s, page, layout };
}

/** The decision's engine time: the time its id carries (the record's `ts`). */
const decisionTime = (d: Decision) => parseId(d.decisionId!)!.ts;
/** The client time LAG_MS behind the decision's engine time, under a fresh event id. */
const behind = (d: Decision): Identity => ({ eventId: crypto.randomUUID(), timestamp: decisionTime(d) - LAG_MS });
/** The render acknowledgement the route answers (renderOffer.ts `RenderAcknowledgment`). */
const renderReceipt = (page: Snapshot, d: Decision, identity: Identity, source: 'pending' | 'recovered') =>
  ({ version: 1, decisionId: d.decisionId, eventId: identity.eventId, pageInstance: page.pageInstance, status: 'durable', source });
/** The record id of the behaviour capture (src/ledger/behavior.ts) for an event admitted at `at`. */
const behaviorIdOf = (s: Shopper, identity: Identity, at: number) => `${TENANT}:${ts36(at)}:${s.subject}:behavior:${identity.eventId}`;
/** The `rendered` member the redemption writes onto the decision. */
const renderedOf = (page: Snapshot, identity: Identity, at: number) => ({ version: 1, eventId: identity.eventId, at, pageInstance: page.pageInstance });
/** The `rendered` member of the decision the shopper object admitted, or what it holds instead. */
function admittedRenderOf(m: Mounted, s: Shopper, d: Decision): unknown {
  const admission = decisionAdmissionOf(m, s.subject, d.decisionId!);
  const records = (admission?.payload?.input as { records?: DecisionRecord[] } | undefined)?.records ?? [];
  return records.find(record => record.decision_id === d.decisionId)?.rendered ?? 'nothing admitted';
}
const recordIdOf = (answer: Wire) => (answer.body.behavior as { recordId?: unknown } | undefined)?.recordId ?? 'no behaviour capture';
const behaviourOf = (m: Mounted, s: Shopper, identity: Identity) => storedBehavior(m, s.subject).filter(row => row.event_id === identity.eventId).map(row => [row.record_id, row.ts]);
const callCounts = (calls: string[]) => calls.reduce<Record<string, number>>((out, call) => ({ ...out, [call]: (out[call] ?? 0) + 1 }), {});
const beyondBase = (host: Host, calls: string[]) => Object.entries(callCounts(calls))
  .filter(([call, count]) => count > (BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0)).map(([call, count]) => `${call} ×${count} (base ${BASE_CALLS_BEFORE_ANSWER[host][call] ?? 0})`);

// ===========================================================================
// unit:P69.AK1 — an acknowledgement stamped before the decision's time is admitted at the decision's time
// ===========================================================================

describe('unit:P69.AK1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an acknowledgement whose client timestamp is ${LAG_MS} ms behind the decision's engine time, sent the moment the snapshot answers, is admitted: 200 with render durable and pending, the decision admitted at the decision's time and the behaviour record of the same request at that time; after the effects one ledger row at the decision's time and the exposure counted once; a same-id re-send answers recovered at that same time`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p69-ak1');
      const d = layout[0]!, ts = decisionTime(d), identity = behind(d);
      const answer = await ackWire(app, s, page, d, identity);
      expect.soft([answer.status, answer.body.render ?? answer.body], `${host}: P69.AK1 — the acknowledgement ${LAG_MS} ms behind the decision is admitted, not refused for its time (amendment 9 §2: "never refused for that reason")`)
        .toEqual([200, renderReceipt(page, d, identity, 'pending')]);
      expect.soft(admittedRenderOf(m, s, d), `${host}: P69.AK1 — the decision is admitted at the decision's time (admitted.at = the decision's ts ${ts}, the client's ${identity.timestamp} clamped up)`)
        .toEqual(renderedOf(page, identity, ts));
      expect.soft(recordIdOf(answer), `${host}: P69.AK1 — the behaviour record of the same request is at the decision's time`).toBe(behaviorIdOf(s, identity, ts));
      await settle(m, app);
      await m.drainLedger();
      expect.soft([rowsOf(storedDecisions(m, s.subject), d.decisionId).map(row => row.rendered?.at), behaviourOf(m, s, identity), rounded(await learned(m), 'n')],
        `${host}: P69.AK1 — after the effects: one ledger row whose rendered.at is the decision's time, one behaviour record at that time, the exposure counted once`)
        .toEqual([[ts], [[behaviorIdOf(s, identity, ts), ts]], { [d.contentId]: 1 }]);
      const resend = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      await m.drainLedger();
      expect.soft([resend.status, resend.body.render ?? resend.body, recordIdOf(resend), rowsOf(storedDecisions(m, s.subject), d.decisionId).length, behaviourOf(m, s, identity).length],
        `${host}: P69.AK1 — a same-id re-send keeps the first admission's time (P57): recovered, the same behaviour record, one row`)
        .toEqual([200, renderReceipt(page, d, identity, 'recovered'), behaviorIdOf(s, identity, ts), 1, 1]);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P69.AK2 — locks: W23's clamp, P57's re-send, rendered.at >= ts, the other refusals, no new remote call
// ===========================================================================

describe('unit:P69.AK2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a client clock ahead of the engine is clamped to the engine's present (W23): the decision admitted, its ledger row and the behaviour record at the engine's time of arrival, at or after the decision's time`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p69-ak2-ahead');
      const d = layout[0]!, ts = decisionTime(d);
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() + AHEAD_MS };
      const sent = Date.now();
      const answer = await ackWire(app, s, page, d, identity);
      const answered = Date.now();
      await settle(m, app);
      await m.drainLedger();
      expect(answer.status, `${host}: PRECONDITION — the acknowledgement is admitted (${show(answer.body)})`).toBe(200);
      const at = rowsOf(storedDecisions(m, s.subject), d.decisionId)[0]?.rendered?.at ?? Number.NaN;
      expect.soft(at >= sent && at <= answered && at >= ts ? 'the engine\'s present' : `at ${at} (sent ${sent}, answered ${answered}, decision ${ts}, client ${identity.timestamp})`,
        `${host}: P69.AK2 — a client time ahead is admitted at the engine's present (realtime.ts W23 clamp)`).toBe('the engine\'s present');
      expect.soft([admittedRenderOf(m, s, d), recordIdOf(answer), behaviourOf(m, s, identity)], `${host}: P69.AK2 — the admission and the behaviour record at that same present`)
        .toEqual([renderedOf(page, identity, at), behaviorIdOf(s, identity, at), [[behaviorIdOf(s, identity, at), at]]]);
    }, 60_000);

    it(`host (${host}): LOCK — the re-send (P57): an acknowledgement on time, re-sent with its own id and time after its effects, answers 200 recovered with the same behaviour record, and leaves one ledger row, one behaviour record and one exposure`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p69-ak2-resend');
      const d = layout[0]!;
      const identity = { eventId: crypto.randomUUID(), timestamp: Date.now() };
      const first = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      expect(first.status, `${host}: PRECONDITION — the acknowledgement is admitted (${show(first.body)})`).toBe(200);
      const resend = await ackWire(app, s, page, d, identity);
      await settle(m, app);
      await m.drainLedger();
      expect.soft([resend.status, resend.body.render, recordIdOf(resend)], `${host}: P69.AK2 — the re-send answers recovered, the same behaviour record`)
        .toEqual([200, renderReceipt(page, d, identity, 'recovered'), recordIdOf(first)]);
      expect.soft([rowsOf(storedDecisions(m, s.subject), d.decisionId).length, behaviourOf(m, s, identity).length, rounded(await learned(m), 'n')],
        `${host}: P69.AK2 — one ledger row, one behaviour record, one exposure`).toEqual([1, 1, { [d.contentId]: 1 }]);
    }, 60_000);

    it(`host (${host}): LOCK — rendered.at >= ts on every ledger row: acknowledgements on time, ahead of the engine and ${LAG_MS} ms behind the decision each end admitted with one ledger row at or after the decision's time, or refused 401 before anything is admitted; never another answer (the ledger's invariant, records.ts validDecisionMeasurement)`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p69-ak2-invariant');
      const sends: Array<[string, Decision, Identity]> = [
        ['on time', layout[0]!, { eventId: crypto.randomUUID(), timestamp: Date.now() }],
        ['ahead of the engine', layout[1]!, { eventId: crypto.randomUUID(), timestamp: Date.now() + AHEAD_MS }],
        [`${LAG_MS} ms behind the decision`, layout[2]!, behind(layout[2]!)],
      ];
      const answers: Wire[] = [];
      for (const [, d, identity] of sends) { answers.push(await ackWire(app, s, page, d, identity)); await settle(m, app); }
      await m.drainLedger();
      const stored = storedDecisions(m, s.subject);
      const ADMITTED = 'admitted, one ledger row at or after the decision\'s time', REFUSED = 'refused 401 before anything is admitted';
      const ended = sends.map(([name, d], index) => {
        const answer = answers[index]!, rows = rowsOf(stored, d.decisionId), admitted = admittedRenderOf(m, s, d);
        if (answer.status === 200 && rows.length === 1 && (rows[0]!.rendered?.at ?? -1) >= decisionTime(d)) return [name, ADMITTED];
        if (answer.status === 401 && show(answer.body) === show(REFUSAL.body) && admitted === 'nothing admitted' && rows.length === 0) return [name, REFUSED];
        return [name, `answered ${answer.status} ${show(answer.body)}; admitted ${show(admitted)}; rows ${show(rows.map(row => [row.ts, row.rendered?.at]))}`];
      });
      expect.soft(ended.map(([name, end]) => [name, end === ADMITTED || end === REFUSED ? 'kept the invariant' : end]),
        `${host}: P69.AK2 — every acknowledgement ends admitted at or after the decision's time, or refused before admission (on time and ahead: admitted)`)
        .toEqual(sends.map(([name]) => [name, 'kept the invariant']));
      expect.soft(ended.slice(0, 2).map(([, end]) => end), `${host}: P69.AK2 — the acknowledgements on time and ahead are admitted`).toEqual([ADMITTED, ADMITTED]);
      expect.soft(stored.filter(row => row.rendered !== undefined).map(row => (row.rendered!.at >= row.ts ? 'rendered.at >= ts' : `${row.decision_id}: rendered.at ${row.rendered!.at} < ts ${row.ts}`)),
        `${host}: P69.AK2 — every ledger row with a render holds rendered.at >= ts`).toEqual(stored.filter(row => row.rendered !== undefined).map(() => 'rendered.at >= ts'));
    }, 60_000);

    it(`host (${host}): LOCK — P56 AA4's other refusals: an acknowledgement naming a decision the engine never issued, another shopper's decision, or an offer past its window is refused 401 and admits nothing, its client time on time or ${LAG_MS} ms behind the decision; the honest acknowledgement is then admitted`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p69-ak2-refusals');
      const d = layout[0]!, ts = decisionTime(d);
      const unknown = d.decisionId!.replace(/^([^:]+):([0-9a-z]+):/i, (_, tenant: string) => `${tenant}:${ts36(ts + 1)}:`);
      expect([parseId(unknown)?.ts, unknown === d.decisionId, page.decisions.some(x => x.decisionId === unknown)], `${host}: PRECONDITION — a well-formed decision id the engine never issued`).toEqual([ts + 1, false, false]);
      const other = await shopperOn(m);
      const times: Array<[string, () => number]> = [['on time', () => Date.now()], [`${LAG_MS} ms behind the decision`, () => ts - LAG_MS]];
      const refused: Array<[string, unknown]> = [];
      for (const [when, time] of times) {
        for (const [name, send] of [
          ['a decision the engine never issued', () => ackWire(app, s, page, { ...d, decisionId: unknown }, { eventId: crypto.randomUUID(), timestamp: time() })],
          ['another shopper\'s decision', () => ackWire(app, other, page, d, { eventId: crypto.randomUUID(), timestamp: time() })],
        ] as Array<[string, () => Promise<Wire>]>) {
          const answer = await send();
          await settle(m, app);
          refused.push([`${name}, ${when}`, { status: answer.status, body: answer.body }]);
        }
        // The offer window (renderOffer.ts RENDER_OFFER_WINDOW_MS): the same acknowledgement one window after the decision.
        const later = Date.now() + RENDER_OFFER_WINDOW_MS + 1;
        const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
        let expired: Wire;
        try { expired = await ackWire(app, s, page, d, { eventId: crypto.randomUUID(), timestamp: when === 'on time' ? later - 1 : ts - LAG_MS }); await settle(m, app); }
        finally { clock.mockRestore(); }
        refused.push([`an offer past its window, ${when}`, { status: expired.status, body: expired.body }]);
      }
      expect.soft(refused, `${host}: P69.AK2 — each is refused as P56 AA4 refuses it (renderOffer.ts redeemRenderOffer; the owner's typed refusal)`)
        .toEqual(refused.map(([name]) => [name, REFUSAL]));
      expect.soft([admittedRenderOf(m, s, d), admittedRenderOf(m, other, d), rowsOf(storedDecisions(m, s.subject), d.decisionId).length, rowsOf(storedDecisions(m, other.subject), d.decisionId).length],
        `${host}: P69.AK2 — no refused acknowledgement admitted or wrote anything`).toEqual(['nothing admitted', 'nothing admitted', 0, 0]);
      const honest = await ackWire(app, s, page, d);
      await settle(m, app);
      expect([honest.status, (honest.body.render as { status?: unknown } | undefined)?.status], `${host}: CONTROL — the honest acknowledgement is admitted (${show(honest.body)})`).toEqual([200, 'durable']);
    }, 90_000);

    it(`host (${host}): LOCK — no new remote call before the answer: with ${LEVER_MS} ms added to every remote binding call, an acknowledgement on time and one ${LAG_MS} ms behind the decision make, per binding and method, no more remote calls before their answer than the base`, async () => {
      const { m, app, s, page, layout } = await world(host, 'p69-ak2-latency');
      const lever = remoteLatency(m);
      const beyond: Array<[string, string[]]> = [];
      for (const [name, d, identity] of [['on time', layout[0]!, { eventId: crypto.randomUUID(), timestamp: Date.now() }], [`${LAG_MS} ms behind`, layout[1]!, behind(layout[1]!)]] as Array<[string, Decision, Identity]>) {
        const first = lever.calls.length;
        lever.set(LEVER_MS);
        let answer: Wire;
        try { answer = await ackWire(app, s, page, d, identity); } finally { lever.set(0); }
        const before = lever.calls.slice(first).filter(call => call.at <= answer.answeredAt).map(call => `${call.binding}.${call.method}`);
        await settle(m, app);
        beyond.push([name, beyondBase(host, before)]);
      }
      expect.soft(beyond, `${host}: P69.AK2 — no remote call before the answer beyond the base's (the clamp is in-process: ANALYSIS §8.7)`).toEqual([['on time', []], [`${LAG_MS} ms behind`, []]]);
    }, 60_000);
  }

  it('CONTROL: the wire snapshot answers without a drain, and the readings have teeth (a time before the decision is not the decision\'s time; another call is beyond the base)', async () => {
    const { m, app, s, page, layout } = await world('do', 'p69-control');
    const d = layout[0]!;
    expect([page.status, typeof page.body.decisions], 'CONTROL — the snapshot on the wire answers the decisions').toEqual([200, 'object']);
    expect(behind(d).timestamp < decisionTime(d), 'CONTROL — the lagging time is earlier than the decision\'s engine time').toBe(true);
    expect(beyondBase('do', ['STORAGE.list', 'STORAGE.list', 'STORAGE.list', 'STORAGE.list', 'STORAGE.list', 'STORAGE.list']), 'CONTROL — calls beyond the base are named')
      .toEqual([`STORAGE.list ×6 (base ${BASE_CALLS_BEFORE_ANSWER.do['STORAGE.list'] ?? 0})`]);
    await settle(m, app);
    expect(admittedRenderOf(m, s, d), 'CONTROL — an unacknowledged decision reads as nothing admitted').toBe('nothing admitted');
  }, 60_000);
});
