// src/units/P41/LEDGER.unit.test.ts
// P41 under the Closure Ledger: the tests for the LOCAL criteria of the P41 work
// order (the operator-warnings programme, amendment 2, ticket P41 "A
// conversion table that omits the slot's own reward says so"). DC1 (D1, RESOLVED
// by the owner's rule R-P78: the product tells the operator) is exercised inside
// CW1-CW3; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P41.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-2/BTI-Parity-Amendment-2026-10-16.md,
//     section 2, P41): "publishing or validating a learn document whose slot
//     carries a `conversions` table that does not name the slot's own reward still
//     succeeds, and the answer carries an advisory in the publication's existing
//     advisory shape that names the slot, the omitted reward and the consequence
//     (undeclared pieces on that slot earn nothing); a table that names the slot's
//     reward carries no such advisory; … credits, records, receipts, replay and
//     every P16 unit are unchanged; kit 02 and 03 state the advisory";
//   · P16's receipted ruling (src/units/P16/LEDGER.unit.test.ts:27-37: the record
//     carries `successEvent: { event, value }`, the piece's declared event else the
//     slot's reward, `value: null` when the table does not value it; an unvalued
//     success event credits nothing, P16.OB4) and the P16 delivery review section
//     10 (d), measured: a table omitting the slot's reward gives the undeclared
//     pieces records `{click, null}` and zero credit, and the publication answers
//     200 with no advisory (kinds.ts conversionTableErrors validates the shape only);
//   · the existing advisory shape: src/content/catalogDiagnostics.ts:17-28 and
//     :29-78 (the catalogue's `diagnostics` channel: `schema`, `advisory: true`,
//     `status`, `warningCount`, `omittedWarningCount`, `warnings[]` of `{ code, … }`
//     records) and src/content/slotDiagnostics.ts:9-19 (the slots document's
//     `pinDiagnostics`, the same envelope).
//
// THE LEARN PUBLICATION HAS NO ADVISORY CHANNEL TODAY. `PUT /content/learn`
// answers `{ ok, revision, publication, version, document }` and
// `POST /content/learn/validate` answers `{ valid, document }`
// (src/routes/content.ts:819-823 and :701-705 add `diagnostics` only for the
// catalogue and `pinDiagnostics` only for the slots document). So this file RULES
// the same shape on the learn answer:
//
// THE ADVISORY, RULED (one representation for CW1-CW3):
//   · Both doors' success answers (the PUT's `ok: true` 200 and the validate
//     door's `valid: true` 200) carry, beside their existing members, the member
//     `diagnostics` in the existing advisory envelope, keys sorted (R-P3):
//       { advisory: true, omittedWarningCount: 0, schema: 'learn-conversion-diagnostics/v1',
//         status: 'available', warningCount: <n>, warnings: [ … ] }
//     with one warning per slot whose `conversions` table does not name that slot's
//     own `reward`, keys sorted:
//       { code: 'conversions_omit_slot_reward', consequence: 'undeclared_pieces_earn_nothing',
//         reward: <the slot's reward>, slot: <the slot> }
//     (the order of the warnings is not ruled; the tests compare them sorted by slot).
//   · The member is present ONLY when at least one such warning exists. A document
//     without any table, and one whose every table names its slot's reward, is
//     answered byte for byte as today (R-P7).
//   · The publication itself is unchanged: the table is published as P16 accepts
//     it (OB1 accepts any table of rewards to positive values), and the credits,
//     records, receipts and replays are P16's.
//
// THE CONSOLE (CW3). The dials screen of the console (public/console/views.js:440-480)
// reads only `valid`/`errors` from the learn validate door and `revision`/`document`
// from the learn PUT; the console's advisory display (public/console/views-config.js:378-396)
// is the slots document's pin channel. No console surface shows publication
// advisories for the learn document, so, as the work order rules ("if such a
// surface exists … else nothing"), CW3 is the kit leg alone.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the
// learn answer's `diagnostics`, its schema, code and consequence words. No new
// export is imported.
//
// FIXTURES. P16's own (src/units/P16/LEDGER.unit.test.ts:58-94, copied, as a test
// file is never imported): the three Tabby stories of the home slot, the bag story
// declaring add_to_bag, the film story undeclared, the charm story declaring
// purchase; P16's TABLE { add_to_bag: 5, click: 1 }; the omitting table is the
// review's example (d), { add_to_bag: 5 } alone on a click slot. CW1 adds two home
// slots so the advisory must name each slot's OWN reward: an add-to-bag slot whose
// table values purchase and click but not add_to_bag (omits its reward), and a
// click slot whose table names click (no advisory). The harness's learn document
// also carries the layout slot with no table (no advisory).
//
// R10 (tests that lock present behaviour, listed for the lead): none found. No
// existing test asserts the exact member list of a learn PUT or validate answer
// (grep of src for `content/learn` PUT/validate answers; logs/r10-P41.log).
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts) and src/units/_parity3.ts (the kit, sentence by
// sentence). Imports from src/units/: ../_parity, ../_parity3.

import { describe, expect, it } from 'vitest';

import {
  asOperator, BRAND, expectPublished, HOSTS, learned, learnDocument, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf, putDocument, receiptsOf,
  replayOf, rounded, servePage, shopperOn, storedDecisions, TABBY_VIEWS, TENANT, toLedger, type Answer, type Mounted, type Shopper, type Snapshot,
} from '../_parity';
import { missingStatements } from '../_parity3';

// ---------------------------------------------------------------------------
// P16's fixture (src/units/P16/LEDGER.unit.test.ts:58-94), copied.
// ---------------------------------------------------------------------------

const STORY = 'home-stories';
/** CW1's two further home slots: one rewarded on add to bag, one on click. */
const OFFERS = 'home-offers', PICKS = 'home-picks';
const story = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, customerContentId: `TAP-${id.toUpperCase().replace(/\./g, '-')}`,
  type: 'editorial', title, tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' }, ...over });
const BAG_STORY = 'story.bag', FILM_STORY = 'story.film', CHARM_STORY = 'story.charm';
const DECLARED = [story(BAG_STORY, 'Carry the Tabby', { successEvent: 'add_to_bag' }), story(FILM_STORY, 'The Tabby in motion'), story(CHARM_STORY, 'Charm it', { successEvent: 'purchase' })];
const SLOTS = { version: 'parity-p16-slots', governanceVersion: 3, pages: { home: [{ slot: STORY, take: 3, weights: { line: 1 } }] } };
/** The same home page with CW1's two further slots. */
const SLOTS_CW1 = { version: 'parity-p41-slots', governanceVersion: 3, pages: { home: [{ slot: STORY, take: 3, weights: { line: 1 } },
  { slot: OFFERS, take: 2, weights: { line: 1 } }, { slot: PICKS, take: 2, weights: { line: 1 } }] } };
/** P16's table: it names the slot's reward (click). */
const TABLE = { add_to_bag: 5, click: 1 };
/** The P16 review's example (d): an add to bag worth 5, and the slot's own reward (click) not named. */
const OMIT = { add_to_bag: 5 };
const learnWith = (dials: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  learnDocument({ [STORY]: { measurementBasis: 'rendered-v1', reward: 'click', ...dials } }, extra);
const BAG_PRODUCT = 'COA-CW620';

/** CW1's document: the click story slot omits click, the add-to-bag slot omits add_to_bag, the picks slot names click; the layout slot has no table. */
const OMITTING = learnDocument({
  [STORY]: { measurementBasis: 'rendered-v1', reward: 'click', conversions: OMIT },
  [OFFERS]: { reward: 'add_to_bag', conversions: { purchase: 3, click: 1 } },
  [PICKS]: { reward: 'click', conversions: { click: 2, add_to_bag: 5 } },
});
/** The same slots, every table naming its slot's own reward. */
const NAMING = learnDocument({
  [STORY]: { measurementBasis: 'rendered-v1', reward: 'click', conversions: TABLE },
  [OFFERS]: { reward: 'add_to_bag', conversions: { add_to_bag: 2, purchase: 3 } },
  [PICKS]: { reward: 'click', conversions: { click: 2, add_to_bag: 5 } },
});
/** The same slots without any table. */
const PLAIN = learnDocument({ [STORY]: { measurementBasis: 'rendered-v1', reward: 'click' }, [OFFERS]: { reward: 'add_to_bag' }, [PICKS]: { reward: 'click' } });

/** The ruled advisory (header): one warning per slot whose table omits its own reward. */
const warning = (slot: string, reward: string) => ({ code: 'conversions_omit_slot_reward', consequence: 'undeclared_pieces_earn_nothing', reward, slot });
const EXPECTED_ADVISORY = { advisory: true, omittedWarningCount: 0, schema: 'learn-conversion-diagnostics/v1', status: 'available', warningCount: 2,
  warnings: [warning(OFFERS, 'add_to_bag'), warning(STORY, 'click')] };

type Advisory = Record<string, unknown> & { warnings?: Array<Record<string, unknown>> };
/** The answer's `diagnostics`, its warnings sorted by slot (their order is not ruled), or a sentence naming its absence. */
function advisoryOf(answer: Answer): Advisory | string {
  const d = answer.body.diagnostics as Advisory | undefined;
  if (d === undefined || d === null || typeof d !== 'object') return `no diagnostics member on the answer (members: ${Object.keys(answer.body).join(', ')})`;
  const warnings = Array.isArray(d.warnings) ? [...d.warnings].sort((a, b) => String(a.slot).localeCompare(String(b.slot))) : d.warnings;
  return { ...d, warnings };
}
/** R-P3: the keys of the ruled member and of each of its warnings, each as written and sorted. */
function keyOrders(answer: Answer): Array<[string[], string[]]> {
  const d = answer.body.diagnostics as Advisory | undefined;
  if (!d || typeof d !== 'object') return [];
  return [d, ...(Array.isArray(d.warnings) ? d.warnings : [])].map(o => [Object.keys(o), [...Object.keys(o)].sort()]);
}
const validateLearn = (m: Mounted, document: unknown) => asOperator(m, 'POST', `/content/learn/validate?scope=${TENANT}`, { document });

/** Today's success answers, member for member (src/routes/content.ts:819-823, :701-705): the PUT's and the validate door's. */
const PUT_MEMBERS = ['ok', 'revision', 'publication', 'version', 'document'];
const VALIDATE_MEMBERS = ['valid', 'document'];

async function shopperWithPage(m: Mounted, label: string, tabby = false): Promise<{ s: Shopper; page: Snapshot }> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: the shopper's page view is accepted`).toBe(200);
  if (tabby) for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: the shopper's view is accepted`).toBe(200);
  const page = await s.snapshot('home', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `${m.host}: the shopper's page is answered: ${JSON.stringify(page.body).slice(0, 300)}`).toBe(200);
  for (const d of page.decisions.filter(x => x.slot === STORY)) expect((await s.ack(page, d)).status, `${m.host}: ${d.contentId} acknowledged`).toBe(200);
  return { s, page };
}
const outcome = (s: Shopper, page: Snapshot, id: string, type: 'add_to_cart' | 'purchase' | 'content_click') => {
  const d = page.decisions.find(x => x.contentId === id);
  expect(d?.decisionId, `${s.subject}: PRECONDITION — ${id} is served with a receipt`).toBeTruthy();
  if (type === 'content_click') return s.click(page, d!);
  return s.action({ type, data: { contentId: id, decisionId: d!.decisionId, slot: STORY, productId: BAG_PRODUCT, price: 575, value: 575, currency: 'USD', brand: BRAND,
    ...(type === 'purchase' ? { orderId: `order-${crypto.randomUUID()}` } : {}) } });
};
const storyCredits = async (m: Mounted) => Object.fromEntries(Object.entries(rounded(await learned(m), 's')).filter(([item]) => item.startsWith('story.')));
async function rebuilt(m: Mounted): Promise<Record<string, number>> {
  const answer = await asOperator(m, 'POST', `/v1/${TENANT}/learn/generation`, { slot: STORY, brand: BRAND, rebuildFrom: new Date().toISOString().slice(0, 10) });
  expect(answer.status, `${m.host}: PRECONDITION — the offline recomputation rebuilds ${STORY} from the retained day: ${JSON.stringify(answer.body).slice(0, 300)}`).toBe(200);
  return storyCredits(m);
}
/** P16's records under the omitting table: the bag story's declared event valued 5; the film story's slot reward and the charm story's purchase unvalued. */
const OMIT_MEMBERS = [[BAG_STORY, { event: 'add_to_bag', value: 5 }], [CHARM_STORY, { event: 'purchase', value: null }], [FILM_STORY, { event: 'click', value: null }]];
const byItem = (rows: unknown[][]) => [...rows].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

// ===========================================================================
// unit:P41.CW1 — the PUT and the validate door succeed and carry the advisory
// ===========================================================================

describe('unit:P41.CW1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a learn document whose click slot's table omits click and whose add-to-bag slot's table omits add_to_bag is published and validated with success, and both answers carry the advisory naming each slot, its omitted reward and that undeclared pieces there earn nothing; tables naming their slot's reward, and no table at all, carry none`, async () => {
      const m = await mount(host, { pieces: DECLARED, slots: SLOTS_CW1, learn: PLAIN });
      expectPublished(m, 'P41.CW1 — the stories, the three home slots and the learn document without tables publish');

      const put = await putDocument(m, 'learn', OMITTING, 'p41-cw1');
      expect(put.status, `${host}: P41.CW1 — the PUT of the omitting tables succeeds (${JSON.stringify(put.body).slice(0, 300)})`).toBe(200);
      expect.soft(advisoryOf(put), `${host}: P41.CW1 — the PUT answer carries the advisory in the existing advisory envelope, one warning per slot whose table omits its own reward`).toEqual(EXPECTED_ADVISORY);

      const validated = await validateLearn(m, OMITTING);
      expect.soft(validated.status, `${host}: P41.CW1 — the validate door accepts the omitting tables`).toBe(200);
      expect.soft(advisoryOf(validated), `${host}: P41.CW1 — the validate door's answer carries the same advisory`).toEqual(EXPECTED_ADVISORY);
      expect.soft(keyOrders(put).concat(keyOrders(validated)).filter(([written, sorted]) => written.join() !== sorted.join()),
        `${host}: P41.CW1 — R-P3: the advisory and each warning are written with sorted keys`).toEqual([]);

      const named = await putDocument(m, 'learn', NAMING, 'p41-cw1-named');
      expect.soft([named.status, Object.keys(named.body)], `${host}: P41.CW1 — every table naming its slot's reward: the PUT answers as today, with no advisory`).toEqual([200, PUT_MEMBERS]);
      const namedValidated = await validateLearn(m, NAMING);
      expect.soft([namedValidated.status, Object.keys(namedValidated.body)], `${host}: P41.CW1 — and so does the validate door`).toEqual([200, VALIDATE_MEMBERS]);

      const plain = await putDocument(m, 'learn', PLAIN, 'p41-cw1-plain');
      expect.soft([plain.status, Object.keys(plain.body)], `${host}: P41.CW1 — a document without a table: the PUT answers as today, with no advisory`).toEqual([200, PUT_MEMBERS]);
      const plainValidated = await validateLearn(m, PLAIN);
      expect.soft([plainValidated.status, Object.keys(plainValidated.body)], `${host}: P41.CW1 — and so does the validate door`).toEqual([200, VALIDATE_MEMBERS]);
    }, 60_000);
  }
});

// ===========================================================================
// unit:P41.CW2 — LOCK: the publication, credits, records, receipts and replays are P16's
// ===========================================================================

describe('unit:P41.CW2 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a document without a table, and one whose tables name their slot's reward, are answered byte for byte as today by the PUT and the validate door`, async () => {
      const m = await mount(host, { pieces: DECLARED, slots: SLOTS_CW1, learn: PLAIN });
      expectPublished(m, 'P41.CW2 — the stories, the three home slots and the learn document without tables publish');
      for (const [name, document] of [['without a table', PLAIN], ['with tables naming their reward', NAMING]] as const) {
        const put = await putDocument(m, 'learn', document, `p41-cw2-${name}`);
        const read = await asOperator(m, 'GET', `/content/learn?scope=${TENANT}`);
        expect(read.status, `${host}: PRECONDITION — the operator reads the learn document back`).toBe(200);
        const stored = read.body.document as { version?: string };
        // Today's PUT answer (src/routes/content.ts:819-823), rebuilt from the document in force.
        const today = { ok: true, revision: read.body.revision, publication: read.body.publication, version: stored.version ?? '', document: stored };
        expect(JSON.stringify(put.body), `${host}: P41.CW2 — the PUT answer for a document ${name} is byte for byte today's`).toBe(JSON.stringify(today));
        // Today's validate answer (src/routes/content.ts:701-705): valid, and the document it would publish, which is the
        // stored document before the publication stamped its version label (LEARN_KIND.stamp).
        const validated = await validateLearn(m, document);
        expect([validated.status, Object.keys(validated.body), validated.body.valid],
          `${host}: P41.CW2 — the validate door's answer for a document ${name} is today's, member for member`).toEqual([200, VALIDATE_MEMBERS, true]);
        expect(validated.body.document, `${host}: P41.CW2 — and its document is the one the PUT stored, before the version stamp`)
          .toEqual({ ...stored, version: (document as { version?: string }).version });
      }
    }, 60_000);

    it(`host (${host}): LOCK — with the omitting table published through the PUT door, the add to bag on the story declaring it is credited 5, the click on the undeclared story and the purchase on the story declaring it credit nothing, online and in the offline recomputation, and every record and receipt names P16's success event`, async () => {
      const m = await mount(host, { pieces: DECLARED, slots: SLOTS, learn: learnWith() });
      expectPublished(m, 'P41.CW2 — P16\'s stories and slot publish without a table');
      const put = await putDocument(m, 'learn', learnWith({ conversions: OMIT }), 'p41-cw2-omit');
      expect(put.status, `${host}: P41.CW2 — LOCKED (P16.OB1): the omitting table is published, not refused (${JSON.stringify(put.body).slice(0, 300)})`).toBe(200);
      const { s, page } = await shopperWithPage(m, 'p41-cw2', true);
      expect((await outcome(s, page, BAG_STORY, 'add_to_cart')).status, `${host}: the add to bag is accepted`).toBe(200);
      expect((await outcome(s, page, FILM_STORY, 'content_click')).status, `${host}: the click is accepted`).toBe(200);
      expect((await outcome(s, page, CHARM_STORY, 'purchase')).status, `${host}: the purchase is accepted`).toBe(200);
      await m.drainLedger();
      const online = await storyCredits(m);
      expect(online, `${host}: P41.CW2 — LOCKED (P16, review (d)): only the declared add to bag is credited, at 5; the undeclared story's click and the unvalued purchase earn nothing`).toEqual({ [BAG_STORY]: 5 });
      expect(await rebuilt(m), `${host}: P41.CW2 — LOCKED (P16.OB2): the offline recomputation credits exactly the same`).toEqual(online);
      const records = storedDecisions(m, s.subject).filter(r => r.slot === STORY).map(r => [r.item_id, (r.explain as Record<string, unknown>).successEvent ?? 'no explain.successEvent']);
      expect(byItem(records), `${host}: P41.CW2 — LOCKED (P16.OB3, OB4): every record names its success event and the table's value for it, null where the table values none`).toEqual(OMIT_MEMBERS);
      const receipts = (await receiptsOf(m, s.subject)).filter(r => r.slot === STORY).map(r => [r.item, r.successEvent ?? 'no successEvent on the receipt']);
      expect(byItem(receipts), `${host}: P41.CW2 — LOCKED (P16.OB3): and so does every receipt`).toEqual(OMIT_MEMBERS);
    }, 90_000);

    it(`host (${host}): LOCK — with the omitting table published through the PUT door, every decision of the slot replays equal`, async () => {
      // Served-v1 and without the durable recovery path: the replay reads what the real producer and consumer wrote (R-P14), as P16.OB4's lock does.
      const m = await mount(host, { pieces: DECLARED, slots: SLOTS, learn: learnDocument({ [STORY]: { reward: 'click' } }) }, { recovery: false });
      expectPublished(m, 'P41.CW2 — P16\'s stories and slot publish without a table');
      const put = await putDocument(m, 'learn', learnDocument({ [STORY]: { reward: 'click', conversions: OMIT } }), 'p41-cw2-replay');
      expect(put.status, `${host}: P41.CW2 — LOCKED (P16.OB1): the omitting table is published (${JSON.stringify(put.body).slice(0, 300)})`).toBe(200);
      const s = await shopperOn(m);
      expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${host}: the shopper's page view is accepted`).toBe(200);
      const set = await servePage(m, s, 'home', { offer: false });
      await toLedger(m, set.records);
      const stored = storedDecisions(m, s.subject).filter(r => r.slot === STORY);
      expect(stored.length, `${host}: PRECONDITION — the ledger holds the three decisions`).toBe(3);
      expect(byItem(stored.map(r => [r.item_id, (r.explain as Record<string, unknown>).successEvent ?? 'no explain.successEvent'])),
        `${host}: P41.CW2 — LOCKED (P16): the records name P16's success events`).toEqual(OMIT_MEMBERS);
      const replays: unknown[][] = [];
      for (const r of stored) {
        const replay = await replayOf(m, r.decision_id);
        replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
      }
      expect(replays, `${host}: P41.CW2 — LOCKED: each replays equal`).toEqual(replays.map(([id]) => [id, 200, 'equal']));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P41.CW3 — the kit (the console has no surface for it; header)
// ===========================================================================

describe('unit:P41.CW3', () => {
  it('logic: the API reference and the payload schemas state the advisory, its shape and when it is given', () => {
    const named = (t: string) => /conversions_omit_slot_reward/.test(t);
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'a table that omits the slot\'s own reward is still published, and the answer carries the conversions_omit_slot_reward advisory',
        test: t => named(t) && /conversions/.test(t) && /(publish|accepted|succeed)/i.test(t) },
      { name: 'its shape: the learn answer\'s diagnostics channel (learn-conversion-diagnostics/v1) with the slot, the reward and the consequence',
        test: t => /learn-conversion-diagnostics\/v1/.test(t) && /diagnostics/.test(t) },
      { name: 'the warning names the slot, the omitted reward and the consequence undeclared_pieces_earn_nothing',
        test: t => (named(t) || /learn-conversion-diagnostics/.test(t)) && /\bslot\b/.test(t) && /\breward\b/.test(t) && /undeclared_pieces_earn_nothing/.test(t) },
      { name: 'when it is given: on PUT /content/learn and on the validate door, only when a table omits its slot\'s reward',
        test: t => (named(t) || /learn-conversion-diagnostics/.test(t)) && /validate/.test(t) && /(PUT|publication)/.test(t) },
    ]);
    expect(missing, 'P41.CW3 — the kit states the advisory, its shape and when it is given').toEqual([]);
  });
});
