// src/units/P34/LEDGER.unit.test.ts
// P34 under the Closure Ledger: the tests for the LOCAL criteria of the P34 work
// order (`tapestry-parity-build`, ticket P34 "First paint and hold: the in-flight
// answer applied, a layout held per page view, receipts keyed per slot
// position"). LV1 is a deferred live row and gets no test.
//
// One `describe('unit:P34.<criterion>')` per LOCAL criterion. Expected values
// come from the witnesses, never from what the SDK does today:
//   · the work order's authority (docs/BTI-Parity-Build-Tickets.md, P34 in
//     section E): "an acknowledged event or a socket open during the first
//     snapshot no longer discards the answer (the SDK applies it, then
//     refreshes); the deadline is a hard ceiling; a page may hold a layout for
//     the page view without losing the receipts of moved modules; receipts are
//     keyed by slot, position within the slot and item, so a selection change
//     does not ripple into later slots; the kit's ten-line example is corrected;
//     `node scripts/build-sdk.mjs --check` is exact";
//   · the investigation, section G-C ("Mid-session": a page that holds the old
//     layout loses the receipts of moved modules; `order` is page-wide, so a
//     layout one module shorter shifts every later slot and those slots re-fire;
//     "Round trips": the ten-line example calls refresh() and connect() back to
//     back, so the first answer is discarded and re-asked and the deadline
//     restarts) and row "Hold within a page view, and the first-paint path" of H;
//   · freeze sheet item 47 (the SDK build script is not writable);
//   · the existing contract the work order cites: src/sdk/listen.ts:73 (the
//     placement key [slot, order, contentId]), :111-121, :162, :207-222 (a
//     refresh during a pending snapshot discards its answer), :341-343 (every
//     acknowledged event and socket open re-asks); src/sdk/core.ts:662-769;
//     docs/kit/01-integration-guide.md section 3.
//
// THE READINGS THIS FILE RULES:
//   T1  While the FIRST snapshot of a page view is in flight, an acknowledged
//       event (core 'sent') or a socket open (core 'socket' → connected) does
//       not cancel it: its answer is delivered to the slot subscribers, and then
//       exactly one refresh follows and is delivered. (The page's own explicit
//       `refresh()` keeps its coalescing contract, src/sdk/listen.test.ts:533.)
//   T2  `hydrateTimeoutMs` (1.5 s) is measured from the first snapshot request
//       of the page view; a re-ask does not restart it: by that instant every
//       subscriber has received either the decisions or the empty list.
//   T3  RULED MEMBER `listen.hold(slot): () => void`. It holds the slot's
//       current decisions for the current page view: a later answer of the same
//       page view does not repaint it (its subscribers, if called, receive the
//       held list) and does not drop its receipts, so `rendered()` and the
//       correlated outcomes of a held module carry the decision identifier it
//       was painted with, and are accepted, after a later answer moved or
//       dropped it. A new page view, or calling the returned function, releases
//       it: after either, the next answer the page receives repaints the slot
//       (whether a release also repaints at once with the answer held back is
//       not ruled, so each release is judged on an answer that moves every
//       module). The fake engine below accepts an outcome only for a decision
//       identifier it issued, as render admission does.
//   T4  A painted receipt is keyed by (slot, position within the slot, item):
//       a later answer that changes one slot's selection leaves every other
//       slot's receipts and subscribers untouched although the page-wide
//       `order` of its decisions shifted; and the same item at ANOTHER position
//       within its slot is a new placement — the slot repaints and the item
//       carries the receipt of the answer that moved it — so a key of slot and
//       item alone cannot pass.
//   T5  The code block of docs/kit/01-integration-guide.md section 3 runs as
//       written over the SDK: the page paints the first answer, then one
//       refresh; `node scripts/build-sdk.mjs --check` exits 0 on this tree; and
//       on a copy of the tree, one byte changed in any shipped SDK file (each
//       bundle in its three places, each declaration file) makes the check fail
//       naming that file. The kit's documentation of the hold (remaining work)
//       is a sentence for the reviewer to read; no statement is asserted here.
//
// NO NEW EXPORT IS IMPORTED. `listen.hold` is read loosely. The SDK is driven
// as `createClient` composes it (src/sdk/index.ts: createCore, createListen,
// createEmit over the host) on the repository's test host, the idiom of
// src/sdk/listen.test.ts; src/sdk/index.ts itself is outside the app tsconfig.
//
// R10 (tests that lock present behaviour, listed for the lead):
//   · src/sdk/listen.test.ts:533-547 "W15 coalesces every trailing intent and
//     never paints an older same-page interaction response": after explicit
//     page `refresh()` calls coalesce, `reply(0)` leaves `seen` empty (:541).
//     Consistent with T1 only if the apply-then-refresh rule is confined to the
//     SDK's own triggers ('sent' and 'socket'), as ruled above.
//   · src/sdk/listen.test.ts:225 "W20.06 latest intent owns timers and results":
//     a newer hydrate() of ANOTHER page owns the result and the old timer; T2's
//     ceiling is per page view and does not cross a page change.
//   · src/sdk/listen.test.ts:549 "W15 … preserves unchanged paint": keyed today
//     on [slot, order, contentId]; under T4 an unchanged (slot, slotPosition,
//     item) placement keeps its receipt, which that test's fixture also satisfies.
//   · this file's fake engine (`sdk()`, its snapshot branch), corrected under R-P68
//     as R-P38 corrected src/sdk/listen.test.ts:603-604: a snapshot request that
//     carries no session is answered with the issued session (the P13 engine
//     shape, S4-C19), so T5's fresh browser keeps its first answer under S4-C18.
//   · T5's fresh-browser leg, LOCKED under R-P69 and green at specification: on a
//     fresh browser the socket the example asks for opens only after the first
//     answer has issued the session, and today's SDK paints and acknowledges that
//     answer, then refreshes once; it pins the kit's claim for a new visitor
//     across the build. T5's held-session leg is the one P34 turns green.
//   · R10 (amendment 11 P81, PU2; granted in its brief, test-only, R-P195's form): T5's two legs read the count after
//     the socket's open without the re-request P81 removes (no refresh: the engine pushes the page view's set), their
//     titles saying so.
//   · S22 R10 (amendment 11 P81; granted R-P269, test-only, R-P195's form): T1's 'a socket open' leg reads no HTTPS
//     refresh after the socket's open (the content_decisions frame does the work); its acknowledged-event leg, with no
//     socket connected, keeps exactly one refresh; every other assertion of the lock is kept.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createListen } from '@/sdk/listen';
import { offeredSet, renderAck, syntheticSession, testHost } from '@/sdk/testHost';
import type { ContentDecision, DecisionSet, RequestInitLike } from '@/sdk/types';

import { readTree } from '../_parity';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LAYOUT = 'pdp-modules', STORY = 'pdp-story';

const decision = (slot: string, order: number, contentId: string, type = 'editorial'): ContentDecision => ({ contentId,
  customerContentId: `TAP-${contentId.replace(/^module\./, '').replace(/\./g, '-').toUpperCase()}`, type, slot, order, score: 0.5, strategy: 'affinity', explain: { drivers: [] } });
/** A product page: the layout slot's modules first, the story slot below them; `order` is page-wide, as the engine sends it. */
const page = (layout: string[], story: string[]): DecisionSet => ({ page: 'pdp', arm: 'personalized',
  decisions: [...layout.map((id, i) => decision(LAYOUT, i, id, 'module')), ...story.map((id, i) => decision(STORY, layout.length + i, id))] });

const GRID = 'module.PDP.grid.1', RECO = 'module.PDP.reco.1', LOOK = 'module.PDP.reco.2', EDIT = 'module.PDP.editorial.1';
const STORY_A = 'story.tabby.quilted', STORY_B = 'story.tabby.charm';

/** One snapshot request in flight; `answer` resolves it and hands back the set exactly as the fake engine offered it. */
interface Pending { page: string; pageInstance: string; answered: boolean; answer: (set: DecisionSet, revision: string) => DecisionSet }

/** The SDK as createClient composes it, over the test host, with a fake engine that admits only what it issued. */
function sdk(config: { hydrateTimeoutMs?: number } = {}) {
  const f = testHost();
  const snapshots: Pending[] = [];
  const issued = new Map<string, string>(); // decisionId → renderOffer
  const actions: Array<{ type: string; data: Record<string, unknown>; status: number }> = [];
  const passthrough = f.host.fetch;
  const respond = (json: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  f.host.fetch = async (url: string, init?: RequestInitLike) => {
    if (url.includes('/decisions/snapshot')) {
      f.calls.push({ url, init });
      const body = JSON.parse(init?.body ?? '{}') as { page: string; pageInstance: string };
      return new Promise(resolve => snapshots.push({ page: body.page, pageInstance: body.pageInstance, answered: false, answer(set, revision) {
        const offered = offeredSet({ ...set, page: body.page }, body.pageInstance, revision);
        for (const d of offered.decisions) issued.set(d.decisionId!, d.renderOffer!);
        this.answered = true;
        // R-P68 (S4-C19): a snapshot request carrying no session is answered with the issued session beside the offered set, the P13 engine shape.
        resolve(respond(init?.headers?.['X-Shopper-Session'] ? { ok: true, ...offered } : { ok: true, ...offered, session: syntheticSession(f.host.now()) }));
        return offered;
      } }));
    }
    if (url.endsWith('/action')) {
      f.calls.push({ url, init });
      const body = JSON.parse(init?.body ?? '{}') as { type: string; data?: Record<string, unknown> };
      const data = body.data ?? {};
      const known = typeof data.decisionId === 'string' && issued.has(data.decisionId);
      if (body.type === 'content_impression') {
        const admitted = known && issued.get(data.decisionId as string) === data.renderOffer;
        actions.push({ type: body.type, data, status: admitted ? 200 : 401 });
        return admitted ? respond(renderAck(init)) : respond({ success: false, error: 'render offer refused' }, 401);
      }
      if (/^content_/.test(body.type)) {
        actions.push({ type: body.type, data, status: known ? 200 : 401 });
        return known ? respond({ success: true, update: { data: { segments: [], decisions: {} } } }) : respond({ success: false, error: 'decision unknown' }, 401);
      }
      actions.push({ type: body.type, data, status: 200 });
      return respond({ success: true });
    }
    return passthrough(url, init);
  };
  const core = createCore({ tenant: 'coach', ...config }, f.host);
  const listen = createListen(core);
  const emit = createEmit(core, listen);
  return { f, core, listen, emit, snapshots, issued, actions, destroy: () => { listen.destroy(); core.disconnect(); } };
}
type Sdk = ReturnType<typeof sdk>;
const settle = () => vi.advanceTimersByTimeAsync(0);
const EL = { getAttribute: () => null, addEventListener: () => undefined };
/**
 * Answers every snapshot still in flight with `set`, including any the answers
 * themselves cause, so a re-ask the SDK coalesces or repeats is answered alike;
 * returns the set as last offered (null when nothing was in flight).
 */
async function answerPending(s: Sdk, set: DecisionSet, revision: string): Promise<DecisionSet | null> {
  let offered: DecisionSet | null = null;
  for (let pending = s.snapshots.find(p => !p.answered); pending; pending = s.snapshots.find(p => !p.answered)) {
    offered = pending.answer(set, revision);
    await settle();
  }
  return offered;
}

/** The SDK's own re-ask triggers named by the ticket. */
const TRIGGERS: Array<{ name: string; fire: (s: Sdk) => Promise<void> }> = [
  { name: 'a socket open', fire: async s => { s.core.connect(); await settle(); s.f.sockets.at(-1)!.open(); await settle(); } },
  { name: 'an acknowledged event', fire: async s => { await s.emit.productView('COA-CH857', { line: 'Tabby', category: 'Handbags' }); await settle(); } },
];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// ===========================================================================
// unit:P34.T1 — the in-flight first answer is applied, then refreshed
// ===========================================================================

describe('unit:P34.T1', () => {
  for (const trigger of TRIGGERS) {
    // S22 R10 (amendment 11 P81; granted R-P269), test-only, R-P195's form: a socket open is followed by no HTTPS refresh,
    // the content_decisions frame does the work; an acknowledged event (no socket connected) is still followed by one.
    const refreshes = trigger.name === 'a socket open' ? 0 : 1;
    it(`sdk: ${trigger.name} while the first snapshot is in flight no longer discards it: the answer is delivered to the page, then ${refreshes ? 'exactly one refresh follows and is delivered' : 'no HTTPS refresh follows (the engine pushes, P81)'}`, async () => {
      const s = sdk();
      await s.core.ready();
      const painted: string[][] = [];
      s.listen.subscribe(LAYOUT, ds => painted.push(ds.map(d => d.contentId)));
      void s.listen.refresh({ page: 'pdp' });
      await settle();
      expect(s.snapshots.length, 'PRECONDITION: the first snapshot is in flight').toBe(1);
      await trigger.fire(s);
      s.snapshots[0]!.answer(page([GRID, RECO, LOOK], [STORY_A]), 'first');
      await settle();
      expect(painted[0], `P34.T1 — after ${trigger.name}, the in-flight first answer is delivered to the page`).toEqual([GRID, RECO, LOOK]);
      expect(s.snapshots.length, refreshes ? `P34.T1 — then one refresh follows` : 'P34.T1 — then no refresh follows the socket open (S22 R10, P81)').toBe(1 + refreshes);
      if (refreshes) {
        s.snapshots[1]!.answer(page([LOOK, GRID, EDIT], [STORY_A]), 'refresh');
        await settle();
        expect(painted, 'P34.T1 — the first answer, then the refreshed one, and nothing else').toEqual([[GRID, RECO, LOOK], [LOOK, GRID, EDIT]]);
      } else expect(painted, 'P34.T1 — the first answer, and nothing else').toEqual([[GRID, RECO, LOOK]]);
      expect(s.snapshots.length, refreshes ? 'P34.T1 — exactly one refresh' : 'P34.T1 — no refresh').toBe(1 + refreshes);
      s.destroy();
    });
  }
});

// ===========================================================================
// unit:P34.T2 — the first-decision deadline is a hard ceiling
// ===========================================================================

describe('unit:P34.T2', () => {
  for (const trigger of TRIGGERS) {
    it(`sdk: the 1.5-second deadline is measured from the first request and ${trigger.name} does not restart it: every subscriber has the empty list at the deadline at the latest`, async () => {
      const s = sdk({ hydrateTimeoutMs: 1500 });
      await s.core.ready();
      let elapsed = 0;
      const advance = async (ms: number) => { elapsed += ms; await vi.advanceTimersByTimeAsync(ms); };
      const seen: Array<{ at: number; slot: string; list: string[] }> = [];
      for (const slot of [LAYOUT, STORY]) s.listen.subscribe(slot, ds => seen.push({ at: elapsed, slot, list: ds.map(d => d.contentId) }));
      void s.listen.refresh({ page: 'pdp' });
      await settle();
      expect(s.snapshots.length, 'PRECONDITION: the first snapshot is in flight and will not answer in time').toBe(1);
      await advance(1000);
      await trigger.fire(s);
      await advance(500);
      for (const slot of [LAYOUT, STORY]) {
        expect(seen.filter(e => e.slot === slot && e.at <= 1500).map(e => e.list), `P34.T2 — by 1.5 s from the first request, ${slot} has received the empty list although ${trigger.name} re-asked at 1 s`).toEqual([[]]);
      }
      s.destroy();
    });
  }
});

// ===========================================================================
// unit:P34.T3 — a layout held for the page view keeps its receipts
// ===========================================================================

describe('unit:P34.T3', () => {
  it('sdk: a page that holds its layout keeps the held modules\' receipts: after a later answer moves or drops them, their acknowledgements and outcomes carry the decision identifiers they were painted with and are accepted; the function the hold returns releases it, and so does a new page view', async () => {
    const s = sdk();
    await s.core.ready();
    const layoutCalls: string[][] = [];
    s.listen.subscribe(LAYOUT, ds => layoutCalls.push(ds.map(d => d.contentId)));
    void s.listen.refresh({ page: 'pdp' });
    await settle();
    s.snapshots[0]!.answer(page([GRID, RECO, LOOK], [STORY_A]), 'first');
    await settle();
    const painted = s.listen.current()!.decisions.filter(d => d.slot === LAYOUT);
    expect(painted.map(d => d.contentId), 'PRECONDITION: the layout is painted').toEqual([GRID, RECO, LOOK]);
    for (const d of painted) expect(await s.listen.rendered(LAYOUT, d.contentId, EL), `PRECONDITION: ${d.contentId} is acknowledged`).toMatchObject({ decisionId: d.decisionId });
    const hold = (s.listen as unknown as { hold?: (slot: string) => () => void }).hold;
    expect(typeof hold, 'P34.T3 — the SDK offers listen.hold(slot) to hold a layout for the page view').toBe('function');
    const release = hold!.call(s.listen, LAYOUT);
    expect(typeof release, 'P34.T3 — the hold returns the function that releases it').toBe('function');

    // A later answer of the same page view moves the grid down, drops reco.1 and adds the editorial module.
    await s.emit.productView('COA-CH857', { line: 'Tabby', category: 'Handbags' });
    await settle();
    expect(s.snapshots.length, 'PRECONDITION: the acknowledged event re-asked').toBe(2);
    s.snapshots[1]!.answer(page([LOOK, GRID, EDIT], [STORY_A]), 'later');
    await settle();
    expect(layoutCalls.every(list => JSON.stringify(list) === JSON.stringify([GRID, RECO, LOOK])), `P34.T3 — the held layout is never repainted with the later order (calls: ${JSON.stringify(layoutCalls)})`).toBe(true);
    for (const d of painted) {
      const ack = await s.listen.rendered(LAYOUT, d.contentId, EL);
      expect(ack?.decisionId ?? null, `P34.T3 — ${d.contentId}'s acknowledgement still carries the identifier it was painted with`).toBe(d.decisionId);
    }
    const before = s.actions.length;
    for (const d of [painted[0]!, painted[1]!]) {
      const update = await s.emit.contentClick(d.contentId, LAYOUT);
      const sent = s.actions.slice(before).find(a => a.type === 'content_click' && a.data.contentId === d.contentId);
      expect([sent?.data.decisionId ?? null, sent?.status ?? null, update !== null],
        `P34.T3 — the click on held ${d.contentId} (moved or dropped by the later answer) carries its painted decision identifier and is accepted`).toEqual([d.decisionId, 200, true]);
    }
    // The clicks are acknowledged events; whatever they re-ask is answered with the same later order, still under the hold.
    await answerPending(s, page([LOOK, GRID, EDIT], [STORY_A]), 'later');

    // Released by the function the hold returned: the next answer of the page view, which moves every module, repaints the slot.
    release();
    await s.emit.productView('COA-CH857', { line: 'Tabby', category: 'Handbags' });
    await settle();
    const released = await answerPending(s, page([EDIT, LOOK, GRID], [STORY_A]), 'released');
    expect(released, 'PRECONDITION: the acknowledged event after the release re-asked').toBeTruthy();
    expect(layoutCalls.at(-1), 'P34.T3 — released by the function the hold returned, the layout repaints with the answer that moved every module').toEqual([EDIT, LOOK, GRID]);
    const grid = released!.decisions.find(d => d.slot === LAYOUT && d.contentId === GRID)!;
    expect((await s.listen.rendered(LAYOUT, GRID, EL))?.decisionId ?? null, 'P34.T3 — and the moved grid is acknowledged with the receipt of that answer').toBe(grid.decisionId);

    // Released by a new page view: the layout held again, the shopper goes to the home page and comes back to the product page.
    hold!.call(s.listen, LAYOUT);
    void s.listen.refresh({ page: 'home' });
    await settle();
    await answerPending(s, { page: 'home', arm: 'personalized', decisions: [decision('hero', 0, 'hero.tabby.first', 'on-model')] }, 'home');
    void s.listen.refresh({ page: 'pdp' });
    await settle();
    const next = await answerPending(s, page([RECO, GRID, LOOK], [STORY_A]), 'next-view');
    expect(next, 'PRECONDITION: the product page was asked for again').toBeTruthy();
    expect(layoutCalls.at(-1), 'P34.T3 — a new page view releases the hold: the product page shows its new answer').toEqual([RECO, GRID, LOOK]);
    const reco = next!.decisions.find(d => d.slot === LAYOUT && d.contentId === RECO)!;
    expect((await s.listen.rendered(LAYOUT, RECO, EL))?.decisionId ?? null, 'P34.T3 — and its modules are acknowledged with the receipts of the new page view').toBe(reco.decisionId);
    s.destroy();
  });
});

// ===========================================================================
// unit:P34.T4 — receipts keyed by slot, position within the slot and item
// ===========================================================================

describe('unit:P34.T4', () => {
  it('sdk: a layout one module shorter shifts the page-wide order of the story slot below it, and the story slot\'s receipts and subscribers are untouched; the same pieces at other positions within the story slot repaint it with new receipts, and leave the layout untouched', async () => {
    const s = sdk();
    await s.core.ready();
    const storyCalls: string[][] = [], layoutCalls: string[][] = [];
    s.listen.subscribe(LAYOUT, ds => layoutCalls.push(ds.map(d => `${d.contentId}@${d.decisionId}`)));
    s.listen.subscribe(STORY, ds => storyCalls.push(ds.map(d => `${d.contentId}@${d.decisionId}`)));
    void s.listen.refresh({ page: 'pdp' });
    await settle();
    s.snapshots[0]!.answer(page([GRID, RECO, LOOK], [STORY_A, STORY_B]), 'first');
    await settle();
    const first = s.listen.current()!.decisions;
    for (const d of first) expect(await s.listen.rendered(d.slot, d.contentId, EL), `PRECONDITION: ${d.contentId} is acknowledged`).toMatchObject({ decisionId: d.decisionId });
    const story = first.filter(d => d.slot === STORY);
    expect(storyCalls.length, 'PRECONDITION: the story slot was painted once').toBe(1);

    // The layout loses reco.1; the story slot keeps the same pieces at the same positions within it, one page-wide order earlier.
    await s.emit.productView('COA-CH857', { line: 'Tabby', category: 'Handbags' });
    await settle();
    s.snapshots[1]!.answer(page([GRID, LOOK], [STORY_A, STORY_B]), 'later');
    await settle();
    expect(storyCalls.length, `P34.T4 — the story slot's subscriber is not called again (calls: ${JSON.stringify(storyCalls)})`).toBe(1);
    expect(s.listen.current()!.decisions.filter(d => d.slot === STORY).map(d => d.decisionId), 'P34.T4 — the story slot keeps the receipts it was painted with').toEqual(story.map(d => d.decisionId));
    const before = s.actions.length;
    for (const d of story) {
      const update = await s.emit.contentClick(d.contentId, STORY);
      const sent = s.actions.slice(before).find(a => a.type === 'content_click' && a.data.contentId === d.contentId);
      expect([sent?.data.decisionId ?? null, sent?.status ?? null, update !== null], `P34.T4 — the click on ${d.contentId} carries its painted receipt and is accepted`).toEqual([d.decisionId, 200, true]);
    }
    // The clicks are acknowledged events; whatever they re-ask is answered with the same placements.
    await answerPending(s, page([GRID, LOOK], [STORY_A, STORY_B]), 'later');
    // The page paints the layout where it now stands (complete-the-look moved up one position), so every layout placement has a receipt.
    for (const d of s.listen.current()!.decisions.filter(x => x.slot === LAYOUT)) {
      expect(await s.listen.rendered(LAYOUT, d.contentId, EL), `PRECONDITION: ${d.contentId} is acknowledged where it now stands`).toMatchObject({ decisionId: d.decisionId });
    }
    const layoutReceipts = s.listen.current()!.decisions.filter(d => d.slot === LAYOUT).map(d => d.decisionId);
    const layoutPaints = layoutCalls.length, storyPaints = storyCalls.length;

    // A move within the slot: the story slot's two pieces trade positions; the layout is unchanged.
    await s.emit.productView('COA-CH857', { line: 'Tabby', category: 'Handbags' });
    await settle();
    const swapped = await answerPending(s, page([GRID, LOOK], [STORY_B, STORY_A]), 'swapped');
    expect(swapped, 'PRECONDITION: the acknowledged event re-asked').toBeTruthy();
    const moved = swapped!.decisions.filter(d => d.slot === STORY);
    expect(storyCalls.slice(storyPaints), 'P34.T4 — the same pieces at other positions within the slot are new placements: the slot repaints once, with the receipts of the answer that moved them')
      .toEqual([moved.map(d => `${d.contentId}@${d.decisionId}`)]);
    for (const d of moved) {
      expect((await s.listen.rendered(STORY, d.contentId, EL))?.decisionId ?? null, `P34.T4 — ${d.contentId}, moved within the slot, is acknowledged with its new receipt`).toBe(d.decisionId);
    }
    expect(layoutCalls.length, `P34.T4 — the unchanged layout slot is not repainted (calls: ${JSON.stringify(layoutCalls.slice(layoutPaints))})`).toBe(layoutPaints);
    expect(s.listen.current()!.decisions.filter(d => d.slot === LAYOUT).map(d => d.decisionId), 'P34.T4 — and keeps its receipts').toEqual(layoutReceipts);
    s.destroy();
  });
});

// ===========================================================================
// unit:P34.T5 — the ten-line example runs as written; the build check is exact
// ===========================================================================

/** The code block of section 3 of the integration guide, verbatim. */
function tenLines(): string {
  const guide = readTree('docs/kit/01-integration-guide.md');
  const section = guide.split(/\n## /).find(s => /^3\. /.test(s));
  const code = section?.match(/```js\n([\s\S]*?)```/)?.[1];
  expect(code, 'PRECONDITION: section 3 of the integration guide carries its code block').toBeTruthy();
  return code!;
}

/** Every file under a directory, as paths relative to `root`. */
const filesUnder = (root: string, dir: string): string[] => readdirSync(join(root, dir)).flatMap(name => {
  const path = join(dir, name);
  return statSync(join(root, path)).isDirectory() ? filesUnder(root, path) : [path];
});

describe('unit:P34.T5', () => {
  /** Runs the code block as written over `s`; returns what the page painted, with the decision each paint was handed. */
  const example = (s: Sdk): Array<{ id: string; decisionId?: string }> => {
    const painted: Array<{ id: string; decisionId?: string }> = [];
    let current: ContentDecision | undefined;
    const client = { listen: s.listen, emit: s.emit, connect: () => s.core.connect() };
    const renderHero = (customerContentId: string) => { painted.push({ id: customerContentId, decisionId: current?.decisionId }); return true; };
    const renderDefaultHero = () => { painted.push({ id: 'default' }); };
    // The page's own renderer sees the decision it is handed; the example passes only the CMS id.
    const listen = { ...s.listen, subscribe: (slot: string, cb: (ds: ContentDecision[], set: DecisionSet) => void) => s.listen.subscribe(slot, (ds, set) => { current = ds[0]; cb(ds, set); }) };
    const run = new Function('client', 'renderHero', 'renderDefaultHero', 'heroElement', tenLines()) as (...args: unknown[]) => void;
    run({ ...client, listen }, renderHero, renderDefaultHero, EL);
    return painted;
  };

  it('sdk: on the page view of a browser that holds a session, the kit\'s ten-line example, run as written over the SDK, paints the first answer and acknowledges it, and the socket\'s open asks for nothing over HTTPS', async () => {
    const s = sdk();
    await s.core.ready();
    const painted = example(s);
    await settle();
    s.f.sockets.at(-1)?.open();
    await settle();
    expect(s.snapshots.length, 'PRECONDITION: the example asked for the page once').toBe(1);
    s.snapshots[0]!.answer({ page: 'home', arm: 'personalized', decisions: [decision('hero', 0, 'hero.tabby.first', 'on-model')] }, 'first');
    await settle();
    expect(painted[0], 'P34.T5 — the example paints the first answer, not a re-asked one').toEqual({ id: 'TAP-HERO-TABBY-FIRST', decisionId: 'first-hero-0-hero.tabby.first' });
    const acks = s.actions.filter(a => a.type === 'content_impression');
    expect(acks.map(a => [a.data.decisionId, a.status]), 'P34.T5 — and acknowledges that paint').toEqual([['first-hero-0-hero.tabby.first', 200]]);
    // R10 (amendment 11 P81, PU2; the brief's grant, R-P195's form): the count after the socket's open without the re-request.
    expect(s.snapshots.length, 'P34.T5 — and the socket\'s open makes no refresh: the engine pushes the page view\'s set (P81)').toBe(1);
    s.destroy();
  });

  it('sdk: LOCKED — on a fresh browser (S4-C18, S4-C19), the kit\'s ten-line example, run as written over the SDK, paints the first answer, which issues the session, and acknowledges it; then the socket the example asked for opens and asks for nothing over HTTPS', async () => {
    const s = sdk();
    const painted = example(s);
    await settle();
    expect(s.snapshots.length, 'PRECONDITION: on a fresh browser, the example asked for the page once').toBe(1);
    s.snapshots[0]!.answer({ page: 'home', arm: 'personalized', decisions: [decision('hero', 0, 'hero.tabby.first', 'on-model')] }, 'first');
    await settle();
    expect(painted[0], 'P34.T5 — on a fresh browser, the example paints the first answer, not a re-asked one').toEqual({ id: 'TAP-HERO-TABBY-FIRST', decisionId: 'first-hero-0-hero.tabby.first' });
    const acks = s.actions.filter(a => a.type === 'content_impression');
    expect(acks.map(a => [a.data.decisionId, a.status]), 'P34.T5 — on a fresh browser, and acknowledges that paint').toEqual([['first-hero-0-hero.tabby.first', 200]]);
    // The socket the example asked for exists once the first answer has issued the session; a real browser opens it now.
    expect(s.f.sockets.length, 'PRECONDITION: on a fresh browser, the example\'s socket exists once the first answer has issued the session').toBe(1);
    s.f.sockets[0]!.open();
    await settle();
    // Whatever the open re-asks is answered, so a refresh coalesced behind it is asked too.
    await answerPending(s, { page: 'home', arm: 'personalized', decisions: [decision('hero', 0, 'hero.tabby.second', 'on-model')] }, 'refresh');
    // R10 (amendment 11 P81, PU2; the brief's grant, R-P195's form): the count after the socket's open without the re-request.
    expect(s.snapshots.length, 'P34.T5 — on a fresh browser, the socket\'s open makes no refresh: the engine pushes the page view\'s set (P81)').toBe(1);
    s.destroy();
  });

  it('logic: LOCKED — node scripts/build-sdk.mjs --check exits 0 on this tree, and on a copy of the tree one byte changed in any shipped SDK file fails the check naming that file', async () => {
    vi.useRealTimers();
    const check = spawnSync(process.execPath, ['scripts/build-sdk.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(check.status, `P34.T5 — the build check is exact on this tree (${check.stderr.slice(0, 300)})`).toBe(0);

    const build = await import(/* @vite-ignore */ new URL('../../../scripts/build-sdk.mjs', import.meta.url).href) as {
      buildSDK: (o: { root: string }) => Promise<Array<{ metafile: { inputs: Record<string, unknown> } }>>;
      verifySDK: (o: { root: string }) => Promise<unknown>; verifyPackage: (o: { root: string }) => Promise<unknown> };
    const copy = mkdtempSync(join(tmpdir(), 'p34-sdk-'));
    try {
      // The copy holds what the build reads (every bundle input, src/sdk with its tsconfig) and what it ships.
      for (const dir of ['src/sdk', 'public/sdk', 'packages/sdk']) cpSync(join(ROOT, dir), join(copy, dir), { recursive: true });
      for (const result of await build.buildSDK({ root: ROOT })) for (const input of Object.keys(result.metafile.inputs)) cpSync(join(ROOT, input), join(copy, input));
      await build.verifySDK({ root: copy });
      await build.verifyPackage({ root: copy });
      const shipped = [...filesUnder(copy, 'public/sdk').filter(p => /edge-personalization(\.esm)?\.js$/.test(p)),
        ...filesUnder(copy, 'packages/sdk').filter(p => /\.(js|d\.ts)$/.test(p))].map(p => relative(copy, join(copy, p)).split('\\').join('/'));
      expect(shipped.length, 'PRECONDITION: the shipped SDK files are found (three places per bundle, the declarations)').toBeGreaterThanOrEqual(6);
      const unflagged: string[] = [];
      for (const path of shipped) {
        const original = readFileSync(join(copy, path));
        const changed = Buffer.from(original); changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
        writeFileSync(join(copy, path), changed);
        const failure = await (path.endsWith('.d.ts') ? build.verifyPackage({ root: copy }) : build.verifySDK({ root: copy })).then(() => null, (e: Error) => e.message);
        if (!failure || !failure.includes(path)) unflagged.push(`${path}: ${failure ?? 'passed'}`);
        writeFileSync(join(copy, path), original);
      }
      expect(unflagged, 'P34.T5 — every shipped SDK file one byte off the build fails the check by name').toEqual([]);
    } finally { rmSync(copy, { recursive: true, force: true }); }
  }, 300_000);
});
