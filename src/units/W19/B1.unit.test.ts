// src/units/W19/B1.unit.test.ts
// W19 batch B1 — the lossless import / pull / direct-PUT / merge contract, the
// stage and tag vocabulary, the never-silent taxonomy, and the canonical
// content type that both accumulation and ranking read.
//
// One `describe('unit:W19.<id>')` per unit of batch W19-B1, one `it` per ruled
// leg. Every expected value comes from a witness, never from what the engine
// returns today:
//   · document 35 §5 W19·G2: "One lossless, versioned import/direct-PUT/merge
//     contract for merchandising, lifecycle/windows, stage aliases, registry
//     tags and locale/slot vocabulary. Canonical content type drives accumulated
//     signals and ranking, including existing film/video mismatch … warn/reject
//     unusable taxonomy and prove idempotent round trips."
//   · document 35 §2 F27 (:207): "The original remedy called for a lossless
//     canonical normalizer, not routing good data through today's lossy one.
//     Preserve merge/lifecycle/window semantics and supported fields".
//   · document 35 §3 N15 (:277): "Signals accumulate on piece type while scoring
//     uses tags.contentType. Existing film/video disagreement defeats
//     mirror-if-missing normalization."
//   · docs/architecture/35-verification-reports/F27.md §4.2 (direct PUT
//     deliberately bypasses the normalizer and must stay correct — the lossless
//     property is proved by a round trip, never by routing PUT through the
//     adapter), §5.1 (a feed refresh must not resurrect retired content), §5.2
//     (a tag-less feed must not be silently accepted), §5.3 (the case-sensitive
//     CSV header), §5.4 ("there is no warning channel at all"), §5.8
//     (case-variant values survive both paths with no warning), probe 6 (a
//     duplicated value tripled a score and took the hero).
//   · the customer-facing contract docs/kit/03-payload-schemas.md "The content
//     piece" (:102-:130, every field of the fixture below), :131-:152 (merge is
//     a partial upsert by id; CSV uses `status`, `windowFrom`, `windowTo`;
//     supplied arrays/tags/merchandising replace the whole field), :155 ("Current
//     catalog validation refuses duplicate exact tag values; import deduplicates
//     supplied tags"), :158 ("Existing revision preconditions and exact-request
//     retries still apply"), :259-:266 (Content format affinity: `type: "film"`
//     with `tags.contentType: ["video"]` "therefore learns and ranks on
//     `video`"; an absent own tag uses the safe `type`; explicit tags win),
//     :276 (new receipts carry `inputs.replay.contentTypes: "catalog-tags-v1"`).
//   · docs/PS-Implementation-Delivery-Guide.md :113 (`journey_stage_fit`:
//     "Their words are accepted as written; `early`/`mid`/`late` also accepted")
//     and :107 (kit 03 is the authoritative field list).
//   · docs/architecture/tapestry_requirements.txt A.3.6 (the customer's own
//     metadata table: `journey_stage_fit [explore, consider] or [decide]`,
//     `occasion_tags`, `featured_product_ids`, `content_format`,
//     `freshness_date`) — the taxonomy in every fixture below is Coach's own
//     (Tabby, Rogue, evening, Handbags), held in this fixture and never in
//     product code (METHOD §6).
//   · rulings R19 (host legs drive the mounted routes production serves),
//     R21 (a ruled-but-absent member is named), R47/R67 (the tenant's PUBLISHED
//     registry and catalogue are the vocabulary, never a bundled list),
//     R69(a)-(g) (this batch's readings).
//
// ONE REPRESENTATION, SHARED BY EVERY UNIT BELOW, so no two units demand
// opposite things of the same fixture:
//   (i)   The catalogue's canonical stored form is what `CONTENT_KIND.validate`
//         emits. "Lossless" means: every field of kit 03 "The content piece"
//         comes back with the same value through JSON import, CSV import, the
//         pull source and direct PUT; "idempotent" means re-importing what the
//         store returns leaves `pieces` byte-identical.
//   (ii)  Duplicate exact tag values are REFUSED on the direct-PUT/publication
//         path, naming the piece and dimension, and DEDUPLICATED by the import
//         adapter (kit 03 :155, the published contract, and the frozen W19.01
//         disposition). The probe-6 property this batch asserts is therefore the
//         invariant behind both: a duplicated value can never inflate a served
//         score on any path. This unit does NOT demand that a direct PUT store a
//         deduplicated piece, because the published customer contract and
//         `src/routes/content.test.ts` "W19.01 retains historical duplicate-tag
//         receipts … while new writes refuse duplicate tags" fix the refusal.
//   (iii) Every taxonomy defect is NAMED on the answer through the existing
//         advisory channel `diagnostics` (`src/content/catalogDiagnostics.ts`,
//         schema `catalog-registry-diagnostics/v1`), never silently rewritten.
//         An answer with `warningCount: 0` is "accepted clean"; one with
//         `warningCount > 0` and the named warnings is "accepted with warnings".
//   (iv)  A feed defect that is detectable AS a defect — a CSV column header
//         that matches a known column only case-insensitively — is refused with
//         422 naming the column, never accepted into an empty taxonomy.
//   (v)   The canonical content type is `tags.contentType` when the piece names
//         it and the piece's `type` only when it does not; that one value is
//         what accumulation stores and what ranking reads.
//
// RULED MISSING MEMBERS (R21), asserted here by the names this specification
// rules and RED until they exist. No new export is ruled; each is a member of an
// answer the mounted routes already return:
//   1. `diagnostics.warnings[]` gains `{ code: 'ignored_field', pieceIndex,
//      field }` — a field (JSON) or column (CSV) the published contract does not
//      list is named on the answer instead of vanishing (unit W19.F1.01;
//      F27 §5.4). Today the two codes are `unknown_dimension` and
//      `no_nonempty_registered_tags` (`catalogDiagnostics.ts:7-8`) and the
//      normalizer drops an unlisted field with no word at all
//      (`import.ts:58-95`, positively asserted at `import.test.ts:22`).
//   2. The import / pull answer gains `changed: number` — how many stored pieces
//      this import created or altered, so a byte-identical re-import reports
//      `changed: 0` (unit W19.F1.03). Today the answer carries only `received`,
//      `imported`, `pieces`, `revision`, `publication`, `version` and
//      `diagnostics` (`routes/content.ts:315-317`).
//   3. `diagnostics.warnings[]` gains `{ code: 'case_variant_value', pieceIndex,
//      dimension, values }` — `values` is the exact set of spellings of one
//      value that differ only by case, sorted, so `['Tabby', 'tabby']` names
//      both (unit W19.F2.02; F27 §5.8). Nothing is rewritten: the stored tags
//      keep both spellings.
// Two further RED outcomes need no new member, only the behaviour:
//   4. A CSV header carrying `Tags` for `tags` is refused 422 with an error
//      naming the column (unit W19.F2.03; F27 §5.3). Today `parseCsv` accepts
//      it and every piece stores `tags: {}`.
//   5. An unknown journey-stage word is refused with an error naming the piece
//      AND THE WORD (unit W19.F2.01). Today `kinds.ts:100` names the piece and
//      the accepted vocabulary but never the offending word.

import { describe, it, expect, vi } from 'vitest';
import * as jose from 'jose';
import { Hono } from 'hono';

import type { Env } from '@/types/env';
import type { ContentPiece, SlotStrategy } from '@/content/types';
import { contentRoutes } from '@/routes/content';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { decideContent } from '@/content/decide';
import { contentTypeValues } from '@/content/typeAffinity';
import { resolvedContentTouches } from '@/reflex/contentTelemetry';
import { replayDecision } from '@/learn/replay';
import { captureRetention, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent } from '@/content/consent';
import { invalidateLiftCache } from '@/content/service';
import { configuredDestinations } from '@/connectors/config';

// ---------------------------------------------------------------------------
// Shared synthetic bindings. Modelled on `src/routes/content.test.ts` (the
// content-route fixture) and `src/units/W16/C8.unit.test.ts` (the two shopper
// hosts); neither suite is imported and neither is edited.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Harness A — the mounted content routes, the paths an operator and a CMS use
// (R19): POST /content/catalog/import (JSON and CSV), POST /content/catalog/pull,
// PUT /content/catalog and GET /content/catalog.
// ---------------------------------------------------------------------------

const FEED_TENANT = 'coach';
const FEED_HOST = 'https://synthetic.invalid/content';
const FEED_SECRET = 'w19-b1-synthetic-route-signing-material-only';

/** One warning of the advisory diagnostics channel the answers already carry. */
interface UnitWarning {
  code: string;
  pieceIndex?: number;
  dimensionIndex?: number;
  dimension?: string;
  /** RULED, ABSENT TODAY (R21): the field or CSV column the contract does not list. */
  field?: string;
  /** RULED, ABSENT TODAY (R21): the exact case-variant spellings of one value, sorted. */
  values?: string[];
}
interface UnitDiagnostics {
  schema?: string;
  status?: string;
  warningCount?: number | null;
  omittedWarningCount?: number | null;
  warnings?: UnitWarning[] | null;
}
interface WriteAnswer {
  status: number;
  ok?: boolean;
  errors?: string[];
  error?: string;
  revision?: number;
  version?: string;
  pieces?: number;
  received?: number;
  imported?: number;
  /** RULED, ABSENT TODAY (R21): how many stored pieces this import created or altered. */
  changed?: number;
  diagnostics?: UnitDiagnostics;
}
interface ReadAnswer {
  status: number;
  revision: number;
  document: { pieces: Record<string, unknown>[] };
  diagnostics?: UnitDiagnostics;
}

const feedKinds = [CONTENT_KIND, SLOTS_KIND, LEARN_KIND, REFLEX_KIND, PRIORS_KIND, PROPOSALS_KIND];

async function feedFixture(initial = EMPTY_CATALOG) {
  invalidateCache();
  const storage = new UnitR2();
  const env = { CACHE: new UnitKV(), STORAGE: storage, JWT_SECRET: FEED_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: JSON.stringify({ provisioned: [FEED_TENANT], operatorGrants: { ops: [FEED_TENANT] } }) } as unknown as Env;
  const values: unknown[] = [initial, DEFAULT_SLOTS, DEFAULT_LEARN, DEFAULT_REFLEX_CONFIG, EMPTY_PRIORS, EMPTY_PROPOSALS];
  await initializePublicationSet(env, feedKinds.map((kind, i): PublicationBaseline => ({
    kind, scope: kind.name === 'reflex' ? reflexScopeForTenant(FEED_TENANT) : FEED_TENANT,
    revision: { revision: 1, value: values[i], actor: 'w19-b1-fixture', note: '', at: 1 },
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
  /** The publication precondition headers the write paths require, at the catalog's current revision. */
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
    /** POST /content/catalog/import, a JSON export. */
    importJson: (records: unknown[], mode: 'replace' | 'merge' = 'replace', given?: Record<string, string>) =>
      write(`/catalog/import?scope=${FEED_TENANT}&mode=${mode}`, JSON.stringify({ content: records }), {}, given),
    /** POST /content/catalog/import, the documented CSV columns. */
    importCsv: (text: string, mode: 'replace' | 'merge' = 'replace') =>
      write(`/catalog/import?scope=${FEED_TENANT}&format=csv&mode=${mode}`, text, { 'Content-Type': 'text/csv' }),
    /** POST /content/catalog/pull, the CMS/DAM seam, against a mocked source. */
    pull: async (records: unknown[], mode: 'replace' | 'merge' = 'replace') => {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: records })));
      try {
        return await write(`/catalog/pull?scope=${FEED_TENANT}`, JSON.stringify({ url: 'https://cms.example.invalid/export.json', path: 'content', mode }));
      } finally { spy.mockRestore(); }
    },
    /** PUT /content/catalog, the full replace that deliberately bypasses the normalizer (F27 §4.2). */
    put: async (pieces: unknown[]) =>
      answer(await request(`/catalog?scope=${FEED_TENANT}`, { method: 'PUT', headers: await headers(), body: JSON.stringify({ document: { pieces } }) })),
  };
}

// ---------------------------------------------------------------------------
// The fixture piece: every field of kit 03 "The content piece" (:102-:130), on
// Coach's own taxonomy (tapestry_requirements A.3.6 and the kit's own example
// `{ "line": ["Tabby"], "occasion": ["evening"], "contentType": ["video"] }`).
// `type` is the rendering kind `film` while the format tag says `video`: the
// exact N15 disagreement, so the same fixture serves F1 and T1.
// ---------------------------------------------------------------------------

const KIT_PIECE = {
  id: 'cnt-tabby-film',
  customerContentId: 'CMS-TABBY-FILM-26',
  type: 'film',
  title: 'The Tabby, After Dark',
  subtitle: 'Ninety seconds in evening light',
  excerpt: 'The Tabby 26, shot at dusk; a study in quilting, chain and shoulder.',
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

/** A second complete piece, so a round trip is proved on more than one row. */
const KIT_PIECE_TWO = {
  id: 'cnt-rogue-editorial',
  customerContentId: 'CMS-ROGUE-REBUILT',
  type: 'editorial',
  title: 'The Rogue, Rebuilt',
  subtitle: 'Hardware, restated',
  excerpt: 'What changed on the Rogue, and why the turnlock stayed.',
  runtime: '00:00:00',
  tags: { line: ['Rogue'], category: ['Handbags'], contentType: ['editorial'] },
  slotTypes: ['story'],
  lifecycle: { status: 'live' },
  window: { from: '2026-02-01T00:00:00.000Z', to: '2026-11-30T00:00:00.000Z' },
  art: 'https://cdn.example.invalid/w19/rogue-rebuilt.jpg',
  renderUrl: 'https://www.example.invalid/stories/rogue-rebuilt',
  merchandising: { season: 0.2, promotion: 0, margin: 0.75 },
  journeyStageFit: ['considering', 'deciding'],
  freshnessDate: '2026-08-15T00:00:00.000Z',
  featuredProductIds: ['COA-CP133'],
  inStock: true,
};

type KitPiece = typeof KIT_PIECE;

/** The documented CSV columns for the fields above (kit 03 :102, :131-:152). */
const CSV_HEADER = ['id', 'customerContentId', 'type', 'title', 'subtitle', 'excerpt', 'runtime', 'tags', 'slotTypes',
  'status', 'art', 'renderUrl', 'windowFrom', 'windowTo', 'merchandising', 'journeyStageFit', 'freshnessDate',
  'featuredProductIds', 'inStock'] as const;

const csvCell = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const csvOf = (columns: readonly string[], rows: Record<string, string>[]) =>
  [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column] ?? '')).join(','))].join('\n') + '\n';

/** One stored piece rendered back into the documented CSV row, for the round trip. */
function csvRowOf(piece: Record<string, unknown>): Record<string, string> {
  const p = piece as unknown as KitPiece & { window?: { from?: string; to?: string } };
  const list = (values?: readonly string[]) => (values ?? []).join('|');
  return {
    id: p.id, customerContentId: p.customerContentId, type: p.type, title: p.title,
    subtitle: p.subtitle ?? '', excerpt: p.excerpt ?? '', runtime: p.runtime ?? '',
    tags: Object.entries(p.tags ?? {}).map(([dimension, values]) => `${dimension}:${(values as string[]).join('|')}`).join(';'),
    slotTypes: list(p.slotTypes), status: p.lifecycle?.status ?? '',
    art: typeof p.art === 'string' ? p.art : '', renderUrl: p.renderUrl ?? '',
    windowFrom: p.window?.from ?? '', windowTo: p.window?.to ?? '',
    merchandising: p.merchandising ? JSON.stringify(p.merchandising) : '',
    journeyStageFit: list(p.journeyStageFit), freshnessDate: p.freshnessDate ?? '',
    featuredProductIds: list(p.featuredProductIds), inStock: typeof p.inStock === 'boolean' ? String(p.inStock) : '',
  };
}

const warningsOf = (diagnostics?: UnitDiagnostics): UnitWarning[] => diagnostics?.warnings ?? [];

// ===========================================================================
// W19.F1.01 — the lossless field set on every path
// ===========================================================================

describe('unit:W19.F1.01', () => {
  it('host: every field of the published content piece survives JSON import, CSV import, the pull source and direct PUT, and a field the contract does not list is named on the answer', async () => {
    const expected = [KIT_PIECE];

    // 1. JSON import (replace): the whole kit-03 piece, stored value for value.
    const json = await feedFixture();
    expect((await json.importJson([KIT_PIECE])).status, 'JSON import of the documented piece is accepted').toBe(200);
    expect((await json.read()).document.pieces,
      'W19.F1.01 — JSON import must store every field of kit 03 "The content piece" with its supplied value').toEqual(expected);

    // 2. CSV import (replace), the documented column names (kit 03 :102: "a CSV
    //    row with the same names as columns"; :151 CSV uses status/windowFrom/windowTo).
    const csv = await feedFixture();
    expect((await csv.importCsv(csvOf(CSV_HEADER, [csvRowOf(KIT_PIECE)]))).status, 'the documented CSV row is accepted').toBe(200);
    expect((await csv.read()).document.pieces,
      'W19.F1.01 — a CSV row of the documented columns must store the same piece as the JSON export').toEqual(expected);

    // 3. The pull seam (the CMS/DAM adapter the PS guide §7 routes onboarding through).
    const pulled = await feedFixture();
    expect((await pulled.pull([KIT_PIECE])).status, 'the pulled export is accepted').toBe(200);
    expect((await pulled.read()).document.pieces,
      'W19.F1.01 — the pull source must store the same piece as the JSON export').toEqual(expected);

    // 4. Direct PUT, which deliberately bypasses the normalizer (F27 §4.2) and
    //    must remain the correct path, not be routed through the adapter.
    const direct = await feedFixture();
    expect((await direct.put([KIT_PIECE])).status, 'the direct PUT of the documented piece is accepted').toBe(200);
    expect((await direct.read()).document.pieces,
      'W19.F1.01 — direct PUT must store the same piece as every feed path').toEqual(expected);

    // 5. A field the published contract does not list is dropped from the stored
    //    piece — and NAMED on the answer. F27 §5.4: "There is no warning channel
    //    at all … Every failure in this finding is silent by design."
    const extra = await feedFixture();
    const answer = await extra.importJson([{ ...KIT_PIECE, vertical: 'menswear' }]);
    expect(answer.status, 'a record carrying an unlisted field is still accepted').toBe(200);
    expect((await extra.read()).document.pieces,
      'W19.F1.01 — the unlisted field is not stored on the piece').toEqual(expected);
    expect(warningsOf(answer.diagnostics),
      'W19.F1.01 — the import answer must name the unlisted field `vertical` it ignored (ruled diagnostics code `ignored_field`), never drop it without a word')
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ignored_field', field: 'vertical' })]));

    // The same for a CSV column the contract does not list: an ignored column
    // is named (R69(d): "every ignored column … is named in a diagnostics channel").
    const extraCsv = await feedFixture();
    const csvAnswer = await extraCsv.importCsv(csvOf([...CSV_HEADER, 'vertical'], [{ ...csvRowOf(KIT_PIECE), vertical: 'menswear' }]));
    expect(csvAnswer.status, 'a CSV carrying an unlisted column is still accepted').toBe(200);
    expect(warningsOf(csvAnswer.diagnostics),
      'W19.F1.01 — the CSV import answer must name the ignored column `vertical`')
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ignored_field', field: 'vertical' })]));
  });
});

// ===========================================================================
// W19.F1.02 — merge preserves what the feed omits; replace replaces
// ===========================================================================

describe('unit:W19.F1.02', () => {
  it('host: a merge refresh that omits lifecycle, window, merchandising, art or tags keeps the stored values, a retired piece stays retired with its stop date, a stated field replaces, and replace mode replaces the catalogue', async () => {
    // A retired campaign, exactly the case F27 §5.1 reproduced: stored
    // `lifecycle.status: 'expired'`, a closed window, art and merchandising.
    const retired = {
      ...KIT_PIECE, id: 'cnt-festival-campaign', customerContentId: 'CMS-FESTIVAL-24',
      title: 'Festival Charms', type: 'editorial',
      tags: { line: ['Tabby'], occasion: ['festival'], contentType: ['editorial'] },
      lifecycle: { status: 'expired' },
      window: { from: '2026-03-01T00:00:00.000Z', to: '2026-04-01T00:00:00.000Z' },
      merchandising: { promotion: 1 },
      art: 'https://cdn.example.invalid/w19/festival-charms.jpg',
    };
    const f = await feedFixture();
    expect((await f.put([retired, KIT_PIECE_TWO])).status, 'the retired campaign and its rival are published').toBe(200);

    // 1. A merge refresh naming only the id and the title: everything the feed
    //    omits is preserved (kit 03 :131-:134, "merge is a partial upsert by id:
    //    omitted supported fields preserve the existing item").
    const refresh = await f.importJson([{ id: retired.id, title: 'Festival Charms, Revisited' }], 'merge');
    expect(refresh.status, 'the merge refresh is accepted').toBe(200);
    expect((await f.read()).document.pieces[0],
      'W19.F1.02 — the omitted lifecycle, window, merchandising, art and tags keep their stored values; only the stated title replaces')
      .toEqual({ ...retired, title: 'Festival Charms, Revisited' });

    // 2. The same through the CSV path, whose blank cells mean omitted, not
    //    cleared (kit 03 :151). The tags column is absent from the header.
    const csv = 'id,title\n' + `${retired.id},Festival Charms CSV\n`;
    expect((await f.importCsv(csv, 'merge')).status, 'the CSV merge refresh is accepted').toBe(200);
    const afterCsv = (await f.read()).document.pieces[0];
    expect(afterCsv,
      'W19.F1.02 — a CSV refresh without the tags column keeps the stored taxonomy, lifecycle, window, merchandising and art')
      .toEqual({ ...retired, title: 'Festival Charms CSV' });

    // 3. The retired piece is still retired, and still carries its stop date:
    //    the governance failure F27 §5.1 names is that a refresh resurrects it.
    expect((afterCsv as { lifecycle: unknown }).lifecycle,
      'W19.F1.02 — an expired piece stays expired through a refresh that says nothing about its lifecycle').toEqual({ status: 'expired' });
    expect((afterCsv as { window: unknown }).window,
      'W19.F1.02 — the closed window, including the stop date, survives the refresh').toEqual(retired.window);

    // 4. A field the feed STATES replaces the stored one, as a whole field
    //    (kit 03 :148: "Supplied arrays, tags and merchandising replace that whole field").
    expect((await f.importJson([{ id: retired.id, merchandising: { promotion: 0.25 } }], 'merge')).status).toBe(200);
    expect((await f.read()).document.pieces[0],
      'W19.F1.02 — a stated merchandising block replaces the stored one entirely')
      .toEqual({ ...retired, title: 'Festival Charms CSV', merchandising: { promotion: 0.25 } });

    // 5. Replace mode replaces the whole catalogue.
    expect((await f.importJson([KIT_PIECE], 'replace')).status).toBe(200);
    expect((await f.read()).document.pieces,
      'W19.F1.02 — a replace import replaces the catalogue with exactly the feed it carried').toEqual([KIT_PIECE]);
  });
});

// ===========================================================================
// W19.F1.03 — the idempotent round trip
// ===========================================================================

describe('unit:W19.F1.03', () => {
  it('host: re-importing the stored catalogue as JSON and as CSV, and importing one feed twice, leaves the stored pieces byte-identical and reports no changed piece', async () => {
    const f = await feedFixture();
    const first = await f.importJson([KIT_PIECE, KIT_PIECE_TWO]);
    expect(first.status, 'the first import is accepted').toBe(200);
    const stored = await f.read();
    const bytes = JSON.stringify(stored.document.pieces);
    expect(stored.document.pieces, 'both documented pieces are stored').toEqual([KIT_PIECE, KIT_PIECE_TWO]);
    expect(first.changed,
      'W19.F1.03 — the import answer must report how many stored pieces it created or altered (ruled member `changed`); this feed created two')
      .toBe(2);

    // 1. Read the stored catalogue back and import it again, unchanged.
    const again = await f.importJson(stored.document.pieces);
    expect(again.status, 'the stored catalogue is a valid feed of itself').toBe(200);
    expect(JSON.stringify((await f.read()).document.pieces),
      'W19.F1.03 — importing what the store returned leaves `pieces` byte-identical').toBe(bytes);
    expect(again.changed,
      'W19.F1.03 — re-importing the stored catalogue changes no piece, and the answer says so').toBe(0);

    // 2. The same round trip through the documented CSV columns.
    const csv = csvOf(CSV_HEADER, (await f.read()).document.pieces.map(csvRowOf));
    const viaCsv = await f.importCsv(csv);
    expect(viaCsv.status, 'the CSV rendering of the stored catalogue is accepted').toBe(200);
    expect(JSON.stringify((await f.read()).document.pieces),
      'W19.F1.03 — the CSV round trip leaves `pieces` byte-identical to the JSON round trip').toBe(bytes);
    expect(viaCsv.changed, 'W19.F1.03 — the CSV round trip changes no piece').toBe(0);

    // 3. The same feed imported twice as two distinct operations.
    const once = await f.importJson([KIT_PIECE, KIT_PIECE_TWO]);
    expect(once.status).toBe(200);
    const twice = await f.importJson([KIT_PIECE, KIT_PIECE_TWO]);
    expect(twice.status, 'the second identical import is accepted').toBe(200);
    expect(JSON.stringify((await f.read()).document.pieces),
      'W19.F1.03 — importing the same feed twice leaves `pieces` byte-identical').toBe(bytes);
    expect(twice.changed,
      'W19.F1.03 — the answer of the second import reports no changed piece').toBe(0);

    // 4. The revision behaviour is the versioned store's documented one, stated
    //    here so "idempotent" is never read as "no revision": every ACCEPTED
    //    publication allocates the next revision and stamps its label
    //    (`stampLabel`, src/content/kinds.ts:17-21 and :153, `content+rN`),
    //    while an EXACT-REQUEST RETRY — the same `If-Match` precondition and the
    //    same `Idempotency-Key` — returns the retained revision and writes
    //    nothing (kit 03 :158, "Existing revision preconditions and
    //    exact-request retries still apply"; src/config/publication.ts:335-339
    //    `sameOperation`).
    expect(twice.revision, 'each accepted import allocates the next revision, byte-identical or not').toBe(once.revision! + 1);
    expect(twice.version, 'and stamps that revision into the stored version label').toBe(`content+r${once.revision! + 1}`);
    expect((await f.read()).revision, 'which is the revision the store now serves').toBe(twice.revision);
    const retryHeaders = await f.headers();
    const retried = await f.importJson([KIT_PIECE, KIT_PIECE_TWO], 'replace', retryHeaders);
    expect(retried.status, 'the exact request is retried').toBe(200);
    const repeated = await f.importJson([KIT_PIECE, KIT_PIECE_TWO], 'replace', retryHeaders);
    expect(repeated.revision,
      'W19.F1.03 — an exact-request retry returns the retained revision rather than allocating another').toBe(retried.revision);
    expect(JSON.stringify((await f.read()).document.pieces),
      'W19.F1.03 — and the stored pieces are still byte-identical').toBe(bytes);
  });
});

// ===========================================================================
// W19.F2.01 — the stage vocabulary on every path
// ===========================================================================

/** The three vocabularies kit 03 :137 and the PS guide :113 accept, in order. */
const STAGE_FEEDS = [
  { name: "the customer's own words (A.3.6)", words: ['explore', 'consider', 'decide'] },
  { name: 'the engine\'s words', words: ['exploring', 'considering', 'deciding'] },
  { name: 'the early/mid/late aliases', words: ['early', 'mid', 'late'] },
];
/** The one canonical vocabulary they are all stored as (kinds.ts `StageWord`). */
const CANONICAL_STAGES = ['exploring', 'considering', 'deciding'];

describe('unit:W19.F2.01', () => {
  it('host: all three stage vocabularies are accepted on JSON import, CSV import, pull and direct PUT and stored as one canonical vocabulary, and an unknown stage word is refused naming the piece and the word', async () => {
    for (const feed of STAGE_FEEDS) {
      const piece = { ...KIT_PIECE, journeyStageFit: feed.words };
      const paths: Array<[string, () => Promise<WriteAnswer>]> = [];
      const json = await feedFixture(); paths.push([`JSON import · ${feed.name}`, () => json.importJson([piece])]);
      const csv = await feedFixture(); paths.push([`CSV import · ${feed.name}`, () => csv.importCsv(csvOf(CSV_HEADER, [csvRowOf(piece)]))]);
      const pulled = await feedFixture(); paths.push([`pull · ${feed.name}`, () => pulled.pull([piece])]);
      const direct = await feedFixture(); paths.push([`PUT · ${feed.name}`, () => direct.put([piece])]);
      const fixtures = [json, csv, pulled, direct];
      for (const [index, [label, run]] of paths.entries()) {
        const answer = await run();
        expect(answer.status, `${label}: the customer's stage words are accepted on every path`).toBe(200);
        expect((await fixtures[index]!.read()).document.pieces[0],
          `W19.F2.01 — ${label}: the stage words are stored as the one canonical vocabulary`)
          .toEqual({ ...KIT_PIECE, journeyStageFit: CANONICAL_STAGES });
      }
    }

    // An unknown stage word is refused, and the refusal names the piece AND the
    // word, so a content team can fix the row it came from.
    const unknown = { ...KIT_PIECE, journeyStageFit: ['awareness'] };
    for (const [label, answer] of [
      ['JSON import', await (await feedFixture()).importJson([unknown])],
      ['direct PUT', await (await feedFixture()).put([unknown])],
    ] as const) {
      expect(answer.status, `${label}: an unknown stage word refuses the write`).toBe(422);
      const errors = (answer.errors ?? []).join(' | ');
      expect(errors, `${label}: the refusal names the piece`).toContain('pieces[0].journeyStageFit');
      expect(errors,
        `W19.F2.01 — ${label}: the refusal must name the unusable word 'awareness' the feed sent, not only the accepted vocabulary`)
        .toContain('awareness');
    }
  });

  it('logic: a piece imported with the customer\'s stage words is favoured by a slot stage rule for a shopper at that stage, on the real decideContent', async () => {
    // Two guides, imported with Tapestry's own A.3.6 words; the catalogue lists
    // the exploring one FIRST, so catalogue order alone cannot produce a pass.
    const f = await feedFixture();
    const guides = [
      { id: 'cnt-guide-explore', customerContentId: 'CMS-GUIDE-EXPLORE', type: 'editorial', title: 'Start With The Icons',
        tags: { line: ['Tabby'] }, slotTypes: ['guide'], journey_stage_fit: 'explore' },
      { id: 'cnt-guide-decide', customerContentId: 'CMS-GUIDE-DECIDE', type: 'editorial', title: 'Ready When You Are',
        tags: { line: ['Tabby'] }, slotTypes: ['guide'], journey_stage_fit: 'decide' },
    ];
    expect((await f.importJson(guides)).status, 'the customer-worded guides import').toBe(200);
    const pieces = (await f.read()).document.pieces as unknown as ContentPiece[];
    expect(pieces.map(piece => piece.journeyStageFit),
      'W19.F2.01 — the customer\'s words are stored canonically before the decision reads them')
      .toEqual([['exploring'], ['deciding']]);

    // The slot's stage rule: a piece made for the shopper's stage gets the bonus,
    // one made for another stage is multiplied down (kit 03 :137).
    const slots: SlotStrategy[] = [{ slot: 'guide', take: 2, weights: {}, stage: { inStage: 0.5, outOfStage: 0 } }];
    const decision = decideContent({
      tenant: FEED_TENANT, brand: FEED_TENANT, page: 'home', visitorId: 'w19-b1-visitor', sessionId: null,
      identityAnchor: 'visitor', nowMs: Date.parse('2026-09-15T12:00:00.000Z'), pieces, slots,
      affinity: { dims: {} }, arm: 'personalized',
      cell: { channel: 'direct', visit_bucket: '1', region: 'CA', affinity: null, stage: 'late' },
      versions: { config: 1, catalog: 2, slots: 1, learn: 0, lift: 0, prior: 0, policy: 0 }, configLabel: 'w19-b1',
    });
    const served = decision.records.filter(record => record.slot === 'guide').map(record => record.item_id);
    expect(served,
      'W19.F2.01 — a shopper at the deciding stage is served the piece the customer tagged `decide` first')
      .toEqual(['cnt-guide-decide', 'cnt-guide-explore']);
    const first = decision.records.find(record => record.item_id === 'cnt-guide-decide')!;
    expect(first.explain.score_final,
      'W19.F2.01 — and the stage bonus the rule promises is on the served score').toBeCloseTo(0.5, 10);
  });
});

// ===========================================================================
// W19.F2.02 — tag hygiene on every path
// ===========================================================================

describe('unit:W19.F2.02', () => {
  it('host: a duplicated value is refused on the publication path naming the dimension and deduplicated by the feed adapter, and a case-variant value and an unregistered dimension are named in the import, pull and PUT diagnostics', async () => {
    // (1) The direct-PUT/publication path refuses an exact duplicate, naming the
    //     piece and dimension: the published contract (kit 03 :155) and the
    //     frozen W19.01 disposition. Nothing is silently rewritten (R69(d)).
    const put = await feedFixture();
    const duplicate = { ...KIT_PIECE, tags: { ...KIT_PIECE.tags, line: ['Tabby', 'Tabby'] } };
    const refused = await put.put([duplicate]);
    expect(refused.status, 'a duplicate exact tag value refuses the publication').toBe(422);
    expect((refused.errors ?? []).join(' | '),
      'W19.F2.02 — the refusal names the piece and the dimension the duplicate is on').toContain('pieces[0].tags.line');

    // (2) The feed adapter deduplicates the same row, so the stored piece counts
    //     the value once (kit 03 :155, second clause).
    const feed = await feedFixture();
    expect((await feed.importJson([duplicate])).status, 'the same row imports').toBe(200);
    expect((await feed.read()).document.pieces,
      'W19.F2.02 — the imported piece holds the duplicated value exactly once').toEqual([KIT_PIECE]);

    // (3) A case-variant value and a dimension the tenant's published registry
    //     does not name are NAMED on the answer of every write path, and neither
    //     is dropped or rewritten (F27 §5.8 and probe 5; R69(d)).
    const messy = {
      ...KIT_PIECE, id: 'cnt-messy-taxonomy', customerContentId: 'CMS-MESSY',
      tags: { line: ['Tabby', 'tabby'], occassion: ['evening'], contentType: ['video'] },
    };
    const named = async (label: string, answer: WriteAnswer, read: () => Promise<ReadAnswer>) => {
      expect(answer.status, `${label}: the messy taxonomy is accepted, not refused`).toBe(200);
      expect((await read()).document.pieces[0],
        `W19.F2.02 — ${label}: neither spelling is rewritten and the unregistered dimension is kept as authored`)
        .toMatchObject({ tags: { line: ['Tabby', 'tabby'], occassion: ['evening'] } });
      expect(warningsOf(answer.diagnostics),
        `W19.F2.02 — ${label}: the answer names the dimension the tenant's published registry does not hold`)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown_dimension', dimension: 'occassion' })]));
      expect(warningsOf(answer.diagnostics),
        `W19.F2.02 — ${label}: the answer names the two spellings of one value that differ only by case (ruled diagnostics code \`case_variant_value\`, its \`values\` sorted)`)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'case_variant_value', dimension: 'line', values: ['Tabby', 'tabby'] })]));
    };
    const viaImport = await feedFixture(); await named('JSON import', await viaImport.importJson([messy]), viaImport.read);
    const viaPull = await feedFixture(); await named('pull', await viaPull.pull([messy]), viaPull.read);
    const viaPut = await feedFixture(); await named('direct PUT', await viaPut.put([messy]), viaPut.read);
  });

  it('logic: a feed row carrying a duplicated value scores exactly as the clean row does, so no repeat can inflate a ranking (F27 probe 6)', async () => {
    // F27 probe 6: `line: ["Drover","Drover","Drover"]` tripled 0.4 to 1.2 and
    // took the hero from a better-matched piece. The invariant this batch fixes
    // in place is that a repeat buys nothing, whichever path carried it.
    const f = await feedFixture();
    const duplicated = { id: 'cnt-dup', customerContentId: 'CMS-DUP', type: 'editorial', title: 'Tabby, Every Way',
      tags: { line: ['Tabby', 'Tabby', 'Tabby'] }, slotTypes: ['hero'] };
    const clean = { id: 'cnt-clean', customerContentId: 'CMS-CLEAN', type: 'editorial', title: 'Tabby, Once',
      tags: { line: ['Tabby'] }, slotTypes: ['hero'] };
    expect((await f.importJson([duplicated, clean])).status, 'both rows import').toBe(200);
    const pieces = (await f.read()).document.pieces as unknown as ContentPiece[];

    const slots: SlotStrategy[] = [{ slot: 'hero', take: 2, weights: { line: 0.5 } }];
    const decision = decideContent({
      tenant: FEED_TENANT, brand: FEED_TENANT, page: 'home', visitorId: 'w19-b1-visitor', sessionId: null,
      identityAnchor: 'visitor', nowMs: Date.parse('2026-09-15T12:00:00.000Z'), pieces, slots,
      affinity: { dims: { line: { Tabby: 0.8 } } }, arm: 'personalized',
      cell: { channel: 'direct', visit_bucket: '1', region: 'CA', affinity: 'line:Tabby', stage: 'unknown' },
      versions: { config: 1, catalog: 2, slots: 1, learn: 0, lift: 0, prior: 0, policy: 0 }, configLabel: 'w19-b1',
    });
    const scoreOf = (id: string) => decision.records.find(record => record.item_id === id)!.explain.score_final;
    expect(scoreOf('cnt-dup'),
      'W19.F2.02 — the piece whose feed repeated one value scores exactly what the single-valued piece scores')
      .toBeCloseTo(scoreOf('cnt-clean'), 10);
    expect(scoreOf('cnt-dup'),
      'W19.F2.02 — and that score is the weighted affinity itself (0.8 × 0.5), not a multiple of it').toBeCloseTo(0.4, 10);
  });
});

// ===========================================================================
// W19.F2.03 — unusable taxonomy is never silent
// ===========================================================================

describe('unit:W19.F2.03', () => {
  it('host: a case-variant CSV header is refused naming the column, a tag-less feed is accepted with the named empty-taxonomy warning, merge leaves known tags untouched, and the answer distinguishes accepted-with-warnings from accepted-clean', async () => {
    // 1. A clean import is reported as clean: no warnings at all.
    const clean = await feedFixture();
    const cleanAnswer = await clean.importJson([KIT_PIECE, KIT_PIECE_TWO]);
    expect(cleanAnswer.status, 'the clean feed is accepted').toBe(200);
    expect(cleanAnswer.diagnostics?.status, 'the advisory channel is available').toBe('available');
    expect(cleanAnswer.diagnostics?.warningCount,
      'W19.F2.03 — a feed with a usable taxonomy is reported as accepted clean').toBe(0);
    expect(warningsOf(cleanAnswer.diagnostics), 'and it names no warning').toEqual([]);

    // 2. The case-sensitive CSV header F27 §5.3 reproduced: `Tags` instead of
    //    `tags` today yields `tags: {}` on every piece and `ok: true`. A column
    //    that matches a known column only case-insensitively is a defect that can
    //    be detected AS a defect, so it is refused, naming the column (R69(d)).
    const header = await feedFixture();
    const wrongCase = csvOf(CSV_HEADER.map(column => column === 'tags' ? 'Tags' : column), [csvRowOf(KIT_PIECE)]);
    const refused = await header.importCsv(wrongCase);
    expect(refused.status,
      'W19.F2.03 — a CSV header carrying `Tags` for `tags` is refused, never accepted into an empty taxonomy').toBe(422);
    const message = [...(refused.errors ?? []), refused.error ?? ''].join(' | ');
    expect(message, 'W19.F2.03 — the refusal names the column the feed sent').toContain('Tags');
    expect(message, 'W19.F2.03 — and the known column it only matches case-insensitively').toContain('tags');
    expect((await header.read()).document.pieces,
      'W19.F2.03 — and nothing is stored from the refused feed').toEqual([]);

    // 3. A feed with no tags at all is ACCEPTED — legitimately absent taxonomy is
    //    not a refusal — with the empty-taxonomy warning named per piece
    //    (F27 §5.2; kit 02 :368 `no_nonempty_registered_tags`).
    const tagless = await feedFixture();
    const rows = [
      { id: 'cnt-bare-one', customerContentId: 'CMS-BARE-1', type: 'editorial', title: 'Bare One', slotTypes: ['story'] },
      { id: 'cnt-bare-two', customerContentId: 'CMS-BARE-2', type: 'editorial', title: 'Bare Two', slotTypes: ['story'] },
    ];
    const taglessAnswer = await tagless.importJson(rows);
    expect(taglessAnswer.status, 'the tag-less feed is accepted').toBe(200);
    expect(taglessAnswer.diagnostics?.warningCount,
      'W19.F2.03 — an empty taxonomy is reported as accepted WITH warnings, one per piece').toBe(2);
    expect(warningsOf(taglessAnswer.diagnostics),
      'W19.F2.03 — and each piece with no usable taxonomy is named')
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'no_nonempty_registered_tags', pieceIndex: 0 }),
        expect.objectContaining({ code: 'no_nonempty_registered_tags', pieceIndex: 1 }),
      ]));

    // 4. In merge mode a feed that says nothing about tags leaves the stored
    //    taxonomy of a known id untouched (kit 03 :131-:134).
    const merge = await feedFixture();
    expect((await merge.put([KIT_PIECE])).status, 'the tagged piece is published').toBe(200);
    const taglessMerge = await merge.importJson([{ id: KIT_PIECE.id, title: 'The Tabby, After Dark (v2)' }], 'merge');
    expect(taglessMerge.status, 'the tag-less merge refresh is accepted').toBe(200);
    expect((await merge.read()).document.pieces[0],
      'W19.F2.03 — a feed with no tags leaves the stored tags of a known id exactly as they were')
      .toEqual({ ...KIT_PIECE, title: 'The Tabby, After Dark (v2)' });
    expect(taglessMerge.diagnostics?.warningCount,
      'W19.F2.03 — and because the stored taxonomy is still usable, that answer is clean').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Harness B — the two shopper hosts, for the canonical content type. The real
// mounted app, the real SessionManager path and the real ShopperReflex class,
// in the pattern of `src/units/W16/C8.unit.test.ts` and
// `src/routes/realtime.sdkContract.test.ts`.
// ---------------------------------------------------------------------------

const SHOPPER_TENANT = 'meridian';
const T0 = 1_725_000_000_000;
const STEP_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The tenant's published catalogue for the format units. `cnt-tabby-film` is
 * the N15 disagreement itself: rendering kind `film`, format tag `video`. The
 * `stories` slot weights `contentType` alone, and the catalogue lists the
 * unrelated editorial FIRST, so catalogue order can never produce a pass.
 */
const FORMAT_PIECES = [
  { id: 'cnt-tabby-film', customerContentId: 'CMS-TABBY-FILM-26', type: 'film', title: 'The Tabby, After Dark',
    tags: { line: ['Tabby'], contentType: ['video'] }, slotTypes: ['feature'], lifecycle: { status: 'live' } },
  { id: 'cnt-lookbook-mirror', customerContentId: 'CMS-LOOKBOOK-AW', type: 'lookbook', title: 'Autumn, In Full',
    tags: { line: ['Rogue'] }, slotTypes: ['feature'], lifecycle: { status: 'live' } },
  { id: 'cnt-editorial-rival', customerContentId: 'CMS-RIVAL-EDITORIAL', type: 'editorial', title: 'The Rogue, Rebuilt',
    tags: { contentType: ['editorial'] }, slotTypes: ['stories'], lifecycle: { status: 'live' } },
  { id: 'cnt-film-rival', customerContentId: 'CMS-RIVAL-FILM', type: 'film', title: 'A Film About Leather',
    tags: { contentType: ['film'] }, slotTypes: ['stories'], lifecycle: { status: 'live' } },
  { id: 'cnt-video-rival', customerContentId: 'CMS-RIVAL-VIDEO', type: 'video', title: 'Sixty Seconds With The Rogue',
    tags: { contentType: ['video'] }, slotTypes: ['stories'], lifecycle: { status: 'live' } },
  { id: 'cnt-lookbook-rival', customerContentId: 'CMS-RIVAL-LOOKBOOK', type: 'lookbook', title: 'The Lookbook, Winter',
    tags: { contentType: ['lookbook'] }, slotTypes: ['stories'], lifecycle: { status: 'live' } },
];

const FORMAT_SLOTS = { pages: { home: [{ slot: 'stories', take: 4, weights: { contentType: 1 } }] } };

const formatReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'w19-b1-fixture', tauMs: 14 * DAY_MS };

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w19-b1-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

function boundary(host: string) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w19-b1-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => { /* the fixture measures ranking, not the queue */ } },
  } as unknown as Env;
  cache.data.set(`reflex:config:${reflexScopeForTenant(SHOPPER_TENANT)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w19-b1-fixture', note: '', value: formatReflexConfig }));
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories(['coach', 'meridian']) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* no destination diagnostics in this fixture */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  const ns = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = objects.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [], sockets: WebSocket[] = [];
        const storage = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
              .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
              },
              deleteAlarm: async () => { deleteAlarm = true; },
              setAlarm: async (at: number) => { nextAlarm = at; },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            if (deleteAlarm) alarms.length = 0;
            if (nextAlarm !== undefined) alarms.push(nextAlarm);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
        };
        const state = { id: name, storage, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, state, alarms, sockets, shopper: new ShopperReflex(state, env) };
        objects.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  };
  env.SHOPPER_REFLEX = ns as unknown as DurableObjectNamespace;
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware()); app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes);
  const call = async (path: string, capability?: string, body?: unknown) => {
    await configureRetention();
    const request = new Request(`https://synthetic.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': SHOPPER_TENANT, ...(capability === undefined ? {} : { [SHOPPER_HEADER]: capability }), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, app, cache, sessions, objects, call, drain };
}

async function formatPublication(env: Env) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = SHOPPER_TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w19-b1-fixture', note: '', value } });
  return initializePublicationSet(env, [
    baseline(REFLEX_KIND, formatReflexConfig, reflexScopeForTenant(SHOPPER_TENANT)),
    baseline(CONTENT_KIND, { pieces: FORMAT_PIECES }),
    baseline(SLOTS_KIND, FORMAT_SLOTS),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w19-b1', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} }),
  ], '0:' + crypto.randomUUID());
}

interface Snapshot { status: number; ok: unknown; state: unknown; ranking: string[]; scores: Record<string, number> }

async function shopperFixture(host: 'session' | 'do') {
  invalidateCache(); invalidateLiftCache();
  const f = boundary(host);
  const grant = await newAnonymousSession(f.env, SHOPPER_TENANT);
  await formatPublication(f.env);
  const current = f.objects.get(shopperObjectName(grant.tenant, grant.subject))?.data.get('consent');
  const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const preferences = await f.call(`/realtime/session/${grant.sessionId}/preferences`, grant.capability,
    { trackingConsent: true, personalizationEnabled: true, choice });
  expect(preferences.status, await preferences.clone().text()).toBe(200);

  /** A real accepted event through the mounted app, on whichever host this fixture runs. */
  const action = async (event: { type: string; data: Record<string, unknown> }, extra: Record<string, unknown> = {}) => {
    const response = await f.call('/realtime/action', grant.capability, {
      ...event, source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(), ...extra,
    });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text };
  };
  /** The mounted route production serves for a ranking (R19). */
  const snapshot = async (): Promise<Snapshot> => {
    const response = await f.call(`/v1/${SHOPPER_TENANT}/decisions/snapshot?page=home`, grant.capability);
    const body = await response.clone().json().catch(() => ({})) as {
      ok?: unknown; sources?: { state?: unknown };
      decisions?: Array<{ slot?: string; contentId?: string; score?: number }>;
    };
    await f.drain();
    const ranking: string[] = [], scores: Record<string, number> = {};
    for (const decision of body.decisions ?? []) {
      if (decision.slot !== 'stories') continue;
      ranking.push(decision.contentId ?? 'unknown-content');
      scores[decision.contentId ?? 'unknown-content'] = decision.score ?? Number.NaN;
    }
    return { status: response.status, ok: body.ok, state: body.sources?.state, ranking, scores };
  };
  return { f, grant, action, snapshot };
}

const HOSTS = ['session', 'do'] as const;

/** The engagement N15 is about: a click on the piece whose type and format tag disagree. */
const CLICK_ON_FILM = { type: 'content_click', data: { contentId: 'cnt-tabby-film' } };
/** The same event shape for the piece that carries no format tag at all. */
const CLICK_ON_LOOKBOOK = { type: 'content_click', data: { contentId: 'cnt-lookbook-mirror' } };
/**
 * The page load that opens the browsing session, before either the live click
 * or the replayed history arrives. It carries no product and no registry
 * attribute, and `page_view` has no accumulation weight in the published
 * registry (`DEFAULT_REFLEX_CONFIG.weights`), so it builds no taste of its own:
 * the two sessions in W19.T1.02 then differ only in HOW the one engagement
 * arrived. The buffered path reads the browsing session that a page already
 * opened (`SessionManager.readBufferedSession`), which is what a browser
 * flushing its offline queue does.
 */
const PAGE_VIEW = { type: 'page_view', data: { page: 'home' } };

// ===========================================================================
// W19.T1.01 — the canonical content type drives accumulation and ranking
// ===========================================================================

describe('unit:W19.T1.01', () => {
  it('host: engaging with a piece whose type is film and whose contentType tag is video ranks another video piece first, and a piece with no format tag mirrors its type, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await shopperFixture(host);
        // The catalogue lists the editorial rival first; only the shopper's own
        // evidence can move a video piece above it.
        const before = await h.snapshot();
        expect(before, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(before.ranking, `${host}: the base order is the catalogue's own`)
          .toEqual(['cnt-editorial-rival', 'cnt-film-rival', 'cnt-video-rival', 'cnt-lookbook-rival']);

        clock.mockReturnValue(T0 + STEP_MS);
        const click = await h.action(CLICK_ON_FILM);
        expect(click.status, `${host}: the content click is accepted — ${click.text}`).toBe(200);

        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const after = await h.snapshot();
        expect(after.ranking[0],
          `${host}: W19.T1.01 — the engagement builds affinity on the value scoring reads (\`video\`), so the other video piece leads`)
          .toBe('cnt-video-rival');
        // Explicit tags win over the mirror: nothing accumulated on `film`, the
        // rendering kind of the piece she engaged with (kit 03 :259-:266).
        expect(after.scores['cnt-video-rival']! > after.scores['cnt-film-rival']!,
          `${host}: W19.T1.01 — the rendering kind \`film\` builds no affinity when the piece names its format`).toBe(true);
        expect(after.scores['cnt-film-rival'],
          `${host}: W19.T1.01 — and the film-tagged rival scores exactly what an unengaged piece scores`)
          .toBeCloseTo(after.scores['cnt-editorial-rival']!, 10);
      }
    } finally { clock.mockRestore(); }
  });

  it('host: a piece with no contentType tag mirrors its rendering type into the same canonical dimension, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await shopperFixture(host);
        clock.mockReturnValue(T0 + STEP_MS);
        const click = await h.action(CLICK_ON_LOOKBOOK);
        expect(click.status, `${host}: the click on the untagged piece is accepted — ${click.text}`).toBe(200);
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const after = await h.snapshot();
        expect(after.ranking[0],
          `${host}: W19.T1.01 — for a piece with no contentType tag the rendering type mirrors in, so the lookbook rival leads`)
          .toBe('cnt-lookbook-rival');
      }
    } finally { clock.mockRestore(); }
  });

  it('logic: the canonical value of a film/video piece is video, of an untagged piece its type, and the real decideContent ranks on that one value', async () => {
    const film = FORMAT_PIECES.find(piece => piece.id === 'cnt-tabby-film')!;
    const mirror = FORMAT_PIECES.find(piece => piece.id === 'cnt-lookbook-mirror')!;
    expect(contentTypeValues(film),
      'W19.T1.01 — the piece that names its format is canonically `video`, never its rendering kind `film`').toEqual(['video']);
    expect(contentTypeValues(mirror),
      'W19.T1.01 — a piece that names no format is canonically its rendering type').toEqual(['lookbook']);

    const slots: SlotStrategy[] = [{ slot: 'stories', take: 4, weights: { contentType: 1 } }];
    const decision = decideContent({
      tenant: SHOPPER_TENANT, brand: SHOPPER_TENANT, page: 'home', visitorId: 'w19-b1-visitor', sessionId: null,
      identityAnchor: 'visitor', nowMs: T0, pieces: FORMAT_PIECES as unknown as ContentPiece[], slots,
      affinity: { dims: { contentType: { video: 0.8 } } }, arm: 'personalized',
      cell: { channel: 'direct', visit_bucket: '1', region: 'CA', affinity: 'contentType:video', stage: 'unknown' },
      versions: { config: 1, catalog: 1, slots: 1, learn: 0, lift: 0, prior: 0, policy: 0 }, configLabel: 'w19-b1',
    });
    const served = decision.records.filter(record => record.slot === 'stories');
    expect(served[0]!.item_id,
      'W19.T1.01 — the value accumulation stores is the value ranking reads: the video piece leads').toBe('cnt-video-rival');
    expect(served[0]!.explain.drivers.some(driver => driver.dim === 'contentType' && driver.value === 'video'),
      'W19.T1.01 — and the receipt explains it by the canonical dimension and value').toBe(true);
  });
});

// ===========================================================================
// W19.T1.02 — the same canonical type through telemetry and replay
// ===========================================================================

describe('unit:W19.T1.02', () => {
  it('logic: a live content event and the historical replay of the same engagement build one canonical touch, and a decision replayed from its receipt is equal', async () => {
    const f = boundary('session');
    await formatPublication(f.env);
    const data = { contentId: 'cnt-tabby-film' };
    const live = await resolvedContentTouches(f.env, SHOPPER_TENANT, data, formatReflexConfig);
    const historical = await resolvedContentTouches(f.env, SHOPPER_TENANT, { ...data }, formatReflexConfig);
    expect(live,
      'W19.T1.02 — the live content event builds one touch, on the canonical value the catalogue holds')
      .toEqual([{ dim: 'contentType', value: 'video' }]);
    expect(historical,
      'W19.T1.02 — a historical replay of the same engagement builds the same dimension and value').toEqual(live);

    // The decision the accumulated value produced replays to the same ranking
    // (doc 22 §12.3; kit 03 :276, `inputs.replay.contentTypes: "catalog-tags-v1"`).
    const slots: SlotStrategy[] = [{ slot: 'stories', take: 4, weights: { contentType: 1 } }];
    const decision = decideContent({
      tenant: SHOPPER_TENANT, brand: SHOPPER_TENANT, page: 'home', visitorId: 'w19-b1-visitor', sessionId: 'w19-b1-session',
      identityAnchor: 'visitor', nowMs: T0, pieces: FORMAT_PIECES as unknown as ContentPiece[], slots,
      affinity: { dims: { contentType: { video: 0.8 } } }, arm: 'personalized',
      cell: { channel: 'direct', visit_bucket: '1', region: 'CA', affinity: 'contentType:video', stage: 'unknown' },
      versions: { config: 1, catalog: 1, slots: 1, learn: 0, lift: 0, prior: 0, policy: 0 }, configLabel: 'w19-b1',
    });
    const record = decision.records.find(r => r.slot === 'stories' && r.position === 0)!;
    expect(record.inputs?.replay?.contentTypes,
      'W19.T1.02 — the receipt records that the decision read the catalogue\'s canonical format tags').toBe('catalog-tags-v1');
    record.retention = captureRetention(f.env, SHOPPER_TENANT, record.ts);
    const replayed = await replayDecision(f.env, record);
    expect({ ok: replayed.ok, equal: replayed.equal, diff: replayed.diff, reason: replayed.reason ?? null },
      'W19.T1.02 — replaying the receipt reproduces the same decision from the same canonical type')
      .toEqual({ ok: true, equal: true, diff: [], reason: null });
    expect(replayed.replayed?.item_id,
      'W19.T1.02 — and the replay serves the same video piece the live decision served').toBe('cnt-video-rival');
  });

  it('host: a session whose engagement arrived as buffered history ranks the same pieces as a live session, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        // The live session: the engagement happens now.
        clock.mockReturnValue(T0);
        const liveFixture = await shopperFixture(host);
        expect((await liveFixture.action(PAGE_VIEW)).status, `${host}: the page load opens the live session`).toBe(200);
        clock.mockReturnValue(T0 + STEP_MS);
        const liveClick = await liveFixture.action(CLICK_ON_FILM);
        expect(liveClick.status, `${host}: the live content click is accepted — ${liveClick.text}`).toBe(200);
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const live = await liveFixture.snapshot();

        // The replayed history: the same engagement, delivered as a buffered
        // action carrying its ORIGINAL time (two hours before this session).
        clock.mockReturnValue(T0);
        const replayFixture = await shopperFixture(host);
        expect((await replayFixture.action(PAGE_VIEW)).status, `${host}: the page load opens the replaying session`).toBe(200);
        clock.mockReturnValue(T0 + STEP_MS);
        const buffered = await replayFixture.action(CLICK_ON_FILM, {
          processing: 'buffered', timestamp: T0 - 2 * 60 * 60 * 1000,
          browsingSessionId: replayFixture.grant.sessionId,
        });
        expect(buffered.status, `${host}: the replayed engagement is accepted — ${buffered.text}`).toBe(200);
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const replayed = await replayFixture.snapshot();

        expect(live.ranking[0],
          `${host}: W19.T1.02 — the live session ranks the canonical video piece first`).toBe('cnt-video-rival');
        expect(replayed.ranking,
          `${host}: W19.T1.02 — a session built from replayed history ranks the same pieces in the same order as the live one`)
          .toEqual(live.ranking);
      }
    } finally { clock.mockRestore(); }
  });
});
