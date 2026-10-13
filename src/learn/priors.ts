// src/learn/priors.ts
// Doc 22 §8, imported priors. A prior is pseudo-counts: for one slot, item and
// cell key, a rate p_prior and a strength n_equiv. The snapshot builder uses
// them as p₀ and n₀ for that key until live evidence outweighs them, a level
// with a prior counts the prior's strength toward the evidence threshold (that
// is what importing one means), and every receipt names the prior document's
// revision. The document is versioned like every other tuning document. It
// arrives as JSON rows or as CSV with the same five columns, which is what a
// warehouse exports.

import type { DocumentKind, ValidationResult } from '@/config/versionedStore';
import { parseCsv } from '@/content/import';
import type { Cell } from '@/content/types';
import { levelKeys } from '@/learn/stats';
import { ENTRY_CHANNELS, type ContextVocabulary } from '@/services/visit';

export interface PriorRow { slot: string; item: string; cell: string; p_prior: number; n_equiv: number; measurementBasis?: import('@/content/types').MeasurementBasis }
/** What a document says about the grammar its cells were written in. */
export interface DeclaredCellGrammar { name: string; version: number; order: string[] }
export interface PriorsDoc { version?: string; cellGrammar?: DeclaredCellGrammar; rows: PriorRow[] }
export const EMPTY_PRIORS: PriorsDoc = { version: 'prior-empty', rows: [] };

/**
 * W25 G1.01 (F20 §4.7, doc 22 §5.4): the cell grammar IS the ladder grammar.
 *
 * A prior's cell is either `*` or a PREFIX of the ladder key order the snapshot
 * materializes (`levelKeys`, `src/learn/stats.ts`), pair by pair. Anything else
 * — the pairs in another order, a key the ladder does not have, a level skipped,
 * a level past the end — names a key no snapshot will ever build, so importing
 * it used to be a silent no-op: the document was accepted, the operator was told
 * `ok`, and the prior reached nothing.
 *
 * The order is VERSIONED because it has already changed once (CW29 inserted the
 * journey stage `s=` between the visit bucket and the region), and a file
 * exported under the older order is a different file even where its key letters
 * coincide. A document may DECLARE the grammar it was exported under; declaring
 * anything but the current one is refused with `migration` named, rather than
 * being read as if the letters meant the same thing. Declaring nothing means the
 * current grammar, so every document written before this member existed, and
 * every warehouse CSV, is still read exactly as it was.
 */
export interface CellGrammar {
  /** The grammar's name, so a document says which grammar and not only which revision. */
  name: string;
  /** Bumped whenever the ladder order changes. */
  version: number;
  /** The ladder's key letters, coarsest first. */
  order: readonly string[];
  /** What a file exported under another grammar has to do; named in every refusal. */
  migration: string;
}

/**
 * W25 R2 (LANE-LOG R183): the ladder's key letters, READ OFF the ladder itself.
 *
 * The finest key `levelKeys` materializes names every level, coarsest first, as
 * `key=value` pairs joined by `|`; its keys, in that order, are the grammar's
 * order. Written out a second time here, a reorder of the ladder would leave the
 * import door accepting the old order — cells no snapshot builds, the very
 * silent no-op G1.01 closed — and only a test would notice. Derived, the grammar
 * and what the door accepts and refuses follow the ladder. The cell it is read
 * from is the unplaced shopper, whose values are the ladder's own defaults and
 * contain neither `|` nor `=`.
 */
function ladderOrder(): readonly string[] {
  const unplaced: Cell = { channel: 'unknown', visit_bucket: 'unknown', stage: 'unknown', region: null, affinity: null };
  const finest = levelKeys(unplaced).at(-1) ?? '';
  return Object.freeze(finest.split('|').map((pair) => pair.slice(0, pair.indexOf('='))));
}

export const CELL_GRAMMAR: CellGrammar = {
  name: 'ladder-cell',
  // 1 was the pre-CW29 ladder (`c=`, `v=`, `r=`, `a=`); 2 carries the journey stage.
  // A document declaring this version with another order is still refused:
  // `grammarError` compares the declared order with this derived one, pair by pair.
  version: 2,
  order: ladderOrder(),
  migration: 're-export the prior file with every cell written as `*` or a prefix of the current ladder order, then import it again',
};

/** `c=, v=, s=, r=, a=` — the order as a refusal can print it. */
const orderWords = (order: readonly string[]): string => order.map((k) => `${k}=`).join(', ');

/** FNV-1a, 32 bits: a stable number derived from a string, the same on every host and every run. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}

/**
 * P36 (R-P46, R-P51, R-P52): the cell grammar of a tenant's published context
 * vocabulary. W25: the grammar is versioned because a file exported under
 * another one names cells that mean something else; a vocabulary changes what a
 * cell means exactly when it changes the channel values (compared as a set,
 * without regard to order), the visit-bucket cut or the ladder depth. So:
 *   · a tenant without the settings, or one whose settings change none of the
 *     three (today's six words, the cut [1, 2, 4], depth 5), reads CELL_GRAMMAR
 *     unchanged (`ladder-cell` version 2, c, v, s, r, a);
 *   · any other setting reads `ladder-cell` at a version DERIVED from those
 *     three members (3 plus a 32-bit FNV-1a of their canonical form, so it is
 *     never 1 or 2 and is the same wherever it is computed), its order today's
 *     order cut at the depth (R-P51: the order itself is not a setting).
 * The refusal of a file declaring any other grammar keeps W25's sentence, which
 * names the grammar in force and the re-export.
 */
export function cellGrammarFor(vocabulary: ContextVocabulary | null | undefined): CellGrammar {
  if (!vocabulary) return CELL_GRAMMAR;
  const channels = [...new Set(vocabulary.channels.map((c) => c.id))].sort();
  const cut = Array.isArray(vocabulary.visitBuckets) && vocabulary.visitBuckets.length ? [...vocabulary.visitBuckets] : [1, 2, 4];
  const depth = vocabulary.ladder?.depth ?? CELL_GRAMMAR.order.length;
  const today = [...ENTRY_CHANNELS].sort();
  if (channels.length === today.length && channels.every((c, i) => c === today[i]) && cut.join(',') === '1,2,4' && depth === CELL_GRAMMAR.order.length) return CELL_GRAMMAR;
  return {
    name: CELL_GRAMMAR.name,
    version: 3 + fnv1a(JSON.stringify({ channels, cut, depth })),
    order: Object.freeze(CELL_GRAMMAR.order.slice(0, Math.max(1, Math.min(CELL_GRAMMAR.order.length, depth)))),
    migration: 're-export the prior file under the tenant\'s current context vocabulary (contextVocabulary), with every cell written as `*` or a prefix of the current ladder order, then import it again',
  };
}

/**
 * The grammar a document DECLARES, when it is one this platform derives (P36):
 * `ladder-cell` at today's version with today's order, or at a derived version
 * (3 or above) with a prefix of today's order. The store holds no tenant, so it
 * reads such a document by this alone; the import door checks the declaration
 * against the tenant's grammar in force first.
 */
function derivedGrammar(declared: unknown): CellGrammar | null {
  const g = declared && typeof declared === 'object' && !Array.isArray(declared) ? declared as Record<string, unknown> : null;
  if (!g || g.name !== CELL_GRAMMAR.name || typeof g.version !== 'number' || !Number.isSafeInteger(g.version) || g.version < 3 || !Array.isArray(g.order)) return null;
  const order = (g.order as unknown[]).map((k) => String(k));
  if (order.length < 1 || order.length > CELL_GRAMMAR.order.length || !order.every((k, i) => k === CELL_GRAMMAR.order[i])) return null;
  return { name: CELL_GRAMMAR.name, version: g.version, order: Object.freeze(order), migration: CELL_GRAMMAR.migration };
}

/**
 * Why this cell is not a ladder cell, or null when it is. Pure and exported so
 * the import door, the CSV reader and any future writer share one grammar.
 * P36: `order` is the grammar in force (today's order when omitted).
 */
export function cellGrammarError(cell: string, order: readonly string[] = CELL_GRAMMAR.order): string | null {
  if (cell === '*') return null;
  const pairs = cell.split('|');
  const expected = `'*' or the ladder's own keys in order — ${orderWords(order)} — as a prefix`;
  if (pairs.length > order.length) return `${expected}; '${cell}' names ${pairs.length} levels and the ladder has ${order.length}`;
  for (let i = 0; i < pairs.length; i++) {
    const at = pairs[i]!.indexOf('=');
    if (at < 1) return `${expected}; '${cell}' is not written as key=value pairs joined by |`;
    const key = pairs[i]!.slice(0, at);
    if (key !== order[i]) return `${expected}; '${cell}' has '${key}=' at level ${i + 1}, where this ladder has '${order[i]}='`;
  }
  return null;
}

const SLUG = /^[a-z0-9][a-z0-9:_.-]{0,63}$/i;

/**
 * The grammar this document declares, checked against the one this engine reads.
 * Absent is the current grammar; anything else is refused by name.
 */
function grammarError(declared: unknown, grammar: CellGrammar = CELL_GRAMMAR): string | null {
  if (declared === undefined) return null;
  const g = declared && typeof declared === 'object' && !Array.isArray(declared) ? declared as Record<string, unknown> : null;
  const order = g && Array.isArray(g.order) ? (g.order as unknown[]).map((k) => String(k)) : null;
  const same = !!g && g.name === grammar.name && g.version === grammar.version
    && order !== null && order.length === grammar.order.length && order.every((k, i) => k === grammar.order[i]);
  if (same) return null;
  return `cellGrammar: this engine reads ${grammar.name} version ${grammar.version}, whose cells are ${orderWords(grammar.order)} in that order; this document declares ${JSON.stringify(declared)} — ${grammar.migration}`;
}

/**
 * One argument: the grammar this engine reads for a tenant without the settings
 * (CELL_GRAMMAR), exactly as W25 rules it. P36: the import door passes the
 * tenant's grammar in force (`cellGrammarFor`).
 */
export function validatePriors(candidate: unknown, grammar: CellGrammar = CELL_GRAMMAR): ValidationResult<PriorsDoc> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { ok: false, errors: ['priors: must be an object with rows'] };
  const c = candidate as Record<string, unknown>;
  if (!Array.isArray(c.rows)) return { ok: false, errors: ['rows: array required'] };
  // A document exported under another grammar is refused whole: its rows mean
  // something else, so reading them under this ladder would be a guess.
  const refusal = grammarError(c.cellGrammar, grammar);
  if (refusal) return { ok: false, errors: [refusal] };
  const errors: string[] = [];
  const rows: PriorRow[] = [];
  const seen = new Set<string>();
  c.rows.forEach((r, i) => {
    if (!r || typeof r !== 'object') { errors.push(`rows[${i}]: object`); return; }
    const x = r as Record<string, unknown>;
    const slot = String(x.slot ?? '').trim(), item = String(x.item ?? '').trim(), cell = String(x.cell ?? '*').trim() || '*';
    const p = Number(x.p_prior), n = Number(x.n_equiv);
    const before = errors.length;
    if (x.measurementBasis !== undefined && x.measurementBasis !== 'served-v1' && x.measurementBasis !== 'rendered-v1') errors.push(`rows[${i}].measurementBasis: served-v1 | rendered-v1`);
    if (!SLUG.test(slot)) errors.push(`rows[${i}].slot: slug`);
    if (!item) errors.push(`rows[${i}].item: required`);
    const cellWhy = cellGrammarError(cell, grammar.order);
    if (cellWhy) errors.push(`rows[${i}].cell: ${cellWhy}`);
    if (!Number.isFinite(p) || p < 0 || p > 1) errors.push(`rows[${i}].p_prior: number 0..1`);
    if (!Number.isFinite(n) || n <= 0) errors.push(`rows[${i}].n_equiv: positive number`);
    const key = JSON.stringify([slot, item, cell, x.measurementBasis ?? 'served-v1']);
    if (seen.has(key)) errors.push(`rows[${i}]: duplicate of ${key}`);
    seen.add(key);
    if (errors.length === before) rows.push({ slot, item, cell, p_prior: p, n_equiv: n, ...(x.measurementBasis !== undefined ? { measurementBasis: x.measurementBasis as import('@/content/types').MeasurementBasis } : {}) });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: {
    ...(typeof c.version === 'string' ? { version: c.version } : {}),
    // Retained exactly as the current grammar, so a reader of the stored
    // document can see which ladder produced its cells.
    ...(c.cellGrammar !== undefined ? { cellGrammar: { name: grammar.name, version: grammar.version, order: [...grammar.order] } } : {}),
    rows,
  } };
}

/**
 * W25 Z1.01 (F20 §1.5): is this document's unit the unit the slot learns in?
 *
 * `p_prior` is constrained to a probability, and the kit promises "the rate your
 * team estimated elsewhere IN THE SELECTED OBJECTIVE UNIT". A slot whose
 * objective is money (`revenue`, `margin`) does not learn a probability, so a
 * `[0,1]` prior on it is not a weak belief, it is a number in the wrong unit:
 * applied silently it shrinks the item's estimate toward ~0 money per exposure
 * and demotes it to the lift floor. The platform refuses the row rather than
 * guessing a conversion; WHAT a money prior should look like is an owner
 * decision (D09) and no default is invented here.
 *
 * Pure: the caller supplies the objective per slot from the tenant's own
 * published learn document, so nothing about any tenant's vocabulary is compiled
 * in. One error per offending row, named by row index, slot, objective and unit.
 */
export function priorUnitErrors(doc: PriorsDoc, objectiveOf: (slot: string) => 'unit' | 'revenue' | 'margin' | null | undefined): string[] {
  const errors: string[] = [];
  (doc.rows ?? []).forEach((r, i) => {
    const objective = objectiveOf(r.slot) ?? 'unit';
    if (objective === 'unit') return;
    errors.push(`rows[${i}].p_prior: slot "${r.slot}" learns in ${objective}, and an imported prior is a probability (0..1); `
      + `this engine will not read one unit as the other, so the row is refused instead of being applied in the wrong unit`);
  });
  return errors;
}

/**
 * W25 R1 (LANE-LOG R183): the slots a document is refused for under
 * `priorUnitErrors`, one entry per slot in the order its first row appears,
 * with the objective the slot learns in and how many of the document's rows
 * name it.
 *
 * The statistics object refuses to PUBLISH a slot on exactly this rule
 * (`LearnStats` `priorsFor`: a retained document can still carry such a row,
 * because only the import door refuses it), so a slot listed here is a slot
 * whose publication the document stops. It is derived from the document and the
 * objectives alone — the same rule, applied by the same function — so a reader
 * that is not the statistics object can say which slots are stopped without
 * asking any object. Pure.
 */
export function priorUnitRefusedSlots(doc: PriorsDoc, objectiveOf: (slot: string) => 'unit' | 'revenue' | 'margin' | null | undefined):
  Array<{ slot: string; objective: 'revenue' | 'margin'; rows: number }> {
  const refused = new Map<string, { slot: string; objective: 'revenue' | 'margin'; rows: number }>();
  for (const r of doc.rows ?? []) {
    if (!priorUnitErrors({ rows: [r] }, objectiveOf).length) continue;
    const objective = objectiveOf(r.slot) === 'margin' ? 'margin' : 'revenue';
    const entry = refused.get(r.slot) ?? { slot: r.slot, objective, rows: 0 };
    entry.rows++;
    refused.set(r.slot, entry);
  }
  return [...refused.values()];
}

/** The five columns, in any order, one row per prior. Blank cell means '*'. */
export function parsePriorsCsv(text: string): PriorsDoc {
  const rows = parseCsv(text).map((r) => ({
    slot: r.slot ?? '', item: r.item ?? '', cell: r.cell?.trim() || '*',
    p_prior: Number(r.p_prior), n_equiv: Number(r.n_equiv),
    ...(r.measurementBasis ? { measurementBasis: r.measurementBasis as import('@/content/types').MeasurementBasis } : {}),
  }));
  return { rows };
}

export const PRIORS_KIND: DocumentKind<PriorsDoc> = {
  name: 'prior',
  publication: 'r2',
  // P36: the store holds no tenant, so a document declaring a grammar this
  // platform derives is read under the grammar it declares; the import door
  // (src/routes/content.ts) refuses any declaration that is not the tenant's
  // grammar in force first. Anything else reads exactly as W25 rules it.
  validate: (candidate) => validatePriors(candidate, (candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? derivedGrammar((candidate as Record<string, unknown>).cellGrammar) : null) ?? CELL_GRAMMAR),
  stamp: (v, r) => ({ ...v, version: `${(v.version ?? 'prior').replace(/\+r\d+$/, '')}+r${r}` }),
  versionOf: (v) => v.version ?? '',
};

/** Exact item → exact cell → prior, for one slot; neither identifier is split. */
export type PriorIndex = Map<string, Map<string, { p: number; n: number }>>;

/**
 * Whether a document is past the bound every reader indexes it within (4096
 * rows, 256 KiB). A reader that builds from a prior checks this BEFORE building,
 * so an over-capacity retained document is refused rather than read as absent.
 */
export function priorCapacityExceeded(doc: PriorsDoc | null | undefined): boolean {
  return !!doc && (doc.rows.length > 4096 || new TextEncoder().encode(JSON.stringify(doc)).length > 256 * 1024);
}

export function indexPriors(doc: PriorsDoc | null | undefined, slot: string, measurementBasis: import('@/content/types').MeasurementBasis = 'served-v1'): PriorIndex {
  // Bound expansion here too; legacy document validation must not silently
  // turn an over-capacity retained prior into an absent/zero prior.
  if (priorCapacityExceeded(doc)) throw new Error('Prior capacity exceeded');
  const out: PriorIndex = new Map();
  for (const r of doc?.rows ?? []) if (r.slot === slot && (r.measurementBasis ?? 'served-v1') === measurementBasis) {
    const cells = out.get(r.item) ?? new Map<string, { p: number; n: number }>();
    cells.set(r.cell, { p: r.p_prior, n: r.n_equiv });
    out.set(r.item, cells);
  }
  return out;
}
