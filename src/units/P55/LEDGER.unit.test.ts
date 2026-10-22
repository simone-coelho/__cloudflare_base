// src/units/P55/LEDGER.unit.test.ts
// P55 under the Closure Ledger: the tests for the LOCAL criteria of the P55 work
// order (the fifth parity programme (amendment 4), ticket P55 "After a transition
// whose own publication failed, the reads tell the truth"). DC1 (D1, RESOLVED by the
// owner's rule R-P78: the reads tell the truth after the operator acts; fail-closed
// stays) is exercised inside TT1-TT3; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P55.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-4/BTI-Parity-Amendment-2026-10-17b.md,
//     section 2, P55): "on both hosts, once a transition for the slot is on record, the
//     lift reads no longer say the transition is what ends the refusal: the specifier
//     rules whether the transition supersedes P49's record with one put after its
//     transaction, or whether the member's `endedBy` and words change to name what now
//     ends it (the pooled fault, P42's marker); every other P49 and P42 behaviour
//     unchanged; kit 02 and 03 state it";
//   · the P49 delivery review section 10 (7.2), measured with its probe S7
//     (P49/reviewer/scripts/p49rv.test.ts.txt:172-199, logs/probes/head2-*.json): with
//     the home page's `/pooled` door failing, after a refused publication naming the
//     republish, the operator's transition answers 200 with `publicationOutcome:
//     'unknown'` (its own publication failed on the pooled cause), and then both lift
//     reads still end `stale`, `republished` — the member still saying
//     `endedBy: 'generation_transition'` — while the next publish answers 503 naming the
//     pooled cause alone (`{ ok, error, stale }`); with the door restored the next
//     publish succeeds and the reads carry today's members only;
//   · the transition's transaction: src/durable-objects/LearnStats.ts:849-860 (the
//     transaction, then `publish(true)`, whose failure answers `publicationOutcome:
//     'unknown'`); P49's record and its lapse: src/learn/fan.ts:203-270 (the record
//     `{ lastPublished, republished }` under `liftRepublishedKey`, applying while the
//     snapshot in force is the one it names, `republishedIn`); P42's marker
//     (src/units/P42/LEDGER.unit.test.ts:43-66), written by a publication refused for the
//     pooled cause, the transition's own included, until a publication succeeds.
//
// THE TRUTH, RULED (D1 leaves superseding or renaming to the specifier, inside fail-closed):
//   · SUPERSEDED, NOT RENAMED. Once the operator's transition is on record, the
//     republish no longer holds the slot: the transition adopted the member (P50 refuses
//     one that does not), so what still holds the slot is the pooled fault, which P42's
//     `stale` already names, with the snapshot in force, on the same reads. Renaming
//     `endedBy` would make P49's member say a second thing P42's marker says already, and
//     every reader of P49's member would meet a value P49 never answers.
//   · HOW. After its transaction, when the transition's own publication does not succeed
//     (its answer's `publicationOutcome: 'unknown'`) and P49's record is stored for the
//     placement, the transition supersedes that record with ONE put (the stored form is
//     the builder's; no new key), so that from then on both lift reads carry no
//     `republished` for the placement. A transition whose publication succeeds writes
//     nothing new (the record lapses as today), and a placement without P49's record gets
//     no record and no new key. Locked (R-P84): the KV keys after that transition are the
//     keys before it plus P42's marker key (`liftStaleKey`, which its failed publication
//     writes) and no other, which is exactly what the base adds (the S8 specifier's fix-1
//     probe, logs/fix1-probes/base-keys-*.json).
//   · AGREEMENT. After such a transition both lift reads end with P42's `stale` alone,
//     and the operator's next publish (refused for the pooled cause) answers 503
//     `{ ok, error, stale }` with the same marker: the publish answer and the reads agree.
//     Fail-closed stays: the snapshot in force is the last successful one until a
//     publication succeeds; with the door restored the next publication succeeds and both
//     reads carry today's members only (P42).
//   · NOTHING ELSE CHANGES. A transition whose publication succeeds; a publication
//     refused after a republish before any transition (the reads end `stale`,
//     `republished`, P49's record as written); a transition under the pooled fault on a
//     placement never republished (the reads end `stale`, no record) — each as today;
//     P49's and P42's units unchanged.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P55.log):
//   · P49.LR1 (src/units/P49/LEDGER.unit.test.ts:185-190) runs the transition with its
//     publication succeeding and expects today's members after it: under the ruling the
//     record lapses as today; no receipted test runs a transition under a pooled fault;
//   · kit 02:1955-1958 says `republished` ends "after an operator starts the new
//     generation … whose own publication succeeds": true under the ruling, and the build
//     adds what the reads say when it does not (TT3);
//   · the api-boundary call-list pins of R-P81 (src/index.api-boundary.test.ts:2865,
//     :2873) concern the reads, which this ticket does not change for a healthy slot.
//
// RULED MEMBERS THAT DO NOT EXIST YET: the transition's superseding put. No new export
// is imported.
//
// FIXTURE. P49's world (src/units/_parity7.ts): the product slot's reward changed from
// click to add_to_bag through the operator's PUT, the operator's publish refused naming
// it (P49.LR1, a PRECONDITION), then the home page's `/pooled` door failing (P42's R7
// injection, src/units/_parity6.ts `failPooledDoor`) while the operator's transition
// naming reward add_to_bag — the adopting transition, which P50 admits — answers 200 with
// its own publication failed on the pooled cause.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (the kit), src/units/_parity6.ts
// (the publish doors, the lift reads, the pooled fault), src/units/_parity7.ts (P49's
// world, the republish, the transition, the KV double). Imports from src/units/:
// ../_parity, ../_parity3, ../_parity6, ../_parity7.

import { describe, expect, it } from 'vitest';

import { liftStaleKey } from '@/learn/fan';

import { BRAND, HOSTS, TENANT, type Answer } from '../_parity';
import { missingStatements } from '../_parity3';
import {
  failPooledDoor, HOME_MODULES, identityOf, LIFT_MEMBERS, liftOf, memberOf, objectPublish, operatorPublish, OPERATOR_PUBLISH_MEMBERS, PDP_MODULES, POOLED, ROWS_MEMBERS,
  rowsOf, visit, type Published,
} from '../_parity6';
import { kvKeys, p49World, republishProduct, transitionOf } from '../_parity7';

/** P49's member for the reward republish (src/units/P49/LEDGER.unit.test.ts:157). */
const REPUBLISHED = { changed: [{ member: 'reward', new: 'add_to_bag', old: 'click' }], endedBy: 'generation_transition', slot: PDP_MODULES };
/** P42's marker for the home page's fault on the product slot (src/units/P42/LEDGER.unit.test.ts:211), P08's world: the one pooled module. */
const staleOf = (last: Published) => ({ lastPublished: { publishedAt: last.publishedAt, version: last.version }, modules: [POOLED], placement: { page: 'home', slot: HOME_MODULES } });
/** The refusal for the pooled cause, member for member (P42's ruling, kit 02:1905-1912). */
const STALE_REFUSAL_MEMBERS = ['ok', 'error', 'stale'];
const RECORD = 'lift-republished:';
const show = (answer: Answer) => JSON.stringify(answer.body).slice(0, 240);

// ===========================================================================
// unit:P55.TT1 — after a transition whose own publication failed, the reads tell the truth
// ===========================================================================

describe('unit:P55.TT1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): after the reward republish is refused and the operator's transition naming reward add_to_bag fails its own publication on the home page's pooled fault, both lift reads end with P42's stale alone, no longer with republished, the operator's next publish names the same stale and nothing else, and the snapshot in force stays the last successful one; with the door restored the next publish succeeds and the reads carry today's members`, async () => {
      const m = await p49World(host);
      const last = identityOf(await liftOf(m, PDP_MODULES));
      await republishProduct(m);
      const refused = await operatorPublish(m, PDP_MODULES);
      expect([refused.status, memberOf(refused, 'republished')], `${host}: PRECONDITION (P49.LR1, receipted) — the publication is refused naming the republish`).toEqual([503, REPUBLISHED]);
      await visit(m, 'pdp');
      const restore = failPooledDoor(m, HOME_MODULES);
      try {
        const keysBefore = kvKeys(m);
        const transition = await transitionOf(m, { reward: 'add_to_bag' });
        expect([transition.status, transition.body.publicationOutcome], `${host}: PRECONDITION (the P49 review's S7) — the transition is on record and its own publication failed (${show(transition)})`)
          .toEqual([200, 'unknown']);
        expect.soft(kvKeys(m), `${host}: P55.TT1 — ONE put, no new key (R-P84): the transition adds P42's marker key only, as at the base`)
          .toEqual([...keysBefore, liftStaleKey(TENANT, BRAND, PDP_MODULES)].sort());
        const lift = await liftOf(m, PDP_MODULES), rows = await rowsOf(m, PDP_MODULES);
        expect.soft(Object.keys(lift.body), `${host}: P55.TT1 — GET lift no longer carries republished: it ends with P42's stale alone (${show(lift)})`).toEqual([...LIFT_MEMBERS, 'stale']);
        expect.soft(Object.keys(rows.body), `${host}: P55.TT1 — GET lift/rows likewise`).toEqual([...ROWS_MEMBERS, 'stale']);
        const published = await operatorPublish(m, PDP_MODULES);
        expect.soft([published.status, Object.keys(published.body)], `${host}: P55.TT1 — the operator's next publish is refused for the pooled cause alone (${show(published)})`).toEqual([503, STALE_REFUSAL_MEMBERS]);
        expect.soft([memberOf(lift, 'stale'), memberOf(rows, 'stale'), memberOf(published, 'stale')], `${host}: P55.TT1 — the publish answer and the reads agree: the same marker, naming the home placement and the last successful publish`)
          .toEqual([staleOf(last), staleOf(last), staleOf(last)]);
        expect.soft(identityOf(lift), `${host}: P55.TT1 — LOCKED (fail-closed stays): the snapshot in force is the last successful one`).toEqual(last);
      } finally { restore(); }
      const healed = await operatorPublish(m, PDP_MODULES);
      expect.soft([healed.status, healed.body.published], `${host}: P55.TT1 — LOCKED (P42.PW2): with the door restored the next publish succeeds`).toEqual([200, true]);
      expect.soft([Object.keys((await liftOf(m, PDP_MODULES)).body), Object.keys((await rowsOf(m, PDP_MODULES)).body)], `${host}: P55.TT1 — and both reads carry today's members only`)
        .toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
    }, 180_000);
  }
});

// ===========================================================================
// unit:P55.TT2 — LOCK: every other P49 and P42 behaviour as today
// ===========================================================================

describe('unit:P55.TT2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a transition whose publication succeeds answers and reads as today and leaves P49's record as it was; a publication refused after a republish before any transition, with a stale marker already recorded, reads stale then republished as P49 wrote it`, async () => {
      const m = await p49World(host);
      await republishProduct(m);
      expect((await operatorPublish(m, PDP_MODULES)).status, `${host}: PRECONDITION (P49) — the republish is refused`).toBe(503);
      const record = [...m.cache.data.entries()].filter(([key]) => key.startsWith(RECORD));
      expect(record.length, `${host}: PRECONDITION (P49) — the refusal recorded its member under its own key`).toBe(1);
      const transition = await transitionOf(m, { reward: 'add_to_bag' });
      expect([transition.status, transition.body.publicationOutcome], `${host}: P55.TT2 — the transition whose publication succeeds answers as today (${show(transition)})`).toEqual([200, 'acknowledged']);
      expect([...m.cache.data.entries()].filter(([key]) => key.startsWith(RECORD)), `${host}: P55.TT2 — and writes nothing new over P49's record (it lapses as today)`).toEqual(record);
      expect([Object.keys((await liftOf(m, PDP_MODULES)).body), Object.keys((await rowsOf(m, PDP_MODULES)).body)], `${host}: P55.TT2 — the reads carry today's members`)
        .toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
      const published = await operatorPublish(m, PDP_MODULES);
      expect([published.status, Object.keys(published.body)], `${host}: P55.TT2 — the operator's publish answers as today`).toEqual([200, OPERATOR_PUBLISH_MEMBERS]);

      const n = await p49World(host);
      const last = identityOf(await liftOf(n, PDP_MODULES));
      await visit(n, 'pdp');
      const restore = failPooledDoor(n, HOME_MODULES);
      const stale = await (async () => { try { return await objectPublish(n, PDP_MODULES); } finally { restore(); } })();
      expect(stale.status, `${host}: PRECONDITION (P42.PW1) — the product page's publication fails closed under the home page's fault`).toBe(503);
      await republishProduct(n);
      expect((await operatorPublish(n, PDP_MODULES)).status, `${host}: PRECONDITION (P49) — the republish is refused`).toBe(503);
      for (const read of [await liftOf(n, PDP_MODULES), await rowsOf(n, PDP_MODULES)]) {
        expect([Object.keys(read.body).slice(-2), memberOf(read, 'stale'), memberOf(read, 'republished')], `${host}: P55.TT2 — before any transition the reads end stale, then republished, as P49 and P42 wrote them (the P49 review's S7 (ii))`)
          .toEqual([['stale', 'republished'], staleOf(last), REPUBLISHED]);
      }
    }, 180_000);

    it(`host (${host}): LOCK — a transition under the home page's pooled fault on a placement never republished (the body naming the reward the slot has) answers with its publication unknown, the reads end with P42's stale as today, and no record of P49's is written`, async () => {
      const m = await p49World(host);
      const last = identityOf(await liftOf(m, PDP_MODULES));
      await visit(m, 'pdp');
      const restore = failPooledDoor(m, HOME_MODULES);
      try {
        const transition = await transitionOf(m, { reward: 'click' });
        expect([transition.status, transition.body.publicationOutcome], `${host}: PRECONDITION — the transition is on record and its own publication failed (${show(transition)})`).toEqual([200, 'unknown']);
        const lift = await liftOf(m, PDP_MODULES);
        expect([Object.keys(lift.body), memberOf(lift, 'stale')], `${host}: P55.TT2 — the lift read ends with P42's stale as today`).toEqual([[...LIFT_MEMBERS, 'stale'], staleOf(last)]);
        expect(kvKeys(m).filter(key => key.startsWith(RECORD)), `${host}: P55.TT2 — no record of P49's for a placement never republished`).toEqual([]);
      } finally { restore(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P55.TT3 — the kit
// ===========================================================================

describe('unit:P55.TT3', () => {
  it('logic: the API reference and the payload schemas state what the lift reads say after a transition whose own publication fails', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'after a generation transition whose own publication does not succeed, the reads no longer carry republished',
        test: t => /\brepublished\b/.test(t) && /(transition|learn\/generation)/i.test(t) && /(fail|does not succeed|unknown|refused)/i.test(t) && /(no longer|supersede|gone|drops?)/i.test(t) },
      { name: 'what they carry then: P42\'s stale, naming the pooled fault, until a publication succeeds, as the publish answer does',
        test: t => /\bstale\b/.test(t) && /(transition|learn\/generation)/i.test(t) && /\bpooled\b/i.test(t) && /(until|succeed)/i.test(t) },
    ]);
    expect(missing, 'P55.TT3 — kit 02 and 03 state what the reads say after a transition').toEqual([]);
  });
});
