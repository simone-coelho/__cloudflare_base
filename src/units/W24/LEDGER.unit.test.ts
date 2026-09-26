// src/units/W24/LEDGER.unit.test.ts
// W24 under the Closure Ledger (program.json ticket W24, frozen 2026-09-24).
//
// G1, T1 and R1 are proven by the existing `unit:W24.G1.*`, `unit:W24.T1.*` and
// `unit:W24.R1.*` blocks of `B1.unit.test.ts` and `B2.unit.test.ts` in this
// directory (18 tests, green at base 4fbdddc); LG1 is proven by the acceptance
// command's second half (every `W24.` test of `src/content/consent.test.ts` and
// `src/learn/learn.test.ts`, 2 tests, green at base). LV1–LV3 are deferred live
// records; D1 (the money-policy VALUES) stays deferred to LIVE2 and nothing here
// invents one. This file specifies the remaining-work criteria R2–R5, one
// `describe('unit:W24.<criterion id>')` each.
//
// WITNESSES
//   · document 35 §5 row W24 (:426), quoted by the work order: "Define reward
//     filter, revenue/margin/currency/refund behavior and denominator
//     transitions; test old callers and partial deployment."
//   · LANE-LOG R203 (W24-B2 merged at 55d2366): "Routed to a later W24
//     kit/receipt unit: `money_policy_unset` stated nowhere a customer reads (the
//     fail-closed consequence of an unpublished policy — every money-objective
//     slot refuses in practice); `reportLearningIncomplete` not carrying
//     `refused`/`refusedBySlot`; a reply with `refused` but no `refusedBySlot`
//     admitted (the ring never emits it); money named before reward on a
//     doubly-refused slot (coarser name, no credit lost — spec-compelled)."
//   · `_evidence/W24-B2/reviewer-build/REPORT.md` findings 1–4: (1)
//     "`fan.ts:344-345` validates `refused === Object.keys(refusedBySlot).length`
//     only when `refusedBySlot` is present; a reply carrying `refused: 3` with no
//     `refusedBySlot` is admitted"; (2) "Money is tested before reward
//     (`DecisionRing.ts:550` before `:559`), so a slot that is both
//     reward-mismatched and money-objective is named `money`, not `reward`.
//     Spec-compelled by R195 3b / `B1.unit.test.ts:903`"; (3)
//     "`reportLearningIncomplete` (`fan.ts:392-394`) carries
//     `attributed/eligible/weightSkipped` but not `refused`/`refusedBySlot`, so the
//     operator's diagnostic line does not show the refusal the receipt does"; (4)
//     "`money_policy_unset` appears nowhere in `docs/kit/**`".
//   · The product's own reply contract (`src/learn/fan.ts`, `outcomeReply`):
//     "`refused` IS the number of entries in `refusedBySlot`, so a reply cannot
//     claim a count its own named refusals do not carry", and "a refusal the
//     caller cannot read is a malformed reply, never a silent credit"; a
//     malformed ring reply is counted `ring.unknown` with no outcome receipt, as
//     `src/learn/holdoutArms.test.ts:293-299` locks for every other malformed
//     member.
//
// ONE REPRESENTATION, the one W24-B1/B2 delivered (`OutcomeReceipt`):
// `refusedBySlot?: Record<slot, 'reward' | 'money'>` and `refused?: number`
// (its entry count), carried together; `notCredited` only when nothing was
// credited; `money?: { code?, reason: 'money_policy_unset' }`. The ring emits
// `refused` and `refusedBySlot` together or not at all (`DecisionRing.ts`), so
// R4's refusal of the inconsistent shape never touches a reply the ring sends.
//
// SEAMS. W22 owns the credited journal; W23 owns `outsideWindow`; W26 owns
// `brandMismatched`. W30 (unmerged build `rem/w30-b1-build` at 1c4d153) edits
// `docs/kit/02-api-reference.md` and `docs/kit/03-payload-schemas.md` in other
// paragraphs (report coverage and maturity) — a textual merge overlap with R2
// and R5, no shared clause. W23's R3 edits the same two kit files (its own
// members); no clause here reads those.

import { readFileSync } from 'node:fs';

import { afterEach, describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { fanDecisions, fanOutcome, statsName, type LearningReceipt } from '@/learn/fan';
import { DEFAULT_POLICY } from '@/learn/policy';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { DEFAULT_STATS } from '@/learn/stats';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture (docs/architecture/tapestry_requirements.txt A.3.6),
// the pieces, cells and slots W24-B1/B2 use, with the unknown-cell and
// cross-category rows.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const OPERATOR_SECRET = 'w24-ledger-synthetic-operator-signing-material';
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Online fixtures sit two hours ago: inside the ring's seven-day reach, and every window below. */
const ONLINE_TS = Date.now() - 2 * HOUR;

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});
const PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening', { title: 'Tabby, after six',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-rogue-work', { title: 'The Rogue, at work',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-charms-slg', { title: 'Charms, across the case', type: 'lookbook',
    tags: { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'] } }),
];
const SLOT_CATALOG: SlotCatalog = { version: 'w24-ledger-coach-slots',
  pages: { home: [
    { slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
    { slot: 'story', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  ] } };
const COACH_CELL = { channel: 'web', visit_bucket: 'returning', stage: 'consider', region: 'US-NY', affinity: 'evening' };
const UNKNOWN_CELL = { channel: 'web', visit_bucket: 'new', stage: 'unknown', region: 'none', affinity: 'none' };

type SlotSpec = { reward: 'click' | 'purchase' | 'add_to_bag'; objective?: 'unit' | 'revenue' | 'margin' };
const learnWithSlots = (slots: Record<string, SlotSpec>, match: 'direct' | 'any' = 'direct'): LearnConfig => ({
  holdout: { share: 0, salt: 'w24-ledger', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  policy: { scope: 'visitor', match, credit: 'last', windowsMs: { purchase: 7 * DAY, click: 30 * 60_000 } },
  slots,
} as unknown as LearnConfig);
const configOf = (spec: SlotSpec) => ({ reward: spec.reward, stats: DEFAULT_STATS,
  objective: spec.objective ?? 'unit', measurementBasis: 'served-v1' as const });

// ===========================================================================
// The mounted application, in process, with the REAL DecisionRing, LearnStats
// and ShopperReflex classes over storage stubs — the idiom of
// `src/units/W24/B2.unit.test.ts`, which is neither imported nor edited.
// `failStats` names statistics objects that answer 500, the refusal F16 §5(c)
// says a caller must not record as delivered.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}
class UnitR2 {
  objects = new Map<string, string>();
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v1', size: raw.length, body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    if (absent && this.objects.has(key)) return null;
    this.objects.set(key, raw); return { key, etag: 'v1', size: raw.length };
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string } = {}) {
    return { objects: [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort().map(key => ({ key, size: 0, uploaded: new Date(0) })), truncated: false };
  }
}

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w24-ledger-fixture-policy', revision: 1, durationMs: 3650 * DAY, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface DurableRegistry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response> } }
interface Mounted {
  env: Env;
  stats: Map<string, DurableRegistry>;
  failStats: Set<string>;
  fetch: (input: Request) => Promise<Response>;
  drain: () => Promise<void>;
}

async function mount(learn: LearnConfig): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const failStats = new Set<string>();
  const shoppers = new Map<string, DurableRegistry>(), rings = new Map<string, DurableRegistry>(), stats = new Map<string, DurableRegistry>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: new UnitKV(), SESSIONS: new UnitKV(),
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session', STORAGE: new UnitR2(),
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w24-ledger-identity-material`,
    IDENTITY_SALT: 'w24-ledger-synthetic-identity-salt-material',
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    LEDGER_RECOVERY_ENABLED: 'false',
    EVENT_QUEUE: { send: async () => undefined },
  } as unknown as Env;
  env.RETENTION = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });

  const namespaceFor = (make: (state: DurableObjectState, env: Env) => { fetch: (request: Request) => Promise<Response> }, registry: Map<string, DurableRegistry>) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      if (registry === stats && failStats.has(name)) {
        return new Response(JSON.stringify({ ok: false, error: 'synthetic statistics refusal' }), { status: 500 });
      }
      let item = registry.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [];
        const storageStub = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
              .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, entry] of Object.entries(values)) candidate.set(key, structuredClone(entry));
              },
              deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (a: number) => { nextAlarm = a; },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            if (deleteAlarm) alarms.length = 0;
            if (nextAlarm !== undefined) alarms.push(nextAlarm);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
          setAlarm: async (a: number) => { alarms.push(a); }, getAlarm: async () => alarms.at(-1) ?? null,
        };
        const state = { id: name, storage: storageStub, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, object: make(state, env) };
        registry.set(name, item);
      }
      return item.object.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e), shoppers) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), rings) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), stats) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w24-ledger-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { version: 'w24-ledger-coach-catalogue', pieces: PIECES }),
    baseline(SLOTS_KIND, SLOT_CATALOG),
    baseline(LEARN_KIND, learn),
    baseline(PRIORS_KIND, EMPTY_PRIORS),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, stats, failStats, fetch: fetchOne, drain };
}

function decision(env: Env, visitor: string, ts: number, item: string, slot: 'hero' | 'story'): DecisionRecord {
  return {
    decision_id: `${TENANT}:${ts36(ts)}:${visitor}:home:${slot}:0`,
    tenant: TENANT, brand: BRAND, visitor_id: visitor, session_id: `s-${visitor}`, identity_anchor: 'visitor', ts,
    page: 'home', slot, position: 0, item_id: item, customer_item_id: `CMS-${item}`, candidates: [],
    cell: visitor.startsWith('u-') ? UNKNOWN_CELL : COACH_CELL, arm: 'personalized', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w24-ledger',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    retention: captureRetention(env as never, TENANT, ts, ts),
  } as unknown as DecisionRecord;
}
/** Serve one visitor in each named slot, through the real decision fan-out. */
async function served(m: Mounted, slots: Record<string, SlotSpec>, visitor: string, item = 'cnt-tabby-evening'): Promise<void> {
  for (const [slot, spec] of Object.entries(slots)) {
    const d = decision(m.env, visitor, ONLINE_TS, item, slot as 'hero' | 'story');
    const out = await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: visitor, records: [d] }, () => configOf(spec));
    expect(out.ok, `the fixture serves ${visitor} in ${slot}: ${JSON.stringify(out).slice(0, 160)}`).toBe(true);
  }
  await m.drain();
}
const purchaseOf = (m: Mounted, visitor: string, at: number, nonce: string, data: Record<string, unknown> = {}): OutcomeRecord =>
  ({ ...outcomeFromAction({ type: 'purchase', userId: visitor, sessionId: `s-${visitor}`, timestamp: at,
    eventId: nonce, eventIdSource: 'provided', data: { contentId: 'cnt-tabby-evening', value: 495, ...data } } as never, TENANT, BRAND)!,
    retention: captureRetention(m.env as never, TENANT, at, at) } as OutcomeRecord);

/** The checkout this test lives in, never the cwd (role lesson 2026-09-20, W29-B1). */
const ROOT = new URL('../../../', import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, ROOT), 'utf8');
/** A document's reading units: prose paragraphs, and each table row on its own. */
const units = (text: string): string[] => text.split(/\n\s*\n/)
  .flatMap(block => block.trimStart().startsWith('|') ? block.split('\n') : [block]);
const kit = () => [...units(read('docs/kit/02-api-reference.md')), ...units(read('docs/kit/03-payload-schemas.md'))];

afterEach(() => { vi.restoreAllMocks(); });

// ===========================================================================
// unit:W24.R2 — money_policy_unset where a customer reads
// ===========================================================================

describe('unit:W24.R2', () => {
  /**
   * The frozen criterion: "money_policy_unset is stated where a customer reads
   * (LANE-LOG R203)." R203: "the fail-closed consequence of an unpublished
   * policy — every money-objective slot refuses in practice". What the kit must
   * say is what the product does (`moneyRefusal`, `src/learn/fan.ts`): with no
   * money policy published, a slot whose objective is `revenue` or `margin`
   * refuses, by the name `money_policy_unset`, an outcome that declares a
   * currency or carries a value at or below zero; a `unit` slot is never asked.
   * The clause asks for those facts in the unit of text that names the code,
   * never for a wording. The customer's own VALUES (currency, conversion,
   * refund rule) stay W24 D1/LIVE2; nothing here states one.
   */
  it('logic: the kit names money_policy_unset with who is refused, for what, and until what is published', () => {
    const stated = kit().filter(u => u.includes('money_policy_unset'));
    const facts = stated.map(u => ({
      moneyObjective: /\b(revenue|margin)\b/.test(u),
      currency: /currenc/i.test(u),
      nonpositive: /(nonpositive|non-positive|negative|refund|zero|below)/i.test(u),
      untilPublished: /publish/i.test(u),
      refused: /refus/i.test(u),
    }));
    expect(facts.some(f => f.moneyObjective && f.currency && f.nonpositive && f.untilPublished && f.refused)
      ? 'stated' : `not stated where a customer reads: ${stated.length} kit passage(s) name \`money_policy_unset\` (${JSON.stringify(facts)})`,
      'W24.R2 — the kit tells a customer that until a money policy is published, a revenue or margin slot refuses — naming `money_policy_unset` — an outcome that declares a currency or carries a nonpositive value: the fail-closed consequence every money-objective slot meets in practice today (LANE-LOG R203; W24-B2 build review finding 4)')
      .toBe('stated');
  });
});

// ===========================================================================
// unit:W24.R3 — the operator's diagnostic line shows the refusal
// ===========================================================================

describe('unit:W24.R3', () => {
  /**
   * The frozen criterion: "reportLearningIncomplete carries refused and
   * refusedBySlot (LANE-LOG R203)." The line is written only for a learning
   * receipt that is NOT complete (`fan.ts`, `if (result?.ok) return`), on the
   * real path by `outcomeToLearning` (`src/learn/route.ts`), which the shopper's
   * `/realtime/action` reaches. So the fixture is the W24.R1.03 host leg — a
   * purchase naming the click-learning slot under `match: 'any'`, credited by the
   * purchase-learning slot and refused by the click slot — with the
   * purchase-learning slot's statistics object answering 500, so the receipt is
   * incomplete and the operator's line is written. That line must show the
   * refusal the receipt carries, beside `attributed`/`eligible`/`weightSkipped`
   * it already shows.
   */
  const SLOTS: Record<string, SlotSpec> = { hero: { reward: 'click' }, story: { reward: 'purchase' } };

  it('host: a shopper purchase whose receipt is incomplete writes a learning_incomplete line carrying refused and refusedBySlot', async () => {
    const m = await mount(learnWithSlots(SLOTS, 'any'));
    const session = await newAnonymousSession(m.env, TENANT);
    await served(m, SLOTS, session.subject);
    const chosen = await m.fetch(new Request(`http://shop.test/realtime/session/${session.sessionId}/preferences`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT, [SHOPPER_HEADER]: session.capability },
      body: JSON.stringify({ trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: session.grantId, iat: session.iat, exp: session.exp } }),
    }));
    expect(chosen.status, `the fixture: the shopper's consent choice answers ${(await chosen.clone().text()).slice(0, 160)}`).toBe(200);
    await m.drain();

    m.failStats.add(statsName(TENANT, BRAND, 'story'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const acted = await m.fetch(new Request('http://shop.test/realtime/action', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT, [SHOPPER_HEADER]: session.capability },
      body: JSON.stringify({ type: 'purchase', source: 'sdk', eventId: crypto.randomUUID(), timestamp: Date.now(),
        userId: session.subject, sessionId: session.sessionId, data: { contentId: 'cnt-tabby-evening', slot: 'hero', value: 495, currency: 'USD' } }),
    }));
    expect(acted.status, `the fixture: the shopper's purchase answers ${(await acted.clone().text()).slice(0, 160)}`).toBe(200);
    await m.drain();

    const lines = warn.mock.calls.filter(call => call[0] === 'learning_incomplete' && (call[1] as { kind?: number }).kind === 1)
      .map(call => call[1] as Record<string, unknown>);
    expect(lines.length, `the fixture: the incomplete outcome writes the operator's line (console.warn calls: ${JSON.stringify(warn.mock.calls).slice(0, 300)})`).toBeGreaterThan(0);
    const line = lines.at(-1)!;
    expect({ attributed: line.attributed, eligible: line.eligible, creditUnknown: line.creditUnknown },
      'the fixture: the purchase-learning slot was credited and its delivery refused, which is what makes the receipt incomplete')
      .toEqual({ attributed: 1, eligible: 1, creditUnknown: 1 });
    expect({ refused: line.refused, refusedBySlot: line.refusedBySlot },
      'W24.R3 — the operator\'s diagnostic line carries what the receipt says was refused and by which slot, beside what was attributed: the click-learning slot refused this purchase by reward (LANE-LOG R203; W24-B2 build review finding 3)')
      .toEqual({ refused: 1, refusedBySlot: { hero: 'reward' } });
  });
});

// ===========================================================================
// unit:W24.R4 — a reply that claims refusals it does not name
// ===========================================================================

describe('unit:W24.R4', () => {
  /**
   * The frozen criterion: "A reply carrying refused without refusedBySlot is
   * refused or named (LANE-LOG R203)." Of the two, the product's own reply
   * contract already decides which: "`refused` IS the number of entries in
   * `refusedBySlot`, so a reply cannot claim a count its own named refusals do
   * not carry" (`src/learn/fan.ts`, `outcomeReply`), and every other
   * inconsistent member of a ring reply is refused as malformed — counted
   * `ring.unknown`, no outcome receipt, the learning receipt not ok
   * (`src/learn/holdoutArms.test.ts:293-299`). A "named" alternative would need
   * a member no witness names; this test therefore asserts the refusal.
   *
   * The shape is what a partially deployed or faulty ring sends (document 35 §5
   * row W24: "test old callers and partial deployment"): the REAL ring's answer
   * with `refusedBySlot` taken off in transit. The same answer left whole is
   * accepted, so the refusal is of the inconsistency and never of refusals.
   */
  it('host-internal: the real ring\'s refusal reply is accepted whole, and the same reply without refusedBySlot is refused as malformed', async () => {
    const SLOTS: Record<string, SlotSpec> = { hero: { reward: 'click' } };
    const m = await mount(learnWithSlots(SLOTS));
    await served(m, SLOTS, 'v-tabby');
    const configs = { hero: configOf(SLOTS.hero!) };

    const whole = await fanOutcome(m.env, TENANT, purchaseOf(m, 'v-tabby', ONLINE_TS + 60_000, 'w24-ledger-whole'), DEFAULT_POLICY, BRAND, configs, configs.hero);
    expect({ acknowledged: whole.ring.acknowledged, refused: whole.outcome?.refused, refusedBySlot: whole.outcome?.refusedBySlot },
      'the fixture: a purchase naming no slot is refused by the one click-learning slot, and the ring\'s reply carrying both members is accepted (W24.R1.03)')
      .toEqual({ acknowledged: 1, refused: 1, refusedBySlot: { hero: 'reward' } });

    const partial = { ...m.env, DECISION_RING: {
      idFromName: (n: string) => n,
      get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await m.env.DECISION_RING!.get(name as unknown as DurableObjectId).fetch(input as RequestInfo, init);
        if (!String(input).endsWith('/outcome')) return response;
        const body = await response.json() as { receipt?: Record<string, unknown> };
        if (body.receipt) delete body.receipt.refusedBySlot;
        return Response.json(body, { status: response.status });
      } }),
    } } as unknown as Env;
    const stripped: LearningReceipt = await fanOutcome(partial, TENANT, purchaseOf(m, 'v-tabby', ONLINE_TS + 120_000, 'w24-ledger-stripped'), DEFAULT_POLICY, BRAND, configs, configs.hero);
    expect({ acknowledged: stripped.ring.acknowledged, unknown: stripped.ring.unknown, outcome: stripped.outcome, ok: stripped.ok },
      `W24.R4 — a ring reply that claims \`refused\` without the \`refusedBySlot\` that names it is refused as malformed, as every other reply member that does not account for itself is: it cannot become a receipt carrying a refusal count nobody named (LANE-LOG R203; W24-B2 build review finding 1). It was admitted as: ${JSON.stringify(stripped.outcome).slice(0, 200)}`)
      .toEqual({ acknowledged: 0, unknown: 1, outcome: null, ok: false });
  });
});

// ===========================================================================
// unit:W24.R5 — which name a doubly-refused slot is given, stated
// ===========================================================================

describe('unit:W24.R5', () => {
  /**
   * The frozen criterion: "The naming order of a slot refused for both reward
   * and money is stated (LANE-LOG R203)." The ORDER is the product's and is
   * compelled: money is tested before reward (`DecisionRing.outcome()`), which
   * keeps `B1.unit.test.ts:903` reading `money.reason` for a click-learning,
   * revenue-objective slot (R195 3b). The first leg locks that order on a
   * publishable doubly-refusable slot — `add_to_bag` learning with a `revenue`
   * objective (`kinds.ts`: a value objective needs purchase or add_to_bag) —
   * receiving a purchase; the second leg asks the kit, where `refusedBySlot` is
   * documented, to say it.
   */
  const SLOTS: Record<string, SlotSpec> = { story: { reward: 'add_to_bag', objective: 'revenue' } };

  it('host-internal: a slot refused for both reward and money is named `money`; refused for reward alone it is named `reward`', async () => {
    const m = await mount(learnWithSlots(SLOTS));
    await served(m, SLOTS, 'v-tabby');
    const configs = { story: configOf(SLOTS.story!) };
    const plain = await fanOutcome(m.env, TENANT, purchaseOf(m, 'v-tabby', ONLINE_TS + 60_000, 'w24-ledger-reward-only', { slot: 'story' }),
      DEFAULT_POLICY, BRAND, configs, configs.story);
    const both = await fanOutcome(m.env, TENANT, purchaseOf(m, 'v-tabby', ONLINE_TS + 120_000, 'w24-ledger-both', { slot: 'story', currency: 'JPY' }),
      DEFAULT_POLICY, BRAND, configs, configs.story);
    expect({ rewardOnly: plain.outcome?.refusedBySlot, both: both.outcome?.refusedBySlot, notCredited: both.outcome?.notCredited, money: both.outcome?.money },
      'W24.R5 — the order the kit must state, as the ring applies it: a purchase with no money question is refused by the add_to_bag slot for its reward; the same purchase in an undeclared currency is refused for money AND reward, and is named `money`')
      .toEqual({ rewardOnly: { story: 'reward' }, both: { story: 'money' }, notCredited: 'money', money: { code: 'JPY', reason: 'money_policy_unset' } });
  });

  it('logic: where the kit documents refusedBySlot it states that a slot refused for both reward and money is named `money`', () => {
    const documented = kit().filter(u => u.includes('`refusedBySlot`'));
    const stated = documented.some(u => u.split(/(?<=[.;:])\s+/).some(sentence => /reward/i.test(sentence) && /money/i.test(sentence)
      && sentence.includes('`money`') && /\b(both|first|before|precedence|ahead)\b/i.test(sentence)));
    expect(stated ? 'stated' : `not stated: ${documented.length} kit passage(s) name \`refusedBySlot\``,
      'W24.R5 — the kit, where it documents `refusedBySlot`, states the naming order: a slot refused for both its reward and money is named `money` (money is decided first), so a coarser name is read as such and never as a missing credit (LANE-LOG R203; W24-B2 build review finding 2)')
      .toBe('stated');
  });
});
