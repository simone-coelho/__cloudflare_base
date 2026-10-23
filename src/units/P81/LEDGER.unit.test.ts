// src/units/P81/LEDGER.unit.test.ts
// P81 under the Closure Ledger: the tests for the LOCAL criteria PU1-PU4 of the P81 work order (the activation
// programme of amendment 11, ticket P81 "The push of the decision set over the live connection", the rendering record's
// N5). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md,
// section 2, E3, "Done when"):
//   "when a page view opens and whenever the shopper's decisions change for that page, the engine sends the decision
//   set to the page over the live connection as the frame the SDK already receives (`core.on('decisions')` → apply),
//   and the SDK no longer re-requests over HTTPS on a channel signal; the HTTPS request path (`POST
//   /v1/{tenant}/decisions/snapshot`) stays for servers and for a page's first list before the connection is up; the
//   subscribe surface their code uses is unchanged; the hold per page view (P34) governs what is drawn; the kit's 'the
//   socket is optional' and 'no production push is promised' sentences are replaced."
// Section 3, decision 2 (the owner, 22 October): "we need to be able to support both… I should be able to call an API
// and get a decision, or I should be able to push it." The work order (docs/parity/activation/program.json, P81): PU1
// "On both hosts, with a page view open on a connected socket, the engine sends that page view's decision set as a
// content_decisions frame (the shape src/sdk/core.ts emits as 'decisions' and listen applies) when the page view opens
// and after each admitted action that changes its decisions; the set carries the page view's pageInstance, and its
// records, receipts and exposures are those the snapshot path makes"; PU2 "The SDK no longer re-requests over HTTPS on a
// channel signal while the socket is connected: neither a 'connected' status nor an acknowledged action causes a
// snapshot request; a page view's first list is asked with POST /v1/{tenant}/decisions/snapshot when the connection is
// not up; the subscribe surface (subscribe, onDecisions, hold, apply) is unchanged"; PU3 "The hold per page view (P34)
// governs what is drawn: a pushed set for a held slot of the same page view leaves it as delivered, a pushed set naming
// another pageInstance is not drawn, and known absence still restores the defaults; a set that needs personalization
// consent is neither sent without it (as pushFrame refuses) nor emitted by the SDK"; PU4 the kit sentences replaced.
//
// THE READINGS THIS FILE RULES:
//   · THE FRAME: `{ type: 'content_decisions', page, pageInstance, arm, decisions, … }`, the decision set as the
//     snapshot route answers it (each decision with its `decisionId` and `renderOffer` under tracking consent, as the
//     route's answer carries them), with `type` added; the SDK's receiver (core.ts `handleFrame`) is unchanged.
//   · HOW THE PAGE VIEW REACHES THE SENDER (the builder's preparation, S22): the decision request the page sends for a
//     page view (`POST /v1/{tenant}/decisions/snapshot` naming its `pageInstance`; P13's first request included) is
//     the open page view: its page, pageInstance, brand, channel, report and ctx signals (P79's product key as P80's
//     `ctx.anchor`, the variant as `ctx.variant`). No new socket message. Every push is decided through that same path,
//     so its decisions carry receipts and offers the acknowledgement admits, exactly as a request's do.
//   · THE CHANGE TRIGGERS, fixed: (1) the page view's first list: when the request that opens it is answered, the same
//     set is also sent as a frame on the shopper's connected socket; (2) an admitted action that changes the page
//     view's decisions; (3) a buffered delivery that changes them (it is applied at its delivery: the decision set a
//     request then gets has changed, on both hosts; measured, _evidence/parity-step3/S22/specifier/logs/probe-today2.log);
//     (4) a publication change that changes them, sent at the latest at the socket's next heartbeat. Each later push
//     names the same pageInstance and carries the set a request for that page view then gets. No push without the
//     shopper's personalization consent. R-P269: an unchanged set is never pushed again (P70's "publishes only a change",
//     P74's dedupe): a trigger that leaves the set unchanged sends no frame, and a socket opened for the shopper brings no
//     frame repeating the page view's current set: the set reaches the page once per page instance unless it changes.
//   · THE SDK: neither a 'connected' status nor an acknowledged action re-requests while the socket is connected; while
//     it is not connected an acknowledged action re-requests as today (so a page without a socket still follows); a
//     page view's first list, and every refresh the page itself calls, is asked over HTTPS (that request is how the
//     page view reaches the engine). A pushed set naming another pageInstance than the page view open is not drawn.
//   · PU4: read by sentence; each disclaimer is gone and the passage states the push (and, where the kit says how the
//     page refreshes, when the HTTPS request is used).
//
// R10 (expectations P81 changes): src/units/P34/LEDGER.unit.test.ts T5 "then one refresh" (both legs): GRANTED, applied
// in this batch in R-P195's form (the count after the socket's open without the re-request: no refresh), RED on today's
// product and GREEN under the fix. NOT granted, listed for the lead: P34.T1's 'a socket open' leg
// (src/units/P34/LEDGER.unit.test.ts, describe 'unit:P34.T1', the TRIGGERS entry 'a socket open': "then exactly one
// refresh follows", `expect(s.snapshots.length, 'P34.T1 — then one refresh follows').toBe(2)`), RED under the fix; the
// whole-suite comparison names no other (see the report).
//
// FIXTURE. P02's product page (src/units/_parity.ts: the registered modules, the declared layout slot measured
// rendered-v1); a shopper who viewed nothing, whose page view then follows a Tabby view (COA-CH857), live or buffered.
// The host legs run the real Worker in workerd on each shopper host (src/units/_native.ts, P66's native world), with the
// real socket; the SDK legs drive createCore, createListen and createEmit on the test host with a fake socket.
//
// NO NEW EXPORT IS IMPORTED.
//
// MEASURED at 246358ae (P80's join merged; _evidence/parity-step3/S22/specifier/logs/, serial, --no-cache, working
// directory the tree): 8 RED for the missing behaviour (no content_decisions frame on either host after the first list,
// an action, a buffered delivery or a publication change; the SDK re-requests on 'connected' and on an acknowledged
// action while connected; a pushed set of another page view is drawn; the kit disclaims the push); the 8 locks GREEN.
// NEGATIVE CONTROLS (scratch trees, never committed; _evidence/parity-step3/S22/specifier/sketches/p81.py, logs/d/): the
// fix (the shopper's object keeps the page view a decision request opened and pushes its answered set; after an
// admitted action and at a socket heartbeat it decides that request again through the route and pushes a changed set,
// right after its answer through P56's continueAfterOwnerAnswer, scheduled only while the shopper holds a socket; the SDK
// re-requests only without a connected socket and draws no other page view's set; the kit's six passages) turns all 16
// GREEN three times; `norecord` (a push without receipts and offers) turns PU1 RED on both hosts; `ignorehold` turns
// PU3's hold lock RED; `keeprerequest` turns PU2's two legs RED; `otherdrawn` turns PU3's page-instance leg RED. Under the
// fix P02, P13, P60, P64, P65, P67, P68, P70, P79, W35, src/sdk/*.test.ts, src/routes/realtime.sdkContract.test.ts,
// src/reflex/shopperReflex{,.identity,.consent}.test.ts, src/services/telemetry.boundary.test.ts and
// src/index.api-boundary.test.ts stay green; P34 is green but for T1's 'a socket open' leg (the R10 below); the SDK
// bundles grow 88 bytes (ESM, 104 784 of 107 520) and 90 (IIFE, 110 033 of 112 640) over this head's. An earlier sketch that pushed before the answer and
// without a socket turned P64.OT4, P65.RS3, P67.OM2 and P70.WB2 (no remote call before the answer) and P02.A3 (a
// served-v1 capture per re-decision) RED, and one that added lines turned P68.KT1 RED (kit 02 cites ShopperReflex.ts and
// listen.ts by line), and one that scheduled the continuation without a socket turned W36.S2 RED (the session
// projection read again after its write): constraints a build keeps. The whole-suite comparison (R-P248, vitest run src
// on today's product and on the fix, logs/today-suite.json and logs/d/fix-suite.json) names, beyond the scratch tree's
// own artifacts (no git repository, no wrangler variants: root.worker, P45-P47, P51-P53, W39, W40, each failing on an
// unchanged copy too), only P34.T1's socket-open leg and W36.S2 (fixed by the gate, logs/f/); P80's four R-P264 legs fail
// on both, against P80's build.
//
// HARNESS: src/units/_native.ts, src/units/_parity.ts, src/sdk/testHost.ts. Imports from src/units/: ../_native,
// ../_parity.

import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { EMPTY_PRIORS } from '@/learn/priors';
import { RETENTION_CATEGORIES } from '@/retention';
import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createListen, type HydrateOptions } from '@/sdk/listen';
import { offeredSet, renderAck, testHost } from '@/sdk/testHost';
import type { ContentDecision, DecisionSet, RequestInitLike, ResponseLike } from '@/sdk/types';

import { bundleNativeWorker, nativeScratchDirectory, openNativeRuntime } from '../_native';
import {
  declaredSlots, HOSTS, layoutSlot, LAYOUT, learnDocument, MODULES, PAGE_VIEW, readTree, REFLEX_DOCUMENT, TENANT, VIEW_TABBY_26, type Host,
} from '../_parity';

const STORY = 'pdp-story';

// ===========================================================================
// The host legs: the real Worker in workerd, both shopper hosts, a real socket.
// ===========================================================================

const NATIVE_SECRET = 'p81-native-operator-signing-material';
/** P66's native wrapper (src/units/P66/LEDGER.unit.test.ts `NATIVE_WRAPPER`): a door that publishes the documents and one that mints an anonymous grant. */
const NATIVE_WRAPPER = `
import worker, { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { PRIORS_KIND } from './src/learn/priors.ts';
import { newAnonymousSession } from './src/identity/sessionCapability.ts';
export { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== 'p81-fixture') return worker.fetch(request, env, ctx);
    const input = await request.json();
    if (url.pathname === '/publish') {
      const revision = value => ({ revision: 1, at: 1, actor: 'p81-native', note: '', value });
      await initializePublicationSet(env, [
        { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) }, { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
        { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) }, { kind: PRIORS_KIND, scope: input.tenant, revision: revision(input.priors) },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision(input.reflex) },
      ], '0:' + crypto.randomUUID());
      return Response.json({ published: input.tenant });
    }
    if (url.pathname === '/grant') return Response.json(await newAnonymousSession(env, input.tenant));
    return new Response(null, { status: 404 });
  },
};`;
let nativeBundle: Promise<string> | undefined;

interface Answer { status: number; body: Record<string, unknown> }
interface Frame { type?: string; page?: string; pageInstance?: string; decisions?: Array<{ contentId: string; slot: string; decisionId?: string; renderOffer?: string; order?: number }>; [k: string]: unknown }
interface NativeSocket { frames: Frame[]; send: (frame: unknown) => void; waitFor: (predicate: () => boolean, ms?: number) => Promise<boolean> }
interface Browser {
  subject: string; sessionId: string;
  call: (path: string, body?: unknown) => Promise<Answer>;
  /** A decision request for the page view, the route the SDK posts. */
  ask: (pageInstance: string) => Promise<Answer>;
  /** A live action, as the SDK posts it; `buffered` makes it a buffered delivery. */
  act: (event: { type: string; data: Record<string, unknown> }, buffered?: boolean) => Promise<Answer>;
  socket: () => Promise<NativeSocket>;
}
interface NativeWorld { browser: (consent: { tracking: boolean; personalization: boolean }) => Promise<Browser>; publishSlots: (document: unknown) => Promise<Answer> }

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** One host in workerd: the documents published, then `work` (P66's native world, with the socket). */
async function nativeWorld<T>(host: Host, work: (w: NativeWorld) => Promise<T>): Promise<T> {
  const bundle = await (nativeBundle ??= bundleNativeWorker(NATIVE_WRAPPER, 'p81-ledger-native'));
  const directory = nativeScratchDirectory('p81-ledger-native-');
  const policy = { id: 'p81-native-policy', revision: 1, durationMs: 3650 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
  const runtime = await openNativeRuntime({ bundle, name: `p81-native-${host}`, persistDir: directory.path,
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket', DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
    kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
    bindings: { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host, JWT_SECRET: NATIVE_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      IDENTITY_SECRETS: `${TENANT}:p81-native-identity`, LEDGER_RECOVERY_ENABLED: 'true', TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
      RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, policy])) } }) } });
  const sockets: Array<{ close: (code: number, reason: string) => void }> = [];
  try {
    const fixture = async (path: string, body: unknown) => {
      const response = await runtime.fetch(`https://p81-fixture${path}`, { method: 'POST', body: JSON.stringify(body) });
      expect(response.status, `PRECONDITION (${host} native): fixture door ${path}`).toBe(200);
      return await response.json() as Record<string, unknown>;
    };
    await fixture('/publish', { tenant: TENANT, content: { version: 'p81-native', pieces: MODULES }, slots: declaredSlots([layoutSlot()]), learn: learnDocument(),
      priors: EMPTY_PRIORS, reflex: REFLEX_DOCUMENT });
    const token = await new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a')
      .setExpirationTime('2h').sign(new TextEncoder().encode(NATIVE_SECRET));
    const parsed = async (response: Response): Promise<Answer> => {
      const text = await response.text();
      let body: Record<string, unknown>; try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { text }; }
      return { status: response.status, body };
    };
    const operator = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => parsed(await runtime.fetch(`https://ops.example${path}`, {
      method, headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const publishSlots = async (document: unknown) => {
      const base = await operator('GET', `/content/slots?scope=${TENANT}`);
      const publication = base.body.publication as { revision: number; digest: string };
      return operator('PUT', `/content/slots?scope=${TENANT}`, { document, note: 'p81' },
        { 'If-Match': `"${String(base.body.revision)}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${String(base.body.revision)}:${crypto.randomUUID()}` });
    };
    const browser = async (consent: { tracking: boolean; personalization: boolean }): Promise<Browser> => {
      const g = await fixture('/grant', { tenant: TENANT }) as unknown as { capability: string; subject: string; sessionId: string; grantId: string; iat: number; exp: number };
      const call = async (path: string, body?: unknown) => parsed(await runtime.fetch(`https://shop.example${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: g.capability, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      expect((await call(`/realtime/session/${g.sessionId}/preferences`, { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: g.grantId, iat: g.iat, exp: g.exp } })).status, `PRECONDITION (${host} native): the shopper's explicit choice`).toBe(200);
      const act = (event: { type: string; data: Record<string, unknown> }, buffered = false) => call('/realtime/action', { ...event, source: 'sdk', userId: g.subject, sessionId: g.sessionId,
        eventId: crypto.randomUUID(), ...(buffered ? { processing: 'buffered', timestamp: Date.now() - 60_000, browsingSessionId: g.sessionId } : { timestamp: Date.now() }) });
      expect((await act(PAGE_VIEW)).status, `PRECONDITION (${host} native): the shopper's page view`).toBe(200);
      const socket = async (): Promise<NativeSocket> => {
        const response = await runtime.fetch(`https://shop.example/realtime/ws?tenant=${TENANT}`, { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `shopper-session-v1, ${g.capability}` } });
        const ws = (response as unknown as { webSocket?: { accept(): void; send(data: string): void; close(code: number, reason: string): void;
          addEventListener(type: string, listener: (event: { data: unknown }) => void): void } }).webSocket;
        expect([response.status, Boolean(ws)], `PRECONDITION (${host} native): the socket is upgraded`).toEqual([101, true]);
        const frames: Frame[] = [];
        ws!.addEventListener('message', event => { try { frames.push(JSON.parse(String(event.data)) as Frame); } catch { /* not JSON */ } });
        ws!.accept();
        sockets.push(ws!);
        const waitFor = async (predicate: () => boolean, ms = 3000) => { const until = Date.now() + ms; while (!predicate() && Date.now() < until) await pause(20); return predicate(); };
        expect(await waitFor(() => frames.some(f => f.type === 'connected')), `PRECONDITION (${host} native): the socket's welcome frame`).toBe(true);
        return { frames, send: frame => ws!.send(JSON.stringify(frame)), waitFor };
      };
      const ask = (pageInstance: string) => call(`/v1/${TENANT}/decisions/snapshot`, { page: 'pdp', brand: TENANT, pageInstance });
      return { subject: g.subject, sessionId: g.sessionId, call, ask, act, socket };
    };
    return await work({ browser, publishSlots });
  } finally {
    for (const ws of sockets) { try { ws.close(1000, 'p81 fixture complete'); } catch { /* closed */ } }
    await runtime.dispose(); directory.remove();
  }
}

const pushed = (socket: NativeSocket) => socket.frames.filter(f => f.type === 'content_decisions');
const itemsOf = (decisions: Frame['decisions'] | unknown) => ((decisions ?? []) as Array<{ slot: string; contentId: string; order?: number }>)
  .filter(d => d.slot === LAYOUT).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(d => d.contentId);
/** What a frame says of the page view: its page instance and its layout, in order. */
const framed = (frame: Frame | undefined) => frame === undefined ? 'no content_decisions frame' : { pageInstance: frame.pageInstance, items: itemsOf(frame.decisions) };
const changed = (before: Answer, after: Answer) => JSON.stringify(itemsOf(before.body.decisions)) === JSON.stringify(itemsOf(after.body.decisions)) ? 'unchanged' : 'changed';
/** The next push after `count` frames, waited for up to three seconds. */
async function nextPush(socket: NativeSocket, count: number): Promise<Frame | undefined> {
  await socket.waitFor(() => pushed(socket).length > count);
  return pushed(socket)[count];
}

// ===========================================================================
// The SDK legs: the SDK on the test host, a fake engine and a fake socket.
// ===========================================================================

const decision = (slot: string, order: number, contentId: string): ContentDecision => ({ contentId,
  customerContentId: `TAP-${contentId.replace(/^module\./, '').replace(/\./g, '-').toUpperCase()}`, type: 'module', slot, order, score: 0.5, strategy: 'affinity', explain: { drivers: [] } });
/** The product page: the layout slot's modules, the story slot below them; `order` is page-wide. */
const page = (layout: string[], story: string[]): DecisionSet => ({ page: 'pdp', arm: 'personalized',
  decisions: [...layout.map((id, i) => decision(LAYOUT, i, id)), ...story.map((id, i) => decision(STORY, layout.length + i, id))] });
const GRID = 'module.PDP.grid.1', RECO = 'module.PDP.reco.1', LOOK = 'module.PDP.reco.2', EDIT = 'module.PDP.editorial.1';

/** P34's SDK harness: the decision requests held until answered; the acknowledgement admitted for a receipt the engine issued. */
function sdkPage(options: { personalization?: boolean } = {}) {
  const f = testHost();
  const snapshots: Array<{ pageInstance: string; method: string; answered: boolean; answer: (set: DecisionSet, revision: string) => DecisionSet; fail: () => void }> = [];
  const issued = new Map<string, string>();
  const passthrough = f.host.fetch;
  const respond = (json: unknown, status = 200): ResponseLike => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
    if (url.includes('/decisions/snapshot')) {
      const body = JSON.parse(init?.body ?? '{}') as { page: string; pageInstance: string };
      return new Promise<ResponseLike>(resolve => { snapshots.push({ pageInstance: body.pageInstance, method: init?.method ?? 'GET', answered: false,
        answer(set, revision) {
          const offered = offeredSet({ ...set, page: body.page }, body.pageInstance, revision);
          for (const d of offered.decisions) issued.set(d.decisionId!, d.renderOffer!);
          this.answered = true; resolve(respond({ ok: true, ...offered })); return offered;
        },
        fail() { this.answered = true; resolve(respond({ ok: false, error: 'Snapshot unavailable' }, 503)); } }); });
    }
    if (url.endsWith('/identity/session') && options.personalization === false) {
      const answer = await passthrough(url, init);
      const body = await answer.json() as { session: { consent: Record<string, unknown> & { instruction: Record<string, unknown> } } };
      const refused = { value: false, chosenAt: f.host.now(), expiresAt: f.host.now() + 30 * 86_400_000 };
      body.session.consent = { ...body.session.consent, personalization: false, instruction: { ...body.session.consent.instruction, personalization: refused } };
      return respond(body);
    }
    if (url.endsWith('/action')) {
      const body = JSON.parse(init?.body ?? '{}') as { type: string; data?: Record<string, unknown> };
      if (body.type === 'content_impression') return respond(renderAck(init));
      return respond({ success: true });
    }
    return passthrough(url, init);
  };
  const core = createCore({ tenant: TENANT, source: 'coach-pdp' }, f.host);
  const listen = createListen(core);
  const emit = createEmit(core, listen);
  const settle = () => vi.advanceTimersByTimeAsync(0);
  /** The page opens a view (refresh) and the engine answers its request. */
  const open = async (view: HydrateOptions, set: DecisionSet, revision: string) => {
    const before = snapshots.length;
    void listen.refresh(view);
    await settle();
    const request = snapshots.slice(before).find(s => !s.answered);
    expect(request, 'PRECONDITION: the page view asked for its first list').toBeTruthy();
    const offered = request!.answer(set, revision);
    await settle();
    return { pageInstance: request!.pageInstance, offered };
  };
  /** The socket the page opens, connected. */
  const connect = async () => { core.connect(); await settle(); const socket = f.sockets.at(-1)!; socket.open(); await settle(); return socket; };
  /** A content_decisions frame from the engine, for `pageInstance`. */
  const push = async (set: DecisionSet, pageInstance: string, revision: string) => {
    f.sockets.at(-1)!.receive({ type: 'content_decisions', ...offeredSet(set, pageInstance, revision) });
    await settle();
  };
  return { f, core, listen, emit, snapshots, open, connect, push, settle, destroy: () => { listen.destroy(); core.disconnect(); } };
}
/** An SDK leg runs on fake timers, as P34's do. */
function sdkLeg(name: string, body: () => Promise<void>): void {
  it(name, async () => { vi.useFakeTimers(); try { await body(); } finally { vi.useRealTimers(); } });
}
const ids = (ds: ContentDecision[]) => ds.map(d => d.contentId);

// ===========================================================================
// unit:P81.PU1 — the engine pushes the page view's decision set
// ===========================================================================

describe('unit:P81.PU1', () => {
  for (const host of HOSTS) {
    it(`host (${host}, native): with the page view open on a connected socket, the engine pushes its decision set as a content_decisions frame naming its pageInstance when its first list is answered, after an admitted action that changes it, and after a publication change (at the socket's next heartbeat at the latest), each the set a request for that page view then gets; a pushed decision's acknowledgement is admitted as a request's is`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser({ tracking: true, personalization: true });
        const socket = await b.socket();
        const instance = `p81-pu1-${host}-${crypto.randomUUID()}`;
        // (1) The page view's first list.
        const first = await b.ask(instance);
        expect(first.status, `${host}: PRECONDITION — the server's POST snapshot answers the page view's first list (${JSON.stringify(first.body).slice(0, 160)})`).toBe(200);
        const firstPush = await nextPush(socket, 0);
        const layout = (firstPush?.decisions ?? []).filter(d => d.slot === LAYOUT).sort((a, c) => (a.order ?? 0) - (c.order ?? 0));
        const offered = layout[0];
        const ack = offered ? await b.call('/realtime/action', { type: 'content_impression', source: 'sdk', userId: b.subject, sessionId: b.sessionId, eventId: crypto.randomUUID(),
          timestamp: Date.now(), data: { contentId: offered.contentId, slot: offered.slot, decisionId: offered.decisionId, renderOffer: offered.renderOffer, page: 'pdp', pageInstance: instance,
            position: offered.order ?? 0, slotPosition: 0 } }) : null;
        await pause(300);
        // (2) An admitted action that changes the page view's decisions.
        let count = pushed(socket).length;
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        const afterAction = await nextPush(socket, count);
        await pause(300);
        const reask = await b.ask(instance);
        expect(changed(first, reask), `${host}: PRECONDITION — the action changed the page view's decisions`).toBe('changed');
        await pause(300);
        // (4) A publication change: the layout slot takes two modules.
        count = pushed(socket).length;
        expect((await w.publishSlots(declaredSlots([layoutSlot({ take: 2 })]))).status, `${host}: PRECONDITION — the operator publishes the slots change`).toBe(200);
        socket.send({ type: 'heartbeat', userId: b.subject });
        const afterPublication = await nextPush(socket, count);
        await pause(300);
        const republished = await b.ask(instance);
        expect.soft({
          firstList: framed(firstPush),
          offers: firstPush ? (firstPush.decisions ?? []).every(d => typeof d.decisionId === 'string' && typeof d.renderOffer === 'string') : 'no content_decisions frame',
          acknowledged: ack ? [ack.status, (ack.body.render as { status?: unknown } | undefined)?.status ?? null] : 'no pushed decision to acknowledge',
          afterAction: framed(afterAction),
          afterPublication: framed(afterPublication),
        }, `${host}: P81.PU1 — the page view's set is pushed when its first list is answered, after an admitted action and after a publication change (today no product code sends content_decisions)`).toEqual({
          firstList: { pageInstance: instance, items: itemsOf(first.body.decisions) },
          offers: true,
          acknowledged: [200, 'durable'],
          afterAction: { pageInstance: instance, items: itemsOf(reask.body.decisions) },
          afterPublication: { pageInstance: instance, items: itemsOf(republished.body.decisions) },
        });
      });
    }, 180_000);

    it(`host (${host}, native): a buffered delivery that changes the open page view's decisions is followed by its pushed set, the set a request for that page view then gets`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser({ tracking: true, personalization: true });
        const socket = await b.socket();
        const instance = `p81-pu1-buffered-${host}-${crypto.randomUUID()}`;
        const first = await b.ask(instance);
        expect(first.status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        await nextPush(socket, 0);
        await pause(300);
        const count = pushed(socket).length;
        const delivered = await b.act(VIEW_TABBY_26, true);
        expect([delivered.status, delivered.body.processing, delivered.body.interestApplied], `${host}: PRECONDITION — the buffered delivery is admitted and applies interest`).toEqual([200, 'buffered', true]);
        const afterDelivery = await nextPush(socket, count);
        await pause(300);
        const reask = await b.ask(instance);
        expect(changed(first, reask), `${host}: PRECONDITION — the buffered delivery changed the page view's decisions`).toBe('changed');
        expect.soft(framed(afterDelivery), `${host}: P81.PU1 — the buffered delivery is followed by the page view's pushed set`).toEqual({ pageInstance: instance, items: itemsOf(reask.body.decisions) });
      });
    }, 180_000);
  }
});

// ===========================================================================
// unit:P81.PU2 — no HTTPS re-request on a channel signal while connected; the HTTPS path stays
// ===========================================================================

describe('unit:P81.PU2', () => {
  sdkLeg('sdk: with the page view\'s first list painted, the socket\'s connected status makes no decision request', async () => {
    const p = sdkPage();
    await p.core.ready();
    await p.open({ page: 'pdp' }, page([GRID, RECO, LOOK], ['story.a']), 'first');
    await p.connect();
    await p.settle();
    expect.soft(p.snapshots.length, 'P81.PU2 — the connected status asks nothing over HTTPS: one decision request, the first list\'s (today the SDK re-requests on connected)').toBe(1);
    p.destroy();
  });

  sdkLeg('sdk: while the socket is connected, an acknowledged action makes no decision request', async () => {
    const p = sdkPage();
    await p.core.ready();
    await p.open({ page: 'pdp' }, page([GRID, RECO, LOOK], ['story.a']), 'first');
    await p.connect();
    p.snapshots.filter(s => !s.answered).forEach(s => s.answer(page([GRID, RECO, LOOK], ['story.a']), 'connected'));
    await p.settle();
    const before = p.snapshots.length;
    await p.emit.productView('COA-CH857', { line: 'Tabby', category: 'Handbags' });
    await p.settle();
    expect.soft(p.snapshots.length - before, 'P81.PU2 — the acknowledged action asks nothing over HTTPS while connected (today it re-requests)').toBe(0);
    p.destroy();
  });

  sdkLeg('sdk: LOCK — without a connected socket the page still follows over HTTPS: the first list is a POST decision request, and an acknowledged action re-requests once', async () => {
    const p = sdkPage();
    await p.core.ready();
    await p.open({ page: 'pdp' }, page([GRID, RECO, LOOK], ['story.a']), 'first');
    await p.emit.productView('COA-CH857', { line: 'Tabby', category: 'Handbags' });
    await p.settle();
    expect.soft(p.snapshots.map(x => x.method), 'P81.PU2 — the first list over POST, then one re-request after the acknowledged action, as without P81').toEqual(['POST', 'POST']);
    p.destroy();
  });

  sdkLeg('sdk: LOCK — while connected, a refresh the page itself calls (a new page view, or a re-ask) is still a POST decision request: it is how the page view reaches the engine', async () => {
    const p = sdkPage();
    await p.core.ready();
    await p.open({ page: 'pdp' }, page([GRID, RECO, LOOK], ['story.a']), 'first');
    await p.connect();
    p.snapshots.filter(s => !s.answered).forEach(s => s.answer(page([GRID, RECO, LOOK], ['story.a']), 'connected'));
    await p.settle();
    const before = p.snapshots.length;
    await p.open({ page: 'pdp', productId: 'COA-CB925' } as HydrateOptions, page([LOOK, GRID, RECO], ['story.b']), 'next');
    expect.soft(p.snapshots.length - before, 'P81.PU2 — the page\'s own refresh asks once over HTTPS').toBe(1);
    p.destroy();
  });

  sdkLeg('sdk: LOCK — the subscribe surface is unchanged: subscribe, onDecisions, hold and apply, and a pushed set of the open page view reaches the slot subscribers and onDecisions', async () => {
    const p = sdkPage();
    await p.core.ready();
    const { pageInstance } = await p.open({ page: 'pdp' }, page([GRID, RECO, LOOK], ['story.a']), 'first');
    await p.connect();
    p.snapshots.filter(s => !s.answered).forEach(s => s.answer(page([GRID, RECO, LOOK], ['story.a']), 'connected'));
    await p.settle();
    const layout: string[][] = [], sets: Array<string | undefined> = [];
    p.listen.subscribe(LAYOUT, ds => layout.push(ids(ds)));
    p.listen.onDecisions(set => sets.push(set?.pageInstance));
    await p.push(page([LOOK, EDIT, GRID], ['story.a']), pageInstance, 'pushed');
    expect.soft([['subscribe', 'onDecisions', 'hold', 'apply'].map(name => typeof (p.listen as unknown as Record<string, unknown>)[name]), layout.at(-1), sets.at(-1)],
      'P81.PU2 — the surface, and the pushed set delivered through it').toEqual([['function', 'function', 'function', 'function'], [LOOK, EDIT, GRID], pageInstance]);
    p.destroy();
  });
});

// ===========================================================================
// unit:P81.PU3 — the hold per page view governs a pushed set; consent
// ===========================================================================

describe('unit:P81.PU3', () => {
  sdkLeg('sdk: a pushed set naming another pageInstance than the page view open is not drawn: its subscribers are not called and the page keeps its set', async () => {
    const p = sdkPage();
    await p.core.ready();
    const { pageInstance } = await p.open({ page: 'pdp' }, page([GRID, RECO, LOOK], ['story.a']), 'first');
    await p.connect();
    p.snapshots.filter(s => !s.answered).forEach(s => s.answer(page([GRID, RECO, LOOK], ['story.a']), 'connected'));
    await p.settle();
    const layout: string[][] = [];
    p.listen.subscribe(LAYOUT, ds => layout.push(ids(ds)));
    const shown = layout.length;
    await p.push(page([EDIT, LOOK], ['story.z']), 'another-page-view', 'foreign');
    expect.soft([layout.slice(shown), p.listen.current()?.pageInstance], 'P81.PU3 — the other page view\'s set is not drawn (today it repaints the page)').toEqual([[], pageInstance]);
    p.destroy();
  });

  sdkLeg('sdk: LOCK — a pushed set of the same page view leaves a held slot as delivered while the other slots follow it', async () => {
    const p = sdkPage();
    await p.core.ready();
    const { pageInstance } = await p.open({ page: 'pdp' }, page([GRID, RECO, LOOK], ['story.a']), 'first');
    await p.connect();
    p.snapshots.filter(s => !s.answered).forEach(s => s.answer(page([GRID, RECO, LOOK], ['story.a']), 'connected'));
    await p.settle();
    const layout: string[][] = [], story: string[][] = [];
    p.listen.subscribe(LAYOUT, ds => layout.push(ids(ds)));
    p.listen.subscribe(STORY, ds => story.push(ids(ds)));
    p.listen.hold(LAYOUT);
    await p.push(page([LOOK, EDIT, GRID], ['story.b']), pageInstance, 'pushed');
    expect.soft([layout.at(-1), story.at(-1)], 'P81.PU3 — the held layout stays as delivered; the story follows the pushed set').toEqual([[GRID, RECO, LOOK], ['story.b']]);
    p.destroy();
  });

  sdkLeg('sdk: LOCK — known absence still restores the defaults after a pushed set: the page\'s refresh failing delivers the empty list', async () => {
    const p = sdkPage();
    await p.core.ready();
    const { pageInstance } = await p.open({ page: 'pdp' }, page([GRID, RECO, LOOK], ['story.a']), 'first');
    await p.connect();
    p.snapshots.filter(s => !s.answered).forEach(s => s.answer(page([GRID, RECO, LOOK], ['story.a']), 'connected'));
    await p.settle();
    const layout: string[][] = [];
    p.listen.subscribe(LAYOUT, ds => layout.push(ids(ds)));
    await p.push(page([LOOK, EDIT, GRID], ['story.b']), pageInstance, 'pushed');
    void p.listen.refresh();
    await p.settle();
    p.snapshots.find(s => !s.answered)?.fail();
    await p.settle();
    expect.soft(layout.at(-1), 'P81.PU3 — the failed answer restores the default').toEqual([]);
    p.destroy();
  });

  sdkLeg('sdk: LOCK — a pushed set that needs personalization consent is not emitted when the shopper refused personalization', async () => {
    const p = sdkPage({ personalization: false });
    await p.core.ready();
    const instance = 'p81-pu3-refused';
    await p.connect();
    const sets: unknown[] = [];
    p.core.on('decisions', set => sets.push(set));
    await p.push(page([LOOK, EDIT, GRID], ['story.b']), instance, 'pushed');
    expect.soft(sets.length, 'P81.PU3 — the SDK emits no personalized set without personalization consent').toBe(0);
    p.destroy();
  });

  for (const host of HOSTS) {
    it(`host (${host}, native): LOCK — nothing is pushed to a shopper who refused personalization: no content_decisions frame after the first list, an admitted action and a buffered delivery`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser({ tracking: true, personalization: false });
        const socket = await b.socket();
        const instance = `p81-pu3-refused-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(instance)).status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the action is admitted`).toBe(200);
        await b.act(VIEW_TABBY_26, true);
        await pause(1500);
        expect.soft(pushed(socket).map(framed), `${host}: P81.PU3 — no decision set is pushed without personalization consent`).toEqual([]);
      });
    }, 180_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}, native): LOCK (R-P269) — an unchanged set is never pushed again: heartbeats that change nothing, and a second socket opened for the shopper, bring no frame repeating the page view's current set`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser({ tracking: true, personalization: true });
        const first = await b.socket();
        const instance = `p81-pu3-once-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(instance)).status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        await nextPush(first, 0);
        await pause(300);
        for (let i = 0; i < 2; i++) { first.send({ type: 'heartbeat', userId: b.subject }); await pause(600); }
        const second = await b.socket();
        second.send({ type: 'heartbeat', userId: b.subject });
        await pause(600);
        first.send({ type: 'heartbeat', userId: b.subject });
        await pause(600);
        const onFirst = pushed(first).filter(f => f.pageInstance === instance).map(f => JSON.stringify(itemsOf(f.decisions)));
        const current = onFirst.at(-1);
        expect.soft({
          repeatedOnTheFirstSocket: onFirst.filter((items, i) => i > 0 && items === onFirst[i - 1]),
          repeatedOnTheSecondSocket: pushed(second).filter(f => f.pageInstance === instance && JSON.stringify(itemsOf(f.decisions)) === current).length,
        }, `${host}: P81.PU3 — the page view's set is pushed once unless it changes`).toEqual({ repeatedOnTheFirstSocket: [], repeatedOnTheSecondSocket: 0 });
      });
    }, 180_000);
  }
});

// ===========================================================================
// unit:P81.PU4 — the kit's sentences replaced
// ===========================================================================

const sentences = (text: string): string[] => text.split(/(?<=[.;])\s+(?=[A-Z`*(|])/).map(x => x.trim()).filter(Boolean);
/** A section of a kit file, from its heading to the next one, joined to one line. */
function section(file: string, heading: string): string {
  const text = readTree(file), start = text.indexOf(`\n${heading}`);
  if (start < 0) return '';
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end).split('\n').join(' ');
}
/** The paragraph (or table row) of a kit file that holds `opening`, joined to one line. */
function passage(file: string, opening: RegExp): string {
  const lines = readTree(file).split('\n'), at = lines.findIndex(l => opening.test(l));
  if (at < 0) return '';
  if (lines[at]!.startsWith('|')) return lines[at]!;
  let first = at, last = at;
  while (first > 0 && lines[first - 1]!.trim() !== '' && !lines[first - 1]!.startsWith('|') && !lines[first - 1]!.startsWith('#')) first--;
  while (last < lines.length - 1 && lines[last + 1]!.trim() !== '' && !lines[last + 1]!.startsWith('|')) last++;
  return lines.slice(first, last + 1).join(' ');
}
const PUSH = (s: string) => /content_decisions/.test(s) && /\b(sends?|sent|pushe[sd]?|delivers?|delivered)\b/i.test(s);
const HTTPS = (s: string) => /\b(HTTPS|POST|snapshot)\b/.test(s) && /first list|before the (socket|connection)|not connected|server|no socket/i.test(s);
/** Each passage: the disclaimer it carries today, gone; the push stated; for the passages on how the page follows, when the HTTPS request is used. */
const PLACES: Array<{ name: string; text: () => string; disclaimer: RegExp; https: boolean }> = [
  { name: 'kit 01 :150 (refresh)', text: () => passage('docs/kit/01-integration-guide.md', /^`listen\.refresh\(\{page\}\)`/), disclaimer: /socket connection\/reconnection refresh automatically/, https: true },
  { name: 'kit 01 :422 (the frame row)', text: () => passage('docs/kit/01-integration-guide.md', /^\| `content_decisions` \|/), disclaimer: /no production sender|client-supported frame shape/, https: false },
  { name: 'kit 01 :435 (section 6, the live channel)', text: () => section('docs/kit/01-integration-guide.md', '## 6. The live channel'), disclaimer: /The socket is optional|not a promised production frame/, https: true },
  { name: 'kit 02 :250 (the live channel)', text: () => passage('docs/kit/02-api-reference.md', /^The live channel; a WebSocket upgrade/), disclaimer: /only a client-compatible shape|current content delivery uses supported snapshot refresh/, https: true },
  { name: 'kit 03 :70 (the decision)', text: () => passage('docs/kit/03-payload-schemas.md', /^One item in snapshot `decisions\[\]`/), disclaimer: /not a production delivery promise|client-compatible historical frame/, https: false },
  { name: 'kit 03 (the socket frames row)', text: () => passage('docs/kit/03-payload-schemas.md', /^\| `content_decisions` \|/), disclaimer: /no production sender promised|Client-compatible only/, https: false },
];

describe('unit:P81.PU4', () => {
  it('logic: each kit passage that disclaims the push (kit 01 :150, :422, :435; kit 02 :250; kit 03 :70 and the socket frames row) states the push instead, and where it says how the page follows, when the HTTPS request is used', () => {
    const states = PLACES.map(place => {
      const text = place.text(), said = sentences(text);
      return [place.name, text === '' ? 'passage not found' : place.disclaimer.test(text) ? 'still disclaims the push' : 'no disclaimer',
        said.some(PUSH) || PUSH(text) ? 'states the push' : 'states no push', place.https ? (said.some(HTTPS) ? 'states when HTTPS is used' : 'states no HTTPS use') : 'n/a'];
    });
    expect.soft(states, 'P81.PU4 — the kit states the push').toEqual(PLACES.map(place => [place.name, 'no disclaimer', 'states the push', place.https ? 'states when HTTPS is used' : 'n/a']));
  });
});
