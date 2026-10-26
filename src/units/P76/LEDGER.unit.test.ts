// src/units/P76/LEDGER.unit.test.ts
// P76 under the Closure Ledger (programme `tapestry-parity-activation`, amendment 11, item E12; batch S34): the tests for
// the LOCAL criteria FA1 and FA2 of the P76 work order (docs/parity/activation/program.json). LV1 is a deferred live row,
// the owner's, and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md:100–103, E12):
//   "#### E12 · First-answer time on the hosted stamps (P76 candidate)
//    - **Authority:** already on the lead's list; the performance sheet
//      (`docs/tapestry-packs/1-front-end/07-performance-and-defaults.md`) states only design targets until this is fixed.
//    - **Done when:** as the lead defines it. **Needed by:** the performance budget session with their front end, week 1 to
//      2 after the kickoff, to state honestly; the first activation to meet."
// THE DEFINITION, RULED (R-P438, _evidence/parity-step3/AMENDMENTS.md, from the analyst's S34/analyst/P76-DEFINITION.md at
// 46f1a348): the answers that miss the 1.5 s deadline are a new visitor's first answers through the first-request door
// (src/routes/decisions.ts firstDecisionRequest, :1102–1148); the door's Server-Timing names only the forwarded decision's
// five stages (32–409 ms of answers that took 335–2727 ms). FA1: the door's `Server-Timing` names its own parts beside the
// forwarded snapshot's five stages — `session` (issue, activation, verify), the forward's remainder (so the entries add
// up), `arm` when the page drew a class, and a `total` — and the SAME entries in the door answer's `sources.timings`; kit 02
// names every entry and says the stages are the forwarded decision's. FA2: kit 01's deadline paragraph and the
// `hydrateTimeoutMs` row state the measured first-answer times by release, that the stamps are not yet measured, what
// paints at the deadline, that a returning browser's session route runs inside the same deadline, and the cross-origin
// preflight; kit 02 :409–410 corrected (the lift's key-value snapshot read is under no budget). No FA3.
//
// THE READINGS (the brief's, each shown below):
//   1 FA1, the header: beside the five stage entries (names unchanged, W38 B5) the door's own `session` (the issue, the
//     activation on the new shopper's object and the verify, `:1123–1124`), the forward's remainder (its round trip less
//     the stages; its name is the builder's — this file pins only that at least one entry beyond the five stages and
//     `session`, `arm`, `total` exists and carries it), `arm` exactly when the page drew a class (P84's mint, `:1122`), and
//     `total` (the door's whole time). Durations in milliseconds; the entries other than `total` add up to `total` within
//     SLACK, and `total` is the door's time as the caller measured it, within SLACK.
//   2 FA1, the body: the same entries, the same values, in the door answer's `sources.timings`.
//   3 FA1, the harness: the parity mount on both hosts, the shopper object's `/identity/activate` held ACTIVATE ms and the
//     forward (`/authority/request`) held FORWARD ms (the analyst's probe wrapper, S34/analyst/scratch/tree/src/units/
//     PROBE76/probe.unit.test.ts); `session` in [ACTIVATE, ACTIVATE + SLACK), the remainder at least FORWARD; with a class
//     drawn, every publication read of the mint (before the activation) held MINT ms and `arm` at least MINT; a page view
//     that already holds a session carries the five stages alone, as today (a LOCK).
//   4 FA1, kit 02: the first request's paragraph names `Server-Timing`, `sources.timings`, `session`, `arm`, `total` and
//     says the stages are the forwarded decision's; :409–410's "Either read is aborted when its budget runs out, so
//     neither holds the answer past it" replaced by the fact that the lift's key-value snapshot read is under no budget.
//   5 FA2, kit 01: the deadline paragraph ("On snapshot failure, or at the 1.5-second deadline", :154) states the measured
//     first answers by release (c6d33c73, 92a7132e: a new visitor's 0.3–2.7 s, 10 of 24 past 1.5 s; a page view holding a
//     session about 0.45 s; the session route alone about 1.3 s typical, up to 3.1 s), the stamps not yet measured, the
//     defaults at the deadline and the late answer then painting, the returning browser's session route inside the same
//     deadline, the preflight (up to 1.4 s measured) a server-bridge page avoids; the `hydrateTimeoutMs` row (:705) states
//     the measured first answers and the stamps unmeasured and keeps P79's words (`productId`, the variant).
//   6 Locks (run on both trees, not asserted here): P13 H4, P84 (the mint), P30 (`X-Context-Key`), W38 B5 (the stage
//     names), P34 T5 (section 3's code block), P79 PI4 (the row's words), P81 and P13's kit-01 reads, P72, P62, P61, P70,
//     P60, P29/P30/P42's timing proxies.
//
// R10 SWEEP (src/**/*.test.ts): no test reads `Server-Timing`; `sources.timings` is read only by W38 B5 through
// `serveContentDecisions` (never the door); no test reads kit 01's deadline paragraph sentences or kit 02 :409–410; P34 T5
// reads section 3's code block only (the deadline paragraph's prose is outside it); P79 PI4 reads the row's product and
// variant words (kept); P81 reads kit 01 :150, :422, :435 (untouched); P13 H5 reads the first-request statements (kept).
// None needed.
//
// DEFERRED: LV1 (the owner's measurement on the stamps and the pair after FA1's release). RESIDUALS (told): the ticket's
// stale line references (decisions.ts :966–997 now :1102–1148; kit 01 :659 now :705); R-P235 (1)'s session-host list
// mixing a door answer (2162 ms) with two answers of page views holding a session (1920, 4821 ms), corrected by the kit's
// numbers; the preflight lives in src/index.ts (outside the grant).
//
// NO NEW EXPORT IS IMPORTED. HARNESS: src/units/_parity.ts (the mounted application, both hosts). Imports from src/units/:
// ../_parity.

import { describe, expect, it } from 'vitest';

import { SHOPPER_HEADER } from '@/identity/sessionCapability';

import { BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, pageInstanceOf, readTree, shopperOn, TENANT, UnitR2,
  type Mounted } from '../_parity';

const DOCS = { pieces: [...MODULES], slots: declaredSlots([layoutSlot()]), learn: learnDocument() };
/** The forwarded decision's five stages (src/content/service.ts laps; W38 B5's names). */
const STAGES = ['documents', 'shopper', 'trend', 'lift', 'decide'];
const DOOR = ['session', 'arm', 'total'];
/** The holds (milliseconds) and the slack the bounds allow (a loaded machine). */
const ACTIVATE = 300, FORWARD = 400, MINT = 150, SLACK = 200;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The analyst's probe wrapper: the shopper object's `/identity/activate` held ACTIVATE ms and the door's forward
 * (`/authority/request`) held FORWARD ms; with `mint`, every publication read before the activation starts (the mint's)
 * held MINT ms. Returns the calls seen, in order.
 */
function hold(m: Mounted, mint = false): string[] {
  const env = m.env as unknown as Record<string, unknown>, seen: string[] = [];
  const ns = env.SHOPPER_REFLEX as { idFromName: (name: string) => unknown; get: (id: unknown) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } };
  let minting = true;
  env.SHOPPER_REFLEX = { idFromName: (name: string) => ns.idFromName(name), get: (id: unknown) => {
    const stub = ns.get(id);
    return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (path === '/identity/activate') { minting = false; seen.push(path); await sleep(ACTIVATE); }
      else if (path === '/authority/request') { seen.push(path); await sleep(FORWARD); }
      return stub.fetch(input, init);
    } };
  } };
  if (mint) Object.defineProperty(m.storage, 'get', { configurable: true, writable: true, value: async (key: string) => {
    if (minting) { seen.push(`mint ${key}`); await sleep(MINT); }
    return UnitR2.prototype.get.call(m.storage, key);
  } });
  return seen;
}

interface DoorAnswer { status: number; header: string | null; body: Record<string, unknown>; measured: number }
/** A new visitor's first request (P13 H4's door): no session, the page's class drawn when `cls` is given (P84's member). */
async function door(m: Mounted, cls?: 'default' | 'personalized'): Promise<DoorAnswer> {
  const started = performance.now();
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p76-door'), ...(cls ? { arm: JSON.stringify({ class: cls, tableVersion: 'p76-table' }) } : {}) }) }));
  const measured = performance.now() - started;
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, header: response.headers.get('Server-Timing'), body, measured };
}
/** `Server-Timing` as name → duration (ms). */
const entriesOf = (header: string | null): Record<string, number> => Object.fromEntries((header ?? '').split(',').map(s => s.trim()).filter(Boolean)
  .map(s => [s.split(';')[0]!.trim(), Number(/dur=([0-9.]+)/.exec(s)?.[1] ?? NaN)]));
const timingsOf = (a: DoorAnswer) => ((a.body.sources as { timings?: Record<string, number> } | undefined)?.timings ?? {});
const sorted = (names: string[]) => [...names].sort();
/** The remainder: every entry that is neither a stage nor one of the door's named three. */
const remainderOf = (entries: Record<string, number>) => Object.entries(entries).filter(([name]) => !STAGES.includes(name) && !DOOR.includes(name));
const show = (a: DoorAnswer) => `${a.status} ${a.header ?? 'no Server-Timing'} ${JSON.stringify(timingsOf(a))}`;

// ===========================================================================
// unit:P76.FA1 — the first-request door names its own time
// ===========================================================================

describe('unit:P76.FA1 (R-P438)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a new visitor's first request, the activation held ${ACTIVATE} ms and the forward ${FORWARD} ms, answers Server-Timing with the five stages, \`session\` (in [${ACTIVATE}, ${ACTIVATE + SLACK}) ms), a remainder covering the forward (at least ${FORWARD} ms) and \`total\`, no \`arm\` (no class drawn); the entries add up to \`total\` and \`total\` to the door's time, each within ${SLACK} ms; the body's sources.timings carries the same entries`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P76.FA1 — the tenant documents publish');
      const seen = hold(m);
      const a = await door(m);
      expect([a.status, typeof (a.body.session as { capability?: unknown } | undefined)?.capability, seen],
        `${host}: PRECONDITION — the door issues the session, activates it and forwards the decision (${show(a)})`).toEqual([200, 'string', ['/identity/activate', '/authority/request']]);
      const entries = entriesOf(a.header), names = Object.keys(entries);
      expect.soft({ stages: STAGES.filter(stage => !names.includes(stage)), session: names.includes('session'), total: names.includes('total'), arm: names.includes('arm'),
        remainder: remainderOf(entries).length > 0 },
      `${host}: P76.FA1 — the five stages kept, the door's session, remainder and total named, no arm (today: ${a.header})`).toEqual({
        stages: [], session: true, total: true, arm: false, remainder: true });
      const remainder = remainderOf(entries).reduce((sum, [, ms]) => sum + ms, 0);
      const sum = Object.entries(entries).filter(([name]) => name !== 'total').reduce((s, [, ms]) => s + ms, 0);
      expect.soft({ session: entries.session! >= ACTIVATE && entries.session! < ACTIVATE + SLACK ? 'the issue, activation and verify' : `session ${entries.session}`,
        remainder: remainder >= FORWARD ? 'covers the forward' : `remainder ${remainder}`,
        sum: Math.abs(sum - entries.total!) < SLACK ? 'adds up to total' : `sum ${sum} against total ${entries.total}`,
        total: entries.total! <= a.measured + 2 && entries.total! > a.measured - SLACK ? 'the door\'s time' : `total ${entries.total} against ${Math.round(a.measured)} measured` },
      `${host}: P76.FA1 — the entries' durations (${a.header})`).toEqual({ session: 'the issue, activation and verify', remainder: 'covers the forward', sum: 'adds up to total', total: 'the door\'s time' });
      const body = timingsOf(a);
      expect.soft({ names: sorted(Object.keys(body)), values: Object.entries(entries).filter(([name, ms]) => Math.abs((body[name] ?? NaN) - ms) > 1).map(([name]) => name) },
        `${host}: P76.FA1 — the body's sources.timings carries the same entries and values (${JSON.stringify(body)})`).toEqual({ names: sorted(names), values: [] });
    }, 120_000);

    it(`host (${host}): a first request whose page drew a class (P84's member), the mint's publication reads held ${MINT} ms each, names \`arm\` (at least ${MINT} ms) beside \`session\`, the remainder and \`total\`, in the header and in sources.timings; the entries still add up`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P76.FA1 — the tenant documents publish');
      const seen = hold(m, true);
      const a = await door(m, 'personalized');
      expect([a.status, (a.body.armRequest as { class?: unknown } | undefined)?.class ?? null, seen.some(s => s.startsWith('mint '))],
        `${host}: PRECONDITION — the door mints the class drawn, reading the publication before the activation (${show(a)})`).toEqual([200, 'personalized', true]);
      const entries = entriesOf(a.header), body = timingsOf(a);
      const sum = Object.entries(entries).filter(([name]) => name !== 'total').reduce((s, [, ms]) => s + ms, 0);
      expect.soft({ arm: entries.arm !== undefined && entries.arm >= MINT ? 'the mint' : `arm ${entries.arm}`,
        session: entries.session !== undefined && entries.session >= ACTIVATE && entries.session < ACTIVATE + SLACK ? 'the session alone' : `session ${entries.session}`,
        sum: entries.total !== undefined && Math.abs(sum - entries.total) < SLACK ? 'adds up to total' : `sum ${sum} against total ${entries.total}`,
        body: body.arm !== undefined && Math.abs(body.arm - (entries.arm ?? NaN)) <= 1 ? 'the same arm' : `body arm ${body.arm}` },
      `${host}: P76.FA1 — the mint named as arm (today: ${a.header})`).toEqual({ arm: 'the mint', session: 'the session alone', sum: 'adds up to total', body: 'the same arm' });
    }, 120_000);

    it(`host (${host}): LOCK — a page view that already holds a session (not through the door) answers the five stages alone, in the header and in sources.timings, as today`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P76.FA1 — the tenant documents publish');
      const s = await shopperOn(m);
      const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', [SHOPPER_HEADER]: s.grant.capability },
        body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p76-held') }) }));
      const body = await response.json().catch(() => ({})) as { session?: unknown; sources?: { timings?: Record<string, number> } };
      await m.drain();
      expect.soft([response.status, body.session ?? 'no session member', sorted(Object.keys(entriesOf(response.headers.get('Server-Timing')))), sorted(Object.keys(body.sources?.timings ?? {}))],
        `${host}: P76.FA1 — the stages alone`).toEqual([200, 'no session member', sorted(STAGES), sorted(STAGES)]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P76.FA2 — the kit states the first-answer times honestly
// ===========================================================================

describe('unit:P76.FA2 (R-P438)', () => {
  const paragraphs = (text: string) => text.split(/\n\s*\n/).map(p => p.split('\n').join(' '));
  const kit01 = () => readTree('docs/kit/01-integration-guide.md'), kit02 = () => readTree('docs/kit/02-api-reference.md');

  it('logic: kit 01\'s deadline paragraph states the first answers measured on the acceptance pair by release, the stamps not yet measured, the defaults at the deadline and the late answer painting, the returning browser\'s session route inside the same deadline and the cross-origin preflight a server-bridge page avoids; the hydrateTimeoutMs row states the measured first answers and the stamps unmeasured and keeps its product and variant words', () => {
    const deadline = paragraphs(kit01()).find(p => p.startsWith('On snapshot failure, or at the 1.5-second deadline')) ?? '';
    expect(deadline, 'PRECONDITION: kit 01 carries the deadline paragraph').not.toBe('');
    const row = kit01().split('\n').find(line => line.startsWith('| `hydrateTimeoutMs` |')) ?? '';
    expect.soft({
      times: ['0.3', '2.7', '10 of 24', '0.45', '1.3', '3.1'].filter(n => !deadline.includes(n)),
      release: /\bc6d33c73\b|\b92a7132e\b/.test(deadline),
      stamps: /\bstamps?\b/.test(deadline) && /not (?:yet )?(?:been )?measured|never (?:been )?measured/i.test(deadline),
      deadlinePaint: /defaults|`\[\]`/.test(deadline) && /(?:late|later) answer[^.]*paints|then paints/i.test(deadline),
      returning: /returning browser/i.test(deadline) && /session route|\/identity\/session/.test(deadline) && /same deadline|inside the deadline|within the (?:same )?deadline/i.test(deadline),
      preflight: /preflight/i.test(deadline) && deadline.includes('1.4') && /bridge/i.test(deadline),
      row: ['2.7', '0.45'].every(n => row.includes(n)) && /\bstamps?\b/.test(row) && /not (?:yet )?measured/i.test(row),
      rowWords: /\bproductId\b|\banother product\b/.test(row) && /\bvariant/i.test(row),
    }, 'P76.FA2 — kit 01 states the first answers honestly (today it states the deadline alone)').toEqual({
      times: [], release: true, stamps: true, deadlinePaint: true, returning: true, preflight: true, row: true, rowWords: true });
  });

  it('logic: kit 02\'s first-request paragraph names the door\'s Server-Timing and sources.timings entries (`session`, `arm`, `total`) and says the stages are the forwarded decision\'s; the budgets paragraph no longer says both reads are bounded and states the lift\'s key-value snapshot read under no budget', () => {
    const text = kit02(), all = paragraphs(text);
    const first = all.find(p => p.startsWith('**A new visitor\'s first request.**')) ?? '';
    expect(first, 'PRECONDITION: kit 02 carries the first-request paragraph').not.toBe('');
    const flat = text.replace(/\s+/g, ' ');
    expect.soft({
      door: ['Server-Timing', '`session`', '`arm`', '`total`'].filter(word => !first.includes(word)),
      body: /`sources\.timings`|`timings`/.test(first),
      forwarded: /forwarded decision/i.test(first),
      bounded: flat.includes('Either read is aborted when its budget runs out, so neither holds the answer past it'),
      unbounded: all.some(p => /key-value|\bKV\b/.test(p) && /snapshot read/.test(p) && /under no budget|not under (?:any|a) budget|outside (?:every|any) budget|no budget bounds/i.test(p)),
    }, 'P76.FA2 — kit 02 names the door\'s entries and corrects :409–410 (today it names neither and claims both reads bounded)').toEqual({
      door: [], body: true, forwarded: true, bounded: false, unbounded: true });
  });
});
