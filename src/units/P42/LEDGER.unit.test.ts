// src/units/P42/LEDGER.unit.test.ts
// P42 under the Closure Ledger: the tests for the LOCAL criteria of the P42 work
// order (the operator-warnings programme, amendment 2, ticket P42 "A pooled
// publication that fails closed names the faulty page, and the stale slot says it
// is stale"). DC1 (D1, RESOLVED by the owner's rule R-P78) is exercised inside
// PW1-PW4; LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P42.<criterion>')` per LOCAL criterion. Expected values come
// from the work order and the witnesses it cites, never from what the engine
// answers today:
//   · the authority copy (docs/parity/authority/amendment-2/BTI-Parity-Amendment-2026-10-16.md,
//     section 2, P42): "when a pooled publication fails because a sibling
//     placement's statistics cannot be read, the publication's refusal names the
//     faulty page and slot and the pooled modules it carries, and says the slot's
//     snapshot stays at its last successful version; the slot's operator read
//     surfaces (GET /v1/:tenant/lift and /lift/rows) report the snapshot as stale,
//     naming the failing placement and the last successful publish, until a later
//     publish succeeds, after which the marker is gone; a slot whose publications
//     succeed reads and publishes byte for byte as today; the recovery refusal of
//     every other cause keeps today's text";
//   · the P08 delivery review section 9 (R7), measured with the probe
//     P08/reviewer/scripts/probe-review.test.ts:253-287: with home's `/pooled` door
//     answering 500, the product page's `/publish` answers 503 "statistics
//     recovery required", the snapshot version is unchanged and stale for every
//     module, and the next publish after the door is restored succeeds. The
//     injection here is that probe's: the real LEARN_STATS namespace of the mounted
//     app, its `get` wrapped so that one placement's object answers 500 on
//     `/pooled` and is otherwise itself;
//   · today's texts: src/durable-objects/LearnStats.ts:129 and :237-241 (every
//     recovery refusal of the object answers 503 `{ ok: false, error: 'statistics
//     recovery required' }`) and src/routes/decisions.ts:1531-1557 (the operator's
//     `POST /v1/:tenant/learn/publish` answers 503 `{ ok: false, error: 'statistics
//     acknowledgement unavailable' }` for every refusal of the object);
//   · today's read answers, member for member: src/routes/decisions.ts:766-767
//     (`GET /v1/:tenant/lift`: ok, tenant, brand, slot, snapshot) and :488
//     (`GET /v1/:tenant/lift/rows`), src/durable-objects/LearnStats.ts:450-452
//     (the object's `/publish`: ok, published, snapshot), src/routes/decisions.ts:1552
//     (the operator's publish: ok, tenant, brand, slot, published, snapshot), and
//     src/learn/stats.ts:295-350 (the members a lift snapshot may carry).
//
// THE TELLING, RULED (one representation for PW1-PW4; D1 leaves the marker's
// members to the specifier, added only to a slot that has failed):
//   · THE MARKER `stale`, keys sorted (R-P3):
//       { lastPublished: { publishedAt, version }, modules: [ … ], placement: { page, slot } }
//     `placement` is the sibling placement whose `/pooled` door failed (its page
//     and slot); `modules` the pooled modules the refused placement reads from it,
//     sorted (not every pooled module of the slot: a pooled module whose other
//     placement answered is not named); `lastPublished` the version and
//     `publishedAt` of the snapshot in force, which the refusal leaves in force.
//   · THE REFUSAL. The placement's object's `/publish` door, through which the
//     operator's publish reaches it, answers 503 `{ ok: false, error, stale }`: `error`
//     a sentence naming the faulty page, its slot and every module of `modules`,
//     and saying that the snapshot stays at version <lastPublished.version>;
//     `stale` the marker. The operator's `POST /v1/:tenant/learn/publish` passes
//     the same `error` and `stale` through, 503. Every refusal of another cause
//     keeps today's body byte for byte, with no `stale`.
//   · THE READS. A publication is the object's `LearnStats.publish()`, which the
//     `/publish` door (src/durable-objects/LearnStats.ts:450-452) and the object's
//     own alarm (:523-533, the publication made every minute; also :341, :507, :514,
//     :811, :1259, :1281) share. From a publication refused for the pooled cause,
//     through either, until the placement's next successful publication, through
//     either, `GET /v1/:tenant/lift` and `GET /v1/:tenant/lift/rows` for
//     that placement carry the marker as a top-level member `stale`, beside
//     today's members; the snapshot itself is unchanged. A placement whose last
//     publication succeeded (one that never failed, or one published again since)
//     reads byte for byte as today, with no `stale`.
//   · NOT RULED (no witness fixes it): the marker of a placement with no earlier
//     successful publication; several failing siblings at once.
//   · FOR THE BUILD, NO UNIT (the S6 specification review): a healthy publication
//     makes no new KV call. The KV doubles of src/learn/learn.test.ts:134 (`FakeKV`)
//     and src/content/consent.test.ts implement only get and put, and a sketch that
//     called CACHE.delete on every successful publication turned nine tests outside
//     the baseline RED; the marker is written and cleared only around a pooled fault.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): `stale`
// on the refusal and on both reads, and the refusal's named sentence. No new export
// is imported.
//
// FIXTURE. P08's (src/units/P08/LEDGER.unit.test.ts:95-120: the complete-the-look
// module pooled on the product and home pages, the reviews module undeclared on
// both, a size guide and a category grid on one each; governance 3; rendered-v1;
// nMin 2), extended for PW1 and PW2 with a cart page and a second pooled module
// (style-it) on the product and cart pages, so that the home page's fault names
// complete-the-look alone. PW3 is P08's fixture exactly.
//
// R10 (tests that lock present behaviour, listed for the lead; logs/r10-P42.log):
//   · no test asserts the object's refusal body or the operator publish refusal on a
//     pooled fault; the only assertions of 'statistics recovery required' are on
//     other causes and keep it (listed in the log);
//   · tests that pin the lift and lift/rows answers' member lists for healthy slots
//     stay green under the ruling (the marker is absent there);
//   · src/ledger/ledger.test.ts:385-396 locks that the operator's publish never
//     echoes a downstream text: the ruled pass-through applies only to a 503 refusal
//     carrying a well-formed `stale`;
//   · the KV doubles of src/learn/learn.test.ts:134 and src/content/consent.test.ts
//     implement only get and put (the header's note for the build).
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object
// classes, both shopper hosts), src/units/_parity3.ts (publication through every
// object's own door; the kit). Imports from src/units/: ../_parity, ../_parity3.

import { describe, expect, it } from 'vitest';

import { invalidateLiftCache } from '@/content/service';
import { statsName } from '@/learn/fan';
import { DEFAULT_STATS } from '@/learn/stats';

import {
  asOperator, BRAND, expectPublished, HOSTS, mount, PAID_SOCIAL_ENTRY, pageInstanceOf, putDocument, shopperOn, storedDecisions, TENANT,
  VIEW_TABBY_26, type Answer, type Host, type Mounted,
} from '../_parity';
import { missingStatements, publishStats } from '../_parity3';

const PDP_MODULES = 'pdp-modules', HOME_MODULES = 'home-modules', CART_MODULES = 'cart-modules';
const POOLED = 'module.complete-the-look.1', POOLED2 = 'module.style-it.1', SHARED = 'module.reviews.1', PDP_ONLY = 'module.size-guide.1', HOME_ONLY = 'module.category-grid.1';
const module_ = (id: string, type: string, slotTypes: string[], over: Record<string, unknown> = {}) => ({ id,
  customerContentId: `TAP-${id.replace(/^module\./, '').replace(/\./g, '-').toUpperCase()}`, type, title: type, tags: { line: ['Tabby'] },
  slotTypes, journeyStageFit: ['considering'], lifecycle: { status: 'live' }, ...over });
/** P08's catalogue (src/units/P08/LEDGER.unit.test.ts:103-108). */
const P08_PIECES = [
  module_(POOLED, 'complete-the-look', [PDP_MODULES, HOME_MODULES], { pooled: true }),
  module_(SHARED, 'reviews', [PDP_MODULES, HOME_MODULES]),
  module_(PDP_ONLY, 'size-guide', [PDP_MODULES]),
  module_(HOME_ONLY, 'category-grid', [HOME_MODULES]),
];
const P08_SLOTS = { version: 'parity-p08-slots', governanceVersion: 3, pages: {
  pdp: [{ slot: PDP_MODULES, take: 3, weights: { line: 1 } }], home: [{ slot: HOME_MODULES, take: 3, weights: { line: 1 } }] } };
const STATS = { ...DEFAULT_STATS, nMin: 2 };
const dials = (reward = 'click') => ({ measurementBasis: 'rendered-v1', reward, gamma: 1 });
const learnOf = (slots: Record<string, unknown>) => ({ version: 'parity-p42-learn', holdout: { share: 0, salt: 'parity', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 }, stats: STATS, slots });
/** P08's learn document (rendered-v1). */
const P08_LEARN = learnOf({ [PDP_MODULES]: dials(), [HOME_MODULES]: dials() });

/** PW1/PW2: P08's catalogue with a second pooled module on the product and cart pages, and the cart page. */
const PIECES = [...P08_PIECES.slice(0, 1), module_(POOLED2, 'style-it', [PDP_MODULES, CART_MODULES], { pooled: true }), ...P08_PIECES.slice(1)];
const SLOTS = { version: 'parity-p42-slots', governanceVersion: 3, pages: {
  pdp: [{ slot: PDP_MODULES, take: 4, weights: { line: 1 } }], home: [{ slot: HOME_MODULES, take: 3, weights: { line: 1 } }],
  cart: [{ slot: CART_MODULES, take: 2, weights: { line: 1 } }] } };
const LEARN = learnOf({ [PDP_MODULES]: dials(), [HOME_MODULES]: dials(), [CART_MODULES]: dials() });

async function world(host: Host, documents: { pieces: unknown[]; slots: unknown; learn: unknown } = { pieces: PIECES, slots: SLOTS, learn: LEARN }): Promise<Mounted> {
  const m = await mount(host, documents);
  expectPublished(m, 'P42 — the catalogue declaring the pooled modules, the pages and the learn document publish');
  return m;
}

/** One shopper visit to a page: a Tabby view, the page served and acknowledged in full, and a click on every pooled or shared module served. */
async function visit(m: Mounted, page: 'pdp' | 'home' | 'cart') {
  const s = await shopperOn(m);
  expect((await s.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  const served = await s.snapshot(page, { pageInstance: pageInstanceOf(`p42-${page}`) });
  expect(served.decisions.length, `${m.host}: PRECONDITION — the ${page} slot serves its modules (${JSON.stringify(served.body).slice(0, 200)})`).toBeGreaterThan(0);
  for (const d of served.decisions) expect((await s.ack(served, d)).status, `${m.host}: PRECONDITION — ${d.contentId} acknowledged`).toBe(200);
  for (const d of served.decisions.filter(x => [POOLED, POOLED2, SHARED].includes(x.contentId))) {
    expect((await s.click(served, d)).status, `${m.host}: PRECONDITION — the click on ${d.contentId} is accepted`).toBe(200);
  }
  await m.drainLedger();
  return s;
}

type Stub = { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
type Namespace = { get: (name: string) => Stub; idFromName: (name: string) => string };
const namespaceOf = (m: Mounted) => m.env.LEARN_STATS as unknown as Namespace;
/** The placement's own object, as the operator's route reaches it (`statsName`, one page per slot here). */
const objectOf = (m: Mounted, slot: string) => namespaceOf(m).get(namespaceOf(m).idFromName(statsName(TENANT, BRAND, slot)));
/** The object's `/publish` door, which the operator's publish reaches; it runs `LearnStats.publish()`, as the object's alarm does. */
async function objectPublish(m: Mounted, slot: string): Promise<Answer> {
  const response = await objectOf(m, slot).fetch('https://learn/publish', { method: 'POST' });
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}
const operatorPublish = (m: Mounted, slot: string) => asOperator(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot });
const liftOf = (m: Mounted, slot: string) => asOperator(m, 'GET', `/v1/${TENANT}/lift?slot=${slot}`);
const rowsOf = (m: Mounted, slot: string) => asOperator(m, 'GET', `/v1/${TENANT}/lift/rows?slot=${slot}`);

/**
 * The P08 review's R7 injection (P08/reviewer/scripts/probe-review.test.ts:269-273): the mounted app's
 * real LEARN_STATS namespace, its `get` wrapped so that one placement's object answers 500 on `/pooled`
 * and is otherwise itself. Returns the restore.
 */
function failPooledDoor(m: Mounted, slot: string): () => void {
  const ns = namespaceOf(m), original = ns.get, faulty = statsName(TENANT, BRAND, slot);
  ns.get = (name: string) => {
    const stub = original(name);
    return name !== faulty ? stub : { fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
      (String(input instanceof Request ? input.url : input).endsWith('/pooled') ? new Response('{"ok":false}', { status: 500 }) : stub.fetch(input, init)) };
  };
  return () => { ns.get = original; };
}

/** Today's members, in order (header). */
const LIFT_MEMBERS = ['ok', 'tenant', 'brand', 'slot', 'snapshot'];
const ROWS_MEMBERS = ['ok', 'tenant', 'brand', 'slot', 'version', 'published', 'publishedAt', 'reward', 'objective', 'measurementBasis', 'n0', 'nMin', 'priorVersion',
  'level', 'item', 'q', 'sort', 'dir', 'total', 'offset', 'limit', 'rows', 'cursor'];
const OBJECT_PUBLISH_MEMBERS = ['ok', 'published', 'snapshot'];
const OPERATOR_PUBLISH_MEMBERS = ['ok', 'tenant', 'brand', 'slot', 'published', 'snapshot'];
/** src/learn/stats.ts:295-350: every member a lift snapshot may carry. */
const SNAPSHOT_MEMBERS = ['measurementBasis', 'witness', 'completeness', 'tauLearnMs', 'tenant', 'brand', 'slot', 'reward', 'objective', 'generation', 'restartedAt',
  'exposuresSinceRestart', 'version', 'publishedAt', 'events', 'n0', 'nMin', 'liftMin', 'liftMax', 'priorVersion', 'items', 'slotRates', 'attributionContract',
  'rebuiltFrom', 'positionEffects'];

type Published = { version: number; publishedAt: number };
const identityOf = (answer: Answer): Published => {
  const snapshot = answer.body.snapshot as Published | null;
  expect(snapshot?.version, `PRECONDITION: the lift route answers a published snapshot (${JSON.stringify(answer.body).slice(0, 200)})`).toBeGreaterThan(0);
  return { version: snapshot!.version, publishedAt: snapshot!.publishedAt };
};
/** The ruled marker for the home page's fault on the product page's slot (header). */
const staleOf = (last: Published) => ({ lastPublished: { publishedAt: last.publishedAt, version: last.version }, modules: [POOLED], placement: { page: 'home', slot: HOME_MODULES } });
/** R-P3: the marker's keys and its members' keys, each as written and sorted. */
function keyOrders(stale: unknown): Array<[string[], string[]]> {
  if (!stale || typeof stale !== 'object') return [];
  const s = stale as Record<string, unknown>;
  return [s, s.lastPublished, s.placement].filter((o): o is Record<string, unknown> => !!o && typeof o === 'object').map(o => [Object.keys(o), [...Object.keys(o)].sort()]);
}
/** What the refusal's sentence names, against the ruling: the page, its slot, every pooled module it carries, and the version that stays. */
function sentenceOf(error: unknown, last: Published) {
  const text = String(error ?? '');
  return { page: /\bhome\b(?!-)/.test(text), slot: text.includes(HOME_MODULES), modules: text.includes(POOLED), stays: /\b(stays|remains|is kept|kept)\b/.test(text) && text.includes(`version ${last.version}`) };
}
const NAMED = { page: true, slot: true, modules: true, stays: true };
const memberOf = (answer: Answer, member: string) => (Object.hasOwn(answer.body, member) ? answer.body[member] : `no ${member} member (members: ${Object.keys(answer.body).join(', ')})`);

// ===========================================================================
// unit:P42.PW1 — the refusal names the faulty page, slot and pooled modules
// ===========================================================================

describe('unit:P42.PW1 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with the home page's /pooled door failing, the product page's publication is refused naming the home page, its slot and the pooled module it carries, saying the snapshot stays at its last successful version, at the object's door and at the operator's publish`, async () => {
      const m = await world(host);
      await visit(m, 'pdp'); await visit(m, 'home'); await visit(m, 'cart');
      await publishStats(m);
      const last = identityOf(await liftOf(m, PDP_MODULES));
      await visit(m, 'pdp');
      const restore = failPooledDoor(m, HOME_MODULES);
      const [refused, routed] = await (async () => {
        try { return [await objectPublish(m, PDP_MODULES), await operatorPublish(m, PDP_MODULES)] as const; } finally { restore(); }
      })();
      expect(refused.status, `${host}: PRECONDITION (P08 review R7) — the product page's publication fails closed (${JSON.stringify(refused.body).slice(0, 200)})`).toBe(503);
      expect.soft(memberOf(refused, 'stale'), `${host}: P42.PW1 — the object's refusal carries the marker naming the home page's placement, the pooled module it carries and the last successful publish`).toEqual(staleOf(last));
      expect.soft(sentenceOf(refused.body.error, last), `${host}: P42.PW1 — the object's refusal says it in words (${String(refused.body.error)})`).toEqual(NAMED);
      expect.soft([routed.status, memberOf(routed, 'stale')], `${host}: P42.PW1 — the operator's publish passes the marker through`).toEqual([503, staleOf(last)]);
      expect.soft(sentenceOf(routed.body.error, last), `${host}: P42.PW1 — and the words (${String(routed.body.error)})`).toEqual(NAMED);
      expect.soft(keyOrders(refused.body.stale).concat(keyOrders(routed.body.stale)).filter(([written, sorted]) => written.join() !== sorted.join()),
        `${host}: P42.PW1 — R-P3: the marker is written with sorted keys`).toEqual([]);
      expect.soft(identityOf(await liftOf(m, PDP_MODULES)), `${host}: P42.PW1 — LOCKED (fail-closed stays): the snapshot in force is the last successful one`).toEqual(last);
    }, 120_000);

    it(`host (${host}): CONTROL — a recovery refusal of another cause (the slot's reward changed in the learn document without an authorized transition) keeps today's text at the object's door and at the operator's publish, and the lift read stays today's`, async () => {
      const m = await world(host, { pieces: P08_PIECES, slots: P08_SLOTS, learn: P08_LEARN });
      await visit(m, 'pdp'); await visit(m, 'home');
      await publishStats(m);
      const changed = await putDocument(m, 'learn', learnOf({ [PDP_MODULES]: dials('add_to_bag'), [HOME_MODULES]: dials() }), 'p42-other-cause');
      expect(changed.status, `${host}: PRECONDITION — the learn document changing the product slot's reward publishes (${JSON.stringify(changed.body).slice(0, 200)})`).toBe(200);
      const refused = await objectPublish(m, PDP_MODULES);
      expect([refused.status, JSON.stringify(refused.body)], `${host}: P42.PW1 — another cause: the object's refusal is today's, byte for byte`).toEqual([503, JSON.stringify({ ok: false, error: 'statistics recovery required' })]);
      const routed = await operatorPublish(m, PDP_MODULES);
      expect([routed.status, JSON.stringify(routed.body)], `${host}: P42.PW1 — another cause: the operator's publish refusal is today's, byte for byte`).toEqual([503, JSON.stringify({ ok: false, error: 'statistics acknowledgement unavailable' })]);
      expect(Object.keys((await liftOf(m, PDP_MODULES)).body), `${host}: P42.PW1 — another cause: the lift read carries today's members only`).toEqual(LIFT_MEMBERS);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P42.PW2 — the lift reads mark the slot stale until a publication succeeds
// ===========================================================================

describe('unit:P42.PW2 (R-P78, D1)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): after the refused publication, GET lift and GET lift/rows for the product slot carry the stale marker naming the home placement and the last successful publish; the home and cart slots, which never failed, carry none; after the next publication succeeds the product slot carries none either`, async () => {
      const m = await world(host);
      await visit(m, 'pdp'); await visit(m, 'home'); await visit(m, 'cart');
      await publishStats(m);
      const last = identityOf(await liftOf(m, PDP_MODULES));
      await visit(m, 'pdp');
      const restore = failPooledDoor(m, HOME_MODULES);
      const refused = await (async () => { try { return await objectPublish(m, PDP_MODULES); } finally { restore(); } })();
      expect(refused.status, `${host}: PRECONDITION (P08 review R7) — the product page's publication fails closed`).toBe(503);

      const lift = await liftOf(m, PDP_MODULES), rows = await rowsOf(m, PDP_MODULES);
      expect.soft(memberOf(lift, 'stale'), `${host}: P42.PW2 — GET lift for the product slot carries the marker`).toEqual(staleOf(last));
      expect.soft(memberOf(rows, 'stale'), `${host}: P42.PW2 — GET lift/rows for the product slot carries the marker`).toEqual(staleOf(last));
      expect.soft(identityOf(lift), `${host}: P42.PW2 — LOCKED: the snapshot itself is the last successful one`).toEqual(last);
      for (const slot of [HOME_MODULES, CART_MODULES]) {
        expect.soft([Object.keys((await liftOf(m, slot)).body), Object.keys((await rowsOf(m, slot)).body)], `${host}: P42.PW2 — ${slot}, which never failed, reads with today's members only`)
          .toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
      }

      const again = await objectPublish(m, PDP_MODULES);
      expect([again.status, again.body.published], `${host}: PRECONDITION — with the door restored the next publication succeeds (${JSON.stringify(again.body).slice(0, 200)})`).toEqual([200, true]);
      const after = await liftOf(m, PDP_MODULES);
      expect.soft([Object.keys(after.body), Object.keys((await rowsOf(m, PDP_MODULES)).body)], `${host}: P42.PW2 — after the successful publication the product slot reads with today's members only`)
        .toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
      expect.soft(identityOf(after).version, `${host}: P42.PW2 — and its snapshot is the new one`).toBeGreaterThan(last.version);
    }, 120_000);

    it(`host (${host}): through the product placement's own alarm (the publication LearnStats.publish() makes every minute, which the /publish door shares): under the home page's /pooled fault the alarm's publication is refused and GET lift and GET lift/rows for the product slot carry the stale marker; with the door restored the next alarm publication succeeds and both reads carry today's members only`, async () => {
      const m = await world(host);
      await visit(m, 'pdp'); await visit(m, 'home'); await visit(m, 'cart');
      await publishStats(m);
      const last = identityOf(await liftOf(m, PDP_MODULES));
      await visit(m, 'pdp');
      // The placement's own object in the harness's registry: its alarm calls LearnStats.publish() directly, never the /publish door.
      const placement = m.stats.get(statsName(TENANT, BRAND, PDP_MODULES));
      expect(placement, `${host}: PRECONDITION — the product placement's statistics object exists`).toBeTruthy();
      const alarm = () => (placement!.object as unknown as { alarm: () => Promise<void> }).alarm()
        .then(() => 'published', (error: Error) => `refused: ${String(error?.message ?? error).slice(0, 120)}`);
      const restore = failPooledDoor(m, HOME_MODULES);
      const refused = await (async () => { try { return await alarm(); } finally { restore(); } })();
      await m.drain();
      expect(refused.startsWith('refused'), `${host}: PRECONDITION (P08 review R7) — the alarm's publication fails closed under the fault (${refused})`).toBe(true);

      const lift = await liftOf(m, PDP_MODULES), rows = await rowsOf(m, PDP_MODULES);
      expect.soft(memberOf(lift, 'stale'), `${host}: P42.PW2 — after the alarm's refused publication, GET lift for the product slot carries the marker`).toEqual(staleOf(last));
      expect.soft(memberOf(rows, 'stale'), `${host}: P42.PW2 — and so does GET lift/rows`).toEqual(staleOf(last));
      expect.soft(identityOf(lift), `${host}: P42.PW2 — LOCKED: the snapshot itself is the last successful one`).toEqual(last);

      const again = await alarm();
      await m.drain();
      expect(again, `${host}: PRECONDITION — with the door restored the next alarm publication succeeds`).toBe('published');
      const after = await liftOf(m, PDP_MODULES);
      expect.soft([Object.keys(after.body), Object.keys((await rowsOf(m, PDP_MODULES)).body)], `${host}: P42.PW2 — after the alarm's successful publication the product slot reads with today's members only`)
        .toEqual([LIFT_MEMBERS, ROWS_MEMBERS]);
      expect.soft(identityOf(after).version, `${host}: P42.PW2 — and its snapshot is the new one`).toBeGreaterThan(last.version);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P42.PW3 — LOCK: a slot whose publications succeed is byte for byte today's
// ===========================================================================

type Row = { n: number; s: number };
const counts = (record: Record<string, Row>, key: string) => [Math.round(record[key]?.n ?? 0), Math.round(record[key]?.s ?? 0)];

describe('unit:P42.PW3 (R-P7)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — on P08's fixture, every placement publishes, reads and decides as today: the object's and the operator's publish answers, the lift and lift/rows answers member for member, P08's one record and the lift its decisions read`, async () => {
      const m = await world(host, { pieces: P08_PIECES, slots: P08_SLOTS, learn: P08_LEARN });
      await visit(m, 'pdp'); await visit(m, 'pdp'); await visit(m, 'home');
      await m.drain();
      for (const slot of [PDP_MODULES, HOME_MODULES]) {
        const published = await objectPublish(m, slot);
        expect([published.status, Object.keys(published.body), published.body.published], `${host}: P42.PW3 — ${slot}: the object's publish answer is today's`).toEqual([200, OBJECT_PUBLISH_MEMBERS, true]);
        const routed = await operatorPublish(m, slot);
        expect([routed.status, Object.keys(routed.body)], `${host}: P42.PW3 — ${slot}: the operator's publish answer is today's`).toEqual([200, OPERATOR_PUBLISH_MEMBERS]);
      }
      for (const [slot, own] of [[PDP_MODULES, 2], [HOME_MODULES, 1]] as const) {
        const lift = await liftOf(m, slot);
        expect(Object.keys(lift.body), `${host}: P42.PW3 — ${slot}: GET lift answers today's members`).toEqual(LIFT_MEMBERS);
        const snapshot = lift.body.snapshot as Record<string, unknown> & { items: Record<string, Record<string, Row>> };
        expect(Object.keys(snapshot).filter(k => !SNAPSHOT_MEMBERS.includes(k)), `${host}: P42.PW3 — ${slot}: the snapshot carries only the members a lift snapshot carries today`).toEqual([]);
        expect([counts(snapshot.items[POOLED] ?? {}, '*'), counts(snapshot.items[SHARED] ?? {}, '*')], `${host}: P42.PW3 — LOCKED (P08.Q1): ${slot} answers the one pooled record and its own undeclared record`).toEqual([[3, 3], [own, own]]);
        expect(Object.keys((await rowsOf(m, slot)).body), `${host}: P42.PW3 — ${slot}: GET lift/rows answers today's members`).toEqual(ROWS_MEMBERS);
      }
      for (const page of ['pdp', 'home'] as const) {
        invalidateLiftCache();
        const s = await shopperOn(m);
        await s.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY);
        const served = await s.snapshot(page, { pageInstance: pageInstanceOf(`p42-pw3-${page}`) });
        const d = served.decisions.find(x => x.contentId === POOLED);
        expect(d, `${host}: PRECONDITION — the pooled module is served on ${page}`).toBeTruthy();
        expect((await s.ack(served, d!)).status).toBe(200);
        await m.drainLedger();
        const lift = storedDecisions(m, s.subject).find(r => r.item_id === POOLED)?.explain.lift as (Record<string, unknown> & { n?: number }) | null | undefined;
        expect(lift?.n === undefined ? lift : Math.round(lift.n), `${host}: P42.PW3 — LOCKED (P08.Q1): the ${page} decision reads the pooled module's lift from the one record (n 3 at everyone)`).toBe(3);
      }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P42.PW4 — the kit
// ===========================================================================

describe('unit:P42.PW4', () => {
  it('logic: the API reference and the payload schemas state the named refusal and the stale marker', () => {
    const missing = missingStatements(['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'a pooled publication refused because another placement\'s statistics cannot be read names that page, its slot and the pooled modules (503 with stale)',
        test: t => /pooled/i.test(t) && /(refus|503)/i.test(t) && /\bstale\b/.test(t) && /\bplacement\b/.test(t) && /\bmodules?\b/.test(t) },
      { name: 'the refused publication leaves the slot\'s snapshot at its last successful version',
        test: t => /snapshot/i.test(t) && /(stays|remains|kept)/i.test(t) && /last successful|lastPublished/.test(t) },
      { name: 'GET lift and GET lift/rows carry the stale marker until a later publication succeeds',
        test: t => /\bstale\b/.test(t) && /lift\/rows/.test(t) && /(until|after)/i.test(t) && /succeed/i.test(t) },
      { name: 'the marker\'s members: lastPublished, modules and placement',
        test: t => /\bstale\b/.test(t) && /lastPublished/.test(t) && /\bmodules\b/.test(t) && /\bplacement\b/.test(t) },
      { name: 'a recovery refusal of any other cause keeps its text',
        test: t => /statistics recovery required/.test(t) && /(other cause|another cause|every other)/i.test(t) },
    ]);
    expect(missing, 'P42.PW4 — the kit states the named refusal and the stale marker').toEqual([]);
  });
});
