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
//   · THE CHANGE TRIGGERS, fixed (R-P272, R-P273): the page's own decision request is answered in its response and is
//     NEVER also pushed; a frame is sent only when the set differs from the set the page view last received by either
//     channel (its own answer or a frame). A socket's opening is NOT a trigger and decides nothing (R-P273): a
//     publication change between the page's answer and the socket's opening is pushed at the first heartbeat after the
//     opening, an unchanged window brings nothing, and an action taken without a socket is followed over HTTPS by the
//     SDK (PU2's lock). The triggers: (1) an admitted action; (2) a buffered delivery, applied at its delivery (the
//     interest is persisted before the answer on both hosts; the alarm settles the carried outcome only, the
//     reviewer's finding 9); (3) a publication change, sent at the latest at the socket's next heartbeat. Each push
//     names the open page view's pageInstance and carries the set a request for it then gets. No push without the
//     shopper's personalization consent, also after a withdrawal; a mid-page grant brings no frame by itself and takes
//     effect at the next admitted action (R-P281). R-P269: a trigger that leaves the set unchanged sends
//     no frame (heartbeats, a second socket, an unchanged action, the page's re-ask). A second page view (another
//     decision request) replaces the first. A new browser's first request (P13, no session) is decided before any
//     explicit choice, so with tracking withheld (src/content/consent.ts carryConsent: no instruction is REFUSING), and
//     CW31 has the engine write nothing about such a request (consent.ts's header; service.ts decideContent's `write`):
//     its page view is not kept, and only the page's next decision request under the choice opens the page view the
//     issued session's socket is pushed to (S22 round 3: R-P272's first-request reading measured against CW31).
//   · THE PAGE VIEW AT REST (R-P271): the open page view is kept under the shopper's own object (one key, `pushView` on
//     both hosts as the builder named it, R-P273; the latest page view, overwritten per page view, removed at the last
//     socket's close, never retained by the erasure, eraseWithBarrier): a push survives the object's restart (the
//     object host's hibernation eviction with its socket attached; the session host's owner object reset while its
//     relay keeps the socket); after the socket closes, or after the erasure, nothing is pushed and no stored key names
//     the page view's pageInstance. Fix round 1 (R-P281 and its clarification): it is kept for a request decided under
//     tracking consent, whatever the personalization choice (CW31-exact; the sends keep requiring personalization), and
//     keeps no refusal hint to replay: a re-decision reads the consent in force, so a mid-page grant is honoured at the
//     next admitted action (as the round-3 withdrawal is). The shopper's object acts on its own revocations: a logout
//     (identity detach) leaves no page view at rest. A socket whose grant lapses is closed by the relay at its heartbeat
//     and the object hears nothing (the relay cannot sign for a lapsed grant); it counts as no socket, so an admitted
//     action decides nothing again (R-P269(3)), and the page view at rest goes unless its own grant is still live. The
//     profile's retention expiry deletes it with the profile (W06.BASE.02). The relay door accepts nothing without a
//     valid principal: a `closed` notice with no capability, or another shopper's, is refused and changes nothing.
//   · THE SDK: neither a 'connected' status nor an acknowledged action re-requests while the socket is connected; while
//     it is not connected an acknowledged action re-requests as today (so a page without a socket still follows); a
//     page view's first list, and every refresh the page itself calls, is asked over HTTPS (that request is how the
//     page view reaches the engine). A pushed set naming another pageInstance than the page view open is not drawn.
//   · PU4: read by sentence; each disclaimer is gone and the passage states the push (and, where the kit says how the
//     page refreshes, when the HTTPS request is used).
//
// R10 (expectations P81 changes), each test-only in R-P195's form: src/units/P34/LEDGER.unit.test.ts T5's two legs and
// T1's 'a socket open' leg (granted, R-P269: no HTTPS refresh follows a socket open); src/units/P72/LEDGER.unit.test.ts
// BD3's measured round trip read as 378 ms or, alone, the largest 478 ms (granted, R-P271; R-P243). RED on today's
// product, GREEN under the fix.
//
// DEFERRED, with the reason: the ledger's records and receipts of a pushed decision are not read natively, because
// src/units/_native.ts binds no queue (the acknowledgement admitted `durable` is the boundary checked); several tabs of one
// shopper are not exercised, because the harness opens one page view per shopper. TOLD, not a leg: an alarm-time change
// of another kind (the profile's retention expiry deleting affinity, pipeline and, since fix round 1, the page view at
// rest) reaches the page only at its next request: a page without a live connection makes one after each action, while
// a connected page's next action re-decides nothing, the page view being gone. TOLD, not a leg (R-P282 (4)): a page view
// kept for a shopper who never forms a profile has no retention bound of its own; it goes at the socket's close, a
// logout, a lapsed socket grant, the next page view or the erasure. TOLD, not a leg (R-P273): a
// heartbeat's push re-signs the stored principal's claims, so after the session grant's lifetime nothing is pushed
// until the page's next request renews it. TOLD, not a leg (CW31): after a new visitor's first choice, the page view
// its first request opened is pushed to only once the page asks again, because the SDK does not ask again on a
// consent grant (src/sdk/listen.ts: a consent change only withdraws). Kit 02 states, beside the grant-lifetime and the
// first-request residuals, the retention-expiry residual above and that the newest tab's page view takes the pushes
// (R-P281 finding 3, the builder's sentences, read by the review; no leg). TOLD, a LIVE1 risk: whether the relay can be
// evicted before its close notice (kept alive by its waitUntil) reaches the shopper's object is not measurable locally.
// TOLD, not a leg (R-P286): with several sockets under different grants, the session host's socket flag follows the
// socket that last reported, so a lapse of that one grant pauses the pushes until another socket's next heartbeat (25 s).
//
// FIXTURE. P02's product page (src/units/_parity.ts: the registered modules, the declared layout slot measured
// rendered-v1); a shopper who viewed nothing, whose page view then follows a Tabby view (COA-CH857), live or buffered,
// and a Willow view (COA-C2621) after it; the operator's slots publication that has the layout slot take two modules.
// The host legs run the real Worker in workerd on each shopper host (src/units/_native.ts, P66's native world), with the
// real socket; the SDK legs drive createCore, createListen and createEmit on the test host with a fake socket. Fix round
// 1 adds fixture doors to the wrapper only: the Worker's clock moved ahead (a module offset on Date.now, W16's native
// pattern), the shopper's object's alarm run (W16's door), a second grant of the same shopper and session as a continuity
// return issues one (a new grantId under the authority's epoch), the requests the object and the relay received (the
// relay's broadcasts with their frame type: on the session host a re-decision is observed by the set it sends the
// relay; one that sends nothing is not observable natively), and a frame sent to the object's relay door under a given
// capability or none; a world can carry a one-hour profile retention.
//
// NO NEW EXPORT IS IMPORTED.
//
// MEASURED (round 3: R-P271, R-P272, R-P273; _evidence/parity-step3/S22/specifier/logs/r6/, serial, --no-cache, working
// directory the tree): on the product before the build (3922dbe8, P80 merged) 20 RED for the missing behaviour (no
// content_decisions frame after an action, a buffered delivery, a publication change at the heartbeat or a second page
// view, on either host; nothing kept at rest, so the closed-socket and erasure legs stop at their PRECONDITION; the SDK
// re-requests on 'connected' and on an acknowledged action while connected and draws another page view's set; the kit
// disclaims the push), the 13 locks GREEN. On the builder's 55dfad1c, 1 RED: the erasure on the session host never
// answers (bounded at 30 s): the relay's close notice (PersonalizationWebSocket.ts handleWebSocketClose, notifyClosed)
// awaits the shopper's object while that object's erasure awaits the relay's revoke (ShopperReflex.ts eraseWithBarrier);
// with the notice not awaited the erasure answers in 233 ms (logs/r4/probe2.log).
// NEGATIVE CONTROLS (scratch trees, never committed; _evidence/parity-step3/S22/specifier/sketches/p81r4.py on 3922dbe8):
// the fix (the shopper's object keeps the page view a decision request opened, only under tracking consent (CW31), under
// one key `pushView`, never pushing that answer; after an admitted action and at a socket heartbeat it decides the page
// view again through the route, right after the answer through P56's continueAfterOwnerAnswer and only while the shopper
// holds a socket, and pushes a set that differs from the one the page last received; a socket's opening decides
// nothing; the view goes at the first trigger after its last socket closed, and with the erasure; the SDK re-requests
// only without a connected socket and draws no other page view's set; the kit's six passages) turns all 33 GREEN three
// times; `openpush` (the socket's opening decides again and pushes a changed set: R-P272's reading) turns PU1's window
// leg RED on both hosts; `chatty` (a push at every trigger) and `chattyaction` (a push after every action) turn PU3's
// unchanged-set lock RED on both hosts; `fixa` (a request decided with tracking withheld kept, without the four members
// P13 forbids a store to hold) turns the first-request leg RED on both hosts, the rest of the suite green (CW31 is its
// only bar; logs/r4/fixa-suite.json); round 1's `norecord`, `ignorehold`, `keeprerequest` and `otherdrawn` stand
// (logs/d/). A sketch keeping the raw request under withheld tracking turned P13.H4 RED on both hosts (R-P67: a store
// held the carried identifier and the browsing session; logs/r4/fix-suite.json). Under the fix P13, P34, P70 and P72 are
// green and the SDK bundles stay within budget (IIFE 110 388 of 112 640). Constraints a build keeps, from earlier
// sketches: pushing before the answer turned P64.OT4, P65.RS3, P67.OM2 and P70.WB2 RED (no remote call before the
// answer); a re-decision without a socket turned P02.A3 RED (a served-v1 capture per re-decision); added lines turned
// P68.KT1 RED (kit 02 cites ShopperReflex.ts and listen.ts by line); a continuation scheduled without a socket turned
// W36.S2 RED (the session projection read again after its write).
// The whole-suite comparison (R-P248; vitest run src on 55dfad1c with this round's tests, logs/r4/today-suite.json, and
// under the fix, logs/r6/fix-suite.json): beyond the scratch tree's own artifacts (no git repository, no wrangler
// variants: root.worker, P45-P47, P51-P53, W39, W40, failing on both), the two differ only on W36.S2 (session: the
// sketch's continuation, the constraint above, which 55dfad1c keeps) and on P81's own legs (on 55dfad1c the erasure
// leg on the session host, and the first-request leg in its first reading, since read against CW31).
//
// FIX ROUND 1 (R-P281 and its clarification; _evidence/parity-step3/S22/specifier/logs/fix1b/, serial, --no-cache,
// working directory the tree): eleven legs under PU3 — (a) the logout, (c) the retention expiry, (d) the personalization
// grant after a declined choice and after a refusal hint, and the relay door's LOCK, on both hosts; (b) the lapsed grant
// on the session host. On the join f4cd9e13, 8 RED for the missing behaviour: (a) on the session host
// `keysNamingThePageView: ["pushView"]` (the object host closes its own sockets and is clean, GREEN); (b) both shoppers'
// next actions send the relay a re-decided set (`"POST /owner/broadcast content_decisions"`) and b's page view stays;
// (c) `expected [ 'pushView' ] to deeply equal []` on both hosts; (d) `keptAtTheAnswer: "not kept"`, `atTheNextAction:
// "no content_decisions frame"` on both hosts, for both legs; the LOCK GREEN. On the builder's 78e08d9a (read-only
// archive) all 44 GREEN. NEGATIVE CONTROLS (sketches/p81fix1.py on f4cd9e13): the fix 44/44 three times; `permissive` (the
// relay door honouring `closed` without a valid principal, the logout and the lapse left to the relay's notice) turns the
// LOCK RED on both hosts and (b) RED (a lapsed grant's notice is never signed); `nodetach` turns (a) RED; `noexpiry` (b);
// `noretention` (c) on both hosts; `persgate` (the build's personalization gate) both (d) legs on both hosts; `replay`
// (the refusal hint replayed at a re-decision) the hint leg on both hosts (`personalizationInForceAfterThePush: false`:
// the grant undone); `dropview` (the page view dropped at a lapsed socket whatever its own grant) (b)'s kept case. Under
// the fix P13, P34, P72, P70, W36, P68, P02, P64-P67, src/reflex, src/index.api-boundary.test.ts and
// src/routes/realtime.sdkContract.test.ts pass, 603/603; the whole suite under the fix (logs/fix1b/fix-suite.json) fails
// only the scratch tree's own artifacts (root.worker, P45-P47, P51-P53, W39, W40), W36.S2 included green.
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
  declaredSlots, HOSTS, layoutSlot, LAYOUT, learnDocument, MODULES, PAGE_VIEW, readTree, productView, REFLEX_DOCUMENT, TENANT, VIEW_TABBY_26, type Host,
} from '../_parity';

const STORY = 'pdp-story';
/** A Willow shoulder bag (COA-C2621, src/data/coach-catalog.json): after the Tabby view it moves the Willow module up the layout (measured). */
const VIEW_WILLOW = productView({ productId: 'COA-C2621', line: 'Willow', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['work', 'everyday'], price_usd: 450 });

// ===========================================================================
// The host legs: the real Worker in workerd, both shopper hosts, a real socket.
// ===========================================================================

const NATIVE_SECRET = 'p81-native-operator-signing-material';
/**
 * P66's native wrapper (src/units/P66/LEDGER.unit.test.ts `NATIVE_WRAPPER`): a door that publishes the documents and one
 * that mints an anonymous grant. Round 3 (R-P271, R-P272) adds, from the test only, the shopper's object as a wrapper
 * subclass (as src/index.api-boundary.test.ts wraps LearnStats) with three fixture doors: its instance (a fresh one
 * after a restart), its reset (`state.abort`, the session host's restart: its socket lives in the relay), and the keys of
 * its storage whose value names a string (the page view's pageInstance).
 */
const NATIVE_WRAPPER = `
import worker, { ShopperReflex as BaseShopperReflex, PersonalizationWebSocket as BasePersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { PRIORS_KIND } from './src/learn/priors.ts';
import { newAnonymousSession, signSessionCapability, SHOPPER_HEADER } from './src/identity/sessionCapability.ts';
import { shopperObjectName } from './src/tenancy/objects.ts';
export { DecisionRing, LearnStats, RegionTrend };
export class PersonalizationWebSocket extends BasePersonalizationWebSocket {
  constructor(state, env) { super(state, env); this.p81Paths = []; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/__p81_paths') return Response.json({ paths: this.p81Paths });
    let type = '';
    if (path === '/owner/broadcast') { try { type = ' ' + String((await request.clone().json()).payload?.type); } catch { type = ' unreadable'; } }
    this.p81Paths.push(request.method + ' ' + path + type);
    return super.fetch(request);
  }
}
const p81RealNow = Date.now.bind(Date);
let p81Offset = 0;
Date.now = () => p81RealNow() + p81Offset;
export class ShopperReflex extends BaseShopperReflex {
  constructor(state, env) { super(state, env); this.p81Instance = crypto.randomUUID(); this.p81State = state; this.p81Env = env; this.p81Paths = []; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__p81_paths') return Response.json({ paths: this.p81Paths });
    if (url.pathname === '/__p81_alarm') { await this.alarm(); return Response.json({ ran: true }); }
    if (url.pathname === '/__p81_grant') {
      const authority = await this.p81State.storage.get('grantAuthority'), first = Object.values(authority.grants)[0];
      const iat = Math.floor(Date.now() / 1000), grant = { ...first, grantId: crypto.randomUUID(), iat, exp: iat + 86400 };
      authority.grants[grant.grantId] = grant;
      await this.p81State.storage.put('grantAuthority', authority);
      return Response.json(await signSessionCapability(this.p81Env, grant));
    }
    if (!url.pathname.startsWith('/__p81_')) this.p81Paths.push(request.method + ' ' + url.pathname);
    if (url.pathname === '/__p81_instance') return Response.json({ instance: this.p81Instance });
    if (url.pathname === '/__p81_restart') { this.p81State.abort('p81 fixture restart'); return Response.json({ restarted: true }); }
    if (url.pathname === '/__p81_keys') {
      const needle = url.searchParams.get('needle'), keys = [];
      for (const [key, value] of await this.p81State.storage.list()) if (JSON.stringify(value === undefined ? null : value).includes(needle)) keys.push(key);
      return Response.json({ keys });
    }
    return super.fetch(request);
  }
}
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
    if (url.pathname === '/clock') { p81Offset = input.offset; return Response.json({ now: Date.now() }); }
    const object = env.SHOPPER_REFLEX.get(env.SHOPPER_REFLEX.idFromName(shopperObjectName(input.tenant, input.subject)));
    if (url.pathname === '/instance') return object.fetch('https://shopper-reflex/__p81_instance');
    if (url.pathname === '/keys') return object.fetch('https://shopper-reflex/__p81_keys?needle=' + encodeURIComponent(input.needle));
    if (url.pathname === '/paths') return object.fetch('https://shopper-reflex/__p81_paths');
    if (url.pathname === '/relay-paths') return env.PERSONALIZATION_WEBSOCKET.get(env.PERSONALIZATION_WEBSOCKET.idFromName(shopperObjectName(input.tenant, input.subject))).fetch('https://relay/__p81_paths');
    if (url.pathname === '/alarm') return object.fetch('https://shopper-reflex/__p81_alarm');
    if (url.pathname === '/second-grant') return object.fetch('https://shopper-reflex/__p81_grant');
    if (url.pathname === '/relay-frame') {
      const response = await object.fetch('https://shopper-reflex/authority/relay-frame', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant': input.tenant, ...(input.capability ? { [SHOPPER_HEADER]: input.capability } : {}) },
        body: JSON.stringify({ connectionId: crypto.randomUUID(), type: input.type }) });
      return Response.json({ status: response.status });
    }
    if (url.pathname === '/restart') { try { await object.fetch('https://shopper-reflex/__p81_restart'); } catch (error) { return Response.json({ restarted: String(error) }); } return Response.json({ restarted: 'without error' }); }
    return new Response(null, { status: 404 });
  },
};`;
let nativeBundle: Promise<string> | undefined;

interface Answer { status: number; body: Record<string, unknown> }
interface Frame { type?: string; page?: string; pageInstance?: string; decisions?: Array<{ contentId: string; slot: string; decisionId?: string; renderOffer?: string; order?: number }>; [k: string]: unknown }
interface NativeSocket { frames: Frame[]; send: (frame: unknown) => void; waitFor: (predicate: () => boolean, ms?: number) => Promise<boolean>; close: () => void }
interface Session { capability: string; subject: string; sessionId: string; grantId: string; iat: number; exp: number; consent?: { instruction?: { revision?: unknown } } }
interface Browser {
  subject: string; sessionId: string; capability: string;
  call: (path: string, body?: unknown) => Promise<Answer>;
  /** A decision request for the page view, the route the SDK posts. */
  ask: (pageInstance: string) => Promise<Answer>;
  /** A live action, as the SDK posts it; `buffered` makes it a buffered delivery. */
  act: (event: { type: string; data: Record<string, unknown> }, buffered?: boolean) => Promise<Answer>;
  /** The shopper's choice again (P05's preferences route), against the revision of the choice in force. */
  choose: (consent: { tracking: boolean; personalization: boolean }, expectedRevision?: unknown) => Promise<Answer>;
  socket: (capability?: string) => Promise<NativeSocket>;
  /** A decision request for the page view under another capability of the same shopper, with a cookie header if given (fix round 1). */
  askWith: (capability: string, pageInstance: string, cookie?: string) => Promise<Answer>;
  /** A decision request for the page view with further members of the SDK's body (fix round 2: its consent hints). */
  askBody: (pageInstance: string, members: Record<string, string>) => Promise<Answer>;
  /** A live action under another capability of the same shopper (fix round 1: a second grant). */
  actWith: (capability: string, event: { type: string; data: Record<string, unknown> }) => Promise<Answer>;
}
interface NativeWorld {
  browser: (consent: { tracking: boolean; personalization: boolean }) => Promise<Browser>;
  /** A new browser's first decision request (no session, P13): its answer, and the browser of the session it issued (its choice made then). */
  firstRequest: (pageInstance: string, consent: { tracking: boolean; personalization: boolean }) => Promise<{ answer: Answer; browser: Browser | null }>;
  publishSlots: (document: unknown) => Promise<Answer>;
  /**
   * The shopper's object restarted, its socket kept: on the object host evicted by the runtime after 20 s idle (its
   * hibernated socket attached), on the session host reset by the fixture door (its socket lives in the relay). Answers
   * whether a fresh instance now serves the shopper (the instance door before and after).
   */
  restart: (b: Browser) => Promise<string>;
  /** The keys of the shopper's object whose stored value names `needle`. */
  keysNaming: (b: Browser, needle: string) => Promise<string[]>;
  /** The shopper's erasure through the operator's route (`POST /v1/{tenant}/identity/erase`), resumed while pending, bounded at 30 s. */
  erase: (b: Browser) => Promise<Answer>;
  /** Fix round 1: the browser of a session the engine issued (a logout's replacement), its choice made and its page view admitted. */
  adopt: (session: Session, consent: { tracking: boolean; personalization: boolean }) => Promise<Browser>;
  /** Fix round 1: the Worker's clock moved `seconds` ahead (the wrapper's offset on Date.now, W16's pattern); the actions' timestamps follow it. */
  clock: (seconds: number) => Promise<void>;
  /** Fix round 1: the shopper's object's own alarm handler run now (W16's door). */
  alarm: (b: Browser) => Promise<void>;
  /** Fix round 1: a second grant of the same shopper and session, as a continuity return issues one (a new grantId under the authority's epoch, from now). */
  secondGrant: (b: Browser) => Promise<string>;
  /** Fix round 1: the paths of the requests the shopper's object received (this instance), in order. */
  paths: (b: Browser) => Promise<string[]>;
  /** Fix round 1: the requests the shopper's relay (session host) received, in order; a broadcast with its frame's type (`POST /owner/broadcast content_decisions`: a push sent to it). */
  relayPaths: (b: Browser) => Promise<string[]>;
  /** Fix round 1: a relay frame sent to the shopper's object's relay door, under `capability` (or none); the door's status. */
  relayFrame: (b: Browser, capability: string | null, type: string) => Promise<number>;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** One host in workerd: the documents published, then `work` (P66's native world, with the socket). */
async function nativeWorld<T>(host: Host, work: (w: NativeWorld) => Promise<T>, options: { profileMs?: number } = {}): Promise<T> {
  const bundle = await (nativeBundle ??= bundleNativeWorker(NATIVE_WRAPPER, 'p81-ledger-native'));
  const directory = nativeScratchDirectory('p81-ledger-native-');
  const policy = { id: 'p81-native-policy', revision: 1, durationMs: 3650 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
  const runtime = await openNativeRuntime({ bundle, name: `p81-native-${host}`, persistDir: directory.path,
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket', DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
    kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
    bindings: { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host, JWT_SECRET: NATIVE_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      IDENTITY_SECRETS: `${TENANT}:p81-native-identity`, LEDGER_RECOVERY_ENABLED: 'true', TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
      RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category,
        category === 'profile' && options.profileMs !== undefined ? { ...policy, id: 'p81-native-profile', durationMs: options.profileMs } : policy])) } }) } });
  let offsetMs = 0;
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
    /** The browser of a session: its explicit choice (the revision of the choice in force tracked), then its page view. */
    const browserOf = async (g: Session, consent: { tracking: boolean; personalization: boolean }): Promise<Browser> => {
      let revision: unknown = g.consent?.instruction?.revision ?? null;
      const call = async (path: string, body?: unknown) => parsed(await runtime.fetch(`https://shop.example${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: g.capability, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      const choose = async (choice: { tracking: boolean; personalization: boolean }, expectedRevision?: unknown) => {
        const answer = await call(`/realtime/session/${g.sessionId}/preferences`, { trackingConsent: choice.tracking, personalizationEnabled: choice.personalization,
          choice: { id: crypto.randomUUID(), expectedRevision: expectedRevision === undefined ? revision : expectedRevision, grantId: g.grantId, iat: g.iat, exp: g.exp } });
        revision = (answer.body.consent as { instruction?: { revision?: unknown } } | undefined)?.instruction?.revision ?? revision;
        return answer;
      };
      expect((await choose(consent)).status, `PRECONDITION (${host} native): the shopper's explicit choice`).toBe(200);
      const act = (event: { type: string; data: Record<string, unknown> }, buffered = false) => call('/realtime/action', { ...event, source: 'sdk', userId: g.subject, sessionId: g.sessionId,
        eventId: crypto.randomUUID(), ...(buffered ? { processing: 'buffered', timestamp: Date.now() + offsetMs - 60_000, browsingSessionId: g.sessionId } : { timestamp: Date.now() + offsetMs }) });
      const actWith = async (capability: string, event: { type: string; data: Record<string, unknown> }) => parsed(await runtime.fetch('https://shop.example/realtime/action', { method: 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: capability, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, source: 'sdk', userId: g.subject, sessionId: g.sessionId, eventId: crypto.randomUUID(), timestamp: Date.now() + offsetMs }) }));
      expect((await act(PAGE_VIEW)).status, `PRECONDITION (${host} native): the shopper's page view`).toBe(200);
      const socket = async (capability = g.capability): Promise<NativeSocket> => {
        const response = await runtime.fetch(`https://shop.example/realtime/ws?tenant=${TENANT}`, { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `shopper-session-v1, ${capability}` } });
        const ws = (response as unknown as { webSocket?: { accept(): void; send(data: string): void; close(code: number, reason: string): void;
          addEventListener(type: string, listener: (event: { data: unknown }) => void): void } }).webSocket;
        expect([response.status, Boolean(ws)], `PRECONDITION (${host} native): the socket is upgraded`).toEqual([101, true]);
        const frames: Frame[] = [];
        ws!.addEventListener('message', event => { try { frames.push(JSON.parse(String(event.data)) as Frame); } catch { /* not JSON */ } });
        ws!.accept();
        sockets.push(ws!);
        const waitFor = async (predicate: () => boolean, ms = 3000) => { const until = Date.now() + ms; while (!predicate() && Date.now() < until) await pause(20); return predicate(); };
        expect(await waitFor(() => frames.some(f => f.type === 'connected')), `PRECONDITION (${host} native): the socket's welcome frame`).toBe(true);
        return { frames, send: frame => { try { ws!.send(JSON.stringify(frame)); } catch { /* a closed socket sends nothing */ } }, waitFor, close: () => { try { ws!.close(1000, 'p81 page left'); } catch { /* closed */ } } };
      };
      const ask = (pageInstance: string) => call(`/v1/${TENANT}/decisions/snapshot`, { page: 'pdp', brand: TENANT, pageInstance });
      const askWith = async (capability: string, pageInstance: string, cookie?: string) => parsed(await runtime.fetch(`https://shop.example/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: capability, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify({ page: 'pdp', brand: TENANT, pageInstance }) }));
      const askBody = (pageInstance: string, members: Record<string, string>) => call(`/v1/${TENANT}/decisions/snapshot`, { page: 'pdp', brand: TENANT, pageInstance, ...members });
      return { subject: g.subject, sessionId: g.sessionId, capability: g.capability, call, ask, act, choose, socket, actWith, askWith, askBody };
    };
    const browser = async (consent: { tracking: boolean; personalization: boolean }) => browserOf(await fixture('/grant', { tenant: TENANT }) as unknown as Session, consent);
    const firstRequest = async (pageInstance: string, consent: { tracking: boolean; personalization: boolean }) => {
      const answer = await parsed(await runtime.fetch(`https://shop.example/v1/${TENANT}/decisions/snapshot`, { method: 'POST', headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'pdp', brand: TENANT, pageInstance }) }));
      const session = answer.body.session as Session | undefined;
      return { answer, browser: answer.status === 200 && typeof session?.capability === 'string' ? await browserOf(session, consent) : null };
    };
    const instanceOf = async (b: Browser) => String((await fixture('/instance', { tenant: TENANT, subject: b.subject })).instance);
    const restart = async (b: Browser) => {
      const before = await instanceOf(b);
      if (host === 'do') await pause(20_000); else await fixture('/restart', { tenant: TENANT, subject: b.subject });
      return (await instanceOf(b)) === before ? 'the same instance' : 'a fresh instance';
    };
    const keysNaming = async (b: Browser, needle: string) => (await fixture('/keys', { tenant: TENANT, subject: b.subject, needle })).keys as string[];
    const erase = async (b: Browser): Promise<Answer> => {
      const erasing = (async () => {
        let answer = await operator('POST', `/v1/${TENANT}/identity/erase`, { visitorId: b.subject });
        for (let resume = 0; answer.body.status === 'pending' && resume < 40; resume++) { await pause(250); answer = await operator('POST', `/v1/${TENANT}/identity/erase`, { visitorId: b.subject }); }
        return answer;
      })().catch((error: unknown): Answer => ({ status: 0, body: { error: String(error) } }));
      // Bounded, so an erasure that never answers is named rather than timing the leg out (it answers within a second here).
      return Promise.race([erasing, pause(30_000).then((): Answer => ({ status: 0, body: { error: 'the erasure did not answer within 30 s' } }))]);
    };
    const clock = async (seconds: number) => { offsetMs = seconds * 1000; await fixture('/clock', { offset: offsetMs }); };
    const alarm = async (b: Browser) => { await fixture('/alarm', { tenant: TENANT, subject: b.subject }); };
    const secondGrant = async (b: Browser) => String((await fixture('/second-grant', { tenant: TENANT, subject: b.subject })).capability);
    const paths = async (b: Browser) => (await fixture('/paths', { tenant: TENANT, subject: b.subject })).paths as string[];
    const relayPaths = async (b: Browser) => (await fixture('/relay-paths', { tenant: TENANT, subject: b.subject })).paths as string[];
    const relayFrame = async (b: Browser, capability: string | null, type: string) => Number((await fixture('/relay-frame', { tenant: TENANT, subject: b.subject, capability, type })).status);
    return await work({ browser, firstRequest, publishSlots, restart, keysNaming, erase, adopt: browserOf, clock, alarm, secondGrant, paths, relayPaths, relayFrame });
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
/** The frames a socket received for one page view after `count`, as they read. */
const since = (socket: NativeSocket, count: number, instance?: string) => pushed(socket).slice(count).filter(f => instance === undefined || f.pageInstance === instance).map(framed);
const FULL = { tracking: true, personalization: true };
/** R-P273: the one key of the shopper's object the open page view is kept under (the builder's, both hosts). */
const PUSH_VIEW_KEY = 'pushView';

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
    it(`host (${host}, native): with the page view open on a connected socket, its own answer is not pushed again (R-P272); the engine pushes its decision set as a content_decisions frame naming its pageInstance after an admitted action that changes it, and after a publication change (at the socket's next heartbeat at the latest), each the set a request for that page view then gets; a pushed decision's acknowledgement is admitted as a request's is; another shopper's socket receives none of it`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL), other = await w.browser(FULL);
        const socket = await b.socket(), otherSocket = await other.socket();
        const instance = `p81-pu1-${host}-${crypto.randomUUID()}`;
        // The page view's first list: its own answer, never pushed again.
        const first = await b.ask(instance);
        expect(first.status, `${host}: PRECONDITION — the server's POST snapshot answers the page view's first list (${JSON.stringify(first.body).slice(0, 160)})`).toBe(200);
        await pause(1000);
        const ownAnswer = since(socket, 0, instance);
        // An admitted action that changes the page view's decisions.
        let count = pushed(socket).length;
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        const afterAction = await nextPush(socket, count);
        await pause(300);
        const reask = await b.ask(instance);
        expect(changed(first, reask), `${host}: PRECONDITION — the action changed the page view's decisions`).toBe('changed');
        const layout = (afterAction?.decisions ?? []).filter(d => d.slot === LAYOUT).sort((a, c) => (a.order ?? 0) - (c.order ?? 0));
        const offered = layout[0];
        const ack = offered ? await b.call('/realtime/action', { type: 'content_impression', source: 'sdk', userId: b.subject, sessionId: b.sessionId, eventId: crypto.randomUUID(),
          timestamp: Date.now(), data: { contentId: offered.contentId, slot: offered.slot, decisionId: offered.decisionId, renderOffer: offered.renderOffer, page: 'pdp', pageInstance: instance,
            position: offered.order ?? 0, slotPosition: 0 } }) : null;
        await pause(300);
        // A publication change: the layout slot takes two modules.
        count = pushed(socket).length;
        expect((await w.publishSlots(declaredSlots([layoutSlot({ take: 2 })]))).status, `${host}: PRECONDITION — the operator publishes the slots change`).toBe(200);
        socket.send({ type: 'heartbeat', userId: b.subject });
        const afterPublication = await nextPush(socket, count);
        await pause(300);
        const republished = await b.ask(instance);
        expect.soft({
          ownAnswer,
          afterAction: framed(afterAction),
          offers: afterAction ? (afterAction.decisions ?? []).every(d => typeof d.decisionId === 'string' && typeof d.renderOffer === 'string') : 'no content_decisions frame',
          acknowledged: ack ? [ack.status, (ack.body.render as { status?: unknown } | undefined)?.status ?? null] : 'no pushed decision to acknowledge',
          afterPublication: framed(afterPublication),
          onAnotherShoppersSocket: pushed(otherSocket).map(framed),
        }, `${host}: P81.PU1 — the page view's set is pushed after an admitted action and after a publication change, never its own answer again, and to this shopper alone`).toEqual({
          ownAnswer: [],
          afterAction: { pageInstance: instance, items: itemsOf(reask.body.decisions) },
          offers: true,
          acknowledged: [200, 'durable'],
          afterPublication: { pageInstance: instance, items: itemsOf(republished.body.decisions) },
          onAnotherShoppersSocket: [],
        });
      });
    }, 180_000);

    it(`host (${host}, native): R-P273 — the first list answered before the socket opens: a publication change in between is pushed at the first heartbeat after the socket opens (a frame naming the page view's pageInstance, the set a request then gets), the socket's opening itself pushing nothing; with nothing changed in between, the socket's opening pushes nothing`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL), c = await w.browser(FULL);
        const changedInstance = `p81-pu1-window-changed-${host}-${crypto.randomUUID()}`, sameInstance = `p81-pu1-window-same-${host}-${crypto.randomUUID()}`;
        // A window in which nothing changes: the answer, then the socket.
        expect((await c.ask(sameInstance)).status, `${host}: PRECONDITION — the other page view's first list is answered`).toBe(200);
        const quiet = await c.socket();
        await pause(1500);
        const unchangedAtTheOpen = since(quiet, 0);
        // A window in which the operator's publication changes the page view's set: the answer, the publication, then the socket.
        const first = await b.ask(changedInstance);
        expect(first.status, `${host}: PRECONDITION — the first list is answered before the socket opens`).toBe(200);
        expect((await w.publishSlots(declaredSlots([layoutSlot({ take: 2 })]))).status, `${host}: PRECONDITION — the operator publishes the slots change before the socket opens`).toBe(200);
        const socket = await b.socket();
        await pause(1500);
        const atTheOpen = since(socket, 0, changedInstance);
        const count = pushed(socket).length;
        socket.send({ type: 'heartbeat', userId: b.subject });
        const atTheFirstHeartbeat = await nextPush(socket, count);
        await pause(300);
        const reask = await b.ask(changedInstance);
        expect(changed(first, reask), `${host}: PRECONDITION — the publication changed the page view's set between the answer and the socket's opening`).toBe('changed');
        expect.soft({ unchangedAtTheOpen, atTheOpen, atTheFirstHeartbeat: framed(atTheFirstHeartbeat) },
          `${host}: P81.PU1 — a socket's opening decides nothing; a change in the window reaches the page at the first heartbeat (R-P273)`).toEqual({
          unchangedAtTheOpen: [], atTheOpen: [], atTheFirstHeartbeat: { pageInstance: changedInstance, items: itemsOf(reask.body.decisions) },
        });
      });
    }, 180_000);

    it(`host (${host}, native): a buffered delivery that changes the open page view's decisions is followed by its pushed set, the set a request for that page view then gets`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const socket = await b.socket();
        const instance = `p81-pu1-buffered-${host}-${crypto.randomUUID()}`;
        const first = await b.ask(instance);
        expect(first.status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        await pause(500);
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

    it(`host (${host}, native): R-P272 (CW31) — a new browser's first decision request (no session, P13) is decided before any choice, tracking withheld, so nothing of it is kept (no stored key names its pageInstance) and after the shopper's choice a changing action brings no frame for it; once the page asks again under the choice (the same pageInstance), the issued session's socket is pushed that page view's set after the next changing action`, async () => {
      await nativeWorld(host, async w => {
        const instance = `p81-pu1-first-${host}-${crypto.randomUUID()}`;
        const { answer, browser } = await w.firstRequest(instance, FULL);
        expect([answer.status, browser === null ? 'no session issued' : 'a session issued', (answer.body.session as { consent?: { tracking?: unknown } } | undefined)?.consent?.tracking ?? 'no consent on the session'],
          `${host}: PRECONDITION — the first request is answered and issues a session, decided before any choice with tracking withheld (${JSON.stringify(answer.body).slice(0, 160)})`)
          .toEqual([200, 'a session issued', false]);
        const socket = await browser!.socket();
        await pause(500);
        const keptFromTheFirstRequest = await w.keysNaming(browser!, instance);
        let count = pushed(socket).length;
        expect((await browser!.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        await pause(1500);
        const beforeThePageAsksAgain = since(socket, count, instance);
        const asked = await browser!.ask(instance);
        expect(asked.status, `${host}: PRECONDITION — the page asks again for its page view, under the shopper's choice`).toBe(200);
        await pause(300);
        count = pushed(socket).length;
        expect((await browser!.act(VIEW_WILLOW)).status, `${host}: PRECONDITION — the Willow view is admitted`).toBe(200);
        const afterAction = await nextPush(socket, count);
        await pause(300);
        const reask = await browser!.ask(instance);
        expect(changed(asked, reask), `${host}: PRECONDITION — the Willow view changed the page view's decisions`).toBe('changed');
        expect.soft({ keptFromTheFirstRequest, beforeThePageAsksAgain, afterThePageAskedAgain: framed(afterAction) },
          `${host}: P81.PU1 — nothing of a request decided with tracking withheld is kept (CW31); the page view the page then asks for is pushed to`).toEqual({
          keptFromTheFirstRequest: [], beforeThePageAsksAgain: [], afterThePageAskedAgain: { pageInstance: instance, items: itemsOf(reask.body.decisions) },
        });
      });
    }, 180_000);

    it(`host (${host}, native): R-P272 — a second page view (another decision request, another pageInstance) replaces the first: the push after a changing action names the second`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const socket = await b.socket();
        const one = `p81-pu1-one-${host}-${crypto.randomUUID()}`, two = `p81-pu1-two-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(one)).status, `${host}: PRECONDITION — the first page view is answered`).toBe(200);
        expect((await b.ask(two)).status, `${host}: PRECONDITION — the second page view is answered`).toBe(200);
        await pause(800);
        const count = pushed(socket).length;
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        const afterAction = await nextPush(socket, count);
        await pause(300);
        const reask = await b.ask(two);
        expect.soft(framed(afterAction), `${host}: P81.PU1 — the push names the second page view`).toEqual({ pageInstance: two, items: itemsOf(reask.body.decisions) });
      });
    }, 180_000);

    it(`host (${host}, native): R-P271 — the page view is kept at rest: pushed after a changing action, then after the shopper's object restarts (a fresh instance, its socket kept) an admitted action that changes the set, and after a second restart a publication change at the heartbeat, each bring a frame naming the same pageInstance with the set a request then gets`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const instance = `p81-pu1-restart-${host}-${crypto.randomUUID()}`;
        const first = await b.ask(instance);
        expect(first.status, `${host}: PRECONDITION — the first list is answered`).toBe(200);
        const socket = await b.socket();
        await pause(500);
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        const beforePush = await nextPush(socket, 0);
        await pause(300);
        const before = await b.ask(instance);
        expect(changed(first, before), `${host}: PRECONDITION — the Tabby view changed the page view's decisions`).toBe('changed');
        const pushesBefore = framed(beforePush);
        // The first restart, then an admitted action that changes the set.
        expect(await w.restart(b), `${host}: PRECONDITION — a fresh instance of the shopper's object serves the shopper`).toBe('a fresh instance');
        let count = pushed(socket).length;
        expect((await b.act(VIEW_WILLOW)).status, `${host}: PRECONDITION — the Willow view is admitted`).toBe(200);
        const afterAction = await nextPush(socket, count);
        await pause(300);
        const reask = await b.ask(instance);
        expect(changed(before, reask), `${host}: PRECONDITION — the Willow view changed the page view's decisions`).toBe('changed');
        // The second restart, then a publication change at the heartbeat.
        expect(await w.restart(b), `${host}: PRECONDITION — a fresh instance again`).toBe('a fresh instance');
        count = pushed(socket).length;
        expect((await w.publishSlots(declaredSlots([layoutSlot({ take: 2 })]))).status, `${host}: PRECONDITION — the operator publishes the slots change`).toBe(200);
        socket.send({ type: 'heartbeat', userId: b.subject });
        const afterPublication = await nextPush(socket, count);
        await pause(300);
        const republished = await b.ask(instance);
        expect.soft({ beforeTheRestart: pushesBefore, afterARestartAndAnAction: framed(afterAction), afterARestartAndAPublication: framed(afterPublication) },
          `${host}: P81.PU1 — the page view survives the object's restart (R-P271)`).toEqual({
          beforeTheRestart: { pageInstance: instance, items: itemsOf(before.body.decisions) },
          afterARestartAndAnAction: { pageInstance: instance, items: itemsOf(reask.body.decisions) },
          afterARestartAndAPublication: { pageInstance: instance, items: itemsOf(republished.body.decisions) },
        });
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

  sdkLeg('sdk: LOCK (R-P272) — the socket dropping mid-page puts the page back on HTTPS: an acknowledged action then re-requests once', async () => {
    const p = sdkPage();
    await p.core.ready();
    await p.open({ page: 'pdp' }, page([GRID, RECO, LOOK], ['story.a']), 'first');
    const socket = await p.connect();
    p.snapshots.filter(s => !s.answered).forEach(s => s.answer(page([GRID, RECO, LOOK], ['story.a']), 'connected'));
    await p.settle();
    socket.close();
    await p.settle();
    const before = p.snapshots.length;
    await p.emit.productView('COA-CH857', { line: 'Tabby', category: 'Handbags' });
    await p.settle();
    expect.soft(p.snapshots.length - before, 'P81.PU2 — after the drop the page follows over HTTPS again').toBe(1);
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
    it(`host (${host}, native): LOCK (R-P269, R-P272, R-P273) — after the page's answer and the socket open, an unchanged set is never pushed: heartbeats that change nothing, a second socket opened for the shopper, an admitted action that leaves the set unchanged (a page view) and the page's own re-ask bring no frame of the page view's set`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const instance = `p81-pu3-once-${host}-${crypto.randomUUID()}`;
        const answered = await b.ask(instance);
        expect(answered.status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        const first = await b.socket();
        await pause(500);
        for (let i = 0; i < 2; i++) { first.send({ type: 'heartbeat', userId: b.subject }); await pause(600); }
        const second = await b.socket();
        second.send({ type: 'heartbeat', userId: b.subject });
        await pause(600);
        expect((await b.act(PAGE_VIEW)).status, `${host}: PRECONDITION — the page view action is admitted`).toBe(200);
        await pause(1500);
        const reask = await b.ask(instance);
        expect(changed(answered, reask), `${host}: PRECONDITION — nothing changed the page view's set`).toBe('unchanged');
        first.send({ type: 'heartbeat', userId: b.subject });
        await pause(1500);
        expect.soft({ onTheFirstSocket: since(first, 0, instance), onTheSecondSocket: since(second, 0, instance) },
          `${host}: P81.PU3 — the set the page received is never pushed to it again`).toEqual({ onTheFirstSocket: [], onTheSecondSocket: [] });
      });
    }, 180_000);

    it(`host (${host}, native): R-P272 — personalization withdrawn after the page view opened: no frame after the withdrawal, whatever changes`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const socket = await b.socket();
        const instance = `p81-pu3-withdrawn-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(instance)).status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        expect((await b.choose({ tracking: true, personalization: false })).status, `${host}: PRECONDITION — the withdrawal is admitted`).toBe(200);
        await pause(500);
        const count = pushed(socket).length;
        await b.act(VIEW_TABBY_26);
        await pause(1500);
        expect((await w.publishSlots(declaredSlots([layoutSlot({ take: 2 })]))).status, `${host}: PRECONDITION — the operator publishes the slots change`).toBe(200);
        socket.send({ type: 'heartbeat', userId: b.subject });
        await pause(1500);
        expect.soft(since(socket, count), `${host}: P81.PU3 — nothing is pushed once personalization is withdrawn`).toEqual([]);
      });
    }, 180_000);

    it(`host (${host}, native): R-P271 — after the page's socket closes, a restarted shopper's object pushes nothing on a changing action, a socket opened afterwards gets no frame of that page view, and no stored key names its pageInstance`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const socket = await b.socket();
        const instance = `p81-pu3-closed-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(instance)).status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        await pause(1000);
        expect(await w.keysNaming(b, instance), `${host}: PRECONDITION — the open page view is kept at rest under the shopper's one key (R-P271, R-P273)`).toContain(PUSH_VIEW_KEY);
        socket.close();
        await pause(1000);
        expect(await w.restart(b), `${host}: PRECONDITION — a fresh instance of the shopper's object serves the shopper`).toBe('a fresh instance');
        expect((await b.act(VIEW_WILLOW)).status, `${host}: PRECONDITION — the Willow view is admitted`).toBe(200);
        await pause(1000);
        const later = await b.socket();
        later.send({ type: 'heartbeat', userId: b.subject });
        await pause(1500);
        expect.soft({ onASocketOpenedLater: since(later, 0, instance), keysNamingThePageView: await w.keysNaming(b, instance) },
          `${host}: P81.PU3 — the page view is gone with its socket (R-P271)`).toEqual({ onASocketOpenedLater: [], keysNamingThePageView: [] });
      });
    }, 180_000);

    it(`host (${host}, native): R-P271 — after the shopper's erasure, no stored key names the page view's pageInstance and a trigger pushes nothing for it`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const socket = await b.socket();
        const instance = `p81-pu3-erased-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(instance)).status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        const count = pushed(socket).length;
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        await nextPush(socket, count);
        await pause(300);
        expect(await w.keysNaming(b, instance), `${host}: PRECONDITION — the open page view is kept at rest under the shopper's one key (R-P271, R-P273)`).toContain(PUSH_VIEW_KEY);
        const erased = await w.erase(b);
        expect(erased.status, `${host}: PRECONDITION — the shopper's erasure completes locally (${JSON.stringify(erased.body).slice(0, 200)})`).toBe(200);
        const afterErasure = pushed(socket).length;
        expect((await w.publishSlots(declaredSlots([layoutSlot({ take: 2 })]))).status, `${host}: PRECONDITION — the operator publishes the slots change`).toBe(200);
        socket.send({ type: 'heartbeat', userId: b.subject });
        await b.act(VIEW_WILLOW);
        await pause(1500);
        expect.soft({ pushedAfterTheErasure: since(socket, afterErasure, instance), keysNamingThePageView: await w.keysNaming(b, instance) },
          `${host}: P81.PU3 — the erasure takes the page view with the rest of the shopper's state (R-P271)`).toEqual({ pushedAfterTheErasure: [], keysNamingThePageView: [] });
      });
    }, 180_000);

    // Fix round 1 (R-P281): the owner acts on its own revocations and refusals; the page view at rest is gated on tracking alone.
    it(`host (${host}, native): R-P281 (a) — a logout (POST /v1/{tenant}/identity/detach) with the page view open on a connected socket leaves no stored key naming the page view, and no frame of it follows an action or a publication change, on the closed socket or on the replacement session's`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const instance = `p81-fix1-logout-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(instance)).status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        const socket = await b.socket();
        await pause(500);
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        expect(framed(await nextPush(socket, 0)) === 'no content_decisions frame' ? 'not pushed' : 'pushed', `${host}: PRECONDITION — the page view is pushed to before the logout`).toBe('pushed');
        expect(await w.keysNaming(b, instance), `${host}: PRECONDITION — the open page view is kept at rest under the shopper's one key`).toContain(PUSH_VIEW_KEY);
        const count = pushed(socket).length;
        const detached = await b.call(`/v1/${TENANT}/identity/detach`, {});
        const replacement = detached.body.session as Session | undefined;
        expect([detached.status, detached.body.detached, typeof replacement?.capability], `${host}: PRECONDITION — the logout is answered with the replacement session (${JSON.stringify(detached.body).slice(0, 160)})`)
          .toEqual([200, true, 'string']);
        await pause(1500);
        const next = await w.adopt(replacement!, FULL);
        const nextSocket = await next.socket();
        expect((await next.act(VIEW_WILLOW)).status, `${host}: PRECONDITION — the replacement session's Willow view is admitted`).toBe(200);
        expect((await w.publishSlots(declaredSlots([layoutSlot({ take: 2 })]))).status, `${host}: PRECONDITION — the operator publishes the slots change`).toBe(200);
        nextSocket.send({ type: 'heartbeat', userId: next.subject });
        await pause(1500);
        expect.soft({ keysNamingThePageView: await w.keysNaming(b, instance), framesOfThePageView: [...since(socket, count, instance), ...since(nextSocket, 0, instance)] },
          `${host}: P81.PU3 — a logout takes the page view at rest with the grant it revokes (R-P281)`).toEqual({ keysNamingThePageView: [], framesOfThePageView: [] });
      });
    }, 180_000);

    it(`host (${host}, native): R-P281 (c) — the profile's retention expiry (the shopper's object's alarm, the profile past the tenant's retention) deletes the page view at rest with the profile`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const instance = `p81-fix1-retention-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(instance)).status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        await pause(300);
        expect([(await w.keysNaming(b, instance)).includes(PUSH_VIEW_KEY), (await w.keysNaming(b, '')).includes('affinity')],
          `${host}: PRECONDITION — the page view is kept at rest beside the shopper's profile`).toEqual([true, true]);
        await w.clock(2 * 3600);
        await w.alarm(b);
        expect((await w.keysNaming(b, '')).includes('affinity'), `${host}: PRECONDITION — the profile's retention (one hour) expired at the alarm`).toBe(false);
        expect.soft(await w.keysNaming(b, instance), `${host}: P81.PU3 — the retention expiry deletes the page view at rest (R-P281)`).toEqual([]);
      }, { profileMs: 3_600_000 });
    }, 180_000);

    it(`host (${host}, native): R-P281 (d) — tracking allowed and personalization declined at the answer: the page view is kept at rest, nothing is pushed before the grant, and a mid-page personalization grant brings no frame by itself and one frame, the set a request then gets, at the next admitted action`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser({ tracking: true, personalization: false });
        const socket = await b.socket();
        const instance = `p81-fix1-granted-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(instance)).status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        await pause(300);
        const keptAtTheAnswer = (await w.keysNaming(b, instance)).includes(PUSH_VIEW_KEY) ? 'kept' : 'not kept';
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        await pause(1500);
        const beforeTheGrant = since(socket, 0, instance);
        const granted = pushed(socket).length;
        expect((await b.choose(FULL)).status, `${host}: PRECONDITION — the mid-page personalization grant is admitted`).toBe(200);
        await pause(1500);
        const atTheGrant = since(socket, granted, instance);
        const count = pushed(socket).length;
        expect((await b.act(VIEW_WILLOW)).status, `${host}: PRECONDITION — the Willow view is admitted`).toBe(200);
        const atTheNextAction = await nextPush(socket, count);
        await pause(1000);
        const framesAfterTheAction = since(socket, count, instance).length;
        const reask = await b.ask(instance);
        expect.soft({ keptAtTheAnswer, beforeTheGrant, atTheGrant, atTheNextAction: framed(atTheNextAction), framesAfterTheAction },
          `${host}: P81.PU3 — the page view at rest is gated on tracking alone; the sends on personalization (R-P281)`).toEqual({
          keptAtTheAnswer: 'kept', beforeTheGrant: [], atTheGrant: [], atTheNextAction: { pageInstance: instance, items: itemsOf(reask.body.decisions) }, framesAfterTheAction: 1,
        });
      });
    }, 180_000);

    it(`host (${host}, native): R-P281 (d) — a page view asked under a refusal hint (the cookie opt_personalization_enabled=false) is kept, and the shopper's later explicit grant is honoured at the next admitted action: the hint is not replayed, a re-decision reads the consent in force (one frame, the set a request then gets, and the grant still in force after it)`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL);
        const socket = await b.socket();
        const instance = `p81-fix1-hint-${host}-${crypto.randomUUID()}`;
        const hinted = await b.askWith(b.capability, instance, 'opt_personalization_enabled=false');
        const decided = (hinted.body.sources as { consent?: { tracking?: unknown; personalization?: unknown; instruction?: { revision?: unknown } } } | undefined)?.consent;
        expect([hinted.status, decided?.tracking, decided?.personalization], `${host}: PRECONDITION — the hinted page view is answered with personalization refused (${JSON.stringify(hinted.body).slice(0, 160)})`).toEqual([200, true, false]);
        await pause(300);
        const keptAtTheAnswer = (await w.keysNaming(b, instance)).includes(PUSH_VIEW_KEY) ? 'kept' : 'not kept';
        const granted = await b.choose(FULL, decided?.instruction?.revision);
        expect(granted.status, `${host}: PRECONDITION — the explicit grant is admitted (${JSON.stringify(granted.body).slice(0, 160)})`).toBe(200);
        await pause(1500);
        const atTheGrant = since(socket, 0, instance);
        const count = pushed(socket).length;
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        const atTheNextAction = await nextPush(socket, count);
        await pause(1000);
        const framesAfterTheAction = since(socket, count, instance).length;
        const reask = await b.ask(instance);
        expect.soft({ keptAtTheAnswer, atTheGrant, atTheNextAction: framed(atTheNextAction), framesAfterTheAction,
          personalizationInForceAfterThePush: (reask.body.sources as { consent?: { personalization?: unknown } } | undefined)?.consent?.personalization },
        `${host}: P81.PU3 — the kept page view replays no refusal hint (R-P281)`).toEqual({
          keptAtTheAnswer: 'kept', atTheGrant: [], atTheNextAction: { pageInstance: instance, items: itemsOf(reask.body.decisions) }, framesAfterTheAction: 1,
          personalizationInForceAfterThePush: true,
        });
      });
    }, 180_000);

    it(`host (${host}, native): R-P286 (d) — a page view asked as the SDK asks it with personalization off (its body's own hint, personalizationEnabled: 'false', beside the browsing session tracking allows; src/sdk/listen.ts) is kept, nothing is pushed before the grant, and the shopper's mid-page grant brings no frame by itself and one frame at the next admitted action: the hint is not replayed and the grant stays in force`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser({ tracking: true, personalization: false });
        const socket = await b.socket();
        const instance = `p81-fix2-body-hint-${host}-${crypto.randomUUID()}`;
        // The SDK's body with tracking allowed and personalization off: no trackingConsent member, personalizationEnabled 'false'.
        const hinted = await b.askBody(instance, { browsingSessionId: b.sessionId, personalizationEnabled: 'false' });
        const decided = (hinted.body.sources as { consent?: { tracking?: unknown; personalization?: unknown } } | undefined)?.consent;
        expect([hinted.status, decided?.tracking, decided?.personalization], `${host}: PRECONDITION — the SDK's page view is answered with tracking allowed and personalization off (${JSON.stringify(hinted.body).slice(0, 160)})`).toEqual([200, true, false]);
        await pause(300);
        const keptAtTheAnswer = (await w.keysNaming(b, instance)).includes(PUSH_VIEW_KEY) ? 'kept' : 'not kept';
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        await pause(1500);
        const beforeTheGrant = since(socket, 0, instance);
        const granted = pushed(socket).length;
        expect((await b.choose(FULL)).status, `${host}: PRECONDITION — the mid-page personalization grant is admitted`).toBe(200);
        await pause(1500);
        const atTheGrant = since(socket, granted, instance);
        const count = pushed(socket).length;
        expect((await b.act(VIEW_WILLOW)).status, `${host}: PRECONDITION — the Willow view is admitted`).toBe(200);
        const atTheNextAction = await nextPush(socket, count);
        await pause(1000);
        const framesAfterTheAction = since(socket, count, instance).length;
        // The SDK's next request for the page view under the grant: no hint, the browsing session beside it.
        const reask = await b.askBody(instance, { browsingSessionId: b.sessionId });
        expect.soft({ keptAtTheAnswer, beforeTheGrant, atTheGrant, atTheNextAction: framed(atTheNextAction), framesAfterTheAction,
          personalizationInForceAfterThePush: (reask.body.sources as { consent?: { personalization?: unknown } } | undefined)?.consent?.personalization },
        `${host}: P81.PU3 — the kept page view replays no consent member of the SDK's body (R-P286)`).toEqual({
          keptAtTheAnswer: 'kept', beforeTheGrant: [], atTheGrant: [], atTheNextAction: { pageInstance: instance, items: itemsOf(reask.body.decisions) }, framesAfterTheAction: 1,
          personalizationInForceAfterThePush: true,
        });
      });
    }, 180_000);

    it(`host (${host}, native): LOCK (R-P281) — the shopper's object's relay door accepts nothing without a valid principal: a 'closed' notice with no capability, or under another shopper's, is refused and leaves the page view at rest, still pushed to after a changing action`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(FULL), other = await w.browser(FULL);
        const instance = `p81-fix1-door-${host}-${crypto.randomUUID()}`;
        expect((await b.ask(instance)).status, `${host}: PRECONDITION — the page view's first list is answered`).toBe(200);
        const socket = await b.socket();
        await pause(500);
        const refused = [await w.relayFrame(b, null, 'closed'), await w.relayFrame(b, other.capability, 'closed')].map(status => status >= 400 ? 'refused' : `accepted (${status})`);
        await pause(500);
        const kept = (await w.keysNaming(b, instance)).includes(PUSH_VIEW_KEY) ? 'kept' : 'not kept';
        const count = pushed(socket).length;
        expect((await b.act(VIEW_TABBY_26)).status, `${host}: PRECONDITION — the Tabby view is admitted`).toBe(200);
        const afterAction = await nextPush(socket, count);
        await pause(300);
        const reask = await b.ask(instance);
        expect.soft({ refused, kept, afterAction: framed(afterAction) }, `${host}: P81.PU3 — no notice without a valid principal removes the page view (R-P281)`)
          .toEqual({ refused: ['refused', 'refused'], kept: 'kept', afterAction: { pageInstance: instance, items: itemsOf(reask.body.decisions) } });
      });
    }, 180_000);
  }

  it(`host (session, native): R-P281 (b) — a socket whose grant lapses (the relay closes it at its heartbeat; the shopper's object hears nothing) leaves no socket an action decides again for: the next admitted action, under the shopper's other live grant, sends the relay no re-decided set; the page view at rest goes when its own grant lapsed with the socket's, and is kept when it was asked under the live grant, pushed to again once a socket reports under it`, async () => {
    await nativeWorld('session', async w => {
      // b's page view is asked under the socket's grant; c's under a second grant that outlives the socket's.
      const b = await w.browser(FULL), c = await w.browser(FULL);
      const gone = `p81-fix1-lapsed-gone-${crypto.randomUUID()}`, kept = `p81-fix1-lapsed-kept-${crypto.randomUUID()}`;
      expect((await b.ask(gone)).status, 'session: PRECONDITION — b\'s page view is answered under the socket\'s grant').toBe(200);
      const bSocket = await b.socket(), cSocket = await c.socket();
      await pause(500);
      expect((await b.act(VIEW_TABBY_26)).status, 'session: PRECONDITION — b\'s Tabby view is admitted').toBe(200);
      expect(framed(await nextPush(bSocket, 0)) === 'no content_decisions frame' ? 'not pushed' : 'pushed', 'session: PRECONDITION — b\'s page view is pushed to while its socket is open').toBe('pushed');
      await w.clock(50_000);
      const bSecond = await w.secondGrant(b), cSecond = await w.secondGrant(c);
      expect((await c.askWith(cSecond, kept)).status, 'session: PRECONDITION — c\'s page view is answered under its second grant').toBe(200);
      await w.clock(86_400 + 600);
      const answered = [bSocket, cSocket].map(x => x.frames.filter(f => f.type === 'heartbeat_response').length);
      for (const [x, subject] of [[bSocket, b.subject], [cSocket, c.subject]] as const) x.send({ type: 'heartbeat', userId: subject });
      await pause(1500);
      expect([await bSocket.waitFor(() => bSocket.frames.filter(f => f.type === 'heartbeat_response').length > answered[0]!, 500),
        await cSocket.waitFor(() => cSocket.frames.filter(f => f.type === 'heartbeat_response').length > answered[1]!, 500), (await b.act(PAGE_VIEW)).status],
      'session: PRECONDITION — the sockets\' grants lapsed: no heartbeat is answered (the relay closed them) and the lapsed grant acts no more').toEqual([false, false, 401]);
      const before = [(await w.relayPaths(b)).length, (await w.relayPaths(c)).length];
      expect([(await b.actWith(bSecond, VIEW_WILLOW)).status, (await c.actWith(cSecond, VIEW_TABBY_26)).status], 'session: PRECONDITION — each shopper\'s changing action is admitted under the live grant').toEqual([200, 200]);
      await pause(1500);
      const sent = async (x: Browser, from: number) => (await w.relayPaths(x)).slice(from).filter(path => path.endsWith(' content_decisions'));
      const afterTheLapse = { bReDecidedSetsSentToTheRelay: await sent(b, before[0]!), cReDecidedSetsSentToTheRelay: await sent(c, before[1]!),
        bKeysNamingThePageView: await w.keysNaming(b, gone), cKeysNamingThePageView: await w.keysNaming(c, kept) };
      // c's page view, kept, is pushed to again once a socket reports under its live grant.
      const cNextSocket = await c.socket(cSecond);
      await pause(500);
      const count = pushed(cNextSocket).length;
      expect((await c.actWith(cSecond, VIEW_WILLOW)).status, 'session: PRECONDITION — c\'s Willow view is admitted under its live grant').toBe(200);
      const resumed = await nextPush(cNextSocket, count);
      await pause(300);
      const reask = await c.askWith(cSecond, kept);
      expect.soft({ ...afterTheLapse, cPushedAgain: framed(resumed) }, 'session: P81.PU3 — a lapsed socket is no socket; the page view goes with its own grant (R-P281, R-P269(3))').toEqual({
        bReDecidedSetsSentToTheRelay: [], cReDecidedSetsSentToTheRelay: [], bKeysNamingThePageView: [], cKeysNamingThePageView: [PUSH_VIEW_KEY],
        cPushedAgain: { pageInstance: kept, items: itemsOf(reask.body.decisions) },
      });
    });
  }, 180_000);
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
