// src/units/P63/LEDGER.unit.test.ts
// P63 under the Closure Ledger: the tests for the LOCAL criteria of the P63 work
// order (the lift-witness programme, amendment 6, ticket P63 "The statistics object
// does not republish an unchanged state"). LV1 is a deferred live row and gets no
// test.
//
// One `describe('unit:P63.<criterion>')` per LOCAL criterion, every leg walked on
// both shopper hosts. Expected values come from the work order and the witnesses it
// cites, and every expected copy, record and version is the engine's own (read back
// before the alarms the test fires), never a literal:
//   · THE AUTHORITY, verbatim (docs/parity/authority/amendment-6/BTI-Parity-Amendment-2026-10-19b.md,
//     section 2, P63): "The statistics object's alarm does not publish a new version
//     when nothing changed since the last publication, except when a `stale` or
//     `republished` marker is in force (P42 PW2's rule that the next alarm
//     publication succeeds and clears the marker stays byte for byte)."
//   · THE ANALYSIS (_evidence/baseline-52/lift-budget/ANALYSIS.md at 452d2c38): §3 E5
//     ("two alarms with no new evidence between them → the version moves … while
//     events stay 9 = 9"); §3 E3 (a copy an isolate holds is refused, and since P62
//     served with `asOf`, once a later publication supersedes it); §4 (B) (the object
//     republishes 30 s after any evidence and "even without new evidence",
//     src/durable-objects/LearnStats.ts `alarmScoped` → `publish()`); §5 F2b ("the alarm
//     does not republish when nothing changed … only when no `stale` or `republished`
//     marker is in force", keeping P42 PW2's rule that "the next alarm publication
//     succeeds" and clears the marker).
//   · THE WORK ORDER (docs/parity/lift-witness/program.json, P63): NR1 "two alarms with
//     no new evidence between them leave the published version unchanged (today it
//     moves: E5)"; NR2 "an alarm after new evidence publishes a new version as today";
//     NR3 "with a stale or republished marker in force the next alarm publication
//     succeeds and clears it (P42 PW2, P49 units unchanged); the publish order
//     unchanged"; remaining work "skip the alarm publication when the state digest
//     equals the last published digest and no marker is in force".
//   · TODAY'S CODE the ruling reads: the alarm (LearnStats.ts `alarmScoped`) always
//     calls `publish()`, which allocates a new version (`Math.max(frozen.version,
//     lastAllocated + 1)`), archives it, writes `learnPublished` and the recent
//     publications (P62's `learnRecent`) and then the copy (`liftKey`); the markers are
//     read by the lift reads only while the snapshot in force is the one they name
//     (src/learn/fan.ts `staleMarkerIn`, `republishedIn`).
//
// THE BEHAVIOUR, RULED (R-P15):
//   · "Nothing changed" is the object's own state (the evidence it counts) and the
//     published documents its publication reads (the tenant's prior and learn
//     documents) since its last successful publication: no exposure, credit or reset,
//     no republished document between them. A republished prior document is a change:
//     src/learn/learn.test.ts W10.01 (:874-877) already locks that the alarm then
//     attempts the publication (and refuses it with 413 for an oversized prior). An
//     alarm that finds nothing changed and no marker in force publishes nothing: the
//     copy the store holds (its version, its time and its bytes), the object's
//     publication record (`learnPublished`) and the archive are exactly as the last
//     publication left them, and a copy an isolate already holds stays the object's
//     latest (served without `asOf`).
//   · Any new evidence: the next alarm publishes a new version, as today.
//   · A marker in force (P42's `stale`, P49's `republished`, each in force while the
//     snapshot in force is the one it names): the next alarm publication is attempted
//     and, when it succeeds, clears the marker exactly as today (both lift reads answer
//     today's members again), even with nothing changed since the last publication.
//     The stale case is the one only the marker exception publishes (a pooled fault
//     changes neither the state nor a document); P49's case also republishes the learn
//     document, a change under the rule above, so its lock holds whichever way a build
//     tells a document change (by revision or by content).
//   · "The last publication" is the last one that succeeded: a publication whose copy
//     write failed (LearnStats.ts `publish`, W27 R4: "an archive or KV acknowledgement
//     can be lost … schedule only publication again") is not one, so the next alarm
//     publishes even with nothing changed since that attempt, and the copy the store
//     holds is then the object's recorded publication.
//   · The publish order: the object records the publication (`learnPublished`) before
//     the store's put of the copy, made once.
//   · The skip is the alarm's alone: the object's own `/publish` door (the operator's
//     publish) publishes as today; src/learn/priorsAbsent.test.ts:87-88 already locks it
//     (the door, right after the alarm's publication with nothing between them, answers
//     `published: true`).
//   · A change of either kind is pinned here (R-P138): a credit alone (a click on an
//     acknowledged decision moves no event count, src/learn/stats.ts `recordSuccess`,
//     :236-245, yet changes the state) and a republished learn document alone (one
//     P49 does not refuse: the product slot's γ, the case of src/units/P49 LR2) each make
//     the next alarm publish; the prior-document half is W10.01's (below).
//   · NOT RULED: a sibling placement's pooled counters as a change; an alarm that only
//     removes expired learning-effect markers.
//   · P62's DOOR, LOCKED HERE (R-P129: the P62 delivery review's findings F1 and F3,
//     dispositioned as additive legs for this batch, whose specifier owns
//     src/units/P63/** only, so they sit under unit:P63.NR3): after an explicit reset
//     or the `/reset` door with no new evidence, the `/witness` door's verdict is the
//     one `/health` gives (`empty`), not the verdict it held before (the epoch moved by
//     every assignment of the state, LearnStats.ts `data`); and concurrent first
//     `/witness` calls of an evicted object share one verdict, reading the stored state
//     once (LearnStats.ts `heldVerdict`).
//
// R10 (expectations that lock present behaviour, listed for the lead): none. Measured
// on scratch copies of this tree (_evidence/parity-step3/S14/specifier/logs/full-*):
// under a sketch that skips the alarm's publication when the state and the published
// documents are what they were at the last successful publication, the copy the store
// holds is that publication, and no marker is in force, the whole suite fails only
// where the copy without the sketch fails (its git-dependent console tests) less this
// file's NR1. A first sketch that read the object's state alone broke
// src/learn/learn.test.ts W10.01 (:874-877: after a prior document is republished the
// alarm attempts the publication and refuses it, 413): that test, src/learn/priorsAbsent.test.ts
// (:112, :120: a removed or unreadable prior document fails the alarm) and
// src/learn/learn.test.ts:499-503 (a failed publication keeps the previous copy, re-arms the
// alarm, and the next alarm attempts it again) and src/units/P62/LEDGER.unit.test.ts:641
// (P62.LW4: every write a publication makes in the object precedes the store's put of the
// copy; with :240 below it asks a build to record what it published before the copy and
// to check the store's copy before skipping) are existing locks the build keeps, not R10s.
//
// FIXTURE. P61's and P62's lift world (src/units/_parity9.ts `liftWorld`): P08's
// pooled world as P42.PW3 drives it, the product page's slot carrying P10's fatigue
// dial; an alarm publication after new evidence (`republish`: one more product-page
// visit, then the placement's alarm) puts the state the two alarms find. NR3's
// markers are made as P42 and P49 make them: the home page's `/pooled` door failing
// under the product placement's own `/publish` (src/units/_parity6.ts
// `failPooledDoor`), and a learn republish changing the product slot's reward
// (P49's case), each refused at the object's door with nothing changed since the last
// publication.
//
// HARNESS: src/units/_parity.ts, _parity6.ts, _parity9.ts. Imports from src/units/:
// ../_parity, ../_parity6, ../_parity9.

import { describe, expect, it } from 'vitest';

import { invalidateLiftCache } from '@/content/service';
import type { DecisionRecord } from '@/content/types';
import { liftKey } from '@/learn/fan';

import { BRAND, HOSTS, PAID_SOCIAL_ENTRY, pageInstanceOf, putDocument, shopperOn, TENANT, VIEW_TABBY_26, type Mounted } from '../_parity';
import { dials, failPooledDoor, LIFT_MEMBERS, learnOf, liftOf, objectPublish, POOLED, ROWS_MEMBERS, rowsOf, SHARED, visit } from '../_parity6';
import {
  copyOf, decide, fireAlarm, HOME_MODULES, liftOnRecord, liftReadOf, liftWorld, objectDoor, PDP_MODULES, placementOf, republish, restartObject, type Copy,
} from '../_parity9';

/** What the product placement has published, as the engine holds it: the store's copy, the object's publication record, the archived versions. */
function published(m: Mounted): { copy: string | null; record: unknown; archived: string[] } {
  return { copy: copyOf(m)?.raw ?? null, record: placementOf(m).data.get('learnPublished') ?? null,
    archived: [...m.storage.objects.keys()].filter(key => key.startsWith(`lift/${TENANT}/${BRAND}/${PDP_MODULES}/`) && /\/\d+\.json$/.test(key)).sort() };
}
const servedFrom = (version: number) => ({ version, lift: expect.objectContaining({ lift: expect.any(Number), n: expect.any(Number) }) });
/** The pooled module's itemised lift on a record, or a sentence. */
const itemisedLift = (record: DecisionRecord | undefined): Record<string, unknown> | string =>
  (record?.explain.lift as Record<string, unknown> | null | undefined) ?? `no itemised lift on the record (${JSON.stringify(liftOnRecord(record)).slice(0, 120)})`;
/** The events a copy says it was built from, and the events the placement's state holds now. */
const copyEvents = (copy: Copy | null): unknown => (copy ? (JSON.parse(copy.raw) as { events?: unknown }).events : 'no copy');
const heldEvents = (m: Mounted): unknown => (placementOf(m).data.get('learn') as { stats?: { events?: unknown } } | undefined)?.stats?.events ?? 'no state';
/** The verdict a statistics door answers: what `/health` and `/witness` both name. */
const verdictOf = (answer: { status: number; body: Record<string, unknown> }) => ({ status: answer.status, state: answer.body.state, publication: answer.body.publication, witness: answer.body.witness });
/** The members a lift read answers, in order (P42's LIFT_MEMBERS / ROWS_MEMBERS: today's). */
const membersOf = async (m: Mounted) => [Object.keys((await liftOf(m, PDP_MODULES)).body), Object.keys((await rowsOf(m, PDP_MODULES)).body)];

// ===========================================================================
// unit:P63.NR1 — two alarms with no new evidence leave the publication as it was
// ===========================================================================

describe('unit:P63.NR1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): after an alarm publication that took in new evidence, two alarms with no new evidence between them leave the published copy (its version, time and bytes), the object's publication record and the archive exactly as that publication left them`, async () => {
      const { m } = await liftWorld(host);
      const latest = await republish(m);
      const before = published(m);
      expect([copyOf(m)?.version, copyEvents(copyOf(m))], `${host}: PRECONDITION — the alarm publication holds every event the placement counted`).toEqual([latest.version, heldEvents(m)]);
      await fireAlarm(m);
      const afterFirst = published(m);
      await fireAlarm(m);
      const afterSecond = published(m);
      expect({ first: afterFirst, second: afterSecond }, `${host}: P63.NR1 — (ANALYSIS §3 E5) with nothing changed since the last publication (events ${String(heldEvents(m))}), neither alarm publishes: version ${latest.version} stays the publication in force`)
        .toEqual({ first: before, second: before });
    }, 120_000);

    it(`host (${host}): so the copy an isolate held before the two alarms is still the object's latest: the next decision from that cache is applied and its record carries no asOf member, and the answer names the outcome 'served'`, async () => {
      const { m } = await liftWorld(host);
      const latest = await republish(m);
      invalidateLiftCache();
      // Not acknowledged: nothing the shopper does here is new evidence for the placement.
      await decide(m, 'pdp', { ack: false });
      await fireAlarm(m);
      await fireAlarm(m);
      const held = await decide(m, 'pdp');
      expect(liftOnRecord(held.record), `${host}: PRECONDITION — the decision is applied from the copy the isolate held (version ${latest.version})`).toEqual(servedFrom(latest.version));
      expect(Object.hasOwn(itemisedLift(held.record) as object, 'asOf'), `${host}: P63.NR1 — the held copy is still the latest publication: no asOf (P62's member for a copy that is not the latest)`).toBe(false);
      expect(liftReadOf(held.snapshot), `${host}: P63.NR1 — the answer names the outcome 'served'`).toEqual({ outcome: 'served', ms: expect.any(Number) });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P63.NR2 — LOCK: an alarm after new evidence publishes a new version
// ===========================================================================

describe('unit:P63.NR2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — after new evidence (one more product-page visit, acknowledged and clicked), the next alarm publishes a new version holding it: a later version than the one in force, recorded and archived, its events the placement's events`, async () => {
      const { m, v1 } = await liftWorld(host);
      const earlier = v1!;
      await visit(m, 'pdp');
      const counted = heldEvents(m);
      expect(Number(counted) > Number(copyEvents(earlier)), `${host}: PRECONDITION — the visit is new evidence (events ${String(copyEvents(earlier))} → ${String(counted)})`).toBe(true);
      await fireAlarm(m);
      const now = copyOf(m)!;
      const record = placementOf(m).data.get('learnPublished') as { version?: unknown } | undefined;
      expect(now.version > earlier.version, `${host}: P63.NR2 — LOCKED: the alarm publishes a later version (${earlier.version} → ${now.version})`).toBe(true);
      expect({ record: record?.version, archived: published(m).archived.includes(`lift/${TENANT}/${BRAND}/${PDP_MODULES}/${now.version}.json`), events: copyEvents(now) },
        `${host}: P63.NR2 — LOCKED: recorded, archived, and built from every event counted`).toEqual({ record: now.version, archived: true, events: counted });
    }, 120_000);

    it(`host (${host}): LOCK (R-P138) — a credit alone is new evidence: after an alarm publication holding a decision's exposures, a click on that acknowledged decision (a credit, no new event) and the next alarm publishes a later version holding the credit`, async () => {
      const { m } = await liftWorld(host);
      await republish(m);
      const shopper = await shopperOn(m);
      expect((await shopper.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY)).status, `${host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
      const page = await shopper.snapshot('pdp', { pageInstance: pageInstanceOf('p63-credit') });
      for (const d of page.decisions) expect((await shopper.ack(page, d)).status, `${host}: PRECONDITION — ${d.contentId} acknowledged`).toBe(200);
      await m.drainLedger();
      await fireAlarm(m);
      const before = copyOf(m)!, eventsBefore = heldEvents(m);
      const clicked = page.decisions.find(d => [POOLED, SHARED].includes(d.contentId)) ?? page.decisions[0]!;
      const stateBefore = JSON.stringify(placementOf(m).data.get('learn'));
      expect((await shopper.click(page, clicked)).status, `${host}: PRECONDITION — the click on ${clicked.contentId} is accepted`).toBe(200);
      await m.drainLedger();
      expect({ events: heldEvents(m), stateChanged: JSON.stringify(placementOf(m).data.get('learn')) !== stateBefore },
        `${host}: PRECONDITION — the click is a credit the placement counted, and no new event (stats.ts \`recordSuccess\`)`).toEqual({ events: eventsBefore, stateChanged: true });
      await fireAlarm(m);
      const after = copyOf(m)!;
      const credits = (copy: Copy) => (JSON.parse(copy.raw) as { items?: Record<string, Record<string, { s?: number }>> }).items?.[clicked.contentId]?.['*']?.s ?? 0;
      expect({ later: after.version > before.version, credited: credits(after) > credits(before) },
        `${host}: P63.NR2 — LOCKED: the credit alone makes the next alarm publish (${before.version} → ${after.version}), holding it (credits of ${clicked.contentId}: ${credits(before)} → ${credits(after)})`)
        .toEqual({ later: true, credited: true });
    }, 120_000);

    it(`host (${host}): LOCK (R-P138) — a republished learn document alone is a change: after an alarm publication, the learn document republished with the product slot's γ changed (a change P49 does not refuse) and nothing else, the next alarm publishes a later version`, async () => {
      const { m } = await liftWorld(host);
      const latest = await republish(m);
      const events = heldEvents(m), state = JSON.stringify(placementOf(m).data.get('learn'));
      const changed = await putDocument(m, 'learn', learnOf({ [PDP_MODULES]: dials('click', { gamma: 0.5 }), [HOME_MODULES]: dials() }), 'p63-gamma');
      expect(changed.status, `${host}: PRECONDITION — the learn document republishes with the product slot's γ 0.5`).toBe(200);
      expect({ events: heldEvents(m), state: JSON.stringify(placementOf(m).data.get('learn')) === state }, `${host}: PRECONDITION — nothing else changed: the placement's state is as the alarm published it`)
        .toEqual({ events, state: true });
      await fireAlarm(m);
      const after = copyOf(m)!;
      expect(after.version > latest.version, `${host}: P63.NR2 — LOCKED: the republished learn document makes the next alarm publish (${latest.version} → ${after.version})`).toBe(true);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P63.NR3 — LOCKS: a marker in force is cleared by the next alarm publication;
// the publish order; a skipped publication leaves the latest copy recognised
// ===========================================================================

describe('unit:P63.NR3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK (P42 PW2) — with P42's stale marker in force and nothing changed since the last publication, itself an alarm publication (the home page's /pooled door failing under the product placement's own /publish), the next alarm publication succeeds and clears it: a later version, and both lift reads answer today's members only`, async () => {
      const { m } = await liftWorld(host);
      const v1 = await republish(m);
      const restore = failPooledDoor(m, HOME_MODULES);
      const refused = await (async () => { try { return await objectPublish(m, PDP_MODULES); } finally { restore(); } })();
      expect([refused.status, Object.hasOwn(refused.body, 'stale')], `${host}: PRECONDITION (P42.PW1) — the publication is refused with the stale marker (${JSON.stringify(refused.body).slice(0, 160)})`).toEqual([503, true]);
      expect(Object.hasOwn((await liftOf(m, PDP_MODULES)).body, 'stale'), `${host}: PRECONDITION (P42.PW2) — GET lift carries the marker`).toBe(true);
      await fireAlarm(m);
      const after = copyOf(m)!;
      expect(after.version > v1.version, `${host}: P63.NR3 — LOCKED (P42.PW2): the next alarm publication succeeds with the marker in force (${v1.version} → ${after.version})`).toBe(true);
      expect(await membersOf(m), `${host}: P63.NR3 — LOCKED (P42.PW2): and clears it: GET lift and GET lift/rows answer today's members only`).toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
    }, 120_000);

    it(`host (${host}): LOCK (P49) — with P49's republished marker in force (the product slot's reward republished as add_to_bag and refused at the object's /publish) and the learn document then republished with its old reward, nothing changed in the placement since the last publication, itself an alarm publication: the next alarm publication succeeds and clears it`, async () => {
      const { m } = await liftWorld(host);
      const v1 = await republish(m);
      const changed = await putDocument(m, 'learn', learnOf({ [PDP_MODULES]: dials('add_to_bag'), [HOME_MODULES]: dials() }), 'p63-republish');
      expect(changed.status, `${host}: PRECONDITION — the learn document republishes with reward add_to_bag`).toBe(200);
      const refused = await objectPublish(m, PDP_MODULES);
      expect([refused.status, Object.hasOwn(refused.body, 'republished')], `${host}: PRECONDITION (P49.LR1) — the publication is refused with the republished member (${JSON.stringify(refused.body).slice(0, 160)})`).toEqual([503, true]);
      const restored = await putDocument(m, 'learn', learnOf({ [PDP_MODULES]: dials(), [HOME_MODULES]: dials() }), 'p63-restore');
      expect(restored.status, `${host}: PRECONDITION — the learn document republishes with its old reward`).toBe(200);
      expect(Object.hasOwn((await liftOf(m, PDP_MODULES)).body, 'republished'), `${host}: PRECONDITION (P49.LR1) — GET lift carries the member until a publication succeeds`).toBe(true);
      await fireAlarm(m);
      const after = copyOf(m)!;
      expect(after.version > v1.version, `${host}: P63.NR3 — LOCKED (P49): the next alarm publication succeeds with the member in force (${v1.version} → ${after.version})`).toBe(true);
      expect(await membersOf(m), `${host}: P63.NR3 — LOCKED (P49): and clears it: GET lift and GET lift/rows answer today's members only`).toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
    }, 120_000);

    it(`host (${host}): LOCK — the publish order of an alarm publication: the object records the publication (learnPublished) before the store's put of the copy, which is made once`, async () => {
      const { m } = await liftWorld(host);
      const log = restartObject(m);
      await visit(m, 'pdp');
      const key = liftKey(TENANT, BRAND, PDP_MODULES), put = m.cache.put, order: number[] = [];
      m.cache.put = async (k: string, value: string) => { if (k === key) order.push(log.writes.length); return put.call(m.cache, k, value); };
      log.writes.length = 0;
      try { await fireAlarm(m); } finally { m.cache.put = put; }
      expect({ copyPuts: order.length, learnPublishedBeforeCopy: log.writes.slice(0, order[0]).includes('learnPublished') },
        `${host}: P63.NR3 — LOCKED (src/durable-objects/LearnStats.ts \`publish\`: learnPublished before the copy): the object's writes ${JSON.stringify(log.writes)}, the copy put after the first ${String(order[0])}`)
        .toEqual({ copyPuts: 1, learnPublishedBeforeCopy: true });
    }, 120_000);

    it(`host (${host}): LOCK (W27 R4) — a publication whose copy write failed is not a publication: after new evidence, an alarm whose put of the copy fails publishes nothing the store holds, and the next alarm, with nothing changed since, publishes it: the copy the store holds is the object's recorded publication, holding every event`, async () => {
      const { m } = await liftWorld(host);
      const earlier = await republish(m);
      await visit(m, 'pdp');
      const key = liftKey(TENANT, BRAND, PDP_MODULES), put = m.cache.put;
      m.cache.put = async (k: string, value: string) => { if (k === key) throw new Error('lever: the copy write failed'); return put.call(m.cache, k, value); };
      const failed = await fireAlarm(m).then(() => 'published', (error: Error) => `refused: ${String(error?.message ?? error)}`);
      m.cache.put = put;
      expect([failed, copyOf(m)?.version], `${host}: PRECONDITION (LearnStats.ts \`publish\`, W27 R4: "an archive or KV acknowledgement can be lost … schedule only publication again") — the alarm's publication fails and the store keeps the copy in force`)
        .toEqual(['refused: Snapshot publication unavailable', earlier.version]);
      await fireAlarm(m);
      const now = copyOf(m)!;
      const record = placementOf(m).data.get('learnPublished') as { version?: unknown } | undefined;
      expect({ later: now.version > earlier.version, recorded: record?.version === now.version, events: copyEvents(now) },
        `${host}: P63.NR3 — LOCKED: the next alarm publishes what the failed one could not (${earlier.version} → ${now.version}, recorded ${String(record?.version)})`)
        .toEqual({ later: true, recorded: true, events: heldEvents(m) });
    }, 120_000);

    it(`host (${host}): LOCK (P61, P62) — after two alarms with no new evidence, a fresh read of the copy the store holds is applied as the object's latest: the answer names 'served' and the record carries no asOf member`, async () => {
      const { m } = await liftWorld(host);
      await republish(m);
      await fireAlarm(m);
      await fireAlarm(m);
      const inForce = copyOf(m)!;
      invalidateLiftCache();
      const fresh = await decide(m, 'pdp');
      expect(liftOnRecord(fresh.record), `${host}: P63.NR3 — LOCKED: the copy in force (version ${inForce.version}) is applied`).toEqual(servedFrom(inForce.version));
      expect(liftReadOf(fresh.snapshot), `${host}: P63.NR3 — LOCKED (P61.LO1): the answer names 'served'`).toEqual({ outcome: 'served', ms: expect.any(Number) });
      expect(Object.hasOwn(itemisedLift(fresh.record) as object, 'asOf'), `${host}: P63.NR3 — LOCKED (P62.LW3): the latest copy carries no asOf`).toBe(false);
    }, 120_000);

    for (const reset of ['the explicit reset (the object\'s /recovery and /recover doors, intent reset)', 'the /reset door'] as const) {
      it(`host (${host}): LOCK (P62 door, R-P129 F1) — after ${reset} with no new evidence, the /witness door's verdict is the one /health gives (empty), not the verdict it held before the reset`, async () => {
        const { m } = await liftWorld(host);
        const held = verdictOf(await objectDoor(m, '/witness'));
        expect(held.state, `${host}: PRECONDITION — the door held a healthy verdict before the reset`).toBe('healthy');
        if (reset === 'the /reset door') {
          expect((await objectDoor(m, '/reset', {})).status, `${host}: PRECONDITION — the /reset door answers`).toBe(200);
        } else {
          const status = await objectDoor(m, '/recovery');
          const done = await objectDoor(m, '/recover', { tenant: TENANT, brand: BRAND, slot: PDP_MODULES, intent: 'reset', operationId: 'e'.repeat(32), digest: status.body.digest, generation: status.body.generation });
          expect([status.status, done.status, done.body.reset], `${host}: PRECONDITION — the explicit reset is applied (${JSON.stringify(done.body).slice(0, 160)})`).toEqual([200, 200, true]);
        }
        const door = verdictOf(await objectDoor(m, '/witness')), health = verdictOf(await objectDoor(m, '/health'));
        expect(health.state, `${host}: PRECONDITION — /health names the reset state empty`).toBe('empty');
        expect(door, `${host}: P63.NR3 — LOCKED (P62.LW2, R-P129 F1): after ${reset} the door's verdict is /health's`).toEqual(health);
      }, 120_000);
    }

    it(`host (${host}): LOCK (P62 door, R-P129 F3) — three concurrent first /witness calls of an evicted statistics object share one verdict: the stored state is read once, and each answer is the verdict /health gives`, async () => {
      const { m } = await liftWorld(host);
      const log = restartObject(m);
      const answers = await Promise.all([objectDoor(m, '/witness'), objectDoor(m, '/witness'), objectDoor(m, '/witness')]);
      const learnReads = log.reads.filter(key => key === 'learn').length;
      const health = verdictOf(await objectDoor(m, '/health'));
      expect(health.state, `${host}: PRECONDITION — /health names the state healthy`).toBe('healthy');
      expect({ learnReads, verdicts: answers.map(verdictOf) }, `${host}: P63.NR3 — LOCKED (P62.LW2, R-P112(5), R-P129 F3): one read of the stored state for the three calls, each answering /health's verdict`)
        .toEqual({ learnReads: 1, verdicts: [health, health, health] });
    }, 120_000);
  }
});
