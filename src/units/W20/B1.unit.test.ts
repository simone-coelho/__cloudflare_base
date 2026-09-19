// src/units/W20/B1.unit.test.ts
// W20 batch B1 — merchandising governance: pin reservation across the page,
// document-local contradictions refused at write time, catalogue references
// advisory at activation and safe at runtime, the defined precedence, `take`
// and duplicate prevention, exclusions and off-limits, the default handoff
// without forbidden fill, both arms, and the operator workflow on the shipped
// console.
//
// One `describe('unit:W20.<id>')` per unit of batch W20-B1, one `it` per ruled
// leg. Every expected value comes from a witness, never from what the engine
// returns today:
//   · document 35 §5 row W20 · G2 (:415): "Reserve pins, reject document-local
//     contradictions and check catalog references at activation/runtime. Define
//     slotTypes/take/eligibility/priority, duplicate prevention, dead-pin
//     diagnostics, exclusions/off-limits and default fallback without arbitrary
//     forbidden fill. Test both arms and actual operator workflows."
//   · document 35 §2 F28 (:209-:211) and its verification report
//     `docs/architecture/35-verification-reports/F28.md`: §4.4 ("`validate` is
//     document-pure and the catalog is a separate versioned document … the next
//     catalog revision can invalidate a pin that validated cleanly. Intra-document
//     contradictions (two slots, one pin) are checkable at write time; referential
//     ones must be handled at decision time regardless"), §5.3 ("A pinned slot
//     ignores `take`"), §5.4 ("A dead pin silently deletes the slot … with no
//     decision, no candidates entry, no receipt note and no monitor signal"),
//     §7.1 ("A receipt note and a monitor signal when a pin does not resolve, and
//     when a pinned slot cannot fill `take` (today both are silent)"), §7.2
//     (write-time rejection of intra-document contradictions "plus a *warning*
//     pass that reads the catalog revision in force … advisory, because the
//     catalog moves independently"), §7.3 (the documented precedence), §7.4
//     (declarative exclusions / off-limits / per-slot fallback).
//   · docs/architecture/26-btie-requirements-gap-review.md:152 and :194 — the
//     customer is told, against requirement D11, that "Within one page a piece is
//     used once" is already in the design.
//   · docs/architecture/18-content-affinity-engine.md:92 — "Cross-slot invariants
//     at assembly: dedupe (no content twice per page), non-personalizable slots
//     excluded per tenant config, absent decision → customer default."
//   · THE PUBLISHED CUSTOMER CONTRACT, docs/kit/03-payload-schemas.md "Hard slot
//     controls" (:171-:228), which is the authority for what a pin may override
//     (ruling R80(a)):
//       :186-:187 "`offLimits` is an optional boolean; true hands the slot to the
//         site's own default on every arm, without candidates, decisions or
//         records. A dormant pin and all other settings are retained."
//       :191-:193 "Exclusions apply before pins and every ranking hook; diversity
//         never relaxes them. An excluded active pin is contradictory. Off-limits
//         or excluded pins reserve nothing for other slots, and a refused pin
//         receives no arbitrary fill. No fallback asset or customer slot list is
//         inferred."
//       :195-:199 `excludedTags` matching "is exact and case-sensitive"; "Only
//         absent own `contentType` uses the existing safe rendering-kind fallback,
//         identically on all arms."
//       :200-:203 "`allowedTypes` … compared to rendering `piece.type`, never
//         `tags.contentType` … These gates precede pins and all ranking hooks;
//         diversity cannot relax them. Catalog-dependent tag/type pin conflicts
//         remain advisory at publication and are refused at runtime without
//         reservation or fill."
//       :213-:219 "`pinnedPieceIds` is a dense array of at most 50 distinct exact
//         nonempty strings … Supplying both pin fields refuses even with []. An
//         active prefix must fit total take; scalar pins still require take 1.
//         Off-limits permits dormant take/exclusion/page-ownership contradictions
//         but not malformed or duplicate prefix members. Every prefix pin must
//         pass eligibility, hard gates and page ownership before any is reserved.
//         One failure refuses the entire slot, without shifted positions or ranked
//         fill. Valid pins occupy the first positions, seed the tail's soft
//         diversity counts and cannot be displaced; ranking fills the remainder."
//   · docs/handover/HANDOFF-2026-09-16.md §6 row W20 (:219): "Missing/ineligible
//     catalog pins can be published and then safely omitted at runtime;
//     publication diagnostics are advisory after write."
//   · docs/PS-Implementation-Delivery-Guide.md:101 ("per-slot pinned overrides …,
//     priority rules, exclusions, off-limits slots") and :167 (per-slot fallbacks).
//   · docs/architecture/tapestry_requirements.txt A.3.6 — the taxonomy of every
//     fixture below is the customer's own (Tabby, Rogue, evening, work, Handbags,
//     Small Leather Goods), held here in the fixture and never in product code
//     (METHOD §6).
//   · rulings R19 (a host leg drives the mounted routes production serves),
//     R21 (a ruled-but-absent member is named), R68(a) (an operator workflow is
//     the SHIPPED console under jsdom bound to the mounted app), R80(a)-(g).
//
// ONE REPRESENTATION, SHARED BY EVERY UNIT BELOW, so no two units demand
// opposite things of the same fixture:
//   (i)   WHAT A PIN MAY OVERRIDE (R80(a)). Kit 03 :217 rules that "Every prefix
//         pin must pass eligibility, hard gates and page ownership before any is
//         reserved", and :191/:202 that exclusions and the tag/type gates apply
//         BEFORE pins. So a pin overrides NOTHING: not lifecycle, window or
//         stock, not the slot's own `slotTypes`, not off-limits, not an
//         exclusion, and not another slot's earlier claim on the same piece. The
//         published contract wins over the older sentence in F28 §7.3 ("a pin
//         overrides slot eligibility"), which the merged code also contradicts;
//         every unit below reads the contract.
//   (ii)  WHERE A CHECK LIVES (R80(b), F28 §4.4). A write-time refusal is only
//         ever for a DOCUMENT-LOCAL contradiction — one the slot document alone
//         decides. A reference into the catalogue (a pin that names no piece, a
//         piece outside `slotTypes`, lifecycle, window or stock, a piece a
//         tag/type gate forbids) is ADVISORY at activation, on the same
//         `slot-pin-diagnostics/v1` channel the write, the read and the dry run
//         all answer, and is SAFE at runtime: the pin is refused there, with no
//         reservation and no fill. The catalogue moves independently, so no
//         catalogue reference is ever refused at write time.
//   (iii) A REFUSED SLOT IS A DEFAULT HANDOFF, NEVER A HOLE FILLED WITH SOMETHING
//         ELSE. Off-limits, a refused pin prefix and an exhausted candidate set
//         all produce the same observable: that slot appears in NO served
//         position of the page, so the site's own default stands (kit 03 :186,
//         doc 18:92), while every other slot of the page is served normally. No
//         unit below asserts an empty array as its outcome: each asserts the
//         EXACT list of served positions for the whole page.
//   (iv)  UNIQUENESS IS PAGE-WIDE AND ORDER-FREE. A piece pinned anywhere on the
//         page is reserved before any ranking, so it can appear in exactly one
//         served position of that page whatever the slot order (doc 26:152/:194).
//   (v)   THE ARMS DIFFER ONLY IN THE RANKED REMAINDER. Pins, reservation,
//         exclusions, off-limits, eligibility and `take` are merchandising
//         authority, not personalization, and hold identically on the default
//         (control/holdout) arm and the personalized arm (doc 22 §10).
//
// RULED MISSING MEMBER (R21), asserted here by the name this specification rules
// and RED until it exists. No new export is ruled:
//   1. The answer of the mounted decision route — `GET /v1/:tenant/decisions/
//      snapshot` (`src/routes/decisions.ts:491-494`) — carries `pinDiagnostics`,
//      the same array the decision set already holds
//      (`ContentDecisionSet.pinDiagnostics`, `src/content/types.ts:428`, produced
//      by `composeContentDetailed` and returned through `serveContentDecisions`
//      at `src/content/service.ts:476-477`). Today the route builds its payload
//      from named fields and drops it, so outside the worker process a dead pin
//      is silent: F28 §5.4 ("no decision, no candidates entry, no receipt note
//      and no monitor signal") and §7.1 ("a receipt note and a monitor signal …
//      today both are silent"). Nothing else in the engine raises an
//      operator-visible runtime signal for a refused pin: a refused slot writes
//      no decision record, so `GET /v1/:tenant/visitors/:id/receipts` and the
//      recent ring have nothing to carry it on, and `src/ops/monitor.ts` counts
//      only its own fixed check list (`CHECKS`, :195). Unit W20.G1.04's host leg
//      is RED on this member alone (see its row in units.json).

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import * as jose from 'jose';

import { CONTENT_KIND, DEFAULT_SLOTS, LEARN_KIND, SLOTS_KIND, validateSlotCatalog } from '@/content/kinds';
import { decideContent, type DecideInput } from '@/content/decide';
import { isEligibleAt } from '@/content/lifecycle';
import type { ContentDecisionSet, ContentPiece, SlotCatalog, SlotStrategy } from '@/content/types';
import type { PinDiagnostic } from '@/reflex/contentCompose';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { configRoutes } from '@/routes/config';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent } from '@/content/consent';
import { configuredDestinations } from '@/connectors/config';
import type { Env } from '@/types/env';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

// ===========================================================================
// The customer's fixture. Coach's own dimensions and values
// (tapestry_requirements A.3.6), a catalogue and a slot document that are
// nothing like the compiled defaults, and a published registry that is not the
// bundled one. Everything customer-shaped lives here, never in product code.
// ===========================================================================

const TENANT = 'coach';
const T0 = Date.parse('2026-09-19T12:00:00.000Z');
const DAY_MS = 86_400_000;

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id,
  customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`,
  type: 'editorial',
  title: id,
  tags: {},
  slotTypes: [],
  lifecycle: { status: 'live' },
  ...over,
});

/**
 * The catalogue IN THE MERCHANDISER'S OWN ORDER. Catalogue order is what the
 * engine falls back to when nothing scores (`src/reflex/contentCompose.ts:149`),
 * so no expected order below is ever the catalogue's own where personalization
 * is the point. `cnt-charms-lookbook` deliberately carries NO `contentType` tag,
 * which is the one case kit 03 :199 lets the rendering kind stand in for.
 */
const W20_PIECES: ContentPiece[] = [
  piece('cnt-rogue-work-edit', { title: 'The Rogue, at work', type: 'editorial',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story', 'rail'] }),
  piece('cnt-tabby-evening-film', { title: 'The Tabby, after dark', type: 'film',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['video'] },
    slotTypes: ['feature', 'story', 'promo'],
    window: { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' } }),
  piece('cnt-tabby-evening-edit', { title: 'Evening, restated', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Small Leather Goods'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story', 'rail'] }),
  piece('cnt-charms-lookbook', { title: 'Charms, a lookbook', type: 'lookbook',
    tags: { occasion: ['evening'], category: ['Small Leather Goods'] },
    slotTypes: ['feature', 'rail'] }),
  piece('cnt-rogue-evening-edit', { title: 'The Rogue, after six', type: 'editorial',
    tags: { line: ['Rogue'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story', 'rail', 'promo'] }),
  piece('cnt-rail-tabby-01', { title: 'Tabby, frame one', type: 'editorial',
    tags: { line: ['Tabby'], category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['rail'] }),
  piece('cnt-rail-tabby-02', { title: 'Tabby, frame two', type: 'editorial',
    tags: { line: ['Tabby'], category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['rail'] }),
  piece('cnt-rail-tabby-03', { title: 'Tabby, frame three', type: 'editorial',
    tags: { line: ['Tabby'], category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['rail'] }),
  piece('cnt-rail-rogue-01', { title: 'Rogue, frame one', type: 'editorial',
    tags: { line: ['Rogue'], category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['rail'] }),
  // The three kinds of ineligibility, all of them pinnable by an operator and
  // all of them unservable: a draft, a closed window, and a stock flag.
  piece('cnt-draft-campaign', { title: 'Holiday, not yet live', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story'], lifecycle: { status: 'draft' } }),
  piece('cnt-expired-campaign', { title: 'Spring, closed', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story'],
    window: { from: '2026-01-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z' } }),
  piece('cnt-out-of-stock-campaign', { title: 'The Tabby 26, sold out', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story'], inStock: false }),
  // Eligible for no slot this page holds, so a pin naming it is a slot-type
  // reference failure and never a served position.
  piece('cnt-merch-only-banner', { title: 'The merch band', type: 'editorial',
    tags: { category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['merch'] }),
  piece('cnt-legal-notice', { title: 'Terms of this promotion', type: 'editorial',
    tags: { category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['legal'] }),
];

const W20_CATALOGUE = { version: 'w20-b1-coach-catalogue', pieces: W20_PIECES };

/** The piece a repaired catalogue adds in W20.G1.03, absent from the fixture above. */
const REPAIRED_PIECE = piece('cnt-holiday-campaign', { title: 'Holiday, arriving', type: 'editorial',
  tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
  slotTypes: ['feature', 'story'] });

/**
 * This tenant's PUBLISHED registry, not the bundled default: it adds the
 * `styleWorld` dimension the PS guide §7.1 maps `style_cluster` onto and drops
 * `silhouette`, which `DEFAULT_REFLEX_CONFIG` carries.
 */
const TENANT_REGISTRY = {
  ...DEFAULT_REFLEX_CONFIG,
  version: 'w20-b1-coach-registry',
  dimensions: [
    ...DEFAULT_REFLEX_CONFIG.dimensions.filter(dimension => dimension.key !== 'silhouette'),
    { key: 'styleWorld', source: 'styleWorld' },
  ],
};

/**
 * The shopper of every personalized leg: three real Coach product views inside
 * one visit, so her affinity holds `line: Tabby`, `occasion: evening` and
 * `category: Handbags`, each strictly above zero, and nothing on `Rogue` or
 * `work`. Every expected order below follows from THAT, never from a number
 * read off the engine.
 */
const SHOPPER_VIEWS = Array.from({ length: 3 }, (_, i) => ({
  type: 'product_view',
  data: { productId: `COA-CW62${i}`, line: 'Tabby', category: 'Handbags', occasion: ['evening'], price_usd: 575 },
}));

/**
 * The same taste, supplied directly, for the `logic` legs: a[line][Tabby] = 0.9,
 * a[line][Rogue] = 0.3, a[occasion][evening] = 0.7, a[occasion][work] = 0.2,
 * a[category][Handbags] = 0.5, a[category][Small Leather Goods] = 0.1. Every
 * expected score below is Σ a[dim][value] × the slot's weight for that dimension
 * (doc 18:67), computed here and never read back from the engine.
 */
const TASTE = {
  dims: {
    line: { Tabby: 0.9, Rogue: 0.3 },
    occasion: { evening: 0.7, work: 0.2 },
    category: { Handbags: 0.5, 'Small Leather Goods': 0.1 },
  },
};

/** The dimension weights every `feature`/`story` slot below carries. */
const FEATURE_WEIGHTS = { line: 1, occasion: 0.5, category: 0.2 };
/** The rail ranks on the line alone, so its diversity rule has teeth. */
const RAIL_WEIGHTS = { line: 1 };

// ---------------------------------------------------------------------------
// A slot document is only a witness if a merchandiser could actually author it:
// every fixture below goes through the real publication validator first.
// ---------------------------------------------------------------------------

function authorable(pages: Record<string, unknown[]>): SlotCatalog {
  const candidate = { version: 'w20-b1-coach-slots', governanceVersion: 3, pages };
  const checked = validateSlotCatalog(candidate);
  expect(checked.ok ? '' : (checked as { ok: false; errors: string[] }).errors.join('; '),
    `the fixture slot document must be one a merchandiser could author: ${JSON.stringify(pages)}`).toBe('');
  return (checked as { ok: true; value: SlotCatalog }).value;
}

/**
 * A document the CURRENT write validator refuses and a stored revision may
 * nevertheless carry. `validateStored` is `parseSlotCatalog` without the
 * cross-slot pass (`src/content/kinds.ts:389-408`, :430), which is exactly the
 * retained-revision case: a contradiction the write path now refuses
 * (unit W20.G1.02) can still stand in a revision published before it did, and
 * the runtime rule is what protects the page then. The two units agree on one
 * representation, one layer each: refused at write, safe at runtime.
 */
function retained(pages: Record<string, unknown[]>): SlotCatalog {
  const candidate = { version: 'w20-b1-retained-slots', governanceVersion: 3, pages };
  expect(validateSlotCatalog(candidate).ok,
    `this fixture exists to prove the runtime rule, so the write path must refuse it: ${JSON.stringify(pages)}`).toBe(false);
  const checked = SLOTS_KIND.validateStored!(candidate);
  expect(checked.ok ? '' : (checked as { ok: false; errors: string[] }).errors.join('; '),
    `a retained revision must still parse: ${JSON.stringify(pages)}`).toBe('');
  return (checked as { ok: true; value: SlotCatalog }).value;
}

const homeSlots = (document: SlotCatalog): SlotStrategy[] => document.pages.home!;

// ===========================================================================
// The mounted application, in process, the way `src/index.ts` mounts it, on
// either shopper host. Pattern reused from `src/units/W18/B1.unit.test.ts` and
// `src/units/W19/B1.unit.test.ts`; neither suite is imported or edited.
// ===========================================================================

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
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
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
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w20-b1-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

const OPERATOR_SECRET = 'w20-b1-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';

interface Mounted {
  env: Env;
  objects: Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>;
  drain: () => Promise<void>;
  fetch: (input: Request) => Promise<Response>;
  operatorToken: string;
  configureRetention: () => Promise<void>;
}

async function mount(host: 'session' | 'do' = 'session'): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w20-b1-proof`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => undefined },
  } as unknown as Env;
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* the fixture reports no destination diagnostics */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
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
                else for (const [key, item2] of Object.entries(values)) candidate.set(key, structuredClone(item2));
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
        item = { data, shopper: new ShopperReflex(state, env) };
        objects.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  };
  env.SHOPPER_REFLEX = ns as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const fetchOne = async (request: Request): Promise<Response> => {
    await configureRetention();
    return app.fetch(request, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, objects, drain, fetch: fetchOne, operatorToken, configureRetention };
}

/** The four documents a provisioned tenant holds, published as this tenant's own. */
async function publishFixture(m: Mounted, slots: SlotCatalog, holdoutShare = 0, catalog: { pieces: ContentPiece[] } = W20_CATALOGUE): Promise<void> {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w20-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(m.env, [
    baseline(CONTENT_KIND, catalog),
    baseline(SLOTS_KIND, slots),
    baseline(LEARN_KIND, { holdout: { share: holdoutShare, salt: 'w20-b1', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} }),
    baseline(REFLEX_KIND, TENANT_REGISTRY, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
}

/** The published fixture is not the compiled default in any of its three documents. */
function assertFixtureIsNotTheCompiledDefault(slots: SlotCatalog): void {
  expect(JSON.stringify(slots.pages), 'the published slot document must not be the compiled default (METHOD §6)')
    .not.toBe(JSON.stringify(DEFAULT_SLOTS.pages));
  expect(TENANT_REGISTRY.dimensions.map(d => d.key).includes('styleWorld'),
    'the published registry is the tenant’s own, not the bundled default').toBe(true);
  expect(W20_CATALOGUE.pieces.length, 'the published catalogue is this customer’s own').toBe(14);
}

async function operatorGet(m: Mounted, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT },
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/** The console's own write, byte for byte, as `public/console/shell.js` composes it. */
async function operatorWrite(m: Mounted, path: string, method: 'PUT' | 'POST', body: unknown,
  base: { revision: number; publication: { revision: number; digest: string } }): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method,
    headers: {
      Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json',
      'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`,
      'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}`,
    },
    body: JSON.stringify(body ?? {}),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/** One warning of the advisory pin channel the slot answers already carry. */
interface PinWarning { pageIndex: number; slotIndex: number; pinIndex?: number; reason: string }
interface PinReport {
  schema?: string; advisory?: boolean; status?: string; slotsRevision?: number | null;
  catalog?: { source?: string; revision?: number | null };
  checkedAt?: string | null; warningCount?: number | null; omittedWarningCount?: number | null; warnings?: PinWarning[] | null;
}
interface LoadedSlots { revision: number; publication: { revision: number; digest: string }; document: SlotCatalog; pinDiagnostics?: PinReport }

async function loadSlots(m: Mounted): Promise<LoadedSlots> {
  const read = await operatorGet(m, `/content/slots?scope=${TENANT}`);
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  return { revision: read.body.revision as number, publication: read.body.publication as LoadedSlots['publication'],
    document: read.body.document as SlotCatalog, pinDiagnostics: read.body.pinDiagnostics as PinReport | undefined };
}

// ---------------------------------------------------------------------------
// A shopper on the mounted application: her own consent, her own events, the
// snapshot the route production serves.
// ---------------------------------------------------------------------------

interface Snapshot {
  status: number;
  arm: string;
  /** `slot:contentId`, in served order, for the whole page. */
  served: string[];
  strategies: Record<string, string>;
  /** RULED, ABSENT TODAY (R21): the refused pins the decision set already names. */
  pinDiagnostics?: PinDiagnostic[];
}

interface Shopper {
  action: (event: { type: string; data: Record<string, unknown> }) => Promise<number>;
  snapshot: () => Promise<Snapshot>;
}

async function shopperOn(m: Mounted): Promise<Shopper> {
  const grant = await newAnonymousSession(m.env, TENANT);
  const call = async (path: string, body?: unknown) => {
    await m.configureRetention();
    return m.fetch(new Request(`https://synthetic.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  };
  const current = m.objects.get(shopperObjectName(TENANT, grant.subject))?.data.get('consent');
  const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const preferences = await call(`/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true, choice });
  expect(preferences.status, await preferences.clone().text()).toBe(200);
  await m.drain();

  const action = async (event: { type: string; data: Record<string, unknown> }) => {
    const response = await call('/realtime/action', { ...event, source: 'sdk', userId: grant.subject, sessionId: grant.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() });
    await m.drain();
    return response.status;
  };
  const snapshot = async (): Promise<Snapshot> => {
    invalidatePublicationCache();
    const response = await call(`/v1/${TENANT}/decisions/snapshot?page=home`);
    const body = await response.clone().json().catch(() => ({})) as {
      arm?: string; decisions?: Array<{ slot?: string; contentId?: string; strategy?: string }>; pinDiagnostics?: PinDiagnostic[];
    };
    await m.drain();
    const served: string[] = [], strategies: Record<string, string> = {};
    for (const decision of body.decisions ?? []) {
      served.push(`${decision.slot ?? '?'}:${decision.contentId ?? '?'}`);
      strategies[`${decision.slot ?? '?'}:${decision.contentId ?? '?'}`] = decision.strategy ?? '?';
    }
    return { status: response.status, arm: body.arm ?? '?', served, strategies, pinDiagnostics: body.pinDiagnostics };
  };
  return { action, snapshot };
}

/** Her taste: three real product views inside one visit, through the mounted app. */
async function buildTaste(shopper: Shopper, clock: { set: (ms: number) => void }, from = T0): Promise<void> {
  for (const [index, event] of SHOPPER_VIEWS.entries()) {
    clock.set(from + index * 60_000);
    expect(await shopper.action(event), `the shopper's view ${index + 1} must be accepted`).toBe(200);
  }
  clock.set(from + 5 * 60_000);
}

const HOSTS = ['session', 'do'] as const;

// ===========================================================================
// The `logic` legs: the real decision, with the affinity supplied, so every
// expected value is computed from the documented formula.
// ===========================================================================

const decisionFor = (slots: SlotStrategy[], over: Partial<DecideInput> = {}): DecideInput => ({
  tenant: TENANT, brand: TENANT, page: 'home', visitorId: 'vis-w20-b1', sessionId: 'ses-w20-b1',
  identityAnchor: 'visitor', nowMs: T0, pieces: W20_PIECES, slots,
  affinity: TASTE, arm: 'personalized',
  cell: { channel: 'email', visit_bucket: '2-3', stage: 'mid', region: null, affinity: null },
  versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 },
  configLabel: 'w20-b1',
  ...over,
});

/** `slot:contentId` for every served position of the page, in served order. */
const servedOf = (set: ContentDecisionSet): string[] => set.decisions.map(d => `${d.slot}:${d.contentId}`);

// ===========================================================================
// unit:W20.G1.01 — a pinned piece is reserved across the whole page
// ===========================================================================

/** The F28 probe-A layout: the ranked hero FIRST, the pinned band SECOND. */
const RESERVATION_SLOTS = authorable({
  home: [
    { slot: 'feature', take: 2, weights: FEATURE_WEIGHTS },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-tabby-evening-film'] },
  ],
});
/** The same two slots the other way round: order may not change the outcome. */
const RESERVATION_SLOTS_REVERSED = authorable({
  home: [
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-tabby-evening-film'] },
    { slot: 'feature', take: 2, weights: FEATURE_WEIGHTS },
  ],
});
/** The control: the same page with nothing pinned at all. */
const RESERVATION_CONTROL = authorable({
  home: [
    { slot: 'feature', take: 2, weights: FEATURE_WEIGHTS },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS },
  ],
});
/**
 * Two slots pinning one piece (F28 probe C). The write path refuses this
 * document today (unit W20.G1.02), so it can only reach the engine as a
 * RETAINED revision — which is precisely when the runtime rule has to hold:
 * the first slot in page order owns the piece and the other is refused whole,
 * rather than the page serving it twice.
 */
const RESERVATION_ONE_PIECE_TWICE = retained({
  home: [
    { slot: 'feature', take: 1, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-tabby-evening-film'] },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-tabby-evening-film'] },
  ],
});

describe('unit:W20.G1.01', () => {
  it('logic: a piece pinned in one slot is reserved across the page, whatever the slot order and however high it ranks elsewhere, and two slots that would rank it first serve it once', () => {
    // The control first, so the pinned piece is demonstrably the one the ranked
    // slot WOULD take: feature scores film 0.9+0.35+0.10 = 1.35 and
    // tabby-evening-edit 0.9+0.35+0.02 = 1.27, the two highest on the page; the
    // band below then takes the best of what is left, rogue-evening-edit at
    // 0.3+0.35+0.10 = 0.75, ahead of rogue-work-edit at 0.3+0.10+0.10 = 0.50.
    const control = decideContent(decisionFor(homeSlots(RESERVATION_CONTROL)));
    expect(servedOf(control),
      'W20.G1.01 — with nothing pinned, the ranked hero takes the campaign film first')
      .toEqual(['feature:cnt-tabby-evening-film', 'feature:cnt-tabby-evening-edit', 'story:cnt-rogue-evening-edit']);

    // The same page with the campaign pinned into the band BELOW it: the piece
    // is reserved before any ranking, so the hero ranks on without it
    // (doc 26:152 "Within one page a piece is used once").
    const reserved = decideContent(decisionFor(homeSlots(RESERVATION_SLOTS)));
    expect(servedOf(reserved),
      'W20.G1.01 — the pinned piece is reserved for its own slot, so the earlier ranked slot serves the next two pieces instead')
      .toEqual(['feature:cnt-tabby-evening-edit', 'feature:cnt-rogue-evening-edit', 'story:cnt-tabby-evening-film']);

    // Order is not the difference (F28 probe B): the pinned slot first gives the
    // same page-wide set of positions.
    const reversed = decideContent(decisionFor(homeSlots(RESERVATION_SLOTS_REVERSED)));
    expect(servedOf(reversed),
      'W20.G1.01 — reversing the slot order changes only where the positions are printed, never which piece each slot serves')
      .toEqual(['story:cnt-tabby-evening-film', 'feature:cnt-tabby-evening-edit', 'feature:cnt-rogue-evening-edit']);
    expect([...servedOf(reversed)].sort(), 'W20.G1.01 — the same page, whichever way round the slots are authored')
      .toEqual([...servedOf(reserved)].sort());

    // Two slots pinning one piece (F28 probe C): the first in page order owns it,
    // and the second is refused whole rather than duplicating it.
    const twice = decideContent(decisionFor(homeSlots(RESERVATION_ONE_PIECE_TWICE)));
    expect(servedOf(twice),
      'W20.G1.01 — one piece pinned by two slots is served once, by the slot that owns it in page order')
      .toEqual(['feature:cnt-tabby-evening-film']);
    expect(twice.pinDiagnostics,
      'W20.G1.01 — and the refused second pin is named with the slot that owns the piece')
      .toEqual([{ slot: 'story', pinnedPieceId: 'cnt-tabby-evening-film', pinIndex: 0, reason: 'duplicate_pin', ownerSlot: 'feature' }]);

    // Every served position of every page above is a distinct piece.
    for (const [name, set] of [['control', control], ['reserved', reserved], ['reversed', reversed], ['twice', twice]] as const) {
      const ids = set.decisions.map(d => d.contentId);
      expect([...new Set(ids)].length, `W20.G1.01 — ${name}: every served position of the page carries a different piece`).toBe(ids.length);
    }
  });

  it('host: on both hosts, a campaign pinned into a lower band is never also served by the hero that ranks it first, and the page carries it exactly once', async () => {
    for (const host of HOSTS) {
      const clockValue = { now: T0 };
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
      try {
        // The control publication: nothing pinned, so the hero demonstrably
        // takes the campaign film for a shopper with this taste.
        const control = await mount(host);
        assertFixtureIsNotTheCompiledDefault(RESERVATION_CONTROL);
        await publishFixture(control, RESERVATION_CONTROL);
        const cold = await shopperOn(control);
        await buildTaste(cold, { set: (ms: number) => { clockValue.now = ms; } });
        const before = await cold.snapshot();
        expect(before.status, `${host}: the mounted snapshot answers`).toBe(200);
        expect(before.served.slice(0, 2),
          `${host}: W20.G1.01 — for a Tabby/evening shopper the hero ranks the Tabby evening pieces first`)
          .toEqual(['feature:cnt-tabby-evening-film', 'feature:cnt-tabby-evening-edit']);

        // The merchandiser's own layout: the campaign pinned into the band below.
        clockValue.now = T0;
        const pinned = await mount(host);
        await publishFixture(pinned, RESERVATION_SLOTS);
        const shopper = await shopperOn(pinned);
        await buildTaste(shopper, { set: (ms: number) => { clockValue.now = ms; } });
        const after = await shopper.snapshot();
        expect(after.status, `${host}: the mounted snapshot answers`).toBe(200);
        expect(after.served,
          `${host}: W20.G1.01 — the pinned campaign is reserved page-wide, so the hero serves the next two pieces and the band serves the pin`)
          .toEqual(['feature:cnt-tabby-evening-edit', 'feature:cnt-rogue-evening-edit', 'story:cnt-tabby-evening-film']);
        expect(after.strategies['story:cnt-tabby-evening-film'],
          `${host}: W20.G1.01 — the served pin is the merchandiser's own authority, not a ranked choice`).toBe('tenant-pinned');
        expect([...new Set(after.served)].length,
          `${host}: W20.G1.01 — every served position of the page carries a different piece`).toBe(after.served.length);
      } finally { clock.mockRestore(); }
    }
  }, 60_000);
});

// ===========================================================================
// unit:W20.G1.02 — document-local contradictions are refused at write time
// ===========================================================================

/** The consistent document the refusals below are each one edit away from. */
const CONSISTENT_DOCUMENT = {
  version: 'w20-b1-coach-slots', governanceVersion: 3,
  pages: {
    home: [
      { slot: 'feature', take: 3, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-charms-lookbook'], excludedPieceIds: ['cnt-rogue-work-edit'] },
      { slot: 'story', take: 2, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-tabby-evening-film'] },
      { slot: 'legal', take: 1, weights: {}, offLimits: true, pinnedPieceIds: ['cnt-legal-notice'] },
    ],
  },
};

const edited = (edit: (pages: Record<string, Record<string, unknown>[]>) => void): Record<string, unknown> => {
  const next = JSON.parse(JSON.stringify(CONSISTENT_DOCUMENT)) as { pages: Record<string, Record<string, unknown>[]> };
  edit(next.pages);
  return next as unknown as Record<string, unknown>;
};

describe('unit:W20.G1.02', () => {
  it('host: every document-local contradiction is refused 422 by the dry run and by the write, naming the page and the slot, with no revision written, while a consistent document is accepted', async () => {
    const m = await mount();
    await publishFixture(m, authorable(CONSISTENT_DOCUMENT.pages as unknown as Record<string, unknown[]>));
    const base = await loadSlots(m);
    expect(base.revision, 'the fixture is published as revision 1').toBe(1);

    /**
     * Each contradiction the SLOT DOCUMENT ALONE decides (F28 §4.4: only
     * intra-document contradictions are checkable at write time), with the words
     * the refusal must carry. The wording of the validator is not the witness:
     * what the contract determines is that the write is refused and that the
     * refusal names the page and the slot the operator has to go and fix.
     */
    const contradictions: Array<{ name: string; document: Record<string, unknown>; names: string[] }> = [
      {
        // kit 03 :217 "page ownership"; F28 §5.1 "the cheap half to reject at write time".
        name: 'the same piece pinned by two slots of one page',
        document: edited(pages => { pages.home![1]!.pinnedPieceIds = ['cnt-charms-lookbook']; }),
        names: ['pages.home', 'feature', 'story'],
      },
      {
        // kit 03 :213 "at most 50 DISTINCT exact nonempty strings"; :216 "not … duplicate prefix members".
        name: 'a piece repeated inside one slot’s pin prefix',
        document: edited(pages => { pages.home![0]!.pinnedPieceIds = ['cnt-charms-lookbook', 'cnt-charms-lookbook']; }),
        names: ['pages.home', 'pinnedPieceIds'],
      },
      {
        // kit 03 :192 "An excluded active pin is contradictory."
        name: 'a pin the same slot also excludes by id',
        document: edited(pages => { pages.home![0]!.excludedPieceIds = ['cnt-charms-lookbook']; }),
        names: ['pages.home', 'feature'],
      },
      {
        // kit 03 :215 "An active prefix must fit total take".
        name: 'more pins than take',
        document: edited(pages => {
          pages.home![1]!.take = 1;
          pages.home![1]!.pinnedPieceIds = ['cnt-tabby-evening-film', 'cnt-tabby-evening-edit'];
        }),
        names: ['pages.home', 'story'],
      },
      {
        // kit 03 :215 "scalar pins still require take 1".
        name: 'a scalar pin on a slot that takes more than one',
        document: edited(pages => {
          delete pages.home![1]!.pinnedPieceIds;
          pages.home![1]!.pinnedPieceId = 'cnt-tabby-evening-film';
        }),
        names: ['pages.home', 'story'],
      },
      {
        // kit 03 :214 "Supplying both pin fields refuses even with []". This is
        // the one refusal the validator addresses by the slot's POSITION in the
        // page rather than by its name, so that is what the operator is given
        // and that is what this clause asserts: `pages.home[1]` is the second
        // slot of the home page, the one the edit above touched.
        name: 'both pin fields supplied at once',
        document: edited(pages => { pages.home![1]!.pinnedPieceId = 'cnt-tabby-evening-film'; }),
        names: ['pages.home[1]'],
      },
    ];

    for (const { name, document, names } of contradictions) {
      const dry = await operatorWrite(m, `/content/slots/validate?scope=${TENANT}`, 'POST', { document },
        { revision: base.revision, publication: base.publication });
      expect(dry.status, `${name}: the authenticated dry run must refuse it`).toBe(422);
      expect(dry.body.valid, `${name}: the dry run says the draft is not valid`).toBe(false);
      const dryErrors = (dry.body.errors as string[] | undefined) ?? [];
      for (const word of names) expect(dryErrors.join(' '), `${name}: the dry-run refusal names ${word}`).toContain(word);

      const written = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT', { document, note: name },
        { revision: base.revision, publication: base.publication });
      expect(written.status, `${name}: PUT /content/slots must refuse it`).toBe(422);
      const errors = (written.body.errors as string[] | undefined) ?? [];
      for (const word of names) expect(errors.join(' '), `${name}: the write refusal names ${word}`).toContain(word);

      const after = await loadSlots(m);
      expect(after.revision, `${name}: a refused write creates no revision`).toBe(base.revision);
      expect(after.document, `${name}: a refused write leaves the stored document byte for byte as it was`).toEqual(base.document);
    }

    // A document holding two contradictions at once is answered with BOTH, so an
    // operator fixes the document in one pass ("Each validator returns EVERY error").
    const twoAtOnce = edited(pages => {
      pages.home![1]!.pinnedPieceIds = ['cnt-charms-lookbook'];
      pages.home![0]!.excludedPieceIds = ['cnt-charms-lookbook'];
    });
    const both = await operatorWrite(m, `/content/slots/validate?scope=${TENANT}`, 'POST', { document: twoAtOnce },
      { revision: base.revision, publication: base.publication });
    expect(both.status, 'a document with two contradictions is refused').toBe(422);
    const bothErrors = (both.body.errors as string[] | undefined) ?? [];
    expect(bothErrors.length, 'W20.G1.02 — every contradiction in the document is named, not only the first').toBe(2);
    expect(bothErrors.join(' '), 'W20.G1.02 — the refusal names the excluded pin').toContain('feature');
    expect(bothErrors.join(' '), 'W20.G1.02 — and the duplicated page ownership').toContain('story');

    // Off-limits is the documented exception: kit 03 :216 "Off-limits permits
    // dormant take/exclusion/page-ownership contradictions but not malformed or
    // duplicate prefix members."
    const dormant = edited(pages => {
      pages.home![2]!.excludedPieceIds = ['cnt-legal-notice'];
      pages.home![2]!.pinnedPieceIds = ['cnt-legal-notice', 'cnt-merch-only-banner'];
    });
    const dormantDry = await operatorWrite(m, `/content/slots/validate?scope=${TENANT}`, 'POST', { document: dormant },
      { revision: base.revision, publication: base.publication });
    expect(dormantDry.status, 'W20.G1.02 — an off-limits slot may hold a dormant take/exclusion contradiction').toBe(200);
    expect(dormantDry.body.valid, 'W20.G1.02 — and the dry run says so').toBe(true);
    const dormantMalformed = edited(pages => { pages.home![2]!.pinnedPieceIds = ['cnt-legal-notice', 'cnt-legal-notice']; });
    const dormantRefused = await operatorWrite(m, `/content/slots/validate?scope=${TENANT}`, 'POST', { document: dormantMalformed },
      { revision: base.revision, publication: base.publication });
    expect(dormantRefused.status, 'W20.G1.02 — but never a duplicate prefix member, even while off-limits').toBe(422);

    // And the consistent document itself is accepted and written.
    const accepted = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT',
      { document: CONSISTENT_DOCUMENT, note: 'the consistent document' },
      { revision: base.revision, publication: base.publication });
    expect(accepted.status, `the consistent document must be accepted: ${JSON.stringify(accepted.body.errors ?? accepted.body)}`).toBe(200);
    const stored = await loadSlots(m);
    expect(stored.revision, 'W20.G1.02 — the accepted document is written as the next revision').toBe(base.revision + 1);
    expect(stored.document.pages.home!.map(slot => [slot.slot, slot.pinnedPieceIds ?? null, slot.excludedPieceIds ?? null, slot.offLimits ?? false]),
      'W20.G1.02 — and the stored document carries exactly the governance the operator authored')
      .toEqual([
        ['feature', ['cnt-charms-lookbook'], ['cnt-rogue-work-edit'], false],
        ['story', ['cnt-tabby-evening-film'], null, false],
        ['legal', ['cnt-legal-notice'], null, true],
      ]);
  }, 60_000);
});

// ===========================================================================
// unit:W20.G1.03 — catalogue references are advisory at activation, and complete
// ===========================================================================

/**
 * Every kind of catalogue reference failure a pin can have, on one page. None of
 * them is a document-local contradiction, so none of them may refuse the save
 * (F28 §4.4, kit 03 :202-:203).
 */
const ACTIVATION_SLOTS = {
  version: 'w20-b1-coach-slots', governanceVersion: 3,
  pages: {
    home: [
      // index 0: a pin that names no piece; a piece this slot's type excludes; a draft piece.
      { slot: 'feature', take: 3, weights: FEATURE_WEIGHTS,
        pinnedPieceIds: ['cnt-holiday-campaign', 'cnt-merch-only-banner', 'cnt-draft-campaign'] },
      // index 1: a closed window and a stock flag.
      { slot: 'story', take: 2, weights: FEATURE_WEIGHTS,
        pinnedPieceIds: ['cnt-expired-campaign', 'cnt-out-of-stock-campaign'] },
      // index 2: a piece the slot excludes by an exact tag value.
      { slot: 'rail', take: 2, weights: RAIL_WEIGHTS,
        excludedTags: [{ dimension: 'occasion', value: 'evening' }],
        pinnedPieceIds: ['cnt-tabby-evening-edit'] },
      // index 3: a piece whose rendering type the slot does not allow.
      { slot: 'promo', take: 1, weights: FEATURE_WEIGHTS, allowedTypes: ['editorial'],
        pinnedPieceIds: ['cnt-tabby-evening-film'] },
      // index 4: a pin dormant under off-limits.
      { slot: 'legal', take: 1, weights: {}, offLimits: true, pinnedPieceIds: ['cnt-legal-notice'] },
    ],
  },
};

/** The eight warnings kit 03 and F28 §7.2 rule for the document above, in document order. */
const ACTIVATION_WARNINGS: PinWarning[] = [
  { pageIndex: 0, slotIndex: 0, pinIndex: 0, reason: 'missing_piece' },
  { pageIndex: 0, slotIndex: 0, pinIndex: 1, reason: 'slot_type' },
  { pageIndex: 0, slotIndex: 0, pinIndex: 2, reason: 'currently_ineligible' },
  { pageIndex: 0, slotIndex: 1, pinIndex: 0, reason: 'currently_ineligible' },
  { pageIndex: 0, slotIndex: 1, pinIndex: 1, reason: 'currently_ineligible' },
  { pageIndex: 0, slotIndex: 2, pinIndex: 0, reason: 'excluded_tag' },
  { pageIndex: 0, slotIndex: 3, pinIndex: 0, reason: 'type_not_allowed' },
  { pageIndex: 0, slotIndex: 4, pinIndex: 0, reason: 'off_limits' },
];

describe('unit:W20.G1.03', () => {
  it('host: the write, read and dry-run answers of the slot document carry the advisory pin report naming every catalogue reference that does not resolve, against the catalogue revision in force, without refusing the save, and a later import that repairs a reference clears its warning', async () => {
    const m = await mount();
    await publishFixture(m, authorable(CONSISTENT_DOCUMENT.pages as unknown as Record<string, unknown[]>));
    const base = await loadSlots(m);

    // 1. The dry run: advisory, never a refusal.
    const dry = await operatorWrite(m, `/content/slots/validate?scope=${TENANT}`, 'POST', { document: ACTIVATION_SLOTS },
      { revision: base.revision, publication: base.publication });
    expect(dry.status, `W20.G1.03 — a catalogue reference may never refuse a slot write: ${JSON.stringify(dry.body.errors ?? '')}`).toBe(200);
    expect(dry.body.valid, 'W20.G1.03 — the document is valid; the references are advisory').toBe(true);
    const dryReport = dry.body.pinDiagnostics as PinReport;
    expect(dryReport.schema, 'W20.G1.03 — the dry run answers on the advisory pin channel').toBe('slot-pin-diagnostics/v1');
    expect(dryReport.advisory, 'W20.G1.03 — and says it is advisory').toBe(true);
    expect(dryReport.warnings, 'W20.G1.03 — the dry run names every unresolved reference of the draft').toEqual(ACTIVATION_WARNINGS);

    // 2. The write: accepted, with the same complete report and the catalogue
    //    revision it was checked against (F28 §7.2 "reads the catalog revision in force").
    const written = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT', { document: ACTIVATION_SLOTS, note: 'campaign pins' },
      { revision: base.revision, publication: base.publication });
    expect(written.status, `W20.G1.03 — the save is never refused for a catalogue reference: ${JSON.stringify(written.body.errors ?? '')}`).toBe(200);
    const writeReport = written.body.pinDiagnostics as PinReport;
    expect(writeReport.status, 'W20.G1.03 — the write answer carries a checked-catalogue result').toBe('available');
    expect(writeReport.catalog, 'W20.G1.03 — the report names the stored catalogue revision it checked').toEqual({ source: 'stored', revision: 1 });
    expect(writeReport.warnings, 'W20.G1.03 — and names every unresolved reference of the saved document').toEqual(ACTIVATION_WARNINGS);
    expect(writeReport.warningCount, 'W20.G1.03 — the count is the whole truth, not the truncated list').toBe(ACTIVATION_WARNINGS.length);
    expect(writeReport.omittedWarningCount, 'W20.G1.03 — and says how many it did not show').toBe(0);
    expect(typeof writeReport.checkedAt === 'string' && Number.isFinite(Date.parse(writeReport.checkedAt!)),
      'W20.G1.03 — the report says when it checked').toBe(true);

    // 3. The read of the saved document answers the same report, against the
    //    same catalogue revision, at the slots revision now in force.
    const read = await loadSlots(m);
    expect(read.revision, 'the advisory save created the next revision').toBe(base.revision + 1);
    expect(read.pinDiagnostics!.warnings, 'W20.G1.03 — a read of the stored document answers the same report').toEqual(ACTIVATION_WARNINGS);
    expect(read.pinDiagnostics!.slotsRevision, 'W20.G1.03 — named at the slots revision it read').toBe(read.revision);
    expect(read.pinDiagnostics!.catalog, 'W20.G1.03 — against the catalogue revision in force').toEqual({ source: 'stored', revision: 1 });

    // 4. The catalogue moves independently (F28 §4.4): an import that publishes
    //    the missing piece clears exactly that warning on the next read, with no
    //    slot write at all, and the report names the new catalogue revision.
    const head = JSON.parse((m.env.STORAGE as unknown as UnitR2).objects.get(`config-publication/v2/${TENANT}/head.json`)!) as { committed: { revision: number; digest: string } };
    const catalogRead = await operatorGet(m, `/content/catalog?scope=${TENANT}`);
    expect(catalogRead.status, JSON.stringify(catalogRead.body)).toBe(200);
    const imported = await m.fetch(new Request(`${OPERATOR_ORIGIN}/content/catalog/import?scope=${TENANT}&mode=merge`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json',
        'If-Match': `"${catalogRead.body.revision as number}/${head.committed.revision}/${head.committed.digest}"`,
        'Idempotency-Key': `${catalogRead.body.revision as number}:${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ content: [REPAIRED_PIECE] }),
    }));
    expect(imported.status, `the repairing import is accepted: ${await imported.clone().text()}`).toBe(200);
    invalidatePublicationCache();

    const repaired = await loadSlots(m);
    expect(repaired.revision, 'W20.G1.03 — repairing the catalogue writes no slot revision').toBe(read.revision);
    expect(repaired.pinDiagnostics!.catalog, 'W20.G1.03 — the next read checks the new catalogue revision')
      .toEqual({ source: 'stored', revision: 2 });
    expect(repaired.pinDiagnostics!.warnings,
      'W20.G1.03 — and the warning for the repaired reference is gone while every other one stands')
      .toEqual(ACTIVATION_WARNINGS.filter(warning => warning.reason !== 'missing_piece'));
  }, 60_000);
});

// ===========================================================================
// unit:W20.G1.04 — a dead pin is safe, and never silent
// ===========================================================================

/** The merchandiser's band, whose second required position went out of stock. */
const DEAD_PIN_SLOTS = authorable({
  home: [
    { slot: 'feature', take: 3, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-tabby-evening-film', 'cnt-out-of-stock-campaign'] },
    { slot: 'story', take: 2, weights: FEATURE_WEIGHTS },
  ],
});
/** The legacy scalar pin, whose piece is not in the catalogue at all. */
const DEAD_SCALAR_SLOTS = authorable({
  home: [
    { slot: 'feature', take: 1, weights: FEATURE_WEIGHTS, pinnedPieceId: 'cnt-holiday-campaign' },
    { slot: 'story', take: 2, weights: FEATURE_WEIGHTS },
  ],
});

/** The refusals the decision set names for the two documents above. */
const DEAD_PIN_DIAGNOSTICS: PinDiagnostic[] = [
  { slot: 'feature', pinnedPieceId: 'cnt-out-of-stock-campaign', pinIndex: 1, reason: 'missing_or_ineligible' },
];
const DEAD_SCALAR_DIAGNOSTICS: PinDiagnostic[] = [
  { slot: 'feature', pinnedPieceId: 'cnt-holiday-campaign', reason: 'missing_or_ineligible' },
];

describe('unit:W20.G1.04', () => {
  it('logic: a required prefix position that cannot be served refuses the whole slot with no shifted position and no replacement, every other slot is served normally, and the decision set names the refusal and its reason', () => {
    const set = decideContent(decisionFor(homeSlots(DEAD_PIN_SLOTS)));
    // kit 03 :218 "One failure refuses the entire slot, without shifted positions
    // or ranked fill": the feature slot appears in no served position, so the
    // site's own default stands there, and the story band is served as usual.
    expect(servedOf(set),
      'W20.G1.04 — the slot with the dead required pin is handed to the site default whole, and every other slot of the page is served normally')
      .toEqual(['story:cnt-tabby-evening-film', 'story:cnt-tabby-evening-edit']);
    expect(set.pinDiagnostics,
      'W20.G1.04 — and the decision set names the refused pin, its position and its reason')
      .toEqual(DEAD_PIN_DIAGNOSTICS);
    // kit 03 :192 "Off-limits or excluded pins reserve nothing for other slots":
    // the refused slot's first pin was valid, and it is neither served there nor
    // locked away from the rest of the page. The slots that hold a served
    // position are exactly the ones the contract says they are.
    expect([...new Set(set.decisions.map(d => d.slot))],
      'W20.G1.04 — exactly one slot of this page holds served positions: the refused slot is left whole to the site default')
      .toEqual(['story']);

    // The legacy scalar pin keeps its documented semantics (kit 03 :215, :221):
    // take 1, the engine never ranks the slot, and a pin that cannot be served
    // leaves the slot to the site default rather than ranking something else in.
    const scalar = decideContent(decisionFor(homeSlots(DEAD_SCALAR_SLOTS)));
    expect(servedOf(scalar),
      'W20.G1.04 — a dead legacy scalar pin leaves its slot to the site default and never ranks a replacement into it')
      .toEqual(['story:cnt-tabby-evening-film', 'story:cnt-tabby-evening-edit']);
    expect(scalar.pinDiagnostics,
      'W20.G1.04 — and the scalar refusal is named too').toEqual(DEAD_SCALAR_DIAGNOSTICS);
  });

  it('host: on both hosts the served answer of the mounted decision route names the refused pin, so a dead pin is not silent outside the worker', async () => {
    for (const host of HOSTS) {
      const clockValue = { now: T0 };
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
      try {
        const m = await mount(host);
        await publishFixture(m, DEAD_PIN_SLOTS);
        const shopper = await shopperOn(m);
        await buildTaste(shopper, { set: (ms: number) => { clockValue.now = ms; } });
        const snapshot = await shopper.snapshot();
        expect(snapshot.status, `${host}: the mounted snapshot answers`).toBe(200);
        expect(snapshot.served,
          `${host}: W20.G1.04 — the slot whose required pin died is handed to the site default whole, and the rest of the page is served`)
          .toEqual(['story:cnt-tabby-evening-film', 'story:cnt-tabby-evening-edit']);
        // F28 §5.4 and §7.1: today the refusal reaches nothing an operator can
        // see. RULED MISSING MEMBER (R21): the answer of the mounted decision
        // route carries the `pinDiagnostics` the decision set already holds.
        expect(snapshot.pinDiagnostics,
          `${host}: W20.G1.04 — the served answer must name the refused pin, its position and its reason (ruled member: \`pinDiagnostics\` on the answer of GET /v1/:tenant/decisions/snapshot, the array \`ContentDecisionSet.pinDiagnostics\` already carries)`)
          .toEqual(DEAD_PIN_DIAGNOSTICS);
      } finally { clock.mockRestore(); }
    }
  }, 60_000);
});

// ===========================================================================
// unit:W20.G1.05 — one defined order, applied as documented
// ===========================================================================

/**
 * The documented order is
 *   lifecycle/window/stock → slotTypes → off-limits/exclusions → pins →
 *   ranking with soft diversity → the default handoff,
 * and this page asserts it ONLY where a wrong order changes the served
 * positions. Eligibility (lifecycle, window, stock) and `slotTypes` are
 * CONJUNCTIVE filters over the candidate set: a piece must pass both, so their
 * order relative to each other is not observable in any served page and this
 * unit does not claim it is. What each gate does decide IS observable, and each
 * clause below bites:
 *  · feature: the pinned piece is the LOWEST-ranked eligible piece of the slot
 *    (charms, 0.37 against 1.35 and 1.27), so a pin applied after ranking would
 *    not hold position one; three pieces the slot's own `slotTypes` admit are
 *    draft, expired and out of stock, and each scores 1.35 here, so relaxing
 *    any one of lifecycle, window or stock displaces a served position.
 *  · merch: the slot-type gate alone decides this position (see the clause in
 *    the test: two unused pieces carry the same `category: Handbags` tag, and so
 *    the same score under this slot's weighting, and stand EARLIER in catalogue
 *    order, which is the documented tie-break).
 *  · story: the pin names a piece the slot excludes by tag, so an engine in
 *    which a pin overrode an exclusion would serve it (kit 03 :191, :202).
 *  · promo: two pieces are admissible by slot type and both fail `allowedTypes`,
 *    so the slot is handed to the site default rather than filled.
 *  · rail: the diversity ceiling would leave two of four positions empty, so a
 *    soft preference must relax rather than leave a hole.
 *  · legal: off-limits with a pin, so neutralising off-limits would serve it.
 */
const PRECEDENCE_SLOTS = authorable({
  home: [
    { slot: 'feature', take: 3, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-charms-lookbook'] },
    { slot: 'story', take: 2, weights: FEATURE_WEIGHTS,
      excludedTags: [{ dimension: 'occasion', value: 'evening' }], pinnedPieceIds: ['cnt-tabby-evening-film'] },
    { slot: 'promo', take: 2, weights: FEATURE_WEIGHTS, allowedTypes: ['videogram'] },
    { slot: 'rail', take: 4, weights: RAIL_WEIGHTS, diversity: { dimension: 'line', max: 1 } },
    { slot: 'merch', take: 1, weights: { category: 1 } },
    { slot: 'legal', take: 1, weights: {}, offLimits: true, pinnedPieceIds: ['cnt-legal-notice'] },
  ],
});

describe('unit:W20.G1.05', () => {
  it('logic: the engine applies lifecycle/window/stock, then slot types, then off-limits and exclusions, then pins, then ranking with diversity as a soft preference, then the default handoff — and a pin overrides none of them', () => {
    const set = decideContent(decisionFor(homeSlots(PRECEDENCE_SLOTS)));

    // feature: the pin takes position one although it ranks last of the slot's
    // eligible pieces (0.37 against 1.35 and 1.27); the two ranked positions
    // that follow are the two highest-scoring remaining pieces.
    // story: the pin is excluded by an exact tag, so the whole slot is refused
    // (kit 03 :203 "refused at runtime without reservation or fill").
    // promo: nothing survives `allowedTypes`, so the slot is left to the site's
    // own default rather than filled with a piece the gate forbids.
    // rail: `line` may repeat at most once, which leaves two positions empty, so
    // the yielded pieces come back in rank order rather than leaving a hole.
    // merch: the only piece whose `slotTypes` name this slot holds its position.
    // legal: off-limits, so it is handed to the site default with its pin dormant.
    expect(servedOf(set),
      'W20.G1.05 — the page the documented order produces: every step of it whose effect a served page can show is shown here')
      .toEqual([
        'feature:cnt-charms-lookbook',
        'feature:cnt-tabby-evening-film',
        'feature:cnt-tabby-evening-edit',
        'rail:cnt-rail-tabby-01',
        'rail:cnt-rogue-work-edit',
        'rail:cnt-rail-tabby-02',
        'rail:cnt-rail-tabby-03',
        'merch:cnt-merch-only-banner',
      ]);

    // The pin occupies the first position of its slot and was not scored.
    const feature = set.decisions.filter(d => d.slot === 'feature');
    expect([feature[0]!.contentId, feature[0]!.order === set.decisions[0]!.order, feature[0]!.strategy, feature[0]!.score],
      'W20.G1.05 — the pinned piece is first in its slot, by the merchandiser’s authority, with no ranking behind it')
      .toEqual(['cnt-charms-lookbook', true, 'tenant-pinned', 0]);

    // A pin overrides nothing: the excluded pin is refused, and the off-limits
    // pin is dormant, each named with the gate that stopped it.
    expect(set.pinDiagnostics,
      'W20.G1.05 — a pin never overrides an exclusion or off-limits; each refusal names the gate that stopped it')
      .toEqual([
        { slot: 'story', pinnedPieceId: 'cnt-tabby-evening-film', pinIndex: 0, reason: 'excluded_tag' },
        { slot: 'legal', pinnedPieceId: 'cnt-legal-notice', pinIndex: 0, reason: 'off_limits' },
      ]);

    // Diversity relaxed rather than leaving a hole, and said so on the receipt.
    const relaxed = set.decisions.filter(d => d.explain.diversity?.relaxed === true).map(d => d.contentId);
    expect(relaxed, 'W20.G1.05 — diversity is a soft preference: the yielded pieces fill the positions it would have left empty')
      .toEqual(['cnt-rail-tabby-02', 'cnt-rail-tabby-03']);

    // The slot-type gate DECIDES a position rather than merely agreeing with the
    // ranking: the merch band holds the one piece whose `slotTypes` name it.
    const servedIds = set.decisions.map(d => d.contentId);
    expect(set.decisions.filter(d => d.slot === 'merch').map(d => d.contentId),
      'W20.G1.05 — only a piece whose slotTypes name the slot may hold its position')
      .toEqual(['cnt-merch-only-banner']);
    // …and that clause bites, because pieces the gate excluded from this slot
    // would otherwise have taken the position: they carry the same
    // `category: Handbags` tag, and so the same score under this slot's single
    // weight, and they stand earlier in catalogue order, which is the documented
    // tie-break (`src/reflex/contentCompose.ts:149-151`, :271). Asserted as a
    // property of the fixture, so a later edit to the catalogue cannot make this
    // clause silently vacuous.
    const order = W20_PIECES.map(p => p.id);
    const keptOutOfMerch = W20_PIECES.filter(p => !p.slotTypes.includes('merch')
      && (p.tags.category ?? []).includes('Handbags') && isEligibleAt(p, T0) && !servedIds.includes(p.id));
    expect(keptOutOfMerch.map(p => p.id),
      'W20.G1.05 — the pieces the slot-type gate alone keeps out of the merch band: eligible, unused, and each scoring exactly what the served banner scores')
      .toEqual(['cnt-rogue-evening-edit', 'cnt-rail-rogue-01', 'cnt-legal-notice']);
    expect(order.indexOf(keptOutOfMerch[0]!.id) < order.indexOf('cnt-merch-only-banner'),
      'W20.G1.05 — and the first of them in catalogue order stands ahead of the banner, so a neutral slot-type gate would give this position to it instead')
      .toBe(true);

    // Nothing ineligible or off-limits was served anywhere on the page, by rank
    // or by pin. Each of these bites: the three campaign pieces score 1.35 in
    // `feature`, above the 1.27 that holds its third position, so relaxing
    // lifecycle, window or stock displaces a served position; and the legal
    // notice is the only piece its own slot admits, so neutralising off-limits
    // would serve it.
    for (const forbidden of ['cnt-draft-campaign', 'cnt-expired-campaign', 'cnt-out-of-stock-campaign', 'cnt-legal-notice']) {
      expect(servedIds.includes(forbidden), `W20.G1.05 — ${forbidden} fails an earlier gate than the one that would admit it, so it is served nowhere`).toBe(false);
    }
  });
});

// ===========================================================================
// unit:W20.G1.06 — take, the pin prefix, and duplicate prevention
// ===========================================================================

/**
 * `feature` pins two of its three positions; `promo` has fewer eligible pieces
 * than it takes; `rail` has a diversity ceiling under a full candidate set. No
 * piece may be served twice anywhere on the page.
 */
const TAKE_SLOTS = authorable({
  home: [
    { slot: 'feature', take: 3, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-charms-lookbook', 'cnt-rogue-work-edit'] },
    { slot: 'promo', take: 3, weights: FEATURE_WEIGHTS },
    { slot: 'rail', take: 4, weights: RAIL_WEIGHTS, diversity: { dimension: 'line', max: 1 } },
  ],
});

/**
 * feature: the two pins in their authored order, then one ranked position (the
 *   highest remaining, film at 1.35).
 * promo: only two pieces name `promo` in their `slotTypes` and one of them is
 *   already used, so the slot serves ONE of its three positions and pads neither
 *   with an ineligible piece nor with a piece from another slot.
 * rail: tabby-evening-edit leads on `line`, the ceiling then admits the one
 *   Rogue piece left, and the two remaining positions are filled by the yielded
 *   Tabby frames in rank order.
 */
const TAKE_EXPECTED = [
  'feature:cnt-charms-lookbook',
  'feature:cnt-rogue-work-edit',
  'feature:cnt-tabby-evening-film',
  'promo:cnt-rogue-evening-edit',
  'rail:cnt-tabby-evening-edit',
  'rail:cnt-rail-rogue-01',
  'rail:cnt-rail-tabby-01',
  'rail:cnt-rail-tabby-02',
];

describe('unit:W20.G1.06', () => {
  it('logic: pins occupy the first positions in their exact order, the remainder is filled by rank, no piece is repeated in a slot or on the page, and a slot with fewer eligible pieces than take serves fewer rather than padding', () => {
    const set = decideContent(decisionFor(homeSlots(TAKE_SLOTS)));
    expect(servedOf(set), 'W20.G1.06 — the served page: pins first in their exact order, the remainder by rank, nothing repeated')
      .toEqual(TAKE_EXPECTED);

    const bySlot = new Map<string, string[]>();
    for (const decision of set.decisions) bySlot.set(decision.slot, [...(bySlot.get(decision.slot) ?? []), decision.contentId]);
    expect([...bySlot].map(([slot, ids]) => [slot, ids.length]),
      'W20.G1.06 — no slot serves more than its take, and the short slot serves what it has')
      .toEqual([['feature', 3], ['promo', 1], ['rail', 4]]);
    expect(bySlot.get('feature')!.slice(0, 2),
      'W20.G1.06 — the pin prefix occupies the first positions in the order the merchandiser authored them')
      .toEqual(['cnt-charms-lookbook', 'cnt-rogue-work-edit']);
    expect(set.decisions.filter(d => d.strategy === 'tenant-pinned').map(d => `${d.slot}:${d.contentId}`),
      'W20.G1.06 — and exactly the pinned positions are the merchandiser’s, never a ranked one')
      .toEqual(['feature:cnt-charms-lookbook', 'feature:cnt-rogue-work-edit']);

    const ids = set.decisions.map(d => d.contentId);
    expect([...new Set(ids)].length, 'W20.G1.06 — no piece is served twice on the page').toBe(ids.length);
    for (const forbidden of ['cnt-draft-campaign', 'cnt-expired-campaign', 'cnt-out-of-stock-campaign', 'cnt-merch-only-banner']) {
      expect(ids.includes(forbidden), `W20.G1.06 — the short slot is never padded with ${forbidden}`).toBe(false);
    }
  });

  it('host: on both hosts the mounted route serves the pin prefix first, fills the remainder by rank, repeats no piece on the page and never pads a short slot', async () => {
    for (const host of HOSTS) {
      const clockValue = { now: T0 };
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
      try {
        const m = await mount(host);
        await publishFixture(m, TAKE_SLOTS);
        const shopper = await shopperOn(m);
        await buildTaste(shopper, { set: (ms: number) => { clockValue.now = ms; } });
        const snapshot = await shopper.snapshot();
        expect(snapshot.status, `${host}: the mounted snapshot answers`).toBe(200);
        expect(snapshot.served, `${host}: W20.G1.06 — the mounted route serves exactly the governed page`).toEqual(TAKE_EXPECTED);
        expect([...new Set(snapshot.served)].length, `${host}: W20.G1.06 — no piece is served twice on the page`).toBe(snapshot.served.length);
        expect([snapshot.strategies['feature:cnt-charms-lookbook'], snapshot.strategies['feature:cnt-rogue-work-edit']],
          `${host}: W20.G1.06 — the first two positions are the merchandiser's own`).toEqual(['tenant-pinned', 'tenant-pinned']);
      } finally { clock.mockRestore(); }
    }
  }, 60_000);
});

// ===========================================================================
// unit:W20.G1.07 — off-limits and exclusions hold on every path
// ===========================================================================

/**
 * `feature` carries all three declarative gates at once; `story` carries none of
 * them, so the same pieces are demonstrably still servable; `promo` pins a piece
 * one of its own gates forbids; `legal` is off-limits with a dormant pin.
 */
const EXCLUSION_SLOTS = authorable({
  home: [
    { slot: 'feature', take: 3, weights: FEATURE_WEIGHTS,
      excludedPieceIds: ['cnt-tabby-evening-film'],
      excludedTags: [{ dimension: 'occasion', value: 'evening' }],
      allowedTypes: ['editorial'] },
    { slot: 'story', take: 2, weights: FEATURE_WEIGHTS },
    { slot: 'promo', take: 1, weights: FEATURE_WEIGHTS,
      excludedTags: [{ dimension: 'contentType', value: 'video' }], pinnedPieceIds: ['cnt-tabby-evening-film'] },
    { slot: 'legal', take: 1, weights: {}, offLimits: true, pinnedPieceIds: ['cnt-legal-notice'] },
  ],
});

/**
 * feature: of its five admissible pieces the excluded id, the two evening-tagged
 *   editorials, the lookbook (both by tag and by rendering type) and the film are
 *   all forbidden, so one piece is served and the other two positions are left
 *   to the site's own default rather than filled.
 * story: excludes nothing, so the pieces feature may not serve are served here.
 * promo: the pin matches the slot's own excluded tag, so the slot is refused.
 * legal: off-limits.
 */
const EXCLUSION_EXPECTED = [
  'feature:cnt-rogue-work-edit',
  'story:cnt-tabby-evening-film',
  'story:cnt-tabby-evening-edit',
];

const EXCLUSION_DIAGNOSTICS: PinDiagnostic[] = [
  { slot: 'promo', pinnedPieceId: 'cnt-tabby-evening-film', pinIndex: 0, reason: 'excluded_tag' },
  { slot: 'legal', pinnedPieceId: 'cnt-legal-notice', pinIndex: 0, reason: 'off_limits' },
];

describe('unit:W20.G1.07', () => {
  it('logic: an off-limits slot serves nothing with its pin dormant, an excluded id, an exact excluded tag value and a disallowed rendering type are served neither by rank nor by pin, for a cold and for an engaged shopper, and the same pieces stay servable in a slot that does not exclude them', () => {
    for (const [who, input] of [
      ['an engaged shopper', decisionFor(homeSlots(EXCLUSION_SLOTS))],
      ['a cold shopper', decisionFor(homeSlots(EXCLUSION_SLOTS), { affinity: null })],
    ] as const) {
      const set = decideContent(input);
      expect(servedOf(set), `W20.G1.07 — ${who}: the gates hold, and the pieces one slot forbids are still served by a slot that does not`)
        .toEqual(EXCLUSION_EXPECTED);
      expect(set.pinDiagnostics, `W20.G1.07 — ${who}: the pin the slot's own tag gate forbids is refused, and the off-limits pin is dormant`)
        .toEqual(EXCLUSION_DIAGNOSTICS);
    }

    // kit 03 :199: only an ABSENT own `contentType` uses the rendering-kind
    // fallback, identically on all arms. `cnt-charms-lookbook` carries no
    // `contentType` tag, so excluding the value `lookbook` excludes it.
    const fallback = authorable({
      home: [{ slot: 'rail', take: 3, weights: RAIL_WEIGHTS, excludedTags: [{ dimension: 'contentType', value: 'lookbook' }] }],
    });
    for (const arm of ['personalized', 'default'] as const) {
      const set = decideContent(decisionFor(homeSlots(fallback), { arm }));
      expect(set.decisions.map(d => d.contentId).includes('cnt-charms-lookbook'),
        `W20.G1.07 — ${arm}: a piece with no own contentType tag is excluded by its rendering kind, identically on every arm`).toBe(false);
    }
  });

  it('host: on both hosts and for both a cold and an engaged shopper, the mounted route serves nothing from an off-limits slot and nothing an exclusion forbids', async () => {
    for (const host of HOSTS) {
      const clockValue = { now: T0 };
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
      try {
        const m = await mount(host);
        await publishFixture(m, EXCLUSION_SLOTS);

        const cold = await shopperOn(m);
        const coldSnapshot = await cold.snapshot();
        expect(coldSnapshot.status, `${host}: the mounted snapshot answers a cold shopper`).toBe(200);
        expect(coldSnapshot.served, `${host}: W20.G1.07 — a cold shopper is governed by the same gates`).toEqual(EXCLUSION_EXPECTED);

        const engaged = await shopperOn(m);
        await buildTaste(engaged, { set: (ms: number) => { clockValue.now = ms; } });
        const engagedSnapshot = await engaged.snapshot();
        expect(engagedSnapshot.status, `${host}: the mounted snapshot answers an engaged shopper`).toBe(200);
        expect(engagedSnapshot.served, `${host}: W20.G1.07 — and so is a shopper whose taste would have chosen the forbidden pieces`)
          .toEqual(EXCLUSION_EXPECTED);
      } finally { clock.mockRestore(); }
    }
  }, 60_000);
});

// ===========================================================================
// unit:W20.G1.08 — both arms obey the same governance
// ===========================================================================

/** One pinned position, one off-limits slot, one ranked slot, on both arms. */
const BOTH_ARMS_SLOTS = authorable({
  home: [
    { slot: 'feature', take: 3, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-charms-lookbook'] },
    { slot: 'legal', take: 1, weights: {}, offLimits: true, pinnedPieceIds: ['cnt-legal-notice'] },
  ],
});

/** The personalized arm ranks the remainder on the shopper's own taste. */
const BOTH_ARMS_PERSONALIZED = ['feature:cnt-charms-lookbook', 'feature:cnt-tabby-evening-film', 'feature:cnt-tabby-evening-edit'];
/** The default arm ranks nothing: the remainder is the catalogue's own order. */
const BOTH_ARMS_DEFAULT = ['feature:cnt-charms-lookbook', 'feature:cnt-rogue-work-edit', 'feature:cnt-tabby-evening-film'];

describe('unit:W20.G1.08', () => {
  it('logic: the pinned position, the reservation, the off-limits handoff and take are identical on the default arm and the personalized arm, only the ranked remainder differs, and each arm’s receipt names the pin it served', () => {
    const personalized = decideContent(decisionFor(homeSlots(BOTH_ARMS_SLOTS)));
    const control = decideContent(decisionFor(homeSlots(BOTH_ARMS_SLOTS), { arm: 'default' }));

    expect(servedOf(personalized), 'W20.G1.08 — the personalized arm: the governed position first, then its own ranking')
      .toEqual(BOTH_ARMS_PERSONALIZED);
    expect(servedOf(control), 'W20.G1.08 — the default arm: the same governed position, then the site’s own order')
      .toEqual(BOTH_ARMS_DEFAULT);
    expect(servedOf(control)[0], 'W20.G1.08 — the pin is merchandising authority, not personalization, so the holdout keeps it')
      .toBe(servedOf(personalized)[0]);
    expect([servedOf(personalized).length, servedOf(control).length],
      'W20.G1.08 — both arms serve the same governed number of positions, and neither serves the off-limits slot').toEqual([3, 3]);

    // The receipt of each arm names the pin it served, with the same authority.
    for (const [arm, set] of [['personalized', personalized], ['default', control]] as const) {
      const pinned = set.records.filter(record => record.authority === 'pin');
      expect(pinned.map(record => [record.slot, record.item_id, record.position]),
        `W20.G1.08 — ${arm}: the receipt names the pin it served, its slot and its position`)
        .toEqual([['feature', 'cnt-charms-lookbook', 0]]);
      expect(pinned[0]!.explain.note,
        `W20.G1.08 — ${arm}: and says in words that ranking never ran for it`)
        .toBe('required pinned prefix position — ranking never ran for this piece');
      // kit 03 :186: off-limits serves "without candidates, decisions or
      // records", so the slots that wrote a record are exactly the served one.
      expect([...new Set(set.records.map(record => record.slot))],
        `W20.G1.08 — ${arm}: the ledger carries exactly the slot that was served, the off-limits slot having written nothing`)
        .toEqual(['feature']);
    }
  });

  it('host: on both hosts the default (holdout) arm and the personalized arm serve the same governed positions through the mounted route, and only the ranked remainder differs', async () => {
    for (const host of HOSTS) {
      const clockValue = { now: T0 };
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
      try {
        // The personalized arm: no holdout at all.
        const personalized = await mount(host);
        await publishFixture(personalized, BOTH_ARMS_SLOTS, 0);
        const engaged = await shopperOn(personalized);
        await buildTaste(engaged, { set: (ms: number) => { clockValue.now = ms; } });
        const one = await engaged.snapshot();
        expect(one.status, `${host}: the mounted snapshot answers`).toBe(200);
        expect(one.arm, `${host}: this shopper is on the personalized arm`).toBe('personalized');
        expect(one.served, `${host}: W20.G1.08 — the personalized arm serves the governed position and then its own ranking`)
          .toEqual(BOTH_ARMS_PERSONALIZED);

        // The control arm: the whole tenant in the holdout's default arm.
        clockValue.now = T0;
        const control = await mount(host);
        await publishFixture(control, BOTH_ARMS_SLOTS, 1);
        const held = await shopperOn(control);
        await buildTaste(held, { set: (ms: number) => { clockValue.now = ms; } });
        const two = await held.snapshot();
        expect(two.status, `${host}: the mounted snapshot answers`).toBe(200);
        expect(two.arm, `${host}: this shopper is in the holdout's default arm`).toBe('default');
        expect(two.served, `${host}: W20.G1.08 — the default arm serves the same governed position and the site's own order below it`)
          .toEqual(BOTH_ARMS_DEFAULT);
        expect(two.served[0], `${host}: W20.G1.08 — the holdout does not remove the merchandiser's pin`).toBe(one.served[0]);
        expect(two.strategies[two.served[0]!], `${host}: W20.G1.08 — and the control arm names it as the pin it is`).toBe('tenant-pinned');
      } finally { clock.mockRestore(); }
    }
  }, 60_000);
});

// ===========================================================================
// unit:W20.G1.09 — the operator workflow, on the shipped console (R68(a))
// ===========================================================================

const pub = (file: string): string => readFileSync(new URL(`../../../public/${file}`, import.meta.url), 'utf8');

interface El {
  value: string; hidden: boolean; disabled: boolean; textContent: string | null; dataset: Record<string, string>;
  classList: { contains: (name: string) => boolean };
  previousElementSibling: El | null; parentElement: El | null;
  click: () => void; focus: () => void;
  querySelector: (sel: string) => El | null; querySelectorAll: (sel: string) => ArrayLike<El>;
  dispatchEvent: (e: unknown) => boolean;
}
interface ConsoleBrowser extends Record<string, unknown> {
  document: { body: El; getElementById: (id: string) => unknown; querySelector: (s: string) => El | null; querySelectorAll: (sel: string) => ArrayLike<El> };
  eval: (s: string) => unknown; close: () => void; location: { hash: string };
  localStorage: { setItem: (key: string, value: string) => void };
  Event: new (type: string, options: object) => unknown;
}

/** The SHIPPED console, under jsdom, with its fetch bound to the mounted app. */
async function openConsole(m: Mounted, hash: string) {
  const dom = new JSDOM(pub('console/index.html'), { url: `${OPERATOR_ORIGIN}/console/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as ConsoleBrowser;
  const requests: Array<{ method: string; path: string; body: string | undefined }> = [];
  const intervals: Array<() => void> = [];
  w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const target = new URL(url, `${OPERATOR_ORIGIN}/console/`);
    const method = (init?.method ?? 'GET').toUpperCase(), path = target.pathname + target.search;
    requests.push({ method, path, body: init?.body });
    return m.fetch(new Request(OPERATOR_ORIGIN + path, {
      method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }),
    }));
  };
  w.TextEncoder = TextEncoder;
  w.setInterval = (callback: () => void) => { intervals.push(callback); return intervals.length; };
  w.confirm = () => true;
  w.localStorage.setItem('operator-session', JSON.stringify({
    accessToken: m.operatorToken, refreshToken: 'w20-b1-refresh', exp: Date.now() + 3_600_000,
    user: { id: 'ops', name: 'Test Operator', email: 'ops@brand.test', roles: ['admin'] }, mustChangePassword: false,
  }));
  w.eval(pub('operator-session.js'));
  w.eval(pub('console/shell.js'));
  w.eval(pub('console/views.js'));
  w.eval(pub('console/views-config.js'));
  w.eval(pub('console/views-measure.js'));
  w.eval(pub('console/views-accounts.js'));
  w.eval(pub('console/views-explore.js'));
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 12)); };
  /** Long enough for the rules screen's validator, which waits 350 ms after the last keystroke. */
  const settleChecked = async () => { await new Promise(r => setTimeout(r, 450)); await settle(); };
  await settle(); await settle();
  const $ = (id: string) => w.document.getElementById(id) as unknown as El;
  const all = (sel: string) => Array.from(w.document.querySelectorAll(sel));
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  const goTo = async (next: string) => { w.location.hash = next; await settle(); await settle(); };
  /** Type into a control of the shipped screen, the way a merchandiser does. */
  const type = async (focusKey: string, value: string) => {
    const el = all(`[data-focus-key="${focusKey}"]`)[0]!;
    expect(el, `the shipped rules screen renders a control for ${focusKey}`).toBeTruthy();
    el.focus(); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await settleChecked();
  };
  const choose = async (focusKey: string, value: string) => {
    const el = all(`[data-focus-key="${focusKey}"]`)[0]!;
    expect(el, `the shipped rules screen renders a control for ${focusKey}`).toBeTruthy();
    el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await settleChecked();
  };
  /**
   * The words the SHIPPED screen prints for a control, read off the rendered
   * DOM: the `.name` element the screen draws immediately above (or beside, in a
   * dial) the control that owns this focus key. Never a literal in this file.
   */
  const labelFor = (focusKey: string): string => {
    const el = all(`[data-focus-key="${focusKey}"]`)[0]!;
    expect(el, `the shipped rules screen renders a control for ${focusKey}`).toBeTruthy();
    let cursor: El | null = el.previousElementSibling;
    while (cursor && !cursor.classList.contains('name')) cursor = cursor.previousElementSibling;
    const named = cursor ?? el.parentElement?.querySelector('.name') ?? null;
    const words = (named?.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(words.length, `the shipped screen names the control for ${focusKey} in words`).toBeGreaterThan(0);
    return words;
  };
  const save = async () => { await settleChecked(); $('save').click(); await settle(); await settle(); };
  const puts = () => requests.filter(r => r.method === 'PUT' && r.path.startsWith('/content/slots'));
  return { w, requests, puts, $, all, text, settle, settleChecked, goTo, type, choose, labelFor, save, close: () => w.close() };
}

/** What the operator starts from: a plain ranked hero, a band and a legal slot. */
const OPERATOR_START = authorable({
  home: [
    { slot: 'feature', take: 3, weights: FEATURE_WEIGHTS },
    { slot: 'story', take: 2, weights: FEATURE_WEIGHTS },
    { slot: 'legal', take: 1, weights: {} },
  ],
});
/** What she authors through the shipped screen. */
const OPERATOR_PINS = ['cnt-charms-lookbook', 'cnt-rogue-work-edit'];
const OPERATOR_EXCLUSION = ['cnt-tabby-evening-film'];
const OPERATOR_TYPES = ['editorial', 'lookbook'];

describe('unit:W20.G1.09', () => {
  it('sdk: on the shipped rules screen an operator authors an ordered pin prefix, an exclusion, the allowed types and off-limits, saves them through the mounted routes, is shown the advisory pin report with the catalogue revision it checked, and is refused a document-local contradiction in the screen’s own words with the save disabled and no PUT', async () => {
    // No clock of this file's own here: the shipped console runs in the jsdom
    // realm, whose `Date` is not the one a vitest spy replaces, so a fixed
    // platform clock would leave the operator's own session looking expired to
    // the screen while the platform still accepted it. The workflow below needs
    // no fixed time: it reads and writes documents, it serves no decision.
    const m = await mount();
    await publishFixture(m, OPERATOR_START);
    const c = await openConsole(m, `#/rules?scope=${TENANT}&slot=feature`);
    try {
      expect(c.text(), 'the rules screen is reading the mounted slot document').toContain('feature on home');

      // 1. The ordered pin prefix, the exclusion and the allowed types, through
      //    the controls the shipped screen offers.
      await c.type('governance.pin', JSON.stringify(OPERATOR_PINS));
      await c.type('governance.excluded', JSON.stringify(OPERATOR_EXCLUSION));
      await c.type('governance.types', JSON.stringify(OPERATOR_TYPES));
      expect(c.$('save').disabled, 'a valid draft leaves the save available').toBe(false);
      await c.save();
      expect(c.puts().length, 'the console saved the governance it authored through the mounted route').toBe(1);

      const afterPins = await loadSlots(m);
      const feature = afterPins.document.pages.home!.find(slot => slot.slot === 'feature')!;
      expect([feature.pinnedPieceIds, feature.excludedPieceIds, feature.allowedTypes, feature.take],
        'W20.G1.09 — the mounted platform stored exactly the ordered prefix, the exclusion and the allowed types the operator authored, and changed take for nobody')
        .toEqual([OPERATOR_PINS, OPERATOR_EXCLUSION, OPERATOR_TYPES, 3]);

      // 2. After the save the advisory pin report is on the screen, naming the
      //    catalogue revision it was checked against (F28 §7.2).
      expect(c.text(), 'W20.G1.09 — the saved revision is named on the screen').toContain(`Saved revision ${afterPins.revision} response`);
      expect(c.text(), 'W20.G1.09 — and the advisory pin report names the catalogue revision it checked').toContain('catalog revision 1');

      // 3. Off-limits on the legal slot, saved the same way.
      await c.goTo(`#/rules?scope=${TENANT}&slot=legal`);
      expect(c.text(), 'the rules screen moved to the legal slot').toContain('legal on home');
      await c.choose('governance.off', 'true');
      await c.save();
      const afterOff = await loadSlots(m);
      expect(afterOff.document.pages.home!.find(slot => slot.slot === 'legal')!.offLimits,
        'W20.G1.09 — the mounted platform stored the off-limits switch the operator threw').toBe(true);
      expect(afterOff.document.pages.home!.find(slot => slot.slot === 'feature')!.pinnedPieceIds,
        'W20.G1.09 — and the pins she saved a moment ago are untouched by it').toEqual(OPERATOR_PINS);

      // 4. A document-local contradiction: the same piece twice in one prefix.
      //    The refusal names the control she is editing, in the words the SHIPPED
      //    screen prints above it, the save is disabled, and nothing is sent.
      await c.goTo(`#/rules?scope=${TENANT}&slot=feature`);
      const pinLabel = c.labelFor('governance.pin');
      const putsBefore = c.puts().length;
      await c.type('governance.pin', JSON.stringify([OPERATOR_PINS[0], OPERATOR_PINS[0]]));
      expect(c.$('save').disabled, 'W20.G1.09 — a refused draft disables the save').toBe(true);
      c.$('save').click();
      await c.settle();
      expect(c.puts().length, 'W20.G1.09 — and sends no PUT at all').toBe(putsBefore);
      const banner = c.all('#view .msg.err').map(el => (el.textContent ?? '').replace(/\s+/g, ' ')).join(' ');
      expect(banner, 'W20.G1.09 — the refusal is on the screen').toContain('This change cannot be saved');
      expect(banner, `W20.G1.09 — and names the control she was editing, in the screen's own words for it ("${pinLabel}")`).toContain(pinLabel);

      const unchanged = await loadSlots(m);
      expect(unchanged.revision, 'W20.G1.09 — the refused draft wrote no revision').toBe(afterOff.revision);
    } finally { c.close(); }
  }, 90_000);

  it('host: rolling a former revision forward through the mounted route restores the former pins, and the next snapshot serves them on both hosts', async () => {
    for (const host of HOSTS) {
      const clockValue = { now: T0 };
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
      try {
        const m = await mount(host);
        await publishFixture(m, BOTH_ARMS_SLOTS);
        const shopper = await shopperOn(m);
        await buildTaste(shopper, { set: (ms: number) => { clockValue.now = ms; } });
        const first = await shopper.snapshot();
        expect(first.served, `${host}: the published revision serves the merchandiser's pin`).toEqual(BOTH_ARMS_PERSONALIZED);

        // Revision 2: she pins a different piece into the same slot.
        const base = await loadSlots(m);
        const changed = JSON.parse(JSON.stringify(base.document)) as SlotCatalog;
        changed.pages.home!.find(slot => slot.slot === 'feature')!.pinnedPieceIds = ['cnt-rogue-work-edit'];
        const written = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT', { document: changed, note: 'swap the pin' },
          { revision: base.revision, publication: base.publication });
        expect(written.status, `${host}: the new pin is published: ${JSON.stringify(written.body.errors ?? '')}`).toBe(200);
        const swapped = await shopper.snapshot();
        expect(swapped.served[0], `${host}: the new revision serves the new pin`).toBe('feature:cnt-rogue-work-edit');

        // Rolling the former revision forward restores the former pins.
        const current = await loadSlots(m);
        const rolled = await operatorWrite(m, `/content/slots/rollback/${base.revision}?scope=${TENANT}`, 'POST', { note: 'put the campaign back' },
          { revision: current.revision, publication: current.publication });
        expect(rolled.status, `${host}: the rollback is accepted: ${JSON.stringify(rolled.body.errors ?? rolled.body)}`).toBe(200);
        const restored = await loadSlots(m);
        expect(restored.revision, `${host}: W20.G1.09 — a rollback rolls FORWARD to a new revision`).toBe(current.revision + 1);
        expect(restored.document.pages.home!.find(slot => slot.slot === 'feature')!.pinnedPieceIds,
          `${host}: W20.G1.09 — carrying the former pins`).toEqual(['cnt-charms-lookbook']);

        const after = await shopper.snapshot();
        expect(after.served, `${host}: W20.G1.09 — and the next snapshot serves the restored pins`).toEqual(BOTH_ARMS_PERSONALIZED);
        expect(after.strategies['feature:cnt-charms-lookbook'],
          `${host}: W20.G1.09 — as the merchandiser's own position`).toBe('tenant-pinned');
      } finally { clock.mockRestore(); }
    }
  }, 90_000);
});
