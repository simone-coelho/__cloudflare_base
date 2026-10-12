// src/units/_parity4.ts
// The fourth shared harness of the `tapestry-parity-build` unit files: what the
// S4 tickets (P28, P30, P33, P32, P16, P09, P13, P35) need beyond
// src/units/_parity.ts and src/units/_parity2.ts, which are carried
// byte-for-byte from the S1 and S2 branches and never edited here.
//
// It holds no expected value of any ticket. It builds a LEARNED lift through the
// real fan-in (the decision records into the visitor's ring and the statistics
// objects, `fanDecisions`) and the real crediting path (an outcome attributed by
// the ring under the published policy, `fanOutcome`), and publishes each
// statistics object through its own `/publish` door; and it writes the regional
// prior's published global snapshot where the serving path reads it (the idiom of
// src/units/P07/LEDGER.unit.test.ts on the S2 branch).

import { expect } from 'vitest';

import type { DecisionRecord } from '@/content/types';
import { fanDecisions, fanOutcome, type SlotLearnConfig } from '@/learn/fan';
import { DEFAULT_POLICY } from '@/learn/policy';
import { DEFAULT_STATS } from '@/learn/stats';
import { ts36, type OutcomeRecord } from '@/ledger/records';
import { REGION_GENERATION, trendKey } from '@/reflex/regionTrend';
import { captureRetention } from '@/retention';

import { BRAND, TENANT, type Mounted } from './_parity';

/** One row of a learned ladder: how many served exposures an item had in the cell, and how many of them its slot's reward credited. */
export interface LiftRow { item: string; exposures: number; successes: number }

/**
 * `exposures` served exposures per item of a slot, in one cell, each by its own
 * visitor, and `successes` click outcomes naming the decision, attributed by the
 * real ring under the default policy; then every statistics object publishes.
 * Level 0 (everyone) holds every exposure, whatever cell a later shopper is in.
 * An item that is not in the published catalogue (a retired module) still counts
 * in the slot's own rate, as it did when it was served.
 */
export async function learnedLift(m: Mounted, slot: string, rows: LiftRow[], cell: DecisionRecord['cell'],
  measurementBasis: 'served-v1' | 'rendered-v1' = 'served-v1', page = 'pdp'): Promise<void> {
  const at = Date.now() - 10 * 60_000;
  const cfg: SlotLearnConfig = { reward: 'click', objective: 'unit', stats: DEFAULT_STATS, measurementBasis };
  const most = Math.max(...rows.map(r => r.exposures));
  for (let k = 0; k < most; k++) {
    const visitor = `v-parity4-lift-${slot}-${k}`, session = `s-${visitor}`;
    const records = rows.filter(r => k < r.exposures).map(({ item }, position) => ({
      decision_id: `${TENANT}:${ts36(at + k)}:${visitor}:${page}:${slot}:${position}`, tenant: TENANT, brand: BRAND, visitor_id: visitor, session_id: session,
      identity_anchor: 'visitor', ts: at + k, page, slot, position, item_id: item, customer_item_id: `TAP-${item.toUpperCase()}`, candidates: [],
      cell, arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 },
      config_label: 'parity4-lift', explain: { drivers: [], score_base: 0.5, score_final: 0.5, lift: null }, measurementBasis,
      retention: captureRetention(m.env as never, TENANT, at + k, Date.now()),
    } as unknown as DecisionRecord));
    if (!records.length) continue;
    const fanned = await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: visitor, records }, () => cfg);
    expect(fanned.ok, `PRECONDITION: the ladder's exposures reach the fan-in (${JSON.stringify(fanned).slice(0, 200)})`).toBe(true);
    for (const row of rows.filter(r => k < r.successes)) {
      const record = records.find(r => r.item_id === row.item)!;
      const ts = at + k + 1;
      const outcome = { outcome_id: `${TENANT}:${ts36(ts)}:${visitor}:content_click:${row.item}`, decision_id: record.decision_id, tenant: TENANT, brand: BRAND,
        visitor_id: visitor, session_id: session, ts, type: 'click', event: 'content_click', item_id: row.item, slot, value: null, currency: null, margin: null,
        products: null, arm: 'personalized', retention: captureRetention(m.env as never, TENANT, ts, Date.now()) } as unknown as OutcomeRecord;
      const credited = await fanOutcome(m.env, TENANT, outcome, DEFAULT_POLICY, BRAND, { [slot]: cfg }, cfg);
      expect(credited.ok, `PRECONDITION: the ladder's success for ${row.item} is credited by the ring (${JSON.stringify(credited).slice(0, 300)})`).toBe(true);
    }
  }
  await m.drain();
  for (const name of [...m.stats.keys()]) {
    const published = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/publish', { method: 'POST' });
    expect(await published.json(), `PRECONDITION: ${name} publishes its snapshot`).toMatchObject({ ok: true, published: true });
  }
}

/**
 * The regional prior's published global snapshot, written where the serving path
 * reads it (`readTrend`, src/reflex/regionTrend.ts), as
 * src/units/P07/LEDGER.unit.test.ts's `publishRegionalEverywhere` writes it.
 */
export async function publishGlobalTrend(m: Mounted, share: Record<string, Record<string, number>>, events = 500): Promise<void> {
  const now = Date.now();
  const r = Object.fromEntries(Object.entries(share).map(([dim, values]) => [dim, Object.fromEntries(Object.entries(values).map(([v, s]) => [v, s * 5]))]));
  await m.cache.put(trendKey(TENANT, '*'), JSON.stringify({ generation: REGION_GENERATION, tenant: TENANT, region: '*', level: 'global', events,
    updatedAt: now, version: now, r, share }));
}
