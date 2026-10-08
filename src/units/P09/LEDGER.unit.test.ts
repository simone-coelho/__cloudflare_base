// src/units/P09/LEDGER.unit.test.ts
// P09 under the Closure Ledger: the tests for the LOCAL criteria of the P09 work
// order (`tapestry-parity-build`, ticket P09 "Behaviour-versus-performance
// percentage dial"). DC1 (decision D1) is ruled here and exercised inside G1-G4;
// LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P09.<criterion> …')` per criterion. Every expected value
// comes from the work order or a witness it cites, never from what the engine
// answers today:
//   · the authority (docs/BTI-Parity-Build-Tickets.md, P09 in section B, amended
//     2026-10-07): "a per-slot percentage is readable and editable in the tuning
//     screen, and 0 percent performance reproduces today's decisions term for
//     term … on a layout slot the percentage is the blend weight of P28 … on
//     content slots it may remain a mapping onto γ. P09 is the surface; P28 is
//     the mechanism";
//   · freeze sheet item 23 (D1: on content slots γ = p / 100) and item 39 ("A
//     surface only: the percentage is the tuning screen's form of the stored
//     dial, no second stored value; only the console view and the kit are
//     writable"). Both UNANSWERED at the freeze: every unit names them (R-P15);
//   · P28's opt-in `blend: { p }` (R-P13; src/units/P28/LEDGER.unit.test.ts);
//   · the existing contract: public/console/views.js (the dials screen edits γ
//     from 0 to 1 per slot; the slots screen lists each slot), the learn
//     document's `slots.<slot>.gamma` (src/content/kinds.ts, 0 by default).
//
// THE READINGS THIS FILE RULES (one representation for every criterion):
//   The dials screen renders the performance percentage of the slot in the URL
//   as `[data-focus-key="slots.<slot>.performancePercent"]`, an integer-or-decimal
//   number from 0 to 100. On a slot outside the blend, typing P and saving PUTs
//   the learn document with `slots.<slot>.gamma = P / 100`; on a layout slot
//   opted into P28's blend, with `slots.<slot>.blend.p = P / 100` and γ as it
//   was. No other member is stored (item 39). A value outside 0 to 100 disables
//   the save and sends nothing. The control shows the stored dial as the
//   percentage it equals. The slots screen shows each slot's percentage as
//   "<P>%" in its row. The console is the shipped one, under jsdom, bound to the
//   mounted app (unit:W20.R2's and unit:P01.O6's idiom).
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error): the
// console control `slots.<slot>.performancePercent` and the slots screen's
// percentage. No new export is imported; P09 writes no product member.
//
// PRECONDITIONS (R-P6): legs on the layout slot need P02 (a declared layout
// slot, governance 4) and P28 (the blend kept by the learn validator) and fail
// first with messages labelled PRECONDITION P02 or PRECONDITION P28.
//
// HARNESS: src/units/_parity.ts (mounted app, real DO classes, both hosts, the
// shipped console under jsdom).

import { describe, expect, it } from 'vitest';

import type { DecisionRecord } from '@/content/types';

import {
  declaredSlots, expectPublished, HOSTS, layoutSlot, LAYOUT, learnDocument, loadDocument, M, MODULES, mount, openConsole, PAGE_VIEW,
  PAID_SOCIAL_ENTRY, readTree, recentSlot, replayOf, servePage, shopperOn, storedDecisions, TABBY_VIEWS, TENANT, toLedger,
  type Host, type Mounted, type Shopper,
} from '../_parity';

const STORY = 'pdp-story';
const STORY_PIECES = [
  { id: 'story.tabby', customerContentId: 'TAP-STORY-TABBY', type: 'editorial', title: 'The Tabby story', tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' } },
  { id: 'story.film', customerContentId: 'TAP-STORY-FILM', type: 'video', title: 'The Tabby in motion', tags: { line: ['Tabby'], occasion: ['evening'] }, slotTypes: [STORY], lifecycle: { status: 'live' } },
];
const PIECES = [...MODULES, ...STORY_PIECES];
const STORY_SLOT = { slot: STORY, take: 2, weights: { line: 1, occasion: 0.5 } };
const SLOTS = declaredSlots([layoutSlot(), recentSlot(), STORY_SLOT]);
/** The content-slot legs need no layout: the same page with the modules slot undeclared (governance 3), so they rest on the existing trust dial only. */
const UNDECLARED = JSON.parse(JSON.stringify({ version: 'parity-p09-undeclared', governanceVersion: 3, pages: { pdp: [{ ...layoutSlot(), layout: undefined }, recentSlot(), STORY_SLOT] } }));
const published = (m: Mounted, ticket: string) => expectPublished(m, `${ticket} — the page with its content slot publishes`);
/** A merchandiser's frozen lift on the first story, so the trust dial has something to apply (src/content/decide.ts). */
const FROZEN = { items: { 'story.tabby': { mode: 'freeze', lift: 2 } } };
const learnWith = (story: Record<string, unknown>, layout: Record<string, unknown> = {}) => learnDocument({
  [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click', ...layout }, [STORY]: { reward: 'click', ...FROZEN, ...story } });
const percentKey = (slot: string) => `slots.${slot}.performancePercent`;
const preconditionP02 = (m: Mounted, ticket: string) => expectPublished(m, `${ticket} — PRECONDITION P02: the page's declared layout slot (governance 4) publishes`);
async function preconditionP28(m: Mounted, p: number) {
  const stored = (await loadDocument(m, 'learn')).document as { slots?: Record<string, Record<string, unknown>> };
  expect(stored.slots?.[LAYOUT]?.blend, `${m.host}: PRECONDITION P28 — the learn document keeps the layout's blend opt-in`).toEqual({ p });
}
const learnPuts = (c: Awaited<ReturnType<typeof openConsole>>) => c.requests.filter(r => r.method === 'PUT' && r.path.startsWith('/content/learn'));
const savedDocument = (c: Awaited<ReturnType<typeof openConsole>>) => {
  const last = learnPuts(c).at(-1);
  return last?.body ? (JSON.parse(last.body) as { document?: { slots?: Record<string, Record<string, unknown>> } }).document : undefined;
};
async function tabby(m: Mounted): Promise<Shopper> {
  const s = await shopperOn(m);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: her page view is accepted`).toBe(200);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: her view is accepted`).toBe(200);
  return s;
}
const terms = (records: DecisionRecord[], slot: string) => records.filter(r => r.slot === slot).sort((a, b) => a.position - b.position)
  .map(r => [r.item_id, r.position, r.explain.score_base, r.explain.score_final, r.explain.lift?.gamma ?? null]);

/** The dials screen of one slot: type the percentage and save. Answers whether the control exists. */
async function savePercent(m: Mounted, slot: string, percent: string) {
  const c = await openConsole(m, `#/dials?scope=${TENANT}&slot=${slot}`);
  const typed = await c.type(percentKey(slot), percent);
  if (typed) await c.save();
  return { c, typed };
}

// ===========================================================================
// unit:P09.G1 — the shipped dials screen reads and edits the percentage
// ===========================================================================

describe('unit:P09.G1 (freeze items 23 and 39)', () => {
  it('sdk: on the shipped dials screen of a content slot an operator types 35 percent, the screen saves γ 0.35 and nothing else through PUT /content/learn, and the next decision runs at γ 0.35 without a deployment', async () => {
    const m = await mount('session', { pieces: PIECES, slots: UNDECLARED, retainedSlots: true, learn: learnWith({}) });
    published(m, 'P09.G1');
    const { c, typed } = await savePercent(m, STORY, '35');
    try {
      expect(typed, `P09.G1 — the dials screen renders the performance percentage ([data-focus-key="${percentKey(STORY)}"])`).toBe(true);
      expect(learnPuts(c).length, 'P09.G1 — the console saved through PUT /content/learn').toBe(1);
      const story = savedDocument(c)?.slots?.[STORY] ?? {};
      expect([story.gamma, Object.keys(story).filter(k => /percent/i.test(k))], 'P09.G1 — it stored γ = 35 / 100 and no second value').toEqual([0.35, []]);
      const record = (await servePage(m, await tabby(m), 'pdp')).records.find(r => r.item_id === 'story.tabby');
      expect(record?.explain.lift?.gamma, 'P09.G1 — the saved revision is in force: the next decision applies γ 0.35').toBe(0.35);
    } finally { c.close(); }
  }, 90_000);

  it('sdk: on the dials screen of the layout slot opted into the blend, typing 60 percent saves blend.p 0.6 and leaves γ as it was', async () => {
    const m = await mount('session', { pieces: PIECES, slots: SLOTS, learn: learnWith({}, { gamma: 0.2, blend: { p: 0.1 } }) });
    preconditionP02(m, 'P09.G1');
    await preconditionP28(m, 0.1);
    const { c, typed } = await savePercent(m, LAYOUT, '60');
    try {
      expect(typed, `P09.G1 — the dials screen renders the layout's performance percentage ([data-focus-key="${percentKey(LAYOUT)}"])`).toBe(true);
      const layout = savedDocument(c)?.slots?.[LAYOUT] ?? {};
      expect([layout.blend, layout.gamma], 'P09.G1 — it stored blend.p = 60 / 100 and left γ 0.2').toEqual([{ p: 0.6 }, 0.2]);
    } finally { c.close(); }
  }, 90_000);
});

// ===========================================================================
// unit:P09.G2 — a content slot saved at P percent decides as γ P / 100; 0 percent as today
// ===========================================================================

describe('unit:P09.G2 (freeze item 23)', () => {
  /** Served-v1 on every slot and without the durable recovery path: the replay reads what the real producer and consumer wrote (R-P14). */
  const SERVED = { measurementBasis: 'served-v1' };
  const decidedAt = async (host: Host, learn: unknown, percent?: string) => {
    const m = await mount(host, { pieces: PIECES, slots: UNDECLARED, retainedSlots: true, learn }, { recovery: false });
    published(m, 'P09.G2');
    if (percent !== undefined) {
      const { c, typed } = await savePercent(m, STORY, percent);
      c.close();
      expect(typed, `${host}: P09.G2 — the dials screen renders the performance percentage`).toBe(true);
    }
    const s = await tabby(m);
    return { m, s, set: await servePage(m, s, 'pdp', { offer: false }) };
  };
  for (const host of HOSTS) {
    it(`host (${host}): a content slot saved at 70 percent decides term for term as γ 0.7 published, and at 0 percent as today with every decision replaying equal`, async () => {
      const viaScreen = await decidedAt(host, learnWith({}, SERVED), '70');
      const direct = await decidedAt(host, learnWith({ gamma: 0.7 }, SERVED));
      expect(terms(viaScreen.set.records, STORY), `${host}: P09.G2 — 70 percent decides as γ 0.7`).toEqual(terms(direct.set.records, STORY));
      const zero = await decidedAt(host, learnWith({ gamma: 0.4 }, SERVED), '0');
      const today = await decidedAt(host, learnWith({}, SERVED));
      expect(terms(zero.set.records, STORY), `${host}: P09.G2 — 0 percent decides as today's shipped γ 0`).toEqual(terms(today.set.records, STORY));
      await toLedger(zero.m, zero.set.records);
      const replays: unknown[][] = [];
      for (const r of storedDecisions(zero.m, zero.s.subject).filter(x => x.slot === STORY)) {
        const replay = await replayOf(zero.m, r.decision_id);
        replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]);
      }
      expect(replays.length, `${host}: PRECONDITION — the ledger holds the content decisions`).toBe(2);
      expect(replays, `${host}: P09.G2 — each decision at 0 percent replays equal`).toEqual(replays.map(([id]) => [id, 200, 'equal']));
    }, 120_000);
  }
});

// ===========================================================================
// unit:P09.G3 — a layout slot in the blend saved at P percent decides at p = P / 100
// ===========================================================================

describe('unit:P09.G3 (freeze items 23 and 39)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the layout slot opted into the blend, saved at 40 percent, decides at p 0.4 and keeps its γ`, async () => {
      const m = await mount(host, { pieces: PIECES, slots: SLOTS, learn: learnWith({}, { gamma: 0.3, blend: { p: 0 } }) });
      preconditionP02(m, 'P09.G3');
      await preconditionP28(m, 0);
      const { c, typed } = await savePercent(m, LAYOUT, '40');
      c.close();
      expect(typed, `${host}: P09.G3 — the dials screen renders the layout's performance percentage`).toBe(true);
      const stored = (await loadDocument(m, 'learn')).document as { slots?: Record<string, Record<string, unknown>> };
      expect([stored.slots?.[LAYOUT]?.blend, stored.slots?.[LAYOUT]?.gamma], `${host}: P09.G3 — the published learn document holds p 0.4 and γ 0.3`).toEqual([{ p: 0.4 }, 0.3]);
      const records = (await servePage(m, await tabby(m), 'pdp')).records.filter(r => r.slot === LAYOUT);
      expect(records.map(r => ((r.explain as Record<string, unknown>).blend as { p?: number } | undefined)?.p ?? null), `${host}: P09.G3 — every layout decision runs at p 0.4 (P28's explain.blend)`)
        .toEqual(records.map(() => 0.4));
    }, 90_000);
  }
});

// ===========================================================================
// unit:P09.G4 — out-of-range refused before saving; a retained dial shown as its percentage
// ===========================================================================

describe('unit:P09.G4 (freeze items 23 and 39)', () => {
  it('sdk: the screen refuses 150 and −5 percent before saving and sends nothing, and shows a stored γ 0.35 as 35, unchanged until edited', async () => {
    const m = await mount('session', { pieces: PIECES, slots: UNDECLARED, retainedSlots: true, learn: learnWith({ gamma: 0.35 }, { gamma: 0.2 }) });
    published(m, 'P09.G4');
    const c = await openConsole(m, `#/dials?scope=${TENANT}&slot=${STORY}`);
    try {
      expect(c.control(percentKey(STORY))?.value ?? 'no percentage control', 'P09.G4 — the stored γ 0.35 shows as 35 percent').toBe('35');
      for (const bad of ['150', '-5']) {
        await c.type(percentKey(STORY), bad);
        expect(c.$('save')?.disabled, `P09.G4 — ${bad} percent disables the save`).toBe(true);
        c.$('save')?.click();
        await c.settle();
      }
      expect(learnPuts(c).length, 'P09.G4 — and nothing is sent').toBe(0);
    } finally { c.close(); }
    const stored = (await loadDocument(m, 'learn')).document as { slots?: Record<string, Record<string, unknown>> };
    expect(stored.slots?.[STORY]?.gamma, 'P09.G4 — the refused drafts changed nothing stored').toBe(0.35);
  }, 90_000);

  it('sdk: on the layout slot opted into the blend the screen shows a stored blend p 0.6 as 60, and γ stays as stored', async () => {
    const m = await mount('session', { pieces: PIECES, slots: SLOTS, learn: learnWith({}, { gamma: 0.2, blend: { p: 0.6 } }) });
    preconditionP02(m, 'P09.G4');
    await preconditionP28(m, 0.6);
    const layout = await openConsole(m, `#/dials?scope=${TENANT}&slot=${LAYOUT}`);
    try {
      expect(layout.control(percentKey(LAYOUT))?.value ?? 'no percentage control', 'P09.G4 — the stored blend p 0.6 shows as 60 percent').toBe('60');
    } finally { layout.close(); }
    const stored = (await loadDocument(m, 'learn')).document as { slots?: Record<string, Record<string, unknown>> };
    expect(stored.slots?.[LAYOUT]?.gamma, 'P09.G4 — reading the screen changed nothing stored').toBe(0.2);
  }, 90_000);
});

// ===========================================================================
// unit:P09.G5 — the slots screen shows each slot's percentage; the kit
// ===========================================================================

describe('unit:P09.G5 (freeze items 23 and 39)', () => {
  const rowOn = async (m: Mounted, slot: string) => {
    const c = await openConsole(m, `#/slots?scope=${TENANT}`);
    try {
      const row = c.all('tr').map(r => (r.textContent ?? '').replace(/\s+/g, ' ')).find(r => r.includes(slot)) ?? '';
      expect(row.includes(slot), `PRECONDITION: the slots screen lists ${slot}`).toBe(true);
      return row;
    } finally { c.close(); }
  };
  it('sdk: the shipped slots screen shows the content slot at γ 0.35 as 35%', async () => {
    const m = await mount('session', { pieces: PIECES, slots: UNDECLARED, retainedSlots: true, learn: learnWith({ gamma: 0.35 }) });
    published(m, 'P09.G5');
    const row = await rowOn(m, STORY);
    expect(/\b35\s?%/.test(row), `P09.G5 — the content slot's row shows its percentage (row: ${row})`).toBe(true);
  }, 90_000);

  it('sdk: the shipped slots screen shows the layout slot in the blend at p 0.6 as 60%', async () => {
    const m = await mount('session', { pieces: PIECES, slots: SLOTS, learn: learnWith({}, { gamma: 0.2, blend: { p: 0.6 } }) });
    preconditionP02(m, 'P09.G5');
    await preconditionP28(m, 0.6);
    const row = await rowOn(m, LAYOUT);
    expect(/\b60\s?%/.test(row), `P09.G5 — the layout slot's row shows its blend percentage (row: ${row})`).toBe(true);
  }, 90_000);

  it('logic: the API reference and the payload schemas each document the performance percentage and its two mappings', () => {
    const sentences = (file: string) => readTree(file).replace(/`/g, '').split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(s => s.replace(/\s+/g, ' ').trim());
    const statements: Array<[string, (s: string) => boolean]> = [
      ['the performance percentage P from 0 to 100, the tuning screen’s form of the stored dial', s => /percent/i.test(s) && /(tuning|dials|console)/i.test(s) && /100/.test(s)],
      ['on a content slot γ = P / 100', s => /(γ|gamma)/i.test(s) && /P ?\/ ?100|percent(age)? ?\/ ?100|divided by 100/i.test(s)],
      ['on a layout slot in the blend p = P / 100', s => /blend/i.test(s) && /\bp\b/.test(s) && /P ?\/ ?100|percent(age)? ?\/ ?100|divided by 100/i.test(s)],
    ];
    const missing = ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']
      .flatMap(file => statements.filter(([, test]) => !sentences(file).some(test)).map(([name]) => `${file}: ${name}`));
    expect(missing, 'P09.G5 — the kit documents the percentage and its two mappings').toEqual([]);
  });
});
