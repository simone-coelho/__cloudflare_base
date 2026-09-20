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

export const CELL_GRAMMAR: CellGrammar = {
  name: 'ladder-cell',
  // 1 was the pre-CW29 ladder (`c=`, `v=`, `r=`, `a=`); 2 carries the journey stage.
  version: 2,
  order: ['c', 'v', 's', 'r', 'a'],
  migration: 're-export the prior file with every cell written as `*` or a prefix of the current ladder order, then import it again',
};

/** `c=, v=, s=, r=, a=` — the order as a refusal can print it. */
const orderWords = (order: readonly string[]): string => order.map((k) => `${k}=`).join(', ');

/**
 * Why this cell is not a ladder cell, or null when it is. Pure and exported so
 * the import door, the CSV reader and any future writer share one grammar.
 */
export function cellGrammarError(cell: string): string | null {
  if (cell === '*') return null;
  const order = CELL_GRAMMAR.order;
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
/** '*' or `k=v` pairs joined by '|' (doc 22 §5.4). */
const CELL = /^(\*|[a-z_]+=[^|]*(\|[a-z_]+=[^|]*)*)$/;

/**
 * The grammar this document declares, checked against the one this engine reads.
 * Absent is the current grammar; anything else is refused by name.
 */
function grammarError(declared: unknown): string | null {
  if (declared === undefined) return null;
  const g = declared && typeof declared === 'object' && !Array.isArray(declared) ? declared as Record<string, unknown> : null;
  const order = g && Array.isArray(g.order) ? (g.order as unknown[]).map((k) => String(k)) : null;
  const same = !!g && g.name === CELL_GRAMMAR.name && g.version === CELL_GRAMMAR.version
    && order !== null && order.length === CELL_GRAMMAR.order.length && order.every((k, i) => k === CELL_GRAMMAR.order[i]);
  if (same) return null;
  return `cellGrammar: this engine reads ${CELL_GRAMMAR.name} version ${CELL_GRAMMAR.version}, whose cells are ${orderWords(CELL_GRAMMAR.order)} in that order; this document declares ${JSON.stringify(declared)} — ${CELL_GRAMMAR.migration}`;
}

export function validatePriors(candidate: unknown): ValidationResult<PriorsDoc> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { ok: false, errors: ['priors: must be an object with rows'] };
  const c = candidate as Record<string, unknown>;
  if (!Array.isArray(c.rows)) return { ok: false, errors: ['rows: array required'] };
  // A document exported under another grammar is refused whole: its rows mean
  // something else, so reading them under this ladder would be a guess.
  const grammar = grammarError(c.cellGrammar);
  if (grammar) return { ok: false, errors: [grammar] };
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
    if (!CELL.test(cell)) errors.push(`rows[${i}].cell: '*' or k=v pairs joined by |`);
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
    ...(c.cellGrammar !== undefined ? { cellGrammar: { name: CELL_GRAMMAR.name, version: CELL_GRAMMAR.version, order: [...CELL_GRAMMAR.order] } } : {}),
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
  validate: validatePriors,
  stamp: (v, r) => ({ ...v, version: `${(v.version ?? 'prior').replace(/\+r\d+$/, '')}+r${r}` }),
  versionOf: (v) => v.version ?? '',
};

/** Exact item → exact cell → prior, for one slot; neither identifier is split. */
export type PriorIndex = Map<string, Map<string, { p: number; n: number }>>;

export function indexPriors(doc: PriorsDoc | null | undefined, slot: string, measurementBasis: import('@/content/types').MeasurementBasis = 'served-v1'): PriorIndex {
  // Bound expansion here too; legacy document validation must not silently
  // turn an over-capacity retained prior into an absent/zero prior.
  if (doc && (doc.rows.length > 4096 || new TextEncoder().encode(JSON.stringify(doc)).length > 256 * 1024)) throw new Error('Prior capacity exceeded');
  const out: PriorIndex = new Map();
  for (const r of doc?.rows ?? []) if (r.slot === slot && (r.measurementBasis ?? 'served-v1') === measurementBasis) {
    const cells = out.get(r.item) ?? new Map<string, { p: number; n: number }>();
    cells.set(r.cell, { p: r.p_prior, n: r.n_equiv });
    out.set(r.item, cells);
  }
  return out;
}
