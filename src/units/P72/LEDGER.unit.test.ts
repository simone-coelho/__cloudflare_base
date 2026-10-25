// src/units/P72/LEDGER.unit.test.ts
// P72 under the Closure Ledger: the tests for the LOCAL criteria BD1-BD3 of the P72 work order (the budget-default
// programme of amendment 10, ticket P72 "The witness and ring budgets are 600 ms by default"). LV1 is a deferred live
// row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-10/BTI-Parity-Amendment-2026-10-22.md, section 2, P72):
//   "P72 — the witness and ring budgets are 600 ms by default. `LIFT_WITNESS_BUDGET_MS` and `RING_READ_BUDGET_MS`
//   default to 600 ms (`src/learn/fan.ts`), so that a decision with no override admits `{"lift":600,"ring":600}` on both
//   hosts; the bounded override of P62 is unchanged in form (a value below 5000 ms is admitted and reported, a value at
//   or above it is refused and reported in `sources.budgets.refused`, the default then in force); the decision's
//   `sources.budgets` reports the admitted values as today; P62's locks that pin the number 200 are read as the exported
//   defaults (the R10 of R-P195's form, test-only); the kit sentences that state the budgets (kit 02 :369 and the
//   heartbeat/cost paragraph, kit 03's budget and `sources.budgets` statements, the commented `wrangler.toml` lines)
//   state 600 and why (one edge round trip to a warm statistics object on the platform measured at up to 378 ms; the
//   budget bounds the wait, not the read). Nothing else changes: no path, no door, no record shape."
// The work order (docs/parity/budget-default/program.json, P72), remaining work: "Raise the exported defaults
// LIFT_WITNESS_BUDGET_MS and RING_READ_BUDGET_MS in src/learn/fan.ts from 200 to 600, the override's admission and
// refusal unchanged"; "Read P62's locks that pin the number 200 as the exported defaults, test-only, in the form of
// R-P195"; "State 600 ms and the reason in kit 02 (:369 and the heartbeat/cost paragraph), kit 03 (the budget and
// sources.budgets statements) and the commented wrangler.toml lines". Its decision D1 (R-P236, the owner, 2026-10-22):
// "The default is 600 ms, not 500: the value lanes L14 and L15 proved on the pair, with a buffer over the largest warm
// read measured (478 ms); the bounded override stays for operators."
//
// One `describe('unit:P72.<criterion>')` per LOCAL criterion; the host legs on both shopper hosts through the parity
// harness. Expected values come from the amendment and the work order (600 ms; the ceiling of 5 000 ms,
// src/learn/fan.ts `LEARNING_READ_BUDGET_CEILING_MS`, unchanged), never from what the engine answers today.
//
// THE READINGS THIS FILE RULES:
//   · BD1 "a decision with no override admits {"lift":600,"ring":600}": a decision on the product page (P62's lift world,
//     whose product slot reads the ring) answers `sources.budgets` exactly `{ lift: 600, ring: 600 }`, with no `refused`
//     member; `learningReadBudgets` with no override gives the same; the exported constants read 600 and 600.
//   · BD2 "the bounded override unchanged in form": both variables set to "599" (below the ceiling) are admitted and
//     reported, `{ lift: 599, ring: 599 }`; both set to "5000" (at the ceiling) are refused, the default in force (the
//     exported constants, so the lock holds at today's 200 and at 600) and `refused` names both, sorted. P62's locks that
//     pin 200 are read as the exported defaults in src/units/P62/LEDGER.unit.test.ts (this batch's R10).
//   · BD3 "the kit sentences ... state 600 and why": read by sentence, as P68 KT1 reads the kit. In kit 02, the paragraph
//     that opens "`sources.budgets` is `{ lift, ring }`": its sentence naming the two defaults states 600 ms (and no
//     200 ms), and the paragraph states the reason — 378 ms, the warm round trip measured, and that the budget bounds
//     the wait. In kit 02's heartbeat/cost paragraph ("**The statistics object stays warm.**"): its sentence on the
//     budgets states 600 ms (and no 200 ms). Kit 02's sample answer (:328, `"budgets": { "lift": …, "ring": … }`) shows
//     600 and 600. In kit 03 (R-P239(2)): one sentence beside its `sources` description (the paragraph that says the
//     decision's answer reports each read "in `sources.lift`") names both budgets (`LIFT_WITNESS_BUDGET_MS` and
//     `RING_READ_BUDGET_MS`), states their default of 600 ms (and no 200 ms), the bounded override (below 5 000 ms) and
//     the reason (378 ms); kit 03 holds no budget statement today, so the leg is RED, not vacuous. src/types/env.ts
//     (R-P239(4)): the doc comments of the two `Env` members, read as P68.KT2 reads them, state 600 ms (and no 200 ms).
//     In wrangler.toml: the commented P62 lines state the defaults as 600 (both commented assignments "600"), no 200, and
//     the reason (378 ms).
//
// MEASURED at f88bebeb (71e10fe8 merged; _evidence/parity-step3/S19/specifier/logs/r239/): BD1 RED on both hosts and in logic (200 where
// 600 is expected); BD2 GREEN on both hosts; BD3 RED at kit 02's two sentences and its sample answer, kit 03 (no budget
// sentence), env.ts's two doc comments and wrangler.toml (200).
//
// NEGATIVE CONTROLS (scratch copies, never committed; _evidence/parity-step3/S19/specifier/sketches/): the fix (fan.ts's
// two defaults at 600; kit 02's two sentences and its sample answer, kit 03's new sentence, env.ts's two doc comments and
// the wrangler.toml lines stating 600 and why) turns every P72 unit GREEN, and P62, P68 and P70 stay green under it;
// a fix that raises only the lift budget turns BD1 RED on the ring; a fix that admits 5000 turns BD2 RED.
//
// R10 (expectations a build of P72 changes), applied in this batch, test-only, R-P195's form (read the exported defaults
// instead of 200): src/units/P62/LEDGER.unit.test.ts (P62.LW1), src/units/P68/LEDGER.unit.test.ts (P68.KT3) and
// src/units/P70/LEDGER.unit.test.ts (P70.WB2's remote-call lock), the last two granted under R-P239(1).
//
// S22 R10 (amendment 11 P81; granted R-P271), test-only, R-P195's form: BD3's reason may state 378 ms or, alone, the
// largest 478 ms measured since (R-P243); `WARM_ROUND_TRIP` reads either, every other assertion kept.
//
// No new export is imported; every member read exists at this head.
//
// FIXTURE. P61's and P62's lift world (src/units/_parity9.ts `liftWorld`): P08's pooled world, the product page's slot
// carrying P10's fatigue dial, so a product-page decision reads both the lift witness and the visitor's ring.
//
// HARNESS: src/units/_parity.ts and src/units/_parity9.ts. Imports from src/units/: ../_parity, ../_parity9.

import { describe, expect, it } from 'vitest';

import { LEARNING_READ_BUDGET_CEILING_MS, learningReadBudgets, LIFT_WITNESS_BUDGET_MS, RING_READ_BUDGET_MS } from '@/learn/fan';

import { HOSTS, readTree, type Mounted } from '../_parity';
import { decide, liftWorld, sourcesMember } from '../_parity9';

/** Amendment 10 §2: the default of both budgets. */
const DEFAULT_MS = 600;
/**
 * Amendment 10 §2: the reason the kit states with it (one edge round trip to a warm statistics object, measured).
 * S22 R10 (amendment 11 P81; granted R-P271), test-only, R-P195's form: the measurement may be stated as amendment 10's
 * 378 ms or, alone, as the largest read measured since, 478 ms (R-P243); every other assertion is kept.
 */
const WARM_ROUND_TRIP = /\b(378|478)\s?ms\b/;
const BOTH = ['LIFT_WITNESS_BUDGET_MS', 'RING_READ_BUDGET_MS'];
const setEnv = (m: Mounted, values: Record<string, string>) => { Object.assign(m.env as unknown as Record<string, unknown>, values); };

/** The paragraph of a document that holds `opening`: its lines from there to the next blank line, joined, the code spans' backticks kept. */
function paragraph(file: string, opening: string): { line: number; text: string } {
  const lines = readTree(file).split('\n');
  const start = lines.findIndex(text => text.includes(opening));
  expect(start, `PRECONDITION — ${file} holds the paragraph "${opening}"`).toBeGreaterThanOrEqual(0);
  let first = start, last = start;
  while (first > 0 && lines[first - 1]!.trim() !== '') first--;
  while (last < lines.length - 1 && lines[last + 1]!.trim() !== '') last++;
  return { line: start + 1, text: lines.slice(first, last + 1).join(' ') };
}
/** A text's sentences (split after `.`, `;` or `:` followed by a space and a capital or a code span, as P68 KT1 splits). */
const sentences = (text: string): string[] => text.split(/(?<=[.;])\s+(?=[A-Z`*(])/).map(sentence => sentence.trim()).filter(Boolean);
/** What a sentence says of the default budget: 600 ms, 200 ms (today's), or neither. */
function statesDefault(sentence: string | undefined): string {
  if (sentence === undefined) return 'no such sentence';
  if (/\b200\s?ms\b/.test(sentence)) return `states 200 ms: "${sentence.slice(0, 220)}"`;
  return /\b600\s?ms\b/.test(sentence) ? 'states 600 ms' : `states no default: "${sentence.slice(0, 220)}"`;
}

// ===========================================================================
// unit:P72.BD1 — the defaults admitted as 600/600 with no override
// ===========================================================================

describe('unit:P72.BD1', () => {
  it('logic: src/learn/fan.ts exports LIFT_WITNESS_BUDGET_MS and RING_READ_BUDGET_MS at 600 ms, and with no override learningReadBudgets admits { lift: 600, ring: 600 } and names nothing refused', () => {
    expect.soft({ LIFT_WITNESS_BUDGET_MS, RING_READ_BUDGET_MS }, 'P72.BD1 — the exported defaults are 600 ms each (amendment 10 §2)')
      .toEqual({ LIFT_WITNESS_BUDGET_MS: DEFAULT_MS, RING_READ_BUDGET_MS: DEFAULT_MS });
    expect.soft(learningReadBudgets({}), 'P72.BD1 — with no override the defaults are admitted, 600 and 600, nothing refused').toEqual({ lift: DEFAULT_MS, ring: DEFAULT_MS });
  });

  for (const host of HOSTS) {
    it(`host (${host}): a decision made with no budget override admits and reports sources.budgets { lift: 600, ring: 600 } with no refused member`, async () => {
      const { m } = await liftWorld(host);
      const decided = await decide(m, 'pdp', { ack: false });
      expect.soft(sourcesMember(decided.snapshot, 'budgets'), `${host}: P72.BD1 — the decision ran under the 600 ms defaults and reports them`)
        .toEqual({ lift: DEFAULT_MS, ring: DEFAULT_MS });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P72.BD2 — the bounded override unchanged in form
// ===========================================================================

describe('unit:P72.BD2', () => {
  it(`logic: LOCK — the override's bound is unchanged: "599" (below the ${LEARNING_READ_BUDGET_CEILING_MS} ms ceiling) is admitted for both, "5000" (at it) refused for both with the exported defaults in force and both named, sorted`, () => {
    expect.soft(LEARNING_READ_BUDGET_CEILING_MS, 'P72.BD2 — the ceiling is unchanged (5 000 ms, the SDK\'s deadline)').toBe(5_000);
    expect.soft([learningReadBudgets({ LIFT_WITNESS_BUDGET_MS: '599', RING_READ_BUDGET_MS: '599' }), learningReadBudgets({ LIFT_WITNESS_BUDGET_MS: '5000', RING_READ_BUDGET_MS: '5000' })],
      'P72.BD2 — 599 admitted; 5000 refused, the defaults in force, both named')
      .toEqual([{ lift: 599, ring: 599 }, { lift: LIFT_WITNESS_BUDGET_MS, ring: RING_READ_BUDGET_MS, refused: BOTH }]);
  });

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — an override of 599 (both variables) is admitted and reported in sources.budgets; an override of 5000 is refused, the defaults in force and sources.budgets.refused naming both`, async () => {
      const { m } = await liftWorld(host);
      setEnv(m, { LIFT_WITNESS_BUDGET_MS: '599', RING_READ_BUDGET_MS: '599' });
      const admitted = await decide(m, 'pdp', { ack: false });
      setEnv(m, { LIFT_WITNESS_BUDGET_MS: '5000', RING_READ_BUDGET_MS: '5000' });
      const refused = await decide(m, 'pdp', { shopper: admitted.shopper, ack: false });
      expect.soft([sourcesMember(admitted.snapshot, 'budgets'), sourcesMember(refused.snapshot, 'budgets')],
        `${host}: P72.BD2 — 599 admitted and reported; 5000 refused, the defaults in force and both named`)
        .toEqual([{ lift: 599, ring: 599 }, { lift: LIFT_WITNESS_BUDGET_MS, ring: RING_READ_BUDGET_MS, refused: BOTH }]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P72.BD3 — the kit and wrangler.toml state 600 ms and why
// ===========================================================================

describe('unit:P72.BD3', () => {
  it('logic: kit 02\'s sources.budgets paragraph (:369) states the defaults as 600 ms and the reason (one edge round trip to a warm statistics object measured at up to 378 ms; the budget bounds the wait, not the read)', () => {
    const { text, line } = paragraph('docs/kit/02-api-reference.md', '`sources.budgets` is `{ lift, ring }`');
    const said = sentences(text);
    const defaults = said.find(sentence => sentence.includes('`sources.budgets` is') && sentence.includes('LIFT_WITNESS_BUDGET_MS'));
    const reason = said.some(sentence => WARM_ROUND_TRIP.test(sentence)) && said.some(sentence => /\bwait\b/i.test(sentence) && /budget/i.test(sentence));
    expect.soft([statesDefault(defaults), reason ? 'states the reason' : 'states no reason (378 ms, the budget bounds the wait)'],
      `P72.BD3 — kit 02 :${line} states the 600 ms defaults and why`).toEqual(['states 600 ms', 'states the reason']);
  });

  it('logic: kit 02\'s heartbeat and cost paragraph ("The statistics object stays warm") states the budgets as 600 ms each by default', () => {
    const { text, line } = paragraph('docs/kit/02-api-reference.md', '**The statistics object stays warm.**');
    const budgets = sentences(text).find(sentence => /\bbudgets\b/i.test(sentence) && /by default/i.test(sentence));
    expect.soft(statesDefault(budgets), `P72.BD3 — kit 02 :${line}'s budget sentence states 600 ms`).toBe('states 600 ms');
  });

  it('logic: kit 03 carries, in the paragraph of its sources description, one sentence naming both budgets (LIFT_WITNESS_BUDGET_MS and RING_READ_BUDGET_MS) that states their default of 600 ms, the bounded override (below 5 000 ms) and the reason (378 ms), and no kit 03 sentence states 200 ms for them', () => {
    const { text, line } = paragraph('docs/kit/03-payload-schemas.md', 'in `sources.lift` (`served`');
    // One sentence, read up to its full stop (a semicolon inside it does not end it).
    const both = text.split(/(?<=\.)\s+(?=[A-Z`*(])/).map(sentence => sentence.trim())
      .filter(sentence => sentence.includes('LIFT_WITNESS_BUDGET_MS') && sentence.includes('RING_READ_BUDGET_MS'));
    const states = (sentence: string) => [statesDefault(sentence), /overrid/i.test(sentence) && /\b5[\s,]?000\b/.test(sentence) ? 'the bounded override' : 'no bounded override',
      WARM_ROUND_TRIP.test(sentence) ? 'the reason' : 'no reason (378 ms)'];
    const found = both.find(sentence => states(sentence).join() === 'states 600 ms,the bounded override,the reason') ?? both[0];
    expect.soft(found === undefined ? ['no sentence names both budgets beside the sources description'] : states(found),
      `P72.BD3 — kit 03 :${line}'s sources paragraph states the budgets' 600 ms default, the bounded override and why (R-P239)`)
      .toEqual(['states 600 ms', 'the bounded override', 'the reason']);
    const anywhere = sentences(readTree('docs/kit/03-payload-schemas.md').split('\n').join(' '))
      .filter(sentence => /sources\.budgets|LIFT_WITNESS_BUDGET_MS|RING_READ_BUDGET_MS/.test(sentence) && /\b200\s?ms\b/.test(sentence));
    expect.soft(anywhere.map(sentence => sentence.slice(0, 160)), 'P72.BD3 — no kit 03 sentence states a 200 ms budget').toEqual([]);
  });

  it('logic: kit 02\'s sample decision answer (:328) shows sources.budgets as { "lift": 600, "ring": 600 }', () => {
    const samples = readTree('docs/kit/02-api-reference.md').split('\n').map((text, index) => ({ text, line: index + 1 })).filter(({ text }) => text.includes('"budgets": {'));
    expect(samples.length, 'PRECONDITION — kit 02 carries a sample answer with sources.budgets').toBeGreaterThan(0);
    expect.soft(samples.map(({ text, line }) => {
      const budgets = /"budgets": \{ "lift": (\d+), "ring": (\d+)/.exec(text);
      return budgets ? { line, lift: Number(budgets[1]), ring: Number(budgets[2]) } : { line, lift: 'unread', ring: 'unread' };
    }), 'P72.BD3 — the sample answer shows the 600 ms defaults (R-P239(3))').toEqual(samples.map(({ line }) => ({ line, lift: DEFAULT_MS, ring: DEFAULT_MS })));
  });

  it('logic: src/types/env.ts\'s doc comments of LIFT_WITNESS_BUDGET_MS and RING_READ_BUDGET_MS (read as P68.KT2 reads them) state the code default as 600 ms', () => {
    const env = readTree('src/types/env.ts');
    const docOf = (name: string): string | undefined => {
      const at = env.search(new RegExp(`\\n\\s*${name}\\?\\s*:`));
      if (at < 0) return undefined;
      const before = env.slice(0, at), open = before.lastIndexOf('/**'), close = before.lastIndexOf('*/');
      return open >= 0 && close > open && before.slice(close + 2).trim() === '' ? before.slice(open, close + 2).replace(/\s*\n\s*\*\s?/g, ' ') : undefined;
    };
    expect.soft(BOTH.map(name => [name, statesDefault(docOf(name))]), 'P72.BD3 — env.ts states the 600 ms code defaults (R-P239(4))')
      .toEqual(BOTH.map(name => [name, 'states 600 ms']));
  });

  it('logic: the commented wrangler.toml lines of P62\'s budgets state the defaults as 600 (both commented assignments "600") and the reason, and no 200', () => {
    const lines = readTree('wrangler.toml').split('\n');
    const start = lines.findIndex(text => text.startsWith('# P62: the lift witness and ring read budgets'));
    const end = lines.findIndex((text, index) => index > start && text.startsWith('# RING_READ_BUDGET_MS'));
    expect([start >= 0, end > start], 'PRECONDITION — wrangler.toml holds P62\'s commented budget lines').toEqual([true, true]);
    const block = lines.slice(start, end + 1).join('\n');
    expect.soft([/\b200\b/.test(block) ? `states 200: ${JSON.stringify(lines.slice(start, end + 1).filter(text => /\b200\b/.test(text)))}` : 'no 200',
      /#\s*LIFT_WITNESS_BUDGET_MS = "600"/.test(block) && /#\s*RING_READ_BUDGET_MS = "600"/.test(block) ? 'both commented assignments 600' : 'the commented assignments are not 600',
      WARM_ROUND_TRIP.test(block) ? 'states the reason' : 'states no reason (378 ms)'],
    'P72.BD3 — wrangler.toml\'s commented budget lines state 600 and why').toEqual(['no 200', 'both commented assignments 600', 'states the reason']);
  });

  it('CONTROL: the sentence reading names 200, 600 and their absence', () => {
    expect([statesDefault('by default 200 ms each'), statesDefault('by default 600 ms each'), statesDefault('by default each'), statesDefault(undefined)])
      .toEqual([expect.stringMatching(/^states 200 ms/), 'states 600 ms', expect.stringMatching(/^states no default/), 'no such sentence']);
    expect(sentences('The budgets are unchanged by it: 200 ms each by default. `sources.budgets` is next; A third.'), 'CONTROL — sentences split after a full stop or a semicolon')
      .toEqual(['The budgets are unchanged by it: 200 ms each by default.', '`sources.budgets` is next;', 'A third.']);
  });
});
