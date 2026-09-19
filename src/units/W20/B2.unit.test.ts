// src/units/W20/B2.unit.test.ts
// W20 batch B2 — the OPERATOR-visible signal for a dead pin and for a pinned
// slot that could not fill `take`, the receipt note where a record exists, the
// ops-monitor counter, the advisory read of a retained revision carrying an
// active id-excluded pin, the bound on the runtime member, and the `ownerSlot`
// sentence.
//
// One `describe('unit:W20.<id>')` per unit of batch W20-B2, one `it` per ruled
// leg. Every expected value comes from a witness or from the documented shape of
// the surface it is placed on, never from what the engine returns today:
//   · document 35 §5 row W20 · G2 (:415): "… duplicate prevention, dead-pin
//     diagnostics … Test both arms and actual operator workflows."
//   · `docs/architecture/35-verification-reports/F28.md` §7.1 (:196): "A receipt
//     note and a monitor signal when a pin does not resolve, and when a pinned
//     slot cannot fill `take` (today both are silent)"; §5.4 ("A dead pin
//     silently deletes the slot … with no decision, no candidates entry, no
//     receipt note and no monitor signal. A stock feed flipping one flag can
//     blank the merchandiser's campaign band and nobody is told").
//   · `docs/handover/HANDOFF-2026-09-18.md` §6 row W20: "Complete
//     activation/reference diagnostics and real operator workflow."
//   · the published contract `docs/kit/03-payload-schemas.md` "Hard slot
//     controls" :186-:219, and the two answer paragraphs W20-B1 shipped
//     (`docs/kit/02-api-reference.md:190`, `docs/api/01-rest-endpoints.md:36`).
//   · rulings R19 (host legs drive the mounted routes production serves), R21
//     (a ruled-but-absent member is named), R83 (the served snapshot answer is
//     the SHOPPER surface and does not satisfy "operator-visible"), R86 (this
//     batch's readings), R89(a) (the runtime member is bounded), R89(b) (the
//     `ownerSlot` sentence is widened).
//
// THE ONE HOME FOR THE COUNTS (R86(a): "placed on the ONE surface the engine
// already gives operators for slots"). Measured before ruling, these are the
// engine's operator surfaces:
//   · `GET /v1/:tenant/learn/slots` (`src/routes/decisions.ts:195-215`), the
//     operator slots page: EVERY slot of every page for one tenant, grouped by
//     page, one `SlotIndexEntry` each (`src/learn/rows.ts:140-166`), and it
//     ALREADY joins per-slot RUNTIME state onto those entries — `evidence=1`
//     fills `evidence` for up to 200 slots from a per-slot KV read
//     (`decisions.ts:203-211`). Per tenant, per slot, operator-credentialled,
//     with the join already in place. **This is the home ruled here.**
//   · `GET /v1/:tenant/monitor` / `POST` (`decisions.ts:250-263`), the ops
//     monitor: per TENANT, not per slot; its `CHECKS` list
//     (`src/ops/monitor.ts:195`) is a fixed health list of `{ok, ms}` from a
//     five-minute synthetic probe, which cannot carry a per-slot count. It is
//     ruled separately, as the tenant-level signal, by unit W20.G2.04.
//   · `GET /v1/:tenant/audit` (`decisions.ts:99`): minimized tenant READ-audit
//     rows only — a log of who read what, not a serving counter.
//   · `GET /v1/:tenant/learn/queue` (`decisions.ts:269-286`, `src/learn/queue.ts`):
//     what needs a person. It DOES join the same per-slot runtime evidence under
//     the same 200-slot budget (`decisions.ts:279-283`) — the rejection is not
//     that it lacks the join; it is that the queue answers tenant-wide COUNTS
//     and two small slot lists (`src/learn/queue.ts:10-23`), not a row per slot,
//     so it has nowhere to put a per-slot refusal with its reason and piece id.
//   · `POST/GET /v1/:tenant/learn/report` and `/report/window`
//     (`src/learn/report.ts`): the day's LEDGER under the learning policy —
//     built from decision and outcome records, so a refused slot, which writes
//     no record at all, can never appear in it.
// So: one home for the counts, the operator slots page; one tenant-level check,
// the monitor; and the receipt note where a record exists.
//
// RULED MISSING MEMBERS (R21), by the names this specification rules, RED until
// they exist. No new export is ruled; each is a member of an answer an operator
// route already returns:
//   1. `SlotIndexEntry.governance` on `GET /v1/:tenant/learn/slots?evidence=1`
//      (units W20.G2.01, W20.G2.02) — joined per slot exactly as `evidence` is,
//      under the same flag and the same 200-slot budget:
//        governance: {
//          since: number,                 // epoch ms: the horizon these counts start at
//          refusedPinCount: number,       // occurrences since `since`; 0, never omitted
//          refusedPins: Array<{ pinnedPieceId: string; reason: string; count: number }>,
//          shortTakeCount: number,        // times the slot served fewer than `take`
//          shortTakePositions: number,    // positions left empty across those times
//        }
//      `reason` is the RUNTIME refusal vocabulary the composer records and the
//      snapshot answer already carries (`PinDiagnostic['reason']`,
//      `src/reflex/contentCompose.ts:96-102`: `invalid_take`,
//      `missing_or_ineligible`, `slot_type`, `duplicate_pin`, `off_limits`,
//      `excluded`, `type_not_allowed`, `excluded_tag`) — NOT the activation
//      vocabulary of `slot-pin-diagnostics/v1`, because these count what the
//      decision path refused, not what a publication check foresaw.
//      RATIFIED (R94(a)): the RUNTIME vocabulary is the right one here, against
//      the brief's activation words, because these count what the decision path
//      refused. WITHDRAWN (R94, correction 5): no `short_take` reason TOKEN is
//      ruled. The engine has no word of its own for a pinned slot that could not
//      fill `take` (`rankedCapacity`, `src/content/slotConstraints.ts:7`, is
//      capacity, not a shortfall), and this specification does not invent one:
//      the shortfall is carried by its own named members, `shortTakeCount` and
//      `shortTakePositions`, which is one vocabulary across both surfaces.
//   2. `DecisionRecord.explain.shortTake` (unit W20.G2.03), in the shape every
//      other rule block on `explain` already has — numbers plus a `sentence`
//      (`src/content/decide.ts:396-399` for merchandising, stage, freshness,
//      fatigue) — and that sentence read out on the receipt's `why`, the way
//      `receiptOf` already reads every other block out
//      (`src/learn/receipts.ts:70-74`):
//        shortTake: { take: number; served: number; empty: number; sentence: string }
//   3. `MonitorResult.governance` (unit W20.G2.04), carried by the safe
//      projection `projectMonitor` (`src/ops/monitor.ts:209-223`) and answered
//      by `POST /v1/:tenant/monitor`:
//        governance: { since: number; refusedPinCount: number; shortTakeCount: number }
//      per tenant, in ONE vocabulary with the slots page (R94(c)): the same two
//      count names, with the per-pin `refusedPins` detail on the slots page
//      alone. Read from the same counters the slots page reads, so it is never a
//      synthetic-probe-only value.
//      AND NEVER THE MONITOR'S OWN PROBE (R94(b)): `runChecks` composes the same
//      page as a synthetic visitor (`src/ops/monitor.ts:317-320`, `visitorId:
//      monitor-…`, `channel: monitor`), so a counter written at the decision
//      path would count the platform watching itself. The monitor's synthetic
//      compose is nobody's occurrence, on either surface; W20.G2.04 asserts it
//      on both. The exclusion mechanism is the implementer's to choose — the
//      probe's own visitor/channel identity, or a caller flag — and to name.
//   4. `refusedCount` and `omittedCount` beside `pinDiagnostics` on the snapshot
//      answer (unit W20.G2.06), with the array capped at the 50 the advisory
//      channel already caps its sample at (`src/content/slotDiagnostics.ts:41`,
//      `warningCount` / `omittedWarningCount` / `warnings`), so an
//      operator-authored document can never turn a served snapshot into a 503
//      (R89(a); the W20-B1 build review's finding 2).
//   5. The widened `ownerSlot` sentence in both shipped documentation paragraphs
//      (unit W20.G2.07, R89(b)); the exact sentence ruled is `OWNER_SLOT_SENTENCE`
//      below.
//
// ONE REPRESENTATION, SHARED BY EVERY UNIT BELOW:
//   (i)   "Operator-visible" is a surface an operator reads with an operator
//         credential. The shopper's snapshot answer is not one (R83); it stays
//         exactly as W20-B1 shipped it and is only read here to DRIVE the
//         occurrences the operator surfaces must then report.
//   (ii)  A refusal and a shortfall are counted per tenant and per slot, since a
//         horizon the answer states, and zero is reported as zero.
//   (iii) Governance is arm-independent (W20.G1.08), so an occurrence counts on
//         the default arm exactly as it does on the personalized arm.
//   (iv)  A refused slot writes no decision record, so it has no receipt: the
//         operator signal of (ii) is its only home. Only a slot that SERVED
//         something and still fell short of `take` has a receipt to name it.

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND, validateSlotCatalog } from '@/content/kinds';
import type { ContentPiece, DecisionRecord, SlotCatalog } from '@/content/types';
import type { SlotIndexEntry } from '@/learn/rows';
import type { MonitorResult } from '@/ops/monitor';
import type { PinDiagnostic } from '@/reflex/contentCompose';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent } from '@/content/consent';
import { configuredDestinations } from '@/connectors/config';
import type { Env } from '@/types/env';
import { RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';

// ===========================================================================
// The customer's fixture: Coach's own dimensions and values
// (docs/architecture/tapestry_requirements.txt A.3.6), a catalogue and slot
// documents unlike the compiled defaults, and the tenant's own registry.
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

const W20_PIECES: ContentPiece[] = [
  piece('cnt-hero-tabby', { title: 'The Tabby, after dark', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story'] }),
  piece('cnt-hero-rogue', { title: 'The Rogue, at work', type: 'editorial',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story'] }),
  piece('cnt-promo-film', { title: 'Ninety seconds with the Tabby', type: 'film',
    tags: { line: ['Tabby'], contentType: ['video'] }, slotTypes: ['promo'] }),
  piece('cnt-promo-edit', { title: 'The Rogue, restated', type: 'editorial',
    tags: { line: ['Rogue'], contentType: ['editorial'] }, slotTypes: ['promo'] }),
  // The stock flag F28 §5.4 names: "a stock feed flipping one flag can blank
  // the merchandiser's campaign band and nobody is told".
  piece('cnt-sold-out', { title: 'The Tabby 26, sold out', type: 'editorial',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] },
    slotTypes: ['feature', 'story', 'promo'], inStock: false }),
  piece('cnt-rail-tabby-01', { title: 'Tabby, frame one', type: 'editorial',
    tags: { line: ['Tabby'], category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['rail'] }),
  piece('cnt-rail-rogue-01', { title: 'Rogue, frame one', type: 'editorial',
    tags: { line: ['Rogue'], category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['rail'] }),
  piece('cnt-legal-notice', { title: 'Terms of this promotion', type: 'editorial',
    tags: { category: ['Handbags'], contentType: ['editorial'] }, slotTypes: ['legal'] }),
];

const W20_CATALOGUE = { version: 'w20-b2-coach-catalogue', pieces: W20_PIECES };

/** The tenant's PUBLISHED registry, not the bundled default (as W20-B1 did). */
const TENANT_REGISTRY = {
  ...DEFAULT_REFLEX_CONFIG,
  version: 'w20-b2-coach-registry',
  dimensions: [
    ...DEFAULT_REFLEX_CONFIG.dimensions.filter(dimension => dimension.key !== 'silhouette'),
    { key: 'styleWorld', source: 'styleWorld' },
  ],
};

const FEATURE_WEIGHTS = { line: 1, occasion: 0.5, category: 0.2 };

/** A document a merchandiser could author: through the real publication validator. */
function authorable(pages: Record<string, unknown[]>): SlotCatalog {
  const candidate = { version: 'w20-b2-coach-slots', governanceVersion: 3, pages };
  const checked = validateSlotCatalog(candidate);
  expect(checked.ok ? '' : (checked as { ok: false; errors: string[] }).errors.join('; '),
    `the fixture slot document must be one a merchandiser could author: ${JSON.stringify(pages).slice(0, 400)}`).toBe('');
  return (checked as { ok: true; value: SlotCatalog }).value;
}

/**
 * A RETAINED revision: one the current write validator refuses and a stored
 * revision published before that check existed still carries
 * (`SLOTS_KIND.validateStored` → `parseSlotCatalog`, `src/content/kinds.ts:430`,
 * the path `initializePublicationSet` takes for `retainedValue`,
 * `src/config/publication.ts:486`). Same helper, same meaning, as W20-B1.
 */
function retained(pages: Record<string, unknown[]>): SlotCatalog {
  const candidate = { version: 'w20-b2-retained-slots', governanceVersion: 3, pages };
  expect(validateSlotCatalog(candidate).ok,
    `this fixture exists to prove a retained revision, so the write path must refuse it: ${JSON.stringify(pages).slice(0, 400)}`).toBe(false);
  const checked = SLOTS_KIND.validateStored!(candidate);
  expect(checked.ok ? '' : (checked as { ok: false; errors: string[] }).errors.join('; '),
    'a retained revision must still parse').toBe('');
  return (checked as { ok: true; value: SlotCatalog }).value;
}

// ===========================================================================
// The mounted application, in process, on either shopper host. Pattern reused
// from `src/units/W20/B1.unit.test.ts`; that file is not imported or edited.
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

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w20-b2-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
/**
 * EVERY retention category the platform names (`RETENTION_CATEGORIES`,
 * src/retention.ts:5), not a hand-picked subset: the durable admission of a
 * rendered decision commits under `recovery` and `quarantine` as well as the
 * five a plain page load needs, and a tenant with no policy for one of them
 * refuses the acknowledgement. The merged SDK-contract fixture adds the same two
 * (`src/routes/realtime.sdkContract.test.ts:297-299`).
 */
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

const OPERATOR_SECRET = 'w20-b2-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';

interface Mounted {
  env: Env;
  objects: Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>;
  drain: () => Promise<void>;
  fetch: (input: Request) => Promise<Response>;
  operatorToken: string;
  configureRetention: () => Promise<void>;
}

/**
 * `renderAdmission` binds `LEDGER_RECOVERY_ENABLED`, which the durable admission
 * of a RENDERED decision requires: without it the impression that redeems a
 * render offer is refused with "Recovery admission disabled"
 * (`src/routes/realtime.ts`, the recovery path). The merged SDK-contract fixture
 * sets exactly this before acknowledging a render
 * (`src/routes/realtime.sdkContract.test.ts:296`). Only the unit that renders
 * asks for it, so no other unit's capture path is perturbed.
 */
async function mount(host: 'session' | 'do' = 'session', options: { renderAdmission?: boolean } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w20-b2-proof`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => undefined },
    ...(options.renderAdmission ? { LEDGER_RECOVERY_ENABLED: 'true' } : {}),
  } as unknown as Env;
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* no destination diagnostics in this fixture */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  /**
   * One durable-object namespace per class, each instance the REAL class over a
   * storage stub, as `src/units/W20/B1.unit.test.ts` does for the shopper. The
   * decision ring is bound too, because the operator's own reads of what a
   * shopper was served (`/recent`, `/receipts`) go through it
   * (`src/routes/decisions.ts:82-95`, `src/learn/fan.ts:339`).
   */
  const namespaceFor = <T extends { fetch: (request: Request) => Promise<Response> }>(
    make: (state: DurableObjectState, env: Env) => T,
    registry?: Map<string, { shopper: T; data: Map<string, unknown> }>,
  ) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = registry?.get(name) as { shopper: T; data: Map<string, unknown> } | undefined;
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
        item = { data, shopper: make(state, env) };
        registry?.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e), objects) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), new Map()) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), new Map()) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const fetchOne = async (request: Request): Promise<Response> => {
    await configureRetention();
    return app.fetch(request, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, objects, drain, fetch: fetchOne, operatorToken, configureRetention };
}

/** The four documents a provisioned tenant holds. `retainedSlots` publishes the slot document the way a revision stored before today's write check is read back. */
async function publishFixture(m: Mounted, slots: SlotCatalog, options: { holdoutShare?: number; retainedSlots?: boolean; learnSlots?: Record<string, unknown> } = {}): Promise<void> {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT, retainedValue = false): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w20-b2-fixture', note: 'fixture', value }, ...(retainedValue ? { retainedValue: true } : {}) });
  await initializePublicationSet(m.env, [
    baseline(CONTENT_KIND, W20_CATALOGUE),
    baseline(SLOTS_KIND, slots, TENANT, options.retainedSlots === true),
    baseline(LEARN_KIND, { holdout: { share: options.holdoutShare ?? 0, salt: 'w20-b2', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: options.learnSlots ?? {} }),
    baseline(REFLEX_KIND, TENANT_REGISTRY, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
}

async function operatorGet(m: Mounted, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT },
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function operatorPost(m: Mounted, path: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// The operator slots page — the one home for the counts.
// ---------------------------------------------------------------------------

/** RULED, ABSENT TODAY (R21): the per-slot governance counts on the operator slots page. */
interface SlotGovernance {
  since: number;
  refusedPinCount: number;
  refusedPins: Array<{ pinnedPieceId: string; reason: string; count: number }>;
  shortTakeCount: number;
  shortTakePositions: number;
}
/** What every governance block says apart from the horizon it counts from. */
type GovernanceCounts = Omit<SlotGovernance, 'since'>;

/**
 * R21, made TYPECHECK-VISIBLE (R94(f)): the member is read off the engine's own
 * `SlotIndexEntry` (`src/learn/rows.ts:140`), not off a shape declared here, so
 * the compiler names it as missing until it exists. This is one of the three
 * ruled-missing type errors this batch expects.
 */
const governanceMember = (entry: SlotIndexEntry): SlotGovernance | undefined => entry.governance;

/** `GET /v1/:tenant/learn/slots?evidence=1`, the operator slots page, flattened by slot. */
async function slotsPage(m: Mounted): Promise<{ status: number; bySlot: Record<string, SlotIndexEntry> }> {
  const read = await operatorGet(m, `/v1/${TENANT}/learn/slots?evidence=1`);
  const bySlot: Record<string, SlotIndexEntry> = {};
  for (const page of (read.body.pages as Array<{ page: string; slots: SlotIndexEntry[] }> | undefined) ?? []) {
    for (const entry of page.slots) bySlot[entry.slot] = entry;
  }
  return { status: read.status, bySlot };
}

/** The governance block of one slot, or a sentence saying it is absent, so the failure names the missing member. */
const governanceOf = (bySlot: Record<string, SlotIndexEntry>, slot: string): SlotGovernance | string => {
  const entry = bySlot[slot];
  return (entry && governanceMember(entry))
    ?? `absent: the operator slots page carries no \`governance\` block for ${slot} (the entry is ${JSON.stringify(entry ?? null).slice(0, 200)})`;
};

/** Zero, reported as zero (R86(b)), for a slot that refused nothing and filled every position. */
const NO_OCCURRENCES: GovernanceCounts = { refusedPinCount: 0, refusedPins: [], shortTakeCount: 0, shortTakePositions: 0 };

/**
 * Every governance assertion in this file goes through here, so that EVERY
 * block — including a zero report — is judged on its counts AND on the horizon
 * it states (R94(d)): `since` must be present and at or before the page load
 * whose occurrences it reports.
 */
function expectGovernance(actual: SlotGovernance | string, expected: GovernanceCounts, at: number, label: string): void {
  expect(typeof actual === 'string' ? actual
    : { refusedPinCount: actual.refusedPinCount, refusedPins: actual.refusedPins,
        shortTakeCount: actual.shortTakeCount, shortTakePositions: actual.shortTakePositions }, label).toEqual(expected);
  expect(typeof actual === 'string' ? actual : Number.isSafeInteger(actual.since) && actual.since > 0 && actual.since <= at,
    `${label} \u2014 and states the horizon it counts from, present and at or before this page load`).toBe(true);
}

// ---------------------------------------------------------------------------
// A shopper on the mounted application.
// ---------------------------------------------------------------------------

interface Snapshot {
  status: number;
  arm: string;
  served: string[];
  pinDiagnostics?: PinDiagnostic[];
  /** RULED, ABSENT TODAY (R21): the bound on the runtime member (R89(a)). */
  refusedCount?: number;
  omittedCount?: number;
}

/** One served position as the SDK receives it, with the capability it renders under. */
interface ServedDecision { slot: string; contentId: string; decisionId?: string; renderOffer?: string }

interface Shopper {
  visitorId: string;
  action: (event: { type: string; data: Record<string, unknown> }) => Promise<number>;
  snapshot: () => Promise<Snapshot>;
  /**
   * The page load a browser actually makes when it will acknowledge what it
   * painted: `POST /v1/:tenant/decisions/snapshot` with a page instance, whose
   * answer carries a render offer per `rendered-v1` position
   * (`src/content/service.ts:469-472`). Driven exactly as
   * `src/routes/realtime.sdkContract.test.ts:333-339` drives it.
   */
  renderedPage: () => Promise<{ status: number; pageInstance: string; decisions: ServedDecision[] }>;
  /** The impression the SDK sends back, which is what captures the decision record. */
  acknowledge: (pageInstance: string, decision: ServedDecision, position: number) => Promise<{ status: number; text: string }>;
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
      arm?: string; decisions?: Array<{ slot?: string; contentId?: string }>;
      pinDiagnostics?: PinDiagnostic[]; refusedCount?: number; omittedCount?: number;
    };
    await m.drain();
    return {
      status: response.status, arm: body.arm ?? '?',
      served: (body.decisions ?? []).map(d => `${d.slot ?? '?'}:${d.contentId ?? '?'}`),
      pinDiagnostics: body.pinDiagnostics, refusedCount: body.refusedCount, omittedCount: body.omittedCount,
    };
  };
  const renderedPage = async () => {
    invalidatePublicationCache();
    const pageInstance = crypto.randomUUID();
    const response = await call(`/v1/${TENANT}/decisions/snapshot`, { page: 'home', pageInstance });
    const body = await response.clone().json().catch(() => ({})) as { decisions?: ServedDecision[] };
    await m.drain();
    return { status: response.status, pageInstance, decisions: body.decisions ?? [] };
  };
  const acknowledge = async (pageInstance: string, decision: ServedDecision, position: number) => {
    const response = await call('/realtime/action', {
      type: 'content_impression', source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(),
      data: { contentId: decision.contentId, decisionId: decision.decisionId, renderOffer: decision.renderOffer,
        page: 'home', pageInstance, slot: decision.slot, position },
    });
    const text = await response.clone().text().catch(() => '');
    await m.drain();
    return { status: response.status, text };
  };
  return { visitorId: grant.subject, action, snapshot, renderedPage, acknowledge };
}

const HOSTS = ['session', 'do'] as const;

/** A fixed platform clock, so `since` and the counts are measured against a known instant. */
function fixedClock(at = T0) {
  const value = { now: at };
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => value.now);
  return { value, set: (ms: number) => { value.now = ms; }, restore: () => spy.mockRestore() };
}

// ===========================================================================
// The fixtures the occurrences are driven from.
// ===========================================================================

/**
 * The band whose second required position went out of stock — F28 §5.4's own
 * case. The whole slot is refused (kit 03 :218), so it writes no record and has
 * no receipt: the operator signal is its only home.
 */
const DEAD_PIN_PAGE = authorable({
  home: [
    { slot: 'feature', take: 2, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-hero-tabby', 'cnt-sold-out'] },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS },
  ],
});

/**
 * A pinned slot that SERVES and still falls short: `promo` takes three, pins one
 * and has exactly one other eligible piece, so one position is left empty. It
 * writes records, so it has a receipt as well as the operator signal.
 */
const SHORT_TAKE_PAGE = authorable({
  home: [
    { slot: 'promo', take: 3, weights: { line: 1 }, pinnedPieceIds: ['cnt-promo-film'] },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS },
  ],
});

/** What each page serves, so the occurrence is anchored to a known served page. */
const DEAD_PIN_SERVED = ['story:cnt-hero-tabby'];
const SHORT_TAKE_SERVED = ['promo:cnt-promo-film', 'promo:cnt-promo-edit', 'story:cnt-hero-tabby'];

// ===========================================================================
// unit:W20.G2.01 — a dead pin is visible to an operator
// ===========================================================================

describe('unit:W20.G2.01', () => {
  it('host: after a snapshot serves a page whose pinned slot was refused, the operator slots page reports that slot’s refusal with its reason and pinned piece id since a stated horizon, reports zero for the slot that refused nothing, and counts the occurrence on the default arm exactly as on the personalized arm, on both hosts', async () => {
    for (const host of HOSTS) {
      for (const [armName, holdoutShare, expectedArm] of [['personalized', 0, 'personalized'], ['default', 1, 'default']] as const) {
        const clock = fixedClock();
        try {
          const m = await mount(host);
          await publishFixture(m, DEAD_PIN_PAGE, { holdoutShare });

          // Nothing has been served yet: the operator page already reports zero
          // rather than omitting the slot's counts (R86(b), "never silent").
          const before = await slotsPage(m);
          expect(before.status, `${host}/${armName}: the operator slots page answers`).toBe(200);
          expectGovernance(governanceOf(before.bySlot, 'feature'), NO_OCCURRENCES, T0,
            `${host}/${armName}: W20.G2.01 — before anything is served the operator page reports zero occurrences for the pinned slot`);

          // One real page load on the mounted route production serves.
          const shopper = await shopperOn(m);
          clock.set(T0 + 60_000);
          const snapshot = await shopper.snapshot();
          expect(snapshot.status, `${host}/${armName}: the mounted snapshot answers`).toBe(200);
          expect(snapshot.arm, `${host}/${armName}: the shopper is on the arm this fixture publishes`).toBe(expectedArm);
          expect(snapshot.served,
            `${host}/${armName}: the refused band is handed to the site default and the rest of the page is served`).toEqual(DEAD_PIN_SERVED);
          expect(snapshot.pinDiagnostics,
            `${host}/${armName}: the shopper answer names the refusal, as W20-B1 shipped it`)
            .toEqual([{ slot: 'feature', pinnedPieceId: 'cnt-sold-out', pinIndex: 1, reason: 'missing_or_ineligible' }]);

          // THE UNIT: an operator reading the slots page now sees it.
          const after = await slotsPage(m);
          expect(after.status, `${host}/${armName}: the operator slots page answers`).toBe(200);
          expectGovernance(governanceOf(after.bySlot, 'feature'), {
            refusedPinCount: 1,
            refusedPins: [{ pinnedPieceId: 'cnt-sold-out', reason: 'missing_or_ineligible', count: 1 }],
            shortTakeCount: 0,
            shortTakePositions: 0,
          }, T0 + 60_000,
            `${host}/${armName}: W20.G2.01 — the operator slots page must report the refusal for this tenant and slot, with the reason the composer recorded and the pinned piece id (ruled member: \`governance\` on the \`SlotIndexEntry\` of GET /v1/:tenant/learn/slots?evidence=1)`);

          // The slot that refused nothing reports zero, not nothing.
          expectGovernance(governanceOf(after.bySlot, 'story'), NO_OCCURRENCES, T0 + 60_000,
            `${host}/${armName}: W20.G2.01 — a slot that refused nothing reports zero occurrences, never an omitted block`);

          // R94(d): these are DISTINCT OCCURRENCES, not a flag. A second
          // identical page load refuses the same pin again, and the count moves.
          clock.set(T0 + 120_000);
          const again = await shopper.snapshot();
          expect(again.served, `${host}/${armName}: the second page load serves the same page`).toEqual(DEAD_PIN_SERVED);
          const twice = await slotsPage(m);
          expectGovernance(governanceOf(twice.bySlot, 'feature'), {
            refusedPinCount: 2,
            refusedPins: [{ pinnedPieceId: 'cnt-sold-out', reason: 'missing_or_ineligible', count: 2 }],
            shortTakeCount: 0,
            shortTakePositions: 0,
          }, T0 + 120_000,
            `${host}/${armName}: W20.G2.01 — a second identical page load is a second occurrence, so the counts move; a boolean or a last-seen marker cannot satisfy this`);
        } finally { clock.restore(); }
      }
    }
  }, 120_000);
});

// ===========================================================================
// unit:W20.G2.02 — a pinned slot that could not fill `take` is visible
// ===========================================================================

describe('unit:W20.G2.02', () => {
  it('host: a pinned slot that serves fewer pieces than its take reports the shortfall and the positions left empty on the same operator surface, while a slot that fills reports zero, on both hosts', async () => {
    for (const host of HOSTS) {
      const clock = fixedClock();
      try {
        const m = await mount(host);
        await publishFixture(m, SHORT_TAKE_PAGE);
        const shopper = await shopperOn(m);
        clock.set(T0 + 60_000);
        const snapshot = await shopper.snapshot();
        expect(snapshot.status, `${host}: the mounted snapshot answers`).toBe(200);
        // W20.G1.06's contract: the slot serves what it has and pads nothing.
        expect(snapshot.served,
          `${host}: the pinned slot serves its pin and the one other eligible piece, leaving the third position to the site default`)
          .toEqual(SHORT_TAKE_SERVED);

        const after = await slotsPage(m);
        expect(after.status, `${host}: the operator slots page answers`).toBe(200);
        expectGovernance(governanceOf(after.bySlot, 'promo'),
          { refusedPinCount: 0, refusedPins: [], shortTakeCount: 1, shortTakePositions: 1 }, T0 + 60_000,
          `${host}: W20.G2.02 — the operator slots page must report that this pinned slot could not fill its take, and how many positions were left empty (ruled members: \`governance.shortTakeCount\` and \`governance.shortTakePositions\`)`);

        expectGovernance(governanceOf(after.bySlot, 'story'), NO_OCCURRENCES, T0 + 60_000,
          `${host}: W20.G2.02 — the slot that filled every position it takes reports zero, not an omitted block`);

        // R94(d): a second identical page load falls short again, and both the
        // occurrence count and the empty-position count move.
        clock.set(T0 + 120_000);
        expect((await shopper.snapshot()).served, `${host}: the second page load serves the same page`).toEqual(SHORT_TAKE_SERVED);
        expectGovernance(governanceOf((await slotsPage(m)).bySlot, 'promo'),
          { refusedPinCount: 0, refusedPins: [], shortTakeCount: 2, shortTakePositions: 2 }, T0 + 120_000,
          `${host}: W20.G2.02 — a second shortfall is a second occurrence, and the positions left empty accumulate with it`);
      } finally { clock.restore(); }
    }
  }, 120_000);
});

// ===========================================================================
// unit:W20.G2.03 — the receipt note, where a record exists
// ===========================================================================

/**
 * RULED, ABSENT TODAY (R21): the shortfall block on the decision record's
 * explain, read off the engine's own `DecisionRecord` (`src/content/types.ts`),
 * so the compiler names it as missing: the third of this batch's three ruled
 * errors.
 */
interface ShortTakeBlock { take: number; served: number; empty: number; sentence: string }
const shortTakeMember = (record: DecisionRecord): ShortTakeBlock | undefined => record.explain.shortTake;

describe('unit:W20.G2.03', () => {
  // Driven on the `do` host only: the record, the ring and the receipt are host
  // independent (the ring is its own durable object, `src/learn/fan.ts:339`),
  // and the session host is named as unmeasured in this unit's row.
  it('host: the receipt of a decision served by a pinned slot that fell short of its take names the shortfall, and the refused slot that wrote no record has no receipt at all', async () => {
    const clock = fixedClock();
    try {
      // The slot measures what the page actually rendered, so the browser's own
      // acknowledgement is what captures the decision record and fills the
      // shopper's ring — the path a receipt exists on at all
      // (`src/content/service.ts:456-472`, `src/routes/realtime.ts:178-183`).
      const m = await mount('do', { renderAdmission: true });
      await publishFixture(m, SHORT_TAKE_PAGE, { learnSlots: { promo: { measurementBasis: 'rendered-v1' } } });
      const shopper = await shopperOn(m);
      clock.set(T0 + 60_000);
      const page = await shopper.renderedPage();
      expect(page.status, 'the mounted snapshot answers').toBe(200);
      expect(page.decisions.map(d => `${d.slot}:${d.contentId}`),
        'the pinned slot served two of its three positions').toEqual(SHORT_TAKE_SERVED);
      const rendered = page.decisions.filter(d => d.slot === 'promo');
      expect(rendered.every(d => typeof d.renderOffer === 'string' && d.renderOffer.length > 0),
        'each position of the rendered-v1 slot carries the render offer the SDK acknowledges').toBe(true);
      for (const [position, decision] of rendered.entries()) {
        // PRECONDITION, NOT THE UNIT'S OUTCOME: a decision record only exists
        // once the browser acknowledges what it painted, so this fixture has to
        // get an impression accepted before there is any receipt to judge. If
        // this line is what fails, the batch has a harness gap, NOT the product
        // gap this unit is about — see the unit's row in units.json.
        const ack = await shopper.acknowledge(page.pageInstance, decision, position);
        expect(ack.status,
          `PRECONDITION: the browser's acknowledgement of position ${position} must be accepted before a receipt exists to carry the shortfall \u2014 ${ack.text.slice(0, 400)}`).toBe(200);
      }
      await m.drain();

      // The operator's own read of what this shopper was served.
      const recent = await operatorGet(m, `/v1/${TENANT}/visitors/${shopper.visitorId}/recent`);
      expect(recent.status, `the operator recent-decisions read answers: ${JSON.stringify(recent.body).slice(0, 300)}`).toBe(200);
      const ring = (recent.body.ring as DecisionRecord[] | undefined) ?? [];
      const promoRows = ring.filter(row => row.slot === 'promo').sort((a, b) => a.position - b.position);
      expect(promoRows.map(row => row.position),
        'the pinned slot wrote a record for each position it served').toEqual([0, 1]);
      const block = promoRows[0] ? shortTakeMember(promoRows[0]) : undefined;
      expect(block ? { take: block.take, served: block.served, empty: block.empty } : block,
        'W20.G2.03 — the decision record of a slot that fell short of its take carries the shortfall (ruled member: `explain.shortTake`, in the shape every other rule block on `explain` has: numbers and a sentence)')
        .toEqual({ take: 3, served: 2, empty: 1 });
      expect(typeof block?.sentence === 'string' && block.sentence.trim().length > 0,
        'W20.G2.03 — and says it in a sentence, as every other block on `explain` does').toBe(true);

      // …and the receipt reads that sentence out, the way it reads out every
      // other block (`src/learn/receipts.ts:70-74`).
      const receipts = await operatorGet(m, `/v1/${TENANT}/visitors/${shopper.visitorId}/receipts`);
      expect(receipts.status, `the operator receipts page answers: ${JSON.stringify(receipts.body).slice(0, 300)}`).toBe(200);
      const rows = (receipts.body.receipts as Array<{ slot: string; position: number; why: string[] }> | undefined) ?? [];
      const promoReceipt = rows.filter(row => row.slot === 'promo').sort((a, b) => a.position - b.position)[0];
      expect(promoReceipt, 'the shopper has a receipt for the pinned slot').toBeTruthy();
      const sentence = block?.sentence;
      expect(promoReceipt!.why.some(line => typeof sentence === 'string' && sentence.length > 0 && line.includes(sentence)),
        'W20.G2.03 — and the receipt names the shortfall in the record’s own sentence, as it does for stage, freshness, fatigue, merchandising and diversity').toBe(true);

      // The other half of R86(c): a refused slot writes no record, so it has no
      // receipt, and the operator signal of W20.G2.01 is its only home. Driven
      // the same way, so the comparison is like for like.
      const dead = await mount('do', { renderAdmission: true });
      await publishFixture(dead, DEAD_PIN_PAGE, { learnSlots: { feature: { measurementBasis: 'rendered-v1' }, story: { measurementBasis: 'rendered-v1' } } });
      const deadShopper = await shopperOn(dead);
      clock.set(T0 + 120_000);
      const deadPage = await deadShopper.renderedPage();
      expect(deadPage.decisions.map(d => `${d.slot}:${d.contentId}`), 'the refused band serves nothing').toEqual(DEAD_PIN_SERVED);
      for (const [position, decision] of deadPage.decisions.entries()) {
        expect((await deadShopper.acknowledge(deadPage.pageInstance, decision, position)).status,
          'the browser acknowledges what it actually painted').toBe(200);
      }
      await dead.drain();
      const deadRecent = await operatorGet(dead, `/v1/${TENANT}/visitors/${deadShopper.visitorId}/recent`);
      expect(deadRecent.status, 'the operator recent-decisions read answers').toBe(200);
      expect(((deadRecent.body.ring as DecisionRecord[] | undefined) ?? []).map(row => row.slot),
        'W20.G2.03 — the refused slot wrote no record, so the only slot with a receipt is the one that served')
        .toEqual(['story']);
    } finally { clock.restore(); }
  }, 120_000);
});

// ===========================================================================
// unit:W20.G2.04 — the ops monitor's own counter
// ===========================================================================

/**
 * RULED, ABSENT TODAY (R21): the tenant-level governance counters on the monitor
 * result, in ONE vocabulary with the slots page (R94(c)) — the same two count
 * names; only the slots page carries the per-pin `refusedPins` detail.
 * Read off the engine's own `MonitorResult` (`src/ops/monitor.ts:175`), so the
 * compiler names it as missing: the second of this batch's three ruled errors.
 */
interface MonitorGovernance { since: number; refusedPinCount: number; shortTakeCount: number }
const monitorGovernanceMember = (result: MonitorResult): MonitorGovernance | undefined => result.governance;

describe('unit:W20.G2.04', () => {
  it('host: the ops monitor reports, per tenant, how many refused pins and short pinned slots the tenant served, counts a second occurrence as a second occurrence, reads zero on a tenant that produced none, and never counts its own synthetic probe', async () => {
    const clock = fixedClock();
    /** The monitor's counters, or a sentence naming the member as absent. */
    const monitorGovernance = (body: Record<string, unknown>): MonitorGovernance | string =>
      monitorGovernanceMember(body.result as MonitorResult)
        ?? `absent: the monitor result carries no \`governance\` member (it carries ${Object.keys((body.result ?? {}) as object).join(', ')})`;
    const expectMonitor = (actual: MonitorGovernance | string, counts: { refusedPinCount: number; shortTakeCount: number }, at: number, label: string) => {
      expect(typeof actual === 'string' ? actual : { refusedPinCount: actual.refusedPinCount, shortTakeCount: actual.shortTakeCount }, label).toEqual(counts);
      expect(typeof actual === 'string' ? actual : Number.isSafeInteger(actual.since) && actual.since > 0 && actual.since <= at,
        `${label} \u2014 and states the horizon it counts from, present and at or before this run`).toBe(true);
    };
    try {
      // A tenant that has served nothing. Its monitor run STILL composes the
      // same page as a synthetic visitor (`src/ops/monitor.ts:317-320`, a probe
      // on `home` with `visitorId: monitor-…`), and this page's pinned slot
      // falls short — so a counter written at the decision path would read one
      // here. R94(b): the monitor's own synthetic compose is NEVER counted.
      const clean = await mount('session');
      await publishFixture(clean, SHORT_TAKE_PAGE);
      const quiet = await operatorPost(clean, `/v1/${TENANT}/monitor`);
      expect(quiet.status, `the monitor run answers: ${JSON.stringify(quiet.body).slice(0, 300)}`).toBe(200);
      expectMonitor(monitorGovernance(quiet.body), { refusedPinCount: 0, shortTakeCount: 0 }, T0,
        'W20.G2.04 — the monitor result must carry the tenant’s governance counters (ruled member: `MonitorResult.governance`, carried by the safe projection `projectMonitor`), reading zero on a tenant whose only compose was the monitor’s own probe');
      expectGovernance(governanceOf((await slotsPage(clean)).bySlot, 'promo'), NO_OCCURRENCES, T0,
        'W20.G2.04 — and the operator slots page is untouched by the probe too: the monitor’s synthetic compose is nobody’s occurrence');

      // A tenant that served a refused pin through the real shopper path.
      const busy = await mount('session');
      await publishFixture(busy, DEAD_PIN_PAGE);
      const shopper = await shopperOn(busy);
      clock.set(T0 + 60_000);
      expect((await shopper.snapshot()).served, 'the refused band is handed to the site default').toEqual(DEAD_PIN_SERVED);
      const run = await operatorPost(busy, `/v1/${TENANT}/monitor`);
      expect(run.status, `the monitor run answers: ${JSON.stringify(run.body).slice(0, 300)}`).toBe(200);
      expectMonitor(monitorGovernance(run.body), { refusedPinCount: 1, shortTakeCount: 0 }, T0 + 60_000,
        'W20.G2.04 — after a page load whose pinned slot was refused, the monitor reports exactly that one occurrence for the tenant: the probe it just ran on the same page is not counted beside it');
      expectGovernance(governanceOf((await slotsPage(busy)).bySlot, 'feature'), {
        refusedPinCount: 1,
        refusedPins: [{ pinnedPieceId: 'cnt-sold-out', reason: 'missing_or_ineligible', count: 1 }],
        shortTakeCount: 0, shortTakePositions: 0,
      }, T0 + 60_000,
        'W20.G2.04 — and the per-slot counts a monitor run leaves behind are the shopper’s one occurrence, not two');

      // R94(d): a second real page load is a second occurrence, and a second
      // monitor run still adds nothing of its own.
      clock.set(T0 + 120_000);
      expect((await shopper.snapshot()).served, 'the second page load serves the same page').toEqual(DEAD_PIN_SERVED);
      const second = await operatorPost(busy, `/v1/${TENANT}/monitor`);
      expect(second.status, `the second monitor run answers: ${JSON.stringify(second.body).slice(0, 300)}`).toBe(200);
      expectMonitor(monitorGovernance(second.body), { refusedPinCount: 2, shortTakeCount: 0 }, T0 + 120_000,
        'W20.G2.04 — two real page loads are two occurrences, and two monitor probes on the same page add nothing to them');
    } finally { clock.restore(); }
  }, 120_000);
});

// ===========================================================================
// unit:W20.G2.05 — the advisory read of a retained revision
// ===========================================================================

/**
 * A revision published before the write-time check existed: its `feature` slot
 * pins a piece the same slot excludes by id. Kit 03 :192 makes that
 * contradictory, and W20.G1.02 refuses it at write; a STORED revision that
 * predates the check still parses (`parseSlotCatalog` runs no cross-slot pass),
 * and its advisory read must say so rather than refuse.
 */
const RETAINED_EXCLUDED_PIN = retained({
  home: [
    { slot: 'feature', take: 1, weights: FEATURE_WEIGHTS,
      pinnedPieceIds: ['cnt-hero-tabby'], excludedPieceIds: ['cnt-hero-tabby'] },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS },
  ],
});

describe('unit:W20.G2.05', () => {
  // Driven on the `session` host only: this leg reads and writes DOCUMENTS
  // through the content routes, which no shopper host takes part in; the `do`
  // host is named as unmeasured in this unit's row.
  it('host: a retained revision carrying an active id-excluded pin is read back with the pin named under the existing `excluded` reason and is never refused, while the same document is refused by the write path', async () => {
    const m = await mount();
    await publishFixture(m, RETAINED_EXCLUDED_PIN, { retainedSlots: true });

    // The advisory read: never a refusal, and the pin is named.
    const read = await operatorGet(m, `/content/slots?scope=${TENANT}`);
    expect(read.status, `W20.G2.05 — reading a retained revision must never fail: ${JSON.stringify(read.body).slice(0, 300)}`).toBe(200);
    expect((read.body.document as SlotCatalog).pages.home!.map(slot => [slot.slot, slot.pinnedPieceIds ?? null, slot.excludedPieceIds ?? null]),
      'W20.G2.05 — the retained revision is read back exactly as it was stored, never rewritten')
      .toEqual([['feature', ['cnt-hero-tabby'], ['cnt-hero-tabby']], ['story', null, null]]);
    const report = read.body.pinDiagnostics as { schema?: string; advisory?: boolean; status?: string; warnings?: Array<Record<string, unknown>> };
    expect([report.schema, report.advisory, report.status],
      'W20.G2.05 — the read answers on the advisory pin channel').toEqual(['slot-pin-diagnostics/v1', true, 'available']);
    expect(report.warnings,
      'W20.G2.05 — and names the retained active id-excluded pin under the reason the channel already has for it')
      .toEqual([{ pageIndex: 0, slotIndex: 0, pinIndex: 0, reason: 'excluded' }]);

    // One representation with W20.G1.02: the same document cannot be written.
    const base = { revision: read.body.revision as number, publication: read.body.publication as { revision: number; digest: string } };
    const written = await m.fetch(new Request(`${OPERATOR_ORIGIN}/content/slots?scope=${TENANT}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json',
        'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`,
        'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ document: read.body.document, note: 'rewrite the retained revision' }),
    }));
    expect(written.status, 'W20.G2.05 — the write path still refuses the contradiction the read tolerates').toBe(422);
    const errors = ((await written.json().catch(() => ({}))) as { errors?: string[] }).errors ?? [];
    expect(errors.join(' '), 'W20.G2.05 — naming the page and the slot the operator must fix').toContain('pages.home');
    expect(errors.join(' '), 'W20.G2.05 — and the slot itself').toContain('feature');
  }, 60_000);
});

// ===========================================================================
// unit:W20.G2.06 — the runtime member is bounded (R89(a))
// ===========================================================================

/** A pin id an operator may author (kit 03 :213 sets no length limit on a prefix member). */
const longPinId = (index: number) => `cnt-pathological-${String(index).padStart(6, '0')}-${'x'.repeat(60)}`;

/**
 * A document an operator could author TODAY, within every published bound: 300
 * slots, each taking 50 and pinning 50 pieces that are not in the catalogue.
 * The document itself is about 1.3 MB, inside the platform's own 2 MiB
 * publication cap (`src/config/publication.ts:56-59`), but every one of its
 * 15 000 pins refuses, so an unbounded runtime member would carry 15 000
 * entries of about 160 bytes — over the answer's 2 MB guard
 * (`src/routes/decisions.ts:498-501`), which turns a served snapshot into a 503
 * for a shopper (the W20-B1 build review's finding 2, R89(a)).
 */
const PATHOLOGICAL_SLOTS = 300;
const PATHOLOGICAL_PAGE = authorable({
  home: Array.from({ length: PATHOLOGICAL_SLOTS }, (_, slotIndex) => ({
    slot: `band-${String(slotIndex).padStart(3, '0')}`,
    take: 50,
    weights: { line: 1 },
    pinnedPieceIds: Array.from({ length: 50 }, (_, pinIndex) => longPinId(slotIndex * 50 + pinIndex)),
  })),
});

const PATHOLOGICAL_REFUSALS = PATHOLOGICAL_SLOTS * 50;
/** The cap the advisory channel already uses for its sample (`src/content/slotDiagnostics.ts:41`). */
const DIAGNOSTIC_SAMPLE_CAP = 50;

describe('unit:W20.G2.06', () => {
  it('host: a page whose slots refuse more pins than the sample cap is still served, with the runtime member bounded to the cap in slot order and the totals named, on both hosts', async () => {
    for (const host of HOSTS) {
      const clock = fixedClock();
      try {
        const m = await mount(host);
        await publishFixture(m, PATHOLOGICAL_PAGE);
        const shopper = await shopperOn(m);
        clock.set(T0 + 60_000);
        const snapshot = await shopper.snapshot();
        expect(snapshot.status,
          `${host}: W20.G2.06 — an operator-authored document may never turn a served snapshot into a failure through the answer’s own size guard`).toBe(200);
        expect(snapshot.served,
          `${host}: every slot of this page refused its required prefix, so the whole page is handed to the site’s own defaults`).toEqual([]);
        expect(snapshot.pinDiagnostics?.length,
          `${host}: W20.G2.06 — the runtime member is bounded to the cap the advisory channel already uses for its sample`)
          .toBe(DIAGNOSTIC_SAMPLE_CAP);
        expect(snapshot.pinDiagnostics?.slice(0, 2),
          `${host}: W20.G2.06 — and the sample is the first entries in slot order, not an arbitrary selection`)
          .toEqual([
            { slot: 'band-000', pinnedPieceId: longPinId(0), pinIndex: 0, reason: 'missing_or_ineligible' },
            { slot: 'band-000', pinnedPieceId: longPinId(1), pinIndex: 1, reason: 'missing_or_ineligible' },
          ]);
        expect([snapshot.refusedCount, snapshot.omittedCount],
          `${host}: W20.G2.06 — the answer names how many pins were refused in all and how many the sample left out (ruled members: \`refusedCount\` and \`omittedCount\`, the count/omitted-count pattern the advisory channel already uses)`)
          .toEqual([PATHOLOGICAL_REFUSALS, PATHOLOGICAL_REFUSALS - DIAGNOSTIC_SAMPLE_CAP]);
      } finally { clock.restore(); }
    }
  }, 180_000);
});

// ===========================================================================
// unit:W20.G2.07 — `ownerSlot` is documented as the engine attaches it (R89(b))
// ===========================================================================

/**
 * A retained revision in which an earlier slot owns the piece and a later slot
 * both pins it and forbids it by tag: the gate decides the reason
 * (`excluded_tag`), and `ownerSlot` is attached because another slot already
 * owns the piece (`src/reflex/contentCompose.ts:191-196`). The write path
 * refuses the document for page ownership, so a retained revision is the only
 * way it reaches the engine — the same helper W20-B1 used.
 */
const OWNED_AND_EXCLUDED = retained({
  home: [
    { slot: 'feature', take: 1, weights: FEATURE_WEIGHTS, pinnedPieceIds: ['cnt-hero-tabby'] },
    { slot: 'story', take: 1, weights: FEATURE_WEIGHTS,
      excludedTags: [{ dimension: 'occasion', value: 'evening' }], pinnedPieceIds: ['cnt-hero-tabby'] },
  ],
});

/**
 * The sentence both shipped paragraphs must carry. Today each says `ownerSlot`
 * "names the slot that already holds the piece on a `duplicate_pin`", which is
 * false: the composer attaches it whenever another slot already owns the piece,
 * whatever reason the gates decided (`contentCompose.ts:195-196`).
 */
const OWNER_SLOT_SENTENCE = '`ownerSlot` names the slot that already holds the piece, on any refusal reason and not only `duplicate_pin`';
const OWNER_SLOT_NARROW = '`ownerSlot` names the slot that already holds the piece on a `duplicate_pin`';
const DOC_PARAGRAPHS = ['docs/kit/02-api-reference.md', 'docs/api/01-rest-endpoints.md'] as const;
const doc = (file: string): string => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');

describe('unit:W20.G2.07', () => {
  // Driven on the `session` host only, and on the personalized arm: the refusal
  // and its `ownerSlot` are governance, which W20.G1.08 measured to be
  // arm-independent on both hosts; both are named as unmeasured in the row.
  it('host: a pin refused for a reason other than `duplicate_pin` still names the slot that already owns the piece, and both shipped paragraphs say so', async () => {
    const clock = fixedClock();
    try {
      const m = await mount();
      await publishFixture(m, OWNED_AND_EXCLUDED, { retainedSlots: true });
      const shopper = await shopperOn(m);
      clock.set(T0 + 60_000);
      const snapshot = await shopper.snapshot();
      expect(snapshot.status, 'the mounted snapshot answers').toBe(200);
      expect(snapshot.served, 'the owning slot serves the piece and the refused slot is handed to the site default')
        .toEqual(['feature:cnt-hero-tabby']);
      expect(snapshot.pinDiagnostics,
        'W20.G2.07 — a refusal decided by a tag gate still names the slot that already owns the piece')
        .toEqual([{ slot: 'story', pinnedPieceId: 'cnt-hero-tabby', pinIndex: 0, reason: 'excluded_tag', ownerSlot: 'feature' }]);

      for (const file of DOC_PARAGRAPHS) {
        const text = doc(file);
        expect(text.includes(OWNER_SLOT_SENTENCE.replace(/\s+/g, ' ')),
          `W20.G2.07 — ${file} must say what the engine does: "${OWNER_SLOT_SENTENCE}"`).toBe(true);
        expect(text.includes(OWNER_SLOT_NARROW.replace(/\s+/g, ' ')),
          `W20.G2.07 — and ${file} must no longer restrict it to \`duplicate_pin\`, which the engine does not do`).toBe(false);
      }
    } finally { clock.restore(); }
  }, 60_000);
});
