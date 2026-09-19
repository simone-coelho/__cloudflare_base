// src/content/import.ts
// The import adapter and the provider seam (scope appendix 1.3: content
// registered through a CMS or DAM API, or a JSON or CSV export). Whatever the
// source, the path is the same: normalize into the catalog's shape, validate
// every piece, write one versioned revision. Nothing here talks to the store;
// the route does that, so the same functions serve a file, a paste, or a pull.

import type { ContentCatalog, ContentPiece } from './types';
import { CATALOG_DOCUMENT_FIELDS, PIECE_FIELDS } from './kinds';
import { inputLimit, inputRecords, inputTextBytes, INPUT_MAX_RECORDS, readInputText } from '@/config/input';

// ── Normalization: many export shapes, one catalog shape ────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// Format provenance only: preserve the shared CSV parser's string rows (including
// blanks, used by priors). JSON empty strings/null are not CSV omissions.
const csvRows = new WeakSet<object>();
const trimmed = (v: unknown): unknown => typeof v === 'string' ? v.trim() : v;

/** `line:Drover;occasion:evening|everyday` or an object of arrays, or an object of strings. */
export function normalizeTags(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (dim: string, value: unknown) => {
    const d = dim.trim(); if (!d) return;
    const vals = Array.isArray(value) ? value : String(value ?? '').split('|');
    const clean = vals.map((x) => String(x).trim()).filter(Boolean);
    if (!clean.length) return;
    out[d] = [...new Set([...(out[d] ?? []), ...clean])];
  };
  if (isRecord(v)) { for (const [dim, val] of Object.entries(v)) add(dim, val); return out; }
  if (typeof v === 'string') {
    for (const part of v.split(';')) { const i = part.indexOf(':'); if (i > 0) add(part.slice(0, i), part.slice(i + 1)); }
  }
  return out;
}

/** A stock flag in any of the feed's spellings: booleans, 0/1, Y/N, 'true'/'false', in_stock/sold_out. Undefined when it says nothing. */
export function stockOf(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 0 ? false : v === 1 ? true : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (['y', 'yes', 'true', '1', 'in_stock', 'in stock', 'available'].includes(t)) return true;
  if (['n', 'no', 'false', '0', 'sold_out', 'sold out', 'out_of_stock', 'out of stock', 'unavailable'].includes(t)) return false;
  return undefined;
}

export function normalizeList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split('|').map((x) => x.trim()).filter(Boolean);
  return [];
}

/**
 * The spellings a feed may use for each published field of the content piece:
 * the names the demo catalog, a typical CMS export and the documented CSV
 * columns use. One table, so the normalizer below and the diagnostics that name
 * an ignored field can never disagree about what the contract lists.
 */
export const FEED_FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = {
  id: ['systemId', 'contentId'],
  customerContentId: ['cmsId', 'customerId'],
  type: ['contentType', 'kind'],
  renderUrl: ['url'],
  slotTypes: ['slots'],
  journeyStageFit: ['journey_stage_fit', 'stageFit'],
  freshnessDate: ['freshness_date', 'publishedAt'],
  featuredProductIds: ['featured_product_ids', 'products'],
  inStock: ['in_stock', 'ats'],
  lifecycle: ['status'],
  window: ['windowFrom', 'publishAt', 'windowTo', 'expireAt'],
};

/**
 * Every field name a feed record may carry: the published piece's own fields
 * and the aliases above. A record key outside this set reaches no stored piece,
 * which is what `ignoredFieldsOf` reports on the write answer.
 */
export const FEED_FIELDS: ReadonlySet<string> = new Set([...PIECE_FIELDS, ...Object.values(FEED_FIELD_ALIASES).flat()]);

/**
 * The keys of one raw record the published contract does not list, in the order
 * the record carried them. The caller passes the field set ITS path accepts:
 * the feed's aliases for an import or a pull, the validator's own closed set
 * (`PIECE_FIELDS`) for a direct publication, which is never routed through this
 * normalizer. Nothing is stored either way; this only says what was lost.
 */
export function ignoredFieldsOf(raw: unknown, accepted: ReadonlySet<string>): string[] {
  return isRecord(raw) ? Object.keys(raw).filter(key => !accepted.has(key)) : [];
}

/**
 * The document keys ONE request may carry: the catalogue's own closed set, plus
 * the envelope keys that path uses to carry the catalogue — a feed export's
 * records key, or the fields a direct publication's body holds beside its
 * document. The envelope is how the catalogue arrived, never a field of it, so
 * each path names its own and nothing else is accepted.
 */
export function catalogDocumentFields(...envelope: readonly (string | null | undefined)[]): ReadonlySet<string> {
  const accepted = new Set(CATALOG_DOCUMENT_FIELDS);
  for (const key of envelope) if (key) accepted.add(key);
  return accepted;
}

/**
 * A CSV header the contract does not list, but which matches a documented
 * column when case is ignored. Column names are matched exactly, so `Tags`
 * reads as an unknown column and every row lands with an empty taxonomy
 * (F27 §5.3): a defect that can be detected AS a defect, and is therefore
 * refused at the boundary rather than imported into a silent loss.
 */
export function csvColumnCaseVariants(columns: readonly string[]): { column: string; expected: string }[] {
  const exact = new Map([...FEED_FIELDS].map(name => [name.toLowerCase(), name]));
  const found: { column: string; expected: string }[] = [];
  for (const column of columns) {
    if (FEED_FIELDS.has(column)) continue;
    const expected = exact.get(column.toLowerCase());
    if (expected !== undefined) found.push({ column, expected });
  }
  return found;
}

/**
 * One raw record from any source into a candidate piece. Accepts the field
 * names the demo catalog, a typical CMS export, and the CSV columns use. What
 * comes out still goes through the catalog validator; this only reshapes.
 */
export function normalizePiece(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const csv = csvRows.has(raw), out: Record<string, unknown> = {};
  const supplied = (key: string) => Object.hasOwn(raw, key) && !(csv && raw[key] === '');
  const copy = (key: string, normalize: (v: unknown) => unknown = trimmed) => {
    const source = [key, ...(FEED_FIELD_ALIASES[key] ?? [])].find(supplied);
    if (source !== undefined) out[key] = normalize(raw[source]);
  };
  const list = (v: unknown) => typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string')) ? normalizeList(v) : v;
  copy('id');
  copy('customerContentId');
  copy('type');
  for (const key of ['title', 'subtitle', 'art', 'excerpt', 'runtime']) copy(key);
  copy('renderUrl');
  copy('tags', v => typeof v === 'string' || (isRecord(v) && Object.values(v).every(x => typeof x === 'string'
    || (Array.isArray(x) && x.every(value => typeof value === 'string')))) ? normalizeTags(v) : v);
  copy('slotTypes', list);
  copy('journeyStageFit', list);
  copy('freshnessDate');
  copy('featuredProductIds', list);
  copy('inStock', v => stockOf(v) ?? v);
  copy('merchandising', v => {
    if (csv && typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
    return v;
  });
  // An explicitly supplied canonical field always wins, even when invalid.
  if (supplied('lifecycle')) out.lifecycle = raw.lifecycle;
  else if (supplied('status')) out.lifecycle = { status: trimmed(raw.status) };
  if (supplied('window')) out.window = raw.window;
  else {
    const window: Record<string, unknown> = {};
    for (const [bound, names] of [['from', ['windowFrom', 'publishAt']], ['to', ['windowTo', 'expireAt']]] as const) {
      const name = names.find(supplied); if (name !== undefined) window[bound] = trimmed(raw[name]);
    }
    if (Object.keys(window).length) out.window = window;
  }
  return out;
}

/** The keys a JSON export may hold its records under when the request names no path. */
export const JSON_RECORD_KEYS = ['pieces', 'content', 'items', 'data'] as const;

/**
 * The array of records inside a JSON export AND the top-level key that carried
 * them — the body itself (no key), `pieces`, `content`, `items`, `data`, or the
 * first segment of a dotted path. The carrier is how the export delivers its
 * records, so a caller can tell it from a document key the contract does not
 * list; it is `null` when the body is the array itself and there is no document.
 */
export function recordsInJson(body: unknown, path?: string): { records: unknown[]; carrier: string | null } {
  const selected = (value: unknown, carrier: string | null) => {
    inputRecords(value); return { records: Array.isArray(value) ? value : [], carrier };
  };
  if (path) {
    const segments = path.split('.').filter(Boolean);
    let cur: unknown = body;
    for (const seg of segments) cur = isRecord(cur) ? cur[seg] : undefined;
    return selected(cur, segments[0] ?? null);
  }
  if (Array.isArray(body)) return selected(body, null);
  if (isRecord(body)) for (const k of JSON_RECORD_KEYS) if (Array.isArray(body[k])) return selected(body[k], k);
  return { records: [], carrier: null };
}

/** The array of records inside a JSON export: the body itself, `pieces`, `content`, `items`, or a dotted path. */
export function recordsFromJson(body: unknown, path?: string): unknown[] {
  return recordsInJson(body, path).records;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * RFC 4180-style: quoted fields may hold commas, newlines and doubled quotes.
 * The parsed HEADER is returned beside the records, because it is the header
 * that declares the feed's columns: a header-only export, and one whose every
 * data cell is blank, carry no record to read the columns off, and a boundary
 * that read the columns from a first record would have nothing to say about
 * either (F27 §5.3).
 */
export function parseCsvTable(text: string): { columns: string[]; records: Record<string, string>[] } {
  inputTextBytes(text);
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  let cells = 0;
  const pushField = () => {
    inputLimit('csv_fields', row.length + 1, 256);
    inputLimit('csv_cells', ++cells, 100_000);
    row.push(field); field = '';
  };
  const pushRow = () => {
    if (row.some(f => f !== '')) {
      inputLimit('records', rows.length, INPUT_MAX_RECORDS); // First nonblank row is the header.
      inputLimit('csv_materialized_cells', (rows[0]?.length ?? 0) * rows.length, 100_000);
      rows.push(row);
    }
    row = [];
  };
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { pushField(); continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      pushField(); pushRow();
      continue;
    }
    field += ch;
  }
  pushField(); pushRow();
  const [header, ...body] = rows;
  if (!header) return { columns: [], records: [] };
  const names = header.map((h) => h.trim());
  return { columns: names, records: body.map((r) => {
    const record = Object.fromEntries(names.map((n, i) => [n, (r[i] ?? '').trim()]));
    csvRows.add(record); return record;
  }) };
}

/** The records of a CSV export; the header is `parseCsvTable`'s `columns`. */
export function parseCsv(text: string): Record<string, string>[] {
  return parseCsvTable(text).records;
}

export const CSV_COLUMNS = [
  'id', 'customerContentId', 'type', 'title', 'subtitle', 'tags', 'slotTypes', 'status', 'art', 'renderUrl', 'excerpt', 'runtime', 'windowFrom', 'windowTo',
  'journeyStageFit', 'freshnessDate', 'featuredProductIds', 'inStock', 'merchandising',
] as const;

// ── Assembly ────────────────────────────────────────────────────────────────

export type ImportMode = 'replace' | 'merge';

/** Candidate pieces from raw records; nulls dropped, order kept. */
export function candidatesFrom(records: unknown[]): Record<string, unknown>[] {
  inputRecords(records);
  return records.map(normalizePiece).filter((p): p is Record<string, unknown> => p !== null);
}

/** Replace, or partial upsert by id. Omission preserves known fields; defaults belong only to inserts. */
export function assemble(current: ContentCatalog, incoming: Record<string, unknown>[], mode: ImportMode): { pieces: unknown[] } {
  const inserted = (p: Record<string, unknown>) => ({ customerContentId: p.id, tags: {}, lifecycle: { status: 'live' }, ...p });
  if (mode === 'replace') return { pieces: incoming.map(inserted) };
  const byId = new Map<string, unknown>(current.pieces.map((p: ContentPiece) => [p.id, p]));
  const invalid: unknown[] = [];
  for (const p of incoming) {
    const id = typeof p.id === 'string' ? p.id : '';
    if (!id) { invalid.push(p); continue; } // Required insert IDs must reach validation, not disappear.
    const previous = byId.get(id);
    const next: Record<string, unknown> = isRecord(previous) ? { ...previous, ...p } : inserted(p);
    if (isRecord(previous) && isRecord(p.window) && Object.keys(p.window).length) {
      next.window = { ...(isRecord(previous.window) ? previous.window : {}), ...p.window };
    }
    byId.set(id, next);
  }
  return { pieces: [...byId.values(), ...invalid] };
}

// ── The provider seam ───────────────────────────────────────────────────────

/** What one pull brought back: the records, and the export document they came out of. */
export interface PulledExport {
  /** The raw records, however the source holds them. */
  records: unknown[];
  /** The export document itself, when the source answers one; an array is records, not a document. */
  document: unknown;
  /** The key of that document that carried the records — the envelope, never a field of the catalogue. */
  carrier: string | null;
}

export interface ContentSource {
  /** The raw records, however the source holds them. */
  pull(): Promise<unknown[]>;
  /** The whole export beside its records, for a source whose records arrive inside a document. */
  pullExport?(): Promise<PulledExport>;
}

/**
 * A CMS or DAM that exposes JSON over HTTP: the first adapter, and the shape
 * every later one fills. http(s) only; the caller decides what URLs are allowed.
 */
export class HttpJsonSource implements ContentSource {
  constructor(
    private readonly url: string,
    private readonly path?: string,
    private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
  ) {
    if (!/^https?:\/\//i.test(url)) throw new Error('source url must be http(s)');
  }
  async pullExport(): Promise<PulledExport> {
    const res = await this.fetchImpl(this.url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`source responded ${res.status}`);
    const document: unknown = JSON.parse(await readInputText(res.body));
    return { document, ...recordsInJson(document, this.path) };
  }
  async pull(): Promise<unknown[]> {
    return (await this.pullExport()).records;
  }
}
