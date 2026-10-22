// src/units/_parity2.ts
// The second shared harness of the `tapestry-parity-build` unit files: what the
// S2 tickets (P07, P04, P29, P31, P05, P06) need beyond src/units/_parity.ts,
// which is carried byte-for-byte from the S1 branch and never edited here.
//
// It holds no expected value of any ticket. It binds the population-trend
// namespace (REGION_TREND) to the REAL RegionTrend class, publishes what its
// objects hold through their own doors, sends the shopper calls _parity.ts does
// not offer (a decision request with extra fields, an action with an edge
// geolocation), and builds a learned ladder through the real fan-in and the real
// statistics objects, in the idiom of src/units/P10/LEDGER.unit.test.ts.

import { expect } from 'vitest';

import type { DecisionRecord } from '@/content/types';
import { RegionTrend } from '@/durable-objects/RegionTrend';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { fanDecisions } from '@/learn/fan';
import { DEFAULT_STATS } from '@/learn/stats';
import { ts36 } from '@/ledger/records';
import { invalidateTrendCache } from '@/reflex/regionTrend';
import { captureRetention } from '@/retention';
import type { Env } from '@/types/env';

import { asOperator, BRAND, readTree, TENANT, type Answer, type Decision, type Mounted, type Registry, type Shopper, type Snapshot } from './_parity';

// ---------------------------------------------------------------------------
// The population-trend namespace, on the real class.
// ---------------------------------------------------------------------------

/** An in-memory Durable Object namespace over a real class, as _parity.ts builds its three. */
function namespaceOver(env: Env, registry: Map<string, Registry>, make: (state: DurableObjectState, env: Env) => Registry['object'], pending: Promise<unknown>[]) {
  return {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = registry.get(name);
      if (!item) {
        const data = new Map<string, unknown>(); const alarms: number[] = [];
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
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, entry] of Object.entries(values)) candidate.set(key, structuredClone(entry));
              },
              deleteAlarm: async () => { alarms.length = 0; }, setAlarm: async (at: number) => { alarms.push(at); },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string | string[]) => { for (const key of typeof k === 'string' ? [k] : k) data.delete(key); },
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null, deleteAlarm: async () => { alarms.length = 0; },
        };
        const state = { id: name, storage: storageStub, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, object: make(state, env) };
        registry.set(name, item);
      }
      return item.object.fetch(new Request(input, init));
    } }),
  };
}

/**
 * Binds the stamp's EXISTING population-trend namespace (`REGION_TREND`, the
 * only binding the regional prior has: src/types/env.ts:23) to the real
 * RegionTrend class. No other binding is added: a population aggregate that
 * needed one would find nothing here.
 */
export function bindTrend(m: Mounted): Map<string, Registry> {
  const registry = new Map<string, Registry>();
  const pending: Promise<unknown>[] = [];
  m.env.REGION_TREND = namespaceOver(m.env, registry, (state, env) => new RegionTrend(state, env) as unknown as Registry['object'], pending) as unknown as DurableObjectNamespace;
  return registry;
}

/**
 * What the trend objects hold, published the way production publishes it: every
 * object of the namespace through its own `/publish` door (what its alarm runs),
 * then the hourly rollup through the operator's route (`POST /v1/:tenant/trend/rollup`).
 */
export async function publishTrends(m: Mounted, registry: Map<string, Registry>): Promise<void> {
  await m.drain();
  for (const name of [...registry.keys()].sort()) {
    const answer = await registry.get(name)!.object.fetch(new Request('https://region-trend/publish', { method: 'POST' }));
    expect(answer.status, `PRECONDITION (${m.host}): the trend object ${name} publishes`).toBe(200);
  }
  const rolled = await asOperator(m, 'POST', `/v1/${TENANT}/trend/rollup`);
  expect(rolled.status, `PRECONDITION (${m.host}): the operator's rollup runs: ${JSON.stringify(rolled.body).slice(0, 200)}`).toBe(200);
  invalidateTrendCache();
}

/** Every value every object of the namespace stores, as one string, for an identifier scan. */
export const trendStorageText = (registry: Map<string, Registry>): string =>
  JSON.stringify([...registry.entries()].map(([name, item]) => [name, [...item.data.entries()]]));

// ---------------------------------------------------------------------------
// The shopper calls _parity.ts does not offer.
// ---------------------------------------------------------------------------

async function shopperCall(m: Mounted, s: Shopper, path: string, body: unknown, cf?: Record<string, string>): Promise<Answer> {
  const request = new Request(`https://shop.invalid${path}`, {
    method: 'POST', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  // The edge's own geolocation (`request.cf`), which a Node Request cannot carry by construction.
  if (cf) Object.defineProperty(request, 'cf', { value: cf });
  const response = await m.fetch(request);
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}

/** A real accepted event, arriving through an edge that geolocated it. */
export const actionAt = (m: Mounted, s: Shopper, event: { type: string; data: Record<string, unknown> }, cf: Record<string, string>, entry?: Record<string, string>) =>
  shopperCall(m, s, '/realtime/action', { ...event, source: 'sdk', userId: s.grant.subject, sessionId: s.grant.sessionId,
    timestamp: Date.now(), eventId: crypto.randomUUID(), ...(entry ? { entry } : {}) }, cf);

/** `POST /v1/:tenant/decisions/snapshot` with fields beyond the page and the brand (strings, as the route reads every field). */
export async function snapshotWith(m: Mounted, s: Shopper, page: string, fields: Record<string, string>): Promise<Snapshot> {
  const answer = await shopperCall(m, s, `/v1/${TENANT}/decisions/snapshot`, { page, brand: BRAND, ...fields });
  return { ...answer, page, ...(fields.pageInstance ? { pageInstance: fields.pageInstance } : {}), decisions: (answer.body.decisions ?? []) as Decision[] };
}

// ---------------------------------------------------------------------------
// A learned ladder, through the real fan-in and the real statistics objects.
// ---------------------------------------------------------------------------

export interface LadderItem { item: string; exposures: number }

/**
 * `exposures` served exposures per module of a slot, in one cell, fanned by the
 * real `fanDecisions` and published by every statistics object through its own
 * `/publish` door (src/units/P10/LEDGER.unit.test.ts's ladder, for any slot).
 * Level 0 (everyone) holds every exposure, whatever cell a later shopper is in.
 */
export async function learnedLadder(m: Mounted, slot: string, items: LadderItem[], cell: DecisionRecord['cell'], page = 'pdp'): Promise<void> {
  const at = Date.now() - 10 * 60_000;
  const most = Math.max(...items.map(i => i.exposures));
  for (let k = 0; k < most; k++) {
    const visitor = `v-parity-ladder-${slot}-${k}`;
    const records = items.filter(i => k < i.exposures).map(({ item }, position) => ({
      decision_id: `${TENANT}:${ts36(at + k)}:${visitor}:${page}:${slot}:${position}`, tenant: TENANT, brand: BRAND, visitor_id: visitor, session_id: `s-${visitor}`,
      identity_anchor: 'visitor', ts: at + k, page, slot, position, item_id: item, customer_item_id: `TAP-${item.toUpperCase()}`, candidates: [],
      cell, arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 },
      config_label: 'parity-ladder', explain: { drivers: [], score_base: 0.5, score_final: 0.5, lift: null }, measurementBasis: 'served-v1',
      retention: captureRetention(m.env as never, TENANT, at + k, Date.now()),
    } as unknown as DecisionRecord));
    if (!records.length) continue;
    const receipt = await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: visitor, records },
      () => ({ reward: 'click', objective: 'unit', stats: DEFAULT_STATS, measurementBasis: 'served-v1' }));
    expect(receipt.ok, `PRECONDITION: the ladder's exposures reach the fan-in (${JSON.stringify(receipt).slice(0, 200)})`).toBe(true);
  }
  await m.drain();
  for (const name of [...m.stats.keys()]) {
    const published = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/publish', { method: 'POST' });
    expect(await published.json(), `PRECONDITION: ${name} publishes its snapshot`).toMatchObject({ ok: true, published: true });
  }
}

// ---------------------------------------------------------------------------
// The kit.
// ---------------------------------------------------------------------------

/** The sentences of a kit document, flattened, so a statement is judged within one sentence (P02.A5's idiom). */
export const kitSentences = (file: string): string[] => readTree(file).replace(/[‘’]/g, "'").replace(/`/g, '')
  .split(/(?<=[.!?])\s+|\n\s*\n|\n[-*|] /).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** Each statement the named kit documents lack, as `file: statement`. */
export function missingStatements(files: string[], statements: Array<{ name: string; test: (sentence: string) => boolean }>): string[] {
  const missing: string[] = [];
  for (const file of files) {
    const sentences = kitSentences(file);
    for (const statement of statements) if (!sentences.some(statement.test)) missing.push(`${file}: ${statement.name}`);
  }
  return missing;
}
