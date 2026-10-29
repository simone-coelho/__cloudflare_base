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
// MEASURED (_evidence/parity-step3/S34/specifier/logs/, serial, --no-cache, one worker, the tree its working directory and
// root; the sketch sketches/p76.py, trees under scratch/): today in the worktree (46f1a348) 6 RED for the missing behaviour
// (the door names the five stages alone: no `session`, remainder, `arm` or `total`; the kits silent and kit 02 claiming
// both reads bounded) and the two LOCK legs GREEN (a-today.log). The sketch — src/routes/decisions.ts firstDecisionRequest
// (the door's start, the mint timed as `arm`, the issue, activation and verify as `session`, the forward's round trip less
// the forwarded stages as `forward`, `total`; the header copy replaced by the stages and the door's entries; the same
// entries in sources.timings), kit 01's deadline paragraph and `hydrateTimeoutMs` row, kit 02's first-request paragraph and
// :408–409 — 8/8 three times (b-fix-1..3). The wrong fixes, each RED on its own legs: mintonly (`session` timing the verify
// alone) and noremainder and nobody the four FA1 door legs; renamed and armalways the two no-class legs; kitleft the two FA2
// legs; budgetleft kit 02's leg. The whole suite (compare.txt): 4097 tests on each tree; failing under the sketch alone
// none; failing today alone P76's six; 50 failing on both are the scratch layout (the .mjs suites, root.worker, the console
// legs reading a base commit through git, W39/W40's deploy and bundle legs). Every named lock green on both trees.
//
// R-P448 (the specification review at 38aaa12d, fix round 2), test-only: F1 the forwarded decision's publication reads held
// STAGE ms each while the forward is under way, so its stages carry several hundred ms, and the remainder bounded above
// (< FORWARD + SLACK) and against the forward's own round trip less the stages (within SPAN); F2 the body sent as a stream
// that answers BODY ms late (a part of the door no entry names) and `total` bound to the caller's measure within
// TOTAL_SLACK, the add-up slack kept at SLACK; F3 a drawn class with nothing held names `arm` (≥ 0) in the header and the
// body; F4 every name of the door's Server-Timing in backticks in kit 02's first-request paragraph; F5 no sentence of kit 02
// says either or both reads are aborted, and a clause saying neither holds the answer past it names the ring read and the
// witness call. MEASURED (logs/r2-*): today 6 RED, the locks green; the sketch 8/8 three times; the reviewer's controls
// (S34/reviewer-spec/bin/controls.py over sketches/p76.py) doublecount, totalsum, armslow, kitnoforward 2 RED each and
// budgetsoft 1, each on its own leg alone; the seven wrong fixes RED as before (kitleft now 4: the no-class legs read kit 02);
// the build's head 141e2093 8/8 on a scratch copy.
//
// R-P452 (the review at b9fdbead, round 3, the last textual round), test-only: G1 the door's built names (FA1) and FA2's list
// are looked for in the sentence of kit 02's first-request paragraph that names `Server-Timing` (the paragraph's other
// sentences say `session` for the issued-session body member); G2 no sentence may say that either, both, each, every, all or
// the two reads are aborted. MEASURED (logs/r3-*): today 6 RED, the locks green; the sketch 8/8 twice; the reviewer's
// kitnosession and kitotherpara 3 RED each (the no-class legs and kit 02's leg), budgeteach and budgetsoft 1 each (kit 02's
// leg), kitnoforward 2; the build's head 141e2093 8/8 on a scratch copy.
//
// NO NEW EXPORT IS IMPORTED. HARNESS: src/units/_parity.ts (the mounted application, both hosts). Imports from src/units/:
// ../_parity.

import { describe, expect, it } from 'vitest';

import { SHOPPER_HEADER } from '@/identity/sessionCapability';

import { BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, pageInstanceOf, readTree, shopperOn, TENANT, UnitR2,
  type Mounted } from '../_parity';
import { watchCopies } from '../P97/_copy';

const DOCS = { pieces: [...MODULES], slots: declaredSlots([layoutSlot()]), learn: learnDocument() };
/** The forwarded decision's five stages (src/content/service.ts laps; W38 B5's names). */
const STAGES = ['documents', 'shopper', 'trend', 'lift', 'decide'];
const DOOR = ['session', 'arm', 'total'];
/**
 * The holds (milliseconds) and the slacks the bounds allow (a loaded machine): the activation, the forward's own hold,
 * each publication read inside the forwarded decision (so its stages reach several hundred ms, R-P448 F1), the mint's
 * reads, the request body's arrival (a part of the door no entry names, R-P448 F2); SLACK bounds each entry and the
 * add-up, TOTAL_SLACK `total` against the caller's own measure, SPAN the remainder against the forward's round trip.
 */
const ACTIVATE = 300, FORWARD = 400, STAGE = 120, MINT = 150, BODY = 120, SLACK = 200, TOTAL_SLACK = 60, SPAN = 100;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Held { seen: string[]; forward: { start: number; end: number } | null }
/**
 * The analyst's probe wrapper, R10 (R-P548): the first answer's activation and forward run on the blank in-memory copy of
 * the brand-new visitor's record (P97, R-P547), so they are held there (../P97/_copy): the copy's `/identity/activate`
 * held ACTIVATE ms and the door's forward (`/authority/request`) to it held FORWARD ms, its own start and end recorded;
 * with `stages`, every publication read made while the forward is under way (the forwarded decision's documents) held
 * STAGE ms; with `mint`, every publication read before the activation starts (the mint's) held MINT ms. The watch ends
 * when the held forward has answered.
 */
function hold(m: Mounted, options: { mint?: boolean; stages?: boolean } = {}): Held {
  const held: Held = { seen: [], forward: null };
  let phase: 'mint' | 'session' | 'forward' | 'after' = 'mint';
  const watch = watchCopies(m, async ({ path }, proceed) => {
    if (path === '/identity/activate') { phase = 'session'; held.seen.push(path); await sleep(ACTIVATE); return proceed(); }
    if (path !== '/authority/request' || held.forward) return proceed();
    held.seen.push(path); phase = 'forward';
    const start = performance.now();
    try { await sleep(FORWARD); return await proceed(); } finally { held.forward = { start, end: performance.now() }; phase = 'after'; watch.stop(); }
  });
  if (options.mint || options.stages) Object.defineProperty(m.storage, 'get', { configurable: true, writable: true, value: async (key: string) => {
    if (options.mint && phase === 'mint') { held.seen.push(`mint ${key}`); await sleep(MINT); }
    else if (options.stages && phase === 'forward' && key.startsWith('config-publication/')) { held.seen.push(`stage ${key}`); await sleep(STAGE); }
    return UnitR2.prototype.get.call(m.storage, key);
  } });
  return held;
}

interface DoorAnswer { status: number; header: string | null; body: Record<string, unknown>; measured: number }
/**
 * A new visitor's first request (P13 H4's door): no session, the page's class drawn when `cls` is given (P84's member);
 * with `slowBody`, the body arrives as a stream that answers its first read BODY ms late (the door's body read).
 */
async function door(m: Mounted, cls?: 'default' | 'personalized', slowBody = false): Promise<DoorAnswer> {
  const text = JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p76-door'), ...(cls ? { arm: JSON.stringify({ class: cls, tableVersion: 'p76-table' }) } : {}) });
  const body = slowBody ? new ReadableStream<Uint8Array>({ async pull(controller) { await sleep(BODY); controller.enqueue(new TextEncoder().encode(text)); controller.close(); } },
    { highWaterMark: 0 }) : text;
  const started = performance.now();
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' }, body, ...(slowBody ? { duplex: 'half' } : {}) } as RequestInit));
  const measured = performance.now() - started;
  const answer = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, header: response.headers.get('Server-Timing'), body: answer, measured };
}
/**
 * R-P452 G1: the sentence(s) of kit 02's first-request paragraph that name `Server-Timing` — where the door's entries are
 * described (the paragraph's other sentences say `session` for the issued-session body member).
 */
function timingSentence(): string {
  const first = readTree('docs/kit/02-api-reference.md').split(/\n\s*\n/).map(p => p.split('\n').join(' ')).find(p => p.startsWith('**A new visitor\'s first request.**')) ?? '';
  return first.split(/(?<=[.!?])\s+(?=[A-Z*`])/).filter(sentence => sentence.includes('Server-Timing')).join(' ');
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
    it(`host (${host}): a new visitor's first request — the body arriving ${BODY} ms late, the activation held ${ACTIVATE} ms, the forward ${FORWARD} ms and each publication read of the forwarded decision ${STAGE} ms — answers Server-Timing with the five stages, \`session\` (in [${ACTIVATE}, ${ACTIVATE + SLACK}) ms), a remainder covering the forward and not its stages (in [${FORWARD}, ${FORWARD + SLACK}) ms, and the forward's round trip less the stages within ${SPAN} ms) and \`total\`, no \`arm\` (no class drawn); the entries add up to \`total\` within ${SLACK} ms and \`total\` is the door's time, its body read included, within ${TOTAL_SLACK} ms; the body's sources.timings carries the same entries; kit 02's first-request paragraph names every entry`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P76.FA1 — the tenant documents publish');
      const held = hold(m, { stages: true });
      const a = await door(m, undefined, true);
      expect([a.status, typeof (a.body.session as { capability?: unknown } | undefined)?.capability, held.seen.filter(s => !s.startsWith('stage '))],
        `${host}: PRECONDITION — the door issues the session, activates it and forwards the decision (${show(a)})`).toEqual([200, 'string', ['/identity/activate', '/authority/request']]);
      const entries = entriesOf(a.header), names = Object.keys(entries);
      const stages = STAGES.reduce((sum, stage) => sum + (entries[stage] ?? 0), 0);
      expect(stages, `${host}: PRECONDITION — the forwarded decision's publication reads were held, so its stages carry them (${a.header})`).toBeGreaterThanOrEqual(STAGE);
      expect.soft({ stages: STAGES.filter(stage => !names.includes(stage)), session: names.includes('session'), total: names.includes('total'), arm: names.includes('arm'),
        remainder: remainderOf(entries).length > 0 },
      `${host}: P76.FA1 — the five stages kept, the door's session, remainder and total named, no arm (today: ${a.header})`).toEqual({
        stages: [], session: true, total: true, arm: false, remainder: true });
      const remainder = remainderOf(entries).reduce((sum, [, ms]) => sum + ms, 0);
      const span = held.forward ? held.forward.end - held.forward.start : NaN;
      const sum = Object.entries(entries).filter(([name]) => name !== 'total').reduce((s, [, ms]) => s + ms, 0);
      expect.soft({ session: entries.session! >= ACTIVATE && entries.session! < ACTIVATE + SLACK ? 'the issue, activation and verify' : `session ${entries.session}`,
        remainder: remainder >= FORWARD && remainder < FORWARD + SLACK ? 'the forward less its stages' : `remainder ${remainder} (stages ${stages})`,
        span: Math.abs(remainder - (span - stages)) < SPAN ? 'the round trip less the stages' : `remainder ${remainder} against ${Math.round(span)} - ${stages}`,
        sum: Math.abs(sum - entries.total!) < SLACK ? 'adds up to total' : `sum ${sum} against total ${entries.total}`,
        total: entries.total! <= a.measured + 2 && entries.total! > a.measured - TOTAL_SLACK ? 'the door\'s time' : `total ${entries.total} against ${Math.round(a.measured)} measured` },
      `${host}: P76.FA1 — the entries' durations (${a.header})`).toEqual({ session: 'the issue, activation and verify', remainder: 'the forward less its stages',
        span: 'the round trip less the stages', sum: 'adds up to total', total: 'the door\'s time' });
      const body = timingsOf(a);
      expect.soft({ names: sorted(Object.keys(body)), values: Object.entries(entries).filter(([name, ms]) => Math.abs((body[name] ?? NaN) - ms) > 1).map(([name]) => name) },
        `${host}: P76.FA1 — the body's sources.timings carries the same entries and values (${JSON.stringify(body)})`).toEqual({ names: sorted(names), values: [] });
      // R-P448 F4, R-P452 G1: kit 02's sentence that names Server-Timing names every entry the door answers, the remainder's
      // name and the five stages included.
      const described = timingSentence();
      expect.soft(names.filter(name => !described.includes(`\`${name}\``)), `${host}: P76.FA2 — kit 02's Server-Timing sentence names every entry of the door's Server-Timing (${described.slice(0, 120)})`).toEqual([]);
    }, 120_000);

    it(`host (${host}): a first request whose page drew a class (P84's member) names \`arm\` in the header and in sources.timings, with no hold (at least 0 ms) and with the mint's publication reads held ${MINT} ms each (at least ${MINT} ms), beside \`session\`, the remainder and \`total\`; the entries still add up`, async () => {
      // R-P448 F3: a class drawn with nothing held still names arm.
      const quick = await mount(host, DOCS);
      expectPublished(quick, 'P76.FA1 — the tenant documents publish');
      const q = await door(quick, 'personalized');
      expect([q.status, (q.body.armRequest as { class?: unknown } | undefined)?.class ?? null],
        `${host}: PRECONDITION — the door mints the class drawn (${show(q)})`).toEqual([200, 'personalized']);
      const quickEntries = entriesOf(q.header), quickBody = timingsOf(q);
      expect.soft([quickEntries.arm !== undefined && quickEntries.arm >= 0 ? 'arm' : `arm ${quickEntries.arm}`, quickBody.arm !== undefined && quickBody.arm >= 0 ? 'arm' : `body arm ${quickBody.arm}`],
        `${host}: P76.FA1 — a drawn class names arm with nothing held, in the header and the body (today: ${q.header})`).toEqual(['arm', 'arm']);
      const m = await mount(host, DOCS);
      expectPublished(m, 'P76.FA1 — the tenant documents publish');
      const held = hold(m, { mint: true });
      const a = await door(m, 'personalized');
      expect([a.status, (a.body.armRequest as { class?: unknown } | undefined)?.class ?? null, held.seen.some(s => s.startsWith('mint '))],
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
      door: ['Server-Timing', '`session`', '`arm`', '`total`'].filter(word => !timingSentence().includes(word)),
      body: /`sources\.timings`|`timings`/.test(first),
      forwarded: /forwarded decision/i.test(first),
      // R-P448 F5: no sentence says either or both reads are aborted, and a clause saying neither holds the answer past
      // its budget names its subjects, the ring read and the witness call.
      // R-P452 G2: nor that each, every, all or the two reads are.
      bounded: /\b(?:either|both|each|every|all|the two) reads? (?:is |are )?aborted/i.test(flat)
        || flat.split(/[.;]/).some(clause => /\bneither\b[^.;]*\bholds? the answer past/i.test(clause) && !(/\bring\b/.test(clause) && /\bwitness\b/.test(clause))),
      unbounded: all.some(p => /key-value|\bKV\b/.test(p) && /snapshot read/.test(p) && /under no budget|not under (?:any|a) budget|outside (?:every|any) budget|no budget bounds/i.test(p)),
    }, 'P76.FA2 — kit 02 names the door\'s entries and corrects :409–410 (today it names neither and claims both reads bounded)').toEqual({
      door: [], body: true, forwarded: true, bounded: false, unbounded: true });
  });
});
