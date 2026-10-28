// src/units/P97/LEDGER.unit.test.ts
// P97 under the Closure Ledger (programme `tapestry-parity-scale`, amendment 12, item E22; batch S41): the tests for the
// LOCAL criteria FV1-FV5 of the P97 work order (docs/parity/scale/program.json). DC1 is the owner's decision (RESOLVED,
// D2: R-P545; the design R-P547; the open point R-P548) and LV1 a deferred live row; neither gets a test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-12/BTI-Parity-Amendment-2026-10-26-scale.md, section 2, E22):
//   "#### E22 · The new visitor's first answer (a design decision)
//    - **Authority:** E12's definition (R-P438) deferred the fix; lane L19's timing split (`live/lanes/L19/records/
//      P76-timings.md`): the session issue is the largest part of every first answer on all four targets (cold
//      865–1,388 ms; warm medians 941–1,065 ms; `total` cold 1,405–1,785 ms against the 1.5 s first-paint deadline).
//    - **Done when:** the owner decides between overlapping the decision with the session issue, changing how a new
//      shopper's session is issued (P13 D1 reopened), or accepting the deadline's defaults for a new visitor's first
//      view; the chosen design built and measured on the stamps.
//    - **Needed by:** the first activation (January). Design first; two to four days."
// THE OWNER'S DIRECTION (R-P545; amendment 13 section 3 row 2): none of (a), (b), (c) as framed — "What happens during the
// creation of that record? Does it need to be created synchronously or can it be created asynchronously? … Nothing should
// take 1.4 seconds." THE DESIGN (R-P547; _evidence/parity-step3/S44/analyst-first-answer/DESIGN.md §3, §4, §7): the first
// answer decided by today's own code against a blank in-memory copy of the brand-new visitor's record, nothing contacted,
// created or written before it; the real record created right after the answer; a lost creation made by the visitor's
// next request; any write attempted on the copy falling back to today's path with the same visitor id; the
// instrumentation first (X-Owner-Timing internal, sources.sessionParts). R-P548: no count of failed creations is added.
//
// THE READINGS (where the work order is silent; for the lead):
//   R1 The copy is an instance of the ShopperReflex class that the mounted namespace does not hold (DESIGN §4: `new
//      ShopperReflex(state, env)` over empty storage; the work order: "decided by today's own code"). The tests reach it
//      through the class's own `fetch` (./_copy): they record, hold or answer the calls made to it; no product seam, no
//      new export. Its top-level calls are the activation (/identity/activate) and the forward (/authority/request); a
//      call it makes to itself inside one of them (the do host's in-object content read, DESIGN §1 6b) is its own.
//   R2 "Before the answer" is before the Worker's fetch resolves with the door's answer. "Nothing contacted or created"
//      is measured with every call to the visitor's object held 600 ms from its first contact: no object reached or
//      created when the answer arrives. The creation is issued by the door's handler under waitUntil, as P84's arm-draw
//      count is today (DESIGN §1 step 7; P94 R3): "after the answer" is "the answer does not wait on it"; the leg pins it
//      as the one object call, issued after the copy's forward answered (a creation fired before the decision and not
//      awaited is the wrong fix `concurrent`).
//   R3 "Today's answer for the same visitor" is what the visitor's own record answers the visitor's next page view on the
//      same page (a path P97 does not change), compared field by field less the answer's own time `ts`, the page
//      instance, the session, armRequest, sources.timings and sources.sessionParts, decision ids by presence. Measured
//      equal on today's door for every case on both hosts (logs/a1-today.log).
//   R4 The first answer's reads: R2's published content (`config-publication/…`) and, on the session host only, at most
//      two reads of the minted session's key (`session:<sessionId>`); "at most" leaves the later item O1 (R-P547) open.
//   R5 A write attempted by the copy is driven by the test inside the copy's own call, on the copy's own environment (the
//      synthetic boundary's view of the environment it was built with): the design's list — the session store and the
//      cache put and delete, R2 put and delete, the queue's send and sendBatch, D1, a statistics object, a ring, another
//      shopper's object — at the activation or at the forward. "Landed" means the real binding saw the operation.
//   R6 A lost creation: the creation's call to the visitor's object rejects, as the platform's failure would. A late one:
//      held until the next request has been answered. The copy's activation refusing: its /identity/activate answered
//      401, the refusal as the door receives it.
//   R7 FV3, "whichever object runs it": the copy's activation when the door decided on a copy, else the object's before
//      the answer. It is held 400 ms before it reaches that object, so `op` (the object's own time) excludes the hold
//      and sessionParts.activate (the round trip) includes it — the live reading activate − op (DESIGN §2); on the
//      session host the restriction's key-value read is held 150 ms, which `restrict` and `op` carry. `restrict` is the
//      session host's part (DESIGN §3); the do host may omit it. "In whole milliseconds" is X-Owner-Timing's;
//      sessionParts' numbers are non-negative. The session route's answer "unchanged": today's members (continuity, ok,
//      session) and kit 02's session shape.
//   R8 The remaining work lists kit 02's sessionParts sentence with the instrumentation (FV3); FV3's observable names no
//      kit sentence and FV4's does, so it is pinned in FV4 and FV3 stays satisfiable by the instrumentation-only commit
//      (measured: 2ca83399 on rem/p97-build, FV3 4/4).
//   R9 FV4, "in its session sentences": a sentence of kit 02's first-request paragraph that speaks of the session's issue
//      says the first answer is decided on a blank copy of the visitor's record, and the `session` entry's description
//      names the copy, not "the new shopper's object"; the no-wait and "right after the answer or by the next request"
//      statements may stand in any sentence of that paragraph.
//   R10 P84's cases: honoured at a 0.3 share drawn `default`; mismatch at 0 drawn `default`; capped at one in a billion
//      drawn `default`; republished at one in a billion drawn `personalized`, the learn document republished at a share
//      of 1 while the first answer's forward is parked wherever it runs (the copy's, or today the object's).
//
// R10 (R-P548, by name; before → after). src/units/P76/LEDGER.unit.test.ts `hold` (P76 FA1's helper, :116–143 →
// :116–140): a wrapper on the SHOPPER_REFLEX namespace holding the object's /identity/activate ACTIVATE ms and its first
// /authority/request FORWARD ms → the same two holds and the same phases on the copy through ../P97/_copy (watchCopies),
// the watch ended once the held forward answered; the mint and stage holds on R2 unchanged; the legs (:185, :218)
// unchanged; one import line. src/units/P94/LEDGER.unit.test.ts AD1's hold (:342–350 and its restore in the leg's
// `finally`, :372 → :342–349, :370): a namespace wrapper parking the republished requests' forwards → the same parking on
// the copy's forward; the restore → watch.stop(); one import line. Stale after the R10, outside the grant (told): P76's
// header reading 3 and "Imports from src/units/: ../_parity"; P94's header R2 ("at their forward to the shopper's
// object") and its imports line.
//
// HARNESS: src/units/_parity.ts (the mounted environment, both hosts), every request through the real Worker
// (src/index.ts, P96's form), and ./_copy (the copy). NO NEW EXPORT IS IMPORTED. Imports from src/units/: ../_parity,
// ./_copy (and, after the R10, src/units/P76 and src/units/P94 import ../P97/_copy).
//
// DEFERRED: LV1 — lane L21 on the pair's next release: the split read live from the instrumentation (sessionParts and the
// object's parts; activate − object.op − forward for the first contact), cold and warm, on both pair hosts; the cold
// first answer's server time at most 300 ms on both; the stamps measured and recorded as lanes L19 and L20 did.
// RESIDUALS (told): the copy is not run in workerd here (DESIGN §8; no native leg is ruled; LV1 runs it); the work
// order's line references are as of 340cd410/ed7d6bbe; kit 02's "the stages of the decision the new shopper's object
// made" (in its Server-Timing sentence) is not pinned by FV4 and becomes inexact under the design.

import { describe, expect, it, vi } from 'vitest';

vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { armClassOf, armFor } from '@/sdk/armDraw';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';

import {
  BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, PAGE_VIEW, pageInstanceOf, putDocument, readTree, recentSlot,
  TENANT, UnitKV, UnitR2, type Host, type Mounted,
} from '../_parity';
import { watchCopies, type AroundCopy, type CopyCall, type CopyWatch } from './_copy';

// ---------------------------------------------------------------------------
// The fixture: the customer's product page (_parity's declared layout slot over Coach's modules, the expired, closed,
// excluded and unmapped modules among them); the holdout per case (P84: 0 meets `personalized` and cannot meet
// `default`; 0.3 meets either; one in a billion cannot meet `default` within the cap); P30's context-only page.
// ---------------------------------------------------------------------------

const holdoutOf = (share: number) => ({ share, salt: 'parity', arms: ['default' as const] });
const learnAt = (share: number) => learnDocument({}, { holdout: holdoutOf(share) });
const docsAt = (share: number, slots: unknown = declaredSlots([layoutSlot()])) => ({ pieces: [...MODULES], slots, learn: learnAt(share) });
/** P30's context-only page: the declared layout slot switched to context-only, the recently-viewed slot below it. */
const CONTEXT_ONLY = declaredSlots([layoutSlot({ contextOnly: { enabled: true } }), recentSlot()]);
const TINY = 1e-9;
/** The hold of the new visitor's object from its first contact (the design's probe: H = 600 ms). */
const HOLD_MS = 600;
/** FV3: the first answer's activation held before it reaches the object that runs it, and (session host) its restriction's key-value read. */
const TRIP_MS = 400, RESTRICT_MS = 150;
/** FV2: how long the first answer may take before the test calls it waiting on the held creation. */
const WAITED_MS = 3_000;
const SITE_KEY = 'p97-synthetic-site-key';
/** The forwarded decision's five stages (W38 B5's names) and the door's own entries (P76). */
const STAGES = ['documents', 'shopper', 'trend', 'lift', 'decide'];
const DOOR = ['session', 'forward', 'total'];
/** The session route's answer today, unchanged (FV3): its members and the issued session's (kit 02 :337, the session route's shape). */
const SESSION_ROUTE_KEYS = ['continuity', 'ok', 'session'];
/** The issued session's shape (kit 02 :337, the session route's). */
const SESSION_KEYS = ['authorityEpoch', 'capability', 'consent', 'exp', 'grantId', 'iat', 'kind', 'sessionId', 'subject', 'tenant'];
/** A brand-new visitor's consent: no recorded choice, read as both refused (R-P67; src/content/consent.ts:139-140). */
const REFUSED = { tracking: false, personalization: false };
/** The object's own parts of the activation (R-P547; DESIGN §3), `restrict` the session host's only. */
const OWNER_PARTS = ['alarm', 'commit', 'consent', 'grant', 'op', 'queue'];
const MARK = 'p97-copy-effect';
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// The world: _parity's mounted environment on one shopper host, every request through the real Worker (src/index.ts,
// P96's form: enforced, the site key), every binding operation and every Durable Object call recorded with the stage it
// was made in (before the first answer reached its caller, or after), the shopper objects holdable before they are
// reached, and the blank copy watched through ./_copy.
// ---------------------------------------------------------------------------

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };
let worker: Promise<Worker> | undefined;
/** The real Worker default export, loaded once per file after the module doubles above are registered. */
const loadWorker = (): Promise<Worker> => (worker ??= import('@/index').then(module => module.default as unknown as Worker));

type Stage = 'before the answer' | 'after the answer';
const BEFORE: Stage = 'before the answer', AFTER: Stage = 'after the answer';
const WRITES = new Set(['put', 'delete', 'send', 'sendBatch', 'prepare', 'createMultipartUpload']);

interface Op { binding: string; op: string; key: string; stage: Stage }
interface ObjectCall {
  binding: string; name: string; path: string; capability: string | null;
  /** The order the call was made in (shared with the copy's calls), the stage it was made in and the stage it reached the object in. */
  seq: number; stage: Stage; reached: Stage | null; status: number | null; headers: Headers | null;
}
interface Reply { status: number; headers: Headers; body: Record<string, unknown>; measured: number }
interface Session { capability: string; tenant: string; subject: string; sessionId: string; grantId: string; authorityEpoch: string; consent: unknown }

interface World {
  host: Host;
  m: Mounted;
  stage: Stage;
  ops: Op[];
  objects: ObjectCall[];
  copies: CopyWatch;
  /** The order each call to a copy started and ended in (the same counter as ObjectCall.seq). */
  copyAt: Map<CopyCall, { start: number; end: number | null }>;
  /** Runs before a SHOPPER_REFLEX call reaches its object: a hold, a gate, a loss. */
  intercept: ((call: ObjectCall) => Promise<void>) | null;
  /** Runs every call made to a copy (./_copy's around). */
  around: AroundCopy | null;
  /** Activations under way, on the copy or on an object (FV3's restriction hold reads it). */
  activating: number;
  /** FV3: hold every session-store read of a session key made while an activation is under way. */
  holdRestrict: boolean;
  next: () => number;
  send: (method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: string) => Promise<Reply>;
  drain: () => Promise<void>;
  reset: () => void;
  stop: () => void;
}

const keyOf = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(String).join('+') : JSON.stringify(value ?? null) ?? '';

async function world(host: Host, documents = docsAt(0)): Promise<World> {
  const m = await mount(host, documents);
  expectPublished(m, 'P97 — the tenant documents publish');
  Object.assign(m.env as unknown as Record<string, unknown>, { AUTH_MODE: 'enforced', SDK_KEYS: `${TENANT}:${SITE_KEY}` });
  const app = await loadWorker();
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext;
  let counter = 0;
  const w: World = {
    host, m, stage: AFTER, ops: [], objects: [], copies: { calls: [], stop: () => undefined }, copyAt: new Map(), intercept: null, around: null,
    activating: 0, holdRestrict: false, next: () => ++counter,
    send: async () => { throw new Error('unset'); }, drain: async () => undefined, reset: () => undefined, stop: () => undefined,
  };
  const env = m.env as unknown as Record<string, unknown>;
  // The key-value stores and R2: every operation, the method of the double's own class.
  const record = (binding: string, target: object, ops: string[], real: Record<string, unknown>) => {
    for (const op of ops) {
      const method = real[op] as (...args: unknown[]) => unknown;
      Object.defineProperty(target, op, { configurable: true, writable: true, value: (...args: unknown[]) => {
        w.ops.push({ binding, op, key: keyOf(args[0]), stage: w.stage });
        if (binding === 'SESSIONS' && op === 'get' && w.holdRestrict && w.activating > 0 && keyOf(args[0]).startsWith('session:')) return sleep(RESTRICT_MS).then(() => method.apply(target, args));
        return method.apply(target, args);
      } });
    }
  };
  record('SESSIONS', m.env.SESSIONS as unknown as object, ['get', 'put', 'delete', 'list'], UnitKV.prototype as unknown as Record<string, unknown>);
  record('CACHE', m.cache, ['get', 'put', 'delete', 'list'], UnitKV.prototype as unknown as Record<string, unknown>);
  record('STORAGE', m.storage, ['get', 'put', 'delete', 'list', 'head'], UnitR2.prototype as unknown as Record<string, unknown>);
  const queue = env.EVENT_QUEUE as Record<string, unknown>, db = env.DB as Record<string, unknown>;
  record('EVENT_QUEUE', queue, ['send', 'sendBatch'], { send: queue.send, sendBatch: queue.sendBatch });
  record('DB', db, ['prepare'], { prepare: db.prepare });
  // The Durable Object namespaces: every call, its stage, its answer; the shopper objects holdable before they are reached.
  for (const name of ['SHOPPER_REFLEX', 'LEARN_STATS', 'DECISION_RING', 'PERSONALIZATION_WEBSOCKET']) {
    const base = env[name] as { idFromName: (n: string) => unknown; get: (id: unknown) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } } | undefined;
    if (!base) continue;
    env[name] = { idFromName: (n: string) => base.idFromName(n), get: (id: unknown) => {
      const stub = base.get(id);
      return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const call: ObjectCall = { binding: name, name: String(id), path: new URL(request.url).pathname, capability: request.headers.get(SHOPPER_HEADER),
          seq: w.next(), stage: w.stage, reached: null, status: null, headers: null };
        w.objects.push(call);
        if (name === 'SHOPPER_REFLEX' && w.intercept) await w.intercept(call);
        call.reached = w.stage;
        const activation = call.path === '/identity/activate';
        if (activation) w.activating += 1;
        try {
          const answer = await stub.fetch(request);
          call.status = answer.status; call.headers = new Headers(answer.headers);
          return answer;
        } finally { if (activation) w.activating -= 1; }
      } };
    } };
  }
  w.copies = watchCopies(m, async (call, proceed, copyEnv) => {
    const at = { start: w.next(), end: null as number | null };
    w.copyAt.set(call, at);
    const activation = call.path === '/identity/activate';
    try {
      return await (w.around ? w.around(call, async () => {
        if (activation) w.activating += 1;
        try { return await proceed(); } finally { if (activation) w.activating -= 1; }
      }, copyEnv) : (async () => {
        if (activation) w.activating += 1;
        try { return await proceed(); } finally { if (activation) w.activating -= 1; }
      })());
    } finally { at.end = w.next(); }
  });
  w.send = async (method, path, headers, body) => {
    w.stage = BEFORE;
    const started = performance.now();
    let response: Response;
    try { response = await app.fetch(new Request(`https://shop.invalid${path}`, { method, headers, ...(body === undefined ? {} : { body }) }), m.env, ctx); }
    finally { w.stage = AFTER; }
    const measured = performance.now() - started;
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = { text: text.slice(0, 200) }; }
    return { status: response.status, headers: response.headers, body: parsed, measured };
  };
  w.drain = async () => {
    for (let round = 0; round < 8; round++) {
      while (pending.length) await Promise.allSettled(pending.splice(0));
      await m.drain();
      if (!pending.length) break;
    }
  };
  w.reset = () => { w.ops.length = 0; w.objects.length = 0; w.copies.calls.length = 0; w.copyAt.clear(); };
  w.stop = () => { w.copies.stop(); };
  return w;
}

/** The headers the SDK sends on a shopper call: the tenant, the site key, JSON (P96). */
const shopperHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({ 'X-Tenant': TENANT, 'X-SDK-Key': SITE_KEY, 'Content-Type': 'application/json', ...extra });
/** A new visitor's first request (P13 H4's door): no session; the page's class drawn when `cls` is given (P84's member). */
const door = (w: World, extra: Record<string, unknown> = {}, cls?: 'default' | 'personalized', headers: Record<string, string> = {}) =>
  w.send('POST', `/v1/${TENANT}/decisions/snapshot`, shopperHeaders(headers),
    JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p97-door'), ...extra, ...(cls ? { arm: JSON.stringify({ class: cls, tableVersion: 'p97-table' }) } : {}) }));
/** The visitor's next page view on the same page, holding the session the door issued. */
const nextSnapshot = (w: World, s: Session, headers: Record<string, string> = {}) => w.send('POST', `/v1/${TENANT}/decisions/snapshot`,
  shopperHeaders({ [SHOPPER_HEADER]: s.capability, ...headers }), JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p97-next') }));
/** The visitor's next action (a page view, as the SDK sends it). */
const nextAction = (w: World, s: Session) => w.send('POST', '/realtime/action', shopperHeaders({ [SHOPPER_HEADER]: s.capability }),
  JSON.stringify({ ...PAGE_VIEW, source: 'sdk', userId: s.subject, sessionId: s.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() }));
/** The session route, POST /v1/{tenant}/identity/session, with the session held (or none: a fresh browser). */
const sessionRoute = (w: World, s: Session | null) => w.send('POST', `/v1/${TENANT}/identity/session`, shopperHeaders(s ? { [SHOPPER_HEADER]: s.capability } : {}), '{}');

const sessionOf = (r: Reply): Session | null => (r.body.session && typeof r.body.session === 'object' ? r.body.session as Session : null);
const ownName = (subject: string) => shopperObjectName(TENANT as TenantId, subject);
const recordOf = (w: World, subject: string) => w.m.shoppers.get(ownName(subject)) ?? null;
/** What the visitor's own object holds: its keys, the grants of its authority. */
function heldBy(w: World, s: Session): { keys: string[] | null; grants: string[] | null; epoch: unknown } {
  const record = recordOf(w, s.subject);
  if (!record) return { keys: null, grants: null, epoch: null };
  const authority = record.data.get('grantAuthority') as { epoch?: unknown; grants?: Record<string, { subject?: unknown; sessionId?: unknown }> } | undefined;
  return { keys: [...record.data.keys()].sort(), grants: authority?.grants ? Object.keys(authority.grants) : null, epoch: authority?.epoch ?? null };
}
/** `Server-Timing` (or an internal timing header) as name → duration; the raw durations as written. */
const entriesOf = (header: string | null): Record<string, number> => Object.fromEntries((header ?? '').split(',').map(s => s.trim()).filter(Boolean)
  .map(s => [s.split(';')[0]!.trim(), Number(/dur=([0-9.]+)/.exec(s)?.[1] ?? NaN)]));
const rawDurations = (header: string | null): string[] => (header ?? '').split(',').map(s => s.trim()).filter(Boolean).map(s => /dur=([^;,\s]*)/.exec(s)?.[1] ?? '');
const timingsOf = (r: Reply) => ((r.body.sources as { timings?: Record<string, number> } | undefined)?.timings ?? {});
const totalsOf = (r: Reply) => (r.headers.get('Server-Timing') ?? '').split(',').map(s => s.trim()).filter(s => s.split(';')[0]!.trim() === 'total').length;
const show = (r: Reply) => `${r.status} ${r.headers.get('Server-Timing') ?? 'no Server-Timing'} ${JSON.stringify(r.body).slice(0, 240)}`;
const sorted = (names: string[]) => [...names].sort();
/** What the visitor is shown and told, without the times: the answer less its session, its armRequest, its page instance, its own time (`ts`) and its timings. */
function contentOf(body: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(body);
  delete out.session; delete out.armRequest; delete out.pageInstance; delete out.ts;
  const sources = out.sources as Record<string, unknown> | undefined;
  if (sources) { delete sources.timings; delete sources.sessionParts; }
  out.decisions = ((out.decisions ?? []) as Array<Record<string, unknown>>).map(decision => {
    const { decisionId, renderOffer, ...rest } = decision;
    return { ...rest, decisionId: decisionId !== undefined, renderOffer: renderOffer !== undefined };
  });
  return out;
}
/** Every effect the first answer could leave: the queue, the ledger objects, the rings, the statistics objects. */
const effectsOf = (m: Mounted) => ({ queued: m.queued.length, ledgerObjects: [...m.storage.objects.keys()].filter(k => k.includes('/decision/') || k.includes('/outcome/')).length,
  rings: m.rings.size, stats: m.stats.size });
/**
 * The first answer's calls to the copy — path, under the minted session, answered — less the copy's own calls made inside
 * one of them (on the do host the forwarded decision reads the record's content snapshot in-object, DESIGN §1 6b).
 */
const copyCallsOf = (w: World, s: Session | null) => w.copies.calls.filter(c => {
  const at = w.copyAt.get(c);
  return !w.copies.calls.some(o => o !== c && (w.copyAt.get(o)?.start ?? Infinity) < (at?.start ?? 0) && ((w.copyAt.get(o)?.end ?? Infinity) > (at?.start ?? 0)));
}).map(c => [c.path, c.capability !== null && c.capability === s?.capability, c.status]);
const DECIDED_ON_COPY = [['/identity/activate', true, 200], ['/authority/request', true, 200]];

function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { wait, open };
}
async function until(ready: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!ready() && Date.now() < end) await sleep(5);
  return ready();
}

// ===========================================================================
// unit:P97.FV1 — the first answer decided on a blank copy, nothing contacted, created or written before it
// ===========================================================================

/** The cases of FV1's content leg and FV5's P84 lock: the holdout, the class drawn, P84's outcome (P84's ruled shapes). */
const CASES = [
  { label: 'no class', share: 0, cls: undefined, armRequest: null },
  { label: 'a class honoured (P84: 30 per cent holdout, `default` drawn)', share: 0.3, cls: 'default' as const, armRequest: { class: 'default', honoured: true } },
  { label: 'a mismatch (P84: a holdout of 0 cannot meet `default`)', share: 0, cls: 'default' as const, armRequest: { class: 'default', honoured: false, reason: 'mismatch' } },
  { label: 'capped (P84: one in a billion, `default` drawn)', share: TINY, cls: 'default' as const, armRequest: { class: 'default', honoured: false, reason: 'capped' } },
];

interface CaseRun { label: string; door: Reply; next: Reply; session: Session | null; copies: ReturnType<typeof copyCallsOf>; expected: unknown }
/** Each case on a mount of its own holdout: the door, drained, then the visitor's next page view on the same page. */
async function runCases(host: Host): Promise<CaseRun[]> {
  const out: CaseRun[] = [];
  for (const c of CASES) {
    const w = await world(host, docsAt(c.share));
    try {
      await door(w); await w.drain(); w.reset();
      const a = await door(w, {}, c.cls); await w.drain();
      const session = sessionOf(a), copies = copyCallsOf(w, session);
      expect([a.status, typeof session?.capability], `${host}: PRECONDITION — ${c.label}: the door answers the first request (${show(a)})`).toEqual([200, 'string']);
      const next = await nextSnapshot(w, session!); await w.drain();
      expect(next.status, `${host}: PRECONDITION — ${c.label}: the visitor's next page view is answered (${show(next)})`).toBe(200);
      out.push({ label: c.label, door: a, next, session, copies, expected: c.armRequest });
    } finally { w.stop(); }
  }
  // republished (P84): a learn publication between the mint's holdout read and the decision's own pin, every identifier
  // moved to `default`; the first answer's forward is parked wherever it runs (the copy's, or the object's) while the
  // operator republishes.
  {
    const w = await world(host, docsAt(TINY));
    try {
      await door(w); await w.drain(); w.reset();
      const parked = gate(); let held = 0;
      w.around = async (call, proceed) => { if (call.path === '/authority/request') { held += 1; await parked.wait; } return proceed(); };
      w.intercept = async call => { if (call.path === '/authority/request' && call.stage === BEFORE) { held += 1; await parked.wait; } };
      const pendingDoor = door(w, {}, 'personalized');
      const reached = await until(() => held > 0, 10_000);
      const put = await putDocument(w.m, 'learn', learnAt(1), 'p97 republished between the mint and the decision');
      parked.open();
      const a = await pendingDoor; await w.drain();
      w.around = null; w.intercept = null;
      expect([reached, put.status], `${host}: PRECONDITION — republished: the first answer's forward is parked and the learn document republishes meanwhile (${JSON.stringify(put.body).slice(0, 200)})`).toEqual([true, 200]);
      const session = sessionOf(a), copies = copyCallsOf(w, session);
      expect([a.status, typeof session?.capability], `${host}: PRECONDITION — republished: the door answers (${show(a)})`).toEqual([200, 'string']);
      const next = await nextSnapshot(w, session!); await w.drain();
      out.push({ label: 'republished (P84: the learn document republished between the mint and the decision)', door: a, next, session, copies,
        expected: { class: 'personalized', honoured: false, reason: 'republished' } });
    } finally { w.stop(); }
  }
  return out;
}
/** P30's context-only page: the door, then the visitor's next page view, both with the same request headers. */
async function contextOnly(host: Host): Promise<{ door: Reply; next: Reply; session: Session | null; copies: ReturnType<typeof copyCallsOf> }> {
  const w = await world(host, docsAt(0, CONTEXT_ONLY));
  try {
    await door(w); await w.drain(); w.reset();
    const a = await door(w); await w.drain();
    const session = sessionOf(a), copies = copyCallsOf(w, session);
    expect([a.status, typeof session?.capability], `${host}: PRECONDITION — P30's context-only page: the door answers (${show(a)})`).toEqual([200, 'string']);
    const next = await nextSnapshot(w, session!); await w.drain();
    return { door: a, next, session, copies };
  } finally { w.stop(); }
}

describe('unit:P97.FV1 (E22, R-P547)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with every call to the new visitor's object held ${HOLD_MS} ms from its first contact, a new visitor's first answer (no class) still answers in less than ${HOLD_MS} ms — Server-Timing \`total\`, sources.timings.total and the caller's own measure — as it does with nothing held; it was decided by today's code on the blank copy (the copy's /identity/activate then /authority/request under the minted session); before the answer no Durable Object was reached or created (the visitor's or any other) and nothing was written to any binding (object storage, the session store, the cache, R2, the queue, D1); its reads are the decision's own (R2's published content and, on the session host only, at most two session-store reads of the minted session's key); the one object call the first request makes is the creation of the visitor's own record, issued after the copy's decision answered; no ledger or learning effect; one \`total\``, async () => {
      const w = await world(host);
      try {
        const warm = await door(w); await w.drain();
        expect([warm.status, typeof sessionOf(warm)?.capability], `${host}: PRECONDITION — the door answers a new visitor's first request (${show(warm)})`).toEqual([200, 'string']);
        w.reset();
        const free = await door(w); await w.drain();
        const freeTotal = entriesOf(free.headers.get('Server-Timing')).total;
        expect([free.status, freeTotal < HOLD_MS], `${host}: PRECONDITION — with nothing held the first answer's total is below ${HOLD_MS} ms (${show(free)})`).toEqual([200, true]);
        w.reset();
        const before = { shoppers: w.m.shoppers.size, stats: w.m.stats.size, rings: w.m.rings.size };
        const ready = new Map<string, Promise<void>>();
        w.intercept = async call => { if (!ready.has(call.name)) ready.set(call.name, sleep(HOLD_MS)); await ready.get(call.name); };
        const a = await door(w);
        const atAnswer = { created: w.m.shoppers.size - before.shoppers, stats: w.m.stats.size - before.stats, rings: w.m.rings.size - before.rings,
          reached: w.objects.filter(c => c.reached === BEFORE).map(c => `${c.binding} ${c.path}`) };
        await w.drain();
        w.intercept = null;
        const session = sessionOf(a);
        expect([a.status, typeof session?.capability], `${host}: PRECONDITION — the held door answers with the issued session (${show(a)})`).toEqual([200, 'string']);
        const total = entriesOf(a.headers.get('Server-Timing')).total ?? NaN, bodyTotal = timingsOf(a).total ?? NaN;
        expect.soft({ header: total < HOLD_MS, body: bodyTotal < HOLD_MS, measured: a.measured < HOLD_MS },
          `${host}: P97.FV1 — the first answer does not wait on the visitor's object: held ${HOLD_MS} ms from its first contact, total ${total} (body ${bodyTotal}, measured ${Math.round(a.measured)}) stays below ${HOLD_MS} ms as with nothing held (${freeTotal}); today the door awaits the activation on the brand-new object`)
          .toEqual({ header: true, body: true, measured: true });
        expect.soft(atAnswer, `${host}: P97.FV1 — before the answer no Durable Object was reached or created; today the activation creates the visitor's object and writes its grant before the answer`)
          .toEqual({ created: 0, stats: 0, rings: 0, reached: [] });
        expect.soft(copyCallsOf(w, session), `${host}: P97.FV1 — decided by today's code on the blank copy of the visitor's record: its activation, then its forward, under the minted session (today no copy: ${JSON.stringify(w.objects.map(c => c.path))} on the object)`)
          .toEqual(DECIDED_ON_COPY);
        const forward = w.copies.calls.find(c => c.path === '/authority/request');
        const decided = forward ? w.copyAt.get(forward)?.end ?? Infinity : Infinity;
        expect.soft(w.objects.map(c => ({ binding: c.binding, own: c.name === ownName(session!.subject), path: c.path, capability: c.capability === session!.capability, afterDecision: c.seq > decided })),
          `${host}: P97.FV1 — the one object call the first request makes is the creation of the visitor's own record (/identity/activate under the issued session), issued after the copy's decision answered`)
          .toEqual([{ binding: 'SHOPPER_REFLEX', own: true, path: '/identity/activate', capability: true, afterDecision: true }]);
        expect.soft(w.ops.filter(o => o.stage === BEFORE && WRITES.has(o.op)).map(o => `${o.binding} ${o.op} ${o.key}`),
          `${host}: P97.FV1 — nothing written to any binding before the answer`).toEqual([]);
        const sessionKey = `session:${session!.sessionId}`;
        const reads = w.ops.filter(o => o.stage === BEFORE && !WRITES.has(o.op));
        expect.soft({
          other: reads.filter(o => !(o.binding === 'STORAGE' && o.op === 'get' && o.key.startsWith('config-publication/')) && !(o.binding === 'SESSIONS' && o.op === 'get' && o.key === sessionKey))
            .map(o => `${o.binding} ${o.op} ${o.key}`),
          sessionReads: reads.filter(o => o.binding === 'SESSIONS').length <= (host === 'session' ? 2 : 0),
        }, `${host}: P97.FV1 — the first answer's reads are the decision's own: the published content and, on the session host, at most two reads of the minted session's key (${JSON.stringify(reads.map(o => `${o.binding} ${o.op} ${o.key}`))})`)
          .toEqual({ other: [], sessionReads: true });
        expect.soft({ effects: effectsOf(w.m), totals: totalsOf(a) }, `${host}: P97.FV1 — no ledger or learning effect; P96's one total`)
          .toEqual({ effects: { queued: 0, ledgerObjects: 0, rings: 0, stats: 0 }, totals: 1 });
      } finally { w.stop(); }
    }, 120_000);

    it(`host (${host}): the first answer is otherwise today's, field by field — decisions, arm, versions, experiment, sources less timings, the session's shape and consent, armRequest — for no class, a class honoured, a mismatch, capped and republished, each decided on the blank copy: equal to what the visitor's own record answers the visitor's next page view on the same page; P30's context key on a context-only page the same as that next page view's; P84's class minted into the identifier; one \`total\``, async () => {
      const runs = await runCases(host);
      for (const run of runs) {
        expect.soft(run.copies, `${host}: P97.FV1 — ${run.label}: decided on the blank copy (its activation, then its forward, under the minted session)`).toEqual(DECIDED_ON_COPY);
        expect.soft(contentOf(run.door.body), `${host}: P97.FV1 — ${run.label}: the first answer's content is today's for the same visitor (the visitor's next page view, answered by the visitor's own record)`)
          .toEqual(contentOf(run.next.body));
        expect.soft({ keys: sorted(Object.keys(run.session ?? {})), consent: run.session?.consent ?? null, armRequest: run.door.body.armRequest ?? null, totals: totalsOf(run.door) },
          `${host}: P97.FV1 — ${run.label}: the session in the session route's shape, consent refused for a brand-new visitor, P84's armRequest, one total`)
          .toEqual({ keys: SESSION_KEYS, consent: REFUSED, armRequest: run.expected, totals: 1 });
      }
      expect.soft(armClassOf(armFor(runs[1]!.session!.subject, holdoutOf(CASES[1]!.share))), `${host}: P97.FV1 — ${CASES[1]!.label}: P84's class minted into the identifier`).toBe('default');
      const p30 = await contextOnly(host);
      expect.soft(p30.copies, `${host}: P97.FV1 — P30's context-only page: decided on the blank copy`).toEqual(DECIDED_ON_COPY);
      const key = p30.door.headers.get('X-Context-Key');
      expect.soft({ key: typeof key === 'string' && key.length > 0, same: key === p30.next.headers.get('X-Context-Key'), content: JSON.stringify(contentOf(p30.door.body)) === JSON.stringify(contentOf(p30.next.body)) },
        `${host}: P97.FV1 — P30's context key on a context-only page, the same as the visitor's next page view's (${key} / ${p30.next.headers.get('X-Context-Key')})`)
        .toEqual({ key: true, same: true, content: true });
    }, 180_000);

    it(`host (${host}): the door's refusals still come first and touch nothing (a malformed \`arm\` member 400, an unknown key 401: no binding operation, no object call, no copy asked); and the activation's checks still gate the answer — the blank copy's activation refusing answers 401 with no session and no decision, and no object is contacted or created and nothing written, before or after the answer`, async () => {
      const w = await world(host);
      try {
        await door(w); await w.drain();
        for (const [label, extra, status] of [['a malformed arm member', { arm: '{"class":"nope"}' }, 400], ['an unknown key', { selector: 'x' }, 401]] as const) {
          w.reset();
          const shoppers = w.m.shoppers.size;
          const r = await door(w, extra as Record<string, unknown>); await w.drain();
          expect.soft({ status: r.status, session: r.body.session ?? null, ops: w.ops.map(o => `${o.binding} ${o.op} ${o.key}`), objects: w.objects.map(c => `${c.binding} ${c.path}`),
            copies: w.copies.calls.map(c => c.path), created: w.m.shoppers.size - shoppers },
          `${host}: P97.FV1 — LOCK: ${label} is refused before anything is issued, read or written`).toEqual({ status, session: null, ops: [], objects: [], copies: [], created: 0 });
        }
        w.reset();
        const shoppers = w.m.shoppers.size;
        w.around = async (call, proceed) => call.path === '/identity/activate' ? Response.json({ ok: false }, { status: 401 }) : proceed();
        const r = await door(w); await w.drain();
        w.around = null;
        expect.soft({ status: r.status, session: r.body.session ?? null, decisions: r.body.decisions ?? null },
          `${host}: P97.FV1 — the activation's refusal on the blank copy answers 401 with no session and no decision (today no copy is asked: ${show(r)})`)
          .toEqual({ status: 401, session: null, decisions: null });
        expect.soft({ asked: w.copies.calls.map(c => c.path), objects: w.objects.map(c => `${c.binding} ${c.path}`), created: w.m.shoppers.size - shoppers,
          writes: w.ops.filter(o => WRITES.has(o.op)).map(o => `${o.binding} ${o.op} ${o.key}`) },
        `${host}: P97.FV1 — the copy's activation was asked and refused; no object contacted or created and nothing written, before or after the answer`)
          .toEqual({ asked: ['/identity/activate'], objects: [], created: 0, writes: [] });
      } finally { w.stop(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P97.FV2 — the real record created after the answer; a lost or late creation made by the next request; a write
// attempted by the copy falls back to today's path with the same visitor
// ===========================================================================

/** The effects the copy's write-refusing environment refuses (R-P547: the session store, the cache, R2, the queue, D1, every other object). */
const EFFECTS: Array<{ name: string; at: '/identity/activate' | '/authority/request'; attempt: (env: Env) => Promise<unknown>; landed: (w: World) => boolean }> = [
  { name: 'a session-store write', at: '/identity/activate', attempt: env => env.SESSIONS.put(MARK, 'x'), landed: w => w.ops.some(o => o.binding === 'SESSIONS' && o.key === MARK) },
  { name: 'a session-store delete', at: '/authority/request', attempt: env => env.SESSIONS.delete(MARK), landed: w => w.ops.some(o => o.binding === 'SESSIONS' && o.key === MARK) },
  { name: 'a cache write', at: '/authority/request', attempt: env => env.CACHE.put(MARK, 'x'), landed: w => w.ops.some(o => o.binding === 'CACHE' && o.key === MARK) },
  { name: 'a cache delete', at: '/authority/request', attempt: env => env.CACHE.delete(MARK), landed: w => w.ops.some(o => o.binding === 'CACHE' && o.key === MARK) },
  { name: 'an R2 write', at: '/authority/request', attempt: env => env.STORAGE.put(MARK, 'x'), landed: w => w.ops.some(o => o.binding === 'STORAGE' && o.key === MARK) },
  { name: 'an R2 delete', at: '/authority/request', attempt: env => env.STORAGE.delete(MARK), landed: w => w.ops.some(o => o.binding === 'STORAGE' && o.key === MARK) },
  { name: 'a queue send', at: '/identity/activate', attempt: env => env.EVENT_QUEUE.send({ mark: MARK }), landed: w => w.ops.some(o => o.binding === 'EVENT_QUEUE') },
  { name: 'a queue batch', at: '/authority/request', attempt: env => env.EVENT_QUEUE.sendBatch([{ body: { mark: MARK } }]), landed: w => w.ops.some(o => o.binding === 'EVENT_QUEUE') },
  { name: 'a D1 statement', at: '/authority/request', attempt: async env => env.DB.prepare('SELECT 1').bind().run(), landed: w => w.ops.some(o => o.binding === 'DB') },
  { name: 'a statistics object', at: '/authority/request', attempt: env => env.LEARN_STATS!.get(env.LEARN_STATS!.idFromName(MARK)).fetch('https://learn/snapshot', { method: 'POST' }),
    landed: w => w.objects.some(c => c.binding === 'LEARN_STATS' && c.name === MARK) },
  { name: 'a decision ring', at: '/authority/request', attempt: env => env.DECISION_RING!.get(env.DECISION_RING!.idFromName(MARK)).fetch('https://ring/state'),
    landed: w => w.objects.some(c => c.binding === 'DECISION_RING' && c.name === MARK) },
  { name: 'another shopper\'s object', at: '/authority/request', attempt: env => env.SHOPPER_REFLEX.get(env.SHOPPER_REFLEX.idFromName(ownName(`vis-${MARK}`))).fetch('https://shopper-reflex/consent'),
    landed: w => w.objects.some(c => c.binding === 'SHOPPER_REFLEX' && c.name === ownName(`vis-${MARK}`)) },
];

describe('unit:P97.FV2 (E22, R-P547)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the visitor's real record is created right after the answer, outside the answer's time — with the visitor's object held ${HOLD_MS} ms from its first contact, the record does not exist when the answer arrives, and once the work after the answer is drained it holds exactly grantAuthority for the issued grant and nothing else; the visitor's next page view answers 200`, async () => {
      const w = await world(host);
      try {
        await door(w); await w.drain(); w.reset();
        const ready = new Map<string, Promise<void>>();
        w.intercept = async call => { if (!ready.has(call.name)) ready.set(call.name, sleep(HOLD_MS)); await ready.get(call.name); };
        const a = await door(w);
        const session = sessionOf(a);
        expect([a.status, typeof session?.capability], `${host}: PRECONDITION — the door answers with the issued session (${show(a)})`).toEqual([200, 'string']);
        const atAnswer = heldBy(w, session!);
        await w.drain();
        w.intercept = null;
        expect.soft(atAnswer.keys, `${host}: P97.FV2 — the visitor's record does not exist when the first answer arrives (today it is created, its grant written, before the answer)`).toBeNull();
        expect.soft(heldBy(w, session!), `${host}: P97.FV2 — after the answer, the visitor's record holds exactly grantAuthority for the issued grant`)
          .toEqual({ keys: ['grantAuthority'], grants: [session!.grantId], epoch: session!.authorityEpoch });
        const next = await nextSnapshot(w, session!); await w.drain();
        expect.soft([next.status, heldBy(w, session!).grants], `${host}: P97.FV2 — the session is usable on the next request`).toEqual([200, [session!.grantId]]);
      } finally { w.stop(); }
    }, 120_000);

    it(`host (${host}): a creation lost after the answer is made by the visitor's next request — the record's creation failing, the first answer is still 200 with its session, and the next page view, the next action and the session route each answer 200 and adopt the grant, the record then holding exactly grantAuthority for it and nothing else`, async () => {
      const w = await world(host);
      try {
        await door(w); await w.drain();
        const lost = new Set<string>();
        w.intercept = async call => { if (call.path === '/identity/activate' && !lost.has(call.name)) { lost.add(call.name); throw new Error('the creation of the record is lost'); } };
        for (const kind of ['next page view', 'next action', 'session route'] as const) {
          w.reset();
          const a = await door(w); await w.drain();
          const session = sessionOf(a);
          expect([a.status, typeof session?.capability], `${host}: P97.FV2 — ${kind}: with the record's creation lost the first answer is still 200 with its session (today the door awaits that creation: ${show(a)})`).toEqual([200, 'string']);
          const before = heldBy(w, session!);
          const n = kind === 'next page view' ? await nextSnapshot(w, session!) : kind === 'next action' ? await nextAction(w, session!) : await sessionRoute(w, session!);
          await w.drain();
          expect.soft({ lostBefore: before.grants, next: n.status, after: heldBy(w, session!) }, `${host}: P97.FV2 — ${kind}: answers 200 and adopts the grant, nothing else stored (${show(n)})`)
            .toEqual({ lostBefore: null, next: 200, after: { keys: ['grantAuthority'], grants: [session!.grantId], epoch: session!.authorityEpoch } });
        }
      } finally { w.intercept = null; w.stop(); }
    }, 120_000);

    it(`host (${host}): a next request that arrives before the creation answers 200 and stores the grant once; the creation then completes (its activation answered 200) and the record holds exactly one grant`, async () => {
      const w = await world(host);
      try {
        await door(w); await w.drain(); w.reset();
        const held = gate(); const creations: ObjectCall[] = [];
        w.intercept = async call => { if (call.path === '/identity/activate' && creations.length === 0) { creations.push(call); await held.wait; } };
        const pendingDoor = door(w);
        const first = await Promise.race([pendingDoor, sleep(WAITED_MS).then(() => null)]);
        if (!first) held.open();
        const a = first ?? await pendingDoor;
        const session = sessionOf(a);
        expect([first === null ? `the first answer waited on the held creation (over ${WAITED_MS} ms)` : 'answered', a.status, typeof session?.capability],
          `${host}: P97.FV2 — the first answer does not wait on the creation (${show(a)})`).toEqual(['answered', 200, 'string']);
        const n = await nextSnapshot(w, session!);
        const atNext = heldBy(w, session!);
        held.open();
        await w.drain();
        w.intercept = null;
        expect.soft({ next: n.status, grantsAtNext: atNext.grants, creation: creations.map(c => [c.name === ownName(session!.subject), c.status]), after: heldBy(w, session!) },
          `${host}: P97.FV2 — the next request adopts the grant before the creation, which then completes over it`)
          .toEqual({ next: 200, grantsAtNext: [session!.grantId], creation: [[true, 200]], after: { keys: ['grantAuthority'], grants: [session!.grantId], epoch: session!.authorityEpoch } });
      } finally { w.stop(); }
    }, 120_000);

    it(`host (${host}): any write the blank copy attempts — ${EFFECTS.map(e => e.name).join(', ')} — is refused there (it never reaches the binding) and the door falls back to today's path: the real activation and forward on the visitor's own object before the answer, under the very session the copy was given (the same minted visitor id), and the same answer`, async () => {
      for (const effect of EFFECTS) {
        const w = await world(host);
        try {
          await door(w); await w.drain(); w.reset();
          let attempted = 'not attempted (no copy asked)';
          w.around = async (call, proceed, env) => {
            if (call.path === effect.at && attempted.startsWith('not attempted')) {
              try { await effect.attempt(env); attempted = 'allowed'; } catch { attempted = 'refused'; }
            }
            return proceed();
          };
          const a = await door(w);
          const landed = effect.landed(w);
          const session = sessionOf(a);
          const copyActivation = w.copies.calls.find(c => c.path === '/identity/activate');
          // Today's path, the first two calls the door makes to the visitor's own object before its answer.
          const real = w.objects.filter(c => c.binding === 'SHOPPER_REFLEX' && c.stage === BEFORE).slice(0, 2)
            .map(c => [c.path, c.name === ownName(session?.subject ?? ''), c.capability === session?.capability]);
          await w.drain();
          w.around = null;
          expect.soft({ attempted, landed, status: a.status, sameSession: copyActivation?.capability === session?.capability && session !== null, real },
            `${host}: P97.FV2 — ${effect.name} attempted by the copy at ${effect.at}: refused there, never reaching the binding; the door falls back to the real activation and forward under the same minted session (${show(a)})`)
            .toEqual({ attempted: 'refused', landed: false, status: 200, sameSession: true, real: [['/identity/activate', true, true], ['/authority/request', true, true]] });
          if (session) {
            const next = await nextSnapshot(w, session); await w.drain();
            expect.soft({ same: JSON.stringify(contentOf(a.body)) === JSON.stringify(contentOf(next.body)), record: heldBy(w, session) },
              `${host}: P97.FV2 — ${effect.name}: the same answer (the visitor's next page view's content), the record holding the one grant`)
              .toEqual({ same: true, record: { keys: ['grantAuthority'], grants: [session.grantId], epoch: session.authorityEpoch } });
          }
        } finally { w.stop(); }
      }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P97.FV3 — the instrumentation: the object's own parts of the activation, internal; sessionParts on the door
// ===========================================================================

describe('unit:P97.FV3 (E22, R-P547)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the first answer's activation, whichever object runs it, answers with an internal X-Owner-Timing naming its parts (queue, grant, consent, ${host === 'session' ? 'restrict, ' : ''}alarm, commit, op) in whole milliseconds — held ${TRIP_MS} ms before it reaches the object, \`op\` (the object's own time) stays below ${TRIP_MS}${host === 'session' ? ` and \`restrict\` carries the session store's read held ${RESTRICT_MS} ms` : ''}; the door's 200 answer carries sources.sessionParts { mint, activate, verify, object } beside sources.timings, \`object\` that header's parts and \`activate\` the round trip (at least ${TRIP_MS} ms and the object's \`op\`); Server-Timing and sources.timings unchanged (the five stages, session, forward, total, the header's entries the body's, one total) and no X-Owner-Timing on the door's answer`, async () => {
      const w = await world(host);
      try {
        await door(w); await w.drain(); w.reset();
        let first = true;
        w.intercept = async call => { if (call.path === '/identity/activate' && call.stage === BEFORE && first && w.copies.calls.length === 0) { first = false; await sleep(TRIP_MS); } };
        w.around = async (call, proceed) => { if (call.path === '/identity/activate' && first) { first = false; await sleep(TRIP_MS); } return proceed(); };
        w.holdRestrict = host === 'session';
        const a = await door(w);
        w.holdRestrict = false;
        await w.drain();
        w.intercept = null; w.around = null;
        expect([a.status, typeof sessionOf(a)?.capability], `${host}: PRECONDITION — the door answers (${show(a)})`).toEqual([200, 'string']);
        // The first answer's activation: on the copy when the door decided on one, else on the object before the answer.
        const activation = w.copies.calls.find(c => c.path === '/identity/activate')
          ?? w.objects.find(c => c.binding === 'SHOPPER_REFLEX' && c.path === '/identity/activate' && c.stage === BEFORE);
        const header = activation?.headers?.get('X-Owner-Timing') ?? null;
        const parts = entriesOf(header);
        const names = sorted(Object.keys(parts));
        expect.soft({ names: host === 'session' ? names : names.filter(n => n !== 'restrict'), whole: rawDurations(header).filter(d => !/^\d+$/.test(d)) },
          `${host}: P97.FV3 — the activation's own answer names its parts in whole milliseconds (X-Owner-Timing: ${header})`)
          .toEqual({ names: host === 'session' ? sorted([...OWNER_PARTS, 'restrict']) : OWNER_PARTS, whole: [] });
        expect.soft({ op: parts.op! < TRIP_MS ? 'the object\'s own time' : `op ${parts.op}`,
          restrict: host === 'do' || (parts.restrict! >= RESTRICT_MS && parts.op! >= RESTRICT_MS) ? 'the restriction\'s read' : `restrict ${parts.restrict}, op ${parts.op}` },
        `${host}: P97.FV3 — the parts time the object's own work (X-Owner-Timing: ${header})`).toEqual({ op: 'the object\'s own time', restrict: 'the restriction\'s read' });
        const sessionParts = (a.body.sources as { sessionParts?: Record<string, unknown> } | undefined)?.sessionParts ?? null;
        const numeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
        expect.soft({ keys: sessionParts ? sorted(Object.keys(sessionParts)) : null, object: sessionParts?.object ?? null,
          mint: numeric(sessionParts?.mint), verify: numeric(sessionParts?.verify),
          activate: numeric(sessionParts?.activate) && (sessionParts!.activate as number) >= TRIP_MS && (sessionParts!.activate as number) + 1 >= (parts.op ?? Infinity) },
        `${host}: P97.FV3 — the door's answer carries sources.sessionParts, its object the activation's parts (${JSON.stringify(sessionParts)})`)
          .toEqual({ keys: ['activate', 'mint', 'object', 'verify'], object: header ? parts : 'the activation\'s X-Owner-Timing', mint: true, verify: true, activate: true });
        const entries = entriesOf(a.headers.get('Server-Timing'));
        expect.soft({ names: sorted(Object.keys(entries)), body: Object.entries(entries).filter(([name, ms]) => Math.abs((timingsOf(a)[name] ?? NaN) - ms) > 1).map(([name]) => name),
          bodyNames: sorted(Object.keys(timingsOf(a))), totals: totalsOf(a), internal: a.headers.get('X-Owner-Timing') },
        `${host}: P97.FV3 — Server-Timing and sources.timings unchanged, no X-Owner-Timing on the door's answer (${a.headers.get('Server-Timing')})`)
          .toEqual({ names: sorted([...STAGES, ...DOOR]), body: [], bodyNames: sorted([...STAGES, ...DOOR]), totals: 1, internal: null });
      } finally { w.stop(); }
    }, 120_000);

    it(`host (${host}): LOCK — no answer a browser receives carries X-Owner-Timing or the object's parts: the door's 200, its refusals (a malformed \`arm\` 400, an unknown key 401), the visitor's next page view and action, and the session route for a fresh browser (whose activation runs on its new object) and for the held session; the session route's answer keeps its shape, no sessionParts in it`, async () => {
      const w = await world(host);
      try {
        await door(w); await w.drain();
        const a = await door(w); await w.drain();
        const s = sessionOf(a);
        expect([a.status, typeof s?.capability], `${host}: PRECONDITION — the door answers (${show(a)})`).toEqual([200, 'string']);
        const answers: Array<[string, Reply]> = [['the door', a],
          ['a malformed arm 400', await door(w, { arm: '{"class":"nope"}' })], ['an unknown key 401', await door(w, { selector: 'x' })],
          ['the next page view', await nextSnapshot(w, s!)], ['the next action', await nextAction(w, s!)],
          ['the session route, a fresh browser', await sessionRoute(w, null)], ['the session route, the held session', await sessionRoute(w, s)]];
        await w.drain();
        expect.soft(answers.map(([label, r]) => [label, r.headers.get('X-Owner-Timing'), label !== 'the door' && JSON.stringify(r.body).includes('sessionParts')]),
          `${host}: P97.FV3 — no browser-facing answer carries X-Owner-Timing, and none but the door's carries sessionParts`)
          .toEqual(answers.map(([label]) => [label, null, false]));
        const fresh = answers.find(([label]) => label === 'the session route, a fresh browser')![1];
        expect.soft([fresh.status, sorted(Object.keys(fresh.body)), sorted(Object.keys((fresh.body.session ?? {}) as object))],
          `${host}: P97.FV3 — LOCK: the session route's answer keeps its shape (${show(fresh)})`).toEqual([200, SESSION_ROUTE_KEYS, SESSION_KEYS]);
      } finally { w.stop(); }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P97.FV4 — kits 01 and 02 state the design
// ===========================================================================

describe('unit:P97.FV4 (E22, R-P547)', () => {
  const paragraphs = (file: string) => readTree(file).split(/\n\s*\n/).map(p => p.split('\n').join(' '));
  const sentencesOf = (paragraph: string): string[] => paragraph.split(/(?<=[.!?])\s+(?=[A-Z*`])/);
  const plain = (s: string) => s.replace(/`/g, '').replace(/[‘’]/g, '\'');
  const blankCopy = (s: string) => /\bblank\b[^.]*\bcopy\b/i.test(s) && /\brecord\b/i.test(s);
  const noWait = (s: string) => /\b(?:does not|doesn't|do not|never|without)\b[^.]*\bwait/i.test(s) && /\bcreat/i.test(s) && /\brecord\b/i.test(s);
  const madeAfter = (s: string) => /\bafter the (?:first )?answer\b/i.test(s) && /\bnext request\b/i.test(s) && /\brecord\b/i.test(s);

  it('logic: kit 02\'s first-request paragraph says, in its session sentences, that the first answer is decided on a blank copy of the new visitor\'s record and does not wait on creating the record, which is made right after the answer or by the visitor\'s next request; the `session` entry no longer says the activation runs on the new shopper\'s object; sources.sessionParts is named as a diagnostic; P76 FA2\'s Server-Timing sentence (session, forward, arm, total, the five stages, sources.timings, the forwarded decision), P96 OT4\'s door total and P13 H5\'s first-request statement still hold', () => {
    const paragraph = paragraphs('docs/kit/02-api-reference.md').find(p => p.startsWith('**A new visitor\'s first request.**')) ?? '';
    expect(paragraph, 'PRECONDITION: kit 02 carries the first-request paragraph').not.toBe('');
    const sentences = sentencesOf(paragraph).map(plain);
    const timing = sentencesOf(paragraph).filter(s => s.includes('Server-Timing')).join(' ');
    const sessionEntry = /`session`\s*\(([^)]*)\)/.exec(timing)?.[1] ?? '';
    expect.soft({
      blankCopy: sentences.some(s => blankCopy(s) && /\bsession\b/i.test(s) && /\bissu/i.test(s)),
      noWait: sentences.some(noWait),
      madeAfter: sentences.some(madeAfter),
      sessionEntry: /\bcopy\b/i.test(sessionEntry) && !/new shopper's object/i.test(plain(sessionEntry)),
      diagnostic: sentencesOf(paragraph).some(s => /`sources\.sessionParts`|\bsources\.sessionParts\b/.test(s) && /\bdiagnos/i.test(s)),
    }, `P97.FV4 — kit 02 states the design in its session sentences (today: "${plain(sentences.find(s => /session is issued/i.test(s)) ?? '').slice(0, 160)}"; the session entry: "${sessionEntry}")`).toEqual({
      blankCopy: true, noWait: true, madeAfter: true, sessionEntry: true, diagnostic: true });
    expect.soft({
      names: ['Server-Timing', ...STAGES, ...DOOR, 'arm'].map(n => n === 'Server-Timing' ? n : `\`${n}\``).filter(n => !timing.includes(n)),
      timings: /`sources\.timings`|`timings`/.test(paragraph),
      forwarded: /forwarded decision/i.test(paragraph),
      doorTotal: sentencesOf(paragraph).some(s => s.includes('`total`') && /\bwhole time\b/.test(s) && /\bfirst request|\bdoor\b/i.test(s)) && /\badds? up\b/.test(paragraph),
      firstRequest: sentences.some(s => /first request|one (call|request)/i.test(s) && /session/i.test(s) && /decision/i.test(s)),
    }, 'P97.FV4 — LOCK: P76 FA2\'s Server-Timing sentence, P96 OT4\'s door total and P13 H5\'s first-request statement still hold').toEqual({
      names: [], timings: true, forwarded: true, doorTotal: true, firstRequest: true });
  });

  it('logic: kit 01\'s first-request paragraph says the first answer does not wait on creating the visitor\'s record; P13 H5\'s first-request statement still holds there', () => {
    const paragraph = paragraphs('docs/kit/01-integration-guide.md').find(p => p.startsWith('**The first decision on the first request.**')) ?? '';
    expect(paragraph, 'PRECONDITION: kit 01 carries the first-request paragraph').not.toBe('');
    const sentences = sentencesOf(paragraph).map(plain);
    expect.soft({ noWait: sentences.some(noWait), firstRequest: sentences.some(s => /first request|one (call|request)/i.test(s) && /session/i.test(s) && /decision/i.test(s)) },
      `P97.FV4 — kit 01 says the first answer does not wait on creating the visitor's record (today: "${paragraph.slice(0, 160)}")`).toEqual({ noWait: true, firstRequest: true });
  });
});

// ===========================================================================
// unit:P97.FV5 — the locks
// ===========================================================================

describe('unit:P97.FV5 (E22, R-P547; LOCK)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — refusing hints, and a cookie claiming consent, store nothing and serve the default arm: with no hint, the body refusing both, the cookies refusing both and a cookie claiming both, the first answer's session states both refused, its arm is \`default\`, and once drained the visitor's record holds its grant alone (no consent stored) and nothing is written to any binding`, async () => {
      const w = await world(host);
      try {
        await door(w); await w.drain();
        for (const [label, extra, cookie] of [['no hint', {}, null], ['the body refusing both', { trackingConsent: 'false', personalizationEnabled: 'false' }, null],
          ['the cookies refusing both', {}, 'opt_tracking_consent=false; opt_personalization_enabled=false'],
          ['a cookie claiming consent', {}, 'opt_tracking_consent=true; opt_personalization_enabled=true']] as const) {
          w.reset();
          const a = await door(w, extra as Record<string, unknown>, undefined, cookie ? { Cookie: cookie } : {}); await w.drain();
          const s = sessionOf(a);
          expect([a.status, typeof s?.capability], `${host}: PRECONDITION — ${label}: the door answers (${show(a)})`).toEqual([200, 'string']);
          expect.soft({ consent: s!.consent, arm: a.body.arm ?? null, record: heldBy(w, s!).keys, writes: w.ops.filter(o => WRITES.has(o.op)).map(o => `${o.binding} ${o.op} ${o.key}`), queued: w.m.queued.length },
            `${host}: P97.FV5 — LOCK: ${label} stores nothing and serves the default arm`).toEqual({ consent: REFUSED, arm: 'default', record: ['grantAuthority'], writes: [], queued: 0 });
        }
      } finally { w.stop(); }
    }, 120_000);

    it(`host (${host}): LOCK — P13 D1's session-first door: the visitor's own object is the record, entered on every later request — the next page view, the next action and a second page view each reach the visitor's own object (/authority/request under the session) and none is decided on a copy`, async () => {
      const w = await world(host);
      try {
        await door(w); await w.drain();
        const a = await door(w); await w.drain();
        const s = sessionOf(a);
        expect([a.status, typeof s?.capability], `${host}: PRECONDITION — the door answers (${show(a)})`).toEqual([200, 'string']);
        for (const [label, run] of [['the next page view', () => nextSnapshot(w, s!)], ['the next action', () => nextAction(w, s!)], ['a second page view', () => nextSnapshot(w, s!)]] as const) {
          w.reset();
          const r = await run(); await w.drain();
          expect.soft({ status: r.status, own: w.objects.filter(c => c.binding === 'SHOPPER_REFLEX' && c.stage === BEFORE).map(c => [c.name === ownName(s!.subject), c.path, c.capability === s!.capability]),
            copies: w.copies.calls.map(c => c.path) },
          `${host}: P97.FV5 — LOCK: ${label} is entered through the visitor's own object (${show(r)})`).toEqual({ status: 200, own: [[true, '/authority/request', true]], copies: [] });
        }
      } finally { w.stop(); }
    }, 120_000);

    it(`host (${host}): LOCK — P84, P30 and P96 on the first answer as today: armRequest for no class, a class honoured (the class minted into the identifier), a mismatch, capped and republished; P30's context key on a context-only page the visitor's next page view's; one \`total\``, async () => {
      const runs = await runCases(host);
      expect.soft(runs.map(run => [run.label, run.door.body.armRequest ?? null, totalsOf(run.door)]), `${host}: P97.FV5 — LOCK: P84's armRequest and P96's one total`)
        .toEqual(runs.map(run => [run.label, run.expected, 1]));
      expect.soft(armClassOf(armFor(runs[1]!.session!.subject, holdoutOf(CASES[1]!.share))), `${host}: P97.FV5 — LOCK: P84's class minted into the identifier`).toBe('default');
      const p30 = await contextOnly(host);
      const key = p30.door.headers.get('X-Context-Key');
      expect.soft([typeof key === 'string' && key.length > 0, key === p30.next.headers.get('X-Context-Key'), totalsOf(p30.door)], `${host}: P97.FV5 — LOCK: P30's context key, P96's one total`)
        .toEqual([true, true, 1]);
    }, 180_000);
  }
});
