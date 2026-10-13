// src/learn/namedOutcomes.test.ts
// The two named outcomes, partner_pickup and retailer_referral: reward-bearing
// rows in the outcome contract, carried as the `custom` reward under their own
// names, credited to the decision that earned them exactly as a click is, and
// counted in the day report under their own names beside the orders and the
// attach, on the raw-day branch and the folded hours alike. Never a sale.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import { hourPrefix, learningInputOf, NAMED_OUTCOMES, outcomeFromAction, rewardOf, ts36, type OutcomeRecord } from '@/ledger/records';
import { attribute, attributeWindowed, DEFAULT_POLICY } from './policy';
import { buildReport, diagnosticDayReport, validNamedOutcomes, type ReportPolicy } from './report';
import { buildHour, reportFromHours, type HourAggregate } from './hourly';

const MIN = 60_000;
const T12 = Date.UTC(2026, 9, 2, 12, 0, 0);
const NOW = T12 + 4 * 60 * MIN;
const TENANT = 'acme';
const ids = { tenant: TENANT, brand: TENANT, date: '2026-10-02' };
const cell = { channel: 'organic', visit_bucket: '1' as const, region: 'US-NC', affinity: null };
const learning: ReportPolicy = { name: 'learning', ...DEFAULT_POLICY };

const dec = (visitor: string, ts: number, slot: string, item: string): DecisionRecord => ({
  decision_id: `${TENANT}:${ts36(ts)}:${visitor}:pdp:${slot}:0`, tenant: TENANT, brand: TENANT, visitor_id: visitor, session_id: `s-${visitor}`,
  identity_anchor: 'session', ts, page: 'pdp', slot, position: 0, item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell,
  arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'v1',
  explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
} as DecisionRecord);

/** The outcome the realtime door would write for a wire action: the producer's own function, nothing hand-built. */
const wire = (visitor: string, ts: number, event: string, data: Record<string, unknown>): OutcomeRecord =>
  outcomeFromAction({ type: 'custom', userId: visitor, sessionId: `s-${visitor}`, timestamp: ts, data: { event, ...data } }, TENANT)!;

const whereToBuy = dec('v1', T12, 'pdp-modules', 'where-to-buy');
const deal = dec('v1', T12 + 1 * MIN, 'deals', 'gift-card');
const otherWhereToBuy = dec('v2', T12 + 50 * MIN, 'pdp-modules', 'where-to-buy');
const decisions = [whereToBuy, deal, otherWhereToBuy];
const outcomes = [
  // She chooses pickup at the partner's store from the where-to-buy module: credited to that decision.
  wire('v1', T12 + 2 * MIN, 'partner_pickup', { decisionId: whereToBuy.decision_id, contentId: 'where-to-buy', slot: 'pdp-modules' }),
  // A click on the deal: the click reward, as it always was.
  outcomeFromAction({ type: 'content_click', userId: 'v1', sessionId: 's-v1', timestamp: T12 + 3 * MIN, data: { decisionId: deal.decision_id, contentId: 'gift-card', slot: 'deals' } }, TENANT)!,
  // An order: the purchase reward, counted as the order it is.
  outcomeFromAction({ type: 'purchase', userId: 'v1', sessionId: 's-v1', timestamp: T12 + 10 * MIN, data: { orderId: 'o-1', value: 899, currency: 'USD' } }, TENANT)!,
  // A second pickup press after the custom window (30 minutes) has closed: recorded, never credited.
  wire('v1', T12 + 40 * MIN, 'partner_pickup', { decisionId: whereToBuy.decision_id, contentId: 'where-to-buy', slot: 'pdp-modules' }),
  // Another shopper leaves for a partner retailer from the same module, in the next hour.
  wire('v2', T12 + 64 * MIN, 'retailer_referral', { decisionId: otherWhereToBuy.decision_id, contentId: 'where-to-buy', slot: 'pdp-modules', retailer: 'costco' }),
];
const learn: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, slots: {} };

const EXPECTED_NAMED = {
  version: 1, basis: 'learning_policy',
  events: {
    partner_pickup: { outcomes: 2, credited: 1, bySlot: { 'pdp-modules': { 'where-to-buy': 1 } } },
    retailer_referral: { outcomes: 1, credited: 1, bySlot: { 'pdp-modules': { 'where-to-buy': 1 } } },
  },
};

class FakeR2 {
  objects = new Map<string, string>();
  async put(key: string, body: string, options?: R2PutOptions): Promise<{ etag: string } | null> {
    const before = this.objects.get(key), onlyIf = options?.onlyIf as R2Conditional | undefined;
    const etag = before === undefined ? null : createHash('sha256').update(before).digest('hex');
    if ((onlyIf?.etagMatches !== undefined && onlyIf.etagMatches !== etag) || (onlyIf?.etagDoesNotMatch === '*' && before !== undefined)) return null;
    this.objects.set(key, body);
    return { etag: createHash('sha256').update(body).digest('hex') };
  }
  async get(key: string) {
    const v = this.objects.get(key); if (v === undefined) return null;
    const bytes = new TextEncoder().encode(v);
    return { etag: createHash('sha256').update(v).digest('hex'), size: bytes.length, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }), text: async () => v, json: async () => JSON.parse(v) as unknown };
  }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
  async list({ prefix }: { prefix: string }) { return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }; }
}
function ledger(r2: FakeR2, ds: DecisionRecord[], os: OutcomeRecord[]): void {
  const groups = new Map<string, string[]>();
  for (const d of ds) { const k = `${hourPrefix(TENANT, d.ts)}/decision/${ts36(d.ts)}-${ts36(d.ts)}-t.ndjson`; groups.set(k, [...(groups.get(k) ?? []), JSON.stringify(d)]); }
  for (const o of os) { const k = `${hourPrefix(TENANT, o.ts)}/outcome/${ts36(o.ts)}-${ts36(o.ts)}-t.ndjson`; groups.set(k, [...(groups.get(k) ?? []), JSON.stringify(o)]); }
  for (const [k, lines] of groups) r2.objects.set(k, lines.join('\n') + '\n');
}
const raw = (config: LearnConfig = learn) => buildReport({ ...ids, decisions, outcomes, learn: config, learning, reporting: [], now: NOW, truncated: false });
async function folded(config: LearnConfig = learn): Promise<{ report: ReturnType<typeof reportFromHours>; hours: HourAggregate[] }> {
  const r2 = new FakeR2();
  ledger(r2, decisions, outcomes);
  const store = r2 as unknown as Parameters<typeof buildHour>[0];
  const hours = [await buildHour(store, TENANT, { date: ids.date, hour: 12 }, config, NOW), await buildHour(store, TENANT, { date: ids.date, hour: 13 }, config, NOW)];
  return { report: reportFromHours(hours, ids, config, NOW, { pending: 0, missing: [] }), hours };
}

describe('the outcome contract: two named outcomes', () => {
  it('are reward-bearing rows, carried as the custom reward under their own names, by either wire form', () => {
    expect([...NAMED_OUTCOMES]).toEqual(['partner_pickup', 'retailer_referral']);
    for (const event of NAMED_OUTCOMES) {
      expect(rewardOf({ type: 'custom', data: { event } })).toEqual({ type: 'custom', event });
      expect(rewardOf({ type: event })).toEqual({ type: 'custom', event });
      expect(learningInputOf({ type: 'custom', data: { event } })).toEqual({ counted: true, reward: 'custom', event });
    }
    // Every other reward keeps its own row.
    expect(rewardOf({ type: 'content_click' })).toEqual({ type: 'click', event: 'content_click' });
    expect(rewardOf({ type: 'purchase' })).toEqual({ type: 'purchase', event: 'purchase' });
    // A name Object.prototype carries is not a row of the table.
    for (const event of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(rewardOf({ type: 'custom', data: { event } }), event).toBeNull();
  });

  it('are never a sale: the record keeps its own name and the decision it names, and carries no purchase type', () => {
    const [pickup, , order, , referral] = outcomes;
    expect(pickup).toMatchObject({ type: 'custom', event: 'partner_pickup', decision_id: whereToBuy.decision_id, item_id: 'where-to-buy', slot: 'pdp-modules' });
    expect(pickup!.outcome_id).toBe(`${TENANT}:${ts36(T12 + 2 * MIN)}:v1:partner_pickup`);
    expect(referral).toMatchObject({ type: 'custom', event: 'retailer_referral', decision_id: otherWhereToBuy.decision_id });
    expect(order).toMatchObject({ type: 'purchase', event: 'purchase', value: 899 });
    for (const o of [pickup!, referral!]) expect(o.type).not.toBe('purchase');
  });

  it('are credited to the decision that earned them exactly as a click is, inside the custom window', () => {
    const ring = [whereToBuy, deal].map((d) => ({ id: d.decision_id, brand: TENANT, tenant: TENANT, visitor_id: 'v1', ts: d.ts, page: d.page, slot: d.slot, item: d.item_id, session_id: d.session_id, arm: d.arm, cell: d.cell }));
    const credits = attribute(outcomes[0]!, ring, DEFAULT_POLICY);
    expect(credits).toEqual([{ decision_id: whereToBuy.decision_id, slot: 'pdp-modules', item: 'where-to-buy', cell, reward: 'custom', event: 'partner_pickup', ts: T12 + 2 * MIN, weight: 1 }]);
    // The custom window is the click's thirty minutes; a press after it is named as late, not credited.
    expect(DEFAULT_POLICY.windowsMs.custom).toBe(DEFAULT_POLICY.windowsMs.click);
    expect(attributeWindowed(outcomes[3]!, ring, DEFAULT_POLICY)).toEqual({ credits: [], outsideWindow: 1, brandMismatched: 0 });
  });
});

describe('the day report counts them under their own names', () => {
  it('raw day: beside the orders and the attach, never inside either', () => {
    const report = raw();
    expect(report.namedOutcomes).toEqual(EXPECTED_NAMED);
    // The orders are the purchase outcomes, by visitor, untouched by the named outcomes.
    const personalized = report.visitorOutcomes!.arms.find((a) => a.arm === 'personalized')!;
    expect(personalized.byType).toEqual({ click: 1, custom: 2, purchase: 1 });
    // A slot learning the click reward is not paid for a pickup: the attach stays clicks per exposure.
    expect(report.holdout['pdp-modules']).toEqual([expect.objectContaining({ arm: 'personalized', decisions: 2, credited: 0 })]);
    expect(report.holdout.deals).toEqual([expect.objectContaining({ arm: 'personalized', decisions: 1, credited: 1 })]);
    expect(report.grids['pdp-modules']!.learning!.items['where-to-buy']!['*']!.s).toBe(0);
    // And the projection the GET answers with carries it unchanged.
    expect(diagnosticDayReport(report).namedOutcomes).toEqual(EXPECTED_NAMED);
  });

  it('a slot that publishes reward custom learns from them, exactly as a click slot learns from the same presses as clicks', () => {
    const report = raw({ ...learn, slots: { 'pdp-modules': { reward: 'custom' } } });
    expect(report.namedOutcomes).toEqual(EXPECTED_NAMED);
    expect(report.holdout['pdp-modules']).toEqual([expect.objectContaining({ decisions: 2, credited: 2 })]);
    // The same three presses sent as content clicks, to a slot that learns the click reward.
    const asClicks = outcomes.map((o) => (o.type === 'custom' ? { ...o, type: 'click' as const, event: 'content_click' } : o));
    const clicks = buildReport({ ...ids, decisions, outcomes: asClicks, learn, learning, reporting: [], now: NOW, truncated: false });
    expect(clicks.holdout['pdp-modules']).toEqual(report.holdout['pdp-modules']);
    const cellOf = (r: typeof report) => r.grids['pdp-modules']!.learning!.items['where-to-buy']!['*']!;
    expect(cellOf(report).s).toBeGreaterThan(0);
    expect({ n: cellOf(report).n, s: cellOf(report).s }).toEqual({ n: cellOf(clicks).n, s: cellOf(clicks).s });
    expect(clicks.namedOutcomes).toEqual({ version: 1, basis: 'learning_policy', events: {} });
  });

  it('folded hours: the same count as the raw day, across the hour boundary', async () => {
    const { report, hours } = await folded();
    expect(report.hours?.source).toBe('aggregates');
    expect(report.namedOutcomes).toEqual(raw().namedOutcomes);
    expect(hours[0]!.brands[TENANT]!.named!.events.partner_pickup).toEqual({ outcomes: 2, credited: 1, bySlot: { 'pdp-modules': { 'where-to-buy': 1 } } });
    // The referral at 13:04 is credited to the 12:50 decision the 12:00 hour put in the rings.
    expect(hours[1]!.brands[TENANT]!.named!.events.retailer_referral).toEqual({ outcomes: 1, credited: 1, bySlot: { 'pdp-modules': { 'where-to-buy': 1 } } });
    const custom = await folded({ ...learn, slots: { 'pdp-modules': { reward: 'custom' } } });
    expect(custom.report.namedOutcomes).toEqual(EXPECTED_NAMED);
  });

  it('an hour folded before the member existed makes the day say it cannot count them, never a smaller count', async () => {
    const { hours } = await folded();
    const older = structuredClone(hours[0]!);
    delete older.brands[TENANT]!.named;
    expect(reportFromHours([older, hours[1]!], ids, learn, NOW, { pending: 0, missing: [] }).namedOutcomes).toBeNull();
    // A malformed member is refused like every other malformed member of an aggregate.
    const broken = structuredClone(hours[0]!);
    (broken.brands[TENANT]!.named as unknown as { events: unknown }).events = { partner_pickup: { outcomes: -1, credited: 0, bySlot: {} } };
    expect(() => reportFromHours([broken, hours[1]!], ids, learn, NOW, { pending: 0, missing: [] })).toThrow();
  });

  it('is read back conservatively: anything but the exact declaration is unknown', () => {
    expect(validNamedOutcomes(EXPECTED_NAMED)).toEqual(EXPECTED_NAMED);
    for (const bad of [undefined, null, {}, { ...EXPECTED_NAMED, version: 2 }, { ...EXPECTED_NAMED, basis: 'sales' },
      { ...EXPECTED_NAMED, events: { partner_pickup: { outcomes: 1, credited: 0, bySlot: { s: { i: 1 } } } } },
      { ...EXPECTED_NAMED, events: { constructor: { outcomes: 1, credited: 0, bySlot: {} } } },
      { ...EXPECTED_NAMED, events: { partner_pickup: { outcomes: 1.5, credited: 0, bySlot: {} } } }]) {
      expect(validNamedOutcomes(bad), JSON.stringify(bad)).toBeNull();
    }
    // A report built before the member existed projects it as unknown.
    const legacy = raw(); delete legacy.namedOutcomes;
    expect(diagnosticDayReport(legacy).namedOutcomes).toBeNull();
  });
});
