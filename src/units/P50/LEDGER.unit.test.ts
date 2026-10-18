// src/units/P50/LEDGER.unit.test.ts
// P50 under the Closure Ledger: the tests for the LOCAL criteria of the P50 work
// order (the fifth parity programme (amendment 4), ticket P50 "A generation
// transition that does not adopt the changed member says so, or is refused"). DC1
// (D1, RESOLVED by the owner's rule R-P78: the product tells the operator; fail-closed
// stays) is exercised inside GT1-GT3; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P50.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-4/BTI-Parity-Amendment-2026-10-17b.md,
//     section 2, P50): "on both hosts, a transition whose body does not adopt every
//     changed member of the tuple is either refused with words naming the member it
//     must adopt and how (the body's `reward`, `objective`, or a republish restoring the
//     basis), or, where the specifier rules the transition may proceed, the answer and
//     the lift reads carry a warning …; a transition that adopts every changed member
//     behaves byte for byte as today; P49's and P42's units unchanged; kit 02 and 03
//     state it";
//   · the P49 delivery review section 10 (7.3), measured with its controls C0 to C3
//     (P49/reviewer/scripts/p49rv2.test.ts.txt, logs/probes/c-head-*.json, identical at
//     head and base): on P49's world (P08's documents, one visit per page, every
//     placement published; the product placement's exposures 3), a learn republish that
//     changes the product slot's reward (click to add_to_bag) followed by a transition
//     whose body omits `reward` (C3: `{ slot, objective: 'unit' }`), or one that changes
//     its measurement basis (rendered-v1 to served-v1) followed by any transition (C2:
//     `{ slot, reward: 'click' }`), answers 200 `publicationOutcome: 'acknowledged'`,
//     ends P49's refusal, and the slot's exposures stay at 0 after a visit; a transition
//     naming the new reward (C1) counts 3 after a visit, as a slot never republished does
//     (C0: 3 more);
//   · the transition today: src/durable-objects/LearnStats.ts:790-870 — the accumulation
//     the transition starts takes `reward` and `objective` from its body, else from the
//     accumulation it supersedes (:805, :807), and `measurementBasis` always from
//     the accumulation it supersedes (:808: no transition moves the basis), while the
//     `stats` block is the published document's (:806); an exposure written under the
//     document's own tuple then meets the object's 409 "statistics configuration
//     incompatible" (kit 02's `POST learn/generation` row), so nothing is counted; the
//     route (src/routes/decisions.ts:1633-1684) answers 400 for a body naming only the
//     slot (:1648-1650) and passes the object's 409 as 409 `{ ok: false, error: 'statistics
//     acknowledgement unavailable', operationId }` (:1674);
//   · P49's receipted member and words (src/units/P49/LEDGER.unit.test.ts:42-70) and
//     P42's idiom for a named refusal (an object member beside `error`, keys sorted,
//     passed through by the operator's route only when well formed, the words composed
//     from the checked member, never a downstream text echoed:
//     src/ledger/ledger.test.ts:385-396 holds).
//
// THE TELLING, RULED (D1 leaves refusing or warning to the specifier, inside fail-closed):
//   · REFUSED, NOT WARNED. A transition that would leave the slot counting nothing is
//     refused and changes nothing, rather than proceeding with a warning. Why, inside
//     fail-closed: (1) proceeding starts an accumulation that counts no exposure, so the
//     warning would announce a slot that has stopped learning, and the reads would have
//     to carry it from a new stored record until some later act — the refusal keeps
//     every byte as it is and the operator's next transition, once it names the member,
//     is the one that counts; (2) P49's refusal and its `republished` member, which
//     already tell the operator the cause, stay in force and stay true, where a
//     proceeding transition would end them while the slot stays broken; (3) the basis
//     cannot be adopted by any transition (LearnStats.ts:808), so for a basis change a
//     transition can only ever produce the slot that counts nothing: the one adopting act
//     is a republish restoring the basis, which P49 already names ("or the document is
//     republished with the old value").
//   · WHEN (R-P84 and its addenda 2 and 3, final). The object's transition compares, before
//     it writes anything, the tuple members the operator can adopt or must restore —
//     `reward`, `objective`, `measurementBasis` — as the slot's own values (`reward` `click`,
//     `objective` `unit`, `measurementBasis` `served-v1` when absent, as the configuration
//     check, LearnStats.ts:1317-1318, reads them). A member is CHANGED when its value in the
//     learn document in force differs from the ACCUMULATION'S OWN value (the value the slot's
//     statistics count under). The one exception: a slot moved ahead of a document that has
//     not changed for that slot. That is, with a generation record on file (the record the
//     last transition wrote, LearnStats.ts:839-841, :852, read by `accumulationTransition()`,
//     :882), the slot's value of that member has stayed what it was when the statistics
//     started (its value in the latest learn revision published at or before the record's
//     `at`) in every learn revision published after that `at`, read through
//     `publicationVersion` (src/config/publication.ts:566) on the transition path only. So an
//     ahead move followed by no learn edit, or by edits that leave the slot's own values as
//     they were (another slot's dials, the trust dial `gamma`), is not refused, while a
//     revert of the slot's own value after the matching document was published IS a change.
//     With no generation record on file any difference counts, and so it does (R-P84
//     addendum 2) when the learn history needed for the exception cannot be read (no
//     revision at or before the record's `at` can be read, or a read of one fails): the
//     document's values are compared with the accumulation's own and nothing is silently
//     admitted. A member so changed whose value in the accumulation the transition would
//     start is not the document's is NOT ADOPTED. `stats` is always adopted (:806). A
//     transition with no member changed — the slot's tuple did not change, the object holds
//     no accumulation yet, or the operator moved the slot ahead of its document as kit 02's
//     `POST learn/generation` row orders ("move the generation with this route FIRST, then
//     publish the tenant's matching learn document"; the W24 units' transitions), a second
//     transition before that document is published included, with or without an unrelated
//     learn edit in between, or once that document is published — behaves byte for byte as
//     today, and no words claim a republish.
//   · THE REFUSAL. At least one member not adopted: the transition writes nothing (the
//     object's stored state, its archive, its fence, its generation record, the KV and
//     R2 doubles are byte for byte what they were) and `POST /v1/:tenant/learn/generation`
//     answers 409 with the members `ok: false`, `error`, `notAdopted` and today's
//     `operationId` (its order beside `error` is the builder's; no other member):
//       notAdopted: { changed: [ { member, new, old } ], slot }   (keys sorted, R-P3;
//                  `page` beside `slot` for a page-scoped placement)
//     `changed` lists, sorted by `member`, each member not adopted: `old` the accumulation's
//     own value (the value the slot's statistics count under, as P49's `changed.old` is), `new`
//     the document's value (P49's `changed` entries, read the same way). `error` names the slot, each member with its old and
//     new values, and how to adopt it: for `reward` and `objective`, naming the new value
//     as that member of the body of `POST /v1/{tenant}/learn/generation` (or republishing
//     the learn document with the old value); for `measurementBasis`, which no transition
//     moves, republishing the learn document with the old basis. For example: "generation
//     transition refused: the learn document republished for slot pdp-modules changed
//     reward from click to add_to_bag and this transition does not adopt it, so the slot
//     would count no exposure; name reward add_to_bag in the body of POST
//     /v1/{tenant}/learn/generation (or republish the learn document with reward click)".
//     The words are composed by the route from the checked member (P49's idiom); every
//     other refusal of the transition keeps its answer.
//   · FAIL-CLOSED STAYS. After the refusal P49's refusal stands: the operator's publish
//     answers 503 with P49's `republished`, both lift reads carry it, the snapshot in
//     force is the last successful one, and the slot's accumulation is the one it had
//     (3 exposures from the world's visit; a visit under the republished document is
//     refused by the object as today, so it stays 3).
//   · NOTHING ELSE CHANGES. A transition adopting every changed member (the body's
//     `reward: 'add_to_bag'`, P49.LR1's own transition), a transition on a slot whose
//     tuple did not change, and a transition after a republish of the `stats` block
//     alone answer as today, member for member, and the slot's exposures are counted
//     after them (3 after a visit, as C0 and C1 measured); after a transition that moves
//     the slot ahead of its unchanged document, a second transition, with the same reward
//     or another, answers as today, and so does one after a learn republish that changes
//     only the home slot's `gamma` (R-P84 and its addendum; the S8 review's probes at the
//     base, S8/reviewer-spec/logs/probes/base-*.json and logs/fix1-probes/base-*.json
//     AHEAD_UNRELATED_second: 200, today's members, `acknowledged`). With a generation record
//     on file, the refusal applies as without one when the slot's own value was republished
//     after the record (addendum 3): after an ahead move to add_to_bag, the matching document
//     published and the slot counting, the document republished back to click is a change
//     of reward from add_to_bag (the accumulation's) to click (the S8 review's gap (a),
//     S8/reviewer-spec/logs/fix2-probes-b/base-*.json: today 200 and 0 exposures after a visit).
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P50.log): every
// receipted transition (W24 B1:583 adopting both members of its republish, B1:631, :668,
// :712 moving the slot ahead of an unchanged document, B1:810, W23 :487, :578, :718, P16:91,
// P41:175, P33:135 rebuilding on an unchanged document, P49:185 adopting the reward) has no
// member not adopted, so the ruling answers each as today; no test asserts the
// transition's answer to a body that leaves a republished member unadopted.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the
// transition's 409 refusal, its `notAdopted` member and its words. No new export is imported.
//
// FIXTURE. P49's world and republishes (src/units/_parity7.ts): the product slot's
// reward changed from click to add_to_bag, or its measurement basis from rendered-v1 to
// served-v1, through the operator's PUT; the operator's publish then refused naming the
// republish (P49.LR1, receipted, a PRECONDITION here); the non-adopting bodies are the
// review's C3 (`objective: 'unit'`) and C2 (`reward: 'click'`); GT1's third leg republishes the
// reward and the objective (click to add_to_bag, unit to revenue: a revenue objective needs a
// value-carrying reward, kit 03) and the body adopts the reward alone (`reward: 'add_to_bag'`).
// GT1's fourth leg (R-P84 addendum 3, a generation record on file) is the S8 review's gap (a):
// the slot moved ahead to add_to_bag on P49's click document, the matching document (add_to_bag)
// published and the slot counting 3, the document republished back to click, then a transition
// whose body names the objective only.
// GT2's ahead leg (R-P84) moves the slot ahead of P49's unchanged document (`reward:
// 'add_to_bag'` while the document names click), then transitions again with
// `reward: 'add_to_bag'` and with `reward: 'purchase'`; and, on a second world, after the
// ahead move, republishes the learn document changing only the home slot's `gamma` (1 to
// 0.5) and transitions the product slot again with `reward: 'add_to_bag'` (the addendum).
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (the kit), src/units/_parity6.ts
// (P08's world, the publish doors and the lift reads), src/units/_parity7.ts (P49's
// world, the republish, the transition, the object's stored state). Imports from
// src/units/: ../_parity, ../_parity3, ../_parity6, ../_parity7.

import { describe, expect, it } from 'vitest';

import { HOSTS, putDocument } from '../_parity';
import { missingStatements } from '../_parity3';
import {
  dials, HOME_MODULES, keyOrders, learnOf, LIFT_MEMBERS, liftOf, memberOf, operatorPublish, OPERATOR_PUBLISH_MEMBERS, PDP_MODULES, ROWS_MEMBERS, rowsOf, visit,
} from '../_parity6';
import { eventsOf, kvBytes, objectBytes, P08_STATS, p49World, r2Bytes, republishProduct, sortedKeys, transitionOf } from '../_parity7';

/** P49's member for the reward republish and for the basis republish (src/units/P49/LEDGER.unit.test.ts:140, :149). */
const REPUBLISHED = { changed: [{ member: 'reward', new: 'add_to_bag', old: 'click' }], endedBy: 'generation_transition', slot: PDP_MODULES };
const BASIS_REPUBLISHED = { changed: [{ member: 'measurementBasis', new: 'served-v1', old: 'rendered-v1' }], endedBy: 'generation_transition', slot: PDP_MODULES };
/** The ruled member (header) for each. */
const NOT_ADOPTED_REWARD = { changed: [{ member: 'reward', new: 'add_to_bag', old: 'click' }], slot: PDP_MODULES };
const NOT_ADOPTED_BASIS = { changed: [{ member: 'measurementBasis', new: 'served-v1', old: 'rendered-v1' }], slot: PDP_MODULES };
/** P49's member for the reward-and-objective republish, and the ruled member when the body adopts the reward alone. */
const BOTH_REPUBLISHED = { changed: [{ member: 'objective', new: 'revenue', old: 'unit' }, { member: 'reward', new: 'add_to_bag', old: 'click' }],
  endedBy: 'generation_transition', slot: PDP_MODULES };
const NOT_ADOPTED_OBJECTIVE = { changed: [{ member: 'objective', new: 'revenue', old: 'unit' }], slot: PDP_MODULES };
/** The ruled member for the revert after an ahead move (R-P84 addendum 3): `old` the accumulation's own value. */
const NOT_ADOPTED_REVERT = { changed: [{ member: 'reward', new: 'click', old: 'add_to_bag' }], slot: PDP_MODULES };
/** The refusal's members, sorted (header). */
const REFUSAL_MEMBERS = ['error', 'notAdopted', 'ok', 'operationId'];
/** Today's success answer of the transition, member for member (src/routes/decisions.ts:1676-1678; no page, no rebuild). */
const TRANSITION_MEMBERS = ['ok', 'tenant', 'brand', 'slot', 'operationId', 'generation', 'restartedAt', 'archivedVersion', 'publicationOutcome'];

/** What the reward refusal's words name, against the ruling: the slot, the member, its old and new values, and how to adopt it (the body of the route). */
function rewardWordsOf(error: unknown) {
  const text = String(error ?? '');
  return { slot: text.includes(PDP_MODULES), member: /\breward\b/.test(text), old: /\bclick\b/.test(text), new: text.includes('add_to_bag'), how: text.includes('/learn/generation') };
}
/** What the basis refusal's words name: the slot, the member, its old and new values, and how to adopt it (a republish restoring the basis). */
function basisWordsOf(error: unknown) {
  const text = String(error ?? '');
  return { slot: text.includes(PDP_MODULES), member: text.includes('measurementBasis'), old: text.includes('rendered-v1'), new: text.includes('served-v1'), how: /republish/i.test(text) };
}
/** What the objective refusal's words name: the slot, the member, its old and new values, and how to adopt it (the body of the route). */
function objectiveWordsOf(error: unknown) {
  const text = String(error ?? '');
  return { slot: text.includes(PDP_MODULES), member: /\bobjective\b/.test(text), old: /\bunit\b/.test(text), new: /\brevenue\b/.test(text), how: text.includes('/learn/generation') };
}
/** What the revert refusal's words name: the slot, the member, its old (add_to_bag) and new (click) values, and how to adopt it. */
function revertWordsOf(error: unknown) {
  const text = String(error ?? '');
  return { slot: text.includes(PDP_MODULES), member: /\breward\b/.test(text), old: text.includes('add_to_bag'), new: /\bclick\b/.test(text), how: text.includes('/learn/generation') };
}
const NAMED = { slot: true, member: true, old: true, new: true, how: true };
const unsorted = (...values: unknown[]) => values.flatMap(v => keyOrders(v)).filter(([written, sorted]) => written.join() !== sorted.join());
const show = (body: unknown) => JSON.stringify(body).slice(0, 240);

// ===========================================================================
// unit:P50.GT1 — a transition that does not adopt the changed member is refused, naming it and how
// ===========================================================================

describe('unit:P50.GT1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): after the learn document is republished with the product slot's reward changed from click to add_to_bag, a transition whose body omits reward is refused 409 naming the slot, reward with its old and new values and how to adopt it, and writes nothing: P49's refusal stands and the slot keeps its accumulation; the transition naming reward add_to_bag then answers and the slot counts a visit`, async () => {
      const m = await p49World(host);
      await republishProduct(m);
      const refusedPublish = await operatorPublish(m, PDP_MODULES);
      expect([refusedPublish.status, memberOf(refusedPublish, 'republished')], `${host}: PRECONDITION (P49.LR1, receipted) — the product slot's publication is refused naming the republish`).toEqual([503, REPUBLISHED]);
      const object = objectBytes(m), kv = kvBytes(m), r2 = r2Bytes(m);

      const answer = await transitionOf(m, { objective: 'unit' });
      expect.soft(answer.status, `${host}: P50.GT1 — a transition whose body does not adopt the republished reward is refused (${show(answer.body)})`).toBe(409);
      expect.soft(memberOf(answer, 'notAdopted'), `${host}: P50.GT1 — the refusal names the slot and the member it does not adopt, with its old and new values`).toEqual(NOT_ADOPTED_REWARD);
      expect.soft(rewardWordsOf(answer.body.error), `${host}: P50.GT1 — and says in words what it must adopt and how (${String(answer.body.error)})`).toEqual(NAMED);
      expect.soft([answer.body.ok, sortedKeys(answer)], `${host}: P50.GT1 — the refusal's members`).toEqual([false, REFUSAL_MEMBERS]);
      expect.soft(unsorted(answer.body.notAdopted), `${host}: P50.GT1 — R-P3: written with sorted keys`).toEqual([]);
      expect.soft([objectBytes(m) === object, kvBytes(m) === kv, r2Bytes(m) === r2], `${host}: P50.GT1 — the refused transition writes nothing: the object, KV and R2 are byte for byte what they were`)
        .toEqual([true, true, true]);
      const still = await operatorPublish(m, PDP_MODULES), lift = await liftOf(m, PDP_MODULES), rows = await rowsOf(m, PDP_MODULES);
      expect.soft([still.status, memberOf(still, 'republished'), memberOf(lift, 'republished'), memberOf(rows, 'republished')],
        `${host}: P50.GT1 — fail-closed stays: P49's refusal stands at the publish and on both reads`).toEqual([503, REPUBLISHED, REPUBLISHED, REPUBLISHED]);
      await visit(m, 'pdp');
      expect.soft(eventsOf(m), `${host}: P50.GT1 — the slot keeps the accumulation it had (3 exposures); the review measured 0 after a non-adopting transition (P49 review §10 7.3, C3)`).toBe(3);

      const adopted = await transitionOf(m, { reward: 'add_to_bag' });
      expect.soft([adopted.status, adopted.body.publicationOutcome], `${host}: P50.GT1 — following the words, the transition naming reward add_to_bag answers (${show(adopted.body)})`).toEqual([200, 'acknowledged']);
      await visit(m, 'pdp');
      expect.soft(eventsOf(m), `${host}: P50.GT1 — and the slot counts the next visit (3, as the review's C1)`).toBe(3);
    }, 180_000);

    it(`host (${host}): after the learn document is republished with the product slot's measurement basis changed from rendered-v1 to served-v1, a transition (whose body names the reward the slot has) is refused 409 naming the slot, measurementBasis with its old and new values and that a republish restoring the basis adopts it, and writes nothing; the republish restoring rendered-v1 then publishes and the slot counts a visit`, async () => {
      const m = await p49World(host);
      await republishProduct(m, dials('click', { measurementBasis: 'served-v1' }));
      const refusedPublish = await operatorPublish(m, PDP_MODULES);
      expect([refusedPublish.status, memberOf(refusedPublish, 'republished')], `${host}: PRECONDITION (P49.LR1, receipted) — the product slot's publication is refused naming the basis republish`).toEqual([503, BASIS_REPUBLISHED]);
      const object = objectBytes(m), kv = kvBytes(m), r2 = r2Bytes(m);

      const answer = await transitionOf(m, { reward: 'click' });
      expect.soft(answer.status, `${host}: P50.GT1 — a transition cannot adopt a republished basis and is refused (${show(answer.body)})`).toBe(409);
      expect.soft(memberOf(answer, 'notAdopted'), `${host}: P50.GT1 — the refusal names the slot and measurementBasis with its old and new values`).toEqual(NOT_ADOPTED_BASIS);
      expect.soft(basisWordsOf(answer.body.error), `${host}: P50.GT1 — and says in words that a republish restoring the basis adopts it (${String(answer.body.error)})`).toEqual(NAMED);
      expect.soft([answer.body.ok, sortedKeys(answer)], `${host}: P50.GT1 — the refusal's members`).toEqual([false, REFUSAL_MEMBERS]);
      expect.soft([objectBytes(m) === object, kvBytes(m) === kv, r2Bytes(m) === r2], `${host}: P50.GT1 — the refused transition writes nothing`).toEqual([true, true, true]);
      const still = await operatorPublish(m, PDP_MODULES), lift = await liftOf(m, PDP_MODULES);
      expect.soft([still.status, memberOf(still, 'republished'), memberOf(lift, 'republished')], `${host}: P50.GT1 — fail-closed stays: P49's refusal stands`)
        .toEqual([503, BASIS_REPUBLISHED, BASIS_REPUBLISHED]);
      await visit(m, 'pdp');
      expect.soft(eventsOf(m), `${host}: P50.GT1 — the slot keeps the accumulation it had (3 exposures); the review measured 0 after a transition on a republished basis (C2)`).toBe(3);

      await republishProduct(m, dials('click'));
      const restored = await operatorPublish(m, PDP_MODULES);
      expect.soft([restored.status, restored.body.published], `${host}: P50.GT1 — following the words, the republish restoring rendered-v1 ends the refusal (${show(restored.body)})`).toEqual([200, true]);
      await visit(m, 'pdp');
      expect.soft(eventsOf(m), `${host}: P50.GT1 — and the slot counts the next visit on its accumulation (3 + 3)`).toBe(6);
    }, 180_000);

    it(`host (${host}): after the learn document is republished with the product slot's reward and objective changed (click to add_to_bag, unit to revenue), a transition whose body adopts the reward alone is refused 409 naming objective with its old and new values and how to adopt it, and writes nothing; the transition naming both then answers`, async () => {
      const m = await p49World(host);
      await republishProduct(m, dials('add_to_bag', { objective: 'revenue' }));
      const refusedPublish = await operatorPublish(m, PDP_MODULES);
      expect([refusedPublish.status, memberOf(refusedPublish, 'republished')], `${host}: PRECONDITION (P49.LR1, receipted) — the product slot's publication is refused naming both members`).toEqual([503, BOTH_REPUBLISHED]);
      const object = objectBytes(m), kv = kvBytes(m), r2 = r2Bytes(m);

      const answer = await transitionOf(m, { reward: 'add_to_bag' });
      expect.soft(answer.status, `${host}: P50.GT1 — a transition whose body adopts the reward but not the objective is refused (${show(answer.body)})`).toBe(409);
      expect.soft(memberOf(answer, 'notAdopted'), `${host}: P50.GT1 — the refusal names the member it does not adopt, and only that one`).toEqual(NOT_ADOPTED_OBJECTIVE);
      expect.soft(objectiveWordsOf(answer.body.error), `${host}: P50.GT1 — and says in words what it must adopt and how (${String(answer.body.error)})`).toEqual(NAMED);
      expect.soft([answer.body.ok, sortedKeys(answer)], `${host}: P50.GT1 — the refusal's members`).toEqual([false, REFUSAL_MEMBERS]);
      expect.soft([objectBytes(m) === object, kvBytes(m) === kv, r2Bytes(m) === r2], `${host}: P50.GT1 — the refused transition writes nothing`).toEqual([true, true, true]);

      const adopted = await transitionOf(m, { reward: 'add_to_bag', objective: 'revenue' });
      expect.soft([adopted.status, adopted.body.publicationOutcome], `${host}: P50.GT1 — following the words, the transition naming both answers (${show(adopted.body)})`).toEqual([200, 'acknowledged']);
    }, 180_000);

    it(`host (${host}): with a generation record on file — the slot moved ahead to add_to_bag, the matching document published and the slot counting under it — after the learn document is republished back to click, a transition whose body names the objective only is refused 409 naming reward, old add_to_bag (the accumulation's), new click, and writes nothing; the slot keeps the accumulation it counts under`, async () => {
      const m = await p49World(host);
      const ahead = await transitionOf(m, { reward: 'add_to_bag' });
      expect([ahead.status, ahead.body.publicationOutcome], `${host}: PRECONDITION — the transition moving the slot ahead to add_to_bag answers (${show(ahead.body)})`).toEqual([200, 'acknowledged']);
      // Later milliseconds than the generation record's, so the republishes are published after the slot's statistics started.
      await new Promise(r => setTimeout(r, 5));
      await republishProduct(m);
      const matched = await operatorPublish(m, PDP_MODULES);
      expect(matched.status, `${host}: PRECONDITION — the matching document (add_to_bag) publishes (${show(matched.body)})`).toBe(200);
      await visit(m, 'pdp');
      expect(eventsOf(m), `${host}: PRECONDITION (the S8 review's gap (a)) — the slot counts under the matching document`).toBe(3);
      await new Promise(r => setTimeout(r, 5));
      await republishProduct(m, dials('click'));
      const object = objectBytes(m), kv = kvBytes(m), r2 = r2Bytes(m);

      const answer = await transitionOf(m, { objective: 'unit' });
      expect.soft(answer.status, `${host}: P50.GT1 — R-P84 addendum 3: with a record on file, a transition that does not adopt the reverted reward is refused (${show(answer.body)})`).toBe(409);
      expect.soft(memberOf(answer, 'notAdopted'), `${host}: P50.GT1 — the refusal names reward, old the accumulation's add_to_bag, new the document's click`).toEqual(NOT_ADOPTED_REVERT);
      expect.soft(revertWordsOf(answer.body.error), `${host}: P50.GT1 — and says in words what it must adopt and how (${String(answer.body.error)})`).toEqual(NAMED);
      expect.soft([answer.body.ok, sortedKeys(answer)], `${host}: P50.GT1 — the refusal's members`).toEqual([false, REFUSAL_MEMBERS]);
      expect.soft([objectBytes(m) === object, kvBytes(m) === kv, r2Bytes(m) === r2], `${host}: P50.GT1 — the refused transition writes nothing`).toEqual([true, true, true]);
      await visit(m, 'pdp');
      expect.soft(eventsOf(m), `${host}: P50.GT1 — the slot keeps the accumulation it counts under (3 exposures); the review measured 0 after this transition (gap (a))`).toBe(3);
    }, 180_000);
  }
});

// ===========================================================================
// unit:P50.GT2 — LOCK: adopting transitions and unchanged tuples answer as today and count
// ===========================================================================

describe('unit:P50.GT2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — after the reward republish, the transition naming reward add_to_bag answers as today, member for member, and the slot counts the next visit (3), publishes and reads as today`, async () => {
      const m = await p49World(host);
      await republishProduct(m);
      expect((await operatorPublish(m, PDP_MODULES)).status, `${host}: PRECONDITION — the republish is refused (P49)`).toBe(503);
      const answer = await transitionOf(m, { reward: 'add_to_bag' });
      expect([answer.status, Object.keys(answer.body), answer.body.publicationOutcome], `${host}: P50.GT2 — the adopting transition's answer is today's (${show(answer.body)})`)
        .toEqual([200, TRANSITION_MEMBERS, 'acknowledged']);
      await visit(m, 'pdp');
      expect(eventsOf(m), `${host}: P50.GT2 — the slot counts the visit after it (C1: 3)`).toBe(3);
      const published = await operatorPublish(m, PDP_MODULES);
      expect([published.status, Object.keys(published.body)], `${host}: P50.GT2 — the operator's publish answers as today`).toEqual([200, OPERATOR_PUBLISH_MEMBERS]);
      expect([Object.keys((await liftOf(m, PDP_MODULES)).body), Object.keys((await rowsOf(m, PDP_MODULES)).body)], `${host}: P50.GT2 — the reads carry today's members`)
        .toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
    }, 180_000);

    it(`host (${host}): LOCK — a transition on a slot whose tuple did not change (the body naming the reward the slot has), and one after a republish of the statistics block alone (nMin 2 to 5, which every transition takes from the document), answer as today and the slot counts the next visit (3)`, async () => {
      const m = await p49World(host);
      const unchanged = await transitionOf(m, { reward: 'click' });
      expect([unchanged.status, Object.keys(unchanged.body), unchanged.body.publicationOutcome], `${host}: P50.GT2 — an unchanged tuple: the transition's answer is today's (${show(unchanged.body)})`)
        .toEqual([200, TRANSITION_MEMBERS, 'acknowledged']);
      await visit(m, 'pdp');
      expect(eventsOf(m), `${host}: P50.GT2 — and the slot counts the visit after it`).toBe(3);

      const n = await p49World(host);
      await republishProduct(n, dials(), { ...P08_STATS, nMin: 5 });
      expect((await operatorPublish(n, PDP_MODULES)).status, `${host}: PRECONDITION — the statistics republish is refused (P49, stats.nMin)`).toBe(503);
      const stats = await transitionOf(n, { reward: 'click' });
      expect([stats.status, Object.keys(stats.body), stats.body.publicationOutcome], `${host}: P50.GT2 — a statistics republish is adopted by the transition: its answer is today's (${show(stats.body)})`)
        .toEqual([200, TRANSITION_MEMBERS, 'acknowledged']);
      await visit(n, 'pdp');
      expect(eventsOf(n), `${host}: P50.GT2 — and the slot counts the visit after it`).toBe(3);
    }, 180_000);

    it(`host (${host}): LOCK (R-P84) — after a transition that moves the slot ahead of its unchanged document (reward add_to_bag while the document names click, kit 02's ORDER), a second transition with the same reward and one with another reward (purchase) answer as today, member for member, and so does a second transition after a learn edit changing only the home slot's trust`, async () => {
      const m = await p49World(host);
      const ahead = await transitionOf(m, { reward: 'add_to_bag' });
      expect([ahead.status, Object.keys(ahead.body), ahead.body.publicationOutcome], `${host}: P50.GT2 — the transition moving the slot ahead of its document answers as today (${show(ahead.body)})`)
        .toEqual([200, TRANSITION_MEMBERS, 'acknowledged']);
      for (const reward of ['add_to_bag', 'purchase']) {
        const again = await transitionOf(m, { reward });
        expect([again.status, Object.keys(again.body), again.body.publicationOutcome], `${host}: P50.GT2 — before the matching document is published, a second transition naming reward ${reward} answers as today: no republish happened (${show(again.body)})`)
          .toEqual([200, TRANSITION_MEMBERS, 'acknowledged']);
      }

      const n = await p49World(host);
      const moved = await transitionOf(n, { reward: 'add_to_bag' });
      expect([moved.status, moved.body.publicationOutcome], `${host}: PRECONDITION — the transition moving the slot ahead answers (${show(moved.body)})`).toEqual([200, 'acknowledged']);
      // A later millisecond than the generation record's, so the unrelated edit is published after the slot's statistics started.
      await new Promise(r => setTimeout(r, 5));
      const unrelated = await putDocument(n, 'learn', { ...learnOf({ [PDP_MODULES]: dials(), [HOME_MODULES]: dials('click', { gamma: 0.5 }) }), stats: P08_STATS }, 'p50-home-only');
      expect(unrelated.status, `${host}: PRECONDITION — the learn document republishes with only the home slot's trust changed (${show(unrelated.body)})`).toBe(200);
      const after = await transitionOf(n, { reward: 'add_to_bag' });
      expect([after.status, Object.keys(after.body), after.body.publicationOutcome], `${host}: P50.GT2 — after a learn edit that leaves the product slot's values as they were, the second product transition answers as today: no member of this slot changed (${show(after.body)})`)
        .toEqual([200, TRANSITION_MEMBERS, 'acknowledged']);
    }, 180_000);
  }
});

// ===========================================================================
// unit:P50.GT3 — the kit
// ===========================================================================

describe('unit:P50.GT3', () => {
  it('logic: the API reference and the payload schemas state the transition\'s refusal of a member it does not adopt, its member, and what adopts it', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'a generation transition that does not adopt a member a learn republish changed is refused (409) with notAdopted',
        test: t => /notAdopted/.test(t) && /(refus|409)/i.test(t) && /(transition|learn\/generation)/i.test(t) },
      { name: 'its member: notAdopted names the slot and each member not adopted with its old and new values',
        test: t => /notAdopted/.test(t) && /\bchanged\b/.test(t) && /\bold\b/.test(t) && /\bnew\b/.test(t) && /\bslot\b/.test(t) },
      { name: 'what adopts it: the body\'s reward or objective naming the new value, or a learn document republished with the old measurement basis',
        test: t => /(notAdopted|adopt)/.test(t) && /\breward\b/.test(t) && /\bobjective\b/.test(t) && /(measurementBasis|measurement basis)/.test(t) && /republish/i.test(t) },
    ]);
    expect(missing, 'P50.GT3 — kit 02 and 03 state the refusal, its member and what adopts it').toEqual([]);
  });
});
