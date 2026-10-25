// src/units/P84/LEDGER.unit.test.ts
// P84 under the Closure Ledger: the tests for the LOCAL criteria CO1-CO4 of the P84 work order (the activation programme
// of amendment 11, group B, ticket P84 "The context order for the carousel before paint", E8; batch S30). LV1 is a
// deferred live row and gets no test. PROVISIONAL: the shapes marked PROPOSED are the specifier's, to the brief and its
// amendments (R-P359); every line marked RULING is for the lead before the legs are measured.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md, section 2,
// E8):
//   "**Done when:** the published per-context document for the product page carries, beside the approved module layouts
//   per device, channel and visit bucket, a carousel shot order per context; the head script applies it before the first
//   frame, applies the brand rules, and writes the preload for the leading image; the arm is known before paint on a
//   brand-new browser (N4); the server render's image list in the head is the documented input."
//   "**Starts from:** N1, N3, N4 as recorded in `docs/architecture/tapestry-rendering-and-caching-options-2026-10-09.md` §6."
//   "**Relates to:** P01, P30 (the context-only mode is accepted only on the layout slot today), E13."
// The rendering record, section 6 (the Windows checkout; read as a document only):
//   N1 "for each page with a declared layout slot, a shopper-free document holding the approved layouts, one row per
//   context (a mobile and a desktop layout), the default row, the holdout share and salt version, the classifier version
//   and its own version; regenerated whenever a publication changes its inputs ...; served at a stable and a versioned
//   address with public caching".
//   N3 "a standalone script built from the engine's own source (the channel classifier, the thirty-minute visit rule, the
//   buckets) plus the table lookup and the custom-property writes; a byte-exact build check; documented in the kit with
//   its content-security-policy hash".
//   N4 "on a brand-new browser the page draws the arm with the published holdout share before paint, and the engine
//   honours that draw ... A browser the engine already knows computes its arm with the engine's published function."
// D2 RULED (R-P356): N4 by mechanism (a): the engine mints the new visitor identifier into the class the page drew, and
//   the arm stays a pure function of the anchor and the salt (src/content/holdout.ts armFor).
// The work order (docs/parity/activation/program.json, P84): CO1 the published per-context document (layouts per device,
//   channel and visit bucket, a carousel shot order per context, the default row, the holdout share and salt version, the
//   classifier version, its own version; shopper-free; a stable and a versioned address with public caching; regenerated
//   when its inputs change); CO2 the head script built from src/services/visit.ts with a byte-exact build check, the row
//   for the arrival context, the image list ordered within the brand rules (P83), the order where the stylesheet reads it,
//   one preload for the leading image, the row of the cell the engine derives; CO3 the arm known before paint on a
//   brand-new browser by D2's mechanism, a known browser's arm by armFor; CO4 the kit (kit 02 :620-640 and :1934, kit 01
//   :582-587 and :629).
//
// R-P359 (the brief's amendments at the builder's prepared report), as these tests read them:
//   · `arm` rides the DIRECT path's first decision request (src/sdk/listen.ts first.body, src/sdk/core.ts); the session
//     route and the broker are unchanged (a page on them gets the engine's draw; the diagnostic counts the disagreement).
//   · src/reflex/contentCompose.ts is granted: a cold shopper's carousel is tie-broken by the context's shot-order row, so
//     the engine's answer equals the document's row (the lock).
//   · the document under /v1/<tenant>/context-table/<page> and …/<page>/<version>, behind the site-key gate like every
//     /v1 read, computed on read as a pure function of the pinned set, `version` the digest of its bytes,
//     `Cache-Control: public, max-age=60` and `public, max-age=31536000, immutable`, a version no longer in force 404.
//   · the shot vocabulary: the vocabulary in effect for `contentType` where one governs it (P38/P77's form, 422 by name),
//     else bounded non-empty strings, never the catalogue's current values.
//   · `holdout: { share, arms, saltVersion }`; the head script's default-class probability by the engine's own function
//     (share ÷ |arms| per arm, holdout.ts armFor), byte-exact through the build.
//   · the head script inlined by the server render; the build writes `edge-head.js.csp` (base64 SHA-256 of the committed
//     bytes, checked by --check); the kit states the computation, never a literal hash; budget 8192 bytes.
//   · the mint's cap min(4096, ceil(ln(1e-6)/ln(1−p))) with a counted diagnostic (cap reached, mismatch, a learn publish
//     between the holdout read at the mint and the decision's pin).
//   · `shotOrders: [{ context, order }]` on a content slot in P01's context form, refused by name on the layout slot and
//     elsewhere; hash32/bucketOf/armFor may move to src/sdk/head.ts with holdout.ts importing them.
//
// PROPOSED SHAPES (each asserted below; RULING where marked):
//   P1 The slot rule. `shotOrders: [{ context: { channel, visitBuckets, device? }, order: [contentType values] }]` on a slot
//      of a page whose declared layout slot exists, other than that layout slot; the context is P01's exactly (src/content/
//      types.ts OrderContext: `channel` a channel word or `any`, `visitBuckets` a non-empty list or `any`, `device` optional;
//      validateOrders' context rules, its tie and duplicate refusals); `order` 1..16 distinct values. One slot per page
//      carries them (the document names one carouselSlot). Refused 422 naming `pages.<page>[i].shotOrders`: on the layout
//      slot, on a page without a declared layout slot, on a second slot of the page, a context outside the terms, two
//      orders for one context, two contexts of equal specificity; a value outside the vocabulary in effect for
//      `contentType` when an approval governs it (the error names the value and "vocabulary in effect", P38's words), else
//      a value outside kit 03's canonical contentType grammar (1-64 UTF-16 units, no control character, no angle bracket,
//      not __proto__/prototype/constructor). A version-4 member like `orders`. P01's `orders` and P30's `contextOnly`
//      stay layout-only (their locks hold: no R10).
//   P2 The engine's tie-break (contentCompose.ts): on an arm that personalizes, the carousel's ranked candidates of EQUAL
//      score are ordered by the row's shot order (an image's rank: the lowest row index among its tags.contentType values;
//      none listed: after every listed one), then by catalogue order — so a cold shopper's carousel is the row, images of
//      one shot type in catalogue order, then P83's tag pin and minimum exactly as today. The default arm: today's order.
//   P3 The document (GET /v1/<tenant>/context-table/<page>):
//      { version, page, layoutSlot, carouselSlot, classifierVersion, holdout: { share, arms, saltVersion },
//        default: { layout: { mobile, desktop }, shotOrder: { mobile, desktop } },
//        rows: [{ channel, visitBucket, layout: { mobile, desktop }, shotOrder: { mobile, desktop } }],
//        brandRules: { minimum?, pinnedTag? } }
//      rows: every cell of the tenant's terms (the six channel words × 1, 2-3, 4+ for a tenant without a context
//      vocabulary), channels in ENTRY_CHANNELS order then buckets in cut order; a cell's layout per device is the module
//      list of the P01 order the engine resolves for it (configuredOrderFor's rule), its shotOrder per device the order of
//      the P1 rule resolved by the same rule; null where none matches (the page keeps its server order). The default row
//      is null throughout. `holdout` from the learn document in force (saltVersion as W21 counts it). `brandRules` the
//      carousel slot's P83 rules as published. `classifierVersion` = CLASSIFIER_VERSION (a NEW export of src/services/
//      visit.ts, the version the head script carries; a document naming another makes the script paint the default row).
//      RULING: `version` = the SHA-256 hex of the document's canonical JSON (keys sorted, no white space) without
//      `version`. A page with no declared layout slot 404; on a page whose slots carry no shot orders, carouselSlot is null,
//      every shotOrder null and brandRules {}.
//   P4 The head script: src/sdk/head.ts → `public/sdk/edge-head.js` (IIFE), its copies `public/sdk/0.2.0/edge-head.js` and
//      `packages/sdk/edge-head.js` (a third SDK_TARGETS entry in scripts/build-sdk.mjs), each with `edge-head.js.csp`
//      beside it holding `sha256-<base64 SHA-256 of the bytes>`; packages/sdk/package.json exports it with sizeBudget 8192.
//      Its inputs, written by the server render in the head before it: `<script type="application/json"
//      id="op-context-table">` (the document) and `<script type="application/json" id="op-images">` (the carousel's image
//      list in the server order: [{ id, tags: { contentType?, <each brand-rule dimension>? }, src, srcset?, sizes? }]).
//      Its outputs on the root element: `data-op-context` = `<channel>|<visitBucket>|<device>` of the row applied or
//      `default`; `data-op-arm` = `default` | `personalized`; `data-op-table` = the version applied; one custom property
//      `--op-<carouselSlot>-<n>` per image, n its 1-based server position, the value its 1-based painted position; one
//      `<link rel="preload" as="image" href imagesrcset imagesizes fetchpriority="high">` for the leading image, before
//      the first stylesheet link. It hides nothing, fetches nothing, sends nothing and writes no cookie. Its state in
//      first-party storage under `opt_head`: { visit: { visitCount, lastVisitAt, entryChannel?, lastSeen }, arm?: { class,
//      tableVersion, saltVersion }, experiment?: { id, saltVersion } } (RULING: the key and members).
//      The cell: liveVisit + visitBucket (src/services/visit.ts) over the stored visit and the page's entry (the SDK's
//      entrySignals form: utm_medium/utm_source/utm_campaign/utm_term, document.referrer, location.hostname) — the cell
//      the engine records at the page's first event; the device by deviceOf over navigator's user agent (no device: the
//      default row). The default row: the holdout class, no recorded personalization consent (RULING: the root's
//      `data-op-consent` naming `personalization`, which the page's consent adapter writes before the script; the SDK's
//      refusal cookie `opt_personalization_enabled=false` overrides it), an unknown channel, a classifier version other
//      than its own, a salt version other than the stored one (one paint, the stored class re-derived next time). The
//      brand rules apply on every row, the default included, exactly as the engine applies them (P83's tag pin within its
//      window, then the minimum's promotion).
//   P5 The arm (direct path, R-P359): a brand-new browser's head script draws `default` with probability p = share ×
//      (count of `default` in arms) ÷ |arms| (armFor's split), else `personalized`, from crypto.getRandomValues, and
//      stores { class, tableVersion, saltVersion }; the SDK's first decision request (direct mode, fresh browser) carries
//      `arm`: the JSON text of { class, tableVersion } (RULING: a string, as `entry` is — snapshotContext's allow-list
//      admits string values only, decisions.ts :954-957); the engine mints `vis-` identifiers (newAnonymousSession with a
//      target, through anonymousWithConsent) until armFor(subject, holdout) is in the class (`personalized` = any arm but
//      `default`), at most min(4096, ceil(ln(1e-6)/ln(1−p))) draws, p the class's probability; p 0 or 1: one draw. The
//      answer carries `armRequest: { class, honoured, reason? }` (reason `capped` | `mismatch` | `ignored`); the learn
//      queue (GET /v1/<tenant>/learn/queue) answers `arm_draw: { capped, mismatch, republished, ignored }` beside
//      `enrollment_anchor_unavailable`, counted as W21's enrollment counter is. A request carrying a session and `arm`:
//      ignored (reason `ignored`), its arm unchanged. A known browser: the head script computes armFor(opt_visitor_id,
//      { share, arms, salt }), the salt read from the stored experiment.id (`<tenant>:<brand>:<salt>`), which the SDK
//      stores from every answer's `experiment`.
//
// READINGS THE CODE CONTRADICTS (for ruling):
//   C1 The brief's lock "the script's classifier output equals visitArrival's channel": visitArrival answers device and
//      recency only (src/services/visit.ts :427-436); the channel and the visit number are liveVisit's (:378) and
//      projectVisit's (:404), the bucket visitBucket's (:492). These tests lock the script to liveVisit + visitBucket.
//   C2 A brand-new shopper's decision before any event reads the visit bucket `unknown` (projectVisit's visitNumber is
//      null for a shopper with no stored count, :404-414; cellFor → visitBucketOf(null) = 'unknown', src/content/cell.ts
//      :100), and configuredOrderFor matches no context on an unknown bucket (decide.ts :745-749); the direct path's first
//      request carries no entry (src/sdk/listen.ts :382-384: "consent-dependent context (session, channel, entry) is never
//      sent then"). So the engine's FIRST answer to a brand-new browser is decided for no context, whatever the page
//      painted. These tests measure the lock from the page's first event on (a page_view carrying the entry opens visit 1
//      of the context, then the decision), as the carousel design note §4 has the engine's own order apply "at the next
//      page view". RULING: or the engine reads a never-seen shopper as visit 1 with the request's entry.
//   C3 A brand-new browser has no recorded choice on the engine at its first request (personalization takes an explicit
//      instruction, src/content/consent.ts personalizes()), so its first answer's experiment.arm is the ineligible
//      assignment, not the page's class; these tests assert the class on the identifier (armFor(subject, salt)) and on
//      the first answer after her choice, and `armRequest` on the first answer.
//   C4 A tenant with a published context vocabulary (P36) classifies by its own rules and cut (classifyByVocabulary,
//      contextTermsOf): the document then needs the rules and the cut for the script to derive the same cell. Not
//      specified here (the parity tenant publishes none). RULING: the document carries `contextVocabulary: { revision,
//      rules, channels, visitBuckets }` when one is in force, or the script paints the default row for such a tenant.
//   C5 A recognised shopper's anchor is the earliest linked browser (holdout.ts enrollmentAnchorOf :255), which the head
//      script cannot see: on another browser its computed class can differ from the engine's (a residual, counted as a
//      mismatch by the engine).
//   C6 The rows are per device (mobile, desktop): a request reporting no device matches only contexts naming none
//      (types.ts OrderContext; decide.ts :752); the script paints the default row when it can read no device.
//   C7 Kit 01 :629-631 ("cache the module order, never an inner slot's items") and kit 02 :1960 ("On a context-only layout
//      slot the inner slots are decided for the shopper") stand: the document carries shot TYPES per context, never
//      items; CO4 adds the sentence that the carousel's shot order is published per context and leaves those two true.
//
// R10 SWEEP (the locks the readings meet; none needs a grant on these shapes):
//   src/units/P01/LEDGER.unit.test.ts :270-271 (P01.O5: `orders` on a slot that is not the declared layout slot refused
//   422) and src/units/P30/LEDGER.unit.test.ts :555-557 (P30.X6: `contextOnly` on the recently-viewed slot refused 422)
//   HOLD: `shotOrders` is its own member and both refusals stay (CO1 asserts them as controls). To measure under the
//   sketch (R-P248): scripts/stamp-workflow.test.mjs :59-67 (SDK_TARGETS' outputs read before and after), src/units/P34/
//   LEDGER.unit.test.ts :461-490 (P34.T5's --check and its copy), src/units/P60/LEDGER.unit.test.ts :513-527 (verifySDK
//   with a flipped bundle), src/index.api-boundary.test.ts :2643-2651 (W01.08: every public file outside CUSTOMER_ASSETS
//   404), src/units/W21/B1.unit.test.ts :1502 and src/units/W29/B1.unit.test.ts :458 (the learn queue's members),
//   src/sdk/*.test.ts (the first request's body), src/units/P13 (the direct path).
//
// NEW EXPORT IMPORTED: CLASSIFIER_VERSION from src/services/visit.ts (P3); RED on its absence where named.
//
// DEFERRED / RESIDUAL: the learn-publish race between the mint's holdout read and the decision's pin is specified as a
// counted reason (`republished`) but not provoked here; LV1.
//
// HARNESS: src/units/_parity.ts (the mounted app, both hosts), src/units/_parity5.ts (putKind, readKind), src/units/W08/
// _customer.ts (the in-process customer stamp: the real Worker, enforced, the site key), jsdom (the built head script),
// src/sdk/memoryHost.ts and testHost.ts (the SDK over the mounted app). Imports from src/units/: ../_parity, ../_parity5,
// ../W08/_customer.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { JSDOM, ResourceLoader } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

// The customer stamp loads the real Worker (src/index.ts); the module doubles its harness names (src/units/W08/_customer.ts).
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { armFor } from '@/content/holdout';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { HoldoutConfig } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { identityRoutes } from '@/routes/identity';
import { createCore } from '@/sdk/core';
import { createListen } from '@/sdk/listen';
import { memoryHost } from '@/sdk/memoryHost';
import { authorityLocks } from '@/sdk/testHost';
import type { RequestInitLike, ResponseLike } from '@/sdk/types';
import { deviceOf } from '@/services/platform';
// CLASSIFIER_VERSION is a NEW export (P3); the rest are today's.
import { CLASSIFIER_VERSION, liveVisit, visitBucket, type ChannelSignals, type VisitContext } from '@/services/visit';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

import {
  asOperator, BRAND, declaredSlots, errorsOf, expectPublished, HOSTS, LAYOUT, layoutSlot, learnDocument, loadDocument, M, MODULES, mount,
  PAGE_VIEW, pageInstanceOf, putDocument, readTree, REFLEX_DOCUMENT, shopperOn, TENANT, type Decision, type Mounted, type Shopper,
} from '../_parity';
import { putKind } from '../_parity5';
import { customerStamp, SDK_KEY, TENANT as CUSTOMER_TENANT, type Stamp } from '../W08/_customer';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// ---------------------------------------------------------------------------
// The fixture: the product page's declared layout slot (P01's per-context module orders) and its carousel, the images of
// one product with their shot tags (carousel design note §10: `tags.contentType` on_model, studio, detail, flat_lay), an
// image with no shot tag (an unknown input), one with a shot no row names (`video`), the wallet's image (another
// product: the carousel is scoped to the anchor, P80), P83's on-model minimum; the holdout at 20 per cent.
// ---------------------------------------------------------------------------

const CAROUSEL = 'pdp-carousel';
const A = 'COA-CH857', B = 'COA-CB925';
const SITE = 'www.coach.com';
interface Image { id: string; customerContentId: string; type: string; title: string; tags: Record<string, string[]>; slotTypes: string[];
  lifecycle: { status: string }; featuredProductIds: string[] }
const image = (n: number, contentType: string[] | null, product = A, extra: Record<string, string[]> = {}): Image => ({
  id: `img-${product.slice(4).toLowerCase()}-${n}`, customerContentId: `TAP-IMG-${product}-${n}`, type: 'image', title: `${product} image ${n}`,
  tags: { category: [product === A ? 'Handbags' : 'Small Leather Goods'], ...(contentType ? { contentType } : {}), ...extra },
  slotTypes: [CAROUSEL], lifecycle: { status: 'live' }, featuredProductIds: [product] });
/** Product A's images in the server's (and the catalogue's) order: 1 studio, 2 flat_lay, 3 on_model, 4 detail, 5 on_model, 6 studio, 7 untagged, 8 video. */
const IMAGES = [image(1, ['studio']), image(2, ['flat_lay']), image(3, ['on_model']), image(4, ['detail']), image(5, ['on_model']),
  image(6, ['studio']), image(7, null), image(8, ['video'])];
/** Cross-product: the wallet's on-model image, never a candidate on A's page (scope: 'anchor'). */
const WALLET = image(1, ['on_model'], B);
/** The launch image (P83's tag pin): a studio shot tagged campaign launch-hero, last in the server order. */
const LAUNCH_IMAGE = image(9, ['studio'], A, { campaign: ['launch-hero'] });
const id = (n: number) => `img-ch857-${n}`;
const ids = (...ns: number[]) => ns.map(id);

const MINIMUM = { dimension: 'contentType', value: 'on_model', count: 1, within: 2 };
const T0 = Date.now();
const WINDOW = { from: new Date(T0 - 3_600_000).toISOString(), to: new Date(T0 + 4 * 3_600_000).toISOString() };
const PINNED_TAG = { dimension: 'campaign', value: 'launch-hero', window: WINDOW };

/** The shot orders: three contexts and a bucket-wide one (P1, P01's context form). */
const SHOT_PS = ['on_model', 'detail', 'studio', 'flat_lay'], SHOT_SEARCH = ['detail', 'studio'], SHOT_EMAIL = ['flat_lay', 'detail', 'studio', 'on_model'], SHOT_LOYAL = ['studio'];
const SHOT_ORDERS = [
  { context: { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' }, order: SHOT_PS },
  { context: { channel: 'paid_search', visitBuckets: ['1', '2-3'] }, order: SHOT_SEARCH },
  { context: { channel: 'email', device: 'desktop', visitBuckets: 'any' }, order: SHOT_EMAIL },
  { context: { channel: 'any', visitBuckets: ['4+'] }, order: SHOT_LOYAL },
];
/** P01's module orders on the layout slot. */
const LAYOUT_PS = [M.reco2, M.editorial, M.grid], LAYOUT_EMAIL = [M.grid, M.reco1];
const LAYOUT_ORDERS = [
  { context: { channel: 'paid_social', visitBuckets: ['1'] }, modules: LAYOUT_PS },
  { context: { channel: 'email', device: 'desktop', visitBuckets: 'any' }, modules: LAYOUT_EMAIL },
];
const carousel = (over: Record<string, unknown> = {}) => ({ slot: CAROUSEL, take: 8, weights: { category: 1 }, scope: 'anchor', minimum: MINIMUM, ...over });
/** The slots: the product page (layout + carousel with its shot orders) and a cart page with no declared layout slot. */
const slotsOf = (carouselOver: Record<string, unknown> = { shotOrders: SHOT_ORDERS }, extraPdp: unknown[] = []) => ({
  ...declaredSlots([]), pages: { pdp: [layoutSlot({ orders: LAYOUT_ORDERS }), carousel(carouselOver), ...extraPdp], cart: [{ slot: 'cart-recs', take: 2, weights: { category: 1 } }] } });
const HOLDOUT = { share: 0.2, salt: 'p84-salt', arms: ['default'] };
const learnOf = (holdout: Record<string, unknown> = HOLDOUT) => learnDocument({ [CAROUSEL]: { measurementBasis: 'rendered-v1', reward: 'click' } }, { holdout });
const DOCS = { pieces: [...MODULES, ...IMAGES, WALLET], slots: slotsOf(), learn: learnOf() };
const docsWith = (over: { slots?: unknown; learn?: unknown; pieces?: unknown[] }) => ({ ...DOCS, ...over });

// ---------------------------------------------------------------------------
// The document as the witness determines it (P3): every cell of the six words × 1, 2-3, 4+, each resolved by P01's rule
// (a context matches its channel or `any`, its buckets or `any`, its device or none; the most specific wins).
// ---------------------------------------------------------------------------

const CHANNELS = ['direct', 'paid_social', 'paid_search', 'email', 'organic', 'referral'] as const;
const BUCKETS = ['1', '2-3', '4+'] as const;
type PerDevice = { desktop: string[] | null; mobile: string[] | null };
const both = (v: string[] | null): PerDevice => ({ desktop: v, mobile: v });
/** The rows by hand, from SHOT_ORDERS and LAYOUT_ORDERS above. */
function expectedRow(channel: string, bucket: string): { channel: string; layout: PerDevice; shotOrder: PerDevice; visitBucket: string } {
  const loyal = bucket === '4+';
  const layout: PerDevice = channel === 'paid_social' && bucket === '1' ? both(LAYOUT_PS) : channel === 'email' ? { desktop: LAYOUT_EMAIL, mobile: null } : both(null);
  const shotOrder: PerDevice = channel === 'paid_social' && bucket === '1' ? { desktop: null, mobile: SHOT_PS }
    : channel === 'paid_search' && !loyal ? both(SHOT_SEARCH)
    : channel === 'email' ? { desktop: SHOT_EMAIL, mobile: loyal ? SHOT_LOYAL : null }
    : loyal ? both(SHOT_LOYAL) : both(null);
  return { channel, layout, shotOrder, visitBucket: bucket };
}
const EXPECTED_ROWS = CHANNELS.flatMap(channel => BUCKETS.map(bucket => expectedRow(channel, bucket)));
const DEFAULT_ROW = { layout: both(null), shotOrder: both(null) };
const expectedDocument = (over: Record<string, unknown> = {}) => ({ page: 'pdp', layoutSlot: LAYOUT, carouselSlot: CAROUSEL, classifierVersion: CLASSIFIER_VERSION,
  holdout: { arms: ['default'], saltVersion: 1, share: 0.2 }, default: DEFAULT_ROW, rows: EXPECTED_ROWS, brandRules: { minimum: MINIMUM }, ...over });

/** Canonical JSON: keys sorted at every level, no white space (P3's digest input). */
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(value);
const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const withoutVersion = (doc: Record<string, unknown>) => Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'version'));

interface TableAnswer { status: number; cacheControl: string | null; setCookie: string | null; text: string; body: Record<string, unknown> }
/** GET /v1/<tenant>/context-table/<path>, no session, no token: as a server render or an edge cache reads it. */
async function tableAt(m: Mounted, path: string): Promise<TableAnswer> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/context-table/${path}`, { headers: { 'X-Tenant': TENANT } }));
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { unparsed: text.slice(0, 200) }; }
  return { status: response.status, cacheControl: response.headers.get('Cache-Control'), setCookie: response.headers.get('Set-Cookie'), text, body };
}
const shown = (a: { status: number; text?: string; body?: unknown }) => `${a.status} ${(a.text ?? JSON.stringify(a.body ?? {})).slice(0, 240)}`;
const versionOf = (a: TableAnswer) => String(a.body.version ?? '');
const NAMES_A_SHOPPER = /vis-|"s-|visitor|session|decision|subject|anchor/i;

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const deviceHeaders = (device: 'mobile' | 'desktop') => ({ 'User-Agent': device === 'mobile' ? MOBILE_UA : DESKTOP_UA, 'Sec-CH-UA-Mobile': device === 'mobile' ? '?1' : '?0' });
const PAID_SOCIAL = { utmMedium: 'paid_social', utmSource: 'instagram' }, EMAIL = { utmMedium: 'email', utmSource: 'newsletter' },
  PAID_SEARCH = { utmMedium: 'cpc', utmSource: 'google' };

/** The product page's decision for her: POST /v1/<tenant>/decisions/snapshot naming the anchor product, on her device. */
async function pdpPage(m: Mounted, s: Shopper, device: 'mobile' | 'desktop', body: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown>; rail: string[] }> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json', ...deviceHeaders(device) },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p84'), 'ctx.anchor': A, ...body }) }));
  const answer = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body: answer, rail: railOf(answer) };
}
const railOf = (body: Record<string, unknown>) => ((body.decisions ?? []) as Decision[]).filter(d => d.slot === CAROUSEL).sort((a, b) => a.order - b.order).map(d => d.contentId);
/** A new shopper whose first event, a page view carrying the arrival (or none), opened visit 1 (C2). */
async function arrived(m: Mounted, entry: Record<string, string> | null): Promise<Shopper> {
  const s = await shopperOn(m);
  const viewed = await s.action(PAGE_VIEW, entry ?? undefined);
  expect(viewed.status, `PRECONDITION (${m.host}): her first page view is accepted (${JSON.stringify(viewed.body).slice(0, 160)})`).toBe(200);
  return s;
}

// ===========================================================================
// unit:P84.CO1 — the published per-context document: rows, addresses, caching, regeneration; the shot-order rule; the lock
// ===========================================================================

describe('unit:P84.CO1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): GET /v1/{tenant}/context-table/pdp with no session and no token answers the shopper-free document (P3: every cell of the six channels × 1, 2-3, 4+ with its module layout and shot order per device, the default row, the holdout share, arms and salt version, the classifier version, the carousel's brand rules, its own version, the SHA-256 of its canonical bytes) with Cache-Control public, max-age=60; …/pdp/{version} answers the same bytes public, max-age=31536000, immutable`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P84.CO1 — the product page with its layout orders and the carousel\'s shot orders publishes (today the shotOrders member is not read)');
      const stable = await tableAt(m, 'pdp');
      expect.soft(stable.status, `${host}: P84.CO1 — the stable address answers (today no such route: ${shown(stable)})`).toBe(200);
      expect.soft(withoutVersion(stable.body), `${host}: P84.CO1 — the document's members and rows as P3 has them`).toEqual(expectedDocument());
      expect.soft([/^[0-9a-f]{64}$/.test(versionOf(stable)), versionOf(stable) === sha256Hex(canonical(withoutVersion(stable.body))) ? 'the digest of its canonical bytes' : 'another value'],
        `${host}: P84.CO1 — its version is the SHA-256 of its canonical bytes (RULING P3)`).toEqual([true, 'the digest of its canonical bytes']);
      expect.soft({ cacheControl: stable.cacheControl, setCookie: stable.setCookie, namesAShopper: NAMES_A_SHOPPER.test(stable.text) },
        `${host}: P84.CO1 — public for 60 seconds, no cookie, no shopper, session or decision named`).toEqual({ cacheControl: 'public, max-age=60', setCookie: null, namesAShopper: false });
      const versioned = await tableAt(m, `pdp/${versionOf(stable) || 'none'}`);
      expect.soft({ status: versioned.status, cacheControl: versioned.cacheControl, same: versioned.text === stable.text },
        `${host}: P84.CO1 — the versioned address serves the same bytes, immutable for a year`).toEqual({ status: 200, cacheControl: 'public, max-age=31536000, immutable', same: true });
    }, 120_000);

    it(`host (${host}): the document is regenerated from its inputs — a slots publication changing a shot order moves the version, the stable address serves the new one and the old version answers 404; a learn publication changing the holdout share moves it; one leaving the document's inputs as they were keeps the version and the bytes`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P84.CO1 — the documents publish');
      const first = await tableAt(m, 'pdp');
      expect(first.status, `${host}: P84.CO1 — the stable address answers (today no such route: ${shown(first)})`).toBe(200);
      const changed = SHOT_ORDERS.map(o => o.context.channel === 'any' ? { ...o, order: ['detail'] } : o);
      const republished = await putDocument(m, 'slots', slotsOf({ shotOrders: changed }), 'p84 loyal order');
      expect(republished.status, `${host}: PRECONDITION — the changed shot order publishes (${JSON.stringify(errorsOf(republished))})`).toBe(200);
      const second = await tableAt(m, 'pdp');
      const old = await tableAt(m, `pdp/${versionOf(first)}`), current = await tableAt(m, `pdp/${versionOf(second)}`);
      const loyal = (second.body.rows as Array<{ channel: string; visitBucket: string; shotOrder: PerDevice }> | undefined)?.find(r => r.channel === 'direct' && r.visitBucket === '4+')?.shotOrder;
      expect.soft({ moved: versionOf(second) !== versionOf(first), loyal, old: old.status, current: current.status, same: current.text === second.text },
        `${host}: P84.CO1 — a changed input moves the version; the old version is no longer in force`).toEqual({ moved: true, loyal: both(['detail']), old: 404, current: 200, same: true });
      const learnChanged = await putDocument(m, 'learn', learnOf({ ...HOLDOUT, share: 0.3 }), 'p84 share');
      expect(learnChanged.status, `${host}: PRECONDITION — the learn document publishes (${JSON.stringify(errorsOf(learnChanged))})`).toBe(200);
      const third = await tableAt(m, 'pdp');
      expect.soft([versionOf(third) !== versionOf(second), (third.body.holdout as Record<string, unknown> | undefined)?.share],
        `${host}: P84.CO1 — the holdout share is an input`).toEqual([true, 0.3]);
      const unrelated = await putDocument(m, 'learn', { ...learnOf({ ...HOLDOUT, share: 0.3 }), regional: { enabled: false, kBlend: 2, minEvents: 40 } }, 'p84 regional');
      expect(unrelated.status, `${host}: PRECONDITION — an unrelated learn edit publishes (${JSON.stringify(errorsOf(unrelated))})`).toBe(200);
      const fourth = await tableAt(m, 'pdp');
      expect.soft([fourth.status, fourth.text === third.text], `${host}: P84.CO1 — an edit outside its inputs leaves the document byte for byte (a pure function of the pinned set)`).toEqual([200, true]);
    }, 120_000);

    it(`host (${host}): a page with no declared layout slot (cart) and a page the slots do not name (home) answer 404; the product page whose slots carry no shot orders answers its layouts, carouselSlot null, every shot order null and no brand rules (P3)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P84.CO1 — the documents publish');
      const control = await tableAt(m, 'pdp');
      expect(control.status, `${host}: P84.CO1 — CONTROL: the product page's document answers (today no such route: ${shown(control)})`).toBe(200);
      const plain = await mount(host, docsWith({ slots: slotsOf({}) }));
      expectPublished(plain, 'P84.CO1 — the product page with no shot orders publishes');
      const answers = [await tableAt(m, 'cart'), await tableAt(m, 'home')].map(a => a.status);
      expect.soft(answers, `${host}: P84.CO1 — no document where there is no declared layout slot (P3)`).toEqual([404, 404]);
      const layoutsOnly = await tableAt(plain, 'pdp');
      expect.soft([layoutsOnly.status, withoutVersion(layoutsOnly.body)], `${host}: P84.CO1 — a product page with layouts and no shot orders`).toEqual([200,
        expectedDocument({ carouselSlot: null, brandRules: {}, rows: EXPECTED_ROWS.map(r => ({ ...r, shotOrder: both(null) })) })]);
    }, 120_000);

    it(`host (${host}): the lock — for a new shopper whose first page view carries the arrival, the engine's carousel is the document's row for her cell and device within the brand rules (paid social on mobile, email on desktop, paid search on desktop), the server order where her cell has no row (paid social on desktop, an unknown arrival), and the server order on the holdout's default arm; images of one shot type in server order, the untagged and the unnamed shot after them, the other product's image never`, async () => {
      const m = await mount(host, docsWith({ learn: learnOf({ ...HOLDOUT, share: 0 }) }));
      expectPublished(m, 'P84.CO1 — the documents publish');
      const table = await tableAt(m, 'pdp');
      const rowOf = (channel: string, bucket: string) => (table.body.rows as Array<{ channel: string; visitBucket: string; shotOrder: PerDevice }> | undefined)?.find(r => r.channel === channel && r.visitBucket === bucket)?.shotOrder ?? null;
      expect.soft([rowOf('paid_social', '1')?.mobile, rowOf('email', '1')?.desktop, rowOf('paid_search', '1')?.desktop],
        `${host}: P84.CO1 — the document names the three rows the shoppers below arrive in (today no such route: ${shown(table)})`).toEqual([SHOT_PS, SHOT_EMAIL, SHOT_SEARCH]);
      const cases: Array<[string, Record<string, string> | null, 'mobile' | 'desktop', string[]]> = [
        ['paid social, visit 1, mobile', PAID_SOCIAL, 'mobile', ids(3, 5, 4, 1, 6, 2, 7, 8)],
        // flat_lay, detail, studio, on_model: the minimum brings image 3 into the first two, image 4 following at once.
        ['email, visit 1, desktop', EMAIL, 'desktop', ids(2, 3, 4, 1, 6, 5, 7, 8)],
        // detail, studio, then the rest in server order: the minimum brings image 3 into the first two.
        ['paid search, visit 1, desktop', PAID_SEARCH, 'desktop', ids(4, 3, 1, 6, 2, 5, 7, 8)],
        ['paid social, visit 1, desktop (no row)', PAID_SOCIAL, 'desktop', ids(1, 3, 2, 4, 5, 6, 7, 8)],
        ['an arrival with no entry (unknown)', null, 'mobile', ids(1, 3, 2, 4, 5, 6, 7, 8)],
      ];
      const served: Array<[string, string[]]> = [];
      for (const [name, entry, device] of cases) {
        const page = await pdpPage(m, await arrived(m, entry), device);
        expect(page.status, `${host}: PRECONDITION — ${name}: the page is answered (${JSON.stringify(page.body).slice(0, 200)})`).toBe(200);
        served.push([name, page.rail]);
      }
      expect.soft(served, `${host}: P84.CO1 — the engine's carousel for a new shopper is her context's row within the brand rules (today the shot orders are not read: the server order)`).toEqual(cases.map(([name, , , rail]) => [name, rail]));
      const holdout = await mount(host, docsWith({ learn: learnOf({ ...HOLDOUT, share: 1 }) }));
      expectPublished(holdout, 'P84.CO1 — the holdout-only documents publish');
      const control = await pdpPage(holdout, await arrived(holdout, PAID_SOCIAL), 'mobile');
      expect.soft([control.status, control.rail], `${host}: P84.CO1 — on the holdout's default arm the server order within the brand rules, whatever the row`).toEqual([200, ids(1, 3, 2, 4, 5, 6, 7, 8)]);
    }, 180_000);
  }

  it('host: the shot-order rule publishes on the carousel as authored (P1) and is refused 422 naming pages.pdp[i].shotOrders, writing nothing — on the layout slot, on a page with no declared layout slot, on a second slot of the page, a channel outside the six words, two orders for one context, two contexts of equal specificity, a value outside the contentType grammar; with an approved vocabulary governing contentType a value outside it is refused naming the value (never the catalogue\'s current values: `zoom` is admitted while nothing governs it); P01\'s orders and P30\'s switch stay refused on the carousel', async () => {
    const m = await mount('session', DOCS);
    expectPublished(m, 'P84.CO1 — the documents publish');
    const stored = (await loadDocument(m, 'slots')).document as { pages: Record<string, Array<Record<string, unknown>>> };
    expect.soft(stored.pages.pdp?.find(s => s.slot === CAROUSEL)?.shotOrders, 'P84.CO1 — the published carousel keeps its shot orders as authored (today the member is not kept)').toEqual(SHOT_ORDERS);
    const zoom = await putDocument(m, 'slots', slotsOf({ shotOrders: [{ context: { channel: 'organic', visitBuckets: 'any' }, order: ['zoom', 'on_model'] }] }), 'p84 zoom');
    expect.soft([zoom.status, errorsOf(zoom)], 'P84.CO1 — with no vocabulary governing contentType any bounded value publishes, though no image carries `zoom`').toEqual([200, []]);
    const revision = (await loadDocument(m, 'slots')).revision;
    const second = { slot: 'pdp-second', take: 2, weights: { category: 1 } };
    const refusals: Array<[string, unknown, string]> = [
      ['on the layout slot', { ...slotsOf({}), pages: { pdp: [layoutSlot({ shotOrders: SHOT_ORDERS }), carousel()] } }, 'pdp-modules'],
      ['on a page with no declared layout slot', { ...slotsOf(), pages: { ...slotsOf().pages, cart: [{ slot: 'cart-recs', take: 2, weights: { category: 1 }, shotOrders: SHOT_ORDERS }] } }, 'cart-recs'],
      ['on a second slot of the page', slotsOf({ shotOrders: SHOT_ORDERS }, [{ ...second, shotOrders: [SHOT_ORDERS[0]] }]), 'pdp-second'],
      ['a channel outside the six words', slotsOf({ shotOrders: [{ context: { channel: 'tiktok', visitBuckets: ['1'] }, order: ['on_model'] }] }), 'tiktok'],
      ['two orders for one context', slotsOf({ shotOrders: [SHOT_ORDERS[1], { ...SHOT_ORDERS[1], order: ['studio'] }] }), 'paid_search'],
      ['two contexts of equal specificity', slotsOf({ shotOrders: [{ context: { channel: 'email', visitBuckets: 'any' }, order: ['studio'] }, { context: { channel: 'any', visitBuckets: ['1'] }, order: ['detail'] }] }), 'any'],
      ['a value outside the grammar (an angle bracket)', slotsOf({ shotOrders: [{ context: { channel: 'email', visitBuckets: ['1'] }, order: ['<b>model</b>'] }] }), '<b>model</b>'],
      ['a value repeated', slotsOf({ shotOrders: [{ context: { channel: 'email', visitBuckets: ['1'] }, order: ['studio', 'studio'] }] }), 'studio'],
      ['P01 orders on the carousel (control)', slotsOf({ orders: [{ context: { channel: 'email', visitBuckets: ['1'] }, modules: [id(1)] }] }), 'pdp-carousel'],
      ['P30 contextOnly on the carousel (control)', slotsOf({ contextOnly: { enabled: true } }), 'pdp-carousel'],
    ];
    const outcomes: Array<{ case: string; status: number; named: boolean; errors: string[] }> = [];
    for (const [name, document, offending] of refusals) {
      const answer = await putDocument(m, 'slots', document, name);
      const errors = errorsOf(answer);
      const member = /control/.test(name) ? /orders|contextOnly/ : /shotOrders/;
      outcomes.push({ case: name, status: answer.status, named: errors.some(e => e.includes(offending) && member.test(e)), errors });
    }
    expect.soft(outcomes.map(o => ({ case: o.case, status: o.status, named: o.named })),
      `P84.CO1 — each refused 422 naming the member and the offending value or slot: ${JSON.stringify(outcomes.map(o => [o.case, o.errors.slice(0, 2)]))}`)
      .toEqual(refusals.map(([name]) => ({ case: name, status: 422, named: true })));
    expect.soft((await loadDocument(m, 'slots')).revision, 'P84.CO1 — no refused document wrote a revision').toBe(revision);
    // The vocabulary in effect governs contentType (P38): its ids only.
    const vocabulary = { version: 'p84-shots', attributes: { contentType: { values: ['on_model', 'studio', 'detail', 'flat_lay', 'video'].map(v => ({ id: v, name: v.replace('_', ' ') })) } } };
    const written = await putKind(m, 'vocabulary', vocabulary, 'p84 vocabulary');
    expect(written.status, `PRECONDITION — the vocabulary publishes (${JSON.stringify(written.body).slice(0, 200)})`).toBe(200);
    const head = await asOperator(m, 'GET', `/content/vocabulary?scope=${TENANT}`);
    const publication = head.body.publication as { revision: number; digest: string } | undefined;
    const approved = await asOperator(m, 'POST', `/content/vocabulary/approve/1?scope=${TENANT}`, {}, {
      ...(publication ? { 'If-Match': `"${head.body.revision as number}/${publication.revision}/${publication.digest}"` } : {}), 'Idempotency-Key': `${head.body.revision as number}:${crypto.randomUUID()}` });
    expect(approved.status, `PRECONDITION — revision 1 is approved (${JSON.stringify(approved.body).slice(0, 200)})`).toBe(200);
    const governed = await putDocument(m, 'slots', slotsOf({ shotOrders: [{ context: { channel: 'organic', visitBuckets: 'any' }, order: ['zoom', 'on_model'] }] }), 'p84 zoom governed');
    expect.soft([governed.status, errorsOf(governed).some(e => /shotOrders/.test(e) && e.includes('zoom') && /vocabulary in effect/.test(e))],
      `P84.CO1 — under the vocabulary in effect a value outside it is refused 422 by name (P38's form): ${JSON.stringify(errorsOf(governed))}`).toEqual([422, true]);
    const admitted = await putDocument(m, 'slots', slotsOf(), 'p84 governed ids');
    expect.soft([admitted.status, errorsOf(admitted)], 'P84.CO1 — its ids publish').toEqual([200, []]);
  }, 180_000);

  for (const host of HOSTS) {
    it(`host (${host}): on a customer deployment (the in-process customer stamp: the real Worker, AUTH_MODE enforced) the document is behind the site-key gate like every /v1 read — 401 without the site key, 200 with it in the header or the query, the versioned address likewise; the boundary admits the two reads for GET alone`, async () => {
      const s = await stampWithPdp(host);
      const path = `/v1/${CUSTOMER_TENANT}/context-table/pdp`;
      const withoutKey = await s.call('GET', path, { token: null });
      const withKey = await s.call('GET', path, { token: null, headers: { 'X-SDK-Key': SDK_KEY } });
      const inQuery = await s.call('GET', `${path}?sdkKey=${SDK_KEY}`, { token: null });
      const versioned = await s.call('GET', `${path}/${String(withKey.body.version ?? 'none')}`, { token: null, headers: { 'X-SDK-Key': SDK_KEY } });
      const posted = await s.call('POST', path, { token: null, headers: { 'X-SDK-Key': SDK_KEY }, body: {} });
      expect.soft({ withoutKey: [withoutKey.status, withoutKey.body.error], withKey: [withKey.status, withoutVersion(withKey.body).page], inQuery: inQuery.status,
        versioned: versioned.status, posted: posted.status },
      `${host}: P84.CO1 — the customer profile admits the document behind the site key (today the boundary refuses the path: ${JSON.stringify(withKey.body).slice(0, 160)})`).toEqual({
        withoutKey: [401, 'SDK key required'], withKey: [200, 'pdp'], inQuery: 200, versioned: 200, posted: 404 });
    }, 120_000);
  }
});

/** The customer stamp's tenant with its six-member set, the product page's documents (P77's, P90's pattern). */
async function stampWithPdp(host: (typeof HOSTS)[number]): Promise<Stamp> {
  const s = await customerStamp(host);
  const at = Date.now();
  const members: Array<[DocumentKind<unknown>, string, unknown]> = [
    [REFLEX_KIND as DocumentKind<unknown>, reflexScopeForTenant(CUSTOMER_TENANT), REFLEX_DOCUMENT],
    [CONTENT_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, { version: 'p84-catalogue', pieces: DOCS.pieces }],
    [SLOTS_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, DOCS.slots],
    [LEARN_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, DOCS.learn],
    [PRIORS_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, EMPTY_PRIORS],
    [PROPOSALS_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, EMPTY_PROPOSALS],
  ];
  await initializePublicationSet(s.env as Env, members.map(([kind, scope, value]) => ({ kind, scope,
    revision: { revision: 1, value, actor: 'ops', note: `p84 ${kind.name}`, at } })) as PublicationBaseline[], `0:${crypto.randomUUID()}`);
  invalidatePublicationCache(); invalidateCache();
  return s;
}

// ---------------------------------------------------------------------------
// The head script, built (public/sdk/edge-head.js), run in a browser double (jsdom: the page's location, referrer, user
// agent, first-party storage and cookie; the server render's two inert blocks in the head before it; a stylesheet link
// after them). Nothing is fetched (the double loads no subresource) and every send is counted.
// ---------------------------------------------------------------------------

const HEAD_FILE = join(ROOT, 'public', 'sdk', 'edge-head.js');
interface HeadImage { id: string; tags: Record<string, string[]>; src: string; srcset: string; sizes: string }
const headImage = (img: Image): HeadImage => ({ id: img.id,
  tags: Object.fromEntries(Object.entries(img.tags).filter(([k]) => k === 'contentType' || k === 'campaign')),
  src: `https://images.example.invalid/${img.id}.jpg`, srcset: `https://images.example.invalid/${img.id}-640.jpg 640w, https://images.example.invalid/${img.id}-1280.jpg 1280w`,
  sizes: '(max-width: 768px) 100vw, 50vw' });
const HEAD_IMAGES = IMAGES.map(headImage);
const LAUNCH_HEAD_IMAGES = [...IMAGES, LAUNCH_IMAGE].map(headImage);
/** The document as a server render would inline it: P3's members with their version. */
const tableDocument = (over: Record<string, unknown> = {}) => { const doc = expectedDocument(over); return { ...doc, version: sha256Hex(canonical(doc)) }; };
const TABLE = tableDocument();
const PRODUCT_URL = 'https://www.coach.com/products/tabby-shoulder-bag-26';
class NoFetch extends ResourceLoader { override fetch() { return null; } }

interface HeadOptions { url: string; referrer?: string; userAgent?: string; table: unknown; images: HeadImage[]; storage?: Record<string, string>;
  cookie?: string; consent?: boolean; random?: number; now?: number }
interface HeadRun { error: string | null; context: string | null; arm: string | null; table: string | null; positions: string[]; order: string[];
  preloads: Array<Record<string, string | null>>; preloadBeforeStylesheet: boolean; otherStyles: string[]; hidden: number; sent: number; cookieWritten: boolean;
  stored: Record<string, unknown> | null }
function runHead(o: HeadOptions): HeadRun {
  const none: HeadRun = { error: null, context: null, arm: null, table: null, positions: [], order: [], preloads: [], preloadBeforeStylesheet: false, otherStyles: [],
    hidden: 0, sent: 0, cookieWritten: false, stored: null };
  if (!existsSync(HEAD_FILE)) return { ...none, error: 'public/sdk/edge-head.js is not built (today there is no head script)' };
  const html = `<!doctype html><html${o.consent === false ? '' : ' data-op-consent="personalization"'}><head>`
    + `<script type="application/json" id="op-context-table">${JSON.stringify(o.table)}</script>`
    + `<script type="application/json" id="op-images">${JSON.stringify(o.images)}</script>`
    + '<link rel="stylesheet" href="/css/site.css"></head><body><div class="pdp-carousel">'
    + o.images.map(i => `<figure data-op-slot="${CAROUSEL}" data-op-content="${i.id}"><img src="${i.src}" alt=""></figure>`).join('') + '</div></body></html>';
  const dom = new JSDOM(html, { url: o.url, ...(o.referrer ? { referrer: o.referrer } : {}), runScripts: 'outside-only',
    resources: new NoFetch({ userAgent: o.userAgent ?? DESKTOP_UA }) });
  const w = dom.window;
  for (const [k, v] of Object.entries(o.storage ?? {})) w.localStorage.setItem(k, v);
  if (o.cookie) w.document.cookie = o.cookie;
  const cookieBefore = w.document.cookie;
  let sent = 0;
  const count = () => { sent += 1; };
  Object.defineProperty(w, 'fetch', { configurable: true, value: () => { count(); return Promise.reject(new Error('the head script fetches nothing')); } });
  Object.defineProperty(w.navigator, 'sendBeacon', { configurable: true, value: () => { count(); return false; } });
  const xhr = w.XMLHttpRequest.prototype as unknown as { open: (...a: unknown[]) => void };
  const open = xhr.open;
  xhr.open = function (this: unknown, ...args: unknown[]) { count(); open.apply(this, args); };
  const random = o.random ?? 0.999;
  w.Math.random = () => random;
  Object.defineProperty(w, 'crypto', { configurable: true, value: { randomUUID: () => crypto.randomUUID(),
    getRandomValues: <T extends ArrayBufferView>(a: T): T => { new Uint32Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 4)).fill(Math.min(4294967295, Math.floor(random * 4294967296))); return a; } } });
  if (o.now !== undefined) { const now = o.now; w.Date.now = () => now; }
  let error: string | null = null;
  try { w.eval(readFileSync(HEAD_FILE, 'utf8')); } catch (e) { error = `the head script threw: ${(e as Error).message}`; }
  const root = w.document.documentElement;
  const positions = o.images.map((_, n) => root.style.getPropertyValue(`--op-${CAROUSEL}-${n + 1}`).trim());
  const order = o.images.map((img, n) => ({ id: img.id, at: Number(positions[n]) })).filter(x => Number.isInteger(x.at) && x.at >= 1).sort((a, b) => a.at - b.at).map(x => x.id);
  const links = [...w.document.head.querySelectorAll('link')];
  const attr = (l: Element, name: string, property: string) => l.getAttribute(name) ?? ((l as unknown as Record<string, unknown>)[property] as string | undefined) ?? null;
  const preloads = links.filter(l => l.getAttribute('rel') === 'preload').map(l => ({ as: attr(l, 'as', 'as'), href: attr(l, 'href', 'href'),
    imagesrcset: attr(l, 'imagesrcset', 'imageSrcset'), imagesizes: attr(l, 'imagesizes', 'imageSizes'), fetchpriority: attr(l, 'fetchpriority', 'fetchPriority') }));
  const firstPreload = links.findIndex(l => l.getAttribute('rel') === 'preload'), firstStylesheet = links.findIndex(l => l.getAttribute('rel') === 'stylesheet');
  const otherStyles = Array.from({ length: root.style.length }, (_, i) => root.style.item(i)).filter(name => !name.startsWith('--op-'));
  const hidden = [...w.document.querySelectorAll('[hidden], body [style]')].length;
  let stored: Record<string, unknown> | null = null;
  try { stored = JSON.parse(w.localStorage.getItem('opt_head') ?? 'null') as Record<string, unknown> | null; } catch { stored = null; }
  return { error, context: root.getAttribute('data-op-context'), arm: root.getAttribute('data-op-arm'), table: root.getAttribute('data-op-table'), positions, order, preloads,
    preloadBeforeStylesheet: firstPreload >= 0 && firstPreload < firstStylesheet, otherStyles, hidden, sent, cookieWritten: w.document.cookie !== cookieBefore, stored };
}
const urlWith = (q: Record<string, string>) => `${PRODUCT_URL}${Object.keys(q).length ? `?${new URLSearchParams(q).toString()}` : ''}`;
/** The arrival as the SDK's entrySignals reads a page (src/sdk/identity.ts): its utm fields, the referrer and the site host. */
const entryOf = (q: Record<string, string>, referrer: string): ChannelSignals => ({ utmMedium: q.utm_medium ?? '', utmSource: q.utm_source ?? '',
  ...(q.utm_term && q.utm_term.length <= 256 ? { utmTerm: q.utm_term } : {}), ...(q.utm_campaign && q.utm_campaign.length <= 256 ? { utmCampaign: q.utm_campaign } : {}), referrer, siteHost: SITE });
const deviceFor = (ua: string) => deviceOf({ get: (name: string) => name === 'User-Agent' ? ua : null });

// ===========================================================================
// unit:P84.CO2 — the head script: built from the engine's classifier, the row of the engine's cell, the order within
// the brand rules where the stylesheet reads it, one preload
// ===========================================================================

const NOW = Date.UTC(2026, 9, 25, 15, 0, 0);
const MINUTE = 60_000, DAY = 86_400_000;
interface ArrivalCase { name: string; q: Record<string, string>; referrer: string; ua: string; prior: (VisitContext & { lastSeen: number }) | null }
const ARRIVALS: ArrivalCase[] = [
  { name: 'paid social, first landing, mobile', q: { utm_medium: 'paid_social', utm_source: 'instagram' }, referrer: 'https://l.instagram.com/', ua: MOBILE_UA, prior: null },
  { name: 'cpc from Facebook (the source decides the paid cell)', q: { utm_medium: 'cpc', utm_source: 'facebook' }, referrer: '', ua: DESKTOP_UA, prior: null },
  { name: 'cpc from Google', q: { utm_medium: 'cpc', utm_source: 'google', utm_term: 'tabby bag' }, referrer: 'https://www.google.com/', ua: DESKTOP_UA, prior: null },
  { name: 'organic search, untagged', q: {}, referrer: 'https://www.google.co.uk/', ua: MOBILE_UA, prior: null },
  { name: 'a lookalike of the network (cross input)', q: {}, referrer: 'https://google.com.evil.example/', ua: DESKTOP_UA, prior: null },
  { name: 'email by its source alone', q: { utm_source: 'klaviyo' }, referrer: '', ua: DESKTOP_UA, prior: null },
  { name: 'a bare paid medium naming no network (unknown input)', q: { utm_medium: 'paid', utm_source: 'acme-network' }, referrer: '', ua: DESKTOP_UA, prior: null },
  { name: 'typed in, no referrer', q: {}, referrer: '', ua: DESKTOP_UA, prior: null },
  { name: 'an Android tablet (desktop)', q: { utm_medium: 'email', utm_source: 'newsletter' }, referrer: '', ua: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', prior: null },
  { name: 'a return two days later on a paid search click (visit 2)', q: { utm_medium: 'cpc', utm_source: 'bing' }, referrer: 'https://www.bing.com/', ua: DESKTOP_UA,
    prior: { visitCount: 1, lastVisitAt: NOW - 2 * DAY, entryChannel: 'email', lastSeen: NOW - 2 * DAY } },
  { name: 'a reload inside the visit keeps the visit\'s channel (visit 4)', q: {}, referrer: 'https://www.coach.com/bags', ua: MOBILE_UA,
    prior: { visitCount: 4, lastVisitAt: NOW - 20 * MINUTE, entryChannel: 'paid_social', lastSeen: NOW - 10 * MINUTE } },
  { name: 'thirty minutes idle opens visit 3', q: {}, referrer: '', ua: MOBILE_UA, prior: { visitCount: 2, lastVisitAt: NOW - 2 * 60 * MINUTE, entryChannel: 'organic', lastSeen: NOW - 30 * MINUTE } },
  { name: 'no browser in the user agent (no device: the default row)', q: { utm_medium: 'email', utm_source: 'newsletter' }, referrer: '', ua: 'curl/8.7.1', prior: null },
];
/** The engine's cell for the same page: liveVisit + visitBucket (C1), the device by deviceOf; `default` where the channel or the device is unknown. */
function engineCell(c: ArrivalCase): { context: string; visit: Record<string, unknown> } {
  const prior = c.prior ? { visitCount: c.prior.visitCount, lastVisitAt: c.prior.lastVisitAt, entryChannel: c.prior.entryChannel } : null;
  const visit = liveVisit(prior, c.prior?.lastSeen ?? null, NOW, entryOf(c.q, c.referrer));
  const device = deviceFor(c.ua);
  return { context: visit.entryChannel && device ? `${visit.entryChannel}|${visitBucket(visit.visitCount)}|${device}` : 'default', visit: { ...visit, lastSeen: NOW } };
}
const storedVisit = (prior: ArrivalCase['prior']) => prior ? { opt_head: JSON.stringify({ visit: prior }) } : {};

describe('unit:P84.CO2', () => {
  it('logic: the head script is built by scripts/build-sdk.mjs from src/sdk/head.ts (a third SDK target, IIFE, with its two copies), its bundle reads src/services/visit.ts; `node scripts/build-sdk.mjs --check` exits 0 and names it; each copy carries edge-head.js.csp = sha256-<base64 SHA-256 of its bytes>; the package exports it within an 8192-byte budget; on a copy of the tree one byte off in any copy or its .csp fails the check by name', async () => {
    const build = await import(/* @vite-ignore */ new URL('../../../scripts/build-sdk.mjs', import.meta.url).href) as {
      SDK_TARGETS: Array<{ entry: string; output: string; format: string }>;
      buildSDK: (o: { root: string }) => Promise<Array<{ metafile: { inputs: Record<string, unknown>; outputs: Record<string, { inputs: Record<string, unknown> }> } }>>;
      verifySDK: (o: { root: string }) => Promise<unknown> };
    const target = build.SDK_TARGETS.find(t => t.output === 'public/sdk/edge-head.js');
    expect.soft(target, 'P84.CO2 — the head script is an SDK target (today SDK_TARGETS holds the two bundles only)').toEqual({ entry: 'src/sdk/head.ts', output: 'public/sdk/edge-head.js', format: 'iife' });
    const check = spawnSync(process.execPath, ['scripts/build-sdk.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect.soft([check.status, /public\/sdk\/edge-head\.js: exact nonwriting match/.test(check.stdout)], `P84.CO2 — the byte-exact check covers it (${check.stderr.slice(0, 200)})`).toEqual([0, true]);
    const copies = ['public/sdk/edge-head.js', 'public/sdk/0.2.0/edge-head.js', 'packages/sdk/edge-head.js'];
    const csp = copies.map(path => {
      if (!existsSync(join(ROOT, path))) return [path, 'missing'];
      const expected = `sha256-${createHash('sha256').update(readFileSync(join(ROOT, path))).digest('base64')}`;
      return [path, existsSync(join(ROOT, `${path}.csp`)) && readFileSync(join(ROOT, `${path}.csp`), 'utf8') === expected ? 'its hash' : 'no hash of its bytes'];
    });
    expect.soft(csp, 'P84.CO2 — three copies, each with its content-security-policy hash beside it').toEqual(copies.map(path => [path, 'its hash']));
    const manifest = JSON.parse(readTree('packages/sdk/package.json')) as { exports?: unknown; sizeBudget?: Record<string, number> };
    const bytes = existsSync(join(ROOT, 'packages/sdk/edge-head.js')) ? readFileSync(join(ROOT, 'packages/sdk/edge-head.js')).length : -1;
    expect.soft([JSON.stringify(manifest.exports ?? {}).includes('./edge-head.js'), manifest.sizeBudget?.['./edge-head.js'], bytes > 0 && bytes <= 8192],
      'P84.CO2 — the package exports the head script with its 8192-byte budget, and it is within it').toEqual([true, 8192, true]);
    if (!target) return;
    const results = await build.buildSDK({ root: ROOT });
    const head = results[build.SDK_TARGETS.indexOf(target)];
    expect.soft(Object.keys(head?.metafile.inputs ?? {}).filter(p => /src\/(services\/visit|content\/holdout|sdk\/head)\.ts$/.test(p)).some(p => p.endsWith('services/visit.ts')),
      'P84.CO2 — built from the engine\'s own classifier source').toBe(true);
    const copy = mkdtempSync(join(tmpdir(), 'p84-head-'));
    for (const dir of ['src/sdk', 'public/sdk', 'packages/sdk']) cpSync(join(ROOT, dir), join(copy, dir), { recursive: true });
    for (const result of results) for (const input of Object.keys(result.metafile.inputs)) cpSync(join(ROOT, input), join(copy, input));
    const unflagged: string[] = [];
    for (const path of [...copies, ...copies.map(p => `${p}.csp`)]) {
      const original = readFileSync(join(copy, path));
      const changed = Buffer.from(original); changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
      writeFileSync(join(copy, path), changed);
      const failure = await build.verifySDK({ root: copy }).then(() => null, (e: Error) => e.message);
      if (!failure || !failure.includes(path)) unflagged.push(`${path}: ${failure ?? 'passed'}`);
      writeFileSync(join(copy, path), original);
    }
    expect.soft(unflagged, 'P84.CO2 — a copy or its hash one byte off fails the check by name (the copy is left under the system temporary directory)').toEqual([]);
  }, 300_000);

  it('sdk: the built script\'s cell is the engine\'s — for a table of arrivals (paid social, cpc by its source, organic, a lookalike host, email by its source, a bare paid medium, typed in, a tablet, a return, a reload inside the visit, thirty minutes idle, no browser) its data-op-context is liveVisit + visitBucket + deviceOf for the same page and stored visit, and it stores the visit as liveVisit leaves it', () => {
    const runs = ARRIVALS.map(c => ({ c, run: runHead({ url: urlWith(c.q), referrer: c.referrer, userAgent: c.ua, table: TABLE, images: HEAD_IMAGES, storage: storedVisit(c.prior), now: NOW }) }));
    expect.soft(runs.map(({ run }) => run.error).filter(Boolean), 'P84.CO2 — the head script runs').toEqual([]);
    expect.soft(runs.map(({ c, run }) => [c.name, run.context]), 'P84.CO2 — its cell equals the engine\'s for every arrival').toEqual(ARRIVALS.map(c => [c.name, engineCell(c).context]));
    expect.soft(runs.map(({ c, run }) => [c.name, (run.stored as { visit?: unknown } | null)?.visit ?? null]), 'P84.CO2 — the visit it keeps is the engine\'s (RULING P4: opt_head.visit)')
      .toEqual(ARRIVALS.map(c => [c.name, engineCell(c).visit]));
  });

  it('sdk: the row it applies — the cell\'s on a recorded consent; the default row for the holdout class, for no recorded consent, for the SDK\'s refusal cookie, for a classifier version not its own and, for one paint, for a rotated salt version; it names the table version it applied', () => {
    const ps = { url: urlWith({ utm_medium: 'paid_social', utm_source: 'instagram' }), userAgent: MOBILE_UA, images: HEAD_IMAGES, now: NOW };
    const arm = (cls: string, saltVersion = 1) => ({ opt_head: JSON.stringify({ arm: { class: cls, saltVersion, tableVersion: TABLE.version } }) });
    const rotated = tableDocument({ holdout: { arms: ['default'], saltVersion: 2, share: 0.2 } });
    // The class is asserted where the reading fixes it (null: not asserted, the rotated salt's class being re-derived later).
    const cases: Array<[string, HeadRun, string, string | null]> = [
      ['a brand-new browser drawn personalized', runHead({ ...ps, table: TABLE, random: 0.999 }), 'paid_social|1|mobile', 'personalized'],
      ['a stored holdout class', runHead({ ...ps, table: TABLE, storage: arm('default') }), 'default', 'default'],
      ['no recorded consent', runHead({ ...ps, table: TABLE, consent: false }), 'default', 'personalized'],
      ['the SDK\'s refusal cookie', runHead({ ...ps, table: TABLE, cookie: 'opt_personalization_enabled=false' }), 'default', 'personalized'],
      ['another classifier version', runHead({ ...ps, table: tableDocument({ classifierVersion: 'p84-another-classifier' }) }), 'default', 'personalized'],
      ['a rotated salt version (one paint)', runHead({ ...ps, table: rotated, storage: arm('personalized', 1) }), 'default', null],
    ];
    expect.soft(cases.map(([name, run]) => [name, run.error]).filter(([, e]) => e), 'P84.CO2 — the head script runs').toEqual([]);
    expect.soft(cases.map(([name, run, , armClass]) => [name, run.context, armClass === null ? null : run.arm]), 'P84.CO2 — the row each page applies, and its class')
      .toEqual(cases.map(([name, , context, armClass]) => [name, context, armClass]));
    expect.soft(cases.map(([name, run]) => [name, run.table]), 'P84.CO2 — each names the table version it read')
      .toEqual(cases.map(([name]) => [name, name === 'another classifier version' ? tableDocument({ classifierVersion: 'p84-another-classifier' }).version : name.startsWith('a rotated') ? rotated.version : TABLE.version]));
  });

  it('sdk: the order — the row\'s shot order, images of one shot type in server order, the untagged and the unnamed shot after them, within P83\'s minimum and, inside its window, its tag pin (and not outside it); the default row keeps the server order within the same rules; one custom property per image position on the root, nothing hidden, exactly one image preload for the leading image before the stylesheet, nothing fetched or sent, no cookie written', () => {
    const page = (q: Record<string, string>, ua: string, extra: Partial<HeadOptions> = {}) => runHead({ url: urlWith(q), userAgent: ua, table: TABLE, images: HEAD_IMAGES, now: NOW, random: 0.999, ...extra });
    const launchTable = tableDocument({ brandRules: { minimum: MINIMUM, pinnedTag: PINNED_TAG } });
    const cases: Array<[string, HeadRun, string[]]> = [
      ['paid social on mobile', page({ utm_medium: 'paid_social', utm_source: 'instagram' }, MOBILE_UA), ids(3, 5, 4, 1, 6, 2, 7, 8)],
      ['email on desktop: the minimum brings image 3 in', page({ utm_medium: 'email', utm_source: 'newsletter' }, DESKTOP_UA), ids(2, 3, 4, 1, 6, 5, 7, 8)],
      ['paid search: a partial order', page({ utm_medium: 'cpc', utm_source: 'google' }, DESKTOP_UA), ids(4, 3, 1, 6, 2, 5, 7, 8)],
      ['email on desktop, the launch inside its window', page({ utm_medium: 'email', utm_source: 'newsletter' }, DESKTOP_UA, { table: launchTable, images: LAUNCH_HEAD_IMAGES, now: T0 }),
        ids(9, 3, 2, 4, 1, 6, 5, 7, 8)],
      ['email on desktop, before the launch window', page({ utm_medium: 'email', utm_source: 'newsletter' }, DESKTOP_UA, { table: launchTable, images: LAUNCH_HEAD_IMAGES, now: T0 - 2 * 3_600_000 }),
        ids(2, 3, 4, 1, 6, 9, 5, 7, 8)],
      ['the holdout class: the server order within the rules', page({ utm_medium: 'paid_social', utm_source: 'instagram' }, MOBILE_UA, { random: 0 }), ids(1, 3, 2, 4, 5, 6, 7, 8)],
    ];
    expect.soft(cases.map(([name, run]) => [name, run.error]).filter(([, e]) => e), 'P84.CO2 — the head script runs').toEqual([]);
    expect.soft(cases.map(([name, run]) => [name, run.order]), 'P84.CO2 — the painted order').toEqual(cases.map(([name, , order]) => [name, order]));
    const [first] = cases;
    // Image n (server position n) painted at: 1→4, 2→6, 3→1, 4→3, 5→2, 6→5, 7→7, 8→8.
    expect.soft(first![1].positions, 'P84.CO2 — one custom property per server position, its painted position as the value').toEqual(['4', '6', '1', '3', '2', '5', '7', '8']);
    const lead = HEAD_IMAGES[2]!;
    expect.soft(cases.map(([name, run]) => [name, run.preloads.length, run.preloads[0]?.href ?? null]),
      'P84.CO2 — exactly one preload, naming the image that leads').toEqual(cases.map(([name, , order]) => [name, 1, `https://images.example.invalid/${order[0]}.jpg`]));
    expect.soft({ preload: first![1].preloads[0] ?? null, before: first![1].preloadBeforeStylesheet }, 'P84.CO2 — the preload matches the slide and comes before the stylesheet')
      .toEqual({ preload: { as: 'image', href: lead.src, imagesrcset: lead.srcset, imagesizes: lead.sizes, fetchpriority: 'high' }, before: true });
    expect.soft(cases.map(([name, run]) => [name, run.otherStyles, run.hidden, run.sent, run.cookieWritten]),
      'P84.CO2 — it writes custom properties only, hides nothing, sends nothing and writes no cookie').toEqual(cases.map(([name]) => [name, [], 0, 0, false]));
  });

  for (const host of HOSTS) {
    it(`host (${host}): the lock — with the launch rule in its window, the head script's paint for a brand-new browser (the table from the stable address, the image list in server order) equals the engine's carousel for the same arrival and device after her first page view, for paid social on mobile, email on desktop and paid search on desktop`, async () => {
      const m = await mount(host, docsWith({ pieces: [...MODULES, ...IMAGES, LAUNCH_IMAGE, WALLET], learn: learnOf({ ...HOLDOUT, share: 0 }),
        slots: slotsOf({ take: 9, shotOrders: SHOT_ORDERS, pinnedTag: PINNED_TAG }) }));
      expectPublished(m, 'P84.CO2 — the documents with the launch rule publish');
      const table = await tableAt(m, 'pdp');
      expect(table.status, `${host}: P84.CO2 — the stable address answers (today no such route: ${shown(table)})`).toBe(200);
      const arrivals: Array<[string, Record<string, string>, Record<string, string>, 'mobile' | 'desktop', string[]]> = [
        ['paid social on mobile', PAID_SOCIAL, { utm_medium: 'paid_social', utm_source: 'instagram' }, 'mobile', ids(9, 3, 5, 4, 1, 6, 2, 7, 8)],
        ['email on desktop', EMAIL, { utm_medium: 'email', utm_source: 'newsletter' }, 'desktop', ids(9, 3, 2, 4, 1, 6, 5, 7, 8)],
        // detail, studio, the rest in server order after the launch lead: the minimum brings image 3 in beside it.
        ['paid search on desktop', PAID_SEARCH, { utm_medium: 'cpc', utm_source: 'google' }, 'desktop', ids(9, 3, 4, 1, 6, 2, 5, 7, 8)],
      ];
      const outcomes: Array<[string, string[], string[]]> = [];
      for (const [name, entry, q, device] of arrivals) {
        const engine = await pdpPage(m, await arrived(m, entry), device);
        expect(engine.status, `${host}: PRECONDITION — ${name}: the page is answered`).toBe(200);
        const paint = runHead({ url: urlWith(q), userAgent: device === 'mobile' ? MOBILE_UA : DESKTOP_UA, table: table.body, images: LAUNCH_HEAD_IMAGES });
        outcomes.push([name, paint.order, engine.rail]);
      }
      expect.soft(outcomes, `${host}: P84.CO2 — the page's paint and the engine's carousel are one order`).toEqual(arrivals.map(([name, , , , order]) => [name, order, order]));
    }, 180_000);
  }
});

// ===========================================================================
// unit:P84.CO3 — the arm known before paint (D2, mechanism (a)): the mint honours the page's draw; a known browser's arm
// ===========================================================================

const classOf = (arm: string) => arm === 'default' ? 'default' : 'personalized';
const holdoutOf = (share: number, arms: Array<'default' | 'no_learning'> = ['default']): HoldoutConfig => ({ share, salt: 'p84-salt', arms });
interface FirstAnswer { status: number; body: Record<string, unknown>; session: { subject?: string; capability?: string; sessionId?: string; grantId?: string; iat?: number; exp?: number } | null }
/** A brand-new browser's first decision request on the direct path (P13): no session, the page's `arm` member when given (P5: its JSON text). */
async function firstRequest(m: Mounted, member?: { class: string; tableVersion: string }): Promise<FirstAnswer> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...deviceHeaders('mobile') },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p84-first'), 'ctx.anchor': A, ...(member ? { arm: JSON.stringify(member) } : {}) }) }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body, session: (body.session ?? null) as FirstAnswer['session'] };
}
/** Her explicit choice through the real route, then her next decision's experimental assignment. */
async function chosenArm(m: Mounted, session: NonNullable<FirstAnswer['session']>): Promise<string | null> {
  const chose = await m.fetch(new Request(`https://shop.invalid/realtime/session/${session.sessionId}/preferences`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: String(session.capability), 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackingConsent: true, personalizationEnabled: true, choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: session.grantId, iat: session.iat, exp: session.exp } }) }));
  await m.drain();
  if (chose.status !== 200) return `her choice was refused (${chose.status})`;
  const next = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: String(session.capability), 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf('p84-next'), 'ctx.anchor': A }) }));
  const body = await next.json().catch(() => ({})) as { experiment?: { arm?: string } };
  await m.drain();
  return body.experiment?.arm ?? null;
}
const armDraw = async (m: Mounted) => ((await asOperator(m, 'GET', `/v1/${TENANT}/learn/queue?brand=${BRAND}`)).body.arm_draw ?? null) as Record<string, number> | null;
/** The identifiers one first request mints, counted as calls of crypto.randomUUID while it runs (P5: one per draw beside the request's own). */
async function counted(m: Mounted, member?: { class: string; tableVersion: string }): Promise<{ answer: FirstAnswer; uuids: number }> {
  const spy = vi.spyOn(crypto, 'randomUUID');
  try { const answer = await firstRequest(m, member); return { answer, uuids: spy.mock.calls.length }; } finally { spy.mockRestore(); }
}

/** The identity routes, mounted as src/index.ts mounts them, beside the parity app (P80's harness). */
const identityApp = new Hono<{ Bindings: Env }>();
identityApp.use('*', tenantMiddleware());
identityApp.route('/v1', identityRoutes);
/** The SDK over the mounted app as a new browser (no session), its first-party storage as the head script left it; every call recorded. */
function freshSdk(m: Mounted, stored: Record<string, string>) {
  const calls: Array<{ call: string; session: boolean; body: Record<string, unknown> | null; answer: Record<string, unknown> }> = [];
  const host = memoryHost({ acquireAuthorityLock: authorityLocks(), uuid: () => crypto.randomUUID(), now: () => Date.now(),
    fetch: async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
      const target = new URL(url);
      const request = new Request(`https://shop.invalid${target.pathname}${target.search}`, { method: init?.method ?? 'GET',
        headers: { ...(init?.headers ?? {}), 'X-Tenant': TENANT }, ...(init?.body === undefined ? {} : { body: init.body }) });
      const pending: Promise<unknown>[] = [];
      const response = target.pathname.includes('/identity/')
        ? await identityApp.fetch(request, m.env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext)
        : await m.fetch(request);
      const json = await response.json().catch(() => ({})) as Record<string, unknown>;
      while (pending.length) await Promise.all(pending.splice(0));
      await m.drain();
      let body: Record<string, unknown> | null = null;
      try { body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null; } catch { body = null; }
      calls.push({ call: `${init?.method ?? 'GET'} ${target.pathname}`, session: Boolean(init?.headers?.[SHOPPER_HEADER]), body, answer: json });
      return { ok: response.ok, status: response.status, json: async () => json };
    } });
  for (const [k, v] of Object.entries(stored)) host.storage.set(k, v);
  const core = createCore({ tenant: TENANT, endpoint: 'https://shop.invalid', source: 'sdk', brand: BRAND }, host);
  const listen = createListen(core);
  return { host, core, listen, calls, destroy: () => { listen.destroy(); core.disconnect(); } };
}
const firstCall = (calls: ReturnType<typeof freshSdk>['calls']) => calls.find(c => c.call === `POST /v1/${TENANT}/decisions/snapshot` && !c.session) ?? null;

describe('unit:P84.CO3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a brand-new browser's draw is honoured by the mint — at a 30 per cent holdout six first requests drawn default and six drawn personalized each issue an identifier whose armFor(identifier, the published holdout) is the class drawn, each answer saying armRequest { class, honoured: true }; after her choice her next decision's experiment.arm is that class`, async () => {
      const holdout = holdoutOf(0.3);
      const m = await mount(host, docsWith({ learn: learnOf({ ...holdout }) }));
      expectPublished(m, 'P84.CO3 — the documents publish');
      const version = versionOf(await tableAt(m, 'pdp')) || 'p84-no-table-today';
      const drawn: Array<[string, number, string | null, unknown]> = [];
      const sessions = new Map<string, NonNullable<FirstAnswer['session']>>();
      for (const cls of ['default', 'personalized']) for (let k = 0; k < 6; k++) {
        const first = await firstRequest(m, { class: cls, tableVersion: version });
        drawn.push([cls, first.status, first.session?.subject ? classOf(armFor(first.session.subject, holdout)) : null, first.body.armRequest ?? null]);
        if (first.session?.subject && !sessions.has(cls)) sessions.set(cls, first.session);
      }
      expect.soft(drawn, `${host}: P84.CO3 — the mint lands every identifier in the class the page drew (today the arm member is refused 401 and the identifier is drawn as before)`)
        .toEqual(drawn.map(([cls]) => [cls, 200, cls, { class: cls, honoured: true }]));
      const after: Array<[string, string | null]> = [];
      for (const [cls, session] of sessions) after.push([cls, await chosenArm(m, session)]);
      expect.soft(after, `${host}: P84.CO3 — after her choice the engine's assignment is the page's class`).toEqual([['default', 'default'], ['personalized', 'personalized']]);
    }, 180_000);

    it(`host (${host}): the cap and the shares that cannot be met — at a holdout of one in a billion a default draw is not met within the cap: the identifier keeps the engine's arm, the answer says { class: default, honoured: false, reason: capped } and the learn queue counts arm_draw.capped; at a share of 0 a default draw, and at a share of 1 a personalized draw, mint once (as many identifiers as a request without the member), answered mismatch and counted; the class those shares can meet is honoured with one mint`, async () => {
      const tiny = await mount(host, docsWith({ learn: learnOf({ ...holdoutOf(1e-9) }) }));
      expectPublished(tiny, 'P84.CO3 — the one-in-a-billion holdout publishes');
      const capped = await firstRequest(tiny, { class: 'default', tableVersion: versionOf(await tableAt(tiny, 'pdp')) || 'p84-no-table-today' });
      expect.soft({ status: capped.status, arm: capped.session?.subject ? armFor(capped.session.subject, holdoutOf(1e-9)) : null, armRequest: capped.body.armRequest ?? null, counted: await armDraw(tiny) },
        `${host}: P84.CO3 — the cap reached: the engine's arm wins, said and counted`).toEqual({ status: 200, arm: 'personalized',
        armRequest: { class: 'default', honoured: false, reason: 'capped' }, counted: { capped: 1, ignored: 0, mismatch: 0, republished: 0 } });
      const outcomes: Array<Record<string, unknown>> = [];
      for (const [share, impossible, possible] of [[0, 'default', 'personalized'], [1, 'personalized', 'default']] as const) {
        const m = await mount(host, docsWith({ learn: learnOf({ ...holdoutOf(share) }) }));
        expectPublished(m, `P84.CO3 — the share ${share} publishes`);
        const version = versionOf(await tableAt(m, 'pdp')) || 'p84-no-table-today';
        const baseline = await counted(m);
        const unmet = await counted(m, { class: impossible, tableVersion: version });
        const met = await counted(m, { class: possible, tableVersion: version });
        outcomes.push({ share, unmet: [unmet.answer.status, unmet.uuids === baseline.uuids ? 'one mint' : `${unmet.uuids} against ${baseline.uuids}`, unmet.answer.body.armRequest ?? null],
          met: [met.answer.status, met.uuids === baseline.uuids ? 'one mint' : `${met.uuids} against ${baseline.uuids}`, met.answer.body.armRequest ?? null], counted: await armDraw(m) });
      }
      expect.soft(outcomes, `${host}: P84.CO3 — a share of 0 or 1 draws without redrawing`).toEqual([
        { share: 0, unmet: [200, 'one mint', { class: 'default', honoured: false, reason: 'mismatch' }], met: [200, 'one mint', { class: 'personalized', honoured: true }], counted: { capped: 0, ignored: 0, mismatch: 1, republished: 0 } },
        { share: 1, unmet: [200, 'one mint', { class: 'personalized', honoured: false, reason: 'mismatch' }], met: [200, 'one mint', { class: 'default', honoured: true }], counted: { capped: 0, ignored: 0, mismatch: 1, republished: 0 } },
      ]);
    }, 180_000);

    it(`host (${host}): a browser the engine already knows — a decision request carrying her session and an arm member naming the other class is answered as without it (her experiment.arm armFor(her identifier, the holdout)), armRequest { honoured: false, reason: ignored }, counted arm_draw.ignored`, async () => {
      const holdout = holdoutOf(0.5);
      const m = await mount(host, docsWith({ learn: learnOf({ ...holdout }) }));
      expectPublished(m, 'P84.CO3 — the documents publish');
      const s = await shopperOn(m);
      const own = classOf(armFor(s.subject, holdout)), other = own === 'default' ? 'personalized' : 'default';
      const plain = await pdpPage(m, s, 'mobile');
      expect((plain.body.experiment as { arm?: string } | undefined)?.arm, `${host}: PRECONDITION — her assignment is armFor(her identifier) (${JSON.stringify(plain.body).slice(0, 160)})`).toBe(armFor(s.subject, holdout));
      const asked = await pdpPage(m, s, 'mobile', { arm: JSON.stringify({ class: other, tableVersion: versionOf(await tableAt(m, 'pdp')) || 'p84-no-table-today' }) });
      expect.soft({ status: asked.status, arm: (asked.body.experiment as { arm?: string } | undefined)?.arm ?? null, armRequest: asked.body.armRequest ?? null, counted: (await armDraw(m))?.ignored ?? null },
        `${host}: P84.CO3 — ignored with a diagnostic (today the member is refused 401)`).toEqual({ status: 200, arm: armFor(s.subject, holdout), armRequest: { class: other, honoured: false, reason: 'ignored' }, counted: 1 });
    }, 120_000);

    it(`sdk (${host}): the SDK's first decision request on the direct path carries arm, the JSON text of the class and table version the head script stored, the issued identifier lands in it, and the SDK keeps the answer's experiment for the head script; a browser with no stored draw sends no arm member (lock)`, async () => {
      const holdout = holdoutOf(0.3);
      const m = await mount(host, docsWith({ learn: learnOf({ ...holdout }) }));
      expectPublished(m, 'P84.CO3 — the documents publish');
      const version = versionOf(await tableAt(m, 'pdp')) || 'p84-no-table-today';
      const drawn = freshSdk(m, { opt_head: JSON.stringify({ arm: { class: 'default', saltVersion: 1, tableVersion: version } }) });
      try {
        await drawn.listen.refresh({ page: 'pdp' } as Parameters<typeof drawn.listen.refresh>[0]);
        const first = firstCall(drawn.calls);
        const text = first?.body?.arm;
        const subject = (first?.answer.session as { subject?: string } | undefined)?.subject ?? null;
        const experiment = first?.answer.experiment as { id?: string; saltVersion?: number | null } | undefined;
        const stored = JSON.parse(drawn.host.storage.get('opt_head') ?? 'null') as { experiment?: unknown } | null;
        expect.soft({ first: first ? 'sent' : `no first request: ${drawn.calls.map(c => c.call).join(', ')}`, arm: typeof text === 'string' ? JSON.parse(text) as unknown : text ?? null,
          minted: subject ? classOf(armFor(subject, holdout)) : null, kept: stored?.experiment ?? null },
        `${host}: P84.CO3 — the stored draw rides the first request and is honoured; the answer's experiment is kept (today the SDK sends no arm)`).toEqual({ first: 'sent',
          arm: { class: 'default', tableVersion: version }, minted: 'default', kept: experiment ? { id: experiment.id, saltVersion: experiment.saltVersion } : 'an answer carrying experiment' });
      } finally { drawn.destroy(); }
      const plain = freshSdk(m, {});
      try {
        await plain.listen.refresh({ page: 'pdp' } as Parameters<typeof plain.listen.refresh>[0]);
        const first = firstCall(plain.calls);
        expect.soft(first ? Object.hasOwn(first.body ?? {}, 'arm') : 'no first request', `${host}: P84.CO3 — LOCK: without a stored draw the first request carries no arm member`).toBe(false);
      } finally { plain.destroy(); }
    }, 120_000);
  }

  it('sdk: the head script\'s draw and a known browser\'s class — a brand-new browser draws default with p = share × (default arms) ÷ |arms| (40 per cent over default and no_learning: 0.19 default, 0.21 personalized; over default alone: 0.39 default, 0.41 personalized) and stores { class, saltVersion, tableVersion }; a browser holding its identifier and the last answer\'s experiment computes armFor(identifier, the salt in experiment.id) whatever its random source says, equal to the engine\'s for forty identifiers', () => {
    const tableFor = (arms: string[], share: number) => tableDocument({ holdout: { arms, saltVersion: 1, share } });
    const two = tableFor(['default', 'no_learning'], 0.4), one = tableFor(['default'], 0.4);
    const page = { url: urlWith({ utm_medium: 'email', utm_source: 'newsletter' }), userAgent: DESKTOP_UA, images: HEAD_IMAGES, now: NOW };
    const draws: Array<[string, { version: string }, number, string]> = [['two arms', two, 0.19, 'default'], ['two arms', two, 0.21, 'personalized'],
      ['one arm', one, 0.39, 'default'], ['one arm', one, 0.41, 'personalized']];
    const runs = draws.map(([name, table, random]) => { const run = runHead({ ...page, table, random }); return [name, random, run.error ?? run.arm, run.stored?.arm ?? null]; });
    expect.soft(runs, 'P84.CO3 — the page draws with the engine\'s split and stores the class with the table version').toEqual(draws.map(([name, table, random, cls]) =>
      [name, random, cls, { class: cls, saltVersion: 1, tableVersion: table.version }]));
    const holdout = holdoutOf(0.5), table = tableFor(['default'], 0.5);
    const visitors = Array.from({ length: 40 }, (_, n) => `vis-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
    const engine = visitors.map(v => classOf(armFor(v, holdout)));
    expect(new Set(engine).size, 'PRECONDITION — the forty identifiers fall in both classes').toBe(2);
    const known = visitors.map(v => runHead({ ...page, table, random: 0, storage: { opt_visitor_id: v,
      opt_head: JSON.stringify({ experiment: { id: `${TENANT}:${BRAND}:p84-salt`, saltVersion: 1 } }) } }));
    expect.soft(known.map(r => r.error ?? r.arm), 'P84.CO3 — a known browser\'s class is armFor of its identifier and the published salt, never a fresh draw').toEqual(engine);
  });
});

// ===========================================================================
// unit:P84.CO4 — the kit states the document, its addresses, the head script and its hash, the image list
// ===========================================================================

describe('unit:P84.CO4', () => {
  it('logic: kit 02 states the two addresses, their caching, the document\'s members, the head script and how its content-security-policy hash is computed from the committed bytes (no literal hash), the arm member and its answer and counter; kit 01 states the head script inlined before the stylesheets with its two inert inputs (the table, the image list in server order), the consent attribute, the custom properties and the preload; kit 03 states shotOrders', () => {
    const kit01 = readTree('docs/kit/01-integration-guide.md'), kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const has = (text: string, patterns: RegExp[]) => patterns.map(p => [p.source, p.test(text)]);
    const all = (patterns: RegExp[]) => patterns.map(p => [p.source, true]);
    const k02 = [/\/v1\/\{tenant\}\/context-table\/\{page\}(?!\/)/, /\/v1\/\{tenant\}\/context-table\/\{page\}\/\{version\}/, /public, max-age=60/, /public, max-age=31536000, immutable/,
      /`classifierVersion`/, /`carouselSlot`/, /`shotOrder`/, /`brandRules`/, /`saltVersion`/, /edge-head\.js\.csp/, /build-sdk\.mjs --check/, /SHA-256/, /base64/,
      /`arm`[^.]*first decision request/, /`armRequest`/, /`arm_draw`/];
    const k01 = [/edge-head\.js/, /op-context-table/, /op-images/, /data-op-consent/, /--op-pdp-carousel-|--op-\{slot\}-/, /rel="preload" as="image"|preload/];
    const k03 = [/`shotOrders`/, /shotOrders[^.]*layout slot/, /vocabulary in effect[^.]*`contentType`|`contentType`[^.]*vocabulary in effect/];
    expect.soft({ kit02: has(kit02, k02), kit01: has(kit01, k01), kit03: has(kit03, k03) }, 'P84.CO4 — the kit states P84 (today it states none of it)')
      .toEqual({ kit02: all(k02), kit01: all(k01), kit03: all(k03) });
    const literal = /sha256-[A-Za-z0-9+/]{43}=/;
    expect.soft([literal.test(kit01), literal.test(kit02)], 'P84.CO4 — the kit states the computation, never a literal hash (R-P359)').toEqual([false, false]);
  });
});
