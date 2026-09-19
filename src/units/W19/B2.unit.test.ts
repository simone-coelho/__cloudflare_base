// src/units/W19/B2.unit.test.ts
// W19 batch B2 — locale as a published TAG DIMENSION with slot exclusion, the
// slot-type vocabulary diagnostics, and (as a row only) the product-attribute
// inheritance decision that waits for the owner.
//
// One `describe('unit:W19.<id>')` per unit of batch W19-B2, one `it` per ruled
// leg. Every expected value comes from a witness, never from what the engine
// returns today:
//
//   · document 35 §5 row W19 · G2 (:414): "One lossless, versioned import/
//     direct-PUT/merge contract for merchandising, lifecycle/windows, stage
//     aliases, registry tags and locale/slot vocabulary … Decide product-
//     attribute inheritance, warn/reject unusable taxonomy and prove idempotent
//     round trips."  §2 F27 (:207): "validate registry/locale/slot aliases and
//     round trips. Decide and test product-attribute inheritance separately from
//     product linkage for attribution. Locale is also promised in the customer
//     solution document."  §4 D5 (:339): "customer taxonomy/locale/product
//     inheritance … remain W19/W20/W14."
//   · docs/BTI-Implementation-Guide.md:202 — "**There is no locale field.**
//     Market and language are modelled as an ordinary tag dimension, for example
//     `"locale": ["en-GB"]`, and a slot then excludes the values it must not
//     show. This is deliberate, it keeps market rules in the same mechanism as
//     everything else, and it needs to be agreed at kickoff because it affects
//     how the feed is built."  :189 — `slotTypes` "At least one. Matched exactly
//     against the slot identifier."  :218 — the machine paths accept "`slots`
//     for `slotTypes`".  :233 — the documented refusal words,
//     "pieces[37].slotTypes: required non-empty string array".  :1241 — "A new
//     region or locale | Locale on the catalog records".
//   · docs/kit/03-payload-schemas.md:131 (`slotTypes` | yes | "The slots the
//     piece may fill"), :138 (`featuredProductIds` "Carried and validated, never
//     rewritten"), :158-159 ("This contract does not normalize registry/case/
//     type aliases, locale, empty-taxonomy policy or product-attribute
//     inheritance"), :161-190 (the hard slot controls) with :174-175 (a write
//     accepts an absent marker or `governanceVersion: 1 | 2 | 3` and emits 3)
//     and :185-188 (`excludedTags`, "at most 1000 distinct `{dimension, value}`
//     pairs … Matching is exact and case-sensitive, without trimming, regex,
//     aliases or inferred registry vocabulary").
//   · docs/architecture/tapestry_requirements.txt:138, :305 ("Multi-brand
//     rollout"), :530, :559-568 (the A.3.6 content-metadata table, which names
//     NO locale row and whose `featured_product_ids` row is W19.P1.01's subject).
//   · Rulings R10-R12, R14, R19-R22, R35, R47, R67, R69, R71, R73 (LANE-LOG),
//     and the W19-B2 readings the brief carries:
//       (a) there is no locale FIELD and none is added: locale and market are an
//           ordinary tag dimension the tenant's PUBLISHED registry may name, and
//           eligibility by locale is the slot's PUBLISHED exclusion of tag
//           values; geography (`cell.region`, the request's own `cf`) is context
//           recorded on a decision, never eligibility;
//       (b) the slot-type vocabulary is the SLOTS DOCUMENT the engine decides
//           from for that tenant (published, else the compiled fallback, with the
//           answer naming which); a piece naming a slot no page defines is
//           WARNED in the one diagnostics channel
//           (`catalog-registry-diagnostics/v1`, the existing `warnings[]` /
//           `warningCount` shape), never refused, and because it is a function of
//           stored documents it appears on reads as well as writes;
//       (c) product-attribute inheritance is an OWNER decision (R71(d) in the
//           ruling register) — W19.P1.01 is a `no-witness` row in
//           docs/remediation/units.json and has NO test here;
//       (d) GREEN-AT-SPEC is the honest verdict where the frozen W19/W20 work
//           already holds, with the reversing product line named.
//
// ONE CONSISTENT REPRESENTATION ACROSS THESE FIVE UNITS, so that no two of them
// demand opposite things of the same fixture:
//   1. A locale value is an ORDINARY TAG VALUE. It is stored byte-for-byte as the
//      feed sent it, on every path, and nothing anywhere rewrites, folds, or
//      drops it (L1.01, L1.02's `fr-fr` piece, S1.02).
//   2. Matching is EXACT, on the value and on the case, because the published
//      contract says this contract "does not normalize registry/case/type
//      aliases, locale" (kit 03:158-159) and because `excludedTags` matching "is
//      exact and case-sensitive, without trimming, regex, aliases or inferred
//      registry vocabulary" (kit 03:185-188; kinds.ts:252-268,
//      slotConstraints.ts:41-46). `fr-CA` and `fr-fr` are therefore NOT `fr-FR`,
//      in the engine and in these tests.
//   3. Eligibility is decided by the PUBLISHED documents only: the piece's
//      `slotTypes` against the slot identifier, and the slot's own published
//      exclusions. Geography is never a term in it (L1.03).
//   4. The tenant's published REGISTRY and the tenant's published SLOTS DOCUMENT
//      are the two vocabularies the diagnostics channel measures a stored piece
//      against. Both fixtures below deliberately DIFFER from the compiled
//      defaults (`DEFAULT_REFLEX_CONFIG`, `DEFAULT_SLOTS`) — the registry adds
//      `locale` and drops three compiled dimensions, the slots document shares no
//      page name and no slot name with the compiled one — so a test cannot pass
//      by reading a bundled list instead of the tenant's own document.
//
// RULED MISSING MEMBERS (R21). None is an export, so both typechecks stay clean;
// each is asserted by the name this specification rules and is RED until it
// exists:
//   (i)  `diagnostics.warnings[]` gains `{ code: 'unknown_slot_type', pieceIndex,
//        slotType }` — a stored piece naming a slot type no page of the tenant's
//        slots document defines (unit W19.S1.01). Today `catalogDiagnostics.ts:7-8`
//        carries exactly two codes, `no_nonempty_registered_tags` and
//        `unknown_dimension`, and the slots document is never read there.
//   (ii) `diagnostics.slots` `{ source: 'stored' | 'compiled-default' |
//        'unavailable', revision, version }` — which slots document the channel
//        compared against, in the shape the existing `diagnostics.registry`
//        member already uses for the registry (`catalogDiagnostics.ts:14`)
//        (unit W19.S1.01). DELIBERATELY three keys and no `scope`: the registry's
//        `scope` exists because a registry may live at a demo config scope
//        (`reflexScopeForTenant`, `configStore.ts:59-61`), while the slots
//        document is always the catalogue tenant's own, so a `scope` here would
//        be a fourth key that can only ever repeat the answer's own tenant.
//   (iii) the decision set gains `constraintDiagnostics`
//        `{ warningCount, omittedWarningCount, warnings: [{ slot, contentId,
//        reason, dimension, value }] }` — the pieces a slot's published hard
//        controls refused, and the exact published pair that refused each, beside
//        `pinDiagnostics` (`contentCompose.ts:96-102`, `types.ts:427-430`) and
//        `seedDiagnostics` (`decide.ts:167`), the shapes this repository already
//        uses for refused configuration. `reason` is the existing
//        `SlotConstraintReason` vocabulary (`slotConstraints.ts:18`), here
//        `'excluded_tag'`; `dimension`/`value` are the published `excludedTags`
//        pair itself (unit W19.L1.02).
//        It is BOUNDED and DISCRIMINATED (ruling R77(a)):
//          · only a piece that is OTHERWISE ELIGIBLE for that slot is named —
//            live inside its window and in stock (`lifecycle.ts:31`) and naming
//            the slot identifier in its `slotTypes` (`contentCompose.ts:252`) —
//            because a piece the slot could never have served was not refused by
//            the constraint, and naming it would flood the channel with the whole
//            catalogue (the composer's `forbidden` map, `contentCompose.ts:172-179`,
//            is computed over every live piece and is NOT this set);
//          · only a slot the composer actually RANKS contributes entries
//            (R82(b)): an off-limits slot (`contentCompose.ts:227`) and a slot
//            whose whole take is one non-personalizable pin
//            (`contentCompose.ts:237-248`) consider no candidate, so they refuse
//            nobody however many exclusions they publish; a dormant or refused
//            pin has its own public home in `slot-pin-diagnostics/v1`;
//          · `warnings` holds at most the first 50, in slot order then catalogue
//            order, `warningCount` counts every refused eligible piece and
//            `omittedWarningCount` is the difference — the cap idiom this
//            repository already uses in both advisory channels
//            (`catalogDiagnostics.ts:34,46`; `slotDiagnostics.ts:41,45`).
//        Today the composer computes the refusal and drops it on the floor for
//        every piece that is not a pin, so a merchandiser cannot tell a market
//        exclusion from a missing piece or an exhausted take. The one PUBLIC home
//        for refused slot configuration is `slot-pin-diagnostics/v1`
//        (`slotDiagnostics.ts:8-17`, mounted on GET, PUT and validate of
//        `/content/slots`, `routes/content.ts:95,210,239,288`), and it is limited
//        to PINNED pieces (`slotDiagnostics.ts:36`); extending it to non-pinned
//        pieces is NOT ruled in this batch (R77(b)), so the naming clause is
//        asserted on the decision set, which is also where the brief's "the
//        decision's record" had to move to: a refused piece is served nowhere and
//        therefore has no record of its own (deviation, ratified as R77(a)).
//
// HARNESS. The authoring units (L1.01, S1.01, S1.02) drive the real mounted
// `contentRoutes` through `src/index.ts`'s own middleware on working synthetic
// KV/R2, in the pattern of `src/routes/content.test.ts` (never imported, never
// edited). The decision units (L1.02, L1.03) drive the real mounted app and the
// real `ShopperReflex` class in process on BOTH hosts, in the pattern of
// `src/units/W16/C8.unit.test.ts` and `src/routes/realtime.sdkContract.test.ts`
// (never imported, never edited). W19-B1 (`src/units/W19/B1.unit.test.ts`) lives
// on another branch; nothing here depends on it.

import { describe, it, expect, vi } from 'vitest';
import * as jose from 'jose';
import { Hono } from 'hono';

import type { Env } from '@/types/env';
import { contentRoutes } from '@/routes/content';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { PRIORS_KIND, EMPTY_PRIORS } from '@/learn/priors';
import { PROPOSALS_KIND, EMPTY_PROPOSALS } from '@/learn/cycle';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { initializePublicationSet, readPublication, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { decideContent } from '@/content/decide';
import { invalidateLiftCache } from '@/content/service';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent, type ConsentInstruction } from '@/content/consent';
import { configuredDestinations } from '@/connectors/config';
import type { RetentionCategory, RetentionPolicy } from '@/retention';
import type { ContentCatalog, ContentDecisionSet, ContentPiece, SlotStrategy } from '@/content/types';

// ---------------------------------------------------------------------------
// The two published vocabularies, both DIFFERENT from the compiled defaults.
// ---------------------------------------------------------------------------

/**
 * The tenant's published registry. `locale` is an ORDINARY dimension the
 * customer chose to name (BTI guide :202); `subcategory`, `silhouette` and
 * `priceBand` — three dimensions the compiled `DEFAULT_REFLEX_CONFIG` carries —
 * are deliberately absent, so a reader of this document is distinguishable from
 * a reader of the bundled list.
 */
const TENANT_REGISTRY = {
  ...DEFAULT_REFLEX_CONFIG,
  version: 'w19-b2-registry',
  dimensions: [
    { key: 'line', source: 'line' },
    { key: 'category', source: 'category' },
    { key: 'occasion', source: 'occasion', multi: true },
    { key: 'contentType', source: 'contentType' },
    { key: 'locale', source: 'locale' },
  ],
  // Both hosts score the attributes the brand's own events carry; the shopper
  // object holds no copy of the customer's product catalogue.
  eventAttributes: 'event-when-unknown' as const,
};

/** The same registry with the customer's `locale` dimension NOT named. */
const REGISTRY_WITHOUT_LOCALE = {
  ...TENANT_REGISTRY,
  version: 'w19-b2-registry-no-locale',
  dimensions: TENANT_REGISTRY.dimensions.filter(dimension => dimension.key !== 'locale'),
};

/**
 * The tenant's published slots document, and therefore (reading (b)) the whole
 * slot-type vocabulary this tenant's engine decides from. It shares NO page name
 * and NO slot name with the compiled `DEFAULT_SLOTS` (`home`: `hero`, `story`,
 * `rail`), so a piece naming a compiled-default slot is an undefined slot HERE.
 *
 * Two pages, because the composer dedupes across the slots of one page
 * (`contentCompose.ts:231`, `:252`): `excluded` carries the market exclusion the
 * BTI guide :202 describes, `open` carries the same ranking with no exclusion at
 * all, which is the page W19.L1.03 measures geography on.
 */
const FIXTURE_SLOTS = {
  version: 'w19-b2-slots',
  // kit 03:174-175 and :185-188: a write accepts `governanceVersion: 1 | 2 | 3`
  // and emits 3, and `excludedTags` is read from governance 2 upward
  // (`kinds.ts:244`); a stored document is interpreted with the governance it
  // declares (`kinds.ts:338`).
  governanceVersion: 3,
  pages: {
    excluded: [{ slot: 'market-hero', take: 5, weights: { line: 1 }, excludedTags: [{ dimension: 'locale', value: 'fr-FR' }] }],
    open: [{ slot: 'market-rail', take: 5, weights: { line: 1 } }],
  },
};

/** The slot identifiers the document above defines, for the reader. */
const DEFINED_SLOT_TYPES = ['market-hero', 'market-rail'];
/** A slot identifier the COMPILED default defines and this tenant does not. */
const COMPILED_ONLY_SLOT_TYPE = 'story';

const FIXTURE_LEARN = {
  version: 'w19-b2-learn',
  // Gamma stays zero and the population prior stays off: this batch measures
  // eligibility and vocabulary, never learned lift or a regional blend.
  holdout: { share: 0, salt: 'w19-b2', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: {},
};

// ---------------------------------------------------------------------------
// The catalogue. Real Coach rows (`src/data/coach-catalog.json`) for the product
// references, the customer's own lines for the tag values, and the BTI guide's
// own example locale value `en-GB` (:202).
// ---------------------------------------------------------------------------

type FixturePiece = ContentPiece & { tags: Record<string, string[]> };

const livePiece = (p: Omit<ContentPiece, 'lifecycle'>): FixturePiece =>
  ({ ...p, tags: p.tags as Record<string, string[]>, lifecycle: { status: 'live' } });

/**
 * Five pieces, one market each. Catalogue ORDER puts the English piece first, so
 * that a French piece appearing first can only be her score and never the
 * document's order — and so that a French piece missing from a slot can only be
 * the published exclusion and never the take.
 */
const LONDON = livePiece({ id: 'london-edit', customerContentId: 'CMS-LONDON', type: 'editorial', title: 'London, After Six',
  tags: { locale: ['en-GB'], line: ['Rogue'] }, slotTypes: ['market-hero', 'market-rail'], featuredProductIds: ['COA-CP133'] });
const PARIS = livePiece({ id: 'paris-edit', customerContentId: 'CMS-PARIS', type: 'editorial', title: 'Paris, Apres Six',
  tags: { locale: ['fr-FR'], line: ['Tabby'] }, slotTypes: ['market-hero', 'market-rail'], featuredProductIds: ['COA-CW620'] });
/** `fr-CA` is not `fr-FR`: a different exact value, so the exclusion cannot reach it. */
const MONTREAL = livePiece({ id: 'montreal-edit', customerContentId: 'CMS-MONTREAL', type: 'editorial', title: 'Montreal, In Two Languages',
  tags: { locale: ['fr-CA'], line: ['Tabby'] }, slotTypes: ['market-hero', 'market-rail'], featuredProductIds: ['COA-CW620'] });
/** No locale tag at all: the piece every market may show, unaffected either way. */
const GLOBAL = livePiece({ id: 'global-edit', customerContentId: 'CMS-GLOBAL', type: 'editorial', title: 'Tabby, Every Way',
  tags: { line: ['Tabby'] }, slotTypes: ['market-hero', 'market-rail'], featuredProductIds: ['COA-CW620'] });
/**
 * `fr-fr` is not `fr-FR` either: the published contract does not normalize case
 * (kit 03:158-159, :187), so this piece is a different market to the engine and the
 * exclusion does not reach it. W19-B1 rules the authoring-side diagnostic for
 * case variants; nothing here depends on that lane.
 */
const LOWERCASE = livePiece({ id: 'lowercase-edit', customerContentId: 'CMS-LOWERCASE', type: 'editorial', title: 'Une Autre Orthographe',
  tags: { locale: ['fr-fr'], line: ['Rogue'] }, slotTypes: ['market-hero', 'market-rail'], featuredProductIds: ['COA-CP133'] });

/**
 * Two more `fr-FR` pieces that the excluded slot could never have served anyway,
 * so the refusal channel must NOT name either of them (R77(a), the discrimination
 * clause). Both are inert in every ranking this file measures: `rouen-edit` names
 * a slot type no page of this tenant's document defines, and `lyon-edit` is
 * expired, which `lifecycle.ts:31` gates before any scoring.
 */
const ROUEN = livePiece({ id: 'rouen-edit', customerContentId: 'CMS-ROUEN', type: 'editorial', title: 'Rouen, Hors Creneau',
  tags: { locale: ['fr-FR'], line: ['Tabby'] }, slotTypes: ['lookbook'] });
const LYON: FixturePiece = { ...livePiece({ id: 'lyon-edit', customerContentId: 'CMS-LYON', type: 'editorial', title: 'Lyon, Expire',
  tags: { locale: ['fr-FR'], line: ['Tabby'] }, slotTypes: ['market-hero', 'market-rail'] }), lifecycle: { status: 'expired' } };

const MARKET_CATALOG: ContentCatalog = { version: 'w19-b2-catalog', pieces: [LONDON, PARIS, MONTREAL, GLOBAL, LOWERCASE, ROUEN, LYON] };

/** COA-CW620 · Tabby Shoulder Bag 26 With Quilting, and COA-CP133 · Rogue: rows of the brand's own catalogue, named by the pieces above. */
const VIEW_TABBY = { type: 'product_view', data: { productId: 'COA-CW620', line: 'Tabby' } };
const VIEW_ROGUE = { type: 'product_view', data: { productId: 'COA-CP133', line: 'Rogue' } };

// ---------------------------------------------------------------------------
// Authoring harness: the real mounted content routes on synthetic KV/R2.
// ---------------------------------------------------------------------------

const SIGNING = 'w19-b2-synthetic-route-signing-material-only';
const H = 'http://w19-b2.invalid';
const AUTHORING_TENANT = 'coach';

class FixtureKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key);
    return raw === undefined ? null : type === 'stream' ? new Response(raw).body : JSON.parse(raw);
  }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
}
class FixtureR2 {
  objects = new Map<string, string>(); etags = new Map<string, string>(); puts = 0;
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: this.etags.get(key), size: new TextEncoder().encode(raw).length, body: new Response(raw).body };
  }
  async put(key: string, raw: string, options: R2PutOptions) {
    const attempt = ++this.puts, condition = options.onlyIf;
    if (condition instanceof Headers ? this.objects.has(key) : condition?.etagMatches !== this.etags.get(key)) return null;
    this.objects.set(key, raw); this.etags.set(key, `w19-b2-${attempt}`);
    return { key, etag: this.etags.get(key), size: new TextEncoder().encode(raw).length };
  }
}

const authoringEnv = (): Env => ({ CACHE: new FixtureKV(), STORAGE: new FixtureR2(), JWT_SECRET: SIGNING, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
  TENANTS: JSON.stringify({ provisioned: [AUTHORING_TENANT], operatorGrants: { ops: [AUTHORING_TENANT] } }) } as unknown as Env);

const operatorToken = () => new jose.SignJWT({ sub: 'ops', type: 'service' }).setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(SIGNING));

const authoringKinds: DocumentKind<unknown>[] = [CONTENT_KIND, SLOTS_KIND, LEARN_KIND, REFLEX_KIND, PRIORS_KIND, PROPOSALS_KIND];

/** One publication set at revision 1 for every document the routes read. */
async function initializeAuthoring(env: Env, catalog: unknown, registry: unknown = TENANT_REGISTRY, slots: unknown = FIXTURE_SLOTS) {
  const values = [catalog, slots, DEFAULT_LEARN, registry, EMPTY_PRIORS, EMPTY_PROPOSALS];
  return initializePublicationSet(env, authoringKinds.map((kind, i) => ({
    kind, scope: kind.name === 'reflex' ? reflexScopeForTenant(AUTHORING_TENANT) : AUTHORING_TENANT,
    revision: { revision: 1, value: values[i], actor: 'w19-b2-fixture', note: '', at: 1 },
  })), '0:' + crypto.randomUUID());
}

/** The publication preconditions every authored write carries (kit 02: If-Match plus Idempotency-Key). */
function publicationHeaders(env: Env, auth: Record<string, string>, revision = 1): Record<string, string> {
  const storage = env.STORAGE as unknown as FixtureR2;
  const raw = storage.objects.get(`config-publication/v2/${AUTHORING_TENANT}/head.json`);
  const head = raw ? JSON.parse(raw) : { committed: { revision: 1, digest: 'a'.repeat(64) } };
  return { ...auth, 'If-Match': `"${revision}/${head.committed.revision}/${head.committed.digest}"`, 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` };
}
/** The same, for a member document whose own revision the publication set holds. */
function authoredHeaders(env: Env, auth: Record<string, string>, name: string): Record<string, string> {
  const storage = env.STORAGE as unknown as FixtureR2;
  const head = JSON.parse(storage.objects.get(`config-publication/v2/${AUTHORING_TENANT}/head.json`)!);
  const set = JSON.parse(storage.objects.get(`config-publication/v2/${AUTHORING_TENANT}/set/${head.committed.revision}.json`)!);
  const scope = name === 'reflex' ? reflexScopeForTenant(AUTHORING_TENANT) : AUTHORING_TENANT;
  return publicationHeaders(env, auth, set.refs[`${name}:${scope}`].revision);
}

const authoringApp = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
authoringApp.use('*', tenantMiddleware());
authoringApp.route('/', contentRoutes);

/**
 * What a catalogue answer carries. The two members this specification RULES and
 * that the engine does not have yet (R21) are declared optional here, so both
 * typechecks stay clean and the unit is RED on the VALUE, not on a type.
 */
interface RuledCatalogDiagnostics {
  schema: string;
  status: string;
  catalogRevision: number | null;
  registry: { scope: string | null; source: string; revision: number | null; version: string | null };
  warningCount: number | null;
  omittedWarningCount: number | null;
  warnings: Array<Record<string, unknown>> | null;
  /** RULED, ABSENT TODAY (R21, missing member ii). */
  slots?: { source: string; revision: number | null; version: string | null } | null;
}
interface CatalogAnswer {
  ok?: boolean;
  valid?: boolean;
  revision?: number;
  version?: string;
  received?: number;
  imported?: number;
  pieces?: number | ContentPiece[];
  errors?: string[];
  document?: ContentCatalog;
  diagnostics: RuledCatalogDiagnostics;
}

const csvCell = (v: string) => `"${v.replaceAll('"', '""')}"`;
const csvOf = (columns: string[], rows: Record<string, string>[]) =>
  [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column] ?? '')).join(','))].join('\n') + '\n';

/** The pieces the publication actually holds, straight from the store. */
const storedPieces = async (env: Env) => (await readPublication(env, CONTENT_KIND, AUTHORING_TENANT)).value.pieces;

/** One of this file's pieces as a FEED sends it: everything but the lifecycle the validator supplies. */
const asFeed = (piece: FixturePiece): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...piece };
  delete copy.lifecycle;
  return copy;
};

// ---------------------------------------------------------------------------
// Decision harness: the real mounted app and the real ShopperReflex class in
// process, one construction per host.
// ---------------------------------------------------------------------------

const TENANT = 'meridian';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOSTS = ['session', 'do'] as const;
/** Ile-de-France. The geography that is context on a decision and never eligibility. */
const GEO_FRANCE = { country: 'FR', regionCode: 'IDF' };
const GEO_BRITAIN = { country: 'GB', regionCode: 'ENG' };

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}
class UnitR2 {
  data = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.data.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.data.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w19-b2-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

async function fixturePublication(env: Env, tenant: string) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w19-b2-fixture', note: '', value } });
  return initializePublicationSet(env, [
    baseline(REFLEX_KIND, TENANT_REGISTRY, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, MARKET_CATALOG),
    baseline(SLOTS_KIND, FIXTURE_SLOTS),
    baseline(LEARN_KIND, FIXTURE_LEARN),
  ], '0:' + crypto.randomUUID());
}

function boundary(host: string) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w19-b2-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => { /* the fixture never drains a queue */ } },
  } as unknown as Env;
  cache.data.set(`reflex:config:${reflexScopeForTenant(TENANT)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w19-b2-fixture', note: '', value: TENANT_REGISTRY }));
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories(['coach', 'meridian']) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* no destination diagnostics in the fixture */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
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
  // R19: the routes production serves, mounted as `src/index.ts` mounts them.
  app.use('*', tenantMiddleware()); app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes);
  const call = async (path: string, capability?: string, body?: unknown, geo?: { country: string; regionCode: string }) => {
    await configureRetention();
    const request = new Request(`https://synthetic.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': TENANT, ...(capability === undefined ? {} : { [SHOPPER_HEADER]: capability }), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // The request's own geolocation, exactly as the platform delivers it.
    if (geo) Object.defineProperty(request, 'cf', { value: geo });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never passes through */ }, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, app, cache, sessions, objects, call, drain };
}

async function explicitChoice(f: ReturnType<typeof boundary>, grant: Awaited<ReturnType<typeof newAnonymousSession>>) {
  const current = f.objects.get(shopperObjectName(grant.tenant, grant.subject))?.data.get('consent');
  const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const response = await f.call(`/realtime/session/${grant.sessionId}/preferences`,
    grant.capability, { trackingConsent: true, personalizationEnabled: true, choice });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { consent?: { tracking: boolean; personalization: boolean; instruction?: ConsentInstruction } };
}

interface SnapshotAnswer {
  status: number;
  ok: unknown;
  state: unknown;
  /** slot → the content ids it served, in the order it served them. */
  ranking: Record<string, string[]>;
  /** slot → content id → the score the decision served it with. */
  scores: Record<string, Record<string, number>>;
}

async function hostFixture(host: 'session' | 'do') {
  invalidateCache(); invalidateLiftCache();
  const f = boundary(host);
  const grant = await newAnonymousSession(f.env, TENANT);
  await fixturePublication(f.env, TENANT);
  await explicitChoice(f, grant);
  const action = async (event: { type: string; data: Record<string, unknown> }) => {
    const response = await f.call('/realtime/action', grant.capability, {
      ...event, source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(),
    });
    await f.drain();
    return response.status;
  };
  const snapshot = async (page: string, geo?: { country: string; regionCode: string }): Promise<SnapshotAnswer> => {
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot?page=${page}`, grant.capability, undefined, geo);
    const body = await response.clone().json().catch(() => ({})) as {
      ok?: unknown; sources?: { state?: unknown };
      decisions?: Array<{ slot?: string; contentId?: string; score?: number }>;
    };
    await f.drain();
    const ranking: Record<string, string[]> = {}, scores: Record<string, Record<string, number>> = {};
    for (const decision of body.decisions ?? []) {
      const slot = decision.slot ?? 'unknown-slot';
      (ranking[slot] ??= []).push(decision.contentId ?? 'unknown-content');
      (scores[slot] ??= {})[decision.contentId ?? 'unknown-content'] = decision.score ?? Number.NaN;
    }
    return { status: response.status, ok: body.ok, state: body.sources?.state, ranking, scores };
  };
  /** The population prior in force for THIS request's own geolocation (`routes/decisions.ts:125-126`). */
  const trend = async (geo?: { country: string; regionCode: string }) => {
    const response = await f.call(`/v1/${TENANT}/trend`, grant.capability, undefined, geo);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as { ok: boolean; region: string | null };
  };
  return { f, grant, action, snapshot, trend };
}

/**
 * The decision set, with the diagnostics channel this specification rules
 * (R21/R77(a), missing member iii): bounded and discriminated, in the cap idiom
 * both existing advisory channels use (`catalogDiagnostics.ts:34,46`;
 * `slotDiagnostics.ts:41,45`).
 */
type RuledConstraintDiagnostics = {
  /** Every refused ELIGIBLE piece, across every slot of the page. */
  warningCount: number;
  /** `warningCount` minus the entries actually carried. */
  omittedWarningCount: number;
  /** At most the first 50, in slot order then catalogue order. */
  warnings: Array<{ slot: string; contentId: string; reason: string; dimension?: string; value?: string }>;
};
type RuledDecisionSet = ContentDecisionSet & { constraintDiagnostics?: RuledConstraintDiagnostics };
/** What a slot that refused nothing reports. */
const NO_REFUSALS: RuledConstraintDiagnostics = { warningCount: 0, omittedWarningCount: 0, warnings: [] };

// ===========================================================================

describe('unit:W19.L1.01', () => {
  it('host: a piece tagged locale rides every write path unchanged, and the published registry alone decides whether the answer warns about the dimension', async () => {
    // The feed's own pieces, which are the file's own `london-edit` and
    // `paris-edit` exactly — one content id, one taxonomy, whichever unit reads
    // them. `locale` is the BTI guide's own example dimension (:202) and there is
    // no locale FIELD anywhere: it is one tag dimension beside `line`, and the
    // stored piece must carry it exactly. London also carries the two display
    // fields, so the round trip is measured on more than the required six.
    const feedLondon = { ...asFeed(LONDON), renderUrl: '/editorial/london-after-six', excerpt: 'Evening in town.' };
    const feedParis = asFeed(PARIS);
    const feed = [feedLondon, feedParis];
    /** What the catalogue must hold after EVERY one of the four paths, exactly. */
    const expected = [
      { ...feedLondon, lifecycle: { status: 'live' } },
      { ...feedParis, lifecycle: { status: 'live' } },
    ];
    const columns = ['id', 'customerContentId', 'type', 'title', 'tags', 'slotTypes', 'featuredProductIds', 'status', 'renderUrl', 'excerpt'];
    const csv = csvOf(columns, [
      { id: LONDON.id, customerContentId: LONDON.customerContentId, type: LONDON.type, title: LONDON.title,
        tags: 'locale:en-GB;line:Rogue', slotTypes: 'market-hero|market-rail', featuredProductIds: 'COA-CP133', status: 'live',
        renderUrl: '/editorial/london-after-six', excerpt: 'Evening in town.' },
      { id: PARIS.id, customerContentId: PARIS.customerContentId, type: PARIS.type, title: PARIS.title,
        tags: 'locale:fr-FR;line:Tabby', slotTypes: 'market-hero|market-rail', featuredProductIds: 'COA-CW620', status: 'live' },
    ]);

    invalidateCache();
    const env = authoringEnv();
    await initializeAuthoring(env, { version: 'w19-b2-catalog', pieces: [] });
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${await operatorToken()}` };
    const remote = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: feed })));
    try {
      let revision = 1;
      for (const [label, suffix, method, body, contentType] of [
        ['JSON import', '/import', 'POST', JSON.stringify(feed), 'application/json'],
        ['CSV import', '/import?format=csv', 'POST', csv, 'text/csv'],
        ['pull', '/pull', 'POST', JSON.stringify({ url: 'https://cms.example/market-feed', path: 'content' }), 'application/json'],
        ['direct PUT', '', 'PUT', JSON.stringify({ document: { pieces: feed } }), 'application/json'],
      ] as const) {
        const response = await authoringApp.request(`${H}/catalog${suffix}${suffix.includes('?') ? '&' : '?'}scope=${AUTHORING_TENANT}`,
          { method, headers: { ...publicationHeaders(env, auth, revision), 'Content-Type': contentType }, body }, env);
        expect(response.status, `${label}: ${await response.clone().text()}`).toBe(200);
        const answer = await response.json() as CatalogAnswer;
        expect(answer.ok, `${label}: the write is accepted`).toBe(true);
        expect(answer.revision, `${label}: one new revision`).toBe(++revision);
        // 1. The tag survives the path, exactly. Deep equality on the whole
        //    stored piece: nothing rewrites the locale value, nothing folds its
        //    case, nothing drops the dimension, and no other field moves either.
        expect(await storedPieces(env), `W19.L1.01 — ${label}: the stored pieces carry the customer's locale tag exactly as the feed sent it`).toEqual(expected);
        // 2. The tenant's published registry NAMES `locale`, so the advisory
        //    channel has nothing to say about it (catalogDiagnostics.ts:31,38).
        expect(answer.diagnostics.warnings, `W19.L1.01 — ${label}: a registered dimension raises no warning`).toEqual([]);
        expect(answer.diagnostics.warningCount, `W19.L1.01 — ${label}: and the count agrees`).toBe(0);
        expect(answer.diagnostics.registry.source, `W19.L1.01 — ${label}: the channel read the tenant's published registry`).toBe('stored');
        expect(answer.diagnostics.registry.version, `W19.L1.01 — ${label}: and names which one`).toBe('w19-b2-registry');
      }
      expect(remote, 'W19.L1.01 — the pull path fetched the feed once').toHaveBeenCalledTimes(1);

      // 3. The same feed against a tenant whose published registry does NOT name
      //    `locale`: the existing `unknown_dimension` warning names the
      //    dimension by name, the piece is still stored exactly as sent, and the
      //    write is not refused. The registry is the only thing that changed.
      invalidateCache();
      const unregistered = authoringEnv();
      await initializeAuthoring(unregistered, { version: 'w19-b2-catalog', pieces: [] }, REGISTRY_WITHOUT_LOCALE);
      const second = await authoringApp.request(`${H}/catalog/import?scope=${AUTHORING_TENANT}`,
        { method: 'POST', headers: publicationHeaders(unregistered, auth, 1), body: JSON.stringify(feed) }, unregistered);
      expect(second.status, await second.clone().text()).toBe(200);
      const answer = await second.json() as CatalogAnswer;
      // Projected onto the three members this outcome rules — the code, the
      // piece and the dimension it names. `dimensionIndex` and
      // `dimensionTruncated` are the existing warning's own bookkeeping
      // (catalogDiagnostics.ts:38-39) and W19-B2 rules nothing about them, so
      // this specification claims nothing about them either.
      expect((answer.diagnostics.warnings ?? []).map(warning => ({ code: warning.code, pieceIndex: warning.pieceIndex, dimension: warning.dimension })),
        'W19.L1.01 — an unregistered locale dimension is named by the existing unknown_dimension warning, on each piece that carries it')
        .toEqual([
          { code: 'unknown_dimension', pieceIndex: 0, dimension: 'locale' },
          { code: 'unknown_dimension', pieceIndex: 1, dimension: 'locale' },
        ]);
      expect(answer.diagnostics.warningCount, 'W19.L1.01 — the count agrees').toBe(2);
      expect(await storedPieces(unregistered),
        'W19.L1.01 — an unregistered dimension is advisory: the piece is stored whole, with the locale tag untouched').toEqual(expected);
    } finally { remote.mockRestore(); }
  });
});

describe('unit:W19.L1.02', () => {
  it('logic: the published exclusion, not geography, removes the French-market piece from the slot, names the refused piece and the pair that refused it, and leaves every other market ranked by score', () => {
    const slots: SlotStrategy[] = [
      { slot: 'market-hero', take: 5, weights: { line: 1 }, excludedTags: [{ dimension: 'locale', value: 'fr-FR' }] },
    ];
    const open: SlotStrategy[] = [{ slot: 'market-rail', take: 5, weights: { line: 1 } }];
    const input = {
      tenant: TENANT, brand: TENANT, page: 'excluded', visitorId: 'w19-b2-visitor', sessionId: null,
      identityAnchor: 'visitor' as const, nowMs: Date.parse('2026-06-01T10:00:00Z'),
      pieces: MARKET_CATALOG.pieces,
      // She likes Tabby. The French piece is a Tabby piece, so only the published
      // exclusion can keep it out of the slot.
      affinity: { dims: { line: { Tabby: 0.8 } } }, arm: 'personalized' as const,
      // The shopper is IN France on this request. Geography is recorded on the
      // cell and is never a term in eligibility (reading (a)).
      cell: { channel: 'direct' as const, visit_bucket: '1' as const, region: 'FR-IDF', affinity: 'line:Tabby' },
      versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'w19-b2-registry',
    };
    const excluded = decideContent({ ...input, slots }) as RuledDecisionSet;

    // 1. The French piece is not served, and every other market is — including
    //    the two values the exclusion must NOT reach, `fr-CA` and `fr-fr`
    //    (kit 03:158-159 and :187: the contract does not normalize locale, and
    //    matching is exact and case-sensitive).
    expect(excluded.decisions.map(d => d.contentId),
      'W19.L1.02 — the slot that excludes locale fr-FR serves every other market, ranked by score: the two Tabby pieces first, then the catalogue order')
      .toEqual(['montreal-edit', 'global-edit', 'london-edit', 'lowercase-edit']);
    expect(excluded.decisions.map(d => d.score),
      'W19.L1.02 — the scores are the slot\'s own tag sum: 0.8 x 1 for a Tabby piece, nothing for a Rogue piece').toEqual([0.8, 0.8, 0, 0]);
    // 2. …and it is not a candidate either: an excluded piece never entered the
    //    ranking, so a replay of this decision cannot resurrect it.
    expect(excluded.records[0]!.candidates,
      'W19.L1.02 — the recorded candidate set for the slot holds exactly the pieces the exclusion left eligible')
      .toEqual([{ contentId: 'montreal-edit', score: 0.8 }, { contentId: 'global-edit', score: 0.8 },
        { contentId: 'london-edit', score: 0 }, { contentId: 'lowercase-edit', score: 0 }]);

    // 3. The same five live, slot-naming pieces in a slot that publishes no
    //    exclusion are ranked by score alone: the French Tabby piece leads,
    //    ahead of the English piece the catalogue lists FIRST, so this is her
    //    taste and not document order.
    const openSet = decideContent({ ...input, page: 'open', slots: open }) as RuledDecisionSet;
    expect(openSet.decisions.map(d => d.contentId),
      'W19.L1.02 — with no exclusion published the same pieces are ranked by score, the French Tabby piece included')
      .toEqual(['paris-edit', 'montreal-edit', 'global-edit', 'london-edit', 'lowercase-edit']);
    expect(openSet.decisions.map(d => d.score), 'W19.L1.02 — three Tabby pieces at 0.8, two Rogue pieces at nothing').toEqual([0.8, 0.8, 0.8, 0, 0]);
    // A control with no teeth until the ruled member exists (it passes today on
    // the `??`), kept because it is what stops an implementation from reporting
    // a refusal where the published document refuses nothing.
    expect(openSet.constraintDiagnostics ?? NO_REFUSALS, 'W19.L1.02 — a slot that refuses nothing reports no refusal').toEqual(NO_REFUSALS);

    // 4. The page the ranked-slots clause below is measured on (R82(b)): one
    //    slot that ranks and excludes the French market, one slot the
    //    merchandiser handed to the site's own default (`offLimits`,
    //    kit 03:174-177), and one slot whose whole take is a single
    //    non-personalizable pin. All three publish the SAME exclusion, and only
    //    the first of them ever considers a candidate: `contentCompose.ts:227`
    //    skips the off-limits slot before anything else, and `:237-248` serves
    //    the pin and continues without ranking. What each slot serves is
    //    measured here, before the ruled member is asked for anything.
    const mixed: SlotStrategy[] = [
      { slot: 'market-hero', take: 5, weights: { line: 1 }, excludedTags: [{ dimension: 'locale', value: 'fr-FR' }] },
      { slot: 'market-legal', take: 1, weights: {}, offLimits: true, excludedTags: [{ dimension: 'locale', value: 'fr-FR' }] },
      { slot: 'market-rail', take: 1, weights: { line: 1 }, pinnedPieceId: LONDON.id, excludedTags: [{ dimension: 'locale', value: 'fr-FR' }] },
    ];
    const page = decideContent({ ...input, page: 'mixed', slots: mixed }) as RuledDecisionSet;
    expect(page.decisions.map(decision => ({ slot: decision.slot, contentId: decision.contentId, strategy: decision.strategy })),
      'W19.L1.02 — the off-limits slot serves nothing at all and the pinned slot serves exactly its pin, ranking never having run')
      .toEqual([
        { slot: 'market-hero', contentId: 'montreal-edit', strategy: 'affinity' },
        { slot: 'market-hero', contentId: 'global-edit', strategy: 'affinity' },
        { slot: 'market-hero', contentId: 'lowercase-edit', strategy: 'default' },
        { slot: 'market-rail', contentId: 'london-edit', strategy: 'tenant-pinned' },
      ]);

    // 5. THE RULED MISSING MEMBER (R21/R77(a), iii). A merchandiser who asks why
    //    the Paris piece is not on the French page must be told the published
    //    pair that refused it, not left to guess between a market rule, a
    //    missing piece and a take that ran out. The composer already computes
    //    the refusal (`contentCompose.ts:172-179`) and reports it for pins only
    //    (`pinDiagnostics`, `contentCompose.ts:96-102`); the one public home for
    //    refused slot configuration, `slot-pin-diagnostics/v1`
    //    (`slotDiagnostics.ts:8-17`, `routes/content.ts:95,210,239,288`), is
    //    limited to pins at `slotDiagnostics.ts:36`, and widening it is not ruled
    //    in this batch (R77(b)).
    //
    //    DISCRIMINATED: exactly ONE entry, though the catalogue holds three
    //    `fr-FR` pieces. `rouen-edit` names no slot type this page defines and
    //    `lyon-edit` is expired, so neither was ever eligible for this slot and
    //    neither was refused BY THE CONSTRAINT; naming them would report the
    //    catalogue instead of the rule. The exact equality below is what forbids
    //    it.
    expect(excluded.constraintDiagnostics,
      'W19.L1.02 — the decision names the eligible piece its slot refused and the exact published exclusion that refused it, and names no piece the slot could never have served')
      .toEqual({ warningCount: 1, omittedWarningCount: 0,
        warnings: [{ slot: 'market-hero', contentId: 'paris-edit', reason: 'excluded_tag', dimension: 'locale', value: 'fr-FR' }] });

    // 6. BOUNDED (R77(a)). A market rule over a real catalogue refuses
    //    thousands of pieces; an answer that carried one entry each would be an
    //    unbounded payload on every decision. The channel carries the first 50
    //    in catalogue order and counts the rest, which is exactly what both
    //    existing advisory channels do (`catalogDiagnostics.ts:34,46`;
    //    `slotDiagnostics.ts:41,45`).
    const refusedIds = Array.from({ length: 60 }, (_, i) => `refused-${String(i).padStart(2, '0')}`);
    const crowded = [LONDON, ...refusedIds.map(id => livePiece({ id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'editorial',
      title: `Refused ${id}`, tags: { locale: ['fr-FR'], line: ['Tabby'] }, slotTypes: ['market-hero', 'market-rail'] }))];
    const bounded = decideContent({ ...input, pieces: crowded, slots }) as RuledDecisionSet;
    expect(bounded.decisions.map(d => d.contentId),
      'W19.L1.02 — the exclusion still leaves exactly the English piece to serve').toEqual(['london-edit']);
    expect(bounded.constraintDiagnostics?.warningCount,
      'W19.L1.02 — every refused eligible piece is counted').toBe(60);
    expect((bounded.constraintDiagnostics?.warnings ?? []).map(warning => warning.contentId),
      'W19.L1.02 — and at most the first fifty are named, in catalogue order').toEqual(refusedIds.slice(0, 50));
    expect(bounded.constraintDiagnostics?.omittedWarningCount,
      'W19.L1.02 — with the remainder counted as omitted, as both existing advisory channels do').toBe(10);

    // 7. RANKED SLOTS ONLY (R82(b)), on the page clause 4 measured. A refusal is
    //    only a refusal where ranking would otherwise have chosen: the
    //    off-limits slot and the wholly pinned slot publish the same exclusion
    //    and consider no candidate at all, so naming every `fr-FR` piece under
    //    them would be noise about slots that refused nobody — and a dormant or
    //    refused pin already has its own public home in `slot-pin-diagnostics/v1`
    //    (`slotDiagnostics.ts:8-17`).
    expect(page.constraintDiagnostics,
      'W19.L1.02 — only the slot that actually ranked reports a refusal, and the count counts only those')
      .toEqual({ warningCount: 1, omittedWarningCount: 0,
        warnings: [{ slot: 'market-hero', contentId: 'paris-edit', reason: 'excluded_tag', dimension: 'locale', value: 'fr-FR' }] });
  });

  it('host: the French-market piece is never served in the excluded slot to any shopper on either host, while the English piece is, and the same pieces rank by score where nothing is excluded', async () => {
    for (const host of HOSTS) {
      // (a) A cold shopper. Every score is zero, so the slot falls to catalogue
      //     order — which would put the French piece SECOND on the page.
      const cold = await hostFixture(host);
      const coldExcluded = await cold.snapshot('excluded');
      expect(coldExcluded.status, `${host}: ${JSON.stringify(coldExcluded)}`).toBe(200);
      expect(coldExcluded.ok, host).toBe(true);
      expect(coldExcluded.state, `${host}: the decision was served on this host`).toBe(host);
      expect(coldExcluded.ranking['market-hero'],
        `${host}: W19.L1.02 — a cold shopper is served every market but the excluded one, in catalogue order`)
        .toEqual(['london-edit', 'montreal-edit', 'global-edit', 'lowercase-edit']);
      const coldOpen = await cold.snapshot('open');
      expect(coldOpen.ranking['market-rail'],
        `${host}: W19.L1.02 — and the slot that excludes nothing serves all five, so the exclusion is the only reason the French piece was missing`)
        .toEqual(['london-edit', 'paris-edit', 'montreal-edit', 'global-edit', 'lowercase-edit']);

      // (b) A shopper whose own evidence says Tabby — the French piece's line.
      //     The exclusion beats the score: it is eligibility, not a weight.
      const engaged = await hostFixture(host);
      for (let i = 0; i < 3; i++) expect(await engaged.action(VIEW_TABBY), `${host}: the Tabby view is accepted`).toBe(200);
      const engagedExcluded = await engaged.snapshot('excluded');
      expect(engagedExcluded.ranking['market-hero'],
        `${host}: W19.L1.02 — her Tabby taste ranks the remaining markets and still cannot bring the excluded French piece back`)
        .toEqual(['montreal-edit', 'global-edit', 'london-edit', 'lowercase-edit']);
      expect(engagedExcluded.scores['market-hero']!['montreal-edit']! > 0,
        `${host}: W19.L1.02 — her taste is real: the Tabby piece was served on a positive score`).toBe(true);
      expect(engagedExcluded.scores['market-hero']!['london-edit'],
        `${host}: W19.L1.02 — and the English Rogue piece is served on the slot's cold default`).toBe(0);
      const engagedOpen = await engaged.snapshot('open');
      expect(engagedOpen.ranking['market-rail'],
        `${host}: W19.L1.02 — where nothing is excluded her taste puts the French Tabby piece first, ahead of the English piece the catalogue lists first`)
        .toEqual(['paris-edit', 'montreal-edit', 'global-edit', 'london-edit', 'lowercase-edit']);
    }
  });
});

describe('unit:W19.L1.03', () => {
  it('host: a shopper whose request geography is France is served the English-market piece by her own score, on both hosts, and the ranking is the same as under any other geography', async () => {
    for (const host of HOSTS) {
      const h = await hostFixture(host);
      // Her own evidence says Rogue — the English piece's line.
      for (let i = 0; i < 3; i++) expect(await h.action(VIEW_ROGUE), `${host}: the Rogue view is accepted`).toBe(200);

      // 1. The request really is French. The engine derives the region from this
      //    request's own `cf` exactly as the decision's cell does
      //    (`regionKeyOf`, `regionOf`, cell.ts:16-19), and says so on a public
      //    answer (`routes/decisions.ts:125-126`).
      expect((await h.trend(GEO_FRANCE)).region,
        `${host}: W19.L1.03 — the request's own geolocation is France, as the engine reads it`).toBe('FR-IDF');

      // 2. On the page that publishes NO exclusion, she is served the en-GB
      //    piece first because her taste says Rogue. Geography demoted nothing,
      //    filtered nothing, and the French-market pieces are served too.
      const french = await h.snapshot('open', GEO_FRANCE);
      expect(french.status, `${host}: ${JSON.stringify(french)}`).toBe(200);
      expect(french.state, `${host}: the decision was served on this host`).toBe(host);
      expect(french.ranking['market-rail'],
        `${host}: W19.L1.03 — a French shopper is served the en-GB piece first, by her own score, and every other market after it`)
        .toEqual(['london-edit', 'lowercase-edit', 'paris-edit', 'montreal-edit', 'global-edit']);
      expect(french.scores['market-rail']!['london-edit']! > 0,
        `${host}: W19.L1.03 — the English piece leads on a positive score, not on catalogue order`).toBe(true);

      // 3. The control: the same shopper, the same documents, a British request
      //    and a request with no geolocation at all. Identical rankings and
      //    identical scores — geography is context on the decision, never a term
      //    in eligibility or in the ranking (`contentCompose.ts:252` filters on
      //    slotTypes and the slot's published constraints alone;
      //    `lifecycle.ts:31` gates on status, window and stock alone).
      //    R77(d): this proves geography does not FILTER. It does not prove the
      //    region is inert in every configuration — the population prior, the one
      //    ranking-visible consumer of the region, is deliberately disabled in
      //    this fixture (`FIXTURE_LEARN.regional.enabled: false`) and is a
      //    separate W's subject.
      const british = await h.snapshot('open', GEO_BRITAIN);
      const nowhere = await h.snapshot('open');
      expect(british.ranking['market-rail'], `${host}: W19.L1.03 — a British request is served exactly the same order`).toEqual(french.ranking['market-rail']);
      expect(nowhere.ranking['market-rail'], `${host}: W19.L1.03 — and a request with no geolocation at all is served the same order`).toEqual(french.ranking['market-rail']);
      expect(british.scores['market-rail'], `${host}: W19.L1.03 — with the same scores`).toEqual(french.scores['market-rail']);
      expect(nowhere.scores['market-rail'], `${host}: W19.L1.03 — with the same scores`).toEqual(french.scores['market-rail']);
    }
  });
});

describe('unit:W19.S1.01', () => {
  it('host: a stored piece naming a slot type no page of the tenant\'s slots document defines is named in the diagnostics of every write answer and of the catalogue read, counted, and compared against the slots document the answer names', async () => {
    // Three pieces. One names a slot the tenant's document defines, one names a
    // slot only the COMPILED default defines, one names a defined slot and an
    // undefined one. All three are valid catalogue items (kinds.ts:57-58 checks
    // the shape only), so all three are stored.
    const defined = { id: 'defined-edit', customerContentId: 'CMS-DEFINED', type: 'editorial', title: 'A Slot This Tenant Defines',
      tags: { locale: ['en-GB'], line: ['Tabby'] }, slotTypes: ['market-hero'] };
    const compiledOnly = { id: 'compiled-only-edit', customerContentId: 'CMS-COMPILED', type: 'editorial', title: 'A Slot Only The Bundled List Defines',
      tags: { locale: ['en-GB'], line: ['Tabby'] }, slotTypes: [COMPILED_ONLY_SLOT_TYPE] };
    const partly = { id: 'partly-defined-edit', customerContentId: 'CMS-PARTLY', type: 'editorial', title: 'One Defined And One Not',
      tags: { locale: ['fr-FR'], line: ['Rogue'] }, slotTypes: ['market-rail', 'lookbook'] };
    const feed = [defined, compiledOnly, partly];
    const expected = feed.map(piece => ({ ...piece, lifecycle: { status: 'live' } }));
    /** The ruled warning set: one entry per undefined slot type, by piece index. */
    const expectedWarnings = [
      { code: 'unknown_slot_type', pieceIndex: 1, slotType: COMPILED_ONLY_SLOT_TYPE },
      { code: 'unknown_slot_type', pieceIndex: 2, slotType: 'lookbook' },
    ];

    // The fixture's teeth: the warned slot type is one the COMPILED default
    // defines and this tenant's document does not, and no slot this tenant
    // defines appears in the compiled default. An implementation that reads the
    // bundled list instead of the tenant's document answers this backwards.
    const compiledSlotTypes = Object.values(DEFAULT_SLOTS.pages).flat().map(slot => slot.slot);
    expect(compiledSlotTypes, 'W19.S1.01 fixture — the compiled default defines the slot type this tenant does not').toContain(COMPILED_ONLY_SLOT_TYPE);
    expect(compiledSlotTypes.filter(slot => DEFINED_SLOT_TYPES.includes(slot)),
      'W19.S1.01 fixture — and defines none of the slot types this tenant publishes').toEqual([]);

    invalidateCache();
    const env = authoringEnv();
    await initializeAuthoring(env, { version: 'w19-b2-catalog', pieces: [] });
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${await operatorToken()}` };
    const remote = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: feed })));
    const answers: Array<{ label: string; answer: CatalogAnswer }> = [];
    try {
      let revision = 1;
      for (const [label, suffix, method, body] of [
        ['JSON import', '/import', 'POST', JSON.stringify(feed)],
        ['pull', '/pull', 'POST', JSON.stringify({ url: 'https://cms.example/market-feed', path: 'content' })],
        ['direct PUT', '', 'PUT', JSON.stringify({ document: { pieces: feed } })],
      ] as const) {
        const response = await authoringApp.request(`${H}/catalog${suffix}?scope=${AUTHORING_TENANT}`,
          { method, headers: publicationHeaders(env, auth, revision), body }, env);
        expect(response.status, `${label}: ${await response.clone().text()}`).toBe(200);
        const answer = await response.json() as CatalogAnswer;
        expect(answer.ok, `${label}: the write is accepted`).toBe(true);
        expect(answer.revision, `${label}: one new revision`).toBe(++revision);
        // 1. A piece naming an undefined slot is WARNED, never refused: it is
        //    stored whole, exactly as the feed sent it (reading (b)).
        expect(await storedPieces(env), `W19.S1.01 — ${label}: every piece is stored whole, undefined slot type and all`).toEqual(expected);
        answers.push({ label, answer });
      }
      const read = await authoringApp.request(`${H}/catalog?scope=${AUTHORING_TENANT}`, { headers: auth }, env);
      expect(read.status, await read.clone().text()).toBe(200);
      answers.push({ label: 'GET /content/catalog', answer: await read.json() as CatalogAnswer });

      // 2. …and being stored buys it nothing: a piece whose only slot type no
      //    page defines is eligible for no slot the tenant publishes, on the
      //    real ranking function, so the warning is advice about a piece that can
      //    never appear rather than a refusal (contentCompose.ts:252).
      const pieces = await storedPieces(env);
      for (const [page, slots] of Object.entries(FIXTURE_SLOTS.pages)) {
        const set = decideContent({ tenant: AUTHORING_TENANT, brand: AUTHORING_TENANT, page, visitorId: 'w19-b2-visitor', sessionId: null,
          identityAnchor: 'visitor', nowMs: Date.parse('2026-06-01T10:00:00Z'), pieces, slots: slots as unknown as SlotStrategy[],
          affinity: { dims: { line: { Tabby: 0.8, Rogue: 0.8 } } }, arm: 'personalized',
          cell: { channel: 'direct', visit_bucket: '1', region: 'GB-ENG', affinity: 'line:Tabby' },
          versions: { config: 1, catalog: 2, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'w19-b2-registry' });
        expect(set.decisions.map(d => d.contentId),
          `W19.S1.01 — page ${page}: only the pieces whose slot types this tenant's document defines are served`)
          .toEqual(page === 'excluded' ? ['defined-edit'] : ['partly-defined-edit']);
      }

      // 3. THE RULED MISSING MEMBERS (R21, i and ii). The same one advisory
      //    channel the registry already uses — `catalog-registry-diagnostics/v1`,
      //    `warnings[]` keyed by `pieceIndex`, counted in `warningCount` — on
      //    every write answer AND on the read, because the channel is a function
      //    of the stored documents (routes/content.ts:209, :287, :317).
      for (const { label, answer } of answers) {
        expect(answer.diagnostics.warnings,
          `W19.S1.01 — ${label}: a stored piece naming a slot type no page of the tenant's slots document defines is named, by piece and by slot type`)
          .toEqual(expectedWarnings);
        expect(answer.diagnostics.warningCount, `W19.S1.01 — ${label}: and is counted like every other warning`).toBe(2);
        expect(answer.diagnostics.slots,
          `W19.S1.01 — ${label}: the answer names the slots document it compared against, as it already names the registry`)
          .toEqual({ source: 'stored', revision: 1, version: 'w19-b2-slots' });
      }

      // 4. It is the tenant's PUBLISHED document and nothing else: publishing a
      //    `lookbook` page silences that warning on the very next read of the
      //    unchanged catalogue, and the answer names the new slots revision.
      const slotsBody = { version: 'w19-b2-slots', governanceVersion: 3,
        pages: { ...FIXTURE_SLOTS.pages, lookbooks: [{ slot: 'lookbook', take: 2, weights: { line: 1 } }] } };
      const published = await authoringApp.request(`${H}/slots?scope=${AUTHORING_TENANT}`,
        { method: 'PUT', headers: authoredHeaders(env, auth, 'slots'), body: JSON.stringify({ document: slotsBody }) }, env);
      expect(published.status, await published.clone().text()).toBe(200);
      const after = await authoringApp.request(`${H}/catalog?scope=${AUTHORING_TENANT}`, { headers: auth }, env);
      const afterAnswer = await after.json() as CatalogAnswer;
      expect(afterAnswer.diagnostics.warnings,
        'W19.S1.01 — after the tenant publishes a lookbook slot, only the piece naming a slot the tenant still does not define is warned')
        .toEqual([{ code: 'unknown_slot_type', pieceIndex: 1, slotType: COMPILED_ONLY_SLOT_TYPE }]);
      expect(afterAnswer.diagnostics.warningCount, 'W19.S1.01 — and the count follows the document').toBe(1);
      expect(afterAnswer.diagnostics.slots,
        'W19.S1.01 — the answer names the slots revision it compared against, which is the one just published')
        .toEqual({ source: 'stored', revision: 2, version: 'w19-b2-slots+r2' });
    } finally { remote.mockRestore(); }
  });
});

describe('unit:W19.S1.02', () => {
  it('host: the documented `slots` alias is carried on JSON import, CSV import and pull and stored as slotTypes, and a piece with no slot type is refused in the documented words', async () => {
    invalidateCache();
    const env = authoringEnv();
    await initializeAuthoring(env, { version: 'w19-b2-catalog', pieces: [] });
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${await operatorToken()}` };

    // 1. JSON import, the alias the guide publishes (BTI :218: "`slots` for
    //    `slotTypes`"), stored under the canonical name and nowhere else.
    const jsonAlias = { id: 'alias-json', customerContentId: 'CMS-ALIAS-JSON', type: 'editorial', title: 'Alias On The JSON Feed',
      tags: { locale: ['en-GB'], line: ['Tabby'] }, slots: ['market-hero'] };
    const first = await authoringApp.request(`${H}/catalog/import?scope=${AUTHORING_TENANT}`,
      { method: 'POST', headers: publicationHeaders(env, auth, 1), body: JSON.stringify([jsonAlias]) }, env);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await storedPieces(env),
      'W19.S1.02 — the JSON feed\'s `slots` alias is stored as slotTypes, and the alias itself is not stored')
      .toEqual([{ id: 'alias-json', customerContentId: 'CMS-ALIAS-JSON', type: 'editorial', title: 'Alias On The JSON Feed',
        tags: { locale: ['en-GB'], line: ['Tabby'] }, slotTypes: ['market-hero'], lifecycle: { status: 'live' } }]);

    // 2. CSV import, the same alias as a column name (kit 03:119-121: a CSV row
    //    with the same names as columns).
    const csv = csvOf(['id', 'customerContentId', 'type', 'title', 'tags', 'slots', 'status'], [
      { id: 'alias-csv', customerContentId: 'CMS-ALIAS-CSV', type: 'editorial', title: 'Alias On The CSV Feed',
        tags: 'locale:fr-FR;line:Rogue', slots: 'market-rail', status: 'live' },
    ]);
    const second = await authoringApp.request(`${H}/catalog/import?scope=${AUTHORING_TENANT}&format=csv&mode=merge`,
      { method: 'POST', headers: { ...publicationHeaders(env, auth, 2), 'Content-Type': 'text/csv' }, body: csv }, env);
    expect(second.status, await second.clone().text()).toBe(200);
    expect(await storedPieces(env),
      'W19.S1.02 — the CSV column `slots` is carried the same way, and the JSON piece beside it is untouched')
      .toEqual([
        { id: 'alias-json', customerContentId: 'CMS-ALIAS-JSON', type: 'editorial', title: 'Alias On The JSON Feed',
          tags: { locale: ['en-GB'], line: ['Tabby'] }, slotTypes: ['market-hero'], lifecycle: { status: 'live' } },
        { id: 'alias-csv', customerContentId: 'CMS-ALIAS-CSV', type: 'editorial', title: 'Alias On The CSV Feed',
          tags: { locale: ['fr-FR'], line: ['Rogue'] }, slotTypes: ['market-rail'], lifecycle: { status: 'live' } },
      ]);

    // 3. Pull, the OTHER machine path the guide names (BTI :218: "Both machine
    //    paths accept common alternative names"), through the same adapter and
    //    the same seam a CMS feed arrives on.
    const pulled = { id: 'alias-pull', customerContentId: 'CMS-ALIAS-PULL', type: 'editorial', title: 'Alias On The Pulled Feed',
      tags: { locale: ['fr-CA'], line: ['Tabby'] }, slots: ['market-hero', 'market-rail'] };
    const remote = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: [pulled] })));
    try {
      const third = await authoringApp.request(`${H}/catalog/pull?scope=${AUTHORING_TENANT}`,
        { method: 'POST', headers: publicationHeaders(env, auth, 3), body: JSON.stringify({ url: 'https://cms.example/alias-feed', path: 'content', mode: 'merge' }) }, env);
      expect(third.status, await third.clone().text()).toBe(200);
      expect((await storedPieces(env)).at(-1),
        'W19.S1.02 — the pulled feed\'s `slots` alias is carried the same way, and stored under the canonical name')
        .toEqual({ id: 'alias-pull', customerContentId: 'CMS-ALIAS-PULL', type: 'editorial', title: 'Alias On The Pulled Feed',
          tags: { locale: ['fr-CA'], line: ['Tabby'] }, slotTypes: ['market-hero', 'market-rail'], lifecycle: { status: 'live' } });
    } finally { remote.mockRestore(); }

    // 4. A piece with no slot type at all is refused, in the words the guide
    //    publishes (BTI :225-235): the whole batch, naming the record and the
    //    field, and nothing is partially published.
    const before = await storedPieces(env);
    const refused = [
      { id: 'has-a-slot', customerContentId: 'CMS-HAS', type: 'editorial', title: 'Has One', tags: { line: ['Tabby'] }, slots: ['market-hero'] },
      { id: 'has-none', customerContentId: 'CMS-NONE', type: 'editorial', title: 'Has None', tags: { line: ['Tabby'] } },
    ];
    const third = await authoringApp.request(`${H}/catalog/import?scope=${AUTHORING_TENANT}`,
      { method: 'POST', headers: publicationHeaders(env, auth, 4), body: JSON.stringify(refused) }, env);
    expect(third.status, 'W19.S1.02 — a feed whose piece names no slot at all is refused').toBe(422);
    const refusal = await third.json() as CatalogAnswer;
    expect(refusal.ok, 'W19.S1.02 — the answer says so').toBe(false);
    expect(refusal.received, 'W19.S1.02 — and says how many records it read').toBe(2);
    expect(refusal.errors,
      'W19.S1.02 — the refusal names the record and the field in the documented words (BTI guide :233)')
      .toContain('pieces[1].slotTypes: required non-empty string array');

    // 5. …and the same for an empty CSV cell, which is the shape a real feed
    //    fails in. Nothing was published by either refusal.
    const emptyCsv = csvOf(['id', 'customerContentId', 'type', 'title', 'tags', 'slots'], [
      { id: 'csv-has-none', customerContentId: 'CMS-CSV-NONE', type: 'editorial', title: 'CSV Has None', tags: 'line:Tabby', slots: '' },
    ]);
    const fourth = await authoringApp.request(`${H}/catalog/import?scope=${AUTHORING_TENANT}&format=csv`,
      { method: 'POST', headers: { ...publicationHeaders(env, auth, 4), 'Content-Type': 'text/csv' }, body: emptyCsv }, env);
    expect(fourth.status, 'W19.S1.02 — a CSV row with a blank slots cell is refused too').toBe(422);
    expect((await fourth.json() as CatalogAnswer).errors,
      'W19.S1.02 — in the same documented words').toContain('pieces[0].slotTypes: required non-empty string array');
    expect(await storedPieces(env), 'W19.S1.02 — and nothing was partially published by either refusal').toEqual(before);
  });
});
