// src/units/P13/LEDGER.unit.test.ts
// P13 under the Closure Ledger: the tests for the LOCAL criteria of the P13 work
// order (`tapestry-parity-build`, ticket P13 "The identifier handshake"). DC1 and
// DC2 (decisions D1, D2) are ruled here and exercised inside H1-H5; LV1 and LV2
// are deferred live rows and get no test. The backend handshake specification is
// outside this ticket's boundary (D2, freeze item 46) and gets no test.
//
// One `describe('unit:P13.<criterion> …')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P13 in section B): "the
//     SDK exposes a loaded hook; Tapestry's hashed identifier can be passed
//     before recognition, so both identifiers travel together; the signed link
//     at recognition merges; the first decision is served on the first request
//     without a separate round trip for the session"; parity §6 ("The engine
//     issues the visitor identity itself, at the edge, on that first request…
//     Nothing waits."), cited by number only;
//   · freeze sheet item 15 (D1: the engine side built now, the customer's
//     identifier carried but never treated as proof; D2: the backend
//     specification written alongside) and item 46 (the specification is outside
//     the write boundary, its review the live row). Both UNANSWERED at the
//     freeze: every unit names them (R-P15);
//   · the investigation, section G-C ("Round trips": two sequential calls,
//     session then snapshot, before the first decision; design question 6, "the
//     snapshot mints the session (P13)");
//   · P12's representation on rem/spec-parity-c (acb06fc2, read per R-P16): the
//     customer's hashed identifier is the account identifier `accountId` of the
//     backend-signed link POST /v1/:tenant/identity/link; a merge adds the
//     decayed evidence of both profiles (src/reflex/identityMerge.ts);
//   · the existing contract: src/sdk/server.ts (the bridge mints the session,
//     then asks for the snapshot), src/sdk/core.ts (the SDK readies the session
//     before any decision), src/sdk/identify.ts (identify always links).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   H1  The SDK's shared core (`createCore`, src/sdk/core.ts, which `createClient`
//       wires and exposes as `client.core`) offers `onLoaded(callback)`: the
//       callback runs once when the client has
//       loaded (its first readiness), and once, at the next turn, when it is
//       registered after that; a callback that throws changes nothing of the
//       client's own state.
//   H2  The page passes the customer's hashed identifier before recognition with
//       `core.setCustomerId(id)`; from then on every action envelope and every
//       decision request the SDK sends carries it as `customerId`, and the
//       records the engine writes from them under tracking consent carry it as
//       `customer_id` beside `visitor_id`. It is never proof: it links nothing,
//       merges nothing, issues no recognised session and selects no other
//       shopper's state, even when an account is linked under the same value.
//   H3  At recognition the link (P12's) merges as it does today, and its answer
//       names the identifier carried before it as `customerId`: the value the
//       page carried, which need not be the linked account identifier (the
//       fixture carries a value other than the `accountId` it links, so an
//       answer echoing the link's own account cannot pass; R-P38).
//   H4  A decision request from a new visitor without a session (no
//       X-Shopper-Session) is answered with the first decision set and the
//       issued session as `session` (the shape POST /identity/session answers);
//       the SDK and the server bridge then make one call, not two.
//   H5  The kit names `onLoaded`, `setCustomerId` and the first-request path.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `onLoaded` and `setCustomerId` on the SDK core, `customerId` on the wire,
// `customer_id` on the records, `customerId` on the link answer, `session` on the
// decision answer. No new export is imported.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts) and
// src/units/_parity3.ts (carried byte-for-byte from rem/spec-parity-c 1b681687:
// the identity routes mounted beside it, the tenant's identity material). The
// SDK legs drive the real `src/sdk/core`, `src/sdk/listen` and `src/sdk/server`
// entries over the repository's test host (the app typecheck cannot hold
// `src/sdk/index`, whose browser host needs the DOM library; P12, P31 and P03 do
// the same).

import { describe, expect, it } from 'vitest';

import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { createCore } from '@/sdk/core';
import { createListen } from '@/sdk/listen';
import { createServerBridge } from '@/sdk/server';
import { syntheticSession, testHost } from '@/sdk/testHost';

import {
  BRAND, expectPublished, HOSTS, learnDocument, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY, pageInstanceOf, readTree, recentSlot, shopperOn,
  storedDecisions, storedOutcomes, TENANT, VIEW_TABBY_26, VIEW_TABBY_WALLET, type Mounted, type Shopper,
} from '../_parity';
import { hmacOf, identityDoor, identitySecretOf, sha256Hex, type IdentityDoor } from '../_parity3';
// R-P67 as amended (fix round 1, round 3): the H4 refused-tracking locks also read P07's block and population
// through src/units/_parity2.ts (the REGION_TREND namespace on the real RegionTrend class), byte-identical.
import { receiptsOf, slotPositionOf, VIEW_TABBY_QUILTED } from '../_parity';
import { bindTrend, publishTrends, trendStorageText } from '../_parity2';

const K = 1.8;
const aff = (r: number) => r / (r + K);
/** A page with the pinned recently-viewed slot and a story slot: no layout declaration, so no P02 precondition. */
const STORY = 'pdp-story';
const PIECES = [...MODULES, { id: 'story.tabby', customerContentId: 'TAP-STORY-TABBY', type: 'editorial', title: 'The Tabby story', tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' } }];
const SLOTS = { version: 'parity-p13-slots', governanceVersion: 3, pages: { pdp: [{ slot: STORY, take: 1, weights: { line: 1 } }, recentSlot()] } };
const LEARN = learnDocument({ [STORY]: { measurementBasis: 'rendered-v1', reward: 'click' } });
const documents = { pieces: PIECES, slots: SLOTS, learn: LEARN };

let HASHED = '';
const hashed = async () => (HASHED = await sha256Hex('jordan.lee@example.com'));

/** The backend-signed link of one browser, as src/identity/assertion.ts verifies it (P12's helper). */
async function link(m: Mounted, door: IdentityDoor, s: Shopper, accountId: string) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const assertion = await hmacOf(identitySecretOf(m), `${TENANT}\n${s.subject}\n${accountId}\n${exp}`);
  return door.call(`/v1/${TENANT}/identity/link`, s.grant.capability, { visitorId: s.subject, accountId, source: 'login', exp, assertion });
}
type Dims = Record<string, Record<string, number>>;
async function profileOf(door: IdentityDoor, capability: string, what: string): Promise<Dims> {
  const read = await door.call('/realtime/reflex', capability);
  expect(read.status, `PRECONDITION: ${what}'s profile reads (${JSON.stringify(read.body).slice(0, 200)})`).toBe(200);
  return ((read.body.affinity as { dims?: Dims } | null)?.dims ?? {});
}
/** A wire call as the SDK sends it once the page has passed the identifier: the action envelope or the decision request carries `customerId`. */
async function carrying(m: Mounted, s: Shopper, path: string, body: Record<string, unknown>) {
  const response = await m.fetch(new Request(`https://shop.invalid${path}`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, customerId: HASHED }) }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}
const actionCarrying = (m: Mounted, s: Shopper, event: { type: string; data: Record<string, unknown> }) =>
  carrying(m, s, '/realtime/action', { ...event, source: 'sdk', userId: s.subject, sessionId: s.grant.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() });

// ===========================================================================
// unit:P13.H1 — the loaded hook
// ===========================================================================

describe('unit:P13.H1 (freeze item 15)', () => {
  it('sdk: a loaded hook registered before loading runs exactly once when the client has loaded, one registered after runs once, and a hook that throws changes nothing of the client', async () => {
    const f = testHost();
    const core = createCore({ tenant: 'coach', source: 'coach-pdp' }, f.host);
    const onLoaded = (core as unknown as Record<string, unknown>).onLoaded as ((fn: () => void) => unknown) | undefined;
    expect(typeof onLoaded, 'P13.H1 — the SDK offers onLoaded(callback)').toBe('function');
    let before = 0, after = 0, later = 0;
    onLoaded!.call(core, () => { before++; });
    onLoaded!.call(core, () => { throw new Error('the page’s own hook failed'); });
    expect(await core.ready(), 'PRECONDITION: the client loads').toBe(true);
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
    const state = { visitorId: core.visitorId, sessionId: core.sessionId, consent: JSON.stringify(core.consent) };
    onLoaded!.call(core, () => { after++; });
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
    expect(await core.ready(), 'P13.H1 — the client is still ready after a hook threw').toBe(true);
    onLoaded!.call(core, () => { later++; });
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
    expect([before, after, later], 'P13.H1 — each hook ran exactly once').toEqual([1, 1, 1]);
    expect({ visitorId: core.visitorId, sessionId: core.sessionId, consent: JSON.stringify(core.consent) }, 'P13.H1 — the throwing hook changed nothing of the client').toEqual(state);
  });
});

// ===========================================================================
// unit:P13.H2 — the identifier travels beside the visitor's, and is never proof
// ===========================================================================

describe('unit:P13.H2 (freeze item 15)', () => {
  it('sdk: after setCustomerId the SDK sends the identifier on every action envelope and every decision request', async () => {
    await hashed();
    const f = testHost({ responses: (url) => url.includes('/decisions/snapshot') ? { ok: true, tenant: 'coach', page: 'pdp', decisions: [] } : { success: true } });
    const core = createCore({ tenant: 'coach', source: 'coach-pdp' }, f.host);
    const listen = createListen(core);
    expect(await core.ready(), 'PRECONDITION: the client loads').toBe(true);
    const set = (core as unknown as Record<string, unknown>).setCustomerId as ((id: string) => unknown) | undefined;
    expect(typeof set, 'P13.H2 — the SDK offers setCustomerId(id)').toBe('function');
    set!.call(core, HASHED);
    await listen.hydrate({ page: 'pdp' });
    await core.send('product_view', { productId: 'COA-CH857', line: 'Tabby' });
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
    const sent = f.calls.filter(c => c.url.endsWith('/action') || c.url.includes('/decisions/snapshot')).map(c => [c.url.includes('/decisions/snapshot') ? 'decision request' : 'action', (JSON.parse(c.init?.body ?? '{}') as Record<string, unknown>).customerId ?? null]);
    expect(sent.length, 'PRECONDITION: the SDK asked for decisions and sent the action').toBeGreaterThanOrEqual(2);
    expect(sent, 'P13.H2 — every envelope and every decision request carries the identifier').toEqual(sent.map(([kind]) => [kind, HASHED]));
  });

  for (const host of HOSTS) {
    it(`host (${host}): the identifier passed before recognition is carried as customer_id beside visitor_id on the shopper's later decision and outcome records, and links nothing, merges nothing, issues no recognised session and selects no other shopper's state, even with an account linked under the same value`, async () => {
      await hashed();
      const m = await mount(host, documents);
      expectPublished(m, 'P13.H2 — the page with its story slot publishes');
      const door = identityDoor(m);
      // Another browser, recognised: an account linked under the same value, with Willow history.
      const account = await shopperOn(m);
      expect((await account.action({ type: 'product_view', data: { productId: 'COA-C2621', line: 'Willow', category: 'Handbags' } })).status).toBe(200);
      // The account's history delivery is consumed here, while its browser still owns itself (R-P66 item 1): once linked,
      // the browser forwards to the person, and the recovery consumer refuses that browser's earlier queued delivery
      // (ShopperReflex assertOwned through recoveryGuard, src/ledger/recovery.ts), although its rows are already stored.
      // That refusal predates P13, is recorded owner-visible and belongs to the identity and ledger tickets; this leg
      // measures the carried identifier on the shopper's own records, not that consumer.
      await m.drainLedger();
      const linked = await link(m, door, account, HASHED);
      expect(linked.status, `${host}: PRECONDITION — the account is linked: ${JSON.stringify(linked.body).slice(0, 200)}`).toBe(200);
      const person = ((linked.body.session ?? {}) as { capability?: string }).capability ?? '';
      const accountBefore = await profileOf(door, person, 'the account');
      // The shopper's browser, anonymous, under tracking consent: the page passes the hashed identifier, then the shopper browses.
      const s = await shopperOn(m);
      const view = await actionCarrying(m, s, { type: 'product_view', data: { productId: 'COA-CH857', line: 'Tabby', category: 'Handbags' } });
      expect(view.status, `${host}: P13.H2 — the shopper's action carrying the identifier is accepted: ${JSON.stringify(view.body).slice(0, 200)}`).toBe(200);
      const pageInstance = pageInstanceOf('p13-h2');
      const page = await carrying(m, s, `/v1/${TENANT}/decisions/snapshot`, { page: 'pdp', brand: BRAND, pageInstance, entry: JSON.stringify(PAID_SOCIAL_ENTRY) });
      expect(page.status, `${host}: P13.H2 — the shopper's decision request carrying the identifier is answered: ${JSON.stringify(page.body).slice(0, 200)}`).toBe(200);
      const story = ((page.body.decisions ?? []) as Array<Record<string, unknown>>).find(d => d.slot === STORY);
      const ack = await s.ack({ status: 200, body: page.body, page: 'pdp', pageInstance, decisions: (page.body.decisions ?? []) as never }, story as never);
      expect(ack.status, `${host}: PRECONDITION — the shopper's story is acknowledged`).toBe(200);
      expect((await actionCarrying(m, s, { type: 'add_to_cart', data: { productId: 'COA-CH857', price: 475, currency: 'USD', brand: BRAND } })).status, `${host}: the shopper's add to bag is accepted`).toBe(200);
      await m.drainLedger();
      const decisions = storedDecisions(m, s.subject), outcomes = storedOutcomes(m, s.subject);
      expect([decisions.length > 0, outcomes.length > 0], `${host}: PRECONDITION — the shopper's decision and outcome records are stored under the shopper's own visitor identifier`).toEqual([true, true]);
      expect([...decisions.map(r => (r as unknown as Record<string, unknown>).customer_id ?? null), ...outcomes.map(o => o.customer_id ?? null)],
        `${host}: P13.H2 — each of the shopper's records carries the identifier beside visitor_id`).toEqual([...decisions.map(() => HASHED), ...outcomes.map(() => HASHED)]);
      // Never proof.
      expect([page.body.session ?? null, decisions.every(r => r.visitor_id === s.subject)],
        `${host}: P13.H2 — no recognised session is issued and the shopper's records stay the shopper's own`).toEqual([null, true]);
      expect(await profileOf(door, person, 'the account'), `${host}: P13.H2 — the account linked under the same value is unchanged: nothing linked, nothing merged`).toEqual(accountBefore);
      expect(Object.keys((decisions[0]?.inputs?.affinity ?? {}).line ?? {}), `${host}: P13.H2 — the shopper's decision used the shopper's own interests, not the account's`).toEqual(['Tabby']);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P13.H3 — at recognition the signed link merges, and names the carried identifier
// ===========================================================================

describe('unit:P13.H3 (freeze item 15)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the backend-signed link at recognition merges the shopper's anonymous profile into the account without overriding its history, and the link's answer names the identifier carried before it, not the linked account's`, async () => {
      await hashed();
      // The account the backend signs is named by a value other than the one the page carried (R-P38).
      const account = await sha256Hex('parity-p13-account-0001');
      expect(account === HASHED ? 'one value' : 'two values', 'PRECONDITION: the carried identifier and the linked account identifier differ').toBe('two values');
      const m = await mount(host, documents);
      expectPublished(m, 'P13.H3 — the page publishes');
      const door = identityDoor(m);
      const earlier = await shopperOn(m);
      for (let i = 0; i < 2; i++) expect((await earlier.action(VIEW_TABBY_26)).status).toBe(200);
      expect((await link(m, door, earlier, account)).status, `${host}: PRECONDITION — the account's history is linked`).toBe(200);
      const s = await shopperOn(m);
      expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status).toBe(200);
      expect((await actionCarrying(m, s, VIEW_TABBY_WALLET)).status, `${host}: P13.H3 — the shopper's view carrying the identifier is accepted`).toBe(200);
      const answer = await link(m, door, s, account);
      expect([answer.status, answer.body.outcome ?? answer.body.error], `${host}: PRECONDITION — the signed link at recognition is accepted`).toEqual([200, 'linked']);
      const merged = await profileOf(door, ((answer.body.session ?? {}) as { capability?: string }).capability ?? '', 'the account');
      // Merge, never override (src/reflex/identityMerge.ts): two views of the Tabby 26 and the shopper's one view of the Tabby wallet, added.
      expect([merged.line?.Tabby ?? 0, merged.category?.Handbags ?? 0, merged.category?.['Small Leather Goods'] ?? 0].map(a => Math.round(a * 1000) / 1000),
        `${host}: P13.H3 — the account holds its history and the shopper's anonymous profile added (LOCK)`).toEqual([aff(3), aff(2), aff(1)].map(a => Math.round(a * 1000) / 1000));
      expect(answer.body.customerId ?? 'no customerId on the link answer',
        `${host}: P13.H3 — the link's answer names the identifier the page carried before recognition, not the linked account's (${account.slice(0, 8)}…)`).toBe(HASHED);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P13.H4 — the first decision on the first request
// ===========================================================================

describe('unit:P13.H4 (freeze item 15)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a decision request from a new visitor without a session is answered with the first decision set and the issued session, and a forged session is still refused`, async () => {
      const m = await mount(host, documents);
      expectPublished(m, 'P13.H4 — the page publishes');
      const ask = (headers: Record<string, string>) => m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p13-h4') }) }));
      const first = await ask({});
      const body = await first.json().catch(() => ({})) as { decisions?: Array<{ slot: string }>; session?: { capability?: string; tenant?: string } };
      await m.drain();
      expect([first.status, typeof body.session?.capability, body.session?.tenant, (body.decisions ?? []).some(d => d.slot === STORY)],
        `${host}: P13.H4 — one call issues the session and returns the first decision set (${JSON.stringify(body).slice(0, 200)})`).toEqual([200, 'string', TENANT, true]);
      const forged = await ask({ [SHOPPER_HEADER]: 'ss1.Zm9yZ2Vk.AA' });
      expect(forged.status, `${host}: P13.H4 — LOCK: a forged session is still refused`).toBe(401);
    }, 60_000);
  }

  it('sdk: a new visitor’s client makes one call before the first decision set: the decision request, with no separate session call', async () => {
    const decisions = [{ contentId: 'story.tabby', slot: STORY, order: 0, explain: { drivers: [] } }];
    const f = testHost({ responses: (url, init) => url.includes('/decisions/snapshot')
      ? { ok: true, tenant: 'coach', page: 'pdp', pageInstance: (JSON.parse(init?.body ?? '{}') as { pageInstance?: string }).pageInstance, decisions, session: syntheticSession() }
      : { success: true } });
    const listen = createListen(createCore({ tenant: 'coach', source: 'coach-pdp' }, f.host));
    const set = await listen.hydrate({ page: 'pdp' });
    const before = f.calls.map(c => new URL(c.url, 'https://edge.invalid').pathname.replace(/^\/v1\/coach/, ''));
    expect([before, set?.decisions?.map(d => d.contentId) ?? null], 'P13.H4 — the first decision set arrives on the first and only call').toEqual([['/decisions/snapshot'], ['story.tabby']]);
  });

  it('sdk: the server bridge serves a new visitor’s first decision set from one call to the engine, setting the shopper’s session cookie from it', async () => {
    const calls: string[] = [];
    const session = syntheticSession();
    const transport = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url); calls.push(new URL(target).pathname);
      const sent = JSON.parse(String(init?.body ?? '{}')) as { pageInstance?: string };
      const body = target.endsWith('/identity/session') ? { ok: true, session }
        : { ok: true, tenant: 'coach', page: 'pdp', pageInstance: sent.pageInstance, decisions: [{ contentId: 'story.tabby', slot: STORY, order: 0 }], arm: 'personalized', session };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const bridge = createServerBridge({ tenant: 'coach', origin: 'https://www.coach.example', endpoint: 'https://edge.example', sdkKey: 'parity-site-key' }, transport);
    const { bootstrap, headers } = await bridge.snapshot(new Request('https://www.coach.example/products/tabby'), 'pdp');
    expect([calls, bootstrap?.decisions.map(d => d.contentId) ?? null, (headers.get('Set-Cookie') ?? '').includes(session.capability)],
      'P13.H4 — one call to the engine, the first decision set, and the shopper’s session cookie').toEqual([['/v1/coach/decisions/snapshot'], ['story.tabby'], true]);
  });

  // -------------------------------------------------------------------------
  // R-P67 as amended (P13 fix round 1, round 3): the bootstrap request stays bare (page, page instance, brand and
  // the page's refusal hints, as d9ce85b2 built it); the SDK sends no tracking member before consent is stated, and
  // nothing here expects the single request to carry one. What these legs lock is today's engine: a single request
  // that does carry the entry, the channel, the browsing session and the carried identifier under a hint refusing
  // tracking is answered with the issued session stating tracking refused and the decision a bare request gets, the
  // four members ignored; nothing of that visitor is written (CW31); and no store holds the carried value or the
  // browsing session it named. In-leg controls show, in the same mount, P07's entry prior live and those members
  // reaching the records of a shopper whose explicit choice allows tracking (P07.C1's representation:
  // explain.contextPrior { channel 'paid_social', visitBucket '1', level 'channel_visit', lambda 1 } on the record,
  // "population prior, paid social, first visit" on the receipt). A browser that takes the single call holds no
  // session and no proof, and the grant the engine issues it carries no consent instruction, read as both switches
  // refused (src/content/consent.ts:86, :139-152; src/routes/identity.ts:381): a new visitor's first decision is
  // the default arm on either path until a consent choice is recorded. Expected values: R-P67 as amended, CW31,
  // S4-C17 to C19 and P07's receipted representation.
  // -------------------------------------------------------------------------
  /** P07.C1's block, and its paid-social population: four first-time paid-social visitors who each view the quilted Tabby. */
  const CONTEXT_PRIOR = { enabled: true, kBlend: 1, minEvents: 3 };
  const priorDocuments = { pieces: PIECES, slots: SLOTS, learn: learnDocument({ [STORY]: { measurementBasis: 'rendered-v1', reward: 'click' } }, { contextPrior: CONTEXT_PRIOR }) };
  /** A browsing session in the shape the SDK mints (src/sdk/identity.ts mintSessionId). */
  const browsingSession = () => `s-${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  /** The single call: a decision request with no session at all, as the H4 host leg sends it. */
  const singleCall = async (m: Mounted, body: Record<string, string>) => {
    const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
      headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
    await m.drain();
    return answer;
  };
  const decidedOf = (answer: { body: Record<string, unknown> }) => ((answer.body.decisions ?? []) as Array<Record<string, unknown>>)
    .map(({ slot, contentId, order, strategy, explain }) => ({ slot, contentId, order, strategy, explain }));
  /** Every value the mounted engine holds: the ledger objects, both KV namespaces, every object's storage, the queue and the trend objects. */
  const traceOf = (m: Mounted, trend: ReturnType<typeof bindTrend>) => JSON.stringify([[...m.storage.objects.entries()], [...m.cache.data.entries()],
    [...(m.env.SESSIONS as unknown as { data: Map<string, unknown> }).data.entries()],
    ...[m.shoppers, m.rings, m.stats].map(registry => [...registry.entries()].map(([name, item]) => [name, [...item.data.entries()]])), m.queued]) + trendStorageText(trend);

  for (const host of HOSTS) {
    it(`host (${host}): the single request carrying the entry, the channel, the browsing session and the carried identifier under hints that refuse tracking is answered with the issued session stating tracking refused and the decision a bare request gets, and leaves no record and no trace of those members (R-P67)`, async () => {
      await hashed();
      const m = await mount(host, priorDocuments);
      expectPublished(m, 'P13.H4 (R-P67) — the page with the context prior’s block (P07.C1’s) publishes');
      const trend = bindTrend(m);
      for (let i = 0; i < 4; i++) {
        const visitor = await shopperOn(m);
        expect((await visitor.action(VIEW_TABBY_QUILTED, PAID_SOCIAL_ENTRY)).status, `${host}: PRECONDITION — a paid-social first visitor's view is accepted`).toBe(200);
      }
      await publishTrends(m, trend);
      // CONTROL: in this mount the entry prior is live and the members reach the records, for a shopper whose explicit choice allows tracking.
      const chosen = await shopperOn(m);
      expect((await chosen.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${host}: PRECONDITION — the control shopper's page view is accepted`).toBe(200);
      const controlBrowsing = browsingSession(), controlInstance = pageInstanceOf('p13-h4-control');
      const controlResponse = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: chosen.grant.capability, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: controlInstance, entry: JSON.stringify(PAID_SOCIAL_ENTRY), channel: 'paid social', browsingSessionId: controlBrowsing }) }));
      const controlBody = await controlResponse.json().catch(() => ({})) as Record<string, unknown>;
      await m.drain();
      const controlDecisions = (controlBody.decisions ?? []) as Array<Record<string, unknown>>;
      const controlAck = await chosen.ack({ status: controlResponse.status, body: controlBody, page: 'pdp', pageInstance: controlInstance, decisions: controlDecisions as never },
        controlDecisions.find(d => d.slot === STORY) as never);
      expect([controlResponse.status, controlAck.status], `${host}: PRECONDITION — the control shopper's page is answered and its story acknowledged`).toEqual([200, 200]);
      await m.drainLedger();
      const controlRecord = storedDecisions(m, chosen.subject).find(r => r.slot === STORY);
      const controlSentence = (((await receiptsOf(m, chosen.subject)).find(r => r.slot === STORY)?.why ?? []) as string[]).find(w => /population prior/i.test(w)) ?? '';
      expect({ session: controlRecord?.session_id ?? null, prior: (controlRecord?.explain as Record<string, unknown> | undefined)?.contextPrior ?? null,
        words: [/paid social/i.test(controlSentence), /first visit/i.test(controlSentence)] },
      `${host}: CONTROL — tracking allowed by an explicit choice: the record names the request's browsing session and P07's entry prior, and the receipt says it in words`)
        .toMatchObject({ session: controlBrowsing, prior: { channel: 'paid_social', visitBucket: '1', level: 'channel_visit', lambda: 1 }, words: [true, true] });

      // The single call of a new visitor whose page refuses tracking, carrying the four members, and a bare one under the same hint.
      const browsing = browsingSession(), pageInstance = pageInstanceOf('p13-h4-refused');
      const first = await singleCall(m, { page: 'pdp', brand: BRAND, pageInstance, entry: JSON.stringify(PAID_SOCIAL_ENTRY), channel: 'paid social',
        browsingSessionId: browsing, customerId: HASHED, trackingConsent: 'false' });
      const bare = await singleCall(m, { page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p13-h4-bare'), trackingConsent: 'false' });
      const session = (first.body.session ?? {}) as { capability?: string; tenant?: string; subject?: string; sessionId?: string; consent?: { tracking?: unknown } };
      expect([first.status, typeof session.capability, session.tenant, session.consent?.tracking ?? 'no consent on the session', decidedOf(first).some(d => d.slot === STORY)],
        `${host}: P13.H4 (R-P67) — answered with the issued session stating tracking refused and the first decision set (${JSON.stringify(first.body).slice(0, 200)})`)
        .toEqual([200, 'string', TENANT, false, true]);
      expect(decidedOf(first), `${host}: P13.H4 (R-P67) — decided exactly as the bare request under the same hint: no entry prior, nothing of the four members read`).toEqual(decidedOf(bare));
      const story = ((first.body.decisions ?? []) as Array<Record<string, unknown>>).find(d => d.slot === STORY)!;
      const acknowledged = await m.fetch(new Request('https://shop.invalid/realtime/action', { method: 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: session.capability ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'content_impression', source: 'sdk', userId: session.subject, sessionId: session.sessionId, eventId: crypto.randomUUID(), timestamp: Date.now(),
          data: { contentId: story.contentId, decisionId: story.decisionId, renderOffer: story.renderOffer, page: 'pdp', pageInstance, slot: story.slot, position: story.order,
            slotPosition: slotPositionOf({ decisions: (first.body.decisions ?? []) as never }, story as never) } }) }));
      await m.drain();
      expect(acknowledged.status, `${host}: PRECONDITION — the story's acknowledgement under the issued session is answered`).toBe(200);
      await m.drainLedger();
      expect([storedDecisions(m, session.subject ?? ''), storedOutcomes(m, session.subject ?? '')],
        `${host}: P13.H4 (R-P67, CW31) — under refused tracking nothing of this visitor is recorded, no decision record and no outcome record, so none carries customer_id or a browsing session`)
        .toEqual([[], []]);
      const trace = traceOf(m, trend);
      expect([trace.includes(HASHED), trace.includes(browsing), trace.includes(controlBrowsing)],
        `${host}: P13.H4 (R-P67) — no store holds the carried identifier or the browsing session the refused request named (CONTROL: the control shopper's browsing session is found)`)
        .toEqual([false, false, true]);
    }, 90_000);
  }
});

// ===========================================================================
// unit:P13.H5 — the kit
// ===========================================================================

describe('unit:P13.H5 (freeze item 15)', () => {
  it('logic: the integration guide, the API reference and the payload schemas each document the loaded hook, the identifier call and the first-request path', () => {
    const sentences = (file: string) => readTree(file).replace(/`/g, '').split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(s => s.replace(/\s+/g, ' ').trim());
    const statements: Array<[string, (s: string) => boolean]> = [
      ['onLoaded: the loaded hook runs once', s => /onLoaded/.test(s) && /once/i.test(s)],
      ['setCustomerId: carried beside the visitor identifier, never proof of identity', s => /setCustomerId|customerId/.test(s) && /(never|not) (treated as )?proof|not proof|no proof/i.test(s)],
      ['the first decision on the first request, the session issued with it', s => /first request|one (call|request)/i.test(s) && /session/i.test(s) && /decision/i.test(s)],
    ];
    const missing = ['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']
      .flatMap(file => statements.filter(([, test]) => !sentences(file).some(test)).map(([name]) => `${file}: ${name}`));
    expect(missing, 'P13.H5 — the kit documents the hook, the identifier call and the first-request path').toEqual([]);
  });
});

