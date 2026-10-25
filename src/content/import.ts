// src/content/import.ts
// The import adapter and the provider seam (scope appendix 1.3: content
// registered through a CMS or DAM API, or a JSON or CSV export). Whatever the
// source, the path is the same: normalize into the catalog's shape, validate
// every piece, write one versioned revision. Nothing here talks to the store;
// the route does that, so the same functions serve a file, a paste, or a pull.

import type { ContentCatalog, ContentPiece } from './types';
import { CATALOG_DOCUMENT_FIELDS, PIECE_FIELDS, shown } from './kinds';
import { inputLimit, inputRecords, inputTextBytes, INPUT_MAX_RECORDS, readInputText } from '@/config/input';
import type { DocumentKind, ValidationResult } from '@/config/versionedStore';

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
 * P92 (E17): the fields a feed may carry that the contract accepts and ignores: the module register's optional
 * `purpose_later` column, one sentence of what a module is for, until the semantic term exists. Never copied onto a
 * piece (the normalizer below reads only the published fields), so never stored, and never named `ignored_field` on
 * an import or a pull; a direct publication keeps the validator's own closed set and still names it.
 */
export const ACCEPTED_AND_IGNORED: readonly string[] = ['purpose_later'];

/**
 * Every field name a feed record may carry: the published piece's own fields,
 * the aliases above and the fields accepted and ignored. A record key outside
 * this set reaches no stored piece, which is what `ignoredFieldsOf` reports on
 * the write answer.
 */
export const FEED_FIELDS: ReadonlySet<string> = new Set([...PIECE_FIELDS, ...Object.values(FEED_FIELD_ALIASES).flat(), ...ACCEPTED_AND_IGNORED]);

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
  copy('complements', list);
  copy('inStock', v => stockOf(v) ?? v);
  // A structured field travels in one CSV cell as JSON; anywhere else it is taken as given.
  const jsonCell = (v: unknown) => {
    if (csv && typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
    return v;
  };
  copy('merchandising', jsonCell);
  // Ruling R-B1 (W19's lossless import of the documented piece): the targeting
  // rule is carried on every import path exactly as the direct publication
  // carries it — a JSON cell in a CSV row, like `merchandising` — and the
  // validator, never this reshaping, decides whether it is well formed.
  copy('eligibleWhen', jsonCell);
  // P44 (R-P78): the module's declarations travel on every import path as the
  // direct publication carries them, and the validator decides them: a CSV
  // `pooled` cell `true` is the declaration (JSON's `true`), any other value is
  // refused by name; a `successEvent` cell is the reward word.
  copy('pooled', jsonCell);
  copy('successEvent');
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
  'eligibleWhen', 'journeyStageFit', 'freshnessDate', 'featuredProductIds', 'complements', 'inStock', 'merchandising', 'pooled', 'successEvent',
] as const;

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * How a load meets the catalogue in force (P91, R-P330: every load names one): `merge` upserts by id, `replace` is the
 * whole catalogue, `full` replaces like `replace` and keeps every stored piece the file leaves out, after the file's
 * pieces in stored order, with lifecycle `expired`.
 */
export type ImportMode = 'replace' | 'merge' | 'full';
export const IMPORT_MODES: readonly ImportMode[] = ['merge', 'replace', 'full'];
export const isImportMode = (value: unknown): value is ImportMode => typeof value === 'string' && (IMPORT_MODES as readonly string[]).includes(value);

/** Candidate pieces from raw records; nulls dropped, order kept. */
export function candidatesFrom(records: unknown[]): Record<string, unknown>[] {
  return positionedCandidates(records).pieces;
}

/**
 * P82 (E5): the candidate pieces, each beside its position in the file sent: `positions[j]` is the index among the
 * records as sent of the record candidate j came from, so an entry the import drops (not a record) still counts.
 */
export function positionedCandidates(records: unknown[]): { pieces: Record<string, unknown>[]; positions: number[] } {
  inputRecords(records);
  const pieces: Record<string, unknown>[] = [], positions: number[] = [];
  records.forEach((record, k) => {
    const piece = normalizePiece(record);
    if (piece !== null) { pieces.push(piece); positions.push(k); }
  });
  return { pieces, positions };
}

/** Replace, or partial upsert by id. Omission preserves known fields; defaults belong only to inserts. */
export function assemble(current: ContentCatalog, incoming: Record<string, unknown>[], mode: ImportMode): { pieces: unknown[] } {
  return { pieces: assembleFrom(current, incoming, mode).pieces };
}

/**
 * P82 (E5): `assemble`, and beside it (never inside the document) where each assembled piece came from: `origins[i]`
 * is the index among the candidates of the record that last wrote piece i, or null for a stored piece the merge did not
 * carry.
 */
export function assembleFrom(current: ContentCatalog, incoming: Record<string, unknown>[], mode: ImportMode): { pieces: unknown[]; origins: (number | null)[] } {
  const inserted = (p: Record<string, unknown>) => ({ customerContentId: p.id, tags: {}, lifecycle: { status: 'live' }, ...p });
  if (mode === 'replace') return { pieces: incoming.map(inserted), origins: incoming.map((_, j) => j) };
  // P91: a full export replaces, then keeps each stored piece the file leaves out, in stored order, expired (its records
  // and receipts still resolve it; an expired piece is eligible for no decision). Their origins are null: no record sent them.
  if (mode === 'full') {
    const sent = new Set(incoming.map((p) => p.id));
    const expired = current.pieces.filter((p: ContentPiece) => !sent.has(p.id)).map((p: ContentPiece) => ({ ...p, lifecycle: { ...p.lifecycle, status: 'expired' as const } }));
    return { pieces: [...incoming.map(inserted), ...expired], origins: [...incoming.map((_, j) => j), ...expired.map(() => null)] };
  }
  const byId = new Map<string, unknown>(current.pieces.map((p: ContentPiece) => [p.id, p]));
  const from = new Map<string, number>();
  const invalid: unknown[] = [], invalidFrom: number[] = [];
  incoming.forEach((p, j) => {
    const id = typeof p.id === 'string' ? p.id : '';
    if (!id) { invalid.push(p); invalidFrom.push(j); return; } // Required insert IDs must reach validation, not disappear.
    const previous = byId.get(id);
    const next: Record<string, unknown> = isRecord(previous) ? { ...previous, ...p } : inserted(p);
    if (isRecord(previous) && isRecord(p.window) && Object.keys(p.window).length) {
      next.window = { ...(isRecord(previous.window) ? previous.window : {}), ...p.window };
    }
    byId.set(id, next);
    from.set(id, j);
  });
  return { pieces: [...byId.values(), ...invalid], origins: [...[...byId.keys()].map(id => from.get(id) ?? null), ...invalidFrom] };
}

// ── P82 (E5): the record an import's answer names ────────────────────────────

/** The longest record id an answer echoes, in UTF-16 code units, as the diagnostics bound a dimension name. */
export const RECORD_ID_BOUND = 64;

/**
 * The address of the record at position `k` of the file sent: `records[k] '<id>'`, the id cut to RECORD_ID_BOUND code
 * units and followed by `…` when cut; `records[k]` alone for a record with no id (none, or not a non-empty string).
 */
export function recordAddress(k: number, id: unknown): string {
  return typeof id === 'string' && id.length > 0 ? `records[${k}] '${id.slice(0, RECORD_ID_BOUND)}'${id.length > RECORD_ID_BOUND ? '\u2026' : ''}` : `records[${k}]`;
}

/**
 * Errors addressed `pieces[i]` (the catalogue validator, the eligibility check and the vocabulary refusal all begin a
 * piece's error so) re-addressed to the record of the file sent that wrote piece i: `pieces[i]` of `pieces` came from
 * the record at `positions[i]`, or from no record of the file (null, a stored piece a merge did not carry), whose error
 * keeps its address. The rest of each error is unchanged, but for the vocabulary refusal's own echo of the piece's id
 * (` '<id>'` or ` (no id)` after the address), which the record's address already says. Every other error is unchanged.
 */
export function recordAddressed(errors: readonly string[], pieces: readonly unknown[], positions: ReadonlyArray<number | null>): string[] {
  return errors.map((error) => {
    const at = /^pieces\[(\d+)\]/.exec(error);
    const i = at ? Number(at[1]) : -1, k = i >= 0 && i < positions.length ? positions[i] : null;
    if (!at || k === null || k === undefined) return error;
    const id = isRecord(pieces[i]) ? pieces[i].id : undefined;
    let rest = error.slice(at[0].length);
    const echoed = typeof id === 'string' && id.length > 0 ? ` ${shown(id)}` : ' (no id)';
    if (rest.startsWith(echoed + ' ')) rest = rest.slice(echoed.length);
    return recordAddress(k, id) + rest;
  });
}

/**
 * The record of the file sent each stored piece came from, for an import's and a pull's warnings: the last candidate
 * carrying the piece's id (a merge applies the last), or null for a stored piece the file did not carry.
 */
export function storedPieceRecords(stored: ContentCatalog, incoming: readonly Record<string, unknown>[], positions: readonly number[]): ({ recordIndex: number; recordId: string } | null)[] {
  const last = new Map<string, number>();
  incoming.forEach((p, j) => { if (typeof p.id === 'string') last.set(p.id, positions[j]!); });
  return stored.pieces.map((piece) => {
    const k = last.get(piece.id);
    return k === undefined ? null : { recordIndex: k, recordId: piece.id };
  });
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

// ── P91 (E16): the tenant's import-sources list ──────────────────────────────

/** An IPv4 or IPv6 address as its bytes (4 or 16), or null when the text is neither. Embedded IPv4 in IPv6 is not read. */
function addressBytes(text: string): number[] | null {
  if (/^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/.test(text)) {
    const parts = text.split('.').map(Number);
    return parts.every((n) => n <= 255) ? parts : null;
  }
  if (!text.includes(':') || text.split('::').length > 2) return null;
  const [head, tail] = text.split('::') as [string, string | undefined];
  const groups = (part: string) => (part ? part.split(':') : []);
  const front = groups(head), back = tail === undefined ? [] : groups(tail);
  const fill = tail === undefined ? 0 : 8 - front.length - back.length;
  if ((tail === undefined && front.length !== 8) || (tail !== undefined && fill < 1)) return null;
  const all = [...front, ...Array<string>(fill).fill('0'), ...back];
  if (all.length !== 8 || !all.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return null;
  return all.flatMap((group) => { const n = parseInt(group, 16); return [n >> 8, n & 255]; });
}
/** One list entry, an address (a range of one) or a CIDR range, as its bytes and prefix length; null when malformed. */
function addressRange(entry: string): { bytes: number[]; prefix: number } | null {
  const [address, prefix, extra] = entry.split('/');
  if (extra !== undefined || !address) return null;
  const bytes = addressBytes(address);
  if (!bytes) return null;
  const bits = bytes.length * 8, length = prefix === undefined ? bits : /^(0|[1-9][0-9]{0,2})$/.test(prefix) ? Number(prefix) : NaN;
  return length >= 0 && length <= bits ? { bytes, prefix: length } : null;
}
/** Whether `address` is one of the list's addresses or inside one of its ranges (same family only). */
export function addressAllowed(list: readonly string[], address: string): boolean {
  const caller = addressBytes(address);
  if (!caller) return false;
  return list.some((entry) => {
    const range = addressRange(entry);
    if (!range || range.bytes.length !== caller.length) return false;
    for (let i = 0, left = range.prefix; left > 0; i++, left -= 8) {
      const mask = left >= 8 ? 255 : (0xff << (8 - left)) & 255;
      if ((range.bytes[i]! & mask) !== (caller[i]! & mask)) return false;
    }
    return true;
  });
}
/** The tenant's import-sources list: the caller addresses allowed on the import, the pull and the dry run. */
export interface ImportSources { addresses: string[] }
/** At most this many entries in one list. */
export const IMPORT_SOURCES_MAX = 64;
function validateImportSources(candidate: unknown): ValidationResult<ImportSources> {
  if (!isRecord(candidate) || Object.keys(candidate).some((key) => key !== 'addresses')) return { ok: false, errors: ['import-sources: an object { addresses }'] };
  const list = candidate.addresses, errors: string[] = [];
  if (!Array.isArray(list) || list.length < 1 || list.length > IMPORT_SOURCES_MAX) errors.push(`addresses: 1 to ${IMPORT_SOURCES_MAX} IPv4 or IPv6 addresses or CIDR ranges`);
  else list.forEach((entry, i) => {
    if (typeof entry !== 'string' || !addressRange(entry)) errors.push(`addresses[${i}]: ${JSON.stringify(entry)?.slice(0, 80) ?? typeof entry} is not an IPv4 or IPv6 address or CIDR range`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: { addresses: [...(list as string[])] } };
}
/**
 * P91 (E16, R-P330): the optional publication member `import-sources`, `{ addresses: [...] }`. While a tenant publishes
 * one, a caller whose `CF-Connecting-IP` is outside it, or absent, is refused on the import, the pull and the dry run.
 */
export const IMPORT_SOURCES_KIND: DocumentKind<ImportSources> = {
  name: 'import-sources',
  publication: 'r2',
  validate: validateImportSources,
  // No stamp: a revision is stored exactly as the tenant authored it.
  versionOf: () => '',
};
