// src/units/P01/FIX1.unit.test.ts
// P01 fix round 1 (Closure Ledger, the parity programme): the cross-document
// refusal of per-context orders (R-P24) on every slots document a request
// publishes, and two locks for behaviour the P01 units left unpinned.
//
// WITNESSES (every expected value below comes from one of them, never from what
// the engine answers today):
//   · the lead's ruling "Lead ruling, P01 fix round 1 (2026-10-09)" in
//     _evidence/parity-step3/AMENDMENTS.md: "orderRefusals runs for every slots
//     document a request publishes, primary or related, matching the related kind
//     as kindOf does, against the catalogue published in the same request in any
//     case of the word or else the one in force; the refusals hold on PUT and on
//     POST validate for every entry path W34 already covers";
//   · the P01 work order, criterion O5: "Publication refuses with a named error an
//     order that names an unregistered or repeated module …";
//   · docs/kit/02-api-reference.md, the version-4 `orders` paragraph: publication
//     "refuses with `422`, naming the order and the offending value in `errors[]`
//     and writing no revision, an order that names a module no piece of the
//     published catalogue registers for the slot"; "A write marked 1, 2 or 3 that
//     carries `orders` is refused naming `pages.{page}[i].orders`"; "The catalogue
//     an order is checked against is the one published in the same request
//     (`publicationChanges`) or else the one in force"; "A decision on which a
//     configured order was served writes `inputs.replay.orders:
//     "configured-order-v1"` beside the other markers, and every other decision
//     writes exactly the markers it wrote before";
//   · the P01 delivery review at 0cc7d0a7 (probe R1; mutants ME2 and MG).
//
// THE READINGS THIS FILE RULES (one representation, shared with LEDGER's O5):
//   · a refusal is `422` with an error that names the offending module AND its
//     path in the slots document, `pages.<page>[<slot>].orders[<k>].modules[<p>]`
//     (the validator's path idiom; a prefix naming the related member is free);
//   · "no revision written" is read back through `GET /content/:kind`: the
//     revision of every member of the refused request is unchanged;
//   · a related member's kind is matched case-insensitively (`Slots`, `SLOTS`,
//     `Catalog`, `CATALOG`), in either position of `publicationChanges`, whatever
//     the primary document is (learn, priors, catalog or slots);
//   · `POST /content/:kind/validate` takes no related members (it reads
//     `document`, or the body, and nothing else), so the related-member units have
//     no validate leg; the primary validate path (`POST /content/slots/validate`,
//     kit 02: "`PUT /content/slots` and `POST /content/slots/validate` alike") is
//     pinned by a lock leg of F1.03 — LEDGER's O5 drives PUT only.
//   · "an absent catalogue registers nothing": the harness provisions every member
//     of the publication set, so the state is the catalogue in force registering
//     no module (`pieces: []`, the compiled default's empty catalogue).
//
// No new export is imported. HARNESS: src/units/_parity.ts (the only file of
// src/units/ this file imports).

import { describe, expect, it } from 'vitest';

import { invalidatePublicationCache } from '@/config/publication';
import { SLOTS_KIND } from '@/content/kinds';
import { EMPTY_PRIORS } from '@/learn/priors';

import {
  asOperator, declaredSlots, DIRECT_ENTRY, errorsOf, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount,
  PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf, putSlots, recentSlot, servedIn, shopperOn, storedDecisions, TENANT,
  type Answer, type Host, type Mounted, type Shopper,
} from '../_parity';

type Kind = 'catalog' | 'slots' | 'learn' | 'priors';
interface InForce { revision: number; publication: { revision: number; digest: string }; document: Record<string, unknown> }
interface Related { kind: string; document: unknown }

const BASE = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
const withOrders = (orders: unknown[]) => declaredSlots([layoutSlot({ orders }), recentSlot()]);

const EMAIL_RETURNING = { channel: 'email', visitBuckets: ['2-3'] };
const ORGANIC_ANY = { channel: 'organic', visitBuckets: 'any' };
const PAID_SOCIAL_FIRST = { channel: 'paid_social', visitBuckets: ['1'] };

/** A module no piece of any catalogue in this file registers. */
const UNREGISTERED = 'module.PDP.unregistered.23';
/** Its path in the slots document below: the layout slot is pages.pdp[0], the order is orders[0], the module is modules[1]. */
const UNREGISTERED_AT = 'pages.pdp[0].orders[0].modules[1]';
const NAMING_UNREGISTERED = withOrders([{ context: EMAIL_RETURNING, modules: [M.grid, UNREGISTERED] }]);
/** A valid order over registered modules: the positive control of every refusal. */
const VALID_ORDERS = [{ context: ORGANIC_ANY, modules: [M.reco2, M.grid, M.editorial] }];

/** A module this file registers itself (the P01 LEDGER file pins none of its kind), on the declared layout slot. */
const QUIZ_ID = 'module.PDP.quiz.1';
const QUIZ = { id: QUIZ_ID, customerContentId: 'PDP-QUIZ-1', type: 'style-quiz', title: 'Find your fit', tags: { occasion: ['everyday'] },
  slotTypes: [LAYOUT], journeyStageFit: ['exploring'], lifecycle: { status: 'live' } };
const QUIZ_ORDERS = [{ context: EMAIL_RETURNING, modules: [QUIZ_ID, M.grid] }];
/** QUIZ is modules[0] of orders[0] on the layout slot. */
const QUIZ_AT = 'pages.pdp[0].orders[0].modules[0]';

/** The document of any kind in force, with the publication identity a save's If-Match names (kit 02). */
async function inForce(m: Mounted, kind: Kind): Promise<InForce> {
  const read = await asOperator(m, 'GET', `/content/${kind}?scope=${TENANT}`);
  expect(read.status, `${m.host}: the operator reads the ${kind} document: ${JSON.stringify(read.body).slice(0, 300)}`).toBe(200);
  return { revision: read.body.revision as number, publication: read.body.publication as InForce['publication'], document: read.body.document as Record<string, unknown> };
}
const revisionsOf = async (m: Mounted) => ({ catalog: (await inForce(m, 'catalog')).revision, slots: (await inForce(m, 'slots')).revision,
  learn: (await inForce(m, 'learn')).revision, priors: (await inForce(m, 'priors')).revision });

/** `PUT /content/:kind` with the authored preconditions, publishing `related` beside the primary document in one request. */
async function publishWith(m: Mounted, kind: Kind, document: unknown, related: Related[], note: string): Promise<Answer> {
  const base = await inForce(m, kind);
  const answer = await asOperator(m, 'PUT', `/content/${kind}?scope=${TENANT}`, { document, note, publicationChanges: related }, {
    'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`,
    'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}`,
  });
  invalidatePublicationCache();
  return answer;
}

/** The refusal the ruling demands: 422, an error naming the module at its path. */
const namesAt = (answer: Answer, id: string, path: string) => errorsOf(answer).some(e => e.includes(id) && e.includes(path));
const layoutOrdersOf = (document: Record<string, unknown>) =>
  (document as { pages: Record<string, Array<Record<string, unknown>>> }).pages.pdp?.find(slot => slot.slot === LAYOUT)?.orders ?? null;
const registers = (document: Record<string, unknown>, id: string) => ((document.pieces ?? []) as Array<{ id: string }>).some(piece => piece.id === id);

// ===========================================================================
// unit:P01.O5.F1.01 — a slots document riding a learn or priors publication
// ===========================================================================

describe('unit:P01.O5.F1.01 — P01 fix round 1, R-P24: a slots document published as a related member of a learn or priors publication is checked against the catalogue', () => {
  /**
   * For each primary (learn, priors) on its own tenant: the control (a valid related order publishes), then one
   * publication per related kind whose slots member names UNREGISTERED. Each must be refused 422 by name at its
   * path with no revision of any member written.
   */
  async function relatedRefusals(host: Host, kinds: readonly string[]) {
    const primaries: Array<[Kind, (label: string) => unknown]> = [
      ['learn', label => learnDocument({}, { version: `p01-fix1-learn-${label}` })],
      ['priors', label => ({ ...EMPTY_PRIORS, version: `p01-fix1-priors-${label}` })],
    ];
    const outcomes: unknown[] = [], expected: unknown[] = [];
    for (const [primary, documentOf] of primaries) {
      const m = await mount(host, BASE);
      expectPublished(m, `P01.O5.F1.01 (${primary}) — the declared layout slot (P02) publishes`);
      // CONTROL: the same publication with a valid related slots document is admitted and writes its revision.
      const start = await revisionsOf(m);
      const control = await publishWith(m, primary, documentOf('control'), [{ kind: 'slots', document: withOrders(VALID_ORDERS) }], 'f1.01 control');
      expect(control.status, `${host}: CONTROL (${primary}) — a related slots document with a valid order publishes: ${JSON.stringify(errorsOf(control))}`).toBe(200);
      expect(layoutOrdersOf((await inForce(m, 'slots')).document), `${host}: CONTROL (${primary}) — and its order is in force`).toEqual(VALID_ORDERS);
      expect((await revisionsOf(m)).slots, `${host}: CONTROL (${primary}) — and wrote the slots revision`).toBe(start.slots + 1);

      for (const kind of kinds) {
        const before = await revisionsOf(m);
        const answer = await publishWith(m, primary, documentOf(`refused-${kind}`), [{ kind, document: NAMING_UNREGISTERED }], `f1.01 unregistered, kind ${kind}`);
        const after = await revisionsOf(m);
        outcomes.push({ primary, kind, status: answer.status, namesModuleAndPath: namesAt(answer, UNREGISTERED, UNREGISTERED_AT),
          revisions: after, ordersInForce: layoutOrdersOf((await inForce(m, 'slots')).document), errors: errorsOf(answer) });
        expected.push({ primary, kind, status: 422, namesModuleAndPath: true, revisions: before, ordersInForce: VALID_ORDERS, errors: expect.anything() });
      }
    }
    return { outcomes, expected };
  }

  for (const host of HOSTS) {
    it(`host (${host}): PUT /content/learn and PUT /content/priors whose publicationChanges carry a slots document with an order naming an unregistered module on the declared layout slot are refused 422 with an error naming the module and its path, and write no revision`, async () => {
      const { outcomes, expected } = await relatedRefusals(host, ['slots']);
      expect(outcomes, `${host}: P01.O5.F1.01 — a related slots member naming ${UNREGISTERED} is refused 422 by name at ${UNREGISTERED_AT}, and no member is written`).toEqual(expected);
    });

    it(`host (${host}): the same learn and priors publications with the slots member under the kind 'Slots' or 'SLOTS' (matched as the route matches every kind, whatever the primary) are refused 422 with an error naming the module and its path, and write no revision of any member`, async () => {
      const { outcomes, expected } = await relatedRefusals(host, ['Slots', 'SLOTS']);
      expect(outcomes, `${host}: P01.O5.F1.01 — a related member of kind 'Slots' or 'SLOTS' under a learn or priors primary, naming ${UNREGISTERED}, is refused 422 by name at ${UNREGISTERED_AT}, and no member is written`).toEqual(expected);
    });
  }
});

// ===========================================================================
// unit:P01.O5.F1.02 — the related kind matched as kindOf matches it
// ===========================================================================

describe('unit:P01.O5.F1.02 — P01 fix round 1, R-P24: a related slots member under a case variant of its kind is checked against the catalogue the request publishes', () => {
  for (const host of HOSTS) {
    it(`host (${host}): PUT /content/catalog whose publicationChanges carry the slots document under the kind 'Slots' or 'SLOTS' is refused 422 naming the module and its path, for a module no catalogue registers and for one the request's own catalogue drops though the catalogue in force registers it, and writes no revision`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O5.F1.02 — the declared layout slot (P02) publishes');
      const withoutUgc = MODULES.filter(piece => piece.id !== M.ugc);
      const cases: Array<[string, unknown[], string, Related, string, string]> = [
        // [case, the catalogue this request publishes, its version, the related member, the module, its path]
        ["kind 'slots' (the lowercase path, a control)", MODULES, 'p01-fix1-cat-a', { kind: 'slots', document: NAMING_UNREGISTERED }, UNREGISTERED, UNREGISTERED_AT],
        ["kind 'Slots', an unregistered module", MODULES, 'p01-fix1-cat-b', { kind: 'Slots', document: NAMING_UNREGISTERED }, UNREGISTERED, UNREGISTERED_AT],
        ["kind 'SLOTS', an unregistered module", MODULES, 'p01-fix1-cat-c', { kind: 'SLOTS', document: NAMING_UNREGISTERED }, UNREGISTERED, UNREGISTERED_AT],
        ["kind 'Slots', a module this request's catalogue drops", withoutUgc, 'p01-fix1-cat-d',
          { kind: 'Slots', document: withOrders([{ context: EMAIL_RETURNING, modules: [M.reco1, M.ugc] }]) }, M.ugc, 'pages.pdp[0].orders[0].modules[1]'],
      ];
      expect(registers((await inForce(m, 'catalog')).document, M.ugc), `${host}: PRECONDITION — the catalogue in force registers ${M.ugc}`).toBe(true);
      const before = await revisionsOf(m), slotsBefore = (await inForce(m, 'slots')).document;
      const outcomes: unknown[] = [];
      for (const [name, pieces, version, related, id, path] of cases) {
        const answer = await publishWith(m, 'catalog', { version, pieces }, [related], `f1.02 ${name}`);
        const after = await revisionsOf(m);
        outcomes.push({ case: name, status: answer.status, namesModuleAndPath: namesAt(answer, id, path), revisions: { catalog: after.catalog, slots: after.slots }, errors: errorsOf(answer) });
      }
      expect(outcomes, `${host}: P01.O5.F1.02 — each is refused 422 naming the module at its path, and no catalogue or slots revision is written`)
        .toEqual(cases.map(([name]) => ({ case: name, status: 422, namesModuleAndPath: true, revisions: { catalog: before.catalog, slots: before.slots }, errors: expect.anything() })));
      expect((await inForce(m, 'slots')).document, `${host}: P01.O5.F1.02 — and the slots document in force is the one before the refused publications`).toEqual(slotsBefore);
    });
  }
});

// ===========================================================================
// unit:P01.O5.F1.03 — the catalogue of the same request, in any case, or else the one in force
// ===========================================================================

describe('unit:P01.O5.F1.03 — P01 fix round 1, R-P24: the catalogue an order is checked against is the one the same request publishes, in any case of the word, or else the one in force; an absent catalogue registers nothing', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a learn publication whose related slots document names a module the catalogue in force does not register is refused 422 naming it, while the same publication carrying a catalogue that registers it, under the kind 'Catalog' or 'CATALOG' and in either position, is admitted with both revisions written; a slots publication carrying that catalogue under the kind 'Catalog' is admitted too`, async () => {
      const catalogueWithQuiz = (version: string) => ({ version, pieces: [...MODULES, QUIZ] });
      const learnOf = (label: string) => learnDocument({}, { version: `p01-fix1-learn-${label}` });

      // The refusal: QUIZ is in no catalogue in force and none is in the request.
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O5.F1.03 — the declared layout slot (P02) publishes');
      expect(registers((await inForce(m, 'catalog')).document, QUIZ_ID), `${host}: PRECONDITION — the catalogue in force does not register ${QUIZ_ID}`).toBe(false);
      const before = await revisionsOf(m);
      const refused = await publishWith(m, 'learn', learnOf('refused'), [{ kind: 'slots', document: withOrders(QUIZ_ORDERS) }], 'f1.03 without the catalogue');
      const after = await revisionsOf(m);
      expect({ status: refused.status, namesModuleAndPath: namesAt(refused, QUIZ_ID, QUIZ_AT), revisions: { slots: after.slots, learn: after.learn }, errors: errorsOf(refused) },
        `${host}: P01.O5.F1.03 — without a catalogue in the request, the order naming ${QUIZ_ID} is checked against the catalogue in force and refused 422 by name, writing nothing`)
        .toEqual({ status: 422, namesModuleAndPath: true, revisions: { slots: before.slots, learn: before.learn }, errors: expect.anything() });

      // The admissions, each on its own tenant so QUIZ is never in force before the request.
      const variants: Array<[string, Kind, (version: string) => unknown, Related[]]> = [
        ["learn, [{kind 'Catalog'}, {kind 'slots'}]", 'learn', learnOf,
          [{ kind: 'Catalog', document: catalogueWithQuiz('p01-fix1-cat-q1') }, { kind: 'slots', document: withOrders(QUIZ_ORDERS) }]],
        ["learn, [{kind 'slots'}, {kind 'CATALOG'}]", 'learn', learnOf,
          [{ kind: 'slots', document: withOrders(QUIZ_ORDERS) }, { kind: 'CATALOG', document: catalogueWithQuiz('p01-fix1-cat-q2') }]],
        ["slots, [{kind 'Catalog'}]", 'slots', () => withOrders(QUIZ_ORDERS),
          [{ kind: 'Catalog', document: catalogueWithQuiz('p01-fix1-cat-q3') }]],
      ];
      const outcomes: unknown[] = [], expected: unknown[] = [];
      for (const [name, primary, documentOf, related] of variants) {
        const v = await mount(host, BASE);
        expectPublished(v, `P01.O5.F1.03 (${name}) — the declared layout slot (P02) publishes`);
        const start = await revisionsOf(v);
        const answer = await publishWith(v, primary, documentOf(`admitted-${primary}`), related, `f1.03 ${name}`);
        const end = await revisionsOf(v);
        outcomes.push({ variant: name, status: answer.status, revisions: { catalog: end.catalog, slots: end.slots },
          registered: registers((await inForce(v, 'catalog')).document, QUIZ_ID), ordersInForce: layoutOrdersOf((await inForce(v, 'slots')).document), errors: errorsOf(answer) });
        expected.push({ variant: name, status: 200, revisions: { catalog: start.catalog + 1, slots: start.slots + 1 }, registered: true, ordersInForce: QUIZ_ORDERS, errors: [] });
      }
      expect(outcomes, `${host}: P01.O5.F1.03 — a catalogue published in the same request, under any case of its kind and in either position, is the one the order is checked against`).toEqual(expected);
    });

    it(`host (${host}): an absent catalogue registers nothing — with no module registered in force and no catalogue in the request, a learn publication whose related slots document orders modules no catalogue registers is refused 422 naming each, and so is the same order published directly`, async () => {
      const m = await mount(host, { ...BASE, pieces: [] });
      expectPublished(m, 'P01.O5.F1.03 (absent catalogue) — the declared layout slot (P02) publishes over a catalogue that registers no module');
      expect(((await inForce(m, 'catalog')).document.pieces as unknown[]).length, `${host}: PRECONDITION — the catalogue in force registers no module`).toBe(0);
      const orders = [{ context: EMAIL_RETURNING, modules: [M.grid, M.reco1] }];
      const before = await revisionsOf(m);
      const viaLearn = await publishWith(m, 'learn', learnDocument({}, { version: 'p01-fix1-learn-absent' }), [{ kind: 'slots', document: withOrders(orders) }], 'f1.03 absent, related');
      const direct = await putSlots(m, withOrders(orders), 'f1.03 absent, direct');
      const after = await revisionsOf(m);
      const each = (answer: Answer) => ({ status: answer.status,
        named: [namesAt(answer, M.grid, 'pages.pdp[0].orders[0].modules[0]'), namesAt(answer, M.reco1, 'pages.pdp[0].orders[0].modules[1]')] });
      expect({ related: each(viaLearn), direct: each(direct), revisions: { slots: after.slots, learn: after.learn } },
        `${host}: P01.O5.F1.03 — no catalogue registers ${M.grid} or ${M.reco1}, so the order is refused 422 naming each on every path, writing nothing: ${JSON.stringify([errorsOf(viaLearn), errorsOf(direct)])}`)
        .toEqual({ related: { status: 422, named: [true, true] }, direct: { status: 422, named: [true, true] }, revisions: { slots: before.slots, learn: before.learn } });
    });

    it(`host (${host}), lock: POST /content/slots/validate of a document whose order names an unregistered module answers 422 naming the module at its path, checked against the catalogue in force, while a valid order validates`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O5.F1.03 (validate) — the declared layout slot (P02) publishes');
      const before = await revisionsOf(m);
      const refused = await asOperator(m, 'POST', `/content/slots/validate?scope=${TENANT}`, { document: NAMING_UNREGISTERED });
      const valid = await asOperator(m, 'POST', `/content/slots/validate?scope=${TENANT}`, { document: withOrders(VALID_ORDERS) });
      expect({ refused: { status: refused.status, valid: refused.body.valid, namesModuleAndPath: namesAt(refused, UNREGISTERED, UNREGISTERED_AT) },
        control: { status: valid.status, valid: valid.body.valid }, revisions: await revisionsOf(m) },
        `${host}: P01.O5.F1.03 — the dry run refuses the order naming ${UNREGISTERED} 422 by name at ${UNREGISTERED_AT} (kit 02: "PUT /content/slots and POST /content/slots/validate alike"), validates the valid one, and writes nothing: ${JSON.stringify([errorsOf(refused), errorsOf(valid)])}`)
        .toEqual({ refused: { status: 422, valid: false, namesModuleAndPath: true }, control: { status: 200, valid: true }, revisions: before });
    });
  }
});

// ===========================================================================
// unit:P01.O7.F1.04 — the orders marker only on a decision that served its order (a lock)
// ===========================================================================

describe('unit:P01.O7.F1.04 — P01 fix round 1 (lock; witnesses C11 and kit 02:790): the orders replay marker is written only on a decision on which the layout slot served its configured order', () => {
  /** One page for the shopper, every layout position acknowledged, and the records the real consumer stored for it. */
  async function decided(m: Mounted, s: Shopper, label: string) {
    const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
    for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `${m.host}: ${d.contentId} acknowledged`).toBe(200);
    await m.drainLedger();
    const records = storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT);
    expect(records.length, `${m.host}: PRECONDITION — the ledger holds the shopper's layout decisions (${label})`).toBe(servedIn(page, LAYOUT).length);
    return { served: servedIn(page, LAYOUT), manifests: records.map(r => (r.inputs?.replay ?? {}) as Record<string, unknown>) };
  }
  async function arrived(m: Mounted, entry: Record<string, string>) {
    const s = await shopperOn(m);
    expect((await s.action(PAGE_VIEW, entry)).status, `${m.host}: the shopper's page view is accepted`).toBe(200);
    return s;
  }
  const keysOf = (manifest: Record<string, unknown>) => Object.keys(manifest).sort();

  for (const host of HOSTS) {
    it(`host (${host}): on a page whose layout slot carries orders, a decision for a shopper outside every context writes exactly the page-manifest markers it wrote before the orders, while an in-context decision adds orders: "configured-order-v1"`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O7.F1.04 — the declared layout slot (P02) publishes');
      // Before any order: what a direct first visit's decision writes on this page.
      const earlier = await decided(m, await arrived(m, DIRECT_ENTRY), 'f104-before');
      const markersBefore = keysOf(earlier.manifests[0] ?? {});
      expect(earlier.manifests.map(keysOf), `${host}: PRECONDITION — every position of the page writes one manifest`).toEqual(earlier.manifests.map(() => markersBefore));

      const order = [M.reco2, M.editorial, M.grid];
      const written = await putSlots(m, withOrders([{ context: PAID_SOCIAL_FIRST, modules: order }, { context: EMAIL_RETURNING, modules: [M.ugc, M.reco1] }]), 'f1.04 orders');
      expect(written.status, `${host}: PRECONDITION — the orders publish: ${JSON.stringify(errorsOf(written))}`).toBe(200);

      const inContext = await decided(m, await arrived(m, PAID_SOCIAL_ENTRY), 'f104-in');
      const outside = await decided(m, await arrived(m, DIRECT_ENTRY), 'f104-out');
      expect(inContext.served, `${host}: PRECONDITION — the paid-social first visit is served its order`).toEqual(order);
      expect(outside.served, `${host}: PRECONDITION — the direct first visit, outside every context, receives the slot's own decision`).toEqual(earlier.served);

      expect(outside.manifests.map(keysOf), `${host}: P01.O7.F1.04 — outside every context the decision writes exactly the markers it wrote before (kit 02: "every other decision writes exactly the markers it wrote before")`)
        .toEqual(outside.manifests.map(() => markersBefore));
      expect(inContext.manifests.map(manifest => ({ keys: keysOf(manifest), orders: manifest.orders })), `${host}: P01.O7.F1.04 — the in-context decision adds the orders marker beside them`)
        .toEqual(inContext.manifests.map(() => ({ keys: [...markersBefore, 'orders'].sort(), orders: 'configured-order-v1' })));
    });
  }
});

// ===========================================================================
// unit:P01.O5.F1.05 — a write marked earlier than 4 carrying orders is refused by name (a lock)
// ===========================================================================

describe('unit:P01.O5.F1.05 — P01 fix round 1 (lock; witness kit 02:785-786): a slots write marked governanceVersion 3 that carries orders is refused by name, never admitted with the orders dropped', () => {
  const ORDERS = [{ context: EMAIL_RETURNING, modules: [M.grid, M.reco1] }];
  /** The layout slot as an earlier version writes it: no `layout` declaration, which version 4 introduces. */
  const { layout: _declared, ...earlierLayoutSlot } = layoutSlot();
  void _declared;
  const earlyWrite = (mark: number, slot: Record<string, unknown>) => ({ version: `p01-fix1-v${mark}`, governanceVersion: mark, pages: { pdp: [slot, recentSlot()] } });
  const ORDERS_AT = 'pages.pdp[0].orders';
  const namesOrders = (errors: string[]) => errors.some(e => e.includes(ORDERS_AT) && /version 4\b/i.test(e));

  it('logic: the slots write validator refuses a document marked governanceVersion 1, 2 or 3 that carries orders — on an undeclared slot and on one that also declares the layout — with an error naming pages.pdp[0].orders and version 4, and never admits it with the orders dropped', () => {
    const cases: Array<[string, unknown]> = [
      ['marked 3, orders on the undeclared slot', earlyWrite(3, { ...earlierLayoutSlot, orders: ORDERS })],
      ['marked 3, orders on a slot that also declares the layout', earlyWrite(3, layoutSlot({ orders: ORDERS }))],
      ['marked 2, orders on the undeclared slot', earlyWrite(2, { ...earlierLayoutSlot, orders: ORDERS })],
      ['marked 1, orders on the undeclared slot', earlyWrite(1, { ...earlierLayoutSlot, orders: ORDERS })],
    ];
    const outcomes = cases.map(([name, candidate]) => {
      const result = SLOTS_KIND.validate(candidate);
      return { case: name, admitted: result.ok, namesOrders: result.ok ? false : namesOrders(result.errors), errors: result.ok ? [] : result.errors };
    });
    expect(outcomes, 'P01.O5.F1.05 — each is refused naming pages.pdp[0].orders and version 4').toEqual(cases.map(([name]) => ({ case: name, admitted: false, namesOrders: true, errors: expect.anything() })));
    const control = SLOTS_KIND.validate(earlyWrite(3, earlierLayoutSlot));
    expect(control.ok, `CONTROL — the same version-3 write without orders is admitted: ${JSON.stringify(control.ok ? [] : control.errors)}`).toBe(true);
  });

  for (const host of HOSTS) {
    it(`host (${host}): PUT /content/slots of a document marked governanceVersion 3 that carries orders answers 422 naming pages.pdp[0].orders and version 4, and no revision is written`, async () => {
      const m = await mount(host, BASE);
      expectPublished(m, 'P01.O5.F1.05 — the declared layout slot (P02) publishes');
      const before = await inForce(m, 'slots');
      const outcomes: unknown[] = [];
      for (const [name, document] of [
        ['orders on the undeclared slot', earlyWrite(3, { ...earlierLayoutSlot, orders: ORDERS })],
        ['orders on a slot that also declares the layout', earlyWrite(3, layoutSlot({ orders: ORDERS }))],
      ] as const) {
        const answer = await putSlots(m, document, `f1.05 ${name}`);
        outcomes.push({ case: name, status: answer.status, namesOrders: namesOrders(errorsOf(answer)), revision: (await inForce(m, 'slots')).revision, errors: errorsOf(answer) });
      }
      expect(outcomes, `${host}: P01.O5.F1.05 — refused by name, never admitted with the orders dropped (read back: the slots revision is unchanged)`)
        .toEqual([{ case: 'orders on the undeclared slot', status: 422, namesOrders: true, revision: before.revision, errors: expect.anything() },
          { case: 'orders on a slot that also declares the layout', status: 422, namesOrders: true, revision: before.revision, errors: expect.anything() }]);
      expect((await inForce(m, 'slots')).document, `${host}: P01.O5.F1.05 — the document in force is the one before the refused writes`).toEqual(before.document);
      const control = await putSlots(m, earlyWrite(3, earlierLayoutSlot), 'f1.05 control');
      expect(control.status, `${host}: CONTROL — the same version-3 write without orders publishes, so the refusal is the orders: ${JSON.stringify(errorsOf(control))}`).toBe(200);
    });
  }
});
