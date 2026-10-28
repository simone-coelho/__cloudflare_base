// src/units/P96/LEDGER.unit.test.ts
// P96 under the Closure Ledger (programme `tapestry-parity-scale`, amendment 12, item E21; batch S40): the tests for the
// LOCAL criteria OT1–OT4 of the P96 work order (docs/parity/scale/program.json). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-12/BTI-Parity-Amendment-2026-10-26-scale.md:25–28, E21):
//   "#### E21 · One `total` on a door answer
//    - **Authority:** lane L19 (R-P485): every answer carries the platform's own `total;…;desc="Total Response Time"` entry
//      (`src/index.ts:67`), so a first-request door answer names `total` twice beside P76's.
//    - **Done when:** the door's own entry has a name of its own (or the platform's entry is not repeated on the door), the
//      kit saying which to read; P76's legs hold.
//    - **Needed by:** the December test. Hours."
// THE DESIGN, RULED (R-P526; the brief S40/SPEC-BRIEF-P96.md): (1) P76's names stay — the door keeps its `total` (OT2 locks
// P76's legs), so the platform's own `total` entry is not added to a first-request door answer (E21's first means; the
// mechanism is the builder's, the legs pin the header); (2) every other answer keeps the platform's `total` with its `desc`
// exactly as today (OT3), the door's own refusals included; (3) on a door answer, with and without a drawn class, on both
// hosts, no entry name twice, the header's entries equal to sources.timings', `total` without a `desc` (OT1); (4) kit 02's
// first-request paragraph says `total` there is the door's whole time and every other answer's `total`, the one with
// `desc="Total Response Time"`, the platform's whole time (OT4).
//
// TODAY (7f304a75): the timing middleware `app.use('*', timing())` (src/index.ts:67, hono/timing: after the route has
// answered it appends `total;dur=<ms, one decimal>;desc="Total Response Time"` to every answer's Server-Timing) and the door
// (src/routes/decisions.ts firstDecisionRequest, :1166–1169: `own` = `session`, `forward`, `arm` where drawn, `total`, set
// on the header after the forwarded decision's five stages and mirrored in sources.timings, :1170). So a door answer's
// header ends `…, total;dur=<door>, total;dur=<platform>;desc="Total Response Time"`.
//
// THE READINGS (where the brief is silent):
//   1 The real path. The platform's entry is added by src/index.ts alone; src/units/_parity.ts mounts the routes without it
//     (which is why P76's legs passed with the name doubled). Every host leg here calls the REAL Worker default export of
//     src/index.ts over _parity's mounted environment (its published documents, the real ShopperReflex, DecisionRing and
//     LearnStats classes, either shopper host), with AUTH_MODE `enforced` and a synthetic site key, as every hosted
//     configuration's [vars] sets it (wrangler.toml, wrangler.*.toml). The three module doubles every suite loading the
//     Worker registers (src/demos/kit/root.worker.test.ts, src/units/H3/ORIGIN.unit.test.ts) are registered; the Agents
//     router double throws and is never reached on an enforced stamp.
//   2 A cold and a warm door: cold is the first door answer after the mount (mount invalidates every module cache), warm a
//     second new visitor's first answer on the same mount. Both, with and without a drawn class, on both hosts.
//   3 OT1 "the door's entries in the header equal its sources.timings entries": the header's whole entry list (name and
//     duration, a repeated name kept) equals sources.timings' entries exactly — so no entry beyond the door's is on its
//     header (the platform's under another name included), and both carry the same whole-millisecond numbers.
//   4 OT2 on the real Worker: the door's own entries are read as the walkers read them (the entries without a `desc`): the
//     five stages, `session`, a remainder (its name the builder's, P76's reading 1; `forward` today), `arm` exactly when the
//     page drew a class, and `total`; the same names in sources.timings with the same values (within 1 ms, P76's form);
//     `total` the door's whole time (at most the caller's own measure + 2 ms, the other entries adding up to it within
//     SLACK); kit 02's Server-Timing sentence names every one in backticks. P76's own file is the lock run unchanged.
//   5 OT3 "exactly as today": one entry named `total` in the form `total;dur=<number>;desc="Total Response Time"` (the
//     decimals not pinned). The answers: the visitor's NEXT page view holding the session the door issued (P76's held-session
//     leg on the real Worker, the real flow: the header carries the five stages and the platform's `total`, sources.timings
//     the five stages alone); the door's own 400 for a malformed `arm` member; a tenant the stamp does not provision at the
//     door's address (the tenant middleware's 403 in front of the door); an operator read (`GET /content/learn`); the
//     liveness probe (`GET /health/live`).
//   6 OT4: in kit 02's first-request paragraph, (a) a sentence saying `total` is the first request's (the door's) whole time,
//     with the paragraph's add-up clause and its "but for the reading of its body" (today's words hold it: a lock inside
//     the leg), and (b) the sentence(s) naming `Total Response Time` name `total` and its `desc`, say it is on every other
//     answer and that it is the platform's whole time. No other wording is pinned.
//
// R10 SWEEP (src/**/*.test.ts, scripts/**/*.test.mjs): no test reads Server-Timing through src/index.ts; P76 reads it
// through _parity's routes-only mount (no platform entry there; its legs unchanged under the ruled design); no test pins a
// response's whole header set on any answer this ticket touches; no test reads `Total Response Time`. W38 B5 reads
// sources.timings through serveContentDecisions (the stage names, untouched). Kit 02 :337 is read by P76 FA1/FA2
// (timingSentence: the sentences naming Server-Timing must name every door entry; no sentence may say the reads are
// aborted) and by P13 H5 (the first-request statements). None collides.
//
// DEFERRED: LV1 (on the pair's next release, a cold and a warm door answer on both pair hosts name `total` once, the header
// equal to sources.timings, read as lane L19 read them; lane L20). RESIDUALS (told): the work order's line references are
// stale (decisions.ts :1162–1165 now firstDecisionRequest :1166–1169); scripts/latency.mjs reads `total` from the header
// (the last of a repeated name wins), on a door answer the door's whole time once the name is single; kit 02's "A page
// view that already holds a session carries the five stages alone" is true of sources.timings while its header also
// carries the platform's `total` (OT4's sentence says so; not demanded to change); the door's header stays unreadable
// cross-origin (no Timing-Allow-Origin), as P76 states, outside E21.
//
// NO NEW EXPORT IS IMPORTED. HARNESS: src/units/_parity.ts (the mounted environment, both hosts) and the real Worker
// (src/index.ts). Imports from src/units/: ../_parity.

import { describe, expect, it, vi } from 'vitest';

vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import type { Env } from '@/types/env';

import { BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, pageInstanceOf, readTree, TENANT,
  type Host, type Mounted } from '../_parity';

const DOCS = { pieces: [...MODULES], slots: declaredSlots([layoutSlot()]), learn: learnDocument() };
/** The forwarded decision's five stages (src/content/service.ts laps; W38 B5's names). */
const STAGES = ['documents', 'shopper', 'trend', 'lift', 'decide'];
/** The door's named entries beside its remainder (P76). */
const DOOR = ['session', 'arm', 'total'];
/** The platform's own entry as the timing middleware writes it today (hono/timing: `total`, its duration, its description). */
const PLATFORM = /^total;dur=\d+(?:\.\d+)?;desc="Total Response Time"$/;
/** A synthetic site key for the stamp's one tenant, and a tenant id the stamp does not provision. */
const SITE_KEY = 'p96-synthetic-site-key';
const UNPROVISIONED = 'p96-unprovisioned';
/** The add-up slack of P76's legs (a loaded machine). */
const SLACK = 200;

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };
let worker: Promise<Worker> | undefined;
/** The real Worker default export, loaded once per file after the module doubles above are registered. */
const loadWorker = (): Promise<Worker> => (worker ??= import('@/index').then(module => module.default as unknown as Worker));

interface Reply { status: number; header: string | null; body: Record<string, unknown>; measured: number }
interface Stamp { host: Host; m: Mounted; call: (method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: string) => Promise<Reply> }

/**
 * One shopper host's stamp: _parity's mounted environment (the tenant's documents published), enforced as the hosted
 * configurations are, every request through the Worker's own `fetch`; each call's background work drained after it.
 */
async function stamp(host: Host): Promise<Stamp> {
  const m = await mount(host, DOCS);
  expectPublished(m, 'P96 — the tenant documents publish');
  Object.assign(m.env as unknown as Record<string, unknown>, { AUTH_MODE: 'enforced', SDK_KEYS: `${TENANT}:${SITE_KEY}` });
  const app = await loadWorker();
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext;
  const call: Stamp['call'] = async (method, path, headers, body) => {
    const started = performance.now();
    const response = await app.fetch(new Request(`https://shop.invalid${path}`, { method, headers, ...(body === undefined ? {} : { body }) }), m.env, ctx);
    const measured = performance.now() - started;
    const answer = await response.json().catch(() => ({})) as Record<string, unknown>;
    while (pending.length) await Promise.all(pending.splice(0)).catch(() => undefined);
    await m.drain();
    return { status: response.status, header: response.headers.get('Server-Timing'), body: answer, measured };
  };
  return { host, m, call };
}

/** The headers the SDK sends on a decision request: the tenant, the site key, JSON. */
const shopperHeaders = (tenant: string): Record<string, string> => ({ 'X-Tenant': tenant, 'X-SDK-Key': SITE_KEY, 'Content-Type': 'application/json' });
/** A new visitor's first request (P13 H4's door): no session; the page's class drawn when `cls` is given (P84's member). */
const door = (s: Stamp, cls?: 'default' | 'personalized'): Promise<Reply> => s.call('POST', `/v1/${TENANT}/decisions/snapshot`, shopperHeaders(TENANT),
  JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p96-door'), ...(cls ? { arm: JSON.stringify({ class: cls, tableVersion: 'p96-table' }) } : {}) }));

interface Entry { name: string; dur: number | null; desc: string | null; raw: string }
/** Server-Timing as its entries, in order, a repeated name kept (a comma inside a quoted description does not split). */
function entriesOf(header: string | null): Entry[] {
  return ((header ?? '').match(/(?:[^,"]|"[^"]*")+/g) ?? []).map(part => part.trim()).filter(Boolean).map(raw => {
    const [name = '', ...params] = raw.split(';').map(param => param.trim());
    const param = (key: string) => params.find(p => p.toLowerCase().startsWith(`${key}=`))?.slice(key.length + 1) ?? null;
    const dur = param('dur'), desc = param('desc');
    return { name, dur: dur === null ? null : Number(dur), desc: desc === null ? null : desc.replace(/^"(.*)"$/, '$1'), raw };
  });
}
const timingsOf = (r: Reply) => ((r.body.sources as { timings?: Record<string, number> } | undefined)?.timings ?? {});
const sorted = (names: string[]) => [...names].sort();
const byEntry = (a: [string, number | null], b: [string, number | null]) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] ?? -1) - (b[1] ?? -1);
const show = (r: Reply) => `${r.status} ${r.header ?? 'no Server-Timing'} ${JSON.stringify(timingsOf(r))}`;
/** Each `total` entry of an answer: the platform's own in today's form, or the entry as written. */
const platformTotals = (r: Reply) => entriesOf(r.header).filter(e => e.name === 'total').map(e => PLATFORM.test(e.raw) ? 'the platform\'s total' : e.raw);

/** The precondition of every door leg: the session issued, the forwarded decision's stages answered, the drawn class minted. */
function expectDoor(host: Host, label: string, a: Reply, cls?: 'personalized'): void {
  expect([a.status, typeof (a.body.session as { capability?: unknown } | undefined)?.capability, STAGES.filter(stage => !(stage in timingsOf(a))),
    cls ? (a.body.armRequest as { class?: unknown } | undefined)?.class ?? null : null],
  `${host}: PRECONDITION — ${label}: the door issues the session and answers the forwarded decision's five stages (${show(a)})`).toEqual([200, 'string', [], cls ?? null]);
}

/** OT1 on one door answer. */
function expectOneTotal(host: Host, label: string, a: Reply): void {
  const list = entriesOf(a.header), names = list.map(e => e.name);
  expect.soft({
    total: names.filter(name => name === 'total').length,
    twice: [...new Set(names.filter((name, i) => names.indexOf(name) !== i))],
    totalDesc: list.filter(e => e.name === 'total' && e.desc !== null).map(e => e.raw),
    entries: list.map(e => [e.name, e.dur] as [string, number | null]).sort(byEntry),
  }, `${host}: P96.OT1 — ${label}: Server-Timing names \`total\` once, no name twice, \`total\` without a desc, its entries exactly sources.timings' (today: ${a.header})`).toEqual({
    total: 1, twice: [], totalDesc: [], entries: (Object.entries(timingsOf(a)) as Array<[string, number | null]>).sort(byEntry) });
}

/**
 * P76's reading (R-P452 G1): the sentence(s) of kit 02's first-request paragraph that name `Server-Timing`, where the door's
 * entries are described.
 */
const firstRequestParagraph = (): string => readTree('docs/kit/02-api-reference.md').split(/\n\s*\n/).map(p => p.split('\n').join(' '))
  .find(p => p.startsWith('**A new visitor\'s first request.**')) ?? '';
const sentencesOf = (paragraph: string): string[] => paragraph.split(/(?<=[.!?])\s+(?=[A-Z*`])/);
const timingSentence = (): string => sentencesOf(firstRequestParagraph()).filter(sentence => sentence.includes('Server-Timing')).join(' ');

// ===========================================================================
// unit:P96.OT1 — the door's answer names `total` once
// ===========================================================================

describe('unit:P96.OT1 (E21, R-P526)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a new visitor's first answer through the first-request door with no class drawn, cold (the first after the mount) and warm (a second new visitor on the same mount), through the real Worker (src/index.ts): Server-Timing names \`total\` exactly once, no entry name twice, \`total\` carries no \`desc\`, and the header's entries are exactly sources.timings' (the five stages, \`session\`, the remainder, \`total\`)`, async () => {
      const s = await stamp(host);
      for (const label of ['the cold door', 'the warm door']) {
        const a = await door(s);
        expectDoor(host, label, a);
        expectOneTotal(host, `${label}, no class drawn`, a);
      }
    }, 120_000);

    it(`host (${host}): a new visitor's first answer through the door whose page drew a class (P84's member), cold and warm, through the real Worker: Server-Timing names \`total\` exactly once, no entry name twice, \`total\` carries no \`desc\`, and the header's entries are exactly sources.timings' (the five stages, \`session\`, the remainder, \`arm\`, \`total\`)`, async () => {
      const s = await stamp(host);
      for (const label of ['the cold door', 'the warm door']) {
        const a = await door(s, 'personalized');
        expectDoor(host, label, a, 'personalized');
        expectOneTotal(host, `${label}, a class drawn`, a);
      }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P96.OT2 — P76's names hold (LOCK)
// ===========================================================================

describe('unit:P96.OT2 (E21, R-P526; LOCK of P76.FA1 on the real Worker)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — P76's names hold on the real Worker, with and without a drawn class: the door's own entries (those without a \`desc\`, as the walkers read them) are the five stages, \`session\`, a remainder, \`arm\` exactly when the page drew a class, and \`total\`; sources.timings carries the same names and values; \`total\` is the door's whole time (at most the caller's measure, the other entries adding up to it within ${SLACK} ms); kit 02's Server-Timing sentence names every one`, async () => {
      const s = await stamp(host);
      for (const cls of [undefined, 'personalized'] as const) {
        const label = cls ? 'a class drawn' : 'no class drawn';
        const a = await door(s, cls);
        expectDoor(host, label, a, cls);
        const own = entriesOf(a.header).filter(e => e.desc === null), names = own.map(e => e.name);
        const entries = Object.fromEntries(own.map(e => [e.name, e.dur ?? NaN])) as Record<string, number>, body = timingsOf(a);
        const sum = own.filter(e => e.name !== 'total').reduce((n, e) => n + (e.dur ?? NaN), 0);
        const described = timingSentence();
        expect.soft({
          stages: STAGES.filter(stage => !names.includes(stage)), session: names.includes('session'), total: names.includes('total'), arm: names.includes('arm'),
          remainder: names.filter(name => !STAGES.includes(name) && !DOOR.includes(name)).length >= 1,
          body: sorted(Object.keys(body)), values: names.filter(name => !(Math.abs((body[name] ?? NaN) - entries[name]!) <= 1)),
          whole: entries.total !== undefined && entries.total <= a.measured + 2 && Math.abs(sum - entries.total) < SLACK ? 'the door\'s whole time'
            : `total ${entries.total} against the others' ${sum} and ${Math.round(a.measured)} measured`,
          kit: names.filter(name => !described.includes(`\`${name}\``)),
        }, `${host}: P96.OT2 — ${label}: P76's door entries (${a.header}; ${JSON.stringify(body)})`).toEqual({
          stages: [], session: true, total: true, arm: cls !== undefined, remainder: true, body: sorted(names), values: [], whole: 'the door\'s whole time', kit: [] });
      }
    }, 120_000);
  }
});

// ===========================================================================
// unit:P96.OT3 — every other answer keeps the platform's own `total` (LOCK)
// ===========================================================================

describe('unit:P96.OT3 (E21, R-P526; LOCK)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — the visitor's next page view, holding the session the door issued (P76's held-session leg, on the real Worker): Server-Timing carries the five stages and the platform's own \`total;dur=…;desc="Total Response Time"\` once, sources.timings the five stages alone, and no \`session\` member`, async () => {
      const s = await stamp(host);
      const first = await door(s);
      expectDoor(host, 'the door', first);
      const capability = (first.body.session as { capability: string }).capability;
      const a = await s.call('POST', `/v1/${TENANT}/decisions/snapshot`, { ...shopperHeaders(TENANT), [SHOPPER_HEADER]: capability },
        JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p96-held') }));
      expect(a.status, `${host}: PRECONDITION — the page view holding a session is answered (${show(a)})`).toBe(200);
      const list = entriesOf(a.header);
      expect.soft({ session: a.body.session ?? 'no session member', platform: platformTotals(a),
        stages: sorted(list.filter(e => e.name !== 'total').map(e => e.name)), body: sorted(Object.keys(timingsOf(a))) },
      `${host}: P96.OT3 — a page view holding a session keeps the platform's total beside the five stages (${a.header})`).toEqual({
        session: 'no session member', platform: ['the platform\'s total'], stages: sorted(STAGES), body: sorted(STAGES) });
    }, 120_000);

    it(`host (${host}): LOCK — every other answer keeps the platform's own \`total;dur=…;desc="Total Response Time"\` exactly once: the door's own refusal of a malformed \`arm\` member (400), a tenant the stamp does not provision at the door's address (403), an operator read (GET /content/learn) and the liveness probe (GET /health/live)`, async () => {
      const s = await stamp(host);
      const answers: Record<string, Reply> = {
        malformedArm: await s.call('POST', `/v1/${TENANT}/decisions/snapshot`, shopperHeaders(TENANT),
          JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p96-arm'), arm: JSON.stringify({ class: 'neither', tableVersion: 'p96-table' }) })),
        unprovisionedTenant: await s.call('POST', `/v1/${UNPROVISIONED}/decisions/snapshot`, shopperHeaders(UNPROVISIONED),
          JSON.stringify({ page: 'pdp', pageInstance: pageInstanceOf('p96-tenant') })),
        operatorRead: await s.call('GET', '/content/learn', { 'X-Tenant': TENANT, Authorization: `Bearer ${s.m.operatorToken}` }),
        liveness: await s.call('GET', '/health/live', {}),
      };
      expect(Object.fromEntries(Object.entries(answers).map(([name, r]) => [name, [r.status, r.body.error ?? null]])),
        `${host}: PRECONDITION — each request is answered where it is meant to be`).toEqual({
        malformedArm: [400, 'Invalid arm member'], unprovisionedTenant: [403, 'Tenant unavailable'], operatorRead: [200, null], liveness: [200, null] });
      expect.soft(Object.fromEntries(Object.entries(answers).map(([name, r]) => [name, platformTotals(r)])),
        `${host}: P96.OT3 — the platform's total on every other answer (${Object.entries(answers).map(([name, r]) => `${name}: ${r.header}`).join('; ')})`).toEqual({
        malformedArm: ['the platform\'s total'], unprovisionedTenant: ['the platform\'s total'], operatorRead: ['the platform\'s total'], liveness: ['the platform\'s total'] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P96.OT4 — the kit says which `total` is which
// ===========================================================================

describe('unit:P96.OT4 (E21, R-P526)', () => {
  it('logic: kit 02\'s first-request paragraph says `total` there is the first request\'s (the door\'s) whole time, which the other entries add up to but for the reading of its body, and that every other answer\'s `total`, the one with `desc="Total Response Time"`, is the platform\'s whole time', () => {
    const paragraph = firstRequestParagraph();
    expect(paragraph, 'PRECONDITION: kit 02 carries the first-request paragraph').not.toBe('');
    const sentences = sentencesOf(paragraph), platform = sentences.filter(sentence => sentence.includes('Total Response Time')).join(' ');
    expect.soft({
      door: sentences.some(sentence => sentence.includes('`total`') && /\bwhole time\b/.test(sentence) && /\bfirst request|\bdoor\b/i.test(sentence))
        && /\badds? up\b/.test(paragraph) && /\breading of its body\b|\breads? its body\b/i.test(paragraph),
      platformEntry: platform.includes('`total`') && /\bdesc\b/.test(platform),
      otherAnswers: /\bother answers?\b|\bevery answer (?:but|except|that is not)\b|\bany answer that is not\b/i.test(platform),
      platformWhole: /\bplatform/i.test(platform) && /\bwhole\b|\bentire\b/i.test(platform),
    }, `P96.OT4 — kit 02 says which \`total\` to read (today the paragraph names only the door's; the platform's sentence: "${platform.slice(0, 200)}")`).toEqual({
      door: true, platformEntry: true, otherAnswers: true, platformWhole: true });
  });
});
