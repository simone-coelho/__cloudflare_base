// src/units/P101/LEDGER.unit.test.ts
// P101 under the Closure Ledger (programme `tapestry-parity-hardening`, amendment 13, item E26; batch S46): the tests for the
// LOCAL criteria PI1–PI3 of the P101 work order (docs/parity/hardening/program.json). LV1 is a deferred live row and gets no
// test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md:25–28, E26):
//   "#### E26 · A malformed page-view id answered as what it is
//    - **Authority:** the 401 diagnosis (R-P541): a `pageInstance` outside 1–128 characters of `A-Za-z0-9_-` is accepted by
//      the route and refused later, when a render offer is minted, as 401 "Shopper session unavailable" — a request error
//      answered as a session failure, after the decision's work (older than the scale programme; the SDK sends a UUID).
//    - **Done when:** the decision routes refuse a malformed `pageInstance` with `400 Invalid page instance` before any work,
//      as they do a malformed `arm`; kit 02 states the format.
//    - **Needed by:** before the first activation. Hours."
// THE WORK ORDER (P101): PI1 on both hosts a pageInstance outside 1–128 characters of A-Za-z0-9_- (the empty string, a
// space, a comma, a slash, or 129 characters) answers 400 { ok: false, error: 'Invalid page instance' } before any work on
// the GET (the query's pageInstance), on the POST with a session (nothing decided, nothing captured to the ledger or the
// ring, no render offer minted) and at the first-request door (before a session is issued or a shopper object created,
// Cache-Control no-store as the door answers a malformed arm); PI2 (LOCK) valid ids as today — the SDK's ids and a
// 128-character id get their render offers and their acknowledgements are admitted, no pageInstance answers 200 with no
// render offer, the five other request errors keep their answers, the door's other refusals stay 401; PI3 kit 02's
// pageInstance row (:342) states the format and the 400 on every decision path, a new visitor's first request included.
// R-P546: an empty pageInstance is refused; the first request answers 400 for a malformed one, as for a malformed `arm`.
// R-P545 (the owner's rule): the cause fixed, nothing papered over — the request refused where the request is read, not
// the late refusal retyped or caught after the work.
//
// TODAY (99ddcafc; src, docs/kit and scripts byte-equal to 340cd410, where the work order's lines are read): snapshotContext
// (src/routes/decisions.ts:983–1037) admits any pageInstance on the GET (:987–1001) and any string up to 128 characters on
// the POST (the allow-list, :1021–1024, which refuses a longer one 401 like any field); the route decides in the shopper's
// own object (:1294) with the id as the offer (:1312); only the render offer's mint refuses it (src/content/renderOffer.ts:62,
// isEventNonce, src/events/actionTypes.ts:45–46), answered 401 'Shopper session unavailable' (src/identity/sessionAuthority.ts
// :766–767) after the decision's work, and only for a shopper with tracking consent on a page with a rendered-v1 slot
// (src/content/service.ts:1230–1234); the door (:1121–1134) issues a session to a malformed id and answers 200 with no offer,
// its catch answering every other snapshotContext failure 401 (:1130–1133) but a malformed arm 400 (:1132).
//
// THE READINGS (where the work order is silent):
//   1 "Before any work", measured as the malformed `arm` is refused today on the same path (E26: "as they do a malformed
//     arm"): the shopper's own object is never reached (every decision is made there: each valid decision below reaches it,
//     the door's twice) and nothing is written anywhere the mount holds (both KV namespaces, the bucket, every shopper, ring
//     and statistics object's storage, the ledger queue: compared value for value before and after). Each leg measures the
//     malformed arm on its own path first as its PRECONDITION (today: 400, the object unreached, nothing written), and a
//     valid id's decision there with its render offers (the late refusal's conditions hold in the fixture).
//   2 The malformed ids: the empty string; a space alone; spaces inside (the live walker's id, R-P541); a comma
//     (`pdp,COA-CH857`); a slash (the page's path, `/products/tabby-shoulder-bag-26`); 129 characters of the admitted
//     alphabet (length the only defect). On the GET each is the query's pageInstance, URL-encoded.
//   3 The 129-character id on the POST and at the door: today the allow-list's generic 128-character bound refuses it 401
//     before isEventNonce could; PI1 demands 400 'Invalid page instance' for it on every path, so the page-view id's bound is
//     its own check's (as the nothing-to-show report's and the context signals' are, :1022–1024).
//   4 PI1's "any decision request": a shopper refusing tracking and a page with no rendered-v1 slot (`home`) are refused
//     too — the late refusal's conditions are today's defect, not the remedy's scope.
//   5 Not pinned either way: a non-string pageInstance in the POST body (PI1 reads strings; today the allow-list's 401); a
//     request carrying a malformed pageInstance beside another malformed field (no order is ruled; every refusal here is
//     measured alone, its other fields valid); Cache-Control on the session-carrying refusals (PI1 names it at the door).
//   6 PI2's SDK ids: a UUID (crypto.randomUUID: the browser host with it, the server bridge, src/sdk/server.ts:165) and the
//     base-36 fallback, both drawn from the REAL `browserHost().uuid()` (src/sdk/host.ts:34–36; loaded at run time, it is
//     outside the app typecheck), the fallback with `crypto` stubbed away for that one synchronous call only; a
//     128-character id is every admitted character twice. "Acknowledgement admitted": the content_impression is answered 200
//     with its render receipt naming the id, and the ledger row of that decision carries `rendered.pageInstance` = the id.
//     The same session's valid decision after a malformed one gets its offers (the diagnosis's T1).
//   7 PI2's "the door's other refusals stay 401": an identity field, an unknown key, a query on the POST, a 129-character
//     `page`, a malformed entry, nothing-to-show report, context-signal name and consent hint — each 401 'Shopper session
//     unavailable' writing nothing (P13's door rule, P80.AS3's R-P264 leg); the malformed arm stays 400 (P84.CO3).
//   8 PI3 pins the facts in kit 02's pageInstance row of the POST snapshot section, not its words: 1 to 128, letters, digits,
//     `_` and `-` (or the class A-Za-z0-9_-), a UUID qualifying, 400 'Invalid page instance', the first request named.
//   9 PI3, R-P590 (the residual of a6690521 ruled IN): kit 02's first-request paragraph (:337, "**A new visitor's first
//     request.**") names the refusals answered 400 there — a malformed `arm` member and a malformed page-view id — and 401
//     for every other failure, and none of its sentences still says any failure is 401. The facts, not the words, sentence by
//     sentence as P97.FV4 splits the paragraph, so they hold beside the sentences P97 rewrites in it (rem/p97-build c54f1524).
//
// DEFERRED: LV1 (lane L21, the pair's next release, the stamps read-only: on both pair hosts a session-carrying decision
// with a spaced pageInstance 400 'Invalid page instance', the same with a UUID 200 with its offers, a first request with a
// spaced id 400 with no session).
// RESIDUALS (told, not pinned): the diagnosis's OUT OF SCOPE 1 and 2 (snapshotContext's 401
// for an unknown key or another field over 128 characters; redeemRenderOffer's 401 for every acknowledgement mismatch) are
// other request errors answered as session failures, outside E26; its T5 (clean ids around a rotation) is P95's.
//
// MEASURED (_evidence/parity-step3/S46/specifier/logs/, serial, --no-cache, one worker, the tree its working directory and
// root; trees under scratch/ built by mk.sh from 99ddcafc, edits in sketches/apply.cjs): today 7 RED for the missing
// behaviour — the six PI1 legs (the POST and the GET: 401 'Shopper session unavailable' with the object reached and the
// decision's writes made, or 200 with the decision made for the empty id, a shopper refusing tracking and the home page;
// the door: 200 with a session issued, a shopper object created and the decision made, 401 for 129 characters) and PI3
// (the row states nothing of the format) — and the six PI2 lock legs green (a2-today). THE SKETCH — src/routes/decisions.ts:
// isEventNonce imported (src/events/actionTypes.ts, unchanged); `class InvalidPageInstance extends Error {}` beside
// InvalidArmMember (:925); snapshotContext refuses `pageInstance !== undefined && !isEventNonce(pageInstance)` on the GET
// after the arm (:995) and on the POST after the arm (:1035), the allow-list's generic 128 bound leaving `pageInstance` to
// that check (:1024, `key !== 'pageInstance'` beside `nothingToShow`); 400 { ok: false, error: 'Invalid page instance' } in
// the route's two catches (:1226, :1238) and at the door with Cache-Control no-store (:1132); kit 02 :342 one sentence —
// 13/13 three times (b1-sketch-1..3). THE WRONG FIXES, each RED on its own legs (c-*): the check on the POST only — PI1's
// two GET legs; on the GET only — PI1's POST and door legs; the door's catch left as today — PI1's door legs (401); the 401
// kept (SessionAccessError thrown early) — PI1 6; the refusal after the work (the mint's 401 caught around the decision and
// answered 400) — PI1 6 (the object reached, the writes made, 200 for the empty id, a shopper refusing tracking, the home
// page and at the door); the check in the handler inside the shopper's object — PI1 6 (400, but the object reached and,
// at the door, a session issued and the object created); a UUID-only rule — PI2's valid-id and door legs; the id made
// required — PI2's absent-id rows; the allow-list's 128 bound left in front — PI1's POST and door legs (129 characters 401);
// a truthiness guard admitting the empty id — PI1 6; the door answering every typed request error 400 — PI2's door legs;
// the kit left as today, the format without the refusal, the refusal without the first request — PI3. LOCKS (d-locks-*):
// P03, P13, P31, P34, P56, P57, P58, P69, P76, P80, P84, P95, P96, W38 (FIX1, LEDGER), src/routes/realtime.sdkContract
// .test.ts and src/index.api-boundary.test.ts, 17 files 448/448 on today and 448/448 on the sketch. R-P590 (reading 9; logs
// m-*): today RED on the paragraph's four facts; the sketch with kit 02 :337's clause "any failure is `401` and writes
// nothing" made "a malformed `arm` member is refused `400` `Invalid arm member` and a malformed `pageInstance` `400`
// `Invalid page instance`, and any other failure `401`, each writing nothing" green, and green on a scratch merge of
// rem/p97-build c54f1524 with the P101 sketch and that edit; the paragraph naming the 400s beside a kept "any failure is
// `401`", or naming the arm's 400 alone, RED.
//
// NO NEW EXPORT IS IMPORTED. HARNESS: src/units/_parity.ts (the mounted routes over the real ShopperReflex, DecisionRing
// and LearnStats classes, either shopper host). Imports from src/units/: ../_parity.

import { describe, expect, it, vi } from 'vitest';

import { SHOPPER_HEADER } from '@/identity/sessionCapability';

import {
  BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, readTree, shopperOn, storedDecisions, TENANT,
  type Decision, type Mounted, type Shopper, type Snapshot,
} from '../_parity';

/** The product page: the declared layout slot measured on rendered-v1 (learnDocument), no holdout. */
const DOCS = { pieces: MODULES, slots: declaredSlots([layoutSlot()]), learn: learnDocument() };
const SNAPSHOT = `/v1/${TENANT}/decisions/snapshot`;
const REFUSED = { ok: false, error: 'Invalid page instance' };
const SESSION_REFUSED = { ok: false, error: 'Shopper session unavailable' };
const ARM_REFUSED = { ok: false, error: 'Invalid arm member' };
/** Every character isEventNonce admits (src/events/actionTypes.ts:45–46), once. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
/** Two 128-character ids of the admitted alphabet, every character in each. */
const LONGEST = ALPHABET + ALPHABET;
const LONGEST_REVERSED = [...LONGEST].reverse().join('');

/** PI1's malformed ids (reading 2). */
const MALFORMED: ReadonlyArray<readonly [string, string]> = [
  ['the empty string', ''],
  ['a space alone', ' '],
  ['spaces inside (the live walker\'s id)', 'l20-p95-after the rotation-3e206dc7'],
  ['a comma', 'pdp,COA-CH857'],
  ['a slash (the page\'s path)', '/products/tabby-shoulder-bag-26'],
  ['129 characters', `${LONGEST}x`],
];

/** Counts the calls that reach a shopper's own object, where every decision is made (the namespace's `get` is wrapped once). */
function ownerCalls(m: Mounted): () => number {
  const ns = m.env.SHOPPER_REFLEX as unknown as { get: (id: unknown) => { fetch: (input: unknown, init?: unknown) => Promise<Response> } };
  const realGet = ns.get;
  let calls = 0;
  ns.get = (id: unknown) => {
    const stub = realGet(id);
    return { fetch: (input: unknown, init?: unknown) => { calls++; return stub.fetch(input, init); } };
  };
  return () => calls;
}
/** Every value the mount holds: the bucket, both KV namespaces, every object's storage and the ledger queue. */
const everything = (m: Mounted) => JSON.stringify([[...m.storage.objects.entries()], [...m.cache.data.entries()],
  [...(m.env.SESSIONS as unknown as { data: Map<string, unknown> }).data.entries()],
  ...[m.shoppers, m.rings, m.stats].map(registry => [...registry.entries()].map(([name, item]) => [name, [...item.data.entries()]])), m.queued]);

interface Asked { status: number; body: Record<string, unknown>; cacheControl: string | null; owner: number; written: string; shoppersCreated: number }
/** One decision request through the mounted routes: a GET (fields on the query) or a POST (fields as the JSON body). */
async function decide(m: Mounted, owner: () => number, how: { method: 'GET' | 'POST'; capability?: string; fields: Record<string, string>; search?: string }): Promise<Asked> {
  await m.drain();
  const calls = owner(), held = everything(m), shoppers = m.shoppers.size;
  const query = how.method === 'GET' ? `?${new URLSearchParams(how.fields).toString()}` : how.search ?? '';
  const response = await m.fetch(new Request(`https://shop.invalid${SNAPSHOT}${query}`, { method: how.method,
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...(how.capability ? { [SHOPPER_HEADER]: how.capability } : {}) },
    ...(how.method === 'POST' ? { body: JSON.stringify(how.fields) } : {}) }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body, cacheControl: response.headers.get('Cache-Control'), owner: owner() - calls,
    written: everything(m) === held ? 'nothing written' : 'written', shoppersCreated: m.shoppers.size - shoppers };
}
const decisionsOf = (asked: { body: Record<string, unknown> }) => (asked.body.decisions ?? []) as Decision[];
/** 'every decision offered' when the answer carries decisions and each carries a render offer; else what it carries. */
const offered = (asked: { body: Record<string, unknown> }) => {
  const decisions = decisionsOf(asked);
  return decisions.length > 0 && decisions.every(d => typeof d.renderOffer === 'string') ? 'every decision offered'
    : `${decisions.filter(d => typeof d.renderOffer === 'string').length} of ${decisions.length} offered`;
};
/** A refusal's body as it is; an answer carrying decisions, summarized (its decisions, render offers and issued session). */
const answerOf = (body: Record<string, unknown>): unknown => !Array.isArray(body.decisions) ? body
  : `answered: ${body.decisions.length} decisions, ${(body.decisions as Decision[]).filter(d => typeof d.renderOffer === 'string').length} render offers${body.session ? ', a session issued' : ''}`;
const shown = (asked: Asked) => `${asked.status} ${JSON.stringify(asked.body).slice(0, 160)}`;

/** The SDK's own page-view ids, from the real browser host (reading 6): its UUID and its fallback where crypto.randomUUID is absent. */
async function sdkIds(): Promise<{ uuid: string; fallback: string }> {
  const entry = '@/sdk/' + 'host';
  const { browserHost } = await import(/* @vite-ignore */ entry) as { browserHost(): { uuid(): string } };
  const host = browserHost();
  const uuid = host.uuid();
  vi.stubGlobal('crypto', {});
  let fallback = '';
  try { fallback = host.uuid(); } finally { vi.unstubAllGlobals(); }
  expect([/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid), /^[0-9a-z]+$/.test(fallback), typeof crypto.randomUUID],
    `PRECONDITION: the browser host draws a UUID, and its fallback branch a base-36 id (${uuid}, ${fallback}), crypto restored`).toEqual([true, true, 'function']);
  return { uuid, fallback };
}

/** The mounted product page with a shopper allowing tracking, one refusing it, and the owner counter. */
async function world(host: (typeof HOSTS)[number], what: string) {
  const m = await mount(host, DOCS);
  expectPublished(m, `${what} — the product page publishes`);
  const owner = ownerCalls(m);
  const s = await shopperOn(m);
  const refusing = await shopperOn(m, { tracking: false, personalization: false });
  return { m, owner, s, refusing };
}
const pdp = (pageInstance?: string, extra: Record<string, string> = {}) =>
  ({ page: 'pdp', brand: BRAND, ...(pageInstance === undefined ? {} : { pageInstance }), ...extra });

// ===========================================================================
// unit:P101.PI1 — a malformed page-view id refused 400 'Invalid page instance' before any work, on every decision path
// ===========================================================================

describe('unit:P101.PI1 (E26)', () => {
  for (const host of HOSTS) {
    for (const method of ['POST', 'GET'] as const) {
      it(`host (${host}): the ${method} with a session — each malformed pageInstance (the empty string, a space alone, spaces inside, a comma, a slash, 129 characters) answers 400 { ok: false, error: 'Invalid page instance' } before any work, as a malformed arm is refused there: the shopper's own object never reached, nothing written (no decision, no ledger or ring capture, no render offer), for a shopper allowing tracking on the product page, one refusing tracking, and on a page with no rendered-v1 slot`, async () => {
        const { m, owner, s, refusing } = await world(host, 'P101.PI1');
        const valid = await decide(m, owner, { method, capability: s.grant.capability, fields: pdp(crypto.randomUUID()) });
        expect([valid.status, offered(valid), valid.owner > 0], `${host}: PRECONDITION — a valid id's ${method} decision is made in the shopper's own object, with its render offers (${shown(valid)})`)
          .toEqual([200, 'every decision offered', true]);
        const arm = await decide(m, owner, { method, capability: s.grant.capability, fields: pdp(crypto.randomUUID(), { arm: 'not json' }) });
        expect([arm.status, answerOf(arm.body), arm.owner, arm.written], `${host}: PRECONDITION — the reference: a malformed arm on the ${method} is refused before any work (${shown(arm)})`)
          .toEqual([400, ARM_REFUSED, 0, 'nothing written']);
        const rows: Array<[string, string, number, unknown, number, string]> = [];
        for (const [who, capability, page] of [['allowing tracking, product page', s.grant.capability, 'pdp'], ['refusing tracking, product page', refusing.grant.capability, 'pdp'],
          ['allowing tracking, a page with no rendered-v1 slot', s.grant.capability, 'home']] as const) {
          for (const [label, id] of MALFORMED) {
            const asked = await decide(m, owner, { method, capability, fields: { ...pdp(id), page } });
            rows.push([who, label, asked.status, answerOf(asked.body), asked.owner, asked.written]);
          }
        }
        expect.soft(rows, `${host}: P101.PI1 — the ${method} refuses a malformed page-view id 400 'Invalid page instance' before any work, as it refuses a malformed arm (today 401 'Shopper session unavailable' after the decision's work, or 200 with the decision made)`)
          .toEqual(rows.map(([who, label]) => [who, label, 400, REFUSED, 0, 'nothing written']));
      }, 120_000);
    }

    it(`host (${host}): the first-request door (a POST with no session) — each malformed pageInstance answers 400 { ok: false, error: 'Invalid page instance' } with Cache-Control no-store before a session is issued or a shopper object created, as a malformed arm is refused there: no session member, no object reached or created, nothing written`, async () => {
      const { m, owner } = await world(host, 'P101.PI1');
      const valid = await decide(m, owner, { method: 'POST', fields: pdp(crypto.randomUUID()) });
      expect([valid.status, typeof (valid.body.session as { capability?: unknown } | undefined)?.capability, valid.shoppersCreated],
        `${host}: PRECONDITION — a valid id's first request is issued its session and its shopper object (${shown(valid)})`).toEqual([200, 'string', 1]);
      const arm = await decide(m, owner, { method: 'POST', fields: pdp(crypto.randomUUID(), { arm: 'not json' }) });
      expect([arm.status, answerOf(arm.body), arm.cacheControl, arm.shoppersCreated, arm.owner, arm.written],
        `${host}: PRECONDITION — the reference: a malformed arm at the door is refused before anything is issued (${shown(arm)})`).toEqual([400, ARM_REFUSED, 'no-store', 0, 0, 'nothing written']);
      const rows: Array<[string, number, unknown, string | null, number, number, string]> = [];
      for (const [label, id] of MALFORMED) {
        const asked = await decide(m, owner, { method: 'POST', fields: pdp(id) });
        rows.push([label, asked.status, answerOf(asked.body), asked.cacheControl, asked.shoppersCreated, asked.owner, asked.written]);
      }
      expect.soft(rows, `${host}: P101.PI1 — the door refuses a malformed page-view id 400 'Invalid page instance', no-store, before a session is issued or a shopper object created (today 200 with a session issued and the decision made, or 401 for 129 characters)`)
        .toEqual(rows.map(([label]) => [label, 400, REFUSED, 'no-store', 0, 0, 'nothing written']));
    }, 120_000);
  }
});

// ===========================================================================
// unit:P101.PI2 — LOCK: a valid id, an absent one, the other request errors and the door's other refusals as today
// ===========================================================================

/** The render acknowledgement of a decision the page painted, and the ledger row it lands on. */
async function acknowledged(m: Mounted, s: Shopper, snapshot: Snapshot): Promise<[number, unknown, unknown]> {
  const d = snapshot.decisions.find(x => typeof x.renderOffer === 'string');
  if (!d) return [0, 'no decision offered', 'no decision offered'];
  const ack = await s.ack(snapshot, d);
  await m.drainLedger();
  const row = storedDecisions(m, s.subject).find(r => r.decision_id === d.decisionId && r.rendered);
  return [ack.status, (ack.body.render as { pageInstance?: unknown } | undefined)?.pageInstance ?? `no render receipt: ${JSON.stringify(ack.body).slice(0, 160)}`,
    row?.rendered?.pageInstance ?? 'no rendered ledger row'];
}

describe('unit:P101.PI2 (E26; LOCK)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — valid ids behave as today on the POST and the GET with a session: the SDK's UUID and its base-36 fallback (the real browser host's) and two 128-character ids of A-Za-z0-9_- each get the page's render offers, the id echoed, and the acknowledgement of a painted decision is admitted (200, its render receipt and its ledger row naming the id), after a malformed id in the same session; a request with no pageInstance answers 200 with no render offer`, async () => {
      const { m, owner, s } = await world(host, 'P101.PI2');
      const [forPost, forGet] = [await sdkIds(), await sdkIds()];
      await decide(m, owner, { method: 'POST', capability: s.grant.capability, fields: pdp('l20-p95-after the rotation-3e206dc7') });
      const named = (id: unknown, sent: string) => id === sent ? 'the id' : id ?? null;
      const rows: Array<[string, string, number, unknown, string, number, unknown, unknown]> = [];
      for (const [method, kinds] of [['POST', [['the SDK\'s UUID', forPost.uuid], ['the SDK\'s fallback', forPost.fallback], ['128 characters', LONGEST]]],
        ['GET', [['the SDK\'s UUID', forGet.uuid], ['the SDK\'s fallback', forGet.fallback], ['128 characters', LONGEST_REVERSED]]]] as const) {
        for (const [kind, id] of kinds) {
          const asked = await decide(m, owner, { method, capability: s.grant.capability, fields: pdp(id) });
          const [ackStatus, receipt, ledger] = await acknowledged(m, s, { status: asked.status, body: asked.body, page: 'pdp', pageInstance: id, decisions: decisionsOf(asked) });
          rows.push([method, kind, asked.status, named(asked.body.pageInstance, id), offered(asked), ackStatus, named(receipt, id), named(ledger, id)]);
        }
      }
      expect.soft(rows, `${host}: P101.PI2 — LOCK: every valid id is answered 200, echoed, with its render offers, and its acknowledgement admitted (render receipt and ledger row naming it), as today`)
        .toEqual(rows.map(([method, kind]) => [method, kind, 200, 'the id', 'every decision offered', 200, 'the id', 'the id']));
      const absent: Array<[string, number, number, boolean]> = [];
      for (const method of ['POST', 'GET'] as const) {
        const asked = await decide(m, owner, { method, capability: s.grant.capability, fields: pdp() });
        absent.push([method, asked.status, decisionsOf(asked).filter(d => typeof d.renderOffer === 'string').length, decisionsOf(asked).length > 0]);
      }
      expect.soft(absent, `${host}: P101.PI2 — LOCK: a request with no pageInstance answers 200 with its decisions and no render offer (decisions.ts:1312)`)
        .toEqual([['POST', 200, 0, true], ['GET', 200, 0, true]]);
    }, 120_000);

    it(`host (${host}): LOCK — the five other request errors keep their answers on the POST and the GET with a session, a valid pageInstance beside them: a malformed entry 400 'Invalid entry context', nothing-to-show report 400 'Invalid nothing-to-show report', arm 400 'Invalid arm member', context-signal name 400 'Invalid context signal name', consent hint 400 'Invalid consent hint'`, async () => {
      const { m, owner, s } = await world(host, 'P101.PI2');
      const cases: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
        ['a malformed entry', { entry: 'not json' }, 'Invalid entry context'],
        ['a malformed nothing-to-show report', { nothingToShow: 'not json' }, 'Invalid nothing-to-show report'],
        ['a malformed arm', { arm: 'not json' }, 'Invalid arm member'],
        ['a context signal whose name starts with a digit', { 'ctx.9lives': 'black' }, 'Invalid context signal name'],
        ['a consent hint that is not true or false', { trackingConsent: 'yes' }, 'Invalid consent hint'],
      ];
      const rows: Array<[string, string, number, unknown]> = [];
      for (const method of ['POST', 'GET'] as const) for (const [label, fields] of cases) {
        const asked = await decide(m, owner, { method, capability: s.grant.capability, fields: pdp(crypto.randomUUID(), fields) });
        rows.push([method, label, asked.status, answerOf(asked.body)]);
      }
      expect.soft(rows, `${host}: P101.PI2 — LOCK: each other request error keeps its own 400 (decisions.ts:1221–1242)`)
        .toEqual(rows.map(([method, label]) => [method, label, 400, { ok: false, error: cases.find(c => c[0] === label)![2] }]));
    }, 120_000);

    it(`host (${host}): LOCK — the first-request door as today: a UUID, a 128-character id and no pageInstance are each issued a session and answered 200 (the id echoed); its other refusals stay 401 'Shopper session unavailable' writing nothing (an identity field, an unknown key, a query on the POST, a 129-character page, a malformed entry, nothing-to-show report, context-signal name, consent hint), and a malformed arm stays 400 'Invalid arm member'`, async () => {
      const { m, owner } = await world(host, 'P101.PI2');
      const issued: Array<[string, number, string, unknown]> = [];
      for (const [label, id] of [['a UUID', crypto.randomUUID()], ['128 characters', LONGEST], ['no pageInstance', undefined]] as const) {
        const asked = await decide(m, owner, { method: 'POST', fields: pdp(id) });
        issued.push([label, asked.status, typeof (asked.body.session as { capability?: unknown } | undefined)?.capability,
          id === undefined ? 'no id sent' : asked.body.pageInstance === id ? 'the id' : asked.body.pageInstance ?? null]);
      }
      expect.soft(issued, `${host}: P101.PI2 — LOCK: a valid or absent id's first request is issued its session, a valid id echoed (P13.H4)`)
        .toEqual([['a UUID', 200, 'string', 'the id'], ['128 characters', 200, 'string', 'the id'], ['no pageInstance', 200, 'string', 'no id sent']]);
      const refusals: ReadonlyArray<readonly [string, Record<string, string>, string?]> = [
        ['an identity field', pdp(crypto.randomUUID(), { visitorId: 'vis-00000000-0000-4000-8000-000000000000' })],
        ['an unknown key', pdp(crypto.randomUUID(), { colour: 'black' })],
        ['a query on the POST', pdp(crypto.randomUUID()), '?page=pdp'],
        ['a 129-character page', { ...pdp(crypto.randomUUID()), page: `${LONGEST}x` }],
        ['a malformed entry', pdp(crypto.randomUUID(), { entry: 'not json' })],
        ['a malformed nothing-to-show report', pdp(crypto.randomUUID(), { nothingToShow: 'not json' })],
        ['a context signal whose name starts with a digit', pdp(crypto.randomUUID(), { 'ctx.9lives': 'black' })],
        ['a consent hint that is not true or false', pdp(crypto.randomUUID(), { trackingConsent: 'yes' })],
      ];
      const rows: Array<[string, number, unknown, number, string]> = [];
      for (const [label, fields, search] of refusals) {
        const asked = await decide(m, owner, { method: 'POST', fields, ...(search ? { search } : {}) });
        rows.push([label, asked.status, answerOf(asked.body), asked.shoppersCreated, asked.written]);
      }
      const arm = await decide(m, owner, { method: 'POST', fields: pdp(crypto.randomUUID(), { arm: 'not json' }) });
      rows.push(['a malformed arm', arm.status, answerOf(arm.body), arm.shoppersCreated, arm.written]);
      expect.soft(rows, `${host}: P101.PI2 — LOCK: the door's other refusals stay 401 writing nothing; the malformed arm stays 400 (decisions.ts:1126–1134)`)
        .toEqual(rows.map(([label]) => label === 'a malformed arm' ? [label, 400, ARM_REFUSED, 0, 'nothing written'] : [label, 401, SESSION_REFUSED, 0, 'nothing written']));
    }, 120_000);
  }
});

// ===========================================================================
// unit:P101.PI3 — kit 02's pageInstance row states the format and the 400
// ===========================================================================

describe('unit:P101.PI3 (E26)', () => {
  it('logic: kit 02\'s pageInstance row in the POST /v1/{tenant}/decisions/snapshot section states the format — 1 to 128 letters, digits, `_` and `-` (a UUID qualifies) — and the 400 `Invalid page instance` for any other value on every decision path, a new visitor\'s first request named', () => {
    const kit = readTree('docs/kit/02-api-reference.md');
    const start = kit.indexOf('### `POST /v1/{tenant}/decisions/snapshot`');
    const section = start < 0 ? '' : kit.slice(start, kit.indexOf('\n### ', start + 1) < 0 ? undefined : kit.indexOf('\n### ', start + 1));
    const rows = section.split('\n').filter(line => line.startsWith('| `pageInstance` |'));
    expect(rows.length, 'PRECONDITION: the POST snapshot section has one pageInstance row (docs/kit/02-api-reference.md:342)').toBe(1);
    const row = rows[0]!;
    const facts = {
      bound: /\b1\s*(?:to|–|-)\s*128\b/.test(row) || row.includes('{1,128}'),
      alphabet: row.includes('A-Za-z0-9_-') || (/\bletters\b/i.test(row) && /\bdigits\b/i.test(row) && /(?:^|[\s`(,])_(?=[\s`),]|$)/.test(row) && /(?:^|[\s`(,])-(?=[\s`),.]|$)/.test(row)),
      uuid: /\bUUID\b/.test(row),
      refusal: /\b400\b/.test(row) && row.includes('Invalid page instance'),
      firstRequest: /\bfirst request\b/i.test(row),
    };
    expect.soft(facts, `P101.PI3 — the row states the format and the refusal (today: "${row}")`)
      .toEqual({ bound: true, alphabet: true, uuid: true, refusal: true, firstRequest: true });
  });

  it('logic: R-P590 — kit 02\'s first-request paragraph names the refusals answered 400 on a new visitor\'s first request (a malformed `arm` member, a malformed page-view id) and 401 for every other failure, and no sentence of it still says any failure is 401 (facts, not words, holding beside the sentences P97 rewrites in the paragraph)', () => {
    const paragraph = readTree('docs/kit/02-api-reference.md').split(/\n\s*\n/).map(p => p.split('\n').join(' '))
      .find(p => p.startsWith('**A new visitor\'s first request.**')) ?? '';
    expect(paragraph.length > 0, 'PRECONDITION: kit 02 carries the first-request paragraph (docs/kit/02-api-reference.md:337)').toBe(true);
    /** Sentence by sentence, as P97.FV4 splits the same paragraph. */
    const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z*`])/);
    const facts = {
      arm400: sentences.some(s => /\b400\b/.test(s) && /`arm`|\barm member\b|Invalid arm member/i.test(s)),
      pageInstance400: sentences.some(s => /\b400\b/.test(s) && /`pageInstance`|\bpage-view id\b|\bpage instance\b/i.test(s)),
      rest401: sentences.some(s => /\b401\b/.test(s) && /\b(?:any|every|all) other\b|\botherwise\b|\bthe rest\b|\belse\b/i.test(s)),
      noBlanket401: !sentences.some(s => /\b401\b/.test(s) && /\b(?:any|every|all)\s+(?:failures?|refusals?|errors?)\b/i.test(s)),
    };
    expect.soft(facts, `P101.PI3 — the first-request paragraph names its 400 refusals (a malformed arm, a malformed page-view id) and 401 for the rest (today: "${sentences.filter(s => /\b401\b/.test(s)).join(' ').slice(0, 400)}")`)
      .toEqual({ arm400: true, pageInstance400: true, rest401: true, noBlanket401: true });
  });
});
