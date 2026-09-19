// src/units/W19/B3.unit.test.ts
// W19 batch B3 — the feed-contract follow-ups the W19-B1 build review owed
// (R79(b), R84). Every unit answers a named finding of
// `_evidence/W19-B1/reviewer-build/REPORT.md`:
//   F3.01 ← finding 2 (`changed: 0` on a destructive replace; probe C measured
//          `{ changed: 0, pieces: 1 }` after a replace 3 → 1, the removed pieces
//          invisible);
//   F3.02 ← finding 1 (the 50-warning sample starves the request-derived code;
//          probe A: 60 pieces × (one unlisted field + one unregistered
//          dimension) → `warningCount 120`, sample 50 all `unknown_dimension`,
//          zero `ignored_field` visible);
//   F3.03 ← finding 3 (a header-only or all-blank CSV with a case-variant
//          column is not named; probe B: 422 `no records found`, the column
//          never named);
//   F3.04 ← finding 4 (`PIECE_FIELDS`, `src/content/kinds.ts:33-35`, is a
//          hand-written copy of what `validatePiece` reads);
//   F3.05 ← finding 5 (an unlisted key on the catalogue DOCUMENT is dropped
//          silently);
//   F3.06 ← finding 6 (`ignored_field.pieceIndex` means the request position
//          while every other code's means the stored position);
//   F3.07 ← owner-visible item (a) (the tag-value echo accepted with the
//          residual "no test locks the 20/64 bound or 'a piece ID is never
//          echoed'"; probe D measured 24 spellings → 20 + `valuesTruncated`);
//   F3.08 ← owner-visible item (c) (`changed` on a retry is measured against
//          the declared revision and the fallback "can only overcount"; no unit
//          proves it).
//
// Witnesses for the expected values:
//   · document 35 §5 row W19 · G2 ("prove idempotent round trips", "warn/reject
//     unusable taxonomy"); §2 F27 and `35-verification-reports/F27.md` §5.4
//     ("There is no warning channel at all … Every failure in this finding is
//     silent by design") — a channel that drops a whole code out of its sample,
//     or a destructive write that reports nothing removed, is that silence
//     returning through the cap.
//   · docs/kit/03-payload-schemas.md :129-:168 "The content piece" (the closed
//     field list `PIECE_FIELDS` must equal, :133-149) and :151-168 (merge is a
//     partial upsert by id; CSV blank cells mean omitted).
//   · docs/kit/02-api-reference.md :396 (the diagnostics answer: "Available
//     diagnostics contain `warningCount`, `omittedWarningCount` and at most50
//     `warnings`… Counts include all warning occurrences beyond the sample
//     limit; IDs are not echoed, and tag values only as the bounded
//     `case_variant_value` spellings above" — the bound and the privacy rule
//     this batch locks, and the sentence the per-code counts extend). The same
//     line publishes `ignored_field` as `{code, pieceIndex, field,
//     fieldTruncated}` with "`pieceIndex` is the record's position in the
//     submitted document": unit W19.F3.06 rules that position `recordIndex`, so
//     that sentence is a documentation correction the build owes with the code.
//   · rulings R19 (host legs drive the mounted routes), R21 (a ruled-but-absent
//     member is named), R10 (an existing assertion a new member breaks is
//     corrected with its witness), R84(a)-(d) (this batch's readings).
//
// ONE CHANNEL, ADDITIVE MEMBERS (R84(a)). Every ruled member below joins the
// existing `catalog-registry-diagnostics/v1` answer or the import/pull answer
// beside the members they already carry; no member changes meaning, and the two
// counts that exist (`warningCount`, `omittedWarningCount`) keep counting every
// occurrence. The one whole-object equality on this channel in an existing test
// is corrected in the same commit under R10, named in the report and in the
// rows: `src/routes/content.test.ts:466` (the frozen W19.03 `toEqual`, which
// after the integration merge also carries W19-B2's `slots` member), whose
// `counts` value is derived from that fixture's own warnings.
//
// RULED MISSING MEMBERS (R21), asserted here by the names this specification
// rules and RED until they exist. None is an export; each is a member of an
// answer the mounted routes already return:
//   1. `removed: number` on the import / pull answer — how many stored pieces
//      the write removed, beside `changed` (created or altered), so a
//      destructive replace is never silent (W19.F3.01; finding 2).
//   2. `diagnostics.counts: Record<code, number>` — the exact occurrence count
//      per warning code present, beside `warningCount` and
//      `omittedWarningCount`, and the sampled `warnings[]` carries at least one
//      warning of every code present once the 50-warning cap bites
//      (W19.F3.02; finding 1).
//   3. `{ code: 'ignored_document_field', field, fieldTruncated }` — the
//      catalogue DOCUMENT's own unlisted key, named without a record position
//      because it belongs to no piece. This specification chooses the sibling
//      code over loosening `ignored_field`'s shape, so every existing code keeps
//      its members and its meaning (W19.F3.05; finding 5).
//   4. `recordIndex` on the request-derived code `ignored_field` — the position
//      in the REQUEST — replacing the `pieceIndex` it carries today, which every
//      other code uses for the STORED position (W19.F3.06; finding 6). The two
//      are different numbers on a merge, and the answer must not call them the
//      same thing.
//   5. `changedBasis: 'stored' | 'unavailable'` beside `changed` on the import /
//      pull answer, with `changed: null` when the basis is `'unavailable'`, so a
//      base revision the store cannot read is said by name instead of every
//      piece being counted as created (W19.F3.08; owner-visible item (c)).
// Two further RED outcomes need no new member, only the behaviour:
//   6. A header-only or all-blank CSV whose header carries a case-variant column
//      is refused 422 naming that column, exactly as a CSV with data rows is:
//      the columns are derived from the parsed header, not from the first parsed
//      record (W19.F3.03; finding 3).
//   7. The request-derived code is present in the sample whenever it occurred
//      (W19.F3.02's second half).

import { describe, it, expect, vi } from 'vitest';
import * as jose from 'jose';
import { Hono } from 'hono';

import type { Env } from '@/types/env';
import { contentRoutes } from '@/routes/content';
import { tenantMiddleware } from '@/tenancy/middleware';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, PIECE_FIELDS, SLOTS_KIND } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';

// ---------------------------------------------------------------------------
// Harness — the mounted content routes, the paths an operator and a CMS use
// (R19). Modelled on `src/units/W19/B1.unit.test.ts` and
// `src/routes/content.test.ts`; neither suite is imported and neither is edited
// except for the one R10 correction named above.
// ---------------------------------------------------------------------------

const FEED_TENANT = 'coach';
const FEED_HOST = 'https://synthetic.invalid/content';
const FEED_SECRET = 'w19-b3-synthetic-route-signing-material-only';

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.data.get(key);
    return raw === undefined ? null : type === 'stream' ? new Response(raw).body : type === 'json' ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(options?.prefix ?? '')).sort();
    const start = Number(options?.cursor ?? 0), end = start + (options?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

interface UnitWarning {
  code: string;
  pieceIndex?: number;
  /** RULED, ABSENT TODAY (R21): the position in the REQUEST, for a request-derived code. */
  recordIndex?: number;
  dimensionIndex?: number;
  dimension?: string;
  dimensionTruncated?: boolean;
  field?: string;
  fieldTruncated?: boolean;
  values?: string[];
  valuesTruncated?: boolean;
}
interface UnitDiagnostics {
  schema?: string;
  status?: string;
  warningCount?: number | null;
  omittedWarningCount?: number | null;
  /** RULED, ABSENT TODAY (R21): the exact occurrence count of every code present. */
  counts?: Record<string, number> | null;
  warnings?: UnitWarning[] | null;
}
interface WriteAnswer {
  status: number;
  ok?: boolean;
  errors?: string[];
  error?: string;
  revision?: number;
  pieces?: number;
  changed?: number | null;
  /** RULED, ABSENT TODAY (R21): stored pieces this write removed; null when `changedBasis` is `'unavailable'`. */
  removed?: number | null;
  /** RULED, ABSENT TODAY (R21): whether `changed` could be measured against the stored base. */
  changedBasis?: string;
  diagnostics?: UnitDiagnostics;
}
interface ReadAnswer {
  status: number;
  revision: number;
  document: { pieces: Record<string, unknown>[]; version?: string };
  diagnostics?: UnitDiagnostics;
}

const feedKinds = [CONTENT_KIND, SLOTS_KIND, LEARN_KIND, REFLEX_KIND, PRIORS_KIND, PROPOSALS_KIND];

async function feedFixture(initial = EMPTY_CATALOG, registry: unknown = DEFAULT_REFLEX_CONFIG) {
  invalidateCache();
  const storage = new UnitR2();
  const env = { CACHE: new UnitKV(), STORAGE: storage, JWT_SECRET: FEED_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: JSON.stringify({ provisioned: [FEED_TENANT], operatorGrants: { ops: [FEED_TENANT] } }) } as unknown as Env;
  const values: unknown[] = [initial, DEFAULT_SLOTS, DEFAULT_LEARN, registry, EMPTY_PRIORS, EMPTY_PROPOSALS];
  await initializePublicationSet(env, feedKinds.map((kind, i): PublicationBaseline => ({
    kind, scope: kind.name === 'reflex' ? reflexScopeForTenant(FEED_TENANT) : FEED_TENANT,
    revision: { revision: 1, value: values[i], actor: 'w19-b3-fixture', note: '', at: 1 },
  })), '0:' + crypto.randomUUID());
  const bearer = await new jose.SignJWT({ sub: 'ops', type: 'service' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(FEED_SECRET));
  const auth = { 'Content-Type': 'application/json', 'X-Tenant': FEED_TENANT, Authorization: `Bearer ${bearer}` };
  const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
  app.use('*', tenantMiddleware()); app.route('/content', contentRoutes);

  const request = (path: string, init?: RequestInit) => app.request(`${FEED_HOST}${path}`, init, env);
  const read = async (): Promise<ReadAnswer> => {
    const response = await request(`/catalog?scope=${FEED_TENANT}`, { headers: auth });
    const body = await response.json() as Omit<ReadAnswer, 'status'>;
    return { ...body, status: response.status };
  };
  const headers = async (extra: Record<string, string> = {}) => {
    const revision = (await read()).revision;
    const head = JSON.parse(storage.objects.get(`config-publication/v2/${FEED_TENANT}/head.json`)!) as { committed: { revision: number; digest: string } };
    return { ...auth, ...extra, 'If-Match': `"${revision}/${head.committed.revision}/${head.committed.digest}"`,
      'Idempotency-Key': `${revision}:${crypto.randomUUID()}` };
  };
  const answer = async (response: Response): Promise<WriteAnswer> => {
    const body = await response.json().catch(() => ({})) as Omit<WriteAnswer, 'status'>;
    return { ...body, status: response.status };
  };
  const write = async (path: string, body: BodyInit, extra: Record<string, string> = {}, given?: Record<string, string>) =>
    answer(await request(path, { method: 'POST', headers: given ?? await headers(extra), body }));

  return {
    env, storage, auth, app, read, headers,
    /** POST /content/catalog/import, a JSON export; `envelope` carries extra document-level keys. */
    importJson: (records: unknown[], mode: 'replace' | 'merge' = 'replace', given?: Record<string, string>, envelope: Record<string, unknown> = {}) =>
      write(`/catalog/import?scope=${FEED_TENANT}&mode=${mode}`, JSON.stringify({ content: records, ...envelope }), {}, given),
    importCsv: (text: string, mode: 'replace' | 'merge' = 'replace') =>
      write(`/catalog/import?scope=${FEED_TENANT}&format=csv&mode=${mode}`, text, { 'Content-Type': 'text/csv' }),
    /** POST /content/catalog/import?path=, so the records key is the one the request names. */
    importPath: (body: Record<string, unknown>, path: string) =>
      write(`/catalog/import?scope=${FEED_TENANT}&mode=replace&path=${path}`, JSON.stringify(body)),
    pull: async (records: unknown[], mode: 'replace' | 'merge' = 'replace', envelope: Record<string, unknown> = {}) => {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: records, ...envelope })));
      try {
        return await write(`/catalog/pull?scope=${FEED_TENANT}`, JSON.stringify({ url: 'https://cms.example.invalid/export.json', path: 'content', mode }));
      } finally { spy.mockRestore(); }
    },
    /** PUT /content/catalog, the full replace that deliberately bypasses the normalizer (F27 §4.2). */
    put: async (pieces: unknown[], document: Record<string, unknown> = {}) =>
      answer(await request(`/catalog?scope=${FEED_TENANT}`, { method: 'PUT', headers: await headers(), body: JSON.stringify({ document: { pieces, ...document } }) })),
    /** PUT /content/catalog with no `document` wrapper: `routes/content.ts:295` reads the body itself as the candidate. */
    putRaw: async (body: Record<string, unknown>) =>
      answer(await request(`/catalog?scope=${FEED_TENANT}`, { method: 'PUT', headers: await headers(), body: JSON.stringify(body) })),
    /** POST /content/catalog/validate, the authenticated dry run that answers the same channel. */
    validate: async (pieces: unknown[], document: Record<string, unknown> = {}) =>
      answer(await request(`/catalog/validate?scope=${FEED_TENANT}`, { method: 'POST', headers: auth, body: JSON.stringify({ document: { pieces, ...document } }) })),
  };
}

// ---------------------------------------------------------------------------
// Fixtures — Coach's own taxonomy (docs/architecture/tapestry_requirements.txt
// A.3.6; docs/kit/03-payload-schemas.md :133-149), in the fixture and never in
// product code (METHOD §6).
// ---------------------------------------------------------------------------

/** Every field kit 03 "The content piece" lists, with a valid value for each. */
const KIT_PIECE = {
  id: 'cnt-tabby-film',
  customerContentId: 'CMS-TABBY-FILM-26',
  type: 'film',
  title: 'The Tabby, After Dark',
  subtitle: 'Ninety seconds in evening light',
  excerpt: 'The Tabby 26, shot at dusk.',
  runtime: '00:01:30',
  tags: { line: ['Tabby'], occasion: ['evening'], contentType: ['video'] },
  slotTypes: ['hero', 'story'],
  lifecycle: { status: 'live' },
  window: { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' },
  art: 'https://cdn.example.invalid/w19/tabby-after-dark.jpg',
  renderUrl: 'https://www.example.invalid/stories/tabby-after-dark',
  merchandising: { season: 0.9, promotion: 1, margin: 0.4 },
  journeyStageFit: ['exploring', 'considering'],
  freshnessDate: '2026-09-01T00:00:00.000Z',
  featuredProductIds: ['COA-CW620', 'COA-CH857'],
  inStock: true,
};

const piece = (id: string, extra: Record<string, unknown> = {}) => ({
  id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'editorial', title: id,
  tags: { line: ['Tabby'] }, slotTypes: ['story'], ...extra,
});

const CSV_HEADER = ['id', 'customerContentId', 'type', 'title', 'tags', 'slotTypes'] as const;
const csvCell = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const csvOf = (columns: readonly string[], rows: Record<string, string>[]) =>
  [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column] ?? '')).join(','))].join('\n') + '\n';

const warningsOf = (diagnostics?: UnitDiagnostics): UnitWarning[] => diagnostics?.warnings ?? [];
const codesOf = (diagnostics?: UnitDiagnostics): string[] => [...new Set(warningsOf(diagnostics).map(warning => warning.code))].sort();

// ===========================================================================
// W19.F3.01 — a destructive replace is never silent (finding 2)
// ===========================================================================

describe('unit:W19.F3.01', () => {
  it('host: a replace import that drops stored pieces reports how many it removed, a merge that removes nothing reports none, and the pull path answers the same', async () => {
    const f = await feedFixture();
    expect((await f.put([piece('one'), piece('two'), piece('three')])).status, 'three pieces are published').toBe(200);

    // The case probe C measured: replace 3 → 1. Two stored pieces are gone and
    // the answer says nothing about them, because `changed` counts only what was
    // created or altered (`routes/content.ts:128-139`, its own comment: "A piece
    // the operation removed is neither created nor altered and is not counted
    // here"). Document 35 §5 W19 requires the contract to be lossless AND
    // legible; F27 §5.4 names silence as the defect.
    const destructive = await f.importJson([piece('one')], 'replace');
    expect(destructive.status, 'the destructive replace is accepted').toBe(200);
    expect(destructive.pieces, 'one piece is left in the catalogue').toBe(1);
    expect(destructive.changed, 'the surviving piece is byte-identical, so nothing was created or altered').toBe(0);
    expect(destructive.removed,
      'W19.F3.01 — the answer must report the two stored pieces this replace removed (ruled member `removed`), so a destructive write is never silent').toBe(2);

    // A merge that removes nothing says so with a number, not with an absence.
    const merge = await f.importJson([piece('one', { title: 'One, refreshed' })], 'merge');
    expect(merge.status, 'the merge refresh is accepted').toBe(200);
    expect(merge.changed, 'the refreshed piece is the one change').toBe(1);
    expect(merge.removed, 'W19.F3.01 — a merge removes nothing, and the answer reports that as zero').toBe(0);

    // The same on the pull seam, which shares `importInto`.
    const pulled = await f.pull([piece('one', { title: 'One, refreshed' })], 'replace');
    expect(pulled.status, 'the pull is accepted').toBe(200);
    expect(pulled.changed, 'the pulled catalogue matches the stored piece').toBe(0);
    expect(pulled.removed, 'W19.F3.01 — a pull that replaces the catalogue reports what it removed too').toBe(0);

    const emptied = await f.pull([piece('four')], 'replace');
    expect(emptied.status, 'the second pull is accepted').toBe(200);
    expect(emptied.removed, 'W19.F3.01 — a pull that drops the only stored piece reports one removed').toBe(1);
    expect(emptied.changed, 'and reports the new piece as created').toBe(1);
  });
});

// ===========================================================================
// W19.F3.02 — the sample never starves a code (finding 1)
// ===========================================================================

describe('unit:W19.F3.02', () => {
  it('host: a feed with sixty registry warnings and sixty ignored fields reports exact per-code counts and shows both codes in the bounded sample', async () => {
    const f = await feedFixture();
    // Probe A's feed, exactly: sixty pieces, each carrying one dimension the
    // tenant's published registry does not name and one field the contract does
    // not list. 120 occurrences, a sample bounded at 50 (kit 02 :396).
    const records = Array.from({ length: 60 }, (_, index) => ({
      ...piece(`bulk-${index}`), tags: { occassion: ['evening'] }, vertical: 'menswear',
    }));
    const answer = await f.importJson(records);
    expect(answer.status, 'the bulk feed is accepted').toBe(200);
    expect(answer.diagnostics?.warningCount, 'every occurrence is counted').toBe(120);
    expect(answer.diagnostics?.omittedWarningCount, 'and the cap omits seventy of them from the sample').toBe(70);
    expect(warningsOf(answer.diagnostics).length, 'the sample stays bounded at fifty (kit 02 :396)').toBe(50);

    // 1. The counts are exact per code, so an operator learns how much of each
    //    defect the feed carried even when the sample cannot show it.
    expect(answer.diagnostics?.counts,
      'W19.F3.02 — the answer must carry the exact occurrence count of every code present (ruled member `counts`), so the cap never hides a whole class of defect')
      .toEqual({ unknown_dimension: 60, ignored_field: 60 });

    // 2. The sample itself is discriminated: every code that occurred is visible
    //    in it. Today the fifty slots are filled by the catalogue scan before the
    //    request-derived code is appended (`catalogDiagnostics.ts:54, :84-88`),
    //    so `ignored_field` disappears entirely — the silence F27 §5.4 names,
    //    returning through the cap.
    expect(codesOf(answer.diagnostics),
      'W19.F3.02 — both codes the feed produced must appear in the bounded sample').toEqual(['ignored_field', 'unknown_dimension']);

    // 3. The two counts that already exist keep their meaning: the sample length
    //    plus the omitted count is still every occurrence.
    expect(warningsOf(answer.diagnostics).length + (answer.diagnostics?.omittedWarningCount ?? 0),
      'W19.F3.02 — the sample and the omitted count still account for every occurrence').toBe(120);

    // 4. A feed whose warnings fit under the cap reports counts that agree with
    //    the sample exactly, so `counts` is not a second, looser number.
    const small = await feedFixture();
    const smallAnswer = await small.importJson([{ ...piece('single'), tags: { occassion: ['evening'] }, vertical: 'menswear' }]);
    expect(smallAnswer.status, 'the small feed is accepted').toBe(200);
    expect(smallAnswer.diagnostics?.warningCount, 'two occurrences').toBe(2);
    expect(smallAnswer.diagnostics?.counts,
      'W19.F3.02 — under the cap the per-code counts are the sample, counted').toEqual({ unknown_dimension: 1, ignored_field: 1 });
  });
});

// ===========================================================================
// W19.F3.03 — the CSV header is read as a header (finding 3)
// ===========================================================================

describe('unit:W19.F3.03', () => {
  it('host: a header-only CSV and an all-blank-row CSV carrying a case-variant column are refused naming the column, exactly as a CSV with data rows is', async () => {
    const withData = await feedFixture();
    const dataRow = { id: 'cnt-one', customerContentId: 'CMS-ONE', type: 'editorial', title: 'One', tags: 'line:Tabby', slotTypes: 'story' };
    const variantColumns = CSV_HEADER.map(column => column === 'tags' ? 'Tags' : column);

    // The refusal the merged contract already gives when a row follows the
    // header (`routes/content.ts:388-394`), quoted here as the one representation
    // all three shapes must share.
    const refusedWithData = await withData.importCsv(csvOf(variantColumns, [dataRow]));
    expect(refusedWithData.status, 'a CSV with data rows refuses the case-variant column').toBe(422);
    const expectedErrors = refusedWithData.errors ?? [];
    expect(expectedErrors.join(' | '), 'and names the column it sent').toContain('Tags');
    expect(expectedErrors.join(' | '), 'and the spelling the contract publishes').toContain('tags');

    // 1. Header only: the columns are the parsed HEADER, not the keys of a first
    //    record that does not exist. Probe B measured `no records found in the
    //    import` here, which names neither the column nor the defect.
    const headerOnly = await feedFixture();
    const headerOnlyAnswer = await headerOnly.importCsv(`${variantColumns.join(',')}\n`);
    expect(headerOnlyAnswer.status, 'a header-only CSV with a case-variant column is refused').toBe(422);
    expect((headerOnlyAnswer.errors ?? []).join(' | '),
      'W19.F3.03 — a header-only CSV must be refused by naming the case-variant column, not by reporting no records')
      .toContain('Tags');
    expect(headerOnlyAnswer.errors,
      'W19.F3.03 — and the refusal is the same one a CSV with data rows gets').toEqual(expectedErrors);

    // 2. A header followed by a row whose every cell is blank: `parseCsv` keeps
    //    no such row, so the first record is missing again, and the header still
    //    carries the defect.
    const allBlank = await feedFixture();
    const allBlankAnswer = await allBlank.importCsv(`${variantColumns.join(',')}\n${variantColumns.map(() => '').join(',')}\n`);
    expect(allBlankAnswer.status, 'an all-blank CSV with a case-variant column is refused').toBe(422);
    expect(allBlankAnswer.errors,
      'W19.F3.03 — an all-blank CSV is refused by the same named column refusal').toEqual(expectedErrors);

    // 3. Nothing is stored by either refused feed.
    expect((await headerOnly.read()).document.pieces, 'W19.F3.03 — the header-only feed stores nothing').toEqual([]);
    expect((await allBlank.read()).document.pieces, 'W19.F3.03 — the all-blank feed stores nothing').toEqual([]);

    // 4. A header-only CSV whose columns are all documented is still the empty
    //    feed it is, refused for carrying no records — the existing behaviour,
    //    kept so this unit does not turn every empty import into a column error.
    const empty = await feedFixture();
    const emptyAnswer = await empty.importCsv(`${CSV_HEADER.join(',')}\n`);
    expect(emptyAnswer.status, 'a header-only CSV with correct columns is refused for carrying no records').toBe(422);
    expect((emptyAnswer.errors ?? []).join(' | '),
      'W19.F3.03 — and that refusal still says what is wrong with it').toContain('no records found');
  });
});

// ===========================================================================
// W19.F3.04 — PIECE_FIELDS is locked to the validator (finding 4)
// ===========================================================================

/** Kit 03 :133-149 "The content piece": every field the published contract lists. */
const KIT_03_FIELDS = ['id', 'customerContentId', 'type', 'title', 'subtitle', 'excerpt', 'runtime', 'tags', 'slotTypes',
  'lifecycle', 'window', 'art', 'renderUrl', 'merchandising', 'journeyStageFit', 'freshnessDate', 'featuredProductIds', 'inStock'];

describe('unit:W19.F3.04', () => {
  it('logic: the exported field set is exactly the published contract\'s field list', () => {
    // Finding 4: `PIECE_FIELDS` (src/content/kinds.ts:33-35) is a hand-written
    // copy of what `validatePiece` reads. Its witness is not the code it copies
    // but the published contract it must equal, so the set is locked to kit 03
    // rather than to itself.
    expect([...PIECE_FIELDS].sort(),
      'W19.F3.04 — the field set the write paths read a record against is exactly the field list kit 03 :133-149 publishes')
      .toEqual([...KIT_03_FIELDS].sort());
  });

  it('host: a direct PUT of a piece carrying every published field stores every one of them and raises no ignored field, and one field outside the list raises exactly one naming it', async () => {
    // The lock against drift in the other direction: a name in the set that the
    // validator does not actually read would vanish from the stored piece, and a
    // field the validator reads that the set lacks would be reported as ignored.
    const f = await feedFixture();
    const answer = await f.put([KIT_PIECE]);
    expect(answer.status, 'the whole-contract piece is published').toBe(200);
    const stored = (await f.read()).document.pieces[0]!;
    expect(Object.keys(stored).sort(),
      'W19.F3.04 — the stored piece carries exactly the fields the exported set names: a name the validator drops, or a field it emits that the set omits, is drift')
      .toEqual([...PIECE_FIELDS].sort());
    expect(stored, 'W19.F3.04 — and every one of those fields survives with the value the contract carried').toEqual(KIT_PIECE);
    expect(codesOf(answer.diagnostics),
      'W19.F3.04 — a piece made only of published fields raises no warning at all').toEqual([]);

    // One field outside the list, named once.
    const extra = await feedFixture();
    const extraAnswer = await extra.put([{ ...KIT_PIECE, vertical: 'menswear' }]);
    expect(extraAnswer.status, 'the piece carrying one unlisted field is accepted').toBe(200);
    expect(warningsOf(extraAnswer.diagnostics),
      'W19.F3.04 — exactly one warning, naming the one field outside the published list')
      .toEqual([expect.objectContaining({ code: 'ignored_field', field: 'vertical' })]);
    expect((await extra.read()).document.pieces[0],
      'W19.F3.04 — and the stored piece is the contract\'s own fields, unchanged').toEqual(KIT_PIECE);
  });
});

// ===========================================================================
// W19.F3.05 — the catalogue document's own unlisted key (finding 5)
// ===========================================================================

describe('unit:W19.F3.05', () => {
  it('host: a key the contract does not list on the catalogue document is named on the import, pull and direct-PUT answers, never dropped in silence', async () => {
    // The document a write submits carries `pieces` and the optional authored
    // `version` (src/content/kinds.ts `contentCatalog`); a feed export carries
    // the records array the request named. Any other top-level key reaches no
    // stored document, so the answer names it — the same rule as a piece's
    // unlisted field, one level up, under the ruled sibling code
    // `ignored_document_field`, which carries no record position because it
    // belongs to no record.
    //
    // THE ENVELOPE IS NOT THE DOCUMENT, stated here so the rule is one rule: a
    // PUT body's own `document`, `note` and `publicationChanges`
    // (`routes/content.ts:283-290`) and a feed body's records key — `pieces`,
    // `content`, `items`, `data`, or the key a `?path=` names
    // (`import.ts recordsFromJson`) — are how the request is carried, not keys
    // of the catalogue, and are never named. What is named is a key INSIDE the
    // submitted catalogue document that the contract does not list, beside its
    // `pieces` and its optional authored `version`.
    // Every fixture below publishes ONE clean piece (a registered dimension, a
    // safe render type, only listed fields), so the whole warning list is the
    // document-level answer and can be asserted EXACTLY. An implementation that
    // also named the envelope would add a second warning and fail here, which is
    // how the rule above is asserted rather than merely stated.
    const named = (label: string, answer: WriteAnswer) => {
      expect(answer.status, `${label}: the document carrying an unlisted key is still accepted`).toBe(200);
      expect(warningsOf(answer.diagnostics),
        `W19.F3.05 — ${label}: the answer names the document key \`vertical\` it ignored (ruled code \`ignored_document_field\`), with no record position because the key belongs to no record, and names nothing else — the envelope that carried the request is not part of the document`)
        .toEqual([{ code: 'ignored_document_field', field: 'vertical', fieldTruncated: false }]);
    };

    // The envelope negatives first, so they are measured rather than left behind
    // the unit's first RED. `routes/content.ts:295` reads
    // `candidate = document ?? body`, so a caller that omits the `document`
    // wrapper submits its own envelope as the catalogue: `note` and
    // `publicationChanges` are still how the request was carried, and a body made
    // only of them and `pieces` raises nothing at all.
    const bare = await feedFixture();
    const bareAnswer = await bare.putRaw({ pieces: [piece('one')], note: 'first' });
    expect(bareAnswer.status, 'a bare-body PUT carrying its note is accepted').toBe(200);
    expect(warningsOf(bareAnswer.diagnostics),
      'W19.F3.05 — a bare-body PUT\'s own `note` is how the request was carried, never a key of the catalogue, so nothing is named').toEqual([]);

    const related = await feedFixture();
    const relatedAnswer = await related.putRaw({ pieces: [piece('one')], publicationChanges: [] });
    expect(relatedAnswer.status, 'a PUT carrying a publicationChanges envelope is accepted').toBe(200);
    expect(warningsOf(relatedAnswer.diagnostics),
      'W19.F3.05 — and neither is `publicationChanges`').toEqual([]);

    // The authored `version` label is a listed document key and is never named.
    const authored = await feedFixture();
    const authoredAnswer = await authored.put([piece('one')], { version: 'coach-autumn' });
    expect(authoredAnswer.status, 'a document carrying its authored version label is accepted').toBe(200);
    expect(warningsOf(authoredAnswer.diagnostics),
      'W19.F3.05 — the document keys the contract does list raise nothing').toEqual([]);

    // Now the positives. Each answer is asserted EXACTLY, so an implementation
    // that also named the feed's records key (`content`, or the key a `?path=`
    // names), `note` or `publicationChanges` fails here.
    const viaPut = await feedFixture();
    named('direct PUT', await viaPut.put([piece('one')], { vertical: 'menswear' }));
    expect((await viaPut.read()).document.pieces, 'W19.F3.05 — the piece itself is stored').toEqual([{ ...piece('one'), lifecycle: { status: 'live' } }]);

    const viaImport = await feedFixture();
    named('JSON import', await viaImport.importJson([piece('one')], 'replace', undefined, { vertical: 'menswear' }));

    const viaPull = await feedFixture();
    named('pull', await viaPull.pull([piece('one')], 'replace', { vertical: 'menswear' }));

    const viaPath = await feedFixture();
    named('JSON import through ?path=', await viaPath.importPath({ rows: [piece('one')], vertical: 'menswear' }, 'rows'));
  });
});

// ===========================================================================
// W19.F3.06 — a request position is not a stored position (finding 6)
// ===========================================================================

describe('unit:W19.F3.06', () => {
  it('host: on a merge where the request position and the stored position differ, the request-derived code names recordIndex and the stored-catalogue code names pieceIndex', async () => {
    const f = await feedFixture();
    // Two stored pieces. The merge that follows carries ONE record, for the
    // SECOND of them, so the request position (0) and the stored position (1)
    // are different numbers.
    expect((await f.put([piece('first'), piece('second')])).status, 'two pieces are published').toBe(200);
    const answer = await f.importJson([{ ...piece('second'), tags: { occassion: ['evening'] }, vertical: 'menswear' }], 'merge');
    expect(answer.status, 'the merge refresh is accepted').toBe(200);
    expect((await f.read()).document.pieces.map(stored => stored.id),
      'the refreshed piece is the second stored one').toEqual(['first', 'second']);

    const ignored = warningsOf(answer.diagnostics).filter(warning => warning.code === 'ignored_field');
    expect(ignored,
      'W19.F3.06 — the request-derived code names the position IN THE REQUEST (ruled member `recordIndex`) and carries no stored position, because the record it came from is not a stored piece')
      .toEqual([{ code: 'ignored_field', recordIndex: 0, field: 'vertical', fieldTruncated: false }]);

    const registry = warningsOf(answer.diagnostics).filter(warning => warning.code === 'unknown_dimension');
    expect(registry,
      'W19.F3.06 — and the stored-catalogue code keeps naming the STORED position, which for this piece is 1')
      .toEqual([{ code: 'unknown_dimension', pieceIndex: 1, dimensionIndex: 0, dimension: 'occassion', dimensionTruncated: false }]);
  });
});

// ===========================================================================
// W19.F3.07 — the privacy bound of the echo (owner-visible item (a))
// ===========================================================================

describe('unit:W19.F3.07', () => {
  it('host: the case-variant echo is bounded to twenty spellings of sixty-four code units with its truncation flags, and no warning carries a piece id or a customer content id', async () => {
    const f = await feedFixture();
    // Twenty-four spellings of one value, one of them 70 code units long, on a
    // dimension whose name is 80 code units long — and a piece whose OWN ids
    // read like taxonomy (`cnt-collision-01`, `evening`) while being ABSENT from
    // every value this catalogue echoes, so a leaked identifier is a string the
    // exact accounting below does not expect and cannot be mistaken for an
    // echoed value. kit 02 :396: "IDs are not echoed, and tag values only as the
    // bounded `case_variant_value` spellings above."
    const longDimension = 'x'.repeat(80);
    // Twenty-four spellings of ONE value: the same 72-code-unit word with the
    // case of its first five letters varied, so every one of them folds to the
    // same value and the whole set is one collision, over both bounds at once.
    const longValue = 'tabbyevening'.repeat(6); // 72 code units
    const spellings = Array.from({ length: 24 }, (_, index) =>
      [...longValue].map((character, position) => position < 5 && (index >> position) % 2 ? character.toUpperCase() : character).join(''));
    const colliding = {
      id: 'cnt-collision-01', customerContentId: 'evening',
      type: 'editorial', title: 'The Tabby Edit', slotTypes: ['story'],
      tags: { line: [...new Set(['tabby', 'Tabby', 'TABBY'])], [longDimension]: ['secret-value'] },
    };
    const answer = await f.put([colliding, { ...piece('variants'), tags: { line: spellings } }]);
    expect(answer.status, 'the colliding catalogue is published').toBe(200);

    // 1. The echo is bounded, and says when it truncated.
    const echoes = warningsOf(answer.diagnostics).filter(warning => warning.code === 'case_variant_value');
    expect(echoes.length, 'W19.F3.07 — one echo per colliding value: the three spellings on the first piece and the set on the second').toBe(2);
    const wide = echoes.find(warning => (warning.values ?? []).length > 3)!;
    expect(wide.values!.length, 'W19.F3.07 — at most twenty spellings are echoed').toBe(20);
    expect(wide.valuesTruncated, 'W19.F3.07 — and the answer says it truncated them').toBe(true);
    expect([...new Set(wide.values!.map(value => value.length))],
      'W19.F3.07 — every echoed spelling is cut to the sixty-four-code-unit bound').toEqual([64]);
    expect(wide.values!,
      'W19.F3.07 — the echoed spellings are the first twenty in order, each cut to the bound: nothing is dropped whole and nothing is echoed whole')
      .toEqual([...spellings].sort().slice(0, 20).map(value => value.slice(0, 64)));

    // 2. The dimension name is bounded the same way, with its own flag.
    const unknown = warningsOf(answer.diagnostics).filter(warning => warning.code === 'unknown_dimension');
    expect(unknown,
      'W19.F3.07 — the unregistered dimension is echoed cut to sixty-four code units, with the truncation flag')
      .toEqual([{ code: 'unknown_dimension', pieceIndex: 0, dimensionIndex: 1, dimension: 'x'.repeat(64), dimensionTruncated: true }]);

    // 3. No identifier reaches the channel, in two independent ways. First by
    //    KEY: the members the warnings carry are exactly the published ones, so
    //    no warning gained an `id` or a `customerContentId` field.
    expect([...new Set(warningsOf(answer.diagnostics).flatMap(warning => Object.keys(warning)))].sort(),
      'W19.F3.07 — the warnings carry exactly the members the contract publishes, and no identifier member')
      .toEqual(['code', 'dimension', 'dimensionIndex', 'dimensionTruncated', 'pieceIndex', 'values', 'valuesTruncated']);

    //    Second by VALUE: the exact set of strings the warnings carry, derived
    //    from the fixture, rather than a pattern the next fixture could evade.
    //    Neither `cnt-collision-01` nor `evening` is an echoed value here, so a
    //    leak of either is a string this accounting does not expect.
    const strings = new Set<string>();
    const walk = (value: unknown) => {
      if (typeof value === 'string') strings.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(walk);
    };
    walk(warningsOf(answer.diagnostics));
    expect([...strings].sort(),
      'W19.F3.07 — the channel carries exactly its codes, the dimension names and the tag values it echoes, and no piece id or customer content id')
      .toEqual([...new Set(['case_variant_value', 'unknown_dimension', 'line', 'x'.repeat(64),
        ...['tabby', 'Tabby', 'TABBY'].sort(),
        ...[...spellings].sort().slice(0, 20).map(value => value.slice(0, 64))])].sort());
  });
});

// ===========================================================================
// W19.F3.08 — what `changed` is measured against (owner-visible item (c))
// ===========================================================================

describe('unit:W19.F3.08', () => {
  /** The publication this unit retries, and the exact request that made it. */
  async function retryFixture() {
    const f = await feedFixture();
    expect((await f.put([piece('one'), piece('two'), piece('three')])).status, 'three pieces are published').toBe(200);
    const retryHeaders = await f.headers();
    const feed = [piece('one'), piece('two', { title: 'Two, refreshed' })];
    const original = await f.importJson(feed, 'replace', retryHeaders);
    expect(original.status, 'the original import is accepted').toBe(200);
    return { f, retryHeaders, feed, original };
  }

  it('host: an exact-request retry answers the retained revision and the same changed count, and says what it was measured against', async () => {
    // The retry: same precondition, same idempotency key. The publication serves
    // the retained answer (kit 03 :158, "exact-request retries still apply"),
    // and the answer a retry serves is the answer the original gave.
    const { f, retryHeaders, feed, original } = await retryFixture();
    expect(original.changed, 'one piece altered').toBe(1);
    const retried = await f.importJson(feed, 'replace', retryHeaders);
    expect(retried.status, 'the exact request is retried').toBe(200);
    expect(retried.revision, 'the retry serves the retained revision').toBe(original.revision);
    expect(retried.changed, 'W19.F3.08 — and the same `changed` the original answered, measured against the same base').toBe(original.changed);
    expect(retried.changedBasis,
      'W19.F3.08 — the answer says what `changed` was measured against (ruled member `changedBasis`)').toBe('stored');
  });

  it('host: a retry whose declared base revision the store cannot read says so by name instead of counting every piece as created', async () => {
    // The base revision the answer declares is unreadable — a storage outage on
    // that one object, the case the W19-B1 reviewer measured as an overcount,
    // where the fallback treats the base as the empty catalogue and reports
    // every stored piece as created (`routes/content.ts:366-370`). The fixture
    // rewrites that one body in its OWN in-memory R2 with invalid JSON; nothing
    // is deleted and no other object is touched.
    const { f, retryHeaders, feed, original } = await retryFixture();
    const base = original.revision! - 1;
    const key = [...f.storage.objects.keys()].find(name => name.endsWith(`/content/rev/${base}.json`))!;
    expect(key, 'the fixture found the stored body of the declared base revision').toBeTruthy();
    f.storage.objects.set(key, '{ this is not the revision body }');
    const unreadable = await f.importJson(feed, 'replace', retryHeaders);
    expect(unreadable.status, 'the retry with an unreadable base still serves its retained revision').toBe(200);
    expect(unreadable.revision, 'at the same revision').toBe(original.revision);
    expect(unreadable.changedBasis,
      'W19.F3.08 — an answer that cannot read the base it would measure against says so by name').toBe('unavailable');
    expect(unreadable.changed,
      'W19.F3.08 — and reports no count at all rather than counting every stored piece as created').toBe(null);
    expect(unreadable.removed,
      'W19.F3.08 — the same for what it would have called removed').toBe(null);
  });
});
