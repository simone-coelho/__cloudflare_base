// src/units/P68/LEDGER.unit.test.ts
// P68 under the Closure Ledger: the tests for the LOCAL criteria KT1-KT3 of the P68 work
// order (the order-memory programme of amendment 8, ticket P68 "The kit's citations land and
// the override variables are typed"). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-8/BTI-Parity-Amendment-2026-10-20b.md, section 2, P68):
//   "P68 — the kit's citations and the override types. Every citation in kit 02's
//   render-acknowledgement paragraph (:933) and in the alarm-publication sentences (kit 02
//   :1171, kit 03 :1474-1488) lands on the construct it names at the artifact, checked by a
//   unit that reads the kit and the source (RED today for the drifted ones); kit 02 :1171 says
//   what a skipped alarm still writes; the override variables are declared in
//   `src/types/env.ts` with the bounded-override semantics P62 gave them (a type-level unit);
//   no served behaviour changes (the kit-reading tests and every unit of amendments 5–7
//   unchanged)."
// The work order (docs/parity/order-memory/program.json, P68), remaining work: "Correct the
// twelve drifted citations and the :1171 sentence; declare the two override variables in
// src/types/env.ts."
//
// One `describe('unit:P68.<criterion>')` per LOCAL criterion (logic legs: the kit, the source and
// the types are read from the tree this file lives in, never the working directory).
//
// THE READINGS THIS FILE RULES:
//   · KT1, "lands on the construct it names": each citation of the three passages is paired, in
//     the order the passage gives them, with the construct the passage's own words name for it
//     (an identifier, a class, a member, a message or a constant, read from the sentence that
//     carries the citation; the table `RENDER_ACK`, `ALARM_PUBLICATION_02` and
//     `ALARM_PUBLICATION_03` below, each entry naming the words it is derived from); a citation
//     `path:line` or `path:from-to` (or `:line` continuing the last path named) lands when the
//     cited lines of that file at the artifact contain every pattern of its construct. The
//     passages are found by their opening words, not by their line numbers, so a corrected
//     passage is read where it then stands.
//     MEASURED TODAY at 8d07696f (_evidence/parity-step3/S16/specifier/logs/): of the twelve
//     citations the P63 build reported drifted (_evidence/parity-step3/P63/implementer/REPORT.md
//     "More drifted citations", at f1073dad), eleven were corrected by the P64 and P65 builds'
//     kit edits; ONE still drifts: `src/durable-objects/ShopperReflex.ts:537` (the object's typed
//     409 for a conflicting acknowledgement, now at :553). Every citation of kit 02 :1171 and kit
//     03 :1474-1488 lands. RED today for that one, and for the :1171 sentence below.
//   · KT1, "kit 02 :1171 says what a skipped alarm still writes": the passage says a skipped
//     alarm "allocates, archives and writes nothing", where it still writes the placement's
//     `learn` state when learning-effect markers expire (the P63 delivery review, finding 4); the
//     passage states that the skipped alarm still writes its `learn` state (a sentence naming
//     `learn` and that it still writes it). RED today.
//   · KT2, "declared ... with the bounded-override semantics P62 gave them (a type-level unit)":
//     `src/types/env.ts`'s `Env` declares `LIFT_WITNESS_BUDGET_MS` and `RING_READ_BUDGET_MS`,
//     each an OPTIONAL member of type exactly `string` (a deployment variable), checked by the
//     TypeScript compiler this test runs over a probe module importing `Env` (an exact type
//     equality and an optionality check: a missing member, another type or a required member is
//     a compile error the test reads); and each member's doc comment states P62's semantics
//     (src/learn/fan.ts `learningReadBudgets`): a whole number of milliseconds above 0 and below
//     the ceiling (5 000 ms, `LEARNING_READ_BUDGET_CEILING_MS`), any other value refused with the
//     default kept. RED today: neither member is declared.
//   · KT3 LOCKS, green at specification: the kit's line counts are kept (kit 02 2358 lines, kit 03
//     1980), so every `kit 0x :line` reference elsewhere keeps landing; P62's override semantics
//     are unchanged (`learningReadBudgets` admits a whole number of ms in (0, 5000) given as text
//     or number, refuses anything else naming it, and keeps the default); the kit-reading tests
//     (every test file that reads `docs/kit/`: at 8d07696f 106 files under src/, among them the units of
//     P33, P42, P58, P61-P66 and src/content/*.test.ts) and every unit of amendments 5-7 unchanged:
//     their own commands, in the gate.
//
// SKETCH (a scratch copy of 8d07696f, never committed; _evidence/parity-step3/S16/specifier/sketches/sketch-p68.py):
// the drifted citation corrected (:537 → :553), kit 02 :1171 saying the skipped alarm "still writes only its `learn`
// state when learning-effect markers expire", the two members declared in src/types/env.ts with their doc comments:
// every P68 unit GREEN, the kit's line counts unchanged.
//
// No new export is imported; every member read exists at this head (`Env` is read as a type by
// the compiler, never imported at run time).
//
// HARNESS: src/units/_parity.ts (`readTree`). Imports from src/units/: ../_parity.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { learningReadBudgets } from '@/learn/fan';

import { readTree } from '../_parity';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
type Construct = { says: string; patterns: RegExp[] };

/**
 * Kit 02's render-acknowledgement paragraph (:933 today), its citations in order, each with the construct the sentence
 * carrying it names (`says`: the passage's own words), as the patterns the cited lines must contain.
 */
const RENDER_ACK: Construct[] = [
  { says: 'answers at durable admission: the render\'s source admission committed and the recovery alarm armed', patterns: [/armRecovery/, /answerAtAdmission/] },
  { says: 'the render acknowledgement\'s own admission answers at admission', patterns: [/answerAtAdmission: true/] },
  { says: 'the same request\'s behaviour capture answers at admission (`behavior.receipt.source.state` pending)', patterns: [/answerAtAdmission: true/] },
  { says: 'the queue send, ledger write and fan-out follow right after the answer, inside the shopper\'s own serializer', patterns: [/continueAfterOwnerAnswer/] },
  { says: 'ahead of any later request from the same shopper (the owner\'s continuation)', patterns: [/function continueAfterOwnerAnswer/] },
  { says: 'the alarm armed at admission resumes them at most 30 seconds later', patterns: [/30_000/, /setAlarm/] },
  { says: 'the alarm resumes them', patterns: [/resumeOwnerRecovery\(/] },
  { says: 'a client time ahead of the engine is admitted at the engine\'s present', patterns: [/Math\.min\(validatedEvent\.timestamp/] },
  { says: 'read from the decision\'s stored admission in the shopper\'s own object', patterns: [/function storedRenderOf/] },
  { says: 'the re-send is admitted at the time its first delivery was admitted at', patterns: [/admittedRender\(/, /admitted\.at/] },
  { says: 'the re-send\'s behaviour record is the first delivery\'s (the admitted time carried)', patterns: [/redeemed\.at/] },
  { says: 'an acknowledgement under another eventId is a conflict', patterns: [/AcknowledgementConflictError/] },
  { says: 'the conflict\'s answer: `Render acknowledgement conflict: … another event id`', patterns: [/class AcknowledgementConflictError/, /another event id/] },
  { says: 'answers HTTP 409 (the owner\'s typed refusal)', patterns: [/AcknowledgementConflictError/, /409/] },
  { says: 'answers HTTP 409 (the shopper object\'s typed refusal)', patterns: [/AcknowledgementConflictError/, /409/] },
  { says: 'the route\'s own `500 {error:\'Failed to process action event\', details}`', patterns: [/Failed to process action event/] },
  { says: 'which the owner does not replace with another error once the route has answered', patterns: [/answeredFailure/] },
  { says: 'the SDK waits `ACK_DEADLINE_MS` (5 s)', patterns: [/ACK_DEADLINE_MS = 5000/] },
  { says: 'and cuts the request there', patterns: [/ACK_DEADLINE_MS/, /abort/] },
  { says: 'an acknowledgement it cut, it sends once more by itself; an answered one is not re-sent', patterns: [/RequestDeadline/] },
  { says: 'a later `rendered()` sends that same envelope again', patterns: [/envelope\(/] },
  { says: 'at most three such attempts per placement', patterns: [/attempts < 3/] },
  { says: 'a retry answered pending or recovered arms the placement as a first answer does', patterns: [/\.ack = ack/] },
  { says: 'a placement whose retry is cut too sends none of them', patterns: [/!ack/] },
  { says: 'correlated clicks, the dwell and the viewable impression follow that exact ACK', patterns: [/paint\?\.ack/] },
  { says: 'they follow that exact ACK, the retry\'s included', patterns: [/paint\.ack \?\? await paint\.pending/] },
];
/** Kit 02's alarm-publication sentences (:1171 today). */
const ALARM_PUBLICATION_02: Construct[] = [
  { says: 'the object\'s own alarm publishes only a change', patterns: [/unchangedSince/] },
  { says: 'what the last successful publication was built from (documents, fence, pooled counters)', patterns: [/publicationBasis/, /pooled/] },
  { says: 'the serving key holds that publication\'s copy, and no stale or republished member is in force', patterns: [/function unchangedSince|private async unchangedSince/, /recoveryDigest\(head\)/] },
];
/** Kit 03's alarm-publication passage (:1474-1488 today). */
const ALARM_PUBLICATION_03: Construct[] = [
  { says: 'within 30 seconds of new evidence (its alarm)', patterns: [/publish\(false, true\)/] },
  { says: 'an alarm that finds nothing changed publishes nothing', patterns: [/unchangedSince/] },
  { says: 'what that publication was built from (documents, fence, pooled counters)', patterns: [/publicationBasis/, /pooled/] },
  { says: 'recorded with the publication before its copy is written', patterns: [/learnPublished/, /CACHE\.put/] },
  { says: 'when the copy the serving key holds is not the last publication', patterns: [/unchangedSince/, /recoveryDigest\(head\)/] },
];

/** The passage of a kit file that opens with `opening`, and the citations it carries in order (a `:line` continues the last path). */
function passage(file: string, opening: string, through?: string): { line: number; text: string; citations: Array<{ path: string; from: number; to: number; cited: string }> } {
  const lines = readTree(file).split('\n');
  const start = lines.findIndex(text => text.includes(opening));
  expect(start, `PRECONDITION — ${file} carries the passage opening "${opening}"`).toBeGreaterThanOrEqual(0);
  const end = through ? lines.findIndex((text, index) => index >= start && text.includes(through)) : start;
  const text = lines.slice(start, end + 1).join('\n');
  const citations: Array<{ path: string; from: number; to: number; cited: string }> = [];
  let path = '';
  for (const match of text.matchAll(/`((?:src\/[A-Za-z0-9_./-]+\.(?:ts|mjs|js))?):(\d+)(?:-(\d+))?`/g)) {
    if (match[1]) path = match[1];
    if (!path) continue;
    citations.push({ path, from: Number(match[2]), to: Number(match[3] ?? match[2]), cited: `${path}:${match[2]}${match[3] ? `-${match[3]}` : ''}` });
  }
  return { line: start + 1, text, citations };
}
/** The citations whose cited lines do not contain every pattern of the construct they are paired with. */
function drifted(citations: ReturnType<typeof passage>['citations'], constructs: Construct[]): string[] {
  return citations.map((citation, index) => {
    const construct = constructs[index];
    if (!construct) return `${citation.cited}: no construct named for it`;
    const cited = readFileSync(`${ROOT}${citation.path}`, 'utf8').split('\n').slice(citation.from - 1, citation.to).join('\n');
    const missing = construct.patterns.filter(pattern => !pattern.test(cited));
    return missing.length ? `${citation.cited} does not land on "${construct.says}" (missing ${missing.map(String).join(', ')})` : '';
  }).filter(Boolean);
}

// ===========================================================================
// unit:P68.KT1 — every citation lands on its construct; kit 02 :1171 says what a skipped alarm still writes
// ===========================================================================

describe('unit:P68.KT1', () => {
  it('logic: every citation of kit 02\'s render-acknowledgement paragraph lands on the construct its sentence names', () => {
    const found = passage('docs/kit/02-api-reference.md', 'With explicit `rendered-v1` slot measurement');
    expect(found.citations.length, `PRECONDITION — the paragraph (kit 02 :${found.line}) carries the ${RENDER_ACK.length} citations the table pairs`).toBe(RENDER_ACK.length);
    expect.soft(drifted(found.citations, RENDER_ACK), `P68.KT1 — kit 02 :${found.line}: every citation lands on its construct`).toEqual([]);
  });

  it('logic: every citation of kit 02\'s alarm-publication sentences and of kit 03\'s alarm-publication passage lands on the construct it names', () => {
    const kit02 = passage('docs/kit/02-api-reference.md', 'The upgraded statistics publisher freezes estimates/time');
    const kit03 = passage('docs/kit/03-payload-schemas.md', 'The slot\'s statistics object publishes a new version within 30 seconds', 'expired learning-effect markers changes no snapshot');
    expect([kit02.citations.length, kit03.citations.length], `PRECONDITION — kit 02 :${kit02.line} and kit 03 :${kit03.line} carry the citations the tables pair`)
      .toEqual([ALARM_PUBLICATION_02.length, ALARM_PUBLICATION_03.length]);
    expect.soft([...drifted(kit02.citations, ALARM_PUBLICATION_02), ...drifted(kit03.citations, ALARM_PUBLICATION_03)], 'P68.KT1 — every alarm-publication citation lands on its construct').toEqual([]);
  });

  it('logic: kit 02\'s alarm-publication sentences say what a skipped alarm still writes: its `learn` state (the expired learning-effect markers\' commit)', () => {
    const { text, line } = passage('docs/kit/02-api-reference.md', 'The upgraded statistics publisher freezes estimates/time');
    const sentences = text.replace(/`/g, '').split(/(?<=[.;])\s+/);
    const says = sentences.some(sentence => /\blearn\b/.test(sentence) && /still writes?|writes only/i.test(sentence));
    expect(says ? 'states what a skipped alarm still writes' : `kit 02 :${line} states no write of a skipped alarm (it says: "${(sentences.find(s => /writes nothing/.test(s)) ?? '').slice(-160)}")`,
      'P68.KT1 — kit 02 :1171 says a skipped alarm still writes its learn state').toBe('states what a skipped alarm still writes');
  });

  it('CONTROL: the reading finds a drifted citation, pairs continuations with the last path, and accepts a landing one', () => {
    const cited = (path: string, from: number, to = from) => ({ path, from, to, cited: `${path}:${from}` });
    expect(drifted([cited('src/sdk/core.ts', 1)], [{ says: 'the deadline', patterns: [/ACK_DEADLINE_MS = 5000/] }]), 'CONTROL — a citation off its construct is named').toHaveLength(1);
    const line = readFileSync(`${ROOT}src/sdk/core.ts`, 'utf8').split('\n').findIndex(text => /ACK_DEADLINE_MS = 5000/.test(text)) + 1;
    expect(drifted([cited('src/sdk/core.ts', line)], [{ says: 'the deadline', patterns: [/ACK_DEADLINE_MS = 5000/] }]), 'CONTROL — a citation on its construct lands').toEqual([]);
    const found = passage('docs/kit/02-api-reference.md', 'With explicit `rendered-v1` slot measurement');
    expect(found.citations.filter(c => c.cited.startsWith('src/sdk/listen.ts')).length, 'CONTROL — continuation citations carry the last path named').toBeGreaterThan(2);
  });
});

// ===========================================================================
// unit:P68.KT2 — the override variables are declared, typed and documented
// ===========================================================================

/** The compiler's diagnostics for a probe module beside src/types/env.ts (the type-level check vitest runs). */
function typeCheck(probe: string): string[] {
  const probeFile = `${ROOT}src/types/__p68_probe__.ts`;
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, types: [] };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), source = host.getSourceFile.bind(host);
  host.readFile = name => (name === probeFile ? probe : read(name));
  host.fileExists = name => name === probeFile || exists(name);
  host.getSourceFile = (name, language) => (name === probeFile ? ts.createSourceFile(name, probe, language) : source(name, language));
  const program = ts.createProgram([probeFile], options, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(probeFile)).map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}
const PROBE = (name: string) => `import type { Env } from './env';
type Exact<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
export const declared: '${name}' extends keyof Env ? true : false = true;
export const optional: {} extends Pick<Env, Extract<'${name}', keyof Env>> ? true : false = true;
export const typed: Exact<Env[Extract<'${name}', keyof Env>], string | undefined> = true;
`;
/** The doc comment of an `Env` member in src/types/env.ts, or a sentence. */
function docOf(name: string): string {
  const text = readTree('src/types/env.ts');
  const at = text.search(new RegExp(`\\n\\s*${name}\\?\\s*:`));
  if (at < 0) return `no ${name} member`;
  const before = text.slice(0, at);
  const open = before.lastIndexOf('/**'), close = before.lastIndexOf('*/');
  return open >= 0 && close > open && before.slice(close + 2).trim() === '' ? before.slice(open, close + 2) : `no doc comment on ${name}`;
}

describe('unit:P68.KT2', () => {
  for (const name of ['LIFT_WITNESS_BUDGET_MS', 'RING_READ_BUDGET_MS'] as const) {
    it(`logic (type-level): src/types/env.ts declares ${name} as an optional string member of Env, and its doc comment states P62's bounded override: a whole number of milliseconds above 0 and below the 5 000 ms ceiling, any other value refused with the default kept`, () => {
      expect.soft(typeCheck(PROBE(name)), `P68.KT2 — the compiler finds ${name} declared on Env, optional, of type string`).toEqual([]);
      const doc = docOf(name);
      expect.soft([/whole/i.test(doc), /milliseconds|\bms\b/i.test(doc), /5\s?000|LEARNING_READ_BUDGET_CEILING_MS/.test(doc), /refus/i.test(doc), /default/i.test(doc)],
        `P68.KT2 — ${name}'s doc comment states the bounded override (${doc.slice(0, 160)})`).toEqual([true, true, true, true, true]);
    });
  }

  it('CONTROL: the type-level check has teeth — a member Env does not declare, or a required or non-string one, is a compile error the test reads', () => {
    expect(typeCheck(PROBE('P68_NOT_A_MEMBER')).length, 'CONTROL — an undeclared member').toBeGreaterThan(0);
    expect(typeCheck(PROBE('CACHE')).length, 'CONTROL — a required, non-string member').toBeGreaterThan(0);
    expect(typeCheck(PROBE('SHOT_TOKEN')), 'CONTROL — an optional string member (SHOT_TOKEN) passes').toEqual([]);
  });
});

// ===========================================================================
// unit:P68.KT3 — locks: the kit's line counts, P62's override semantics
// ===========================================================================

describe('unit:P68.KT3', () => {
  it('logic: LOCK — the kit\'s line counts are kept (kit 02 2358 lines, kit 03 1980), so every `kit :line` reference elsewhere keeps landing', () => {
    expect([readTree('docs/kit/02-api-reference.md').split('\n').length - 1, readTree('docs/kit/03-payload-schemas.md').split('\n').length - 1],
      'P68.KT3 — the line counts of kit 02 and kit 03').toEqual([2358, 1980]);
  });

  it('logic: LOCK — P62\'s override semantics are unchanged: a whole number of milliseconds above 0 and below 5 000, as text or number, is admitted; anything else is refused, named and the default kept; unset names nothing', () => {
    expect.soft(learningReadBudgets({}), 'P68.KT3 — unset: the defaults, nothing named').toEqual({ lift: 200, ring: 200 });
    expect.soft(learningReadBudgets({ LIFT_WITNESS_BUDGET_MS: '150', RING_READ_BUDGET_MS: 4999 }), 'P68.KT3 — admitted values').toEqual({ lift: 150, ring: 4999 });
    expect.soft(learningReadBudgets({ LIFT_WITNESS_BUDGET_MS: '0', RING_READ_BUDGET_MS: '5000' }), 'P68.KT3 — the bounds are refused, named, defaults kept')
      .toEqual({ lift: 200, ring: 200, refused: ['LIFT_WITNESS_BUDGET_MS', 'RING_READ_BUDGET_MS'] });
    expect.soft(learningReadBudgets({ LIFT_WITNESS_BUDGET_MS: '1.5', RING_READ_BUDGET_MS: 'abc' }), 'P68.KT3 — a fraction or a word is refused')
      .toEqual({ lift: 200, ring: 200, refused: ['LIFT_WITNESS_BUDGET_MS', 'RING_READ_BUDGET_MS'] });
  });
});
