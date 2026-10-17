// src/units/P49/LEDGER.unit.test.ts
// P49 under the Closure Ledger: the tests for the LOCAL criteria of the P49 work
// order (the fourth parity programme (amendment 3),
// ticket P49 "A learn republish does not leave a bare 'statistics
// recovery required'"). DC1 (D1, RESOLVED by the owner's rule R-P78: the product
// tells the operator) is exercised inside LR1-LR3; LV1 is a deferred live row and
// gets no test.
//
// One `describe('unit:P49.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-3/BTI-Parity-Amendment-2026-10-17.md,
//     section 2, P49): "on both hosts, after an authorized learn republish that
//     changes the accumulation tuple, the operator's publish answer and the lift reads
//     either succeed or answer a refusal that names the republish as the cause (the
//     slot, the member that changed, the old and new values) and says what ends it (the
//     generation transition, by whom or when); the refusal of every other cause keeps
//     its text; a republish that changes nothing in the tuple is not refused; kit 02 and
//     03 state it"; the work order's decision D1: "fail-closed stays";
//   · P42's reading (e) (P42/implementer/REPORT.md §6 (e)), measured with its probe
//     (P42/implementer/scripts/p42-probe-head.test.ts.txt): a learn document republished
//     with another reward is refused first by the configuration check, with today's text
//     at the object and at the route; the operator's generation transition answers 200
//     and the next publication succeeds;
//   · the check today: src/durable-objects/LearnStats.ts:1246-1262 (`priorsFor`, run by
//     every publication before the pooled read): the slot's configured tuple in the
//     published learn document — `reward`, `objective`, `measurementBasis` and the
//     `stats` block (`n0`, `tauLearnMs`, `liftMin`, `liftMax`, `nMin`) — against the
//     configuration the object accumulates under; a difference no authorized transition
//     accounts for throws `recovery()` (:129), 503 `{ ok: false, error: 'statistics
//     recovery required' }` at the object's `/publish` (:257), which the operator's
//     `POST /v1/:tenant/learn/publish` turns into 503 `{ ok: false, error: 'statistics
//     acknowledgement unavailable' }` (src/routes/decisions.ts:1574-1577); the lift reads
//     answer the snapshot in force, unchanged and with no word of it (decisions.ts:754-781,
//     :455-489); what ends it is the operator's `POST /v1/:tenant/learn/generation`
//     (decisions.ts:1581-1653, LearnStats.ts:763-831), kit 02:1914-1916;
//   · P42's idiom for a named refusal (src/units/P42/LEDGER.unit.test.ts:41-66): an object
//     beside `error`, keys sorted, today's prefix kept in the words, passed through by the
//     operator's publish only when well-formed, and carried by both lift reads as their
//     last member until a publication succeeds.
//
// THE TELLING, RULED (D1 leaves the representation to the specifier, in the refusal's
// existing shape; fail-closed stays):
//   · THE MEMBER `republished`, keys sorted (R-P3):
//       { changed: [ { member, new, old } ], endedBy: 'generation_transition', slot }
//     (`page` beside `slot`, keys sorted, for a page-scoped placement). `changed` lists,
//     sorted by `member`, each member of the configuration check's tuple whose value in
//     the published learn document (`new`) differs from the one the slot's statistics
//     accumulate under (`old`); the member names are `reward`, `objective`,
//     `measurementBasis` and `stats.n0`, `stats.tauLearnMs`, `stats.liftMin`,
//     `stats.liftMax`, `stats.nMin`. `endedBy: 'generation_transition'`: what ends it is
//     the operator's generation transition for the slot (or a republish restoring the old
//     values).
//   · THE REFUSAL. When the configuration check refuses for that cause, the object's
//     `/publish` (and every caller of its publication) answers 503
//     `{ ok: false, error, republished }`; `error` keeps today's prefix and names the
//     slot, each changed member with its old and new values, and what ends it, with the
//     route: for example "statistics recovery required: the learn document republished
//     for slot pdp-modules changed reward from click to add_to_bag; the slot's statistics
//     stay at version N until an operator starts the new generation with
//     POST /v1/coach/learn/generation (or the document is republished with the old
//     value)". The operator's `POST /v1/:tenant/learn/publish` passes the same `error` and
//     `republished` through, 503, only when the object's answer is exactly that and the
//     member well formed (src/ledger/ledger.test.ts:385-396 holds: no other downstream
//     text is echoed).
//   · THE READS. From a publication refused for that cause until the slot's next
//     successful publication (the generation transition publishes one), `GET
//     /v1/:tenant/lift` (the snapshot in force, never `?version=`) and `GET
//     /v1/:tenant/lift/rows` for the slot carry the same `republished` as their last
//     member, beside today's members and the unchanged snapshot.
//   · NOTHING ELSE CHANGES. A recovery refusal of every other cause keeps its text and
//     bytes; a republish that changes nothing in the tuple is not refused; a slot not
//     republished publishes and reads byte for byte as today; P42's `stale` is P42's.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P49.log):
//   · src/units/P42/LEDGER.unit.test.ts:252-263, P42.PW1's CONTROL leg, is THIS ticket's
//     case: on P08's fixture it republishes the learn document with the product slot's
//     reward changed from click to add_to_bag through the operator's PUT (an authorized
//     learn republish changing the tuple) and asserts today's bytes — the object's
//     refusal `{"ok":false,"error":"statistics recovery required"}` (:259), the route's
//     `{"ok":false,"error":"statistics acknowledgement unavailable"}` (:261) — and the
//     lift read's members without one more (:262). The ruling changes all three, so that
//     leg cannot stay green under P49 (its own title calls the cause "another cause"); the
//     lead rules it. P49.LR2's "another cause" leg (a damaged generation record) is the
//     pattern for a re-specified control; the rest of P42 and all of P08 stay green under
//     the sketch;
//     CORRECTED under R-P82 (test-only, R-P75 form): that control's other cause is now this file's LR2(a) damaged generation record.
//   · src/learn/learn.test.ts:833-839 (a damaged stored state: today's text) and
//     src/ledger/ledger.test.ts:385-396 (no downstream text echoed) hold under the ruling;
//   · kit 02:1911-1916 says a recovery refusal of any other cause "keeps its text" and
//     counts the reward change among them; LR3 requires that clause reworded, while
//     P42.PW4's kit statement (src/units/P42/LEDGER.unit.test.ts:390-391) stays satisfiable.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): `republished`
// on the object's refusal, on the operator's publish and on both lift reads, and the
// refusal's words. No new export is imported.
//
// FIXTURE. P08's (src/units/P08/LEDGER.unit.test.ts:95-120, copied in
// src/units/_parity6.ts): the complete-the-look module pooled on the product and home
// pages, the reviews module on both, a size guide and a category grid on one each;
// rendered-v1, reward click, nMin 2. The republish is P42's control and the live
// rehearsal's: the product slot's reward changed from click to add_to_bag through
// `PUT /content/learn` with the authored preconditions; the end is the operator's
// `POST /v1/:tenant/learn/generation { slot, reward: 'add_to_bag' }`. LR1's second leg
// (fix round 2, R-P83: "reward or basis") republishes the product slot's measurement basis
// changed from rendered-v1 to served-v1 instead, and asserts `republished: { changed:
// [{ member: 'measurementBasis', new: 'served-v1', old: 'rendered-v1' }], endedBy:
// 'generation_transition', slot: 'pdp-modules' }` at the object, the operator's publish and
// both lift reads, with the words naming the member and both values.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (publication through every
// object's door; the kit), src/units/_parity6.ts (P08's world, the publish doors and the
// lift reads). Imports from src/units/: ../_parity, ../_parity3, ../_parity6.

import { describe, expect, it } from 'vitest';

import { statsName } from '@/learn/fan';

import { asOperator, BRAND, expectPublished, HOSTS, mount, putDocument, TENANT, type Answer, type Host, type Mounted } from '../_parity';
import { kitSentences, missingStatements, publishStats } from '../_parity3';
import {
  dials, HOME_MODULES, identityOf, keyOrders, learnOf, LIFT_MEMBERS, liftOf, memberOf, OBJECT_PUBLISH_MEMBERS, objectPublish, OPERATOR_PUBLISH_MEMBERS,
  operatorPublish, P08_LEARN, P08_PIECES, P08_SLOTS, PDP_MODULES, ROWS_MEMBERS, rowsOf, visit,
} from '../_parity6';

async function world(host: Host): Promise<Mounted> {
  const m = await mount(host, { pieces: P08_PIECES, slots: P08_SLOTS, learn: P08_LEARN });
  expectPublished(m, 'P49 — P08\'s catalogue, pages and learn document publish');
  await visit(m, 'pdp'); await visit(m, 'home');
  await publishStats(m);
  return m;
}
/** The authorized learn republish: the product slot's reward changed from click to add_to_bag through the operator's PUT. */
async function republish(m: Mounted, product: Record<string, unknown> = dials('add_to_bag')): Promise<void> {
  const changed = await putDocument(m, 'learn', learnOf({ [PDP_MODULES]: product, [HOME_MODULES]: dials() }), 'p49-republish');
  expect(changed.status, `${m.host}: PRECONDITION — the learn document republishes (${JSON.stringify(changed.body).slice(0, 200)})`).toBe(200);
}
/** The ruled member for that republish (header). */
const REPUBLISHED = { changed: [{ member: 'reward', new: 'add_to_bag', old: 'click' }], endedBy: 'generation_transition', slot: PDP_MODULES };
/** What the refusal's words name, against the ruling. */
function sentenceOf(error: unknown) {
  const text = String(error ?? '');
  return { prefix: text.startsWith('statistics recovery required'), slot: text.includes(PDP_MODULES), member: /\breward\b/.test(text),
    old: /\bclick\b/.test(text), new: text.includes('add_to_bag'), end: text.includes('/learn/generation') };
}
const NAMED = { prefix: true, slot: true, member: true, old: true, new: true, end: true };
/** The ruled member for the basis republish (header). */
const BASIS_REPUBLISHED = { changed: [{ member: 'measurementBasis', new: 'served-v1', old: 'rendered-v1' }], endedBy: 'generation_transition', slot: PDP_MODULES };
/** What the basis refusal's words name, against the ruling. */
function basisSentenceOf(error: unknown) {
  const text = String(error ?? '');
  return { prefix: text.startsWith('statistics recovery required'), slot: text.includes(PDP_MODULES), member: text.includes('measurementBasis'),
    old: text.includes('rendered-v1'), new: text.includes('served-v1'), end: text.includes('/learn/generation') };
}
const unsorted = (...values: unknown[]) => values.flatMap(v => keyOrders(v)).filter(([written, sorted]) => written.join() !== sorted.join());
/** Today's answer of the object and of the operator's publish to a recovery refusal of any cause (P42 PW1's control, kit 02:1912-1914). */
const TODAY_OBJECT = JSON.stringify({ ok: false, error: 'statistics recovery required' });
const TODAY_ROUTE = JSON.stringify({ ok: false, error: 'statistics acknowledgement unavailable' });
const bytesOf = (answer: Answer) => [answer.status, JSON.stringify(answer.body)];

// ===========================================================================
// unit:P49.LR1 — the refusal after a republish names its cause and its end
// ===========================================================================

describe('unit:P49.LR1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): after the learn document is republished with the product slot's reward changed from click to add_to_bag, the object's publication and the operator's publish are refused naming the slot, the member, its old and new values and the generation transition that ends it, and both lift reads carry the same member beside the unchanged snapshot; after the operator's generation transition the publish succeeds and the reads carry today's members only`, async () => {
      const m = await world(host);
      const last = identityOf(await liftOf(m, PDP_MODULES));
      await republish(m);
      const refused = await objectPublish(m, PDP_MODULES);
      expect(refused.status, `${host}: PRECONDITION (fail-closed stays) — the product slot's publication is refused (${JSON.stringify(refused.body).slice(0, 200)})`).toBe(503);
      expect.soft(memberOf(refused, 'republished'), `${host}: P49.LR1 — the object's refusal names the republish: the slot, the member, its old and new values, what ends it`).toEqual(REPUBLISHED);
      expect.soft(sentenceOf(refused.body.error), `${host}: P49.LR1 — and says it in words (${String(refused.body.error)})`).toEqual(NAMED);
      const routed = await operatorPublish(m, PDP_MODULES);
      expect.soft([routed.status, memberOf(routed, 'republished')], `${host}: P49.LR1 — the operator's publish passes it through`).toEqual([503, REPUBLISHED]);
      expect.soft(sentenceOf(routed.body.error), `${host}: P49.LR1 — with the words (${String(routed.body.error)})`).toEqual(NAMED);
      const lift = await liftOf(m, PDP_MODULES), rows = await rowsOf(m, PDP_MODULES);
      expect.soft(memberOf(lift, 'republished'), `${host}: P49.LR1 — GET lift for the product slot carries it`).toEqual(REPUBLISHED);
      expect.soft(memberOf(rows, 'republished'), `${host}: P49.LR1 — GET lift/rows for the product slot carries it`).toEqual(REPUBLISHED);
      expect.soft(unsorted(refused.body.republished, routed.body.republished, lift.body.republished), `${host}: P49.LR1 — R-P3: written with sorted keys`).toEqual([]);
      expect.soft(identityOf(lift), `${host}: P49.LR1 — LOCKED (fail-closed stays): the snapshot in force is the last successful one`).toEqual(last);

      const transition = await asOperator(m, 'POST', `/v1/${TENANT}/learn/generation`, { slot: PDP_MODULES, reward: 'add_to_bag' });
      expect(transition.status, `${host}: PRECONDITION — the operator's generation transition answers (${JSON.stringify(transition.body).slice(0, 200)})`).toBe(200);
      const after = await operatorPublish(m, PDP_MODULES);
      expect.soft([after.status, after.body.ok], `${host}: P49.LR1 — after the transition the publish succeeds (${JSON.stringify(after.body).slice(0, 200)})`).toEqual([200, true]);
      expect.soft([Object.keys((await liftOf(m, PDP_MODULES)).body), Object.keys((await rowsOf(m, PDP_MODULES)).body)],
        `${host}: P49.LR1 — and the reads carry today's members only`).toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
    }, 120_000);

    it(`host (${host}): after the learn document is republished with the product slot's measurement basis changed from rendered-v1 to served-v1, the object's publication, the operator's publish and both lift reads name the republish: measurementBasis with its old and new values and the generation transition that ends it`, async () => {
      const m = await world(host);
      const last = identityOf(await liftOf(m, PDP_MODULES));
      await republish(m, dials('click', { measurementBasis: 'served-v1' }));
      const refused = await objectPublish(m, PDP_MODULES);
      expect(refused.status, `${host}: PRECONDITION (fail-closed stays) — the product slot's publication is refused (${JSON.stringify(refused.body).slice(0, 200)})`).toBe(503);
      expect.soft(memberOf(refused, 'republished'), `${host}: P49.LR1 — the object's refusal names the basis republish`).toEqual(BASIS_REPUBLISHED);
      expect.soft(basisSentenceOf(refused.body.error), `${host}: P49.LR1 — and says it in words (${String(refused.body.error)})`).toEqual(NAMED);
      const routed = await operatorPublish(m, PDP_MODULES);
      expect.soft([routed.status, memberOf(routed, 'republished')], `${host}: P49.LR1 — the operator's publish passes it through`).toEqual([503, BASIS_REPUBLISHED]);
      expect.soft(basisSentenceOf(routed.body.error), `${host}: P49.LR1 — with the words (${String(routed.body.error)})`).toEqual(NAMED);
      const lift = await liftOf(m, PDP_MODULES), rows = await rowsOf(m, PDP_MODULES);
      expect.soft(memberOf(lift, 'republished'), `${host}: P49.LR1 — GET lift for the product slot carries it`).toEqual(BASIS_REPUBLISHED);
      expect.soft(memberOf(rows, 'republished'), `${host}: P49.LR1 — GET lift/rows for the product slot carries it`).toEqual(BASIS_REPUBLISHED);
      expect.soft(identityOf(lift), `${host}: P49.LR1 — LOCKED (fail-closed stays): the snapshot in force is the last successful one`).toEqual(last);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P49.LR2 — LOCK: other causes, unchanged tuples and other slots as today
// ===========================================================================

describe('unit:P49.LR2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a recovery refusal of another cause (the product slot's generation record damaged) keeps today's bytes at the object and at the operator's publish, and the lift read today's members`, async () => {
      const m = await world(host);
      const placement = m.stats.get(statsName(TENANT, BRAND, PDP_MODULES));
      expect(placement, `${host}: PRECONDITION — the product placement's statistics object exists`).toBeTruthy();
      placement!.data.set('learnGeneration', { damaged: true });
      expect(bytesOf(await objectPublish(m, PDP_MODULES)), `${host}: P49.LR2 — another cause: the object's refusal is today's, byte for byte`).toEqual([503, TODAY_OBJECT]);
      expect(bytesOf(await operatorPublish(m, PDP_MODULES)), `${host}: P49.LR2 — another cause: the operator's publish refusal is today's, byte for byte`).toEqual([503, TODAY_ROUTE]);
      expect(Object.keys((await liftOf(m, PDP_MODULES)).body), `${host}: P49.LR2 — another cause: the lift read carries today's members only`).toEqual(LIFT_MEMBERS);
    }, 120_000);

    it(`host (${host}): LOCK — a republish that changes nothing in the tuple (the product slot's trust from 1 to 0.5) is not refused: the object's and the operator's publish answer as today and the reads carry today's members`, async () => {
      const m = await world(host);
      await republish(m, dials('click', { gamma: 0.5 }));
      const published = await objectPublish(m, PDP_MODULES);
      expect([published.status, Object.keys(published.body), published.body.published], `${host}: P49.LR2 — the object's publish answer is today's`).toEqual([200, OBJECT_PUBLISH_MEMBERS, true]);
      const routed = await operatorPublish(m, PDP_MODULES);
      expect([routed.status, Object.keys(routed.body)], `${host}: P49.LR2 — the operator's publish answer is today's`).toEqual([200, OPERATOR_PUBLISH_MEMBERS]);
      expect([Object.keys((await liftOf(m, PDP_MODULES)).body), Object.keys((await rowsOf(m, PDP_MODULES)).body)], `${host}: P49.LR2 — the reads carry today's members`)
        .toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
    }, 120_000);

    it(`host (${host}): LOCK — with the product slot republished and refused, the home slot, not republished, publishes and reads as today: its object's and the operator's publish answers and both reads member for member, its lift read byte for byte before and after`, async () => {
      const m = await world(host);
      const before = await liftOf(m, HOME_MODULES);
      await republish(m);
      expect((await objectPublish(m, PDP_MODULES)).status, `${host}: PRECONDITION — the product slot's publication is refused`).toBe(503);
      expect(JSON.stringify((await liftOf(m, HOME_MODULES)).body), `${host}: P49.LR2 — the home slot's lift read is byte for byte what it was`).toBe(JSON.stringify(before.body));
      const published = await objectPublish(m, HOME_MODULES);
      expect([published.status, Object.keys(published.body), published.body.published], `${host}: P49.LR2 — the home object's publish answer is today's`).toEqual([200, OBJECT_PUBLISH_MEMBERS, true]);
      const routed = await operatorPublish(m, HOME_MODULES);
      expect([routed.status, Object.keys(routed.body)], `${host}: P49.LR2 — the operator's publish for home is today's`).toEqual([200, OPERATOR_PUBLISH_MEMBERS]);
      expect([Object.keys((await liftOf(m, HOME_MODULES)).body), Object.keys((await rowsOf(m, HOME_MODULES)).body)], `${host}: P49.LR2 — the home reads carry today's members`)
        .toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P49.LR3 — the kit
// ===========================================================================

describe('unit:P49.LR3', () => {
  it('logic: the API reference and the payload schemas state the refusal\'s cause and what ends it, and no longer count a learn republish among the causes that keep their text', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'a publication refused after a learn republish names it: republished, with the slot and each changed member\'s old and new values',
        test: t => /\brepublished\b/.test(t) && /\bchanged\b/.test(t) && /\bold\b/.test(t) && /\bnew\b/.test(t) && /\bslot\b/.test(t) },
      { name: 'and says what ends it: the generation transition, POST /v1/{tenant}/learn/generation',
        test: t => /\brepublished\b/.test(t) && /learn\/generation/.test(t) && /(until|ends|after)/i.test(t) },
    ]);
    const stillBare = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'].flatMap(file => kitSentences(file)
      .filter(t => /keeps its text/i.test(t) && /changes the slot's reward/i.test(t)).map(t => `${file}: ${t.slice(0, 160)}`));
    expect.soft(missing, 'P49.LR3 — kit 02 and 03 state the cause and the end').toEqual([]);
    expect.soft(stillBare, 'P49.LR3 — the sentence counting a learn republish among the causes that keep their text is reworded (kit 02:1911-1916)').toEqual([]);
  });
});
