// src/units/P60/LEDGER.unit.test.ts
// P60 under the Closure Ledger: the tests for the LOCAL criteria SD1-SD3 of the P60 work
// order (the acknowledgement programme of amendment 5, ticket P60 "The SDK's deadline is one
// named constant, a cut acknowledgement is retried once with the same event id, and a
// recovered retry keeps the placement's engagement"). LV1 is a deferred live row and gets no
// test. D1 (RESOLVED, R-P99: the retry is safe only after P57, so P60 is sequenced last) is
// exercised inside SD2.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-5/BTI-Parity-Amendment-2026-10-19.md):
//   section 2: "P60 — the SDK's deadline and retry. The 5 s literal becomes one named,
//   exported constant used by every SDK request that shares it; after a cut acknowledgement
//   the SDK retries the same event id once (safe after P57); a retry that is answered
//   `recovered` or `pending` no longer suppresses engagement, viewable and dwell for that
//   placement; the SDK bundles stay within their byte budgets and `build-sdk.mjs --check` is
//   an exact match."
//   section 4 (addendum): "The SDK's acceptance of `pending` is locked by P60 with a
//   behaviour test, not only by the bundle bytes."
//
// One `describe('unit:P60.<criterion>')` per LOCAL criterion. Expected values come from the
// work order, the amendment, the analysis it cites (_evidence/baseline-52/ack-latency/
// ANALYSIS.md §4 "SDK half": the SDK reuses one envelope per placement, src/sdk/listen.ts
// `rendered`; a retry with the same id is idempotent after P57; "Today a cut also suppresses
// engagement, viewable and dwell for that placement"; "The 5 s deadline is a bare literal ...
// shared by session mint, snapshot, acknowledgement and" the fourth bounded read) and the
// SDK's own contracts, never from what the SDK does today:
//   · the deadline: amendment section 1, "The SDK cuts its own acknowledgement request at 5 s";
//     the named constant `ACK_DEADLINE_MS` (src/sdk/core.ts, exported since P56);
//   · the four requests that share it, by what they are (the work order's SD1 cites them at
//     core.ts:792, :805, :973, :1014 before P56): the session mint (`POST
//     /v1/{tenant}/identity/session`), the first decision request of a new browser (P13 H4,
//     the snapshot that issues the session), the render acknowledgement (`POST
//     /realtime/action`, `content_impression` with its offer), and every later decision
//     request (`getJson`, the snapshot);
//   · the render receipt the SDK accepts: `{ version: 1, decisionId, eventId, pageInstance,
//     status: 'durable', source: 'pending' | 'recovered' }` (src/sdk/types.ts
//     RenderAcknowledgment; P56 D1, R-P99: `pending` satisfies the rendered-v1 contract);
//   · the placement's listeners, as the SDK documents them (src/sdk/listen.ts `Listen`):
//     correlated content outcomes (engagement) "wait for the exact painted render ACK"; the
//     viewable impression is sent "once its render acknowledgement is held" after one second
//     in view (P40 D1, D2); the dwell is measured on the element given to `rendered` once
//     acknowledged, sent at or above the one-second minimum (listen.ts `dwellMinMs`);
//   · the budgets: packages/sdk/package.json `sizeBudget` (the owner's numbers, W40 D3), read
//     and enforced by scripts/build-sdk.mjs's own `verifySDK` and `verifyPackage`, the code
//     `node scripts/build-sdk.mjs --check` runs.
//
// THE READINGS THIS FILE RULES:
//   · "A cut acknowledgement": the SDK's own deadline passes before the acknowledgement is
//     answered (the request's abort signal fires at ACK_DEADLINE_MS). Simulated by a fetch
//     that answers nothing and rejects when the SDK aborts it; time is the test's (fake
//     timers on the host's setTimeout, the test host's clock ticked with them, as
//     src/units/P40/LEDGER.unit.test.ts does).
//   · "Retries the same event id once": exactly one more request for that placement, the
//     same envelope (byte for byte the same body: event id, time, offer, page instance), sent
//     by the SDK itself without the page calling `rendered` again; never a third, even when
//     the retry is cut too; and only after a cut: an acknowledgement answered within the
//     deadline (accepted, or refused 409 as P57's conflict) is not re-sent.
//   · "No longer suppresses engagement, viewable and dwell for that placement": after a retry
//     answered `pending` (and, separately, `recovered`), with no further call from the page
//     but the visibility port's reports and one engagement: the viewable impression after one
//     second in view, the dwell on leaving view after one and a half seconds, and the click,
//     each sent once for that placement and carrying its decision.
//   · "Within their byte budgets and `build-sdk.mjs --check` an exact match": the check exits
//     0 on this tree, and every exported bundle is at most its recorded budget, read from the
//     script's own report (verifyPackage); the script's teeth: a build whose output differs by
//     one byte is refused naming the bundle (W40.P3 and P34.T5 already hold the budget's and
//     the file's negative controls on copies of the tree).
//   · Both the source entry (createCore + createListen, as P40's sdk legs) and the shipped
//     ESM bundle (public/sdk/edge-personalization.esm.js, loaded as
//     src/units/W26/B1.unit.test.ts loads it) are driven for SD2.
//
// MEASURED AT THE SPECIFICATION (d1e7a33e): SD1 is GREEN-AT-SPEC. The P56 build (74f4bfbb,
// R-P100(2)) exported ACK_DEADLINE_MS and the one bounded read every one of the four requests
// goes through (core.ts `boundedJSON`) uses it; no other literal of 5000 is left in
// src/sdk/core.ts. Its tests are locks of that state. SD2 is RED on both entries (one request
// only, nothing armed after the cut); SD3 is GREEN (locks).
//
// R10 (measured with the whole suite under a sketch of P60 on a scratch copy — a cut
// acknowledgement re-sent once with the same body inside core.ts `sendRender`, the bundles
// and declarations regenerated by scripts/build-sdk.mjs:
// _evidence/parity-step3/S12/specifier/logs/sketch-p60-full.json): no existing expectation
// changes. Every failure there is the scratch's environment (no .git for the console and
// seed files, re-run with the worktree's git objects 48/48 in sketch-p60-gitfiles.log;
// W40.P4's deploy leg and the symlinked node_modules) or load (W01.08, 6/6 alone,
// w0108-sketch-p60.log). Regeneration, not R10: a build that changes src/sdk without running
// scripts/build-sdk.mjs turns src/units/P34/LEDGER.unit.test.ts:452 (P34.T5) and
// src/units/W40/LEDGER.unit.test.ts:414 and :478 (W40.P3) RED, as it turns SD3 RED
// (stale-bundles-p34-w40.log); the sketch's bundles grew 274 and 288 bytes, within budget.
//
// No new export is imported; every member read exists at this head. Imports from src/units/:
// none.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { build as esbuild, transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { ACK_DEADLINE_MS, createCore } from '@/sdk/core';
import { createListen } from '@/sdk/listen';
import { offeredSet, renderAck, testHost } from '@/sdk/testHost';
import type { DecisionSet, DomLike, ElementLike, Host, RequestInitLike, ResponseLike } from '@/sdk/types';

/** The checkout this file lives in, whatever the working directory (the 2026-09-20 W29-B1 lesson). */
const ROOT = new URL('../../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const readTree = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');
/** Amendment 5, section 1: "The SDK cuts its own acknowledgement request at 5 s". */
const SDK_CUT_MS = 5 * 1000;
const TENANT = 'coach';
/** The customer's product-page layout slot and two of its modules (synthetic ids in the module.PDP.<kind>.<n> shape, as the parity fixtures name them). */
const SLOT = 'pdp-modules';
const GRID = 'module.PDP.grid.1', RECO = 'module.PDP.reco.1';
/** offeredSet mints `${revision}-${slot}-${order}-${contentId}` (src/sdk/testHost.ts offeredSet). */
const receiptOf = (order: number, id: string) => `original-${SLOT}-${order}-${id}`;
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);

type AckAnswer = 'cut' | 'pending' | 'recovered' | 'conflict' | 'unknown-source';
interface Posted { type: string; eventId?: string; data: Record<string, unknown> }

interface ClientLike {
  ready: () => Promise<boolean>;
  apply: (set: DecisionSet) => void;
  rendered: (slot: string, contentId: string, el?: ElementLike) => Promise<unknown>;
  outcome: (type: 'content_click', contentId: string, slot: string) => Promise<unknown>;
}

/**
 * A product page with two marked containers, the repository's test host behind a fetch
 * that answers each render acknowledgement in turn as `answers` says ('cut': nothing, and a
 * rejection once the SDK aborts it), every other action `{ success: true }`, and the
 * visibility port of src/sdk/types.ts DomLike driven by `show`. Fake timers must be on.
 */
function sdkPage(answers: AckAnswer[]) {
  const dom = new JSDOM(`<main>
    <section id="m0" data-op-slot="${SLOT}" data-op-content="${GRID}"><a href="#m0">A grid of broad categories</a></section>
    <section id="m1" data-op-slot="${SLOT}" data-op-content="${RECO}"><a href="#m1">We think you would like this</a></section>
  </main>`, { url: 'https://www.shop.test/products/tabby-shoulder-bag-26' });
  const win = dom.window as unknown as { document: { getElementById(id: string): unknown; querySelectorAll(sel: string): ArrayLike<unknown> }; close(): void };
  const doc = win.document;
  const watchers = new Map<unknown, Set<(visible: boolean) => void>>();
  const port: DomLike = {
    querySelectorAll: (sel: string) => Array.from(doc.querySelectorAll(sel)) as unknown as ArrayLike<ElementLike> & Iterable<ElementLike>,
    observe: (el: ElementLike, cb: (visible: boolean) => void) => {
      const set = watchers.get(el) ?? new Set<(visible: boolean) => void>(); set.add(cb); watchers.set(el, set);
      return () => { set.delete(cb); };
    },
  };
  const el = (id: string) => doc.getElementById(id) as unknown as ElementLike;
  const showEl = (id: string, visible = true) => { for (const cb of [...(watchers.get(el(id)) ?? [])]) cb(visible); };
  const f = testHost();
  f.host.dom = port;
  const original = f.host.fetch;
  const posted: Posted[] = [], impressions: Array<{ body: string; answer: AckAnswer; signal?: AbortSignal }> = [];
  f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
    if (!url.endsWith('/action')) return original(url, init);
    const body = JSON.parse(init?.body ?? '{}') as Posted;
    posted.push(body);
    if (body.type !== 'content_impression') return { ok: true, status: 200, json: async () => ({ success: true }) };
    const answer = answers[impressions.length] ?? 'recovered';
    impressions.push({ body: init?.body ?? '', answer, ...(init?.signal ? { signal: init.signal } : {}) });
    if (answer === 'cut') return new Promise<ResponseLike>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('The SDK aborted the request')), { once: true });
    });
    if (answer === 'conflict') return { ok: false, status: 409, json: async () => ({ ok: false, error: 'Render acknowledgement conflict: this decision was already acknowledged with another event id' }) };
    const render = (renderAck(init) as { render: Record<string, unknown> }).render;
    return { ok: true, status: 200, json: async () => ({ success: true, render: { ...render, source: answer === 'unknown-source' ? 'queued' : answer } }) };
  };
  const set = offeredSet({ page: 'pdp', decisions: [GRID, RECO].map((id, order) => ({ contentId: id, customerContentId: `TAP-PDP-${order}`, slot: SLOT, order, slotPosition: order,
    type: 'module', strategy: 'default' as const, score: 0, explain: { drivers: [] } })) } as DecisionSet, 'p60-page');
  /** Time passing for the page: the test host's clock and the timers together. */
  const hold = async (ms: number) => { f.tick(ms); await vi.advanceTimersByTimeAsync(ms); };
  const settle = async () => { for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0); };
  const engagements = () => posted.filter(e => e.type !== 'content_impression').map(e => [e.type, e.data.contentId, e.data.decisionId]);
  return { f, el, show: showEl, set, posted, impressions, hold, settle, engagements, close: () => win.close() };
}

/** The repository's source entry, as P40's sdk legs compose it (createCore + createListen). */
function sourceClient(host: Host): ClientLike {
  const core = createCore({ tenant: TENANT, source: 'p60-pdp' }, host), listen = createListen(core);
  return { ready: () => core.ready(), apply: set => listen.apply(set), rendered: (slot, id, el) => listen.rendered(slot, id, el),
    outcome: (type, id, slot) => listen.outcome(type, id, slot) };
}

/** The shipped ESM bundle, run as src/units/W26/B1.unit.test.ts runs it, with this realm's (fake) timers. */
function bundleClient(host: Host): ClientLike {
  const code = readTree('public/sdk/edge-personalization.esm.js');
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;', {
    module, URL, URLSearchParams, AbortController, AbortSignal, TextEncoder, TextDecoder, btoa, atob, crypto, console, queueMicrotask, structuredClone,
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  const { createClient } = module.exports as unknown as { createClient: (config: unknown, host: unknown) => {
    core: { ready: () => Promise<boolean> }; listen: { apply: (set: unknown) => void; rendered: ClientLike['rendered']; outcome: ClientLike['outcome'] } } };
  const client = createClient({ tenant: TENANT, source: 'p60-pdp' }, host);
  return { ready: () => client.core.ready(), apply: set => client.listen.apply(set), rendered: (slot, id, el) => client.listen.rendered(slot, id, el),
    outcome: (type, id, slot) => client.listen.outcome(type, id, slot) };
}

/**
 * One placement painted (`rendered` with its element, called once), its acknowledgements
 * answered in turn as `answers` says; ACK_DEADLINE_MS passes (a first acknowledgement left
 * unanswered is cut), then one more deadline (room for a retry to be sent and answered, or
 * cut); then, with no further call from the page, one and a half seconds in view, out of
 * view, and one engagement (a click); then two more deadlines. Nothing is awaited that only
 * a later timer can settle. Returns what was sent and what `rendered` resolved to.
 */
async function paintAndEngage(entry: (host: Host) => ClientLike, answers: AckAnswer[]) {
  const p = sdkPage(answers);
  const client = entry(p.f.host);
  const ready = client.ready();
  await p.settle();
  expect(await ready, 'PRECONDITION: the client is ready').toBe(true);
  client.apply(p.set);
  let acknowledged: unknown = 'rendered never resolved';
  const rendered = client.rendered(SLOT, GRID, p.el('m0')).then(value => { acknowledged = value; });
  await p.settle();
  const first = p.impressions.length;
  await p.hold(ACK_DEADLINE_MS); await p.settle();
  await p.hold(ACK_DEADLINE_MS); await p.settle();
  p.show('m0'); await p.hold(1_500); p.show('m0', false); await p.settle();
  const clicked = client.outcome('content_click', GRID, SLOT);
  await p.settle();
  await p.hold(2 * ACK_DEADLINE_MS); await p.settle();
  await clicked; await rendered;
  p.close();
  return { p, first, acknowledged };
}

// ===========================================================================
// unit:P60.SD1 — the SDK's request deadline is one exported constant, used by the four requests that share it
// ===========================================================================

/** Every numeric literal (or product/sum of literals) worth 5000 in a source text, but the initializer of the exported ACK_DEADLINE_MS, by line. */
function deadlineLiteralsOutsideTheConstant(text: string): string[] {
  const source = ts.createSourceFile('core.ts', text, ts.ScriptTarget.ES2022, true);
  const valueOf = (node: ts.Node): number | undefined => {
    if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ''));
    if (ts.isParenthesizedExpression(node)) return valueOf(node.expression);
    if (ts.isBinaryExpression(node)) {
      const left = valueOf(node.left), right = valueOf(node.right);
      if (left === undefined || right === undefined) return undefined;
      if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
    }
    return undefined;
  };
  const isTheConstant = (node: ts.Node) => ts.isVariableDeclaration(node.parent) && node.parent.initializer === node
    && ts.isIdentifier(node.parent.name) && node.parent.name.text === 'ACK_DEADLINE_MS'
    && (ts.getCombinedModifierFlags(node.parent) & ts.ModifierFlags.Export) !== 0;
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (valueOf(node) === SDK_CUT_MS && (ts.isNumericLiteral(node) || ts.isBinaryExpression(node) || ts.isParenthesizedExpression(node))) {
      if (!isTheConstant(node)) found.push(`core.ts:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.getText().slice(0, 80)}`);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('unit:P60.SD1', () => {
  it('logic: the SDK\'s request deadline is the exported constant ACK_DEADLINE_MS, of 5 s, and src/sdk/core.ts holds no other literal of 5000 (each one found is named by its line)', () => {
    expect(ACK_DEADLINE_MS, 'P60.SD1 — src/sdk/core.ts exports the deadline as ACK_DEADLINE_MS, the 5 s the SDK cuts its requests at (amendment 5, section 1)').toBe(SDK_CUT_MS);
    expect(deadlineLiteralsOutsideTheConstant(readTree('src/sdk/core.ts')), 'P60.SD1 — no literal of 5000 is left in src/sdk/core.ts but the constant itself').toEqual([]);
  });

  it('CONTROL: the literal scan names a 5000 at a deadline site, in any spelling, and in an unexported copy of the constant, and leaves the exported constant and its uses alone', () => {
    for (const spelling of ['5000', '5_000', '5 * 1000', '(5000)']) {
      const source = `export const ACK_DEADLINE_MS = 5000;\nconst cut = (abort: () => void) => setTimeout(abort, ACK_DEADLINE_MS);\nconst mint = (abort: () => void) => setTimeout(abort, ${spelling});\n`;
      expect(deadlineLiteralsOutsideTheConstant(source), `CONTROL — ${spelling} at a deadline site is named by its line`).toEqual([`core.ts:3: ${spelling}`]);
    }
    expect(deadlineLiteralsOutsideTheConstant('const ACK_DEADLINE_MS = 5000;\nexport const other = ACK_DEADLINE_MS;\n'), 'CONTROL — an unexported constant of 5000 is not the exported one').toEqual(['core.ts:1: 5000']);
  });

  it('sdk: each of the four requests that share the deadline — the session mint, the first decision request of a new browser, the render acknowledgement and a later decision request — is cut at exactly ACK_DEADLINE_MS, not a millisecond before', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const measured: Array<[string, unknown]> = [];
      /** Starts `begin` on a fresh page whose requests matching `target` never answer; reads the first such request's abort signal one millisecond before and at the deadline. */
      const cutOf = async (name: string, target: (url: string, body: Record<string, unknown>) => boolean,
        prepare: (client: { core: ReturnType<typeof createCore>; listen: ReturnType<typeof createListen>; page: ReturnType<typeof sdkPage> }) => Promise<void>,
        begin: (client: { core: ReturnType<typeof createCore>; listen: ReturnType<typeof createListen>; page: ReturnType<typeof sdkPage> }) => void) => {
        const page = sdkPage(['recovered']);
        const hung: AbortSignal[] = [];
        let armed = false;
        const answer = page.f.host.fetch;
        page.f.host.fetch = async (url: string, init?: RequestInitLike) => {
          if (armed && target(url, JSON.parse(init?.body ?? '{}') as Record<string, unknown>)) {
            if (init?.signal) hung.push(init.signal);
            return new Promise<ResponseLike>((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('The SDK aborted the request')), { once: true }); });
          }
          return answer(url, init);
        };
        const core = createCore({ tenant: TENANT, source: 'p60-pdp' }, page.f.host), listen = createListen(core);
        const client = { core, listen, page };
        await prepare(client);
        armed = true;
        begin(client);
        for (let i = 0; i < 50 && !hung.length; i++) await vi.advanceTimersByTimeAsync(0);
        if (!hung.length) { measured.push([name, 'the request was never made']); page.close(); return; }
        await vi.advanceTimersByTimeAsync(ACK_DEADLINE_MS - 1);
        const before = hung[0]!.aborted;
        await vi.advanceTimersByTimeAsync(1);
        measured.push([name, { [`aborted at ${ACK_DEADLINE_MS - 1} ms`]: before, [`aborted at ${ACK_DEADLINE_MS} ms`]: hung[0]!.aborted }]);
        await page.settle();
        page.close();
      };
      const none = async () => undefined;
      const readyFirst = async (c: { core: ReturnType<typeof createCore>; page: ReturnType<typeof sdkPage> }) => {
        const ready = c.core.ready(); await c.page.settle();
        expect(await ready, 'PRECONDITION: the client is ready').toBe(true);
      };
      await cutOf('session mint', url => url.endsWith('/identity/session'), none, c => { void c.core.ready(); });
      await cutOf('first decision request of a new browser', url => url.endsWith('/decisions/snapshot'), none, c => { void c.listen.hydrate({ page: 'pdp' }); });
      await cutOf('render acknowledgement', (url, body) => url.endsWith('/action') && body.type === 'content_impression', async c => { await readyFirst(c); c.listen.apply(c.page.set); },
        c => { void c.listen.rendered(SLOT, GRID); });
      await cutOf('later decision request', url => url.endsWith('/decisions/snapshot'), readyFirst, c => { void c.listen.hydrate({ page: 'pdp' }); });
      const expected = { [`aborted at ${ACK_DEADLINE_MS - 1} ms`]: false, [`aborted at ${ACK_DEADLINE_MS} ms`]: true };
      expect(measured, 'P60.SD1 — every request that shares the deadline is cut at ACK_DEADLINE_MS').toEqual([
        ['session mint', expected], ['first decision request of a new browser', expected], ['render acknowledgement', expected], ['later decision request', expected]]);
    } finally { vi.useRealTimers(); }
  });
});

// ===========================================================================
// unit:P60.SD2 — a cut acknowledgement is re-sent once; an answered retry keeps the placement armed
// ===========================================================================

describe('unit:P60.SD2', () => {
  for (const [entryName, entry] of [['source entry', sourceClient], ['shipped bundle', bundleClient]] as const) {
    for (const answer of ['pending', 'recovered'] as const) {
      it(`sdk (${entryName}): after the acknowledgement is cut at ACK_DEADLINE_MS, the SDK re-sends the same envelope (same event id) once by itself; the retry answered ${answer} leaves the placement's viewable impression, dwell and engagement armed, each sent once with its decision, and nothing is re-sent again`, async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        try {
          const { p, first, acknowledged } = await paintAndEngage(entry, ['cut', answer]);
          expect(first, `PRECONDITION (${entryName}): the placement's acknowledgement was sent once and left unanswered`).toBe(1);
          const bodies = p.impressions.map(i => i.body);
          const eventIds = bodies.map(body => (JSON.parse(body) as Posted).eventId);
          expect.soft(eventIds, `${entryName}: P60.SD2 — after the cut the SDK re-sends the placement's acknowledgement once, with the same event id, and never a third time (${p.impressions.length} request(s); answered ${p.impressions.map(i => i.answer).join(', ')}; rendered resolved ${show(acknowledged)})`)
            .toEqual([eventIds[0], eventIds[0]]);
          expect.soft(bodies.length === 2 && bodies[1] === bodies[0] ? 'the same envelope' : `${bodies.length} request(s)${bodies.length > 1 ? ', bodies differ' : ''}`,
            `${entryName}: P60.SD2 — the retry is the same envelope, byte for byte (its time, offer and page instance with its event id)`).toBe('the same envelope');
          expect.soft(p.engagements(), `${entryName}: P60.SD2 — the retry answered ${answer} leaves the placement armed: its viewable impression after one second in view, its dwell on leaving view and its click, each sent once with its decision (listen.ts: suppressed after a cut today)`)
            .toEqual([['content_viewable', GRID, receiptOf(0, GRID)], ['content_dwell', GRID, receiptOf(0, GRID)], ['content_click', GRID, receiptOf(0, GRID)]]);
          const dwell = p.posted.find(e => e.type === 'content_dwell');
          expect.soft(dwell?.data.ms ?? 'no dwell', `${entryName}: P60.SD2 — the dwell measures the one and a half seconds in view`).toBe(1_500);
        } finally { vi.useRealTimers(); }
      });
    }
  }

  it('sdk (source entry): when the retry is cut too, the SDK sends the placement\'s acknowledgement exactly twice, the same envelope, and never a third time by itself', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const { p } = await paintAndEngage(sourceClient, ['cut', 'cut', 'pending']);
      const bodies = p.impressions.map(i => i.body);
      expect.soft(bodies.length === 2 && bodies[1] === bodies[0] ? 'sent twice, the same envelope' : `${bodies.length} request(s)${bodies.length > 1 && new Set(bodies).size > 1 ? ', bodies differ' : ''}`,
        'P60.SD2 — the SDK retries a cut acknowledgement once: two requests of the same envelope, no third').toBe('sent twice, the same envelope');
    } finally { vi.useRealTimers(); }
  });

  it('sdk (source entry): LOCK — only a cut is retried: an acknowledgement answered within the deadline, accepted pending or refused 409 as a conflict (P57), is sent once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const counts: Array<[string, number]> = [];
      for (const answer of ['pending', 'conflict'] as const) {
        const { p } = await paintAndEngage(sourceClient, [answer]);
        counts.push([answer, p.impressions.length]);
      }
      expect(counts, 'P60.SD2 — an answered acknowledgement is not re-sent').toEqual([['pending', 1], ['conflict', 1]]);
    } finally { vi.useRealTimers(); }
  });

  it('CONTROL: the cut is the SDK\'s own — the unanswered acknowledgement\'s abort signal fires at ACK_DEADLINE_MS, and the fetch double rejects it then', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const p = sdkPage(['cut']);
      const client = sourceClient(p.f.host);
      const ready = client.ready(); await p.settle();
      expect(await ready, 'PRECONDITION: the client is ready').toBe(true);
      client.apply(p.set);
      const rendered = client.rendered(SLOT, GRID);
      await p.settle();
      const signal = p.impressions[0]?.signal;
      expect(signal ? signal.aborted : 'no signal', 'CONTROL — the acknowledgement carries an abort signal, not yet aborted').toBe(false);
      await p.hold(ACK_DEADLINE_MS); await p.settle();
      expect(signal?.aborted, 'CONTROL — the SDK aborted it at its deadline').toBe(true);
      await rendered;
      p.close();
    } finally { vi.useRealTimers(); }
  });
});

// ===========================================================================
// unit:P60.SD3 — locks: one envelope per placement, the acceptance of pending, the bundles and the SDK typecheck
// ===========================================================================

describe('unit:P60.SD3', () => {
  it('sdk: LOCK — one envelope per placement: a placement painted three times is acknowledged once, a second placement with its own event id, and an engagement carries the receipt of its placement', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const p = sdkPage(['recovered', 'recovered']);
      const client = sourceClient(p.f.host);
      const ready = client.ready(); await p.settle();
      expect(await ready, 'PRECONDITION: the client is ready').toBe(true);
      client.apply(p.set);
      for (let i = 0; i < 3; i++) { await client.rendered(SLOT, GRID, p.el('m0')); await p.settle(); }
      await client.rendered(SLOT, RECO, p.el('m1')); await p.settle();
      await client.outcome('content_click', GRID, SLOT); await p.settle();
      const sent = p.impressions.map(i => JSON.parse(i.body) as Posted);
      expect.soft(sent.map(e => e.data.contentId), 'P60.SD3 — one acknowledgement per placement').toEqual([GRID, RECO]);
      expect.soft(new Set(sent.map(e => e.eventId)).size, 'P60.SD3 — each placement\'s envelope has its own event id').toBe(2);
      expect.soft(p.engagements(), 'P60.SD3 — the engagement carries its placement\'s receipt').toEqual([['content_click', GRID, receiptOf(0, GRID)]]);
      p.close();
    } finally { vi.useRealTimers(); }
  });

  it('sdk: LOCK (addendum section 4) — the SDK accepts a first acknowledgement answered pending: the placement\'s viewable impression, dwell and engagement are sent with its decision; CONTROL: an answer naming another source is not accepted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const { p, acknowledged } = await paintAndEngage(sourceClient, ['pending']);
      expect.soft((acknowledged as { source?: unknown } | null)?.source, 'P60.SD3 — rendered resolves with the pending receipt').toBe('pending');
      expect.soft(p.engagements(), 'P60.SD3 — a pending acknowledgement arms the placement')
        .toEqual([['content_viewable', GRID, receiptOf(0, GRID)], ['content_dwell', GRID, receiptOf(0, GRID)], ['content_click', GRID, receiptOf(0, GRID)]]);
      const refused = await paintAndEngage(sourceClient, ['unknown-source']);
      expect([refused.acknowledged, refused.p.engagements()], 'CONTROL — a receipt whose source is neither pending nor recovered is not accepted, and nothing is armed').toEqual([null, []]);
    } finally { vi.useRealTimers(); }
  });

  it('logic: LOCK — node scripts/build-sdk.mjs --check exits 0 (every generated SDK file an exact match of src/sdk) and every exported bundle is within its recorded byte budget; CONTROL: a build whose bundle differs by one byte is refused naming the bundle', async () => {
    const check = spawnSync(process.execPath, ['scripts/build-sdk.mjs', '--check'], { cwd: ROOT_PATH, encoding: 'utf8' });
    expect(check.status, `P60.SD3 — node scripts/build-sdk.mjs --check is an exact match (${check.stderr.slice(0, 400)}${check.stdout.slice(0, 400)})`).toBe(0);
    const script = await import(/* @vite-ignore */ new URL('scripts/build-sdk.mjs', ROOT).href) as {
      verifySDK: (o: { root: string; build?: typeof esbuild }) => Promise<unknown>;
      verifyPackage: (o: { root: string }) => Promise<{ report: Array<{ file: string; bytes: number; budget: number }> }>;
    };
    const { report } = await script.verifyPackage({ root: ROOT_PATH });
    expect(report.length, 'PRECONDITION: the package exports its ESM and IIFE bundles, each with a budget').toBeGreaterThanOrEqual(2);
    expect(report.filter(row => !(row.bytes <= row.budget)).map(row => `${row.file}: ${row.bytes} bytes of a ${row.budget}-byte budget`),
      'P60.SD3 — every exported bundle is within its byte budget (packages/sdk/package.json sizeBudget)').toEqual([]);
    const flipped: typeof esbuild = (async (options: Parameters<typeof esbuild>[0]) => {
      const result = await esbuild(options);
      if (String(options.outfile).endsWith('edge-personalization.esm.js') && result.outputFiles?.[0]) {
        const bytes = result.outputFiles[0].contents; bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      }
      return result;
    }) as typeof esbuild;
    await expect(script.verifySDK({ root: ROOT_PATH, build: flipped }), 'CONTROL — the check refuses a bundle one byte off, naming it').rejects.toThrow(/public\/sdk\/edge-personalization\.esm\.js/);
  }, 120_000);

  it('logic: LOCK — the SDK typecheck (node node_modules/typescript/bin/tsc -p src/sdk/tsconfig.json --noEmit) exits 0; CONTROL: the same compiler fails a file with a type error', () => {
    const tsc = join(ROOT_PATH, 'node_modules', 'typescript', 'bin', 'tsc');
    const sdk = spawnSync(process.execPath, [tsc, '-p', 'src/sdk/tsconfig.json', '--noEmit'], { cwd: ROOT_PATH, encoding: 'utf8' });
    expect(sdk.status, `P60.SD3 — the SDK typechecks (${sdk.stdout.slice(0, 600)})`).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), 'p60-tsc-'));
    try {
      writeFileSync(join(dir, 'broken.ts'), 'export const deadline: number = \'five seconds\';\n');
      const broken = spawnSync(process.execPath, [tsc, '--noEmit', '--strict', join(dir, 'broken.ts')], { cwd: dir, encoding: 'utf8' });
      expect(broken.status === 0 ? 'compiled' : 'refused', 'CONTROL — a type error fails the compiler').toBe('refused');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
